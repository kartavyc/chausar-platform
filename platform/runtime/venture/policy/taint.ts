// Chausar venture launcher, policy (Ink v2 wave 1, H10): the taint latch.
// Every result an agent tool returns carries an integrity label: trusted, or untrusted when it carries outside content
// (a client's file, a heavy-work tool's output, a client's answer the owner relays). The first untrusted result
// latches the run, and nothing unlatches it. From then on any call that writes, sends, reaches outside, moves money or
// reads private data needs the owner's approval of that exact call, at every posture, standing consent and a turn
// approval included (policy/ladder.ts). Reading and working on the run's own files go on as before.
// The latch follows odysseus src/tool_capabilities.py and THREAT_MODEL.md (learn only, AGPL) and omnigent
// policies/builtins/risk_score.py; this is a rewrite, not a copy.
import type { ResultIntegrity, TaintMark, WorkRunRef } from '../contracts.ts';
import { classifyEffects, toolDeclaration, type EffectKind } from './effects.ts';
import type { PolicyAction } from './floor.ts';

export const INTEGRITY_LABELS = ['trusted', 'untrusted'] as const;
/** Effects a latched run may use only with the owner's approval of the exact call. */
export const LATCHED_EFFECTS: readonly EffectKind[] = Object.freeze(['private-read', 'write', 'send', 'egress', 'money']);
export const TAINT_WORDS = 'This run read outside content, so anything that writes, sends or reaches outside waits for you.';

/**
 * The label on one tool's result in this run. A tool Chausar does not ship is never trusted. A tool that echoes the
 * order's files is trusted only in a run on made-up clients whose files Chausar wrote itself; a real order is never
 * made up, whatever its files say.
 */
export function resultIntegrity(tool: string, run: { runRef: WorkRunRef; files: readonly { clientData: boolean }[] }): ResultIntegrity {
  const declared = toolDeclaration(tool);
  if (!declared) return 'untrusted';
  if (declared.integrity === 'trusted') return 'trusted';
  const madeUp = run.runRef.kind !== 'delivery' && run.files.every(file => file.clientData === false);
  return madeUp && declared.source === 'client-file' ? 'trusted' : 'untrusted';
}

/** The run's mark after one result: the first untrusted result sets it, and a set mark never changes. */
export function latchTaint(
  taint: TaintMark | null | undefined,
  step: { integrity: ResultIntegrity | null | undefined; turn: number; source: TaintMark['source']; toolCallId: string | null; tool: string | null },
): TaintMark | null {
  if (taint) return taint;
  if (step.integrity !== 'untrusted') return null;
  return { turn: step.turn, source: step.source, toolCallId: step.toolCallId, tool: step.tool };
}

/** The effects the latch holds for this tool call: none while the run is clean, else its latched effects. */
export function latchedBy(action: PolicyAction, taint: TaintMark | null | undefined): EffectKind[] {
  if (!taint || action.phase !== 'tool-call') return [];
  const { effects } = classifyEffects({ name: action.name, effect: action.effect ?? null, input: action.input ?? null, connector: action.connector ?? null, http: action.http ?? null });
  return effects.filter(kind => LATCHED_EFFECTS.includes(kind));
}
