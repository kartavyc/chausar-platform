// Chausar delivery harness (Ink v2 wave 4, package 4F2): one repair turn (catalogue H35). When the AI answers an act
// turn in a shape Chausar cannot read, the run does not fail at once: it gets exactly one repair turn, which says what
// could not be read and asks for the same shape again. That turn is previewed and waits for the owner's approval like
// any other, and its cost is held against the run's spend cap like any call (the failed answer's cost counts too). A
// second bad shape for the same turn fails the run with that reason; there is no third try. The write step is not
// repaired: its answer is checked against the proven work, and a bad one fails as before.
// One repair turn for a malformed tool call, then stop, follows Qwen-CUA's protocol (demo/src/qwen_cua/protocol.py);
// this is a rewrite, not a copy.
import type { HarnessState } from '../../contracts.ts';

/** The repair turn's words to the agent, in Chausar's own fixed words; what could not be read is in the input (D2). */
export const REPAIR_LINE = 'Your last answer could not be read; why is given as repair in the input. Answer again in the same shape.';
/** Why a run fails when the repair turn came back in a bad shape too. */
export const REPAIRED_TWICE = (reason: string): string => `Your AI answered twice in a shape Chausar could not read: ${reason}`;

const sentence = (text: string) => { const words = text.replace(/\s+/g, ' ').trim().slice(0, 300); return /[.!?]$/.test(words) ? words : `${words}.`; };

/** What the repair turn says could not be read: only the turn being repaired, once (it rides in the input). */
export function repairReason(state: Pick<HarnessState, 'phase' | 'repairs' | 'used'>): string | null {
  if (state.phase !== 'act') return null;
  return (state.repairs ?? []).find(item => item.turn === state.used.turns + 1)?.reason ?? null;
}

/** The repair words the act turn carries: the fixed line, only on the turn being repaired, once. */
export function repairWords(state: Pick<HarnessState, 'phase' | 'repairs' | 'used'>): string | null {
  return repairReason(state) === null ? null : REPAIR_LINE;
}
