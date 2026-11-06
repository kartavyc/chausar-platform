// Chausar venture launcher, delivery package: the launch stages (wave 6, 6C4 / D19).
// The owner sees two stages: Practice and Live (you approve each). In Practice the AI drafts real orders as practice
// drafts that never reach a client. In Live the owner approves each draft before it reaches a client. Shadow was folded
// into Practice; approving a sample and auto with spot checks are not finished, so they are hidden and never reached
// from the app (auto still answers AUTO_LOCKED, policy/auto-lock.ts). The rehearsal gate of the retired per-turn loop
// (three judged made-up clients before real orders) is gone. The checks kept: an accepted plan and a connected AI,
// the same AI check that decides whether a real order gets an AI draft or a template outline (runs.ts).
import { check, type Context, type State } from '../../contracts.ts';
import { exactPayload, listRecords, requireAppChannel, ventureAction } from '../records.ts';
import type { ImprovementReadiness, LaunchStatus, VentureDeps, VentureRecord } from '../contracts.ts';
import { acceptedBlueprintOrNull, readAs } from './shared.ts';
import { autoLocked } from '../policy/auto-lock.ts';
import { OWNER_STAGES, STORED_STAGE, ownerStageOf, type OwnerStage } from '../core/launch-stage.ts';

export const REASON_CONNECT_AI = 'Connect your AI first.';
export const REASON_ACCEPT_PLAN = 'Accept your plan first.';
export const PRACTICE_LINE = 'Real orders get practice drafts that never reach clients.';
export const LIVE_LINE = 'You approve each draft before it reaches a client.';
const CHOOSE_STAGE = 'Choose Practice or Live.';
const DAY_MS = 86_400_000;

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
      ? 'There are enough reviewed drafts to improve the work plan. The improvement loop tries one change and keeps it only if it wins.'
      : 'The improvement loop can run once a draft was rejected or edited, a check failed or a rehearsal failed. It learns more from more reviewed drafts.',
  };
}

/** Whether a real order would get an AI draft now: the same test delivery.run uses (runs.ts). */
export function aiConnected(deps: VentureDeps, ctx: Context): boolean {
  try {
    const main = deps.models.status(ctx).tiers.main;
    return main.usable !== false && main.presetId !== 'built-in-templates';
  } catch {
    return false;
  }
}

/** Why Live is not open now, or null when it is. Moving down to Practice is always open. */
function liveBlocked(state: State, venture: VentureRecord, connected: boolean): string | null {
  if (!acceptedBlueprintOrNull(state, venture)) return REASON_ACCEPT_PLAN;
  if (!connected) return REASON_CONNECT_AI;
  return null;
}

/** The two stages as of now, worked out from the vault and whether an AI is connected. Never writes. */
export function computeLaunchStatus(state: State, venture: VentureRecord, now: Date, connected = false): LaunchStatus {
  const stage = ownerStageOf(venture.launchStage);
  const blocked = liveBlocked(state, venture, connected);
  const open = stage === 'live' || blocked === null;
  const deliveries = listRecords(state, 'venture-delivery-run', venture.id);
  return {
    stage,
    liveSince: stage === 'live' ? venture.liveSince ?? null : null,
    stages: [
      { stage: 'practice', allowed: true, reason: PRACTICE_LINE, current: stage === 'practice' },
      { stage: 'live', allowed: open, reason: open ? LIVE_LINE : blocked!, current: stage === 'live' },
    ],
    acceptedDeliveries: deliveries.filter(run => run.verdict?.choice === 'accepted' && run.servedBy === 'model' && !run.practice).length,
    improvement: improvement(state, venture.id, now),
  };
}

export async function launchStatusHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<LaunchStatus> {
  exactPayload(payload, []);
  const { state, venture } = readAs(deps, ctx, 'read');
  return computeLaunchStatus(state, venture, deps.clock(), aiConnected(deps, ctx));
}

/**
 * venture.launch.advance { to: 'practice' | 'live' } (approve, app only): down to Practice any time; up to Live with an
 * accepted plan and a connected AI. The hidden stages are refused: auto with AUTO_LOCKED, anything else as a bad request.
 */
export async function launchAdvanceHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<LaunchStatus> {
  requireAppChannel(ctx, 'venture.launch.advance');
  const body = exactPayload(payload, ['to'], ['to']);
  if (typeof body.to === 'string') autoLocked(body.to);
  check(typeof body.to === 'string' && (OWNER_STAGES as readonly string[]).includes(body.to), 'INVALID_VENTURE_REQUEST', CHOOSE_STAGE);
  const to = body.to as OwnerStage;
  readAs(deps, ctx, 'approve');
  const connected = aiConnected(deps, ctx);
  return ventureAction(deps, ctx, 'approve', 'launch.advance', tx => {
    const venture = tx.venture!;
    const now = new Date(tx.now);
    if (ownerStageOf(venture.launchStage) === to) return computeLaunchStatus(tx.state, venture, now, connected);
    if (to === 'live') {
      const blocked = liveBlocked(tx.state, venture, connected);
      check(blocked === null, 'LAUNCH_STAGE_BLOCKED', blocked ?? '');
    }
    const status = to === 'live' ? 'live' : venture.status === 'live' ? 'rehearsal' : venture.status;
    const updated = tx.touch({ launchStage: STORED_STAGE[to], status, liveSince: to === 'live' ? tx.now : null });
    tx.emit('launch-stage-changed', { from: venture.launchStage, to: STORED_STAGE[to] });
    return computeLaunchStatus(tx.state, updated, now, connected);
  });
}
