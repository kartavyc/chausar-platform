/** Statutory due dates worked out by the engine from the shipped, sourced table. No date is ever written by a model. */
import { readFileSync } from 'node:fs';
import { check } from '../contracts.ts';
import { validDate } from '../memory.ts';
import { addDays, closed, daysBetween, dateOf, monthEnd, type Language, type Words } from './common.ts';

type Rule = { type: 'monthly'; day: number | 'last'; months?: number[]; overrides?: Record<string, number> } | { type: 'annual'; dates: string[] };
/** The official page that sets the date, its notification or circular date (null when it states none), and whether it was opened and found to state the date. */
export type DueSource = { title: string; url: string; date: string | null; confirmed: boolean };
type TableRow = { id: string; what: string; whatHi: string; rule: Rule; source: DueSource; lastChecked: string; appliesTo: { kinds: string[]; gstModes: string[]; states: string[] } };
type Table = { version: string; publishedAt: string; reviewed: boolean; kinds: string[]; gstModes: string[]; states: string[]; rows: TableRow[] };
export type DueProfile = { kind: string; gstMode: 'regular' | 'composition' | 'none'; state: string };
/** `appliesToWords` names the same kinds, GST modes and states in the language asked for. */
export type DueRow = { id: string; what: string; dueOn: string; source: DueSource; lastChecked: string; checkOld: boolean; appliesTo: TableRow['appliesTo'];
  appliesToWords: TableRow['appliesTo'] };

const w = (en: string, hi: string): Words => ({ en, hi });
/** The kinds of business the table covers, in words. */
const kindWords: Record<string, Words> = {
  ecommerce: w('Online selling', 'ऑनलाइन बिक्री'), retail: w('Shop or retail', 'दुकान या खुदरा'), services: w('Services', 'सेवाएँ'),
  distributor: w('Distribution or wholesale', 'वितरण या थोक'), manufacturing: w('Manufacturing', 'निर्माण'), saas: w('Software sold by subscription', 'सदस्यता पर बिकने वाला सॉफ़्टवेयर'),
};
const gstWords: Record<DueProfile['gstMode'], Words> = { regular: w('Regular GST', 'नियमित GST'), composition: w('GST composition', 'GST कंपोज़िशन'), none: w('No GST registration', 'GST पंजीकरण नहीं') };
/** States and union territories by their two-letter code, in words. */
const stateWords: Record<string, Words> = {
  all: w('Every state and union territory', 'हर राज्य और केंद्र शासित प्रदेश'),
  AN: w('Andaman and Nicobar Islands', 'अंडमान और निकोबार द्वीप समूह'), AP: w('Andhra Pradesh', 'आंध्र प्रदेश'), AR: w('Arunachal Pradesh', 'अरुणाचल प्रदेश'),
  AS: w('Assam', 'असम'), BR: w('Bihar', 'बिहार'), CH: w('Chandigarh', 'चंडीगढ़'), CT: w('Chhattisgarh', 'छत्तीसगढ़'),
  DH: w('Dadra and Nagar Haveli and Daman and Diu', 'दादरा और नगर हवेली और दमन और दीव'), DL: w('Delhi', 'दिल्ली'), GA: w('Goa', 'गोवा'),
  GJ: w('Gujarat', 'गुजरात'), HP: w('Himachal Pradesh', 'हिमाचल प्रदेश'), HR: w('Haryana', 'हरियाणा'), JH: w('Jharkhand', 'झारखंड'),
  JK: w('Jammu and Kashmir', 'जम्मू और कश्मीर'), KA: w('Karnataka', 'कर्नाटक'), KL: w('Kerala', 'केरल'), LA: w('Ladakh', 'लद्दाख'),
  LD: w('Lakshadweep', 'लक्षद्वीप'), MH: w('Maharashtra', 'महाराष्ट्र'), ML: w('Meghalaya', 'मेघालय'), MN: w('Manipur', 'मणिपुर'),
  MP: w('Madhya Pradesh', 'मध्य प्रदेश'), MZ: w('Mizoram', 'मिज़ोरम'), NL: w('Nagaland', 'नागालैंड'), OR: w('Odisha', 'ओडिशा'),
  PB: w('Punjab', 'पंजाब'), PY: w('Puducherry', 'पुदुचेरी'), RJ: w('Rajasthan', 'राजस्थान'), SK: w('Sikkim', 'सिक्किम'),
  TG: w('Telangana', 'तेलंगाना'), TN: w('Tamil Nadu', 'तमिलनाडु'), TR: w('Tripura', 'त्रिपुरा'), UP: w('Uttar Pradesh', 'उत्तर प्रदेश'),
  UT: w('Uttarakhand', 'उत्तराखंड'), WB: w('West Bengal', 'पश्चिम बंगाल'),
};
const notes = {
  ca: w('Not yet checked by a CA.', 'अभी किसी CA ने नहीं जाँचा है।'),
  table: w('Each row links to the official source that sets its date, with the day it was last checked.', 'हर पंक्ति उस आधिकारिक स्रोत से जुड़ी है जो उसकी तारीख़ तय करता है, और बताती है कि उसे आख़िरी बार कब जाँचा गया।'),
};
export const table: Table = JSON.parse(readFileSync(new URL('./due-dates.v1.json', import.meta.url), 'utf8'));
/** What a table row says is due, in the language asked for; null for an id the table does not have. */
export function dueWhat(rowId: string, lang: Language): string | null {
  const row = table.rows.find(item => item.id === rowId); return row ? lang === 'hi' ? row.whatHi : row.what : null;
}
const kindName = (kind: string, lang: Language) => kindWords[kind]?.[lang] ?? kind;
// The shipped table is checked once at load: a malformed row would make every date suspect.
for (const row of table.rows) {
  const rule = row.rule;
  const ok = rule.type === 'monthly' ? (rule.day === 'last' || (Number.isInteger(rule.day) && rule.day >= 1 && rule.day <= 28)) && (rule.months ?? []).every(m => m >= 1 && m <= 12)
    && Object.entries(rule.overrides ?? {}).every(([m, d]) => Number(m) >= 1 && Number(m) <= 12 && d >= 1 && d <= 30)
    : rule.type === 'annual' && rule.dates.every(date => validDate(`2025-${date}`));
  const source = row.source;
  const sourceOk = typeof source.title === 'string' && source.title.length > 0 && /^https:\/\//.test(source.url) && typeof source.confirmed === 'boolean' && (source.date === null || validDate(source.date));
  const named = typeof row.whatHi === 'string' && row.whatHi.length > 0 && row.appliesTo.kinds.every(kind => kindWords[kind]) && row.appliesTo.states.every(code => code === 'all' || stateWords[code]);
  if (!ok || !validDate(row.lastChecked) || !sourceOk || !named) throw new Error(`Invalid due-date table row: ${row.id}`);
}
if (!table.kinds.every(kind => kindWords[kind]) || !table.states.every(code => stateWords[code])) throw new Error('Invalid due-date table: a kind or state has no words.');

export function validProfile(value: unknown): DueProfile {
  const input = closed(value, ['kind', 'gstMode', 'state'], 'INVALID_DUE_PROFILE');
  check(typeof input.kind === 'string' && /^[a-z][a-z0-9-]{1,40}$/.test(input.kind), 'INVALID_DUE_PROFILE', 'Name the kind of business in lower-case words.');
  check(table.gstModes.includes(input.gstMode), 'INVALID_DUE_PROFILE', 'Choose regular, composition or no GST registration.');
  check(typeof input.state === 'string' && table.states.includes(input.state), 'INVALID_DUE_PROFILE', 'Choose a state or union territory by its two-letter code.');
  return { kind: input.kind, gstMode: input.gstMode, state: input.state };
}

/** Every date a rule gives between `from` and `to`, inclusive. */
function datesOf(rule: Rule, from: string, to: string): string[] {
  const out: string[] = [];
  for (let year = Number(from.slice(0, 4)); year <= Number(to.slice(0, 4)); year++) {
    if (rule.type === 'annual') out.push(...rule.dates.map(date => `${year}-${date}`));
    else for (let month = 1; month <= 12; month++) {
      if (rule.months && !rule.months.includes(month)) continue;
      const override = rule.overrides?.[String(month)];
      out.push(override !== undefined ? dateOf(year, month, override) : rule.day === 'last' ? monthEnd(year, month) : dateOf(year, month, rule.day));
    }
  }
  return out.filter(date => date >= from && date <= to).sort();
}

export function dueDates(input: { from: string; days: number; profile: DueProfile | null; language?: Language }) {
  const { from, days, profile } = input; const to = addDays(from, days), lang = input.language ?? 'en';
  const covered = !profile || table.kinds.includes(profile.kind);
  const applies = (row: TableRow) => !profile || (row.appliesTo.kinds.includes(profile.kind) && row.appliesTo.gstModes.includes(profile.gstMode)
    && (row.appliesTo.states.includes('all') || row.appliesTo.states.includes(profile.state)));
  const rows: DueRow[] = covered ? table.rows.filter(applies).flatMap(row => datesOf(row.rule, from, to).map(dueOn => ({
    id: `${row.id}:${dueOn}`, what: lang === 'hi' ? row.whatHi : row.what, dueOn, source: { ...row.source }, lastChecked: row.lastChecked,
    checkOld: daysBetween(row.lastChecked, from) > 30, appliesTo: structuredClone(row.appliesTo),
    appliesToWords: { kinds: row.appliesTo.kinds.map(kind => kindName(kind, lang)), gstModes: row.appliesTo.gstModes.map(mode => gstWords[mode as DueProfile['gstMode']]?.[lang] ?? mode),
      states: row.appliesTo.states.map(code => stateWords[code]?.[lang] ?? code) } }))) : [];
  rows.sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.id.localeCompare(b.id));
  return { language: lang, caNote: notes.ca[lang], tableNote: notes.table[lang], table: { version: table.version, publishedAt: table.publishedAt, reviewed: table.reviewed }, profile,
    profileWords: profile ? { kind: kindName(profile.kind, lang), gstMode: gstWords[profile.gstMode][lang], state: stateWords[profile.state]![lang] } : null,
    covered, coveredKinds: [...table.kinds], kinds: table.kinds.map(id => ({ id, name: kindName(id, lang) })), states: table.states.map(code => ({ code, name: stateWords[code]![lang] })), rows };
}

export function dueRequest(payload: unknown, today: string): { from: string; days: number; profile?: DueProfile; language?: unknown } {
  const input = closed(payload, ['from', 'days', 'profile', 'language'], 'INVALID_DUE_REQUEST');
  check(input.from === undefined || validDate(input.from), 'INVALID_DUE_REQUEST', 'Give a valid start date.');
  check(input.days === undefined || (Number.isInteger(input.days) && input.days >= 1 && input.days <= 400), 'INVALID_DUE_REQUEST', 'Choose between 1 and 400 days.');
  return { from: input.from ?? today, days: input.days ?? 60, ...(input.profile === undefined || input.profile === null ? {} : { profile: validProfile(input.profile) }), language: input.language };
}
