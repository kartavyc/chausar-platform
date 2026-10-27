// Chausar venture launcher, delivery package (P5): the launch ladder.
// rehearsal -> shadow (practice drafts) -> approve each draft. Approving a sample is planned. Auto with spot checks is
// built but locked (Ink v2 wave 4, 4J15, the founder's decision): it always answers AUTO_LOCKED (policy/auto-lock.ts).
// Each stage changes what the owner can do; shadow needs a passing rehearsal that a real model wrote and a judge answered.
import { check, type Context, type State } from '../../contracts.ts';
import { exactPayload, listRecords, requireAppChannel, ventureAction } from '../records.ts';
import { LAUNCH_STAGES } from '../contracts.ts';
import type { ImprovementReadiness, LaunchStage, LaunchStatus, SimulationRunRecord, VentureDeps, VentureRecord } from '../contracts.ts';
import { NOT_JUDGED_REASON } from './judge.ts';
import { expectedPlaybookHash } from './playbook.ts';
import { businessScenarios } from './scenarios.ts';
import { acceptedBlueprintOrNull, newestFirst, readAs, serviceTypeOf } from './shared.ts';
import { AUTO_LOCKED_WORDS, autoLocked } from '../policy/auto-lock.ts';

export const REASON_CONNECT_AI = "Connect an AI and rehearse with it first. Template outlines can't be judged.";
export const REASON_REHEARSE_ALL = 'Rehearse all three practice clients with the current playbook.';
export const REASON_TEMPLATE_DRAFTS = "Template outlines can't be judged. Rehearse each practice client with your AI writing the drafts.";
export const REASON_NO_JUDGE = 'Your AI wrote the drafts, but no AI judged them. Connect an AI for quick work, then rehearse again.';
export const REASON_NOT_JUDGED = 'Your last rehearsal was not judged. Run it again with your AI.';
export const REASON_PASS_ALL = 'Every practice client must pass. Rehearse the ones that failed again.';
export const REASON_SAMPLE_PLANNED = 'Planned. Needs a sampling rule first.';
/** 4J15: auto with spot checks is built but locked; readiness (venture.auto.readiness) never opens it. */
export const REASON_AUTO_LOCKED = AUTO_LOCKED_WORDS;
const PLANNED_STAGES: readonly LaunchStage[] = ['approve-sample'];
const DAY_MS = 86_400_000;

type Row = LaunchStatus['rehearsal'][number];
/** A ladder row with the run it came from, kept inside this file so the reason can say why a row did not count. */
type RowWithRun = { row: Row; run: SimulationRunRecord | null };

function scenarioEpisodes(run: SimulationRunRecord, scenarioId: string) {
  return run.episodes.filter(episode => episode.scenarioId === scenarioId);
}

/** Whether one scenario's episodes in a run were written by a model and answered by a judge. */
function scenarioJudged(run: SimulationRunRecord, scenarioId: string): boolean {
  if (run.modelMode === 'template') return false;
  const episodes = scenarioEpisodes(run, scenarioId);
  if (!episodes.length) return false;
  return episodes.every(episode => {
    const agentTurns = episode.turns.filter(turn => turn.by === 'agent');
    return agentTurns.length > 0 && agentTurns.every(turn => turn.author === 'model')
      && episode.judge.length > 0 && episode.judge.every(answer => answer.answer !== 'not-judged');
  });
}

function rehearsalRows(state: State, venture: VentureRecord): RowWithRun[] {
  const blueprint = acceptedBlueprintOrNull(state, venture);
  const type = serviceTypeOf(state, venture);
  let currentHash: string | null = null;
  // A plan without a drafting step has no playbook, so no rehearsal counts for it. The hash is the one ensurePlaybook
  // would use now: the current playbook when it fits the plan, else a fresh build with the adopted patches.
  try { currentHash = blueprint ? expectedPlaybookHash(state, venture, blueprint) : null; } catch { currentHash = null; }
  const runs = newestFirst(listRecords(state, 'venture-simulation-run', venture.id)).filter(run => currentHash !== null && run.playbookHash === currentHash);
  return businessScenarios(state, venture.id, type).map(scenario => {
    const run = runs.find(item => item.scenarioIds.includes(scenario.id));
    if (!run) return { row: { scenarioId: scenario.id, runId: null, passed: null, judged: false }, run: null };
    const episodes = scenarioEpisodes(run, scenario.id);
    return {
      row: { scenarioId: scenario.id, runId: run.id, passed: episodes.length > 0 && episodes.every(episode => episode.passed), judged: scenarioJudged(run, scenario.id) },
      run,
    };
  });
}

/** Why one rehearsed practice client was not judged, in words that match what the run really did. */
function notJudgedReason(run: SimulationRunRecord, scenarioId: string): string {
  // Rehearsed by templates alone while others used an AI: the spec's words still fit.
  if (run.modelMode === 'template') return REASON_REHEARSE_ALL;
  const episodes = scenarioEpisodes(run, scenarioId);
  // An AI took part (the practice client or the judge) but templates wrote the drafts.
  if (episodes.some(episode => episode.turns.some(turn => turn.by === 'agent' && turn.author === 'template'))) return REASON_TEMPLATE_DRAFTS;
  // The judge was off because templates serve quick work (the fast tier), not because the draft failed.
  const noJudge = episodes.some(episode => episode.judge.some(answer => answer.answer === 'not-judged' && answer.reason === NOT_JUDGED_REASON));
  return noJudge ? REASON_NO_JUDGE : REASON_NOT_JUDGED;
}

/**
 * Why shadow is not open yet. "Connect an AI" only when every practice client with a run was rehearsed by templates
 * alone; an owner who rehearsed with an AI is told what went wrong instead.
 */
function blockedReason(entries: readonly RowWithRun[]): string {
  const ran = entries.filter(entry => entry.run !== null);
  if (ran.length > 0 && ran.every(entry => entry.run!.modelMode === 'template')) return REASON_CONNECT_AI;
  if (ran.length < entries.length) return REASON_REHEARSE_ALL;
  const unjudged = ran.find(entry => !entry.row.judged);
  if (unjudged) return notJudgedReason(unjudged.run!, unjudged.row.scenarioId);
  return REASON_PASS_ALL;
}

function improvement(state: State, ventureId: string, now: Date): ImprovementReadiness {
  const verdicts = listRecords(state, 'venture-delivery-run', ventureId).filter(run => run.verdict !== null).map(run => run.verdict!);
  const judged = verdicts.length;
  const rejectedOrEdited = verdicts.filter(verdict => verdict.choice !== 'accepted').length;
  const first = verdicts.map(verdict => verdict.at).sort()[0];
  const longEnough = first !== undefined && now.getTime() - Date.parse(first) >= 14 * DAY_MS;
  const due = (judged >= 10 && rejectedOrEdited >= 3) || (judged >= 1 && longEnough);
  return {
    judged, rejectedOrEdited, due, status: 'available',
    reason: due
      ? 'There are enough reviewed drafts to improve the playbook. The improvement loop tries one change and keeps it only if it wins.'
      : 'The improvement loop can run once a draft was rejected or edited, a check failed or a rehearsal failed. It learns more from more reviewed drafts.',
  };
}

/** The ladder as of now, worked out from the vault only. Never writes. */
export function computeLaunchStatus(state: State, venture: VentureRecord, now: Date): LaunchStatus {
  const entries = rehearsalRows(state, venture);
  const rows = entries.map(entry => entry.row);
  const rehearsedWithAi = rows.every(row => row.passed === true && row.judged);
  const reason = blockedReason(entries); // used only while not rehearsed with your AI
  const current = LAUNCH_STAGES.indexOf(venture.launchStage);
  const stages: LaunchStatus['stages'] = LAUNCH_STAGES.map((stage, index) => {
    if (stage === 'approve-sample') return { stage, allowed: false, reason: REASON_SAMPLE_PLANNED, status: 'planned' };
    if (stage === 'auto-spot-check') return { stage, allowed: false, reason: REASON_AUTO_LOCKED, status: 'available' };
    if (stage === 'rehearsal') return { stage, allowed: true, reason: 'Made-up clients only. A real order gets a template outline, not an agent draft.', status: 'available' };
    if (index <= current) {
      return { stage, allowed: true, reason: stage === 'shadow' ? 'Agent drafts for real orders are practice drafts that cannot reach a client.' : 'You approve each draft before you copy it to a client.', status: 'available' };
    }
    if (stage === 'shadow') {
      return rehearsedWithAi
        ? { stage, allowed: true, reason: 'Agent drafts for real orders are practice drafts that cannot reach a client.', status: 'available' }
        : { stage, allowed: false, reason, status: 'available' };
    }
    if (!rehearsedWithAi) return { stage, allowed: false, reason, status: 'available' };
    if (current < LAUNCH_STAGES.indexOf('shadow')) return { stage, allowed: false, reason: 'Move to shadow first.', status: 'available' };
    return { stage, allowed: true, reason: 'You approve each draft before you copy it to a client.', status: 'available' };
  });
  const runs = newestFirst(listRecords(state, 'venture-simulation-run', venture.id));
  const deliveries = listRecords(state, 'venture-delivery-run', venture.id);
  return {
    stage: venture.launchStage,
    stages,
    rehearsal: rows,
    lastRunId: runs[0]?.id ?? null,
    lastRunPassed: runs[0]?.passed ?? null,
    acceptedDeliveries: deliveries.filter(run => run.verdict?.choice === 'accepted' && run.servedBy === 'model' && !run.practice).length,
    improvement: improvement(state, venture.id, now),
  };
}

export async function launchStatusHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<LaunchStatus> {
  exactPayload(payload, []);
  const { state, venture } = readAs(deps, ctx, 'read');
  return computeLaunchStatus(state, venture, deps.clock());
}

/** venture.launch.advance: down any time; up one allowed stage at a time; the planned stage never; auto is locked (AUTO_LOCKED). */
export async function launchAdvanceHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<LaunchStatus> {
  requireAppChannel(ctx, 'venture.launch.advance');
  const body = exactPayload(payload, ['to'], ['to']);
  check(typeof body.to === 'string' && (LAUNCH_STAGES as readonly string[]).includes(body.to), 'INVALID_VENTURE_REQUEST', 'Choose a launch stage.');
  const to = body.to as LaunchStage;
  autoLocked(to);
  check(!PLANNED_STAGES.includes(to), 'STAGE_PLANNED', REASON_SAMPLE_PLANNED);
  readAs(deps, ctx, 'approve');
  return ventureAction(deps, ctx, 'approve', 'launch.advance', tx => {
    const venture = tx.venture!;
    const now = new Date(tx.now);
    const from = venture.launchStage;
    if (from === to) return computeLaunchStatus(tx.state, venture, now);
    const before = computeLaunchStatus(tx.state, venture, now);
    const fromIndex = LAUNCH_STAGES.indexOf(from), toIndex = LAUNCH_STAGES.indexOf(to);
    if (toIndex > fromIndex) {
      check(toIndex === fromIndex + 1, 'LAUNCH_STAGE_BLOCKED', 'Move up one stage at a time.');
      const target = before.stages.find(stage => stage.stage === to)!;
      check(target.allowed, 'LAUNCH_STAGE_BLOCKED', target.reason);
    }
    const status = to === 'approve-each' ? 'live' : venture.status === 'live' ? 'rehearsal' : venture.status;
    const updated = tx.touch({ launchStage: to, status });
    tx.emit('launch-stage-changed', { from, to });
    return computeLaunchStatus(tx.state, updated, now);
  });
}
