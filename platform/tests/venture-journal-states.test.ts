// Ink v2 wave 4, package 4J10 (H27): the journal's end states. After applied, an entry may move on to accepted,
// processed, shown and result as the provider reports, forward only; verified needs a dated acceptance check. An action
// on several targets records how each ended (applied, rejected, partial, unknown, throttled), and a retry covers only
// the targets that failed: never one whose outcome is unknown, never one that went. Each is chained (4J10, H26).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { Context } from '../runtime/contracts.ts';
import type { JournalEntry, JournalRecord, VentureDeps } from '../runtime/venture/contracts.ts';
import { listRecords, ventureAction } from '../runtime/venture/records.ts';
import { journalled, proposeAction, type ProposeInput } from '../runtime/venture/journal/journal.ts';
import { failedTargets, reportEndState, retryProposal } from '../runtime/venture/journal/end-states.ts';
import { handlers as views } from '../runtime/venture/views/index.ts';
import { VentureTestStore } from './venture-test-store.ts';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applySiteEdit, localFolderTarget, stageSiteEdit } from '../runtime/venture/build/site-edits.ts';
import { decidePost, proposePost } from '../runtime/venture/build/posting.ts';
import type { BrowserPort, VentureDeps as Deps } from '../runtime/venture/contracts.ts';
import { owner as viewsOwner, setup as viewsSetup } from './venture-views-env.ts';
import { seedPostDraft } from './venture-post-drafts.ts';

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
const listed = async (deps: VentureDeps) =>
  ((await (views['venture.journal.list'] as (d: unknown, c: Context, p: unknown) => Promise<{ entries: JournalEntry[] }>)(deps, owner, {})).entries);
const chainState = async (deps: VentureDeps) => ((await (views['venture.journal.chain'] as (d: unknown, c: Context, p: unknown) => Promise<{ state: string }>)(deps, owner, {})).state);

test('after applied an entry moves on as the provider reports: accepted, processed, shown, result, forward only', async () => {
  const { deps, advance } = setup();
  await seed(deps);
  const done = await journalled(deps, owner, write('reminder_1'), async () => ({ outcome: 'applied' as const, line: 'Handed to the mail app.', value: null }));
  const id = done.entry.id;
  await reportEndState(deps, owner, { entryId: id, state: 'accepted', line: 'The mail server took it.', by: 'platform' });
  advance(60_000);
  await reportEndState(deps, owner, { entryId: id, state: 'shown', line: 'The client opened it.', by: 'platform' });
  await assert.rejects(reportEndState(deps, owner, { entryId: id, state: 'processed', line: 'Processed.' }), code('JOURNAL_ALREADY_DECIDED'));
  await assert.rejects(reportEndState(deps, owner, { entryId: id, state: 'shown', line: 'Shown again.' }), code('JOURNAL_ALREADY_DECIDED'));
  await reportEndState(deps, owner, { entryId: id, state: 'result', line: 'The client paid.', by: 'platform' });
  const record = entry(deps, id);
  assert.equal(record.state, 'applied', 'the journal state stays applied; the end state rides beside it');
  assert.deepEqual(record.ends!.map(step => step.state), ['accepted', 'shown', 'result']);
  assert.deepEqual(record.ends!.map(step => step.by), ['platform', 'platform', 'platform']);
  const row = (await listed(deps)).find(item => item.id === id)!;
  assert.equal(row.endState, 'result');
  assert.equal(await chainState(deps), 'ok', 'each end state is chained');
  assert.equal(listRecords(deps.store.read(), 'venture-journal-chain')[0].links.filter(link => link.item.startsWith(`${id}!`)).length, 3);
});

test('an end state needs an applied entry; verified needs a dated acceptance check, not one dated after today', async () => {
  const { deps } = setup();
  await seed(deps);
  const waiting = await proposeAction(deps, agent, write('reminder_1'));
  await assert.rejects(reportEndState(deps, owner, { entryId: waiting.id, state: 'accepted', line: 'Took it.' }), code('JOURNAL_NOT_APPLIED'));
  const done = await journalled(deps, owner, write('reminder_2'), async () => ({ outcome: 'applied' as const, line: 'Sent.', value: null }));
  const id = done.entry.id;
  await assert.rejects(reportEndState(deps, owner, { entryId: id, state: 'verified', line: 'Looks right.' }), code('JOURNAL_CHECK_UNDATED'));
  await assert.rejects(reportEndState(deps, owner, { entryId: id, state: 'verified', line: 'Looks right.', check: { id: 'readback-1', checkedOn: '2026-10-22' } }), code('JOURNAL_CHECK_UNDATED'));
  await assert.rejects(reportEndState(deps, owner, { entryId: id, state: 'verified', line: 'Looks right.', check: { id: 'readback-1', checkedOn: 'yesterday' } }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(reportEndState(deps, owner, { entryId: id, state: 'arrived' as any, line: 'Arrived.' }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(reportEndState(deps, owner, { entryId: id, state: 'accepted', line: 'two\nlines' }), code('INVALID_VENTURE_REQUEST'));
  await reportEndState(deps, owner, { entryId: id, state: 'verified', line: 'Read back: the mail is in the sent folder.', check: { id: 'readback-1', checkedOn: '2026-10-21' } });
  const record = entry(deps, id);
  assert.deepEqual(record.ends!.at(-1)!.check, { id: 'readback-1', checkedOn: '2026-10-21' });
  assert.equal(record.ends!.at(-1)!.by, 'engine');
  await assert.rejects(reportEndState(deps, owner, { entryId: id, state: 'result', line: 'Paid.' }), code('JOURNAL_ALREADY_DECIDED'), 'verified is the last');
});

test('an action on several targets records how each ended, and the retry covers only the ones that failed', async () => {
  const { deps } = setup();
  await seed(deps);
  const done = await journalled(deps, owner, write('bulk_reminders', { target: 'Five clients', line: 'Send the five reminders.' }), async () => ({
    outcome: 'applied' as const, line: 'Sent the reminders.', value: null,
    targets: [
      { id: 'client_a', outcome: 'applied' as const, line: 'Sent.' },
      { id: 'client_b', outcome: 'throttled' as const, line: 'The mail server said to wait.' },
      { id: 'client_c', outcome: 'unknown' as const, line: 'No answer.' },
      { id: 'client_d', outcome: 'rejected' as const, line: 'Address refused.' },
      { id: 'client_e', outcome: 'partial' as const, line: 'Sent without the attachment.' },
    ],
  }));
  const record = entry(deps, done.entry.id);
  assert.deepEqual(record.targets!.map(item => [item.id, item.outcome]), [['client_a', 'applied'], ['client_b', 'throttled'], ['client_c', 'unknown'], ['client_d', 'rejected'], ['client_e', 'partial']]);
  assert.equal(record.state, 'outcome_unknown', 'one target may or may not have gone: the owner checks before anything is tried again');
  assert.match(record.journal.at(-1)!.line, /Check before retrying/);
  assert.deepEqual(failedTargets(record), ['client_b', 'client_d'], 'unknown and partial are never tried again on their own');

  const retry = retryProposal(record)!;
  assert.deepEqual(retry.covers, ['client_b', 'client_d']);
  assert.equal(retry.retryOf, record.id);
  assert.equal(retry.action, 'connector.write');
  assert.notEqual(retry.subject, record.subject);
  const proposed = await proposeAction(deps, owner, retry);
  assert.deepEqual(proposed.covers, ['client_b', 'client_d']);
  // A retry that reaches for more than what failed is refused.
  await assert.rejects(proposeAction(deps, owner, { ...retry, subject: `${record.subject}:again`, covers: ['client_b', 'client_c'] }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(proposeAction(deps, owner, { ...retry, subject: `${record.subject}:missing`, retryOf: 'journal_missing' }), code('JOURNAL_NOT_FOUND'));
  const row = (await listed(deps)).find(item => item.id === record.id)!;
  assert.deepEqual(row.targets!.map(item => item.outcome), ['applied', 'throttled', 'unknown', 'rejected', 'partial']);
  assert.equal(await chainState(deps), 'ok');
});

test('the overall state follows the targets: all went is applied, none went is rejected, nothing failed means no retry', async () => {
  const { deps } = setup();
  await seed(deps);
  const all = await journalled(deps, owner, write('all_sent'), async () => ({
    outcome: 'applied' as const, line: 'Sent.', value: null, targets: [{ id: 'a', outcome: 'applied' as const, line: 'Sent.' }, { id: 'b', outcome: 'partial' as const, line: 'Sent part.' }],
  }));
  assert.equal(entry(deps, all.entry.id).state, 'applied');
  assert.equal(retryProposal(entry(deps, all.entry.id)), null);
  const none = await journalled(deps, owner, write('none_sent'), async () => ({
    outcome: 'applied' as const, line: 'Tried.', value: null, targets: [{ id: 'a', outcome: 'throttled' as const, line: 'Wait.' }, { id: 'b', outcome: 'rejected' as const, line: 'Refused.' }],
  }));
  const refused = entry(deps, none.entry.id) as JournalRecord;
  assert.equal(refused.state, 'rejected', 'nothing went out');
  assert.deepEqual(retryProposal(refused)!.covers, ['a', 'b']);
  await assert.rejects(journalled(deps, owner, write('bad_targets'), async () => ({
    outcome: 'applied' as const, line: 'Sent.', value: null, targets: [{ id: 'a', outcome: 'gone' as any, line: 'Gone.' }],
  })), code('INVALID_VENTURE_REQUEST'));
});

test('retries never send a target twice: one live or applied retry holds its targets, so the next covers only the rest', async () => {
  const { deps } = setup();
  await seed(deps);
  const done = await journalled(deps, owner, write('bulk', { target: 'Three clients', line: 'Send the three reminders.' }), async () => ({
    outcome: 'applied' as const, line: 'Sent some.', value: null,
    targets: [{ id: 'a', outcome: 'applied' as const, line: 'Sent.' }, { id: 'b', outcome: 'throttled' as const, line: 'Wait.' }, { id: 'c', outcome: 'rejected' as const, line: 'Refused.' }],
  }));
  const original = entry(deps, done.entry.id);
  const entries = () => listRecords(deps.store.read(), 'venture-journal-entry');
  // A retry of b alone, waiting: the next retry covers only c.
  const onlyB = { ...retryProposal(original, entries())!, covers: ['b'] };
  onlyB.subject = `${original.subject}:retry:b`;
  await proposeAction(deps, owner, onlyB);
  assert.deepEqual(retryProposal(original, entries())!.covers, ['c']);
  // Proposing b again in another retry is refused, while the same retry proposed again is the same proposal.
  await assert.rejects(proposeAction(deps, owner, { ...onlyB, subject: `${original.subject}:retry:b2` }), code('INVALID_VENTURE_REQUEST'));
  assert.equal((await proposeAction(deps, owner, onlyB)).covers![0], 'b');
  // The retry of c goes and applies; nothing is left to retry.
  const rest = retryProposal(original, entries())!;
  await journalled(deps, owner, rest, async () => ({ outcome: 'applied' as const, line: 'Sent.', value: null }));
  const left = retryProposal(original, entries());
  assert.equal(left, null, 'b is held by its waiting retry, c went');
});

test('a website edit read back after writing is verified, with the dated check, through the real apply', async () => {
  const root = await mkdtemp(join(tmpdir(), 'chausar-site-ends-'));
  try {
    await writeFile(join(root, 'index.html'), '<p>Open 9 to 5</p>');
    const { deps } = setup();
    await seed(deps);
    const target = await localFolderTarget(root);
    const staged = await stageSiteEdit(deps, owner, target, { path: 'index.html', after: '<p>Open 8 to 6</p>', summary: 'New hours' });
    await applySiteEdit(deps, owner, target, { editId: staged.id, planDigest: staged.planDigest });
    const own = listRecords(deps.store.read(), 'venture-journal-entry').find(item => item.action === 'site.apply')!;
    assert.equal(own.state, 'applied');
    assert.deepEqual(own.ends!.map(step => [step.state, step.check?.id, step.check?.checkedOn]), [['verified', 'site-readback', '2026-10-21']]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a post the browser saw on the platform after posting is shown, through the real decide', async () => {
  const env = await viewsSetup();
  const port: BrowserPort = {
    async probe() { return { present: true, reason: 'Playwright with Chromium found on this computer.' }; },
    async post() { return { outcome: 'posted', line: 'Posted.', url: null, checked: [{ step: 'confirm', key: 'role:article' }] }; },
  };
  const deps = { ...env.deps, connectors: { browser: port, appReviewed: [], postTimeoutMs: 40 } } as Deps;
  const draft = await seedPostDraft(deps, ['X: Our bakery opens at 8 every weekday.']);
  const post = await proposePost(deps, { ...viewsOwner, channel: 'mcp' }, { connectorId: 'x', draftId: draft.id });
  await decidePost(deps, viewsOwner, { postId: post.id, digest: post.digest, action: 'approve' });
  const after = listRecords(deps.store.read(), 'venture-connector-post').find(item => item.id === post.id)!;
  assert.equal(after.state, 'applied');
  assert.deepEqual(after.ends!.map(step => step.state), ['shown']);
});
