/**
 * The host's file chooser (`imports.pickFile`, a narrow desktop IPC in `app/desktop/file-ipc.cjs`)
 * turned into what the screens take:
 * - FR-07 and BK-04 (`statementPicker`): a CSV, Excel or PDF file as a `PickedFile`. CSV bytes are
 *   read as UTF-8 text here, strictly: bytes that are not UTF-8 are refused (`FILE_NOT_UTF8`), never
 *   replaced. Excel and PDF stay base64 for the engine. Nothing else is accepted. Before a file is
 *   sent, `fitsRequest` checks the encoded request stays under `REQUEST_LIMIT_BYTES`; the screen
 *   refuses a larger one as `FILE_TOO_LARGE`.
 * - FR-13 (`backupPicker`): the managed name of a `.backup` in the app's backups folder, which
 *   `workspace.restore` takes as `backupFile`. Never a path.
 * A cancelled dialog is `null`. A refusal throws an Error carrying its fixed code
 * (`FILE_TOO_LARGE`, `FILE_KIND_REFUSED`, `FILE_UNREADABLE`, `BACKUP_NOT_MANAGED`, `PICKER_BUSY`),
 * which the screen turns into its own words. Without a desktop chooser both are `undefined`, so
 * FR-07 draws `<input type=file>` and FR-13 says backup picking is not built here.
 */

import type { PickKind, PickReply } from '../../bridge/shell.ts';
import { formatOf, type PickedFile } from './journey-contracts.ts';

export interface FilePicker { readonly pickFile?: ((kind: PickKind) => Promise<PickReply>) | undefined }

const refusal = (code: string) => Object.assign(new Error('The file was not picked.'), { code });

/** The largest encoded request a file may make (the engine's request limit, with room to spare). */
export const REQUEST_LIMIT_BYTES = 1_900_000;
/** Whether a request (method and payload, as JSON in UTF-8) stays under the limit. */
export function fitsRequest(method: string, payload: Readonly<Record<string, unknown>>): boolean {
  return new TextEncoder().encode(JSON.stringify({ method, payload })).length < REQUEST_LIMIT_BYTES;
}
/** CSV bytes as UTF-8 text, or the fixed refusal `FILE_NOT_UTF8`: a byte that is not UTF-8 is never replaced. */
export function csvText(bytes: Uint8Array | ArrayBuffer): string {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw refusal('FILE_NOT_UTF8'); }
}

function decodeBase64(bytesBase64: string): Uint8Array {
  const binary = atob(bytesBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** A picked statement in the shape FR-07 reads, or null for a kind it does not read. */
export function pickedStatement(name: string, bytesBase64: string): PickedFile | null {
  const format = formatOf(name, true);
  if (format === 'csv') return { name, format, content: csvText(decodeBase64(bytesBase64)) };
  if (format === 'xlsx' || format === 'pdf') return { name, format, bytesBase64 };
  return null;
}

export function statementPicker(shell: FilePicker | undefined | null): (() => Promise<PickedFile | null>) | undefined {
  const pick = shell?.pickFile;
  if (pick === undefined) return undefined;
  return async () => {
    const reply = await pick('statement');
    if (reply.outcome === 'cancelled') return null;
    if (reply.outcome === 'refused') throw refusal(reply.code);
    const file = reply.bytesBase64 === undefined ? null : pickedStatement(reply.name, reply.bytesBase64);
    if (file === null) throw refusal('FILE_KIND_REFUSED');
    return file;
  };
}

export function backupPicker(shell: FilePicker | undefined | null): (() => Promise<string | null>) | undefined {
  const pick = shell?.pickFile;
  if (pick === undefined) return undefined;
  return async () => {
    const reply = await pick('backup');
    if (reply.outcome === 'cancelled') return null;
    if (reply.outcome === 'refused') throw refusal(reply.code);
    return reply.name;
  };
}
