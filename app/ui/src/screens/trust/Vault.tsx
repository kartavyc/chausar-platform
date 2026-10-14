/**
 * TR-12 Vault: the last backup and its test restore; Back up now; Test restore with a
 * passphrase that is cleared after the call; the lock; the disk check with the engine's
 * own limit sentence; the recovery contact (experimental); the version; where Restore is.
 * The deletion sheet (TR-13) opens from here.
 */
import { useState, type FormEvent } from 'react';
import { withSheet } from '../../app/routes.ts';
import { words } from '../../places/types.ts';
import { Button } from '../../parts/Button';
import { YesNo } from '../../parts/Choice';
import { Field } from '../../parts/Field';
import { useEngine, useSend } from './kit/engine.ts';
import { Group, Note, Screen } from './kit/Screen';
import { Outcome, Refusal, Tag, bytesText, countText, dayText, powers, type P } from './common';
import { DeletionSheet } from './Deletion';
import { wholeNumber } from './paise.ts';
import { validateBackup, validateVault, type Backup, type VaultView } from './validate.ts';
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
          <p className={s.text}>{w.idle}: {countText(v.lock.idleMinutes)} · {w.deviceCheck}: {v.lock.deviceCheck ? c.on : c.off}</p>
        )}
      </Group>
      <Group title={w.diskTitle}>
        <p className={s.text}>{v.disk === null ? w.noDisk : fill(w.disk, { free: bytesText(v.disk.freeBytes, p.language), total: bytesText(v.disk.totalBytes, p.language) })}</p>
        <p className={s.quiet} data-limit="">{v.limit}</p>
      </Group>
      <Group title={w.recoveryTitle} note={w.recoveryNote}>
        <p className={s.text}>{v.recoveryContact === null ? w.recoveryNone : fill(w.recoveryIs, { name: v.recoveryContact })} <Tag>{c.experimental}</Tag></p>
        {admin && <RecoveryForm p={p} name={v.recoveryContact} reload={reload} />}
      </Group>
      <Group title={w.versionTitle}><p className={s.mono}>{v.version}</p></Group>
      <Group title={w.restoreTitle}><p className={s.text}>{w.restoreNote}</p></Group>
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
  const [minutes, setMinutes] = useState(String(v.lock.idleMinutes));
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

function RecoveryForm({ p, name, reload }: { p: P; name: string | null; reload: () => void }) {
  const c = words(COMMON, p.language), w = words(VAULT, p.language);
  const [typed, setTyped] = useState(name ?? '');
  const { sent, send } = useSend(p.rpc, validateVault);
  const save = async (value: string | null) => { if (await send('trustx.setRecoveryContact', { name: value }) !== null && p.live(p.address)) reload(); };
  return (
    <form className={s.form} onSubmit={(e) => { e.preventDefault(); if (typed.trim().length > 0) void save(typed.trim()); }}>
      <Field label={w.recoveryName} value={typed} onChange={(e) => setTyped(e.currentTarget.value)} autoComplete="off" />
      <Button submit disabled={sent.kind === 'sending' || typed.trim().length === 0}>{c.save}</Button>
      {name !== null && <Button variant="link" onClick={() => { setTyped(''); void save(null); }}>{w.clearRecovery}</Button>}
      <Outcome sent={sent} language={p.language} />
    </form>
  );
}
