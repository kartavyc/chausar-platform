import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { check } from '../shared/errors.ts';

export type BlobBody = Uint8Array | AsyncIterable<Uint8Array>;
/**
 * Where encrypted backup bytes live. Keys are `<accountId>/<backupId>`. The store only ever holds ciphertext
 * the desktop sealed with a key the server never receives. `FileBlobStore` is the default; an S3-compatible
 * object store is a deploy choice that implements this same interface (write-once keys, SHA-256 on put).
 */
export interface BlobStore {
  put(key: string, body: BlobBody): Promise<{ sizeBytes: number; sha256: string }>;
  /** `undefined` when nothing is stored under the key. */
  get(key: string): Promise<Buffer | undefined>;
  /** Removing a missing key is not an error. */
  delete(key: string): Promise<void>;
}

export const BACKUP_ID = /^bk_[0-9a-f]{32}$/;
const ACCOUNT = /^[A-Za-z0-9_-]{1,128}$/;
/** Both parts are validated so a key can never climb out of its account folder. */
export function blobKey(accountId: string, backupId: string): string {
  check(typeof accountId === 'string' && ACCOUNT.test(accountId) && typeof backupId === 'string' && BACKUP_ID.test(backupId), 'BLOB_KEY_INVALID', 'The storage key is not valid.');
  return `${accountId}/${backupId}`;
}
function parts(key: string): [string, string] {
  const split = typeof key === 'string' ? key.split('/') : [];
  check(split.length === 2, 'BLOB_KEY_INVALID', 'The storage key is not valid.');
  blobKey(split[0], split[1]);
  return [split[0], split[1]];
}

/** Files under one directory: written to a temporary file, flushed to disk, then renamed into place. */
export class FileBlobStore implements BlobStore {
  readonly #root: string;
  constructor(directory: string) {
    check(typeof directory === 'string' && directory.length > 0, 'BLOB_STORE_NOT_CONFIGURED', 'Backup storage is not set up on this server.', 503);
    this.#root = resolve(directory);
  }
  #paths(key: string) { const [account, id] = parts(key); const folder = join(this.#root, account); return { folder, file: join(folder, id) }; }
  async put(key: string, body: BlobBody): Promise<{ sizeBytes: number; sha256: string }> {
    const { folder, file } = this.#paths(key);
    await mkdir(folder, { recursive: true, mode: 0o700 });
    const temp = `${file}.${randomUUID()}.tmp`, hash = createHash('sha256'); let sizeBytes = 0;
    const handle = await open(temp, 'wx', 0o600);
    try {
      for await (const chunk of body instanceof Uint8Array ? [body] : body) {
        hash.update(chunk); sizeBytes += chunk.length;
        for (let offset = 0; offset < chunk.length;) offset += (await handle.write(chunk, offset, chunk.length - offset)).bytesWritten;
      }
      await handle.sync(); await handle.close();
    }
    catch (error) { await handle.close().catch(() => {}); await rm(temp, { force: true }); throw error; }
    await rename(temp, file);
    // The rename is durable only once the folder entry is flushed. Some platforms cannot open a folder; they skip this.
    try { const dir = await open(folder, 'r'); try { await dir.sync(); } finally { await dir.close(); } } catch { /* not supported here */ }
    return { sizeBytes, sha256: hash.digest('hex') };
  }
  async get(key: string): Promise<Buffer | undefined> {
    try { return await readFile(this.#paths(key).file); }
    catch (error: any) { if (error?.code === 'ENOENT') return undefined; throw error; }
  }
  async delete(key: string): Promise<void> { await rm(this.#paths(key).file, { force: true }); }
}
