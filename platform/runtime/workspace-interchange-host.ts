import { authorize, ChausarError, newId, type Context, type State } from './contracts.ts';
import {
  canonicalInterchangeJson, captureWorkspaceInterchange, encodeWorkspaceInterchange,
  interchangeDigest, readHistoricalWorkspaceState, validateWorkspaceInterchange,
} from './workspace-interchange.ts';
import { proveEmptyWorkspaceTarget, WorkspaceImportCandidateService } from './workspace-import-candidate.ts';
import type {
  ArtifactCapture, EmptyTargetInspection, WorkspaceImportCandidate, WorkspaceInterchange, WorkspaceInventory,
} from './workspace-interchange-contracts.ts';

/** Root holds its source transaction through the entire callback, including custody writes. */
export type WorkspaceInterchangeSourceLease = {
  ready: boolean;
  state: State;
  artifacts: ArtifactCapture;
  /** CURRENT complete owner, source/row scope and consumer readiness; never historical membership alone. */
  assertCompleteOwner(context: Context, historicalState: State): Promise<void>;
  /** Re-read the captured authority/artifact/access fence. Refuse expiry or ambiguity. */
  assertCurrent(): Promise<void>;
};

/** Root allocation is exclusive and uninitialized, not a pre-created Vault. */
export type WorkspaceInterchangeTargetLease = {
  inspection: EmptyTargetInspection;
  assertCurrent(): Promise<void>;
};

type CommonPin = {
  format: 'chausar.interchange-custody-pin.v1';
  recordId: string;
  /** Unique creation-instance identity; exact pin CAS must not delete a later same-content replacement. */
  creationId: string;
  contextDigest: string;
  /** Independently issued from fenced root capture, stored apart from archive ciphertext. */
  inventory: WorkspaceInventory;
  packageDigest: string;
};
export type WorkspaceInterchangeCustodyPin =
  | CommonPin & { kind: 'export' }
  | CommonPin & { kind: 'candidate'; candidateDigest: string; target: EmptyTargetInspection };

export type WorkspaceInterchangeCustodyRecord = {
  /** Open wire or inert candidate JSON; this port alone may retain plaintext in private memory. */
  content: string;
  pin: WorkspaceInterchangeCustodyPin;
};

export type WorkspaceInterchangeCustodyMeasurement = {
  encrypted: true;
  archiveCiphertextBytes: number;
  inventoryPinCiphertextBytes: number;
  /** Test measurements must not be reported as qualified installed custody. */
  qualification: 'test-fixture' | 'encrypted-local-host';
};

/**
 * Constructor-only trusted ports. None are IPC payloads or user-supplied callbacks.
 * The archive and independently authenticated pin must commit together without
 * overwrite. read must authenticate BOTH ciphertexts and their record binding.
 * remove compares both expected digests and deletes only that owned record.
 * A failed create must leave no partially committed record.
 */
export type WorkspaceInterchangeHostPorts = {
  withSource<T>(context: Context, expected: WorkspaceInventory | null,
    work: (lease: WorkspaceInterchangeSourceLease) => Promise<T>): Promise<T>;
  withTarget<T>(context: Context, input: { targetId: string; mode: 'allocate' | 'existing' },
    work: (lease: WorkspaceInterchangeTargetLease) => Promise<T>): Promise<T>;
  custody: {
    create(context: Context, record: WorkspaceInterchangeCustodyRecord): Promise<WorkspaceInterchangeCustodyMeasurement>;
    read(context: Context, recordId: string): Promise<WorkspaceInterchangeCustodyRecord & { measurement: WorkspaceInterchangeCustodyMeasurement }>;
    remove(context: Context, input: { recordId: string; expectedPinDigest: string; expectedContentDigest: string }): Promise<void>;
  };
  /** Optional separate explicit open export. create is atomic/no-overwrite; remove is exact owned-output CAS. */
  plaintext?: {
    create(context: Context, input: { destinationId: string; creationId: string; text: string; packageDigest: string },
      assertCurrent: () => Promise<void>): Promise<{ utf8Bytes: number; creationId: string }>;
    remove(context: Context, input: { destinationId: string; creationId: string; expectedContentDigest: string }): Promise<void>;
  };
};

export type WorkspaceInterchangeHostSummary = {
  schemaVersion: 1;
  recordId: string;
  kind: 'export' | 'candidate';
  inert: true;
  activation: 'root-only';
  packageDigest: string;
  reviewedDigest: string;
  source: { workspaceId: string; revision: number; inventoryDigest: string };
  target?: { targetId: string; workspaceId: string; proofDigest: string };
  inventory: { stores: number; records: number; artifacts: number; categoryCounts: { category: string; count: number }[] };
  bytes: { wireUtf8: number; retainedArtifacts: number; archiveCiphertext: number; inventoryPinCiphertext: number };
  custodyQualification: WorkspaceInterchangeCustodyMeasurement['qualification'];
};

function requireValue(condition: unknown, code: string, message: string): asserts condition {
  if (!condition) throw new ChausarError(code, message);
}
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value);
const digest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const equal = (a: unknown, b: unknown) => canonicalInterchangeJson(a) === canonicalInterchangeJson(b);
function exact(value: unknown, keys: string[]) {
  canonicalInterchangeJson(value);
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value)
    && equal(Object.keys(value).sort(), [...keys].sort()), 'INTERCHANGE_HOST_RECORD', 'Custody fields must match the reviewed host format.');
}
async function completed(work: () => Promise<void>) {
  const result: unknown = await work();
  requireValue(result === undefined, 'INTERCHANGE_HOST_GUARD', 'Trusted custody guards must complete and return no admission value.');
}
function owner(context: Context, state: State) {
  requireValue(context.channel === 'desktop' && !context.sourceTainted, 'APP_APPROVAL_REQUIRED', 'Complete workspace portability requires the untainted desktop owner.');
  const member = authorize({ read: () => state, update: async () => { throw new Error('Historical state is inert.'); } }, context, 'admin');
  requireValue(member.role === 'owner' && member.branches.includes('*'), 'FORBIDDEN', 'Only an unrestricted current workspace owner may copy the complete workspace.');
}
function measurement(value: WorkspaceInterchangeCustodyMeasurement) {
  exact(value, ['encrypted', 'archiveCiphertextBytes', 'inventoryPinCiphertextBytes', 'qualification']);
  requireValue(value.encrypted === true && ['test-fixture', 'encrypted-local-host'].includes(value.qualification)
    && Number.isSafeInteger(value.archiveCiphertextBytes) && value.archiveCiphertextBytes > 0
    && Number.isSafeInteger(value.inventoryPinCiphertextBytes) && value.inventoryPinCiphertextBytes > 0,
  'INTERCHANGE_HOST_CUSTODY', 'Encrypted archive and independent pin require measured positive ciphertext sizes.');
}

/** Async fenced orchestration. No filesystem, StateStore, scheduler, provider or activation capability. */
export class WorkspaceInterchangeHost {
  #ports: WorkspaceInterchangeHostPorts;
  constructor(ports: WorkspaceInterchangeHostPorts) {
    requireValue(ports && typeof ports.withSource === 'function' && typeof ports.withTarget === 'function'
      && typeof ports.custody?.create === 'function' && typeof ports.custody?.read === 'function'
      && typeof ports.custody?.remove === 'function', 'INTERCHANGE_HOST_REQUIRED', 'Fenced source, exclusive target and encrypted independent-pin custody ports are required.');
    this.#ports = ports;
  }
  async #source<T>(contextInput: Context, expected: WorkspaceInventory | null,
    work: (capture: { inventory: WorkspaceInventory; package: WorkspaceInterchange }, lease: WorkspaceInterchangeSourceLease,
      assertCurrent: () => Promise<void>) => Promise<T>): Promise<T> {
    const context = structuredClone(contextInput); let calls = 0;
    const result = await this.#ports.withSource(structuredClone(context), expected ? structuredClone(expected) : null, async lease => {
      requireValue(++calls === 1 && lease && typeof lease.assertCurrent === 'function'
        && typeof lease.assertCompleteOwner === 'function', 'INTERCHANGE_HOST_CUSTODY', 'Root must issue exactly one fenced source lease.');
      requireValue(lease.ready === true, 'INTERCHANGE_NOT_READY', 'The complete source/artifact inventory is not currently ready.');
      const state = structuredClone(lease.state), artifacts = structuredClone(lease.artifacts);
      owner(context, state);
      const assertCurrent = async () => {
        await completed(() => lease.assertCompleteOwner(structuredClone(context), structuredClone(state)));
        await completed(() => lease.assertCurrent());
      };
      await assertCurrent();
      // ALL category witnesses and bodies come from this independent root capture.
      const capture = captureWorkspaceInterchange(state, artifacts);
      if (expected) requireValue(equal(capture.inventory, expected), 'INTERCHANGE_AUTHORITY_CHANGED', 'Current fenced source inventory differs from the independently retained custody pin.');
      await assertCurrent();
      const value = await work(capture, lease, assertCurrent);
      await assertCurrent(); return value;
    });
    requireValue(calls === 1, 'INTERCHANGE_HOST_CUSTODY', 'Root did not execute the fenced source transaction.');
    return result;
  }
  async #target<T>(context: Context, targetId: string, mode: 'allocate' | 'existing', sourceId: string,
    sourceCurrent: () => Promise<void>, work: (target: EmptyTargetInspection, assertCurrent: () => Promise<void>) => Promise<T>): Promise<T> {
    requireValue(id(targetId), 'INTERCHANGE_TARGET_PROOF', 'Choose an explicit root-owned target identity.');
    let calls = 0;
    const result = await this.#ports.withTarget(structuredClone(context), { targetId, mode }, async lease => {
      requireValue(++calls === 1 && lease && typeof lease.assertCurrent === 'function', 'INTERCHANGE_HOST_CUSTODY', 'Root must issue exactly one exclusive target lease.');
      const target = structuredClone(lease.inspection);
      requireValue(target.targetId === targetId, 'INTERCHANGE_TARGET_CHANGED', 'Root inspected a different target.');
      proveEmptyWorkspaceTarget(target);
      requireValue(target.workspaceId !== sourceId, 'INTERCHANGE_TARGET_IDENTITY', 'Allocate a distinct uninitialized target identity.');
      const assertCurrent = async () => { await sourceCurrent(); await completed(() => lease.assertCurrent()); };
      await assertCurrent(); const value = await work(target, assertCurrent); await assertCurrent(); return value;
    });
    requireValue(calls === 1, 'INTERCHANGE_HOST_CUSTODY', 'Root did not execute the exclusive target transaction.');
    return result;
  }
  #candidate(context: Context, archive: WorkspaceInterchange, inventory: WorkspaceInventory, target: EmptyTargetInspection) {
    // The async CURRENT root guards already completed under both held leases.
    // This pure builder additionally checks historical owner/pins and stays inert.
    return new WorkspaceImportCandidateService({
      source: () => ({ ready: true, inventory }), target: () => target,
      assertCompleteRead: (ctx, historical) => owner(ctx, historical),
    }).prepare(context, { text: encodeWorkspaceInterchange(archive), targetId: target.targetId });
  }
  #checked(record: WorkspaceInterchangeCustodyRecord, recordId: string, context: Context) {
    exact(record, ['content', 'pin']);
    requireValue(typeof record.content === 'string', 'INTERCHANGE_HOST_RECORD', 'Private encrypted custody must return bounded JSON text.');
    const pin = record.pin;
    requireValue(pin !== null && typeof pin === 'object' && !Array.isArray(pin), 'INTERCHANGE_HOST_RECORD', 'The independent encrypted custody pin is required.');
    exact(pin, pin.kind === 'candidate'
      ? ['format', 'recordId', 'creationId', 'contextDigest', 'inventory', 'packageDigest', 'kind', 'candidateDigest', 'target']
      : ['format', 'recordId', 'creationId', 'contextDigest', 'inventory', 'packageDigest', 'kind']);
    requireValue(pin.format === 'chausar.interchange-custody-pin.v1' && ['export', 'candidate'].includes(pin.kind)
      && pin.recordId === recordId && id(recordId) && id(pin.creationId) && digest(pin.contextDigest) && digest(pin.packageDigest),
    'INTERCHANGE_HOST_RECORD', 'The independent custody pin is malformed or belongs to another record.');
    requireValue(pin.contextDigest === interchangeDigest(context), 'INTERCHANGE_CONTEXT_CHANGED', 'Use the same current owner, role, epoch and channel that issued this archive.');
    let archive: WorkspaceInterchange;
    let candidate: WorkspaceImportCandidate | undefined;
    if (pin.kind === 'candidate') {
      let parsed: unknown; try { parsed = JSON.parse(record.content); } catch { throw new ChausarError('INTERCHANGE_HOST_RECORD', 'The encrypted candidate JSON is malformed.'); }
      requireValue(canonicalInterchangeJson(parsed) === record.content && digest(pin.candidateDigest),
        'INTERCHANGE_HOST_RECORD', 'Only canonical pinned candidate JSON is accepted.');
      exact(parsed, ['format', 'id', 'inert', 'activation', 'targetId', 'targetWorkspaceId', 'packageDigest', 'sourceInventoryDigest', 'targetProofDigest', 'contextDigest', 'archive']);
      candidate = parsed as WorkspaceImportCandidate;
      archive = validateWorkspaceInterchange(canonicalInterchangeJson(candidate.archive), pin.inventory);
      const expected = this.#candidate(context, archive, pin.inventory, pin.target);
      requireValue(equal(candidate, expected) && interchangeDigest(candidate) === pin.candidateDigest,
        'INTERCHANGE_REVIEW_CHANGED', 'The retained candidate differs from the independent inventory/target/context pin.');
    } else archive = validateWorkspaceInterchange(record.content, pin.inventory);
    requireValue(archive.digest === pin.packageDigest, 'INTERCHANGE_REVIEW_CHANGED', 'The archive differs from its independently issued package pin.');
    return { archive, candidate, pin };
  }
  async #read(context: Context, recordId: string) {
    requireValue(id(recordId), 'INTERCHANGE_HOST_RECORD', 'Choose an explicit root-owned encrypted record.');
    const read = await this.#ports.custody.read(structuredClone(context), recordId);
    exact(read, ['content', 'pin', 'measurement']); measurement(read.measurement);
    const record: WorkspaceInterchangeCustodyRecord = { content: read.content, pin: structuredClone(read.pin) };
    const checked = this.#checked(record, recordId, context);
    return { ...checked, record, measurement: structuredClone(read.measurement) };
  }
  #summary(record: WorkspaceInterchangeCustodyRecord, measured: WorkspaceInterchangeCustodyMeasurement): WorkspaceInterchangeHostSummary {
    const pin = record.pin, inventory = pin.inventory;
    return {
      schemaVersion: 1, recordId: pin.recordId, kind: pin.kind, inert: true, activation: 'root-only',
      packageDigest: pin.packageDigest, reviewedDigest: pin.kind === 'candidate' ? pin.candidateDigest : pin.packageDigest,
      source: { workspaceId: inventory.generation.workspaceId, revision: inventory.generation.revision, inventoryDigest: interchangeDigest(inventory) },
      ...(pin.kind === 'candidate' ? { target: { targetId: pin.target.targetId, workspaceId: pin.target.workspaceId, proofDigest: proveEmptyWorkspaceTarget(pin.target) } } : {}),
      inventory: { stores: inventory.stores.length, records: inventory.stores.reduce((total, store) => total + store.records, 0),
        artifacts: inventory.artifacts.length, categoryCounts: structuredClone(inventory.categoryCounts) },
      bytes: { wireUtf8: Buffer.byteLength(record.content), retainedArtifacts: inventory.artifacts.reduce((total, item) => total + item.bytes, 0),
        archiveCiphertext: measured.archiveCiphertextBytes, inventoryPinCiphertext: measured.inventoryPinCiphertextBytes },
      custodyQualification: measured.qualification,
    };
  }
  async #creationAttempt(context: Context,
    work: (remember: (record: WorkspaceInterchangeCustodyRecord) => void) => Promise<WorkspaceInterchangeHostSummary>) {
    let created: WorkspaceInterchangeCustodyRecord | undefined;
    try {
      return await work(record => {
        requireValue(created === undefined, 'INTERCHANGE_HOST_CUSTODY', 'One custody attempt may create only one owned record.');
        created = structuredClone(record);
      });
    } catch (error) {
      if (created) {
        const record = created;
        try {
          // Includes failures in final source/target assertions or lease exit.
          // This exact private cleanup may run after a failed lease exit; it does
          // not need permission to read/alter the current workspace authority.
          await completed(() => this.#ports.custody.remove(structuredClone(context), { recordId: record.pin.recordId,
            expectedPinDigest: interchangeDigest(record.pin), expectedContentDigest: interchangeDigest(record.content) }));
        } catch { throw new ChausarError('INTERCHANGE_CUSTODY_CLEANUP_REQUIRED', 'Custody failed after creation and the exact owned record could not be removed. Root must inspect it without activating or overwriting it.'); }
      }
      throw error;
    }
  }
  async #create(context: Context, record: WorkspaceInterchangeCustodyRecord, assertCurrent: () => Promise<void>,
    remember: (record: WorkspaceInterchangeCustodyRecord) => void) {
    await assertCurrent();
    const measured = await this.#ports.custody.create(structuredClone(context), structuredClone(record));
    remember(record);
    measurement(measured); await assertCurrent();
    const retained = await this.#read(context, record.pin.recordId);
    requireValue(equal(retained.record, record) && equal(retained.measurement, measured),
      'INTERCHANGE_HOST_CUSTODY', 'Encrypted readback differs from the exact archive, independent pin or measured bytes.');
    await assertCurrent(); return this.#summary(retained.record, retained.measurement);
  }
  /** Writes encrypted custody, not an automatic plaintext export or filesystem destination. */
  async export(contextInput: Context, input: { destinationId: string; confirmed: true }): Promise<WorkspaceInterchangeHostSummary> {
    exact(input, ['destinationId', 'confirmed']);
    const payload = structuredClone(input);
    requireValue(payload.confirmed === true && id(payload.destinationId), 'CONFIRMATION_REQUIRED', 'Confirm one explicit managed export destination.');
    const context = structuredClone(contextInput);
    return this.#creationAttempt(context, remember => this.#source(context, null, async (capture, _lease, assertCurrent) => this.#create(context, {
      content: encodeWorkspaceInterchange(capture.package),
      pin: { format: 'chausar.interchange-custody-pin.v1', kind: 'export', recordId: payload.destinationId, creationId: newId('interchange_creation'),
        contextDigest: interchangeDigest(context), inventory: capture.inventory, packageDigest: capture.package.digest },
    }, assertCurrent, remember)));
  }
  async prepare(contextInput: Context, input: { exportId: string; candidateId: string; targetId: string }): Promise<WorkspaceInterchangeHostSummary> {
    exact(input, ['exportId', 'candidateId', 'targetId']);
    const payload = structuredClone(input);
    requireValue(id(payload.candidateId) && payload.candidateId !== payload.exportId, 'INTERCHANGE_HOST_RECORD', 'Choose a separate explicit candidate custody identity.');
    const context = structuredClone(contextInput), retained = await this.#read(context, payload.exportId);
    requireValue(retained.pin.kind === 'export', 'INTERCHANGE_HOST_RECORD', 'Prepare from an independently pinned encrypted export.');
    return this.#creationAttempt(context, remember => this.#source(context, retained.pin.inventory, async (capture, lease, sourceCurrent) => {
      await completed(() => lease.assertCompleteOwner(structuredClone(context), readHistoricalWorkspaceState(retained.archive)));
      await sourceCurrent();
      return this.#target(context, payload.targetId, 'allocate', capture.inventory.generation.workspaceId, sourceCurrent, async (target, assertCurrent) => {
        const candidate = this.#candidate(context, retained.archive, capture.inventory, target);
        return this.#create(context, { content: canonicalInterchangeJson(candidate),
          pin: { format: 'chausar.interchange-custody-pin.v1', kind: 'candidate', recordId: payload.candidateId, creationId: newId('interchange_creation'),
            contextDigest: interchangeDigest(context), inventory: capture.inventory, packageDigest: retained.archive.digest,
            candidateDigest: interchangeDigest(candidate), target } }, assertCurrent, remember);
      });
    }));
  }
  /** Reopens durable encrypted custody and rechecks both actual fences; this does not activate. */
  async review(contextInput: Context, input: { candidateId: string; reviewedDigest: string }): Promise<WorkspaceInterchangeHostSummary> {
    exact(input, ['candidateId', 'reviewedDigest']);
    const payload = structuredClone(input);
    const context = structuredClone(contextInput), retained = await this.#read(context, payload.candidateId);
    requireValue(retained.pin.kind === 'candidate' && payload.reviewedDigest === retained.pin.candidateDigest,
      'INTERCHANGE_REVIEW_CHANGED', 'Review the exact privately retained candidate digest.');
    const pin = retained.pin;
    return this.#source(context, pin.inventory, async (_capture, lease, sourceCurrent) => {
      await completed(() => lease.assertCompleteOwner(structuredClone(context), readHistoricalWorkspaceState(retained.archive)));
      return this.#target(context, pin.target.targetId, 'existing', pin.inventory.generation.workspaceId, sourceCurrent, async (target, assertCurrent) => {
        requireValue(equal(target, pin.target), 'INTERCHANGE_TARGET_CHANGED', 'The actual empty target identity, access or generation changed after preparation.');
        await assertCurrent();
        const current = await this.#read(context, payload.candidateId);
        requireValue(equal(current.record, retained.record), 'INTERCHANGE_REVIEW_CHANGED', 'Encrypted candidate custody changed during review.');
        await assertCurrent(); return this.#summary(current.record, current.measurement);
      });
    });
  }
  /** Discards the owned archive/pin only. Root retains target reservation disposition. */
  async discard(contextInput: Context, input: { recordId: string; reviewedDigest: string }): Promise<{ discarded: true; recordId: string }> {
    exact(input, ['recordId', 'reviewedDigest']);
    const payload = structuredClone(input);
    const context = structuredClone(contextInput), retained = await this.#read(context, payload.recordId);
    const expected = retained.pin.kind === 'candidate' ? retained.pin.candidateDigest : retained.pin.packageDigest;
    requireValue(payload.reviewedDigest === expected, 'INTERCHANGE_REVIEW_CHANGED', 'Discard only the exact reviewed encrypted record.');
    return this.#source(context, null, async (capture, lease, assertCurrent) => {
      requireValue(capture.inventory.generation.workspaceId === retained.pin.inventory.generation.workspaceId,
        'INTERCHANGE_AUTHORITY_CHANGED', 'This archive belongs to another source workspace.');
      await completed(() => lease.assertCompleteOwner(structuredClone(context), readHistoricalWorkspaceState(retained.archive)));
      await assertCurrent();
      await completed(() => this.#ports.custody.remove(structuredClone(context), { recordId: payload.recordId,
        expectedPinDigest: interchangeDigest(retained.record.pin), expectedContentDigest: interchangeDigest(retained.record.content) }));
      return { discarded: true as const, recordId: payload.recordId };
    });
  }
  /** Explicit confirmed open interchange export, entirely separate from encrypted default custody. */
  async exportPlaintext(contextInput: Context, input: { destinationId: string; confirmed: true }) {
    exact(input, ['destinationId', 'confirmed']);
    const payload = structuredClone(input);
    requireValue(payload.confirmed === true && id(payload.destinationId), 'CONFIRMATION_REQUIRED', 'Confirm one explicit open export destination.');
    const writer = this.#ports.plaintext;
    requireValue(writer && typeof writer.create === 'function' && typeof writer.remove === 'function',
      'INTERCHANGE_PLAINTEXT_UNAVAILABLE', 'Root has not supplied explicit atomic plaintext creation and exact removal ports.');
    const context = structuredClone(contextInput);
    const creationId = newId('interchange_open_creation');
    let createdText: string | undefined;
    try {
      return await this.#source(context, null, async (capture, _lease, assertCurrent) => {
        const text = encodeWorkspaceInterchange(capture.package); await assertCurrent();
        const result = await writer.create(structuredClone(context), { destinationId: payload.destinationId, creationId, text, packageDigest: capture.package.digest }, assertCurrent);
        createdText = text;
        exact(result, ['utf8Bytes', 'creationId']);
        requireValue(result.utf8Bytes === Buffer.byteLength(text) && result.creationId === creationId,
          'INTERCHANGE_HOST_CUSTODY', 'Open-export custody must report the exact UTF-8 byte count and creation identity.');
        await assertCurrent();
        return { schemaVersion: 1 as const, destinationId: payload.destinationId, packageDigest: capture.package.digest,
          utf8Bytes: result.utf8Bytes, encrypted: false as const, confirmed: true as const };
      });
    } catch (error) {
      if (createdText !== undefined) {
        const text = createdText;
        try { await completed(() => writer.remove(structuredClone(context), { destinationId: payload.destinationId, creationId, expectedContentDigest: interchangeDigest(text) })); }
        catch { throw new ChausarError('INTERCHANGE_PLAINTEXT_CLEANUP_REQUIRED', 'Open export failed after persistence and its exact owned output could not be removed. Root must inspect the explicitly selected destination.'); }
      }
      throw error;
    }
  }
}
