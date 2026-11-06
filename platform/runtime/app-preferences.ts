// The app's own preferences on this computer (one-shot C3 task 3): how Chausar itself behaves here, never anything about
// a business. One small file, `preferences.json`, beside the custody files in the vaults folder, so it is read before
// any business is open and is the same for every business on this computer. Today it holds one field, motion: 'system'
// follows the computer's own reduce-motion setting (which is always followed), 'off' stops every movement in the app.
// C5 task 36 adds `language` to this same file and these same two methods.
//
// The file holds only these fields, written atomically; a missing or broken file reads as the defaults, and an unknown
// field or value is refused in plain words. No business word ever goes in it.
import { join } from 'node:path';
import { check } from './contracts.ts';
import { atomicWriteText, readBoundedText, safeDirectory } from './vault.ts';

export const APP_PREFERENCE_METHODS = Object.freeze(['app.preferences.get', 'app.preferences.set'] as const);
export type AppPreferenceMethod = (typeof APP_PREFERENCE_METHODS)[number];

export type MotionPreference = 'system' | 'off';
export type AppPreferences = { motion: MotionPreference };

/** Each field and the values it may take. */
const FIELDS: { readonly [K in keyof AppPreferences]: readonly AppPreferences[K][] } = Object.freeze({ motion: Object.freeze(['system', 'off'] as const) });
export const DEFAULT_APP_PREFERENCES: Readonly<AppPreferences> = Object.freeze({ motion: 'system' });

export const APP_PREFERENCES_FILE = 'preferences.json';

/** Only these fields, each one of its values; anything else is not a preference. */
function valid(value: unknown): value is AppPreferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  return entries.length === Object.keys(FIELDS).length
    && entries.every(([key, field]) => Object.hasOwn(FIELDS, key) && (FIELDS[key as keyof AppPreferences] as readonly unknown[]).includes(field));
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
    check((FIELDS[key as keyof AppPreferences] as readonly unknown[]).includes(value), 'INVALID_PREFERENCE', 'Animations can follow this computer or be off.');
    (change as Record<string, unknown>)[key] = value;
  }
  check(Object.keys(change).length > 0, 'INVALID_PREFERENCE', 'Choose a setting for this app.');
  return change;
}

/** The preferences kept in `directory` (the vaults folder); the defaults when the file is missing or broken. */
export async function readAppPreferences(directory: string): Promise<AppPreferences> {
  try {
    const kept = JSON.parse(await readBoundedText(join(await safeDirectory(directory), APP_PREFERENCES_FILE))) as unknown;
    return valid(kept) ? { ...kept } : { ...DEFAULT_APP_PREFERENCES };
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
