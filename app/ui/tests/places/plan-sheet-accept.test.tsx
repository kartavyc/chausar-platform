import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { ClockProvider } from '../../src/shell/clock';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import type { EngineClient, QueueDecision } from '../../src/engine/types';
import { assertOnePrimary, assertOnePrimaryPerView } from '../helpers/ink-rules';

/**
 * 15 Nov 2026 (the first walk of the built Windows app): "Read your plan and accept it." The owner opened the plan,
 * read to its end, and there was no Accept there: they had to close it and find Accept back on Today. The plan sheet
 * now ends with the same accept: the row's own action with the engine's own label, the same engine call
 * (venture.queue.decide through the session's one decide), and the same read-first rule (it is there only once the
 * plan's content is on screen, and it says so to the engine). Today's own Accept stays.
 */
const MORNING = () => new Date('2026-10-23T04:30:00.000Z');
const PLAN_SHEET = '#/today?sheet=view:plan:plan-ledgerline-1';

function start({ engine = new FakeEngine(), client, hash = '#/today' }: { engine?: FakeEngine; client?: EngineClient; hash?: string } = {}) {
  window.location.hash = hash;
  const used = client ?? createFakeClient(engine);
  render(<ClockProvider now={MORNING}><App client={used} language="en" /></ClockProvider>);
  return { engine, client: used };
}
const settleHash = async () => { await act(async () => { window.dispatchEvent(new HashChangeEvent('hashchange')); }); };
const click = async (element: Element) => { await act(async () => { fireEvent.click(element); }); };
const needsYou = () => screen.getByRole('region', { name: 'Needs you' });
const locked = (button: HTMLElement) => button.getAttribute('aria-disabled') === 'true' || (button as HTMLButtonElement).disabled;
async function planRow(): Promise<HTMLElement> {
  const heading = await within(needsYou()).findByRole('heading', { level: 3, name: 'Your plan is ready. Read it.' });
  return heading.closest<HTMLElement>('[data-row]')!;
}
const planSheet = () => screen.findByRole('complementary', { name: 'Ledgerline plan' });

describe('the plan sheet ends with Accept', () => {
  it('after reading, Accept is at the end of the sheet; pressing it accepts the plan with the same engine call, and both places say so', async () => {
    const { client } = start();
    const spy = vi.spyOn(client, 'request');
    const row = await planRow();
    await click(within(row).getByRole('button', { name: 'Read' }));
    await settleHash();
    const sheet = await planSheet();
    const accept = await within(sheet).findByRole('button', { name: 'Accept' });
    // The last thing in the sheet, after every section of the plan, and its one filled button.
    const last = [...sheet.querySelectorAll('section, button')].at(-1);
    expect(last).toBe(accept);
    expect(accept.getAttribute('data-variant')).toBe('primary');
    expect(locked(accept)).toBe(false);
    // Today's own Accept stays, unlocked by the same reading.
    await waitFor(() => expect(locked(within(row).getByRole('button', { name: 'Accept' }))).toBe(false));
    assertOnePrimary();
    assertOnePrimaryPerView();

    const id = row.getAttribute('data-row-id')!;
    await click(accept);
    const sent = spy.mock.calls.filter(([method]) => method === 'venture.queue.decide');
    expect(sent).toHaveLength(1);
    expect(sent[0]![1]).toMatchObject({ id, action: 'approve', viewed: true });
    expect((sent[0]![1] as { digest: string }).digest.length).toBeGreaterThan(0);
    await waitFor(() => expect(sheet.querySelector('[role="status"][data-sheet-decided]')?.textContent).toBe('Plan accepted.'));
    expect(within(sheet).queryByRole('button', { name: 'Accept' })).toBeNull();
    // Where the button was, the same line: the owner is at the end of the plan when they press it.
    expect(sheet.querySelector('[data-sheet-accepted]')?.textContent).toBe('Plan accepted.');
    await waitFor(() => expect(needsYou().querySelector(`[data-row-id="${id}"][data-decided]`)?.textContent).toBe('Plan accepted.'));
  });

  it('opened by its address, the sheet has Accept once the plan is on screen, and Today\'s Accept unlocks with it', async () => {
    start({ hash: PLAN_SHEET });
    const sheet = await planSheet();
    expect(await within(sheet).findByRole('button', { name: 'Accept' })).toBeTruthy();
    const row = await planRow();
    await waitFor(() => expect(locked(within(row).getByRole('button', { name: 'Accept' }))).toBe(false));
  });

  it('a plan that failed to load has no Accept: nothing is accepted unread', async () => {
    const fake = createFakeClient(new FakeEngine());
    const client: EngineClient = { ...fake, request: ((method: string, params?: unknown) => (method === 'venture.queue.view' ? Promise.reject(new Error('The plan could not be read.')) : fake.request(method as never, params as never))) as EngineClient['request'] };
    start({ client, hash: PLAN_SHEET });
    const sheet = await screen.findByRole('complementary');
    await within(sheet).findByText('The plan could not be read.');
    expect(within(sheet).queryByRole('button', { name: 'Accept' })).toBeNull();
  });

  it('a draft\'s sheet and a plan nothing asks about have no Accept', async () => {
    start({ hash: '#/today?sheet=view:draft:draft-ep14' });
    const draft = await screen.findByRole('complementary');
    await waitFor(() => expect(draft.querySelector('[data-content]')).not.toBeNull());
    expect(within(draft).queryByRole('button', { name: /^(Accept|Approve)$/ })).toBeNull();
  });

  it('a refusal stays in the sheet in the engine\'s words, and Accept can be pressed again', async () => {
    const fake = createFakeClient(new FakeEngine());
    let refuse = true;
    const client: EngineClient = { ...fake, request: ((method: string, params?: unknown) => {
      if (method === 'venture.queue.decide' && refuse) { refuse = false; return Promise.resolve({ outcome: 'refused', line: 'Set your price for Monthly books first.', reason: 'PRICE_MISSING' } satisfies QueueDecision); }
      return fake.request(method as never, params as never);
    }) as EngineClient['request'] };
    start({ client, hash: PLAN_SHEET });
    const sheet = await planSheet();
    await click(await within(sheet).findByRole('button', { name: 'Accept' }));
    expect((await within(sheet).findByRole('alert')).textContent).toBe('Set your price for Monthly books first.');
    await click(within(sheet).getByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(sheet.querySelector('[data-sheet-accepted]')?.textContent).toBe('Plan accepted.'));
    expect(within(sheet).queryByRole('alert')).toBeNull();
  });
});
