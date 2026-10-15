/**
 * TR-12 Vault: the last backup and its test restore; Back up now; Test restore with a
 * passphrase that is cleared after the call; the lock; the disk check with the engine's
 * own limit sentence; the recovery contact (experimental); the version; where Restore is.
 * The deletion sheet (TR-13) opens from here.
 */
import { RecoveryContactSettings } from '../first-run/ThisComputer';
import { useState, type FormEvent } from 'react';
import { withSheet } from '../../app/routes.ts';
import { words } from '../../places/types.ts';
import { Button } from '../../parts/Button';
import { YesNo } from '../../parts/Choice';
import { Field } from '../../parts/Field';
import { useEngine, useSend } from './kit/engine.ts';
import { Group, Note, Screen } from './kit/Screen';
import { AskTwice, Loads, Outcome, Refusal, Tag, bytesText, countText, dayText, powers, type P } from './common';
import { DeletionSheet } from './Deletion';
import { ComputerSettings, RestoreFile } from './Computer';
import { wholeNumber } from './paise.ts';
import { validateBackup, validateService, validateVault, type Backup, type ServiceStatus, type VaultView } from './validate.ts';
import { COMMON, VAULT, fill } from './words.ts';
import s from './Trust.module.css';

export function VaultScreen(p: P) {
  const c = words(COMMON, p.language);
  const { state, reload } = useEngine(p.rpc, 'trustx.vault', {}, validateVault);
  return (
    <>
      <Screen where={c.whereVault} title={c.vault} loaded={state}>{(v) => <VaultBody p={p} v={v} reload={reload} />}</Screen>
      {p.address.sheet === 'delete' && <DeletionSheet p={p} />}
    </>
  );
}

function backupLine(b: Backup, p: P): string {
  const w = words(VAULT, p.language);
  return `${fill(w.backupOn, { date: dayText(b.at, p.language), size: bytesText(b.bytes, p.language) })} ${w[`test.${b.testRestore}`]}`;
}

function VaultBody({ p, v, reload }: { p: P; v: VaultView; reload: () => void }) {
  const c = words(COMMON, p.language), w = words(VAULT, p.language);
  const { admin, owner } = powers(p);
  const backup = useSend(p.rpc, validateBackup);
  const last = v.backups[0];
  const backupNow = async () => { if (await backup.send('trustx.backupNow', {}) !== null && p.live(p.address)) reload(); };
  return (
    <>
      <Group title={w.backupTitle}>
        <p className={s.text}>{last === undefined ? w.noBackup : backupLine(last, p)}</p>
        {p.view === 'books' && last !== undefined && <p className={s.mono}>{last.file}</p>}
        {admin && <span><Button variant="quiet" onClick={() => void backupNow()} disabled={backup.sent.kind === 'sending'}>{w.backupNow}</Button></span>}
        <Outcome sent={backup.sent} language={p.language} />
      </Group>
      {admin && last !== undefined && <TestRestore p={p} file={last.file} reload={reload} />}
      <Group title={w.lockTitle}>
        {admin ? <LockForm p={p} v={v} reload={reload} /> : (
          <p className={s.text}>{w.idle}: {v.lock.idleMinutes === null ? w.idleUnknown : countText(v.lock.idleMinutes)} · {w.deviceCheck}: {v.lock.deviceCheck ? c.on : c.off}</p>
        )}
        {admin && v.lock.idleMinutes === null && <p className={s.quiet}>{w.idleUnknown}</p>}
        <p className={s.quiet} data-pin="">{w.pin}</p>
      </Group>
      <Group title={w.diskTitle}>
        <p className={s.text}>{v.disk === null ? w.noDisk : fill(w.disk, { free: bytesText(v.disk.freeBytes, p.language), total: bytesText(v.disk.totalBytes, p.language) })}</p>
        <p className={s.quiet} data-limit="">{v.limit}</p>
      </Group>
      <Group title={w.recoveryTitle} note={w.recoveryNote}>
        {/* The recovery contact is frame-today's (one source of truth, also set in first run). */}
        <p className={s.text}><Tag>{c.experimental}</Tag></p>
        {admin ? <RecoveryContactSettings rpc={p.rpc} /> : <p className={s.text}>{v.recoveryContact === null ? w.recoveryNone : fill(w.recoveryIs, { name: v.recoveryContact })}</p>}
      </Group>
      <Group title={w.versionTitle}>{v.version === null ? <p className={s.quiet}>{w.versionUnknown}</p> : <p className={s.mono}>{v.version}</p>}</Group>
      <Group title={w.restoreTitle}><p className={s.text}>{w.restoreNote}</p><RestoreFile p={p} file={last?.file ?? null} /></Group>
      <ThisComputer p={p} />
      {owner && <span><Button variant="link" onClick={() => p.navigate(withSheet(p.address, 'delete'))}>{w.deleteLink}</Button></span>}
      {!admin && <Note>{c.adminOnly}</Note>}
    </>
  );
}

function TestRestore({ p, file, reload }: { p: P; file: string; reload: () => void }) {
  const w = words(VAULT, p.language);
  const [passphrase, setPassphrase] = useState('');
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const { sent, send } = useSend(p.rpc, validateBackup);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (passphrase.length === 0) { setProblem(w.needPass); return; }
    setProblem(undefined);
    const typed = passphrase;
    const done = await send('trustx.testRestore', { file, passphrase: typed });
    setPassphrase('');
    if (done !== null && p.live(p.address)) reload();
  };
  return (
    <Group title={w.testTitle}>
      <form className={s.form} onSubmit={(e) => void submit(e)}>
        <Field label={w.passphrase} type="password" autoComplete="off" value={passphrase} onChange={(e) => setPassphrase(e.currentTarget.value)} problem={problem} />
        <Button submit disabled={sent.kind === 'sending'}>{w.runTest}</Button>
      </form>
      {sent.kind === 'done' && <p className={sent.value.testRestore === 'passed' ? s.status : s.problem} role="status">{sent.value.testRestore === 'passed' ? w.testPassed : w.testFailed}</p>}
      {sent.kind === 'refused' && <Refusal code={sent.code} language={p.language} />}
    </Group>
  );
}

function LockForm({ p, v, reload }: { p: P; v: VaultView; reload: () => void }) {
  const w = words(VAULT, p.language);
  const [minutes, setMinutes] = useState(v.lock.idleMinutes === null ? '' : String(v.lock.idleMinutes));
  const [deviceCheck, setDeviceCheck] = useState(v.lock.deviceCheck);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const { sent, send } = useSend(p.rpc, validateVault);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const idleMinutes = wholeNumber(minutes, 1440);
    if (idleMinutes === null || idleMinutes === 0) { setProblem(w.badMinutes); return; }
    setProblem(undefined);
    if (await send('trustx.setLock', { idleMinutes, deviceCheck }) !== null && p.live(p.address)) reload();
  };
  return (
    <form className={s.stack} onSubmit={(e) => void submit(e)}>
      <Field label={w.idle} value={minutes} onChange={(e) => setMinutes(e.currentTarget.value)} inputMode="numeric" problem={problem} />
      <div className={s.line}><span className={s.label}>{w.deviceCheck}</span><YesNo label={w.deviceCheck} value={deviceCheck} onChange={setDeviceCheck} /></div>
      <span><Button submit disabled={sent.kind === 'sending'}>{w.saveLock}</Button></span>
      <Outcome sent={sent} language={p.language} />
    </form>
  );
}

function ThisComputer({ p }: { p: P }) {
  const w = words(VAULT, p.language);
  const { admin } = powers(p);
  if (!admin) return <Group title={w.computerTitle}><p className={s.quiet}>{w.computerAdmin}</p><p className={s.quiet}>{w.wake}</p></Group>;
  // TR-07/12/14 vault-hosted-keys: start at login, background mode and wake for jobs (SH-07).
  return <><ServiceGroup p={p} /><ComputerSettings p={p} /></>;
}

function ServiceGroup({ p }: { p: P }) {
  const w = words(VAULT, p.language);
  const { state, reload } = useEngine(p.rpc, 'service.status', {}, validateService);
  const { sent, send } = useSend(p.rpc, validateService);
  const change = async (method: string) => { if (await send(method, { confirmed: true }) !== null && p.live(p.address)) reload(); };
  const said = (x: ServiceStatus) => w[`service.${!x.installed ? 'off' : x.running === null ? 'unknown' : x.running ? 'running' : 'stopped'}`];
  return (
    <Loads title={w.computerTitle} note={w.serviceNote} loaded={state}>
      {(x) => (
        <div className={s.stack}>
          <p className={s.text} data-service="">{w.service}: {said(x)}</p>
          <span>
            {x.installed
              ? <AskTwice label={w.turnOff} ask={w.turnOffAsk} confirmLabel={w.turnOff} onConfirm={() => void change('service.uninstall')} language={p.language} disabled={sent.kind === 'sending'} />
              : <AskTwice label={w.turnOn} ask={w.turnOnAsk} confirmLabel={w.turnOn} onConfirm={() => void change('service.install')} language={p.language} disabled={sent.kind === 'sending'} />}
          </span>
          <Outcome sent={sent} language={p.language} />
        </div>
      )}
    </Loads>
  );
}
