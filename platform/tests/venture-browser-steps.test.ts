// Honest browser steps (catalogue K2, K3; audit safety item 8; Ink v2 wave 2 package 2B2). Each posting step (the text
// box, the post button, the confirmation) is an ordered list of candidates, each with its own checked date; a candidate
// counts only when it matches exactly one visible element. The post button is found again right before the click and
// nothing is posted if the page changed. A post is confirmed by the platform's own confirm element or its own HTTP
// response; with neither it is unknown, after exactly one click. venture.posting.checkSteps dates the candidates that
// work without typing or clicking, and the owner can repair a step by clicking the element once.
// No real browser: a fake Playwright module and page (venture-fake-page.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Context } from '../runtime/contracts.ts';
import type {
  ConnectorCard, ConnectorPostRecord, DeliveryRunRecord, PostingProposal, PostingStepsRecord, PostingStepsView, QueueDecision, QueueList, VentureDeps,
} from '../runtime/venture/contracts.ts';
import { houseStyleFindings, listRecords } from '../runtime/venture/records.ts';
import { handlers as build } from '../runtime/venture/build/index.ts';
import { BROWSER_SCRIPTS, LAUNCH_OPTIONS, PICK_ELEMENT, candidateKey } from '../runtime/venture/build/browser.ts';
import { channelHold } from '../runtime/venture/build/posting.ts';
import { call as view, code, owner, phone, setup, type Env } from './venture-views-env.ts';
import { seedPostDraft, seedPostPlaybook } from './venture-post-drafts.ts';
import { BUTTON, LINKEDIN_KEYS, LINKEDIN_PAGE, X_PAGE, el, fakeBrowserPage, fakeKey, type FakePageModel, type FakeResponse } from './venture-fake-page.ts';

const agent: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'mcp' };
type Handler = (deps: VentureDeps, ctx: Context, payload: unknown) => Promise<unknown>;
const method = <T>(deps: VentureDeps, name: string, payload: unknown, ctx: Context = owner) => (build as Record<string, Handler>)[name](deps, ctx, payload) as Promise<T>;
const TODAY = '2026-10-15'; // the views env clock

async function browserEnv(model: FakePageModel, options: { timeout?: number; host?: string } = {}) {
  const env = await setup();
  const fake = fakeBrowserPage(model);
  env.deps = { ...env.deps, ...(options.host ? { host: options.host } : {}), connectors: { browser: fake.port, appReviewed: [], postTimeoutMs: options.timeout ?? 200 } } as VentureDeps;
  return { env, deps: env.deps, fake };
}

const PASSED = [{ playbook: 'social-agency', check: 'claims', outcome: 'pass' as const, detail: 'ok' }];
async function socialDraft(env: Env, lines: string[]): Promise<DeliveryRunRecord> {
  const social = await seedPostPlaybook(env.deps, 'social-agency');
  const run = await seedPostDraft(env.deps, lines, { playbookId: social.id, playbookChecks: PASSED });
  await method(env.deps, 'venture.share.create', { deliveryId: run.id });
  await method(env.deps, 'venture.share.recordAnswer', { draftId: run.id, answer: 'approved' });
  return run;
}

/** Proposes the draft's first post and approves it on Today, as the owner does. */
async function postThroughToday(env: Env, line: string): Promise<{ decision: QueueDecision; post: ConnectorPostRecord }> {
  const run = await socialDraft(env, [line]);
  const proposal = await method<PostingProposal>(env.deps, 'venture.posting.propose', { draftId: `${run.id}.post-1` }, agent);
  const today = await view<QueueList>(env, 'venture.queue.list');
  const row = today.rows.find(item => item.kind === 'connector')!;
  const decision = await view<QueueDecision>(env, 'venture.queue.decide', { id: row.id, digest: row.digest, action: 'approve', viewed: true });
  const post = listRecords(env.store.read(), 'venture-connector-post').find(item => item.id === proposal.postId)!;
  return { decision, post };
}

const checkSteps = (deps: VentureDeps, connectorId = 'x', ctx: Context = owner) => method<PostingStepsView>(deps, 'venture.posting.checkSteps', { connectorId }, ctx);
const browserOption = (cards: ConnectorCard[], id: string) => cards.find(card => card.id === id)!.postingOptions.find(option => option.mode === 'owner-browser-session')!;

// ---------------------------------------------------------------------------
// The shipped steps
// ---------------------------------------------------------------------------

test('each step is an ordered candidate list, every one unchecked in the shipped data, the old selectors first', () => {
  for (const script of Object.values(BROWSER_SCRIPTS)) {
    for (const step of ['textbox', 'submit', 'confirm'] as const) {
      const candidates = script.steps[step];
      assert.ok(candidates.length >= 1, `${script.name} ${step}`);
      for (const candidate of candidates) {
        assert.ok(['test-id', 'role', 'aria-label', 'xpath'].includes(candidate.kind), candidate.kind);
        assert.equal(candidate.checkedOn, null, `${script.name} ${step} ${candidateKey(candidate)} is never checked in the shipped data`);
        assert.ok(candidate.value.length > 0);
      }
      assert.equal(new Set(candidates.map(candidateKey)).size, candidates.length, 'keys are unique');
    }
    assert.equal(script.response.checkedOn, null, `${script.name}'s response pattern is unchecked too`);
    assert.ok(script.response.path.length > 0);
    // Button and confirm words per UI language, English and Hindi, as data.
    const submitNames = script.steps.submit.filter(candidate => candidate.kind === 'role');
    assert.ok(submitNames.some(candidate => candidate.lang === 'en'));
    assert.ok(submitNames.some(candidate => candidate.lang === 'hi' && candidate.name === 'पोस्ट करें'));
    assert.ok((script.confirmWords.en ?? []).length > 0 && (script.confirmWords.hi ?? []).length > 0);
  }
  // Today's selectors stay each step's first candidate.
  assert.deepEqual(BROWSER_SCRIPTS.x.steps.textbox[0], { kind: 'test-id', value: 'tweetTextarea_0', checkedOn: null });
  assert.deepEqual(BROWSER_SCRIPTS.x.steps.submit[0], { kind: 'test-id', value: 'tweetButton', checkedOn: null });
  assert.deepEqual(BROWSER_SCRIPTS.x.steps.confirm[0], { kind: 'test-id', value: 'toast', checkedOn: null });
  assert.equal(fakeKey(BROWSER_SCRIPTS.linkedin.steps.textbox[0]), LINKEDIN_KEYS.box);
  assert.equal(fakeKey(BROWSER_SCRIPTS.linkedin.steps.submit[0]), LINKEDIN_KEYS.button);
  assert.deepEqual(LAUNCH_OPTIONS, { headless: false });
});

// ---------------------------------------------------------------------------
// Exactly one visible element, through Today
// ---------------------------------------------------------------------------

test('Today: when the first candidate matches two visible elements and the second exactly one, the second is used', async () => {
  const model: FakePageModel = {
    ...LINKEDIN_PAGE,
    elements: { ...LINKEDIN_PAGE.elements, [LINKEDIN_KEYS.button]: [BUTTON(), BUTTON()], 'role:button[name=Post]': [BUTTON(), BUTTON({ visible: false })] },
  };
  const { env, fake } = await browserEnv(model);
  const { decision, post } = await postThroughToday(env, 'LinkedIn: Our cafe opens at 8 every weekday.');
  assert.equal(decision.outcome, 'done', decision.line);
  assert.equal(post.state, 'applied');
  assert.deepEqual(fake.calls.filter(call => call.startsWith('click')), ['click role:button[name=Post]']);
  assert.equal(fake.clicks(), 1);
});

test('Today: when no candidate matches exactly one visible element, nothing is clicked and nothing is posted', async () => {
  const model: FakePageModel = {
    ...LINKEDIN_PAGE,
    elements: { ...LINKEDIN_PAGE.elements, [LINKEDIN_KEYS.button]: [BUTTON(), BUTTON()], 'role:button[name=Post]': [BUTTON({ visible: false })] },
  };
  const { env, fake } = await browserEnv(model);
  const { decision, post } = await postThroughToday(env, 'LinkedIn: Our cafe opens at 8 every weekday.');
  assert.equal(decision.line, "LinkedIn's post button was not found the way Chausar knows it. Nothing was posted.");
  assert.equal(post.state, 'rejected', 'nothing went out, so it may be proposed again');
  assert.equal(fake.clicks(), 0);
  assert.deepEqual(houseStyleFindings(decision.line), []);
});

test('the post button is found again right before the click; a changed box or text sends nothing', async () => {
  let reads = 0;
  const moving: FakePageModel = { ...X_PAGE, elements: { ...X_PAGE.elements, 'test-id:tweetButton': [BUTTON({ box: () => ({ x: 10, y: (reads += 1) > 1 ? 90 : 10, width: 80, height: 30 }) })] } };
  const moved = fakeBrowserPage(moving);
  const result = await moved.post();
  assert.deepEqual(result, { outcome: 'not-sent', line: 'The page changed before posting. Nothing was posted.' });
  assert.equal(moved.clicks(), 0);

  let texts = 0;
  const relabelled: FakePageModel = { ...X_PAGE, elements: { ...X_PAGE.elements, 'test-id:tweetButton': [BUTTON({ text: () => ((texts += 1) > 1 ? 'Delete' : 'Post') })] } };
  const changed = fakeBrowserPage(relabelled);
  assert.equal((await changed.post()).line, 'The page changed before posting. Nothing was posted.');
  assert.equal(changed.clicks(), 0);

  // A box that moves less than a pixel is the same box.
  let nudges = 0;
  const steady: FakePageModel = { ...X_PAGE, elements: { ...X_PAGE.elements, 'test-id:tweetButton': [BUTTON({ box: () => ({ x: 10 + ((nudges += 1) > 1 ? 0.4 : 0), y: 10, width: 80, height: 30 }) })] } };
  assert.equal((await fakeBrowserPage(steady).post()).outcome, 'posted');
});

// ---------------------------------------------------------------------------
// Confirmation by the platform (K3)
// ---------------------------------------------------------------------------

const CREATE_TWEET = 'https://x.com/i/api/graphql/AbC123/CreateTweet';
const NORM_SHARES = 'https://www.linkedin.com/voyager/api/contentcreation/normShares';
const tweetBody = (restId = '1849000000000000001') => JSON.stringify({ data: { create_tweet: { tweet_results: { result: { rest_id: restId, legacy: { full_text: 'Hello' } } } } } });
const xErrors = (codeNumber: number, message: string) => JSON.stringify({ errors: [{ code: codeNumber, message }], data: {} });
/** X's compose page where no toast shows after the click, and the platform answers with these responses. */
const quiet = (responses: FakeResponse[]): FakePageModel => ({ ...X_PAGE, afterClick: {}, responses });

test('the response rules are data, unchecked against the live site: X needs no errors and a rest_id, LinkedIn a 201', () => {
  const { x, linkedin } = BROWSER_SCRIPTS;
  for (const script of [x, linkedin]) {
    assert.equal(script.response.checkedOn, null);
    assert.equal(script.response.rulesCheckedOn, null, `${script.name}'s status and body rules are not checked against the live site`);
  }
  assert.deepEqual([x.response.okStatus, x.response.body, x.response.challengeCodes], [[200], { absent: ['errors'], present: ['rest_id'] }, [226]]);
  assert.deepEqual([linkedin.response.okStatus, linkedin.response.body, linkedin.response.challengeCodes], [[201], null, []]);
});

test("posted when the confirm element shows or the platform's own response passes its rule; else unknown after exactly one click", async () => {
  const shown = fakeBrowserPage(X_PAGE);
  const byElement = await shown.post();
  assert.equal(byElement.outcome, 'posted');
  assert.equal(byElement.line, 'X showed that the post went out.');
  assert.equal(shown.clicks(), 1);

  const byResponse = fakeBrowserPage(quiet([{ url: CREATE_TWEET, status: 200, body: tweetBody() }]));
  const answered = await byResponse.post();
  assert.equal(answered.outcome, 'posted');
  assert.equal(answered.line, 'X answered that it took the post.');
  assert.equal(byResponse.clicks(), 1);
  const linkedin = await fakeBrowserPage({ ...LINKEDIN_PAGE, afterClick: {}, responses: [{ url: NORM_SHARES, status: 201, body: '{}' }] }).post('Hello', 'linkedin');
  assert.equal(linkedin.outcome, 'posted');

  for (const model of [
    { ...X_PAGE, afterClick: {} },
    // X answers 200 when it refuses a post: an errors list, or no rest_id, is no confirmation.
    quiet([{ url: CREATE_TWEET, status: 200, body: '{"data":{}}' }]),
    quiet([{ url: CREATE_TWEET, status: 200, body: xErrors(187, 'Status is a duplicate.') }]),
    quiet([{ url: CREATE_TWEET, status: 200, body: xErrors(344, 'You are over the daily limit for sending posts.') }]),
    quiet([{ url: CREATE_TWEET, status: 200, body: JSON.stringify({ errors: [{ code: 187 }], data: { create_tweet: { tweet_results: { result: { rest_id: '1' } } } } }) }]),
    quiet([{ url: CREATE_TWEET, status: 200, body: 'not json' }]),
    quiet([{ url: CREATE_TWEET, status: 201, body: tweetBody() }]),
    quiet([{ url: 'https://x.com/i/api/graphql/AbC123/HomeTimeline', status: 200, body: tweetBody() }]),
    quiet([{ url: 'https://evil.example/i/api/graphql/AbC123/CreateTweet', status: 200, body: tweetBody() }]),
    { ...LINKEDIN_PAGE, afterClick: {}, responses: [{ url: NORM_SHARES, status: 200, body: '{}' }] },
    // A notice that is not the platform's confirmation words (an error in the toast) does not confirm.
    { ...X_PAGE, afterClick: { elements: { 'test-id:toast': [el({}, { text: 'Something went wrong. Try reloading.' })] } } },
  ] as FakePageModel[]) {
    const fake = fakeBrowserPage(model);
    const result = await fake.post('Hello', model.url?.includes('linkedin') ? 'linkedin' : 'x', 120);
    const label = JSON.stringify(model.responses ?? model.afterClick);
    assert.equal(result.outcome, 'unknown', label);
    assert.match(result.line, /may have gone out/);
    assert.equal('hold' in result, false, label);
    assert.equal(fake.clicks(), 1, 'never a second click');
  }
});

test("a 403 or 429 on the post request, or X's automation code 226, ends unknown and holds the channel for a check", async () => {
  for (const [model, connectorId, site] of [
    [quiet([{ url: CREATE_TWEET, status: 403 }]), 'x', 'x.com'],
    [quiet([{ url: CREATE_TWEET, status: 429 }]), 'x', 'x.com'],
    [quiet([{ url: CREATE_TWEET, status: 200, body: xErrors(226, 'This request looks like it might be automated.') }]), 'x', 'x.com'],
    [{ ...LINKEDIN_PAGE, afterClick: {}, responses: [{ url: NORM_SHARES, status: 403 }] }, 'linkedin', 'linkedin.com'],
  ] as [FakePageModel, string, string][]) {
    const fake = fakeBrowserPage(model);
    const result = await fake.post('Hello', connectorId, 120);
    assert.equal(result.outcome, 'unknown', JSON.stringify(model.responses));
    assert.deepEqual(result.outcome === 'unknown' && result.hold, { kind: 'challenge', site });
    assert.equal(fake.clicks(), 1);
    assert.equal(JSON.parse(fake.disk.files.get(`C:/profiles/${connectorId}.hold.json`) ?? 'null')?.kind, 'challenge');
    const next = await fake.post('Hello', connectorId, 120);
    assert.equal(next.outcome, 'not-sent', 'the hold stops the next post before the browser opens');
    assert.equal(fake.launched(), 1);
  }
  // Through Today the hold reaches the vault, so the channel is held for every post of this business.
  const { env } = await browserEnv(quiet([{ url: CREATE_TWEET, status: 200, body: xErrors(226, 'This request looks like it might be automated.') }]));
  const { post } = await postThroughToday(env, 'X: Fresh pastries at 8.');
  assert.equal(post.state, 'outcome_unknown');
  assert.equal(channelHold(env.store.read(), 'x', env.now())?.cause, 'challenge');
});

test('Today: a 2xx answer without proof ends outcome_unknown after one click, and the post is not proposed again until resolved', async () => {
  const { env, deps, fake } = await browserEnv(quiet([{ url: CREATE_TWEET, status: 200, body: '{"data":{}}' }]));
  const { decision, post } = await postThroughToday(env, 'X: Fresh pastries at 8.');
  assert.equal(post.state, 'outcome_unknown');
  assert.match(decision.line, /may have gone out/);
  assert.equal(fake.clicks(), 1);
  await assert.rejects(method(deps, 'venture.posting.propose', { draftId: `${post.draftId}.post-1` }, agent), code('JOURNAL_OUTCOME_UNKNOWN'));
  assert.equal(fake.clicks(), 1);
});

test('a post past its click deadline is never clicked, even while the browser runs on after the journal closed', async () => {
  const late = fakeBrowserPage(X_PAGE);
  const result = await late.post('Hello', 'x', 300, { clickBy: Date.now() - 1 });
  assert.deepEqual(result, { outcome: 'not-sent', line: 'X took too long, so Chausar did not press its post button. Nothing was posted.' });
  assert.equal(late.clicks(), 0);

  // The button takes longer to answer than the whole post may take: the journal says unknown, and no click follows.
  const slow: FakePageModel = { ...X_PAGE, elements: { ...X_PAGE.elements, 'test-id:tweetButton': [BUTTON({ slowMs: 300 })] } };
  const { env, fake } = await browserEnv(slow, { timeout: 15 });
  const { post } = await postThroughToday(env, 'X: Fresh pastries at 8.');
  assert.equal(post.state, 'outcome_unknown');
  await new Promise(resolve => setTimeout(resolve, 1200));
  assert.equal(fake.clicks(), 0, 'no click after the deadline');
});

test('after typing, the box is read back; text that differs is never posted, and neither text is kept', async () => {
  const garbled = fakeBrowserPage({ ...X_PAGE, typedShows: 'Helo wrld' });
  const result = await garbled.post('Hello world');
  assert.deepEqual(result, { outcome: 'not-sent', line: "X's post box did not show the exact text, so Chausar did not post it. Nothing was posted." });
  assert.equal(garbled.clicks(), 0);
  assert.ok(!JSON.stringify(result).includes('Helo') && !JSON.stringify(result).includes('Hello'));
  // Spaces and line breaks the box adds are not a difference.
  assert.equal((await fakeBrowserPage({ ...X_PAGE, typedShows: '  Hello\n world ' }).post('Hello world')).outcome, 'posted');
});

test('a challenge the page draws after it loads is a hold, not "not found", and the pick never opens on it', async () => {
  let reads = 0;
  const drawn: FakePageModel = { ...X_PAGE, elements: {}, notice: () => ((reads += 1) > 1 ? 'Verify you are human to continue.' : '') };
  const fake = fakeBrowserPage(drawn);
  const result = await fake.post('Hello', 'x', 60);
  assert.equal(result.outcome, 'not-sent');
  assert.deepEqual(result.outcome === 'not-sent' && result.hold, { kind: 'challenge', site: 'x.com' });
  assert.doesNotMatch(result.line, /not found/);
  assert.equal(JSON.parse(fake.disk.files.get('C:/profiles/x.hold.json') ?? 'null')?.kind, 'challenge');

  let checks = 0;
  const picking: FakePageModel = {
    ...X_PAGE, elements: { 'test-id:tweetTextarea_0': X_PAGE.elements!['test-id:tweetTextarea_0'] }, pick: { testId: 'sendPostButton' },
    picked: { 'test-id:sendPostButton': [BUTTON({ clicked: true })] }, notice: () => ((checks += 1) > 1 ? 'Verify you are human to continue.' : ''),
  };
  const { deps, fake: picker } = await browserEnv(picking, { timeout: 60 });
  await assert.rejects(checkSteps(deps), code('CHANNEL_CHALLENGED'));
  assert.ok(!picker.calls.some(call => call.startsWith('pick')), picker.calls.join('\n'));
});

test("the post's address is kept when the confirm element or the response shows it, and the journal keeps it as url", async () => {
  const status = 'https://x.com/lumen_cafe/status/1849000000000000001';
  const linked: FakePageModel = { ...X_PAGE, afterClick: { elements: { 'test-id:toast': [el({}, { text: 'Your post was sent. View', links: ['https://x.com/home', status] })] } } };
  const fromToast = await fakeBrowserPage(linked).post();
  assert.equal(fromToast.outcome === 'posted' && fromToast.url, status);

  const share = 'https://www.linkedin.com/feed/update/urn:li:share:7251234567890123456';
  const answered: FakePageModel = {
    ...LINKEDIN_PAGE, afterClick: {},
    responses: [{ url: 'https://www.linkedin.com/voyager/api/contentcreation/normShares', status: 201, body: JSON.stringify({ value: { url: share } }) }],
  };
  const fromResponse = await fakeBrowserPage(answered).post('Hello', 'linkedin');
  assert.equal(fromResponse.outcome === 'posted' && fromResponse.url, share);

  const plain = await fakeBrowserPage(X_PAGE).post();
  assert.equal(plain.outcome === 'posted' && plain.url, null, 'no address shown, none kept');

  const { env } = await browserEnv(linked);
  const { post } = await postThroughToday(env, 'X: Fresh pastries at 8.');
  assert.equal(post.state, 'applied');
  assert.equal(post.outcome?.url, status);
});

// ---------------------------------------------------------------------------
// Language alternatives
// ---------------------------------------------------------------------------

test("with the page in Hindi, the role candidate matches by the Hindi name in data; it stays unchecked until a check dates it", async () => {
  const hindi: FakePageModel = {
    ...X_PAGE, lang: 'hi-IN',
    elements: { 'test-id:tweetTextarea_0': X_PAGE.elements!['test-id:tweetTextarea_0'], 'role:button[name=Post]': [BUTTON()], 'role:button[name=पोस्ट करें]': [BUTTON({ text: 'पोस्ट करें' })] },
    afterClick: { elements: { 'test-id:toast': [el({}, { text: 'आपकी पोस्ट भेज दी गई।' })] } },
  };
  const fake = fakeBrowserPage(hindi);
  const result = await fake.post();
  assert.equal(result.outcome, 'posted', result.line);
  assert.deepEqual(fake.calls.filter(call => call.startsWith('click')), ['click role:button[name=पोस्ट करें]'], 'the English name is for an English page');

  // Unchecked in the shipped data; a check on a Hindi page dates the Hindi name and leaves the English one alone.
  const hindiName = BROWSER_SCRIPTS.x.steps.submit.find(candidate => candidate.lang === 'hi')!;
  assert.equal(hindiName.checkedOn, null);
  const { deps } = await browserEnv(hindi);
  const checked = await checkSteps(deps);
  const submit = checked.steps.find(item => item.step === 'submit')!.candidates;
  assert.equal(submit.find(candidate => candidate.key === candidateKey(hindiName))!.checkedOn, TODAY);
  assert.equal(submit.find(candidate => candidate.lang === 'en' && candidate.kind === 'role')!.checkedOn, null, 'an English name is not checked on a Hindi page');
  assert.equal(submit.find(candidate => candidate.kind === 'test-id')!.checkedOn, null);
});

// ---------------------------------------------------------------------------
// venture.posting.checkSteps (K2's dry run) and the date on Connections
// ---------------------------------------------------------------------------

test('checkSteps dates the box and button candidates that match exactly one visible element, never the confirmation', async () => {
  // A toast that happens to be on the page (or an error alert) proves nothing about posting: the dry run skips it.
  const withToast: FakePageModel = { ...X_PAGE, elements: { ...X_PAGE.elements, 'test-id:toast': [el({}, { text: 'Your post was sent.' })] } };
  const { env, deps, fake } = await browserEnv(withToast);
  const before = await method<ConnectorCard[]>(deps, 'venture.connectors.list', {});
  assert.deepEqual([browserOption(before, 'x').stepsCheckedOn, browserOption(before, 'x').boxAndButtonCheckedOn], [null, null]);
  assert.match(browserOption(before, 'x').what, /Not yet checked against the live site\./);

  const checked = await checkSteps(deps);
  assert.ok(!fake.calls.some(call => call.startsWith('fill') || call.startsWith('click')), fake.calls.join('\n'));
  assert.equal(fake.closedCount(), 1);
  assert.equal(checked.connectorId, 'x');
  assert.equal(checked.stepsCheckedOn, null, 'the confirmation waits for a post');
  assert.equal(checked.boxAndButtonCheckedOn, TODAY);
  const first = (step: string) => checked.steps.find(item => item.step === step)!.candidates[0];
  assert.deepEqual([first('textbox').checkedOn, first('submit').checkedOn, first('confirm').checkedOn], [TODAY, TODAY, null]);
  for (const item of checked.steps) for (const candidate of item.candidates.slice(1)) assert.equal(candidate.checkedOn, null, candidate.key);
  assert.ok(checked.steps.every(item => item.candidates.every(candidate => candidate.addedBy === 'chausar')));
  const [record] = listRecords(env.store.read(), 'venture-posting-steps') as PostingStepsRecord[];
  assert.equal(record.connectorId, 'x');
  assert.deepEqual(record.checked.map(item => [item.step, item.checkedOn]).sort(), [['submit', TODAY], ['textbox', TODAY]]);

  const after = await method<ConnectorCard[]>(deps, 'venture.connectors.list', {});
  assert.deepEqual([browserOption(after, 'x').stepsCheckedOn, browserOption(after, 'x').boxAndButtonCheckedOn], [null, TODAY]);
  assert.match(browserOption(after, 'x').what, /Not yet checked/, 'not every step is checked yet');
  assert.equal(browserOption(after, 'linkedin').boxAndButtonCheckedOn, null, 'one platform at a time');
  assert.equal(after.find(card => card.id === 'instagram')!.postingOptions.find(option => option.mode === 'owner-browser-session')!.stepsCheckedOn, undefined);
});

test("a post confirmed by the platform's response dates the response rule, so every step can count as checked", async () => {
  const { env, deps } = await browserEnv(quiet([{ url: CREATE_TWEET, status: 200, body: tweetBody() }]));
  await checkSteps(deps);
  const { post } = await postThroughToday(env, 'X: Fresh pastries at 8.');
  assert.equal(post.state, 'applied');
  const view2 = await checkSteps(deps);
  const confirm = view2.steps.find(item => item.step === 'confirm')!;
  const { method: verb, path } = BROWSER_SCRIPTS.x.response;
  assert.deepEqual(confirm.response, { key: `response:${verb} ${path}`, method: verb, path, checkedOn: TODAY });
  assert.equal(confirm.candidates[0].checkedOn, null, 'the toast never showed');
  assert.equal(view2.stepsCheckedOn, TODAY);
  const cards = await method<ConnectorCard[]>(deps, 'venture.connectors.list', {});
  assert.equal(browserOption(cards, 'x').stepsCheckedOn, TODAY);
  assert.doesNotMatch(browserOption(cards, 'x').what, /Not yet checked/);
});

test("checkSteps: the confirmation can't show before a post, so it is dated by the post that went out", async () => {
  const { env, deps } = await browserEnv(X_PAGE);
  const checked = await checkSteps(deps);
  assert.equal(checked.stepsCheckedOn, null);
  assert.match(checked.line, /confirm/i);
  assert.deepEqual(houseStyleFindings(checked.line), []);
  assert.equal(checked.steps.find(item => item.step === 'confirm')!.candidates[0].checkedOn, null);

  const { post } = await postThroughToday(env, 'X: Fresh pastries at 8.');
  assert.equal(post.state, 'applied');
  const view2 = await checkSteps(deps);
  assert.equal(view2.steps.find(item => item.step === 'confirm')!.candidates[0].checkedOn, TODAY, 'the post that went out dated its confirmation');
  assert.equal(view2.stepsCheckedOn, TODAY);
});

test('checkSteps is refused signed out, on the hosted server, for picture platforms, from the phone and from an agent', async () => {
  const { deps, fake } = await browserEnv({ ...X_PAGE, url: 'https://x.com/i/flow/login' });
  await assert.rejects(checkSteps(deps), (error: any) => error.code === 'POSTING_NOT_SIGNED_IN' && /Sign in to X/.test(error.message));
  assert.equal(fake.closedCount(), 1);
  await assert.rejects(checkSteps(deps, 'x', phone), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(checkSteps(deps, 'x', agent), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(checkSteps(deps, 'instagram'), code('NOT_BUILT_YET'));
  await assert.rejects(checkSteps(deps, 'stripe'), code('INVALID_VENTURE_REQUEST'));
  const hosted = await browserEnv(X_PAGE, { host: 'hosted-web' });
  await assert.rejects(checkSteps(hosted.deps), code('TIER_UNAVAILABLE'));
  assert.equal(hosted.fake.launched(), 0);
  // A security check on the page holds the channel, as a post would.
  const challenged = await browserEnv({ ...X_PAGE, status: 403 });
  await assert.rejects(checkSteps(challenged.deps), code('CHANNEL_CHALLENGED'));
  await assert.rejects(checkSteps(challenged.deps), code('CHANNEL_CHALLENGED'));
  assert.equal(challenged.fake.launched(), 1, 'the hold stops the second check before the browser opens');
});

// ---------------------------------------------------------------------------
// Owner-assisted repair
// ---------------------------------------------------------------------------

test('a step with no unique candidate asks the owner to click it once; the picked element becomes dated candidates the next post uses', async () => {
  const picked = { testId: 'sendPostButton', role: 'button', name: 'Send post', ariaLabel: 'Send post', xpath: '//*[@id="layers"]/div/button[2]' };
  const model: FakePageModel = {
    ...X_PAGE,
    elements: { 'test-id:tweetTextarea_0': X_PAGE.elements!['test-id:tweetTextarea_0'] },
    pick: picked,
    picked: {
      'test-id:sendPostButton': [BUTTON({ clicked: true })], 'role:button[name=Send post]': [BUTTON({ clicked: true })], 'aria-label:Send post': [BUTTON({ clicked: true })],
      'xpath://*[@id="layers"]/div/button[2]': [BUTTON({ clicked: true })],
    },
  };
  const { env, deps, fake } = await browserEnv(model);
  const checked = await checkSteps(deps);
  assert.deepEqual(fake.calls.filter(call => call.startsWith('pick')), ['pick submit'], 'only the step that has no unique candidate, and never the confirmation');
  const submit = checked.steps.find(item => item.step === 'submit')!.candidates;
  const added = submit.filter(candidate => candidate.addedBy === 'owner');
  assert.deepEqual(added.map(candidate => [candidate.kind, candidate.value, candidate.name ?? null, candidate.checkedOn]), [
    ['test-id', 'sendPostButton', null, TODAY], ['role', 'button', 'Send post', TODAY], ['aria-label', 'Send post', null, TODAY], ['xpath', '//*[@id="layers"]/div/button[2]', null, TODAY],
  ]);
  assert.ok(fake.calls.includes('unmark'), 'the mark on the clicked element is removed after');
  assert.equal(submit.indexOf(added[0]), 0, "the owner's own pick is tried first");
  const [record] = listRecords(env.store.read(), 'venture-posting-steps') as PostingStepsRecord[];
  assert.equal(record.added.length, 4);
  assert.ok(record.added.every(item => item.addedOn === TODAY && item.step === 'submit'));

  // The next post uses the picked candidate. (The tweetButton is still missing on this page.)
  const { post } = await postThroughToday(env, 'X: Fresh pastries at 8.');
  assert.equal(post.state, 'applied');
  assert.ok(fake.calls.includes('click test-id:sendPostButton'), fake.calls.join('\n'));
});

test('a picked attribute that holds a secret or a card number is not kept', async () => {
  const card = ['4111', '1111', '1111', '1111'].join(' ');
  const model: FakePageModel = {
    ...X_PAGE,
    elements: { 'test-id:tweetTextarea_0': X_PAGE.elements!['test-id:tweetTextarea_0'] },
    pick: { testId: 'sendPostButton', role: null, name: null, ariaLabel: `Pay with ${card}`, xpath: null },
    picked: { 'test-id:sendPostButton': [BUTTON({ clicked: true })], [`aria-label:Pay with ${card}`]: [BUTTON({ clicked: true })] },
  };
  const { env, deps } = await browserEnv(model);
  const checked = await checkSteps(deps);
  const added = checked.steps.find(item => item.step === 'submit')!.candidates.filter(candidate => candidate.addedBy === 'owner');
  assert.deepEqual(added.map(candidate => candidate.value), ['sendPostButton']);
  assert.ok(!JSON.stringify(env.store.read()).includes('4111'), 'the card number is nowhere in the vault');
});

test('a picked element that does not match exactly one visible element is not added', async () => {
  const model: FakePageModel = {
    ...X_PAGE,
    elements: { 'test-id:tweetTextarea_0': X_PAGE.elements!['test-id:tweetTextarea_0'] },
    pick: { testId: 'sendPostButton', role: 'button', name: 'Send post', ariaLabel: null, xpath: null },
    picked: { 'test-id:sendPostButton': [BUTTON(), BUTTON()] },
  };
  const { deps } = await browserEnv(model);
  const checked = await checkSteps(deps);
  assert.deepEqual(checked.steps.find(item => item.step === 'submit')!.candidates.filter(candidate => candidate.addedBy === 'owner'), []);
  assert.equal(checked.stepsCheckedOn, null);
});

test('a pick is kept only for the ways that find the very element the owner clicked, and only with an anchored xpath', async () => {
  const model: FakePageModel = {
    ...X_PAGE,
    elements: { 'test-id:tweetTextarea_0': X_PAGE.elements!['test-id:tweetTextarea_0'] },
    pick: { testId: 'sendPostButton', role: 'button', name: 'Send post', ariaLabel: 'Send post', xpath: '/html/body/div[2]/button' },
    picked: {
      'test-id:sendPostButton': [BUTTON({ clicked: true })],
      // This finds one element, but not the one the owner clicked.
      'role:button[name=Send post]': [BUTTON()],
      // A positional xpath with no id or test id to hold on to is dropped, even when it finds the element.
      'xpath:/html/body/div[2]/button': [BUTTON({ clicked: true })],
      'aria-label:Send post': [BUTTON({ clicked: true })],
    },
  };
  const { deps } = await browserEnv(model);
  const checked = await checkSteps(deps);
  const added = checked.steps.find(item => item.step === 'submit')!.candidates.filter(candidate => candidate.addedBy === 'owner');
  assert.deepEqual(added.map(candidate => [candidate.kind, candidate.value]), [['test-id', 'sendPostButton'], ['aria-label', 'Send post']]);
});

// A small stand-in for the page's own document, to run the pick overlay itself.
type DomNode = {
  nodeType: 1; tagName: string; attrs: Map<string, string>; parentElement: DomNode | null; parentNode: DomNode | null; children: DomNode[];
  textContent: string; isContentEditable: boolean;
  getAttribute(name: string): string | null; setAttribute(name: string, value: string): void; removeAttribute(name: string): void; hasAttribute(name: string): boolean;
  appendChild(child: DomNode): DomNode; removeChild(child: DomNode): DomNode;
};
function domNode(tag: string, attrs: Record<string, string> = {}, children: DomNode[] = [], text = ''): DomNode {
  const node: DomNode = {
    nodeType: 1, tagName: tag.toUpperCase(), attrs: new Map(Object.entries(attrs)), parentElement: null, parentNode: null, children: [], textContent: text,
    isContentEditable: false,
    getAttribute: name => node.attrs.get(name) ?? null,
    setAttribute: (name, value) => { node.attrs.set(name, String(value)); },
    removeAttribute: name => { node.attrs.delete(name); },
    hasAttribute: name => node.attrs.has(name),
    appendChild: child => { child.parentElement = node; child.parentNode = node; node.children.push(child); return child; },
    removeChild: child => { node.children = node.children.filter(item => item !== child); child.parentElement = null; child.parentNode = null; return child; },
  };
  for (const child of children) node.appendChild(child);
  if (!text) node.textContent = children.map(child => child.textContent).join('');
  return node;
}
type Listener = (event: unknown) => void;
type FakeEvent = { type: string; target: DomNode; prevented: boolean; stopped: boolean; preventDefault(): void; stopImmediatePropagation(): void };
const fakeEvent = (type: string, target: DomNode): FakeEvent => ({
  type, target, prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; },
});
async function pickOn(body: DomNode, clicked: DomNode, mark = 'mark-1') {
  const scope = globalThis as unknown as Record<string, unknown>;
  const saved = { document: scope.document, add: scope.addEventListener, remove: scope.removeEventListener };
  const listeners = new Map<string, Listener>();
  const capture: boolean[] = [];
  scope.document = { body, documentElement: domNode('html', {}, [body]), createElement: (tag: string) => domNode(tag) };
  scope.addEventListener = (kind: string, fn: Listener, useCapture: boolean) => { listeners.set(kind, fn); capture.push(useCapture === true); };
  scope.removeEventListener = (kind: string) => { listeners.delete(kind); };
  try {
    const answer = PICK_ELEMENT({ line: 'Click the post button once.', ms: 5000, step: 'submit', mark });
    const kinds = [...listeners.keys()].sort();
    const stopped = kinds.filter(kind => kind !== 'click').map(kind => {
      const event = fakeEvent(kind, clicked);
      listeners.get(kind)!(event);
      return event.prevented && event.stopped;
    });
    const click = fakeEvent('click', clicked);
    listeners.get('click')!(click);
    const picked = await answer;
    const bannerLeft = body.children.some(child => child.textContent === 'Click the post button once.');
    return { picked, kinds, stopped, capture, clickStopped: click.prevented && click.stopped, left: listeners.size, bannerLeft };
  } finally {
    scope.document = saved.document;
    scope.addEventListener = saved.add;
    scope.removeEventListener = saved.remove;
  }
}

test('the pick overlay climbs from what was clicked to its control, anchors the xpath, marks it, and stops keys and touches too', async () => {
  const span = domNode('span', {}, [], 'Post');
  const button = domNode('button', { 'aria-label': 'Send post' }, [span]);
  const body = domNode('body', {}, [domNode('div', { id: 'layers' }, [domNode('div', {}, [button, domNode('button', {}, [], 'Cancel')])])]);
  const first = await pickOn(body, span);
  assert.deepEqual(first.picked, { testId: null, role: 'button', name: 'Send post', ariaLabel: 'Send post', xpath: '//*[@id="layers"]/div/button[1]' });
  assert.equal(button.getAttribute('data-chausar-pick'), 'mark-1', 'the control the owner clicked is marked, to be found again');
  assert.equal(span.getAttribute('data-chausar-pick'), null);
  assert.deepEqual(first.kinds, ['click', 'keydown', 'keypress', 'keyup', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchend', 'touchstart']);
  assert.ok(first.stopped.every(Boolean) && first.clickStopped, 'nothing the owner does in the window reaches the page while it picks');
  assert.ok(first.capture.every(Boolean));
  assert.equal(first.left, 0, 'its listeners are removed after');
  assert.equal(first.bannerLeft, false, 'its line is removed after');

  // No id or test id on the way up: no xpath at all, rather than a positional one.
  const plain = domNode('span', {}, [], 'Post');
  const loose = await pickOn(domNode('body', {}, [domNode('div', {}, [domNode('div', {}, []), domNode('div', {}, [domNode('button', {}, [plain])])])]), plain);
  assert.deepEqual(loose.picked, { testId: null, role: 'button', name: 'Post', ariaLabel: null, xpath: null });

  // A text box drawn as an editable block: the click on a word inside climbs to the box itself.
  const word = domNode('span', {}, [], 'Hello');
  const box = domNode('div', { 'data-testid': 'composer', contenteditable: 'true' }, [domNode('p', {}, [word])]);
  const editable = await pickOn(domNode('body', {}, [box]), word);
  assert.deepEqual(editable.picked, { testId: 'composer', role: 'textbox', name: 'Hello', ariaLabel: null, xpath: '//*[@data-testid="composer"]' });
});
