// Chausar finding customers with a tool the owner connected, with no client order (customers/find-run.ts over
// agent-runtime/business-mcp.ts), and the chief's own proposal of a search. The connected server is a stand-in, as in
// the other MCP tests; the spend card and the journal are the real ones.
import test from 'node:test';
import assert from 'node:assert/strict';
import { call, code, owner, seedBlueprint, seedOrder, setup, type Env } from './venture-views-env.ts';
import type { ProposalRecord, QueueRow } from '../runtime/venture/contracts.ts';
import { listRecords, ventureAction } from '../runtime/venture/records.ts';
import { getAgentSettings, setAgentSettings } from '../runtime/venture/agent-runtime/settings-methods.ts';
import { CURATED_MCP_SERVERS } from '../runtime/venture/agent-runtime/mcp-registry.ts';
import { CHECKED_READ_ONLY } from '../runtime/venture/agent-runtime/mcp-policy.ts';
import type { ExternalTool } from '../runtime/venture/agent-runtime/external-client.ts';
import { leadsFindPropose, leadsFindTools, leadsFindView } from '../runtime/venture/customers/find-methods.ts';
import { moveSearch, openSearch, noteSearch } from '../runtime/venture/customers/find-search.ts';
import { SEARCH_LINES } from '../runtime/venture/customers/find-states.ts';
import { connectedLicence } from '../runtime/venture/customers/sources/connected.ts';
import { approveSpendQuote, setSpendPolicy } from '../runtime/venture/money/spend.ts';
import { journalled } from '../runtime/venture/journal/journal.ts';
import { sweepWholeJournal } from '../runtime/venture/build/journal-sweep.ts';
import { availableKinds, draftFromModel, proposalsRaiseHandler } from '../runtime/venture/chief/proposals.ts';
import { ownerSet } from '../runtime/venture/core/owner.ts';
import { draftProposal } from '../runtime/venture/chief/store.ts';

const SAMPLE = { id: 'sample', name: 'Sample leads', transport: 'stdio' as const, command: process.execPath, args: [] as string[] };
const SEARCH: ExternalTool = { name: 'search_companies', description: 'Search public company listings by words and city.', inputSchema: { type: 'object', properties: { query: { type: 'string' }, city: { type: 'string' } }, required: ['query'] } };
const ROWS = [
  { id: 'c1', name: 'Northwind Labs', website: 'https://northwind.example', email: 'founders@northwind.example', address: 'Indiranagar, Bengaluru' },
  { id: 'c2', name: 'Paper Boat Software', url: 'https://directory.example/paper-boat' },
  { name: 'No page', email: 'x@nopage.example' },
];
const INPUTS = { query: 'early stage software startups', city: 'Bengaluru' };
const BRIEF = { who: 'Startups that need a product plan', place: 'Bengaluru', category: '', count: 5, source: { kind: 'connected' as const, serverId: 'sample', tool: 'search_companies', arguments: INPUTS } };

async function fixture(servers: unknown[] = [SAMPLE]) {
  const env = await setup();
  const blueprint = await seedBlueprint(env, { status: 'accepted', price2: '250000' });
  const view = await getAgentSettings(env.deps, owner, {});
  view.settings.mcpServers = servers as typeof view.settings.mcpServers;
  await setAgentSettings(env.deps, owner, { settings: view.settings, approveMcpConfiguration: true });
  const server = { tool: structuredClone(SEARCH), calls: [] as unknown[], connects: 0, answer: async (): Promise<unknown> => ({ content: [{ type: 'text', text: JSON.stringify({ results: ROWS }) }] }) };
  env.deps.findPorts = { connect: async () => { server.connects += 1; return { list: async () => [structuredClone(server.tool)], call: async (_name: string, args: Record<string, unknown>) => { server.calls.push(args); return server.answer(); }, close: async () => undefined }; } };
  env.deps.net = { resolve: async () => [{ address: '93.184.216.34', family: 4 as const }], send: async (target: any) => ({ status: 200, headers: {}, body: Buffer.from(target.url.pathname === '/robots.txt' ? 'User-agent: *\nAllow: /' : '<p>hello</p>') }) };
  env.deps.mx = async domain => [{ exchange: `mx.${domain}`, priority: 10 }];
  return { env, server, blueprint };
}
const proposalOf = (env: Env, id: string) => listRecords(env.store.read(), 'venture-proposal').find(item => item.id === id)!;
const searches = (env: Env) => listRecords(env.store.read(), 'venture-lead-search');
const rows = async (env: Env) => (await call<{ rows: QueueRow[] }>(env, 'venture.queue.list')).rows;
const approve = async (env: Env, rowId: string) => {
  const row = (await rows(env)).find(item => item.id === rowId);
  assert.ok(row, `no card ${rowId} on Today`);
  return call<{ outcome: string; reason?: string; line: string }>(env, 'venture.queue.decide', { id: row.id, digest: row.digest, action: 'approve' });
};

test('a connected tool is a lead source of its own: listed as untried, its tools read by name, and nothing is called to make the card', async () => {
  const { env, server } = await fixture();
  const view = await leadsFindView(env.deps, owner, {});
  assert.equal(view.note, null);
  assert.deepEqual(view.sources.map(source => [source.id, source.label, source.usable]), [['public-map', 'read', true], ['sample', 'planned', true], ['monid', 'planned', false]]);
  assert.equal(view.sources[1]!.waitsOn, 'Built and tested against a sample server. Not tried on a live account yet.');
  assert.deepEqual(await leadsFindTools(env.deps, owner, { serverId: 'sample' }), { serverId: 'sample', tools: [{ name: 'search_companies', description: SEARCH.description, approval: 'every-call' }] });
  await assert.rejects(leadsFindTools(env.deps, owner, { serverId: 'elsewhere' }), code('MCP_SERVER_NOT_FOUND'));
  const proposed = await leadsFindPropose(env.deps, owner, { brief: BRIEF });
  assert.equal(proposed.title, 'Find possible customers in Bengaluru with Sample leads');
  assert.equal(proposed.line, 'Calls Sample leads once, its tool search_companies, with exactly the inputs shown, keeps up to 5 of the businesses it returns, and reads each one\'s own website for a contact email. '
    + 'Chausar does not know what Sample leads charges. Anything it charges is on your account with it. Its own terms apply to what it returns. Nothing is sent. You check the list and write to each one yourself.');
  assert.equal(proposed.proposal.secondAsk, true, 'a call that may cost asks twice');
  const input = proposalOf(env, proposed.proposal.id).input as any;
  assert.deepEqual(input.brief.source.arguments, INPUTS, 'the card holds the exact inputs');
  assert.equal(input.pin.description, SEARCH.description);
  assert.deepEqual(server.calls, [], 'making the card listed the tools and called none');
});

test('approving the card calls the tool once under the business scope, journals it, and lists what it returned with its source', async () => {
  const { env, server } = await fixture();
  const proposed = await leadsFindPropose(env.deps, owner, { brief: BRIEF });
  const decided = await approve(env, proposed.rowId);
  assert.equal(decided.outcome, 'done', JSON.stringify(decided));
  assert.equal(decided.line, 'Found 2 possible customers in Bengaluru. One has a contact email. They are in Clients, Pipeline, each with its source. Nothing was sent.');
  assert.deepEqual(server.calls, [INPUTS], 'exactly the approved inputs, once');
  const [search] = searches(env);
  assert.equal(search!.state, 'done');
  const [entry] = listRecords(env.store.read(), 'venture-journal-entry');
  assert.deepEqual([entry!.action, entry!.state, entry!.subject, entry!.id], ['connector.write', 'applied', `lead-search:${proposed.proposal.id}`, search!.journalId]);
  assert.deepEqual([entry!.describe, entry!.target], ['One call to Sample leads, its tool search_companies, for the search you approved on Today.', 'Sample leads: search_companies']);
  assert.deepEqual(listRecords(env.store.read(), 'venture-spend'), [], 'no price was known, so nothing was metered or shown as a cost');
  const leads = listRecords(env.store.read(), 'venture-lead');
  assert.deepEqual(leads.map(lead => [lead.name, lead.email, lead.sourceUrl]).sort(), [['Northwind Labs', 'founders@northwind.example', 'https://northwind.example/'], ['Paper Boat Software', null, 'https://directory.example/paper-boat']]);
  const sources = listRecords(env.store.read(), 'venture-lead-source');
  assert.ok(sources.length === 2 && sources.every(source => source.source === 'connected' && source.server === 'Sample leads' && source.licence === connectedLicence('Sample leads') && source.searchId === search!.id));
  assert.deepEqual((await leadsFindView(env.deps, owner, {})).found.map(item => [item.name, item.source]), [['Northwind Labs', 'Sample leads'], ['Paper Boat Software', 'Sample leads']]);
  // No client, order or run was made up for it.
  assert.deepEqual([listRecords(env.store.read(), 'venture-client').length, listRecords(env.store.read(), 'venture-order').length, listRecords(env.store.read(), 'venture-delivery-run').length], [0, 0, 0]);
});

test('a priced tool shows its cost from the rate card and goes through the spend card: held before the call, settled after, a quote first above the ask-first figure', async () => {
  const { env, server } = await fixture();
  await setSpendPolicy(env.deps, owner, { rates: [{ item: 'connector:mcp-sample', unit: 'per-call', microsPerCall: '20000', source: 'Sample leads price page', checkedOn: '2026-11-14' }] });
  const proposed = await leadsFindPropose(env.deps, owner, { brief: BRIEF });
  assert.match(proposed.line, /It costs \$0\.02 per call, the price on your rate card, paid from your Sample leads account\./);
  assert.equal((await approve(env, proposed.rowId)).outcome, 'done');
  const [spend] = listRecords(env.store.read(), 'venture-spend');
  assert.deepEqual([spend!.key, spend!.item, spend!.phase, spend!.reservedMicros, spend!.settledMicros, spend!.connector, spend!.payer], [`lead-search:${proposed.proposal.id}`, 'connector:mcp-sample', 'settled', '20000', '20000', 'sample', 'connector:sample']);
  assert.equal(searches(env)[0]!.spendKey, spend!.key);
  // A changed price makes the card one the owner has not approved.
  const second = await leadsFindPropose(env.deps, owner, { brief: { ...BRIEF, count: 6 } });
  await setSpendPolicy(env.deps, owner, { rates: [{ item: 'connector:mcp-sample', unit: 'per-call', microsPerCall: '90000', source: 'Sample leads price page', checkedOn: '2026-11-14' }] });
  assert.equal((await rows(env)).some(row => row.id === second.rowId), false);
  assert.match((await rows(env)).find(row => row.kind === 'proposal')!.line!, /^This can't go ahead now: it changed since Chausar drafted it\./);
  // Above the ask-first figure the call waits for the owner's quote: refused, nothing sent, the card back on Today.
  await setSpendPolicy(env.deps, owner, { askAboveMicros: '10000' });
  const third = await leadsFindPropose(env.deps, owner, { brief: { ...BRIEF, count: 7 } });
  const waiting = await approve(env, third.rowId);
  assert.deepEqual([waiting.outcome, waiting.reason], ['refused', 'QUOTE_WAITING']);
  assert.equal(server.calls.length, 1, 'only the first search called the tool');
  assert.equal(listRecords(env.store.read(), 'venture-spend-quote').filter(quote => quote.status === 'open' && quote.item === 'connector:mcp-sample').length, 1);
  assert.equal(proposalOf(env, third.proposal.id).status, 'raised');
  assert.equal(searches(env).at(-1)!.state, 'failed');
  // The owner approves that quote; the same card then runs, once.
  const quote = listRecords(env.store.read(), 'venture-spend-quote').find(item => item.status === 'open')!;
  await approveSpendQuote(env.deps, owner, { quoteId: quote.id, draftDigest: quote.draftDigest, figureMicros: quote.figureMicros, payer: quote.payer });
  const ran = await approve(env, third.rowId);
  assert.equal(ran.outcome, 'done', JSON.stringify(ran));
  assert.equal(server.calls.length, 2);
  assert.equal(listRecords(env.store.read(), 'venture-spend').filter(row => row.phase === 'settled').length, 2);
});

test('a call whose answer never came is in doubt: the search ends unknown, the card is settled and never run again on its own', async () => {
  const { env, server } = await fixture();
  await setSpendPolicy(env.deps, owner, { rates: [{ item: 'connector:mcp-sample', unit: 'per-call', microsPerCall: '20000', source: 'Sample leads price page', checkedOn: '2026-11-14' }] });
  server.answer = async () => { throw new Error('connection lost'); };
  const proposed = await leadsFindPropose(env.deps, owner, { brief: BRIEF });
  const decided = await approve(env, proposed.rowId);
  assert.equal(decided.outcome, 'done');
  assert.equal(decided.line, 'Check Sample leads before searching again: the call may have run and may have been charged. Chausar will not run it again on its own.');
  assert.equal(searches(env)[0]!.state, 'unknown');
  assert.equal(listRecords(env.store.read(), 'venture-journal-entry')[0]!.state, 'outcome_unknown');
  assert.equal(listRecords(env.store.read(), 'venture-spend')[0]!.phase, 'unknown', 'the charge stays held at its estimate');
  assert.equal(proposalOf(env, proposed.proposal.id).status, 'approved', 'not put back on Today for a blind second call');
  assert.equal((await rows(env)).some(row => row.kind === 'proposal'), false);
  assert.equal(server.calls.length, 1);
  assert.equal(listRecords(env.store.read(), 'venture-lead').length, 0);
});

test('a restart during the call leaves the search unknown, not running, once the journal says the call is in doubt', async () => {
  const { env } = await fixture();
  const proposed = await leadsFindPropose(env.deps, owner, { brief: BRIEF });
  const search = await ventureAction(env.deps, owner, 'approve', 'test.claim', tx => {
    const record = tx.find('venture-proposal', proposed.proposal.id)!;
    tx.replace<ProposalRecord>({ ...record, status: 'approved', decidedAt: tx.now, decidedBy: owner.memberId, outcome: 'Approved.' });
    return openSearch(tx, record);
  });
  await moveSearch(env.deps, owner, search.id, 'running', { line: SEARCH_LINES.running });
  // The call was claimed in the journal and the process stopped before its end was written.
  let claimed!: () => void;
  const reached = new Promise<void>(resolve => { claimed = resolve; });
  void journalled(env.deps, owner, { action: 'connector.write', operation: 'lead-search', subject: `lead-search:${proposed.proposal.id}`, target: 'Sample leads: search_companies', actionDigest: 'digestofthecall', line: 'One call to Sample leads.', descriptionComplete: true, account: 'sample' },
    async handle => { await noteSearch(env.deps, owner, search.id, { journalId: handle.entry.id }); claimed(); return new Promise<never>(() => undefined); }, { account: 'sample' });
  await reached;
  env.advance(5);
  await sweepWholeJournal(env.deps, owner, 1);
  const [ended] = searches(env);
  assert.equal(ended!.state, 'unknown');
  assert.equal(ended!.line, SEARCH_LINES.unknown);
  assert.equal(listRecords(env.store.read(), 'venture-journal-entry')[0]!.state, 'outcome_unknown');
  assert.equal(proposalOf(env, proposed.proposal.id).outcome, SEARCH_LINES.unknown);
});

test('what the founder rules never allow is refused whatever the owner approves, and a tool that changed asks again', async () => {
  const { env, server, blueprint } = await fixture();
  // A client's details never go into a search for the business.
  const { client } = await seedOrder(env, blueprint);
  await assert.rejects(leadsFindPropose(env.deps, owner, { brief: { ...BRIEF, source: { ...BRIEF.source, arguments: { query: `companies like ${client.name}` } } } }), code('CLIENT_AI_CONSENT_REQUIRED'));
  // LinkedIn is copy and open only.
  await assert.rejects(leadsFindPropose(env.deps, owner, { brief: { ...BRIEF, source: { ...BRIEF.source, arguments: { query: 'founders on linkedin.com in Bengaluru' } } } }), code('LEAD_SOURCE_FORBIDDEN'));
  server.tool = { ...SEARCH, name: 'linkedin_people_search' };
  await assert.rejects(leadsFindPropose(env.deps, owner, { brief: { ...BRIEF, source: { ...BRIEF.source, tool: 'linkedin_people_search' } } }), code('LEAD_SOURCE_FORBIDDEN'));
  server.tool = structuredClone(SEARCH);
  const proposed = await leadsFindPropose(env.deps, owner, { brief: BRIEF });
  server.tool.description = 'Search listings and write to each company for you.';
  const changed = await approve(env, proposed.rowId);
  assert.deepEqual([changed.outcome, changed.reason], ['refused', 'MCP_TOOL_CHANGED']);
  assert.deepEqual(server.calls, []);
  assert.equal(searches(env)[0]!.state, 'failed');
  assert.equal(proposalOf(env, proposed.proposal.id).status, 'raised');
});

test('Monid is in the curated list with only what its own docs confirm, is never pinned read-only, and needs its price before any card', async () => {
  const monid = CURATED_MCP_SERVERS.find(entry => entry.id === 'monid')!;
  assert.deepEqual(monid.server, { id: 'monid', name: 'Monid', transport: 'http', url: 'https://mcp.monid.ai/v1', oauth: true });
  assert.deepEqual([monid.signIn, monid.access, monid.finds, monid.paid, monid.registryName, monid.docs], ['oauth', 'write', 'leads', true, null, 'https://monid.ai/docs/guide/quickstart-mcp']);
  assert.equal(CHECKED_READ_ONLY.some(entry => 'url' in entry.server && entry.server.url.includes('monid')), false, 'its tool names are not published, so none is pinned: every call asks');
  const { env, server } = await fixture([monid.server]);
  const view = await leadsFindView(env.deps, owner, {});
  assert.deepEqual(view.sources.map(source => [source.id, source.label, source.usable]), [['public-map', 'read', true], ['monid', 'planned', true]]);
  const brief = { ...BRIEF, source: { kind: 'connected' as const, serverId: 'monid', tool: 'run', arguments: { query: 'cafes in Pune' } } };
  await assert.rejects(leadsFindPropose(env.deps, owner, { brief }), (error: any) => code('SPEND_UNPRICED')(error) && /Add its price to your rate card first/.test(error.message));
  assert.equal(server.connects, 0, 'nothing connected before the price is known');
  // The other curated servers are for something else and are not offered as lead tools.
  const notion = CURATED_MCP_SERVERS.find(entry => entry.id === 'notion')!;
  const other = await fixture([notion.server]);
  assert.deepEqual((await leadsFindView(other.env.deps, owner, {})).sources.map(source => source.id), ['public-map', 'monid']);
  await assert.rejects(leadsFindPropose(other.env.deps, owner, { brief: { ...BRIEF, source: { ...BRIEF.source, serverId: 'notion' } } }), code('MCP_SERVER_NOT_FOUND'));
});

test('the chief may propose a search in plain words; code makes the exact brief, holds it to the gate, and it runs only once approved on Today', async () => {
  const kinds = await availableKinds();
  const uses = kinds.find(item => item.kind === 'find-customers')?.uses ?? '';
  assert.match(uses, /one kind of place and the city/);
  assert.match(uses, /offerReady/);
  const available = kinds.map(item => item.kind);
  const raw = (fields: Record<string, string>) => ({ kind: 'find-customers', agent: '', orderId: '', offerId: '', invoiceId: '', opportunityId: '', quantity: '', outreachKind: '', channel: '', text: '', ...fields });
  // Not ready: refused by code, whatever the chief wrote.
  const early = await setup();
  await seedBlueprint(early, { status: 'accepted' });
  const refused = draftFromModel(early.store.read(), listRecords(early.store.read(), 'venture-record')[0]!, raw({ text: 'cafes in Pune' }), 'find me customers', available);
  assert.equal(refused.kind, 'refused');
  assert.match((refused as { reason: string }).reason, /^what you sell is not ready yet\. Set your price for /);
  // Ready: an exact public map brief.
  const { env } = await fixture([]);
  const state = env.store.read(), venture = listRecords(state, 'venture-record')[0]!;
  const none = draftFromModel(state, venture, raw({ text: 'people who love pottery in Pune' }), 'find me customers', available);
  assert.match((none as { reason: string }).reason, /public map has no kind of place/);
  const drafted = draftFromModel(state, venture, raw({ text: 'cafes in Pune', quantity: '4' }), 'find me customers', available);
  assert.equal(drafted.kind, 'proposal');
  const input = (drafted as Extract<typeof drafted, { kind: 'proposal' }>).input;
  assert.deepEqual(input.input, { brief: { who: 'cafes', place: 'Pune', category: 'amenity=cafe', count: 4, source: { kind: 'public-map' } }, pin: null });
  assert.equal(input.title, 'Find possible customers: cafes in Pune');
  assert.deepEqual([input.spends, input.sends, input.source], [false, false, 'chief']);
  // Found live, 15 Nov 2026: the review offered "companies in Lucknow" to a technician whose plan sells to offices and
  // housing societies. The plan's own customers decide the kind: a search for one of them is drafted by its honest name,
  // another kind is refused, and so is any map search when the plan's customers are not places on a map.
  assert.match(uses, /business\.mapKinds/);
  const wayOf = (customer: string, reach: string) => ({ customer, reach, teamDoes: 'Drafts each message for your approval.', youDo: 'Do the work and send each message.', firstWeek: ['Prepare the offers.'] });
  await ownerSet(env.deps, owner, { way: wayOf('Offices and housing societies pay for yearly AC and fridge maintenance; homes pay for repairs.', 'Find offices and housing societies in Lucknow through public sources and contacts you provide.') });
  const fresh = env.store.read();
  const titleOf = (text: string) => { const made = draftFromModel(fresh, venture, raw({ text, quantity: '20' }), '', available); return made.kind === 'proposal' ? made.input.title : `refused: ${(made as { reason: string }).reason}`; };
  assert.equal(titleOf('offices in Lucknow'), 'Find possible customers: company offices in Lucknow');
  assert.equal(titleOf('housing societies in Lucknow'), 'Find possible customers: apartment blocks in Lucknow');
  assert.equal(titleOf('cafes in Lucknow'), 'refused: the plan sells to company offices and apartment blocks, so a search is for one of those.');
  await ownerSet(env.deps, owner, { way: wayOf('YouTube creators and small production houses pay for Hindi-English translation and video subtitles.', 'Find potential YouTube creators and small production houses through public sources and contacts you provide.') });
  const online = draftFromModel(env.store.read(), venture, raw({ text: 'companies in Bhopal' }), '', available);
  assert.equal((online as { reason: string }).reason, 'the public map lists places only, and the plan\'s customers are not places on it. The owner can add people they know in Clients.');
  await ownerSet(env.deps, owner, { way: wayOf('Local shops that need a simple website.', 'Walk in and show a sample.') });
  assert.equal(draftFromModel(env.store.read(), venture, raw({ text: 'cafes in Pune' }), '', available).kind, 'proposal', 'places of no listed kind: the nearest kind is the chief\'s to suggest');
  const stored = await ventureAction(env.deps, owner, 'prepare', 'test.draft', tx => draftProposal(tx, input));
  assert.equal(searches(env).length, 0);
  const raised = await proposalsRaiseHandler(env.deps, owner, { id: stored.id });
  assert.equal(raised.proposal.kind, 'find-customers');
  env.deps.net = { resolve: async () => [{ address: '93.184.216.34', family: 4 as const }], send: async (target: any) => ({ status: 200, headers: {}, body: Buffer.from(target.url.hostname === 'nominatim.openstreetmap.org' ? '[{"boundingbox":["18.4","18.7","73.7","74.0"]}]' : JSON.stringify({ elements: [{ type: 'node', id: 7, lat: 18.5, lon: 73.8, tags: { name: 'Seventh Cup', amenity: 'cafe' } }] })) }) };
  const decided = await approve(env, raised.rowId!);
  assert.equal(decided.line, 'Found one possible customer in Pune. None showed a contact email. They are in Clients, Pipeline, each with its source. Nothing was sent.');
  assert.deepEqual(searches(env).map(item => item.state), ['done']);
});
