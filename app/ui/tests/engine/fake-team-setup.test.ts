import { describe, expect, it } from 'vitest';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { fakeTeamCheck } from '../../src/engine/fake-hire';
import { TEAM_WAITS_FOR_PLAN, keptTeamWith, teamCardDigest } from '../../../../platform/runtime/venture/agents/team-proposal';
import { priceAndAcceptPlan } from '../helpers/accepted-plan';

// The team proposed at setup, as the engine answers it (core/about.ts beside the way, agents/hire.ts hireTeamHandler):
// the fake's About you read carries a checked team with each card's digest, and venture.agents.hire.team takes those
// cards with the engine's codes, order and words.
const card = (name: string, job: string, duties: string[], reads: string[]) => ({ name, job, duties, reads, digest: teamCardDigest({ name, job, duties, reads } as never) });
const ASHA = card('Asha', 'Lists likely customers for me.', ['Lists likely customers from public sources'], ['plan', 'trackers']);
const KABIR = card('Kabir', 'Drafts quotes for my approval.', ['Drafts a quote for each enquiry'], ['plan', 'clients']);
const MEERA = card('Meera', 'Keeps track of replies.', ['Tracks who replied'], ['clients', 'orders']);

async function withAi() {
  const client = createFakeClient(new FakeEngine({ fresh: true }));
  const options = await client.request('venture.ai.options', {});
  const preset = options.presets.find((row) => row.id === 'claude-code-cli')!;
  await client.request('venture.ai.connect', { presetId: preset.id, consentDigest: preset.consentDigest });
  return client;
}
const hired = async (client: ReturnType<typeof createFakeClient>) => (await client.request('venture.team.list', {})).agents.filter((agent) => agent.hired);

describe('fake About you: the team beside the way', () => {
  it('an AI read carries one to three checked agents, each with the digest of its own card', async () => {
    const client = await withAi();
    const read = await client.request('venture.about.read', { text: 'I am an advocate in Pune and want to help small firms with contracts.' });
    expect(read.way).toBeTruthy();
    expect(read.team!.length).toBeGreaterThanOrEqual(1);
    expect(read.team!.length).toBeLessThanOrEqual(3);
    for (const agent of read.team!) {
      expect(Object.keys(agent)).toEqual(['name', 'job', 'duties', 'reads', 'department', 'digest']);
      expect(agent.digest).toBe(teamCardDigest(agent as never));
    }
    // The same check the engine runs keeps every one of them as written.
    expect(keptTeamWith(fakeTeamCheck, read.team!.map(({ digest: _digest, ...agent }) => agent))).toEqual(read.team);
  });

  it('keywords (no AI) and a tile carry no team', async () => {
    const client = createFakeClient(new FakeEngine({ fresh: true }));
    expect((await client.request('venture.about.read', { text: 'I am an advocate in Pune and want to help small firms.' })).team).toBeUndefined();
    expect((await client.request('venture.about.pick', { familyId: 'licensed' })).team).toBeUndefined();
  });
});

describe('fake venture.agents.hire.team', () => {
  it('hires the cards as hired agents in the shape of a hand hire, once', async () => {
    const client = createFakeClient(new FakeEngine());
    const first = await client.request('venture.agents.hire.team', { agents: [ASHA, KABIR] });
    expect(first.hired.map((view) => [view.status, view.phase, view.department, view.role?.name])).toEqual([['hired', 'review', 'operations', 'Asha'], ['hired', 'review', 'operations', 'Kabir']]);
    expect(first.hired[0]!.voice).toEqual({ tone: null, replyLength: null, greeting: null, handOffLine: null, blockedTopics: [], signOff: null });
    expect(first.hired[0]!.reads).toEqual([{ read: 'plan', why: '' }, { read: 'trackers', why: '' }]);
    expect(first.hired[0]!.card).toMatchObject({ does: ASHA.duties, asks: 'It asks you before anything leaves.' });
    expect(first.hired[0]!.digest).toBe(ASHA.digest);
    // The same fields a hand hire's view has.
    const hand = await client.request('venture.agents.hire.start', { sentence: 'someone who keeps my content calendar' });
    expect(Object.keys(first.hired[0]!).sort()).toEqual(Object.keys(hand).sort());
    // A repeated click hires nobody new, and a card already hired is answered beside a new one.
    expect(await client.request('venture.agents.hire.team', { agents: [ASHA, KABIR] })).toEqual(first);
    const more = await client.request('venture.agents.hire.team', { agents: [KABIR, MEERA] });
    expect(more.hired.map((view) => view.role?.name)).toEqual(['Kabir', 'Meera']);
    expect((await hired(client)).map((agent) => agent.name)).toEqual(['Asha', 'Kabir', 'Meera']);
  });

  it('refuses with the engine codes: a wrong shape, a digest that is not the card, a broken rule, the limit', async () => {
    const client = createFakeClient(new FakeEngine());
    const invalid = { code: 'INVALID_VENTURE_REQUEST' };
    for (const params of [{}, { agents: [] }, { agents: 'Asha' }, { agents: [ASHA], digest: 'x' }, { agents: [{ name: 'Asha' }] }, { agents: [ASHA, ASHA] }, { agents: [ASHA, KABIR, MEERA, card('Dev', 'Tracks orders.', ['Tracks orders'], [])] }]) {
      await expect(client.request('venture.agents.hire.team', params as never), JSON.stringify(params).slice(0, 50)).rejects.toMatchObject(invalid);
    }
    await expect(client.request('venture.agents.hire.team', { agents: [{ ...ASHA, digest: 'a'.repeat(64) }] })).rejects.toMatchObject({ code: 'APPROVAL_STALE', message: 'This changed since you read it. Read it again.' });
    await expect(client.request('venture.agents.hire.team', { agents: [{ ...ASHA, job: 'Lists anyone at all.' }] })).rejects.toMatchObject({ code: 'APPROVAL_STALE' });
    // Every agent is checked again; one that fails stops the whole card.
    await expect(client.request('venture.agents.hire.team', { agents: [ASHA, card('Kabir', 'Drafts quotes.', ['Sends quotes to cafes'], [])] })).rejects.toMatchObject({ code: 'HIRE_FLOOR' });
    await expect(client.request('venture.agents.hire.team', { agents: [card('Kabir', 'Gives stock tips to clients.', ['Drafts notes'], [])] })).rejects.toMatchObject({ code: 'HIRE_HARD_STOP' });
    await expect(client.request('venture.agents.hire.team', { agents: [card('Kabir', 'Drafts quotes.', ['Drafts quotes at ₹500 a mug'], [])] })).rejects.toMatchObject(invalid);
    await expect(client.request('venture.agents.hire.team', { agents: [ASHA, card('Editor', 'Drafts quotes.', ['Drafts quotes'], [])] }), 'a name already on the team').rejects.toMatchObject(invalid);
    expect(await hired(client)).toEqual([]);
    // Five hired agents at most: three, then two more fit, then one more does not.
    await client.request('venture.agents.hire.team', { agents: [ASHA, KABIR, MEERA] });
    const dev = card('Dev', 'Tracks orders.', ['Tracks orders'], []), ila = card('Ila', 'Tracks payments.', ['Tracks payments'], []), omar = card('Omar', 'Tracks leads.', ['Tracks leads'], []);
    await expect(client.request('venture.agents.hire.team', { agents: [dev, ila, omar] })).rejects.toMatchObject({ code: 'HIRE_LIMIT', message: 'A business keeps at most 5 hired agents. Retire one first.' });
    await client.request('venture.agents.hire.team', { agents: [dev, ila] });
    await expect(client.request('venture.agents.hire.team', { agents: [omar] })).rejects.toMatchObject({ code: 'HIRE_LIMIT' });
    expect((await hired(client)).length).toBe(5);
  });

  it('is the owner in the app only: the hosted web app refuses it', async () => {
    const client = createFakeClient(new FakeEngine({ hosted: true }));
    await expect(client.request('venture.agents.hire.team', { agents: [ASHA] })).rejects.toMatchObject({ code: 'APP_APPROVAL_REQUIRED' });
  });
});

// The team is built at setup (founder, 14 Nov 2026): as views/team.ts, hired agents stand on the team before the plan
// is accepted, with one line for the plan's own agents; Keeper and the team's own health join with the plan.
describe('fake venture.team.list before the plan is accepted', () => {
  async function unaccepted() {
    const engine = new FakeEngine({ fresh: true });
    const client = createFakeClient(engine);
    await client.request('workspace.create', { name: 'Clay Corner', pack: 'services' });
    await client.request('venture.create', { idea: 'Handmade pottery sold in bulk to cafes and small hotels', countryCode: 'IN' });
    return { engine, client };
  }

  it('lists the hired agents only, each with its chat, and says the plan brings the rest', async () => {
    const { client } = await unaccepted();
    const empty = await client.request('venture.team.list', {});
    expect([empty.agents, empty.waitsForPlan]).toEqual([[], undefined]);
    await client.request('venture.agents.hire.team', { agents: [ASHA, KABIR] });
    const team = await client.request('venture.team.list', {});
    expect(team.agents.map((agent) => [agent.name, agent.kind, agent.posture, agent.department, agent.state, agent.chat])).toEqual([
      ['Asha', 'agent', 'approve-each', 'operations', 'idle', true], ['Kabir', 'agent', 'approve-each', 'operations', 'idle', true],
    ]);
    expect(team.waitsForPlan).toBe(TEAM_WAITS_FOR_PLAN);
    expect(team.teamHealth).toBeUndefined();
    expect(team.departments!.find((department) => department.id === 'operations')!.counts).toEqual({ working: 0, waiting: 0, stopped: 0, idle: 2 });
    expect(team.introduce!.map((item) => item.agentId)).toEqual(team.agents.map((agent) => agent.id));
    // Each opens and has its thread; the first message still waits for the chat consent when an AI is connected.
    const thread = await client.request('venture.agents.thread.list', { agent: team.agents[0]!.id });
    expect(thread.agent.name).toBe('Asha');
  });

  it('a hired agent has its AI line: the tier every chat uses, as models/roles.ts lists it', async () => {
    const { client } = await unaccepted();
    await client.request('venture.agents.hire.team', { agents: [ASHA] });
    const id = (await hired(client))[0]!.id;
    const roles = await client.request('venture.models.roles', {});
    expect(roles.roles).toEqual([{ agent: id, name: 'Asha', tiers: [{ tier: 'main', presetId: 'built-in-templates', model: null, price: 'Free. Nothing is sent to any AI.', usable: false }] }]);
  });

  it('the month\'s spend says the owner\'s own AI plan when nothing is priced, as views/team-series.ts', async () => {
    const { client } = await unaccepted();
    await client.request('venture.agents.hire.team', { agents: [ASHA] });
    const lead = async () => (await client.request('venture.team.list', {})).totals!.spendThisMonth.lead;
    // Nothing priced yet on a key: a figure, rupees first for a rupee business (the dated reference rate until the owner types one).
    expect(await lead()).toEqual({ currency: 'INR', figure: '₹0', beside: '$0.00 at ₹94.40 per $1', other: '$0.00' });
    const preset = (await client.request('venture.ai.options', {})).presets.find((row) => row.id === 'claude-code-cli')!;
    await client.request('venture.models.connect', { presetId: preset.id, consentDigest: preset.consentDigest, tiers: ['fast', 'main'] } as never);
    expect(await lead()).toEqual({ currency: 'USD', figure: 'On your own AI plan' });
  });

  it('once the plan is accepted Keeper joins and the line goes', async () => {
    const { engine, client } = await unaccepted();
    await client.request('venture.agents.hire.team', { agents: [ASHA] });
    for (const [questionId, answer] of [['q_1', { skipped: true }], ['q_pricing_model', { choiceId: 'project' }], ['q_price', { skipped: true }], ['q_tax', { yes: false }]] as const) await client.request('venture.interview.answer', { questionId, answer });
    const plan = await client.request('venture.blueprint.draft', { useTemplate: true });
    expect((await client.request('venture.team.list', {})).waitsForPlan).toBe(TEAM_WAITS_FOR_PLAN);
    await priceAndAcceptPlan(engine, plan, '100');
    const team = await client.request('venture.team.list', {});
    expect(team.waitsForPlan).toBeUndefined();
    expect(team.agents.map((agent) => agent.name)).toEqual(['Asha', 'Keeper']);
  });
});
