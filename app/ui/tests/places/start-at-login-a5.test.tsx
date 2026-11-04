import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
