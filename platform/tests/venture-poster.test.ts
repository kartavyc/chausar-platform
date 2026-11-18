// Ink v2 wave 4, package 4J3: an order's poster, one small JPEG still from the cut named at intake, as the run tiles
// read it from the vault, checked by its bytes and never a stand-in. No method takes a still any more; a vault may
// still hold one. And ffmpeg opens the cut as a plain file only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RunDetail, RunSummary, UploadRecord, VentureDeps } from '../runtime/venture/contracts.ts';
import { finishingCheck, type FfmpegPort } from '../runtime/venture/playbooks/youtube/finishing.ts';
import { makeLocalTranscript } from '../runtime/venture/playbooks/youtube/transcribe.ts';
import { digest } from '../runtime/venture/records.ts';
import { call, owner, seedRun, setup } from './venture-views-env.ts';
import { put, record, seedYoutube, youtubeDraft } from './venture-previews-env.ts';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);
const PROBE_LOG = 'Input #0, mov,mp4, from \'episode-14.mp4\':\n  Duration: 00:11:42.00, start: 0.000000, bitrate: 900 kb/s\n  Stream #0:0: Video: h264, yuv420p, 1920x1080, 25 fps\nAt least one output file must be specified\n';

/** ffmpeg may open only plain files: the whitelist comes right before the input, so no other protocol is ever read. */
function fileOnly(args: readonly string[]): void {
  const at = args.indexOf('-i');
  assert.ok(at >= 2, 'an input');
  assert.deepEqual(args.slice(at - 2, at), ['-protocol_whitelist', 'file']);
}

test('poster: the finishing check and a transcript made here open the cut as a plain file only', async t => {
  const folder = mkdtempSync(join(tmpdir(), 'chausar-poster-test-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const cut = join(folder, 'episode-14.mp4');
  writeFileSync(cut, 'not really a video');
  const checked: string[][] = [];
  const checking: FfmpegPort = { locate: () => 'ffmpeg', run: async (_binary, args) => { checked.push([...args]); return { code: 0, stderr: PROBE_LOG, timedOut: false, startError: null }; } };
  await finishingCheck(cut, { format: 'long', ffmpeg: checking, exists: () => true });
  assert.ok(checked.length >= 1);
  for (const args of checked) fileOnly(args);
  const transcribing: string[][] = [];
  const port: FfmpegPort = {
    locate: () => 'ffmpeg',
    run: async (_binary, args) => { transcribing.push([...args]); writeFileSync(args.at(-1)!, 'RIFF'); return { code: 0, stderr: '', timedOut: false, startError: null }; },
  };
  const speech = {
    localTranscriber: () => ({ ready: true as const }),
    transcribeFile: async () => ({ srt: '1\n00:00:00,000 --> 00:00:04,000\nHello there.\n', providerId: 'whisper-local' }),
  };
  const deps = { host: 'test', ffmpeg: port, services: { speech } } as unknown as VentureDeps;
  const transcribeFolders = () => readdirSync(tmpdir()).filter(name => name.startsWith('chausar-transcribe-'));
  const before = transcribeFolders();
  await makeLocalTranscript(deps, owner, { cutFile: cut, prompt: '' });
  assert.equal(transcribing.length, 1);
  fileOnly(transcribing[0]);
  assert.deepEqual(transcribeFolders(), before);
});

test('poster: a YouTube run tile carries the still from its order, or null; other runs carry none', async t => {
  const folder = mkdtempSync(join(tmpdir(), 'chausar-poster-test-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const cut = join(folder, 'episode-14.mp4');
  writeFileSync(cut, 'not really a video');
  const env = await setup();
  const { order, playbook } = await seedYoutube(env, { cutFile: cut });
  const draft = { status: 'ready-for-review' as const, playbookId: playbook.id, deliverable: youtubeDraft('The mic that beat the room'), renderedText: 'x', checks: [] };
  const older = await seedRun(env, order, draft);
  env.advance(60_000);
  const youtube = await seedRun(env, order, draft);
  const plain = await seedRun(env, order, { status: 'ready-for-review', renderedText: 'x', checks: [] });
  const tiles = async () => (await call<{ runs: RunSummary[] }>(env, 'venture.runs.list', {})).runs;
  const tile = async (runId: string) => (await tiles()).find(run => run.runId === runId)!;
  assert.equal((await tile(youtube.id)).poster, null);
  assert.equal((await tile(older.id)).poster, null);
  assert.equal('poster' in await tile(plain.id), false);
  // The still as a vault holds it, written straight in.
  const encoded = JPEG.toString('base64');
  const view = await put(env, tx => record<UploadRecord>(tx, 'venture-upload', {
    name: 'episode-14 still.jpg', format: 'image', bytes: JPEG.length, digest: digest(encoded), contentBase64: encoded, scope: { kind: 'poster', orderId: order.id },
    clientData: true, origin: 'poster',
  }));
  const src = `data:image/jpeg;base64,${JPEG.toString('base64')}`;
  // The list carries the image once per order, on its newest run; an older run's tile names the still without it.
  assert.deepEqual((await tile(youtube.id)).poster, { uploadId: view.id, src });
  assert.deepEqual((await tile(older.id)).poster, { uploadId: view.id, src: null });
  // A run's own details carry the whole still.
  assert.deepEqual((await call<RunDetail>(env, 'venture.runs.get', { runId: older.id })).poster, { uploadId: view.id, src });
  assert.deepEqual((await call<RunDetail>(env, 'venture.runs.get', { runId: youtube.id })).poster, { uploadId: view.id, src });
  assert.equal('poster' in await call<RunDetail>(env, 'venture.runs.get', { runId: plain.id }), false);
});
