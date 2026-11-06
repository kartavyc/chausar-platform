// The app's own preferences on this computer (one-shot C3 task 3, C5 task 36): how Chausar itself behaves here, never
// anything about a business. One small file, `preferences.json`, beside the custody files in the vaults folder, so it is
// read before any business is open and is the same for every business on this computer. motion: 'system' follows the
// computer's own reduce-motion setting (which is always followed), 'off' stops every movement in the app. language: what
// the owner chose; nothing here reads the computer's language, so English stands until the owner picks otherwise.
//
// The file holds only these fields, written atomically; a missing or broken file or field reads as its default, and an
// unknown field or value is refused in plain words. No business word ever goes in it.
import { join } from 'node:path';
import { check } from './contracts.ts';
import { atomicWriteText, readBoundedText, safeDirectory } from './vault.ts';

export const APP_PREFERENCE_METHODS = Object.freeze(['app.preferences.get', 'app.preferences.set'] as const);
export type AppPreferenceMethod = (typeof APP_PREFERENCE_METHODS)[number];

export const APP_LANGUAGES = Object.freeze(['en', 'hi'] as const);
export type AppLanguage = (typeof APP_LANGUAGES)[number];
export type MotionPreference = 'system' | 'off';
export type AppPreferences = { motion: MotionPreference; language: AppLanguage };

/** Each field, the values it may take, and what a wrong value is told. */
const FIELDS: { readonly [K in keyof AppPreferences]: { values: readonly AppPreferences[K][]; refusal: string } } = Object.freeze({
  motion: { values: Object.freeze(['system', 'off'] as const), refusal: 'Animations can follow this computer or be off.' },
  language: { values: APP_LANGUAGES, refusal: 'Choose English or Hindi.' },
});
export const DEFAULT_APP_PREFERENCES: Readonly<AppPreferences> = Object.freeze({ motion: 'system', language: 'en' });

export const APP_PREFERENCES_FILE = 'preferences.json';

/** The fields a kept file holds, each one of its values; a field that is missing or wrong reads as its default. */
function kept(value: unknown): AppPreferences {
  const body = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const read = <K extends keyof AppPreferences>(key: K): AppPreferences[K] => (FIELDS[key].values as readonly unknown[]).includes(body[key]) ? body[key] as AppPreferences[K] : DEFAULT_APP_PREFERENCES[key];
  return { motion: read('motion'), language: read('language') };
}

/**
 * The change the owner asked for: some of the fields, each with one of its values. An unknown field or value is refused
 * in plain words, and nothing is written.
 */
export function preferenceChange(payload: unknown): Partial<AppPreferences> {
  check(Boolean(payload) && typeof payload === 'object' && !Array.isArray(payload), 'INVALID_PREFERENCE', 'Choose a setting for this app.');
  const change: Partial<AppPreferences> = {};
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    check(Object.hasOwn(FIELDS, key), 'INVALID_PREFERENCE', 'This app has no such setting.');
    const field = FIELDS[key as keyof AppPreferences];
    check((field.values as readonly unknown[]).includes(value), 'INVALID_PREFERENCE', field.refusal);
    (change as Record<string, unknown>)[key] = value;
  }
  check(Object.keys(change).length > 0, 'INVALID_PREFERENCE', 'Choose a setting for this app.');
  return change;
}

/** The preferences kept in `directory` (the vaults folder); the defaults when the file is missing or broken. */
export async function readAppPreferences(directory: string): Promise<AppPreferences> {
  try {
    return kept(JSON.parse(await readBoundedText(join(await safeDirectory(directory), APP_PREFERENCES_FILE))));
  } catch {
    return { ...DEFAULT_APP_PREFERENCES };
  }
}

/** Apply `change` over what is kept, write the whole file atomically, and answer the new preferences. */
export async function writeAppPreferences(directory: string, change: Partial<AppPreferences>): Promise<AppPreferences> {
  const next: AppPreferences = { ...(await readAppPreferences(directory)), ...change };
  await atomicWriteText(join(await safeDirectory(directory, true), APP_PREFERENCES_FILE), `${JSON.stringify(next)}\n`, true);
  return next;
}
