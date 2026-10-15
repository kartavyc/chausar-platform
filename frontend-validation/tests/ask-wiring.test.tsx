import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TextProvider } from '../../app/ui/src/app/text';
import type { Address, Language, View } from '../../app/ui/src/app/presentation.ts';
import { AskPlace, sheetView } from '../../app/ui/src/screens/ask/lane/AskPlace';
import { money } from '../../app/ui/src/format/index';

// The wiring of the engine fields added to the askx.* replies: rule kinds, the template
// reason, the receipt's meaning, demo flag and export, hidden-row counts, retention days,
// saved what-ifs read back, search refs, decision labels and the waiting list.
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
const VIEWS: View[] = ['simple', 'guided', 'books'];
const INVALID = /The engine sent a reply this page could not check/;

beforeEach(() => {
  vi.stubGlobal('matchMedia', (media: string) => ({ matches: false, media, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true }));
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const menu = {
  state: 'ready', seed: false, dictionary: null, gst2b: 'offered', today: '2026-10-14', branches: [],
  topics: [{ topic: 'sales', items: [{ operationId: 'sales.invoiced', label: 'Invoiced by customer', type: 'sum', topic: 'sales', needs: ['period'], meaning: null }] }],
  periods: [{ id: 'this-month', period: { from: '2026-10-01', to: '2026-10-31' } }, { id: 'last-month', period: sep }],
};
const answer = (over: Record<string, unknown> = {}) => ({
  kind: 'answer', answerId: null, receiptId: 'r-1', operationId: 'sales.invoiced', label: 'Invoiced by customer', period: sep, comparePeriod: null, branch: null,
  asOf: '2026-09-12', headline: '',
  figures: [{ key: 'billed', label: 'Billed', minor: '1234500', unit: 'money' }],
  rows: { read: 214, counted: 211, excluded: 3 }, completeness: 'reconciled-imports', gaps: [], monthsNotLoaded: [], labels: [],
  explanation: { source: 'template', text: 'Invoiced in September.', replaced: false, reason: 'no-model' },
  guard: { status: 'passed', lines: [] }, sent: 'nothing', ...over,
});
const receipt = (over: Record<string, unknown> = {}) => ({
  receiptId: 'r-1', operationId: 'sales.invoiced', label: 'Invoiced by customer',
  chain: { question: null, calculation: 'Invoiced by customer', rowsRead: 217, totalChecked: true },
  figures: [{ key: 'billed', label: 'Billed', minor: '1234500', unit: 'money' }], period: sep, comparePeriod: null, asOf: '2026-10-14', createdAt: '2026-10-14', branch: null,
  definitions: [], exclusions: [], completeness: 'reconciled-imports', gaps: [],
  sources: [], versions: { app: '1.0.0', dictionary: 3, dictionaryHash: 'dh', definitionHash: 'defh', recipes: [], calculator: 'calc-2' },
  allowedBy: { memberId: 'owner-1', role: 'owner', device: 'desktop', at: '2026-10-14T09:00:00.000Z' },
  labels: [], notCounted: 0, fx: [], sent: { kind: 'nothing' },
  meaning: { version: 4, publishedBy: 'owner-1', publishedAt: '2026-10-01T10:00:00.000Z' }, demo: false, provenance: null, ...over,
});

/* 1. AS-09: the kind of rule that stopped an answer. */
test.each(VIEWS)('a run stopped by a branch rule says which kind of rule, and who can change it (%s)', async view => {
  const user = userEvent.setup();
  mount({ place: 'ask', sub: 'new' }, {
    'askx.menu': () => menu, 'askx.suggest': () => ({ suggestions: [] }),
    'askx.run': () => ({ kind: 'refused', code: 'ASK_STOPPED_BY_RULE', rule: 'branch' }),
  }, { view });
  await user.click(await screen.findByRole('button', { name: /Invoiced by customer/ }));
  const refusal = await found<HTMLElement>('[data-refusal="ASK_STOPPED_BY_RULE"]');
  expect(refusal.getAttribute('data-rule')).toBe('branch');
  expect(within(refusal).getByText(/Rows from a branch your seat does not cover are hidden from it\./)).toBeTruthy();
  expect(within(refusal).getByText('The owner in Trust can change it.')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Open Trust' })).toBeTruthy();
});

test('each rule kind has its own sentence, in Hindi too; a stop without a kind keeps the plain sentence', async () => {
  const user = userEvent.setup();
  let rule: string | undefined = 'marking';
  mount({ place: 'ask', sub: 'new' }, {
    'askx.menu': () => menu, 'askx.suggest': () => ({ suggestions: [] }),
    'askx.run': () => (rule === undefined ? { kind: 'refused', code: 'ASK_STOPPED_BY_RULE' } : { kind: 'refused', code: 'ASK_STOPPED_BY_RULE', rule }),
  }, { language: 'hi' });
  await user.click(await screen.findByRole('button', { name: /Invoiced by customer/ }));
  expect(await screen.findByText(/निजी चिह्नित पंक्तियाँ आपकी सीट से छिपी हैं।/)).toBeTruthy();
  cleanup();
  rule = undefined;
  mount({ place: 'ask', sub: 'new' }, {
    'askx.menu': () => menu, 'askx.suggest': () => ({ suggestions: [] }),
    'askx.run': () => ({ kind: 'refused', code: 'ASK_STOPPED_BY_RULE' }),
  });
  await user.click(await screen.findByRole('button', { name: /Invoiced by customer/ }));
  const refusal = await found<HTMLElement>('[data-refusal="ASK_STOPPED_BY_RULE"]');
  expect(within(refusal).getByText(/A rule in Trust stops this answer for your seat\./)).toBeTruthy();
});

test('a rule kind outside the contract is not drawn', async () => {
  const user = userEvent.setup();
  mount({ place: 'ask', sub: 'new' }, {
    'askx.menu': () => menu, 'askx.suggest': () => ({ suggestions: [] }),
    'askx.run': () => ({ kind: 'refused', code: 'ASK_STOPPED_BY_RULE', rule: '<b>my own rule text</b>' }),
  });
  await user.click(await screen.findByRole('button', { name: /Invoiced by customer/ }));
  expect(await screen.findByText(INVALID)).toBeTruthy();
  expect(screen.queryByText(/my own rule text/)).toBeNull();
});

/* 2. AS-04: why a template was used. */
test.each(VIEWS)('an answer says it was written from a template because no model was asked (%s)', async view => {
  mount(sheet('answer.r-1'), { 'askx.answer': () => answer() }, { view });
  const line = await found<HTMLElement>('[data-explanation-reason]');
  expect(line.getAttribute('data-explanation-reason')).toBe('no-model');
  expect(line.textContent).toBe('Written from a template: no AI model was asked.');
});

test.each(VIEWS)('an answer whose model text the guard replaced says so, and the figure still opens its receipt (%s)', async view => {
  mount(sheet('answer.r-1'), {
    'askx.answer': () => answer({ explanation: { source: 'template', text: 'Invoiced in September.', replaced: true, reason: 'guard-replaced' }, guard: { status: 'replaced', lines: [{ number: '99', matched: null }] } }),
  }, { view });
  const line = await found<HTMLElement>('[data-explanation-reason="guard-replaced"]');
  expect(line.textContent).toBe('The written explanation had a number not on the receipt, so the template is shown. The figures come from the receipt.');
  expect(document.querySelector('[data-guard-replaced]')).toBeNull();
  expect(screen.getAllByRole('button', { name: money('1234500') })[0]!.getAttribute('title')).toContain('r-1');
});

test('the template reason is in Hindi, and an answer without a reason is refused by the validator', async () => {
  mount(sheet('answer.r-1'), { 'askx.answer': () => answer() }, { language: 'hi' });
  expect((await found<HTMLElement>('[data-explanation-reason]')).textContent).toBe('एक साँचे से लिखा गया: किसी AI मॉडल से नहीं पूछा गया।');
  cleanup();
  mount(sheet('answer.r-1'), { 'askx.answer': () => answer({ explanation: { source: 'template', text: 'x', replaced: false } }) });
  expect(await screen.findByText(INVALID)).toBeTruthy();
});

/* 3. AS-05: the meaning version, the demo clock and the export. */
test.each(VIEWS)('the receipt small print names the meaning version, who published it and when (%s)', async view => {
  mount(sheet('answer.r-1'), { 'askx.answer': () => answer(), 'askx.receipt': () => receipt() }, { view });
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'See the receipt' }));
  const line = await found<HTMLElement>('[data-meaning-version]');
  expect(line.textContent).toBe('Meaning version 4, published by owner-1 on 1 Oct 2026');
  expect(document.querySelector('[data-demo]')).toBeNull();
});

test.each(VIEWS)('a demo receipt carries the demo clock label on the page and on its figures (%s)', async view => {
  mount(sheet('answer.r-1'), { 'askx.answer': () => answer(), 'askx.receipt': () => receipt({ demo: true, meaning: null }) }, { view });
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'See the receipt' }));
  expect(await found('[data-demo]')).toBeTruthy();
  expect(screen.getByText(/This is a demo workspace/)).toBeTruthy();
  expect((await found<HTMLElement>('[data-meaning-version]')).textContent).toBe('Which published meaning this used is not known.');
});

test('a receipt without its meaning or demo field is refused by the validator', async () => {
  const { meaning: _m, ...noMeaning } = receipt();
  mount(sheet('answer.r-1'), { 'askx.answer': () => answer(), 'askx.receipt': () => noMeaning });
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'See the receipt' }));
  expect(await screen.findByText(INVALID)).toBeTruthy();
  cleanup();
  const { demo: _d, ...noDemo } = receipt();
  mount(sheet('answer.r-1'), { 'askx.answer': () => answer(), 'askx.receipt': () => noDemo });
  await user.click(await screen.findByRole('button', { name: 'See the receipt' }));
  expect(await screen.findByText(INVALID)).toBeTruthy();
});

test.each([false, true])('the receipt exports its rows as a CSV file to save, viewer seat too (viewer: %s)', async viewer => {
  const created: Blob[] = [];
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: (b: Blob) => { created.push(b); return 'blob:receipt-1'; }, revokeObjectURL: () => undefined }));
  const rpc = mount(sheet('answer.r-1'), {
    'askx.answer': () => answer(), 'askx.receipt': () => receipt(),
    'askx.receipt.export': () => ({ fileName: 'receipt-r-1.csv', csv: 'tab,row\r\ncounted,1\r\n' }),
  }, { viewer });
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'See the receipt' }));
  await user.click(await screen.findByRole('button', { name: 'Export the rows' }));
  const link = await found<HTMLAnchorElement>('[data-receipt-download]');
  expect(link.getAttribute('download')).toBe('receipt-r-1.csv');
  expect(link.getAttribute('href')).toBe('blob:receipt-1');
  expect(link.textContent).toBe('Save receipt-r-1.csv');
  expect(rpc.calls.find(c => c[0] === 'askx.receipt.export')?.[1]).toEqual({ receiptId: 'r-1' });
  expect(created).toHaveLength(1);
  expect(screen.getByText('Exporting changes nothing in your books.')).toBeTruthy();
});

test('an export reply with a bad file name is not offered', async () => {
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => undefined }));
  mount(sheet('answer.r-1'), {
    'askx.answer': () => answer(), 'askx.receipt': () => receipt(),
    'askx.receipt.export': () => ({ fileName: '../../etc/passwd', csv: 'x' }),
  });
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'See the receipt' }));
  await user.click(await screen.findByRole('button', { name: 'Export the rows' }));
  expect(await screen.findByText(INVALID)).toBeTruthy();
  expect(document.querySelector('[data-receipt-download]')).toBeNull();
});

/* 4. AS-06: how many rows are hidden, and by which kind of rule. */
const rowsReply = (over: Record<string, unknown>) => ({
  tab: 'counted', total: 1, offset: 0, hidden: true, hiddenCount: 4, rule: 'branch',
  rows: [{ rowId: 'row-1', sourceId: 'src-tally', sourceRow: 12, cells: [{ name: 'Party', value: 'Acme' }], amountMinor: '5000', reason: null }], ...over,
});
test.each(VIEWS)('a known number of hidden rows is said with its rule kind (%s)', async view => {
  mount(sheet('answer.r-1'), { 'askx.answer': () => answer(), 'askx.receipt': () => receipt(), 'askx.sourceRows': () => rowsReply({}) }, { view });
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'See the receipt' }));
  await user.click(await screen.findByRole('button', { name: 'Rows counted' }));
  const line = await found<HTMLElement>('[data-hidden]');
  expect(line.textContent).toBe('4 rows are hidden from this seat because of a branch rule.');
  expect(line.getAttribute('data-hidden-rule')).toBe('branch');
});

test('without a count the generic hidden line stays; Hindi has the count sentence; a missing count field is refused', async () => {
  const user = userEvent.setup();
  mount(sheet('answer.r-1'), { 'askx.answer': () => answer(), 'askx.receipt': () => receipt(), 'askx.sourceRows': () => rowsReply({ hiddenCount: null, rule: null }) });
  await user.click(await screen.findByRole('button', { name: 'See the receipt' }));
  await user.click(await screen.findByRole('button', { name: 'Rows counted' }));
  expect((await found<HTMLElement>('[data-hidden]')).textContent).toMatch(/hidden from your seat by a rule in Trust/);
  cleanup();
  mount(sheet('answer.r-1'), { 'askx.answer': () => answer(), 'askx.receipt': () => receipt(), 'askx.sourceRows': () => rowsReply({ rule: null }) }, { language: 'hi' });
  await user.click(await screen.findByRole('button', { name: 'रसीद देखें' }));
  await user.click(await screen.findByRole('button', { name: 'गिनी गई पंक्तियाँ' }));
  expect((await found<HTMLElement>('[data-hidden]')).textContent).toBe('Trust के एक नियम के कारण 4 पंक्तियाँ इस सीट से छिपी हैं।');
  cleanup();
  const { hiddenCount: _h, ...noCount } = rowsReply({});
  mount(sheet('answer.r-1'), { 'askx.answer': () => answer(), 'askx.receipt': () => receipt(), 'askx.sourceRows': () => noCount });
  await user.click(await screen.findByRole('button', { name: 'See the receipt' }));
  await user.click(await screen.findByRole('button', { name: 'Rows counted' }));
  expect(await screen.findByText(INVALID)).toBeTruthy();
});

/* 5. AS-07: how long the text was kept. */
const sent = (over: Record<string, unknown> = {}) => ({ kind: 'sent', routeId: 'r', sendLevel: 'samples', bytes: 10, costMinor: null, text: null, digest: 'sha-gone', removed: true, at: '2026-09-01', boundary: 'b', retentionDays: 14, ...over });
test.each(VIEWS)('removed text says after how many days, and keeps its fingerprint (%s)', async view => {
  mount(sheet('answer.r-1'), { 'askx.answer': () => answer(), 'askx.receipt': () => receipt({ sent: { kind: 'model', available: false } }), 'askx.sent': () => sent() }, { view });
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'See the receipt' }));
  await user.click(await screen.findByRole('button', { name: 'What was sent to the AI model' }));
  expect((await found<HTMLElement>('[data-sent-removed]')).textContent).toBe('The text was removed after 14 days. Its fingerprint is kept.');
  expect(screen.getByText('sha-gone')).toBeTruthy();
});

test('retention days in Hindi, and a sent reply without them is refused', async () => {
  const user = userEvent.setup();
  mount(sheet('answer.r-1'), { 'askx.answer': () => answer(), 'askx.receipt': () => receipt({ sent: { kind: 'model', available: false } }), 'askx.sent': () => sent() }, { language: 'hi' });
  await user.click(await screen.findByRole('button', { name: 'रसीद देखें' }));
  await user.click(await screen.findByRole('button', { name: 'AI मॉडल को क्या भेजा गया' }));
  expect((await found<HTMLElement>('[data-sent-removed]')).textContent).toBe('14 दिन बाद पाठ हटा दिया गया। उसकी पहचान रखी गई है।');
  cleanup();
  const { retentionDays: _r, ...noDays } = sent();
  mount(sheet('answer.r-1'), { 'askx.answer': () => answer(), 'askx.receipt': () => receipt({ sent: { kind: 'model', available: false } }), 'askx.sent': () => noDays });
  await user.click(await screen.findByRole('button', { name: 'See the receipt' }));
  await user.click(await screen.findByRole('button', { name: 'What was sent to the AI model' }));
  expect(await screen.findByText(INVALID)).toBeTruthy();
});

/* 6. A saved what-if read back. */
const whatIf = {
  label: 'what-if', assumption: { name: 'price', beforeBps: '0', afterBps: '500' },
  books: { minor: '1000000', receiptId: 'r-books' }, withChange: { minor: '1050000', receiptId: 'r-with' }, change: { minor: '50000', receiptId: 'r-change' },
  period: sep, branch: null,
};
const savedWhatIf = { items: [
  { id: 's-w', kind: 'what-if', question: 'What if prices changed by 5%', operationId: null, savedAt: '2026-10-01', receiptId: 'r-with', refId: 'r-with', headline: { kind: 'money', minor: '1050000' }, workedOutAt: '2026-10-01', deletedOn: null, stale: null, rebuildable: false },
] };
test.each(VIEWS)('a saved what-if opens read back from its with-change receipt, with no Save (%s)', async view => {
  const user = userEvent.setup();
  const rpc = mount({ place: 'ask', sub: 'saved' }, { 'askx.saved': () => savedWhatIf, 'askx.whatIf.get': () => whatIf }, { view });
  await user.click(await screen.findByRole('button', { name: 'What if prices changed by 5%' }));
  expect(await found('[data-whatif-figures]')).toBeTruthy();
  expect(rpc.calls.find(c => c[0] === 'askx.whatIf.get')?.[1]).toEqual({ receiptId: 'r-with' });
  expect(rpc.calls.some(c => c[0] === 'askx.whatIf')).toBe(false);
  expect(screen.getByRole('button', { name: money('1050000') }).getAttribute('title')).toContain('r-with');
  expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  expect(document.querySelector('[data-whatif-saved]')).not.toBeNull();
});

test('the sheet whatif.<receiptId> opens the saved what-if, and a bad reply is refused', async () => {
  expect(sheetView('whatif.r-with')).toEqual({ kind: 'whatif', receiptId: 'r-with' });
  expect(sheetView('whatif')).toEqual({ kind: 'whatif' });
  const rpc = mount(sheet('whatif.r-with'), { 'askx.whatIf.get': () => whatIf });
  expect(await found('[data-whatif-figures]')).toBeTruthy();
  expect(rpc.calls.map(c => c[0])).toEqual(['askx.whatIf.get']);
  cleanup();
  mount(sheet('whatif.r-with'), { 'askx.whatIf.get': () => ({ ...whatIf, label: 'fact' }) });
  expect(await screen.findByText('The reply could not be checked, so it is not shown.')).toBeTruthy();
});

test('a viewer reads a saved what-if back but gets no control to change anything', async () => {
  mount(sheet('whatif.r-with'), { 'askx.whatIf.get': () => whatIf }, { viewer: true });
  expect(await found('[data-whatif-figures]')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Try another change' })).toBeNull();
});

/* 7. Search: a saved hit opens its own item. */
const search = (ref: Record<string, unknown> | undefined) => ({ query: 'price', groups: [{ kind: 'saved', hits: [{ id: 's-1', text: 'Price change', marks: [[0, 5]], ...(ref === undefined ? {} : { ref }) }] }] });
test.each([
  ['answer', { savedKind: 'answer', receiptId: 'r-1', refId: null }, 'askx.answer', { receiptId: 'r-1' }],
  ['what-if', { savedKind: 'what-if', receiptId: 'r-with', refId: 'r-with' }, 'askx.whatIf.get', { receiptId: 'r-with' }],
  ['why', { savedKind: 'why', receiptId: null, refId: 'why-1' }, 'askx.why.get', { whyId: 'why-1' }],
  ['forecast', { savedKind: 'forecast', receiptId: null, refId: 'ev-1' }, 'askx.saved', {}],
] as const)('a saved %s hit opens its item', async (_kind, ref, method, payload) => {
  const user = userEvent.setup();
  const rpc = mount(sheet('search'), {
    'askx.search': () => search(ref), 'askx.answer': () => answer(), 'askx.whatIf.get': () => whatIf, 'askx.saved': () => ({ items: [] }),
  });
  await user.type(await screen.findByLabelText(/Find a saved answer/), 'price');
  await user.click(screen.getByRole('button', { name: 'Search' }));
  await user.click(await screen.findByRole('button', { name: 'Price change' }));
  await waitFor(() => expect(rpc.calls.find(c => c[0] === method)?.[1]).toEqual(payload));
});

test('a saved hit without a ref still opens the saved list; a ref of an unknown kind is refused', async () => {
  const user = userEvent.setup();
  const rpc = mount(sheet('search'), { 'askx.search': () => search(undefined), 'askx.saved': () => ({ items: [] }) });
  await user.type(await screen.findByLabelText(/Find a saved answer/), 'price');
  await user.click(screen.getByRole('button', { name: 'Search' }));
  await user.click(await screen.findByRole('button', { name: 'Price change' }));
  await waitFor(() => expect(rpc.calls.some(c => c[0] === 'askx.saved')).toBe(true));
  cleanup();
  mount(sheet('search'), { 'askx.search': () => search({ savedKind: 'invoice', receiptId: null, refId: null }) });
  await user.type(await screen.findByLabelText(/Find a saved answer/), 'price');
  await user.click(screen.getByRole('button', { name: 'Search' }));
  expect(await screen.findByText('The reply could not be checked, so it is not shown.')).toBeTruthy();
});

/* 8. A decision's replaced and cancelled labels. */
const decision = (over: Record<string, unknown> = {}) => ({
  id: 'dec-1', text: 'Raise prices by 3%', createdAt: '2026-09-02T00:00:00.000Z', reviewDate: '2026-10-02', status: 'closed', recordedLater: false,
  replaced: true, cancelled: false, revision: null, decidedOn: null, cancellation: null, canCancel: false, known: [], reviews: [], journal: true, ...over,
});
test.each(VIEWS)('a replaced decision and a cancelled one carry their labels (%s)', async view => {
  mount(sheet('decision.dec-1', 'decisions'), { 'askx.decisions.get': () => decision() }, { view });
  expect((await found<HTMLElement>('[data-decision-flag="replaced"]')).textContent).toBe('replaced');
  expect(screen.getByText('A later decision replaced this one.')).toBeTruthy();
  expect(document.querySelector('[data-decision-flag="cancelled"]')).toBeNull();
  cleanup();
  mount(sheet('decision.dec-1', 'decisions'), { 'askx.decisions.get': () => decision({ replaced: false, cancelled: true }) }, { view, language: 'hi' });
  expect((await found<HTMLElement>('[data-decision-flag="cancelled"]')).textContent).toBe('रद्द');
  expect(screen.getByText('यह निर्णय रद्द किया गया।')).toBeTruthy();
});

test('a decision reply without replaced or cancelled is refused', async () => {
  const { cancelled: _c, ...noCancelled } = decision();
  mount(sheet('decision.dec-1', 'decisions'), { 'askx.decisions.get': () => noCancelled });
  expect(await screen.findByText('The reply could not be checked, so it is not shown.')).toBeTruthy();
});

/* 9. Pending clarifications in the inbox. */
test.each(VIEWS)('pending clarifications draw as rows of text with no open action, and say where to answer them (%s)', async view => {
  mount({ place: 'ask', sub: 'decisions' }, {
    'askx.decisions.inbox': () => ({ drafts: [], due: [], waiting: [{ id: 'q-1', text: '<img src=x onerror=alert(1)> Which branch pays rent?', at: '2026-10-09T00:00:00.000Z' }] }),
    'askx.decisions.list': () => ({ items: [] }),
  }, { view });
  const waiting = await found<HTMLElement>('[data-decisions="waiting"]');
  expect(within(waiting).getByText('<img src=x onerror=alert(1)> Which branch pays rent?')).toBeTruthy();
  expect(waiting.querySelector('img')).toBeNull();
  expect(within(waiting).queryAllByRole('button')).toHaveLength(0);
  expect(within(waiting).getByText('These questions wait for your answer. Answer them from Ask › New.')).toBeTruthy();
});

test('the waiting note is in Hindi', async () => {
  mount({ place: 'ask', sub: 'decisions' }, {
    'askx.decisions.inbox': () => ({ drafts: [], due: [], waiting: [{ id: 'q-1', text: 'Which branch pays rent?', at: '2026-10-09T00:00:00.000Z' }] }),
    'askx.decisions.list': () => ({ items: [] }),
  }, { language: 'hi' });
  const waiting = await found<HTMLElement>('[data-decisions="waiting"]');
  expect(within(waiting).getByText(/इनका जवाब पूछें › नया से दें।/)).toBeTruthy();
});

/* Second engine review: withheld figures after narrowed access, other numerals, owner-set tolerance. */
const WITHHELD = 'hidden from your seat';
test.each(VIEWS)('a check whose receipt no longer opens shows the withheld word, not a figure (%s)', async view => {
  const withheld = { at: '2026-10-14T00:00:00.000Z', result: 'same', minor: null, receiptId: null, code: null, because: [] };
  mount({ place: 'ask', sub: 'checks' }, {
    'askx.checks.list': () => ({ items: [{ id: 'c-1', question: 'Collections in August', operationId: 'collections.total', figureKey: 'total', unit: 'money', quantityUnit: null, expected: { minor: null, receiptId: null }, last: withheld }], due: false, changed: [], lastRunAt: '2026-10-14T00:00:00.000Z' }),
  }, { view });
  const list = await found<HTMLElement>('[data-checks]');
  expect(within(list).getByText(WITHHELD)).toBeTruthy();
  expect(within(list).queryByRole('button', { name: money('100000') })).toBeNull();
  cleanup();
  mount(sheet('check.c-1', 'checks'), {
    'askx.checks.get': () => ({ id: 'c-1', question: 'Collections in August', operationId: 'collections.total', figureKey: 'total', unit: 'money', quantityUnit: null, createdAt: '2026-09-05T00:00:00.000Z', expected: { minor: null, receiptId: null }, results: [withheld] }),
  }, { view });
  const pair = await found<HTMLElement>('[data-check-pair]');
  expect(within(pair).getAllByText(WITHHELD)).toHaveLength(2);
});

test('a check expected value with only half of it withheld is refused', async () => {
  mount(sheet('check.c-1', 'checks'), {
    'askx.checks.get': () => ({ id: 'c-1', question: 'Q', operationId: 'collections.total', figureKey: 'total', unit: 'money', quantityUnit: null, createdAt: '2026-09-05T00:00:00.000Z', expected: { minor: '100', receiptId: null }, results: [] }),
  });
  expect(await screen.findByText('The reply could not be checked, so it is not shown.')).toBeTruthy();
});

test('a saved answer whose access changed shows the withheld word', async () => {
  mount({ place: 'ask', sub: 'saved' }, { 'askx.saved': () => ({ items: [
    { id: 's-1', kind: 'answer', question: 'Billed in September', operationId: 'sales.invoiced', savedAt: '2026-09-12', receiptId: 'r-1', refId: null, headline: null, workedOutAt: '2026-09-12', deletedOn: null, stale: { reason: 'access-changed', since: '2026-10-01' }, rebuildable: true },
  ] }) });
  const row = await found<HTMLElement>('[data-saved-id="s-1"]');
  expect(within(row).getByText(WITHHELD)).toBeTruthy();
});

test.each(VIEWS)('a numeral that is not a decimal digit is named in words, never as the stand-in character (%s)', async view => {
  const user = userEvent.setup();
  mount(sheet('answer.r-1'), { 'askx.answer': () => answer({ guard: { status: 'replaced', lines: [{ number: '', matched: null }, { number: '3rd', matched: { field: 'ordinal' } }] } }) }, { view });
  const line = await screen.findByRole('button', { name: /Checked against the receipt/ });
  if (line.getAttribute('aria-expanded') !== 'true') await user.click(line);
  const guard = await found<HTMLElement>('[data-guard]');
  expect(within(guard).getByText('a numeral not on the receipt')).toBeTruthy();
  expect(within(guard).getByText('an ordinal, not an amount')).toBeTruthy();
  expect(guard.textContent).not.toContain('');
});

const gst = {
  state: 'ready', period: sep, toleranceMinor: '1000', via: 'facts', sources: null, matchReceiptId: null, leftOut: 0,
  groups: [{ group: 'matched', count: 1, taxableMinor: '100', taxMinor: '18', unknownTax: 0 }, { group: 'differs-inside', count: 0, taxableMinor: '0', taxMinor: '0', unknownTax: 0 }, { group: 'differs-outside', count: 0, taxableMinor: '0', taxMinor: '0', unknownTax: 0 }, { group: 'in-2b-only', count: 0, taxableMinor: '0', taxMinor: '0', unknownTax: 0 }, { group: 'books-only', count: 0, taxableMinor: '0', taxMinor: '0', unknownTax: 0 }],
  lines: [], ims: [],
};
test.each([['owner', true], ['cofounder', true], ['accountant', false], ['member', false]] as const)('the tolerance control is offered to an approving seat only (%s)', async (role, shown) => {
  const rpc = fakeRpc({ 'askx.gst2b': () => gst });
  render(
    <TextProvider language="en">
      <AskPlace address={sheet('gst2b')} language="en" view="guided" member={{ id: 'm-1', role }} viewer={false}
        rpc={rpc} live={() => true} openReceipt={() => undefined} navigate={() => undefined} />
    </TextProvider>,
  );
  expect(await screen.findByText(/count as inside the tolerance/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Change the tolerance' }) !== null).toBe(shown);
});
