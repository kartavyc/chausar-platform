import { useContext, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useT } from '../../text';
import { useOwnerCountry, useOwnerZone } from '../../shell/clock';
import { useEngine, useResource } from '../../engine/context';
import type { BackupInspectLite, BackupLite, Deleted, MoveFile, UnlockMode } from '../../engine/types';
import { formatCount } from '../../../../../platform/runtime/owner-format';
import { Button } from '../../parts/Button';
import { Confirm } from '../../parts/Confirm';
import { Field } from '../../parts/Field';
import { PassphraseField } from '../../parts/PassphraseField';
import { CodeGroups } from '../../parts/Secret';
import { momentOf, refusalWords, saveTextFile } from '../../parts/custody';
import { formatBytes, formatTime } from '../../../../../platform/runtime/owner-format';
import { LeftContext, StartedContext } from '../onboarding/started';
import { CopyImport } from '../onboarding/CopyImport';
import s from './Business.module.css';
import { Fold } from '../../parts/Fold';
import { Reveal } from '../../parts/RevealBlock';
import { LoadingPlace } from '../../parts/Skeleton';
import { Progress, useWaitLabel } from '../../parts/Progress';

/**
 * The rest of Keep this business: what the old app's "Your workspace" menu and its Trust & access panel offered for
 * the open business (app/renderer/app.js showWorkspace, launch.js paintCustody), in Ink's look:
 *   AllBackups      every backup, each with a restore that asks first (workspace.backups.restore, confirmed)
 *   MoveAway        one move file and one code for another computer (workspace.transfer.export), the lasting
 *                   "Move file made" line until dismissed, and a recovery code first when there is none (C4 task 38)
 *   CloseBusiness   close it, or lock it when a passphrase opens it (workspace.lock)
 *   ExportCopy      a copy in the exports folder: encrypted, or readable after a second ask (workspace.export)
 *   OpenCopyFold    an exported copy back in (C5 task 21)
 *   DeleteBusiness  delete it, with its name typed as the vault holds it (workspace.delete)
 * Every refusal is the engine's, said in plain words. A passphrase or a code lives only in its field or on the screen
 * that shows it, and is cleared once it is sent or done with.
 */

const failed = (t: ReturnType<typeof useT>, error: unknown) => t('business.actionFailed', { message: refusalWords(error, t) });

/**
 * C4 task 36 (209.x1): the line after a restore. The app opens the business afresh after a restore, so the line waits
 * here for Keep this business to show it once ("Back to 1:35 am. How it was a moment ago is saved as a backup.").
 */
let restoredLine: string | null = null;
export function takeRestoredLine(): string | null { const line = restoredLine; restoredLine = null; return line; }

type T = ReturnType<typeof useT>;
const KIND_KEYS = new Set(['clients', 'orders', 'drafts', 'invoices', 'payments', 'bills', 'decisions', 'notes', 'routines', 'apps', 'tracker-rows', 'hired-agents', 'other']);
/** "3 clients": the kind's own plural words, or the engine's words for a kind this catalogue does not know yet. */
function kindWords(t: T, kind: string, words: string, count: number, country: string): string {
  const digits = formatCount(count, country);
  return KIND_KEYS.has(kind) ? t(`business.backupKind.${kind}`, { count: digits }) : `${digits} ${words}`;
}
const and = (items: string[]) => new Intl.ListFormat('en-IN', { type: 'conjunction' }).format(items);

/** "2 orders and 1 invoice added, 1 client changed": what a restore would take back, in the engine's kind order. */
function changeWords(t: T, since: BackupInspectLite['since'], country: string): string {
  const part = (field: 'added' | 'changed' | 'removed', key: string) => {
    const items = since.filter((row) => row[field] > 0).map((row) => kindWords(t, row.kind, row.words, row[field], country));
    return items.length ? [t(key, { list: and(items) })] : [];
  };
  return [...part('added', 'business.backupAdded'), ...part('changed', 'business.backupChanged'), ...part('removed', 'business.backupRemoved')].join(', ');
}

/**
 * One-shot C6 (SCREENS 213.x1): what a backup holds, read by the engine in memory once the owner opens the fold.
 */
function BackupContents({ backup }: { backup: BackupLite }) {
  const t = useT();
  const country = useOwnerCountry() ?? 'IN';
  const [open, setOpen] = useState(false);
  return (
    <Fold summary={t('business.backupContents')} className={s.fold} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <p className={s.quiet}>{`${t(`custody.kind.${backup.kind}`)}. ${t(backup.opensNow ? 'custody.opensNow' : 'custody.opensOlder')}`}</p>
      {backup.after && <p className={s.quiet} data-content="">{t('custody.after', { what: backup.after })}</p>}
      {open && <ContentsLine file={backup.file} country={country} />}
    </Fold>
  );
}
function ContentsLine({ file, country }: { file: string; country: string }) {
  const t = useT();
  const read = useResource('workspace.backups.inspect', { file }, { refreshOn: () => false });
  if (read.error) return <p className={s.problem} role="alert">{failed(t, read.error)}</p>;
  if (!read.data) return <p className={s.quiet} aria-busy="true">{t('business.backupReading')}</p>;
  const counts = read.data.counts.map((row) => kindWords(t, row.kind, row.words, row.count, country));
  return <p className={s.line}>{counts.length ? and(counts) : t('business.backupEmpty')}</p>;
}

/**
 * One-shot C6 (SCREENS 208.x1, 204.f1): the restore ask leads with what restoring takes back. Should the read fail,
 * the ask says what it always said.
 */
function RestoreChange({ backup }: { backup: BackupLite }) {
  const t = useT();
  const zone = useOwnerZone();
  const country = useOwnerCountry() ?? 'IN';
  const read = useResource('workspace.backups.inspect', { file: backup.file }, { refreshOn: () => false });
  if (read.error) return <p className={s.line}>{t('business.restoreAsk')}</p>;
  if (!read.data) return <p className={s.quiet} aria-busy="true">{t('business.backupReading')}</p>;
  const lead = read.data.since.length
    ? t('business.backupSince', { when: momentOf(backup.at, zone), changes: changeWords(t, read.data.since, country) })
    : t('business.backupNothing');
  return <p className={s.line}>{`${lead} ${t('business.restoreSafety')}`}</p>;
}

/** Every backup of this business, newest first. Restore says what happens and waits for a second press. */
export function AllBackups({ backups }: { backups: BackupLite[] }) {
  const t = useT();
  const zone = useOwnerZone();
  const client = useEngine();
  const restarted = useContext(StartedContext);
  const [asking, setAsking] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ file: string; text: string } | null>(null);
  if (backups.length === 0) return null;

  async function restore(backup: BackupLite) {
    setBusy(true);
    setProblem(null);
    try {
      await client.request('workspace.backups.restore', { file: backup.file, confirmed: true });
      restoredLine = t('business.restoredLine', { time: formatTime(backup.at, zone) });
      // The business is now how it was then: every place reads it again.
      restarted();
    } catch (error) {
      setProblem({ file: backup.file, text: failed(t, error) });
      setBusy(false);
    }
  }

  const list = (items: BackupLite[]) => (
      <ul className={s.list}>
        {items.map((backup) => (
          <li key={backup.file} className={s.backupRow}>
            <div className={s.backupLine}>
              <span className={s.strong}>{momentOf(backup.at, zone)}</span>
              {/* C4 task 36 (203.x1): each copy's size. Seam: C5 task 20 labels the copies, C6 tasks 1 and 2 their contents. */}
              <span className={s.quiet} data-bytes="">{formatBytes(backup.bytes)}</span>
              {asking !== backup.file && <Button variant="quiet" onClick={() => { setAsking(backup.file); setProblem(null); }}>{t('business.restore')}</Button>}
            </div>
            <BackupContents backup={backup} />
            {/* B4 (208.f1): the ask's buttons stay on the right, like every row's action. */}
            <Reveal open={asking === backup.file}>
              <Confirm action={t('business.restoreGo')} cancelLabel={t('business.restoreKeep')} busy={busy} onCancel={() => setAsking(null)} onConfirm={() => void restore(backup)}>
                {asking === backup.file && <RestoreChange backup={backup} />}
              </Confirm>
            </Reveal>
            {asking === backup.file && <Progress kind="restore" active={busy} />}
            {problem?.file === backup.file && <p className={s.problem} role="alert">{problem.text}</p>}
          </li>
        ))}
      </ul>
  );
  return <>
    {list(backups.slice(0, 3))}
    {backups.length > 3 && <Fold summary={t('business.olderBackups', { count: backups.length - 3 })} className={s.fold}>{list(backups.slice(3))}</Fold>}
  </>;
}

/**
 * Move to another computer: one file and one code, both from the engine. The code shows once in groups of four;
 * Save the file hands over the engine's text unchanged under the engine's name; Done forgets both.
 * C4 task 38: madeAt keeps a line on the page until the owner dismisses it (this computer can't see the move finish, so
 * Dismiss is what ends it); with no recovery code the fold says to make one first (onMakeCode is Keep's own flow).
 */
export function MoveAway({ locked, madeAt, noCode, onChanged, onMakeCode, open, onOpenChange }: { locked: boolean; madeAt: string | null; noCode: boolean; onChanged: () => void; onMakeCode: (passphrase: string | null) => Promise<void>; open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useT();
  const zone = useOwnerZone();
  const client = useEngine();
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [making, setMaking] = useState(false);
  const makeLabel = useWaitLabel(t('business.moveMaking'), making);
  const [problem, setProblem] = useState<string | null>(null);
  const [made, setMade] = useState<MoveFile | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const fold = useRef<HTMLDetailsElement>(null);
  useEffect(() => { if (!open) setPassphrase(''); }, [open]);

  async function make(event: FormEvent) {
    event.preventDefault();
    if (locked && !passphrase) { setProblem(t('custody.enterPassphrase')); return; }
    const typed = passphrase;
    setPassphrase('');
    setBusy(true);
    setMaking(true);
    setProblem(null);
    try {
      setMade(await client.request('workspace.transfer.export', locked ? { passphrase: typed } : {}) as MoveFile);
      onChanged();
    } catch (error) {
      setProblem(failed(t, error));
    } finally {
      setBusy(false);
      setMaking(false);
    }
  }

  async function dismiss() {
    setBusy(true);
    setProblem(null);
    try {
      await client.request('workspace.transfer.export', { dismiss: true });
      onChanged();
    } catch (error) {
      setProblem(failed(t, error));
    } finally {
      setBusy(false);
    }
  }

  /** The nudge's button: a locked business takes the passphrase typed in this fold, as Make the file does. */
  function makeCode() {
    if (locked && !passphrase) { setProblem(t('custody.enterPassphrase')); return; }
    const typed = passphrase;
    setPassphrase('');
    setProblem(null);
    void onMakeCode(locked ? typed : null);
  }

  function copy(code: string) {
    const done = () => setCopied(t('business.moveCopied'));
    const not = () => setCopied(t('business.copyFailed'));
    if (!navigator.clipboard) { not(); return; }
    navigator.clipboard.writeText(code).then(done, not);
  }

  function forget() {
    setMade(null);
    setCopied(null);
    setProblem(null);
    fold.current?.querySelector('summary')?.focus();
  }

  return (
    <>
    {madeAt && (
      <p className={s.line} data-move-made="">
        <span>{t('business.moveMadeLine', { when: momentOf(madeAt, zone) })}</span>{' '}
        <Button variant="quiet" size="sm" disabled={busy} onClick={() => void dismiss()}>{t('business.moveMadeDismiss')}</Button>
      </p>
    )}
    <Fold ref={fold} name="keep-action" open={open} summary={t('business.move')} className={s.fold}
      onToggle={event => onOpenChange(event.currentTarget.open)}>
      {open && (made ? (
        <div>
          <p className={s.line}>{t('business.moveCodeOnce')}</p>
          <div className={s.buttons}>
            <CodeGroups code={made.transferCode} label={t('business.moveCode')} />
            <Button variant="quiet" onClick={() => copy(made.transferCode)}>{t('business.copy')}</Button>
            {copied && <span className={s.note} role="status">{copied}</span>}
          </div>
          <div className={s.buttons}><Button variant="primary" onClick={() => { if (!saveTextFile(made.fileName, made.text, 'application/json')) setProblem(t('business.moveCantSave')); }}>{t('business.moveSave')}</Button></div>
          <p className={s.warn}>{t('business.moveWarnApart')}</p>
          <p className={s.note}>{t('business.moveWarnBoth')}</p>
          {problem && <p className={s.problem} role="alert">{problem}</p>}
          <div className={s.buttons}><Button variant="quiet" onClick={forget}>{t('business.done')}</Button></div>
        </div>
      ) : (
        <form className={s.form} onSubmit={(event) => void make(event)}>
          <p className={s.line}>{t('business.moveLine')}</p>
          {locked && <PassphraseField label={t('business.yourPassphrase')} autoComplete="current-password" value={passphrase} onChange={setPassphrase} />}
          {noCode && (
            <>
              <p className={s.warn}>{t('business.moveCodeFirst')}</p>
              <div className={s.buttons}><Button disabled={busy} onClick={makeCode}>{t('business.moveCodeMake')}</Button></div>
            </>
          )}
          {problem && <p className={s.problem} role="alert">{problem}</p>}
          <div className={s.buttons}><Button type="submit" disabled={busy} aria-busy={making || undefined}><span>{making ? makeLabel : t('business.moveMake')}</span></Button></div>
        </form>
      ))}
    </Fold>
    </>
  );
}

/**
 * Close the business on this computer, or lock it when a passphrase opens it (workspace.lock). The engine keeps one
 * business open; afterwards the app goes back to Welcome back and nothing of this business stays on screen.
 */
export function CloseBusiness({ unlock }: { unlock: UnlockMode | null }) {
  const t = useT();
  const client = useEngine();
  const left = useContext(LeftContext);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const locked = unlock === 'passphrase';

  async function close() {
    setBusy(true);
    setProblem(null);
    try {
      await client.request('workspace.lock', {});
      left();
    } catch (error) {
      setProblem(failed(t, error));
      setBusy(false);
    }
  }

  return (
    <Fold name="keep-action" summary={t(locked ? 'business.lock' : 'business.close')} className={s.fold}>
      <div className={s.buttons}><Button variant="quiet" disabled={busy} onClick={() => void close()}>{t(locked ? 'business.lock' : 'business.close')}</Button></div>
      {unlock && <p className={s.note}>{t(locked ? 'business.lockLine' : 'business.closeLine')}</p>}
      {problem && <p className={s.problem} role="alert">{problem}</p>}
    </Fold>
  );
}

/** The export fold's id, so Delete's "Export a copy first" opens it. */
const EXPORT_FOLD = 'keep-export-copy';

/** A copy in Chausar's exports folder. Encrypted unless the owner chooses readable and says yes to it a second time. */
export function ExportCopy() {
  const t = useT();
  const client = useEngine();
  const name = useId();
  const [readable, setReadable] = useState(false);
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyLabel = useWaitLabel(t('business.exporting'), busy);
  const [problem, setProblem] = useState<string | null>(null);
  // C4 task 36 (206.x1): the file's name only, never a path; id: the desktop's Show in folder for a copy it saved.
  const [saved, setSaved] = useState<{ name: string; encrypted: boolean; id?: string } | null>(null);

  async function go(event: FormEvent) {
    event.preventDefault();
    if (readable && !sure) return;
    setBusy(true);
    setProblem(null);
    setSaved(null);
    try {
      if (client.saveBusinessExport) {
        // The desktop asks where to save in its own dialog; a cancel writes nothing and says nothing.
        const done = await client.saveBusinessExport(readable);
        if (!done) return;
        setSaved(done);
      } else {
        const done = await client.request('workspace.export', { confirmed: true, plaintext: readable });
        setSaved({ name: done.name ?? done.path.split(/[\\/]/).pop() ?? '', encrypted: done.encrypted });
      }
      // A readable copy is asked for each time.
      setSure(false);
    } catch (error) {
      setProblem(failed(t, error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Fold summary={t('business.export')} className={s.fold} id={EXPORT_FOLD}>
      <form className={s.form} onSubmit={(event) => void go(event)}>
        <fieldset className={s.choices}>
          <legend className="sr-only">{t('business.exportKind')}</legend>
          <label className={s.agree}>
            <input type="radio" name={name} checked={!readable} onChange={() => { setReadable(false); setSure(false); setProblem(null); setSaved(null); }} />
            {t('business.exportEncrypted')}
          </label>
          <label className={s.agree}>
            <input type="radio" name={name} checked={readable} onChange={() => { setReadable(true); setProblem(null); setSaved(null); }} />
            {t('business.exportReadable')}
          </label>
        </fieldset>
        {readable ? (
          <>
            <p className={s.warn}>{t('business.exportReadableWarn')}</p>
            <label className={s.agree}>
              <input type="checkbox" checked={sure} onChange={(event) => setSure(event.currentTarget.checked)} />
              {t('business.exportSure')}
            </label>
          </>
        ) : <p className={s.note}>{t('business.exportEncryptedLine')}</p>}
        {problem && <p className={s.problem} role="alert">{problem}</p>}
        <div className={s.buttons}><Button type="submit" disabled={busy} aria-busy={busy || undefined} disabledReason={readable && !sure ? t('business.exportTick') : undefined}><span>{busy ? busyLabel : t('business.export')}</span></Button></div>
        {saved && (
          <div role="status">
            <p className={s.said}>
              {t('business.exportSaved', { name: saved.name })}
              {saved.id && client.showSavedExport && <> <Button variant="quiet" onClick={() => { void client.showSavedExport!(saved.id!).catch((error: unknown) => setProblem(failed(t, error))); }}>{t('business.deletedShow')}</Button></>}
            </p>
            {!saved.encrypted && <p className={s.warn}>{t('business.exportPlain')}</p>}
          </div>
        )}
      </form>
    </Fold>
  );
}

/** C5 task 21: an exported copy, from inside a business: a copy of this business offers to restore it; another waits until this one is closed. */
export function OpenCopyFold() {
  const t = useT();
  const client = useEngine();
  const restarted = useContext(StartedContext);
  if (!client.pickCopy || !client.importCopy) return null;
  return (
    <Fold summary={t('onboarding.copy.title')} className={s.fold}>
      <CopyImport onOpened={restarted} />
    </Fold>
  );
}

/**
 * Delete this business: what it removes and what it can't, then the business name typed exactly as the vault holds
 * it (workspace.status, which can differ from the plan's working name). A wrong name is refused here, before the engine.
 */
export function DeleteBusiness({ onDeleted, counts }: { onDeleted: (result: Deleted) => void; counts?: { backups: number; exports: number } | null }) {
  const t = useT();
  const client = useEngine();
  const status = useResource('workspace.status', {});
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const busyLabel = useWaitLabel(t('business.deleting'), busy);
  const [problem, setProblem] = useState<string | null>(null);
  const name = status.data?.workspace?.name ?? null;
  // "Export a copy first": opens the export fold above, where the owner picks where it goes.
  const openExport = () => {
    const fold = document.getElementById(EXPORT_FOLD) as HTMLDetailsElement | null;
    if (!fold) return;
    fold.open = true;
    fold.querySelector('summary')?.focus();
  };

  async function go(event: FormEvent) {
    event.preventDefault();
    if (name === null) return;
    if (typed !== name) { setProblem(t('business.deleteExact')); return; }
    setBusy(true);
    setProblem(null);
    try {
      onDeleted(await client.request('workspace.delete', { confirmation: typed }));
    } catch (error) {
      setProblem(failed(t, error));
      setBusy(false);
    }
  }

  return (
    <Fold summary={t('business.delete')} className={s.fold} tone="danger">
      {name === null ? (
        status.error ? <p className={s.problem} role="alert">{failed(t, status.error)}</p> : <LoadingPlace shape="settings" />
      ) : (
        <form className={s.form} onSubmit={(event) => void go(event)}>
          <p className={s.line}>{t('business.deleteWhat', { name })}</p>
          {/* C4 task 37 (210.x1, 210.x2): how many go and stay, from the custody view, and a copy first. */}
          {counts && (counts.backups > 0 || counts.exports > 0) && (
            <p className={s.line} data-delete-counts="">
              {[counts.backups > 0 ? t(counts.backups === 1 ? 'business.deleteRemoves.one' : 'business.deleteRemoves', { count: String(counts.backups) }) : '',
                counts.exports > 0 ? t(counts.exports === 1 ? 'business.deleteKeeps.one' : 'business.deleteKeeps', { count: String(counts.exports) }) : ''].filter(Boolean).join(' ')}
            </p>
          )}
          <div className={s.buttons}><Button variant="quiet" onClick={openExport}>{t('business.exportFirst')}</Button></div>
          <p className={s.warn}>{t('business.deleteCant')}</p>
          <Field label={t('business.deleteType', { name })} value={typed} autoComplete="off" spellCheck={false} onChange={(event) => setTyped(event.currentTarget.value)} />
          {problem && <p className={s.problem} role="alert">{problem}</p>}
          <div className={s.buttons}><Button type="submit" tone="danger" disabled={busy} aria-busy={busy || undefined} disabledReason={typed !== name ? t('business.deleteTypeFirst') : undefined}><span>{busy ? busyLabel : t('business.delete')}</span></Button></div>
        </form>
      )}
    </Fold>
  );
}

/** After a delete: the engine's words for the copies it can't reach, then Welcome back, opening nothing by itself. */
export function DeletedNote({ result }: { result: Deleted }) {
  const t = useT();
  const client = useEngine();
  const [problem, setProblem] = useState<string | null>(null);
  // Review of A1 (row 1): the copies Delete kept, by file name, and whether each is readable (not encrypted).
  const kept = (result.exportsKept ?? []).map((path) => {
    const name = path.split(/[\\/]/).pop() ?? path;
    return { path, name, readable: /\.(json|csv)$/.test(name) };
  });
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  return (
    <section className={s.deletedNote} aria-label={t('business.deleted')}>
      <h2 ref={heading} tabIndex={-1} className={s.name}>{t('business.deleted')}</h2>
      {/* C4 task 37 (211.x1, 212.x1): what went, by name and count. */}
      {result.name && <p className={s.line}>{t(result.backupsRemoved === 1 ? 'business.deletedNamed.one' : 'business.deletedNamed', { name: result.name, count: String(result.backupsRemoved ?? 0) })}</p>}
      <p className={s.line}>{result.externalCopies}</p>
      {kept.length > 0 && (
        <>
          <p className={s.line}>{t('business.deletedKept')}</p>
          <ul className={s.kept}>
            {kept.map((copy) => (
              <li key={copy.path}>
                <span className={s.said} data-content="">{copy.name}</span>
                {copy.readable && <p className={s.warn}>{t('business.deletedReadable')}</p>}
                {client.showExport && <Button variant="quiet" onClick={() => { void client.showExport!(copy.name).catch((error: unknown) => setProblem(failed(t, error))); }}>{t('business.deletedShow')}</Button>}
              </li>
            ))}
          </ul>
          {problem && <p className={s.problem} role="alert">{problem}</p>}
        </>
      )}
    </section>
  );
}
