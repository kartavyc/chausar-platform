// Fake report number findings mirror the engine records.ts and kit/report/blocks.ts predicates.
// Internal Chausar code only; kept pure so the browser never imports filesystem or vault modules.
export {};

const TOKEN = /[\p{L}\p{Nd}]+(?:[-./'\u2019][\p{L}\p{Nd}]+)*/gu;
const HAS_DIGIT = /\p{Nd}/u;
const OTHER_NUMBER = /[\p{No}\p{Nl}]/u;
const ALLOWED_COMPOUNDS: ReadonlySet<string> = new Set(['second-hand']);
const COUNT_WORDS: ReadonlySet<string> = new Set([
  'zero', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen',
  'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety',
  'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth', 'thirteenth', 'fourteenth',
  'fifteenth', 'sixteenth', 'seventeenth', 'eighteenth', 'nineteenth', 'twentieth', 'thirtieth', 'fortieth', 'fiftieth', 'hundredth', 'thousandth',
  'dozen', 'dozens', 'half', 'halves', 'quarter', 'double', 'twice', 'triple', 'quadruple',
  'hundred', 'hundreds', 'thousand', 'thousands', 'lakh', 'lakhs', 'crore', 'crores', 'million', 'millions', 'billion', 'billions', 'percent',
]);
const CURRENCY_WORDS: ReadonlySet<string> = new Set([
  'inr', 'gbp', 'usd', 'eur', 'aud', 'cad', 'sgd', 'aed', 'nzd', 'jpy', 'rs', 'pound', 'pounds', 'pence', 'penny', 'pennies', 'quid',
  'dollar', 'dollars', 'buck', 'bucks', 'cent', 'cents', 'rupee', 'rupees', 'paise', 'euro', 'euros', 'yen', 'dirham', 'dirhams', 'rand',
  'franc', 'francs', 'peso', 'pesos', 'grand',
]);
const NUMBER_SUFFIXES: ReadonlySet<string> = new Set(['k', 'm', 'mn', 'bn', 'cr', 'lakh', 'lakhs', 'crore', 'crores', 'st', 'nd', 'rd', 'th', 'x', 'am', 'pm']);
type WordToken = { raw: string; lower: string; digits: boolean; letters: string };

function tokensOf(value: string): WordToken[] {
  return [...value.matchAll(TOKEN)].map(match => {
    const lower = match[0]!.toLowerCase().replace(/’/g, "'");
    return { raw: match[0]!, lower, digits: HAS_DIGIT.test(lower), letters: lower.replace(/[^\p{L}]/gu, '') };
  });
}

function isNumberToken(token: WordToken | undefined, allowed: readonly string[]): boolean {
  if (!token || allowed.includes(token.lower)) return false;
  if (token.digits) return token.letters === '' || NUMBER_SUFFIXES.has(token.letters) || CURRENCY_WORDS.has(token.letters);
  if (ALLOWED_COMPOUNDS.has(token.lower)) return false;
  return token.lower.split('-').some(part => COUNT_WORDS.has(part.replace(/'s$/, '').replace(/'$/, '')));
}

/**
 * True when model words hold a number the owner did not write: digits in any script (not names such as B2B or GPT-6,
 * nor tokens copied from the owner), number characters, percent, or a number in words. The record carrying the words
 * is then marked estimate: true, never with a receipt.
 */
function modelNumbers(value: string, allowed: readonly string[] = []): boolean {
  if (OTHER_NUMBER.test(value) || value.includes('%') || /\bper cent\b/i.test(value)) return true;
  return tokensOf(value).some(token => isNumberToken(token, allowed));
}

const HINDI_NUMBERS = new Set([
  'दो', 'तीन', 'चार', 'पांच', 'पाँच', 'छह', 'छः', 'सात', 'आठ', 'नौ', 'दस', 'ग्यारह', 'बारह', 'पंद्रह', 'बीस', 'पच्चीस', 'तीस', 'चालीस',
  'पचास', 'साठ', 'सत्तर', 'अस्सी', 'नब्बे', 'सौ', 'हज़ार', 'हजार', 'लाख', 'करोड़', 'करोड', 'प्रतिशत', 'फ़ीसदी', 'फीसदी', 'दर्जन', 'आधा',
  'आधे', 'डेढ़', 'ढाई', 'दुगुना', 'दोगुना', 'दोगुनी', 'तिगुना', 'गुना', 'गुनी',
]);
/** Whether words hold a number written as a Hindi word ("तीन गुना", "दो सौ"). */
function hindiNumberWords(text: string): boolean {
  return text.split(/[\s,.;:!?।॥()"'\-]+/u).some(word => HINDI_NUMBERS.has(word));
}


/** The engine marks number words, numeric tokens and percentages as model estimates. */
export const reportNumberEstimate = (text: string): boolean => modelNumbers(text) || hindiNumberWords(text);
