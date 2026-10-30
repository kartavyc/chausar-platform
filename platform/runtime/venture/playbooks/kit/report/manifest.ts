// Chausar playbook kit (Ink v2 wave 5, package 5A5, P11): a report's manifest.json, the sha256 and size of every file
// beside it, so the owner or the client can check nothing changed after it was made; and writing a report folder to
// this computer, every file and the manifest together or none (playbooks/kit/atomic-write.ts, W4 P12). The same files
// give the same manifest text. The idea of a checksum manifest comes from beyondseo's report renderer (MIT), catalogue
// row P11; no code of it was read or copied. Written for Chausar.
import { createHash } from 'node:crypto';
import { writeFilesAtomic, type AtomicFile } from '../atomic-write.ts';

/** The manifest's format name, so a later reader knows what it holds. */
export const MANIFEST_FORMAT = 'chausar-report-manifest/1';

/** The manifest of these files, in their order: its text and what it lists. */
export function manifestOf(files: readonly AtomicFile[]): { text: string; files: { name: string; bytes: number; sha256: string }[] } {
  const listed = files.map(file => ({ name: file.name, bytes: file.bytes.length, sha256: createHash('sha256').update(file.bytes).digest('hex') }));
  return { text: `${JSON.stringify({ format: MANIFEST_FORMAT, files: listed }, null, 2)}\n`, files: listed };
}

/**
 * Writes a report's files and its manifest.json into a folder on this computer, all or none. A name already there
 * refuses with EXPORT_EXISTS unless replace; errors are in plain words with no path. Answers the manifest written.
 */
export async function writeReportFolder(folder: string, files: readonly AtomicFile[], options: { replace?: boolean } = {}): Promise<{ text: string }> {
  const manifest = manifestOf(files);
  await writeFilesAtomic(folder, [...files, { name: 'manifest.json', bytes: new Uint8Array(Buffer.from(manifest.text, 'utf8')) }], options);
  return { text: manifest.text };
}
