import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash, randomBytes} from 'node:crypto';
import {lstat, mkdir, readFile, realpath} from 'node:fs/promises';
import {isAbsolute, join, relative, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Engine} from '../../runtime/engine.ts';
import {Vault, type VaultEncryptedCustodyBudgets} from '../../runtime/vault.ts';
import {hash, type State} from '../../runtime/contracts.ts';
import {PostgresSnapshotAdapter, postgresEnvelopeDigest} from '../../runtime/postgres.ts';
import {InstalledPostgresWorkspaceProfile} from '../../runtime/workspace-postgres-installed-profile.ts';
import type {PostgresPublicationProof} from '../../runtime/workspace-postgres-custody.ts';
import type {WorkspaceActivationPolicy} from '../../runtime/workspace-activation.ts';
import {interchangeDigest} from '../../runtime/workspace-interchange.ts';
import type {CalculationReceipt} from '../../runtime/calculator.ts';

// Trusted acceptance composition only. It supplies the actual installed native
// profile; all business operations remain the worker's real loopback HTTP calls.
// Import/preflight never launches a database, opens a Vault, or reads credentials.
export const contractVersion = 'chausar.postgres-transfer-acceptance-profile.v1';
type SourcePin = {sourceRoot: string; commit: string; tree: string};
type Connection = {host: '127.0.0.1'; port: number; user: string; password: string; ssl: false};
type Fixture = {applicationDirectory: string; databases: {source: string; journal: string; target: string}};
type Descriptor = {format: string; backend: string; synthetic: boolean; permanentService: boolean;
  existingDependenciesOnly: boolean; connection: Connection; fixtures: {primary: Fixture; prepared: Fixture}};
type NativeHandle = {descriptor: Descriptor; start(signal: AbortSignal): Promise<void>; close(): Promise<void>; inspectStopped(): Promise<{stopped: boolean}>};
type NativeFactory = (input: {ownedRunRoot: string; sourcePin: SourcePin}) => NativeHandle;
type Phase = 'primary-before-reopen' | 'primary-after-reopen' | 'isolated-prepared-open';
type Credentials = {source: string; journal: string; target: string};
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
let admitted: SourcePin | undefined, nativeFactory: NativeFactory | undefined;

export async function assertNativeTransferCompositionAvailable({sourcePin}: {sourcePin: SourcePin}) {
  assert.match(sourcePin.commit, /^[0-9a-f]{40}$/); assert.match(sourcePin.tree, /^[0-9a-f]{40}$/);
  const ownRoot = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
  assert.equal(resolve(sourcePin.sourceRoot), ownRoot, 'Import exactly the pinned checkout fixture.');
  const tracked = spawnSync('git', ['-C', ownRoot, 'ls-files', '--error-unmatch',
    'platform/tests/fixtures/postgres-transfer-root.ts', 'platform/tests/fixtures/postgres-transfer-native-lifecycle.mjs',
    'platform/tests/fixtures/postgres-transfer-worker.mjs',
    'platform/runtime/workspace-postgres-installed-profile.ts', 'platform/runtime/workspace-postgres-originals.ts',
    'platform/runtime/engine.ts', 'platform/runtime/vault.ts', 'platform/runtime/postgres.ts',
    'platform/runtime/workspace-postgres-custody.ts', 'platform/runtime/workspace-backup-postgres.ts',
    'platform/runtime/workspace-activation-postgres.ts'], {encoding: 'utf8', windowsHide: true, timeout: 10000, maxBuffer: 262144});
  assert.equal(tracked.status, 0, 'All real production composition and lifecycle files must belong to the exact final tracked tree.');
  const git = (args: string[]) => {
    const result = spawnSync('git', ['-C', ownRoot, ...args], {encoding: 'utf8', windowsHide: true, timeout: 10000, maxBuffer: 262144});
    assert.equal(result.status, 0); return result.stdout.trim();
  };
  assert.equal(git(['rev-parse', 'HEAD']), sourcePin.commit); assert.equal(git(['rev-parse', 'HEAD^{tree}']), sourcePin.tree);
  assert.equal(git(['status', '--porcelain', '--untracked-files=no']), '', 'Each worker must import the same clean frozen source.');
  for (const name of ['install', 'installedCustody', 'targetCustody']) {
    assert.equal(typeof (InstalledPostgresWorkspaceProfile.prototype as unknown as Record<string, unknown>)[name], 'function');
  }
  assert.equal(typeof Vault.inspectPostgresSnapshot, 'function');
  assert.equal(typeof PostgresSnapshotAdapter.connect, 'function');
  assert.equal(typeof Engine.prototype.activatedWorkspaceEngine, 'function');
  const lifecycle = await import(new URL('./postgres-transfer-native-lifecycle.mjs', import.meta.url).href);
  assert.equal(lifecycle.nativeLifecycleContract, 'chausar.postgres-transfer-native-lifecycle.v1');
  assert.equal(typeof lifecycle.createNativeEnvironment, 'function');
  nativeFactory = lifecycle.createNativeEnvironment as NativeFactory;
  admitted = {...sourcePin};
}
export const assertCompositionAvailable = assertNativeTransferCompositionAvailable;

export function createNativeTransferEnvironment(input: {ownedRunRoot: string; sourcePin: SourcePin}): NativeHandle {
  assert.deepEqual(input.sourcePin, admitted, 'Constructor preflight must succeed before native ownership is created.');
  assert.ok(nativeFactory); return nativeFactory(input);
}
export const createNativeEnvironment = createNativeTransferEnvironment;

const within = (root: string, path: string) => {
  const rel = relative(root, path); return !isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep);
};
function postgresUrl(connection: Connection, database: string) {
  const url = new URL(`postgresql://${connection.host}:${connection.port}/${database}`);
  url.username = connection.user; url.password = connection.password; return url.href;
}

export async function constructNativeTransferProfile(input: {sourcePin: SourcePin; descriptor: Descriptor;
  credentials: Credentials; phase: Phase; signal: AbortSignal}) {
  await assertNativeTransferCompositionAvailable({sourcePin: input.sourcePin});
  assert.ok(['primary-before-reopen', 'primary-after-reopen', 'isolated-prepared-open'].includes(input.phase));
  const {descriptor, credentials, signal} = input;
  assert.equal(descriptor.backend, 'native-postgresql'); assert.equal(descriptor.synthetic, true);
  assert.equal(descriptor.permanentService, false); assert.equal(descriptor.existingDependenciesOnly, true);
  const fixture = descriptor.fixtures[input.phase === 'isolated-prepared-open' ? 'prepared' : 'primary'];
  const connection = descriptor.connection;
  assert.equal(connection.host, '127.0.0.1'); assert.equal(connection.ssl, false);
  assert.ok(Number.isInteger(connection.port) && connection.port >= 1024 && connection.port <= 65535);
  assert.equal(new Set(Object.values(fixture.databases)).size, 3);
  for (const database of Object.values(fixture.databases)) assert.match(database, /^chausar_[a-z0-9_]{1,54}$/);
  const app = resolve(fixture.applicationDirectory);
  const runs = join(resolve(input.sourcePin.sourceRoot, '..'), 'postgres-transfer-acceptance-prep', 'runs');
  assert.ok(/^C:[\\/]/i.test(app) && within(runs, app), 'Own synthetic data only below the supervisor C run root.');
  assert.equal(await realpath(app), app);
  const sourceDirectory = join(app, 'main'), journalDirectory = join(app, 'journal');
  await mkdir(sourceDirectory, {recursive: true}); await mkdir(journalDirectory, {recursive: true});
  const prefix = input.phase === 'isolated-prepared-open' ? 'synthetic_prepared_' : 'synthetic_primary_';
  const targetId = prefix + 'targetId', targetSlot = hash(join(app, targetId, 'live', 'main'));
  const connect = (role: keyof Fixture['databases'], directory: string) => {
    assert.equal(signal.aborted, false);
    return PostgresSnapshotAdapter.connect({...connection, database: fixture.databases[role], vaultSlot: hash(directory), maxConnections: 2});
  };
  let journalAdapter: PostgresSnapshotAdapter | undefined, targetAdapter: PostgresSnapshotAdapter | undefined;
  let journalVault: Vault | undefined;
  const sourceEngine = new Engine({directory: app, storage: 'postgres', postgresUrl: postgresUrl(connection, fixture.databases.source)});
  let installed: InstalledPostgresWorkspaceProfile | undefined, closed = false;
  try {
    // Install every target schema and the exact journal adapter before the source
    // is opened or any complete source schema/namespace fingerprint is captured.
    targetAdapter = await connect('target', join(app, targetId, 'live', 'main'));
    assert.equal(targetAdapter.slot, targetSlot);
    journalAdapter = await connect('journal', journalDirectory);
    journalVault = input.phase === 'primary-after-reopen'
      ? await Vault.open({directory: journalDirectory, passphrase: credentials.journal, storage: journalAdapter})
      : (await Vault.create({directory: journalDirectory, passphrase: credentials.journal, name: 'Synthetic native transfer journal', storage: journalAdapter, demo: false})).vault;
    const stableTarget = targetAdapter, stableJournal = journalAdapter, actualJournal = journalVault;
    const requireInstalled = () => {assert.ok(installed, 'Install and reopen the actual source before custody inspection.'); return installed;};
    const nativeWitness = async (engine: Engine) => {
      assert.ok(engine.vault); const profile = requireInstalled();
      const databaseRole = engine === sourceEngine ? 'source' as const : 'target' as const;
      const custody = databaseRole === 'source' ? profile.installedCustody().source : profile.targetCustody(targetId);
      return engine.vault.snapshot(() => custody.withSource(async held => {
        assert.equal(held.authority.vaultId, engine.vault!.vaultId);
        assert.equal(held.authority.revision, engine.vault!.read().revision);
        await held.assertCurrent();
        return {databaseRole, slot: held.storage.slot, storageId: held.storage.storageId, ...held.authority};
      }));
    };
    return {
      sourceEngine, journalVault: actualJournal,
      async enableCapabilities({historicalState, policy, reopen}: {historicalState: State; policy: WorkspaceActivationPolicy; reopen: boolean}) {
        assert.ok(sourceEngine.vault); assert.equal(sourceEngine.vault.storageKind, 'postgres');
        assert.deepEqual(sourceEngine.vault.read(), historicalState);
        assert.equal(reopen, input.phase === 'primary-after-reopen');
        assert.equal(installed, undefined, 'Freeze exactly one installed profile per worker.');
        installed = new InstalledPostgresWorkspaceProfile({applicationDirectory: app, sourceDirectory,
          sourceAdapter: () => connect('source', sourceDirectory), journalVault: actualJournal, journalAdapter: stableJournal,
          policy, targetPassphrase: async () => credentials.target,
          targets: [{targetId, adapter: stableTarget, ownedAdapter: () => connect('target', join(app, targetId, 'live', 'main'))}]});
        sourceEngine.options.postgresWorkspace = installed;
      },
      currentSourceContext() {return sourceEngine.bootstrapContext();},
      captureSourceCustody(budgets: VaultEncryptedCustodyBudgets) {
        assert.ok(sourceEngine.vault);
        return requireInstalled().installedCustody().backup.withHeldSource(sourceEngine.bootstrapContext(),
          () => sourceEngine.vault!.captureEncryptedCustody(budgets));
      },
      readNativeSlot: nativeWitness,
      async seedPublicHistory({baseline}: {baseline: CalculationReceipt[]}) {
        assert.equal(baseline.length, 3);
        const next = new Date(Date.now() + 86400000).toISOString();
        return [
          {method: 'decisions.create', payload: {text: 'Synthetic native transfer retained decision', reviewDate: next.slice(0, 10), receiptIds: baseline.map(item => item.id)}},
          {method: 'jobs.create', payload: {type: 'owner-brief', goal: 'Synthetic retained owner brief', budgetMinor: '1', reserveMinor: '1',
            stopRule: {maxRuns: 1, deadline: next}, sourceIds: ['demo-export'], nextRunAt: next, intervalMs: 86400000, requiresApproval: true}},
        ];
      },
      async withPreparedStage({execute, dispatch}: {execute: {activationId: string; projectionDigest: string}; dispatch(): Promise<unknown>}, observer: (stage: unknown) => Promise<void>) {
        const custody = requireInstalled().targetCustody(targetId), original = custody.publish;
        let calls = 0;
        custody.publish = async (proof: PostgresPublicationProof) => {
          assert.equal(++calls, 1, 'Observe the original single actual native publication.');
          try {
            const inspection = await custody.inspect(proof);
            assert.equal(inspection.status, 'prepared'); assert.deepEqual(inspection.proof, proof); assert.ok(inspection.envelope);
            assert.equal(postgresEnvelopeDigest(inspection.envelope), proof.envelopeDigest);
            assert.equal(proof.storage.slot, targetSlot);
            const retained = await actualJournal.readArtifact({id: 'wpg_' + sha(execute.activationId) + '_attempt', purpose: 'workspace-interchange'});
            const journal = retained.value as {format: string; phase: string; publicationDigest: string; sourceVaultId: string; journalVaultId: string;
              envelopeSha256: string; envelopePhysical: {dev: string; ino: string; birthtimeNs: string};
              record: {activationId: string; targetId: string; projectionDigest: string}; proof: PostgresPublicationProof};
            assert.equal(journal.format, 'chausar.activation-postgres-journal.v1'); assert.equal(journal.phase, 'prepared');
            assert.equal(journal.sourceVaultId, sourceEngine.vault!.vaultId); assert.equal(journal.journalVaultId, actualJournal.vaultId);
            assert.equal(journal.record.activationId, execute.activationId); assert.equal(journal.record.targetId, targetId);
            assert.equal(journal.record.projectionDigest, execute.projectionDigest); assert.deepEqual(journal.proof, proof);
            assert.match(journal.publicationDigest, /^[0-9a-f]{64}$/);
            // Observe the independently journal-bound physical ciphertext at its
            // published final path, as well as the real prepared SQL proof.
            const file = join(app, targetId, 'live', 'postgres-publication.encrypted.json');
            const before = await lstat(file, {bigint: true});
            const physical = (stat: typeof before) => ({dev: String(stat.dev), ino: String(stat.ino), birthtimeNs: String(stat.birthtimeNs)});
            assert.ok(before.isFile() && !before.isSymbolicLink() && before.nlink === 1n && before.size <= 64n * 1024n * 1024n);
            assert.deepEqual(physical(before), journal.envelopePhysical);
            const bytes = await readFile(file), after = await lstat(file, {bigint: true});
            assert.deepEqual(physical(after), physical(before)); assert.equal(after.size, before.size); assert.equal(BigInt(bytes.length), before.size);
            assert.equal(createHash('sha256').update(bytes).digest('hex'), journal.envelopeSha256);
            const stageBindingDigest = interchangeDigest({proof, publicationDigest: journal.publicationDigest,
              envelopeSha256: journal.envelopeSha256, envelopePhysical: journal.envelopePhysical});
            const normalTargetEngine = new Engine({directory: join(app, targetId, 'live'), storage: 'postgres', postgresUrl: postgresUrl(connection, fixture.databases.target)});
            try {
              await observer({phase: 'prepared', persisted: true, activationId: execute.activationId, targetId,
                projectionDigest: execute.projectionDigest, stageBindingDigest,
                preparedWitness: {databaseRole: 'target', slot: proof.storage.slot, storageId: proof.storage.storageId,
                  operationId: proof.operationId, creationId: proof.creationId, vaultId: proof.vaultId, envelopeDigest: proof.envelopeDigest},
                finalSlotPublicationWitness: {authenticated: true, durable: true, phase: 'prepared', activationId: execute.activationId,
                  targetId, projectionDigest: execute.projectionDigest, stageBindingDigest, finalLiveSlot: targetSlot},
                normalTargetEngine,
                // Each valid managed request must hit ordinary native admission
                // before any credential, recovery, or backup intake. The restore
                // file is deliberately unread; this does not qualify decryption.
                ordinaryAdmissionRequests: [
                  {method: 'workspace.create', payload: {name: 'Synthetic prepared refusal', pack: 'retail', passphrase: credentials.target, demo: false}},
                  {method: 'workspace.open', payload: {passphrase: credentials.target}},
                  {method: 'workspace.recover', payload: {passphrase: credentials.target, recoveryCode: 'CHR-' + randomBytes(32).toString('base64url')}},
                  {method: 'workspace.restore', payload: {folder: 'main', backupFile: 'unread-preflight.backup', passphrase: credentials.target}},
                ].map(item => ({...item, expectedCode: 'POSTGRES_TARGET_NOT_COMMITTED'}))});
            } finally {await normalTargetEngine.close();}
          } finally {
            // Finish the one already approved real dispatch even when an
            // acceptance assertion fails; never leave a test-held publication.
            await original.call(custody, proof);
          }
        };
        try {const result = await dispatch(); assert.equal(calls, 1); return result;}
        finally {custody.publish = original;}
      },
      diagnostics() {
        for (const key of ['gateway', 'sync', 'durableJobs', 'connectorCredentials', 'connectorRuntime', 'research'] as const) assert.equal(sourceEngine.options[key], undefined);
        // No dispatch/inference/effect capability is installed, rather than a
        // permissive fake provider returning qualified results.
        return {providerCalls: 0, externalEffectCalls: 0, automaticDispatchCalls: 0, authority: 'no-provider-or-effect-capability-installed'};
      },
      async close() {
        if (closed) return; closed = true;
        const results = await Promise.allSettled([sourceEngine.shutdown(), actualJournal.close(), stableTarget.close()]);
        assert.ok(results.every(result => result.status === 'fulfilled'), 'Close only owned Vault/adapter handles without deleting durable evidence.');
      },
    };
  } catch (error) {
    await Promise.allSettled([sourceEngine.shutdown(), journalVault ? journalVault.close() : journalAdapter?.close(), targetAdapter?.close()]);
    throw error;
  }
}
export const constructTransferProfile = constructNativeTransferProfile;
