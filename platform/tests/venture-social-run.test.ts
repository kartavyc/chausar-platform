// Social media agency, the built pieces in a real order's run (Ink v2 wave 2, package 2F1): calendar slots made by
// code from the order's intake reach the drafting task and the calendar check; a long X post is split into a thread by
// code; the client's own word lists from intake feed the words check. Everything goes through venture.order.create
// and venture.delivery.run and venture.delivery.approve, the way the owner's app calls them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ChausarError, type Context } from '../runtime/contracts.ts';
import { CalculatorService } from '../runtime/calculator.ts';
import { OntologyService, starterPacks } from '../runtime/ontology.ts';
import { TrustService } from '../runtime/trust.ts';
import type {
  BrowserPort, Deliverable, DeliveryRunView, ModelOutcome, ModelPort, ModelPreview, ModelStatusView, ModelTask, PlaybookCheckResult, PlaybookRecord, SecretShelf,
  VentureDeps, VentureMethod,
} from '../runtime/venture/contracts.ts';
import { digest, ventureAction } from '../runtime/venture/records.ts';
import { handlers as coreHandlers } from '../runtime/venture/core/index.ts';
import { handlers as moneyHandlers } from '../runtime/venture/money/index.ts';
import { handlers as deliveryHandlers } from '../runtime/venture/delivery/index.ts';
import { handlers as viewHandlers } from '../runtime/venture/views/index.ts';
import { handlers as buildHandlers } from '../runtime/venture/build/index.ts';
import { validatePlaybook } from '../runtime/venture/delivery/playbook.ts';
import { flagshipDelivery } from '../runtime/venture/playbooks/steps.ts';
import { runFlagshipChecks } from '../runtime/venture/playbooks/draft-checks.ts';
import { planCalendar } from '../runtime/venture/playbooks/social/calendar.ts';
import { checkWords, countCharacters, splitThread } from '../runtime/venture/playbooks/social/checks.ts';
import { parsePostId, postsOfText } from '../runtime/venture/playbooks/social/run-approvals.ts';
import { socialDraftPosts } from '../runtime/venture/playbooks/social/draft-posts.ts';
import { socialPostBlocks, threadParts } from '../runtime/venture/playbooks/social/post-lines.ts';
import { VentureTestStore } from './venture-test-store.ts';

const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected, error?.message); return true; };
const SOCIAL_IDEA = 'A content calendar service for yoga studios in Goa';
const EXPIRES = '2026-10-21T10:30:00.000Z';
const CALENDAR = { month: '2026-11', channels: ['linkedin', 'instagram'], postsPerChannel: 3, weekdays: [1, 3, 5] };

type Draft = { title: string; sections: { heading: string; parts: { kind: 'text'; text: string; ref: '' }[] }[]; questionsForClient: string[] };
const text = (line: string) => ({ kind: 'text' as const, text: line, ref: '' as const });
const posts = (lines: string[]): Draft => ({
  title: 'Posts for November', questionsForClient: [],
  sections: [
    { heading: 'Drafts', parts: lines.map(text) },
    { heading: 'Alt text', parts: [text('A calm room with yoga mats in the morning light.')] },
    { heading: 'Hashtags', parts: [text('Use #yoga and #goa on every post.')] },
  ],
});

/** Both tiers are an AI. A preview waits for approval; an approved preview answers with the next queued draft. */
class Port implements ModelPort {
  drafts: unknown[] = [];
  previewed: ModelTask<any>[] = [];
  #calls = 0;
  #previews = new Map<string, string>();
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

const HANDLERS = { ...coreHandlers, ...moneyHandlers, ...deliveryHandlers, ...viewHandlers, ...buildHandlers } as Record<string, (deps: VentureDeps, ctx: Context, payload: unknown) => Promise<any>>;

/** A social agency business on the template route: plan priced on every offer, accepted, at approve each, one client. */
async function business() {
  const store = new VentureTestStore();
  const ontology = new OntologyService(store), calculator = new CalculatorService(store), trust = new TrustService(store);
  const pack = structuredClone(starterPacks.find(item => item.pack === 'services')!);
  pack.currency = 'INR';
  pack.gstMode = 'unregistered';
  for (const definition of pack.definitions) definition.currency = 'INR';
  await ontology.publish(owner, pack);
  const models = new Port();
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
  await call('venture.create', { idea: SOCIAL_IDEA, countryCode: 'IN', workingName: 'Test Business' });
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
  return { deps, call, models, client, offers: priced.blueprint.offers as { id: string; playbookOffer?: string }[] };
}
type Env = Awaited<ReturnType<typeof business>>;

/** One draft for one order: delivery.run previews, delivery.approve answers with the queued draft. */
async function deliver(env: Env, orderId: string, answer: Draft): Promise<DeliveryRunView> {
  const waiting = await env.call('venture.delivery.run', { orderId });
  assert.equal(waiting.status, 'waiting-for-you');
  env.models.drafts.push(answer);
  return env.call('venture.delivery.approve', { runId: waiting.id, digest: waiting.preview.digest });
}
const checksOf = (run: { playbookChecks?: PlaybookCheckResult[] }) => Object.fromEntries((run.playbookChecks ?? []).map(item => [item.check, item]));

const LINKEDIN = ['LinkedIn: Morning yoga in Goa, slow and steady.', 'LinkedIn: Breathe first, then move. Morning yoga in Goa.', 'LinkedIn: Come as you are to morning yoga in Goa.'];
const INSTAGRAM = ['Instagram: Morning yoga in Goa, slow and steady.', 'Instagram: Breathe first, then move.', 'Instagram: Come as you are.'];
const REQUEST = 'Posts for our morning yoga classes in Goa this month.';

test('calendar slots: the intake plans them by code, the drafting task lists them, and each post takes its slot by order', async () => {
  const env = await business();
  assert.equal(env.offers[0].playbookOffer, 'content-calendar');
  const plan = await env.call('venture.blueprint.get');
  assert.ok(plan.intake.offer_1.fields.includes('calendar'), 'the content calendar asks for its calendar at intake');
  assert.ok(plan.intake.offer_1.fields.includes('clientRules'));
  assert.ok(!plan.intake.offer_2.fields.includes('calendar'), 'reply drafts have no calendar');
  assert.ok(plan.intake.offer_2.fields.includes('clientRules'), "every social offer reads the client's word lists");

  const order = await env.call('venture.order.create', { clientId: env.client.id, offerId: 'offer_1', request: REQUEST, intake: { calendar: CALENDAR } });
  assert.deepEqual(order.intake.calendar, CALENDAR);
  const slots = planCalendar(order.intake.calendar);
  assert.deepEqual(slots.map(slot => `${slot.id} ${slot.date}`), [
    'linkedin-1 2026-11-02', 'linkedin-2 2026-11-11', 'linkedin-3 2026-11-20', 'instagram-1 2026-11-02', 'instagram-2 2026-11-11', 'instagram-3 2026-11-20',
  ]);

  const run = await deliver(env, order.id, posts([...LINKEDIN, ...INSTAGRAM]));
  // The drafting task, not a later judge call on the ready draft.
  const input = env.models.previewed.filter(task => task.purpose === 'delivery').at(-1)!.input as { guidance: string[] };
  const guidance = input.guidance.join('\n');
  for (const slot of slots) assert.ok(guidance.includes(`${slot.id} on ${slot.date}`), `the drafting task lists ${slot.id} on ${slot.date}`);
  const slotsCheck = checksOf(run)['calendar-slots'];
  assert.equal(slotsCheck.outcome, 'pass', slotsCheck.detail);
  assert.match(slotsCheck.detail, /post-3 takes linkedin-3 on 2026-11-20/, 'the third LinkedIn line is the third LinkedIn slot');
  assert.match(slotsCheck.detail, /post-4 takes instagram-1 on 2026-11-02/);
  assert.equal(run.canAccept, true, run.acceptBlocked ?? '');

  // The model writes no date into a post: the dates are code's. A draft one post short fails the check.
  const second = await env.call('venture.order.create', { clientId: env.client.id, offerId: 'offer_1', request: REQUEST, intake: { calendar: CALENDAR } });
  const short = await deliver(env, second.id, posts([...LINKEDIN.slice(0, 2), ...INSTAGRAM]));
  const failed = checksOf(short)['calendar-slots'];
  assert.equal(failed.outcome, 'fail');
  assert.equal(failed.detail, 'LinkedIn has 3 slots and 2 posts.');
  assert.equal(short.canAccept, false);
  assert.match(short.acceptBlocked!, /LinkedIn has 3 slots and 2 posts/);

  // One numbering for checks, posting and the calendar file: the nth post line is post-n, whatever text comes first.
  const third = await env.call('venture.order.create', { clientId: env.client.id, offerId: 'offer_1', request: REQUEST, intake: { calendar: CALENDAR } });
  const intro = posts(['Here are the posts for the month.', ...LINKEDIN, ...INSTAGRAM]);
  const introduced = await deliver(env, third.id, intro);
  const numbered = checksOf(introduced)['calendar-slots'];
  assert.equal(numbered.outcome, 'pass', numbered.detail);
  assert.match(numbered.detail, /post-1 takes linkedin-1 on 2026-11-02/, 'the intro line is not a post, so it takes no number');
  const ours = socialDraftPosts(intro as unknown as Deliverable);
  // Posting and the calendar file read the rendered text: each post is on its own line there, after the intro.
  const rendered = postsOfText(introduced.id, introduced.renderedText);
  assert.deepEqual(ours.map(post => `${introduced.id}.${post.id}`), rendered.map(post => post.draftId), "posting's own count names the same posts");
  assert.deepEqual(rendered.map(post => post.text), [...LINKEDIN, ...INSTAGRAM].map(line => line.slice(line.indexOf(':') + 1).trim()));
  assert.deepEqual(parsePostId(`${introduced.id}.${ours[0].id}`), { runId: introduced.id, n: 1 });
});

test('calendar intake: refused in planCalendar\'s words when the month has too few posting days, and on an offer with no calendar', async () => {
  const env = await business();
  const base = { clientId: env.client.id, offerId: 'offer_1', request: REQUEST };
  await assert.rejects(env.call('venture.order.create', { ...base, intake: { calendar: { ...CALENDAR, postsPerChannel: 14 } } }), (error: any) => {
    assert.equal(error?.code, 'INVALID_VENTURE_REQUEST');
    assert.equal(error.message, '2026-11 has 13 posting days on the weekdays you picked, fewer than the posts per channel. Add a weekday or post less.');
    return true;
  });
  await assert.rejects(env.call('venture.order.create', { ...base, intake: { calendar: { ...CALENDAR, month: 'November' } } }), code('INVALID_VENTURE_REQUEST'));
  // Today is 21 October 2026 here: October's first slots are already past, so its calendar is refused.
  await assert.rejects(env.call('venture.order.create', { ...base, intake: { calendar: { ...CALENDAR, month: '2026-10' } } }), (error: any) => {
    assert.equal(error?.code, 'INVALID_VENTURE_REQUEST');
    assert.match(error.message, /before today/);
    return true;
  });
  await assert.rejects(env.call('venture.order.create', { ...base, intake: { calendar: { ...CALENDAR, month: '2025-11' } } }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(env.call('venture.order.create', { ...base, offerId: 'offer_2', intake: { calendar: CALENDAR } }), code('INVALID_VENTURE_REQUEST'), 'reply drafts take no calendar');
  await assert.rejects(env.call('venture.order.create', { ...base, intake: { calendar: { ...CALENDAR, extra: true } } }), code('INVALID_VENTURE_REQUEST'));
  const none = await env.call('venture.order.create', base);
  assert.equal('intake' in none, false, 'a calendar is not required; without one the check says it did not run');
  const run = await deliver(env, none.id, posts([...LINKEDIN, ...INSTAGRAM]));
  assert.equal(checksOf(run)['calendar-slots'].outcome, 'not-run');
  assert.match(checksOf(run)['calendar-slots'].detail, /^not run: /);
  const replies = await env.call('venture.order.create', { ...base, offerId: 'offer_2' });
  const reply = await deliver(env, replies.id, posts(['Instagram: Thank you, see you on the mat.']));
  assert.equal(checksOf(reply)['calendar-slots'], undefined, 'reply drafts have no calendar check');
});

test('thread splits: a long X post is split into numbered parts by code, and a LinkedIn post over its limit still fails', async () => {
  const env = await business();
  const order = await env.call('venture.order.create', { clientId: env.client.id, offerId: 'offer_1', request: REQUEST });
  const sentence = 'Breathe first, then move, and let the morning settle before the class begins.';
  const long = Array.from({ length: 6 }, () => sentence).join(' ');
  assert.ok(countCharacters(long, 'x') > 280 && long.length < 1200);
  const run = await deliver(env, order.id, posts([INSTAGRAM[0], `X: ${long}`]));
  const limits = checksOf(run)['channel-limits'];
  assert.equal(limits.outcome, 'pass', limits.detail);
  const parts = splitThread(long, 'x', { numbered: true });
  assert.equal(parts.length, 2);
  assert.deepEqual(threadParts('x', long), parts, 'posting reads the same split');
  assert.match(limits.detail, /post-2 on X is split into 2 posts by code/);
  assert.ok(limits.detail.includes(`${countCharacters(parts[0], 'x')} and ${countCharacters(parts[1], 'x')} characters`), limits.detail);
  // The parts' numbering is code's, not a claim, and the words are checked as one text.
  assert.equal(checksOf(run).claims.outcome, 'pass', checksOf(run).claims.detail);
  assert.equal(checksOf(run).words.outcome, 'pass', checksOf(run).words.detail);
  assert.equal(run.canAccept, true, run.acceptBlocked ?? '');
  assert.equal(threadParts('x', 'Breathe first.'), null, 'a post that fits is not a thread');
  assert.equal(threadParts('linkedin', 'word '.repeat(700)), null, 'LinkedIn has no threads');

  // A competitor's name the split puts across two parts is still caught.
  const request = `${REQUEST} Yoga Hub opened nearby.`;
  let across = '';
  for (let words = 30; words < 80 && !across; words += 1) {
    const candidate = `${'calm '.repeat(words)}Yoga Hub ${'slow '.repeat(40)}`.trim();
    const split = splitThread(candidate, 'x', { numbered: true });
    if (/Yoga 1\/\d+$/.test(split[0])) across = candidate;
  }
  assert.ok(across, 'a text whose split falls inside the name');
  const named = await env.call('venture.order.create', { clientId: env.client.id, offerId: 'offer_1', request, intake: { clientRules: { competitors: ['Yoga Hub'] } } });
  const caught = await deliver(env, named.id, posts([`X: ${across}`]));
  assert.equal(checksOf(caught).words.outcome, 'fail', checksOf(caught).words.detail);
  assert.match(checksOf(caught).words.detail, /Yoga Hub/);

  // A draft part holds at most 1,200 characters, so a LinkedIn post over 3,000 is checked here as the run checks it.
  const deliverable = { title: 'Posts', questionsForClient: [], sections: [{ heading: 'Drafts', parts: [text(`LinkedIn: ${'Breathe first, then move. '.repeat(130)}`)] }] } as unknown as Deliverable;
  const results = await runFlagshipChecks({
    flagship: 'social-agency', offerKey: 'content-calendar', servedBy: 'model', deliverable, request: REQUEST, intake: null, files: [], receipts: [],
    known: [], mode: 'client', today: '2026-10-21', dateOrder: 'day-month-year',
  });
  const linkedin = results.find(item => item.check === 'channel-limits')!;
  assert.equal(linkedin.outcome, 'fail');
  assert.match(linkedin.detail, /of 3,000 characters LinkedIn allows/);
});

test("client lists: the intake's banned words and competitors feed the words check; protected phrases are never flagged", async () => {
  const env = await business();
  const clientRules = { bannedWords: ['cheap'], bannedTopics: ['politics'], competitors: ['Yoga Hub'], protectedPhrases: ['Cheap Seats Yoga'] };
  const request = 'Posts for Cheap Seats Yoga, our morning classes in Goa. Yoga Hub opened nearby this month.';
  const make = (intake: Record<string, unknown> = {}) => env.call('venture.order.create', { clientId: env.client.id, offerId: 'offer_1', request, intake: { clientRules, ...intake } });
  const first = await make();
  assert.deepEqual(first.intake.clientRules, clientRules);

  const banned = await deliver(env, first.id, posts(['Instagram: Morning yoga in Goa, cheap classes for everyone.']));
  const words = checksOf(banned).words;
  assert.equal(words.outcome, 'fail');
  assert.match(words.detail, /"cheap" is on/);
  assert.equal(banned.canAccept, false);

  const kept = await deliver(env, (await make()).id, posts(['Instagram: Morning yoga at Cheap Seats Yoga in Goa.']));
  assert.equal(checksOf(kept).words.outcome, 'pass', 'the client\'s own name with a banned word in it is protected');
  assert.equal(kept.canAccept, true, kept.acceptBlocked ?? '');

  // A competitor on the client's own list is blocked in an organic post too; one not on it goes to the owner to decide.
  const organic = await deliver(env, (await make()).id, posts(['Instagram: Morning yoga in Goa. Welcome to the street, Yoga Hub.']));
  assert.equal(checksOf(organic).words.outcome, 'fail');
  assert.match(checksOf(organic).words.detail, /The post names Yoga Hub, a competitor your client asked you not to name/);
  assert.equal(organic.canAccept, false);
  const other = checkWords({ id: 'post', channel: 'instagram', text: 'Congrats to Glow Kitchen on opening.', style: 'post' }, { proofFiles: [], competitors: ['Glow Kitchen'] });
  assert.equal(other[0].severity, 'ask-owner', 'a competitor not on the client\'s list stays for the owner to decide');
  const ad = await deliver(env, (await make({ paidPromotion: true })).id, posts(['Instagram: Ad. Morning yoga in Goa, kinder than Yoga Hub.']));
  assert.equal(checksOf(ad).words.outcome, 'fail');
  assert.match(checksOf(ad).words.detail, /This ad names Yoga Hub, a competitor/);

  // Alt text and hashtag lines go out with the posts, so the client's lists are checked on them too.
  const extras = await deliver(env, (await make()).id, {
    title: 'Posts for November', questionsForClient: [],
    sections: [
      { heading: 'Drafts', parts: [text('Instagram: Morning yoga in Goa.')] },
      { heading: 'Alt text', parts: [text('Cheap mats by the door and a Yoga Hub banner.')] },
      { heading: 'Hashtags', parts: [text('Use #cheap and #goa on every post.')] },
    ],
  });
  const extraWords = checksOf(extras).words;
  assert.equal(extraWords.outcome, 'fail');
  assert.match(extraWords.detail, /"cheap" is on/);
  assert.match(extraWords.detail, /Yoga Hub/);
  assert.equal(extras.canAccept, false);

  // An owner's edit of one post is checked again with the same lists before it is posted (build/posting.ts).
  const edited = { channel: 'instagram' as const, text: 'Cheap classes at Cheap Seats Yoga.', request, files: [], known: [], dateOrder: 'day-month-year' as const, paid: false, ai: { person: false, voice: false } };
  assert.deepEqual(socialPostBlocks(edited), [], 'without the lists nothing is banned');
  assert.ok(socialPostBlocks({ ...edited, clientRules: first.intake.clientRules }).some(line => /"cheap" is on/.test(line)));
  assert.deepEqual(socialPostBlocks({ ...edited, text: 'Morning yoga at Cheap Seats Yoga.', clientRules: first.intake.clientRules }), []);

  await assert.rejects(make({ clientRules: { bannedWords: 'cheap' } }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(make({ clientRules: { ...clientRules, slogans: [] } }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(env.call('venture.order.create', { clientId: env.client.id, offerId: 'offer_1', request, intake: { clientRules: { bannedWords: ['x'.repeat(81)] } } }), code('INVALID_VENTURE_REQUEST'));
  const partial = await env.call('venture.order.create', { clientId: env.client.id, offerId: 'offer_2', request, intake: { clientRules: { bannedWords: [' cheap ', 'cheap'] } } });
  assert.deepEqual(partial.intake.clientRules, { bannedWords: ['cheap'], bannedTopics: [], competitors: [], protectedPhrases: [] }, 'trimmed, each once, missing lists empty');
});

test('a real approve run puts each post on its own line, so share links and posting see every post by its number', async () => {
  const env = await business();
  const posted: string[] = [];
  const browser: BrowserPort = {
    async probe() { return { present: true, reason: 'Playwright with Chromium found on this computer.' }; },
    async post(job) { posted.push(job.text); return { outcome: 'posted', line: 'Posted.', url: null }; },
  };
  (env.deps as { connectors?: unknown }).connectors = { browser, appReviewed: [], postTimeoutMs: 40 };
  // This port answers no judge call, so the judge stays with the owner here (2C1's own tests cover it).
  await env.call('venture.judge.auto.set', { auto: false });
  const order = await env.call('venture.order.create', { clientId: env.client.id, offerId: 'offer_1', request: REQUEST });
  const lines = ['Here are the posts for the month.', LINKEDIN[0], 'X: Breathe first, then move.', INSTAGRAM[1]];
  const run = await deliver(env, order.id, posts(lines));
  assert.equal(run.canAccept, true, run.acceptBlocked ?? '');
  const drafts = run.renderedText!.split('## Drafts\n')[1].split('\n\n')[0];
  assert.deepEqual(drafts.split('\n'), lines, 'the intro stays prose; each post line is its own line');
  await env.call('venture.delivery.review', { runId: run.id, verdict: 'accepted' });
  await env.call('venture.share.create', { deliveryId: run.id });
  await env.call('venture.share.recordAnswer', { draftId: run.id, answer: 'approved' });

  const shared = await env.call('venture.share.list', { deliveryId: run.id });
  assert.deepEqual(shared.posts.map((post: { draftId: string; channel: string; text: string }) => [post.draftId, post.channel, post.text]), [
    [`${run.id}.post-1`, 'linkedin', LINKEDIN[0].slice('LinkedIn: '.length)],
    [`${run.id}.post-2`, 'x', 'Breathe first, then move.'],
    [`${run.id}.post-3`, 'instagram', INSTAGRAM[1].slice('Instagram: '.length)],
  ]);
  const proposal = await env.call('venture.posting.propose', { draftId: `${run.id}.post-2` });
  assert.deepEqual([proposal.connectorId, proposal.state], ['x', 'described']);
  assert.equal(posted.length, 0, 'nothing is posted until the owner approves on Today');
});

test('the playbook: the calendar guidance sits on the drafting step and still validates', async () => {
  const env = await business();
  const record: PlaybookRecord = await env.call('venture.delivery.playbook');
  const drafts = record.steps.find(step => step.id === 'drafts')!;
  assert.ok(drafts.guidance!.some(line => /slot/.test(line)), 'the drafting step says how to fill the slots');
  assert.equal(validatePlaybook(record.steps, { limits: record.limits!, aliases: record.aliases ?? {} }).hash, record.hash);

  // A calendar that can no longer be planned adds no lines to the drafting task, and never throws there.
  const social = flagshipDelivery('social-agency')!;
  const intake = { rights: null, format: 'long' as const, aiVoice: false, aiPresenter: false, paidPromotion: false, cutFile: null };
  assert.equal(social.orderGuidance('content-calendar', { ...intake, calendar: CALENDAR as never }).length, 2);
  assert.deepEqual(social.orderGuidance('content-calendar', { ...intake, calendar: { ...CALENDAR, postsPerChannel: 40 } as never }), []);
  assert.deepEqual(social.orderGuidance('content-calendar', null), []);
});
