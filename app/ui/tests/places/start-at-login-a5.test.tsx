import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { createFakeBackground } from '../../src/engine/fake-background';
import type { EngineClient } from '../../src/engine/types';
import { answerSideWork } from './first-run-steps';

/**
 * One-shot A5 (founder answer 5; hands-on rows 4, 88, 114, S12, bug 8): start at login is asked in onboarding, ticked by
 * default, and nothing is registered until the owner goes on. Business > Notifications shows it and Keep running as
 * switches, with the computer's own state. Only the installed app has them; elsewhere nothing shows.
 */
const TICK = 'Start Chausar when I sign in to this computer';
const SWITCH = 'Start Chausar when you sign in to this computer';
const TRAY = 'Keep running in the tray when you close the window';

function timeZone(zone: string) {
  const original = Intl.DateTimeFormat.prototype.resolvedOptions;
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function (this: Intl.DateTimeFormat) {
    return { ...original.call(this), timeZone: zone };
  });
}
function start(options: { fresh?: boolean; hash?: string; computer?: ReturnType<typeof createFakeBackground> | null } = {}) {
  window.location.hash = options.hash ?? '#/today';
  const fake = createFakeClient(new FakeEngine({ fresh: options.fresh ?? true }));
  const computer = options.computer === undefined ? createFakeBackground() : options.computer;
  const client: EngineClient = { ...fake, ...(computer ? { getBackground: computer.getBackground, setBackground: computer.setBackground } : {}) };
  render(<App client={client} language="en" />);
  return { computer };
}
async function press(name: string | RegExp) { const button = await screen.findByRole('button', { name }, { timeout: 4000 }); await act(async () => { fireEvent.click(button); }); }
async function toServices() {
  timeZone('Asia/Kolkata');
  await press('Skip for now: use templates');
  await press(/^Teaching and coaching/);
  await press('Keep this plan');
  await answerSideWork();
  await screen.findByRole('heading', { level: 1, name: 'Connect what your business needs' }, { timeout: 4000 });
}

afterEach(() => { vi.restoreAllMocks(); });

describe('first run: start at login (A5)', () => {
  it('asks on the services step, ticked, and registers it only when the owner goes on', async () => {
    const { computer } = start();
    await toServices();
    const tick = await screen.findByRole('checkbox', { name: TICK }, { timeout: 4000 }) as HTMLInputElement;
    expect(tick.checked).toBe(true);
    expect(screen.getByText('It opens quietly in the tray, so scheduled work keeps going. Change it any time in Business, Notifications.')).toBeTruthy();
    expect(computer!.changes).toEqual([]);
    await press('Go to Today');
    await waitFor(() => expect(computer!.changes).toEqual([{ startAtLogin: true }]), { timeout: 4000 });
    expect(computer!.computer.registered).toBe(true);
  }, 20000);

  it('unticked, it saves the no and registers nothing', async () => {
    const { computer } = start();
    await toServices();
    await act(async () => { fireEvent.click(await screen.findByRole('checkbox', { name: TICK }, { timeout: 4000 })); });
    await press('Go to Today');
    await waitFor(() => expect(computer!.changes).toEqual([{ startAtLogin: false }]), { timeout: 4000 });
    expect(computer!.computer.registered).toBe(false);
  }, 20000);

  it('is not asked again on a computer that answered, nor where there is no installed app', async () => {
    start({ computer: createFakeBackground({ asked: true, startAtLogin: false }) });
    await toServices();
    expect(screen.queryByRole('checkbox', { name: TICK })).toBeNull();
  }, 20000);

  it('is not asked in a preview, which has no start at login', async () => {
    start({ computer: createFakeBackground({ supported: false }) });
    await toServices();
    expect(screen.queryByRole('checkbox', { name: TICK })).toBeNull();
  }, 20000);
});

describe('Business > Notifications: start at login and keep running (A5, row 4)', () => {
  async function panel() {
    return within(await screen.findByRole('region', { name: 'Keeps running while Chausar is closed' }, { timeout: 4000 }));
  }

  it('shows both switches from the computer, and a switch changes it', async () => {
    const { computer } = start({ fresh: false, hash: '#/business/notifications', computer: createFakeBackground({ asked: true, startAtLogin: true, registered: true }) });
    const tile = await panel();
    const login = await tile.findByRole('checkbox', { name: SWITCH }, { timeout: 4000 }) as HTMLInputElement;
    const tray = tile.getByRole('checkbox', { name: TRAY }) as HTMLInputElement;
    expect([login.checked, tray.checked]).toEqual([true, true]);
    await act(async () => { fireEvent.click(login); });
    await waitFor(() => expect((tile.getByRole('checkbox', { name: SWITCH }) as HTMLInputElement).checked).toBe(false), { timeout: 4000 });
    await act(async () => { fireEvent.click(tile.getByRole('checkbox', { name: TRAY })); });
    await waitFor(() => expect((tile.getByRole('checkbox', { name: TRAY }) as HTMLInputElement).checked).toBe(false), { timeout: 4000 });
    expect(computer!.changes).toEqual([{ startAtLogin: false }, { keepRunning: false }]);
  });

  it('shows a login item the computer switched off as off, with a note, and the switch turns it back on', async () => {
    const { computer } = start({ fresh: false, hash: '#/business/notifications', computer: createFakeBackground({ asked: true, startAtLogin: true, registered: false, systemOff: true }) });
    const tile = await panel();
    const login = await tile.findByRole('checkbox', { name: SWITCH }, { timeout: 4000 }) as HTMLInputElement;
    expect(login.checked).toBe(false);
    expect(tile.getByText("Your computer's startup settings turned this off. Tick it to turn it back on.")).toBeTruthy();
    await act(async () => { fireEvent.click(login); });
    await waitFor(() => expect((tile.getByRole('checkbox', { name: SWITCH }) as HTMLInputElement).checked).toBe(true), { timeout: 4000 });
    expect(tile.queryByText(/startup settings turned this off/)).toBeNull();
    expect(computer!.computer.registered).toBe(true);
  });

  it('says so when the computer did not take the change', async () => {
    const computer = createFakeBackground({ asked: true, startAtLogin: false, registered: false, refuses: true });
    start({ fresh: false, hash: '#/business/notifications', computer });
    const tile = await panel();
    await act(async () => { fireEvent.click(await tile.findByRole('checkbox', { name: SWITCH }, { timeout: 4000 })); });
    expect(await tile.findByRole('alert', {}, { timeout: 4000 })).toHaveProperty('textContent', "Your computer didn't take this change. Check its startup settings.");
    expect((tile.getByRole('checkbox', { name: SWITCH }) as HTMLInputElement).checked).toBe(false);
  });

  it('shows no switches without the installed app', async () => {
    start({ fresh: false, hash: '#/business/notifications', computer: null });
    const tile = await panel();
    expect(tile.queryByRole('checkbox', { name: SWITCH })).toBeNull();
    expect(tile.queryByRole('checkbox', { name: TRAY })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// A5 fix round 1 (finding 2): the question sits above the services, so it is seen before any Set up; and when the
// first run ends without an answer (the app closed on that step, or Go to Today before the computer answered), Today
// asks once, with the same words and the same tick. An install that already has a login item from before A5 is asked
// too (the founder's answer, below).
// ---------------------------------------------------------------------------
describe('start at login is always asked once (A5 fix round 1)', () => {
  it('asks above the service list, and once answered Today does not ask again', async () => {
    const { computer } = start();
    await toServices();
    const tick = await screen.findByRole('checkbox', { name: TICK }, { timeout: 4000 });
    const list = screen.getByRole('list', { name: 'Services for Teaching and coaching' });
    expect(tick.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await press('Go to Today');
    await waitFor(() => expect(computer!.changes).toEqual([{ startAtLogin: true }]), { timeout: 4000 });
    await screen.findByRole('navigation', {}, { timeout: 4000 });
    expect(screen.queryByRole('checkbox', { name: TICK })).toBeNull();
  }, 20000);

  it('Go to Today before the computer answered saves nothing, and Today asks once', async () => {
    const computer = createFakeBackground();
    // The first run's reads never answer before the owner goes on; reads made after that (Today's) answer at once.
    let gone = false;
    const never = new Promise<never>(() => {});
    const slow = { ...computer, getBackground: () => (gone ? computer.getBackground() : never) };
    start({ computer: slow as typeof computer });
    await toServices();
    gone = true;
    await press('Go to Today');
    expect(computer.changes).toEqual([]);
    const tick = await screen.findByRole('checkbox', { name: TICK }, { timeout: 4000 }) as HTMLInputElement;
    expect(tick.checked).toBe(true);
    await press('Save');
    await waitFor(() => expect(computer.changes).toEqual([{ startAtLogin: true }]), { timeout: 4000 });
    await waitFor(() => expect(screen.queryByRole('checkbox', { name: TICK })).toBeNull(), { timeout: 4000 });
  }, 20000);

  it('Today asks a business that never answered (the app closed on the services step), and a no is saved too', async () => {
    const { computer } = start({ fresh: false });
    const tick = await screen.findByRole('checkbox', { name: TICK }, { timeout: 4000 }) as HTMLInputElement;
    expect(tick.checked).toBe(true);
    expect(screen.getByText('It opens quietly in the tray, so scheduled work keeps going. Change it any time in Business, Notifications.')).toBeTruthy();
    await act(async () => { fireEvent.click(tick); });
    await press('Save');
    await waitFor(() => expect(computer!.changes).toEqual([{ startAtLogin: false }]), { timeout: 4000 });
    await waitFor(() => expect(screen.queryByRole('checkbox', { name: TICK })).toBeNull(), { timeout: 4000 });
  }, 20000);

  it('Today does not ask a computer that answered, a preview, or the web', async () => {
    for (const computer of [createFakeBackground({ asked: true }), createFakeBackground({ asked: true, registered: true }), createFakeBackground({ supported: false }), null]) {
      start({ fresh: false, computer });
      await screen.findByRole('navigation', {}, { timeout: 4000 });
      await act(async () => { await new Promise((accept) => setTimeout(accept, 20)); });
      expect(screen.queryByRole('checkbox', { name: TICK })).toBeNull();
      cleanup();
    }
  }, 20000);
});

// The founder (A5 fix round 1): an install that registered start at login silently before A5 (no answer saved) is asked
// once on Today like everyone else, ticked; its login item stays as it is until then, and the answer sticks.
describe('an older install with a silent login item is asked once on Today (founder, A5 fix round 1)', () => {
  for (const [answer, registered] of [[true, true], [false, false]] as const) {
    it(`ticked, it shows once; ${answer ? 'yes keeps the login item' : 'no removes it'}, and it never shows again`, async () => {
      const computer = createFakeBackground({ registered: true });
      start({ fresh: false, computer });
      const tick = await screen.findByRole('checkbox', { name: TICK }, { timeout: 4000 }) as HTMLInputElement;
      expect(tick.checked).toBe(true);
      expect(computer.computer.registered).toBe(true);
      if (!answer) await act(async () => { fireEvent.click(tick); });
      await press('Save');
      await waitFor(() => expect(computer.changes).toEqual([{ startAtLogin: answer }]), { timeout: 4000 });
      expect(computer.computer.registered).toBe(registered);
      await waitFor(() => expect(screen.queryByRole('checkbox', { name: TICK })).toBeNull(), { timeout: 4000 });
      cleanup();
      start({ fresh: false, computer });
      await screen.findByRole('navigation', {}, { timeout: 4000 });
      await act(async () => { await new Promise((accept) => setTimeout(accept, 20)); });
      expect(screen.queryByRole('checkbox', { name: TICK })).toBeNull();
    }, 20000);
  }
  // A5 fix round 2 (finding 1): the owner's own no in the computer's startup settings is not undone by one Save.
  it('one the computer switched off is asked too, unticked, and Save as it is leaves it off', async () => {
    const computer = createFakeBackground({ systemOff: true });
    start({ fresh: false, computer });
    const tick = await screen.findByRole('checkbox', { name: TICK }, { timeout: 4000 }) as HTMLInputElement;
    expect(tick.checked).toBe(false);
    await press('Save');
    await waitFor(() => expect(computer.changes).toEqual([{ startAtLogin: false }]), { timeout: 4000 });
    expect(computer.computer.registered).toBe(false);
  });
});

// A5 fix round 2 (finding 4): "asked once" means Today's question can be put aside for good: Not now is an answer that
// keeps what the computer has now, and the question never shows again.
describe('Not now on Today keeps the computer as it is (A5 fix round 2)', () => {
  for (const [name, start0, registered, systemOff] of [
    ['a registered login item stays registered', { registered: true }, true, false],
    ['no login item stays none', {}, false, false],
    ['a switched-off login item stays there and off', { systemOff: true }, false, true],
  ] as const) {
    it(name, async () => {
      const computer = createFakeBackground(start0);
      start({ fresh: false, computer });
      await screen.findByRole('checkbox', { name: TICK }, { timeout: 4000 });
      await press('Not now');
      await waitFor(() => expect(computer.changes).toEqual([{ keepRunning: true }]), { timeout: 4000 });
      expect([computer.computer.registered, computer.computer.systemOff]).toEqual([registered, systemOff]);
      await waitFor(() => expect(screen.queryByRole('checkbox', { name: TICK })).toBeNull(), { timeout: 4000 });
      cleanup();
      start({ fresh: false, computer });
      await screen.findByRole('navigation', {}, { timeout: 4000 });
      await act(async () => { await new Promise((accept) => setTimeout(accept, 20)); });
      expect(screen.queryByRole('checkbox', { name: TICK })).toBeNull();
    }, 20000);
  }
});

describe('Business > Notifications reads the computer again (A5 fix round 1, finding 5)', () => {
  it('when the window comes back to the front, after a change in the tray or the computer\'s own settings', async () => {
    const computer = createFakeBackground({ asked: true, startAtLogin: true, registered: true });
    start({ fresh: false, hash: '#/business/notifications', computer });
    const tile = within(await screen.findByRole('region', { name: 'Keeps running while Chausar is closed' }, { timeout: 4000 }));
    expect((await tile.findByRole('checkbox', { name: SWITCH }, { timeout: 4000 }) as HTMLInputElement).checked).toBe(true);
    computer.computer.registered = false;
    computer.computer.systemOff = true;
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    await waitFor(() => expect((tile.getByRole('checkbox', { name: SWITCH }) as HTMLInputElement).checked).toBe(false), { timeout: 4000 });
    expect(tile.getByText("Your computer's startup settings turned this off. Tick it to turn it back on.")).toBeTruthy();
  });
});
