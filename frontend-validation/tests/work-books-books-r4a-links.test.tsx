import { useState } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TextProvider } from '../../app/ui/src/app/text';
import type { Address, Language } from '../../app/ui/src/app/presentation';

// Other lanes' Books sub-places as connectors-ext and learning-ext register them (their round-4 ids).
// The lists are supplied here so this file does not depend on whether those lanes are merged.
vi.mock('../../app/ui/src/places/subplaces/index.ts', () => ({ laneSubPlaces: {
  'work-books': [], 'connectors-ext': [{ place: 'books', id: 'scheduled' }, { place: 'books', id: 'database' }, { place: 'books', id: 'tally-export' }],
  'learning-ext': [{ place: 'books', id: 'dictionary' }, { place: 'tools', id: 'elsewhere' }],
} }));
vi.mock('../../app/ui/src/text/lanes/index.ts', () => ({ laneWords: {
  'connectors-ext': { en: { 'SH-01.sub.books.scheduled': 'Scheduled reads', 'SH-01.sub.books.database': 'Database road', 'SH-01.sub.books.tally-export': 'Tally on another computer' },
    hi: { 'SH-01.sub.books.scheduled': 'तय समय पर पढ़ाई', 'SH-01.sub.books.database': 'डेटाबेस का रास्ता', 'SH-01.sub.books.tally-export': 'दूसरे कंप्यूटर पर Tally' } },
  'learning-ext': { en: { 'SH-01.sub.books.dictionary': 'Dictionary edits' }, hi: { 'SH-01.sub.books.dictionary': 'शब्दकोश के बदलाव' } },
} }));

const { booksPlace } = await import('../../app/ui/src/screens/books/index');

afterEach(() => cleanup());
const MONTHS = ['2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];
const HANDLERS: Record<string, () => unknown> = {
  'books.sources': () => ({ rows: [{ sourceId: 'demo', system: 'csv', way: 'files', scope: null, lastReadAt: null, months: MONTHS.map(month => ({ month, state: 'loaded' })), rows: 1, refused: 0, unmapped: 0, experimental: false, connected: true }], unmappedFields: 0, freshness: { available: true } }),
  'books.recipes': () => ({ available: true, recipes: [], proposals: [] }),
  'accounts.list': () => ({ accounts: [], proposals: { available: false } }),
  'accounts.classes': () => ({ classes: [] }),
};
function setup(address: Address, language: Language = 'en') {
  const seen: Address[] = [];
  const rpc = { request: async (method: string) => { const h = HANDLERS[method]; if (!h) throw Object.assign(new Error('UNKNOWN_METHOD'), { code: 'UNKNOWN_METHOD' }); return structuredClone(h()); } };
  function Harness() {
    const [at, setAt] = useState<Address>(address);
    return <TextProvider language={language}>{booksPlace.render({ address: at, language, view: 'guided', viewer: false, member: { id: 'm1', role: 'owner' }, rpc, live: () => true, openReceipt: vi.fn(), navigate: next => { seen.push(next); setAt(next ?? { place: 'books' }); } })}</TextProvider>;
  }
  render(<Harness />);
  return seen;
}

test('the Books module leaves the sub-places other lanes added to them, and keeps its own', () => {
  for (const sub of ['scheduled', 'database', 'tally-export', 'dictionary']) expect(booksPlace.handles({ place: 'books', sub })).toBe(false);
  for (const sub of [undefined, 'sources', 'recipes', 'add', 'elsewhere']) expect(booksPlace.handles({ place: 'books', ...(sub ? { sub } : {}) })).toBe(true);
});

test('Sources links to connectors-ext\'s Books places by their own names; Recipes and Accounts to learning-ext\'s', async () => {
  const seen = setup({ place: 'books', sub: 'sources' });
  fireEvent.click(await screen.findByRole('button', { name: 'Scheduled reads' }));
  expect(seen.at(-1)).toEqual({ place: 'books', sub: 'scheduled' });
  cleanup();
  const again = setup({ place: 'books', sub: 'sources' });
  fireEvent.click(await screen.findByRole('button', { name: 'Tally on another computer' }));
  expect(again.at(-1)).toEqual({ place: 'books', sub: 'tally-export' });
  expect(screen.queryByRole('button', { name: 'Dictionary edits' })).toBeNull();
  cleanup();
  setup({ place: 'books', sub: 'recipes' });
  expect(await screen.findByRole('button', { name: 'Dictionary edits' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Database road' })).toBeNull();
  cleanup();
  setup({ place: 'books', sub: 'accounts' }, 'hi');
  expect(await screen.findByRole('button', { name: 'शब्दकोश के बदलाव' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'elsewhere' })).toBeNull();
});
