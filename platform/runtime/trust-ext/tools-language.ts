/** TL-10 language packs: a small deterministic reader for spoken amounts and negation, and its shipped cases. */
import { shipped } from './tools-common.ts';

/** Devanagari has two spellings of nukta letters; every table and input is compared in NFC. */
const nfc = <T>(table: Record<string, T>): Record<string, T> => Object.fromEntries(Object.entries(table).map(([key, value]) => [key.normalize('NFC'), value]));
const nfcSet = (words: string[]) => new Set(words.map(word => word.normalize('NFC')));
// Values are in quarter rupees so dedh (1.5), dhai (2.5) and sava (+0.25) stay whole.
const SMALL: Record<string, bigint> = nfc({
  zero: 0n, one: 1n, two: 2n, three: 3n, four: 4n, five: 5n, six: 6n, seven: 7n, eight: 8n, nine: 9n, ten: 10n, twenty: 20n, thirty: 30n, forty: 40n, fifty: 50n, sixty: 60n, seventy: 70n, eighty: 80n, ninety: 90n,
  ek: 1n, do: 2n, teen: 3n, char: 4n, chaar: 4n, paanch: 5n, panch: 5n, chhe: 6n, chhah: 6n, saat: 7n, aath: 8n, nau: 9n, das: 10n, gyarah: 11n, barah: 12n, terah: 13n, chaudah: 14n, pandrah: 15n,
  solah: 16n, satrah: 17n, atharah: 18n, unnis: 19n, bees: 20n, pachchis: 25n, tees: 30n, chalis: 40n, chaalis: 40n, pachas: 50n, pachaas: 50n, saath: 60n, sattar: 70n, assi: 80n, nabbe: 90n,
  'एक': 1n, 'दो': 2n, 'तीन': 3n, 'चार': 4n, 'पांच': 5n, 'पाँच': 5n, 'छह': 6n, 'छः': 6n, 'सात': 7n, 'आठ': 8n, 'नौ': 9n, 'दस': 10n, 'ग्यारह': 11n, 'बारह': 12n, 'पंद्रह': 15n,
  'बीस': 20n, 'पच्चीस': 25n, 'तीस': 30n, 'चालीस': 40n, 'पचास': 50n, 'साठ': 60n, 'सत्तर': 70n, 'अस्सी': 80n, 'नब्बे': 90n,
});
const FRACTION: Record<string, bigint> = nfc({ dedh: 6n, dhai: 10n, 'डेढ़': 6n, 'ढाई': 10n });
const MODIFIER: Record<string, bigint> = nfc({ sava: 1n, saadhe: 2n, sadhe: 2n, paune: -1n, 'सवा': 1n, 'साढ़े': 2n, 'पौने': -1n });
const HUNDRED = nfcSet(['sau', 'hundred', 'सौ']);
const SCALE: Record<string, bigint> = nfc({ thousand: 1000n, hazaar: 1000n, hazar: 1000n, 'हज़ार': 1000n, 'हजार': 1000n, lakh: 100000n, lac: 100000n, 'लाख': 100000n, crore: 10000000n, karod: 10000000n, 'करोड़': 10000000n });
const NEGATION = nfcSet(['nahi', 'nahin', 'mat', 'not', "don't", 'never', 'नहीं', 'मत', 'ना']);
const NOISE = nfcSet(['rupaye', 'rupees', 'rupee', 'rs', 'ka', 'ke', 'ki', 'bhejo', 'bhej', 'send', 'pay', 'karo', 'rupay', 'रुपये', 'रुपए', 'भेजो', 'का', 'के', 'की', 'करो']);

export type Reading = { paise: string | null; negated: boolean };

/** Reads one spoken amount. An unknown word makes the amount unknown rather than guessed. */
export function readSpoken(text: string): Reading {
  const tokens = text.normalize('NFC').toLowerCase().replace(/[₹,.?!।]/g, ' ').split(/\s+/).filter(Boolean);
  const negated = tokens.some(token => NEGATION.has(token));
  let total = 0n, current = 0n, modifier = 0n, seen = false, unknown = false;
  for (const token of tokens) {
    if (NEGATION.has(token) || NOISE.has(token)) continue;
    if (/^\d+$/.test(token)) { current += BigInt(token) * 4n + modifier; modifier = 0n; seen = true; }
    else if (Object.hasOwn(SMALL, token)) { current += SMALL[token] * 4n + modifier; modifier = 0n; seen = true; }
    else if (Object.hasOwn(FRACTION, token)) { current += FRACTION[token]; seen = true; }
    else if (Object.hasOwn(MODIFIER, token)) modifier = MODIFIER[token];
    else if (HUNDRED.has(token)) { current = (current || 4n) * 100n; seen = true; }
    else if (Object.hasOwn(SCALE, token)) { total += (current || 4n) * SCALE[token]; current = 0n; seen = true; }
    else unknown = true;
  }
  const quarters = total + current;
  return { paise: seen && !unknown ? (quarters * 25n).toString() : null, negated };
}

type Case = { pack: string; text: string; paise: string | null; negated: boolean };
const CASES = shipped<{ version: number; cases: Case[] }>('tools-language-cases.v1.json');
const PACKS = [
  { id: 'en', name: 'English', builtIn: true },
  { id: 'hi', name: 'Hindi', builtIn: false },
  { id: 'hinglish', name: 'Hinglish', builtIn: false },
];

export function languagePacks() {
  return { packs: PACKS.map(pack => {
    const cases = CASES.cases.filter(item => item.pack === pack.id);
    const passed = cases.filter(item => { const reading = readSpoken(item.text); return reading.paise === item.paise && reading.negated === item.negated; }).length;
    return { id: pack.id, name: pack.name, cases: { passed, total: cases.length }, supported: cases.length > 0 && passed === cases.length, reviewed: pack.builtIn };
  }) };
}
