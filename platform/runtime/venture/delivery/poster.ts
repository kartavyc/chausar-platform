// Chausar delivery (Ink v2 wave 4, package 4J3): the poster of a YouTube order, one still from the finished cut named at
// intake, for the video card on Today (views/previews.ts). No method takes a still any more; a vault may still hold
// one, and this file reads it. A still is shown only when its bytes are a JPEG and it is small (POSTER_MAX_BYTES), so
// a poster never carries anything that runs and never a made-up image. It is client data (a frame of the client's
// footage) in a scope of its own, so no agent tool, run file list or order file count reads it as a file the client
// sent. One poster per order.
import { playbookForRun } from './workflow.ts';
import type { State } from '../../contracts.ts';
import { listRecords } from '../records.ts';
import type { DeliveryRunRecord, UploadRecord, VentureRecord } from '../contracts.ts';
import { YOUTUBE_ID } from '../playbooks/youtube/registration.ts';

/** The largest still kept, in bytes: a small frame for a card, never the footage. */
export const POSTER_MAX_BYTES = 64 * 1024;

/** A JPEG starts with the start-of-image marker and ends with the end-of-image marker. */
export function isJpeg(bytes: Uint8Array): boolean {
  const n = bytes.length;
  return n >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff && bytes[n - 2] === 0xff && bytes[n - 1] === 0xd9;
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
  const playbook = playbookForRun(state, run);
  return !!playbook && playbook.ventureId === venture.id && playbook.flagship === YOUTUBE_ID;
}

/** The order's poster as a card or a run tile shows it, or null when none is kept or it is not a small JPEG any more. */
export function posterView(state: State, ventureId: string, orderId: string): { uploadId: string; src: string } | null {
  const still = posterOf(state, ventureId, orderId);
  const src = still ? posterSrc(still) : null;
  return still && src ? { uploadId: still.id, src } : null;
}
