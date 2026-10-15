import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TextProvider } from '../../app/ui/src/app/text';
import { AskPlace } from '../../app/ui/src/screens/ask/lane/AskPlace';
import { figureOf } from '../../app/ui/src/screens/ask/lane/kit';
import { unitShape } from '../../app/ui/src/screens/ask/lane/core-replies';
import type { Address, Language } from '../../app/ui/src/app/presentation';

// The ask lane's follow-up to core-data: figure units, the cancelled journal state and decidedOn. Synthetic replies only.
type Handler = (payload: Record<string, unknown>) => unknown;
function show(handlers: Record<string, Handler>, address: Address, opts: { language?: Language; viewer?: boolean } = {}) {
  const calls: { method: string; payload: Record<string, unknown> }[] = [];
  const rpc = { async request(method: string, payload: Record<string, unknown>) {
    calls.push({ method, payload });
    const h = handlers[method]; if (h === undefined) throw Object.assign(new Error('x'), { code: 'UNKNOWN_METHOD' });
    return structuredClone(await h(payload));
  } };
  render(
    <TextProvider language={opts.language ?? 'en'}>
      <AskPlace address={address} language={opts.language ?? 'en'} view="guided" member={{ id: 'owner-1', role: 'owner' }}
        viewer={opts.viewer ?? false} rpc={rpc} live={() => true} openReceipt={() => undefined} navigate={vi.fn()} />
    </TextProvider>,
  );
  return { calls, of: (method: string) => calls.filter(c => c.method === method).map(c => c.payload) };
}
const sheet = (name: string, sub = 'new'): Address => ({ place: 'ask', sub, sheet: name });
beforeEach(() => { window.scrollTo = () => undefined; });
afterEach(() => { cleanup(); window.location.hash = ''; });

test('figureOf never draws a quantity, a count or an unknown unit as rupees', () => {
  expect(figureOf('quantity', '1200', 'r-1', [], 'boxes')).toMatchObject({ kind: 'count', exact: '1200', display: '1,200 boxes' });
  expect(figureOf('quantity', '-3', 'r-1', [], 'pcs').display).toBe('-3 pcs');
  expect(figureOf('count', '125000', 'r-1').display).toBe('1,25,000');
  expect(figureOf('other', '500', 'r-1')).toMatchObject({ kind: 'count', display: '500' });
  for (const unit of ['quantity', 'count', 'other'] as const) expect(figureOf(unit, '1200', 'r-1', [], 'boxes').display).not.toMatch(/₹|rs/i);
  expect(figureOf('money', '120000', 'r-1').kind).toBe('money');
});

test('unitShape reads any unknown unit as other, and keeps a quantity unit only when it is plain text', () => {
  expect(unitShape({ unit: 'litres' })).toEqual({ unit: 'other', quantityUnit: null });
  expect(unitShape({})).toEqual({ unit: 'other', quantityUnit: null });
  expect(unitShape({ unit: 'quantity', quantityUnit: 'kg' })).toEqual({ unit: 'quantity', quantityUnit: 'kg' });
  expect(unitShape({ unit: 'quantity', quantityUnit: '<b>kg</b>' })).toEqual({ unit: 'quantity', quantityUnit: null });
  expect(unitShape({ unit: 'count', quantityUnit: 'kg' })).toEqual({ unit: 'count', quantityUnit: null });
});

const stockAnswer = {
  kind: 'answer', answerId: null, receiptId: 'r-stock', operationId: 'stock_on_hand', label: 'Stock on hand', period: null, comparePeriod: null, branch: null, asOf: '2026-10-14', headline: 'item:SKU-A',
  figures: [{ key: 'item:SKU-A', label: 'SKU-A', minor: '1200', unit: 'quantity', quantityUnit: 'boxes' }, { key: 'items', label: 'Items with stock figures', minor: '2', unit: 'count', quantityUnit: null },
    { key: 'odd', label: 'Something new', minor: '77', unit: 'litres', quantityUnit: null }],
  rows: { read: 2, counted: 2, excluded: 0 }, completeness: 'unreconciled-facts', gaps: [], monthsNotLoaded: [], labels: [],
  explanation: { source: 'template', text: 'x', replaced: false, reason: 'no-model' }, guard: { status: 'passed', lines: [] }, sent: 'nothing',
};

test('a stock answer shows quantities with their unit and counts as numbers, never rupees', async () => {
  show({ 'askx.answer': () => stockAnswer, 'askx.menu': () => ({ state: 'empty' }) }, sheet('answer.r-stock'));
  expect((await screen.findAllByText('1,200 boxes')).length).toBeGreaterThan(0);
  expect(screen.getAllByText('77').length).toBeGreaterThan(0);
  expect(document.body.textContent).not.toMatch(/₹\s?1,200|₹\s?77|₹\s?2\b/);
});

test('a check on a quantity draws its expected value in that unit', async () => {
  show({ 'askx.checks.list': () => ({ items: [{ id: 'c-1', question: 'SKU-A on hand', operationId: 'stock_on_hand', figureKey: 'item:SKU-A', unit: 'quantity', quantityUnit: 'boxes',
    expected: { minor: '1200', receiptId: 'r-stock' }, last: null }], due: false, changed: [], lastRunAt: null }) }, { place: 'ask', sub: 'checks' });
  expect(await screen.findByText('1,200 boxes')).toBeTruthy();
  expect(document.body.textContent).not.toMatch(/₹/);
});

const decision = (over: Record<string, unknown> = {}) => ({
  id: 'dec-1', text: 'Hold credit for customer A.', createdAt: '2026-10-14T09:00:00.000Z', reviewDate: '2099-01-31', status: 'open', recordedLater: true, replaced: false, cancelled: false, revision: 1,
  decidedOn: '2026-10-01', cancellation: null, canCancel: true, journal: true, reviews: [],
  known: [{ receiptId: 'r-stock', label: 'stock_on_hand', minor: '1200', asOf: '2026-10-14', unit: 'quantity', quantityUnit: 'boxes' }], ...over,
});

test('a decision shows the day it was decided, its known figures in their unit, and the recorder can cancel it with a reason', async () => {
  const user = userEvent.setup();
  const f = show({ 'askx.decisions.get': () => decision(), 'askx.decisions.cancel': p => decision({ status: 'closed', cancelled: true, canCancel: false, revision: 2, cancellation: { reason: String(p.reason), at: '2026-10-15T09:00:00.000Z' } }) },
    sheet('decision.dec-1', 'decisions'));
  expect(await screen.findByText(/Decided on 1 Oct 2026\. Recorded on 14 Oct 2026\./)).toBeTruthy();
  expect(screen.getByText('1,200 boxes')).toBeTruthy();
  const button = screen.getByRole('button', { name: 'Cancel the decision' });
  expect((button as HTMLButtonElement).disabled).toBe(true);
  await user.type(screen.getByLabelText('Why is it cancelled'), 'Customer A paid in full.');
  await user.click(button);
  await waitFor(() => expect(f.of('askx.decisions.cancel')).toEqual([{ decisionId: 'dec-1', revision: 1, reason: 'Customer A paid in full.' }]));
  expect(await screen.findByText(/Cancelled on 15 Oct 2026: Customer A paid in full\./)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Cancel the decision' })).toBeNull();
});

test('no cancel for a decision this member did not record, nor for a viewer; Hindi says decided-on in Hindi', async () => {
  show({ 'askx.decisions.get': () => decision({ canCancel: false }) }, sheet('decision.dec-1', 'decisions'));
  await screen.findByText('Hold credit for customer A.');
  expect(screen.queryByRole('button', { name: 'Cancel the decision' })).toBeNull();
  cleanup();
  show({ 'askx.decisions.get': () => decision() }, sheet('decision.dec-1', 'decisions'), { viewer: true });
  await screen.findByText('Hold credit for customer A.');
  expect(screen.queryByRole('button', { name: 'Cancel the decision' })).toBeNull();
  cleanup();
  show({ 'askx.decisions.get': () => decision() }, sheet('decision.dec-1', 'decisions'), { language: 'hi' });
  expect(await screen.findByText(/को तय हुआ।.*को दर्ज हुआ।/)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'निर्णय रद्द करें' })).toBeTruthy();
});
