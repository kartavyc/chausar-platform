import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { authorize, check, ChausarError, hash, type Context, type State } from '../runtime/contracts.ts';
import { acquireProcessLock } from '../runtime/process-lock.ts';
import { Vault, type PrivateArtifactRef } from '../runtime/vault.ts';
import { demoCsv, demoRecipe } from '../runtime/ingest.ts';
import { WorkspaceInterchangeHost, type WorkspaceInterchangeCustodyRecord } from '../runtime/workspace-interchange-host.ts';
import { createWorkspaceInterchangeLocalPorts } from '../runtime/workspace-interchange-local.ts';
import { canonicalInterchangeJson, interchangeDigest, readHistoricalWorkspaceState } from '../runtime/workspace-interchange.ts';
import { createWorkspaceBackupV2Host, inspectWorkspaceBackupV2, workspaceBackupV2Bytes, type WorkspaceBackupV2Budgets,
  type WorkspaceBackupV2Capture, type WorkspaceBackupV2CustodyRecord } from '../runtime/workspace-backup-v2.ts';
import { createWorkspaceBackupV2LocalPorts } from '../runtime/workspace-backup-local.ts';
import { WorkspaceBackupActivationHost, type WorkspaceBackupActivationLease, type WorkspaceBackupActivationPolicy,
  type WorkspaceBackupActivationPorts, type WorkspaceBackupActivationProvenance, type WorkspaceBackupActivationSelection } from '../runtime/workspace-backup-activation.ts';
import type { AuthenticatedActivationCandidate } from '../runtime/workspace-activation.ts';
import type { EmptyTargetInspection } from '../runtime/workspace-interchange-contracts.ts';
import { deterministicShopState, emptyTarget, interchangeOwner } from './fixtures/workspace-interchange-fixture.ts';

// Only constructor/root ports are fixtures. The source Vault, semantic export,
// complete v2 issuance, inert reservation and all candidate ciphertext are actual files.
const context: Context = { ...interchangeOwner, sourceTainted: false };
const passphrase = 'Synthetic archive activation fixture passphrase';
const privateSecret = 'Synthetic retained private original 7721';
const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const code = (expected: string) => (error: unknown) => error instanceof ChausarError && error.code === expected;
const same = (left: unknown, right: unknown) => canonicalInterchangeJson(left) === canonicalInterchangeJson(right);
const refOf = ({ id, purpose, valueDigest, diskBytes }: PrivateArtifactRef): PrivateArtifactRef => ({ id, purpose, valueDigest, diskBytes });
const artifactId = (prefix: string, recordId: string, part: string) => `${prefix}_${sha(recordId)}_${part}`;
const budgets: WorkspaceBackupV2Budgets = { maxArchiveUtf8Bytes: 8_000_000, maxEntryBytes: 3_000_000,
  maxTotalEntryBytes: 5_000_000, maxEntries: 100, maxJsonDepth: 40, maxJsonNodes: 80_000 };
const encryptedBudgets = { maxEntryBytes: budgets.maxEntryBytes, maxTotalEntryBytes: budgets.maxTotalEntryBytes,
  maxArtifacts: budgets.maxEntries - 1 };
const policyFor = (workspaceId: string): WorkspaceBackupActivationPolicy => ({ approvedSyntheticWorkspaceIds: [workspaceId],
  backupBudgets: budgets, maxMaterialUtf8Bytes: 4_000_000, maxCandidateUtf8Bytes: 16_000_000 });
const physical = (stat: { dev: bigint; ino: bigint; birthtimeNs: bigint }) => ({ dev: String(stat.dev), ino: String(stat.ino), birthtimeNs: String(stat.birthtimeNs) });
const artifactPath = (vault: Vault, ref: PrivateArtifactRef) => join(vault.directory, 'private-artifacts', ref.purpose, `${ref.id}.encrypted.json`);
type Artifact = PrivateArtifactRef & { value: unknown };
type Faults = {
  ready: boolean; complete: boolean; loseAck: boolean; skipPublicationGuard: boolean;
  beforePublish?: () => Promise<void>; beforeReadCandidate?: () => Promise<void>;
  changeBackup?: (value: Awaited<ReturnType<typeof readBackup>>) => void;
  changeMaterial?: (value: Awaited<ReturnType<typeof readInterchange>>) => void;
  changeInert?: (value: Awaited<ReturnType<typeof readInert>>) => void;
  changeArchiveState?: (value: State) => void;
  changeMaterialRefs?: (value: { archive: PrivateArtifactRef; pin: PrivateArtifactRef; binding: PrivateArtifactRef }) => void;
  currentCalls: number; completeCalls: number; publications: number; held: boolean;
};
const newFaults = (): Faults => ({ ready: true, complete: true, loseAck: false, skipPublicationGuard: false,
  currentCalls: 0, completeCalls: 0, publications: 0, held: false });

async function requiredArtifact(vault: Vault, id: string): Promise<Artifact> {
  return vault.readArtifact({ id, purpose: 'workspace-interchange' });
}
function admission(vault: Vault, ctx: Context, faults: Faults) {
  check(ctx.channel === 'desktop' && !ctx.sourceTainted, 'APP_APPROVAL_REQUIRED', 'Synthetic root requires current desktop owner context.');
  const member = authorize(vault, ctx, 'admin');
  check(member.role === 'owner' && member.branches.includes('*'), 'FORBIDDEN', 'Fixture requires complete current owner.');
  check(faults.ready, 'INTERCHANGE_NOT_READY', 'Synthetic readiness was revoked.');
  check(faults.complete, 'INTERCHANGE_READ_SCOPE_REQUIRED', 'Synthetic complete-owner view was revoked.');
}
async function readBackup(vault: Vault, ctx: Context, recordId: string) {
  const bindingRef = await requiredArtifact(vault, artifactId('wb2', recordId, 'binding'));
  const binding = bindingRef.value as any;
  check(binding.format === 'chausar.backup-local-binding.v2' && binding.recordId === recordId && binding.state === 'committed'
    && binding.contextDigest === interchangeDigest(ctx), 'BACKUP_CUSTODY_NOT_COMMITTED', 'Authenticate actual committed backup issuance.');
  const archive = await requiredArtifact(vault, artifactId('wb2', recordId, 'archive'));
  const pin = await requiredArtifact(vault, artifactId('wb2', recordId, 'pin'));
  check(same(refOf(archive), binding.archive) && same(refOf(pin), binding.pin), 'BACKUP_CUSTODY_CHANGED', 'Backup ciphertext refs changed.');
  const av = archive.value as any, pv = pin.value as any;
  check(av.format === 'chausar.backup-local-archive.v2' && pv.format === 'chausar.backup-local-pin.v2'
    && av.recordId === recordId && pv.recordId === recordId && av.creationId === binding.creationId && pv.creationId === binding.creationId
    && pv.pin.recordId === recordId && pv.pin.creationId === binding.creationId
    && interchangeDigest(pv.pin) === binding.pinDigest && pv.pin.archiveDigest === binding.archiveDigest,
  'BACKUP_CUSTODY_CHANGED', 'Backup values differ from the independent issuance.');
  return { content: av.content as string, pin: pv.pin as WorkspaceBackupV2CustodyRecord['pin'], measurement: { encrypted: true as const,
    archiveCiphertextBytes: archive.diskBytes, pinCiphertextBytes: pin.diskBytes, qualification: 'encrypted-local-host' as const } };
}
async function readInterchange(vault: Vault, ctx: Context, recordId: string, fixture = false) {
  const prefix = fixture ? 'bga' : 'wic';
  const bindingRef = await requiredArtifact(vault, artifactId(prefix, recordId, 'commit'));
  const binding = bindingRef.value as any;
  check(binding.format === 'chausar.interchange-local-binding.v1' && binding.recordId === recordId && binding.state === 'committed'
    && binding.contextDigest === interchangeDigest(ctx), 'INTERCHANGE_CUSTODY_NOT_COMMITTED', 'Authenticate actual committed interchange issuance.');
  const archive = await requiredArtifact(vault, artifactId(prefix, recordId, 'archive'));
  const pin = await requiredArtifact(vault, artifactId(prefix, recordId, 'pin'));
  check(same(refOf(archive), binding.archive) && same(refOf(pin), binding.pin), 'INTERCHANGE_CUSTODY_CHANGED', 'Independent archive/pin refs changed.');
  const av = archive.value as any, pv = pin.value as any;
  check(av.format === 'chausar.interchange-local-archive.v1' && pv.format === 'chausar.interchange-local-pin.v1'
    && av.recordId === recordId && pv.recordId === recordId && interchangeDigest(av.content) === binding.contentDigest
    && interchangeDigest(pv.pin) === binding.pinDigest, 'INTERCHANGE_CUSTODY_CHANGED', 'Independent archive/pin values changed.');
  return { content: av.content as string, pin: pv.pin as WorkspaceInterchangeCustodyRecord['pin'], measurement: { encrypted: true as const,
    archiveCiphertextBytes: archive.diskBytes, inventoryPinCiphertextBytes: pin.diskBytes,
    qualification: fixture ? 'test-fixture' as const : 'encrypted-local-host' as const } };
}
async function readInert(vault: Vault, applicationDirectory: string, ctx: Context, targetId: string) {
  const retained = await requiredArtifact(vault, artifactId('wbt2', targetId, 'reservation'));
  const reservation = retained.value as any, path = join(applicationDirectory, targetId);
  check(reservation.format === 'chausar.backup-local-target.v2' && reservation.targetId === targetId && reservation.state === 'restored'
    && reservation.vaultId === vault.vaultId && reservation.workspaceId === vault.read().workspace.id
    && reservation.contextDigest === interchangeDigest(ctx)
    && same(physical(await lstat(path, { bigint: true })), reservation.physical), 'BACKUP_TARGET_CHANGED', 'Authenticate actual restored reservation and physical generation.');
  check(same(await readdir(path), ['backup.inert.json']), 'BACKUP_TARGET_CHANGED', 'Inert target acquired unexpected entries.');
  const raw = await readFile(join(path, 'backup.inert.json'));
  check(sha(raw) === reservation.containerSha256, 'BACKUP_TARGET_CHANGED', 'Physical inert container changed.');
  const container = JSON.parse(raw.toString('utf8'));
  check(container.format === 'chausar.backup-inert-container.v2' && container.receipt.creationId === reservation.creationId
    && container.receipt.archiveDigest === reservation.archiveDigest, 'BACKUP_TARGET_CHANGED', 'Restored receipt changed.');
  return { content: container.content, receipt: container.receipt, inspection: { targetId, locationId: reservation.locationId,
    generation: reservation.generation, contextDigest: reservation.contextDigest, containerDigest: sha(raw), containerBytes: raw.byteLength } };
}
async function authenticatedMaterial(vault: Vault, capture: WorkspaceBackupV2Capture, material: WorkspaceInterchangeCustodyRecord) {
  // Authenticate ALL original ciphertext, then compare each archived envelope to its
  // current independently decrypted issuance. A same-revision semantic export is insufficient.
  await vault.authenticateEncryptedCustody(capture, encryptedBudgets);
  const recordId = material.pin.recordId;
  const refs: Record<string, PrivateArtifactRef> = {};
  const values: Record<string, any> = {};
  for (const [key, part] of [['archive', 'archive'], ['pin', 'pin'], ['binding', 'commit']] as const) {
    const actual = await requiredArtifact(vault, artifactId('wic', recordId, part));
    const archived = capture.artifacts.find(item => item.ref.id === actual.id && item.ref.purpose === actual.purpose);
    check(archived && same(archived.ref, refOf(actual)) && Buffer.from(archived.bytes).equals(await readFile(artifactPath(vault, actual))),
      'FIXTURE_ARCHIVED_MATERIAL_REQUIRED', 'Exact authenticated export, independent pin and commit envelopes must all be archived.');
    refs[key] = refOf(actual); values[key] = actual.value;
  }
  const binding = values.binding;
  check(values.archive.format === 'chausar.interchange-local-archive.v1' && values.archive.recordId === recordId && values.archive.content === material.content
    && values.pin.format === 'chausar.interchange-local-pin.v1' && values.pin.recordId === recordId && same(values.pin.pin, material.pin)
    && binding.format === 'chausar.interchange-local-binding.v1' && binding.recordId === recordId && binding.state === 'committed'
    && binding.contextDigest === material.pin.contextDigest && same(binding.archive, refs.archive) && same(binding.pin, refs.pin)
    && binding.contentDigest === interchangeDigest(material.content) && binding.pinDigest === interchangeDigest(material.pin),
  'FIXTURE_ARCHIVED_MATERIAL_REQUIRED', 'Exact archived values and committed issuance must bind this independent semantic export.');
  return refs as { archive: PrivateArtifactRef; pin: PrivateArtifactRef; binding: PrivateArtifactRef };
}
async function targetInspection(vault: Vault, applicationDirectory: string, ctx: Context): Promise<EmptyTargetInspection> {
  const retained = await requiredArtifact(vault, 'bridge_fixture_target');
  const reservation = retained.value as any;
  check(reservation.format === 'synthetic.bridge-target.v1' && reservation.contextDigest === interchangeDigest(ctx)
    && same(physical(await lstat(join(applicationDirectory, reservation.inspection.targetId), { bigint: true })), reservation.physical),
  'INTERCHANGE_TARGET_CHANGED', 'Fixture activation target physical generation or owner changed.');
  check((await readdir(join(applicationDirectory, reservation.inspection.targetId))).length === 0,
    'INTERCHANGE_TARGET_NOT_EMPTY', 'Fixture target must remain physically empty.');
  return structuredClone(reservation.inspection);
}

function rootPorts(vault: Vault, applicationDirectory: string, faults = newFaults()) {
  // Explicit fixture root admission. It cannot supply fresh authority or Engine attachment.
  const ports: WorkspaceBackupActivationPorts = {
    custody: { async read(ctx, candidateId) { return vault.snapshot(async () => {
      admission(vault, ctx, faults); return await readInterchange(vault, ctx, candidateId, true) as AuthenticatedActivationCandidate;
    }); } },
    async withTransaction(ctx, chosen, work) {
      return vault.snapshot(async state => {
        admission(vault, ctx, faults);
        const control = join(applicationDirectory, '.workspace-interchange-control', 'bridge-fixture');
        await mkdir(control, { recursive: true });
        const locks = [];
        try {
          // Actual exclusive record and target locks persist for the whole callback and exit.
          for (const key of [chosen.backupId, chosen.materialId, chosen.inertTargetId, chosen.candidateId, chosen.targetId])
            locks.push(await acquireProcessLock(join(control, `${sha(key)}.lock`)));
          assert.equal(faults.held, false); faults.held = true;
          const target = await targetInspection(vault, applicationDirectory, ctx);
          const authority = await readFile(join(vault.directory, 'authority.encrypted.json'));
          const originalRefs = await vault.listArtifacts({ purpose: 'workspace-interchange' });
          const originalFiles = new Map(await Promise.all(originalRefs.map(async ref => [ref.id, await readFile(artifactPath(vault, ref))] as const)));
          const controlled = new Map<string, PrivateArtifactRef>();
          const controlledFiles = new Map<string, Buffer>();
          const assertCurrent = async () => {
            faults.currentCalls++; admission(vault, ctx, faults);
            check(same(vault.read(), state) && authority.equals(await readFile(join(vault.directory, 'authority.encrypted.json'))),
              'INTERCHANGE_AUTHORITY_CHANGED', 'Held actual authority bytes or state changed.');
            check(same(target, await targetInspection(vault, applicationDirectory, ctx)), 'INTERCHANGE_TARGET_CHANGED', 'Held target proof changed.');
            const names = await readdir(join(vault.directory, 'private-artifacts', 'workspace-interchange'));
            const expectedIds = new Set([...originalFiles.keys(), ...controlled.keys()]);
            check(names.length === expectedIds.size && names.every(name => expectedIds.has(name.replace(/\.encrypted\.json$/, ''))),
              'BACKUP_ACTIVATION_CUSTODY_CHANGED', 'Uncontrolled private inventory changed.');
            await Promise.all([...expectedIds].map(async id => {
              const expected = controlledFiles.get(id) ?? originalFiles.get(id)!;
              check(expected.equals(await readFile(join(vault.directory, 'private-artifacts', 'workspace-interchange', `${id}.encrypted.json`))),
                'BACKUP_ACTIVATION_CUSTODY_CHANGED', 'Exact original or controlled independent custody envelope changed.');
            }));
          };
          const write = async (id: string, value: unknown, expectedDigest: string | null) => {
            const ref = await vault.writeArtifact({ id, purpose: 'workspace-interchange', value, expectedDigest });
            controlled.set(ref.id, ref); controlledFiles.set(ref.id, await readFile(artifactPath(vault, ref))); return ref;
          };
          const lease: WorkspaceBackupActivationLease = {
            currentState: state, target,
            async readBackup() { const value = await readBackup(vault, ctx, chosen.backupId); faults.changeBackup?.(value); return value; },
            async readMaterial() { const value = await readInterchange(vault, ctx, chosen.materialId); faults.changeMaterial?.(value); return value; },
            async readInert() { const value = await readInert(vault, applicationDirectory, ctx, chosen.inertTargetId); faults.changeInert?.(value); return value; },
            async authenticateMaterial(capture, material) { const refs = await authenticatedMaterial(vault, capture, material); faults.changeMaterialRefs?.(refs); return refs; },
            async authenticateArchive(capture) { const value = await vault.authenticateEncryptedCustody(capture, encryptedBudgets); faults.changeArchiveState?.(value); return value; },
            async assertCompleteOwner(current, historical) {
              faults.completeCalls++; admission(vault, current, faults);
              check(historical.workspace.id === state.workspace.id, 'FORBIDDEN', 'Synthetic archived authority belongs to another workspace.');
            },
            assertCurrent,
            async createCandidate(record, guard) {
              assert.equal(faults.held, true);
              await faults.beforePublish?.();
              if (!faults.skipPublicationGuard) await guard();
              const recordId = record.pin.recordId, commitId = artifactId('bga', recordId, 'commit');
              const refs = await vault.listArtifacts({ purpose: 'workspace-interchange' });
              check(!refs.some(ref => ref.id === commitId || ref.id === `bga_creation_${sha(record.pin.creationId)}`),
                'FIXTURE_CANDIDATE_SINGLE_USE', 'Record and candidate creation identities are durably single-use.');
              const preparing = await write(commitId, { format: 'synthetic.bridge-issuance.v1', state: 'preparing', recordId,
                creationId: record.pin.creationId, contextDigest: interchangeDigest(ctx) }, null);
              await write(`bga_creation_${sha(record.pin.creationId)}`, { format: 'synthetic.bridge-creation.v1', recordId,
                creationId: record.pin.creationId }, null);
              const archive = await write(artifactId('bga', recordId, 'archive'), { format: 'chausar.interchange-local-archive.v1', recordId, content: record.content }, null);
              const pin = await write(artifactId('bga', recordId, 'pin'), { format: 'chausar.interchange-local-pin.v1', recordId, pin: record.pin }, null);
              if (!faults.skipPublicationGuard) await guard();
              await write(commitId, { format: 'chausar.interchange-local-binding.v1', recordId, instance: randomUUID(),
                contextDigest: interchangeDigest(ctx), pinDigest: interchangeDigest(record.pin), contentDigest: interchangeDigest(record.content),
                archive, pin, state: 'committed' }, preparing.valueDigest);
              faults.publications++;
              if (faults.loseAck) throw new Error('Synthetic acknowledgement lost after durable encrypted candidate commit.');
              return { encrypted: true, archiveCiphertextBytes: archive.diskBytes, inventoryPinCiphertextBytes: pin.diskBytes, qualification: 'test-fixture' };
            },
            async readCandidate() { await faults.beforeReadCandidate?.(); return await readInterchange(vault, ctx, chosen.candidateId, true) as AuthenticatedActivationCandidate; },
          };
          const result = await work(lease); await assertCurrent(); return result;
        } finally { faults.held = false; for (const lock of locks.reverse()) await lock.release(); }
      });
    },
  };
  return { ports, faults, host: () => new WorkspaceBackupActivationHost(ports, policyFor(vault.read().workspace.id)) };
}

async function fixture(t: TestContext, change?: (state: State) => void) {
  const scratch = await realpath(tmpdir());
  if (process.platform === 'win32') assert.match(scratch, /^C:\\/i, 'Validate canonical C scratch BEFORE creating any fixture files.');
  const applicationDirectory = await realpath(await mkdtemp(join(scratch, 'chausar-backup-activation-')));
  assert.equal(dirname(applicationDirectory), scratch);
  const created = await Vault.create({ directory: join(applicationDirectory, 'source'), storage: 'experimental-file',
    passphrase, name: 'Synthetic archive activation', demo: true });
  let vault = created.vault;
  t.after(async () => {
    await vault.close();
    const actual = await realpath(applicationDirectory), child = relative(scratch, actual);
    assert.equal(dirname(actual), scratch);
    assert.ok(child && !isAbsolute(child) && !child.startsWith('..') && child.startsWith('chausar-backup-activation-'));
    await rm(actual, { recursive: true, force: true });
  });
  await vault.update(draft => {
    const state = deterministicShopState(); state.workspace.id = draft.workspace.id;
    const input = { sourceId: 'demo-export', format: 'csv' as const, content: demoCsv, recipe: demoRecipe,
      expectedTotals: { rowCount: 10, amountMinor: '1230000' } };
    state.imports[0].retainedInput = { version: 1, generation: 1, input, digest: hash(input) };
    change?.(state); Object.assign(draft, state);
  });
  await mkdir(join(vault.directory, 'reports'));
  await writeFile(join(vault.directory, 'reports', 'synthetic.txt'), '=1+1\r\nretained wider report');
  const assertCompleteOwner = async (ctx: Context) => { const member = authorize(vault, ctx, 'admin'); assert.equal(member.role, 'owner'); };
  const semanticCustody = createWorkspaceInterchangeLocalPorts({ vault, applicationDirectory, assertCompleteOwner });
  const semanticHost = new WorkspaceInterchangeHost(semanticCustody.ports);
  await semanticHost.export(context, { destinationId: 'semantic_material', confirmed: true });
  // Raw encrypted control-history fixtures belong to the complete v2 capture;
  // the independently issued semantic export intentionally predates these controls.
  for (const status of ['active', 'discarded', 'promoting', 'promoted']) await vault.writeArtifact({
    id: `private_${status}`, purpose: 'private-trial', expectedDigest: null,
    value: { type: 'private-trial-issued-binding-v1', version: 1, status, secret: privateSecret } });
  const before = await vault.snapshot(() => vault.captureEncryptedCustody(encryptedBudgets));
  const backupCustody = createWorkspaceBackupV2LocalPorts({ vault, applicationDirectory, budgets,
    filesystemBudgets: { maxFiles: 100, maxBytes: 16_000_000, maxDepth: 16 },
    externalKeyRequirements: [{ provider: 'other', namespace: 'operator/credential-wrappers', requirement: 'Separately retain the synthetic recovery credential.' }],
    assertCompleteOwner, withCompleteOwner: async (ctx, _state, work) => { await assertCompleteOwner(ctx); return vault.withCustodyWriterAdmission(work); } });
  const backupHost = createWorkspaceBackupV2Host(backupCustody.ports, budgets);
  const issued = await backupHost.create(context, { destinationId: 'complete_backup', confirmed: true });
  const restored = await backupHost.restoreInert(context, { backupId: issued.recordId, targetId: 'inert_original', reviewedDigest: issued.archiveDigest });
  const targetPath = join(applicationDirectory, 'activation_target'); await mkdir(targetPath);
  const target: EmptyTargetInspection = { ...emptyTarget(), targetId: 'activation_target', generation: `empty_${randomUUID()}`,
    accessDigest: interchangeDigest(context), workspaceId: `workspace_${randomUUID()}` };
  await vault.writeArtifact({ id: 'bridge_fixture_target', purpose: 'workspace-interchange', expectedDigest: null,
    value: { format: 'synthetic.bridge-target.v1', contextDigest: interchangeDigest(context), inspection: target,
      physical: physical(await lstat(targetPath, { bigint: true })) } });
  const chosen: WorkspaceBackupActivationSelection = { backupId: issued.recordId, materialId: 'semantic_material', inertTargetId: restored.targetId,
    inertCreationId: restored.creationId, candidateId: 'bridge_candidate', targetId: target.targetId };
  let root = rootPorts(vault, applicationDirectory);
  return { get vault() { return vault; }, get root() { return root; }, applicationDirectory, before, issued, restored, chosen, target,
    input: { ...chosen, reviewedArchiveDigest: issued.archiveDigest, confirmed: true as const },
    async reopen() { await vault.close(); vault = await Vault.open({ directory: join(applicationDirectory, 'source'), storage: 'experimental-file', passphrase });
      root = rootPorts(vault, applicationDirectory); return root; },
    async close() { await vault.close(); },
  };
}
function provenanceFrom(evidence: { content: string }): WorkspaceBackupActivationProvenance {
  const candidate = JSON.parse(evidence.content);
  return JSON.parse(candidate.archive.artifacts.find((item: any) => item.manifest.id === 'backup_activation_provenance_v1').text);
}
async function corruptArtifact(vault: Vault, id: string, change: (value: any) => void) {
  const prior = await requiredArtifact(vault, id), value = structuredClone(prior.value); change(value);
  return vault.writeArtifact({ id, purpose: 'workspace-interchange', expectedDigest: prior.valueDigest, value });
}
async function replaceFixtureDirectory(f: Awaited<ReturnType<typeof fixture>>, targetId: string, copyInert: boolean) {
  const original = await realpath(join(f.applicationDirectory, targetId));
  const retained = join(f.applicationDirectory, `${targetId}_original_generation`);
  // Verify BOTH absolute move endpoints remain in this already validated synthetic C scratch.
  assert.equal(dirname(original), f.applicationDirectory); assert.equal(dirname(retained), f.applicationDirectory);
  assert.ok((await lstat(original)).isDirectory());
  const container = copyInert ? await readFile(join(original, 'backup.inert.json')) : undefined;
  await rename(original, retained); await mkdir(original);
  if (container) await writeFile(join(original, 'backup.inert.json'), container);
  assert.notDeepEqual(physical(await lstat(original, { bigint: true })), physical(await lstat(retained, { bigint: true })));
}
async function freshProcess(applicationDirectory: string, mode = 'inspect') {
  return new Promise<any>((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--bridge-fixture-child', applicationDirectory, mode],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = ''; const timeout = setTimeout(() => { child.kill(); reject(new Error('Bounded synthetic child exceeded 30 seconds.')); }, 30_000);
    child.stdout.on('data', bytes => { out += bytes; }); child.stderr.on('data', bytes => { err += bytes; });
    child.on('error', error => { clearTimeout(timeout); reject(error); });
    child.on('close', status => { clearTimeout(timeout); if (status !== 0) reject(new Error(`Fresh-process inspection exit ${status}: ${err}`));
      else { try { resolve(JSON.parse(out)); } catch { reject(new Error(`Fresh-process output was not complete JSON: ${out} ${err}`)); } } });
  });
}

if (process.argv[2] === '--bridge-fixture-child') {
  // This branch never registers/runs the test suite. It reopens actual synthetic custody.
  const applicationDirectory = await realpath(process.argv[3]);
  if (process.platform === 'win32') assert.match(applicationDirectory, /^C:\\/i);
  assert.equal(dirname(applicationDirectory), await realpath(tmpdir()));
  assert.match(applicationDirectory.split(/[\\/]/).at(-1)!, /^chausar-backup-activation-/);
  const vault = await Vault.open({ directory: join(applicationDirectory, 'source'), storage: 'experimental-file', passphrase });
  try {
    const root = rootPorts(vault, applicationDirectory), result = await root.host().inspect(context, { candidateId: 'bridge_candidate' });
    let replayCode: string | undefined;
    if (process.argv[4] === 'replay') {
      const provenance = provenanceFrom(result.evidence);
      try { await root.host().prepare(context, { backupId: provenance.backup.pin.recordId, materialId: provenance.material.pin.recordId,
        inertTargetId: provenance.inert.receipt.targetId, inertCreationId: provenance.inert.receipt.creationId,
        candidateId: 'bridge_candidate', targetId: result.review.targetId, reviewedArchiveDigest: result.review.archiveDigest, confirmed: true }); }
      catch (error: any) { replayCode = error.code; }
    }
    process.stdout.write(JSON.stringify({ result, replayCode, publications: root.faults.publications, pid: process.pid,
      sourceState: vault.read(), targetEntries: await readdir(join(applicationDirectory, result.review.targetId)) }));
  } finally { await vault.close(); }
} else {
  test('actual v2 issuance and restore bridge preserve every exact encrypted original, independent creation pin and truthful namespace', { timeout: 30_000 }, async t => {
    const f = await fixture(t), originalState = f.vault.read();
    const review = await f.root.host().prepare(context, f.input);
    assert.equal(review.measurement.qualification, 'test-fixture'); assert.equal(review.measurement.encrypted, true);
    assert.equal(review.backupCreationId, (await readBackup(f.vault, context, f.chosen.backupId)).pin.creationId);
    assert.equal(review.materialCreationId, (await readInterchange(f.vault, context, f.chosen.materialId)).pin.creationId);
    assert.equal(review.inertCreationId, f.restored.creationId); assert.deepEqual(review.source, f.issued.source);
    assert.equal(review.inert, true); assert.equal(review.activation, 'root-only'); assert.equal(review.fullWorkspacePortable, false);
    assert.ok(review.namespaces.some(item => item.namespace === 'workspace/reports' && item.disposition === 'outside-archive'));
    assert.ok(review.namespaces.some(item => item.namespace === 'workspace/writer.lock' && item.disposition === 'transient'));
    assert.deepEqual(review.externalKeyRequirements, [{ provider: 'other', namespace: 'operator/credential-wrappers', requirement: 'Separately retain the synthetic recovery credential.' }]);
    const inspected = await f.root.host().inspect(context, { candidateId: f.chosen.candidateId }); assert.deepEqual(inspected.review, review);
    const provenance = provenanceFrom(inspected.evidence), decoded = workspaceBackupV2Bytes(inspectWorkspaceBackupV2(provenance.backup.content, budgets), budgets);
    assert.deepEqual(decoded.authority, f.before.authority); assert.deepEqual(decoded.artifacts, f.before.artifacts);
    assert.equal(provenance.backup.content, (await readBackup(f.vault, context, f.chosen.backupId)).content);
    assert.equal(provenance.inert.content, provenance.backup.content);
    for (const [name, ref] of Object.entries(provenance.materialRefs)) {
      const archived = decoded.artifacts.find(item => item.ref.id === ref.id)!; assert.deepEqual(archived.ref, ref, name);
      assert.ok(Buffer.from(archived.bytes).equals(await readFile(artifactPath(f.vault, ref))));
    }
    for (const status of ['active', 'discarded', 'promoting', 'promoted']) assert.ok(decoded.artifacts.some(item => item.ref.id === `private_${status}`));
    const candidate = JSON.parse(inspected.evidence.content), historical = readHistoricalWorkspaceState(candidate.archive);
    for (const name of Object.keys(originalState) as (keyof State)[]) assert.equal(JSON.stringify(historical[name]), JSON.stringify(originalState[name]), name);
    assert.deepEqual(f.vault.read(), originalState); assert.deepEqual(await readdir(join(f.applicationDirectory, f.chosen.targetId)), []);
    const retained = await requiredArtifact(f.vault, artifactId('bga', f.chosen.candidateId, 'archive'));
    const raw = await readFile(artifactPath(f.vault, retained), 'utf8');
    for (const secret of [privateSecret, passphrase, inspected.evidence.content, 'retained wider report']) assert.ok(!raw.includes(secret));
    assert.ok(f.root.faults.currentCalls > 10); assert.ok(f.root.faults.completeCalls > 5); assert.equal(f.root.faults.publications, 1);
    t.diagnostic(JSON.stringify({ actualVault: true, originalEncryptedEntries: decoded.artifacts.length + 1, exactEncryptedBytes: true,
      independentArchivedMaterialRefs: 3, candidateCustody: 'test-fixture', activation: false, nativeQualified: false, fullWorkspacePortable: false }));
  });

  test('actual lost candidate acknowledgement resolves through a fresh process reopening Vault and never republishes', { timeout: 40_000 }, async t => {
    const f = await fixture(t), sourceState = f.vault.read(); f.root.faults.loseAck = true;
    await assert.rejects(() => f.root.host().prepare(context, f.input), code('BACKUP_ACTIVATION_COMMIT_UNKNOWN'));
    assert.equal(f.root.faults.publications, 1);
    const retained = await f.root.host().inspect(context, { candidateId: f.chosen.candidateId });
    await f.close(); const fresh = await freshProcess(f.applicationDirectory, 'replay');
    assert.notEqual(fresh.pid, process.pid); assert.deepEqual(fresh.result, retained); assert.deepEqual(fresh.sourceState, sourceState);
    assert.deepEqual(fresh.targetEntries, []); assert.equal(fresh.publications, 0); assert.equal(fresh.replayCode, 'BACKUP_ACTIVATION_COMMIT_UNKNOWN');
    await f.reopen(); assert.deepEqual(await f.root.host().inspect(context, { candidateId: f.chosen.candidateId }), retained);
  });

  test('new host and Vault reopen retain durable record single-use without overwriting candidate creation', { timeout: 30_000 }, async t => {
    const f = await fixture(t), review = await f.root.host().prepare(context, f.input);
    const before = await f.root.host().inspect(context, { candidateId: f.chosen.candidateId }); await f.reopen();
    assert.deepEqual((await f.root.host().inspect(context, { candidateId: f.chosen.candidateId })).review, review);
    await assert.rejects(() => f.root.host().prepare(context, f.input), code('BACKUP_ACTIVATION_COMMIT_UNKNOWN'));
    assert.deepEqual(await f.root.host().inspect(context, { candidateId: f.chosen.candidateId }), before); assert.equal(f.root.faults.publications, 0);
  });

  test('current authority, epoch, source scope and readiness revocations refuse before candidate publication', async t => {
    for (const [name, mutation, expected] of [
      ['owner deactivation', async (f: Awaited<ReturnType<typeof fixture>>) => f.vault.update(s => { s.members[0].active = false; }), 'ACCESS_REVOKED'],
      ['owner epoch', async (f: Awaited<ReturnType<typeof fixture>>) => f.vault.update(s => { s.members[0].epoch++; }), 'ACCESS_REVOKED'],
      ['complete branches', async (f: Awaited<ReturnType<typeof fixture>>) => f.vault.update(s => { s.members[0].branches = ['Main']; }), 'FORBIDDEN'],
      ['source access', async (f: Awaited<ReturnType<typeof fixture>>) => f.vault.update(s => { s.policy.allowedSources = []; }), 'SOURCE_REVOKED'],
      ['current readiness', async (f: Awaited<ReturnType<typeof fixture>>) => { f.root.faults.ready = false; }, 'INTERCHANGE_NOT_READY'],
      ['complete owner view', async (f: Awaited<ReturnType<typeof fixture>>) => { f.root.faults.complete = false; }, 'INTERCHANGE_READ_SCOPE_REQUIRED'],
    ] as const) await t.test(name, async sub => {
      const f = await fixture(sub); await mutation(f);
      await assert.rejects(() => f.root.host().prepare(context, f.input), code(expected)); assert.equal(f.root.faults.publications, 0);
      assert.ok(!(await f.vault.listArtifacts({ purpose: 'workspace-interchange' })).some(ref => ref.id.startsWith('bga_')));
    });
  });

  test('independent issuance bindings and exact archived material, state order and restore creation fail closed', async t => {
    for (const [name, mutation, expected] of [
      ['wrong semantic creation', (f: Awaited<ReturnType<typeof fixture>>) => { f.root.faults.changeMaterial = value => { value.pin.creationId = 'different_material_creation'; }; }, 'FIXTURE_ARCHIVED_MATERIAL_REQUIRED'],
      ['wrong restored creation', (f: Awaited<ReturnType<typeof fixture>>) => { f.input.inertCreationId = 'different_inert_creation'; }, 'BACKUP_ACTIVATION_INERT_CHANGED'],
      ['wrong restored physical generation', (f: Awaited<ReturnType<typeof fixture>>) => { f.root.faults.changeInert = value => { value.inspection.generation = ''; }; }, 'BACKUP_ACTIVATION_INERT_CHANGED'],
      ['missing independent commit ref', (f: Awaited<ReturnType<typeof fixture>>) => { f.root.faults.changeMaterialRefs = refs => { refs.binding.id = 'missing_committed_binding'; }; }, 'BACKUP_ACTIVATION_MATERIAL'],
      ['duplicate semantic refs', (f: Awaited<ReturnType<typeof fixture>>) => { f.root.faults.changeMaterialRefs = refs => { refs.binding = refs.pin; }; }, 'BACKUP_ACTIVATION_MATERIAL'],
      ['different nested state key order', (f: Awaited<ReturnType<typeof fixture>>) => { f.root.faults.changeArchiveState = state => { const fields = state.facts[0].fields; state.facts[0].fields = Object.fromEntries(Object.entries(fields).reverse()); }; }, 'BACKUP_ACTIVATION_STATE_CHANGED'],
      ['different authority store value', (f: Awaited<ReturnType<typeof fixture>>) => { f.root.faults.changeArchiveState = state => { state.workspace.name = 'different_authenticated_root_state'; }; }, 'BACKUP_ACTIVATION_STATE_CHANGED'],
    ] as const) await t.test(name, async sub => {
      const f = await fixture(sub); mutation(f);
      await assert.rejects(() => f.root.host().prepare(context, f.input), code(expected)); assert.equal(f.root.faults.publications, 0);
    });
    await t.test('omitted original encrypted material binding cannot be inferred from same authority revision', async sub => {
      const f = await fixture(sub), retained = await readBackup(f.vault, context, f.chosen.backupId);
      const capture = workspaceBackupV2Bytes(inspectWorkspaceBackupV2(retained.content, budgets), budgets);
      capture.artifacts = capture.artifacts.filter(item => item.ref.id !== artifactId('wic', f.chosen.materialId, 'commit'));
      const material = await readInterchange(f.vault, context, f.chosen.materialId);
      await assert.rejects(() => f.vault.snapshot(() => authenticatedMaterial(f.vault, capture, material)), code('FIXTURE_ARCHIVED_MATERIAL_REQUIRED'));
      assert.equal(f.root.faults.publications, 0);
    });
    await t.test('different independently issued export at the same revision is absent from original complete archive', async sub => {
      const f = await fixture(sub);
      // A separately encrypted, honestly issued same-revision export is still NOT the archived creation.
      const original = await readInterchange(f.vault, context, f.chosen.materialId), recordId = 'other_same_revision_export';
      const pin = { ...original.pin, recordId, creationId: 'other_export_creation' };
      const archiveRef = await f.vault.writeArtifact({ id: artifactId('wic', recordId, 'archive'), purpose: 'workspace-interchange', expectedDigest: null,
        value: { format: 'chausar.interchange-local-archive.v1', recordId, content: original.content } });
      const pinRef = await f.vault.writeArtifact({ id: artifactId('wic', recordId, 'pin'), purpose: 'workspace-interchange', expectedDigest: null,
        value: { format: 'chausar.interchange-local-pin.v1', recordId, pin } });
      await f.vault.writeArtifact({ id: artifactId('wic', recordId, 'commit'), purpose: 'workspace-interchange', expectedDigest: null,
        value: { format: 'chausar.interchange-local-binding.v1', recordId, instance: randomUUID(), contextDigest: interchangeDigest(context),
          pinDigest: interchangeDigest(pin), contentDigest: interchangeDigest(original.content), archive: archiveRef, pin: pinRef, state: 'committed' } });
      await assert.rejects(() => f.root.host().prepare(context, { ...f.input, materialId: recordId }), code('FIXTURE_ARCHIVED_MATERIAL_REQUIRED'));
      assert.equal(f.root.faults.publications, 0);
    });
  });

  test('actual encrypted independent issuance changes and target contamination refuse without adoption', async t => {
    for (const [name, mutation, expected] of [
      ['same-value same-size export re-encryption changes exact archived envelope', async (f: Awaited<ReturnType<typeof fixture>>) => {
        const prior = await requiredArtifact(f.vault, artifactId('wic', f.chosen.materialId, 'archive'));
        const before = await readFile(artifactPath(f.vault, prior));
        const next = await f.vault.writeArtifact({ id: prior.id, purpose: prior.purpose, expectedDigest: prior.valueDigest, value: prior.value });
        assert.deepEqual(next, refOf(prior), 'Value digest and encrypted byte count are deliberately unchanged.');
        assert.notEqual(sha(await readFile(artifactPath(f.vault, next))), sha(before), 'Authenticated envelope bytes are a different creation.');
      }, 'FIXTURE_ARCHIVED_MATERIAL_REQUIRED'],
      ['copied exact inert container under replacement physical directory', async (f: Awaited<ReturnType<typeof fixture>>) => replaceFixtureDirectory(f, f.chosen.inertTargetId, true), 'BACKUP_TARGET_CHANGED'],
      ['empty activation target under replacement physical directory', async (f: Awaited<ReturnType<typeof fixture>>) => replaceFixtureDirectory(f, f.chosen.targetId, false), 'INTERCHANGE_TARGET_CHANGED'],
      ['wrong backup creation', async (f: Awaited<ReturnType<typeof fixture>>) => corruptArtifact(f.vault, artifactId('wb2', f.chosen.backupId, 'pin'), v => { v.pin.creationId = 'different_backup_creation'; }), 'BACKUP_CUSTODY_CHANGED'],
      ['discarded semantic binding', async (f: Awaited<ReturnType<typeof fixture>>) => corruptArtifact(f.vault, artifactId('wic', f.chosen.materialId, 'commit'), v => { v.state = 'discarded'; }), 'INTERCHANGE_CUSTODY_NOT_COMMITTED'],
      ['changed semantic independent pin', async (f: Awaited<ReturnType<typeof fixture>>) => corruptArtifact(f.vault, artifactId('wic', f.chosen.materialId, 'pin'), v => { v.pin.creationId = 'replacement_creation'; }), 'INTERCHANGE_CUSTODY_CHANGED'],
      ['discarded complete backup binding', async (f: Awaited<ReturnType<typeof fixture>>) => corruptArtifact(f.vault, artifactId('wb2', f.chosen.backupId, 'binding'), v => { v.state = 'discarded'; }), 'BACKUP_CUSTODY_NOT_COMMITTED'],
      ['target reservation generation', async (f: Awaited<ReturnType<typeof fixture>>) => corruptArtifact(f.vault, 'bridge_fixture_target', v => { v.physical.ino = 'different_physical_target'; }), 'INTERCHANGE_TARGET_CHANGED'],
      ['target unexpected file', async (f: Awaited<ReturnType<typeof fixture>>) => writeFile(join(f.applicationDirectory, f.chosen.targetId, 'synthetic-user.txt'), 'preserve synthetic target work'), 'INTERCHANGE_TARGET_NOT_EMPTY'],
      ['inert extra authority file', async (f: Awaited<ReturnType<typeof fixture>>) => writeFile(join(f.applicationDirectory, f.chosen.inertTargetId, 'authority.encrypted.json'), 'synthetic unrelated authority'), 'BACKUP_TARGET_CHANGED'],
    ] as const) await t.test(name, async sub => {
      const f = await fixture(sub); await mutation(f);
      await assert.rejects(() => f.root.host().prepare(context, f.input), code(expected)); assert.equal(f.root.faults.publications, 0);
    });
  });

  test('publication guard revocation and absent publication guard retain unknown outcomes without automatic cleanup or replay', async t => {
    await t.test('readiness revokes immediately at actual encrypted publication', async sub => {
      const f = await fixture(sub); f.root.faults.beforePublish = async () => { f.root.faults.ready = false; };
      await assert.rejects(() => f.root.host().prepare(context, f.input), code('BACKUP_ACTIVATION_COMMIT_UNKNOWN'));
      assert.equal(f.root.faults.publications, 0);
      assert.ok(!(await f.vault.listArtifacts({ purpose: 'workspace-interchange' })).some(ref => ref.id.startsWith('bga_')));
    });
    await t.test('root that omits mandatory publication guard cannot acknowledge a candidate', async sub => {
      const f = await fixture(sub); f.root.faults.skipPublicationGuard = true;
      await assert.rejects(() => f.root.host().prepare(context, f.input), code('BACKUP_ACTIVATION_COMMIT_UNKNOWN'));
      assert.equal(f.root.faults.publications, 1);
      assert.equal((await readInterchange(f.vault, context, f.chosen.candidateId, true)).pin.kind, 'candidate');
    });
    await t.test('revocation after durable publication cannot silently return activation evidence', async sub => {
      const f = await fixture(sub); f.root.faults.beforeReadCandidate = async () => { f.root.faults.complete = false; };
      await assert.rejects(() => f.root.host().prepare(context, f.input), code('BACKUP_ACTIVATION_COMMIT_UNKNOWN')); assert.equal(f.root.faults.publications, 1);
      await assert.rejects(() => f.root.host().inspect(context, { candidateId: f.chosen.candidateId }), code('INTERCHANGE_READ_SCOPE_REQUIRED'));
      f.root.faults.complete = true; f.root.faults.beforeReadCandidate = undefined;
      assert.equal((await f.root.host().inspect(context, { candidateId: f.chosen.candidateId })).review.candidateId, f.chosen.candidateId);
      assert.equal(f.root.faults.publications, 1);
    });
  });

  test('managed connector history refuses even with actual encrypted archive and semantic custody', async t => {
    const f = await fixture(t, state => {
      const content = '{"synthetic":true}\r\n', domain = { company: 'fixture company', dataset: 'fixture dataset', branches: ['Main'] };
      const capture = { type: 'connector-capture-v1', id: 'capture_managed_fixture', sourceId: 'connector_fixture', reviewId: 'review_managed_fixture',
        recipe: demoRecipe, recipeHash: interchangeDigest(demoRecipe), domain, operationKey: 'fixture:import', decoderId: 'fixture_decoder',
        decoderVersion: '1', schemaSha256: sha('synthetic-schema'), decoderDefinitionHash: sha('synthetic-definition'), identityNamespace: 'fixture-identities',
        totalBytes: Buffer.byteLength(content), status: 'quarantined', gaps: [{ code: 'SYNTHETIC_UNQUALIFIED' }],
        pages: [{ deliveryId: 'fixture_delivery', content, sha256: sha(content), bytes: Buffer.byteLength(content) }] };
      state.imports.push({ type: 'connector-mapping-review-v1', id: capture.reviewId, sourceId: capture.sourceId, recipeHash: capture.recipeHash,
        domain, operationKey: capture.operationKey, decoderId: capture.decoderId, decoderVersion: capture.decoderVersion, schemaSha256: capture.schemaSha256 }, capture);
    });
    await assert.rejects(() => f.root.host().prepare(context, f.input), code('ACTIVATION_MANAGED_SOURCE')); assert.equal(f.root.faults.publications, 0);
  });

  test('explicit confirmation, current desktop context, identity and whole-candidate budgets are mandatory', async t => {
    const f = await fixture(t);
    await t.test('archive digest acknowledgement', async () => assert.rejects(() => f.root.host().prepare(context, { ...f.input, reviewedArchiveDigest: '0'.repeat(64) }), code('INTERCHANGE_REVIEW_CHANGED')));
    await t.test('confirmation', async () => assert.rejects(() => f.root.host().prepare(context, { ...f.input, confirmed: false as unknown as true }), code('CONFIRMATION_REQUIRED')));
    await t.test('tainted context', async () => assert.rejects(() => f.root.host().prepare({ ...context, sourceTainted: true }, f.input), code('APP_APPROVAL_REQUIRED')));
    await t.test('phone context', async () => assert.rejects(() => f.root.host().prepare({ ...context, channel: 'phone' }, f.input), code('APP_APPROVAL_REQUIRED')));
    await t.test('complete candidate budget', async () => assert.rejects(() => new WorkspaceBackupActivationHost(f.root.ports,
      { ...policyFor(f.vault.read().workspace.id), maxCandidateUtf8Bytes: 100 }).prepare(context, f.input), code('BACKUP_ACTIVATION_LIMIT')));
    await t.test('separate activation target', async () => assert.rejects(() => f.root.host().prepare(context, { ...f.input, targetId: f.input.inertTargetId }), code('BACKUP_ACTIVATION_IDENTITY')));
    assert.equal(f.root.faults.publications, 0);
  });
}
