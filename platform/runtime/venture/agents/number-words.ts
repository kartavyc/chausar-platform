// Chausar venture launcher, agents (Ink v2 wave 4, package 4J17): numbers and amounts written as words, for the checks
// on a persona (persona.ts) and on an agent's question card (questions.ts). A leaf module with no imports, so both can
// load it whatever loads first. A word that is also an everyday verb or noun counts only beside a scale or currency
// word: दो is "two" in "दो सौ" but "give" in "फ़ाइल दो"; "bees" is "twenty" in "bees hazaar" but insects in "bees clip".
// Romanized "do" (two) and "teen" (three) count only that way too: they are everyday English words.

/** Numbers in English words. A card's guess may say "about ten minutes"; a persona may not say a number at all. */
export const ENGLISH_NUMBER_WORDS = whole([
  'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'fifteen', 'twenty', 'thirty', 'forty', 'fifty', 'hundred', 'thousand', 'dozen',
]);

/** Hindi and romanized Hindi scale and currency words: always an amount. */
const HINDI_SCALE = [
  'सौ', 'हज़ार', 'हजार', 'लाख', 'करोड़', 'करोड', 'रुपये', 'रुपए', 'रुपया', 'रुपयों',
  'sau', 'hazaar', 'hazar', 'hajaar', 'hajar', 'lakh', 'lac', 'crore', 'karod', 'karor', 'rupaye', 'rupaiye', 'rupaya', 'rupiya', 'rupay',
];
/** Beside one of these, an ordinary word that is also a number counts (English scale and currency words too). */
const SCALE: ReadonlySet<string> = new Set([...HINDI_SCALE, 'hundred', 'thousand', 'rupees', 'rupee', 'rs', 'inr']);
/** Words that are numbers only beside a scale or currency word. */
const AMBIGUOUS: ReadonlySet<string> = new Set(['दो', 'नौ', 'एक', 'bees', 'das', 'do', 'teen', 'char', 'nau', 'ek']);

/** Numbers and money in Hindi and romanized Hindi that are never anything else: "पाँच", "सौ", "hazaar", "rupaye". */
const HINDI_NUMBERS = whole([
  'तीन', 'चार', 'पाँच', 'पांच', 'छह', 'सात', 'आठ', 'दस', 'बीस', 'पचास', ...HINDI_SCALE,
  'paanch', 'panch', 'chhah', 'saat', 'aath', 'pachaas', 'pachas',
]);

const wordsOf = (text: string): string[] => [...text.toLowerCase().matchAll(/[\p{L}\p{M}]+/gu)].map(match => match[0]);

/**
 * True when the words hold a number or an amount in Hindi or romanized Hindi: a word that is only ever a number or a
 * scale ("पाँच", "सौ", "hazaar", "rupaye"), or a word that is also an everyday one (दो, bees) right beside a scale or
 * currency word ("दो सौ", "bees hazaar", "bees rupaye").
 */
export function holdsHindiNumber(text: string): boolean {
  if (HINDI_NUMBERS.test(text)) return true;
  const words = wordsOf(text);
  return words.some((word, index) => AMBIGUOUS.has(word) && (SCALE.has(words[index - 1] ?? '') || SCALE.has(words[index + 1] ?? '')));
}

// A function declaration, so the exports above can use it and the file opens with an export: `node --check`
// (scripts/check.mjs) only strips types from a file it has detected as a module from its first statement.
function whole(words: readonly string[]): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{M}])(?:${words.join('|')})(?![\\p{L}\\p{M}])`, 'iu');
}
