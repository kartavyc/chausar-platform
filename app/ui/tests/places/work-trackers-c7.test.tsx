import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { assertInkRules } from '../helpers/ink-rules';

/**
 * C7 task 20: trackers on Work. The list and the board show the same rows; a card moves on the board by a menu; an agent's
 * row says who added it, with Undo; a receipt cell carries its figure, an estimate cell its label; the GST starter is
 * absent for a business with no tax fields.
 */
function start() {
  window.location.hash = '#/work?state=trackers';
  const client = createFakeClient(new FakeEngine());
  const calls: { method: string; params: any }[] = [];
  const request = client.request.bind(client);
  client.request = ((method: never, params?: never) => { calls.push({ method, params }); return request(method, params); }) as typeof client.request;
  render(<App client={client} language="en" />);
  return { calls };
}

describe('Work: trackers (C7)', () => {
  it('the list and the board show the same rows; a card moves by its menu', async () => {
    const { calls } = start();
    const section = await screen.findByRole('region', { name: 'Content calendar' });
    await within(section).findByText('Episode trailer');
    expect(within(section).getByText(/^Added by /)).toBeTruthy();
    fireEvent.click(within(section).getByRole('button', { name: 'Show as a board' }));
    const stack = await within(section).findByRole('region', { name: 'Drafting' });
    expect(within(stack).getByText('Episode trailer')).toBeTruthy();
    await act(async () => { fireEvent.change(within(stack).getByLabelText('Move to'), { target: { value: 'Ready' } }); });
    await waitFor(() => expect(calls.some((call) => call.method === 'venture.trackers.rows.edit' && call.params.cells.stage === 'Ready')).toBe(true));
    const ready = await within(section).findByRole('region', { name: 'Ready' });
    await within(ready).findByText('Episode trailer');
    assertInkRules();
  });

  it("an agent's row has Undo; a row the owner adds does not", async () => {
    const { calls } = start();
    const section = await screen.findByRole('region', { name: 'Content calendar' });
    const row = await within(section).findByText('Episode trailer').then((node) => node.closest('li') as HTMLElement);
    fireEvent.click(within(section).getByText('Add a row'));
    fireEvent.change(within(section).getByLabelText('Title'), { target: { value: 'Second episode' } });
    await act(async () => { fireEvent.click(within(section).getByRole('button', { name: 'Add it' })); });
    const mine = (await within(section).findByText('Second episode')).closest('li') as HTMLElement;
    expect(within(mine).queryByRole('button', { name: 'Undo' })).toBeNull();
    await act(async () => { fireEvent.click(within(row).getByRole('button', { name: 'Undo' })); });
    await waitFor(() => expect(calls.some((call) => call.method === 'venture.trackers.rows.undo')).toBe(true));
    await waitFor(() => expect(within(section).queryByText('Episode trailer')).toBeNull());
  });

  it('money in a count cell shows the engine words; the GST starter is absent without tax fields', async () => {
    start();
    await screen.findByRole('region', { name: 'Content calendar' });
    expect(screen.queryByRole('button', { name: /GST due dates/ })).toBeNull();
    const add = screen.getByText('Add a row');
    fireEvent.click(add);
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Billed ₹5,000 for this' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add it' })); });
    expect((await screen.findByRole('alert')).textContent).toMatch(/A tracker keeps no money of its own/);
  });
});
