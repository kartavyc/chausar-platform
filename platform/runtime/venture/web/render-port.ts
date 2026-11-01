// Chausar venture launcher, web (wave 6, 6F3): the engine worker's side of the desktop's hidden reading window. It
// sends { kind: 'host-render', renderId, url, timeoutMs, blockedHosts } and waits for { kind: 'host-render-result',
// renderId, ok, html, finalUrl | reason } (engine-harness.cjs passes it to app/desktop/web-render.cjs). No answer in
// time is a timeout; nothing is retried. Only the desktop host composes this port (worker.ts); elsewhere a page that
// needs JavaScript says so (web/reader.ts).
import { randomUUID } from 'node:crypto';
import { FETCH_POLICY_HOSTS } from '../build/fetch-policy-core.ts';
import type { PageRenderPort } from './reader.ts';

type RenderChannel = {
  connected?: boolean;
  send?: (message: unknown, callback?: (error: Error | null) => void) => boolean;
  on(event: 'message', listener: (message: unknown) => void): unknown;
};
type Result = Awaited<ReturnType<PageRenderPort['render']>>;
/** The most HTML taken back from the window, in characters. */
const MAX_HTML = 2 * 1024 * 1024;

export function processRenderPort(channel: RenderChannel, options: { timeoutMs?: number } = {}): PageRenderPort {
  const waiting = new Map<string, (result: Result) => void>();
  const onMessage = (message: unknown) => {
    const reply = message as { kind?: unknown; renderId?: unknown; ok?: unknown; html?: unknown; finalUrl?: unknown; reason?: unknown } | null;
    if (!reply || reply.kind !== 'host-render-result' || typeof reply.renderId !== 'string') return;
    const settle = waiting.get(reply.renderId);
    if (!settle) return;
    waiting.delete(reply.renderId);
    settle(reply.ok === true && typeof reply.html === 'string' && reply.html.length <= MAX_HTML && typeof reply.finalUrl === 'string'
      ? { ok: true, html: reply.html, finalUrl: reply.finalUrl }
      : { ok: false, reason: reply.reason === 'refused' ? 'refused' : 'failed' });
  };
  let listening = false;
  return {
    render(request) {
      return new Promise(resolve => {
        if (!channel.connected || typeof channel.send !== 'function') { resolve({ ok: false, reason: 'failed' }); return; }
        if (!listening) { channel.on('message', onMessage); listening = true; }
        const renderId = randomUUID();
        const limit = options.timeoutMs ?? request.timeoutMs + 5_000;
        const timer = setTimeout(() => { if (waiting.delete(renderId)) resolve({ ok: false, reason: 'timeout' }); }, limit);
        timer.unref?.();
        waiting.set(renderId, result => { clearTimeout(timer); resolve(result); });
        const fail = () => { if (waiting.delete(renderId)) { clearTimeout(timer); resolve({ ok: false, reason: 'failed' }); } };
        try {
          channel.send({ kind: 'host-render', renderId, url: request.url, timeoutMs: request.timeoutMs, blockedHosts: [...FETCH_POLICY_HOSTS] }, error => { if (error) fail(); });
        } catch { fail(); }
      });
    },
  };
}
