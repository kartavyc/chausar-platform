import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';

// C5 task 16: the accountant sheet remembers the CA; Send to my CA asks once, naming what leaves and to whom; the words
// say the mail app has it ready, never that it was sent.
const settle = () => act(async () => { for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0)); });

describe('Send to my CA', () => {
  it('keeps the contact, confirms once, and says the draft is ready', async () => {
    window.location.hash = '#/money?sheet=accountant:books';
    const engine = new FakeEngine({ now: () => '2026-10-21T11:00:00.000Z' });
    const client = createFakeClient(engine);
    const sharePack = vi.fn(async () => ({ how: 'email' as const, opened: 'draft' as const, file: 'x.csv', to: 'ca@example.com' }));
    client.sharePack = sharePack;
    render(<App client={client} language="en" />);
    const sheet = await screen.findByRole('complementary', { name: /accountant/i });
    fireEvent.change(await within(sheet).findByLabelText("Your CA's email"), { target: { value: 'ca@example.com' } });
    await act(async () => { fireEvent.click(within(sheet).getByRole('button', { name: 'Keep contact' })); });
    await settle();
    await waitFor(async () => expect(await engine.request('venture.accountant.get', {})).toMatchObject({ email: 'ca@example.com' }));
    await act(async () => { fireEvent.click(within(sheet).getByRole('button', { name: 'Send to my CA' })); });
    expect(sharePack).not.toHaveBeenCalled();
    expect(sheet.textContent).toContain('ca@example.com');
    await act(async () => { fireEvent.click(within(sheet).getByRole('button', { name: 'Open the draft' })); });
    await settle();
    expect(sharePack).toHaveBeenCalledWith(expect.stringMatching(/^\d{4}-\d{2}$/), 'email');
    expect(sheet.textContent).toContain('Your mail app has it ready. Press send there.');
    expect(sheet.textContent).not.toMatch(/\bsent\b/i);
  });
});
