// Browser-safe display translations for engine intake words. Submitted values stay untouched.
import english from '../../text/en/kit-intake-words.json';
import type { T } from '../../text';
const keys = new Map<string, string>(Object.entries(english).map(([key, words]) => [words, key]));
/** Unknown schemas keep their supplied words until their translation is added. */
export function kitIntakeWords(t: T, words: string): string { const key = keys.get(words); return key ? t(key) : words; }
