import { useEffect, useId, useState } from 'react';
import { useT } from '../../text';
import { primaryOf, type ApprovalHandle, type ApprovalPrimary } from '../../parts/ApprovalRow';
import { Avatar } from '../../parts/Avatar';
import { Button } from '../../parts/Button';
import { Figure } from '../../parts/Figure';
import { Icon } from '../../parts/Icon';
import { cx } from '../../parts/cx';
import type { NextBestStep, QueueRow } from '../../engine/types';
import { goalAmount, type GoalAmount } from './goal';
import { wordedRow } from './OutreachRows';
import s from './NextStep.module.css';

/** The one row the engine ranks first for the goal (W4 4I's next best step), as the tile beside the goal card. */
export interface NextStepData {
  /** The queue row it is about; the primary presses that row's own primary (see NextStepProps.onPrimary). */
  rowId: string;
  title: string;
  line?: string | undefined;
  agent?: string | undefined;
  business?: string | undefined;
  /** The row's amount, with its receipt. */
  total?: GoalAmount | undefined;
  /** The engine's words for the goal once this is done ("92%"). */
  goalAfter?: string | undefined;
}

export interface NextStepProps {
  data: NextStepData;
  /**
   * The row's primary exactly as its card holds it (ApprovalHandle.primary()): its words, whether it is locked until the
   * thing is opened and the note that says so, and whether it asks once more before anything goes out.
   */
  primary: ApprovalPrimary;
  /** Open the row's card (or the thing it is about). */
  onOpen: () => void;
  /**
   * Press the row's primary. TodayNextStep wires this to the card's own ApprovalHandle (`pressPrimary`), so the second ask,
   * view before approve and the digest hold exactly as on the card; this tile never decides anything itself.
   */
  onPrimary: () => void;
}

/**
 * The next best step (D-Today `.next`): what to do first for the month's goal, its figure and what the goal becomes,
 * then Open and the one primary. Today draws it from the engine's ranking through TodayNextStep, below (W4 4I2).
 */
export function NextStep({ data, primary, onOpen, onPrimary }: NextStepProps) {
  const t = useT();
  const titleId = useId();
  const noteId = useId();
  const who = [data.agent, data.business].filter(Boolean).join(' · ');
  // The card's own note: why it is locked, else that it asks once more.
  const note = primary.locked ? primary.note : primary.asksAgain ? t('today.next.asksAgain') : undefined;
  return (
    <section className={s.next} aria-labelledby={titleId} data-card="">
      <div className={s.top}>
        <span className={s.eyebrow}><Icon name="sparkles" size={14} />{t('today.next.eyebrow')}</span>
        {who && (
          <span className={s.who}>
            {data.agent && <Avatar name={data.agent} size={24} />}
            {who}
          </span>
        )}
      </div>
      <h2 id={titleId} className={s.title}>{data.title}</h2>
      {data.line && <p className={s.line}>{data.line}</p>}
      {(data.total || data.goalAfter) && (
        <div className={s.figures}>
          {data.total && (
            <div className={s.figure}>
              <span className={s.figureLabel}>{t('today.next.total')}</span>
              <Figure {...data.total} size="tile" />
            </div>
          )}
          {data.total && data.goalAfter && <Icon name="arrow-right" size={16} className={s.arrow} />}
          {data.goalAfter && (
            <div className={s.figure}>
              <span className={s.figureLabel}>{t('today.next.goalAfter')}</span>
              <span className={cx(s.after, 'mono')}>{data.goalAfter}</span>
            </div>
          )}
        </div>
      )}
      {note && (
        <p id={noteId} className={s.note}>
          <Icon name={primary.locked ? 'lock' : 'shield-check'} size={14} />
          {note}
        </p>
      )}
      <div className={s.acts}>
        <Button size="xl" onClick={onOpen}>{t('today.next.open')}</Button>
        <Button
          size="xl"
          variant="primary"
          locked={primary.locked}
          lockedReason={note}
          lockedNoteId={primary.locked && note ? noteId : undefined}
          aria-describedby={!primary.locked && note ? noteId : undefined}
          onClick={() => { if (!primary.locked) onPrimary(); }}
        >
          {primary.label}
          {!primary.locked && <Icon name="arrow-right" size={16} />}
        </Button>
      </div>
    </section>
  );
}

/** What Today lends the next best step: its cards, what the owner has opened, and the cards' own buttons. */
export interface NextStepHost {
  /** Today's rows as the cards show them now. */
  rows: readonly QueueRow[];
  /** The owner opened this version of the row in this session. */
  isViewed: (row: QueueRow) => boolean;
  /** The row was decided on this screen and shows as its receipt line. */
  isDecided: (id: string) => boolean;
  /** Bring the row's card into view and focus it (a filter or the fold that hides it opens). */
  goToRow: (id: string) => void;
  /** Open the thing the row is about, as its card's Watch or Read does (it counts as viewed). */
  look: (row: QueueRow) => void;
  /** The card's own buttons, once its card is drawn. */
  handleOf: (id: string) => ApprovalHandle | undefined;
}

/**
 * The engine's next best step (venture.goals.get `next`) on Today, beside the goal card. Its primary is the row's card
 * primary, worded and locked as that card is (primaryOf). Pressing it brings the card into view and presses the card's
 * own button through its handle, so view before approve, the second ask and the digest hold exactly as on the card:
 * a second ask opens inside the card, and this tile decides nothing itself. Open opens what the row is about, or its card.
 * The engine ranks only the open business's rows, so the tile names the agent and not the business.
 */
export function TodayNextStep({ step, row, host, folded = false }: { step: NextBestStep; row: QueueRow; host: NextStepHost; folded?: boolean }) {
  const t = useT();
  const [pending, setPending] = useState<string | null>(null);
  // Press once the card is on screen: it may sit behind a filter or the fold until goToRow opens them.
  useEffect(() => {
    if (!pending) return;
    const handle = host.handleOf(pending);
    if (handle) {
      setPending(null);
      handle.pressPrimary();
    } else if (!host.rows.some((r) => r.id === pending)) setPending(null);
  });
  const total = goalAmount(step.figure);
  // 4Z2: the card's own words for its buttons (Hindi included), as the card itself shows them.
  const primary = primaryOf(wordedRow(row, t), host.isViewed(row), t);
  const press = () => { setPending(row.id); host.goToRow(row.id); };
  if (folded) return <FoldedStep title={row.title} total={total ?? undefined} primary={primary} onPrimary={press} />;
  // The row's own line and "asks you once more" are on its card already: the tile says neither again (words).
  const data: NextStepData = {
    rowId: row.id, title: row.title, agent: step.agent ?? row.agent,
    ...(total ? { total } : {}),
    ...(step.goalAfterPercent !== null ? { goalAfter: `${step.goalAfterPercent}%` } : {}),
  };
  return (
    <NextStep
      data={data}
      primary={{ ...primary, asksAgain: false }}
      onOpen={() => (row.viewRef ? host.look(row) : host.goToRow(row.id))}
      onPrimary={press}
    />
  );
}

/**
 * The next best step folded into the goal card on a phone (D-Phone-Today): "Next best step", the row's title and its
 * figure on one line, and the card's one filled button, the row's own primary (locked and worded as its card).
 */
function FoldedStep({ title, total, primary, onPrimary }: { title: string; total?: GoalAmount | undefined; primary: ApprovalPrimary; onPrimary: () => void }) {
  const t = useT();
  const noteId = useId();
  return (
    <div className={s.folded} data-next-folded="">
      <p className={s.foldedEyebrow}>{t('today.next.eyebrow')}</p>
      <p className={s.foldedLine}>
        <span>{title}</span>
        {total && <Figure {...total} tone="dark" />}
      </p>
      {primary.locked && primary.note && <p id={noteId} className={s.foldedNote}><Icon name="lock" size={14} />{primary.note}</p>}
      <Button
        size="xl"
        variant="primary"
        locked={primary.locked}
        lockedReason={primary.note}
        lockedNoteId={primary.locked && primary.note ? noteId : undefined}
        onClick={() => { if (!primary.locked) onPrimary(); }}
      >
        {primary.label}
        {!primary.locked && <Icon name="arrow-right" size={16} />}
      </Button>
    </div>
  );
}
