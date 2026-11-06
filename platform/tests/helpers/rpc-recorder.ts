import { writeFile } from 'node:fs/promises';
import { createRecordingCodec, type RpcFrame, type RpcRecording } from '../../shared/rpc-recording.ts';
import { secretFindings } from '../../runtime/venture/core/secrets.ts';

type Target = { request(method: string, payload?: unknown): Promise<unknown>; onVentureEvent(listener: (event: any) => void): () => void };

/** Capture sample RPC calls only. A secret in any raw frame poisons the whole recording before anything is saved. */
export function createRpcRecorder(engine: Target, options: { epoch: string; scenario: string }) {
  const codec = createRecordingCodec(options.epoch);
  const frames: RpcFrame[] = [];
  let refused = false;
  let closed = false;
  let next = 0;
  let pending = 0;
  const open = () => {
    if (refused) throw new Error('The recording was refused because a raw frame held a secret.');
    if (closed) throw new Error('The recording is closed.');
  };
  const safe = (value: unknown) => {
    open();
    const text = JSON.stringify(value);
    if (text !== undefined && secretFindings(text).length) {
      refused = true;
      throw new Error('The recording was refused because a raw frame held a secret.');
    }
    return codec.encode(value);
  };
  const unsubscribe = engine.onVentureEvent(event => { frames.push({ kind: 'event', event: safe(event) }); });
  const finish = (): RpcRecording => {
    open();
    if (pending) throw new Error('A recording cannot finish while a request is pending.');
    return structuredClone({ format: 'chausar-rpc-recording/1', scenario: options.scenario, epoch: options.epoch, placeholders: codec.placeholders, frames });
  };
  return {
    async request(method: string, payload: unknown = {}): Promise<unknown> {
      const encoded = safe(payload);
      const id = ++next;
      frames.push({ kind: 'request', id, method, payload: encoded });
      pending++;
      try {
        const result = await engine.request(method, payload);
        frames.push({ kind: 'answer', id, result: safe(result) });
        return result;
      } catch (error) {
        open();
        const failure = error as { code?: unknown; message?: unknown; reason?: unknown; owner?: unknown };
        const kept = { code: typeof failure.code === 'string' ? failure.code : 'REQUEST_FAILED', message: typeof failure.message === 'string' ? failure.message : String(error), ...(typeof failure.reason === 'string' ? { reason: failure.reason } : {}), ...(typeof failure.owner === 'boolean' ? { owner: failure.owner } : {}) };
        frames.push({ kind: 'error', id, error: safe(kept) as typeof kept });
        throw error;
      } finally { pending--; }
    },
    finish,
    async write(file: string) { await writeFile(file, `${JSON.stringify(finish(), null, 2)}\n`, { encoding: 'utf8', flag: 'wx' }); },
    close() { if (!closed) { closed = true; unsubscribe(); } },
  };
}
