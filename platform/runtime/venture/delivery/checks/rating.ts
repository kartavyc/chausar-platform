// Chausar delivery checks (Ink v2 wave 4, package 4J16, catalogue Q5): facts in, rating out. A model only ever gives
// typed facts about a finding (where a claim's source is, what it is about, who reads it); code reads them against the
// finding kind's fixed list (readFacts refuses anything else, a severity above all) and computes the severity and the
// priority from a fixed table, first matching row first, with rationale lines that say which facts decided it. The
// same facts always rate the same. Dismissing a finding needs cited evidence of a kind the table allows, which the
// caller resolves (a client file, a receipt, a transcript time); a refused dismissal stays in the list, still rated,
// with its reason. A separate validator's answer is confirmed, not applicable or needs follow-up, and anything it
// sends outside those three reads as needs follow-up, never as confirmed.
// Idea taken, code written here: Open Security (Apache-2.0) src/scan/severity.ts, prompts/validate.md and
// prompts/refs/counterevidence.md.
import { ChausarError } from '../../../contracts.ts';

export type Severity = 'high' | 'medium' | 'low' | 'info';
export type Priority = 'fix-before-sending' | 'owner-decides' | 'note' | 'no-action';
export type Facts = Readonly<Record<string, string>>;
export type EvidenceKind = 'client-file' | 'receipt' | 'transcript-time' | 'owner-note' | 'rule';
type Row = { when: Facts; severity: Severity; priority: Priority; because: string };
export type RatingTable = {
  /** Each fact the model gives, with the values it may take and what each means in the rationale. */
  facts: Readonly<Record<string, Readonly<Record<string, string>>>>;
  /** Checked in order; the first whose facts all match decides. The last row matches anything. */
  rows: readonly Row[];
  /** The evidence a dismissal may cite. */
  dismissWith: readonly EvidenceKind[];
};

const ANY: Facts = Object.freeze({});
/** The finding kinds and their tables. */
export const RATING_TABLES: Readonly<Record<string, RatingTable>> = Object.freeze<Record<string, RatingTable>>({
  claim: {
    facts: {
      source: { 'client-files': "the client's files show it", message: "only the client's message says it", nowhere: 'no source shows it' },
      subject: { money: 'it is about money', health: 'it is about health', result: 'it promises a result', other: 'it is about something else' },
      audience: { public: 'it goes out in public', client: 'only the client reads it' },
    },
    rows: [
      { when: { source: 'nowhere', subject: 'money' }, severity: 'high', priority: 'fix-before-sending', because: 'A money claim with no source can mislead and break the rules on claims.' },
      { when: { source: 'nowhere', subject: 'health' }, severity: 'high', priority: 'fix-before-sending', because: 'A health claim with no source can mislead and break the rules on claims.' },
      { when: { source: 'nowhere', audience: 'public' }, severity: 'high', priority: 'fix-before-sending', because: 'A claim with no source would go out in public.' },
      { when: { source: 'nowhere' }, severity: 'medium', priority: 'owner-decides', because: 'A claim with no source goes to the owner.' },
      { when: { source: 'message', audience: 'public' }, severity: 'low', priority: 'owner-decides', because: "Only the client's words back it, and it goes out in public." },
      { when: { source: 'message' }, severity: 'low', priority: 'note', because: "The client's own words back it." },
      { when: ANY, severity: 'info', priority: 'no-action', because: "The client's files back it." },
    ],
    dismissWith: ['client-file', 'receipt', 'transcript-time'],
  },
  disclosure: {
    facts: {
      paid: { yes: 'it is paid or gifted', no: 'it is not paid' },
      labelled: { yes: 'it is labelled', no: 'it is not labelled' },
      audience: { public: 'it goes out in public', client: 'only the client reads it' },
    },
    rows: [
      { when: { paid: 'yes', labelled: 'no', audience: 'public' }, severity: 'high', priority: 'fix-before-sending', because: 'Paid content in public must be labelled.' },
      { when: { paid: 'yes', labelled: 'no' }, severity: 'medium', priority: 'owner-decides', because: 'Paid content should carry its label before it goes out.' },
      { when: ANY, severity: 'info', priority: 'no-action', because: 'Nothing to label, or it is labelled.' },
    ],
    dismissWith: ['owner-note', 'rule'],
  },
  'ca-open-item': {
    facts: {
      affects: { 'tax-figure': 'it changes a tax figure', 'due-date': 'it changes a due date', document: 'it is a missing document', other: 'it changes nothing worked out' },
      known: { 'client-said': 'the client said it', 'files-show': 'the files show it', unknown: 'nobody has said it yet' },
    },
    rows: [
      { when: { affects: 'tax-figure', known: 'unknown' }, severity: 'high', priority: 'fix-before-sending', because: 'A tax figure rests on a fact nobody has given; ask before the papers go.' },
      { when: { affects: 'due-date', known: 'unknown' }, severity: 'high', priority: 'fix-before-sending', because: 'A due date rests on a fact nobody has given.' },
      { when: { known: 'unknown' }, severity: 'medium', priority: 'owner-decides', because: 'Something is still unknown; the CA decides whether it matters.' },
      { when: ANY, severity: 'low', priority: 'note', because: 'The fact is known; the CA checks it.' },
    ],
    dismissWith: ['client-file', 'receipt', 'owner-note'],
  },
});

const rejected = (message: string): never => { throw new ChausarError('MODEL_OUTPUT_REJECTED', message); };

function tableOf(kind: string): RatingTable {
  const table = Object.hasOwn(RATING_TABLES, kind) ? RATING_TABLES[kind] : undefined;
  if (!table) throw new ChausarError('INVALID_VENTURE_REQUEST', `There is no rating table for ${kind}.`);
  return table;
}

/**
 * A model's facts about a finding, read against its kind's list: exactly the table's facts, each one of its values.
 * A severity, a priority or any other field is refused (MODEL_OUTPUT_REJECTED): the rating is code's.
 */
export function readFacts(kind: string, raw: unknown): Facts {
  const table = tableOf(kind);
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) rejected('The facts were not an object of typed fields.');
  const record = raw as Record<string, unknown>;
  for (const key of Object.keys(record)) if (!Object.hasOwn(table.facts, key)) rejected(`"${key.slice(0, 30)}" is not a fact this finding takes; the rating is worked out by code.`);
  const out: Record<string, string> = {};
  for (const [name, values] of Object.entries(table.facts)) {
    const value = record[name];
    if (typeof value !== 'string' || !Object.hasOwn(values, value)) rejected(`The fact ${name} must be one of: ${Object.keys(values).join(', ')}.`);
    out[name] = value as string;
  }
  return Object.freeze(out);
}

export type Rating = { severity: Severity; priority: Priority; rationale: string[] };
const CODE_LINE = 'Rated by code from the table, not by the AI.';

/** The rating of a finding from its typed facts: the first table row they match, with a rationale line per fact. */
export function rateFinding(kind: string, facts: Facts): Rating {
  const table = tableOf(kind);
  const read = readFacts(kind, facts);
  const row = table.rows.find(item => Object.entries(item.when).every(([name, value]) => read[name] === value)) ?? table.rows.at(-1)!;
  const decided = Object.keys(row.when);
  const rationale = [
    ...Object.entries(read).filter(([name]) => decided.includes(name)).map(([name, value]) => `${table.facts[name][value].charAt(0).toUpperCase()}${table.facts[name][value].slice(1)}.`),
    row.because,
    CODE_LINE,
  ];
  return { severity: row.severity, priority: row.priority, rationale };
}

export type CitedEvidence = { kind: string; ref: string };
export type RatedFinding = Rating & {
  id: string; kind: string; line: string;
  status: 'open' | 'dismissed' | 'dismissal-refused';
  dismissal: { evidence: CitedEvidence[]; reason: string } | null;
};
const KIND_WORDS: Readonly<Record<EvidenceKind, string>> = {
  'client-file': 'a client file', receipt: 'a receipt', 'transcript-time': 'a transcript time', 'owner-note': "the owner's note", rule: 'a dated rule',
};
const either = (items: readonly string[]) => (items.length > 1 ? `${items.slice(0, -1).join(', ')} or ${items.at(-1)}` : items[0] ?? '');

/**
 * A dismissal of a finding, decided by code: it needs at least one piece of cited evidence, every piece of a kind the
 * table allows, each found by resolve (the caller looks it up in the vault). Refused, the finding stays in the list,
 * rated as before, with status 'dismissal-refused' and the reason; it is never hidden.
 */
export function dismissFinding(finding: RatedFinding, evidence: readonly CitedEvidence[], resolve: (item: CitedEvidence) => boolean): RatedFinding {
  const table = tableOf(finding.kind);
  const allowed = table.dismissWith;
  const cited = evidence.map(item => ({ kind: item.kind, ref: item.ref }));
  const refuse = (reason: string): RatedFinding => ({ ...finding, status: 'dismissal-refused', dismissal: { evidence: cited, reason } });
  const words = either(allowed.map(kind => KIND_WORDS[kind]));
  if (!cited.length) return refuse(`Dismissing this needs evidence: cite ${words}.`);
  const off = cited.find(item => !(allowed as readonly string[]).includes(item.kind));
  if (off) return refuse(`"${off.kind.slice(0, 30)}" is not evidence this finding can be dismissed with: cite ${words}.`);
  const missing = cited.find(item => { try { return !resolve(item); } catch { return true; } });
  if (missing) return refuse(`The evidence ${missing.ref.slice(0, 40)} could not be found, so the finding stays.`);
  return { ...finding, status: 'dismissed', dismissal: { evidence: cited, reason: `Dismissed with ${cited.length === 1 ? 'one piece' : `${cited.length} pieces`} of cited evidence.` } };
}

export const VALIDATOR_ANSWERS = ['confirmed', 'not-applicable', 'needs-follow-up'] as const;
export type ValidatorAnswer = typeof VALIDATOR_ANSWERS[number];

/** A validator's answer as code reads it: one of the three, else needs follow-up (it fails closed, never confirmed). */
export function validatorAnswer(raw: unknown): ValidatorAnswer {
  return typeof raw === 'string' && (VALIDATOR_ANSWERS as readonly string[]).includes(raw) ? raw as ValidatorAnswer : 'needs-follow-up';
}
