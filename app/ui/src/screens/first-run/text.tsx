/**
 * First-run text: the shared catalogue (wordmark, step names, step states, language
 * words, Continue and Change) layered under this folder's own `text/en.json` and
 * `text/hi.json`. The shared files are read, never edited. Local keys are prefixed
 * `FR.`, `FR-06.` and `FR-08.` so they cannot shadow a shared key; a test checks that.
 * Every string is a complete ICU template through react-intl; no sentence is glued.
 */

import type { ReactNode } from 'react';
import { IntlProvider } from 'react-intl';
import type { Language } from '../../app/presentation.ts';
import { TextProvider } from '../../app/text';
import sharedEn from '../../text/en.json';
import sharedHi from '../../text/hi.json';
import en from './text/en.json';
import hi from './text/hi.json';

type Messages = Readonly<Record<string, string>>;

const SHARED: Readonly<Record<Language, Messages>> = { en: sharedEn, hi: sharedHi };
export const LOCAL: Readonly<Record<Language, Messages>> = { en, hi };

export function firstRunMessages(language: Language): Messages {
  return { ...SHARED[language], ...LOCAL[language] };
}

/** Shared provider first (language context and the shared catalogue), then the layered catalogue nearest the screen. */
export function FirstRunText({ language, children }: { language: Language; children: ReactNode }) {
  return (
    <TextProvider language={language}>
      <IntlProvider locale={language} messages={firstRunMessages(language)} defaultLocale="en">
        {children}
      </IntlProvider>
    </TextProvider>
  );
}

/** Local keys that would shadow a shared key. Must be empty. */
export function localKeyCollisions(): string[] {
  return Object.keys(LOCAL.en).filter(key => key in SHARED.en || key in SHARED.hi);
}

/** Local keys present in one language and not the other. Must be empty. */
export function localCatalogueGaps(): string[] {
  const missingHindi = Object.keys(LOCAL.en).filter(key => !(key in LOCAL.hi));
  const missingEnglish = Object.keys(LOCAL.hi).filter(key => !(key in LOCAL.en));
  return [...missingHindi, ...missingEnglish];
}
