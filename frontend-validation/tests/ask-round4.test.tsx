import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TextProvider } from '../../app/ui/src/app/text';
import { AskPlace } from '../../app/ui/src/screens/ask/lane/AskPlace';
import type { Address, Language, View } from '../../app/ui/src/app/presentation';
import { money } from '../../app/ui/src/format/index';

// Round 4 of the ask lane: every reply here is synthetic and shaped by platform/runtime/ask/contracts.ts.
type Handler = (payload: Record<string, unknown>) => unknown;
interface Call { method: string; payload: Record<string, unknown> }

function fake(handlers: Record<string, Handler | { code: string }>) {
  const calls: Call[] = [];
  const rpc = {
    async request(method: string, payload: Record<string, unknown>) {
      calls.push({ method, payload });
      const h = handlers[method];
      if (h === undefined) throw Object.assign(new Error('x'), { code: 'UNKNOWN_METHOD' });
      if (typeof h !== 'function') throw Object.assign(new Error('x'), { code: h.code });
      return structuredClone(await h(payload));
    },
  };
  return { rpc, calls, of: (method: string) => calls.filter(c => c.method === method).map(c => c.payload) };
}

function show(handlers: Record<string, Handler | { code: string }>, opts: { language?: Language; view?: View; viewer?: boolean; address?: Address } = {}) {
  const f = fake(handlers), navigate = vi.fn();
  render(
    <TextProvider language={opts.language ?? 'en'}>
      <AskPlace address={opts.address ?? { place: 'ask', sub: 'new' }} language={opts.language ?? 'en'} view={opts.view ?? 'guided'} member={{ id: 'owner-1', role: 'owner' }}
        viewer={opts.viewer ?? false} rpc={f.rpc} live={() => true} openReceipt={() => undefined} navigate={navigate} />
    </TextProvider>,
  );
  return { ...f, navigate };
}
const sheet = (name: string, sub = 'new'): Address => ({ place: 'ask', sub, sheet: name });

beforeEach(() => { window.scrollTo = () => undefined; });
afterEach(() => { cleanup(); window.location.hash = ''; });

const period = { from: '2026-09-01', to: '2026-09-30' }, oct = { from: '2026-10-01', to: '2026-10-31' };
const periods = [{ id: 'this-month', period: oct }, { id: 'last-month', period }];
const menu = {
  state: 'ready', seed: false, dictionary: null, gst2b: 'offered', today: '2026-10-14', periods, branches: ['Pune', 'Nashik'],
  topics: [
    { topic: 'sales', items: [{ operationId: 'sales.invoiced', label: 'Invoiced by customer', type: 'sum', topic: 'sales', needs: ['period'], meaning: null }] },
    { topic: 'collections', items: [{ operationId: 'collections.received', label: 'Money received', type: 'sum', topic: 'collections', needs: ['period'], meaning: null }] },
  ],
};
const answer = (receiptId: string, operationId: string, label: string, minor: string) => ({
  kind: 'answer', answerId: null, receiptId, operationId, label, period, comparePeriod: null, branch: null, asOf: '2026-10-14', headline: label,
  figures: [{ key: 'total', label: 'Total', minor, unit: 'money' }], rows: { read: 10, counted: 10, excluded: 0 }, completeness: 'reconciled-imports', gaps: [],
  monthsNotLoaded: [], labels: [], explanation: { source: 'template', text: 'x', replaced: false, reason: 'no-model' }, guard: { status: 'passed', lines: [] }, sent: 'nothing',
});
const base: Record<string, Handler> = {
  'askx.menu': () => menu, 'askx.suggest': () => ({ suggestions: [] }),
  'askx.run': p => p.operationId === 'collections.received' ? answer('r-recv', 'collections.received', 'Money received', '800000') : answer('r-bill', 'sales.invoiced', 'Invoiced by customer', '1234500'),
  'askx.answer': p => answer(String(p.receiptId), 'sales.invoiced', 'Invoiced by customer', '1234500'),
};
async function typeQuestion(text: string) {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText(/Type a question|सवाल लिखें/), text);
  await user.click(screen.getByRole('button', { name: /^(Ask|पूछें)$/ }));
  return user;
}

/* 1. AS-02 Change through askx.change. */
const proposal = (operationId: string, label: string, branch: string | null) => ({
  kind: 'proposal', proposal: { operationId, label, period, periodId: 'last-month', branch, needs: ['period'] },
  options: { operations: [{ operationId: 'sales.invoiced', label: 'Invoiced by customer' }, { operationId: 'collections.received', label: 'Money received' }], periods, branches: ['Pune'] },
});

test('Change asks the engine for the changed proposal, and Run sends what was corrected against the first proposal', async () => {
  const f = show({
    ...base, 'askx.understand': () => proposal('sales.invoiced', 'Invoiced by customer', null),
    'askx.change': p => {
      const to = p.change as Record<string, unknown>;
      return to.operationId !== undefined ? proposal(String(to.operationId), 'Money received', (p.branch as string | null) ?? null) : proposal(String(p.operationId), 'Money received', (to.branch as string | null) ?? null);
    },
  });
  const user = await typeQuestion('how much did we bill last month');
  await user.click(await screen.findByRole('button', { name: 'Change' }));
  await user.click(screen.getByRole('radio', { name: 'Money received' }));
  expect(await screen.findByText('Money received · 1 Sep 2026 – 30 Sep 2026 · all branches')).toBeTruthy();
  expect(f.of('askx.change')[0]).toEqual({ operationId: 'sales.invoiced', periodId: 'last-month', branch: null, change: { operationId: 'collections.received' } });
  await user.click(screen.getByRole('radio', { name: 'Pune' }));
  expect(await screen.findByText('Money received · 1 Sep 2026 – 30 Sep 2026 · branch Pune')).toBeTruthy();
  expect(f.of('askx.change')[1]).toEqual({ operationId: 'collections.received', periodId: 'last-month', branch: null, change: { branch: 'Pune' } });
  await user.click(screen.getByRole('button', { name: 'Run' }));
  expect(f.of('askx.run')[0]).toEqual({
    operationId: 'collections.received', periodId: 'last-month', branch: 'Pune',
    correctedFrom: { operationId: 'sales.invoiced', periodChanged: false, groupChanged: true },
  });
});

test('a refused change keeps the proposal and says why', async () => {
  show({ ...base, 'askx.understand': () => proposal('sales.invoiced', 'Invoiced by customer', null), 'askx.change': { code: 'ASK_NO_CALCULATION' } });
  const user = await typeQuestion('billed');
  await user.click(await screen.findByRole('button', { name: 'Change' }));
  await user.click(screen.getByRole('radio', { name: 'Money received' }));
  expect(await screen.findByText('No calculation covers this yet.')).toBeTruthy();
  expect(screen.getByText('Invoiced by customer · 1 Sep 2026 – 30 Sep 2026 · all branches')).toBeTruthy();
});

/* 2. Telling, not asking. */
const statement = { kind: 'statement', text: 'Remember that <b>Acme</b> always pays late', memoryKind: 'claim' };

test('a statement is offered to Memory, proposed through askx.tell, and links to Books › Memory', async () => {
  const f = show({ ...base, 'askx.understand': () => statement, 'askx.tell': () => ({ state: 'proposed', memoryId: 'mem-1', status: 'proposed' }) });
  const user = await typeQuestion('Acme always pays late');
  expect(await screen.findByText('Keep this for Chausar to remember? It waits until the owner confirms it in Books › Memory.')).toBeTruthy();
  expect(screen.getByText('Remember that <b>Acme</b> always pays late')).toBeTruthy();
  expect(document.querySelector('[data-statement] b')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Keep it' }));
  expect(f.of('askx.tell')[0]).toEqual({ text: 'Remember that <b>Acme</b> always pays late', kind: 'claim' });
  expect(await screen.findByText(/Proposed to Memory\. It waits until the owner confirms it/)).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Open Books › Memory' }));
  expect(f.navigate).toHaveBeenCalledWith({ place: 'books', sub: 'memory' });
});

test('a statement when Memory is not built says so; a viewer has no Keep button', async () => {
  show({ ...base, 'askx.understand': () => statement, 'askx.tell': () => ({ state: 'not-built' }) });
  const user = await typeQuestion('Acme always pays late');
  await user.click(await screen.findByRole('button', { name: 'Keep it' }));
  expect(await screen.findByText('Not built yet.')).toBeTruthy();
  cleanup();
  const f = show({ ...base, 'askx.understand': () => statement }, { viewer: true });
  await typeQuestion('Acme always pays late');
  expect(await screen.findByText('This seat can read, not change, so it cannot keep this.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Keep it' })).toBeNull();
  expect(f.of('askx.tell')).toEqual([]);
});

test('Hindi: a statement is offered in Hindi', async () => {
  show({ ...base, 'askx.understand': () => ({ ...statement, memoryKind: 'preference' }) }, { language: 'hi' });
  await typeQuestion('हमेशा GST के साथ बिल');
  expect(await screen.findByText(/क्या Chausar इसे याद रखे\?/)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'याद रखें' })).toBeTruthy();
});

/* 3. AS-08 needs data, and Ask a person. */
test('needs data: the GSTR-2B file when loaded opens the match page', async () => {
  show({ ...base, 'askx.understand': () => ({ kind: 'no-match', reason: 'needs-data', word: null, need: 'gstr2b', loaded: true, nearby: [] }),
    'askx.gst2b': () => ({ state: 'not-loaded', period }) });
  const user = await typeQuestion('input tax credit');
  expect(await screen.findByText('Not yet. Needs data: the GSTR-2B file.')).toBeTruthy();
  expect(screen.getByText('That data is loaded, but no calculation answers this question yet.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Open Books › Sources' })).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Open purchases against GSTR-2B' }));
  expect(await screen.findByRole('heading', { level: 1, name: 'Purchases against GSTR-2B' })).toBeTruthy();
});

test('needs data that is not loaded links to Books › Sources, and Ask a person saves a page, never sending it', async () => {
  const f = show({ ...base, 'askx.understand': () => ({ kind: 'no-match', reason: 'needs-data', word: null, need: 'stock', loaded: false, nearby: [] }),
    'reportsx.askPerson': () => ({ file: { path: '/x/question.html', name: 'question.html' }, sent: false }) });
  const user = await typeQuestion('how much stock do we have');
  expect(await screen.findByText('Not yet. Needs data: stock counts.')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Open Books › Sources' }));
  expect(f.navigate).toHaveBeenCalledWith({ place: 'books', sub: 'sources' });
  await user.click(screen.getByRole('button', { name: 'Ask a person' }));
  expect(f.of('reportsx.askPerson')[0]).toEqual({ question: 'how much stock do we have', reason: 'Not yet. Needs data: stock counts.' });
  expect(await screen.findByText('A page with your question was saved for your accountant. Chausar has not sent it to anyone.')).toBeTruthy();
});

test('every Not yet offers Ask a person with its sentence; a reply that says it was sent is not trusted', async () => {
  const f = show({ ...base, 'askx.understand': () => ({ kind: 'no-match', reason: 'unknown-word', word: 'udhaar', nearby: [] }), 'reportsx.askPerson': () => ({ sent: true }) });
  const user = await typeQuestion('udhaar');
  await user.click(await screen.findByRole('button', { name: 'Ask a person' }));
  expect(f.of('reportsx.askPerson')[0]).toEqual({ question: 'udhaar', reason: 'Not yet. No calculation covers this. Not sure what “udhaar” means. It is on the list.' });
  expect(await screen.findByText('The engine sent a reply this page could not check, so nothing from it is shown.')).toBeTruthy();
  expect(screen.queryByText(/was saved for your accountant/)).toBeNull();
});

test('Ask a person refused shows fixed words; a viewer has no Ask a person', async () => {
  show({ ...base, 'askx.understand': () => ({ kind: 'no-match', reason: 'action', word: null, nearby: [] }), 'reportsx.askPerson': { code: 'ASK_REFUSED' } });
  const user = await typeQuestion('send reminders');
  await user.click(await screen.findByRole('button', { name: 'Ask a person' }));
  expect(await screen.findByText('Chausar will not work this out. Nothing was changed.')).toBeTruthy();
  cleanup();
  show({ ...base, 'askx.understand': () => ({ kind: 'no-match', reason: 'needs-data', word: null, need: 'payroll', loaded: false, nearby: [] }) }, { viewer: true });
  await typeQuestion('salaries last month');
  expect(await screen.findByText('Not yet. Needs data: payroll records.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Ask a person' })).toBeNull();
});

test('Hindi: needs data and Ask a person in Hindi', async () => {
  const f = show({ ...base, 'askx.understand': () => ({ kind: 'no-match', reason: 'needs-data', word: null, need: 'bank-statement', loaded: false, nearby: [] }),
    'reportsx.askPerson': () => ({ sent: false }) }, { language: 'hi' });
  const user = await typeQuestion('बैंक बैलेंस');
  expect(await screen.findByText('अभी नहीं। डेटा चाहिए: बैंक स्टेटमेंट।')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'किसी व्यक्ति से पूछें' }));
  expect(f.of('reportsx.askPerson')[0]!.reason).toBe('अभी नहीं। डेटा चाहिए: बैंक स्टेटमेंट।');
  expect(await screen.findByText(/Chausar ने इसे किसी को नहीं भेजा है/)).toBeTruthy();
});

/* 4. AS-04 two meanings side by side. */
const choose = { kind: 'choose', periodId: 'last-month', choices: [
  { operationId: 'sales.invoiced', label: 'Billed', meaning: 'invoices raised' },
  { operationId: 'collections.received', label: 'Received', meaning: null },
] };

test('two meanings side by side: each runs for the same period and its figure opens its own receipt', async () => {
  const f = show({ ...base, 'askx.understand': () => choose }, { viewer: true });
  const user = await typeQuestion('sales');
  await user.click(await screen.findByRole('button', { name: 'Show them side by side' }));
  const columns = await waitFor(() => { const el = document.querySelector<HTMLElement>('[data-side-by-side]'); if (!el) throw new Error('missing'); return el; });
  expect(f.of('askx.run')).toEqual([{ operationId: 'sales.invoiced', periodId: 'last-month' }, { operationId: 'collections.received', periodId: 'last-month' }]);
  expect(within(columns).getByText('These are different measures. Each figure opens its own receipt.')).toBeTruthy();
  const first = within(columns).getByRole('region', { name: 'Measure 1: Billed' }), second = within(columns).getByRole('region', { name: 'Measure 2: Received' });
  expect(within(first).getByText('invoices raised')).toBeTruthy();
  expect(within(second).getByText('No meaning is written for this one yet.')).toBeTruthy();
  expect(within(first).getByRole('button', { name: money('1234500') }).getAttribute('title')).toContain('r-bill');
  expect(within(second).getByRole('button', { name: money('800000') }).getAttribute('title')).toContain('r-recv');
  // Picking one still works as before.
  await user.click(within(screen.getByRole('list', { name: 'Which did you mean?' })).getByRole('button', { name: /Received/ }));
  expect(f.of('askx.run')).toHaveLength(3);
});

/* 5. SH-04 Stop. */
function pending() {
  let stop: () => void = () => undefined;
  const wait = new Promise((_, reject) => { stop = () => reject(Object.assign(new Error('x'), { code: 'ASK_STOPPED' })); });
  return { wait: () => wait, stop: () => { stop(); return { stopped: true, at: '2026-10-14T10:00:00.000Z' }; } };
}

test('a forecast being worked out can be stopped, and says nothing was saved', async () => {
  const p = pending();
  const f = show({ 'askx.menu': () => menu, 'askx.forecast': () => p.wait(), 'askx.stop': () => p.stop() }, { address: sheet('forecast') });
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Forecast it' }));
  await user.click(await screen.findByRole('button', { name: 'Stop' }));
  expect(f.of('askx.stop')).toEqual([{}]);
  expect(await screen.findByText(/Stopped as you asked\. The unfinished answer was not kept\./)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
});

test('a plan being worked out can be stopped', async () => {
  const p = pending();
  show({ 'askx.plan': () => p.wait(), 'askx.stop': () => p.stop() }, { address: sheet('plan') });
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Amount in rupees'), '100');
  await user.click(screen.getByRole('button', { name: 'Find the best plan' }));
  await user.click(await screen.findByRole('button', { name: 'Stop' }));
  expect(await screen.findByText(/Stopped as you asked/)).toBeTruthy();
  expect(screen.getByText('ASK_STOPPED')).toBeTruthy();
});

const checks = { items: [{ id: 'c-1', question: 'Collections in August', operationId: 'collections.received', figureKey: 'total', unit: 'money', quantityUnit: null, expected: { minor: '100000', receiptId: 'r-aug' }, last: null }], due: true, changed: [], lastRunAt: null };
test('Run all checks can be stopped; Hindi says it in Hindi', async () => {
  const p = pending();
  show({ 'askx.checks.list': () => checks, 'askx.checks.run': () => p.wait(), 'askx.stop': () => p.stop() }, { address: { place: 'ask', sub: 'checks' }, language: 'hi' });
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'अभी सब चलाएँ' }));
  await user.click(await screen.findByRole('button', { name: 'रोकें' }));
  expect(await screen.findByText(/आपके कहने पर रोका गया/)).toBeTruthy();
});

/* 6. AS-09 the rule's own text. */
test('a refusal with a rule shows Trust’s own words and who can change it', async () => {
  const f = show({ ...base, 'askx.run': () => ({ kind: 'refused', code: 'ASK_STOPPED_BY_RULE', rule: 'marking' }),
    'askx.explainRule': () => ({ state: 'ready', ruleId: 'marking:accountant:personal+confidential', text: 'Personal <i>rows</i> stay with the owner.', changeableBy: 'owner-or-cofounder' }) });
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: /Money received/ }));
  expect(await screen.findByText('Stopped by a rule: Personal <i>rows</i> stay with the owner.')).toBeTruthy();
  expect(screen.getByText('The owner or a co-founder can change it.')).toBeTruthy();
  expect(document.querySelector('[data-refusal] i')).toBeNull();
  expect(f.of('askx.explainRule')[0]).toEqual({ rule: 'marking', language: 'en' });
});

test('when Trust cannot explain the rule yet, the fixed sentence for its kind stays; a bad rule id is not shown', async () => {
  show({ ...base, 'askx.run': () => ({ kind: 'refused', code: 'ASK_STOPPED_BY_RULE', rule: 'branch' }), 'askx.explainRule': () => ({ state: 'not-built' }) });
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: /Money received/ }));
  expect(await screen.findByText(/Stopped by a rule: Rows from a branch your seat does not cover/)).toBeTruthy();
  cleanup();
  show({ ...base, 'askx.run': () => ({ kind: 'refused', code: 'ASK_STOPPED_BY_RULE', rule: 'branch' }),
    'askx.explainRule': () => ({ state: 'ready', ruleId: '<script>', text: 'x', changeableBy: 'owner' }) });
  await userEvent.setup().click(await screen.findByRole('button', { name: /Money received/ }));
  expect(await screen.findByText(/Rows from a branch your seat does not cover/)).toBeTruthy();
});

test('Hindi: the rule is asked for in Hindi', async () => {
  const f = show({ ...base, 'askx.run': () => ({ kind: 'refused', code: 'ASK_STOPPED_BY_RULE', rule: 'seat' }),
    'askx.explainRule': () => ({ state: 'ready', ruleId: 'seat-1', text: 'केवल मालिक यह देख सकते हैं।', changeableBy: 'owner' }) }, { language: 'hi' });
  await userEvent.setup().click(await screen.findByRole('button', { name: /Money received/ }));
  expect(await screen.findByText('नियम ने रोका: केवल मालिक यह देख सकते हैं।')).toBeTruthy();
  expect(screen.getByText('मालिक इसे बदल सकते हैं।')).toBeTruthy();
  expect(f.of('askx.explainRule')[0]!.language).toBe('hi');
});

/* 7. AS-05 provenance. */
const receipt = (provenance: unknown) => ({
  receiptId: 'r-bill', operationId: 'sales.invoiced', label: 'Invoiced by customer',
  chain: { question: null, calculation: 'Invoiced by customer', rowsRead: 10, totalChecked: true }, figures: [{ key: 'total', label: 'Total', minor: '1234500', unit: 'money' }],
  period, comparePeriod: null, asOf: '2026-10-14', createdAt: '2026-10-14', branch: null, definitions: [], exclusions: [], completeness: 'reconciled-imports', gaps: [],
  sources: [], versions: { app: '1.0.0', dictionary: 3, dictionaryHash: 'dh', definitionHash: 'defh', recipes: [], calculator: 'calc-2' },
  allowedBy: { memberId: 'owner-1', role: 'owner', device: 'desktop', at: '2026-10-14T09:00:00.000Z' }, labels: [], notCounted: 0, fx: [], sent: { kind: 'nothing' },
  meaning: null, demo: false, provenance,
});
const full = {
  recipes: [{ sourceId: 'src-tally', recipeId: 'tally.daybook', acceptedBy: 'Asha', acceptedAt: '2026-09-02T10:00:00.000Z' }, { sourceId: 'src-bank', recipeId: 'bank.hdfc', acceptedBy: null, acceptedAt: null }],
  meaning: { publishedBy: 'owner-1', reviewedBy: 'Ravi', coSignedBy: 'Meera', reviewedAt: '2026-09-03' },
  forecast: { method: 'linear-trend', learnedFrom: { from: '2024-04-01', to: '2026-03-31' }, testedOn: { from: '2026-04-01', to: '2026-09-30' } },
  allowedBy: { ruleId: 'seat:owner', check: 'seat-check', device: 'phone', memberId: 'owner-1', at: '2026-10-14T09:00:00.000Z' },
};

test('the receipt small print shows who accepted each recipe, who reviewed the meaning, the forecast line and the rule', async () => {
  show({ ...base, 'askx.receipt': () => receipt(full) }, { address: sheet('answer.r-bill') });
  await userEvent.setup().click(await screen.findByRole('button', { name: 'See the receipt' }));
  const list = await waitFor(() => { const el = document.querySelector<HTMLElement>('[data-provenance]'); if (!el) throw new Error('missing'); return el; });
  expect(within(list).getByText('Recipe tally.daybook accepted by Asha on 2 Sep 2026')).toBeTruthy();
  expect(within(list).getByText('Recipe bank.hdfc: who accepted it is not recorded yet.')).toBeTruthy();
  expect(within(list).getByText('Meaning reviewed by Ravi, co-signed by Meera')).toBeTruthy();
  expect(within(list).getByText(/^Forecast by linear-trend, learned from 1 Apr 2024 – 31 Mar 2026/)).toBeTruthy();
  expect(within(list).getByText('Allowed by rule seat:owner, check seat-check, on phone')).toBeTruthy();
});

test('provenance not recorded yet is said in words; a receipt without the field is not drawn', async () => {
  show({ ...base, 'askx.receipt': () => receipt({ recipes: [], meaning: null, forecast: null, allowedBy: null }) }, { address: sheet('answer.r-bill'), view: 'books' });
  await userEvent.setup().click(await screen.findByRole('button', { name: 'See the receipt' }));
  expect(await screen.findByText('Who accepted the recipes is not recorded yet.')).toBeTruthy();
  expect(screen.getByText('Who reviewed the meaning is not recorded yet.')).toBeTruthy();
  expect(screen.getByText('The rule and the check that allowed this are not recorded yet.')).toBeTruthy();
  cleanup();
  show({ ...base, 'askx.receipt': () => receipt(null) }, { address: sheet('answer.r-bill'), view: 'simple' });
  await userEvent.setup().click(await screen.findByRole('button', { name: /See the receipt/ }));
  expect(await screen.findByText(/which rule allowed this are not recorded yet/)).toBeTruthy();
  cleanup();
  const { provenance: _drop, ...without } = receipt(null);
  show({ ...base, 'askx.receipt': () => without }, { address: sheet('answer.r-bill') });
  await userEvent.setup().click(await screen.findByRole('button', { name: 'See the receipt' }));
  expect(await screen.findByText(/could not check/)).toBeTruthy();
  cleanup();
  show({ ...base, 'askx.receipt': () => receipt({ ...full, meaning: { publishedBy: 1 } }) }, { address: sheet('answer.r-bill') });
  await userEvent.setup().click(await screen.findByRole('button', { name: 'See the receipt' }));
  expect(await screen.findByText(/could not check/)).toBeTruthy();
});

test('Hindi: provenance lines in Hindi', async () => {
  show({ ...base, 'askx.receipt': () => receipt(full) }, { address: sheet('answer.r-bill'), language: 'hi' });
  await userEvent.setup().click(await screen.findByRole('button', { name: 'रसीद देखें' }));
  expect(await screen.findByText('अर्थ की समीक्षा Ravi ने की, सह-हस्ताक्षर Meera ने किए')).toBeTruthy();
});

/* 8. AS-11 branch picker. */
const whatIf = { label: 'what-if', assumption: { name: 'price', beforeBps: '0', afterBps: '500' }, books: { minor: '1000000', receiptId: 'r-books' }, withChange: { minor: '1050000', receiptId: 'r-with' }, change: { minor: '50000', receiptId: 'r-change' }, period, branch: 'Pune' };
test('what if offers each branch the seat can see and sends the one chosen', async () => {
  const f = show({ 'askx.menu': () => menu, 'askx.whatIf': () => whatIf }, { address: sheet('whatif') });
  const user = userEvent.setup();
  await user.click(await screen.findByRole('radio', { name: 'Pune' }));
  expect(screen.getByRole('radio', { name: 'All branches' })).toBeTruthy();
  await user.type(screen.getByLabelText('Change in prices, in percent'), '5');
  await user.click(screen.getByRole('button', { name: 'Show what if' }));
  expect(f.of('askx.whatIf')[0]).toEqual({ periodId: 'last-month', priceChangeBps: '500', branch: 'Pune' });
  expect(await screen.findByRole('button', { name: money('1050000') })).toBeTruthy();
  cleanup();
  show({ 'askx.menu': () => menu }, { address: sheet('whatif'), language: 'hi' });
  expect(await screen.findByRole('radio', { name: 'सभी शाखाएँ' })).toBeTruthy();
});

/* 9. AS-19 GSTR-2B. */
const ready = {
  state: 'ready', period, toleranceMinor: '1000', via: 'connectors', sources: { register: 'src-purchases', gstr2b: 'src-2b-portal' }, leftOut: 0, matchReceiptId: 'r-match',
  groups: [
    { group: 'matched', count: 2, taxableMinor: '200000', taxMinor: '36000', unknownTax: 0 },
    { group: 'differs-inside', count: 0, taxableMinor: '0', taxMinor: '0', unknownTax: 0 },
    { group: 'differs-outside', count: 0, taxableMinor: '0', taxMinor: '0', unknownTax: 0 },
    { group: 'probable', count: 1, taxableMinor: '50000', taxMinor: '9000', unknownTax: 0 },
    { group: 'in-2b-only', count: 1, taxableMinor: '30000', taxMinor: '0', unknownTax: 1 },
    { group: 'books-only', count: 0, taxableMinor: '0', taxMinor: '0', unknownTax: 0 },
  ],
  lines: [
    { id: 'l-p', group: 'probable', supplier: 'Probable Traders', invoice: 'PT-1', booksMinor: '50000', twoBMinor: '50000', differenceMinor: '0', bookRowId: 'b-1', twoBRowId: 't-1', receiptId: 'r-line-p' },
    { id: 'l-2', group: 'in-2b-only', supplier: 'Only In 2B', invoice: 'O-9', booksMinor: null, twoBMinor: '30000', differenceMinor: null, bookRowId: null, twoBRowId: 't-9', receiptId: null },
  ],
  ims: [{ lineId: 'l-p', action: 'pending', reason: 'probable-match' }, { lineId: 'l-2', action: 'pending', reason: 'not-in-books' }],
};

test('gst2b with two reads of each asks which to match, then keeps them for the line and the export', async () => {
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() }));
  const f = show({
    'askx.gst2b': p => p.registerSourceId === undefined ? { state: 'choose-sources', period, registerSources: ['src-purchases', 'src-old'], gstr2bSources: ['src-2b-file', 'src-2b-portal'] } : ready,
    'askx.gst2b.line': () => ({ id: 'l-2', group: 'in-2b-only', books: null, twoB: { rowId: 't-9', sourceId: 'src-2b-portal', sourceRow: 9, cells: [{ name: 'Invoice', value: 'O-9' }] }, rule: { toleranceMinor: '1000', key: 'supplier-gstin-invoice-and-financial-year' } }),
    'askx.gst2b.exportIms': () => ({ fileName: 'ims.csv', csv: 'a\n' }),
  }, { address: sheet('gst2b') });
  const user = userEvent.setup();
  expect(await screen.findByText(/Choose which two to match/)).toBeTruthy();
  await user.click(screen.getByRole('radio', { name: 'src-2b-portal' }));
  await user.click(screen.getByRole('button', { name: 'Match these two' }));
  expect(await screen.findByText('Matched src-purchases against src-2b-portal.')).toBeTruthy();
  expect(f.of('askx.gst2b')[1]).toEqual({ periodId: 'last-month', registerSourceId: 'src-purchases', gstr2bSourceId: 'src-2b-portal' });
  const groups = document.querySelector('[data-gst-groups]') as HTMLElement;
  expect(within(groups).getByText('Probable match — not counted as matched; check it in the portal')).toBeTruthy();
  expect(within(groups).getByText(/One line with unknown tax, not added as zero/)).toBeTruthy();
  const matchedFigure = within(groups).getByRole('button', { name: money('36000') });
  expect(matchedFigure.getAttribute('title')).toContain('r-match');
  expect(within(document.querySelector('[data-gst-ims]') as HTMLElement).getByText('Keep pending in the GST portal, because it is a probable match: check before accepting.')).toBeTruthy();
  // A line without its own receipt opens its two rows, with the source ids kept.
  await user.click(within(groups).getByRole('button', { name: /In 2B only/ }));
  await user.click(within(document.querySelector('[data-gst-lines]') as HTMLElement).getByRole('button', { name: /Only In 2B/ }));
  expect(await screen.findByText('Matched on the supplier’s GSTIN, the invoice number and the financial year, with a tolerance of ₹10.')).toBeTruthy();
  expect(f.of('askx.gst2b.line')[0]).toEqual({ periodId: 'last-month', lineId: 'l-2', registerSourceId: 'src-purchases', gstr2bSourceId: 'src-2b-portal' });
  await user.click(screen.getByRole('button', { name: 'Export the IMS list' }));
  expect(f.of('askx.gst2b.exportIms')[0]).toEqual({ periodId: 'last-month', registerSourceId: 'src-purchases', gstr2bSourceId: 'src-2b-portal' });
});

test('a gst2b line with its own receipt has a figure that opens that receipt', async () => {
  const f = show({ 'askx.gst2b': () => ready, 'askx.receipt': () => receipt(null) }, { address: sheet('gst2b'), view: 'books' });
  const user = userEvent.setup();
  const table = await waitFor(() => { const el = document.querySelector<HTMLElement>('[data-gst-table]'); if (!el) throw new Error('missing'); return el; });
  expect(within(table).getAllByRole('row').length).toBe(7);
  expect(within(table).getByRole('button', { name: money('200000') }).getAttribute('title')).toContain('r-match');
  await user.click(within(document.querySelector('[data-gst-groups]') as HTMLElement).getByRole('button', { name: /Probable match/ }));
  const lines = document.querySelector('[data-gst-lines]') as HTMLElement;
  expect(within(lines).getByRole('button', { name: money('50000') }).getAttribute('title')).toContain('r-line-p');
  await user.click(within(lines).getByRole('button', { name: /Probable Traders/ }));
  expect(await screen.findByRole('heading', { level: 1, name: 'The receipt' })).toBeTruthy();
  expect(f.of('askx.receipt')[0]).toEqual({ receiptId: 'r-line-p' });
  expect(f.of('askx.gst2b.line')).toEqual([]);
});

test('gst2b shapes outside the contract are not drawn; Hindi words for the probable group', async () => {
  show({ 'askx.gst2b': () => ({ ...ready, groups: ready.groups.map(g => ({ ...g, unknownTax: undefined })) }) }, { address: sheet('gst2b') });
  expect(await screen.findByText(/could not be checked/)).toBeTruthy();
  cleanup();
  show({ 'askx.gst2b': () => ({ state: 'choose-sources', period, registerSources: [], gstr2bSources: ['x'] }) }, { address: sheet('gst2b') });
  expect(await screen.findByText(/could not be checked/)).toBeTruthy();
  cleanup();
  show({ 'askx.gst2b': () => ready }, { address: sheet('gst2b'), language: 'hi' });
  expect(await screen.findByText('संभावित मिलान — मिला हुआ नहीं गिना गया; पोर्टल में जाँचें')).toBeTruthy();
});
