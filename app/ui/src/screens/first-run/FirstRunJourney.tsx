/**
 * The whole first run as one journey: install, vault and recovery kit, model route, first
 * source, meanings, first answer with its receipt. The frame is the FirstRunStep pattern; the
 * order and what is done come from the pure machine in `journey.ts`; every engine reply is
 * checked in `journey-contracts.ts` (or the existing slice's contracts) before it is drawn.
 *
 * The host owns the transport, the vault creation and the meanings controller. It passes:
 * - `host`: its controller (snapshot, subscribe, createWorkspace, acknowledgeRecovery,
 *   firstRun, setFirstRunSurface, completeFirstRun). The journey sets the first-run surface
 *   itself: the meanings controller is live only while the Meanings step is on screen.
 * - `rpc`: its named-request port (`controller.places`).
 * - the language and the view, held in memory by the host until the vault exists, and
 *   `onDone`, called when the person goes to Today.
 * Optional native pieces (`pickFile`, `saveRouteKey`, `onPrint`, `pickBackup`,
 * `onOpenReceipt`, `onDemo`, `onReopened`) each draw "not built yet" when absent.
 * `onOpenFolder` lets Welcome offer "Open <folder>" for the workspace folders already on this
 * computer (`todayx.workspaces`); the host then draws its lock screen for that folder.
 *
 * The language and view are held in memory until the vault exists (FR-01), then saved for this
 * computer with `todayx.device.set`, and again whenever they change while it is open.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { Language, View } from '../../app/presentation.ts';
import { useT } from '../../app/text';
import { FirstRunStep } from '../../patterns/FirstRunStep';
import { isFirstRunStatusReply, isIdentityCard } from '../../bridge/todayx-contract.ts';
import type { CreatedWorkspace, WorkspaceCreateInput } from '../../host/contracts.ts';
import type { FirstRunController, FirstRunHandoff } from './controller.ts';
import { FirstRunTask } from './FirstRun';
import { BringFile, type PickedFile } from './BringFile';
import { FirstAnswer } from './FirstAnswer';
import { Identity } from './Identity';
import { Idea } from './Idea';
import { ProposedMeanings } from './ProposedMeanings';
import { proposalCache, type ProposalsOutcome } from './proposals.ts';
import { Model, type SaveRouteKey } from './Model';
import { Recover } from './Recover';
import { Vault, type JourneyVaultState } from './Vault';
import { Welcome } from './Welcome';
import { blockedOf, createJourneyStore, elapsedSeconds, isDone, journeySteps, leftOf, vaultOpen, type JourneyState } from './journey.ts';
import { failureOf, type JourneyPort } from './journey-contracts.ts';
import { Act, Actions, Note, StepHeader } from './JourneyParts';
import { readWorkspaceFolders, saveDeviceChoices } from './this-computer.ts';
import { FirstRunText } from './text';

/** What the journey needs of the host controller. `HostController` satisfies it. */
export interface JourneyHost {
  snapshot(): JourneyVaultState;
  subscribe(listener: () => void): () => void;
  createWorkspace(input: WorkspaceCreateInput): Promise<void>;
  acknowledgeRecovery(rendered: CreatedWorkspace): Promise<boolean>;
  readonly firstRun: FirstRunController;
  setFirstRunSurface(live: (() => boolean) | null): void;
  completeFirstRun(handoff: FirstRunHandoff): boolean;
}

export interface FirstRunJourneyProps {
  readonly host: JourneyHost;
  readonly rpc: JourneyPort;
  readonly language: Language;
  readonly onLanguage: (language: Language) => void;
  readonly view: View;
  readonly onView: (view: View) => void;
  /** Go to Today. */
  readonly onDone: () => void;
  readonly pickFile?: (() => Promise<PickedFile | null>) | undefined;
  readonly saveRouteKey?: SaveRouteKey | undefined;
  readonly onPrint?: ((kit: string) => void | Promise<void>) | undefined;
  readonly pickBackup?: (() => Promise<string | null>) | undefined;
  readonly onOpenReceipt?: ((id: string) => void) | undefined;
  readonly onDemo?: (() => void) | undefined;
  readonly onReopened?: (() => void) | undefined;
  /** Open a workspace folder already on this computer at its lock screen. */
  readonly onOpenFolder?: ((folder: string) => void) | undefined;
  /** The clock for the time from the first screen to the first receipt. */
  readonly now?: (() => number) | undefined;
}

function Task({ state, host, hostState, props, heldFile, setHeldFile, identityCode, dispatch, propose, folders }: {
  state: JourneyState;
  propose: (file: PickedFile) => Promise<ProposalsOutcome>;
  folders: readonly string[];
  identityCode: string;
  host: JourneyHost;
  hostState: JourneyVaultState;
  props: FirstRunJourneyProps;
  heldFile: PickedFile | null;
  setHeldFile: (file: PickedFile | null) => void;
  dispatch: ReturnType<typeof createJourneyStore>['dispatch'];
}) {
  const t = useT();
  const now = props.now ?? Date.now;
  switch (state.screen) {
    case 'welcome':
      return <Welcome view={props.view} onView={props.onView}
        openWorkspace={hostState.phase === 'ready' && hostState.context !== null ? hostState.context.workspace.name : null}
        onOpen={() => dispatch({ type: 'resume' })} onBusiness={() => dispatch({ type: 'begin', path: 'business' })}
        onIdea={() => dispatch({ type: 'begin', path: 'idea' })} onRecover={() => dispatch({ type: 'open-recover' })} onDemo={props.onDemo}
        folders={folders} onOpenFolder={props.onOpenFolder} />;
    case 'recover':
      return <Recover rpc={props.rpc} pickBackup={props.pickBackup} onReopened={props.onReopened} onBack={() => dispatch({ type: 'close-recover' })} />;
    case 'identity':
      return <Identity rpc={props.rpc} held={state.identity} onHold={identity => dispatch({ type: 'identity-held', identity })} onBack={() => dispatch({ type: 'back' })} />;
    case 'vault':
      return <Vault state={hostState} createWorkspace={input => host.createWorkspace(input)} acknowledgeRecovery={rendered => host.acknowledgeRecovery(rendered)}
        onOpened={() => dispatch({ type: 'vault-open' })} onPrint={props.onPrint} onBack={() => dispatch({ type: 'back' })} rpc={props.rpc} />;
    case 'model':
      return (
        <>
          {state.identityWritten === 'saved' && <Note k="FR-02.saved" role="status" />}
          {state.identityWritten === 'not-built' && <Note k="FR-02.saveNotBuilt" role="status" />}
          {state.identityWritten === 'refused' && <Note k="FR-02.saveRefused" values={{ code: identityCode }} role="status" />}
          <Model rpc={props.rpc} saveRouteKey={props.saveRouteKey} onDone={outcome => dispatch({ type: 'model-done', outcome })} />
        </>
      );
    case 'file':
      return <BringFile rpc={props.rpc} pickFile={props.pickFile} held={heldFile} onHold={setHeldFile} meaningsAgreed={isDone(state, 'meanings')}
        company={hostState.context?.workspace.name ?? ''} onTaken={() => { setHeldFile(null); dispatch({ type: 'file-taken' }); }}
        onWaits={() => dispatch({ type: 'file-waits' })} propose={propose} />;
    case 'meanings':
      return (
        <>
          {state.fileWaiting && <Note k="FR-08.journey.waiting" role="status" />}
          {state.fileWaiting && heldFile !== null && <ProposedMeanings file={heldFile} propose={propose} />}
          <div data-first-run-screen="meanings">
            <FirstRunTask controller={host.firstRun} language={props.language} view={props.view} intents={{
              onContinue: handoff => { if (host.completeFirstRun(handoff)) dispatch({ type: 'meanings-agreed' }); },
            }} />
          </div>
        </>
      );
    case 'answer':
      return <FirstAnswer rpc={props.rpc} elapsed={elapsedSeconds(state)} onAnswered={() => dispatch({ type: 'answered', at: now() })}
        onOpenReceipt={props.onOpenReceipt} onToday={props.onDone} />;
    case 'idea':
      return <Idea rpc={props.rpc} onDone={() => dispatch({ type: 'idea-done' })} />;
    case 'finished':
      return (
        <section data-first-run-screen="finished">
          <StepHeader step={6} title="FR.journey.finished" lede="FR.journey.finished.lede" />
          <Actions><Act variant="filled" label="FR.journey.today.btn" onClick={props.onDone} /></Actions>
          <span className="sr">{t('FR.journey.finished')}</span>
        </section>
      );
  }
}

export function FirstRunJourney(props: FirstRunJourneyProps) {
  const { host, rpc, language, onLanguage } = props;
  const store = useMemo(() => createJourneyStore((props.now ?? Date.now)()), []);
  const state = useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
  const hostState = useSyncExternalStore(host.subscribe, host.snapshot, host.snapshot);
  const [heldFile, setHeldFile] = useState<PickedFile | null>(null);
  const [identityCode, setIdentityCode] = useState('INVALID_REPLY');
  // One draft per held sheet for the life of the journey, whichever step shows it.
  const propose = useMemo(() => proposalCache(rpc), [rpc]);
  const [folders, setFolders] = useState<readonly string[]>([]);
  const mounted = useRef(false);
  const task = useRef<HTMLDivElement>(null);
  const shownScreen = useRef(state.screen);

  // The meanings controller is live only while its step is on screen.
  useLayoutEffect(() => {
    mounted.current = true;
    host.setFirstRunSurface(() => mounted.current && store.snapshot().screen === 'meanings');
    return () => { mounted.current = false; host.setFirstRunSurface(null); };
  }, [host, store]);

  // A new step takes the focus, so the keyboard continues inside it.
  useEffect(() => {
    if (shownScreen.current === state.screen) return;
    shownScreen.current = state.screen;
    task.current?.focus();
  }, [state.screen]);

  // The vault became open through the host (the kit was kept): the journey moves on.
  useEffect(() => {
    if (state.screen === 'vault' && hostState.phase === 'ready' && hostState.context !== null && hostState.creation.kind === 'idle') store.dispatch({ type: 'vault-open' });
  }, [state.screen, hostState, store]);

  // Meanings already agreed by the host (published before this journey): nothing to review.
  useEffect(() => {
    if (state.screen === 'meanings' && hostState.phase === 'ready' && hostState.context !== null && !hostState.dictionaryReviewRequired) store.dispatch({ type: 'meanings-agreed' });
  }, [state.screen, hostState, store]);

  // FR-01: the workspace folders already on this computer, by name only, while no vault is open.
  const open = vaultOpen(state);
  const offerFolders = props.onOpenFolder !== undefined && !open && state.screen === 'welcome';
  useEffect(() => {
    if (!offerFolders) return;
    let live = true;
    void readWorkspaceFolders(rpc).then(found => { if (live) setFolders(found.map(item => item.folder)); });
    return () => { live = false; };
  }, [offerFolders, rpc]);

  // FR-01/SH-06: nothing is stored before the vault exists; from then on the language and view are kept for this computer.
  const { view } = props;
  useEffect(() => {
    if (!open) return;
    void saveDeviceChoices(rpc, language, view);
  }, [open, language, view, rpc]);

  // After the vault exists, the engine's status is read again whenever a step changes.
  const doneKey = JSON.stringify(state.local);
  useEffect(() => {
    if (!open) return;
    let live = true;
    void rpc.request('todayx.firstRun.status', {}).then(reply => {
      if (!live) return;
      if (isFirstRunStatusReply(reply)) store.dispatch({ type: 'status', reply });
      else store.dispatch({ type: 'status-not-built' });
    }, () => { if (live) store.dispatch({ type: 'status-not-built' }); });
    return () => { live = false; };
  }, [open, state.screen, doneKey, rpc, store]);

  // The identity card held in memory is written once the vault exists.
  useEffect(() => {
    if (!open || state.identityWritten !== 'held') return;
    let live = true;
    const card = state.identity;
    void rpc.request('todayx.identity.save', { fields: card.fields, gstMode: card.gstMode }).then(reply => {
      if (live) store.dispatch({ type: 'identity-written', outcome: isIdentityCard(reply) ? 'saved' : 'refused' });
    }, (error: unknown) => {
      if (!live) return;
      const failure = failureOf(error);
      if (failure.kind === 'refused') setIdentityCode(failure.code);
      store.dispatch({ type: 'identity-written', outcome: failure.kind === 'not-built' ? 'not-built' : 'refused' });
    });
    return () => { live = false; };
  }, [open, state.identityWritten, state.identity, rpc, store]);

  return (
    <FirstRunText language={language}>
      <FirstRunStep language={language} onLanguage={onLanguage} steps={journeySteps(state)} blocked={blockedOf(state)} left={leftOf(state)}>
        <div ref={task} tabIndex={-1} data-first-run-journey={state.screen} style={{ outline: 'none' }}>
          <Task state={state} host={host} hostState={hostState} props={props} heldFile={heldFile} setHeldFile={setHeldFile} identityCode={identityCode} dispatch={store.dispatch} propose={propose} folders={folders} />
        </div>
      </FirstRunStep>
    </FirstRunText>
  );
}
