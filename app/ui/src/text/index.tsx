/**
 * Text. One JSON file per place and language (text/en/<place>.json, text/hi/<place>.json, plus common.json),
 * merged here. Shared English is eager; page-only words follow their page. Hindi is a pack the owner picks (C5 task 37), loaded only then; a key it lacks shows the
 * English words. A place file holds only keys that start with its own name, so phase 2 agents never collide.
 *
 * A message is a string with {named} values, or plural forms { zero?, one, other } chosen from the exact digits of
 * the `count` value. The count is never turned into a number: "1" is one, "1,001" and "1.0" are other.
 * Values are inserted as text and rendered by React as text nodes, never as markup.
 */

import { createContext, useCallback, useContext, type ReactNode } from 'react';
import { INITIAL_TEXT, PLACE_TEXT } from './groups';
import type { PlaceId } from '../shell/routes';

export type Language = 'en' | 'hi';
export type Message = string | { zero?: string; one: string; other: string };
export type Catalogue = Readonly<Record<string, Message>>;
export type TextValues = Readonly<Record<string, string | number>>;

function merge(files: Record<string, unknown>): Catalogue {
  const out: Record<string, Message> = {};
  for (const path of Object.keys(files).sort()) Object.assign(out, files[path] as Record<string, Message>);
  return Object.freeze(out);
}

const initialEnglish = import.meta.env.MODE === 'test'
  ? import.meta.glob('./en/*.json', { eager: true, import: 'default' })
  : import.meta.glob(['./en/*.json', '!./en/kit-chain.json', '!./en/kit-intake.json', '!./en/web-people.json'], { eager: true, import: 'default' });
let english = merge(initialEnglish);
export const CATALOGUES: Readonly<Record<'en', Catalogue>> = Object.freeze({ get en() { return english; } });
const ENGLISH_FILES = import.meta.glob('./en/*.json', { import: 'default' });
const HINDI_FILES = import.meta.glob('./hi/*.json', { import: 'default' });
const englishLoaded = new Set(Object.keys(initialEnglish).map(path => path.split('/').at(-1)!));
const hindiLoaded = new Set<string>();
const pending = new Map<string, Promise<void>>();
const opened = new Set<PlaceId>();
let hindi: Catalogue | null = null;
let hindiChosen = false;
let fonts: Promise<unknown> | undefined;

/** A live catalogue only gains new keys. Loading another page cannot replace words already on screen. */
function loadFile(language: Language, file: string): Promise<void> {
  const loaded = language === 'en' ? englishLoaded : hindiLoaded;
  if (loaded.has(file)) return Promise.resolve();
  const key = `${language}/${file}`;
  let work = pending.get(key);
  if (!work) {
    work = Promise.resolve().then(async () => {
      const loader = (language === 'en' ? ENGLISH_FILES : HINDI_FILES)[`./${language}/${file}`];
      if (!loader) throw new Error('Missing language file');
      const words = await loader() as Catalogue;
      if (language === 'en') english = Object.freeze({ ...words, ...english });
      else hindi = Object.freeze({ ...words, ...hindi });
      loaded.add(file);
    }).finally(() => { pending.delete(key); });
    pending.set(key, work);
  }
  return work;
}
/** The pack, once it has landed; null until then. */
export function hindiCatalogue(): Catalogue | null { return hindi; }

/** Called with the page loader, before any of that page or its sheets can draw. */
export async function loadText(place: PlaceId): Promise<void> {
  opened.add(place);
  await Promise.all(PLACE_TEXT[place].flatMap(file => [loadFile('en', file), ...(hindiChosen ? [loadFile('hi', file)] : [])]));
}
/** Only the owner's Hindi pick loads Hindi words and fonts. Its later pages use the same groups as English. */
export async function prepareLanguage(language: Language): Promise<void> {
  hindiChosen = language === 'hi';
  if (!hindiChosen) return;
  fonts ??= import('../tokens/fonts-hi.css').catch(() => {});
  const files = import.meta.env.MODE === 'test'
    ? Object.keys(HINDI_FILES).map(path => path.split('/').at(-1)!)
    : [...INITIAL_TEXT, ...[...opened].flatMap(place => PLACE_TEXT[place])];
  await Promise.all([fonts, ...files.map(file => loadFile('hi', file))]);
}

/** English: one for exactly 1. Hindi: one for 0 and 1. Anything that is not plain digits is other. */
export function pluralForm(digits: string, language: Language): 'one' | 'other' {
  if (!/^\d+$/.test(digits)) return 'other';
  const trimmed = digits.replace(/^0+(?=\d)/, '');
  if (trimmed === '1') return 'one';
  if (trimmed === '0' && language === 'hi') return 'one';
  return 'other';
}

let missingKey: ((key: string) => void) | null = null;
/** B1 fix round 1 (spec 2): lets a test hear every key a screen asks for that the catalogue lacks (tests/text-keys-runtime-b1). */
export function onMissingKey(listener: ((key: string) => void) | null): void { missingKey = listener; }

export function format(catalogue: Catalogue, language: Language, key: string, values: TextValues = {}): string {
  const message = catalogue[key];
  if (message === undefined) { missingKey?.(key); return key; }
  let template: string;
  if (typeof message === 'string') template = message;
  else {
    const digits = values.count === undefined ? '' : String(values.count);
    template = message.zero !== undefined && /^0+$/.test(digits) ? message.zero : message[pluralForm(digits, language)];
  }
  return template.replace(/\{(\w+)\}/g, (all, name: string) => (values[name] === undefined ? all : String(values[name])));
}

/** One message: the Hindi words when the pack has them, else the English words with English plurals. */
export function say(english: Catalogue, pack: Catalogue | null, language: Language, key: string, values?: TextValues): string {
  if (language === 'hi' && pack && pack[key] !== undefined) return format(pack, 'hi', key, values);
  return format(english, 'en', key, values);
}

/** The named values a message uses, across all its forms, sorted. */
export function placeholders(message: Message | undefined): string[] {
  if (message === undefined) return [];
  const texts = typeof message === 'string' ? [message] : Object.values(message);
  const names = new Set<string>();
  for (const text of texts) for (const m of text.matchAll(/\{(\w+)\}/g)) names.add(m[1]!);
  return [...names].sort();
}

export function pickLanguage(_preferred: readonly string[] = []): Language {
  return 'en';
}

/** The owner's pick (shell/LanguageRoot): what shows, whether this app can choose at all, and how to change it. */
export interface LanguageChoice { language: Language; available: boolean; choose: (next: Language) => Promise<void> }
export const LanguageChoiceContext = createContext<LanguageChoice>({ language: 'en', available: false, choose: async () => {} });
export function useLanguageChoice(): LanguageChoice {
  return useContext(LanguageChoiceContext);
}

const LanguageContext = createContext<Language>('en');

export function TextProvider({ language, children }: { language: Language; children: ReactNode }) {
  return <LanguageContext.Provider value={language}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): Language {
  return useContext(LanguageContext);
}

export type T = (key: string, values?: TextValues) => string;

/** t(key, values) gives the complete sentence in the current language. */
export function useT(): T {
  const language = useLanguage();
  return useCallback((key: string, values?: TextValues) => say(CATALOGUES.en, hindi, language, key, values), [language]);
}
