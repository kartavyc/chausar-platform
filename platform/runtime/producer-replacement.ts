import { check, hash, newId, type Fact, type State } from './contracts.ts';
import { validDate, type FactInput } from './memory.ts';

/** Trusted draft-only publication. This helper has no RPC, persistence or external effect port. */
export type ProducerReplacementPins = { generation: number; relationDigest: string; custodyDigest: string };
export type ProducerReplacementControls = { rowCount: number; sums: { field: string; minor: string }[] };
export type ProducerReplacementRequest = {
  version: 1; complete: true; sourceId: string; expected: ProducerReplacementPins; publishedAt: string;
  outputs: FactInput[];
  custody: { inputDigest: string; recipeDigest: string; outputDigest: string };
  controls: ProducerReplacementControls;
  /** A zero-row preview alone cannot prove that the complete producer relation is empty. */
  justifiedEmpty?: { reason: string; evidenceDigest: string };
};
export type ProducerReplacementHost = {
  /** Authenticate retained source inputs, the reviewed recipe and independent complete controls. */
  assertCustody(state: State, request: ProducerReplacementRequest): void;
  /** Required for connector-managed sources. Must recheck actual admission against this exact view. */
  assertCurrentAdmission?(state: State, request: ProducerReplacementRequest): void;
};
export type ProducerFactLineage = {
  kind: string; entityId: string; previousFactIds: string[]; retractedFactIds: string[]; nextFactId: string | null;
  status: 'retained' | 'inserted' | 'replaced' | 'retracted' | 'reinstated';
};
export type ProducerRelationPublication = {
  type: 'producer-relation-publication-v1'; version: 1; id: string; sourceId: string; at: string;
  complete: true; generation: number; previousGeneration: number;
  qualification: 'experimental-source-replacement' | 'managed-admission-checked';
  previousRelationDigest: string; relationDigest: string; custodyDigest: string;
  inputDigest: string; recipeDigest: string; outputDigest: string;
  controls: ProducerReplacementControls; justifiedEmpty: ProducerReplacementRequest['justifiedEmpty'] | null;
  lineage: ProducerFactLineage[]; staleArtifactIds: string[]; affectedReceiptIds: string[];
};

const SHA = /^[a-f0-9]{64}$/;
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 200 && !value.includes('\u0000');
const plain = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const key = (fact: Pick<FactInput, 'kind' | 'entityId'>): string => JSON.stringify([fact.kind, fact.entityId]);
function canonicalFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalFields);
  if (plain(value)) return Object.fromEntries(Object.keys(value).sort().map(name => [name, canonicalFields(value[name])]));
  return value;
}
const semantic = (fact: FactInput): string => hash({ entityId: fact.entityId, sourceId: fact.sourceId, sourceRow: fact.sourceRow, kind: fact.kind, validFrom: fact.validFrom, validTo: fact.validTo ?? null, fields: canonicalFields(fact.fields), branch: fact.branch });
const publication = (item: any): item is ProducerRelationPublication => item?.type === 'producer-relation-publication-v1';

function activeRelation(state: State, sourceId: string): Fact[] {
  const tombstones = new Set(state.tombstones.map(item => item.factId ?? item.id));
  const latest = new Map<string, Fact>();
  for (const fact of state.facts) {
    if (fact.sourceId !== sourceId || fact.deletedAt || tombstones.has(fact.id) || fact.supersededAt !== null) continue;
    const identity = key(fact), previous = latest.get(identity);
    if (!previous || previous.learnedAt <= fact.learnedAt) latest.set(identity, fact);
  }
  return [...latest.values()].sort((a, b) => key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);
}

/** Includes fact identity and learned-at lineage, so an equal-value competing publication still fences. */
export function producerReplacementPins(state: State, sourceId: string): ProducerReplacementPins {
  check(text(sourceId), 'PRODUCER_SOURCE_INVALID', 'Choose one exact producer source.');
  const generations = state.imports.filter(item => publication(item) && item.sourceId === sourceId);
  generations.forEach((item, index) => {
    check(item.version === 1 && item.complete === true && item.generation === index + 1 && item.previousGeneration === index,
      'PRODUCER_GENERATION_INVALID', 'Producer publication generations must form one complete retained chain.');
  });
  return {
    generation: generations.length,
    relationDigest: hash(activeRelation(state, sourceId)),
    custodyDigest: hash(state.imports.filter(item => item.sourceId === sourceId && !publication(item))),
  };
}

/** Bind the complete row order as well as every output field. */
export function producerReplacementOutputDigest(outputs: FactInput[]): string { return hash(outputs); }

function validateJson(value: unknown, depth = 0): void {
  check(depth <= 64, 'PRODUCER_OUTPUT_INVALID', 'Producer fact values must be bounded JSON data.');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') { check(Number.isSafeInteger(value), 'PRODUCER_OUTPUT_INVALID', 'Exact values must use safe integers or decimal text.'); return; }
  if (Array.isArray(value)) { value.forEach(item => validateJson(item, depth + 1)); return; }
  check(plain(value), 'PRODUCER_OUTPUT_INVALID', 'Producer fact values must be plain JSON data.');
  for (const [name, item] of Object.entries(value)) {
    check(!['__proto__', 'prototype', 'constructor', '_supersedes'].includes(name), 'PRODUCER_OUTPUT_INVALID', 'Reserved fact fields are refused.');
    validateJson(item, depth + 1);
  }
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { for (const nested of Object.values(value)) freeze(nested); Object.freeze(value); }
  return value;
}

/**
 * Call inside the host's existing exclusive StateStore.update transaction. Every check and
 * trusted current-admission callback finishes before this function mutates the supplied draft.
 * The host remains responsible for permissions, actual wall clock and atomic durable commit.
 * Installed profiles without a retained capture are outside State: the host must also supply
 * assertCurrentAdmission for those sources. Any supplied admission callback runs, even when
 * this draft contains no connector imports; experimental metadata never grants readiness.
 */
export function publishProducerReplacement(state: State, input: ProducerReplacementRequest, host: ProducerReplacementHost): ProducerRelationPublication {
  check(plain(input) && input.version === 1 && input.complete === true && text(input.sourceId), 'PRODUCER_REPLACEMENT_INCOMPLETE', 'Publish one explicitly complete producer relation.');
  check(typeof input.publishedAt === 'string' && Number.isFinite(Date.parse(input.publishedAt)) && new Date(input.publishedAt).toISOString() === input.publishedAt,
    'PRODUCER_PUBLICATION_TIME_INVALID', 'The trusted host must supply its exact ISO publication time.');
  check(plain(input.expected) && Number.isSafeInteger(input.expected.generation) && input.expected.generation >= 0
    && SHA.test(input.expected.relationDigest) && SHA.test(input.expected.custodyDigest), 'PRODUCER_PIN_INVALID', 'Bind the exact prior producer generation, relation and custody.');
  const pins = producerReplacementPins(state, input.sourceId);
  check(input.expected.generation === pins.generation && input.expected.relationDigest === pins.relationDigest && input.expected.custodyDigest === pins.custodyDigest,
    'PRODUCER_REPLACEMENT_STALE', 'The producer relation or retained custody changed after review.');
  check(plain(input.custody) && ['inputDigest', 'recipeDigest', 'outputDigest'].every(field => typeof input.custody[field as keyof typeof input.custody] === 'string' && SHA.test(input.custody[field as keyof typeof input.custody])),
    'PRODUCER_CUSTODY_INVALID', 'Bind authenticated source input, reviewed recipe and complete mapped outputs.');
  check(Array.isArray(input.outputs) && input.outputs.length <= 100_000, 'PRODUCER_OUTPUT_INVALID', 'Supply a bounded complete output relation.');
  const identities = new Set<string>();
  for (const output of input.outputs) {
    check(plain(output) && Object.keys(output).every(name => ['entityId', 'sourceId', 'sourceRow', 'kind', 'validFrom', 'validTo', 'fields', 'branch'].includes(name))
      && text(output.entityId) && output.sourceId === input.sourceId && Number.isSafeInteger(output.sourceRow) && output.sourceRow > 0
      && typeof output.kind === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(output.kind) && plain(output.fields)
      && (output.branch === undefined || text(output.branch)), 'PRODUCER_OUTPUT_INVALID', 'Every output must belong to this producer and have one stable logical identity.');
    check(validDate(output.validFrom) && (output.validTo === undefined || output.validTo === null || (validDate(output.validTo) && output.validTo >= output.validFrom)),
      'PRODUCER_OUTPUT_DATE_INVALID', 'Producer business dates must be valid.');
    const identity = key(output); check(!identities.has(identity), 'PRODUCER_OUTPUT_DUPLICATE', 'A complete producer relation cannot repeat a logical identity.'); identities.add(identity);
    validateJson(output.fields);
  }
  check(Buffer.byteLength(JSON.stringify(input.outputs)) <= 20_000_000, 'PRODUCER_OUTPUT_INVALID', 'The producer relation exceeds the bounded draft limit.');
  check(input.custody.outputDigest === producerReplacementOutputDigest(input.outputs), 'PRODUCER_OUTPUT_DIGEST_MISMATCH', 'Mapped output bytes changed after custody review.');
  check(plain(input.controls) && Number.isSafeInteger(input.controls.rowCount) && input.controls.rowCount === input.outputs.length && Array.isArray(input.controls.sums) && input.controls.sums.length <= 64,
    'PRODUCER_CONTROL_MISMATCH', 'The complete output count must match independent source controls.');
  const fields = new Set<string>();
  for (const control of input.controls.sums) {
    check(plain(control) && text(control.field) && !fields.has(control.field) && typeof control.minor === 'string' && /^-?\d+$/.test(control.minor), 'PRODUCER_CONTROL_MISMATCH', 'Control totals need unique exact integer fields.'); fields.add(control.field);
    let total = 0n;
    for (const output of input.outputs) {
      const value = output.fields[control.field];
      check(typeof value === 'string' && /^-?\d+$/.test(value), 'PRODUCER_CONTROL_MISMATCH', 'Every controlled output value must be exact integer text.'); total += BigInt(value);
    }
    check(total === BigInt(control.minor), 'PRODUCER_CONTROL_MISMATCH', 'The complete output relation does not reconcile to independent source totals.');
  }
  if (input.outputs.length === 0) check(plain(input.justifiedEmpty) && typeof input.justifiedEmpty.reason === 'string' && input.justifiedEmpty.reason.trim().length > 0 && input.justifiedEmpty.reason.length <= 2000 && SHA.test(input.justifiedEmpty.evidenceDigest),
    'PRODUCER_EMPTY_UNJUSTIFIED', 'An empty producer relation requires authenticated complete-source evidence and an explicit reason.');
  else check(input.justifiedEmpty === undefined, 'PRODUCER_EMPTY_UNJUSTIFIED', 'An empty-source justification cannot describe nonempty output.');
  const sourceHistory = state.facts.filter(fact => fact.sourceId === input.sourceId);
  check(sourceHistory.every(fact => fact.learnedAt <= input.publishedAt && (!fact.supersededAt || fact.supersededAt <= input.publishedAt))
    && state.imports.filter(item => publication(item) && item.sourceId === input.sourceId).every(item => item.at <= input.publishedAt),
    'SYSTEM_CLOCK_REGRESSION', 'A publication cannot precede retained producer history.');
  check(typeof host?.assertCustody === 'function', 'PRODUCER_CUSTODY_REQUIRED', 'A trusted custody assertion is required for publication.');
  const managed = state.imports.some(item => item.sourceId === input.sourceId && typeof item.type === 'string' && item.type.startsWith('connector-'));
  check(!managed || typeof host.assertCurrentAdmission === 'function', 'PRODUCER_MANAGED_ADMISSION_REQUIRED', 'A managed connector needs its actual current admission gate.');
  const request = freeze(structuredClone(input));
  const hostView = freeze(structuredClone(state));
  check(host.assertCustody(hostView, request) === undefined, 'PRODUCER_HOST_ASSERTION_INVALID', 'Custody checks must finish synchronously and throw on refusal.');
  if (host.assertCurrentAdmission) check(host.assertCurrentAdmission(hostView, request) === undefined,
    'PRODUCER_HOST_ASSERTION_INVALID', 'Current admission must finish synchronously and throw on refusal.');
  check(hash(producerReplacementPins(state, input.sourceId)) === hash(pins), 'PRODUCER_REPLACEMENT_STALE', 'Producer authority changed during current publication checks.');

  // Prepare the entire publication before changing the caller's draft.
  const active = activeRelation(state, input.sourceId), previous = new Map(active.map(fact => [key(fact), fact]));
  const activeIds = new Set(active.map(fact => fact.id));
  const historicalByIdentity = new Map<string, Fact[]>();
  for (const fact of sourceHistory) {
    const identity = key(fact), rows = historicalByIdentity.get(identity);
    if (rows) rows.push(fact); else historicalByIdentity.set(identity, [fact]);
  }
  const nextFacts: Fact[] = [], lineage: ProducerFactLineage[] = [], retract = new Set<string>();
  for (const output of request.outputs) {
    const identity = key(output), current = previous.get(identity);
    const historical = historicalByIdentity.get(identity) ?? [];
    if (current && semantic(current) === semantic(output)) {
      // Branch/access selectors run before source version selection. Leaving any older live
      // version would leak an omitted claim through a narrower selector after publication.
      const old = historical.filter(fact => fact.id !== current.id && fact.supersededAt === null && !fact.deletedAt);
      old.forEach(fact => retract.add(fact.id));
      nextFacts.push(current); lineage.push({ kind: output.kind, entityId: output.entityId, previousFactIds: historical.map(fact => fact.id), retractedFactIds: old.map(fact => fact.id), nextFactId: current.id, status: 'retained' }); previous.delete(identity); continue;
    }
    const old = historical.filter(fact => fact.supersededAt === null && !fact.deletedAt);
    old.forEach(fact => retract.add(fact.id));
    const fact: Fact = { ...structuredClone(output), id: newId('fact'), validTo: output.validTo ?? null, learnedAt: request.publishedAt, supersededAt: null };
    nextFacts.push(fact); lineage.push({ kind: output.kind, entityId: output.entityId, previousFactIds: historical.map(item => item.id), retractedFactIds: old.map(item => item.id), nextFactId: fact.id, status: current ? 'replaced' : historical.length ? 'reinstated' : 'inserted' }); previous.delete(identity);
  }
  for (const current of previous.values()) {
    const old = (historicalByIdentity.get(key(current)) ?? []).filter(fact => fact.supersededAt === null && !fact.deletedAt);
    old.forEach(fact => retract.add(fact.id));
    lineage.push({ kind: current.kind, entityId: current.entityId, previousFactIds: old.map(fact => fact.id), retractedFactIds: old.map(fact => fact.id), nextFactId: null, status: 'retracted' });
  }
  const changed = retract.size > 0 || nextFacts.some(fact => !activeIds.has(fact.id));
  const ids = (items: any[]) => [...new Set(items.map(item => item.id).filter((id): id is string => typeof id === 'string'))];
  const staleArtifactIds = changed ? ids(state.answers) : [];
  const affectedReceiptIds = changed ? ids(state.receipts) : [];
  const record: ProducerRelationPublication = {
    type: 'producer-relation-publication-v1', version: 1, id: newId('producer_publication'), sourceId: request.sourceId, at: request.publishedAt,
    complete: true, generation: pins.generation + 1, previousGeneration: pins.generation,
    qualification: managed ? 'managed-admission-checked' : 'experimental-source-replacement', previousRelationDigest: pins.relationDigest,
    relationDigest: hash([...nextFacts].sort((a, b) => key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0)), custodyDigest: pins.custodyDigest,
    ...structuredClone(request.custody), controls: structuredClone(request.controls), justifiedEmpty: request.justifiedEmpty ? structuredClone(request.justifiedEmpty) : null,
    lineage, staleArtifactIds, affectedReceiptIds,
  };
  const appended = nextFacts.filter(fact => !activeIds.has(fact.id));
  for (const fact of state.facts) if (retract.has(fact.id)) fact.supersededAt = request.publishedAt;
  state.facts.push(...appended); state.imports.push(record);
  // Retained receipts are historical evidence. Record their affected IDs without rewriting them.
  if (changed) for (const answer of state.answers) { answer.stale = true; answer.staleReason = 'Producer relation changed. Recalculate this answer.'; }
  return structuredClone(record);
}
