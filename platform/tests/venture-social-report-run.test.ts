// Social media agency, the monthly report in a real order's run (Ink v2 wave 2, package 2F1): the agent names the
// client's export and the platform, and social.report works out every figure by code (social/report.ts), each with its
// formula and the file, rows and columns it read, as one work receipt the report cites by reference. The narrative
// check reads the draft's words against those receipts. Everything goes through venture.order.create,
// venture.files.add, venture.delivery.run and venture.delivery.approve, turn by turn, as the owner's app calls them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { ChausarError, type Context } from '../runtime/contracts.ts';
import { CalculatorService } from '../runtime/calculator.ts';
import { OntologyService, starterPacks } from '../runtime/ontology.ts';
import { TrustService } from '../runtime/trust.ts';
import type {
  Deliverable, DeliveryRunView, ModelOutcome, ModelPort, ModelPreview, ModelPurpose, ModelStatusView, ModelTask, PlaybookCheckResult, PlaybookPatch,
  PlaybookRecord, SecretShelf, VentureDeps, VentureMethod, WorkReceiptRecord,
} from '../runtime/venture/contracts.ts';
import { digest, listRecords, ventureAction } from '../runtime/venture/records.ts';
import { handlers as coreHandlers } from '../runtime/venture/core/index.ts';
import { handlers as moneyHandlers } from '../runtime/venture/money/index.ts';
import { handlers as deliveryHandlers } from '../runtime/venture/delivery/index.ts';
import { handlers as viewHandlers } from '../runtime/venture/views/index.ts';
import { playbookGrant } from '../runtime/venture/delivery/harness/loop.ts';
import { applyPatch } from '../runtime/venture/delivery/harness/patches.ts';
import { runFlagshipChecks } from '../runtime/venture/playbooks/draft-checks.ts';
import { monthlyReport } from '../runtime/venture/playbooks/social/report.ts';
import { VentureTestStore } from './venture-test-store.ts';

const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected, error?.message); return true; };
const SOCIAL_IDEA = 'A content calendar service for yoga studios in Goa';
const EXPIRES = '2026-10-21T10:30:00.000Z';
const b64 = (text: string) => Buffer.from(text, 'utf8').toString('base64');

/** An Instagram content export as the rules register records its columns; one row is from October, outside the month. */
const INSTAGRAM_NOVEMBER = [
  '"Post ID","Account ID","Account username","Account name","Description","Duration (sec)","Publish time","Permalink","Post type","Data comment","Date","Views","Reach","Likes","Shares","Follows","Comments","Saves"',
  '"17900000000000011","17840000000000","goa.yoga","Goa Yoga","Autumn mornings","0","10/30/2026 18:00","https://www.instagram.com/p/BBB1/","IG image","","Lifetime","2,410","1,980","142","9","3","17","21"',
  '"17900000000000012","17840000000000","goa.yoga","Goa Yoga","Slow flow","0","11/02/2026 09:30","https://www.instagram.com/p/BBB2/","IG carousel","","Lifetime","3,120","2,450","201","14","6","25","40"',
  '"17900000000000013","17840000000000","goa.yoga","Goa Yoga","Sunrise class","42","11/09/2026 12:00","https://www.instagram.com/reel/BBB3/","IG reel","","Lifetime","8,940","6,210","388","52","19","44","61"',
  '"17900000000000014","17840000000000","goa.yoga","Goa Yoga","Our teacher","0","11/16/2026 17:45","https://www.instagram.com/p/BBB4/","IG image","","Lifetime","1,875","1,502","96","4","1","8","12"',
].join('\n');
const LINKEDIN_NOVEMBER = [
  '"Update title","Update link","Update type","Posted by","Created date","Impressions","Clicks","Click through rate (CTR)","Likes","Comments","Reposts","Follows","Engagement rate"',
  '"Slow mornings","https://www.linkedin.com/feed/update/urn:li:activity:8001/","Organic","Goa Yoga","11/04/2026","1,820","64","0.0352","41","7","3","2","0.0643"',
].join('\n');
const REQUEST = 'The November report for our Instagram, from the export I sent.';
/** The plan's fourth offer: the monthly report. */
const REPORT_OFFER = 'offer_4';

type Responder = (task: ModelTask<any>) => unknown;
/** Both tiers are an AI. Each preview waits for approval; an approved one answers from the responder for its purpose. */
class ScriptPort implements ModelPort {
  respond: Partial<Record<ModelPurpose, Responder>> = {};
  previewed: ModelTask<any>[] = [];
  #calls = 0;
  #previews = new Map<string, { digest: string; task: ModelTask<any> }>();
  status(): ModelStatusView {
    const tier = (presetId: 'anthropic-haiku-5-5' | 'anthropic-sonnet-5-5') => ({ presetId, model: presetId, usable: true, reason: 'Uses your Anthropic key.' });
    return {
      connections: [], tiers: { fast: tier('anthropic-haiku-5-5'), main: tier('anthropic-sonnet-5-5') },
      spentThisMonthMicros: '0', spentThisMonthDisplay: 'USD 0.0000', estimate: false, sendPolicy: 'shape', replay: { active: true, label: 'synthetic recording' },
    };
  }
  presets(): never { throw new ChausarError('NOT_BUILT_YET', 'Not used here.'); }
  async checkCli(): Promise<void> { throw new ChausarError('NOT_BUILT_YET', 'Not used here.'); }
  async generate<T>(_ctx: Context, task: ModelTask<T>): Promise<ModelOutcome<T>> {
    if (!task.template) throw new ChausarError('NO_MODEL_CONNECTED', 'No template.');
    return { value: task.template(), by: 'template', callId: null, presetId: 'built-in-templates', model: null, costMicros: '0', priceConfirmed: true };
  }
  async preview<T>(_ctx: Context, task: ModelTask<T>): Promise<ModelPreview | null> {
    this.previewed.push(task);
    this.#calls += 1;
    const callId = `call_${this.#calls}`;
    const payloadText = JSON.stringify({ system: task.instructions, input: task.input });
    this.#previews.set(callId, { digest: digest(payloadText), task });
    return {
      callId, payloadText, digest: digest(payloadText), presetId: 'anthropic-sonnet-5-5', model: 'claude-sonnet-5-5', endpoint: 'https://api.anthropic.com/v1/messages',
      estimatedMaxCostMicros: '1000', estimatedMaxCostDisplay: 'USD 0.0010', expiresAt: EXPIRES,
    };
  }
  async runPreview<T>(_ctx: Context, callId: string, approved: string, validate: (raw: unknown) => T): Promise<ModelOutcome<T>> {
    const held = this.#previews.get(callId);
    if (!held || held.digest !== approved) throw new ChausarError('APPROVAL_STALE', 'Run it again.');
    this.#previews.delete(callId);
    const responder = this.respond[held.task.purpose];
    assert.ok(responder, `no responder for ${held.task.purpose}`);
    return { value: validate(structuredClone(responder(held.task))), by: 'model', callId, presetId: 'anthropic-sonnet-5-5', model: 'stub', costMicros: '10', priceConfirmed: true };
  }
}

const HANDLERS = { ...coreHandlers, ...moneyHandlers, ...deliveryHandlers, ...viewHandlers } as Record<string, (deps: VentureDeps, ctx: Context, payload: unknown) => Promise<any>>;

/**
 * A social agency business on the template route, priced, accepted, at approve each, with one client. Its plan sells
 * the monthly report as its fourth offer (playbooks/plan.ts), priced by the owner like the others.
 */
async function business() {
  const store = new VentureTestStore();
  const ontology = new OntologyService(store), calculator = new CalculatorService(store), trust = new TrustService(store);
  const pack = structuredClone(starterPacks.find(item => item.pack === 'services')!);
  pack.currency = 'INR';
  pack.gstMode = 'unregistered';
  for (const definition of pack.definitions) definition.currency = 'INR';
  await ontology.publish(owner, pack);
  const models = new ScriptPort();
  const secrets = { get: () => null, set: () => undefined, delete: () => undefined, has: () => false, clear: () => undefined } as unknown as SecretShelf;
  const deps: VentureDeps = {
    store, clock: () => new Date('2026-10-21T10:00:00.000Z'), models, services: { calculator, ontology, trust },
    github: { kind: 'fixture', async read() { throw new ChausarError('GITHUB_READ_FAILED', 'No GitHub here.'); } },
    secrets, host: 'test', demo: true, storage: 'experimental-file',
  };
  const call = (method: VentureMethod, payload: unknown = {}): Promise<any> => {
    const handler = HANDLERS[method];
    assert.ok(handler, `no handler for ${method}`);
    return handler(deps, owner, payload);
  };
  await call('venture.create', { idea: SOCIAL_IDEA, countryCode: 'IN', workingName: 'Goa Yoga' });
  let interview = await call('venture.interview.next', { useTemplate: true });
  for (const question of interview.interview.questions) {
    const answer = question.id === 'q_pricing_model' ? { choiceId: question.choices[0].id } : question.id === 'q_tax' ? { yes: false } : { skipped: true };
    interview = await call('venture.interview.answer', { questionId: question.id, answer });
  }
  const drafted = await call('venture.blueprint.draft', { useTemplate: true });
  const priced = await call('venture.blueprint.update', { patch: { offers: drafted.blueprint.offers.map((offer: any) => ({ id: offer.id, unitPrice: '1000' })) } });
  await call('venture.blueprint.accept', { digest: priced.blueprint.digest });
  await ventureAction(deps, owner, 'approve', 'seed.stage', tx => { tx.touch({ launchStage: 'approve-each' }); });
  assert.equal(priced.blueprint.offers[3].playbookOffer, 'monthly-report', 'the plan sells the monthly report');
  const client = await call('venture.client.add', { name: 'Asha Rao', email: 'asha@example.com', countryCode: 'IN' });
  return { deps, store, call, models, client };
}
type Env = Awaited<ReturnType<typeof business>>;

const turnOf = (note: string, calls: [string, unknown][], finished = false) => ({ note, calls: calls.map(([tool, input]) => ({ tool, input: JSON.stringify(input) })), finished });
const part = (text: string) => ({ kind: 'text', text, ref: '' });
const fig = (ref: string) => ({ kind: 'figure', text: '', ref });
const REPORT_CALL = turnOf('Work out the report figures from the export', [['social.report', { month: '2026-11', files: [{ file: 'f1', platform: 'instagram' }] }]], true);
const report = (whatShows: unknown[]) => ({
  title: 'Your November report',
  sections: [
    { heading: 'Summary', parts: [part('Here is how your Instagram posts did in November, from the export you sent.')] },
    { heading: 'What the figures show', parts: whatShows },
    { heading: 'What we will try next', parts: [part('We will plan more reels like your top post.')] },
  ],
  questionsForClient: [],
});

async function reportOrder(env: Env, name = 'instagram-november.csv', content = INSTAGRAM_NOVEMBER) {
  const order = await env.call('venture.order.create', { clientId: env.client.id, offerId: REPORT_OFFER, request: REQUEST });
  await env.call('venture.files.add', { orderId: order.id, name, contentBase64: b64(content) });
  return order;
}
const approve = (env: Env, run: DeliveryRunView): Promise<DeliveryRunView> => env.call('venture.delivery.approve', { runId: run.id, digest: run.preview!.digest });
const checksOf = (run: { playbookChecks?: PlaybookCheckResult[] }) => Object.fromEntries((run.playbookChecks ?? []).map(item => [item.check, item]));

test('report figures: social.report works out every figure from the export by code, as one receipt the report cites', async () => {
  const env = await business();
  const record: PlaybookRecord = await env.call('venture.delivery.playbook');
  assert.ok(record.steps.find(step => step.id === 'intake')!.tools!.includes('social.report'), 'the intake agent may hold it');
  assert.ok(playbookGrant(record).includes('social.report'));

  const order = await reportOrder(env);
  env.models.respond['agent-turn'] = () => REPORT_CALL;
  env.models.respond.delivery = () => report([part('The people your posts reached in the month:'), fig('w1.reach'), part('How many of them liked, commented, shared or saved:'), fig('w1.engagement-rate'), part('The post they took to most:'), fig('w1.top-post')]);
  let run: DeliveryRunView = await env.call('venture.delivery.run', { orderId: order.id });
  assert.equal(run.harness!.phase, 'act');
  run = await approve(env, run);
  const callRecord = run.harness!.toolCalls.find(item => item.tool === 'social.report')!;
  assert.equal(callRecord.outcome, 'succeeded', JSON.stringify(callRecord.envelope));
  const result = (callRecord.envelope as { ok: true; result: any }).result;
  assert.equal(result.receipt, 'w1');
  assert.ok(result.figures.some((item: any) => item.ref === 'w1.reach'), 'the agent reads figure refs, never computes a figure');
  assert.ok(run.harness!.rounds!.at(-1)!.steps.every(step => step.audited), 'the auditor checked the receipt the step made');

  const receipts = listRecords(env.store.read(), 'venture-work-receipt');
  assert.equal(receipts.length, 1);
  const receipt = receipts[0] as WorkReceiptRecord;
  assert.equal(receipt.operation, 'social.report');
  assert.deepEqual(receipt.runRef, { kind: 'delivery', runId: run.id });
  const expected = monthlyReport({ month: '2026-11', files: [{ file: { id: receipt.inputs.tables[0].id, name: 'instagram-november.csv', text: INSTAGRAM_NOVEMBER }, platform: 'instagram' }] });
  assert.deepEqual(receipt.figures.map(item => item.key), ['posts', 'views', 'reach', 'follows', 'engagements', 'engagement-rate', 'top-post']);
  const byKey = Object.fromEntries(receipt.figures.map(item => [item.key, item]));
  assert.deepEqual([byKey.reach.display, byKey.reach.minor, byKey.reach.unit], ['10,162', '10162', 'count']);
  assert.deepEqual([byKey.posts.minor, byKey.views.minor, byKey.follows.minor, byKey.engagements.minor], ['3', '13935', '26', '945']);
  const rate = expected.receipts.find(item => item.key === 'engagement-rate')!;
  assert.deepEqual([byKey['engagement-rate'].unit, byKey['engagement-rate'].minor, byKey['engagement-rate'].display], ['percent', rate.value.replace('.', ''), rate.display]);
  assert.deepEqual([byKey['top-post'].unit, byKey['top-post'].minor, byKey['top-post'].display], ['post', '0', '17900000000000013']);
  assert.ok(!receipt.allowedNumbers.includes(byKey['engagement-rate'].minor), 'a rate in hundredths is no number of the report');
  assert.ok(!receipt.allowedNumbers.includes('0'), "a post's zero is no number of the report");
  assert.ok(receipt.allowedNumbers.includes(rate.display) && receipt.allowedNumbers.includes('10162'));
  const sha = createHash('sha256').update(INSTAGRAM_NOVEMBER).digest('hex');
  assert.equal(receipt.report!.length, receipt.figures.length);
  for (const [index, item] of receipt.report!.entries()) {
    const source = expected.receipts.find(entry => entry.key === receipt.figures[index].key)!;
    assert.deepEqual(item, { platform: 'instagram', month: '2026-11', key: source.key, formula: source.formula, inputs: source.inputs, unit: source.unit });
    assert.equal(item.inputs.fileDigest, sha, 'each figure names the file it came from by its digest');
  }
  assert.deepEqual(receipt.report!.find(item => item.key === 'reach')!.inputs.rows, [3, 4, 5], 'the October row is left out');
  assert.deepEqual(receipt.report!.find(item => item.key === 'reach')!.inputs.columns, ['Reach']);
  assert.deepEqual(receipt.inputs.tables, [{ id: receipt.inputs.tables[0].id, name: 'instagram-november.csv', digest: sha }]);

  // The write step cites the receipt by reference; the narrative check passes and the draft can be accepted.
  const write = env.models.previewed.filter(task => task.purpose === 'delivery').at(-1)!.input as { figures: { ref: string }[]; requiredSections: string[]; proven: string[] };
  assert.ok(write.figures.some(item => item.ref === 'w1.reach'));
  assert.deepEqual(write.requiredSections, ['Summary', 'What the figures show', 'What we will try next']);
  run = await approve(env, run);
  assert.equal(run.status, 'ready-for-review');
  assert.ok(run.renderedText!.includes('Reach: 10,162'), run.renderedText!);
  assert.ok(run.renderedText!.includes(`Engagement rate: ${rate.display}`), run.renderedText!);
  assert.ok(run.renderedText!.includes('Top post by engagements: 17900000000000013'), run.renderedText!);
  assert.ok(write.proven.some(line => line.startsWith('Chausar worked out the report figures from the platform exports: Posts, Views, Reach')), 'the write step reads what code worked out');
  const narrative = checksOf(run)['narrative-receipted'];
  assert.equal(narrative.outcome, 'pass', narrative.detail);
  assert.equal(narrative.detail, 'Every figure in the narrative comes from a receipt.');
  // The narrative check rests on the export's dated rule, so the draft's rule freshness names it (Ink v2 2H).
  const rules = checksOf(run)['rules-current'];
  assert.equal(rules.outcome, 'pass', rules.detail);
  assert.match(rules.detail, /Meta (?:Business Suite )?content export/);
  assert.equal(run.canAccept, true, run.acceptBlocked ?? '');
  assert.equal((await env.call('venture.work.get', { id: receipt.id })).operation, 'social.report');
});

test('report figures: an export of another shape answers the engine\'s refusal and makes no receipt', async () => {
  const env = await business();
  const order = await reportOrder(env, 'linkedin-november.csv', LINKEDIN_NOVEMBER);
  env.models.respond['agent-turn'] = () => REPORT_CALL;
  let run: DeliveryRunView = await env.call('venture.delivery.run', { orderId: order.id });
  run = await approve(env, run);
  const refused = run.harness!.toolCalls.find(item => item.tool === 'social.report')!;
  assert.equal(refused.outcome, 'failed');
  assert.ok(!refused.envelope.ok);
  assert.equal(refused.envelope.error.code, 'EXPORT_NOT_RECOGNISED');
  assert.match(refused.envelope.error.message, /does not look like an Instagram content export/);
  assert.deepEqual(listRecords(env.store.read(), 'venture-work-receipt'), []);

  // Two exports of one platform, and a file that is not a CSV, are refused before anything is worked out.
  const twice = await env.call('venture.order.create', { clientId: env.client.id, offerId: REPORT_OFFER, request: REQUEST });
  await env.call('venture.files.add', { orderId: twice.id, name: 'a.csv', contentBase64: b64(INSTAGRAM_NOVEMBER) });
  await env.call('venture.files.add', { orderId: twice.id, name: 'b.csv', contentBase64: b64(INSTAGRAM_NOVEMBER) });
  env.models.respond['agent-turn'] = () => turnOf('Work out the figures', [['social.report', { month: '2026-11', files: [{ file: 'f1', platform: 'instagram' }, { file: 'f2', platform: 'instagram' }] }]], true);
  let second: DeliveryRunView = await env.call('venture.delivery.run', { orderId: twice.id });
  second = await approve(env, second);
  const doubled = second.harness!.toolCalls.find(item => item.tool === 'social.report')!;
  assert.ok(!doubled.envelope.ok);
  assert.equal(doubled.envelope.error.code, 'TOOL_FAILED');
  assert.match(doubled.envelope.error.message, /one export for each platform/);
});

test('narrative: a figure in the words with no receipt fails the check and blocks Accept; in a run with tools the AI cannot write one at all', async () => {
  const env = await business();
  // With the export, the write step refuses a number in the words before it is a draft.
  const order = await reportOrder(env);
  env.models.respond['agent-turn'] = () => REPORT_CALL;
  env.models.respond.delivery = () => report([part('Reach went up 40% this month:'), fig('w1.reach')]);
  let run: DeliveryRunView = await env.call('venture.delivery.run', { orderId: order.id });
  run = await approve(env, run);
  await assert.rejects(approve(env, run), code('MODEL_OUTPUT_REJECTED'));

  // Without an export there is no tool run: the words reach the checks, and the narrative check fails them.
  const bare = await env.call('venture.order.create', { clientId: env.client.id, offerId: REPORT_OFFER, request: REQUEST });
  env.models.respond.delivery = () => report([part('Reach went up 40% this month.')]);
  const waiting: DeliveryRunView = await env.call('venture.delivery.run', { orderId: bare.id });
  assert.equal(waiting.harness, undefined, 'no file, no tools: one drafting call');
  const draft = await approve(env, waiting);
  assert.equal(draft.status, 'ready-for-review');
  const narrative = checksOf(draft)['narrative-receipted'];
  assert.equal(narrative.outcome, 'fail');
  assert.match(narrative.detail, /^This report has no figures worked out from the client's exports\./);
  assert.match(narrative.detail, /These figures have no receipt: "40%"\. Report figures come from the client's exports, computed by code\.$/);
  assert.equal(draft.canAccept, false);
  await assert.rejects(env.call('venture.delivery.review', { runId: draft.id, verdict: 'accepted' }), code('INVALID_VENTURE_REQUEST'));

  // Multipliers, number words and change words are figures too.
  const oneShot = async (line: string) => {
    const order = await env.call('venture.order.create', { clientId: env.client.id, offerId: REPORT_OFFER, request: REQUEST });
    env.models.respond.delivery = () => report([part(line)]);
    const ready = await approve(env, await env.call('venture.delivery.run', { orderId: order.id }));
    assert.equal(ready.status, 'ready-for-review');
    return { run: ready, check: checksOf(ready)['narrative-receipted'] };
  };
  const grew = await oneShot('Reach grew 3x and follows doubled, about forty per cent more than before.');
  assert.equal(grew.check.outcome, 'fail');
  for (const phrase of ['"3x"', '"doubled"', '"forty per cent"']) assert.ok(grew.check.detail.includes(phrase), `${phrase}: ${grew.check.detail}`);
  assert.equal(grew.run.canAccept, false);
  // A report with no receipt at all fails even when its words hold no figure: it reports nothing from the exports.
  const empty = await oneShot('Your posts reached more people this month.');
  assert.equal(empty.check.outcome, 'fail', empty.check.detail);
  assert.equal(empty.check.detail, "This report has no figures worked out from the client's exports. Upload them to the order, and the figures come from social.report.");
  assert.equal(empty.run.canAccept, false);

  // The same words against a real receipt fail the same way: only the receipt's own figures pass.
  const receipt = { id: 'work_1', operation: 'social.report', figures: [{ key: 'reach', label: 'Reach', minor: '10162', display: '10,162', currency: 'INR', unit: 'count' }], report: [{ month: '2026-11' }] };
  const words = (line: string) => ({ title: 'Your November report', questionsForClient: [], sections: [{ heading: 'What the figures show', parts: [{ kind: 'text', text: line, ref: '' }] }] }) as unknown as Deliverable;
  const input = {
    flagship: 'social-agency', offerKey: 'monthly-report', servedBy: 'model' as const, request: REQUEST, intake: null, files: [], receipts: [receipt] as any[],
    known: [], mode: 'client' as const, today: '2026-10-21', dateOrder: 'day-month-year' as const,
  };
  const up = (await runFlagshipChecks({ ...input, deliverable: words('Reach went up 40% to 10,162 in 2026.') })).find(item => item.check === 'narrative-receipted')!;
  assert.equal(up.outcome, 'fail');
  assert.match(up.detail, /"40%"/);
  assert.doesNotMatch(up.detail, /10,162|2026/, 'the receipt\'s figure and the month\'s year pass');
  const more = (await runFlagshipChecks({ ...input, deliverable: words('Reach was 10,162, nearly ×2 last month, a twofold jump and three times the views.') })).find(item => item.check === 'narrative-receipted')!;
  assert.equal(more.outcome, 'fail');
  for (const phrase of ['"×2"', '"twofold"', '"three times"']) assert.ok(more.detail.includes(phrase), `${phrase}: ${more.detail}`);
  assert.doesNotMatch(more.detail, /10,162/);
  const none = (await runFlagshipChecks({ ...input, receipts: [], deliverable: words('Your posts did well.') })).find(item => item.check === 'narrative-receipted')!;
  assert.equal(none.outcome, 'fail', 'a monthly report with no receipt reports nothing from the exports');
  const practice = (await runFlagshipChecks({ ...input, mode: 'rehearsal', receipts: [], deliverable: words('Your posts did well.') })).find(item => item.check === 'narrative-receipted')!;
  assert.equal(practice.outcome, 'not-run', 'practice clients send no exports');
});

test('grants: only the social agency playbook\'s agents may hold social.report', () => {
  const body = { steps: [{ id: 'gather', kind: 'gather' as const, title: 'Read', tier: 'actor' as const, model: 'fast' as const, doneBy: 'agent' as const, requiredSections: [], checks: [], tools: [], guidance: [] }], limits: { maxTurns: 4, maxToolCalls: 12, maxCallsPerTurn: 4, maxCostMicros: '500000', keepOutputs: 4 } as any, aliases: {} };
  const patch: PlaybookPatch = { id: 'p1', level: 'tools', op: 'tools.grant', stepId: 'gather', value: 'social.report', note: { hypothesis: 'More figures.', expectedFixes: [], likelyRegressions: [] }, proposedBy: 'chausar', parentHash: 'parent' };
  assert.throws(() => applyPatch(body, patch, { serviceType: 'agency', entryIds: [], flagship: null }), code('INVALID_VENTURE_REQUEST'));
  assert.throws(() => applyPatch(body, patch, { serviceType: 'studio', entryIds: [], flagship: 'youtube' }), code('INVALID_VENTURE_REQUEST'));
  const granted = applyPatch(body, patch, { serviceType: 'agency', entryIds: [], flagship: 'social-agency' });
  assert.deepEqual(granted.steps[0].tools, ['social.report']);
});
