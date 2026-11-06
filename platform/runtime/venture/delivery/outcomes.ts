// Chausar delivery (Ink v2 wave 4, 4J14, catalogue Q8): outcome words and a draft's report. A run that acts outside is
// Success only when a code check of the real result passed (a dated verification, or the platform's own answer read by
// code) on every target, Not checked without one (the owner said they sent it, nobody knows whether it went, or only
// some targets went in full), Failed when the platform refused it, some targets did not go, or the run gave up before
// it applied anything. A draft's report has three columns: what code measured, what a model looked at, and what needs
// a human; every failure is a finding in one of three classes: a hard error (a code check failed), a content issue
// (the judge's rules), or creative judgement left to the owner. Words come from the one table (verdicts.ts); each line
// carries a code or an id and a detail without its own outcome word, so the screen can word it in Hindi.
//
// Ideas taken, code written here: Qwen-CUA's runner, which calls a run a success only after a check of the final
// state; BaoCut's three quality classes and its three-column delivery report (an idea only).
import type {
  CheckResult, ConnectorPostState, CoverageView, DeliverableReport, JournalAfter, JudgeRuleResult, PlaybookCheckResult, ReportItem,
} from '../contracts.ts';
import { CA_FIRM_ID } from '../playbooks/ca-firm/registration.ts';
import { SOCIAL_AGENCY_ID } from '../playbooks/social/registration.ts';
import { YOUTUBE_ID } from '../playbooks/youtube/registration.ts';
import { resultOf } from './coverage.ts';
import {
  REVIEW_INCOMPLETE, checkDetail, checkLine, draftVerdict, isHardCheck, judgmentOfRule, keepJudgment, outcomeOfCheck, outcomeOfPlaybookCheck,
  outcomeOfRule, reportStamp, type CheckOutcome, type RunOutcome,
} from './verdicts.ts';

/** applied: the act (or some of its targets) went out, so a run that failed afterwards did not give up on it. */
export type OutcomeView = { outcome: RunOutcome; line: string; applied: boolean };
/** One outside act as the journal or a connector post left it: its state, who reported the result, its ends and targets. */
export type OutsideAct = { state: ConnectorPostState; outcome: { line: string; url: string | null; by: 'platform' | 'owner' | 'engine' } | null } & JournalAfter;

const NOT_CHECKED = 'Not checked: no code check of the real result.';

/**
 * One outside act's outcome, or null while nothing has gone out (proposed, approved, or declined by the owner or by
 * time). With several targets, Success needs every one applied: a target refused or throttled makes it Failed, one
 * that went in part or may have gone makes it Not checked, each with "k of n". With every target applied (or one
 * target), a dated verification or the platform's own answer is Success, anyone else's word Not checked. Unknown is Not
 * checked; refused by the platform is Failed.
 */
export function actOutcome(act: OutsideAct): OutcomeView | null {
  const targets = act.targets ?? [];
  const went = targets.filter(target => target.outcome === 'applied').length;
  const anyWent = targets.some(target => target.outcome === 'applied' || target.outcome === 'partial');
  if (targets.length && went < targets.length && (act.state === 'applied' || act.state === 'outcome_unknown')) {
    const refused = targets.some(target => target.outcome === 'rejected' || target.outcome === 'throttled');
    const unsure = targets.some(target => target.outcome === 'partial' || target.outcome === 'unknown');
    if (refused && !unsure) return { outcome: 'failed', line: `Failed: ${went} of ${targets.length} targets went; the rest did not.`, applied: anyWent };
    return { outcome: 'not-checked', line: `Not checked: ${went} of ${targets.length} targets went in full; the rest went in part or may have gone.`, applied: anyWent };
  }
  switch (act.state) {
    case 'applied': {
      if (act.ends?.at(-1)?.state === 'verified') return { outcome: 'success', line: 'Success: a dated check verified it.', applied: true };
      return act.outcome?.by === 'platform' ? { outcome: 'success', line: 'Success: the platform confirmed it.', applied: true } : { outcome: 'not-checked', line: NOT_CHECKED, applied: true };
    }
    case 'outcome_unknown': return { outcome: 'not-checked', line: 'Not checked: it may or may not have happened. Check before trying again.', applied: false };
    case 'rejected': return act.outcome?.by === 'platform' ? { outcome: 'failed', line: 'Failed: the platform refused it.', applied: false } : null;
    default: return null;
  }
}

/**
 * A run's outcome word. failed: the run failed, and whether the agent gave up or the run itself failed (the provider);
 * proposed: it proposed an outside action; acts: the outcomes of the outside acts made from it. A failed run that
 * applied nothing, with an outside action in hand, is Failed in those words; what was applied stands on its own: Failed
 * when an act failed, Not checked when one has no code check, Success only when every act was confirmed. No act and
 * nothing proposed: no word (the run's own state says what happened).
 */
export function runOutcome(input: { failed: 'agent' | 'provider' | null; proposed: boolean; acts: readonly OutcomeView[] }): Omit<OutcomeView, 'applied'> | null {
  const { acts } = input;
  if (input.failed && !acts.some(act => act.applied) && (input.proposed || acts.length)) {
    return { outcome: 'failed', line: input.failed === 'provider' ? 'Failed: the run failed before its outside action was done.' : 'Failed: the agent gave up before its outside action was done.' };
  }
  if (!acts.length) return null;
  const one = acts.length === 1;
  const failed = acts.filter(act => act.outcome === 'failed').length;
  if (failed) return { outcome: 'failed', line: one ? 'Failed: the outside action did not happen.' : `Failed: ${failed} of ${acts.length} outside actions did not happen.` };
  const open = acts.filter(act => act.outcome !== 'success').length;
  if (open) {
    return { outcome: 'not-checked', line: one ? 'Not checked: the outside action has no code check of its real result.'
      : `Not checked: ${open} of ${acts.length} outside actions ${open === 1 ? 'has' : 'have'} no code check of its real result.` };
  }
  return { outcome: 'success', line: one ? 'Success: the outside action was confirmed.' : `Success: ${acts.length} outside actions, each confirmed.` };
}

/** What no check can settle and the owner judges, by flagship playbook: creative judgement left to a person, by code. */
const NEEDS_HUMAN: Readonly<Record<string, readonly { code: string; line: string }[]>> = Object.freeze({
  [YOUTUBE_ID]: [
    { code: 'youtube-voice', line: 'Whether the hook and the title sound like the channel.' },
    { code: 'youtube-story', line: 'Whether the cut keeps the story the creator wants to tell.' },
  ],
  [CA_FIRM_ID]: [{ code: 'ca-judgement', line: "The CA's own professional judgement, and the sign-off only the CA gives." }],
  [SOCIAL_AGENCY_ID]: [{ code: 'social-voice', line: 'Whether the posts sound like the business and suit its audience.' }],
});
const NEEDS_HUMAN_ANY: readonly { code: string; line: string }[] = Object.freeze([{ code: 'reply-fits', line: 'Whether the reply reads right for this client.' }]);

const cut = (text: string, max = 160) => (text.length <= max ? text : `${text.slice(0, max - 3)}...`);
function item(id: string, outcome: ReportItem['outcome'], detail: string): ReportItem {
  const plain = checkDetail(detail);
  return { id, outcome, line: cut(checkLine(outcome, plain)), detail: cut(plain) };
}

/**
 * Where the judge stands on this draft: done (its result is in the checks; rules, each rule's result when it was kept),
 * waiting (its call waits for the owner to send it), pending (it is due and has not read the draft), failed (its call
 * did not finish; line says why), or none (no judge was asked).
 */
export type JudgeStanding = { state: 'done' | 'waiting' | 'pending' | 'failed' | 'none'; rules: readonly JudgeRuleResult[] | null; line: string | null };

export type ReportInput = {
  /** The flagship playbook the draft's own checks came from, or null. */
  playbook: string | null;
  checks: readonly CheckResult[];
  playbookChecks: readonly PlaybookCheckResult[];
  judge: JudgeStanding;
  /** What the run read of the client's files; null when it had none. */
  coverage: CoverageView | null;
  /** When the checks ran, and when the draft last changed (null when it never did). */
  generatedAt: string; draftAt: string | null;
};

const votesWord = (count: number) => `${count} checked ${count === 1 ? 'vote' : 'votes'}`;
/** One judged rule as a report line, with its word and, below the keep line, why it was dropped. */
function ruleItem(rule: JudgeRuleResult): ReportItem {
  const outcome = outcomeOfRule(rule.outcome);
  const judgment = judgmentOfRule(rule);
  const kept = keepJudgment(judgment);
  const detail = judgment ? `${judgment}, ${rule.yes} of ${votesWord(rule.votes)} said yes.` : 'the votes did not settle it.';
  return { ...item(`rules-judge:${rule.rule}`, outcome, detail), judgment, ...(kept.drop ? { drop: kept.drop } : {}) };
}

/** Why no judge result is here, in "Not run" words; open: the review is not complete without it. */
function judgeAbsent(judge: JudgeStanding): { item: ReportItem; open: boolean } {
  switch (judge.state) {
    // 4J13 (H30): a judge waiting to go on its own carries its "Waiting: ..." line; either way the review is open.
    case 'waiting': return { item: item('rules-judge', 'not-run', judge.line ?? "the judge's call waits for you to send it."), open: true };
    case 'pending': return { item: item('rules-judge', 'not-run', 'the judge is due and has not read this draft yet.'), open: true };
    case 'failed': return { item: item('rules-judge', 'not-run', `the judge's call failed. ${checkDetail(judge.line ?? 'It did not finish.')}`), open: true };
    default: return { item: item('rules-judge', 'not-run', 'no AI judge looked at this draft.'), open: false };
  }
}

/**
 * A draft's report. measured: every code check, the harness's and the playbook's (playbook:check). lookedAt: the rules
 * judge and, when kept, each of its rules with its judgment word and keep line; "Not run" when no judge looked (one
 * that waits, is due or failed leaves the review incomplete). needsHuman: what only the owner can judge. While the
 * review is incomplete (coverage short, a check not run, not checked or unknown, the judge open) there is no verdict
 * at all; failures stay findings.
 */
export function deliverableReport(input: ReportInput): DeliverableReport {
  const measured: ReportItem[] = [
    ...input.checks.filter(result => result.check !== 'rules-judge').map(result => item(result.check, outcomeOfCheck(result), result.detail)),
    ...input.playbookChecks.map(result => item(`${result.playbook}:${result.check}`, outcomeOfPlaybookCheck(result), result.detail)),
  ];
  const judge = input.checks.find(result => result.check === 'rules-judge');
  const absent = judge ? null : judgeAbsent(input.judge);
  const overall = judge ? item('rules-judge', outcomeOfCheck(judge), judge.detail) : absent!.item;
  const rules = judge ? (input.judge.rules ?? []).map(ruleItem) : [];
  const lookedAt: ReportItem[] = [overall, ...rules];
  const needsHuman = [...(input.playbook ? NEEDS_HUMAN[input.playbook] ?? NEEDS_HUMAN_ANY : NEEDS_HUMAN_ANY)].map(entry => ({ ...entry }));
  const content = rules.length ? rules.filter(entry => entry.outcome === 'fail') : judge && overall.outcome === 'fail' ? [overall] : [];
  const findings: DeliverableReport['findings'] = [
    ...measured.filter(entry => entry.outcome === 'fail').map(entry => ({ class: 'hard-error' as const, id: entry.id, line: entry.line })),
    ...content.map(entry => ({ class: 'content' as const, id: entry.id, line: entry.line })),
    ...needsHuman.map(entry => ({ class: 'creative' as const, id: entry.code, line: entry.line })),
  ];
  const judged: { id: string; outcome: CheckOutcome | 'unknown'; hard: boolean }[] = [
    ...measured, ...(judge || absent?.open ? [overall] : []),
  ].map(entry => ({ id: entry.id, outcome: entry.outcome, hard: isHardCheck(entry.id) }));
  const decided = draftVerdict(judged);
  const covered = input.coverage === null || input.coverage.complete;
  const complete = covered && decided.verdict !== null;
  const verdict = complete ? decided.verdict : null;
  const verdictLine = !complete ? REVIEW_INCOMPLETE : judge ? decided.line : `${decided.line} No AI judge looked at it.`;
  const stamp = reportStamp(input.generatedAt, input.draftAt);
  return {
    measured, lookedAt, needsHuman, findings, verdict, verdictLine,
    review: { complete, line: complete ? null : REVIEW_INCOMPLETE },
    ...(input.coverage ? { result: resultOf(input.coverage), coverage: input.coverage } : {}),
    generatedBy: judge ? ['code', 'judge'] : ['code'], at: input.generatedAt, stale: stamp.stale, staleLine: stamp.line,
  };
}
