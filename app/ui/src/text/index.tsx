/**
 * Text. One JSON file per place and language (text/en/<place>.json, text/hi/<place>.json, plus common.json),
 * merged here. English is eager. Hindi is a pack the owner picks (C5 task 37), loaded only then; a key it lacks shows the
 * English words. A place file holds only keys that start with its own name, so phase 2 agents never collide.
 *
 * A message is a string with {named} values, or plural forms { zero?, one, other } chosen from the exact digits of
 * the `count` value. The count is never turned into a number: "1" is one, "1,001" and "1.0" are other.
 * Values are inserted as text and rendered by React as text nodes, never as markup.
 */

import { createContext, useCallback, useContext, type ReactNode } from 'react';

export type Language = 'en' | 'hi';
export type Message = string | { zero?: string; one: string; other: string };
export type Catalogue = Readonly<Record<string, Message>>;
export type TextValues = Readonly<Record<string, string | number>>;

function merge(files: Record<string, unknown>): Catalogue {
  const out: Record<string, Message> = {};
  for (const path of Object.keys(files).sort()) Object.assign(out, files[path] as Record<string, Message>);
  return Object.freeze(out);
}

export const CATALOGUES: Readonly<Record<'en', Catalogue>> = Object.freeze({
  en: merge(import.meta.glob('./en/*.json', { eager: true, import: 'default' })),
});

/** The Hindi files, each its own chunk; nothing here runs until the owner picks Hindi. */
const HINDI_FILES = import.meta.glob('./hi/*.json', { import: 'default' });
let hindi: Catalogue | null = null;
let loading: Promise<void> | null = null;

/** The pack, once it has landed; null until then. */
export function hindiCatalogue(): Catalogue | null { return hindi; }

async function loadHindi(): Promise<void> {
  // A font that fails to load leaves the system's Devanagari face; the words still show.
  const fonts = import('../tokens/fonts-hi.css').catch(() => {});
  const paths = Object.keys(HINDI_FILES);
  const files = await Promise.all(paths.map((path) => HINDI_FILES[path]!()));
  await fonts;
  hindi = merge(Object.fromEntries(paths.map((path, at) => [path, files[at]])));
}

/** What a language needs before it shows. English is here already; a failed load can be tried again. */
export async function prepareLanguage(language: Language): Promise<void> {
  if (language !== 'hi' || hindi) return;
  loading ??= loadHindi().finally(() => { loading = null; });
  await loading;
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
