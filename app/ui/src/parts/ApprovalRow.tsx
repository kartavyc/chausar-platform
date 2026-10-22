import { useEffect, useId, useRef, useState } from 'react';
import { useT } from '../text';
import { Button } from './Button';
import { Change } from './Change';
import { Field } from './Field';
import { Receipt } from './Receipt';
import { Row } from './Row';
import type { QueueAction, QueueDecision, QueueRow } from '../engine/types';
import s from './ApprovalRow.module.css';

/** Actions that open the thing to look at instead of deciding. Opening one counts as having viewed it. */
const VIEW_ACTIONS = new Set<QueueAction['id']>(['watch', 'read']);

export interface DecideExtra { viewed: boolean; answer?: string }

export interface ApprovalRowProps {
  row: QueueRow;
  /** Send the decision with the digest of what was shown (the row carries it). */
  onDecide: (row: QueueRow, action: QueueAction, extra: DecideExtra) => Promise<QueueDecision>;
  /** Open the draft, file, run or plan this row is about. */
  onView?: ((row: QueueRow) => void) | undefined;
  /** Whether the owner has opened it. Left out, the row tracks it from its own Watch or Read button. */
  viewed?: boolean | undefined;
  /** Open the row's detail in the sheet. */
  onOpen?: ((row: QueueRow, origin: HTMLElement) => void) | undefined;
  onReceipt?: ((id: string) => void) | undefined;
  /** Take an action that is not a decision (connect, set prices, keep: the engine refuses those as decisions, with
   *  NOT_A_DECISION). Return true when handled; anything else goes to onDecide. */
  onAction?: ((row: QueueRow, action: QueueAction) => boolean) | undefined;
  /** Name the business above the title. Today turns it off when only one business is listed. */
  showBusiness?: boolean | undefined;
}

type Phase = 'idle' | 'confirm' | 'answer' | 'sending' | 'decided';
type Notice = { kind: 'stale' | 'refused' | 'failed'; text: string } | null;

/**
 * One thing that needs the owner: business · agent, title, one line, an optional change, and two actions with the
 * primary filled and on the right. Money and other irreversible primaries ask a second time inside the row, and
 * keyboard A never runs them. An approval that needs a look first stays locked until the owner opens it. A stale
 * digest shows the new version; a decided row shrinks to one receipt line.
 */
export function ApprovalRow({ row, onDecide, onView, viewed, onOpen, onReceipt, onAction, showBusiness = true }: ApprovalRowProps) {
  const t = useT();
  const [current, setCurrent] = useState(row);
  const [phase, setPhase] = useState<Phase>('idle');
  const [pending, setPending] = useState<QueueAction | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [decided, setDecided] = useState<{ line: string; receiptId?: string | undefined } | null>(null);
  const [viewedHere, setViewedHere] = useState(false);
  const [answer, setAnswer] = useState('');
  const hintId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (phase !== 'decided') setCurrent(row);
    // A refreshed row with a new digest replaces the one on screen unless it was already decided.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.digest]);

  useEffect(() => {
    if (phase === 'confirm') cancelRef.current?.focus();
  }, [phase]);

  const isViewed = viewed ?? viewedHere;
  const primary = current.actions.find((a) => a.primary) ?? current.actions[0]!;
  const secondary = current.actions.find((a) => a !== primary);
  const locked = Boolean(primary.requiresView && !isViewed);
  const eyebrow = showBusiness ? (current.agent ? `${current.businessName} · ${current.agent}` : current.businessName) : (current.agent ?? '');

  async function decide(action: QueueAction, text?: string) {
    setPhase('sending');
    setNotice(null);
    try {
      const extra: DecideExtra = text === undefined ? { viewed: isViewed } : { viewed: isViewed, answer: text };
      const decision = await onDecide(current, action, extra);
      if (decision.outcome === 'done') {
        setDecided({ line: decision.line, receiptId: decision.receiptId });
        setPhase('decided');
      } else if (decision.outcome === 'stale') {
        if (decision.latest) setCurrent(decision.latest);
        setViewedHere(false);
        setNotice({ kind: 'stale', text: `${t('approval.stale')} ${t('approval.staleNew')}` });
        setPhase('idle');
      } else if (decision.reason === 'ALREADY_DECIDED' || decision.reason === 'RESOLVED_ELSEWHERE') {
        setDecided({ line: t('approval.elsewhere') });
        setPhase('decided');
      } else {
        if (decision.reason === 'VIEW_FIRST') setViewedHere(false);
        setNotice({ kind: 'refused', text: decision.line });
        setPhase('idle');
      }
    } catch (error) {
      setNotice({ kind: 'failed', text: t('approval.failed', { message: error instanceof Error ? error.message : String(error) }) });
      setPhase('idle');
    }
  }

  function choose(action: QueueAction) {
    if (VIEW_ACTIONS.has(action.id)) {
      onView?.(current);
      setViewedHere(true);
      return;
    }
    if (onAction?.(current, action)) return;
    if (action.id === 'answer') { setPhase('answer'); return; }
    if (action.secondAsk) { setPending(action); setPhase('confirm'); return; }
    void decide(action);
  }

  if (phase === 'decided' && decided) {
    const { line, receiptId } = decided;
    const text = receiptId ? (line.endsWith(receiptId) ? line.slice(0, -receiptId.length) : `${line} · `) : line;
    return (
      <li className={s.decided} data-row="" data-row-id={current.id} data-decided="" tabIndex={-1}>
        <span role="status">
          <span className={s.decidedTitle}>{current.title}</span>
          {' · '}
          {text}
          {receiptId && <Receipt id={receiptId} onOpen={onReceipt} />}
        </span>
      </li>
    );
  }

  const busy = phase === 'sending';
  const actions = phase === 'confirm' || phase === 'answer' ? null : (
    <>
      {secondary && (
        <Button data-key="secondary" disabled={busy} onClick={() => choose(secondary)}>
          {secondary.label}
        </Button>
      )}
      <Button variant={locked ? 'secondary' : 'primary'} data-key="primary" disabled={busy || locked} aria-describedby={locked ? hintId : undefined} onClick={() => choose(primary)}>
        {primary.label}
      </Button>
      {locked && <span id={hintId} className="sr-only">{t('approval.unlock', { action: primary.label })}</span>}
    </>
  );

  return (
    <Row
      id={current.id}
      eyebrow={eyebrow}
      title={current.title}
      line={current.line}
      secondAsk={Boolean(primary.secondAsk)}
      onOpen={onOpen ? (origin) => onOpen(current, origin) : undefined}
      actions={actions}
      className={busy ? s.sending : undefined}
    >
      {current.change && (
        <div className={s.change}>
          <Change {...current.change} onReceipt={onReceipt} />
        </div>
      )}
      {notice && (
        <p className={notice.kind === 'stale' ? s.notice : s.refusal} role="status">
          {notice.text}
        </p>
      )}
      {phase === 'confirm' && pending && (
        <div className={s.inline}>
          <p className={s.ask}>{t('approval.secondAsk', { action: pending.label })}</p>
          <div className={s.buttons}>
            <Button ref={cancelRef} onClick={() => { setPending(null); setPhase('idle'); }}>{t('approval.cancel')}</Button>
            <Button variant="primary" data-confirm="" onClick={() => void decide(pending)}>{pending.label}</Button>
          </div>
        </div>
      )}
      {phase === 'answer' && (
        <form className={s.inline} onSubmit={(event) => { event.preventDefault(); if (answer.trim()) void decide(primary, answer.trim()); }}>
          <Field label={t('approval.answerLabel')} value={answer} onChange={(event) => setAnswer(event.currentTarget.value)} autoFocus />
          <div className={s.buttons}>
            <Button onClick={() => setPhase('idle')}>{t('approval.cancel')}</Button>
            <Button variant="primary" type="submit" disabled={!answer.trim()}>{t('approval.answerSend')}</Button>
          </div>
        </form>
      )}
    </Row>
  );
}
