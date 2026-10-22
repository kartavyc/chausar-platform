// Chausar flagship playbook, social media agency: the judge rules and the committed baseline (design 7.5).
// Rules are yes or no questions, each with its own floor; code checks every cited evidence id and counts the votes
// (delivery/judge/rules.ts). The judge runs after the code checks, for what they cannot see: voice, pillar fit, a claim
// said in other words, whether a disclosure is clear to a reader. The baseline runs every held-back case through the
// code checks with no model and fails when the pass rate drops below the committed one; it only ever rises.
import { readFile } from 'node:fs/promises';
import { check } from '../../../contracts.ts';
import { loadBaseline, type BaselineFile, type CaseResult, type DraftMaker, type HeldBackCase, type SuiteResult } from '../../delivery/judge/baseline.ts';
import type { JudgeRule, RulesInput } from '../../delivery/judge/rules.ts';
import type { JudgeTrace, TraceEvent } from '../../delivery/judge/trace.ts';
import { SOCIAL_CHANNELS, type SocialChannel } from './channels.ts';
import { checkSocialDraft, type AiUse, type ClientRules, type Finding, type PostDraft, type SocialMedia } from './checks.ts';

export const SOCIAL_JUDGE_RULES: readonly JudgeRule[] = Object.freeze([
  {
    id: 'on-brand-voice', question: 'Does the post sound like the voice sheet the owner approved?',
    text: 'The post must sound like the approved voice sheet.', floor: { kind: 'share', percent: 75 },
  },
  {
    id: 'fits-pillar', question: 'Does the post fit one of the approved content pillars?',
    text: 'The post must fit one of the approved content pillars.', floor: { kind: 'share', percent: 75 },
  },
  {
    id: 'claims-backed', question: "Is every claim in the post backed by the client's proof files or brand sheet, including a claim said in other words?",
    text: "Every claim in the post must be backed by the client's proof files or brand sheet.", floor: { kind: 'required-yes' },
  },
  {
    id: 'disclosure-clear', question: 'If the post is paid, or shows an AI person, voice or realistic scene, would a reader see that at first glance?',
    text: 'Paid content and AI people, voices or realistic scenes must be clear to a reader at first glance.', floor: { kind: 'required-yes' },
  },
  {
    id: 'no-fake-customer', question: 'Does the post avoid presenting anyone who does not exist, or who did not use the product, as a customer?',
    text: 'Never present someone who does not exist, or who did not use the product, as a customer.', floor: { kind: 'required-yes' },
  },
  {
    id: 'platform-conduct', question: 'Does the post avoid engagement bait, follow-for-follow and anything else that games the platform?',
    text: 'No engagement bait, no follow-for-follow, nothing that games the platform.', floor: { kind: 'required-yes' },
  },
  {
    id: 'client-comfortable', question: 'Would the client be comfortable seeing this under their name?',
    text: 'The client must be comfortable seeing this under their name.', floor: { kind: 'share', percent: 75 },
  },
] satisfies JudgeRule[]);

const SUMMARY = 300;
const short = (text: string) => (text.length <= SUMMARY ? text : `${text.slice(0, SUMMARY)}...`);

/**
 * The trace a judge vote may cite for one draft: the approved voice sheet, the proof files, the code checks' result and
 * the draft itself. An id appears once.
 */
export function socialJudgeTrace(input: {
  draftId: string; draft: string; proofFileIds: string[]; checks: { passed: boolean; findings: Finding[] }; voiceSheetId?: string;
}): JudgeTrace {
  const events: TraceEvent[] = [];
  const seen = new Set<string>();
  const add = (event: TraceEvent) => { if (!seen.has(event.id)) { seen.add(event.id); events.push(event); } };
  if (input.voiceSheetId) add({ id: input.voiceSheetId, kind: 'voice-sheet', summary: 'The voice sheet and pillars the owner approved.' });
  for (const id of input.proofFileIds) add({ id, kind: 'file', summary: 'A proof file the client sent.' });
  const lines = input.checks.findings.map(item => `${item.severity}: ${item.line}`);
  add({ id: `checks.${input.draftId}`, kind: 'checks', summary: short(input.checks.passed ? `The code checks passed.${lines.length ? ` For the owner: ${lines.join(' ')}` : ''}` : `The code checks blocked the draft: ${lines.join(' ')}`) });
  add({ id: `draft.${input.draftId}`, kind: 'draft', summary: short(input.draft) });
  return { events };
}

/** The judge input for one draft. The draft is client data, so it goes only to a model the owner allowed for it. */
export function socialJudgeInput(draft: string, trace: JudgeTrace, context?: string): RulesInput {
  return { rules: SOCIAL_JUDGE_RULES, trace, draft, containsClientData: true, ...(context ? { context } : {}) };
}

// ---------------------------------------------------------------------------
// Baseline
// ---------------------------------------------------------------------------

export const SOCIAL_BASELINE_DIR = new URL('./baselines/', import.meta.url);
export const SOCIAL_BASELINE_NAME = 'social-agency';

/** The social facts of a held-back case: the channel and what the post is, so the code checks can run on it. */
export type SocialCaseMeta = {
  channel: SocialChannel;
  media?: SocialMedia[];
  paid?: boolean;
  ai?: AiUse;
  style?: PostDraft['style'];
  platformLabels?: PostDraft['platformLabels'];
  client?: Omit<ClientRules, 'proofFiles'>;
};

/** The committed baseline, checked, with the social facts of each case. Every case needs them. */
export async function loadSocialBaseline(dir: URL = SOCIAL_BASELINE_DIR): Promise<{ file: BaselineFile; social: Record<string, SocialCaseMeta> }> {
  const file = await loadBaseline(SOCIAL_BASELINE_NAME, dir);
  const raw = JSON.parse(await readFile(new URL(`${SOCIAL_BASELINE_NAME}.json`, dir), 'utf8')) as { cases: { id: string; social?: SocialCaseMeta }[] };
  const social: Record<string, SocialCaseMeta> = {};
  for (const item of raw.cases) {
    const meta = item.social;
    check(meta && (SOCIAL_CHANNELS as readonly string[]).includes(meta.channel), 'INVALID_VENTURE_REQUEST', `The case ${item.id} needs its channel.`);
    social[item.id] = meta;
  }
  return { file, social };
}

const has = (text: string, phrase: string) => text.toLowerCase().includes(phrase.toLowerCase());

/** One case: the must and must-not phrases, then every code check on the draft as a post. Each failure is a sentence. */
export function scoreSocialCase(item: HeldBackCase, meta: SocialCaseMeta, draft: string): CaseResult {
  const failures: string[] = [];
  for (const phrase of item.mustMention ?? []) if (!has(draft, phrase)) failures.push(`It never mentions "${phrase}".`);
  for (const phrase of item.mustNotMention ?? []) if (has(draft, phrase)) failures.push(`It mentions "${phrase}", which it must not.`);
  const client: ClientRules = {
    ...(meta.client ?? {}),
    known: [...(meta.client?.known ?? []), ...(item.known ?? [])],
    proofFiles: [{ id: 'client-message', text: item.clientRequest }, ...item.sources],
  };
  const post: PostDraft = {
    id: item.id, channel: meta.channel, text: draft, media: meta.media, paid: meta.paid, ai: meta.ai, style: meta.style, platformLabels: meta.platformLabels,
  };
  for (const found of checkSocialDraft(post, client).findings) if (found.severity === 'block') failures.push(found.line);
  return { id: item.id, passed: failures.length === 0, failures };
}

/**
 * Runs every held-back case, one after another. With no draft maker the reference drafts are used. ok is false when
 * the pass rate is below the committed baseline; rates are compared by cross-multiplying whole counts.
 */
export async function runSocialBaseline(options: { dir?: URL; draftFor?: DraftMaker } = {}): Promise<SuiteResult> {
  const { file, social } = await loadSocialBaseline(options.dir);
  const draftFor = options.draftFor ?? ((item: HeldBackCase) => item.reference);
  const cases: CaseResult[] = [];
  for (const item of file.cases) {
    let draft: string;
    try { draft = await draftFor(item); } catch (error) {
      cases.push({ id: item.id, passed: false, failures: [`No draft: ${error instanceof Error ? error.message : 'the draft could not be made.'}`] });
      continue;
    }
    cases.push(scoreSocialCase(item, social[item.id], draft));
  }
  const passed = cases.filter(item => item.passed).length;
  const of = cases.length;
  const ok = passed * file.baseline.of >= file.baseline.passed * of;
  const detail = ok
    ? `${passed} of ${of} held-back cases pass; the baseline is ${file.baseline.passed} of ${file.baseline.of}.`
    : `Quality dropped: ${passed} of ${of} held-back cases pass, below the baseline of ${file.baseline.passed} of ${file.baseline.of}.`;
  return { playbook: file.playbook, passed, of, baseline: { ...file.baseline }, ok, cases, detail };
}
