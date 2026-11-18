// The plan the owner reads and accepts is the plan they kept (founder, 14 Nov 2026). The first live run on a Mac opened a
// potter's plan and found the built-in "other" service type: "People and small businesses who need this service done
// well", a line about bookkeeping, "You do not charge GST" beside "Invoices are tax invoices", and neither the way to
// earn nor the team the owner had just kept. The plan sheet now leads with the kept way (who pays, how you reach them,
// what the team does, what you do, the first week) and lists the hired team; every business loses the bookkeeping
// sentence unless it is a bookkeeping business, and an unregistered business reads "plain invoices".
import test from 'node:test';
import assert from 'node:assert/strict';
import { planSections, shownStepNote, type PlanParts } from '../runtime/venture/views/plan-sections.ts';
import { STEP_PLAN } from '../runtime/venture/contracts.ts';
import { HIRE_WORDS } from '../runtime/venture/agents/hire.ts';
import { teamCardDigest } from '../runtime/venture/agents/team-proposal.ts';
import { listRecords } from '../runtime/venture/records.ts';
import { handlers as viewHandlers } from '../runtime/venture/views/index.ts';
import { agentBusiness } from './venture-agent-helpers.ts';
import { owner } from './venture-judge-helpers.ts';

const POTTER = 'I make pottery by hand, mostly mugs and bowls, and I want bulk orders from cafes in Pune.';
const WAY = {
  customer: 'Cafe owners in Pune who buy tableware in bulk.',
  reach: 'A list of cafes near Koregaon Park, then a first message you send to each one.',
  teamDoes: 'Drafts each message and quote, and keeps track of who replied.',
  youDo: 'Make up to about 200 pieces a month, set the prices and send each message.',
  firstWeek: ['Decide the designs and your price for each offer.', 'Approve the first list of cafes.', 'Send the first messages.'],
};
const TEAM = [
  { name: 'Mira', job: 'Keeps cafe leads in order.', duties: ['Lists cafe prospects', 'Tracks follow ups'], reads: ['clients', 'trackers'] },
  { name: 'Arun', job: 'Drafts sales materials for your approval.', duties: ['Drafts offer descriptions'], reads: ['plan', 'notes'] },
];
const words = (value: string) => ({ value });
const parts = (change: Partial<PlanParts> = {}): PlanParts => ({
  serviceType: 'other',
  customer: words('People and small businesses who need this service done well.'),
  offers: [{ name: words('Cafe mug sets'), description: words('Handmade mugs in bulk for cafes.'), price: null }],
  steps: STEP_PLAN.map((step, index) => ({ title: words(['Collect what the client sends', 'Do the hands-on work', 'Draft the reply for review', 'Send the work to the client'][index]!), doneBy: step.doneBy, note: step.note })),
  approvals: [words('Every reply before it reaches a client')],
  tax: { label: 'GST', registered: false, assumed: true, invoiceKind: 'tax-invoice', missing: [] },
  way: null, team: [],
  ...change,
});
const section = (sections: ReturnType<typeof planSections>, heading: string) => sections.find(item => item.heading === heading)?.lines;

test('with a kept way and team the plan leads with them, in the owner\'s own plan words', () => {
  const sections = planSections(parts({ way: WAY, team: TEAM }));
  assert.deepEqual(sections.map(item => item.heading), ['Who pays', 'What you sell', 'How you earn', 'First week', 'Your team', 'How each order is done', 'What you approve', 'Back office']);
  assert.deepEqual(section(sections, 'Who pays'), [WAY.customer]);
  assert.deepEqual(section(sections, 'How you earn'), [`How you reach them: ${WAY.reach}`, `Your team does: ${WAY.teamDoes}`, `You do: ${WAY.youDo}`]);
  assert.deepEqual(section(sections, 'First week'), WAY.firstWeek.map((step, index) => `${index + 1}. ${step}`));
  assert.deepEqual(section(sections, 'Your team'), [
    'Mira: Keeps cafe leads in order. Lists cafe prospects. Tracks follow ups.',
    'Arun: Drafts sales materials for your approval. Drafts offer descriptions.',
    HIRE_WORDS.teamNever, HIRE_WORDS.teamAsks,
  ]);
  // The generic line of the built-in plan is gone: who it is for is who pays.
  assert.ok(!JSON.stringify(sections).includes('People and small businesses who need this service done well.'));
  assert.doesNotMatch(JSON.stringify(sections), /—/);
});

test('a way with no team hired yet still shows; a plan with no way reads as it did', () => {
  const noTeam = planSections(parts({ way: WAY }));
  assert.deepEqual(noTeam.map(item => item.heading), ['Who pays', 'What you sell', 'How you earn', 'First week', 'How each order is done', 'What you approve', 'Back office']);
  const plain = planSections(parts());
  assert.deepEqual(plain.map(item => item.heading), ['Who it is for', 'What you sell', 'How the work is done', 'What you approve', 'Back office']);
  assert.deepEqual(section(plain, 'Who it is for'), ['People and small businesses who need this service done well.']);
  // A team with no way (agents hired by hand) is still the owner's team on the plan.
  assert.deepEqual(planSections(parts({ team: TEAM })).map(item => item.heading), ['Who it is for', 'What you sell', 'Your team', 'How the work is done', 'What you approve', 'Back office']);
});

test('the bookkeeping sentence is read only by a bookkeeping business', () => {
  const handsOn = STEP_PLAN.find(step => step.id === 'step_2')!.note;
  assert.match(handsOn, /For bookkeeping/);
  assert.equal(shownStepNote(handsOn, 'other'), 'You do the hands-on work.');
  assert.equal(shownStepNote(handsOn, 'studio'), 'You do the hands-on work.');
  assert.equal(shownStepNote(handsOn, 'bookkeeping'), handsOn);
  // Every other note is the engine's own, unchanged.
  for (const step of STEP_PLAN.filter(item => item.id !== 'step_2')) assert.equal(shownStepNote(step.note, 'other'), step.note);
  const studio = section(planSections(parts({ way: WAY, serviceType: 'studio' })), 'How each order is done')!;
  assert.equal(studio[1], 'Do the hands-on work: you. You do the hands-on work.');
  assert.ok(!studio.join(' ').includes('bookkeeping'));
  // A potter's plan (the plain service type) reads how an order is handled today, with no bookkeeping line either
  // (venture-about-winfix.test.ts).
  const potter = section(planSections(parts({ way: WAY })), 'How each order is done')!;
  assert.equal(potter[1], 'You do the work or make the goods yourself.');
  assert.ok(!potter.join(' ').includes('bookkeeping'));
  assert.match(section(planSections(parts({ serviceType: 'bookkeeping' })), 'How the work is done')![1]!, /For bookkeeping, an agent reconciles a month/);
});

test('tax and invoices never contradict: a business that does not charge the tax issues plain invoices', () => {
  assert.deepEqual(section(planSections(parts()), 'Back office'), ['You do not charge GST (Chausar assumed this; confirm it).', 'Invoices are plain invoices.']);
  assert.deepEqual(section(planSections(parts({ tax: { label: 'GST', registered: false, assumed: false, invoiceKind: 'tax-invoice', missing: [] } })), 'Back office'), ['You do not charge GST.', 'Invoices are plain invoices.']);
  assert.deepEqual(section(planSections(parts({ tax: { label: 'GST', registered: true, assumed: false, invoiceKind: 'tax-invoice', missing: ['Your GSTIN'] } })), 'Back office'),
    ['You charge GST.', 'Invoices are tax invoices.', 'Missing for a tax invoice: Your GSTIN.']);
  assert.deepEqual(section(planSections(parts({ tax: { label: 'Sales tax', registered: true, assumed: false, invoiceKind: 'invoice', missing: [] } })), 'Back office'), ['You charge Sales tax.', 'Invoices are plain invoices.']);
});

test('venture.queue.view: the plan a potter opens holds the way they kept and the team they hired', async () => {
  const env = await agentBusiness(POTTER);
  const view = (id: string) => (viewHandlers as any)['venture.queue.view'](env.deps, owner, { kind: 'plan', id }) as Promise<any>;
  const blueprint = listRecords(env.store.read(), 'venture-blueprint').at(-1)!;
  const before = await view(blueprint.id);
  assert.equal(before.kind, 'plan');
  assert.ok(before.sections.some((item: any) => item.heading === 'Who it is for'));
  assert.ok(!JSON.stringify(before.sections).includes('For bookkeeping'), 'no bookkeeping line on a potter\'s plan');
  await env.call('venture.owner.set', { way: WAY });
  await env.agents('venture.agents.hire.team', { agents: TEAM.map(agent => ({ ...agent, digest: teamCardDigest(agent as never) })) });
  const kept = await view(blueprint.id);
  assert.deepEqual(kept.sections.map((item: any) => item.heading).slice(0, 5), ['Who pays', 'What you sell', 'How you earn', 'First week', 'Your team']);
  assert.deepEqual(section(kept.sections, 'Who pays'), [WAY.customer]);
  assert.deepEqual(section(kept.sections, 'First week'), WAY.firstWeek.map((step, index) => `${index + 1}. ${step}`));
  assert.ok(section(kept.sections, 'Your team')!.includes('Mira: Keeps cafe leads in order. Lists cafe prospects. Tracks follow ups.'));
  // A retired agent leaves the plan's team.
  const mira = listRecords(env.store.read(), 'venture-agent-hire').find(record => record.role?.name === 'Mira')!;
  const check = await env.agents('venture.agents.retire.check', { agent: mira.id });
  await env.agents('venture.agents.retire', { agent: mira.id, to: 'owner', digest: check.digest });
  assert.ok(!JSON.stringify((await view(blueprint.id)).sections).includes('Mira:'));
});

test('venture.blueprint.get: the plan page reads the same kept plan, who pays and the team, and only once something is kept', async () => {
  // Found live, 15 Nov 2026: Business, Plan still said "People and small businesses who need this service done well"
  // for a potter who had kept a way that says who pays.
  const env = await agentBusiness(POTTER);
  const before = await env.call('venture.blueprint.get', {}) as any;
  assert.equal('kept' in before, false, 'nothing kept: the answer is as it always was');
  await env.call('venture.owner.set', { way: WAY });
  const way = await env.call('venture.blueprint.get', {}) as any;
  assert.deepEqual(way.kept, { way: WAY, team: [] });
  await env.agents('venture.agents.hire.team', { agents: TEAM.map(agent => ({ ...agent, digest: teamCardDigest(agent as never) })) });
  const kept = await env.call('venture.blueprint.get', {}) as any;
  assert.deepEqual(kept.kept, { way: WAY, team: TEAM.map(agent => ({ name: agent.name, job: agent.job, duties: agent.duties })) });
  // The record and its digest are untouched: the kept plan rides beside them.
  assert.deepEqual(kept.blueprint, before.blueprint);
  // A retired agent leaves the plan's team, as on the plan sheet.
  const mira = listRecords(env.store.read(), 'venture-agent-hire').find(record => record.role?.name === 'Mira')!;
  const check = await env.agents('venture.agents.retire.check', { agent: mira.id });
  await env.agents('venture.agents.retire', { agent: mira.id, to: 'owner', digest: check.digest });
  assert.deepEqual(((await env.call('venture.blueprint.get', {})) as any).kept.team.map((agent: any) => agent.name), ['Arun']);
});
