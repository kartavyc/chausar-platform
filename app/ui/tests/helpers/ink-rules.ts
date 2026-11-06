/**
 * The Ink rules a test can see in rendered output, as plain assertions every part and place test calls
 * (docs/superpowers/plans/2026-10-23-chausar-ink-v2-w3.md, "The rules that hold").
 *
 *   assertFiguresProved(root?)  every money figure carries its proof: a receipt, or the "model estimate" label
 *   assertOnePrimary(root?)     every card and list row holds at most one filled primary button
 *   assertNoInlineStyles(root?) nothing carries a style attribute (lengths are svg attributes, states are data-*)
 *   assertInkRules(root?)       all three, with every problem reported at once
 *
 * `root` defaults to `document.body`, the whole page, so sheets, menus and anything else rendered in a portal are
 * checked too. A place test should call them with no argument (or `document.body`); passing
 * `render(...).container` checks only what sits inside that container. Each checks the root and everything in it,
 * and throws an Error listing every element that breaks the rule, with enough words to find it. They throw plain
 * Errors rather than calling `expect`, so `expect(() => assertOnePrimary()).toThrow()` works and the helpers can be
 * tested themselves (tests/parts/figure.test.tsx).
 *
 * The markers they read are set by the parts, never by hand in a place:
 *   [data-figure]        the Figure part: exactly one engine figure with its proof (src/parts/Figure.tsx)
 *   [data-ui-number]     that figure's value, in DM Mono with tabular digits
 *   [data-figure-words]  the engine's words after a figure's amount ("includes estimates"), in the body face; they
 *                        never hold an amount of their own
 *   [data-receipt="id"]  a Receipt control (src/parts/Receipt.tsx): a button or link with a non-empty receipt id
 *   [data-estimate]      the "model estimate" chip, or a model-written value with its chip (src/parts/ModelEstimate.tsx)
 *   [data-figure-group]  a block whose amounts are proved together by the one receipt control or estimate chip inside
 *                        it: an invoice preview's lines and total, a change's old and new price
 *   [data-count]         a Count: steps, people, runs; never money, so it needs no proof and is no data-ui-number
 *   [data-content]       quoted words, not Chausar's own: a draft's text, a post, a title option, a message, a file's
 *                        or an instruction's lines. Set only on the element that holds the quote itself
 *   [data-engine-line]   engine-written text that holds an amount without a receipt (a Today row's line, Money's
 *                        engine words): until W4 4J1, see below
 *   [data-card]          a card (approval card, stat tile, agent card); [data-row] a list row (Row, JobList, ...)
 *   [data-variant="primary"]  the Button part's filled primary (a locked primary still counts: it is the one)
 *
 * Money is any text that looks like an amount: a rupee, dollar or euro sign followed by a digit. Outside a figure,
 * a figure group or an estimate it is bare money and fails, wherever it sits (text, svg labels, screen-reader text).
 * What the owner types (inputs, text areas, select options) and receipt ids are never checked. Nor are quoted words
 * inside `[data-content]` ("Classes at ₹499" in a post draft is the post's words, not a figure Chausar states); the
 * figures a quote holds (`[data-ui-number]`, `[data-figure]`) are still checked there, like everywhere else.
 *
 * A stopgap, `[data-engine-line]`: a Today row's line is one string the engine composes in code, and some carry an
 * amount it worked out (the judge's notice with its cost bound, why Accept is blocked, the posting risk). The UI cannot
 * attach a receipt to an amount inside a sentence, so until W4 4J1 moves those amounts into structured, receipted row
 * meta, money text inside `[data-engine-line]` passes. W4 4J1 replaces this exemption with receipted meta and removes
 * it. Money (wave 3, 3F) uses the same marker, only around words the engine wrote itself: the spend total with its
 * estimates, held amounts, rupee views and rate prices, tax lines and journal lines sent without a receipt. W4 4J1
 * gives each of those a receipt too and then removes the marker everywhere. Only the money-text check is relaxed there: a `[data-ui-number]` or `[data-figure]` inside an engine line is
 * checked like anywhere else, and a place's own words with an amount still fail.
 *
 * `[data-receipt-sheet]` (w3 3I): the root of a receipt sheet (`receipt` and `ca-receipt` in `src/shell/sheets.tsx`,
 * through `<Sheet receipt>`). That sheet IS the proof: its figures are the receipt's own lines in plain DM Mono, with no
 * chip pointing back at the sheet they sit in, so money text inside it passes. As with engine lines, only the money-text
 * check is relaxed: a `[data-ui-number]` or `[data-figure]` inside a receipt sheet is checked like anywhere else.
 */

// Exported so the file reads as a module from its first statement: `node --check` (scripts/check.mjs) only strips
// types from a file it has detected as one.
export type Root = ParentNode;

/** A currency sign or a currency code (the engine writes "INR 2,825.00" and "USD 0.2500" too) followed by a digit. */
const MONEY = /(?:[₹$€]\s?|\b(?:INR|USD|EUR|GBP|AED|SGD|AUD|CAD)\s?)\d/;
/** Where money-looking text may sit: proved, labelled, quoted, an engine row line (until W4 4J1, see above), a receipt
 *  sheet (the proof itself, see above), or typed by the owner. Counts are left to their own, clearer check. Receipt ids
 *  (R-0419) never hold a currency sign, so they need no exemption, and none is given. */
const MONEY_ALLOWED = '[data-figure], [data-figure-group], [data-estimate], [data-count], [data-content], [data-engine-line], [data-receipt-sheet], input, textarea, select, option, script, style';

/** `selector` matches inside `root`, and on `root` itself when it is an element. */
function within(root: Root, selector: string): Element[] {
  const found = [...root.querySelectorAll(selector)];
  if (root instanceof Element && root.matches(selector)) found.unshift(root);
  return found;
}

/** Up to 60 characters of a node's text, on one line. */
function textOf(node: Node): string {
  const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
  return text.length > 60 ? `${text.slice(0, 57)}...` : text;
}

/** A name to find a card or row by: its label, its row id, its heading, or its text. */
function nameOf(element: Element): string {
  const label = element.getAttribute('aria-label');
  if (label) return `"${label}"`;
  const labelledBy = element.getAttribute('aria-labelledby');
  if (labelledBy) {
    const words = labelledBy.split(/\s+/).map((id) => element.ownerDocument.getElementById(id)?.textContent?.trim() ?? '').filter(Boolean);
    if (words.length) return `"${words.join(' ')}"`;
  }
  const rowId = element.getAttribute('data-row-id');
  if (rowId) return `row ${rowId}`;
  const heading = element.querySelector('h1, h2, h3, h4');
  if (heading) return `"${textOf(heading)}"`;
  return `<${element.tagName.toLowerCase()}> "${textOf(element)}"`;
}

function fail(rule: string, problems: string[]): void {
  if (problems.length) throw new Error(`Ink rule "${rule}" is broken:\n- ${problems.join('\n- ')}`);
}

/** Receipt controls with an id: a button or link (or an element with that role) whose data-receipt is not blank. */
function receiptsIn(scope: Element): Element[] {
  return [...scope.querySelectorAll('[data-receipt]')].filter((el) =>
    (el.getAttribute('data-receipt') ?? '').trim() !== '' && el.matches('button, a[href], [role="button"], [role="link"]'));
}

/** Estimate labels that say something. */
function estimatesIn(scope: Element): Element[] {
  return [...scope.querySelectorAll('[data-estimate]')].filter((el) => textOf(el) !== '');
}

/** What is wrong with the proof inside a figure or a figure group, if anything. */
function proofProblem(scope: Element, what: string): string | null {
  const receipts = receiptsIn(scope).length;
  const estimates = estimatesIn(scope).length;
  if (!receipts && !estimates) return `${what} has no receipt and no "model estimate" label (a receipt needs a control with an id; an estimate needs its words)`;
  if (receipts && estimates) return `${what} has both a receipt and "model estimate": a model-written number never carries a receipt`;
  return null;
}

/** Money-looking text anywhere under the root that is not proved, labelled or typed by the owner. */
function bareMoney(root: Root): string[] {
  const doc = root instanceof Document ? root : (root as Node).ownerDocument;
  if (!doc) return [];
  const problems: string[] = [];
  const walker = doc.createTreeWalker(root as Node, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!MONEY.test(node.textContent ?? '') || node.parentElement?.closest(MONEY_ALLOWED)) continue;
    problems.push(`"${textOf(node)}" looks like money outside a figure: show it through Figure (or inside a [data-figure-group] with its receipt), or label it with ModelEstimate`);
  }
  return problems;
}

function figureProblems(root: Root): { problems: string[]; numbers: Element[] } {
  const problems: string[] = [];
  for (const count of within(root, '[data-count]')) {
    if (count.matches('[data-ui-number]') || count.querySelector('[data-ui-number]')) {
      problems.push(`count "${textOf(count)}" is marked data-ui-number: a count is not money and carries no proof, so it uses Count`);
    }
    if (MONEY.test(count.textContent ?? '')) problems.push(`count "${textOf(count)}" looks like money: show money through Figure, never Count`);
  }
  for (const figure of within(root, '[data-figure]')) {
    if (figure.parentElement?.closest('[data-figure]')) {
      problems.push(`figure "${textOf(figure)}" is inside another [data-figure], so the outer one could borrow its proof`);
    }
    const held = figure.querySelectorAll('[data-ui-number]').length + (figure.matches('[data-ui-number]') ? 1 : 0);
    if (held !== 1) problems.push(`figure "${textOf(figure)}" holds ${held} [data-ui-number]: a figure is exactly one number with its proof`);
  }
  // A figure's words (Figure's splitFigure, w3 3I) are the engine's words after its one amount: never a second amount,
  // which would sit inside the figure's proof without being the number it proves.
  for (const words of within(root, '[data-figure-words]')) {
    if (MONEY.test(words.textContent ?? '')) problems.push(`figure words "${textOf(words)}" hold an amount: a figure's words never carry a second amount`);
  }
  for (const group of within(root, '[data-figure-group]')) {
    const problem = proofProblem(group, `figure group "${textOf(group)}"`);
    if (problem) problems.push(problem);
  }
  const numbers = within(root, '[data-ui-number]');
  for (const number of numbers) {
    const figure = number.closest('[data-figure]');
    if (!figure) {
      problems.push(`"${textOf(number)}" is a number (data-ui-number) not inside a [data-figure]: show it through Figure, with its receipt or "model estimate"`);
      continue;
    }
    const problem = proofProblem(figure, `"${textOf(number)}"`);
    if (problem) problems.push(problem);
  }
  problems.push(...bareMoney(root));
  return { problems, numbers };
}

/**
 * Receipts on figures:
 * - every `[data-ui-number]` sits in a `[data-figure]`, and every `[data-figure]` holds exactly one;
 * - each figure holds a receipt control with a non-empty id or a non-empty "model estimate" label, never both;
 * - figures do not nest (an outer figure could pass on an inner one's receipt);
 * - a `[data-figure-group]` holds a proof the same way, and covers the amounts written inside it;
 * - no `[data-count]` is a number or holds money, and no money-looking text sits anywhere else.
 * Returns the numbers it checked, so a test can also say how many it expects.
 */
export function assertFiguresProved(root: Root = document.body): Element[] {
  const { problems, numbers } = figureProblems(root);
  fail('receipts on figures', problems);
  return numbers;
}

function primaryProblems(root: Root): string[] {
  const problems: string[] = [];
  for (const unit of within(root, '[data-card], [data-row]')) {
    const primaries = [...unit.querySelectorAll('[data-variant="primary"]')];
    if (primaries.length > 1) {
      const labels = primaries.map((p) => `"${p.getAttribute('aria-label') ?? textOf(p)}"`).join(', ');
      problems.push(`${nameOf(unit)} holds ${primaries.length} filled primaries (${labels})`);
    }
  }
  return problems;
}

/**
 * One filled primary per card: every `[data-card]` and every `[data-row]` (a list item or not) holds at most one
 * `[data-variant="primary"]`. Everything inside counts, nested rows and cards too, because every filled button inside
 * a card is a filled button on that card. So a tile that holds cards or rows with their own primaries (Needs you,
 * Working now, a department panel) must not be marked `data-card` itself: only the cards inside it are.
 */
export function assertOnePrimary(root: Root = document.body): void {
  fail('one filled primary per card', primaryProblems(root));
}

function styleProblems(root: Root): string[] {
  return within(root, '[style]').map((el) => `<${el.tagName.toLowerCase()}> "${textOf(el)}" has style="${el.getAttribute('style')}"`);
}

/**
 * No inline styles: no element carries a `style` attribute. Lengths that vary (bars, rings, chart heights) are svg
 * attributes and states are `data-*` attributes styled in CSS modules (the source rule bans `style=` in the code; this
 * catches anything set at run time).
 */
export function assertNoInlineStyles(root: Root = document.body): void {
  fail('no inline styles', styleProblems(root));
}

/** All three rules at once, reporting every problem rather than the first. Every place test calls it on the page. */
export function assertInkRules(root: Root = document.body): void {
  const problems = [
    ...figureProblems(root).problems.map((p) => `receipts on figures: ${p}`),
    ...primaryProblems(root).map((p) => `one filled primary per card: ${p}`),
    ...styleProblems(root).map((p) => `no inline styles: ${p}`),
  ];
  if (problems.length) throw new Error(`Ink rules are broken:\n- ${problems.join('\n- ')}`);
}
