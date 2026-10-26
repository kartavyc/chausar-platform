// Ink v2 wave 4, package 4J3: venture.files.poster { orderId } (desktop, app only). One still at a tenth of the cut
// named at intake, taken by the ffmpeg already on this computer, kept as the order's poster: a small JPEG, checked by
// its bytes, never a stand-in. Without ffmpeg it says so and makes nothing; the hosted server never reads a cut.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Context } from '../runtime/contracts.ts';
import type { RunDetail, RunSummary, UploadRecord, UploadView, VentureDeps } from '../runtime/venture/contracts.ts';
import { finishingCheck, type FfmpegPort, type FfmpegRun } from '../runtime/venture/playbooks/youtube/finishing.ts';
import { makeLocalTranscript } from '../runtime/venture/playbooks/youtube/transcribe.ts';
import { listRecords } from '../runtime/venture/records.ts';
import { handlers as delivery } from '../runtime/venture/delivery/index.ts';
import { POSTER_MAX_BYTES, POSTER_NO_FFMPEG } from '../runtime/venture/delivery/poster.ts';
import { call, code, owner, phone, seedRun, setup, type Env } from './venture-views-env.ts';
import { put, seedYoutube, youtubeDraft } from './venture-previews-env.ts';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);
const PROBE_LOG = 'Input #0, mov,mp4, from \'episode-14.mp4\':\n  Duration: 00:11:42.00, start: 0.000000, bitrate: 900 kb/s\n  Stream #0:0: Video: h264, yuv420p, 1920x1080, 25 fps\nAt least one output file must be specified\n';

/**
 * A stand-in ffmpeg: answers the probe with a log and writes `still` to the last argument when asked for a frame. end:
 * how the frame run ends (it still leaves its file behind, as a real run cut short can).
 */
class StubFfmpeg implements FfmpegPort {
  calls: string[][] = [];
  found = true;
  still: Buffer | null = JPEG;
  exit = 0;
  end: 'closed' | 'timeout' | 'aborted' = 'closed';
  /** Where the frame run was asked to write its still: inside the poster's own temporary folder. */
  out: string | null = null;
  locate() { return this.found ? 'C:\\tools\\ffmpeg.exe' : null; }
  async run(_binary: string, args: readonly string[]): Promise<FfmpegRun> {
    this.calls.push([...args]);
    if (!args.includes('-frames:v')) return { code: 1, stderr: PROBE_LOG, timedOut: false, startError: null };
    this.out = args.at(-1)!;
    if (this.still) writeFileSync(this.out, this.still);
    if (this.end === 'timeout') return { code: null, stderr: '', timedOut: true, startError: null };
    if (this.end === 'aborted') return { code: null, stderr: '', timedOut: false, startError: null, aborted: true };
    return { code: this.exit, stderr: '', timedOut: false, startError: null };
  }
}

/** ffmpeg may open only plain files: the whitelist comes right before the input, so no other protocol is ever read. */
function fileOnly(args: readonly string[]): void {
  const at = args.indexOf('-i');
  assert.ok(at >= 2, 'an input');
  assert.deepEqual(args.slice(at - 2, at), ['-protocol_whitelist', 'file']);
}
/** The poster folders ffmpeg's runs left in the temporary folder. */
const posterFolders = () => readdirSync(tmpdir()).filter(name => name.startsWith('chausar-poster-') && !name.startsWith('chausar-poster-test-'));

const poster = (env: Env, payload: unknown, ctx: Context = owner) => delivery['venture.files.poster']!(env.deps, ctx, payload) as Promise<UploadView>;

async function cutSetup(t: { after(fn: () => void): void }) {
  const folder = mkdtempSync(join(tmpdir(), 'chausar-poster-test-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const cut = join(folder, 'episode-14.mp4');
  writeFileSync(cut, 'not really a video');
  const env = await setup();
  const ffmpeg = new StubFfmpeg();
  (env.deps as VentureDeps).ffmpeg = ffmpeg;
  const seeded = await seedYoutube(env, { cutFile: cut });
  return { env, ffmpeg, cut, ...seeded };
}

test('poster: one still at a tenth of the cut, kept as the order\'s poster, never listed as a client file', async t => {
  const { env, ffmpeg, cut, order } = await cutSetup(t);
  const view = await poster(env, { orderId: order.id });
  assert.equal(view.name, 'episode-14 still.jpg');
  assert.equal(view.format, 'image');
  assert.equal(view.origin, 'poster');
  assert.deepEqual(view.scope, { kind: 'poster', orderId: order.id });
  assert.equal(view.bytes, JPEG.length);
  assert.equal('contentBase64' in view, false);
  // The probe reads the length (702 s); the still is taken at a tenth of it, 70.2 s, and nothing else is run.
  assert.equal(ffmpeg.calls.length, 2);
  assert.deepEqual(ffmpeg.calls[0], ['-hide_banner', '-nostdin', '-protocol_whitelist', 'file', '-i', cut]);
  const still = ffmpeg.calls[1];
  assert.deepEqual(still.slice(0, 9), ['-hide_banner', '-nostats', '-nostdin', '-ss', '70.200', '-protocol_whitelist', 'file', '-i', cut]);
  assert.ok(still.includes('-frames:v') && still.includes('-an'));
  for (const args of ffmpeg.calls) fileOnly(args);
  // The still was made in a folder of its own, removed once the still was read.
  assert.match(dirname(ffmpeg.out!), /chausar-poster-/);
  assert.equal(existsSync(dirname(ffmpeg.out!)), false);
  const [stored] = listRecords(env.store.read(), 'venture-upload').filter((item: UploadRecord) => item.origin === 'poster');
  assert.equal(stored.contentBase64, JPEG.toString('base64'));
  assert.equal(stored.clientData, true);
  // The order's files are the client's: the still is reached through the card's preview, not the file list.
  assert.deepEqual(await delivery['venture.files.list']!(env.deps, owner, { orderId: order.id }), []);
  assert.deepEqual(await delivery['venture.files.list']!(env.deps, owner, {}), []);
  const events = env.published.flat().map(event => event.name);
  assert.ok(events.includes('upload-added') && events.includes('queue.changed'));
  // A new still replaces the old one: one poster per order.
  ffmpeg.still = Buffer.concat([JPEG.subarray(0, 12), Buffer.from([0x01, 0x02]), JPEG.subarray(12)]);
  const again = await poster(env, { orderId: order.id });
  assert.equal(again.id, view.id);
  assert.notEqual(again.digest, view.digest);
  assert.equal(listRecords(env.store.read(), 'venture-upload').filter((item: UploadRecord) => item.origin === 'poster').length, 1);
});

test('poster: without ffmpeg there is no still, Chausar installs nothing, and nothing is kept', async t => {
  const { env, ffmpeg, order } = await cutSetup(t);
  ffmpeg.found = false;
  await assert.rejects(poster(env, { orderId: order.id }), (error: any) => {
    assert.equal(error.code, 'POSTER_NOT_AVAILABLE');
    assert.equal(error.message, "ffmpeg isn't on this computer, so there is no still. Chausar never installs it.");
    return true;
  });
  assert.equal(POSTER_NO_FFMPEG, "ffmpeg isn't on this computer, so there is no still. Chausar never installs it.");
  assert.equal(ffmpeg.calls.length, 0);
  assert.equal(listRecords(env.store.read(), 'venture-upload').length, 0);
});

test('poster: anything but a small JPEG is refused and nothing is kept; a failed run keeps nothing either', async t => {
  const { env, ffmpeg, order } = await cutSetup(t);
  ffmpeg.still = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', 'utf8');
  await assert.rejects(poster(env, { orderId: order.id }), code('POSTER_NOT_AVAILABLE'));
  ffmpeg.still = Buffer.concat([JPEG.subarray(0, 4), Buffer.alloc(POSTER_MAX_BYTES), JPEG.subarray(4)]);
  await assert.rejects(poster(env, { orderId: order.id }), code('POSTER_NOT_AVAILABLE'));
  ffmpeg.still = JPEG;
  ffmpeg.exit = 1;
  await assert.rejects(poster(env, { orderId: order.id }), code('POSTER_NOT_AVAILABLE'));
  assert.equal(listRecords(env.store.read(), 'venture-upload').length, 0);
});

test('poster: the temporary folder is removed whatever happens, a timed-out or a stopped ffmpeg run included', async t => {
  const { env, ffmpeg, order } = await cutSetup(t);
  const before = posterFolders();
  for (const end of ['timeout', 'aborted', 'closed'] as const) {
    ffmpeg.end = end;
    ffmpeg.out = null;
    if (end === 'closed') await poster(env, { orderId: order.id });
    else await assert.rejects(poster(env, { orderId: order.id }), code('POSTER_NOT_AVAILABLE'));
    assert.ok(ffmpeg.out, `${end}: ffmpeg was asked for a still`);
    assert.equal(existsSync(dirname(ffmpeg.out)), false, `${end}: its folder is gone`);
  }
  assert.deepEqual(posterFolders(), before);
  // Only the run that finished kept a still.
  assert.equal(listRecords(env.store.read(), 'venture-upload').length, 1);
});

test('poster: a playlist or a concat list named as the cut is refused before ffmpeg reads it', async t => {
  const { env, ffmpeg, order, cut } = await cutSetup(t);
  for (const content of ['#EXTM3U\n#EXTINF:10,\nhttps://example.test/part1.ts\n', 'ffconcat version 1.0\nfile /etc/passwd\n', "file 'part1.mp4'\nfile 'part2.mp4'\n"]) {
    writeFileSync(cut, content);
    await assert.rejects(poster(env, { orderId: order.id }), (error: any) => {
      assert.equal(error.code, 'INVALID_VENTURE_REQUEST');
      assert.match(error.message, /playlist|list of files/);
      return true;
    });
  }
  assert.equal(ffmpeg.calls.length, 0);
  // Named as a playlist, it is refused by its name too.
  const playlist = join(dirname(cut), 'episode-14.m3u8');
  writeFileSync(playlist, 'not read');
  await put(env, tx => tx.replace({ ...tx.find('venture-order', order.id)!, intake: { ...tx.find('venture-order', order.id)!.intake!, cutFile: playlist } }));
  await assert.rejects(poster(env, { orderId: order.id }), code('INVALID_VENTURE_REQUEST'));
  assert.equal(ffmpeg.calls.length, 0);
});

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
  const { env, order, playbook } = await cutSetup(t);
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
  const view = await poster(env, { orderId: order.id });
  const src = `data:image/jpeg;base64,${JPEG.toString('base64')}`;
  // The list carries the image once per order, on its newest run; an older run's tile names the still without it.
  assert.deepEqual((await tile(youtube.id)).poster, { uploadId: view.id, src });
  assert.deepEqual((await tile(older.id)).poster, { uploadId: view.id, src: null });
  // A run's own details carry the whole still.
  assert.deepEqual((await call<RunDetail>(env, 'venture.runs.get', { runId: older.id })).poster, { uploadId: view.id, src });
  assert.deepEqual((await call<RunDetail>(env, 'venture.runs.get', { runId: youtube.id })).poster, { uploadId: view.id, src });
  assert.equal('poster' in await call<RunDetail>(env, 'venture.runs.get', { runId: plain.id }), false);
});

test('poster: the hosted server, the phone, an order with no cut, a missing cut and a bad request are each refused', async t => {
  const { env, cut, order } = await cutSetup(t);
  await assert.rejects(poster(env, { orderId: order.id }, phone), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(poster(env, { orderId: order.id, uploadId: 'x' }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(poster(env, {}), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(poster(env, { orderId: 'order_missing' }), code('ORDER_NOT_FOUND'));
  (env.deps as { host: VentureDeps['host'] }).host = 'hosted-web';
  await assert.rejects(poster(env, { orderId: order.id }), code('TIER_UNAVAILABLE'));
  (env.deps as { host: VentureDeps['host'] }).host = 'test';
  rmSync(cut);
  await assert.rejects(poster(env, { orderId: order.id }), code('INVALID_VENTURE_REQUEST'));
  const bare = await setup();
  (bare.deps as VentureDeps).ffmpeg = new StubFfmpeg();
  const { order: noCut } = await seedYoutube(bare);
  await assert.rejects(poster(bare, { orderId: noCut.id }), (error: any) => {
    assert.equal(error.code, 'INVALID_VENTURE_REQUEST');
    assert.match(error.message, /names no finished cut/);
    return true;
  });
});
