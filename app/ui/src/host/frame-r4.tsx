/**
 * Round 4 frame wiring, kept out of bootstrap.tsx: the Updates surface (SH-08), the route states
 * (SH-09) and the fault report with save, send and the after-crash question (SH-11).
 *
 * Every reply is checked against its contract before it is drawn. A method no lane serves yet
 * (`UNKNOWN_METHOD`, `INVALID_REQUEST`, `METHOD_UNAVAILABLE`) gives the "not built yet" state;
 * nothing is invented in its place. Update runs only after the person pressed Update, each step
 * once, with the release lane's exact `{ confirmed: true }`; nothing retries by itself.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PlaceRpc } from '../places/types.ts';
import {
  FAULT_REPORT_SEND_UNAVAILABLE, isFaultReport, isRouteStateProbe, isUpdateStepReply, isUpdatesReply, notBuilt, updateRefusal,
  type FaultReport as FaultReportData, type RouteStateProbe, type UpdatesReply,
} from '../bridge/todayx-contract.ts';
import type { ShellPort } from '../bridge/shell.ts';
import { FaultReport, faultReportText } from '../app/FaultReport.tsx';
import { Updates } from '../app/Updates.tsx';
import { RouteStates, type RouteStatesProps } from '../app/RouteStates.tsx';
import type { UpdateRun } from '../app/updates-model.ts';
import { useT } from '../app/text';
import { State } from '../patterns/States';
import s from '../app/ShellSheets.module.css';

/* ------------------------------------------------------------------ SH-08 */

export interface UpdatesHandle {
  readonly reply: UpdatesReply | null;
  readonly run: UpdateRun;
  update(): void;
  dismiss(): void;
}

/** `todayx.updates` for this context, and the run the person starts with Update. */
export function useUpdates(rpc: PlaceRpc, key: string): UpdatesHandle {
  const [reply, setReply] = useState<UpdatesReply | null>(null);
  const [run, setRun] = useState<UpdateRun>({ phase: 'idle' });
  const generation = useRef(0);
  const busy = useRef(false);
  const read = useCallback(() => {
    const mine = ++generation.current;
    rpc.request('todayx.updates', {}).then(
      value => { if (generation.current === mine) setReply(isUpdatesReply(value) ? value : null); },
      error => { if (generation.current === mine) setReply(notBuilt(error) ? NOT_BUILT : null); },
    );
  }, [rpc]);
  useEffect(() => { setReply(null); setRun({ phase: 'idle' }); read(); return () => { generation.current++; }; }, [read, key]);
  const update = useCallback(() => {
    if (busy.current) return;
    busy.current = true;
    const mine = generation.current;
    const live = () => generation.current === mine;
    setRun({ phase: 'checking' });
    void (async () => {
      try {
        const staged = await rpc.request('todayx.updates.stage', { confirmed: true });
        if (!live()) return;
        if (!isUpdateStepReply(staged)) { setRun({ phase: 'refused', why: 'failed' }); return; }
        if (staged.step === 'manual') { setRun({ phase: 'refused', why: 'manual' }); return; }
        setRun({ phase: 'saving' });
        const applied = await rpc.request('todayx.updates.apply', { confirmed: true });
        if (!live()) return;
        setRun(isUpdateStepReply(applied) && applied.step === 'restart' ? { phase: 'restart' } : { phase: 'refused', why: 'failed' });
      } catch (error) {
        if (live()) setRun({ phase: 'refused', why: updateRefusal(error) });
      } finally { busy.current = false; }
    })();
  }, [rpc]);
  const dismiss = useCallback(() => {
    void rpc.request('todayx.updates.dismiss', {}).then(value => { if (isUpdatesReply(value)) setReply(value); }, () => read());
  }, [rpc, read]);
  return { reply, run, update, dismiss };
}
const NOT_BUILT: UpdatesReply = { state: 'not-built', version: null, channel: null, expiresAt: null, candidate: null, platform: 'other', canUpdate: false };

export function UpdatesSheetBody({ updates }: { updates: UpdatesHandle }) {
  return <Updates reply={updates.reply} run={updates.run} onUpdate={updates.update} onDismiss={updates.dismiss} />;
}

/* ------------------------------------------------------------------ SH-09 */

type Probe = RouteStateProbe | null | 'not-built';
/** One probe per port, context and route: a page drawn again shows the same reading, never a silent second check. */
const probes = new WeakMap<PlaceRpc, Map<string, Promise<Probe>>>();
function probeOnce(rpc: PlaceRpc, key: string, routeId: string): Promise<Probe> {
  const byKey = probes.get(rpc) ?? new Map<string, Promise<Probe>>();
  probes.set(rpc, byKey);
  const name = JSON.stringify([key, routeId]);
  let pending = byKey.get(name);
  if (pending === undefined) {
    pending = rpc.request('models.probe', { routeId }).then(value => (isRouteStateProbe(value) && value.routeId === routeId ? value : null), error => (notBuilt(error) ? 'not-built' as const : null));
    for (const old of byKey.keys()) if (!old.startsWith(JSON.stringify([key]).slice(0, -1))) byKey.delete(old);
    byKey.set(name, pending);
  }
  return pending;
}

/** `models.probe` once per context for each route: the checked rows, 'not-built' when no lane serves it. Unreadable replies are left out. */
export function useRouteProbes(rpc: PlaceRpc, key: string, routes: readonly { readonly id: string; readonly label: string }[]): RouteStatesProps['rows'] {
  const [rows, setRows] = useState<RouteStatesProps['rows']>([]);
  const ids = routes.map(route => `${route.id}\u0000${route.label}`).join('\u0001');
  useEffect(() => {
    let live = true;
    setRows([]);
    void Promise.all(routes.map(route => probeOnce(rpc, key, route.id).then(probe => ({ label: route.label, probe })))).then(read => {
      if (!live) return;
      if (read.some(row => row.probe === 'not-built')) { setRows('not-built'); return; }
      setRows(read.flatMap(row => (row.probe !== null && row.probe !== 'not-built' ? [{ label: row.label, probe: row.probe }] : [])));
    });
    return () => { live = false; };
  }, [rpc, key, ids]);
  return rows;
}

/** Ask, New's route states: `models.probe` is read only while this is drawn, once per context and route. */
export function RouteStatesPanel({ rpc, contextKey, routes, timeZone }: { rpc: PlaceRpc; contextKey: string; routes: readonly { readonly id: string; readonly label: string }[]; timeZone: string | null }) {
  const rows = useRouteProbes(rpc, contextKey, routes);
  return <RouteStates rows={rows} timeZone={timeZone} />;
}

/* ------------------------------------------------------------------ SH-11 */

/** Whether the last run ended without a clean quit; asked once per start. */
export function useCrashPrompt(shell: ShellPort | null): boolean {
  const [crashed, setCrashed] = useState(false);
  useEffect(() => {
    let live = true;
    if (shell?.crashState) void shell.crashState().then(state => { if (live) setCrashed(state === 'crashed'); });
    return () => { live = false; };
  }, [shell]);
  return crashed;
}

type Outcome = 'saved' | 'save-refused' | 'send-unavailable' | 'not-sent' | null;

/**
 * The fault report sheet: the whole text first, then Save (always) and, after a crash, Send report or
 * Don't send. Send asks the engine, which refuses until a reporting endpoint exists; the refusal is said.
 */
export function FaultReportSheetBody({ rpc, shell, crash, onAnswered }: { rpc: PlaceRpc; shell: ShellPort | null; crash: boolean; onAnswered?: () => void }) {
  const t = useT();
  const [report, setReport] = useState<FaultReportData | null | 'not-built' | 'failed'>(null);
  const [outcome, setOutcome] = useState<Outcome>(null);
  useEffect(() => {
    let live = true;
    rpc.request('todayx.faultReport', {}).then(
      value => { if (live) setReport(isFaultReport(value) ? value : 'failed'); },
      error => { if (live) setReport(notBuilt(error) ? 'not-built' : 'failed'); },
    );
    return () => { live = false; };
  }, [rpc]);
  if (report === null) return <State state={{ kind: 'loading' }} />;
  if (report === 'not-built') return <State state={{ kind: 'not-built' }} />;
  if (report === 'failed') return <State state={{ kind: 'failed', code: 'FAULT_REPORT_UNAVAILABLE' }} />;
  const save = () => {
    if (!shell?.saveText) { setOutcome('save-refused'); return; }
    void shell.saveText('fault-report', faultReportText(report, t('SH-11.header'))).then(result => setOutcome(result === 'saved' ? 'saved' : result === 'cancelled' ? null : 'save-refused'));
  };
  const answer = (value: 'send' | 'dont-send') => { void shell?.crashAnswer?.(value); onAnswered?.(); };
  const send = () => {
    // Nothing is sent until a reporting endpoint exists: the engine refuses, and the sheet says so.
    void rpc.request('todayx.faultReport.send', {}).then(
      () => setOutcome(null),
      error => setOutcome((error as { code?: unknown })?.code === FAULT_REPORT_SEND_UNAVAILABLE || notBuilt(error) ? 'send-unavailable' : 'not-sent'),
    ).finally(() => answer('send'));
  };
  const words: Record<Exclude<Outcome, null>, string> = { saved: 'SH-11.saved', 'save-refused': 'SH-11.save-refused', 'send-unavailable': 'SH-11.send-unavailable', 'not-sent': 'SH-11.not-sent' };
  return (
    <div className={s.stack}>
      <FaultReport report={report} onSave={save}
        crash={crash ? { onSend: send, onDontSend: () => { setOutcome('not-sent'); answer('dont-send'); } } : undefined} />
      {outcome !== null && <p className={s.note} role="status" data-fault-outcome={outcome}>{t(words[outcome])}</p>}
    </div>
  );
}
