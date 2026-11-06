// C5 task 36: the app-level preferences of this computer's Chausar, one small file beside the businesses
// (<vaults>/preferences.json), read before any vault is open. Holds only what the owner chose: the language. Nothing
// here reads the computer's language; English stands until the owner picks otherwise. C3's "animations off" joins this
// file if C3 did not make an app-level store of its own.
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { ChausarError } from './contracts.ts';

export const APP_LANGUAGES = Object.freeze(['en', 'hi'] as const);
export type AppLanguage = typeof APP_LANGUAGES[number];
export type AppPreferences = { language: AppLanguage };

const DEFAULTS: AppPreferences = Object.freeze({ language: 'en' });
const FILE = 'preferences.json';
const isLanguage = (value: unknown): value is AppLanguage => (APP_LANGUAGES as readonly unknown[]).includes(value);
const refuse = (message: string) => new ChausarError('INVALID_PREFERENCE', message);

function exactly(payload: unknown, keys: readonly string[]): Record<string, unknown> {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) throw refuse('Send the preference and nothing else.');
  const body = payload as Record<string, unknown>;
  if (Object.keys(body).some(key => !keys.includes(key))) throw refuse('Send the preference and nothing else.');
  return body;
}

/** app.preferences.get {}: the choice on this computer; a missing or damaged file reads as English. */
export async function readPreferences(directory: string, payload: unknown = {}): Promise<AppPreferences> {
  exactly(payload, []);
  try {
    const stored = JSON.parse(await readFile(join(directory, FILE), 'utf8')) as { language?: unknown };
    return { language: isLanguage(stored?.language) ? stored.language : DEFAULTS.language };
  } catch {
    return { ...DEFAULTS };
  }
}

/** app.preferences.set { language }: written whole and renamed into place, so a crash never leaves half a file. */
export async function writePreferences(directory: string, payload: unknown): Promise<AppPreferences> {
  const body = exactly(payload, ['language']);
  if (!isLanguage(body.language)) throw refuse('Choose English or Hindi.');
  const next: AppPreferences = { language: body.language };
  await mkdir(directory, { recursive: true });
  const temp = join(directory, `.${FILE}.${randomBytes(6).toString('hex')}.tmp`);
  try {
    await writeFile(temp, `${JSON.stringify(next)}\n`, { mode: 0o600 });
    await rename(temp, join(directory, FILE));
  } catch (error) {
    await rm(temp, { force: true }).catch(() => {});
    throw error;
  }
  return next;
}
