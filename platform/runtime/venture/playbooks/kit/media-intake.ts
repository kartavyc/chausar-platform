// Chausar playbook kit: media intake hygiene (Ink v2 wave 5, package 5A4; catalogue P9). Every client photo is stored
// with its location and camera data removed, by code, before it is kept: a JPEG loses every EXIF, XMP, IPTC and comment
// segment and keeps only a minimal EXIF block code writes holding the Orientation tag, so it still shows upright (none
// at all when it is upright already), and ends at its own EOI, so a second image or motion clip after it goes too; a PNG loses its eXIf, tEXt, iTXt and zTXt chunks; a WebP its EXIF and XMP chunks,
// with the flags that named them cleared. The image data is never touched. A consent recording (audio) is kept as it
// came: it is evidence. Photos and recordings sit on the order in their own scope ('media'), so no agent tool that reads
// tables, pages or transcripts ever reads them. A clip on the desktop is rewritten by the ffmpeg already there with
// -map_metadata -1 into a new file beside it, never over it, with only its picture and sound (no data streams); with
// no ffmpeg it is held, and Today says so until a later run cleans it.
//
// Learned from marketing-skill scripts/video/montage.js (idea only: strip metadata, turn upright); the JPEG, PNG and
// WebP layouts are their published formats. Written for Chausar.
import { existsSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { ChausarError, check, type Context, type State } from '../../../contracts.ts';
import { digest, listRecords, ventureAction } from '../../records.ts';
import type { UploadRecord, UploadView, VentureDeps, VentureRecord } from '../../contracts.ts';
import { FILE_ONLY_INPUT, systemFfmpeg, type FfmpegPort } from '../youtube/finishing.ts';
import type { W4RowItem } from '../../views/queue-w4.ts';
import type { AssetHygiene } from './records-media.ts';

/** What a cleaned photo is: its bytes, what was removed (plain words), whether it held a location, and its orientation. */
export type CleanedImage = { bytes: Uint8Array; format: 'jpeg' | 'png' | 'webp'; removed: string[]; hadLocation: boolean; orientation: number | null };

const NOT_IMAGE = (name: string) => `${name} is not a photo Chausar can read. Export it again as JPEG, PNG or WebP.`;
const refuse = (line: string): never => { throw new ChausarError('UNSUPPORTED_UPLOAD', line); };

// ---------------------------------------------------------------------------
// EXIF: reading the Orientation tag, writing the minimal block
// ---------------------------------------------------------------------------

type Tiff = { view: DataView; little: boolean; start: number };
const EXIF_HEAD = [0x45, 0x78, 0x69, 0x66, 0, 0]; // "Exif\0\0"

function tiffOf(bytes: Uint8Array, start: number, end: number): Tiff | null {
  if (end - start < 8) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const order = view.getUint16(start);
  if (order !== 0x4949 && order !== 0x4d4d) return null;
  const little = order === 0x4949;
  return view.getUint16(start + 2, little) === 42 ? { view, little, start } : null;
}

/** The IFD0 tags of a TIFF block: Orientation's value and whether a GPS pointer is there. */
function ifd0Facts(tiff: Tiff, end: number): { orientation: number | null; gps: boolean } {
  const { view, little, start } = tiff;
  const at = start + view.getUint32(start + 4, little);
  if (at + 2 > end) return { orientation: null, gps: false };
  const count = view.getUint16(at, little);
  let orientation: number | null = null, gps = false;
  for (let index = 0; index < count; index += 1) {
    const entry = at + 2 + index * 12;
    if (entry + 12 > end) break;
    const tag = view.getUint16(entry, little);
    if (tag === 0x0112) {
      const value = view.getUint16(entry + 8, little);
      orientation = value >= 1 && value <= 8 ? value : null;
    }
    if (tag === 0x8825) gps = true;
  }
  return { orientation, gps };
}

/** "Exif\0\0" + a big-endian TIFF block with one IFD0 entry, Orientation, and nothing else. */
function minimalExif(orientation: number): number[] {
  return [...EXIF_HEAD, 0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, orientation, 0, 0, 0, 0, 0, 0];
}

const startsWith = (bytes: Uint8Array, at: number, prefix: readonly number[]) => prefix.every((byte, index) => bytes[at + index] === byte);
const latin = (bytes: Uint8Array, at: number, length: number) => Buffer.from(bytes.subarray(at, at + length)).toString('latin1');

// ---------------------------------------------------------------------------
// JPEG
// ---------------------------------------------------------------------------

type Segment = { marker: number; start: number; end: number }; // start: the 0xFF; end: after its data
/** All segments, including complete scans; metadata between scans is checked like metadata before them. */
function jpegSegments(bytes: Uint8Array): { segments: Segment[]; dataAt: number } {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) refuse(NOT_IMAGE('This file'));
  const segments: Segment[] = [];
  let at = 2;
  while (at < bytes.length) {
    if (bytes[at] !== 0xff) refuse(NOT_IMAGE('This file'));
    const marker = bytes[at + 1];
    if (marker === 0xff) { at += 1; continue; } // fill bytes
    if (marker === 0xd9) return { segments, dataAt: at }; // an image with no scan
    if (at + 4 > bytes.length) refuse(NOT_IMAGE('This file'));
    const length = (bytes[at + 2] << 8) | bytes[at + 3];
    const end = at + 2 + length;
    if (length < 2 || end > bytes.length) refuse(NOT_IMAGE('This file'));
    let segmentEnd = end;
    if (marker === 0xda) {
      // Preserve this scan byte for byte, stopping at the next real marker. Metadata may appear between scans.
      while (segmentEnd < bytes.length) {
        if (bytes[segmentEnd] !== 0xff) { segmentEnd += 1; continue; }
        const next = bytes[segmentEnd + 1];
        if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) { segmentEnd += 2; continue; }
        if (next === 0xff) { segmentEnd += 1; continue; }
        break;
      }
    }
    segments.push({ marker, start: at, end: segmentEnd });
    at = segmentEnd;
  }
  return refuse(NOT_IMAGE('This file'));
}

/**
 * Where the photo ends: just after its own EOI. From the first scan, code walks the image data (stuffed bytes and
 * restart markers stay inside it) and any segments between scans until EOI; a photo with no EOI is refused. Whatever
 * follows (a second image, a motion clip, a vendor trailer) is not part of the photo.
 */
function jpegEnd(bytes: Uint8Array, dataAt: number): number {
  let at = dataAt;
  while (at + 1 < bytes.length) {
    if (bytes[at] !== 0xff) refuse(NOT_IMAGE('This file'));
    const marker = bytes[at + 1];
    if (marker === 0xd9) return at + 2;
    if (marker === 0xff) { at += 1; continue; }
    if (at + 4 > bytes.length) break;
    const length = (bytes[at + 2] << 8) | bytes[at + 3];
    if (length < 2) refuse(NOT_IMAGE('This file'));
    at += 2 + length;
    if (marker !== 0xda) continue;
    // Image data: a 0xFF is followed by 0x00 (a stuffed byte), a restart marker or more fill, else a marker begins.
    while (at < bytes.length) {
      if (bytes[at] !== 0xff) { at += 1; continue; }
      const next = bytes[at + 1];
      if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) { at += 2; continue; }
      if (next === 0xff) { at += 1; continue; }
      break;
    }
  }
  return refuse(NOT_IMAGE('This file'));
}

/** Whether bytes after the photo hold an EXIF block with a GPS pointer (a second image's own camera data). */
function trailerHasLocation(bytes: Uint8Array, from: number): boolean {
  const all = Buffer.from(bytes);
  for (let at = all.indexOf(Buffer.from(EXIF_HEAD), from); at >= 0; at = all.indexOf(Buffer.from(EXIF_HEAD), at + 1)) {
    const tiff = tiffOf(bytes, at + 6, bytes.length);
    if (tiff && ifd0Facts(tiff, bytes.length).gps) return true;
  }
  return false;
}

/** The Orientation tag of a JPEG's EXIF block, or null when it has none. */
export function exifOrientation(bytes: Uint8Array): number | null {
  const { segments } = jpegSegments(bytes);
  for (const segment of segments) {
    if (segment.marker !== 0xe1 || !startsWith(bytes, segment.start + 4, EXIF_HEAD)) continue;
    const tiff = tiffOf(bytes, segment.start + 10, segment.end);
    if (tiff) return ifd0Facts(tiff, segment.end).orientation;
  }
  return null;
}

/** Which kind of metadata a JPEG segment is, in plain words, or null for a segment the image needs. */
function jpegMetadata(bytes: Uint8Array, segment: Segment): string | null {
  const { marker, start } = segment;
  if (marker === 0xfe) return 'a comment';
  if (marker === 0xe1) {
    if (startsWith(bytes, start + 4, EXIF_HEAD)) return 'camera and location data (EXIF)';
    return 'XMP data';
  }
  if (marker === 0xed) return 'IPTC data';
  // APP2 holds the colour profile, which is kept, or the index of a second image (MPF), which goes with that image.
  if (marker === 0xe2 && latin(bytes, start + 4, 4) === 'MPF\u0000') return 'the index of a second image';
  // APP0 (JFIF), APP2 (the colour profile) and APP14 (Adobe's colour transform) are needed to draw the image.
  if (marker >= 0xe3 && marker <= 0xef && marker !== 0xee) return 'other camera data';
  return null;
}

/** A JPEG with every metadata segment removed and, when the photo is turned, a minimal EXIF holding Orientation alone. */
export function cleanJpeg(input: Uint8Array): CleanedImage {
  const bytes = Uint8Array.from(input);
  const { segments, dataAt } = jpegSegments(bytes);
  let orientation: number | null = null, hadLocation = false;
  const removed: string[] = [];
  const kept: Segment[] = [];
  for (const segment of segments) {
    const what = jpegMetadata(bytes, segment);
    if (what === null) { kept.push(segment); continue; }
    if (what === 'camera and location data (EXIF)') {
      const tiff = tiffOf(bytes, segment.start + 10, segment.end);
      if (tiff) {
        const facts = ifd0Facts(tiff, segment.end);
        orientation = orientation ?? facts.orientation;
        hadLocation ||= facts.gps;
        // Chausar's own minimal block, met again: nothing is removed by keeping it.
        const own = Buffer.from(bytes.subarray(segment.start + 4, segment.end)).equals(Buffer.from(minimalExif(facts.orientation ?? 1)));
        if (own) continue;
      }
    }
    if (what === 'XMP data' && /exif:GPS|Lat|GPSLatitude/i.test(latin(bytes, segment.start + 4, segment.end - segment.start - 4))) hadLocation = true;
    if (!removed.includes(what)) removed.push(what);
  }
  const turned = orientation !== null && orientation !== 1;
  const exif = turned ? [0xff, 0xe1, 0, minimalExif(orientation!).length + 2, ...minimalExif(orientation!)] : [];
  // The minimal block goes right after JFIF (APP0), where readers look for it.
  const app0 = kept.findIndex(segment => segment.marker === 0xe0);
  const parts: Uint8Array[] = [bytes.subarray(0, 2)];
  kept.forEach((segment, index) => {
    if (index === 0 && app0 === -1 && exif.length) parts.push(Uint8Array.from(exif));
    parts.push(bytes.subarray(segment.start, segment.end));
    if (index === app0 && exif.length) parts.push(Uint8Array.from(exif));
  });
  if (!kept.length && exif.length) parts.push(Uint8Array.from(exif));
  // The photo ends at its own EOI; anything after it (a second image, a motion clip) is cut off, its location counted.
  const end = jpegEnd(bytes, dataAt);
  if (end < bytes.length) {
    removed.push('a second image or clip after the photo');
    hadLocation ||= trailerHasLocation(bytes, end);
  }
  parts.push(bytes.subarray(dataAt, end));
  return { bytes: Buffer.concat(parts), format: 'jpeg', removed, hadLocation, orientation: turned ? orientation : null };
}

// ---------------------------------------------------------------------------
// PNG and WebP
// ---------------------------------------------------------------------------

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_DROPPED: Readonly<Record<string, string>> = Object.freeze({ eXIf: 'camera and location data (EXIF)', tEXt: 'text notes', iTXt: 'text notes', zTXt: 'text notes' });

/** A PNG without its eXIf, tEXt, iTXt and zTXt chunks; every other chunk kept as it is, its checksum with it. */
export function cleanPng(input: Uint8Array): CleanedImage {
  const bytes = Uint8Array.from(input);
  if (!startsWith(bytes, 0, PNG_SIGNATURE)) refuse(NOT_IMAGE('This file'));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const parts: Uint8Array[] = [bytes.subarray(0, 8)];
  const removed: string[] = [];
  let hadLocation = false, at = 8, ended = false;
  while (at < bytes.length) {
    if (at + 12 > bytes.length) refuse(NOT_IMAGE('This file'));
    const length = view.getUint32(at);
    const type = latin(bytes, at + 4, 4);
    const end = at + 12 + length;
    if (end > bytes.length) refuse(NOT_IMAGE('This file'));
    const what = PNG_DROPPED[type];
    if (what) {
      if (!removed.includes(what)) removed.push(what);
      if (type === 'eXIf') {
        const tiff = tiffOf(bytes, at + 8, at + 8 + length);
        if (tiff && ifd0Facts(tiff, at + 8 + length).gps) hadLocation = true;
      }
    } else parts.push(bytes.subarray(at, end));
    at = end;
    if (type === 'IEND') { ended = true; break; }
  }
  if (!ended) refuse(NOT_IMAGE('This file'));
  return { bytes: Buffer.concat(parts), format: 'png', removed, hadLocation, orientation: null };
}

/** A WebP without its EXIF and XMP chunks, the VP8X flags that named them cleared and the RIFF size written again. */
export function cleanWebp(input: Uint8Array): CleanedImage {
  const bytes = Uint8Array.from(input);
  if (bytes.length < 12 || latin(bytes, 0, 4) !== 'RIFF' || latin(bytes, 8, 4) !== 'WEBP') refuse(NOT_IMAGE('This file'));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const parts: Uint8Array[] = [];
  const removed: string[] = [];
  let hadLocation = false, at = 12;
  while (at < bytes.length) {
    if (at + 8 > bytes.length) refuse(NOT_IMAGE('This file'));
    const fourcc = latin(bytes, at, 4);
    const size = view.getUint32(at + 4, true);
    const end = at + 8 + size + (size % 2);
    if (end > bytes.length) refuse(NOT_IMAGE('This file'));
    if (fourcc === 'EXIF' || fourcc === 'XMP ') {
      const what = fourcc === 'EXIF' ? 'camera and location data (EXIF)' : 'XMP data';
      if (!removed.includes(what)) removed.push(what);
      if (fourcc === 'EXIF') {
        const tiff = tiffOf(bytes, at + 8, at + 8 + size);
        if (tiff && ifd0Facts(tiff, at + 8 + size).gps) hadLocation = true;
      }
    } else if (fourcc === 'VP8X') {
      const chunk = Uint8Array.from(bytes.subarray(at, end));
      chunk[8] &= ~0x0c; // EXIF (0x08) and XMP (0x04) are no longer there
      parts.push(chunk);
    } else parts.push(bytes.subarray(at, end));
    at = end;
  }
  const body = Buffer.concat(parts);
  const head = Buffer.alloc(12);
  head.write('RIFF', 0, 'latin1');
  head.writeUInt32LE(body.length + 4, 4);
  head.write('WEBP', 8, 'latin1');
  return { bytes: Buffer.concat([head, body]), format: 'webp', removed, hadLocation, orientation: null };
}

const IMAGE_EXTENSIONS: Readonly<Record<string, 'jpeg' | 'png' | 'webp'>> = Object.freeze({ '.jpg': 'jpeg', '.jpeg': 'jpeg', '.png': 'png', '.webp': 'webp' });
const AUDIO_EXTENSIONS: readonly string[] = Object.freeze(['.wav', '.mp3', '.m4a', '.ogg']);

/** A photo by its name: cleaned by its format, or refused when the bytes are not that format. */
export function cleanImage(name: string, bytes: Uint8Array): CleanedImage {
  const format = IMAGE_EXTENSIONS[extname(name).toLowerCase()];
  if (!format) refuse(NOT_IMAGE(name));
  try {
    return format === 'jpeg' ? cleanJpeg(bytes) : format === 'png' ? cleanPng(bytes) : cleanWebp(bytes);
  } catch (error) {
    if (error instanceof ChausarError) refuse(NOT_IMAGE(name));
    throw error;
  }
}

/** Whether a file's name makes it a photo or a recording, which media intake takes; null for every other file. */
export function mediaKindOf(name: string): 'image' | 'audio' | null {
  const ext = extname(name).toLowerCase();
  return IMAGE_EXTENSIONS[ext] ? 'image' : AUDIO_EXTENSIONS.includes(ext) ? 'audio' : null;
}

/** A recording is what its name says, by its first bytes: WAV, MP3, M4A or Ogg. */
export function checkAudio(name: string, bytes: Uint8Array): void {
  const ext = extname(name).toLowerCase();
  const ok = ext === '.wav' ? latin(bytes, 0, 4) === 'RIFF' && latin(bytes, 8, 4) === 'WAVE'
    : ext === '.mp3' ? latin(bytes, 0, 3) === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)
      : ext === '.m4a' ? latin(bytes, 4, 4) === 'ftyp'
        : latin(bytes, 0, 4) === 'OggS';
  if (!ok) refuse(`${name} is not a recording Chausar can keep. Add a WAV, MP3, M4A or Ogg file.`);
}

/** How many photos and recordings one order keeps, apart from its other files. */
export const MAX_MEDIA_PER_ORDER = 10;

/**
 * A photo or recording for an order, from venture.files.add (which has checked the payload and the channel): a photo
 * is cleaned first and only the cleaned bytes are kept; a recording is kept as it came. Both sit in the order's media
 * scope, client data, and the event never carries the name.
 */
export async function mediaAdd(deps: VentureDeps, ctx: Context, input: { orderId: string; name: string; bytes: Uint8Array }): Promise<UploadView> {
  const kind = mediaKindOf(input.name)!;
  let bytes = input.bytes;
  if (kind === 'image') bytes = cleanImage(input.name, input.bytes).bytes;
  else checkAudio(input.name, input.bytes);
  const encoded = Buffer.from(bytes).toString('base64');
  return ventureAction(deps, ctx, 'prepare', 'files.add', tx => {
    check(tx.find('venture-order', input.orderId), 'ORDER_NOT_FOUND', 'That order was not found.');
    const media = tx.list('venture-upload').filter(upload => upload.scope.kind === 'media' && upload.scope.orderId === input.orderId);
    check(media.length < MAX_MEDIA_PER_ORDER, 'UPLOAD_LIMIT', `An order holds at most ${MAX_MEDIA_PER_ORDER} photos and recordings.`);
    const record: UploadRecord = {
      ...tx.base('venture-upload'), name: input.name, format: kind, bytes: bytes.length, digest: digest(encoded), contentBase64: encoded,
      scope: { kind: 'media', orderId: input.orderId }, clientData: true,
    };
    tx.put(record);
    tx.emit('upload-added', { uploadId: record.id, orderId: input.orderId, format: kind });
    const { contentBase64: _content, ...view } = record;
    return view;
  });
}

// ---------------------------------------------------------------------------
// Clips on the desktop
// ---------------------------------------------------------------------------

export const CLIP_HELD = 'This clip still has its location data, so it cannot go out. Add ffmpeg to this computer, then run the order again to clean it.';
const CLIP_TIMEOUT_MS = 10 * 60_000;
export type ClipCleaning =
  | { status: 'cleaned'; output: string; args: string[] }
  | { status: 'held'; line: string }
  | { status: 'failed'; line: string };

/** Where the cleaned copy of a clip goes: beside it, 'reel.clean.mp4'. */
export const cleanedPath = (input: string) => join(dirname(input), `${basename(input, extname(input))}.clean${extname(input)}`);

/**
 * A clip rewritten by the ffmpeg on this computer without its metadata (-map_metadata -1, chapters too), streams copied
 * as they are, into a new file beside it: an existing file is never written over (-n, and checked first). With no
 * ffmpeg it is held, with the words Today shows.
 */
export async function cleanClip(port: FfmpegPort, input: string): Promise<ClipCleaning> {
  const binary = port.locate();
  if (!binary) return { status: 'held', line: CLIP_HELD };
  const output = cleanedPath(input);
  if (existsSync(output)) return { status: 'failed', line: `A cleaned copy is already there: ${basename(output)}. Move it away to clean the clip again.` };
  // Only the picture and the sound: data streams (a GoPro's GPS track, timed metadata) are dropped, with every tag.
  const args = [
    '-hide_banner', '-nostdin', ...FILE_ONLY_INPUT, '-i', input, '-map', '0:v', '-map', '0:a?', '-dn',
    '-map_metadata', '-1', '-map_metadata:s:v', '-1', '-map_metadata:s:a', '-1', '-map_chapters', '-1', '-c', 'copy', '-n', output,
  ];
  const run = await port.run(binary, args, CLIP_TIMEOUT_MS);
  if (run.code !== 0) return { status: 'failed', line: run.timedOut ? 'Cleaning the clip ran past its time.' : 'ffmpeg could not clean the clip. It is kept as it is, and held.' };
  return { status: 'cleaned', output, args };
}

/** The ffmpeg a clip is cleaned with: the one given to the workspace, else the one on PATH. */
export const ffmpegOf = (deps: VentureDeps): FfmpegPort => deps.ffmpeg ?? systemFfmpeg;

/** A clip's hygiene once cleaning ran: clean, or held with its location data. */
export function clipHygiene(result: ClipCleaning): AssetHygiene {
  return result.status === 'cleaned' ? { state: 'clean', removed: ['location and camera data'] } : { state: 'held', removed: [] };
}

// ---------------------------------------------------------------------------
// Today
// ---------------------------------------------------------------------------

/**
 * Today's notice for each clip still held with its location data, until it is cleaned or superseded: Open (Assets on
 * Work) and Later. Read from asset records only.
 */
export function mediaNoticeRows(_deps: VentureDeps, _ctx: Context, state: State, venture: VentureRecord): W4RowItem[] {
  return listRecords(state, 'venture-asset', venture.id)
    .filter(asset => asset.hygiene.state === 'held' && asset.supersededBy === null)
    .map(asset => ({
      kind: 'notice' as const, subject: `media:${asset.id}`, version: asset.id, createdAt: asset.at,
      title: 'A clip still has its location data',
      line: CLIP_HELD,
      actions: [{ id: 'later' as const, label: 'Later', primary: false }, { id: 'open' as const, label: 'Open Assets', primary: true }],
      navigate: 'Open Assets on Work to see the clip.',
    }));
}
