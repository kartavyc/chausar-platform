// Chausar venture launcher, package P2 (models): the real transport. HTTPS through fetch, and command-line
// tools through the trusted host's process port (the reviewed Codex host re-checks its executable's SHA256
// before each run) or the gateway's defaultProcess. The request's purpose field is never sent anywhere.
// The retry policy for every call that leaves this computer lives here too (Ink v2 wave 1, H15): only a 429 is asked
// again, after its Retry-After clamped to 30 seconds, and a read after a transport error. A create or a send that fails
// in a way that may have reached the other side is outcome unknown and never asked again. One deadline per call, never
// reset. A status code the policy does not know fails closed. A model call is a send: it runs and is paid for once.
// Asking again by status class, with Retry-After clamped and no retry of an ambiguous create, follows
// marselsel/Lexware-MCP-Server (MIT, src/lexware/client.ts); this is a rewrite, not a copy.
import { tmpdir } from 'node:os';
import { check, ChausarError } from '../../contracts.ts';
import { defaultProcess, type ProcessRequest, type ProcessResult } from '../../gateway.ts';
import type { ModelHttpRequest, ModelHttpResponse, ModelProcessRequest, ModelProcessResponse, ModelTransport } from '../contracts.ts';
import { RESPONSE_LIMIT_BYTES } from './types.ts';

// ---------------------------------------------------------------------------
// The retry policy
// ---------------------------------------------------------------------------

/** What a call does on the other side: a read changes nothing; a create or a send leaves something that may stay. */
export type CallEffect = 'read' | 'create' | 'send';
/**
 * How one try ended. 'not-connected': the other side was never reached, so nothing was sent. 'timed-out' and 'broken':
 * no full answer came, and the request may have arrived.
 */
export type AttemptResult<T> =
  | { kind: 'answer'; status: number; retryAfter?: string | null; value: T }
  | { kind: 'not-connected' }
  | { kind: 'timed-out' }
  | { kind: 'broken' };
export type RetryCause = 'status' | 'busy' | 'not-connected' | 'timed-out' | 'broken';
/** 'failed': known to have done nothing, or a read. 'unknown': a create or a send that may have happened; check before trying again. */
export type RetryResult<T> =
  | { outcome: 'done'; value: T; status: number; attempts: number }
  | { outcome: 'failed' | 'unknown'; cause: RetryCause; status: number | null; value: T | null; attempts: number };

export const RETRY_MAX_ATTEMPTS = 3;
export const RETRY_AFTER_CAP_MS = 30_000;
/** The wait when a 429 names none, or names one Chausar cannot read. */
export const RETRY_DEFAULT_WAIT_MS = 1_000;
/** A read after a transport error waits this long times the try number. */
const READ_RETRY_WAIT_MS = 500;

/** Refusals a service names on purpose: the request was understood and nothing was done. */
const KNOWN_REFUSALS: ReadonlySet<number> = new Set([400, 401, 402, 403, 404, 405, 406, 409, 410, 411, 412, 413, 414, 415, 416, 417, 422, 423, 424, 426, 428, 431, 451]);
/** A conflict or a failed dependency on a create or a send may mean an earlier try, or part of this one, went through. */
const UNCLEAR_WHEN_LEAVING: ReadonlySet<number> = new Set([409, 424]);
export type StatusClass = 'ok' | 'busy' | 'refused' | 'unclear';

/**
 * 2xx is ok, 429 is busy, a named refusal is refused; anything else (5xx, 408, 3xx, codes nobody named) is unclear.
 * For a create or a send, 409 and 424 are unclear too.
 */
export function statusClass(status: unknown, effect: CallEffect = 'read'): StatusClass {
  if (typeof status !== 'number' || !Number.isInteger(status)) return 'unclear';
  if (status >= 200 && status <= 299) return 'ok';
  if (status === 429) return 'busy';
  if (effect !== 'read' && UNCLEAR_WHEN_LEAVING.has(status)) return 'unclear';
  return KNOWN_REFUSALS.has(status) ? 'refused' : 'unclear';
}

/** Retry-After in whole seconds or as an HTTP date, read against the clock, never below 0 or above 30 seconds. */
export function retryAfterMs(header: string | null | undefined, nowMs: number): number {
  const text = typeof header === 'string' ? header.trim() : '';
  let wait = RETRY_DEFAULT_WAIT_MS;
  if (/^\d{1,10}$/.test(text)) wait = Number(text) * 1000;
  else if (/[A-Za-z]/.test(text) && Number.isFinite(Date.parse(text))) wait = Date.parse(text) - nowMs;
  return Math.min(RETRY_AFTER_CAP_MS, Math.max(0, wait));
}

/** One deadline for a whole call. fits: whether work of this length can still finish before it ends. */
export type Deadline = { remaining(): number; fits(ms: number): boolean };
export function startDeadline(totalMs: number, now: () => number = Date.now): Deadline {
  check(Number.isInteger(totalMs) && totalMs > 0, 'INVALID_VENTURE_REQUEST', 'A deadline must be a whole number of milliseconds above 0.');
  const ends = now() + totalMs;
  return { remaining: () => Math.max(0, ends - now()), fits: ms => ms <= ends - now() };
}

/**
 * Runs one call under the policy. Each try is given what is left of the one deadline as its timeout. A 429 waits for
 * its Retry-After and asks again while tries and time remain; for a create or a send, only while the wait plus half the
 * first deadline still fit, so a late try never goes out with too little time to finish. A read asks again after a
 * transport error; nothing else is asked again. A try that throws stops the call with its own error.
 */
export async function callWithRetry<T>(
  spec: { effect: CallEffect; deadlineMs: number; maxAttempts?: number; now?: () => number; sleep?: (ms: number) => Promise<void> },
  attempt: (timeoutMs: number) => Promise<AttemptResult<T>>,
): Promise<RetryResult<T>> {
  const now = spec.now ?? Date.now;
  const sleep = spec.sleep ?? ((ms: number) => new Promise<void>(resolve => { setTimeout(resolve, ms); }));
  const maxAttempts = spec.maxAttempts ?? RETRY_MAX_ATTEMPTS;
  const deadline = startDeadline(spec.deadlineMs, now);
  const leaves = spec.effect !== 'read';
  // The least time a try that leaves this computer must still have: half the first deadline.
  const minimumTry = leaves ? Math.ceil(spec.deadlineMs / 2) : 0;
  for (let attempts = 1; ; attempts += 1) {
    const result = await attempt(Math.max(1, deadline.remaining()));
    const another = async (wait: number) => {
      if (attempts >= maxAttempts || wait >= deadline.remaining() || !deadline.fits(wait + minimumTry)) return false;
      await sleep(wait);
      return true;
    };
    if (result.kind === 'answer') {
      const kind = statusClass(result.status, spec.effect);
      if (kind === 'ok') return { outcome: 'done', value: result.value, status: result.status, attempts };
      // A 429 says nothing was done, so asking again is safe for any call.
      if (kind === 'busy') {
        if (await another(retryAfterMs(result.retryAfter, now()))) continue;
        return { outcome: 'failed', cause: 'busy', status: result.status, value: result.value, attempts };
      }
      const outcome = kind === 'refused' || !leaves ? 'failed' : 'unknown';
      return { outcome, cause: 'status', status: result.status, value: result.value, attempts };
    }
    if (!leaves) {
      if (await another(READ_RETRY_WAIT_MS * attempts)) continue;
      return { outcome: 'failed', cause: result.kind, status: null, value: null, attempts };
    }
    return { outcome: result.kind === 'not-connected' ? 'failed' : 'unknown', cause: result.kind, status: null, value: null, attempts };
  }
}

/** Node's network error codes that mean the connection was never made, so nothing was sent. They are not Chausar codes. */
const NOT_CONNECTED: ReadonlySet<string> = new Set('ECONNREFUSED ENOTFOUND EAI_AGAIN EHOSTUNREACH ENETUNREACH UND_ERR_CONNECT_TIMEOUT'.split(' '));

/** How a failed fetch ended: timed out, never connected, or broken part way (anything Chausar cannot place). */
export function fetchFailure(error: unknown): 'not-connected' | 'timed-out' | 'broken' {
  const name = error && typeof error === 'object' ? String((error as { name?: unknown }).name ?? '') : '';
  if (name === 'TimeoutError' || name === 'AbortError') return 'timed-out';
  const cause = error && typeof error === 'object' ? (error as { cause?: { code?: unknown; errors?: unknown } }).cause : undefined;
  const nested = Array.isArray(cause?.errors) ? cause.errors.map(item => (item as { code?: unknown } | null)?.code) : [];
  const codes = [cause?.code, ...nested].filter((item): item is string => typeof item === 'string');
  return codes.length > 0 && codes.every(item => NOT_CONNECTED.has(item)) ? 'not-connected' : 'broken';
}

// ---------------------------------------------------------------------------
// The model transport
// ---------------------------------------------------------------------------

/** The body as text, or null when it is longer than Chausar reads (declared or counted); reading stops there. */
async function readCapped(response: Response): Promise<string | null> {
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > RESPONSE_LIMIT_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > RESPONSE_LIMIT_BYTES) {
          await reader.cancel().catch(() => undefined);
          return null;
        }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * One POST to a model provider under the policy, as a send. The request has reached the provider once an answer
 * comes, so a redirect is never followed and goes through statusClass like any other status. A refusal or a 429 that
 * never cleared comes back for the parser to word; an answer too big to read is unknown unless its status says nothing was done.
 */
async function postModel(request: ModelHttpRequest): Promise<ModelHttpResponse> {
  const result = await callWithRetry<ModelHttpResponse>({ effect: 'send', deadlineMs: request.timeoutMs }, async timeoutMs => {
    try {
      const response = await fetch(request.url, { method: 'POST', headers: request.headers, body: request.body, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
      const status = response.status;
      const body = await readCapped(response);
      const kind = statusClass(status, 'send');
      if (body === null && kind !== 'refused' && kind !== 'busy') {
        throw new ChausarError('MODEL_OUTCOME_UNKNOWN', `The model provider answered (HTTP ${status}) with more than Chausar reads. It may have run and charged for it. Chausar did not retry it.`);
      }
      return { kind: 'answer', status, retryAfter: response.headers.get('retry-after'), value: { status, body: body ?? '' } };
    } catch (error) {
      if (error instanceof ChausarError) throw error;
      return { kind: fetchFailure(error) };
    }
  });
  if (result.outcome === 'done') return result.value;
  if (result.outcome === 'failed' && result.value) return result.value;
  if (result.cause === 'timed-out') throw new ChausarError('MODEL_TIMEOUT', 'The model did not answer in time. Chausar did not retry it.');
  // The retry class rides on the error (Ink v2 wave 4, 4F2), so the owner reads "offline" from the class, not the words.
  if (result.cause === 'not-connected') throw Object.assign(new ChausarError('MODEL_FAILED', 'Chausar could not reach the model provider. Nothing was sent.'), { details: { cause: 'not-connected' } });
  if (result.cause === 'status') {
    throw new ChausarError('MODEL_OUTCOME_UNKNOWN', `The model provider answered with HTTP ${result.status}, which does not say whether it ran the request. It may have charged for it. Chausar did not retry it or follow it anywhere.`);
  }
  throw new ChausarError('MODEL_OUTCOME_UNKNOWN', 'The connection to the model provider broke part way. It may have run and charged for it. Chausar did not retry it.');
}

export function defaultModelTransport(options: { hostProcess?: (request: any) => Promise<any> } = {}): ModelTransport {
  const processPort: (request: ProcessRequest) => Promise<ProcessResult> = options.hostProcess ?? defaultProcess;
  return {
    replay: false,
    http: postModel,
    async process(request: ModelProcessRequest): Promise<ModelProcessResponse> {
      // A model call runs in the empty folder made for it (4H1, H39), and a look's checks in the empty folder made for
      // that look (cli-status.ts); the temp folder is only the fallback for a request that names none.
      return processPort({ command: request.command, args: request.args, cwd: request.cwd ?? tmpdir(), env: request.env, stdin: request.stdin, timeoutMs: request.timeoutMs, schema: null });
    },
  };
}
