/**
 * TR-12 hosted backup and TR-14 always-on jobs, at `trust/hosted`, over hosted-link's `hosted.status`,
 * `hosted.backup.*` and `hosted.worker.*`. Not set up, demo mode and not paired are plain states. A backup is
 * locked on this computer before it leaves; restoring downloads it for the lock screen's "Choose your backup
 * file". An always-on job turns on only through its agreement sheet (`?sheet=always-on.<type>`), which says it is
 * not end-to-end encrypted. The backup key typed for a restore is cleared before the request is awaited; the
 * exported key is shown once and kept only while this page is open.
 */
import { useState, type FormEvent } from 'react';
import { withSheet } from '../../app/routes.ts';
import { words } from '../../places/types.ts';
import { Button } from '../../parts/Button';
import { Field } from '../../parts/Field';
import { Sheet } from '../../parts/Sheet';
import { State } from '../../patterns/States';
import { useEngine, useSend } from './kit/engine.ts';
import { Group, Note, Screen, screenState } from './kit/Screen';
import { AskTwice, Tag, bytesText, dayText, powers, useClose, type P } from './common';
import { RestoreFile } from './Computer';
import { rtt } from './rtt.ts';
import { RttRefusal, Said } from './rtt-parts';
import {
  validateExportedKey, validateHostedBackups, validateHostedRestore, validateHostedStatus, validateHostedUpload, validateWorkerDeleted, validateWorkerSet,
  validateWorkerStatus, type HostedBackup, type HostedStatus, type WorkerJob, type WorkerStatus,
} from './validate-hosted.ts';
import { COMMON } from './words.ts';
import s from './Trust.module.css';

const SHEET = 'always-on.';

export function HostedScreen(p: P) {
  const say = rtt(p.language);
  const { state } = useEngine(p.rpc, 'hosted.status', {}, validateHostedStatus);
  const sheet = p.address.sheet?.startsWith(SHEET) === true ? p.address.sheet.slice(SHEET.length) : null;
  return (
    <>
      <Screen where={say('RTT.hosted.where')} title={say('RTT.hosted.title')} loaded={state}>{(h) => <HostedBody p={p} h={h} />}</Screen>
      {sheet !== null && state.kind === 'ready' && state.value.paired && <ConsentSheet p={p} type={sheet} />}
    </>
  );
}

function HostedBody({ p, h }: { p: P; h: HostedStatus }) {
  const say = rtt(p.language);
  if (h.demo) return <Note>{say('RTT.hosted.demo')}</Note>;
  if (!h.configured) return <Note>{say('RTT.hosted.notConfigured')}</Note>;
  if (!h.paired) {
    return (
      <div className={s.stack}>
        <Note>{say('RTT.hosted.notPaired')}</Note>
        <span><Button variant="link" onClick={() => p.navigate({ place: 'tools', sub: 'phone' })}>{say('RTT.hosted.openPhone')}</Button></span>
      </div>
    );
  }
  const a = h.account;
  return (
    <>
      <p className={s.text} data-plan={a === null ? 'unread' : a.plan}>
        {a === null ? say('RTT.hosted.planNotRead') : `${say(a.plan === 'paid' ? 'RTT.hosted.planPaid' : 'RTT.hosted.planFree')} ${say('RTT.hosted.planRead', { date: dayText(a.refreshedAt, p.language) })}`}
      </p>
      <BackupGroup p={p} entitled={a?.backup ?? null} />
      <WorkerGroup p={p} entitled={a?.worker ?? null} />
    </>
  );
}

// ---------- Hosted backup ----------
function BackupGroup({ p, entitled }: { p: P; entitled: boolean | null }) {
  const say = rtt(p.language);
  const { admin } = powers(p);
  const { state, reload } = useEngine(p.rpc, 'hosted.backup.list', {}, validateHostedBackups);
  const upload = useSend(p.rpc, validateHostedUpload);
  const [unknown, setUnknown] = useState(false);
  const uploadNow = async () => {
    setUnknown(false);
    const done = await upload.send('hosted.backup.upload', {});
    if (!p.live(p.address)) return;
    // A lost reply is "unknown": the list is read again before anyone retries.
    if (done === null) { setUnknown(true); }
    reload();
  };
  return (
    <Group title={say('RTT.hosted.backupTitle')} note={say('RTT.hosted.blind')}>
      {entitled === false && <p className={s.quiet}>{say('RTT.hosted.backupNotInPlan')}</p>}
      {admin && <span><Button variant="quiet" disabled={upload.sent.kind === 'sending'} onClick={() => void uploadNow()}>{say('RTT.hosted.upload')}</Button></span>}
      {upload.sent.kind === 'refused' && unknown && ['HOSTED_UNREACHABLE', 'REQUEST_FAILED'].includes(upload.sent.code)
        ? <p className={s.problem} role="status" data-upload="unknown">{say('RTT.hosted.uploadUnknown')}</p>
        : <Said sent={upload.sent} done={() => say('RTT.hosted.uploaded')} language={p.language} />}
      {state.kind === 'ready' ? <BackupList p={p} b={state.value} /> : state.kind === 'failed' ? <RttRefusal code={state.code} language={p.language} /> : <State state={screenState(state)} />}
      {admin && <ExportKey p={p} />}
    </Group>
  );
}

function BackupList({ p, b }: { p: P; b: { backups: HostedBackup[]; quotaBytes: number; usedBytes: number; keep: number; keyHeldHere: boolean } }) {
  const say = rtt(p.language);
  const { admin } = powers(p);
  const [restoring, setRestoring] = useState<string | null>(null);
  return (
    <div className={s.stack}>
      <p className={s.quiet}>{say('RTT.hosted.used', { used: bytesText(b.usedBytes, p.language), quota: bytesText(b.quotaBytes, p.language), keep: String(b.keep) })}</p>
      <p className={s.quiet}>{say(b.keyHeldHere ? 'RTT.hosted.keyHeld' : 'RTT.hosted.keyNotHeld')}</p>
      {b.backups.length === 0 ? <p className={s.quiet}>{say('RTT.hosted.none')}</p> : (
        <ul className={s.list}>
          {b.backups.map((x) => (
            <li key={x.backupId} className={s.item} data-backup={x.backupId}>
              <span className={s.itemHead}>
                <span>{say('RTT.hosted.row', { date: dayText(x.createdAt, p.language), size: bytesText(x.sizeBytes, p.language) })}</span>
                <span className={s.quiet}>{say(x.madeHere ? 'RTT.hosted.madeHere' : 'RTT.hosted.madeElsewhere')}</span>
              </span>
              {p.view === 'books' && <span className={s.mono}>{x.backupId}</span>}
              {admin && restoring !== x.backupId && <span><Button variant="quiet" onClick={() => setRestoring(x.backupId)}>{say('RTT.hosted.restore')}</Button></span>}
              {admin && restoring === x.backupId && <RestoreForm p={p} backupId={x.backupId} askKey={!x.madeHere || !b.keyHeldHere} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Downloads one backup for the lock screen. The typed key, when one is needed, is cleared before the request is awaited. */
function RestoreForm({ p, backupId, askKey }: { p: P; backupId: string; askKey: boolean }) {
  const say = rtt(p.language);
  const [key, setKey] = useState('');
  const { sent, send } = useSend(p.rpc, validateHostedRestore);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const typed = key.trim();
    setKey('');
    await send('hosted.backup.restore', typed.length > 0 ? { backupId, backupKey: typed } : { backupId });
  };
  return (
    <div className={s.stack}>
      <form className={s.form} onSubmit={(e) => void submit(e)}>
        {askKey && <Field label={say('RTT.hosted.keyField')} type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.currentTarget.value)} />}
        <Button submit disabled={sent.kind === 'sending'}>{say('RTT.hosted.restore')}</Button>
      </form>
      <Said sent={sent} done={(x) => say('RTT.hosted.restored', { file: x.backupFile })} language={p.language} />
      {sent.kind === 'done' && <RestoreFile p={p} file={sent.value.backupFile} steps />}
    </div>
  );
}

/** The backup key, shown once for the recovery kit after asking again. */
function ExportKey({ p }: { p: P }) {
  const say = rtt(p.language);
  const { sent, send } = useSend(p.rpc, validateExportedKey);
  if (sent.kind === 'done') {
    return (
      <div className={s.stack} data-backup-key="">
        <span className={s.code}>{sent.value.backupKey}</span>
        <p className={s.status} role="status">{say('RTT.hosted.keyShown')}</p>
      </div>
    );
  }
  return (
    <div className={s.stack}>
      <span><AskTwice label={say('RTT.hosted.exportKey')} ask={say('RTT.hosted.exportAsk')} confirmLabel={say('RTT.hosted.exportKey')}
        onConfirm={() => void send('hosted.backup.exportKey', {})} language={p.language} disabled={sent.kind === 'sending'} /></span>
      {sent.kind === 'refused' && <RttRefusal code={sent.code} language={p.language} />}
    </div>
  );
}

// ---------- Always-on jobs (TR-14) ----------
function WorkerGroup({ p, entitled }: { p: P; entitled: boolean | null }) {
  const say = rtt(p.language);
  const { admin } = powers(p);
  // Read again when the agreement sheet closes, so a job just turned on shows as on.
  const { state, reload } = useEngine(p.rpc, 'hosted.worker.status', {}, validateWorkerStatus, p.address.sheet ?? '');
  return (
    <Group title={say('RTT.hosted.workerTitle')} note={say('RTT.hosted.notBlind')}>
      {entitled === false && <p className={s.quiet}>{say('RTT.hosted.workerNotInPlan')}</p>}
      {state.kind === 'failed' ? <RttRefusal code={state.code} language={p.language} />
        : state.kind !== 'ready' ? <State state={screenState(state)} /> : <WorkerBody p={p} w={state.value} admin={admin} reload={reload} />}
    </Group>
  );
}

function WorkerBody({ p, w, admin, reload }: { p: P; w: WorkerStatus; admin: boolean; reload: () => void }) {
  const say = rtt(p.language);
  const off = useSend(p.rpc, validateWorkerSet);
  const wipe = useSend(p.rpc, validateWorkerDeleted);
  const turnOff = async (type: string) => { if (await off.send('hosted.worker.set', { type, enabled: false }) !== null && p.live(p.address)) reload(); };
  const wipeAll = async () => { if (await wipe.send('hosted.worker.deleteData', {}) !== null && p.live(p.address)) reload(); };
  return (
        <div className={s.stack}>
          <span className={s.label}>{say('RTT.hosted.serverSays')}</span>
          <p className={s.quiet} data-worker-label="">{w.label}</p>
          {w.jobs.length === 0 ? <p className={s.quiet}>{say('RTT.hosted.workerNone')}</p> : (
            <ul className={s.list}>
              {w.jobs.map((j) => (
                <li key={j.type} className={s.item} data-job={j.type}>
                  <span className={s.itemHead}><span>{j.title}</span><Tag>{words(COMMON, p.language).experimental}</Tag></span>
                  <span className={s.quiet}>{say('RTT.hosted.jobUses', { uses: j.uses })}</span>
                  <span className={s.quiet}>{!j.enabled ? say('RTT.hosted.jobOff') : j.consentAt !== null ? say('RTT.hosted.jobOn', { date: dayText(j.consentAt, p.language) }) : say('RTT.hosted.jobOnNow')}</span>
                  {admin && (j.enabled
                    ? <span><Button variant="quiet" disabled={off.sent.kind === 'sending'} onClick={() => void turnOff(j.type)}>{say('RTT.hosted.jobTurnOff')}</Button></span>
                    : <span><Button variant="quiet" onClick={() => p.navigate(withSheet(p.address, `${SHEET}${j.type}`))}>{say('RTT.hosted.jobTurnOn')}</Button></span>)}
                </li>
              ))}
            </ul>
          )}
          <Said sent={off.sent} done={() => say('RTT.hosted.jobOff')} language={p.language} />
          {admin && (
            <span><AskTwice label={say('RTT.hosted.deleteData')} ask={say('RTT.hosted.deleteAsk')} confirmLabel={say('RTT.hosted.deleteData')}
              onConfirm={() => void wipeAll()} language={p.language} disabled={wipe.sent.kind === 'sending'} /></span>
          )}
          <Said sent={wipe.sent} done={() => say('RTT.hosted.deleted')} language={p.language} />
        </div>
  );
}

/** The agreement for one always-on job: what it means, a tick, then exactly this job turned on once. */
function ConsentSheet({ p, type }: { p: P; type: string }) {
  const say = rtt(p.language);
  const close = useClose(p);
  const { admin } = powers(p);
  const { state } = useEngine(p.rpc, 'hosted.worker.status', {}, validateWorkerStatus);
  const job: WorkerJob | undefined = state.kind === 'ready' ? state.value.jobs.find((j) => j.type === type) : undefined;
  return (
    <Sheet kind={say('RTT.hosted.consentKind')} title={say('RTT.hosted.consentTitle')} onClose={close} origin={null}>
      {state.kind !== 'ready' ? <State state={screenState(state)} />
        : job === undefined ? <p className={s.quiet}>{say('RTT.hosted.consentGone')}</p>
          : <ConsentBody p={p} job={job} admin={admin} onDone={close} />}
    </Sheet>
  );
}

function ConsentBody({ p, job, admin, onDone }: { p: P; job: WorkerJob; admin: boolean; onDone: () => void }) {
  const say = rtt(p.language);
  const [agreed, setAgreed] = useState(false);
  const [problem, setProblem] = useState(false);
  const { sent, send } = useSend(p.rpc, validateWorkerSet);
  const confirm = async () => {
    if (!agreed) { setProblem(true); return; }
    setProblem(false);
    if (await send('hosted.worker.set', { type: job.type, enabled: true, consent: true }) !== null && p.live(p.address)) onDone();
  };
  return (
    <div className={s.stack} data-consent={job.type}>
      <p className={s.text}>{say('RTT.hosted.consentJob', { title: job.title })}</p>
      <p className={s.text}>{say('RTT.hosted.consentBody')}</p>
      <p className={s.quiet}>{say('RTT.hosted.jobUses', { uses: job.uses })}</p>
      {admin ? (
        <>
          <label className={s.line}>
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.currentTarget.checked)} />
            <span>{say('RTT.hosted.consentTick')}</span>
          </label>
          {problem && <p className={s.problem} role="status">{say('RTT.hosted.consentNeeded')}</p>}
          <span><Button variant="filled" disabled={sent.kind === 'sending' || job.enabled} onClick={() => void confirm()}>{say('RTT.hosted.consentConfirm')}</Button></span>
          <Said sent={sent} done={() => say('RTT.hosted.jobOnNow')} language={p.language} />
        </>
      ) : <p className={s.quiet}>{words(COMMON, p.language).adminOnly}</p>}
    </div>
  );
}
