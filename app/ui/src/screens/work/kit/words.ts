/**
 * Words the Work and Books kit draws itself: sub-place names, missing words, step names,
 * tier words and common buttons, in English and Hindi. Screens keep their own words in
 * their own catalogue files beside them.
 */
import type { Language } from '../../../app/presentation.ts';
import { words, type Catalogue } from '../../../places/types.ts';
import type { MissingWord } from './validate.ts';

const KIT = {
  en: {
    work: 'Work', books: 'Books',
    'sub.approvals': 'Approvals', 'sub.jobs': 'Jobs', 'sub.actions': 'Actions', 'sub.cando': 'What it can do', 'sub.after-restore': 'After a restore',
    'sub.sources': 'Sources', 'sub.unmapped': 'Fields no recipe covers', 'sub.meanings': 'Meanings', 'sub.packs': 'Starter packs', 'sub.accounts': 'Accounts',
    'sub.customers': 'Customers and suppliers', 'sub.matches': 'Same customer or not', 'sub.conflicts': 'Sources that disagree',
    'sub.history': 'History', 'sub.stale': 'Stale answers', 'sub.memory': 'Memory',
    'sub.recipes': 'Recipes', 'sub.add': 'Add a source', 'sub.trial': 'Try a change on a copy',
    'missing.absent': 'absent', 'missing.null': 'blank in the source', 'missing.unknown': 'unknown', 'missing.withheld': 'withheld',
    'missing.not-applicable': 'not applicable', 'missing.not-loaded-yet': 'not loaded yet', 'missing.not-counted': 'not counted',
    retry: 'Try again', close: 'Close', back: 'Back', more: 'More',
    refused: 'Refused. Code {code}.', notBuilt: 'Not built yet.', notBuiltNamed: 'Not built yet: {what}.',
    readOnly: 'Your seat can read this page. It cannot change anything here.',
  },
  hi: {
    work: 'काम', books: 'बही',
    'sub.approvals': 'मंज़ूरियाँ', 'sub.jobs': 'जॉब', 'sub.actions': 'कार्रवाइयाँ', 'sub.cando': 'यह क्या कर सकता है', 'sub.after-restore': 'बैकअप लौटाने के बाद',
    'sub.sources': 'स्रोत', 'sub.unmapped': 'वे फ़ील्ड जिन्हें कोई रेसिपी नहीं ढकती', 'sub.meanings': 'अर्थ', 'sub.packs': 'स्टार्टर पैक', 'sub.accounts': 'खाते',
    'sub.customers': 'ग्राहक और सप्लायर', 'sub.matches': 'एक ही ग्राहक या नहीं', 'sub.conflicts': 'स्रोत जो असहमत हैं',
    'sub.history': 'इतिहास', 'sub.stale': 'पुराने जवाब', 'sub.memory': 'याद',
    'sub.recipes': 'रेसिपी', 'sub.add': 'स्रोत जोड़ें', 'sub.trial': 'बदलाव को एक नक़ल पर आज़माएँ',
    'missing.absent': 'मौजूद नहीं', 'missing.null': 'स्रोत में ख़ाली', 'missing.unknown': 'अज्ञात', 'missing.withheld': 'रोका गया',
    'missing.not-applicable': 'लागू नहीं', 'missing.not-loaded-yet': 'अभी लोड नहीं हुआ', 'missing.not-counted': 'गिना नहीं गया',
    retry: 'फिर कोशिश करें', close: 'बंद करें', back: 'वापस', more: 'और',
    refused: 'मना किया गया। कोड {code}।', notBuilt: 'अभी बना नहीं है।', notBuiltNamed: 'अभी बना नहीं है: {what}।',
    readOnly: 'आपकी सीट यह पेज पढ़ सकती है। यहाँ कुछ बदल नहीं सकती।',
  },
} as const satisfies Catalogue<string>;

export type KitKey = keyof typeof KIT.en;
export function kitWords(language: Language): Readonly<Record<KitKey, string>> { return words(KIT as Catalogue<KitKey>, language); }

/** Fill `{name}` slots in one complete template. Values are shown as text, never markup. */
export function fill(template: string, values: Readonly<Record<string, string | number>> = {}): string {
  return template.replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, (whole, name: string) => Object.hasOwn(values, name) ? String(values[name]) : whole);
}

export function missingWord(state: MissingWord, language: Language): string {
  return kitWords(language)[`missing.${state}` as KitKey];
}
