// Media intake hygiene (Ink v2 wave 5, package 5A4; catalogue P9): every client photo is stored with its location and
// camera data removed. A JPEG keeps only a minimal EXIF block code writes, holding the Orientation tag alone, so it
// still shows upright; PNG eXIf, tEXt, iTXt and zTXt chunks and WebP EXIF and XMP chunks are dropped; the stored file
// is the cleaned one. A clip on the desktop is rewritten by ffmpeg with -map_metadata -1; with no ffmpeg it is held,
// and Today shows "This clip still has its location data, so it cannot go out. Add ffmpeg to this computer, then run the order again to clean it." Nothing is faked: what
// was removed is said, and a file Chausar cannot read is refused rather than kept as it came.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listRecords } from '../runtime/venture/records.ts';
import { cleanClip, cleanImage, cleanJpeg, cleanPng, cleanWebp, exifOrientation, mediaNoticeRows } from '../runtime/venture/playbooks/kit/media-intake.ts';
import { KIT_TOOLS } from '../runtime/venture/delivery/harness/tools-kit.ts';
import type { FfmpegPort } from '../runtime/venture/playbooks/youtube/finishing.ts';
import { business, code, owner, PLAIN_IDEA } from './venture-judge-helpers.ts';

// ---------------------------------------------------------------------------
// Fixtures built here, byte by byte
// ---------------------------------------------------------------------------

const u16 = (value: number) => [(value >> 8) & 0xff, value & 0xff];
const u32 = (value: number) => [(value >>> 24) & 0xff, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
const le32 = (value: number) => [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >>> 24) & 0xff];
const ascii = (text: string) => [...Buffer.from(text, 'latin1')];
const segment = (marker: number, body: number[]) => [0xff, marker, ...u16(body.length + 2), ...body];

/** A big-endian EXIF block: IFD0 with Orientation, Make and a GPS pointer, and a GPS IFD with a latitude reference. */
function exifBlock(orientation: number): number[] {
  // TIFF header (8) + IFD0 at 8: count(2) + 3 entries(36) + next(4) = 42 -> GPS IFD at 50; Make text after it.
  const gpsAt = 50;
  const gps = [...u16(1), ...u16(0x0001), ...u16(2), ...u32(2), ...ascii('N'), 0, 0, 0, ...u32(0)]; // GPSLatitudeRef 'N'
  const makeAt = gpsAt + gps.length;
  const make = [...ascii('PhoneMaker'), 0];
  const ifd0 = [
    ...u16(3),
    ...u16(0x010f), ...u16(2), ...u32(make.length), ...u32(makeAt), // Make
    ...u16(0x0112), ...u16(3), ...u32(1), ...u16(orientation), 0, 0, // Orientation
    ...u16(0x8825), ...u16(4), ...u32(1), ...u32(gpsAt), // GPSInfo
    ...u32(0),
  ];
  return [...ascii('Exif'), 0, 0, ...ascii('MM'), 0, 42, ...u32(8), ...ifd0, ...gps, ...make];
}

/** A small JPEG: JFIF, EXIF with GPS, XMP, a comment, an ICC profile, then the image data, which is kept as it is. */
function jpegWithGps(orientation = 6): Buffer {
  return Buffer.from([
    0xff, 0xd8,
    ...segment(0xe0, [...ascii('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]),
    ...segment(0xe1, exifBlock(orientation)),
    ...segment(0xe1, [...ascii('http://ns.adobe.com/xap/1.0/'), 0, ...ascii('<x:xmpmeta>Lat 18.52 Lon 73.85</x:xmpmeta>')]),
    ...segment(0xfe, ascii('Shot at home')),
    ...segment(0xe2, [...ascii('ICC_PROFILE'), 0, 1, 1, 9, 9, 9]),
    ...segment(0xdb, [0, ...Array.from({ length: 64 }, () => 1)]),
    ...segment(0xda, [1, 1, 0, 0, 63, 0]),
    0x12, 0x34, 0xff, 0x00, 0x56, // entropy-coded data, with a stuffed byte
    0xff, 0xd9,
  ]);
}

function crc32(bytes: number[]): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
const pngChunk = (type: string, data: number[]) => [...u32(data.length), ...ascii(type), ...data, ...u32(crc32([...ascii(type), ...data]))];
function pngWithText(): Buffer {
  return Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...pngChunk('IHDR', [...u32(1), ...u32(1), 8, 2, 0, 0, 0]),
    ...pngChunk('eXIf', exifBlock(1).slice(6)),
    ...pngChunk('tEXt', [...ascii('Comment'), 0, ...ascii('Pune')]),
    ...pngChunk('iTXt', [...ascii('XML:com.adobe.xmp'), 0, 0, 0, 0, 0, ...ascii('<x/>')]),
    ...pngChunk('zTXt', [...ascii('Author'), 0, 0, 120, 156, 3, 0, 0, 0, 0, 1]),
    ...pngChunk('IDAT', [120, 156, 99, 0, 1, 0, 0, 5, 0, 1]),
    ...pngChunk('IEND', []),
  ]);
}

const riffChunk = (fourcc: string, data: number[]) => [...ascii(fourcc), ...le32(data.length), ...data, ...(data.length % 2 ? [0] : [])];
function webpWithExif(): Buffer {
  const body = [
    ...ascii('WEBP'),
    ...riffChunk('VP8X', [0x0c, 0, 0, 0, 0, 0, 0, 0, 0, 0]), // EXIF (0x08) and XMP (0x04) flags set
    ...riffChunk('VP8 ', [1, 2, 3, 4, 5]),
    ...riffChunk('EXIF', exifBlock(1).slice(6)),
    ...riffChunk('XMP ', ascii('<x:xmpmeta/>')),
  ];
  return Buffer.from([...ascii('RIFF'), ...le32(body.length), ...body]);
}

const has = (bytes: Uint8Array, text: string) => Buffer.from(bytes).includes(Buffer.from(text, 'latin1'));

// ---------------------------------------------------------------------------
// Photos
// ---------------------------------------------------------------------------

test('media intake: a JPEG with a GPS block keeps only a minimal EXIF code wrote, with Orientation alone, so it still shows upright', () => {
  const dirty = jpegWithGps(6);
  assert.equal(exifOrientation(dirty), 6);
  const clean = cleanJpeg(dirty);
  for (const gone of ['N\u0000', 'PhoneMaker', 'xmpmeta', 'Shot at home', 'ns.adobe.com']) assert.ok(!has(clean.bytes, gone), `${gone} is gone`);
  assert.equal(exifOrientation(clean.bytes), 6, 'the photo still shows upright');
  assert.ok(has(clean.bytes, 'ICC_PROFILE'), 'the colour profile is kept');
  assert.ok(has(clean.bytes, 'JFIF'));
  assert.deepEqual([...clean.bytes.subarray(-7)], [0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd9], 'the image data is kept byte for byte');
  assert.equal(clean.hadLocation, true);
  assert.deepEqual(clean.removed, ['camera and location data (EXIF)', 'XMP data', 'a comment']);
  // The minimal block: one IFD entry, Orientation, nothing else.
  const exifAt = Buffer.from(clean.bytes).indexOf(Buffer.from('Exif\0\0', 'latin1'));
  const ifdCount = (clean.bytes[exifAt + 6 + 8] << 8) | clean.bytes[exifAt + 6 + 9];
  assert.equal(ifdCount, 1);
  // Upright already: no EXIF at all.
  const upright = cleanJpeg(jpegWithGps(1));
  assert.ok(!has(upright.bytes, 'Exif'));
  assert.equal(exifOrientation(upright.bytes), null);
  // Cleaning twice changes nothing more.
  assert.deepEqual(Buffer.from(cleanJpeg(clean.bytes).bytes), Buffer.from(clean.bytes));
  assert.deepEqual(cleanJpeg(clean.bytes).removed, []);
});

test('media intake: PNG eXIf, tEXt, iTXt and zTXt chunks and WebP EXIF and XMP chunks are dropped, the rest kept', () => {
  const png = cleanPng(pngWithText());
  for (const gone of ['eXIf', 'tEXt', 'iTXt', 'zTXt', 'Pune']) assert.ok(!has(png.bytes, gone), gone);
  for (const kept of ['IHDR', 'IDAT', 'IEND']) assert.ok(has(png.bytes, kept), kept);
  assert.equal(png.hadLocation, true);
  const webp = cleanWebp(webpWithExif());
  assert.ok(!has(webp.bytes, 'EXIF') && !has(webp.bytes, 'XMP '));
  assert.ok(has(webp.bytes, 'VP8 '));
  const riffSize = Buffer.from(webp.bytes).readUInt32LE(4);
  assert.equal(riffSize, webp.bytes.length - 8, 'the RIFF size is written again');
  const vp8x = Buffer.from(webp.bytes).indexOf(Buffer.from('VP8X', 'latin1'));
  assert.equal(webp.bytes[vp8x + 8] & 0x0c, 0, 'the EXIF and XMP flags are cleared');
  // A file that is not what its name says is refused, never stored as it came.
  assert.throws(() => cleanImage('photo.jpg', Buffer.from('not a photo')), code('UNSUPPORTED_UPLOAD'));
  assert.throws(() => cleanJpeg(Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x00])), code('UNSUPPORTED_UPLOAD'));
});

test('media intake: a photo added to an order is stored cleaned, kept apart from the files agents read, and audio is kept as it came', async () => {
  const env = await business(PLAIN_IDEA);
  const order = await env.call('venture.order.create', { clientId: env.client.id, offerId: env.offers[0].id, request: 'Shoot the new menu card.' });
  const dirty = jpegWithGps(6);
  const added = await env.call('venture.files.add', { orderId: order.id, name: 'menu.jpg', contentBase64: dirty.toString('base64') });
  assert.equal(added.format, 'image');
  assert.deepEqual(added.scope, { kind: 'media', orderId: order.id });
  const stored = listRecords(env.store.read(), 'venture-upload').find(upload => upload.id === added.id)!;
  const bytes = Buffer.from(stored.contentBase64, 'base64');
  assert.ok(!has(bytes, 'PhoneMaker') && !has(bytes, 'xmpmeta'), 'the stored file is the cleaned one');
  assert.equal(exifOrientation(bytes), 6);
  assert.equal(added.bytes, bytes.length);
  // A consent recording is audio: kept as it came, also apart from the agents' files.
  const wav = Buffer.from([...ascii('RIFF'), ...le32(36), ...ascii('WAVEfmt '), ...le32(16), 1, 0, 1, 0, ...le32(8000), ...le32(8000), 1, 0, 8, 0, ...ascii('data'), ...le32(0)]);
  const voice = await env.call('venture.files.add', { orderId: order.id, name: 'consent.wav', contentBase64: wav.toString('base64') });
  assert.equal(voice.format, 'audio');
  assert.deepEqual(Buffer.from(listRecords(env.store.read(), 'venture-upload').find(upload => upload.id === voice.id)!.contentBase64, 'base64'), wav);
  const listed = await env.call('venture.files.list', { orderId: order.id });
  assert.deepEqual(listed.map((file: any) => file.id).sort(), [added.id, voice.id].sort(), 'the order lists its photos and recordings');
  await assert.rejects(env.call('venture.files.add', { orderId: order.id, name: 'menu.png', contentBase64: dirty.toString('base64') }), code('UNSUPPORTED_UPLOAD'));
});

test('media intake: data after the photo (a second image, a motion clip) is cut off, and its location counted, never kept', () => {
  const main = jpegWithGps(1);
  const trailer = jpegWithGps(6); // a second JPEG, with its own EXIF and GPS block
  const mpf = segment(0xe2, [...ascii('MPF'), 0, ...ascii('MM'), 0, 42, 0, 0, 0, 8]);
  const withMpf = Buffer.from([...main.subarray(0, 2), ...mpf, ...main.subarray(2)]);
  const clean = cleanJpeg(Buffer.concat([withMpf, trailer, Buffer.from('motion-photo-trailer')]));
  assert.ok(!has(clean.bytes, 'PhoneMaker') && !has(clean.bytes, 'Exif') && !has(clean.bytes, 'MPF') && !has(clean.bytes, 'motion'), 'nothing after the photo is kept');
  assert.deepEqual([...clean.bytes.subarray(-2)], [0xff, 0xd9], 'it ends at the photo\'s own end');
  assert.equal(clean.hadLocation, true);
  assert.ok(clean.removed.includes('a second image or clip after the photo'), clean.removed.join());
  // A photo cut short, with no end, is refused rather than kept as it came.
  assert.throws(() => cleanJpeg(main.subarray(0, main.length - 2)), code('UNSUPPORTED_UPLOAD'));
});

// ---------------------------------------------------------------------------
// Clips
// ---------------------------------------------------------------------------

/** A stand-in ffmpeg that records each run's arguments and writes the output it names. */
function stubFfmpeg(found = true): FfmpegPort & { runs: string[][] } {
  const runs: string[][] = [];
  return {
    runs,
    locate: () => (found ? 'ffmpeg' : null),
    async run(_binary, args) {
      runs.push([...args]);
      writeFileSync(args.at(-1)!, 'cleaned');
      return { code: 0, stderr: '', timedOut: false, startError: null };
    },
  };
}

test('media intake: a clip on the desktop is rewritten with -map_metadata -1 beside the original, never over it; no ffmpeg holds it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'chausar-clip-'));
  try {
    const input = join(dir, 'reel.mp4');
    writeFileSync(input, 'raw clip');
    const port = stubFfmpeg();
    const done = await cleanClip(port, input);
    assert.equal(done.status, 'cleaned');
    assert.equal(done.output, join(dir, 'reel.clean.mp4'));
    const args = port.runs[0];
    assert.equal(args[args.indexOf('-map_metadata') + 1], '-1');
    // Only the picture and the sound: data streams (a GoPro's GPS track, timed metadata) are left out.
    assert.deepEqual(args.filter((arg, index) => args[index - 1] === '-map'), ['0:v', '0:a?']);
    assert.ok(args.includes('-dn') && !args.includes('0'), args.join(' '));
    assert.ok(args.includes('-protocol_whitelist'), 'ffmpeg may open plain files only');
    assert.ok(args.includes('-n'), 'ffmpeg never overwrites');
    assert.equal(args.at(-1), done.output);
    const again = await cleanClip(port, input);
    assert.equal(again.status, 'failed', 'a cleaned copy already there is not written over');
    const held = await cleanClip(stubFfmpeg(false), input);
    assert.equal(held.status, 'held');
    assert.equal(held.line, 'This clip still has its location data, so it cannot go out. Add ffmpeg to this computer, then run the order again to clean it.');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('media intake: media.clean cleans the order\'s clip as an approved write; with no ffmpeg the clip is held and Today says so', async () => {
  const env = await business(PLAIN_IDEA);
  const order = await env.call('venture.order.create', { clientId: env.client.id, offerId: env.offers[0].id, request: 'Clean my reel.' });
  const dir = mkdtempSync(join(tmpdir(), 'chausar-clip-'));
  try {
    const cutFile = join(dir, 'reel.mov');
    writeFileSync(cutFile, 'raw clip');
    const tool = KIT_TOOLS['media.clean'];
    assert.equal(tool.effect, 'compute', 'its real effect, a new file on this computer, is declared in policy/effects.ts');
    const toolEnv = (deps: typeof env.deps) => ({ deps, runRef: { kind: 'delivery', runId: 'delivery_1' }, intake: { cutFile }, files: [], tables: [], receipts: [] }) as any;
    const cleaned = await tool.run(toolEnv({ ...env.deps, ffmpeg: stubFfmpeg() }), {});
    assert.equal((cleaned.result as any).cleaned, true);
    assert.equal((cleaned.result as any).asset.hygiene.state, 'clean');
    const held = await tool.run(toolEnv({ ...env.deps, ffmpeg: stubFfmpeg(false) }), {});
    assert.equal((held.result as any).cleaned, false);
    assert.equal((held.result as any).asset.hygiene.state, 'held');
    await assert.rejects(tool.run(toolEnv({ ...env.deps, host: 'hosted-web', ffmpeg: stubFfmpeg() }), {}), code('TOOL_FAILED'));
    // The held clip, once stored as the order's asset, is a Today notice until it is cleaned.
    const { storeRunAssets } = await import('../runtime/venture/playbooks/kit/assets.ts');
    const { ventureAction, currentVenture } = await import('../runtime/venture/records.ts');
    await ventureAction(env.deps, owner, 'prepare', 'test.assets', tx => storeRunAssets(tx, [
      { id: 'call_1', tool: 'media.clean', outcome: 'succeeded', envelope: { ok: true, result: held.result } } as any,
    ], { runId: 'delivery_1', orderId: order.id, clientId: env.client.id }));
    const state = env.store.read();
    const rows = mediaNoticeRows(env.deps, owner, state, currentVenture(state)!);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].line, 'This clip still has its location data, so it cannot go out. Add ffmpeg to this computer, then run the order again to clean it.');
    assert.deepEqual(rows[0].actions.map(action => action.id), ['later', 'open']);
    // Cleaned on a later run, the clean copy supersedes the held clip: the notice and the Accept block go.
    await ventureAction(env.deps, owner, 'prepare', 'test.assets', tx => storeRunAssets(tx, [
      { id: 'call_2', tool: 'media.clean', outcome: 'succeeded', envelope: { ok: true, result: cleaned.result } } as any,
    ], { runId: 'delivery_2', orderId: order.id, clientId: env.client.id }));
    const after = env.store.read();
    assert.deepEqual(mediaNoticeRows(env.deps, owner, after, currentVenture(after)!), []);
    const assets = listRecords(after, 'venture-asset');
    const heldAsset = assets.find(asset => asset.hygiene.state === 'held')!;
    const cleanAsset = assets.find(asset => asset.hygiene.state === 'clean')!;
    assert.equal(heldAsset.supersededBy, cleanAsset.id);
    assert.equal(cleanAsset.supersedes, heldAsset.id);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('media intake: metadata between JPEG scans is removed while scan bytes stay intact', () => {
  const firstScan = [...segment(0xda, [1, 1, 0, 0, 63, 0]), 1, 2, 0xff, 0x00, 3];
  const secondScan = [...segment(0xda, [1, 1, 0, 0, 63, 0]), 4, 5, 0xff, 0xd0, 6];
  const dirty = Buffer.from([0xff, 0xd8, ...firstScan,
    ...segment(0xe1, exifBlock(6)),
    ...segment(0xe1, ascii('<xmp>GPSLatitude secret</xmp>')),
    ...segment(0xfe, ascii('private camera note')),
    ...secondScan, 0xff, 0xd9]);
  const clean = cleanJpeg(dirty);
  for (const gone of ['PhoneMaker', 'GPSLatitude', 'private camera note']) assert.ok(!has(clean.bytes, gone), gone);
  assert.ok(Buffer.from(clean.bytes).includes(Buffer.from(firstScan)));
  assert.ok(Buffer.from(clean.bytes).includes(Buffer.from(secondScan)));
  assert.equal(clean.hadLocation, true);
  assert.equal(exifOrientation(clean.bytes), 6);
  assert.deepEqual(clean.removed, ['camera and location data (EXIF)', 'XMP data', 'a comment']);
  assert.deepEqual(Buffer.from(cleanJpeg(clean.bytes).bytes), Buffer.from(clean.bytes));
});