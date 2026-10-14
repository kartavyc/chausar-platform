import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TextProvider } from '../../app/ui/src/app/text';
import type { Address, Language, View } from '../../app/ui/src/app/presentation.ts';
import { AskPlace } from '../../app/ui/src/screens/ask/lane/AskPlace';
import { hundredths } from '../../app/ui/src/screens/ask/lane/analysis';

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
/** Waits until the selector matches, then returns the element. */
async function found<E extends Element = HTMLElement>(selector: string): Promise<E> {
  return waitFor(() => { const el = document.querySelector<E>(selector); if (el === null) throw new Error(`missing ${selector}`); return el; });
}
const sheet = (name: string, sub = 'new'): Address => ({ place: 'ask', sub, sheet: name });

const sep = { from: '2026-09-01', to: '2026-09-30' }, aug = { from: '2026-08-01', to: '2026-08-31' };
const menu = {
  state: 'ready', seed: false, dictionary: null, gst2b: 'offered', today: '2026-10-14',
  topics: [{ topic: 'collections', items: [{ operationId: 'collections.total', label: 'Collections', type: 'sum', topic: 'collections', needs: ['period'], meaning: null }, { operationId: 'collections.count', label: 'Receipts counted', type: 'count', topic: 'collections', needs: ['period'], meaning: null }] }],
  periods: [{ id: 'this-month', period: { from: '2026-10-01', to: '2026-10-31' } }, { id: 'last-month', period: sep }],
};
const why = {
  id: 'why-1', createdAt: '2026-10-14T09:00:00.000Z', operationId: 'collections.total', label: 'Collections', by: 'customer',
  earlier: { period: aug, minor: '100000', receiptId: 'r-aug' }, later: { period: sep, minor: '82000', receiptId: 'r-sep' },
  bars: [{ key: 'Sharma Traders', changeMinor: '-15000' }, { key: '<b>Gupta</b> & Sons', changeMinor: '-5000' }], otherMinor: '2000',
  guesses: [{ id: 'g-1', text: 'A festival week moved payments', forReceiptIds: ['r-sep'], againstReceiptIds: [], source: { name: 'Synthetic calendar', fetchedAt: '2026-10-10T00:00:00.000Z' }, at: '2026-10-12T00:00:00.000Z' }],
  direction: 'down', changeMinor: '-18000', changeBps: '-1800',
  steps: [{ id: 'earlier', state: 'done' }, { id: 'later', state: 'done' }, { id: 'split', state: 'done' }],
};

beforeEach(() => {
  vi.stubGlobal('matchMedia', (media: string) => ({ matches: false, media, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true }));
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

test('typed rupees and percents become whole hundredths by string arithmetic', () => {
  expect(hundredths('1,250.5')).toBe('125050');
  expect(hundredths('0.07')).toBe('7');
  expect(hundredths('-2.5', true)).toBe('-250');
  expect(hundredths('-2.5')).toBeNull();
  expect(hundredths('1.234')).toBeNull();
  expect(hundredths('99999999999999.99')).toBe('9999999999999999');
});

test('why draws a measured bridge and keeps the guess apart, labelled guess', async () => {
  const user = userEvent.setup();
  const rpc = mount(sheet('why.why-1'), { 'askx.saveRef': () => ({ id: 'saved-1' }), 'askx.why.get': () => why, 'askx.why.guess': p => ({ ...why, guesses: [...why.guesses, { id: 'g-2', text: String(p.text), forReceiptIds: [], againstReceiptIds: [], source: null, at: '2026-10-14T00:00:00.000Z' }] }) });
  expect(await screen.findByRole('heading', { level: 1, name: /Collections fell 18% in/ })).toBeTruthy();
  const measured = document.querySelector('[data-why-part="measured"]') as HTMLElement;
  const possible = document.querySelector('[data-why-part="possible"]') as HTMLElement;
  expect(measured.querySelectorAll('[data-bridge-bar]').length).toBe(5);
  expect([...measured.querySelectorAll('[data-bridge-bar]')].map(b => b.getAttribute('data-bridge-bar'))).toEqual(['start', 'down', 'down', 'up', 'end']);
  expect(within(measured).getByText('<b>Gupta</b> & Sons')).toBeTruthy();
  expect(measured.querySelector('b')).toBeNull();
  expect(within(measured).queryByText(/festival/)).toBeNull();
  expect(within(possible).getByText('A festival week moved payments')).toBeTruthy();
  expect(screen.getByRole('region', { name: 'Possible causes' }).querySelector('h2')!.textContent).toContain('guess');
  expect(within(possible).getByText(/From Synthetic calendar, fetched/)).toBeTruthy();
  await user.type(within(possible).getByLabelText('Write a possible cause'), 'Two customers paid late');
  await user.click(within(possible).getByRole('button', { name: 'Add the guess' }));
  expect(await within(possible).findByText('Two customers paid late')).toBeTruthy();
  expect(rpc.calls.find(c => c[0] === 'askx.why.guess')![1]).toMatchObject({ whyId: 'why-1', text: 'Two customers paid late' });
  await user.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByText('Saved.')).toBeTruthy();
  expect(rpc.calls.find(c => c[0] === 'askx.saveRef')![1]).toMatchObject({ kind: 'why', refId: 'why-1' });
});

test('why form starts from a money total with the period before as the default comparison', async () => {
  const user = userEvent.setup();
  const rpc = mount(sheet('why'), { 'askx.menu': () => menu, 'askx.why.start': () => why });
  const select = await screen.findByLabelText('Calculation');
  expect(within(select).queryByText('Receipts counted')).toBeNull();
  await user.click(screen.getByRole('radio', { name: 'Branch' }));
  await user.click(screen.getByRole('button', { name: 'Find out why' }));
  expect(await screen.findByRole('heading', { level: 1, name: /fell 18%/ })).toBeTruthy();
  const payload = rpc.calls.find(c => c[0] === 'askx.why.start')![1];
  expect(payload).toEqual({ operationId: 'collections.total', period: sep, by: 'branch' });
});

test('a bridge whose causes do not add up is written out, not drawn', async () => {
  mount(sheet('why.why-1'), { 'askx.why.get': () => ({ ...why, otherMinor: '1999' }) });
  expect(await screen.findByText(/do not lead exactly/)).toBeTruthy();
  expect(document.querySelectorAll('[data-bridge-bar]').length).toBe(0);
});

test('what if shows the label, the assumption and two figures side by side', async () => {
  const user = userEvent.setup();
  const rpc = mount(sheet('whatif'), { 'askx.whatIf': () => ({ label: 'what-if', assumption: { name: 'price', beforeBps: '0', afterBps: '500' }, books: { minor: '1000000', receiptId: 'r-books' }, withChange: { minor: '1050000', receiptId: 'r-with' }, change: { minor: '50000', receiptId: 'r-change' }, period: sep, branch: null }) });
  await user.type(screen.getByLabelText('Change in prices, in percent'), '5');
  await user.click(screen.getByRole('button', { name: 'Show what if' }));
  const figures = await found<HTMLElement>('[data-whatif-figures]');
  expect(rpc.calls[0]).toEqual(['askx.whatIf', { periodId: 'last-month', priceChangeBps: '500' }]);
  expect(within(figures).getByText('Your books')).toBeTruthy();
  expect(within(figures).getByText('With the change')).toBeTruthy();
  expect(within(figures).getByRole('button', { name: '₹10,000' })).toBeTruthy();
  expect(within(figures).getByRole('button', { name: '₹10,500' })).toBeTruthy();
  expect(screen.getByRole('heading', { level: 1 }).parentElement!.textContent).toContain('what if');
  expect(screen.getByText('5%')).toBeTruthy();
});

const forecastReady = {
  state: 'ready', answer: 'baseline', operationId: 'collections.total', label: 'Collections', label2: 'projection',
  history: [{ month: '2026-07', minor: '90000', receiptId: 'r-jul' }, { month: '2026-08', minor: '100000', receiptId: 'r-aug' }, { month: '2026-09', minor: '82000', receiptId: 'r-sep' }],
  heldBack: [{ month: '2026-08', actualMinor: '100000', forecastMinor: '93000', baselineMinor: '98000' }, { month: '2026-09', actualMinor: '82000', forecastMinor: '95000', baselineMinor: '85000' }],
  error: { forecastMinor: '10000', baselineMinor: '2500' },
  next: { month: '2026-10', forecastMinor: '96000', baselineMinor: '88000', rangeMinor: '7000' },
  method: { forecast: 'seasonal-trend', baseline: 'last-year-pattern', learnedFrom: { from: '2024-07-01', to: '2026-07-31' }, testedOn: { from: aug.from, to: sep.to } },
  evaluationId: 'eval-1',
};

test('forecast that lost shows the baseline as the answer, the chart and the held-back error', async () => {
  const user = userEvent.setup();
  const rpc = mount(sheet('forecast'), { 'askx.menu': () => menu, 'askx.forecast': () => forecastReady });
  await user.click(await screen.findByRole('button', { name: 'Forecast it' }));
  expect(await screen.findByText(/so the baseline is the answer/)).toBeTruthy();
  expect(rpc.calls.find(c => c[0] === 'askx.forecast')![1]).toEqual({ operationId: 'collections.total' });
  expect(screen.getByRole('button', { name: '₹880' })).toBeTruthy();
  expect(document.querySelector('[data-forecast-line="past"]')!.getAttribute('d')).toMatch(/^M/);
  expect(document.querySelector('[data-forecast-band]')).toBeTruthy();
  const error = document.querySelector('[data-forecast-error]') as HTMLElement;
  expect(within(error).getByRole('button', { name: '₹100' })).toBeTruthy();
  expect(within(error).getByRole('button', { name: '₹25' })).toBeTruthy();
  expect(screen.getAllByText('projection').length).toBeGreaterThan(0);
  expect(screen.getByText('seasonal-trend')).toBeTruthy();
});

test('forecast with too little history, or untestable history, says so in words', async () => {
  mount(sheet('forecast'), { 'askx.menu': () => menu, 'askx.forecast': () => ({ state: 'not-enough-history', months: 9, needed: 24 }) });
  await userEvent.setup().click(await screen.findByRole('button', { name: 'Forecast it' }));
  expect(await screen.findByText('Not enough history to test a forecast.')).toBeTruthy();
  expect(screen.getByText('9 months of history are loaded; 24 are needed.')).toBeTruthy();
  cleanup();
  mount(sheet('forecast'), { 'askx.menu': () => menu, 'askx.forecast': () => ({ state: 'cannot-test', code: 'ASK_FORECAST_GAPS' }) });
  await userEvent.setup().click(await screen.findByRole('button', { name: 'Forecast it' }));
  expect(await screen.findByText(/cannot be tested/)).toBeTruthy();
});

test('plan sends exact paise and basis points, and shows which limits clash', async () => {
  const user = userEvent.setup();
  const rpc = mount(sheet('plan'), { 'askx.plan': () => ({ label: 'experimental', feasible: false, limits: [{ index: 0, figure: 'change', op: 'atLeast', minor: '1000050', tight: false, alone: false }, { index: 1, figure: 'scenario', op: 'atMost', minor: '500000', tight: false, alone: false }], recommended: null, clash: [0, 1], tried: 11 }) });
  expect(screen.getByText('experimental')).toBeTruthy();
  await user.type(screen.getByLabelText('Amount in rupees'), '10,000.5');
  await user.click(screen.getByRole('button', { name: 'Add a limit' }));
  await user.click(screen.getAllByRole('radio', { name: 'At most' })[1]!);
  await user.type(screen.getAllByLabelText('Amount in rupees')[1]!, '5000');
  await user.click(screen.getByRole('button', { name: 'Find the best plan' }));
  expect(await screen.findByText('No price in the range meets every limit.')).toBeTruthy();
  expect(rpc.calls[0]![1]).toEqual({ periodId: 'last-month', fromBps: '-500', toBps: '500', stepBps: '100', limits: [{ figure: 'change', op: 'atLeast', minor: '1000050' }, { figure: 'scenario', op: 'atMost', minor: '500000' }] });
  const clash = document.querySelector('[data-plan="clash"]') as HTMLElement;
  expect(within(clash).getByText('The difference, at least ₹10,000.50')).toBeTruthy();
  expect(within(clash).getByText('With the change, at most ₹5,000')).toBeTruthy();
  expect(screen.getByText('11 prices tried.')).toBeTruthy();
});

const gst = {
  state: 'ready', period: sep, toleranceMinor: '1000', via: 'facts', leftOut: 2,
  groups: [{ group: 'matched', count: 12, taxableMinor: '5000000', taxMinor: '900000' }, { group: 'differs-inside', count: 2, taxableMinor: '100000', taxMinor: '18000' }, { group: 'differs-outside', count: 1, taxableMinor: '40000', taxMinor: '7200' }, { group: 'in-2b-only', count: 1, taxableMinor: '30000', taxMinor: '5400' }, { group: 'books-only', count: 0, taxableMinor: '0', taxMinor: '0' }],
  lines: [{ id: 'l-1', group: 'in-2b-only', supplier: 'Synthetic Supplier <i>', invoice: 'INV-7', booksMinor: null, twoBMinor: '35400', differenceMinor: null, bookRowId: null, twoBRowId: 'row-9' }],
  ims: [{ lineId: 'l-1', action: 'pending', reason: 'not-in-books' }],
};

test('gst2b shows four groups, opens a line as written, lists IMS and exports it', async () => {
  const user = userEvent.setup();
  const create = vi.fn(() => 'blob:synthetic');
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() }));
  const rpc = mount(sheet('gst2b'), {
    'askx.gst2b': () => gst,
    'askx.gst2b.line': () => ({ id: 'l-1', group: 'in-2b-only', books: null, twoB: { rowId: 'row-9', sourceId: 'gstr2b-sep', sourceRow: 9, cells: [{ name: 'Supplier', value: 'Synthetic Supplier <i>' }, { name: 'Tax', value: '354.00' }] }, rule: { toleranceMinor: '1000', key: 'supplier-gstin-and-invoice' } }),
    'askx.gst2b.exportIms': () => ({ fileName: 'ims-2026-09.csv', csv: 'invoice,action\nINV-7,pending\n' }),
  });
  const groups = await found<HTMLElement>('[data-gst-groups]');
  expect(within(groups).getAllByRole('listitem').length).toBe(4);
  expect(within(groups).getByText('2 inside the tolerance of ₹10 · 1 outside')).toBeTruthy();
  expect(within(groups).getByText('12 invoices · tax ₹9,000 on ₹50,000')).toBeTruthy();
  expect(screen.getByText(/Chausar never acts in the GST portal/)).toBeTruthy();
  await user.click(within(groups).getByRole('button', { name: /In 2B only/ }));
  const lines = await found<HTMLElement>('[data-gst-lines]');
  await user.click(within(lines).getByRole('button', { name: /Synthetic Supplier <i>/ }));
  const line = await found<HTMLElement>('[data-gst-line] dl');
  expect(within(line).getByText('Synthetic Supplier <i>')).toBeTruthy();
  expect(screen.getByText('This invoice is not in your books.')).toBeTruthy();
  expect(within(document.querySelector('[data-gst-ims]') as HTMLElement).getByText('Keep pending in the GST portal, because it is not in your books.')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Export the IMS list' }));
  const link = await found<HTMLAnchorElement>('[data-gst-download]');
  expect(link.getAttribute('download')).toBe('ims-2026-09.csv');
  expect(link.getAttribute('href')).toBe('blob:synthetic');
  expect(create).toHaveBeenCalledTimes(1);
  expect(rpc.calls.map(c => c[0])).toContain('askx.gst2b.exportIms');
});

test('gst2b not applicable and not loaded are words with the reason', async () => {
  mount(sheet('gst2b'), { 'askx.gst2b': () => ({ state: 'not-applicable', reason: 'composition' }) });
  expect(await screen.findByText(/composition scheme, so there is no GSTR-2B to match/)).toBeTruthy();
  cleanup();
  mount(sheet('gst2b'), { 'askx.gst2b': () => ({ state: 'not-loaded', period: sep }) });
  expect(await screen.findByText(/is not loaded yet/)).toBeTruthy();
});

test('search groups hits by kind and draws the matching words in ink as marks', async () => {
  const user = userEvent.setup();
  mount(sheet('search'), { 'askx.search': p => ({ query: p.query, groups: [{ kind: 'decision', hits: [{ id: 'd-1', text: 'Stop credit to <script>Sharma</script>', marks: [[15, 31]] }] }, { kind: 'why', hits: [{ id: 'why-1', text: 'Collections fell', marks: [[0, 11]] }] }] }) });
  expect(screen.getByText(/The search runs on this computer/)).toBeTruthy();
  await user.type(screen.getByRole('searchbox'), 'Sharma');
  await user.click(screen.getByRole('button', { name: 'Search' }));
  const results = await found<HTMLElement>('[data-search-results]');
  expect(within(results).getByRole('region', { name: 'Decisions' })).toBeTruthy();
  expect(within(results).getByRole('region', { name: 'Why it changed' })).toBeTruthy();
  expect([...results.querySelectorAll('mark')].map(m => m.textContent)).toEqual(['<script>Sharma</script>'.slice(0, 16), 'Collections']);
  expect(results.querySelector('script')).toBeNull();
});

test('search drops a reply whose marks fall outside the text', async () => {
  const user = userEvent.setup();
  mount(sheet('search'), { 'askx.search': () => ({ query: 'x', groups: [{ kind: 'check', hits: [{ id: 'c-1', text: 'short', marks: [[2, 40]] }] }] }) });
  await user.type(screen.getByRole('searchbox'), 'x');
  await user.click(screen.getByRole('button', { name: 'Search' }));
  expect(await screen.findByText('The reply could not be checked, so it is not shown.')).toBeTruthy();
});

const inbox = { drafts: [{ id: 'draft-1', sentence: 'Stop credit to Sharma Traders', reviewDate: '2026-11-30', origin: 'typed', createdAt: '2026-10-14T00:00:00.000Z', receiptIds: [] }], due: [], waiting: [] };
const journal = { items: [{ id: 'dec-1', text: 'Raise prices by 3%', createdAt: '2026-09-02T00:00:00.000Z', reviewDate: '2026-10-02', status: 'open', recordedLater: true, replaced: false, reviews: 0, receiptIds: [] }, { id: 'dec-0', text: 'Close the second branch', createdAt: '2026-08-01T00:00:00.000Z', reviewDate: '2026-09-01', status: 'closed', recordedLater: false, replaced: true, reviews: 1, receiptIds: [] }] };

test('decisions: inbox first, draft with receipts, confirm, and the journal as a time line', async () => {
  const user = userEvent.setup();
  let drafts = [...inbox.drafts];
  const rpc = mount({ place: 'ask', sub: 'decisions' }, {
    'askx.decisions.inbox': () => ({ ...inbox, drafts }),
    'askx.decisions.list': () => journal,
    'askx.decisions.draft': p => { drafts = [...drafts, { id: 'draft-2', sentence: String(p.sentence), reviewDate: String(p.reviewDate), origin: 'typed', createdAt: '2026-10-14T00:00:00.000Z', receiptIds: [] }]; return { id: 'draft-2' }; },
    'askx.decisions.confirm': p => { drafts = drafts.filter(d => d.id !== p.draftId); return { decisionId: 'dec-2' }; },
  });
  const draftsBox = await found<HTMLElement>('[data-decisions="drafts"]');
  expect(within(draftsBox).getByText('Stop credit to Sharma Traders')).toBeTruthy();
  const journalBox = document.querySelector('[data-decisions="journal"]') as HTMLElement;
  expect(within(journalBox).getByText(/Raise prices by 3% — review on .*, recorded later/)).toBeTruthy();
  expect(within(journalBox).getByText('Close the second branch — replaced')).toBeTruthy();
  expect(draftsBox.compareDocumentPosition(journalBox) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

  await user.type(screen.getByLabelText('The decision, in one sentence'), 'Call Gupta & Sons weekly');
  fireEvent.change(screen.getByLabelText('Review date'), { target: { value: '2026-12-01' } });
  await user.click(screen.getByRole('button', { name: 'Make the draft' }));
  expect(await screen.findByText('Call Gupta & Sons weekly')).toBeTruthy();
  expect(rpc.calls.find(c => c[0] === 'askx.decisions.draft')![1]).toEqual({ sentence: 'Call Gupta & Sons weekly', reviewDate: '2026-12-01', receiptIds: [] });

  const first = (await screen.findByText('Stop credit to Sharma Traders')).closest('li') as HTMLElement;
  await user.click(within(first).getByRole('button', { name: 'Confirm' }));
  await waitFor(() => expect(screen.queryByText('Stop credit to Sharma Traders')).toBeNull());
  expect(rpc.calls.find(c => c[0] === 'askx.decisions.confirm')![1]).toEqual({ draftId: 'draft-1' });
});

test('a decision opened from why carries its receipts into the draft', async () => {
  const user = userEvent.setup();
  const rpc = mount(sheet('why.why-1'), { 'askx.why.get': () => why, 'askx.decisions.inbox': () => ({ drafts: [], due: [], waiting: [] }), 'askx.decisions.list': () => ({ items: [] }), 'askx.decisions.draft': () => ({ id: 'draft-9' }) });
  await user.click(await screen.findByRole('button', { name: 'Record a decision' }));
  expect(await screen.findByText('2 receipts are attached, as known today.')).toBeTruthy();
  await user.type(screen.getByLabelText('The decision, in one sentence'), 'Chase the two late payers');
  fireEvent.change(screen.getByLabelText('Review date'), { target: { value: '2026-11-01' } });
  await user.click(screen.getByRole('button', { name: 'Make the draft' }));
  await waitFor(() => expect(rpc.calls.find(c => c[0] === 'askx.decisions.draft')![1]).toMatchObject({ receiptIds: ['r-aug', 'r-sep'] }));
});

test('a decision shows what was known then and records a review', async () => {
  const user = userEvent.setup();
  const decision = { id: 'dec-1', text: 'Raise prices by 3%', createdAt: '2026-09-02T00:00:00.000Z', reviewDate: '2026-10-02', status: 'open', recordedLater: true, replaced: false, cancelled: false, revision: null, known: [{ receiptId: 'r-aug', label: 'Collections', minor: '100000', asOf: '2026-09-01' }, { receiptId: 'r-x', label: 'Stock', minor: null, asOf: '2026-09-01' }], reviews: [], journal: true };
  const rpc = mount(sheet('decision.dec-1', 'decisions'), { 'askx.decisions.get': () => decision, 'askx.decisions.review': p => ({ ...decision, status: 'closed', reviews: [{ at: '2026-10-14T00:00:00.000Z', outcome: p.outcome, notes: p.notes ?? null, nextReviewDate: null }] }) });
  expect(await screen.findByText('Raise prices by 3%')).toBeTruthy();
  expect(screen.getByText('recorded later')).toBeTruthy();
  expect(screen.getByRole('button', { name: '₹1,000' })).toBeTruthy();
  expect(screen.getByText('not known')).toBeTruthy();
  await user.click(screen.getByRole('radio', { name: 'Completed' }));
  await user.type(screen.getByLabelText('Notes'), 'Margins held');
  await user.click(screen.getByRole('button', { name: 'Record the review' }));
  expect(await screen.findByText('Completed: Margins held')).toBeTruthy();
  expect(rpc.calls.find(c => c[0] === 'askx.decisions.review')![1]).toEqual({ decisionId: 'dec-1', outcome: 'completed', notes: 'Margins held' });
});

const checks = (last: unknown) => ({ items: [{ id: 'c-1', question: 'Collections in August', operationId: 'collections.total', figureKey: 'total', expected: { minor: '100000', receiptId: 'r-aug' }, last }], due: last === null, changed: last === null ? ['route', 'recipes'] : [], lastRunAt: last === null ? null : '2026-10-14T00:00:00.000Z' });
const moved = { at: '2026-10-14T00:00:00.000Z', result: 'moved', minor: '99000', receiptId: 'r-aug-2', code: null, because: ['recipes'] };

test('checks: rows with expected value and last result; run all; a moved check opens old and new', async () => {
  const user = userEvent.setup();
  const rpc = mount({ place: 'ask', sub: 'checks' }, { 'askx.checks.list': () => checks(null), 'askx.checks.run': () => checks(moved), 'askx.checks.get': () => ({ id: 'c-1', question: 'Collections in August', operationId: 'collections.total', figureKey: 'total', createdAt: '2026-09-05T00:00:00.000Z', expected: { minor: '100000', receiptId: 'r-aug' }, results: [moved] }) });
  expect(await screen.findByText('not run yet')).toBeTruthy();
  expect(screen.getByText(/Checks run again on every change of model route, meaning, recipe or app version/)).toBeTruthy();
  expect(screen.getByText('Changed since the last run: the model route and a recipe.')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Run all now' }));
  expect(await screen.findByText(/^moved on/)).toBeTruthy();
  expect(rpc.calls.map(c => c[0])).toContain('askx.checks.run');
  await user.click(screen.getByRole('button', { name: /Collections in August/ }));
  expect(await screen.findByText('The value moved.')).toBeTruthy();
  expect(screen.getAllByRole('button', { name: '₹1,000' }).length).toBeGreaterThan(0);
  expect(screen.getAllByRole('button', { name: '₹990' }).length).toBeGreaterThan(0);
  expect(screen.getByText('Moved, after a change of a recipe.')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Remove' })).toBeTruthy();
});

test('a viewer seat sees no control that changes anything', async () => {
  mount({ place: 'ask', sub: 'decisions' }, { 'askx.decisions.inbox': () => inbox, 'askx.decisions.list': () => journal }, { viewer: true });
  expect(await screen.findByText('Stop credit to Sharma Traders')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Discard' })).toBeNull();
  expect(screen.queryByLabelText('The decision, in one sentence')).toBeNull();
  cleanup();
  mount({ place: 'ask', sub: 'checks' }, { 'askx.checks.list': () => checks(moved) }, { viewer: true });
  expect(await screen.findByText(/^moved on/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Run all now' })).toBeNull();
  cleanup();
  mount(sheet('why.why-1'), { 'askx.why.get': () => why }, { viewer: true });
  expect(await screen.findByText('A festival week moved payments')).toBeTruthy();
  for (const name of ['Add the guess', 'Save', 'Record a decision']) expect(screen.queryByRole('button', { name })).toBeNull();
  cleanup();
  mount(sheet('check.c-1', 'checks'), { 'askx.checks.get': () => ({ id: 'c-1', question: 'Q', operationId: 'collections.total', figureKey: 'total', createdAt: '2026-09-05T00:00:00.000Z', expected: { minor: '100000', receiptId: 'r-aug' }, results: [] }) }, { viewer: true });
  expect(await screen.findByText('This check has not run yet.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
});

test('Hindi draws every analysis word from its catalogue', async () => {
  mount(sheet('why.why-1'), { 'askx.why.get': () => why }, { language: 'hi', view: 'simple' });
  expect(await screen.findByRole('heading', { level: 1, name: /Collections 18% गिरा/ })).toBeTruthy();
  expect(screen.getByRole('region', { name: 'संभावित कारण' })).toBeTruthy();
  expect(screen.getByRole('region', { name: 'मापा गया' })).toBeTruthy();
  expect(screen.getByText('बाकी सब')).toBeTruthy();
  cleanup();
  mount({ place: 'ask', sub: 'checks' }, { 'askx.checks.list': () => checks(null) }, { language: 'hi', view: 'books' });
  expect(await screen.findByText('अभी सब चलाएँ')).toBeTruthy();
  expect(screen.getByText('अभी नहीं चली')).toBeTruthy();
});

test('an invalid reply is a failure, never a partly drawn page', async () => {
  mount(sheet('why.why-1'), { 'askx.why.get': () => ({ ...why, earlier: { ...why.earlier, minor: 1000 } }) });
  expect(await screen.findByText('The reply could not be checked, so it is not shown.')).toBeTruthy();
  expect(screen.getByText(/INVALID_REPLY/)).toBeTruthy();
  expect(document.querySelectorAll('[data-bridge-bar]').length).toBe(0);
  cleanup();
  mount(sheet('gst2b'), { 'askx.gst2b': () => ({ ...gst, ims: [{ lineId: 'l-unknown', action: 'accept', reason: 'matched' }] }) });
  expect(await screen.findByText('The reply could not be checked, so it is not shown.')).toBeTruthy();
  cleanup();
  mount(sheet('plan'), {});
  expect(screen.getByRole('button', { name: 'Find the best plan' })).toBeTruthy();
});

test('a refusal code gets its fixed words, and a missing engine part is not built', async () => {
  mount(sheet('why.why-1'), { 'askx.why.get': () => { throw Object.assign(new Error('x'), { code: 'ASK_NOT_FOUND' }); } });
  expect(await screen.findByText('This is no longer here. It may have been removed.')).toBeTruthy();
  cleanup();
  mount({ place: 'ask', sub: 'checks' }, {});
  expect(await screen.findByText(/not built/i)).toBeTruthy();
});
