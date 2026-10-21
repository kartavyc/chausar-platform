// Chausar venture launcher, evidence ledger (P2-evidence): fixed weights per evidence type, and the pure scoring that
// turns them into verified, strong or weak. After trycompai/crm (MIT), apps/agent/agent/lib/evidence.ts: the weights
// are a fixed table, never a model's confidence. Chausar adds the step that CRM lacks: a claimed type counts only when
// a real tool result in the run backs it (backs below), and the claim labels observed / inferred / needs-your-data
// follow youtubepro's (Apache-2.0) observed / inferred / requires-studio.
import type { EvidenceItem, ToolCallRecord } from '../contracts.ts';

export type EvidenceStrength = EvidenceItem['strength'];
export type EvidenceClaim = EvidenceItem['claim'];
type Weighting = { weightBp: number; primary: boolean; claim: EvidenceClaim; label: string };

/**
 * Each type's weight in basis points, whether it is a primary source (needed for verified), the claim it makes, and
 * the plain words the owner reads. Order is strongest first.
 */
export const EVIDENCE_TYPES = Object.freeze({
  'owner-entered': { weightBp: 10000, primary: true, claim: 'observed', label: 'You entered this' },
  'tool-verified': { weightBp: 9000, primary: true, claim: 'observed', label: 'A calculator result in the run' },
  document: { weightBp: 8000, primary: true, claim: 'observed', label: 'Read from a file in the run' },
  'web-page': { weightBp: 4000, primary: false, claim: 'observed', label: 'A web page in the run says so' },
  'model-inferred': { weightBp: 2000, primary: false, claim: 'inferred', label: 'The AI wrote this, and no tool checked it' },
} as const satisfies Record<string, Weighting>);
export type EvidenceType = keyof typeof EVIDENCE_TYPES;
export const EVIDENCE_TYPE_IDS: readonly EvidenceType[] = Object.freeze(Object.keys(EVIDENCE_TYPES) as EvidenceType[]);

/** Score floors in basis points. Verified also needs a primary source: you, a calculator result or a file. */
export const STRENGTH_FLOORS = Object.freeze({ verified: 8500, strong: 5500 });

/** One piece of support for a value: its type and where it came from, counted once per type and ref (AI words once in all). */
export type Support = { type: EvidenceType; ref: string };

/**
 * Combines the weights as one minus the product of (one minus each weight), in whole basis points, so two files that
 * agree verify a value that one file only makes strong. Web pages and AI words alone never verify.
 */
export function scoreEvidence(support: readonly Support[]): { scoreBp: number; strength: EvidenceStrength } {
  const seen = new Set<string>();
  let remaining = 10000;
  let primary = false;
  for (const item of support) {
    // The AI saying a thing again is not new evidence: all of its inferences count once.
    const key = item.type === 'model-inferred' ? item.type : `${item.type}|${item.ref}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const weighting: Weighting = EVIDENCE_TYPES[item.type];
    remaining = Math.floor(remaining * (10000 - weighting.weightBp) / 10000);
    primary ||= weighting.primary;
  }
  const scoreBp = seen.size ? 10000 - remaining : 0;
  const strength: EvidenceStrength = scoreBp >= STRENGTH_FLOORS.verified && primary ? 'verified' : scoreBp >= STRENGTH_FLOORS.strong ? 'strong' : 'weak';
  return { scoreBp, strength };
}

/**
 * Whether one tool result in a run can back a claimed type: a file the run read for a document, the calculator for a
 * tool-verified value. No web tool exists in this build, so nothing backs a web page yet. Agent-written sandbox code is
 * not the calculator, so it backs nothing here.
 */
export function backs(type: EvidenceType, call: ToolCallRecord): boolean {
  if (call.outcome !== 'succeeded' || !call.envelope.ok) return false;
  if (type === 'document') return call.tool === 'files.read';
  if (type === 'tool-verified') return call.effect === 'compute';
  if (type === 'web-page') return call.tool.startsWith('web.');
  return false;
}

/** Why a claimed type was not accepted, in the owner's words. */
export const UNCHECKED: Readonly<Record<EvidenceType, string>> = Object.freeze({
  'owner-entered': 'the AI said you entered this, but you did not.',
  'tool-verified': 'the AI said the calculator checked this, but no calculator result in the run backs it.',
  document: 'the AI said it read this in a file, but no file read in the run backs it.',
  'web-page': 'the AI said a web page shows this, but Chausar has no web tool yet.',
  'model-inferred': '',
});
