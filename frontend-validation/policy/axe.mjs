// axe-core in the UI checker. The exact-pinned devDependency `axe-core` is injected into each
// page as its own source text (no network) and run over the whole document with the WCAG 2.0,
// 2.1 and 2.2 A and AA rule tags.
import axe from 'axe-core';

export const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'];
export const IMPACTS = ['minor', 'moderate', 'serious', 'critical'];
export const axeVersion = axe.version;
export const axeSource = axe.source;

/** Impacts at or above `level` fail the run; `none` fails nothing. */
export function failingImpacts(level = 'serious') {
  if (level === 'none') return [];
  const from = IMPACTS.indexOf(level);
  if (from < 0) throw new Error(`Unknown axe impact ${level}; use ${IMPACTS.join(', ')} or none.`);
  return IMPACTS.slice(from);
}

/** Inject axe into the page once (it survives hash changes, not reloads). */
export async function injectAxe(page) {
  if (await page.evaluate(() => typeof window.axe === 'object')) return;
  // A string is evaluated as a script by the browser protocol, which a page CSP does not block.
  await page.evaluate(`${axeSource}\n;void 0`);
}

/** How much taller the window must be for every scrolling box to show all of its content. */
const hiddenByScrolling = page => page.evaluate(() => {
  let extra = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  for (const el of document.querySelectorAll('body *')) {
    const s = getComputedStyle(el);
    if (['auto', 'scroll'].includes(s.overflowY) && el.scrollHeight > el.clientHeight + 1) extra = Math.max(extra, el.scrollHeight - el.clientHeight);
  }
  return Math.ceil(extra);
});

/**
 * Run axe on the page as it stands. Returns one entry per rule and node: rule, impact, target, summary.
 * axe skips text a scrolling box has scrolled out of view, and the frame keeps the page in one
 * scrolling column, so the window is made tall enough to show everything for the run (the
 * width, and so the layout's columns, stay as they are), then put back.
 */
export async function runAxe(page, { expand = true } = {}) {
  await injectAxe(page);
  const viewport = page.viewportSize();
  let grown = false;
  if (expand && viewport) {
    for (let round = 0; round < 3; round++) {
      const extra = await hiddenByScrolling(page);
      if (extra <= 0) break;
      const current = page.viewportSize();
      await page.setViewportSize({ width: viewport.width, height: Math.min(current.height + extra, 12000) });
      await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
      grown = true;
    }
  }
  try { return await axeNow(page); } finally {
    if (grown) {
      await page.setViewportSize(viewport);
      await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
    }
  }
}

async function axeNow(page) {
  const results = await page.evaluate(async tags => {
    const outcome = await window.axe.run(document, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations', 'incomplete'], reporter: 'v1' });
    const shape = rule => ({
      rule: rule.id, impact: rule.impact, help: rule.help, tags: rule.tags.filter(tag => /^wcag\d/.test(tag)),
      nodes: rule.nodes.map(node => ({ target: node.target.map(String).join(' '), impact: node.impact ?? rule.impact, summary: (node.failureSummary ?? '').replace(/\s+/g, ' ').trim().slice(0, 240), html: node.html.slice(0, 160) })),
    });
    return { violations: outcome.violations.map(shape), incomplete: outcome.incomplete.map(shape) };
  }, AXE_TAGS);
  const flat = rules => rules.flatMap(rule => rule.nodes.map(node => ({ rule: rule.rule, impact: node.impact, help: rule.help, wcag: rule.tags, target: node.target, summary: node.summary, html: node.html })));
  // Violations fail by impact; "incomplete" is what axe could not decide (needs a person) and is only counted.
  return Object.assign(flat(results.violations), { incomplete: flat(results.incomplete) });
}
