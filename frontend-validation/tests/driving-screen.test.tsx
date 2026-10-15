import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TextProvider } from '../../app/ui/src/app/text';
import type { Address, Language } from '../../app/ui/src/app/presentation';
import { drivingPlaces } from '../../app/ui/src/places/lane-driving';

// Every reply is synthetic, shaped by the driving lane's session.* contract.
type Handler = (payload: Record<string, unknown>) => unknown;
const refuse = (code: string) => Object.assign(new Error(code), { code });
function fakeRpc(handlers: Record<string, Handler>) {
  return { request: vi.fn(async (method: string, payload: Record<string, unknown>) => { const h = handlers[method]; if (!h) throw refuse('UNKNOWN_METHOD'); return h(payload); }) };
}
const ADDRESS: Address = { place: 'work', sub: 'screen-driving' };
function show(handlers: Record<string, Handler>, opts: { language?: Language; role?: string } = {}) {
  const rpc = fakeRpc(handlers);
  const navigate = vi.fn();
  const language = opts.language ?? 'en';
  const role = opts.role ?? 'owner';
  const module = drivingPlaces.find(m => m.handles(ADDRESS));
  if (!module) throw new Error('no module');
  render(
    <TextProvider language={language}>
      {module.render({ address: ADDRESS, language, view: 'guided', viewer: role === 'viewer', rpc, member: { id: 'member-1', role }, live: () => true, openReceipt: () => {}, navigate })}
    </TextProvider>,
  );
  return { rpc, navigate };
}
beforeEach(() => { vi.stubGlobal('matchMedia', (media: string) => ({ matches: false, media, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true })); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const RULES = { windows: 1, mode: 'read-export', typesSecrets: false };
const DRIVER = { platform: 'x11', available: true, code: null, reason: null, stopKey: 'Ctrl+Alt+Pause', rules: RULES };
const step = (text: string, state = 'done', at = '2026-10-14T10:00:00Z') => ({ at, text, state });
const IDLE = { state: 'idle', window: null, steps: [], reason: null, sessionId: null, plan: null, startedAt: null, exports: [] };
const RUNNING = { state: 'driving', window: { id: 'w1', title: '<b>Tally Prime</b>' }, steps: [step('Opened the day book', 'running')], reason: null, sessionId: 's9', plan: 'tally-daybook', startedAt: '2026-10-14T10:00:00Z', exports: [] };
const PLANS = { plans: [
  { id: 'tally-daybook', title: 'Tally day book', app: 'Tally Prime', groups: ['vouchers'], produces: 'A day book XML file', status: 'experimental', steps: ['Open Display, Day Book', 'Export as XML'] },
  { id: 'busy-ledger', title: 'Busy ledger', app: 'Busy', groups: [], produces: 'A ledger file', status: 'tested-synthetic', steps: ['Open the ledger'] },
] };
const HISTORY = { sessions: [
  { id: 'old', window: { title: 'Busy, ledger window', app: 'Busy' }, plan: 'busy-ledger', startedAt: '2026-10-01T09:00:00Z', endedAt: '2026-10-01T09:05:00Z', state: 'stopped-by-key', reason: null, steps: [step('Opened the ledger', 'done', '2026-10-01T09:01:00Z')], exports: [] },
  { id: 'new', window: { title: 'Tally Prime window', app: 'Tally Prime' }, plan: 'tally-daybook', startedAt: '2026-10-12T09:00:00Z', endedAt: '2026-10-12T09:04:00Z', state: 'done', reason: null,
    steps: [step('Opened the day book', 'done', '2026-10-12T09:01:00Z'), step('Exported the day book', 'done', '2026-10-12T09:03:00Z')], exports: [{ id: 'e1', name: 'daybook.xml', bytes: 12000 }] },
] };
const EXPORTS = { exports: [{ id: 'e1', sessionId: 'new', name: '<script>daybook</script>.xml', mediaType: 'application/xml', bytes: 12000, at: '2026-10-12T09:03:00Z', sha256: 'a'.repeat(64) }] };
const all = (extra: Record<string, Handler> = {}): Record<string, Handler> => ({
  'session.driver': () => DRIVER, 'session.status': () => IDLE, 'session.plans': () => PLANS, 'session.history': () => HISTORY, 'session.exports': () => EXPORTS, ...extra,
});

test('an available driver: this computer can drive, plans with their labels, and the rules are always shown', async () => {
  const { navigate } = show(all());
  expect(await screen.findByText('Chausar can drive one window on this computer.')).toBeTruthy();
  expect(screen.getByText('Driver: Linux, X11')).toBeTruthy();
  expect(screen.getByText('Stop key: Ctrl+Alt+Pause')).toBeTruthy();
  expect(screen.getByText('No session is running.')).toBeTruthy();
  const plan = (await screen.findByText('Tally day book')).closest('[data-plan]') as HTMLElement;
  expect(within(plan).getByText('Program: Tally Prime')).toBeTruthy();
  expect(within(plan).getByText('Makes: A day book XML file')).toBeTruthy();
  expect(within(plan).getByText('Export as XML')).toBeTruthy();
  expect(within(plan).getByText('experimental')).toBeTruthy();
  const tested = screen.getByText('Busy ledger').closest('[data-plan]') as HTMLElement;
  expect(within(tested).getByText('tested on synthetic data')).toBeTruthy();
  expect(screen.getByText(/One window only\. Read and export only\./)).toBeTruthy();
  expect(screen.getByText('To stop: Ctrl Alt Pause, Stop on the strip, or Stop in the tray.')).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: 'Go to driving' }));
  expect(navigate).toHaveBeenCalledWith({ place: 'work', sub: 'driving' });
});

test('an unavailable driver shows the engine reason as text, with its code', async () => {
  show(all({ 'session.driver': () => ({ ...DRIVER, platform: null, available: false, code: 'DRIVER_WAYLAND', reason: 'This desktop uses Wayland, which cannot be driven.' }) }));
  expect(await screen.findByText('Chausar cannot drive on this computer.')).toBeTruthy();
  expect(screen.getByText('This desktop uses Wayland, which cannot be driven.')).toBeTruthy();
  expect(screen.getByText('Code: DRIVER_WAYLAND')).toBeTruthy();
  expect(screen.queryByText(/^Driver:/)).toBeNull();
});

test('UNKNOWN_METHOD shows not built yet and still the rules', async () => {
  const { rpc } = show({});
  expect(await screen.findByText('Driving a program is not built yet on this computer.')).toBeTruthy();
  expect(screen.getByText(/One window only/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
  expect(rpc.request).toHaveBeenCalledWith('session.driver', {});
});

test('a malformed reply shows Failed and draws none of it', async () => {
  show(all({ 'session.plans': () => ({ plans: [{ ...PLANS.plans[0], status: 'supported' }] }) }));
  expect(await screen.findByText('Code INVALID_REPLY')).toBeTruthy();
  expect(screen.queryByText('Tally day book')).toBeNull();
});

test('a running session links to WK-14 and Stop calls session.stop, then reads again', async () => {
  let running = true;
  const { rpc } = show(all({ 'session.status': () => (running ? RUNNING : IDLE), 'session.stop': () => { running = false; return { state: 'stopped' }; } }));
  const box = (await screen.findByText('A session is running now.')).closest('[data-session-running]') as HTMLElement;
  // The window title is outside text: drawn as text, never as markup.
  expect(within(box).getByText('Window: <b>Tally Prime</b>')).toBeTruthy();
  expect(box.querySelector('b')).toBeNull();
  expect(within(box).getByRole('button', { name: 'Go to driving' })).toBeTruthy();
  await userEvent.click(within(box).getByRole('button', { name: 'Stop' }));
  await waitFor(() => expect(rpc.request).toHaveBeenCalledWith('session.stop', {}));
  expect(await screen.findByText('No session is running.')).toBeTruthy();
});

test('a refused Stop says so with its short code', async () => {
  show(all({ 'session.status': () => RUNNING, 'session.stop': () => { throw refuse('SESSION_NOT_RUNNING'); } }));
  await userEvent.click(await screen.findByRole('button', { name: 'Stop' }));
  expect((await screen.findByRole('alert')).textContent).toBe('That did not work. Code: SESSION_NOT_RUNNING');
});

test('earlier sessions come newest first and each opens to its steps', async () => {
  show(all());
  const list = (await screen.findByText('Tally Prime window')).closest('[data-history]') as HTMLElement;
  const items = within(list).getAllByRole('listitem');
  expect(items[0]!.textContent).toContain('Tally Prime window');
  expect(items[1]!.textContent).toContain('Busy, ledger window');
  await userEvent.click(within(list).getByText('Tally Prime window'));
  const sheet = (await screen.findByText('Exported the day book')).closest('[data-region=sheet]') as HTMLElement;
  expect(sheet).toBeTruthy();
  expect(within(sheet).getByText('Exported the day book')).toBeTruthy();
  expect(within(sheet).getByText('Program: Tally Prime')).toBeTruthy();
  expect(within(sheet).getByText('daybook.xml')).toBeTruthy();
});

test('waiting exports: names as text, Discard calls session.discardExport with the export id', async () => {
  let files = EXPORTS.exports;
  const { rpc } = show(all({ 'session.exports': () => ({ exports: files }), 'session.discardExport': () => { files = []; return { discarded: true }; } }));
  expect(await screen.findByText('<script>daybook</script>.xml')).toBeTruthy();
  expect(document.querySelector('[data-export] script')).toBeNull();
  expect(screen.getByText('Read these in from Books, Sources. Each is deleted after a day.')).toBeTruthy();
  expect(screen.getByText(/application\/xml, 12,000 bytes/)).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: 'Discard' }));
  await waitFor(() => expect(rpc.request).toHaveBeenCalledWith('session.discardExport', { exportId: 'e1' }));
  expect(await screen.findByText('No exports are waiting.')).toBeTruthy();
});

test('a viewer seat sees the record and no Stop or Discard', async () => {
  const { rpc } = show(all({ 'session.status': () => RUNNING }), { role: 'viewer' });
  expect(await screen.findByText('A session is running now.')).toBeTruthy();
  expect(await screen.findByText('<script>daybook</script>.xml')).toBeTruthy();
  expect(screen.getByText('Your seat can look here but not change anything.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Discard' })).toBeNull();
  expect(rpc.request.mock.calls.some(([method]) => method === 'session.stop' || method === 'session.discardExport')).toBe(false);
});

test('Hindi renders the same page in Hindi', async () => {
  show(all({ 'session.status': () => RUNNING }), { language: 'hi' });
  expect(await screen.findByRole('heading', { name: 'स्क्रीन चलाना' })).toBeTruthy();
  expect(await screen.findByText('चौसर इस कंप्यूटर पर एक विंडो चला सकता है।')).toBeTruthy();
  expect(screen.getByText('अभी एक सेशन चल रहा है।')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'रोकें' })).toBeTruthy();
  expect(screen.getAllByRole('button', { name: 'हटाएँ' }).length).toBe(1);
  expect(screen.getByText('पिछले सेशन')).toBeTruthy();
  expect(screen.queryByText('Earlier sessions')).toBeNull();
});
