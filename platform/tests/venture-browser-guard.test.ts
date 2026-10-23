// The script and read-back guard for the posting window (catalogue K4, Ink v2 wave 2 package 2B2). Every page script
// Chausar runs passes checkPageScript first: only in Chausar's own tab, only on http or https, and never one that reads
// cookies, stored data, saved sign-ins, the clipboard or a password or card field, sends data elsewhere, moves the
// page or hides what it does. It fails closed. Audit lines carry the sha256 and counts only. Read-backs (the post's
// address, the confirm text, picked attributes) are screened by core/secrets.ts before they are kept or shown.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import type { Context } from '../runtime/contracts.ts';
import type { PostingStepsView, VentureDeps } from '../runtime/venture/contracts.ts';
import { VENTURE_ERRORS } from '../runtime/venture/contracts.ts';
import { houseStyleFindings } from '../runtime/venture/records.ts';
import { handlers as build } from '../runtime/venture/build/index.ts';
import { IS_PICKED, LINKS_IN, PAGE_LANG, PAGE_NOTICE, PICK_ELEMENT, READ_ELEMENT, UNMARK_PICK } from '../runtime/venture/build/browser.ts';
import { MAX_SCRIPT_LINE, auditLine, checkPageScript, requirePageScript } from '../runtime/venture/build/page-guard.ts';
import { owner, setup } from './venture-views-env.ts';
import { X_PAGE, el, fakeBrowserPage, type FakePageModel } from './venture-fake-page.ts';

type Handler = (deps: VentureDeps, ctx: Context, payload: unknown) => Promise<unknown>;
const PAGE = 'https://x.com/compose/post';
const allowed = (source: unknown, pageUrl: unknown = PAGE, ownTab = true) => checkPageScript({ source, pageUrl, ownTab });

test("Chausar's own page scripts pass the guard in its own tab on an https page", () => {
  for (const script of [READ_ELEMENT, PAGE_NOTICE, PAGE_LANG, PICK_ELEMENT, LINKS_IN, IS_PICKED, UNMARK_PICK]) {
    const checked = allowed(script);
    assert.equal(checked.allowed, true, checked.allowed ? '' : `${script.name}: ${checked.reason}`);
    assert.equal(checked.audit.outcome, 'allowed');
  }
});

test('the guard refuses a script that reads secrets, sends data, moves the page or hides what it does', () => {
  const refusals: [string, RegExp][] = [
    ['() => document.cookie', /cookies/],
    ['() => window.localStorage.getItem("a")', /stores/],
    ['() => sessionStorage.length', /stores/],
    ['() => indexedDB.open("x")', /stores/],
    ['() => navigator.credentials.get({})', /sign-ins or the clipboard/],
    ['() => navigator.clipboard.readText()', /sign-ins or the clipboard/],
    ['() => document.querySelector("input[type=password]")', /password or card/],
    ['() => document.querySelector(\'[autocomplete="cc-number"]\')', /password or card/],
    ['() => document.querySelector("[autocomplete^=cc-]")', /password or card/],
    ['(field) => field.value', /typed/],
    ['() => fetch("https://elsewhere.example/")', /sends data/],
    ['() => new XMLHttpRequest()', /sends data/],
    ['() => navigator.sendBeacon("https://elsewhere.example/", "x")', /sends data/],
    ['() => new WebSocket("wss://elsewhere.example/")', /sends data/],
    ['() => new EventSource("/x")', /sends data/],
    ['() => window.parent.postMessage("x", "*")', /sends data/],
    ['() => window.open("https://elsewhere.example/")', /sends data/],
    ['() => { location = "https://elsewhere.example/"; }', /moves the page/],
    ['() => { location.href = "https://elsewhere.example/"; }', /moves the page/],
    ['() => location.assign("https://elsewhere.example/")', /moves the page/],
    ['() => eval("1")', /hidden code/],
    ['() => new Function("return 1")()', /hidden code/],
    ['() => import("https://elsewhere.example/x.js")', /hidden code/],
    ['() => atob("eA==")', /hidden code/],
    ['() => "\\x63ookie"', /hides/],
    ['() => "\\u0063ookie"', /hides/],
    ['() => document["coo" + "kie"]', /hides/],
    ['() => window["fe" + "tch"]("x")', /hides/],
    ['(element) => element["value"]', /hides/],
    [`() => ${'1+'.repeat(MAX_SCRIPT_LINE / 2 + 1)}1`, /hides/],
    ['(element) => element.click()', /clicks or submits/],
    ['(form) => form.submit()', /clicks or submits/],
    ['(element) => { element.innerHTML = "<b>x</b>"; }', /markup/],
  ];
  for (const [source, reason] of refusals) {
    const checked = allowed(source);
    assert.equal(checked.allowed, false, source.slice(0, 80));
    assert.match(checked.allowed ? '' : checked.reason, reason, source.slice(0, 80));
    assert.equal(checked.audit.outcome, 'refused');
    assert.deepEqual(houseStyleFindings(checked.allowed ? '' : checked.reason), []);
  }
  assert.throws(() => requirePageScript({ source: '() => document.cookie', pageUrl: PAGE, ownTab: true }), (error: any) => error.code === 'PAGE_SCRIPT_REFUSED' && /cookies/.test(error.message));
  assert.ok((VENTURE_ERRORS as readonly string[]).includes('PAGE_SCRIPT_REFUSED'));
});

test("a page that is not http or https, or not Chausar's own tab, is refused; a guard that cannot check refuses", () => {
  for (const url of ['file:///C:/Users/owner/page.html', 'about:blank', 'chrome://settings', 'data:text/html,hi', 'javascript:void(0)', 'not a url', null]) {
    const checked = allowed(PAGE_LANG, url);
    assert.equal(checked.allowed, false, String(url));
    assert.match(checked.allowed ? '' : checked.reason, /http or https/);
  }
  const other = allowed(PAGE_LANG, PAGE, false);
  assert.equal(other.allowed, false);
  assert.match(other.allowed ? '' : other.reason, /own tab/);
  const broken = allowed({ toString() { throw new Error('boom'); } });
  assert.equal(broken.allowed, false);
  assert.match(broken.allowed ? '' : broken.reason, /could not check/);
  assert.equal(allowed(42).allowed, false);
});

test('an audit line carries the sha256 and the counts, never the script', () => {
  const source = '() => document.documentElement.lang';
  const checked = allowed(source);
  assert.match(checked.audit.sha256 ?? '', /^[0-9a-f]{64}$/);
  assert.deepEqual([checked.audit.characters, checked.audit.lines], [source.length, 1]);
  const line = auditLine(checked.audit);
  assert.match(line, /^page script [0-9a-f]{64}: \d+ characters, \d+ lines, allowed$/);
  assert.ok(!line.includes('document'), 'no script text in the audit');
  assert.match(auditLine(allowed('() => document.cookie').audit), /, refused$/);
});

test('the port runs every page script through the guard, and writes an audit line for each', async () => {
  const fake = fakeBrowserPage(X_PAGE);
  assert.equal((await fake.post()).outcome, 'posted');
  assert.ok(fake.audit.length >= 4, fake.audit.join('\n'));
  for (const line of fake.audit) assert.match(line, /^page script [0-9a-f]{64}: \d+ characters, \d+ lines, (?:allowed|refused)$/);
  // Without an audit sink of its own, the port keeps the lines in a file beside the profile folders.
  const filed = fakeBrowserPage(X_PAGE, { fileAudit: true });
  await filed.post();
  const kept = (filed.disk.files.get('C:/profiles/page-scripts.audit.log') ?? '').trim().split('\n');
  assert.ok(kept.length >= 4, kept.join('\n'));
  for (const line of kept) assert.match(line, /^\d{4}-\d{2}-\d{2}T[\d:.]+Z x page script [0-9a-f]{64}: \d+ characters, \d+ lines, (?:allowed|refused)$/);

  // A page the guard refuses: nothing is evaluated, nothing is posted.
  const local = fakeBrowserPage({ ...X_PAGE, url: 'file:///C:/Users/owner/compose.html' });
  const result = await local.post();
  assert.equal(result.outcome, 'not-sent');
  assert.match(result.line, /Nothing was posted\./);
  assert.equal(local.evaluated(), 0, 'no script ran on a page that is not http or https');
  assert.equal(local.clicks(), 0);
  assert.ok(local.audit.every(line => line.endsWith('refused')));
});

test('static: browser.ts evaluates a script only inside the guarded runner', async () => {
  const source = await readFile(new URL('../runtime/venture/build/browser.ts', import.meta.url), 'utf8');
  const calls = [...source.matchAll(/\.evaluate\s*\??\.?\s*\(/g)].map(match => source.slice(0, match.index).split('\n').length);
  const runner = source.indexOf('// The guarded runner: begin');
  const end = source.indexOf('// The guarded runner: end');
  assert.ok(runner > 0 && end > runner, 'the runner is marked');
  const [from, to] = [source.slice(0, runner).split('\n').length, source.slice(0, end).split('\n').length];
  assert.ok(calls.length >= 2);
  for (const line of calls) assert.ok(line > from && line < to, `browser.ts:${line} evaluates outside the guarded runner`);
});

test('checkSteps on a page the guard refuses answers PAGE_SCRIPT_REFUSED', async () => {
  const env = await setup();
  const fake = fakeBrowserPage({ ...X_PAGE, url: 'about:blank' });
  const deps = { ...env.deps, connectors: { browser: fake.port, appReviewed: [], postTimeoutMs: 100 } } as VentureDeps;
  await assert.rejects((build as Record<string, Handler>)['venture.posting.checkSteps'](deps, owner, { connectorId: 'x' }), (error: any) => error.code === 'PAGE_SCRIPT_REFUSED');
  assert.equal(fake.evaluated(), 0);
});

test("read-backs go through the secret screen: an address the screen changes is not kept", async () => {
  // A handle shaped like a PAN: the screen redacts it, so the address is not kept at all rather than kept changed.
  const shaped: FakePageModel = { ...X_PAGE, afterClick: { elements: { 'test-id:toast': [el({}, { text: 'Your post was sent.', links: ['https://x.com/ABCPE1234F/status/1849000000000000001'] })] } } };
  const result = await fakeBrowserPage(shaped).post();
  assert.equal(result.outcome, 'posted');
  assert.equal(result.outcome === 'posted' && result.url, null);

  // A confirm text that holds a one time code still confirms; the code is never kept.
  const otp: FakePageModel = { ...X_PAGE, afterClick: { elements: { 'test-id:toast': [el({}, { text: 'Your post was sent. 482913 is your OTP.' })] } } };
  const confirmed = await fakeBrowserPage(otp).post();
  assert.equal(confirmed.outcome, 'posted');
  assert.ok(!JSON.stringify(confirmed).includes('482913'));

  const env = await setup();
  const picked = fakeBrowserPage({
    ...X_PAGE, elements: { 'test-id:tweetTextarea_0': X_PAGE.elements!['test-id:tweetTextarea_0'] },
    pick: { testId: 'sendPostButton', role: 'button', name: 'Send 482913 is your OTP', ariaLabel: null, xpath: null },
    picked: { 'test-id:sendPostButton': [el({ tag: 'button' })], 'role:button[name=Send 482913 is your OTP]': [el({ tag: 'button' })] },
  });
  const deps = { ...env.deps, connectors: { browser: picked.port, appReviewed: [], postTimeoutMs: 100 } } as VentureDeps;
  const steps = await (build as Record<string, Handler>)['venture.posting.checkSteps'](deps, owner, { connectorId: 'x' }) as PostingStepsView;
  assert.ok(!JSON.stringify(steps).includes('482913'));
  assert.ok(!JSON.stringify(env.store.read()).includes('482913'));
});
