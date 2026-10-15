// FR-04: the printed recovery kit, saved as a PDF the way the desktop saves one.
// Electron's webContents.printToPDF and Playwright's page.pdf are the same Chromium print path:
// the print media styles, laid out on paper, written by Skia. This walks first run in the
// fake-engine preview to the recovery kit, presses Print with a shell whose print waits
// (`?print=hold`), and while the print view is up saves it on A4 and on US Letter.
//
//   node frontend-validation/print/kit-pdf.mjs [--no-build] [--out=<dir>]
//
// Checks: exactly one page on each paper; the page holds the code in groups of four, the
// kit's title and code label and its three lines in English and in Hindi, and nothing else
// from the app (read from the PDF's own text, and from the print-media DOM). Exits 1 on failure.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPdf } from './pdf.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const workspaceRoot = resolve(here, '../..');
export const printOutDir = resolve(workspaceRoot, 'frontend-validation/dist/print');
const words = language => JSON.parse(readFileSync(resolve(workspaceRoot, `app/ui/src/screens/first-run/text/${language}.json`), 'utf8'));
const KIT_LINES = ['FR-04.where', 'FR-04.how', 'FR-04.new'];
const PAPERS = [{ name: 'A4', format: 'A4' }, { name: 'Letter', format: 'Letter' }];
const squash = text => text.replace(/\s+/g, ' ').trim();

/** The kit's own words, as the print view must show them. */
export function kitWords() {
  const en = words('en'), hi = words('hi');
  return {
    title: [en['FR-04.title'], hi['FR-04.title']],
    label: [en['FR-04.code'], hi['FR-04.code']],
    lines: { en: KIT_LINES.map(key => en[key]), hi: KIT_LINES.map(key => hi[key]) },
  };
}

async function settle(page, { minimum = 120, maximum = 3000 } = {}) {
  const begin = Date.now();
  let last = '', stable = 0;
  while (Date.now() - begin < maximum) {
    const now = await page.evaluate(() => `${window.__chausarPreview?.calls.length ?? 0}:${document.body.innerHTML.length}`);
    stable = now === last ? stable + 1 : 0; last = now;
    if (stable >= 3 && Date.now() - begin >= minimum) return;
    await page.waitForTimeout(40);
  }
}

/** From the lock screen's recovery link into first run, then to step two, the recovery kit: a
 *  business, then a new vault with a synthetic passphrase (the fake engine's `locked` scenario,
 *  where creating a workspace opens a fresh one and hands back its kit). */
async function walkToKit(page) {
  const en = words('en');
  const shared = JSON.parse(readFileSync(resolve(workspaceRoot, 'app/ui/src/text/en.json'), 'utf8'));
  const button = name => page.getByRole('button', { name, exact: true }).first();
  const visible = async locator => (await locator.count()) > 0 && locator.first().isVisible();
  for (let turn = 0; turn < 10 && !(await visible(page.locator('[data-first-run-recovery]'))); turn++) {
    const business = button(en['FR-01.business.btn']);
    const name = page.getByLabel(en['FR-03.name'], { exact: true });
    const proceed = button(en['FR.journey.continue.btn']);
    const fromLock = button(shared['SH-02.recovery.btn']);
    const back = button(en['FR.journey.back.btn']);
    if (await visible(fromLock)) await fromLock.click();
    else if (await visible(business)) await business.click();
    else if (await visible(name)) {
      await name.first().fill('Demo shop');
      await page.getByLabel(en['FR-03.passphrase'], { exact: true }).fill('a synthetic passphrase only');
      await page.getByLabel(en['FR-03.repeat'], { exact: true }).fill('a synthetic passphrase only');
      await button(en['FR-03.create.btn']).click();
    } else if (await visible(proceed) && await proceed.isEnabled()) await proceed.click();
    else if (await visible(back) && await back.isEnabled()) await back.click();
    else break;
    await settle(page);
  }
  if (!(await visible(page.locator('[data-first-run-recovery]')))) throw new Error(`First run did not reach the recovery kit. The page shows: ${(await page.locator('main').first().innerText()).replace(/\s+/g, ' ').slice(0, 400)}`);
}

export async function checkRecoveryKitPdf({ buildPreview = true, out = printOutDir } = {}) {
  const [{ build }, { previewConfig }, { launchChromium }, { serveStatic }] = await Promise.all([
    import('vite'), import('../preview.vite.config.mjs'), import('../policy/browser.mjs'), import('../policy/serve.mjs'),
  ]);
  const previewDir = resolve(workspaceRoot, 'frontend-validation/dist/preview-print');
  if (buildPreview) await build({ ...previewConfig({ outDir: previewDir }), logLevel: 'error', configFile: false });
  mkdirSync(out, { recursive: true });
  const server = await serveStatic(previewDir);
  const browser = await launchChromium();
  const failures = [];
  const result = { papers: {}, failures, code: null, printDom: null, control: null };
  try {
    const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, reducedMotion: 'reduce', colorScheme: 'light' });
    const page = await context.newPage();
    const remote = [];
    page.on('request', request => { if (!request.url().startsWith(server.url) && !request.url().startsWith('data:')) remote.push(request.url()); });
    await page.goto(`${server.url}index.html?scenario=locked&lang=en&view=guided&print=hold`);
    await page.waitForFunction(() => window.__chausarPreview?.ready === true, null, { timeout: 20000 });
    await page.evaluate(() => document.fonts.ready.then(() => true));
    await settle(page);
    await walkToKit(page);
    result.code = await page.locator('[data-recovery-code]').evaluate(element => [...element.children].map(child => child.textContent ?? ''));
    await page.getByRole('button', { name: words('en')['FR-04.print.btn'], exact: true }).click();
    await page.waitForFunction(() => window.__chausarPreview?.printing === 'recovery-kit' && document.documentElement.dataset.print === 'recovery-kit' && document.querySelector('[data-print-kit]') !== null, null, { timeout: 5000 });
    await page.evaluate(() => document.fonts.ready.then(() => true));

    // The print-media DOM: every box that shows text on paper is inside the kit.
    await page.emulateMedia({ media: 'print' });
    result.printDom = await page.evaluate(() => {
      const kit = document.querySelector('[data-print-kit]');
      const outside = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const parent = node.parentElement;
        if (!node.nodeValue?.trim() || !parent || ['SCRIPT', 'STYLE'].includes(parent.tagName)) continue;
        const rect = parent.getBoundingClientRect();
        const shown = parent.getClientRects().length > 0 && rect.width > 1 && rect.height > 1 && getComputedStyle(parent).visibility === 'visible';
        if (shown && !kit?.contains(parent)) outside.push(node.nodeValue.trim().slice(0, 60));
      }
      const lists = kit ? [...kit.querySelectorAll('ol')].map(list => ({ lang: list.getAttribute('lang'), items: [...list.querySelectorAll('li')].map(item => item.textContent ?? '') })) : [];
      const groups = kit ? [...(kit.querySelector('p.fig')?.children ?? [])].map(span => span.textContent ?? '') : [];
      return { outside, lists, groups, title: kit?.querySelector('h1')?.textContent ?? null, text: kit?.innerText ?? '' };
    });
    await page.emulateMedia({ media: null });
    for (const paper of PAPERS) {
      const bytes = await page.pdf({ format: paper.format, printBackground: false, preferCSSPageSize: false });
      writeFileSync(resolve(out, `recovery-kit-${paper.name}.pdf`), bytes);
      const pdf = readPdf(Buffer.from(bytes));
      result.papers[paper.name] = { bytes: bytes.length, pages: pdf.pageCount, text: pdf.pages.map(item => item.text).join('\n\f\n') };
    }
    await page.evaluate(() => window.__chausarPreview?.releasePrint());
    await page.waitForFunction(() => document.documentElement.dataset.print === undefined && document.querySelector('[data-print-kit]') === null, null, { timeout: 5000 });
    // The control: the same page saved with the screen's styles shows the screen, so the reader
    // above does see app words when they are on paper (the screen's "kept" box is not in the kit).
    await page.emulateMedia({ media: 'screen' });
    const control = readPdf(Buffer.from(await page.pdf({ format: 'A4', printBackground: false })));
    await page.emulateMedia({ media: null });
    result.control = { pages: control.pageCount, showsScreen: squash(control.pages.map(item => item.text).join(' ')).includes(words('en')['FR-04.kept']) };
    if (!result.control.showsScreen) failures.push('The control print of the screen did not read back the screen\'s words, so the PDF reader cannot be trusted.');
    if (remote.length) failures.push(`Requests left 127.0.0.1: ${remote.join(', ')}`);
    await context.close();
  } finally {
    await browser.close();
    await server.close();
  }

  /* ------------------------------------------------------------------ checks */
  const kit = kitWords();
  const code = result.code ?? [];
  if (code.length === 0 || code.slice(0, -1).some(group => [...group].length !== 4) || ![1, 2, 3, 4].includes([...code.at(-1) ?? ''].length) || code.some(group => /\s/.test(group))) failures.push(`The on-screen code is not in groups of four: ${JSON.stringify(code)}.`);
  const dom = result.printDom;
  if (!dom) failures.push('The print view was not drawn.');
  else {
    if (dom.outside.length) failures.push(`Print media shows text outside the kit: ${dom.outside.slice(0, 5).join(' | ')}.`);
    if (JSON.stringify(dom.groups) !== JSON.stringify(code)) failures.push(`The printed code groups ${JSON.stringify(dom.groups)} are not the code ${JSON.stringify(code)}.`);
    const en = dom.lists.find(list => list.lang === 'en')?.items ?? [], hi = dom.lists.find(list => list.lang === 'hi')?.items ?? [];
    if (JSON.stringify(en) !== JSON.stringify(kit.lines.en)) failures.push('The printed English lines are not the kit\'s three lines.');
    if (JSON.stringify(hi) !== JSON.stringify(kit.lines.hi)) failures.push('The printed Hindi lines are not the kit\'s three lines.');
    const expected = squash([`${kit.title[0]} · ${kit.title[1]}`, `${kit.label[0]} · ${kit.label[1]}`, code.join(''), ...kit.lines.en, ...kit.lines.hi].join(' '));
    if (squash(dom.text).replace(squash(code.join(' ')), code.join('')).replace(code.join('\n'), code.join('')) !== expected) failures.push(`The print view holds other words: "${squash(dom.text).slice(0, 200)}".`);
  }
  for (const paper of PAPERS) {
    const saved = result.papers[paper.name];
    if (!saved) { failures.push(`No PDF on ${paper.name}.`); continue; }
    if (saved.pages !== 1) failures.push(`The kit is ${saved.pages} pages on ${paper.name}, not one.`);
    const flat = saved.text.replace(/\s+/g, '');
    if (!flat.includes(code.join(''))) failures.push(`The ${paper.name} PDF text does not hold the code.`);
    for (const group of code) if (!saved.text.includes(group)) failures.push(`The ${paper.name} PDF text does not hold the group ${group}.`);
    for (const line of [kit.title[0], kit.label[0], ...kit.lines.en]) if (!squash(saved.text).includes(squash(line))) failures.push(`The ${paper.name} PDF text does not hold "${line}".`);
    // Hindi is shaped on paper (conjuncts, vowel signs before their consonant), so the PDF's text
    // map gives its letters, not always in reading order: every Devanagari letter on the page must
    // come from the kit's Hindi words, and the page must carry most of them.
    // Compared decomposed: a font may map a nukta letter to its precomposed form (U+095B for U+091C U+093C).
    const hindiLetters = new Set([...[kit.title[1], kit.label[1], ...kit.lines.hi].join('').normalize('NFD')].filter(ch => /\p{Script=Devanagari}/u.test(ch)));
    const pdfLetters = [...saved.text.normalize('NFD')].filter(ch => /\p{Script=Devanagari}/u.test(ch));
    const foreign = [...new Set(pdfLetters.filter(ch => !hindiLetters.has(ch)))];
    if (foreign.length) failures.push(`The ${paper.name} PDF has Devanagari not in the kit: ${foreign.join('')}.`);
    const expectedCount = [...[kit.title[1], kit.label[1], ...kit.lines.hi].join('').normalize('NFD')].filter(ch => /\p{Script=Devanagari}/u.test(ch)).length;
    if (pdfLetters.length < expectedCount * 0.8) failures.push(`The ${paper.name} PDF carries ${pdfLetters.length} Devanagari letters; the kit's Hindi has ${expectedCount}.`);
    // Nothing else from the app: every Latin word on the page is a word of the kit.
    const allowed = new Set(squash([...kit.title, ...kit.label, ...kit.lines.en, ...code].join(' ')).split(/[^A-Za-z0-9]+/).filter(Boolean));
    const strangers = [...new Set(saved.text.split(/[^A-Za-z0-9]+/).filter(word => word && !allowed.has(word) && !code.some(group => group.includes(word) || word.includes(group)) && !/^[A-Z0-9]+$/.test(word)))];
    if (strangers.length) failures.push(`The ${paper.name} PDF holds words from outside the kit: ${strangers.slice(0, 10).join(', ')}.`);
  }
  writeFileSync(resolve(out, 'recovery-kit.json'), `${JSON.stringify({ ...result, checkedAt: new Date().toISOString() }, null, 2)}\n`);
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = new Set(process.argv.slice(2));
  const result = await checkRecoveryKitPdf({ buildPreview: !args.has('--no-build') });
  for (const [paper, saved] of Object.entries(result.papers)) process.stdout.write(`${paper}: ${saved.pages} page(s), ${saved.bytes} bytes\n${saved.text.trim()}\n\n`);
  process.stdout.write(result.failures.length ? `FAILED\n${result.failures.map(item => `  ${item}`).join('\n')}\n` : `Recovery kit PDF: one page on A4 and Letter, the code in ${result.code?.length} groups of four, the three lines in English and Hindi, nothing else.\n`);
  process.exit(result.failures.length ? 1 : 0);
}
