// Chausar venture launcher, core (P1): read-only lookups over venture records in a state snapshot or draft.
import { check, type State } from '../../contracts.ts';
import { findRecord, listRecords } from '../records.ts';
import type { BlueprintRecord, BlueprintView, InterviewRecord, PlaybookPick, PriceReceiptRecord } from '../contracts.ts';
import type { CompositionRecord } from '../onboarding-contracts.ts';
import { pickPlaybook } from '../playbooks/registry.ts';

/**
 * The flagship playbook an idea picks, as the screens show it. An empty object when none fits, so a view spreads it
 * and the field is simply absent. Worked out from the idea each time, never stored, so no record or digest changes.
 */
export function playbookField(idea: string): { playbook?: PlaybookPick } {
  const pick = pickPlaybook(idea);
  return pick ? { playbook: { id: pick.id, label: pick.label } } : {};
}

/** The venture's interview record (one per venture, made at create). */
export function interviewOf(state: State, ventureId: string): InterviewRecord {
  const all = listRecords(state, 'venture-interview', ventureId);
  check(all.length > 0, 'VENTURE_NOT_FOUND', 'Start a business first.');
  return all[all.length - 1];
}

/** The plan the AI composed before the vault, kept at create; null for a venture made from the built-in templates. */
export function compositionOf(state: State, ventureId: string): CompositionRecord | null {
  const all = listRecords(state, 'venture-composition', ventureId);
  return all.length ? all[all.length - 1] : null;
}

export function blueprintsOf(state: State, ventureId: string): BlueprintRecord[] {
  return listRecords(state, 'venture-blueprint', ventureId).slice().sort((a, b) => a.version - b.version);
}

/** The newest blueprint version, draft or accepted, or null before the first draft. */
export function latestBlueprint(state: State, ventureId: string): BlueprintRecord | null {
  const all = blueprintsOf(state, ventureId);
  return all.length ? all[all.length - 1] : null;
}

export function nextBlueprintVersion(state: State, ventureId: string): number {
  return blueprintsOf(state, ventureId).reduce((max, b) => Math.max(max, b.version), 0) + 1;
}

/**
 * For each offer, the newest price receipt whose subject is that offer and which priced exactly this version
 * (inputs.blueprintDigest equals the blueprint digest), else null. The digest leaves out status, so a receipt
 * made for a draft stays current once that same version is accepted.
 */
export function offerReceipts(state: State, blueprint: BlueprintRecord): Record<string, PriceReceiptRecord | null> {
  const receipts = listRecords(state, 'venture-price-receipt', blueprint.ventureId);
  const result: Record<string, PriceReceiptRecord | null> = {};
  for (const offer of blueprint.offers) {
    let found: PriceReceiptRecord | null = null;
    for (const receipt of receipts) {
      if (receipt?.subject?.type === 'offer' && receipt.subject.offerId === offer.id && receipt.inputs?.blueprintDigest === blueprint.digest) found = receipt;
    }
    result[offer.id] = found;
  }
  return result;
}

export function blueprintView(state: State, blueprint: BlueprintRecord): BlueprintView {
  const venture = findRecord(state, 'venture-record', blueprint.ventureId);
  return { blueprint, offerReceipts: offerReceipts(state, blueprint), ...(venture ? playbookField(venture.idea) : {}) };
}
