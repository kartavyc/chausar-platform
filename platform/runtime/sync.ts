import { generateKeyPairSync, createPrivateKey, createPublicKey, sign, verify, KeyObject } from 'node:crypto';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { authorize, audit, check, ChausarError, hash, newId, now } from './contracts.ts';
import type { Context, State, StateStore } from './contracts.ts';
import { assertSourceAccess, trustFingerprint } from './trust.ts';
import { Vault, safeDirectory } from './vault.ts';
import type { RestoreVaultOptions } from './vault.ts';
import type { SyncWriterAdmission } from './sync-writer-admission.ts';
import { reconcileSyncPublication } from './sync-publication-recovery.ts';

export type SyncHead = { recordHash: string; workspaceId: string; vaultId: string; revision: number; sequence: number; fence: number };
export type SyncLease = { deviceId: string; memberId: string; epoch: number; fence: number; expiresAt: string; token: string };
export type SyncSnapshot = { format: 'chausar.sync.v1'; workspaceId: string; vaultId: string; revision: number; sequence: number; fence: number; deviceId: string; signerId: string; memberId: string; epoch: number; createdAt: string; previousHash: string | null; ciphertextBase64: string; ciphertextDigest: string; signature: string };
/** Implementations must make lease acquisition and fenced head CAS atomic. Blobs contain encrypted backups only. */
export interface SyncTransport {
  kind: string;
  scope?: { fileIds: string[]; broadAccess?: boolean };
  getHead(): Promise<SyncHead | null>;
  acquireLease(input: { deviceId: string; memberId: string; epoch: number; now: string; ttlMs: number }): Promise<SyncLease | null>;
  put(input: { lease: SyncLease; expectedHeadHash: string | null; recordHash: string; snapshot: SyncSnapshot; now: string }): Promise<SyncHead>;
  get(recordHash: string): Promise<SyncSnapshot | null>;
}
export type SyncOptions = { transport?: SyncTransport; deviceId?: string; signerId?: string; signingKey?: KeyObject | string; trustedSigners?: Record<string, { publicKey: KeyObject | string; memberId: string; epoch: number }>; vault?: Pick<Vault, 'backup' | 'directory'> & { readonly vaultId?: string }; enabled?: boolean; clock?: () => Date; leaseTtlMs?: number; workspaceId?: string; mode?: 'single-writer' | 'multi-writer'; writerAdmission?: SyncWriterAdmission; requireWriterAdmission?: boolean };

function signedBody(snapshot: SyncSnapshot): string { const { signature: _, ...body } = snapshot; return JSON.stringify(body); }
export function snapshotHash(snapshot: SyncSnapshot): string { return hash(snapshot); }
function stateFingerprint(state: State): string {
  return hash({ ...state, revision: 0, modelReceipts: state.modelReceipts.filter(r => !String(r.kind).startsWith('sync-')), activity: state.activity.filter(a => !String(a.event).startsWith('sync.')) });
}
function opaqueBackup(value: string): { vaultId: string; revision: number } {
  check(Buffer.byteLength(value) <= 67108864, 'SYNC_TOO_LARGE', 'The encrypted backup exceeds the sync limit.');
  let backup: any; try { backup = JSON.parse(value); } catch { throw new ChausarError('INVALID_BACKUP', 'Sync requires a valid encrypted Vault.backup envelope.'); }
  check(backup?.backupFormat === 'chausar.backup.v1' && Object.keys(backup).every(k => ['backupFormat', 'envelope'].includes(k)), 'INVALID_BACKUP', 'Plaintext exports cannot be synchronized.');
  const envelope = backup.envelope;
  check(envelope?.format === 'chausar.vault.v1' && typeof envelope.id === 'string' && Number.isSafeInteger(envelope.revision) && envelope.revision >= 0 && Object.keys(envelope).every(k => ['format', 'id', 'revision', 'passphrase', 'recovery', 'snapshot'].includes(k)), 'INVALID_BACKUP', 'Sync requires a bounded encrypted snapshot.');
  for (const cipher of [envelope.snapshot, envelope.passphrase?.ciphertext, envelope.recovery?.ciphertext]) check(cipher && Object.keys(cipher).every(k => ['nonce', 'tag', 'data'].includes(k)) && typeof cipher.nonce === 'string' && typeof cipher.tag === 'string' && typeof cipher.data === 'string' && /^[A-Za-z0-9_-]+$/.test(cipher.data), 'INVALID_BACKUP', 'Raw keys and plaintext are not valid sync data.');
  for (const wrapper of [envelope.passphrase, envelope.recovery]) check(wrapper && Object.keys(wrapper).every(k => ['salt', 'kdf', 'ciphertext'].includes(k)) && wrapper.kdf === 'scrypt-32768-8-1' && typeof wrapper.salt === 'string' && /^[A-Za-z0-9_-]+$/.test(wrapper.salt), 'INVALID_BACKUP', 'The encrypted backup cannot carry raw key material.');
  return { vaultId: envelope.id, revision: envelope.revision };
}

export class SyncService {
  store: StateStore; options: SyncOptions; deviceId: string; signerId: string; #signingKey: KeyObject; #publicKey: KeyObject; #trusted = new Map<string, { publicKey: KeyObject; memberId: string; epoch: number }>(); #enabled: boolean;
  constructor(store: StateStore, options: SyncOptions = {}) {
    check(options.mode !== 'multi-writer', 'MULTIWRITER_UNSUPPORTED', 'Encrypted snapshot sync supports one writer only.');
    this.store = store; this.options = options; this.deviceId = options.deviceId || newId('device'); this.signerId = options.signerId || this.deviceId; this.#enabled = options.enabled ?? false;
    if (options.signingKey) { this.#signingKey = typeof options.signingKey === 'string' ? createPrivateKey(options.signingKey) : options.signingKey; this.#publicKey = createPublicKey(this.#signingKey); }
    else { const pair = generateKeyPairSync('ed25519'); this.#signingKey = pair.privateKey; this.#publicKey = pair.publicKey; }
    check(this.#signingKey.asymmetricKeyType === 'ed25519', 'INVALID_DEVICE_KEY', 'Sync requires an Ed25519 device signing key.');
    for (const [id, identity] of Object.entries(options.trustedSigners || {})) this.#trusted.set(id, { ...identity, publicKey: typeof identity.publicKey === 'string' ? createPublicKey(identity.publicKey) : identity.publicKey });
  }
  #time(): Date { return this.options.clock?.() || new Date(); }
  async #writerTransportOperation<T>(context: Context, vaultId: string, work: () => Promise<T>): Promise<T> {
    const admission = this.options.writerAdmission;
    if (!admission) {
      check(!this.options.requireWriterAdmission, 'SYNC_WRITER_ADMISSION_REQUIRED', 'Device publication requires separate reviewed writer admission.');
      return work();
    }
    check(admission.deviceId === this.deviceId, 'SYNC_WRITER_ADMISSION_REQUIRED', 'Writer admission must bind this configured device.');
    check(this.options.signingKey && this.options.deviceId && this.options.signerId, 'SYNC_DEVICE_CONFIGURATION_REQUIRED', 'Configure a persistent broker-supplied signing key and reviewed device identity before publication.');
    return admission.run({ state: this.store.read(), vaultId, context }, async assertCurrent => {
      assertCurrent(); const result = await work(); return { result, committedState: this.store.read() };
    });
  }
  #transport(context: Context): SyncTransport {
    const member = authorize(this.store, context, 'admin'); check(member.branches.includes('*'), 'SYNC_SCOPE_DENIED', 'Encrypted full-vault sync requires every branch.');
    assertSourceAccess(this.store.read(), context, [...new Set(this.store.read().facts.map(f => f.sourceId))]);
    check(this.#enabled && this.options.transport, 'SYNC_DISABLED', 'Encrypted device sync is off until a dedicated transport is configured.');
    if (/google.?drive/i.test(this.options.transport.kind)) check(this.options.transport.scope && this.options.transport.scope.fileIds.length > 0 && !this.options.transport.scope.broadAccess, 'SYNC_SCOPE_DENIED', 'Drive sync requires dedicated explicitly picked files and a narrow adapter scope.');
    return this.options.transport;
  }
  status(context: Context) { authorize(this.store, context); return { enabled: this.#enabled, deviceId: this.deviceId, transport: this.options.transport?.kind || null, mode: 'single-writer', experimental: true, verification: 'no-real-second-device-test', liveAuthorityOverwrite: false }; }
  /** Trusted Engine only: synchronous rollback of volatile settings within admission's lock. */
  configurationCheckpoint(): () => void {
    const enabled = this.#enabled, trusted = new Map(this.#trusted);
    return () => { this.#enabled = enabled; this.#trusted = new Map(trusted); };
  }
  #attached: SyncTransport | null = null;
  /**
   * Trusted host modules only: attach a dedicated, narrowly scoped Google Drive transport when the host configured
   * none, or detach the one attached here with null. A host-configured transport is never replaced. Any change turns
   * sync off until it is re-enabled through the Engine's writer-admitted `sync.enable`.
   */
  attachTransport(transport: SyncTransport | null): void {
    check(!this.options.transport || this.options.transport === this.#attached, 'SYNC_TRANSPORT_CONFIGURED', 'This device\'s sync transport was configured by the host and cannot be replaced.');
    if (transport) check(/google.?drive/i.test(transport.kind) && !!transport.scope && transport.scope.fileIds.length > 0 && transport.scope.broadAccess === false, 'SYNC_SCOPE_DENIED', 'Only a dedicated, narrowly scoped Drive folder can be attached.');
    this.#attached = transport; this.options = { ...this.options, transport: transport ?? undefined }; this.#enabled = false;
  }
  enable(context: Context, enabled: boolean) { authorize(this.store, context, 'admin'); check(typeof enabled === 'boolean', 'INVALID_SYNC_SETTING', 'Sync enablement must be boolean.'); this.#enabled = enabled; return this.status(context); }
  identity(context: Context) { authorize(this.store, context, 'admin'); return { deviceId: this.deviceId, signerId: this.signerId, publicKey: this.#publicKey.export({ format: 'pem', type: 'spki' }).toString() }; }
  trustDevice(context: Context, identity: { signerId: string; publicKey: string; memberId: string; epoch: number }) {
    authorize(this.store, context, 'admin'); const member = this.store.read().members.find(m => m.id === identity.memberId);
    check(member?.active && member.epoch === identity.epoch && ['owner', 'cofounder'].includes(member.role), 'ACCESS_REVOKED', 'A device signer must belong to a current workspace administrator.');
    let key: KeyObject; try { key = createPublicKey(identity.publicKey); } catch { throw new ChausarError('INVALID_DEVICE_KEY', 'The device public signing key is invalid.'); }
    check(key.asymmetricKeyType === 'ed25519' && typeof identity.signerId === 'string' && identity.signerId.length <= 200, 'INVALID_DEVICE_KEY', 'Use a named Ed25519 device identity.'); this.#trusted.set(identity.signerId, { publicKey: key, memberId: identity.memberId, epoch: identity.epoch }); return { signerId: identity.signerId, trusted: true };
  }
  async preview(context: Context) {
    const transport = this.#transport(context); const member = authorize(this.store, context, 'admin');
    check(member.branches.includes('*'), 'SYNC_SCOPE_DENIED', 'A full-vault sync requires access to every branch.');
    const sourceIds = [...new Set(this.store.read().facts.map(f => f.sourceId))]; assertSourceAccess(this.store.read(), context, sourceIds);
    const vault = this.options.vault || this.store as any; check(typeof vault.backup === 'function', 'BACKUP_REQUIRED', 'Sync payloads must be produced by Vault.backup.');
    const directory = await mkdtemp(join(tmpdir(), 'chausar-sync-'));
    try {
      const file = join(directory, 'encrypted.backup.json'); await vault.backup(file); const bytes = await readFile(file, 'utf8'); const envelope = opaqueBackup(bytes);
      authorize(this.store, context, 'admin'); assertSourceAccess(this.store.read(), context, sourceIds);
      check(envelope.revision === this.store.read().revision, 'SYNC_PREVIEW_STALE', 'The workspace changed while creating the encrypted backup.');
      const head = await transport.getHead(); authorize(this.store, context, 'admin');
      check(envelope.revision === this.store.read().revision, 'SYNC_PREVIEW_STALE', 'The workspace changed while checking the remote head.');
      check(!head || (head.workspaceId === (this.options.workspaceId || this.store.read().workspace.id) && head.vaultId === envelope.vaultId && envelope.revision > head.revision), 'SYNC_REPLAY', 'The remote head belongs to another vault or is not older than this snapshot.');
      const record = { id: newId('sync_preview'), kind: 'sync-preview', status: 'preview', createdAt: now(), memberId: context.memberId, epoch: context.epoch, deviceId: this.deviceId,
        sourceIds, trustFingerprint: trustFingerprint(this.store.read(), context, sourceIds), stateFingerprint: stateFingerprint(this.store.read()),
        workspaceId: this.options.workspaceId || this.store.read().workspace.id, vaultId: envelope.vaultId, revision: envelope.revision,
        payloadBase64: Buffer.from(bytes).toString('base64'), digest: hash(Buffer.from(bytes).toString('base64')), expectedHeadHash: head?.recordHash || null, sequence: (head?.sequence || 0) + 1,
        transport: transport.kind, experimental: true, receiptBoundary: 'encrypted-vault-backup-to-picked-sync-store' };
      return this.store.update(state => { authorize(this.store, context, 'admin'); state.modelReceipts.push(record); audit(state, 'sync.preview.created', { previewId: record.id, digest: record.digest }); return structuredClone(record); });
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
  #current(context: Context, preview: any) {
    this.#transport(context); check(preview.memberId === context.memberId && preview.epoch === context.epoch && preview.deviceId === this.deviceId, 'SYNC_ACCESS_DENIED', 'This encrypted copy belongs to another session or device.');
    const state = this.store.read(); assertSourceAccess(state, context, preview.sourceIds);
    check(preview.trustFingerprint === trustFingerprint(state, context, preview.sourceIds) && preview.stateFingerprint === stateFingerprint(state), 'SYNC_PREVIEW_STALE', 'Source data or permissions changed after sync preview.');
    check(hash(preview.payloadBase64) === preview.digest, 'SYNC_PAYLOAD_CHANGED', 'The encrypted sync payload changed.');
  }
  async approve(context: Context, previewId: string) {
    authorize(this.store, context, 'approve'); check(context.channel !== 'phone', 'APP_APPROVAL_REQUIRED', 'Approve a full encrypted vault copy inside the app.');
    return this.store.update(state => {
      authorize(this.store, context, 'approve'); const preview = state.modelReceipts.find(r => r.id === previewId && r.kind === 'sync-preview' && r.status === 'preview'); check(preview, 'PREVIEW_NOT_FOUND', 'Create an unused encrypted sync preview first.');
      const approval = { id: newId('sync_approval'), kind: 'sync-approval', previewId, digest: preview.digest, transport: preview.transport, approverId: context.memberId, approverEpoch: context.epoch, createdAt: now(), expiresAt: new Date(this.#time().getTime() + 300000).toISOString(), used: false }; state.modelReceipts.push(approval); audit(state, 'sync.copy.approved', { previewId, digest: preview.digest }); return structuredClone(approval);
    });
  }
  #approvalCurrent(context: Context, preview: any, approvalId: string) {
    this.#current(context, preview); const approval = this.store.read().modelReceipts.find(a => a.id === approvalId && a.kind === 'sync-approval'); const approver = this.store.read().members.find(m => m.id === approval?.approverId);
    check(approval && approval.previewId === preview.id && approval.digest === preview.digest && approval.transport === preview.transport && Date.parse(approval.expiresAt) > this.#time().getTime() && approver?.active && approver.epoch === approval.approverEpoch && ['owner', 'cofounder'].includes(approver.role), 'SYNC_APPROVAL_REQUIRED', 'A current owner must approve this exact encrypted payload and destination.'); return approval;
  }
  async push(context: Context, input: { previewId: string; approvalId: string }) {
    const transport = this.#transport(context); const preview = structuredClone(this.store.read().modelReceipts.find(r => r.id === input.previewId && r.kind === 'sync-preview'));
    check(preview?.status === 'preview', 'PREVIEW_NOT_FOUND', 'Create an unused encrypted sync preview first.'); this.#current(context, preview);
    const approval = this.#approvalCurrent(context, preview, input.approvalId); check(!approval.used, 'ALREADY_SENT', 'Sync approvals are consumed once.');
    const lease = await this.#writerTransportOperation(context, preview.vaultId, () => transport.acquireLease({ deviceId: this.deviceId, memberId: context.memberId, epoch: context.epoch, now: this.#time().toISOString(), ttlMs: this.options.leaseTtlMs || 60000 }));
    this.#approvalCurrent(context, preview, input.approvalId); check(lease && lease.deviceId === this.deviceId && lease.memberId === context.memberId && lease.epoch === context.epoch && Number.isSafeInteger(lease.fence) && lease.fence > 0 && Date.parse(lease.expiresAt) > this.#time().getTime(), 'WRITER_LEASE_DENIED', 'Another device holds the writer lease or the lease expired.');
    const body = { format: 'chausar.sync.v1' as const, workspaceId: preview.workspaceId, vaultId: preview.vaultId, revision: preview.revision, sequence: preview.sequence, fence: lease.fence, deviceId: this.deviceId, signerId: this.signerId,
      memberId: context.memberId, epoch: context.epoch, createdAt: this.#time().toISOString(), previousHash: preview.expectedHeadHash, ciphertextBase64: preview.payloadBase64, ciphertextDigest: preview.digest };
    const snapshot: SyncSnapshot = { ...body, signature: sign(null, Buffer.from(JSON.stringify(body)), this.#signingKey).toString('base64url') }; const recordHash = snapshotHash(snapshot);
    const publicationExpectation = { recordHash, workspaceId: preview.workspaceId, vaultId: preview.vaultId, revision: preview.revision,
      sequence: preview.sequence, fence: lease.fence, expectedHeadHash: preview.expectedHeadHash };
    await this.store.update(state => { this.#approvalCurrent(context, preview, input.approvalId); const current = state.modelReceipts.find(r => r.id === preview.id); const grant = state.modelReceipts.find(r => r.id === input.approvalId); check(current?.status === 'preview' && grant && !grant.used, 'ALREADY_SENT', 'This encrypted snapshot was already submitted.'); current.status = 'dispatching'; grant.used = true; current.recordHash = recordHash; current.fence = lease.fence; current.publicationExpectation = structuredClone(publicationExpectation); current.publicationExpectationDigest = hash(publicationExpectation); });
    try {
      this.#approvalCurrent(context, preview, input.approvalId); check(Date.parse(lease.expiresAt) > this.#time().getTime(), 'WRITER_LEASE_EXPIRED', 'The writer lease expired before publication.');
      const head = await this.#writerTransportOperation(context, preview.vaultId, () => {
        this.#approvalCurrent(context, preview, input.approvalId);
        return transport.put({ lease, expectedHeadHash: preview.expectedHeadHash, recordHash, snapshot, now: this.#time().toISOString() });
      });
      this.#approvalCurrent(context, preview, input.approvalId); check(head.recordHash === recordHash && head.revision === preview.revision && head.sequence === preview.sequence && head.fence === lease.fence, 'SYNC_HEAD_MISMATCH', 'The transport did not commit the expected fenced head.');
      return this.store.update(state => { this.#approvalCurrent(context, preview, input.approvalId); const receipt = state.modelReceipts.find(r => r.id === preview.id); check(receipt, 'SYNC_REVOKED', 'The sync request is no longer available.'); receipt.status = 'completed'; receipt.completedAt = now(); receipt.head = head; delete receipt.payloadBase64; audit(state, 'sync.push.completed', { recordHash, revision: head.revision, fence: head.fence }); return { head, receipt: structuredClone(receipt), experimental: true }; });
    } catch (error) { await this.store.update(state => { const receipt = state.modelReceipts.find(r => r.id === preview.id); if (receipt) { receipt.status = 'failed'; receipt.errorCode = error instanceof ChausarError ? error.code : 'SYNC_FAILED'; receipt.remoteOutcome = 'unknown-until-head-reconciliation'; delete receipt.payloadBase64; } }); if (error instanceof ChausarError) throw error; throw new ChausarError('SYNC_FAILED', 'Encrypted publication failed without a retry.'); }
  }
  async reconcile(context: Context, previewId: string) {
    const transport = this.#transport(context), state = this.store.read();
    const receipt = state.modelReceipts.find(r => r.id === previewId && r.kind === 'sync-preview');
    check(receipt && ['dispatching', 'failed', 'completed'].includes(receipt.status)
      && receipt.memberId === context.memberId && receipt.epoch === context.epoch && receipt.deviceId === this.deviceId,
    'SYNC_RECONCILIATION_UNAVAILABLE', 'Inspect only an existing publication receipt for your current device and access.');
    assertSourceAccess(state, context, receipt.sourceIds);
    const expected = receipt.publicationExpectation;
    check(expected && receipt.publicationExpectationDigest === hash(expected)
      && expected.recordHash === receipt.recordHash && expected.workspaceId === receipt.workspaceId && expected.vaultId === receipt.vaultId
      && expected.revision === receipt.revision && expected.sequence === receipt.sequence && expected.fence === receipt.fence
      && expected.expectedHeadHash === receipt.expectedHeadHash,
    'SYNC_RECONCILIATION_UNAVAILABLE', 'The original publication expectation is missing or changed.');
    const result = await reconcileSyncPublication(transport, structuredClone(expected));
    this.#transport(context); assertSourceAccess(this.store.read(), context, receipt.sourceIds);
    check(this.store.read().modelReceipts.some(r => r.id === receipt.id && hash(r.publicationExpectation) === receipt.publicationExpectationDigest), 'SYNC_RECONCILIATION_UNAVAILABLE', 'The publication receipt changed during readback.');
    return { previewId, ...result, readOnly: true, receiptUpdated: false, signerVerification: 'not-performed-no-restore' as const };
  }
  #verify(snapshot: SyncSnapshot, recordHash: string) {
    check(snapshot?.format === 'chausar.sync.v1' && snapshotHash(snapshot) === recordHash && hash(snapshot.ciphertextBase64) === snapshot.ciphertextDigest, 'SYNC_CORRUPT', 'The encrypted snapshot digest does not match.');
    const signer = this.#trusted.get(snapshot.signerId); const member = this.store.read().members.find(m => m.id === signer?.memberId);
    check(signer && member?.active && member.epoch === signer.epoch && signer.memberId === snapshot.memberId && signer.epoch === snapshot.epoch && ['owner', 'cofounder'].includes(member.role), 'UNTRUSTED_DEVICE', 'The device signer is not currently trusted.');
    let valid = false; try { valid = verify(null, Buffer.from(signedBody(snapshot)), signer.publicKey, Buffer.from(snapshot.signature, 'base64url')); } catch {}
    check(valid, 'SYNC_SIGNATURE_INVALID', 'The device signature is invalid.'); const backup = opaqueBackup(Buffer.from(snapshot.ciphertextBase64, 'base64').toString('utf8'));
    check(backup.vaultId === snapshot.vaultId && backup.revision === snapshot.revision && Number.isSafeInteger(snapshot.sequence) && snapshot.sequence >= 1 && Number.isSafeInteger(snapshot.fence) && snapshot.fence >= 1, 'SYNC_CORRUPT', 'The signed head does not match its encrypted backup.');
  }
  async pull(context: Context, input: { directory: string; passphrase?: string; recoveryCode?: string; newPassphrase?: string; storage?: RestoreVaultOptions['storage']; expectedWorkspaceId?: string }) {
    const transport = this.#transport(context); const member = authorize(this.store, context, 'admin'); check(member.branches.includes('*'), 'SYNC_SCOPE_DENIED', 'A full-vault restore requires access to every branch.');
    const head = await transport.getHead(); authorize(this.store, context, 'admin'); check(head, 'SYNC_EMPTY', 'The selected sync store has no encrypted snapshot.');
    const expectedWorkspace = input.expectedWorkspaceId || this.options.workspaceId || this.store.read().workspace.id;
    check(head.workspaceId === expectedWorkspace, 'SYNC_WORKSPACE_MISMATCH', 'The remote snapshot belongs to another workspace.');
    if (expectedWorkspace === this.store.read().workspace.id) check(head.revision > this.store.read().revision, 'SYNC_REPLAY', 'A remote snapshot cannot roll back the current local authority.');
    const accepted = this.store.read().modelReceipts.filter(r => r.kind === 'sync-pull' && r.workspaceId === expectedWorkspace).reduce((max, r) => Math.max(max, r.revision), -1);
    check(head.revision > accepted, 'SYNC_REPLAY', 'This snapshot is not newer than the last verified restore.');
    let recordHash: string | null = head.recordHash; let newest: SyncSnapshot | undefined; let prior: SyncSnapshot | undefined; const seen = new Set<string>();
    while (recordHash) {
      authorize(this.store, context, 'admin'); check(!seen.has(recordHash) && seen.size < 1024, 'SYNC_LOG_INVALID', 'The encrypted snapshot chain is cyclic or too long.'); seen.add(recordHash);
      const record = await transport.get(recordHash); authorize(this.store, context, 'admin'); check(record, 'SYNC_LOG_TRUNCATED', 'A predecessor is missing from the encrypted snapshot chain.'); this.#verify(record, recordHash);
      check(record.workspaceId === expectedWorkspace && record.vaultId === head.vaultId, 'SYNC_WORKSPACE_MISMATCH', 'The encrypted chain crosses workspace or vault identity.');
      if (!newest) { newest = record; check(record.revision === head.revision && record.sequence === head.sequence && record.fence === head.fence, 'SYNC_HEAD_MISMATCH', 'The head does not identify its signed snapshot.'); }
      if (prior) check(record.revision < prior.revision && record.sequence === prior.sequence - 1 && record.fence <= prior.fence, 'SYNC_REPLAY', 'Revisions, sequence or fencing order regressed.');
      prior = record; recordHash = record.previousHash;
    }
    check(prior?.sequence === 1, 'SYNC_LOG_TRUNCATED', 'The encrypted chain is missing its first snapshot.');
    const vault = this.options.vault || this.store as any;
    check(!vault.directory || resolve(input.directory) !== resolve(vault.directory), 'LIVE_AUTHORITY_OVERWRITE_REFUSED', 'Restore into a new directory, then explicitly switch authorities.');
    const target = await safeDirectory(input.directory, true); check((await readdir(target)).length === 0, 'RESTORE_TARGET_NOT_EMPTY', 'The restore target must be a new empty directory.');
    const stage = await mkdtemp(join(tmpdir(), 'chausar-sync-restore-'));
    try {
      authorize(this.store, context, 'admin'); const file = join(stage, 'encrypted.backup.json'); await writeFile(file, Buffer.from(newest!.ciphertextBase64, 'base64'), { mode: 0o600 });
      const credentials = input.recoveryCode ? { recoveryCode: input.recoveryCode, newPassphrase: input.newPassphrase! } : { passphrase: input.passphrase! };
      const restored = await Vault.restore({ directory: target, storage: input.storage || 'experimental-file', backupFile: file, ...credentials } as RestoreVaultOptions);
      try { authorize(this.store, context, 'admin'); this.#verify(newest!, head.recordHash);
        const receipt = await this.store.update(state => { authorize(this.store, context, 'admin'); const record = { id: newId('sync_pull'), kind: 'sync-pull', memberId: context.memberId, epoch: context.epoch, workspaceId: expectedWorkspace, revision: head.revision, recordHash: head.recordHash, directory: target, createdAt: now(), experimental: true }; state.modelReceipts.push(record); audit(state, 'sync.restore.staged', { recordHash: head.recordHash, revision: head.revision }); return record; });
        return { stagedVault: restored, directory: target, receipt, experimental: true, liveAuthorityChanged: false };
      } catch (error) { await restored.delete(); throw error; }
    } finally { await rm(stage, { recursive: true, force: true }); }
  }
}
