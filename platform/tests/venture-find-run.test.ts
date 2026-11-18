// Chausar finding customers, for every business (customers/find-run.ts and beside it): the gate that what is sold is
// ready, the owner's approval on Today, the search over the public sources, the leads it adds with their source, and
// what a restart leaves. Every network call is a stand-in, as in the lead generation tests; nothing here is sent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { call, code, owner, phone, seedBlueprint, setup, type Env } from './venture-views-env.ts';
import type { LeadSearchRecord, ProposalRecord, QueueRow } from '../runtime/venture/contracts.ts';
import { currentVenture, listRecords, ventureAction } from '../runtime/venture/records.ts';
import { planNow, planView, savePlan, storedPlan } from '../runtime/venture/chief/plan.ts';
import { proposeMove } from '../runtime/venture/chief/plan-core.ts';
import { MAP_WORDS } from '../runtime/venture/customers/sources/osm.ts';
import { leadsFindPropose, leadsFindTools, leadsFindView } from '../runtime/venture/customers/find-methods.ts';
import { runApprovedSearch } from '../runtime/venture/customers/find-run.ts';
import { moveSearch, openSearch, recoverLeadSearches } from '../runtime/venture/customers/find-search.ts';
import { SEARCH_LINES, SEARCH_MOVES, SEARCH_STATES, searchEnded, stepSearch } from '../runtime/venture/customers/find-states.ts';
import { leadsBlock } from '../runtime/venture/customers/lead-methods.ts';
import { formatAge } from '../runtime/owner-format.ts';
import { ownerSet } from '../runtime/venture/core/owner.ts';
import { sweepWholeJournal } from '../runtime/venture/build/journal-sweep.ts';

const BRIEF = { who: 'Cafes that buy handmade tableware in bulk', place: 'Pune', category: 'amenity=cafe', count: 3, source: { kind: 'public-map' as const } };
const element = (id: number, name: string, website?: string) => ({ type: 'node', id, lat: 18.5, lon: 73.8, tags: { name, amenity: 'cafe', 'addr:street': `Lane ${id}`, 'addr:city': 'Pune', ...(website ? { website } : {}) } });
const ELEMENTS = [element(1, 'Lotus Cafe', 'https://lotus.example'), element(2, 'Brew Room'), element(3, 'Blocked Beans', 'https://www.blocked.example/menu'), element(4, 'Kettle House', 'https://kettle.example'), element(5, 'Fifth Cup', 'https://fifth.example')];

/** A stand-in for the public sources: the city lookup, the map read, and each business's own site with its robots file. */
function publicNet(options: { elements?: unknown[]; overpass?: number } = {}) {
  const seen: string[] = [];
  const net = { resolve: async () => [{ address: '93.184.216.34', family: 4 as const }], send: async (target: any) => {
    const url: URL = target.url;
    seen.push(url.href);
    assert.match(target.headers['user-agent'], /^Chausar\//);
    const body = (text: string, status = 200) => ({ status, headers: {}, body: Buffer.from(text) });
    if (url.hostname === 'nominatim.openstreetmap.org') return body('[{"boundingbox":["18.4","18.7","73.7","74.0"]}]');
    if (url.hostname === 'overpass-api.de') return body(JSON.stringify({ elements: options.elements ?? ELEMENTS }), options.overpass ?? 200);
    if (url.pathname === '/robots.txt') return body(url.hostname === 'kettle.example' ? 'User-agent: *\nDisallow: /' : 'User-agent: *\nAllow: /');
    return body(`<p>Write to hello@${url.hostname} or owner@gmail.com</p>`);
  } };
  return { net, seen };
}

async function ready(options: { net?: ReturnType<typeof publicNet> } = {}) {
  const env = await setup();
  await seedBlueprint(env, { status: 'accepted', price2: '250000' });
  const web = options.net ?? publicNet();
  env.deps.net = web.net;
  env.deps.mx = async domain => (domain === 'gmail.com' || domain.endsWith('.example') ? [{ exchange: `mx.${domain}`, priority: 10 }] : []);
  return { env, web };
}
const proposalOf = (env: Env, id: string) => listRecords(env.store.read(), 'venture-proposal').find(item => item.id === id)!;
const searches = (env: Env) => listRecords(env.store.read(), 'venture-lead-search');
const rowOf = async (env: Env, rowId: string): Promise<QueueRow> => {
  const row = (await call<{ rows: QueueRow[] }>(env, 'venture.queue.list')).rows.find(item => item.id === rowId);
  assert.ok(row, `no card ${rowId} on Today`);
  return row;
};
const approve = async (env: Env, rowId: string) => { const row = await rowOf(env, rowId); return call<{ outcome: string; line: string }>(env, 'venture.queue.decide', { id: row.id, digest: row.digest, action: 'approve' }); };

test('a search moves only along the one table of states, and every end state is final', () => {
  assert.deepEqual([...SEARCH_STATES], ['proposed', 'approved', 'running', 'done', 'failed', 'unknown']);
  assert.equal(stepSearch('proposed', 'approved'), 'approved');
  assert.equal(stepSearch('approved', 'running'), 'running');
  for (const to of ['done', 'failed', 'unknown'] as const) assert.equal(stepSearch('running', to), to);
  assert.equal(stepSearch('approved', 'failed'), 'failed');
  for (const [from, to] of [['proposed', 'running'], ['approved', 'done'], ['approved', 'unknown'], ['done', 'running'], ['failed', 'approved'], ['unknown', 'done'], ['running', 'approved']] as const) {
    assert.throws(() => stepSearch(from, to), code('LEAD_SEARCH_STATE'));
  }
  assert.deepEqual(SEARCH_STATES.filter(searchEnded), ['done', 'failed', 'unknown']);
  assert.deepEqual(Object.keys(SEARCH_MOVES).sort(), [...SEARCH_STATES].sort());
});

test('finding customers is refused until what is sold is ready, in the owner words of what is missing, before any network call', async () => {
  const env = await setup();
  const web = publicNet();
  env.deps.net = web.net;
  await assert.rejects(leadsFindPropose(env.deps, owner, { brief: BRIEF }), (error: any) => code('BLUEPRINT_NOT_ACCEPTED')(error) && /Finding customers waits until what you sell is ready\. Read your plan and accept it\./.test(error.message));
  await seedBlueprint(env, { status: 'accepted' });
  await assert.rejects(leadsFindPropose(env.deps, owner, { brief: BRIEF }), (error: any) => code('PRICE_REQUIRED')(error) && /Set your price for /.test(error.message));
  await assert.rejects(leadsFindTools(env.deps, owner, { serverId: 'sample' }), code('PRICE_REQUIRED'));
  const view = await leadsFindView(env.deps, owner, {});
  assert.equal(view.ready, false);
  assert.match(view.gate!, /^Finding customers waits until what you sell is ready\. Set your price for /);
  assert.ok(view.missing.length >= 1 && view.missing.every(line => /^Set your price for /.test(line)));
  assert.equal(listRecords(env.store.read(), 'venture-proposal').length, 0);
  assert.equal(web.seen.length, 0, 'nothing was looked up');
});

test('the view seeds the brief from the kept way to earn and labels every lead source honestly', async () => {
  const { env } = await ready();
  await ownerSet(env.deps, owner, { way: { customer: 'Cafes in Pune that buy handmade tableware in bulk', reach: 'Visit them with samples.', teamDoes: 'Finds cafes and drafts each note.', youDo: 'Visit and send each note.', firstWeek: ['Price the tableware sets.'] } });
  const view = await leadsFindView(env.deps, owner, {});
  assert.equal(view.ready, true);
  assert.deepEqual(view.brief, { who: 'Cafes in Pune that buy handmade tableware in bulk', place: 'Pune', category: 'amenity=cafe', count: 10, source: { kind: 'public-map' } });
  assert.equal(view.note, 'No lead tool is connected. The public map search needs nothing.');
  assert.deepEqual(view.sources.map(source => [source.id, source.label, source.usable]), [['public-map', 'read', true], ['monid', 'planned', false]]);
  const monid = view.sources[1]!;
  assert.match(monid.waitsOn!, /Needs your own Monid account, added in Connections, MCP servers\. Not tried on a live account yet\./);
  assert.match(monid.meanwhile!, /public map search/);
  assert.ok(view.kinds.some(kind => kind.tag === 'amenity=cafe' && kind.label === 'Cafes'));
  assert.deepEqual([view.searches, view.found], [[], []]);
  // The plan's customers are places on the map, so nothing more is said.
  assert.equal(view.mapNote, null);
  assert.ok(view.kinds.some(kind => kind.tag === 'building=apartments' && kind.label === 'Apartment blocks'));
});

test('customers who are not places: the view says in one line that the map lists places only, and what to do meanwhile', async () => {
  const { env } = await ready();
  await ownerSet(env.deps, owner, { way: { customer: 'YouTube creators and small production houses pay for Hindi-English translation and video subtitles.', reach: 'Find potential YouTube creators through public sources and contacts you provide.', teamDoes: 'Drafts each message.', youDo: 'Send each message.', firstWeek: ['Prepare sample subtitles.'] } });
  const view = await leadsFindView(env.deps, owner, {});
  assert.equal(view.mapNote, 'The public map lists places only, and your customers are not a kind of place on it. For now, add people you already know in Clients, or use a lead tool once you connect one.');
  assert.deepEqual([view.brief.place, view.brief.category], ['', ''], 'nothing is guessed for them');
  // The owner may still search any kind they pick: their own search is theirs to choose.
  const proposed = await leadsFindPropose(env.deps, owner, { brief: { who: 'Studios that hire subtitlers', place: 'Bhopal', category: 'office=company', count: 5, source: { kind: 'public-map' } } });
  assert.equal(proposed.title, 'Find possible customers: company offices in Bhopal');
});

test('with no way kept the view reads the city and kind from the owner\'s own about words', async () => {
  const { env } = await ready();
  await ventureAction(env.deps, owner, 'prepare', 'test.idea', tx => { tx.touch({ idea: 'I make pottery by hand, mostly mugs and bowls, and I want bulk orders from cafes and hotels in Pune.' }); });
  const view = await leadsFindView(env.deps, owner, {});
  assert.deepEqual(view.brief, { who: '', place: 'Pune', category: 'amenity=cafe', count: 10, source: { kind: 'public-map' } });
  assert.equal(view.mapNote, null);
});

test('the owner starts a search from the pipeline: a card on Today that says exactly what runs; approving it finds, checks and lists, and sends nothing', async () => {
  const { env, web } = await ready();
  await leadsBlock(env.deps, owner, { value: 'blocked.example' });
  await assert.rejects(leadsFindPropose(env.deps, phone, { brief: BRIEF }), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(leadsFindPropose(env.deps, owner, { brief: { ...BRIEF, category: '' } }), code('LEAD_SOURCE_REQUIRED'));
  const proposed = await leadsFindPropose(env.deps, owner, { brief: BRIEF });
  assert.equal(proposed.title, 'Find possible customers: cafes in Pune');
  assert.equal(proposed.line, 'Looks on OpenStreetMap, a public map, for up to 3 cafes in Pune, and reads each one\'s own website for a contact email. It finds only places listed there by name, so some will be missing. It is free and needs no account. No lead tool is connected; you can add one in Connections. Nothing is sent. You check the list and write to each one yourself.');
  assert.equal(proposed.proposal.status, 'raised');
  assert.equal(proposed.proposal.secondAsk, false);
  assert.equal(proposalOf(env, proposed.proposal.id).source, 'owner');
  assert.equal((await leadsFindPropose(env.deps, owner, { brief: BRIEF })).rowId, proposed.rowId, 'the same brief is the same card');
  const card = await rowOf(env, proposed.rowId);
  assert.equal(card.kind, 'proposal');
  assert.equal(card.line, `${proposed.line} Nothing changes until you approve.`);
  assert.deepEqual(card.actions.map(item => item.id), ['deny', 'approve']);
  assert.deepEqual((await leadsFindView(env.deps, owner, {})).searches.map(item => [item.state, item.rowId]), [['proposed', proposed.rowId]]);
  assert.equal(web.seen.length, 0, 'nothing is looked up before the approval');
  assert.equal(searches(env).length, 0);
  // The run itself refuses a caller that holds no approved card.
  await assert.rejects(runApprovedSearch(env.deps, owner, proposalOf(env, proposed.proposal.id)), code('LEAD_SEARCH_NOT_APPROVED'));
  assert.equal(web.seen.length, 0);

  const decided = await approve(env, proposed.rowId);
  assert.equal(decided.outcome, 'done', JSON.stringify(decided));
  assert.equal(decided.line, 'Found 3 possible customers in Pune. One has a contact email. One you may not write to was left out. They are in Clients, Pipeline, each with its source. Nothing was sent.');
  const [search] = searches(env);
  assert.equal(search!.state, 'done');
  assert.equal(search!.line, decided.line);
  assert.deepEqual([search!.found, search!.withEmail, search!.skipped], [3, 1, { known: 0, blocked: 1 }]);
  assert.equal(proposalOf(env, proposed.proposal.id).outcome, decided.line);
  const leads = listRecords(env.store.read(), 'venture-lead');
  assert.deepEqual(leads.map(lead => lead.name).sort(), ['Brew Room', 'Kettle House', 'Lotus Cafe'], 'the blocked site and the fourth new one are left out');
  const lotus = leads.find(lead => lead.name === 'Lotus Cafe')!;
  assert.equal(lotus.email, 'hello@lotus.example', 'the address at its own site, read from its own page');
  assert.equal(lotus.emailCheck.status, 'verified');
  assert.equal(lotus.sourceUrl, 'https://www.openstreetmap.org/node/1');
  assert.equal(leads.find(lead => lead.name === 'Kettle House')!.email, null, 'a site whose robots file says no is not read, and no email is guessed');
  assert.equal(leads.find(lead => lead.name === 'Brew Room')!.email, null);
  assert.ok(leads.every(lead => lead.status === 'new' && lead.drafts.length === 0 && lead.sends.length === 0), 'found and listed; nothing drafted or sent');
  const sources = listRecords(env.store.read(), 'venture-lead-source');
  assert.ok(sources.length === 3 && sources.every(source => source.source === 'osm' && source.licence === '© OpenStreetMap contributors, ODbL' && source.searchId === search!.id && /^https:\/\/www\.openstreetmap\.org\/node\/\d$/.test(source.url!)));
  assert.equal(web.seen.some(url => url.includes('blocked.example')), false, 'a blocked business is not even read');
  assert.equal(web.seen.filter(url => url.includes('kettle.example')).every(url => url.endsWith('/robots.txt')), true);
  assert.deepEqual(listRecords(env.store.read(), 'venture-journal-entry'), [], 'no outside effect was journalled, because there was none');
  assert.deepEqual(listRecords(env.store.read(), 'venture-spend'), []);
  const view = await leadsFindView(env.deps, owner, {});
  assert.deepEqual(view.searches.map(item => [item.state, item.found, item.rowId]), [['done', 3, null]]);
  assert.deepEqual(view.found.map(item => [item.name, item.source, item.licence]).sort(), [['Brew Room', 'OpenStreetMap', '© OpenStreetMap contributors, ODbL'], ['Kettle House', 'OpenStreetMap', '© OpenStreetMap contributors, ODbL'], ['Lotus Cafe', 'OpenStreetMap', '© OpenStreetMap contributors, ODbL']]);
  assert.equal(view.found[0]!.name, 'Lotus Cafe', 'the most checkable is listed first');
  // A second search of the same place adds only what the business does not have yet.
  const again = await leadsFindPropose(env.deps, owner, { brief: BRIEF });
  assert.notEqual(again.proposal.id, proposed.proposal.id);
  const second = await approve(env, again.rowId);
  assert.equal(second.line, 'Found one possible customer in Pune. One has a contact email. 3 you already had were left out. One you may not write to was left out. They are in Clients, Pipeline, each with its source. Nothing was sent.');
  assert.deepEqual(listRecords(env.store.read(), 'venture-lead').map(lead => lead.name).sort(), ['Brew Room', 'Fifth Cup', 'Kettle House', 'Lotus Cafe']);
});

// Round 5 (re-check 028): while an approved search ran (83 s), Today said "Nothing is running" and "0 working": Working
// now and Team at work read the runs list only, and a search is Chausar's own work, not an agent's run. The runs list
// now carries each open search beside the runs, with who does it, its own line and its time so far; nothing else.
test('a search that is running is listed with the runs as Chausar\'s work while it runs, and leaves the list when it ends', async () => {
  const web = publicNet();
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const send = web.net.send;
  web.net.send = async (target: any) => { if (target.url.hostname === 'overpass-api.de') await held; return send(target); };
  const { env } = await ready({ net: web });
  const proposed = await leadsFindPropose(env.deps, owner, { brief: BRIEF });
  type Listed = { runs: unknown[]; searches: { searchId: string; title: string; line: string; state: string; agent: string | null; startedAt: string; elapsed: string }[] };
  const before = await call<Listed>(env, 'venture.runs.list', {});
  assert.deepEqual(before.searches, [], 'a search waiting on Today is not running work');
  const decided = approve(env, proposed.rowId);
  let listed: Listed | null = null;
  for (let i = 0; i < 200 && !listed?.searches.length; i++) {
    await new Promise(resolve => setTimeout(resolve, 5));
    listed = await call<Listed>(env, 'venture.runs.list', { state: 'active' });
  }
  const [search] = searches(env);
  assert.equal(search!.state, 'running');
  assert.deepEqual(listed!.searches.map(({ elapsed: _e, ...item }) => item), [
    { searchId: search!.id, title: 'Find possible customers: cafes in Pune', line: SEARCH_LINES.running, state: 'running', agent: null, startedAt: search!.startedAt },
  ]);
  assert.equal(listed!.searches[0]!.elapsed, formatAge(search!.startedAt!, env.deps.clock().toISOString()), 'its time so far, in the words every run uses');
  assert.deepEqual(listed!.runs, [], 'it is not made into an agent\'s run');
  assert.deepEqual((await call<Listed>(env, 'venture.runs.list', { state: 'all' })).searches.map(item => item.searchId), [search!.id]);
  assert.deepEqual((await call<Listed>(env, 'venture.runs.list', { state: 'done' })).searches, [], 'a done list holds no open search');
  release();
  assert.equal((await decided).outcome, 'done');
  assert.deepEqual((await call<Listed>(env, 'venture.runs.list', {})).searches, [], 'it leaves once it ends');
});

test('the gate is checked again at the entry of the run, and a card whose facts changed cannot be approved', async () => {
  const { env, web } = await ready();
  const proposed = await leadsFindPropose(env.deps, owner, { brief: BRIEF });
  // A new plan version with an unpriced offer: what is sold is no longer ready.
  await seedBlueprint(env, { status: 'accepted', version: 2 });
  const card = await rowOf(env, proposed.rowId).catch(() => null);
  assert.equal(card, null, 'the card the owner saw is gone');
  const stale = (await call<{ rows: QueueRow[] }>(env, 'venture.queue.list')).rows.find(row => row.kind === 'proposal')!;
  assert.match(stale.line!, /^This can't go ahead now: what you sell is not ready yet\. Set your price for /);
  assert.deepEqual(stale.actions.map(item => item.label), ['Dismiss']);
  // Even a caller that claims the card by hand is stopped by the run's own gate.
  await ventureAction(env.deps, owner, 'approve', 'test.claim', tx => {
    const record = tx.find('venture-proposal', proposed.proposal.id)!;
    tx.replace<ProposalRecord>({ ...record, status: 'approved', decidedAt: tx.now, decidedBy: owner.memberId, outcome: 'claimed' });
    openSearch(tx, record);
  });
  await assert.rejects(runApprovedSearch(env.deps, owner, proposalOf(env, proposed.proposal.id)), (error: any) => code('PRICE_REQUIRED')(error) && /Finding customers waits until what you sell is ready/.test(error.message));
  assert.equal(searches(env)[0]!.state, 'failed');
  assert.match(searches(env)[0]!.line, /Set your price for /);
  assert.equal(web.seen.length, 0);
  assert.equal(listRecords(env.store.read(), 'venture-lead').length, 0);
});

test('a source that does not answer ends the search failed and puts the card back on Today; the next approval is a new search', async () => {
  // 400: an answer that is not "busy", so the read is asked once (the growing waits of a busy map are in venture-leads-osm.test.ts).
  const web = publicNet({ overpass: 400 });
  const { env } = await ready({ net: web });
  const proposed = await leadsFindPropose(env.deps, owner, { brief: BRIEF });
  const refused = await approve(env, proposed.rowId) as { outcome: string; reason?: string; line: string };
  assert.deepEqual([refused.outcome, refused.reason, refused.line], ['refused', 'LEAD_SOURCE_UNAVAILABLE', MAP_WORDS.failed]);
  assert.deepEqual(searches(env).map(item => [item.state, item.line]), [['failed', MAP_WORDS.failed]]);
  assert.equal(proposalOf(env, proposed.proposal.id).status, 'raised', 'the card is back for another try');
  env.deps.net = publicNet().net;
  const decided = await approve(env, proposed.rowId);
  assert.match(decided.line, /^Found 3 possible customers in Pune\./);
  assert.deepEqual(searches(env).map(item => item.state), ['failed', 'done']);
  // A card decided once cannot run a second search.
  await assert.rejects(runApprovedSearch(env.deps, owner, proposalOf(env, proposed.proposal.id)), code('LEAD_SEARCH_NOT_APPROVED'));
});

// Found on Windows, 16 Nov 2026: the map did not answer twice, yet This week said "Find possible customers: company
// offices in Indore, Done", and Clients, Find customers listed three entries for two tries.
test('a search that failed is never Done in the week, and the list of searches tells one entry for each try', async () => {
  const seenWhileLooking: string[] = [];
  const failing = publicNet({ overpass: 400 });
  const { env } = await ready({ net: failing });
  const venture = () => currentVenture(env.store.read())!;
  const proposed = await leadsFindPropose(env.deps, owner, { brief: BRIEF });
  // The daily review's card is a move of the week (chief/review.ts): the same link, made by hand.
  await ventureAction(env.deps, owner, 'prepare', 'test.plan', tx => {
    const now = planNow(tx.state, tx.venture!, tx.now);
    savePlan(tx, proposeMove(now.plan, { title: 'A search', proposalId: proposed.proposal.id }, tx.now), now.record);
  });
  const stored = () => storedPlan(env.store.read(), venture().id)!.moves.find(move => move.proposalId === proposed.proposal.id)!.state;
  const shown = async () => (await planView(env.deps, owner)).moves.find(move => move.text === proposed.title)!;
  assert.deepEqual([stored(), (await shown()).label], ['proposed', 'On Today for your approval']);
  // While it looks, the move says it is being worked on: approved is not done.
  const send = failing.net.send;
  failing.net.send = async (target: any) => { if (target.url.hostname === 'overpass-api.de') seenWhileLooking.push(stored()); return send(target); };
  await approve(env, proposed.rowId);
  assert.deepEqual(seenWhileLooking, ['working']);
  // It failed and its card is back on Today: the week says exactly that, with the card's row to go to.
  const back = await shown();
  assert.deepEqual([stored(), back.state, back.label, back.rowId], ['proposed', 'proposed', 'On Today for your approval', proposed.rowId]);
  let view = await leadsFindView(env.deps, owner, {});
  assert.deepEqual(view.searches.map(item => [item.state, item.line, item.rowId]), [['failed', MAP_WORDS.failed, proposed.rowId]], 'one try, one entry, with the way to try again');
  // A second try that fails is a second entry; only the newest carries the card.
  env.advance(60_000);
  await approve(env, proposed.rowId);
  view = await leadsFindView(env.deps, owner, {});
  assert.deepEqual(view.searches.map(item => [item.state, item.rowId]), [['failed', proposed.rowId], ['failed', null]]);
  assert.equal(stored(), 'proposed');
  // The third try finds them: only now is the move done, and no entry still points at a card.
  env.advance(60_000);
  env.deps.net = publicNet().net;
  await approve(env, proposed.rowId);
  assert.deepEqual([stored(), (await shown()).label], ['done', 'Done']);
  view = await leadsFindView(env.deps, owner, {});
  assert.deepEqual(view.searches.map(item => [item.state, item.rowId]), [['done', null], ['failed', null], ['failed', null]]);
  assert.match(view.searches[0]!.line, /^Found 3 possible customers in Pune\./);
});

test('a search that a restart ended is not Done in the week either: its move says it did not finish', async () => {
  const { env } = await ready();
  const proposed = await leadsFindPropose(env.deps, owner, { brief: BRIEF });
  await ventureAction(env.deps, owner, 'prepare', 'test.plan', tx => {
    const now = planNow(tx.state, tx.venture!, tx.now);
    savePlan(tx, proposeMove(now.plan, { title: 'A search', proposalId: proposed.proposal.id }, tx.now), now.record);
  });
  const search = await ventureAction(env.deps, owner, 'approve', 'test.claim', tx => {
    const record = tx.find('venture-proposal', proposed.proposal.id)!;
    tx.replace<ProposalRecord>({ ...record, status: 'approved', decidedAt: tx.now, decidedBy: owner.memberId, outcome: 'Approved.' });
    return openSearch(tx, record);
  });
  await moveSearch(env.deps, owner, search.id, 'running', { line: SEARCH_LINES.running });
  env.advance(5);
  await sweepWholeJournal(env.deps, owner, 1);
  const move = (await planView(env.deps, owner)).moves.find(item => item.text === proposed.title)!;
  assert.deepEqual([move.state, move.label, move.rowId, move.can], ['failed', 'Did not finish', null, ['dropped']]);
});

test('after a restart no search stays running: the sweep ends it, keeps what it had added and tells the card', async () => {
  const { env } = await ready();
  const proposed = await leadsFindPropose(env.deps, owner, { brief: BRIEF });
  const open = async (): Promise<LeadSearchRecord> => ventureAction(env.deps, owner, 'approve', 'test.claim', tx => {
    const record = tx.find('venture-proposal', proposed.proposal.id)!;
    tx.replace<ProposalRecord>({ ...record, status: 'approved', decidedAt: tx.now, decidedBy: owner.memberId, outcome: 'Approved.' });
    return openSearch(tx, record);
  });
  const search = await open();
  await moveSearch(env.deps, owner, search.id, 'running', { line: SEARCH_LINES.running });
  // An ordinary tick leaves a search that only just started alone.
  assert.deepEqual(await recoverLeadSearches(env.deps, owner, 30 * 60_000), []);
  assert.equal(searches(env)[0]!.state, 'running');
  // Opening the vault after a restart (the sweep's one millisecond limit): whatever was running then is gone.
  env.advance(5);
  await sweepWholeJournal(env.deps, owner, 1);
  const [ended] = searches(env);
  assert.equal(ended!.state, 'failed');
  assert.equal(ended!.line, SEARCH_LINES.stopped);
  assert.ok(ended!.endedAt);
  assert.equal(proposalOf(env, proposed.proposal.id).outcome, SEARCH_LINES.stopped, 'the card no longer says it is in flight');
  assert.deepEqual(await recoverLeadSearches(env.deps, owner, 1), [], 'an ended search is left as it is');
  // A search never started (approved, then the restart) can only fail: nothing ran, so nothing is in doubt.
  await ventureAction(env.deps, owner, 'approve', 'test.reraise', tx => { const record = tx.find('venture-proposal', proposed.proposal.id)!; tx.replace<ProposalRecord>({ ...record, status: 'raised', decidedAt: null, decidedBy: null, outcome: null }); });
  await open();
  env.advance(5);
  assert.deepEqual((await recoverLeadSearches(env.deps, owner, 1)).map(item => item.state), ['failed']);
  assert.deepEqual(searches(env).map(item => item.state), ['failed', 'failed']);
});

test('Forget of a person erases the lead a search found for them, its source record, and their trace in the search', async () => {
  const { env } = await ready();
  const proposed = await leadsFindPropose(env.deps, owner, { brief: BRIEF });
  await approve(env, proposed.rowId);
  const lotus = listRecords(env.store.read(), 'venture-lead').find(lead => lead.name === 'Lotus Cafe')!;
  const { networkImport } = await import('../runtime/venture/network/import.ts');
  const { networkForget } = await import('../runtime/venture/network/forget.ts');
  const imported = await networkImport(env.deps, owner, { kind: 'contacts-csv', name: 'contacts.csv', text: 'Name,E-mail 1 - Value\nLotus Owner,hello@lotus.example\n' });
  assert.equal(imported.mode, 'import');
  const person = listRecords(env.store.read(), 'venture-person').find(item => item.handles.emails.includes('hello@lotus.example'))!;
  await networkForget(env.deps, owner, { id: person.id });
  assert.equal(listRecords(env.store.read(), 'venture-lead').some(lead => lead.id === lotus.id), false);
  assert.equal(listRecords(env.store.read(), 'venture-lead-source').some(source => source.leadId === lotus.id), false, 'no page, site or search is kept for a forgotten lead');
  const view = await leadsFindView(env.deps, owner, {});
  assert.equal(view.found.some(item => item.leadId === lotus.id || item.name === 'Lotus Cafe'), false);
  assert.equal(JSON.stringify(searches(env)).includes('Lotus'), false, 'the search record never held the name');
});
