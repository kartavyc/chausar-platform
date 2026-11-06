// Real browser proof for the harmless developer preview. Pairing material stays in its private launch file.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { startDevUi } from '../dev-ui-engine.mjs';
import { runRoot } from '../../platform/runtime/run-root.mjs';
import { Browser, findChrome } from './browser.mjs';

const output = join(runRoot('ui-engine'), 'browser-proof');
await mkdir(output, { recursive: true });
const running = await startDevUi();
const browser = new Browser({ chrome: findChrome(), port: 9485, profiles: output });
let receipt;
try {
  const launch = JSON.parse(await readFile(running.launchFile, 'utf8'));
  await browser.start();
  await browser.viewport(1280, 900);
  await browser.go(launch.url);
  for (let index = 0; index < 200; index++) {
    receipt = await browser.evaluate(`({ heading: document.querySelector('h1')?.textContent?.trim(), business: document.body.textContent.includes('Sample Ledger Books'), cards: document.querySelectorAll('[data-row]').length })`);
    if (receipt.heading === 'Today' && receipt.business) break;
    await sleep(100);
  }
  assert.equal(receipt.heading, 'Today', 'The real sample must reach Today.');
  assert.equal(receipt.business, true, 'Today names the actual sample business.');
  await writeFile(join(output, 'today.png'), await browser.screenshot(1280, 900));
} finally {
  try { await browser.stop(); }
  finally { await running.close(); }
}
await assert.rejects(readFile(running.launchFile), { code: 'ENOENT' });
for (const origin of ['http://127.0.0.1:4317', 'http://127.0.0.1:5178']) await assert.rejects(fetch(`${origin}/api/health`));
await writeFile(join(output, 'report.json'), `${JSON.stringify({ ...receipt, stopped: true, pairingFileRemoved: true }, null, 2)}\n`);
console.log('Real-engine Today rendered; both local servers stopped and the private pairing file was removed.');
