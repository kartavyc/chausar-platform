/**
 * FR-03 Create the vault and FR-04 Recovery kit, through the host controller's own calls
 * (`createWorkspace`, `acknowledgeRecovery`). The only engine read here is the disk check
 * (`todayx.diskCheck`, served before any vault), with the honest line under it.
 *
 * The passphrase is typed twice into fields this screen never stores. On Create it is read
 * once, handed to the host in the creation request, and both fields are emptied before the
 * request is awaited. The recovery code is shown large in groups of four; the screen keeps it
 * only until the box is ticked, after which it is no longer drawn. Continue waits for the box.
 */

import { useLayoutEffect, useRef, useState } from 'react';
import { useT } from '../../app/text';
import { Field } from '../../parts/Field';
import type { CreatedWorkspace, UiContext, WorkspaceCreateInput } from '../../host/contracts.ts';
import type { WorkspaceCreationState } from '../../host/controller.ts';
import { groupsOfFour } from './journey-contracts.ts';
import { DiskCheckLine } from './ThisComputer';
import type { ComputerPort } from './this-computer.ts';
import { Act, Actions, Note, Status, StepHeader } from './JourneyParts';
import s from './Journey.module.css';

/** The part of the host's state these two steps read. The host controller's own state satisfies it. */
export interface JourneyVaultState {
  readonly phase: 'loading' | 'ready' | 'locked' | 'unavailable';
  readonly code?: string | undefined;
  readonly context: UiContext | null;
  readonly creation: WorkspaceCreationState;
  readonly dictionaryReviewRequired: boolean;
}

export interface VaultProps {
  readonly state: JourneyVaultState;
  readonly createWorkspace: (input: WorkspaceCreateInput) => Promise<void>;
  readonly acknowledgeRecovery: (rendered: CreatedWorkspace) => Promise<boolean>;
  /** The vault is open and its kit was kept. */
  readonly onOpened: () => void;
  readonly onPrint?: ((kit: string) => void) | undefined;
  readonly onBack: () => void;
  /** For the disk check before the vault exists. Without it the line says the check is not built. */
  readonly rpc?: ComputerPort | undefined;
}

const FOLDER = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

function CreateVault({ state, createWorkspace, onBack, rpc }: Pick<VaultProps, 'state' | 'createWorkspace' | 'onBack' | 'rpc'>) {
  const t = useT();
  const [name, setName] = useState('');
  const [folder, setFolder] = useState('main');
  const [problem, setProblem] = useState<string | null>(null);
  const creation = state.creation;
  const busy = creation.kind === 'creating';
  return (
    <section data-first-run-screen="vault" data-first-run-create="">
      <StepHeader step={2} title="FR-03.title" lede="FR-03.lede" />
      <form onSubmit={event => {
        event.preventDefault();
        const elements = event.currentTarget.elements;
        const first = elements.namedItem('passphrase'), second = elements.namedItem('repeat');
        const typed = first instanceof HTMLInputElement ? first.value : '', repeated = second instanceof HTMLInputElement ? second.value : '';
        // The fields are emptied first, whatever happens next.
        if (first instanceof HTMLInputElement) first.value = '';
        if (second instanceof HTMLInputElement) second.value = '';
        const business = name.trim();
        if (business.length < 2 || business.length > 100) { setProblem('FR-03.nameNeeded'); return; }
        if (!FOLDER.test(folder.trim())) { setProblem('FR-03.folderBad'); return; }
        if ([...typed].length < 12) { setProblem('FR-03.short'); return; }
        if (typed !== repeated) { setProblem('FR-03.mismatch'); return; }
        setProblem(null);
        void createWorkspace({ name: business, folder: folder.trim(), passphrase: typed });
      }}>
        <div className={s.fields}>
          <Field label={t('FR-03.name')} value={name} onChange={event => setName(event.currentTarget.value)} autoComplete="organization" maxLength={100} />
          <div>
            <Field label={t('FR-03.folder')} value={folder} onChange={event => setFolder(event.currentTarget.value)} autoComplete="off" maxLength={64} spellCheck={false} />
            <Note k="FR-03.folder.note" />
          </div>
          <Field label={t('FR-03.passphrase')} name="passphrase" type="password" autoComplete="new-password" />
          <Field label={t('FR-03.repeat')} name="repeat" type="password" autoComplete="new-password" />
        </div>
        {problem !== null && <p className={s.problem} role="alert">{t(problem)}</p>}
        {creation.kind === 'failed' && <p className={s.problem} role="alert">{t('FR-03.failed', { code: creation.code })}</p>}
        {state.phase === 'unavailable' && state.code !== undefined && <p className={s.problem} role="alert">{t('FR-03.busy', { code: state.code })}</p>}
        {busy && <Status k="FR-03.creating" />}
        {rpc !== undefined ? <DiskCheckLine rpc={rpc} /> : <Note k="FR-03.disk" />}
        <Note k="FR-03.honest" />
        <Actions>
          <Act variant="filled" submit label="FR-03.create.btn" disabled={busy || state.phase !== 'locked'} />
          <Act variant="link" label="FR.journey.back.btn" onClick={onBack} disabled={busy} />
        </Actions>
      </form>
    </section>
  );
}

function RecoveryKit({ rendered, state, acknowledgeRecovery, onOpened, onPrint }: { rendered: Extract<WorkspaceCreationState, { kind: 'recovery-required' }> } & Pick<VaultProps, 'state' | 'acknowledgeRecovery' | 'onOpened' | 'onPrint'>) {
  const t = useT();
  const [kept, setKept] = useState(false);
  const [opening, setOpening] = useState(false);
  const keptNow = useRef(false);
  // A fresh rendering of the kit (after a lock and a fresh read) starts unticked.
  useLayoutEffect(() => { keptNow.current = false; setKept(false); setOpening(false); }, [rendered]);
  const kit = rendered.value.recoveryKit;
  return (
    <section data-first-run-screen="recovery" data-first-run-recovery="">
      <StepHeader step={2} title="FR-04.title" lede="FR-04.lede" />
      {kept
        ? <Note k="FR-04.hidden" role="status" />
        : (
          <>
            <h2 className={s.sectionTitle}>{t('FR-04.code')}</h2>
            <p className={[s.code, 'fig'].join(' ')} data-recovery-code="" aria-label={t('FR-04.code')}>
              {groupsOfFour(kit).map((group, index) => <span key={index}>{group}</span>)}
            </p>
          </>
        )}
      <ol className={s.kitLines}>
        <li>{t('FR-04.where')}</li>
        <li>{t('FR-04.how')}</li>
        <li>{t('FR-04.new')}</li>
      </ol>
      {onPrint !== undefined
        ? !kept && <Actions><Act label="FR-04.print.btn" onClick={() => { if (state.creation === rendered) onPrint(kit); }} /></Actions>
        : <Note k="FR-04.print.notBuilt" />}
      <label className={s.check}>
        <input type="checkbox" checked={kept} disabled={kept} onChange={event => { if (!event.currentTarget.checked) return; keptNow.current = true; setKept(true); }} />
        <span>{t('FR-04.kept')}</span>
      </label>
      {opening && <Status k="FR-04.opening" />}
      <Actions>
        <Act variant="filled" label="FR.journey.continue.btn" disabled={!kept || opening} onClick={() => {
          if (!keptNow.current || state.creation !== rendered) return;
          setOpening(true);
          void acknowledgeRecovery(rendered.value).then(admitted => { if (admitted) onOpened(); else setOpening(false); });
        }} />
      </Actions>
    </section>
  );
}

export function Vault(props: VaultProps) {
  const { state } = props;
  const creation = state.creation;
  if (creation.kind === 'recovery-required') return <RecoveryKit rendered={creation} state={state} acknowledgeRecovery={props.acknowledgeRecovery} onOpened={props.onOpened} onPrint={props.onPrint} />;
  if (creation.kind === 'recovery-held' || (creation.kind === 'idle' && state.phase === 'loading')) return <section data-first-run-screen="vault"><StepHeader step={2} title="FR-03.title" /><Status k="FR-03.reading" /></section>;
  if (creation.kind === 'unknown') return <section data-first-run-screen="vault"><StepHeader step={2} title="FR-03.title" /><Note k="FR-03.unknown" role="alert" /></section>;
  return <CreateVault state={state} createWorkspace={props.createWorkspace} onBack={props.onBack} rpc={props.rpc} />;
}
