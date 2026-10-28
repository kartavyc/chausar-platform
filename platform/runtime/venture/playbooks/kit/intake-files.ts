// Chausar kit intake files (5M). Original atomic order adapter, reusing the existing client-file and media validators.
import { check } from '../../../contracts.ts';
import type { VentureDeps, UploadRecord } from '../../contracts.ts';
import { exactPayload, singleLine, digest, type VentureTx } from '../../records.ts';
import type { FlagshipOffer } from '../plan.ts';
import { HOSTED_NO_PDF, MAX_UPLOAD_BYTES, sniffFormat, tablesOfFile } from '../../delivery/harness/files.ts';
import { checkAudio, cleanImage, mediaKindOf } from './media-intake.ts';
export type PreparedIntakeFile = Pick<UploadRecord, 'name' | 'format' | 'bytes' | 'digest' | 'contentBase64'> & { field: string; media: boolean };
/** Prepare bounded client files before opening the order transaction; no file reaches a model or filesystem here. */
export function prepareIntakeFiles(deps: VentureDeps, raw: unknown): PreparedIntakeFile[] {
 if (raw === undefined) return [];
 check(raw !== null && typeof raw === 'object' && !Array.isArray(raw), 'INVALID_VENTURE_REQUEST', 'Send the intake files by their question names.');
 const entries = Object.entries(raw as Record<string, unknown>);
 check(entries.length <= 10, 'UPLOAD_LIMIT', 'Choose at most ten intake files.');
 let total = 0;
 return entries.map(([field, input]) => {
  const body = exactPayload(input, ['name', 'contentBase64'], ['name', 'contentBase64']);
  const name = singleLine(body.name, 'File name', { max: 120 });
  const encoded = body.contentBase64;
  check(typeof encoded === 'string' && encoded.length > 0 && encoded.length <= Math.ceil(MAX_UPLOAD_BYTES / 3) * 4 && /^[A-Za-z0-9+/]*={0,2}$/.test(encoded), 'UPLOAD_LIMIT', 'Add a file smaller than one and a half megabytes.');
  let bytes: Uint8Array = Buffer.from(encoded as string, 'base64');
  total += bytes.length;
  check(bytes.length > 0 && bytes.length <= MAX_UPLOAD_BYTES && total <= 1_300_000, 'UPLOAD_LIMIT', 'Intake files together must fit within one megabyte and three hundred kilobytes.');
  const media = mediaKindOf(name);
  const format = media ?? sniffFormat(name, bytes);
  if (media === 'image') bytes = cleanImage(name, bytes).bytes;
  else if (media === 'audio') checkAudio(name, bytes);
  check(!(format === 'pdf' && deps.host === 'hosted-web'), 'TIER_UNAVAILABLE', HOSTED_NO_PDF);
  const contentBase64 = Buffer.from(bytes).toString('base64');
  const prepared = { field, name, format, bytes: bytes.length, digest: digest(contentBase64), contentBase64, media: media !== null };
  if (format === 'csv' || format === 'xlsx') tablesOfFile({ ...prepared, id: 'upload_check', clientData: true });
  return prepared;
 });
}
/** A file answer names bytes attached to this exact new order, never an arbitrary upload id. */
function requireOrderFiles(tx: VentureTx, orderId: string, offer: FlagshipOffer | null, raw: unknown): void {
 if (!offer?.intake || !raw || typeof raw !== 'object' || Array.isArray(raw)) return;
 const fields = (raw as Record<string, unknown>).fields;
 if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return;
 for (const field of offer.intake.filter(field => field.kind === 'file')) {
  const id = (fields as Record<string, unknown>)[field.id];
  if (typeof id !== 'string' || !id) continue;
  const upload = tx.find('venture-upload', id);
  check(upload && upload.ventureId === tx.venture!.id && (upload.scope.kind === 'order' || upload.scope.kind === 'media') && upload.scope.orderId === orderId && upload.bytes > 0 && upload.contentBase64.length > 0, 'UPLOAD_NOT_FOUND', 'Add the file to this order before using it as an intake answer.');
 }
}

/** Put validated uploads and their field references inside the same transaction as their new order. */
export function attachIntakeFiles(tx: VentureTx, orderId: string, offer: FlagshipOffer | null, raw: unknown, files: readonly PreparedIntakeFile[]): unknown {
 if (!files.length) { requireOrderFiles(tx, orderId, offer, raw); return raw; }
 check(!!offer?.intake, 'INVALID_VENTURE_REQUEST', 'Only a kit offer takes named intake files.');
 check(raw === undefined || raw !== null && typeof raw === 'object' && !Array.isArray(raw), 'INVALID_VENTURE_REQUEST', 'Send the intake as named fields.');
 const body = { ...raw as Record<string, unknown> | undefined };
 const sent = body.fields ?? {};
 check(sent !== null && typeof sent === 'object' && !Array.isArray(sent), 'INVALID_VENTURE_REQUEST', 'Send the intake fields as named fields.');
 const fields = { ...sent as Record<string, unknown> };
 for (const file of files) {
  check(offer!.intake!.some(field => field.id === file.field && field.kind === 'file') && !Object.hasOwn(fields, file.field), 'INVALID_VENTURE_REQUEST', 'Choose each intake file once, for a file question this service asks.');
  const record: UploadRecord = { ...tx.base('venture-upload'), name: file.name, format: file.format, bytes: file.bytes, digest: file.digest, contentBase64: file.contentBase64,
   scope: { kind: file.media ? 'media' : 'order', orderId }, clientData: true };
  tx.put(record); fields[file.field] = record.id;
  tx.emit('upload-added', { uploadId: record.id, orderId, format: record.format });
 }
 const result = { ...body, fields };
 requireOrderFiles(tx, orderId, offer, result);
 return result;
}
