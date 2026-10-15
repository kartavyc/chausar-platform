import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { mountHost, type MountedHost } from '../../app/ui/src/host/bootstrap';
import { createHostController } from '../../app/ui/src/host/controller';
import { createFakeEngine, type FakeScenario } from '../../app/ui/src/bridge/fake';
import { createShellPort, type DesktopShellBridge } from '../../app/ui/src/bridge/shell';
import { TextProvider } from '../../app/ui/src/app/text';
import { Updates } from '../../app/ui/src/app/Updates';
import { RouteStates } from '../../app/ui/src/app/RouteStates';
import { words } from '../../app/ui/src/text/lanes/frame-today';
import type { UpdatesReply } from '../../app/ui/src/bridge/todayx-contract';

// Round 4, frame-today, through the actual host on the fake engine: SH-08 updates (Today's row, the sheet, the
// steps), SH-09 route states on Ask, New, and SH-11 the fault report after a crash with Save and Send. Synthetic only.
const en = words.en;
const cleanups: Array<() => void> = [];
function bridge(crash: 'crashed' | 'clean') {
  const saved: unknown[][] = [], answers: unknown[] = [];
  const desktop: DesktopShellBridge = {
    async openExternal() { return 'refused'; }, async print() { return 'refused'; },
    async saveText(kind, text) { saved.push([kind, text]); return 'saved'; },
    async crashState() { return crash; }, async crashAnswer(answer) { answers.push(answer); return 'answered'; },
  };
  return { desktop, saved, answers };
}
async function mountOnFake(scenario: FakeScenario, desktop: DesktopShellBridge, updateReady = false) {
  const engine = createFakeEngine({ scenario, updateReady });
  const controller = createHostController(engine, { todayProducer: await engine.todayProducer() });
  const container = document.createElement('div'); document.body.append(container);
  let mounted: MountedHost | null = null;
  await act(async () => { mounted = mountHost(container, controller, { view: 'guided', shell: createShellPort(desktop, null) }); });
  cleanups.push(() => { mounted?.unmount(); controller.dispose(); container.remove(); });
  return { engine, user: userEvent.setup() };
}
const inText = (ui: ReactElement, language: 'en' | 'hi' = 'en') => render(<TextProvider language={language}>{ui}</TextProvider>);

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(Error('No network in frame fixtures'));
  vi.stubGlobal('matchMedia', (media: string) => ({ matches: false, media, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true }));
});
afterEach(async () => {
  await act(async () => { for (const cleanup of cleanups.splice(0)) cleanup(); });
  document.body.replaceChildren(); window.location.hash = '';
  expect(globalThis.fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals();
});

test('after a crash the fault report opens once: Send report is refused in words, Save writes the shown text', { timeout: 20000 }, async () => {
  const shell = bridge('crashed');
  const { user, engine } = await mountOnFake('populated', shell.desktop);
  const dialog = await screen.findByRole('region', { name: en['SH-11.title'] }, { timeout: 5000 });
  const pre = await within(dialog).findByLabelText('The fault report as text');
  expect(pre.textContent).toContain('app 0.1.0-preview.1');
  await user.click(within(dialog).getByRole('button', { name: 'Send report' }));
  await within(dialog).findByText(en['SH-11.send-unavailable']!);
  expect(engine.calls).toContain('todayx.faultReport.send');
  expect(shell.answers).toEqual(['send']);
  // After the answer the question is gone; Save stays.
  expect(within(dialog).queryByRole('button', { name: 'Send report' })).toBeNull();
  await user.click(within(dialog).getByRole('button', { name: 'Save as a file' }));
  await within(dialog).findByText(en['SH-11.saved']!);
  expect(shell.saved).toHaveLength(1);
  expect(shell.saved[0]![0]).toBe('fault-report');
  expect(String(shell.saved[0]![1])).toMatch(/^No names, amounts, file names, cell values or questions are in this report\.\n\napp 0\.1\.0-preview\.1/);
});

test('without a crash nothing opens by itself, and Today offers "Update ready" whose Update runs the steps once', { timeout: 20000 }, async () => {
  const shell = bridge('clean');
  const { user, engine } = await mountOnFake('populated', shell.desktop, true);
  const row = await screen.findByText('Update ready. Your data is saved first.', undefined, { timeout: 5000 });
  expect(screen.queryByRole('region', { name: en['SH-11.title'] })).toBeNull();
  await user.click(row);
  await user.click(await screen.findByRole('button', { name: 'Update' }));
  const sheet = await screen.findByRole('region', { name: en['SH-08.title'] });
  within(sheet).getByText('Version 0.1.0-preview.2 is ready. Your data is saved first.');
  expect(engine.calls.filter(method => method.startsWith('todayx.updates.'))).toEqual([]);
  await user.click(within(sheet).getByRole('button', { name: 'Update' }));
  await within(sheet).findByText(en['SH-08.restart']!);
  expect(engine.calls.filter(method => method.startsWith('todayx.updates.'))).toEqual(['todayx.updates.stage', 'todayx.updates.apply']);
  expect(within(sheet).queryByRole('button', { name: 'Update' })).toBeNull();
});

test('Ask, New says which route cannot answer and why, with no sign-in button while signing in from here is not built', { timeout: 20000 }, async () => {
  const shell = bridge('clean');
  const { engine } = await mountOnFake('populated', shell.desktop);
  await screen.findByText('Send a payment reminder to Kiran Retail Demo', undefined, { timeout: 5000 });
  expect(screen.queryByText('Update ready. Your data is saved first.')).toBeNull();
  expect(engine.calls).not.toContain('models.probe');
  await act(async () => { window.location.hash = '#/ask/new'; });
  await screen.findByText('Your Codex tool is signed out. Sign in again.', undefined, { timeout: 5000 });
  screen.getByText('Skipped: this route would be sent samples, and Send is set to shape only.');
  screen.getByText('Signing in from here is not built yet. Open Codex tool and sign in there.');
  screen.getByText(en['SH-09.no-retry']!);
  expect(screen.queryByRole('button', { name: en['SH-09.sign-in'] })).toBeNull();
  expect(screen.queryByText('Local demo model is ready.')).toBeNull();
});

test('the Updates states say what happened in both languages and never offer Update where it cannot run', () => {
  const base: UpdatesReply = { state: 'ready', version: '1.0.0', channel: 'stable', expiresAt: null, candidate: '1.1.0', platform: 'mac', canUpdate: true };
  const onUpdate = vi.fn();
  const view = inText(<Updates reply={base} run={{ phase: 'refused', why: 'not-signed' }} onUpdate={onUpdate} />);
  screen.getByText(en['SH-08.refused.not-signed']!);
  expect(screen.queryByRole('button', { name: 'Update' })).toBeNull();
  view.rerender(<TextProvider language="en"><Updates reply={base} run={{ phase: 'refused', why: 'manual' }} onUpdate={onUpdate} /></TextProvider>);
  screen.getByText(en['SH-08.mac-unsigned']!);
  view.rerender(<TextProvider language="en"><Updates reply={{ ...base, state: 'rolled-back', candidate: null }} run={{ phase: 'idle' }} onUpdate={onUpdate} onDismiss={() => {}} /></TextProvider>);
  screen.getByText('The update did not finish. Your data is as it was.');
  screen.getByRole('button', { name: en['SH-08.dismiss'] });
  view.rerender(<TextProvider language="en"><Updates reply={{ ...base, state: 'older-than-vault', candidate: null }} run={{ phase: 'idle' }} /></TextProvider>);
  screen.getByText('This build is older than your vault. Update Chausar to open it.');
  view.rerender(<TextProvider language="en"><Updates reply={base} run={{ phase: 'saving' }} /></TextProvider>);
  const steps = screen.getByRole('list', { name: en['SH-08.steps'] });
  expect([...steps.querySelectorAll('li')].map(li => li.getAttribute('data-step-state'))).toEqual(['done', 'now', 'now']);
  view.rerender(<TextProvider language="en"><Updates reply={{ ...base, canUpdate: false }} run={{ phase: 'idle' }} onUpdate={onUpdate} /></TextProvider>);
  screen.getByText(en['SH-08.owner-only']!);
  expect(screen.queryByRole('button', { name: 'Update' })).toBeNull();
  view.rerender(<TextProvider language="hi"><Updates reply={{ ...base, state: 'rolled-back', candidate: null }} run={{ phase: 'idle' }} /></TextProvider>);
  screen.getByText(words.hi['SH-08.rolled-back']!);
  view.rerender(<TextProvider language="en"><Updates reply={{ ...base, state: 'not-built', candidate: null }} run={{ phase: 'idle' }} /></TextProvider>);
  screen.getByText('Not built yet.');
  expect(onUpdate).not.toHaveBeenCalled();
});

test('a route state row offers Sign in again only when a sign-in method was supplied, and says when a waiting job resumes', async () => {
  const user = userEvent.setup();
  const onSignIn = vi.fn();
  const reply = { checkedAt: '2026-09-30T06:00:00.000Z', routes: [
    { routeId: 'r1', label: 'Codex tool', kind: 'codex-cli', state: 'signed-out' as const, send: null, resumesAt: '2026-09-30T09:30:00.000Z' },
    { routeId: 'r2', label: 'Old tool', kind: 'claude-cli', state: 'version-not-tested' as const, send: null, resumesAt: null },
  ] };
  inText(<RouteStates reply={reply} timeZone="Asia/Kolkata" onSignIn={onSignIn} />);
  await user.click(screen.getByRole('button', { name: en['SH-09.sign-in'] }));
  expect(onSignIn).toHaveBeenCalledWith('r1');
  screen.getByText(/A job waiting on this route resumes at 15:00/);
  screen.getByText('This version of Old tool has not been tested with Chausar.');
  render(<TextProvider language="en"><RouteStates reply="not-built" timeZone={null} /></TextProvider>);
  screen.getByText(en['SH-09.not-built']!);
});
