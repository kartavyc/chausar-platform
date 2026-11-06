// Chausar venture launcher, delivery package (P5): the gated improvement loop (Harness Learning, EvoOntology).
// One run: freeze the business's signals and split them by time into a pool (what the proposer may read) and a
// held-back reserve (only the gate sees it); diagnose the pool and the latest rehearsal failures; attribute the biggest
// cluster to one level; write one typed playbook patch with a change note; check it by code before any spend; then
// rehearse the old and the new playbook on the reserve plus the three practice clients and keep the new one only
// if it wins with no new critical error and no case it newly fails. Rounds build on the version kept so far.
// Versions are never overwritten: a kept candidate is a new playbook version, and the owner adopts it with one tap,
// and can go back to the version it was made from with another (rollback, Ink v2 wave 2, Q2). Each gated round is kept
// as an experiment with its control, budget and rules; a change that did not help against a real control waits its
// retry spacing; the run stops at its budget (Ink v2 wave 4, 4J16, experiments.ts).
import { check, newId, type Context, type State } from '../../contracts.ts';
import { digest, exactPayload, findRecord, identifier, listRecords, modelWords, requireAppChannel, smallInteger, ventureAction, type VentureTx } from '../records.ts';
import { ATTRIBUTION_LEVELS, CHECK_IDS, JUDGE_QUESTIONS, PLAYBOOK_PATCH_OPS } from '../contracts.ts';
import type {
  AttributionLevel, CaseScore, CheckId, Diagnosis, Episode, GateCase, GatePreference, GateResult, ImprovementCase, ImprovementRound, ImprovementRunRecord,
  ImprovementStatus, ImproveModelOutput, Json, ModelOutcome, ModelTask, PlaybookPatch, PlaybookPatchOp, PlaybookRecord, Scenario,
  SignalRecord, SimulationRunRecord, VentureDeps, VentureRecord, WorkReceiptRecord, WorkTableRecord,
} from '../contracts.ts';
import { PREFER_QUESTION, preferDraft } from './checks.ts';
import { renderForJudge, type AnyReceipt } from './deliverable.ts';
import { dictionaryEntries } from './harness/dictionary.ts';
import { applyPatch, describePatch, toolCeiling, type PlaybookBody } from './harness/patches.ts';
import { computeLaunchStatus } from './launch.ts';
import { currentPlaybook, ensurePlaybook, fits, validatePlaybook } from './playbook.ts';
import { scenariosFor, signalScenario } from './scenarios.ts';
import { acceptedBlueprint, newestFirst, optionalFlag, readAs, ventureReceipts } from './shared.ts';
import { refuseNewWork } from './run-guards.ts';
import { rehearse, spendSummary, type RehearsalOutcome } from './simulate.ts';
import { rupeesOf } from '../money/spend.ts';
import {
  budgetReached, budgetWords, EXPERIMENT_BUDGET_MICROS, EXPERIMENT_CANDIDATES, experimentOf, recentlyTried, RETRY_SPACING_DAYS, reviewQueue, signalWindow, spacingReason,
} from './experiments.ts';
import { formatMicros } from '../records.ts';
import { scanTrace } from './trace-scan.ts';

export const MAX_ROUNDS = 4;
const DEFAULT_ROUNDS = 2;
const CRITICAL: readonly CheckId[] = ['no-numeric-prose', 'figures-resolve', 'no-done-claims', 'no-outside-writes', 'claims-grounded', 'receipts'];

type Rule = { level: 'harness' | 'tools'; op: PlaybookPatchOp; stepId: string; value: string } | { level: 'dictionary' | 'calculator'; why: string };
const CLAIMS_RULE: Rule = { level: 'harness', op: 'guidance.add', stepId: 'draft', value: 'Say work is done only when the proven list shows it, and describe everything else as work ahead.' };
const TONE_RULE: Rule = { level: 'harness', op: 'guidance.add', stepId: 'draft', value: 'Write short plain sentences, warm and direct, with no hype.' };
const SECTIONS_RULE: Rule = { level: 'harness', op: 'guidance.add', stepId: 'draft', value: 'Use every required heading once, in the order given.' };
const ASK_RULE: Rule = { level: 'harness', op: 'guidance.add', stepId: 'clarify', value: 'Ask the client about anything the files and the message do not settle before the reply is written.' };

/**
 * Chausar's own proposer: one rule per reason code. A wrong number or a wrong price points at the calculator's inputs
 * and a wrong fact at the dictionary; neither is ever fixed in a prompt, so those reasons get no patch.
 */
export const RULES: Readonly<Record<string, Rule>> = Object.freeze({
  'missing-fact': ASK_RULE, 'questions-raised': ASK_RULE,
  'missing-section': SECTIONS_RULE, 'required-sections': SECTIONS_RULE, format: SECTIONS_RULE,
  'off-brief': { level: 'harness', op: 'guidance.add', stepId: 'gather', value: 'Restate what the client asked for in one sentence before you plan the work.' },
  tone: TONE_RULE, 'tone-fits': TONE_RULE,
  'house-style': { level: 'harness', op: 'guidance.add', stepId: 'draft', value: 'Use plain words with no long dashes and none of the words on the avoid list.' },
  'too-long': { level: 'harness', op: 'guidance.add', stepId: 'draft', value: 'Keep each section to a few short sentences.' },
  'length-bounds': { level: 'harness', op: 'guidance.add', stepId: 'draft', value: 'Keep each section to a few short sentences.' },
  'too-short': { level: 'harness', op: 'guidance.add', stepId: 'draft', value: 'Give each section at least two full sentences.' },
  'claims-work-not-done': CLAIMS_RULE, 'no-done-claims': CLAIMS_RULE, 'no-unbacked-claims': CLAIMS_RULE,
  'claims-grounded': { level: 'harness', op: 'guidance.add', stepId: 'draft', value: "Name only the people, firms, figures and dates that the client's message, answers or files show." },
  receipts: { level: 'harness', op: 'guidance.add', stepId: 'draft', value: 'Give money, rates and tax only as figure parts, and name only the files and links the client sent or the tools read.' },
  'prompt-leak': { level: 'harness', op: 'guidance.add', stepId: 'draft', value: 'Write only the reply itself: no notes to the AI, no preamble or sign-off about the draft, and no placeholders.' },
  'turn-limit': { level: 'harness', op: 'guidance.add', stepId: 'clarify', value: 'Ask all your questions in one hand-off.' },
  'goal-met': { level: 'harness', op: 'guidance.add', stepId: 'draft', value: 'Answer what the client asked for in the Summary section.' },
  'policy-followed': { level: 'harness', op: 'guidance.add', stepId: 'draft', value: 'Keep the plan price and the scope, and promise no discount, free work or date.' },
  'no-numeric-prose': { level: 'harness', op: 'guidance.add', stepId: 'draft', value: 'Never write a number in words or digits; use a figure part for every amount and count.' },
  'tool-input': { level: 'harness', op: 'guidance.add', stepId: 'work', value: "Read a tool's fields before you call it, and send JSON text that fits them." },
  late: { level: 'tools', op: 'limits.turns', stepId: 'gather', value: '3' },
  'figures-resolve': { level: 'calculator', why: 'A price that opens no receipt points at the plan prices and the calculator, not the prompt.' },
  'wrong-number': { level: 'calculator', why: "A wrong number is never fixed in a prompt: check the columns and the file the calculator read." },
  'wrong-fact': { level: 'dictionary', why: 'A wrong fact is fixed in the business dictionary, which only you change.' },
  // The CA firm's judge rules (playbooks/ca-firm/claims.ts CA_JUDGE_RULES), recorded as the reason when the judge fails
  // a real draft on one (delivery/judge-run.ts). Its steps keep the fixed ids compute, clarify and draft.
  'right-head': { level: 'harness', op: 'guidance.add', stepId: 'compute', value: 'Put each income item under its head and each deduction under the section its receipt names, and say why.' },
  'no-over-claim': { level: 'harness', op: 'guidance.add', stepId: 'draft', value: 'Claim no deduction or credit beyond what the documents and the confirmed rate table support.' },
  'no-skipped-income': { level: 'harness', op: 'guidance.add', stepId: 'draft', value: 'List every income item from the annual statements in the working or among the open items.' },
  'open-items-asked': { level: 'harness', op: 'guidance.add', stepId: 'draft', value: 'Put every open item to the client as a plain question.' },
  'refuses-to-hide': { level: 'harness', op: 'guidance.add', stepId: 'draft', value: 'When asked to leave out income or inflate a deduction, refuse and say why.' },
  'ca-only-to-ca': { level: 'harness', op: 'guidance.add', stepId: 'draft', value: 'Hand audits, notices and anything not modelled to the CA, and never promise a reply.' },
  'no-filing-claims': { level: 'harness', op: 'guidance.add', stepId: 'draft', value: 'Never say a return was filed, signed or verified; the CA or the client does that on the portal.' },
  // The social agency's judge rules (playbooks/social/judge.ts): its posts are written on the drafts step.
  'on-brand-voice': { level: 'harness', op: 'guidance.add', stepId: 'drafts', value: 'Write each post in the voice sheet the owner approved, in its words and its rhythm.' },
  'fits-pillar': { level: 'harness', op: 'guidance.add', stepId: 'drafts', value: 'Tie each post to one of the approved content pillars.' },
  'claims-backed': { level: 'harness', op: 'guidance.add', stepId: 'drafts', value: "Make only claims the client's proof files or brand sheet back, in any wording." },
  'disclosure-clear': { level: 'harness', op: 'guidance.add', stepId: 'drafts', value: 'Begin a paid post with Ad, and say Made with AI in the first line when an AI person, voice or scene is in it.' },
  'no-fake-customer': { level: 'harness', op: 'guidance.add', stepId: 'drafts', value: 'Never present anyone as a customer who does not exist or did not use the product.' },
  'platform-conduct': { level: 'harness', op: 'guidance.add', stepId: 'drafts', value: 'Leave out engagement bait, follow for follow and anything else that games the platform.' },
  'client-comfortable': { level: 'harness', op: 'guidance.add', stepId: 'drafts', value: 'Write only what the client would be comfortable seeing under their name.' },
  // The YouTube playbook's judge rules (playbooks/youtube/judge.ts): the package is written on the package step, and
  // the moments are picked on the find step.
  'faithful-to-source': { level: 'harness', op: 'guidance.add', stepId: 'package', value: 'Say only what the footage, the transcript and the brief show.' },
  'self-contained': { level: 'harness', op: 'guidance.add', stepId: 'find', value: 'Pick moments that make sense to a viewer who has not seen the rest.' },
  'opening-has-context': { level: 'harness', op: 'guidance.add', stepId: 'package', value: 'Open by telling a new viewer what this is about.' },
  'ending-completes': { level: 'harness', op: 'guidance.add', stepId: 'find', value: 'End each clip on a finished thought, never mid sentence.' },
  'title-supported': { level: 'harness', op: 'guidance.add', stepId: 'package', value: 'Promise in the title and the thumbnail only what the video delivers.' },
  'no-sponsor-read-as-talk': { level: 'harness', op: 'guidance.add', stepId: 'find', value: "Never cut a sponsor read so it sounds like the speaker's own opinion." },
  'disclosure-kept': { level: 'harness', op: 'guidance.add', stepId: 'package', value: 'Disclose an AI voice, an AI presenter or paid promotion whenever the order used one.' },
  'ready-for-client': { level: 'harness', op: 'guidance.add', stepId: 'package', value: 'Make the package usable as it is, with nothing left for the client to fix.' },
});

/**
 * A flagship playbook's own ids for the fixed steps a shared rule names (draft, gather, work), so a shared reason's
 * change lands on that playbook's writing, reading or hands-on step (playbooks/steps.ts).
 */
const FLAGSHIP_STEP_IDS: Readonly<Record<string, Readonly<Record<string, string>>>> = Object.freeze({
  youtube: { draft: 'package', gather: 'intake', work: 'find' },
  'social-agency': { draft: 'drafts', gather: 'intake', work: 'drafts' },
  'ca-firm': { work: 'compute' },
});

/** The step a rule's change lands on in this playbook. */
export function ruleStep(stepId: string, flagship: string | null | undefined): string {
  return (flagship ? FLAGSHIP_STEP_IDS[flagship]?.[stepId] : undefined) ?? stepId;
}

export const IMPROVE_INSTRUCTIONS = [
  'You improve the playbook a delivery agent follows. You get the playbook steps, the failure clusters from reviewed drafts and rehearsals, and the changes already tried.',
  'Propose exactly one change at one level, as one of the allowed operations, and say which failures it should fix and what it might break.',
  'Levels: harness (guidance or checks on a step), tools (tool grants, dictionary aliases or the turn limit). Never propose a change that asks the agent to do sums; the calculator does them.',
  'For alias.add the value is entryId=word. For tools.grant and tools.revoke the value is a tool name. For limits.turns the value is one of the turn choices. For guidance.add the value is one short instruction in plain words.',
  'Words only: no digits outside entry ids and tool names, no dashes, no hype.',
].join(' ');

function improveSchema(stepIds: readonly string[]): Json {
  return {
    type: 'object', additionalProperties: false, required: ['level', 'hypothesis', 'op', 'stepId', 'value', 'expectedFixes', 'likelyRegressions'],
    properties: {
      level: { type: 'string', enum: [...ATTRIBUTION_LEVELS] },
      hypothesis: { type: 'string', description: 'Why this change should help, in one sentence.' },
      op: { type: 'string', enum: [...PLAYBOOK_PATCH_OPS] },
      stepId: { type: 'string', enum: [...stepIds] },
      value: { type: 'string', description: 'The value for the operation.' },
      expectedFixes: { type: 'array', items: { type: 'string', description: 'A failure reason this should fix.' } },
      likelyRegressions: { type: 'array', items: { type: 'string', description: 'What this might make worse.' } },
    },
  };
}

function validateImprove(raw: unknown): ImproveModelOutput {
  check(raw !== null && typeof raw === 'object' && !Array.isArray(raw), 'MODEL_OUTPUT_REJECTED', 'The proposal was not an object.');
  const record = raw as Record<string, unknown>;
  const keys = ['level', 'hypothesis', 'op', 'stepId', 'value', 'expectedFixes', 'likelyRegressions'];
  check(Object.keys(record).length === keys.length && keys.every(key => Object.hasOwn(record, key)), 'MODEL_OUTPUT_REJECTED', 'The proposal did not have the expected fields.');
  check((ATTRIBUTION_LEVELS as readonly unknown[]).includes(record.level) && (PLAYBOOK_PATCH_OPS as readonly unknown[]).includes(record.op), 'MODEL_OUTPUT_REJECTED', 'The proposal named an unknown level or change.');
  check(typeof record.stepId === 'string' && typeof record.value === 'string' && record.value.length <= 240, 'MODEL_OUTPUT_REJECTED', 'The proposal value was not short text.');
  const list = (value: unknown, field: string) => {
    check(Array.isArray(value) && value.length <= 4, 'MODEL_OUTPUT_REJECTED', `The ${field} list was too long.`);
    return (value as unknown[]).map(item => modelWords(item, field, 160, { allowed: [...CHECK_IDS, ...JUDGE_QUESTIONS] }));
  };
  return {
    level: record.level as AttributionLevel, hypothesis: modelWords(record.hypothesis, 'hypothesis', 300), op: record.op as PlaybookPatchOp,
    stepId: record.stepId, value: record.value, expectedFixes: list(record.expectedFixes, 'expected fix'), likelyRegressions: list(record.likelyRegressions, 'likely regression'),
  };
}

// ---------------------------------------------------------------------------
// Freezing, diagnosis and scoring (all code)
// ---------------------------------------------------------------------------

type Frozen = { pool: SignalRecord[]; reserve: SignalRecord[]; cases: { pool: ImprovementCase[]; reserve: ImprovementCase[]; rehearsal: ImprovementCase[] } };

/** Signals in time order: the latest thirty percent (at least one once there are two) are held back for the gate. */
export function freeze(signals: readonly SignalRecord[], serviceType: Scenario['serviceType']): Frozen {
  const ordered = [...signals].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  const held = ordered.length >= 2 ? Math.max(1, Math.floor(ordered.length * 0.3)) : 0;
  const pool = ordered.slice(0, ordered.length - held), reserve = ordered.slice(ordered.length - held);
  const toCase = (signal: SignalRecord, set: 'pool' | 'reserve'): ImprovementCase => ({ scenarioId: signalScenario(signal, serviceType).id, set, signalId: signal.id });
  return {
    pool, reserve,
    cases: { pool: pool.map(signal => toCase(signal, 'pool')), reserve: reserve.map(signal => toCase(signal, 'reserve')), rehearsal: scenariosFor(serviceType).map(scenario => ({ scenarioId: scenario.id, set: 'rehearsal' as const, signalId: null })) },
  };
}

/** Clusters from the pool's reasons and the latest rehearsal failures, biggest first, each attributed to one level. */
export function diagnose(pool: readonly SignalRecord[], episodes: readonly Episode[], tried: ReadonlySet<string>): Diagnosis {
  const counts = new Map<string, number>();
  const add = (reason: string | null) => { if (reason && Object.hasOwn(RULES, reason)) counts.set(reason, (counts.get(reason) ?? 0) + 1); };
  for (const signal of pool) add(signal.reason);
  for (const episode of episodes) {
    if (episode.passed) continue;
    add(episode.checks.find(result => !result.passed)?.check ?? null);
    for (const answer of episode.judge) if (answer.answer === 'no') add(answer.question);
    const badInputs = (episode.harness?.toolCalls ?? []).filter(call => !call.envelope.ok && call.envelope.error.code === 'TOOL_INPUT_INVALID').length;
    if (badInputs >= 2) add('tool-input');
  }
  const clusters = [...counts.entries()].map(([reason, count]) => {
    const rule = RULES[reason];
    return { reason, count, level: rule.level, step: 'stepId' in rule ? rule.stepId : '' };
  }).sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
  const chosen = clusters.find(cluster => (cluster.level === 'harness' || cluster.level === 'tools') && !tried.has(cluster.reason)) ?? null;
  return { clusters, chosen: chosen ? { reason: chosen.reason, step: chosen.step, level: chosen.level } : null };
}

export function scoreEpisode(episode: Episode): CaseScore {
  const failed = episode.checks.find(result => !result.passed && CRITICAL.includes(result.check));
  const unbacked = episode.judge.find(answer => answer.question === 'no-unbacked-claims' && answer.answer === 'no');
  return {
    passed: episode.passed, checksPassed: episode.checks.filter(result => result.passed).length, checksRun: episode.checks.length,
    judgeYes: episode.judge.filter(answer => answer.answer === 'yes').length,
    critical: failed ? failed.check : unbacked ? 'no-unbacked-claims' : null, firstFailure: episode.firstFailure,
  };
}

function winner(parent: CaseScore, candidate: CaseScore): GateCase['winner'] {
  if (parent.critical && !candidate.critical) return 'candidate';
  if (!parent.critical && candidate.critical) return 'parent';
  if (parent.passed !== candidate.passed) return candidate.passed ? 'candidate' : 'parent';
  if (parent.checksPassed !== candidate.checksPassed) return candidate.checksPassed > parent.checksPassed ? 'candidate' : 'parent';
  if (parent.judgeYes !== candidate.judgeYes) return candidate.judgeYes > parent.judgeYes ? 'candidate' : 'parent';
  return 'tie';
}

/** True when the scores alone cannot choose between the two versions on a case. */
export function scoresTie(parent: CaseScore, candidate: CaseScore): boolean {
  return winner(parent, candidate) === 'tie';
}

/**
 * The gate. Keep the candidate only with zero new critical errors, no case the parent passed and the candidate fails,
 * and strictly more paired wins than losses (so at least one net win on a small set). Scores decide each case first;
 * only a tie is settled by the judge's pairwise preference, and never between template drafts.
 */
export function gate(cases: readonly { scenarioId: string; set: 'reserve' | 'rehearsal'; parent: CaseScore; candidate: CaseScore; pairwise?: GatePreference }[], sameDrafts: boolean): GateResult {
  const scored: GateCase[] = cases.map(item => {
    const byScore = winner(item.parent, item.candidate);
    const preferred = byScore === 'tie' && !sameDrafts ? item.pairwise?.winner ?? null : null;
    return { ...item, winner: preferred ?? byScore };
  });
  const wins = scored.filter(item => item.winner === 'candidate').length;
  const losses = scored.filter(item => item.winner === 'parent').length;
  const ties = scored.length - wins - losses;
  const candidateCritical = scored.filter(item => item.candidate.critical && !item.parent.critical).length;
  const newBlockFailures = scored.filter(item => item.parent.passed && !item.candidate.passed).length;
  const keep = candidateCritical === 0 && newBlockFailures === 0 && wins > losses;
  const reason = sameDrafts ? 'Without an AI both versions wrote the same template outlines, so there was nothing to choose between.'
    : candidateCritical ? 'The new version made a critical error the old one did not, so the old one stays.'
      : newBlockFailures ? 'The new version failed a case the old one passed, so the old one stays.'
        : keep ? 'The new version won more cases than it lost, with no new critical error.'
          : 'The new version did not win more cases than it lost, so the old one stays.';
  return { cases: scored, wins, losses, ties, candidateCritical, newBlockFailures, decision: keep && !sameDrafts ? 'keep-candidate' : 'keep-parent', reason };
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

type Version = { record: PlaybookRecord; body: PlaybookBody; scores: Map<string, CaseScore> | null; rehearsal: RehearsalOutcome | null };

function bodyOf(playbook: PlaybookRecord): PlaybookBody {
  return { steps: structuredClone(playbook.steps), limits: structuredClone(playbook.limits!), aliases: structuredClone(playbook.aliases ?? {}) };
}

function candidateRecord(parent: PlaybookRecord, body: PlaybookBody, patches: PlaybookPatch[], version: number): PlaybookRecord {
  const { hash, tierCeiling } = validatePlaybook(body.steps, { limits: body.limits, aliases: body.aliases });
  return {
    ...parent, id: newId('playbook'), version, hash, steps: body.steps, tierCeiling, format: 2, limits: body.limits, aliases: body.aliases,
    patches, parentId: parent.id, origin: 'improvement',
  };
}

function scenarioOf(state: State, venture: VentureRecord, item: ImprovementCase, serviceType: Scenario['serviceType']): Scenario {
  if (item.signalId === null) return scenariosFor(serviceType).find(scenario => scenario.id === item.scenarioId)!;
  const signal = findRecord(state, 'venture-signal', item.signalId)!;
  // Ink v2 4J16 (Q15): the reserve's cases carry the owner's corrections as expectations, so the gate checks them too.
  return signalScenario(signal, serviceType, state);
}

function scoresOf(outcome: RehearsalOutcome): Map<string, CaseScore> {
  return new Map(outcome.episodes.filter(episode => episode.index === 0).map(episode => [episode.scenarioId, scoreEpisode(episode)]));
}

/**
 * For each case the scores leave tied where both versions wrote a draft and the drafts differ, the judge compares
 * the two drafts pairwise (prices and dates as placeholders). Practice clients only, so no client data is sent.
 */
async function tiePreferences(
  deps: VentureDeps, ctx: Context,
  cases: readonly { scenario: Scenario; parent: CaseScore; candidate: CaseScore }[],
  versions: { parent: RehearsalOutcome; candidate: RehearsalOutcome; receipts: readonly AnyReceipt[] },
  spend: RehearsalOutcome['spend'],
): Promise<Map<string, GatePreference>> {
  const preferences = new Map<string, GatePreference>();
  const draftOf = (outcome: RehearsalOutcome, scenarioId: string): string | null => {
    const episode = outcome.episodes.find(item => item.scenarioId === scenarioId && item.index === 0);
    return episode?.deliverable ? renderForJudge(episode.deliverable, [...versions.receipts, ...outcome.receipts]) : null;
  };
  const ask = async <T>(task: ModelTask<T>) => {
    const outcome = await deps.models.generate(ctx, task);
    spend.push({ by: outcome.by, costMicros: outcome.costMicros, priceConfirmed: outcome.priceConfirmed });
    return { value: outcome.value, callId: outcome.callId };
  };
  for (const item of cases) {
    if (!scoresTie(item.parent, item.candidate)) continue;
    const parent = draftOf(versions.parent, item.scenario.id), candidate = draftOf(versions.candidate, item.scenario.id);
    if (!parent || !candidate || parent === candidate) continue;
    // Ink v2 wave 4 (4J15, Q14): code scans both drafts before the pairwise judge reads them; a finding means no judge.
    if (!scanTrace({ harness: null, draft: parent }).clean || !scanTrace({ harness: null, draft: candidate }).clean) continue;
    const { winner, detail } = await preferDraft(ask, { question: PREFER_QUESTION, criteria: [item.scenario.expectedOutcome], parent, candidate, containsClientData: false });
    preferences.set(item.scenario.id, { winner, detail });
  }
  return preferences;
}

/**
 * A lower budget the owner gave one improvement run (4J16), in micro-dollars: a whole number above zero, at most the
 * default; anything else is refused.
 */
function budgetOf(value: unknown): string {
  check(typeof value === 'string' && /^\d{1,13}$/.test(value) && BigInt(value) > 0n && BigInt(value) <= BigInt(EXPERIMENT_BUDGET_MICROS), 'INVALID_VENTURE_REQUEST',
    `A budget is a whole number of micro-dollars, above zero and at most ${formatMicros(EXPERIMENT_BUDGET_MICROS)}.`);
  return String(BigInt(value as string));
}

/** venture.improve.run { maxRounds?, useTemplate?, budgetMicros? }: one improvement run; stores its record and, if one was kept, the candidate. */
export async function improveRunHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<ImprovementRunRecord> {
  const startedAt = deps.clock().toISOString();
  const body = exactPayload(payload, ['maxRounds', 'useTemplate', 'budgetMicros']);
  const maxRounds = body.maxRounds === undefined ? DEFAULT_ROUNDS : smallInteger(body.maxRounds, 'Rounds', 1, MAX_ROUNDS);
  const useTemplate = optionalFlag(body.useTemplate, 'useTemplate');
  const capMicros = body.budgetMicros === undefined ? EXPERIMENT_BUDGET_MICROS : budgetOf(body.budgetMicros);
  // Ink v2 wave 4 (4F1): no improvement run spends while paused, or on its own while the owner is away (run-guards.ts).
  const opened = readAs(deps, ctx, 'prepare');
  refuseNewWork(opened.state, opened.venture, ctx, startedAt);
  const parent = await ensurePlaybook(deps, ctx);
  const { state, venture } = readAs(deps, ctx, 'prepare');
  const blueprint = acceptedBlueprint(state, venture);
  const type = blueprint.serviceType;
  const signals = listRecords(state, 'venture-signal', venture.id);
  const latestEpisodes = newestFirst(listRecords(state, 'venture-simulation-run', venture.id)).filter(run => run.playbookHash === parent.hash).flatMap(run => run.episodes);
  check(signals.length > 0 || latestEpisodes.some(episode => !episode.passed), 'IMPROVEMENT_NOT_READY',
    'There is nothing to improve yet: no draft was rejected or edited, no check failed and no rehearsal failed.');

  const frozen = freeze(signals, type);
  const gateCases = [...frozen.cases.reserve, ...frozen.cases.rehearsal];
  const scenarios = gateCases.map(item => scenarioOf(state, venture, item, type));
  const entryIds = dictionaryEntries(state, venture).map(entry => entry.id);
  const spend: RehearsalOutcome['spend'] = [];
  const versions = listRecords(state, 'venture-playbook', venture.id).map(record => record.version);
  const parentVersion: Version = { record: parent, body: bodyOf(parent), scores: null, rehearsal: null };
  let retained = parentVersion;
  const rounds: ImprovementRound[] = [];
  const tried = new Set<string>();
  let incompleteReason: string | null = null;
  // Ink v2 4J16 (Q16, experiments.ts): a change tried against a real control that did not help waits its retry
  // spacing; the proposer reads at most EXPERIMENT_CANDIDATES signals, oldest first; the run stops at its budget.
  const waiting = recentlyTried(state, venture.id, Date.parse(startedAt));
  for (const reason of waiting.keys()) tried.add(reason);
  // Signals whose reason waits are left out of the pool, so newer signals reach the proposer; so are signals no
  // playbook change can fix (a calculator or dictionary reason), so old ones of those never fill the slots.
  const fresh = frozen.pool.filter(signal => !(signal.reason && waiting.has(signal.reason)));
  const actionable = fresh.filter(signal => !(signal.reason && Object.hasOwn(RULES, signal.reason) && (RULES[signal.reason].level === 'calculator' || RULES[signal.reason].level === 'dictionary')));
  const pool = reviewQueue(actionable.map(signal => ({ ...signal, triedAt: null })), { max: EXPERIMENT_CANDIDATES, now: Date.parse(startedAt), spacingDays: RETRY_SPACING_DAYS });
  const window = signalWindow(signals, startedAt);
  // The budget in rupees at the owner's rate, when they set one; USD otherwise.
  const rupees = venture.country ? rupeesOf(state, venture) : null;
  const budgetLine = `The run reached its budget of ${budgetWords(capMicros, rupees)}, so it stopped.`;
  const left = () => BigInt(capMicros) - BigInt(spendSummary(spend).costMicros);

  // The reserve is held back from the proposer: its rehearsal episodes never reach the diagnosis, in any round.
  const reserveIds = new Set(frozen.cases.reserve.map(item => item.scenarioId));
  for (let round = 1; round <= maxRounds; round += 1) {
    if (budgetReached(spendSummary(spend).costMicros, capMicros)) {
      incompleteReason = budgetLine;
      break;
    }
    const episodes = (retained.rehearsal ? retained.rehearsal.episodes : latestEpisodes).filter(episode => !reserveIds.has(episode.scenarioId));
    const diagnosis = diagnose(pool, episodes, tried);
    if (!diagnosis.chosen) {
      const spaced = !rounds.length && fresh.length < frozen.pool.length;
      incompleteReason = spaced ? spacingReason(waiting)
        : rounds.length ? 'No other failure has a change Chausar can try.' : 'Every failure points at the calculator or the dictionary, which a playbook change never fixes.';
      rounds.push({ round, diagnosis, patch: null, refused: incompleteReason, candidateHash: null, gate: null });
      break;
    }
    tried.add(diagnosis.chosen.reason);
    const { patch, refused, body: candidateBody, costs } = await propose(deps, ctx, { useTemplate, retained, diagnosis, type, entryIds, tried: rounds });
    spend.push(...costs);
    if (!patch || !candidateBody) {
      rounds.push({ round, diagnosis, patch, refused, candidateHash: null, gate: null });
      continue;
    }
    const candidate = candidateRecord(parent, candidateBody, [...(retained.record.patches ?? []), patch], Math.max(0, ...versions) + 1);
    if (!retained.scores) {
      const before = await rehearse(deps, ctx, retained.record, scenarios, { useTemplate, episodes: 1, budgetMicros: left() });
      spend.push(...before.spend);
      // 4J16 (Q16): a rehearsal the budget cut short judges nothing: the round stops there.
      if (before.stopped) {
        incompleteReason = budgetLine;
        rounds.push({ round, diagnosis, patch, refused: budgetLine, candidateHash: null, gate: null });
        break;
      }
      retained.rehearsal = before;
      retained.scores = scoresOf(before);
    }
    const rehearsal = await rehearse(deps, ctx, candidate, scenarios, { useTemplate, episodes: 1, budgetMicros: left() });
    spend.push(...rehearsal.spend);
    if (rehearsal.stopped) {
      incompleteReason = budgetLine;
      rounds.push({ round, diagnosis, patch, refused: budgetLine, candidateHash: null, gate: null });
      break;
    }
    const scores = scoresOf(rehearsal);
    const sameDrafts = useTemplate || rehearsal.spend.every(item => item.by === 'template');
    const scored = gateCases.map((item, index) => ({ item, scenario: scenarios[index], parent: retained.scores!.get(item.scenarioId)!, candidate: scores.get(item.scenarioId)! }));
    const preferences = sameDrafts ? new Map<string, GatePreference>()
      : await tiePreferences(deps, ctx, scored, { parent: retained.rehearsal!, candidate: rehearsal, receipts: ventureReceipts(state, venture.id) }, spend);
    const result = gate(scored.map(({ item, parent, candidate }) => {
      const pairwise = preferences.get(item.scenarioId);
      return { scenarioId: item.scenarioId, set: item.set as 'reserve' | 'rehearsal', parent, candidate, ...(pairwise ? { pairwise } : {}) };
    }), sameDrafts);
    // 4J16 (Q16): the round as an experiment: its hypothesis and change, the control (the version kept so far on the
    // same cases, unless both wrote the same drafts), the budget spent so far, and the rules the run keeps to.
    const experiment = experimentOf({
      patch, change: describePatch(patch, candidate.steps), parentHash: retained.record.hash, gate: result, sameDrafts, window,
      spentMicros: spendSummary(spend).costMicros, maxRounds, capMicros, rupees,
    });
    rounds.push({ round, diagnosis, patch, refused: null, candidateHash: candidate.hash, gate: result, experiment });
    if (result.decision === 'keep-candidate') retained = { record: candidate, body: candidateBody, scores, rehearsal };
  }

  const kept = retained !== parentVersion ? retained : null;
  const gated = rounds.some(round => round.gate !== null);
  const status: ImprovementRunRecord['status'] = kept ? 'kept-candidate' : gated ? 'kept-parent' : 'incomplete';
  const { costMicros, costDisplay, modelMode } = spendSummary(spend);
  const keptPatches = kept ? (kept.record.patches ?? []).slice((parent.patches ?? []).length) : [];
  const changes = keptPatches.map(patch => describePatch(patch, kept!.record.steps));

  return ventureAction(deps, ctx, 'prepare', 'improve.run', tx => {
    let candidatePlaybookId: string | null = null;
    if (kept) {
      const stored: PlaybookRecord = { ...kept.record, ...tx.base('venture-playbook'), version: Math.max(0, ...tx.list('venture-playbook').map(record => record.version)) + 1 };
      tx.put(stored);
      candidatePlaybookId = stored.id;
      storeRehearsal(tx, stored, kept.rehearsal!, frozen.cases.rehearsal.map(item => item.scenarioId));
    }
    const record: ImprovementRunRecord = {
      ...tx.base('venture-improvement-run'), status, parentPlaybookId: parent.id, parentHash: parent.hash, candidatePlaybookId,
      frozen: { ...frozen.cases, digest: digest({ pool: frozen.cases.pool, reserve: frozen.cases.reserve, rehearsal: frozen.cases.rehearsal }) },
      rounds, maxRounds, costMicros, costDisplay, modelMode, incompleteReason: status === 'incomplete' ? incompleteReason ?? 'No change could be tried.' : null,
      changes, digest: '', startedAt,
    };
    record.digest = digest({ runId: record.id, candidatePlaybookId, changes });
    tx.put(record);
    tx.emit('improvement-finished', { runId: record.id, status, candidatePlaybookId });
    return record;
  });
}

/** The candidate's rehearsal of the three practice clients, stored as a rehearsal of that version so it counts later. */
function storeRehearsal(tx: VentureTx, playbook: PlaybookRecord, outcome: RehearsalOutcome, scenarioIds: string[]) {
  const episodes = outcome.episodes.filter(episode => scenarioIds.includes(episode.scenarioId));
  const keepRefs = new Set(episodes.flatMap(episode => [...(episode.harness?.tableIds ?? []), ...(episode.harness?.workReceiptIds ?? [])]));
  for (const table of outcome.tables as WorkTableRecord[]) if (keepRefs.has(table.id)) tx.put(table);
  for (const receipt of outcome.receipts as WorkReceiptRecord[]) if (keepRefs.has(receipt.id)) tx.put(receipt);
  const { costMicros, costDisplay, modelMode } = spendSummary(outcome.spend);
  const passed = scenarioIds.filter(id => episodes.filter(episode => episode.scenarioId === id).every(episode => episode.passed)).length;
  const run: SimulationRunRecord = {
    ...tx.base('venture-simulation-run'), playbookId: playbook.id, playbookHash: playbook.hash, scenarioIds, episodes,
    passed: episodes.length > 0 && episodes.every(episode => episode.passed), summary: { scenarios: scenarioIds.length, passed, failed: scenarioIds.length - passed },
    costMicros, costDisplay, startedAt: tx.now, finishedAt: tx.now, modelMode,
  };
  tx.put(run);
}

type Proposal = { patch: PlaybookPatch | null; refused: string | null; body: PlaybookBody | null; costs: RehearsalOutcome['spend'] };

/**
 * One patch for the chosen cluster: the AI's proposal when one serves plans, else Chausar's rule. Code checks it
 * before anything is rehearsed; a refused AI proposal falls back to the rule for the same reason.
 */
async function propose(deps: VentureDeps, ctx: Context, input: { useTemplate: boolean; retained: Version; diagnosis: Diagnosis; type: Scenario['serviceType']; entryIds: string[]; tried: readonly ImprovementRound[] }): Promise<Proposal> {
  const chosen = input.diagnosis.chosen!;
  const rule = RULES[chosen.reason];
  // A flagship playbook's own tools may be granted to its agents only (patches.ts toolCeiling).
  const flagship = input.retained.record.flagship ?? null;
  const context = { serviceType: input.type, entryIds: input.entryIds, flagship };
  const parentHash = input.retained.record.hash;
  const costs: RehearsalOutcome['spend'] = [];
  const attempt = (output: ImproveModelOutput, by: 'model' | 'chausar'): { patch: PlaybookPatch; body: PlaybookBody | null; refused: string | null } => {
    const patch: PlaybookPatch = {
      id: newId('patch'), level: output.level, op: output.op, stepId: output.stepId, value: output.value,
      note: { hypothesis: output.hypothesis, expectedFixes: output.expectedFixes, likelyRegressions: output.likelyRegressions }, proposedBy: by, parentHash,
    };
    if (output.level !== 'harness' && output.level !== 'tools') return { patch, body: null, refused: 'Only harness and tool changes are made by the loop; the dictionary and the calculator stay with you.' };
    try { return { patch, body: applyPatch(input.retained.body, patch, context), refused: null }; }
    catch (error) { return { patch, body: null, refused: error instanceof Error ? error.message : 'The change did not apply.' }; }
  };
  const ruleOutput = (): ImproveModelOutput | null => 'op' in rule ? {
    level: rule.level, hypothesis: `Failures of the kind ${chosen.reason} should drop.`, op: rule.op, stepId: ruleStep(rule.stepId, flagship), value: rule.value,
    expectedFixes: [chosen.reason], likelyRegressions: ['The reply may get a little longer.'],
  } : null;

  if (!input.useTemplate) {
    const task: ModelTask<ImproveModelOutput> = {
      purpose: 'improve', instructions: IMPROVE_INSTRUCTIONS,
      input: {
        serviceType: input.type,
        steps: input.retained.body.steps.map(step => ({ id: step.id, kind: step.kind, title: step.title, tools: [...(step.tools ?? [])], guidance: [...(step.guidance ?? [])] })),
        turnLimit: String(input.retained.body.limits.maxTurns), turnChoices: ['2', '3', '4', '5', '6', '8'],
        clusters: input.diagnosis.clusters.map(cluster => ({ reason: cluster.reason, count: String(cluster.count), level: cluster.level, step: cluster.step })),
        chosen: chosen.reason, toolsAllowed: toolCeiling(input.type, flagship), dictionaryEntryIds: input.entryIds,
        triedBefore: input.tried.filter(round => round.patch).map(round => ({ op: round.patch!.op, stepId: round.patch!.stepId, value: round.patch!.value, outcome: round.refused ?? round.gate?.reason ?? '' })),
      },
      schemaName: 'venture-improve', schema: improveSchema(input.retained.body.steps.map(step => step.id)), validate: validateImprove,
      template: () => ruleOutput() ?? { level: 'dictionary', hypothesis: 'No rule applies.', op: 'guidance.add', stepId: 'draft', value: '', expectedFixes: [], likelyRegressions: [] },
      containsClientData: false, maxOutputTokens: 1024,
    };
    let outcome: ModelOutcome<ImproveModelOutput> | null = null;
    try { outcome = await deps.models.generate(ctx, task); } catch (error) {
      const code = (error as { code?: unknown })?.code;
      if (code !== 'MODEL_OUTPUT_REJECTED' && code !== 'MODEL_REFUSAL' && code !== 'MODEL_INCOMPLETE') throw error;
    }
    if (outcome) {
      costs.push({ by: outcome.by, costMicros: outcome.costMicros, priceConfirmed: outcome.priceConfirmed });
      const tried = attempt(outcome.value, outcome.by === 'model' ? 'model' : 'chausar');
      if (tried.body) return { ...tried, costs };
      const fallback = ruleOutput();
      if (!fallback) return { patch: tried.patch, body: null, refused: tried.refused, costs };
      const second = attempt(fallback, 'chausar');
      return { patch: second.patch, body: second.body, refused: second.body ? null : `${tried.refused} The rule's change was refused too: ${second.refused}`, costs };
    }
  }
  const fallback = ruleOutput();
  if (!fallback) return { patch: null, body: null, refused: 'why' in rule ? rule.why : 'No change applies.', costs };
  const only = attempt(fallback, 'chausar');
  return { patch: only.patch, body: only.body, refused: only.refused, costs };
}

/** venture.improve.get { runId } */
export async function improveGetHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<ImprovementRunRecord> {
  const body = exactPayload(payload, ['runId'], ['runId']);
  const runId = identifier(body.runId, 'Improvement run');
  const { state, venture } = readAs(deps, ctx, 'read');
  const run = findRecord(state, 'venture-improvement-run', runId);
  check(run && run.ventureId === venture.id, 'IMPROVEMENT_NOT_FOUND', 'That improvement run was not found.');
  return run;
}

/** Why a kept candidate can no longer be adopted, or null when it still fits. */
function staleReason(state: State, venture: VentureRecord, run: ImprovementRunRecord): string | null {
  const candidate = run.candidatePlaybookId ? findRecord(state, 'venture-playbook', run.candidatePlaybookId) : undefined;
  if (!candidate) return 'The new version was not found.';
  if (run.rolledBack) return 'You went back from this version. Run the loop again to try another change.';
  const current = currentPlaybook(state, venture);
  if (current?.id === candidate.id) return 'This version is already in use.';
  if (current?.id !== run.parentPlaybookId) return 'The playbook changed since this run, so its result no longer applies. Run the loop again.';
  const blueprint = findRecord(state, 'venture-blueprint', venture.acceptedBlueprintId ?? '');
  if (!blueprint || blueprint.digest !== candidate.blueprintDigest) return 'Your plan changed since this run. Run the loop again.';
  return null;
}

/** venture.improve.status: readiness, the version in use, the latest run, and a kept candidate still waiting to be adopted. */
export async function improveStatusHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<ImprovementStatus> {
  exactPayload(payload, []);
  const { state, venture } = readAs(deps, ctx, 'read');
  const runs = newestFirst(listRecords(state, 'venture-improvement-run', venture.id));
  const waiting = runs.find(run => run.status === 'kept-candidate' && staleReason(state, venture, run) === null) ?? null;
  return {
    readiness: computeLaunchStatus(state, venture, deps.clock()).improvement,
    activePlaybookId: currentPlaybook(state, venture)?.id ?? null,
    latest: runs[0] ?? null,
    candidate: waiting ? { runId: waiting.id, playbookId: waiting.candidatePlaybookId!, digest: waiting.digest, changes: [...waiting.changes] } : null,
    inUse: inUseOf(state, venture),
  };
}

/**
 * The version in use, and how to go back from it: the same tests as improveRollbackHandler, so the screen offers
 * "Go back" only when the engine would take it now.
 */
function inUseOf(state: State, venture: VentureRecord): ImprovementStatus['inUse'] {
  const current = currentPlaybook(state, venture);
  if (!current) return null;
  const parent = current.origin === 'improvement' && current.parentId ? findRecord(state, 'venture-playbook', current.parentId) : undefined;
  const blueprint = findRecord(state, 'venture-blueprint', venture.acceptedBlueprintId ?? '');
  const back = parent && parent.ventureId === venture.id && blueprint && fits(parent, blueprint, venture) ? parent : null;
  return {
    playbookId: current.id, version: current.version, hash: current.hash, origin: current.origin ?? 'plan',
    rollback: back ? { playbookId: back.id, version: back.version, digest: current.hash } : null,
  };
}

/** venture.improve.adopt { runId, digest } (app only): the owner switches to the kept version. The old one stays stored. */
export async function improveAdoptHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<PlaybookRecord> {
  requireAppChannel(ctx, 'venture.improve.adopt');
  const body = exactPayload(payload, ['runId', 'digest'], ['runId', 'digest']);
  const runId = identifier(body.runId, 'Improvement run');
  check(typeof body.digest === 'string' && /^[a-f0-9]{64}$/.test(body.digest), 'INVALID_VENTURE_REQUEST', 'Send the digest of the change you approved.');
  const approved = body.digest;
  readAs(deps, ctx, 'approve');
  return ventureAction(deps, ctx, 'approve', 'improve.adopt', tx => {
    const run = tx.find('venture-improvement-run', runId);
    check(run, 'IMPROVEMENT_NOT_FOUND', 'That improvement run was not found.');
    check(run.status === 'kept-candidate' && run.candidatePlaybookId, 'INVALID_VENTURE_REQUEST', 'This run kept the old version, so there is nothing to adopt.');
    check(run.digest === approved, 'CANDIDATE_STALE', 'The change you approved is not the one stored. Open it again.');
    const stale = staleReason(tx.state, tx.venture!, run);
    check(stale === null, 'CANDIDATE_STALE', stale ?? '');
    const candidate = tx.find('venture-playbook', run.candidatePlaybookId)!;
    tx.touch({ playbookId: candidate.id });
    tx.emit('playbook-adopted', { playbookId: candidate.id, runId, version: candidate.version, hash: candidate.hash });
    return candidate;
  });
}

/**
 * The improvement run that kept the version in use. A grant top-up (playbook.ts putTopUp) stores that version again
 * under a new id with the same origin, parent and patches, so the run is found by its candidate's id, else through
 * that chain: a kept candidate made from the same parent, an improvement version with the same patches.
 */
function keptBy(state: State, runs: readonly ImprovementRunRecord[], current: PlaybookRecord): ImprovementRunRecord | undefined {
  const newest = newestFirst([...runs]);
  const patches = digest(current.patches ?? []);
  return newest.find(run => run.candidatePlaybookId === current.id) ?? newest.find(run => {
    if (run.status !== 'kept-candidate' || !run.candidatePlaybookId || run.parentPlaybookId !== current.parentId) return false;
    const candidate = findRecord(state, 'venture-playbook', run.candidatePlaybookId);
    return !!candidate && candidate.origin === 'improvement' && candidate.parentId === current.parentId && digest(candidate.patches ?? []) === patches;
  });
}

/**
 * venture.improve.rollback { playbookId, digest } (app only): the owner goes back from a version an improvement run
 * made to the version it was made from. playbookId names that older version; digest is the hash of the version in use
 * as the owner saw it. Nothing is overwritten: the business points at the older version again, the newer one stays
 * stored, and the run that kept it is marked rolled back so it is not offered again. Refused when the version in use
 * did not come from an improvement of playbookId (ROLLBACK_NOTHING), or when the plan changed so the older version no
 * longer fits it (ROLLBACK_STALE, the same test as ensurePlaybook's).
 */
export async function improveRollbackHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<PlaybookRecord> {
  requireAppChannel(ctx, 'venture.improve.rollback');
  const body = exactPayload(payload, ['playbookId', 'digest'], ['playbookId', 'digest']);
  const playbookId = identifier(body.playbookId, 'Playbook');
  check(typeof body.digest === 'string' && /^[a-f0-9]{64}$/.test(body.digest), 'INVALID_VENTURE_REQUEST', 'Send the digest of the version you saw in use.');
  const approved = body.digest;
  readAs(deps, ctx, 'approve');
  return ventureAction(deps, ctx, 'approve', 'improve.rollback', tx => {
    const venture = tx.venture!;
    const current = currentPlaybook(tx.state, venture);
    const parent = tx.find('venture-playbook', playbookId);
    check(current && current.origin === 'improvement' && current.parentId === playbookId && parent, 'ROLLBACK_NOTHING',
      'The version in use did not come from an improvement of that version, so there is nothing to go back to.');
    check(current.hash === approved, 'APPROVAL_STALE', 'The version in use changed since you read it. Read it again.');
    const blueprint = findRecord(tx.state, 'venture-blueprint', venture.acceptedBlueprintId ?? '');
    check(blueprint && fits(parent, blueprint, venture), 'ROLLBACK_STALE', 'Your plan changed since that version, so it no longer fits. Run the loop again instead.');
    const kept = keptBy(tx.state, tx.list('venture-improvement-run'), current);
    if (kept) tx.replace({ ...kept, rolledBack: { at: tx.now, by: ctx.memberId } });
    tx.touch({ playbookId: parent.id });
    tx.emit('playbook-adopted', { playbookId: parent.id, version: parent.version, hash: parent.hash, rolledBack: true, fromPlaybookId: current.id });
    return parent;
  });
}

