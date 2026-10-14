/**
 * The send journal lives outside the vault, in the application directory, so restoring an older
 * vault backup cannot forget that an effect was dispatched. Each line holds only opaque hashes and
 * a time: no payload, recipient, amount or system name. Before any dispatch the key is written and
 * flushed; an effect key found here for an unattempted action means "look before acting".
 */
import { appendFileSync, closeSync, fsyncSync, mkdirSync, openSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { check, hash } from '../contracts.ts';

export class SendJournal {
  #file: string;
  constructor(directory: string, workspaceId: string) {
    check(typeof directory === 'string' && directory.length > 0, 'WRITE_JOURNAL_UNAVAILABLE', 'The send journal has no folder.');
    const folder = join(directory, 'writeback-journal'); mkdirSync(folder, { recursive: true, mode: 0o700 });
    this.#file = join(folder, `${hash(`journal:${workspaceId}`).slice(0, 32)}.jsonl`);
  }
  #line(key: string) { return hash(`effect:${key}`); }
  has(key: string): boolean {
    if (!existsSync(this.#file)) return false;
    const id = this.#line(key);
    return readFileSync(this.#file, 'utf8').split('\n').some(line => line.startsWith(`{"effect":"${id}"`));
  }
  /** Durable before the request leaves: a crash after this line can only cause a look, never a resend. */
  record(key: string, at: string) {
    const fd = openSync(this.#file, 'a', 0o600);
    try { appendFileSync(fd, `${JSON.stringify({ effect: this.#line(key), at })}\n`); fsyncSync(fd); } finally { closeSync(fd); }
  }
}
