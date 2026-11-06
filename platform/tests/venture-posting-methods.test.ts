// Posting as engine methods (catalogue K1, S1's draft-before-schedule gate; Ink v2 wave 2 package 2B1).
// venture.posting.propose takes one post of a draft by its id, '<delivery run id>.post-<n>', never free text, and
// refuses with every reason the draft-before-schedule gate gives (playbooks/social/approvals.ts scheduleGate) and the
// ones posting adds; the post then waits on Today as a connector row whose line starts with the task-scoped consent
// line. venture.posting.signIn opens the platform's sign-in page in the Chausar browser window and does not wait for it.
// No real browser: a fake port.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Context } from '../runtime/contracts.ts';
import type {
  BrowserPort, BrowserProbe, ConnectorPostRecord, DeliveryRunRecord, DraftPostView, PostingProposal, QueueList, ShareLinkView, VentureDeps,
} from '../runtime/venture/contracts.ts';
import { APP_ONLY_METHODS, VENTURE_ERRORS } from '../runtime/venture/contracts.ts';
import { houseStyleFindings, listRecords, ventureAction } from '../runtime/venture/records.ts';
import { handlers as build } from '../runtime/venture/build/index.ts';
import { POSTING_CONSENT_LINE, connectorQueueRows } from '../runtime/venture/build/posting.ts';
import { draftApprovalsOfRun, parsePostId } from '../runtime/venture/playbooks/social/run-approvals.ts';
import { call as view, code, owner, phone, setup, type Env } from './venture-views-env.ts';
import { seedPostDraft, seedPostPlaybook } from './venture-post-drafts.ts';

const agent: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'mcp' };
type Handler = (deps: VentureDeps, ctx: Context, payload: unknown) => Promise<unknown>;
const method = <T>(deps: VentureDeps, name: string, payload: unknown, ctx: Context = owner) => (build as Record<string, Handler>)[name](deps, ctx, payload) as Promise<T>;
const propose = (deps: VentureDeps, draftId: string, ctx: Context = agent) => method<PostingProposal>(deps, 'venture.posting.propose', { draftId }, ctx);
const refused = (expected: string, words?: RegExp) => (error: any) => {
  assert.equal(error.code, expected, error.message);
  if (words) assert.match(error.message, words);
  return true;
};

function fakePort(options: { present?: boolean; signIn?: () => Promise<BrowserProbe> } = {}) {
  const signIns: string[] = [];
  const posts: string[] = [];
  const port: BrowserPort = {
    async probe() { return options.present === false ? { present: false, reason: 'Playwright was not found next to Chausar. Chausar does not install it.' } : { present: true, reason: 'Playwright with Chromium found on this computer.' }; },
    async post(job) { posts.push(job.text); return { outcome: 'posted', line: 'Posted.', url: null }; },
    signIn(connectorId) { signIns.push(connectorId); return options.signIn ? options.signIn() : new Promise<BrowserProbe>(() => {}); },
  };
  return { port, signIns, posts };
}

async function posting(options: Parameters<typeof fakePort>[0] = {}) {
  const env = await setup();
  const browser = fakePort(options);
  env.deps = { ...env.deps, connectors: { browser: browser.port, appReviewed: [], postTimeoutMs: 40 } } as VentureDeps;
  return { env, deps: env.deps, browser };
}

const PASSED = [{ playbook: 'social-agency', check: 'claims', outcome: 'pass' as const, detail: 'ok' }];
/** A social agency draft the owner accepted, with every check passed. */
async function socialDraft(env: Env, lines: string[], fields: Partial<DeliveryRunRecord> = {}) {
  const social = await seedPostPlaybook(env.deps, 'social-agency');
  return seedPostDraft(env.deps, lines, { playbookId: social.id, playbookChecks: PASSED, ...fields });
}
/** The owner shares the draft and records the client's answer, as the Work screen does on this computer. */
async function clientSays(env: Env, run: DeliveryRunRecord, answer: 'approved' | 'changes' = 'approved') {
  await method<ShareLinkView>(env.deps, 'venture.share.create', { deliveryId: run.id });
  await method(env.deps, 'venture.share.recordAnswer', { draftId: run.id, answer });
}

test('the posting methods are build methods; sign-in is app-only and propose is not; their codes are declared', () => {
  for (const name of ['venture.posting.propose', 'venture.posting.signIn']) assert.equal(typeof (build as Record<string, unknown>)[name], 'function', name);
  assert.ok(APP_ONLY_METHODS.includes('venture.posting.signIn'));
  assert.ok(!APP_ONLY_METHODS.includes('venture.posting.propose'), 'an agent may propose; only the owner approves');
  for (const name of ['POST_NOT_APPROVED', 'POST_NOT_A_POST', 'POST_THREAD_NOT_BUILT', 'POST_RISK_BLOCKED', 'TIER_UNAVAILABLE', 'NOT_BUILT_YET']) {
    assert.ok((VENTURE_ERRORS as readonly string[]).includes(name), name);
  }
});

test("a post waits for the client's recorded answer, then goes to Today as one connector row with the text from the draft", async () => {
  const { env, deps, browser } = await posting();
  const run = await socialDraft(env, ['X: Our cafe opens at 8 every weekday.', 'X: Filter coffee all day.']);
  await assert.rejects(propose(deps, `${run.id}.post-1`), refused('POST_CLIENT_NOT_APPROVED', /Your client has not approved this draft\./));
  await clientSays(env, run);
  await assert.rejects(method(deps, 'venture.posting.propose', { draftId: `${run.id}.post-1`, text: 'Anything else.' }, agent), code('INVALID_VENTURE_REQUEST'));
  // 4J7 (K6): the browser posts from the account signed in, so it takes no account: refused, never dropped or relabelled.
  await assert.rejects(method(deps, 'venture.posting.propose', { draftId: `${run.id}.post-1`, account: '@lumensocial' }, agent), code('CONNECTOR_FIELD_UNSUPPORTED'));
  assert.equal(listRecords(env.store.read(), 'venture-connector-post').length, 0, 'nothing is proposed');

  const proposal = await propose(deps, `${run.id}.post-1`);
  assert.deepEqual({ ...proposal, postId: 'x' }, {
    postId: 'x', connectorId: 'x', draftId: `${run.id}.post-1`, part: 1, state: 'described', line: 'Waiting on Today for your approval.', warnings: [],
  });
  const posts = listRecords(env.store.read(), 'venture-connector-post');
  assert.equal(posts.length, 1);
  assert.deepEqual([posts[0].id, posts[0].state, posts[0].text, posts[0].draftId, posts[0].part], [proposal.postId, 'described', 'Our cafe opens at 8 every weekday.', run.id, 1]);

  const today = await view<QueueList>(env, 'venture.queue.list');
  const rows = today.rows.filter(row => row.kind === 'connector');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, 'Post to X');
  assert.ok(rows[0].line?.startsWith(POSTING_CONSENT_LINE), rows[0].line);
  assert.match(rows[0].line ?? '', /The platform may restrict this account\.$/);
  assert.equal(browser.posts.length, 0, 'nothing is posted until the owner approves on Today');

  // The second X line keeps its within-channel part number.
  const x = await propose(deps, `${run.id}.post-2`);
  assert.deepEqual([x.connectorId, x.part], ['x', 2]);
});

test('the consent line is task-scoped and plain', () => {
  assert.equal(POSTING_CONSENT_LINE, "Chausar will post in a browser window on this computer. Please don't type in that window until the post is done.");
  assert.deepEqual(houseStyleFindings(POSTING_CONSENT_LINE), []);
});

test('every reason from the draft-before-schedule gate, each with its code', async () => {
  const { env, deps } = await posting();
  // Failed checks: the check's own words.
  const failed = await socialDraft(env, ['X: Our cafe opens at 8.'], { checks: [{ check: 'house-style', passed: false, detail: 'The draft uses a long dash.' }] });
  await clientSays(env, failed);
  await assert.rejects(propose(deps, `${failed.id}.post-1`), refused('POST_DRAFT_UNCHECKED', /long dash/));

  // Not accepted by the owner.
  const ready = await socialDraft(env, ['X: Our cafe opens at 8.'], { status: 'ready-for-review', verdict: null });
  await assert.rejects(propose(deps, `${ready.id}.post-1`), refused('POST_NOT_APPROVED', /You have not approved this draft\./));

  // The client asked for changes.
  const changes = await socialDraft(env, ['X: Our cafe opens at 8.']);
  await clientSays(env, changes, 'changes');
  await assert.rejects(propose(deps, `${changes.id}.post-1`), refused('POST_CLIENT_NOT_APPROVED', /Your client asked for changes\./));

  // Edited after the client approved it: the approval is for other words.
  const edited = await socialDraft(env, ['X: Our cafe opens at 8.']);
  await clientSays(env, edited);
  await env.store.update(state => {
    const stored = state.conversations.find(item => item.id === edited.id) as DeliveryRunRecord;
    stored.status = 'edited';
    stored.editedText = '# Posts for October\n\n## Posts\nX: Our cafe opens at 7.';
  });
  await assert.rejects(propose(deps, `${edited.id}.post-1`), refused('POST_DRAFT_CHANGED', /changed after it was approved/));

  // A practice draft never goes out (the posting gate's own reason).
  const practice = await socialDraft(env, ['X: Our cafe opens at 8.'], { practice: true });
  await clientSays(env, practice).catch(() => null);
  await assert.rejects(propose(deps, `${practice.id}.post-1`), refused('PRACTICE_DRAFT'));
  assert.equal(listRecords(env.store.read(), 'venture-connector-post').length, 0, 'a refused post leaves nothing behind');
});

test('an id that names no post, a channel posting cannot reach, a picture post and a thread are refused', async () => {
  const { env, deps } = await posting();
  const run = await socialDraft(env, [
    'X: Our cafe opens at 8.', 'Instagram: Fresh pastries at 8. #PuneCafes', 'Threads: Filter coffee all day.', `X: ${'Filter coffee all day, every day, in Pune. '.repeat(10).trim()}`,
  ]);
  await clientSays(env, run);
  for (const id of [`${run.id}.post-5`, `${run.id}.post-0`, run.id, `${run.id}.post-1x`, 'post-1', '']) {
    await assert.rejects(propose(deps, id), refused('POST_NOT_A_POST'), id);
  }
  await assert.rejects(propose(deps, 'delivery_missing.post-1'), code('DELIVERY_NOT_FOUND'));
  await assert.rejects(propose(deps, `${run.id}.post-2`), refused('NOT_BUILT_YET', /^Posting a picture or video through the browser is not built yet\.$/));
  await assert.rejects(propose(deps, `${run.id}.post-3`), refused('NOT_BUILT_YET', /no posting connector for Threads/));
  await assert.rejects(propose(deps, `${run.id}.post-4`), refused('POST_THREAD_NOT_BUILT', /^Post a thread by hand; Chausar posts single posts\.$/));
  assert.equal((await propose(deps, `${run.id}.post-1`)).connectorId, 'x');
});

test('the posts of a draft and their ids, for the screens and for posting, are read one way', async () => {
  const { env, deps } = await posting();
  const run = await socialDraft(env, ['LinkedIn: Our cafe opens at 8.', 'Threads: Filter coffee all day.', 'X: Fresh pastries at 8.', 'LinkedIn: Sunday thali at noon.']);
  const listed = await method<{ posts?: DraftPostView[] }>(deps, 'venture.share.list', { deliveryId: run.id });
  assert.deepEqual(listed.posts, [
    { draftId: `${run.id}.post-1`, channel: 'linkedin', name: 'LinkedIn', connectorId: 'linkedin', text: 'Our cafe opens at 8.' },
    { draftId: `${run.id}.post-2`, channel: 'threads', name: 'Threads', connectorId: null, text: 'Filter coffee all day.' },
    { draftId: `${run.id}.post-3`, channel: 'x', name: 'X', connectorId: 'x', text: 'Fresh pastries at 8.' },
    { draftId: `${run.id}.post-4`, channel: 'linkedin', name: 'LinkedIn', connectorId: 'linkedin', text: 'Sunday thali at noon.' },
  ]);
  assert.deepEqual(parsePostId(`${run.id}.post-4`), { runId: run.id, n: 4 });
  const approvals = draftApprovalsOfRun(env.store.read(), run.id);
  assert.deepEqual(approvals.map(item => [item.draft.id, item.post.part, item.approval.checks, item.approval.owner.decision, item.approval.client.decision]), [
    [`${run.id}.post-1`, 1, 'passed', 'approved', null], [`${run.id}.post-2`, null, 'passed', 'approved', null],
    [`${run.id}.post-3`, 1, 'passed', 'approved', null], [`${run.id}.post-4`, 2, 'passed', 'approved', null],
  ]);
  await clientSays(env, run);
  await assert.rejects(propose(deps, `${run.id}.post-4`), refused('NOT_BUILT_YET', /copy-and-open only/));
  const third=await propose(deps, `${run.id}.post-3`);
  assert.equal(listRecords(env.store.read(), 'venture-connector-post').find(post => post.id === third.postId)!.text, 'Fresh pastries at 8.');
});

test('sign-in opens the window and does not wait for it; a failure is logged as an event, never thrown', async () => {
  const { env, deps, browser } = await posting();
  const opened = await method<{ opened: true; line: string }>(deps, 'venture.posting.signIn', { connectorId: 'x' });
  assert.deepEqual(opened, { opened: true, line: 'A browser window opened. Sign in there, then close it.' });
  assert.deepEqual(browser.signIns, ['x'], 'the port was called once, and its window is still open');

  const failing = await posting({ signIn: async () => { throw new Error('The browser could not start.'); } });
  assert.equal((await method<{ opened: true }>(failing.deps, 'venture.posting.signIn', { connectorId: 'x' })).opened, true);
  await new Promise(resolve => setTimeout(resolve, 20));
  const events = listRecords(failing.env.store.read(), 'venture-event').filter(event => event.name === 'posting-sign-in-failed');
  assert.equal(events.length, 1);
  assert.deepEqual((events[0].data as { connectorId: string }).connectorId, 'x');

  const held = await posting({ signIn: async () => ({ present: false, reason: 'X showed a security check.' }) });
  await method(held.deps, 'venture.posting.signIn', { connectorId: 'x' });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(listRecords(held.env.store.read(), 'venture-event').filter(event => event.name === 'posting-sign-in-failed').length, 1);
  void env;
});

test('sign-in is refused on the hosted server, for Instagram, from the phone, while a channel is frozen, and with no browser here', async () => {
  const { env, deps, browser } = await posting();
  const hosted = { ...deps, host: 'hosted-web' } as VentureDeps;
  await assert.rejects(method(hosted, 'venture.posting.signIn', { connectorId: 'x' }), refused('TIER_UNAVAILABLE', /^Posting through your own browser works only in the desktop app\.$/));
  await assert.rejects(method(deps, 'venture.posting.signIn', { connectorId: 'instagram' }), refused('NOT_BUILT_YET', /picture or video/));
  await assert.rejects(method(deps, 'venture.posting.signIn', { connectorId: 'x' }, phone), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(method(deps, 'venture.posting.signIn', { connectorId: 'x' }, agent), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(method(deps, 'venture.posting.signIn', { connectorId: 'stripe' }), code('INVALID_VENTURE_REQUEST'));
  await ventureAction(deps, owner, 'approve', 'seed.hold', tx => tx.put({
    ...tx.base('venture-channel-hold'), connectorId: 'x', site: 'x.com', cause: 'blocked', line: 'X blocked this account. Do not sign in again or reconnect.',
    until: new Date(Date.parse(env.now()) + 72 * 3_600_000).toISOString(), postId: 'post_x', clearedAt: null, clearedBy: null,
  } as any));
  await assert.rejects(method(deps, 'venture.posting.signIn', { connectorId: 'x' }), refused('CHANNEL_FROZEN', /Do not sign in again/));
  assert.deepEqual(browser.signIns, [], 'the port was never called');

  const absent = await posting({ present: false });
  await assert.rejects(method(absent.deps, 'venture.posting.signIn', { connectorId: 'x' }), refused('NOT_BUILT_YET', /Playwright was not found/));
  assert.deepEqual(absent.browser.signIns, []);
});

test('a connector row that is not decided keeps its consent line through a reload of Today', async () => {
  const { env, deps } = await posting();
  const run = await socialDraft(env, ['X: Our cafe opens at 8.']);
  await clientSays(env, run);
  await propose(deps, `${run.id}.post-1`);
  const [row] = connectorQueueRows(env.store.read());
  assert.equal(row.line, `${POSTING_CONSENT_LINE} The platform may restrict this account.`);
  const [post] = listRecords(env.store.read(), 'venture-connector-post') as ConnectorPostRecord[];
  assert.deepEqual(post.warnings ?? [], []);
});

test("an owner-edited post is checked again against the client's own word lists from the order's intake", async () => {
  const { env, deps } = await posting();
  const clientRules = { bannedWords: ['cheap'], bannedTopics: ['politics'], competitors: ['Yoga Hub'], protectedPhrases: [] };
  const order = await ventureAction(deps, owner, 'prepare', 'seed.order', tx => tx.put({
    ...tx.base('venture-order'), clientId: 'client_none', offerId: 'content-calendar', quantity: '1', request: 'Posts for our studio in Pune.', status: 'open',
    priceReceiptId: 'receipt_none', deliveredOn: null, saleFactId: null,
    intake: { rights: null, format: 'short', aiVoice: false, aiPresenter: false, paidPromotion: false, cutFile: null, clientRules },
  } as any));
  const edited = (text: string) => socialDraft(env, ['X: Morning yoga in Pune.'], {
    orderId: order.id, status: 'edited', editedText: `# Posts for October\n\n## Posts\nX: ${text}`,
  });
  for (const [text, words] of [['Cheap morning yoga in Pune.', /"cheap"/], ['Morning yoga in Pune, and some politics.', /"politics"/]] as const) {
    const run = await edited(text);
    await clientSays(env, run);
    await assert.rejects(propose(deps, `${run.id}.post-1`), refused('POST_DRAFT_UNCHECKED', words));
  }
  const clean = await edited('Morning yoga in Pune.');
  await clientSays(env, clean);
  assert.equal((await propose(deps, `${clean.id}.post-1`)).state, 'described');
});

test('the share list says whether a draft needs the client to approve it before it goes out', async () => {
  const { env, deps } = await posting();
  const social = await socialDraft(env, ['X: Our cafe opens at 8.']);
  const plain = await seedPostDraft(deps, ['X: Our cafe opens at 8.']);
  assert.equal((await method<{ clientApproval?: boolean }>(deps, 'venture.share.list', { deliveryId: social.id })).clientApproval, true);
  assert.equal((await method<{ clientApproval?: boolean }>(deps, 'venture.share.list', { deliveryId: plain.id })).clientApproval, false);
  assert.equal('clientApproval' in await method<object>(deps, 'venture.share.list', {}), false);
  // A plain business's accepted draft posts without a share link.
  assert.equal((await propose(deps, `${plain.id}.post-1`)).state, 'described');
});

test('end to end through the methods: propose, then Today, then venture.queue.decide posts it once', async () => {
  const { env, deps, browser } = await posting();
  const run = await socialDraft(env, ['X: Our cafe opens at 8 every weekday.']);
  await clientSays(env, run);
  const proposal = await propose(deps, `${run.id}.post-1`);
  const [row] = (await view<QueueList>(env, 'venture.queue.list')).rows.filter(item => item.kind === 'connector');
  const decided = await view<{ outcome: string; line: string }>(env, 'venture.queue.decide', { id: row.id, digest: row.digest, action: 'approve', viewed: true });
  assert.equal(decided.outcome, 'done', decided.line);
  assert.match(decided.line, /^Posted to X\./);
  assert.deepEqual(browser.posts, ['Our cafe opens at 8 every weekday.']);
  assert.equal(listRecords(env.store.read(), 'venture-connector-post').find(post => post.id === proposal.postId)!.state, 'applied');
  assert.equal((await view<QueueList>(env, 'venture.queue.list')).rows.filter(item => item.kind === 'connector').length, 0);
});
