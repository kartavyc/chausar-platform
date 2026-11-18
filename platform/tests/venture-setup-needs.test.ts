// What this business needs (founder, 14 Nov 2026: "during the type of service to offer onboarding we have to connect
// with other services like email and, for example, Monid, Canva etc. for things like lead gen and document prep").
// In the same About you answer as the way to earn, the owner's AI names up to four needs from a small fixed list. Code
// checks them against that list, they are kept with the way, and venture.needs.list then answers, per kept need, the
// ways Chausar can meet it today, each with the label its own source gives it. With no need kept, the list is the
// field's list as before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { aboutTask } from '../runtime/venture/core/about.ts';
import { CARD_LABELS, NEED_IDS, NEEDS_MAX, businessNeeds, keptNeeds, neededGroups } from '../runtime/venture/core/needs.ts';
import { assertSchemaSafe } from '../runtime/venture/models/schema.ts';
import { listRecords } from '../runtime/venture/records.ts';
import { CURATED_MCP_SERVERS } from '../runtime/venture/agent-runtime/mcp-registry.ts';
import { getAgentSettings, setAgentSettings } from '../runtime/venture/agent-runtime/settings-methods.ts';
import { leadSources } from '../runtime/venture/customers/find-target.ts';
import { sourceRows } from '../runtime/venture/customers/find-words.ts';
import { engineFor, connectPair } from './fixtures/venture/compose-unit/harness.ts';
import { anthropicEntry } from './fixtures/venture/compose-unit/plans.ts';
import { chiefBusiness } from './venture-chief-helpers.ts';
import { owner } from './venture-judge-helpers.ts';

const POTTER = 'I make pottery by hand, mostly mugs and bowls, and I want bulk orders from cafes and hotels in Pune.';
const WAY = {
  customer: 'Independent cafes and small hotels in Pune that buy tableware in bulk.',
  reach: 'A list of cafes found from public listings, then a first message you send to each owner.',
  teamDoes: 'Finds the cafes, drafts each message and quote, and keeps track of who replied.',
  youDo: 'Make the samples, set the prices, send each message and take the calls.',
  firstWeek: ['Decide the set sizes and your price for each offer.', 'Approve the first list of cafes.', 'Send the first five messages.'],
};
const OFFERS = [{ name: 'Cafe mug sets', line: 'Handmade mugs in bulk for cafes' }];
const POTTER_NEEDS = ['find-customers', 'write-to-customers', 'payments'];
const CONSULTANT_NEEDS = ['find-customers', 'designs-documents', 'write-to-customers', 'appointments'];
const OFFERED = sourceRows([], CURATED_MCP_SERVERS.filter(entry => entry.finds === 'leads'));
const ways = (group: any) => group.ways.map((way: any) => [way.id, way.label, way.action]);

test('the fixed list of needs is small, and the AI is asked for them in the About you answer', () => {
  assert.deepEqual([...NEED_IDS], ['find-customers', 'write-to-customers', 'designs-documents', 'payments', 'appointments']);
  assert.equal(NEEDS_MAX, 4);
  const task = aboutTask({ text: POTTER, file: null });
  assert.doesNotThrow(() => assertSchemaSafe(task.schema));
  const schema = task.schema as any;
  assert.deepEqual(schema.properties.needs, { type: 'array', items: { type: 'string', enum: [...NEED_IDS] } });
  assert.ok(schema.required.includes('needs'));
  assert.match(task.instructions, /As needs, /);
});

test('keptNeeds keeps listed ids in the order given, once each, at most four, and drops anything else', () => {
  assert.deepEqual(keptNeeds(POTTER_NEEDS), POTTER_NEEDS);
  assert.deepEqual(keptNeeds(['payments', 'teleport', 'find-customers', 7, null, 'payments', 'files', 'email']), ['payments', 'find-customers']);
  assert.deepEqual(keptNeeds(['appointments', 'payments', 'designs-documents', 'write-to-customers', 'find-customers']), ['appointments', 'payments', 'designs-documents', 'write-to-customers']);
  for (const none of [undefined, null, 'payments', { 0: 'payments' }, []]) assert.deepEqual(keptNeeds(none), []);
});

test('about.read carries the needs beside the way, checked; an unknown id is dropped and the read stands', async t => {
  const base = { familyId: null, professionId: null, offers: OFFERS, countryCode: null, evidence: null, reply: 'Where are you based?' };
  const { engine } = await engineFor(t, { responses: [
    anthropicEntry('decide', { ...base, way: WAY, needs: ['find-customers', 'spaceship', 'write-to-customers', 'payments'] }, [POTTER, 'familyId', 'untrusted']),
    anthropicEntry('decide', { ...base, needs: ['find-customers'] }, [POTTER, 'familyId', 'untrusted']),
    anthropicEntry('decide', { ...base, way: WAY, needs: 'everything' }, [POTTER, 'familyId', 'untrusted']),
    anthropicEntry('decide', { ...base, way: WAY }, [POTTER, 'familyId', 'untrusted']),
  ] });
  await connectPair(engine);
  const first = await engine.request('venture.about.read', { text: POTTER }) as any;
  assert.deepEqual(first.needs, POTTER_NEEDS);
  assert.deepEqual(first.way, WAY);
  // Needs belong to a way: without one there is nothing to keep them with.
  const second = await engine.request('venture.about.read', { text: POTTER }) as any;
  assert.equal(second.needs, undefined);
  assert.deepEqual(second.offers, OFFERS);
  // Needs that are not a list, or are left out, are no needs; the way and the offers stand.
  for (const read of [await engine.request('venture.about.read', { text: POTTER }), await engine.request('venture.about.read', { text: POTTER })] as any[]) {
    assert.equal(read.needs, undefined);
    assert.deepEqual(read.way, WAY);
  }
});

test('the needs are kept with the business through the owner profile, checked, and taken away with null', async () => {
  const env = await chiefBusiness();
  await env.call('venture.owner.set', { way: WAY });
  const kept = await env.call('venture.owner.set', { needs: ['find-customers', 'spaceship', 'payments', 'find-customers'] });
  assert.deepEqual(kept.needs, ['find-customers', 'payments']);
  assert.deepEqual(kept.way, WAY);
  assert.deepEqual(listRecords(env.store.read(), 'venture-owner-profile').at(-1)!.needs, ['find-customers', 'payments']);
  // Another field leaves them; a value that is not a list is refused; null takes them away.
  await env.call('venture.owner.set', { firstName: 'Asha' });
  assert.deepEqual((await env.call('venture.owner.get', {})).needs, ['find-customers', 'payments']);
  await assert.rejects(env.call('venture.owner.set', { needs: 'payments' }), (error: any) => error.code === 'INVALID_VENTURE_REQUEST');
  assert.equal((await env.call('venture.owner.set', { needs: null })).needs, undefined);
  assert.deepEqual((await env.call('venture.owner.get', {})).way, WAY);
});

test('a potter and a consultant each see the ways to meet their own needs, most useful first', () => {
  const potter = neededGroups(POTTER_NEEDS, 'IN', [], OFFERED);
  assert.deepEqual(potter.map(group => group.id), POTTER_NEEDS);
  assert.deepEqual(ways(potter[0]), [['public-map', 'read', 'none'], ['monid', 'planned', 'set-up']]);
  // The way that works today leads: a message the owner sends from their own mail app. WhatsApp stands beside it
  // (found live, 15 Nov 2026: a tradesman whose customers reply on WhatsApp was shown Gmail alone), with the label its
  // card really has, planned, and the path until then: Chausar drafts, the owner sends from their own WhatsApp.
  assert.deepEqual(ways(potter[1]), [['gmail', 'handoff', 'none'], ['whatsapp', 'planned', 'manual']]);
  const whatsapp = potter[1]!.ways[1]!;
  assert.equal(whatsapp.label, CARD_LABELS.whatsapp, 'never a better label than the card has');
  assert.deepEqual([whatsapp.name, whatsapp.why, whatsapp.waitsOn, whatsapp.meanwhile], [
    'WhatsApp', 'For customers who reply on WhatsApp. Chausar drafts each message, and you send it from your own WhatsApp.',
    'Chausar\'s WhatsApp link is coming later.', 'Use WhatsApp on its own until then.',
  ]);
  assert.equal(whatsapp.connect.kind, 'sign-in');
  // No group has a line of its own when its ways say everything.
  for (const group of potter) assert.equal(group.note, null, group.id);
  assert.deepEqual(ways(potter[2]), [['razorpay', 'planned', 'manual']]);
  assert.equal(potter[2]!.ways[0]!.meanwhile, 'For now, share your UPI or bank details and mark payments yourself.');
  const consultant = neededGroups(CONSULTANT_NEEDS, 'IN', [], OFFERED);
  assert.deepEqual(consultant.map(group => group.id), CONSULTANT_NEEDS);
  assert.deepEqual(ways(consultant[1]), [['canva', 'planned', 'set-up']]);
  assert.deepEqual(ways(consultant[3]), [['google-calendar', 'read', 'set-up']]);
  assert.notDeepEqual(potter.map(group => group.id), consultant.map(group => group.id));
  // A potter is no longer offered a drive, a video tool or a channel to publish to.
  const potterIds = potter.flatMap(group => group.ways.map(way => way.id));
  for (const gone of ['google-drive', 'sunra', 'youtube', 'telegram']) assert.ok(!potterIds.includes(gone), gone);
});

test('customers who are not places on a map: the need to find customers says so in one line, and keeps its ways', () => {
  const NOTE = 'The public map lists places only, and your customers are not a kind of place on it. For now, add people you already know in Clients, or use a lead tool once you connect one.';
  const translator = neededGroups(['find-customers', 'write-to-customers'], 'IN', [], OFFERED, { 'find-customers': NOTE });
  assert.deepEqual(translator.map(group => [group.id, group.note]), [['find-customers', NOTE], ['write-to-customers', null]]);
  assert.deepEqual(ways(translator[0]), [['public-map', 'read', 'none'], ['monid', 'planned', 'set-up']]);
});

test('every way keeps the label its own source gives it, and says the manual path when it is planned', () => {
  // At most four are answered at once, so the whole list is asked for in two goes.
  // Every kept need is answered: the owner may keep them all (venture-needs-change.test.ts); only the AI's answer is cut to four.
  assert.deepEqual(neededGroups([...NEED_IDS], 'IN', [], OFFERED).map(group => group.id), [...NEED_IDS]);
  const groups = [...neededGroups(NEED_IDS.slice(0, NEEDS_MAX), 'IN', [], OFFERED), ...neededGroups(NEED_IDS.slice(NEEDS_MAX), 'IN', [], OFFERED)];
  assert.deepEqual(groups.map(group => group.id), [...NEED_IDS], 'every need has a way in India');
  // A need is listed only when something for it is real today: a way that works, a connect flow, or a manual path in Chausar.
  for (const group of groups) assert.ok(group.ways.some(way => way.action !== 'manual') || group.id === 'payments', group.id);
  // A planned card with nothing to connect is listed only beside a way that works (WhatsApp beside email), or where it
  // is the need's one answer (getting paid), always with its manual path.
  for (const group of groups) for (const way of group.ways.filter(item => item.action === 'manual')) assert.ok(group.id === 'payments' || group.id === 'write-to-customers', `${group.id}: ${way.id}`);
  const all = groups.flatMap(group => group.ways);
  // Finding customers: the lead sources finding customers itself lists, in its order, each with its name, its label
  // and its manual path. The public map keeps its words whole.
  for (const row of OFFERED) {
    const way = groups[0]!.ways.find(item => item.id === row.id)!;
    assert.deepEqual([way.name, way.label, way.meanwhile], [row.name, row.label, row.meanwhile], row.id);
  }
  assert.deepEqual(groups[0]!.ways.map(way => way.id), OFFERED.map(row => row.id));
  assert.equal(groups[0]!.ways[0]!.why, OFFERED[0]!.line);
  // Monid's row is short, and still says it is paid; the registry words are whole on its own form.
  const monid = groups[0]!.ways.find(way => way.id === 'monid')!;
  assert.match(monid.why, /Monid charges each call/);
  assert.equal(monid.waitsOn, 'Needs your own Monid account. Not tried on a live account yet.');
  // A connector card: its real strongest mode in this build (venture-about-w6.test.ts checks CARD_LABELS against the cards).
  for (const way of all.filter(item => item.connect.connectorId)) assert.equal(way.label, CARD_LABELS[way.connect.connectorId!] ?? 'planned', way.id);
  // A curated MCP server: the registry's own name, words and sign-in, and never more than planned, as none has run on a live account.
  for (const way of all.filter(item => item.connect.mcpServerId)) {
    const entry = CURATED_MCP_SERVERS.find(item => item.id === way.connect.mcpServerId)!;
    assert.ok(entry, way.id);
    assert.equal(way.name, entry.name);
    assert.equal(way.label, 'planned', way.id);
    assert.equal(way.connect.kind, entry.signIn === 'oauth' ? 'sign-in' : entry.signIn === 'key' ? 'key' : 'none');
    assert.match(way.waitsOn!, /Not tried on a live account yet\.$/);
    assert.equal(way.action, 'set-up', 'its server form is a real connect flow');
  }
  const canva = all.find(way => way.id === 'canva')!;
  assert.equal(canva.why, CURATED_MCP_SERVERS.find(entry => entry.id === 'canva')!.about);
  for (const way of all) {
    assert.equal(way.required, false, way.id);
    assert.ok(['set-up', 'none', 'manual'].includes(way.action), way.id);
    if (way.label === 'planned') assert.ok(way.waitsOn && way.meanwhile, `${way.id} says what it waits on and the manual path`);
    // Only a way with a real connect flow offers Set up; a planned one with none shows its manual path.
    if (way.action === 'set-up') assert.ok(way.connect.mcpServerId || (way.label !== 'planned' && (way.connect.connectorId || way.connect.place)), way.id);
    if (way.action === 'manual') assert.equal(way.label, 'planned', way.id);
    if (way.action === 'none') assert.notEqual(way.label, 'planned', way.id);
    for (const words of [way.name, way.why, way.waitsOn ?? '', way.meanwhile ?? '']) assert.doesNotMatch(words, /—|₹|\$/, `${way.id}: ${words}`);
  }
  // Nothing is asked for twice, and a need with no way here (no payment card for the country) is left out.
  assert.equal(new Set(all.map(way => way.id)).size, all.length);
  assert.deepEqual(neededGroups(['payments'], 'XX', [], OFFERED), []);
});

test('needs.list follows the kept needs, and falls back to the field list when none was kept', async () => {
  const env = await chiefBusiness();
  const venture = listRecords(env.store.read(), 'venture-record')[0]!;
  // No need kept (templates only, or an older business): the field's list, exactly as before.
  const before = await env.call('venture.needs.list', {});
  assert.deepEqual(before.groups, []);
  assert.ok(before.needs.length > 0);
  assert.deepEqual(before.needs, businessNeeds(before.family?.id ?? null, venture.country.code, venture.country.paymentRails));
  for (const need of before.needs) assert.ok(['set-up', 'none', 'manual'].includes(need.action), need.id);
  // The potter's plan is kept: the list is now the plan's.
  await env.call('venture.owner.set', { way: WAY });
  await env.call('venture.owner.set', { needs: POTTER_NEEDS });
  const list = await env.call('venture.needs.list', {});
  assert.deepEqual(list.needs, []);
  assert.deepEqual(list.groups, neededGroups(POTTER_NEEDS, venture.country.code, venture.country.paymentRails, leadSources(env.store.read(), venture.id)));
  assert.deepEqual(list.groups.map((group: any) => group.id), POTTER_NEEDS);
  assert.deepEqual(list.groups.map((group: any) => group.note), [null, null, null], 'cafes are places on the map');
  // A plan whose customers are people and channels: the need to find customers says the map lists places only.
  await env.call('venture.owner.set', { way: { ...WAY, customer: 'YouTube creators and small production houses pay for subtitles.', reach: 'Through contacts you provide.' } });
  const online = await env.call('venture.needs.list', {});
  assert.match(online.groups[0].note, /^The public map lists places only, and your customers are not a kind of place on it\./);
  await env.call('venture.owner.set', { way: WAY });
  assert.deepEqual(list.family, before.family);
  // Taking the needs away brings the field list back.
  await env.call('venture.owner.set', { needs: null });
  assert.deepEqual((await env.call('venture.needs.list', {})).needs, before.needs);
});

test('a lead tool the owner already added is listed as finding customers lists it: planned, untried, still theirs to manage', async () => {
  const env = await chiefBusiness();
  const venture = listRecords(env.store.read(), 'venture-record')[0]!;
  await env.call('venture.owner.set', { needs: ['find-customers'] });
  const view = await getAgentSettings(env.deps, owner, {});
  view.settings.mcpServers = [structuredClone(CURATED_MCP_SERVERS.find(entry => entry.id === 'monid')!.server)];
  await setAgentSettings(env.deps, owner, { settings: view.settings, approveMcpConfiguration: true });
  const [group] = (await env.call('venture.needs.list', {})).groups;
  const sources = leadSources(env.store.read(), venture.id);
  assert.deepEqual(sources.map(source => [source.id, source.label, source.usable]), [['public-map', 'read', true], ['monid', 'planned', true]]);
  assert.deepEqual(ways(group), [['public-map', 'read', 'none'], ['monid', 'planned', 'set-up']]);
  assert.equal(group.ways[1].waitsOn, sources[1]!.waitsOn);
  assert.equal(group.ways[1].connect.mcpServerId, 'monid');
});
