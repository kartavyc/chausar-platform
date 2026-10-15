// Chausar venture launcher, package P2 (models): the real transport. HTTPS through fetch, and command-line
// tools through the trusted host's process port (the reviewed Codex host re-checks its executable's SHA256
// before each run) or the gateway's defaultProcess. The request's purpose field is never sent anywhere.
import { tmpdir } from 'node:os';
import { ChausarError } from '../../contracts.ts';
import { defaultProcess, type ProcessRequest, type ProcessResult } from '../../gateway.ts';
import type { ModelHttpRequest, ModelHttpResponse, ModelProcessRequest, ModelProcessResponse, ModelTransport } from '../contracts.ts';
import { RESPONSE_LIMIT_BYTES } from './types.ts';

async function readCapped(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > RESPONSE_LIMIT_BYTES) throw new ChausarError('MODEL_FAILED', 'The model returned too much data.');
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > RESPONSE_LIMIT_BYTES) throw new ChausarError('MODEL_FAILED', 'The model returned too much data.');
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function defaultModelTransport(options: { hostProcess?: (request: any) => Promise<any> } = {}): ModelTransport {
  const processPort: (request: ProcessRequest) => Promise<ProcessResult> = options.hostProcess ?? defaultProcess;
  return {
    replay: false,
    async http(request: ModelHttpRequest): Promise<ModelHttpResponse> {
      try {
        const response = await fetch(request.url, { method: 'POST', headers: request.headers, body: request.body, redirect: 'error', signal: AbortSignal.timeout(request.timeoutMs) });
        if (response.status >= 300 && response.status < 400) throw new ChausarError('MODEL_FAILED', 'The model provider tried to redirect the request. Redirects are refused.');
        return { status: response.status, body: await readCapped(response) };
      } catch (error) {
        if (error instanceof ChausarError) throw error;
        const name = error && typeof error === 'object' ? String((error as { name?: unknown }).name ?? '') : '';
        if (name === 'TimeoutError' || name === 'AbortError') throw new ChausarError('MODEL_TIMEOUT', 'The model did not answer in time. Chausar did not retry it.');
        throw new ChausarError('MODEL_FAILED', 'Chausar could not reach the model provider. Nothing was retried.');
      }
    },
    async process(request: ModelProcessRequest): Promise<ModelProcessResponse> {
      return processPort({ command: request.command, args: request.args, cwd: tmpdir(), env: request.env, stdin: request.stdin, timeoutMs: request.timeoutMs, schema: null });
    },
  };
}
