import { describe, expect, it } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { App } from '../src/shell/App';
import { FakeEngine, createFakeClient } from '../src/engine/fake';

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

interface Budgets { about: string; firstTotal: number; budgets: Record<string, number>; first: Record<string, number> }
const BASELINE = JSON.parse(readFileSync(join(import.meta.dirname, 'baselines/words.json'), 'utf8')) as Budgets;

/** Money at a glance as the real engine sends it (platform/runtime/venture/money/overview.ts), as money.test.tsx has it. */
const RECEIPTED = {
  lines: [
    { id: 'owed', label: 'Clients owe you', value: '₹26,200.00', receiptId: 'R-0430' },
    { id: 'received', label: 'Came in this month', value: '₹86,200.00', receiptId: 'R-0402' },
    { id: 'spent', label: 'AI and tools this month', value: '₹60.10, includes estimates', receiptId: 'R-0431', estimate: true },
  ],
};

/** Every place and sub-page at rest, by the address an owner opens. */
const PLACES: { id: string; hash: string; receipted?: boolean }[] = [
  { id: 'today', hash: '#/today' },
  { id: 'team', hash: '#/team' },
  { id: 'work', hash: '#/work' },
  { id: 'clients', hash: '#/clients' },
  { id: 'clients/pipeline', hash: '#/clients/pipeline' },
  { id: 'money', hash: '#/money', receipted: true },
  { id: 'money/invoices', hash: '#/money/invoices' },
  { id: 'money/books', hash: '#/money/books' },
  { id: 'money/spend', hash: '#/money/spend' },
  { id: 'money/journal', hash: '#/money/journal' },
  { id: 'connections', hash: '#/connections' },
  { id: 'connections/ai', hash: '#/connections/ai' },
  { id: 'business/plan', hash: '#/business/plan' },
  { id: 'business/prices', hash: '#/business/prices' },
  { id: 'business/build', hash: '#/business/build' },
  { id: 'business/keep', hash: '#/business/keep' },
  { id: 'onboarding', hash: '#/onboarding' },
];

const LOADING = /^Loading$/;
const flush = async () => { for (let i = 0; i < 4; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };

async function open(place: (typeof PLACES)[number]) {
  window.location.hash = place.hash;
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
 *  only text, hidden elements and what a closed fold holds (all but its summary) are not seen, so they do not count. */
function words(root: Element): string[] {
  const out: string[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (!parent || parent.closest('.sr-only, [hidden], script, style')) continue;
    const fold = parent.closest('details');
    if (fold && !fold.open && !parent.closest('summary')) continue;
    out.push(...(node.textContent ?? '').split(/\s+/).filter(Boolean));
  }
  return out;
}

const roundUp = (n: number) => Math.ceil(n / 10) * 10;

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
