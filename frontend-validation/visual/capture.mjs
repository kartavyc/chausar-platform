// Capture the fake-engine preview's screens that match the design's reference pictures, at
// 1366 x 768 in the same theme, view and language as each picture (both themes).
//
//   node frontend-validation/visual/capture.mjs [--no-build] [--only=<regex on picture name>] [--themes=light,dark]
//
// Writes frontend-validation/dist/visual/capture/<name>-<theme>.png and manifest.json. Pictures of
// other lanes' screens are captured when the preview draws them (marked "other lane"); pictures the
// preview cannot draw (phone, enterprise, the CA console) are listed as "not drawable".
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { previewConfig, previewOutDir } from '../preview.vite.config.mjs';
import { launchChromium } from '../policy/browser.mjs';
import { serveStatic } from '../policy/serve.mjs';

export const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const captureDir = resolve(workspaceRoot, 'frontend-validation/dist/visual/capture');
export const VIEWPORT = { width: 1366, height: 768 };

/**
 * Each reference picture and the preview state that draws the same screen. `drive` names a
 * scripted walk for states an address alone cannot reach. `lane` is the lane that owns the screen.
 */
export const PICTURES = [
  { name: 'S01-Today', lane: 'frame-today', scenario: 'populated', view: 'guided', language: 'en', address: '#/today/today' },
  { name: 'S14-Today-Simple', lane: 'frame-today', scenario: 'populated', view: 'simple', language: 'hi', address: '#/today' },
  { name: 'S15-Today-Books', lane: 'frame-today', scenario: 'populated', view: 'books', language: 'en', address: '#/today' },
  { name: 'S09-Setup', lane: 'frame-today', scenario: 'first-run', view: 'guided', language: 'en', address: '', drive: 'meanings' },
  { name: 'S02-Answer', lane: 'ask', scenario: 'populated', view: 'guided', language: 'en', address: '#/ask/new' },
  { name: 'S03-Why', lane: 'ask', address: null, reason: 'other lane: the why-did-it-change bridge has no address of its own in the preview' },
  { name: 'S04-Approval', lane: 'work-books', scenario: 'populated', view: 'guided', language: 'en', address: '#/work/approvals' },
  { name: 'S05-Job', lane: 'work-books', scenario: 'populated', view: 'guided', language: 'en', address: '#/work/jobs' },
  { name: 'S06-Sources', lane: 'work-books', scenario: 'populated', view: 'guided', language: 'en', address: '#/books/sources' },
  { name: 'S07-Meaning', lane: 'work-books', scenario: 'populated', view: 'guided', language: 'en', address: '#/books/meanings' },
  { name: 'S08-History', lane: 'work-books', scenario: 'populated', view: 'guided', language: 'en', address: '#/books/history' },
  { name: 'S10-Trust', lane: 'reports-tools-trust', scenario: 'populated', view: 'guided', language: 'en', address: '#/trust/rules' },
  { name: 'S11-People', lane: 'reports-tools-trust', scenario: 'populated', view: 'guided', language: 'en', address: '#/trust/people' },
  { name: 'S12-SmallApp', lane: 'reports-tools-trust', scenario: 'populated', view: 'guided', language: 'en', address: '#/tools/smallapps' },
  { name: 'S13-Plugin', lane: 'reports-tools-trust', scenario: 'populated', view: 'guided', language: 'en', address: '#/tools/plugins' },
  { name: 'S16-Phone-Messages', lane: 'hosted-link', address: null, reason: 'not drawable: a message on the phone, outside the desktop app' },
  { name: 'S17-Phone-Page', lane: 'hosted-link', address: null, reason: 'not drawable: the paired phone page (after day 10)' },
  { name: 'S18-Enterprise-Home', lane: 'enterprise', address: null, reason: 'not drawable: the preview draws the desktop shell only' },
  { name: 'S19-CA-Console', lane: 'enterprise', address: null, reason: 'not drawable: the preview draws the desktop shell only' },
];

const args = new Map(process.argv.slice(2).map(arg => { const [key, ...value] = arg.replace(/^--/, '').split('='); return [key, value.join('=') || true]; }));

/** Wait until the fake engine has no new calls and the DOM stops changing (as the policy checker does). */
async function settle(page, { minimum = 120, maximum = 3000 } = {}) {
  const begin = Date.now();
  let last = '', stable = 0;
  while (Date.now() - begin < maximum) {
    const now = await page.evaluate(() => `${window.__chausarPreview?.calls.length ?? 0}:${document.body.innerHTML.length}:${location.hash}`);
    stable = now === last ? stable + 1 : 0; last = now;
    if (stable >= 3 && Date.now() - begin >= minimum) return;
    await page.waitForTimeout(40);
  }
}

/** First run to step five, Meanings: a business, the vault, the kit kept, the model skipped, a file held, a pack picked, two meanings agreed and the third open. */
async function driveMeanings(page, language) {
  const words = JSON.parse(readFileSync(resolve(workspaceRoot, `app/ui/src/screens/first-run/text/${language}.json`), 'utf8'));
  const button = name => page.getByRole('button', { name, exact: true }).first();
  const step = async action => { await action(); await settle(page); };
  const visible = async locator => (await locator.count()) > 0 && locator.first().isVisible();
  const file = { name: 'September-sales.csv', mimeType: 'text/csv', buffer: Buffer.from('date,customer,amount\n2026-09-01,Kiran Retail Demo,1500\n2026-09-02,Meera Textiles Demo,1500\n') };
  // Walk whichever step is on screen until the meanings rows show; the fake's scenario decides which steps are already done.
  for (let turn = 0; turn < 14 && !(await visible(page.locator('[data-first-run-row]'))); turn++) {
    const name = page.getByLabel(words['FR-03.name'], { exact: true });
    const kept = page.getByRole('checkbox', { name: words['FR-04.kept'] });
    const skip = button(words['FR-05.skip.btn']);
    const input = page.locator('input[type=file]');
    const agree = button(words['FR-07.agreeFirst.btn']);
    const business = button(words['FR-01.business.btn']);
    const proceed = button(words['FR.journey.continue.btn']);
    if (await visible(business)) await step(() => business.click());
    else if (await visible(name)) {
      await name.first().fill('Demo shop');
      await page.getByLabel(words['FR-03.passphrase'], { exact: true }).fill('a synthetic passphrase only');
      await page.getByLabel(words['FR-03.repeat'], { exact: true }).fill('a synthetic passphrase only');
      await step(() => button(words['FR-03.create.btn']).click());
    } else if (await visible(kept) && !(await kept.first().isChecked())) await step(() => kept.first().check());
    else if (await visible(skip) && await skip.isEnabled()) { await step(() => skip.click()); await step(() => proceed.click()); }
    else if (await visible(agree)) await step(() => agree.click());
    else if (await input.count()) await step(() => input.first().setInputFiles(file));
    else if (await visible(proceed) && await proceed.isEnabled()) await step(() => proceed.click());
    else break;
  }
  const row = id => page.locator(`[data-first-run-row][data-row-id="${id}"]`);
  const main = id => row(id).locator('[data-row-main]');
  if (await main('retail').count()) await step(() => main('retail').click());
  for (const id of ['billed', 'received']) {
    if (!(await main(id).count())) break;
    if ((await main(id).getAttribute('aria-expanded')) !== 'true') await step(() => main(id).click());
    await step(() => row(id).getByRole('button', { name: words['FR-08.row.accept'] }).click());
  }
  if ((await main('earned').count()) && (await main('earned').getAttribute('aria-expanded')) !== 'true') await step(() => main('earned').click());
  await page.evaluate(() => { document.activeElement?.blur?.(); window.scrollTo(0, 0); });
}

export async function capture({ themes = ['light', 'dark'], only = null, buildPreview = true, out = captureDir } = {}) {
  if (buildPreview) await build({ ...previewConfig(), logLevel: 'error', configFile: false });
  const notBuiltTexts = ['en', 'hi'].map(language => JSON.parse(readFileSync(resolve(workspaceRoot, `app/ui/src/text/${language}.json`), 'utf8'))['ST.notBuilt'].replace(/[.।]$/u, ''));
  mkdirSync(out, { recursive: true });
  const server = await serveStatic(previewOutDir);
  const browser = await launchChromium();
  const entries = [];
  try {
    for (const picture of PICTURES) {
      if (only && !only.test(picture.name)) continue;
      if (picture.address === null) { entries.push({ ...picture, status: picture.reason.startsWith('not drawable') ? 'not drawable' : 'other lane', captures: {} }); continue; }
      const entry = { ...picture, query: `scenario=${picture.scenario}&lang=${picture.language}&view=${picture.view}`, captures: {}, notBuilt: false, errors: [] };
      for (const theme of themes) {
        const context = await browser.newContext({ viewport: VIEWPORT, reducedMotion: 'reduce', colorScheme: theme, deviceScaleFactor: 1 });
        const page = await context.newPage();
        page.on('pageerror', error => entry.errors.push(error.message));
        await page.goto(`${server.url}index.html?${entry.query}&theme=${theme}${picture.address}`);
        await page.waitForFunction(() => window.__chausarPreview?.ready === true, null, { timeout: 20000 });
        await page.evaluate(() => document.fonts.ready.then(() => true));
        await settle(page);
        if (picture.drive === 'meanings') await driveMeanings(page, picture.language);
        const text = await page.evaluate(() => document.body.innerText);
        entry.notBuilt ||= notBuiltTexts.some(words => text.includes(words));
        entry.title = await page.evaluate(() => (document.querySelector('h1')?.textContent ?? '').trim().slice(0, 80));
        const file = `${picture.name}-${theme}.png`;
        await page.screenshot({ path: resolve(out, file) });
        entry.captures[theme] = file;
        await context.close();
      }
      entry.status = picture.lane === 'frame-today' ? 'frame-today' : entry.notBuilt ? 'other lane, not built yet' : 'other lane';
      entries.push(entry);
    }
  } finally {
    await browser.close();
    await server.close();
  }
  const manifest = { capturedAt: new Date().toISOString(), viewport: VIEWPORT, pictures: entries };
  writeFileSync(resolve(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const manifest = await capture({
    themes: typeof args.get('themes') === 'string' ? args.get('themes').split(',') : ['light', 'dark'],
    only: typeof args.get('only') === 'string' ? new RegExp(args.get('only')) : null,
    buildPreview: !args.has('no-build'),
  });
  for (const entry of manifest.pictures) process.stdout.write(`${entry.name.padEnd(20)} ${entry.status.padEnd(26)} ${entry.address ?? '-'}  ${entry.title ?? entry.reason ?? ''}${entry.errors?.length ? `  errors: ${entry.errors.join('; ')}` : ''}\n`);
  process.stdout.write(`Captures in ${captureDir}\n`);
}
