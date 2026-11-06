import { EngineError, type AppPreferencesLite, type MotionPreferenceLite } from './types';

/** The app's preference methods (platform/runtime/app-preferences.ts), answered before any business is open. */
export const PREFERENCE_METHODS: ReadonlySet<string> = new Set(['app.preferences.get', 'app.preferences.set']);

const MOTION: readonly MotionPreferenceLite[] = ['system', 'off'];

/**
 * The fake's app preferences (one-shot C3 task 3), with the engine's codes and words: one field, motion, 'system' or
 * 'off'; an unknown field or value is refused and nothing changes. Kept for the fake's life, as the engine keeps its
 * file beside the businesses.
 */
export class FakePreferences {
  private kept: AppPreferencesLite;

  constructor(motion: MotionPreferenceLite = 'system') {
    this.kept = { motion };
  }

  request(method: string, params: Record<string, unknown>): AppPreferencesLite {
    if (method === 'app.preferences.get') return { ...this.kept };
    const entries = Object.entries(params);
    if (entries.length === 0) throw new EngineError('INVALID_PREFERENCE', 'Choose a setting for this app.');
    for (const [key, value] of entries) {
      if (key !== 'motion') throw new EngineError('INVALID_PREFERENCE', 'This app has no such setting.');
      if (!MOTION.includes(value as MotionPreferenceLite)) throw new EngineError('INVALID_PREFERENCE', 'Animations can follow this computer or be off.');
    }
    this.kept = { ...this.kept, ...(params as Partial<AppPreferencesLite>) };
    return { ...this.kept };
  }
}
