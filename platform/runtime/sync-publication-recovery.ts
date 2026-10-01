import { hash } from './contracts.ts';
import type { SyncHead, SyncSnapshot, SyncTransport } from './sync.ts';

export type SyncPublicationExpected = {
  recordHash: string;
  workspaceId: string;
  vaultId: string;
  revision: number;
  sequence: number;
  fence: number;
  expectedHeadHash: string | null;
};

export type SyncPublicationReason =
  | 'HEAD_MATCH' | 'ANCESTOR_MATCH' | 'HEAD_UNCHANGED_RECORD_ABSENT'
  | 'INVALID_EXPECTATION' | 'INVALID_BOUND' | 'HEAD_UNREADABLE' | 'HEAD_INVALID'
  | 'IDENTITY_MISMATCH' | 'RECORD_UNREADABLE' | 'RECORD_INVALID'
  | 'RECORD_HASH_MISMATCH' | 'CIPHERTEXT_DIGEST_MISMATCH'
  | 'EXPECTED_RECORD_MISMATCH' | 'HEAD_RECORD_MISMATCH'
  | 'ORPHAN_RECORD' | 'CHAIN_INCOMPLETE' | 'CHAIN_INVALID'
  | 'CHAIN_BOUND' | 'HEAD_CHANGED_UNPROVEN';

type Observation = {
  /** The detached head observed at the start of this read, not a promise about the current head. */
  observedHead: Readonly<SyncHead> | null;
  recordsRead: number;
  automaticResubmission: false;
};

export type SyncPublicationResult =
  | (Observation & { status: 'published'; reason: 'HEAD_MATCH' | 'ANCESTOR_MATCH'; recordHash: string })
  | (Observation & { status: 'not-observed'; reason: 'HEAD_UNCHANGED_RECORD_ABSENT' })
  | (Observation & { status: 'unknown'; reason: Exclude<SyncPublicationReason, 'HEAD_MATCH' | 'ANCESTOR_MATCH' | 'HEAD_UNCHANGED_RECORD_ABSENT'> });

const MAX_RECORDS = 1024;
const digest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const identity = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const integer = (value: unknown, minimum: number): value is number => Number.isSafeInteger(value) && (value as number) >= minimum;
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

function validExpected(value: unknown): value is SyncPublicationExpected {
  if (!object(value)) return false;
  return digest(value.recordHash) && identity(value.workspaceId) && identity(value.vaultId)
    && integer(value.revision, 0) && integer(value.sequence, 1) && integer(value.fence, 1)
    && (value.expectedHeadHash === null || digest(value.expectedHeadHash))
    && (value.sequence === 1) === (value.expectedHeadHash === null)
    && value.expectedHeadHash !== value.recordHash;
}

function validHead(value: unknown): value is SyncHead {
  return object(value) && exactKeys(value, ['recordHash', 'workspaceId', 'vaultId', 'revision', 'sequence', 'fence'])
    && digest(value.recordHash) && identity(value.workspaceId) && identity(value.vaultId)
    && integer(value.revision, 0) && integer(value.sequence, 1) && integer(value.fence, 1);
}

function validRecord(value: unknown): value is SyncSnapshot {
  if (!object(value) || !exactKeys(value, ['format', 'workspaceId', 'vaultId', 'revision', 'sequence', 'fence', 'deviceId', 'signerId', 'memberId', 'epoch', 'createdAt', 'previousHash', 'ciphertextBase64', 'ciphertextDigest', 'signature'])) return false;
  return value.format === 'chausar.sync.v1' && identity(value.workspaceId) && identity(value.vaultId)
    && integer(value.revision, 0) && integer(value.sequence, 1) && integer(value.fence, 1)
    && identity(value.deviceId) && identity(value.signerId) && identity(value.memberId) && integer(value.epoch, 1)
    && typeof value.createdAt === 'string' && Number.isFinite(Date.parse(value.createdAt))
    && (value.previousHash === null || digest(value.previousHash))
    && (value.sequence === 1) === (value.previousHash === null)
    && identity(value.ciphertextBase64) && digest(value.ciphertextDigest) && identity(value.signature);
}

const sameMetadata = (record: SyncSnapshot, head: SyncHead) => record.workspaceId === head.workspaceId
  && record.vaultId === head.vaultId && record.revision === head.revision
  && record.sequence === head.sequence && record.fence === head.fence;

/**
 * Reconcile a lost publication acknowledgement without acquiring a lease, writing a blob,
 * changing receipts, or retrying. Reachability from the observed head proves transport
 * publication only. This does not verify a signer, authorize a writer, validate/decrypt a
 * Vault.backup envelope, restore a vault, or qualify a cloud folder or remote peer.
 * The SyncService receiver remains responsible for signature and authorization checks.
 * A not-observed result is limited read evidence and never permission to resubmit.
 */
export async function reconcileSyncPublication(
  transport: Pick<SyncTransport, 'getHead' | 'get'>,
  expected: SyncPublicationExpected,
  options: { maxRecords?: number } = {},
): Promise<SyncPublicationResult> {
  let observedHead: SyncHead | null = null;
  let recordsRead = 0;
  const observation = (): Observation => ({ observedHead, recordsRead, automaticResubmission: false });
  const unknown = (reason: Extract<SyncPublicationResult, { status: 'unknown' }>['reason']): SyncPublicationResult => Object.freeze({ ...observation(), status: 'unknown', reason });
  let target: SyncPublicationExpected;
  let maxRecords: number;
  try {
    target = structuredClone(expected);
    if (!validExpected(target)) return unknown('INVALID_EXPECTATION');
    maxRecords = options.maxRecords ?? MAX_RECORDS;
    if (!integer(maxRecords, 1) || maxRecords > MAX_RECORDS) return unknown('INVALID_BOUND');
  } catch { return unknown('INVALID_EXPECTATION'); }

  try {
    const head = structuredClone(await transport.getHead());
    if (head !== null && !validHead(head)) return unknown('HEAD_INVALID');
    observedHead = head === null ? null : Object.freeze(head);
  } catch { return unknown('HEAD_UNREADABLE'); }
  if (observedHead && (observedHead.workspaceId !== target.workspaceId || observedHead.vaultId !== target.vaultId)) return unknown('IDENTITY_MISMATCH');

  const readRecord = async (recordHash: string): Promise<SyncSnapshot | null | SyncPublicationResult> => {
    if (recordsRead >= maxRecords) return unknown('CHAIN_BOUND');
    recordsRead++;
    let record: unknown;
    try { record = structuredClone(await transport.get(recordHash)); }
    catch { return unknown('RECORD_UNREADABLE'); }
    if (record === null) return null;
    if (!validRecord(record)) return unknown('RECORD_INVALID');
    if (hash(record) !== recordHash) return unknown('RECORD_HASH_MISMATCH');
    if (hash(record.ciphertextBase64) !== record.ciphertextDigest) return unknown('CIPHERTEXT_DIGEST_MISMATCH');
    if (record.workspaceId !== target.workspaceId || record.vaultId !== target.vaultId) return unknown('IDENTITY_MISMATCH');
    return record;
  };
  const isResult = (value: SyncSnapshot | null | SyncPublicationResult): value is SyncPublicationResult => value !== null && 'status' in value;
  const expectedRecord = await readRecord(target.recordHash);
  if (isResult(expectedRecord)) return expectedRecord;
  const headUnchanged = (observedHead?.recordHash ?? null) === target.expectedHeadHash;
  if (expectedRecord === null) {
    if (headUnchanged) return Object.freeze({ ...observation(), status: 'not-observed', reason: 'HEAD_UNCHANGED_RECORD_ABSENT' });
    return unknown(observedHead?.recordHash === target.recordHash ? 'CHAIN_INCOMPLETE' : 'HEAD_CHANGED_UNPROVEN');
  }
  if (expectedRecord.revision !== target.revision || expectedRecord.sequence !== target.sequence
    || expectedRecord.fence !== target.fence || expectedRecord.previousHash !== target.expectedHeadHash) return unknown('EXPECTED_RECORD_MISMATCH');
  if (!observedHead || headUnchanged) return unknown('ORPHAN_RECORD');

  const published = (reason: 'HEAD_MATCH' | 'ANCESTOR_MATCH'): SyncPublicationResult => Object.freeze({ ...observation(), status: 'published', reason, recordHash: target.recordHash });
  if (observedHead.recordHash === target.recordHash) {
    if (!sameMetadata(expectedRecord, observedHead)) return unknown('HEAD_RECORD_MISMATCH');
    return published('HEAD_MATCH');
  }

  let recordHash: string | null = observedHead.recordHash;
  let descendant: SyncSnapshot | undefined;
  const seen = new Set<string>();
  while (recordHash) {
    if (seen.has(recordHash)) return unknown('CHAIN_INVALID');
    seen.add(recordHash);
    const record: SyncSnapshot | null | SyncPublicationResult = recordHash === target.recordHash ? expectedRecord : await readRecord(recordHash);
    if (isResult(record)) return record;
    if (record === null) return unknown('CHAIN_INCOMPLETE');
    if (!descendant && !sameMetadata(record, observedHead)) return unknown('HEAD_RECORD_MISMATCH');
    if (descendant && (record.revision >= descendant.revision || record.sequence !== descendant.sequence - 1 || record.fence > descendant.fence)) return unknown('CHAIN_INVALID');
    if (recordHash === target.recordHash) return published('ANCESTOR_MATCH');
    descendant = record;
    recordHash = record.previousHash;
  }
  return unknown('HEAD_CHANGED_UNPROVEN');
}
