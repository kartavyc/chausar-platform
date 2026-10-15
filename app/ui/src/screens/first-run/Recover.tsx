/**
 * FR-13 Open a vault with the recovery kit. The code and a new passphrase pass straight to
 * the engine's `workspace.recover` once; both passphrase fields and the code field are
 * emptied before the request is awaited. "Choose backup file" uses the host's own chooser
 * (`imports.pickFile` for a backup: the system dialog in the app's managed backups folder,
 * answered with the managed name only). The chosen name is shown, and that backup's own
 * passphrase is typed in one uncontrolled field, read once and emptied at once, and passed
 * with the name to `workspace.restore` (`{ folder, backupFile, passphrase }`). Without the
 * chooser (the browser) it says it is not built here yet. After the vault opens, the host
 * reopens its view.
 * "Recover through my contact" is the second way in, over hosted-link's `hosted.recovery.*`;
 * without hosted-link frame-today's own request refuses it, and the screen says so.
 */

import { useState } from 'react';
import { useT } from '../../app/text';
import { Field } from '../../parts/Field';
import { failureOf, typedRecoveryCode, validateOpened, type JourneyFailure, type JourneyPort } from './journey-contracts.ts';
import { Act, Actions, FailureLine, Note, Status, StepHeader } from './JourneyParts';
import { AskRecoveryContact } from './ThisComputer';
import s from './Journey.module.css';

export interface RecoverProps {
  readonly rpc: JourneyPort;
  /** The host's chooser for a managed backup file name. */
  readonly pickBackup?: (() => Promise<string | null>) | undefined;
  /** The vault is open: the host reads its state again. */
  readonly onReopened?: (() => void) | undefined;
  readonly onBack: () => void;
}

const FOLDER = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
type Outcome = { readonly kind: 'none' } | { readonly kind: 'opening' } | { readonly kind: 'opened'; readonly name: string } | { readonly kind: 'failed'; readonly failure: JourneyFailure } | { readonly kind: 'problem'; readonly key: string };

function readAndClear(form: HTMLFormElement, name: string): string {
  const field = form.elements.namedItem(name);
  if (!(field instanceof HTMLInputElement)) return '';
  const value = field.value;
  field.value = '';
  return value;
}

const PICK_REFUSED: ReadonlySet<string> = new Set(['BACKUP_NOT_MANAGED', 'FILE_UNREADABLE', 'PICKER_BUSY', 'FILE_KIND_REFUSED']);

export function Recover({ rpc, pickBackup, onReopened, onBack }: RecoverProps) {
  const t = useT();
  const [folder, setFolder] = useState('main');
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'none' });
  /** The managed backup name the chooser answered; never a path. */
  const [backup, setBackup] = useState<string | null>(null);

  const send = async (request: () => Promise<unknown>) => {
    setOutcome({ kind: 'opening' });
    try {
      const opened = validateOpened(await request());
      setOutcome({ kind: 'opened', name: opened.name });
      onReopened?.();
    } catch (error) { setOutcome({ kind: 'failed', failure: failureOf(error) }); }
  };

  const open = async (form: HTMLFormElement) => {
    const code = typedRecoveryCode(readAndClear(form, 'recovery-code'));
    const typed = readAndClear(form, 'passphrase'), repeated = readAndClear(form, 'repeat');
    if (!FOLDER.test(folder.trim())) { setOutcome({ kind: 'problem', key: 'FR-03.folderBad' }); return; }
    if ([...typed].length < 12) { setOutcome({ kind: 'problem', key: 'FR-03.short' }); return; }
    if (typed !== repeated) { setOutcome({ kind: 'problem', key: 'FR-03.mismatch' }); return; }
    await send(() => rpc.request('workspace.recover', { folder: folder.trim(), recoveryCode: code, passphrase: typed }));
  };

  /** The backup's own passphrase passes once, with the managed name, to `workspace.restore`. */
  const restore = async (form: HTMLFormElement, backupFile: string) => {
    const typed = readAndClear(form, 'backup-passphrase');
    if (!FOLDER.test(folder.trim())) { setOutcome({ kind: 'problem', key: 'FR-03.folderBad' }); return; }
    if (typed.length === 0) { setOutcome({ kind: 'problem', key: 'FR-13.backup.passphraseNeeded' }); return; }
    await send(() => rpc.request('workspace.restore', { folder: folder.trim(), backupFile, passphrase: typed }));
  };

  const choose = () => {
    if (pickBackup === undefined) return;
    void pickBackup().then(name => { if (name !== null) { setBackup(name); setOutcome({ kind: 'none' }); } }, (error: unknown) => {
      const failure = failureOf(error);
      setOutcome(failure.kind === 'refused' && PICK_REFUSED.has(failure.code) ? { kind: 'problem', key: `FR-13.backup.${failure.code}` } : { kind: 'failed', failure });
    });
  };
  const busy = outcome.kind === 'opening' || outcome.kind === 'opened';

  return (
    <section data-first-run-screen="recover">
      <StepHeader step={1} title="FR-13.title" lede="FR-13.lede" />
      <form onSubmit={event => { event.preventDefault(); void open(event.currentTarget); }}>
        <div className={s.fields}>
          <Field label={t('FR-13.code')} name="recovery-code" autoComplete="off" spellCheck={false} className="fig" />
          <Field label={t('FR-13.folder')} value={folder} onChange={event => setFolder(event.currentTarget.value)} autoComplete="off" spellCheck={false} />
          <Field label={t('FR-13.passphrase')} name="passphrase" type="password" autoComplete="new-password" />
          <Field label={t('FR-13.repeat')} name="repeat" type="password" autoComplete="new-password" />
        </div>
        {outcome.kind === 'problem' && <p className={s.problem} role="alert">{t(outcome.key)}</p>}
        {outcome.kind === 'opening' && <Status k="FR-13.opening" />}
        {outcome.kind === 'opened' && <Status k="FR-13.opened" values={{ name: outcome.name }} />}
        {outcome.kind === 'failed' && <FailureLine failure={outcome.failure} notBuilt="FR-13.notBuilt" refused="FR-13.refused" />}
        <Actions>
          <Act variant="filled" submit label="FR-13.open.btn" disabled={busy} />
          {pickBackup !== undefined && <Act label="FR-13.backup.btn" disabled={busy} onClick={choose} />}
          <Act variant="link" label="FR.journey.back.btn" onClick={onBack} disabled={outcome.kind === 'opening'} />
        </Actions>
        {pickBackup === undefined && <Note k="FR-13.backup.notBuilt" />}
      </form>
      {backup !== null && (
        <form className={s.section} data-backup-chosen="" onSubmit={event => { event.preventDefault(); void restore(event.currentTarget, backup); }}>
          <p className={s.question} data-backup-name="">{t('FR-13.backup.chosen', { name: backup })}</p>
          <Field label={t('FR-13.backup.passphrase')} name="backup-passphrase" type="password" autoComplete="off" />
          <Note k="FR-13.backup.note" />
          <Actions><Act variant="filled" submit label="FR-13.backup.open.btn" disabled={busy} /></Actions>
        </form>
      )}
      <AskRecoveryContact rpc={rpc} folder={FOLDER.test(folder.trim()) ? folder.trim() : 'main'} onRecovered={onReopened} />
    </section>
  );
}
