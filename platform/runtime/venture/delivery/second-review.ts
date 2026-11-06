// Chausar venture launcher, delivery package (Ink v2 wave 4, package 4J15, catalogue Q17): the second reviewer.
// A second review is an extra check on a draft. Two reviewers' items merge by key: the higher severity is kept, with
// the words of the reviewer who gave it, and both reviewers are named. Where they disagree (on severity, or one calls
// it a finding and the other an observation) the disagreement is recorded, and the stricter reading is kept. Findings
// (something to fix) and observations (worth knowing, nothing to fix) stay apart and never mix. A lens is a rule file
// with triggers that reviews one kind of item; it stands down on an item a code check already covered, and says so.
// The merged review can only make a verdict stricter: a high or critical finding fails, a medium one leaves it
// unsettled, and nothing in a second review ever turns a fail or an unsettled verdict into a pass.
// Ideas taken, code written here: OpenQodex packages/review/src/second.ts (merge by key, higher severity, both named,
// disagreements) and packages/core/src/lenses.ts (lenses with triggers that stand down where a check covered it).
import { check } from '../../contracts.ts';

export const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
export type Severity = typeof SEVERITIES[number];
export type ReviewItem = { key: string; type: 'finding' | 'observation'; severity: Severity; title: string; detail: string };
/** One reviewer's items. lens: the lens id when this review came from a lens. */
export type Review = { reviewer: string; lens?: string; items: ReviewItem[] };
export type MergedItem = ReviewItem & { by: string[] };
export type Disagreement = { key: string; about: 'severity' | 'type'; first: string; second: string; kept: string };
export type MergedReview = {
  findings: MergedItem[];
  observations: MergedItem[];
  disagreements: Disagreement[];
  stoodDown: { lens: string; key: string; line: string }[];
};
/** A rule file and the words that call it in. Its review names it (Review.lens), so it can stand down item by item. */
export type Lens = { id: string; triggers: RegExp[] };
export type ReviewOutcome = 'pass' | 'unverified' | 'fail';

const rank = (severity: Severity) => SEVERITIES.indexOf(severity);
const OUTCOME_ORDER: readonly ReviewOutcome[] = ['pass', 'unverified', 'fail'];

function checked(review: Review): Review {
  check(review && typeof review.reviewer === 'string' && review.reviewer.trim().length >= 1 && review.reviewer.length <= 80 && Array.isArray(review.items),
    'INVALID_VENTURE_REQUEST', 'A review needs its reviewer\'s name and a list of items.');
  const keys = new Set<string>();
  for (const item of review.items) {
    check(typeof item?.key === 'string' && item.key.length >= 1 && item.key.length <= 120, 'INVALID_VENTURE_REQUEST', 'Each review item needs a short key.');
    check(item.type === 'finding' || item.type === 'observation', 'INVALID_VENTURE_REQUEST', 'A review item is a finding or an observation.');
    check((SEVERITIES as readonly string[]).includes(item.severity), 'INVALID_VENTURE_REQUEST', 'A severity is low, medium, high or critical.');
    check(typeof item.title === 'string' && typeof item.detail === 'string', 'INVALID_VENTURE_REQUEST', 'Each review item needs a title and its detail in words.');
    check(!keys.has(item.key), 'INVALID_VENTURE_REQUEST', `${review.reviewer} lists ${item.key} twice.`);
    keys.add(item.key);
  }
  return review;
}

/** The lenses a text calls in: each lens with at least one trigger that matches. */
export function lensesFor(lenses: readonly Lens[], text: string): Lens[] {
  return lenses.filter(lens => lens.triggers.some(trigger => new RegExp(trigger.source, trigger.flags.replace('g', '')).test(text)));
}

/**
 * Merges two reviews. codeCovered: item keys a code check already decided; a lens review stands down on those, while a
 * reviewer that is not a lens is merged as usual. Findings come highest severity first, then by key.
 */
export function mergeReviews(first: Review, second: Review, options: { codeCovered?: readonly string[] } = {}): MergedReview {
  checked(first);
  checked(second);
  check(first.reviewer !== second.reviewer, 'INVALID_VENTURE_REQUEST', 'A second review needs a second reviewer.');
  const covered = new Set(options.codeCovered ?? []);
  const stoodDown: MergedReview['stoodDown'] = [];
  const keep = (review: Review) => review.items.filter(item => {
    if (!review.lens || !covered.has(item.key)) return true;
    stoodDown.push({ lens: review.lens, key: item.key, line: `A code check already covered ${item.key}, so the ${review.lens} lens stood down.` });
    return false;
  });
  const a = keep(first), b = keep(second);
  const merged = new Map<string, MergedItem>();
  const disagreements: Disagreement[] = [];
  for (const item of a) merged.set(item.key, { ...item, by: [first.reviewer] });
  for (const item of b) {
    const had = merged.get(item.key);
    if (!had) { merged.set(item.key, { ...item, by: [second.reviewer] }); continue; }
    const by = [...had.by, second.reviewer];
    if (had.type !== item.type) {
      // The stricter reading: one reviewer's finding is a finding, in the words of the one who called it that, at the
      // higher of the two severities.
      const finding = had.type === 'finding' ? had : item;
      const severity = rank(item.severity) > rank(had.severity) ? item.severity : had.severity;
      disagreements.push({ key: item.key, about: 'type', first: had.type, second: item.type, kept: 'finding' });
      merged.set(item.key, { ...finding, type: 'finding', severity, by });
      continue;
    }
    if (had.severity !== item.severity) {
      const higher = rank(item.severity) > rank(had.severity) ? item : had;
      disagreements.push({ key: item.key, about: 'severity', first: had.severity, second: item.severity, kept: higher.severity });
      merged.set(item.key, { ...higher, by });
      continue;
    }
    merged.set(item.key, { ...had, by });
  }
  const order = (x: MergedItem, y: MergedItem) => rank(y.severity) - rank(x.severity) || (x.key < y.key ? -1 : x.key > y.key ? 1 : 0);
  const all = [...merged.values()];
  return {
    findings: all.filter(item => item.type === 'finding').sort(order),
    observations: all.filter(item => item.type === 'observation').sort(order),
    disagreements,
    stoodDown,
  };
}

/**
 * The verdict after a second review: the stricter of the first verdict and what the merged findings call for (a high
 * or critical finding fails; a medium one leaves it unsettled; a low one and every observation change nothing).
 */
export function stricterVerdict(primary: ReviewOutcome, merged: MergedReview): { outcome: ReviewOutcome; line: string } {
  check(OUTCOME_ORDER.includes(primary), 'INVALID_VENTURE_REQUEST', 'A verdict is pass, unverified or fail.');
  const top = merged.findings[0];
  const called: ReviewOutcome = !top ? 'pass' : rank(top.severity) >= rank('high') ? 'fail' : top.severity === 'medium' ? 'unverified' : 'pass';
  const outcome = OUTCOME_ORDER.indexOf(called) > OUTCOME_ORDER.indexOf(primary) ? called : primary;
  // Every finding that called for the stricter verdict, in order.
  const raising = merged.findings.filter(item => (called === 'fail' ? rank(item.severity) >= rank('high') : item.severity === 'medium'));
  const line = outcome !== primary
    ? `The second review found: ${raising.map(item => `${item.title} (${item.severity}, from ${item.by.join(' and ')})`).join('; ')}.`
    : 'The second review found nothing that makes this verdict stricter.';
  return { outcome, line };
}
