// Chausar venture launcher, core (wave 6, package 6C3; DECISIONS D17): the price ranges of core/price-ranges-data.ts as
// screens show them. Code writes every amount's words from the BigInt minor units (the UI never formats or computes
// money), each range keeps its sources and the date checked, and a profession with no credible source reads "No
// reliable data". A guide is information beside the owner's own price: nothing here sets, suggests or changes a price.
// Pure: no clock, no store, no model. The fake engine imports this file too, so it answers exactly like the engine.
import { ChausarError, check } from '../../portable.ts';
import { PRICE_FAMILIES, PRICES_CHECKED_ON, PROFESSION_PRICES, type PriceRangeRow, type ProfessionPrices } from './price-ranges-data.ts';
import { PRICE_FAMILY_OF, PROFESSIONS, professionsForPlaybook } from './professions.ts';

/** W6 6C3 (D17): one source of a price range, as published. published is the source's own date when it shows one. */
export type PriceSourceView = { url: string; publisher: string; title: string; published: string | null };
/**
 * W6 6C3: one sourced range. lowMinor and highMinor are minor units as decimal text (BigInt in the data); text is the
 * range in words made by code ("₹300 to ₹400", "Up to ₹1,51,000" for a legal cap, "... or more" for a scale of minimum
 * fees); per is its unit ("per hour"); checked is checkedOn in words ("1 Nov 2026").
 */
export type PriceRangeView = {
  id: string; label: string; currency: string; lowMinor: string; highMinor: string; kind: 'range' | 'minimums' | 'cap';
  text: string; per: string; city: string | null; sources: PriceSourceView[]; checkedOn: string; checked: string; note: string;
};
/** W6 6C3: a profession's ranges; with no credible source, status no-reliable-data, no ranges, line "No reliable data" and the reason. */
export type PriceGuideView = {
  profession: string; label: string; family: string; status: 'sourced' | 'no-reliable-data';
  ranges: PriceRangeView[]; line: string | null; reason: string | null; checkedOn: string; checked: string;
};

export const NO_RELIABLE_DATA = 'No reliable data';

/**
 * Which beta profession each way to earn serves (PACKAGES 6E6's engine column), and the one range that prices the same
 * service, in the same unit, as the way sells. range null: the profession's sources price only part of the way's
 * service, a different service or another unit (the CA way sells books, GST, TDS and income tax a client a month; ICAI's
 * figures are minimums for single tasks), so the way keeps its model estimate and shows the guide beside it. A playbook
 * missing here (the social agency) maps to no profession.
 */
export const WAY_PRICES: Readonly<Record<string, { profession: string; range: string | null }>> = Object.freeze({
  'ca-firm': { profession: 'chartered-accountant', range: null },
  'bookkeeping-cfo': { profession: 'accountant', range: 'accountant-monthly-books' },
  'translation-studio': { profession: 'translator', range: null },
  'narration-studio': { profession: 'voice-artist', range: null },
  'job-search-desk': { profession: 'senior-mentor', range: null },
  'it-triage': { profession: 'it-support', range: null },
  youtube: { profession: 'video-editor', range: null },
  'seo-visibility': { profession: 'marketing-seo-blogs', range: null },
  'online-seller': { profession: 'marketplace-seller-ops', range: null },
  'support-desk': { profession: 'customer-service', range: null },
  'recruiting-desk': { profession: 'hr-recruiter', range: null },
  'podcast-to-article': { profession: 'podcaster', range: null },
  'lead-generation': { profession: 'sales-executive', range: null },
  'newsletter-studio': { profession: 'journalist-newsletter', range: null },
  'tender-desk': { profession: 'tender-bid-writer', range: null },
  'website-studio': { profession: 'website-developer', range: null },
  'virtual-assistant': { profession: 'executive-assistant', range: null },
  'data-entry-desk': { profession: 'data-entry', range: null },
  'app-testing': { profession: 'qa-tester', range: null },
  'dev-agency': { profession: 'website-developer', range: null },
  'monitored-data': { profession: 'market-research-analyst', range: null },
  'phone-receptionist': { profession: 'ai-receptionist', range: null },
});

const SYMBOL: Readonly<Record<PriceRangeRow['currency'], string>> = Object.freeze({ INR: '₹', USD: '$' });
const GROUPING: Readonly<Record<PriceRangeRow['currency'], string>> = Object.freeze({ INR: 'en-IN', USD: 'en-US' });
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** An ISO day in words, as the app writes dates: "1 Nov 2026". */
export function dayWords(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  check(Number.isInteger(year) && Number.isInteger(month) && Number.isInteger(day) && month! >= 1 && month! <= 12, 'INVALID_VENTURE_REQUEST', 'Use a date as YYYY-MM-DD.');
  return `${day} ${MONTHS[month! - 1]} ${year}`;
}

/** Both amounts in words, from minor units (both currencies here have two minor digits); paise show only when either has some. */
function amounts(row: PriceRangeRow): [string, string] {
  const fractional = row.low % 100n !== 0n || row.high % 100n !== 0n;
  const group = new Intl.NumberFormat(GROUPING[row.currency], { maximumFractionDigits: 0 });
  const words = (minor: bigint) => `${SYMBOL[row.currency]}${group.format(minor / 100n)}${fractional ? `.${String(minor % 100n).padStart(2, '0')}` : ''}`;
  return [words(row.low), words(row.high)];
}

/** A range's words: "₹300 to ₹400"; one figure when low and high agree; "Up to" a legal cap; "or more" for minimum fees. */
export function rangeText(row: PriceRangeRow): string {
  const [low, high] = amounts(row);
  if (row.kind === 'cap') return `Up to ${high}`;
  const span = row.low === row.high ? low : `${low} to ${high}`;
  return row.kind === 'minimums' ? `${span} or more` : span;
}

function rangeView(row: PriceRangeRow): PriceRangeView {
  return {
    id: row.id, label: row.label, currency: row.currency, lowMinor: String(row.low), highMinor: String(row.high), kind: row.kind,
    text: rangeText(row), per: row.unit, city: row.city, sources: row.sources.map(source => ({ ...source })),
    checkedOn: row.checkedOn, checked: dayWords(row.checkedOn), note: row.note,
  };
}

function professionRow(id: string): ProfessionPrices {
  const row = PROFESSION_PRICES.find(item => item.id === id);
  if (!row) throw new ChausarError('INVALID_VENTURE_REQUEST', 'That profession is not in the beta list.');
  return row;
}

/** A profession's ranges as a screen shows them, or "No reliable data" with the reason when no credible source exists. */
export function priceGuide(profession: string): PriceGuideView {
  const row = professionRow(profession);
  const sourced = row.ranges.length > 0;
  return {
    profession: row.id, label: row.label, family: row.family, status: sourced ? 'sourced' : 'no-reliable-data',
    ranges: row.ranges.map(rangeView), line: sourced ? null : NO_RELIABLE_DATA, reason: sourced ? null : row.noData ?? null,
    checkedOn: PRICES_CHECKED_ON, checked: dayWords(PRICES_CHECKED_ON),
  };
}

/** The country the data is for: India first. A business in another country sees no guide rather than rupee ranges. */
export const PRICES_COUNTRY = 'IN';

/** The guide for a playbook's profession in the business's country, or null when the playbook maps to none or the country has no data. */
export function priceGuideForPlaybook(playbook: string | null | undefined, countryCode: string | null | undefined = PRICES_COUNTRY): PriceGuideView | null {
  if (countryCode !== PRICES_COUNTRY) return null;
  const mapping = playbook ? WAY_PRICES[playbook] : undefined;
  return mapping ? priceGuide(mapping.profession) : null;
}

/**
 * What a way's "Clients usually pay" shows, or null when the way maps to no profession: the guide, and the one sourced
 * range that prices the way's own service with its source line, or null when there is none (the model estimate stays).
 */
export function wayPrice(playbook: string): { guide: PriceGuideView; range: PriceRangeView | null; source: string | null } | null {
  const mapping = WAY_PRICES[playbook];
  if (!mapping) return null;
  const guide = priceGuide(mapping.profession);
  const range = mapping.range ? guide.ranges.find(item => item.id === mapping.range) ?? null : null;
  const publishers = range ? [...new Set(range.sources.map(source => source.publisher))].join(', ') : null;
  return { guide, range, source: range ? `${publishers}. Checked ${range.checked}.` : null };
}

/**
 * Throws, naming the row and the rule, unless every profession has a known family, a unique id and either sourced
 * ranges (unique ids, INR or USD, BigInt minor amounts low to high above zero, a cap from zero, a "per" unit, sources
 * with https links, publisher and title, the checked date) or a reason for no reliable data; and every way names a
 * profession here and, where it shows a range, that profession's range. W6 6E6: the rows are the 57-profession map's
 * (core/professions.ts), same ids, labels, order and families, and each way's profession is one that runs on that way.
 */
export function validatePriceRanges(rows: readonly ProfessionPrices[] = PROFESSION_PRICES): void {
  const fail = (message: string): never => { throw new ChausarError('INVALID_VENTURE_REQUEST', message); };
  const professions = new Set<string>();
  const ranges = new Set<string>();
  for (const row of rows) {
    if (professions.has(row.id)) fail(`${row.id} is listed twice.`);
    professions.add(row.id);
    if (!PRICE_FAMILIES.includes(row.family)) fail(`${row.id} needs one of the eleven families.`);
    if (!row.label.trim()) fail(`${row.id} needs a label.`);
    if (row.ranges.length === 0 && !row.noData?.trim()) fail(`${row.id} needs a range or the reason there is no reliable data.`);
    if (row.ranges.length > 0 && row.noData !== undefined) fail(`${row.id} has ranges, so it is not "no reliable data".`);
    for (const range of row.ranges) {
      if (ranges.has(range.id)) fail(`The range ${range.id} is listed twice.`);
      ranges.add(range.id);
      if (!(range.currency in SYMBOL)) fail(`${range.id} needs INR or USD.`);
      if (typeof range.low !== 'bigint' || typeof range.high !== 'bigint') fail(`${range.id} needs BigInt minor amounts.`);
      const lowOk = range.kind === 'cap' ? range.low === 0n : range.low > 0n;
      if (!lowOk || range.high < range.low || range.high <= 0n) fail(`${range.id} needs amounts above zero, the lowest first.`);
      if (!range.unit.startsWith('per ')) fail(`${range.id} needs a unit such as "per hour".`);
      if (range.checkedOn !== PRICES_CHECKED_ON) fail(`${range.id} needs the date it was checked.`);
      if (!range.label.trim() || !range.note.trim()) fail(`${range.id} needs a label and a note.`);
      if (range.sources.length === 0) fail(`${range.id} needs at least one source.`);
      for (const source of range.sources) {
        if (!source.url.startsWith('https://') || /\s/.test(source.url) || !source.publisher.trim() || !source.title.trim()) fail(`${range.id} needs each source's https link, publisher and title.`);
      }
    }
  }
  for (const [playbook, mapping] of Object.entries(WAY_PRICES)) {
    const row = rows.find(item => item.id === mapping.profession) ?? fail(`The way ${playbook} names an unknown profession.`);
    if (mapping.range && !row.ranges.some(range => range.id === mapping.range)) fail(`The way ${playbook} names a range its profession does not have.`);
    if (rows === PROFESSION_PRICES && !professionsForPlaybook(playbook).some(item => item.id === mapping.profession)) fail(`The way ${playbook} names ${mapping.profession}, which the profession map does not run on it.`);
  }
  if (rows === PROFESSION_PRICES) {
    if (rows.length !== PROFESSIONS.length) fail(`The price guide lists ${rows.length} professions; the profession map lists ${PROFESSIONS.length}.`);
    PROFESSIONS.forEach((profession, index) => {
      const row = rows[index]!;
      if (row.id !== profession.id || row.label !== profession.label || row.family !== PRICE_FAMILY_OF[profession.family]) fail(`Price row ${row.id} does not match the profession map's ${profession.id}.`);
    });
  }
}
