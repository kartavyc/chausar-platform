/**
 * Text. One JSON file per place and language (text/en/<place>.json, text/hi/<place>.json, plus common.json),
 * merged here. A place file holds only keys that start with its own name, so phase 2 agents never collide.
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

export const CATALOGUES: Readonly<Record<Language, Catalogue>> = Object.freeze({
  en: merge(import.meta.glob('./en/*.json', { eager: true, import: 'default' })),
  hi: merge(import.meta.glob('./hi/*.json', { eager: true, import: 'default' })),
});

/** English: one for exactly 1. Hindi: one for 0 and 1. Anything that is not plain digits is other. */
export function pluralForm(digits: string, language: Language): 'one' | 'other' {
  if (!/^\d+$/.test(digits)) return 'other';
  const trimmed = digits.replace(/^0+(?=\d)/, '');
  if (trimmed === '1') return 'one';
  if (trimmed === '0' && language === 'hi') return 'one';
  return 'other';
}

export function format(catalogue: Catalogue, language: Language, key: string, values: TextValues = {}): string {
  const message = catalogue[key];
  if (message === undefined) return key;
  let template: string;
  if (typeof message === 'string') template = message;
  else {
    const digits = values.count === undefined ? '' : String(values.count);
    template = message.zero !== undefined && /^0+$/.test(digits) ? message.zero : message[pluralForm(digits, language)];
  }
  return template.replace(/\{(\w+)\}/g, (all, name: string) => (values[name] === undefined ? all : String(values[name])));
}

/** The named values a message uses, across all its forms, sorted. */
export function placeholders(message: Message | undefined): string[] {
  if (message === undefined) return [];
  const texts = typeof message === 'string' ? [message] : Object.values(message);
  const names = new Set<string>();
  for (const text of texts) for (const m of text.matchAll(/\{(\w+)\}/g)) names.add(m[1]!);
  return [...names].sort();
}

export function pickLanguage(preferred: readonly string[] = typeof navigator === 'undefined' ? [] : navigator.languages ?? []): Language {
  return preferred.some((tag) => tag.toLowerCase().startsWith('hi')) ? 'hi' : 'en';
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
  return useCallback((key: string, values?: TextValues) => format(CATALOGUES[language], language, key, values), [language]);
}
