import { useId, useState, type ReactNode } from 'react';
import { useT } from '../../text';
import { useEngine } from '../../engine/context';
import { Button } from '../../parts/Button';
import { cx } from '../../parts/cx';
import type { CheckLite, DeliveryLite, JudgePreview } from '../../engine/types';
import s from './Work.module.css';

/**
 * The rules judge on an order's drafts (Ink v2 wave 2, catalogue Q1's screen). The judge reads a ready draft once its
 * code checks pass, on the owner's own AI; by default it does so on its own for drafts that go to a client or the
 * public (the business's judge setting, Business > Practice and improve). Here:
 *   - a verdict the engine stored reads as the judge check's own detail, then the judge's line in the engine's words
 *     (for example that the owner edited the draft after the judge read it), and, when the judge ran on its own, a link
 *     to that setting; a failed one says Accept is blocked, in the engine's words (Today's Accept refuses it too);
 *   - a ready draft with no verdict offers "Ask the judge" (venture.delivery.judge), which shows the most the call may
 *     cost and that the client's words go with it, then "Send to the judge" (venture.delivery.judgeSend) with the
 *     digest read. A call already waiting shows its cost and its line right before Send: at the run's spend cap, or
 *     the automatic call waiting for the first consent with the setting's own words, since sending it is that consent.
 * Template outlines, drafts with a failed code check, practice drafts (now or at today's stage) and drafts not ready
 * show nothing: the judge does not read them.
 */

/** Where the business's judge setting lives. */
const SETTING = '#/business/practice';
const verdictOf = (draft: DeliveryLite): CheckLite | undefined => draft.checks?.find((c) => c.check === 'rules-judge');

/** Every code check passed (a check the engine marks not checked blocks nothing), as the judge needs. */
function codeChecksPassed(draft: DeliveryLite): boolean {
  return (draft.checks ?? []).every((c) => c.check === 'rules-judge' || c.passed || c.notChecked)
    && (draft.playbookChecks ?? []).every((c) => c.outcome !== 'fail');
}

function judgeShows(draft: DeliveryLite): boolean {
  if (draft.practice || draft.practiceNow || draft.servedBy === 'template' || !draft.deliverable) return false;
  return !!verdictOf(draft) || (draft.status === 'ready-for-review' && codeChecksPassed(draft));
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function JudgeLine({ drafts, onChanged }: { drafts: DeliveryLite[]; onChanged: () => void }) {
  const t = useT();
  const headingId = useId();
  const shown = drafts.filter(judgeShows);
  if (shown.length === 0) return null;
  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} className={s.heading}>{t('work.judge.heading')}</h2>
      <ul className={s.list}>
        {shown.map((draft) => <DraftJudge key={draft.id} draft={draft} onChanged={onChanged} />)}
      </ul>
    </section>
  );
}

function DraftJudge({ draft, onChanged }: { draft: DeliveryLite; onChanged: () => void }) {
  const t = useT();
  const client = useEngine();
  const [busy, setBusy] = useState<'ask' | 'send' | null>(null);
  const [asked, setAsked] = useState<JudgePreview | null>(null);
  const [sent, setSent] = useState<DeliveryLite | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  // What the send answered wins until the list the engine sends has a verdict of its own.
  const current = sent && !verdictOf(draft) ? sent : draft;
  const verdict = verdictOf(current);
  const held = current.judge;
  const waiting = verdict ? null : asked ?? (held?.status === 'waiting' && held.preview ? held.preview : null);

  async function ask() {
    setBusy('ask');
    setProblem(null);
    try {
      setAsked(await client.request('venture.delivery.judge', { runId: draft.id }));
    } catch (error) {
      setProblem(t('work.judge.askFailed', { message: messageOf(error) }));
    } finally {
      setBusy(null);
    }
  }

  async function send(digest: string) {
    setBusy('send');
    setProblem(null);
    try {
      setSent(await client.request('venture.delivery.judgeSend', { runId: draft.id, digest }));
    } catch (error) {
      setProblem(t('work.judge.sendFailed', { message: messageOf(error) }));
    } finally {
      // Sent or refused, the call read is spent here: what waits now is what the engine's list says.
      setAsked(null);
      setBusy(null);
      onChanged();
    }
  }

  let lines: ReactNode;
  let action: ReactNode = null;
  if (verdict) {
    const failed = !verdict.passed && !verdict.notChecked;
    const key = verdict.passed ? 'work.judge.passed' : verdict.notChecked ? 'work.judge.notChecked' : 'work.judge.failed';
    lines = (
      <>
        <span className={cx(s.state, failed && s.failure)}>{t(key, { detail: verdict.detail })}</span>
        {held?.line && <span className={s.quiet}>{held.line}</span>}
        {held?.auto && <span className={s.quiet}><a href={SETTING}>{t('work.judge.auto')}</a></span>}
        {failed && current.acceptBlocked && <span className={s.state}>{t('work.judge.blocked', { reason: current.acceptBlocked })}</span>}
      </>
    );
  } else if (waiting) {
    lines = (
      <>
        <span className={s.state}>{t('work.judge.cost', { cost: waiting.estimatedMaxCostDisplay })}</span>
        <span className={s.quiet}>{t('work.judge.clientData')}</span>
        {held?.status === 'waiting' && held.line && <span className={s.quiet} data-judge-words="">{held.line}</span>}
      </>
    );
    action = (
      <span className={s.act}>
        <Button variant="primary" disabled={busy !== null} onClick={() => void send(waiting.digest)}>{busy === 'send' ? t('work.judge.sending') : t('work.judge.send')}</Button>
      </span>
    );
  } else {
    lines = held?.status === 'failed' && held.line ? <span className={s.quiet}>{held.line}</span> : null;
    action = (
      <span className={s.act}>
        <Button disabled={busy !== null} onClick={() => void ask()}>{busy === 'ask' ? t('work.judge.asking') : t('work.judge.ask')}</Button>
      </span>
    );
  }

  return (
    <li className={s.item} data-row="" data-row-id={`judge-${draft.id}`} data-judge-line={draft.id} tabIndex={-1}>
      <span className={s.who} />
      <span className={s.what}>{draft.deliverable?.title}</span>
      <div className={s.tail}>
        {lines}
        {action}
      </div>
      {problem && <p className={s.problem} role="alert">{problem}</p>}
    </li>
  );
}
