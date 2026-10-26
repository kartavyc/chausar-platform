import { useEffect, useId, useRef, useState, type MouseEvent } from 'react';
import { useT } from '../text';
import type { DeptId } from './Avatar';
import { Button } from './Button';
import { cx } from './cx';
import { Icon } from './Icon';
import { rich } from './rich';
import s from './DiffCard.module.css';

/** One line of an agent's instructions: unchanged (shown for context), added by the change, or removed by it. */
export interface DiffLine {
  kind: 'same' | 'added' | 'removed';
  text: string;
}

export interface DiffCardProps {
  /** The agent whose instructions change ("Editor"). */
  agent: string;
  dept?: DeptId | undefined;
  /** When the change applies, in the engine's words ("Applies to every short from now on"). */
  appliesTo: string;
  /** The changed lines with the lines around them, in order: a removed line just before the line that replaces it. */
  lines: readonly DiffLine[];
  /** The instructions version the change was drafted against, and the version accepting it makes. */
  fromVersion: number | string;
  toVersion: number | string;
  /** Each decision goes to the engine; the card waits while it is on its way and says why if it fails. */
  onAccept: () => Promise<void>;
  onReject: () => Promise<void>;
  /** Points the business back at the earlier version. Required: the card promises "you can undo". */
  onUndo: () => Promise<void>;
  /** The engine is busy with this proposal for another reason: every button waits. */
  busy?: boolean | undefined;
  /** The instructions moved on since this was drafted (spec 8): it can no longer be accepted. */
  stale?: boolean | undefined;
  /** W4 4B3: the engine's own words for a stale proposal ("This was drafted against version 4; ..."), shown instead
   *  of the card's general line. */
  staleLine?: string | undefined;
  /** What the owner decided, once the engine has it. `undone`: accepted, then put back. */
  decided?: 'accepted' | 'rejected' | 'undone' | undefined;
  className?: string | undefined;
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * A "from now on" request, turned into a proposed change to an agent's instructions (spec 5.2; D's `.prop`,
 * `.diff`, `.dl`, `.ver`). Before and after are unmistakable: a removed line is struck through on red with
 * "Removed:" in words, an added line is on green with "Added:" in words, and the lines around them stay plain.
 * The version step and the promise of undo sit under it. Reject is the secondary and Accept the card's one primary;
 * a stale proposal offers neither and says why. A decision is sent once however fast it is pressed; while it is on
 * its way every button waits, a failure says why and gives focus back to the button pressed, and once the engine
 * has the decision the outcome line (a status) takes focus, so focus is never dropped to the page.
 */
export function DiffCard({
  agent, dept, appliesTo, lines, fromVersion, toVersion, onAccept, onReject, onUndo, busy = false, stale = false, staleLine, decided, className,
}: DiffCardProps) {
  const t = useT();
  const id = useId();
  const outcome = useRef<HTMLParagraphElement>(null);
  /** Set the moment a decision starts, before React re-renders, so a second press can never send twice. */
  const inFlight = useRef(false);
  /** The owner decided here, so the outcome may take focus; a decision that arrives from elsewhere does not. */
  const acted = useRef(false);
  const focusBack = useRef<HTMLButtonElement | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (decided !== undefined && acted.current) {
      acted.current = false;
      outcome.current?.focus();
    }
  }, [decided]);
  useEffect(() => {
    if (!waiting && focusBack.current) {
      focusBack.current.focus();
      focusBack.current = null;
    }
  }, [waiting]);

  async function decide(action: () => Promise<void>, event: MouseEvent<HTMLButtonElement>) {
    if (inFlight.current || busy) return;
    const pressed = event.currentTarget;
    inFlight.current = true;
    acted.current = true;
    setWaiting(true);
    setError(null);
    try {
      await action();
    } catch (failure) {
      acted.current = false;
      focusBack.current = pressed;
      setError(messageOf(failure));
    } finally {
      inFlight.current = false;
      setWaiting(false);
    }
  }

  const open = !stale && decided === undefined;
  const held = busy || waiting;
  const outcomeLine = (key: string, values: Record<string, string | number>, tone?: 'done') => (
    <p ref={outcome} className={s.note} data-tone={tone} role="status" tabIndex={-1}>{t(key, values)}</p>
  );
  return (
    <article className={cx(s.card, className)} aria-labelledby={id} data-card="" data-decided={decided}>
      <div className={s.head}>
        <span className={s.icon} data-dept={dept ?? 'none'} aria-hidden="true">
          <Icon name="file-pen" size={18} />
        </span>
        <div className={s.headText}>
          <h3 id={id} className={s.title}>{t('diff.title', { name: agent })}</h3>
          <p className={s.applies}>{appliesTo}</p>
        </div>
      </div>
      <div className={s.diff} role="group" aria-label={t('diff.lines')}>
        {lines.map((line, index) => (
          // The lines quote the agent's instructions, so an amount in them is quoted words, not a figure Chausar states.
          <p key={index} className={s.line} data-line={line.kind} data-content="">
            <span className={cx(s.sign, 'mono')} aria-hidden="true">
              {line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ''}
            </span>
            {line.kind === 'same' ? (
              <span className={s.text}>{line.text}</span>
            ) : (
              <span className={s.text}>
                <span className={s.word}>{t(line.kind === 'added' ? 'diff.added' : 'diff.removed')}</span>{' '}
                {line.kind === 'added' ? <ins className={s.changed}>{line.text}</ins> : <del className={s.changed}>{line.text}</del>}
              </span>
            )}
          </p>
        ))}
      </div>
      {open && (
        <p className={s.version} data-version="">
          <Icon name="history" size={14} />
          <span>
            {rich(t, 'diff.version', {}, {
              from: <span className="mono">{fromVersion}</span>,
              to: <span className="mono">{toVersion}</span>,
            })}
          </span>
        </p>
      )}
      {stale && decided === undefined && <p className={s.note} data-tone="wait">{staleLine ?? t('diff.stale')}</p>}
      {open && (
        <div className={s.actions}>
          <Button onClick={(event) => void decide(onReject, event)} disabled={held}>{t('diff.reject')}</Button>
          <Button variant="primary" onClick={(event) => void decide(onAccept, event)} disabled={held}>
            <Icon name="check" size={16} />
            {t('diff.accept')}
          </Button>
        </div>
      )}
      {decided === 'accepted' && (
        <div className={s.decided}>
          {outcomeLine('diff.accepted', { name: agent, to: toVersion }, 'done')}
          <Button size="sm" onClick={(event) => void decide(onUndo, event)} disabled={held}>
            <Icon name="rotate-ccw" size={14} />
            {t('diff.undo')}
          </Button>
        </div>
      )}
      {decided === 'rejected' && outcomeLine('diff.rejected', {})}
      {decided === 'undone' && outcomeLine('diff.undone', { name: agent, from: fromVersion })}
      {error !== null && <p className={s.error} role="alert">{t('diff.failed', { message: error })}</p>}
    </article>
  );
}
