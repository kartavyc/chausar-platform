/**
 * The fake engine: a `HostRpcPort`-compatible request port that serves the host controller,
 * Today, first run and every `todayx.*` method from synthetic data only (one invented
 * "Demo shop", invented customers, money as whole paise strings). It is for previews,
 * screenshots and tests. Production code never imports it; `tests/frame-today-fake.test.ts`
 * checks that only previews and tests do.
 *
 * - Deterministic: fixed ids, a fixed demo clock (default 2026-09-30), no randomness.
 * - Mutations (`today.prepareTiles`, `todayx.clock.advance`, `ontology.publish`, ...) change
 *   this engine's memory only.
 * - Unknown methods reject with an Error whose `code` is `UNKNOWN_METHOD`, so a place whose
 *   engine method does not exist yet shows "not built yet".
 * - Other lanes add fixture handlers for their own families with `registerFakeMethods`.
 *
 * Scenarios: `populated` (the default), `empty` (a published dictionary, nothing read yet),
 * `first-run` (no published dictionary), `locked` (the vault is locked; creation unlocks a
 * fresh workspace), `read-only` (a viewer seat).
 */
import type { Language } from '../app/presentation.ts';
import { todayDigest } from './today-engine.ts';
import type { TodayConfiguration, TodayProducerInput, TodayTilesRequest } from './today-engine.ts';
import type { DeviceChoices, IdentityCard, IdentityField, RecoveryContact } from './todayx-contract.ts';
import { IDENTITY_FIELDS } from './todayx-contract.ts';
import {
  ACTIONS, DEMO_CLOCK, DEMO_OWNER, DEMO_ROUTE, DEMO_SOURCES, DEMO_TIME_ZONE, DEMO_VIEWER, DEMO_WORKSPACE, IMPORT, TILES,
  actionRecord, alertEpisode, compileDictionary, dayEvents, decisionRecord, dueDecision, fakeHash, importRecord, label, receiptFor,
  receiptIdFor, reviewRow, sha256Hex, starterPacks,
} from './fixtures/shop.ts';
import type { TileFixture } from './fixtures/shop.ts';
import {
  activityReply, capabilitiesReply, checklistReply, faultReport, firstRunStatusReply, gstinCheckCharacter, helpReply, identityCheck,
  phoneMessagesReply, shellReply, statusReply, worthReply,
} from './fixtures/todayx.ts';
import type { FakeScenarioName, TodayxState } from './fixtures/todayx.ts';
import { createFakeIdea } from './fixtures/idea.ts';

export type FakeScenario = FakeScenarioName;
/** The passphrase that opens the fake's locked workspace. Synthetic; never a real secret. */
export const FAKE_PASSPHRASE = 'synthetic-demo-passphrase';
export const FAKE_SCENARIOS: readonly FakeScenario[] = ['populated', 'empty', 'first-run', 'locked', 'read-only'];
/** Served before the vault is open, as the engine serves them to the trusted local desktop. */
export const FAKE_PRE_VAULT: readonly string[] = ['todayx.identity.check', 'todayx.diskCheck', 'todayx.device.get', 'todayx.device.set', 'todayx.workspaces', 'todayx.recoveryContact.request'];

export interface FakeEngineOptions {
  readonly language?: Language;
  readonly scenario?: FakeScenario;
  /** The demo clock's starting day, `YYYY-MM-DD`. */
  readonly clock?: string;
}

/** What a registered handler receives besides the payload. */
export interface FakeContext {
  readonly scenario: FakeScenario;
  readonly language: Language;
  /** The demo clock's current day. */
  readonly date: string;
  readonly timeZone: string;
  readonly role: 'owner' | 'cofounder' | 'accountant' | 'viewer';
  /** Per-engine memory a lane's handlers may keep state in, keyed by the lane's own names. */
  readonly store: Map<string, unknown>;
  refuse(code: string, message?: string): Error & { code: string };
}
export type FakeHandler = (payload: Readonly<Record<string, unknown>>, context: FakeContext) => unknown;

export interface FakeEngine {
  /** The `HostRpcPort` and `PlaceRpc` shape. */
  request(method: string, payload?: unknown): Promise<unknown>;
  readonly scenario: FakeScenario;
  readonly language: Language;
  /** The demo clock's current day. */
  date(): string;
  /** Every method requested so far, in order. */
  readonly calls: readonly string[];
  /** The methods this engine serves (built in and registered). */
  methods(): readonly string[];
  /** The trusted Today input a preview hands to `createHostController`: display, configuration and the three charts. */
  todayProducer(): Promise<TodayProducerInput>;
}

export function fakeRefusal(code: string, message = 'The fake engine refused the request.'): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

/** Families the fake engine serves itself. Lanes register their own families. */
const BUILT_IN_FAMILIES = new Set(['ui', 'today', 'todayx', 'ontology', 'receipts', 'models', 'workspace', 'actions', 'jobs', 'decisions', 'sources', 'learning', 'activity', 'memory', 'scenarios']);
const registry = new Map<string, FakeHandler>();

/**
 * Add fixture handlers for one method family, e.g. `registerFakeMethods('books', { sources: ... })`
 * serves `books.sources`. A key may also be the full method name. Returns a function that removes
 * them again. A family the fake engine serves itself cannot be replaced.
 */
export function registerFakeMethods(family: string, handlers: Readonly<Record<string, FakeHandler>>): () => void {
  if (!/^[a-z][a-zA-Z0-9]*$/.test(family)) throw fakeRefusal('INVALID_REQUEST', 'A method family is one lower-case word.');
  if (BUILT_IN_FAMILIES.has(family)) throw fakeRefusal('INVALID_REQUEST', 'The fake engine serves this family itself.');
  const names = Object.entries(handlers).map(([key, handler]) => [key.startsWith(`${family}.`) ? key : `${family}.${key}`, handler] as const);
  for (const [name, handler] of names) registry.set(name, handler);
  return () => { for (const [name, handler] of names) if (registry.get(name) === handler) registry.delete(name); };
}

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const isDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
function addDays(date: string, days: number): string {
  const at = new Date(`${date}T00:00:00Z`); at.setUTCDate(at.getUTCDate() + days); return at.toISOString().slice(0, 10);
}

interface Seat { readonly id: string; readonly name: string; readonly role: FakeContext['role'] }
interface Attempt { readonly receipt: Record<string, unknown>; readonly dictionary: Record<string, unknown> }

export function createFakeEngine(options: FakeEngineOptions = {}): FakeEngine {
  const scenario: FakeScenario = options.scenario ?? 'populated';
  const language: Language = options.language ?? 'en';
  if (!FAKE_SCENARIOS.includes(scenario)) throw fakeRefusal('INVALID_REQUEST', 'Unknown fake scenario.');
  let date = options.clock ?? DEMO_CLOCK;
  if (!isDate(date)) throw fakeRefusal('INVALID_REQUEST', 'The demo clock is a YYYY-MM-DD day.');
  let unlocked = scenario !== 'locked';
  let workspace: { id: string; name: string; demo: boolean } = { ...DEMO_WORKSPACE };
  const seat: Seat = scenario === 'read-only' ? DEMO_VIEWER : DEMO_OWNER;
  let ontology: { current: Record<string, unknown> | null; history: Record<string, unknown>[] } = { current: null, history: [] };
  const attempts = new Map<string, Attempt>();
  const captures = new Map<string, Record<string, unknown>>();
  const todayx: TodayxState = { clock: { mode: 'demo', date, set: false }, jobsPaused: true };
  let identity: IdentityCard | null = null;
  const idea = createFakeIdea(fakeRefusal);
  let device: DeviceChoices = { language: null, view: null, saved: false };
  let recoveryContact: RecoveryContact | null = null;
  const store = new Map<string, unknown>();
  const calls: string[] = [];

  const ready = (async () => {
    if (scenario === 'first-run' || scenario === 'locked') return;
    const retail = starterPacks()[1]!;
    const published = await compileDictionary(retail, 1, DEMO_OWNER.id, `${date}T03:00:00.000Z`);
    ontology = { current: published, history: [published] };
    if (scenario === 'populated' || scenario === 'read-only') {
      const first14 = '27ABCDE1234F1Z';
      identity = { fields: { pan: 'ABCDE1234F', gstin: `${first14}${gstinCheckCharacter(first14) ?? '0'}` }, gstMode: 'regular', savedAt: `${date}T03:10:00.000Z` };
    }
  })();

  const context = (): FakeContext => ({ scenario, language, date, timeZone: DEMO_TIME_ZONE, role: seat.role, store, refuse: fakeRefusal });
  const dictionary = () => ontology.current;
  const pack = () => {
    const current = dictionary();
    return current === null ? null : { id: String(current['pack']), dictionaryHash: String(current['hash']), version: Number(current['version']) };
  };
  async function uiContext() {
    if (!unlocked) throw fakeRefusal('VAULT_LOCKED', 'The vault is locked.');
    const contextKey = await sha256Hex(JSON.stringify({ kind: 'fake-ui-context', workspace: workspace.id, member: seat.id, role: seat.role, epoch: 1, dictionary: dictionary()?.['hash'] ?? null, attempts: [...attempts.keys()] }));
    return { workspace: { ...workspace }, member: { id: seat.id, name: seat.name, role: seat.role, epoch: 1, branches: ['*'] }, contextKey };
  }
  const mutating = () => { if (seat.role === 'viewer') throw fakeRefusal('ACCESS_DENIED', 'A viewer seat changes nothing.'); };
  const populated = () => scenario === 'populated' || scenario === 'read-only';

  /* ------------------------------------------------------------ Today */
  function display(payload: Readonly<Record<string, unknown>>) {
    if (!isDate(payload['date']) || typeof payload['timeZone'] !== 'string') throw fakeRefusal('TODAY_INVALID_REQUEST', 'Today needs a business day and time zone.');
    return { date: payload['date'], timeZone: payload['timeZone'] };
  }
  const REVIEW_TOTAL = ACTIONS.length;
  function queue(offset: number, limit: number) {
    if (!populated()) return { scope: 'prepared-actions-job-mandates-deliverables-lessons-v1', completeness: 'complete', count: 0, knownCount: 0, rows: [], nextCursor: null, producers: { actions: { status: 'complete' }, jobs: { status: 'complete' }, lessons: { status: 'complete' } } };
    const rows = ACTIONS.slice(offset, offset + limit).map(action => reviewRow(action, date));
    return {
      scope: 'prepared-actions-job-mandates-deliverables-lessons-v1', completeness: 'complete', count: REVIEW_TOTAL, knownCount: REVIEW_TOTAL, rows,
      nextCursor: offset + limit < REVIEW_TOTAL && rows.length > 0 ? `review_after_${offset + limit}` : null,
      producers: { actions: { status: 'complete' }, jobs: { status: 'complete' }, lessons: { status: 'complete' } },
    };
  }
  function attention(shown: { date: string; timeZone: string }, reviewCount: number) {
    const episodes = populated() ? [alertEpisode(shown.date)] : [], decisions = populated() ? [dueDecision(shown.date)] : [];
    const eligible = episodes.length + decisions.length;
    const candidates = [...decisions.map(value => ({ id: 'attention_decision_kiran', kind: 'due-decision', value })), ...episodes.map(value => ({ id: 'attention_alert_meera', kind: 'alert-episode', value }))];
    return {
      state: 'available',
      value: {
        kind: 'today-attention-v1', request: { displayedDate: shown.date, timeZone: shown.timeZone },
        authority: { workspaceId: workspace.id, memberId: seat.id, epoch: 1, stateRevision: 7 },
        alertEpisodes: episodes, dueDecisions: decisions,
        calendar: { window: { from: shown.date, through: addDays(shown.date, 6), days: 7, timeZone: shown.timeZone }, state: 'unavailable', reason: 'no-reviewed-calendar', rows: [] },
        counts: { alertEpisodes: episodes.length, dueDecisions: decisions.length, calendarEntries: 0 },
        alertsCheckedAt: `${shown.date}T05:00:00.000Z`, evaluated: false, pin: fakeHash(`attention:${shown.date}`),
      },
      selection: { state: 'configured', policyId: 'policy_demo_attention', policyRevision: '1', eligibleCount: eligible, rows: candidates.slice(0, Math.min(eligible, Math.max(0, 5 - reviewCount))) },
    };
  }
  function tileValue(tile: TileFixture, amount: { minor: string; display: string } | null, text: string, receiptId: string, partial = false) {
    const current = pack();
    if (amount === null || current === null || !populated()) {
      return { status: 'unavailable', figure: null, receiptId: null, definition: null, coverage: null, gaps: [{ code: populated() ? 'MONTH_NOT_LOADED' : 'NO_SOURCE_READ', message: populated() ? 'This period has not been loaded yet.' : 'No source has been read yet.' }] };
    }
    const definitions = (dictionary()?.['definitions'] as Record<string, unknown>[] | undefined)?.filter(item => item['name'] === tile.operation) ?? [];
    return {
      status: partial ? 'partial' : 'available',
      figure: { key: 'total', label: text, minor: amount.minor, display: amount.display, unit: 'money', currency: 'INR' }, receiptId,
      definition: { dictionaryHash: current.dictionaryHash, ontologyVersion: current.version, definitionHash: fakeHash(`definition:${tile.operation}`), definitions, operationId: tile.operation, operationType: 'sum' },
      coverage: { selectedRows: 4, countedRows: 3, excludedRows: 1, unresolvedConflicts: 0, importIds: [IMPORT.id], completeness: partial ? 'partial' : 'reconciled-imports', gaps: partial ? ['One month is not loaded yet.'] : [] },
      gaps: partial ? [{ code: 'MONTH_NOT_LOADED', message: 'One month has not been loaded yet.' }] : [],
    };
  }
  async function prepareTiles(payload: Readonly<Record<string, unknown>>) {
    if (seat.role === 'viewer') throw fakeRefusal('TODAY_READ_ONLY', 'A viewer seat prepares nothing.');
    const shown = display(payload), current = pack();
    const request = payload['request'];
    if (current === null || !isRecord(request) || !Array.isArray(request['tiles'])) throw fakeRefusal('TODAY_CONFIGURATION_INVALID', 'The Today configuration is not valid.');
    if (await todayDigest(request) !== payload['configurationDigest'] || request['dictionaryHash'] !== current.dictionaryHash) throw fakeRefusal('TODAY_CONFIGURATION_INVALID', 'The Today configuration changed.');
    const tiles = (request['tiles'] as Record<string, unknown>[]).map(configured => {
      const fixture = TILES.find(tile => tile.id === configured['id']);
      if (fixture === undefined) throw fakeRefusal('TODAY_TILES_INVALID_REQUEST', 'An unknown tile was configured.');
      const buckets = configured['buckets'] as { id: string; label: string; period: { from: string; to: string } }[];
      const partial = fixture.buckets.some(bucket => bucket.value === null);
      return {
        id: fixture.id, label: configured['label'], operation: fixture.operation, figureKey: 'total', period: configured['period'],
        value: tileValue(fixture, fixture.total, String(configured['label']), receiptIdFor(fixture.id), partial),
        points: buckets.map(point => {
          const bucket = fixture.buckets.find(item => item.id === point.id);
          return { id: point.id, label: point.label, period: point.period, value: tileValue(fixture, bucket?.value ?? null, point.label, receiptIdFor(point.id)) };
        }),
      };
    });
    const id = `capture_demo_${captures.size + 1}`;
    const prepared = {
      reference: { id, digest: fakeHash(`capture:${id}:${shown.date}`) }, display: shown,
      configuration: { id: payload['configurationId'], digest: payload['configurationDigest'], starterPack: current, origin: 'custom' },
      result: { version: 1, asOf: request['asOf'], dictionary: { hash: current.dictionaryHash, version: current.version }, scope: request['scope'], atomic: false, verification: 'configured', tiles },
    };
    captures.set(id, prepared);
    return prepared;
  }
  function todayGet(payload: Readonly<Record<string, unknown>>) {
    const shown = display(payload);
    const capture = isRecord(payload['tileCapture']) ? captures.get(String(payload['tileCapture']['id'])) : undefined;
    if (isRecord(payload['tileCapture']) && capture === undefined) throw fakeRefusal('TODAY_CAPTURE_UNAVAILABLE', 'That capture is not held.');
    const review = queue(0, 3);
    return {
      kind: 'today-engine-v1', display: shown, atomic: false, noAction: true, starterPack: pack(),
      defaults: { state: 'unconfigured', reason: 'pack-defaults-not-configured' },
      state: { kind: 'partial', asOf: null, reasonCode: 'TODAY_ENGINE_CONTRACT_PARTIAL' }, productReviewCount: null,
      tiles: capture === undefined ? { state: 'unavailable', reason: 'capture-required' } : { state: 'prepared', value: capture },
      attention: attention(shown, review.rows.length),
      review: { state: 'available', value: review },
      dayEvents: populated()
        ? { state: 'available', value: { date: shown.date, timeZone: shown.timeZone, calendarRevision: null, events: dayEvents(shown.date), total: 4, state: { kind: 'complete', reasonCodes: [] } } }
        : { state: 'unavailable', reason: 'events-service-unavailable' },
    };
  }
  function resolveReview(payload: Readonly<Record<string, unknown>>) {
    const reference = payload['reference'];
    const action = isRecord(reference) ? ACTIONS.find(item => item.id === reference['id']) : undefined;
    if (!populated() || action === undefined) throw fakeRefusal('REVIEW_REFERENCE_UNAVAILABLE', 'That review row is not current.');
    return reviewRow(action, date);
  }
  function resolveAttention(payload: Readonly<Record<string, unknown>>) {
    const shown = display(payload), reference = payload['reference'];
    if (populated() && isRecord(reference) && reference['kind'] === 'decision') return dueDecision(shown.date);
    if (populated() && isRecord(reference) && reference['kind'] === 'alert-episode') return alertEpisode(shown.date);
    throw fakeRefusal('TODAY_ATTENTION_REFERENCE_UNAVAILABLE', 'That row is not current.');
  }
  function resolveEvent(payload: Readonly<Record<string, unknown>>) {
    const shown = display(payload);
    const event = populated() ? dayEvents(shown.date).find(item => item['id'] === payload['eventId']) : undefined;
    if (event === undefined) throw fakeRefusal('TODAY_EVENT_REFERENCE_UNAVAILABLE', 'That event is not current.');
    return event['reference'];
  }

  /* ------------------------------------------------------------ first run */
  async function ontologyGet(payload: Readonly<Record<string, unknown>>) {
    if (!Object.hasOwn(payload, 'attemptId')) return { current: ontology.current, history: ontology.history };
    if (seat.role !== 'owner' && seat.role !== 'cofounder') throw fakeRefusal('FORBIDDEN', 'Only an owner reads a publication attempt.');
    const found = typeof payload['attemptId'] === 'string' ? attempts.get(payload['attemptId']) : undefined;
    return { current: ontology.current, history: ontology.history, attempt: found?.receipt ?? null };
  }
  async function ontologyPublish(payload: Readonly<Record<string, unknown>>) {
    if (seat.role !== 'owner' && seat.role !== 'cofounder') throw fakeRefusal('ACCESS_DENIED', 'Only an owner publishes meanings.');
    const attemptId = payload['attemptId'], expected = payload['expectedCurrentHash'];
    if (Object.keys(payload).sort().join(',') !== 'attemptId,draft,expectedCurrentHash' || typeof attemptId !== 'string' || !(expected === null || typeof expected === 'string') || !isRecord(payload['draft'])) throw fakeRefusal('INVALID_DICTIONARY_OPTIONS', 'Use the exact publication envelope.');
    const draftDigest = await sha256Hex(JSON.stringify(payload['draft']));
    const previous = attempts.get(attemptId);
    if (previous !== undefined) {
      if (previous.receipt['draftDigest'] !== draftDigest || previous.receipt['expectedCurrentHash'] !== expected) throw fakeRefusal('DICTIONARY_ATTEMPT_REUSED', 'That attempt was used for a different draft.');
      return structuredClone(previous.dictionary);
    }
    if ((ontology.current?.['hash'] ?? null) !== expected) throw fakeRefusal('DICTIONARY_CONFLICT', 'The meanings changed meanwhile.');
    const compiled = await compileDictionary(payload['draft'], (Number(ontology.current?.['version'] ?? 0)) + 1, seat.id, `${date}T06:30:00.000Z`);
    ontology = { current: compiled, history: [...ontology.history, compiled] };
    attempts.set(attemptId, { dictionary: structuredClone(compiled), receipt: { attemptId, workspaceId: workspace.id, memberId: seat.id, epoch: 1, draftDigest, expectedCurrentHash: expected, dictionaryHash: compiled['hash'], version: compiled['version'] } });
    return compiled;
  }

  /* ------------------------------------------------------------ todayx */
  function clockSet(payload: Readonly<Record<string, unknown>>) {
    mutating();
    if (!workspace.demo || todayx.clock.mode === 'real') throw fakeRefusal('DEMO_CLOCK_REAL_WORKSPACE', 'A real workspace keeps the real clock.');
    if (todayx.clock.set) throw fakeRefusal('DEMO_CLOCK_ALREADY_SET', 'The demo clock was already set.');
    if (!isDate(payload['date']) || payload['date'] < date) throw fakeRefusal('INVALID_REQUEST', 'The clock never goes back.');
    date = payload['date']; todayx.clock = { mode: 'demo', date, set: true };
    return shellReply(scenario, todayx, workspace.demo, DEMO_OWNER.name);
  }
  function clockAdvance(payload: Readonly<Record<string, unknown>>) {
    mutating();
    if (!workspace.demo || todayx.clock.mode === 'real') throw fakeRefusal('DEMO_CLOCK_REAL_WORKSPACE', 'A real workspace keeps the real clock.');
    if (payload['by'] !== 'day' && payload['by'] !== 'week') throw fakeRefusal('INVALID_REQUEST', 'Advance by a day or a week.');
    date = addDays(date, payload['by'] === 'day' ? 1 : 7); todayx.clock = { ...todayx.clock, date };
    return shellReply(scenario, todayx, workspace.demo, DEMO_OWNER.name);
  }
  function identitySave(payload: Readonly<Record<string, unknown>>) {
    mutating();
    const fields = payload['fields'], gstMode = payload['gstMode'];
    if (!isRecord(fields) || !(gstMode === null || gstMode === 'regular' || gstMode === 'composition' || gstMode === 'not-registered')) throw fakeRefusal('IDENTITY_INVALID', 'The identity card is not valid.');
    const checked = identityCheck(fields);
    if (Object.values(checked.fields).some(result => !result.ok)) throw fakeRefusal('IDENTITY_INVALID', 'A field has a format problem.');
    const saved: Partial<Record<IdentityField, string>> = {};
    for (const field of IDENTITY_FIELDS) { const value = fields[field]; if (typeof value === 'string') saved[field] = value.trim().toUpperCase(); }
    identity = { fields: saved, gstMode, savedAt: `${date}T06:00:00.000Z` };
    return identity;
  }

  const handlers: Readonly<Record<string, FakeHandler>> = {
    'ui.context': () => uiContext(),
    'models.list': () => (populated() ? [{ ...DEMO_ROUTE }] : []),
    'workspace.lock': () => { mutating(); unlocked = false; return { locked: true }; },
    'workspace.open': payload => {
      if (unlocked) throw fakeRefusal('VAULT_OPEN', 'Lock the current workspace first.');
      if (payload['passphrase'] !== FAKE_PASSPHRASE) throw fakeRefusal('UNLOCK_FAILED', 'Unable to unlock vault.');
      unlocked = true; return { workspace: { ...workspace } };
    },
    'workspace.create': payload => {
      if (unlocked) throw fakeRefusal('ACCESS_DENIED', 'A workspace is already open.');
      if (typeof payload['name'] !== 'string' || payload['name'].trim().length < 2 || payload['dictionaryMode'] !== 'deferred') throw fakeRefusal('INVALID_DICTIONARY_MODE', 'Create a deferred workspace.');
      workspace = { id: 'workspace_demo_created', name: payload['name'].trim().slice(0, 100), demo: false };
      todayx.clock = { mode: 'real' }; unlocked = true; ontology = { current: null, history: [] };
      const kit = `DEMO-KIT-${fakeHash('kit').slice(0, 24).toUpperCase()}`;
      return { workspace: { ...workspace, demo: false }, recoveryKit: kit, recoveryCode: kit };
    },
    'ontology.packs': () => starterPacks(),
    'ontology.get': payload => ontologyGet(payload),
    'ontology.publish': payload => ontologyPublish(payload),
    'receipts.get': payload => {
      const id = String(payload['id']), current = pack();
      const receipt = populated() && current !== null ? receiptFor(id, current.dictionaryHash, seat.id, `${date}T06:00:00.000Z`) : null;
      if (receipt === null) throw fakeRefusal('RECEIPT_NOT_FOUND', 'No receipt has that id.');
      return receipt;
    },
    'today.get': payload => todayGet(payload),
    'today.prepareTiles': payload => prepareTiles(payload),
    'today.review': payload => {
      const limit = typeof payload['limit'] === 'number' ? payload['limit'] : 4;
      const match = typeof payload['cursor'] === 'string' ? /^review_after_(\d+)$/.exec(payload['cursor']) : null;
      if (typeof payload['cursor'] === 'string' && match === null) throw fakeRefusal('INVALID_REVIEW_PAGE', 'That cursor is not current.');
      return queue(match ? Number(match[1]) : 0, limit);
    },
    'today.resolveReview': payload => resolveReview(payload),
    'today.resolveAttention': payload => resolveAttention(payload),
    'today.resolveEvent': payload => resolveEvent(payload),
    'actions.list': () => (populated() ? ACTIONS.map(action => actionRecord(action, date)) : []),
    'jobs.list': () => [],
    'decisions.list': () => (populated() ? [decisionRecord()] : []),
    'sources.list': () => (populated() ? [importRecord(date)] : []),
    'learning.list': () => [],
    'activity.list': () => ({ items: populated() ? dayEvents(date).map(event => ({ id: event['id'], kind: event['kind'], at: event['at'] })) : [], modelReceipts: [] }),
    'memory.lessons': () => [],
    'scenarios.discover': () => ({ mode: 'retained-revisions', items: [], nextCursor: null, noAction: true }),
    'todayx.shell': () => shellReply(scenario, todayx, workspace.demo, DEMO_OWNER.name),
    'todayx.clock.set': payload => clockSet(payload),
    'todayx.clock.advance': payload => clockAdvance(payload),
    'todayx.jobsPaused.dismiss': () => { mutating(); todayx.jobsPaused = false; return shellReply(scenario, todayx, workspace.demo, DEMO_OWNER.name); },
    'todayx.status': () => statusReply(scenario, date),
    'todayx.capabilities': () => capabilitiesReply(),
    'todayx.worthALook': () => worthReply(scenario, date),
    'todayx.activity': payload => activityReply(scenario, date, payload),
    'todayx.firstRun.status': () => firstRunStatusReply(scenario, ontology.current !== null),
    'todayx.identity.check': payload => identityCheck(isRecord(payload['fields']) ? payload['fields'] : {}),
    'todayx.identity.save': payload => identitySave(payload),
    'todayx.identity.get': () => identity,
    'todayx.setupChecklist': () => checklistReply(scenario),
    'todayx.help': () => helpReply(),
    'todayx.faultReport': () => faultReport(date),
    'todayx.phoneMessages': () => phoneMessagesReply(scenario),
    'todayx.idea.start': () => { mutating(); return idea.start(`${date}T06:00:00.000Z`); },
    'todayx.idea.get': () => idea.get(),
    'todayx.idea.tell': payload => { mutating(); return idea.tell(payload, `${date}T06:00:00.000Z`); },
    'todayx.idea.correct': payload => { mutating(); return idea.correct(payload, `${date}T06:00:00.000Z`); },
    'todayx.diskCheck': () => ({ disk: 'not-encrypted', platform: 'windows', keyring: 'safe' }),
    'todayx.device.get': () => device,
    'todayx.device.set': payload => {
      const { language, view } = payload;
      if (Object.keys(payload).length !== 2 || (language !== 'en' && language !== 'hi') || (view !== 'simple' && view !== 'guided' && view !== 'books')) throw fakeRefusal('INVALID_TODAYX_REQUEST', 'Give a language and a view.');
      device = { language, view, saved: true };
      return device;
    },
    // Folder names only; the locked scenario has two, so the lock screen asks which.
    'todayx.workspaces': () => ({ folders: scenario === 'locked' ? [{ folder: 'main', main: true }, { folder: 'second-shop', main: false }] : [{ folder: 'main', main: true }] }),
    'todayx.recoveryContact.get': () => { if (seat.role !== 'owner') throw fakeRefusal('FORBIDDEN', 'Only an owner sees the recovery contact.'); return { contact: recoveryContact, confirmation: 'relay-required' }; },
    'todayx.recoveryContact.set': payload => {
      if (seat.role !== 'owner') throw fakeRefusal('FORBIDDEN', 'Only an owner names the recovery contact.');
      const contact = payload['contact'];
      if (contact === null) recoveryContact = null;
      else if (isRecord(contact) && typeof contact['name'] === 'string' && typeof contact['reach'] === 'string' && contact['name'].trim() && contact['reach'].trim() && contact['name'].length <= 100 && contact['reach'].length <= 200) {
        recoveryContact = { name: contact['name'].trim(), reach: contact['reach'].trim(), savedAt: `${date}T06:00:00.000Z` };
      } else throw fakeRefusal('RECOVERY_CONTACT_INVALID', 'Give a name and how to reach them.');
      return { contact: recoveryContact, confirmation: 'relay-required' };
    },
    'todayx.recoveryContact.request': () => { throw fakeRefusal('RECOVERY_CONTACT_RELAY_REQUIRED', 'A recovery contact needs the hosted relay, which is not available yet.'); },
  };

  async function request(method: string, payload: unknown = {}): Promise<unknown> {
    calls.push(method);
    await ready;
    if (typeof method !== 'string' || !isRecord(payload)) throw fakeRefusal('INVALID_REQUEST', 'A request is a method name and a plain payload.');
    const handler = handlers[method] ?? registry.get(method);
    if (handler === undefined) throw fakeRefusal('UNKNOWN_METHOD', 'The fake engine does not serve this method yet.');
    if (!unlocked && method !== 'ui.context' && method !== 'workspace.create' && method !== 'workspace.open' && !FAKE_PRE_VAULT.includes(method)) throw fakeRefusal('VAULT_LOCKED', 'The vault is locked.');
    const value = await handler(structuredClone(payload), context());
    return value === undefined ? undefined : structuredClone(value);
  }

  async function todayProducer(): Promise<TodayProducerInput> {
    await ready;
    const shown = { date, timeZone: DEMO_TIME_ZONE };
    const current = pack();
    if (current === null) return { display: shown };
    const request: TodayTilesRequest = {
      dictionaryHash: current.dictionaryHash, asOf: `${date}T06:00:00.000Z`, scope: { sourceIds: [...DEMO_SOURCES], branch: null },
      tiles: TILES.map(tile => ({
        id: tile.id, label: label(tile.label, language), operation: tile.operation, figureKey: 'total', period: { from: tile.from, to: tile.to },
        buckets: tile.buckets.map(bucket => ({ id: bucket.id, label: label(bucket.label, language), period: { from: bucket.from, to: bucket.to } })),
      })),
    };
    const configuration: TodayConfiguration = { configurationId: 'today_config_demo', configurationDigest: await todayDigest(request), starterPack: current, request };
    const charts = TILES.map(tile => {
      const first = tile.buckets[0], last = tile.buckets[tile.buckets.length - 1];
      return { tileId: tile.id, form: tile.form, sentence: label(tile.sentence, language), ...(tile.form === 'line' && first && last ? { from: label(first.label, language), to: label(last.label, language) } : {}) };
    });
    return { display: shown, configuration, charts };
  }

  return Object.freeze({
    request, scenario, language, calls, todayProducer,
    date: () => date,
    methods: () => [...Object.keys(handlers), ...registry.keys()].sort(),
  });
}
