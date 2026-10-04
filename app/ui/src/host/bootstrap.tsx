/** Explicit, additive Today/Ask mount. Transport and authority arrive via the host controller. */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { App, type AppProps } from '../app/App';
import { ConversationWorkspace, type ConversationWorkspaceProps, type SavedReadbackOrigin } from '../app/ConversationWorkspace';
import { PageHeader } from '../app/PageHeader';
import type { Address, Language, View } from '../app/presentation.ts';
import { formatAddress, parseAddress, sameAddress, withoutSheet, withSheet } from '../app/routes.ts';
import { TextProvider, useT } from '../app/text';
import type { ConversationSavedAnswer } from '../bridge/conversation-host.ts';
import type { CalculationReceiptEvidence, ReceiptPeriod } from '../bridge/presentation.ts';
import { projectTodayHostForUi } from '../bridge/today-host.ts';
import { Button } from '../parts/Button';
import { Label } from '../parts/Label';
import { Sheet, type SheetProps } from '../parts/Sheet';
import { State } from '../patterns/States';
import type { ConversationReferenceIntent } from '../screens/ask/ConversationAnswer';
import { RetainedScenario, ScenarioProvenanceBody, type RetainedScenarioShown } from '../screens/ask/RetainedScenario';
import { LessonReviewSheet } from '../screens/reports/LessonReview';
import { RetainedPlace, retainedSurface } from '../screens/retained/RetainedPlace';
import type { TodayData } from '../screens/today/TodayData.ts';
import { TodayDestination } from '../screens/today/TodayDestination.tsx';
import { projectTodayConsumer } from './today-controller.ts';
import type { TodayConsumerState } from './today-controller.ts';
import type { TodayDetail } from '../bridge/today-navigation.ts';
import type { UiContext, UiModelRoute } from './contracts.ts';
import type { HostController, HostReceiptSelection, HostState } from './controller.ts';
import { discoveryRowFor, lessonDecisionAvailability, sameScenarioSelection, scenarioProof } from './retained-contracts.ts';
import type { LessonDecisionIntent, LessonReviewView, RetainedScenarioView, ScenarioDiscoveryRow, ScenarioSelection } from './retained-contracts.ts';
import type { LessonReviewState, RetainedScenarioState, RetainedState, ScenarioContinuation, ScenarioDetailOrigin, ScenarioListOrigin, ScenarioRowOrigin } from './retained-controller.ts';
import { hostMessage, hostMissingWords } from './text.ts';
import detail from '../patterns/ModelConsentSheet.module.css';
import '../tokens/index.css';
import '../views/simple.css';
import '../views/books.css';
import './host.css';

export { createHostController } from './controller.ts';
export { createDesktopRequestPort } from '../bridge/client.ts';
export type { HostRpcPort } from './contracts.ts';
export type { ScenarioSelection } from './retained-contracts.ts';

export interface HostMountOptions {
  readonly language?: Language;
  readonly view?: View;
  /** The trusted entry preserves its transport context when returning to legacy. */
  readonly onLegacyReturn?: () => void;
  /**
   * An exact retained scenario pin chosen by the trusted host, opened on Ask, Saved with a
   * fresh authorized `scenarios.reopen` and shown alone. Without it Saved lists the released
   * what-if revisions through `scenarios.discover`; a row a person chooses is ephemeral
   * controller state and is never rescued by this static option after an invalidation. This
   * is a callback seam only: no native host supplies it yet, and it never carries catalogue
   * data or snapshots.
   */
  readonly scenarioSelection?: ScenarioSelection;
}
export interface MountedHost {
  /** Both names dispose the injected controller and unmount the one React root. */
  unmount(): void;
  dispose(): void;
}

const TODAY: Address = { place: 'today', sub: 'today' };
const ASK: Address = { place: 'ask', sub: 'new' };
const MODELS: Address = { place: 'trust', sub: 'models' };
const ROLE_KEY = { owner: 'roleOwner', cofounder: 'roleCofounder', accountant: 'roleAccountant', viewer: 'roleViewer' } as const;

function navigate(address: Address): void { window.location.hash = formatAddress(address); }
function currentOrigin(): HTMLElement | null {
  return document.activeElement instanceof HTMLElement ? document.activeElement : null;
}
/** The same place and sub-place, whatever sheet is open. */
function samePlace(a: Address, b: Address): boolean { return a.place === b.place && a.sub === b.sub; }

function RoutePicker({ routes, selected, language, viewer, onSelect }: {
  routes: readonly UiModelRoute[];
  selected: string | null;
  language: Language;
  viewer: boolean;
  onSelect: (id: string | null) => void;
}) {
  const labelId = 'host-route-label';
  return <section>
    <PageHeader where={hostMessage(language, 'routeLabel')} title={hostMessage(language, 'routesTitle')} />
    <p className={detail.note}>{hostMessage(language, 'routesNote')}</p>
    <p className={detail.note}>{hostMessage(language, 'routesUnverified')}</p>
    {viewer ? <p role="status">{hostMessage(language, 'viewerNoAsk')}</p> : routes.length === 0 ?
      <p role="status">{hostMessage(language, 'routesEmpty')}</p> : <div className={detail.block}>
        <label id={labelId} htmlFor="host-route">{hostMessage(language, 'routeLabel')}</label>
        <select id="host-route" aria-labelledby={labelId} value={selected ?? ''}
          onChange={event => onSelect(event.currentTarget.value || null)}>
          <option value="">{hostMessage(language, 'routePlaceholder')}</option>
          {routes.map(route => <option key={route.id} value={route.id} disabled={!route.enabled}>
            {route.enabled ? hostMessage(language, 'routeDescription', { label: route.label, kind: route.kind, model: route.model })
              : hostMessage(language, 'routeDisabled', { label: route.label })}
          </option>)}
        </select>
        {selected !== null && <Button variant="link" onClick={() => onSelect(null)}>{hostMessage(language, 'routeClear')}</Button>}
      </div>}
  </section>;
}

function ReceiptBody({ value, language }: { value: CalculationReceiptEvidence; language: Language }) {
  const words = hostMissingWords(language);
  const m = (key: Parameters<typeof hostMessage>[1]) => hostMessage(language, key);
  const range = (period: ReceiptPeriod | null) => period === null ? words['not-applicable'] :
    hostMessage(language, 'dateRange', { from: period.from, to: period.to });
  const ids = (values: readonly string[]) => values.length === 0 ? m('none') : values.join(', ');
  const known = value.coverage.completeness !== 'empty' && !(value.coverage.completeness === 'partial' && value.coverage.countedRows === 0);
  const pairs = (items: readonly (readonly [string, ReactNode])[]) => <dl className={detail.pairs}>
    {items.map(([name, content]) => <div className={detail.pair} key={name}>
      <dt className={detail.name}>{name}</dt><dd className={detail.value}>{content}</dd>
    </div>)}
  </dl>;
  return <>
    <p className={detail.note}>{m('receiptSubset')}</p>
    <p className={detail.note}>{m(value.stale ? 'stale' : 'fresh')}</p>
    {value.staleReason !== undefined && <p className={detail.exact}>{value.staleReason}</p>}
    {!known && <p role="status">{m('receiptUnknown')}</p>}
    <section className={detail.block}>
      <h3 className={detail.label}>{m('figures')}</h3>
      {known && value.figures.length > 0 ? value.figures.map(figure => <div className={detail.block} key={figure.key}>
        <p className={detail.exact}>{figure.label}</p><p className={detail.exact}>{figure.display}</p>
        <p className={detail.note}>{figure.unit === 'basis-points'
          ? hostMessage(language, 'exactPoints', { minor: figure.minor })
          : hostMessage(language, 'exactMoney', { minor: figure.minor, currency: figure.currency ?? value.currency })}</p>
      </div>) : <p>{words.unknown}</p>}
    </section>
    <section className={detail.block}>
      <h3 className={detail.label}>{m('scope')}</h3>
      {pairs([
        [m('receiptId'), value.id], [m('operation'), value.operation], [m('createdAt'), value.createdAt], [m('asOf'), value.asOf],
        [m('period'), range(value.period)], [m('comparePeriod'), range(value.comparePeriod)],
        [m('branch'), value.branch ?? words['not-applicable']], [m('currency'), value.currency],
        [m('requestedSources'), value.requestedSourceIds === undefined ? m('selectionAbsent') :
          value.requestedSourceIds.length === 0 ? m('selectionEmpty') : ids(value.requestedSourceIds)],
        [m('countedSources'), ids(value.sourceIds)],
      ])}
    </section>
    <section className={detail.block}>
      <h3 className={detail.label}>{m('coverage')}</h3>
      {pairs([
        [m('completeness'), value.coverage.completeness], [m('selectedRows'), String(value.coverage.selectedRows)],
        [m('countedRows'), String(value.coverage.countedRows)], [m('excludedRows'), String(value.coverage.excludedRows)],
        [m('unresolvedConflicts'), String(value.coverage.unresolvedConflicts)], [m('imports'), ids(value.coverage.importIds)],
      ])}
      <h4 className={detail.label}>{m('gaps')}</h4>
      {value.coverage.gaps.length > 0 ? <ul>{value.coverage.gaps.map((gap, index) => <li key={index}>{gap}</li>)}</ul> : <p>{m('none')}</p>}
    </section>
    <section className={detail.block}><h3 className={detail.label}>{m('explanation')}</h3><p className={detail.exact}>{value.explanation}</p></section>
    <section className={detail.block}>
      <h3 className={detail.label}>{m('hashes')}</h3>
      {pairs([[m('dictionaryHash'), value.dictionaryHash], [m('definitionHash'), value.definitionHash], [m('ontologyVersion'), String(value.ontologyVersion)]])}
    </section>
    <details><summary>{m('ledger')}</summary><pre className={detail.payload}>{JSON.stringify({ rowIds: value.rowIds, rows: value.rows, exclusions: value.exclusions }, null, 2)}</pre></details>
    <details><summary>{m('assumptions')}</summary><pre className={detail.payload}>{JSON.stringify(value.assumptions, null, 2)}</pre></details>
    <details><summary>{m('exactFields')}</summary>
      {!known && <p>{m('receiptUnknown')}</p>}
      <pre className={detail.payload}>{JSON.stringify(value, null, 2)}</pre>
    </details>
  </>;
}

function ReceiptPanel({ selection, language, origin, onClose }: {
  selection: HostReceiptSelection;
  language: Language;
  origin: HTMLElement | null;
  onClose: () => void;
}) {
  return <Sheet kind={hostMessage(language, 'receipt')} title={selection.id} origin={origin} onClose={onClose}>
    {selection.kind === 'ready' ? <ReceiptBody value={selection.value} language={language} /> :
      <p role="status">{hostMessage(language, selection.kind === 'loading' ? 'receiptLoading' : 'receiptFailed')}</p>}
    {selection.kind === 'failed' && <p>{hostMessage(language, 'code', { code: selection.code })}</p>}
  </Sheet>;
}

function ShortcutHelpBody({ language }: { language: Language }) {
  const shortcuts = [
    ['Ctrl K', 'helpAsk'], ['Ctrl 1–7', 'helpPlaces'], ['Esc', 'helpClose'],
    ['F6 / Shift F6', 'helpRegions'], ['Ctrl /', 'helpList'],
  ] as const;
  return <>
    <dl className={detail.pairs}>{shortcuts.map(([keys, description]) =>
      <div className={detail.pair} key={keys}><dt className={detail.name}>{keys}</dt>
        <dd className={detail.value}>{hostMessage(language, description)}</dd></div>)}</dl>
    <p>{hostMessage(language, 'helpSendGuard')}</p>
    <p>{hostMessage(language, 'helpUnavailable')}</p>
  </>;
}

/** The proof behind a what-if figure: the embedded receipt of the exact run in the fresh, confirmed reopen view.
 * Opened from a chosen row's detail sheet it replaces that sheet, and `back` leads back to the detail. */
function ScenarioProofPanel({ runId, scenario, language, origin, back, onClose }: {
  runId: string;
  scenario: RetainedScenarioState;
  language: Language;
  origin: HTMLElement | null;
  back: SheetProps['back'];
  onClose: () => void;
}) {
  const t = useT();
  const proof = scenario.kind === 'ready' ? scenarioProof(scenario.view, runId) : null;
  const pairs = (items: readonly (readonly [string, ReactNode])[]) => <dl className={detail.pairs}>
    {items.map(([name, content], index) => <div className={detail.pair} key={`${name}-${index}`}>
      <dt className={detail.name}>{name}</dt><dd className={[detail.value, 'fig'].join(' ')}>{content}</dd>
    </div>)}
  </dl>;
  return <Sheet kind={t('RETAINED.proof.kind')} title={proof === null ? t('RETAINED.proof.kind') : proof.result.receipt.id} origin={origin} back={back} onClose={onClose}>
    {proof === null ? <p role="status">{t('RETAINED.proof.unavailable')}</p> : <>
      <p className={detail.note}><Label kind="what-if" /> {t('RETAINED.proof.note')}</p>
      {pairs([
        [t('RETAINED.proof.branch'), proof.branch.label],
        [t('RETAINED.proof.assumption'), proof.branch.role === 'baseline'
          ? t('RETAINED.scenario.assumption', { bps: proof.branch.priceChangeBps })
          : t('RETAINED.scenario.assumptionChange', { before: proof.baseline.priceChangeBps, after: proof.branch.priceChangeBps })],
        [t('RETAINED.proof.jobLabel'), proof.job.label], [t('RETAINED.proof.job'), proof.job.id],
        [t('RETAINED.proof.run'), proof.result.runId], [t('RETAINED.proof.runDigest'), proof.result.runDigest],
        [t('RETAINED.proof.receiptDigest'), proof.result.receiptDigest], [t('RETAINED.proof.resultDigest'), proof.result.digest],
        [t('RETAINED.proof.revision'), proof.view.revision.id], [t('RETAINED.scenario.headRevision'), proof.view.headRevisionId],
        [t('RETAINED.proof.evidence'), proof.view.revision.evidenceId], [t('RETAINED.scenario.evidenceDigest'), proof.view.revision.evidenceDigest],
        ...(proof.state.reusedFromRevisionId === undefined ? [] : [[t('RETAINED.scenario.reusedFrom'), proof.state.reusedFromRevisionId] as const]),
      ])}
      <ReceiptBody value={proof.result.receipt} language={language} />
    </>}
  </Sheet>;
}

/** The exact provenance of the displayed, confirmed what-if view, in the one sheet; from a chosen row's detail it replaces that sheet with a way back. */
function ScenarioProvenancePanel({ scenario, origin, back, onClose }: { scenario: RetainedScenarioState; origin: HTMLElement | null; back: SheetProps['back']; onClose: () => void }) {
  const t = useT();
  const ready = scenario.kind === 'ready' ? scenario : null;
  return <Sheet kind={t('RETAINED.scenario.provenance')} title={ready === null ? t('RETAINED.scenario.title') : ready.view.revision.id} origin={origin} back={back} onClose={onClose}>
    {ready === null ? <p role="status">{t('RETAINED.proof.unavailable')}</p>
      : <><p className={detail.note}><Label kind="what-if" /> {t('RETAINED.scenario.identity', { scenario: ready.view.scenarioId, revision: ready.view.revision.id, createdAt: ready.view.revision.createdAt })}</p>
        <ScenarioProvenanceBody view={ready.view} historical={ready.historical} /></>}
  </Sheet>;
}

/**
 * The what-if chosen from the Saved ledger, in the one right sheet beside the stationary list: the exact checked
 * comparison, charts and figures `RetainedScenario` draws from its fresh reopen, under the row's label as written.
 * Every control is bound to the exact chosen pin, checked view, rows and window this panel was drawn for: Esc, Close and
 * Back to the list all name that origin, and Read again re-reads exactly that pin. Once the chosen row is no longer the
 * list's selection the panel says so and the host closes it; nothing newer is substituted into an old control.
 */
function ScenarioDetailPanel({ chosen, retained, origin, onClose, onRead, onProof, onProvenance }: {
  chosen: ScenarioSelection;
  retained: RetainedState;
  origin: HTMLElement | null;
  onClose: (binding: ScenarioDetailOrigin) => void;
  onRead: (binding: ScenarioDetailOrigin) => void;
  onProof: (runId: string, origin: HTMLElement | null, view: RetainedScenarioView) => void;
  onProvenance: (origin: HTMLElement | null, view: RetainedScenarioView) => void;
}) {
  const t = useT();
  const listed = retained.discovery, shown = retained.scenario;
  const list: ScenarioListOrigin | null = listed.kind === 'ready' ? { rows: listed.rows, page: listed.page } : null;
  const row = listed.kind === 'ready' ? discoveryRowFor(listed.rows, chosen) : undefined;
  const current = shown.kind !== 'idle' && sameScenarioSelection(shown.selection, chosen) && listed.kind === 'ready' && sameScenarioSelection(listed.selected, chosen);
  const bind = (named: RetainedScenarioShown): ScenarioDetailOrigin => ({ selection: named.selection, view: named.view, list });
  const closeBinding: ScenarioDetailOrigin = { selection: chosen, view: shown.kind === 'ready' ? shown.view : null, list };
  return <Sheet kind={t('RETAINED.scenario.title')} title={row?.label ?? t('RETAINED.scenario.title')} corner={<Label kind="what-if" />} origin={origin} onClose={() => onClose(closeBinding)}>
    {current ? <RetainedScenario state={shown} heading={false} onRead={named => onRead(bind(named))} onBack={named => onClose(bind(named))} onProof={onProof} onProvenance={onProvenance} />
      : <p role="status">{t('RETAINED.proof.unavailable')}</p>}
  </Sheet>;
}

/** The exact tuple a lesson sheet is bound to: a changed review, evaluation or candidate remounts it and clears any typed reason. */
function lessonTuple(view: LessonReviewView): string {
  return [view.candidate.id, view.candidate.digest, view.evaluation?.digest ?? '', view.review?.id ?? '', view.review?.digest ?? ''].join(':');
}

/** What a lesson control names: the exact rendered list, the exact selected candidate it was rendered beside
 * (null at rest) and, for a row of the at-rest page, the exact page it was drawn on. */
interface LessonOrigin { readonly list: readonly LessonReviewView[]; readonly from: string | null; readonly page?: number | undefined }
/** What a sheet's own close control names: the exact list and candidate view the sheet was rendered for. */
interface LessonSheetOrigin { readonly list: readonly LessonReviewView[]; readonly view: LessonReviewView | undefined }

/** One opened lesson, bound to the exact candidate id the row named, the current list and the authorized address and context.
 * Adjacent movement walks the complete released list in Engine order; every control names the list and
 * selection it was rendered for, so an obsolete control cannot replace a newer selection before React commits. */
function LessonPanel({ id, scope, lessons, context, origin, onClose, onAdjacent, onDecide }: {
  id: string;
  /** The authorized sheet address, context and route this sheet was opened under. */
  scope: string;
  lessons: LessonReviewState;
  context: UiContext;
  origin: HTMLElement | null;
  onClose: (id: string, origin: LessonSheetOrigin) => void;
  onAdjacent: (id: string, origin: LessonOrigin) => void;
  onDecide: (intent: LessonDecisionIntent, reason: string) => void;
}) {
  const t = useT();
  const list = lessons.kind === 'ready' || lessons.kind === 'deciding' ? lessons.lessons : [];
  const index = list.findIndex(item => item.candidate.id === id);
  const view = index >= 0 ? list[index] : undefined;
  const close = () => onClose(id, { list, view });
  if (view === undefined) {
    return <Sheet kind={t('RETAINED.lesson.sheet')} title={t('RETAINED.lesson.sheet')} origin={origin} onClose={close}>
      <p role="status">{t('RETAINED.lesson.sheetUnavailable')}</p>
    </Sheet>;
  }
  const adjacent = (delta: -1 | 1) => { const next = list[index + delta]; if (next !== undefined) onAdjacent(next.candidate.id, { list, from: view.candidate.id }); };
  return <LessonReviewSheet key={`${lessonTuple(view)}:${scope}`} view={view} availability={lessonDecisionAvailability(view, context)}
    deciding={lessons.kind === 'deciding'} position={{ index: String(index + 1), total: String(list.length) }} origin={origin}
    onClose={close} onAdjacent={adjacent} onDecide={onDecide} />;
}

/** One open sheet. `chosen` marks the what-if chain of a row chosen from the Saved ledger: its detail, or the proof or
 * provenance that replaced that detail; a trusted pin's proof or provenance, opened from the page, carries none. */
type LocalSheet = {
  readonly address: Address;
  readonly kind: 'about' | 'reference' | 'help' | 'what-if' | 'what-if-proof' | 'what-if-provenance' | 'lesson' | 'today-review' | 'today-record' | 'today-proof';
  readonly id?: string;
  readonly chosen?: ScenarioSelection;
  readonly todayView?: TodayConsumerState;
  readonly todayOrigin?: HTMLElement | SVGElement | null;
  readonly todayBack?: boolean;
};
const noTodaySubscribe = (_listener: () => void) => () => {};
const noTodaySnapshot = () => null;
const todayChain = (address: Address) => address.place === 'today' && (address.sheet === undefined || ['today-review', 'today-record', 'today-proof'].includes(address.sheet));
type SavedSelection = NonNullable<ConversationWorkspaceProps['readback']>;
const WHAT_IF_SHEET = 'what-if';
const PROOF_SHEET = 'what-if-proof';
const PROVENANCE_SHEET = 'what-if-provenance';
const LESSON_SHEET = 'lesson';
/** The what-if chain at Saved: the ledger at rest, the chosen row's detail sheet, and the proof or provenance sheet. */
const scenarioChain = (address: Address) => retainedSurface(address) === 'scenario'
  && (address.sheet === undefined || address.sheet === WHAT_IF_SHEET || address.sheet === PROOF_SHEET || address.sheet === PROVENANCE_SHEET);
const pinKey = (pin: ScenarioSelection) => JSON.stringify([pin.scenarioId, pin.revisionId]);

function AuthorizedWorkspace({ controller, state, context, language, view, setLanguage, setView, onLegacyReturn, scenarioSelection }: {
  controller: HostController;
  state: HostState;
  context: UiContext;
  language: Language;
  view: View;
  setLanguage: (language: Language) => void;
  setView: (view: View) => void;
  onLegacyReturn: () => void;
  scenarioSelection: ScenarioSelection | null;
}) {
  const t = useT();
  const contextKey = JSON.stringify([context.contextKey, state.selectedRouteId]);
  const retained = useSyncExternalStore(controller.retained.subscribe, controller.retained.snapshot, controller.retained.snapshot);
  const consumer = controller.todayConsumer;
  const todayCurrent = useSyncExternalStore(consumer?.subscribe ?? noTodaySubscribe, consumer?.snapshot ?? noTodaySnapshot, consumer?.snapshot ?? noTodaySnapshot);
  const todayOperation = useRef(Symbol());
  const todayPending = useRef<{ readonly prior: LocalSheet | null; readonly view: TodayConsumerState; readonly token: symbol } | null>(null);
  const active = useRef<Address | null>(TODAY);
  const origin = useRef<HTMLElement | null>(null);
  const helpFallback = useRef<HTMLElement | null>(null);
  const returnSavedId = useRef<string | null>(null);
  const selectionCounter = useRef(0);
  const [readback, setReadback] = useState<SavedSelection | undefined>(undefined);
  /** The selected saved answer as of this instant, before React commits: the synchronous owner every answer control is checked against. */
  const readbackRef = useRef<SavedSelection | undefined>(undefined);
  const [localSheet, setLocalSheet] = useState<LocalSheet | null>(null);
  const localSheetRef = useRef(localSheet);
  localSheetRef.current = localSheet;
  const viewer = context.member.role === 'viewer';
  const selectedRoute = state.routes.find(route => route.id === state.selectedRouteId && route.enabled);
  const settings = controller.questionSettings();
  const conversationEnabled = !viewer && selectedRoute !== undefined && settings !== null && settings.routeId === selectedRoute.id;
  const projection = useMemo(() => {
    if (state.today === null) return { kind: 'missing' } as const;
    try { return { kind: 'ready', value: projectTodayHostForUi(state.today, { language, timeZone: controller.timeZone, missingWords: hostMissingWords(language) }) } as const; }
    catch { return { kind: 'invalid' } as const; }
  }, [state.today, language, controller.timeZone]);
  useLayoutEffect(() => { if (projection.kind === 'invalid') controller.invalidate('INVALID_REPLY'); }, [projection.kind, controller]);
  const onAddress = useCallback((address: Address | null) => {
    const previous = active.current;
    active.current = address;
    const receipt = controller.snapshot().receipt;
    if (receipt !== null && (address === null || !sameAddress(receipt.address, address))) controller.closeReceipt();
    const current = localSheetRef.current;
    if (current !== null && (address === null || !sameAddress(current.address, address))) {
      // Leaving a lesson sheet's exact address drops its selection: captured controls go inert.
      if (current.kind === LESSON_SHEET) controller.retained.selectLesson(null);
      if (current.todayView !== undefined) { todayOperation.current = Symbol(); localSheetRef.current = null; controller.todayConsumer?.cancelSelection(); }
      setLocalSheet(null);
    }
    // Retained lifecycle: leaving a place or sub-place clears its private view so a return needs a
    // fresh authorized read; any sheet change at the same place fences every pending operation. Movement
    // within Saved's own what-if chain (the ledger, the chosen row's detail, its proof or provenance) is
    // not such a boundary: every step of it is an intent that fences or binds its own operation, and the
    // chosen row's reopen in flight is exactly the operation that movement shows.
    if (previous === null || address === null || !samePlace(previous, address)) controller.retained.invalidate();
    else if (!sameAddress(previous, address) && !(scenarioChain(previous) && scenarioChain(address))) controller.retained.cancelPending();
    if (previous !== null && (address === null || !sameAddress(previous, address)) && !(address !== null && todayChain(previous) && todayChain(address))) {
      todayOperation.current = Symbol(); controller.todayConsumer?.cancelSelection();
    }
    if (address !== null && todayChain(address) && address.sheet === undefined && previous !== null && !todayChain(previous)) {
      void controller.todayConsumer?.refresh(() => sameAddress(parseAddress(window.location.hash), address));
    }
    // A retained sheet address that no open sheet owns (after a remount or a pasted hash) is reduced to its
    // surface at rest: the sheet opens only from a live press, never from the address alone.
    const owned = current !== null && address !== null && sameAddress(current.address, address);
    if (address !== null && !owned && (address.sheet === WHAT_IF_SHEET || address.sheet === PROOF_SHEET || address.sheet === PROVENANCE_SHEET || address.sheet === LESSON_SHEET || address.sheet?.startsWith('today-'))) navigate(withoutSheet(address));
  }, [controller]);
  const stillAuthorized = () => {
    const current = controller.snapshot();
    return current.phase === 'ready' && current.context?.contextKey === context.contextKey && current.selectedRouteId === state.selectedRouteId;
  };
  /** Whether a control rendered for `address` may still act: the trusted context is unchanged and the
   * hash, which every route change, Help and sheet opening sets synchronously, still names that address. */
  const live = useCallback((address: Address) => {
    const current = controller.snapshot();
    return current.phase === 'ready' && current.context?.contextKey === context.contextKey && current.selectedRouteId === state.selectedRouteId
      && sameAddress(parseAddress(window.location.hash), address);
  }, [controller, context.contextKey, state.selectedRouteId]);
  /** Bind the rendered consumer view and current sheet before any asynchronous read. */
  const launchToday = (from: TodayConsumerState, kind: 'today-review' | 'today-record' | 'today-proof', rowOrigin: HTMLElement | SVGElement | null,
    read: (current: () => boolean) => Promise<boolean | TodayDetail | null>) => {
    if (consumer === null || consumer.snapshot() !== from) return;
    const address = parseAddress(window.location.hash), prior = localSheetRef.current;
    if (!todayChain(address) || !live(address) || address.sheet !== undefined && (prior?.todayView !== from || !sameAddress(prior.address, address))) return;
    const token = Symbol(); todayOperation.current = token;
    const current = () => todayOperation.current === token && live(address) && localSheetRef.current === prior;
    const operation = read(current), pendingView = consumer.snapshot();
    todayPending.current = pendingView === from ? null : { prior, view: pendingView, token };
    void operation.then(accepted => {
      if (todayPending.current?.token === token) todayPending.current = null;
      if (!accepted || !current()) return;
      const shown = consumer.snapshot();
      if (kind === 'today-review' ? shown.page === null : shown.detail === null) return;
      const rootOrigin = prior?.todayOrigin ?? rowOrigin;
      origin.current = rootOrigin instanceof HTMLElement ? rootOrigin : null;
      const selection: LocalSheet = { address: withSheet(address, kind), kind, todayView: shown, todayOrigin: rootOrigin, todayBack: kind === 'today-proof' && from.detail !== null };
      localSheetRef.current = selection; setLocalSheet(selection); navigate(selection.address);
    });
  };
  const closeToday = (from: LocalSheet, rendered: TodayConsumerState | null) => {
    if (localSheetRef.current !== from || from.todayView === undefined || consumer === null || !live(from.address)) return;
    const pending = todayPending.current, shown = consumer.snapshot();
    if (rendered !== shown) return;
    if (shown !== from.todayView && !(pending?.prior === from && pending.token === todayOperation.current && pending.view === shown)) return;
    todayPending.current = null;
    todayOperation.current = Symbol(); consumer.cancelSelection();
    localSheetRef.current = null; setLocalSheet(null); navigate(withoutSheet(from.address));
    if (from.todayOrigin?.isConnected) from.todayOrigin.focus();
  };
  const backToday = (from: LocalSheet) => {
    if (localSheetRef.current !== from || from.todayView === undefined || consumer?.snapshot() !== from.todayView || !live(from.address)) return;
    const accepted = consumer.back(from.todayView); if (accepted === null) return;
    todayOperation.current = Symbol();
    const selection: LocalSheet = { ...from, address: withSheet(from.address, 'today-record'), kind: 'today-record', todayView: consumer.snapshot() };
    localSheetRef.current = selection; setLocalSheet(selection); navigate(selection.address);
  };
  useEffect(() => {
    const current = localSheetRef.current;
    if (todayCurrent?.phase !== 'failed' || current?.todayView === undefined) return;
    todayOperation.current = Symbol(); localSheetRef.current = null; setLocalSheet(null);
    if (sameAddress(parseAddress(window.location.hash), current.address)) navigate(withoutSheet(current.address));
  }, [todayCurrent]);
  const dropLessonSelection = () => { if (localSheetRef.current?.kind === LESSON_SHEET) controller.retained.selectLesson(null); };
  /** A sheet that replaces the chosen row's what-if chain (Help, About, a reference or a receipt) drops the chosen view, from
   * exactly what is shown now: returning to Saved is the ledger at rest, and nothing revives the earlier choice. */
  const dropChosenScenario = () => {
    const current = localSheetRef.current;
    if (current?.chosen === undefined) return;
    const shown = controller.retained.snapshot();
    if (shown.scenario.kind === 'idle' || shown.discovery.kind !== 'ready') return;
    controller.retained.closeScenario({ selection: current.chosen, view: shown.scenario.kind === 'ready' ? shown.scenario.view : null, list: { rows: shown.discovery.rows, page: shown.discovery.page } });
  };
  // A lesson sheet stays open only while its exact candidate is the controller's selection. The hash
  // is reduced to the surface only while it still names this sheet: a departure already under way
  // (an actual hash change React has not yet committed) is never pulled back.
  const lessonSelection = retained.lessons.kind === 'ready' || retained.lessons.kind === 'deciding' ? retained.lessons.selectedId : null;
  useEffect(() => {
    const current = localSheetRef.current;
    if (current?.kind !== LESSON_SHEET || current.id === lessonSelection) return;
    localSheetRef.current = null; setLocalSheet(null);
    if (sameAddress(parseAddress(window.location.hash), current.address)) navigate(withoutSheet(current.address));
  }, [lessonSelection]);
  const selectSaved = (id: string) => {
    if (!stillAuthorized() || !conversationEnabled) return;
    // Consume the previous answer before its still-connected controls can act at this same Saved address.
    controller.conversation.cancel();
    const address: Address = { place: 'ask', sub: 'saved' };
    selectionCounter.current += 1;
    const selection: SavedSelection = { id, address, selectionKey: String(selectionCounter.current) };
    readbackRef.current = selection; setReadback(selection);
    navigate(address);
  };
  const closeSheet = () => {
    const returnFocus = localSheetRef.current?.kind === 'help'
      ? origin.current?.isConnected ? origin.current : helpFallback.current : null;
    // Closing is a lifecycle boundary: a held decision preflight or confirming read can neither dispatch nor publish.
    dropLessonSelection(); controller.retained.cancelPending();
    controller.closeReceipt(); localSheetRef.current = null; setLocalSheet(null);
    if (returnFocus?.isConnected) returnFocus.focus();
    const savedId = returnSavedId.current; returnSavedId.current = null;
    if (savedId !== null && stillAuthorized()) selectSaved(savedId);
    else if (active.current !== null) navigate(withoutSheet(active.current));
  };
  const openReceipt = (id: string, savedId: string | null = null) => {
    if (!stillAuthorized() || active.current === null) return;
    origin.current = currentOrigin(); returnSavedId.current = savedId; dropLessonSelection(); dropChosenScenario(); controller.retained.cancelPending(); setLocalSheet(null);
    const address = withSheet(active.current, 'receipt');
    navigate(address); void controller.openReceipt(id, address);
  };
  /**
   * A what-if sheet (the proof of a figure, or the exact provenance) opens only after a fresh
   * `scenarios.reopen` of the same pin still equals the displayed checked view, and only if the
   * address it was pressed at is still live and no other sheet opened meanwhile. It opens from the
   * page at rest, where the trusted pin is shown alone, or from the chosen row's own detail sheet,
   * which it then replaces in the same one sheet with a way back; sheets never nest. The press names
   * the exact checked view its control was rendered for: a newer view published at the same address
   * before React commits is refused, never substituted into the old press. A changed view refuses
   * the old press and clears the stale figures. The proof is the embedded receipt of the exact run;
   * it never reads `receipts.get`.
   */
  const openScenarioSheet = (kind: typeof PROOF_SHEET | typeof PROVENANCE_SHEET, runId: string | undefined, suppliedOrigin: HTMLElement | null, rendered: RetainedScenarioView) => {
    const address = active.current;
    if (address === null || retainedSurface(address) !== 'scenario' || !live(address)) return;
    const current = localSheetRef.current;
    // The chosen pin of the detail sheet this press came from, read once from the open sheet: null from the page at rest.
    const detailChosen: ScenarioSelection | null = current !== null && address.sheet === WHAT_IF_SHEET && current.kind === WHAT_IF_SHEET && current.chosen !== undefined && sameAddress(current.address, address) ? current.chosen : null;
    const fromDetail = detailChosen === null ? null : current;
    if (address.sheet !== undefined && fromDetail === null) return;
    const shown = controller.retained.snapshot().scenario;
    if (shown.kind !== 'ready' || shown.checking || shown.view !== rendered || (runId !== undefined && scenarioProof(shown.view, runId) === null)) return;
    if (detailChosen !== null && !sameScenarioSelection(shown.selection, detailChosen)) return;
    const opener = suppliedOrigin ?? currentOrigin();
    void controller.retained.confirmScenario(shown.selection, shown.view, () => live(address)).then(result => {
      if (!result.ok || localSheetRef.current !== fromDetail || controller.snapshot().receipt !== null || !live(address)) return;
      const latest = controller.retained.snapshot().scenario;
      if (latest.kind !== 'ready' || latest.checking || latest.view !== shown.view || (runId !== undefined && scenarioProof(latest.view, runId) === null)) return;
      // From the page, focus returns to the figure control that opened the proof; from the detail sheet it keeps
      // returning to the accepted row the whole chain was opened from.
      if (fromDetail === null) origin.current = opener?.isConnected ? opener : currentOrigin();
      returnSavedId.current = null; dropLessonSelection();
      const sheetAddress = withSheet(address, kind);
      const selection: LocalSheet = { address: sheetAddress, kind, ...(runId === undefined ? {} : { id: runId }), ...(detailChosen === null ? {} : { chosen: detailChosen }) };
      localSheetRef.current = selection; setLocalSheet(selection); navigate(sheetAddress);
    });
  };
  const openProof = (runId: string, suppliedOrigin: HTMLElement | null, rendered: RetainedScenarioView) => openScenarioSheet(PROOF_SHEET, runId, suppliedOrigin, rendered);
  const openProvenance = (suppliedOrigin: HTMLElement | null, rendered: RetainedScenarioView) => openScenarioSheet(PROVENANCE_SHEET, undefined, suppliedOrigin, rendered);
  /**
   * An explicit human transition to the released what-ifs, or to one of them, leaves any saved-answer readback.
   * The control that asks for it names the selection it was drawn beside: a control from the selected answer names
   * that exact readback, a ledger control names none. A control whose selection is no longer current is inert and
   * clears nothing. For an accepted transition the answer operation and its selection, reference and receipt-return
   * ownership are consumed synchronously, through the conversation host's own generation fence, before any await:
   * a held answer success or refusal publishes nothing, and a still-connected answer control cannot re-establish
   * the answer's return. A default Saved render never does this: while a readback is selected at rest, Saved is the
   * answer, and no discovery is issued behind it.
   */
  const leaveReadback = (named: SavedReadbackOrigin | undefined): boolean => {
    const current = readbackRef.current;
    if (named === undefined ? current !== undefined : current === undefined || current.id !== named.id || current.selectionKey !== named.selectionKey) return false;
    if (current !== undefined) { readbackRef.current = undefined; controller.conversation.cancel(); setReadback(undefined); }
    returnSavedId.current = null;
    return true;
  };
  /** The bare Saved address a what-if control may act for: live at rest, or within the what-if chain this host owns; null when left. */
  const savedBase = (): Address | null => {
    const address = active.current;
    if (address === null || !scenarioChain(address) || !live(address)) return null;
    if (address.sheet !== undefined && (localSheetRef.current === null || !sameAddress(localSheetRef.current.address, address))) return null;
    return withoutSheet(address);
  };
  /**
   * Whether a what-if list operation started for `base` may still act: the trusted context is unchanged and the actual
   * hash, read synchronously at every awaited boundary and at the raw transport boundary, still names Saved at rest or
   * within its what-if chain. A departure to any other address or sheet drops the operation before it dispatches.
   */
  const liveChain = (base: Address) => stillAuthorized() && scenarioChain(parseAddress(window.location.hash)) && samePlace(parseAddress(window.location.hash), base);
  /**
   * One human choice of a released what-if row: both exact identities of the exact checked row, bound to the
   * rows, window and selection it was drawn beside, enter a fresh `scenarios.reopen` through the controller,
   * which refuses a replaced list, a moved window or a newer selection React has not yet committed. Only an
   * accepted choice captures the pressed row as the origin focus returns to, and opens the detail sheet beside
   * the stationary list (replacing an earlier what-if sheet); a refused press changes nothing at all.
   */
  const openScenarioRow = (selection: ScenarioSelection, rowOrigin: HTMLElement, binding: ScenarioRowOrigin): boolean => {
    const base = savedBase();
    if (base === null || !leaveReadback(undefined)) return false;
    const before = controller.retained.snapshot().discovery;
    void controller.retained.openDiscovered(selection, binding, () => liveChain(base));
    const after = controller.retained.snapshot().discovery;
    if (after === before || after.kind !== 'ready' || !sameScenarioSelection(after.selected, selection)) return false;
    origin.current = rowOrigin; returnSavedId.current = null; dropLessonSelection(); controller.closeReceipt();
    const detail: LocalSheet = { address: withSheet(base, WHAT_IF_SHEET), kind: WHAT_IF_SHEET, chosen: selection };
    localSheetRef.current = detail; setLocalSheet(detail);
    if (!sameAddress(parseAddress(window.location.hash), detail.address)) navigate(detail.address);
    return true;
  };
  /** An explicit fresh first page of the released what-ifs at the live Saved address; the cursor is omitted. Returns whether
   * the transition was accepted, so the control's own surface can consume its captured answer controls synchronously. */
  const showSavedOverview = (named?: SavedReadbackOrigin): boolean => {
    const base = savedBase();
    if (base === null || !leaveReadback(named)) return false;
    void controller.retained.readDiscovery(() => liveChain(base));
    return true;
  };
  /** The next page from the exact rows, cursor, window and selection the control was drawn beside; the controller refuses an obsolete one. */
  const continueScenarios = (continuation: ScenarioContinuation) => {
    const base = savedBase();
    if (base === null || !leaveReadback(undefined)) return;
    void controller.retained.continueDiscovery(continuation, () => liveChain(base));
  };
  /** Moves the at-rest window from the exact rows, window and selection the control was drawn beside; a chosen row of the window left behind is superseded. */
  const pageScenarios = (rows: readonly ScenarioDiscoveryRow[], from: number, page: number, selection: ScenarioSelection | null) => {
    const base = savedBase();
    if (base === null || !leaveReadback(undefined)) return;
    controller.retained.pageDiscovery(rows, from, page, selection);
  };
  /** Read again from the chosen row's detail sheet: exactly the pin, view, rows and window the control named, at its live sheet address. */
  const readChosenAgain = (from: LocalSheet, binding: ScenarioDetailOrigin) => {
    const current = localSheetRef.current;
    if (current !== from || current.chosen === undefined || !live(current.address)) return;
    void controller.retained.readScenarioAgain(binding, () => live(current.address));
  };
  /**
   * Esc, Close or Back to the list on a sheet of the chosen row's chain: it acts only while that exact sheet is still the
   * open one at its live address, for exactly the pin, view, rows and window it named. An old control pressed after an
   * actual hash departure, or after a newer choice at the same address, changes nothing, dispatches nothing and moves no
   * focus; an accepted close drops the chosen view and returns focus to the accepted row.
   */
  const closeChosen = (from: LocalSheet, binding: ScenarioDetailOrigin) => {
    const current = localSheetRef.current;
    if (current !== from || current.chosen === undefined || !live(current.address)) return;
    if (!controller.retained.closeScenario(binding).ok) return;
    closeSheet();
  };
  /** Back from the proof or provenance that replaced the chosen row's detail to that detail, while the row is still chosen. */
  const returnToDetail = (from: LocalSheet) => {
    const current = localSheetRef.current;
    if (current !== from || current.chosen === undefined || !live(current.address)) return;
    const shown = controller.retained.snapshot();
    if (shown.scenario.kind === 'idle' || shown.discovery.kind !== 'ready' || !sameScenarioSelection(shown.discovery.selected, current.chosen)) return;
    const detail: LocalSheet = { address: withSheet(current.address, WHAT_IF_SHEET), kind: WHAT_IF_SHEET, chosen: current.chosen };
    localSheetRef.current = detail; setLocalSheet(detail); navigate(detail.address);
  };
  // The chosen row's sheet chain stays open only while that exact row is still the list's choice with a view behind it.
  // A refusal, a moved window, a fresh list, a lock or a departure drops the choice and the sheet goes with it; the hash is
  // reduced to the ledger only while it still names the sheet, so a departure already under way is never pulled back.
  const chosenKey = retained.discovery.kind === 'ready' && retained.discovery.selected !== null && retained.scenario.kind !== 'idle' ? pinKey(retained.discovery.selected) : null;
  useEffect(() => {
    const current = localSheetRef.current;
    if (current?.chosen === undefined || pinKey(current.chosen) === chosenKey) return;
    localSheetRef.current = null; setLocalSheet(null);
    if (sameAddress(parseAddress(window.location.hash), current.address)) navigate(withoutSheet(current.address));
  }, [chosenKey]);
  /** The candidate whose lesson sheet is open right now, before React commits anything newer; null at rest. */
  const openLessonId = () => (localSheetRef.current?.kind === LESSON_SHEET ? localSheetRef.current.id ?? null : null);
  /**
   * Opens one released lesson at this live lessons address. The control names the exact list it was
   * rendered for (a row of the at-rest page, or an adjacent control of the open sheet), the exact
   * selection it was rendered beside (null at rest, the open candidate beside a sheet) and, for a row,
   * the exact page it was drawn on; a replaced list, a moved window or a newer selection that React
   * has not yet committed leaves the old control inert. A fresh row beside an open sheet still switches
   * to another lesson. Every released row is reachable.
   */
  const openLesson = (id: string, suppliedOrigin: HTMLElement | null, binding: LessonOrigin) => {
    const address = active.current;
    if (address === null || !live(address)) return;
    const base = withoutSheet(address);
    if (retainedSurface(base) !== 'lessons' || (address.sheet !== undefined && address.sheet !== LESSON_SHEET)) return;
    const lessons = controller.retained.snapshot().lessons;
    if (lessons.kind !== 'ready' || lessons.lessons !== binding.list || !lessons.lessons.some(item => item.candidate.id === id)) return;
    // The rendered origin must still be the current selection and the open sheet: null only at rest, a candidate only while its sheet is open.
    if (lessons.selectedId !== binding.from || openLessonId() !== binding.from) return;
    if (binding.page !== undefined && lessons.page !== binding.page) return;
    origin.current = suppliedOrigin ?? currentOrigin(); returnSavedId.current = null; controller.closeReceipt();
    controller.retained.selectLesson(id);
    const sheetAddress = withSheet(base, LESSON_SHEET);
    const selection: LocalSheet = { address: sheetAddress, kind: LESSON_SHEET, id };
    localSheetRef.current = selection; setLocalSheet(selection); navigate(sheetAddress);
  };
  /**
   * A sheet's own close control acts only while that exact candidate is still the open sheet at its live
   * authorized address, for the exact list and candidate view it was rendered with. After an actual hash
   * departure it is inert, so an old close can never pull the user back; after a replaced list, or a
   * same-id replacement of the reviewed tuple, it cannot close the newer sheet.
   */
  const closeLesson = (id: string, binding: LessonSheetOrigin) => {
    const current = localSheetRef.current;
    if (current?.kind !== LESSON_SHEET || current.id !== id || !live(current.address)) return;
    const lessons = controller.retained.snapshot().lessons;
    const shown = lessons.kind === 'ready' || lessons.kind === 'deciding' ? lessons : null;
    if (shown === null ? binding.view !== undefined
      : shown.lessons !== binding.list || shown.selectedId !== id || shown.lessons.find(item => item.candidate.id === id) !== binding.view) return;
    closeSheet();
  };
  const decideLesson = (intent: LessonDecisionIntent, reason: string) => {
    const current = localSheetRef.current;
    // The press must come from the open lesson sheet at its live authorized address for the still-selected candidate.
    if (current?.kind !== LESSON_SHEET || current.id !== intent.candidate.id || !live(current.address)) return;
    const lessons = controller.retained.snapshot().lessons;
    if (lessons.kind !== 'ready' || lessons.selectedId !== intent.candidate.id) return;
    // The same sheet address must still be the live one at every awaited boundary: an actual departure
    // read from the hash before React commits it stops the held preflight from dispatching.
    void controller.retained.decideLesson(intent, reason, () => live(current.address) && localSheetRef.current?.kind === LESSON_SHEET && localSheetRef.current.id === intent.candidate.id);
  };
  const showReference = (id: string, savedId: string | null = null) => {
    if (!stillAuthorized() || active.current === null) return;
    origin.current = currentOrigin(); returnSavedId.current = savedId; dropLessonSelection(); dropChosenScenario(); controller.retained.cancelPending(); controller.closeReceipt();
    const address = withSheet(active.current, 'reference');
    setLocalSheet({ address, kind: 'reference', id }); navigate(address);
  };
  const onReference = (intent: ConversationReferenceIntent, saved: ConversationSavedAnswer) => {
    // An answer control acts only at the actual live address it was drawn for: the hash, which selecting a saved answer
    // and every sheet opening set synchronously, must still name the committed address, so a control of the answer just
    // left (before React commits) neither navigates, nor opens a receipt, nor changes the return owner. On Saved the
    // control also names the selected saved answer it was drawn in, read from the synchronous owner, so once an explicit
    // transition has left or replaced that readback the still-connected control is inert. On Ask, New the answer is the
    // conversation itself, as before.
    const address = active.current;
    if (address === null || !live(address)) return;
    const current = readbackRef.current;
    if (retainedSurface(address) === 'scenario'
      && (current === undefined || !(current.id === saved.id || (saved.kind === 'clarification' && saved.answer.modelReceiptId === current.id)))) return;
    if (intent.kind === 'calculation-receipt') openReceipt(intent.id, saved.id);
    else if (intent.kind === 'answer') selectSaved(intent.id);
    else showReference(intent.kind === 'synthesis-receipt' ? intent.receipt.id : intent.id, saved.id);
  };
  const chooseRoute = (id: string | null) => {
    if (!stillAuthorized()) return;
    controller.selectRoute(id); navigate(id === null ? TODAY : ASK);
  };
  const showAbout = () => {
    if (!stillAuthorized() || active.current === null) return;
    origin.current = currentOrigin(); returnSavedId.current = null; dropLessonSelection(); dropChosenScenario(); controller.retained.cancelPending(); controller.closeReceipt();
    const address = withSheet(active.current, 'about'); setLocalSheet({ address, kind: 'about' }); navigate(address);
  };
  const showHelp = (suppliedOrigin?: HTMLElement | null, fallback?: HTMLElement | null) => {
    if (!stillAuthorized() || active.current === null) return;
    if (localSheetRef.current?.kind === 'help') return;
    const focused = suppliedOrigin === undefined ? currentOrigin() : suppliedOrigin;
    const opener = focused?.closest('[data-region="sheet"]') ? origin.current : focused;
    helpFallback.current = fallback?.isConnected ? fallback : null;
    origin.current = opener?.isConnected ? opener : fallback?.isConnected ? fallback : null;
    // Help is a lifecycle boundary: pending retained operations are fenced before the hash changes.
    returnSavedId.current = null; dropLessonSelection(); dropChosenScenario(); controller.retained.cancelPending(); controller.closeReceipt();
    const address = withSheet(active.current, 'help');
    const selection: LocalSheet = { address, kind: 'help' };
    localSheetRef.current = selection; setLocalSheet(selection); navigate(address);
  };
  if (projection.kind === 'invalid') return <State state={{ kind: 'failed', code: 'INVALID_REPLY' }} />;
  const words = hostMissingWords(language);
  const data: TodayData = todayCurrent !== null && consumer !== null ? projectTodayConsumer(todayCurrent, consumer.input, language) : projection.kind === 'ready' ? projection.value.data : {
    state: { kind: 'loading' }, date: '', review: { count: { exact: null, display: words['not-loaded-yet'] }, rows: [] },
    thisMonthMissing: 'not-loaded-yet', earlierTodayMissing: 'unknown',
  };
  const legacyLink = <Button variant="link" onClick={onLegacyReturn}>{hostMessage(language, 'legacy')}</Button>;
  /** For a proof or provenance that replaced the chosen row's detail: the way back to that detail, and a close bound to the chosen chain. */
  const chainBack = (current: LocalSheet): SheetProps['back'] => current.chosen === undefined ? undefined : { label: t('RETAINED.scenario.title'), onBack: () => returnToDetail(current) };
  const chainClose = (current: LocalSheet) => {
    const chosen = current.chosen;
    if (chosen === undefined) return closeSheet;
    return () => closeChosen(current, {
      selection: chosen, view: retained.scenario.kind === 'ready' ? retained.scenario.view : null,
      list: retained.discovery.kind === 'ready' ? { rows: retained.discovery.rows, page: retained.discovery.page } : null,
    });
  };
  const sheet: AppProps['sheet'] = state.receipt !== null ? {
    address: state.receipt.address,
    content: <ReceiptPanel key={state.receipt.id} selection={state.receipt} language={language} origin={origin.current} onClose={closeSheet} />,
  } : localSheet === null ? undefined : localSheet.todayView !== undefined && consumer !== null ? {
    address: localSheet.address,
    content: <TodayDestination detail={localSheet.todayView.detail} page={localSheet.todayView.page} origin={localSheet.todayOrigin ?? null}
      onClose={() => closeToday(localSheet, todayCurrent)}
      onReview={(row, rowOrigin) => launchToday(localSheet.todayView!, 'today-record', rowOrigin, current => consumer.review(localSheet.todayView!, row, current))}
      onNext={localSheet.todayView.page?.nextCursor ? () => launchToday(localSheet.todayView!, 'today-review', localSheet.todayOrigin ?? null, current => consumer.page(localSheet.todayView!, true, current)) : undefined}
      onFresh={() => launchToday(localSheet.todayView!, 'today-review', localSheet.todayOrigin ?? null, current => consumer.page(localSheet.todayView!, false, current))}
      onReceipt={(id, proofOrigin) => launchToday(localSheet.todayView!, 'today-proof', proofOrigin, current => consumer.receipt(localSheet.todayView!, id, current))}
      back={localSheet.kind === 'today-proof' && localSheet.todayBack === true ? { label: t('TODAY_ENGINE.detail'), onBack: () => backToday(localSheet) } : undefined} />,
  } : localSheet.kind === WHAT_IF_SHEET && localSheet.chosen !== undefined ? {
    address: localSheet.address,
    content: <ScenarioDetailPanel key={pinKey(localSheet.chosen)} chosen={localSheet.chosen} retained={retained} origin={origin.current}
      onClose={binding => closeChosen(localSheet, binding)} onRead={binding => readChosenAgain(localSheet, binding)} onProof={openProof} onProvenance={openProvenance} />,
  } : localSheet.kind === PROOF_SHEET && localSheet.id !== undefined ? {
    address: localSheet.address,
    content: <ScenarioProofPanel key={localSheet.id} runId={localSheet.id} scenario={retained.scenario} language={language} origin={origin.current}
      back={chainBack(localSheet)} onClose={chainClose(localSheet)} />,
  } : localSheet.kind === PROVENANCE_SHEET ? {
    address: localSheet.address,
    content: <ScenarioProvenancePanel scenario={retained.scenario} origin={origin.current} back={chainBack(localSheet)} onClose={chainClose(localSheet)} />,
  } : localSheet.kind === LESSON_SHEET && localSheet.id !== undefined ? {
    address: localSheet.address,
    content: <LessonPanel key={localSheet.id} id={localSheet.id} scope={`${formatAddress(localSheet.address)}:${contextKey}`} lessons={retained.lessons} context={context}
      origin={origin.current} onClose={closeLesson} onAdjacent={(id, binding) => openLesson(id, origin.current, binding)} onDecide={decideLesson} />,
  } : {
    address: localSheet.address,
    content: <Sheet kind={hostMessage(language, localSheet.kind === 'help' ? 'helpTitle' : localSheet.kind === 'about' ? 'aboutTitle' : 'reference')}
      title={hostMessage(language, localSheet.kind === 'help' ? 'helpTitle' : localSheet.kind === 'about' ? 'aboutTitle' : 'reference')} origin={origin.current} onClose={closeSheet}>
      {localSheet.kind === 'help' ? <ShortcutHelpBody language={language} />
        : <p>{hostMessage(language, localSheet.kind === 'about' ? 'about' : 'referenceUnavailable')}</p>}
      {localSheet.id !== undefined && <p className={detail.exact}>{hostMessage(language, 'referenceIdentity', { id: localSheet.id })}</p>}
      <Button variant="link" onClick={onLegacyReturn}>{hostMessage(language, 'legacy')}</Button>
    </Sheet>,
  };
  const app: AppProps = {
    shellKind: 'desktop', view, language,
    menu: {
      workspace: { name: context.workspace.name, demo: context.workspace.demo,
        who: hostMessage(language, 'memberRole', { name: context.member.name, role: hostMessage(language, ROLE_KEY[context.member.role]) }) },
      onSetView: setView, onSetLanguage: setLanguage, onLock: () => { void controller.lock(); }, onAbout: showAbout,
    },
    ask: { onAsk: () => navigate(ASK), noModel: !conversationEnabled,
      ...(viewer ? { readOnly: { holder: hostMessage(language, 'roleViewer') } } : {}) },
    status: {
      sources: { text: hostMessage(language, projection.kind === 'ready' ? 'sourcesReady' : 'sourcesMissing'), address: { place: 'books', sub: 'sources' } },
      model: { text: selectedRoute === undefined ? hostMessage(language, 'routeMissing') : hostMessage(language, 'routeSelected', { label: selectedRoute.label }), address: MODELS },
      third: { text: hostMessage(language, 'third') },
    },
    statusSimple: [
      hostMessage(language, projection.kind === 'ready' ? 'sourcesReady' : 'sourcesMissing'),
      selectedRoute === undefined ? hostMessage(language, 'routeMissing') : hostMessage(language, 'routeSelected', { label: selectedRoute.label }),
    ],
    capabilities: {},
    today: { data, intents: consumer !== null && todayCurrent !== null ? {
      onReview: (id, rowOrigin) => {
        const rows = todayCurrent.response?.review.state === 'available' ? todayCurrent.response.review.value.rows : [];
        const row = rows[Number(id.replace(/^review-/, ''))];
        if (row) launchToday(todayCurrent, 'today-record', rowOrigin, current => consumer.review(todayCurrent, row, current));
      },
      onOpenRow: (id, rowOrigin) => launchToday(todayCurrent, 'today-record', rowOrigin, current => consumer.attention(todayCurrent, id, current)),
      onReceipt: (id, receiptOrigin) => launchToday(todayCurrent, 'today-proof', receiptOrigin ?? (document.activeElement instanceof HTMLElement || document.activeElement instanceof SVGElement ? document.activeElement : null), current => consumer.receipt(todayCurrent, id, current)),
      onOpenTile: (id, tileOrigin) => launchToday(todayCurrent, 'today-record', tileOrigin, current => consumer.tile(todayCurrent, id, current)),
      onOpenEvent: (id, rowOrigin) => launchToday(todayCurrent, 'today-record', rowOrigin, current => consumer.event(todayCurrent, id, current)),
      onSeeAll: () => launchToday(todayCurrent, 'today-review', document.activeElement instanceof HTMLElement ? document.activeElement : null, current => consumer.page(todayCurrent, false, current)),
      ...(viewer ? {} : todayCurrent.phase === 'ready' && consumer.input?.display && consumer.input.configuration ? {
        preparingTiles: todayCurrent.preparing,
        onPrepareTiles: () => {
          const address = parseAddress(window.location.hash);
          if (!todayChain(address) || address.sheet !== undefined || !live(address) || consumer.snapshot() !== todayCurrent) return;
          void consumer.prepare(todayCurrent, () => live(address) && localSheetRef.current === null);
        },
      } : {}),
      ...(!viewer && (context.member.role === 'owner' || context.member.role === 'cofounder') ? { onOpenActivity: () => launchToday(todayCurrent, 'today-record', document.activeElement instanceof HTMLElement ? document.activeElement : null, current => consumer.activity(todayCurrent, current)) } : {}),
    } : { onReview: id => showReference(id), onReceipt: id => openReceipt(id) } },
    sheet, onAddress, onHelp: showHelp,
    renderPlace: address => retainedSurface(address) !== null
      ? <RetainedPlace address={address} retained={controller.retained} scenarioSelection={scenarioSelection} live={live}
        onOpenScenario={(selection, rowOrigin, binding) => { openScenarioRow(selection, rowOrigin, binding); }} onOverview={() => showSavedOverview()}
        onContinueScenarios={continueScenarios} onPageScenarios={pageScenarios}
        onProof={openProof} onProvenance={openProvenance} onOpenLesson={(id, rowOrigin, from) => openLesson(id, rowOrigin, from)} legacy={legacyLink} />
      : address.place === 'trust' && address.sub === 'models' || address.place === 'ask' && (address.sub === undefined || address.sub === 'new')
      ? <RoutePicker routes={state.routes} selected={state.selectedRouteId} language={language} viewer={viewer} onSelect={chooseRoute} />
      : <><State state={{ kind: 'not-built' }} />{legacyLink}</>,
  };
  return conversationEnabled && settings !== null
    ? <ConversationWorkspace app={app} conversation={controller.conversation} questionSettings={settings}
      contextKey={contextKey} readback={readback} onReference={onReference} onSavedOverview={named => showSavedOverview(named)} />
    : <App key={contextKey} {...app} />;
}

function HostWorkspace({ controller, options, onLegacyReturn }: {
  controller: HostController;
  options: HostMountOptions;
  onLegacyReturn: () => void;
}) {
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot, controller.snapshot);
  const [language, setLanguage] = useState<Language>(options.language ?? 'en');
  const [view, setView] = useState<View>(options.view ?? 'guided');
  useEffect(() => { void (controller.todayConsumer === null ? controller.refresh() : controller.refreshToday()); }, [controller]);
  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.removeAttribute('data-theme');
  }, [language]);
  const authorized = state.phase === 'ready' && state.context !== null;
  return <TextProvider language={language}>
    <div style={{ height: '100vh', display: 'grid', gridTemplateRows: 'auto minmax(0, 1fr)' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp4)', padding: 'var(--sp2) var(--sp4)', borderBottom: 'var(--hair) solid var(--line)' }}>
        <Button variant="link" onClick={onLegacyReturn}>{hostMessage(language, 'legacy')}</Button>
        <Button variant="link" onClick={() => { void (controller.todayConsumer === null ? controller.refresh() : controller.refreshToday()); }} disabled={state.phase === 'loading' || state.phase === 'locked'}>{hostMessage(language, 'refresh')}</Button>
      </div>
      <div data-host-workspace="" style={{ minHeight: 0, overflow: 'auto' }}>
        {authorized && state.context !== null
          ? <AuthorizedWorkspace key={JSON.stringify([state.context.contextKey, state.selectedRouteId])}
            controller={controller} state={state} context={state.context} language={language} view={view}
            setLanguage={setLanguage} setView={setView} onLegacyReturn={onLegacyReturn} scenarioSelection={options.scenarioSelection ?? null} />
          : <div style={{ padding: 'var(--sp6)' }}>
            <p role="status">{hostMessage(language, state.phase === 'loading' ? 'loading' : state.phase === 'locked' ? 'locked' : 'unavailable')}</p>
            {state.code !== undefined && <p>{hostMessage(language, 'code', { code: state.code })}</p>}
          </div>}
      </div>
    </div>
  </TextProvider>;
}

/** Called only by the trusted, same-origin opt-in entry after injecting its controller.
 * The mount starts one read-only refresh; no route is chosen and no model is contacted. */
export function mountHost(container: HTMLElement, controller: HostController, options: HostMountOptions = {}): MountedHost {
  navigate(TODAY);
  document.documentElement.removeAttribute('data-theme');
  const root = createRoot(container);
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true; controller.dispose(); root.unmount();
  };
  root.render(<HostWorkspace controller={controller} options={options}
    onLegacyReturn={() => { dispose(); if (options.onLegacyReturn) options.onLegacyReturn(); else window.location.assign('/index.html'); }} />);
  return Object.freeze({ unmount: dispose, dispose });
}
