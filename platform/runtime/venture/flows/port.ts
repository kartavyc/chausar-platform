import { DIGEST_PATTERN } from '../../../shared/digest.ts';
// Chausar venture launcher, recorded flows (wave 6, package 6H2; DECISIONS D41): the engine worker's side of the
// desktop's flow window. It sends { kind: 'host-flows', callId, runId, op, payload } and waits for { kind:
// 'host-flows-result', callId, ok, result | code } (engine-harness.cjs passes it to app/desktop/flow-browser.cjs).
// Every answer is checked here before the engine uses it; one it cannot read is a closed window (FLOW_BROWSER_CLOSED),
// never a guess. A recorded event comes from a web page's controls, so each is rebuilt field by field from plain
// strings and an event it cannot read is dropped. Only the desktop host composes this port (worker.ts).
import { randomUUID } from 'node:crypto';
import { ChausarError } from '../../contracts.ts';
import type { FlowCandidate, RecordedControl, RecordedEvent } from './recipe.ts';
import type { FlowBrowserPort, FlowControlOption, FlowFind, FlowPageFacts } from './replay.ts';

type FlowChannel = {
  connected?: boolean;
  send?: (message: unknown, callback?: (error: Error | null) => void) => boolean;
  on(event: 'message', listener: (message: unknown) => void): unknown;
};
type Reply = { ok: true; result: unknown } | { ok: false; code: string };

/** How long one step may take, and how long the owner may take to record. */
const STEP_MS = 60_000;
const RECORD_MS = 31 * 60_000;
const CODES = new Set(['FLOW_HELD', 'FLOW_CHANGED', 'FLOW_INVALID', 'FLOW_BROWSER_CLOSED']);
const KINDS = new Set(['id', 'name', 'test-id', 'aria-label', 'label']);
const closed = () => new ChausarError('FLOW_BROWSER_CLOSED', 'The Chausar flow window closed or did not answer.');

const str = (value: unknown, max: number): string | null => (typeof value === 'string' && value.length <= max ? value : null);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const hex = (value: unknown) => typeof value === 'string' && DIGEST_PATTERN.test(value);

function candidatesOf(value: unknown): FlowCandidate[] | null {
  if (!Array.isArray(value) || value.length > 6) return null;
  const out: FlowCandidate[] = [];
  for (const item of value) {
    if (!object(item) || !KINDS.has(item.kind as string) || !str(item.value, 200)) return null;
    out.push({ kind: item.kind as FlowCandidate['kind'], value: item.value as string });
  }
  return out;
}
function controlOf(value: unknown): RecordedControl | null {
  if (!object(value)) return null;
  const tag = str(value.tag, 40), text = str(value.text ?? '', 200), candidates = candidatesOf(value.candidates);
  const nullable = (key: string, max: number) => (value[key] === null || value[key] === undefined ? null : str(value[key], max));
  const fields = { type: nullable('type', 40), name: nullable('name', 200), id: nullable('id', 200), testId: nullable('testId', 200), ariaLabel: nullable('ariaLabel', 200), labelText: nullable('labelText', 200), autocomplete: nullable('autocomplete', 200), role: nullable('role', 40), formAction: nullable('formAction', 2048), href: nullable('href', 2048) };
  const bad = (key: keyof typeof fields) => value[key] !== null && value[key] !== undefined && fields[key] === null;
  if (!tag || text === null || !candidates || typeof value.inForm !== 'boolean' || !hex(value.fingerprint) || (Object.keys(fields) as (keyof typeof fields)[]).some(bad)) return null;
  return { tag, text, candidates, inForm: value.inForm, fingerprint: value.fingerprint as string, ...fields };
}
function eventsOf(value: unknown): RecordedEvent[] {
  if (!object(value) || !Array.isArray(value.events)) throw closed();
  const out: RecordedEvent[] = [];
  for (const item of value.events.slice(0, 500)) {
    if (!object(item)) continue;
    if (item.kind === 'open') { const url = str(item.url, 2048); if (url) out.push({ kind: 'open', url }); continue; }
    const control = controlOf(item.control);
    if (!control) continue;
    if (item.kind === 'input') out.push({ kind: 'input', control, value: item.value === null ? null : str(item.value, 2000) });
    else if (item.kind === 'click' || item.kind === 'submit') out.push({ kind: item.kind, control });
  }
  return out;
}
function factsOf(value: unknown): FlowPageFacts {
  if (!object(value) || !str(value.url, 4096) || str(value.title, 400) === null || typeof value.captcha !== 'boolean') throw closed();
  return { url: value.url as string, title: value.title as string, captcha: value.captcha };
}
function findOf(value: unknown): FlowFind {
  if (!object(value) || !Number.isInteger(value.count) || (value.count as number) < 0 || !(value.fingerprint === null || hex(value.fingerprint))
    || typeof value.submitLike !== 'boolean' || typeof value.secret !== 'boolean' || typeof value.filled !== 'boolean') throw closed();
  return { count: value.count as number, fingerprint: value.fingerprint as string | null, submitLike: value.submitLike, secret: value.secret, filled: value.filled };
}
function optionsOf(value: unknown): FlowControlOption[] {
  if (!Array.isArray(value)) throw closed();
  return value.slice(0, 40).flatMap(item => {
    const candidates = object(item) ? candidatesOf(item.candidates) : null;
    const label = object(item) ? str(item.label, 120) : null;
    return candidates && candidates.length && label && hex(item.fingerprint) ? [{ label, candidates, fingerprint: item.fingerprint as string }] : [];
  });
}

export function processFlowPort(channel: FlowChannel, options: { stepMs?: number; recordMs?: number } = {}): FlowBrowserPort {
  const waiting = new Map<string, (reply: Reply | null) => void>();
  let listening = false;
  const onMessage = (message: unknown) => {
    if (!object(message) || message.kind !== 'host-flows-result' || typeof message.callId !== 'string') return;
    const settle = waiting.get(message.callId);
    if (!settle) return;
    waiting.delete(message.callId);
    settle(message.ok === true ? { ok: true, result: message.result } : { ok: false, code: typeof message.code === 'string' ? message.code : 'FLOW_BROWSER_CLOSED' });
  };
  function ask(runId: string, op: string, payload: Record<string, unknown>, limit: number): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!channel.connected || typeof channel.send !== 'function') { reject(closed()); return; }
      if (!listening) { channel.on('message', onMessage); listening = true; }
      const callId = randomUUID();
      const timer = setTimeout(() => { if (waiting.delete(callId)) reject(closed()); }, limit);
      timer.unref?.();
      waiting.set(callId, reply => {
        clearTimeout(timer);
        if (!reply) reject(closed());
        else if (reply.ok) resolve(reply.result);
        else reject(CODES.has(reply.code) ? new ChausarError(reply.code, 'The flow window refused this step.') : closed());
      });
      const fail = () => { if (waiting.delete(callId)) { clearTimeout(timer); reject(closed()); } };
      try { channel.send({ kind: 'host-flows', callId, runId, op, payload }, error => { if (error) fail(); }); } catch { fail(); }
    });
  }
  const step = options.stepMs ?? STEP_MS;
  return {
    async record(runId, url) { return { events: eventsOf(await ask(runId, 'record', { url }, options.recordMs ?? RECORD_MS)) }; },
    async open(runId, url) { return factsOf(await ask(runId, 'open', { url }, step)); },
    async find(runId, target) { return findOf(await ask(runId, 'find', { target }, step)); },
    async fill(runId, target, control, value) {
      const result = await ask(runId, 'fill', { target, control, value }, step);
      if (!object(result) || !(result.shown === null || typeof result.shown === 'string')) throw closed();
      return { shown: result.shown as string | null };
    },
    async click(runId, target, approved) {
      const result = await ask(runId, 'click', { target, approved }, step);
      if (!object(result) || typeof result.answered !== 'boolean') throw closed();
      return { facts: factsOf(result.facts), answered: result.answered, blocked: result.blocked === true };
    },
    async facts(runId) { return factsOf(await ask(runId, 'facts', {}, step)); },
    async controls(runId) { return optionsOf(await ask(runId, 'controls', {}, step)); },
    async close(runId) { await ask(runId ?? 'all', 'close', {}, step).catch(() => undefined); },
  };
}
