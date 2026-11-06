// Chausar delivery (Ink v2 wave 4, 4J14, catalogue Q7): one vocabulary of verdict words. Every check outcome goes
// through one table (Passed, Failed, Not run, Not checked); a model's judgment is a word (strong, fair, weak, no) with a
// keep line and a printed reason for what it dropped; a draft is PASS, REWRITE or DO NOT SEND; a fix is Fixed,
// Partially fixed, Not fixed or Unverified; a run that acts outside is Success, Not checked or Failed (outcomes.ts); a
// report older than its draft is stale. Anything else is "Unknown", never a pass. The screens word the codes for
// themselves (English and Hindi); the lists are exported for their drift test.
//
// Ideas taken, code written here: Pinloop's shared verdict enums and decionis's verdict labels with their drift test.
import type { CheckResult, PlaybookCheckResult } from '../contracts.ts';
import type { RuleOutcome, RuleVerdict } from './judge/rules.ts';
import { HOOK_FLOOR, type HookBand } from '../playbooks/youtube/checks.ts';

const frozen = <T extends readonly string[]>(list: T): T => Object.freeze([...list]) as unknown as T;

/** What happened to one check. 'not-run': it could not run; 'not-checked': it ran and settled nothing (a judge rule). */
export const CHECK_OUTCOMES = frozen(['pass', 'fail', 'not-run', 'not-checked'] as const);
export type CheckOutcome = typeof CHECK_OUTCOMES[number];
export const CHECK_WORDS: Readonly<Record<CheckOutcome, string>> = Object.freeze({ pass: 'Passed', fail: 'Failed', 'not-run': 'Not run', 'not-checked': 'Not checked' });
/** The word for any value outside a list. It is never a pass. */
export const UNKNOWN = 'Unknown';

export const JUDGMENTS = frozen(['strong', 'fair', 'weak', 'no'] as const);
export type Judgment = typeof JUDGMENTS[number];
export const JUDGMENT_WORDS: Readonly<Record<Judgment, string>> = Object.freeze({ strong: 'strong', fair: 'fair', weak: 'weak', no: 'no' });

export const DRAFT_VERDICTS = frozen(['pass', 'rewrite', 'do-not-send'] as const);
export type DraftVerdict = typeof DRAFT_VERDICTS[number];
export const DRAFT_VERDICT_WORDS: Readonly<Record<DraftVerdict, string>> = Object.freeze({ pass: 'PASS', rewrite: 'REWRITE', 'do-not-send': 'DO NOT SEND' });

export const FIX_STATUSES = frozen(['fixed', 'partially-fixed', 'not-fixed', 'unverified'] as const);
export type FixStatus = typeof FIX_STATUSES[number];
export const FIX_WORDS: Readonly<Record<FixStatus, string>> = Object.freeze({ fixed: 'Fixed', 'partially-fixed': 'Partially fixed', 'not-fixed': 'Not fixed', unverified: 'Unverified' });

/** A run that acts outside (outcomes.ts): Success only when a code check of the real result passed. */
export const RUN_OUTCOMES = frozen(['success', 'not-checked', 'failed'] as const);
export type RunOutcome = typeof RUN_OUTCOMES[number];
export const RUN_OUTCOME_WORDS: Readonly<Record<RunOutcome, string>> = Object.freeze({ success: 'Success', 'not-checked': 'Not checked', failed: 'Failed' });

/** A finding: a hard error (a code check failed), a content issue (a judged rule), or creative judgement left to the owner. */
export const FINDING_CLASSES = frozen(['hard-error', 'content', 'creative'] as const);
export type FindingClass = typeof FINDING_CLASSES[number];

/** What coverage counts (coverage.ts), and what was done to it. The screen words each for itself. */
export const COVERAGE_UNITS = frozen(['rows', 'lines', 'pages', 'items', 'bank-lines'] as const);
export const COVERAGE_VERBS = frozen(['read', 'matched', 'used'] as const);

export const REVIEW_INCOMPLETE = 'Review incomplete: this is not a review.';
export const STALE_LINE = 'Stale: the draft changed after these checks ran. They describe an earlier version.';

/**
 * Every list, for the screen's drift test: each value must have its words there. lines: the engine's fixed lines the
 * screen words for itself (Unknown, a stale report, an incomplete review).
 */
export const VERDICT_VOCABULARY = Object.freeze({
  checks: CHECK_OUTCOMES, judgments: JUDGMENTS, drafts: DRAFT_VERDICTS, fixes: FIX_STATUSES, outcomes: RUN_OUTCOMES, findings: FINDING_CLASSES,
  units: COVERAGE_UNITS, verbs: COVERAGE_VERBS,
  lines: Object.freeze({ unknown: UNKNOWN, stale: STALE_LINE, incomplete: REVIEW_INCOMPLETE }),
});

const isIn = <T extends string>(list: readonly T[], value: unknown): value is T => typeof value === 'string' && (list as readonly string[]).includes(value);

/** A check outcome in words, from the one table. Anything outside it is "Unknown". */
export function checkWord(outcome: unknown): string {
  return isIn(CHECK_OUTCOMES, outcome) ? CHECK_WORDS[outcome] : UNKNOWN;
}

/**
 * A check's detail without a leading outcome word of its own ("Failed: tone-fits." from the judge, "not run: ..." from
 * a playbook check), so the line never says it twice and the screen can put its own word in front.
 */
export function checkDetail(detail: string): string {
  return detail.replace(/^\s*(passed|failed|not run|not checked|unknown)\s*:\s*/i, '');
}

/** A check's line: the table's word, then its detail with no outcome word of its own. */
export function checkLine(outcome: unknown, detail: string): string {
  return `${checkWord(outcome)}: ${checkDetail(detail)}`;
}

/** A harness check's outcome. A rules-judge check no checked vote settled is not checked, never a failure or a pass. */
export function outcomeOfCheck(result: CheckResult): CheckOutcome {
  return result.passed === true ? 'pass' : result.notChecked ? 'not-checked' : 'fail';
}

/** A flagship playbook check's outcome, or 'unknown' for a value outside its list. */
export function outcomeOfPlaybookCheck(result: PlaybookCheckResult): CheckOutcome | 'unknown' {
  return result.outcome === 'pass' || result.outcome === 'fail' || result.outcome === 'not-run' ? result.outcome : 'unknown';
}

/** A judge rule's outcome: unverified (no checked votes settled it) is not checked. Never a pass. */
export function outcomeOfRule(outcome: RuleOutcome): CheckOutcome | 'unknown' {
  return outcome === 'pass' ? 'pass' : outcome === 'fail' ? 'fail' : outcome === 'unverified' ? 'not-checked' : 'unknown';
}

/**
 * A judged rule as a word, counted by code from its checked votes: strong when every vote was a checked yes, fair when
 * the yes votes met the rule's floor, weak when some said yes but too few, no when none did. A rule the votes did not
 * settle has no judgment (null): it reads "Not checked".
 */
export function judgmentOfRule(verdict: Pick<RuleVerdict, 'outcome' | 'yes'> & { votes: readonly unknown[] | number }): Judgment | null {
  const votes = typeof verdict.votes === 'number' ? verdict.votes : verdict.votes.length;
  if (verdict.outcome === 'pass') return verdict.yes === votes ? 'strong' : 'fair';
  if (verdict.outcome === 'fail') return verdict.yes > 0 ? 'weak' : 'no';
  return null;
}

/** A hook's band from the scorer in the same words; below the floor the hook check fails, so it is no. */
export function judgmentOfHook(score: { verdict: number; band: HookBand }): Judgment {
  if (score.verdict < HOOK_FLOOR) return 'no';
  return score.band === 'strong' ? 'strong' : score.band === 'workable' ? 'fair' : 'weak';
}

/** Whether a judgment clears the keep line (fair unless named), and why not when it does not. An unknown is never kept. */
export function keepJudgment(judgment: unknown, keepAt: Judgment = 'fair'): { keep: boolean; word: string; drop: string | null } {
  if (!isIn(JUDGMENTS, judgment)) return { keep: false, word: UNKNOWN, drop: 'Dropped: it was not judged, and an unknown is never kept.' };
  const keep = JUDGMENTS.indexOf(judgment) <= JUDGMENTS.indexOf(keepAt);
  return { keep, word: JUDGMENT_WORDS[judgment], drop: keep ? null : `Dropped: ${JUDGMENT_WORDS[judgment]} is below the keep line, ${JUDGMENT_WORDS[keepAt]}.` };
}

/**
 * The checks that guard what goes out: one of them failing means the draft must not be sent as it is (a figure no
 * receipt backs, a number written in the prose, which the money rule never lets reach a client, a claim of work not
 * done, words meant for the AI, an attempt to act outside).
 */
const HARD_CHECKS: ReadonlySet<string> = new Set(['no-outside-writes', 'prompt-leak', 'no-done-claims', 'claims-grounded', 'figures-resolve', 'receipts', 'no-numeric-prose']);
/** Whether a check (a harness check id, or a playbook check as playbook:check) guards what goes out. */
export function isHardCheck(id: string): boolean {
  return HARD_CHECKS.has(id.includes(':') ? id.slice(id.lastIndexOf(':') + 1) : id);
}

const checksWord = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/**
 * A draft's verdict from its checks: DO NOT SEND when a check that guards what goes out failed, REWRITE when another
 * failed, PASS only when every check ran and passed. While anything did not run, was not checked or is unknown (or
 * there are no checks at all) there is no verdict, failed or not: "Review incomplete: this is not a review." The
 * failures still show as findings in the report.
 */
export function draftVerdict(items: readonly { id: string; outcome: CheckOutcome | 'unknown'; hard: boolean }[]): { verdict: DraftVerdict | null; line: string } {
  const failed = items.filter(item => item.outcome === 'fail');
  const open = items.some(item => item.outcome !== 'fail' && item.outcome !== 'pass');
  if (!items.length || open) return { verdict: null, line: REVIEW_INCOMPLETE };
  const hard = failed.filter(item => item.hard).length;
  if (hard) return { verdict: 'do-not-send', line: `DO NOT SEND: ${checksWord(hard, 'check that guards what goes out', 'checks that guard what goes out')} failed.` };
  if (failed.length) return { verdict: 'rewrite', line: `REWRITE: ${checksWord(failed.length, 'check', 'checks')} failed.` };
  return { verdict: 'pass', line: 'PASS: every check ran and passed.' };
}

/**
 * A fix from the checks it targeted, run again after it: Fixed when all passed, Partially fixed when some passed,
 * Not fixed when none passed and one still fails, Unverified when nothing ran again or nothing was settled.
 */
export function fixStatus(after: readonly (CheckOutcome | 'unknown')[] | null): FixStatus {
  if (!after?.length) return 'unverified';
  const passed = after.filter(item => item === 'pass').length;
  const failed = after.filter(item => item === 'fail').length;
  if (passed === after.length) return 'fixed';
  if (passed) return 'partially-fixed';
  return failed ? 'not-fixed' : 'unverified';
}

/** A report is stale once its draft changed after it was made. */
export function reportStamp(generatedAt: string, draftAt: string | null): { stale: boolean; line: string | null } {
  const stale = draftAt !== null && Date.parse(draftAt) > Date.parse(generatedAt);
  return { stale, line: stale ? STALE_LINE : null };
}
