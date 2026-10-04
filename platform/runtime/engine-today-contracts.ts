import type { Context } from './contracts.ts';
import type { TodayTilesRequest, TodayTilesResult } from './today-tiles-contracts.ts';
import type { AttentionAlertEpisode, AttentionDueDecision, AttentionCalendarRow, AttentionCalendar, TodayAttention } from './today-attention.ts';
import type { TodayDayEvents, TodayDayEvent, TodayEventsRequest } from './today-events.ts';
import type { TodayReviewPageRequest, TodayReviewQueue, TodayReviewReference, TodayReviewRow } from './today-review.ts';

export type TodayDisplay = { date: string; timeZone: string };
export type TodayTileCaptureReference = { id: string; digest: string };
export type TodayStarterPackBinding = { id: string; dictionaryHash: string; version: number };
export type TodayPrepareTilesRequest = TodayDisplay & {
  configurationId: string; configurationDigest: string; starterPack: TodayStarterPackBinding; request: TodayTilesRequest;
};
export type TodayPreparedTiles = {
  reference: TodayTileCaptureReference; display: TodayDisplay;
  configuration: { id: string; digest: string; starterPack: TodayStarterPackBinding; origin: 'custom' }; result: TodayTilesResult;
};
export type EngineTodayGetRequest = TodayDisplay & { tileCapture?: TodayTileCaptureReference };
export type TodayAttentionRowReference = AttentionAlertEpisode['reference'] | AttentionDueDecision['reference'] | AttentionCalendarRow['reference'];
export type TodayAttentionReference = TodayAttentionRowReference | Extract<AttentionCalendar, { state: 'reviewed' }>['reference'];
export type TodayAttentionRow =
  | { id: string; kind: 'alert-episode'; value: AttentionAlertEpisode }
  | { id: string; kind: 'due-decision'; value: AttentionDueDecision }
  | { id: string; kind: 'compliance-entry'; value: AttentionCalendarRow };
/** Trusted installed configuration. It selects exact already-authorized references only.
 * Its live revision and all outside-State guards must be covered by the host generation. */
export type TodayAttentionSelectionPolicy = {
  id: string; revision(): string;
  select(context: Context, projection: TodayAttention): readonly TodayAttentionRowReference[];
};
export type TodayAttentionSelection =
  | { state: 'unavailable'; reason: 'selection-policy-required'; rows: [] }
  | { state: 'configured'; policyId: string; policyRevision: string; eligibleCount: number; rows: TodayAttentionRow[] };
export type EngineTodayResponse = {
  kind: 'today-engine-v1'; display: TodayDisplay; atomic: false; noAction: true;
  starterPack: TodayStarterPackBinding | null;
  defaults: { state: 'unconfigured'; reason: 'pack-defaults-not-configured' };
  state: { kind: 'partial'; asOf: null; reasonCode: 'TODAY_ENGINE_CONTRACT_PARTIAL' };
  /** The supported scoped review producer does not establish a whole-app total. */
  productReviewCount: null;
  tiles: { state: 'prepared'; value: TodayPreparedTiles }
    | { state: 'unavailable'; reason: 'capture-required' | 'tiles-service-unavailable' };
  attention: { state: 'available'; value: TodayAttention; selection: TodayAttentionSelection }
    | { state: 'unavailable'; reason: 'attention-service-unavailable' | 'attention-guards-required' };
  review: { state: 'available'; value: TodayReviewQueue }
    | { state: 'unavailable'; reason: 'review-service-unavailable' };
  dayEvents: { state: 'available'; value: TodayDayEvents }
    | { state: 'unavailable'; reason: 'events-service-unavailable' };
};
export type TodayAttentionResolveRequest = TodayDisplay & { reference: TodayAttentionReference };
export type TodayAttentionResolved = AttentionAlertEpisode | AttentionDueDecision | AttentionCalendarRow | Extract<AttentionCalendar, { state: 'reviewed' }>;
export type EngineTodayMethods = {
  prepareTiles(context: Context, request: TodayPrepareTilesRequest): Promise<TodayPreparedTiles>;
  get(context: Context, request: EngineTodayGetRequest): EngineTodayResponse;
  review(context: Context, request?: TodayReviewPageRequest): TodayReviewQueue;
  resolveReview(context: Context, reference: TodayReviewReference): TodayReviewRow;
  resolveEvent(context: Context, request: TodayEventsRequest & { eventId: string }): TodayDayEvent['reference'];
  resolveAttention(context: Context, request: TodayAttentionResolveRequest): TodayAttentionResolved;
};
