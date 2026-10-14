/**
 * FR-13 Open a vault with the recovery kit. The code and a new passphrase pass straight to
 * the engine's `workspace.recover` once; both passphrase fields and the code field are
 * emptied before the request is awaited. "Choose your backup file" uses the host's own
 * chooser for a managed backup and the engine's `workspace.restore`; without that chooser
 * it says it is not built here yet. After the vault opens, the host reopens its view.
 * "Ask recovery contact" is the second way in; the engine refuses it until the hosted relay
 * exists, and the screen says so.
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

export function Recover({ rpc, pickBackup, onReopened, onBack }: RecoverProps) {
  const t = useT();
  const [folder, setFolder] = useState('main');
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'none' });

  const open = async (form: HTMLFormElement, backupFile: string | null) => {
    const code = typedRecoveryCode(readAndClear(form, 'recovery-code'));
    const typed = readAndClear(form, 'passphrase'), repeated = readAndClear(form, 'repeat');
    if (!FOLDER.test(folder.trim())) { setOutcome({ kind: 'problem', key: 'FR-03.folderBad' }); return; }
    if ([...typed].length < 12) { setOutcome({ kind: 'problem', key: 'FR-03.short' }); return; }
    if (typed !== repeated) { setOutcome({ kind: 'problem', key: 'FR-03.mismatch' }); return; }
    setOutcome({ kind: 'opening' });
    try {
      const reply = backupFile === null
        ? await rpc.request('workspace.recover', { folder: folder.trim(), recoveryCode: code, passphrase: typed })
        : await rpc.request('workspace.restore', { folder: folder.trim(), backupFile, passphrase: typed });
      const opened = validateOpened(reply);
      setOutcome({ kind: 'opened', name: opened.name });
      onReopened?.();
    } catch (error) { setOutcome({ kind: 'failed', failure: failureOf(error) }); }
  };

  return (
    <section data-first-run-screen="recover">
      <StepHeader step={1} title="FR-13.title" lede="FR-13.lede" />
      <form onSubmit={event => { event.preventDefault(); void open(event.currentTarget, null); }}>
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
          <Act variant="filled" submit label="FR-13.open.btn" disabled={outcome.kind === 'opening' || outcome.kind === 'opened'} />
          {pickBackup !== undefined && (
            <Act label="FR-13.backup.btn" disabled={outcome.kind === 'opening' || outcome.kind === 'opened'} onClick={event => {
              const form = event.currentTarget.form;
              if (form === null) return;
              void pickBackup().then(file => { if (file !== null) void open(form, file); }, (error: unknown) => setOutcome({ kind: 'failed', failure: failureOf(error) }));
            }} />
          )}
          <Act variant="link" label="FR.journey.back.btn" onClick={onBack} disabled={outcome.kind === 'opening'} />
        </Actions>
        {pickBackup === undefined && <Note k="FR-13.backup.notBuilt" />}
      </form>
      <AskRecoveryContact rpc={rpc} folder={FOLDER.test(folder.trim()) ? folder.trim() : 'main'} />
    </section>
  );
}
