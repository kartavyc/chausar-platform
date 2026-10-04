/** ce5dc4f Engine Today seam. Pure projection + injected read ports; no network,
 * model calls, effects, aggregate arithmetic, example facts or legacy renderer. */
import type { CalculationReceiptEvidence, EngineFigureEvidence, ReceiptPeriod, TodayView } from './presentation.ts';
import type { ReadFailureCode, ReadResult } from './contract.ts';
import { checkedRead, createBrowserReceiptReader, createDesktopReceiptReader } from './client.ts';
import { figureFromReceipt, UnsupportedPresentationUnitError } from './projections.ts';
import { ReplyValidationError, assertISODate, assertISOInstant, projectCalculationReceipt, receiptEvidenceKeys, validateReceiptEvidence, validateToday } from './validate.ts';
import { projectTodayForUi } from './project-ui.ts';
import type { UIFormatContext, UITodayDataProjection, UITodayProjection } from './project-ui.ts';

export interface DashboardTodayRequest { readonly period?: ReceiptPeriod }
/** Only actual useful brief filters are exposed; dashboard supports period alone. */
export interface BriefTodayRequest extends DashboardTodayRequest {
  readonly asOf?: string;
  readonly branch?: string;
  readonly customerId?: string;
  readonly orderId?: string;
  readonly sourceIds?: readonly string[];
  readonly onDate?: string;
  readonly ritual?: 'monday' | 'friday';
}
export interface TodayStatSelection { readonly operation: string; readonly figureKey: string }
export interface DashboardTodayInput { readonly title: string; readonly date: string; readonly request: DashboardTodayRequest; readonly selections: readonly TodayStatSelection[] }
export interface BriefTodayInput { readonly title: string; readonly date: string; readonly request: BriefTodayRequest; readonly selections: readonly TodayStatSelection[] }
export interface DesktopTodayReadPort {
  request(method: 'dashboard.get', payload: DashboardTodayRequest): Promise<unknown>;
  request(method: 'reports.brief', payload: BriefTodayRequest): Promise<unknown>;
  request(method: 'receipts.get', payload: { readonly id: string }): Promise<unknown>;
}
export interface BrowserTodayReadPort {
  call(message:
    | { readonly method: 'dashboard.get'; readonly payload: DashboardTodayRequest }
    | { readonly method: 'reports.brief'; readonly payload: BriefTodayRequest }
    | { readonly method: 'receipts.get'; readonly payload: { readonly id: string } }): Promise<unknown>;
}
export type TodayUnavailableReason = 'CALCULATION_UNAVAILABLE' | 'FIGURE_NOT_PROVIDED' | 'UNSUPPORTED_PRESENTATION_CURRENCY';
export interface TodayStatEvidence {
  readonly statId: string;
  readonly operation: string;
  readonly figureKey: string;
  readonly receiptId: string;
  /** Exact source display and unit, retained beside the canonical display format. */
  readonly engineFigure: EngineFigureEvidence;
  readonly scope: { readonly period: ReceiptPeriod | null; readonly asOf: string; readonly branch: string | null; readonly currency: string; readonly requestedSourceIds?: readonly string[] };
  readonly coverage: CalculationReceiptEvidence['coverage'];
}
export interface BriefTodayEvidence {
  readonly id: string; readonly ritual: 'monday' | 'friday'; readonly onDate: string;
  readonly headline: string;
  readonly report: { readonly id: string; readonly title: string; readonly type: 'investor'; readonly createdAt: string; readonly status: 'partial' | 'review-ready'; readonly gaps: readonly string[]; readonly delivery: 'local-draft' };
  readonly delivery: { readonly state: 'draft'; readonly channels: readonly ('email' | 'whatsapp')[]; readonly requiresApproval: true };
}
export interface TodayHostProjection {
  readonly source: 'dashboard' | 'brief';
  readonly today: TodayView;
  /** These are freshly authorized reads; receipt metadata never comes from examples. */
  readonly receipts: readonly CalculationReceiptEvidence[];
  readonly statsEvidence: readonly TodayStatEvidence[];
  readonly unavailableSelections: readonly (TodayStatSelection & { readonly reasonCode: TodayUnavailableReason })[];
  readonly unavailable: {
    readonly pendingCount: 'TODAY_PENDING_COUNT_NOT_PROVIDED';
    readonly attention: 'TODAY_ATTENTION_CONTRACT_NOT_PROVIDED';
    readonly worthLook: 'TODAY_WORTH_LOOK_CONTRACT_NOT_PROVIDED';
    readonly dayEvents: 'TODAY_DAY_EVENTS_CONTRACT_NOT_PROVIDED';
    readonly charts: 'TODAY_CHART_SERIES_NOT_PROVIDED';
  };
  readonly brief?: BriefTodayEvidence;
}
export interface TodayHostReader {
  readonly environment: 'desktop' | 'browser';
  dashboard(input: DashboardTodayInput): Promise<ReadResult<TodayHostProjection>>;
  brief(input: BriefTodayInput): Promise<ReadResult<TodayHostProjection>>;
  invalidate(): void;
}
export interface TodayHostUiProjection extends Omit<UITodayProjection, 'data'> {
  readonly data: UITodayDataProjection & { readonly earlierTodayMissing: 'unknown' };
  readonly source: TodayHostProjection['source'];
  readonly statsEvidence: readonly TodayStatEvidence[];
  readonly unavailable: TodayHostProjection['unavailable'];
  readonly brief?: BriefTodayEvidence;
}

const dashboardOperations = ['billed', 'received', 'earned', 'margin'] as const;
const briefOperations = ['billed', 'received', 'net_sales', 'margin', 'aging'] as const;
const unavailable = { pendingCount: 'TODAY_PENDING_COUNT_NOT_PROVIDED', attention: 'TODAY_ATTENTION_CONTRACT_NOT_PROVIDED', worthLook: 'TODAY_WORTH_LOOK_CONTRACT_NOT_PROVIDED', dayEvents: 'TODAY_DAY_EVENTS_CONTRACT_NOT_PROVIDED', charts: 'TODAY_CHART_SERIES_NOT_PROVIDED' } as const;
function invalid(path: string): never { throw new ReplyValidationError(path); }
function freeze<T>(value: T): T { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
/** Reject source accessors/prototypes/cycles before selecting fields. Bounds cover
 * source envelopes; ignored decisions/activity/HTML are never returned or rendered. */
function json(value: unknown, path: string, depth = 0, budget = { remaining: 200000, characters: 8000000 }): void {
  if (depth > 16 || --budget.remaining < 0) invalid(path);
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'string') { budget.characters -= value.length; if (value.length > 2000000 || budget.characters < 0) invalid(path); return; }
  if (typeof value === 'number') { if (!Number.isFinite(value)) invalid(path); return; }
  if (!value || typeof value !== 'object' || Object.getOwnPropertySymbols(value).length > 0) invalid(path);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype || value.length > 10000) invalid(path);
    if (Object.keys(descriptors).some(key => key !== 'length' && !/^(?:0|[1-9]\d*)$/.test(key))) invalid(path);
    for (let i = 0; i < value.length; i++) { const descriptor = descriptors[String(i)]; if (!descriptor || !Object.hasOwn(descriptor, 'value')) invalid(path); json(descriptor.value, path, depth + 1, budget); }
    return;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype || Object.keys(descriptors).length > 1000) invalid(path);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key) || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) invalid(path);
    json(descriptor.value, path, depth + 1, budget);
  }
}
function record(value: unknown, path: string, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) invalid(path);
  const obj = value as Record<string, unknown>;
  if (required.some(key => !Object.hasOwn(obj, key)) || Object.keys(obj).some(key => !required.includes(key) && !optional.includes(key))) invalid(path);
  return obj;
}
function text(value: unknown, path: string, max = 8000): asserts value is string { if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) invalid(path); }
function identifier(value: unknown, path: string): asserts value is string { if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(value)) invalid(path); }
function sourceIdentifier(value: unknown, path: string): asserts value is string { if (typeof value !== 'string' || !/^[A-Za-z0-9_.:-]{1,200}$/.test(value)) invalid(path); }
function list(value: unknown, path: string, max: number): asserts value is unknown[] { if (!Array.isArray(value) || value.length > max) invalid(path); }
function unique(values: readonly unknown[], path: string): void { if (new Set(values).size !== values.length) invalid(path); }
function period(value: unknown, path: string): ReceiptPeriod { const obj = record(value, path, ['from', 'to']); assertISODate(obj.from, path); assertISODate(obj.to, path); if (obj.from > obj.to) invalid(path); return { from: obj.from, to: obj.to }; }
function same(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, i) => same(value, b[i]));
  const aa = a as Record<string, unknown>, bb = b as Record<string, unknown>;
  return Object.keys(aa).length === Object.keys(bb).length && Object.keys(aa).every(key => Object.hasOwn(bb, key) && same(aa[key], bb[key]));
}

function input(value: DashboardTodayInput, source: 'dashboard'): DashboardTodayInput;
function input(value: BriefTodayInput, source: 'brief'): BriefTodayInput;
function input(value: DashboardTodayInput | BriefTodayInput, source: 'dashboard' | 'brief'): DashboardTodayInput | BriefTodayInput {
  json(value, 'today.input');
  const obj = record(value, 'today.input', ['title', 'date', 'request', 'selections']); text(obj.title, 'today.title'); assertISODate(obj.date, 'today.date');
  const request = record(obj.request, 'today.request', [], source === 'dashboard' ? ['period'] : ['period', 'asOf', 'branch', 'customerId', 'orderId', 'sourceIds', 'onDate', 'ritual']);
  if (Object.hasOwn(request, 'period')) period(request.period, 'today.request.period');
  if (Object.hasOwn(request, 'asOf')) assertISOInstant(request.asOf, 'today.request.asOf');
  if (Object.hasOwn(request, 'onDate')) assertISODate(request.onDate, 'today.request.onDate');
  for (const key of ['branch', 'customerId', 'orderId']) if (Object.hasOwn(request, key)) text(request[key], `today.request.${key}`, 200);
  if (Object.hasOwn(request, 'ritual') && request.ritual !== 'monday' && request.ritual !== 'friday') invalid('today.request.ritual');
  if (Object.hasOwn(request, 'sourceIds')) { list(request.sourceIds, 'today.request.sourceIds', 64); request.sourceIds.forEach(id => sourceIdentifier(id, 'today.request.sourceIds')); unique(request.sourceIds, 'today.request.sourceIds'); }
  list(obj.selections, 'today.selections', 3);
  const allowed: readonly string[] = source === 'dashboard' ? dashboardOperations : briefOperations;
  const selections = obj.selections.map(value => { const selection = record(value, 'today.selection', ['operation', 'figureKey']);
    if (typeof selection.operation !== 'string' || !allowed.includes(selection.operation)) invalid('today.selection.operation');
    identifier(selection.figureKey, 'today.selection.figureKey'); if (selection.figureKey.length > 64) invalid('today.selection.figureKey');
    return { operation: selection.operation, figureKey: selection.figureKey };
  });
  unique(selections.map(s => `${s.operation}:${s.figureKey}`), 'today.selections');
  // Detach caller-owned input before the first await or transport invocation.
  return freeze(structuredClone(value));
}

interface DashboardSnapshot { readonly receipts: readonly CalculationReceiptEvidence[]; readonly unavailableOperations: readonly string[] }
function dashboard(value: unknown): DashboardSnapshot {
  json(value, 'dashboard');
  const obj = record(value, 'dashboard', ['workspace', 'calculations', 'factCount', 'sources', 'decisions', 'waitingActions', 'jobs', 'policy', 'dictionary', 'lastActivity']);
  const workspace = record(obj.workspace, 'dashboard.workspace', ['id', 'name', 'currency', 'demo', 'createdAt']);
  identifier(workspace.id, 'dashboard.workspace.id'); text(workspace.name, 'dashboard.workspace.name'); assertISOInstant(workspace.createdAt, 'dashboard.workspace.createdAt');
  if (typeof workspace.demo !== 'boolean' || typeof workspace.currency !== 'string' || !/^[A-Z]{3}$/.test(workspace.currency)) invalid('dashboard.workspace');
  for (const key of ['factCount', 'sources']) if (typeof obj[key] !== 'number' || !Number.isSafeInteger(obj[key]) || (obj[key] as number) < 0) invalid(`dashboard.${key}`);
  for (const key of ['decisions', 'waitingActions', 'jobs']) list(obj[key], `dashboard.${key}`, 10000);
  list(obj.lastActivity, 'dashboard.lastActivity', 8);
  if (!obj.policy || typeof obj.policy !== 'object' || Array.isArray(obj.policy) || (obj.dictionary !== null && (!obj.dictionary || typeof obj.dictionary !== 'object' || Array.isArray(obj.dictionary)))) invalid('dashboard.metadata');
  list(obj.calculations, 'dashboard.calculations', 4); if (obj.calculations.length !== 4) invalid('dashboard.calculations');
  const receipts: CalculationReceiptEvidence[] = [], unavailableOperations: string[] = [], operations: string[] = [];
  for (const value of obj.calculations) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('dashboard.calculations');
    const operation: unknown = (value as Record<string, unknown>).operation;
    if (typeof operation !== 'string' || !(dashboardOperations as readonly string[]).includes(operation)) invalid('dashboard.calculations.operation');
    operations.push(operation);
    if (Object.hasOwn(value, 'error')) { const error = record(value, 'dashboard.calculation.error', ['operation', 'error']); text(error.error, 'dashboard.calculation.error'); unavailableOperations.push(operation); }
    else receipts.push(projectCalculationReceipt(value));
  }
  unique(operations, 'dashboard.calculations.operation'); unique(receipts.map(r => r.id), 'dashboard.receipts');
  return freeze({ receipts, unavailableOperations });
}

interface BriefSection {
  readonly operation: string; readonly receiptId: string; readonly shared: Readonly<Record<string, unknown>>;
}
interface BriefAlertSnapshot {
  readonly receiptIds: readonly string[];
  readonly scope: { readonly branch: string | null; readonly sourceIds: readonly string[] | null };
}
/** Alerts are retained private observations, not Today statistics or activity.
 * Check the current envelope and its authorization references without releasing it. */
function briefAlerts(value: unknown): BriefAlertSnapshot {
  const obj = record(value, 'brief.alerts', ['configured', 'evaluated', 'checkedAt', 'scope', 'items', 'receiptIds', 'pin']);
  if (typeof obj.configured !== 'boolean' || obj.evaluated !== false) invalid('brief.alerts');
  assertISOInstant(obj.checkedAt, 'brief.alerts.checkedAt'); text(obj.pin, 'brief.alerts.pin', 200);
  const scope = record(obj.scope, 'brief.alerts.scope', ['branch', 'sourceIds']);
  if (scope.branch !== null) text(scope.branch, 'brief.alerts.scope.branch', 200);
  if (scope.sourceIds !== null) {
    list(scope.sourceIds, 'brief.alerts.scope.sourceIds', 64);
    scope.sourceIds.forEach(id => sourceIdentifier(id, 'brief.alerts.scope.sourceIds')); unique(scope.sourceIds, 'brief.alerts.scope.sourceIds');
  }
  list(obj.receiptIds, 'brief.alerts.receiptIds', 10000);
  obj.receiptIds.forEach(id => identifier(id, 'brief.alerts.receiptIds')); unique(obj.receiptIds, 'brief.alerts.receiptIds');
  list(obj.items, 'brief.alerts.items', 10000);
  const alertIds: string[] = [], itemReceiptIds: string[] = [];
  for (const value of obj.items) {
    const item = record(value, 'brief.alert', ['alertId', 'conditionId', 'label', 'revision', 'definitionDigest', 'branch', 'sourceIds', 'episodes', 'observation', 'evidence', 'receiptIds']);
    identifier(item.alertId, 'brief.alert.alertId'); text(item.conditionId, 'brief.alert.conditionId', 200); text(item.label, 'brief.alert.label'); text(item.definitionDigest, 'brief.alert.definitionDigest', 200);
    alertIds.push(item.alertId);
    if (typeof item.revision !== 'number' || !Number.isSafeInteger(item.revision) || item.revision < 1) invalid('brief.alert.revision');
    if (item.branch !== null) text(item.branch, 'brief.alert.branch', 200);
    list(item.sourceIds, 'brief.alert.sourceIds', 64); item.sourceIds.forEach(id => sourceIdentifier(id, 'brief.alert.sourceIds')); unique(item.sourceIds, 'brief.alert.sourceIds');
    list(item.receiptIds, 'brief.alert.receiptIds', 10000); item.receiptIds.forEach(id => identifier(id, 'brief.alert.receiptIds')); unique(item.receiptIds, 'brief.alert.receiptIds');
    itemReceiptIds.push(...item.receiptIds as string[]);
    list(item.episodes, 'brief.alert.episodes', 10000);
    const episodeIds: string[] = [];
    for (const value of item.episodes) {
      const episode = record(value, 'brief.alert.episode', ['id', 'status', 'severity', 'openedAt', 'reopenCount', 'uncertain', 'observationIds'], ['clearedAt', 'reopenedAt']);
      identifier(episode.id, 'brief.alert.episode.id'); episodeIds.push(episode.id);
      if (!['open', 'cleared', 'retracted'].includes(episode.status as string) || !['warning', 'critical'].includes(episode.severity as string)) invalid('brief.alert.episode');
      assertISOInstant(episode.openedAt, 'brief.alert.episode.openedAt');
      for (const key of ['clearedAt', 'reopenedAt']) if (Object.hasOwn(episode, key)) assertISOInstant(episode[key], `brief.alert.episode.${key}`);
      if (typeof episode.reopenCount !== 'number' || !Number.isSafeInteger(episode.reopenCount) || episode.reopenCount < 0 || typeof episode.uncertain !== 'boolean') invalid('brief.alert.episode');
      list(episode.observationIds, 'brief.alert.episode.observationIds', 10000);
      episode.observationIds.forEach(id => text(id, 'brief.alert.episode.observationIds', 200)); unique(episode.observationIds, 'brief.alert.episode.observationIds');
    }
    unique(episodeIds, 'brief.alert.episodes');
    if (item.observation !== null) {
      const observation = record(item.observation, 'brief.alert.observation', ['id', 'observedAt', 'recordedAt', 'state', 'receiptId']);
      text(observation.id, 'brief.alert.observation.id', 200); assertISOInstant(observation.observedAt, 'brief.alert.observation.observedAt'); assertISOInstant(observation.recordedAt, 'brief.alert.observation.recordedAt');
      if (!['breach', 'clear', 'band', 'unknown'].includes(observation.state as string)) invalid('brief.alert.observation.state');
      if (observation.receiptId !== null) { identifier(observation.receiptId, 'brief.alert.observation.receiptId'); if (!item.receiptIds.includes(observation.receiptId)) invalid('brief.alert.observation.receiptId'); }
    }
    const evidence = record(item.evidence, 'brief.alert.evidence', ['state', 'issues']);
    if (evidence.state !== 'current' && evidence.state !== 'uncertain') invalid('brief.alert.evidence.state');
    list(evidence.issues, 'brief.alert.evidence.issues', 10000); evidence.issues.forEach(issue => text(issue, 'brief.alert.evidence.issues'));
  }
  unique(alertIds, 'brief.alerts.items');
  if (!same(obj.receiptIds, [...new Set(itemReceiptIds)].sort()) || (obj.configured === false && obj.items.length !== 0)) invalid('brief.alerts.receiptIds');
  return { receiptIds: obj.receiptIds as string[], scope: { branch: scope.branch as string | null, sourceIds: scope.sourceIds as string[] | null } };
}
interface BriefSnapshot {
  readonly sections: readonly BriefSection[]; readonly evidence: BriefTodayEvidence; readonly rawGaps: readonly string[];
  readonly receiptIds: readonly string[]; readonly alertScope: BriefAlertSnapshot['scope'];
}
function brief(value: unknown): BriefSnapshot {
  json(value, 'brief');
  const obj = record(value, 'brief', ['id', 'ritual', 'onDate', 'headline', 'report', 'decisions', 'alerts', 'compliance', 'delivery', 'receiptIds']);
  identifier(obj.id, 'brief.id'); assertISODate(obj.onDate, 'brief.onDate'); text(obj.headline, 'brief.headline');
  if (obj.ritual !== 'monday' && obj.ritual !== 'friday') invalid('brief.ritual');
  list(obj.decisions, 'brief.decisions', 10000);
  const compliance = record(obj.compliance, 'brief.compliance', ['entries', 'calendarVersion', 'status']); list(compliance.entries, 'brief.compliance.entries', 10000);
  if (compliance.calendarVersion !== null) text(compliance.calendarVersion, 'brief.compliance.calendarVersion'); text(compliance.status, 'brief.compliance.status');
  const delivery = record(obj.delivery, 'brief.delivery', ['state', 'channels', 'requiresApproval']);
  if (delivery.state !== 'draft' || delivery.requiresApproval !== true || !same(delivery.channels, ['email', 'whatsapp'])) invalid('brief.delivery');
  const report = record(obj.report, 'brief.report', ['id', 'title', 'type', 'createdAt', 'status', 'sections', 'receiptIds', 'rowIds', 'gaps', 'html', 'delivery']);
  identifier(report.id, 'brief.report.id'); text(report.title, 'brief.report.title'); assertISOInstant(report.createdAt, 'brief.report.createdAt');
  if (report.type !== 'investor' || (report.status !== 'partial' && report.status !== 'review-ready') || report.delivery !== 'local-draft') invalid('brief.report');
  if (typeof report.html !== 'string') invalid('brief.report.html');
  list(report.gaps, 'brief.report.gaps', 1000); report.gaps.forEach(gap => text(gap, 'brief.report.gaps', 100000));
  list(report.rowIds, 'brief.report.rowIds', 10000); report.rowIds.forEach(id => identifier(id, 'brief.report.rowIds')); unique(report.rowIds, 'brief.report.rowIds');
  list(report.sections, 'brief.report.sections', 5);
  const sections = report.sections.map(value => {
    const section = record(value, 'brief.section', ['title', 'receiptId', 'figures', 'period', 'asOf', 'dictionaryHash', 'coverage', 'explanation']);
    if (typeof section.title !== 'string' || !(briefOperations as readonly string[]).includes(section.title)) invalid('brief.section.title');
    identifier(section.receiptId, 'brief.section.receiptId'); text(section.dictionaryHash, 'brief.section.dictionaryHash'); text(section.explanation, 'brief.section.explanation', 100000);
    if (section.period !== null) period(section.period, 'brief.section.period'); assertISOInstant(section.asOf, 'brief.section.asOf'); list(section.figures, 'brief.section.figures', 120);
    return { operation: section.title, receiptId: section.receiptId, shared: section };
  });
  const sectionIds = sections.map(section => section.receiptId); unique(sectionIds, 'brief.sections'); unique(sections.map(s => s.operation), 'brief.sections.operation');
  const alerts = briefAlerts(obj.alerts), receiptIds = [...new Set([...sectionIds, ...alerts.receiptIds])];
  list(obj.receiptIds, 'brief.receiptIds', 10000);
  if (!same(report.receiptIds, sectionIds) || !same(obj.receiptIds, receiptIds)) invalid('brief.receiptIds');
  return freeze({ sections: structuredClone(sections), rawGaps: [...report.gaps] as string[], receiptIds, alertScope: structuredClone(alerts.scope), evidence: {
    id: obj.id, ritual: obj.ritual, onDate: obj.onDate, headline: obj.headline,
    report: { id: report.id, title: report.title, type: 'investor', createdAt: report.createdAt, status: report.status as 'partial' | 'review-ready', gaps: [], delivery: 'local-draft' },
    delivery: { state: 'draft', channels: ['email', 'whatsapp'], requiresApproval: true },
  } });
}

function scope(receipt: CalculationReceiptEvidence, request: BriefTodayRequest): void {
  if (!same(receipt.period, request.period ?? null) || receipt.branch !== (request.branch ?? null)) invalid('today.receipt.scope');
  if (!same(receipt.requestedSourceIds, request.sourceIds)) invalid('today.receipt.requestedSourceIds');
  if (request.asOf !== undefined && receipt.asOf !== new Date(request.asOf).toISOString()) invalid('today.receipt.asOf');
}
function fresh(values: readonly CalculationReceiptEvidence[], ids: readonly string[], max = 5): readonly CalculationReceiptEvidence[] {
  json(values, 'today.receipts'); list(values, 'today.receipts', max);
  const checked = values.map(validateReceiptEvidence); unique(checked.map(r => r.id), 'today.receipts');
  if (checked.length !== ids.length || ids.some(id => !checked.some(r => r.id === id))) invalid('today.receipts.identity');
  return ids.map(id => checked.find(r => r.id === id)!);
}
function projected(source: 'dashboard' | 'brief', values: readonly CalculationReceiptEvidence[], checkedInput: DashboardTodayInput | BriefTodayInput, evidence?: BriefTodayEvidence): TodayHostProjection {
  const stats: TodayView['stats'][number][] = [], statsEvidence: TodayStatEvidence[] = [], unavailableSelections: (TodayStatSelection & { readonly reasonCode: TodayUnavailableReason })[] = [];
  for (const selection of checkedInput.selections) {
    const receipt = values.find(receipt => receipt.operation === selection.operation);
    if (!receipt) { unavailableSelections.push({ ...selection, reasonCode: 'CALCULATION_UNAVAILABLE' }); continue; }
    const engineFigure = receipt.figures.find(figure => figure.key === selection.figureKey);
    if (!engineFigure) { unavailableSelections.push({ ...selection, reasonCode: 'FIGURE_NOT_PROVIDED' }); continue; }
    try {
      const figure = figureFromReceipt(receipt, selection.figureKey), statId = `${selection.operation}:${selection.figureKey}`;
      stats.push({ id: statId, label: engineFigure.label, figure, chart: null });
      statsEvidence.push({ statId, operation: selection.operation, figureKey: selection.figureKey, receiptId: receipt.id, engineFigure,
        scope: { period: receipt.period, asOf: receipt.asOf, branch: receipt.branch, currency: receipt.currency, ...(receipt.requestedSourceIds !== undefined ? { requestedSourceIds: receipt.requestedSourceIds } : {}) }, coverage: receipt.coverage });
    } catch (error) { if (!(error instanceof UnsupportedPresentationUnitError)) throw error; unavailableSelections.push({ ...selection, reasonCode: 'UNSUPPORTED_PRESENTATION_CURRENCY' }); }
  }
  const today = validateToday({ title: checkedInput.title, date: checkedInput.date, pendingCount: null, attention: [], worthLook: [], stats, dayEvents: [], state: { kind: 'partial', asOf: null, reasonCode: 'TODAY_ENGINE_CONTRACT_PARTIAL' } });
  return freeze({ source, today, receipts: values, statsEvidence, unavailableSelections, unavailable, ...(evidence ? { brief: evidence } : {}) });
}

/** Pure checked projection. The host reader below supplies the freshly authorized receipts. */
export function projectDashboardToday(raw: unknown, authorizedReceipts: readonly CalculationReceiptEvidence[], requested: DashboardTodayInput): TodayHostProjection {
  const checkedInput = input(requested, 'dashboard'), snapshot = dashboard(raw);
  const values = fresh(authorizedReceipts, snapshot.receipts.map(r => r.id));
  for (const value of values) {
    scope(value, checkedInput.request);
    const initial = snapshot.receipts.find(r => r.id === value.id)!;
    // A stored receipt is immutable apart from its current staleness annotation.
    for (const key of [...receiptEvidenceKeys, 'requestedSourceIds'] as const) if (key !== 'stale' && !same(initial[key], value[key])) invalid('dashboard.receipt.binding');
  }
  return projected('dashboard', values, checkedInput);
}

export function projectBriefToday(raw: unknown, authorizedReceipts: readonly CalculationReceiptEvidence[], requested: BriefTodayInput): TodayHostProjection {
  const checkedInput = input(requested, 'brief'), snapshot = brief(raw);
  const authorized = fresh(authorizedReceipts, snapshot.receiptIds, 10000);
  // Alert evidence can cover other periods. It must be authorized, but only
  // report-section receipts are bound to this request and released as report data.
  const values = snapshot.sections.map(section => authorized.find(receipt => receipt.id === section.receiptId)!);
  const alertSources = snapshot.alertScope.sourceIds === null ? null : [...snapshot.alertScope.sourceIds].sort();
  const requestedAlertSources = checkedInput.request.sourceIds === undefined ? null : [...checkedInput.request.sourceIds].sort();
  if (snapshot.alertScope.branch !== (checkedInput.request.branch ?? null) || !same(alertSources, requestedAlertSources)) invalid('brief.alerts.scope');
  if (checkedInput.request.onDate !== undefined && snapshot.evidence.onDate !== checkedInput.request.onDate) invalid('brief.onDate');
  if (snapshot.evidence.ritual !== (checkedInput.request.ritual ?? 'monday')) invalid('brief.ritual');
  for (const value of values) {
    scope(value, checkedInput.request);
    const section = snapshot.sections.find(section => section.receiptId === value.id)!;
    if (section.operation !== value.operation) invalid('brief.receipt.operation');
    for (const key of ['figures', 'period', 'asOf', 'dictionaryHash', 'coverage', 'explanation'] as const) if (!same(section.shared[key], value[key])) invalid('brief.receipt.binding');
  }
  // Report gaps mix coverage with raw per-operation error messages. Only actual
  // retained coverage and the report's fixed qualification may leave this boundary.
  const qualification = 'This is an investor data annex. It does not provide a valuation or certify unimported metrics.';
  const coverageGaps = values.flatMap(r => r.coverage.gaps);
  const gaps = snapshot.rawGaps.filter(gap => coverageGaps.includes(gap) || gap === qualification);
  return projected('brief', values, checkedInput, { ...snapshot.evidence, report: { ...snapshot.evidence.report, gaps } });
}

interface ReceiptRead { receipt(id: string): Promise<ReadResult<CalculationReceiptEvidence>>; invalidate(): void }
function failed(code: ReadFailureCode): never { throw Object.freeze({ code }); }
function reader(environment: 'desktop' | 'browser', readDashboard: (request: DashboardTodayRequest) => Promise<unknown>, readBrief: (request: BriefTodayRequest) => Promise<unknown>, receipts: ReceiptRead): TodayHostReader {
  let generation = Symbol();
  const invalidate = () => { generation = Symbol(); receipts.invalidate(); };
  const reread = async (ids: readonly string[]) => {
    const values: CalculationReceiptEvidence[] = [];
    for (const id of ids) { const read = await receipts.receipt(id); if (!read.ok) failed(read.code); values.push(read.value); }
    return values;
  };
  return Object.freeze({ environment, invalidate,
    dashboard(requested: DashboardTodayInput) {
      const currentGeneration = generation; let checked: DashboardTodayInput;
      return checkedRead(async () => { checked = input(requested, 'dashboard'); return readDashboard(checked.request); }, async raw => {
        const snapshot = dashboard(raw); const freshReceipts = await reread(snapshot.receipts.map(r => r.id));
        return projectDashboardToday(raw, freshReceipts, checked);
      }, () => generation === currentGeneration, invalidate);
    },
    brief(requested: BriefTodayInput) {
      const currentGeneration = generation; let checked: BriefTodayInput;
      return checkedRead(async () => { checked = input(requested, 'brief'); return readBrief(checked.request); }, async raw => {
        const snapshot = brief(raw); const freshReceipts = await reread(snapshot.receiptIds);
        return projectBriefToday(raw, freshReceipts, checked);
      }, () => generation === currentGeneration, invalidate);
    },
  });
}
export function createDesktopTodayReader(port: DesktopTodayReadPort): TodayHostReader {
  return reader('desktop', request => port.request('dashboard.get', request), request => port.request('reports.brief', request), createDesktopReceiptReader(port));
}
export function createBrowserTodayReader(port: BrowserTodayReadPort): TodayHostReader {
  return reader('browser', request => port.call({ method: 'dashboard.get', payload: request }), request => port.call({ method: 'reports.brief', payload: request }), createBrowserReceiptReader(port));
}

/** Preserve host-contract gaps beside the generic Today display DTO. An unavailable
 * event contract cannot mean that nothing happened. This performs no new host read;
 * the trusted caller clears the view when authority/context/generation changes. */
export function projectTodayHostForUi(value: TodayHostProjection, config: UIFormatContext): TodayHostUiProjection {
  json(value, 'today.host');
  const obj = record(value, 'today.host', ['source', 'today', 'receipts', 'statsEvidence', 'unavailableSelections', 'unavailable'], ['brief']);
  if (obj.source !== 'dashboard' && obj.source !== 'brief') invalid('today.host.source');
  const today = validateToday(obj.today);
  if (today.pendingCount !== null || today.attention.length || today.worthLook.length || today.dayEvents.length || today.state.kind !== 'partial' || today.state.asOf !== null || today.state.reasonCode !== 'TODAY_ENGINE_CONTRACT_PARTIAL') invalid('today.host.contract');
  if (!same(obj.unavailable, unavailable)) invalid('today.host.unavailable');
  list(obj.receipts, 'today.host.receipts', 5); const receipts = obj.receipts.map(validateReceiptEvidence); unique(receipts.map(r => r.id), 'today.host.receipts');
  list(obj.statsEvidence, 'today.host.statsEvidence', 3); list(obj.unavailableSelections, 'today.host.unavailableSelections', 3);
  const selections = obj.statsEvidence.map(value => {
    const evidence = record(value, 'today.host.stat', ['statId', 'operation', 'figureKey', 'receiptId', 'engineFigure', 'scope', 'coverage']);
    text(evidence.operation, 'today.host.stat.operation'); identifier(evidence.figureKey, 'today.host.stat.figureKey');
    return { operation: evidence.operation, figureKey: evidence.figureKey };
  });
  const unavailableSelections = obj.unavailableSelections.map(value => {
    const selection = record(value, 'today.host.unavailableSelection', ['operation', 'figureKey', 'reasonCode']);
    text(selection.operation, 'today.host.unavailableSelection.operation'); identifier(selection.figureKey, 'today.host.unavailableSelection.figureKey');
    if (typeof selection.reasonCode !== 'string' || !['CALCULATION_UNAVAILABLE', 'FIGURE_NOT_PROVIDED', 'UNSUPPORTED_PRESENTATION_CURRENCY'].includes(selection.reasonCode)) invalid('today.host.unavailableSelection.reasonCode');
    return { operation: selection.operation, figureKey: selection.figureKey };
  });
  const request = { title: today.title, date: today.date, request: {}, selections: [...selections, ...unavailableSelections] };
  const checkedInput = obj.source === 'dashboard' ? input(request, 'dashboard') : input(request, 'brief');
  const expected = projected(obj.source, receipts, checkedInput);
  if (!same(expected.today, today) || !same(expected.statsEvidence, obj.statsEvidence) || !same(expected.unavailableSelections, obj.unavailableSelections)) invalid('today.host.binding');
  if ((obj.source === 'brief') !== Object.hasOwn(obj, 'brief')) invalid('today.host.brief');
  if (Object.hasOwn(obj, 'brief')) {
    const evidence = record(obj.brief, 'today.host.brief', ['id', 'ritual', 'onDate', 'headline', 'report', 'delivery']);
    identifier(evidence.id, 'today.host.brief.id'); assertISODate(evidence.onDate, 'today.host.brief.onDate'); text(evidence.headline, 'today.host.brief.headline');
    if (evidence.ritual !== 'monday' && evidence.ritual !== 'friday') invalid('today.host.brief.ritual');
    const report = record(evidence.report, 'today.host.brief.report', ['id', 'title', 'type', 'createdAt', 'status', 'gaps', 'delivery']);
    identifier(report.id, 'today.host.brief.report.id'); text(report.title, 'today.host.brief.report.title'); assertISOInstant(report.createdAt, 'today.host.brief.report.createdAt');
    if (report.type !== 'investor' || (report.status !== 'partial' && report.status !== 'review-ready') || report.delivery !== 'local-draft') invalid('today.host.brief.report');
    list(report.gaps, 'today.host.brief.report.gaps', 1000); report.gaps.forEach(gap => text(gap, 'today.host.brief.report.gaps', 100000));
    const coverageGaps = receipts.flatMap(r => r.coverage.gaps), qualification = 'This is an investor data annex. It does not provide a valuation or certify unimported metrics.';
    if (report.gaps.some(gap => typeof gap !== 'string' || (!coverageGaps.includes(gap) && gap !== qualification))) invalid('today.host.brief.report.gaps');
    if (!same(evidence.delivery, { state: 'draft', channels: ['email', 'whatsapp'], requiresApproval: true })) invalid('today.host.brief.delivery');
  }
  const display = projectTodayForUi(today, config);
  return freeze({ ...display, data: { ...display.data, earlierTodayMissing: 'unknown' }, source: value.source, statsEvidence: structuredClone(value.statsEvidence), unavailable,
    ...(value.brief ? { brief: structuredClone(value.brief) } : {}),
  });
}
