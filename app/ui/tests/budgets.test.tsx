import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { App } from '../src/shell/App';
import { FakeEngine, createFakeClient } from '../src/engine/fake';
import { CARDS, PLACES, RECEIPTED, SHEETS } from './helpers/places';
import { NARROW } from '../src/shell/useNarrow';

/**
 * Word budgets (w3 3I; catalogue U14). Direction D carries far more on each screen than the Ink v1 desk's "35 to 45
 * words at rest", so each place at rest has its own baseline, measured once on the fake engine and rounded up to the
 * next 10, in tests/baselines/words.json. A baseline may only shrink: a place that grows past it fails here, and so
 * does one that has dropped a whole step of 10 below it (then lower the baseline, as the message says). The founder
 * confirms the baselines in the wave 3 PR. Two limits hold for every place as well: a page's sub line is at most 20
 * words, and an approval card's own copy (its kind chip, its note line and its buttons) at most 12.
 *
 * Money's old "stays near forty words" test (Ink v1, raised to 79 by 3F for the D tiles) moved here, with the same
 * engine answer it used: the overview as the real engine sends it, every line with its receipt.
 */

interface Budgets {
  about: string; firstTotal: number; budgets: Record<string, number>; first: Record<string, number>;
  sheets: Record<string, number>; firstSheets: Record<string, number>; cards: Record<string, number>; firstCards: Record<string, number>;
}
const BASELINE = JSON.parse(readFileSync(join(import.meta.dirname, 'baselines/words.json'), 'utf8')) as Budgets;

const LOADING = /^Loading$/;
const flush = async () => { for (let i = 0; i < 4; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };

async function open(place: { hash: string; receipted?: boolean; narrow?: boolean }) {
  window.location.hash = place.hash;
  if (place.narrow) {
    const media = vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
      matches: query === NARROW, media: query, onchange: null,
      addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
    }) as unknown as MediaQueryList);
    onTestFinished(() => { media.mockRestore(); });
  }
  const client = createFakeClient(new FakeEngine({ now: () => '2026-10-23T13:35:00.000Z' }));
  if (place.receipted) {
    const request = client.request.bind(client);
    client.request = (async (method: string, params?: unknown) => (method === 'venture.money.overview'
      ? structuredClone(RECEIPTED)
      : request(method as never, params as never))) as typeof client.request;
  }
  const { container } = render(<App client={client} language="en" />);
  await waitFor(() => {
    expect(container.querySelector('[data-boot]')).toBeNull();
    expect(container.querySelector('main h1')).not.toBeNull();
    for (const node of container.querySelectorAll('main p, main h2')) expect(node.textContent ?? '').not.toMatch(LOADING);
  }, { timeout: 5000 });
  // Read until the count holds still: the place's later reads (books, runs, the journal) have all landed.
  let before = -1;
  for (let i = 0; i < 8; i++) {
    await flush();
    const now = words(screen.getByRole('main')).length;
    if (now === before) break;
    before = now;
  }
  return screen.getByRole('main');
}

/** The words a reader sees, one per run of text, so "Money" and "Overview" in two elements count as two. Screen-reader
 *  only text, hidden elements, what a closed fold holds (all but its summary), a chart's hover tips and a closed list's
 *  other choices are not seen, so they do not count. */
function words(root: Element): string[] {
  const out: string[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    // 4J20: a chart's hover tip (an SVG title) and a closed list's other choices are not seen at rest either.
    if (!parent || parent.closest('.sr-only, [hidden], script, style, title')) continue;
    // C1 task 7: Settings' list beside a settings page is counted once, as the `business` entry, not on every page.
    if (parent.closest('[data-settings] [data-settings-list]')) continue;
    const option = parent.closest('option');
    if (option && !option.selected) continue;
    if (closedAround(parent)) continue;
    // One-shot B2: a time or a duration is one figure, as "00:41" and "4m" were: "12:41 am" and "4 min" count once.
    const figures = (node.textContent ?? '').replace(/\b(\d{1,2}:\d{2}) (am|pm)\b/g, '$1_$2').replace(/\b(\d+) (min|s|h|days?)\b/g, '$1_$2');
    out.push(...figures.split(/\s+/).filter(Boolean));
  }
  return out;
}

/** True when a closed fold hides this element. Every fold around it counts, not only the nearest, so a fold's own
 *  summary inside another closed fold is not seen. */
function closedAround(element: Element): boolean {
  const summary = element.closest('summary');
  for (let fold = element.closest('details'); fold; fold = fold.parentElement?.closest('details') ?? null) {
    const inOwnSummary = summary !== null && summary.parentElement === fold;
    if (!fold.open && !inOwnSummary) return true;
  }
  return false;
}

const roundUp = (n: number) => Math.ceil(n / 10) * 10;

/** Waits until a sheet or card has stopped loading and its count holds still, then returns the count. */
async function settled(find: () => Element | null, what: string): Promise<number> {
  await waitFor(() => {
    const found = find();
    expect(found, `${what} is not on the page`).not.toBeNull();
    expect(found!.textContent ?? '').not.toMatch(/Loading/);
  }, { timeout: 5000 });
  let before = -1;
  for (let i = 0; i < 8; i++) {
    await flush();
    const now = words(find()!).length;
    if (now === before) break;
    before = now;
  }
  return before;
}

/** The same rule as the places: over the budget fails, and a whole step under it says to lower it. */
function holds(what: string, list: string, count: number, budget: number | undefined): void {
  expect(budget, `${what} has no baseline yet: measured ${count}, so add "${what}": ${roundUp(count)} under "${list}"`).toBeDefined();
  expect(count, `${what} shows ${count} words at rest, over its baseline of ${budget}: cut words, or ask the founder to raise it in the PR`).toBeLessThanOrEqual(budget!);
  expect(count, `${what} shows ${count} words at rest, a whole step under its baseline of ${budget}: lower the baseline to ${roundUp(count)}`).toBeGreaterThan(budget! - 10);
}

describe('word budgets for sheets and cards (B4 task 11)', () => {
  for (const [name, ids, now, first] of [
    ['sheets', SHEETS.map((s) => s.id), BASELINE.sheets, BASELINE.firstSheets],
    ['cards', CARDS.map((c) => c.id), BASELINE.cards, BASELINE.firstCards],
  ] as const) {
    it(`the ${name} baselines list every one, and only shrink from their first measure`, () => {
      expect(Object.keys(now ?? {}).sort()).toEqual([...ids].sort());
      expect(Object.keys(first ?? {}).sort()).toEqual([...ids].sort());
      for (const id of ids) expect(now[id], `${id} may only shrink from ${first[id]}`).toBeLessThanOrEqual(first[id]!);
    });
  }

  for (const sheet of SHEETS) {
    it(`the ${sheet.id} sheet stays within its words`, async () => {
      await open({ hash: sheet.hash });
      holds(sheet.id, 'sheets', await settled(() => document.querySelector('[data-sheet]'), `the ${sheet.id} sheet`), BASELINE.sheets?.[sheet.id]);
    });
  }

  for (const card of CARDS) {
    it(`the ${card.id} card stays within its words`, async () => {
      await open({ hash: card.hash });
      holds(card.id, 'cards', await settled(() => document.querySelector(card.selector), `the ${card.id} card`), BASELINE.cards?.[card.id]);
    });
  }
});

describe('word budgets at rest', () => {
  it('the baselines only shrink: each place stays at or under its first measure, and so does the total', () => {
    expect(Object.keys(BASELINE.budgets).sort()).toEqual(PLACES.map((p) => p.id).sort());
    expect(Object.keys(BASELINE.first).sort()).toEqual(PLACES.map((p) => p.id).sort());
    for (const place of PLACES) {
      expect(BASELINE.budgets[place.id], `${place.id}'s baseline may only shrink from its first measure, ${BASELINE.first[place.id]}`).toBeLessThanOrEqual(BASELINE.first[place.id]!);
    }
    const first = Object.values(BASELINE.first).reduce((sum, n) => sum + n, 0);
    expect(first, 'firstTotal is the sum of the first measures').toBe(BASELINE.firstTotal);
    const total = Object.values(BASELINE.budgets).reduce((sum, n) => sum + n, 0);
    expect(total, `the baselines add up to ${total}; the first measure was ${BASELINE.firstTotal}`).toBeLessThanOrEqual(BASELINE.firstTotal);
  });

  for (const place of PLACES) {
    it(`${place.id} stays within its words`, async () => {
      const main = await open(place);
      const count = words(main).length;
      const budget = BASELINE.budgets[place.id];
      expect(budget, `${place.id} has no baseline yet: measured ${count}, so add "${place.id}": ${roundUp(count)}`).toBeDefined();
      expect(count, `${place.id} shows ${count} words at rest, over its baseline of ${budget}: cut words, or ask the founder to raise it in the PR`).toBeLessThanOrEqual(budget!);
      expect(count, `${place.id} shows ${count} words at rest, a whole step under its baseline of ${budget}: lower the baseline to ${roundUp(count)}`).toBeGreaterThan(budget! - 10);

      // A page's sub line, the line under its title, is at most 20 words.
      const title = within(main).getAllByRole('heading', { level: 1 })[0]!;
      const sub = title.nextElementSibling?.tagName === 'P' ? title.nextElementSibling : null;
      if (sub) expect(words(sub).length, `${place.id}'s sub line: "${sub.textContent}"`).toBeLessThanOrEqual(20);

      // An approval card's own copy (kind chip, note line, buttons) is at most 12 words.
      for (const card of main.querySelectorAll('article[data-card][data-row-id]')) {
        const own = [...card.querySelectorAll('[data-kind], [data-note], button[data-key]')];
        const n = own.reduce((sum, el) => sum + words(el).length, 0);
        expect(n, `card ${card.getAttribute('data-row-id')}'s own copy: ${own.map((el) => `"${el.textContent}"`).join(' ')}`).toBeLessThanOrEqual(12);
      }
    });
  }
});
