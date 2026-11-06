// Ink v2 wave 4, package 4J3 (A17): the Delivered card on an accepted run's details. It lists the files the run handed
// over, made by its own tools with their digests, and apart from them the files that changed on the order while the run
// went on, made by someone else and labelled "Changed during this run, not proven to be the agent's."
import test from 'node:test';
import assert from 'node:assert/strict';
import type { DelegateRunRecord, RunDetail, UploadRecord, WorkTableRecord } from '../runtime/venture/contracts.ts';
import { digest } from '../runtime/venture/records.ts';
import { call, harness, seedRun, setup, type Env } from './venture-views-env.ts';
import { editListCall, put, record, seedYoutube, transcriptUpload, youtubeDraft } from './venture-previews-env.ts';

const runOf = (env: Env, runId: string) => call<RunDetail>(env, 'venture.runs.get', { runId });
const MINUTE = 60_000;

function csvUpload(env: Env, orderId: string, name: string) {
  const encoded = Buffer.from('date,amount\n2026-10-01,100\n', 'utf8').toString('base64');
  return put(env, tx => record<UploadRecord>(tx, 'venture-upload', {
    name, format: 'csv', bytes: 27, digest: digest(encoded), contentBase64: encoded, scope: { kind: 'order', orderId }, clientData: true,
  }));
}

test('delivered: an accepted run lists the files its tools made, with digests, and apart the files someone else changed', async () => {
  const env = await setup();
  const { order, playbook } = await seedYoutube(env);
  const transcript = await put(env, tx => transcriptUpload(tx, order.id, 702000));
  env.advance(MINUTE);
  const run = await seedRun(env, order, {
    status: 'ready-for-review', playbookId: playbook.id, deliverable: youtubeDraft('The mic that beat the room'), renderedText: 'x', checks: [],
  });
  env.advance(MINUTE);
  const table = await put(env, tx => record<WorkTableRecord>(tx, 'venture-work-table', {
    name: 'Edit list at 25 frames a second', columns: ['From', 'To'], rows: [], source: { kind: 'computed', tool: 'youtube.editList', uploadIds: [transcript.id] },
    runRef: { kind: 'delivery', runId: run.id }, digest: 'table-digest',
  }));
  // A table the run's records name but no succeeded call of it made is not the run's to hand over.
  const stray = await put(env, tx => record<WorkTableRecord>(tx, 'venture-work-table', {
    name: 'A table from a failed call', columns: ['A'], rows: [], source: { kind: 'computed', tool: 'youtube.hooks', uploadIds: [] },
    runRef: { kind: 'delivery', runId: run.id }, digest: 'stray-digest',
  }));
  const delegated = await put(env, tx => record<DelegateRunRecord>(tx, 'venture-delegate-run', {
    runId: run.id, toolCallId: 'call_delegate', cli: 'claude-code', executable: 'claude', version: '2.0.0', approvedDigest: 'a', limits: { minutes: 10, maxTurns: 5, budgetMicros: null },
    outcome: 'succeeded', exitCode: 0, reason: 'It finished.', outputs: [{ name: 'notes.md', bytes: 120, digest: 'notes-digest', text: 'Notes.', note: null }],
    log: '', reportedCost: null, figures: [], uncheckedNumbers: 0, untrusted: true,
  }));
  // The owner adds a file to the order while the run goes on; it was never among the run's own files.
  const added = await csvUpload(env, order.id, 'new-bills.csv');
  env.advance(MINUTE);
  const failedCall = { ...editListCall(0, 25, stray.id), id: 'call_failed', tool: 'youtube.hooks', outcome: 'failed' as const, envelope: { ok: false as const, error: { code: 'TOOL_FAILED', name: 'Error', message: 'No.' } } };
  await put(env, tx => {
    const current = tx.find('venture-delivery-run', run.id)!;
    return tx.replace({
      ...current, status: 'accepted', verdict: { choice: 'accepted', reason: null, at: tx.now },
      harness: harness({ phase: 'done', uploadIds: [transcript.id], tableIds: [table.id, stray.id], toolCalls: [editListCall(16800, 25, table.id), failedCall] }),
    });
  });
  env.advance(MINUTE);
  // After the verdict: not changed during the run.
  await csvUpload(env, order.id, 'later.csv');

  const detail = await runOf(env, run.id);
  assert.deepEqual(detail.delivered, {
    line: 'Handed over 2 files.',
    files: [
      { id: table.id, name: 'Edit list at 25 frames a second', digest: 'table-digest', at: table.at, source: 'table', line: 'Built the edit list' },
      { id: `${delegated.id}:1`, name: 'notes.md', digest: 'notes-digest', at: delegated.at, source: 'delegate', line: 'What Claude Code left' },
    ],
    changed: [{ id: added.id, name: 'new-bills.csv', digest: added.digest, at: added.at, source: 'order-file', line: 'A file added to the order' }],
    changedLine: "Changed during this run, not proven to be the agent's.",
  });
});

test('delivered: a run with no files says it handed over the draft only; a run not accepted has no Delivered card', async () => {
  const env = await setup();
  const { order, playbook } = await seedYoutube(env);
  const waiting = await seedRun(env, order, { status: 'ready-for-review', playbookId: playbook.id, deliverable: youtubeDraft('The mic that beat the room'), renderedText: 'x', checks: [] });
  assert.equal('delivered' in await runOf(env, waiting.id), false);
  const accepted = await seedRun(env, order, {
    status: 'accepted', playbookId: playbook.id, deliverable: youtubeDraft('The mic that beat the room'), renderedText: 'x', checks: [],
    verdict: { choice: 'accepted', reason: null, at: env.now() },
  });
  assert.deepEqual((await runOf(env, accepted.id)).delivered, {
    line: 'Handed over the draft only: its tools made no files.', files: [], changed: [], changedLine: null,
  });
});

test('delivered: a still and a transcript made on this computer during the run are listed as changed, never as handed over', async () => {
  const env = await setup();
  const { order, playbook } = await seedYoutube(env, { cutFile: 'D:\\footage\\episode-14.mp4' });
  const run = await seedRun(env, order, { status: 'ready-for-review', playbookId: playbook.id, deliverable: youtubeDraft('The mic that beat the room'), renderedText: 'x', checks: [] });
  env.advance(MINUTE);
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64');
  const made = await put(env, tx => ({
    still: record<UploadRecord>(tx, 'venture-upload', {
      name: 'episode-14 still.jpg', format: 'image', bytes: 4, digest: digest(jpeg), contentBase64: jpeg, scope: { kind: 'poster', orderId: order.id }, clientData: true, origin: 'poster',
    }),
    transcript: tx.replace({ ...transcriptUpload(tx, order.id, 9000), origin: 'local-transcription' as const }),
  }));
  env.advance(MINUTE);
  await put(env, tx => tx.replace({ ...tx.find('venture-delivery-run', run.id)!, status: 'accepted' as const, verdict: { choice: 'accepted' as const, reason: null, at: tx.now } }));
  const delivered = (await runOf(env, run.id)).delivered!;
  assert.deepEqual(delivered.files, []);
  assert.deepEqual(delivered.changed.map(file => [file.id, file.source, file.line]), [
    [made.still.id, 'poster', 'A still from the cut'],
    [made.transcript.id, 'transcript', 'A transcript made on this computer'],
  ]);
});
