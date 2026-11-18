import { describe, expect, it } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { assertInkRules } from '../helpers/ink-rules';

/*
 * Money on the owner's own AI plan (found by running the real app, 15 Nov 2026). An Indian business on the owner's own
 * Codex or Claude plan read "$0.00" for AI spend, with "Set a rupee rate" beside it. A call there is counted, never
 * priced, so nothing spent says "On your own AI plan", in no currency, as Team's month total already did. The engine's
 * rule is models/own-plan.ts; the fake answers the same way. On a key the figure stays, and since fix round 4 (real-app
 * problem 12) a rupee business reads it in rupees from its first day, at the dated reference rate, never in dollars for
 * want of a setting.
 */
const settle = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };

async function fresh(ownPlan: boolean) {
  const client = createFakeClient(new FakeEngine({ fresh: true }));
  await client.request('workspace.create', { name: 'Clay Corner', pack: 'services' });
  await client.request('venture.create', { idea: 'Handmade pottery sold in bulk to cafes and small hotels', countryCode: 'IN' });
  if (ownPlan) {
    const preset = (await client.request('venture.ai.options', {})).presets.find((row) => row.id === 'claude-code-cli')!;
    await client.request('venture.models.connect', { presetId: preset.id, consentDigest: preset.consentDigest, tiers: ['fast', 'main'] } as never);
  }
  return client;
}
async function show(client: ReturnType<typeof createFakeClient>, hash: string) {
  window.location.hash = hash;
  render(<App client={client} language="en" />);
  await settle();
  return screen.getByRole('main');
}
const spent = async (client: ReturnType<typeof createFakeClient>) => (await client.request('venture.money.overview', {})).lines.find((line) => line.id === 'spent')!;

describe('Money: AI spend on the owner\'s own AI plan', () => {
  it('the fake answers as the engine does: a figure on a key, the words on the owner\'s plan, and no rate asked for', async () => {
    const keyed = await fresh(false);
    const rupeesFirst = { currency: 'INR', beside: '$0.00 at ₹94.40 per $1', other: '$0.00' };
    expect((await spent(keyed)).lead).toEqual({ ...rupeesFirst, figure: '₹0' });
    expect('needsRate' in (await spent(keyed))).toBe(false);
    const list = await keyed.request('venture.spend.list', {});
    expect([list.rows, list.total, list.totalLead]).toEqual([[], '$0.00 this month', { ...rupeesFirst, figure: '₹0 this month' }]);
    expect('needsRate' in list).toBe(false);

    const counted = await fresh(true);
    const line = await spent(counted);
    expect(line.lead).toEqual({ currency: 'USD', figure: 'On your own AI plan' });
    expect('needsRate' in line).toBe(false);
    const own = await counted.request('venture.spend.list', {});
    expect([own.rows, own.total, own.totalLead]).toEqual([[], '$0.00 this month', { currency: 'USD', figure: 'On your own AI plan' }]);
    expect('needsRate' in own).toBe(false);
    // Team's month total says the same.
    expect((await counted.request('venture.team.list', {})).totals?.spendThisMonth.lead ?? line.lead).toEqual(line.lead);
  });

  it('Money at a glance says "On your own AI plan", with no dollar figure and no rupee rate link', async () => {
    const main = await show(await fresh(true), '#/money');
    const tile = (await within(main).findByText('AI spend this month')).closest('section, article, li, div[data-tile]') as HTMLElement ?? main;
    await waitFor(() => expect(within(main).getByText('On your own AI plan')).toBeTruthy());
    expect(main.textContent).not.toContain('$0.00');
    expect(within(main).queryByRole('link', { name: 'Set a rupee rate' })).toBeNull();
    expect(tile).toBeTruthy();
    assertInkRules(main);
  });

  it('in Hindi Money says the own-plan words from the pack, at a glance and on Spend (re-check 7)', async () => {
    for (const hash of ['#/money', '#/money/spend']) {
      window.location.hash = hash;
      const client = await fresh(true);
      await client.request('app.preferences.set', { language: 'hi' } as never);
      const view = render(<App client={client} language="en" />);
      await waitFor(() => expect(document.documentElement.lang).toBe('hi'));
      await settle();
      const main = screen.getByRole('main');
      await waitFor(() => expect(within(main).getAllByText('आपके अपने AI प्लान पर').length).toBeGreaterThan(0));
      expect(main.textContent, hash).not.toContain('On your own AI plan');
      view.unmount();
    }
  });

  it('Money, Spend says it beside the calls, with no dollar total', async () => {
    const main = await show(await fresh(true), '#/money/spend');
    await waitFor(() => expect(within(main).getByText('On your own AI plan')).toBeTruthy());
    expect(main.textContent).not.toContain('$0.00 this month');
    expect(within(main).queryByRole('link', { name: 'Set a rupee rate' })).toBeNull();
  });

  it('on a key the figure stays, in the business\'s own currency: rupees for a business in India, never dollars', async () => {
    const main = await show(await fresh(false), '#/money');
    await waitFor(() => expect(main.textContent).toContain('AI spend this month₹0'));
    expect(main.textContent).not.toContain('$');
    expect(within(main).queryByText('On your own AI plan')).toBeNull();
  });

  it('the sample business keeps its priced month', async () => {
    const client = createFakeClient(new FakeEngine());
    const list = await client.request('venture.spend.list', {});
    expect(list.total).toBe('$0.72 this month (includes estimates)');
    expect(list.rows.length).toBeGreaterThan(0);
  });
});
