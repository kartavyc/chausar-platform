import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { ClockProvider } from '../../src/shell/clock';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { assertOnePrimaryPerView } from '../helpers/ink-rules';

const NOW = '2026-10-23T13:35:00.000Z';
const settle = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); };
type Change = (method: string, params: unknown, answer: unknown) => unknown;
async function open(page: string, change?: Change, folder?: string) {
  const engine = new FakeEngine({ now: () => NOW });
  if (folder) await engine.request('workspace.open', { folder });
  const client = createFakeClient(engine);
  const request = client.request.bind(client);
  client.request = (async (method, params) => {
    const answer = await request(method, params as never);
    return change ? change(method, params, answer) : answer;
  }) as typeof client.request;
  window.location.hash = `#/business/${page}`;
  render(<ClockProvider now={() => new Date(NOW)}><App client={client} language="en" /></ClockProvider>);
  await settle();
  return client;
}

describe('B4 task 21: business settings', () => {
  it.each(['plan', 'prices'])('%s has no duplicate Waiting on you section', async page => {
    await open(page, undefined, 'ledgerline');
    expect(screen.queryByRole('region', { name: 'Waiting on you' })).toBeNull();
  });

  it('the plan approval belongs to its plan section', async () => {
    await open('plan', undefined, 'ledgerline');
    const heading = document.getElementById('business-plan-name')!;
    expect(within(heading.closest('section')!).getByRole('button', { name: 'Accept' })).toBeTruthy();
  });

  it('Prices gives one leading action across its offers', async () => {
    await open('prices');
    assertOnePrimaryPerView();
    const inputs = within(screen.getByRole('main')).getAllByRole('textbox', { name: 'New price' });
    expect(inputs.length).toBeGreaterThan(0);
    expect(inputs.every(input => input.closest('[data-field]')?.textContent?.includes('₹'))).toBe(true);
  });

  it('editing the plan replaces its repeated description and keeps country out of the form', async () => {
    await open('plan');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Change plan' })); });
    const form = screen.getByRole('textbox', { name: 'Name' }).closest('form')!;
    expect(within(form).queryByRole('combobox', { name: /country/i })).toBeNull();
    const description = within(form).getByRole('textbox', { name: 'One line' }) as HTMLInputElement;
    expect([...form.parentElement!.querySelectorAll('p')].some(line => line.textContent?.startsWith(description.value))).toBe(false);
  });

  it('Goals does not repeat a month selector under its month title', async () => {
    await open('goals');
    expect(screen.queryByRole('combobox', { name: 'Month' })).toBeNull();
  });

  it('Goals omits empty history', async () => {
    await open('goals', (method, params, answer) => method === 'venture.goals.get' && (params as { month?: string })?.month
      ? { ...(answer as object), state: 'unset', goal: null } : answer);
    expect(screen.queryByRole('region', { name: 'Earlier goals' })).toBeNull();
  });

  it('a saved goal folds its editing form behind Change', async () => {
    await open('goals');
    const existing = screen.queryByRole('button', { name: 'Change' });
    if (existing) await act(async () => { fireEvent.click(existing); });
    const field = screen.getByRole('textbox', { name: 'Goal amount' });
    await act(async () => { fireEvent.change(field, { target: { value: '200000' } }); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Change the goal' })); });
    await settle();
    expect(screen.getByRole('button', { name: 'Change' })).toBeTruthy();
    expect(screen.queryByText(/^Goal set for/)).toBeNull();
    expect(document.querySelector('main form')).toBeNull();
  });

  it('a website without a brief shows Your brief alone', async () => {
    await open('build', (method, _params, answer) => method === 'venture.build.status' ? { ...(answer as object), brief: null } : answer);
    const settingsPage = screen.getByRole('heading', { name: 'Website build', level: 1 }).parentElement!.parentElement!;
    expect(within(settingsPage).getAllByRole('heading', { level: 2 }).map(heading => heading.textContent)).toEqual(['Your brief']);
  });

  it('Practice marks its current stage in a two-way control and leads to connecting AI', async () => {
    await open('practice');
    const stage = screen.getByRole('group', { name: 'Stage' });
    expect(within(stage).getByRole('button', { name: 'Practice' }).getAttribute('aria-pressed')).toBe('true');
    const connect = screen.getByRole('button', { name: 'Connect your AI' });
    await act(async () => { fireEvent.click(connect); });
    expect(window.location.hash).toBe('#/connections/ai');
  });
});
