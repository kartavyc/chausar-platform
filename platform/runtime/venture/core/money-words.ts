// Chausar venture launcher: the words that make a number an amount of money, in one place. Two rules read them and must
// never drift apart: the one that keeps money out of words an agent or the owner's AI writes (delivery/harness/patches.ts
// statesMoney, Ink v2 wave 4 4B1) and the one that cuts money out of the chief's answers (chief/answer.ts stripMoney,
// 4C1). Lakh and crore are money in Indian usage however they are written; thousands join an amount and make one only
// beside a currency. Hindi is compared without the nukta, so हज़ार and हजार are one word. A leaf: it imports nothing.

/** Hindi compared without the nukta. */
export const withoutNukta = (text: string): string => text.normalize('NFD').replace(/़/g, '').normalize('NFC');

/** Scale words that make a number an amount of money: lakh and crore, in English, Hinglish and Hindi. */
export const MONEY_SCALE_WORDS: readonly string[] = Object.freeze(['lakh', 'lakhs', 'lac', 'lacs', 'crore', 'crores', 'लाख', 'करोड़', 'करोड']);
/** Thousand words: part of an amount ("one lakh fifty thousand"), and money beside a currency ("50 thousand rupees"). */
export const THOUSAND_WORDS: readonly string[] = Object.freeze(['thousand', 'thousands', 'hazaar', 'hazar', 'hajar', 'हज़ार', 'हजार']);
/** Letters right after digits that make the number lakh or crore: 2L, 1.5cr, 3lakh. Always money. */
export const MONEY_SCALE_SUFFIXES: readonly string[] = Object.freeze(['l', 'lakh', 'lakhs', 'lac', 'lacs', 'cr', 'crore', 'crores']);
/** Letters right after digits that make thousands (20k): money beside a currency sign or name only. */
export const THOUSAND_SUFFIXES: readonly string[] = Object.freeze(['k']);
/** Currency codes and names, English and Hindi, that make a number beside them money. */
export const CURRENCY_NAMES: readonly string[] = Object.freeze([
  'rs', 'inr', 'rupee', 'rupees', 'paise', 'usd', 'dollar', 'dollars', 'gbp', 'pound', 'pounds', 'eur', 'euro', 'euros',
  'रुपये', 'रुपए', 'रुपया', 'रूपये', 'रूपए', 'रुपयों', 'रु', 'पैसे',
]);

const plainSet = (words: readonly string[]) => new Set(words.map(word => withoutNukta(word.toLowerCase())));
const SCALES = plainSet(MONEY_SCALE_WORDS);
const THOUSANDS = plainSet(THOUSAND_WORDS);
const CURRENCIES = plainSet(CURRENCY_NAMES);

/** Whether one word (any case, nukta or not) is lakh or crore. */
export const isMoneyScaleWord = (word: string): boolean => SCALES.has(withoutNukta(word.toLowerCase()));
/** Whether one word is a thousand word. */
export const isThousandWord = (word: string): boolean => THOUSANDS.has(withoutNukta(word.toLowerCase()));
/** Whether one word is a currency code or name. */
export const isCurrencyName = (word: string): boolean => CURRENCIES.has(withoutNukta(word.toLowerCase()));

/** The letters written after a token's digits ('2L' gives 'l'), or null for a token that does not start with digits. */
function suffixOf(token: string): string | null {
  const match = /^\p{Nd}+(?:[,.]\p{Nd}+)*(\p{L}*)$/u.exec(token);
  return match ? match[1].toLowerCase() : null;
}

/** Whether a token is an amount scaled to lakh or crore by its letters: 2L, 1.5cr, 3lakh. */
export function scaledAmountToken(token: string): boolean {
  const suffix = suffixOf(token);
  return suffix !== null && MONEY_SCALE_SUFFIXES.includes(suffix);
}

/** Whether a token is digits scaled to thousands by its letters: 20k. */
export function thousandToken(token: string): boolean {
  const suffix = suffixOf(token);
  return suffix !== null && THOUSAND_SUFFIXES.includes(suffix);
}

/** Whether words name a money scale at all: a lakh or crore word, or digits with a lakh or crore suffix. */
export function namesMoneyScale(words: string): boolean {
  for (const match of words.matchAll(/\p{Nd}+(?:[,.]\p{Nd}+)*\p{L}*|[\p{L}\p{M}]+/gu)) {
    if (isMoneyScaleWord(match[0]) || scaledAmountToken(match[0])) return true;
  }
  return false;
}
