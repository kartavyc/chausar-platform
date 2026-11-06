// Chausar venture launcher, evidence ledger (P2-evidence, spec section 7.6): what backs each client and business field.
// Every write of a client or business field by the owner or an agent records a piece of evidence. Its strength comes
// from fixed weights (types.ts), never from the model. Only verified evidence overwrites a stored value on its own;
// weaker evidence waits as a suggestion the owner can apply (evidenceQuestions lists them for Today). A claimed type
// counts only when a real tool result in the run's trace backs it; otherwise it is downgraded, weak and flagged.
// personEvidence builds the engine's own rows about people in the owner's network (Ink v2 wave 4), under its own type.
import { check, type Context, type State } from '../../contracts.ts';
import { exactPayload, listRecords, readVenture, requireAppChannel, tidyWords, ventureAction, type VentureTx } from '../records.ts';
import type { ClientRecord, EvidenceItem, EvidenceRecord, Labelled, ToolCallRecord, VentureDeps } from '../contracts.ts';
import { backs, EVIDENCE_TYPE_IDS, EVIDENCE_TYPES, scoreEvidence, UNCHECKED, type EvidenceClaim, type EvidenceType } from './types.ts';
import { redactSecrets } from '../core/secrets.ts';

const SUBJECT = /^(?:business|client:[A-Za-z0-9_-]{1,80})$/;
/** A field name evidence may be kept under: one short name with no spaces that starts with a letter, such as offer_1.name. */
export const EVIDENCE_FIELD = /^[A-Za-z][A-Za-z0-9_.-]{0,59}$/;

/**
 * Whether evidence may be kept under this field name: the shape above, and no part between dots that every object
 * already has (toString, constructor, __proto__ and the rest), which a lookup by name would find on any record.
 */
export function evidenceFieldOk(field: unknown): field is string {
  return typeof field === 'string' && EVIDENCE_FIELD.test(field)
    && field.split('.').every(part => part !== '__proto__' && !(part in Object.prototype));
}

/** A value as the ledger keeps it: tidied, any secret replaced (W1 H17), at most 500 characters. */
export function evidenceValue(value: string): string {
  return redactSecrets(tidyWords(value)).slice(0, MAX_VALUE);
}
/**
 * The line on a value two sources verified but that an agent noted in a run which read a client's file: the run is
 * latched (policy/taint.ts), so it waits for the owner instead of being applied on its own.
 */
export const HELD_SUGGESTION = 'From a client file: waits for you.';
const MAX_VALUE = 500;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** What a write says about one field. by 'owner' only for the owner's own typing, recorded by the engine. */
export type EvidenceInput = {
  subject: string; // 'business' or 'client:<id>'
  field: string;
  value: string;
  type: EvidenceType;
  claim?: EvidenceClaim; // 'needs-your-data' when Chausar cannot see the value; otherwise the type decides
  by: 'owner' | 'agent' | 'engine';
  runId?: string | null; // the delivery run whose trace must back a tool-backed type
  toolCallId?: string | null;
  source?: string; // a few plain words: the file name, or where the value was written
  /**
   * true for what an agent notes with evidence.record: its run read a client's file, so even a verified value waits
   * for the owner to apply it and says why (HELD_SUGGESTION). The weights and the strength are unchanged.
   */
  noAutoApply?: boolean;
};

/** The shared contract's view of a record: exactly the EvidenceItem fields. */
export function evidenceItem(record: EvidenceRecord): EvidenceItem {
  return {
    id: record.id, subject: record.subject, field: record.field, value: record.value, type: record.type, strength: record.strength,
    claim: record.claim, source: record.source, applied: record.applied, ...(record.dismissedAt ? { dismissed: true } : {}),
  };
}

function fieldRecords(state: State, ventureId: string, subject: string, field: string): EvidenceRecord[] {
  return listRecords(state, 'venture-evidence', ventureId).filter(record => record.subject === subject && record.field === field);
}

/** The tool calls of one delivery run of this business; none without a run. */
function runTrace(state: State, ventureId: string, runId: string | null | undefined): ToolCallRecord[] {
  if (!runId) return [];
  const run = listRecords(state, 'venture-delivery-run', ventureId).find(record => record.id === runId);
  return run?.harness?.toolCalls ?? [];
}

/** The type code accepts: the claimed one when the run's trace backs it (or it needs no backing), else model-inferred. */
function acceptedType(state: State, ventureId: string, input: EvidenceInput): { type: EvidenceType; flag: string | null } {
  if (input.type === 'model-inferred') return { type: input.type, flag: null };
  if (input.type === 'owner-entered') return input.by === 'owner' ? { type: input.type, flag: null } : { type: 'model-inferred', flag: UNCHECKED['owner-entered'] };
  const call = input.toolCallId ? runTrace(state, ventureId, input.runId).find(item => item.id === input.toolCallId) : undefined;
  return call && backs(input.type, call) ? { type: input.type, flag: null } : { type: 'model-inferred', flag: UNCHECKED[input.type] };
}

function sourceLine(type: EvidenceType, input: EvidenceInput, flag: string | null): string {
  if (flag) return `Unchecked: ${flag}`;
  const detail = input.source ? redactSecrets(tidyWords(input.source)).slice(0, 120) : ''; // secret screen (W1 H17)
  const call = input.toolCallId && type !== 'model-inferred' && type !== 'owner-entered' ? ` (${input.toolCallId})` : '';
  return detail ? `${EVIDENCE_TYPES[type].label}${call}: ${detail}` : `${EVIDENCE_TYPES[type].label}${call}.`;
}

/** Client fields an applied value is written back to, with the same rules as venture.client.add. Others stay in the ledger. */
const CLIENT_FIELDS: Readonly<Record<string, (value: string) => boolean>> = Object.freeze({
  name: value => value.length >= 2 && value.length <= 120,
  email: value => value.length <= 200 && EMAIL.test(value),
  note: value => value.length >= 1 && value.length <= MAX_VALUE,
});

function writeThrough(tx: VentureTx, record: EvidenceRecord) {
  if (!record.subject.startsWith('client:')) return;
  // Only the ledger's own client fields: a name every object has (toString) is never looked up or written.
  const valid = Object.hasOwn(CLIENT_FIELDS, record.field) ? CLIENT_FIELDS[record.field] : undefined;
  const client = tx.find('venture-client', record.subject.slice('client:'.length));
  if (!valid || !client) return;
  check(valid(record.value), 'INVALID_VENTURE_REQUEST', `This ${record.field} is not one Chausar can keep for a client.`);
  const key = record.field as 'name' | 'email' | 'note';
  if (client[key] !== record.value) tx.replace<ClientRecord>({ ...client, [key]: record.value });
}

/** Makes a record the stored value for its field: the field's other records stop being applied. */
function applyRecord(tx: VentureTx, record: EvidenceRecord): EvidenceRecord {
  for (const other of fieldRecords(tx.state, record.ventureId, record.subject, record.field)) {
    if (other.applied && other.id !== record.id) tx.replace<EvidenceRecord>({ ...other, applied: false });
  }
  const applied = tx.replace<EvidenceRecord>({ ...record, applied: true, appliedAt: tx.now });
  writeThrough(tx, applied);
  return applied;
}

/**
 * Records one piece of evidence inside a venture action. Earlier evidence for the same value adds its weight (each
 * source once). Verified evidence is applied at once and overwrites the stored value; strong and weak evidence waits,
 * and so does verified evidence recorded with noAutoApply, whose source line then starts with HELD_SUGGESTION.
 */
export function recordEvidence(tx: VentureTx, input: EvidenceInput): EvidenceRecord {
  const venture = tx.venture;
  check(venture, 'VENTURE_NOT_FOUND', 'Start a business first.');
  check(SUBJECT.test(input.subject) && evidenceFieldOk(input.field) && typeof input.value === 'string' && EVIDENCE_TYPE_IDS.includes(input.type),
    'INVALID_VENTURE_REQUEST', 'This evidence is not in a shape Chausar keeps.');
  const { type, flag } = acceptedType(tx.state, venture.id, input);
  const needsData = input.claim === 'needs-your-data';
  const claim: EvidenceClaim = needsData ? 'needs-your-data' : EVIDENCE_TYPES[type].claim;
  // The secret screen (W1 H17): a key or token pasted as a value is never kept.
  const value = needsData ? '' : evidenceValue(input.value);
  const source = sourceLine(type, input, flag);
  const ref = input.toolCallId ?? source;
  const peers = needsData ? [] : fieldRecords(tx.state, venture.id, input.subject, input.field).filter(record => record.claim !== 'needs-your-data' && record.value === value);
  const scored = needsData
    ? { scoreBp: 0, strength: 'weak' as const }
    : scoreEvidence([...peers.map(record => ({ type: record.type as EvidenceType, ref: record.toolCallId ?? record.source })), { type, ref }]);
  const held = scored.strength === 'verified' && input.noAutoApply === true;
  const stored = tx.put<EvidenceRecord>({
    ...tx.base('venture-evidence'), subject: input.subject, field: input.field, value, type, claimedType: input.type,
    strength: scored.strength, scoreBp: scored.scoreBp, claim, source: held ? `${HELD_SUGGESTION} ${source}` : source, by: input.by, runId: input.runId ?? null,
    toolCallId: input.toolCallId ?? null, flag, applied: false, appliedAt: null,
  });
  return scored.strength === 'verified' && !held ? applyRecord(tx, stored) : stored;
}

/**
 * Evidence the engine worked out itself from the owner's own files and records (Ink v2 wave 4, 4D2: how well the owner
 * knows someone). Its own type, so it never reads as "read from a file in the run": no run read it. Agents cannot claim
 * it: recordEvidence does not take it.
 */
export const ENGINE_COMPUTED = Object.freeze({ type: 'engine-computed', claim: 'observed' as const, label: 'Worked out by Chausar from your own files and records' });
const PERSON_ID = /^[A-Za-z0-9_-]{1,80}$/;

/**
 * One engine-made evidence row about a person in the owner's network (subject 'person:<id>'), built for the caller to
 * write: the value through evidenceValue (tidied, the secret screen, at most 500 characters), the source through the
 * secret screen and at most 120 characters after its label. ownerSaid: the owner's own word (owner-entered, verified);
 * otherwise engine-computed, verified, since code worked it out from the owner's own records. Applied at once, so it
 * never waits on Today as a question.
 */
export function personEvidence(tx: VentureTx, input: { personId: string; field: string; value: string; source: string; ownerSaid: boolean }): EvidenceRecord {
  check(tx.venture, 'VENTURE_NOT_FOUND', 'Start a business first.');
  check(PERSON_ID.test(input.personId) && evidenceFieldOk(input.field) && typeof input.value === 'string' && typeof input.source === 'string',
    'INVALID_VENTURE_REQUEST', 'This evidence is not in a shape Chausar keeps.');
  const type = input.ownerSaid ? 'owner-entered' : ENGINE_COMPUTED.type;
  const label = input.ownerSaid ? EVIDENCE_TYPES['owner-entered'].label : ENGINE_COMPUTED.label;
  const detail = redactSecrets(tidyWords(input.source)).slice(0, 120);
  return {
    ...tx.base('venture-evidence'), subject: `person:${input.personId}`, field: input.field, value: evidenceValue(input.value), type, claimedType: type,
    strength: 'verified', scoreBp: input.ownerSaid ? EVIDENCE_TYPES['owner-entered'].weightBp : 9000, claim: 'observed',
    source: detail ? `${label}: ${detail}` : `${label}.`, by: 'engine', runId: null, toolCallId: null, flag: null, applied: true, appliedAt: tx.now,
  };
}

/** Whether a client field Chausar writes back on apply (name, email, note) would take this value; other fields always do. */
export function fitsClientField(field: string, value: string): boolean {
  return !Object.hasOwn(CLIENT_FIELDS, field) || CLIENT_FIELDS[field](value);
}

/** The owner's own typing on a client: owner-entered, verified and applied (the record already holds these values). */
export function recordOwnerFields(tx: VentureTx, subject: string, fields: Readonly<Record<string, string | null>>) {
  for (const [field, value] of Object.entries(fields)) {
    if (value !== null) recordEvidence(tx, { subject, field, value, type: 'owner-entered', by: 'owner' });
  }
}

type PlanLines = {
  name: Labelled<string>;
  oneLiner: Labelled<string>;
  customer: Labelled<string>;
  offers: readonly { id: string; name: Labelled<string>; description: Labelled<string> }[];
};

/**
 * A kept plan's business fields. Lines the AI wrote are model-inferred and weak, and applied because the owner kept the
 * plan; lines the owner typed are owner-entered. Template and engine words are not evidence of anything.
 */
export function recordPlanEvidence(tx: VentureTx, plan: PlanLines) {
  const lines: [string, Labelled<string>][] = [
    ['name', plan.name], ['oneLiner', plan.oneLiner], ['customer', plan.customer],
    ...plan.offers.flatMap(offer => [[`${offer.id}.name`, offer.name], [`${offer.id}.description`, offer.description]] as [string, Labelled<string>][]),
  ];
  for (const [field, line] of lines) {
    if (line.by === 'owner') recordEvidence(tx, { subject: 'business', field, value: line.value, type: 'owner-entered', by: 'owner' });
    else if (line.by === 'model') applyRecord(tx, recordEvidence(tx, { subject: 'business', field, value: line.value, type: 'model-inferred', by: 'agent', source: 'you kept it in your plan' }));
  }
}

/**
 * Suggestions waiting for the owner, newest first: evidence not applied whose value differs from the stored one, and
 * every needs-your-data ask. The queue view turns each into a row of kind 'question'. A value the owner dismissed stays
 * off, and so does the same value for the same field suggested again later.
 */
export function evidenceQuestions(state: State, ventureId: string): EvidenceRecord[] {
  const records = listRecords(state, 'venture-evidence', ventureId);
  const stored = new Map(records.filter(record => record.applied).map(record => [`${record.subject}|${record.field}`, record]));
  const seen = new Set<string>(records.filter(record => record.dismissedAt).map(record => `${record.subject}|${record.field}|${record.value}`));
  const waiting: EvidenceRecord[] = [];
  for (const record of [...records].reverse()) {
    if (record.applied) continue;
    const current = stored.get(`${record.subject}|${record.field}`);
    // A value that was stored once and replaced since is history, not a suggestion; so is one older than the value
    // stored now, which the owner or a checked source already settled.
    if (record.appliedAt !== null || (current && record.at < (current.appliedAt ?? current.at))) continue;
    if (record.claim !== 'needs-your-data' && current?.value === record.value) continue;
    const key = `${record.subject}|${record.field}|${record.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    waiting.push(record);
  }
  return waiting;
}

// ---------------------------------------------------------------------------
// venture.evidence.list { subject? } (level read), venture.evidence.apply { id } and venture.evidence.dismiss { id }
// (prepare, inside the app)
// ---------------------------------------------------------------------------

export async function evidenceList(deps: VentureDeps, ctx: Context, payload: unknown): Promise<{ items: EvidenceItem[] }> {
  const body = exactPayload(payload ?? {}, ['subject']);
  check(body.subject === undefined || (typeof body.subject === 'string' && body.subject.length <= 120), 'INVALID_VENTURE_REQUEST', 'subject must be text, like business or client:<id>.');
  const { state, venture } = readVenture(deps, ctx);
  const records = listRecords(state, 'venture-evidence', venture.id).filter(record => body.subject === undefined || record.subject === body.subject);
  return { items: records.reverse().map(evidenceItem) };
}

export async function evidenceApply(deps: VentureDeps, ctx: Context, payload: unknown): Promise<{ item: EvidenceItem }> {
  requireAppChannel(ctx, 'venture.evidence.apply');
  const body = exactPayload(payload, ['id'], ['id']);
  check(typeof body.id === 'string' && body.id.length >= 1 && body.id.length <= 80, 'INVALID_VENTURE_REQUEST', 'id must be text.');
  return ventureAction(deps, ctx, 'prepare', 'evidence.apply', tx => {
    const record = tx.find('venture-evidence', body.id as string);
    check(record, 'EVIDENCE_NOT_FOUND', 'This evidence is not in this business.');
    if (record.applied) return { item: evidenceItem(record) };
    check(record.claim !== 'needs-your-data', 'INVALID_VENTURE_REQUEST', "There's no value to apply: this asks for your data.");
    const stored = fieldRecords(tx.state, record.ventureId, record.subject, record.field).find(item => item.applied);
    check(!stored || stored.strength !== 'verified' || record.strength === 'verified', 'EVIDENCE_WEAK',
      "A checked value is stored for this. Weaker evidence can't replace it.");
    return { item: evidenceItem(applyRecord(tx, record)) };
  });
}

/**
 * venture.evidence.dismiss { id } (prepare, inside the app): the owner says no to a suggestion or an ask. The record
 * stays in the ledger, marked dismissed, and leaves Today; the stored value is untouched. A stored value cannot be
 * dismissed: the owner corrects it instead.
 */
export async function evidenceDismiss(deps: VentureDeps, ctx: Context, payload: unknown): Promise<{ item: EvidenceItem }> {
  requireAppChannel(ctx, 'venture.evidence.dismiss');
  const body = exactPayload(payload, ['id'], ['id']);
  check(typeof body.id === 'string' && body.id.length >= 1 && body.id.length <= 80, 'INVALID_VENTURE_REQUEST', 'id must be text.');
  return ventureAction(deps, ctx, 'prepare', 'evidence.dismiss', tx => {
    const record = tx.find('venture-evidence', body.id as string);
    check(record, 'EVIDENCE_NOT_FOUND', 'This evidence is not in this business.');
    if (record.dismissedAt) return { item: evidenceItem(record) };
    check(!record.applied, 'INVALID_VENTURE_REQUEST', 'This is the value in use, so it cannot be dismissed. Correct it instead.');
    const dismissed = tx.replace<EvidenceRecord>({ ...record, dismissedAt: tx.now });
    tx.emit('queue.changed', { evidenceId: record.id });
    return { item: evidenceItem(dismissed) };
  });
}
