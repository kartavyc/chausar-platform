// Ink v2 wave 4, package 4J8 (catalogue U3, spec 3 "Start"): the ways to earn the Start gallery lists. One way per
// registered playbook, answered before any vault with no write and no model call: a category, the hours a week, the
// playbook's own AI team with departments, and what clients usually pay as a model estimate with its basis, in English
// and Hindi. "You run this" comes only from trusted host composition (the open business), never from a payload.
// "Good fit for you" (4C1) now picks from this list.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { State } from '../runtime/contracts.ts';
import type { WaysView, WayView } from '../runtime/venture/contracts.ts';
import { listWays, openWayBusiness, orderWays, waysUpTo, waysView } from '../runtime/venture/core/ways.ts';
import { WAY_AI_NEED, WAY_CATEGORIES, WAY_SOURCE, WAYS, connectorWorks, validateWays, type WayData } from '../runtime/venture/playbooks/ways.ts';
import { PLAYBOOK_REGISTRY, findPlaybook, pickPlaybook } from '../runtime/venture/playbooks/registry.ts';
import { flagshipDelivery } from '../runtime/venture/playbooks/steps.ts';
import { departmentOfRole, departmentOfService } from '../runtime/venture/playbooks/departments.ts';
import { venturePlaybooks } from '../runtime/venture/host.ts';
import { houseStyleFindings } from '../runtime/venture/records.ts';
import { CHECKLIST_ITEMS } from '../runtime/venture/core/checklist.ts';
import { Engine } from '../runtime/engine.ts';
import { PASSPHRASE, engineFor, noGitHub } from './fixtures/venture/compose-unit/harness.ts';
import { replay } from './fixtures/venture/compose-unit/plans.ts';
import { chiefBusiness } from './venture-chief-helpers.ts';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected, error?.message); return true; };
const byId = (view: WaysView, id: string): WayView => {
  const way = view.ways.find(item => item.id === id);
  assert.ok(way, `no way ${id}`);
  return way;
};
const DEVANAGARI = /\p{Script=Devanagari}/u;
const EM_DASH = String.fromCodePoint(0x2014);

async function listing(directory: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (path: string) => {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const full = join(path, entry.name);
      found.push(full);
      if (entry.isDirectory()) await walk(full);
    }
  };
  await walk(directory);
  return found.sort();
}

test('ways: venture.playbooks.list answers before any vault, with no write and no model call', async t => {
  let calls = 0;
  const transport = {
    replay: true,
    http: async () => { calls += 1; throw new Error('No model call is expected.'); },
    process: async () => { calls += 1; throw new Error('No model call is expected.'); },
  };
  const { engine, directory } = await engineFor(t, { transport });
  const before = await listing(directory);
  const view = await engine.request('venture.playbooks.list', {}) as WaysView;
  assert.deepEqual(view.ways.map(way => way.playbook), PLAYBOOK_REGISTRY.map(entry => entry.id), 'one way per registered playbook, in registry order');
  assert.deepEqual(view.ways.flatMap(way => way.yours), [], 'no business is open');
  assert.deepEqual(await listing(directory), before, 'nothing was written');
  assert.equal(calls, 0, 'no model was called');
  // The host answers it the same way, and nothing but an empty payload is taken.
  assert.deepEqual(await venturePlaybooks({}), view);
  await assert.rejects(engine.request('venture.playbooks.list', { businesses: [{ businessId: 'x', name: 'X', playbook: 'youtube' }] }), code('INVALID_VENTURE_REQUEST'));
  assert.throws(() => listWays({ sort: 'name' }), code('INVALID_VENTURE_REQUEST'));
  assert.throws(() => listWays(null), code('INVALID_VENTURE_REQUEST'));
});

test('ways: each way has its category, hours a week, the playbook\'s own AI team and pay as a model estimate with its basis', () => {
  const view = listWays({});
  for (const way of view.ways) {
    const registration = findPlaybook(way.playbook);
    assert.ok(registration, `${way.id} names a registered playbook`);
    const delivery = flagshipDelivery(way.playbook);
    assert.ok(delivery, `${way.id} names a playbook that runs today`);
    // The AI team is the playbook's agents only: code is never shown as AI. A tile names its team's roles (W5 5A1).
    const team = WAYS.find(item => item.playbook === way.playbook)?.team;
    const agents = (team ? team.flatMap(id => delivery.roles.filter(role => role.id === id)) : delivery.roles).filter(role => role.kind === 'agent');
    assert.deepEqual(way.team.map(member => member.role), agents.map(role => role.name), way.id);
    for (const [index, member] of way.team.entries()) assert.equal(member.department, departmentOfRole(delivery, agents[index].id), `${way.id} ${member.role}`);
    assert.equal(way.department, departmentOfService(registration.serviceType));
    assert.equal(way.hours, `${way.minHours} to ${way.maxHours} h a week`);
    assert.ok(Number.isInteger(way.minHours) && Number.isInteger(way.maxHours) && way.minHours >= 1 && way.minHours <= way.maxHours && way.maxHours <= 60);
    assert.equal(way.hoursEstimate, true, 'the hours are a model\'s too');
    assert.equal(way.clientsPay.estimate, true);
    assert.equal(way.clientsPay.source, WAY_SOURCE.en);
    assert.match(way.clientsPay.text, /^₹[\d,]+ to ₹[\d,]+$/);
    assert.ok(way.line.length > 0 && way.youDo.length > 0 && way.teamLine.length > 0 && way.clientsPay.per.length > 0);
  }
  assert.deepEqual(byId(view, 'youtube'), {
    ...byId(view, 'youtube'),
    playbook: 'youtube', label: 'YouTube channel', category: 'content', department: 'production',
    hours: '4 to 8 h a week', minHours: 4, maxHours: 8,
    // Ink v2 wave 5 (5A1): the tile's team (5B's Gallery tile line), the playbook's own roles in the tile's order.
    team: [
      { role: 'Story editor', initials: 'SE', department: 'production' }, { role: 'Producer', initials: 'PR', department: 'sales' },
      { role: 'Packager', initials: 'PA', department: 'marketing' },
    ],
    clientsPay: { text: '₹5,000 to ₹30,000', per: 'per video', estimate: true, source: WAY_SOURCE.en },
  });
  const ca = byId(view, 'ca-firm');
  assert.deepEqual([ca.label, ca.category, ca.department, ca.hours, ca.maxHours, ca.clientsPay.text, ca.clientsPay.per], ['CA practice', 'money-and-tax', 'money', '6 to 10 h a week', 10, '₹5,000 to ₹20,000', 'a client a month']);
  assert.deepEqual(ca.team.map(member => member.initials), ['RE', 'TP']);
  const social = byId(view, 'social-agency');
  assert.deepEqual([social.label, social.category, social.department, social.hours, social.maxHours, social.clientsPay.text, social.clientsPay.per], ['Social media agency', 'marketing', 'marketing', '4 to 6 h a week', 6, '₹8,000 to ₹25,000', 'a client a month']);
  assert.deepEqual(social.team.map(member => member.role), ['Strategist', 'Writer', 'Creative']);
  const names = view.ways.flatMap(way => way.team.map(member => member.role));
  for (const codeRole of ['Chausar', 'Calculator', 'Checks']) assert.ok(!names.includes(codeRole), `${codeRole} is code, not an agent`);
  assert.match(WAY_SOURCE.en, /^Model estimate/);
  assert.match(WAY_SOURCE.en, /not a survey, a quote or a promise/i);
});

test('ways: each way says what it needs in plain words: your own AI, the connections that work today, and your time', () => {
  const view = listWays({});
  for (const way of view.ways) {
    assert.equal(way.needs.ai, WAY_AI_NEED.en, 'the owner pays for their own AI');
    assert.equal(way.hi.needs.ai, WAY_AI_NEED.hi);
    assert.ok(way.needs.connections.length > 0 && way.hi.needs.connections.length > 0, way.id);
    assert.match(way.hi.needs.connections, DEVANAGARI);
  }
  // Every connection a way says it uses works today in that playbook (no planned one counts), and each is named.
  for (const way of WAYS) {
    assert.ok(way.uses.length > 0, way.playbook);
    for (const id of way.uses) assert.equal(connectorWorks(way.playbook, id), true, `${way.playbook} ${id}`);
  }
  // Every connection the words name as used is listed; Tally for the CA way among them (it reads today).
  assert.deepEqual(WAYS.find(way => way.playbook === 'ca-firm')!.uses, ['client-files', 'mail-app', 'tally']);
  assert.equal(connectorWorks('youtube', 'editor-handoff'), false, 'a planned handoff is not a need');
  assert.equal(connectorWorks('social-agency', 'posting'), false, 'posting is planned');
  assert.equal(connectorWorks('ca-firm', 'gst-portal'), false, 'filing on the portal stays with a person');
  assert.throws(() => validateWays([...WAYS.slice(1), { ...structuredClone(WAYS[0]), uses: ['gst-portal'] } as WayData]), /gst-portal is not a connection that works today/);
  // The YouTube way's words are its tile's (Ink v2 wave 5, 5B's Gallery tile line): the owner watches each cut.
  assert.match(byId(view, 'youtube').youDo, /watch each cut/);
  assert.match(byId(view, 'social-agency').needs.connections, /You post from your own accounts/);
});

test('ways: counts per category, only for categories that have a way, and the "Up to 5 h a week" count', () => {
  const view = listWays({});
  assert.deepEqual(view.categories, [
    { id: 'content', label: 'Content', hi: 'कंटेंट', count: 1 },
    { id: 'marketing', label: 'Marketing', hi: 'मार्केटिंग', count: 1 },
    { id: 'money-and-tax', label: 'Money and tax', hi: 'पैसा और टैक्स', count: 1 },
  ]);
  assert.deepEqual(WAY_CATEGORIES.map(category => category.id), ['content', 'marketing', 'money-and-tax', 'shops-and-firms']);
  for (const category of view.categories) assert.equal(category.count, view.ways.filter(way => way.category === category.id).length);
  assert.deepEqual(view.upTo, { maxHours: 5, label: 'Up to 5 h a week', hi: 'हफ़्ते में 5 घंटे तक', count: 0 });
  assert.deepEqual(waysUpTo(view.ways, 5), []);
  assert.deepEqual(waysUpTo(view.ways, 6).map(way => way.id), ['social-agency'], 'the filter reads maxHours');
  assert.deepEqual(waysUpTo(view.ways, 10).map(way => way.id), view.ways.map(way => way.id));
});

test('ways: sort by best fit (the fit first), fewest hours, or name', () => {
  const { ways } = listWays({});
  const ids = (list: readonly WayView[]) => list.map(way => way.id);
  assert.deepEqual(ids(orderWays(ways, 'best-fit', 'youtube')), ['youtube', 'ca-firm', 'social-agency'], "4C1's fit leads, the rest keep their order");
  assert.deepEqual(ids(orderWays(ways, 'best-fit', null)), ['ca-firm', 'youtube', 'social-agency'], 'no fit: registry order');
  assert.deepEqual(ids(orderWays(ways, 'best-fit', 'space-tourism')), ['ca-firm', 'youtube', 'social-agency'], 'a fit not on the list changes nothing');
  assert.deepEqual(ids(orderWays(ways, 'fewest-hours')), ['social-agency', 'youtube', 'ca-firm'], 'by the most hours a week, then the fewest');
  assert.deepEqual(ids(orderWays(ways, 'name')), ['ca-firm', 'social-agency', 'youtube']);
  assert.deepEqual(ids(orderWays(ways, 'name', null, 'hi')), [...ways].sort((a, b) => a.hi.label.localeCompare(b.hi.label, 'hi-IN')).map(way => way.id));
  assert.deepEqual(ids(ways), ['ca-firm', 'youtube', 'social-agency'], 'sorting never changes the list it was given');
});

test('ways: "You run this" and "Start another" come only from the businesses the host names', () => {
  const view = listWays({}, [
    { businessId: 'lumen', name: 'Lumen Studio', playbook: 'youtube' },
    { businessId: 'plain', name: 'Plain Help', playbook: null },
    { businessId: 'odd', name: 'Odd One', playbook: 'space-tourism' },
  ]);
  assert.deepEqual(byId(view, 'youtube').yours, [{ businessId: 'lumen', name: 'Lumen Studio' }]);
  assert.deepEqual(byId(view, 'ca-firm').yours, []);
  assert.deepEqual(byId(view, 'social-agency').yours, []);

  // The open business, from its own state: the playbook its idea picks.
  const state = { conversations: [{ kind: 'venture-record', id: 'venture_1', idea: 'Run a YouTube channel that explains personal finance in plain words', workingName: 'Lumen Studio' }] } as unknown as State;
  assert.deepEqual(openWayBusiness(state, 'lumen-folder'), { businessId: 'lumen-folder', name: 'Lumen Studio', playbook: 'youtube' });
  const plain = { conversations: [{ kind: 'venture-record', id: 'venture_2', idea: 'Pricing strategy advice for small online shops', workingName: 'Shop Advice' }] } as unknown as State;
  assert.deepEqual(openWayBusiness(plain, 'shop'), { businessId: 'shop', name: 'Shop Advice', playbook: null });
  assert.equal(openWayBusiness({ conversations: [] } as unknown as State, 'empty'), null, 'no business, nothing to show');
});

test('ways: every way names a registered playbook that runs today; a way for an unbuilt one is refused and never listed', () => {
  validateWays();
  const [first] = WAYS;
  const broken = (change: (way: WayData) => WayData) => [...WAYS.slice(1), change(structuredClone(first) as WayData)];
  assert.throws(() => validateWays([...WAYS, { ...structuredClone(first), playbook: 'space-tourism' } as WayData]), /space-tourism is not a registered playbook/);
  assert.throws(() => validateWays([...WAYS, structuredClone(first) as WayData]), /twice/);
  assert.throws(() => validateWays(broken(way => ({ ...way, hours: { min: 9, max: 4 } }))), /hours/);
  assert.throws(() => validateWays(broken(way => ({ ...way, hours: { min: 4, max: 61 } }))), /hours/);
  assert.throws(() => validateWays(broken(way => ({ ...way, pay: { ...way.pay, minRupees: 0 } }))), /pay/);
  assert.throws(() => validateWays(broken(way => ({ ...way, pay: { ...way.pay, minRupees: 90000, maxRupees: 1000 } }))), /pay/);
  assert.throws(() => validateWays(broken(way => ({ ...way, category: 'space' as WayData['category'] }))), /category/);
  assert.throws(() => validateWays(broken(way => ({ ...way, roles: {} }))), /Hindi name/);
  assert.throws(() => validateWays(broken(way => ({ ...way, en: { ...way.en, starter: 'Something with no playbook words at all.' } }))), /starter/);
  assert.throws(() => validateWays(broken(way => ({ ...way, hi: { ...way.hi, line: 'Only English here.' } }))), /Hindi/);
  assert.throws(() => validateWays(broken(way => ({ ...way, en: { ...way.en, line: `A line ${EM_DASH} with a dash.` } }))), /house style/);
  // A playbook that is not registered gets no tile, and a registered one with no way data gets none either (W5 adds its own).
  const registry = PLAYBOOK_REGISTRY.filter(entry => entry.id !== 'social-agency');
  assert.deepEqual(waysView(WAYS, registry, []).ways.map(way => way.id), ['ca-firm', 'youtube']);
  assert.deepEqual(waysView(WAYS.filter(way => way.playbook !== 'youtube'), PLAYBOOK_REGISTRY, []).ways.map(way => way.id), ['ca-firm', 'social-agency']);
});

test('ways: English and Hindi words, machine-drafted, plain, and never a promise', () => {
  const view = listWays({});
  const hidden = /[\p{Cf}\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u;
  assert.ok(!JSON.stringify(view).includes(EM_DASH), 'no em dash anywhere');
  assert.ok(!hidden.test(JSON.stringify(view)), 'no hidden characters');
  for (const way of view.ways) {
    const english = [
      way.label, way.line, way.hours, way.youDo, way.teamLine, way.clientsPay.text, way.clientsPay.per, way.clientsPay.source, way.starter,
      way.needs.ai, way.needs.connections, ...way.team.map(member => member.role),
    ];
    for (const words of english) {
      assert.deepEqual(houseStyleFindings(words), [], words);
      assert.doesNotMatch(words, /guarantee|you will earn|you'll earn|assured|earn up to/i, words);
    }
    const hindi = [
      way.hi.label, way.hi.line, way.hi.hours, way.hi.youDo, way.hi.teamLine, way.hi.pay, way.hi.per, way.hi.source, way.hi.starter,
      way.hi.needs.ai, way.hi.needs.connections, ...way.hi.team,
    ];
    for (const words of hindi) assert.match(words, DEVANAGARI, `${way.id}: ${words}`);
    assert.equal(way.hi.team.length, way.team.length, 'one Hindi name per agent');
    assert.equal(way.hi.hours, `हफ़्ते में ${way.minHours} से ${way.maxHours} घंटे`);
    assert.equal(way.hi.pay, way.clientsPay.text.replace(' to ', ' से '));
    assert.equal(way.hi.source, WAY_SOURCE.hi);
    // A tile's Start fills the one-sentence box with a starter that picks the same playbook, in either language; it never sends.
    assert.equal(pickPlaybook(way.starter)?.id, way.playbook, way.starter);
    assert.equal(pickPlaybook(way.hi.starter)?.id, way.playbook, way.hi.starter);
  }
  for (const category of view.categories) assert.match(category.hi, DEVANAGARI);
  assert.match(view.upTo.hi, DEVANAGARI);
});

test('ways: through the engine, the open business is "You run this" on its way, and only while it is open', async t => {
  const { engine } = await engineFor(t);
  await engine.request('workspace.create', { name: 'Lumen Studio', passphrase: PASSPHRASE, pack: 'services' });
  await engine.request('venture.create', { idea: 'Run a YouTube channel that explains personal finance in plain words', countryCode: 'IN', workingName: 'Lumen Studio' });
  const open = await engine.request('venture.playbooks.list', {}) as WaysView;
  const yours = byId(open, 'youtube').yours;
  assert.equal(yours.length, 1);
  assert.equal(yours[0].name, 'Lumen Studio');
  assert.ok(typeof yours[0].businessId === 'string' && yours[0].businessId.length > 0);
  assert.deepEqual([...byId(open, 'ca-firm').yours, ...byId(open, 'social-agency').yours], []);
  await engine.request('workspace.lock');
  const locked = await engine.request('venture.playbooks.list', {}) as WaysView;
  assert.deepEqual(locked.ways.flatMap(way => way.yours), [], 'a locked business is not read');
});

test('ways: Good fit for you (4C1) picks from this list, with the open business\'s way as the one the owner runs', async () => {
  const env = await chiefBusiness();
  const seen: any[] = [];
  env.models.respond['chief-fit'] = task => { seen.push(task); return { wayId: 'social-agency', line: 'You already make videos, so posts for shops fit next.' }; };
  assert.deepEqual(await env.chief('venture.chief.fit'), { wayId: 'social-agency', line: 'You already make videos, so posts for shops fit next.', estimate: true });
  assert.equal(seen.length, 1);
  assert.deepEqual((seen[0].input as any).ways.map((way: any) => way.id), ['ca-firm', 'youtube', 'social-agency']);
  assert.deepEqual((seen[0].input as any).yours, ['YouTube channel']);
  assert.equal(seen[0].containsClientData, false);
  assert.ok(!JSON.stringify(seen[0].input).includes('Test Business'), 'the business name is not sent, only its kind');
});

test('ways: the engine names the open business by the workspace the host uses', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-ways-'));
  const workspace = { current: () => ({ id: 'folder-lumen', name: 'Lumen Studio' }), businesses: async () => [], recovery: async () => null };
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file', venture: { host: 'test', modelTransport: replay([]), githubTransport: noGitHub, workspace } });
  t.after(async () => { await engine.close().catch(() => {}); await rm(directory, { recursive: true, force: true }); });
  await engine.request('workspace.create', { name: 'Lumen Studio', passphrase: PASSPHRASE, pack: 'services' });
  await engine.request('venture.create', { idea: 'Run a YouTube channel that explains personal finance in plain words', countryCode: 'IN', workingName: 'Lumen Studio' });
  const view = await engine.request('venture.playbooks.list', {}) as WaysView;
  assert.deepEqual(byId(view, 'youtube').yours, [{ businessId: 'folder-lumen', name: 'Lumen Studio' }]);
});

test('ways: the UI\'s fake engine keeps the engine\'s own ways and checklist, word for word', async () => {
  const fake = JSON.parse(await readFile(new URL('../../app/ui/src/engine/fixtures-start.json', import.meta.url), 'utf8'));
  assert.deepEqual(fake.ways, listWays({}));
  assert.deepEqual(fake.checklist, CHECKLIST_ITEMS.map(item => ({ id: item.id, label: item.label, link: item.link })));
});
