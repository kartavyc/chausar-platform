import { useEffect, useId, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from 'react';
import { useLanguage, useT, type Language, type T } from '../text';
import { Avatar, ChausarAvatar, type AvatarState, type DeptId } from './Avatar';
import { Button, type ButtonSize } from './Button';
import { Change } from './Change';
import { cx } from './cx';
import { Field } from './Field';
import { Icon } from './Icon';
import type { IconName } from './icons';
import { Receipt } from './Receipt';
import { Row } from './Row';
import { stateText } from './states';
import type { QueueAction, QueueDecision, QueueKind, QueueList, QueueRow } from '../engine/types';
import s from './ApprovalRow.module.css';

/** Actions that open the thing to look at instead of deciding. Opening one counts as having viewed it. */
const VIEW_ACTIONS = new Set<QueueAction['id']>(['watch', 'read']);

/**
 * row: one line in a list (v1; keyboard rows). card: Today's big card with a preview (D's `.qcard`). compact: the
 * smaller card of the row of four (D's `.qk`). Every layout keeps the same behaviour: the second ask, view before
 * approve, the digest, the read-back after a timeout and the engine's own words for a refusal.
 */
export type ApprovalLayout = 'row' | 'card' | 'compact';

/** The icon beside each kind's words on a card (the same as Chip.tsx's KIND_ICONS, 3B1b). Kinds are labels, not
 *  states, so none of them is coloured; only the card of a run that really stopped is (in the fail tone). */
const KIND_ICON: Record<QueueKind, IconName> = {
  draft: 'file-pen',
  price: 'tag',
  quote: 'file-text',
  plan: 'target',
  invoice: 'receipt-text',
  signoff: 'stamp',
  question: 'circle-help',
  setup: 'sliders-horizontal',
  locked: 'lock',
  connector: 'send',
  bank: 'wallet',
};

/** The icon a primary carries on a card when it is not locked (D's Approve check, Run again arrow). */
const ACTION_ICON: Partial<Record<QueueAction['id'], IconName>> = { approve: 'check', 'run-again': 'rotate-ccw', 'send-to-ca': 'send' };

/** The time of day a row came in (createdAt), as the reader's clock writes it: "08:40". Empty for a bad date. */
export function timeOf(at: string, language: Language): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(language === 'hi' ? 'hi-IN' : 'en-IN', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
}

export interface DecideExtra { viewed: boolean; answer?: string }

/** The primary as the owner sees it now: its words, whether it is locked and why, and whether it asks once more. */
export interface ApprovalPrimary { label: string; locked: boolean; note: string | undefined; asksAgain: boolean }

/**
 * What pressing through the handle did. This is the one place the type lives; the phone's swipe imports it.
 *   pressed  a decision is on its way
 *   asking   the second ask or the answer box opened (or was open already); nothing was decided
 *   opened   the thing to look at (or the place where it is done) opened; nothing was decided
 *   locked   nothing: the primary is locked until the owner looks first
 *   busy     nothing: a decision is already on its way
 *   none     nothing: decided already, or the row has no such action
 */
export type PressResult = 'pressed' | 'asking' | 'opened' | 'locked' | 'busy' | 'none';

/**
 * How something outside the card (the phone's swipe) presses its buttons. It goes through the card's own path, so it
 * can never skip what a click could not: a locked primary stays locked, a second ask opens inside the card and
 * decides nothing, pressing again while it asks only keeps it asking, and a second press while a decision is on its
 * way sends nothing.
 */
export interface ApprovalHandle {
  primary(): ApprovalPrimary;
  pressPrimary(): PressResult;
  /** Press Later, when the row has it. */
  pressLater(): PressResult;
}

export interface ApprovalRowProps {
  row: QueueRow;
  /** Send the decision with the digest of what was shown (the row carries it). */
  onDecide: (row: QueueRow, action: QueueAction, extra: DecideExtra) => Promise<QueueDecision>;
  /** Open the draft, file, run or plan this row is about. */
  onView?: ((row: QueueRow) => void) | undefined;
  /** Whether the owner has opened this version of it (the place keys it by the row's digest). Left out, the row tracks
   *  it from its own Watch or Read button. It speaks only for the version passed in as `row`. */
  viewed?: boolean | undefined;
  /** Open the row's detail in the sheet. */
  onOpen?: ((row: QueueRow, origin: HTMLElement) => void) | undefined;
  onReceipt?: ((id: string) => void) | undefined;
  /** Take an action that is not a decision (connect, set prices, keep: the engine refuses those as decisions, with
   *  NOT_A_DECISION). Return true when handled; anything else goes to onDecide. */
  onAction?: ((row: QueueRow, action: QueueAction) => boolean) | undefined;
  /** Name the business above the title. Today turns it off when only one business is listed. */
  showBusiness?: boolean | undefined;
  /** When a decision times out (REQUEST_TIMEOUT), read back what the engine holds for the row (see readBack) instead
   *  of saying "Couldn't send". Left out, or if the read-back fails too, the row says "Couldn't send". */
  onReread?: ((row: QueueRow) => Promise<QueueDecision>) | undefined;
  /** Left out: a row. */
  layout?: ApprovalLayout | undefined;
  /** The state of the agent's run (cards only): its avatar's ring, and "Stopped" on the card when the run failed. */
  agentState?: AvatarState | undefined;
  /** The agent's department, which tints its avatar (W4 4A sends it). */
  dept?: DeptId | undefined;
  /** Beside the agent's name on a card: the department chip, once the engine sends departments (W4 4A). */
  nameTag?: ReactNode;
  /** What a card shows to look at: a video frame, a paper, quoted text. Given as a function it receives `view`, which
   *  opens the thing exactly as Watch or Read does and counts as viewed. Drawing a preview never counts as viewed. */
  preview?: ReactNode | ((view: () => void) => ReactNode);
  /** For the phone's swipe: press the card's own buttons (see ApprovalHandle). */
  handle?: Ref<ApprovalHandle> | undefined;
  /** The cards' button size. Left out: lg on a card, sm on a compact card. The phone asks for xl (3H1), so every
   *  button on a phone card is a full touch target. */
  buttonSize?: ButtonSize | undefined;
}

type Phase = 'idle' | 'confirm' | 'answer' | 'sending' | 'decided';
type Notice = { kind: 'stale' | 'refused' | 'failed'; text: string } | null;

const isTimeout = (error: unknown) => (error as { code?: unknown } | null)?.code === 'REQUEST_TIMEOUT';

/**
 * What the engine holds for a row whose decision timed out, read from a fresh queue list. Gone from the list: the
 * engine took a decision for it (this one, after the wait, or one made elsewhere). A new digest: it changed, so it is
 * shown again as stale. The same row: nothing was recorded yet. It never sends the decision a second time.
 */
export function readBack(list: QueueList, row: QueueRow, t: T): QueueDecision {
  const now = list.rows.find((r) => r.id === row.id);
  if (!now) return { outcome: 'done', line: t('approval.afterWait') };
  if (now.digest !== row.digest) return { outcome: 'stale', line: t('approval.stale'), latest: now };
  return { outcome: 'refused', reason: 'NOT_RECORDED', line: t('approval.notYet') };
}

/**
 * One thing that needs the owner: business · agent, title, one line, an optional change, and its actions with the
 * primary filled and on the right. Money and other irreversible primaries ask a second time inside the row, and
 * keyboard A never runs them. An approval that needs a look first stays locked until the owner opens it. A new
 * version (a stale decision, or a refresh with a new digest) replaces the one on screen, closes any open ask and has
 * to be looked at again; a decided row shrinks to one receipt line. A decision that timed out is read back (onReread)
 * before the row says it couldn't send. Only one decision is ever on its way at a time.
 *
 * As a card (Ink v2, D-Today's `.qcard`) it adds the agent's avatar, the business and time, the kind, a preview and a
 * note line that says in words why the primary is locked or that it asks once more; its buttons are large and share
 * the width. A compact card (`.qk`) keeps all of it smaller. A card is an `article` that still carries `data-row`, so
 * J, K and Enter move through cards as through rows. The engine's line is never cut short.
 */
export function ApprovalRow({
  row, onDecide, onView, viewed, onOpen, onReceipt, onAction, showBusiness = true, onReread,
  layout = 'row', agentState, dept, nameTag, preview, handle, buttonSize,
}: ApprovalRowProps) {
  const t = useT();
  const language = useLanguage();
  const [current, setCurrent] = useState(row);
  const [phase, setPhase] = useState<Phase>('idle');
  const [pending, setPending] = useState<QueueAction | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [decided, setDecided] = useState<{ line: string; receiptId?: string | undefined } | null>(null);
  const [viewedHere, setViewedHere] = useState(false);
  const [answer, setAnswer] = useState('');
  const [sending, setSending] = useState<QueueAction['id'] | null>(null);
  const hintId = useId();
  const noteId = useId();
  const titleId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const decidedRef = useRef<HTMLElement | null>(null);
  const backToPrimary = useRef(false);
  const focusDecided = useRef(false);
  // Set before the decision is sent and checked by every way in (click, confirm, handle, keys), so two presses in the
  // same moment send one decision: state alone would let the second one through before the first re-renders.
  const inFlight = useRef(false);

  const staleWords = layout === 'row' ? `${t('approval.stale')} ${t('approval.staleNew')}` : t('approval.staleHere');

  useEffect(() => {
    // A refresh with a new digest is a new version: it replaces the one on screen unless it was decided, closes the
    // second ask or answer box (whose confirm would otherwise send the new version unseen), says so, and has to be
    // looked at again. A decision already on its way answers for the version it was sent with.
    if (phase === 'decided' || row.digest === current.digest) return;
    setCurrent(row);
    setViewedHere(false);
    if (phase === 'sending') return;
    setPending(null);
    setPhase('idle');
    setNotice({ kind: 'stale', text: staleWords });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.digest]);

  useEffect(() => {
    if (phase === 'confirm') cancelRef.current?.focus();
    else if (phase === 'idle' && backToPrimary.current) {
      // "Not now" (in the second ask or the answer box) puts focus back on the button that opened it.
      backToPrimary.current = false;
      primaryRef.current?.focus();
    } else if (phase === 'decided' && focusDecided.current) {
      // Decided from inside the card: focus stays on its one-line result, not lost to the page.
      focusDecided.current = false;
      decidedRef.current?.focus();
    }
  }, [phase]);

  // The place's `viewed` speaks for the version it passed in. A newer version shown here (after a stale decision,
  // before the place catches up) counts as viewed only once it is opened here.
  const isViewed = current.digest === row.digest ? (viewed ?? viewedHere) : viewedHere;
  const primary = current.actions.find((a) => a.primary) ?? current.actions[0]!;
  const others = current.actions.filter((a) => a !== primary);
  const locked = Boolean(primary.requiresView && !isViewed);
  const viewAction = current.actions.find((a) => VIEW_ACTIONS.has(a.id))?.id;
  // The note names a one-word action, as D does ("Approve unlocks after you watch it"); a longer one ("Send to CA") is
  // on the button beside it, so the note just says when it unlocks and the card keeps to 12 words of its own (w3 3I).
  const viewWord = viewAction === 'watch' ? 'Watch' : viewAction === 'read' ? 'Read' : 'Open';
  const lockNote = locked
    ? (primary.label.trim().split(/\s+/).length > 1 ? t(`approval.unlocksAfter${viewWord}`) : t(`approval.unlock${viewWord}`, { action: primary.label }))
    : undefined;
  const eyebrow = showBusiness ? (current.agent ? `${current.businessName} · ${current.agent}` : current.businessName) : (current.agent ?? '');
  const focusInside = () => (document.activeElement as HTMLElement | null)?.closest?.('[data-row-id]')?.getAttribute('data-row-id') === current.id;

  async function decide(action: QueueAction, text?: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    focusDecided.current = focusInside();
    let finished = false;
    setSending(action.id);
    setPhase('sending');
    setNotice(null);
    try {
      const extra: DecideExtra = text === undefined ? { viewed: isViewed } : { viewed: isViewed, answer: text };
      let decision: QueueDecision;
      try {
        decision = await onDecide(current, action, extra);
      } catch (error) {
        // The window stopped waiting, but the engine may have decided it since: read back what it holds.
        const read = isTimeout(error) && onReread ? await onReread(current).catch(() => null) : null;
        if (!read) throw error;
        decision = read;
      }
      if (decision.outcome === 'done') {
        finished = true;
        setDecided({ line: decision.line, receiptId: decision.receiptId });
        setPhase('decided');
      } else if (decision.outcome === 'stale') {
        if (decision.latest) setCurrent(decision.latest);
        setViewedHere(false);
        // A card shows the new version in place; a row shows it below the words.
        setNotice({ kind: 'stale', text: staleWords });
        setPhase('idle');
      } else if (decision.reason === 'ALREADY_DECIDED' || decision.reason === 'RESOLVED_ELSEWHERE') {
        finished = true;
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
    } finally {
      // A decided row stays closed to presses for good; otherwise the owner may decide again.
      if (!finished) {
        inFlight.current = false;
        focusDecided.current = false;
      }
    }
  }

  /** Open the thing to look at. It counts as viewed, the same from Watch, Read or a preview's own button. */
  function view() {
    onView?.(current);
    setViewedHere(true);
  }

  function choose(action: QueueAction): PressResult {
    if (VIEW_ACTIONS.has(action.id)) { view(); return 'opened'; }
    if (inFlight.current) return 'busy';
    if (onAction?.(current, action)) return 'opened';
    if (action.id === 'answer') { setPhase('answer'); return 'asking'; }
    if (action.secondAsk) { setPending(action); setPhase('confirm'); return 'asking'; }
    void decide(action);
    return 'pressed';
  }

  function cancel() {
    setPending(null);
    backToPrimary.current = true;
    setPhase('idle');
  }

  /** The same path as a click: nothing while locked, sending or asking. */
  function press(action: QueueAction): PressResult {
    if (phase === 'decided') return 'none';
    if (inFlight.current || phase === 'sending') return 'busy';
    if (phase === 'confirm' || phase === 'answer') return 'asking';
    if (action === primary && locked) return 'locked';
    return choose(action);
  }

  useImperativeHandle(handle, () => ({
    primary: () => ({ label: primary.label, locked, note: lockNote, asksAgain: Boolean(primary.secondAsk) }),
    pressPrimary: () => press(primary),
    pressLater: () => {
      const later = current.actions.find((a) => a.id === 'later');
      return later ? press(later) : 'none';
    },
  }));

  const keepDecided = (element: HTMLElement | null) => { decidedRef.current = element; };

  if (phase === 'decided' && decided) {
    const { line, receiptId } = decided;
    const text = receiptId ? (line.endsWith(receiptId) ? line.slice(0, -receiptId.length) : `${line} · `) : line;
    const status = (
      <span role="status">
        <span className={s.decidedTitle}>{current.title}</span>
        {' · '}
        {text}
        {receiptId && <Receipt id={receiptId} onOpen={onReceipt} />}
      </span>
    );
    if (layout === 'row') {
      return <li ref={keepDecided} className={s.decided} data-row="" data-row-id={current.id} data-decided="" tabIndex={-1}>{status}</li>;
    }
    return (
      <article ref={keepDecided} className={cx(s.decided, s.decidedCard)} data-row="" data-row-id={current.id} data-decided="" data-layout={layout} tabIndex={-1}>
        {status}
      </article>
    );
  }

  const busy = phase === 'sending';
  const notices = (
    <>
      {/* An outside action whose description does not show all it will send says so (W1 H21). */}
      {current.descriptionComplete === false && <p className={s.notice}>{t('approval.incomplete')}</p>}
      {/* A post going out drives a browser window on this computer: the owner keeps their hands off it (K1). */}
      {busy && current.kind === 'connector' && sending === 'approve' && <p className={s.notice} role="status">{t('today.posting.inProgress')}</p>}
      {notice && (
        <p className={notice.kind === 'stale' ? s.notice : s.refusal} role="status">
          {notice.text}
        </p>
      )}
    </>
  );

  /** Every action but the primary, in the engine's order: the first answers keyboard D, any more (Read beside Reject
   *  and Send to CA) are there to click. */
  const otherKey = (index: number) => (index === 0 ? 'secondary' : 'more');

  if (layout === 'row') {
    const actions = phase === 'confirm' || phase === 'answer' ? null : (
      <>
        {others.map((action, index) => (
          <Button key={action.id} data-key={otherKey(index)} disabled={busy} onClick={() => choose(action)}>
            {action.label}
          </Button>
        ))}
        {/* The lock is Button's own (locked: aria-disabled, the lock icon, the reason in its description), so a
            locked primary reads and acts the same in a row and on a card. It is still the row's one primary. */}
        <Button
          ref={primaryRef}
          variant="primary"
          data-key="primary"
          disabled={busy}
          locked={locked}
          lockedReason={t('approval.unlock', { action: primary.label })}
          lockedNoteId={hintId}
          onClick={() => { if (!locked) choose(primary); }}
        >
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
        line={current.line ? <span data-engine-line="" data-content={current.kind === 'question' ? '' : undefined}>{current.line}</span> : undefined}
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
        {notices}
        {phase === 'confirm' && pending && (
          <div className={s.inline}>
            <p className={s.ask}>{t('approval.secondAsk', { action: pending.label })}</p>
            <div className={s.buttons}>
              <Button ref={cancelRef} onClick={cancel}>{t('approval.cancel')}</Button>
              <Button variant="primary" data-confirm="" onClick={() => void decide(pending)}>{pending.label}</Button>
            </div>
          </div>
        )}
        {phase === 'answer' && (
          <form className={s.inline} onSubmit={(event) => { event.preventDefault(); if (answer.trim()) void decide(primary, answer.trim()); }}>
            <Field label={t('approval.answerLabel')} value={answer} onChange={(event) => setAnswer(event.currentTarget.value)} autoFocus />
            <div className={s.buttons}>
              <Button onClick={cancel}>{t('approval.cancel')}</Button>
              <Button variant="primary" type="submit" disabled={!answer.trim()}>{t('approval.answerSend')}</Button>
            </div>
          </form>
        )}
      </Row>
    );
  }

  // Cards: Today's big card and the compact one.
  const compact = layout === 'compact';
  const size: ButtonSize = buttonSize ?? (compact ? 'sm' : 'lg');
  // "Stopped" only when the run really failed: an expired draft also offers Run again, but nothing stopped.
  const stopped = primary.id === 'run-again' && agentState === 'failed';
  const tone = stopped ? 'fail' : primary.id === 'answer' ? 'wait' : undefined;
  const kindWords = stopped ? stateText(t, 'run', 'failed') : stateText(t, 'queue', current.kind);
  const kindIcon: IconName = stopped ? 'triangle-alert' : KIND_ICON[current.kind] ?? 'file-text';
  const name = current.agent ?? t('app.name');
  const time = timeOf(current.createdAt, language);
  const note = lockNote ?? (primary.secondAsk ? t('approval.asksAgain') : current.kind === 'plan' ? t('approval.nothingYet') : undefined);
  const previewNode = typeof preview === 'function' ? preview(view) : preview;
  const primaryIcon = ACTION_ICON[primary.id];
  const avatar = (px: 24 | 40) => (current.agent ? <Avatar name={current.agent} dept={dept} state={agentState} size={px} /> : <ChausarAvatar size={px} />);
  const meta = (
    <>
      {showBusiness && current.businessName}
      {showBusiness && time && ' · '}
      {time && <span className="mono">{time}</span>}
    </>
  );

  return (
    <article
      className={cx(s.card, compact && s.compact, busy && s.sending)}
      data-card=""
      data-row=""
      data-row-id={current.id}
      data-layout={layout}
      data-tone={stopped ? 'fail' : undefined}
      data-second-ask={primary.secondAsk ? '' : undefined}
      tabIndex={-1}
      aria-labelledby={titleId}
    >
      {compact ? (
        <>
          <header className={s.top}>
            <span className={s.kindBox} data-tone={tone}>
              <Icon name={kindIcon} size={18} label={kindWords} />
            </span>
            <span className={s.whoSmall}>
              {avatar(24)}
              <span className={s.nameText}>{name}</span>
            </span>
          </header>
          {showBusiness && <p className={s.metaSmall} data-meta="">{meta}</p>}
        </>
      ) : (
        <header className={s.head}>
          {avatar(40)}
          <div className={s.who}>
            <p className={s.name}>
              <span className={s.nameText}>{name}</span>
              {nameTag}
            </p>
            <p className={s.meta} data-meta="">{meta}</p>
          </div>
          <span className={s.kind} data-kind="" data-tone={tone}>
            <Icon name={kindIcon} size={14} />
            {kindWords}
          </span>
        </header>
      )}

      <h3 id={titleId} className={s.title}>
        {onOpen ? (
          <button type="button" className={s.titleButton} data-open="" onClick={(event) => onOpen(current, event.currentTarget)}>
            {current.title}
          </button>
        ) : current.title}
      </h3>
      {/* The line is the engine's own sentence (data-engine-line): an amount it composed there (a judge's cost bound,
          why Accept is blocked) has no receipt of its own until W4 4J1 moves it into receipted row meta. A question's
          line is also the agent's own words (title options it wrote), so it is quoted content. Never cut short. */}
      {current.line && <p className={s.line} data-engine-line="" data-content={current.kind === 'question' ? '' : undefined}>{current.line}</p>}

      {previewNode && <div className={s.preview} data-preview="">{previewNode}</div>}
      {current.change && (
        <div className={compact ? s.changeMini : s.changeBox}>
          <Change {...current.change} size={compact ? 'mini' : 'pill'} onReceipt={onReceipt} />
        </div>
      )}

      {notices}
      {note && (
        <p id={noteId} className={s.note} data-note="">
          <Icon name={locked ? 'lock' : 'shield-check'} size={14} />
          <span>{note}</span>
        </p>
      )}

      {phase === 'confirm' && pending && (
        <div className={s.confirm}>
          <p className={s.ask}>{t('approval.secondAsk', { action: pending.label })}</p>
          <div className={s.acts}>
            <Button ref={cancelRef} size={size} onClick={cancel}>{t('approval.cancel')}</Button>
            <Button variant="primary" size={size} data-confirm="" onClick={() => void decide(pending)}>{pending.label}</Button>
          </div>
        </div>
      )}
      {phase === 'answer' && (
        <form className={s.confirm} onSubmit={(event) => { event.preventDefault(); if (answer.trim()) void decide(primary, answer.trim()); }}>
          <Field label={t('approval.answerLabel')} value={answer} onChange={(event) => setAnswer(event.currentTarget.value)} autoFocus />
          <div className={s.acts}>
            <Button size={size} onClick={cancel}>{t('approval.cancel')}</Button>
            <Button variant="primary" size={size} type="submit" disabled={!answer.trim()}>{t('approval.answerSend')}</Button>
          </div>
        </form>
      )}
      {phase !== 'confirm' && phase !== 'answer' && (
        <div className={s.acts}>
          {others.map((action, index) => (
            <Button key={action.id} size={size} data-key={otherKey(index)} disabled={busy} onClick={() => choose(action)}>
              {action.id === 'watch' && <Icon name="play" size={size === 'sm' ? 14 : 16} filled />}
              {action.label}
            </Button>
          ))}
          <Button
            ref={primaryRef}
            size={size}
            variant="primary"
            data-key="primary"
            disabled={busy}
            locked={locked}
            lockedReason={note}
            lockedNoteId={noteId}
            // Unlocked, it still points at its note ("Asks once more", "Nothing changes until you approve").
            aria-describedby={!locked && note ? noteId : undefined}
            onClick={() => { if (!locked) choose(primary); }}
          >
            {!locked && primaryIcon && <Icon name={primaryIcon} size={size === 'sm' ? 14 : 16} />}
            {primary.label}
          </Button>
        </div>
      )}
    </article>
  );
}
