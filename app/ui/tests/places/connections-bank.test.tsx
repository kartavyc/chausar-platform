import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';

/**
 * Connections > Bank account (Ink v2 wave 2, 2D): the sheet lists each account with its consent line, Renew and Stop,
 * the engine's no-provider line, the alert rules in the engine's words with where alerts go (never the address), and
 * the ledger with each row's classification and its Record payment, Add as cost and Skip buttons. Every figure and line
 * is the engine's own; Ink adds none and works none out.
 */
function start(engine = new FakeEngine(), language: 'en' | 'hi' = 'en') {
  window.location.hash = '#/connections';
  render(<App client={createFakeClient(engine)} language={language} />);
  return engine;
}
async function openSheet() {
  const card = (await screen.findByRole('button', { name: 'Bank account (read only)' })).closest('li')!;
  // One import path: the card's one bank button opens the bank account sheet, with the import inside it.
  expect(within(card).queryByRole('button', { name: 'Open bank account' })).toBeNull();
  fireEvent.click(within(card).getByRole('button', { name: 'Import a statement' }));
  await act(async () => { window.dispatchEvent(new HashChangeEvent('hashchange')); });
  const sheet = await screen.findByRole('complementary', { name: 'Bank account' });
  await waitFor(() => expect(within(sheet).getByText('TRANSFER TO SAVINGS')).toBeTruthy());
  return sheet;
}
const rowOf = (sheet: HTMLElement, description: string) => within(sheet).getByText(description).closest('[data-bank-row]') as HTMLElement;
const accountOf = (sheet: HTMLElement, label: string) => within(sheet).getByRole('heading', { level: 3, name: label }).closest('[data-bank-account]') as HTMLElement;
const callsOf = (spy: { mock: { calls: unknown[][] } }, method: string) => spy.mock.calls.filter((call) => call[0] === method).map((call) => call[1]);

describe('Connections > Bank account', () => {
  it("lists each account's consent line, the no-provider line and every row as the engine classified it", async () => {
    start();
    const sheet = await openSheet();
    expect(within(sheet).getByText('No bank provider is linked yet, so Chausar reads only the statement files you import.')).toBeTruthy();
    expect(within(accountOf(sheet, 'HDFC current')).getByText('Bank access ends on 13 Jan 2027, in 82 days.')).toBeTruthy();
    expect(within(accountOf(sheet, 'SBI savings')).getByText('No bank access given. Statements you import still work.')).toBeTruthy();
    expect(within(sheet).getByText('7 transactions in 2 accounts. 2 transactions move between your own accounts, so they are not income or spending. 1 transaction looks like an invoice payment.')).toBeTruthy();

    const transfer = rowOf(sheet, 'TRANSFER TO SAVINGS');
    expect(transfer.textContent).toContain('Between your own accounts');
    expect(transfer.textContent).toContain('Out ₹20,000.00');
    // The engine's display date, never the stored ISO date.
    expect(transfer.textContent).toContain('03 Oct 2026');
    expect(transfer.textContent).not.toContain('2026-10-03');
    expect(within(transfer).queryByRole('button', { name: 'Record payment' })).toBeNull();
    expect(within(transfer).queryByRole('button', { name: 'Add as cost' })).toBeNull();

    const payment = rowOf(sheet, 'NEFT/INV-0039/BOAT AUDIO');
    expect(payment.textContent).toContain('Looks like an invoice payment');
    expect(payment.textContent).toContain('In ₹26,200.00');
    expect(payment.textContent).toContain('Pays INV-0039 in full.');
    expect(within(payment).getByRole('button', { name: 'Record payment' })).toBeTruthy();
    expect(within(payment).queryByRole('button', { name: 'Add as cost' })).toBeNull();

    const rent = rowOf(sheet, 'OFFICE RENT OCTOBER');
    expect(rent.textContent).toContain('Money out');
    expect(within(rent).getByRole('button', { name: 'Add as cost' })).toBeTruthy();
    expect(within(rent).getByRole('button', { name: 'Skip' })).toBeTruthy();
    expect(within(rent).queryByRole('button', { name: 'Record payment' })).toBeNull();
  });

  it("Record payment, Add as cost and Skip call venture.bank.apply once and show the engine's line", async () => {
    const engine = start();
    const sheet = await openSheet();
    const spy = vi.spyOn(engine, 'request');
    const payment = rowOf(sheet, 'NEFT/INV-0039/BOAT AUDIO');
    await act(async () => { fireEvent.click(within(payment).getByRole('button', { name: 'Record payment' })); });
    await waitFor(() => expect(within(sheet).getByText('Recorded ₹26,200.00 as a payment of INV-0039.')).toBeTruthy());
    expect(callsOf(spy, 'venture.bank.apply')).toEqual([{ transactionId: 'bankaccount-hdfc:ref_2c3d4e5f60718293', as: 'payment', invoiceId: 'inv-0039' }]);
    expect(rowOf(sheet, 'NEFT/INV-0039/BOAT AUDIO').textContent).toContain('In your books');

    await act(async () => { fireEvent.click(within(rowOf(sheet, 'OFFICE RENT OCTOBER')).getByRole('button', { name: 'Add as cost' })); });
    await waitFor(() => expect(within(sheet).getByText('Added ₹25,000.00 to your costs.')).toBeTruthy());
    await act(async () => { fireEvent.click(within(rowOf(sheet, 'UPI-CAFE BLUE')).getByRole('button', { name: 'Skip' })); });
    await waitFor(() => expect(rowOf(sheet, 'UPI-CAFE BLUE').textContent).toContain('Skipped'));
    expect(callsOf(spy, 'venture.bank.apply').slice(1)).toEqual([
      { transactionId: 'bankaccount-hdfc:fp_3d4e5f6071829304', as: 'cost' },
      { transactionId: 'bankaccount-hdfc:fp_4e5f607182930415', as: 'skip' },
    ]);
    // A decided row offers nothing more.
    expect(within(rowOf(sheet, 'OFFICE RENT OCTOBER')).queryByRole('button', { name: 'Skip' })).toBeNull();
  });

  it('money in with no matched invoice: the owner picks one of the open invoices the engine lists, and the row shows the receipt', async () => {
    const engine = start();
    const sheet = await openSheet();
    const spy = vi.spyOn(engine, 'request');
    const part = rowOf(sheet, 'IMPS BOAT AUDIO PART');
    expect(part.textContent).toContain('Money in');
    const record = within(part).getByRole('button', { name: 'Record payment' }) as HTMLButtonElement;
    expect(record.disabled).toBe(true);
    // The options are the engine's open invoices, its numbers, names and balances as it wrote them.
    const pick = await waitFor(() => {
      const select = within(part).getByLabelText('Invoice it pays') as HTMLSelectElement;
      expect([...select.options].map((option) => option.textContent)).toContain('INV-0039, Boat Audio, ₹26,200.00 open');
      return select;
    });
    fireEvent.change(pick, { target: { value: 'inv-0039' } });
    await act(async () => { fireEvent.click(within(part).getByRole('button', { name: 'Record payment' })); });
    await waitFor(() => expect(within(sheet).getByText('Recorded ₹5,000.00 as a payment of INV-0039.')).toBeTruthy());
    expect(callsOf(spy, 'venture.bank.apply')).toEqual([{ transactionId: 'bankaccount-hdfc:fp_5f60718293041526', as: 'payment', invoiceId: 'inv-0039' }]);
    const after = rowOf(sheet, 'IMPS BOAT AUDIO PART');
    expect(after.textContent).toContain('In your books');
    expect(after.querySelector('[data-receipt]')).not.toBeNull();
  });

  it("an amount over the picked invoice's balance is refused in the engine's words; Skip still works on that row", async () => {
    const engine = start();
    const sheet = await openSheet();
    const spy = vi.spyOn(engine, 'request');
    const large = rowOf(sheet, 'NEFT LARGE CREDIT');
    const pick = await waitFor(() => {
      const select = within(large).getByLabelText('Invoice it pays') as HTMLSelectElement;
      expect(select.options.length).toBeGreaterThan(1);
      return select;
    });
    fireEvent.change(pick, { target: { value: 'inv-0039' } });
    await act(async () => { fireEvent.click(within(large).getByRole('button', { name: 'Record payment' })); });
    await waitFor(() => expect(within(rowOf(sheet, 'NEFT LARGE CREDIT')).getByText("Couldn't record this: This is more than the balance of ₹26,200.00.")).toBeTruthy());
    expect(rowOf(sheet, 'NEFT LARGE CREDIT').querySelector('[data-receipt]')).toBeNull();
    await act(async () => { fireEvent.click(within(rowOf(sheet, 'NEFT LARGE CREDIT')).getByRole('button', { name: 'Skip' })); });
    await waitFor(() => expect(rowOf(sheet, 'NEFT LARGE CREDIT').textContent).toContain('Skipped'));
    expect(callsOf(spy, 'venture.bank.apply')).toEqual([
      { transactionId: 'bankaccount-hdfc:fp_60718293041526a7', as: 'payment', invoiceId: 'inv-0039' },
      { transactionId: 'bankaccount-hdfc:fp_60718293041526a7', as: 'skip' },
    ]);
  });

  it("an engine refusal on a row shows the engine's words on that row", async () => {
    const engine = start();
    const sheet = await openSheet();
    vi.spyOn(engine, 'request').mockImplementation(async (method: string) => {
      if (method === 'venture.bank.apply') throw Object.assign(new Error('This invoice is already paid in full.'), { code: 'PAYMENT_TOO_LARGE' });
      throw new Error(`unexpected ${method}`);
    });
    const payment = rowOf(sheet, 'NEFT/INV-0039/BOAT AUDIO');
    await act(async () => { fireEvent.click(within(payment).getByRole('button', { name: 'Record payment' })); });
    await waitFor(() => expect(within(payment).getByText("Couldn't record this: This invoice is already paid in full.")).toBeTruthy());
  });

  it("Renew and Stop call venture.bank.consent for that account and show the engine's line", async () => {
    const engine = start();
    const sheet = await openSheet();
    const spy = vi.spyOn(engine, 'request');
    const sbi = accountOf(sheet, 'SBI savings');
    fireEvent.change(within(sbi).getByLabelText('Days'), { target: { value: '30' } });
    await act(async () => { fireEvent.click(within(sbi).getByRole('button', { name: 'Renew' })); });
    await waitFor(() => expect(within(accountOf(sheet, 'SBI savings')).getByText(/^Bank access ends on \d{2} [A-Z][a-z]{2} \d{4}, in 30 days\.$/)).toBeTruthy());
    await act(async () => { fireEvent.click(within(accountOf(sheet, 'SBI savings')).getByRole('button', { name: 'Stop' })); });
    await waitFor(() => expect(within(accountOf(sheet, 'SBI savings')).getByText(/^You stopped bank access on \d{2} [A-Z][a-z]{2} \d{4}\.$/)).toBeTruthy());
    expect(callsOf(spy, 'venture.bank.consent')).toEqual([{ account: 'SBI savings', days: 30 }, { account: 'SBI savings', revoke: true }]);
  });

  it('alert rules: the engine\'s words and where alerts go, never the address; a new rule sends the typed amount', async () => {
    const engine = start();
    const sheet = await openSheet();
    const hdfc = accountOf(sheet, 'HDFC current');
    await waitFor(() => expect(within(hdfc).getByText('When ₹50,000.00 or more goes out in one payment.')).toBeTruthy());
    expect(within(hdfc).getByText('Alerts show on Today only. No address is set, so nothing is sent.')).toBeTruthy();

    const spy = vi.spyOn(engine, 'request');
    // Built here, so no fixture holds a string shaped like a real webhook.
    const address = ['https://hooks', 'example', 'com/alerts'].join('.');
    fireEvent.change(within(hdfc).getByLabelText('Alert when'), { target: { value: 'balance-below' } });
    fireEvent.change(within(hdfc).getByLabelText('Amount'), { target: { value: '10,000' } });
    fireEvent.change(within(hdfc).getByLabelText('Alert address (https)'), { target: { value: address } });
    await act(async () => { fireEvent.click(within(hdfc).getByRole('button', { name: 'Save alerts' })); });
    await waitFor(() => expect(within(accountOf(sheet, 'HDFC current')).getByText('When the balance falls below ₹10,000.00.')).toBeTruthy());
    expect(callsOf(spy, 'venture.bank.alerts.set')).toEqual([{
      account: 'HDFC current', rules: [{ kind: 'large-debit', minor: '5000000' }, { kind: 'balance-below', amount: '10,000' }], alertAddress: address,
    }]);
    const after = accountOf(sheet, 'HDFC current');
    expect(within(after).getByText('Alerts go to the address you set, as a count only. Today shows what each one found.')).toBeTruthy();
    expect(sheet.textContent).not.toContain('hooks.example.com');
    expect((within(after).getByLabelText('Alert address (https)') as HTMLInputElement).value).toBe('');

    // Remove sends the rules that are left; the address stays as it was (left out).
    await act(async () => { fireEvent.click(within(after).getAllByRole('button', { name: 'Remove' })[0]!); });
    await waitFor(() => expect(within(accountOf(sheet, 'HDFC current')).queryByText('When ₹50,000.00 or more goes out in one payment.')).toBeNull());
    expect(callsOf(spy, 'venture.bank.alerts.set')[1]).toEqual({ account: 'HDFC current', rules: [{ kind: 'balance-below', minor: '1000000' }] });

    // Stop sending clears the address.
    await act(async () => { fireEvent.click(within(accountOf(sheet, 'HDFC current')).getByRole('button', { name: 'Stop sending alerts' })); });
    await waitFor(() => expect(within(accountOf(sheet, 'HDFC current')).getByText('Alerts show on Today only. No address is set, so nothing is sent.')).toBeTruthy());
    expect(callsOf(spy, 'venture.bank.alerts.set')[2]).toEqual({ account: 'HDFC current', rules: [{ kind: 'balance-below', minor: '1000000' }], alertAddress: null });
  });

  it("an address the engine refuses shows the engine's words and keeps what was set", async () => {
    start();
    const sheet = await openSheet();
    const hdfc = accountOf(sheet, 'HDFC current');
    await waitFor(() => expect(within(hdfc).getByText('When ₹50,000.00 or more goes out in one payment.')).toBeTruthy());
    fireEvent.change(within(hdfc).getByLabelText('Alert address (https)'), { target: { value: 'https://10.0.0.7/hook' } });
    await act(async () => { fireEvent.click(within(hdfc).getByRole('button', { name: 'Save alerts' })); });
    await waitFor(() => expect(within(accountOf(sheet, 'HDFC current')).getByText("Couldn't save alerts: This address points inside your computer or your network, so Chausar will not open it.")).toBeTruthy());
    expect(within(accountOf(sheet, 'HDFC current')).getByText('Alerts show on Today only. No address is set, so nothing is sent.')).toBeTruthy();
  });

  it('a statement can be imported from inside the sheet', async () => {
    const engine = start();
    const sheet = await openSheet();
    const spy = vi.spyOn(engine, 'request');
    const csv = 'Date,Amount,Description\n2026-10-21,-1200.00,Office rent\n';
    fireEvent.change(within(sheet).getByLabelText('Account'), { target: { value: 'HDFC current' } });
    fireEvent.change(within(sheet).getByLabelText('Statement file (CSV)'), { target: { files: [new File([csv], 'october.csv', { type: 'text/csv' })] } });
    await act(async () => { fireEvent.click(within(sheet).getByRole('button', { name: 'Import' })); });
    await waitFor(() => expect(within(sheet).getByText('Added 1 transaction to HDFC current.')).toBeTruthy());
    expect(callsOf(spy, 'venture.bank.import')).toEqual([{ csv, account: 'HDFC current' }]);
  });

  it('shows in Hindi with every new string translated', async () => {
    window.location.hash = '#/connections?sheet=bank:bank-account';
    render(<App client={createFakeClient(new FakeEngine())} language="hi" />);
    const sheet = await screen.findByRole('complementary');
    await waitFor(() => expect(within(sheet).getByText('TRANSFER TO SAVINGS')).toBeTruthy());
    expect(sheet.textContent).not.toMatch(/connections\.bankSheet\./);
    expect(sheet.textContent).not.toContain('Record payment');
  });
});
