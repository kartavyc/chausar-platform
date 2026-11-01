// Chausar flagship playbooks: owner attestation of locked rules (wave 6, 6C5 / D20, D21).
// venture.rules.locks (read) lists the business's locked rules (a lawyer or CA would confirm them, nobody has), each with
// its plain words, what it does not cover, its sources and whether the owner attested it; then the hard stops, one line
// each, which never unlock. venture.rules.attest (approve, app only) records or withdraws the owner's tick
// "I am responsible for this in my business" with the date, bound to the rule's current words (a changed rule asks
// again). attestedRules is what every client-work check of the attestation playbooks reads (kit/attestation.ts).
// The CA firm's sign-off by the CA of record is a professional sign-off and stays on Your CA; it is never listed here.
import { check, type Context, type State } from '../../contracts.ts';
import type { LockedRuleView, RuleAttestationRecord, RuleLocksView, VentureDeps, VentureRecord } from '../contracts.ts';
import { exactPayload, listRecords, requireAppChannel, ventureAction } from '../records.ts';
import { readAs } from '../delivery/shared.ts';
import { localDayAt } from '../local-day.ts';
import { recordDecision } from '../journal/decisions.ts';
import { HARD_STOPS, isHardStop, refuseHardStop } from '../policy/hard-stops.ts';
import { kitDefinitions } from './kit/installed.ts';
import type { DatedRule } from './kit/define.ts';
import { ATTESTATION_PLAYBOOKS, ATTEST_WORDS, LOCKED_ELSEWHERE_LINE, NOT_ATTESTABLE_WORDS, ruleDigest, ruleIsLocked } from './kit/attestation.ts';
export { attestedRules } from './kit/attestation-records.ts';
import { businessFlagship } from './rules-view.ts';
import { findPlaybook } from './registry.ts';

const WHO = { lawyer: 'a lawyer', ca: 'a CA' } as const;
const CA_FIRM_LINE = 'Your CA of record signs off regulated papers on Your CA. Owner attestation does not replace that.';
const NOT_FOUND = 'Choose a rule that waits for you.';
const STALE = 'The rule changed. Read it again before you tick it.';

type Locked = { playbook: string; rule: DatedRule; digest: string };

/** Every locked rule of every installed kit playbook, with the digest of its current words. */
function lockedRules(): Locked[] {
  return kitDefinitions().flatMap(definition => definition.rules.filter(ruleIsLocked)
    .map(rule => ({ playbook: definition.registration.id, rule, digest: ruleDigest(rule) })));
}

/** The newest attestation record per rule in this business. */
function latestByRule(state: State, ventureId: string): Map<string, RuleAttestationRecord> {
  const latest = new Map<string, RuleAttestationRecord>();
  for (const record of listRecords(state, 'venture-rule-attestation', ventureId)) latest.set(record.ruleId, record);
  return latest;
}

function lockedView(item: Locked, record: RuleAttestationRecord | undefined): LockedRuleView {
  const attestable = ATTESTATION_PLAYBOOKS.includes(item.playbook);
  const active = !!record && !record.withdrawnAt && record.digest === item.digest && attestable;
  const who = WHO[item.rule.needs as 'lawyer' | 'ca'];
  const line = !attestable
    ? `This waits for ${who} to confirm it. Owner attestation for it is not available yet.`
    : active
      ? `You said you are responsible for this on ${record!.attestedOn}.`
      : 'Client work that rests on this waits until you tick it.';
  return {
    id: item.rule.id, playbook: item.playbook, topic: item.rule.topic, rule: item.rule.rule, limitations: item.rule.limitations,
    needs: item.rule.needs as 'lawyer' | 'ca', sources: item.rule.sources.map(source => ({ title: source.title, url: source.url })),
    digest: item.digest, attestable, attestedOn: active ? record!.attestedOn : null, line,
  };
}

/** The locks view for the business's own playbook. */
export function rulesLocksOf(state: State, venture: VentureRecord): RuleLocksView {
  const flagship = businessFlagship(state, venture);
  const registration = flagship ? findPlaybook(flagship) : null;
  const latest = latestByRule(state, venture.id);
  // Only the attestation playbooks list their locked rules here; the others still wait for a lawyer or CA.
  const attestable = !!flagship && ATTESTATION_PLAYBOOKS.includes(flagship);
  const elsewhere = !!flagship && !attestable && lockedRules().some(item => item.playbook === flagship);
  const rules = attestable ? lockedRules().filter(item => item.playbook === flagship).map(item => lockedView(item, latest.get(item.rule.id))) : [];
  const waiting = rules.filter(rule => rule.attestable && !rule.attestedOn).length;
  const line = flagship === 'ca-firm' ? CA_FIRM_LINE
    : elsewhere ? LOCKED_ELSEWHERE_LINE
    : !rules.length ? 'No rule waits for you.'
      : waiting ? `${waiting === 1 ? 'One rule waits' : `${waiting} rules wait`} for your tick.` : 'Every rule you can tick is ticked.';
  return {
    playbook: registration ? { id: registration.id, label: registration.label } : null,
    rules, words: ATTEST_WORDS, line, hardStops: HARD_STOPS.map(stop => ({ ...stop })),
  };
}

/** venture.rules.locks {} (read). */
export async function rulesLocksHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<RuleLocksView> {
  exactPayload(payload ?? {}, []);
  const { state, venture } = readAs(deps, ctx, 'read');
  return rulesLocksOf(state, venture);
}

/**
 * venture.rules.attest { ruleId, attest, digest? } (approve, app only). attest true needs the digest of the words the
 * owner read; attest false withdraws. A hard stop id answers HARD_STOP; a rule of a playbook whose checks do not read
 * attestations yet answers RULE_NOT_ATTESTABLE. Repeating the same choice changes nothing.
 */
export async function rulesAttestHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<RuleLocksView> {
  requireAppChannel(ctx, 'venture.rules.attest');
  const body = exactPayload(payload, ['ruleId', 'attest', 'digest'], ['ruleId', 'attest']);
  if (isHardStop(body.ruleId)) refuseHardStop(body.ruleId as string);
  check(typeof body.ruleId === 'string' && typeof body.attest === 'boolean', 'INVALID_VENTURE_REQUEST', NOT_FOUND);
  check(body.digest === undefined || typeof body.digest === 'string', 'INVALID_VENTURE_REQUEST', STALE);
  const item = lockedRules().find(candidate => candidate.rule.id === body.ruleId);
  check(item, 'RULE_NOT_FOUND', NOT_FOUND);
  check(ATTESTATION_PLAYBOOKS.includes(item.playbook), 'RULE_NOT_ATTESTABLE', NOT_ATTESTABLE_WORDS);
  if (body.attest) check(body.digest === item.digest, 'APPROVAL_STALE', STALE);
  readAs(deps, ctx, 'approve');
  return ventureAction(deps, ctx, 'approve', 'rules.attest', tx => {
    const venture = tx.venture!;
    const latest = tx.list('venture-rule-attestation').filter(record => record.ruleId === item.rule.id).at(-1);
    const active = !!latest && !latest.withdrawnAt && latest.digest === item.digest;
    if (body.attest && !active) {
      tx.put<RuleAttestationRecord>({
        ...tx.base('venture-rule-attestation'), ruleId: item.rule.id, playbookId: item.playbook, digest: item.digest,
        attestedOn: localDayAt(tx.now, venture.country), memberId: ctx.memberId, withdrawnAt: null, withdrawnOn: null,
      });
      recordDecision(tx, { subject: `rule:${item.rule.id}`, action: 'attested', who: 'owner', ruleId: item.rule.id, reason: ATTEST_WORDS, rowId: null });
      tx.emit('rule-attested', { ruleId: item.rule.id, playbook: item.playbook });
    } else if (!body.attest && latest && !latest.withdrawnAt) {
      tx.replace<RuleAttestationRecord>({ ...latest, withdrawnAt: tx.now, withdrawnOn: localDayAt(tx.now, venture.country) });
      recordDecision(tx, { subject: `rule:${item.rule.id}`, action: 'withdrawn', who: 'owner', ruleId: item.rule.id, reason: 'You withdrew your attestation.', rowId: null });
      tx.emit('rule-attestation-withdrawn', { ruleId: item.rule.id, playbook: item.playbook });
    }
    return rulesLocksOf(tx.state, venture);
  });
}
