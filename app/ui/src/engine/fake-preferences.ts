import { EngineError, type AppLanguageLite, type AppPreferencesLite, type MotionPreferenceLite } from './types';

/** The app's preference methods (platform/runtime/app-preferences.ts), answered before any business is open. */
export const PREFERENCE_METHODS: ReadonlySet<string> = new Set(['app.preferences.get', 'app.preferences.set']);

const MOTION: readonly MotionPreferenceLite[] = ['system', 'off'];
const LANGUAGES: readonly AppLanguageLite[] = ['en', 'hi'];

/**
 * The fake's app preferences (one-shot C3 task 3), with the engine's codes and words: motion, 'system' or 'off', and
 * C5's language, 'en' or 'hi'; an unknown field or value is refused and nothing changes. Kept for the fake's life, as the engine keeps its
 * file beside the businesses.
 */
export class FakePreferences {
  private kept: AppPreferencesLite;

  constructor(motion: MotionPreferenceLite = 'system') {
    this.kept = { motion, language: 'en' };
  }

  request(method: string, params: Record<string, unknown>): AppPreferencesLite {
    if (method === 'app.preferences.get') return { ...this.kept };
    const entries = Object.entries(params);
    if (entries.length === 0) throw new EngineError('INVALID_PREFERENCE', 'Choose a setting for this app.');
    for (const [key, value] of entries) {
      if (key !== 'motion' && key !== 'language') throw new EngineError('INVALID_PREFERENCE', 'This app has no such setting.');
      if (key === 'motion' && !MOTION.includes(value as MotionPreferenceLite)) throw new EngineError('INVALID_PREFERENCE', 'Animations can follow this computer or be off.');
      if (key === 'language' && !LANGUAGES.includes(value as AppLanguageLite)) throw new EngineError('INVALID_PREFERENCE', 'Choose English or Hindi.');
    }
    this.kept = { ...this.kept, ...(params as Partial<AppPreferencesLite>) };
    return { ...this.kept };
  }
}
