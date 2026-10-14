/**
 * Pieces about this computer that the journey, the lock screen and Trust · Vault share:
 * - `DiskCheckLine` (FR-03): the result of the disk check and, on Linux with no safe keyring,
 *   that the passphrase is asked each time.
 * - `LockFolderChoice` (SH-02, FR-01): which workspace folder to unlock, when there is more
 *   than one. Folder names only: nothing is decrypted while locked.
 * - `AskRecoveryContact` (SH-02, FR-13): "Ask recovery contact", and the engine's answer in words.
 * - `RecoveryContactSettings` (TR-12): name the contact and how to reach them; kept in the vault.
 *
 * Words for the lock screen and Trust pieces are in the shared catalogue (`SH-02.*`), so they
 * draw under the host's own text provider; the disk lines are the first-run catalogue's.
 */

import { useEffect, useId, useRef, useState } from 'react';
import { useT } from '../../app/text';
import { Field } from '../../parts/Field';
import type { DiskCheckReply, RecoveryContact, WorkspaceFolder } from '../../bridge/todayx-contract.ts';
import type { JourneyFailure } from './journey-contracts.ts';
import { Act, Actions, Note, Status } from './JourneyParts';
import {
  askLineKey, askRecoveryContact, diskLineKey, keyringLineKey, readDiskCheck, readRecoveryContact, readWorkspaceFolders, saveRecoveryContact,
  type ComputerPort,
} from './this-computer.ts';
import s from './Journey.module.css';

/* ------------------------------------------------------------------ FR-03 */

type DiskState = { readonly kind: 'reading' } | { readonly kind: 'known'; readonly value: DiskCheckReply } | JourneyFailure;

export function DiskCheckLine({ rpc }: { rpc: ComputerPort }) {
  const t = useT();
  const [state, setState] = useState<DiskState>({ kind: 'reading' });
  useEffect(() => {
    let live = true;
    void readDiskCheck(rpc).then(result => { if (live) setState(result); });
    return () => { live = false; };
  }, [rpc]);
  if (state.kind === 'reading') return <Status k="FR-03.disk.reading" />;
  if (state.kind !== 'known') return <Note k="FR-03.disk" />;
  const keyring = keyringLineKey(state.value);
  return (
    <div data-disk-check={state.value.disk} data-keyring={state.value.keyring}>
      <p className={s.note}>{t(diskLineKey(state.value))}</p>
      {keyring !== null && <p className={s.note}>{t(keyring)}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ SH-02: which folder */

export interface LockFolderChoiceProps {
  readonly rpc: ComputerPort;
  /** The folder the unlock control will open. */
  readonly folder: string;
  readonly onFolder: (folder: string) => void;
}

/**
 * Reads `todayx.workspaces` once. With one folder that is not `main`, that folder is chosen
 * silently; with more than one, the person picks; with none or `main` alone, nothing is drawn.
 */
export function LockFolderChoice({ rpc, folder, onFolder }: LockFolderChoiceProps) {
  const t = useT();
  const name = useId();
  const [folders, setFolders] = useState<readonly WorkspaceFolder[]>([]);
  const chosen = useRef(onFolder);
  chosen.current = onFolder;
  useEffect(() => {
    let live = true;
    void readWorkspaceFolders(rpc).then(found => {
      if (!live) return;
      setFolders(found);
      const only = found.length === 1 ? found[0] : undefined;
      if (only !== undefined && !only.main) chosen.current(only.folder);
    });
    return () => { live = false; };
  }, [rpc]);
  if (folders.length < 2) return null;
  return (
    <fieldset className={s.section} style={{ border: 0, padding: 0 }} data-lock-folders="">
      <legend className={s.sectionTitle}>{t('SH-02.folder')}</legend>
      <ul className={s.rows}>
        {folders.map(item => (
          <li key={item.folder} className={s.row}>
            <label className={s.radioRow}>
              <input type="radio" name={name} value={item.folder} checked={item.folder === folder} onChange={() => onFolder(item.folder)} />
              <span className={s.rowName}>{item.folder}</span>
            </label>
          </li>
        ))}
      </ul>
      <p className={s.note}>{t('SH-02.folder.note')}</p>
    </fieldset>
  );
}

/* ------------------------------------------------------------------ SH-02 / FR-13: ask the contact */

export function AskRecoveryContact({ rpc, folder = 'main' }: { rpc: ComputerPort; folder?: string | undefined }) {
  const t = useT();
  const [state, setState] = useState<'idle' | 'asking' | JourneyFailure>('idle');
  const busy = state === 'asking';
  return (
    <div data-ask-recovery-contact="">
      <Actions>
        <Act variant="link" label="SH-02.contact.btn" disabled={busy} onClick={() => {
          setState('asking');
          void askRecoveryContact(rpc, folder).then(setState);
        }} />
      </Actions>
      {typeof state === 'object' && (
        <p className={state.kind === 'not-built' ? s.status : s.note} role="status" data-recovery-contact-answer={state.kind === 'refused' ? state.code : 'not-built'}>
          {t(askLineKey(state), state.kind === 'refused' ? { code: state.code } : undefined)}
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ TR-12: name the contact */

type ContactState = { readonly kind: 'reading' } | { readonly kind: 'known'; readonly contact: RecoveryContact | null } | JourneyFailure;

/** For Trust · Vault. Needs an open vault and an owner seat; anything else is said in words. */
export function RecoveryContactSettings({ rpc }: { rpc: ComputerPort }) {
  const t = useT();
  const [state, setState] = useState<ContactState>({ kind: 'reading' });
  const [name, setName] = useState('');
  const [reach, setReach] = useState('');
  const [problem, setProblem] = useState<{ readonly key: string; readonly code: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    let live = true;
    void readRecoveryContact(rpc).then(result => {
      if (!live) return;
      if (result.kind !== 'known') { setState(result); return; }
      setState({ kind: 'known', contact: result.value.contact });
      setName(result.value.contact?.name ?? ''); setReach(result.value.contact?.reach ?? '');
    });
    return () => { live = false; };
  }, [rpc]);

  const save = async (contact: { name: string; reach: string } | null) => {
    setSaving(true); setSaved(false); setProblem(null);
    const result = await saveRecoveryContact(rpc, contact);
    setSaving(false);
    if (result.kind === 'known') {
      setState({ kind: 'known', contact: result.value.contact }); setSaved(true);
      if (result.value.contact === null) { setName(''); setReach(''); }
      return;
    }
    if (result.kind === 'not-built') { setProblem({ key: 'SH-02.contact.settings.notBuilt', code: '' }); return; }
    setProblem({ key: result.code === 'RECOVERY_CONTACT_INVALID' ? 'SH-02.contact.need' : result.code === 'FORBIDDEN' ? 'SH-02.contact.owner' : 'SH-02.contact.saveRefused', code: result.code });
  };

  if (state.kind === 'reading') return <section data-recovery-contact-settings="reading"><Status k="SH-02.contact.reading" /></section>;
  if (state.kind === 'not-built') return <section data-recovery-contact-settings="not-built"><p className={s.status} role="status" data-first-run-not-built="">{t('SH-02.contact.settings.notBuilt')}</p></section>;
  if (state.kind === 'refused') return <section data-recovery-contact-settings="refused"><p className={s.note} role="status">{t(state.code === 'FORBIDDEN' ? 'SH-02.contact.owner' : 'SH-02.contact.readRefused', { code: state.code })}</p></section>;
  const contact = state.contact;
  return (
    <section data-recovery-contact-settings="known">
      <h2 className={s.sectionTitle}>{t('SH-02.contact.title')}</h2>
      <p className={s.note}>{t('SH-02.contact.lede')}</p>
      <p className={s.status} data-recovery-contact-current="">{contact === null ? t('SH-02.contact.none') : t('SH-02.contact.current', { name: contact.name, reach: contact.reach })}</p>
      <form onSubmit={event => {
        event.preventDefault();
        if (name.trim().length === 0 || reach.trim().length === 0 || name.length > 100 || reach.length > 200) { setProblem({ key: 'SH-02.contact.need', code: '' }); return; }
        void save({ name: name.trim(), reach: reach.trim() });
      }}>
        <div className={s.fields}>
          <Field label={t('SH-02.contact.name')} value={name} maxLength={100} autoComplete="off" onChange={event => setName(event.currentTarget.value)} />
          <Field label={t('SH-02.contact.reach')} value={reach} maxLength={200} autoComplete="off" onChange={event => setReach(event.currentTarget.value)} />
        </div>
        {problem !== null && <p className={s.problem} role="alert">{t(problem.key, { code: problem.code })}</p>}
        {saved && <Status k="SH-02.contact.saved" />}
        <p className={s.note}>{t('SH-02.contact.kept')}</p>
        <p className={s.note}>{t('SH-02.contact.relayNote')}</p>
        <Actions>
          <Act variant="filled" submit label="SH-02.contact.save.btn" disabled={saving} />
          {contact !== null && <Act variant="link" label="SH-02.contact.remove.btn" disabled={saving} onClick={() => { void save(null); }} />}
        </Actions>
      </form>
    </section>
  );
}
