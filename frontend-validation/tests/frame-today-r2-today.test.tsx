import type { ReactElement } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TextProvider } from '../../app/ui/src/app/text';
import type { Address, ColumnsChart, Language } from '../../app/ui/src/app/presentation';
import { frameTodayPlaces } from '../../app/ui/src/places/lane-frame-today';
import type { PlaceRenderProps } from '../../app/ui/src/places/types';
import { mountHost, type MountedHost } from '../../app/ui/src/host/bootstrap';
import { createHostController } from '../../app/ui/src/host/controller';
import { createFakeEngine, registerFakeMethods } from '../../app/ui/src/bridge/fake';
import { receiptIdFor } from '../../app/ui/src/bridge/fixtures/shop';
import type { CalculationReceiptEvidence } from '../../app/ui/src/bridge/presentation';
import type { ClosingReply } from '../../app/ui/src/bridge/todayx-contract';
import { TodayScreen } from '../../app/ui/src/screens/today/Today';
import { TodayDestination } from '../../app/ui/src/screens/today/TodayDestination';
import type { TodayData, TodayIntents } from '../../app/ui/src/screens/today/TodayData';
import { rupeesText } from '../../app/ui/src/screens/today/voice-cash';

// Synthetic demo shop and replies only; nothing reaches a network.
const cleanups: Array<() => void> = [];
beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(Error('No network in these checks'));
  vi.stubGlobal('matchMedia', (media: string) => ({ matches: false, media, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true }));
});
afterEach(async () => {
  await act(async () => { for (const undo of cleanups.splice(0)) undo(); });
  cleanup(); document.body.replaceChildren(); window.location.hash = '';
  expect(globalThis.fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals();
});

function show(ui: ReactElement, language: Language = 'en') {
  return render(<TextProvider language={language}>{ui}</TextProvider>);
}

/* ------------------------------------------------------------------ receipt small print */

test('the host receipt sheet shows small print read from todayx.receiptDetail for the open receipt', { timeout: 20000 }, async () => {
  const engine = createFakeEngine({ scenario: 'populated' });
  const controller = createHostController(engine, { todayProducer: await engine.todayProducer() });
  const container = document.createElement('div'); document.body.append(container);
  let mounted: MountedHost | null = null;
  await act(async () => { mounted = mountHost(container, controller, { view: 'guided' }); });
  cleanups.push(() => { mounted?.unmount(); controller.dispose(); container.remove(); });
  const user = userEvent.setup();
  const pageRegion = () => document.querySelector('[data-region="page"]') as HTMLElement;
  await screen.findByText('Send a payment reminder to Kiran Retail Demo', undefined, { timeout: 5000 });
  await user.click(within(pageRegion()).getByRole('button', { name: 'Prepare figures' }));
  const billed = await within(pageRegion()).findByText('₹25,36,850', undefined, { timeout: 5000 });
  await user.click(billed.closest('button')!);
  await waitFor(() => expect(document.querySelector('[data-region="sheet"] [data-small="recipe"]')).not.toBeNull(), { timeout: 5000 });
  const sheet = document.querySelector('[data-region="sheet"]') as HTMLElement;
  expect(engine.calls).toContain('todayx.receiptDetail');
  expect(sheet.querySelector('[data-small="recipe"]')?.textContent).toContain('recipe_demo_tally');
  expect(sheet.querySelector('[data-small="recipe"]')?.textContent).toContain('accepted by Asha Demo');
  expect(sheet.querySelector('[data-small="source"]')?.textContent).toContain('an exported file');
  expect(sheet.querySelector('[data-small="meaning"]')?.textContent).toMatch(/dictionary \d+ · published by Asha Demo/);
  expect(sheet.querySelector('[data-small="allowed"]')?.textContent).toContain('your read access');
  // Nothing the engine did not supply is drawn.
  for (const absent of ['rate', 'guard', 'route', 'forecast']) expect(sheet.querySelector(`[data-small="${absent}"]`)).toBeNull();
});

test('the Today destination sheet merges the detail for its receipt only, and keeps the receipt when the read fails', async () => {
  const engine = createFakeEngine({ scenario: 'populated' });
  const id = receiptIdFor('tile_billed');
  const receipt = await engine.request('receipts.get', { id }) as CalculationReceiptEvidence;
  const base = { page: null, origin: null, onClose: vi.fn(), onReview: vi.fn(), onNext: undefined, onFresh: vi.fn(), onReceipt: vi.fn(), timeZone: 'Asia/Kolkata' };
  const detail = { kind: 'receipt' as const, title: 'Billed', record: null, receiptIds: [id], receipt };
  show(<TodayDestination {...base} detail={detail} receiptDetailRpc={engine} />);
  await waitFor(() => expect(document.querySelector('[data-small="recipe"]')).not.toBeNull());
  expect(document.querySelector('[data-small="allowed"]')?.textContent).toContain('your read access');
  cleanup();
  const refusing = { request: vi.fn(async () => { throw Object.assign(Error('UNKNOWN_METHOD'), { code: 'UNKNOWN_METHOD' }); }) };
  show(<TodayDestination {...base} detail={detail} receiptDetailRpc={refusing} />);
  await waitFor(() => expect(refusing.request).toHaveBeenCalledWith('todayx.receiptDetail', { receiptId: id }));
  expect(document.querySelector('[data-small="source"]')).not.toBeNull();
  expect(document.querySelector('[data-small="recipe"]')).toBeNull();
  expect(document.querySelector('[data-small="allowed"]')).toBeNull();
  cleanup();
  const other = { request: vi.fn(async () => ({ receiptId: 'rcpt_other', allowedBy: { kind: 'read-access' } })) };
  show(<TodayDestination {...base} detail={detail} receiptDetailRpc={other} />);
  await waitFor(() => expect(other.request).toHaveBeenCalled());
  expect(document.querySelector('[data-small="allowed"]')).toBeNull();
});

/* ------------------------------------------------------------------ activity times */

test('activity times use the ui.context zone, and say UTC when the workspace names none', async () => {
  const event = { id: 'e1', at: '2026-10-14T06:05:00Z', type: 'answer.receipt', state: 'done', actor: { kind: 'chausar', name: null }, values: {},
    costPaise: null, route: null, tainted: false, proof: { kind: 'none', id: null } };
  const context = { workspace: { id: 'workspace-demo', name: 'Demo shop', demo: true }, member: { id: 'member-demo', name: 'Asha Demo', role: 'owner', epoch: 1, branches: ['*'] }, contextKey: 'b'.repeat(64) };
  const address: Address = { place: 'today', sub: 'activity' };
  const draw = (reply: unknown) => {
    const request = vi.fn(async (method: string) => (method === 'ui.context' ? reply : { events: [event], nextCursor: null, total: '1' }));
    const props: PlaceRenderProps = { address, language: 'en', view: 'guided', member: { id: 'member-demo', role: 'owner' }, viewer: false,
      rpc: { request }, live: () => true, openReceipt: vi.fn(), navigate: vi.fn() };
    show(<>{frameTodayPlaces.find((m) => m.handles(address))!.render(props)}</>);
  };
  draw({ ...context, timeZone: null });
  expect(await screen.findByText('14 Oct 2026, 06:05 UTC')).toBeTruthy();
  cleanup();
  draw({ ...context, timeZone: 'Asia/Kolkata' });
  expect(await screen.findByText('14 Oct 2026, 11:35')).toBeTruthy();
  cleanup();
  draw(context);
  expect(await screen.findByText('14 Oct 2026, 06:05 UTC')).toBeTruthy();
});

/* ------------------------------------------------------------------ the closing row */

const today = (fields: Partial<TodayData>): TodayData => ({
  state: { kind: 'ready' }, date: 'Wednesday, 14 October', review: { count: { exact: '0', display: '0' }, rows: [] }, ...fields,
});
const intents = (): TodayIntents => ({ onReview: vi.fn(), onReceipt: vi.fn() });
const closing = (on: boolean): ClosingReply => ({ on, day: '2026-10-14', parts: { cash: 'not-loaded-yet', bank: 'done', entries: 'not-done' } });

test('the closing row is drawn in Guided, Simple and Books while daily closing is on, and not when it is off', () => {
  for (const view of ['guided', 'simple', 'books'] as const) {
    const { container } = show(<TodayScreen data={today({ closing: closing(true) })} intents={intents()} view={view} onNavigate={vi.fn()} />);
    expect(screen.getByText('Close today: cash, bank, entries')).toBeTruthy();
    const state = (part: string) => container.querySelector(`[data-closing-part="${part}"]`)?.getAttribute('data-state');
    expect([state('cash'), state('bank'), state('entries')]).toEqual(['not-loaded-yet', 'done', 'not-done']);
    expect(container.querySelector('[data-closing-part="cash"]')?.textContent).toContain('not loaded yet');
    cleanup();
    show(<TodayScreen data={today({ closing: closing(false) })} intents={intents()} view={view} onNavigate={vi.fn()} />);
    expect(screen.queryByText('Close today: cash, bank, entries')).toBeNull();
    cleanup();
  }
  show(<TodayScreen data={today({ closing: closing(true) })} intents={intents()} view="guided" onNavigate={vi.fn()} />, 'hi');
  expect(screen.getByText('आज का हिसाब बंद करें: नकद, बैंक, प्रविष्टियां')).toBeTruthy();
});

test('cash told by the owner on Today counts as done in the closing row', () => {
  const told = { kind: 'money' as const, exact: '845000', display: '₹8,450', receiptId: 'R-told', labels: [] };
  const { container } = show(<TodayScreen data={today({ closing: closing(true), cash: { entered: told, week: week() } })} intents={intents()} view="simple" onNavigate={vi.fn()} />);
  expect(container.querySelector('[data-closing-part="cash"]')?.getAttribute('data-state')).toBe('done');
});

/* ------------------------------------------------------------------ cash by voice */

function week(): ColumnsChart {
  return { form: 'columns', sentence: 'Cash sales, last seven days', values: [
    { id: 'd1', label: 'Thu', value: { kind: 'money' as const, exact: '120000', display: '₹1,200', receiptId: 'R-d1', labels: [] } },
    { id: 'd7', label: 'Wed', value: { kind: 'missing', missing: 'cash-not-captured' } },
  ] };
}
const holdOnce = async (button: HTMLElement) => {
  await act(async () => { fireEvent.keyDown(button, { key: ' ' }); });
  await act(async () => { fireEvent.keyUp(button, { key: ' ' }); });
};

test('voice is off by default: no hold button, and off it opens the setting', async () => {
  const onSaveClosing = vi.fn();
  show(<TodayScreen data={today({ cash: { week: week() } })} intents={{ ...intents(), onSaveClosing }} view="simple" onNavigate={vi.fn()} />);
  expect(screen.queryByRole('button', { name: 'Hold to say it' })).toBeNull();
  cleanup();
  const onOpenSettings = vi.fn();
  const engine = createFakeEngine();
  show(<TodayScreen data={today({ cash: { week: week() } })} intents={{ ...intents(), onSaveClosing, cashVoice: { on: false, rpc: engine, onOpenSettings } }} view="simple" onNavigate={vi.fn()} />);
  expect(screen.queryByRole('button', { name: 'Hold to say it' })).toBeNull();
  await userEvent.setup().click(screen.getByRole('button', { name: 'Voice is off' }));
  expect(onOpenSettings).toHaveBeenCalledOnce();
  expect(onSaveClosing).not.toHaveBeenCalled();
});

test('cash by voice shows "not built yet" while modelsx.speechInterpret is absent', async () => {
  const engine = createFakeEngine();
  const onSaveClosing = vi.fn();
  const listen = { start: vi.fn(), stop: vi.fn(async () => 'do lakh') };
  show(<TodayScreen data={today({ cash: { week: week() } })} intents={{ ...intents(), onSaveClosing, cashVoice: { on: true, rpc: engine, listen } }} view="simple" onNavigate={vi.fn()} />);
  await holdOnce(screen.getByRole('button', { name: 'Hold to say it' }));
  expect(await screen.findByText('Not built yet.', { exact: false })).toBeTruthy();
  expect(listen.start).toHaveBeenCalledOnce();
  expect(onSaveClosing).not.toHaveBeenCalled();
});

/** A reading in the models-ext lane's real `modelsx.speechInterpret` shape (speech-understood.ts). */
const DIGEST = 'c'.repeat(64);
function reading(text: string, numbers: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}) {
  return { version: 1, normalised: text, understood: text, language: 'hi-Latn', segments: [{ kind: 'text', text }], negations: [], numbers, ambiguities: [], unclear: [],
    flipsMeaning: false, requiresConfirmation: true, digest: DIGEST, receiptId: null, ...extra };
}
const doLakh = { text: 'do lakh', start: 0, end: 7, value: '200000', integer: '200000', indian: '2,00,000', unit: null, paise: null, display: '2,00,000' };

test('cash by voice: the heard amount is shown back large and nothing is saved until Yes', async () => {
  const engine = createFakeEngine();
  const interpret = vi.fn((payload: Readonly<Record<string, unknown>>) => reading(String(payload['text']), [doLakh]));
  const confirm = vi.fn((payload: Readonly<Record<string, unknown>>) => ({ confirmationId: 'speech_confirmation_demo', digest: payload['digest'], understood: 'do lakh', receiptId: null, confirmedAt: '2026-10-14T06:05:00.000Z' }));
  cleanups.push(registerFakeMethods('modelsx', { speechInterpret: interpret, speechConfirm: confirm }));
  const onSaveClosing = vi.fn();
  const listen = { start: vi.fn(), stop: vi.fn(async () => 'do lakh') };
  const user = userEvent.setup();
  show(<TodayScreen data={today({ cash: { week: week() } })} intents={{ ...intents(), onSaveClosing, cashVoice: { on: true, rpc: engine, listen } }} view="simple" onNavigate={vi.fn()} />);
  await holdOnce(screen.getByRole('button', { name: 'Hold to say it' }));
  expect(await screen.findByText('₹2,00,000. Is that right?')).toBeTruthy();
  expect(interpret).toHaveBeenCalledWith({ text: 'do lakh' }, expect.anything());
  expect(screen.getByText('Heard: do lakh')).toBeTruthy();
  expect(onSaveClosing).not.toHaveBeenCalled();
  expect(confirm).not.toHaveBeenCalled();

  await user.click(screen.getByRole('button', { name: 'Change' }));
  expect(onSaveClosing).not.toHaveBeenCalled();
  expect(confirm).not.toHaveBeenCalled();
  expect(screen.queryByText('₹2,00,000. Is that right?')).toBeNull();

  await holdOnce(screen.getByRole('button', { name: 'Hold to say it' }));
  await screen.findByText('₹2,00,000. Is that right?');
  await user.click(screen.getByRole('button', { name: 'Yes' }));
  expect(await screen.findByText('Saved as told by owner.')).toBeTruthy();
  expect(confirm).toHaveBeenCalledExactlyOnceWith({ text: 'do lakh', digest: DIGEST }, expect.anything());
  expect(onSaveClosing).toHaveBeenCalledExactlyOnceWith('200000');
});

test('cash by voice: unclear, negated or bad readings and a refused confirmation save nothing', async () => {
  const engine = createFakeEngine();
  let reply: unknown = reading('kal dekhenge', []);
  cleanups.push(registerFakeMethods('modelsx', {
    speechInterpret: () => reply,
    speechConfirm: () => { throw Object.assign(Error('UNDERSTOOD_CHANGED'), { code: 'UNDERSTOOD_CHANGED' }); },
  }));
  const onSaveClosing = vi.fn();
  const listen = { start: vi.fn(), stop: vi.fn(async () => 'kal dekhenge') };
  const user = userEvent.setup();
  show(<TodayScreen data={today({ cash: { week: week() } })} intents={{ ...intents(), onSaveClosing, cashVoice: { on: true, rpc: engine, listen } }} view="simple" onNavigate={vi.fn()} />);
  const hold = () => holdOnce(screen.getByRole('button', { name: 'Hold to say it' }));
  await hold();
  expect(await screen.findByText('Not sure what was said. Heard: kal dekhenge')).toBeTruthy();
  reply = reading('do lakh nahi', [doLakh], { negations: [{ text: 'nahi', start: 8, end: 12, kind: 'negation', note: 'This flips the meaning.', ambiguous: false }], flipsMeaning: true });
  await hold();
  expect(await screen.findByText('Not sure what was said. Heard: do lakh nahi')).toBeTruthy();
  reply = { amount: { paise: '20000000' }, heard: 'x', confirm: true };
  await hold();
  expect(await screen.findByText('The amount could not be read. Type it instead.')).toBeTruthy();
  reply = reading('do lakh', [doLakh]);
  await hold();
  await user.click(await screen.findByRole('button', { name: 'Yes' }));
  expect(await screen.findByText('The amount could not be read. Type it instead.')).toBeTruthy();
  expect(onSaveClosing).not.toHaveBeenCalled();
  expect(rupeesText('123450')).toBe('1234.50');
});
