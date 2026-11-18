// Chausar finding customers, for every business (the founder's decision of 14 November 2026): a search for possible
// customers that any business can run before it has a single client. Until now the lead tools belonged to one
// playbook, and a connected tool was reachable only inside a client's order.
//
// What runs, and only this:
// 1. The entry (runApprovedSearch). Two checks in the engine, whoever calls: the owner approved exactly this search
//    (its proposal is claimed, its digest holds, its search record is open: LEAD_SEARCH_NOT_APPROVED otherwise), and
//    what is sold is ready (find-target.ts requireOfferReady: BLUEPRINT_NOT_ACCEPTED, PRICE_REQUIRED). The card the
//    owner approved must still be the card the records give (APPROVAL_STALE), so a changed price or tool asks again.
// 2. The source. The public map: one city lookup (Nominatim, one a second), one bounded Overpass read, then each
//    business's own website read politely for a contact email (robots obeyed). Or one tool the owner connected,
//    called once with the approved inputs under the business scope (agent-runtime/business-mcp.ts), never an order.
//    A call that is not a reviewed read is journalled first and, when it has a price, held on the spend card first
//    (money/spend.ts paidCall: the monthly limit, and the owner's quote above their ask-first figure).
// 3. The list. New ones only, only those the owner may write to (blocklist, never-contact list), the most checkable
//    first. Each becomes a lead with its source page and licence (found-leads.ts). An email is only one a page or
//    the tool showed, and counts once a mail server answers for it.
// Nothing is sent, posted or scheduled: there is no port here that could. The owner checks the list and writes to
// each one themselves (network/outreach.ts, handoff).
//
// The search's states are find-states.ts. A refusal before anything ran ends it failed and the card returns to Today
// in the refusal's own words. Once a call that may have charged is in doubt it ends unknown and the card is settled,
// never put back for a blind second try; the journal entry is what the owner resolves after checking.
import { authorize, check, ChausarError, type Context } from '../../contracts.ts';
import type { ProposalRecord, VentureDeps, VentureRecord } from '../contracts.ts';
import { currentVenture, digest, findRecord, isAppChannel, readVenture, stateView } from '../records.ts';
import type { W4Outcome } from '../views/queue-w4.ts';
import { proposalDigest } from '../chief/gate.ts';
import { blocklistOf } from '../network/pipeline.ts';
import { journalled } from '../journal/journal.ts';
import { paidCall } from '../money/spend.ts';
import { BusinessCapability } from '../agent-runtime/scope.ts';
import { openBusinessMcp, type BusinessMcpOptions } from '../agent-runtime/business-mcp.ts';
import { collectProspects, type Collected } from './sources/collect.ts';
import { prospectsFromTool, refuseForbiddenLeadCall } from './sources/connected.ts';
import { enrichSite } from './sources/enrich.ts';
import { citiesFor } from './sources/nominatim.ts';
import { osmLeads } from './sources/osm.ts';
import { rankProspects, type Prospect } from './sources/prospect.ts';
import type { FindBrief } from './find-brief.ts';
import { CARD_CHANGED, doneLine, inDoubtLine, keptLine, NOT_APPROVED } from './find-words.ts';
import { contactAllowed, knownProspects, landProspect } from './found-leads.ts';
import { leadsOfSearch, moveSearch, noteSearch, searchesOf } from './find-search.ts';
import { SEARCH_LINES } from './find-states.ts';
import { findTarget, requireOfferReady, type FindGate } from './find-target.ts';

/** Test seams: how a search connects to a saved MCP server, and the checked read-only list. The host passes none. */
export type FindPorts = Pick<BusinessMcpOptions, 'connect' | 'checkedList'>;

/** After this long, the remaining businesses are kept without reading their sites, so a search always ends. */
const ENRICH_BUDGET_MS = 5 * 60_000;
/** A connected tool gets this long to answer. After it the call is in doubt, as any outside effect is. */
const CALL_TIMEOUT_MS = 2 * 60_000;
type Called = { ok: true; result: unknown } | { ok: false; line: string };

/** The one call to the owner's connected tool, under the business scope. Throws only when nothing was sent. */
async function connectedCall(deps: VentureDeps, ctx: Context, venture: VentureRecord, proposal: ProposalRecord, searchId: string, gate: Extract<FindGate, { ok: true }>): Promise<Called> {
  const brief = gate.brief, server = gate.server!, source = brief.source as Extract<FindBrief['source'], { kind: 'connected' }>;
  const inDoubt = inDoubtLine(server.name);
  const capability = new BusinessCapability({ workId: searchId, ventureId: venture.id, purpose: 'find-customers', memberId: ctx.memberId, epoch: ctx.epoch }, ctx, scope => {
    const live = deps.store.read();
    authorize(stateView(live, deps.store), ctx, 'approve');
    check(currentVenture(live)?.id === scope.ventureId && findRecord(live, 'venture-lead-search', scope.workId)?.state === 'running', 'JOB_CLOSED', 'This search is no longer running.');
  });
  const mcp = openBusinessMcp(deps, capability, { signal: deps.closing?.signal ?? new AbortController().signal, ...(deps.findPorts ?? {}) });
  try {
    const ready = await mcp.prepare({ serverId: source.serverId, tool: source.tool, arguments: source.arguments, approved: gate.pin });
    refuseForbiddenLeadCall(ready.tool, source.arguments);
    // A tool Chausar reviewed as read-only, with no price: a plain read. A failure is only a failure.
    if (ready.approval === 'checked-read-only' && !gate.cost.item) return { ok: true, result: await ready.send() };
    const spendKey = `lead-search:${proposal.id}`;
    let sent = false, refusal: unknown = null;
    const send = async () => { sent = true; return ready.send(); };
    try {
      const done = await journalled<unknown>(deps, ctx, {
        action: 'connector.write', operation: 'lead-search', subject: `lead-search:${proposal.id}`, target: `${server.name}: ${ready.tool.name}`,
        actionDigest: digest({ brief, pin: gate.pin }), descriptionComplete: true, account: server.id,
        // The journal's own short line; the card the owner approved (the proposal) holds every word and the exact inputs.
        line: `One call to ${server.name}, its tool ${ready.tool.name.slice(0, 80)}, for the search you approved on Today.`.slice(0, 300),
      }, async handle => {
        handle.fence(server.id);
        await noteSearch(deps, ctx, searchId, { journalId: handle.entry.id, ...(gate.cost.item ? { spendKey } : {}) });
        try {
          const value = gate.cost.item
            ? await paidCall(deps, ctx, {
              key: spendKey, item: gate.cost.item, label: `Finding customers with ${server.name}`, payer: `connector:${server.id}`, draftDigest: digest(brief),
              connector: server.id, ref: searchId, list: null, ...(gate.cost.rateDigest ? { approvedRateDigest: gate.cost.rateDigest } : {}),
            }, async () => ({ value: await send(), billedMicros: null }))
            : await send();
          return { outcome: 'applied', line: `${server.name} answered.`, value, by: 'platform' };
        } catch (error) {
          // Before the call left (the spend limit, a quote that waits for the owner): known to have done nothing.
          if (!sent) { refusal = error; return { outcome: 'not-sent', line: error instanceof ChausarError ? error.message : 'The call was not sent.', value: null }; }
          return { outcome: 'unknown', line: inDoubt, value: null };
        }
      }, { account: server.id, timeoutMs: CALL_TIMEOUT_MS });
      if (refusal) throw refusal;
      return done.entry.state === 'applied' ? { ok: true, result: done.value } : { ok: false, line: inDoubt };
    } catch (error) {
      if (refusal && error === refusal) throw error;
      // The journal's own word that it may have happened (a timeout, or an earlier try of this card left in doubt).
      if (error instanceof ChausarError && error.code === 'JOURNAL_OUTCOME_UNKNOWN') return { ok: false, line: inDoubt };
      if (sent) return { ok: false, line: inDoubt };
      throw error;
    }
  } finally {
    capability.close();
    await mcp.close().catch(() => undefined);
  }
}

/**
 * Runs the search of one approved find-customers proposal, once. Called by the card's approval (chief/proposals.ts)
 * and by nothing else; a caller without the claimed proposal and its open search is refused here.
 */
export async function runApprovedSearch(deps: VentureDeps, ctx: Context, proposal: ProposalRecord): Promise<W4Outcome> {
  check(isAppChannel(ctx), 'APP_APPROVAL_REQUIRED', 'Approve this search inside the Chausar app.');
  authorize(deps.store, ctx, 'approve');
  const { state, venture } = readVenture(deps, ctx);
  const current = findRecord(state, 'venture-proposal', proposal.id);
  const search = searchesOf(state, venture.id).find(item => item.proposalId === proposal.id && item.state === 'approved');
  check(current && search && current.ventureId === venture.id && current.proposalKind === 'find-customers' && current.status === 'approved' && proposalDigest(current) === current.digest,
    'LEAD_SEARCH_NOT_APPROVED', NOT_APPROVED);
  const words = (error: unknown) => (error instanceof ChausarError ? error.message : 'Chausar met an error before the search finished.');
  let gate: Extract<FindGate, { ok: true }>;
  try {
    requireOfferReady(state, venture);
    const read = findTarget(state, venture, current.input);
    check(read.ok && read.target.line === current.line && read.target.title === current.title, 'APPROVAL_STALE', CARD_CHANGED);
    gate = read;
  } catch (error) {
    await moveSearch(deps, ctx, search.id, 'failed', { line: words(error) }).catch(() => undefined);
    throw error;
  }
  await moveSearch(deps, ctx, search.id, 'running', { line: SEARCH_LINES.running });
  const brief = gate.brief, server = gate.server?.name ?? null;
  const blocklist = blocklistOf(state, venture.id), existing = knownProspects(state, venture.id), started = performance.now();
  const ports = (source: () => Promise<Prospect[]>) => ({
    source,
    enrich: async (url: string) => {
      // Time gone by on this computer's steady clock, never a day or a time of day.
      check(performance.now() - started < ENRICH_BUDGET_MS, 'LEAD_SOURCE_UNAVAILABLE', 'The search ran out of time before reading this site.');
      return enrichSite(url, deps.net);
    },
    allowed: (row: Prospect) => contactAllowed(deps, ctx, blocklist, row),
  });
  /** Ends the search with what it added so far. Used once a paid call has answered, and when one is in doubt. */
  const endWith = async (to: 'failed' | 'unknown', said: string): Promise<W4Outcome> => {
    const kept = leadsOfSearch(deps.store.read(), venture.id, search.id);
    const line = keptLine(said, kept.length);
    await moveSearch(deps, ctx, search.id, to, { line, leadIds: kept, found: kept.length }).catch(() => undefined);
    return { line };
  };
  let answered = false;
  try {
    let collected: Collected;
    if (brief.source.kind === 'public-map') {
      const box = await citiesFor(deps.net).find(brief.place);
      collected = await collectProspects({ count: brief.count, existing }, ports(() => osmLeads({ box, vertical: brief.category, count: Math.min(50, brief.count * 3) }, deps.net)));
    } else {
      const called = await connectedCall(deps, ctx, venture, current, search.id, gate);
      if (!called.ok) return await endWith('unknown', called.line);
      answered = true;
      collected = await collectProspects({ count: brief.count, existing }, ports(async () => prospectsFromTool(called.result, { server: server! })));
    }
    const leadIds: string[] = [];
    // Added least checkable first, so the most checkable are the newest and lead the list.
    for (const prospect of rankProspects(collected.prospects).reverse()) {
      const lead = await landProspect(deps, ctx, { prospect, source: server ? 'connected' : 'osm', searchId: search.id, ...(server ? { server } : {}), emit: 'pipeline.changed' });
      leadIds.unshift(lead.id);
    }
    const line = doneLine(brief, { found: leadIds.length, withEmail: collected.withEmail, skipped: collected.skipped }, server);
    await moveSearch(deps, ctx, search.id, 'done', { line, found: leadIds.length, withEmail: collected.withEmail, skipped: collected.skipped, leadIds });
    return { line };
  } catch (error) {
    // The tool already answered, and may have charged: the card is settled, never put back for a second paid call.
    if (answered) return endWith('failed', `${server} answered, but Chausar stopped while adding its results: ${words(error)}`);
    // Nothing outside is in doubt: the public sources only read, and a refused call never left.
    const kept = leadsOfSearch(deps.store.read(), venture.id, search.id);
    await moveSearch(deps, ctx, search.id, 'failed', { line: words(error), leadIds: kept, found: kept.length }).catch(() => undefined);
    throw error;
  }
}
