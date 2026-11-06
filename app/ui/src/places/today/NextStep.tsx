import { useId } from 'react';
import { useT } from '../../text';
import type { ApprovalPrimary } from '../../parts/ApprovalRow';
import { Avatar } from '../../parts/Avatar';
import { Button } from '../../parts/Button';
import { Figure } from '../../parts/Figure';
import { Icon } from '../../parts/Icon';
import { cx } from '../../parts/cx';
import type { GoalAmount } from './goal';
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
   * Press the row's primary. W4 4I wires this to the card's own ApprovalHandle (`pressPrimary`), so the second ask,
   * view before approve and the digest hold exactly as on the card; this tile never decides anything itself.
   */
  onPrimary: () => void;
}

/**
 * The next best step (D-Today `.next`): what to do first for the month's goal, its figure and what the goal becomes,
 * then Open and the one primary. Built and tested with props now; it is shown once the engine ranks rows by the goal
 * (placeholder until W4 4I).
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
