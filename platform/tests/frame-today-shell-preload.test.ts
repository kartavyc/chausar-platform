import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { loadElectronPreloadFixture } from './fixtures/electron-context-bridge.ts';
import { createShellPort, externalUrl as rendererExternalUrl } from '../../app/ui/src/bridge/shell.ts';

// SH-10 and FR-04 across the actual preload, the actual main-side handlers (shell-ipc.cjs)
// and the actual host adapter. Electron, the system browser and the printer are synthetic.
const require = createRequire(import.meta.url);
const shellIpc = require('../../app/desktop/shell-ipc.cjs') as {
  OPEN_EXTERNAL_CHANNEL: string; PRINT_CHANNEL: string;
  externalUrl(input: unknown): string | null;
  registerShellHandlers(options: Record<string, unknown>): void;
};
const preloadPath = new URL('../../app/desktop/preload.cjs', import.meta.url);
const preloadSource = await readFile(preloadPath, 'utf8');

interface ShellApi {
  requestEnvelope(method: string, payload?: unknown): Promise<unknown>;
  openExternal(url: unknown): Promise<unknown>;
  print(kind: unknown): Promise<unknown>;
}

function chain(options: { open?: boolean } = {}) {
  const handlers = new Map<string, (event: unknown, value: unknown) => Promise<unknown>>();
  const opened: unknown[][] = [], printed: unknown[][] = [], channels: string[] = [];
  const mainFrame = { url: 'chausar://app/ui/index.html' };
  const contents = { mainFrame, print(...args: unknown[]) { printed.push(args); (args[1] as (ok: boolean) => void)(true); } };
  let clock = 0;
  shellIpc.registerShellHandlers({
    ipcMain: { handle(channel: string, handler: (event: unknown, value: unknown) => Promise<unknown>) { handlers.set(channel, handler); } },
    shell: { async openExternal(...args: unknown[]) { opened.push(args); } },
    contents: () => contents, document: () => 'chausar://app/ui/index.html',
    workspaceOpen: async () => options.open ?? true, now: () => clock,
  });
  const { api } = loadElectronPreloadFixture<ShellApi>({ source: preloadSource, filename: preloadPath.pathname,
    async invoke(channel, value) {
      channels.push(channel);
      const handler = handlers.get(channel);
      if (!handler) throw new Error('No synthetic handler.');
      return handler({ sender: contents, senderFrame: mainFrame }, value);
    },
  });
  return { api, opened, printed, channels, tick(ms: number) { clock += ms; } };
}

test('the preload adds only openExternal, print and pickFile beside the existing bridge', async () => {
  const { api } = chain();
  assert.deepEqual(Object.keys(api).sort(), ['onEngineStatus', 'openExternal', 'pickFile', 'print', 'request', 'requestEnvelope']);
});

test('the preload refuses non-string, empty and over-long addresses before any IPC, and main refuses the rest', async () => {
  const h = chain();
  for (const value of [42, null, undefined, {}, ['https://example.com/'], '', `https://example.com/${'a'.repeat(2048)}`]) {
    assert.equal(await h.api.openExternal(value), 'refused');
  }
  assert.deepEqual(h.channels, []);
  for (const value of ['javascript:alert(1)', 'file:///etc/passwd', 'chausar://app/ui/index.html', 'http://example.com/', 'https://user:pw@example.com/', 'mailto:a@example.com']) {
    assert.equal(await h.api.openExternal(value), 'refused');
  }
  assert.deepEqual(h.channels, Array(6).fill(shellIpc.OPEN_EXTERNAL_CHANNEL));
  assert.deepEqual(h.opened, []);
  assert.equal(await h.api.openExternal('https://Example.com/path'), 'opened');
  assert.deepEqual(h.opened, [['https://example.com/path']]);
});

test('the preload passes only the two printable kinds to main, which prints with the system dialog', async () => {
  const h = chain();
  for (const kind of ['<p>kit</p>', 'file:///kit.pdf', { silent: true }, undefined]) assert.equal(await h.api.print(kind), 'refused');
  assert.deepEqual(h.channels, []);
  assert.equal(await h.api.print('recovery-kit'), 'printed');
  assert.deepEqual(h.channels, [shellIpc.PRINT_CHANNEL]);
  assert.deepEqual(h.printed.map(args => args[0]), [{ silent: false }]);
});

test('the host adapter over the actual preload reaches the browser only after its own and main\'s checks', async () => {
  const h = chain();
  const port = createShellPort(h.api as Parameters<typeof createShellPort>[0], null);
  assert.equal(await port.openExternal('https://example.com/a'), 'opened');
  assert.equal(await port.openExternal('https://example.com/b'), 'refused', 'Main allows one a second.');
  h.tick(1_000);
  assert.equal(await port.openExternal('https://example.com/b'), 'opened');
  assert.equal(await port.openExternal('http://example.com/'), 'refused');
  await port.print('recovery-kit');
  assert.deepEqual(h.opened, [['https://example.com/a'], ['https://example.com/b']]);
  assert.equal(h.printed.length, 1);
  const locked = chain({ open: false });
  assert.equal(await createShellPort(locked.api as Parameters<typeof createShellPort>[0], null).openExternal('https://example.com/'), 'refused');
  assert.deepEqual(locked.opened, []);
});

test('the renderer and main address rules agree', () => {
  const table = ['https://example.com/', 'https://EXAMPLE.com:443/x/../y?q#f', 'https://example.com:8443/', 'https://xn--h2brj9c.xn--h2brj9c/', 'https://example.com/%20',
    'javascript:alert(1)', 'file:///x', 'chausar://app/', 'http://example.com/', 'mailto:a@example.com', 'https://u:p@example.com/', 'https://u@example.com/',
    'https://localhost/', 'https://a.localhost/', 'https://127.0.0.1/', 'https://0x7f.1/', 'https://[::1]/', 'https://intranet/', 'https://example.com./',
    ' https://example.com/', 'https://example.com/\t', `https://example.com/${'a'.repeat(2030)}`, `https://example.com/${'a'.repeat(2040)}`, '', 7, null];
  for (const value of table) assert.equal(rendererExternalUrl(value), shellIpc.externalUrl(value), String(value));
  assert.equal(shellIpc.externalUrl('https://EXAMPLE.com:443/x/../y?q#f'), 'https://example.com/y?q#f');
});
