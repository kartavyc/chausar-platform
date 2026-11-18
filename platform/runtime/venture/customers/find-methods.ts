// Chausar finding customers, for every business: the engine methods the Pipeline tab uses.
// - venture.leads.find.view {} (read): whether what is sold is ready, the brief Chausar offers from the kept way to
//   earn, the lead sources with their honest labels, the searches and the leads they found, each with its source.
// - venture.leads.find.propose { brief } (prepare, inside the app): the owner starts a search themselves. It becomes
//   the same card on Today the chief's proposal becomes, raised at once, and runs only when the owner approves that
//   card (chief/proposals.ts decideProposal). Refused until what is sold is ready (find-target.ts requireOfferReady).
//   For a connected tool it reads that server's tool list once, to bind the card to the tool as it is described now;
//   it calls no tool.
// - venture.leads.find.tools { serverId } (read, inside the app): one connected server's tools by name, for the form.
//   Lists only. Held by the same gate.
// Nothing here runs a search: that is find-run.ts, reached only through an approved card.
import { authorize, check, type Context } from '../../contracts.ts';
import type { Json, ProposalRecord, VentureDeps } from '../contracts.ts';
import { exactPayload, listRecords, readVenture, requireAppChannel, ventureAction } from '../records.ts';
import { draftProposal } from '../chief/store.ts';
import { proposalRowId, proposalView } from '../chief/gate.ts';
import { BusinessCapability } from '../agent-runtime/scope.ts';
import { checkBrief, PLACE_KINDS, type FindBrief } from './find-brief.ts';
import { searchesOf, type FindCustomersView, type FindProposed, type FindToolsView, type FoundLeadView } from './find-search.ts';
import { findCost, findTarget, leadSources, leadTools, mapNoteOf, requireOfferReady, seededBrief, type FindInput, type FindPin } from './find-target.ts';
import { foundSource, NO_LEAD_TOOL, NO_LEAD_TOOL_ONLY, notReadyLine, searchList, SEARCH_TITLE } from './find-words.ts';
import { offerReadiness } from '../core/way-ready.ts';
import { refuseForbiddenLeadCall } from './sources/connected.ts';

/** How many searches and found leads one view lists, newest first. */
const VIEW_SEARCHES = 20;
const VIEW_FOUND = 100;
/** The owner may hold this many search cards on Today at once. */
const OPEN_CARDS = 5;

/** venture.leads.find.view {} (read). */
export async function leadsFindView(deps: VentureDeps, ctx: Context, payload: unknown): Promise<FindCustomersView> {
  exactPayload(payload ?? {}, []);
  const { state, venture } = readVenture(deps, ctx);
  const readiness = offerReadiness(state, venture);
  const proposals = listRecords(state, 'venture-proposal', venture.id).filter(item => item.proposalKind === 'find-customers');
  const titleOf = new Map(proposals.map(item => [item.id, item.title]));
  const cards = proposals.filter(item => item.status === 'raised').map(item => ({ id: item.id, title: item.title, at: item.raisedAt ?? item.at, rowId: proposalRowId(state, venture, item) }));
  const tries = searchesOf(state, venture.id).map(item => ({ id: item.id, proposalId: item.proposalId, state: item.state, title: titleOf.get(item.proposalId) ?? SEARCH_TITLE, line: item.line, at: item.at, found: item.found }));
  const leads = new Map(listRecords(state, 'venture-lead', venture.id).map(lead => [lead.id, lead]));
  const found: FoundLeadView[] = listRecords(state, 'venture-lead-source', venture.id).filter(source => source.searchId && source.leadId && leads.has(source.leadId)).reverse().slice(0, VIEW_FOUND)
    .map(source => {
      const lead = leads.get(source.leadId!)!;
      // A lead a search found always has its page: the lead's own, as the source record keeps it too.
      return { leadId: lead.id, name: lead.name, email: lead.email, sourceUrl: lead.sourceUrl ?? source.url ?? '', source: foundSource(source.source, source.server), licence: source.licence, searchId: source.searchId! };
    });
  // Where the map does not fit the plan's customers (mapNote), the line about no lead tool does not offer the map.
  const mapNote = mapNoteOf(state, venture);
  return {
    ready: readiness.ready, missing: readiness.missing, gate: readiness.ready ? null : notReadyLine(readiness.missing), brief: seededBrief(state, venture),
    kinds: PLACE_KINDS.map(kind => ({ tag: kind.tag, label: kind.label })), sources: leadSources(state, venture.id),
    note: leadTools(state, venture.id).length ? null : mapNote ? NO_LEAD_TOOL_ONLY : NO_LEAD_TOOL, mapNote,
    searches: searchList(cards, tries).slice(0, VIEW_SEARCHES), found,
  };
}

function capabilityFor(deps: VentureDeps, ctx: Context, ventureId: string, workId: string): BusinessCapability {
  return new BusinessCapability({ workId, ventureId, purpose: 'find-customers', memberId: ctx.memberId, epoch: ctx.epoch }, ctx, scope => {
    authorize(deps.store, ctx, 'prepare');
    const { state, venture } = readVenture(deps, ctx);
    check(venture.id === scope.ventureId && !deps.closing?.signal.aborted, 'JOB_CLOSED', 'This business is no longer open.');
    requireOfferReady(state, venture);
  });
}

/** Opens the business scope for one look at a connected server, and always closes it. */
async function withTools<T>(deps: VentureDeps, ctx: Context, ventureId: string, work: (mcp: import('../agent-runtime/business-mcp.ts').BusinessMcp) => Promise<T>): Promise<T> {
  const { openBusinessMcp } = await import('../agent-runtime/business-mcp.ts');
  const capability = capabilityFor(deps, ctx, ventureId, 'find-customers-card');
  const mcp = openBusinessMcp(deps, capability, { signal: deps.closing?.signal ?? new AbortController().signal, ...(deps.findPorts ?? {}) });
  try { return await work(mcp); } finally { capability.close(); await mcp.close().catch(() => undefined); }
}

/** venture.leads.find.tools { serverId } (read, inside the app): a connected server's tools. Lists; calls nothing. */
export async function leadsFindTools(deps: VentureDeps, ctx: Context, payload: unknown): Promise<FindToolsView> {
  requireAppChannel(ctx, 'venture.leads.find.tools');
  const body = exactPayload(payload, ['serverId'], ['serverId']);
  check(typeof body.serverId === 'string' && /^[a-z][a-z0-9_-]{0,63}$/.test(body.serverId), 'INVALID_VENTURE_REQUEST', 'Choose one of your connected tools.');
  const serverId = body.serverId;
  const { state, venture } = readVenture(deps, ctx);
  requireOfferReady(state, venture);
  check(leadTools(state, venture.id).some(server => server.id === serverId), 'MCP_SERVER_NOT_FOUND', 'Choose one of your connected tools.');
  return { serverId, tools: await withTools(deps, ctx, venture.id, mcp => mcp.tools(serverId)) };
}

/**
 * venture.leads.find.propose { brief } (prepare, inside the app): the owner's own search as a card on Today, raised at
 * once. The same brief already waiting answers with its card. Nothing runs here.
 */
export async function leadsFindPropose(deps: VentureDeps, ctx: Context, payload: unknown): Promise<FindProposed> {
  requireAppChannel(ctx, 'venture.leads.find.propose');
  const body = exactPayload(payload, ['brief'], ['brief']);
  authorize(deps.store, ctx, 'prepare');
  const { state, venture } = readVenture(deps, ctx);
  // The gate, before the brief is even read: nothing about finding customers goes ahead until what is sold is ready.
  requireOfferReady(state, venture);
  const brief: FindBrief = checkBrief(body.brief);
  let pin: FindPin | null = null;
  if (brief.source.kind === 'connected') {
    const source = brief.source;
    const server = leadTools(state, venture.id).find(item => item.id === source.serverId);
    check(server, 'MCP_SERVER_NOT_FOUND', 'Choose one of your connected tools.');
    // A tool Chausar knows is paid needs its price on the rate card before any card is made (SPEND_UNPRICED, as it is).
    findCost(state, venture.id, brief, null, server);
    const look = await withTools(deps, ctx, venture.id, mcp => mcp.look({ serverId: source.serverId, tool: source.tool, arguments: source.arguments }));
    refuseForbiddenLeadCall({ name: look.tool, description: look.description }, source.arguments);
    pin = { serverName: look.serverName, description: look.description, fingerprint: look.fingerprint, argumentsDigest: look.argumentsDigest, approval: look.approval };
  }
  const input: FindInput = { brief, pin };
  return ventureAction(deps, ctx, 'prepare', 'leads.find.propose', tx => {
    const current = tx.venture!;
    requireOfferReady(tx.state, current);
    const gate = findTarget(tx.state, current, input as unknown as Json);
    check(gate.ok, 'INVALID_VENTURE_REQUEST', gate.ok ? '' : `This search can't go ahead: ${gate.reason}`);
    const answer = (record: ProposalRecord): FindProposed => ({ proposal: proposalView(tx.state, current, record), rowId: proposalRowId(tx.state, current, record), title: record.title, line: record.line });
    const mine = tx.list('venture-proposal').filter(item => item.ventureId === current.id && item.proposalKind === 'find-customers' && item.status === 'raised');
    const same = mine.find(item => JSON.stringify(item.input) === JSON.stringify(input));
    if (same) return answer(same);
    check(mine.length < OPEN_CARDS, 'INVALID_VENTURE_REQUEST', 'Several searches already wait on Today. Approve or dismiss one first.');
    const { title, line, spends } = gate.target;
    const drafted = draftProposal(tx, { kind: 'find-customers', source: 'owner', title, line, input: input as unknown as Json, agent: null, spends, sends: false });
    const raised = tx.replace<ProposalRecord>({ ...drafted, status: 'raised', raisedAt: tx.now });
    tx.emit('proposal.created', { proposalId: raised.id });
    tx.emit('queue.changed', { rowId: proposalRowId(tx.state, current, raised) });
    tx.emit('pipeline.changed', {});
    return answer(raised);
  });
}
