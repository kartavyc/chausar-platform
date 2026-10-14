import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check } from '../../platform/runtime/contracts.ts';

/** Writes SHA256SUMS (`sha256sum -c` compatible) and checksums.json for every
 * top-level artifact in a release folder, sorted by name. Diagnostics and the
 * checksum files themselves are excluded. */
export type ReleaseChecksum = { name: string; size: number; sha256: string };
const EXCLUDED = new Set(['SHA256SUMS', 'checksums.json', 'builder-debug.yml', 'builder-effective-config.yaml']);

async function digest(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

export async function releaseChecksums(directory: string): Promise<{ files: ReleaseChecksum[]; sums: string; json: string }> {
  const info = await lstat(directory);
  check(info.isDirectory() && !info.isSymbolicLink(), 'CHECKSUM_FOLDER_INVALID', 'The release folder must be a real folder.');
  const files: ReleaseChecksum[] = [];
  const names = (await readdir(directory, { withFileTypes: true }))
    .filter(entry => entry.isFile() && !EXCLUDED.has(entry.name)).map(entry => entry.name)
    .sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
  for (const name of names) {
    check(!/[\x00-\x1f\x7f\\]/.test(name), 'CHECKSUM_NAME_INVALID', 'An artifact name contains characters sha256sum cannot list.');
    const path = join(directory, name), stat = await lstat(path);
    files.push({ name, size: stat.size, sha256: await digest(path) });
  }
  check(files.length > 0, 'CHECKSUM_EMPTY', 'The release folder has no artifacts to checksum.');
  const sums = files.map(file => `${file.sha256}  ${file.name}\n`).join('');
  const json = JSON.stringify({ schemaVersion: 1, algorithm: 'sha256', files }, null, 2) + '\n';
  return { files, sums, json };
}

export async function writeReleaseChecksums(directory: string): Promise<ReleaseChecksum[]> {
  const result = await releaseChecksums(directory);
  await writeFile(join(directory, 'SHA256SUMS'), result.sums);
  await writeFile(join(directory, 'checksums.json'), result.json);
  return result.files;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    check(process.argv.length === 3, 'USAGE', 'usage: node scripts/release/checksums.ts <release folder>');
    const files = await writeReleaseChecksums(resolve(process.argv[2]));
    console.log(`Wrote SHA256SUMS and checksums.json for ${files.length} artifact(s).`);
  } catch (error: any) { console.error(`${error.code ?? 'CHECKSUM_FAILED'}: ${error.message}`); process.exitCode = 1; }
}
