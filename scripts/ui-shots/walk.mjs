#!/usr/bin/env node
// The Ink screenshot walk and real-browser checks (w3 package 3I; catalogue U14 and Q24).
//
// For every case in scripts/ui-shots/cases.mjs it opens the app on the fake engine of `npm run dev:ui` in headless
// Chrome, at 1280 and 390 wide, in the light and the dark theme (and in Hindi at 390, light), and:
//   - takes a full-height screenshot into app/ui/.shots/ (gitignored): <case>--<width>-<theme>[-hi].png;
//   - runs axe-core (from node_modules) on the page with colour contrast ON; any violation fails the walk;
//   - checks what jsdom cannot: no page-wide sideways scroll, no text that is a text key, no console error, and in
//     Hindi that every count is set in the body face (base.css, `:lang(hi) [data-count]`);
//   - presses through the focus plan (J and K, the second ask, a sheet, the business menu) and checks where focus lands.
// It writes app/ui/.shots/report.json, report.md and index.html (the boards beside the shots), and exits 1 when any
// check fails, except the findings scripts/ui-shots/accepted.mjs lists with their reasons (reported, not failed).
// With --publish it also copies the shots that match a direction D board (1280 light and 390 light) into
// docs/superpowers/designs/ink-v2-direction-d/walk/ and writes side-by-side.html and WALK.md there from boards.mjs;
// --publish-only does that from the last walk's shots and report, without walking again.
//
// Usage (from the repo root):
//   node scripts/ui-shots/walk.mjs [--base=http://localhost:5178] [--port=5179] [--cdp=9481] [--workers=4]
//                                  [--out=app/ui/.shots] [--profiles=<dir>] [--chrome=<path>] [--only=today,team]
//                                  [--no-hindi] [--publish | --publish-only]
// Without --base it starts its own dev server (vite --mode fake) on --port and stops it at the end. Each worker is
// one Chrome on its own debugging port (--cdp, --cdp+1, ...) with its own profile under --profiles (default: inside
// --out, so on the repo's drive), removed when the walk ends.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Browser, findChrome } from './browser.mjs';
import { DEV_PAGE, INTERACTIONS, PLACES, SHEETS } from './cases.mjs';
import { acceptedFor, listedMd } from './accepted.mjs';
import { publish, writeIndex } from './publish.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const found = args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!found) return fallback;
  return found.includes('=') ? found.slice(found.indexOf('=') + 1) : true;
};
const OUT = resolve(ROOT, String(option('out', 'app/ui/.shots')));
const PROFILES = resolve(String(option('profiles', join(OUT, '.profiles'))));
const CDP = Number(option('cdp', 9481));
const WORKERS = Math.max(1, Math.min(8, Number(option('workers', 4))));
const ONLY = option('only', '') ? String(option('only')).split(',') : null;
const HINDI = !option('no-hindi', false);
const PHONE_HEIGHT = 844;
const DESK_HEIGHT = 860;
const MAX_HEIGHT = 9000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------------------------------------- server

async function serve() {
  const base = option('base', '');
  if (base) return { base: String(base).replace(/\/$/, ''), stop: async () => {} };
  const port = Number(option('port', 5179));
  const vite = spawn(process.execPath, [join(ROOT, 'node_modules/vite/bin/vite.js'), '--config', 'app/ui/vite.config.ts', '--mode', 'fake', '--port', String(port), '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
  const url = `http://localhost:${port}`;
  for (let i = 0; i < 150; i++) {
    try { if ((await fetch(url)).ok) break; } catch { /* not yet */ }
    if (vite.exitCode !== null) throw new Error(`the dev server stopped (port ${port} taken?)`);
    await sleep(200);
  }
  return {
    base: url,
    stop: async () => {
      if (vite.exitCode !== null) return;
      vite.kill();
      await Promise.race([new Promise((r) => vite.once('exit', r)), sleep(3000)]);
    },
  };
}

// ------------------------------------------------------------------------------------------------------------- jobs

const devPage = existsSync(join(ROOT, 'app/ui/parts.html'));
const all = [...PLACES, ...SHEETS, ...(devPage ? DEV_PAGE : [])].filter((c) => !ONLY || ONLY.includes(c.id));

function jobsOf() {
  const jobs = [];
  for (const c of all) {
    for (const width of c.widths ?? [1280, 390]) {
      for (const theme of ['light', 'dark']) jobs.push({ kind: 'shot', case: c, width, theme, hindi: false });
    }
    if (HINDI && c.hindi) jobs.push({ kind: 'shot', case: c, width: 390, theme: 'light', hindi: true });
  }
  for (const c of INTERACTIONS.filter((i) => !ONLY || ONLY.includes(i.id))) {
    for (const width of c.widths ?? [1280]) jobs.push({ kind: 'focus', case: c, width, theme: 'light', hindi: false });
  }
  return jobs;
}

const fileOf = (job) => `${job.case.id}--${job.width}-${job.theme}${job.hindi ? '-hi' : ''}.png`;

// ----------------------------------------------------------------------------------------------- in-page helpers

/** An expression that yields the first visible button, link, tab or summary with this accessible name. */
function button(name, within = 'document') {
  const scope = within === 'document' ? 'document' : `document.querySelector(${JSON.stringify(within)})`;
  const test = name instanceof RegExp ? `new RegExp(${JSON.stringify(name.source)}, ${JSON.stringify(name.flags)}).test(n)` : `n === ${JSON.stringify(name)}`;
  return `[...((${scope}) ?? document).querySelectorAll('button, a[href], [role=tab], [role=button], summary')].find((e) => {
    const n = (e.getAttribute('aria-label') || e.textContent || '').replace(/\\s+/g, ' ').trim();
    const r = e.getBoundingClientRect();
    return ${test} && r.width > 0 && r.height > 0;
  })`;
}

const SETTLED = `(async () => {
  const loading = /^(Loading|लोड हो रहा है)/;
  let ready = false;
  // A cold dev server compiles the app on the first visit, which can take a while with four browsers at once.
  for (let i = 0; i < 1200 && !ready; i++) {
    ready = Boolean(!document.querySelector('[data-boot]') && document.querySelector('#root h1, #root [data-specimens]')
      && ![...document.querySelectorAll('p, h2, h3, li')].some((n) => loading.test((n.textContent || '').trim()))
      && (!location.hash.includes('sheet=') || document.querySelector('aside h2')));
    if (!ready) await new Promise((r) => setTimeout(r, 100));
  }
  await document.fonts.ready;
  // Motion runs once and ends within 400 ms; wait for it, so axe never measures a colour halfway through a fade.
  for (let i = 0; i < 30 && document.getAnimations().some((a) => a.playState === 'running'); i++) await new Promise((r) => setTimeout(r, 100));
  return ready;
})()`;

/** How much taller than the window the page's scrolling boxes are, so the shot can show everything. */
const OVERFLOW = `(() => {
  // On a phone a sheet covers the screen and the place behind it is inert: only the sheet's own height counts.
  const cover = document.querySelector('[data-cover]');
  const scope = cover && cover.querySelector('aside') ? [cover, ...cover.querySelectorAll('*')] : document.querySelectorAll('body *');
  const boxes = [document.scrollingElement, ...scope].filter((e) => {
    if (!e) return false;
    const s = getComputedStyle(e);
    return (e === document.scrollingElement || s.overflowY === 'auto' || s.overflowY === 'scroll') && e.scrollHeight > e.clientHeight + 1;
  });
  return Math.max(0, ...boxes.map((e) => e.scrollHeight - e.clientHeight));
})()`;

/** The checks jsdom cannot make. */
const PAGE_CHECKS = (width, hindi) => `(() => {
  const problems = [];
  const doc = document.scrollingElement;
  if (doc.scrollWidth > ${width} + 1) problems.push('the page scrolls sideways: ' + doc.scrollWidth + ' px wide in a ' + ${width} + ' px window');
  const main = document.querySelector('main');
  if (main && main.scrollWidth > main.clientWidth + 1) {
    const wide = [...main.querySelectorAll('*')].filter((e) => e.getBoundingClientRect().right > main.getBoundingClientRect().right + 1 && getComputedStyle(e).position !== 'fixed')
      .filter((e) => !e.closest('[data-scroll], [class*=hscroll], [class*=scroll]'))
      .slice(0, 3).map((e) => '<' + e.tagName.toLowerCase() + ' class=' + (e.className?.baseVal ?? e.className) + '> "' + (e.textContent || '').trim().slice(0, 40) + '"');
    if (wide.length) problems.push('the place is wider than its column: ' + wide.join('; '));
  }
  const keyLike = /^[a-z]+(\\.[a-zA-Z0-9]+)+$/;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = (n.textContent || '').trim();
    // Only words on screen: a closed fold's lines are not shown, and engine ids (a tool's name, files.read) are drawn in mono.
    const shown = n.parentElement && n.parentElement.checkVisibility({ visibilityProperty: true });
    if (shown && keyLike.test(t) && !n.parentElement.closest('script, style, [data-content], code, .mono')) problems.push('a text key shows as text: ' + t);
    if (/\\u2014/.test(t)) problems.push('an em dash in: ' + t.slice(0, 60));
  }
  ${hindi ? `for (const c of document.querySelectorAll('[data-count]')) {
    const face = getComputedStyle(c).fontFamily;
    if (!/^"?Instrument Sans/.test(face)) { problems.push('a Hindi count is not in the body face: "' + c.textContent.trim() + '" in ' + face); break; }
  }` : ''}
  return problems;
})()`;

let AXE = '';
async function axe(b) {
  if (!AXE) AXE = readFileSync(join(ROOT, 'node_modules/axe-core/axe.min.js'), 'utf8');
  const has = await b.evaluate(`typeof window.axe === 'object'`);
  if (!has) await b.evaluate(AXE + ';true');
  return b.evaluate(`axe.run(document, { rules: { 'color-contrast': { enabled: true } }, resultTypes: ['violations', 'incomplete'] }).then((r) => ({
    violations: r.violations.flatMap((v) => v.nodes.map((n) => ({ id: v.id, impact: v.impact, help: v.help, target: n.target.join(' '), summary: (n.failureSummary || '').split('\\n').slice(1, 3).join(' ').trim(), html: n.html.slice(0, 160) }))),
    contrastUnsure: (r.incomplete.find((v) => v.id === 'color-contrast')?.nodes ?? []).map((n) => ({ target: n.target.join(' '), why: (n.any[0]?.message || '').slice(0, 120) })),
  }))`);
}

async function stepsOf(b, steps, hindi = false) {
  const common = JSON.parse(readFileSync(join(ROOT, 'app/ui/src/text', hindi ? 'hi' : 'en', 'common.json'), 'utf8'));
  const switchWords = common['business.switchTo'];
  const switchPattern = new RegExp(switchWords.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$');
  for (const step of steps ?? []) {
    if (step.press !== undefined) {
      // In Hindi a button carries its Hindi name (`hi`), when the case gives one.
      const name = hindi && step.hi !== undefined ? step.hi : step.press;
      await b.click(button(name, step.in ?? 'document'), `"${name}"${step.in ? ` in ${step.in}` : ''}`);
      await sleep(500);
    } else if (step.business) {
      await b.click(button(switchPattern), 'the business button');
      await sleep(400);
      await b.click(`(() => { const toggle = [...document.querySelectorAll('button[aria-controls]')].find(e => e.textContent.trim().endsWith(${JSON.stringify(switchWords)})); const menu = toggle && document.getElementById(toggle.getAttribute('aria-controls')); return menu && [...menu.querySelectorAll('button')].find(e => e.textContent.trim().startsWith(${JSON.stringify(step.business)})); })()`, `business ${step.business}`);
      await sleep(900);
    } else if (step.hash) {
      await b.evaluate(`location.hash = ${JSON.stringify(step.hash)}; true`);
      await sleep(700);
    } else if (step.key) {
      await b.key(step.key);
      await sleep(250);
    } else if (step.unfold) {
      await b.evaluate(`document.querySelectorAll('details').forEach((d) => { d.open = true; }); true`);
      await sleep(250);
    }
    await b.evaluate(SETTLED);
  }
}

// ---------------------------------------------------------------------------------------------------------- worker

async function runJob(b, base, job) {
  const { width, theme, hindi } = job;
  const c = job.case;
  const height = width < 760 ? PHONE_HEIGHT : DESK_HEIGHT;
  const result = { id: c.id, kind: job.kind, width, theme, hindi, file: job.kind === 'shot' ? fileOf(job) : null, problems: [], axe: [], listed: [], contrastUnsure: [], console: [], covered: false };
  const errors = [];
  let offReload = () => {};
  const off = b.on((m) => {
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.exception?.description?.split('\n')[0] ?? 'an exception');
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 200));
  });
  try {
    await b.viewport(width, height);
    await b.theme(theme === 'dark');
    // W4 4Z: Hindi comes from the computer's languages, the way the app picks it (never `?lang=hi`, which hung a shot),
    // and a case may start on a later day (`clock`).
    await b.languages(hindi ? 'hi-IN,hi' : 'en-US,en');
    await b.clock(c.clock ?? null);
    const page = c.page ?? '';
    const hashAt = c.path.indexOf('#');
    const query = new URLSearchParams((hashAt >= 0 ? c.path.slice(0, hashAt) : c.path).replace(/^\?/, '')).toString();
    await b.go(`${base}/${page}${query ? `?${query}` : ''}${hashAt >= 0 ? c.path.slice(hashAt) : ''}`);
    // From here on the page must not load again: a dev server reloads every open page when a source file changes
    // (other work in the same checkout), and a case caught by one is walked again (see main).
    offReload = b.on((m) => { if (m.method === 'Page.frameNavigated' && !m.params.frame.parentId) result.reloaded = true; });
    if (!(await b.evaluate(SETTLED))) throw new Error('the page did not show its place within 120 s');
    const lang = await b.evaluate('document.documentElement.lang');
    if (lang !== (hindi ? 'hi' : 'en')) result.problems.push(`the app chose the language "${lang}", not ${hindi ? 'Hindi' : 'English'}`);
    await sleep(400);
    if (job.kind === 'focus') {
      result.problems.push(...await c.run(b, { sleep, button }));
      return result;
    }
    await stepsOf(b, c.steps, hindi);
    await sleep(450); // motion settles in 400 ms or less
    result.problems.push(...await b.evaluate(PAGE_CHECKS(width, hindi)));
    const found = await axe(b);
    result.covered = await b.evaluate(`Boolean(document.querySelector('[data-cover] aside'))`);
    for (const finding of found.violations) {
      const accepted = acceptedFor(result, finding);
      if (accepted) result.listed.push({ ...finding, why: accepted.why });
      else result.axe.push(finding);
    }
    result.contrastUnsure = found.contrastUnsure;
    // Grow the window until nothing scrolls, so the shot holds the whole place and its sheet.
    let tall = height;
    for (let i = 0; i < 3; i++) {
      const extra = await b.evaluate(OVERFLOW);
      if (extra <= 1) break;
      tall = Math.min(MAX_HEIGHT, tall + extra);
      await b.viewport(width, tall);
      await sleep(350);
      if (tall >= MAX_HEIGHT) break;
    }
    writeFileSync(join(OUT, result.file), await b.screenshot(width, tall));
    result.height = tall;
    return result;
  } catch (error) {
    result.problems.push(`the walk could not finish this case: ${error.message}`);
    return result;
  } finally {
    off();
    offReload();
    result.console = errors.filter((e) => !/Download the React DevTools|\[vite\]/.test(e));
    if (result.console.length) result.problems.push(...result.console.map((e) => `console: ${e}`));
  }
}

// ------------------------------------------------------------------------------------------------------------- main

async function main() {
  if (option('publish-only', false)) {
    const last = JSON.parse(readFileSync(join(OUT, 'report.json'), 'utf8'));
    const copied = publish(OUT, all, last);
    console.log(`Published ${copied.length} shots and the pages from the walk of ${last.at}.`);
    process.exit(0);
  }
  mkdirSync(OUT, { recursive: true });
  for (const f of readdirSync(OUT)) if (f.endsWith('.png') && !ONLY) rmSync(join(OUT, f));
  const chrome = findChrome(option('chrome', ''));
  const server = await serve();
  const jobs = jobsOf();
  const browsers = [];
  const results = [];
  const stopAll = async () => {
    await Promise.all(browsers.map((b) => b.stop()));
    await server.stop();
    // Chrome can hold a profile file for a moment after it exits; a profile left behind is removed on the next walk.
    for (let i = 0; i < 10 && existsSync(PROFILES); i++) {
      try { rmSync(PROFILES, { recursive: true, force: true }); } catch { await sleep(500); }
    }
  };
  process.once('SIGINT', () => { void stopAll().then(() => process.exit(130)); });
  try {
    for (let i = 0; i < Math.min(WORKERS, jobs.length); i++) browsers.push(await new Browser({ chrome, port: CDP + i, profiles: PROFILES }).start());
    let next = 0;
    let done = 0;
    await Promise.all(browsers.map(async (b) => {
      while (next < jobs.length) {
        const job = jobs[next++];
        let result = await runJob(b, server.base, job);
        // A reload (a source file changed under the dev server) or a page that never settled (a cold server compiling)
        // is the server's doing, not the place's: walk the case again, twice at most.
        const retry = (r) => r.reloaded || r.problems.some((p) => p.startsWith('the walk could not finish'));
        for (let again = 0; again < 2 && retry(result); again++) result = await runJob(b, server.base, job);
        if (result.reloaded) result.problems.push('the dev server reloaded the page three times during this case (a source file kept changing)');
        results.push(result);
        done += 1;
        const bad = result.axe.length + result.problems.length;
        process.stdout.write(`${String(done).padStart(3)}/${jobs.length} ${bad ? 'FAIL' : 'ok  '} ${result.id} ${result.width} ${result.theme}${result.hindi ? ' hi' : ''}${bad ? ` (${result.axe.length} axe, ${result.problems.length} other)` : ''}\n`);
      }
    }));
  } finally {
    await stopAll();
  }
  const order = (r) => [all.findIndex((c) => c.id === r.id), r.kind, r.width, r.theme, r.hindi];
  results.sort((a, z) => JSON.stringify(order(a)).localeCompare(JSON.stringify(order(z))));
  const report = { at: new Date().toISOString(), base: server.base, cases: all.length, jobs: results.length, failed: results.filter((r) => r.axe.length || r.problems.length).length, results };
  writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 1));
  writeFileSync(join(OUT, 'report.md'), reportMd(report));
  writeIndex(OUT, all, results);
  if (option('publish', false)) publish(OUT, all, report);
  console.log(`\n${report.jobs} checks, ${report.failed} failed. Shots and report in ${OUT}`);
  process.exit(report.failed ? 1 : 0);
}

function reportMd(report) {
  const lines = [`# Ink walk, ${report.at}`, '', `${report.jobs} checks over ${report.cases} cases; ${report.failed} with a problem.`, ''];
  for (const r of report.results) {
    if (!r.axe.length && !r.problems.length) continue;
    lines.push(`## ${r.id}, ${r.width}, ${r.theme}${r.hindi ? ', Hindi' : ''}`);
    for (const v of r.axe) lines.push(`- axe ${v.id} (${v.impact}): ${v.help} at \`${v.target}\`. ${v.summary}`);
    for (const p of r.problems) lines.push(`- ${p}`);
    lines.push('');
  }
  lines.push(...listedMd(report));
  const unsure = report.results.filter((r) => r.contrastUnsure?.length);
  if (unsure.length) {
    lines.push('## Contrast axe could not decide (needs an eye)', '');
    const seen = new Map();
    for (const r of unsure) for (const u of r.contrastUnsure) { const key = `${u.why}`; seen.set(key, (seen.get(key) ?? 0) + 1); }
    for (const [why, n] of [...seen].sort((a, z) => z[1] - a[1])) lines.push(`- ${n} x ${why}`);
  }
  return `${lines.join('\n')}\n`;
}

await main();
