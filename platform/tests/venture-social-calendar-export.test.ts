// The calendar file (catalogue S1 calendar export; Ink v2 wave 2 package 2F2). venture.social.calendar builds, by code,
// the CSV of a social content calendar's posts from the approved draft only: each post under Drafts takes its slot's
// date from code (playbooks/social/draft-posts.ts assignSlots over planCalendar), each post passes the
// draft-before-schedule gate (playbooks/social/approvals.ts scheduleGate, through run-approvals.ts) or is left out
// with every reason, and the post ids are the ones posting takes ('<run>.post-<n>', counted over post lines only).
// Times in the file are the business's own clock (India), never UTC by default.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ChausarError, type Context } from '../runtime/contracts.ts';
import { CalculatorService } from '../runtime/calculator.ts';
import { OntologyService, starterPacks } from '../runtime/ontology.ts';
import { TrustService } from '../runtime/trust.ts';
import { APP_ONLY_METHODS, VENTURE_ERRORS } from '../runtime/venture/contracts.ts';
import type {
  ClientRecord, DeliveryRunRecord, DeliveryRunView, ModelOutcome, ModelPort, ModelPreview, ModelStatusView, ModelTask, OrderIntake, OrderRecord,
  PlaybookRecord, SecretShelf, SocialCalendarFile, VentureDeps,
} from '../runtime/venture/contracts.ts';
import { digest, houseStyleFindings, ventureAction } from '../runtime/venture/records.ts';
import { CALENDAR_WORDS } from '../runtime/venture/playbooks/social/calendar-export.ts';
import { handlers as build } from '../runtime/venture/build/index.ts';
import { handlers as coreHandlers } from '../runtime/venture/core/index.ts';
import { handlers as moneyHandlers } from '../runtime/venture/money/index.ts';
import { handlers as deliveryHandlers } from '../runtime/venture/delivery/index.ts';
import { handlers as viewHandlers } from '../runtime/venture/views/index.ts';
import { VentureTestStore } from './venture-test-store.ts';
import { planCalendar } from '../runtime/venture/playbooks/social/calendar.ts';
import { threadParts } from '../runtime/venture/playbooks/social/post-lines.ts';
import { code, owner, phone, setup, type Env } from './venture-views-env.ts';
import { seedPostDraft, seedPostPlaybook } from './venture-post-drafts.ts';

type Handler = (deps: VentureDeps, ctx: Context, payload: unknown) => Promise<unknown>;
const call = <T>(deps: VentureDeps, method: string, payload: unknown = {}, ctx: Context = owner) => (build as Record<string, Handler>)[method](deps, ctx, payload) as Promise<T>;
const calendarOf = (env: Env, runId: string, ctx: Context = owner) => call<SocialCalendarFile>(env.deps, 'venture.social.calendar', { runId }, ctx);

const HEADER = 'date,channel,text,alt_text,owner_approved_at,client_approved_at';
/** A UTF-8 byte order mark, so a spreadsheet on Windows reads emoji, the rupee sign and Devanagari right. */
const BOM = '﻿';
const CALENDAR: NonNullable<OrderIntake['calendar']> = { month: '2026-11', channels: ['linkedin', 'instagram'], postsPerChannel: 3, weekdays: [1, 3, 5] };
const LINKEDIN = ['LinkedIn: Morning yoga in Goa, slow and steady.', 'LinkedIn: Breathe first, then move.', 'LinkedIn: Come as you are to morning yoga.'];
const INSTAGRAM = ['Instagram: Sunrise mats by the window.', 'Instagram: Breathe in, breathe out.', 'Instagram: Come as you are.'];
/** An intro line first under Drafts (not a post), the posts mixed, then an Alt text line that starts like a post. */
const DRAFTS = ['Here are the posts for November.', LINKEDIN[0], INSTAGRAM[0], LINKEDIN[1], INSTAGRAM[1], LINKEDIN[2], INSTAGRAM[2]];
const ALT = 'Instagram: A calm room with yoga mats in the morning light.';

/** The intake the engine keeps on an order (playbooks/intake.ts), before the calendar is added. */
const NO_INTAKE: OrderIntake = { rights: null, format: 'long', aiVoice: false, aiPresenter: false, paidPromotion: false, cutFile: null };

/** The draft's text as the owner sees it: each post on its own line under its section heading. */
function rendered(title: string, sections: { heading: string; lines: string[] }[]): string {
  return [`# ${title}`, ...sections.map(section => `## ${section.heading}\n${section.lines.join('\n')}`)].join('\n\n');
}

/** An order of this business, with the intake given (a content calendar's month, channels, posts and weekdays). */
async function seedOrder(env: Env, intake: OrderIntake | null): Promise<OrderRecord> {
  return ventureAction(env.deps, owner, 'prepare', 'seed.order', tx => {
    const client = tx.put<ClientRecord>({ ...tx.base('venture-client'), name: 'Asha Rao', email: 'asha@example.com', countryCode: 'IN', taxId: null, stateCode: null, note: null });
    return tx.put<OrderRecord>({
      ...tx.base('venture-order'), clientId: client.id, offerId: 'offer_1', quantity: '1', request: 'Posts for our morning yoga classes in Goa.',
      status: 'open', priceReceiptId: 'receipt_none', deliveredOn: null, saleFactId: null, ...(intake ? { intake } : {}),
    });
  });
}

/** A social agency draft the owner accepted, every check passed, for an order with the given calendar. */
async function socialDraft(env: Env, options: { calendar?: OrderIntake['calendar'] | null; drafts?: string[]; flagship?: string | null; fields?: Partial<DeliveryRunRecord> } = {}) {
  const playbook: PlaybookRecord = await seedPostPlaybook(env.deps, options.flagship === undefined ? 'social-agency' : options.flagship);
  const calendar = options.calendar === undefined ? CALENDAR : options.calendar;
  const order = await seedOrder(env, calendar ? { ...NO_INTAKE, calendar } : null);
  const drafts = options.drafts ?? DRAFTS;
  const sections = [{ heading: 'Drafts', lines: drafts }, { heading: 'Alt text', lines: [ALT] }, { heading: 'Hashtags', lines: ['Use #yoga and #goa on every post.'] }];
  const run = await seedPostDraft(env.deps, [], {
    orderId: order.id, playbookId: playbook.id,
    deliverable: { title: 'Posts for November', sections: sections.map(section => ({ heading: section.heading, parts: section.lines.map(text => ({ kind: 'text' as const, text })) })), questionsForClient: [] },
    renderedText: rendered('Posts for November', sections),
    playbookChecks: [{ playbook: 'social-agency', check: 'calendar-slots', outcome: 'pass', detail: 'Each post has its slot from code.' }],
    ...options.fields,
  });
  return { run, order, playbook };
}

/** The owner shares the draft and records the client's approval, as the desktop does. */
async function clientApproves(env: Env, run: DeliveryRunRecord, answer: 'approved' | 'changes' = 'approved') {
  await call(env.deps, 'venture.share.create', { deliveryId: run.id });
  await call(env.deps, 'venture.share.recordAnswer', { draftId: run.id, answer, ...(answer === 'changes' ? { comment: 'Shorter, please.' } : {}) });
}

/** The CSV's rows as cells (no cell in these tests holds a comma inside quotes). */
const rowsOf = (csv: string) => csv.trim().split('\n').slice(1);

test('the calendar file is a read method of the build package, and its refusal codes are declared', () => {
  assert.equal(typeof (build as Record<string, unknown>)['venture.social.calendar'], 'function');
  assert.ok(!APP_ONLY_METHODS.includes('venture.social.calendar'), 'reading the file changes nothing, so the phone may read it too');
  for (const name of ['CALENDAR_NOT_A_SOCIAL_DRAFT', 'CALENDAR_NO_SLOTS', 'DELIVERY_NOT_FOUND', 'DELIVERY_NOT_READY', 'PRACTICE_DRAFT']) {
    assert.ok((VENTURE_ERRORS as readonly string[]).includes(name), name);
  }
  for (const line of Object.values(CALENDAR_WORDS)) assert.deepEqual(houseStyleFindings(line), [], line);
});

test("before the client's answer every calendar post is left out with the gate's words, and the file is its header only", async () => {
  const env = await setup();
  const { run } = await socialDraft(env);
  const file = await calendarOf(env, run.id);
  assert.equal(file.csv, `${BOM}${HEADER}\n`);
  assert.equal(file.rows, 0);
  // post-1 is the first post line: the intro line under Drafts is not a post. The Alt text line (post-7) is not a calendar post.
  assert.deepEqual(file.blocked.map(item => item.draftId), [1, 2, 3, 4, 5, 6].map(n => `${run.id}.post-${n}`));
  for (const item of file.blocked) assert.equal(item.line, 'Your client has not approved this draft.');
  // Each left-out post carries its channel and words, so a screen shows them without joining another list.
  assert.deepEqual([file.blocked[0].name, file.blocked[0].text, file.blocked[1].name, file.blocked[1].text], ['LinkedIn', 'Morning yoga in Goa, slow and steady.', 'Instagram', 'Sunrise mats by the window.']);
  assert.deepEqual([file.defused, file.threads, file.gaps], [[], [], []]);
});

test("with the client's approval: one row per slot, in date order, each post on its slot's date from code, ids as posting reads them", async () => {
  const env = await setup();
  const { run } = await socialDraft(env);
  // 20:00 UTC on 15 October is 01:30 on 16 October in India: the file says the business's own time.
  env.advance(10 * 3600000);
  await clientApproves(env, run);
  const file = await calendarOf(env, run.id);
  assert.equal(file.rows, 6);
  assert.deepEqual(file.blocked, []);
  assert.equal(file.fileName, 'chausar-calendar-2026-11.csv', 'named by the engine from the month code planned');
  assert.ok(file.csv.startsWith(`${BOM}${HEADER}\n`), 'the file starts with the byte order mark, then the header');
  assert.deepEqual([file.defused, file.threads, file.gaps], [[], [], []]);
  const slots = planCalendar(CALENDAR);
  const textOf = (line: string) => line.slice(line.indexOf(':') + 1).trim();
  const expected = [
    ...slots.filter(slot => slot.channel === 'linkedin').map((slot, index) => ({ date: slot.date, channel: 'linkedin', text: textOf(LINKEDIN[index]) })),
    ...slots.filter(slot => slot.channel === 'instagram').map((slot, index) => ({ date: slot.date, channel: 'instagram', text: textOf(INSTAGRAM[index]) })),
  ].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const got = rowsOf(file.csv).map(line => {
    const [date, channel, ...rest] = line.split(',');
    return { date, channel, text: rest.slice(0, -3).join(',').replace(/^"|"$/g, '') };
  });
  assert.deepEqual(got, expected);
  for (const line of rowsOf(file.csv)) {
    const cells = line.split(',');
    assert.equal(cells.at(-2), '2026-10-15T15:30+05:30', 'the owner accepted at 10:00 UTC, 15:30 in India');
    assert.equal(cells.at(-1), '2026-10-16T01:30+05:30', 'the client approved on 16 October in India, though UTC still says the 15th');
  }
  // Nothing in the file is a date or time from UTC by default.
  assert.doesNotMatch(file.csv, /Z\b|T\d\d:\d\d:\d\d/);
});

test('a draft edited after the client approved: the file and posting give the same answer for every post', async () => {
  const env = await setup();
  const browser = { async probe() { return { present: true, reason: 'Playwright with Chromium found on this computer.' }; }, async post() { return { outcome: 'posted' as const, line: 'Posted.', url: null }; } };
  env.deps = { ...env.deps, connectors: { browser, appReviewed: [], postTimeoutMs: 40 } } as VentureDeps;
  const { run } = await socialDraft(env);
  await clientApproves(env, run);
  // Approved as it is: post-1 is in the file, and posting takes it.
  assert.equal((await calendarOf(env, run.id)).rows, 6);
  assert.equal((await call<{ draftId: string }>(env.deps, 'venture.posting.propose', { draftId: `${run.id}.post-1` })).draftId, `${run.id}.post-1`);

  // The owner then changes one post (post-3). The client approved other words, so no post of this draft goes anywhere.
  const changed = DRAFTS.map(line => (line === LINKEDIN[1] ? 'LinkedIn: Breathe first, then move, then rest.' : line));
  await env.store.update(state => {
    const stored = state.conversations.find(item => item.id === run.id) as DeliveryRunRecord;
    stored.status = 'edited';
    stored.editedText = rendered('Posts for November', [{ heading: 'Drafts', lines: changed }, { heading: 'Alt text', lines: [ALT] }]);
  });
  const file = await calendarOf(env, run.id);
  assert.equal(file.rows, 0);
  assert.equal(file.csv, `${BOM}${HEADER}\n`);
  assert.deepEqual(file.blocked.map(item => item.draftId), [1, 2, 3, 4, 5, 6].map(n => `${run.id}.post-${n}`));
  for (const item of file.blocked) assert.match(item.line, /^The draft changed after it was approved\./);
  for (const n of [1, 3]) {
    await assert.rejects(call(env.deps, 'venture.posting.propose', { draftId: `${run.id}.post-${n}` }), code('POST_DRAFT_CHANGED'), `post-${n}`);
  }
});

test("the client's request for changes, the owner's rejection and a failed check each keep every post out", async () => {
  const env = await setup();
  const asked = await socialDraft(env);
  await clientApproves(env, asked.run, 'changes');
  const changes = await calendarOf(env, asked.run.id);
  assert.equal(changes.rows, 0);
  assert.ok(changes.blocked.every(item => item.line === 'Your client asked for changes.'), JSON.stringify(changes.blocked[0]));

  const failed = await socialDraft(env, { fields: { playbookChecks: [{ playbook: 'social-agency', check: 'claims', outcome: 'fail', detail: 'A claim has no proof.' }] } });
  const unchecked = await calendarOf(env, failed.run.id);
  assert.equal(unchecked.rows, 0);
  assert.match(unchecked.blocked[0].line, /The draft failed a check: A claim has no proof\./);
  assert.match(unchecked.blocked[0].line, /Your client has not approved this draft\./, 'every reason, in one line per post');

  const rejected = await socialDraft(env, { fields: { status: 'rejected', verdict: { choice: 'rejected', reason: 'tone', at: env.now() } } });
  const turnedDown = await calendarOf(env, rejected.run.id);
  assert.equal(turnedDown.rows, 0);
  assert.equal(turnedDown.blocked[0].line, 'You have not approved this draft. Your client has not approved this draft.');
});

test('cells that start like a spreadsheet formula are defused and named; quotes double; a long X post goes in as the thread code split', async () => {
  const env = await setup();
  const long = `X: ${'Slow mornings make strong backs, and a calm breath makes a calm day at the studio. '.repeat(5).trim()}`;
  const { run } = await socialDraft(env, {
    calendar: { month: '2026-11', channels: ['x', 'linkedin'], postsPerChannel: 3, weekdays: [1, 2, 3, 4, 5] },
    drafts: [long, 'X: @asha thanks', 'X: - tip', 'LinkedIn: =1+1 reasons to stretch today', 'LinkedIn: +91 classes', 'LinkedIn: say "hi", ok'],
  });
  await clientApproves(env, run);
  const file = await calendarOf(env, run.id);
  assert.deepEqual(file.blocked, []);
  assert.equal(file.rows, 6);
  for (const cell of [",x,'@asha thanks,", ",x,'- tip,", ",linkedin,'=1+1 reasons to stretch today,", ",linkedin,'+91 classes,", ',linkedin,"say ""hi"", ok",']) {
    assert.ok(file.csv.includes(cell), `${cell} in ${file.csv}`);
  }
  // The posts whose cell got an apostrophe, so the screen can tell the owner to remove it before posting.
  assert.deepEqual(file.defused, [2, 3, 4, 5].map(n => `${run.id}.post-${n}`));
  const parts = threadParts('x', long.slice(3))!;
  assert.ok(parts.length >= 2);
  assert.ok(file.csv.includes(`,x,"${parts.join('\n\n')}",`), 'the thread parts, numbered by code, one after another in one cell');
  assert.deepEqual(file.threads, [`${run.id}.post-1`], 'the screen says a thread is posted by hand, part by part');
});

test('a post with no slot in the calendar is left out with the count that does not fit', async () => {
  const env = await setup();
  const { run } = await socialDraft(env, { drafts: [...DRAFTS, 'LinkedIn: One more for the road.'] });
  await clientApproves(env, run);
  const file = await calendarOf(env, run.id);
  assert.equal(file.rows, 6);
  assert.deepEqual(file.blocked, [{ draftId: `${run.id}.post-7`, name: 'LinkedIn', text: 'One more for the road.', line: 'This post has no slot in the calendar. LinkedIn has 3 slots and 4 posts.' }]);
  assert.deepEqual(file.gaps, ['LinkedIn has 3 slots and 4 posts.']);

  // A slot with no post is a gap too; the posts there are still in the file.
  const short = await socialDraft(env, { drafts: DRAFTS.filter(line => line !== LINKEDIN[2]) });
  await clientApproves(env, short.run);
  const fewer = await calendarOf(env, short.run.id);
  assert.equal(fewer.rows, 5);
  assert.deepEqual(fewer.blocked, []);
  assert.deepEqual(fewer.gaps, ['LinkedIn has 3 slots and 2 posts.']);
});

test('refusals: not a social draft, no calendar, no draft yet, a practice draft, an unknown run, a wrong request', async () => {
  const env = await setup();
  const plain = await socialDraft(env, { flagship: null });
  await assert.rejects(calendarOf(env, plain.run.id), (error: any) => {
    assert.equal(error.code, 'CALENDAR_NOT_A_SOCIAL_DRAFT');
    assert.equal(error.message, 'Only a social media draft has a calendar file.');
    return true;
  });
  const noCalendar = await socialDraft(env, { calendar: null });
  await assert.rejects(calendarOf(env, noCalendar.run.id), (error: any) => {
    assert.equal(error.code, 'CALENDAR_NO_SLOTS');
    assert.equal(error.message, 'This order has no calendar, so code planned no slots. Only a content calendar order has a calendar file.');
    return true;
  });
  const waiting = await socialDraft(env, { fields: { status: 'waiting-for-you', deliverable: null, renderedText: null, verdict: null } });
  await assert.rejects(calendarOf(env, waiting.run.id), code('DELIVERY_NOT_READY'));
  const practice = await socialDraft(env, { fields: { practice: true } });
  await assert.rejects(calendarOf(env, practice.run.id), code('PRACTICE_DRAFT'));
  await assert.rejects(calendarOf(env, 'delivery_missing'), code('DELIVERY_NOT_FOUND'));
  for (const payload of [{}, { runId: plain.run.id, month: '2026-11' }, { runId: 'not an id!' }]) {
    await assert.rejects(call(env.deps, 'venture.social.calendar', payload), code('INVALID_VENTURE_REQUEST'), JSON.stringify(payload));
  }
});

test('the phone reads the same file; reading it writes nothing', async () => {
  const env = await setup();
  const { run } = await socialDraft(env);
  await clientApproves(env, run);
  const before = JSON.stringify(env.store.read());
  const desk = await calendarOf(env, run.id);
  const onPhone = await calendarOf(env, run.id, phone);
  assert.deepEqual(onPhone, desk);
  assert.equal(JSON.stringify(env.store.read()), before);
});

// ---------------------------------------------------------------------------------------------------------------------
// Through a real run: venture.order.create with the calendar at intake, venture.delivery.run and approve with the
// model's draft, the owner's accept, the share link and the client's answer, then the file.

/** Both tiers are an AI. A preview waits for approval; an approved preview answers with the next queued draft. */
class DraftPort implements ModelPort {
  drafts: unknown[] = [];
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
    this.#calls += 1;
    const callId = `call_${this.#calls}`;
    const payloadText = JSON.stringify({ system: task.instructions, input: task.input });
    this.#previews.set(callId, digest(payloadText));
    return {
      callId, payloadText, digest: digest(payloadText), presetId: 'anthropic-sonnet-5-5', model: 'claude-sonnet-5-5', endpoint: 'https://api.anthropic.com/v1/messages',
      estimatedMaxCostMicros: '1000', estimatedMaxCostDisplay: 'USD 0.0010', expiresAt: '2026-10-21T10:30:00.000Z',
    };
  }
  async runPreview<T>(_ctx: Context, callId: string, approved: string, validate: (raw: unknown) => T): Promise<ModelOutcome<T>> {
    if (this.#previews.get(callId) !== approved) throw new ChausarError('APPROVAL_STALE', 'Run it again.');
    this.#previews.delete(callId);
    return { value: validate(this.drafts.shift()), by: 'model', callId, presetId: 'anthropic-sonnet-5-5', model: 'stub', costMicros: '10', priceConfirmed: true };
  }
}

const ALL = { ...coreHandlers, ...moneyHandlers, ...deliveryHandlers, ...viewHandlers, ...build } as Record<string, Handler>;

/** A social agency business in India on the template route: plan priced and accepted, at approve each, one client. */
async function socialBusiness() {
  const store = new VentureTestStore();
  const ontology = new OntologyService(store), calculator = new CalculatorService(store), trust = new TrustService(store);
  const pack = structuredClone(starterPacks.find(item => item.pack === 'services')!);
  pack.currency = 'INR';
  pack.gstMode = 'unregistered';
  for (const definition of pack.definitions) definition.currency = 'INR';
  await ontology.publish(owner, pack);
  const models = new DraftPort();
  const secrets = { get: () => null, set: () => undefined, delete: () => undefined, has: () => false, clear: () => undefined } as unknown as SecretShelf;
  const deps: VentureDeps = {
    store, clock: () => new Date('2026-10-21T10:00:00.000Z'), models, services: { calculator, ontology, trust },
    github: { kind: 'fixture', async read() { throw new ChausarError('GITHUB_READ_FAILED', 'No GitHub here.'); } },
    secrets, host: 'test', demo: true, storage: 'experimental-file',
  };
  const run = (method: string, payload: unknown = {}): Promise<any> => ALL[method](deps, owner, payload);
  await run('venture.create', { idea: 'A content calendar service for yoga studios in Goa', countryCode: 'IN', workingName: 'Test Business' });
  let interview = await run('venture.interview.next', { useTemplate: true });
  for (const question of interview.interview.questions) {
    const answer = question.id === 'q_pricing_model' ? { choiceId: question.choices[0].id } : question.id === 'q_tax' ? { yes: false } : { skipped: true };
    interview = await run('venture.interview.answer', { questionId: question.id, answer });
  }
  const drafted = await run('venture.blueprint.draft', { useTemplate: true });
  const priced = await run('venture.blueprint.update', { patch: { offers: drafted.blueprint.offers.map((offer: any) => ({ id: offer.id, unitPrice: '1000' })) } });
  await run('venture.blueprint.accept', { digest: priced.blueprint.digest });
  await ventureAction(deps, owner, 'approve', 'seed.stage', tx => { tx.touch({ launchStage: 'approve-each' }); });
  // This port answers no judge call, so the judge stays with the owner here (2C1's own tests cover it).
  await run('venture.judge.auto.set', { auto: false });
  const client = await run('venture.client.add', { name: 'Asha Rao', email: 'asha@example.com', countryCode: 'IN' });
  return { deps, models, run, client, offers: priced.blueprint.offers as { id: string; playbookOffer?: string }[] };
}

test('through a real run: the drafted posts reach the file by their numbers, each on its slot date from code', async () => {
  const env = await socialBusiness();
  assert.equal(env.offers[0].playbookOffer, 'content-calendar');
  const order = await env.run('venture.order.create', { clientId: env.client.id, offerId: 'offer_1', request: 'Posts for our morning yoga classes in Goa this month.', intake: { calendar: CALENDAR } });
  const waiting = await env.run('venture.delivery.run', { orderId: order.id });
  const sections = [{ heading: 'Drafts', lines: DRAFTS }, { heading: 'Alt text', lines: [ALT] }, { heading: 'Hashtags', lines: ['Use #yoga and #goa on every post.'] }];
  env.models.drafts.push({
    title: 'Posts for November', questionsForClient: [],
    sections: sections.map(section => ({ heading: section.heading, parts: section.lines.map(text => ({ kind: 'text', text, ref: '' })) })),
  });
  const ready: DeliveryRunView = await env.run('venture.delivery.approve', { runId: waiting.id, digest: waiting.preview.digest });
  assert.equal(ready.canAccept, true, ready.acceptBlocked ?? '');

  const before = await env.run('venture.social.calendar', { runId: ready.id }) as SocialCalendarFile;
  assert.equal(before.rows, 0);
  assert.deepEqual(before.blocked.map(item => item.draftId), [1, 2, 3, 4, 5, 6].map(n => `${ready.id}.post-${n}`));
  assert.ok(before.blocked.every(item => /You have not approved this draft\./.test(item.line)), before.blocked[0].line);

  await env.run('venture.delivery.review', { runId: ready.id, verdict: 'accepted' });
  await env.run('venture.share.create', { deliveryId: ready.id });
  await env.run('venture.share.recordAnswer', { draftId: ready.id, answer: 'approved' });
  const file = await env.run('venture.social.calendar', { runId: ready.id }) as SocialCalendarFile;
  assert.deepEqual(file.blocked, []);
  assert.equal(file.rows, 6);
  const slots = planCalendar(CALENDAR);
  const byPost = rowsOf(file.csv).map(line => line.split(',').slice(0, 2).join(' '));
  assert.deepEqual(byPost, [...slots].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)).map(slot => `${slot.date} ${slot.channel}`));
  // The same ids the posting buttons take: the share list names post-1 as the first LinkedIn line, not the intro.
  const shared = await env.run('venture.share.list', { deliveryId: ready.id });
  assert.equal(shared.posts[0].draftId, `${ready.id}.post-1`);
  assert.equal(shared.posts[0].text, LINKEDIN[0].slice('LinkedIn: '.length));
  assert.ok(file.csv.includes(`${slots[0].date},linkedin,"${LINKEDIN[0].slice('LinkedIn: '.length)}",`), file.csv);
});
