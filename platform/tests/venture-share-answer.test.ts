// The client's answer the owner records on the desktop (catalogue O19, Ink v2 wave 2 package 2B1). On this computer no
// page serves a share link, so the owner sends the draft and records what the client said: venture.share.recordAnswer,
// inside the app only, through the social approvals module (playbooks/social/approvals.ts recordClientDecision), once
// per draft, on the exact text the link was made with.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Context } from '../runtime/contracts.ts';
import { APP_ONLY_METHODS, VENTURE_ERRORS } from '../runtime/venture/contracts.ts';
import type { BrowserPort, DeliveryRunRecord, ShareLinkView, VentureDeps } from '../runtime/venture/contracts.ts';
import { houseStyleFindings, listRecords } from '../runtime/venture/records.ts';
import { handlers as build } from '../runtime/venture/build/index.ts';
import { shareDecide, sharePage } from '../runtime/venture/build/share-links.ts';
import { code, owner, phone, setup, type Env } from './venture-views-env.ts';
import { seedPostDraft, seedPostPlaybook } from './venture-post-drafts.ts';

type Handler = (deps: VentureDeps, ctx: Context, payload: unknown) => Promise<unknown>;
const call = <T>(deps: VentureDeps, method: string, payload: unknown = {}, ctx: Context = owner) => (build as Record<string, Handler>)[method](deps, ctx, payload) as Promise<T>;
type Answer = { answer: { draftId: string; decision: 'approved' | 'changes'; comment: string | null; at: string; via: string } };

/** A social agency draft the owner accepted, shared as a link this computer keeps but does not serve. */
async function sharedDraft(env: Env, lines = ['LinkedIn: Our cafe opens at 8 every weekday.']) {
  const social = await seedPostPlaybook(env.deps, 'social-agency');
  const run = await seedPostDraft(env.deps, lines, { playbookId: social.id, playbookChecks: [{ playbook: 'social-agency', check: 'claims', outcome: 'pass', detail: 'ok' }] });
  const link = await call<ShareLinkView>(env.deps, 'venture.share.create', { deliveryId: run.id });
  assert.equal(link.url, null, 'kept, not served, on this computer');
  return { run, link };
}

test('recordAnswer is an app-only build method, and its refusal codes are declared', () => {
  assert.ok(APP_ONLY_METHODS.includes('venture.share.recordAnswer'));
  assert.equal(typeof (build as Record<string, unknown>)['venture.share.recordAnswer'], 'function');
  for (const name of ['ALREADY_DECIDED', 'SHARE_NOT_FOUND', 'APPROVAL_STALE', 'APP_APPROVAL_REQUIRED']) assert.ok((VENTURE_ERRORS as readonly string[]).includes(name), name);
});

test("the owner records the client's approval through the approvals module, once, marked owner-recorded", async () => {
  const env = await setup();
  const { run, link } = await sharedDraft(env);
  const recorded = await call<Answer>(env.deps, 'venture.share.recordAnswer', { draftId: run.id, answer: 'approved' });
  assert.deepEqual(recorded.answer, { draftId: run.id, decision: 'approved', comment: null, at: env.now(), via: 'owner-recorded' });
  const [stored] = listRecords(env.store.read(), 'venture-share-link');
  assert.deepEqual(stored.decisions.map(item => [item.decision, item.via, item.recordedBy, item.digest]), [['approved', 'owner-recorded', 'owner', stored.draftDigest]]);
  assert.equal(stored.state, 'closed');
  await assert.rejects(call(env.deps, 'venture.share.recordAnswer', { draftId: run.id, answer: 'changes' }), code('ALREADY_DECIDED'));

  // The list shows the answer on the link, so the screen keeps showing it after a reload.
  const listed = await call<{ links: ShareLinkView[] }>(env.deps, 'venture.share.list', { deliveryId: run.id });
  assert.deepEqual(listed.links.map(item => [item.id, item.answer?.decision, item.answer?.via]), [[link.id, 'approved', 'owner-recorded']]);
});

test('asked for changes keeps the comment; wrong answers and extra fields are refused', async () => {
  const env = await setup();
  const { run } = await sharedDraft(env);
  for (const payload of [{ draftId: run.id, answer: 'maybe' }, { draftId: run.id }, { draftId: run.id, answer: 'approved', text: 'x' }, { draftId: run.id, answer: 'changes', comment: 'x'.repeat(1001) }]) {
    await assert.rejects(call(env.deps, 'venture.share.recordAnswer', payload), code('INVALID_VENTURE_REQUEST'), JSON.stringify(payload).slice(0, 60));
  }
  const recorded = await call<Answer>(env.deps, 'venture.share.recordAnswer', { draftId: run.id, answer: 'changes', comment: 'Say 9, not 8, on Sundays.' });
  assert.deepEqual([recorded.answer.decision, recorded.answer.comment], ['changes', 'Say 9, not 8, on Sundays.']);
  const listed = await call<{ links: ShareLinkView[] }>(env.deps, 'venture.share.list', { deliveryId: run.id });
  assert.equal(listed.links[0].answer?.comment, 'Say 9, not 8, on Sundays.');
});

test('no link: SHARE_NOT_FOUND with what to do; a draft edited after its link was made: APPROVAL_STALE', async () => {
  const env = await setup();
  const social = await seedPostPlaybook(env.deps, 'social-agency');
  const lonely = await seedPostDraft(env.deps, ['X: Fresh pastries at 8.'], { playbookId: social.id });
  await assert.rejects(call(env.deps, 'venture.share.recordAnswer', { draftId: lonely.id, answer: 'approved' }), (error: any) => {
    assert.equal(error.code, 'SHARE_NOT_FOUND');
    assert.equal(error.message, 'Share the draft first, so Chausar knows which text your client saw.');
    return true;
  });
  await assert.rejects(call(env.deps, 'venture.share.recordAnswer', { draftId: 'delivery_missing', answer: 'approved' }), code('DELIVERY_NOT_FOUND'));

  // The link shows one text; the owner then changed the draft, so the client's answer would be about other words.
  const { run } = await sharedDraft(env);
  await env.store.update(state => {
    const stored = state.conversations.find(item => item.id === run.id) as DeliveryRunRecord;
    stored.status = 'edited';
    stored.editedText = '# Posts for October\n\n## Posts\nLinkedIn: Our cafe opens at 7 every weekday.';
  });
  await assert.rejects(call(env.deps, 'venture.share.recordAnswer', { draftId: run.id, answer: 'approved' }), code('APPROVAL_STALE'));

  // A link the owner took back is not one the client is answering on.
  const again = await sharedDraft(env);
  await call(env.deps, 'venture.share.revoke', { id: again.link.id });
  await assert.rejects(call(env.deps, 'venture.share.recordAnswer', { draftId: again.run.id, answer: 'approved' }), code('SHARE_NOT_FOUND'));
});

test('the phone and an agent cannot record a client answer: inside the app only', async () => {
  const env = await setup();
  const { run } = await sharedDraft(env);
  const agent: Context = { ...owner, channel: 'mcp' };
  await assert.rejects(call(env.deps, 'venture.share.recordAnswer', { draftId: run.id, answer: 'approved' }, phone), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(call(env.deps, 'venture.share.recordAnswer', { draftId: run.id, answer: 'approved' }, agent), code('APP_APPROVAL_REQUIRED'));
  assert.equal(listRecords(env.store.read(), 'venture-share-link')[0].decisions.length, 0);
});

test('the words the owner reads keep the house style', () => {
  for (const line of ['Share the draft first, so Chausar knows which text your client saw.']) assert.deepEqual(houseStyleFindings(line), []);
});

test('while the link is served and open the client answers on it: the owner cannot record an answer over it', async () => {
  const env = await setup();
  const hosted = { ...env.deps, host: 'hosted-web', publicUrl: 'https://app.example.com' } as VentureDeps;
  const social = await seedPostPlaybook(env.deps, 'social-agency');
  const run = await seedPostDraft(env.deps, ['LinkedIn: Our cafe opens at 8.'], { playbookId: social.id });
  const made = await call<ShareLinkView>(hosted, 'venture.share.create', { deliveryId: run.id, expiresInHours: 1 });
  assert.ok(made.url, 'served on the hosted web');
  await assert.rejects(call(hosted, 'venture.share.recordAnswer', { draftId: run.id, answer: 'approved' }), (error: any) => {
    assert.equal(error.code, 'SHARE_LINK_REFUSED');
    assert.match(error.message, /answers on the link/);
    return true;
  });
  env.advance(3_600_000); // the link has ended: the client answered some other way, and the owner records it
  assert.equal((await call<Answer>(hosted, 'venture.share.recordAnswer', { draftId: run.id, answer: 'approved' })).answer.via, 'owner-recorded');
});

test("an answer the client gave through a link the owner later took back still counts: recording again is ALREADY_DECIDED", async () => {
  const env = await setup();
  const hosted = { ...env.deps, host: 'hosted-web', publicUrl: 'https://app.example.com' } as VentureDeps;
  const social = await seedPostPlaybook(env.deps, 'social-agency');
  const run = await seedPostDraft(env.deps, ['LinkedIn: Our cafe opens at 8.'], { playbookId: social.id });
  const made = await call<ShareLinkView>(hosted, 'venture.share.create', { deliveryId: run.id });
  const token = /\/share\/([A-Za-z0-9_-]{32})$/.exec(made.url ?? '')![1];
  const page = (await sharePage(hosted, owner, token))!;
  await shareDecide(hosted, owner, token, { decision: 'changes', comment: 'Say 9.', digest: page.digest });
  await call(env.deps, 'venture.share.revoke', { id: made.id });
  await call<ShareLinkView>(env.deps, 'venture.share.create', { deliveryId: run.id }); // a new link, kept on this computer
  await assert.rejects(call(env.deps, 'venture.share.recordAnswer', { draftId: run.id, answer: 'approved' }), code('ALREADY_DECIDED'));
});

test("the answer the engine uses is the one the list gives: approved on a link later revoked still counts, so posting goes and recording is refused", async () => {
  const env = await setup();
  const port: BrowserPort = { async probe() { return { present: true, reason: 'ok' }; }, async post() { return { outcome: 'posted', line: 'ok', url: null }; } };
  env.deps = { ...env.deps, connectors: { browser: port, appReviewed: [], postTimeoutMs: 40 } } as VentureDeps;
  const hosted = { ...env.deps, host: 'hosted-web', publicUrl: 'https://app.example.com' } as VentureDeps;
  const social = await seedPostPlaybook(env.deps, 'social-agency');
  const run = await seedPostDraft(env.deps, ['X: Our cafe opens at 8 every weekday.'], { playbookId: social.id, playbookChecks: [{ playbook: 'social-agency', check: 'claims', outcome: 'pass', detail: 'ok' }] });
  const made = await call<ShareLinkView>(hosted, 'venture.share.create', { deliveryId: run.id });
  const token = /\/share\/([A-Za-z0-9_-]{32})$/.exec(made.url ?? '')![1];
  const page = (await sharePage(hosted, owner, token))!;
  await shareDecide(hosted, owner, token, { decision: 'approved', digest: page.digest });
  await call(env.deps, 'venture.share.revoke', { id: made.id });

  const listed = await call<{ links: ShareLinkView[]; answer?: { decision: string; via: string } | null }>(env.deps, 'venture.share.list', { deliveryId: run.id });
  assert.deepEqual(listed.links.map(item => [item.revoked ?? false, item.answer ?? null]), [[true, null]], 'the link itself shows no answer');
  assert.deepEqual([listed.answer?.decision, listed.answer?.via], ['approved', 'share-link'], 'the draft-level answer is the one the engine counts');
  assert.equal((await call<{ state: string }>(env.deps, 'venture.posting.propose', { draftId: `${run.id}.post-1` }, { ...owner, channel: 'mcp' })).state, 'described');
  await call<ShareLinkView>(env.deps, 'venture.share.create', { deliveryId: run.id });
  await assert.rejects(call(env.deps, 'venture.share.recordAnswer', { draftId: run.id, answer: 'approved' }), code('ALREADY_DECIDED'));

  // A draft changed since: the old answer no longer counts for the words as they are now.
  await env.store.update(state => {
    const stored = state.conversations.find(item => item.id === run.id) as DeliveryRunRecord;
    stored.status = 'edited';
    stored.editedText = '# Posts for October\n\n## Posts\nX: Our cafe opens at 7 every weekday.';
  });
  assert.equal((await call<{ answer?: unknown }>(env.deps, 'venture.share.list', { deliveryId: run.id })).answer, null);
  // A draft with no posts gets the same answer rule from its links.
  const plain = await seedPostDraft(env.deps, ['Monthly report for Cafe Aroma.']);
  await call<ShareLinkView>(env.deps, 'venture.share.create', { deliveryId: plain.id });
  assert.equal((await call<{ answer?: unknown }>(env.deps, 'venture.share.list', { deliveryId: plain.id })).answer, null);
  await call(env.deps, 'venture.share.recordAnswer', { draftId: plain.id, answer: 'changes', comment: 'Add the GST total.' });
  const after = await call<{ answer?: { decision: string; comment: string | null } | null }>(env.deps, 'venture.share.list', { deliveryId: plain.id });
  assert.deepEqual([after.answer?.decision, after.answer?.comment], ['changes', 'Add the GST total.']);
});

test('a draft the client already answered is ALREADY_DECIDED, before any word about the link being open', async () => {
  const env = await setup();
  const hosted = { ...env.deps, host: 'hosted-web', publicUrl: 'https://app.example.com' } as VentureDeps;
  const social = await seedPostPlaybook(env.deps, 'social-agency');
  const run = await seedPostDraft(env.deps, ['LinkedIn: Our cafe opens at 8.'], { playbookId: social.id });
  const made = await call<ShareLinkView>(hosted, 'venture.share.create', { deliveryId: run.id });
  const token = /\/share\/([A-Za-z0-9_-]{32})$/.exec(made.url ?? '')![1];
  const page = (await sharePage(hosted, owner, token))!;
  await shareDecide(hosted, owner, token, { decision: 'approved', digest: page.digest });
  // The link is still served and open, but the client has answered on it already.
  const second = await call<ShareLinkView>(hosted, 'venture.share.create', { deliveryId: run.id });
  assert.ok(second.url);
  await assert.rejects(call(hosted, 'venture.share.recordAnswer', { draftId: run.id, answer: 'changes' }), code('ALREADY_DECIDED'));
});
