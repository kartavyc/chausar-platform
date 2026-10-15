import { afterEach, beforeEach, expect, test } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TextProvider } from '../../app/ui/src/app/text';
import { AskPlace } from '../../app/ui/src/screens/ask/lane/AskPlace';
import type { Address, Language, View } from '../../app/ui/src/app/presentation';
import { money } from '../../app/ui/src/format/index';

// Every reply here is synthetic and shaped by platform/runtime/ask/contracts.ts.
type Handler = (payload: Record<string, unknown>) => unknown;
interface Call { method: string; payload: Record<string, unknown> }

const period = { from: '2026-09-01', to: '2026-09-30' };
const periods = [
  { id: 'this-month', period: { from: '2026-10-01', to: '2026-10-31' } },
  { id: 'last-month', period },
];
const menu = {
  state: 'ready', seed: true, dictionary: { version: 3, pack: 'retail', label: 'Retail meanings', gstMode: 'regular' },
  topics: [
    { topic: 'sales', items: [{ operationId: 'sales.invoiced', label: 'Invoiced by customer', type: 'sum', topic: 'sales', needs: ['period'], meaning: null }] },
    { topic: 'collections', items: [{ operationId: 'collections.received', label: 'Money received', type: 'sum', topic: 'collections', needs: ['period'], meaning: 'money in the bank' }] },
  ],
  gst2b: 'offered', today: '2026-10-14', branches: [], periods,
};
const suggest = { suggestions: [{ operationId: 'sales.invoiced', label: 'Invoiced by customer', periodId: 'last-month', asked: 4, why: 'asked-before' }] };
const answer = (receiptId = 'r-1', labels: string[] = []) => ({
  kind: 'answer', answerId: null, receiptId, operationId: 'sales.invoiced', label: 'Invoiced by customer', period, comparePeriod: null, branch: null,
  asOf: '2026-10-14', headline: '14 customers',
  figures: [{ key: 'total', label: 'Total invoiced', minor: '1234500', unit: 'money' }, { key: 'top', label: 'Largest customer', minor: '400000', unit: 'money' }],
  rows: { read: 214, counted: 211, excluded: 3 }, completeness: 'partial', gaps: ['unreconciled'], monthsNotLoaded: ['2026-07'], labels,
  explanation: { source: 'template', text: 'Invoiced in September.', replaced: false, reason: 'no-model' },
  guard: { status: 'passed', lines: [{ number: '214', matched: { field: 'rows' } }] }, sent: 'nothing',
});
const receipt = {
  receiptId: 'r-1', operationId: 'sales.invoiced', label: 'Invoiced by customer',
  chain: { question: 'how much did we bill last month', calculation: 'Invoiced by customer', rowsRead: 217, totalChecked: true },
  figures: answer().figures, period, comparePeriod: null, asOf: '2026-10-14', createdAt: '2026-10-14', branch: null,
  definitions: [{ name: 'invoiced', label: 'Invoiced', meaning: 'Invoices raised, before returns.', kind: 'measure', field: 'amount' }],
  exclusions: [{ reason: 'cancelled', rows: 3 }], completeness: 'partial', gaps: [],
  sources: [{ sourceId: 'src-tally', wayIn: 'file', format: 'xml', recipe: { id: 'rec-1', state: 'not-yet-tested', hash: 'h1' }, rows: 217 }],
  versions: { app: '1.0.0', dictionary: 3, dictionaryHash: 'dh', definitionHash: 'defh', recipes: ['h1'], calculator: 'calc-2' },
  allowedBy: { memberId: 'owner-1', role: 'owner', device: 'desktop', at: '2026-10-14T09:00:00.000Z' },
  labels: ['seed'], notCounted: 0, fx: [], sent: { kind: 'model', available: true },
  meaning: { version: 3, publishedBy: 'owner-1', publishedAt: '2026-10-01T10:00:00.000Z' }, demo: false, provenance: null,
};
const rows = (tab: string) => ({
  tab, total: 1, offset: 0, hidden: tab === 'left-out', hiddenCount: null, rule: tab === 'left-out' ? 'branch' : null,
  rows: [{ rowId: `row-${tab}`, sourceId: 'src-tally', sourceRow: 12, cells: [{ name: 'Party', value: tab === 'counted' ? '<b>Acme</b>' : 'Cancelled Co' }], amountMinor: '5000', unit: 'money', quantityUnit: null, reason: tab === 'counted' ? null : 'cancelled' }],
});

function fake(handlers: Record<string, Handler | { code: string }>) {
  const calls: Call[] = [];
  const rpc = {
    async request(method: string, payload: Record<string, unknown>) {
      calls.push({ method, payload });
      const h = handlers[method];
      if (h === undefined) throw Object.assign(new Error('x'), { code: 'UNKNOWN_METHOD' });
      if (typeof h !== 'function') throw Object.assign(new Error('x'), { code: h.code });
      return structuredClone(h(payload));
    },
  };
  return { rpc, calls };
}

const base: Record<string, Handler> = {
  'askx.menu': () => menu, 'askx.suggest': () => suggest,
  'askx.run': p => answer(p.operationId === 'collections.received' ? 'r-2' : 'r-1'),
  'askx.answer': p => answer(String(p.receiptId)),
  'askx.receipt': () => receipt, 'askx.sourceRows': p => rows(String(p.tab)),
  'askx.sent': () => ({ kind: 'sent', routeId: 'local-model', sendLevel: 'shape only', bytes: 1200, costMinor: null, text: 'Totals for CUSTOMER_1', digest: 'sha-abc', removed: false, at: '2026-10-14', boundary: 'b1', retentionDays: 30 }),
  'askx.save': () => ({ id: 'saved-1' }), 'askx.checks.save': () => ({ id: 'check-1' }),
};

function show(handlers: Record<string, Handler | { code: string }>, opts: { language?: Language; view?: View; viewer?: boolean; address?: Address } = {}) {
  const f = fake(handlers);
  const address = opts.address ?? { place: 'ask', sub: 'new' };
  render(
    <TextProvider language={opts.language ?? 'en'}>
      <AskPlace address={address} language={opts.language ?? 'en'} view={opts.view ?? 'guided'} member={{ id: 'owner-1', role: 'owner' }} viewer={opts.viewer ?? false}
        rpc={f.rpc} live={() => true} openReceipt={() => undefined} navigate={() => undefined} />
    </TextProvider>,
  );
  return f;
}

beforeEach(() => { window.scrollTo = () => undefined; });
afterEach(cleanup);

test('the menu draws its topics, suggestions, the seed label and the ways into other views', async () => {
  show(base);
  expect(await screen.findByText('Invoiced by customer')).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Sales' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Collections' })).toBeTruthy();
  expect(await screen.findByRole('button', { name: 'Invoiced by customer · Last month' })).toBeTruthy();
  expect(screen.getByText('seed')).toBeTruthy();
  expect(screen.getByText(/The menu is the way to ask/)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Purchases against GSTR-2B' })).toBeTruthy();
  expect(screen.getByRole('radio', { name: 'This month' }).getAttribute('aria-checked')).toBe('true');
});

test('a menu row runs with the chosen period and opens the answer', async () => {
  const user = userEvent.setup();
  const f = show(base);
  await user.click(await screen.findByRole('radio', { name: 'Last month' }));
  await user.click(screen.getByRole('button', { name: /Money received/ }));
  expect(f.calls.find(c => c.method === 'askx.run')?.payload).toEqual({ operationId: 'collections.received', periodId: 'last-month' });
  expect((await screen.findAllByRole('button', { name: money('1234500') }))[0]!).toBeTruthy();
  expect(f.calls.some(c => c.method === 'askx.answer' && c.payload.receiptId === 'r-2')).toBe(true);
});

const proposal = {
  kind: 'proposal',
  proposal: { operationId: 'sales.invoiced', label: 'Invoiced by customer', period, periodId: 'last-month', branch: null, needs: ['period'] },
  options: { operations: [{ operationId: 'sales.invoiced', label: 'Invoiced by customer' }, { operationId: 'collections.received', label: 'Money received' }], periods, branches: ['Pune'] },
};

async function typeQuestion(text = 'how much did we bill last month') {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('Type a question'), text);
  await user.click(screen.getByRole('button', { name: 'Ask' }));
  return user;
}

test('a typed question shows what Chausar understood, then runs to an answer with its figure and check line', async () => {
  const f = show({ ...base, 'askx.understand': () => proposal });
  const user = await typeQuestion();
  expect(await screen.findByText('What Chausar understood')).toBeTruthy();
  expect(screen.getByText('Invoiced by customer · 1 Sep 2026 – 30 Sep 2026 · all branches')).toBeTruthy();
  expect(f.calls.some(c => c.method === 'askx.run')).toBe(false);
  await user.click(screen.getByRole('button', { name: 'Run' }));
  expect(f.calls.find(c => c.method === 'askx.run')?.payload).toEqual({ operationId: 'sales.invoiced', periodId: 'last-month', branch: null });
  const big = (await screen.findAllByRole('button', { name: money('1234500') }))[0]!;
  expect(big.getAttribute('title')).toContain('r-1');
  expect(screen.getByRole('heading', { level: 1, name: 'Invoiced by customer' })).toBeTruthy();
  expect(document.querySelector('[data-ranked-bars]')).not.toBeNull();
  expect(screen.getByText('Not loaded yet: July 2026.')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Checked against the receipt. 214 rows, 3 left out.' }));
  expect(screen.getByText('matches the rows read')).toBeTruthy();
  await user.click(big);
  expect(await screen.findByText('Total checked')).toBeTruthy();
});

test('changing the calculation, the period and the group sends what it corrected', async () => {
  const f = show({ ...base, 'askx.understand': () => proposal });
  const user = await typeQuestion();
  await user.click(await screen.findByRole('button', { name: 'Change' }));
  await user.click(screen.getByRole('radio', { name: 'Money received' }));
  await user.click(screen.getByRole('radio', { name: 'Pune' }));
  expect(screen.getByText('Money received · 1 Sep 2026 – 30 Sep 2026 · branch Pune')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Run' }));
  expect(f.calls.find(c => c.method === 'askx.run')?.payload).toEqual({
    operationId: 'collections.received', periodId: 'last-month', branch: 'Pune',
    correctedFrom: { operationId: 'sales.invoiced', periodChanged: false, groupChanged: true },
  });
});

test('a question that could mean two things asks once which was meant', async () => {
  const f = show({ ...base, 'askx.understand': () => ({ kind: 'choose', periodId: 'last-month', choices: [
    { operationId: 'sales.invoiced', label: 'Billed', meaning: 'invoices raised' },
    { operationId: 'collections.received', label: 'Received', meaning: 'money in the bank' },
  ] }) });
  const user = await typeQuestion('sales');
  expect(await screen.findByText('Which did you mean?')).toBeTruthy();
  expect(screen.getByText('money in the bank')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: /Received/ }));
  expect(f.calls.find(c => c.method === 'askx.run')?.payload).toEqual({ operationId: 'collections.received', periodId: 'last-month' });
});

test('not yet says so honestly, names the unknown word and offers nearby calculations', async () => {
  const f = show({ ...base, 'askx.understand': () => ({ kind: 'no-match', reason: 'unknown-word', word: 'udhaar', nearby: [{ operationId: 'collections.received', label: 'Money received' }] }) });
  const user = await typeQuestion('udhaar');
  expect(await screen.findByText('Not yet. No calculation covers this.')).toBeTruthy();
  expect(screen.getByText('Not sure what “udhaar” means. It is on the list.')).toBeTruthy();
  const nearby = screen.getByRole('list', { name: 'Close to what you asked' });
  await user.click(within(nearby).getByRole('button', { name: /Money received/ }));
  expect(f.calls.find(c => c.method === 'askx.run')?.payload).toEqual({ operationId: 'collections.received', periodId: 'this-month' });
});

test('an action that is not built yet is a not-yet too', async () => {
  show({ ...base, 'askx.understand': () => ({ kind: 'no-match', reason: 'action', word: null, nearby: [] }) });
  await typeQuestion('send reminders');
  expect(await screen.findByText('This asks Chausar to do something, and it cannot do that yet.')).toBeTruthy();
  expect(screen.getByText('It is on the wanted list.')).toBeTruthy();
});

test('a question stopped by a rule names the rule and who can change it', async () => {
  show({ ...base, 'askx.understand': () => ({ kind: 'refused', code: 'ASK_STOPPED_BY_RULE' }) });
  await typeQuestion('salaries');
  expect(await screen.findByText(/Stopped by a rule: A rule in Trust stops this answer/)).toBeTruthy();
  expect(screen.getByText('The owner in Trust can change it.')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Open Trust' })).toBeTruthy();
});

test('answer → receipt → rows in both tabs → what was sent', async () => {
  const user = userEvent.setup();
  const f = show(base, { address: { place: 'ask', sub: 'new', sheet: 'answer.r-1' }, view: 'books' });
  await user.click(await screen.findByRole('button', { name: 'See the receipt' }));
  expect(await screen.findByText('Your question: how much did we bill last month')).toBeTruthy();
  expect(screen.getByText('217 rows read')).toBeTruthy();
  expect(screen.getByText('cancelled')).toBeTruthy();
  expect(screen.getAllByText(/Recipe not yet tested/).length).toBeGreaterThan(0);
  expect(screen.getByText('calc-2')).toBeTruthy();
  expect(screen.getByText(/Allowed by owner owner-1/)).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Rows counted' }));
  expect(await screen.findByText('<b>Acme</b>')).toBeTruthy();
  expect(document.querySelector('b')).toBeNull();
  await user.click(screen.getByRole('radio', { name: 'Left out' }));
  expect(await screen.findByText('Cancelled Co')).toBeTruthy();
  expect(screen.getByText(/hidden from your seat/)).toBeTruthy();
  expect(f.calls.filter(c => c.method === 'askx.sourceRows').map(c => c.payload.tab)).toEqual(['counted', 'left-out']);
  await user.click(screen.getByRole('button', { name: 'Back' }));
  await user.click(await screen.findByRole('button', { name: 'What was sent to the AI model' }));
  expect(await screen.findByText('Totals for CUSTOMER_1')).toBeTruthy();
  expect(screen.getByText('local-model')).toBeTruthy();
});

test('removed text keeps only its fingerprint', async () => {
  show({ ...base, 'askx.sent': () => ({ kind: 'sent', routeId: 'r', sendLevel: 'samples', bytes: 10, costMinor: '150', text: null, digest: 'sha-gone', removed: true, at: '2026-09-01', boundary: 'b', retentionDays: 30 }) },
    { address: { place: 'ask', sub: 'new', sheet: 'answer.r-1' } });
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'See the receipt' }));
  await user.click(await screen.findByRole('button', { name: 'What was sent to the AI model' }));
  expect(await screen.findByText('The text was removed after 30 days. Its fingerprint is kept.')).toBeTruthy();
  expect(screen.getByText('sha-gone')).toBeTruthy();
});

test('save and save as a check go to the engine; a viewer sees neither', async () => {
  const user = userEvent.setup();
  const f = show(base, { address: { place: 'ask', sub: 'new', sheet: 'answer.r-1' } });
  await user.click(await screen.findByRole('button', { name: 'Save' }));
  expect(await screen.findByText('Saved.')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Save as a check' }));
  expect(await screen.findByText('Saved as a check.')).toBeTruthy();
  expect(f.calls.find(c => c.method === 'askx.checks.save')?.payload).toEqual({ receiptId: 'r-1', figureKey: 'total' });
  cleanup();
  show(base, { address: { place: 'ask', sub: 'new', sheet: 'answer.r-1' }, viewer: true });
  expect((await screen.findAllByRole('button', { name: money('1234500') }))[0]!).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Save as a check' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Record a decision' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Why did it change' })).toBeTruthy();
});

const saved = (stale: boolean) => ({ items: [
  { id: 's-1', kind: 'answer', question: 'billed last month', operationId: 'sales.invoiced', savedAt: '2026-09-12', receiptId: 'r-1', refId: null,
    headline: { kind: 'money', minor: '1234500' }, workedOutAt: '2026-09-12', deletedOn: null,
    stale: stale ? { reason: 'books-changed', since: '2026-10-01' } : null, rebuildable: true },
  { id: 's-2', kind: 'answer', question: 'old cash', operationId: 'cash.balance', savedAt: '2026-08-01', receiptId: null, refId: null,
    headline: null, workedOutAt: '2026-08-01', deletedOn: '2026-10-02', stale: null, rebuildable: false },
] });

test('saved shows stale answers with Rebuild and deleted ones with their date', async () => {
  const user = userEvent.setup();
  let stale = true;
  const f = show({ ...base, 'askx.saved': () => saved(stale), 'askx.rebuild': () => { stale = false; return { id: 's-1', receiptId: 'r-9' }; } }, { address: { place: 'ask', sub: 'saved' } });
  expect(await screen.findByText(/worked out on 12 Sep 2026, may be out of date/)).toBeTruthy();
  expect(screen.getByText('Something it used was deleted on 2 Oct 2026.')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Rebuild' }));
  expect(f.calls.find(c => c.method === 'askx.rebuild')?.payload).toEqual({ savedId: 's-1' });
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Rebuild' })).toBeNull());
  await user.click(screen.getByRole('button', { name: 'billed last month' }));
  expect(await screen.findByRole('heading', { level: 1, name: 'Invoiced by customer' })).toBeTruthy();
});

test('a viewer sees no Rebuild on a stale saved answer', async () => {
  show({ ...base, 'askx.saved': () => saved(true) }, { address: { place: 'ask', sub: 'saved' }, viewer: true });
  expect(await screen.findByText(/may be out of date/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Rebuild' })).toBeNull();
});

test('the not-yet list shows three lists with how often each was asked', async () => {
  show({ ...base, 'askx.wanted': () => ({
    calculations: [{ text: 'peer margins', count: 3, lastAt: '2026-10-01' }], actions: [], words: [{ word: 'udhaar', count: 2, lastAt: '2026-10-02' }],
  }) }, { address: { place: 'ask', sub: 'notyet' } });
  expect(await screen.findByText('peer margins')).toBeTruthy();
  expect(screen.getByText('asked 3 times')).toBeTruthy();
  expect(screen.getByText('Wanted actions · 0 in this list')).toBeTruthy();
  expect(screen.getByText('udhaar')).toBeTruthy();
});

test('a method that is not built yet shows the not-built state', async () => {
  show({ 'askx.menu': { code: 'UNKNOWN_METHOD' } });
  expect(await screen.findByText('Not built yet.')).toBeTruthy();
});

test('a reply that fails its check is a failure, never a partly drawn page', async () => {
  show({ ...base, 'askx.answer': () => ({ ...answer(), figures: [{ key: 'total', label: 'Total', minor: 12345.5, unit: 'money' }] }) },
    { address: { place: 'ask', sub: 'new', sheet: 'answer.r-1' } });
  expect(await screen.findByText('The engine sent a reply this page could not check, so nothing from it is shown.')).toBeTruthy();
  expect(screen.getByText(/INVALID_REPLY/)).toBeTruthy();
  expect(screen.queryByText('Total')).toBeNull();
});

test('an engine refusal shows the lane words for its code', async () => {
  show({ ...base, 'askx.answer': { code: 'ASK_NOT_FOUND' } }, { address: { place: 'ask', sub: 'new', sheet: 'answer.r-1' } });
  expect(await screen.findByText('This answer is no longer kept. Ask the question again from the menu.')).toBeTruthy();
});

test('Hindi draws the menu and an answer in Hindi', async () => {
  show(base, { language: 'hi' });
  expect(await screen.findByRole('heading', { name: 'बिक्री' })).toBeTruthy();
  expect(screen.getByText(/मेन्यू ही पूछने का तरीका है/)).toBeTruthy();
  cleanup();
  show(base, { language: 'hi', address: { place: 'ask', sub: 'new', sheet: 'answer.r-1' }, view: 'simple' });
  expect(await screen.findByRole('button', { name: 'रसीद से जाँचा गया। 214 पंक्तियाँ, 3 छोड़ी गईं।' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'सहेजें' })).toBeTruthy();
});
