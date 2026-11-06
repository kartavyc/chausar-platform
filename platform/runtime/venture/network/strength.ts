// Chausar venture launcher, network (Ink v2 wave 4, package 4D2): how well the owner knows each person, worked out in
// code from the owner's own files and records, never by a model. Each kind of signal has a fixed weight in basis points
// (Chausar's own, to be tuned later from the owner's outcomes); each fades by half every 180 days from its last date, in
// whole numbers through a fixed 180-entry table, except what the owner said, which stands until they change it; the
// faded weights add up to the score, and the score falls in one of five bands. The owner's word is strong evidence:
// "I know them well" alone reaches Know well. Mail, meetings and LinkedIn messages are read through combinedSignals,
// so a re-imported month is never counted twice; a month whose exact last day is unknown fades from the first of that
// month. Every tie keeps its signals with their sources, keeps one evidence row per signal (applied, so none waits on
// Today as a question), and is served by venture.receipt.get as a receipt showing each step. A tie keeps its id while
// what it rests on and its band stay the same, and gets a new id when they change, so a count of the bands made before
// reads stale. Ties are worked out after every import and change, and again once a day from the journal sweep's tick.
import { randomUUID } from 'node:crypto';
import type { Context, State } from '../../contracts.ts';
import type {
  CountryProfile, EvidenceRecord, IsoDate, KeeperRunRecord, NetworkImportKind, NetworkImportRecord, NetworkRecompute, PersonFact, PersonRecord,
  PriceFigure, TieBand, TieReceipt, TieRecord, TieSignal, TieSignalKind, TieStep, VentureDeps, VentureRecord,
} from '../contracts.ts';
import { currentVenture, digest, findRecord, formatVentureDate, listRecords, ventureAction, type VentureTx } from '../records.ts';
import { localDayAt } from '../local-day.ts';
import { personEvidence } from '../evidence/ledger.ts';
import { redactSecrets } from '../core/secrets.ts';
import { combinedSignals, KIND_LABEL } from './people.ts';
import { count, plural } from './text.ts';

/** How a weight counts: per month with that kind of contact, per meeting, or once. wellBp: what "well" weighs instead. */
export type TieWeight = { perBp: number; capBp: number | null; per: 'month' | 'each' | 'once'; wellBp?: number };

/** The weight of each kind of signal, in basis points, with its cap. Chausar's own weights, stated as such. */
export const TIE_WEIGHTS: Readonly<Record<TieSignalKind, TieWeight>> = Object.freeze({
  'mail-both': { perBp: 400, capBp: 2400, per: 'month' },
  'mail-one': { perBp: 50, capBp: 300, per: 'month' },
  meeting: { perBp: 300, capBp: 1800, per: 'each' },
  client: { perBp: 1500, capBp: null, per: 'once' },
  contact: { perBp: 300, capBp: null, per: 'once' },
  'linkedin-messages': { perBp: 150, capBp: 900, per: 'month' },
  'linkedin-connection': { perBp: 100, capBp: null, per: 'once' },
  // The owner's own word (founder's decision, 26 Oct): "I know them well" alone reaches Know well; "we have met" is 500.
  'you-said': { perBp: 500, capBp: null, per: 'once', wellBp: 1800 },
});
export const WEIGHTS_NOTE = 'Chausar\'s own weights; tuned later from your outcomes. Your own word counts strongly: saying you know someone well weighs 1,800 on its own, and saying you have met them 500.';
export const HALF_LIFE_DAYS = 180;
export const HALF_LIFE_NOTE = 'Each signal loses half its weight every 180 days from its last date; the half-life is Chausar\'s own choice. What you said yourself does not fade until you change it.';
/** The most a score can be. */
export const SCORE_CAP_BP = 10_000;
/** The fade table's unit: a millionth. */
export const FADE_SCALE = 1_000_000;
/**
 * What is left of a weight after 0 to 179 days, in millionths: 2 to the power of minus days/180, rounded once and
 * written here, so fading needs no floating point. Each further 180 days halves what is left.
 */
export const FADE_TABLE: readonly number[] = Object.freeze([
  1_000_000, 996_157, 992_328, 988_514, 984_715, 980_930, 977_160, 973_404, 969_663, 965_936, 962_224, 958_526,
  954_842, 951_172, 947_516, 943_874, 940_247, 936_633, 933_033, 929_447, 925_875, 922_316, 918_771, 915_240,
  911_722, 908_218, 904_728, 901_250, 897_787, 894_336, 890_899, 887_475, 884_064, 880_666, 877_281, 873_909,
  870_551, 867_205, 863_872, 860_551, 857_244, 853_949, 850_667, 847_398, 844_141, 840_896, 837_665, 834_445,
  831_238, 828_043, 824_861, 821_690, 818_532, 815_386, 812_252, 809_131, 806_021, 802_923, 799_837, 796_763,
  793_701, 790_650, 787_611, 784_584, 781_569, 778_565, 775_572, 772_592, 769_622, 766_664, 763_718, 760_782,
  757_858, 754_946, 752_044, 749_154, 746_274, 743_406, 740_549, 737_703, 734_867, 732_043, 729_229, 726_427,
  723_635, 720_853, 718_083, 715_323, 712_574, 709_835, 707_107, 704_389, 701_682, 698_985, 696_298, 693_622,
  690_956, 688_301, 685_655, 683_020, 680_395, 677_780, 675_175, 672_580, 669_995, 667_420, 664_855, 662_299,
  659_754, 657_218, 654_692, 652_176, 649_669, 647_173, 644_685, 642_207, 639_739, 637_280, 634_831, 632_391,
  629_961, 627_539, 625_127, 622_725, 620_331, 617_947, 615_572, 613_206, 610_850, 608_502, 606_163, 603_833,
  601_513, 599_201, 596_898, 594_604, 592_318, 590_042, 587_774, 585_515, 583_265, 581_023, 578_790, 576_565,
  574_349, 572_142, 569_943, 567_752, 565_570, 563_396, 561_231, 559_074, 556_925, 554_785, 552_652, 550_528,
  548_412, 546_305, 544_205, 542_113, 540_030, 537_954, 535_887, 533_827, 531_775, 529_732, 527_696, 525_667,
  523_647, 521_634, 519_630, 517_632, 515_643, 513_661, 511_687, 509_720, 507_761, 505_810, 503_866, 501_929,
]);

/**
 * Where each band starts, in basis points; below Met once is Cold. Set so that the plan's outcomes hold with the weights
 * above: steady mail both ways and recent small meetings is Close, a client invoiced last month is Know, one meeting is
 * Met once, a LinkedIn connection alone is Cold.
 */
export const BAND_FROM: Readonly<Record<Exclude<TieBand, 'cold'>, number>> = Object.freeze({ close: 2700, 'know-well': 1800, know: 1000, 'met-once': 150 });
export const BAND_WORDS: Readonly<Record<TieBand, string>> = Object.freeze({ close: 'Close', 'know-well': 'Know well', know: 'Know', 'met-once': 'Met once', cold: 'Cold' });
const BAND_RULE = `Close from ${count(BAND_FROM.close)}, Know well from ${count(BAND_FROM['know-well'])}, Know from ${count(BAND_FROM.know)}, Met once from ${count(BAND_FROM['met-once'])}, else Cold`;
const KIND_ORDER: readonly TieSignalKind[] = ['client', 'you-said', 'mail-both', 'meeting', 'linkedin-messages', 'contact', 'mail-one', 'linkedin-connection'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const OWNER_SOURCE = 'You, in Chausar';
const INVOICES_SOURCE = 'Your invoices in Chausar';

/** The band a score falls in. */
export function bandOf(scoreBp: number): TieBand {
  if (scoreBp >= BAND_FROM.close) return 'close';
  if (scoreBp >= BAND_FROM['know-well']) return 'know-well';
  if (scoreBp >= BAND_FROM.know) return 'know';
  if (scoreBp >= BAND_FROM['met-once']) return 'met-once';
  return 'cold';
}

/**
 * A weight faded over some days: whole half-lives halve it, the days left over take the table's factor, rounded down.
 * A date after today never makes a weight grow (days below zero count as none). Integer arithmetic only.
 */
export function faded(weightBp: number, days: number): { bp: number; days: number; halvings: number; factor: number } {
  const span = Math.max(0, days);
  const rest = span % HALF_LIFE_DAYS;
  const halvings = (span - rest) / HALF_LIFE_DAYS;
  const factor = FADE_TABLE[rest];
  const bp = Number((BigInt(weightBp) * BigInt(factor) / BigInt(FADE_SCALE)) >> BigInt(halvings));
  return { bp, days: span, halvings, factor };
}

/** Whole days from one calendar day to another (each at midnight UTC, so the difference is exact). */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  const at = (day: IsoDate) => { const [y, m, d] = day.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return (at(to) - at(from)) / 86_400_000;
}

/** What the weight of a signal is before fading: per month or meeting up to the cap, or once ("well" weighs its own). */
function weightOf(kind: TieSignalKind, times: number, well = false): { raw: number; weight: number } {
  const rule = TIE_WEIGHTS[kind];
  const raw = rule.per === 'once' ? (well && rule.wellBp !== undefined ? rule.wellBp : rule.perBp) : rule.perBp * times;
  return { raw, weight: rule.capBp !== null && raw > rule.capBp ? rule.capBp : raw };
}

/** What the owner said stands until they change it; every other signal fades. */
const fades = (kind: TieSignalKind) => kind !== 'you-said';

/** What a client's invoices say: how many were issued (not drafts, not void), and the last day of an invoice or a payment. */
export type Paying = { invoices: number; last: IsoDate };
/** What working out a tie reads besides the person: today, the imports (for file names) and the paying clients. */
export type TieInput = { today: IsoDate; country: CountryProfile; imports: ReadonlyMap<string, NetworkImportRecord>; paying: ReadonlyMap<string, Paying> };

const ISSUED = new Set(['issued', 'part-paid', 'paid']);

/** A calendar day Chausar can read ('2026-10-23', a real date). A signal on any other leaves that signal out. */
function readableDay(value: unknown): value is IsoDate {
  const match = typeof value === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
  if (!match) return false;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const at = new Date(Date.UTC(y, m - 1, d));
  return at.getUTCFullYear() === y && at.getUTCMonth() === m - 1 && at.getUTCDate() === d;
}

/** The paying clients of a business by client id. An invoice or a payment whose day cannot be read is left out. */
function payingClients(state: State, ventureId: string): Map<string, Paying> {
  const paying = new Map<string, Paying>();
  const clientOf = new Map<string, string>();
  for (const invoice of listRecords(state, 'venture-invoice', ventureId)) {
    if (!ISSUED.has(invoice.status) || !readableDay(invoice.issueDate)) continue;
    clientOf.set(invoice.id, invoice.clientId);
    const entry = paying.get(invoice.clientId) ?? { invoices: 0, last: invoice.issueDate };
    entry.invoices += 1;
    if (invoice.issueDate > entry.last) entry.last = invoice.issueDate;
    paying.set(invoice.clientId, entry);
  }
  for (const payment of listRecords(state, 'venture-payment', ventureId)) {
    const clientId = clientOf.get(payment.invoiceId);
    const entry = clientId ? paying.get(clientId) : undefined;
    if (entry && readableDay(payment.receivedOn) && payment.receivedOn > entry.last) entry.last = payment.receivedOn;
  }
  return paying;
}

/** Everything working out ties reads, read once. */
export function tieInput(state: State, venture: VentureRecord, today: IsoDate): TieInput {
  return {
    today, country: venture.country,
    imports: new Map(listRecords(state, 'venture-network-import', venture.id).map(record => [record.id, record])),
    paying: payingClients(state, venture.id),
  };
}

/** 'Mail headers, a.mbox and b.mbox; Calendar, work.ics': each kind of file the facts came from, with its file names. */
function filesOf(facts: PersonFact[], imports: ReadonlyMap<string, NetworkImportRecord>): string {
  const byKind = new Map<string, string[]>();
  for (const fact of facts) {
    const record = fact.source.importId ? imports.get(fact.source.importId) : undefined;
    const label = KIND_LABEL[(record?.importKind ?? fact.source.connector) as NetworkImportKind] ?? OWNER_SOURCE;
    const names = byKind.get(label) ?? [];
    const name = redactSecrets(record?.fileName ?? 'a file you imported');
    if (!names.includes(name)) names.push(name);
    byKind.set(label, names);
  }
  return [...byKind].map(([label, names]) => {
    const shown = names.length > 3 ? [...names.slice(0, 3), `${plural(names.length - 3, 'more file', 'more files')}`] : names;
    return `${label}, ${shown.length > 1 ? `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}` : shown[0]}`;
  }).join('; ');
}

const firstName = (name: string) => (name.includes('@') || name.startsWith('+') || name.startsWith('http') ? name : name.trim().split(/\s+/)[0] || name);

/**
 * The last day of the latest month that passes: exact when that month is the one the last day falls in, the last day
 * is not after today, and the month is clean; otherwise the first of that month.
 */
function lastOf<R>(months: [string, R][], last: IsoDate, clean: (row: R) => boolean, today: IsoDate): { day: IsoDate; exact: boolean } {
  const [month, row] = months[months.length - 1];
  return month === last.slice(0, 7) && readableDay(last) && last <= today && clean(row) ? { day: last, exact: true } : { day: `${month}-01`, exact: false };
}

/** Months up to today's: a month still to come (a file read on a computer whose clock ran ahead) counts for nothing. */
const pastMonths = <R>(months: Record<string, R>, today: IsoDate): [string, R][] => Object.entries(months).filter(([month]) => month <= today.slice(0, 7));

/** ', the last on 20 Oct 2026' or ', the last in Oct 2026'. */
function lastWords(last: { day: IsoDate; exact: boolean }, input: TieInput): string {
  if (last.exact) return `, the last on ${formatVentureDate(last.day, input.country.dateOrder)}`;
  const [year, month] = last.day.split('-');
  return `, the last in ${MONTH_NAMES[Number(month) - 1]} ${year}`;
}

/** The day an import was made, on the owner's calendar. */
const importDay = (fact: PersonFact, input: TieInput): IsoDate | null => {
  const record = fact.source.importId ? input.imports.get(fact.source.importId) : undefined;
  return record ? localDayAt(record.at, input.country) : null;
};

/**
 * The signals of one person's tie, strongest first: mail both ways and one way by month, small meetings, LinkedIn
 * messages by month, a LinkedIn connection, a saved contact, being a paying client, and what the owner said. Each with
 * its count, last day, weight after the cap, faded weight, source and line. Months after today's count for nothing;
 * a signal whose day cannot be read is left out, and nothing here throws on a person's facts.
 */
export function tieSignals(person: PersonRecord, input: TieInput): TieSignal[] {
  const signals: TieSignal[] = [];
  const day = (value: IsoDate) => formatVentureDate(value, input.country.dateOrder);
  const add = (kind: TieSignalKind, times: number, last: { day: IsoDate; exact: boolean }, source: string, line: () => string, well = false) => {
    if (!readableDay(last.day) || !(times > 0)) return;
    const { weight } = weightOf(kind, times, well);
    const decayedBp = fades(kind) ? faded(weight, daysBetween(last.day, input.today)).bp : weight;
    signals.push({ kind, count: times, last: last.day, weightBp: weight, decayedBp, source, line: line() });
  };
  const of = (kind: PersonFact['kind']) => person.facts.filter(fact => fact.kind === kind);
  let combined: ReturnType<typeof combinedSignals> | null = null;
  try { combined = combinedSignals(person); } catch { combined = null; }
  if (combined?.mail && readableDay(combined.mail.last)) {
    const months = pastMonths(combined.mail.months, input.today);
    const source = filesOf(of('mail'), input.imports);
    const both = months.filter(([, row]) => row[0] > 0 && row[1] > 0);
    const one = months.filter(([, row]) => (row[0] > 0) !== (row[1] > 0));
    if (both.length) {
      const last = lastOf(both, combined.mail.last, row => row[2] === 0, input.today);
      add('mail-both', both.length, last, source, () => `Mail both ways in ${plural(both.length, 'month', 'months')}${lastWords(last, input)}`);
    }
    if (one.length) {
      const last = lastOf(one, combined.mail.last, row => row[2] === 0, input.today);
      add('mail-one', one.length, last, source, () => `Mail one way in ${plural(one.length, 'month', 'months')}${lastWords(last, input)}`);
    }
  }
  if (combined?.meetings && readableDay(combined.meetings.last)) {
    const small = pastMonths(combined.meetings.months, input.today).filter(([, row]) => row[1] > 0);
    const times = small.reduce((sum, [, row]) => sum + row[1], 0);
    if (times) {
      const last = lastOf(small, combined.meetings.last, row => row[0] === row[1], input.today);
      add('meeting', times, last, filesOf(of('meeting'), input.imports), () => `${plural(times, 'small meeting', 'small meetings')}${lastWords(last, input)}`);
    }
  }
  if (combined?.messages && readableDay(combined.messages.last)) {
    const months = pastMonths(combined.messages.months, input.today).filter(([, row]) => row[0] + row[1] > 0);
    if (months.length) {
      const last = lastOf(months, combined.messages.last, row => row[2] === 0, input.today);
      add('linkedin-messages', months.length, last, filesOf(of('message'), input.imports), () => `LinkedIn messages in ${plural(months.length, 'month', 'months')}${lastWords(last, input)}`);
    }
  }
  const connections = of('connection').map(fact => ({ fact, day: fact.date ?? importDay(fact, input) })).filter((item): item is { fact: PersonFact; day: IsoDate } => readableDay(item.day));
  if (connections.length) {
    const newest = connections.reduce((a, b) => (b.day > a.day ? b : a));
    const record = newest.fact.source.importId ? input.imports.get(newest.fact.source.importId) : undefined;
    const source = `${KIND_LABEL['linkedin-connections']}, ${redactSecrets(record?.fileName ?? 'a file you imported')}, line ${count(newest.fact.source.row ?? 0)}`;
    add('linkedin-connection', 1, { day: newest.day, exact: true }, source, () => `LinkedIn connection since ${day(newest.day)}`);
  }
  const contacts = of('contact');
  const seen = contacts.map(fact => importDay(fact, input)).filter((value): value is IsoDate => readableDay(value)).sort();
  if (seen.length) {
    const newest = seen[seen.length - 1];
    add('contact', 1, { day: newest, exact: true }, filesOf(contacts, input.imports), () => `Saved in your contacts, as of ${day(newest)}`);
  }
  const paying = person.clientId ? input.paying.get(person.clientId) : undefined;
  if (paying) {
    add('client', paying.invoices, { day: paying.last, exact: true }, INVOICES_SOURCE,
      () => `Your paying client, ${plural(paying.invoices, 'invoice', 'invoices')}, the last invoice or payment on ${day(paying.last)}`);
  }
  const said = of('you-said').filter(fact => readableDay(fact.date)).sort((a, b) => (a.date! < b.date! ? -1 : a.date! > b.date! ? 1 : 0));
  if (said.length) {
    const fact = said[said.length - 1];
    const well = (fact.detail as { how?: string } | null)?.how === 'well';
    const how = well ? `know ${firstName(person.name)} well` : `have met ${firstName(person.name)}`;
    add('you-said', 1, { day: fact.date!, exact: true }, OWNER_SOURCE, () => `You said you ${how}, on ${day(fact.date!)}`, well);
  }
  return signals.sort((a, b) => b.decayedBp - a.decayedBp || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
}

/** The digest a tie keeps its id by: what it rests on, and its band. */
function tieDigest(personId: string, signals: TieSignal[], band: TieBand): string {
  return digest({ personId, band, signals: signals.map(signal => [signal.kind, signal.count, signal.last, signal.weightBp, signal.source, signal.line]) });
}

/** One person's tie as of the input's day: its signals, the score (capped at 10,000), the band and the digest. */
export function workOutTie(person: PersonRecord, input: TieInput): { signals: TieSignal[]; scoreBp: number; band: TieBand; digest: string } {
  const signals = tieSignals(person, input);
  const sum = signals.reduce((total, signal) => total + signal.decayedBp, 0);
  const scoreBp = sum > SCORE_CAP_BP ? SCORE_CAP_BP : sum;
  const band = bandOf(scoreBp);
  return { signals, scoreBp, band, digest: tieDigest(person.id, signals, band) };
}

/** One signal's evidence row, through the ledger's helper: the owner's word is owner-entered, the rest worked out by Chausar. */
const evidenceRow = (tx: VentureTx, personId: string, signal: TieSignal): EvidenceRecord =>
  personEvidence(tx, { personId, field: `tie.${signal.kind}`, value: signal.line, source: signal.source, ownerSaid: signal.kind === 'you-said' });

const isTieRow = (row: EvidenceRecord) => row.by === 'engine' && row.field.startsWith('tie.') && row.subject.startsWith('person:');

/** What working out ties did: how many people, how many ties changed, and how many sit in each band. */
export type TiesWorked = { ties: number; changed: number; bands: Record<TieBand, number> };

/**
 * Works out the ties of the people named (everyone when only is absent) inside the transaction, in one pass over the
 * records: a tie whose digest is unchanged stays as it is; a changed one is replaced by a new tie with a new id; each
 * person's engine evidence rows become exactly one per signal (rows that still say the same are kept). Working out
 * everyone also removes ties and rows of people no longer here.
 */
export function writeTies(tx: VentureTx, only?: ReadonlySet<string>): TiesWorked {
  const venture = tx.venture!;
  const input = tieInput(tx.state, venture, localDayAt(tx.now, venture.country));
  const people = listRecords(tx.state, 'venture-person', venture.id);
  const alive = new Set(people.map(person => person.id));
  const remove = new Set<string>();
  const add: (TieRecord | EvidenceRecord)[] = [];
  const oldTies = new Map<string, TieRecord>();
  for (const tie of listRecords(tx.state, 'venture-tie', venture.id)) {
    const before = oldTies.get(tie.personId);
    if (before) remove.add(before.id);
    oldTies.set(tie.personId, tie);
  }
  const oldRows = new Map<string, EvidenceRecord[]>();
  for (const row of listRecords(tx.state, 'venture-evidence', venture.id)) {
    if (!isTieRow(row)) continue;
    const id = row.subject.slice('person:'.length);
    oldRows.set(id, [...(oldRows.get(id) ?? []), row]);
  }
  const worked: TiesWorked = { ties: 0, changed: 0, bands: { close: 0, 'know-well': 0, know: 0, 'met-once': 0, cold: 0 } };
  for (const person of people) {
    if (only && !only.has(person.id)) continue;
    const tie = workOutTie(person, input);
    worked.ties += 1;
    worked.bands[tie.band] += 1;
    const old = oldTies.get(person.id);
    if (!old || old.digest !== tie.digest) {
      if (old) remove.add(old.id);
      add.push({ ...tx.base('venture-tie'), personId: person.id, signals: tie.signals, scoreBp: tie.scoreBp, band: tie.band, computedAt: tx.now, digest: tie.digest });
      worked.changed += 1;
    }
    const rows = [...(oldRows.get(person.id) ?? [])];
    for (const signal of tie.signals) {
      const row = evidenceRow(tx, person.id, signal);
      const at = rows.findIndex(old => old.field === row.field && old.value === row.value && old.source === row.source && old.type === row.type);
      if (at >= 0) rows.splice(at, 1);
      else add.push(row);
    }
    for (const row of rows) remove.add(row.id);
  }
  if (!only) {
    for (const [personId, tie] of oldTies) if (!alive.has(personId)) remove.add(tie.id);
    for (const [personId, rows] of oldRows) if (!alive.has(personId)) for (const row of rows) remove.add(row.id);
  }
  if (remove.size || add.length) {
    tx.state.conversations = [...tx.state.conversations.filter(record => !(record?.ventureId === venture.id && remove.has(record.id))), ...add.map(record => structuredClone(record))];
  }
  return worked;
}

/** "1 Close, 2 Cold": the bands that have people, closest first. */
function bandCounts(bands: Record<TieBand, number>): string {
  return (Object.keys(BAND_WORDS) as TieBand[]).filter(band => bands[band] > 0).map(band => `${count(bands[band])} ${BAND_WORDS[band]}`).join(', ');
}

/**
 * Works out every tie of the open business, writes Keeper's network-strength run in place of its last one, and emits
 * keeper.ran. Runs after every import and from venture.network.recompute.
 */
export function recomputeTies(tx: VentureTx): NetworkRecompute {
  const worked = writeTies(tx);
  const line = worked.ties
    ? `Worked out how well you know ${plural(worked.ties, 'person', 'people')}: ${bandCounts(worked.bands)}. ${worked.changed === 0 ? 'Nothing changed.' : `${count(worked.changed)} changed.`}`
    : 'No one in your network yet, so there was nothing to work out.';
  const old = tx.list('venture-keeper-run').find(record => record.job === 'network-strength');
  const run: KeeperRunRecord = { ...tx.base('venture-keeper-run'), job: 'network-strength', outcome: 'ok', line };
  if (old) tx.replace<KeeperRunRecord>({ ...run, id: old.id });
  else tx.put<KeeperRunRecord>(run);
  tx.emit('keeper.ran', { jobs: ['network-strength'] });
  return { ties: worked.ties, computedAt: tx.now, line };
}

/** How old Keeper's network-strength run may get before the sweep's tick works every tie out again: ties fade by the day. */
export const REWORK_AFTER_MS = 24 * 60 * 60_000;

/** The daily re-work is due: the business has people, and its last network-strength run is a day old or missing. */
function reworkDue(state: State, venture: VentureRecord | null, nowMs: number): venture is VentureRecord {
  if (!venture || !listRecords(state, 'venture-person', venture.id).length) return false;
  const last = listRecords(state, 'venture-keeper-run', venture.id).filter(record => record.job === 'network-strength').sort((a, b) => b.at.localeCompare(a.at))[0];
  return !last || nowMs - Date.parse(last.at) >= REWORK_AFTER_MS;
}

/**
 * The daily re-work, from the journal sweep's tick (build/journal-sweep.ts), as a Keeper job like the others: once the
 * network-strength run is a day old, every tie is worked out again; only ties that changed are written, the run record
 * is renewed with what changed, and keeper.ran says so. Before then, or with no one in the network, nothing is written.
 * A failure is recorded as a failed network-strength run, so it never passes for the sweep's own failure.
 */
export async function reworkTiesDaily(deps: VentureDeps, ctx: Context): Promise<void> {
  try {
    const state = deps.store.read();
    if (!reworkDue(state, currentVenture(state), deps.clock().getTime())) return;
    await ventureAction(deps, ctx, 'prepare', 'keeper.network-strength', tx => {
      if (reworkDue(tx.state, tx.venture, Date.parse(tx.now))) recomputeTies(tx);
    });
  } catch (error) {
    const reason = error instanceof Error && error.message ? error.message.replace(/\s+/g, ' ').slice(0, 200) : 'an unknown error';
    await ventureAction(deps, ctx, 'prepare', 'keeper.failed', tx => {
      const old = tx.list('venture-keeper-run').find(record => record.job === 'network-strength');
      const run: KeeperRunRecord = { ...tx.base('venture-keeper-run'), job: 'network-strength', outcome: 'failed', line: `Chausar could not work out how well you know people today: ${reason}` };
      if (old) tx.replace<KeeperRunRecord>({ ...run, id: old.id });
      else tx.put<KeeperRunRecord>(run);
      tx.emit('keeper.ran', { jobs: ['network-strength'] });
    }).catch(() => { /* Nothing more can be written now; the next tick tries again. */ });
  }
}

/** "How you know them": one line per signal with its source, each opening the tie's receipt. Nothing before a tie exists. */
export function howLines(person: PersonRecord, tie: TieRecord | undefined): { line: string; receiptId: string | null }[] {
  if (!tie) return [];
  if (!tie.signals.length) return [{ line: `Nothing in your files shows how you know ${firstName(person.name)} yet.`, receiptId: tie.id }];
  return tie.signals.map(signal => ({ line: `${signal.line} (${signal.source})`, receiptId: tie.id }));
}

/** The steps of one signal: its weight times its count (or once), the cap, then the fade from its last day. */
function signalSteps(signal: TieSignal, day: IsoDate): { steps: TieStep[]; words: string } {
  const rule = TIE_WEIGHTS[signal.kind];
  const steps: TieStep[] = [];
  // A weight counted once is the stored one: "well" and "met" weigh differently.
  const raw = rule.per === 'once' ? signal.weightBp : rule.perBp * signal.count;
  let words: string;
  if (rule.per !== 'once') {
    const unit = rule.per === 'month' ? 'a month' : 'each';
    steps.push({ op: 'multiply', inputs: [String(signal.count), String(rule.perBp)], result: String(raw), rule: `${count(signal.count)} times ${count(rule.perBp)} ${unit}` });
    words = `${count(signal.count)} x ${count(rule.perBp)} = ${count(raw)}`;
  } else {
    words = `${count(raw)} once`;
  }
  if (rule.capBp !== null && raw > rule.capBp) {
    steps.push({ op: 'cap', inputs: [String(raw), String(rule.capBp)], result: String(rule.capBp), rule: `capped at ${count(rule.capBp)}` });
    words += `, capped at ${count(rule.capBp)}`;
  }
  if (!fades(signal.kind)) return { steps, words: `${words}; your own word does not fade` };
  const fade = faded(signal.weightBp, signal.last ? daysBetween(signal.last, day) : 0);
  steps.push({
    op: 'fade', inputs: [String(signal.weightBp), String(fade.days), String(fade.factor), String(fade.halvings)], result: String(fade.bp),
    rule: `faded over ${plural(fade.days, 'day', 'days')}: times ${count(fade.factor)} millionths for the days past whole half-lives, then halved ${plural(fade.halvings, 'time', 'times')}`,
  });
  words += `; faded over ${plural(fade.days, 'day', 'days')} to ${count(fade.bp)}`;
  return { steps, words };
}

/** What venture.receipt.get says for a tie id no longer kept: a changed tie gets a new id, and the old one goes. */
export const TIE_SUPERSEDED = 'How well you know this person was worked out again since. Open the person to see how it stands now.';

/**
 * venture.receipt.get for a tie (4D2): each signal's line and source, every step from the weights to the band in whole
 * numbers, from the stored tie as it was worked out. stale: the person's files and records give a different tie today.
 */
export function tieReceipt(state: State, venture: VentureRecord, tie: TieRecord, today: IsoDate): TieReceipt {
  const person = findRecord(state, 'venture-person', tie.personId);
  const stale = !person || person.ventureId !== venture.id || workOutTie(person, tieInput(state, venture, today)).digest !== tie.digest;
  const day = localDayAt(tie.computedAt, venture.country);
  const steps: TieStep[] = [];
  const sentences: string[] = [];
  for (const signal of tie.signals) {
    const worked = signalSteps(signal, day);
    steps.push(...worked.steps);
    sentences.push(`${signal.line} (${signal.source}): ${worked.words}.`);
  }
  const sum = tie.signals.reduce((total, signal) => total + signal.decayedBp, 0);
  if (tie.signals.length) steps.push({ op: 'add', inputs: tie.signals.map(signal => String(signal.decayedBp)), result: String(sum), rule: 'the faded weights added' });
  if (sum > SCORE_CAP_BP) steps.push({ op: 'cap', inputs: [String(sum), String(SCORE_CAP_BP)], result: String(SCORE_CAP_BP), rule: `a score is at most ${count(SCORE_CAP_BP)}` });
  steps.push({ op: 'band', inputs: [String(tie.scoreBp)], result: tie.band, rule: BAND_RULE });
  const name = person?.name ?? 'this person';
  const display = `${count(tie.scoreBp)} of ${count(SCORE_CAP_BP)}: ${BAND_WORDS[tie.band]}`;
  const figure: PriceFigure = { key: 'total', label: `How well you know ${name}`, minor: String(tie.scoreBp), display, currency: 'bp' };
  const found = tie.signals.length ? sentences.join(' ') : 'Nothing in your files or records shows how you know them yet.';
  return {
    id: tie.id, kind: 'venture-tie', ventureId: tie.ventureId, at: tie.computedAt, personId: tie.personId, operation: 'venture.tie', unit: 'bp',
    lines: tie.signals.map(signal => `${signal.line} (${signal.source})`), steps, figures: [figure], totalBp: String(tie.scoreBp), band: tie.band,
    allowedNumbers: [...new Set([count(tie.scoreBp), ...tie.signals.map(signal => count(signal.decayedBp))])],
    explanation: `How well you know ${name}, worked out by Chausar's code on ${formatVentureDate(day, venture.country.dateOrder)} from your own files and records, never by AI. ${found} Added together: ${count(tie.scoreBp)} of ${count(SCORE_CAP_BP)}, which is ${BAND_WORDS[tie.band]} (${BAND_RULE}). ${WEIGHTS_NOTE} ${HALF_LIFE_NOTE}`,
    digest: tie.digest, stale,
  };
}

/** A fresh id for a fact the owner adds (what they said, a link they made). */
export const ownerFactId = () => `owner.${randomUUID()}`;
