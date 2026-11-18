// A hired agent's "Can do" page (found by running the real app, 15 Nov 2026: the tab said "That agent was not found").
// venture.agents.capabilities knew only the agents that come from the plan's steps. An agent the owner hired, at setup
// or by hand on Team, has an honest page of its own: its duties, what its hire card lets it read, what it can never do
// and that it asks first. Before and after the plan is accepted.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { CapabilityPageView } from '../runtime/venture/contracts.ts';
import { handlers as agentHandlers } from '../runtime/venture/agents/index.ts';
import { teamCardDigest } from '../runtime/venture/agents/team-proposal.ts';
import { HIRE_READS } from '../runtime/venture/agents/hire-check-core.ts';
import { HIRED_PAGE_WORDS, HIRED_READ_WORDS, hiredCapabilityPage } from '../runtime/venture/agents/hired-capabilities.ts';
import { code, owner, phone, seedBlueprint, setup, type Env } from './venture-views-env.ts';

const SCOUT = { name: 'Asha', job: 'Finds cafes that buy tableware in bulk.', duties: ['Lists cafes in Pune from public listings', 'Flags the ones that fit your sets.'], reads: ['plan', 'trackers'] };
const BOOKS = { name: 'Kabir', job: 'Keeps an eye on what is owed.', duties: ['Lists who owes you each week'], reads: ['money', 'clients'] };
const card = (agent: typeof SCOUT) => ({ ...agent, digest: teamCardDigest(agent as never) });
const agents = (env: Env, method: string, payload: unknown = {}, ctx = owner): Promise<any> => (agentHandlers as any)[method](env.deps, ctx, payload);
const page = (env: Env, agent: string, ctx = owner): Promise<CapabilityPageView> => agents(env, 'venture.agents.capabilities', { agent }, ctx);
const keys = (view: CapabilityPageView, list: 'see' | 'do' | 'off') => view.items.filter(item => item.list === list).map(item => item.key);

test('every area a hire card can list has owner words, with no dash', () => {
  assert.deepEqual(Object.keys(HIRED_READ_WORDS).sort(), [...HIRE_READS].sort());
  for (const words of [...Object.values(HIRED_READ_WORDS), ...Object.values(HIRED_PAGE_WORDS)]) assert.ok(words.length > 10 && !/[\u2014\u2013]/.test(words), words);
});

test('an agent hired at setup has its own page before the plan is accepted: duties, its card\'s reads, what is off, and that it asks', async () => {
  const env = await setup();
  await seedBlueprint(env, { status: 'draft' });
  const { hired } = await agents(env, 'venture.agents.hire.team', { agents: [card(SCOUT), card(BOOKS)] });
  const view = await page(env, hired[0].id);
  assert.equal(view.agent, hired[0].id);
  assert.equal(view.line, HIRED_PAGE_WORDS.line);
  // What it reads: its chat, then only the areas its card lists, in the hire's own order.
  assert.deepEqual(keys(view, 'see'), ['hire:chat', 'read:plan', 'read:trackers']);
  assert.deepEqual(view.canSee, [HIRED_PAGE_WORDS.chat, HIRED_READ_WORDS.plan, HIRED_READ_WORDS.trackers]);
  // What it does: its duties as sentences, then chat, routines, trackers, asking first, and the owner's own AI.
  assert.deepEqual(keys(view, 'do'), ['duty:1', 'duty:2', 'hire:answers', 'hire:routines', 'hire:trackers', 'hire:asks', 'hire:provider']);
  // A duty that sounds like a search says what the agent really does with it (venture-copy-round3.test.ts).
  assert.deepEqual(view.canDo.slice(0, 2), [`Lists cafes in Pune from public listings. ${HIRED_PAGE_WORDS.listsOnly}`, 'Flags the ones that fit your sets.']);
  assert.ok(view.items.filter(item => item.list === 'do').every(item => item.state === 'works'));
  // What is off: no send, pay, post, delete or price; no search or contact; no order files; nothing off its card; no amounts.
  assert.deepEqual(keys(view, 'off'), ['hire:write', 'hire:reach', 'hire:orders', 'hire:reads', 'hire:amounts']);
  assert.match(view.off[0]!, /send, pay, post, delete or change a price/);
  assert.match(view.off[1]!, /search the web, find customers or contact anyone/);
  assert.ok(view.items.filter(item => item.list === 'off').every(item => item.state === 'off'));
  // The lists are the items' lines, list by list.
  for (const [list, lines] of [['see', view.canSee], ['do', view.canDo], ['off', view.off]] as const) assert.deepEqual(lines, view.items.filter(item => item.list === list).map(item => item.line));
  // An agent whose card lists money is not told it sees no amount.
  const books = await page(env, hired[1].id);
  assert.deepEqual(keys(books, 'see'), ['hire:chat', 'read:clients', 'read:money']);
  assert.ok(!keys(books, 'off').includes('hire:amounts'));
  // The plan's own agent still waits for the plan, and the page reads on the phone too.
  await assert.rejects(page(env, 'delivery'), code('AGENT_NOT_FOUND'));
  assert.equal((await page(env, hired[0].id, phone)).agent, hired[0].id);
});

test('after the plan is accepted the hired agent keeps its own page, and the plan\'s agent keeps the team\'s', async () => {
  const env = await setup();
  await seedBlueprint(env, { status: 'draft' });
  const { hired } = await agents(env, 'venture.agents.hire.team', { agents: [card(SCOUT)] });
  await seedBlueprint(env, { version: 2, price2: '1500000' });
  const view = await page(env, hired[0].id);
  assert.equal(view.line, HIRED_PAGE_WORDS.line);
  assert.deepEqual(keys(view, 'see'), ['hire:chat', 'read:plan', 'read:trackers']);
  assert.ok(!view.items.some(item => item.key.startsWith('tool:') || item.key.startsWith('step:')), 'no step and no team tool is claimed for it');
  const delivery = await page(env, 'delivery');
  assert.ok(delivery.items.some(item => item.key.startsWith('step:')));
  await assert.rejects(page(env, 'nobody'), code('AGENT_NOT_FOUND'));
});

test('a card with nothing to read and no duties says so: an empty list never means everything', () => {
  const view = hiredCapabilityPage({ id: 'hire-x', duties: [], reads: [] });
  assert.deepEqual(view.canSee, [HIRED_PAGE_WORDS.chat, HIRED_PAGE_WORDS.noReads]);
  assert.equal(view.canDo[0], HIRED_PAGE_WORDS.noDuties);
  assert.equal(view.items.find(item => item.key === 'hire:no-reads')!.state, 'off');
  // A read the hire does not know is never shown.
  assert.deepEqual(hiredCapabilityPage({ id: 'hire-x', duties: ['Keeps a list'], reads: [{ read: 'keys' }] }).canSee, [HIRED_PAGE_WORDS.chat, HIRED_PAGE_WORDS.noReads]);
});
