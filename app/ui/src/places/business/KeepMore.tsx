import { useContext, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useT } from '../../text';
import { useOwnerCountry, useOwnerZone } from '../../shell/clock';
import { useEngine, useResource } from '../../engine/context';
import type { BackupInspectLite, BackupLite, Deleted, MoveFile, UnlockMode } from '../../engine/types';
import { formatCount } from '../../../../../platform/runtime/owner-format';
import { Button } from '../../parts/Button';
import { Field } from '../../parts/Field';
import { CodeGroups } from '../../parts/Secret';
import { momentOf, refusalWords, saveTextFile } from '../../parts/custody';
import { LeftContext, StartedContext } from '../onboarding/started';
import s from './Business.module.css';

/**
 * The rest of Keep this business: what the old app's "Your workspace" menu and its Trust & access panel offered for
 * the open business (app/renderer/app.js showWorkspace, launch.js paintCustody), in Ink's look:
 *   AllBackups      every backup, each with a restore that asks first (workspace.backups.restore, confirmed)
 *   MoveAway        one move file and one code for another computer (workspace.transfer.export)
 *   CloseBusiness   close it, or lock it when a passphrase opens it (workspace.lock)
 *   ExportCopy      a copy in the exports folder: encrypted, or readable after a second ask (workspace.export)
 *   DeleteBusiness  delete it, with its name typed as the vault holds it (workspace.delete)
 * Every refusal is the engine's, said in plain words. A passphrase or a code lives only in its field or on the screen
 * that shows it, and is cleared once it is sent or done with.
 */

const failed = (t: ReturnType<typeof useT>, error: unknown) => t('business.actionFailed', { message: refusalWords(error, t) });

type T = ReturnType<typeof useT>;
const KIND_KEYS = new Set(['clients', 'orders', 'drafts', 'invoices', 'payments', 'bills', 'decisions', 'notes', 'routines', 'apps', 'other']);
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
 * Seam: a native fold until C3's Fold part lands; the integrator swaps it.
 */
function BackupContents({ file }: { file: string }) {
  const t = useT();
  const country = useOwnerCountry() ?? 'IN';
  const [open, setOpen] = useState(false);
  return (
    <details className={s.fold} onToggle={(event) => setOpen((event.currentTarget as HTMLDetailsElement).open)}>
      <summary>{t('business.backupContents')}</summary>
      {open && <ContentsLine file={file} country={country} />}
    </details>
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
 * the ask says what it always said. Seam: B4's Confirm wraps this when it lands.
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
      // The business is now how it was then: every place reads it again.
      restarted();
    } catch (error) {
      setProblem({ file: backup.file, text: failed(t, error) });
      setBusy(false);
    }
  }

  return (
    <details className={s.fold}>
      <summary>{t('business.allBackups', { count: String(backups.length) })}</summary>
      <ul className={s.list}>
        {backups.map((backup) => (
          <li key={backup.file} className={s.backupRow}>
            <div className={s.backupLine}>
              <span className={s.strong}>{momentOf(backup.at, zone)}</span>
              <span className={s.quiet}>{`${t(`custody.kind.${backup.kind}`)}. ${t(backup.opensNow ? 'custody.opensNow' : 'custody.opensOlder')}`}</span>
              {asking !== backup.file && <Button variant="quiet" onClick={() => { setAsking(backup.file); setProblem(null); }}>{t('business.restore')}</Button>}
            </div>
            <BackupContents file={backup.file} />
            {asking === backup.file && (
              <>
                <RestoreChange backup={backup} />
                <div className={s.buttons}>
                  <Button variant="primary" disabled={busy} onClick={() => void restore(backup)}>{t('business.restoreGo')}</Button>
                  <Button variant="quiet" disabled={busy} onClick={() => setAsking(null)}>{t('business.restoreKeep')}</Button>
                </div>
              </>
            )}
            {problem?.file === backup.file && <p className={s.problem} role="alert">{problem.text}</p>}
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * Move to another computer: one file and one code, both from the engine. The code shows once in groups of four;
 * Save the file hands over the engine's text unchanged under the engine's name; Done forgets both.
 */
export function MoveAway({ locked }: { locked: boolean }) {
  const t = useT();
  const client = useEngine();
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [made, setMade] = useState<MoveFile | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  async function make(event: FormEvent) {
    event.preventDefault();
    if (locked && !passphrase) { setProblem(t('custody.enterPassphrase')); return; }
    const typed = passphrase;
    setPassphrase('');
    setBusy(true);
    setProblem(null);
    try {
      setMade(await client.request('workspace.transfer.export', locked ? { passphrase: typed } : {}));
    } catch (error) {
      setProblem(failed(t, error));
    } finally {
      setBusy(false);
    }
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
  }

  return (
    <details className={s.fold}>
      <summary>{t('business.move')}</summary>
      {made ? (
        <div>
          <p className={s.line}>{t('business.moveCodeOnce')}</p>
          <CodeGroups code={made.transferCode} label={t('business.moveCode')} />
          <div className={s.buttons}>
            <Button variant="primary" onClick={() => { if (!saveTextFile(made.fileName, made.text, 'application/json')) setProblem(t('business.moveCantSave')); }}>{t('business.moveSave')}</Button>
            <Button variant="quiet" onClick={() => copy(made.transferCode)}>{t('business.copy')}</Button>
            {copied && <span className={s.note} role="status">{copied}</span>}
          </div>
          <p className={s.warn}>{t('business.moveWarnApart')}</p>
          <p className={s.note}>{t('business.moveWarnBoth')}</p>
          {problem && <p className={s.problem} role="alert">{problem}</p>}
          <div className={s.buttons}><Button variant="quiet" onClick={forget}>{t('business.done')}</Button></div>
        </div>
      ) : (
        <form className={s.form} onSubmit={(event) => void make(event)}>
          <p className={s.line}>{t('business.moveLine')}</p>
          {locked && <Field label={t('business.yourPassphrase')} type="password" autoComplete="current-password" spellCheck={false} value={passphrase} onChange={(event) => setPassphrase(event.currentTarget.value)} />}
          {problem && <p className={s.problem} role="alert">{problem}</p>}
          <div className={s.buttons}><Button type="submit" disabled={busy}>{t('business.moveMake')}</Button></div>
        </form>
      )}
    </details>
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
    <section className={s.moreRow} aria-label={t(locked ? 'business.lock' : 'business.close')}>
      <div className={s.buttons}><Button disabled={busy} onClick={() => void close()}>{t(locked ? 'business.lock' : 'business.close')}</Button></div>
      {unlock && <p className={s.note}>{t(locked ? 'business.lockLine' : 'business.closeLine')}</p>}
      {problem && <p className={s.problem} role="alert">{problem}</p>}
    </section>
  );
}

/** A copy in Chausar's exports folder. Encrypted unless the owner chooses readable and says yes to it a second time. */
export function ExportCopy() {
  const t = useT();
  const client = useEngine();
  const name = useId();
  const [readable, setReadable] = useState(false);
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ path: string; encrypted: boolean } | null>(null);

  async function go(event: FormEvent) {
    event.preventDefault();
    if (readable && !sure) { setProblem(t('business.exportTick')); return; }
    setBusy(true);
    setProblem(null);
    setSaved(null);
    try {
      setSaved(await client.request('workspace.export', { confirmed: true, plaintext: readable }));
      // A readable copy is asked for each time.
      setSure(false);
    } catch (error) {
      setProblem(failed(t, error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className={s.fold}>
      <summary>{t('business.export')}</summary>
      <form className={s.form} onSubmit={(event) => void go(event)}>
        <fieldset className={s.choices}>
          <legend className="sr-only">{t('business.exportKind')}</legend>
          <label className={s.agree}>
            <input type="radio" name={name} checked={!readable} onChange={() => { setReadable(false); setSure(false); setProblem(null); }} />
            {t('business.exportEncrypted')}
          </label>
          <label className={s.agree}>
            <input type="radio" name={name} checked={readable} onChange={() => { setReadable(true); setProblem(null); }} />
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
        <div className={s.buttons}><Button type="submit" disabled={busy}>{t('business.export')}</Button></div>
        {saved && (
          <div role="status">
            <p className={s.said}>{t('business.exportSaved', { path: saved.path })}</p>
            {!saved.encrypted && <p className={s.warn}>{t('business.exportPlain')}</p>}
          </div>
        )}
      </form>
    </details>
  );
}

/**
 * Delete this business: what it removes and what it can't, then the business name typed exactly as the vault holds
 * it (workspace.status, which can differ from the plan's working name). A wrong name is refused here, before the engine.
 */
export function DeleteBusiness({ onDeleted }: { onDeleted: (result: Deleted) => void }) {
  const t = useT();
  const client = useEngine();
  const status = useResource('workspace.status', {});
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const name = status.data?.workspace?.name ?? null;

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
    <details className={s.fold}>
      <summary>{t('business.delete')}</summary>
      {name === null ? (
        status.error ? <p className={s.problem} role="alert">{failed(t, status.error)}</p> : <p className={s.note}>{t('business.loading')}</p>
      ) : (
        <form className={s.form} onSubmit={(event) => void go(event)}>
          <p className={s.line}>{t('business.deleteWhat', { name })}</p>
          <p className={s.warn}>{t('business.deleteCant')}</p>
          <Field label={t('business.deleteType', { name })} value={typed} autoComplete="off" spellCheck={false} onChange={(event) => setTyped(event.currentTarget.value)} />
          {problem && <p className={s.problem} role="alert">{problem}</p>}
          <div className={s.buttons}><Button type="submit" disabled={busy}>{t('business.delete')}</Button></div>
        </form>
      )}
    </details>
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
    return { path, name, readable: name.endsWith('.json') };
  });
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  return (
    <section className={s.deletedNote} aria-label={t('business.deleted')}>
      <h2 ref={heading} tabIndex={-1} className={s.name}>{t('business.deleted')}</h2>
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
