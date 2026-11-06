// Chausar playbook kit (wave 6, 6C5): the owner's standing rule attestations in one business, read from its records.
// Only records: no playbook definitions are loaded here, so any guard can import it without an import cycle. A guard
// checks the attestation against the words of the rule it holds (kit/attestation.ts ruleCleared), so a changed rule
// asks again. Withdrawn attestations do not count. An empty map keeps every lock closed.
import type { State } from '../../../contracts.ts';
import { currentVenture, listRecords } from '../../records.ts';
import type { AttestedRules } from './attestation.ts';

export function attestedRules(state: State, ventureId: string): AttestedRules {
  const latest = new Map<string, { digest: string; withdrawn: boolean }>();
  for (const record of listRecords(state, 'venture-rule-attestation', ventureId)) latest.set(record.ruleId, { digest: record.digest, withdrawn: !!record.withdrawnAt });
  const map = new Map<string, string>();
  for (const [ruleId, entry] of latest) if (!entry.withdrawn) map.set(ruleId, entry.digest);
  return map;
}

/** The open business's standing attestations, read from the store now (one business per vault). */
export function attestedNow(deps: { store: { read(): State } }): AttestedRules {
  const state = deps.store.read();
  const venture = currentVenture(state);
  return venture ? attestedRules(state, venture.id) : new Map<string, string>();
}
