/** Explicit, additive Today/Ask mount. Transport and authority arrive via the host controller. */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { App, type AppProps } from '../app/App';
import { ConversationWorkspace, type ConversationWorkspaceProps } from '../app/ConversationWorkspace';
import { PageHeader } from '../app/PageHeader';
import type { Address, Language, View } from '../app/presentation.ts';
import { formatAddress, sameAddress, withoutSheet, withSheet } from '../app/routes.ts';
import { TextProvider } from '../app/text';
import type { ConversationSavedAnswer } from '../bridge/conversation-host.ts';
import type { CalculationReceiptEvidence, ReceiptPeriod } from '../bridge/presentation.ts';
import { projectTodayHostForUi } from '../bridge/today-host.ts';
import { Button } from '../parts/Button';
import { Sheet } from '../parts/Sheet';
import { State } from '../patterns/States';
import type { ConversationReferenceIntent } from '../screens/ask/ConversationAnswer';
import type { TodayData } from '../screens/today/TodayData.ts';
import type { UiContext, UiModelRoute } from './contracts.ts';
import type { HostController, HostReceiptSelection, HostState } from './controller.ts';
import { hostMessage, hostMissingWords } from './text.ts';
import detail from '../patterns/ModelConsentSheet.module.css';
import '../tokens/index.css';
import '../views/simple.css';
import '../views/books.css';
import './host.css';

export { createHostController } from './controller.ts';
export { createDesktopRequestPort } from '../bridge/client.ts';
export type { HostRpcPort } from './contracts.ts';

export interface HostMountOptions {
  readonly language?: Language;
  readonly view?: View;
  /** The trusted entry preserves its transport context when returning to legacy. */
  readonly onLegacyReturn?: () => void;
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

type LocalSheet = { readonly address: Address; readonly kind: 'about' | 'reference' | 'help'; readonly id?: string };
type SavedSelection = NonNullable<ConversationWorkspaceProps['readback']>;

function AuthorizedWorkspace({ controller, state, context, language, view, setLanguage, setView, onLegacyReturn }: {
  controller: HostController;
  state: HostState;
  context: UiContext;
  language: Language;
  view: View;
  setLanguage: (language: Language) => void;
  setView: (view: View) => void;
  onLegacyReturn: () => void;
}) {
  const contextKey = JSON.stringify([context.contextKey, state.selectedRouteId]);
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
    active.current = address;
    const receipt = controller.snapshot().receipt;
    if (receipt !== null && (address === null || !sameAddress(receipt.address, address))) controller.closeReceipt();
    const current = localSheetRef.current;
    if (current !== null && (address === null || !sameAddress(current.address, address))) setLocalSheet(null);
  }, [controller]);
  const stillAuthorized = () => {
    const current = controller.snapshot();
    return current.phase === 'ready' && current.context?.contextKey === context.contextKey && current.selectedRouteId === state.selectedRouteId;
  };
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
    controller.closeReceipt(); localSheetRef.current = null; setLocalSheet(null);
    if (returnFocus?.isConnected) returnFocus.focus();
    const savedId = returnSavedId.current; returnSavedId.current = null;
    if (savedId !== null && stillAuthorized()) selectSaved(savedId);
    else if (active.current !== null) navigate(withoutSheet(active.current));
  };
  const openReceipt = (id: string, savedId: string | null = null) => {
    if (!stillAuthorized() || active.current === null) return;
    origin.current = currentOrigin(); returnSavedId.current = savedId; setLocalSheet(null);
    const address = withSheet(active.current, 'receipt');
    navigate(address); void controller.openReceipt(id, address);
  };
  const showReference = (id: string, savedId: string | null = null) => {
    if (!stillAuthorized() || active.current === null) return;
    origin.current = currentOrigin(); returnSavedId.current = savedId; controller.closeReceipt();
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
    origin.current = currentOrigin(); returnSavedId.current = null; controller.closeReceipt();
    const address = withSheet(active.current, 'about'); setLocalSheet({ address, kind: 'about' }); navigate(address);
  };
  const showHelp = (suppliedOrigin?: HTMLElement | null, fallback?: HTMLElement | null) => {
    if (!stillAuthorized() || active.current === null) return;
    if (localSheetRef.current?.kind === 'help') return;
    const focused = suppliedOrigin === undefined ? currentOrigin() : suppliedOrigin;
    const opener = focused?.closest('[data-region="sheet"]') ? origin.current : focused;
    helpFallback.current = fallback?.isConnected ? fallback : null;
    origin.current = opener?.isConnected ? opener : fallback?.isConnected ? fallback : null;
    returnSavedId.current = null; controller.closeReceipt();
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
  const sheet: AppProps['sheet'] = state.receipt !== null ? {
    address: state.receipt.address,
    content: <ReceiptPanel key={state.receipt.id} selection={state.receipt} language={language} origin={origin.current} onClose={closeSheet} />,
  } : localSheet === null ? undefined : {
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
    renderPlace: address => address.place === 'trust' && address.sub === 'models' || address.place === 'ask' && (address.sub === undefined || address.sub === 'new')
      ? <RoutePicker routes={state.routes} selected={state.selectedRouteId} language={language} viewer={viewer} onSelect={chooseRoute} />
      : <><State state={{ kind: 'not-built' }} /><Button variant="link" onClick={onLegacyReturn}>{hostMessage(language, 'legacy')}</Button></>,
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
            setLanguage={setLanguage} setView={setView} onLegacyReturn={onLegacyReturn} />
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
