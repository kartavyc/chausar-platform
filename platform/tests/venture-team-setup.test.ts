// A small team proposed from the plan and hired at setup (founder, 14 Nov 2026: "let's build a few agents during
// setup"). The owner's AI proposes up to three agents in the same About you answer as the way to earn; code holds each
// one to the rules a hand hire passes and drops the ones that fail. venture.agents.hire.team (approve, app only) hires
// the cards the owner kept, each with the digest the engine gave it, through the hand hire's own records.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { aboutTask } from '../runtime/venture/core/about.ts';
import { HIRE_READS, checkTeamHire } from '../runtime/venture/agents/hire-check.ts';
import { HIRE_WORDS, MAX_HIRED } from '../runtime/venture/agents/hire.ts';
import { NO_PERSONA } from '../runtime/venture/agents/persona.ts';
import { TEAM_MAX, keptTeamWith, teamCardDigest } from '../runtime/venture/agents/team-proposal.ts';
import { APP_ONLY_METHODS, METHOD_OWNERS } from '../runtime/venture/contracts.ts';
import { METHOD_HINTS, METHOD_LEVEL_OF } from '../runtime/venture/method-hints.ts';
import { assertSchemaSafe } from '../runtime/venture/models/schema.ts';
import { teamAgents } from '../runtime/venture/chief/routing.ts';
import { CHIEF_INSTRUCTIONS } from '../runtime/venture/chief/answer.ts';
import { currentVenture, listRecords } from '../runtime/venture/records.ts';
import { handlers as viewHandlers } from '../runtime/venture/views/index.ts';
import { engineFor, connectPair } from './fixtures/venture/compose-unit/harness.ts';
import { anthropicEntry } from './fixtures/venture/compose-unit/plans.ts';
import { agentBusiness, consent } from './venture-agent-helpers.ts';
import { answer, chatConsent, chiefBusiness, scriptChief, text } from './venture-chief-helpers.ts';
import { owner, phone } from './venture-judge-helpers.ts';

const POTTER = 'I make pottery by hand, mostly mugs and bowls, and I want bulk wholesale orders from cafes and hotels in Pune.';
const WAY = {
  customer: 'Independent cafes and small hotels in Pune that buy tableware in bulk.',
  reach: 'A list of cafes found from public listings, then a first message you send to each owner.',
  teamDoes: 'Finds the cafes, drafts each message and quote, and keeps track of who replied.',
  youDo: 'Make the samples, set the prices, send each message and take the calls.',
  firstWeek: ['Decide the set sizes and your price for each offer.', 'Approve the first list of cafes.', 'Send the first five messages.'],
};
const OFFERS = [{ name: 'Cafe mug sets', line: 'Handmade mugs in bulk for cafes' }];
const SCOUT = { name: 'Asha', job: 'Finds cafes that buy tableware in bulk.', duties: ['Lists cafes in Pune from public listings', 'Flags the ones that fit your sets'], reads: ['plan', 'trackers'] };
const WRITER = { name: 'Kabir', job: 'Drafts quotes for your approval.', duties: ['Drafts a quote for each enquiry', 'Prepares a first message for each cafe'], reads: ['plan', 'clients'] };
const KEEPER_OF_REPLIES = { name: 'Meera', job: 'Keeps track of replies.', duties: ['Tracks who replied', 'Summarises open orders each week'], reads: ['clients', 'orders', 'trackers'] };
const TEAM = [SCOUT, WRITER, KEEPER_OF_REPLIES];
const kept = (value: unknown) => keptTeamWith(checkTeamHire, value);
const card = (agent: typeof SCOUT) => ({ ...agent, digest: teamCardDigest(agent as never) });
// A kept agent names its department (venture-about-winfix.test.ts): the AI's own, or code's from the duties as here.
const WHERE: Record<string, string> = { Asha: 'sales', Kabir: 'sales', Meera: 'operations' };
const placed = <T extends { name: string }>(agent: T) => ({ ...agent, department: WHERE[agent.name]! });
const keptCard = (agent: typeof SCOUT) => card(placed(agent) as never);
const hires = (env: any) => listRecords(env.store.read(), 'venture-agent-hire').filter(record => record.status === 'hired');

test('the team is part of the About you task: a strict schema, reads from the hire list only, and one short instruction', () => {
  const task = aboutTask({ text: POTTER, file: null });
  assert.doesNotThrow(() => assertSchemaSafe(task.schema));
  const schema = (task.schema as any).properties.team;
  assert.equal(schema.type, 'array');
  assert.deepEqual(schema.items.required, ['name', 'job', 'duties', 'reads', 'department']);
  assert.deepEqual(schema.items.properties.reads.items.enum, [...HIRE_READS]);
  assert.ok((task.schema as any).required.includes('team'));
  assert.match(task.instructions, /As team,/);
  assert.equal(TEAM_MAX, 3);
});

test('a good team is kept as written, each agent with the digest of its own card', () => {
  const team = kept(TEAM);
  assert.deepEqual(team.map(({ digest: _digest, ...agent }) => agent), TEAM.map(placed));
  for (const agent of team) assert.match(agent.digest, /^[0-9a-f]{64}$/);
  assert.deepEqual(team.map(agent => agent.digest), TEAM.map(agent => teamCardDigest(placed(agent) as never)));
  assert.equal(new Set(team.map(agent => agent.digest)).size, 3);
  // Spaces are tidied as a hand hire tidies them.
  assert.equal(kept([{ ...SCOUT, name: '  Asha ' }])[0]!.name, 'Asha');
});

test('an agent that breaks a hire rule is dropped and the rest stay', () => {
  const bad: [string, unknown][] = [
    ['a duty that sends', { ...WRITER, duties: ['Sends quotes to cafes'] }],
    ['a duty that acts unasked', { ...WRITER, duties: ['Drafts quotes and emails them automatically'] }],
    ['a hard stop', { ...WRITER, job: 'Gives stock tips to clients.' }],
    ['a price', { ...WRITER, duties: ['Drafts quotes at ₹500 a mug'] }],
    ['a price in words', { ...WRITER, duties: ['Drafts quotes at 500 rupees a mug'] }],
    ['a link', { ...WRITER, job: 'Drafts posts for https://example.com.' }],
    ['a promise of results', { ...WRITER, duties: ['Drafts messages that guarantee more orders'] }],
    ['a read outside the list', { ...WRITER, reads: ['plan', 'passwords'] }],
    ['a read twice', { ...WRITER, reads: ['plan', 'plan'] }],
    ['no duties', { ...WRITER, duties: [] }],
    ['six duties', { ...WRITER, duties: ['Drafts a', 'Drafts b', 'Drafts c', 'Drafts d', 'Drafts e', 'Drafts f'] }],
    ['an extra field', { ...WRITER, canSend: true }],
    ['a missing field', { name: 'Kabir', job: WRITER.job, duties: WRITER.duties }],
    ['not an agent', 'Kabir drafts quotes'],
  ];
  for (const [why, agent] of bad) assert.deepEqual(kept([SCOUT, agent, KEEPER_OF_REPLIES]).map(item => item.name), ['Asha', 'Meera'], why);
  assert.deepEqual(kept([{ ...WRITER, duties: ['Sends quotes to cafes'] }]), []);
  // A name that is taken (Keeper's, or an agent's already on this team) is no reason to lose the agent: it is named
  // after what it does, by rule (fix round 4, venture-team-names-fix4.test.ts).
  for (const name of ['Keeper', 'Chausar', 'asha']) assert.deepEqual(kept([SCOUT, { ...WRITER, name }, KEEPER_OF_REPLIES]).map(item => item.name), ['Asha', 'Drafter', 'Meera'], name);
});

test('more than three are cut to three, and anything that is not a list is no team', () => {
  const five = [...TEAM, { ...SCOUT, name: 'Dev' }, { ...SCOUT, name: 'Ila' }];
  assert.deepEqual(kept(five).map(agent => agent.name), ['Asha', 'Kabir', 'Meera']);
  // A dropped agent leaves room for the next good one.
  assert.deepEqual(kept([{ ...SCOUT, duties: ['Sends messages to cafes'] }, ...five.slice(1)]).map(agent => agent.name), ['Kabir', 'Meera', 'Dev']);
  for (const none of [null, undefined, 'a team', {}, []]) assert.deepEqual(kept(none), []);
});

test('about.read carries the team only beside offers and a way; a bad agent is dropped and the read stands', async t => {
  const base = { familyId: null, professionId: null, offers: OFFERS, countryCode: null, evidence: null, reply: 'Where are you based?' };
  const must = [POTTER, 'familyId', 'untrusted'];
  const { engine } = await engineFor(t, { responses: [
    anthropicEntry('decide', { ...base, way: WAY, team: TEAM }, must),
    anthropicEntry('decide', { ...base, way: WAY, team: [SCOUT, { ...WRITER, duties: ['Sends quotes to cafes'] }, KEEPER_OF_REPLIES] }, must),
    anthropicEntry('decide', { ...base, way: { ...WAY, youDo: 'Charge ₹500 a mug.' }, team: TEAM }, must),
    anthropicEntry('decide', { ...base, way: WAY, team: [] }, must),
    anthropicEntry('decide', { ...base, way: WAY }, must),
    anthropicEntry('decide', { ...base, way: WAY, team: 'Asha, Kabir and Meera' }, must),
  ] });
  await connectPair(engine);
  const read = () => engine.request('venture.about.read', { text: POTTER }) as Promise<any>;
  const first = await read();
  assert.deepEqual(first.team, TEAM.map(keptCard));
  assert.deepEqual(first.way, WAY);
  const second = await read();
  assert.deepEqual(second.team, [keptCard(SCOUT), keptCard(KEEPER_OF_REPLIES)]);
  assert.deepEqual(second.offers, OFFERS);
  const third = await read();
  assert.equal(third.way, undefined);
  assert.equal(third.team, undefined, 'no team without a way');
  for (const which of ['an empty team', 'an answer with no team', 'a team that is not a list']) {
    const next = await read();
    assert.equal(next.team, undefined, which);
    assert.deepEqual(next.way, WAY, which);
  }
});

test('templates only: no AI wrote a team, so there is none', async t => {
  const { engine } = await engineFor(t);
  const read = await engine.request('venture.about.read', { text: 'I am a chartered accountant and I file GST returns for small shops.' }) as any;
  assert.equal(read.source, 'keywords');
  assert.equal(read.team, undefined);
  assert.equal(read.way, undefined);
});

test('the new method is the owner\'s own, in the app: approve level, app only, the agents package', () => {
  assert.ok(APP_ONLY_METHODS.includes('venture.agents.hire.team'));
  assert.equal(METHOD_LEVEL_OF['venture.agents.hire.team'], 'approve');
  assert.equal(METHOD_OWNERS['venture.agents.hire.team'], 'agents');
  assert.deepEqual(METHOD_HINTS['venture.agents.hire.team'], { readOnly: false, undoable: true, idempotent: true, reachesOutside: false });
});

test('hiring the team makes hired records in the shape of a hand hire, and Team, routing and chat know them', async () => {
  const env = await agentBusiness();
  const answered = await env.agents('venture.agents.hire.team', { agents: TEAM.map(card) });
  assert.deepEqual(answered.hired.map((view: any) => view.role), TEAM.map(({ name, job, duties }) => ({ name, job, duties })));
  for (const view of answered.hired) assert.deepEqual([view.status, view.phase, view.department, view.voice], ['hired', 'review', 'operations', NO_PERSONA]);
  assert.deepEqual(answered.hired[0].card.does, SCOUT.duties);
  assert.equal(answered.hired[0].card.asks, HIRE_WORDS.asks);
  const made = hires(env);
  assert.deepEqual(made.map(record => record.role?.name), ['Asha', 'Kabir', 'Meera']);
  assert.deepEqual(made[0]!.reads, [{ read: 'plan', why: '' }, { read: 'trackers', why: '' }]);
  assert.deepEqual(made.map(record => record.digest), TEAM.map(agent => teamCardDigest(agent as never)));
  // The same fields a hand hire leaves behind, each of the same kind.
  await consent(env, 'story-editor');
  env.models.respond['agent-chat'] = task => {
    if (task.schemaName === 'venture-hire-role') return { name: 'Mira', job: 'Keeps the content calendar.', duties: ['Keeps the content calendar up to date'] };
    if (task.schemaName === 'venture-hire-reads') return { reads: [{ read: 'plan', why: 'To know the offers.' }] };
    return { tone: '', replyLength: 'short', greeting: '', handOffLine: '', blockedTopics: [], signOff: '' };
  };
  const hand = await env.agents('venture.agents.hire.start', { sentence: 'someone who keeps my content calendar' });
  await env.agents('venture.agents.hire.answer', { hireId: hand.id, phase: 'role' });
  await env.agents('venture.agents.hire.answer', { hireId: hand.id, phase: 'reads' });
  const review = await env.agents('venture.agents.hire.answer', { hireId: hand.id, phase: 'voice' });
  await env.agents('venture.agents.hire.confirm', { hireId: hand.id, digest: review.digest });
  const byHand = hires(env).find(record => record.id === hand.id)!;
  const kinds = (record: object) => Object.fromEntries(Object.entries(record).map(([key, value]) => [key, Array.isArray(value) ? 'list' : value === null ? 'null' : typeof value]));
  assert.deepEqual(kinds(made[0]!), kinds(byHand));
  assert.deepEqual(Object.keys(made[0]!.voice!).sort(), Object.keys(byHand.voice!).sort());
  // Team shows them as hired agents, routing knows them by name, and each has a chat.
  const state = env.store.read(), venture = currentVenture(state)!;
  const team = await (viewHandlers as any)['venture.team.list'](env.deps, owner, {});
  for (const record of made) {
    const shown = team.agents.find((agent: any) => agent.id === record.id);
    assert.deepEqual([shown.name, shown.posture, shown.department], [record.role!.name, 'approve-each', 'operations']);
    assert.deepEqual(shown.hired.duties, record.role!.duties);
    assert.ok(teamAgents(state, venture).some(agent => agent.id === record.id && agent.job === record.role!.job));
    assert.equal((await env.agents('venture.agents.thread.list', { agent: record.id })).agent.name, record.role!.name);
  }
  // Retiring one works as it does for any hired agent.
  const check = await env.agents('venture.agents.retire.check', { agent: made[0]!.id });
  await env.agents('venture.agents.retire', { agent: made[0]!.id, to: 'owner', digest: check.digest });
  assert.ok(!teamAgents(env.store.read(), venture).some(agent => agent.id === made[0]!.id));
  // The audit log names the act, as it does for a hand hire.
  const acts = env.store.read().activity.map((entry: any) => entry.event);
  assert.ok(acts.includes('venture.agents.hire.team') && acts.includes('venture.agents.hire.confirm'));
});

test('a card that is not the one the engine gave is refused, and so is anyone but the owner in the app', async () => {
  const env = await agentBusiness();
  const stale = { code: 'APPROVAL_STALE' };
  await assert.rejects(env.agents('venture.agents.hire.team', { agents: [{ ...card(SCOUT), digest: 'a'.repeat(64) }] }), stale);
  await assert.rejects(env.agents('venture.agents.hire.team', { agents: [{ ...card(SCOUT), job: 'Finds anyone at all.' }] }), stale, 'words changed after the digest was made');
  await assert.rejects(env.agents('venture.agents.hire.team', { agents: [card(SCOUT), { ...card(WRITER), digest: 'nope' }] }), stale);
  for (const ctx of [phone, { ...owner, channel: 'mcp' as const }, { ...owner, sourceTainted: true }, { memberId: 'owner', role: 'owner' as const, epoch: 1 }]) {
    await assert.rejects(env.agents('venture.agents.hire.team', { agents: TEAM.map(card) }, ctx as never), { code: 'APP_APPROVAL_REQUIRED' }, JSON.stringify(ctx));
  }
  await env.store.update((state: any) => { state.members.push({ id: 'viewer', name: 'Viewer', role: 'viewer', active: true, epoch: 1, branches: ['*'] }); });
  await assert.rejects(env.agents('venture.agents.hire.team', { agents: TEAM.map(card) }, { memberId: 'viewer', role: 'viewer', epoch: 1, channel: 'desktop' } as never), { code: 'FORBIDDEN' });
  const shape = { code: 'INVALID_VENTURE_REQUEST' };
  for (const payload of [{}, { agents: [] }, { agents: 'Asha' }, { agents: TEAM.map(card), digest: 'x' }, { agents: [...TEAM, { ...SCOUT, name: 'Dev' }].map(card) }, { agents: [SCOUT] }, { agents: [{ ...card(SCOUT), extra: true }] }]) {
    await assert.rejects(env.agents('venture.agents.hire.team', payload), shape, JSON.stringify(payload).slice(0, 60));
  }
  assert.deepEqual(hires(env), [], 'nothing was hired by any refused call');
});

test('every agent is checked again at the hire, and one that fails stops the whole card', async () => {
  const env = await agentBusiness();
  const sends = { ...WRITER, duties: ['Sends quotes to cafes'] };
  await assert.rejects(env.agents('venture.agents.hire.team', { agents: [card(SCOUT), card(sends)] }), { code: 'HIRE_FLOOR' });
  await assert.rejects(env.agents('venture.agents.hire.team', { agents: [card({ ...WRITER, job: 'Gives stock tips to clients.' })] }), { code: 'HIRE_HARD_STOP' });
  await assert.rejects(env.agents('venture.agents.hire.team', { agents: [card({ ...WRITER, duties: ['Drafts quotes at ₹500 a mug'] })] }), { code: 'INVALID_VENTURE_REQUEST' });
  const state = env.store.read(), taken = teamAgents(state, currentVenture(state)!)[0]!.name;
  await assert.rejects(env.agents('venture.agents.hire.team', { agents: [card(SCOUT), card({ ...WRITER, name: taken })] }), { code: 'INVALID_VENTURE_REQUEST' });
  await assert.rejects(env.agents('venture.agents.hire.team', { agents: [card(SCOUT), card({ ...WRITER, name: 'Asha' })] }), { code: 'INVALID_VENTURE_REQUEST' }, 'two agents on one card with one name');
  assert.deepEqual(hires(env), []);
});

test('a repeated click hires once, and the limit of hired agents holds', async () => {
  const env = await agentBusiness();
  const first = await env.agents('venture.agents.hire.team', { agents: TEAM.map(card) });
  const again = await env.agents('venture.agents.hire.team', { agents: TEAM.map(card) });
  assert.deepEqual(again, first, 'the same cards answer with the same hires');
  assert.equal(hires(env).length, 3);
  // A card already hired is not hired twice even beside a new one.
  const dev = { ...SCOUT, name: 'Dev' }, ila = { ...WRITER, name: 'Ila' }, omar = { ...KEEPER_OF_REPLIES, name: 'Omar' };
  const more = await env.agents('venture.agents.hire.team', { agents: [card(SCOUT), card(dev)] });
  assert.deepEqual(more.hired.map((view: any) => view.role.name), ['Asha', 'Dev']);
  assert.equal(hires(env).length, 4);
  // Four are hired; two more would pass the limit, so neither is hired. One more fits.
  assert.equal(MAX_HIRED, 5);
  await assert.rejects(env.agents('venture.agents.hire.team', { agents: [card(ila), card(omar)] }), { code: 'HIRE_LIMIT', message: HIRE_WORDS.limit });
  assert.equal(hires(env).length, 4);
  await env.agents('venture.agents.hire.team', { agents: [card(ila)] });
  await assert.rejects(env.agents('venture.agents.hire.team', { agents: [card(omar)] }), { code: 'HIRE_LIMIT' });
  assert.equal(hires(env).length, 5);
  // The repeat still answers once the team is full: nothing new is asked for.
  assert.deepEqual((await env.agents('venture.agents.hire.team', { agents: TEAM.map(card) })).hired.map((view: any) => view.id), first.hired.map((view: any) => view.id));
});

test('hiring the team needs no AI call and no chat consent', async () => {
  const env = await agentBusiness();
  env.models.respond['agent-chat'] = () => { throw new Error('the team hire asked the AI'); };
  await env.agents('venture.agents.hire.team', { agents: [card(SCOUT)] });
  assert.equal(listRecords(env.store.read(), 'venture-chat-consent').length, 0);
  assert.equal(hires(env).length, 1);
});

test('the chief is told who is on the team and what each one does', async () => {
  const env = await chiefBusiness();
  await chatConsent(env);
  const { hired } = await env.agents('venture.agents.hire.team', { agents: TEAM.map(card) });
  const tasks = scriptChief(env, [answer([text('Asha finds the cafes.')])]);
  await env.chief('venture.chief.thread.send', { text: 'Who finds my customers?' });
  const agents = (tasks[0]!.input as any).agents as { id: string; name: string; job: string }[];
  for (const [index, agent] of TEAM.entries()) assert.deepEqual(agents.find(item => item.id === hired[index].id), { id: hired[index].id, name: agent.name, job: agent.job });
  assert.match(CHIEF_INSTRUCTIONS, /agents lists the team/);
});

test('the standing lines the card shows are the engine\'s own words', () => {
  const words = JSON.parse(readFileSync(new URL('../../app/ui/src/text/en/first-run.json', import.meta.url), 'utf8')) as Record<string, string>;
  assert.equal(words['first-run.team.never'], HIRE_WORDS.teamNever);
  assert.equal(words['first-run.team.asks'], HIRE_WORDS.teamAsks);
  for (const line of [HIRE_WORDS.teamNever, HIRE_WORDS.teamAsks]) assert.ok(!/[\u2014\u2013]/.test(line));
});
