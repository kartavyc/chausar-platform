import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { ClockProvider } from '../../src/shell/clock';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import type { EngineClient } from '../../src/engine/types';
import { assertFiguresProved, assertInkRules, assertOnePrimary, receiptMark } from '../helpers/ink-rules';

/*
 * Money's documents and limits in wave 4 (docs/superpowers/plans/2026-10-23-chausar-ink-v2-w4.md, package 4J20, from
 * 4J4, 4J5 and 4F2): lateness and Remind on the invoices, cheques that wait to clear, the client's TDS, credit notes on
 * the always-ask floor, the timeline, invoices that repeat, bills, margins per client, the spend meter and the limit
 * sheet, and the accountant's read-only month. The fake engine answers each with the engine's codes and shapes.
 */

type Call = [string, unknown];
const OCT_21 = '2026-10-21T11:00:00.000Z';
/** INV-0039 (Lumen, due 28 Oct 2026) is 13 days late on 10 Nov, past its 10-day reminder. */
const NOV_10 = '2026-11-10T06:00:00.000Z';

async function start(hash: string, options: { now?: string; business?: string; before?: (engine: FakeEngine) => Promise<void> } = {}) {
  const now = options.now ?? OCT_21;
  const engine = new FakeEngine({ now: () => now });
  if (options.business) await engine.request('workspace.open', { folder: options.business });
  await options.before?.(engine);
  window.location.hash = hash;
  const base = createFakeClient(engine);
  const calls: Call[] = [];
  const request = base.request.bind(base);
  const client: EngineClient = { ...base, request: (async (method: string, params?: unknown) => { calls.push([method, params]); return request(method as never, params as never); }) as EngineClient['request'] };
  render(<ClockProvider now={() => new Date(now)}><App client={client} language="en" /></ClockProvider>);
  return { engine, calls };
}
const click = async (element: Element) => { await act(async () => { fireEvent.click(element); window.dispatchEvent(new HashChangeEvent('hashchange')); }); };
const type = async (label: string, value: string, scope: HTMLElement = document.body) => {
  await act(async () => { fireEvent.change(within(scope).getByLabelText(label), { target: { value } }); });
};
const sheet = () => screen.findByRole('complementary');
const rowOf = (text: string) => screen.getByText(text).closest('tr, li') as HTMLElement;

describe('Money w4: lateness and reminders on the invoices', () => {
  it('a late invoice says how late in words, and its action is Remind, which drafts and opens the reminder to send yourself', async () => {
    const { calls } = await start('#/money/invoices', { now: NOV_10 });
    await screen.findByRole('button', { name: 'Invoice INV-0039' });
    const row = screen.getByRole('button', { name: 'Invoice INV-0039' }).closest('tr') as HTMLElement;
    expect(within(row).getByText('13 days late')).toBeTruthy();
    await click(within(row).getByRole('button', { name: 'Remind' }));
    await waitFor(() => expect(calls).toContainEqual(['venture.invoice.remind', { invoiceId: 'inv-0039' }]));
    await waitFor(() => expect(window.location.hash).toMatch(/sheet=outreach%3Areminder-1/));
    // Drafted now: the row opens it; nothing was sent.
    expect(await within(row).findByRole('button', { name: 'Open reminder' })).toBeTruthy();
    expect(calls.map(([method]) => method)).not.toContain('venture.outreach.sent');
    assertInkRules();
  });

  it('the invoice sheet says the next step and the timeline in words, with no amount outside its receipts', async () => {
    await start('#/money/invoices?sheet=invoice:inv-0039', { now: NOV_10 });
    const panel = await sheet();
    expect(await within(panel).findByText('A reminder is due. Draft it, then send it yourself.')).toBeTruthy();
    const timeline = within(panel).getByRole('region', { name: 'Timeline' });
    expect([...timeline.querySelectorAll('li')].map((item) => item.getAttribute('data-what'))).toEqual(['issued', 'awaiting']);
    expect(timeline.textContent).not.toMatch(/₹/);
    assertInkRules(panel);
  });
});

describe('Money w4: cheques, TDS and credit notes', () => {
  it('a cheque is recorded as waiting to clear, and Mark cleared asks again before it counts from today', async () => {
    const { calls } = await start('#/money/invoices?sheet=payment:inv-0039');
    const panel = await sheet();
    await type('Amount received', '26200', panel);
    await act(async () => { fireEvent.change(within(panel).getByLabelText('How it was paid'), { target: { value: 'cheque' } }); });
    expect(within(panel).getByText('A cheque counts once it clears.')).toBeTruthy();
    await click(within(panel).getByRole('button', { name: 'Record payment' }));
    await click(within(panel).getByRole('button', { name: 'Record' }));
    await waitFor(() => expect(calls).toContainEqual(['venture.payment.record', { invoiceId: 'inv-0039', amount: '26200', receivedOn: expect.any(String), method: 'cheque' }]));
    await click(await within(panel).findByRole('button', { name: 'Back to the invoice' }));
    const invoice = await sheet();
    expect(await within(invoice).findByText(/cheque, waiting to clear/)).toBeTruthy();
    expect(within(invoice).getByText('A cheque is waiting to clear. Mark it cleared once it is in your bank.')).toBeTruthy();
    await click(within(invoice).getAllByRole('button', { name: 'Mark cleared' })[0]!);
    expect(within(invoice).getByText('Mark this cheque cleared? It counts as received from today.')).toBeTruthy();
    expect(calls.map(([method]) => method)).not.toContain('venture.payment.clear');
    await click(within(invoice).getAllByRole('button', { name: 'Mark cleared' }).at(-1)!);
    await waitFor(() => expect(calls.some(([method]) => method === 'venture.payment.clear')).toBe(true));
    assertInkRules(invoice);
  });

  it('the TDS the client deducted is one step away, sent as typed, and the payment then names its section', async () => {
    const { calls } = await start('#/money/invoices?sheet=payment:inv-0039');
    const panel = await sheet();
    await type('Amount received', '23580', panel);
    await click(within(panel).getByText('The client deducted TDS'));
    await type('TDS section', '194J', panel);
    await type('TDS amount', '2620', panel);
    await click(within(panel).getByRole('button', { name: 'Record payment' }));
    expect(within(panel).getByText('With TDS of 2620 INR under 194J.')).toBeTruthy();
    await click(within(panel).getByRole('button', { name: 'Record' }));
    await waitFor(() => expect(calls).toContainEqual(['venture.payment.record', expect.objectContaining({ amount: '23580', tds: { section: '194J', amount: '2620' } })]));
    await click(await within(panel).findByRole('button', { name: 'Back to the invoice' }));
    const invoice = await sheet();
    expect(await within(invoice).findByText("TDS under 194J, to be shown on the client's TDS certificate")).toBeTruthy();
  });

  it('a credit note is asked for after a second ask, as typed with the invoice digest, and then waits on Today with its amount proved', async () => {
    const { calls, engine } = await start('#/money/invoices?sheet=invoice:inv-0039');
    const panel = await sheet();
    await click(await within(panel).findByRole('button', { name: 'Ask for a credit note' }));
    await type('Credit amount', '500', panel);
    await type('Reason', 'Episode went out a day late', panel);
    await click(within(panel).getAllByRole('button', { name: 'Ask for a credit note' }).at(-1)!);
    expect(within(panel).getByText('Ask for a credit note of 500 INR on INV-0039? It waits on Today for you to issue it.')).toBeTruthy();
    expect(calls.map(([method]) => method)).not.toContain('venture.credit.issue');
    await click(within(panel).getByRole('button', { name: 'Ask for it' }));
    await waitFor(() => expect(calls).toContainEqual(['venture.credit.issue', { invoiceId: 'inv-0039', amount: '500', reason: 'Episode went out a day late', digest: expect.any(String) }]));
    expect(await within(panel).findByText('It waits on Today for you to issue it.')).toBeTruthy();
    const today = await engine.request('venture.queue.list', { scope: 'current' }) as { rows: { id: string }[] };
    expect(today.rows.some((row) => row.id === 'credit:cn-1:open')).toBe(true);
    // The note lists as waiting, with the way to Today.
    const note = (await within(panel).findByText('Waiting on Today')).closest('li') as HTMLElement;
    // 4J20: its amount, with the receipt that names it.
    expect(note.textContent).toContain('₹500.00');
    expect(within(note).getByRole('button', { name: receiptMark('credit-note:cn-1') })).toBeTruthy();
    assertInkRules(panel);
  });

  it('an amount with more places than the currency has goes as typed and the engine refuses it, in its words', async () => {
    const { calls } = await start('#/money/invoices?sheet=invoice:inv-0039');
    const panel = await sheet();
    await click(await within(panel).findByRole('button', { name: 'Ask for a credit note' }));
    await type('Credit amount', '500.555', panel);
    await type('Reason', 'Late', panel);
    await click(within(panel).getAllByRole('button', { name: 'Ask for a credit note' }).at(-1)!);
    await click(within(panel).getByRole('button', { name: 'Ask for it' }));
    await waitFor(() => expect(calls).toContainEqual(['venture.credit.issue', expect.objectContaining({ amount: '500.555' })]));
    expect(await within(panel).findByText(/^Couldn't ask for it: /)).toBeTruthy();
  });
});

describe('Money w4: invoices that repeat', () => {
  it('lists none, then sets one up from a client, an offer and how often; it is drafted each time, never issued by itself', async () => {
    const { calls } = await start('#/money/invoices');
    // Simple first: one step away, in a fold under the invoices.
    const fold = (await screen.findByText('Invoices that repeat', { selector: 'summary' })).closest('details') as HTMLDetailsElement;
    expect(fold.open).toBe(false);
    await click(fold.querySelector('summary')!);
    // Named once, by its summary.
    expect(screen.queryByRole('region', { name: 'Invoices that repeat' })).toBeNull();
    const section = fold;
    expect(within(section).getByText('No invoice repeats yet.')).toBeTruthy();
    expect(within(section).getByText(/Chausar never issues one by itself/)).toBeTruthy();
    await click(await within(section).findByRole('button', { name: 'Repeat an invoice' }));
    await click(within(section).getByRole('button', { name: 'Repeat it' }));
    await waitFor(() => expect(calls).toContainEqual(['venture.invoice.recurring', expect.objectContaining({ clientId: expect.any(String), offerId: 'offer_sponsor', frequency: 'monthly' })]));
    expect(await within(section).findByText(/^Sponsor slot for .+, every month$/)).toBeTruthy();
  });
});

describe('Money w4: bills', () => {
  it('a business not registered for GST adds a bill with no GST fields; the open bill shows under what bills owe, with its receipt', async () => {
    const { calls } = await start('#/money/bills');
    await click(await screen.findByRole('button', { name: 'Add a bill' }));
    const add = await screen.findByRole('region', { name: 'Add a bill' });
    expect(within(add).queryByLabelText('Tax rate')).toBeNull();
    expect(within(add).queryByLabelText('Tax name')).toBeNull();
    await type('Who it is from', 'Cloud Host', add);
    await type('Amount', '1,180', add);
    await click(within(add).getByRole('button', { name: 'Add bill' }));
    await waitFor(() => expect(calls).toContainEqual(['venture.bills.add', expect.objectContaining({
      vendor: 'Cloud Host', recurring: null, lines: [{ description: 'Cloud Host', amount: '1,180', taxName: '', taxRate: '0' }],
    })]));
    const row = await waitFor(() => rowOf('Cloud Host'));
    expect(within(row).getByText('To pay')).toBeTruthy();
    // 4J20: what is left on the bill, with the receipt of its balance.
    expect(row.textContent).toContain('₹1,180.00');
    expect(within(row).getByRole('button', { name: receiptMark(/^R-/) })).toBeTruthy();
    expect(screen.getByText('Owed on bills')).toBeTruthy();
    assertInkRules();
    assertFiguresProved();
  });

  it('paying a bill asks again with what was typed, then sends it as typed', async () => {
    const { calls } = await start('#/money/bills', {
      before: async (engine) => { await engine.request('venture.bills.add', { vendor: 'Cloud Host', billDate: '2026-10-01', dueDate: '2026-10-30', lines: [{ description: 'Hosting', amountMinor: '118000', taxName: '', taxRateBps: '0' }] }); },
    });
    const row = await waitFor(() => rowOf('Cloud Host'));
    await click(within(row).getByRole('button', { name: 'Record payment' }));
    await type('Amount you paid', '1180', row);
    await click(within(row).getAllByRole('button', { name: 'Record payment' }).at(-1)!);
    expect(within(row).getByText(/^Record 1180 INR paid to Cloud Host on /)).toBeTruthy();
    await click(within(row).getByRole('button', { name: 'Record' }));
    await waitFor(() => expect(calls).toContainEqual(['venture.bills.pay', expect.objectContaining({ amount: '1180', method: 'bank-transfer' })]));
    expect(await waitFor(() => within(rowOf('Cloud Host')).getByText('Paid'))).toBeTruthy();
  });

  it('a business registered for GST is asked the tax name and rate, sent as typed', async () => {
    const { calls } = await start('#/money/bills', { business: 'ledgerline' });
    await click(await screen.findByRole('button', { name: 'Add a bill' }));
    const add = await screen.findByRole('region', { name: 'Add a bill' });
    await within(add).findByLabelText('Tax rate');
    await type('Who it is from', 'Office supplies', add);
    await type('Amount', '1000', add);
    await type('Tax name', 'IGST', add);
    await type('Tax rate', '18', add);
    await click(within(add).getByRole('button', { name: 'Add bill' }));
    await waitFor(() => expect(calls).toContainEqual(['venture.bills.add', expect.objectContaining({ lines: [{ description: 'Office supplies', amount: '1000', taxName: 'IGST', taxRate: '18' }] })]));
  });
});

describe('Money w4: margins per client', () => {
  it('each client invoiced before tax with its receipt; without a rupee rate the spend and margin say Not counted, and why', async () => {
    // The sample has the owner's rupee rate (4Z3); without one, as here, the spend cannot be counted in rupees.
    const { calls } = await start('#/money/margins', { before: async (engine) => { await engine.request('venture.spend.policy.set', { inrPerUsd: null }); } });
    const section = await screen.findByRole('region', { name: 'Margins in October 2026' });
    await waitFor(() => expect(calls).toContainEqual(['venture.money.margins', { month: '2026-10' }]));
    const row = await within(section).findByRole('row', { name: /Boat Audio/ });
    expect(within(row).getByRole('button', { name: receiptMark(/^R-/) })).toBeTruthy();
    expect(within(row).getAllByText('Not counted')).toHaveLength(2);
    expect(section.textContent).toContain('The AI and tool spend is not counted: no rupee rate set.');
    assertInkRules();
    assertFiguresProved();
  });
});

describe('Money w4: the spend meter and the limit sheet', () => {
  it('the meter says how much of the month\'s limit is used, with the month\'s spend receipt', async () => {
    await start('#/money/spend', { before: async (engine) => { await engine.request('venture.spend.policy.set', { capUsd: '1.00' }); } });
    const meter = await screen.findByRole('region', { name: "This month's limit" });
    expect(await within(meter).findByText("71% of this month's limit used")).toBeTruthy();
    expect(within(meter).getByRole('button', { name: receiptMark('R-0431') })).toBeTruthy();
    // A token-styled bar (no native meter colours): its length is the engine's share, the accent while there is room.
    const bar = within(meter).getByRole('meter');
    expect(bar.getAttribute('aria-valuenow')).toBe('719');
    expect(meter.querySelector('meter')).toBeNull();
    expect(bar.querySelector('rect[data-state="room"]')?.getAttribute('width')).toBe('719');
    expect(within(meter).getByText('Starts again on 1 Nov')).toBeTruthy();
    expect(within(meter).queryByRole('button', { name: 'What can I do?' })).toBeNull();
  });

  it('once the limit is used up, the limit sheet offers raise it or wait until the month starts again, and no credits', async () => {
    await start('#/money/spend', { before: async (engine) => { await engine.request('venture.spend.policy.set', { capUsd: '0.50' }); } });
    const meter = await screen.findByRole('region', { name: "This month's limit" });
    await click(await within(meter).findByRole('button', { name: 'What can I do?' }));
    expect(window.location.hash).toContain('sheet=limit%3Abusiness');
    const panel = await sheet();
    expect(await within(panel).findByText("This month's AI limit is used up. Nothing more is spent until you raise it or the month ends.")).toBeTruthy();
    expect(within(panel).getByRole('link', { name: 'Raise the limit' }).getAttribute('href')).toBe('#/money/spend');
    expect(within(panel).getByText('Wait until 1 Nov')).toBeTruthy();
    expect(within(panel).queryByRole('link', { name: 'Connect another key' })).toBeNull();
    expect(within(panel).getByText('You pay for AI directly. There is nothing to top up in Chausar.')).toBeTruthy();
    expect(panel.textContent).not.toMatch(/credits? to buy|top up now|buy credits/i);
  });
});

describe('Money w4: the accountant', () => {
  it('the business menu offers Invite your accountant after the run controls; it makes a read-only month of books, which can be taken back', async () => {
    const { calls } = await start('#/today');
    await click((await screen.findAllByRole('button', { name: /Lumen Studio/ }))[0]!);
    const menu = await screen.findByRole('dialog', { name: /Lumen Studio/ });
    const items = within(menu).getAllByRole('link').map((link) => link.textContent);
    expect(items.at(-1)).toBe('Invite your accountant');
    await click(within(menu).getByRole('link', { name: 'Invite your accountant' }));
    await act(async () => { window.location.hash = '#/money?sheet=accountant:books'; window.dispatchEvent(new HashChangeEvent('hashchange')); });
    const panel = await sheet();
    expect(within(panel).getByText("It shows that month's invoices and payments. Nothing else.")).toBeTruthy();
    await click(within(panel).getByRole('button', { name: 'Make the link' }));
    await waitFor(() => expect(calls).toContainEqual(['venture.share.create', { kind: 'books', month: '2026-10' }]));
    // On this computer the engine keeps the link but has no public address, and says so.
    expect(await within(panel).findByText(/open only on the hosted Chausar with a public address/)).toBeTruthy();
    await click(within(panel).getByRole('button', { name: 'Take it back' }));
    await waitFor(() => expect(calls.some(([method]) => method === 'venture.share.revoke')).toBe(true));
    expect(await within(panel).findByText('The link no longer opens.')).toBeTruthy();
    assertOnePrimary(panel);
  });
});

describe('Money w4: a payment split across invoices', () => {
  it('one invoice by default; Split across invoices, one step away, sends each part as typed and no invoice of its own', async () => {
    const { calls } = await start('#/money/invoices?sheet=payment:inv-0039', {
      before: async (engine) => {
        const draft = await engine.request('venture.invoice.prepare', { orderId: 'o-boat-14' }) as { invoice: { id: string; digest: string } };
        await engine.request('venture.invoice.issue', { invoiceId: draft.invoice.id, digest: draft.invoice.digest });
      },
    });
    const panel = await sheet();
    const fold = within(panel).getByText('Split across invoices').closest('details') as HTMLDetailsElement;
    expect(fold.open).toBe(false);
    await type('Amount received', '56200', panel);
    await act(async () => { fold.open = true; fold.dispatchEvent(new Event('toggle')); });
    // Nothing typed into a part yet: Record waits.
    expect((within(panel).getByRole('button', { name: 'Record payment' }) as HTMLButtonElement).disabled).toBe(true);
    await type('For INV-0039', '26200', panel);
    await within(panel).findByLabelText('For INV-0042');
    await type('For INV-0042', '30000', panel);
    // A split payment carries no TDS: the TDS fold stays, its fields kept as typed but closed to typing while split.
    expect((within(panel).getByLabelText('TDS section') as HTMLInputElement).disabled).toBe(true);
    expect(within(panel).getByText('A split payment carries no TDS. Close Split to keep what you typed here.')).toBeTruthy();
    await click(within(panel).getByRole('button', { name: 'Record payment' }));
    expect(within(panel).getByText(/split across 2 invoices\? This can't be undone\.$/)).toBeTruthy();
    // Each part as typed, like every other second ask.
    expect(within(panel).getByText('For INV-0039: 26200 INR')).toBeTruthy();
    expect(within(panel).getByText('For INV-0042: 30000 INR')).toBeTruthy();
    await click(within(panel).getByRole('button', { name: 'Record' }));
    await waitFor(() => expect(calls).toContainEqual(['venture.payment.record', {
      amount: '56200', receivedOn: expect.any(String), method: 'bank-transfer',
      allocations: [{ invoiceId: 'inv-0039', amount: '26200' }, { invoiceId: expect.stringMatching(/^inv-draft-/), amount: '30000' }],
    }]));
    expect(await within(panel).findByText('Payment recorded.')).toBeTruthy();
  });
});
