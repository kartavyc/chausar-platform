/**
 * The Ink app's side of a mini app's bridge (wave 6 package 6H1, D39), in the MCP Apps message format (SEP-1865,
 * io.modelcontextprotocol/ui, stable 2026-01-26): JSON-RPC 2.0 over postMessage between this window (the host) and the
 * app's sandboxed frame (the view). The frame first runs the static sandbox proxy (public/mini-frame.html), which says
 * ui/notifications/sandbox-proxy-ready; the host answers once with ui/notifications/sandbox-resource-ready and the app
 * document, which the proxy writes into itself. The app's bridge then asks ui/initialize, says
 * ui/notifications/initialized, and from then on may ask tools/call for the tools the owner allowed. Each call goes to
 * the engine (venture.apps.call), which checks the grant again; a refusal reaches the app as a tool error in the
 * engine's words. Only messages whose source is this frame's own window count. Links, messages to the model, model
 * context and resources are not offered: an app has no internet and no way to talk to the AI. A second proxy start
 * (the frame went somewhere else) closes the bridge.
 */

import { APP_PROTOCOL_VERSION } from '../../../../../platform/runtime/venture/apps/frame';

export interface BridgeOptions {
  frame: HTMLIFrameElement;
  /** The app document (apps/frame.ts appDocument) the proxy writes into the frame. */
  document: string;
  /** The tools that answer now (venture.apps.get tools). */
  tools: readonly string[];
  /** One tools/call, to the engine. */
  call(tool: string, args: Record<string, unknown>): Promise<{ content: { type: 'text'; text: string }[]; structuredContent: unknown; isError: false }>;
  theme(): 'light' | 'dark';
  /** One-shot A1 (row 12): the colours Chausar shows now, as the frame's variables (frameVariables). */
  styles?(): Record<string, string>;
  onSize?(height: number): void;
  /** The bridge closed itself, with why. */
  onClosed?(reason: 'moved'): void;
}

/**
 * One-shot A1 (row 12): the frame's colour variables (platform/runtime/venture/apps/frame.ts FRAME_VARIABLES) from the
 * Ink tokens Chausar shows now: the frame sits on --surface, so that is the app's --bg. Only plain hex colours go.
 */
export const FRAME_TOKENS: Readonly<Record<string, string>> = Object.freeze({ '--bg': '--surface', '--fg': '--fg', '--mute': '--mute', '--line': '--line', '--link': '--link' });

/** The variables for the frame, read through read(token) (getComputedStyle in the app, the token table in tests). */
export function frameVariables(read: (token: string) => string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, token] of Object.entries(FRAME_TOKENS)) {
    const value = read(token).trim().toLowerCase();
    if (/^#[0-9a-f]{3,8}$/.test(value)) out[name] = value;
  }
  return out;
}

/** The largest message the host reads, as JSON text. */
export const BRIDGE_MESSAGE_MAX = 65_536;
/** At most this many tool calls wait at once. */
export const BRIDGE_IN_FLIGHT = 8;
export const FRAME_MIN = 1;
export const FRAME_MAX = 1600;
const NOT_ALLOWED = 'This app is not allowed to do that. You can change what it may do in Apps.';

type Message = { jsonrpc: '2.0'; id?: string | number | null; method?: string; params?: unknown };

function readMessage(data: unknown): Message | null {
  if (!data || typeof data !== 'object' || Array.isArray(data) || (data as { jsonrpc?: unknown }).jsonrpc !== '2.0') return null;
  let size = 0;
  try { size = JSON.stringify(data).length; } catch { return null; }
  if (size > BRIDGE_MESSAGE_MAX) return null;
  const message = data as Message;
  if (message.method !== undefined && typeof message.method !== 'string') return null;
  if (message.id !== undefined && message.id !== null && typeof message.id !== 'string' && typeof message.id !== 'number') return null;
  return message;
}

/** What openBridge returns: close, which stops listening (nothing reaches the engine after it), and themeChanged. */
export type Bridge = (() => void) & { themeChanged(): void };

/**
 * Opens the bridge for one frame. themeChanged (one-shot A1, row 12) tells a running app the theme and colours Chausar
 * shows now (MCP Apps ui/notifications/host-context-changed).
 */
export function openBridge(options: BridgeOptions): Bridge {
  const host = options.frame.ownerDocument.defaultView ?? window;
  let phase: 'proxy' | 'written' | 'initialized' | 'ready' | 'closed' = 'proxy';
  let inFlight = 0;
  const target = () => options.frame.contentWindow;
  const post = (message: unknown) => { if (phase !== 'closed') target()?.postMessage(message, '*'); };
  const reply = (id: string | number, result: unknown) => post({ jsonrpc: '2.0', id, result });
  const fail = (id: string | number, code: number, message: string) => post({ jsonrpc: '2.0', id, error: { code, message } });
  const toolError = (id: string | number, text: string) => reply(id, { content: [{ type: 'text', text }], isError: true });

  async function toolsCall(id: string | number, params: unknown) {
    const body = (params && typeof params === 'object' ? params : {}) as { name?: unknown; arguments?: unknown };
    const name = typeof body.name === 'string' ? body.name : '';
    const args = body.arguments === undefined ? {} : body.arguments;
    if (!args || typeof args !== 'object' || Array.isArray(args)) { fail(id, -32602, 'Send arguments as an object.'); return; }
    if (!options.tools.includes(name)) { toolError(id, NOT_ALLOWED); return; }
    if (inFlight >= BRIDGE_IN_FLIGHT) { toolError(id, 'Too many requests at once. Try again.'); return; }
    inFlight += 1;
    try {
      const answer = await options.call(name, args as Record<string, unknown>);
      if (phase === 'ready') reply(id, { content: answer.content, structuredContent: answer.structuredContent, isError: false });
    } catch (error) {
      if (phase === 'ready') toolError(id, error instanceof Error ? error.message : String(error));
    } finally {
      inFlight -= 1;
    }
  }

  function onMessage(event: MessageEvent) {
    if (phase === 'closed' || !target() || event.source !== target()) return;
    const message = readMessage(event.data);
    if (!message || !message.method) return;
    const { method, id } = message;
    const request = id !== undefined && id !== null;
    if (method === 'ui/notifications/sandbox-proxy-ready') {
      if (phase !== 'proxy') { phase = 'closed'; options.onClosed?.('moved'); return; }
      phase = 'written';
      post({ jsonrpc: '2.0', method: 'ui/notifications/sandbox-resource-ready', params: { html: options.document } });
      return;
    }
    if (!request) {
      if (method === 'ui/notifications/initialized' && phase === 'initialized') phase = 'ready';
      else if (method === 'ui/notifications/size-changed') {
        const height = Number((message.params as { height?: unknown } | undefined)?.height);
        if (Number.isFinite(height)) options.onSize?.(Math.min(FRAME_MAX, Math.max(FRAME_MIN, Math.round(height))));
      }
      return;
    }
    switch (method) {
      case 'ui/initialize':
        if (phase !== 'written') { fail(id, -32600, 'The app is initialized already.'); return; }
        phase = 'initialized';
        {
          const variables = options.styles?.() ?? {};
          reply(id, {
            protocolVersion: APP_PROTOCOL_VERSION,
            hostInfo: { name: 'Chausar', version: '1' },
            hostCapabilities: { serverTools: {} },
            hostContext: {
              theme: options.theme(), displayMode: 'inline', availableDisplayModes: ['inline'], locale: 'en-IN', platform: 'desktop',
              ...(Object.keys(variables).length ? { styles: { variables } } : {}),
            },
          });
        }
        return;
      case 'ping':
        reply(id, {});
        return;
      case 'tools/call':
        if (phase !== 'ready') { fail(id, -32002, 'The app is not initialized yet.'); return; }
        void toolsCall(id, message.params);
        return;
      default:
        fail(id, -32601, 'Chausar does not offer that to apps.');
    }
  }

  host.addEventListener('message', onMessage);
  const close = () => {
    phase = 'closed';
    host.removeEventListener('message', onMessage);
  };
  return Object.assign(close, {
    themeChanged() {
      if (phase !== 'ready') return;
      const variables = options.styles?.() ?? {};
      post({ jsonrpc: '2.0', method: 'ui/notifications/host-context-changed', params: { theme: options.theme(), ...(Object.keys(variables).length ? { styles: { variables } } : {}) } });
    },
  });
}
