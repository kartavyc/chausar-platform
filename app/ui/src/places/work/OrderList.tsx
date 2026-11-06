import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useLanguage, useT, type T } from '../../text';
import { useEngine } from '../../engine/context';
import { openSheet } from '../../shell/navigation';
import { useClock } from '../../shell/clock';
import { Avatar } from '../../parts/Avatar';
import { Button } from '../../parts/Button';
import { StateChip } from '../../parts/Chip';
import { Figure, proofOf } from '../../parts/Figure';
import { Receipt } from '../../parts/Receipt';
import { Tile } from '../../parts/Tile';
import { cx } from '../../parts/cx';
import type { ClientLite } from '../../engine/types';
import type { OrderAction, OrderView } from './orders';
import { messageOf } from './PreviousRuns';
import s from './Work.module.css';

/** One plain sentence for where an order stands (CogSend wording). */
export function orderSentence(view: OrderView, t: T): string {
  switch (view.state) {
    case 'invoiced': {
      const number = view.invoice?.number;
      if (!number) return t('work.order.invoicedPlain');
      return t(view.partPaid ? 'work.order.partPaid' : 'work.order.invoiced', { number });
    }
    case 'delivered': return t(view.draftInvoice ? 'work.order.deliveredDraft' : 'work.order.delivered');
    case 'paid': return t(view.delivered ? 'work.order.paid' : 'work.order.paidUndelivered');
    default: return t(`work.order.${view.state}`);
  }
}

/** The order waits on the owner on Today: its run asks, its draft waits to be read, or its invoice waits to be issued. */
export function waitsOnYou(view: OrderView): boolean {
  return view.state === 'waiting' || view.state === 'draft-ready' || view.draftInvoice;
}

const LOCALE = { en: 'en-IN', hi: 'hi-IN' } as const;
const DAY_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A day as the reader's calendar writes it, "2 Sept", with the year only when it is not this year. A day alone
 * (2026-10-28) is read in UTC, so it never slips to the day before; a moment is read on this computer's clock.
 */
function useDay(): (at: string) => string {
  const language = useLanguage();
  const now = useClock();
  return useMemo(() => {
    const year = now().getFullYear();
    const formats = new Map<string, Intl.DateTimeFormat>();
    const formatOf = (withYear: boolean, utc: boolean) => {
      const key = `${withYear}:${utc}`;
      let format = formats.get(key);
      if (!format) {
        format = new Intl.DateTimeFormat(LOCALE[language], { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}), ...(utc ? { timeZone: 'UTC' } : {}) });
        formats.set(key, format);
      }
      return format;
    };
    return (at: string) => {
      const dayOnly = DAY_ONLY.test(at);
      const date = new Date(dayOnly ? `${at}T00:00:00.000Z` : at);
      if (Number.isNaN(date.getTime())) return at;
      const sameYear = (dayOnly ? date.getUTCFullYear() : date.getFullYear()) === year;
      return formatOf(!sameYear, dayOnly).format(date);
    };
  }, [language, now]);
}

/** Today on this computer, as the engine's date text (YYYY-MM-DD). */
function todayOf(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

const ACTION_LABEL: Record<OrderAction, string> = { start: 'work.start', 'run-again': 'run.again', deliver: 'work.deliver' };
const ACTION_FAILED: Record<OrderAction, string> = { start: 'work.failed.start', 'run-again': 'work.failed.again', deliver: 'work.failed.deliver' };

/**
 * One order as D's inner card (`.oc`): what the client asked for (it opens the newest run when the engine lists it),
 * a status chip in the engine's own words (the invoice's once there is one, else the draft's), when it was ordered
 * and the receipt behind its price, its invoice with the total, receipt and due day, the one CogSend sentence, and at
 * most one action: Start, Run again, or Mark delivered (which asks once more). An order that waits on the owner says
 * "Open on Today", where it is decided. The steps from Agreed to Paid wait for the engine's order steps (W4 4J).
 */
function OrderCard({ view, canOpen, onChanged }: { view: OrderView; canOpen: boolean; onChanged: () => void }) {
  const t = useT();
  const client = useEngine();
  const now = useClock();
  const day = useDay();
  const titleId = useId();
  const [phase, setPhase] = useState<'idle' | 'confirm' | 'busy'>('idle');
  const [problem, setProblem] = useState<string>();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const { order, state, action, invoice } = view;
  const run = view.run && !view.run.practice ? view.run : undefined;
  // The invoice's total shows only with its receipt, as the engine's list sends both.
  const totalReceipt = invoice?.total && invoice.receiptId?.trim() ? invoice.receiptId : undefined;

  useEffect(() => { if (phase === 'confirm') cancelRef.current?.focus(); }, [phase]);

  async function act(kind: OrderAction) {
    setPhase('busy');
    setProblem(undefined);
    try {
      if (kind === 'deliver') await client.request('venture.order.deliver', { orderId: order.id, deliveredOn: todayOf(now()) });
      else await client.request('venture.delivery.run', { orderId: order.id });
      onChanged();
    } catch (error) {
      setProblem(t(ACTION_FAILED[kind], { message: messageOf(error) }));
    } finally {
      setPhase('idle');
    }
  }

  return (
    <li
      className={s.order} data-card="" data-row="" data-row-id={`order-${order.id}`} data-second-ask={action === 'deliver' ? '' : undefined}
      tabIndex={-1} aria-labelledby={titleId}
    >
      <div className={s.orderTop}>
        <h4 id={titleId} className={s.orderTitle}>
          {canOpen && view.run ? (
            <button type="button" className={s.titleButton} data-open="" onClick={(event) => openSheet('run', view.run!.id, event.currentTarget)}>{order.request}</button>
          ) : order.request}
        </h4>
        {invoice ? <StateChip kind="invoice" value={invoice.status} /> : run ? <StateChip kind="delivery" value={run.status} /> : null}
      </div>
      <p className={s.orderMeta}>
        <span>{t('work.order.ordered', { date: day(order.at) })}</span>
        <span aria-hidden="true">·</span>
        {/* The engine sends the order's price receipt, not its amount (W4 4J order steps): say where the price is. */}
        <span>{t('work.order.priced')}</span>
        <Receipt id={order.priceReceiptId} />
      </p>
      {invoice?.number && (
        <p className={s.orderMeta}>
          <span className="mono">{invoice.number}</span>
          {invoice.total && totalReceipt && (
            <>
              <span aria-hidden="true">·</span>
              <Figure value={invoice.total} receiptId={totalReceipt} />
            </>
          )}
          {invoice.dueDate && (
            <>
              <span aria-hidden="true">·</span>
              <span>{t('work.order.due', { date: day(invoice.dueDate) })}</span>
            </>
          )}
        </p>
      )}
      <div className={s.orderFoot}>
        <p className={cx(s.say, state === 'waiting' && s.wait)}>{orderSentence(view, t)}</p>
        {(waitsOnYou(view) || (action && phase !== 'confirm')) && (
          <div className={s.orderActs}>
            {waitsOnYou(view) && <a className={s.linkButton} href="#/today">{t('work.order.onToday')}</a>}
            {action && phase !== 'confirm' && (
              <Button variant="primary" data-key="primary" disabled={phase === 'busy'} onClick={() => (action === 'deliver' ? setPhase('confirm') : void act(action))}>
                {t(ACTION_LABEL[action])}
              </Button>
            )}
          </div>
        )}
      </div>
      {phase === 'confirm' && (
        <div className={s.confirm}>
          <p className={s.ask}>{t('approval.secondAsk', { action: t('work.deliver') })}</p>
          <Button ref={cancelRef} onClick={() => setPhase('idle')}>{t('approval.cancel')}</Button>
          <Button variant="primary" data-confirm="" onClick={() => void act('deliver')}>{t('work.deliver')}</Button>
        </div>
      )}
      {problem && <p className={s.problem} role="status">{problem}</p>}
    </li>
  );
}

interface ClientOrdersProps {
  clientId: string;
  client: ClientLite | undefined;
  /** The client list has loaded, so a missing client is truly unknown rather than not read yet. */
  clientsRead: boolean;
  views: OrderView[];
  runIds: ReadonlySet<string>;
  onChanged: () => void;
}

/** D's client group (`.cg`): the client's initials, name (it opens the client sheet), since when, how many orders, and
 *  what they owe with its receipt; then each of their orders as a card. */
function ClientOrders({ clientId, client, clientsRead, views, runIds, onChanged }: ClientOrdersProps) {
  const t = useT();
  const day = useDay();
  const nameId = useId();
  const name = client?.name ?? (clientsRead ? t('work.order.client') : '');
  const wide = views.length > 1;
  const sub = [client ? t('work.client.since', { date: day(client.at) }) : null, t('work.client.orders', { count: views.length })].filter(Boolean).join(' · ');
  const owed = client?.owed && proofOf(client.owed) ? client.owed : undefined;
  return (
    <Tile as="article" labelledBy={nameId} className={cx(s.clientTile, wide && s.clientTileWide)}>
      <header className={s.clientHead}>
        <Avatar name={name} size={40} />
        <div className={s.clientWho}>
          <h3 id={nameId} className={s.clientName}>
            {client ? (
              <button type="button" className={s.titleButton} onClick={(event) => openSheet('client', client.id, event.currentTarget)}>{client.name}</button>
            ) : name}
          </h3>
          <p className={s.clientSub}>{sub}</p>
        </div>
        {owed && (
          <div className={s.owes}>
            <p className={s.owesLabel}>{t('work.client.owes')}</p>
            <Figure value={owed.display} receiptId={owed.receiptId} className={s.owesFigure} />
          </div>
        )}
      </header>
      <ul className={cx(s.orderCards, wide && s.orderCardsTwo)}>
        {views.map((view) => <OrderCard key={view.order.id} view={view} canOpen={!!view.run && runIds.has(view.run.id)} onChanged={onChanged} />)}
      </ul>
    </Tile>
  );
}

export interface OrderListProps {
  views: OrderView[];
  clients: ClientLite[] | undefined;
  /** Runs the engine lists: an order opens its newest run in the run sheet only when the engine can show it. */
  runIds: ReadonlySet<string>;
  onChanged: () => void;
  /** One order on its own (the order focus): its client's tile takes the full width. */
  full?: boolean | undefined;
}

/**
 * Orders grouped by client (D's `.orders`), each client in the order of their newest order and each client's orders
 * newest first, as the views come. A client with two or more orders takes the full width with the cards side by side.
 */
export function OrderList({ views, clients, runIds, onChanged, full = false }: OrderListProps) {
  const groups = new Map<string, OrderView[]>();
  for (const view of views) groups.set(view.order.clientId, [...(groups.get(view.order.clientId) ?? []), view]);
  return (
    <div className={cx(s.clientTiles, full && s.clientTilesFull)}>
      {[...groups].map(([clientId, mine]) => (
        <ClientOrders
          key={clientId} clientId={clientId} client={clients?.find((c) => c.id === clientId)} clientsRead={!!clients}
          views={mine} runIds={runIds} onChanged={onChanged}
        />
      ))}
    </div>
  );
}
