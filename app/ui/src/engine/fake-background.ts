/**
 * One-shot A5: a sample computer's start at login and keep running, answering as the desktop's background.cjs does
 * through the window's getBackground and setBackground (main.cjs channels): the saved answer, whether it was asked, and
 * the login item read back from the computer (registered, or there but switched off by the computer's own startup
 * settings). A change of Keep running alone before start at login was answered saves what the computer does now.
 * Tests and the dev page spread it onto a fake client; nothing here touches a real computer. refuses: the computer
 * keeps its login item as it was (a change that did not take), so the window's own check can be seen.
 */
import { EngineError, type BackgroundStateLite } from './types';

export type FakeBackgroundStart = Partial<Omit<BackgroundStateLite, 'supported'>> & { supported?: boolean; refuses?: boolean };

export function createFakeBackground(start: FakeBackgroundStart = {}) {
  const supported = start.supported ?? true;
  const saved = { startAtLogin: start.startAtLogin ?? supported, keepRunning: start.keepRunning ?? supported, asked: start.asked ?? false };
  const computer = { registered: start.registered ?? false, systemOff: start.systemOff ?? false };
  const changes: { startAtLogin?: boolean; keepRunning?: boolean }[] = [];
  const state = (): BackgroundStateLite => supported
    ? { supported, asked: saved.asked, startAtLogin: saved.startAtLogin, keepRunning: saved.keepRunning, registered: computer.registered, systemOff: computer.systemOff }
    : { supported, asked: false, startAtLogin: false, keepRunning: false, registered: false, systemOff: false };
  return {
    computer, changes,
    getBackground: async (): Promise<BackgroundStateLite> => state(),
    setBackground: async (update: { startAtLogin?: boolean; keepRunning?: boolean }): Promise<BackgroundStateLite> => {
      if (!supported) throw new EngineError('BACKGROUND_UNAVAILABLE', 'Start at login is only in the installed Chausar app.');
      const keys = Object.keys(update);
      if (keys.length === 0 || keys.some((key) => !['startAtLogin', 'keepRunning'].includes(key) || typeof update[key as keyof typeof update] !== 'boolean')) throw new EngineError('INVALID_REQUEST', 'Change start at login or keep running, as on or off.');
      changes.push({ ...update });
      if (!saved.asked && typeof update.startAtLogin !== 'boolean') saved.startAtLogin = computer.registered;
      if (typeof update.startAtLogin === 'boolean') {
        saved.startAtLogin = update.startAtLogin;
        if (!start.refuses) { computer.registered = update.startAtLogin; computer.systemOff = false; }
      }
      if (typeof update.keepRunning === 'boolean') saved.keepRunning = update.keepRunning;
      saved.asked = true;
      return state();
    },
  };
}
