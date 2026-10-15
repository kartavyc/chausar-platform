/**
 * Spoken answers for `voice.speak`: every number said aloud is a calculator receipt figure turned into words in the
 * Indian system (crore, lakh, thousand), in English or romanised Hindi ("do lakh rupaye"). Exact: BigInt only.
 * No written explanation is read, and no label either: each figure is named by a fixed spoken label for its key
 * (and, for a single total, for the operation), so no word or number can come from owner or outside text. Each
 * amount is said in the figure's declared unit: rupees for money, basis points for basis points. Rupee words read
 * back through `interpretSpeech` to the same amount, which the tests check.
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

/** Basis points said as basis points, the figure's own unit: 1205 → "one thousand two hundred five basis points". */
export function spokenBasisPointsCount(minor: string, language: SpokenLanguage): string {
  check(/^-?\d{1,30}$/.test(minor), 'INVALID_NUMBER', 'Basis points are whole numbers.');
  const value = BigInt(minor); const abs = value < 0n ? -value : value;
  return `${value < 0n ? 'minus ' : ''}${numberWords(abs, language)} ${abs === 1n ? 'basis point' : 'basis points'}`;
}

const WORDS: Record<SpokenLanguage, { none: string; stale: string; figure: string; total: string; other: string }> = {
  en: { none: 'This answer has no figures to read aloud.', stale: 'These figures are out of date. Recalculate before relying on them.', figure: 'Figure', total: 'Total', other: 'an amount in another currency, not read aloud' },
  hi: { none: 'Is jawab mein padhne ke liye koi aankda nahi hai.', stale: 'Ye aankde purane hain. Bharosa karne se pehle dobara ginein.', figure: 'Aankda', total: 'Kul', other: 'doosri mudra mein rakam, padhi nahi gayi' },
};
/** Fixed spoken names of the calculator's figure keys. A key not listed is said as "Figure". */
const FIGURE_LABELS: Record<SpokenLanguage, Record<string, string>> = {
  en: { earned: 'Earned', refunds: 'Refunds', netSales: 'Net sales', costs: 'Imported costs', contribution: 'Contribution', marginBps: 'Margin',
    current: 'Current earned revenue', previous: 'Prior earned revenue', change: 'Change', changeBps: 'Change', baseline: 'Measured baseline', scenario: 'Scenario revenue',
    priceChangeBps: 'Assumed price change', notDue: 'Not yet due', days1to30: 'Overdue up to thirty days', days31to60: 'Overdue thirty-one to sixty days',
    days61to90: 'Overdue sixty-one to ninety days', over90: 'Overdue more than ninety days', outstanding: 'Outstanding receivables', unallocated: 'Unallocated receipts or credits' },
  hi: { earned: 'Kamaya', refunds: 'Refund', netSales: 'Net bikri', costs: 'Darj kharch', contribution: 'Yogdaan', marginBps: 'Margin',
    current: 'Is avadhi ki kamai', previous: 'Pichhli avadhi ki kamai', change: 'Badlaav', changeBps: 'Badlaav', baseline: 'Maapi gayi aadhar kamai', scenario: 'Anumaanit kamai',
    priceChangeBps: 'Maana gaya daam badlaav', notDue: 'Abhi due nahi', days1to30: 'Tees din tak overdue', days31to60: 'Iktees se saath din overdue',
    days61to90: 'Iksath se nabbe din overdue', over90: 'Nabbe din se zyada overdue', outstanding: 'Baaki receivables', unallocated: 'Bina milaan ki raseedein' },
};
/** Fixed spoken names of a single total, by the receipt's operation. Any other operation's total is said as "Total". */
const TOTAL_LABELS: Record<SpokenLanguage, Record<string, string>> = {
  en: { billed: 'Billed', received: 'Received', earned: 'Earned', refunds: 'Refunds', costs: 'Costs', purchases: 'Purchases', revenue: 'Revenue earned', net_sales: 'Net sales' },
  hi: { billed: 'Bill kiya', received: 'Mila', earned: 'Kamaya', refunds: 'Refund', costs: 'Kharch', purchases: 'Khareed', revenue: 'Kamai', net_sales: 'Net bikri' },
};
const own = (table: Record<string, string>, key: unknown) => typeof key === 'string' && Object.hasOwn(table, key) ? table[key] : undefined;

/**
 * Segments for one calculator receipt: "out of date" first when it is stale, then one segment per figure carrying its
 * `figureKey`. The label is fixed per key (never the figure's own label text) and the amount is spelled from
 * `figure.minor` in the figure's unit, so nothing but a figure's own value reaches speech as a number.
 */
export function speakFigures(receipt: { operation?: string; figures: readonly SpokenFigure[]; stale?: boolean }, language: SpokenLanguage): SpokenSegment[] {
  const words = WORDS[language]; const segments: SpokenSegment[] = [];
  if (receipt.stale) segments.push({ text: words.stale });
  for (const figure of receipt.figures) {
    const label = figure.key === 'total' ? own(TOTAL_LABELS[language], receipt.operation) ?? words.total : own(FIGURE_LABELS[language], figure.key) ?? words.figure;
    let amount: string;
    if (figure.unit === 'money' && (figure.currency ?? 'INR') === 'INR') amount = spokenRupees(figure.minor, language);
    else if (figure.unit === 'basis-points') amount = spokenBasisPointsCount(figure.minor, language);
    else amount = words.other;
    segments.push({ text: `${label}: ${amount}.`, figureKey: figure.key });
  }
  if (receipt.figures.length === 0) segments.push({ text: words.none });
  return segments;
}
