import { messageOf } from '../../../../../platform/shared/errors.ts';
import { useContext, useEffect, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '../../text';
import { useOwnerZone } from '../../shell/clock';
import { useEngine, useResource } from '../../engine/context';
import { Button } from '../../parts/Button';
import { PassphraseField } from '../../parts/PassphraseField';
import { EmptyState } from '../../parts/EmptyState';
import { Icon } from '../../parts/Icon';
import { Tile } from '../../parts/Tile';
import { momentOf, saveTextFile } from '../../parts/custody';
import type { CustodyViewLite, Deleted, UnlockMode } from '../../engine/types';
import { formatBytes } from '../../parts/when';
import { AllBackups, CloseBusiness, DeleteBusiness, ExportCopy, MoveAway, OpenCopyFold, takeRestoredLine } from './KeepMore';
import { KeepCopy } from './KeepCopy';
import { LeftContext } from '../onboarding/started';
import { TileSection } from './shared';
import s from './Business.module.css';
import { Fold } from '../../parts/Fold';
import { LoadingPlace } from '../../parts/Skeleton';

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
 *
 * In the D look: a tile saying where the key is, the recovery code and the backups side by side, and the rest as a
 * tile of folded rows, each one press away.
 */
export function KeepView() {
  const t = useT();
  const zone = useOwnerZone();
  const client = useEngine();
  const hosted = client.transport === 'hosted';
  const custody = useResource('workspace.custody.get', {}, { refreshOn: (event) => event.type === 'queue.changed' });
  const backups = useResource('workspace.backups.list', {});
  const status = useResource('workspace.status', {});
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // C4 task 36: "Backed up just now" after Back up now (203.x1); the line after a restore, once (209.x1).
  const [backedUp, setBackedUp] = useState(false);
  const [restored] = useState(() => takeRestoredLine());
  // B3: a delete goes straight to Welcome back, which says what was deleted and kept; nothing of this business stays.
  const left = useContext(LeftContext);
  const onDeleted = (deleted: Deleted) => left({ autoOpen: false, deleted });
  const counts = custody.data?.business ? { backups: custody.data.business.backups.count, exports: custody.data.business.exportsHere ?? 0 } : null;
  const leave = (unlock: UnlockMode | null) => (
    <>
      {!hosted && <CloseBusiness unlock={unlock} />}
      {!hosted && <ExportCopy />}
      {!hosted && <OpenCopyFold />}
      <DeleteBusiness onDeleted={onDeleted} counts={hosted ? null : counts} />
    </>
  );
  if (custody.error) {
    return (
      <div className={s.page}>
        <p className={s.problem} role="alert">{t('business.failed', { message: custody.error.message })}</p>
        <TileSection title={t('business.keepMore')}><div className={s.more}>{leave(null)}</div></TileSection>
      </div>
    );
  }
  if (!custody.data) return <LoadingPlace shape="settings" />;
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

  const makeCode = (passphrase: string | null) => run(async () => {
    const result = await client.request('workspace.custody.recoveryCode', passphrase ? { passphrase } : {});
    setCode(result.recoveryCode);
  });

  if (code) return <CodeOnce code={code} folder={business.folder} name={status.data?.workspace?.name ?? business.folder} onDone={() => { setCode(null); refresh(); }} />;

  const loss = !locked && computer.loss ? `${computer.loss} ${made ? t('business.lossTail') : t('business.lossNoCode')}` : null;
  const newest = backups.data?.backups[0]?.at ?? business.backups.newestAt;

  return (
    <div className={s.page}>
      <Tile>
        <div className={s.where}>
          <span className={s.whereIcon} aria-hidden="true"><Icon name={locked ? 'lock' : 'shield-check'} size={20} /></span>
          <div className={s.whereText}>
            <p className={s.lead}>{locked ? t('business.keepPassphraseWhere') : computer.where}</p>
            {loss && <p className={s.note}>{loss}</p>}
            {client.transport !== 'desktop' && client.transport !== 'fake' && business.storage === 'experimental-file' && <p className={s.warn}>{t('business.experimental')}</p>}
          </div>
        </div>
      </Tile>
      <div className={s.split} data-ratio="even">
        <TileSection title={t('business.recovery')}>
          <p className={s.line}>{t(made ? 'business.recoveryMade' : business.recovery === 'not-made' ? 'business.recoveryNotMade' : 'business.recoveryUnknown')}</p>
          {made && <p className={s.note}>{t('business.oldCodeStops')}</p>}
          <RecoveryForm locked={locked} made={made} busy={busy} onMake={makeCode} />
        </TileSection>
        <TileSection title={t('business.backups')}>
          <p className={s.line}>{t(business.backups.auto ? 'business.backupsAuto' : 'business.backupsManual')}</p>
          {business.backups.lastError
            ? <p className={s.problem} role="alert">{business.backups.lastError}</p>
            : <p className={s.note}>{newest ? t('business.lastBackup', { when: momentOf(newest, zone) }) : t('business.noBackup')}</p>}
          {/* C5 task 19: how much of the ceiling this business takes; from 70 percent, what to do about it. */}
          <p className={s.note}>{t('business.store.uses', { used: formatBytes(business.storeBytes), limit: formatBytes(business.storeLimit) })}</p>
          {business.storeBytes >= business.storeLimit * 0.7 && <p className={s.warn}>{t('business.store.full')}</p>}
          <div className={s.buttons}>
            <Button disabled={busy} onClick={() => void run(async () => { setBackedUp(false); await client.request('workspace.backups.create', {}); setBackedUp(true); refresh(); })}>{t('business.backupNow')}</Button>
          </div>
          {/* Seam: B4's ResultLine takes these two lines when B4 lands. */}
          {backedUp && <p className={s.said} role="status">{t('business.backedUpNow')}</p>}
          {restored && <p className={s.said} role="status">{restored}</p>}
          {!hosted && <AllBackups backups={backups.data?.backups ?? []} />}
        </TileSection>
      </div>
      {problem && <p className={s.problem} role="alert">{problem}</p>}
      {!hosted && client.setBackupFolder && (
        <KeepCopy
          copy={business.backups.copy} recovery={business.recovery} locked={locked} busy={busy} onChanged={refresh}
          onMakeCode={() => void run(async () => { setCode((await client.request('workspace.custody.recoveryCode', {})).recoveryCode); })}
        />
      )}
      <TileSection title={t('business.keepMore')}>
        <div className={s.more}>
          {!hosted && <MoveAway locked={locked} madeAt={business.moveMadeAt ?? null} noCode={!made} onChanged={refresh} onMakeCode={makeCode} />}
          <PassphraseFold custody={custody.data} onCode={setCode} onChanged={refresh} />
          {leave(business.unlock)}
        </div>
      </TileSection>
    </div>
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
      {locked && <PassphraseField label={t('business.yourPassphrase')} autoComplete="current-password" value={passphrase} onChange={setPassphrase} />}
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
    <Fold summary={t(locked ? 'business.passphraseOffTitle' : 'business.passphraseOnTitle')} className={s.fold}>
      {stuck ? (
        <p className={s.line}>{custody.computer.where}</p>
      ) : (
        <form className={s.form} onSubmit={(event) => void submit(event)}>
          {!locked && <p className={s.line}>{t('business.passphraseOnLine')}</p>}
          {!locked && business.recovery !== 'made' && <p className={s.warn}>{t('business.outsideCopies')}</p>}
          <PassphraseField
            label={t(locked ? 'business.yourPassphrase' : 'business.newPassphrase')} isNew={!locked}
            autoComplete={locked ? 'current-password' : 'new-password'} value={first} onChange={setFirst}
          />
          {!locked && <PassphraseField label={t('business.passphraseAgain')} autoComplete="new-password" value={again} onChange={setAgain} />}
          {problem && <p className={s.problem} role="alert">{problem}</p>}
          <div className={s.buttons}><Button type="submit" disabled={busy}>{t(locked ? 'business.stopAsking' : 'business.lockIt')}</Button></div>
        </form>
      )}
    </Fold>
  );
}

/**
 * The code, once, in groups of four for reading; Copy gives it whole, Save as file writes it on its own line in a
 * text file, only when the owner asks. Done needs the owner to say it is saved, and forgets it.
 */
function CodeOnce({ code, folder, name, onDone }: { code: string; folder: string; name: string; onDone: () => void }) {
  const t = useT();
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [printing, setPrinting] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  return (
    <Tile as="section" label={t('business.recovery')}>
      <div className={s.body}>
        <h2 ref={heading} tabIndex={-1} className={s.name}>{t('business.recovery')}</h2>
        <p className={s.line}>{t('business.codeOnce')}</p>
        <div data-code="" className={`${s.code} mono`} role="group" aria-label={t('business.codeLabel')}>
          {(code.match(/.{1,4}/g) ?? []).map((part, i) => <span key={i}>{part}</span>)}
        </div>
        <div className={s.buttons}>
          <Button variant="quiet" onClick={() => { void navigator.clipboard?.writeText(code).then(() => setCopied(true), () => setCopied(false)); }}>{t('business.copy')}</Button>
          <Button variant="quiet" onClick={() => saveTextFile('chausar-recovery-code.txt', `Chausar recovery code\nFolder: ${folder}\n\n${code}\n`, 'text/plain')}>{t('business.saveFile')}</Button>
          <Button variant="quiet" onClick={() => setPrinting(true)}>{t('custody.print')}</Button>
          {copied && <span className={s.note} role="status">{t('business.codeCopied')}</span>}
        </div>
        <label className={s.agree}>
          <input type="checkbox" checked={saved} onChange={(event) => setSaved(event.currentTarget.checked)} />
          {t('business.codeSaved')}
        </label>
        <div className={s.buttons}><Button variant="primary" disabledReason={saved ? undefined : t('business.tickFirst')} onClick={onDone}>{t('business.done')}</Button></div>
      </div>
      {printing && <PrintCode code={code} name={name} onDone={() => setPrinting(false)} />}
    </Tile>
  );
}

/**
 * C4 task 35 (25.x1): the print view: the business name and the code alone, on the body beside the app, which print
 * hides while this is there. window.print works in the desktop's window and on the web alike. It leaves after printing.
 */
function PrintCode({ code, name, onDone }: { code: string; name: string; onDone: () => void }) {
  const t = useT();
  useEffect(() => {
    window.addEventListener('afterprint', onDone);
    window.print();
    return () => window.removeEventListener('afterprint', onDone);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return createPortal(
    <div className={s.printView} data-print-view="">
      <p className={s.name}>{name}</p>
      <p className={s.line}>{t('custody.printTitle')}</p>
      <p data-code="" className={`${s.code} mono`}>{(code.match(/.{1,4}/g) ?? []).map((part, i) => <span key={i}>{part}</span>)}</p>
    </div>,
    document.body,
  );
}
