// Ink v2 wave 4, package 4J10 (H28): journalled-action extras. An action kind may declare a cleanup that runs when the
// owner rejects it (a staged website edit is turned down and its staged copy removed); actions may say what they
// provide and what they depend on (one that depends on an action not yet applied waits; a rejected dependency rejects
// it); an approved action is fenced to the account it was approved for (ACCOUNT_FENCE); and actions that would outlive
// the session (minting a credential, a webhook that keeps delivering, a bulk wrapper that hides the inner calls) are
// refused before they are even recorded (ACTION_DENYLISTED).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { Context } from '../runtime/contracts.ts';
import type { ConnectorPostRecord, SiteEditRecord, VentureDeps } from '../runtime/venture/contracts.ts';
import { listRecords, ventureAction } from '../runtime/venture/records.ts';
import { applyAction, approveAction, journalled, proposeAction, rejectAction, type ProposeInput } from '../runtime/venture/journal/journal.ts';
import { ACTION_DENY_LINE, OPERATION_UNKNOWN_LINE, REJECT_CLEANUPS } from '../runtime/venture/journal/action-extras.ts';
import { rejectSiteEdit } from '../runtime/venture/build/site-edits.ts';
import { decidePost, proposePost } from '../runtime/venture/build/posting.ts';
import type { BrowserPort, BrowserPostJob } from '../runtime/venture/contracts.ts';
import { owner as viewsOwner, setup as viewsSetup } from './venture-views-env.ts';
import { seedPostDraft } from './venture-post-drafts.ts';
import { VentureTestStore } from './venture-test-store.ts';

const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const agent: Context = { ...owner, channel: 'mcp' };
const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected, error?.message); return true; };
const START = Date.parse('2026-10-21T10:00:00.000Z');

function setup() {
  const store = new VentureTestStore();
  let time = START;
  const deps = { store, clock: () => new Date(time) } as unknown as VentureDeps;
  return { store, deps, advance: (ms: number) => { time += ms; } };
}
async function seed(deps: VentureDeps) {
  return ventureAction(deps, owner, 'admin', 'seed', tx => tx.put({
    ...tx.base('venture-record'), idea: 'Monthly books for cafes in Pune', ideaDigest: 'synthetic', workingName: 'Ledger Cafe Books', country: null,
    serviceType: 'bookkeeping', status: 'live', launchStage: 'approve-each', blueprintId: null, acceptedBlueprintId: null, playbookId: null,
    invoiceSequence: 0, updatedAt: tx.now,
  } as any), { create: true });
}
const write = (subject: string, over: Partial<ProposeInput> = {}): ProposeInput => ({
  action: 'connector.write', subject, target: 'Mail app', actionDigest: createHash('sha256').update(subject).digest('hex'), line: 'Send the reminder email.',
  operation: 'send-deliverable', ...over,
});
const entry = (deps: VentureDeps, id: string) => listRecords(deps.store.read(), 'venture-journal-entry').find(item => item.id === id)!;
const sent = () => {
  const runs: string[] = [];
  return { runs, run: async () => { runs.push('ran'); return { outcome: 'applied' as const, line: 'Sent.', value: 'sent' }; } };
};

// ---------------------------------------------------------------------------
// reject() cleanup
// ---------------------------------------------------------------------------

test('rejecting a waiting website edit runs its kind\'s cleanup: the staged edit is turned down and its staged copy removed', async () => {
  const { deps, store } = setup();
  await seed(deps);
  const edit = await ventureAction(deps, owner, 'prepare', 'seed.edit', tx => tx.put<SiteEditRecord>({
    ...tx.base('venture-site-edit'), target: { kind: 'local-folder', identity: 'folder:/site' }, path: 'index.html', summary: 'New hours',
    before: '<p>Open 9 to 5</p>', after: '<p>Open 8 to 6</p>', beforeDigest: 'x', afterDigest: 'y', planDigest: 'z', state: 'staged',
    log: [{ at: tx.now, by: 'owner', step: 'staged', line: 'Staged: New hours' }],
  }));
  assert.equal(typeof REJECT_CLEANUPS['site.apply'], 'function', 'the website edit kind declares a cleanup');
  const proposed = await proposeAction(deps, agent, { action: 'site.apply', subject: `${edit.id}.applied`, target: 'index.html', actionDigest: 'z', line: 'Apply the website edit: New hours' });
  await rejectAction(deps, owner, { entryId: proposed.id, digest: 'z' });
  const after = listRecords(store.read(), 'venture-site-edit')[0];
  assert.equal(after.state, 'rejected');
  assert.equal(after.after, '', 'the staged copy is removed');
  assert.equal(after.afterDigest, 'y', 'what it was stays recorded');
  assert.equal(after.log.at(-1)!.line, 'You turned this edit down. Its staged copy was removed; nothing was written.');
  // A kind without a cleanup changes nothing else when rejected.
  const write1 = await proposeAction(deps, agent, write('reminder_1'));
  const before = JSON.stringify(listRecords(store.read(), 'venture-site-edit'));
  await rejectAction(deps, owner, { entryId: write1.id, digest: write1.actionDigest });
  assert.equal(JSON.stringify(listRecords(store.read(), 'venture-site-edit')), before);
  assert.equal((await (await import('../runtime/venture/views/index.ts')).handlers['venture.journal.chain']!(deps, owner, {}) as { state: string }).state, 'ok');
});

// ---------------------------------------------------------------------------
// provides and dependsOn
// ---------------------------------------------------------------------------

test('an action that depends on another waits until it applies; a rejected dependency rejects it, and what depended on that', async () => {
  const { deps } = setup();
  await seed(deps);
  const invoice = await proposeAction(deps, agent, write('invoice_1', { action: 'invoice.issue', target: 'Cafe Aroma', line: 'Issue the invoice.', provides: ['invoice:1'] }));
  const reminder = await proposeAction(deps, agent, write('reminder_1', { line: 'Send the invoice by email.', dependsOn: ['invoice:1'], provides: ['reminder:1'] }));
  assert.deepEqual([invoice.provides, reminder.dependsOn], [['invoice:1'], ['invoice:1']]);
  await assert.rejects(approveAction(deps, owner, { entryId: reminder.id, digest: reminder.actionDigest }), (error: any) => {
    assert.equal(error.code, 'JOURNAL_WAITING');
    assert.equal(error.message, 'This waits for "Issue the invoice." to happen first.');
    return true;
  });
  const { token } = await approveAction(deps, owner, { entryId: invoice.id, digest: invoice.actionDigest });
  await applyAction(deps, owner, { entryId: invoice.id, token, idempotencyKey: 'invoice-once' }, async () => ({ outcome: 'applied' as const, line: 'Issued.', value: null }));
  const approved = await approveAction(deps, owner, { entryId: reminder.id, digest: reminder.actionDigest });
  assert.equal(approved.entry.state, 'approved', 'its dependency applied, so it may go');
  // Nothing provides what this needs yet: it waits too.
  await assert.rejects(journalled(deps, owner, write('reminder_2', { dependsOn: ['invoice:9'] }), sent().run), code('JOURNAL_WAITING'));

  // A chain of three: the first is turned down, so the two after it end too.
  const one = await proposeAction(deps, agent, write('one', { line: 'Book the call.', provides: ['call:1'] }));
  const two = await proposeAction(deps, agent, write('two', { line: 'Send the agenda.', dependsOn: ['call:1'], provides: ['agenda:1'] }));
  const three = await proposeAction(deps, agent, write('three', { line: 'Send the reminder.', dependsOn: ['agenda:1'] }));
  await rejectAction(deps, owner, { entryId: one.id, digest: one.actionDigest });
  assert.equal(entry(deps, two.id).state, 'rejected');
  assert.equal(entry(deps, two.id).journal.at(-1)!.line, 'Not done: it needed "Book the call.", which did not happen.');
  assert.equal(entry(deps, three.id).state, 'rejected');
  assert.equal(entry(deps, three.id).journal.at(-1)!.line, 'Not done: it needed "Send the agenda.", which did not happen.');
  await assert.rejects(proposeAction(deps, agent, write('four', { dependsOn: ['bad key!'] })), code('INVALID_VENTURE_REQUEST'));
});

test('a dependency that went out as not sent rejects what waited on it', async () => {
  const { deps } = setup();
  await seed(deps);
  const first = await proposeAction(deps, agent, write('first', { line: 'Upload the file.', provides: ['file:1'] }));
  const second = await proposeAction(deps, agent, write('second', { line: 'Share the link.', dependsOn: ['file:1'] }));
  const { token } = await approveAction(deps, owner, { entryId: first.id, digest: first.actionDigest });
  await applyAction(deps, owner, { entryId: first.id, token, idempotencyKey: 'first-once' }, async () => ({ outcome: 'not-sent' as const, line: 'The upload was refused.', value: null }));
  assert.equal(entry(deps, first.id).state, 'rejected');
  assert.equal(entry(deps, second.id).state, 'rejected');
});

// ---------------------------------------------------------------------------
// The account fence
// ---------------------------------------------------------------------------

test('an approved action runs only under the account it was approved for: another account is refused ACCOUNT_FENCE', async () => {
  const { deps } = setup();
  await seed(deps);
  const proposed = await proposeAction(deps, agent, write('post_1', { line: 'Send the newsletter.', account: 'asha@ledger.example' }));
  assert.equal(proposed.account, 'asha@ledger.example');
  const { token } = await approveAction(deps, owner, { entryId: proposed.id, digest: proposed.actionDigest });
  const effect = sent();
  await assert.rejects(applyAction(deps, owner, { entryId: proposed.id, token, idempotencyKey: 'once', account: 'ravi@ledger.example' }, effect.run), (error: any) => {
    assert.equal(error.code, 'ACCOUNT_FENCE');
    assert.equal(error.message, 'This was approved for asha@ledger.example, not ravi@ledger.example. Nothing was sent; approve it again for this account.');
    return true;
  });
  assert.deepEqual(effect.runs, []);
  assert.equal(entry(deps, proposed.id).claimedAt, null, 'not even claimed');
  await applyAction(deps, owner, { entryId: proposed.id, token, idempotencyKey: 'once', account: 'asha@ledger.example' }, effect.run);
  assert.deepEqual(effect.runs, ['ran']);

  // An effect that learns its account only as it runs fences itself: refused, and known not sent.
  const late = await journalled(deps, owner, write('post_2', { account: 'asha@ledger.example' }), async handle => {
    handle.fence('ravi@ledger.example');
    return { outcome: 'applied' as const, line: 'Sent.', value: 'sent' };
  }, { account: 'asha@ledger.example' }).catch(error => error);
  assert.equal(late.code, 'ACCOUNT_FENCE');
  const fenced = listRecords(deps.store.read(), 'venture-journal-entry').find(item => item.subject === 'post_2')!;
  assert.equal(fenced.state, 'rejected');

  // A caller that does not say which account it runs under is refused, for every caller, before anything is recorded.
  await assert.rejects(journalled(deps, owner, write('post_3', { account: 'asha@ledger.example' }), effect.run), (error: any) => {
    assert.equal(error.code, 'ACCOUNT_FENCE');
    assert.match(error.message, /cannot tell which account/);
    return true;
  });
  assert.equal(listRecords(deps.store.read(), 'venture-journal-entry').some(item => item.subject === 'post_3'), false);
  const named = await proposeAction(deps, agent, write('post_4', { account: 'asha@ledger.example' }));
  const approvedNamed = await approveAction(deps, owner, { entryId: named.id, digest: named.actionDigest });
  await assert.rejects(applyAction(deps, owner, { entryId: named.id, token: approvedNamed.token, idempotencyKey: 'post-4' }, effect.run), code('ACCOUNT_FENCE'));
  assert.equal(entry(deps, named.id).claimedAt, null);
});

test('a post approved for one LinkedIn account refuses to run under another', async () => {
  const { deps } = setup();
  await seed(deps);
  const post = await ventureAction(deps, owner, 'prepare', 'seed.post', tx => tx.put<ConnectorPostRecord>({
    ...tx.base('venture-connector-post'), connectorId: 'linkedin', mode: 'owner-browser-session', account: 'Asha Rao', text: 'Our new hours.', agent: null, digest: 'd'.repeat(64),
    state: 'described', describe: 'Post to LinkedIn as Asha Rao', risk: null, claimedAt: null, decidedBy: null, outcome: null,
    journal: [{ state: 'described', at: tx.now, by: 'owner', line: 'Post to LinkedIn as Asha Rao' }], approval: null, expiresAt: new Date(START + 15 * 60_000).toISOString(),
  } as ConnectorPostRecord));
  const { token } = await approveAction(deps, owner, { entryId: post.id, digest: post.digest });
  const effect = sent();
  await assert.rejects(applyAction(deps, owner, { entryId: post.id, token, idempotencyKey: `${post.id}.post`, account: 'Ravi Shah' }, effect.run), code('ACCOUNT_FENCE'));
  assert.deepEqual(effect.runs, []);
});

// ---------------------------------------------------------------------------
// The denylist
// ---------------------------------------------------------------------------

test('actions that outlive the session are refused before they are recorded: credentials, webhooks, bulk wrappers', async () => {
  const { deps, store } = setup();
  await seed(deps);
  for (const action of ['credential.mint', 'token.create', 'webhook.create', 'bulk.run']) {
    await assert.rejects(proposeAction(deps, agent, write(`x_${action}`, { action: action as any })), (error: any) => {
      assert.equal(error.code, 'ACTION_DENYLISTED', action);
      assert.equal(error.message, ACTION_DENY_LINE);
      return true;
    });
  }
  for (const operation of ['api_keys.create', 'oauth_apps.create', 'webhooks.create', 'webhook_subscriptions.add', 'batch', 'bulk_update', 'personal_access_tokens.generate']) {
    await assert.rejects(proposeAction(deps, agent, write(`op_${operation}`, { operation })), code('ACTION_DENYLISTED'), operation);
    await assert.rejects(journalled(deps, owner, write(`op2_${operation}`, { operation }), sent().run), code('ACTION_DENYLISTED'), operation);
  }
  assert.equal(listRecords(store.read(), 'venture-journal-entry').length, 0, 'nothing was recorded');
  assert.equal(ACTION_DENY_LINE, 'Chausar does not do this: it would keep working after you close the app, such as a new key or token, a webhook that keeps sending, or a batch that hides what it does. Do it yourself where you can see it.');
  // It fails closed: a write to a connected service names an operation Chausar knows, or it is refused.
  for (const operation of ['createApiKey', 'create_token', 'webhook.created', 'createWebhook', 'contacts.batch', 'contacts.update', undefined, null]) {
    await assert.rejects(proposeAction(deps, agent, write(`op3_${String(operation)}`, { operation })), (error: any) => {
      assert.equal(error.code, 'ACTION_DENYLISTED', String(operation));
      return true;
    });
  }
  await assert.rejects(proposeAction(deps, agent, write('op_none', { operation: 'contacts.update' })), (error: any) => error.message === OPERATION_UNKNOWN_LINE);
  assert.equal(listRecords(store.read(), 'venture-journal-entry').length, 0, 'nothing was recorded');
  // The writes Chausar knows go.
  await journalled(deps, owner, write('op_mail', { operation: 'send-deliverable' }), sent().run);
  await journalled(deps, owner, write('op_link', { operation: 'create-link' }), sent().run);
  assert.equal(listRecords(store.read(), 'venture-journal-entry').length, 2);
});

// ---------------------------------------------------------------------------
// Through the real paths: the owner turning a staged edit down, and a real post
// ---------------------------------------------------------------------------

test("rejectSiteEdit, the owner's own path, runs the same cleanup: the staged copy goes and a waiting site.apply entry ends", async () => {
  const { deps, store } = setup();
  await seed(deps);
  const edit = await ventureAction(deps, owner, 'prepare', 'seed.edit', tx => tx.put<SiteEditRecord>({
    ...tx.base('venture-site-edit'), target: { kind: 'local-folder', identity: 'folder:/site' }, path: 'index.html', summary: 'New hours',
    before: '<p>Open 9 to 5</p>', after: '<p>Open 8 to 6</p>', beforeDigest: 'x', afterDigest: 'y', planDigest: 'z', state: 'staged',
    log: [{ at: tx.now, by: 'owner', step: 'staged', line: 'Staged: New hours' }],
  }));
  const waiting = await proposeAction(deps, agent, { action: 'site.apply', subject: `${edit.id}.applied`, target: 'index.html', actionDigest: 'z', line: 'Apply the website edit: New hours' });
  const rejected = await rejectSiteEdit(deps, owner, { editId: edit.id });
  assert.deepEqual([rejected.state, rejected.after, rejected.afterDigest], ['rejected', '', 'y']);
  assert.equal(rejected.log.at(-1)!.line, 'You turned this edit down. Its staged copy was removed; nothing was written.');
  assert.equal(entry(deps, waiting.id).state, 'rejected', 'the waiting entry for it ends too');
  assert.equal(listRecords(store.read(), 'venture-site-edit')[0].after, '');
});

/** A posting desk with a fake browser: signedIn is what it reports as the signed-in account (undefined: it cannot tell). */
async function postingDesk(signedIn?: string | null) {
  const env = await viewsSetup();
  const jobs: BrowserPostJob[] = [];
  const port: BrowserPort = {
    async probe() { return { present: true, reason: 'Playwright with Chromium found on this computer.' }; },
    async post(job) { jobs.push(job); return { outcome: 'posted', line: 'Posted.', url: null, checked: [{ step: 'confirm', key: 'role:article' }] }; },
    ...(signedIn !== undefined ? { signedInAccount: async () => signedIn } : {}),
  };
  const deps = { ...env.deps, connectors: { browser: port, appReviewed: [], postTimeoutMs: 40 } } as VentureDeps;
  const draft = await seedPostDraft(deps, ['X: Our bakery opens at 8 every weekday.']);
  const post = await proposePost(deps, agent, { connectorId: 'x', draftId: draft.id, account: 'Asha Rao' });
  return { env, deps, jobs, post };
}

test('a real post approved for one account goes only where that account is signed in; one Chausar cannot see is refused', async () => {
  for (const [signedIn, why] of [[undefined, 'the browser cannot say'], [null, 'nobody it can see'], ['Ravi Shah', 'another account']] as const) {
    const { deps, jobs, post } = await postingDesk(signedIn);
    await assert.rejects(decidePost(deps, viewsOwner, { postId: post.id, digest: post.digest, action: 'approve' }), code('ACCOUNT_FENCE'), why);
    assert.equal(jobs.length, 0, `${why}: nothing reached the browser`);
    assert.equal(listRecords(deps.store.read(), 'venture-connector-post').find(item => item.id === post.id)!.state, 'rejected', `${why}: known not posted`);
  }
  const { deps, jobs, post } = await postingDesk('asha rao');
  const decided = await decidePost(deps, viewsOwner, { postId: post.id, digest: post.digest, action: 'approve' });
  assert.equal(decided.post.state, 'applied');
  assert.equal(jobs.length, 1, 'the approved account was signed in, so it posted');
});
