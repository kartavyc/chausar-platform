import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import type { EngineClient } from '../../src/engine/types';

// C5 task 13: "I charge GST" on Prices. The fields appear only after the switch; each goes through venture.blueprint.update
// under the same owner-set rule as prices; a GSTIN the engine refuses shows the check's words.
const settle = () => act(async () => { for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0)); });

function start() {
  window.location.hash = '#/business/prices';
  const fake = createFakeClient(new FakeEngine());
  const spy = vi.fn();
  const client: EngineClient = { ...fake, request: ((method: string, params?: unknown) => { spy(method, params); return fake.request(method as never, params as never); }) as EngineClient['request'] };
  render(<App client={client} language="en" />);
  return spy;
}
const updates = (spy: ReturnType<typeof vi.fn>) => spy.mock.calls.filter(([m]) => m === 'venture.blueprint.update').map(([, p]) => (p as { patch: unknown }).patch);

describe('Prices: I charge GST', () => {
  it('shows the rate and GSTIN only after the switch, and sends the patch', async () => {
    const spy = start();
    const section = (await screen.findByRole('checkbox', { name: 'I charge GST' })).closest('section') as HTMLElement;
    const toggle = within(section).getByRole('checkbox', { name: 'I charge GST' }) as HTMLInputElement;
    if (toggle.checked) { await act(async () => { fireEvent.click(toggle); }); await settle(); }
    expect(within(section).queryByLabelText('GSTIN')).toBeNull();
    await act(async () => { fireEvent.click(within(section).getByRole('checkbox', { name: 'I charge GST' })); });
    await settle();
    fireEvent.change(await within(section).findByLabelText('GST rate'), { target: { value: '18' } });
    fireEvent.change(within(section).getByLabelText('GSTIN'), { target: { value: '27ZZZZZ9999Z1Z8' } });
    await act(async () => { fireEvent.click(within(section).getByRole('button', { name: 'Save GST' })); });
    await settle();
    await waitFor(() => expect(updates(spy)).toContainEqual({ taxRegistered: true, taxRate: '18', taxId: '27ZZZZZ9999Z1Z8' }));
    expect(within(section).queryByRole('alert')).toBeNull();
  });

  it('an invalid GSTIN shows the check\'s words', async () => {
    start();
    const section = (await screen.findByRole('checkbox', { name: 'I charge GST' })).closest('section') as HTMLElement;
    const toggle = within(section).getByRole('checkbox', { name: 'I charge GST' }) as HTMLInputElement;
    if (!toggle.checked) { await act(async () => { fireEvent.click(toggle); }); await settle(); }
    fireEvent.change(await within(section).findByLabelText('GSTIN'), { target: { value: 'NOT-A-GSTIN' } });
    await act(async () => { fireEvent.click(within(section).getByRole('button', { name: 'Save GST' })); });
    await settle();
    expect(within(section).getByRole('alert').textContent).toContain('Check your GSTIN.');
  });
});
