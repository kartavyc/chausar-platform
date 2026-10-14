import { check } from '../contracts.ts';
import { parseIndianMoney } from '../ingest.ts';
import { validDate } from '../memory.ts';

export type DateFormat = 'ISO' | 'ISO-DATETIME' | 'ISO-DATETIME-IST' | 'DMY' | 'DMY-MON' | 'MDY' | 'YMD8' | 'EPOCH-S-IST' | 'EPOCH-MS-IST' | 'YYYY-MM' | 'MON-YYYY';
export const DATE_FORMATS: readonly DateFormat[] = ['ISO', 'ISO-DATETIME', 'ISO-DATETIME-IST', 'DMY', 'DMY-MON', 'MDY', 'YMD8', 'EPOCH-S-IST', 'EPOCH-MS-IST', 'YYYY-MM', 'MON-YYYY'];
const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  january: 1, february: 2, march: 3, april: 4, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };
const iso = (y: number, m: number, d: number): string | null => {
  const value = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return validDate(value) ? value : null;
};
const year = (text: string) => text.length === 2 ? 2000 + Number(text) : Number(text);
/** India Standard Time has no daylight saving: a fixed +05:30 offset gives the business date. */
const istDate = (ms: number) => new Date(ms + 19_800_000).toISOString().slice(0, 10);

/** Parse one date in one stated format. Null means "not this format", never a guess. */
export function parseDateAs(value: string, format: DateFormat): string | null {
  const text = value.trim(); let m: RegExpExecArray | null;
  switch (format) {
    case 'ISO': return /^\d{4}-\d{2}-\d{2}$/.test(text) && validDate(text) ? text : null;
    case 'ISO-DATETIME': m = /^(\d{4}-\d{2}-\d{2})[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})?$/.exec(text); return m && validDate(m[1]) ? m[1] : null;
    /** A timestamp with an explicit offset or Z, read as its India business date. No offset: not this format. */
    case 'ISO-DATETIME-IST': {
      m = /^(\d{4}-\d{2}-\d{2})[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})$/.exec(text);
      if (!m || !validDate(m[1])) return null;
      const ms = Date.parse(text.replace(' ', 'T').replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
      return Number.isFinite(ms) ? istDate(ms) : null;
    }
    case 'DMY': m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})$/.exec(text); return m ? iso(year(m[3]), Number(m[2]), Number(m[1])) : null;
    case 'MDY': m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})$/.exec(text); return m ? iso(year(m[3]), Number(m[1]), Number(m[2])) : null;
    case 'DMY-MON': {
      m = /^(\d{1,2})[\s-]([A-Za-z]{3,9})[\s,-]+(\d{4}|\d{2})(?:\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AP]M)?)?$/i.exec(text);
      const month = m ? MONTHS[m[2].toLowerCase()] : undefined; return m && month ? iso(year(m[3]), month, Number(m[1])) : null;
    }
    case 'YMD8': return /^\d{8}$/.test(text) ? iso(Number(text.slice(0, 4)), Number(text.slice(4, 6)), Number(text.slice(6, 8))) : null;
    case 'EPOCH-S-IST': return /^\d{9,11}$/.test(text) ? istDate(Number(text) * 1000) : null;
    case 'EPOCH-MS-IST': return /^\d{12,14}$/.test(text) ? istDate(Number(text)) : null;
    case 'YYYY-MM': m = /^(\d{4})-(\d{2})$/.exec(text); return m ? iso(Number(m[1]), Number(m[2]), 1) : null;
    case 'MON-YYYY': {
      m = /^([A-Za-z]{3,9})[\s,-]+(\d{4})$/.exec(text);
      const month = m ? MONTHS[m[1].toLowerCase()] : undefined; return m && month ? iso(Number(m[2]), month, 1) : null;
    }
  }
}
/** Every stated format is tried. Two different readings of one value is an ambiguity to ask about. */
export function parseDate(value: string, formats: readonly DateFormat[]): { date: string | null; readings: string[] } {
  const readings = [...new Set(formats.map(format => parseDateAs(value, format)).filter((item): item is string => item !== null))];
  return { date: readings.length === 1 ? readings[0] : null, readings };
}

/** Exact money text to minor units. Empty, dash and "-" are missing, never zero. */
export function parseMoney(value: string, unit: 'major' | 'minor', currency: string): string | null {
  let text = value.normalize('NFKC').trim();
  if (text === '' || /^[-–—]$/.test(text) || /^n\/?a$/i.test(text)) return null;
  let negative = false;
  if (/^\(.*\)$/.test(text)) { negative = true; text = text.slice(1, -1).trim(); }
  text = text.replace(/^(?:INR|Rs\.?|₹)\s*/i, '').replace(/\s+(?=\d)/g, '');
  if (/^-\s*(?:INR|Rs\.?|₹)/i.test(text)) { negative = !negative; text = text.replace(/^-\s*(?:INR|Rs\.?|₹)\s*/i, ''); }
  check(/^[-+]?[\d,]+(?:\.\d+)?(?:\s*(?:Dr|Cr))?$/i.test(text), 'INVALID_MONEY', 'An amount is not exact decimal money.');
  text = text.replace(/^\+/, '');
  const minor = parseIndianMoney(text, unit, currency);
  return negative ? String(-BigInt(minor)) : minor;
}
export function parseInteger(value: string): string | null {
  const text = value.trim().replaceAll(',', '');
  if (text === '' || /^[-–—]$/.test(text)) return null;
  check(/^-?\d{1,18}$/.test(text), 'INVALID_INTEGER', 'A count is not a whole number.');
  return String(BigInt(text));
}
