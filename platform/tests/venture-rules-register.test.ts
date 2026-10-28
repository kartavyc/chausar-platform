// Dated platform rules wired into runs and on screen (Ink v2 wave 2, package 2H; catalogue P1). Every rule in the
// social and YouTube registers names the playbook steps or checks that use it (usedBy) and what it does not cover
// (limitations); a rule naming a step or check its playbook does not have is refused. Each playbook registration
// carries a risk level and the day it was last reviewed. venture.rules.list shows the rules with their freshness, and
// a draft's checks include rules-current: not run, never a pass, once a rule its checks rest on is past its window.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ChausarError, type Context } from '../runtime/contracts.ts';
import { CalculatorService } from '../runtime/calculator.ts';
import { OntologyService, starterPacks } from '../runtime/ontology.ts';
import { TrustService } from '../runtime/trust.ts';
import type {
  DeliveryRunView, ModelOutcome, ModelPort, ModelPreview, ModelStatusView, ModelTask, RulesListView, SecretShelf, VentureDeps, VentureMethod,
} from '../runtime/venture/contracts.ts';
import { digest, houseStyleFindings, doneClaimFindings, ventureAction } from '../runtime/venture/records.ts';
import { handlers as coreHandlers } from '../runtime/venture/core/index.ts';
import { handlers as moneyHandlers } from '../runtime/venture/money/index.ts';
import { handlers as deliveryHandlers } from '../runtime/venture/delivery/index.ts';
import { handlers as viewHandlers } from '../runtime/venture/views/index.ts';
import { PLAYBOOK_REGISTRY, validateRegistry } from '../runtime/venture/playbooks/registry.ts';
import { CA_FIRM_REGISTRATION } from '../runtime/venture/playbooks/ca-firm/registration.ts';
import { SOCIAL_RULES_REGISTER, platformRule as socialRule, socialRuleTargets, validateRulesRegister } from '../runtime/venture/playbooks/social/register.ts';
import { CHANNEL_CAPABILITIES, type SocialChannel } from '../runtime/venture/playbooks/social/channels.ts';
import { SOCIAL_CHECK_IDS, checkSocialDraft, type PostDraft } from '../runtime/venture/playbooks/social/checks.ts';
import { postingRisk } from '../runtime/venture/playbooks/social/risk-gate.ts';
import { POSTING_CONNECTORS } from '../runtime/venture/build/posting.ts';
import { runFlagshipChecks, type FlagshipCheckInput } from '../runtime/venture/playbooks/draft-checks.ts';
import { SOCIAL_RUN_CHECK_IDS } from '../runtime/venture/playbooks/social/check-ids.ts';
import { EXPORT_PROFILES } from '../runtime/venture/playbooks/social/report.ts';
import { SOCIAL_STEPS } from '../runtime/venture/playbooks/social/playbook.ts';
import {socialStages} from '../runtime/venture/playbooks/social/stages.ts';
import {socialDraftPosts} from '../runtime/venture/playbooks/social/draft-posts.ts';
import {HOOK_FORMULAS} from '../runtime/venture/playbooks/social/post-plan.ts';
import { PLATFORM_RULES, platformRule as youtubeRule, validatePlatformRules } from '../runtime/venture/playbooks/youtube/platform-rules.ts';
import { YOUTUBE_STEPS } from '../runtime/venture/playbooks/youtube/playbook.ts';
import { VentureTestStore } from './venture-test-store.ts';

const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected, error?.message); return true; };
const YOUTUBE_IDEA = 'Run a YouTube channel that explains personal finance in plain words';
const CA_IDEA = 'An AI-native CA firm for GST filing and income tax returns in Pune';
const SOCIAL_IDEA = 'A content calendar service for yoga studios in Goa';
const PLAIN_IDEA = 'Monthly bookkeeping for cafes and small shops in Pune.';
const OWN_FOOTAGE = { basis: 'own-footage', holder: 'Asha Rao' };
const CHECKED = '2026-10-21T10:00:00.000Z';
/** More than ninety days after 21 October 2026, the day every shipped rule was checked. */
const LATER = '2027-02-01T10:00:00.000Z';

// ---------------------------------------------------------------------------
// The registers and the registry
// ---------------------------------------------------------------------------

test('social register: every rule names the steps or checks that use it and what it does not cover', () => {
  validateRulesRegister();
  // The draft's own social checks beyond checks.ts (calendar-slots, narrative-receipted; Ink v2 2F1) count too.
  const targets = new Set<string>([...SOCIAL_STEPS.map(step => step.id), ...SOCIAL_CHECK_IDS, ...SOCIAL_RUN_CHECK_IDS]);
  for (const rule of SOCIAL_RULES_REGISTER) {
    assert.ok(rule.usedBy.length > 0 && rule.usedBy.every(id => targets.has(id)), rule.id);
    assert.ok(rule.limitations.length > 0 && rule.limitations.every(line => line.trim().length > 0), rule.id);
    for (const line of rule.limitations) {
      assert.deepEqual(houseStyleFindings(line), [], line);
      assert.deepEqual(doneClaimFindings(line), [], line);
    }
  }
  const first = SOCIAL_RULES_REGISTER[0];
  const { usedBy: _usedBy, ...noUsedBy } = first;
  const { limitations: _limitations, ...noLimits } = first;
  assert.throws(() => validateRulesRegister([noUsedBy as never]), code('INVALID_VENTURE_REQUEST'));
  assert.throws(() => validateRulesRegister([{ ...first, usedBy: [] }]), code('INVALID_VENTURE_REQUEST'));
  assert.throws(() => validateRulesRegister([{ ...first, usedBy: ['no-such-step'] }]), (error: any) => error?.code === 'INVALID_VENTURE_REQUEST' && /no-such-step/.test(error.message));
  assert.throws(() => validateRulesRegister([noLimits as never]), code('INVALID_VENTURE_REQUEST'));
  assert.throws(() => validateRulesRegister([{ ...first, limitations: [' '] }]), code('INVALID_VENTURE_REQUEST'));
  // A step id and a check id both count; the posting house rules of package 2B1 name the publish step.
  assert.doesNotThrow(() => validateRulesRegister([{ ...first, usedBy: ['publish'] }]));
  assert.doesNotThrow(() => validateRulesRegister([{ ...first, usedBy: ['channel-length', 'drafts'] }]));
});

test('social register: a rule a check quotes is used by that check, so a changed rule lists what it touches', () => {
  const usedBy = (id: string) => socialRule(id).usedBy;
  for (const channel of Object.values(CHANNEL_CAPABILITIES)) {
    assert.ok(usedBy(channel.charsRule).includes('channel-length'), channel.charsRule);
    if (channel.hashtagsRule) assert.ok(usedBy(channel.hashtagsRule).includes('channel-hashtags'), channel.hashtagsRule);
    for (const id of channel.media.rules) assert.ok(usedBy(id).includes('channel-media'), id);
    if (channel.paidToggle) assert.ok(usedBy(channel.paidToggle.rule).includes('disclosure-paid'), channel.paidToggle.rule);
    if (channel.aiToggle) assert.ok(usedBy(channel.aiToggle.rule).includes('disclosure-ai'), channel.aiToggle.rule);
  }
  const quoted: Record<string, string[]> = {
    'x-url-23': ['channel-length'], 'ig-caption-fold-125': ['disclosure-paid', 'disclosure-ai'], 'ig-carousel-api-10': ['channel-media'],
    'alt-text-house': ['alt-text'], 'claims-house': ['claims'], 'asci-influencer-label': ['disclosure-paid'],
    'india-it-rules-sgi-2026': ['disclosure-ai'], 'ftc-reviews-rule': ['synthetic-testimonial'], 'meta-engagement-bait': ['engagement-bait'],
  };
  for (const [id, checks] of Object.entries(quoted)) for (const check of checks) assert.ok(usedBy(id).includes(check), `${id} ${check}`);
  for (const profile of Object.values(EXPORT_PROFILES)) assert.ok(usedBy(profile.ruleId).includes('figures'), profile.ruleId);
  // social.report reads the exports for the report step, and the narrative check holds the report's words to them.
  for (const profile of Object.values(EXPORT_PROFILES)) {
    for (const id of ['report', 'narrative-receipted']) assert.ok(usedBy(profile.ruleId).includes(id), `${profile.ruleId} ${id}`);
  }
  assert.doesNotThrow(() => validateRulesRegister([{ ...socialRule('claims-house'), usedBy: ['calendar-slots'] }]), 'the calendar check is a check a rule may name');
  assert.doesNotThrow(() => validateRulesRegister([{ ...socialRule('claims-house'), usedBy: ['narrative-receipted'] }]), 'and so is the report narrative check');
  assert.ok(socialRuleTargets().has('calendar-slots') && socialRuleTargets().has('narrative-receipted'));
});

test('social register: the rules posting and the risk gate read name publish; the thread split names drafts; no empty claims', () => {
  const usedBy = (id: string) => socialRule(id).usedBy;
  // posting.ts holds each post to its channel's length (PROFILES maxChars) and refuses a thread on X by its weighted count.
  const posting: Record<string, string> = { linkedin: 'linkedin-3000', x: 'x-weighted-280', instagram: 'ig-caption-2200', youtube: 'yt-description-5000' };
  assert.deepEqual(Object.keys(posting).sort(), [...POSTING_CONNECTORS].sort());
  for (const id of [...Object.values(posting), 'x-url-23']) assert.ok(usedBy(id).includes('publish'), id);
  // The risk gate blocks on the hashtag cap and engagement bait: every platform rule it quotes names publish.
  const risk = (channel: SocialChannel, text: string) => postingRisk({ channel, name: channel, text, now: CHECKED, history: [] }).findings;
  const gate = [...risk('instagram', 'Morning yoga #a #b #c #d #e #f'), ...risk('threads', 'Morning yoga #a #b'), ...risk('linkedin', 'Tag a friend who needs a calm morning.')];
  const quoted = new Set(gate.map(item => item.ruleId));
  for (const id of ['ig-hashtags-5', 'threads-topic-1', 'meta-engagement-bait']) assert.ok(quoted.has(id), id);
  for (const id of quoted) assert.ok(usedBy(id).includes('publish'), id);
  // The drafts step's text is split into threads by code (post-lines.ts threadParts), by the channel's length and X's link count.
  for (const channel of Object.values(CHANNEL_CAPABILITIES).filter(item => item.thread)) assert.ok(usedBy(channel.charsRule).includes('drafts'), channel.charsRule);
  assert.ok(usedBy('x-url-23').includes('drafts'));
  // social.report reads the exports at intake.
  for (const profile of Object.values(EXPORT_PROFILES)) assert.ok(usedBy(profile.ruleId).includes('intake'), profile.ruleId);
  // Nothing in these steps reads these rules, so they do not claim them.
  for (const id of ['ig-carousel-app-20', 'ig-image-aspect', 'ig-reels-180', 'yt-shorts-180']) assert.ok(!usedBy(id).includes('creative-briefs'), id);
  for (const id of ['ig-caption-2200', 'linkedin-3000', 'ig-hashtags-5', 'yt-description-5000']) assert.ok(!usedBy(id).includes('drafts'), id);
});

test('social register: every rule a check quotes on a real draft is used by that check', () => {
  const usedBy = (id: string) => socialRule(id).usedBy;
  const image = (width: number, height: number, altText?: string) => ({ kind: 'image' as const, width, height, ...(altText ? { altText } : {}) });
  const video = (width: number, height: number, seconds: number) => ({ kind: 'video' as const, width, height, seconds });
  const images = (count: number) => Array.from({ length: count }, () => image(1080, 1080, 'A calm room.'));
  const ai = { person: true, voice: true };
  const drafts: { draft: PostDraft; mode?: 'api' }[] = [
    { draft: { id: 'p1', channel: 'linkedin', text: 'a '.repeat(1600), media: images(21) } },
    { draft: { id: 'p2', channel: 'x', text: `${'b'.repeat(270)} https://example.com/a-long-page`, media: images(5) } },
    { draft: { id: 'p3', channel: 'facebook', text: 'c'.repeat(63300) } },
    { draft: { id: 'p4', channel: 'threads', text: `${'d'.repeat(510)} #a #b`, media: images(21) } },
    { draft: { id: 'p5', channel: 'tiktok', text: 'e'.repeat(2300), paid: true, ai, platformLabels: {} } },
    { draft: { id: 'p6', channel: 'tiktok', text: 'Made with AI. Ad. Morning yoga.', media: [video(1080, 1920, 700)] } },
    { draft: { id: 'p7', channel: 'youtube-shorts', text: 'f'.repeat(101), paid: true, ai, platformLabels: {} } },
    { draft: { id: 'p8', channel: 'youtube-shorts', text: 'Ad. Made with AI. Morning yoga.', media: [video(1920, 1080, 200)] } },
    { draft: { id: 'p9', channel: 'instagram', text: `Morning yoga in Goa. ${'g'.repeat(130)} Ad. Made with AI. I tried this class. Tag a friend who needs it. Rated 4.9 by 1,200 students. #a #b #c #d #e #f`, paid: true, ai, platformLabels: {}, media: [image(1000, 3000), video(1080, 1920, 200), ...images(19)] } },
    { draft: { id: 'p10', channel: 'instagram', text: 'Morning yoga.', media: images(11) }, mode: 'api' },
    { draft: { id: 'p11', channel: 'instagram', text: 'Morning yoga.', paid: true, ai: { person: true } } },
  ];
  const findings = drafts.flatMap(({ draft, mode }) => checkSocialDraft(draft, { proofFiles: [] }, mode ? { mode } : {}).findings);
  const quoted = findings.filter(item => item.ruleId !== null);
  for (const item of quoted) assert.ok(usedBy(item.ruleId!).includes(item.check), `${item.ruleId} is quoted by ${item.check}`);
  const checks = new Set(quoted.map(item => item.check));
  for (const id of ['channel-length', 'channel-hashtags', 'channel-media', 'alt-text', 'claims', 'disclosure-paid', 'disclosure-ai', 'synthetic-testimonial', 'engagement-bait']) {
    assert.ok(checks.has(id as never), `a draft above trips ${id}`);
  }
  assert.ok(new Set(quoted.map(item => item.ruleId)).size >= 25, 'most of the register is quoted by some draft above');
});

test('YouTube rules: each names the steps or checks that use it and what it does not cover', () => {
  assert.doesNotThrow(() => validatePlatformRules(PLATFORM_RULES));
  const targets = new Set<string>([...YOUTUBE_STEPS.map(step => step.id), ...YOUTUBE_STEPS.flatMap(step => step.youtubeChecks)]);
  for (const rule of PLATFORM_RULES) {
    assert.ok(rule.usedBy.length > 0 && rule.usedBy.every(id => targets.has(id)), rule.id);
    assert.ok(rule.limitations.length > 0, rule.id);
    for (const line of rule.limitations) assert.deepEqual(houseStyleFindings(line), [], line);
  }
  assert.ok(youtubeRule('chapters').usedBy.includes('chapters'));
  assert.ok(youtubeRule('chapters').usedBy.includes('find'), 'the find step drafts chapters with youtube.chapters');
  assert.ok(youtubeRule('metadata-limits').usedBy.includes('metadata-limits') && youtubeRule('metadata-limits').usedBy.includes('title-thumbnail'));
  assert.ok(youtubeRule('shorts-length').usedBy.includes('finishing'));
  const chapters = youtubeRule('chapters');
  const { usedBy: _usedBy, ...noUsedBy } = chapters;
  assert.throws(() => validatePlatformRules([noUsedBy as never]), /used by/);
  assert.throws(() => validatePlatformRules([{ ...chapters, usedBy: [] }]), /used by/);
  assert.throws(() => validatePlatformRules([{ ...chapters, usedBy: ['no-such-check'] }]), /no-such-check/);
  assert.throws(() => validatePlatformRules([{ ...chapters, limitations: [] }]), /limitations/);
});

test('registry: every playbook carries a risk level and the day it was last reviewed', () => {
  validateRegistry();
  for (const entry of PLAYBOOK_REGISTRY) {
    assert.ok(['low', 'medium', 'high'].includes(entry.riskLevel), entry.id);
    assert.match(entry.lastReviewed, /^\d{4}-\d{2}-\d{2}$/, entry.id);
  }
  assert.equal(CA_FIRM_REGISTRATION.riskLevel, 'high', 'regulated tax work');
  const { riskLevel: _risk, ...noRisk } = CA_FIRM_REGISTRATION;
  const { lastReviewed: _reviewed, ...noReview } = CA_FIRM_REGISTRATION;
  assert.throws(() => validateRegistry([noRisk as never]), /risk level/);
  assert.throws(() => validateRegistry([{ ...CA_FIRM_REGISTRATION, riskLevel: 'extreme' as never }]), /risk level/);
  assert.throws(() => validateRegistry([noReview as never]), /last reviewed/);
  assert.throws(() => validateRegistry([{ ...CA_FIRM_REGISTRATION, lastReviewed: '2026-02-30' }]), /last reviewed/);
});

// ---------------------------------------------------------------------------
// A business, through the engine's own methods
// ---------------------------------------------------------------------------

type Draft = { title: string; sections: { heading: string; parts: { kind: 'text'; text: string; ref: '' }[] }[]; questionsForClient: string[] };
const draft = (title: string, sections: Record<string, string[]>): Draft => ({
  title, questionsForClient: [], sections: Object.entries(sections).map(([heading, lines]) => ({ heading, parts: lines.map(text => ({ kind: 'text' as const, text, ref: '' as const })) })),
});

/** Both tiers are an AI. A preview holds for thirty minutes from the engine clock; approving it answers with the next queued draft. */
class Port implements ModelPort {
  drafts: unknown[] = [];
  #calls = 0;
  #previews = new Map<string, string>();
  readonly now: () => Date;
  constructor(now: () => Date) { this.now = now; }
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
    if (task.purpose !== 'delivery') {
      if (!task.template) throw new ChausarError('NO_MODEL_CONNECTED', 'No template.');
      return { value: task.template(), by: 'template', callId: null, presetId: 'built-in-templates', model: null, costMicros: '0', priceConfirmed: true };
    }
    this.#calls += 1;
    return { value: task.validate(this.drafts.shift()), by: 'model', callId: `call_${this.#calls}`, presetId: 'anthropic-sonnet-5-5', model: 'stub', costMicros: '10', priceConfirmed: true };
  }
  async preview<T>(_ctx: Context, task: ModelTask<T>): Promise<ModelPreview | null> {
    this.#calls += 1;
    const callId = `call_${this.#calls}`;
    const payloadText = JSON.stringify({ system: task.instructions, input: task.input });
    this.#previews.set(callId, digest(payloadText));
    return {
      callId, payloadText, digest: digest(payloadText), presetId: 'anthropic-sonnet-5-5', model: 'claude-sonnet-5-5', endpoint: 'https://api.anthropic.com/v1/messages',
      estimatedMaxCostMicros: '1000', estimatedMaxCostDisplay: 'USD 0.0010', expiresAt: new Date(this.now().getTime() + 30 * 60_000).toISOString(),
    };
  }
  async runPreview<T>(_ctx: Context, callId: string, approved: string, validate: (raw: unknown) => T): Promise<ModelOutcome<T>> {
    if (this.#previews.get(callId) !== approved) throw new ChausarError('APPROVAL_STALE', 'Run it again.');
    this.#previews.delete(callId);
    return { value: validate(this.drafts.shift()), by: 'model', callId, presetId: 'anthropic-sonnet-5-5', model: 'stub', costMicros: '10', priceConfirmed: true };
  }
}

const HANDLERS = { ...coreHandlers, ...moneyHandlers, ...deliveryHandlers, ...viewHandlers } as Record<string, (deps: VentureDeps, ctx: Context, payload: unknown) => Promise<any>>;

/** A business from an idea on the template route: every offer priced, the plan accepted, at approve each, one client. */
async function business(idea: string) {
  const store = new VentureTestStore();
  const ontology = new OntologyService(store), calculator = new CalculatorService(store), trust = new TrustService(store);
  const pack = structuredClone(starterPacks.find(item => item.pack === 'services')!);
  pack.currency = 'INR';
  pack.gstMode = 'unregistered';
  for (const definition of pack.definitions) definition.currency = 'INR';
  await ontology.publish(owner, pack);
  const clock = { at: CHECKED };
  const models = new Port(() => new Date(clock.at));
  const secrets = { get: () => null, set: () => undefined, delete: () => undefined, has: () => false, clear: () => undefined } as unknown as SecretShelf;
  const deps: VentureDeps = {
    store, clock: () => new Date(clock.at), models, services: { calculator, ontology, trust },
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
  const priced = await call('venture.blueprint.update', { patch: { offers: drafted.blueprint.offers.map((offer: any) => ({ id: offer.id, unitPrice: '1000' })) } });
  await call('venture.blueprint.accept', { digest: priced.blueprint.digest });
  await ventureAction(deps, owner, 'approve', 'seed.stage', tx => { tx.touch({ launchStage: 'approve-each' }); });
  const client = await call('venture.client.add', { name: 'Asha Rao', email: 'asha@example.com', countryCode: 'IN' });
  return { deps, call, models, client, clock, idea, offers: priced.blueprint.offers as {id:string;playbookOffer?:string}[] };
}

/** One draft for one order: delivery.run previews, delivery.approve answers with the queued draft. */
async function deliver(env: Awaited<ReturnType<typeof business>>, orderId: string, answer: Draft): Promise<DeliveryRunView> {
  let waiting = await env.call('venture.delivery.run', { orderId });
  assert.equal(waiting.status, 'waiting-for-you');
  if(env.idea===SOCIAL_IDEA){
    const order=(env.deps.store.read().conversations as any[]).find(row=>row.kind==='venture-order'&&row.id===orderId);
    const stages=socialStages(env.offers.find(offer=>offer.id===order.offerId)?.playbookOffer);
    while((waiting.chainStage??1)<stages.length){
      const stage=waiting.chainStage??1;
      env.models.drafts.push(draft(stage===1?'Voice sheet':'Calendar',Object.fromEntries((stage===1?['Voice','Pillars','Words to avoid']:['Calendar','Topics and hooks']).map(heading=>[heading,['Clear, useful guidance for the studio.']]))));
      const ready=await env.call('venture.delivery.approve',{runId:waiting.id,digest:waiting.preview.digest});
      await env.call('venture.delivery.review',{runId:ready.id,verdict:'accepted'});
      waiting=(env.deps.store.read().conversations.filter((row:any)=>row.kind==='venture-delivery-run'&&row.orderId===orderId) as any[]).at(-1)!;
    }
    const copy=structuredClone(answer),count=socialDraftPosts(copy as never).length;
    copy.sections.push(...draft('Plan',{'Post plan':Array.from({length:count},(_,i)=>`Post ${i+1} | Value | Goal: Teach useful practice | Reader action: Try it | Hook: ${HOOK_FORMULAS[i%HOOK_FORMULAS.length]}`)}).sections);
    env.models.drafts.push(copy);
  }else env.models.drafts.push(answer);
  return env.call('venture.delivery.approve', { runId: waiting.id, digest: waiting.preview.digest });
}

// ---------------------------------------------------------------------------
// venture.rules.list
// ---------------------------------------------------------------------------

test('venture.rules.list: a social business sees every rule with its date, freshness, use, limits and source', async () => {
  const env = await business(SOCIAL_IDEA);
  const view: RulesListView = await env.call('venture.rules.list');
  assert.deepEqual(view.playbook, { id: 'social-agency', label: 'Social media agency', riskLevel: 'medium', lastReviewed: '2026-10-23' });
  assert.equal(view.rules.length, SOCIAL_RULES_REGISTER.length);
  for (const rule of view.rules) {
    const source = socialRule(rule.id);
    // The platform rules were checked on 21 October 2026; Chausar's own posting limits (2B1) were set on 23 October.
    assert.equal(rule.checkedOn, source.checkedOn, rule.id);
    assert.equal(rule.stale, false, rule.id);
    assert.equal(rule.platform, source.scope);
    assert.equal(rule.rule, source.rule);
    assert.deepEqual(rule.usedBy, source.usedBy);
    assert.deepEqual(rule.limitations, source.limitations);
    assert.deepEqual(rule.source, source.sources[0] ?? null, rule.id);
    assert.ok(rule.line.length > 0, rule.id);
  }
  assert.equal(view.rules.find(rule => rule.id === 'claims-house')!.source, null, 'a house rule has no outside source');
  const unconfirmed = view.rules.find(rule => rule.id === 'threads-topic-1')!;
  assert.match(unconfirmed.line, /not confirmed against a source/);
  // Three counts apart: current and confirmed, past the window, and inside it but not confirmed against a source.
  const unsure = SOCIAL_RULES_REGISTER.filter(rule => rule.read === 'unconfirmed').length;
  assert.equal(view.summary, `${SOCIAL_RULES_REGISTER.length - unsure} current, 0 to recheck, ${unsure} not confirmed against a source yet.`);

  env.clock.at = LATER;
  const later: RulesListView = await env.call('venture.rules.list', {});
  assert.ok(later.rules.every(rule => rule.stale), 'every rule was checked on 21 October 2026');
  assert.match(later.rules.find(rule=>rule.id==='claims-house')!.line, /103 days ago, on 2026-10-21/);
  assert.equal(later.summary, `0 current, ${SOCIAL_RULES_REGISTER.length} to recheck.`, 'a stale rule counts once, as one to recheck');
  await assert.rejects(env.call('venture.rules.list', { playbook: 'youtube' }), code('INVALID_VENTURE_REQUEST'));
});

test('venture.rules.list: a YouTube business sees its rules from the YouTube register; no playbook, no rules', async () => {
  const env = await business(YOUTUBE_IDEA);
  const view: RulesListView = await env.call('venture.rules.list');
  assert.deepEqual(view.playbook, { id: 'youtube', label: 'YouTube channel', riskLevel: 'medium', lastReviewed: '2026-10-23' });
  assert.deepEqual(view.rules.map(rule => rule.id), PLATFORM_RULES.map(rule => rule.id));
  const chapters = view.rules.find(rule => rule.id === 'chapters')!;
  assert.equal(chapters.platform, 'youtube');
  assert.match(chapters.rule, /^Video chapters added by hand: /);
  assert.deepEqual(chapters.source, { title: 'Video Chapters, YouTube Help', url: 'https://support.google.com/youtube/answer/9884579' });
  assert.deepEqual(chapters.usedBy, youtubeRule('chapters').usedBy);
  assert.equal(chapters.stale, false);
  assert.equal(view.summary, `${PLATFORM_RULES.length} current, 0 to recheck.`);
  env.clock.at = LATER;
  const later: RulesListView = await env.call('venture.rules.list');
  assert.equal(later.rules.find(rule => rule.id === 'chapters')!.stale, true);
  assert.match(later.rules.find(rule => rule.id === 'chapters')!.line, /^Video chapters added by hand was checked 103 days ago, on 2026-10-21\./);
  assert.equal(later.summary, `0 current, ${PLATFORM_RULES.length} to recheck.`);

  const plain = await business(PLAIN_IDEA);
  const none: RulesListView = await plain.call('venture.rules.list');
  assert.equal(none.playbook, null);
  assert.deepEqual(none.rules, []);
  assert.match(none.summary, /no playbook/i);

  const ca = await business(CA_IDEA);
  const firm: RulesListView = await ca.call('venture.rules.list');
  assert.equal(firm.playbook!.id, 'ca-firm');
  assert.equal(firm.playbook!.riskLevel, 'high');
  assert.deepEqual(firm.rules.map(rule=>rule.id), ['ca-cash-payment','ca-cash-receipt','ca-gst-invoice','ca-tds-thresholds']);
  assert.ok(firm.rules.every(rule=>rule.source&&rule.sources.length>0&&rule.line.includes('CA')&&rule.line.includes('confirms')),'client work still requires the CA to confirm each dated source');
});

// ---------------------------------------------------------------------------
// rules-current on a draft's checks
// ---------------------------------------------------------------------------

const PACKAGE = draft('Episode package: hidden bank fees', {
  Summary: ['Hook: Why your savings shrink before you notice, and how to stop it.', 'Hook: Your bank charges you for things you never asked for. Here is how to stop it.', 'A plain episode on the bank fees the client asked about.'],
  'Title and thumbnail': ['Title: Hidden bank fees cost you 5 things a year', 'Thumbnail: STOP PAYING THIS'],
  'Description and chapters': ['Description: A plain guide to the bank fees the client named, and how to stop paying them.', '0:00 Why fees matter', '1:30 The fees to check', '4:00 How to stop them'],
  'Next steps': ['You watch the cut, then you or the client publish it.'],
});
const PACKAGE_REQUEST = 'One episode on hidden bank fees from my raw footage. My edit notes: the 5 fees, thumbnail STOP PAYING THIS, chapters at 0:00, 1:30 and 4:00.';

const resultsOf = (run: DeliveryRunView) => Object.fromEntries((run.playbookChecks ?? []).map(item => [item.check, item]));

test('a YouTube draft: rules-current passes inside the window and says which rules to recheck after it, never blocking Accept', async () => {
  const env = await business(YOUTUBE_IDEA);
  const order = await env.call('venture.order.create', { clientId: env.client.id, offerId: 'offer_1', request: PACKAGE_REQUEST, intake: { rights: OWN_FOOTAGE, format: 'long' } });
  const fresh = await deliver(env, order.id, PACKAGE);
  const now = resultsOf(fresh)['rules-current'];
  assert.ok(now, 'the draft checks carry rules-current');
  assert.equal(now.playbook, 'youtube');
  assert.equal(now.outcome, 'pass', now.detail);
  assert.equal(now.detail, '5 rules checked within 90 days.', 'the YouTube rules are all confirmed against their pages');
  assert.equal(fresh.canAccept, true, fresh.acceptBlocked ?? '');

  env.clock.at = LATER;
  const second = await env.call('venture.order.create', { clientId: env.client.id, offerId: 'offer_1', request: PACKAGE_REQUEST, intake: { rights: OWN_FOOTAGE, format: 'long' } });
  const late = await deliver(env, second.id, PACKAGE);
  const stale = resultsOf(late)['rules-current'];
  assert.equal(stale.outcome, 'not-run');
  assert.match(stale.detail, /^not run: 5 rules past their 90-day recheck: .*Video chapters added by hand.*; plus \d more\. Recheck them\.$/);
  assert.ok(stale.detail.length <= 147, `the line fits the run view's label: ${stale.detail.length}`);
  assert.doesNotMatch(stale.detail, /How long a Short can be/, 'the finishing check did not run, so the Shorts rule is not named');
  assert.doesNotMatch(stale.detail, /Uploads through the YouTube API/, 'a rule only the publish step uses is not a check this draft ran');
  assert.equal(late.canAccept, true, 'a stale rule asks for a recheck; it does not block Accept');
  const detail = await env.call('venture.runs.get', { runId: late.id });
  const verify = detail.steps.find((step: any) => step.id === 'verify');
  const shown = verify.evidence.find((item: any) => item.id === 'youtube:rules-current');
  assert.ok(shown, 'the run shows the rule freshness with its checks');
  // 4J14 (Q7): a check that could not run reads "Not run" from the one table, its own "not run:" not said twice.
  assert.match(shown.label, /^Not run: 5 rules past their 90-day recheck: .*\. Recheck them\.$/, 'the whole line survives the label cut');
});

test('a social draft: rules-current covers the rules its checks rest on, and goes not run after ninety days', async () => {
  const env = await business(SOCIAL_IDEA);
  const posts = draft('Posts for the month', {
    Drafts: ['Instagram: Morning yoga in Goa, slow and steady. Come as you are.', 'X: Morning yoga in Goa. Breathe first, then move.'],
    'Alt text': ['A calm room with yoga mats in the morning light.'],
    Hashtags: ['Use #yoga and #goa on every post.'],
  });
  const order = await env.call('venture.order.create', { clientId: env.client.id, offerId: 'offer_1', request: 'Posts for our morning yoga classes in Goa.' });
  const fresh = await deliver(env, order.id, posts);
  const now = resultsOf(fresh)['rules-current'];
  assert.equal(now.playbook, 'social-agency');
  assert.equal(now.outcome, 'pass', now.detail);
  assert.match(now.detail, /^\d+ rules checked within 90 days, and \d+ not confirmed against a source yet: .*\.$/, 'unconfirmed rules are counted apart and named');
  assert.ok(now.detail.length <= 147, now.detail);
  assert.equal(fresh.canAccept, true, fresh.acceptBlocked ?? '');

  env.clock.at = LATER;
  const second = await env.call('venture.order.create', { clientId: env.client.id, offerId: 'offer_1', request: 'Posts for our morning yoga classes in Goa.' });
  const late = await deliver(env, second.id, posts);
  const stale = resultsOf(late)['rules-current'];
  assert.equal(stale.outcome, 'not-run');
  assert.match(stale.detail, /^not run: \d+ rules past their 90-day recheck: X post length; /, 'the channel length check ran on the X post');
  assert.match(stale.detail, /; plus \d+ more\. Recheck them\.$/, 'a long list names the first few and counts the rest');
  assert.ok(stale.detail.length <= 147, stale.detail);
  assert.doesNotMatch(stale.detail, /export/, 'the report figures rules belong to a step this draft did not run');
  assert.equal(late.canAccept, true, late.acceptBlocked ?? '');
});

/** A social draft's own checks on a day, straight through runFlagshipChecks. */
async function socialRun(lines: Record<string, string[]>, extra: Partial<FlagshipCheckInput> = {}) {
  const results = await runFlagshipChecks({
    flagship: 'social-agency', offerKey: 'content-calendar', servedBy: 'model', deliverable: draft('Posts', lines) as never,
    request: 'Posts for our morning yoga classes in Goa.', intake: null, files: [], receipts: [], known: ['Goa'], mode: 'client',
    today: '2027-01-25', dateOrder: 'day-month-year', ...extra,
  });
  return Object.fromEntries(results.map(item => [item.check, item]));
}

test('rules-current on a social draft names only the rules for its channels, and the rules a finding quoted come first', async () => {
  const linkedin = (await socialRun({ Drafts: ['LinkedIn: Morning yoga in Goa. Breathe first, then move.'] }))['rules-current'];
  assert.equal(linkedin.outcome, 'not-run');
  assert.match(linkedin.detail, /LinkedIn post length/);
  assert.doesNotMatch(linkedin.detail, /Instagram|TikTok|X post length|Threads/, 'a LinkedIn post rests on no other channel\'s limits');
  assert.doesNotMatch(linkedin.detail, /Meta/, 'Meta rules only with an Instagram or Facebook post');
  const bait = (await socialRun({ Drafts: ['LinkedIn: Morning yoga in Goa. Tag a friend who needs a calm morning.'] }))['rules-current'];
  assert.match(bait.detail, /^not run: \d+ rules past their 90-day recheck: Meta engagement bait; /, 'the rule the words check quoted comes first');
  const instagram = (await socialRun({ Drafts: ['Instagram: Morning yoga in Goa, slow and steady.'] }))['rules-current'];
  assert.match(instagram.detail, /Instagram caption length/);
  assert.ok(instagram.detail.length <= 147, instagram.detail);
});

test('rules-current on a monthly report names the export rules its figures rest on', async () => {
  const receipt = {
    id: 'w1', operation: 'social.report', figures: [{ key: 'reach', label: 'Reach', display: '1,200', minor: '1200', unit: 'count' }],
    report: [{ platform: 'instagram', month: '2026-11', key: 'reach', formula: 'Sum of Reach', inputs: {}, unit: 'count' }],
  };
  const lines = { Summary: ['Reach grew this month, from the export your client sent.'] };
  const late = await socialRun(lines, { offerKey: 'monthly-report', receipts: [receipt] as never });
  assert.equal(late['narrative-receipted'].outcome, 'pass', late['narrative-receipted'].detail);
  assert.match(late['rules-current'].detail, /Meta content export/);
  assert.doesNotMatch(late['rules-current'].detail, /LinkedIn updates export/, 'no LinkedIn export was read');
  const fresh = await socialRun(lines, { offerKey: 'monthly-report', receipts: [receipt] as never, today: '2026-10-23' });
  assert.equal(fresh['rules-current'].outcome, 'pass');
  assert.match(fresh['rules-current'].detail, /not confirmed against a source yet: .*Meta content export/);
});
