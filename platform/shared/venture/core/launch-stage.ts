// Chausar venture launcher, core (wave 6, 6C4 / D19): the two launch stages the owner sees.
// Practice: the AI drafts real orders as practice drafts that can never reach a client, and made-up clients can be
// rehearsed. Live (you approve each): the owner approves each draft before it reaches a client.
// The vault still stores the older stage names, so old businesses keep working: 'rehearsal' and 'shadow' both read as
// Practice and 'approve-each' reads as Live. The two unfinished stages ('approve-sample', 'auto-spot-check') are never
// shown and never reached from the app; an AI never drafts at them. Pure and import-free (not even types), so the fake
// engine in the browser uses the same module without pulling the engine's contracts into the app.
/** The stage names the vault stores (contracts.ts LAUNCH_STAGES). */
export type StoredLaunchStage = 'rehearsal' | 'shadow' | 'approve-each' | 'approve-sample' | 'auto-spot-check';

export const OWNER_STAGES = ['practice', 'live'] as const;
export type OwnerStage = typeof OWNER_STAGES[number];

/** What the vault stores when the owner moves to each stage. */
export const STORED_STAGE: Readonly<Record<OwnerStage, StoredLaunchStage>> = Object.freeze({ practice: 'rehearsal', live: 'approve-each' });

/** Practice: real orders get practice drafts only. Shadow was folded into Practice in wave 6. */
export function isPracticeStage(stage: StoredLaunchStage | string | null | undefined): boolean {
  return stage === 'rehearsal' || stage === 'shadow';
}

/** Live: the owner approves each draft before it reaches a client. */
export function isLiveStage(stage: StoredLaunchStage | string | null | undefined): boolean {
  return stage === 'approve-each';
}

/** The stage the owner sees. Anything that is not Live reads as Practice, the safe side. */
export function ownerStageOf(stage: StoredLaunchStage | string | null | undefined): OwnerStage {
  return isLiveStage(stage) ? 'live' : 'practice';
}

/** The stages at which an agent may draft for a real order: Practice and Live. Moving down is always allowed. */
export function agentMayDraft(stage: StoredLaunchStage | string | null | undefined): boolean {
  return isPracticeStage(stage) || isLiveStage(stage);
}
