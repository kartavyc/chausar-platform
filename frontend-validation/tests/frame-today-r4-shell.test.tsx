import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mountHost, type MountedHost } from '../../app/ui/src/host/bootstrap';
import { createHostController } from '../../app/ui/src/host/controller';
import { createFakeEngine, FAKE_PASSPHRASE, FAKE_SECOND_PASSPHRASE, registerFakeMethods, type FakeEngineOptions } from '../../app/ui/src/bridge/fake';
import { FAKE_JOIN_CODE, FAKE_PIN, FAKE_PIN_TRIES } from '../../app/ui/src/bridge/fixtures/r4';
import { learningxSharingHandlers } from '../../app/ui/src/bridge/fixtures/learningx';
import { TextProvider } from '../../app/ui/src/app/text';
import { words } from '../../app/ui/src/text/lanes/frame-today';
import { PinSettings } from '../../app/ui/src/screens/first-run/Pin';
import { LocalModels, RouteLadder, moveRoute } from '../../app/ui/src/screens/first-run/RouteLadder';
import { TimeZoneSetting } from '../../app/ui/src/screens/first-run/TimeZone';
import { SharingQuestion } from '../../app/ui/src/screens/first-run/Sharing';
import { JoinFromNew, JoinRequests } from '../../app/ui/src/screens/first-run/Join';
import en from '../../app/ui/src/text/en.json';

const w = (key: string, values: Record<string, string> = {}) => Object.entries(values).reduce((text, [name, value]) => text.replace(`{${name}}`, value), words.en[key] ?? (en as Record<string, string>)[key] ?? key);
const cleanups: Array<() => void> = [];

/** The populated demo shop, locked by the controller's own lock once it is open (the locked scenario has no meanings yet). */
async function mountJourneyHost(options: FakeEngineOptions, lockFirst = false) {
  const engine = createFakeEngine(options);
  const controller = createHostController(engine, { todayProducer: await engine.todayProducer() });
  const container = document.createElement('div'); document.body.append(container);
  let mounted: MountedHost | null = null;
  await act(async () => { mounted = mountHost(container, controller, { view: 'guided', firstRun: 'journey' }); });
  cleanups.push(() => { mounted?.unmount(); controller.dispose(); container.remove(); });
  if (lockFirst) {
    await screen.findByText('Send a payment reminder to Kiran Retail Demo', undefined, { timeout: 5000 });
    await act(async () => { await controller.lock(); });
  }
  return { engine, controller, user: userEvent.setup() };
}
const inEnglish = (node: React.ReactNode) => render(<TextProvider language="en">{node}</TextProvider>);

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(Error('No network on the fake engine'));
  vi.stubGlobal('matchMedia', (media: string) => ({ matches: false, media, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true }));
});
afterEach(async () => {
  await act(async () => { for (const cleanup of cleanups.splice(0)) cleanup(); });
  document.body.replaceChildren(); window.location.hash = '';
  expect(globalThis.fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals();
});

async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: w('SH-06.open') }, { timeout: 5000 }));
  return screen.findByRole('menu');
}

test('SH-06: switching locks the open workspace, then opens the chosen one with its own passphrase, and back', { timeout: 30000 }, async () => {
  const { user, engine } = await mountJourneyHost({ twoWorkspaces: true }, true);
  // Start: the host opens main itself, so it knows which folder is open.
  await screen.findByText('Your workspace is locked', undefined, { timeout: 5000 });
  await user.type(screen.getByLabelText(/passphrase/i), `${FAKE_PASSPHRASE}{Enter}`);
  await screen.findByText('Send a payment reminder to Kiran Retail Demo', undefined, { timeout: 5000 });

  let menu = await openMenu(user);
  const second = await within(menu).findByRole('menuitem', { name: /second-shop/ }, { timeout: 5000 });
  // The open one carries its own name and mark; the other is a folder name with no mark until opened.
  expect(within(menu).getByRole('menuitem', { name: /Demo shop/ }).textContent).toContain(w('SH-06.demo'));
  expect(second.textContent).toBe('second-shop');
  await user.click(second);

  // The lock never fails open: the engine was asked to lock, and the next screen is the chosen folder's lock.
  await screen.findByText('second-shop is locked', undefined, { timeout: 5000 });
  expect(engine.calls).toContain('workspace.lock');
  expect(screen.getByText(w('SH-06.switching', { folder: 'second-shop' }))).toBeTruthy();
  expect(screen.queryByText('Send a payment reminder to Kiran Retail Demo')).toBeNull();
  // Nothing is read across workspaces: main's passphrase does not open it.
  await user.type(screen.getByLabelText(/passphrase/i), `${FAKE_PASSPHRASE}{Enter}`);
  await screen.findByText(w('SH-02.wrong'), undefined, { timeout: 5000 });
  await user.type(screen.getByLabelText(/passphrase/i), `${FAKE_SECOND_PASSPHRASE}{Enter}`);
  await waitFor(() => expect(screen.getByRole('button', { name: w('SH-06.open') }).textContent).toContain('Second Demo shop'), { timeout: 5000 });

  menu = await openMenu(user);
  expect(within(menu).getByRole('menuitem', { name: /Second Demo shop/ }).textContent).toContain(w('SH-06.demo'));
  // main was opened earlier this session, so its mark is known now.
  const back = within(menu).getByRole('menuitem', { name: /^main/ });
  expect(back.textContent).toContain(w('SH-06.demo'));
  await user.click(back);
  await screen.findByText('Your workspace is locked', undefined, { timeout: 5000 });
  await user.type(screen.getByLabelText(/passphrase/i), `${FAKE_PASSPHRASE}{Enter}`);
  await waitFor(() => expect(screen.getByRole('button', { name: w('SH-06.open') }).textContent).toContain('Demo shop'), { timeout: 5000 });
});

test('SH-02: the PIN field shows only when a PIN is set; a wrong PIN says so, too many leave only the passphrase', { timeout: 30000 }, async () => {
  const { user } = await mountJourneyHost({ pins: ['main'] }, true);
  const field = await screen.findByLabelText(w('SH-02.pin.field'), undefined, { timeout: 5000 }) as HTMLInputElement;
  await user.type(field, '111111');
  await user.click(screen.getByRole('button', { name: w('SH-02.pin.unlock.btn') }));
  expect(field.value).toBe('');
  await screen.findByText(w('SH-02.pin.wrong'), undefined, { timeout: 5000 });
  expect(document.body.textContent).not.toMatch(/\d+ (tries|attempts)/);
  for (let attempt = 2; attempt <= FAKE_PIN_TRIES; attempt++) {
    const again = screen.queryByLabelText(w('SH-02.pin.field')) as HTMLInputElement | null;
    if (again === null) break;
    await user.type(again, '111111{Enter}');
    await waitFor(() => expect(again.value).toBe(''));
  }
  await screen.findByText(w('SH-02.pin.lockedOut'), undefined, { timeout: 5000 });
  expect(screen.queryByLabelText(w('SH-02.pin.field'))).toBeNull();
  await user.type(screen.getByLabelText(/passphrase/i), `${FAKE_PASSPHRASE}{Enter}`);
  await screen.findByText('Send a payment reminder to Kiran Retail Demo', undefined, { timeout: 5000 });
});

test('SH-02: the right PIN unlocks; no field without a PIN or without the method', { timeout: 20000 }, async () => {
  const { user } = await mountJourneyHost({ pins: ['main'] }, true);
  await user.type(await screen.findByLabelText(w('SH-02.pin.field'), undefined, { timeout: 5000 }), `${FAKE_PIN}{Enter}`);
  await screen.findByText('Send a payment reminder to Kiran Retail Demo', undefined, { timeout: 5000 });
  await act(async () => { for (const cleanup of cleanups.splice(0)) cleanup(); });
  document.body.replaceChildren();
  await mountJourneyHost({ scenario: 'locked', absent: ['workspace.pin.status'] });
  await screen.findByText('Your workspace is locked', undefined, { timeout: 5000 });
  await new Promise(resolve => setTimeout(resolve, 50));
  expect(screen.queryByLabelText(w('SH-02.pin.field'))).toBeNull();
});

test('TR-12: PinSettings sets a PIN with the passphrase, empties both fields, and removes it', async () => {
  const engine = createFakeEngine();
  inEnglish(<PinSettings rpc={engine} />);
  const user = userEvent.setup();
  await screen.findByText(w('TR-12.pin.none'));
  const pin = screen.getByLabelText(w('TR-12.pin.new')) as HTMLInputElement, pass = screen.getByLabelText(w('TR-12.pin.passphrase')) as HTMLInputElement;
  await user.type(pin, FAKE_PIN); await user.type(pass, 'wrong');
  await user.click(screen.getByRole('button', { name: w('TR-12.pin.set.btn') }));
  expect(pin.value).toBe(''); expect(pass.value).toBe('');
  await screen.findByText(w('TR-12.pin.wrongPassphrase'));
  await user.type(pin, FAKE_PIN); await user.type(pass, FAKE_PASSPHRASE);
  await user.click(screen.getByRole('button', { name: w('TR-12.pin.set.btn') }));
  await screen.findByText(w('TR-12.pin.saved'));
  expect(screen.getByText(w('TR-12.pin.on'))).toBeTruthy();
  await user.click(screen.getByRole('button', { name: w('TR-12.pin.remove.btn') }));
  await screen.findByText(w('TR-12.pin.removed'));
});

test('TR-12: PinSettings says "not built yet" without the method', async () => {
  inEnglish(<PinSettings rpc={createFakeEngine({ absent: ['workspace.pin.status'] })} />);
  await screen.findByText(w('TR-12.pin.notBuilt'));
});

const ROUTES = ['a', 'b', 'c'].map(name => ({ id: `route_${name}`, kind: 'ollama', model: `m-${name}`, enabled: true, installationVerified: false, label: `Route ${name.toUpperCase()}` }));

test('FR-05: the ladder reorders with the keyboard, keeps the focus, saves the order and checks a route', async () => {
  expect(moveRoute(['a', 'b'], 0, -1)).toEqual(['a', 'b']);
  expect(moveRoute(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
  const engine = createFakeEngine({ routes: ROUTES });
  inEnglish(<RouteLadder rpc={engine} />);
  const user = userEvent.setup();
  const first = await screen.findByRole('listitem', { name: /Route A, 1 of 3/ });
  first.focus();
  await user.keyboard('{Alt>}{ArrowDown}{/Alt}');
  await waitFor(() => expect(document.activeElement?.getAttribute('data-ladder-route')).toBe('route_a'));
  expect(screen.getByRole('listitem', { name: /Route A, 2 of 3/ })).toBeTruthy();
  expect(screen.getByText(w('FR-05.ladder.moved', { name: 'Route A', n: '2', total: '3' }))).toBeTruthy();
  await user.click(screen.getByRole('button', { name: `${w('FR-05.ladder.up.btn')}: Route C` }));
  await user.click(screen.getByRole('button', { name: w('FR-05.ladder.save.btn') }));
  await screen.findByText(w('FR-05.ladder.saved'));
  expect(((await engine.request('models.list', {})) as { id: string }[]).map(route => route.id)).toEqual(['route_b', 'route_c', 'route_a']);
  await user.click(screen.getByRole('button', { name: `${w('FR-05.ladder.check.btn')}: Route B` }));
  await screen.findByText(w('FR-05.ladder.probe.version-untested'));
});

test('FR-05: without models.setLadder the order says "not built yet"', async () => {
  inEnglish(<RouteLadder rpc={createFakeEngine({ routes: ROUTES, absent: ['models.setLadder', 'models.probe'] })} />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: `${w('FR-05.ladder.down.btn')}: Route A` }));
  await user.click(screen.getByRole('button', { name: w('FR-05.ladder.save.btn') }));
  await screen.findByText(w('FR-05.ladder.notBuilt'));
  await user.click(screen.getByRole('button', { name: `${w('FR-05.ladder.check.btn')}: Route A` }));
  await screen.findByText(w('FR-05.ladder.probe.notBuilt'));
});

test('FR-05: local models are listed and picked; unreachable and absent have their own words', async () => {
  const picked = vi.fn();
  const { unmount } = inEnglish(<LocalModels rpc={createFakeEngine()} onPick={picked} />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: `${w('FR-05.local.pick.btn')}: demo-small:3b` }));
  expect(picked).toHaveBeenCalledWith('demo-small:3b');
  expect(screen.getByText(w('FR-05.local.size', { size: '2.0' }))).toBeTruthy();
  unmount();
  const unreachable = inEnglish(<LocalModels rpc={{ request: async () => ({ reachable: false, words: 'Ollama is not running.' }) }} onPick={picked} />);
  await screen.findByText(w('FR-05.local.unreachable'));
  expect(screen.queryByText('Ollama is not running.')).toBeNull();
  unreachable.unmount();
  inEnglish(<LocalModels rpc={createFakeEngine({ absent: ['modelsx.localList'] })} onPick={picked} />);
  await screen.findByText(w('FR-05.local.notBuilt'));
});

test('the time zone: the machine zone is only a suggestion until confirmed; saved reaches ui.context; absent says not built', async () => {
  let stored: string | null = null;
  const setZone = vi.fn(async (payload: Record<string, unknown>) => { stored = String(payload['timeZone']); return { timeZone: stored }; });
  const rpc = { request: async (method: string, payload: Record<string, unknown>) => method === 'ui.context' ? { timeZone: stored } : setZone(payload) };
  const saved = vi.fn();
  inEnglish(<TimeZoneSetting rpc={rpc} suggest={() => 'Asia/Kolkata'} onSaved={saved} />);
  const user = userEvent.setup();
  await screen.findByText(w('TZ.none'));
  expect(screen.getByText(w('TZ.suggested', { zone: 'Asia/Kolkata' }))).toBeTruthy();
  expect(setZone).not.toHaveBeenCalled();
  await user.selectOptions(screen.getByLabelText(w('TZ.field')), 'Europe/London');
  await user.click(screen.getByRole('button', { name: w('TZ.save.btn') }));
  await screen.findByText(w('TZ.saved', { zone: 'Europe/London' }));
  expect(setZone).toHaveBeenCalledWith({ timeZone: 'Europe/London' });
  expect(saved).toHaveBeenCalledWith('Europe/London');
  expect(screen.getByText(w('TZ.current', { zone: 'Europe/London' }))).toBeTruthy();
});

test('the time zone on the fake engine, and without the method', async () => {
  const engine = createFakeEngine({ absent: ['workspace.setTimeZone'] });
  inEnglish(<TimeZoneSetting rpc={engine} suggest={() => null} />);
  const user = userEvent.setup();
  await screen.findByText(w('TZ.current', { zone: 'Asia/Kolkata' }));
  await user.click(screen.getByRole('button', { name: w('TZ.save.btn') }));
  await screen.findByText(w('TZ.notBuilt'));
});

test('FR-10: both boxes start empty; leaving them empty goes on; ticked while intake is closed, nothing is sent', async () => {
  const engine = createFakeEngine();
  const remove = registerFakeMethods('learningx', learningxSharingHandlers({ mode: 'closed' }));
  cleanups.push(remove);
  const onContinue = vi.fn();
  inEnglish(<SharingQuestion rpc={engine} onContinue={onContinue} />);
  const user = userEvent.setup();
  await screen.findByText(w('FR-10.others'));
  const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
  expect(boxes.map(box => box.checked)).toEqual([false, false]);
  await user.click(screen.getByRole('button', { name: w('FR-10.file.btn') }));
  const file = await screen.findByText(/chausar\.learning\.v1/);
  expect(file.tagName).toBe('PRE');
  await user.click(screen.getByLabelText(w('FR-10.box.setup-shapes')));
  await user.click(screen.getByRole('button', { name: w('FR-10.continue.btn') }));
  await screen.findByText(w('FR-10.closed'));
  expect(engine.calls).not.toContain('learningx.consent');
  expect(onContinue).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: w('FR-10.continue.btn') }));
  expect(onContinue).toHaveBeenCalledOnce();
});

test('FR-10: a demo workspace needs its test switch; with it, consent names the exact file shown', async () => {
  const engine = createFakeEngine();
  cleanups.push(registerFakeMethods('learningx', learningxSharingHandlers({ mode: 'test-inbox', sharingSwitch: true })));
  inEnglish(<SharingQuestion rpc={engine} onContinue={() => {}} />);
  const user = userEvent.setup();
  await user.click(await screen.findByLabelText(w('FR-10.box.corrections')));
  await user.click(screen.getByRole('button', { name: w('FR-10.continue.btn') }));
  await screen.findByText(w('FR-10.closed'));
  await user.click(screen.getByLabelText(w('FR-10.demoTest')));
  await user.click(screen.getByRole('button', { name: w('FR-10.continue.btn') }));
  await screen.findByText(w('FR-10.agreed'));
  expect(engine.calls.filter(method => method === 'learningx.consent')).toHaveLength(1);
});

test('FR-10: without learning-ext the step says not built and Continue still goes on', async () => {
  const onContinue = vi.fn();
  inEnglish(<SharingQuestion rpc={createFakeEngine({ absent: ['learningx.intakeStatus', 'learningx.preview', 'learningx.consent', 'learningx.submit'] })} onContinue={onContinue} />);
  await screen.findByText(w('FR-10.notBuilt'));
  fireEvent.click(screen.getByRole('button', { name: w('FR-10.continue.btn') }));
  expect(onContinue).toHaveBeenCalledOnce();
});

test('FR-14: the new computer shows a code; the computer already in compares it and approves; then it opens', async () => {
  const engine = createFakeEngine();
  const opened = vi.fn();
  inEnglish(<JoinFromNew rpc={engine} language="en" onBack={() => {}} onOpenFolder={opened} />);
  const user = userEvent.setup();
  expect((await screen.findAllByText(FAKE_JOIN_CODE)).length).toBe(1);
  await screen.findByText(w('FR-14.waiting'));
  // On the computer already in, the same code to compare, with Approve.
  const requests = render(<TextProvider language="en"><JoinRequests rpc={engine} /></TextProvider>);
  const approve = await within(requests.container).findByRole('button', { name: `${w('FR-14.approve.btn')}: ${FAKE_JOIN_CODE}` });
  expect(within(requests.container).getByText(w('FR-14.requests.code', { code: FAKE_JOIN_CODE }))).toBeTruthy();
  await user.click(approve);
  await within(requests.container).findByText(w('FR-14.approve.done'));
  await user.click(screen.getByRole('button', { name: w('FR-14.check.btn') }));
  await screen.findByText(w('FR-14.approved'));
  await user.click(screen.getByRole('button', { name: w('FR-14.open.btn') }));
  expect(opened).toHaveBeenCalledWith('joined-shop');
});

test('FR-14: after 15 minutes the code is expired; without the method it is not built', async () => {
  const engine = createFakeEngine();
  const { unmount } = inEnglish(<JoinFromNew rpc={engine} language="en" onBack={() => {}} now={() => Date.now() + 16 * 60_000} />);
  await screen.findByText(w('FR-14.expired'));
  expect(screen.getByRole('button', { name: w('FR-14.again.btn') })).toBeTruthy();
  unmount();
  inEnglish(<JoinFromNew rpc={createFakeEngine({ absent: ['devices.join'] })} language="en" onBack={() => {}} />);
  await screen.findByText(w('FR-14.notBuilt'));
});
