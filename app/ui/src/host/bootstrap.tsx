/** Explicit, additive Today/Ask mount. Transport and authority arrive via the host controller. */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { App, type AppProps } from '../app/App';
import { ConversationWorkspace, type ConversationWorkspaceProps } from '../app/ConversationWorkspace';
import { PageHeader } from '../app/PageHeader';
import type { Address, Language, View } from '../app/presentation.ts';
import { formatAddress, parseAddress, sameAddress, withoutSheet, withSheet } from '../app/routes.ts';
import { TextProvider, useT } from '../app/text';
import type { ConversationSavedAnswer } from '../bridge/conversation-host.ts';
import type { CalculationReceiptEvidence, ReceiptPeriod } from '../bridge/presentation.ts';
import { projectTodayHostForUi } from '../bridge/today-host.ts';
import { Button } from '../parts/Button';
import { Label } from '../parts/Label';
import { Sheet } from '../parts/Sheet';
import { State } from '../patterns/States';
import type { ConversationReferenceIntent } from '../screens/ask/ConversationAnswer';
import { ScenarioProvenanceBody } from '../screens/ask/RetainedScenario';
import { LessonReviewSheet } from '../screens/reports/LessonReview';
import { RetainedPlace, retainedSurface } from '../screens/retained/RetainedPlace';
import type { TodayData } from '../screens/today/TodayData.ts';
import type { UiContext, UiModelRoute } from './contracts.ts';
import type { HostController, HostReceiptSelection, HostState } from './controller.ts';
import { lessonDecisionAvailability, scenarioProof } from './retained-contracts.ts';
import type { LessonDecisionIntent, LessonReviewView, RetainedScenarioView, ScenarioSelection } from './retained-contracts.ts';
import type { LessonReviewState, RetainedScenarioState } from './retained-controller.ts';
import { hostMessage, hostMissingWords } from './text.ts';
import detail from '../patterns/ModelConsentSheet.module.css';
import '../tokens/index.css';
import '../views/simple.css';
import '../views/books.css';
import './host.css';

export { createHostController } from './controller.ts';
export type { HostRpcPort } from './contracts.ts';
export type { ScenarioSelection } from './retained-contracts.ts';

export interface HostMountOptions {
  readonly language?: Language;
  readonly view?: View;
  /** The trusted entry preserves its transport context when returning to legacy. */
  readonly onLegacyReturn?: () => void;
  /**
   * An exact retained scenario pin chosen by the trusted host, opened on Ask, Saved with a
   * fresh authorized `scenarios.reopen`. The Engine has no scenario enumeration, so without
   * this pin saved what-ifs cannot be listed or opened here. This is a callback seam only:
   * no native host supplies it yet, and it never carries catalogue data or snapshots.
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

/** The proof behind a what-if figure: the embedded receipt of the exact run in the fresh, confirmed reopen view. */
function ScenarioProofPanel({ runId, scenario, language, origin, onClose }: {
  runId: string;
  scenario: RetainedScenarioState;
  language: Language;
  origin: HTMLElement | null;
  onClose: () => void;
}) {
  const t = useT();
  const proof = scenario.kind === 'ready' ? scenarioProof(scenario.view, runId) : null;
  const pairs = (items: readonly (readonly [string, ReactNode])[]) => <dl className={detail.pairs}>
    {items.map(([name, content], index) => <div className={detail.pair} key={`${name}-${index}`}>
      <dt className={detail.name}>{name}</dt><dd className={[detail.value, 'fig'].join(' ')}>{content}</dd>
    </div>)}
  </dl>;
  return <Sheet kind={t('RETAINED.proof.kind')} title={proof === null ? t('RETAINED.proof.kind') : proof.result.receipt.id} origin={origin} onClose={onClose}>
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

/** The exact provenance of the displayed, confirmed what-if view, in the one sheet. */
function ScenarioProvenancePanel({ scenario, origin, onClose }: { scenario: RetainedScenarioState; origin: HTMLElement | null; onClose: () => void }) {
  const t = useT();
  const ready = scenario.kind === 'ready' ? scenario : null;
  return <Sheet kind={t('RETAINED.scenario.provenance')} title={ready === null ? t('RETAINED.scenario.title') : ready.view.revision.id} origin={origin} onClose={onClose}>
    {ready === null ? <p role="status">{t('RETAINED.proof.unavailable')}</p>
      : <><p className={detail.note}><Label kind="what-if" /> {t('RETAINED.scenario.identity', { scenario: ready.view.scenarioId, revision: ready.view.revision.id, createdAt: ready.view.revision.createdAt })}</p>
        <ScenarioProvenanceBody view={ready.view} historical={ready.historical} /></>}
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

type LocalSheet = { readonly address: Address; readonly kind: 'about' | 'reference' | 'help' | 'what-if-proof' | 'what-if-provenance' | 'lesson'; readonly id?: string };
type SavedSelection = NonNullable<ConversationWorkspaceProps['readback']>;
const PROOF_SHEET = 'what-if-proof';
const PROVENANCE_SHEET = 'what-if-provenance';
const LESSON_SHEET = 'lesson';

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
  const contextKey = JSON.stringify([context.contextKey, state.selectedRouteId]);
  const retained = useSyncExternalStore(controller.retained.subscribe, controller.retained.snapshot, controller.retained.snapshot);
  const active = useRef<Address | null>(TODAY);
  const origin = useRef<HTMLElement | null>(null);
  const helpFallback = useRef<HTMLElement | null>(null);
  const returnSavedId = useRef<string | null>(null);
  const selectionCounter = useRef(0);
  const [readback, setReadback] = useState<SavedSelection | undefined>(undefined);
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
      setLocalSheet(null);
    }
    // Retained lifecycle: leaving a place or sub-place clears its private view so a return needs a
    // fresh authorized read; any sheet change at the same place fences every pending operation.
    if (previous === null || address === null || !samePlace(previous, address)) controller.retained.invalidate();
    else if (!sameAddress(previous, address)) controller.retained.cancelPending();
    // A retained sheet address that no open sheet owns (after a remount or a pasted hash) is reduced to its
    // surface at rest: the sheet opens only from a live press, never from the address alone.
    const owned = current !== null && address !== null && sameAddress(current.address, address);
    if (address !== null && !owned && (address.sheet === PROOF_SHEET || address.sheet === PROVENANCE_SHEET || address.sheet === LESSON_SHEET)) navigate(withoutSheet(address));
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
  const dropLessonSelection = () => { if (localSheetRef.current?.kind === LESSON_SHEET) controller.retained.selectLesson(null); };
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
    const address: Address = { place: 'ask', sub: 'saved' };
    selectionCounter.current += 1;
    setReadback({ id, address, selectionKey: String(selectionCounter.current) });
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
    origin.current = currentOrigin(); returnSavedId.current = savedId; dropLessonSelection(); controller.retained.cancelPending(); setLocalSheet(null);
    const address = withSheet(active.current, 'receipt');
    navigate(address); void controller.openReceipt(id, address);
  };
  /**
   * A what-if sheet (the proof of a figure, or the exact provenance) opens only after a fresh
   * `scenarios.reopen` of the same pin still equals the displayed checked view, and only if this
   * bare address is still live and no other sheet opened meanwhile. The press names the exact
   * checked view its control was rendered for: a newer view published at the same address before
   * React commits is refused, never substituted into the old press. A changed view refuses the
   * old press and clears the stale figures. The proof is the embedded receipt of the exact run;
   * it never reads `receipts.get`.
   */
  const openScenarioSheet = (kind: typeof PROOF_SHEET | typeof PROVENANCE_SHEET, runId: string | undefined, suppliedOrigin: HTMLElement | null, rendered: RetainedScenarioView) => {
    const address = active.current;
    if (address === null || address.sheet !== undefined || retainedSurface(address) !== 'scenario' || !live(address)) return;
    const shown = controller.retained.snapshot().scenario;
    if (shown.kind !== 'ready' || shown.checking || shown.view !== rendered || (runId !== undefined && scenarioProof(shown.view, runId) === null)) return;
    const opener = suppliedOrigin ?? currentOrigin();
    void controller.retained.confirmScenario(shown.selection, shown.view, () => live(address)).then(result => {
      if (!result.ok || localSheetRef.current !== null || controller.snapshot().receipt !== null || !live(address)) return;
      const latest = controller.retained.snapshot().scenario;
      if (latest.kind !== 'ready' || latest.checking || latest.view !== shown.view || (runId !== undefined && scenarioProof(latest.view, runId) === null)) return;
      origin.current = opener?.isConnected ? opener : currentOrigin(); returnSavedId.current = null; dropLessonSelection();
      const sheetAddress = withSheet(address, kind);
      const selection: LocalSheet = runId === undefined ? { address: sheetAddress, kind } : { address: sheetAddress, kind, id: runId };
      localSheetRef.current = selection; setLocalSheet(selection); navigate(sheetAddress);
    });
  };
  const openProof = (runId: string, suppliedOrigin: HTMLElement | null, rendered: RetainedScenarioView) => openScenarioSheet(PROOF_SHEET, runId, suppliedOrigin, rendered);
  const openProvenance = (suppliedOrigin: HTMLElement | null, rendered: RetainedScenarioView) => openScenarioSheet(PROVENANCE_SHEET, undefined, suppliedOrigin, rendered);
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
    origin.current = currentOrigin(); returnSavedId.current = savedId; dropLessonSelection(); controller.retained.cancelPending(); controller.closeReceipt();
    const address = withSheet(active.current, 'reference');
    setLocalSheet({ address, kind: 'reference', id }); navigate(address);
  };
  const onReference = (intent: ConversationReferenceIntent, saved: ConversationSavedAnswer) => {
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
    origin.current = currentOrigin(); returnSavedId.current = null; dropLessonSelection(); controller.retained.cancelPending(); controller.closeReceipt();
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
    returnSavedId.current = null; dropLessonSelection(); controller.retained.cancelPending(); controller.closeReceipt();
    const address = withSheet(active.current, 'help');
    const selection: LocalSheet = { address, kind: 'help' };
    localSheetRef.current = selection; setLocalSheet(selection); navigate(address);
  };
  if (projection.kind === 'invalid') return <State state={{ kind: 'failed', code: 'INVALID_REPLY' }} />;
  const words = hostMissingWords(language);
  const data: TodayData = projection.kind === 'ready' ? projection.value.data : {
    state: { kind: 'loading' }, date: '', review: { count: { exact: null, display: words['not-loaded-yet'] }, rows: [] },
    thisMonthMissing: 'not-loaded-yet', earlierTodayMissing: 'unknown',
  };
  const legacyLink = <Button variant="link" onClick={onLegacyReturn}>{hostMessage(language, 'legacy')}</Button>;
  const sheet: AppProps['sheet'] = state.receipt !== null ? {
    address: state.receipt.address,
    content: <ReceiptPanel key={state.receipt.id} selection={state.receipt} language={language} origin={origin.current} onClose={closeSheet} />,
  } : localSheet === null ? undefined : localSheet.kind === PROOF_SHEET && localSheet.id !== undefined ? {
    address: localSheet.address,
    content: <ScenarioProofPanel key={localSheet.id} runId={localSheet.id} scenario={retained.scenario} language={language} origin={origin.current} onClose={closeSheet} />,
  } : localSheet.kind === PROVENANCE_SHEET ? {
    address: localSheet.address,
    content: <ScenarioProvenancePanel scenario={retained.scenario} origin={origin.current} onClose={closeSheet} />,
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
    today: { data, intents: { onReview: id => showReference(id), onReceipt: id => openReceipt(id) } },
    sheet, onAddress, onHelp: showHelp,
    renderPlace: address => retainedSurface(address) !== null
      ? <RetainedPlace address={address} retained={controller.retained} scenarioSelection={scenarioSelection} live={live}
        onProof={openProof} onProvenance={openProvenance} onOpenLesson={(id, rowOrigin, from) => openLesson(id, rowOrigin, from)} legacy={legacyLink} />
      : address.place === 'trust' && address.sub === 'models' || address.place === 'ask' && (address.sub === undefined || address.sub === 'new')
      ? <RoutePicker routes={state.routes} selected={state.selectedRouteId} language={language} viewer={viewer} onSelect={chooseRoute} />
      : <><State state={{ kind: 'not-built' }} />{legacyLink}</>,
  };
  return conversationEnabled && settings !== null
    ? <ConversationWorkspace app={app} conversation={controller.conversation} questionSettings={settings}
      contextKey={contextKey} readback={readback} onReference={onReference} />
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
  useEffect(() => { void controller.refresh(); }, [controller]);
  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.removeAttribute('data-theme');
  }, [language]);
  const authorized = state.phase === 'ready' && state.context !== null;
  return <TextProvider language={language}>
    <div style={{ height: '100vh', display: 'grid', gridTemplateRows: 'auto minmax(0, 1fr)' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp4)', padding: 'var(--sp2) var(--sp4)', borderBottom: 'var(--hair) solid var(--line)' }}>
        <Button variant="link" onClick={onLegacyReturn}>{hostMessage(language, 'legacy')}</Button>
        <Button variant="link" onClick={() => { void controller.refresh(); }} disabled={state.phase === 'loading' || state.phase === 'locked'}>{hostMessage(language, 'refresh')}</Button>
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
