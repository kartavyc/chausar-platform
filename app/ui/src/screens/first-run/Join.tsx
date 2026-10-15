/**
 * FR-14 Join a workspace from another computer, over core-sync-jobs' `devices.join` and
 * `seats.inviteVerify` (contract in `bridge/r4-contracts.ts`). Joining goes through a shared
 * folder that a computer already in syncs to (Trust · Machines, `sync.setup`).
 * - `JoinFromNew`, on the new computer (first run, before any vault): first asks whether a join
 *   was started already (`{ step: 'finish' }`; `DEVICE_JOIN_NOT_STARTED` means none). Then the
 *   shared folder's full path and a name for this computer (`{ step: 'request', folder, deviceName }`)
 *   give a six-digit code with the time it works until (15 minutes). The person compares it on
 *   the computer already in and approves there; "Check again" reads the join. Ready: a locked
 *   copy is in this computer's backups folder, opened with the workspace passphrase
 *   (`workspace.restore { backupFile, passphrase, folder }`, the passphrase read once from an
 *   uncontrolled field and emptied at once); then the person restarts Chausar so sync starts.
 *   Refused, expired: start again. "Cancel joining" is `{ step: 'cancel' }`.
 * - `JoinRequests`, on a computer already in (Trust · People and devices): the computers asking,
 *   by the name each gave, each with a field for the code shown on the new computer, Approve and
 *   Refuse. This computer does not draw the code it was sent: the person types what the new
 *   computer shows, Approve sends that typed code and the engine checks it
 *   (`DEVICE_JOIN_CODE_MISMATCH` when it differs).
 * Without the methods each says "not built yet". The code is a short number, never a secret
 * that opens anything by itself. Refusals named in `JOIN_REFUSALS` have their own sentences.
 */

import { useCallback, useEffect, useState } from 'react';
import { useLanguage, useT } from '../../app/text';
import { Field } from '../../parts/Field';
import { isDeviceName, joinPhaseAt, readJoinAnswer, readJoinRequests, readJoinState, type JoinRequest, type JoinState } from '../../bridge/r4-contracts.ts';
import { failureOf, validateOpened, type JourneyFailure } from './journey-contracts.ts';
import { Act, Actions, FailureLine, Status, StepHeader } from './JourneyParts';
import type { ComputerPort } from './this-computer.ts';
import s from './Journey.module.css';

/** The refusal codes with a sentence of their own (`FR-14.code.<CODE>`). */
const WORDED: ReadonlySet<string> = new Set([
  'DEVICE_FOLDER_UNAVAILABLE', 'DEVICE_FOLDER_NOT_SET_UP', 'DEVICE_ALREADY_ENROLLED', 'DEVICE_JOIN_INVALID', 'SYNC_UNTRUSTED_DEVICE', 'SYNC_EMPTY',
  'INVALID_DEVICE_REQUEST', 'APP_APPROVAL_REQUIRED', 'OPEN_DESKTOP', 'DEVICE_JOIN_CODE_MISMATCH', 'DEVICE_JOIN_EXPIRED', 'DEVICE_JOIN_USED',
  'DEVICE_JOIN_NOT_FOUND', 'SYNC_READ_ONLY_DEVICE', 'SYNC_OFF', 'SYNC_NOT_CONNECTED', 'DEVICE_NOT_ENROLLED', 'DEVICE_JOIN_NEEDS_FOLDER',
  'SYNC_LEASE_WAIT', 'DEVICE_REMOVED',
]);

/** A refusal in this screen's own words when it has some, else the step's sentence with the code. */
function JoinFailure({ failure, refused = 'FR-14.refused' }: { failure: JourneyFailure; refused?: string }) {
  const t = useT();
  if (failure.kind === 'refused' && WORDED.has(failure.code)) return <p className={s.problem} role="alert" data-join-refused={failure.code}>{t(`FR-14.code.${failure.code}`)}</p>;
  return <FailureLine failure={failure} notBuilt="FR-14.notBuilt" refused={refused} />;
}

/** A full path on this computer: `/…`, `C:\…` or `\\server\…`. The engine checks it again. */
const FULL_PATH = /^(?:\/|[A-Za-z]:[\\/]|\\\\)[^\u0000-\u001f]{0,1020}$/;
const FOLDER = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

type Join =
  | { readonly kind: 'starting' }
  | { readonly kind: 'ask'; readonly problem: string | null; readonly failure: JourneyFailure | null }
  | { readonly kind: 'known'; readonly join: JoinState }
  | { readonly kind: 'restored' }
  | JourneyFailure;

async function requestJoin(rpc: ComputerPort, payload: Record<string, unknown>): Promise<{ readonly join: JoinState } | JourneyFailure> {
  try {
    const join = readJoinState(await rpc.request('devices.join', payload));
    return join === null ? { kind: 'refused', code: 'INVALID_REPLY' } : { join };
  } catch (error) { return failureOf(error); }
}

const timeOf = (instant: string, language: string) => new Intl.DateTimeFormat(language === 'hi' ? 'hi-IN' : 'en-IN', { hour: '2-digit', minute: '2-digit' }).format(new Date(instant));

function readAndClear(form: HTMLFormElement, name: string): string {
  const field = form.elements.namedItem(name);
  if (!(field instanceof HTMLInputElement)) return '';
  const value = field.value;
  field.value = '';
  return value;
}

export interface JoinFromNewProps {
  readonly rpc: ComputerPort;
  readonly language: string;
  readonly onBack: () => void;
  readonly now?: (() => number) | undefined;
}

export function JoinFromNew({ rpc, language, onBack, now = Date.now }: JoinFromNewProps) {
  const t = useT();
  const [state, setState] = useState<Join>({ kind: 'starting' });
  const [busy, setBusy] = useState(false);
  const [restoreFailure, setRestoreFailure] = useState<JourneyFailure | { readonly kind: 'problem'; readonly key: string } | null>(null);

  /** A join already started on this computer is picked up again; none means the folder question. */
  const resume = useCallback(() => {
    setState({ kind: 'starting' });
    let live = true;
    void requestJoin(rpc, { step: 'finish' }).then(next => {
      if (!live) return;
      if ('join' in next) setState({ kind: 'known', join: next.join });
      else if (next.kind === 'refused' && next.code === 'DEVICE_JOIN_NOT_STARTED') setState({ kind: 'ask', problem: null, failure: null });
      else setState(next);
    });
    return () => { live = false; };
  }, [rpc]);
  useEffect(() => resume(), [resume]);

  const ask = async (form: HTMLFormElement) => {
    const folder = (new FormData(form).get('folder') ?? '').toString().trim();
    const name = (new FormData(form).get('device-name') ?? '').toString().trim();
    if (!FULL_PATH.test(folder)) { setState({ kind: 'ask', problem: 'FR-14.folderBad', failure: null }); return; }
    if (name !== '' && !isDeviceName(name)) { setState({ kind: 'ask', problem: 'FR-14.nameBad', failure: null }); return; }
    setBusy(true);
    const next = await requestJoin(rpc, { step: 'request', folder, ...(name === '' ? {} : { deviceName: name }) });
    setBusy(false);
    setState('join' in next ? { kind: 'known', join: next.join } : next.kind === 'not-built' ? next : { kind: 'ask', problem: null, failure: next });
  };

  const step = async (payload: Record<string, unknown>) => {
    setBusy(true);
    const next = await requestJoin(rpc, payload);
    setBusy(false);
    if ('join' in next) setState(next.join.state === 'cancelled' ? { kind: 'ask', problem: null, failure: null } : { kind: 'known', join: next.join });
    else setState(next);
  };

  /** The workspace passphrase passes once, with the managed copy's name, to `workspace.restore`. */
  const restore = async (form: HTMLFormElement, backupFile: string) => {
    const typed = readAndClear(form, 'join-passphrase');
    const folder = (new FormData(form).get('join-folder') ?? '').toString().trim();
    if (!FOLDER.test(folder)) { setRestoreFailure({ kind: 'problem', key: 'FR-14.restore.folderBad' }); return; }
    if (typed.length === 0) { setRestoreFailure({ kind: 'problem', key: 'FR-14.restore.empty' }); return; }
    setBusy(true); setRestoreFailure(null);
    try {
      validateOpened(await rpc.request('workspace.restore', { folder, backupFile, passphrase: typed }));
      setState({ kind: 'restored' });
    } catch (error) { setRestoreFailure(failureOf(error)); }
    finally { setBusy(false); }
  };

  const phase = state.kind === 'known' ? joinPhaseAt(state.join, now()) : null;
  const join = state.kind === 'known' ? state.join : null;
  return (
    <section data-first-run-screen="join" data-join={phase ?? state.kind}>
      <StepHeader step={1} title="FR-14.title" lede="FR-14.lede" />
      {state.kind === 'starting' && <Status k="FR-14.starting" />}
      {(state.kind === 'not-built' || state.kind === 'refused') && <JoinFailure failure={state} />}
      {state.kind === 'ask' && (
        <form onSubmit={event => { event.preventDefault(); void ask(event.currentTarget); }}>
          <div className={s.fields}>
            <Field label={t('FR-14.folder.field')} name="folder" defaultValue="" autoComplete="off" spellCheck={false} />
            <Field label={t('FR-14.name.field')} name="device-name" defaultValue="" autoComplete="off" />
          </div>
          {state.problem !== null && <p className={s.problem} role="alert">{t(state.problem)}</p>}
          {state.failure !== null && <JoinFailure failure={state.failure} />}
          <Actions><Act variant="filled" submit label="FR-14.ask.btn" disabled={busy} /></Actions>
        </form>
      )}
      {join !== null && join.state === 'waiting' && phase === 'waiting' && (
        <>
          <p className={s.sectionTitle}>{t('FR-14.code')}</p>
          <p className={[s.answer, 'fig'].join(' ')} data-join-code="">{join.code}</p>
          <p className={s.note}>{t('FR-14.compare')}</p>
          <p className={s.note}>{t('FR-14.expires', { time: timeOf(join.expiresAt, language) })}</p>
          <Status k="FR-14.waiting" />
          <Actions>
            <Act label="FR-14.check.btn" disabled={busy} onClick={() => { void step({ step: 'finish' }); }} />
            <Act variant="link" label="FR-14.cancel.btn" disabled={busy} onClick={() => { void step({ step: 'cancel' }); }} />
          </Actions>
        </>
      )}
      {join !== null && join.state === 'ready' && (
        <form onSubmit={event => { event.preventDefault(); void restore(event.currentTarget, join.backupFile); }}>
          <Status k="FR-14.ready" />
          <div className={s.fields}>
            <Field label={t('FR-14.restore.folder')} name="join-folder" defaultValue="main" autoComplete="off" spellCheck={false} />
            {/* Uncontrolled: the passphrase is read once, on Open, and the field emptied at once. */}
            <Field label={t('FR-14.restore.passphrase')} name="join-passphrase" type="password" defaultValue="" autoComplete="off" />
          </div>
          {restoreFailure !== null && (restoreFailure.kind === 'problem'
            ? <p className={s.problem} role="alert">{t(restoreFailure.key)}</p>
            : <FailureLine failure={restoreFailure} notBuilt="FR-14.notBuilt" refused="FR-14.restore.refused" />)}
          <Actions><Act variant="filled" submit label="FR-14.restore.btn" disabled={busy} /></Actions>
        </form>
      )}
      {state.kind === 'restored' && <Status k="FR-14.restored" />}
      {phase === 'expired' && <p className={s.problem} role="alert">{t('FR-14.expired')}</p>}
      {phase === 'refused' && <p className={s.problem} role="alert">{t('FR-14.refusedThere')}</p>}
      <Actions>
        {(phase === 'expired' || phase === 'refused' || state.kind === 'refused') && <Act label="FR-14.again.btn" onClick={() => { resume(); }} />}
        <Act variant="link" label="FR-14.back.btn" onClick={onBack} />
      </Actions>
    </section>
  );
}

/* ------------------------------------------------------------------ a computer already in */

type Requests = { readonly kind: 'reading' } | { readonly kind: 'known'; readonly requests: readonly JoinRequest[] } | JourneyFailure;
type Answer = { readonly requestId: string; readonly result: 'approved' | 'refused' | JourneyFailure };

export function JoinRequests({ rpc, now = Date.now }: { rpc: ComputerPort; now?: (() => number) | undefined }) {
  const t = useT();
  const language = useLanguage();
  const [state, setState] = useState<Requests>({ kind: 'reading' });
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [busy, setBusy] = useState(false);
  const read = useCallback(async () => {
    try {
      const requests = readJoinRequests(await rpc.request('seats.inviteVerify', {}));
      setState(requests === null ? { kind: 'refused', code: 'INVALID_REPLY' } : { kind: 'known', requests });
    } catch (error) { setState(failureOf(error)); }
  }, [rpc]);
  useEffect(() => { void read(); }, [read]);

  /** Approve with the code the person typed from the new computer, never the code this computer was sent; or Refuse. */
  const decide = async (request: JoinRequest, approve: boolean, typed: string) => {
    setBusy(true); setAnswer(null);
    try {
      const payload = approve ? { requestId: request.requestId, code: typed, approve: true } : { requestId: request.requestId, approve: false };
      const reply = readJoinAnswer(await rpc.request('seats.inviteVerify', payload), request.requestId);
      const result = reply === null || ('approved' in reply) !== approve ? { kind: 'refused' as const, code: 'INVALID_REPLY' } : approve ? 'approved' as const : 'refused' as const;
      setAnswer({ requestId: request.requestId, result });
    } catch (error) { setAnswer({ requestId: request.requestId, result: failureOf(error) }); }
    finally { setBusy(false); void read(); }
  };

  if (state.kind === 'reading') return <section data-join-requests="reading"><Status k="FR-14.starting" /></section>;
  if (state.kind !== 'known') return <section data-join-requests={state.kind}><JoinFailure failure={state} /></section>;
  const waiting = state.requests.filter(request => Date.parse(request.expiresAt) > now());
  return (
    <section className={s.section} data-join-requests="known">
      <h2 className={s.sectionTitle}>{t('FR-14.requests.title')}</h2>
      {waiting.length === 0 ? <p className={s.note}>{t('FR-14.requests.none')}</p> : (
        <>
          <p className={s.note}>{t('FR-14.requests.lede')}</p>
          <ul className={s.rows}>
            {waiting.map(request => (
              <li key={request.requestId} className={s.row} data-join-request={request.requestId}>
                <form onSubmit={event => {
                  event.preventDefault();
                  const typed = new FormData(event.currentTarget).get('code');
                  void decide(request, true, typeof typed === 'string' ? typed.replace(/\s+/g, '') : '');
                }}>
                  <div className={s.rowLine}>
                    <span className={s.rowName}>{t('FR-14.requests.until', { name: request.name, time: timeOf(request.expiresAt, language) })}</span>
                  </div>
                  {/* Uncontrolled: the typed code is read once, on Approve. */}
                  <Field label={t('FR-14.requests.field')} name="code" defaultValue="" autoComplete="off" spellCheck={false} inputMode="numeric" />
                  <Actions>
                    <Act variant="filled" submit label="FR-14.approve.btn" disabled={busy} />
                    <Act variant="link" label="FR-14.refuse.btn" disabled={busy} onClick={() => { void decide(request, false, ''); }} />
                  </Actions>
                </form>
              </li>
            ))}
          </ul>
        </>
      )}
      {answer !== null && (typeof answer.result === 'string'
        ? <p className={s.status} role="status" data-join-answer={answer.result}>{t(answer.result === 'approved' ? 'FR-14.approve.done' : 'FR-14.refuse.done')}</p>
        : <JoinFailure failure={answer.result} />)}
    </section>
  );
}
