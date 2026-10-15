import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TextProvider } from '../../app/ui/src/app/text';
import type { Address, Language, View } from '../../app/ui/src/app/presentation.ts';
import { AskPlace } from '../../app/ui/src/screens/ask/lane/AskPlace';

// The audit of AS-01 to AS-19: what each screen draws per view, per language and per seat.
// Every reply here is synthetic and shaped like platform/runtime/ask/contracts.ts.
type Handler = (payload: Record<string, unknown>) => unknown;
function fakeRpc(handlers: Record<string, Handler>) {
  const calls: [string, Record<string, unknown>][] = [];
  return {
    calls,
    request: async (method: string, payload: Record<string, unknown>) => {
      calls.push([method, payload]);
      const handler = handlers[method];
      if (handler === undefined) throw Object.assign(new Error('unknown'), { code: 'UNKNOWN_METHOD' });
      return structuredClone(handler(payload));
    },
  };
}
function mount(address: Address, handlers: Record<string, Handler>, options: { language?: Language; viewer?: boolean; view?: View } = {}) {
  const rpc = fakeRpc(handlers), language = options.language ?? 'en';
  render(
    <TextProvider language={language}>
      <AskPlace address={address} language={language} view={options.view ?? 'guided'} member={{ id: 'member-1', role: 'owner' }} viewer={options.viewer ?? false}
        rpc={rpc} live={() => true} openReceipt={() => undefined} navigate={() => undefined} />
    </TextProvider>,
  );
  return rpc;
}
async function found<E extends Element = HTMLElement>(selector: string): Promise<E> {
  return waitFor(() => { const el = document.querySelector<E>(selector); if (el === null) throw new Error(`missing ${selector}`); return el; });
}
const sheet = (name: string, sub = 'new'): Address => ({ place: 'ask', sub, sheet: name });
const sep = { from: '2026-09-01', to: '2026-09-30' };

beforeEach(() => {
  vi.stubGlobal('matchMedia', (media: string) => ({ matches: false, media, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true }));
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

/* AS-01: the plain calendar. */
const menu = {
  state: 'ready', seed: false, dictionary: null, gst2b: 'offered', today: '2026-10-14', branches: [],
  topics: [{ topic: 'sales', items: [{ operationId: 'sales.invoiced', label: 'Invoiced by customer', type: 'sum', topic: 'sales', needs: ['period'], meaning: null }] }],
  periods: [{ id: 'this-month', period: { from: '2026-10-01', to: '2026-10-31' } }, { id: 'last-month', period: sep }],
};
const answer = (over: Record<string, unknown> = {}) => ({
  kind: 'answer', answerId: null, receiptId: 'r-1', operationId: 'sales.invoiced', label: 'Invoiced by customer', period: sep, comparePeriod: null, branch: null,
  asOf: '2026-09-12', headline: '',
  figures: [{ key: 'billed', label: 'Billed', minor: '1234500', unit: 'money' }, { key: 'received', label: 'Received', minor: '900000', unit: 'money' }],
  rows: { read: 214, counted: 211, excluded: 3 }, completeness: 'reconciled-imports', gaps: [], monthsNotLoaded: [], labels: [],
  explanation: { source: 'template', text: 'Invoiced in September.', replaced: false, reason: 'no-model' },
  guard: { status: 'passed', lines: [] }, sent: 'nothing', ...over,
});

test('the menu runs a calculation on dates chosen from a plain calendar, and refuses a backwards pair', async () => {
  const user = userEvent.setup();
  const rpc = mount({ place: 'ask', sub: 'new' }, { 'askx.menu': () => menu, 'askx.suggest': () => ({ suggestions: [] }), 'askx.run': () => answer(), 'askx.answer': () => answer() });
  const dates = await found<HTMLElement>('[data-own-dates]');
  await user.type(within(dates).getByLabelText('From'), '2026-09-30');
  await user.type(within(dates).getByLabelText('To'), '2026-09-01');
  expect(within(dates).getByText('The first date must not be after the second.')).toBeTruthy();
  await user.clear(within(dates).getByLabelText('From'));
  await user.type(within(dates).getByLabelText('From'), '2026-09-01');
  await user.clear(within(dates).getByLabelText('To'));
  await user.type(within(dates).getByLabelText('To'), '2026-09-15');
  expect(within(dates).getByText(/The menu will use/)).toBeTruthy();
  await user.click(screen.getByRole('button', { name: /Invoiced by customer/ }));
  expect(rpc.calls.find(c => c[0] === 'askx.run')![1]).toEqual({ operationId: 'sales.invoiced', period: { from: '2026-09-01', to: '2026-09-15' } });
});

/* AS-04. */
test('an answer with two measures shows each as its own figure that opens the receipt, in Guided', async () => {
  const user = userEvent.setup();
  const rpc = mount(sheet('answer.r-1'), { 'askx.answer': () => answer(), 'askx.receipt': () => { throw Object.assign(new Error('x'), { code: 'UNKNOWN_METHOD' }); } });
  const measures = await found<HTMLElement>('[data-measures]');
  expect(within(measures).getByText(/different measures of the same question/)).toBeTruthy();
  expect(within(measures).getByText('Billed')).toBeTruthy();
  await user.click(within(measures).getByRole('button', { name: '₹9,000' }));
  expect(rpc.calls.some(c => c[0] === 'askx.receipt' && c[1].receiptId === 'r-1')).toBe(true);
});

test('a stale answer offers Rebuild, which works it out again; a viewer sees the date and no Rebuild', async () => {
  const user = userEvent.setup();
  const rpc = mount(sheet('answer.r-1'), { 'askx.answer': p => answer({ receiptId: p.receiptId, labels: p.receiptId === 'r-1' ? ['stale'] : [] }), 'askx.run': () => answer({ receiptId: 'r-2' }) });
  const stale = await found<HTMLElement>('[data-answer-stale]');
  expect(within(stale).getByText(/may be out of date/)).toBeTruthy();
  await user.click(within(stale).getByRole('button', { name: 'Rebuild' }));
  expect(rpc.calls.find(c => c[0] === 'askx.run')![1]).toEqual({ operationId: 'sales.invoiced', period: sep, branch: null });
  await waitFor(() => expect(rpc.calls.some(c => c[0] === 'askx.answer' && c[1].receiptId === 'r-2')).toBe(true));
  cleanup();
  mount(sheet('answer.r-1'), { 'askx.answer': () => answer({ labels: ['stale'] }) }, { viewer: true });
  const shown = await found<HTMLElement>('[data-answer-stale]');
  expect(within(shown).queryByRole('button', { name: 'Rebuild' })).toBeNull();
});

test('nothing loaded for the period is "not enough to tell" with the months in words, never a zero', async () => {
  mount(sheet('answer.r-1'), { 'askx.answer': () => answer({ figures: [], completeness: 'empty', monthsNotLoaded: ['2026-08', '2026-09'] }) });
  expect(await screen.findByText(/Not enough loaded to tell/)).toBeTruthy();
  expect(screen.getByText('2 months not loaded yet: August 2026 and September 2026.')).toBeTruthy();
  expect(screen.queryByText('₹0')).toBeNull();
});

/* AS-05. */
const receipt = {
  receiptId: 'r-1', operationId: 'sales.invoiced', label: 'Invoiced by customer',
  chain: { question: null, calculation: 'Invoiced by customer', rowsRead: 217, totalChecked: true },
  figures: [{ key: 'billed', label: 'Billed', minor: '1234500', unit: 'money' }], period: sep, comparePeriod: null, asOf: '2026-10-14', createdAt: '2026-10-14', branch: null,
  definitions: [], exclusions: [], completeness: 'reconciled-imports', gaps: [],
  sources: [{ sourceId: 'src-tally', wayIn: 'interface', format: 'xml', recipe: { id: 'rec-1', state: 'tested', hash: 'h1' }, rows: 217 }],
  versions: { app: '1.0.0', dictionary: 3, dictionaryHash: 'dh', definitionHash: 'defh', recipes: ['h1'], calculator: 'calc-2' },
  allowedBy: { memberId: 'owner-1', role: 'owner', device: 'mcp', at: '2026-10-14T09:00:00.000Z' },
  labels: [], notCounted: 0, fx: [{ from: 'USD', to: 'INR', rate: '8350/100', on: '2026-09-30' }], sent: { kind: 'nothing' },
  meaning: null, demo: false, provenance: null,
};

test('the receipt small print carries the way in, the recipe state, the rate and the decision that allowed it, in Simple too', async () => {
  mount(sheet('answer.r-1'), { 'askx.answer': () => answer(), 'askx.receipt': () => receipt }, { view: 'simple' });
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'See the receipt' }));
  const print = await found<HTMLElement>('[data-small-print]');
  expect(within(print).getByText('Way in: src-tally')).toBeTruthy();
  expect(within(print).getByText('its own interface · xml')).toBeTruthy();
  expect(within(print).getByText('Recipe tested · rec-1')).toBeTruthy();
  expect(within(print).getByText('Rate: USD to INR')).toBeTruthy();
  expect(within(print).getByText('Allowed by')).toBeTruthy();
  expect(document.querySelector('[data-source="src-tally"]')).not.toBeNull();
  expect(screen.getByText(/Only the text handed to the tool is visible/)).toBeTruthy();
});

/* AS-06. */
test('rows wholly hidden from this seat say so, not that nothing was counted, in English and Hindi', async () => {
  const hidden = () => ({ tab: 'counted', total: 0, offset: 0, rows: [], hidden: true, hiddenCount: null, rule: null });
  mount(sheet('answer.r-1'), { 'askx.answer': () => answer(), 'askx.receipt': () => receipt, 'askx.sourceRows': hidden });
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'See the receipt' }));
  await user.click(await screen.findByRole('button', { name: 'Rows counted' }));
  expect((await found<HTMLElement>('[data-rows-empty]')).textContent).toMatch(/None of these rows can be shown to your seat/);
  expect(screen.queryByText('No rows were counted for this receipt.')).toBeNull();
  expect(screen.getByText(/hidden from your seat by a rule in Trust/)).toBeTruthy();
});

/* AS-14. */
const savedItems = { items: [
  { id: 's-1', kind: 'answer', question: 'Billed in September', operationId: 'sales.invoiced', savedAt: '2026-09-12', receiptId: 'r-1', refId: null, headline: { kind: 'money', minor: '123456700' }, workedOutAt: '2026-09-12',
    deletedOn: null, stale: { reason: 'meaning-changed', since: '2026-10-01' }, rebuildable: false },
] };

test('a stale saved answer that cannot be rebuilt says so and offers no Rebuild; Simple rows use the short money form', async () => {
  mount({ place: 'ask', sub: 'saved' }, { 'askx.saved': () => savedItems }, { view: 'simple' });
  expect(await screen.findByText(/This cannot be rebuilt here/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Rebuild' })).toBeNull();
  const figure = screen.getByRole('button', { name: '₹12.35 lakh' });
  expect(figure.getAttribute('title')).toContain('123456700');
  cleanup();
  mount({ place: 'ask', sub: 'saved' }, { 'askx.saved': () => savedItems }, { view: 'guided' });
  expect(await screen.findByRole('button', { name: '₹12,34,567' })).toBeTruthy();
});

test('saved in Hindi uses its Hindi catalogue for the cannot-rebuild line', async () => {
  mount({ place: 'ask', sub: 'saved' }, { 'askx.saved': () => savedItems }, { language: 'hi' });
  expect(await screen.findByText(/इसे यहाँ फिर से नहीं बनाया जा सकता/)).toBeTruthy();
});

/* AS-15. */
test('the inbox keeps its order, a waiting question does not open as a decision, and the journal labels replaced and cancelled', async () => {
  mount({ place: 'ask', sub: 'decisions' }, {
    'askx.decisions.inbox': () => ({
      drafts: [{ id: 'dr-1', sentence: 'Raise prices 2%', reviewDate: '2026-11-01', origin: 'typed', createdAt: '2026-10-10T00:00:00.000Z', receiptIds: [] }],
      due: [{ id: 'd-1', text: 'Stop credit to Sharma', reviewDate: '2026-10-01' }],
      waiting: [{ id: 'q-1', text: 'Which branch pays rent?', at: '2026-10-09T00:00:00.000Z' }],
    }),
    'askx.decisions.list': () => ({ items: [
      { id: 'd-2', text: 'Open a second shop', createdAt: '2026-09-01T00:00:00.000Z', reviewDate: '2026-12-01', status: 'closed', recordedLater: true, replaced: false, cancelled: true, reviews: 1, receiptIds: [] },
      { id: 'd-3', text: 'Hire one more', createdAt: '2026-08-01T00:00:00.000Z', reviewDate: '2026-12-01', status: 'open', recordedLater: false, replaced: true, cancelled: false, reviews: 0, receiptIds: [] },
    ] }),
  });
  const drafts = await found<HTMLElement>('[data-decisions="drafts"]'), due = document.querySelector('[data-decisions="due"]')!, waiting = document.querySelector('[data-decisions="waiting"]')!;
  expect(drafts.compareDocumentPosition(due) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(due.compareDocumentPosition(waiting) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(within(waiting as HTMLElement).queryByRole('button', { name: /Which branch pays rent/ })).toBeNull();
  expect(within(due as HTMLElement).getByRole('button', { name: /Stop credit to Sharma/ })).toBeTruthy();
  const journal = document.querySelector('[data-decisions="journal"]') as HTMLElement;
  expect(within(journal).getByText('Open a second shop — cancelled, recorded later')).toBeTruthy();
  expect(within(journal).getByText('Hire one more — replaced')).toBeTruthy();
});

/* AS-16. */
test('a moved check shows the old and the new value, each opening its own receipt', async () => {
  const user = userEvent.setup();
  const rpc = mount(sheet('check.c-1', 'checks'), {
    'askx.checks.get': () => ({ id: 'c-1', question: 'Collections in August', operationId: 'collections.total', figureKey: 'total', createdAt: '2026-09-05T00:00:00.000Z',
      expected: { minor: '100000', receiptId: 'r-aug' }, results: [{ at: '2026-10-10T00:00:00.000Z', result: 'moved', minor: '120000', receiptId: 'r-new', code: null, because: ['recipes'] }] }),
    'askx.receipt': () => { throw Object.assign(new Error('x'), { code: 'UNKNOWN_METHOD' }); },
  });
  const pair = await found<HTMLElement>('[data-check-pair]');
  expect(within(pair).getByText('Old value')).toBeTruthy();
  expect(within(pair).getByText('New value')).toBeTruthy();
  await user.click(within(pair).getByRole('button', { name: '₹1,200' }));
  expect(rpc.calls.some(c => c[0] === 'askx.receipt' && c[1].receiptId === 'r-new')).toBe(true);
});

/* AS-12. */
test('a forecast that lost names the baseline on the answer itself', async () => {
  mount(sheet('forecast'), {
    'askx.menu': () => menu,
    'askx.forecast': () => ({
      state: 'ready', answer: 'baseline', operationId: 'sales.invoiced', label: 'Invoiced', label2: 'projection',
      history: [{ month: '2026-08', minor: '100000', receiptId: 'r-aug' }, { month: '2026-09', minor: '82000', receiptId: 'r-sep' }],
      heldBack: [{ month: '2026-09', actualMinor: '82000', forecastMinor: '95000', baselineMinor: '85000' }],
      error: { forecastMinor: '13000', baselineMinor: '3000' }, next: { month: '2026-10', forecastMinor: '96000', baselineMinor: '88000', rangeMinor: '7000' },
      method: { forecast: 'seasonal-trend', baseline: 'last-year-pattern', learnedFrom: { from: '2024-07-01', to: '2026-08-31' }, testedOn: sep }, evaluationId: 'eval-1',
    }),
  });
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Forecast it' }));
  expect((await found<HTMLElement>('[data-forecast-tile="baseline"]')).textContent).toMatch(/from the simple baseline/);
});

/* AS-17. */
test('the not-yet list heading is one template in each language', async () => {
  mount({ place: 'ask', sub: 'notyet' }, { 'askx.wanted': () => ({ calculations: [{ text: 'peer margins', count: 2, lastAt: '2026-10-01' }], actions: [], words: [] }) }, { language: 'hi' });
  expect(await screen.findByText('चाही गई गणनाएँ · इस सूची में 1')).toBeTruthy();
});

/* AS-19. */
const gst = {
  state: 'ready', period: sep, toleranceMinor: '1000', via: 'facts', sources: null, matchReceiptId: null, leftOut: 3,
  groups: [{ group: 'matched', count: 12, taxableMinor: '5000000', taxMinor: '900000', unknownTax: 0 }, { group: 'differs-inside', count: 2, taxableMinor: '100000', taxMinor: '18000', unknownTax: 0 }, { group: 'differs-outside', count: 1, taxableMinor: '40000', taxMinor: '7200', unknownTax: 0 }, { group: 'in-2b-only', count: 0, taxableMinor: '0', taxMinor: '0', unknownTax: 0 }, { group: 'books-only', count: 0, taxableMinor: '0', taxMinor: '0', unknownTax: 0 }],
  lines: [], ims: [],
};

test('gst2b says how many rows were left out of the match, and Books shows the groups as a table', async () => {
  mount(sheet('gst2b'), { 'askx.gst2b': () => gst }, { view: 'books' });
  expect((await found<HTMLElement>('[data-gst-left-out]')).textContent).toMatch(/^3 rows were left out of the match/);
  const table = await found<HTMLElement>('[data-gst-table]');
  expect(within(table).getByText('Amount differs, outside the tolerance')).toBeTruthy();
  expect(within(table).getAllByRole('row').length).toBe(6);
  cleanup();
  mount(sheet('gst2b'), { 'askx.gst2b': () => gst }, { view: 'guided' });
  await found<HTMLElement>('[data-gst-left-out]');
  expect(document.querySelector('[data-gst-table]')).toBeNull();
});

test('a gst2b reply without the left-out count is not drawn', async () => {
  const { leftOut: _drop, ...partial } = gst;
  mount(sheet('gst2b'), { 'askx.gst2b': () => partial });
  expect(await screen.findByText(/could not be checked/)).toBeTruthy();
  expect(document.querySelector('[data-gst-groups]')).toBeNull();
});
