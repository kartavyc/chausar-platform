// The fake engine's launch stages (wave 6, 6C4 / D19), answering exactly as delivery/launch.ts does: two stages the
// owner sees, Practice and Live (you approve each); Live needs an accepted plan and a connected AI; moving down is
// always allowed; the unfinished stages are refused (auto with AUTO_LOCKED). The stage words and the stored names come
// from the engine's own pure module, so the two cannot drift.
import { EngineError, type LaunchStatusView } from './types';
import { OWNER_STAGES, STORED_STAGE, ownerStageOf } from '../../../../platform/shared/venture/core/launch-stage.ts';
import type { OwnerStage } from '../../../../platform/runtime/venture/core/launch-stage.ts';

export const LAUNCH_WORDS = {
  connectAi: 'Connect your AI first.',
  acceptPlan: 'Accept your plan first.',
  practice: 'Real orders get practice drafts that never reach clients.',
  live: 'You approve each draft before it reaches a client.',
  choose: 'Choose Practice or Live.',
  autoLocked: 'Routine-step approval is not available yet.',
} as const;

/** What the fake knows about the open business when it answers. */
export type LaunchFacts = { stored: string; liveSince: string | null; accepted: boolean; connected: boolean; acceptedDeliveries: number };

function blockedOf(facts: LaunchFacts): string | null {
  if (!facts.accepted) return LAUNCH_WORDS.acceptPlan;
  if (!facts.connected) return LAUNCH_WORDS.connectAi;
  return null;
}

export function fakeLaunchStatus(facts: LaunchFacts): LaunchStatusView {
  const stage = ownerStageOf(facts.stored);
  const blocked = blockedOf(facts);
  const open = stage === 'live' || blocked === null;
  return {
    stage,
    liveSince: stage === 'live' ? facts.liveSince : null,
    stages: [
      { stage: 'practice', allowed: true, reason: LAUNCH_WORDS.practice, current: stage === 'practice' },
      { stage: 'live', allowed: open, reason: open ? LAUNCH_WORDS.live : blocked!, current: stage === 'live' },
    ],
    acceptedDeliveries: facts.acceptedDeliveries,
    improvement: {
      judged: 0, rejectedOrEdited: 0, due: false, status: 'available',
      reason: 'The improvement loop can run once a draft was rejected or edited, a check failed or a rehearsal failed. It learns more from more reviewed drafts.',
    },
  };
}

/** venture.launch.advance: returns the stored stage to keep, or throws the engine's code and words. */
export function fakeLaunchAdvance(facts: LaunchFacts, p: Record<string, unknown>): string {
  const keys = Object.keys(p);
  if (keys.length !== 1 || keys[0] !== 'to') throw new EngineError('INVALID_VENTURE_REQUEST', 'Send the required fields and nothing else.');
  if (p.to === 'auto-spot-check') throw new EngineError('AUTO_LOCKED', LAUNCH_WORDS.autoLocked);
  if (typeof p.to !== 'string' || !(OWNER_STAGES as readonly string[]).includes(p.to)) throw new EngineError('INVALID_VENTURE_REQUEST', LAUNCH_WORDS.choose);
  const to = p.to as OwnerStage;
  if (ownerStageOf(facts.stored) === to) return facts.stored;
  if (to === 'live') {
    const blocked = blockedOf(facts);
    if (blocked) throw new EngineError('LAUNCH_STAGE_BLOCKED', blocked);
  }
  return STORED_STAGE[to];
}
