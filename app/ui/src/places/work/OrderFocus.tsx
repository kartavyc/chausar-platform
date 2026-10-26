import { useId, useState } from 'react';
import { useT } from '../../text';
import { EmptyState } from '../../parts/EmptyState';
import { Row, StatusMark, type StatusTone } from '../../parts/Row';
import { SectionHead, Tile, TileHead } from '../../parts/Tile';
import type { ClientLite, DeliveryLite, QueueRow, RunSummary } from '../../engine/types';
import { OrderList, orderSentence } from './OrderList';
import { runStateOf, type OrderState, type OrderView } from './orders';
import { PreviousRuns } from './PreviousRuns';
import { ShareLinks } from './ShareLinks';
import { TranscribeButton } from './TranscribeButton';
import { PostButtons } from './PostButtons';
import { JudgeLine } from './JudgeLine';
import { CalendarFile } from './CalendarFile';
import s from './Work.module.css';

/** The status circle of a draft the engine lists no run for: what it says, by its icon as well as its colour. A draft
 *  still being made or not started has none. */
const DRAFT_MARK: Partial<Record<OrderState, StatusTone>> = {
  stopped: 'fail', returned: 'no', waiting: 'question', 'draft-ready': 'question', approved: 'ok', practice: 'ok',
  delivered: 'ok', invoiced: 'ok', paid: 'ok',
};

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
 * One order, from #/work?order=<id> (the Clients place links here): its client tile with the order's card (status,
 * price receipt, invoice, sentence and action), then every run made for it, newest first, in one tile. A run the
 * engine lists opens the run sheet; a draft it does not list is shown by its title and where it stands. Then the
 * order's own tiles: the judge, the preview link for the client, posting, and the calendar file.
 */
export function OrderFocus({ view, clients, deliveries, runs, queue, backHref, onChanged }: OrderFocusProps) {
  const t = useT();
  const orderId = useId();
  const runsId = useId();
  const shareId = useId();
  // Raised when the owner records a client's answer, so Post reads the engine again at once.
  const [answered, setAnswered] = useState(0);
  const back = <a className={s.back} href={backHref}>{t('work.focus.back')}</a>;
  if (!view) return <EmptyState title={t('work.focus.missing')} action={back} />;

  const mine = deliveries.filter((d) => d.orderId === view.order.id).sort((a, b) => b.at.localeCompare(a.at));
  const listed = mine.flatMap((d) => runs.filter((r) => r.runId === d.id));
  const unlisted = mine.filter((d) => !runs.some((r) => r.runId === d.id));
  const runIds = new Set(runs.map((r) => r.runId));
  const shareable = mine.filter((d) => !d.practice && d.deliverable !== null);

  return (
    <>
      <section aria-labelledby={orderId} className={s.block}>
        <SectionHead id={orderId} title={t('work.focus.order')} />
        <OrderList views={[view]} clients={clients} runIds={runIds} onChanged={onChanged} full />
        <TranscribeButton order={view.order} />
      </section>
      <Tile as="section" labelledBy={runsId}>
        <TileHead id={runsId} title={t('work.focus.runs')} />
        {mine.length === 0 ? <EmptyState title={t('work.focus.noRuns')} /> : (
          <>
            {listed.length > 0 && <PreviousRuns runs={listed} deliveries={deliveries} queue={queue} onChanged={onChanged} />}
            {unlisted.length > 0 && (
              <ul className={s.rows}>
                {unlisted.map((d) => {
                  const state = runStateOf(d, runs);
                  const mark = DRAFT_MARK[state];
                  return (
                    <Row
                      key={d.id} id={`draft-${d.id}`} dense mark={mark && <StatusMark tone={mark} />}
                      title={d.deliverable?.title ?? t('work.focus.draft')}
                      line={<span className={state === 'waiting' ? s.wait : undefined}>{orderSentence({ ...view, state, invoice: undefined }, t)}</span>}
                    />
                  );
                })}
              </ul>
            )}
          </>
        )}
      </Tile>
      <JudgeLine drafts={mine} onChanged={onChanged} />
      {shareable.length > 0 && (
        <Tile as="section" labelledBy={shareId}>
          <TileHead id={shareId} title={t('work.share.heading')} />
          <ShareLinks drafts={shareable} onAnswered={() => setAnswered((n) => n + 1)} />
        </Tile>
      )}
      <PostButtons drafts={shareable} version={answered} />
      <CalendarFile drafts={shareable} />
      <div>{back}</div>
    </>
  );
}
