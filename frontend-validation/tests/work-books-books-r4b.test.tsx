import { useState } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { TextProvider } from '../../app/ui/src/app/text';
import type { Address, Language, View } from '../../app/ui/src/app/presentation';
import { booksPlace } from '../../app/ui/src/screens/books/index';
import { sheetOf } from '../../app/ui/src/screens/books/shared';
import { BOOKS_R4B } from '../../app/ui/src/screens/books/words-r4b';
import { dayIn } from '../../app/ui/src/screens/books/r4b-parts';

// Synthetic replies shaped by the round-4 Books contract in docs/lanes/work-books.md ("Round 4 contracts").
type Handler = (payload: Record<string, unknown>) => unknown;
type Calls = { method: string; payload: Record<string, unknown> }[];

const cell = (minor: string, receiptId: string | null) => ({ value: { minor }, refused: null, receiptId,
  receipt: { operation: 'billed', period: { from: '2026-09-01', to: '2026-09-30' }, counted: 2, excluded: 1, definitions: ['billed'], completeness: 'partial' } });
const impact = (strategy: string, over: Record<string, unknown> = {}) => ({ strategy, digest: `i-${strategy}`, affectedAnswers: 2, rebuild: strategy === 'retrospective' ? 2 : 0, activeWork: 0, preserved: 7, code: null, ...over });
const trial = (impacts: unknown[]) => ({ trialId: 'trial-1', draftId: 'draft-1', proposalId: null, experimental: true, status: 'evaluated', change: { type: 'definition', target: 'billed' },
  cost: { preparationMs: 40, diskBytes: 4096 }, evaluationDigest: 'e1', impact: { digest: 'i-prospective', strategy: 'prospective', affectedAnswers: 2, rebuild: 0, activeWork: 0 }, impactCode: null,
  limitations: [], rows: [{ answerId: 'a1', operation: 'billed', period: { from: '2026-09-01', to: '2026-09-30' }, now: cell('50000', 'r1'), withChange: cell('40000', null), differs: true }], impacts });
const recordView = { id: 'rec-1', kind: 'customer', name: 'Fixture Traders', details: [], owes: { value: { missing: 'not-counted' }, receiptId: null },
  timeline: [{ at: '2026-09-30T20:00:00.000Z', kind: 'invoice', amount: { minor: '50000' }, sourceId: 'src:tally', ref: 'INV-1' }],
  optIn: [{ channel: 'mail', answer: 'not-asked', source: null, on: null }, { channel: 'whatsapp', answer: 'not-asked', source: null, on: null }], stoppedOn: null };
const more = { recordId: 'rec-1', omitted: 0, journal: { available: true }, entries: [
  { at: '2026-09-08T10:00:00.000Z', type: 'reminder', what: 'reminder-draft', status: 'prepared', source: 'actions', ref: 'a-1' },
  { at: '2026-09-10T09:00:00.000Z', type: 'reminder-sent', what: null, status: null, source: 'writeback-journal', ref: 'INV-1' },
  { at: '2026-09-11T09:00:00.000Z', type: 'note', what: 'rec-1 prefers calls after noon', status: 'told-by-owner', source: 'memory', ref: 'mem-1' }] };
const field = (value: string | null, line: number, box?: Record<string, number>, page = 1) => ({ value, certainty: 'sure', region: { page, line, of: 4, ...(box ? { box } : {}) } });
const billRead = { readId: 'billread-1', digest: 'd'.repeat(64), mime: 'image/png', stored: false, expiresAt: '2026-10-14T12:30:00.000Z', untrusted: true,
  reader: { engine: 'tesseract', version: '5.3.4', pages: 2, confidence: 91 },
  supplier: field('Sharma Paper Mart', 1, { x: 100, y: 50, w: 300, h: 20 }), billNumber: field('SPM-0042', 2, { x: 300, y: 75, w: 90, h: 20 }), date: field('2026-09-05', 3),
  total: field('54500', 2, { x: 300, y: 75, w: 90, h: 20 }, 2),
  lines: [{ description: field('A4 Paper Ream', 4), quantity: field('2', 4), amount: field('50000', 4, { x: 600, y: 125, w: 90, h: 20 }) }],
  tax: [{ name: field('CGST 9%', 1, undefined, 2), amount: field('4500', 1, { x: 200, y: 50, w: 90, h: 20 }, 2) }],
  sums: { linesPlusTax: { minor: '54500' }, total: { minor: '54500' }, equal: true },
  routes: { zohoBooks: { available: false, connections: [] }, tallyPreview: { available: true } },
  outline: [{ page: 1, width: 1000, height: 2000, omitted: 0, boxes: [{ x: 100, y: 50, w: 90, h: 20 }] }, { page: 2, width: 1000, height: 2000, omitted: 3, boxes: [{ x: 100, y: 50, w: 90, h: 20 }, { x: 300, y: 75, w: 90, h: 20 }] }] };

const BASE: Record<string, Handler> = {
  'books.trialRead': () => ({ trial: trial([impact('prospective'), impact('retrospective')]) }),
  'books.trialPublish': p => ({ trialId: 'trial-1', status: 'promoted', publicationId: 'pub-1', draftId: 'draft-1', proposalId: null, strategy: p['strategy'] }),
  'records.search': () => ({ records: [{ id: 'rec-1', kind: 'customer', name: 'Fixture Traders', sources: ['src:tally'], facts: 12 }] }),
  'records.get': () => recordView,
  'records.timelineMore': () => more,
  'records.holdings': () => ({ stores: [{ store: 'facts', count: 12 }] }),
  'records.deletionPlan': () => ({ recordId: 'rec-1', canDelete: true, sourceDeletion: { available: false }, coreDeletion: { available: true },
    stores: [{ store: 'facts', count: 12, state: 'can-delete', reason: null }] }),
  'books.rates': () => ({ rates: [], notCounted: [], fromReceipts: { available: true, receipts: [{ receiptId: 'r-9', operation: 'billed', at: '2026-10-01T10:00:00.000Z', notCounted: [{ currency: 'USD', rows: 2 }] }] } }),
  'books.bills': () => ({ bills: [] }),
  'books.billRead': () => billRead,
};

function setup({ address, role = 'owner', viewer = false, language = 'en', view = 'guided', handlers = {}, setAbout }: {
  address: Address; role?: string; viewer?: boolean; language?: Language; view?: View; handlers?: Record<string, Handler>; setAbout?: (about: unknown) => void;
}) {
  const calls: Calls = [];
  const openReceipt = vi.fn();
  const table = { ...BASE, ...handlers };
  const rpc = { request: async (method: string, payload: Record<string, unknown>) => {
    calls.push({ method, payload });
    const handler = table[method];
    if (!handler) throw Object.assign(new Error('UNKNOWN_METHOD'), { code: 'UNKNOWN_METHOD' });
    return structuredClone(handler(payload));
  } };
  function Harness() {
    const [at, setAt] = useState<Address>(address);
    const props = { address: at, language, view, viewer, member: { id: 'm1', role }, rpc, live: () => true, openReceipt, navigate: (next: Address | null) => setAt(next ?? { place: 'books' }), ...(setAbout ? { setAbout } : {}) };
    return <TextProvider language={language}>{booksPlace.render(props)}</TextProvider>;
  }
  render(<Harness />);
  return { calls, openReceipt, called: (method: string) => calls.filter(c => c.method === method) };
}

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network is unavailable in this fixture suite'));
  if (typeof URL.createObjectURL !== 'function') Object.assign(URL, { createObjectURL: () => 'blob:synthetic-bill', revokeObjectURL: () => undefined });
});
afterEach(() => cleanup());

test('every round-4 word has real Hindi', () => {
  for (const key of Object.keys(BOOKS_R4B.en) as (keyof typeof BOOKS_R4B.en)[]) {
    expect(BOOKS_R4B.hi[key], key).toBeTruthy();
    expect(/[ऀ-ॿ]/.test(BOOKS_R4B.hi[key]), key).toBe(true);
  }
});

// ---------------------------------------------------------------- BK-09

test('BK-09: both ways to publish, each with its impact; publishing names the way and its own digest', async () => {
  const { called } = setup({ address: { place: 'books', sub: 'trial', sheet: sheetOf('draft-1') } });
  const ways = await screen.findByRole('heading', { name: 'How to publish' });
  const list = ways.closest('section') ?? document.body;
  expect(within(list as HTMLElement).getByText('From now on')).toBeTruthy();
  expect(within(list as HTMLElement).getByText('From now on, and work out saved answers again')).toBeTruthy();
  expect(document.querySelector('[data-impact="retrospective"]')?.textContent).toBe('2 saved answers change · 2 worked out again · 0 jobs or actions still open');
  expect(within(list as HTMLElement).getAllByText('7 earlier receipts are kept unchanged.').length).toBe(2);
  fireEvent.click(screen.getByRole('button', { name: 'Publish: From now on, and work out saved answers again' }));
  await waitFor(() => expect(called('books.trialPublish')[0]?.payload).toEqual({ trialId: 'trial-1', evaluationDigest: 'e1', impactDigest: 'i-retrospective', strategy: 'retrospective' }));
  expect(await screen.findByText('Published: From now on, and work out saved answers again.')).toBeTruthy();
});

test('BK-09: a way core refuses shows its code; open work blocks publishing; a viewer and Simple see no button', async () => {
  setup({ address: { place: 'books', sub: 'trial', sheet: sheetOf('draft-1') }, view: 'simple', handlers: {
    'books.trialRead': () => ({ trial: trial([impact('prospective', { activeWork: 2 }), impact('retrospective', { digest: null, code: 'TRIAL_REBUILD_REQUIRED' })]) }) } });
  expect(await screen.findByText('Not possible this way (TRIAL_REBUILD_REQUIRED).')).toBeTruthy();
  expect(screen.getByText('Settle the open jobs and actions first. Publishing waits until none is open.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /^Publish/ })).toBeNull();
  expect(screen.queryByText(/earlier receipts are kept/)).toBeNull();
  cleanup();
  setup({ address: { place: 'books', sub: 'trial', sheet: sheetOf('draft-1') }, viewer: true, language: 'hi' });
  expect(await screen.findByText('कैसे प्रकाशित करें')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /प्रकाशित करें:/ })).toBeNull();
});

// ---------------------------------------------------------------- BK-12

test('BK-12: reminders and notes on the record\'s time line, each with its source; ask about the record through setAbout', async () => {
  const setAbout = vi.fn();
  setup({ address: { place: 'books', sub: 'customers', sheet: sheetOf('rec-1') }, setAbout, view: 'books' });
  const table = await screen.findByRole('table', { name: 'Reminders and notes' });
  expect(within(table).getByText('Reminder prepared')).toBeTruthy();
  expect(within(table).getByText('Write-back follow-up journal')).toBeTruthy();
  expect(within(table).getByText('rec-1 prefers calls after noon')).toBeTruthy();
  expect(within(table).getByText('What Chausar remembers')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Ask about this record' }));
  expect(setAbout).toHaveBeenCalledWith({ kind: 'record', id: 'rec-1', name: 'Fixture Traders' });
  expect(screen.getByRole('status').textContent).toBe('The ask line is now about Fixture Traders.');
  expect(screen.queryByText(/asking about this record from the ask line/)).toBeNull();
});

test('BK-12: without the frame\'s setAbout the page says it is not built; a missing time line method and journal say so too (Hindi)', async () => {
  setup({ address: { place: 'books', sub: 'customers', sheet: sheetOf('rec-1') }, language: 'hi', handlers: { 'records.timelineMore': () => { throw Object.assign(new Error('x'), { code: 'UNKNOWN_METHOD' }); } } });
  expect(await screen.findByText('अभी बना नहीं: समय-रेखा पर याद दिलाना और नोट।')).toBeTruthy();
  expect(screen.getByText(/अभी बना नहीं: पूछने की पंक्ति से/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'इस रिकॉर्ड के बारे में पूछें' })).toBeNull();
  cleanup();
  setup({ address: { place: 'books', sub: 'customers', sheet: sheetOf('rec-1') }, handlers: { 'records.timelineMore': () => ({ ...more, entries: [], journal: { available: false } }) } });
  expect(await screen.findByText('No reminder or note names this record.')).toBeTruthy();
  expect(screen.getByText(/Not built yet: reminders sent through a connected system/)).toBeTruthy();
});

// ---------------------------------------------------------------- time zone

test('dates on a record follow the workspace time zone from ui.context; without one they stay as before', async () => {
  expect(dayIn('2026-09-30T20:00:00.000Z', 'en', 'Asia/Kolkata')).toBe('1 Oct 2026');
  expect(dayIn('2026-09-30T20:00:00.000Z', 'en', null)).toBe('30 Sep 2026');
  expect(dayIn('2026-09-30', 'en', 'Asia/Kolkata')).toBe('30 Sep 2026');
  setup({ address: { place: 'books', sub: 'customers', sheet: sheetOf('rec-1') }, handlers: { 'ui.context': () => ({ workspace: { id: 'w', name: 'W', demo: false }, member: {}, contextKey: 'k', timeZone: 'Asia/Kolkata' }) } });
  const timeline = await screen.findByRole('table', { name: 'Time line' });
  await waitFor(() => expect(within(timeline).getByText('1 Oct 2026')).toBeTruthy());
  cleanup();
  setup({ address: { place: 'books', sub: 'customers', sheet: sheetOf('rec-1') } });
  expect(within(await screen.findByRole('table', { name: 'Time line' })).getByText('30 Sep 2026')).toBeTruthy();
});

// ---------------------------------------------------------------- BK-15

test('BK-15: History draws the demo clock with its label on a demo workspace; a real workspace shows nothing', async () => {
  setup({ address: { place: 'books', sub: 'history' }, handlers: { 'todayx.shell': () => ({ workspace: { demo: true }, clock: { mode: 'demo', date: '2026-09-30' }, banners: [], autoLockMinutes: 10 }) } });
  expect((await screen.findByText(/Demo clock: 30 Sep 2026/)).getAttribute('data-demo-clock')).toBe('2026-09-30');
  cleanup();
  setup({ address: { place: 'books', sub: 'history' }, language: 'hi', handlers: { 'todayx.shell': () => ({ workspace: { demo: true }, clock: { mode: 'real' } }) } });
  expect(await screen.findByText('डेमो कार्यक्षेत्र: डेमो घड़ी अभी तय नहीं हुई।')).toBeTruthy();
  cleanup();
  const real = setup({ address: { place: 'books', sub: 'history' }, handlers: { 'todayx.shell': () => ({ workspace: { demo: false }, clock: { mode: 'real' } }) } });
  await waitFor(() => expect(real.called('todayx.shell').length).toBe(1));
  expect(document.querySelector('[data-demo-clock]')).toBeNull();
  cleanup();
  setup({ address: { place: 'books', sub: 'belief' } });
  expect(await screen.findByText('Not built yet: the demo clock state.')).toBeTruthy();
});

// ---------------------------------------------------------------- BK-19 and BK-20

test('BK-19: the not-counted count from receipts, each opening its receipt; BK-20: the core deletion is said before the yes', async () => {
  const { openReceipt } = setup({ address: { place: 'books', sub: 'rates' } });
  fireEvent.click(await screen.findByText('billed on 1 Oct 2026: 2 rows in USD not counted'));
  expect(openReceipt).toHaveBeenCalledWith('r-9');
  cleanup();
  setup({ address: { place: 'books', sub: 'rates' }, handlers: { 'books.rates': () => ({ rates: [], notCounted: [], fromReceipts: { available: false, receipts: [] } }) } });
  expect(await screen.findByText(/Receipts do not carry this count yet/)).toBeTruthy();
  cleanup();
  setup({ address: { place: 'books', sub: 'customers', sheet: sheetOf('rec-1') } });
  fireEvent.click(await screen.findByRole('button', { name: /Delete/ }));
  expect(await screen.findByText(/deleted through the core too/)).toBeTruthy();
});

test('BK-20 (core-data round 4): the plan shows core-data\'s waiting actions before the yes; the report shows what is held elsewhere and what changed around it', async () => {
  const waitingReason = 'An action that is executing or unsure is checked first. It is kept until it is settled, then it can be deleted.';
  const report = { id: 'deletion-1', recordId: 'rec-1', at: '2026-10-15T10:00:00.000Z', by: 'Owner', complete: false,
    rows: [{ store: 'facts', count: 12, state: 'deleted', reason: null }, { store: 'actions', count: 2, state: 'pending', reason: waitingReason }],
    elsewhere: [{ store: 'source-files', count: 1, state: 'not-possible', reason: 'The original file kept with its import still holds these rows.' }, { store: 'decisions', count: 0, state: 'nothing-held', reason: null }],
    derived: { staleMarked: 3, modelReceiptsRemoved: 1, privateRemoved: 0 } };
  const { calls } = setup({ address: { place: 'books', sub: 'customers', sheet: sheetOf('rec-1') }, handlers: {
    'records.deletionPlan': () => ({ recordId: 'rec-1', canDelete: true, sourceDeletion: { available: false }, coreDeletion: { available: true, planFrom: 'core' },
      stores: [{ store: 'facts', count: 12, state: 'can-delete', reason: null, waiting: 0 }, { store: 'actions', count: 2, state: 'can-delete', reason: waitingReason, waiting: 1 }] }),
    'records.delete': () => report } });
  fireEvent.click(await screen.findByRole('button', { name: /Delete/ }));
  expect(await screen.findByText(/1 of these actions are being sent or their result is unsure/)).toBeTruthy();
  expect(screen.getByText('The core deletes only the rows you can see. Rows you cannot see here stay.')).toBeTruthy();
  fireEvent.change(screen.getByLabelText(/Type the customer id/), { target: { value: 'rec-1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
  expect(await screen.findByRole('heading', { name: 'Held elsewhere' })).toBeTruthy();
  expect(screen.getByText('Original files kept with imports')).toBeTruthy();
  expect(screen.getByText(/3 other answers or receipts marked out of date · 1 model receipts removed · 0 private copies removed/)).toBeTruthy();
  expect(calls.filter(c => c.method === 'records.delete').map(c => c.payload)).toEqual([{ id: 'rec-1', confirmation: 'rec-1' }]);
});

test('BK-20: in Hindi the waiting actions and the held-elsewhere list are in Hindi', async () => {
  setup({ language: 'hi', address: { place: 'books', sub: 'customers', sheet: sheetOf('rec-1') }, handlers: {
    'records.deletionPlan': () => ({ recordId: 'rec-1', canDelete: true, sourceDeletion: { available: false }, coreDeletion: { available: true, planFrom: 'core' },
      stores: [{ store: 'actions', count: 2, state: 'can-delete', reason: null, waiting: 1 }] }) } });
  fireEvent.click(await screen.findByRole('button', { name: 'हमारे पास जो है उसे हटाएँ' }));
  expect(await screen.findByText(BOOKS_R4B.hi['del.waiting'].replace('{n}', '1'))).toBeTruthy();
});

// ---------------------------------------------------------------- BK-08 worked example and date used

const definitionWith = { label: 'Billed', meaning: 'Invoice value by invoice date.', kind: 'invoice', field: 'amountMinor', nulls: 'exclude', name: 'billed', currency: 'INR',
  usedFrom: '2026-04-01', example: { rows: [{ label: 'Invoice I1', amountMinor: '100000', counted: true }, { label: 'Payment P1', amountMinor: '5000', counted: false, reason: 'A payment is not billed.' }], resultMinor: '100000' } };
const meaningWith = (extras: string) => ({ word: definitionWith, origin: 'you', history: [], draft: { id: 'draft-1', name: 'billed', author: 'Owner', createdAt: '2026-10-01T10:00:00.000Z', state: 'draft',
  before: null, after: definitionWith, change: 'Adds a worked example.', affects: { calculations: ['billed'], savedAnswers: 0 }, reviews: [], checks: { ok: true, code: null }, digest: 'd1', extras } });

test('BK-08: the meaning sheet draws the worked example, its result and the date used; a draft-only example says so', async () => {
  setup({ address: { place: 'books', sub: 'meanings', sheet: sheetOf('billed') }, handlers: {
    'books.meanings': () => ({ dictionary: null, words: [], drafts: [] }), 'books.gst': () => ({ gstMode: null, rates: { available: true } }), 'books.meaning': () => meaningWith('draft-only') } });
  expect((await screen.findAllByText('Used from 2026-04-01')).length).toBe(2);
  expect(screen.getAllByText('A payment is not billed.').length).toBe(2);
  expect(screen.getAllByText('Left out').length).toBeGreaterThan(0);
  expect(screen.getByText(/kept on this draft/)).toBeTruthy();
});

test('BK-08: the draft form sends the worked example in core-data\'s shape, with the result the counted rows add up to', async () => {
  const { calls } = setup({ address: { place: 'books', sub: 'meanings' }, handlers: {
    'books.meanings': () => ({ dictionary: null, words: [], drafts: [] }), 'books.gst': () => ({ gstMode: null, rates: { available: true } }),
    'books.draft': () => meaningWith('published-with').draft } });
  const form = await screen.findByRole('form', { name: 'Start a draft' });
  const f = within(form);
  for (const [label, value] of [['Word (short name)', 'billed'], ['Label', 'Billed'], ['Meaning in plain words', 'Invoice value by invoice date.'], ['Kind of record it counts', 'invoice'], ['Field it reads', 'amountMinor']] as const)
    fireEvent.change(f.getByLabelText(label), { target: { value } });
  fireEvent.change(f.getByLabelText(/Used from/), { target: { value: '2026-04-01' } });
  fireEvent.click(f.getByRole('button', { name: 'Add an example row' }));
  fireEvent.change(f.getByLabelText('Example row'), { target: { value: 'Invoice I1' } });
  fireEvent.change(f.getByLabelText('Amount in paise'), { target: { value: '100000' } });
  expect(f.getByText(/The example adds up to/)).toBeTruthy();
  fireEvent.submit(form);
  await waitFor(() => expect(calls.some(c => c.method === 'books.draft')).toBe(true));
  const sent = calls.find(c => c.method === 'books.draft')!.payload as any;
  expect(sent.definition.usedFrom).toBe('2026-04-01');
  expect(sent.definition.example).toEqual({ rows: [{ label: 'Invoice I1', amountMinor: '100000', counted: true }], resultMinor: '100000' });
});

// ---------------------------------------------------------------- bill photo

test('bill photo: fields outlined by their words on page 1, and every later page drawn with its own outline', async () => {
  setup({ address: { place: 'books', sub: 'bill' } });
  fireEvent.change(screen.getByLabelText(/Choose a bill/), { target: { files: [new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'bill.png', { type: 'image/png' })] } });
  await screen.findByRole('form', { name: 'What the bill says' });
  const first = screen.getByRole('img', { name: /Where each field was read/ });
  expect(first.querySelector('rect[data-region="billNumber"]')?.getAttribute('data-box')).toBe('words');
  expect(first.querySelector('rect[data-region="date"]')?.getAttribute('data-box')).toBe('line');
  expect(first.querySelector('rect[data-region="total"]')).toBeNull();
  const second = screen.getByRole('img', { name: 'Page 2 of 2' });
  expect(second.querySelector('rect[data-region="total"]')?.getAttribute('data-box')).toBe('words');
  expect(second.querySelector('rect[data-region="tax-0"]')).toBeTruthy();
  expect(screen.getByText(/3 more words on this page are not outlined/)).toBeTruthy();
});
