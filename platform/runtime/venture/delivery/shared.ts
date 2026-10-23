// Chausar venture launcher, delivery package (P5): small read helpers shared by the delivery files.
// Reads only. Every write in this package goes through ventureAction in records.ts.
import { authorize, check, type Context, type State } from '../../contracts.ts';
import { findRecord, listRecords, requireVenture, type Permission } from '../records.ts';
import { ownerToday } from '../local-day.ts';
import type {
  BlueprintRecord, PlaybookRecord, PriceReceiptRecord, ServiceType, VentureDeps, VentureRecord,
} from '../contracts.ts';

/** Authorizes at the given level, then returns a snapshot and the current venture. */
export function readAs(deps: VentureDeps, ctx: Context, level: Permission): { state: State; venture: VentureRecord } {
  authorize(deps.store, ctx, level);
  const state = deps.store.read();
  return { state, venture: requireVenture(state) };
}

export function acceptedBlueprintOrNull(state: State, venture: VentureRecord): BlueprintRecord | null {
  if (!venture.acceptedBlueprintId) return null;
  const blueprint = findRecord(state, 'venture-blueprint', venture.acceptedBlueprintId);
  return blueprint && blueprint.ventureId === venture.id && blueprint.status === 'accepted' ? blueprint : null;
}

export function acceptedBlueprint(state: State, venture: VentureRecord): BlueprintRecord {
  const blueprint = acceptedBlueprintOrNull(state, venture);
  check(blueprint, 'BLUEPRINT_NOT_ACCEPTED', 'Accept your plan first.');
  return blueprint;
}

/** The service type the delivery package works with: the accepted plan's, else the one the interview guessed. */
export function serviceTypeOf(state: State, venture: VentureRecord): ServiceType {
  return acceptedBlueprintOrNull(state, venture)?.serviceType ?? venture.serviceType ?? 'other';
}

export function latestPlaybook(state: State, ventureId: string): PlaybookRecord | null {
  const all = listRecords(state, 'venture-playbook', ventureId);
  let latest: PlaybookRecord | null = null;
  for (const playbook of all) if (!latest || playbook.version >= latest.version) latest = playbook;
  return latest;
}

/** Every price receipt of this venture. */
export function ventureReceipts(state: State, ventureId: string): PriceReceiptRecord[] {
  return listRecords(state, 'venture-price-receipt', ventureId);
}

/** The newest receipt for an offer that was priced on this exact blueprint digest (the same rule as the plan's offerReceipts). */
export function currentOfferReceipt(state: State, ventureId: string, offerId: string, blueprintDigest: string): PriceReceiptRecord | null {
  const matches = ventureReceipts(state, ventureId).filter(r => r.subject.type === 'offer' && r.subject.offerId === offerId && r.inputs.blueprintDigest === blueprintDigest);
  return matches.length ? matches[matches.length - 1] : null;
}

/** Today on the owner's calendar (the venture's country), from the engine clock: the day basis every package uses. */
export function todayIso(deps: VentureDeps, venture: VentureRecord): string {
  return ownerToday(deps.clock, venture.country);
}

/** Newest first by time, keeping the later-stored record first when two share a time. */
export function newestFirst<T extends { at: string }>(records: readonly T[]): T[] {
  return [...records].reverse().map((record, index) => ({ record, index }))
    .sort((a, b) => (a.record.at < b.record.at ? 1 : a.record.at > b.record.at ? -1 : a.index - b.index))
    .map(entry => entry.record);
}

export function errorCode(error: unknown): string {
  const value = (error as { code?: unknown } | null | undefined)?.code;
  return typeof value === 'string' ? value : '';
}

/** Plain boolean flag from a payload; absent means false. */
export function optionalFlag(value: unknown, field: string): boolean {
  if (value === undefined) return false;
  check(typeof value === 'boolean', 'INVALID_VENTURE_REQUEST', `${field} must be true or false.`);
  return value;
}

/** Shortens text for a check detail without cutting it in the middle of a long line. */
export function quote(text: string, max = 80): string {
  const single = text.replace(/\s+/g, ' ').trim();
  return single.length <= max ? single : `${single.slice(0, max - 3).trimEnd()}...`;
}

/** The most lines a Today view shows of one text (views/queue-view.ts); a longer text is cut there. */
export const VIEW_MAX_LINES = 400;

/**
 * Whether the run's view shows the whole text that goes to the AI (W1 H21, descriptionComplete): every line fits the
 * view, and nothing travels beside it. A command-line send (endpoint cli://) also passes a schema file the text only names.
 */
export function previewShownWhole(preview: { payloadText: string; endpoint: string }): boolean {
  const lines = preview.payloadText.split(/\r?\n/).filter(line => line.trim().length > 0).length;
  return lines <= VIEW_MAX_LINES && !preview.endpoint.startsWith('cli://');
}
