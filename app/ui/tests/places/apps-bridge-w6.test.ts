import { afterEach, describe, expect, it, vi } from 'vitest';
import { frameVariables, openBridge, type BridgeOptions } from '../../src/places/apps/bridge';
import { chausarTheme } from '../../src/places/apps/MiniAppFrame';
import { APP_PROTOCOL_VERSION } from '../../../../platform/runtime/venture/apps/frame';

// Wave 6 package 6H1 (D39): the Ink app's side of the MCP Apps bridge. It answers only the frame it opened (by the
// message's source window), hands the sandbox proxy the app document once, answers ui/initialize, and relays a
// tools/call to the engine only after the app said it was initialized and only for a tool the owner allowed. Anything
// else the MCP Apps spec lets a view ask (links, messages to the model, model context) is not offered: no internet.

const frames: HTMLIFrameElement[] = [];
function setUp(overrides: Partial<BridgeOptions> = {}) {
  const frame = document.createElement('iframe');
  document.body.appendChild(frame);
  frames.push(frame);
  const win = frame.contentWindow!;
  const posted: unknown[] = [];
  vi.spyOn(win, 'postMessage').mockImplementation(((message: unknown) => { posted.push(message); }) as typeof win.postMessage);
  const call = vi.fn(async (tool: string) => ({ content: [{ type: 'text' as const, text: '{}' }], structuredContent: { tool }, isError: false as const }));
  const onSize = vi.fn(), onClosed = vi.fn();
  const close = openBridge({ frame, document: '<!doctype html><p>app</p>', tools: ['clients_list'], call, theme: () => 'dark', onSize, onClosed, ...overrides });
  const send = (data: unknown, source: Window | null = win) => window.dispatchEvent(new MessageEvent('message', { data, source }));
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  async function ready() {
    send({ jsonrpc: '2.0', method: 'ui/notifications/sandbox-proxy-ready', params: {} });
    send({ jsonrpc: '2.0', id: 1, method: 'ui/initialize', params: { protocolVersion: APP_PROTOCOL_VERSION, appCapabilities: {}, clientInfo: { name: 'x', version: '1' } } });
    send({ jsonrpc: '2.0', method: 'ui/notifications/initialized', params: {} });
    await flush();
  }
  return { frame, win, posted, call, onSize, onClosed, close, send, flush, ready };
}

afterEach(() => { for (const frame of frames.splice(0)) frame.remove(); vi.restoreAllMocks(); });

describe('the mini app bridge (6H1)', () => {
  it('hands the proxy the app document once, and only to its own frame', async () => {
    const t = setUp();
    t.send({ jsonrpc: '2.0', method: 'ui/notifications/sandbox-proxy-ready', params: {} }, window);
    expect(t.posted).toEqual([]);
    t.send({ jsonrpc: '2.0', method: 'ui/notifications/sandbox-proxy-ready', params: {} });
    expect(t.posted).toEqual([{ jsonrpc: '2.0', method: 'ui/notifications/sandbox-resource-ready', params: { html: '<!doctype html><p>app</p>' } }]);
    t.close();
  });

  it('answers ui/initialize with the protocol, the host and the theme', async () => {
    const t = setUp();
    await t.ready();
    const answer = t.posted.find((item) => (item as { id?: number }).id === 1) as { result: Record<string, any> };
    expect(answer.result.protocolVersion).toBe(APP_PROTOCOL_VERSION);
    expect(answer.result.hostInfo.name).toBe('Chausar');
    expect(answer.result.hostCapabilities).toEqual({ serverTools: {} });
    expect(answer.result.hostContext).toMatchObject({ theme: 'dark', displayMode: 'inline', platform: 'desktop' });
    t.close();
  });

  it('one-shot A1 row 12: sends the colours Chausar shows with the theme, and only the frame variables', async () => {
    const tokens: Record<string, string> = { '--surface': '#17181a', '--fg': '#eceef0', '--mute': '#9aa0a6', '--line': '#2a2d31', '--link': '#8fb4ff' };
    expect(frameVariables((name) => tokens[name] ?? '')).toEqual({ '--bg': '#17181a', '--fg': '#eceef0', '--mute': '#9aa0a6', '--line': '#2a2d31', '--link': '#8fb4ff' });
    expect(frameVariables((name) => (name === '--fg' ? ' #ECEEF0 ' : name === '--mute' ? 'rgb(1 2 3)' : ''))).toEqual({ '--fg': '#eceef0' });
    const t = setUp({ styles: () => ({ '--bg': '#17181a', '--fg': '#eceef0' }) });
    await t.ready();
    const answer = t.posted.find((item) => (item as { id?: number }).id === 1) as { result: Record<string, any> };
    expect(answer.result.hostContext.styles).toEqual({ variables: { '--bg': '#17181a', '--fg': '#eceef0' } });
    t.close.themeChanged();
    expect(t.posted.at(-1)).toEqual({ jsonrpc: '2.0', method: 'ui/notifications/host-context-changed', params: { theme: 'dark', styles: { variables: { '--bg': '#17181a', '--fg': '#eceef0' } } } });
    t.close();
    const count = t.posted.length;
    t.close.themeChanged();
    expect(t.posted.length).toBe(count);
  });

  it('one-shot A1 row 12: the theme is the one Chausar shows, even when the computer says otherwise', () => {
    const root = document.documentElement;
    const before = root.getAttribute('data-theme');
    const media = vi.spyOn(window, 'matchMedia').mockImplementation(((query: string) => ({ matches: query.includes('dark'), media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia);
    root.setAttribute('data-theme', 'light');
    expect(chausarTheme()).toBe('light');
    root.removeAttribute('data-theme');
    expect(chausarTheme()).toBe('dark');
    media.mockRestore();
    if (before !== null) root.setAttribute('data-theme', before);
  });

  it('relays an allowed tools/call after initialized; refuses others as tool errors without asking the engine', async () => {
    const t = setUp();
    t.send({ jsonrpc: '2.0', method: 'ui/notifications/sandbox-proxy-ready', params: {} });
    t.send({ jsonrpc: '2.0', id: 1, method: 'ui/initialize', params: {} });
    t.send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'clients_list', arguments: {} } });
    await t.flush();
    expect((t.posted.find((item) => (item as { id?: number }).id === 2) as { error: { code: number } }).error.code).toBe(-32002);
    t.send({ jsonrpc: '2.0', method: 'ui/notifications/initialized', params: {} });
    t.send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'clients_list', arguments: { a: 1 } } });
    t.send({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'orders_list', arguments: {} } });
    await t.flush();
    expect(t.call).toHaveBeenCalledTimes(1);
    expect(t.call).toHaveBeenCalledWith('clients_list', { a: 1 });
    expect(t.posted.find((item) => (item as { id?: number }).id === 3)).toEqual({ jsonrpc: '2.0', id: 3, result: { content: [{ type: 'text', text: '{}' }], structuredContent: { tool: 'clients_list' }, isError: false } });
    const refused = t.posted.find((item) => (item as { id?: number }).id === 4) as { result: { isError: boolean; content: { text: string }[] } };
    expect(refused.result.isError).toBe(true);
    expect(refused.result.content[0]!.text).toMatch(/not allowed/);
    t.close();
  });

  it('an engine refusal reaches the app as a tool error in the engine words', async () => {
    const t = setUp({ call: vi.fn(async () => { throw Object.assign(new Error('Allow this app first.'), { code: 'APP_NOT_ALLOWED' }); }) });
    await t.ready();
    t.send({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'clients_list', arguments: {} } });
    await t.flush();
    expect(t.posted.find((item) => (item as { id?: number }).id === 5)).toEqual({ jsonrpc: '2.0', id: 5, result: { content: [{ type: 'text', text: 'Allow this app first.' }], isError: true } });
    t.close();
  });

  it('offers no links, model messages or other requests; sizes are kept in bounds', async () => {
    const t = setUp();
    await t.ready();
    for (const [id, method] of [[6, 'ui/open-link'], [7, 'ui/message'], [8, 'ui/update-model-context'], [9, 'resources/read']] as const) t.send({ jsonrpc: '2.0', id, method, params: {} });
    t.send({ jsonrpc: '2.0', id: 10, method: 'ping' });
    await t.flush();
    for (const id of [6, 7, 8, 9]) expect((t.posted.find((item) => (item as { id?: number }).id === id) as { error: { code: number } }).error.code).toBe(-32601);
    expect(t.posted.find((item) => (item as { id?: number }).id === 10)).toEqual({ jsonrpc: '2.0', id: 10, result: {} });
    t.send({ jsonrpc: '2.0', method: 'ui/notifications/size-changed', params: { width: 300, height: 50 } });
    t.send({ jsonrpc: '2.0', method: 'ui/notifications/size-changed', params: { width: 300, height: 99999 } });
    t.send({ jsonrpc: '2.0', method: 'ui/notifications/size-changed', params: { width: 300, height: 480 } });
    expect(t.onSize.mock.calls.map((item) => item[0])).toEqual([160, 1600, 480]);
    t.close();
  });

  it('a second proxy start (the frame went somewhere else) closes the bridge; oversized and closed messages are ignored', async () => {
    const t = setUp();
    await t.ready();
    t.send({ jsonrpc: '2.0', id: 11, method: 'tools/call', params: { name: 'clients_list', arguments: { big: 'x'.repeat(70_000) } } });
    await t.flush();
    expect(t.call).not.toHaveBeenCalled();
    t.send({ jsonrpc: '2.0', method: 'ui/notifications/sandbox-proxy-ready', params: {} });
    expect(t.onClosed).toHaveBeenCalledTimes(1);
    t.send({ jsonrpc: '2.0', id: 12, method: 'tools/call', params: { name: 'clients_list', arguments: {} } });
    await t.flush();
    expect(t.call).not.toHaveBeenCalled();
    t.close();
    const count = t.posted.length;
    t.send({ jsonrpc: '2.0', id: 13, method: 'ping' });
    expect(t.posted.length).toBe(count);
  });
});
