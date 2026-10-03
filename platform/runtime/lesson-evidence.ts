import { check, hash } from './contracts.ts';
import type { Context, State } from './contracts.ts';
import { current, digest, sourceAccess } from './actions.ts';
import type { LessonEvidenceAuthority, LessonEvidencePin, LessonEvidenceReference, LessonEvidenceResolver, LessonResolvedEvidence } from './lesson-contracts.ts';

/**
 * A host-owned, synchronous authority over the supplied current state snapshot.
 * It must resolve the complete evidence/source scope, reject stale job or receipt
 * bindings, and explicitly classify taint. The digest binds the immutable
 * evidence revision and every released source marking/summary. Receipt numbers
 * alone do not establish that their source material is safe reusable guidance.
 */
export type { LessonEvidenceReference, LessonEvidenceResolver } from './lesson-contracts.ts';
const plain = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
const invalid = 'INVALID_LESSON_EVIDENCE';
function freeze<T>(value: T, seen = new Set<object>()): T {
  if (value !== null && typeof value === 'object' && !seen.has(value)) {
    seen.add(value);
    for (const child of Object.values(value)) freeze(child, seen);
    Object.freeze(value);
  }
  return value;
}
function closed(value: unknown, fields: string[]): asserts value is Record<string, unknown> {
  check(plain(value) && Object.keys(value).every(field => fields.includes(field)), invalid, 'Lesson evidence must contain only declared data fields.');
}
function text(value: unknown, max = 200): asserts value is string {
  check(typeof value === 'string' && value.trim().length > 0 && value.length <= max, invalid, 'Lesson evidence needs bounded, nonblank text.');
}
function names(value: unknown): asserts value is string[] {
  check(Array.isArray(value) && value.length > 0 && value.length <= 256, invalid, 'Evidence needs an explicit, nonempty source and branch scope.');
  for (const name of value) text(name);
  check(value.every((name, index) => index === 0 || value[index - 1] < name), invalid, 'Evidence source and branch identifiers must be sorted and distinct.');
}
function reference(value: unknown): asserts value is LessonEvidenceReference {
  closed(value, ['kind', 'id']);
  check(value.kind === 'job' || value.kind === 'calculation', invalid, 'Evidence must identify an existing job or calculation.');
  text(value.id);
}
function pin(value: unknown): asserts value is LessonEvidencePin {
  closed(value, ['kind', 'id', 'revision', 'digest', 'sourceIds', 'branchIds']);
  reference({ kind: value.kind, id: value.id }); text(value.revision);
  check(typeof value.digest === 'string' && /^[a-f0-9]{64}$/.test(value.digest), invalid, 'Evidence needs an exact SHA-256 snapshot pin.');
  names(value.sourceIds); names(value.branchIds);
}
function resolved(value: unknown, requested: LessonEvidenceReference): asserts value is LessonResolvedEvidence {
  // Refusal does not expose the unavailable evidence or its source markings.
  check(plain(value) && value.available === true, 'LESSON_EVIDENCE_UNAVAILABLE', 'This lesson evidence is unavailable under the current authority.');
  closed(value, ['pin', 'available', 'sourceTainted', 'sourceMarkings', 'summary']);
  pin(value.pin);
  check(value.pin.kind === requested.kind && value.pin.id === requested.id, 'LESSON_EVIDENCE_CHANGED', 'The resolved evidence does not match the requested immutable identity.');
  check(value.sourceTainted === false, 'LESSON_EVIDENCE_TAINTED', 'Tainted or unclassified evidence cannot become reusable guidance.');
  text(value.summary, 20000);
  check(Array.isArray(value.sourceMarkings) && value.sourceMarkings.length === value.pin.sourceIds.length, invalid, 'Mark every source contributing to the lesson evidence.');
  for (const [index, marking] of value.sourceMarkings.entries()) {
    closed(marking, ['sourceId', 'marking']); text(marking.sourceId); text(marking.marking, 2000);
    check(marking.sourceId === value.pin.sourceIds[index], invalid, 'Source markings must bind every source in the same sorted order.');
  }
}
function references(values: unknown): asserts values is LessonEvidenceReference[] {
  check(Array.isArray(values) && values.length > 0 && values.length <= 256, invalid, 'Provide a bounded, nonempty evidence reference list.');
  const identities = new Set<string>();
  for (const value of values) {
    reference(value); const identity = digest(value);
    check(!identities.has(identity), invalid, 'An evidence identity may be referenced only once.'); identities.add(identity);
  }
}
function authorizeSnapshot(state: State, context: Context, permission: 'read' | 'prepare' | 'approve' = 'read') {
  check(['read', 'prepare', 'approve'].includes(permission), invalid, 'Choose an explicit lesson authority permission.');
  check(!context.sourceTainted, 'LESSON_CONTEXT_TAINTED', 'Tainted source content cannot control lesson authority.');
  return current(state, context, permission);
}
function scope(state: State, context: Context, evidence: LessonResolvedEvidence) {
  const member = authorizeSnapshot(state, context);
  sourceAccess(state, context, evidence.pin.sourceIds);
  check(member.branches.includes('*') || evidence.pin.branchIds.every(branch => branch !== '*' && member.branches.includes(branch)),
    'BRANCH_FORBIDDEN', 'Lesson evidence includes a branch outside your current permissions.');
}

/**
 * No default resolver is installed. The application must supply its actual job
 * and receipt authority, including current access, revision, staleness and taint
 * decisions. The returned port has no StateStore update or calculation rights.
 * Its coherence token covers the complete current business-state snapshot, so
 * workspace, member, source or evidence changes during a callback block release.
 * JSON hashing accepts existing State records with optional undefined fields;
 * those retain normal JSON omission semantics rather than lesson JSON rules.
 */
export function createLessonEvidenceAuthority(readCurrentState: () => State, resolver: LessonEvidenceResolver): LessonEvidenceAuthority {
  check(typeof readCurrentState === 'function' && typeof resolver === 'function', 'LESSON_EVIDENCE_AUTHORITY_REQUIRED', 'Install an explicit current-state evidence authority.');
  const snapshot = () => freeze(structuredClone(readCurrentState()));
  const authorityRevision = () => hash(snapshot());
  const coherent = (state: State) => check(authorityRevision() === hash(state), 'LESSON_AUTHORITY_CHANGED', 'The current workspace authority changed during evidence resolution; retry under current access.');
  const captureAt = (state: State, context: Context, values: LessonEvidenceReference[]) => {
    authorizeSnapshot(state, context); references(values);
    const results = values.map(value => {
      // The host receives a detached snapshot and reference, never a write grant
      // over the actual workspace or the caller's mutable request object.
      const result = structuredClone(resolver(freeze(structuredClone(state)), freeze(structuredClone(context)), freeze(structuredClone(value))));
      resolved(result, value); scope(state, context, result); return result;
    });
    coherent(state); return results;
  };
  return {
    workspaceId() { const id = snapshot().workspace?.id; text(id); return id; },
    authorityRevision,
    authorize(context, permission) { authorizeSnapshot(snapshot(), context, permission); },
    capture(context, values) { return captureAt(snapshot(), context, structuredClone(values)); },
    assertCurrent(context, values) {
      check(Array.isArray(values) && values.length > 0 && values.length <= 256, invalid, 'Provide the exact saved evidence pins.');
      const pinned = structuredClone(values);
      for (const value of pinned) pin(value);
      const state = snapshot(), results = captureAt(state, context, pinned.map(({ kind, id }) => ({ kind, id })));
      for (const [index, result] of results.entries()) check(digest(result.pin) === digest(pinned[index]),
        'LESSON_EVIDENCE_CHANGED', 'The evidence revision, content or complete source scope changed; review a new candidate.');
      coherent(state); return results;
    },
  };
}

/** Compare the released source markings as well as the evidence pins. */
export function assertLessonEvidenceSnapshot(currentEvidence: LessonResolvedEvidence[], pinnedEvidence: LessonResolvedEvidence[]): void {
  check(digest(currentEvidence) === digest(pinnedEvidence), 'LESSON_EVIDENCE_CHANGED', 'The reviewed evidence or its source markings changed; review a new candidate.');
}
