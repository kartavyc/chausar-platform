// Screenshots one Ink screen from a running dev app (npm run dev:ui, the fake engine) with headless Chrome over CDP.
// Usage: node shoot.mjs <full-url> <out.png> [--dark] [--phone] [--cdp=<port>] [--click=<button text>] [--wait=<ms>]
// Pick your own --cdp port (default 9400) so two agents never share a browser. Exits non-zero on failure.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const args = process.argv.slice(2);
const [url, out] = args.filter(a => !a.startsWith('--'));
const flag = name => args.find(a => a.startsWith(`--${name}`));
const value = (name, fallback) => (flag(name)?.split('=').slice(1).join('=')) || fallback;
if (!url || !out) { console.error('usage: node shoot.mjs <url> <out.png> [--dark] [--phone] [--cdp=9400] [--click=text] [--wait=1800]'); process.exit(2); }
const port = Number(value('cdp', '9400'));
const phone = Boolean(flag('phone'));
const dark = Boolean(flag('dark'));
const click = value('click', '');
const wait = Number(value('wait', '1800'));

mkdirSync(dirname(out), { recursive: true });
const profile = mkdtempSync(join(tmpdir(), 'ink-shoot-'));
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
// Chrome holds its profile files until it has exited, so remove the profile only after the exit event (with retries).
const finish = code => {
  const clean = () => { try { rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch {} process.exit(code); };
  if (chrome.exitCode !== null) return clean();
  chrome.once('exit', () => setTimeout(clean, 300));
  try { chrome.kill(); } catch {}
  setTimeout(clean, 8000);
};
try {
  let targets;
  for (let i = 0; i < 60 && !targets; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); } catch { await sleep(200); } }
  if (!targets) throw new Error('Chrome did not start on port ' + port);
  const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  let id = 0; const waiting = new Map();
  ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } });
  const send = (method, params = {}) => new Promise(r => { const n = ++id; waiting.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', phone ? { width: 390, height: 844, deviceScaleFactor: 2, mobile: false } : { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }] });
  await send('Page.navigate', { url }); await sleep(wait);
  if (click) {
    const expr = `(() => { const b = [...document.querySelectorAll('button, a, summary, [role=tab]')].find(e => e.innerText.trim().startsWith(${JSON.stringify(click)})); if (b) { b.click(); return true; } return false; })()`;
    const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
    if (!res.result?.result?.value) console.error('no click target:', click);
    await sleep(1200);
  }
  const height = (await send('Runtime.evaluate', { expression: 'Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)', returnByValue: true })).result?.result?.value ?? 860;
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: phone ? 390 : 1280, height: Math.min(height, 4000), scale: 1 } });
  writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
  console.log('wrote', out);
  finish(0);
} catch (error) {
  console.error(String(error?.stack ?? error));
  finish(1);
}
