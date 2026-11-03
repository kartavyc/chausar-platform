import type { EventEmitter } from 'node:events';
import type { Readable, Writable } from 'node:stream';
import { markRefusal } from '../refusal-brand.ts';

/** Only stdio is exposed. Neither prompts nor provider errors are logged here. */
export interface CodexChild extends EventEmitter {
  stdin: Writable; stdout: Readable; stderr: Readable;
  kill(signal?: NodeJS.Signals): boolean;
}
/**
 * A2 (A1 carry-over): the codes that tell the owner what to do (Codex missing, a policy this install cannot enforce, the
 * job's own AGENT_* stops) are Chausar's refusals and branded, so their words reach the owner. The protocol, timeout,
 * exit and refusal codes describe what Codex itself did; they stay unbranded engine faults.
 */
const OWNER_CODES = new Set(['CODEX_NOT_INSTALLED', 'CODEX_POLICY_UNSUPPORTED']);
export class CodexError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message); this.name = 'CodexError'; this.code = code;
    if (OWNER_CODES.has(code) || code.startsWith('AGENT_')) markRefusal(this);
  }
}
export function object(value: unknown): value is Record<string, any> { return !!value && typeof value === 'object' && !Array.isArray(value); }
type RpcOptions = {
  maxFrameBytes?: number; requestTimeoutMs?: number;
  onNotification?: (method: string, params: unknown) => void;
  onRequest?: (method: string, params: unknown, id: string | number) => Promise<unknown>;
  onClose?: (error: CodexError) => void;
};
type Pending = { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> };

/** JSONL transport with independent request handling; a server request cannot deadlock a client call. */
export class CodexRpc {
  private readonly child: CodexChild;
  private readonly options: RpcOptions;
  private readonly pending = new Map<number, Pending>();
  private fragments: Buffer[] = []; private bytes = 0; private sequence = 0;
  private failure: CodexError | undefined;
  private ended = false;
  private closing: Promise<void> | undefined;
  constructor(child: CodexChild, options: RpcOptions = {}) {
    this.child = child; this.options = options;
    child.stdout.on('data', this.read);
    child.stdout.once('end', this.exited); child.once('exit', this.exited); child.once('error', this.exited);
    child.stdin.on('error', this.exited); child.stderr.on('data', () => {});
    child.once('exit', () => { this.ended = true; });
    child.once('error', () => { this.ended = true; });
  }
  private exited = () => this.fail(new CodexError('CODEX_PROCESS_EXITED', 'Codex stopped. This request was not retried.'));
  private fail(error: CodexError) {
    if (this.failure) return;
    this.failure = error; this.fragments = []; this.bytes = 0;
    for (const call of this.pending.values()) { clearTimeout(call.timer); call.reject(error); }
    this.pending.clear(); this.child.kill(); this.options.onClose?.(error);
  }
  private read = (chunk: Buffer | string) => {
    if (this.failure) return;
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    let start = 0;
    while (start < buffer.length && !this.failure) {
      const end = buffer.indexOf(10, start), stop = end < 0 ? buffer.length : end;
      this.bytes += stop - start;
      if (this.bytes > (this.options.maxFrameBytes ?? 8 * 1024 * 1024)) { this.fail(new CodexError('CODEX_PROTOCOL_INVALID', 'Codex returned an oversized message.')); return; }
      this.fragments.push(buffer.subarray(start, stop));
      if (end < 0) break;
      const frame = Buffer.concat(this.fragments, this.bytes); this.fragments = []; this.bytes = 0;
      try {
        const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(frame));
        this.receive(value);
      } catch { this.fail(new CodexError('CODEX_PROTOCOL_INVALID', 'Codex returned an invalid message.')); }
      start = end + 1;
    }
  };
  private receive(value: unknown) {
    if (!object(value)) throw new Error('Invalid envelope');
    if (typeof value.method === 'string') {
      if (!('id' in value)) { this.options.onNotification?.(value.method, value.params); return; }
      if (typeof value.id !== 'string' && typeof value.id !== 'number') throw new Error('Invalid request id');
      const id = value.id;
      void Promise.resolve().then(() => {
        if (!this.options.onRequest) throw new Error('Unsupported request');
        return this.options.onRequest(value.method, value.params, id);
      }).then(result => this.send({ id, result }), () => this.send({ id, error: { code: -32601, message: 'This request is not permitted by Chausar.' } })).catch(() => {});
      return;
    }
    if (typeof value.id !== 'number' || (!('result' in value) && !object(value.error))) throw new Error('Invalid response');
    const call = this.pending.get(value.id); if (!call) return;
    this.pending.delete(value.id); clearTimeout(call.timer);
    if ('error' in value) call.reject(new CodexError('CODEX_RPC_REFUSED', 'Codex refused the request. It was not retried or rerouted.'));
    else call.resolve(value.result);
  }
  private send(value: unknown) {
    if (this.failure) throw this.failure;
    const text = JSON.stringify(value) + '\n';
    if (Buffer.byteLength(text) > (this.options.maxFrameBytes ?? 8 * 1024 * 1024)) throw new CodexError('CODEX_PROTOCOL_INVALID', 'The request is too large for Codex.');
    this.child.stdin.write(text);
  }
  request(method: string, params: unknown): Promise<unknown> {
    if (this.failure) return Promise.reject(this.failure);
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id); reject(new CodexError('CODEX_RPC_TIMEOUT', 'Codex did not answer in time. The request was not retried.'));
      }, this.options.requestTimeoutMs ?? 30000);
      this.pending.set(id, { resolve, reject, timer });
      try { this.send({ id, method, params }); } catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  notify(method: string, params: unknown) { this.send({ method, params }); }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.fail(new CodexError('CODEX_SESSION_CLOSED', 'This Codex session is closed.'));
    if (this.ended) return Promise.resolve();
    this.closing = new Promise((resolve, reject) => {
      const finish = () => { clearTimeout(timer); this.child.off('exit', finish); this.child.off('error', finish); resolve(); };
      const timer = setTimeout(() => {
        this.child.off('exit', finish); this.child.off('error', finish); this.child.kill('SIGKILL');
        reject(new CodexError('CODEX_STOP_TIMEOUT', 'Codex did not confirm it stopped.'));
      }, 5000);
      this.child.once('exit', finish); this.child.once('error', finish);
    });
    return this.closing;
  }
}
