// Flagship playbooks feed the delivery (playbook wiring, delivery side). A business whose plan came from a flagship
// playbook delivers with that playbook's own typed steps and agent roles: the drafting step and its headings come from
// the playbook (picked by the order's offer), the delivery and rehearsal checks include the playbook's deterministic
// checks (YouTube: hook, title and thumbnail, chapters, disclosure, rights, finishing when ffmpeg is here; CA firm:
// claim checks backed by receipts and the CA's sign-off; social agency: channel limits, disclosure, claims against the
// client's files), and a failed one blocks Accept. Clipping offers refuse an order without rights recorded at intake.
// The team shows the playbook's roles as the agents. A business no flagship playbook fits keeps the eight fixed steps.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ChausarError, type Context } from '../runtime/contracts.ts';
import { CalculatorService } from '../runtime/calculator.ts';
import { OntologyService, starterPacks } from '../runtime/ontology.ts';
import { TrustService } from '../runtime/trust.ts';
import { PURPOSE_TIER } from '../runtime/venture/contracts.ts';
import type {
  Deliverable, DeliveryRunView, ModelOutcome, ModelPort, ModelPreview, ModelStatusView, ModelTask, PlaybookRecord, SecretShelf, VentureDeps, VentureMethod,
} from '../runtime/venture/contracts.ts';
import { digest, listRecords, ventureAction } from '../runtime/venture/records.ts';
import { handlers as coreHandlers } from '../runtime/venture/core/index.ts';
import { handlers as moneyHandlers } from '../runtime/venture/money/index.ts';
import { handlers as deliveryHandlers } from '../runtime/venture/delivery/index.ts';
import { handlers as viewHandlers } from '../runtime/venture/views/index.ts';
import { judgeDraftRules } from '../runtime/venture/delivery/checks.ts';
import { validatePlaybook } from '../runtime/venture/delivery/playbook.ts';
import { stepGates } from '../runtime/venture/policy/context.ts';
import { AGENT_ID } from '../runtime/venture/views/shared.ts';
import { flagshipDelivery } from '../runtime/venture/playbooks/steps.ts';
import { flagshipJudgeRules, runFlagshipChecks } from '../runtime/venture/playbooks/draft-checks.ts';
import { PACKAGE_SECTIONS, YOUTUBE_STEPS } from '../runtime/venture/playbooks/youtube/playbook.ts';
import { YOUTUBE_DRAFT_RULES } from '../runtime/venture/playbooks/youtube/judge.ts';
import { CA_DRAFT_SECTIONS, CA_STEPS } from '../runtime/venture/playbooks/ca-firm/playbook.ts';
import { CA_JUDGE_RULES } from '../runtime/venture/playbooks/ca-firm/claims.ts';
import { regulatedPapersOf } from '../runtime/venture/playbooks/ca-firm/signoff-gate.ts';
import { SOCIAL_STEPS } from '../runtime/venture/playbooks/social/playbook.ts';
import { SOCIAL_JUDGE_RULES } from '../runtime/venture/playbooks/social/judge.ts';
import { VentureTestStore } from './venture-test-store.ts';

const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected, error?.message); return true; };
const YOUTUBE_IDEA = 'Run a YouTube channel that explains personal finance in plain words';
const CA_IDEA = 'An AI-native CA firm for GST filing and income tax returns in Pune';
const SOCIAL_IDEA = 'A content calendar service for yoga studios in Goa';
const PLAIN_IDEA = 'Monthly bookkeeping for cafes and small shops in Pune.';
const EXPIRES = '2026-10-21T10:30:00.000Z';
const OWN_FOOTAGE = { basis: 'own-footage', holder: 'Asha Rao' };

type Draft = { title: string; sections: { heading: string; parts: { kind: 'text'; text: string; ref: '' }[] }[]; questionsForClient: string[] };
const text = (line: string) => ({ kind: 'text' as const, text: line, ref: '' as const });
const draft = (title: string, sections: Record<string, string[]>): Draft => ({
  title, questionsForClient: [], sections: Object.entries(sections).map(([heading, lines]) => ({ heading, parts: lines.map(text) })),
});

/** Both tiers are an AI. Previews wait for approval; an approved preview answers with the next queued draft. */
class Port implements ModelPort {
  drafts: unknown[] = [];
  previewed: ModelTask<any>[] = [];
  generated: ModelTask<any>[] = [];
  fastIsTemplate = false;
  #calls = 0;
  #previews = new Map<string, string>();
  status(): ModelStatusView {
    const tier = (presetId: 'anthropic-haiku-5-5' | 'anthropic-sonnet-5-5', template = false) => template
      ? { presetId: 'built-in-templates' as const, model: null, usable: true, reason: 'No AI connected; using built-in templates' }
      : { presetId, model: presetId, usable: true, reason: 'Uses your Anthropic key.' };
    return {
      connections: [], tiers: { fast: tier('anthropic-haiku-5-5', this.fastIsTemplate), main: tier('anthropic-sonnet-5-5') },
      spentThisMonthMicros: '0', spentThisMonthDisplay: 'USD 0.0000', estimate: false, sendPolicy: 'shape', replay: { active: true, label: 'synthetic recording' },
    };
  }
  presets(): never { throw new ChausarError('NOT_BUILT_YET', 'Not used here.'); }
  async checkCli(): Promise<void> { throw new ChausarError('NOT_BUILT_YET', 'Not used here.'); }
  async generate<T>(_ctx: Context, task: ModelTask<T>): Promise<ModelOutcome<T>> {
    this.generated.push(task);
    if ((this.fastIsTemplate && PURPOSE_TIER[task.purpose] === 'fast') || task.purpose !== 'delivery') {
      check(task.template, 'NO_MODEL_CONNECTED');
      return { value: task.template!(), by: 'template', callId: null, presetId: 'built-in-templates', model: null, costMicros: '0', priceConfirmed: true };
    }
    this.#calls += 1;
    return { value: task.validate(this.drafts.shift()), by: 'model', callId: `call_${this.#calls}`, presetId: 'anthropic-sonnet-5-5', model: 'stub', costMicros: '10', priceConfirmed: true };
  }
  async preview<T>(_ctx: Context, task: ModelTask<T>): Promise<ModelPreview | null> {
    this.previewed.push(task);
    this.#calls += 1;
    const callId = `call_${this.#calls}`;
    const payloadText = JSON.stringify({ system: task.instructions, input: task.input });
    this.#previews.set(callId, digest(payloadText));
    return {
      callId, payloadText, digest: digest(payloadText), presetId: 'anthropic-sonnet-5-5', model: 'claude-sonnet-5-5', endpoint: 'https://api.anthropic.com/v1/messages',
      estimatedMaxCostMicros: '1000', estimatedMaxCostDisplay: 'USD 0.0010', expiresAt: EXPIRES,
    };
  }
  async runPreview<T>(_ctx: Context, callId: string, approved: string, validate: (raw: unknown) => T): Promise<ModelOutcome<T>> {
    if (this.#previews.get(callId) !== approved) throw new ChausarError('APPROVAL_STALE', 'Run it again.');
    this.#previews.delete(callId);
    return { value: validate(this.drafts.shift()), by: 'model', callId, presetId: 'anthropic-sonnet-5-5', model: 'stub', costMicros: '10', priceConfirmed: true };
  }
}
function check(value: unknown, code: string): asserts value { if (!value) throw new ChausarError(code, 'No template.'); }

const HANDLERS = { ...coreHandlers, ...moneyHandlers, ...deliveryHandlers, ...viewHandlers } as Record<string, (deps: VentureDeps, ctx: Context, payload: unknown) => Promise<any>>;

/**
 * A business from an idea on the template route: plan priced on every offer, accepted, at approve each, with one client.
 * words: the owner's own names and descriptions for some offers, set before the plan is accepted.
 */
async function business(idea: string, words: { id: string; name: string; description: string }[] = []) {
  const store = new VentureTestStore();
  const ontology = new OntologyService(store), calculator = new CalculatorService(store), trust = new TrustService(store);
  const pack = structuredClone(starterPacks.find(item => item.pack === 'services')!);
  pack.currency = 'INR';
  pack.gstMode = 'unregistered';
  for (const definition of pack.definitions) definition.currency = 'INR';
  await ontology.publish(owner, pack);
  const models = new Port();
  const secrets: SecretShelf = { get: () => null, set: () => undefined, delete: () => undefined, has: () => false, clear: () => undefined } as unknown as SecretShelf;
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
  await call('venture.create', { idea, countryCode: 'IN', workingName: 'Test Business' });
  let interview = await call('venture.interview.next', { useTemplate: true });
  for (const question of interview.interview.questions) {
    const answer = question.id === 'q_pricing_model' ? { choiceId: question.choices[0].id } : question.id === 'q_tax' ? { yes: false } : { skipped: true };
    interview = await call('venture.interview.answer', { questionId: question.id, answer });
  }
  const drafted = await call('venture.blueprint.draft', { useTemplate: true });
  const priced = await call('venture.blueprint.update', { patch: { offers: drafted.blueprint.offers.map((offer: any) => ({ id: offer.id, unitPrice: '1000', ...words.find(item => item.id === offer.id) })) } });
  await call('venture.blueprint.accept', { digest: priced.blueprint.digest });
  await ventureAction(deps, owner, 'approve', 'seed.stage', tx => { tx.touch({ launchStage: 'approve-each' }); });
  const client = await call('venture.client.add', { name: 'Asha Rao', email: 'asha@example.com', countryCode: 'IN' });
  return { deps, call, models, store, client, offers: priced.blueprint.offers as { id: string; playbookOffer?: string }[] };
}

/** One draft for one order: delivery.run previews, delivery.approve answers with the queued draft. */
async function deliver(env: Awaited<ReturnType<typeof business>>, orderId: string, answer: Draft): Promise<DeliveryRunView> {
  const waiting = await env.call('venture.delivery.run', { orderId });
  assert.equal(waiting.status, 'waiting-for-you');
  env.models.drafts.push(answer);
  return env.call('venture.delivery.approve', { runId: waiting.id, digest: waiting.preview.digest });
}

const PACKAGE = draft('Episode package: hidden bank fees', {
  Summary: ['Hook: Why your savings shrink before you notice, and how to stop it.', 'Hook: Your bank charges you for things you never asked for. Here is how to stop it.', 'A plain episode on the bank fees the client asked about.'],
  'Title and thumbnail': ['Title: Hidden bank fees cost you 5 things a year', 'Thumbnail: STOP PAYING THIS'],
  'Description and chapters': ['Description: A plain guide to the bank fees the client named, and how to stop paying them.', '0:00 Why fees matter', '1:30 The fees to check', '4:00 How to stop them'],
  'Next steps': ['You watch the cut, then you or the client publish it.'],
});
/** The client's notes hold every specific the package repeats, so the claim check finds each one. */
const PACKAGE_REQUEST = 'One episode on hidden bank fees from my raw footage. My edit notes: the 5 fees, thumbnail STOP PAYING THIS, chapters at 0:00, 1:30 and 4:00.';

test('a flagship business delivers with the flagship\'s own steps; a plain business keeps the eight fixed steps', async () => {
  const youtube = await business(YOUTUBE_IDEA);
  const record: PlaybookRecord = await youtube.call('venture.delivery.playbook');
  assert.equal(record.flagship, 'youtube');
  assert.deepEqual(record.steps.map(step => step.id), YOUTUBE_STEPS.map(step => step.id));
  assert.equal(validatePlaybook(record.steps, { limits: record.limits!, aliases: record.aliases ?? {} }).hash, record.hash);
  const write = record.steps.find(step => step.id === 'package')!;
  assert.deepEqual(write.requiredSections, [...PACKAGE_SECTIONS]);
  assert.ok(write.guidance!.some(line => /Hook/.test(line)) && write.guidance!.some(line => /Title/.test(line)), 'the drafting step says how to lay out the package for the checks');

  const ca = await business(CA_IDEA);
  const caRecord: PlaybookRecord = await ca.call('venture.delivery.playbook');
  assert.equal(caRecord.flagship, 'ca-firm');
  assert.deepEqual(caRecord.steps.map(step => step.id), CA_STEPS.map(step => step.id));

  const social = await business(SOCIAL_IDEA);
  const socialRecord: PlaybookRecord = await social.call('venture.delivery.playbook');
  assert.equal(socialRecord.flagship, 'social-agency');
  assert.deepEqual(socialRecord.steps.map(step => step.id), SOCIAL_STEPS.map(step => step.id));

  const plain = await business(PLAIN_IDEA);
  const plainRecord: PlaybookRecord = await plain.call('venture.delivery.playbook');
  assert.equal('flagship' in plainRecord, false);
  assert.deepEqual(plainRecord.steps.map(step => step.id), ['gather', 'clarify', 'work', 'price', 'draft', 'verify', 'approve', 'send']);
});

test('rights at intake: a YouTube order is refused without recorded rights it accepts, and kept with them', async () => {
  const env = await business(YOUTUBE_IDEA);
  assert.deepEqual(env.offers.map(offer => offer.playbookOffer), ['episode-package', 'shorts-from-own-video', 'licensed-clips']);
  const base = { clientId: env.client.id, request: 'One episode on hidden bank fees from my raw footage.' };
  await assert.rejects(env.call('venture.order.create', { ...base, offerId: 'offer_1' }), code('RIGHTS_REQUIRED'), 'no rights, no order');
  await assert.rejects(env.call('venture.order.create', { ...base, offerId: 'offer_3', intake: { rights: OWN_FOOTAGE } }), code('RIGHTS_REQUIRED'), 'clips of another show need a licence or a clip programme');
  await assert.rejects(env.call('venture.order.create', { ...base, offerId: 'offer_3', intake: { rights: { basis: 'licence', holder: 'The Big Show' } } }), code('RIGHTS_REQUIRED'), 'a licence needs its reference');
  await assert.rejects(env.call('venture.order.create', { ...base, offerId: 'offer_1', intake: { rights: OWN_FOOTAGE, format: 'square' } }), code('INVALID_VENTURE_REQUEST'));
  const order = await env.call('venture.order.create', { ...base, offerId: 'offer_1', intake: { rights: OWN_FOOTAGE, format: 'long', aiVoice: false } });
  assert.equal(order.intake.rights.basis, 'own-footage');
  assert.equal(order.intake.rights.recordedBy, 'owner');
  assert.equal(order.intake.format, 'long');
  const clips = await env.call('venture.order.create', { ...base, offerId: 'offer_3', intake: { rights: { basis: 'creator-clip-programme', holder: 'The Big Show', reference: 'https://bigshow.example/clips' } } });
  assert.equal(clips.intake.rights.reference, 'https://bigshow.example/clips');

  const plain = await business(PLAIN_IDEA);
  await assert.rejects(plain.call('venture.order.create', { clientId: plain.client.id, offerId: 'offer_1', request: 'Close my books.', intake: { rights: OWN_FOOTAGE } }), code('INVALID_VENTURE_REQUEST'), 'a plain offer takes no intake');
  const ca = await business(CA_IDEA);
  const gst = await ca.call('venture.order.create', { clientId: ca.client.id, offerId: 'offer_2', request: 'GST working for October.' });
  assert.equal('intake' in gst, false, 'an offer that cuts no footage needs no rights');
});

test('a YouTube draft is a package checked by the playbook: a failed check blocks Accept and shows on the run', async () => {
  const env = await business(YOUTUBE_IDEA);
  const order = await env.call('venture.order.create', { clientId: env.client.id, offerId: 'offer_1', request: PACKAGE_REQUEST, intake: { rights: OWN_FOOTAGE, format: 'long' } });
  const good = await deliver(env, order.id, PACKAGE);
  // The draft's own task: the judge's call on the ready package (judge-run.ts) is previewed after it.
  const task = env.models.previewed.findLast(item => item.purpose === 'delivery')!;
  assert.deepEqual((task.input as any).requiredSections, [...PACKAGE_SECTIONS], 'the package step\'s headings, not the studio reply\'s');
  assert.ok(((task.input as any).guidance as string[]).some(line => /Hook/.test(line)));
  const results = Object.fromEntries((good.playbookChecks ?? []).map(item => [item.check, item]));
  assert.deepEqual(Object.keys(results).sort(), ['ai-disclosure', 'chapters', 'finishing', 'hook-score', 'metadata-limits', 'paid-promotion', 'prompt-leak', 'retention-risk', 'rights-recorded', 'rules-current', 'source-credit', 'title-thumbnail',
    // Ink v2 4J16: the writing checks (playbooks/writing-checks.ts).
    'writing-bait', 'writing-bans', 'writing-quotes', 'writing-tells']);
  for (const id of ['writing-bait', 'writing-bans', 'writing-quotes', 'writing-tells']) assert.equal(results[id].outcome, 'pass', results[id].detail);
  assert.equal(results['prompt-leak'].outcome, 'pass', results['prompt-leak'].detail);
  assert.ok(good.playbookChecks!.every(item => item.playbook === 'youtube'));
  for (const id of ['hook-score', 'title-thumbnail', 'metadata-limits', 'chapters', 'ai-disclosure', 'rights-recorded']) assert.equal(results[id].outcome, 'pass', `${id}: ${results[id].detail}`);
  assert.equal(results.finishing.outcome, 'not-run');
  assert.match(results.finishing.detail, /not run/);
  assert.equal(results['retention-risk'].outcome, 'not-run', 'no transcript, so no retention check, never a pass');
  assert.equal(good.canAccept, true, good.acceptBlocked ?? '');

  const repeat = draft(PACKAGE.title, { ...Object.fromEntries(PACKAGE.sections.map(section => [section.heading, section.parts.map(part => part.text)])), 'Title and thumbnail': ['Title: Hidden bank fees are eating your savings', 'Thumbnail: HIDDEN FEES'] });
  const second = await env.call('venture.order.create', { clientId: env.client.id, offerId: 'offer_1', request: `${PACKAGE_REQUEST} Thumbnail HIDDEN FEES.`, intake: { rights: OWN_FOOTAGE, format: 'long' } });
  const bad = await deliver(env, second.id, repeat);
  assert.equal(bad.playbookChecks!.find(item => item.check === 'title-thumbnail')!.outcome, 'fail');
  assert.equal(bad.canAccept, false);
  assert.match(bad.acceptBlocked!, /thumbnail repeats the title/);
  await assert.rejects(env.call('venture.delivery.review', { runId: bad.id, verdict: 'accepted' }), code('INVALID_VENTURE_REQUEST'));
  const detail = await env.call('venture.runs.get', { runId: bad.id });
  const verify = detail.steps.find((step: any) => step.id === 'verify');
  assert.ok(verify.evidence.some((item: any) => item.id === 'youtube:title-thumbnail' && /^Failed:/.test(item.label)), 'the verify step shows the playbook check');
});

test('the finishing check runs on the named cut when ffmpeg is on this computer, and says when it did not', async () => {
  const input = {
    flagship: 'youtube', offerKey: 'episode-package', servedBy: 'model' as const, deliverable: { ...PACKAGE, sections: PACKAGE.sections } as unknown as Deliverable,
    request: 'One episode.', intake: { rights: { ...OWN_FOOTAGE, reference: null, scope: null, expiresOn: null, recordedAt: '2026-10-21T10:00:00.000Z', recordedBy: 'owner' } as any, format: 'long' as const, aiVoice: false, aiPresenter: false, paidPromotion: false, cutFile: 'D:\\cuts\\episode.mp4' },
    files: [], receipts: [], known: [], mode: 'client' as const, today: '2026-10-21', dateOrder: 'day-month-year' as const,
  };
  const ran: string[][] = [];
  const ffmpeg = {
    locate: () => 'ffmpeg',
    run: async (_binary: string, args: readonly string[]) => {
      ran.push([...args]);
      const video = 'Duration: 00:05:00.00, start: 0.000000\n  Stream #0:0: Video: h264, yuv420p, 1920x1080\n  Stream #0:1: Audio: aac, 48000 Hz';
      return { code: 0, stderr: args.includes('-an') ? video : `${video}\n[Parsed_volumedetect_1] mean_volume: -18.0 dB\n[Parsed_volumedetect_1] max_volume: -6.0 dB`, timedOut: false, startError: null };
    },
  };
  const results = await runFlagshipChecks({ ...input, finishing: { ffmpeg, exists: () => true } });
  const finishing = results.find(item => item.check === 'finishing')!;
  assert.ok(ran.length >= 1, 'ffmpeg ran on the cut');
  assert.notEqual(finishing.outcome, 'not-run', finishing.detail);
  const missing = await runFlagshipChecks({ ...input, finishing: { ffmpeg: { ...ffmpeg, locate: () => null }, exists: () => true } });
  assert.equal(missing.find(item => item.check === 'finishing')!.detail, 'not run: ffmpeg not found');
  const hosted = await runFlagshipChecks({ ...input, finishing: null });
  assert.equal(hosted.find(item => item.check === 'finishing')!.outcome, 'not-run');
});

test('a CA firm draft runs the claim checks backed by receipts and waits for the CA\'s sign-off', async () => {
  const env = await business(CA_IDEA);
  const order = await env.call('venture.order.create', { clientId: env.client.id, offerId: 'offer_2', request: 'GST working for October, from the sales register I sent.' });
  const papers = (line: string) => draft('GST working for October', {
    Summary: ['The working papers for October follow, from the sales register you sent.'],
    'Working papers': [line],
    'Open items for you': ['Please confirm the two invoices marked as missing.'],
    'What your CA does next': ['Your CA checks the papers, signs them off, and files the return on the GST portal.'],
  });
  const filed = await deliver(env, order.id, papers('Your GST return has been filed for October.'));
  const byId = Object.fromEntries((filed.playbookChecks ?? []).map(item => [item.check, item]));
  assert.equal(byId['no-filing-claims'].outcome, 'fail');
  assert.equal(filed.canAccept, false);
  assert.equal(byId['figures-from-receipts'].outcome, 'pass');

  const second = await env.call('venture.order.create', { clientId: env.client.id, offerId: 'offer_2', request: 'GST working for November.' });
  const clean = await deliver(env, second.id, papers('The output tax is worked by the calculator by rate and by head.'));
  const cleanIds = Object.fromEntries((clean.playbookChecks ?? []).map(item => [item.check, item]));
  assert.equal(cleanIds['no-filing-claims'].outcome, 'pass');
  assert.equal(cleanIds['signoff-recorded'].outcome, 'not-run');
  assert.match(cleanIds['signoff-recorded'].detail, /CA of record/);
  assert.deepEqual(((env.models.previewed.at(-1)!.input as any).requiredSections), [...CA_DRAFT_SECTIONS]);
  // W1 H2: a GST working that gives no GST figure from a calculator receipt no longer passes.
  assert.equal(cleanIds['tax-figure-receipted'].outcome, 'fail');
  assert.match(cleanIds['tax-figure-receipted'].detail, /no GST figure/);
  assert.equal(clean.canAccept, false);
});

test('a regulated CA firm offer goes to the CA of record by its playbook offer, even after the owner renames it', async () => {
  const env = await business(CA_IDEA, [{ id: 'offer_2', name: 'Monthly filing papers', description: 'The two monthly returns, worked from your registers.' }]);
  assert.equal(env.offers[1].playbookOffer, 'gst-working');
  await env.call('venture.ca.setOfRecord', { name: 'Meera Iyer', membershipNo: '123456' });
  const order = await env.call('venture.order.create', { clientId: env.client.id, offerId: 'offer_2', request: 'October papers, from the registers I sent.' });
  const run = await deliver(env, order.id, draft('Papers for October', {
    Summary: ['The working papers for October follow, from the registers you sent.'],
    'Working papers': ['The output tax is worked by the calculator by rate and by head.'],
    'Open items for you': ['Please confirm the invoices marked as missing.'],
    'What your CA does next': ['Your CA checks the papers, signs them off, and files the return on the GST portal.'],
  }));
  // The renamed offer is still the GST working: its draft needs a GST figure from the calculator (W1 H2), and its
  // papers are a GST working for the CA to sign off. With no calculator receipt yet, nothing goes to the CA.
  const byId = Object.fromEntries((run.playbookChecks ?? []).map(item => [item.check, item]));
  assert.match(byId['tax-figure-receipted'].detail, /GST/);
  assert.equal(run.canAccept, false);
  const state = env.store.read();
  assert.equal(regulatedPapersOf(state, listRecords(state, 'venture-record')[0], order.id)?.subjectKind, 'gst-working', 'the renamed GST offer is still signed off as a GST working');
  const requests = (state.conversations as any[]).filter(record => record.kind === 'venture-ca-firm' && record.entry === 'signoff-request');
  assert.deepEqual(requests, [], 'papers that fail a check are not sent to the CA');
});

test('a CA firm offer with no playbook id (an older plan) is read from its own words, so a GST working still needs its GST figure', async () => {
  const env = await business(CA_IDEA);
  await ventureAction(env.deps, owner, 'admin', 'seed.legacy-offer', tx => {
    const plan = tx.list('venture-blueprint').find(item => item.status === 'accepted')!;
    tx.replace({ ...plan, offers: plan.offers.map(offer => {
      if (offer.id !== 'offer_2') return offer;
      const { playbookOffer: _dropped, ...rest } = offer;
      return { ...rest, name: { ...offer.name, value: 'GST working papers' } };
    }) });
  });
  const order = await env.call('venture.order.create', { clientId: env.client.id, offerId: 'offer_2', request: 'GST working for October.' });
  const run = await deliver(env, order.id, draft('GST working for October', {
    Summary: ['The working papers for October follow.'],
    'Working papers': ['The output tax is worked by the calculator by rate and by head.'],
    'Open items for you': ['Please confirm the invoices marked as missing.'],
    'What your CA does next': ['Your CA checks the papers, signs them off, and files the return on the GST portal.'],
  }));
  const byId = Object.fromEntries((run.playbookChecks ?? []).map(item => [item.check, item]));
  assert.equal(byId['tax-figure-receipted']?.outcome, 'fail', JSON.stringify(byId['tax-figure-receipted']));
  assert.match(byId['tax-figure-receipted'].detail, /no GST figure/);
  assert.equal(byId['signoff-recorded'].outcome, 'not-run', 'and it is regulated papers waiting for the CA');
});

test('a social agency draft is checked against channel limits, disclosure and the client\'s own words', async () => {
  const env = await business(SOCIAL_IDEA);
  const order = await env.call('venture.order.create', { clientId: env.client.id, offerId: 'offer_1', request: 'Posts for our morning yoga classes in Goa this month.' });
  const posts = (line: string) => draft('Posts for the month', {
    Drafts: ['Instagram: Morning yoga in Goa, slow and steady. Come as you are.', `X: ${line}`],
    'Alt text': ['A calm room with yoga mats in the morning light.'],
    Hashtags: ['Use #yoga and #goa on every post.'],
  });
  const bait = await deliver(env, order.id, posts('Tag a friend who needs a calm morning.'));
  assert.deepEqual(env.models.previewed.at(-1)!.input && (env.models.previewed.at(-1)!.input as any).requiredSections, ['Drafts', 'Alt text', 'Hashtags']);
  const byId = Object.fromEntries((bait.playbookChecks ?? []).map(item => [item.check, item]));
  assert.equal(byId.words.outcome, 'fail', byId.words.detail);
  assert.equal(byId['channel-media'].outcome, 'not-run', 'pictures come later; a text draft is not refused for them');
  assert.equal(bait.canAccept, false);

  const second = await env.call('venture.order.create', { clientId: env.client.id, offerId: 'offer_1', request: 'Posts for our morning yoga classes in Goa.' });
  const clean = await deliver(env, second.id, posts('Morning yoga in Goa. Breathe first, then move.'));
  const cleanIds = Object.fromEntries((clean.playbookChecks ?? []).map(item => [item.check, item]));
  for (const id of ['channel-limits', 'claims', 'disclosure', 'words']) assert.equal(cleanIds[id].outcome, 'pass', `${id}: ${cleanIds[id].detail}`);
  assert.equal(clean.canAccept, true, clean.acceptBlocked ?? '');
});

test('rehearsal: each practice draft carries the playbook checks, and the judge asks the playbook\'s own rules', async () => {
  const env = await business(YOUTUBE_IDEA);
  env.models.fastIsTemplate = true;
  env.models.drafts.push(PACKAGE, PACKAGE, PACKAGE, PACKAGE, PACKAGE, PACKAGE);
  const run = await env.call('venture.simulation.run', { episodes: 1 });
  assert.ok(run.episodes.length >= 1);
  for (const episode of run.episodes) {
    assert.ok(episode.playbookChecks?.length, 'every practice draft is checked by the playbook');
    const rights = episode.playbookChecks.find((item: any) => item.check === 'rights-recorded');
    assert.equal(rights.outcome, 'not-run', 'practice clients send no footage, so rights are not checked');
  }
  assert.equal(flagshipJudgeRules('youtube'), YOUTUBE_DRAFT_RULES);
  assert.equal(flagshipJudgeRules('ca-firm'), CA_JUDGE_RULES);
  assert.equal(flagshipJudgeRules('social-agency'), SOCIAL_JUDGE_RULES);
  assert.equal(flagshipJudgeRules(null), null);

  let asked: any = null;
  await judgeDraftRules(async (task: ModelTask<any>) => { asked = task; throw new ChausarError('MODEL_OUTPUT_REJECTED', 'Stop here.'); }, {
    draft: 'A draft.', clientRequest: 'A request.', context: 'A practice client.', containsClientData: false, rules: YOUTUBE_DRAFT_RULES,
  });
  assert.ok(JSON.stringify(asked.input).includes('faithful-to-source'), 'the rules judge is asked the playbook\'s rules');
});

test('the team shows the playbook\'s roles as the agents; a gate set on a role\'s step is the one the policy reads', async () => {
  const env = await business(YOUTUBE_IDEA);
  await env.call('venture.delivery.playbook');
  const { agents } = await env.call('venture.team.list');
  const delivery = flagshipDelivery('youtube')!;
  // Ink v2 wave 4 (4A1): Keeper, the engine's own jobs as code, is listed after the playbook's roles.
  assert.deepEqual(agents.map((agent: any) => agent.name), [...delivery.roles.map(role => role.name), 'Keeper']);
  assert.deepEqual(agents.map((agent: any) => agent.name), ['Intake clerk', 'Producer', 'Chausar', 'Story editor', 'Packager', 'Keeper']);
  const editor = agents.find((agent: any) => agent.name === 'Story editor');
  assert.deepEqual(editor.steps.map((step: any) => step.id), ['find']);
  const intake = agents.find((agent: any) => agent.name === 'Intake clerk');
  assert.equal(intake.steps.find((step: any) => step.id === 'intake').floor, true, 'rights at intake ask at every posture');
  await assert.rejects(env.call('venture.team.gate', { agentId: intake.id, stepId: 'intake', gate: 'auto' }), code('GATE_FLOOR'));
  await assert.rejects(env.call('venture.team.gate', { agentId: editor.id, stepId: 'package', gate: 'auto' }), code('STEP_NOT_FOUND'), 'a role sets only its own steps');
  const after = await env.call('venture.team.gate', { agentId: editor.id, stepId: 'find', gate: 'auto' });
  assert.equal(after.agent.name, 'Story editor');
  assert.equal(after.agent.steps[0].gate, 'auto');
  const state = env.store.read();
  const playbook: PlaybookRecord = (state.conversations as any[]).filter(record => record.kind === 'venture-playbook').at(-1);
  const ventureId = playbook.ventureId;
  assert.equal(stepGates(state, ventureId, playbook.steps, AGENT_ID).find, 'auto', 'the harness reads the gate the role set');
  const posture = await env.call('venture.team.posture', { agentId: editor.id, posture: 'rehearsal' });
  assert.equal(posture.agent.posture, 'rehearsal');
  const team = await env.call('venture.team.list');
  assert.ok(team.agents.every((agent: any) => agent.posture === 'rehearsal'), 'one harness agent runs every role, so the posture is the team\'s');
});

test('transcripts: an SRT or VTT file joins an order as a transcript, and one with no timed lines or not in UTF-8 is refused', async () => {
  const env = await business(YOUTUBE_IDEA);
  const order = await env.call('venture.order.create', { clientId: env.client.id, offerId: 'offer_1', request: 'One episode.', intake: { rights: OWN_FOOTAGE } });
  const add = (name: string, content: string | Buffer) => env.call('venture.files.add', { orderId: order.id, name, contentBase64: Buffer.from(content).toString('base64') });
  const srt = await add('episode.srt', '1\n00:00:00,000 --> 00:00:04,000\nWhy your savings shrink.\n\n2\n00:00:04,500 --> 00:00:09,000\nHere is how to stop it.\n');
  assert.equal(srt.format, 'transcript');
  const vtt = await add('episode.VTT', 'WEBVTT\n\n00:00.000 --> 00:04.000\nWhy your savings shrink.\n');
  assert.equal(vtt.format, 'transcript');
  assert.equal('contentBase64' in vtt, false);
  await assert.rejects(add('notes.srt', 'Just some notes, no timings.'), code('UNSUPPORTED_UPLOAD'));
  await assert.rejects(add('episode.vtt', Buffer.from([0xff, 0xfe, 0x00, 0x41])), code('UNSUPPORTED_UPLOAD'));
  const listed = await env.call('venture.files.list', { orderId: order.id });
  assert.deepEqual(listed.map((file: any) => file.format), ['transcript', 'transcript']);
});

test('the plan read from Today says how the work is done with the playbook\'s own steps and who does each', async () => {
  const env = await business(YOUTUBE_IDEA);
  const plan = (await env.call('venture.blueprint.get')).blueprint;
  const item = await env.call('venture.queue.view', { id: plan.id, kind: 'plan' });
  const how = item.sections.find((section: any) => section.heading === 'How the work is done');
  assert.equal(how.lines.length, flagshipDelivery('youtube')!.steps.length);
  assert.equal(how.lines[0], `${YOUTUBE_STEPS[0].title}: the Intake clerk, an agent.`);
  assert.ok(how.lines.includes(`${YOUTUBE_STEPS.find(step => step.id === 'probe')!.title}: Chausar, in code with no AI.`));
  assert.ok(how.lines.includes(`${YOUTUBE_STEPS.find(step => step.id === 'review')!.title}: you.`));
  const ca = await business(CA_IDEA);
  const caPlan = (await ca.call('venture.blueprint.get')).blueprint;
  const caHow = (await ca.call('venture.queue.view', { id: caPlan.id, kind: 'plan' })).sections.find((section: any) => section.heading === 'How the work is done');
  assert.ok(caHow.lines.includes(`${CA_STEPS.find(step => step.id === 'ca-signoff')!.title}: CA of record.`));
});
