// Chausar playbook kit: a kit playbook's deterministic checks on a draft, and their coverage as a fraction (Ink v2 wave
// 5, package 5A1; spec 5.8 "coverage as a fraction"). Code only, no model. Each of the definition's checks runs on the
// draft; one that throws is not run, with why. Then one coverage result says how many of the checks ran and names each
// one that did not, with its reason: "4 of 5 checks ran; not run: finishing (no cut was named)". A check that did not
// run is never counted as a pass: coverage is 'not-run' then (it blocks nothing either way). A check resting on a dated
// rule read as unconfirmed says so in its detail, and a client's run on a rule a CA or lawyer has not confirmed is
// refused (5A3 kit/rules.ts, RULE_UNCONFIRMED). Written for Chausar; nothing here is learned from an outside source.
import type { PlaybookCheckResult } from '../../contracts.ts';
import type { FlagshipCheckInput } from '../draft-checks.ts';
import type { PlaybookDefinition } from './define.ts';
import { noteUnconfirmed, requireConfirmedRules } from './rules.ts';

/** The coverage result's check id. */
export const COVERAGE_CHECK = 'coverage';
const COULD_NOT_RUN = 'not run: the check could not run.';

/** Why a not-run result did not run, from its detail ("not run: no cut was named." gives "no cut was named"). */
function whyNotRun(detail: string): string {
  return detail.replace(/^not run:\s*/i, '').replace(/[.\s]+$/, '') || 'no reason given';
}

/**
 * Runs a kit definition's checks on a draft, in order, then the coverage line. A check counts as run when any result it
 * gave was a pass or a fail; one that gave only not-run results, or threw, is named with its reason.
 */
export function runKitChecks(definition: Pick<PlaybookDefinition, 'registration' | 'checks' | 'checkIds' | 'rules'>, input: FlagshipCheckInput): PlaybookCheckResult[] {
  const playbook = definition.registration.id;
  const results: PlaybookCheckResult[] = [];
  const notRun: string[] = [];
  let ran = 0;
  definition.checks.forEach((run, index) => {
    const id = definition.checkIds[index] ?? `check-${index + 1}`;
    let own: PlaybookCheckResult[];
    try {
      own = run(input).map(item => ({ playbook, check: item.check, outcome: item.outcome, detail: item.detail }));
    } catch {
      own = [{ playbook, check: id, outcome: 'not-run', detail: COULD_NOT_RUN }];
    }
    if (!own.length) own = [{ playbook, check: id, outcome: 'not-run', detail: 'not run: the check gave no result.' }];
    results.push(...own);
    if (own.some(item => item.outcome !== 'not-run')) ran += 1;
    else notRun.push(`${id} (${whyNotRun(own[0].detail)})`);
  });
  // 5A3: a real client's work never rests on a rule still waiting for a CA or lawyer's confirmation.
  requireConfirmedRules(definition.rules, results.filter(item => item.outcome !== 'not-run').map(item => item.check), input.mode === 'client' ? 'client' : 'rehearsal');
  const total = definition.checks.length;
  const detail = notRun.length ? `${ran} of ${total} checks ran; not run: ${notRun.join(', ')}` : `${ran} of ${total} checks ran.`;
  return [...noteUnconfirmed(results, definition.rules), { playbook, check: COVERAGE_CHECK, outcome: notRun.length ? 'not-run' : 'pass', detail }];
}
