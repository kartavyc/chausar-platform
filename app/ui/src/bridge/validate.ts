import type {
  ApprovalView, CAConsoleView, CalculationReceiptEvidence, Capability, ChartView,
  EnterpriseInvestigationStatus, Figure, PhoneHeadlineView, RowView, TodayView, ViewState,
} from './presentation.ts';

/** A fixed code and structural path only. Never expose the rejected value or raw error. */
export class ReplyValidationError extends Error {
  readonly code = 'INVALID_REPLY';
  readonly path: string;
  constructor(path: string) { super('INVALID_REPLY'); this.name = 'ReplyValidationError'; this.path = path; }
}
function fail(path: string): never { throw new ReplyValidationError(path); }
function object(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail(path);
  if (Object.getOwnPropertySymbols(value).length > 0) fail(path);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (!Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) fail(path);
  }
  return value as Record<string, unknown>;
}
function shape(value: unknown, path: string, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  const obj = object(value, path);
  if (required.some(key => !Object.hasOwn(obj, key)) || Object.keys(obj).some(key => !required.includes(key) && !optional.includes(key))) fail(path);
  if (Object.values(obj).some(item => item === undefined)) fail(path);
  return obj;
}
function string(value: unknown, path: string, maximum = 8000, allowEmpty = false): asserts value is string {
  if (typeof value !== 'string' || value.length > maximum || (!allowEmpty && value.trim().length === 0) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) fail(path);
}
function id(value: unknown, path: string): asserts value is string { string(value, path, 200); }
function choice(value: unknown, path: string, allowed: readonly string[]): void {
  if (typeof value !== 'string' || !allowed.includes(value)) fail(path);
}
function boolean(value: unknown, path: string): void { if (typeof value !== 'boolean') fail(path); }
function integer(value: unknown, path: string, maximum = Number.MAX_SAFE_INTEGER): void {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > maximum) fail(path);
}
export function assertIntegerString(value: unknown, path = 'integer', signed = true): asserts value is string {
  if (typeof value !== 'string' || value.length > 256 || !(signed ? /^-?\d+$/ : /^\d+$/).test(value)) fail(path);
}
function array(value: unknown, path: string, maximum: number, validate: (item: unknown, path: string) => void): void {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum || Object.getOwnPropertySymbols(value).length > 0) fail(path);
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (!Object.hasOwn(descriptor, 'value') || (key !== 'length' && !/^(?:0|[1-9]\d*)$/.test(key))) fail(path);
  }
  for (let i = 0; i < value.length; i++) validate(value[i], `${path}[${i}]`);
}
function unique(items: unknown, path: string, field?: string): void {
  if (!Array.isArray(items)) fail(path);
  const keys = items.map(item => field ? object(item, path)[field] : item);
  if (new Set(keys).size !== keys.length) fail(path);
}
export function assertISODate(value: unknown, path = 'date'): asserts value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(path);
  const d = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== value) fail(path);
}
export function assertISOInstant(value: unknown, path = 'instant'): asserts value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) fail(path);
  assertISODate(value.slice(0, 10), path);
  const hours = Number(value.slice(11, 13)), minutes = Number(value.slice(14, 16)), seconds = Number(value.slice(17, 19));
  if (hours > 23 || minutes > 59 || seconds > 59 || !Number.isFinite(Date.parse(value))) fail(path);
  const offset = value.match(/([+-])(\d{2}):(\d{2})$/);
  if (offset && (Number(offset[2]) > 23 || Number(offset[3]) > 59)) fail(path);
}
function clock(value: unknown, path: string): void {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) assertISODate(value, path);
  else assertISOInstant(value, path);
}
function nullable(value: unknown, path: string, validate: (v: unknown, p: string) => void): void { if (value !== null) validate(value, path); }
const marks = ['cha', 'you', 'wait', 'busy', 'unsure', 'guess', 'off'];
const labels = ['seed', 'what-if', 'projection', 'from-outside', 'approximate', 'demo-clock', 'stale'];
const missingStates = ['absent', 'null', 'unknown', 'withheld', 'not-applicable', 'not-loaded-yet', 'not-counted'];
const chartKinds = ['columns', 'line', 'ordered-bar', 'ranked-bars', 'bridge', 'goal-line', 'step-line', 'pair-bars', 'strip', 'spark', 'rule-bar'];

function figure(value: unknown, path: string): void {
  const obj = object(value, path);
  choice(obj.kind, `${path}.kind`, ['money', 'count', 'percent', 'missing']);
  if (obj.kind === 'missing') {
    shape(value, path, ['kind', 'state']); choice(obj.state, `${path}.state`, missingStates); return;
  }
  const valueKeys = obj.kind === 'money' ? ['currency', 'paise'] : obj.kind === 'count' ? ['count'] : ['basisPoints'];
  shape(value, path, ['kind', 'receiptId', 'labels', ...valueKeys]); id(obj.receiptId, `${path}.receiptId`);
  array(obj.labels, `${path}.labels`, labels.length, (v, p) => choice(v, p, labels)); unique(obj.labels, `${path}.labels`);
  if (obj.kind === 'money') { choice(obj.currency, `${path}.currency`, ['INR']); assertIntegerString(obj.paise, `${path}.paise`); }
  else if (obj.kind === 'count') assertIntegerString(obj.count, `${path}.count`, false);
  else assertIntegerString(obj.basisPoints, `${path}.basisPoints`);
}
function action(value: unknown, path: string): void {
  const obj = shape(value, path, ['type', 'address']); choice(obj.type, `${path}.type`, ['open-sheet']); string(obj.address, `${path}.address`, 300);
  // Match the actual local route schema. Sheet IDs are opaque engine identities
  // (for example receipt_<uuid>); only the place and sub-place are strict slugs.
  // No decoding, foreign scheme, extra path segment or arbitrary query is allowed.
  const match = /^#\/(?:today|ask|work|books|reports|tools|trust|company|clients|more)(?:\/[a-z][a-z0-9-]{0,63})?(?:\?sheet=[a-zA-Z0-9][a-zA-Z0-9_.-]{0,199})?$/.exec(obj.address);
  if (match?.[0] !== obj.address) fail(`${path}.address`);
}
function row(value: unknown, path: string): void {
  const obj = shape(value, path, ['id', 'mark', 'title', 'note'], ['figure', 'action']);
  id(obj.id, `${path}.id`); choice(obj.mark, `${path}.mark`, marks); string(obj.title, `${path}.title`); string(obj.note, `${path}.note`, 8000, true);
  if (Object.hasOwn(obj, 'figure')) {
    figure(obj.figure, `${path}.figure`);
    // Possible causes carry words and evidence, never a measured business value.
    if (obj.mark === 'guess' && (obj.figure as Record<string, unknown>).kind !== 'missing') fail(`${path}.figure`);
  }
  if (Object.hasOwn(obj, 'action')) action(obj.action, `${path}.action`);
}
function viewState(value: unknown, path: string): void {
  const obj = object(value, path);
  const minimal = ['ready', 'empty', 'no-change']; const dated = ['loading', 'partial', 'stale'];
  const reasoned = ['insufficient', 'not-yet', 'rule-stopped', 'failed', 'network-waiting', 'read-only', 'hidden', 'locked', 'not-built'];
  choice(obj.kind, `${path}.kind`, [...minimal, ...dated, ...reasoned]);
  if (minimal.includes(String(obj.kind))) shape(value, path, ['kind']);
  else if (dated.includes(String(obj.kind))) {
    shape(value, path, ['kind', 'asOf', 'reasonCode']); nullable(obj.asOf, `${path}.asOf`, clock); id(obj.reasonCode, `${path}.reasonCode`);
  } else { shape(value, path, ['kind', 'reasonCode']); id(obj.reasonCode, `${path}.reasonCode`); }
}
function capability(value: unknown, path: string): void {
  const obj = object(value, path); choice(obj.state, `${path}.state`, ['live', 'partial', 'missing']);
  if (obj.state === 'live') shape(value, path, ['state']);
  else { shape(value, path, ['state', 'reasonCode'], ['expectedDay']); id(obj.reasonCode, `${path}.reasonCode`); if (Object.hasOwn(obj, 'expectedDay')) integer(obj.expectedDay, `${path}.expectedDay`, 10); }
}
function chart(value: unknown, path: string): void {
  const obj = shape(value, path, ['kind', 'description', 'points']); choice(obj.kind, `${path}.kind`, chartKinds); string(obj.description, `${path}.description`);
  array(obj.points, `${path}.points`, 120, (v, p) => {
    const point = shape(v, p, ['id', 'label', 'value']); id(point.id, `${p}.id`); string(point.label, `${p}.label`); figure(point.value, `${p}.value`);
  }); unique(obj.points, `${path}.points`, 'id');
  // Geometry cannot silently mix unlike units or treat a missing point as zero.
  const units = new Set((obj.points as Record<string, unknown>[]).map(p => (p.value as Record<string, unknown>).kind).filter(kind => kind !== 'missing'));
  if (units.size > 1) fail(`${path}.points`);
}
function today(value: unknown, path: string): void {
  const obj = shape(value, path, ['title', 'date', 'pendingCount', 'attention', 'worthLook', 'stats', 'dayEvents', 'state']);
  string(obj.title, `${path}.title`); assertISODate(obj.date, `${path}.date`); nullable(obj.pendingCount, `${path}.pendingCount`, (v, p) => assertIntegerString(v, p, false));
  array(obj.attention, `${path}.attention`, 4, row); unique(obj.attention, `${path}.attention`, 'id');
  array(obj.worthLook, `${path}.worthLook`, 5, row); unique(obj.worthLook, `${path}.worthLook`, 'id');
  if (Array.isArray(obj.attention) && Array.isArray(obj.worthLook)) {
    if (obj.attention.length + obj.worthLook.length > 5) fail(`${path}.worthLook`);
    const rowIds = [...obj.attention, ...obj.worthLook].map(r => (r as Record<string, unknown>).id);
    if (new Set(rowIds).size !== rowIds.length) fail(`${path}.worthLook`);
  }
  array(obj.stats, `${path}.stats`, 12, (v, p) => {
    const stat = shape(v, p, ['id', 'label', 'figure', 'chart'], ['change', 'changeLabel']); id(stat.id, `${p}.id`); string(stat.label, `${p}.label`);
    figure(stat.figure, `${p}.figure`); nullable(stat.chart, `${p}.chart`, chart);
    if (Object.hasOwn(stat, 'change')) figure(stat.change, `${p}.change`);
    if (Object.hasOwn(stat, 'changeLabel')) {
      string(stat.changeLabel, `${p}.changeLabel`);
      if (!Object.hasOwn(stat, 'change') || /[\p{N}\u20b9%]/u.test(stat.changeLabel as string)) fail(`${p}.changeLabel`);
    }
  }); unique(obj.stats, `${path}.stats`, 'id');
  array(obj.dayEvents, `${path}.dayEvents`, 6, (v, p) => {
    const event = shape(v, p, ['id', 'at', 'mark', 'label'], ['action']); id(event.id, `${p}.id`); assertISOInstant(event.at, `${p}.at`); choice(event.mark, `${p}.mark`, marks); string(event.label, `${p}.label`);
    if (Object.hasOwn(event, 'action')) action(event.action, `${p}.action`);
  }); unique(obj.dayEvents, `${path}.dayEvents`, 'id'); viewState(obj.state, `${path}.state`);
  // A vault lock invalidates retained workspace evidence and action context.
  // The host owns the unlock surface; a locked reply cannot keep cached facts.
  if ((obj.state as Record<string, unknown>).kind === 'locked' &&
      (obj.pendingCount !== null || [obj.attention, obj.worthLook, obj.stats, obj.dayEvents].some(items => (items as unknown[]).length > 0))) fail(`${path}.state`);
}
function period(value: unknown, path: string): void {
  const obj = shape(value, path, ['from', 'to']); assertISODate(obj.from, `${path}.from`); assertISODate(obj.to, `${path}.to`); if (obj.from > obj.to) fail(path);
}
function jsonData(value: unknown, path: string, depth = 0): void {
  if (depth > 12) fail(path);
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'string') { string(value, path, 100000, true); return; }
  if (typeof value === 'number') { if (!Number.isFinite(value)) fail(path); return; }
  if (Array.isArray(value)) { array(value, path, 10000, (v, p) => jsonData(v, p, depth + 1)); return; }
  const obj = object(value, path); if (Object.keys(obj).length > 1000) fail(path);
  for (const [key, v] of Object.entries(obj)) { if (['__proto__', 'prototype', 'constructor'].includes(key)) fail(path); jsonData(v, `${path}.${key}`, depth + 1); }
}
export const receiptEvidenceKeys = [
  'id', 'memberId', 'epoch', 'sourceIds', 'operation', 'createdAt', 'asOf', 'period', 'comparePeriod', 'branch', 'currency',
  'ontologyVersion', 'dictionaryHash', 'definitionHash', 'figures', 'valueMinor', 'totalMinor', 'rowIds', 'rows', 'exclusions',
  'coverage', 'assumptions', 'explanation', 'stale', 'allowedNumbers',
] as const;
function receipt(value: unknown, path: string): void {
  const obj = shape(value, path, receiptEvidenceKeys, ['staleReason', 'requestedSourceIds', 'missingFigures']);
  for (const key of ['id', 'memberId', 'operation', 'dictionaryHash', 'definitionHash']) id(obj[key], `${path}.${key}`);
  integer(obj.epoch, `${path}.epoch`); integer(obj.ontologyVersion, `${path}.ontologyVersion`);
  array(obj.sourceIds, `${path}.sourceIds`, 10000, id); unique(obj.sourceIds, `${path}.sourceIds`);
  if (Object.hasOwn(obj, 'requestedSourceIds')) {
    array(obj.requestedSourceIds, `${path}.requestedSourceIds`, 64, (v, p) => { if (typeof v !== 'string' || !/^[A-Za-z0-9_.:-]{1,200}$/.test(v)) fail(p); });
    unique(obj.requestedSourceIds, `${path}.requestedSourceIds`);
    if ((obj.sourceIds as string[]).some(sourceId => !(obj.requestedSourceIds as string[]).includes(sourceId))) fail(`${path}.requestedSourceIds`);
  }
  assertISOInstant(obj.createdAt, `${path}.createdAt`); clock(obj.asOf, `${path}.asOf`);
  nullable(obj.period, `${path}.period`, period); nullable(obj.comparePeriod, `${path}.comparePeriod`, period); nullable(obj.branch, `${path}.branch`, id);
  if (typeof obj.currency !== 'string' || !/^[A-Z]{3}$/.test(obj.currency)) fail(`${path}.currency`);
  array(obj.figures, `${path}.figures`, 120, (v, p) => {
    const f = shape(v, p, ['key', 'label', 'minor', 'display', 'unit'], ['currency', 'quantityUnit']); id(f.key, `${p}.key`); string(f.label, `${p}.label`); assertIntegerString(f.minor, `${p}.minor`); string(f.display, `${p}.display`);
    choice(f.unit, `${p}.unit`, ['money', 'basis-points', 'quantity', 'count']);
    if (Object.hasOwn(f, 'quantityUnit') && (f.unit !== 'quantity' || Object.hasOwn(f, 'currency'))) fail(`${p}.quantityUnit`);
    if (Object.hasOwn(f, 'quantityUnit')) string(f.quantityUnit, `${p}.quantityUnit`, 40);
    if ((f.unit === 'quantity' || f.unit === 'count') && Object.hasOwn(f, 'currency')) fail(`${p}.currency`);
    if (f.unit === 'money' && f.currency !== obj.currency) fail(`${p}.currency`);
    if (Object.hasOwn(f, 'currency') && (typeof f.currency !== 'string' || !/^[A-Z]{3}$/.test(f.currency))) fail(`${p}.currency`);
  }); unique(obj.figures, `${path}.figures`, 'key');
  assertIntegerString(obj.valueMinor, `${path}.valueMinor`); assertIntegerString(obj.totalMinor, `${path}.totalMinor`);
  array(obj.rowIds, `${path}.rowIds`, 10000, id); unique(obj.rowIds, `${path}.rowIds`);
  array(obj.rows, `${path}.rows`, 10000, (v, p) => {
    const r = shape(v, p, ['factId', 'entityId', 'sourceId', 'sourceRow', 'kind', 'amountMinor', 'validFrom'], ['measureField', 'dueDate', 'invoiceId', 'customerId', 'orderId', 'status', 'branch', 'normalization', 'sourceAmountMinor', 'item', 'quantityUnit']);
    for (const key of ['factId', 'entityId', 'sourceId', 'kind']) id(r[key], `${p}.${key}`);
    integer(r.sourceRow, `${p}.sourceRow`); if (r.sourceRow === 0) fail(`${p}.sourceRow`); assertIntegerString(r.amountMinor, `${p}.amountMinor`); assertISODate(r.validFrom, `${p}.validFrom`);
    if (Object.hasOwn(r, 'dueDate')) assertISODate(r.dueDate, `${p}.dueDate`);
    for (const key of ['measureField', 'invoiceId', 'customerId', 'orderId', 'status', 'branch']) if (Object.hasOwn(r, key)) string(r[key], `${p}.${key}`);
    if (Object.hasOwn(r, 'sourceAmountMinor')) { assertIntegerString(r.sourceAmountMinor, `${p}.sourceAmountMinor`); if (!Object.hasOwn(r, 'normalization')) fail(`${p}.sourceAmountMinor`); }
    if (Object.hasOwn(r, 'item')) string(r.item, `${p}.item`, 120); if (Object.hasOwn(r, 'quantityUnit')) string(r.quantityUnit, `${p}.quantityUnit`, 40);
    if (Object.hasOwn(r, 'item') !== Object.hasOwn(r, 'quantityUnit')) fail(`${p}.quantityUnit`);
    if (Object.hasOwn(r, 'normalization')) {
      const n = shape(r.normalization, `${p}.normalization`, ['sourceCurrency', 'targetCurrency', 'rate']);
      for (const key of ['sourceCurrency', 'targetCurrency']) if (typeof n[key] !== 'string' || !/^[A-Z]{3}$/.test(n[key])) fail(`${p}.normalization.${key}`);
      jsonData(n.rate, `${p}.normalization.rate`);
    }
  }); unique(obj.rows, `${path}.rows`, 'factId');
  if (Array.isArray(obj.rows) && Array.isArray(obj.rowIds) && (obj.rowIds.length !== obj.rows.length || obj.rows.some((r, i) => (r as Record<string, unknown>).factId !== (obj.rowIds as unknown[])[i]))) fail(`${path}.rowIds`);
  array(obj.exclusions, `${path}.exclusions`, 10000, (v, p) => { const e = shape(v, p, ['rowId', 'reason']); id(e.rowId, `${p}.rowId`); string(e.reason, `${p}.reason`); });
  const coverage = shape(obj.coverage, `${path}.coverage`, ['selectedRows', 'countedRows', 'excludedRows', 'unresolvedConflicts', 'importIds', 'completeness', 'gaps'], ['notCounted']);
  if (Object.hasOwn(coverage, 'notCounted')) integer(coverage.notCounted, `${path}.coverage.notCounted`);
  for (const key of ['selectedRows', 'countedRows', 'excludedRows', 'unresolvedConflicts']) integer(coverage[key], `${path}.coverage.${key}`);
  if (Array.isArray(obj.rows) && coverage.countedRows !== obj.rows.length) fail(`${path}.coverage.countedRows`);
  array(coverage.importIds, `${path}.coverage.importIds`, 10000, id); array(coverage.gaps, `${path}.coverage.gaps`, 1000, string);
  choice(coverage.completeness, `${path}.coverage.completeness`, ['reconciled-imports', 'unreconciled-facts', 'empty', 'partial']);
  object(obj.assumptions, `${path}.assumptions`); jsonData(obj.assumptions, `${path}.assumptions`);
  string(obj.explanation, `${path}.explanation`, 100000, true); boolean(obj.stale, `${path}.stale`);
  if (Object.hasOwn(obj, 'staleReason')) string(obj.staleReason, `${path}.staleReason`);
  array(obj.allowedNumbers, `${path}.allowedNumbers`, 10000, (v, p) => { if (typeof v !== 'string' || v.length > 256 || !/^-?\d+(?:\.\d+)?$/.test(v)) fail(p); });
  if (Object.hasOwn(obj, 'missingFigures')) {
    array(obj.missingFigures, `${path}.missingFigures`, 120, (v, p) => {
      const m = shape(v, p, ['key', 'label', 'missing', 'reason']); id(m.key, `${p}.key`); string(m.label, `${p}.label`); string(m.reason, `${p}.reason`);
      choice(m.missing, `${p}.missing`, ['not-loaded-yet', 'absent', 'unknown', 'not-applicable', 'not-counted']);
    }); unique(obj.missingFigures, `${path}.missingFigures`, 'key');
  }
}
function approval(value: unknown, path: string): void {
  const obj = shape(value, path, ['id', 'kind', 'state', 'title', 'note', 'can', 'readOnly', 'prepareOnly', 'needsSecondAsk', 'digest', 'revision']);
  id(obj.id, `${path}.id`); id(obj.digest, `${path}.digest`); integer(obj.revision, `${path}.revision`); if (obj.revision === 0) fail(`${path}.revision`);
  choice(obj.kind, `${path}.kind`, ['message', 'record-change', 'money', 'prepare-only', 'job', 'group']);
  choice(obj.state, `${path}.state`, ['prepared', 'approved', 'executing', 'verified', 'unknown', 'rejected', 'blocked', 'cancelled']);
  string(obj.title, `${path}.title`); string(obj.note, `${path}.note`, 8000, true);
  for (const key of ['readOnly', 'prepareOnly', 'needsSecondAsk']) boolean(obj[key], `${path}.${key}`);
  array(obj.can, `${path}.can`, 6, (v, p) => choice(v, p, ['approve', 'notNow', 'change', 'drop', 'reconcile', 'open-app'])); unique(obj.can, `${path}.can`);
  if (obj.kind === 'prepare-only' && obj.prepareOnly !== true) fail(`${path}.prepareOnly`);
  if (obj.kind === 'money' && obj.needsSecondAsk !== true) fail(`${path}.needsSecondAsk`);
  if (Array.isArray(obj.can)) {
    if (obj.readOnly && obj.can.some(v => v !== 'open-app')) fail(`${path}.can`);
    if (obj.prepareOnly && obj.can.includes('approve')) fail(`${path}.can`);
    if (obj.state === 'unknown' && obj.can.some(v => !['reconcile', 'open-app'].includes(String(v)))) fail(`${path}.can`);
    if (obj.state !== 'prepared' && obj.can.some(v => ['approve', 'change'].includes(String(v)))) fail(`${path}.can`);
    if (obj.state !== 'unknown' && obj.can.includes('reconcile')) fail(`${path}.can`);
    if (['executing', 'verified', 'rejected', 'cancelled'].includes(String(obj.state)) && obj.can.some(v => v !== 'open-app')) fail(`${path}.can`);
  }
}
function phone(value: unknown, path: string): void {
  const obj = shape(value, path, ['id', 'template', 'linkId', 'approval']); id(obj.id, `${path}.id`); id(obj.linkId, `${path}.linkId`);
  if (typeof obj.linkId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,199}$/.test(obj.linkId)) fail(`${path}.linkId`);
  choice(obj.template, `${path}.template`, ['week-ready', 'review-waiting', 'document-received', 'due-soon']);
  if (obj.approval === null) return;
  const a = shape(obj.approval, `${path}.approval`, ['policy', 'expiresAt', 'actions']); choice(a.policy, `${path}.approval.policy`, ['simple-reversible', 'open-app-only']); assertISOInstant(a.expiresAt, `${path}.approval.expiresAt`);
  array(a.actions, `${path}.approval.actions`, 3, (v, p) => choice(v, p, ['approve', 'notNow', 'open-app'])); unique(a.actions, `${path}.approval.actions`);
  if (a.policy === 'open-app-only' && Array.isArray(a.actions) && a.actions.some(v => v !== 'open-app')) fail(`${path}.approval.actions`);
}
function ca(value: unknown, path: string): void {
  const obj = shape(value, path, ['title', 'clients', 'capability']); string(obj.title, `${path}.title`); capability(obj.capability, `${path}.capability`);
  array(obj.clients, `${path}.clients`, 200, (v, p) => {
    const c = shape(v, p, ['clientId', 'clientLabel', 'booksReadAt', 'closeState', 'awaitingFirm', 'nextDueDate']); id(c.clientId, `${p}.clientId`); string(c.clientLabel, `${p}.clientLabel`);
    nullable(c.booksReadAt, `${p}.booksReadAt`, assertISOInstant); choice(c.closeState, `${p}.closeState`, ['not-started', 'in-progress', 'ready', 'blocked', 'unknown']);
    nullable(c.awaitingFirm, `${p}.awaitingFirm`, (n, np) => assertIntegerString(n, np, false)); nullable(c.nextDueDate, `${p}.nextDueDate`, assertISODate);
  }); unique(obj.clients, `${path}.clients`, 'clientId');
}
function immutable<T>(value: unknown, validate: (v: unknown, p: string) => void): T {
  validate(value, 'reply'); const clone: unknown = structuredClone(value);
  function freeze(v: unknown): void { if (v && typeof v === 'object') { Object.freeze(v); Object.values(v).forEach(freeze); } }
  freeze(clone); return clone as T;
}
export const validateFigure = (value: unknown): Figure => immutable(value, figure);
export const validateRow = (value: unknown): RowView => immutable(value, row);
export const validateChart = (value: unknown): ChartView => immutable(value, chart);
export const validateToday = (value: unknown): TodayView => immutable(value, today);
export const validateViewState = (value: unknown): ViewState => immutable(value, viewState);
export const validateCapability = (value: unknown): Capability => immutable(value, capability);
export const validateReceiptEvidence = (value: unknown): CalculationReceiptEvidence => immutable(value, receipt);
export const validateApproval = (value: unknown): ApprovalView => immutable(value, approval);
export const validatePhoneHeadline = (value: unknown): PhoneHeadlineView => immutable(value, phone);
export const validateCAConsole = (value: unknown): CAConsoleView => immutable(value, ca);
export const validateEnterpriseStatus = (value: unknown): EnterpriseInvestigationStatus => immutable(value, (v, p) => {
  const obj = shape(v, p, ['investigationId', 'status'], ['reason', 'resultId']);
  id(obj.investigationId, `${p}.investigationId`); choice(obj.status, `${p}.status`, ['queued', 'running', 'completed', 'failed', 'cancelled']);
  if (Object.hasOwn(obj, 'reason')) id(obj.reason, `${p}.reason`);
  if (Object.hasOwn(obj, 'resultId')) id(obj.resultId, `${p}.resultId`);
});

/** Consume the real full DTO but expose only the documented evidence projection. */
export function projectCalculationReceipt(value: unknown): CalculationReceiptEvidence {
  const obj = shape(value, 'receipt', [...receiptEvidenceKeys, 'definitions'], ['staleReason', 'requestedSourceIds', 'compiledCalculation', 'databaseProof', 'missingFigures']);
  if (!Array.isArray(obj.definitions)) fail('receipt.definitions');
  for (const key of ['definitions', 'compiledCalculation', 'databaseProof']) if (Object.hasOwn(obj, key)) jsonData(obj[key], `receipt.${key}`);
  const selected: Record<string, unknown> = {};
  for (const key of [...receiptEvidenceKeys, 'staleReason', 'requestedSourceIds', 'missingFigures']) if (Object.hasOwn(obj, key)) selected[key] = obj[key];
  return validateReceiptEvidence(selected);
}
