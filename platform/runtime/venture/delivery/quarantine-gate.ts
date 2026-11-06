// Chausar venture launcher, delivery (Ink v2 wave 4, package 4A1; catalogue A20): the team's quarantine as delivery
// checks it. A quarantined agent, or a quarantined team, starts no run and its runs in flight stop advancing: the run
// that would start, an approved turn about to run its tools, an answer and a heavy-work brief are refused with
// AGENT_QUARANTINED, before the work and again in the commit that would store it. The check itself lives with the team
// view (views/team.ts installs it when it loads), so this file imports no view: a handler awaits loadQuarantineCheck()
// once, then refuseQuarantined() works inside any transaction. A check that never loaded refuses (fails closed).
import { check, type State } from '../../contracts.ts';
import type { VentureRecord } from '../contracts.ts';

/** The team's quarantine in words at a moment ('Packager is quarantined: ... Clear it on Team first.'), or null. */
export type QuarantineCheck = (state: State, venture: VentureRecord, nowIso: string) => string | null;

let installed: QuarantineCheck | null = null;
const NOT_LOADED = "Chausar could not check the team's health, so no work moves on. Try again.";

/** views/team.ts calls this when it loads. */
export function installQuarantineCheck(gate: QuarantineCheck): void {
  installed = gate;
}

/** Loads the team view once, so the check is in place before a handler opens its commit. */
export async function loadQuarantineCheck(): Promise<void> {
  if (!installed) await import('../views/team.ts');
}

/** AGENT_QUARANTINED, with the reason, when the team or one of its agents is quarantined at this moment. */
export function refuseQuarantined(state: State, venture: VentureRecord, nowIso: string): void {
  check(installed, 'AGENT_QUARANTINED', NOT_LOADED);
  const line = installed(state, venture, nowIso);
  check(line === null, 'AGENT_QUARANTINED', line ?? '');
}
