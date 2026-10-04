import { authorize, ChausarError, type Context } from './contracts.ts';
import {
  canonicalInterchangeJson, interchangeDigest, readHistoricalWorkspaceState,
  validateWorkspaceInterchange, workspaceStateProfile,
} from './workspace-interchange.ts';
import { STATE_PROFILE, type EmptyTargetInspection, type StoreProfile, type WorkspaceImportCandidate, type WorkspaceImportHooks, type WorkspaceInventory } from './workspace-interchange-contracts.ts';

function requireValue(condition: unknown, code: string, message: string): asserts condition {
  if (!condition) throw new ChausarError(code, message);
}
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,200}$/.test(value);
const digest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const equal = (left: unknown, right: unknown) => canonicalInterchangeJson(left) === canonicalInterchangeJson(right);

/** This validates a ROOT inspection, never a caller-authored empty-directory claim. */
export function proveEmptyWorkspaceTarget(target: EmptyTargetInspection, sourceProfile?: StoreProfile): string {
  requireValue(target && typeof target === 'object' && !Array.isArray(target), 'INTERCHANGE_TARGET_PROOF', 'An independently enumerated target inspection is required.');
  const keys = ['targetId', 'workspaceId', 'generation', 'accessDigest', 'ready', 'profile', 'stores', 'categoryCounts', 'authorityRecords', 'unexpectedEntries'];
  requireValue(equal(Object.keys(target).sort(), keys.sort()), 'INTERCHANGE_TARGET_PROOF', 'The target inspection must include every required field.');
  canonicalInterchangeJson(target);
  requireValue(identifier(target.targetId) && identifier(target.workspaceId) && identifier(target.generation) && digest(target.accessDigest),
    'INTERCHANGE_TARGET_PROOF', 'Target identity, immutable fence and current permission pin are required.');
  requireValue(target.ready === true, 'INTERCHANGE_NOT_READY', 'Target storage is not ready for a reviewed candidate.');
  const profile = workspaceStateProfile();
  const legacy = workspaceStateProfile({});
  // The exact pre-ontology retained target capability remains sufficient for
  // its original profiles. It cannot admit a source carrying modern ontology.
  const { ontologyNamespaces: _ontologyCapabilities, ...retainedLegacyTarget } = profile;
  const modernSource = sourceProfile?.ontologyNamespaces !== undefined;
  requireValue(equal(target.profile, profile) || !modernSource && equal(target.profile, retainedLegacyTarget)
    || (sourceProfile === undefined || sourceProfile.id === STATE_PROFILE) && !modernSource && equal(target.profile, legacy),
  'INTERCHANGE_PROFILE', 'The exact target capability must support every declared source namespace.');
  requireValue(Array.isArray(target.stores) && equal(target.stores, target.profile.stores.map(store => ({ name: store.name, records: 0 }))) &&
    Array.isArray(target.categoryCounts) && equal(target.categoryCounts, profile.artifactCategories.map(category => ({ category, count: 0 }))) &&
    target.authorityRecords === 0 && Array.isArray(target.unexpectedEntries) && target.unexpectedEntries.length === 0,
  'INTERCHANGE_TARGET_NOT_EMPTY', 'Import requires no persisted stores, retained artifacts, existing authority or unclassified entries in the target.');
  return interchangeDigest(target);
}

/** Keeps ONLY inert historical candidates. It has no StateStore, filesystem or activation port. */
export class WorkspaceImportCandidateService {
  #hooks: WorkspaceImportHooks;
  #candidates = new Map<string, WorkspaceImportCandidate>();
  constructor(hooks: WorkspaceImportHooks) {
    requireValue(hooks && typeof hooks.source === 'function' && typeof hooks.target === 'function' && typeof hooks.assertCompleteRead === 'function',
      'INTERCHANGE_HOST_REQUIRED', 'Trusted current-source, target custody and complete-read host checks are mandatory.');
    this.#hooks = hooks;
  }
  #source(context: Context): WorkspaceInventory {
    const source = this.#hooks.source(structuredClone(context));
    requireValue(source?.ready === true, 'INTERCHANGE_NOT_READY', 'Complete source inventory is not currently ready.');
    return structuredClone(source.inventory);
  }
  #target(context: Context, targetId: string, sourceProfile?: StoreProfile): EmptyTargetInspection {
    const target = structuredClone(this.#hooks.target(structuredClone(context), targetId));
    requireValue(target?.targetId === targetId, 'INTERCHANGE_TARGET_CHANGED', 'The inspected target identity differs from the requested target.');
    proveEmptyWorkspaceTarget(target, sourceProfile); return target;
  }
  #read(context: Context, candidate: WorkspaceImportCandidate) {
    requireValue(candidate.contextDigest === interchangeDigest(context), 'INTERCHANGE_CONTEXT_CHANGED', 'Review the candidate with the same current account, role and epoch.');
    const inventory = this.#source(context);
    requireValue(interchangeDigest(inventory) === candidate.sourceInventoryDigest, 'INTERCHANGE_AUTHORITY_CHANGED', 'Source inventory or current access changed after preparation.');
    const archive = validateWorkspaceInterchange(canonicalInterchangeJson(candidate.archive), inventory);
    const historicalState = readHistoricalWorkspaceState(archive);
    authorize({ read: () => historicalState, update: async () => { throw new Error('Historical import is read-only.'); } }, context, 'admin');
    const guardResult: unknown = this.#hooks.assertCompleteRead(structuredClone(context), structuredClone(historicalState));
    if (guardResult !== undefined) {
      if (guardResult instanceof Promise) void guardResult.catch(() => {});
      throw new ChausarError('INTERCHANGE_HOST_GUARD', 'Complete-read admission must finish synchronously and return undefined; deferred or boolean admission is refused.');
    }
    const target = this.#target(context, candidate.targetId, archive.inventory.profile);
    requireValue(interchangeDigest(target) === candidate.targetProofDigest, 'INTERCHANGE_TARGET_CHANGED', 'Target identity, empty proof, current permissions or generation changed.');
    requireValue(target.workspaceId !== inventory.generation.workspaceId, 'INTERCHANGE_TARGET_IDENTITY', 'Root must allocate a distinct empty target workspace identity.');
  }
  prepare(contextInput: Context, input: { text: string; targetId: string }): WorkspaceImportCandidate {
    const context = structuredClone(contextInput);
    requireValue(input && identifier(input.targetId), 'INTERCHANGE_TARGET_PROOF', 'Choose one explicit root-owned target.');
    const inventory = this.#source(context);
    const archive = validateWorkspaceInterchange(input.text, inventory);
    const target = this.#target(context, input.targetId, archive.inventory.profile);
    const pins = { targetId: input.targetId, targetWorkspaceId: target.workspaceId, packageDigest: archive.digest,
      sourceInventoryDigest: interchangeDigest(inventory), targetProofDigest: interchangeDigest(target), contextDigest: interchangeDigest(context) };
    const candidate: WorkspaceImportCandidate = { format: 'chausar.workspace-import-candidate.v1', id: `import_${interchangeDigest(pins)}`,
      inert: true, activation: 'root-only', ...pins, archive };
    this.#read(context, candidate);
    // Host guards can inspect permission/readiness; re-read BOTH fences after them.
    requireValue(interchangeDigest(this.#source(context)) === candidate.sourceInventoryDigest, 'INTERCHANGE_AUTHORITY_CHANGED', 'Source changed during candidate preparation.');
    requireValue(proveEmptyWorkspaceTarget(this.#target(context, candidate.targetId)) === candidate.targetProofDigest, 'INTERCHANGE_TARGET_CHANGED', 'Target changed during candidate preparation.');
    requireValue(this.#candidates.has(candidate.id) || this.#candidates.size < 64, 'INTERCHANGE_LIMIT', 'Discard unused candidates before preparing more than sixty-four.');
    this.#candidates.set(candidate.id, structuredClone(candidate));
    return structuredClone(candidate);
  }
  /** Root must repeat these checks inside its exclusive activation/custody transaction. */
  review(contextInput: Context, input: { id: string; reviewedDigest: string }): WorkspaceImportCandidate {
    const context = structuredClone(contextInput); const candidate = this.#candidates.get(input?.id);
    requireValue(candidate, 'INTERCHANGE_CANDIDATE_NOT_FOUND', 'This process has no retained candidate with that identity.');
    requireValue(input.reviewedDigest === interchangeDigest(candidate), 'INTERCHANGE_REVIEW_CHANGED', 'Review the exact retained candidate content and pins.');
    this.#read(context, candidate);
    requireValue(interchangeDigest(this.#source(context)) === candidate.sourceInventoryDigest, 'INTERCHANGE_AUTHORITY_CHANGED', 'Source changed during candidate review.');
    requireValue(proveEmptyWorkspaceTarget(this.#target(context, candidate.targetId)) === candidate.targetProofDigest, 'INTERCHANGE_TARGET_CHANGED', 'Target changed during candidate review.');
    return structuredClone(candidate);
  }
  discard(context: Context, id: string): void {
    const candidate = this.#candidates.get(id);
    requireValue(candidate, 'INTERCHANGE_CANDIDATE_NOT_FOUND', 'This process has no retained candidate with that identity.');
    requireValue(interchangeDigest(context) === candidate.contextDigest, 'INTERCHANGE_CONTEXT_CHANGED', 'Only the preparing context can discard this inert in-memory candidate.');
    this.#candidates.delete(id);
  }
}
