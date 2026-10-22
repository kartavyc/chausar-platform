import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useLanguage, useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { Button } from '../../parts/Button';
import { EmptyState } from '../../parts/EmptyState';
import { Field } from '../../parts/Field';
import { momentOf, saveTextFile } from '../../parts/custody';
import type { CustodyViewLite, Deleted, UnlockMode } from '../../engine/types';
import { AllBackups, CloseBusiness, DeleteBusiness, DeletedNote, ExportCopy, MoveAway } from './KeepMore';
import { messageOf } from './shared';
import s from './Business.module.css';

/**
 * Keep this business (workspace.custody.*), the way the old app keeps it: this computer's protected storage keeps the
 * key for the owner's login, so there is no passphrase to type. Keeping it means making the recovery code, shown
 * once, which takes Today's "Keep this business" away. The passphrase is optional and sits behind a fold; where the
 * computer has no protected storage the engine says so in its own words. Every state shown is the engine's; neither
 * a passphrase nor a code outlives the screen that showed it.
 *
 * Below it, everything else the old app's workspace menu offered for the open business (KeepMore.tsx): every backup
 * with its restore, moving to another computer, closing or locking it, exporting a copy and deleting it. Hosted keeps
 * the key, the backups and the moves on the server, so there only Delete is offered here.
 */
export function KeepView() {
  const t = useT();
  const language = useLanguage();
  const client = useEngine();
  const hosted = client.transport === 'hosted';
  const custody = useResource('workspace.custody.get', {}, { refreshOn: (event) => event.type === 'queue.changed' });
  const backups = useResource('workspace.backups.list', {});
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [deleted, setDeleted] = useState<Deleted | null>(null);

  if (deleted) return <DeletedNote result={deleted} />;
  const leave = (unlock: UnlockMode | null) => (
    <>
      {!hosted && <CloseBusiness unlock={unlock} />}
      {!hosted && <ExportCopy />}
      <DeleteBusiness onDeleted={setDeleted} />
    </>
  );
  if (custody.error) return <><p className={s.problem} role="alert">{t('business.failed', { message: custody.error.message })}</p>{leave(null)}</>;
  if (!custody.data) return <p className={s.note}>{t('business.loading')}</p>;
  const { computer, business } = custody.data;
  if (!business) return <EmptyState title={t('business.keepNone')} />;
  const locked = business.unlock === 'passphrase';
  const made = business.recovery === 'made';
  const refresh = () => { custody.reload(); backups.reload(); };

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setProblem(null);
    try { await action(); } catch (error) { setProblem(t('business.actionFailed', { message: messageOf(error) })); } finally { setBusy(false); }
  }

  if (code) return <CodeOnce code={code} folder={business.folder} onDone={() => { setCode(null); refresh(); }} />;

  const loss = !locked && computer.loss ? `${computer.loss} ${made ? t('business.lossTail') : t('business.lossNoCode')}` : null;
  const newest = backups.data?.backups[0]?.at ?? business.backups.newestAt;

  return (
    <>
      <section className={s.section}>
        <p className={s.lead}>{locked ? t('business.keepPassphraseWhere') : computer.where}</p>
        {loss && <p className={s.note}>{loss}</p>}
        {business.storage === 'experimental-file' && <p className={s.note}>{t('business.experimental')}</p>}
      </section>
      <section className={s.section} aria-label={t('business.recovery')}>
        <h2 className={s.heading}>{t('business.recovery')}</h2>
        <p className={s.line}>{t(made ? 'business.recoveryMade' : business.recovery === 'not-made' ? 'business.recoveryNotMade' : 'business.recoveryUnknown')}</p>
        {made && <p className={s.note}>{t('business.oldCodeStops')}</p>}
        <RecoveryForm locked={locked} made={made} busy={busy} onMake={(passphrase) => run(async () => {
          const result = await client.request('workspace.custody.recoveryCode', passphrase ? { passphrase } : {});
          setCode(result.recoveryCode);
        })} />
      </section>
      <section className={s.section} aria-label={t('business.backups')}>
        <h2 className={s.heading}>{t('business.backups')}</h2>
        <p className={s.line}>{t(business.backups.auto ? 'business.backupsAuto' : 'business.backupsManual')}</p>
        {business.backups.lastError
          ? <p className={s.problem} role="alert">{business.backups.lastError}</p>
          : <p className={s.note}>{newest ? t('business.lastBackup', { when: momentOf(newest, language) }) : t('business.noBackup')}</p>}
        <div className={s.buttons}>
          <Button disabled={busy} onClick={() => void run(async () => { await client.request('workspace.backups.create', {}); refresh(); })}>{t('business.backupNow')}</Button>
        </div>
        {!hosted && <AllBackups backups={backups.data?.backups ?? []} />}
      </section>
      {problem && <p className={s.problem} role="alert">{problem}</p>}
      {!hosted && <MoveAway locked={locked} />}
      <PassphraseFold custody={custody.data} onCode={setCode} onChanged={refresh} />
      {leave(business.unlock)}
    </>
  );
}

function RecoveryForm({ locked, made, busy, onMake }: { locked: boolean; made: boolean; busy: boolean; onMake: (passphrase: string | null) => Promise<void> }) {
  const t = useT();
  const [passphrase, setPassphrase] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (locked && !passphrase) { setProblem(t('business.passphraseFirst')); return; }
    const typed = passphrase;
    setPassphrase('');
    setProblem(null);
    await onMake(locked ? typed : null);
  }
  return (
    <form className={s.form} onSubmit={(event) => void submit(event)}>
      {locked && <Field label={t('business.yourPassphrase')} type="password" autoComplete="current-password" spellCheck={false} value={passphrase} onChange={(event) => setPassphrase(event.currentTarget.value)} />}
      {problem && <p className={s.problem} role="alert">{problem}</p>}
      <div className={s.buttons}>
        <Button variant={made ? 'secondary' : 'primary'} type="submit" disabled={busy}>{t(made ? 'business.makeNewCode' : 'business.makeCode')}</Button>
      </div>
    </form>
  );
}

/** The optional passphrase: on asks twice for 12 or more characters; off asks for the current one. */
function PassphraseFold({ custody, onCode, onChanged }: { custody: CustodyViewLite; onCode: (code: string) => void; onChanged: () => void }) {
  const t = useT();
  const client = useEngine();
  const [first, setFirst] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const business = custody.business!;
  const locked = business.unlock === 'passphrase';
  const stuck = locked && !custody.computer.available;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!locked) {
      if (first.length < 12) { setProblem(t('business.passphraseShort')); return; }
      if (first !== again) { setProblem(t('business.passphraseMismatch')); return; }
    } else if (!first) { setProblem(t('business.passphraseFirst')); return; }
    const typed = first;
    setFirst('');
    setAgain('');
    setBusy(true);
    setProblem(null);
    try {
      if (locked) {
        await client.request('workspace.custody.passphraseOff', { passphrase: typed });
        onChanged();
      } else {
        const result = await client.request('workspace.custody.passphraseOn', { passphrase: typed });
        if (result.recoveryCode) onCode(result.recoveryCode);
        else onChanged();
      }
    } catch (error) {
      setProblem(t('business.actionFailed', { message: messageOf(error) }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className={`${s.fold} ${s.section}`}>
      <summary>{t(locked ? 'business.passphraseOffTitle' : 'business.passphraseOnTitle')}</summary>
      {stuck ? (
        <p className={s.line}>{custody.computer.where}</p>
      ) : (
        <form className={s.form} onSubmit={(event) => void submit(event)}>
          {!locked && <p className={s.line}>{t('business.passphraseOnLine')}</p>}
          {!locked && business.recovery !== 'made' && <p className={s.warn}>{t('business.outsideCopies')}</p>}
          <Field
            label={t(locked ? 'business.yourPassphrase' : 'business.newPassphrase')} type="password" spellCheck={false}
            autoComplete={locked ? 'current-password' : 'new-password'} value={first} onChange={(event) => setFirst(event.currentTarget.value)}
          />
          {!locked && <Field label={t('business.passphraseAgain')} type="password" spellCheck={false} autoComplete="new-password" value={again} onChange={(event) => setAgain(event.currentTarget.value)} />}
          {problem && <p className={s.problem} role="alert">{problem}</p>}
          <div className={s.buttons}><Button type="submit" disabled={busy}>{t(locked ? 'business.stopAsking' : 'business.lockIt')}</Button></div>
        </form>
      )}
    </details>
  );
}

/**
 * The code, once, in groups of four for reading; Copy gives it whole, Save as file writes it on its own line in a
 * text file, only when the owner asks. Done needs the owner to say it is saved, and forgets it.
 */
function CodeOnce({ code, folder, onDone }: { code: string; folder: string; onDone: () => void }) {
  const t = useT();
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  return (
    <section className={s.section} aria-label={t('business.recovery')}>
      <h2 ref={heading} tabIndex={-1} className={s.name}>{t('business.recovery')}</h2>
      <p className={s.line}>{t('business.codeOnce')}</p>
      <div className={`${s.code} mono`} role="group" aria-label={t('business.codeLabel')}>
        {(code.match(/.{1,4}/g) ?? []).map((part, i) => <span key={i}>{part}</span>)}
      </div>
      <div className={s.buttons}>
        <Button variant="quiet" onClick={() => { void navigator.clipboard?.writeText(code).then(() => setCopied(true), () => setCopied(false)); }}>{t('business.copy')}</Button>
        <Button variant="quiet" onClick={() => saveTextFile('chausar-recovery-code.txt', `Chausar recovery code\nFolder: ${folder}\n\n${code}\n`, 'text/plain')}>{t('business.saveFile')}</Button>
        {copied && <span className={s.note} role="status">{t('business.codeCopied')}</span>}
      </div>
      <label className={s.agree}>
        <input type="checkbox" checked={saved} onChange={(event) => setSaved(event.currentTarget.checked)} />
        {t('business.codeSaved')}
      </label>
      <div className={s.buttons}><Button variant="primary" disabled={!saved} onClick={onDone}>{t('business.done')}</Button></div>
    </section>
  );
}
