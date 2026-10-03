/**
 * Text. One file per language (text/en.json, text/hi.json); messages in ICU form through
 * react-intl. No sentence is built by joining pieces: every string a person reads is one
 * complete template from the text file.
 *
 * The exact provisioned react-intl version is checked by the isolated strict build.
 */

import { createContext, useContext, type ReactNode } from 'react';
import { IntlProvider, useIntl } from 'react-intl';
import en from '../text/en.json';
import hi from '../text/hi.json';
import type { Language } from './presentation.ts';

type Messages = Readonly<Record<string, string>>;

const CATALOGUE: Record<Language, Messages> = { en, hi };

export type TextValues = Record<string, string | number>;

const LanguageContext = createContext<Language>('en');

export function TextProvider({ language, children }: { language: Language; children: ReactNode }) {
  return (
    <LanguageContext.Provider value={language}>
      <IntlProvider locale={language} messages={CATALOGUE[language]} defaultLocale="en">
        {children}
      </IntlProvider>
    </LanguageContext.Provider>
  );
}

export function useLanguage(): Language {
  return useContext(LanguageContext);
}

/** t(key, values) gives the complete sentence for this language. */
export function useT(): (key: string, values?: TextValues) => string {
  const intl = useIntl();
  return (key, values) => intl.formatMessage({ id: key }, values);
}

/** <T k="..." /> renders a message as a text node. Values are text, never markup. */
export function T({ k, values }: { k: string; values?: TextValues | undefined }) {
  const t = useT();
  return <>{t(k, values)}</>;
}

/** Every key in English must exist in Hindi. A test owned by the test lane checks this;
 *  the function is here so the check has one source of truth. */
export function missingHindiKeys(): string[] {
  return Object.keys(CATALOGUE.en).filter((k) => !(k in CATALOGUE.hi));
}
