import { authorize, check, ChausarError, hash, newId, type Context, type StateStore } from './contracts.ts';
import { canonical } from './actions.ts';
import { validDate } from './memory.ts';
import { OntologyService } from './ontology.ts';
import { TodayTilesService } from './today-tiles.ts';
import type { TodayTilesResult } from './today-tiles-contracts.ts';
import { TodayAttentionService, type TodayAttention } from './today-attention.ts';
import { TodayEventsService, type TodayEventsRequest } from './today-events.ts';
import { TodayReviewService, type TodayReviewPageRequest, type TodayReviewReference } from './today-review.ts';
import type { EngineTodayMethods, EngineTodayGetRequest, EngineTodayResponse, TodayPrepareTilesRequest, TodayPreparedTiles,
  TodayDisplay, TodayAttentionResolveRequest, TodayAttentionSelectionPolicy, TodayAttentionSelection, TodayAttentionRow,
  TodayAttentionResolved, TodayAttentionReference, TodayStarterPackBinding } from './engine-today-contracts.ts';

export type EngineTodayOptions = {
  store: StateStore; tiles?: TodayTilesService; attention?: TodayAttentionService;
  events?: TodayEventsService; review?: TodayReviewService;
  /** Pure synchronous live generation covering ALL installed outside-State read authority.
   * Supplied by the trusted host, never accepted from an RPC caller. */
  authorityRevision(): string;
  selection?: TodayAttentionSelectionPolicy;
};
type Authority = { generation: string; selectionRevision: string | null };
type Stamp = Authority & { state: string };
type Capture = { context: string; workspaceId: string; authority: Authority; held: TodayTilesResult; publicValue: TodayPreparedTiles };
const plain = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object'
  && Object.getPrototypeOf(value) === Object.prototype;
const keys = (value: unknown, required: string[], optional: string[] = []) => plain(value)
  && required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => [...required, ...optional].includes(key));
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,200}$/.test(value);
const opaqueIdentity = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const digest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const same = (left: unknown, right: unknown) => canonical(left) === canonical(right);
const contextKey = (ctx: Context) => hash({ memberId: ctx.memberId, role: ctx.role, epoch: ctx.epoch,
  channel: ctx.channel ?? null, sourceTainted: ctx.sourceTainted ?? null });
function display(input: TodayDisplay): TodayDisplay {
  check(validDate(input.date) && typeof input.timeZone === 'string' && input.timeZone.length <= 100
    && /^[A-Za-z][A-Za-z0-9_+.-]*(?:\/[A-Za-z0-9_+.-]+)*$/.test(input.timeZone),
  'TODAY_INVALID_REQUEST', 'Supply a valid explicit displayed date and named timezone.');
  try { new Intl.DateTimeFormat('en', { timeZone: input.timeZone }); }
  catch { check(false, 'TODAY_INVALID_REQUEST', 'Supply a supported explicit named timezone.'); }
  return { date: input.date, timeZone: input.timeZone };
}
function attentionReference(input: unknown): asserts input is TodayAttentionReference {
  const invalid = () => check(false, 'TODAY_ATTENTION_REFERENCE_UNAVAILABLE', 'Choose an exact retained attention reference.');
  if (!plain(input)) return invalid();
  const required = input.kind === 'alert-episode' ? ['kind', 'alertId', 'episodeId']
    : input.kind === 'decision' ? ['kind', 'decisionId']
      : input.kind === 'compliance-entry' ? ['kind', 'calendarId', 'entryId']
        : input.kind === 'reviewed-compliance-calendar' ? ['kind', 'calendarId', 'version'] : null;
  const validIdentity = input.kind === 'compliance-entry' || input.kind === 'reviewed-compliance-calendar' ? opaqueIdentity : identifier;
  if (!required || !keys(input, required) || !required.filter(key => key !== 'kind').every(key => validIdentity(input[key]))) invalid();
}
function attentionRows(value: TodayAttention): TodayAttentionRow[] {
  return [...value.alertEpisodes.map(item => ({ id: hash(canonical(item.reference)), kind: 'alert-episode' as const, value: item })),
    ...value.dueDecisions.map(item => ({ id: hash(canonical(item.reference)), kind: 'due-decision' as const, value: item })),
    ...value.calendar.rows.map(item => ({ id: hash(canonical(item.reference)), kind: 'compliance-entry' as const, value: item }))];
}

/** Coherent current read over installed domain services. Only prepareTiles publishes
 * receipts. Captures and authentic issued values remain private to this runtime. */
export class EngineTodayService implements EngineTodayMethods {
  readonly #options: EngineTodayOptions;
  readonly #captures = new Map<string, Capture>();
  constructor(options: EngineTodayOptions) {
    check(options && typeof options.store?.read === 'function' && typeof options.store?.update === 'function'
      && typeof options.authorityRevision === 'function', 'TODAY_AUTHORITY_REQUIRED', 'Install a real store and a pure current host authority generation.');
    check(!options.tiles || options.tiles instanceof TodayTilesService, 'TODAY_SERVICE_REQUIRED', 'Install the real Today tiles service.');
    check(!options.attention || options.attention instanceof TodayAttentionService, 'TODAY_SERVICE_REQUIRED', 'Install the real Today attention service.');
    check(!options.events || options.events instanceof TodayEventsService, 'TODAY_SERVICE_REQUIRED', 'Install the real Today events service.');
    check(!options.review || options.review instanceof TodayReviewService, 'TODAY_SERVICE_REQUIRED', 'Install the persistent real Today review service.');
    check(!options.selection || identifier(options.selection.id) && typeof options.selection.revision === 'function'
      && typeof options.selection.select === 'function', 'TODAY_SELECTION_POLICY_REQUIRED', 'Install an explicit current attention selection policy.');
    this.#options = { ...options, ...(options.selection ? { selection: { id: options.selection.id,
      revision: options.selection.revision.bind(options.selection), select: options.selection.select.bind(options.selection) } } : {}) };
    this.#bindings();
  }
  #bindings() {
    const { store, tiles, attention, events, review } = this.#options;
    check((!tiles || tiles.calculator.store === store) && (!attention || attention.store === store)
      && (!events || events.authorityStore === store) && (!review || review.authorityStore === store),
    'TODAY_AUTHORITY_STORE_MISMATCH', 'Every Today producer must use this exact current workspace store.');
  }
  #authority(): Authority {
    const token = (get: () => string) => {
      let value: unknown;
      try { value = get(); } catch { throw new ChausarError('TODAY_AUTHORITY_UNAVAILABLE', 'The installed current Today authority is unavailable.'); }
      check(typeof value === 'string' && value.trim().length > 0 && value.length <= 4096,
        'TODAY_AUTHORITY_UNAVAILABLE', 'The installed current Today authority needs a bounded synchronous live generation.');
      return value;
    };
    // Read policy callbacks first. The host's final generation must cover their
    // outside-State authority and may close over the real connector generation.
    const selectionRevision = this.#options.selection ? token(this.#options.selection.revision) : null;
    return { generation: token(this.#options.authorityRevision), selectionRevision };
  }
  #starterPack(ctx: Context): TodayStarterPackBinding | null {
    const current = new OntologyService(this.#options.store).current(ctx);
    if (!current) return null;
    check(opaqueIdentity(current.pack) && digest(current.hash) && Number.isSafeInteger(current.version) && current.version >= 1,
      'TODAY_CONFIGURATION_INVALID', 'Today requires an identified current published starter pack.');
    return { id: current.pack, dictionaryHash: current.hash, version: current.version };
  }
  #stamp(ctx: Context): Stamp {
    this.#bindings(); authorize(this.#options.store, ctx);
    const before = hash(this.#options.store.read()), authority = this.#authority(), after = hash(this.#options.store.read());
    authorize(this.#options.store, ctx);
    check(before === after, 'TODAY_AUTHORITY_CHANGED', 'Today host generation getters must not alter current State. Read again.');
    return { ...authority, state: after };
  }
  #fence(ctx: Context, stamp: Stamp) {
    check(same(this.#stamp(ctx), stamp), 'TODAY_AUTHORITY_CHANGED', 'Current Today evidence or host authority changed during assembly. Read again.');
  }
  #attentionReady(): boolean {
    const service = this.#options.attention;
    if (!service || typeof service.options.alertsOptions !== 'function' || typeof service.options.reportOptions !== 'function') return false;
    const state = structuredClone(this.#options.store.read());
    const view: StateStore = { read: () => structuredClone(state), update: async () => { throw new ChausarError('TODAY_READ_ONLY', 'Today authority views are read-only.'); } };
    const alerts = service.options.alertsOptions(view), reports = service.options.reportOptions(view);
    const calculator = alerts?.calculatorOptions ? alerts.calculatorOptions(view) : alerts;
    return typeof calculator?.consumerGuard === 'function' && typeof calculator?.receiptGuard === 'function'
      && typeof reports?.consumerGuard === 'function' && typeof reports?.receiptGuard === 'function';
  }
  #tiles(ctx: Context, input: EngineTodayGetRequest, authority: Authority): EngineTodayResponse['tiles'] {
    if (!input.tileCapture) return { state: 'unavailable', reason: this.#options.tiles ? 'capture-required' : 'tiles-service-unavailable' };
    const capture = this.#captures.get(input.tileCapture.id);
    check(this.#options.tiles && capture && capture.publicValue.reference.digest === input.tileCapture.digest
      && capture.context === contextKey(ctx) && capture.workspaceId === this.#options.store.read().workspace.id
      && same(capture.publicValue.display, display(input)), 'TODAY_CAPTURE_UNAVAILABLE', 'Prepare an exact tile capture for this current workspace, member context and display.');
    const result = this.#options.tiles.release(ctx, capture.held);
    check(same(capture.authority, { generation: authority.generation, selectionRevision: authority.selectionRevision }),
      'TODAY_CAPTURE_UNAVAILABLE', 'The tile capture host authority changed. Prepare a fresh capture.');
    check(hash(result) === hash(capture.publicValue.result), 'TODAY_CAPTURE_UNAVAILABLE', 'Prepared tile evidence changed. Prepare a fresh capture.');
    return { state: 'prepared', value: structuredClone(capture.publicValue) };
  }
  #selection(ctx: Context, value: TodayAttention, reviewRows: number, revision: string | null): TodayAttentionSelection {
    const policy = this.#options.selection;
    if (!policy) return { state: 'unavailable', reason: 'selection-policy-required', rows: [] };
    const references = policy.select(structuredClone(ctx), structuredClone(value)), rows = attentionRows(value);
    check(Array.isArray(references) && references.length <= rows.length,
      'TODAY_SELECTION_INVALID', 'The installed selection policy must return bounded exact authorized references.');
    const selected: TodayAttentionRow[] = [], seen = new Set<string>();
    for (const reference of references) {
      attentionReference(reference);
      const key = canonical(reference), row = rows.find(item => canonical(item.value.reference) === key);
      check(row && !seen.has(key), 'TODAY_SELECTION_INVALID', 'The installed selection policy returned an unknown or duplicate attention reference.');
      seen.add(key); selected.push(row);
    }
    return { state: 'configured', policyId: policy.id, policyRevision: revision!, eligibleCount: selected.length,
      rows: structuredClone(selected.slice(0, Math.max(0, 5 - reviewRows))) };
  }
  async prepareTiles(ctx: Context, input: TodayPrepareTilesRequest): Promise<TodayPreparedTiles> {
    check(keys(input, ['date', 'timeZone', 'configurationId', 'configurationDigest', 'request', 'starterPack']) && identifier(input.configurationId)
      && digest(input.configurationDigest) && plain(input.request) && input.configurationDigest === hash(input.request)
      && keys(input.starterPack, ['id', 'dictionaryHash', 'version']) && opaqueIdentity(input.starterPack.id)
      && digest(input.starterPack.dictionaryHash) && Number.isSafeInteger(input.starterPack.version) && input.starterPack.version >= 1
      && Array.isArray(input.request.tiles) && input.request.tiles.length === 3
      && input.request.tiles.every(tile => plain(tile) && Array.isArray(tile.buckets) && tile.buckets.length <= 120),
    'TODAY_CONFIGURATION_INVALID', 'Supply an explicit identified three-tile configuration with at most 120 explicit buckets per tile.');
    const supplied = structuredClone(input), shown = display(supplied); ctx = structuredClone(ctx);
    this.#bindings(); authorize(this.#options.store, ctx, 'prepare');
    check(ctx.channel === 'desktop' && !ctx.sourceTainted, 'TODAY_PREPARATION_FORBIDDEN', 'Prepare displayed tiles in the current untainted desktop Engine.');
    const tiles = this.#options.tiles;
    check(tiles, 'TODAY_TILES_SERVICE_UNAVAILABLE', 'Install the guarded Today tiles service before explicit preparation.');
    const authority = this.#stamp(ctx), starterPack = this.#starterPack(ctx);
    check(starterPack && same(starterPack, supplied.starterPack) && supplied.request.dictionaryHash === starterPack.dictionaryHash,
      'TODAY_CONFIGURATION_INVALID', 'Bind custom tiles to the exact current published starter pack, dictionary hash and version.');
    const held = await tiles.build(ctx, supplied.request), current = this.#stamp(ctx);
    // Preparation legitimately adds receipts/activity; its host generation still
    // has to survive the awaited work unchanged.
    check(same({ generation: current.generation, selectionRevision: current.selectionRevision },
      { generation: authority.generation, selectionRevision: authority.selectionRevision }),
    'TODAY_AUTHORITY_CHANGED', 'Today host authority changed while preparing tiles. Prepare again.');
    const result = tiles.release(ctx, held); this.#fence(ctx, current);
    const id = newId('today_tiles'), configuration = { id: supplied.configurationId, digest: supplied.configurationDigest, starterPack, origin: 'custom' as const };
    const body = { display: shown, configuration, result };
    const publicValue: TodayPreparedTiles = { reference: { id, digest: hash({ id, context: contextKey(ctx), workspaceId: this.#options.store.read().workspace.id,
      request: supplied.request, ...body }) }, ...body };
    this.#captures.set(id, { context: contextKey(ctx), workspaceId: this.#options.store.read().workspace.id,
      authority: { generation: current.generation, selectionRevision: current.selectionRevision }, held, publicValue: structuredClone(publicValue) });
    if (this.#captures.size > 64) this.#captures.delete(this.#captures.keys().next().value!);
    return structuredClone(publicValue);
  }
  get(ctx: Context, input: EngineTodayGetRequest): EngineTodayResponse {
    check(keys(input, ['date', 'timeZone'], ['tileCapture']) && (input.tileCapture === undefined
      || keys(input.tileCapture, ['id', 'digest']) && identifier(input.tileCapture.id) && digest(input.tileCapture.digest)),
    'TODAY_INVALID_REQUEST', 'Supply only display scope and an optional exact private capture reference.');
    const supplied = structuredClone(input), shown = display(supplied); ctx = structuredClone(ctx);
    const stamp = this.#stamp(ctx), starterPack = this.#starterPack(ctx), tiles = this.#tiles(ctx, supplied, stamp);
    const attentionService = this.#options.attention, reviewService = this.#options.review, eventsService = this.#options.events;
    const attention = attentionService && this.#attentionReady() ? attentionService.read(ctx, { displayedDate: shown.date, timeZone: shown.timeZone }) : null;
    const review = reviewService?.list(ctx, { limit: 4 }), events = eventsService?.day(ctx, shown);
    const selection = attention ? this.#selection(ctx, attention, review?.rows.length ?? 0, stamp.selectionRevision) : null;
    // Keep actual private issued objects for release; never pass renderer DTOs.
    const renewedAttention = attention ? attentionService!.assertCurrent(ctx, attention) : null;
    const renewedReview = review ? reviewService!.list(ctx, { limit: 4 }) : null;
    check(!review || hash(review) === hash(renewedReview), 'TODAY_AUTHORITY_CHANGED', 'The exact initial review set changed during Today assembly. Read again.');
    const renewedEvents = events ? eventsService!.release(ctx, events) : null;
    check(!events || hash(events) === hash(renewedEvents), 'TODAY_AUTHORITY_CHANGED', 'The exact displayed event set changed during Today assembly. Read again.');
    // Tile retention is time-dependent even when State is unchanged. Perform
    // its final release after the later domain callbacks, before the pure fence.
    const renewedTiles = tiles.state === 'prepared' ? this.#tiles(ctx, supplied, stamp) : tiles;
    this.#fence(ctx, stamp);
    return structuredClone({ kind: 'today-engine-v1', display: shown, atomic: false, noAction: true,
      starterPack, defaults: { state: 'unconfigured', reason: 'pack-defaults-not-configured' },
      state: { kind: 'partial', asOf: null, reasonCode: 'TODAY_ENGINE_CONTRACT_PARTIAL' }, productReviewCount: null,
      tiles: renewedTiles,
      attention: renewedAttention ? { state: 'available', value: renewedAttention, selection: selection! }
        : { state: 'unavailable', reason: attentionService ? 'attention-guards-required' : 'attention-service-unavailable' },
      review: renewedReview ? { state: 'available', value: renewedReview } : { state: 'unavailable', reason: 'review-service-unavailable' },
      dayEvents: renewedEvents ? { state: 'available', value: renewedEvents } : { state: 'unavailable', reason: 'events-service-unavailable' },
    } satisfies EngineTodayResponse);
  }
  review(ctx: Context, request: TodayReviewPageRequest = {}): ReturnType<EngineTodayMethods['review']> {
    ctx = structuredClone(ctx); const stamp = this.#stamp(ctx), service = this.#options.review;
    check(service, 'TODAY_REVIEW_SERVICE_UNAVAILABLE', 'Install the persistent real Today review service.');
    const supplied = structuredClone(request), first = service.list(ctx, supplied), renewed = service.list(ctx, supplied);
    check(hash(first) === hash(renewed), 'TODAY_AUTHORITY_CHANGED', 'Review authority changed during release. Read again.');
    this.#fence(ctx, stamp); return structuredClone(renewed);
  }
  resolveReview(ctx: Context, reference: TodayReviewReference): ReturnType<EngineTodayMethods['resolveReview']> {
    ctx = structuredClone(ctx); const stamp = this.#stamp(ctx), service = this.#options.review;
    check(service, 'TODAY_REVIEW_SERVICE_UNAVAILABLE', 'Install the persistent real Today review service.');
    const supplied = structuredClone(reference), first = service.resolve(ctx, supplied), renewed = service.resolve(ctx, supplied);
    check(hash(first) === hash(renewed), 'TODAY_AUTHORITY_CHANGED', 'The exact review request changed during release. Read again.');
    this.#fence(ctx, stamp); return structuredClone(renewed);
  }
  resolveEvent(ctx: Context, input: TodayEventsRequest & { eventId: string }): ReturnType<EngineTodayMethods['resolveEvent']> {
    check(keys(input, ['date', 'timeZone', 'eventId']) && identifier(input.eventId), 'TODAY_INVALID_REQUEST', 'Resolve a retained event ID in its explicit displayed scope.');
    const supplied = structuredClone(input); display(supplied); ctx = structuredClone(ctx);
    const stamp = this.#stamp(ctx), service = this.#options.events;
    check(service, 'TODAY_EVENTS_SERVICE_UNAVAILABLE', 'Install the real Today event service.');
    const first = service.resolveReference(ctx, supplied), renewed = service.resolveReference(ctx, supplied);
    check(hash(first) === hash(renewed), 'TODAY_AUTHORITY_CHANGED', 'The exact event reference changed during release. Read again.');
    this.#fence(ctx, stamp); return structuredClone(renewed);
  }
  resolveAttention(ctx: Context, input: TodayAttentionResolveRequest): TodayAttentionResolved {
    check(keys(input, ['date', 'timeZone', 'reference']), 'TODAY_INVALID_REQUEST', 'Resolve an exact attention reference in its explicit displayed scope.');
    attentionReference(input.reference);
    const supplied = structuredClone(input), shown = display(supplied); ctx = structuredClone(ctx);
    const stamp = this.#stamp(ctx), service = this.#options.attention;
    check(service && this.#attentionReady(), 'TODAY_ATTENTION_SERVICE_UNAVAILABLE', 'Install the guarded real Today attention service.');
    const held = service.read(ctx, { displayedDate: shown.date, timeZone: shown.timeZone }), current = service.assertCurrent(ctx, held);
    const row: TodayAttentionResolved | undefined = supplied.reference.kind === 'reviewed-compliance-calendar'
      ? current.calendar.state === 'reviewed' && same(current.calendar.reference, supplied.reference) ? current.calendar : undefined
      : attentionRows(current).find(item => same(item.value.reference, supplied.reference))?.value;
    check(row, 'TODAY_ATTENTION_REFERENCE_UNAVAILABLE', 'This exact retained attention reference is unavailable under current authority.');
    this.#fence(ctx, stamp); return structuredClone(row);
  }
}
