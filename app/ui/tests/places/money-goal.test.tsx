import { describe, expect, it } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { EngineError, type EngineClient, type GoalView } from '../../src/engine/types';
import { assertFiguresProved, assertInkRules, receiptMark } from '../helpers/ink-rules';

/*
 * Money's "Invoiced this month" tile with the month's goal (W4 4I2, D-Money's `.mt` invoiced tile): the goals view's
 * invoiced figure, and with a goal "of" the goal, the percent, the bar, days left in the header pill and the foot
 * (ready to issue, ahead or behind pace, past the goal) where the engine sends those figures, each with its receipt.
 * Without the goals view, the books' billed figure under its own label, never passed off as the goal's.
 */

const NOW = '2026-10-23T13:35:00.000Z';
const settle = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };
type Asked = (method: string, params: unknown) => Promise<unknown>;

async function start({ folder, override = {} }: { folder?: string; override?: Partial<Record<string, (params: unknown, asked: Asked) => unknown>> } = {}) {
  const fake = createFakeClient(new FakeEngine({ now: () => NOW }));
  const request = fake.request.bind(fake);
  const asked: Asked = (method, params) => request(method as never, params as never) as Promise<unknown>;
  const client: EngineClient = { ...fake, request: (async (method: string, params?: unknown) => (override[method] ? override[method]!(params, asked) : asked(method, params))) as EngineClient['request'] };
  if (folder) {
    await client.request('workspace.lock', {});
    await client.request('workspace.open', { folder });
  }
  window.location.hash = '#/money';
  render(<App client={client} language="en" />);
  await settle();
}

const invoicedTile = () => screen.findByRole('region', { name: 'Invoiced this month' });

describe('Money: the invoiced tile with the goal (W4 4I2)', () => {
  it('with a goal: the invoiced figure of the goal, the percent, the bar, days left in the pill and ahead of pace, each amount with its receipt', async () => {
    await start();
    const tile = await invoicedTile();
    await waitFor(() => expect(tile.textContent).toContain('₹1,50,000.00'));
    expect(tile.querySelector('[data-ui-number]')?.textContent).toBe('₹1,12,400.00');
    expect(tile.textContent).toContain('74%');
    expect(tile.querySelector('[data-pill]')?.textContent).toBe('8 days left');
    expect(within(tile).getByRole('img').getAttribute('aria-label')).toBe("74% of the goal invoiced. Today's pace is 74%.");
    const foot = tile.querySelector<HTMLElement>('[data-goal-foot]')!;
    expect(foot.textContent).toContain('₹1,109.67');
    expect(foot.textContent).toContain('ahead of pace');
    // Nothing is ready to issue in the sample, so the foot does not say so.
    expect(foot.textContent).not.toContain('ready to issue');
    assertFiguresProved(tile);
    assertInkRules(document.body);
  });

  it('ready to issue and past the goal, where the engine sends them', async () => {
    await start({
      override: {
        'venture.goals.get': async (params, asked) => ({
          ...(await asked('venture.goals.get', params) as GoalView), ready: { display: '₹18,880.00', receiptId: 'R-0419' }, readyPermille: 0,
          invoicedPercent: 118, past: true, pastBy: { display: '₹27,750.00', receiptId: 'R-0501' }, stillToInvoice: null,
        }),
      },
    });
    const tile = await invoicedTile();
    await waitFor(() => expect(tile.textContent).toContain('118%'));
    const foot = tile.querySelector<HTMLElement>('[data-goal-foot]')!;
    expect(foot.textContent).toContain('₹18,880.00');
    expect(foot.textContent).toContain('ready to issue');
    expect(foot.textContent).toContain('Past the goal by');
    expect(within(foot).getByRole('button', { name: receiptMark('R-0501') })).toBeTruthy();
    assertFiguresProved(tile);
  });

  it("with no goal: the goals view's invoiced figure with its receipt, and no bar or percent", async () => {
    await start({ folder: 'ledgerline' });
    const tile = await invoicedTile();
    await waitFor(() => expect(tile.querySelector('[data-ui-number]')?.textContent).toBe('₹16,000.00'));
    expect(within(tile).queryByRole('button', { name: receiptMark('R-0401') })).toBeNull();
    expect(within(tile).queryByRole('img')).toBeNull();
    expect(tile.textContent).not.toContain('%');
  });

  it("without the goals view: the books' billed figure under the books' own label", async () => {
    await start({ override: { 'venture.goals.get': () => { throw new EngineError('NOT_BUILT_YET', 'Not built yet.'); } } });
    const tile = await invoicedTile();
    await waitFor(() => expect(within(tile).getByRole('button', { name: receiptMark('R-0401') })).toBeTruthy());
    expect(tile.querySelector('[data-books-label]')?.textContent).toBe('Billed');
    expect(within(tile).queryByRole('img')).toBeNull();
  });
});
