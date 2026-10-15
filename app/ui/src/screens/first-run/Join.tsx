/**
 * FR-14 Join a workspace from another computer, over core-sync-jobs' `devices.join` and
 * `seats.inviteVerify` (contract in `bridge/r4-contracts.ts`).
 * - `JoinFromNew`, on the new computer (first run, before any vault): asks for a short code and
 *   shows it with the time it works until (15 minutes). The person reads it on a computer already
 *   in and approves it there; "Check again" reads the join. Approved: open the workspace with its
 *   own passphrase. Expired or used: start again.
 * - `JoinRequests`, on a computer already in (Trust · People and devices): the computers asking,
 *   each with a field for the code shown on the new computer and Approve. This computer does not
 *   show the code: the person types what the new computer shows, Approve sends that typed code and
 *   the engine checks it (`JOIN_CODE_MISMATCH` when it differs).
 * Without the methods each says "not built yet". The code is a short number, never a secret
 * that opens anything by itself.
 */

import { useCallback, useEffect, useState } from 'react';
import { useLanguage, useT } from '../../app/text';
import { Field } from '../../parts/Field';
import { isJoinRequests, isJoinState, joinPhaseAt, type JoinState } from '../../bridge/r4-contracts.ts';
import { failureOf, type JourneyFailure } from './journey-contracts.ts';
import { Act, Actions, FailureLine, Status, StepHeader } from './JourneyParts';
import type { ComputerPort } from './this-computer.ts';
import s from './Journey.module.css';

type Join = { readonly kind: 'starting' } | { readonly kind: 'known'; readonly join: JoinState } | JourneyFailure;

async function requestJoin(rpc: ComputerPort, payload: Record<string, unknown>): Promise<Join> {
  try {
    const reply = await rpc.request('devices.join', payload);
    return isJoinState(reply) ? { kind: 'known', join: reply } : { kind: 'refused', code: 'INVALID_REPLY' };
  } catch (error) { return failureOf(error); }
}

const timeOf = (instant: string, language: string) => new Intl.DateTimeFormat(language === 'hi' ? 'hi-IN' : 'en-IN', { hour: '2-digit', minute: '2-digit' }).format(new Date(instant));

export interface JoinFromNewProps {
  readonly rpc: ComputerPort;
  readonly language: string;
  readonly onBack: () => void;
  /** Approved: open this folder at its lock screen. */
  readonly onOpenFolder?: ((folder: string) => void) | undefined;
  readonly now?: (() => number) | undefined;
}

export function JoinFromNew({ rpc, language, onBack, onOpenFolder, now = Date.now }: JoinFromNewProps) {
  const t = useT();
  const [state, setState] = useState<Join>({ kind: 'starting' });
  const [checking, setChecking] = useState(false);
  const start = useCallback(() => {
    setState({ kind: 'starting' });
    let live = true;
    void requestJoin(rpc, {}).then(next => { if (live) setState(next); });
    return () => { live = false; };
  }, [rpc]);
  useEffect(() => start(), [start]);

  const check = async (joinId: string) => {
    setChecking(true);
    const next = await requestJoin(rpc, { joinId });
    setChecking(false);
    setState(next);
  };

  const phase = state.kind === 'known' ? joinPhaseAt(state.join, now()) : null;
  return (
    <section data-first-run-screen="join" data-join={phase ?? state.kind}>
      <StepHeader step={1} title="FR-14.title" lede="FR-14.lede" />
      {state.kind === 'starting' && <Status k="FR-14.starting" />}
      {(state.kind === 'not-built' || state.kind === 'refused') && <FailureLine failure={state} notBuilt="FR-14.notBuilt" refused="FR-14.refused" />}
      {state.kind === 'known' && (
        <>
          <p className={s.sectionTitle}>{t('FR-14.code')}</p>
          <p className={[s.answer, 'fig'].join(' ')} data-join-code="">{state.join.code}</p>
          {phase === 'waiting' && <>
            <p className={s.note}>{t('FR-14.expires', { time: timeOf(state.join.expiresAt, language) })}</p>
            <Status k="FR-14.waiting" />
            <Actions><Act label="FR-14.check.btn" disabled={checking} onClick={() => { void check(state.join.joinId); }} /></Actions>
          </>}
          {phase === 'approved' && <>
            <Status k="FR-14.approved" />
            {onOpenFolder !== undefined && state.join.folder !== undefined && (
              <Actions><Act variant="filled" label="FR-14.open.btn" onClick={() => onOpenFolder(state.join.folder!)} /></Actions>
            )}
          </>}
          {phase === 'expired' && <p className={s.problem} role="alert">{t('FR-14.expired')}</p>}
          {phase === 'used' && <p className={s.problem} role="alert">{t('FR-14.used')}</p>}
        </>
      )}
      <Actions>
        {(phase === 'expired' || phase === 'used' || state.kind === 'refused') && <Act label="FR-14.again.btn" onClick={() => { start(); }} />}
        <Act variant="link" label="FR-14.back.btn" onClick={onBack} />
      </Actions>
    </section>
  );
}

/* ------------------------------------------------------------------ a computer already in */

type Requests = { readonly kind: 'reading' } | { readonly kind: 'known'; readonly requests: readonly JoinState[] } | JourneyFailure;
type Answer = { readonly joinId: string; readonly result: 'approved' | 'mismatch' | 'expired' | 'used' | JourneyFailure };

export function JoinRequests({ rpc, now = Date.now }: { rpc: ComputerPort; now?: (() => number) | undefined }) {
  const t = useT();
  const language = useLanguage();
  const [state, setState] = useState<Requests>({ kind: 'reading' });
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [busy, setBusy] = useState(false);
  const read = useCallback(async () => {
    try {
      const reply = await rpc.request('seats.inviteVerify', {});
      setState(isJoinRequests(reply) ? { kind: 'known', requests: reply.requests } : { kind: 'refused', code: 'INVALID_REPLY' });
    } catch (error) { setState(failureOf(error)); }
  }, [rpc]);
  useEffect(() => { void read(); }, [read]);

  /** Approve with the code the person typed from the new computer, never the code this computer was sent. */
  const approve = async (join: JoinState, typed: string) => {
    setBusy(true); setAnswer(null);
    try {
      const reply = await rpc.request('seats.inviteVerify', { joinId: join.joinId, code: typed });
      setAnswer({ joinId: join.joinId, result: isJoinState(reply) && reply.joinId === join.joinId && reply.state === 'approved' ? 'approved' : { kind: 'refused', code: 'INVALID_REPLY' } });
    } catch (error) {
      const failure = failureOf(error);
      const code = failure.kind === 'refused' ? failure.code : '';
      setAnswer({ joinId: join.joinId, result: code === 'JOIN_CODE_MISMATCH' ? 'mismatch' : code === 'JOIN_EXPIRED' ? 'expired' : code === 'JOIN_USED' ? 'used' : failure });
    } finally { setBusy(false); void read(); }
  };

  if (state.kind === 'reading') return <section data-join-requests="reading"><Status k="FR-14.starting" /></section>;
  if (state.kind !== 'known') return <section data-join-requests={state.kind}><FailureLine failure={state} notBuilt="FR-14.notBuilt" refused="FR-14.refused" /></section>;
  const waiting = state.requests.filter(join => joinPhaseAt(join, now()) === 'waiting');
  const words = (result: Answer['result']) => result === 'approved' ? 'FR-14.approve.done' : result === 'mismatch' ? 'FR-14.mismatch' : result === 'expired' ? 'FR-14.expired' : 'FR-14.used';
  return (
    <section className={s.section} data-join-requests="known">
      <h2 className={s.sectionTitle}>{t('FR-14.requests.title')}</h2>
      {waiting.length === 0 ? <p className={s.note}>{t('FR-14.requests.none')}</p> : (
        <>
          <p className={s.note}>{t('FR-14.requests.lede')}</p>
          <ul className={s.rows}>
            {waiting.map(join => (
              <li key={join.joinId} className={s.row} data-join-request={join.joinId}>
                <form onSubmit={event => {
                  event.preventDefault();
                  const typed = new FormData(event.currentTarget).get('code');
                  void approve(join, typeof typed === 'string' ? typed.trim() : '');
                }}>
                  <div className={s.rowLine}>
                    <span className={s.rowName}>{t('FR-14.requests.until', { time: timeOf(join.expiresAt, language) })}</span>
                  </div>
                  {/* Uncontrolled: the typed code is read once, on Approve. */}
                  <Field label={t('FR-14.requests.field')} name="code" defaultValue="" autoComplete="off" spellCheck={false} />
                  <Act variant="filled" submit label="FR-14.approve.btn" disabled={busy} />
                </form>
              </li>
            ))}
          </ul>
        </>
      )}
      {answer !== null && (typeof answer.result === 'string'
        ? <p className={answer.result === 'approved' ? s.status : s.problem} role={answer.result === 'approved' ? 'status' : 'alert'} data-join-answer={answer.result}>{t(words(answer.result))}</p>
        : <FailureLine failure={answer.result} notBuilt="FR-14.notBuilt" refused="FR-14.refused" />)}
    </section>
  );
}
