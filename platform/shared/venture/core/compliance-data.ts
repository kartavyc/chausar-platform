// Chausar venture launcher, core (wave 6, 6C6 / D5, D21): the day-job question and each profession's rules.
// When the owner's profession is picked, onboarding asks whether their employment contract allows side work and says
// plainly that this is their responsibility (D5). It then shows that profession's rules and what its regulator forbids,
// which Chausar switches off for the business (for advocates: outreach and advertising, BCI Rule 36). A switch-off comes
// from this data, never from an owner setting or an attestation, so neither can turn it back on.
//
// W6 6E6: the professions, their statutes and hard stops come from the 57-profession map (core/professions.ts). A statute
// read on its official page carries checked: true with its source and date; the rest stay checked: false and the screen
// says "Not checked against the official page yet". Pure and shared with the fake engine: no clock, no store, no Node
// built-ins.
import { HARD_STOPS } from '../policy/hard-stops.ts';
import type { HardStop } from '../policy/hard-stops.ts';
import { CAUTIONS, PROFESSIONS, cautionOf, professionOf, sizeLine } from './professions.ts';
import type { Caution, CautionSource, Profession } from './professions.ts';
import { FAMILIES } from './families.ts';
import { readSizeAnswers, sizeAskOf, sizeVerdict } from './business-size.ts';
import type { SizeAnswers, SizeAsk } from './business-size.ts';

export const SIDE_WORK_QUESTION = 'Does your employment contract allow side work? This is your responsibility.';
export const SIDE_WORK_RESPONSIBILITY = 'Chausar does not read your contract. You decide, and you are responsible for it.';
/** One-shot C4 task 3: the line for an owner with no day job; the contract question does not apply to them. */
export const NO_DAY_JOB_LINE = "You don't have a day job, so no contract limits this business.";
/** C4 task 3: no-day-job first, as the screen lists it. */
export const SIDE_WORK_ANSWERS = ['no-day-job', 'allowed', 'not-allowed', 'not-sure'] as const;
export type SideWorkAnswer = typeof SIDE_WORK_ANSWERS[number];

/** What a regulator can switch off in a business. Each is refused in the engine where it happens (core/compliance.ts). */
export const REGULATOR_TOOLS = ['outreach', 'advertising'] as const;
export type RegulatorTool = typeof REGULATOR_TOOLS[number];

/**
 * One statute as the screen shows it; source is the official page read (the first, where several were) or null, and
 * checkedDay the day it was read in words ("1 Nov 2026"), so the screen formats nothing. W6 F4: size is what the
 * statute's size threshold counts, with its figure, in words (professions.ts sizeLine), or null when it applies at any size.
 */
export type ProfessionRule = { id: string; title: string; line: string; checked: boolean; source: CautionSource | null; checkedOn: string | null; checkedDay: string | null; size: string | null };
export type ProfessionCompliance = {
  id: string; label: string; family: string | null;
  rules: readonly ProfessionRule[];
  switchedOff: readonly { tool: RegulatorTool; line: string }[];
  hardStops: readonly string[];
};

const p = (item: ProfessionCompliance): ProfessionCompliance => Object.freeze({ ...item, rules: Object.freeze([...item.rules]), switchedOff: Object.freeze([...item.switchedOff]), hardStops: Object.freeze([...item.hardStops]) });

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** An ISO day as the app writes dates: "1 Nov 2026". */
const dayWords = (iso: string) => { const [year, month, day] = iso.split('-').map(Number); return `${day} ${MONTHS[month! - 1]} ${year}`; };

/** A statute of the map as a rule line. */
function ruleOf(id: string): ProfessionRule {
  const caution = CAUTIONS.find(item => item.id === id);
  if (!caution) throw new Error(`Unknown caution ${id}`);
  const source = caution.sources[0];
  return Object.freeze({
    id, title: caution.title, line: caution.line, checked: caution.checked, source: source ? { ...source } : null,
    checkedOn: caution.checkedOn, checkedDay: caution.checkedOn ? dayWords(caution.checkedOn) : null, size: sizeLine(caution),
  });
}

/** What a regulator switches off, by profession. Only advocates today: BCI Rule 36 bars soliciting and advertising. */
const SWITCHED_OFF: Readonly<Record<string, readonly { tool: RegulatorTool; line: string }[]>> = Object.freeze({
  advocate: [
    { tool: 'outreach', line: 'Outreach is off: Bar Council rules bar advocates from asking people for work.' },
    { tool: 'advertising', line: 'Promotional posts are off: Bar Council rules bar advocates from advertising.' },
  ],
});

function complianceOfProfession(item: Profession): ProfessionCompliance {
  return p({ id: item.id, label: item.label, family: item.family, rules: item.cautions.map(ruleOf), switchedOff: (SWITCHED_OFF[item.id] ?? []).map(entry => ({ ...entry })), hardStops: [...item.hardStops] });
}

/** Every profession of the beta, in the map's order. */
export const PROFESSION_COMPLIANCE: readonly ProfessionCompliance[] = Object.freeze(PROFESSIONS.map(complianceOfProfession));

const FAMILY_LABELS: Readonly<Record<string, string>> = Object.freeze(Object.fromEntries(FAMILIES.map(family => [family.id, family.label])));

/** A profession by id (or an id recorded before the map), else a family by id (with no profession-specific rules), else null. */
export function professionCompliance(id: unknown): ProfessionCompliance | null {
  if (typeof id !== 'string') return null;
  const profession = professionOf(id);
  const found = profession ? PROFESSION_COMPLIANCE.find(item => item.id === profession.id) : undefined;
  if (found) return found;
  const label = FAMILY_LABELS[id];
  return label ? p({ id, label, family: id, rules: [], switchedOff: [], hardStops: [] }) : null;
}

/** FNV-1a as 8 hex characters: the same in Node and the browser. Binds an answer to the words the owner saw. */
function fnv(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) { hash ^= text.charCodeAt(index); hash = Math.imul(hash, 0x01000193) >>> 0; }
  return hash.toString(16).padStart(8, '0');
}

export type CompliancePure = {
  profession: { id: string; label: string; family: string | null };
  question: string; responsibility: string;
  /** C4 task 3: the line shown when the owner has no day job. */
  noDayJob: string;
  rules: ProfessionRule[];
  switchedOff: { tool: RegulatorTool; line: string }[];
  hardStops: HardStop[];
  digest: string;
};

/** What the screen shows for a profession: the question, its rules, its switch-offs and its own hard stops (the full list is on Your rules). */
export function complianceOf(item: ProfessionCompliance): CompliancePure {
  const own = new Set(item.hardStops);
  const hardStops = HARD_STOPS.filter(stop => own.has(stop.id)).map(stop => ({ ...stop }));
  const body = {
    profession: { id: item.id, label: item.label, family: item.family }, question: SIDE_WORK_QUESTION, responsibility: SIDE_WORK_RESPONSIBILITY, noDayJob: NO_DAY_JOB_LINE,
    rules: item.rules.map(entry => ({ ...entry })), switchedOff: item.switchedOff.map(entry => ({ ...entry })), hardStops,
  };
  return { ...body, digest: 'compliance-' + fnv(JSON.stringify(body)) };
}

/** The statutes behind a profession's rules. */
function cautionsOf(item: ProfessionCompliance): Caution[] {
  return item.rules.map(rule => cautionOf(rule.id)).filter((caution): caution is Caution => caution !== null);
}

/** W6 (founder, 3 November 2026): the size question of a profession, with the saved answers, or null when no rule counts size. */
export function sizeAskFor(item: ProfessionCompliance, saved: SizeAnswers | null | undefined): SizeAsk | null {
  return sizeAskOf(cautionsOf(item), saved);
}

/** The owner's size answers for a profession, checked strictly (business-size.ts readSizeAnswers). */
export function readSizeFor(item: ProfessionCompliance, value: unknown): { answers: SizeAnswers } | { problem: string } {
  return readSizeAnswers(value, sizeAskFor(item, null));
}

export type ComplianceSized = Omit<CompliancePure, 'rules'> & { rules: (ProfessionRule & { verdict: string | null })[]; size: SizeAsk | null };

/**
 * What the screen shows with the size: complianceOf, each rule with its verdict line at the owner's size (null when it
 * applies at any size), and the size question with the saved answers. judge: the answers the verdicts are judged by (a
 * preview of picked ranges, or the saved ones). The digest is complianceOf's: the size is not part of the side-work words.
 */
export function complianceSized(item: ProfessionCompliance, saved: SizeAnswers | null | undefined, judge: SizeAnswers | null | undefined = saved): ComplianceSized {
  const pure = complianceOf(item);
  const cautions = cautionsOf(item);
  const verdictOf = (id: string) => { const caution = cautionOf(id); return caution ? sizeVerdict(caution, cautions, judge) : null; };
  return { ...pure, rules: pure.rules.map(rule => ({ ...rule, verdict: verdictOf(rule.id) })), size: sizeAskOf(cautions, saved) };
}
