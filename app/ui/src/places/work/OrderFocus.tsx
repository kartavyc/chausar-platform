import { useId, type ReactNode } from 'react';
import { useT } from '../../text';
import { EmptyState } from '../../parts/EmptyState';
import { Receipt } from '../../parts/Receipt';
import { cx } from '../../parts/cx';
import type { ClientLite, DeliveryLite, QueueRow, RunSummary } from '../../engine/types';
import { OrderList, orderSentence } from './OrderList';
import { runStateOf, type OrderView } from './orders';
import { PreviousRuns } from './PreviousRuns';
import { ShareLinks } from './ShareLinks';
import s from './Work.module.css';

function Block({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className={s.heading}>{title}</h2>
      {children}
    </section>
  );
}

export interface OrderFocusProps {
  view: OrderView | undefined;
  clients: ClientLite[] | undefined;
  deliveries: DeliveryLite[];
  runs: RunSummary[];
  queue: QueueRow[] | undefined;
  backHref: string;
  onChanged: () => void;
}

/**
 * One order, from #/work?order=<id> (the Clients place links here): its row with state sentence and action, the
 * receipt behind its price, and every run made for it, newest first. A run the engine lists opens the run sheet;
 * a draft it does not list is shown by its title and where it stands. Each real draft can be shared with the client
 * as a preview link, when the engine has an address for one.
 */
export function OrderFocus({ view, clients, deliveries, runs, queue, backHref, onChanged }: OrderFocusProps) {
  const t = useT();
  const back = <a className={s.filter} href={backHref}>{t('work.focus.back')}</a>;
  if (!view) return <EmptyState title={t('work.focus.missing')} action={back} />;

  const mine = deliveries.filter((d) => d.orderId === view.order.id).sort((a, b) => b.at.localeCompare(a.at));
  const listed = mine.flatMap((d) => runs.filter((r) => r.runId === d.id));
  const unlisted = mine.filter((d) => !runs.some((r) => r.runId === d.id));
  const runIds = new Set(runs.map((r) => r.runId));
  const shareable = mine.filter((d) => !d.practice && d.deliverable !== null);

  return (
    <>
      <Block title={t('work.focus.order')}>
        <OrderList views={[view]} clients={clients} runIds={runIds} onChanged={onChanged} />
        <p className={s.note}>{t('work.focus.price')} <Receipt id={view.order.priceReceiptId} /></p>
      </Block>
      <Block title={t('work.focus.runs')}>
        {mine.length === 0 ? <EmptyState title={t('work.focus.noRuns')} /> : (
          <>
            {listed.length > 0 && <PreviousRuns runs={listed} deliveries={deliveries} queue={queue} onChanged={onChanged} />}
            {unlisted.length > 0 && (
              <ul className={s.list}>
                {unlisted.map((d) => {
                  const state = runStateOf(d, runs);
                  return (
                    <li key={d.id} className={s.item} data-row="" data-row-id={`draft-${d.id}`} tabIndex={-1}>
                      <span className={s.who} />
                      <span className={s.what}>{d.deliverable?.title ?? t('work.focus.draft')}</span>
                      <div className={s.tail}>
                        <span className={cx(s.state, state === 'waiting' && s.wait)}>{orderSentence({ ...view, state, invoice: undefined }, t)}</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </Block>
      {shareable.length > 0 && <Block title={t('work.share.heading')}><ShareLinks drafts={shareable} /></Block>}
      <div>{back}</div>
    </>
  );
}
