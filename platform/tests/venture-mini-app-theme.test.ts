// One-shot A1 (row 12): a mini app reads in Chausar's own theme. The frame's bridge takes the theme and the colour
// variables Chausar sends in ui/initialize (MCP Apps hostContext.styles.variables) and applies only the allowed names
// with plain colour values, so an app's text stays readable in light and dark and nothing else can be styled through it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { FRAME_BASE_COLOURS, appDocument } from '../runtime/venture/apps/frame.ts';

function frameScript(): string {
  const html = appDocument('<p>app</p>', 'Test app');
  const open = html.indexOf('<script>') + '<script>'.length;
  return html.slice(open, html.indexOf('</script>', open));
}

function runFrame() {
  const posted: any[] = [], set: [string, string][] = [], attributes: Record<string, string> = {};
  let onMessage: ((event: { source: unknown; data: unknown }) => void) | null = null;
  const parent = { postMessage: (message: unknown) => { posted.push(message); } };
  const documentElement = { setAttribute: (name: string, value: string) => { attributes[name] = value; }, style: { setProperty: (name: string, value: string) => { set.push([name, value]); } }, scrollWidth: 300, scrollHeight: 200 };
  const window = { addEventListener: (kind: string, handler: any) => { if (kind === 'message') onMessage = handler; } };
  runInNewContext(frameScript(), { parent, window, document: { documentElement }, Promise, Object, String, Error });
  return { posted, set, attributes, reply: (data: unknown) => onMessage!({ source: parent, data }) };
}

test('mini app theme: the frame applies the theme and only the allowed colour variables Chausar sends', async () => {
  const frame = runFrame();
  const ask = frame.posted.find(message => message.method === 'ui/initialize');
  assert.ok(ask, 'the frame asks ui/initialize');
  frame.reply({ jsonrpc: '2.0', id: ask.id, result: { hostContext: { theme: 'light', styles: { variables: {
    '--bg': '#ffffff', '--fg': '#16181b', '--mute': '#5c6168', '--line': '#e3e5e8', '--link': '#2f5bd3',
    '--evil': '#123456', '--fg2': '#000000', '--bg-x': '#000000',
  } } } } });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(frame.attributes['data-theme'], 'light');
  assert.deepEqual(frame.set.sort(), [['--bg', '#ffffff'], ['--fg', '#16181b'], ['--line', '#e3e5e8'], ['--link', '#2f5bd3'], ['--mute', '#5c6168']]);
});

test('mini app theme: a value that is not a plain colour is never applied, and a later theme change is', async () => {
  const frame = runFrame();
  const ask = frame.posted.find(message => message.method === 'ui/initialize');
  frame.reply({ jsonrpc: '2.0', id: ask.id, result: { hostContext: { theme: 'dark', styles: { variables: { '--bg': 'red;background:url(x)', '--fg': 'url(javascript:1)', '--mute': '#zzzzzz' } } } } });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(frame.set, []);
  frame.reply({ jsonrpc: '2.0', method: 'ui/notifications/host-context-changed', params: { theme: 'light', styles: { variables: { '--bg': '#fbfbfa' } } } });
  assert.equal(frame.attributes['data-theme'], 'light');
  assert.deepEqual(frame.set, [['--bg', '#fbfbfa']]);
});

test('mini app theme: the frame base colours are the ones its style uses, in both themes', () => {
  const html = appDocument('<p>app</p>', 'Test app');
  for (const theme of ['light', 'dark'] as const) {
    for (const [name, value] of Object.entries(FRAME_BASE_COLOURS[theme])) assert.ok(html.includes(`--${name}:${value}`), `${theme} ${name}`);
  }
});
