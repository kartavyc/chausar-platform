// The checker checks itself: a page with one planted fault per rule must produce each rule's
// finding, and the clean preview must not. Run by check.mjs before the walk.
import { auditInPage } from './audit.mjs';
import { runAxe } from './axe.mjs';

const PLANTED = `
<main data-region="page" style="width:600px">
  <p id="tiny" style="font-size:9px">Tiny words</p>
  <p id="odd" style="font-size:17px">Odd size</p>
  <p id="faint" style="color:#cfd2d4">Faint words on the page</p>
  <p id="dash">One thing — another</p>
  <p id="bang">Done!</p>
  <div style="display:flex;gap:2px"><button id="small1" style="width:12px;height:12px;padding:0">a</button><button id="small2" style="width:12px;height:12px;padding:0">b</button></div>
  <button class="m-press" id="long">This button label is far too long</button>
  <div style="width:40px;overflow:hidden;white-space:nowrap"><span class="fig" id="clipped">₹12,34,56,789</span></div>
  <img id="remote" alt="" src="https://example.invalid/x.png" width="1" height="1" style="width:2px;height:2px">
  <span id="spin" style="display:inline-block;width:20px;height:20px;animation:planted-spin 1s linear infinite">x</span>
  <span id="move" style="display:inline-block;transition:opacity 300ms">move</span>
  <svg width="40" height="20"><rect id="pale" x="0" y="0" width="20" height="20" fill="#eeeeee"></rect></svg>
  <p>${'word '.repeat(130)}</p>
  <div id="past" style="width:1500px;height:4px"></div>
  <table id="widetable"><tr><td style="white-space:nowrap">${'cell '.repeat(400)}</td></tr></table>
</main>
<nav data-region="rail" id="tinyrail" style="position:absolute;top:0;right:0;width:40px;height:20px"><a href="#/">x</a></nav>
<div id="axe-planted"><button id="nameless" style="width:40px;height:40px"></button><input id="unlabelled" type="text"><span id="twin">a</span><span id="twin">b</span></div>
<style>@keyframes planted-spin { to { transform: rotate(360deg); } }</style>`;
// axe-core's rules that the planted page must trip (a nameless button, an unlabelled field, the faint words).
const EXPECTED_AXE = ['button-name', 'label', 'color-contrast'];
const EXPECTED = ['text-size-minimum', 'text-size-token', 'contrast-text', 'punctuation', 'control-size', 'button-label', 'figure-clipped|figure-overflow', 'remote-image', 'animation-repeats', 'reduced-motion', 'contrast-mark', 'words', 'page-scroll-x', 'overflow-viewport', 'rail-layout', 'table-scroll'];

export async function selfTest(browser, policy, url, { axe = true } = {}) {
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.route('https://example.invalid/**', route => route.fulfill({ status: 204, body: '' }));
  await page.goto(`${url}index.html?scenario=populated`);
  await page.waitForFunction(() => window.__chausarPreview?.ready === true, null, { timeout: 20000 });
  const clean = await page.evaluate(auditInPage, { policy, view: 'guided', language: 'en', theme: 'light', notBuiltTexts: [], reducedMotion: true });
  await page.evaluate(html => { document.body.innerHTML = html; document.documentElement.dataset.view = 'guided'; }, PLANTED);
  const planted = await page.evaluate(auditInPage, { policy, view: 'guided', language: 'en', theme: 'light', notBuiltTexts: [], reducedMotion: true });
  const plantedAxe = axe ? await runAxe(page) : [];
  await context.close();
  const found = new Set(planted.findings.map(item => item.rule));
  const foundAxe = new Set(plantedAxe.filter(item => ['serious', 'critical'].includes(item.impact)).map(item => item.rule));
  const missing = [...EXPECTED.filter(rule => !rule.split('|').some(name => found.has(name))), ...(axe ? EXPECTED_AXE.filter(rule => !foundAxe.has(rule)).map(rule => `axe:${rule}`) : [])];
  return { missing, cleanFindings: clean.findings.filter(item => item.rule !== 'button-label').length, plantedFindings: planted.findings.length + plantedAxe.length };
}
