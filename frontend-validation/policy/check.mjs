// UI policy checker. Builds the fake-engine preview, opens it in Chromium and walks every place
// and sub-place address (from app/places.ts through the preview), first run and the lock screen,
// in both themes x three views x two languages, applying app/ui/ui-policy.json in the page.
//
//   node frontend-validation/policy/check.mjs [--allow-not-built] [--no-build] [--quick]
//        [--views=guided,simple,books] [--langs=en,hi] [--themes=light,dark] [--only=<regex>] [--out=<file>]
//        [--no-axe] [--axe-fail=serious|critical|moderate|minor|none]
//
// Every audited state at 1366 x 768 is also run through axe-core (WCAG 2.0/2.1/2.2 A and AA tags).
// Writes frontend-validation/dist/policy-report.json. Exits 1 on any violation, on any axe
// violation at or above --axe-fail (default serious), and when a place shows "not built yet"
// unless --allow-not-built is given (those places are always listed).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { build } from 'vite';
import { previewConfig, previewOutDir } from '../preview.vite.config.mjs';
import { policyPath, workspaceRoot } from './derive.mjs';
import { auditInPage } from './audit.mjs';
import { launchChromium } from './browser.mjs';
import { serveStatic } from './serve.mjs';
import { selfTest } from './self-test.mjs';
import { AXE_TAGS, axeVersion, failingImpacts, runAxe } from './axe.mjs';

const args = new Map(process.argv.slice(2).map(arg => { const [key, ...value] = arg.replace(/^--/, '').split('='); return [key, value.length ? value.join('=') : true]; }));
const list = (name, fallback) => (typeof args.get(name) === 'string' ? args.get(name).split(',').map(value => value.trim()).filter(Boolean) : fallback);
const quick = args.has('quick');
const policy = JSON.parse(readFileSync(policyPath, 'utf8'));
const views = list('views', quick ? ['guided'] : policy.views);
const languages = list('langs', quick ? ['en'] : policy.languages);
const themes = list('themes', policy.themes);
const axeOn = !args.has('no-axe');
const axeFailing = failingImpacts(typeof args.get('axe-fail') === 'string' ? args.get('axe-fail') : 'serious');
const only = typeof args.get('only') === 'string' ? new RegExp(args.get('only')) : null;
const reportPath = resolve(typeof args.get('out') === 'string' ? args.get('out') : resolve(workspaceRoot, 'frontend-validation/dist/policy-report.json'));
const catalogue = language => JSON.parse(readFileSync(resolve(workspaceRoot, `app/ui/src/text/${language}.json`), 'utf8'));
const notBuiltTexts = ['en', 'hi'].map(language => catalogue(language)['ST.notBuilt'].replace(/[.।]$/u, ''));
const started = performance.now();
const log = message => process.stdout.write(`[${((performance.now() - started) / 1000).toFixed(0).padStart(3)}s] ${message}\n`);

if (!args.has('no-build')) { log('Building the fake-engine preview'); await build({ ...previewConfig(), logLevel: 'error', configFile: false }); }
const server = await serveStatic(previewOutDir);
const browser = await launchChromium();
const states = [];
const axeStates = [];
const remoteRequests = [];
if (!args.has('skip-self-test')) {
  const result = await selfTest(browser, policy, server.url, { axe: axeOn });
  if (result.missing.length) { log(`Self-test failed: the planted page did not trip ${result.missing.join(', ')}.`); await browser.close(); await server.close(); process.exit(2); }
  log(`Self-test passed: ${result.plantedFindings} planted findings across every rule`);
}

async function openPage({ scenario, view, language, theme, viewport }) {
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce', colorScheme: theme === 'dark' ? 'dark' : 'light', deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { const url = request.url(); if (!url.startsWith(server.url) && !url.startsWith('data:') && !url.startsWith('blob:')) remoteRequests.push({ scenario, view, language, url }); });
  await page.goto(`${server.url}index.html?scenario=${scenario}&lang=${language}&view=${view}&theme=${theme}`);
  await page.waitForFunction(() => window.__chausarPreview?.ready === true, null, { timeout: 20000 });
  await page.evaluate(() => document.fonts.ready.then(() => true));
  await settle(page);
  return { page, context, errors };
}
/** Wait until the fake engine has no new calls and the DOM stops changing. */
async function settle(page, { minimum = 80, maximum = 3000 } = {}) {
  const begin = Date.now();
  let last = '', stable = 0;
  while (Date.now() - begin < maximum) {
    const now = await page.evaluate(() => `${window.__chausarPreview?.calls.length ?? 0}:${document.body.innerHTML.length}:${location.hash}`);
    stable = now === last ? stable + 1 : 0; last = now;
    if (stable >= 2 && Date.now() - begin >= minimum) return;
    await page.waitForTimeout(40);
  }
}
async function audit(page, meta) {
  const result = await page.evaluate(auditInPage, { policy, view: meta.view, language: meta.language, theme: meta.theme, sheetExpected: meta.sheet === true, notBuiltTexts, reducedMotion: true });
  states.push({ ...meta, ...result });
  if (axeOn && meta.viewport === '1366x768') { const found = await runAxe(page); axeStates.push({ ...meta, violations: found, incomplete: found.incomplete }); }
  return result;
}
async function go(page, address) {
  await page.evaluate(hash => { window.location.hash = hash; }, address);
  await settle(page);
}

const viewportFull = policy.viewports.full, viewportMedium = policy.viewports.medium;
for (const view of views) {
  for (const language of languages) {
    // The populated workspace: every place and sub-place, both themes.
    const { page, context, errors } = await openPage({ scenario: 'populated', view, language, theme: themes[0], viewport: viewportFull });
    const addresses = (await page.evaluate(() => window.__chausarPreview.addresses)).filter(item => !only || only.test(item.address));
    for (const theme of themes) {
      await page.evaluate(next => window.__chausarPreview.setTheme(next), theme);
      log(`populated ${view} ${language} ${theme}: ${addresses.length} addresses`);
      for (const { address, handledBy } of addresses) {
        await go(page, address);
        await audit(page, { scenario: 'populated', view, language, theme, viewport: '1366x768', address, handledBy });
        if (address === '#/today/today' || (address === '#/today' && !addresses.some(item => item.address === '#/today/today'))) {
          // Today with a figure's receipt open in the one sheet.
          const figure = page.locator('[data-region="page"] button.fig').first();
          if (await figure.count()) {
            await figure.click();
            await page.waitForSelector('[data-region="sheet"]', { timeout: 3000 }).catch(() => null);
            await settle(page);
            await audit(page, { scenario: 'populated', view, language, theme, viewport: '1366x768', address: `${address}?sheet=receipt`, handledBy: 'today', sheet: true });
          }
        }
      }
    }
    states.push(...errors.map(message => ({ scenario: 'populated', view, language, theme: 'any', viewport: '1366x768', address: '(page)', findings: [{ rule: 'page-error', element: null, detail: message }], warnings: [] })));
    await context.close();
    // First run and the lock screen, both themes.
    for (const scenario of ['first-run', 'locked', 'empty', 'read-only']) {
      if (only && !only.test(scenario)) continue;
      for (const theme of themes) {
        const opened = await openPage({ scenario, view, language, theme, viewport: viewportFull });
        const address = await opened.page.evaluate(() => location.hash || '#/');
        await audit(opened.page, { scenario, view, language, theme, viewport: '1366x768', address, handledBy: scenario });
        if (scenario === 'empty' || scenario === 'read-only') log(`${scenario} ${view} ${language} ${theme}`);
        else log(`${scenario} ${view} ${language} ${theme}`);
        await opened.context.close();
      }
    }
  }
}
// The 1024 x 768 subset: every place at rest and Today, English, both themes.
for (const view of views) {
  for (const theme of themes) {
    const { page, context } = await openPage({ scenario: 'populated', view, language: 'en', theme, viewport: viewportMedium });
    const addresses = (await page.evaluate(() => window.__chausarPreview.addresses)).filter(item => !item.address.slice(2).includes('/') || item.address === '#/today/today').filter(item => !only || only.test(item.address));
    log(`medium ${view} en ${theme}: ${addresses.length} addresses`);
    for (const { address, handledBy } of addresses) { await go(page, address); await audit(page, { scenario: 'populated', view, language: 'en', theme, viewport: '1024x768', address, handledBy }); }
    await context.close();
  }
}
await browser.close();
await server.close();

/* -------------------------------------------------------------------- report */
const placeOf = state => (state.scenario !== 'populated' ? state.scenario : state.address.replace(/^#\//, '').replace(/\?.*$/, '') || 'today');
const violations = states.flatMap(state => state.findings.map(finding => ({ ...finding, scenario: state.scenario, view: state.view, language: state.language, theme: state.theme, viewport: state.viewport, address: state.address, place: placeOf(state) })));
for (const request of remoteRequests) violations.push({ rule: 'remote-request', element: null, detail: request.url, scenario: request.scenario, view: request.view, language: request.language, theme: 'any', viewport: 'any', address: '(network)', place: '(network)' });
const count = (items, key) => Object.fromEntries(Object.entries(items.reduce((acc, item) => { const k = key(item); acc[k] = (acc[k] ?? 0) + 1; return acc; }, {})).sort((a, b) => b[1] - a[1]));
const byRule = count(violations, item => item.rule);
const byRuleAndPlace = {};
for (const item of violations) { (byRuleAndPlace[item.rule] ??= {}); byRuleAndPlace[item.rule][item.place] = (byRuleAndPlace[item.rule][item.place] ?? 0) + 1; }
const distinct = {};
for (const item of violations) {
  const key = `${item.rule}|${item.element}|${item.detail.replace(/\d+(\.\d+)?/g, '#')}`;
  (distinct[key] ??= { rule: item.rule, element: item.element, detail: item.detail, occurrences: 0, places: new Set(), views: new Set(), themes: new Set(), languages: new Set() });
  const entry = distinct[key]; entry.occurrences++; entry.places.add(item.place); entry.views.add(item.view); entry.themes.add(item.theme); entry.languages.add(item.language);
}
const distinctList = Object.values(distinct).map(entry => ({ ...entry, places: [...entry.places], views: [...entry.views], themes: [...entry.themes], languages: [...entry.languages] })).sort((a, b) => b.occurrences - a.occurrences);
const notBuilt = [...new Set(states.filter(state => state.notBuilt).map(state => state.address.replace(/\?.*$/, '')))].sort();
const warnings = count(states.flatMap(state => state.warnings ?? []), item => item.rule);
/* -------------------------------------------------------------------- axe */
const axeViolations = axeStates.flatMap(state => state.violations.map(item => ({ ...item, scenario: state.scenario, view: state.view, language: state.language, theme: state.theme, address: state.address, place: placeOf(state) })));
const axeByRule = {};
for (const item of axeViolations) {
  const entry = (axeByRule[item.rule] ??= { impact: item.impact, help: item.help, wcag: item.wcag, total: 0, places: {} });
  entry.total++; entry.places[item.place] = (entry.places[item.place] ?? 0) + 1;
}
const axeDistinct = {};
for (const item of axeViolations) {
  const key = `${item.rule}|${item.place}|${item.target}`;
  const entry = (axeDistinct[key] ??= { rule: item.rule, impact: item.impact, place: item.place, target: item.target, summary: item.summary, html: item.html, occurrences: 0, views: new Set(), themes: new Set(), languages: new Set() });
  entry.occurrences++; entry.views.add(item.view); entry.themes.add(item.theme); entry.languages.add(item.language);
}
const axeIncomplete = axeStates.flatMap(state => state.incomplete.map(item => ({ ...item, place: placeOf(state) })));
const axeNeedsReview = {};
for (const item of axeIncomplete) { const entry = (axeNeedsReview[item.rule] ??= { total: 0, places: {} }); entry.total++; entry.places[item.place] = (entry.places[item.place] ?? 0) + 1; }
const axeFailures = axeViolations.filter(item => axeFailing.includes(item.impact));
const axeReport = axeOn ? {
  version: axeVersion, tags: AXE_TAGS, failOn: axeFailing, states: axeStates.length, violations: axeViolations.length, failing: axeFailures.length,
  byImpact: count(axeViolations, item => item.impact), byRule: Object.fromEntries(Object.entries(axeByRule).sort((a, b) => b[1].total - a[1].total)),
  needsReview: axeNeedsReview,
  distinct: Object.values(axeDistinct).map(entry => ({ ...entry, views: [...entry.views], themes: [...entry.themes], languages: [...entry.languages] })).sort((a, b) => b.occurrences - a.occurrences).slice(0, 600),
} : { skipped: true };
const report = {
  generatedAt: new Date().toISOString(), policy: 'app/ui/ui-policy.json', durationSeconds: Math.round((performance.now() - started) / 1000),
  matrix: { views, languages, themes, viewports: ['1366x768', '1024x768 (places at rest, English)'], scenarios: ['populated', 'first-run', 'locked', 'empty', 'read-only'] },
  states: states.length, violations: violations.length, byRule, byRuleAndPlace, warnings, axe: axeReport,
  notBuilt: { allowed: args.has('allow-not-built'), places: notBuilt },
  distinct: distinctList.slice(0, 400),
  words: states.map(state => ({ scenario: state.scenario, view: state.view, language: state.language, theme: state.theme, viewport: state.viewport, address: state.address, ...(state.words ?? {}) })).filter(item => item.theme === 'light' && item.viewport === '1366x768'),
  samples: violations.slice(0, 2000),
};
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
log(`${states.length} states, ${violations.length} violations, ${distinctList.length} distinct. Report: ${reportPath}`);
for (const [rule, total] of Object.entries(byRule)) log(`  ${rule}: ${total} (${Object.keys(byRuleAndPlace[rule]).length} places)`);
if (axeOn) {
  log(`axe ${axeVersion}: ${axeStates.length} states, ${axeViolations.length} violations (${axeFailures.length} at ${axeFailing.join('/') || 'no failing impact'}), ${axeIncomplete.length} for a person to check`);
  for (const [rule, entry] of Object.entries(axeReport.byRule)) log(`  axe ${rule} [${entry.impact}]: ${entry.total} (${Object.entries(entry.places).map(([place, total]) => `${place} ${total}`).join(', ')})`);
}
log(`Not built yet (${notBuilt.length}): ${notBuilt.join(' ') || 'none'}`);
const failed = violations.length > 0 || axeFailures.length > 0 || (notBuilt.length > 0 && !args.has('allow-not-built'));
process.exit(failed ? 1 : 0);
