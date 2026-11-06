import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { assertInkRules } from '../helpers/ink-rules';

/**
 * C7 task 12: triggers on the Routines page. The closed-app line shows; the relay address is asked, and only its host shows
 * after; saving a trigger shows the facts it sends, in a second ask; a refused event says why.
 */
function start() {
  window.location.hash = '#/business/routines';
  const client = createFakeClient(new FakeEngine({ now: () => '2026-10-23T10:00:00.000Z' }));
  const calls: { method: string; params: any }[] = [];
  const request = client.request.bind(client);
  client.request = ((method: never, params?: never) => { calls.push({ method, params }); return request(method, params); }) as typeof client.request;
  render(<App client={client} language="en" />);
  return { calls };
}
const press = async (scope: HTMLElement, name: string) => { await act(async () => { fireEvent.click(within(scope).getByRole('button', { name })); }); };
async function opened() {
  const summary = await screen.findByText('When something happens');
  fireEvent.click(summary);
  const fold = summary.closest('details') as HTMLElement;
  await within(fold).findByText(/^Nothing fires while Chausar is closed/);
  return fold;
}

describe('Routines: event triggers (C7)', () => {
  it('the closed-app line shows; a bad address is refused in the engine words; a good one shows only its host', async () => {
    start();
    const fold = await opened();
    const field = within(fold).getByLabelText(/Your relay address/);
    fireEvent.change(field, { target: { value: 'https://192.168.1.5/topic' } });
    await press(fold, 'Save');
    expect((await within(fold).findByRole('alert')).textContent).toMatch(/outside this computer and its network/);
    fireEvent.change(field, { target: { value: 'https://ntfy.sh/my-private-topic' } });
    await press(fold, 'Save');
    const host = await waitFor(() => fold.querySelector('[data-relay-host]') as HTMLElement);
    expect(host.textContent).toContain('ntfy.sh');
    expect(fold.textContent).not.toContain('my-private-topic');
    assertInkRules();
  });

  it('saving a trigger shows the facts it sends in a second ask; a refused event says why', async () => {
    const { calls } = start();
    const fold = await opened();
    fireEvent.change(within(fold).getByLabelText(/Your relay address/), { target: { value: 'https://ntfy.sh/topic' } });
    await press(fold, 'Save');
    const form = await within(fold).findByRole('form', { name: 'Add a trigger' });
    fireEvent.change(within(form).getByLabelText(/What to ask/), { target: { value: 'Draft a thank-you to {client} for invoice {invoice}.' } });
    await press(form, 'Save routine');
    const ask = form.querySelector('[data-trigger-facts]') as HTMLElement;
    expect(ask.textContent).toContain("the client's name, the invoice number");
    await act(async () => { fireEvent.click(within(ask).getByRole('button', { name: 'Save' })); });
    await waitFor(() => expect(calls.some((call) => call.method === 'venture.routines.set' && call.params.routine.schedule.kind === 'event')).toBe(true));
    const refused = fold.querySelector('[data-event-state="refused"]') as HTMLElement;
    expect(refused.textContent).toContain('Razorpay does not know this payment');
  });
});
