import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { open, readFile, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import type { State } from '../contracts.ts';
import { InternalError } from '../portable.ts';
import { sha256Hex } from '../hash.ts';
import { stateDelta, applyStateDelta, type StateDelta } from './journal-format.ts';
type Options = { directory: string; id: string; key: Buffer; base: State; baseHash: string; checkpoint(state: State): Promise<string> };
type Line = { format: 1; id: string; from: number; revision: number; previous: string; cipher: { nonce: string; tag: string; data: string } };
const refused = () => new InternalError('UNLOCK_FAILED', 'Unable to open the encrypted journal.');
const aad = (line: Omit<Line, 'cipher'>) => Buffer.from(JSON.stringify({ format: line.format, id: line.id, from: line.from, revision: line.revision, previous: line.previous }));
function sealed(key: Buffer, header: Omit<Line, 'cipher'>, delta: StateDelta): Line {
  const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, nonce); cipher.setAAD(aad(header));
  const body = Buffer.concat([cipher.update(JSON.stringify(delta)), cipher.final()]);
  return { ...header, cipher: { nonce: nonce.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: body.toString('base64') } };
}
function opened(key: Buffer, line: Line): StateDelta {
  if (line.format !== 1 || !Number.isSafeInteger(line.from) || !Number.isSafeInteger(line.revision) || line.revision <= line.from) throw refused();
  const cipher = createDecipheriv('aes-256-gcm', key, Buffer.from(line.cipher.nonce, 'base64')); cipher.setAAD(aad(line)); cipher.setAuthTag(Buffer.from(line.cipher.tag, 'base64'));
  const delta = JSON.parse(Buffer.concat([cipher.update(Buffer.from(line.cipher.data, 'base64')), cipher.final()]).toString('utf8')) as StateDelta;
  if (delta.from !== line.from || delta.revision !== line.revision) throw refused(); return delta;
}
/** Scratch candidate. Vault owns the writer lock; this layer owns authenticated append/checkpoint IO. */
export class JournalStore {
  #options: Options; #state: State; #key: Buffer; #hash: string; #lines = 0; #size = 0; #bytes: number; #closed = false;
  private constructor(options: Options) { this.#options = options; this.#state = structuredClone(options.base); this.#key = Buffer.from(options.key); this.#hash = options.baseHash; this.#bytes = Buffer.byteLength(JSON.stringify(options.base)); }
  static async open(options: Options): Promise<JournalStore> {
    const journal = new JournalStore(options), path = join(options.directory, 'journal.log');
    try {
      const info = await lstat(path).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return null; throw error; });
      if (!info) { const file = await open(path, 'wx', 0o600); await file.sync(); await file.close(); await journal.#syncDirectory(); return journal; }
      if (!info.isFile() || info.isSymbolicLink() || info.size > 64 * 1024 * 1024) throw refused();
      const raw = await readFile(path, 'utf8'), end = raw.lastIndexOf('\n') + 1, complete = raw.slice(0, end), torn = raw.slice(end);
      for (const text of (complete ? complete.slice(0, -1).split('\n') : [])) {
        const line = JSON.parse(text) as Line;
        if (line.id !== options.id || line.from !== journal.#state.revision || line.previous !== journal.#hash) throw refused();
        journal.#state = applyStateDelta(journal.#state, opened(journal.#key, line)); journal.#hash = sha256Hex(text); journal.#lines++;
      }
      journal.#bytes = Buffer.byteLength(JSON.stringify(journal.#state)); journal.#size = Buffer.byteLength(complete);
      if (journal.#bytes > 32 * 1024 * 1024) throw refused();
      if (torn) {
        let retained = false;
        for (let index = 0; index < 1000; index++) {
          try { const saved = await open(join(options.directory, 'journal.torn' + (index ? '.' + index : '')), 'wx', 0o600); try { await saved.writeFile(torn); await saved.sync(); } finally { await saved.close(); } retained = true; break; }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
        }
        if (!retained) throw refused(); await journal.#syncDirectory();
        const file = await open(path, constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0)); try { await file.truncate(journal.#size); await file.sync(); } finally { await file.close(); }
      }
      return journal;
    } catch { journal.#key.fill(0); throw refused(); }
  }
  read(): State { return structuredClone(this.#state); }
  async commit(next: State): Promise<void> {
    if (this.#closed) throw new InternalError('VAULT_CLOSED', 'The vault is closed.');
    const delta = stateDelta(this.#state, next);
    if (this.#bytes + delta.byteDelta > 32 * 1024 * 1024) throw new InternalError('VAULT_TOO_LARGE', 'This business is too large to save.');
    const text = JSON.stringify(sealed(this.#key, { format: 1, id: this.#options.id, from: this.#state.revision, revision: next.revision, previous: this.#hash }, delta));
    const file = await open(join(this.#options.directory, 'journal.log'), constants.O_WRONLY | constants.O_APPEND | (constants.O_NOFOLLOW ?? 0));
    try { if ((await file.stat()).size !== this.#size) throw refused(); await file.writeFile(text + '\n'); await file.sync(); } finally { await file.close(); }
    this.#state = structuredClone(next); this.#bytes += delta.byteDelta; this.#hash = sha256Hex(text); this.#lines++; this.#size += Buffer.byteLength(text + '\n');
    if (this.#lines >= 200 || this.#size >= 4 * 1024 * 1024) await this.flush();
  }
  async flush(): Promise<void> {
    if (!this.#lines) return;
    this.#hash = await this.#options.checkpoint(this.#state);
    const file = await open(join(this.#options.directory, 'journal.log'), constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0));
    try { await file.truncate(0); await file.sync(); } finally { await file.close(); }
    this.#lines = 0; this.#size = 0; await this.#syncDirectory();
  }
  async close(): Promise<void> { if (this.#closed) return; await this.flush(); this.#closed = true; this.#key.fill(0); }
  async #syncDirectory() { if (process.platform === 'win32') return; const file = await open(this.#options.directory, 'r'); try { await file.sync(); } finally { await file.close(); } }
}
