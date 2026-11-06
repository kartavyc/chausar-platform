// Chausar delivery (Ink v2 wave 4, package 4J3): the poster of a YouTube order, one still from the finished cut named at
// intake, for the video card on Today (views/previews.ts). The ffmpeg already on this computer reads how long the cut
// runs and takes one frame at a tenth of it, scaled down, as a JPEG in a temporary folder removed afterwards. The still
// is kept only when its bytes are a JPEG and it is small (POSTER_MAX_BYTES), so a poster never carries anything that
// runs and never a made-up image. It is client data (a frame of the client's footage) in a scope of its own, so no agent
// tool, run file list or order file count reads it as a file the client sent. One poster per order: a new still
// replaces the old one. Nothing is installed; without ffmpeg there is no still, and the hosted server never reads a cut.
// A playlist or a concat list named as the cut is refused before ffmpeg starts, and ffmpeg opens plain files only.
import { mkdtemp, open, readFile, rm, stat, type FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { check, type Context, type State } from '../../contracts.ts';
import { localPathProblem, STOPPED_WORKSPACE_CLOSED } from '../../speech.ts';
import { digest, exactPayload, findRecord, identifier, listRecords, requireAppChannel, ventureAction } from '../records.ts';
import type { DeliveryRunRecord, UploadRecord, UploadView, VentureDeps, VentureRecord } from '../contracts.ts';
import { YOUTUBE_ID } from '../playbooks/youtube/registration.ts';
import { FILE_ONLY_INPUT, parseFfmpegLog, systemFfmpeg, type FfmpegPort, type FfmpegRun } from '../playbooks/youtube/finishing.ts';
import { uploadView } from './harness/files.ts';
import { readAs } from './shared.ts';

/** The largest still kept, in bytes: a small frame for a card, never the footage. */
export const POSTER_MAX_BYTES = 64 * 1024;
export const POSTER_NO_FFMPEG = "ffmpeg isn't on this computer, so there is no still. Chausar never installs it.";
export const HOSTED_NO_POSTER = "The shared hosted server can't take a still: it never reads a file on your computer. Use the desktop app.";
const STILL_FAILED = 'ffmpeg could not take a still from the cut. Nothing was kept.';
const NO_LENGTH = 'ffmpeg could not read how long the cut runs, so there is no still. Nothing was kept.';
const TOO_LARGE = `The still came out larger than ${POSTER_MAX_BYTES / 1024} KB, so it was not kept.`;
const NOT_A_STILL = 'What ffmpeg made is not a JPEG still, so it was not kept.';
const PROBE_TIMEOUT_MS = 30000;
const STILL_TIMEOUT_MS = 60000;
/** The still's width in pixels; ffmpeg keeps the frame's shape and an even height. */
const STILL_WIDTH = 480;

/** Whole milliseconds as ffmpeg's seconds, "70.200", from integers only. */
const seconds = (ms: number) => `${Math.floor(ms / 1000)}.${String(ms % 1000).padStart(3, '0')}`;

/** A JPEG starts with the start-of-image marker and ends with the end-of-image marker. */
export function isJpeg(bytes: Uint8Array): boolean {
  const n = bytes.length;
  return n >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff && bytes[n - 2] === 0xff && bytes[n - 1] === 0xd9;
}

/** The still's file name: the cut's name with " still.jpg", so the owner knows which footage it came from. */
function stillName(cutFile: string): string {
  const name = basename(cutFile.replace(/\\/g, '/'), extname(cutFile)).replace(/[\u0000-\u001F\u007F]+/g, ' ').trim().slice(0, 100);
  return `${name || 'cut'} still.jpg`;
}

async function isFile(path: string): Promise<boolean> {
  try { return (await stat(path)).isFile(); } catch { return false; }
}

async function runFfmpeg(port: FfmpegPort, binary: string, args: string[], timeoutMs: number, signal?: AbortSignal): Promise<FfmpegRun | null> {
  try { return await port.run(binary, args, timeoutMs, signal); } catch { return null; }
}

/** The order's poster, newest first if older records hold more than one, or null. */
export function posterOf(state: State, ventureId: string, orderId: string): UploadRecord | null {
  const found = listRecords(state, 'venture-upload', ventureId).filter(upload => upload.scope.kind === 'poster' && upload.scope.orderId === orderId);
  return found.at(-1) ?? null;
}

/**
 * The poster as an image address a card can show: a JPEG data address, only when the kept bytes are still a small JPEG.
 * The address is made from the checked bytes, never from the stored text, so nothing but those bytes can reach a
 * screen. Anything else gives null, so a card shows no image rather than a broken or foreign one.
 */
export function posterSrc(record: UploadRecord): string | null {
  if (record.format !== 'image' || record.origin !== 'poster' || record.bytes > POSTER_MAX_BYTES) return null;
  const bytes = Buffer.from(record.contentBase64, 'base64');
  return bytes.length <= POSTER_MAX_BYTES && isJpeg(bytes) ? `data:image/jpeg;base64,${bytes.toString('base64')}` : null;
}

/** Whether a run worked on the YouTube channel playbook, by the playbook it names: only those runs have a cut. */
export function youtubeRun(state: State, venture: VentureRecord, run: DeliveryRunRecord): boolean {
  const playbook = findRecord(state, 'venture-playbook', run.playbookId);
  return !!playbook && playbook.ventureId === venture.id && playbook.flagship === YOUTUBE_ID;
}

/** The order's poster as a card or a run tile shows it, or null when none is kept or it is not a small JPEG any more. */
export function posterView(state: State, ventureId: string, orderId: string): { uploadId: string; src: string } | null {
  const still = posterOf(state, ventureId, orderId);
  const src = still ? posterSrc(still) : null;
  return still && src ? { uploadId: still.id, src } : null;
}

const LIST_REFUSED = 'The cut is a playlist or a list of files, not a video. Name the finished video file itself.';
/** File names that are lists of other files or addresses, never a cut. */
const LIST_NAMES = /\.(m3u8?|pls|xspf|asx|wpl|smil|sdp|mpd|ffconcat|concat|txt|cue)$/i;
/** How such a list starts: an M3U or HLS playlist, a concat list, an SDP session, a PLS playlist, an XML manifest. */
const LIST_STARTS: readonly RegExp[] = [/^#EXTM3U/, /^ffconcat\b/i, /^\s*file\s+\S/i, /^v=0\b/, /^\[playlist\]/i, /^<\?xml/i, /^<(mpd|smil|playlist|asx)\b/i];

/** Why the cut is a list of other files or addresses rather than a video, by its name or its first bytes, or null. */
async function listProblem(cutFile: string): Promise<string | null> {
  if (LIST_NAMES.test(cutFile)) return LIST_REFUSED;
  let head = '';
  let handle: FileHandle | null = null;
  try {
    handle = await open(cutFile, 'r');
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(256), 0, 256, 0);
    head = buffer.subarray(0, bytesRead).toString('latin1').replace(/^ï»¿/, '');
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => undefined);
  }
  return LIST_STARTS.some(pattern => pattern.test(head)) ? LIST_REFUSED : null;
}

/** One still at a tenth of the cut, as JPEG bytes. Refuses plainly; the temporary folder is removed whatever happens. */
async function takeStill(deps: VentureDeps, cutFile: string): Promise<Buffer> {
  const port = deps.ffmpeg ?? systemFfmpeg;
  const binary = port.locate();
  check(binary, 'POSTER_NOT_AVAILABLE', POSTER_NO_FFMPEG);
  check(await isFile(cutFile), 'INVALID_VENTURE_REQUEST', "There is no file at the cut's path on this computer. Put the cut back, or make a new order that names where it is now.");
  // A playlist or a concat list would have ffmpeg read other files or addresses: it is refused before ffmpeg starts, and
  // every run below opens plain files only (FILE_ONLY_INPUT).
  const listed = await listProblem(cutFile);
  check(!listed, 'INVALID_VENTURE_REQUEST', listed ?? LIST_REFUSED);
  // The workspace closing stops this: the engine holds off and waits for it instead of closing under it.
  const signal = deps.closing?.signal;
  check(!signal?.aborted, 'POSTER_NOT_AVAILABLE', STOPPED_WORKSPACE_CLOSED);
  const release = deps.closing?.hold();
  let folder: string | null = null;
  try {
    // Made inside the try, so the hold is released even when the folder cannot be made.
    folder = await mkdtemp(join(tmpdir(), 'chausar-poster-'));
    // The cut's path is a full local path, so it can never be read as an ffmpeg option. With no output named, ffmpeg
    // only prints what the file holds, its length among it, and exits.
    const probe = await runFfmpeg(port, binary, ['-hide_banner', '-nostdin', ...FILE_ONLY_INPUT, '-i', cutFile], PROBE_TIMEOUT_MS, signal);
    check(!probe?.aborted && !signal?.aborted, 'POSTER_NOT_AVAILABLE', STOPPED_WORKSPACE_CLOSED);
    check(probe && !probe.timedOut && !probe.startError, 'POSTER_NOT_AVAILABLE', STILL_FAILED);
    const durationMs = parseFfmpegLog(probe.stderr, null).durationMs;
    check(durationMs !== null && durationMs >= 1000, 'POSTER_NOT_AVAILABLE', NO_LENGTH);
    const out = join(folder, 'still.jpg');
    const args = ['-hide_banner', '-nostats', '-nostdin', '-ss', seconds(Math.floor(durationMs / 10)), ...FILE_ONLY_INPUT, '-i', cutFile, '-frames:v', '1', '-an', '-vf', `scale=${STILL_WIDTH}:-2`, '-q:v', '5', '-y', out];
    const run = await runFfmpeg(port, binary, args, STILL_TIMEOUT_MS, signal);
    check(!run?.aborted && !signal?.aborted, 'POSTER_NOT_AVAILABLE', STOPPED_WORKSPACE_CLOSED);
    check(run && run.code === 0 && !run.timedOut && !run.startError && await isFile(out), 'POSTER_NOT_AVAILABLE', STILL_FAILED);
    check((await stat(out)).size <= POSTER_MAX_BYTES, 'POSTER_NOT_AVAILABLE', TOO_LARGE);
    const bytes = await readFile(out);
    check(bytes.length <= POSTER_MAX_BYTES, 'POSTER_NOT_AVAILABLE', TOO_LARGE);
    check(isJpeg(bytes), 'POSTER_NOT_AVAILABLE', NOT_A_STILL);
    return bytes;
  } finally {
    if (folder) await rm(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => undefined);
    release?.();
  }
}

/**
 * venture.files.poster { orderId } (prepare, app only, desktop): one still at a tenth of the order's cut, kept as the
 * order's poster. POSTER_NOT_AVAILABLE without ffmpeg ("Chausar never installs it") or when no small JPEG came out;
 * TIER_UNAVAILABLE on the hosted server. A new still replaces the order's old one.
 */
export async function filesPosterHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<UploadView> {
  requireAppChannel(ctx, 'venture.files.poster');
  const body = exactPayload(payload, ['orderId'], ['orderId']);
  const orderId = identifier(body.orderId, 'Order');
  check(deps.host !== 'hosted-web', 'TIER_UNAVAILABLE', HOSTED_NO_POSTER);
  const { state, venture } = readAs(deps, ctx, 'prepare');
  const order = findRecord(state, 'venture-order', orderId);
  check(order && order.ventureId === venture.id, 'ORDER_NOT_FOUND', 'That order was not found.');
  const cutFile = order.intake?.cutFile ?? null;
  check(cutFile, 'INVALID_VENTURE_REQUEST', 'This order names no finished cut on this computer, so there is no still to take.');
  const problem = localPathProblem(cutFile);
  check(!problem, 'INVALID_VENTURE_REQUEST', `The cut: ${problem}`);
  const bytes = await takeStill(deps, cutFile);
  const encoded = bytes.toString('base64');
  return ventureAction(deps, ctx, 'prepare', 'files.poster', tx => {
    check(tx.find('venture-order', orderId), 'ORDER_NOT_FOUND', 'That order was not found.');
    const fields = { name: stillName(cutFile), format: 'image' as const, bytes: bytes.length, digest: digest(encoded), contentBase64: encoded, clientData: true, origin: 'poster' as const };
    const existing = tx.list('venture-upload').find(upload => upload.scope.kind === 'poster' && upload.scope.orderId === orderId);
    const record: UploadRecord = existing
      ? tx.replace<UploadRecord>({ ...existing, ...fields, at: tx.now, memberId: ctx.memberId })
      : tx.put<UploadRecord>({ ...tx.base('venture-upload'), ...fields, scope: { kind: 'poster', orderId } });
    // The event never carries the file name: it can hold a client's name.
    tx.emit('upload-added', { uploadId: record.id, orderId, format: 'image' });
    tx.emit('queue.changed', {});
    return uploadView(record);
  });
}
