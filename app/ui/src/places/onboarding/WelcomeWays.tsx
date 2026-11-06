import { messageOf } from '../../../../../platform/shared/errors.ts';
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { useT } from '../../text';
import { useOwnerZone } from '../../shell/clock';
import { useEngine, useResource } from '../../engine/context';
import type { BackupLite, ParamsOf } from '../../engine/types';
import { Button } from '../../parts/Button';
import { Field } from '../../parts/Field';
import { InlineError } from '../../parts/InlineError';
import { PassphraseField } from '../../parts/PassphraseField';
import { NewPassphrase } from '../../parts/Secret';
import { TRANSFER_MAX_CHARS, codeOf, momentOf, newPassphraseProblem, refusalWords } from '../../parts/custody';
import type { Openable } from './boot';
import s from './Onboarding.module.css';
import { Fold } from '../../parts/Fold';
import { Select } from '../../parts/Select';
import { FilePick } from '../../parts/FilePick';
import { Progress } from '../../parts/Progress';

/**
 * The ways into a business that is not open, beside Welcome back's list (app/renderer/launch.js showRecover,
 * showRestoreBackup, showMoveHere and showOpenByFolder, in Ink's look):
 *   Recover       workspace.recover: the business from the list and its recovery code
 *   RestoreBackup workspace.backups.list, then workspace.restore by the backup's name, never a path
 *   MoveHere      workspace.transfer.import: the move file from the other computer and its code
 *   ByFolder      workspace.open by a typed folder, for a business the list can't show
 * A new passphrase is asked only once the engine says this computer can't keep the key (DEVICE_KEYS_UNAVAILABLE).
 * Every secret is cleared from its field when it is sent; a refusal is said in plain words.
 */

interface WayProps { onOpened: () => void; onBack: () => void }


/** The head of a way in: back to the list, the title (focused, for a screen reader) and one line. */
export function Way({ title, lead, onBack, children }: { title: string; lead: string; onBack: () => void; children: ReactNode }) {
  const t = useT();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  return (
    <>
      <h1 ref={heading} tabIndex={-1} className={s.question}>{title}</h1>
      <p className={s.note}>{lead}</p>
      {children}
      <Button variant="quiet" className={s.back} onClick={onBack}>{t('onboarding.welcome.back')}</Button>
    </>
  );
}

/** A new passphrase, once the engine asked for one: the pair and its check before anything is sent. */
export function useNewPassphrase() {
  const [reason, setReason] = useState<string | null>(null);
  const [first, setFirst] = useState('');
  const [again, setAgain] = useState('');
  return {
    wanted: reason !== null,
    show: setReason,
    clear() { setFirst(''); setAgain(''); },
    problem: () => (reason === null ? null : newPassphraseProblem(first, again)),
    value: first,
    node: reason === null ? null : <NewPassphrase reason={reason} first={first} again={again} onFirst={setFirst} onAgain={setAgain} />,
  };
}

/** Recover with the code: the business from the list (a typed folder when the list is empty), and its code. */
export function Recover({ businesses, chosen, onOpened, onBack }: WayProps & { businesses: Openable[]; chosen?: string | undefined }) {
  const t = useT();
  const client = useEngine();
  const selectId = useId();
  const [folder, setFolder] = useState(chosen ?? businesses[0]?.key ?? 'main');
  const [code, setCode] = useState('');
  const pair = useNewPassphrase();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const recoveryCode = code.trim();
    if (!recoveryCode) { setProblem(t('onboarding.recover.codeFirst')); return; }
    const payload: ParamsOf<'workspace.recover'> = { folder: folder.trim() || 'main', recoveryCode };
    const bad = pair.problem();
    if (bad) { setProblem(t(bad)); return; }
    if (pair.wanted) payload.passphrase = pair.value;
    setCode('');
    pair.clear();
    setBusy(true);
    setProblem(null);
    try {
      await client.request('workspace.recover', payload);
      onOpened();
    } catch (error) {
      if (codeOf(error) === 'DEVICE_KEYS_UNAVAILABLE' && !pair.wanted) pair.show(messageOf(error));
      else setProblem(refusalWords(error, t));
      setBusy(false);
    }
  }

  return (
    <Way title={t('onboarding.recover.title')} lead={t('onboarding.recover.lead')} onBack={onBack}>
      <form className={s.ask} onSubmit={(event) => void submit(event)}>
        {businesses.length > 0 ? (
          <div className={s.field}>
            <label htmlFor={selectId} className={s.fieldLabel}>{t('onboarding.recover.business')}</label>
            <Select id={selectId} className={s.select} value={folder} onChange={(event) => setFolder(event.currentTarget.value)}>
              {businesses.map((b) => <option key={b.key} value={b.key}>{b.name ?? b.key}</option>)}
            </Select>
          </div>
        ) : (
          <Field label={t('onboarding.recover.folder')} value={folder} spellCheck={false} maxLength={64} onChange={(event) => setFolder(event.currentTarget.value)} />
        )}
        <Field label={t('onboarding.recover.code')} type="password" autoComplete="off" spellCheck={false} value={code} onChange={(event) => setCode(event.currentTarget.value)} />
        {pair.node}
        {problem && <p className={s.problem} role="alert">{problem}</p>}
        <div className={s.actions}><Button variant="primary" type="submit" disabled={busy}>{t('onboarding.recover.go')}</Button></div>
      </form>
    </Way>
  );
}

/** Restore a backup before opening: every backup on this computer, newest first, in a fold per business. */
export function RestoreBackup({ onOpened, onBack }: WayProps) {
  const t = useT();
  const found = useResource('workspace.backups.list', {});
  const groups = new Map<string, BackupLite[]>();
  for (const backup of found.data?.backups ?? []) {
    const name = backup.name ?? t('onboarding.welcome.noName');
    groups.set(name, [...(groups.get(name) ?? []), backup]);
  }
  return (
    <Way title={t('onboarding.restore.title')} lead={t('onboarding.restore.lead')} onBack={onBack}>
      {found.error && <p className={s.problem} role="alert">{refusalWords(found.error, t)}</p>}
      {!found.data && !found.error && <p className={s.progress} role="status">{t('onboarding.restore.reading')}</p>}
      {found.data && groups.size === 0 && <p className={s.note}>{t('onboarding.restore.none')}</p>}
      {/* B4 task 12: one business's backups are a flat list. */}
      {groups.size === 1 && [...groups.entries()].map(([name, backups]) => (
        <ul key={name} className={s.backups} aria-label={name}>
          {backups.map((backup) => <RestoreRow key={backup.file} backup={backup} onOpened={onOpened} />)}
        </ul>
      ))}
      {groups.size > 1 && [...groups.entries()].map(([name, backups], index) => (
        <Fold summary={name} key={name} className={s.more} open={index === 0}>
          <ul className={s.backups} aria-label={name}>
            {backups.map((backup) => <RestoreRow key={backup.file} backup={backup} onOpened={onOpened} />)}
          </ul>
        </Fold>
      ))}
    </Way>
  );
}

/**
 * One backup. Restore opens it as a new business beside the original (folder null). The engine says what it needs:
 * PASSPHRASE_REQUIRED opens a passphrase field, DEVICE_KEY_FAILED a recovery code field, and then
 * DEVICE_KEYS_UNAVAILABLE a new passphrase.
 */
function RestoreRow({ backup, onOpened }: { backup: BackupLite; onOpened: () => void }) {
  const t = useT();
  const zone = useOwnerZone();
  const client = useEngine();
  const [ask, setAsk] = useState<null | 'passphrase' | 'code'>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [secret, setSecret] = useState('');
  const pair = useNewPassphrase();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function restore() {
    const payload: ParamsOf<'workspace.restore'> = { backupFile: backup.file, folder: null };
    if (ask === 'passphrase') {
      if (!secret) { setProblem(t('custody.enterPassphrase')); return; }
      payload.passphrase = secret;
    }
    if (ask === 'code') {
      if (!secret.trim()) { setProblem(t('onboarding.recover.codeFirst')); return; }
      payload.recoveryCode = secret.trim();
      const bad = pair.problem();
      if (bad) { setProblem(t(bad)); return; }
      if (pair.wanted) payload.passphrase = pair.value;
    }
    setSecret('');
    pair.clear();
    setBusy(true);
    setProblem(null);
    try {
      await client.request('workspace.restore', payload);
      onOpened();
    } catch (error) {
      const code = codeOf(error);
      if (code === 'PASSPHRASE_REQUIRED' && ask === null) { setAsk('passphrase'); setReason(messageOf(error)); }
      else if (code === 'DEVICE_KEY_FAILED' && ask !== 'code') { setAsk('code'); setReason(messageOf(error)); }
      else if (code === 'DEVICE_KEYS_UNAVAILABLE' && ask === 'code' && !pair.wanted) pair.show(messageOf(error));
      else setProblem(refusalWords(error, t));
      setBusy(false);
    }
  }

  return (
    <li className={s.backup}>
      <div className={s.backupLine}>
        <span>{momentOf(backup.at, zone)}</span>
        <span className={s.businessNote}>{t(`custody.kind.${backup.kind}`)}</span>
        <Button disabled={busy} onClick={() => void restore()}>{t('onboarding.restore.go')}</Button>
      </div>
      {busy && <Progress kind="restore" active />}
      {ask && (
        <div className={s.ask}>
          {reason && <p className={s.note}>{reason}</p>}
          {ask === 'passphrase' ? (
            <PassphraseField label={t('onboarding.restore.passphrase')} autoComplete="current-password" autoFocus value={secret} onChange={setSecret} />
          ) : (
            <Field label={t('onboarding.recover.code')} type="password" spellCheck={false} autoComplete="off" autoFocus value={secret} onChange={(event) => setSecret(event.currentTarget.value)} />
          )}
          {pair.node}
        </div>
      )}
      {problem && <p className={s.problem} role="alert">{problem}</p>}
    </li>
  );
}

/** Which business a move file holds: the engine's envelope id (the fake's `business`). Not a secret; never sent. */
function idOfMoveFile(text: string): string | null {
  try {
    const file = JSON.parse(text) as { envelope?: { id?: unknown }; business?: unknown };
    const id = file.envelope?.id ?? file.business;
    return typeof id === 'string' ? id : null;
  } catch { return null; }
}

/**
 * Move a business here: the file from the other computer and its one-time code. The browser's own file control stays
 * hidden; Chausar's button opens it. The code field sits outside any form, so no browser offers to keep it.
 */
export function MoveHere({ businesses, onOpen, onOpened, onBack }: WayProps & { businesses: readonly Openable[]; onOpen: (business: Openable) => void }) {
  const t = useT();
  const client = useEngine();
  const [file, setFile] = useState<File | null>(null);
  const [code, setCode] = useState('');
  const pair = useNewPassphrase();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // B4: the file this computer already holds: typing a code can't fix that, so Move it here waits for another file.
  const [alreadyHere, setAlreadyHere] = useState<File | null>(null);
  /** B4 task 4: the business of a file already on this computer, opened from the line; null when the list can't name it. */
  const [here, setHere] = useState<Openable | null>(null);
  const [codeWrong, setCodeWrong] = useState<string | null>(null);
  const missing = !file ? t('onboarding.move.fileFirst') : file === alreadyHere ? t('onboarding.move.anotherFile') : !code.trim() ? t('onboarding.move.codeFirst') : undefined;
  const zone = useOwnerZone();
  // C4 task 38 (223.x1): with the file and a whole code, the engine reads the name and day inside, quietly, before
  // Move it here; nothing is written and a refusal says nothing here (Move it here says it).
  const [inside, setInside] = useState<{ name: string; movedOutAt: string | null } | null>(null);
  useEffect(() => {
    setInside(null);
    if (!file || code.replace(/[^A-Za-z0-9]/g, '').length < 24) return;
    let live = true;
    void (async () => {
      try {
        const fileText = await file.text();
        if (fileText.length > TRANSFER_MAX_CHARS) return;
        const seen = await client.request('workspace.transfer.peek', { fileText, transferCode: code.trim() });
        if (live) setInside(seen);
      } catch { /* quiet: Move it here gives the engine's words */ }
    })();
    return () => { live = false; };
  }, [file, code, client]);

  async function move() {
    if (!file) { setProblem(t('onboarding.move.fileFirst')); return; }
    if (file === alreadyHere) return;
    let fileText = await file.text();
    if (fileText.length > TRANSFER_MAX_CHARS) { setProblem(t('custody.tooLarge')); return; }
    const transferCode = code.trim();
    if (!transferCode) { setProblem(t('onboarding.move.codeFirst')); return; }
    const bad = pair.problem();
    if (bad) { setProblem(t(bad)); return; }
    const payload: ParamsOf<'workspace.transfer.import'> = { fileText, transferCode };
    if (pair.wanted) payload.passphrase = pair.value;
    // B4 task 12: the code stays in its field after a refusal, so a typo can be fixed; it goes with the screen.
    pair.clear();
    setBusy(true);
    setProblem(null);
    setCodeWrong(null);
    try {
      await client.request('workspace.transfer.import', payload);
      onOpened();
    } catch (error) {
      if (codeOf(error) === 'DEVICE_KEYS_UNAVAILABLE' && !pair.wanted) pair.show(messageOf(error));
      else if (codeOf(error) === 'TRANSFER_CODE_WRONG') setCodeWrong(refusalWords(error, t));
      else setProblem(refusalWords(error, t));
      if (codeOf(error) === 'TRANSFER_SAME_BUSINESS') {
        setAlreadyHere(file);
        const id = idOfMoveFile(fileText);
        setHere(businesses.find((business) => business.key === id) ?? null);
      }
      setBusy(false);
    } finally {
      // The file's text and the code leave memory with the request.
      fileText = '';
      payload.fileText = '';
      payload.transferCode = '';
      delete payload.passphrase;
    }
  }
  const onEnter = (event: KeyboardEvent<HTMLInputElement>) => { if (event.key === 'Enter') { event.preventDefault(); void move(); } };

  return (
    <Way title={t('onboarding.move.title')} lead={t('onboarding.move.lead')} onBack={onBack}>
      <div className={s.ask}>
        <p className={s.note}>{t('onboarding.move.how')}</p>
        <FilePick
          choose={t('onboarding.move.choose')} accept=".chausar-move,.backup,application/json" aria-label={t('onboarding.move.file')}
          onChange={(event) => { setFile(event.currentTarget.files?.[0] ?? null); setProblem(null); setCodeWrong(null); setHere(null); }}
        />
        {/* C4 task 38 (222, B3's handoff): a stale error goes as soon as the owner types. */}
        <Field label={t('onboarding.move.code')} type="password" autoComplete="off" spellCheck={false} placeholder={t('onboarding.move.codePlaceholder')} value={code} error={codeWrong ?? undefined} onChange={(event) => { setCode(event.currentTarget.value); setCodeWrong(null); setProblem(null); }} onKeyDown={onEnter} />
                {inside && <p className={s.note} role="status">{t(inside.movedOutAt ? 'onboarding.move.inside' : 'onboarding.move.insideName', { name: inside.name, when: inside.movedOutAt ? momentOf(inside.movedOutAt, zone) : '' })}</p>}
        {pair.node}
        {problem && <InlineError fix={here ? { label: t('onboarding.move.open', { name: here.name ?? t('onboarding.welcome.noName') }), onSelect: () => onOpen(here) } : undefined}>{problem}</InlineError>}
        <div className={s.actions}><Button variant="primary" disabled={busy} disabledReason={busy ? undefined : missing} onClick={() => void move()}>{t('onboarding.move.go')}</Button></div>
        {busy && <Progress kind="move-in" active />}
      </div>
    </Way>
  );
}

/** The typed way in, for a business the list can't show (PostgreSQL storage) or an empty list. */
export function ByFolder({ onOpened, onBack }: WayProps) {
  const t = useT();
  const client = useEngine();
  const [folder, setFolder] = useState('main');
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const payload: ParamsOf<'workspace.open'> = { folder: folder.trim() || 'main' };
    if (passphrase) payload.passphrase = passphrase;
    setPassphrase('');
    setBusy(true);
    setProblem(null);
    try {
      await client.request('workspace.open', payload);
      onOpened();
    } catch (error) {
      setProblem(refusalWords(error, t));
      setBusy(false);
    }
  }

  return (
    <Way title={t('onboarding.folder.title')} lead={t('onboarding.folder.lead')} onBack={onBack}>
      <form className={s.ask} onSubmit={(event) => void submit(event)}>
        <Field label={t('onboarding.folder.folder')} value={folder} spellCheck={false} maxLength={64} onChange={(event) => setFolder(event.currentTarget.value)} />
        <PassphraseField label={t('onboarding.folder.passphrase')} autoComplete="current-password" value={passphrase} onChange={setPassphrase} />
        {problem && <p className={s.problem} role="alert">{problem}</p>}
        <div className={s.actions}><Button variant="primary" type="submit" disabled={busy}>{t('onboarding.welcome.open')}</Button></div>
      </form>
    </Way>
  );
}
