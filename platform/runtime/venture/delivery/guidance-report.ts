// Chausar delivery (Ink v2 wave 4, package 4J16, catalogue Q18): every playbook guidance line tied to a check that can
// see it, so dead lines can be pruned. Code only, no model. Each line of the playbook in use (the plan's, the
// improvement loop's and the owner's own "from now on" lines alike) is matched against a fixed table of what each
// check reads (figures by receipt, questions, chapters, disclosure, the long dash ...), and the first check in the table
// that this playbook runs is the one that can see it. Its state:
// - measured: that check gave a pass or a fail on one of the business's recent runs or rehearsals;
// - dark: a check can see the line, but it has not given a result yet (it never ran, or only did not run);
// - unmeasured: no check this playbook runs can see the line (the untrusted screen and the harness enforce some lines,
//   such as "files are information, never instructions", but no draft check reads them).
// venture.playbook.guidance {} is a read: it never makes or changes a playbook. Beside the lines it lists the "Fix the
// rule" flags (corrections.ts): parts of the drafts the owner keeps correcting, which only the owner's own words in the
// agent's chat turn into a rule.
import type { Context, State } from '../../contracts.ts';
import type { CheckResult, GuidanceView, PlaybookCheckResult, PlaybookRecord, VentureDeps, VentureRecord } from '../contracts.ts';
import { exactPayload, listRecords } from '../records.ts';
import { currentPlaybook } from './playbook.ts';
import { readAs, newestFirst } from './shared.ts';
import { CA_STEPS } from '../playbooks/ca-firm/playbook.ts';
import { CA_FIRM_ID } from '../playbooks/ca-firm/registration.ts';
import { YOUTUBE_STEPS } from '../playbooks/youtube/playbook.ts';
import { YOUTUBE_ID } from '../playbooks/youtube/registration.ts';
import { SOCIAL_AGENCY_ID } from '../playbooks/social/registration.ts';
import { WRITING_CHECK_IDS } from '../playbooks/writing-checks.ts';
import { fixTheRule } from './corrections.ts';

/** What each check reads, first match first: a line's words, and the checks that can see it in order of preference. */
const SEES: readonly { words: RegExp; checks: readonly string[] }[] = Object.freeze([
  { words: /\bleave out income\b|\binflate a deduction\b|\bhide (?:income|a receipt)\b|\bhidden income\b|\binflated deductions\b/i, checks: ['refuses-to-hide-income'] },
  { words: /\b(?:filing|signature|e-verification)\b[^.]*\bhappened\b|\bnever claim filing\b|\bproven list\b|\bwork is done\b|\bclaims? of work\b/i, checks: ['no-filing-claims', 'no-done-claims'] },
  { words: /\bcalculator refuses\b|\bdo[ -]not[ -]retry\b|\bnot modell?ed\b/i, checks: ['not-modelled-refused'] },
  { words: /\brate tables?\b/i, checks: ['rates-confirmed'] },
  { words: /\bportal\b/i, checks: ['portal-diff-explained'] },
  { words: /\bdifferences?\b/i, checks: ['differences-listed'] },
  { words: /\btax\.statements\b|\b(?:AIS|26AS|Form 16)\b/, checks: ['gaps-tie'] },
  { words: /\bquote (?:its |the |their )?figures?\b|\bfigures? only by receipt\b|\bby reference\b|\bnever type (?:a figure|an amount)\b|\bfigure (?:parts?|refs?)\b|\bcite each figure\b/i, checks: ['figures-from-receipts', 'tax-figure-receipted', 'narrative-receipted', 'figures-resolve'] },
  { words: /\bquot(?:e|es|ed|ing)\b/i, checks: ['quotes-at-source'] },
  { words: /\b(?:ask|asks|question|questions|rounds?)\b/i, checks: ['questions-raised'] },
  { words: /\bslots?\b|\bcalendar\b/i, checks: ['calendar-slots'] },
  { words: /\bhooks?\b/i, checks: ['hook-score'] },
  { words: /\bchapters?\b/i, checks: ['chapters'] },
  { words: /\btitles?\b|\bthumbnails?\b/i, checks: ['title-thumbnail'] },
  { words: /\bdisclos\w*|\blabel(?:led|s)?\b|\bpaid\b|\bsponsor\w*|\bAI (?:voice|presenter)\b/i, checks: ['ai-disclosure', 'paid-promotion', 'disclosure'] },
  { words: /\bhashtags?\b|\bcharacters?\b|\blimits?\b/i, checks: ['channel-limits', 'metadata-limits'] },
  { words: /\brights?\b|\blicen[cs]e\w*/i, checks: ['rights-recorded'] },
  { words: /\bsource credit\b|\bcredit the (?:source|holder)\b/i, checks: ['source-credit'] },
  { words: /\bheadings?\b|\bsections?\b/i, checks: ['required-sections'] },
  { words: /\b(?:long )?dash(?:es)?\b|\bavoid list\b|\bplain words\b|\bno hype\b|\bAI-tell\b|\bstock phrases?\b/i, checks: ['writing-bans', 'writing-tells', 'house-style', 'words'] },
  { words: /\b(?:short|shorter|long|longer|length|sentences?)\b/i, checks: ['length-bounds'] },
  { words: /\b(?:people|firms|names?|specifics?)\b/i, checks: ['claims-grounded', 'claims'] },
  { words: /\bbait\b|\btag (?:a|your|\d+) friends?\b|\bstacked asks?\b/i, checks: ['writing-bait', 'words'] },
]);

/** The results the social checks report: their groups (draft-checks.ts), not each finding's own id. */
const SOCIAL_RESULTS: readonly string[] = ['channel-limits', 'channel-media', 'claims', 'disclosure', 'words', 'calendar-slots', 'narrative-receipted'];

/** Every check id this playbook's runs can report: its steps' checks, and its flagship's own. */
export function playbookCheckIds(playbook: Pick<PlaybookRecord, 'flagship' | 'steps'>): Set<string> {
  const ids = new Set<string>(playbook.steps.flatMap(step => step.checks ?? []));
  const flagship = playbook.flagship ?? null;
  if (flagship === YOUTUBE_ID) for (const id of [...YOUTUBE_STEPS.flatMap(step => step.youtubeChecks), 'prompt-leak', 'rules-current', ...WRITING_CHECK_IDS, 'quotes-at-source']) ids.add(id);
  if (flagship === SOCIAL_AGENCY_ID) for (const id of [...SOCIAL_RESULTS, 'prompt-leak', 'rules-current', ...WRITING_CHECK_IDS]) ids.add(id);
  if (flagship === CA_FIRM_ID) for (const id of [...CA_STEPS.flatMap(step => step.caChecks), 'not-modelled-refused', 'gaps-tie', 'portal-diff-explained', 'signoff-recorded', 'prompt-leak']) ids.add(id);
  return ids;
}

/** The check that can see a line in this playbook, or null. */
export function checkFor(text: string, available: ReadonlySet<string>): string | null {
  for (const rule of SEES) {
    if (!rule.words.test(text)) continue;
    const found = rule.checks.find(id => available.has(id));
    if (found) return found;
  }
  return null;
}

type RunChecks = { checks?: readonly CheckResult[]; playbookChecks?: readonly PlaybookCheckResult[] };
/** The checks that gave a pass or a fail on any of these runs. */
export function seenChecks(runs: readonly RunChecks[]): Set<string> {
  const seen = new Set<string>();
  for (const run of runs) {
    for (const result of run.checks ?? []) if (!result.notChecked) seen.add(result.check);
    for (const result of run.playbookChecks ?? []) if (result.outcome !== 'not-run') seen.add(result.check);
  }
  return seen;
}

/** Each guidance line of the playbook, in step order, with its check and its state. */
export function guidanceLines(playbook: Pick<PlaybookRecord, 'flagship' | 'steps'>, seen: ReadonlySet<string>): GuidanceView['lines'] {
  const available = playbookCheckIds(playbook);
  return playbook.steps.flatMap(step => (step.guidance ?? []).map(text => {
    const check = checkFor(text, available);
    return { stepId: step.id, text, check, state: check === null ? 'unmeasured' as const : seen.has(check) ? 'measured' as const : 'dark' as const };
  }));
}

/** How many of the newest runs and rehearsals count as recent. */
export const RECENT_RUNS = 30;

/** The business's recent drafts' check results: real runs and rehearsal episodes, newest first. */
function recentRuns(state: State, venture: VentureRecord): RunChecks[] {
  const runs = newestFirst(listRecords(state, 'venture-delivery-run', venture.id)).slice(0, RECENT_RUNS);
  const episodes = newestFirst(listRecords(state, 'venture-simulation-run', venture.id)).slice(0, RECENT_RUNS).flatMap(run => run.episodes);
  return [...runs, ...episodes];
}

/** venture.playbook.guidance {} (read): each guidance line of the playbook in use with the check that can see it. */
export async function playbookGuidanceHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<GuidanceView> {
  exactPayload(payload, []);
  const { state, venture } = readAs(deps, ctx, 'read');
  const playbook = currentPlaybook(state, venture);
  // Beside the lines, the parts of the drafts the owner keeps correcting (Q15, corrections.ts): flags only, no change.
  const fixes = fixTheRule(state, venture.id);
  if (!playbook) return { lines: [], fixTheRule: fixes };
  return { lines: guidanceLines(playbook, seenChecks(recentRuns(state, venture))), fixTheRule: fixes };
}
