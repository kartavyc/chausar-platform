import { useEffect, useRef, useState } from 'react';
import { useT, type T } from '../../text';
import { useEngine } from '../../engine/context';
import { openSheet } from '../../shell/navigation';
import { Button } from '../../parts/Button';
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

/** Today on this computer, as the engine's date text (YYYY-MM-DD). */
function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

const ACTION_LABEL: Record<OrderAction, string> = { start: 'work.start', 'run-again': 'run.again', deliver: 'work.deliver' };
const ACTION_FAILED: Record<OrderAction, string> = { start: 'work.failed.start', 'run-again': 'work.failed.again', deliver: 'work.failed.deliver' };

function OrderRow({ view, clientName, canOpen, onChanged }: { view: OrderView; clientName: string; canOpen: boolean; onChanged: () => void }) {
  const t = useT();
  const client = useEngine();
  const [phase, setPhase] = useState<'idle' | 'confirm' | 'busy'>('idle');
  const [problem, setProblem] = useState<string>();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const { order, state, action } = view;

  useEffect(() => { if (phase === 'confirm') cancelRef.current?.focus(); }, [phase]);

  async function act(kind: OrderAction) {
    setPhase('busy');
    setProblem(undefined);
    try {
      if (kind === 'deliver') await client.request('venture.order.deliver', { orderId: order.id, deliveredOn: today() });
      else await client.request('venture.delivery.run', { orderId: order.id });
      onChanged();
    } catch (error) {
      setProblem(t(ACTION_FAILED[kind], { message: messageOf(error) }));
    } finally {
      setPhase('idle');
    }
  }

  return (
    <li className={s.item} data-row="" data-row-id={`order-${order.id}`} data-second-ask={action === 'deliver' ? '' : undefined} tabIndex={-1}>
      <span className={s.who}>{clientName}</span>
      {canOpen && view.run ? (
        <button type="button" className={cx(s.what, s.open)} data-open="" onClick={(event) => openSheet('run', view.run!.id, event.currentTarget)}>{order.request}</button>
      ) : (
        <span className={s.what}>{order.request}</span>
      )}
      <div className={s.tail}>
        <span className={cx(s.state, state === 'waiting' && s.wait)}>{orderSentence(view, t)}</span>
        {action && phase !== 'confirm' && (
          <span className={s.act}>
            <Button data-key="primary" disabled={phase === 'busy'} onClick={() => (action === 'deliver' ? setPhase('confirm') : void act(action))}>
              {t(ACTION_LABEL[action])}
            </Button>
          </span>
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

export interface OrderListProps {
  views: OrderView[];
  clients: ClientLite[] | undefined;
  /** Runs the engine lists: an order opens its newest run in the run sheet only when the engine can show it. */
  runIds: ReadonlySet<string>;
  onChanged: () => void;
}

/** Orders, newest first, each with its client, what they asked for, one state sentence and at most one action. */
export function OrderList({ views, clients, runIds, onChanged }: OrderListProps) {
  const t = useT();
  return (
    <ul className={s.list}>
      {views.map((view) => {
        const name = clients ? clients.find((c) => c.id === view.order.clientId)?.name ?? t('work.order.client') : '';
        return <OrderRow key={view.order.id} view={view} clientName={name} canOpen={!!view.run && runIds.has(view.run.id)} onChanged={onChanged} />;
      })}
    </ul>
  );
}
