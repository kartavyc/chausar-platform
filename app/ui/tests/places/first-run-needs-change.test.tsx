import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import type { EngineClient } from '../../src/engine/types';
import { assertInkRules } from '../helpers/ink-rules';
import { confirmProfession, skipAi } from './first-run-steps';

/**
 * The owner changes what the business needs (15 Nov 2026). Step 3 lists the needs the owner's AI picked; until now only
 * the AI could say what they were. "Change what you need" opens the fixed list as tick boxes, on step 3 and on
 * Connections where the same list leads; each tick is saved through venture.owner.set { needs } and the list follows.
 */
const POTTER = 'I make pottery by hand, mostly mugs and bowls, and I want bulk orders from cafes and hotels in Pune.';
const READ = {
  family: null, profession: null, country: null, evidence: null, idea: POTTER, source: 'ai',
  offers: [{ name: 'Cafe mug sets', line: 'Handmade mugs in bulk for cafes' }],
  reply: 'You make pottery by hand and want bulk orders. Where are you based?',
  way: {
    customer: 'Independent cafes and small hotels in Pune that buy tableware in bulk.',
    reach: 'A list of cafes found from public listings, then a first message you send to each owner.',
    teamDoes: 'Finds the cafes, drafts each message and quote, and keeps track of who replied.',
    youDo: 'Make the samples, set the prices, send each message and take the calls.',
    firstWeek: ['Decide the set sizes and your price for each offer.', 'Approve the first list of cafes.'],
  },
  needs: ['find-customers', 'write-to-customers', 'payments'],
};
const TITLE = 'Connect what your business needs';
const ALL = ['To find customers', 'To write to customers', 'To make designs and documents', 'To get paid', 'For appointments'];

type Call = [string, Record<string, unknown>];
function start(read: unknown = READ) {
  const original = Intl.DateTimeFormat.prototype.resolvedOptions;
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function (this: Intl.DateTimeFormat) { return { ...original.call(this), timeZone: 'Asia/Kolkata' }; });
  window.location.hash = '#/today';
  const fake = createFakeClient(new FakeEngine({ fresh: true }));
  const calls: Call[] = [];
  let failSet = false;
  const client: EngineClient = { ...fake, request: ((method: string, params?: Record<string, unknown>) => {
    calls.push([method, structuredClone(params ?? {})]);
    if (method === 'venture.about.read' && read) return Promise.resolve(structuredClone(read));
    if (method === 'venture.owner.set' && failSet && params && 'needs' in params) return Promise.reject(new Error('This business is closed. Open it first.'));
    return fake.request(method as never, params as never);
  }) as EngineClient['request'] };
  render(<App client={client} language="en" />);
  return { calls, fail: (on: boolean) => { failSet = on; } };
}
async function toStepThree(text = POTTER) {
  const box = await skipAi();
  fireEvent.change(box, { target: { value: text } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })); });
  const keep = await screen.findByRole('button', { name: 'Keep this plan' });
  await waitFor(() => expect(keep.hasAttribute('disabled')).toBe(false));
  await act(async () => { fireEvent.click(keep); });
  // A listed field asks "Which of these are you?" first; work outside the fields goes straight to the rules step.
  await confirmProfession();
  const check = await screen.findByRole('region', { name: 'Day job and rules' }, { timeout: 4000 });
  await act(async () => { fireEvent.click(within(check).getByRole('radio', { name: 'I am not sure' })); });
  await act(async () => { fireEvent.click(within(check).getByRole('button', { name: 'Continue' })); });
  await screen.findByRole('heading', { level: 1, name: TITLE }, { timeout: 4000 });
}
const groups = () => screen.queryAllByRole('list').map((list) => list.getAttribute('aria-label')).filter((label) => ALL.includes(label ?? ''));
const needSets = (calls: Call[]) => calls.filter(([method, params]) => method === 'venture.owner.set' && 'needs' in params).map(([, params]) => params.needs);
async function openChange() {
  const change = await screen.findByRole('button', { name: 'Change what you need' }, { timeout: 4000 });
  expect(change.getAttribute('aria-expanded')).toBe('false');
  await act(async () => { fireEvent.click(change); });
  expect(change.getAttribute('aria-expanded')).toBe('true');
  return within(await screen.findByRole('group', { name: 'What your business needs' }));
}

afterEach(() => { vi.restoreAllMocks(); });

describe('step 3: the owner changes what the business needs', () => {
  it('ticks and unticks needs from the fixed list; each change is saved and the list follows', async () => {
    const { calls } = start();
    await toStepThree();
    await screen.findByRole('list', { name: 'To find customers' }, { timeout: 4000 });
    expect(groups()).toEqual(['To find customers', 'To write to customers', 'To get paid']);
    const pick = await openChange();
    // Every need of the fixed list, ticked where the plan keeps it.
    expect(pick.getAllByRole('checkbox').map((box) => [box.closest('label')!.textContent, (box as HTMLInputElement).checked])).toEqual([
      ['To find customers', true], ['To write to customers', true], ['To make designs and documents', false], ['To get paid', true], ['For appointments', false],
    ]);
    // Untick one: saved through the existing owner.set, and its group goes.
    await act(async () => { fireEvent.click(pick.getByRole('checkbox', { name: 'To get paid' })); });
    await waitFor(() => expect(groups()).toEqual(['To find customers', 'To write to customers']));
    expect(needSets(calls).at(-1)).toEqual(['find-customers', 'write-to-customers']);
    // Tick two more: each is added after what was kept, and its group shows with its ways.
    await act(async () => { fireEvent.click(pick.getByRole('checkbox', { name: 'For appointments' })); });
    await waitFor(() => expect(groups()).toEqual(['To find customers', 'To write to customers', 'For appointments']));
    await act(async () => { fireEvent.click(pick.getByRole('checkbox', { name: 'To make designs and documents' })); });
    await waitFor(() => expect(groups()).toEqual(['To find customers', 'To write to customers', 'For appointments', 'To make designs and documents']));
    await act(async () => { fireEvent.click(pick.getByRole('checkbox', { name: 'To get paid' })); });
    // All five: the owner's own choice has no ceiling.
    await waitFor(() => expect(groups()).toHaveLength(5));
    expect(needSets(calls).at(-1)).toEqual(['find-customers', 'write-to-customers', 'appointments', 'designs-documents', 'payments']);
    expect((pick.getByRole('checkbox', { name: 'For appointments' }) as HTMLInputElement).checked).toBe(true);
    // Still one filled button, and the way on is still there.
    expect([...document.querySelectorAll('main [data-variant="primary"]')].map((button) => button.textContent)).toEqual(['Go to Today']);
    assertInkRules();
  }, 20000);

  it('a change that could not be saved is said, and the ticks stay as they were', async () => {
    const { fail } = start();
    await toStepThree();
    await screen.findByRole('list', { name: 'To find customers' }, { timeout: 4000 });
    const pick = await openChange();
    fail(true);
    await act(async () => { fireEvent.click(pick.getByRole('checkbox', { name: 'To get paid' })); });
    expect(await screen.findByText('That change was not saved: This business is closed. Open it first.')).toBeTruthy();
    expect((pick.getByRole('checkbox', { name: 'To get paid' }) as HTMLInputElement).checked).toBe(true);
    expect(groups()).toEqual(['To find customers', 'To write to customers', 'To get paid']);
  }, 20000);

  it('a business kept with no needs (no AI) can pick them: the general list gives way to the owner\'s own', async () => {
    const { calls } = start(null);
    await toStepThree('I am a chartered accountant and do books and GST for small shops.');
    expect(groups()).toEqual([]);
    const pick = await openChange();
    expect(pick.getAllByRole('checkbox').map((box) => (box as HTMLInputElement).checked)).toEqual([false, false, false, false, false]);
    await act(async () => { fireEvent.click(pick.getByRole('checkbox', { name: 'To write to customers' })); });
    await waitFor(() => expect(groups()).toEqual(['To write to customers']));
    expect(needSets(calls)).toEqual([['write-to-customers']]);
    // Unticked again: the general list is back.
    await act(async () => { fireEvent.click(pick.getByRole('checkbox', { name: 'To write to customers' })); });
    await waitFor(() => expect(groups()).toEqual([]));
    expect(needSets(calls).at(-1)).toEqual([]);
  }, 20000);
});

describe('Connections: the same list, and the same way to change it', () => {
  it('ticks and unticks needs where the grouped list leads the page', async () => {
    const { calls } = start();
    await toStepThree();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Go to Today' })); });
    await screen.findByRole('navigation', {}, { timeout: 4000 });
    await act(async () => { window.location.hash = '#/connections'; });
    await screen.findByRole('list', { name: 'To find customers' }, { timeout: 4000 });
    const pick = await openChange();
    await act(async () => { fireEvent.click(pick.getByRole('checkbox', { name: 'For appointments' })); });
    await waitFor(() => expect(groups()).toEqual(['To find customers', 'To write to customers', 'To get paid', 'For appointments']));
    expect(needSets(calls).at(-1)).toEqual(['find-customers', 'write-to-customers', 'payments', 'appointments']);
    // The page's other parts are still there, under the list.
    expect(await screen.findByRole('heading', { name: 'Your AI' }, { timeout: 4000 })).toBeTruthy();
  }, 20000);
});
