// Ink v2 wave 4 (4J1, J2): an approval is bound to the bytes of the files it covers. Accept on a draft that hands
// over files (attachments, tables or receipts the run made) stores a manifest of each file's sha256; a later share,
// post or send of them is FILE_CHANGED once any byte differs; a new render clears the acceptance and the draft comes
// back to Today for review. Only the owner's principal accepts: a field in the payload never says who approved.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { Context } from '../runtime/contracts.ts';
import type { DeliveryRunRecord, QueueDecision, QueueList, ShareLinkView, VentureDeps, WorkReceiptRecord, WorkTableRecord } from '../runtime/venture/contracts.ts';
import { digest, listRecords, ventureAction } from '../runtime/venture/records.ts';
import { handlers as delivery } from '../runtime/venture/delivery/index.ts';
import { handlers as build } from '../runtime/venture/build/index.ts';
import { seedPostDraft } from './venture-post-drafts.ts';
import { decidePost } from '../runtime/venture/build/posting.ts';
import { checkManifest, manifestOf, refuseChangedFiles } from '../runtime/venture/delivery/file-manifest.ts';
import { call, code, harness, owner, phone, seedBlueprint, seedOrder, seedRun, setStage, setup, type Env } from './venture-views-env.ts';

const review = (env: Env, payload: Record<string, unknown>, ctx: Context = owner) => delivery['venture.delivery.review']!(env.deps, ctx, payload) as Promise<DeliveryRunRecord>;
const runOf = (env: Env, id: string) => listRecords(env.store.read(), 'venture-delivery-run').find(run => run.id === id)!;

/** A ready draft whose run made a table and a reconciliation receipt, attached to the draft. */
async function draftWithFiles() {
  const env = await setup();
  const plan = await seedBlueprint(env, { price2: '1500000' });
  const { order } = await seedOrder(env, plan);
  await setStage(env, 'approve-each');
  const runBase = await seedRun(env, order, { status: 'ready-for-review', servedBy: 'template', renderedText: 'September books are closed. The reconciliation is attached.' });
  const made = await ventureAction(env.deps, owner, 'prepare', 'seed.files', tx => {
    const table = tx.put<WorkTableRecord>({
      ...tx.base('venture-work-table'), name: 'September bank lines', columns: ['Date', 'Amount'], rows: [{ id: 'r1', cells: { Date: '2026-09-02', Amount: '1200.00' } }],
      source: { kind: 'computed', tool: 'calc.totals', uploadIds: [] }, runRef: { kind: 'delivery', runId: runBase.id }, digest: 'table-digest',
    });
    const receipt = tx.put<WorkReceiptRecord>({
      ...tx.base('venture-work-receipt'), operation: 'work.reconcile', runRef: { kind: 'delivery', runId: runBase.id }, currency: 'INR',
      inputs: { tables: [{ id: table.id, name: table.name, digest: table.digest }], columns: {}, rowIds: ['r1'] }, steps: [], figures: [], reconciliation: null,
      allowedNumbers: [], explanation: 'Matched 1 line.', digest: 'receipt-digest',
    });
    const run = tx.find('venture-delivery-run', runBase.id)!;
    tx.replace<DeliveryRunRecord>({
      ...run, harness: harness({ phase: 'done', tableIds: [table.id], workReceiptIds: [receipt.id] }),
      deliverable: { ...(run.deliverable ?? {}), attachments: [{ kind: 'reconciliation', receiptId: receipt.id }] } as DeliveryRunRecord['deliverable'],
    });
    return { table, receipt };
  });
  return { env, run: runOf(env, runBase.id), ...made };
}

test('accept: a draft that hands over files stores the sha256 of each file it covered, with who accepted and when', async () => {
  const { env, run, table, receipt } = await draftWithFiles();
  const accepted = await review(env, { runId: run.id, verdict: 'accepted' });
  assert.equal(accepted.status, 'accepted');
  const stored = runOf(env, run.id);
  assert.ok(stored.manifest, 'a manifest on Accept');
  assert.deepEqual(Object.keys(stored.manifest.files).sort(), [receipt.id, table.id].sort());
  assert.match(stored.manifest.files[table.id], /^[a-f0-9]{64}$/);
  assert.equal(stored.manifest.files[table.id], digest({ name: table.name, columns: table.columns, rows: table.rows }));
  assert.deepEqual([stored.manifest.by, stored.manifest.at], ['owner', env.now()]);
  assert.deepEqual(manifestOf(env.store.read(), stored), stored.manifest.files, 'the same bytes give the same manifest');
  checkManifest(env.store.read(), stored);

  // A draft with no files carries no manifest: its words are already bound by its digest.
  const plain = await seedRun(env, listRecords(env.store.read(), 'venture-order')[0], { status: 'ready-for-review', servedBy: 'template', renderedText: 'Thanks, all done.' });
  await review(env, { runId: plain.id, verdict: 'accepted' });
  assert.equal(runOf(env, plain.id).manifest ?? null, null);
});

test('a share, post or send after any byte changed is FILE_CHANGED; a new render clears the acceptance and Today asks again', async () => {
  const { env, run, table } = await draftWithFiles();
  await review(env, { runId: run.id, verdict: 'accepted' });
  // One cell changes: a new render of the table under the same id.
  await ventureAction(env.deps, owner, 'prepare', 'seed.render', tx => {
    const current = tx.find('venture-work-table', table.id)!;
    tx.replace<WorkTableRecord>({ ...current, rows: [{ id: 'r1', cells: { Date: '2026-09-02', Amount: '1210.00' } }] });
  });
  assert.throws(() => checkManifest(env.store.read(), runOf(env, run.id)), code('FILE_CHANGED'));
  await assert.rejects(refuseChangedFiles(env.deps, owner, run.id), code('FILE_CHANGED'));
  const cleared = runOf(env, run.id);
  assert.deepEqual([cleared.status, cleared.verdict, cleared.manifest ?? null], ['ready-for-review', null, null], 'the acceptance is cleared');
  const rows = (await call<QueueList>(env, 'venture.queue.list', {})).rows.filter(row => row.kind === 'draft');
  assert.equal(rows.length, 1, 'the draft is back on Today for review');
  assert.deepEqual(rows[0].viewRef, { kind: 'draft', id: run.id });
  // Accepting again binds the new bytes.
  await review(env, { runId: run.id, verdict: 'accepted' });
  checkManifest(env.store.read(), runOf(env, run.id));
  await refuseChangedFiles(env.deps, owner, run.id);
  // A file that is gone is a change too.
  await env.store.update(state => { state.conversations = state.conversations.filter((record: { id?: unknown }) => record?.id !== table.id); });
  assert.throws(() => checkManifest(env.store.read(), runOf(env, run.id)), code('FILE_CHANGED'));
});

test('only the owner principal accepts, in the app: an approvedBy field is refused, and an accountant cannot', async () => {
  const { env, run } = await draftWithFiles();
  await assert.rejects(review(env, { runId: run.id, verdict: 'accepted', approvedBy: 'owner' }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(review(env, { runId: run.id, verdict: 'accepted' }, phone), code('APP_APPROVAL_REQUIRED'));
  await env.store.update(state => {
    state.members.push({ id: 'books', name: 'Accountant', role: 'accountant', active: true, epoch: 1, branches: ['*'] });
    state.members.push({ id: 'asha', name: 'Asha', role: 'cofounder', active: true, epoch: 1, branches: ['*'] });
  });
  await assert.rejects(review(env, { runId: run.id, verdict: 'accepted' }, { memberId: 'books', role: 'accountant', epoch: 1, channel: 'desktop' }), code('FORBIDDEN'));
  assert.equal(runOf(env, run.id).manifest ?? null, null, 'nothing was accepted');
  await review(env, { runId: run.id, verdict: 'accepted' }, { memberId: 'asha', role: 'cofounder', epoch: 1, channel: 'desktop' });
  assert.equal(runOf(env, run.id).manifest?.by, 'asha');
});

test('a client file the run only read is not in the manifest: Accept covers what the draft hands over', async () => {
  const { env, run, table, receipt } = await draftWithFiles();
  const bytes = Buffer.from('Date,Amount\n2026-09-02,1200.00\n');
  const upload = await ventureAction(env.deps, owner, 'prepare', 'seed.upload', tx => {
    const record = tx.put({
      ...tx.base('venture-upload'), name: 'statement.csv', format: 'csv' as const, bytes: bytes.length, digest: createHash('sha256').update(bytes).digest('hex'),
      contentBase64: bytes.toString('base64'), scope: { kind: 'order' as const, orderId: run.orderId }, clientData: true,
    });
    const current = tx.find('venture-delivery-run', run.id)!;
    tx.replace<DeliveryRunRecord>({ ...current, uploadIds: [record.id], harness: { ...current.harness!, uploadIds: [record.id] } });
    return record;
  });
  await review(env, { runId: run.id, verdict: 'accepted' });
  const files = runOf(env, run.id).manifest!.files;
  assert.deepEqual(Object.keys(files).sort(), [receipt.id, table.id].sort());
  assert.equal(files[upload.id], undefined);
});

/** One cell of the run's table changes under the same id: a new render. */
const rerender = (env: Env, tableId: string, amount: string) => ventureAction(env.deps, owner, 'prepare', 'seed.render', tx => {
  const current = tx.find('venture-work-table', tableId)!;
  tx.replace<WorkTableRecord>({ ...current, rows: [{ id: 'r1', cells: { Date: '2026-09-02', Amount: amount } }] });
});
const draftRows = async (env: Env) => (await call<QueueList>(env, 'venture.queue.list', {})).rows.filter(row => row.kind === 'draft');

test('accepted on Today, then a file changed: the draft comes back to Today as a new row, and deciding it there works', async () => {
  const { env, run, table } = await draftWithFiles();
  const [first] = await draftRows(env);
  assert.equal(first.id, `run:${run.id}:review`);
  const accepted = await call<QueueDecision>(env, 'venture.queue.decide', { id: first.id, digest: first.digest, action: 'approve', viewed: true });
  assert.equal(accepted.outcome, 'done', accepted.line);
  assert.ok(runOf(env, run.id).manifest, 'Accept on Today binds the files too');
  assert.equal((await draftRows(env)).length, 0);
  await rerender(env, table.id, '1210.00');
  await assert.rejects(refuseChangedFiles(env.deps, owner, run.id), code('FILE_CHANGED'));
  const reopened = runOf(env, run.id);
  assert.deepEqual([reopened.status, reopened.reopened?.count, reopened.reopened?.files], ['ready-for-review', 1, [table.id]]);
  const [again] = await draftRows(env);
  assert.ok(again, 'the draft is back on Today');
  assert.equal(again.id, `run:${run.id}:review-2`, 'a new row version, not the one already decided');
  const decided = await call<QueueDecision>(env, 'venture.queue.decide', { id: again.id, digest: again.digest, action: 'approve', viewed: true });
  assert.equal(decided.outcome, 'done', decided.line);
  assert.equal(runOf(env, run.id).status, 'accepted');
  checkManifest(env.store.read(), runOf(env, run.id));
});

test('an edit binds the files too; a file the draft hands over that the manifest does not name is a change', async () => {
  const { env, run, table } = await draftWithFiles();
  await review(env, { runId: run.id, verdict: 'edited', editedText: 'September books are closed. The reconciliation is attached, checked by me.' });
  const edited = runOf(env, run.id);
  assert.equal(edited.status, 'edited');
  assert.ok(edited.manifest?.files[table.id], 'the edit covers the same files');
  checkManifest(env.store.read(), edited);
  // The run makes one more table after the owner looked: the owner never saw it.
  await ventureAction(env.deps, owner, 'prepare', 'seed.more', tx => {
    tx.put<WorkTableRecord>({ ...tx.base('venture-work-table'), name: 'Late lines', columns: ['Amount'], rows: [], source: { kind: 'computed', tool: 'calc.totals', uploadIds: [] }, runRef: { kind: 'delivery', runId: run.id }, digest: 'late' });
  });
  assert.throws(() => checkManifest(env.store.read(), runOf(env, run.id)), code('FILE_CHANGED'));
  await assert.rejects(refuseChangedFiles(env.deps, owner, run.id), code('FILE_CHANGED'));
  const back = runOf(env, run.id);
  assert.deepEqual([back.status, back.verdict, back.manifest ?? null], ['ready-for-review', null, null]);
  assert.equal(back.editedText, edited.editedText, "the owner's own words are kept");
});

test('an accepted draft that hands over files but has no manifest counts as changed', async () => {
  const { env, run } = await draftWithFiles();
  await ventureAction(env.deps, owner, 'prepare', 'seed.old', tx => {
    tx.replace<DeliveryRunRecord>({ ...tx.find('venture-delivery-run', run.id)!, status: 'accepted', verdict: { choice: 'accepted', reason: null, at: tx.now } });
  });
  assert.throws(() => checkManifest(env.store.read(), runOf(env, run.id)), code('FILE_CHANGED'));
});

test('venture.share.create refuses a draft whose files changed after Accept, and the draft goes back to Today', async () => {
  const { env, run, table } = await draftWithFiles();
  await review(env, { runId: run.id, verdict: 'accepted' });
  const link = await build['venture.share.create']!(env.deps, owner, { deliveryId: run.id }) as ShareLinkView;
  assert.ok(link.id, 'unchanged files share');
  await rerender(env, table.id, '1300.00');
  await assert.rejects(build['venture.share.create']!(env.deps, owner, { deliveryId: run.id }), code('FILE_CHANGED'));
  assert.equal(runOf(env, run.id).status, 'ready-for-review');
  assert.equal(listRecords(env.store.read(), 'venture-share-link').length, 1, 'no second link');
  assert.equal((await draftRows(env)).length, 1);
});

test('venture.posting.propose refuses a post from a draft whose files changed after Accept', async () => {
  const env = await setup();
  await setStage(env, 'approve-each');
  env.deps = { ...env.deps, connectors: { browser: { async probe() { return { present: true, reason: 'Playwright with Chromium found on this computer.' }; }, async post() { return { outcome: 'posted', line: 'Posted.', url: null }; }, signIn() { return new Promise(() => {}); } }, appReviewed: [], postTimeoutMs: 40 } } as VentureDeps;
  const draft = await seedPostDraft(env.deps, ['LinkedIn: Our cafe opens at 8 every weekday.'], { status: 'ready-for-review', verdict: null });
  const table = await ventureAction(env.deps, owner, 'prepare', 'seed.table', tx => tx.put<WorkTableRecord>({
    ...tx.base('venture-work-table'), name: 'Opening hours', columns: ['Day'], rows: [{ id: 'r1', cells: { Day: 'Mon' } }], source: { kind: 'computed', tool: 'calc.totals', uploadIds: [] },
    runRef: { kind: 'delivery', runId: draft.id }, digest: 'hours',
  }));
  await review(env, { runId: draft.id, verdict: 'accepted' });
  const post = (payload: Record<string, unknown>) => build['venture.posting.propose']!(env.deps, owner, payload) as Promise<{ state: string }>;
  assert.equal((await post({ draftId: `${draft.id}.post-1` })).state, 'described');
  await ventureAction(env.deps, owner, 'prepare', 'seed.render', tx => {
    tx.replace<WorkTableRecord>({ ...tx.find('venture-work-table', table.id)!, rows: [{ id: 'r1', cells: { Day: 'Tue' } }] });
  });
  await assert.rejects(post({ draftId: `${draft.id}.post-1` }), code('FILE_CHANGED'));
  assert.equal(runOf(env, draft.id).status, 'ready-for-review', 'the acceptance is cleared, so the owner looks again');
  assert.equal(listRecords(env.store.read(), 'venture-connector-post').length, 1, 'no second proposal');
});

test('approving a post checks the files again: changed after it was proposed, nothing is posted and the draft goes back for review', async () => {
  const env = await setup();
  await setStage(env, 'approve-each');
  const posted: string[] = [];
  env.deps = { ...env.deps, connectors: { browser: { async probe() { return { present: true, reason: 'Playwright with Chromium found on this computer.' }; }, async post(job: { text: string }) { posted.push(job.text); return { outcome: 'posted', line: 'Posted.', url: null }; }, signIn() { return new Promise(() => {}); } }, appReviewed: [], postTimeoutMs: 40 } } as VentureDeps;
  const draft = await seedPostDraft(env.deps, ['LinkedIn: Our cafe opens at 8 every weekday.'], { status: 'ready-for-review', verdict: null });
  const table = await ventureAction(env.deps, owner, 'prepare', 'seed.table', tx => tx.put<WorkTableRecord>({
    ...tx.base('venture-work-table'), name: 'Opening hours', columns: ['Day'], rows: [{ id: 'r1', cells: { Day: 'Mon' } }], source: { kind: 'computed', tool: 'calc.totals', uploadIds: [] },
    runRef: { kind: 'delivery', runId: draft.id }, digest: 'hours',
  }));
  await review(env, { runId: draft.id, verdict: 'accepted' });
  await build['venture.posting.propose']!(env.deps, owner, { draftId: `${draft.id}.post-1` });
  const [proposed] = listRecords(env.store.read(), 'venture-connector-post');
  await ventureAction(env.deps, owner, 'prepare', 'seed.render', tx => {
    tx.replace<WorkTableRecord>({ ...tx.find('venture-work-table', table.id)!, rows: [{ id: 'r1', cells: { Day: 'Tue' } }] });
  });
  await assert.rejects(decidePost(env.deps, owner, { postId: proposed.id, digest: proposed.digest, action: 'approve' }), code('FILE_CHANGED'));
  assert.deepEqual(posted, [], 'nothing went out');
  assert.equal(runOf(env, draft.id).status, 'ready-for-review');
});

test('a draft the owner edited and that came back for review keeps the edit: Accept and the share link use the owner\'s words', async () => {
  const { env, run, table } = await draftWithFiles();
  const mine = 'September books are closed. I checked the reconciliation myself.';
  await review(env, { runId: run.id, verdict: 'edited', editedText: mine });
  await rerender(env, table.id, '1222.00');
  await assert.rejects(refuseChangedFiles(env.deps, owner, run.id), code('FILE_CHANGED'));
  await review(env, { runId: run.id, verdict: 'accepted' });
  assert.equal(runOf(env, run.id).editedText, mine, 'Accept keeps the owner\'s words');
  await build['venture.share.create']!(env.deps, owner, { deliveryId: run.id });
  const [link] = listRecords(env.store.read(), 'venture-share-link');
  assert.equal(link.text, mine, 'the client sees the owner\'s edit, not the agent\'s text');
});
