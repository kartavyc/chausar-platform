import { describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { ClockProvider } from '../../src/shell/clock';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import type { MethodName } from '../../src/engine/types';

/*
 * One-shot B2 task 3 (REPORT row 37, bug 6): a drill run at 00:50 in India on 3 Nov is a 3 Nov drill. The day reads
 * in the business's zone (its country's zone), not in UTC and not in the computer's zone, so the test reads the same
 * on the CI runners (UTC) and on this laptop (India). A calendar day ('2026-11-03') never shifts.
 */

const DRILL = {
  id: 'drill-b2', at: '2026-11-02T19:20:00.000Z', playbookHash: 'abc', version: 4, passed: true,
  results: [{ drill: 'A model with no price', stopped: true, twinPassed: true, line: 'It was not run.' }],
};

function start(zone?: string, intercept: Partial<Record<MethodName, (params: unknown) => unknown>> = {}) {
  window.location.hash = '#/business/practice';
  const client = createFakeClient(new FakeEngine({ now: () => '2026-11-02T19:30:00.000Z' }));
  const request = client.request.bind(client);
  const answers: Partial<Record<MethodName, (params: unknown) => unknown>> = { 'venture.drills.list': () => ({ runs: [DRILL] }), ...intercept };
  client.request = ((method: MethodName, params?: unknown) => {
    const own = answers[method];
    if (own) return Promise.resolve().then(() => own(params));
    return request(method, params as never);
  }) as typeof client.request;
  const app = <App client={client} language="en" />;
  render(zone ? <ClockProvider now={() => new Date('2026-11-02T19:30:00.000Z')} zone={zone}>{app}</ClockProvider> : app);
}

async function drillDay(): Promise<string> {
  const tile = await screen.findByRole('region', { name: 'Safety checks' });
  await waitFor(() => expect(tile.querySelector('[data-drill-run]')).not.toBeNull());
  return within(tile).getByText(/^Run on /).textContent ?? '';
}

describe('Business > Practice: the drill day in the owner zone (B2 row 37)', () => {
  it('a drill at 00:50 IST on 3 Nov reads 3 Nov under a zone the clock gives', async () => {
    start('Asia/Kolkata');
    expect(await drillDay()).toBe('Run on 3 Nov 2026');
  });

  it('with no zone given, the business (country IN) reads in its own zone through venture.get', async () => {
    start();
    expect(await drillDay()).toBe('Run on 3 Nov 2026');
  });

  it('a calendar-day consent reads its own day in any zone', async () => {
    start('America/New_York', { 'venture.judge.auto.get': () => ({ auto: true, consentAt: '2026-11-03', line: 'On.' }) });
    expect(await screen.findByText('You agreed on 3 Nov 2026.')).toBeTruthy();
  });
});
