import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';

// C5 task 17: the monthly pack. Today's row offers Send to my CA (the sheet, on that month) and Show in folder; the sheet
// holds the switch for the standing order; once sent, the row leaves.
const settle = () => act(async () => { for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0)); });
const NOW = '2026-12-01T05:00:00.000Z';
const row = {
  id: 'ca-pack:2026-11:capack_1', businessId: 'main', businessName: 'Ledger Cafe Books', kind: 'notice' as const, createdAt: NOW,
  title: "November's pack for your CA is ready", line: '2 invoices. It is saved on this computer. Nothing goes to your CA until you send it.',
  notice: { probe: 'ca-pack' as const, severity: 'low' as const, link: '#/money?sheet=accountant:2026-11', file: 'chausar-main-ca-2026-11.csv' },
  actions: [{ id: 'later' as const, label: 'Not now', primary: false }, { id: 'show-file' as const, label: 'Show in folder', primary: false }, { id: 'open' as const, label: 'Send to my CA', primary: true }],
};

describe('the monthly pack for the CA', () => {
  it('Today: Show in folder shows the file; Send to my CA opens the sheet on that month; sent, the row leaves', async () => {
    window.location.hash = '#/today';
    const engine = new FakeEngine({ now: () => NOW, queue: [row] });
    await engine.request('venture.accountant.set', { email: 'ca@example.com' });
    const client = createFakeClient(engine);
    const showExport = vi.fn(async () => undefined);
    const sharePack = vi.fn(async () => ({ how: 'email' as const, opened: 'draft' as const, file: 'x.csv', to: 'ca@example.com' }));
    client.showExport = showExport;
    client.sharePack = sharePack;
    render(<App client={client} language="en" />);
    await screen.findByText("November's pack for your CA is ready");

    fireEvent.click(screen.getByRole('button', { name: 'Show in folder' }));
    expect(showExport).toHaveBeenCalledWith('chausar-main-ca-2026-11.csv');

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send to my CA' })); });
    await settle();
    expect(window.location.hash).toContain('sheet=accountant:2026-11');
    const sheet = await screen.findByRole('complementary', { name: /accountant/i });
    await waitFor(() => expect((within(sheet).getByLabelText('Month') as HTMLSelectElement).value).toBe('2026-11'));
    await act(async () => { fireEvent.click(await within(sheet).findByRole('button', { name: 'Send to my CA' })); });
    await act(async () => { fireEvent.click(within(sheet).getByRole('button', { name: 'Open the draft' })); });
    await settle();
    expect(sharePack).toHaveBeenCalledWith('2026-11', 'email');
    await waitFor(async () => expect(((await engine.request('venture.queue.list', {})) as { rows: { id: string }[] }).rows.some((one) => one.id.startsWith('ca-pack:'))).toBe(false));
  });

  it('the sheet holds the switch: it says what it does, and turns off again', async () => {
    window.location.hash = '#/money?sheet=accountant:books';
    const engine = new FakeEngine({ now: () => NOW });
    render(<App client={createFakeClient(engine)} language="en" />);
    const sheet = await screen.findByRole('complementary', { name: /accountant/i });
    const on = await within(sheet).findByRole('checkbox', { name: 'Save the month for my CA on the 1st' });
    expect((on as HTMLInputElement).checked).toBe(false);
    await act(async () => { fireEvent.click(on); });
    await settle();
    expect(await engine.request('venture.accountant.schedule.get', {})).toMatchObject({ on: true });
    expect(sheet.textContent).toContain('Nothing goes to your CA until you send it.');
    await act(async () => { fireEvent.click(within(sheet).getByRole('checkbox', { name: 'Save the month for my CA on the 1st' })); });
    await settle();
    expect(await engine.request('venture.accountant.schedule.get', {})).toMatchObject({ on: false, next: null });
  });
});
