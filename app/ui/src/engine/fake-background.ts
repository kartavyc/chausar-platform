/**
 * One-shot A5: a sample computer's start at login and keep running, answering as the desktop's background.cjs does
 * through the window's getBackground and setBackground (main.cjs channels): the saved answer, whether it was asked, and
 * the login item read back from the computer (registered, or there but switched off by the computer's own startup
 * settings). A change of Keep running alone before start at login was answered saves what the computer does now.
 * Tests and the dev page spread it onto a fake client; nothing here touches a real computer. refuses: the computer
 * keeps its login item as it was (a change that did not take), so the window's own check can be seen. A5 fix round 3:
 * getAskLater and setAskLater keep the day Today's question was put aside, apart from the answer, as the desktop does.
 */
import { EngineError, type BackgroundStateLite } from './types';

export type FakeBackgroundStart = Partial<Omit<BackgroundStateLite, 'supported'>> & { supported?: boolean; refuses?: boolean };

export function createFakeBackground(start: FakeBackgroundStart = {}) {
  const supported = start.supported ?? true;
  const saved = { startAtLogin: start.startAtLogin ?? supported, keepRunning: start.keepRunning ?? supported, asked: start.asked ?? false };
  const computer = { registered: start.registered ?? false, systemOff: start.systemOff ?? false };
  const changes: { startAtLogin?: boolean; keepRunning?: boolean }[] = [];
  /** A5 fix round 3: the day the question was put aside, kept apart from the answer (background.cjs laterDay). */
  let laterOn: string | null = null;
  const state = (): BackgroundStateLite => supported
    ? { supported, asked: saved.asked, startAtLogin: saved.startAtLogin, keepRunning: saved.keepRunning, registered: computer.registered, systemOff: computer.systemOff }
    : { supported, asked: false, startAtLogin: false, keepRunning: false, registered: false, systemOff: false };
  return {
    computer, changes,
    getBackground: async (): Promise<BackgroundStateLite> => state(),
    getAskLater: async (): Promise<string | null> => (supported ? laterOn : null),
    setAskLater: async (day: string): Promise<void> => {
      if (!supported) throw new EngineError('BACKGROUND_UNAVAILABLE', 'Start at login is only in the installed Chausar app.');
      if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(day)) throw new EngineError('INVALID_REQUEST', 'Send the day as YYYY-MM-DD.');
      laterOn = day;
    },
    setBackground: async (update: { startAtLogin?: boolean; keepRunning?: boolean }): Promise<BackgroundStateLite> => {
      if (!supported) throw new EngineError('BACKGROUND_UNAVAILABLE', 'Start at login is only in the installed Chausar app.');
      const keys = Object.keys(update);
      if (keys.length === 0 || keys.some((key) => !['startAtLogin', 'keepRunning'].includes(key) || typeof update[key as keyof typeof update] !== 'boolean')) throw new EngineError('INVALID_REQUEST', 'Change start at login or keep running, as on or off.');
      changes.push({ ...update });
      // As background.cjs: what the computer has now; a login item it switched off counts as a yes it switched off.
      if (!saved.asked && typeof update.startAtLogin !== 'boolean') saved.startAtLogin = computer.registered || computer.systemOff;
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
