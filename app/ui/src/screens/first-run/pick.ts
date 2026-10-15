/**
 * The host's file chooser (`imports.pickFile`, a narrow desktop IPC in `app/desktop/file-ipc.cjs`)
 * turned into what the screens take:
 * - FR-07 and BK-04 (`statementPicker`): a CSV, Excel or PDF file as a `PickedFile`. CSV bytes are
 *   read as UTF-8 text here; Excel and PDF stay base64 for the engine. Nothing else is accepted.
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

function decodeBase64(bytesBase64: string): Uint8Array {
  const binary = atob(bytesBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** A picked statement in the shape FR-07 reads, or null for a kind it does not read. */
export function pickedStatement(name: string, bytesBase64: string): PickedFile | null {
  const format = formatOf(name, true);
  if (format === 'csv') return { name, format, content: new TextDecoder('utf-8').decode(decodeBase64(bytesBase64)) };
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
