import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { EngineError } from '../../src/engine/types';
import { TAX_WORKINGS } from '../../src/engine/fixtures-extras';
import { assertInkRules } from '../helpers/ink-rules';

type Call = [string, unknown];
type Override = (params: unknown) => unknown;

function start(hash: string, override: Record<string, Override> = {}, engine = new FakeEngine({ now: () => '2026-10-21T11:00:00.000Z' })) {
  window.location.hash = hash;
  const client = createFakeClient(engine);
  const calls: Call[] = [];
  const request = client.request.bind(client);
  client.request = (async (method: string, params?: unknown) => {
    calls.push([method, params]);
    const replace = override[method];
    return replace ? replace(params) : request(method as never, params as never);
  }) as typeof client.request;
  render(<App client={client} language="en" />);
  return { engine, client, calls };
}
const click = async (element: Element) => { await act(async () => { fireEvent.click(element); window.dispatchEvent(new HashChangeEvent('hashchange')); }); };
const main = () => screen.getByRole('main');
const type = async (element: Element, value: string) => { await act(async () => { fireEvent.change(element, { target: { value } }); }); };
const settings = () => screen.getByRole('region', { name: 'Limits and rates' });

const tileOf = (name: string) => screen.findByRole('region', { name });
const ledgerline = async () => {
  const engine = new FakeEngine({ now: () => '2026-10-21T11:00:00.000Z' });
  await engine.request('workspace.open', { folder: 'ledgerline' });
  return engine;
};

describe('Money: books', () => {
  it('shows billed, received and earned for the period, each with its receipt, the engine note and open invoices', async () => {
    const { calls } = start('#/money/books');
    const billed = await tileOf('Billed');
    expect(await within(billed).findByText('₹1,12,400.00')).toBeTruthy();
    expect(within(billed).getByRole('button', { name: 'Receipt R-0401' })).toBeTruthy();
    expect(within(await tileOf('Received')).getByRole('button', { name: 'Receipt R-0402' })).toBeTruthy();
    expect((await tileOf('Earned')).textContent).toContain('₹95,254.24');
    expect(calls).toContainEqual(['venture.books.summary', { period: 'this-month' }]);
    expect(screen.getByText('1 Oct 2026 to 31 Oct 2026')).toBeTruthy();
    expect(screen.getByText('Sample data. Clients pay through links on your site, and you record each payment here.')).toBeTruthy();
    // Each open invoice is a step from its own figures: the books send its balance with no receipt, so none shows here.
    const open = await screen.findByRole('region', { name: 'Open invoices' });
    const item = within(open).getByRole('button', { name: 'Invoice INV-0039' }).closest('li')!;
    expect(item.textContent).toContain('Boat Audio');
    expect(item.textContent).toContain('Due 28 Oct 2026');
    expect(item.textContent).not.toContain('₹');
    assertInkRules();
  });

  it('chooses the period from the engine list and keeps it in the address', async () => {
    const { calls } = start('#/money/books');
    const periods = await screen.findByRole('group', { name: 'Period' });
    const buttons = within(periods).getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['All time', 'This month', 'Last month', 'This year']);
    expect(within(periods).getByRole('button', { name: 'This month' }).getAttribute('aria-pressed')).toBe('true');
    await click(within(periods).getByRole('button', { name: 'This year' }));
    expect(window.location.hash).toBe('#/money/books?period=this-year');
    await waitFor(() => expect(calls).toContainEqual(['venture.books.summary', { period: 'this-year' }]));
    await waitFor(() => expect(within(periods).getByRole('button', { name: 'This year' }).getAttribute('aria-pressed')).toBe('true'));
    expect(await screen.findByText('1 Jan 2026 to 31 Dec 2026')).toBeTruthy();
  });

  it('a business without GST sees no tax working and no GST line at all (simple first)', async () => {
    const { calls } = start('#/money/books');
    await within(await tileOf('Billed')).findByText('₹1,12,400.00');
    await waitFor(() => expect(calls).toContainEqual(['venture.tax.working', {}]));
    await waitFor(() => expect(calls.map(([m]) => m)).toContain('venture.blueprint.get'));
    expect(screen.queryByRole('heading', { name: /Tax working/ })).toBeNull();
    expect(screen.queryByText('Not registered for GST, so there is no GST to work out.')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Tax details' })).toBeNull();
  });

  it('each tax line shows its figure with its receipt, and a working the CA must confirm says so', async () => {
    start('#/money/books', { 'venture.tax.working': () => TAX_WORKINGS.ledgerline }, await ledgerline());
    await click(await screen.findByRole('button', { name: 'Tax details' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Tax working, September 2026' })).toBeTruthy();
    expect(screen.getByText('Needs your CA to confirm')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3, name: 'GST on your sales' })).toBeTruthy();
    const cgst = screen.getAllByText('CGST at 9%')[0]!.closest('li')!;
    expect(cgst.textContent).toContain('₹1,440.00');
    expect(within(cgst).getByRole('button', { name: 'Receipt R-0419' })).toBeTruthy();
    const credit = screen.getByText('Input credit').closest('li')!;
    expect(credit.textContent).toContain('₹0.00');
    expect(credit.querySelector('[data-receipt]')).toBeNull();
    expect(screen.getByText('No purchase bills were uploaded for September.')).toBeTruthy();
  });

  it('marks a figure whose receipt changed after it was made', async () => {
    start('#/money/books', {
      'venture.books.summary': () => ({
        currency: 'INR', period: { from: '2026-10-01', to: '2026-10-31' }, notes: [], openInvoices: [],
        figures: [{ operation: 'billed', label: 'Billed', receiptId: 'R-0401', display: '₹1,12,400.00', stale: true }],
      }),
    });
    expect(await within(await tileOf('Billed')).findByText('changed since')).toBeTruthy();
  });
});

describe('Money: spend', () => {
  it('shows each paid call reserved against settled, says estimate, billed or refused in words, and why a call was refused', async () => {
    start('#/money/spend');
    expect(await screen.findByText('₹60.10 this month (includes estimates)')).toBeTruthy();
    const billed = (await screen.findByText('Model calls for episode 14')).closest('li')!;
    expect(billed.textContent).toContain('Editor');
    expect(billed.textContent).toContain('Reserved ₹45.00');
    expect(billed.textContent).toContain('Settled ₹42.10');
    expect(billed.textContent).toContain('billed');
    expect(within(billed).getByRole('button', { name: 'Receipt R-0412' })).toBeTruthy();
    const estimate = screen.getByText('Title comparison, running').closest('li')!;
    expect(estimate.textContent).toContain('Reserved ₹18.00');
    expect(estimate.textContent).toContain('Not settled yet');
    expect(estimate.textContent).toContain('estimate');
    const refused = screen.getByText('Paid boost for the short').closest('li')!;
    expect(refused.textContent).toContain('Instagram');
    expect(refused.textContent).toContain('No price');
    expect(refused.textContent).toContain('refused');
    expect(refused.textContent).toContain('Instagram has no price on your rate card, so the call was refused.');
    expect(screen.queryByText(/never counted as free/)).toBeNull();
  });

  it('a refused call the engine gave no reason for falls back to the plain note', async () => {
    start('#/money/spend', { 'venture.spend.list': () => ({ rows: [{ id: 'sp9', connector: 'Instagram', label: 'Paid boost', reserved: 'No price', kind: 'refused' }], total: '₹0.00 this month' }) });
    expect((await screen.findByText(/never counted as free/)).textContent).toContain('Limits and rates');
  });

  it('shows each figure and the month in rupees beside the dollars when the engine gives them, with the owner\'s rate', async () => {
    const at = 'at ₹83.50 per $1 (your rate, set 23 Oct 2026)';
    start('#/money/spend', {
      'venture.spend.list': () => ({
        rows: [{ id: 'sp1', connector: 'fal', label: 'Render', reserved: 'USD 1.0000', reservedRupees: `₹83.50 ${at}`, settled: 'USD 0.2500', settledRupees: `₹20.88 ${at}`, kind: 'billed' }],
        total: 'USD 0.2500 this month', totalRupees: `₹20.88 ${at}`,
      }),
    });
    const row = (await screen.findByText('Render')).closest('li')!;
    expect(row.textContent).toContain(`USD 1.0000 · ₹83.50 ${at}`);
    expect(row.textContent).toContain(`USD 0.2500 · ₹20.88 ${at}`);
    expect(main().textContent).toContain(`USD 0.2500 this month · ₹20.88 ${at}`);
  });

  it('the AI spend tile at a glance shows rupees beside the dollars when the engine gives them', async () => {
    const at = 'at ₹83.50 per $1 (your rate, set 23 Oct 2026)';
    start('#/money', { 'venture.money.overview': () => ({ lines: [{ id: 'spent', label: 'AI and tools this month', value: 'USD 0.2500', receiptId: 'R-0412', rupees: `₹20.88 ${at}` }] }) });
    const spend = await tileOf('AI spend this month');
    expect(await within(spend).findByText(`₹20.88 ${at}`)).toBeTruthy();
    expect(within(spend).getByText('USD 0.2500')).toBeTruthy();
  });

  it('says so when there are no paid calls', async () => {
    start('#/money/spend', { 'venture.spend.list': () => ({ rows: [], total: '₹0.00 this month' }) });
    expect(await screen.findByText('No paid calls yet.')).toBeTruthy();
    expect(screen.queryByText(/never counted as free/)).toBeNull();
  });
});

describe('Money: spend settings', () => {
  it('shows the limit, the ask-first figure and the rate card in the engine words, with one quiet Change', async () => {
    start('#/money/spend');
    expect(await within(await waitFor(settings)).findByText('USD 20.0000 a month')).toBeTruthy();
    const region = settings();
    expect(within(region).getByText('Asks you first above USD 2.0000')).toBeTruthy();
    expect(within(region).getByText('USD 3.0000 in and USD 15.0000 out, per million tokens')).toBeTruthy();
    expect(within(region).getByText('Anthropic pricing page, checked 14 Oct 2026')).toBeTruthy();
    expect(within(region).getByRole('button', { name: 'Change' }).dataset.variant).toBe('quiet');
    expect(within(region).queryByRole('textbox')).toBeNull();
  });

  it('takes rupees per US dollar; then the limits show rupees beside the dollars, with the rate and the day it was set', async () => {
    const { calls } = start('#/money/spend');
    await within(await waitFor(settings)).findByText('USD 20.0000 a month');
    expect(within(settings()).queryByText(/per \$1/)).toBeNull();
    await click(within(settings()).getByRole('button', { name: 'Change' }));
    const rate = within(settings()).getByLabelText('Rupees per US dollar') as HTMLInputElement;
    expect([rate.value, rate.inputMode]).toEqual(['', 'decimal']);
    expect(within(settings()).getByText('Your own rate, like 83.50. Spend then shows in rupees too. Leave it empty for dollars only.')).toBeTruthy();
    await type(rate, '83.50');
    await click(within(settings()).getByRole('button', { name: 'Save' }));
    await click(within(settings()).getAllByRole('button', { name: 'Save' }).find((b) => b.hasAttribute('data-confirm'))!);
    expect(calls.find(([m]) => m === 'venture.spend.policy.set')![1]).toMatchObject({ inrPerUsd: '83.50' });
    expect(await within(settings()).findByText('₹1,670.00 at ₹83.50 per $1 (your rate, set 21 Oct 2026)')).toBeTruthy();
    expect(within(settings()).getByText('₹167.00 at ₹83.50 per $1 (your rate, set 21 Oct 2026)')).toBeTruthy();
    expect(within(settings()).getByText('₹83.50 per $1 (your rate, set 21 Oct 2026)')).toBeTruthy();
    await click(within(settings()).getByRole('button', { name: 'Change' }));
    expect((within(settings()).getByLabelText('Rupees per US dollar') as HTMLInputElement).value).toBe('83.50');
  });

  it('asks for every figure in US dollars, never in millionths of a dollar', async () => {
    start('#/money/spend');
    await within(await waitFor(settings)).findByText('USD 20.0000 a month');
    await click(within(settings()).getByRole('button', { name: 'Change' }));
    expect(settings().textContent).not.toMatch(/millionth/i);
    expect(within(settings()).getByText('In US dollars, like 20 or 12.50. Your AI bills in US dollars. Leave it empty for no limit.')).toBeTruthy();
    for (const label of ['Monthly limit', 'Ask me first above', 'Input, per million tokens', 'Output, per million tokens']) {
      expect((within(settings()).getByLabelText(label) as HTMLInputElement).inputMode).toBe('decimal');
    }
  });

  it('sends the figures exactly as typed, an empty one as null and the held rate as it came, only after a second ask', async () => {
    const { calls } = start('#/money/spend');
    await within(await waitFor(settings)).findByText('USD 20.0000 a month');
    await click(within(settings()).getByRole('button', { name: 'Change' }));
    const cap = within(settings()).getByLabelText('Monthly limit') as HTMLInputElement;
    expect(cap.value).toBe('20.00');
    expect((within(settings()).getByLabelText('Ask me first above') as HTMLInputElement).value).toBe('2.00');
    expect((within(settings()).getByLabelText('Input, per million tokens') as HTMLInputElement).value).toBe('3.00');
    await type(cap, '30');
    await type(within(settings()).getByLabelText('Ask me first above'), '');
    await click(within(settings()).getByRole('button', { name: 'Save' }));
    expect(within(settings()).getByText('Save these limits and rates? Paid calls follow them from now on.')).toBeTruthy();
    expect(calls.filter(([m]) => m === 'venture.spend.policy.set')).toEqual([]);
    const confirm = within(settings()).getAllByRole('button', { name: 'Save' }).find((b) => b.hasAttribute('data-confirm'))!;
    confirm.focus();
    await act(async () => { fireEvent.keyDown(confirm, { key: 'a' }); });
    expect(calls.filter(([m]) => m === 'venture.spend.policy.set')).toEqual([]);
    await click(confirm);
    expect(calls.filter(([m]) => m === 'venture.spend.policy.set')).toEqual([['venture.spend.policy.set', {
      capUsd: '30', askFirstUsd: null, inrPerUsd: null,
      rates: [{ item: 'model:anthropic-api', unit: 'per-million-tokens', inputUsdPerMillion: '3.00', outputUsdPerMillion: '15.00', source: 'Anthropic pricing page', checkedOn: '2026-10-14' }],
    }]]);
    expect(await within(settings()).findByText('USD 30.0000 a month')).toBeTruthy();
    expect(within(settings()).getByText('Never asks first')).toBeTruthy();
    expect(within(settings()).getByText('Saved.')).toBeTruthy();
  });

  it('adds a rate per call; the engine writes its price', async () => {
    const { calls } = start('#/money/spend');
    await within(await waitFor(settings)).findByText('USD 20.0000 a month');
    await click(within(settings()).getByRole('button', { name: 'Change' }));
    await click(within(settings()).getByRole('button', { name: 'Add a rate' }));
    const line = within(settings()).getByRole('group', { name: 'New rate' });
    await type(within(line).getByLabelText('What it prices'), 'connector:instagram');
    await act(async () => { fireEvent.change(within(line).getByLabelText('Priced'), { target: { value: 'per-call' } }); });
    await type(within(line).getByLabelText('Price per call'), '0.25');
    await type(within(line).getByLabelText('Where the rate comes from'), 'Meta ads price list');
    await click(within(settings()).getByRole('button', { name: 'Save' }));
    await click(within(settings()).getAllByRole('button', { name: 'Save' }).find((b) => b.hasAttribute('data-confirm'))!);
    const sent = calls.find(([m]) => m === 'venture.spend.policy.set')![1] as { rates: unknown[] };
    expect(sent.rates[1]).toMatchObject({ item: 'connector:instagram', unit: 'per-call', usdPerCall: '0.25', source: 'Meta ads price list' });
    expect(sent.rates[1]).not.toHaveProperty('inputUsdPerMillion');
    expect(sent.rates[1]).not.toHaveProperty('microsPerCall');
    expect(await within(settings()).findByText('USD 0.2500 per call')).toBeTruthy();
  });

  it('shows the engine refusal in its words and keeps the form', async () => {
    start('#/money/spend');
    await within(await waitFor(settings)).findByText('USD 20.0000 a month');
    await click(within(settings()).getByRole('button', { name: 'Change' }));
    await type(within(settings()).getByLabelText('Monthly limit'), '5.001');
    await click(within(settings()).getByRole('button', { name: 'Save' }));
    await click(within(settings()).getAllByRole('button', { name: 'Save' }).find((b) => b.hasAttribute('data-confirm'))!);
    expect(await within(settings()).findByRole('alert')).toBeTruthy();
    expect(within(settings()).getByRole('alert').textContent).toBe("Couldn't save: The monthly limit must be an amount in US dollars with at most two decimals, like 20 or 12.50.");
    expect((within(settings()).getByLabelText('Monthly limit') as HTMLInputElement).value).toBe('5.001');
  });
});

describe('Money: journal', () => {
  it('lists what was sent or changed with its state in words; an unknown outcome says to check before retrying', async () => {
    const { calls } = start('#/money/journal');
    const sent = (await screen.findByText('Send invoice · Mehta Traders')).closest('li')!;
    expect(sent.textContent).toContain('Described');
    expect(sent.textContent).toContain('Waiting for your approval');
    const held = screen.getByText('Hold quote · Iyer & Co').closest('li')!;
    expect(held.textContent).toContain('Approved');
    expect(within(held).getByRole('button', { name: 'Receipt R-0420' })).toBeTruthy();
    const applied = screen.getByText('Record payment · Boat Audio').closest('li')!;
    expect(applied.textContent).toContain('Applied');
    expect(within(applied).getByRole('button', { name: 'Receipt R-0402' })).toBeTruthy();
    expect(screen.getByText('Post · LinkedIn').closest('li')!.textContent).toContain('Rejected');
    const unknown = screen.getByText('Send email · Iyer & Co').closest('li')!;
    expect(unknown.textContent).toContain('Outcome unknown');
    expect(unknown.textContent).toContain('The send timed out.');
    expect(unknown.textContent).toContain('Check before retrying.');
    expect(calls).toContainEqual(['venture.journal.list', { limit: 50 }]);
  });

  it('says so when nothing was sent or changed', async () => {
    start('#/money/journal', { 'venture.journal.list': () => ({ entries: [] }) });
    expect(await screen.findByText('Nothing sent or changed yet.')).toBeTruthy();
  });

  it('says plainly when the engine cannot give the journal', async () => {
    start('#/money/journal', { 'venture.journal.list': () => Promise.reject(new EngineError('METHOD_NOT_ALLOWED', 'This engine has no journal yet.')) });
    expect(await screen.findByText("Couldn't load this: This engine has no journal yet.")).toBeTruthy();
  });

  it('only an unknown outcome offers Resolve; It went out records sent and the row shows what the engine recorded', async () => {
    const { calls } = start('#/money/journal');
    const unknown = (await screen.findByText('Send email · Iyer & Co')).closest('li')!;
    expect(screen.getAllByRole('button', { name: 'Resolve' })).toHaveLength(1);
    expect(within(unknown).queryByRole('button', { name: 'It went out' })).toBeNull();
    await click(within(unknown).getByRole('button', { name: 'Resolve' }));
    expect(unknown.textContent).toContain('Check the other side first. Chausar will not send it again on its own.');
    await click(within(unknown).getByRole('button', { name: 'It went out' }));
    expect(calls).toContainEqual(['venture.journal.resolve', { entryId: 'j5', outcome: 'sent' }]);
    const settled = await waitFor(() => {
      const row = screen.getByText('Send email · Iyer & Co').closest('li')!;
      expect(row.textContent).toContain('Applied');
      return row;
    });
    expect(settled.textContent).toContain('You checked: it happened.');
    expect(settled.textContent).not.toContain('Outcome unknown');
    expect(settled.textContent).not.toContain('Check before retrying.');
    expect(screen.queryAllByRole('button', { name: 'Resolve' })).toHaveLength(0);
  });

  it('It did not go out records not-sent; Not now closes the question and sends nothing', async () => {
    const { calls } = start('#/money/journal');
    const unknown = (await screen.findByText('Send email · Iyer & Co')).closest('li')!;
    await click(within(unknown).getByRole('button', { name: 'Resolve' }));
    await click(within(unknown).getByRole('button', { name: 'Not now' }));
    expect(within(unknown).queryByRole('button', { name: 'It did not go out' })).toBeNull();
    expect(calls.filter(([m]) => m === 'venture.journal.resolve')).toEqual([]);
    await click(within(unknown).getByRole('button', { name: 'Resolve' }));
    await click(within(unknown).getByRole('button', { name: 'It did not go out' }));
    expect(calls).toContainEqual(['venture.journal.resolve', { entryId: 'j5', outcome: 'not-sent' }]);
    await waitFor(() => expect(screen.getByText('Send email · Iyer & Co').closest('li')!.textContent).toContain('Rejected'));
    expect(screen.getByText('Send email · Iyer & Co').closest('li')!.textContent).toContain('You checked: it did not happen. Propose it again to do it.');
  });

  it('an engine refusal shows in its words and the row keeps Resolve', async () => {
    start('#/money/journal', { 'venture.journal.resolve': () => Promise.reject(new EngineError('JOURNAL_NOT_UNKNOWN', 'This one already has an outcome.')) });
    const unknown = (await screen.findByText('Send email · Iyer & Co')).closest('li')!;
    await click(within(unknown).getByRole('button', { name: 'Resolve' }));
    await click(within(unknown).getByRole('button', { name: 'It went out' }));
    expect(await within(unknown).findByText("Couldn't record it: This one already has an outcome.")).toBeTruthy();
    expect(unknown.textContent).toContain('Outcome unknown');
    expect(within(unknown).getByRole('button', { name: 'Resolve' })).toBeTruthy();
  });
});
