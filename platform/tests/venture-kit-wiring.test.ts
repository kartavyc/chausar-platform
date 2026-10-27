// The playbook kit wired into the shared playbook functions (Ink v2 wave 5, package 5A1, tests 2 and 3). A kit
// definition is a folder of data plus checks; the kit adapts it into the shapes the three hand-written flagships already
// use (FlagshipPlan, FlagshipDelivery, FlagshipCheckInput), so a new business needs no edit to the shared files. Each
// function takes the definitions as an optional last parameter (default: the landed ones); these tests pass the
// test-only kit-fixture through it. Coverage is a fraction: a check that did not run is never a pass.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Deliverable, PlaybookPatch } from '../runtime/venture/contracts.ts';
import { listRecords, ventureAction } from '../runtime/venture/records.ts';
import { freeze } from '../runtime/venture/delivery/improve.ts';
import { businessScenarios } from '../runtime/venture/delivery/scenarios.ts';
import { PLAYBOOK_REGISTRY, pickPlaybook } from '../runtime/venture/playbooks/registry.ts';
import { flagshipPlanById } from '../runtime/venture/playbooks/plan.ts';
import { flagshipDelivery } from '../runtime/venture/playbooks/steps.ts';
import { offerIntakeAsk, orderIntake } from '../runtime/venture/playbooks/intake.ts';
import { flagshipJudgeRules, runFlagshipChecks, type FlagshipCheckInput } from '../runtime/venture/playbooks/draft-checks.ts';
import { validatePlaybook } from '../runtime/venture/delivery/playbook.ts';
import { DEFAULT_LIMITS } from '../runtime/venture/delivery/harness/loop.ts';
import { applyPatch, toolCeiling } from '../runtime/venture/delivery/harness/patches.ts';
import { definePlaybook } from '../runtime/venture/playbooks/kit/define.ts';
import { runKitBaseline, type KitBaselineFile } from '../runtime/venture/playbooks/kit/baseline.ts';
import { runKitChecks } from '../runtime/venture/playbooks/kit/checks.ts';
import { KIT_FIXTURE_CASES, brandNamed, fixtureHi, kitFixture, noGuarantee, otherFixture } from './fixtures/venture/kit-fixture.ts';
import { approveWaiting, draft as kitDraft, installKitFixture, kitBusiness } from './fixtures/venture/kit-business.ts';

const code = (expected: string, words?: RegExp) => (error: any) => { assert.equal(error?.code, expected, error?.message); if (words) assert.match(error.message, words); return true; };
const FIXTURE = definePlaybook(kitFixture(), fixtureHi(kitFixture()));
const OTHER = definePlaybook(otherFixture(), fixtureHi(otherFixture()));
const DEFINITIONS = [FIXTURE, OTHER];
const META = { by: 'owner', at: '2026-10-27T10:00:00.000Z', today: '2026-10-27', host: 'test' as const };

const draft = (lines: string[]): Deliverable => ({
  title: 'Voice sheet', questionsForClient: [], sections: [{ heading: 'Voice sheet', parts: lines.map(text => ({ kind: 'text' as const, text, ref: '' as const })) }],
}) as unknown as Deliverable;
const checkInput = (deliverable: Deliverable, fields: Record<string, unknown> | null): FlagshipCheckInput => ({
  flagship: 'kit-fixture', offerKey: 'voice-pack', servedBy: 'model', deliverable, request: 'A voice sheet for Sunrise Bakery.',
  intake: fields ? { rights: null, format: 'long', aiVoice: false, aiPresenter: false, paidPromotion: false, cutFile: null, fields: fields as never } : null,
  files: [], receipts: [], known: [], mode: 'client', today: '2026-10-27', dateOrder: 'day-month-year',
});

test('pickPlaybook picks the kit playbook from its phrase', () => {
  assert.equal(pickPlaybook('I want to run a kit fixture studio for shops', [...PLAYBOOK_REGISTRY, FIXTURE.registration])?.id, 'kit-fixture');
  assert.equal(pickPlaybook('I want to run a kit fixture studio for shops'), null, 'not registered: no pick');
});

test('flagshipPlanById gives the plan words: label, summary, offers with their pricing, approvals and connectors', () => {
  const plan = flagshipPlanById('kit-fixture', DEFINITIONS)!;
  assert.equal(plan.label, 'Kit fixture studio');
  assert.equal(plan.serviceType, 'consulting');
  assert.equal(plan.oneLiner, FIXTURE.registration.summary);
  assert.deepEqual(plan.offers.map(offer => [offer.key, offer.name, offer.model, offer.block]), [
    ['voice-pack', 'Voice and calendar pack', 'monthly', 'retainer'], ['audit', 'Account audit', 'project', 'one-off-project'],
  ]);
  assert.deepEqual(plan.approvals, [{ key: 'owner-approves', words: 'You approve every draft before it goes to the client.', block: 'each-draft' }]);
  assert.deepEqual(plan.connectors, ['mail-app']);
  assert.equal(flagshipPlanById('kit-fixture'), null, 'not landed: no plan');
  assert.equal(flagshipPlanById('youtube')?.label, 'YouTube channel', 'the flagships keep their own');
});

test('flagshipDelivery gives the steps, roles, roleOf, floor and draft step; validatePlaybook accepts the steps', () => {
  const delivery = flagshipDelivery('kit-fixture', DEFINITIONS)!;
  assert.deepEqual(delivery.steps.map(step => step.id), ['gather', 'voice', 'calendar', 'drafts', 'approve']);
  assert.ok(delivery.steps.every(step => !('role' in step) && !('produces' in step)), 'engine steps carry no kit fields');
  assert.deepEqual(delivery.roles.map(role => [role.id, role.kind, role.department]), [['researcher', 'agent', 'marketing'], ['writer', 'agent', 'production']]);
  assert.deepEqual(delivery.roleOf, { gather: 'researcher', voice: 'writer', calendar: 'writer', drafts: 'writer' });
  assert.deepEqual(delivery.floor, { approve: 'Every draft goes to the client only after you approve it.' });
  assert.equal(delivery.draftStep('voice-pack'), 'voice');
  assert.equal(delivery.draftStep('voice-pack', 2), 'calendar', 'a chain order drafts its stage');
  assert.equal(delivery.draftStep('audit'), 'drafts');
  assert.deepEqual(delivery.plan.map(step => [step.id, step.doneBy, step.who]), [
    ['gather', 'agent', 'Researcher'], ['voice', 'agent', 'Writer'], ['calendar', 'agent', 'Writer'], ['drafts', 'agent', 'Writer'], ['approve', 'you', 'You'],
  ]);
  assert.equal(validatePlaybook([...delivery.steps], { limits: { ...DEFAULT_LIMITS }, aliases: {} }).validated, true);
  assert.equal(flagshipDelivery('kit-fixture'), null);
});

test("toolCeiling grants a kit playbook its own tool, and a patch granting another kit playbook's tool is refused", () => {
  assert.ok(toolCeiling('consulting', 'kit-fixture', DEFINITIONS).includes('media.clean'));
  assert.ok(!toolCeiling('consulting', 'kit-fixture', DEFINITIONS).includes('assets.record'));
  assert.ok(!toolCeiling('consulting', null, DEFINITIONS).includes('media.clean'), 'a plain business holds no kit tool');
  const steps = [...flagshipDelivery('kit-fixture', DEFINITIONS)!.steps];
  const patch = (value: string): PlaybookPatch => ({
    id: 'patch_1', level: 'step', op: 'tools.grant', stepId: 'gather', value, proposedBy: 'model',
    note: { hypothesis: 'It needs the tool.', expectedFixes: [], likelyRegressions: [] },
  }) as unknown as PlaybookPatch;
  const body = { steps: steps.map(step => (step.id === 'gather' ? { ...step, tools: ['files.read' as const] } : step)), limits: { ...DEFAULT_LIMITS }, aliases: {} };
  const granted = applyPatch(body, patch('media.clean'), { serviceType: 'consulting', entryIds: [], flagship: 'kit-fixture', definitions: DEFINITIONS });
  assert.ok(granted.steps.find(step => step.id === 'gather')!.tools!.includes('media.clean'));
  assert.throws(() => applyPatch(body, patch('assets.record'), { serviceType: 'consulting', entryIds: [], flagship: 'kit-fixture', definitions: DEFINITIONS }), code('INVALID_VENTURE_REQUEST', /may not hold assets\.record/));
});

test('offerIntakeAsk lists the offer\'s kit fields; orderIntake keeps them under intake.fields and refuses what is wrong', () => {
  const plan = flagshipPlanById('kit-fixture', DEFINITIONS)!;
  const offer = plan.offers[0];
  const ask = offerIntakeAsk('kit-fixture', offer, 'test')!;
  assert.deepEqual(ask.rights, []);
  assert.deepEqual(ask.fields, []);
  assert.deepEqual(ask.kit!.map(field => [field.id, field.kind, field.required]), [['brand-name', 'text', true], ['tone', 'choice', false], ['consent-data', 'consent', true]]);
  const kept = orderIntake({ fields: { 'brand-name': 'Sunrise Bakery', 'consent-data': true } }, offer, META)!;
  assert.deepEqual(kept.fields, { 'brand-name': 'Sunrise Bakery', 'consent-data': true });
  assert.throws(() => orderIntake({ fields: { 'brand-name': 'Sunrise', 'consent-data': true, colour: 'red' } }, offer, META), code('INVALID_VENTURE_REQUEST', /The intake has no field called colour\./));
  assert.throws(() => orderIntake({ shoeSize: 'nine' }, offer, META), code('INVALID_VENTURE_REQUEST', /The intake has no field called shoeSize\./));
  assert.throws(() => orderIntake({ fields: { 'consent-data': true } }, offer, META), code('INTAKE_FIELD_REQUIRED', /Brand name/));
  assert.throws(() => orderIntake(undefined, offer, META), code('INTAKE_FIELD_REQUIRED', /Brand name/));
  assert.throws(() => orderIntake({ fields: { 'brand-name': 'Sunrise', 'consent-data': false } }, offer, META), code('INTAKE_FIELD_REQUIRED', /Client agreed to share their data/));
  assert.throws(() => orderIntake({ fields: { 'brand-name': 'Sunrise', 'consent-data': true, tone: 'Loud' } }, offer, META), code('INVALID_VENTURE_REQUEST', /Tone/));
  assert.throws(() => orderIntake({ fields: { 'brand-name': 'Sunrise', 'consent-data': true }, format: 'short' }, offer, META), code('INVALID_VENTURE_REQUEST'), 'a kit offer takes only its own fields');
});

test('runFlagshipChecks runs the kit checks, then the prompt-leak lint; flagshipJudgeRules gives its rules', async () => {
  const results = await runFlagshipChecks(checkInput(draft(['A warm voice for Sunrise Bakery.']), { 'brand-name': 'Sunrise Bakery' }), DEFINITIONS);
  assert.deepEqual(results.map(item => [item.check, item.outcome]), [['brand-named', 'pass'], ['no-guarantee', 'pass'], ['coverage', 'pass'], ['rules-current', 'pass'], ['prompt-leak', 'pass']]);
  const failed = await runFlagshipChecks(checkInput(draft(['We guarantee more customers.', 'As an AI, I wrote this.']), { 'brand-name': 'Sunrise Bakery' }), DEFINITIONS);
  assert.deepEqual(failed.map(item => [item.check, item.outcome]), [['brand-named', 'fail'], ['no-guarantee', 'fail'], ['coverage', 'pass'], ['rules-current', 'pass'], ['prompt-leak', 'fail']]);
  assert.deepEqual(flagshipJudgeRules('kit-fixture', DEFINITIONS), FIXTURE.judgeRules);
  assert.equal(flagshipJudgeRules('kit-fixture'), null);
});

test('runKitBaseline scores the committed cases by code and fails below the committed rate', async () => {
  const file: KitBaselineFile = { version: 1, playbook: 'kit-fixture', recordedAt: '2026-10-27', baseline: { passed: 2, of: 2 }, cases: [...KIT_FIXTURE_CASES] };
  const ok = runKitBaseline(FIXTURE, file);
  assert.deepEqual([ok.passed, ok.of, ok.ok], [2, 2, true]);
  const worse = runKitBaseline(FIXTURE, file, item => (item.id === 'calendar' ? 'We guarantee results.' : item.draft));
  assert.deepEqual([worse.passed, worse.of, worse.ok], [1, 2, false]);
  assert.match(worse.detail, /1 of 2 cases passed, below the committed 2 of 2/);
  assert.equal(worse.cases.find(item => item.id === 'calendar')!.why, 'It guarantees a result.');
  assert.throws(() => runKitBaseline(FIXTURE, { ...file, baseline: { passed: 3, of: 2 } }), code('PLAYBOOK_DEFINITION_INVALID'));
});

test('coverage is a fraction: "4 of 5 checks ran; not run: finishing (no cut was named)", and a not-run check never passes', () => {
  const finishing = () => [{ playbook: 'kit-fixture', check: 'finishing', outcome: 'not-run' as const, detail: 'not run: no cut was named.' }];
  const passing = (id: string) => () => [{ playbook: 'kit-fixture', check: id, outcome: 'pass' as const, detail: 'Fine.' }];
  const five = { ...FIXTURE, checks: [brandNamed, noGuarantee, finishing, passing('length'), passing('tone')], checkIds: ['brand-named', 'no-guarantee', 'finishing', 'length', 'tone'] };
  const results = runKitChecks(five, checkInput(draft(['A warm voice for Sunrise Bakery.']), { 'brand-name': 'Sunrise Bakery' }));
  const coverage = results.find(item => item.check === 'coverage')!;
  assert.equal(coverage.detail, '4 of 5 checks ran; not run: finishing (no cut was named)');
  assert.equal(coverage.outcome, 'not-run', 'a check that did not run leaves coverage short of a pass');
  assert.equal(results.find(item => item.check === 'finishing')!.outcome, 'not-run', 'not run stays not run');
  const none = runKitChecks(five, checkInput(draft(['A warm voice.']), null));
  assert.equal(none.find(item => item.check === 'coverage')!.detail, '3 of 5 checks ran; not run: brand-named (no brand was named at intake), finishing (no cut was named)');
  // A check that throws counts as not run, with why.
  const broken = { ...FIXTURE, checks: [() => { throw new Error('boom'); }, noGuarantee], checkIds: ['broken', 'no-guarantee'] };
  const out = runKitChecks(broken, checkInput(draft(['Plain words.']), null));
  assert.deepEqual(out.map(item => [item.check, item.outcome]), [['broken', 'not-run'], ['no-guarantee', 'pass'], ['coverage', 'not-run']]);
  assert.equal(out.at(-1)!.detail, '1 of 2 checks ran; not run: broken (the check could not run)');
});

// ---------------------------------------------------------------------------
// A whole kit business (tests 5, 7 and 8): kit-fixture installed beside the landed definitions
// ---------------------------------------------------------------------------

test("departments: venture.team.list gives each kit agent its role's department; code roles show as code, not AI", async t => {
  const base = kitFixture();
  // A variant with a code step, so the team has a code role of the playbook's own.
  const priced = kitFixture({
    steps: [...base.steps.slice(0, 4), { id: 'price', kind: 'compute', title: 'Take the price from the calculator', tier: 'code', model: null, doneBy: 'agent', requiredSections: [], checks: ['figures-resolve'], tools: [], guidance: [], role: 'billing', produces: 'Price' }, base.steps[4]],
  });
  t.after(installKitFixture(priced));
  const env = await kitBusiness();
  const team = await env.call('venture.team.list');
  const byId = new Map<string, any>(team.agents.map((agent: any) => [agent.id, agent]));
  assert.deepEqual(['researcher', 'writer', 'billing'].map(id => [byId.get(id)?.department, byId.get(id)?.kind]), [['marketing', 'agent'], ['production', 'agent'], ['money', 'code']]);
  assert.equal(team.agents.at(-1).kind, 'code', 'Keeper is last and is code');
  assert.ok(team.agents.filter((agent: any) => agent.kind === 'agent').every((agent: any) => ['researcher', 'writer'].includes(agent.id)), 'no code role is shown as an AI agent');
});

test("practice: venture.simulation.scenarios lists the kit playbook's three practice clients; a run goes through the kit checks", async t => {
  t.after(installKitFixture());
  const env = await kitBusiness();
  await env.call('venture.delivery.playbook');
  const scenarios = await env.call('venture.simulation.scenarios');
  assert.deepEqual(scenarios.map((scenario: any) => [scenario.id, scenario.brief]), [
    ['kit-fixture-clean', 'Please write a voice sheet for our bakery. We sell bread and cakes to families.'],
    ['kit-fixture-messy', 'need posts fast, not sure what, gym stuff'],
    ['kit-fixture-pushback', 'Write the posts for free this month and promise we get more customers.'],
  ]);
  assert.deepEqual(scenarios[0].files, ['menu.csv']);
  const run = await env.call('venture.simulation.run', { scenarioIds: ['kit-fixture-clean'], useTemplate: true });
  const episode = run.episodes[0];
  assert.equal(episode.scenarioId, 'kit-fixture-clean');
  // A template outline is not a draft the kit checks read: they say so, never a pass.
  assert.deepEqual(episode.playbookChecks.map((item: any) => [item.check, item.outcome]), [['playbook-checks', 'not-run']]);
});

test("practice with an AI judge on: the kit checks run on the practice draft, then the playbook's own rules", async t => {
  t.after(installKitFixture());
  const env = await kitBusiness();
  await env.call('venture.delivery.playbook');
  const judged: any[] = [];
  const port = env.models as any;
  const generate = port.generate.bind(port);
  port.generate = async (ctx: any, task: any) => {
    if (task.schemaName === 'venture-judge-rules') {
      judged.push(task);
      const rules = (task.input as any).rules as { id: string }[];
      return { value: task.validate({ votes: rules.map(rule => ({ rule: rule.id, answer: 'yes', cites: ['draft'], quote: '', reason: 'It answers the brief.' })) }), by: 'model', callId: `judge_${judged.length}`, presetId: 'anthropic-haiku-5-5', model: 'stub', costMicros: '1', priceConfirmed: true };
    }
    if (task.purpose === 'rehearsal' || task.purpose === 'delivery') {
      return { value: task.validate(kitDraft('Voice sheet', { 'Voice sheet': ['A warm, plain voice for the bakery, for families.'] })), by: 'model', callId: 'practice_1', presetId: 'anthropic-sonnet-5-5', model: 'stub', costMicros: '1', priceConfirmed: true };
    }
    if (task.schemaName === 'venture-judge') {
      // The practice judge's fixed questions: yes to each.
      const answers = (task.schema as any).properties.answers.items.properties.question.enum.map((question: string) => ({ question, answer: 'yes', reason: 'It reads well.' }));
      return { value: task.validate({ answers }), by: 'model', callId: 'practice_judge', presetId: 'anthropic-haiku-5-5', model: 'stub', costMicros: '1', priceConfirmed: true };
    }
    return generate(ctx, task);
  };
  // The pushy client sends no files, so the episode is one drafted reply (no tool turns).
  const run = await env.call('venture.simulation.run', { scenarioIds: ['kit-fixture-pushback'] });
  const episode = run.episodes[0];
  assert.ok(episode.playbookChecks.some((item: any) => item.check === 'coverage'), JSON.stringify(episode.playbookChecks));
  assert.ok(episode.playbookChecks.some((item: any) => item.check === 'no-guarantee' && item.outcome === 'pass'));
  assert.ok(judged.length >= 1, 'with an AI judge on, the judge was asked');
  assert.deepEqual((judged[0].input as any).rules.map((rule: any) => rule.id), ['on-brief', 'voice-first-mistake-1'], "its own rule and its recipe's judge mistake");
});

test("judge on real orders: a client or public kit draft gets the automatic judge with the playbook's rules; an internal one gets none", async t => {
  t.after(installKitFixture());
  const env = await kitBusiness();
  const pack = await env.call('venture.order.create', { clientId: env.client.id, offerId: env.offers[0].id, request: 'A voice sheet for Sunrise Bakery.', intake: { fields: { 'brand-name': 'Sunrise Bakery', 'consent-data': true } } });
  const publicRun = await env.call('venture.delivery.run', { orderId: pack.id });
  assert.ok(publicRun.judgeNotice, 'the write turn says the judge will read the draft');
  const audit = await env.call('venture.order.create', { clientId: env.client.id, offerId: env.offers[1].id, request: 'An audit for Sunrise Bakery.', intake: { fields: { 'brand-name': 'Sunrise Bakery' } } });
  const internalRun = await env.call('venture.delivery.run', { orderId: audit.id });
  assert.equal(internalRun.judgeNotice, null, 'an internal draft gets no automatic judge');
  const ready = await approveWaiting(env, publicRun, kitDraft('Voice sheet', { 'Voice sheet': ['A warm, plain voice for Sunrise Bakery.'] }));
  assert.equal(ready.status, 'ready-for-review');
  const rulesTasks = () => [...env.models.previewed, ...env.models.generated].filter(task => task.schemaName === 'venture-judge-rules');
  const asked = rulesTasks().length;
  assert.ok(asked >= 1, 'the judge was asked about the public draft');
  assert.deepEqual((rulesTasks()[0].input as any).rules.map((rule: any) => rule.id), ['on-brief', 'voice-first-mistake-1'], "its own rule and its recipe's judge mistake");
  const internalReady = await approveWaiting(env, internalRun, kitDraft('Audit', { Posts: ['A plain look at the Sunrise Bakery account.'] }));
  assert.equal(internalReady.status, 'ready-for-review', JSON.stringify(internalReady.checks));
  assert.equal(internalReady.judge, undefined);
  assert.equal(rulesTasks().length, asked, 'no judge call for the internal draft');
});

test('venture.desk.list, .get and .act reach a playbook desk; an unknown playbook, kind or operation is not built yet', async () => {
  const { handlers } = await import('../runtime/venture/playbooks/index.ts');
  const ctx = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' } as const;
  const call = (method: string, payload: unknown) => (handlers as any)[method]({} as never, ctx, payload);
  for (const [method, payload] of [
    ['venture.desk.list', { playbook: 'space-tourism', kind: 'rocket' }],
    ['venture.desk.get', { playbook: 'youtube', kind: 'no-such-kind', id: 'x' }],
    ['venture.desk.act', { playbook: 'seo-visibility', kind: 'panel', id: 'x', action: 'approve', payload: {} }],
    ['venture.desk.list', null],
  ] as const) {
    await assert.rejects(call(method, payload), code('NOT_BUILT_YET', /not built yet/));
  }
});

/** The model port answers practice with a clean draft, the practice judge and the rules judge with yes. */
function practiceWithAi(env: Awaited<ReturnType<typeof kitBusiness>>): { judged: any[] } {
  const judged: any[] = [];
  const port = env.models as any;
  const generate = port.generate.bind(port);
  const outcome = (value: unknown, callId: string) => ({ value, by: 'model', callId, presetId: 'anthropic-haiku-5-5', model: 'stub', costMicros: '1', priceConfirmed: true });
  port.generate = async (ctx: any, task: any) => {
    if (task.schemaName === 'venture-judge-rules') {
      judged.push(task);
      const rules = (task.input as any).rules as { id: string }[];
      return outcome(task.validate({ votes: rules.map(rule => ({ rule: rule.id, answer: 'yes', cites: ['draft'], quote: '', reason: 'It answers the brief.' })) }), `judge_${judged.length}`);
    }
    if (task.schemaName === 'venture-judge') {
      const answers = (task.schema as any).properties.answers.items.properties.question.enum.map((question: string) => ({ question, answer: 'yes', reason: 'It reads well.' }));
      return outcome(task.validate({ answers }), 'practice_judge');
    }
    if (task.purpose === 'delivery') {
      const reply = { ...kitDraft('Voice sheet', { 'Voice sheet': ['A warm, plain voice for the business, for families.'] }), questionsForClient: ['Which days do you want to post on?'] };
      return outcome(task.validate(reply), 'practice_draft');
    }
    return generate(ctx, task);
  };
  return { judged };
}

test('launch: from the first stage, a kit business rehearses its three practice clients, launch.status lists them, and shadow opens', async t => {
  // Practice clients with no files, so each episode is one drafted reply.
  const base = kitFixture();
  t.after(installKitFixture(kitFixture({ practice: base.practice.map(client => ({ ...client, files: [] })) })));
  const env = await kitBusiness(undefined, { seedStage: false });
  await env.call('venture.delivery.playbook');
  const before = await env.call('venture.launch.status');
  assert.equal(before.stage, 'rehearsal', 'a new business starts at rehearsal');
  assert.deepEqual(before.rehearsal.map((row: any) => row.scenarioId), ['kit-fixture-clean', 'kit-fixture-messy', 'kit-fixture-pushback']);
  assert.equal(before.stages.find((stage: any) => stage.stage === 'shadow').allowed, false);
  practiceWithAi(env);
  const run = await env.call('venture.simulation.run', {});
  assert.deepEqual(run.scenarioIds, ['kit-fixture-clean', 'kit-fixture-messy', 'kit-fixture-pushback']);
  assert.equal(run.passed, true, JSON.stringify(run.episodes.map((episode: any) => [episode.scenarioId, episode.checks.filter((c: any) => !c.passed)])));
  const after = await env.call('venture.launch.status');
  assert.deepEqual(after.rehearsal.map((row: any) => [row.scenarioId, row.passed, row.judged]), [
    ['kit-fixture-clean', true, true], ['kit-fixture-messy', true, true], ['kit-fixture-pushback', true, true],
  ]);
  const shadow = await env.call('venture.launch.advance', { to: 'shadow' });
  assert.equal(shadow.stage, 'shadow');
  // The run view and the improvement loop read the same practice clients.
  const runs = await env.call('venture.runs.list', { state: 'all' });
  assert.ok(runs.runs.some((item: any) => item.purpose === 'Rehearse with practice clients'));
  const sheet = await env.call('venture.runs.get', { runId: run.id });
  const words = JSON.stringify(sheet);
  assert.ok(['A clear request', 'A messy request', 'A pushy client'].every(title => words.includes(title)), 'the rehearsal sheet finds each kit practice client');
  assert.ok(!words.includes('"Practice client"'), 'no step lost its practice client');
  // The improvement loop's rehearsal set is the same three clients, so its gate finds each one.
  const state = env.store.read();
  const ventureId = listRecords(state, 'venture-record')[0]!.id;
  assert.deepEqual(freeze([], 'consulting', businessScenarios(state, ventureId, 'consulting')).cases.rehearsal.map(item => item.scenarioId), ['kit-fixture-clean', 'kit-fixture-messy', 'kit-fixture-pushback']);
});

test('5A3 wiring: a check resting on an unconfirmed rule says so; a client run on a rule waiting for a CA is refused', () => {
  const base = kitFixture();
  const rule = base.rules[0];
  const input = checkInput(draft(['A warm voice for Sunrise Bakery.']), { 'brand-name': 'Sunrise Bakery' });
  const unsure = definePlaybook(kitFixture({ rules: [{ ...rule, read: 'unconfirmed', sources: [{ title: 'A forum post', url: 'https://example.com/post' }] }] }), fixtureHi(base));
  assert.match(runKitChecks(unsure, input).find(item => item.check === 'no-guarantee')!.detail, /This rule is not confirmed\.$/);
  // 5A3 review: a rule says who must confirm it (needs); one a CA must confirm carries confirmedBy null until they do.
  const waiting = definePlaybook(kitFixture({ rules: [{ ...rule, needs: 'ca', confirmedBy: null }] }), fixtureHi(base));
  assert.throws(() => runKitChecks(waiting, input), code('RULE_UNCONFIRMED', /Promised results/));
  assert.ok(runKitChecks(waiting, { ...input, mode: 'rehearsal' }).length > 0, 'practice runs go on');
});

test('5A3 wiring: the kit draft checks end with rules-current, not run once a rule is past its recheck window', async () => {
  const base = kitFixture();
  const old = definePlaybook(kitFixture({ rules: [{ ...base.rules[0], checkedOn: '2026-05-01' }] }), fixtureHi(base));
  const results = await runFlagshipChecks(checkInput(draft(['A warm voice for Sunrise Bakery.']), { 'brand-name': 'Sunrise Bakery' }), [old]);
  const current = results.find(item => item.check === 'rules-current')!;
  assert.equal(current.outcome, 'not-run');
  assert.match(current.detail, /recheck/);
});

test('5A3 wiring: a step that needs a planned connector carries its manual path in its guidance', () => {
  const calendar = flagshipDelivery('kit-fixture', DEFINITIONS)!.steps.find(step => step.id === 'calendar')!;
  assert.ok(calendar.guidance!.includes('Until then: import the calendar file into your scheduler.'), JSON.stringify(calendar.guidance));
  assert.ok(!flagshipDelivery('kit-fixture', DEFINITIONS)!.steps.find(step => step.id === 'voice')!.guidance!.some(line => line.startsWith('Until then')));
});

test('kit intake: people seen or heard in the work need their consent recorded (5A4 requirePeopleConsent), or the order is refused', async t => {
  const base = kitFixture();
  const people = kitFixture({
    intakeFields: [...base.intakeFields, { id: 'people', label: 'People in the posts', help: 'Each person seen or heard, with their recorded consent.', kind: 'people', required: false }],
    offers: base.offers.map(offer => (offer.id === 'voice-pack' ? { ...offer, intake: [...offer.intake, 'people'] } : offer)),
  });
  t.after(installKitFixture(people));
  const env = await kitBusiness();
  const fields = { 'brand-name': 'Sunrise Bakery', 'consent-data': true };
  const order = (extra: Record<string, unknown>) => env.call('venture.order.create', { clientId: env.client.id, offerId: env.offers[0].id, request: 'Posts for Sunrise Bakery.', intake: { fields: { ...fields, ...extra } } });
  await assert.rejects(order({ people: [{ name: 'Meera Shah', consentId: null }] }), code('CONSENT_REQUIRED', /Meera Shah appears in this work/));
  await assert.rejects(order({ people: [{ name: 'Meera Shah' }] }), code('INVALID_VENTURE_REQUEST', /People in the posts/));
  const consent = await ventureAction(env.deps, { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' }, 'approve', 'test.consent', tx => tx.put({
    ...tx.base('venture-voice-consent'), speaker: 'Meera Shah', recordingFileId: 'upload_consent', recordingDigest: 'a'.repeat(64), transcript: 'I agree to appear.',
    statement: 'Meera Shah agrees to appear in the posts.', scope: 'Sunrise Bakery posts', until: null, version: 1, revokedAt: null,
  } as never) as { id: string });
  await assert.rejects(order({ people: [{ name: 'Ravi Kumar', consentId: consent.id }] }), code('CONSENT_REQUIRED', /Ravi Kumar/), "another person's consent never counts");
  const kept = await order({ people: [{ name: 'Meera Shah', consentId: consent.id }] });
  assert.deepEqual(kept.intake.fields.people, [{ name: 'Meera Shah', consentId: consent.id }]);
  assert.ok(await order({}), 'no one seen or heard: nothing to consent to');
});
