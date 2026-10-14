import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mountHost } from '../../app/ui/src/host/bootstrap';
import type { MountedHost } from '../../app/ui/src/host/bootstrap';
import { createHostController } from '../../app/ui/src/host/controller';
import { createFakeEngine, FAKE_PASSPHRASE } from '../../app/ui/src/bridge/fake';
import type { FakeScenario } from '../../app/ui/src/bridge/fake';

// The actual host on the fake engine: synthetic demo shop only, no network, no vault.
const cleanups: Array<() => void> = [];
async function mountOnFake(scenario: FakeScenario = 'populated') {
  const engine = createFakeEngine({ scenario });
  const controller = createHostController(engine, { todayProducer: await engine.todayProducer() });
  const container = document.createElement('div'); document.body.append(container);
  let mounted: MountedHost | null = null;
  await act(async () => { mounted = mountHost(container, controller, { view: 'guided' }); });
  cleanups.push(() => { mounted?.unmount(); controller.dispose(); container.remove(); });
  return { engine, controller, container, user: userEvent.setup() };
}
const page = () => {
  const main = document.querySelector('[data-region="page"]');
  if (!(main instanceof HTMLElement)) throw Error('The frame page region is missing.');
  return main;
};

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(Error('No network on the fake engine'));
  vi.stubGlobal('matchMedia', (media: string) => ({ matches: false, media, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true }));
});
afterEach(async () => {
  await act(async () => { for (const cleanup of cleanups.splice(0)) cleanup(); });
  document.body.replaceChildren(); window.location.hash = '';
  expect(globalThis.fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals();
});

test('Today on the fake engine shows the review rows, prepares the three figures and opens a receipt', { timeout: 20000 }, async () => {
  const { user, engine } = await mountOnFake();
  await screen.findByText('Send a payment reminder to Kiran Retail Demo', undefined, { timeout: 5000 });
  expect(within(page()).getByText('Record an invoice for Meera Textiles Demo')).toBeTruthy();
  expect(within(page()).getByText('Refund Arjun Stores Demo for a return')).toBeTruthy();
  // Worth a look now comes from todayx.worthALook: the due date is one of its rows at rest.
  await within(page()).findByText(/GSTR-3B/, undefined, { timeout: 5000 });
  await user.click(within(page()).getByRole('button', { name: 'Prepare figures' }));
  const billed = await within(page()).findByText('₹25,36,850', undefined, { timeout: 5000 });
  expect(within(page()).getByText('₹20,18,000')).toBeTruthy();
  expect(within(page()).getByText('₹1,86,530')).toBeTruthy();
  expect(engine.calls).toContain('today.prepareTiles');
  const figure = billed.closest('button');
  if (!(figure instanceof HTMLButtonElement)) throw Error('A known figure is a button that opens its receipt.');
  await user.click(figure);
  await waitFor(() => expect(document.querySelector('[data-region="sheet"]')).not.toBeNull(), { timeout: 5000 });
  const sheet = document.querySelector('[data-region="sheet"]') as HTMLElement;
  await waitFor(() => expect(sheet.textContent).toContain('rcpt_tile_billed'));
  expect(sheet.textContent).toContain('253685000');
  expect(engine.calls).toContain('receipts.get');
  expect(window.location.hash).toContain('sheet=today-proof');
});

test('a place whose engine methods do not exist yet shows "not built yet"', async () => {
  await mountOnFake();
  await screen.findByText('Send a payment reminder to Kiran Retail Demo', undefined, { timeout: 5000 });
  await act(async () => { window.location.hash = '#/books/sources'; });
  await waitFor(() => expect(within(page()).getByText(/^Not built yet\./)).toBeTruthy(), { timeout: 5000 });
  await act(async () => { window.location.hash = '#/tools/smallapps'; });
  await waitFor(() => expect(within(page()).getByText(/^Not built yet\./)).toBeTruthy(), { timeout: 5000 });
});

test('the empty scenario shows missing words, never zeros or invented amounts', async () => {
  const { user } = await mountOnFake('empty');
  await waitFor(() => expect(within(page()).getByRole('button', { name: 'Prepare figures' })).toBeTruthy(), { timeout: 5000 });
  await user.click(within(page()).getByRole('button', { name: 'Prepare figures' }));
  await waitFor(() => expect(within(page()).getByText('Billed')).toBeTruthy(), { timeout: 5000 });
  const text = page().textContent ?? '';
  expect(text).toContain('not sure');
  expect(within(page()).getAllByText('not sure').length).toBeGreaterThanOrEqual(3);
  expect(text).not.toContain('₹');
  const figures = [...page().querySelectorAll('.fig')].map(element => (element.textContent ?? '').trim());
  expect(figures.filter(value => /^[₹-]?\s*0(?:[.,]0+)?$/.test(value))).toEqual([]);
  expect(page().querySelectorAll('button.fig').length).toBe(0);
});

test('the product entry locks an existing workspace behind the lock screen and unlocks it once per press', { timeout: 20000 }, async () => {
  const engine = createFakeEngine({ scenario: 'locked' });
  const controller = createHostController(engine, { todayProducer: await engine.todayProducer() });
  const container = document.createElement('div'); document.body.append(container);
  let mounted: MountedHost | null = null;
  await act(async () => { mounted = mountHost(container, controller, { view: 'guided', firstRun: 'journey' }); });
  cleanups.push(() => { mounted?.unmount(); controller.dispose(); container.remove(); });
  const user = userEvent.setup();
  await screen.findByText('Your workspace is locked', undefined, { timeout: 5000 });
  expect(document.querySelector('[data-region="page"]')).toBeNull();
  const field = screen.getByLabelText(/passphrase/i) as HTMLInputElement;
  await user.type(field, 'not-the-passphrase{Enter}');
  await screen.findByText(/not the passphrase/, undefined, { timeout: 5000 });
  expect(field.value).toBe('');
  expect(engine.calls.filter(method => method === 'workspace.open')).toHaveLength(1);
  await user.type(screen.getByLabelText(/passphrase/i), `${FAKE_PASSPHRASE}{Enter}`);
  await waitFor(() => expect(screen.queryByText('Your workspace is locked')).toBeNull(), { timeout: 5000 });
  expect(engine.calls.filter(method => method === 'workspace.open')).toHaveLength(2);
});

test('the receipt sheet draws the six-part receipt and its every field one press away', { timeout: 20000 }, async () => {
  const { user } = await mountOnFake();
  await screen.findByText('Send a payment reminder to Kiran Retail Demo', undefined, { timeout: 5000 });
  await user.click(within(page()).getByRole('button', { name: 'Prepare figures' }));
  const billed = await within(page()).findByText('₹25,36,850', undefined, { timeout: 5000 });
  await user.click(billed.closest('button')!);
  await waitFor(() => expect(document.querySelector('[data-region="sheet"] details')).not.toBeNull(), { timeout: 5000 });
  const sheet = document.querySelector('[data-region="sheet"]') as HTMLElement;
  const details = sheet.querySelector('details') as HTMLDetailsElement;
  expect(details.open).toBe(false);
  expect(within(sheet).getByText('Every field')).toBeTruthy();
  const figure = [...sheet.querySelectorAll('button')].find(button => (button.textContent ?? '').includes('₹25,36,850'));
  expect(figure).toBeTruthy();
  await user.click(figure!);
  expect(details.open).toBe(true);
});

test('a lane place module wins its address and the retained lesson review keeps its own, Reports · Lessons', { timeout: 20000 }, async () => {
  const { engine } = await mountOnFake();
  await screen.findByText('Send a payment reminder to Kiran Retail Demo', undefined, { timeout: 5000 });
  for (const hash of ['#/reports/weekahead', '#/work/approvals']) {
    const before = engine.calls.length;
    await act(async () => { window.location.hash = hash; });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 200)); });
    expect(engine.calls.slice(before)).not.toContain('memory.lessons');
  }
  const before = engine.calls.length;
  await act(async () => { window.location.hash = '#/reports/lessons'; });
  await waitFor(() => expect(engine.calls.slice(before)).toContain('memory.lessons'), { timeout: 5000 });
  expect(within(page()).getByRole('heading', { name: 'Lessons' })).toBeTruthy();
});

test('locking after first run shows the lock screen again, never the create form or workspace data', { timeout: 20000 }, async () => {
  const engine = createFakeEngine({ scenario: 'populated' });
  const controller = createHostController(engine, { todayProducer: await engine.todayProducer() });
  const container = document.createElement('div'); document.body.append(container);
  let mounted: MountedHost | null = null;
  await act(async () => { mounted = mountHost(container, controller, { view: 'guided', firstRun: 'journey' }); });
  cleanups.push(() => { mounted?.unmount(); controller.dispose(); container.remove(); });
  await screen.findByText('Send a payment reminder to Kiran Retail Demo', undefined, { timeout: 5000 });
  await act(async () => { await controller.lock(); });
  await screen.findByText('Your workspace is locked', undefined, { timeout: 5000 });
  expect(screen.queryByText('Send a payment reminder to Kiran Retail Demo')).toBeNull();
  expect(document.querySelector('[data-first-run-create]')).toBeNull();
  expect(document.querySelector('[data-region="page"]')).toBeNull();
});
