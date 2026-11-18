/**
 * The fake engine's finding customers (the engine's customers/find-methods.ts, find-target.ts, find-run.ts):
 * venture.leads.find.view, .propose and .tools, and what approving a search's card on Today does. It answers as the
 * engine does: the same gate (what is sold must be ready), the same checks in the same order with the same codes, and
 * the same words, built from the engine's own pure files (find-brief.ts, find-words.ts, find-states.ts). Nothing here
 * reaches a network: an approved search adds two sample businesses, each with its source page and licence, so the
 * screens show what a real one adds. Nothing is ever sent.
 */

import { EngineError, type FindBrief, type FindCustomersView, type FindProposedOf, type FindToolsView, type LeadView, type OpenSearchView, type ProposalView, type SearchState, type VentureRunEvent } from './types';
import { checkBrief, MAP_PLACES_ONLY, PLACE_KINDS, planHasPlaces, seedBrief } from '../../../../platform/runtime/venture/customers/find-brief';
import { SEARCH_LINES, stepSearch } from '../../../../platform/runtime/venture/customers/find-states';
import {
  COST, connectedCard, doneLine, foundSource, NO_LEAD_TOOL, NO_LEAD_TOOL_ONLY, notReadyLine, notReadyReason, openSearchList, publicCard, searchList, sourceRows, SEARCH_TITLE,
} from '../../../../platform/runtime/venture/customers/find-words';
import { connectedLicence, refuseForbiddenLeadCall } from '../../../../platform/runtime/venture/customers/sources/connected';
import { OSM_ATTRIBUTION } from '../../../../platform/runtime/venture/customers/sources/prospect';
import { PLAN_FIXED_WORDS } from '../../../../platform/runtime/venture/chief/plan-core';
import type { EndedSearch } from '../../../../platform/runtime/venture/journal/earlier-list';
import { CURATED_MCP_SERVERS } from '../../../../platform/runtime/venture/agent-runtime/mcp-registry';

/** A find-customers proposal's input, as the engine keeps it (find-target.ts FindInput). */
export type FakeFindInput = { brief: FindBrief; pin: { serverName: string; description: string; fingerprint: string; argumentsDigest: string; approval: 'checked-read-only' | 'every-call' } | null };
type SavedServer = { id: string; name: string; transport: string; url?: string; command?: string; args?: string[] };
type Search = { id: string; proposalId: string; state: Exclude<SearchState, 'proposed'>; title: string; line: string; at: string; found: number };
type Source = { leadId: string; searchId: string; source: 'osm' | 'connected'; server?: string; licence: string };

export interface FindDeskHost {
  current(): string;
  now(): string;
  digest(value: unknown): string;
  /** Another fake desk's answer: the plan, the owner profile, the saved servers, the spend settings, the leads. */
  ask(method: string, params: unknown): unknown;
  emit(event: VentureRunEvent): void;
  /** The Chats desk raises the card and keeps it (fake-chief.ts draftOwned, findCards). */
  raise(input: { title: string; line: string; spends: boolean; find: FakeFindInput }): { proposal: ProposalView; rowId: string };
  cards(): { id: string; title: string; at: string; rowId: string; find: FakeFindInput }[];
  /** What the owner said the business is (the engine's venture.idea), for the seeded brief; left out means nothing said. */
  about?(): string;
}

export const FIND_METHODS: ReadonlySet<string> = new Set(['venture.leads.find.view', 'venture.leads.find.propose', 'venture.leads.find.tools']);
/** The sample tool every saved lead tool lists here, as a real server lists its own. */
const SAMPLE_TOOL = { name: 'search_companies', description: 'Search public company listings by words and city.', approval: 'every-call' as const };
/** What an approved sample search adds: public listings with no contact email. */
const SAMPLE_PLACES = [{ node: 900000001, name: 'Lotus Cafe (sample)' }, { node: 900000002, name: 'Brew Room (sample)' }];
const SAMPLE_COMPANIES = [{ name: 'Northwind Labs (sample)', url: 'https://northwind.example/' }, { name: 'Paper Boat Software (sample)', url: 'https://paperboat.example/' }];
const OPEN_CARDS = 5;
const invalid = (message: string) => new EngineError('INVALID_VENTURE_REQUEST', message);
const exact = (p: Record<string, unknown>, keys: readonly string[], required: readonly string[] = keys) => {
  if (Object.keys(p).some((key) => !keys.includes(key)) || required.some((key) => !Object.hasOwn(p, key))) throw invalid('Send the required fields and nothing else.');
};

export class FakeFindCustomersDesk {
  private readonly host: FindDeskHost;
  private readonly searches = new Map<string, Search[]>();
  private readonly sources = new Map<string, Source[]>();
  private seq = 1;

  constructor(host: FindDeskHost) { this.host = host; }

  handles(method: string): boolean { return FIND_METHODS.has(method); }

  request(method: string, p: Record<string, unknown>): unknown {
    switch (method) {
      case 'venture.leads.find.view': exact(p, []); return this.view();
      case 'venture.leads.find.propose': return this.propose(p);
      case 'venture.leads.find.tools': return this.tools(p);
      default: throw new EngineError('NOT_BUILT_YET', 'This part of Chausar is not built yet.');
    }
  }

  // -------------------------------------------------------------------------------------------------------------
  // What the engine reads from its records
  // -------------------------------------------------------------------------------------------------------------

  /**
   * core/way-ready.ts offerReadiness: the plan accepted and every offer priced, else what is missing, in order. The
   * sample business's plan is its accepted one (the fake has no accept step, and a price set here stands at once), so
   * only a business with no plan at all reads as not accepted.
   */
  private readiness(): { ready: boolean; missing: string[]; accepted: boolean } {
    const plan = (this.host.ask('venture.blueprint.get', {}) as { blueprint?: { offers?: { name: { value: string }; pricing: { unitPriceMinor: string | null } }[] } } | null)?.blueprint;
    if (!plan) return { ready: false, missing: [PLAN_FIXED_WORDS.planFirst], accepted: false };
    const offers = plan.offers ?? [];
    const missing = offers.filter((offer) => offer.pricing.unitPriceMinor === null).map((offer) => `Set your price for ${offer.name.value}.`);
    if (!offers.length) missing.push('Add at least one offer to your plan.');
    return { ready: missing.length === 0, missing, accepted: true };
  }

  /** find-target.ts requireOfferReady. */
  private requireReady(): void {
    const readiness = this.readiness();
    if (!readiness.ready) throw new EngineError(readiness.accepted ? 'PRICE_REQUIRED' : 'BLUEPRINT_NOT_ACCEPTED', notReadyLine(readiness.missing));
  }

  /** find-target.ts leadTools: the saved servers that are not for something else and not bound to an order. */
  private leadTools(): SavedServer[] {
    const saved = (this.host.ask('venture.agentSettings.get', {}) as { settings?: { mcpServers?: SavedServer[] } } | null)?.settings?.mcpServers ?? [];
    return saved.filter((server) => {
      const curated = CURATED_MCP_SERVERS.find((entry) => entry.server.transport === 'http' && entry.server.url === server.url);
      const sunra = server.transport === 'stdio' && /(^|[\\/])npx(\.cmd|\.exe)?$/i.test(server.command ?? '') && (server.args ?? []).some((arg) => arg.startsWith('@sunra/mcp-server'));
      return !sunra && (!curated || curated.finds === 'leads');
    });
  }
  /** find-target.ts leadSources: the public map, each saved lead tool, and each listed lead tool not saved yet. */
  leadSources(way?: Parameters<typeof planHasPlaces>[0]): FindCustomersView['sources'] {
    const saved = this.leadTools();
    // As find-target.ts: where the plan's customers are not places on a map, no row recommends the map meanwhile.
    return sourceRows(saved, CURATED_MCP_SERVERS.filter((entry) => entry.finds === 'leads' && !saved.some((server) => server.url === (entry.server.transport === 'http' ? entry.server.url : ''))), { mapFits: planHasPlaces(way) !== false });
  }
  private curatedOf(server: SavedServer) { return CURATED_MCP_SERVERS.find((entry) => entry.server.transport === 'http' && entry.server.url === server.url) ?? null; }

  /** find-target.ts findCost for a connected tool: the rate card's line, a known paid tool with none, or unknown. */
  private costOf(server: SavedServer): { line: string; rate: string | null } {
    const rates = (this.host.ask('venture.spend.policy.get', {}) as { rates?: { item: string; price: string }[] } | null)?.rates ?? [];
    const rate = rates.find((line) => line.item === `connector:mcp-${server.id}`);
    if (rate) return { line: COST.priced(rate.price, server.name), rate: rate.price };
    if (this.curatedOf(server)?.paid) {
      throw new EngineError('SPEND_UNPRICED', `Chausar has no price for a call to ${server.name}, so it was not run. Add its price to your rate card first; an unknown price is never counted as free.`);
    }
    return { line: COST.unknown(server.name), rate: null };
  }

  /** find-target.ts findTarget: the card as the records give it now, or why it cannot go ahead. */
  private target(input: FakeFindInput): { title: string; line: string; spends: boolean; facts: unknown } | { reason: string } {
    const readiness = this.readiness();
    if (!readiness.ready) return { reason: notReadyReason(readiness.missing) };
    const { brief } = input;
    if (brief.source.kind === 'public-map') {
      const tools = this.leadTools().length;
      return { ...publicCard(brief, tools), spends: false, facts: { tools } };
    }
    const source = brief.source;
    const server = this.leadTools().find((item) => item.id === source.serverId);
    if (!server) return { reason: 'that connected tool is no longer saved, or is not one a search can use.' };
    if (!input.pin || input.pin.serverName !== server.name) return { reason: 'the connected tool changed since this card was made.' };
    let cost: { line: string; rate: string | null };
    try { cost = this.costOf(server); } catch (error) { return { reason: (error as Error).message.replace(/^\p{Lu}/u, (letter) => letter.toLowerCase()) }; }
    return { ...connectedCard(brief, server.name, cost.line), spends: true, facts: { server: this.host.digest(server), rate: cost.rate, pin: input.pin.fingerprint } };
  }

  // -------------------------------------------------------------------------------------------------------------
  // The Chats desk asks these for a search's card (fake-chief.ts)
  // -------------------------------------------------------------------------------------------------------------

  /** chief/gate.ts proposalGate for a search: why its card cannot go ahead now, or null. */
  gate(input: FakeFindInput, title: string, line: string): string | null {
    const target = this.target(input);
    if ('reason' in target) return target.reason;
    return target.line !== line || target.title !== title ? 'it changed since Chausar drafted it.' : null;
  }
  facts(input: FakeFindInput): unknown {
    const target = this.target(input);
    return 'reason' in target ? { blocked: target.reason } : target.facts;
  }

  /**
   * The approved card runs its search (find-run.ts runApprovedSearch): approved, running, done, through the engine's
   * one table of moves. Sample businesses become leads with their source; one the business already has is left out.
   */
  run(proposalId: string, input: FakeFindInput, title: string): string {
    this.requireReady();
    const biz = this.host.current(), at = this.host.now();
    const search: Search = { id: `leadsearch-${this.seq++}`, proposalId, state: stepSearch('proposed', 'approved') as 'approved', title, line: SEARCH_LINES.approved, at, found: 0 };
    this.searches.set(biz, [...(this.searches.get(biz) ?? []), search]);
    search.state = stepSearch(search.state, 'running') as 'running';
    const { brief } = input;
    const server = brief.source.kind === 'connected' ? input.pin?.serverName ?? brief.source.serverId : null;
    const have = new Set((this.host.ask('venture.leads.list', {}) as { leads: LeadView[] }).leads.map((lead) => lead.sourceUrl));
    const rows = server
      ? SAMPLE_COMPANIES.map((row) => ({ name: row.name, sourceUrl: row.url }))
      : SAMPLE_PLACES.map((row) => ({ name: row.name, sourceUrl: `https://www.openstreetmap.org/node/${row.node}` }));
    const fresh = rows.filter((row) => !have.has(row.sourceUrl)).slice(0, brief.count);
    for (const row of fresh) {
      const lead = this.host.ask('venture.leads.add', { name: row.name, company: row.name, sourceUrl: row.sourceUrl }) as LeadView;
      this.sources.set(biz, [...(this.sources.get(biz) ?? []), { leadId: lead.id, searchId: search.id, source: server ? 'connected' : 'osm', ...(server ? { server } : {}), licence: server ? connectedLicence(server) : OSM_ATTRIBUTION }]);
    }
    search.found = fresh.length;
    search.line = doneLine(brief, { found: fresh.length, withEmail: 0, skipped: { known: rows.length - rows.filter((row) => !have.has(row.sourceUrl)).length, blocked: 0 } }, server);
    search.state = stepSearch(search.state, 'done') as 'done';
    this.host.emit({ type: 'pipeline.changed', businessId: biz, at });
    return search.line;
  }

  /**
   * The open business's searches open now, as venture.runs.list carries them beside the runs (find-search.ts
   * openSearchesOf, round 5). The sample search runs to its end within its approval, so none stays open here.
   */
  /** Round 6: the open business's searches, as journal/earlier.ts reads them for Today's Earlier (the sample ends as it starts). */
  ended(): EndedSearch[] {
    return (this.searches.get(this.host.current()) ?? []).map((item) => ({ id: item.id, proposalId: item.proposalId, state: item.state, title: item.title || SEARCH_TITLE, line: item.line, endedAt: item.at, at: item.at }));
  }

  open(): OpenSearchView[] {
    const tries = (this.searches.get(this.host.current()) ?? []).map((item) => ({ id: item.id, state: item.state, title: item.title, line: item.line, startedAt: item.at, agent: null }));
    return openSearchList(tries, this.host.now());
  }

  // -------------------------------------------------------------------------------------------------------------
  // The methods
  // -------------------------------------------------------------------------------------------------------------

  private view(): FindCustomersView {
    const biz = this.host.current();
    const readiness = this.readiness();
    const owner = this.host.ask('venture.owner.get', {}) as { way?: { customer: string; reach: string } } | null;
    const saved = this.leadTools();
    // The engine's own list (find-words.ts searchList): one entry for each try, and a card nobody tried yet as its own.
    const cards = this.host.cards().map((card) => ({ id: card.id, title: card.title, at: card.at, rowId: card.rowId }));
    const tries = (this.searches.get(biz) ?? []).map((item) => ({ id: item.id, proposalId: item.proposalId, state: item.state, title: item.title || SEARCH_TITLE, line: item.line, at: item.at, found: item.found }));
    const leads = new Map((this.host.ask('venture.leads.list', {}) as { leads: LeadView[] }).leads.map((lead) => [lead.id, lead]));
    return {
      // As find-target.ts seededBrief: from the kept way, then the owner's own about words where that is safe.
      ready: readiness.ready, missing: readiness.missing, gate: readiness.ready ? null : notReadyLine(readiness.missing), brief: seedBrief(owner?.way, 'India', this.host.about?.() ?? ''),
      kinds: PLACE_KINDS.map((kind) => ({ tag: kind.tag, label: kind.label })),
      sources: this.leadSources(owner?.way),
      // As find-methods.ts: where the map does not fit the plan's customers, the line does not offer the map.
      note: saved.length ? null : planHasPlaces(owner?.way) === false ? NO_LEAD_TOOL_ONLY : NO_LEAD_TOOL,
      // As find-target.ts mapNoteOf: one line when the plan's customers are not places on a map.
      mapNote: planHasPlaces(owner?.way) === false ? MAP_PLACES_ONLY : null,
      searches: searchList(cards, tries).slice(0, 20),
      found: [...(this.sources.get(biz) ?? [])].reverse().filter((source) => leads.has(source.leadId)).slice(0, 100).map((source) => {
        const lead = leads.get(source.leadId)!;
        return { leadId: lead.id, name: lead.name, email: lead.email, sourceUrl: lead.sourceUrl ?? '', source: foundSource(source.source, source.server), licence: source.licence, searchId: source.searchId };
      }),
    };
  }

  private tools(p: Record<string, unknown>): FindToolsView {
    exact(p, ['serverId']);
    if (typeof p.serverId !== 'string' || !/^[a-z][a-z0-9_-]{0,63}$/.test(p.serverId)) throw invalid('Choose one of your connected tools.');
    this.requireReady();
    if (!this.leadTools().some((server) => server.id === p.serverId)) throw new EngineError('MCP_SERVER_NOT_FOUND', 'Choose one of your connected tools.');
    return { serverId: p.serverId, tools: [{ ...SAMPLE_TOOL }] };
  }

  private propose(p: Record<string, unknown>): FindProposedOf<ProposalView> {
    exact(p, ['brief']);
    this.requireReady();
    const brief = checkBrief(p.brief);
    let pin: FakeFindInput['pin'] = null;
    if (brief.source.kind === 'connected') {
      const source = brief.source;
      const server = this.leadTools().find((item) => item.id === source.serverId);
      if (!server) throw new EngineError('MCP_SERVER_NOT_FOUND', 'Choose one of your connected tools.');
      this.costOf(server);
      if (source.tool !== SAMPLE_TOOL.name) throw new EngineError('MCP_TOOL_CHANGED', `${server.name} has no tool called ${source.tool} now. Choose one of its tools again.`);
      refuseForbiddenLeadCall(SAMPLE_TOOL, source.arguments);
      pin = { serverName: server.name, description: SAMPLE_TOOL.description, fingerprint: this.host.digest({ server, tool: SAMPLE_TOOL }), argumentsDigest: this.host.digest(source.arguments), approval: SAMPLE_TOOL.approval };
    }
    const input: FakeFindInput = { brief, pin };
    const target = this.target(input);
    if ('reason' in target) throw invalid(`This search can't go ahead: ${target.reason}`);
    const cards = this.host.cards();
    const same = cards.find((card) => JSON.stringify(card.find) === JSON.stringify(input));
    if (same) {
      const again = this.host.raise({ title: target.title, line: target.line, spends: target.spends, find: input });
      return { ...again, title: target.title, line: target.line };
    }
    if (cards.length >= OPEN_CARDS) throw invalid('Several searches already wait on Today. Approve or dismiss one first.');
    const raised = this.host.raise({ title: target.title, line: target.line, spends: target.spends, find: input });
    this.host.emit({ type: 'pipeline.changed', businessId: this.host.current(), at: this.host.now() });
    return { ...raised, title: target.title, line: target.line };
  }
}
