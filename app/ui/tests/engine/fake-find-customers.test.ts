import { describe, expect, it } from 'vitest';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { CURATED_MCP_SERVERS } from '../../../../platform/runtime/venture/agent-runtime/mcp-registry';

// Finding customers, for every business: the fake engine answers as the engine's customers/find-methods.ts,
// find-target.ts and find-run.ts do (the engine's own tests are platform/tests/venture-find-run.test.ts and
// venture-find-connected.test.ts): the same gate, the same card words, the same states, and nothing sent.

const BRIEF = { who: 'Cafes that buy handmade tableware in bulk', place: 'Pune', category: 'amenity=cafe', count: 3, source: { kind: 'public-map' as const } };
const fake = () => createFakeClient(new FakeEngine());
type Client = ReturnType<typeof fake>;
/** The sample business has one offer with no price yet. The owner sets it, and what is sold is ready. */
async function priced(client: Client): Promise<Client> {
  const plan = (await client.request('venture.blueprint.get', {}))!;
  const offers = plan.blueprint.offers.filter((offer) => offer.pricing.unitPriceMinor === null).map((offer) => ({ id: offer.id, unitPrice: '4000' }));
  await client.request('venture.blueprint.update', { patch: { offers } });
  return client;
}
const cardLine = 'Looks on OpenStreetMap, a public map, for up to 3 cafes in Pune, and reads each one\'s own website for a contact email. It finds only places listed there by name, so some will be missing. It is free and needs no account. No lead tool is connected; you can add one in Connections. Nothing is sent. You check the list and write to each one yourself.';

describe('fake finding customers', () => {
  it('the view says whether what is sold is ready, offers the brief, and labels every lead source honestly', async () => {
    const client = await priced(fake());
    const view = await client.request('venture.leads.find.view', {});
    expect([view.ready, view.missing]).toEqual([true, []]);
    expect(view.brief).toMatchObject({ count: 10, source: { kind: 'public-map' } });
    expect(view.note).toBe('No lead tool is connected. The public map search needs nothing.');
    expect(view.sources.map((source) => [source.id, source.label, source.usable])).toEqual([['public-map', 'read', true], ['monid', 'planned', false]]);
    expect(view.sources[1]!.waitsOn).toBe('Needs your own Monid account, added in Connections, MCP servers. Not tried on a live account yet.');
    expect(view.kinds.find((kind) => kind.tag === 'amenity=cafe')).toEqual({ tag: 'amenity=cafe', label: 'Cafes' });
    expect([view.searches, view.found]).toEqual([[], []]);
  });

  it('customers who are not places get one line saying the map lists places only; the brief is seeded as the engine seeds it', async () => {
    const client = await priced(fake());
    const way = (customer: string, reach: string) => ({ customer, reach, teamDoes: 'Drafts each message for your approval.', youDo: 'Do the work and send each message.', firstWeek: ['Prepare the offers.'] });
    await client.request('venture.owner.set', { way: way('Offices and housing societies in Lucknow pay for yearly AC maintenance.', 'Visits and calls.') });
    let view = await client.request('venture.leads.find.view', {});
    expect([view.mapNote, view.brief.place, view.brief.category]).toEqual([null, 'Lucknow', 'office=company']);
    expect(view.kinds.find((kind) => kind.tag === 'building=apartments')).toEqual({ tag: 'building=apartments', label: 'Apartment blocks' });
    await client.request('venture.owner.set', { way: way('YouTube creators and small production houses pay for subtitles.', 'Through contacts you provide.') });
    view = await client.request('venture.leads.find.view', {});
    expect(view.mapNote).toBe('The public map lists places only, and your customers are not a kind of place on it. For now, add people you already know in Clients, or use a lead tool once you connect one.');
    expect([view.brief.place, view.brief.category]).toEqual(['', '']);
    // As the engine (platform/tests/venture-copy-round3.test.ts): under that note no line recommends the map.
    expect(view.note).toBe('No lead tool is connected.');
    expect(view.sources.find((source) => source.id === 'monid')!.meanwhile).toBe('Add people you already know in Clients.');
    const needs = await client.request('venture.needs.list', {});
    expect(JSON.stringify(needs.groups.flatMap((group) => group.ways.filter((way) => way.id !== 'public-map').map((way) => way.meanwhile)))).not.toMatch(/public map/i);
  });

  it('a new business with no way kept reads the city and the kind from the owner\'s own about words', async () => {
    const engine = new FakeEngine({ fresh: true });
    const client = createFakeClient(engine);
    await client.request('workspace.create', { name: 'Clay Corner', pack: 'services' } as never);
    await client.request('venture.create', { idea: 'I make pottery by hand, mostly mugs and bowls, and I want bulk orders from cafes and hotels in Pune.', countryCode: 'IN' } as never);
    const view = await client.request('venture.leads.find.view', {});
    expect(view.brief).toEqual({ who: '', place: 'Pune', category: 'amenity=cafe', count: 10, source: { kind: 'public-map' } });
    expect(view.mapNote).toBeNull();
  });

  it('a search is refused until every offer has its price, in the engine\'s words', async () => {
    const client = fake();
    const view = await client.request('venture.leads.find.view', {});
    expect([view.ready, view.missing]).toEqual([false, ['Set your price for Shorts from your long video.']]);
    await expect(client.request('venture.leads.find.propose', { brief: BRIEF })).rejects.toMatchObject({ code: 'PRICE_REQUIRED', message: 'Finding customers waits until what you sell is ready. Set your price for Shorts from your long video.' });
    await expect(client.request('venture.leads.find.tools', { serverId: 'sample' })).rejects.toMatchObject({ code: 'PRICE_REQUIRED' });
    expect((await client.request('venture.queue.list', {})).rows.some((row) => row.title.startsWith('Find possible customers'))).toBe(false);
  });

  it('the owner starts a search: a card on Today in the engine\'s exact words; approving it adds leads with their source and sends nothing', async () => {
    const client = await priced(fake());
    await expect(client.request('venture.leads.find.propose', { brief: { ...BRIEF, category: '' } })).rejects.toMatchObject({ code: 'LEAD_SOURCE_REQUIRED' });
    await expect(client.request('venture.leads.find.propose', { brief: { ...BRIEF, count: 51 } })).rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST', message: 'Choose how many to find, from one to fifty.' });
    const before = (await client.request('venture.leads.list', {})).leads.length;
    const proposed = await client.request('venture.leads.find.propose', { brief: BRIEF });
    expect([proposed.title, proposed.line]).toEqual(['Find possible customers: cafes in Pune', cardLine]);
    expect([proposed.proposal.kind, proposed.proposal.status, proposed.proposal.secondAsk]).toEqual(['find-customers', 'raised', false]);
    expect((await client.request('venture.leads.find.propose', { brief: BRIEF })).rowId).toBe(proposed.rowId);
    expect((await client.request('venture.leads.find.view', {})).searches.map((item) => [item.state, item.rowId, item.line])).toEqual([['proposed', proposed.rowId, 'On Today for your approval. Nothing has run.']]);
    expect((await client.request('venture.leads.list', {})).leads.length).toBe(before);
    const row = (await client.request('venture.queue.list', {})).rows.find((item) => item.id === proposed.rowId)!;
    expect([row.kind, row.title, row.line]).toEqual(['proposal', proposed.title, `${cardLine} Nothing changes until you approve.`]);
    expect(row.actions.map((action) => action.id)).toEqual(['deny', 'approve']);
    const decided = await client.request('venture.queue.decide', { id: row.id, digest: row.digest, action: 'approve' });
    expect(decided).toMatchObject({ outcome: 'done', line: 'Found 2 possible customers in Pune. None showed a contact email. They are in Clients, Pipeline, each with its source. Nothing was sent.' });
    const view = await client.request('venture.leads.find.view', {});
    expect(view.searches.map((item) => [item.state, item.found, item.rowId])).toEqual([['done', 2, null]]);
    expect(view.found.map((item) => [item.source, item.licence])).toEqual([['OpenStreetMap', '© OpenStreetMap contributors, ODbL'], ['OpenStreetMap', '© OpenStreetMap contributors, ODbL']]);
    const leads = (await client.request('venture.leads.list', {})).leads;
    expect(leads.length).toBe(before + 2);
    expect(leads.filter((lead) => view.found.some((item) => item.leadId === lead.id)).every((lead) => lead.status === 'new' && lead.drafts.length === 0 && lead.sends.length === 0)).toBe(true);
  });

  // Round 5 (re-check 028): the runs list carries the searches open now beside the runs, as views/runs.ts does. The
  // sample search ends within its approval, so none is open once the decision answers; a done list never holds one.
  it('the runs list carries the open searches beside the runs, with the engine\'s field, and none once a search ended', async () => {
    const client = await priced(fake());
    for (const state of ['all', 'active', 'done'] as const) expect((await client.request('venture.runs.list', { state })).searches).toEqual([]);
    const proposed = await client.request('venture.leads.find.propose', { brief: BRIEF });
    const row = (await client.request('venture.queue.list', {})).rows.find((item) => item.id === proposed.rowId)!;
    await client.request('venture.queue.decide', { id: row.id, digest: row.digest, action: 'approve' });
    expect(Object.keys(await client.request('venture.runs.list', {})).sort()).toEqual(['runs', 'searches']);
    expect((await client.request('venture.runs.list', { state: 'active' })).searches).toEqual([]);
  });

  it('a connected lead tool: its tools by name, a card that says what it costs, and Monid refused until its price is on the rate card', async () => {
    const client = await priced(fake());
    const settings = (await client.request('venture.agentSettings.get', {})).settings;
    const monid = CURATED_MCP_SERVERS.find((entry) => entry.id === 'monid')!.server;
    await client.request('venture.agentSettings.set', { settings: { ...settings, mcpServers: [{ id: 'sample', name: 'Sample leads', transport: 'http', url: 'https://leads.example/mcp' }, monid] }, approveMcpConfiguration: true });
    const view = await client.request('venture.leads.find.view', {});
    expect(view.note).toBeNull();
    expect(view.sources.map((source) => [source.id, source.label, source.usable])).toEqual([['public-map', 'read', true], ['sample', 'planned', true], ['monid', 'planned', true]]);
    expect(await client.request('venture.leads.find.tools', { serverId: 'sample' })).toEqual({ serverId: 'sample', tools: [{ name: 'search_companies', description: 'Search public company listings by words and city.', approval: 'every-call' }] });
    await expect(client.request('venture.leads.find.tools', { serverId: 'elsewhere' })).rejects.toMatchObject({ code: 'MCP_SERVER_NOT_FOUND' });
    const connected = (serverId: string, args: Record<string, string> = { query: 'software startups', city: 'Bengaluru' }) => ({ who: 'Startups that need a product plan', place: 'Bengaluru', category: '', count: 5, source: { kind: 'connected' as const, serverId, tool: 'search_companies', arguments: args } });
    await expect(client.request('venture.leads.find.propose', { brief: connected('monid') })).rejects.toMatchObject({ code: 'SPEND_UNPRICED' });
    await expect(client.request('venture.leads.find.propose', { brief: connected('sample', { query: 'founders on linkedin.com' }) })).rejects.toMatchObject({ code: 'LEAD_SOURCE_FORBIDDEN' });
    const proposed = await client.request('venture.leads.find.propose', { brief: connected('sample') });
    expect(proposed.title).toBe('Find possible customers in Bengaluru with Sample leads');
    expect(proposed.line).toBe('Calls Sample leads once, its tool search_companies, with exactly the inputs shown, keeps up to 5 of the businesses it returns, and reads each one\'s own website for a contact email. '
      + 'Chausar does not know what Sample leads charges. Anything it charges is on your account with it. Its own terms apply to what it returns. Nothing is sent. You check the list and write to each one yourself.');
    expect(proposed.proposal.secondAsk).toBe(true);
    const row = (await client.request('venture.queue.list', {})).rows.find((item) => item.id === proposed.rowId)!;
    const decided = await client.request('venture.queue.decide', { id: row.id, digest: row.digest, action: 'approve' });
    expect(decided).toMatchObject({ outcome: 'done' });
    expect((await client.request('venture.leads.find.view', {})).found.map((item) => [item.source, item.licence])).toEqual([
      ['Sample leads', 'From Sample leads, a tool you connected. Its own terms apply.'], ['Sample leads', 'From Sample leads, a tool you connected. Its own terms apply.'],
    ]);
  });
});
