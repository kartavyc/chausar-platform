// Chausar finding customers, for every business: what one search acts on, read from the records as they are now.
// Three things are decided here, by code, and nowhere else:
// - The gate (requireOfferReady). Customers are not looked for until what is sold is ready: the plan accepted and
//   every offer priced by the owner (core/way-ready.ts). It is checked when a search is proposed, on every read of
//   its card, when the card is approved, and again at the entry of the run (find-run.ts), whoever calls. A message the
//   owner chooses to draft themselves (venture.outreach.draft, venture.leads.draft) is not held by it.
// - The lead sources and their honest labels (leadSources): the public map search is real and needs nothing; a tool
//   the owner connected is built and tested against a sample server, so it says planned until it has run on a live
//   account, as every such connector does (core/needs-data.ts); Monid is listed the same way.
// - The card (findTarget): exactly where the search looks, how many, which connected tool it calls and what that
//   costs when Chausar knows. A cost is the owner's own rate card line, worked out by code; an unknown price is never
//   shown as free.
// Reads only. No network and nothing from the chief package, so chief/gate.ts can read it.
import { check, type State } from '../../contracts.ts';
import type { Json, VentureRecord } from '../contracts.ts';
import { digest, findRecord } from '../records.ts';
import { offerReadiness } from '../core/way-ready.ts';
import { ownerProfileOf } from '../core/owner.ts';
import { agentSettingsOf } from '../agent-runtime/settings.ts';
import type { ExternalMcpServer } from '../agent-runtime/external-config.ts';
import { CURATED_MCP_SERVERS } from '../agent-runtime/mcp-registry.ts';
import { DEFAULT_MCP_ADAPTERS } from '../agent-runtime/mcp-adapters.ts';
import { ratePrice, resolveRate, spendRatesOf, SpendRefusal } from '../money/spend.ts';
import { checkBrief, MAP_PLACES_ONLY, planHasPlaces, seedBrief, type FindBrief } from './find-brief.ts';
import { COST, connectedCard, notReadyLine, notReadyReason, publicCard, sourceRows, type FindSourceView } from './find-words.ts';

export type { FindSourceView } from './find-words.ts';

/** What the owner's approval of a connected call is bound to, read from the server when the card was made. */
export type FindPin = { serverName: string; description: string; fingerprint: string; argumentsDigest: string; approval: 'checked-read-only' | 'every-call' };
/** A find-customers proposal's input: the exact brief, and for a connected tool, the pin. */
export type FindInput = { brief: FindBrief; pin: FindPin | null };


/**
 * The gate at the entry of finding customers. Refuses with the owner words of what is missing: BLUEPRINT_NOT_ACCEPTED
 * while the plan is not accepted, PRICE_REQUIRED while an offer has no price (or the plan has no offer).
 */
export function requireOfferReady(state: State, venture: VentureRecord): void {
  const readiness = offerReadiness(state, venture);
  if (readiness.ready) return;
  const plan = venture.acceptedBlueprintId ? findRecord(state, 'venture-blueprint', venture.acceptedBlueprintId) : null;
  const accepted = !!plan && plan.ventureId === venture.id && plan.status === 'accepted';
  check(false, accepted ? 'PRICE_REQUIRED' : 'BLUEPRINT_NOT_ACCEPTED', notReadyLine(readiness.missing));
}

/** The brief Chausar first offers: from the kept way to earn, for the owner to finish. */
export function seededBrief(state: State, venture: VentureRecord): FindBrief {
  return seedBrief(ownerProfileOf(state, venture.id).way, venture.country.name, venture.idea);
}

/** The one line for customers who are not places on a map (find-brief.ts MAP_PLACES_ONLY), or null. */
export function mapNoteOf(state: State, venture: VentureRecord): string | null {
  return planHasPlaces(ownerProfileOf(state, venture.id).way) === false ? MAP_PLACES_ONLY : null;
}

// ---------------------------------------------------------------------------
// Lead sources
// ---------------------------------------------------------------------------

/** The spend item of a call to one saved server: the owner's rate card line for it prices the call. */
export const leadToolItem = (serverId: string): string => `connector:mcp-${serverId}`;
const sameServer = (a: ExternalMcpServer, b: ExternalMcpServer): boolean => a.transport === 'http' && b.transport === 'http' && a.url === b.url;
const curatedOf = (server: ExternalMcpServer) => CURATED_MCP_SERVERS.find(entry => sameServer(entry.server, server)) ?? null;
/** A server whose own rules need a client order (Sunra's cost and rights card): never used for the business itself. */
const orderOnly = (server: ExternalMcpServer): boolean => DEFAULT_MCP_ADAPTERS.some(adapter => adapter.matches(server));

/**
 * The saved servers that may be a lead tool: every one the owner added except those Chausar knows are for something
 * else (the curated list's other entries) and those bound to a client order.
 */
export function leadTools(state: State, ventureId: string): ExternalMcpServer[] {
  return agentSettingsOf(state, ventureId).mcpServers.filter(server => { const curated = curatedOf(server); return !orderOnly(server) && (!curated || curated.finds === 'leads'); });
}

/**
 * Every lead source with what it really does in this build: the public map, each tool the owner connected, and Monid.
 * Where the plan's customers are not places on a map, no row recommends the map meanwhile (find-words.ts sourceRows).
 */
export function leadSources(state: State, ventureId: string): FindSourceView[] {
  const saved = leadTools(state, ventureId);
  const mapFits = planHasPlaces(ownerProfileOf(state, ventureId).way) !== false;
  return sourceRows(saved, CURATED_MCP_SERVERS.filter(entry => entry.finds === 'leads' && !saved.some(server => sameServer(entry.server, server))), { mapFits });
}

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------

export type FindCost = { line: string; spends: boolean; item: string | null; rateDigest: string | null };

/**
 * What a search costs, by code. The public map is free. A connected tool costs the owner's rate card line for it
 * (Money, Spend); a tool Chausar knows is paid has no card without one (SPEND_UNPRICED); any other tool says plainly
 * that Chausar does not know its price. Throws the spend refusal as it is.
 */
export function findCost(state: State, ventureId: string, brief: FindBrief, pin: FindPin | null, server: ExternalMcpServer | null): FindCost {
  if (brief.source.kind === 'public-map' || !server) return { line: COST.free, spends: false, item: null, rateDigest: null };
  const item = leadToolItem(server.id), owner = spendRatesOf(state, ventureId);
  const label = `a call to ${server.name}`;
  if (owner.some(line => line.item === item) || curatedOf(server)?.paid) {
    const rate = resolveRate({ item, list: null, owner, subject: { key: item, item, label, payer: `connector:${server.id}`, draftDigest: digest(brief) } });
    return { line: COST.priced(ratePrice(rate), server.name), spends: true, item, rateDigest: digest(rate) };
  }
  if (pin?.approval === 'checked-read-only') return { line: COST.checked, spends: false, item: null, rateDigest: null };
  return { line: COST.unknown(server.name), spends: true, item: null, rateDigest: null };
}

export type FindTarget = { title: string; line: string; spends: boolean; sends: false; agent: null; facts: Json };
export type FindGate = { ok: true; target: FindTarget; brief: FindBrief; pin: FindPin | null; server: ExternalMcpServer | null; cost: FindCost } | { ok: false; reason: string };
const no = (reason: string): FindGate => ({ ok: false, reason });
const lower = (text: string) => text.replace(/^\p{Lu}/u, letter => letter.toLowerCase());

function pinOf(raw: unknown): FindPin | null {
  if (raw === null) return null;
  const pin = raw as Partial<FindPin> | undefined;
  check(!!pin && typeof pin === 'object' && !Array.isArray(pin) && Object.keys(pin).length === 5
    && typeof pin.serverName === 'string' && typeof pin.description === 'string' && typeof pin.fingerprint === 'string' && typeof pin.argumentsDigest === 'string'
    && (pin.approval === 'checked-read-only' || pin.approval === 'every-call'), 'INVALID_VENTURE_REQUEST', 'The connected tool on this card could not be read.');
  return pin as FindPin;
}

/**
 * The gate for one search and its input, from the records as they are now: its card, or why it cannot go ahead, in
 * words that finish "This can't go ahead now: ...". The card's line says everything that will run.
 */
export function findTarget(state: State, venture: VentureRecord, input: Json): FindGate {
  const readiness = offerReadiness(state, venture);
  if (!readiness.ready) return no(notReadyReason(readiness.missing));
  let brief: FindBrief, pin: FindPin | null;
  try {
    const body = input as { brief?: unknown; pin?: unknown } | null;
    check(!!body && typeof body === 'object' && !Array.isArray(body) && Object.keys(body).length === 2 && Object.hasOwn(body, 'brief') && Object.hasOwn(body, 'pin'), 'INVALID_VENTURE_REQUEST', 'This search could not be read.');
    brief = checkBrief(body.brief);
    pin = pinOf(body.pin);
  } catch (error) { return no(lower((error as Error).message)); }
  const plan = { id: venture.acceptedBlueprintId, digest: venture.acceptedBlueprintId ? findRecord(state, 'venture-blueprint', venture.acceptedBlueprintId)?.digest ?? null : null };
  if (brief.source.kind === 'public-map') {
    if (pin) return no('this search could not be read.');
    const cost = findCost(state, venture.id, brief, null, null), tools = leadTools(state, venture.id).length;
    return { ok: true, brief, pin: null, server: null, cost, target: { ...publicCard(brief, tools), spends: false, sends: false, agent: null, facts: { plan, tools } } };
  }
  const serverId = brief.source.serverId;
  const server = leadTools(state, venture.id).find(item => item.id === serverId) ?? null;
  if (!server) return no('that connected tool is no longer saved, or is not one a search can use.');
  if (!pin || pin.serverName !== server.name) return no('the connected tool changed since this card was made.');
  let cost: FindCost;
  try { cost = findCost(state, venture.id, brief, pin, server); }
  catch (error) { if (error instanceof SpendRefusal) return no(lower(error.message)); throw error; }
  return { ok: true, brief, pin, server, cost, target: { ...connectedCard(brief, server.name, cost.line), spends: cost.spends, sends: false, agent: null, facts: { plan, server: digest(server), rate: cost.rateDigest, pin: pin.fingerprint } } };
}
