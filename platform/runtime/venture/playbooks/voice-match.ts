// Chausar flagship playbooks: how the voice check (draft-checks.ts voiceDraftCheck, Ink v2 wave 4, 4J17, A8) reads a
// never-use word or a claim the owner will not make in a draft, by code, in English, Hindi and romanized Hindi. Words
// are compared whole, never as part of a longer word ("synergy" is not in "synergise"), each on its stem: an English
// stem drops -ing, -ed, -es, -s, -ly and a trailing e ("guarantee" and "guaranteed" are one); a Hindi stem drops one
// ending (the -a, -i, -e of a word and the plural -on, -en), so a ban on one form covers the others; and a Latin
// spelling is read against a Hindi word by sound ("sasta" is "सस्ता"). A leaf module: no imports. Every Devanagari
// mark is written by its code point, so no invisible character sits in this file.

/** The label the voice result carries in a run's checks: the owner's own voice, not a playbook's. */
export const VOICE_PLAYBOOK = 'owner-voice';

const cp = (...codes: number[]) => String.fromCharCode(...codes);
const NUKTA = new RegExp(cp(0x093c), 'g');
const VIRAMA = cp(0x094d);
const DEVANAGARI = /\p{Script=Devanagari}/u;

/** Common words a claim's own words leave out, and that learning a voice does not count (agents/voice.ts), with romanized Hindi. */
export const VOICE_STOP_WORDS: ReadonlySet<string> = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'your', 'yours', 'our', 'ours', 'all', 'any', 'can', 'has', 'have', 'had', 'was', 'were', 'will', 'with',
  'this', 'that', 'these', 'those', 'from', 'what', 'when', 'where', 'which', 'who', 'whom', 'why', 'how', 'they', 'them', 'their', 'then', 'than', 'there',
  'here', 'into', 'out', 'about', 'over', 'more', 'most', 'other', 'such', 'only', 'own', 'same', 'too', 'very', 'just', 'also', 'now', 'its', 'one',
  'some', 'each', 'every', 'been', 'being', 'does', 'did', 'doing', 'would', 'could', 'should', 'may', 'might', 'must', 'shall', 'let', 'get', 'got',
  'है', 'हैं', 'था', 'थे', 'का', 'की', 'के', 'में', 'से', 'को', 'और', 'यह', 'वह', 'ये', 'वे', 'पर', 'भी', 'तो', 'ही', 'कि', 'एक', 'हम', 'आप', 'नहीं', 'लिए',
  // Romanized Hindi (Hinglish): is, and, this, that, on, also, so, not, for, was, in, what, some, our, we, you, do.
  'hai', 'hain', 'aur', 'yeh', 'woh', 'par', 'bhi', 'toh', 'nahi', 'nahin', 'liye', 'tha', 'thi', 'mein', 'kya', 'kuch', 'apne', 'apna', 'apni', 'hum', 'aap',
  'karte', 'karta', 'karti', 'karna', 'karo', 'kare', 'hota', 'hoti', 'hote', 'raha', 'rahe', 'rahi', 'wala', 'wale', 'wali', 'koi', 'sab', 'bahut',
]);

/** Folded for matching: one Unicode form, the Hindi nukta taken off (a ja with a nukta reads as ja), lower case. */
export function voiceFold(text: string): string {
  return text.normalize('NFKC').normalize('NFD').replace(NUKTA, '').normalize('NFC').toLowerCase();
}

/** The words of a text, folded, in order. */
export function voiceWords(text: string): string[] {
  return [...voiceFold(text).matchAll(/[\p{L}\p{M}]+/gu)].map(match => match[0]);
}

/** One Hindi ending a word may take: the plural -on and -en (with the nasal mark), -aan, then -a, -i and -e. */
const HINDI_ENDINGS = [[0x094b, 0x0902], [0x0947, 0x0902], [0x093e, 0x0902], [0x093e], [0x0940], [0x0947]].map(codes => cp(...codes));

function hindiStem(word: string): string {
  for (const end of HINDI_ENDINGS) if (word.length > end.length + 1 && word.endsWith(end)) return word.slice(0, -end.length);
  return word;
}

function englishStem(word: string): string {
  let stem = word.length > 4 ? word.replace(/(?:ing|ed|es|s|ly)$/u, '') : word;
  if (stem.length > 4) stem = stem.replace(/e+$/u, '');
  return stem;
}

/** Devanagari letters as Latin sounds, by code point: consonants, independent vowels and vowel signs. */
const CONSONANTS: Readonly<Record<number, string>> = Object.freeze({
  0x0915: 'k', 0x0916: 'kh', 0x0917: 'g', 0x0918: 'gh', 0x0919: 'n', 0x091a: 'ch', 0x091b: 'chh', 0x091c: 'j', 0x091d: 'jh', 0x091e: 'n',
  0x091f: 't', 0x0920: 'th', 0x0921: 'd', 0x0922: 'dh', 0x0923: 'n', 0x0924: 't', 0x0925: 'th', 0x0926: 'd', 0x0927: 'dh', 0x0928: 'n',
  0x092a: 'p', 0x092b: 'ph', 0x092c: 'b', 0x092d: 'bh', 0x092e: 'm', 0x092f: 'y', 0x0930: 'r', 0x0932: 'l', 0x0935: 'v', 0x0936: 'sh',
  0x0937: 'sh', 0x0938: 's', 0x0939: 'h',
});
const VOWELS: Readonly<Record<number, string>> = Object.freeze({
  0x0905: 'a', 0x0906: 'a', 0x0907: 'i', 0x0908: 'i', 0x0909: 'u', 0x090a: 'u', 0x090f: 'e', 0x0910: 'ai', 0x0913: 'o', 0x0914: 'au',
  0x093e: 'a', 0x093f: 'i', 0x0940: 'i', 0x0941: 'u', 0x0942: 'u', 0x0947: 'e', 0x0948: 'ai', 0x094b: 'o', 0x094c: 'au', 0x0902: 'n', 0x0901: 'n', 0x0903: 'h',
});
const SIGNS: ReadonlySet<number> = new Set([0x093e, 0x093f, 0x0940, 0x0941, 0x0942, 0x0947, 0x0948, 0x094b, 0x094c, 0x094d]);

/** A Hindi word's sound in Latin letters, the short a after each consonant kept unless a sign or the word's end follows. */
function hindiSound(word: string): string {
  let out = '';
  const chars = [...word];
  chars.forEach((char, index) => {
    const code = char.codePointAt(0)!;
    const consonant = CONSONANTS[code];
    if (consonant) {
      const next = chars[index + 1]?.codePointAt(0);
      out += consonant + (next === undefined || SIGNS.has(next) || char === VIRAMA ? '' : 'a');
    } else if (VOWELS[code]) out += VOWELS[code];
  });
  return latinSound(out);
}

/** A Latin word's sound: doubled vowels as one (aa, ee, oo), w as v, z as j, and its last vowels dropped. */
function latinSound(word: string): string {
  return word.replace(/aa+/g, 'a').replace(/ee+/g, 'i').replace(/oo+/g, 'u').replace(/ii+/g, 'i').replace(/uu+/g, 'u').replace(/w/g, 'v').replace(/z/g, 'j')
    .replace(/q/g, 'k').replace(/[aeiou]+$/u, '');
}

/** Two words are one: on their stems in the same script, by sound across scripts. */
export function sameWord(a: string, b: string): boolean {
  const hindiA = DEVANAGARI.test(a), hindiB = DEVANAGARI.test(b);
  if (hindiA && hindiB) return hindiStem(a) === hindiStem(b);
  if (!hindiA && !hindiB) return a === b || englishStem(a) === englishStem(b);
  const [hindi, latin] = hindiA ? [a, b] : [b, a];
  const sound = hindiSound(hindiStem(hindi));
  return sound.length >= 3 && sound === latinSound(latin);
}

/** A word or phrase in a text, as whole words in order, each on its stem. */
export function holdsPhrase(text: string, phrase: string): boolean {
  const wanted = voiceWords(phrase);
  if (!wanted.length) return false;
  const words = voiceWords(text);
  for (let start = 0; start + wanted.length <= words.length; start += 1) {
    if (wanted.every((word, offset) => sameWord(words[start + offset], word))) return true;
  }
  return false;
}

/**
 * A claim is made when its words appear as written, or when every one of its own words (two or more, common words left
 * out) is in one sentence in any order ("guarantee results" in "these results are guaranteed"), each on its stem.
 */
export function makesClaim(text: string, claim: string): boolean {
  if (holdsPhrase(text, claim)) return true;
  const own = voiceWords(claim).filter(word => word.length >= 3 && !VOICE_STOP_WORDS.has(word));
  if (own.length < 2) return false;
  // A sentence ends at a full stop, ! or ?, a new line, a semicolon or the Hindi danda.
  return text.split(/[.!?;\n]+/u).flatMap(part => part.split(cp(0x0964))).some(sentence => {
    const words = voiceWords(sentence);
    return own.every(word => words.some(found => sameWord(found, word)));
  });
}
