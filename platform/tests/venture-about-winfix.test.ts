// What three owners saw in the real app on Windows with a real AI (15 Nov 2026): a potter's business named "Service
// business" everywhere; every proposed agent in Operations; a second team joining on acceptance that the owner never
// saw, two of them doing the job two hired agents were given; an agent promised to make subtitles from video files it
// cannot open; a reply that said "I removed installation work" when none was in the plan, with the same unanswered
// question asked three times; a rename that left two subtitle offers; and "I also know Marathi" filed away and never
// offered. Each is held by code here, beside what the AI is told.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ABOUT_INSTRUCTIONS, aboutTask } from '../runtime/venture/core/about.ts';
import { aboutBefore, cardOffersKept } from '../runtime/venture/core/about-before.ts';
import { READY_LINE, askedTwice, followUpReply, nextQuestion, planChanges } from '../runtime/venture/core/about-reply.ts';
import { fallbackBusinessName, keptBusinessName, ownBusinessName } from '../runtime/venture/core/business-name.ts';
import { alsoOffered } from '../runtime/venture/core/own-offer.ts';
import { WAY_CAPABILITIES } from '../runtime/venture/core/way.ts';
import { DEPARTMENT_IDS, SERVICE_TYPE_LABELS } from '../runtime/venture/contracts.ts';
import { checkTeamHire } from '../runtime/venture/agents/hire-check.ts';
import { TEAM_DEPARTMENT, TEAM_DEPARTMENTS, TEAM_SCHEMA, checkedTeamAgent, departmentFor, keptTeamWith, teamCardDigest, teamCards } from '../runtime/venture/agents/team-proposal.ts';
import { DELIVERY_JOB, OWN_ORDER_JOB, fileWorkIn, orderWorkIn } from '../runtime/venture/agents/order-agents-core.ts';
import { orderAgentsFor } from '../runtime/venture/agents/order-agents.ts';
import { planSections, OWN_ORDER_LINES, ORDER_AGENT_JOINS, type PlanParts } from '../runtime/venture/views/plan-sections.ts';
import { assertSchemaSafe } from '../runtime/venture/models/schema.ts';
import { listRecords } from '../runtime/venture/records.ts';
import { handlers as viewHandlers } from '../runtime/venture/views/index.ts';
import { engineFor, connectPair } from './fixtures/venture/compose-unit/harness.ts';
import { anthropicEntry } from './fixtures/venture/compose-unit/plans.ts';
import { agentBusiness } from './venture-agent-helpers.ts';
import { owner } from './venture-judge-helpers.ts';

const POTTER = 'I make pottery by hand, mostly mugs and bowls, and I want bulk orders from cafes and hotels in Pune.';
const TECHNICIAN = 'I repair and service ACs and fridges in Lucknow. I want yearly maintenance contracts from offices and housing societies.';
const TRANSLATOR = 'I translate between Hindi and English and make subtitles for videos. I am in Bhopal and want steady work from YouTube creators and small production houses.';
const WAY = {
  customer: 'YouTube creators and small production houses pay for translation and subtitles.',
  reach: 'A list of creators you check, then a first message you send to each one.',
  teamDoes: 'Drafts each message and keeps track of leads and follow ups.',
  youDo: 'Set your own prices, check every draft and send every message.',
  firstWeek: ['Decide what each offer covers and your price for it.', 'Approve the first list of creators.'],
};
const TRANSLATOR_OFFERS = [
  { name: 'Hindi-English translation', line: 'Translate scripts and other creator materials between Hindi and English.', unit: 'project' as const },
  { name: 'Video subtitles', line: 'Create Hindi or English subtitles for videos.', unit: 'minute' as const },
];
// The team the AI proposed on Windows for the translator, word for word.
const MIRA = { name: 'Mira', job: 'Keeps translation work ready for your review.', duties: ['Prepares Hindi-English translation drafts from your files', 'Checks translation drafts against your notes'], reads: ['orders', 'notes'], department: 'production' };
const RAVI = { name: 'Ravi', job: 'Keeps subtitle work ready for your review.', duties: ['Prepares subtitle drafts from your video files', 'Checks subtitle drafts against your preferences'], reads: ['orders', 'notes'], department: 'production' };
const ASHA = { name: 'Asha', job: 'Keeps prospect follow up organized for you.', duties: ['Lists potential creator clients from public sources', 'Drafts outreach messages', 'Tracks lead follow ups'], reads: ['clients', 'trackers'], department: 'sales' };
const answer = (change: Record<string, unknown> = {}) => ({ familyId: 'writing', professionId: 'translator', offers: TRANSLATOR_OFFERS, countryCode: null, evidence: null, reply: 'Do you have sample work?', way: WAY, team: [ASHA], needs: [], name: 'Bhopal Translation and Subtitles', ...change });
const card = (agent: typeof ASHA) => ({ ...agent, digest: teamCardDigest(agent as never) });
const kept = (value: unknown, context?: Parameters<typeof keptTeamWith>[2]) => keptTeamWith(checkTeamHire, value, context);

// ---------------------------------------------------------------------------
// Item 2: the business name
// ---------------------------------------------------------------------------

test('when the AI gives no usable name, code builds a plain one from the owner\'s own words, never the template label', () => {
  assert.equal(fallbackBusinessName(POTTER, [{ name: 'Handmade mugs' }]), 'Pottery', 'the work the owner named');
  assert.equal(fallbackBusinessName('I want bulk orders from cafes and hotels in Pune for my studio.', [{ name: 'Handmade mugs' }, { name: 'Bulk pottery orders' }]), 'Handmade mugs', 'else the first offer');
  // Held to the same check as a name the AI proposes: a claim or a legal form is skipped, and nothing usable is no name.
  assert.equal(fallbackBusinessName('I want more work.', [{ name: 'Best mugs' }, { name: 'Cafe bowls' }]), 'Cafe bowls');
  assert.equal(fallbackBusinessName('I want more work.', [{ name: 'Best mugs' }]), null);
  assert.equal(fallbackBusinessName('I want more work.', []), null);
  // A plan's own label is no name: a window that sends it back as the card's name does not make it one.
  for (const label of Object.values(SERVICE_TYPE_LABELS)) assert.equal(ownBusinessName(label, Object.values(SERVICE_TYPE_LABELS)), null, label);
  assert.equal(ownBusinessName('  service   BUSINESS ', Object.values(SERVICE_TYPE_LABELS)), null);
  assert.equal(ownBusinessName('Pune Handmade Pottery', Object.values(SERVICE_TYPE_LABELS)), 'Pune Handmade Pottery');
  assert.equal(ownBusinessName('Best Pottery Pvt Ltd', Object.values(SERVICE_TYPE_LABELS)), null, 'still held to the name check');
});

test('about.read always names a business it found offers for: the AI\'s name, else the card\'s, else the owner\'s words', () => {
  const potter = (change: Record<string, unknown>) => ({ familyId: null, professionId: null, offers: [{ name: 'Handmade mugs', line: 'Hand-thrown mugs for cafes.', unit: 'piece' }], countryCode: null, evidence: null, reply: 'What styles do you make?', way: null, team: [], needs: [], ...change });
  const first = aboutTask({ text: POTTER, file: null });
  assert.equal(first.validate(potter({ name: 'Pune Handmade Pottery' })).name, 'Pune Handmade Pottery');
  // What may have happened on Windows: no name, or one the check refuses (seven words). Either way the read has a name.
  for (const unusable of [null, '', 'Pune Handmade Pottery for Cafes and Hotels', 'Best Pottery in Pune', 'Service business', 'Creative studio']) {
    assert.equal(first.validate(potter({ name: unusable })).name, 'Pottery', String(unusable));
  }
  // A follow-up: the card's name holds when the answer has none; a template label on the card is never returned.
  const before = (name: string | null) => aboutBefore({ turns: [{ from: 'owner', text: POTTER }], plan: { familyId: null, professionId: null, name, offers: [{ name: 'Handmade mugs', line: 'Hand-thrown mugs for cafes.', kept: true, yours: false }], way: null, team: [] } });
  const next = (name: string | null) => aboutTask({ text: 'I am in Koregaon Park.', file: null, before: before(name) });
  assert.equal(next('Pune Handmade Pottery').validate(potter({ name: null })).name, 'Pune Handmade Pottery');
  assert.equal(next('Service business').validate(potter({ name: 'Service business' })).name, 'Pottery', 'the label the old window sent back is not kept');
  assert.equal(next(null).validate(potter({ name: 'Koregaon Park Pottery' })).name, 'Koregaon Park Pottery');
  // The AI is not shown a template label as the plan's name either.
  assert.equal((next('Service business').input as any).before.plan.name, null);
  assert.equal((next('Pune Handmade Pottery').input as any).before.plan.name, 'Pune Handmade Pottery');
  assert.equal(keptBusinessName('Pottery'), 'Pottery');
});

test('about.read without an AI names work outside the listed fields from the owner\'s words, where it can', async t => {
  const { engine } = await engineFor(t);
  const read = await engine.request('venture.about.read', { text: POTTER }) as any;
  assert.equal(read.ownOffers, true);
  assert.equal(read.name, 'Pottery');
  const none = await engine.request('venture.about.read', { text: 'I want to help families plan weekend trips around Coorg.' }) as any;
  assert.equal(none.name, undefined, 'nothing to name it from: the owner types it');
});

// ---------------------------------------------------------------------------
// Item 3: departments
// ---------------------------------------------------------------------------

test('each proposed agent has a department from the engine\'s own list: the AI\'s when it is one, else code\'s from the duties', () => {
  assert.deepEqual([...TEAM_DEPARTMENTS], [...DEPARTMENT_IDS]);
  assert.equal(TEAM_DEPARTMENT, 'operations');
  const item = (TEAM_SCHEMA as any).items;
  assert.deepEqual(item.required, ['name', 'job', 'duties', 'reads', 'department']);
  assert.deepEqual(item.properties.department, { type: 'string', enum: [...DEPARTMENT_IDS] });
  assert.match(ABOUT_INSTRUCTIONS, /what each reads and its department/);
  const team = kept([ASHA, { ...ASHA, name: 'Dev', department: 'marketing' }, { ...ASHA, name: 'Tara', department: 'shipping' }]);
  assert.deepEqual(team.map(agent => agent.department), ['sales', 'marketing', 'sales'], 'an unknown department is worked out by code');
  const { department: _none, ...bare } = ASHA;
  assert.equal(kept([bare])[0]!.department, 'sales', 'so is a missing one');
  // The code fallback, from what the agent does: never Production (that is where the agents that do orders work).
  const role = (job: string, duties: string[], reads: string[] = []) => departmentFor({ job, duties, reads });
  assert.equal(role('Keeps the customer pipeline organized for you.', ['Lists cafe leads for you to review', 'Tracks follow ups', 'Tracks orders']), 'sales');
  assert.equal(role('Drafts sales materials for your approval.', ['Drafts offer descriptions', 'Drafts outreach messages']), 'sales');
  assert.equal(role('Keeps your content calendar.', ['Drafts social posts for your approval', 'Lists newsletter ideas']), 'marketing');
  assert.equal(role('Tracks orders and payments for you.', ['Tracks invoices for you', 'Flags due payments for you'], ['orders', 'money']), 'money');
  assert.equal(role('Keeps pottery orders organised for you.', ['Tracks pottery orders for you', 'Summarises order status for you']), 'operations');
  // The card's digest is of the words the owner reads, the department among them.
  assert.notEqual(teamCardDigest({ ...ASHA, department: 'sales' } as never), teamCardDigest({ ...ASHA, department: 'marketing' } as never));
  assert.deepEqual(team[0], card(ASHA));
  assert.throws(() => teamCards([{ ...card(ASHA), department: 'shipping' }]), { code: 'INVALID_VENTURE_REQUEST' });
  assert.throws(() => teamCards([{ ...card(ASHA), department: 'marketing' }]), { code: 'APPROVAL_STALE' }, 'a department changed after the digest is not the card the owner read');
});

test('hiring the team stores each agent in the department on its card, so Team shows it there', async () => {
  const env = await agentBusiness();
  const dev = { ...ASHA, name: 'Dev', job: 'Keeps your content calendar.', duties: ['Drafts social posts for your approval'], reads: ['plan'], department: 'marketing' };
  const answered = await env.agents('venture.agents.hire.team', { agents: [card(ASHA), card(dev)] });
  assert.deepEqual(answered.hired.map((view: any) => [view.role.name, view.department]), [['Asha', 'sales'], ['Dev', 'marketing']]);
  const team = await (viewHandlers as any)['venture.team.list'](env.deps, owner, {});
  for (const record of listRecords(env.store.read(), 'venture-agent-hire').filter(item => item.status === 'hired')) {
    assert.equal(team.agents.find((agent: any) => agent.id === record.id).department, record.department);
  }
  assert.ok(team.agents.filter((agent: any) => agent.department === 'sales').some((agent: any) => agent.name === 'Asha'), 'Asha is listed under Sales and clients');
  assert.ok(team.agents.filter((agent: any) => agent.department === 'marketing').some((agent: any) => agent.name === 'Dev'));
  assert.ok(!team.agents.filter((agent: any) => agent.department === 'operations').some((agent: any) => ['Asha', 'Dev'].includes(agent.name)));
  // A card made before departments (no department on it) is still hired, where it used to be.
  const { department: _none, ...old } = { ...ASHA, name: 'Kabir' };
  const before = await env.agents('venture.agents.hire.team', { agents: [{ ...old, digest: teamCardDigest(old as never) }] });
  assert.equal(before.hired[0].department, 'operations');
});

// ---------------------------------------------------------------------------
// Item 4: one team
// ---------------------------------------------------------------------------

test('code knows which agents will do each order for an owner\'s words: the playbook\'s own, else the one delivery agent', () => {
  const translator = orderAgentsFor(TRANSLATOR);
  assert.deepEqual(translator.agents.map(agent => agent.name), ['Translator', 'Checker']);
  assert.equal(translator.agents[0]!.does, 'Drafts each source block with the locked glossary.');
  assert.equal(translator.flagship, true);
  assert.deepEqual(orderAgentsFor(TECHNICIAN), { agents: [{ name: 'Bookings agent', does: DELIVERY_JOB }], flagship: false });
  // No order flow fits a maker of goods: the one agent drafts the reply to each order, and is said to do no more.
  assert.deepEqual(orderAgentsFor(POTTER), { agents: [{ name: 'Delivery agent', does: OWN_ORDER_JOB }], flagship: false });
  assert.equal(OWN_ORDER_JOB, 'Drafts the reply to each order for you to check.');
});

test('the AI is told who already does each order, and to propose agents only for the rest', () => {
  const task = aboutTask({ text: TRANSLATOR, file: null });
  assert.deepEqual((task.input as any).orderAgents, orderAgentsFor(TRANSLATOR).agents);
  assert.match(ABOUT_INSTRUCTIONS, /orderAgents do each order once the plan is accepted: give no agent their work/);
  assert.match(ABOUT_INSTRUCTIONS, /finding and tracking customers, follow ups, sales materials, lists/);
  assert.doesNotThrow(() => assertSchemaSafe(task.schema));
  // A file sent alone has no words to tell from yet: nothing is supplied, and code checks the answer afterwards.
  assert.equal((aboutTask({ text: '', file: { name: 'cv.pdf', text: 'Translator.' } as never }).input as any).orderAgents, undefined);
});

test('a proposed agent whose work is the order work of the playbook\'s own agents is dropped; the rest stay', () => {
  const order = { offers: TRANSLATOR_OFFERS, orderAgents: orderAgentsFor(TRANSLATOR) };
  assert.deepEqual(kept([MIRA, RAVI, ASHA], order).map(agent => agent.name), ['Asha'], 'the two that duplicated the Translator and the Checker are gone');
  // The rule, line by line: making or checking the thing sold is order work; sales and admin work never is.
  const words = { offers: TRANSLATOR_OFFERS.map(offer => offer.name), roles: ['Translator', 'Checker'] };
  for (const line of ['Prepares Hindi-English translation drafts for you', 'Checks translation drafts against your notes', 'Prepares subtitle drafts', 'Drafts subtitles for each video', 'Checks subtitle timing', 'Prepares translation and subtitle drafts']) assert.equal(orderWorkIn(line, words), true, line);
  for (const line of ['Drafts outreach messages', 'Lists potential creator clients from public sources', 'Tracks lead follow ups', 'Drafts translation service descriptions', 'Prepares a subtitle quote for each enquiry', 'Tracks translation orders', 'Keeps prospect follow up organized for you.', 'Flags due follow ups', 'Drafts a proposal for subtitle work']) assert.equal(orderWorkIn(line, words), false, line);
  // One duty of order work beside real team work: the duty goes and the agent stays.
  const mixed = kept([{ ...ASHA, duties: [...ASHA.duties, 'Checks subtitle drafts against your notes'] }], order);
  assert.deepEqual(mixed[0]!.duties, ASHA.duties);
  // Without a playbook's own agents (the one delivery agent of the fixed steps) nothing is dropped by this rule.
  assert.deepEqual(kept([ASHA, { ...MIRA, duties: ['Checks translation drafts against your notes'] }], { offers: TRANSLATOR_OFFERS, orderAgents: orderAgentsFor(TECHNICIAN) }).map(agent => agent.name), ['Asha', 'Mira']);
});

test('about.read shows the agents that will do each order beside the proposed team, as one team', async t => {
  const { engine } = await engineFor(t, { responses: [anthropicEntry('decide', answer({ team: [MIRA, RAVI, ASHA] }), [TRANSLATOR, 'orderAgents']), anthropicEntry('decide', answer({ way: { customer: '', reach: '', teamDoes: '', youDo: '', firstWeek: [] } }), [TRANSLATOR])] });
  await connectPair(engine);
  const read = await engine.request('venture.about.read', { text: TRANSLATOR }) as any;
  assert.deepEqual(read.team.map((agent: any) => [agent.name, agent.department]), [['Asha', 'sales']]);
  assert.deepEqual(read.orderAgents, orderAgentsFor(TRANSLATOR).agents);
  // Only beside a way, as the team is.
  const bare = await engine.request('venture.about.read', { text: TRANSLATOR }) as any;
  assert.equal(bare.way, undefined);
  assert.equal(bare.orderAgents, undefined);
});

// ---------------------------------------------------------------------------
// Item 5: duties an agent can really do
// ---------------------------------------------------------------------------

test('a proposed duty never promises work on audio, video, images or files: a hired agent reads only its listed records', () => {
  for (const line of ['Prepares subtitle drafts from your video files', 'Prepares Hindi-English translation drafts from your files', 'Transcribes your recordings', 'Edits product photos for your listings', 'Checks drafts against the uploaded documents from clients', 'Drafts captions from your audio']) assert.equal(fileWorkIn(line), true, line);
  for (const line of ['Lists potential creator clients from public sources', 'Drafts outreach messages', 'Checks contract details against your notes', 'Lists video ideas for your approval', 'Tracks photo shoot bookings', 'Flags unclear source text', 'Prepares proposal drafts for you', 'Drafts a quote from your notes']) assert.equal(fileWorkIn(line), false, line);
  // The duty is taken out and the agent stays; an agent whose job is such work, or with no duty left, is dropped.
  const team = kept([{ ...ASHA, duties: ['Drafts outreach messages', 'Prepares subtitle drafts from your video files'] }, { ...RAVI, name: 'Ravi' }, { ...ASHA, name: 'Tara', job: 'Transcribes your recordings.' }]);
  assert.deepEqual(team.map(agent => [agent.name, agent.duties]), [['Asha', ['Drafts outreach messages']], ['Ravi', ['Checks subtitle drafts against your preferences']]]);
  assert.match(ABOUT_INSTRUCTIONS, /An agent works only from records, notes and text the owner gives it: no duty on audio, video, images or files\./);
  // What the team can do, as the AI is given it, promises no such work either.
  assert.ok(!WAY_CAPABILITIES.some(line => /from the owner files/.test(line)));
  assert.ok(WAY_CAPABILITIES.some(line => /Audio, video and images need a tool the owner sets up first/.test(line)));
  // The hire itself holds a card to the same rule.
  assert.throws(() => checkedTeamAgent(checkTeamHire, { ...ASHA, duties: ['Prepares subtitle drafts from your video files'] }, []), { code: 'INVALID_VENTURE_REQUEST', message: 'An agent on your team works from your records, notes and text: it has no duty on audio, video, images or files.' });
});

// ---------------------------------------------------------------------------
// Item 6: the reply says only what changed, and never asks a third time
// ---------------------------------------------------------------------------

const TECH_WAY = {
  customer: 'Offices and housing societies pay for yearly maintenance; homes pay for repairs.',
  reach: 'Find offices and housing societies in Lucknow through public sources.',
  teamDoes: 'Draft service descriptions and proposals for your approval.',
  youDo: 'Choose the services and your own prices. Do the repairs and servicing.',
  firstWeek: ['Prepare the repair and maintenance offers with your own prices.'],
};
const TECH_OFFERS = [{ name: 'AC repair and servicing', line: 'Repairs for homes and businesses.', unit: 'visit' as const }, { name: 'Yearly maintenance contracts', line: 'Planned maintenance for offices.', unit: 'year' as const }];
const QUESTION = 'How often would you like to visit each customer under a yearly contract?';
const techBefore = (turns: { from: string; text: string }[]) => aboutBefore({ turns, plan: { familyId: 'local-services', professionId: null, name: 'Lucknow AC and Fridge Service', offers: TECH_OFFERS.map(offer => ({ ...offer, kept: true, yours: false })), way: TECH_WAY, team: [] } });

test('what changed is worked out by code from the card before and the answer after, never taken from the AI\'s word', () => {
  const plan = techBefore([{ from: 'owner', text: TECHNICIAN }]).plan;
  const same = { offers: TECH_OFFERS, way: TECH_WAY, team: [] };
  assert.deepEqual(planChanges(plan, same), ['I did not change the plan.']);
  // The Windows case: only one sentence was added to what the owner does.
  const noInstall = { ...same, way: { ...TECH_WAY, youDo: `${TECH_WAY.youDo} Do not do installation work.` } };
  assert.deepEqual(planChanges(plan, noInstall), ['I added to what you do: Do not do installation work.']);
  // A part rewritten in place is named, not quoted.
  assert.deepEqual(planChanges(plan, { ...same, way: { ...TECH_WAY, customer: 'Offices pay for yearly maintenance.', reach: 'Find offices in Lucknow.' } }), ['I updated who pays and how you reach them.']);
  // Offers: a rename, a new one, one taken out, a line and a unit.
  assert.deepEqual(planChanges(plan, { ...same, offers: [{ ...TECH_OFFERS[0]!, name: 'AC servicing' }, TECH_OFFERS[1]!] }), ['I renamed AC repair and servicing to AC servicing.']);
  assert.deepEqual(planChanges(plan, { ...same, offers: [...TECH_OFFERS, { name: 'Fridge repair', line: 'Repairs for fridges.', unit: 'visit' as const }] }), ['I added the offer Fridge repair.']);
  assert.deepEqual(planChanges(plan, { ...same, offers: [TECH_OFFERS[1]!] }), ['I took out AC repair and servicing.']);
  // Renamed and moved: gone from its place, and a new offer that names the same thing stands elsewhere (seen live).
  assert.deepEqual(planChanges(plan, { ...same, offers: [{ ...TECH_OFFERS[1]!, name: 'Maintenance plans for offices' }, TECH_OFFERS[0]!] }), ['I renamed Yearly maintenance contracts to Maintenance plans for offices.']);
  assert.deepEqual(planChanges(plan, { ...same, offers: [{ ...TECH_OFFERS[0]!, line: 'Repairs for homes.' }, { ...TECH_OFFERS[1]!, unit: 'month' as const }] }), ['I changed the line under AC repair and servicing.', 'Yearly maintenance contracts is now charged per month.']);
  // The team.
  const withTeam = { ...plan, team: [{ ...ASHA, left: false }] } as never;
  assert.deepEqual(planChanges(withTeam, { ...same, team: [{ ...ASHA, duties: ['Tracks lead follow ups'] }, { ...ASHA, name: 'Dev' }] }), ['I changed what Asha does.', 'I added Dev to the team.']);
  const two = { ...plan, team: [{ ...ASHA, left: false }, { ...ASHA, name: 'Mira', left: false }] } as never;
  assert.deepEqual(planChanges(two, { ...same, team: [{ ...ASHA, duties: ['Tracks lead follow ups'] }, { ...ASHA, name: 'Mira', job: 'Lists buyers for you.' }] }), ['I changed what Asha and Mira do.']);
  assert.deepEqual(planChanges(withTeam, same), ['I took Asha off the team.']);
});

test('a follow-up reply is what really changed, then the AI\'s question; a false claim never reaches the owner', () => {
  const before = techBefore([{ from: 'owner', text: TECHNICIAN }, { from: 'you', text: `I understood your work. ${QUESTION}` }]);
  const after = { offers: TECH_OFFERS, way: { ...TECH_WAY, youDo: `${TECH_WAY.youDo} Do not do installation work.` }, team: [] };
  const claimed = 'I removed installation work from the plan and kept the repair, servicing and maintenance offers. What does a yearly contract include?';
  assert.equal(followUpReply({ before, said: 'I do not do installation work.', after, reply: claimed }), 'I added to what you do: Do not do installation work. What does a yearly contract include?');
  assert.equal(nextQuestion(claimed), 'What does a yearly contract include?');
  assert.equal(nextQuestion('I added one helper; how often would you like to visit each customer?'), 'How often would you like to visit each customer?');
  assert.equal(nextQuestion('The plan looks ready to keep.'), null);
  assert.equal(nextQuestion(null), null);
  // No question: the plan looks ready.
  assert.equal(followUpReply({ before, said: 'I do not do installation work.', after, reply: 'I noted that.' }), `I added to what you do: Do not do installation work. ${READY_LINE}`);
  assert.equal(READY_LINE, 'The plan looks ready to keep.');
  assert.match(ABOUT_INSTRUCTIONS, /As reply write only your next most useful question/);
  assert.match(ABOUT_INSTRUCTIONS, /never one before\.turns shows you asked twice/);
  assert.doesNotMatch(ABOUT_INSTRUCTIONS, /say in one sentence what you changed/);
});

test('a question the owner did not answer is not asked a third time', () => {
  const once = [{ from: 'owner', text: TECHNICIAN }, { from: 'you', text: `I understood your work. ${QUESTION}` }];
  const twice = [...once, { from: 'owner', text: 'I have one helper.' }, { from: 'you', text: `I added your helper. ${QUESTION}` }];
  assert.equal(askedTwice(techBefore(once).turns, QUESTION), false);
  assert.equal(askedTwice(techBefore(twice).turns, QUESTION), true);
  // The same question in other words is the same question; another question is not.
  assert.equal(askedTwice(techBefore(twice).turns, 'How often do you want to visit each customer on a yearly contract?'), true);
  assert.equal(askedTwice(techBefore(twice).turns, 'Which areas of Lucknow do you cover?'), false);
  const after = { offers: TECH_OFFERS, way: TECH_WAY, team: [] };
  assert.equal(followUpReply({ before: techBefore(twice), said: 'I do not do installation work.', after, reply: QUESTION }), `I did not change the plan. ${READY_LINE}`);
  assert.equal(followUpReply({ before: techBefore(once), said: 'I have one helper.', after, reply: QUESTION }), `I did not change the plan. ${QUESTION}`);
  // Once the owner answered in between, the count starts again only for a question asked twice running.
  const answered = [...once, { from: 'owner', text: 'Twice a year.' }, { from: 'you', text: 'I added two visits a year. Which areas of Lucknow do you cover?' }];
  assert.equal(askedTwice(techBefore(answered).turns, QUESTION), false);
});

test('about.read: the follow-up reply the owner reads is built from the real difference', async t => {
  const turns = [{ from: 'owner', text: TECHNICIAN }, { from: 'you', text: `I understood your work. ${QUESTION}` }, { from: 'owner', text: 'I have one helper.' }, { from: 'you', text: `I added your helper. ${QUESTION}` }];
  const reply = `I removed installation work from the plan and kept the repair, servicing and maintenance offers. ${QUESTION}`;
  const told = { familyId: 'local-services', professionId: null, offers: TECH_OFFERS, countryCode: null, evidence: null, reply, way: { ...TECH_WAY, youDo: `${TECH_WAY.youDo} Do not do installation work.` }, team: [], needs: [], name: 'Lucknow AC and Fridge Service' };
  const { engine } = await engineFor(t, { responses: [anthropicEntry('decide', told, ['I do not do installation work.'])] });
  await connectPair(engine);
  const read = await engine.request('venture.about.read', { text: 'I do not do installation work.', before: { turns, plan: { familyId: 'local-services', professionId: null, name: 'Lucknow AC and Fridge Service', offers: TECH_OFFERS.map(offer => ({ ...offer, kept: true, yours: false })), way: TECH_WAY, team: [] } } }) as any;
  assert.equal(read.reply, `I added to what you do: Do not do installation work. ${READY_LINE}`);
  assert.ok(!read.reply.includes('removed installation'));
});

// ---------------------------------------------------------------------------
// Item 7: a rename that changes what an offer is, and a new skill
// ---------------------------------------------------------------------------

test('a rename that changes what an offer is does not keep the old line, and a clash with another offer is asked about', () => {
  const before = aboutBefore({ turns: [{ from: 'owner', text: TRANSLATOR }], plan: { familyId: 'writing', professionId: 'translator', name: 'Bhopal Translation and Subtitles', offers: TRANSLATOR_OFFERS.map(offer => ({ ...offer, kept: true, yours: false })), way: WAY, team: [] } });
  const said = 'Call the first offer Subtitles for creators.';
  // What the Windows build kept: the new name over the translation line.
  const wrote = [{ ...TRANSLATOR_OFFERS[0]!, name: 'Subtitles for creators' }, TRANSLATOR_OFFERS[1]!];
  const held = cardOffersKept(before, said, wrote);
  assert.deepEqual(held.map(offer => [offer.name, offer.line]), [['Subtitles for creators', ''], ['Video subtitles', 'Create Hindi or English subtitles for videos.']], 'a line about translation is not left under a subtitles name');
  // A line the AI wrote for the new name stands, and so does the old line under a name that still means the same thing.
  assert.equal(cardOffersKept(before, said, [{ ...wrote[0]!, line: 'Subtitles made for creators.' }, wrote[1]!])[0]!.line, 'Subtitles made for creators.');
  assert.equal(cardOffersKept(before, 'Call the first offer Translation for creators.', [{ ...TRANSLATOR_OFFERS[0]!, name: 'Translation for creators' }, TRANSLATOR_OFFERS[1]!])[0]!.line, TRANSLATOR_OFFERS[0]!.line);
  // Two offers now sound like one: the reply says so and asks which to keep, whatever the AI asked.
  const reply = followUpReply({ before, said, after: { offers: held, way: WAY, team: [] }, reply: 'I renamed the first offer. Do you have sample work?' });
  assert.equal(reply, 'I renamed Hindi-English translation to Subtitles for creators. "Subtitles for creators" and "Video subtitles" now sound like one offer. Which one do you want to keep?');
  // A rename that clashes with nothing keeps the AI's own question.
  const mugs = aboutBefore({ turns: [{ from: 'owner', text: POTTER }], plan: { familyId: null, professionId: null, name: 'Pottery', offers: [{ name: 'Handmade mugs', line: 'Mugs for cafes.', kept: true, yours: false }, { name: 'Handmade bowls', line: 'Bowls for cafes.', kept: true, yours: false }], way: null, team: [] } });
  assert.equal(followUpReply({ before: mugs, said: 'Call the first offer Cafe mug sets.', after: { offers: [{ name: 'Cafe mug sets', line: 'Mug sets for cafes.' }, { name: 'Handmade bowls', line: 'Bowls for cafes.' }], way: null, team: [] }, reply: 'What glazes do you offer?' }),
    'I renamed Handmade mugs to Cafe mug sets. What glazes do you offer?');
  assert.match(ABOUT_INSTRUCTIONS, /When the message renames an offer, write its line for the new name/);
});

test('a skill, language or product the owner adds is offered or asked about, never only filed away', () => {
  assert.equal(alsoOffered('I also know Marathi, and I can work on about forty minutes of video a day.'), 'Marathi');
  assert.equal(alsoOffered('We also make planters for balconies.'), 'planters');
  assert.equal(alsoOffered('I can also do wedding shoots'), 'wedding shoots');
  for (const none of ['I can make about 200 pieces a month and I am in Koregaon Park.', 'I also want more clients.', 'I also know that it takes time.', 'I do not do installation work.', 'I also make sure every client is happy.']) assert.equal(alsoOffered(none), null, none);
  const before = aboutBefore({ turns: [{ from: 'owner', text: TRANSLATOR }], plan: { familyId: 'writing', professionId: 'translator', name: 'Bhopal Translation and Subtitles', offers: TRANSLATOR_OFFERS.map(offer => ({ ...offer, kept: true, yours: false })), way: WAY, team: [] } });
  const said = 'I also know Marathi, and I can work on about forty minutes of video a day.';
  const filed = { offers: TRANSLATOR_OFFERS, way: { ...WAY, youDo: `${WAY.youDo} You know Marathi.` }, team: [] };
  // What Windows showed: noted under "You do", the plan "ready to keep". Code asks.
  assert.equal(followUpReply({ before, said, after: filed, reply: 'The plan looks ready to keep.' }), 'I added to what you do: You know Marathi. Do you want to offer Marathi too?');
  // The AI asked about it itself, or put it in an offer: its own words stand.
  assert.equal(followUpReply({ before, said, after: filed, reply: 'Which language pairs involving Marathi do you translate between?' }), 'I added to what you do: You know Marathi. Which language pairs involving Marathi do you translate between?');
  const offered = { ...filed, offers: [TRANSLATOR_OFFERS[0]!, TRANSLATOR_OFFERS[1]!, { name: 'Marathi translation', line: 'Translate between Marathi and Hindi or English.', unit: 'project' as const }] };
  assert.equal(followUpReply({ before, said, after: offered, reply: 'Do you have sample work?' }), 'I added the offer Marathi translation. I added to what you do: You know Marathi. Do you have sample work?');
  assert.match(ABOUT_INSTRUCTIONS, /When it adds a skill, language or product, add an offer for it where it fits or ask whether to offer it/);
});

// ---------------------------------------------------------------------------
// The plan sheet (finding P2-6): how an order is done, in words that are true for the business
// ---------------------------------------------------------------------------

const PARTS: PlanParts = {
  serviceType: 'other',
  customer: { value: 'People and small businesses who need this service done well.' },
  offers: [{ name: { value: 'Cafe mug sets' }, description: { value: 'Handmade mugs for cafes.' }, price: null }],
  steps: [
    { title: { value: 'Collect what the client sends' }, doneBy: 'you', note: 'You collect what the client sends and add the files to the order, where the agent reads them. Reading inboxes for you is planned.' },
    { title: { value: 'Do the hands-on work' }, doneBy: 'you', note: 'You do the hands-on work. For bookkeeping, an agent reconciles a month from the files you add, for you to check; other hands-on work is planned.' },
    { title: { value: 'Draft the reply for review' }, doneBy: 'agent-then-you', note: "An agent drafts a reply from the client's message. You check it." },
    { title: { value: 'Send the work to the client' }, doneBy: 'you', note: 'You send it to the client. Sending for you is planned.' },
  ],
  approvals: [{ value: 'Every reply before it reaches a client' }],
  tax: { label: 'GST', registered: false, assumed: true, invoiceKind: 'tax-invoice', missing: [] },
  way: { customer: 'Cafes in Pune.', reach: 'A list you check.', teamDoes: 'Drafts messages.', youDo: 'Make the pottery.', firstWeek: ['Set your prices.'] },
  team: [{ name: 'Mira', job: 'Keeps the customer pipeline organized for you.', duties: ['Tracks follow ups'] }],
};
const lines = (parts: PlanParts, heading: string) => planSections(parts).find(section => section.heading === heading)?.lines;

test('the plan of a business no order flow fits says in plain words how an order is handled today', () => {
  const order = lines(PARTS, 'How each order is done')!;
  assert.deepEqual(order, [...OWN_ORDER_LINES]);
  assert.deepEqual([...OWN_ORDER_LINES], [
    'You record each order: who it is for and what they asked for.',
    'You do the work or make the goods yourself.',
    'An agent drafts the reply to the customer from the order, and you check it.',
    'You send the reply and deliver the order yourself.',
  ]);
  assert.ok(!order.join(' ').includes('files'), 'a maker of goods ships pieces, not files');
  // A trade with its own steps keeps them; where the client sends a request and no files, the note says so.
  const visits = lines({ ...PARTS, serviceType: 'local-services', steps: [{ ...PARTS.steps[0]!, title: { value: 'Collect the booking request and the address' } }, ...PARTS.steps.slice(1)] }, 'How each order is done')!;
  assert.equal(visits[0], 'Collect the booking request and the address: you. You add what the client asked for to the order, where the agent reads it. Reading inboxes for you is planned.');
  // A file trade reads as it did.
  assert.match(lines({ ...PARTS, serviceType: 'bookkeeping' }, 'How each order is done')![0]!, /add the files to the order/);
});

test('the plan lists the agents that do each order with the team, said to join when the plan is accepted', () => {
  const agents = [{ name: 'Translator', does: 'Drafts each source block with the locked glossary.' }, { name: 'Checker', does: 'Reads meaning and flags uncertainty without changing the source.' }];
  const team = lines({ ...PARTS, orderAgents: { agents, joined: false } }, 'Your team')!;
  assert.deepEqual(team.slice(0, 3), ['Mira: Keeps the customer pipeline organized for you. Tracks follow ups.', `Translator: Drafts each source block with the locked glossary. ${ORDER_AGENT_JOINS}`, `Checker: Reads meaning and flags uncertainty without changing the source. ${ORDER_AGENT_JOINS}`]);
  assert.equal(ORDER_AGENT_JOINS, 'Joins when you accept this plan.');
  // Once the plan is accepted they are on the team: no such words.
  assert.equal(lines({ ...PARTS, orderAgents: { agents, joined: true } }, 'Your team')![1], 'Translator: Drafts each source block with the locked glossary.');
  // With no hired agent the section still shows who does each order.
  assert.deepEqual(lines({ ...PARTS, team: [], orderAgents: { agents: [agents[0]!], joined: false } }, 'Your team')!.slice(0, 1), [`Translator: Drafts each source block with the locked glossary. ${ORDER_AGENT_JOINS}`]);
  assert.equal(lines({ ...PARTS, team: [] }, 'Your team'), undefined);
});
