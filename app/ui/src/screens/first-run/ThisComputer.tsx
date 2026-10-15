/**
 * Pieces about this computer that the journey, the lock screen and Trust · Vault share:
 * - `DiskCheckLine` (FR-03): the result of the disk check and, on Linux with no safe keyring,
 *   that the passphrase is asked each time.
 * - `LockFolderChoice` (SH-02, FR-01): which workspace folder to unlock, when there is more
 *   than one. Folder names only: nothing is decrypted while locked.
 * - `AskRecoveryContact` (SH-02, FR-13): "Recover through my contact" over hosted-link's
 *   `hosted.recovery.*` (ask, wait, a new passphrase twice, recovered); without hosted-link,
 *   frame-today's own `todayx.recoveryContact.request` and its answer in words.
 * - `RecoveryContactSettings` (TR-12): name the contact and how to reach them; kept in the vault.
 *
 * Words for the lock screen and Trust pieces are in the shared catalogue (`SH-02.*`), so they
 * draw under the host's own text provider; the disk lines are the first-run catalogue's.
 */

import { useEffect, useId, useRef, useState } from 'react';
import { useLanguage, useT } from '../../app/text';
import { Field } from '../../parts/Field';
import type { DiskCheckReply, RecoveryContact, WorkspaceFolder } from '../../bridge/todayx-contract.ts';
import { PASSPHRASE_MAX, PASSPHRASE_MIN, passphraseStatus, pollingStatus, type RecoveryChannel, type RecoveryStatus } from '../../bridge/hosted-recovery-contract.ts';
import type { JourneyFailure } from './journey-contracts.ts';
import { Act, Actions, Note, Status } from './JourneyParts';
import { checkRecovery, completeRecovery, recoveryFailureKey, recoveryRefusalKey, startRecovery } from './recovery-contact.ts';
import {
  askLineKey, diskLineKey, keyringLineKey, readDiskCheck, readRecoveryContact, readWorkspaceFolders, saveRecoveryContact,
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

/** Reads a password field once and empties it at once. */
function readAndClear(form: HTMLFormElement, name: string): string {
  const field = form.elements.namedItem(name);
  if (!(field instanceof HTMLInputElement)) return '';
  const value = field.value;
  field.value = '';
  return value;
}

const timeOf = (instant: string, language: string) =>
  new Intl.DateTimeFormat(language === 'hi' ? 'hi-IN' : 'en-IN', { hour: '2-digit', minute: '2-digit' }).format(new Date(instant));

type Tracking = {
  readonly kind: 'tracking'; readonly requestId: string; readonly expiresAt: string; readonly channel: RecoveryChannel;
  readonly status: RecoveryStatus; readonly failure: string | null;
};
type Asking =
  | { readonly kind: 'idle' } | { readonly kind: 'asking' }
  /** hosted-link is not here: frame-today's own answer, in today's words. */
  | { readonly kind: 'fallback'; readonly failure: JourneyFailure }
  | { readonly kind: 'failed'; readonly failure: JourneyFailure }
  | Tracking;

export interface AskRecoveryContactProps {
  readonly rpc: ComputerPort;
  readonly folder?: string | undefined;
  /** The engine opened the workspace after the recovery: the host reads its state again. */
  readonly onRecovered?: (() => void) | undefined;
  /** How often the request is checked. About once a second. */
  readonly pollMs?: number | undefined;
}

/**
 * "Recover through my contact" (FR-13, SH-02) over hosted-link's `hosted.recovery.*`: ask, wait while
 * the contact answers (checked about once a second, stopped on unmount), then the new passphrase
 * twice in uncontrolled fields that are read once and emptied at once, then recovering and
 * recovered. Without hosted-link it asks `todayx.recoveryContact.request` and says what it said.
 */
export function AskRecoveryContact({ rpc, folder = 'main', onRecovered, pollMs = 1000 }: AskRecoveryContactProps) {
  const t = useT();
  const language = useLanguage();
  const [state, setState] = useState<Asking>({ kind: 'idle' });
  const [problem, setProblem] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const requestId = state.kind === 'tracking' ? state.requestId : null;
  const polling = state.kind === 'tracking' && pollingStatus(state.status);
  useEffect(() => {
    if (requestId === null || !polling) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      const result = await checkRecovery(rpc, requestId, folder);
      if (!live) return;
      if (result.kind === 'not-built' || result.kind === 'refused') { setState({ kind: 'failed', failure: result }); return; }
      setState(current => current.kind !== 'tracking' || current.requestId !== requestId ? current
        : result.kind === 'busy' ? { ...current, status: 'recovering' }
        : { ...current, status: result.reply.status, failure: result.reply.failure ?? null, expiresAt: result.reply.expiresAt ?? current.expiresAt });
      timer = setTimeout(() => { void tick(); }, pollMs);
    };
    timer = setTimeout(() => { void tick(); }, pollMs);
    return () => { live = false; if (timer !== undefined) clearTimeout(timer); };
  }, [rpc, folder, requestId, polling, pollMs]);

  const start = async () => {
    setState({ kind: 'asking' }); setProblem(null);
    const started = await startRecovery(rpc, folder);
    if (!mounted.current) return;
    if (started.kind === 'waiting') {
      setState({ kind: 'tracking', requestId: started.reply.requestId, expiresAt: started.reply.expiresAt, channel: started.reply.contactChannel, status: 'waiting', failure: null });
    } else if (started.kind === 'fallback') setState(started);
    else setState({ kind: 'failed', failure: started });
  };

  const complete = async (form: HTMLFormElement, tracking: Tracking) => {
    const typed = readAndClear(form, 'new-passphrase'), repeated = readAndClear(form, 'repeat-passphrase');
    if (typed !== repeated) { setProblem('FR-13.contact.mismatch'); return; }
    if (typed.length < PASSPHRASE_MIN || typed.length > PASSPHRASE_MAX) { setProblem('FR-13.contact.short'); return; }
    setProblem(null); setSending(true);
    const result = await completeRecovery(rpc, tracking.requestId, folder, typed);
    if (!mounted.current) return;
    setSending(false);
    if (result.kind === 'started') {
      setState(current => current.kind === 'tracking' && current.requestId === tracking.requestId ? { ...current, status: result.reply.status, failure: null } : current);
    } else if (result.kind === 'refused' && result.code === 'WEAK_PASSPHRASE') setProblem('FR-13.contact.short');
    else setState({ kind: 'failed', failure: result });
  };

  const again = <Actions><Act label="FR-13.contact.again.btn" onClick={() => { void start(); }} /></Actions>;
  const refusedLine = (failure: JourneyFailure) => failure.kind === 'not-built'
    ? <p className={s.status} role="status" data-recovery-contact-refused="not-built">{t('FR-13.contact.notBuilt')}</p>
    : <p className={s.problem} role="alert" data-recovery-contact-refused={failure.code}>{t(recoveryRefusalKey(failure.code), { code: failure.code })}</p>;

  return (
    <div data-ask-recovery-contact="" data-recovery-contact={state.kind === 'tracking' ? state.status : state.kind}>
      {(state.kind === 'idle' || state.kind === 'asking' || state.kind === 'fallback') && (
        <>
          <p className={s.note}>{t('FR-13.contact.title')}</p>
          <Actions>
            <Act variant="link" label="SH-02.contact.btn" disabled={state.kind === 'asking'} onClick={() => { void start(); }} />
          </Actions>
        </>
      )}
      {state.kind === 'asking' && <Status k="FR-13.contact.asking" />}
      {state.kind === 'fallback' && (
        <p className={state.failure.kind === 'not-built' ? s.status : s.note} role="status" data-recovery-contact-answer={state.failure.kind === 'refused' ? state.failure.code : 'not-built'}>
          {t(askLineKey(state.failure), state.failure.kind === 'refused' ? { code: state.failure.code } : undefined)}
        </p>
      )}
      {state.kind === 'failed' && <>{refusedLine(state.failure)}{again}</>}
      {state.kind === 'tracking' && (
        <section className={s.section}>
          <h2 className={s.sectionTitle}>{t('FR-13.contact.title')}</h2>
          {state.status === 'waiting' && <>
            <p className={s.note} data-recovery-contact-expires="">{t('FR-13.contact.asked', { channel: t(`FR-13.contact.channel.${state.channel}`), time: timeOf(state.expiresAt, language) })}</p>
            <Status k="FR-13.contact.waiting" />
          </>}
          {state.status === 'declined' && <><p className={s.problem} role="alert">{t('FR-13.contact.declined')}</p>{again}</>}
          {state.status === 'expired' && <><p className={s.problem} role="alert">{t('FR-13.contact.expired')}</p>{again}</>}
          {state.status === 'failed' && <><p className={s.problem} role="alert">{t('FR-13.contact.failed')}</p>{again}</>}
          {passphraseStatus(state.status) && (
            state.failure === 'RECOVERY_CODE_REJECTED'
              ? <p className={s.problem} role="alert" data-recovery-contact-failure={state.failure}>{t(recoveryFailureKey(state.failure))}</p>
              : <form onSubmit={event => { event.preventDefault(); void complete(event.currentTarget, state); }}>
                <p className={s.status} role="status">{t('FR-13.contact.confirmed')}</p>
                {state.failure !== null && <p className={s.problem} role="alert" data-recovery-contact-failure={state.failure}>{t(recoveryFailureKey(state.failure), { code: state.failure })}</p>}
                <div className={s.fields}>
                  <Field label={t('FR-13.contact.passphrase')} name="new-passphrase" type="password" autoComplete="new-password" />
                  <Field label={t('FR-13.contact.repeat')} name="repeat-passphrase" type="password" autoComplete="new-password" />
                </div>
                {problem !== null && <p className={s.problem} role="alert" data-recovery-contact-problem="">{t(problem)}</p>}
                <Actions><Act variant="filled" submit label="FR-13.contact.recover.btn" disabled={sending} /></Actions>
              </form>
          )}
          {state.status === 'recovering' && <Status k="FR-13.contact.recovering" />}
          {state.status === 'recovered' && <>
            <p className={s.status} role="status" data-recovery-contact-recovered="">{t('FR-13.contact.recovered')}</p>
            {onRecovered !== undefined && <Actions><Act variant="filled" label="FR-13.contact.open.btn" onClick={onRecovered} /></Actions>}
          </>}
        </section>
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
