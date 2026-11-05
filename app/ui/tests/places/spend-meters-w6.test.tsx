import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { receiptMark } from '../helpers/ink-rules';

/**
 * W6 6G5 (D44): Money > Spend shows each agent's and each routine's spend this month one step away, with the owner's
 * own limit on each; a run's sheet carries its model receipt: the tool, the tier, the tokens and the cost, "On your
 * plan" with no rupee figure for a run on the owner's plan, and the receipt mark for a cost code priced.
 */

type Call = [string, unknown];
function start(hash: string, engine = new FakeEngine({ now: () => '2026-10-21T11:00:00.000Z' })) {
  window.location.hash = hash;
  const client = createFakeClient(engine);
  const calls: Call[] = [];
  const request = client.request.bind(client);
  client.request = (async (method: string, params?: unknown) => { calls.push([method, params]); return request(method as never, params as never); }) as typeof client.request;
  render(<App client={client} language="en" />);
  return { engine, calls };
}
const click = async (element: Element) => { await act(async () => { fireEvent.click(element); window.dispatchEvent(new HashChangeEvent('hashchange')); }); };
const type = async (element: Element, value: string) => { await act(async () => { fireEvent.change(element, { target: { value } }); }); };

describe('Money > Spend: each agent and routine', () => {
  it('is one quiet icon away at rest; opened, each row shows its month with the receipt, plan runs with no figure, and its own limit', async () => {
    start('#/money/spend');
    const toggle = await screen.findByRole('button', { name: 'Spend by agent and routine' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('region', { name: 'Spend by agent and routine' })).toBeNull();
    await click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const panel = screen.getByRole('region', { name: 'Spend by agent and routine' });
    const editor = within(panel).getByText('Editor').closest('li')!;
    // The sample has the owner's rupee rate, so rupees lead and the dollars sit beside them.
    expect(editor.textContent).toContain('₹42.10 this month');
    expect(editor.textContent).toContain('USD 0.50');
    expect(editor.textContent).toContain('No limit of its own');
    expect(within(editor).getByRole('button', { name: receiptMark('R-0451') })).toBeTruthy();
    const researcher = within(panel).getByText('Researcher').closest('li')!;
    const plan = within(researcher).getByText('2 jobs on your plan');
    expect(plan.textContent).not.toMatch(/₹|USD/);
  });

  it('Set a limit sends the whole list of agent limits in US dollars, and the row then says where it stands', async () => {
    const { calls } = start('#/money/spend');
    await click(await screen.findByRole('button', { name: 'Spend by agent and routine' }));
    const panel = screen.getByRole('region', { name: 'Spend by agent and routine' });
    const editor = within(panel).getByText('Editor').closest('li')!;
    await click(within(editor).getByRole('button', { name: 'Set a limit' }));
    await type(within(editor).getByLabelText('Monthly limit in US dollars'), '0.50');
    await click(within(editor).getByRole('button', { name: 'Save limit' }));
    expect(calls.find(([method]) => method === 'venture.spend.policy.set')?.[1]).toEqual({ agentCaps: [{ agent: 'editor', capUsd: '0.50' }] });
    const saved = (await within(panel).findByText('Paused: it reached its limit. Other work goes on.')).closest('li')!;
    expect(saved.textContent).toContain('USD 0.5000 a month');
    expect(within(saved).getByRole('button', { name: 'Change limit' })).toBeTruthy();
  });

  it('the fake engine refuses a limit for a routine that is not there, as the engine does', async () => {
    const engine = new FakeEngine({ now: () => '2026-10-21T11:00:00.000Z' });
    await expect(engine.request('venture.spend.policy.set', { routineCaps: [{ routine: 'routine_nope', capUsd: '1.00' }] }))
      .rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST', message: 'A routine limit names one of your routines.' });
  });
});

describe('a run sheet carries its model receipt', () => {
  it('a finished key run: tool, model, tier, tokens and its cost with the receipt mark', async () => {
    start('#/work?sheet=run:26');
    const head = await screen.findByText('Model receipt');
    const block = head.closest('[data-model-receipt]')!;
    expect(block.textContent).toContain('Claude Sonnet 5.5, your key');
    expect(block.textContent).toContain('Main model');
    expect(block.textContent).toContain('4,410 tokens in, 620 out');
    expect(within(block as HTMLElement).getByRole('button', { name: receiptMark('R-0454') })).toBeTruthy();
    expect(block.textContent).toContain('Run by Researcher');
  });

  it('a run on the owner\'s plan says "On your plan", with no figure and no rupees', async () => {
    start('#/work?sheet=run:30');
    const block = (await screen.findByText('Model receipt')).closest('[data-model-receipt]')!;
    expect(block.getAttribute('data-model-receipt')).toBe('plan');
    expect(block.textContent).toContain('On your plan');
    expect(block.textContent).not.toMatch(/₹|USD/);
    expect(block.querySelector('[data-receipt]')).toBeNull();
  });
});
