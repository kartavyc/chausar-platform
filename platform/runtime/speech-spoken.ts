/**
 * Spoken answers for `voice.speak`: every number said aloud is a calculator receipt figure turned into words in the
 * Indian system (crore, lakh, thousand), in English or romanised Hindi ("do lakh rupaye"). Exact: BigInt only.
 * No written explanation is read, so no number can come from free text. The words read back through
 * `interpretSpeech` to the same amount, which the tests check.
 */
import { check } from './contracts.ts';
import { HINDI_ROMAN_WORDS } from './speech-understood.ts';

export type SpokenLanguage = 'en' | 'hi';
export type SpokenFigure = { key: string; label: string; minor: string; display: string; unit: string; currency?: string };
export type SpokenSegment = { text: string; figureKey?: string };

const EN_SMALL = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const EN_TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const SCALE: Record<SpokenLanguage, { hundred: string; thousand: string; lakh: string; crore: string }> = {
  en: { hundred: 'hundred', thousand: 'thousand', lakh: 'lakh', crore: 'crore' },
  hi: { hundred: 'sau', thousand: 'hazaar', lakh: 'lakh', crore: 'crore' },
};

function below100(n: number, language: SpokenLanguage): string {
  if (language === 'hi') return HINDI_ROMAN_WORDS[n]!;
  if (n < 20) return EN_SMALL[n]!;
  return EN_TENS[Math.floor(n / 10)]! + (n % 10 ? `-${EN_SMALL[n % 10]}` : '');
}

/** A whole number in words, Indian system: 12345678 → "one crore twenty-three lakh forty-five thousand six hundred seventy-eight". */
export function numberWords(value: bigint, language: SpokenLanguage): string {
  check(value >= 0n, 'INVALID_NUMBER', 'Spell whole numbers only.');
  if (value === 0n) return below100(0, language);
  const scale = SCALE[language]; const parts: string[] = [];
  const crore = value / 10000000n; let rest = value % 10000000n;
  if (crore > 0n) parts.push(`${numberWords(crore, language)} ${scale.crore}`);
  const lakh = Number(rest / 100000n); rest %= 100000n;
  if (lakh) parts.push(`${below100(lakh, language)} ${scale.lakh}`);
  const thousand = Number(rest / 1000n); rest %= 1000n;
  if (thousand) parts.push(`${below100(thousand, language)} ${scale.thousand}`);
  const hundred = Number(rest / 100n); const last = Number(rest % 100n);
  if (hundred) parts.push(`${below100(hundred, language)} ${scale.hundred}`);
  if (last) parts.push(below100(last, language));
  return parts.join(' ');
}

/** Whole paise as spoken rupees: "200000" paise → "two thousand rupees" / "do hazaar rupaye". */
export function spokenRupees(minor: string, language: SpokenLanguage): string {
  check(/^-?\d{1,40}$/.test(minor), 'INVALID_MINOR_UNITS', 'Amounts are whole paise.');
  const value = BigInt(minor); const negative = value < 0n; const abs = negative ? -value : value;
  const rupees = abs / 100n; const paise = abs % 100n; const words: string[] = [];
  if (rupees > 0n || paise === 0n) words.push(`${numberWords(rupees, language)} ${language === 'hi' ? (rupees === 1n ? 'rupaya' : 'rupaye') : (rupees === 1n ? 'rupee' : 'rupees')}`);
  if (paise > 0n) words.push(`${numberWords(paise, language)} paise`);
  return `${negative ? 'minus ' : ''}${words.join(language === 'hi' ? ' aur ' : ' and ')}`;
}

/** Basis points as a spoken percentage: 1205 → "twelve point zero five percent" / "baarah dashamlav shunya paanch pratishat". */
export function spokenBasisPoints(minor: string, language: SpokenLanguage): string {
  check(/^-?\d{1,30}$/.test(minor), 'INVALID_NUMBER', 'Basis points are whole numbers.');
  return `${hundredths(BigInt(minor), language)} ${language === 'hi' ? 'pratishat' : 'percent'}`;
}
/** A count of hundredths as a spoken decimal: -1205 → "minus twelve point zero five". */
function hundredths(value: bigint, language: SpokenLanguage): string {
  const negative = value < 0n; const abs = negative ? -value : value;
  const digits = String(abs % 100n).padStart(2, '0').replace(/0$/, '');
  const fraction = abs % 100n === 0n ? '' : ` ${language === 'hi' ? 'dashamlav' : 'point'} ${[...digits].map(d => below100(Number(d), language)).join(' ')}`;
  return `${negative ? 'minus ' : ''}${numberWords(abs / 100n, language)}${fraction}`;
}

const WORDS: Record<SpokenLanguage, { none: string; stale: string; figure: string }> = {
  en: { none: 'This answer has no figures to read aloud.', stale: 'These figures are out of date.', figure: 'Figure' },
  hi: { none: 'Is jawab mein padhne ke liye koi aankda nahi hai.', stale: 'Ye aankde purane hain.', figure: 'Aankda' },
};

/**
 * Segments for one calculator receipt. Each figure is one segment carrying its `figureKey`; its amount is spelled from
 * `figure.minor`. A label holding a digit is replaced by a fixed word, so no number reaches speech except a figure's own.
 */
export function speakFigures(receipt: { figures: readonly SpokenFigure[]; stale?: boolean }, language: SpokenLanguage): SpokenSegment[] {
  const words = WORDS[language]; const segments: SpokenSegment[] = [];
  if (receipt.stale) segments.push({ text: words.stale });
  for (const figure of receipt.figures) {
    const label = typeof figure.label === 'string' && figure.label.length <= 120 && !/[\p{N}]/u.test(figure.label) ? figure.label : words.figure;
    let amount: string;
    if (figure.unit === 'money' && (figure.currency ?? 'INR') === 'INR') amount = spokenRupees(figure.minor, language);
    else if (figure.unit === 'basis-points') amount = spokenBasisPoints(figure.minor, language);
    else { check(/^-?\d{1,40}$/.test(figure.minor), 'INVALID_MINOR_UNITS', 'Amounts are whole minor units.'); amount = `${hundredths(BigInt(figure.minor), language)} ${figure.currency ?? ''}`.trim(); }
    segments.push({ text: `${label}: ${amount}.`, figureKey: figure.key });
  }
  if (receipt.figures.length === 0) segments.push({ text: words.none });
  return segments;
}
