import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { authorize, ChausarError, hash, type Context, type State } from '../runtime/contracts.ts';
import { Vault, type PrivateArtifactRef } from '../runtime/vault.ts';
import { canonicalInterchangeJson, captureWorkspaceInterchange, interchangeDigest } from '../runtime/workspace-interchange.ts';
import { WorkspaceActivationHost, type AuthenticatedActivationCandidate, type WorkspaceActivationAuthority,
  type WorkspaceActivationCommit, type WorkspaceActivationPorts, type WorkspaceActivationReadback } from '../runtime/workspace-activation.ts';
import { WorkspaceImportCandidateService } from '../runtime/workspace-import-candidate.ts';
import { artifactsFor, deterministicShopState, emptyTarget, fixedTime } from './fixtures/workspace-interchange-fixture.ts';
import {
  captureWorkspaceBackupV2, encodeWorkspaceBackupV2, workspaceBackupV2Bytes,
  type WorkspaceBackupV2Budgets,
} from '../runtime/workspace-backup-v2.ts';
import { createWorkspaceBackupV2LocalPorts } from '../runtime/workspace-backup-local.ts';

// Synthetic encrypted experimental-file custody. Historical authority remains
// inert; the final case authenticates an independently created fresh live Vault.
const budgets: WorkspaceBackupV2Budgets = { maxArchiveUtf8Bytes: 4_000_000, maxEntryBytes: 1_000_000,
  maxTotalEntryBytes: 2_000_000, maxEntries: 100, maxJsonDepth: 32, maxJsonNodes: 20_000 };
const filesystemBudgets = { maxFiles: 100, maxBytes: 4_000_000, maxDepth: 16 };
const encryptedBudgets = { maxEntryBytes: 1_000_000, maxTotalEntryBytes: 2_000_000, maxArtifacts: 99 };
const externalKeyRequirements = [{ provider: 'other' as const, namespace: 'operator/credential-wrappers',
  requirement: 'Separately retain the synthetic source and reviewed journal operator credential wrappers.' }];
const context: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop', sourceTainted: false };
const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const code = (expected: string) => (error: unknown) => error instanceof ChausarError && error.code === expected;
const physical = (stat: { dev: bigint; ino: bigint; birthtimeNs: bigint }) =>
  ({ dev: String(stat.dev), ino: String(stat.ino), birthtimeNs: String(stat.birthtimeNs) });
const artifactPath = (vault: Vault, ref: PrivateArtifactRef) =>
  join(vault.directory, 'private-artifacts', ref.purpose, `${ref.id}.encrypted.json`);

async function fixture(t: TestContext) {
  const base = await realpath(tmpdir());
  if (process.platform === 'win32') assert.match(base, /^C:\\/i, 'Validate canonical C scratch before creating fixture files.');
  const applicationDirectory = await realpath(await mkdtemp(join(base, 'chausar-backup-activation-')));
  assert.equal(dirname(applicationDirectory), base);
  const vaults = new Set<Vault>();
  t.after(async () => {
    for (const vault of vaults) await vault.close();
    const actual = await realpath(applicationDirectory), child = relative(base, actual);
    assert.equal(dirname(actual), base);
    assert.ok(child && !isAbsolute(child) && !child.startsWith('..') && child.startsWith('chausar-backup-activation-'));
    await rm(actual, { recursive: true, force: true });
  });
  const createVault = async (name: string) => {
    const directory = join(applicationDirectory, name), child = relative(applicationDirectory, directory);
    assert.ok(child && !isAbsolute(child) && !child.startsWith('..'));
    const created = await Vault.create({ directory, storage: 'experimental-file',
      passphrase: `Synthetic ${name} separate encrypted custody passphrase`, name: `Synthetic ${name}`, demo: true });
    vaults.add(created.vault); return created;
  };
  const { vault } = await createVault('source'), { vault: journal } = await createVault('journal');
  const sourceRef = await vault.writeArtifact({ id: 'source_business', purpose: 'workspace-interchange',
    value: { format: 'synthetic.source.business.v1', secret: 'Synthetic source business 671283' }, expectedDigest: null });
  const journalRef = await journal.writeArtifact({ id: 'journal_retained_control', purpose: 'workspace-interchange',
    value: { format: 'synthetic.journal.control.v1', status: 'failed', secret: 'Synthetic journal secret 891324' }, expectedDigest: null });
  await journal.writeArtifact({ id: 'journal_private_terminal', purpose: 'private-trial',
    value: { format: 'synthetic.journal.private.v1', status: 'discarded' }, expectedDigest: null });
  await journal.writeArtifact({ id: 'wal_ledger_v1', purpose: 'workspace-interchange',
    value: { format: 'chausar.activation-local-ledger.v1', claims: [] }, expectedDigest: null });
  const assertCompleteOwner = async (current: Context, historical: State) => {
    const member = authorize(vault, current, 'admin'); assert.equal(member.role, 'owner');
    assert.deepEqual(member.branches, ['*']); assert.equal(historical.workspace.id, vault.read().workspace.id);
  };
  const withCompleteOwner = async <T>(current: Context, historical: State,
    work: (assertCurrent: () => void) => Promise<T>): Promise<T> => {
    await assertCompleteOwner(current, historical); return vault.withCustodyWriterAdmission(work);
  };
  const local = (options: Partial<Parameters<typeof createWorkspaceBackupV2LocalPorts>[0]> = {}) =>
    createWorkspaceBackupV2LocalPorts({ vault, applicationDirectory, budgets, filesystemBudgets,
      externalKeyRequirements, assertCompleteOwner, withCompleteOwner, workspaceActivation: { journalVault: journal }, ...options });
  const capture = (target = vault) => target.snapshot(() => target.captureEncryptedCustody(encryptedBudgets));
  const reserve = async (targetId = 'empty_owned_target') => {
    const target = join(applicationDirectory, targetId); await mkdir(target);
    const reservation = { format: 'chausar.interchange-target-reservation.v1', sourceVaultId: vault.vaultId,
      sourceWorkspaceId: vault.read().workspace.id, targetId, workspaceId: `workspace_${randomUUID()}`,
      generation: `empty_${randomUUID()}`, contextDigest: interchangeDigest(context),
      physical: physical(await lstat(target, { bigint: true })) };
    const ref = await vault.writeArtifact({ id: `wit_${sha(targetId)}_reservation`, purpose: 'workspace-interchange',
      value: reservation, expectedDigest: null });
    return { target, reservation, ref };
  };
  return { vault, journal, sourceRef, journalRef, applicationDirectory, createVault, local, capture, reserve };
}

async function image(directory: string) {
  const result: { path: string; bytes: Buffer }[] = [];
  const walk = async (current: string) => {
    for (const name of (await readdir(current)).sort()) {
      const path = join(current, name), stat = await lstat(path);
      if (stat.isDirectory()) await walk(path);
      else result.push({ path: relative(directory, path), bytes: await readFile(path) });
    }
  };
  await walk(directory); return result;
}

async function withoutOpening<T>(protectedPath: string, work: () => Promise<T>): Promise<T> {
  const original = fs.promises.open; let opens = 0;
  fs.promises.open = async (path, flags, mode) => {
    const actual = resolve(String(path));
    if (actual === protectedPath || actual.startsWith(`${protectedPath}${sep}`)) {
      opens++; throw new ChausarError('TEST_UNISSUED_FILE_OPENED', 'An unissued physical namespace was opened.');
    }
    return original(path, flags, mode);
  };
  syncBuiltinESMExports();
  try { return await work(); }
  finally { fs.promises.open = original; syncBuiltinESMExports(); assert.equal(opens, 0, 'Refusal must precede reading unissued bytes.'); }
}

test('explicit journal capability separately authenticates every measured ciphertext and excludes it from source archive bytes', async t => {
  const f = await fixture(t), source = await f.capture(), journal = await f.capture(f.journal), custody = f.local();
  const beforeJournal = await image(f.journal.directory), sourceState = f.vault.read();
  const archive = await custody.ports.withSource(context, null, async lease => {
    assert.equal(lease.independentlyEnumerated, true); await lease.authenticateCapture(lease.capture);
    return captureWorkspaceBackupV2(lease.capture, budgets);
  });
  const decoded = workspaceBackupV2Bytes(archive, budgets);
  assert.deepEqual(Buffer.from(decoded.authority), source.authority); assert.deepEqual(decoded.artifacts, source.artifacts);
  assert.equal(archive.pin.fullWorkspacePortable, false); assert.equal(archive.pin.artifacts.length, 1);
  assert.ok(!archive.pin.artifacts.some(item => item.id.startsWith('journal_') || item.id === 'wal_ledger_v1'));
  assert.ok(!Buffer.from(decoded.authority).equals(journal.authority));
  const diagnostics = custody.diagnostics()!; assert.equal(diagnostics.fullWorkspacePortable, false);
  const prefix = 'application/journal/journal', physicalFiles = diagnostics.physicalFiles.filter(item => item.path.startsWith(`${prefix}/`));
  assert.equal(physicalFiles.length, journal.artifacts.length + 2);
  for (const [path, bytes] of [[`${prefix}/authority.encrypted.json`, journal.authority],
    ...journal.artifacts.map(item => [`${prefix}/private-artifacts/${item.ref.purpose}/${item.ref.id}.encrypted.json`, item.bytes] as const)] as const) {
    const measured = physicalFiles.find(item => item.path === path)!;
    assert.equal(measured.bytes, bytes.length); assert.equal(measured.sha256, sha(bytes));
    const stat = await lstat(join(f.journal.directory, path.slice(prefix.length + 1)), { bigint: true });
    assert.deepEqual({ dev: measured.dev, ino: measured.ino, birthtimeNs: measured.birthtimeNs }, physical(stat));
  }
  for (const purpose of ['private-trial', 'workspace-interchange'] as const) {
    const row = archive.pin.namespaces.find(item => item.namespace === `${prefix}/private-artifacts/${purpose}`)!;
    const retained = journal.artifacts.filter(item => item.ref.purpose === purpose);
    assert.equal(row.disposition, 'outside-archive'); assert.equal(row.entries, retained.length);
    assert.equal(row.bytes, retained.reduce((sum, item) => sum + item.bytes.length, 0)); assert.ok(row.requirement.length > 0);
  }
  const authority = archive.pin.namespaces.find(item => item.namespace === `${prefix}/authority`)!;
  assert.equal(authority.disposition, 'outside-archive'); assert.equal(authority.entries, 1); assert.equal(authority.bytes, journal.authority.length);
  const writer = archive.pin.namespaces.find(item => item.namespace === `${prefix}/writer.lock`)!;
  assert.equal(writer.disposition, 'transient'); assert.equal(writer.entries, 1);
  assert.equal(writer.bytes, (await readFile(join(f.journal.directory, 'writer.lock'))).length);
  const encoded = encodeWorkspaceBackupV2(archive, budgets);
  assert.ok(!encoded.includes('Synthetic journal secret 891324')); assert.ok(!encoded.includes('Synthetic source business 671283'));
  for (const item of journal.artifacts) assert.ok(!encoded.includes(Buffer.from(item.bytes).toString('base64')));
  assert.deepEqual(await image(f.journal.directory), beforeJournal); assert.deepEqual(f.vault.read(), sourceState);
});

test('omitted journal capability and a mere outside declaration both refuse without opening or changing journal custody', async t => {
  const f = await fixture(t), before = await image(f.journal.directory), source = await f.capture();
  await withoutOpening(f.journal.directory, async () => {
    await assert.rejects(f.local({ workspaceActivation: undefined }).ports.withSource(context, null, async () => {}), code('BACKUP_INVENTORY_INCOMPLETE'));
    await assert.rejects(f.local({ workspaceActivation: undefined, outsideApplicationNamespaces: [
      { name: 'journal', requirement: 'A declaration cannot authorize this separately credentialed journal.' },
    ] }).ports.withSource(context, null, async () => {}), code('BACKUP_EXTERNAL_ENUMERATION_REQUIRED'));
  });
  assert.deepEqual(await image(f.journal.directory), before); assert.deepEqual(await f.capture(), source);
});

test('journal constructor capability must identify one distinct direct actual experimental-file Vault with no extra declarations', async t => {
  const f = await fixture(t), before = await image(f.journal.directory);
  assert.throws(() => f.local({ workspaceActivation: { journalVault: f.vault } }), code('BACKUP_ACTIVATION_SCOPE'));
  const nested = (await f.createVault(join('source', 'reports', 'nested_journal'))).vault;
  assert.throws(() => f.local({ workspaceActivation: { journalVault: nested } }), code('BACKUP_ACTIVATION_SCOPE'));
  assert.throws(() => f.local({ workspaceActivation: { journalVault: f.journal, unchecked: true } as never }), code('BACKUP_ACTIVATION_SCOPE'));
  assert.throws(() => f.local({ workspaceActivation: { journalVault: {} as Vault } }), code('BACKUP_ACTIVATION_SCOPE'));
  assert.throws(() => f.local({ outsideApplicationNamespaces: [{ name: 'journal', requirement: 'Ambiguous duplicate journal scope.' }] }), code('BACKUP_SOURCE_SCOPE'));
  assert.throws(() => f.local().targetPath('journal'), code('BACKUP_TARGET_IDENTITY'));
  assert.deepEqual(await image(f.journal.directory), before);
});

test('an empty interchange target is measured only with its exact authenticated source-owned wit reservation', async t => {
  const f = await fixture(t), reserved = await f.reserve(), source = await f.capture(), custody = f.local();
  const archive = await custody.ports.withSource(context, null, async lease => captureWorkspaceBackupV2(lease.capture, budgets));
  const row = archive.pin.namespaces.find(item => item.namespace === 'application/targets/empty_owned_target')!;
  assert.deepEqual(row, { namespace: 'application/targets/empty_owned_target', disposition: 'empty', entries: 0, bytes: 0, requirement: '' });
  assert.ok(archive.pin.artifacts.some(item => item.id === reserved.ref.id && item.valueDigest === reserved.ref.valueDigest));
  assert.deepEqual(workspaceBackupV2Bytes(archive, budgets).artifacts, source.artifacts);
  assert.deepEqual(await readdir(reserved.target), []);
  assert.deepEqual((await f.vault.readArtifact(reserved.ref)).value, reserved.reservation);
});

test('foreign, malformed and artifact-mismatched interchange reservations refuse before an unbound target is read', async t => {
  const f = await fixture(t), reserved = await f.reserve(); let ref = reserved.ref;
  const malformed = [
    { ...reserved.reservation, sourceVaultId: f.journal.vaultId },
    { ...reserved.reservation, sourceWorkspaceId: 'foreign_workspace' },
    { ...reserved.reservation, physical: { ...reserved.reservation.physical, extra: 'unissued' } },
    { ...reserved.reservation, targetId: 'different_target' },
    { ...reserved.reservation, contextDigest: 'unreviewed-context' },
    { ...reserved.reservation, extra: 'unreviewed-field' },
  ];
  for (const value of malformed) {
    ref = await f.vault.writeArtifact({ id: ref.id, purpose: ref.purpose, value, expectedDigest: ref.valueDigest });
    await withoutOpening(reserved.target, () => assert.rejects(f.local().ports.withSource(context, null, async () => {}), code('BACKUP_ACTIVATION_TARGET_UNBOUND')));
  }
  assert.deepEqual(await readdir(reserved.target), []);
});

test('replaced or populated interchange targets require their issued physical generation and committed encrypted manifest', async t => {
  const f = await fixture(t), reserved = await f.reserve();
  await writeFile(join(reserved.target, 'operator-token.txt'), 'Synthetic unissued operator token');
  await withoutOpening(reserved.target, () => assert.rejects(f.local().ports.withSource(context, null, async () => {}), code('BACKUP_ACTIVATION_TARGET_UNBOUND')));
  const retired = join(f.vault.directory, 'reports', 'retired_target'); await mkdir(dirname(retired), { recursive: true });
  await rename(reserved.target, retired); await mkdir(reserved.target);
  assert.notDeepEqual(physical(await lstat(reserved.target, { bigint: true })), reserved.reservation.physical);
  await assert.rejects(f.local().ports.withSource(context, null, async () => {}), code('BACKUP_TARGET_CHANGED'));
  assert.equal(await readFile(join(retired, 'operator-token.txt'), 'utf8'), 'Synthetic unissued operator token');
  assert.deepEqual(await readdir(reserved.target), []);
});

test('journal private and authority tampering, unknown private namespaces and unclassified journal siblings fail authenticated custody', async t => {
  const f = await fixture(t), privateFile = artifactPath(f.journal, f.journalRef), original = await readFile(privateFile);
  const corrupt = JSON.parse(original.toString('utf8')); corrupt.ciphertext.tag = Buffer.alloc(16, 5).toString('base64');
  await writeFile(privateFile, JSON.stringify(corrupt));
  await assert.rejects(f.local().ports.withSource(context, null, async () => {}), code('ARTIFACT_AUTHENTICATION_FAILED'));
  await writeFile(privateFile, original);
  const unknown = join(f.journal.directory, 'private-artifacts', 'unknown-purpose'); await mkdir(unknown);
  await writeFile(join(unknown, 'operator-token.encrypted.json'), 'Synthetic unread operator token');
  await withoutOpening(unknown, () => assert.rejects(f.local().ports.withSource(context, null, async () => {}), code('ARTIFACT_INVENTORY_INCOMPLETE')));
  await rm(unknown, { recursive: true });
  const authorityFile = join(f.journal.directory, 'authority.encrypted.json'), authority = await readFile(authorityFile);
  const invalid = JSON.parse(authority.toString('utf8')); invalid.snapshot.tag = Buffer.alloc(16, 4).toString('base64');
  await writeFile(authorityFile, JSON.stringify(invalid));
  await assert.rejects(f.local().ports.withSource(context, null, async () => {}), code('REVISION_CONFLICT'));
  await writeFile(authorityFile, authority);
  const token = join(f.journal.directory, 'unissued-token.txt'); await writeFile(token, 'Synthetic unissued sibling token');
  await withoutOpening(token, () => assert.rejects(f.local().ports.withSource(context, null, async () => {}), code('BACKUP_INVENTORY_INCOMPLETE')));
});

test('journal ciphertext and physical enumeration share explicit file, total-byte and depth budgets', async t => {
  const f = await fixture(t), custody = f.local();
  await custody.ports.withSource(context, null, async () => {});
  const sourceBytes = custody.diagnostics()!.physicalFiles.filter(item => !item.path.startsWith('application/journal/'))
    .reduce((sum, item) => sum + item.bytes, 0), before = await image(f.journal.directory);
  for (const [limit, expected] of [[{ ...filesystemBudgets, maxFiles: 6 }, 'BACKUP_LIMIT'],
    [{ ...filesystemBudgets, maxBytes: sourceBytes }, 'ARTIFACT_LIMIT'], [{ ...filesystemBudgets, maxDepth: 1 }, 'BACKUP_LIMIT']] as const) {
    await assert.rejects(f.local({ filesystemBudgets: limit }).ports.withSource(context, null, async () => {}), code(expected));
  }
  assert.deepEqual(await image(f.journal.directory), before);
});

test('the source lease pins independently authenticated journal ciphertext and refuses an in-lease rewrite', async t => {
  const f = await fixture(t), beforeSource = await f.capture(); let called = false;
  await assert.rejects(f.local().ports.withSource(context, null, async lease => {
    called = true;
    await f.journal.writeArtifact({ id: f.journalRef.id, purpose: f.journalRef.purpose, expectedDigest: f.journalRef.valueDigest,
      value: { format: 'synthetic.journal.control.v1', status: 'committed', secret: 'Synthetic changed journal 543819' } });
    await lease.assertCurrent();
  }), code('BACKUP_SOURCE_CHANGED'));
  assert.equal(called, true); assert.deepEqual(await f.capture(), beforeSource);
});

test('unknown activation attempt staging refuses before any token or credential bytes are opened', async t => {
  const f = await fixture(t), staging = join(f.applicationDirectory, '.workspace-activation-control', 'staging', `attempt_${randomUUID()}`);
  await mkdir(staging, { recursive: true }); await writeFile(join(staging, 'operator-token.encrypted.json'), 'Synthetic unissued stage token');
  const before = await image(staging), journal = await image(f.journal.directory), source = await f.capture();
  await withoutOpening(staging, () => assert.rejects(f.local().ports.withSource(context, null, async () => {}), code('BACKUP_ACTIVATION_STAGING_UNBOUND')));
  assert.deepEqual(await image(staging), before); assert.deepEqual(await image(f.journal.directory), journal); assert.deepEqual(await f.capture(), source);
});

test('durable journal-issued prepared staging and committed target manifests measure only their exact encrypted files', async t => {
  const f = await fixture(t), reserved = await f.reserve('manifest_owned_target'), activationId = 'synthetic_activation';
  const claim = { format: 'chausar.activation-local-claim.v1', sourceVaultId: f.vault.vaultId,
    activationId, candidateId: 'synthetic_candidate', candidateCreationId: 'synthetic_candidate_creation', pinDigest: sha('Synthetic exact candidate pin') };
  const ledger = (await f.journal.listArtifacts({ purpose: 'workspace-interchange' })).find(ref => ref.id === 'wal_ledger_v1')!;
  await f.journal.writeArtifact({ id: ledger.id, purpose: ledger.purpose, expectedDigest: ledger.valueDigest,
    value: { format: 'chausar.activation-local-ledger.v1', claims: [claim] } });
  await f.journal.writeArtifact({ id: `wal_${sha(`${f.vault.vaultId}:${claim.candidateCreationId}`)}_candidate`, purpose: 'workspace-interchange',
    expectedDigest: null, value: claim });
  const bootstrap = await f.journal.writeArtifact({ id: `wal_${sha(activationId)}_bootstrap`, purpose: 'workspace-interchange',
    expectedDigest: null, value: { format: 'synthetic.initialization.candidate.v1', freshWorkspaceId: reserved.reservation.workspaceId } });
  const evidence = await f.journal.writeArtifact({ id: `wal_${sha(activationId)}_evidence`, purpose: 'workspace-interchange',
    expectedDigest: null, value: { format: 'synthetic.initialization.evidence.v1', pinDigest: claim.pinDigest } });
  const name = `attempt_${randomUUID()}`, staging = join(f.applicationDirectory, '.workspace-activation-control', 'staging', name);
  await mkdir(join(staging, 'live'), { recursive: true });
  const encrypted = [
    ['activation-bootstrap.encrypted.json', await readFile(artifactPath(f.journal, bootstrap))],
    ['activation-evidence.encrypted.json', await readFile(artifactPath(f.journal, evidence))],
    ['live/authority.encrypted.json', await readFile(join(f.journal.directory, 'authority.encrypted.json'))],
  ] as const;
  const files = [];
  for (const [path, bytes] of encrypted) {
    const actual = join(staging, path); await writeFile(actual, bytes);
    files.push({ path, witness: { ...physical(await lstat(actual, { bigint: true })), bytes: bytes.length, sha256: sha(bytes) } });
  }
  const journal = { format: 'chausar.activation-local-journal.v1', phase: 'prepared', sourceVaultId: f.vault.vaultId,
    sourceWorkspaceId: f.vault.read().workspace.id, journalVaultId: f.journal.vaultId,
    reservation: reserved.reservation, reservationRef: reserved.ref, claim,
    record: { format: 'chausar.workspace-activation.v1', status: 'committed', activationId,
      candidateId: claim.candidateId, candidateCreationId: claim.candidateCreationId,
      pinDigest: claim.pinDigest, targetId: reserved.reservation.targetId, workspaceId: reserved.reservation.workspaceId },
    staging: { name, physical: physical(await lstat(staging, { bigint: true })) }, bootstrap, evidence, files, directories: ['live'] };
  const attempt = await f.journal.writeArtifact({ id: `wal_${sha(activationId)}_attempt`, purpose: 'workspace-interchange', expectedDigest: null, value: journal });
  const custody = f.local(), prepared = await custody.ports.withSource(context, null, async lease => captureWorkspaceBackupV2(lease.capture, budgets));
  const row = prepared.pin.namespaces.find(item => item.namespace === 'application/workspace-activation-control/staging')!;
  assert.equal(row.disposition, 'outside-archive'); assert.equal(row.entries, 5);
  assert.equal(row.bytes, encrypted.reduce((sum, [, bytes]) => sum + bytes.length, 0));
  assert.ok(!prepared.pin.artifacts.some(item => item.id === attempt.id));
  await mkdir(join(reserved.target, 'live'));
  for (const [path] of encrypted) await rename(join(staging, path), join(reserved.target, path));
  await f.journal.writeArtifact({ id: attempt.id, purpose: attempt.purpose, expectedDigest: attempt.valueDigest, value: { ...journal, phase: 'committed' } });
  const committed = await custody.ports.withSource(context, null, async lease => captureWorkspaceBackupV2(lease.capture, budgets));
  const targetRow = committed.pin.namespaces.find(item => item.namespace === 'application/targets/manifest_owned_target')!;
  assert.equal(targetRow.disposition, 'outside-archive'); assert.equal(targetRow.entries, 4); assert.equal(targetRow.bytes, row.bytes);
  const retainedStage = committed.pin.namespaces.find(item => item.namespace === 'application/workspace-activation-control/staging')!;
  assert.equal(retainedStage.disposition, 'outside-archive'); assert.equal(retainedStage.entries, 2); assert.equal(retainedStage.bytes, 0);
  for (const issued of files) {
    const measured = custody.diagnostics()!.physicalFiles.find(item => item.path === `application/targets/manifest_owned_target/${issued.path}`)!;
    assert.deepEqual({ dev: measured.dev, ino: measured.ino, birthtimeNs: measured.birthtimeNs, bytes: measured.bytes, sha256: measured.sha256 }, issued.witness);
  }
  const token = join(reserved.target, 'operator-token.txt'); await writeFile(token, 'Synthetic unissued credential');
  await withoutOpening(token, () => assert.rejects(custody.ports.withSource(context, null, async () => {}), code('BACKUP_ACTIVATION_STAGING_UNBOUND')));
});

async function issueFreshPublication(f: Awaited<ReturnType<typeof fixture>>, reserved: Awaited<ReturnType<typeof f.reserve>>) {
  const business = deterministicShopState();
  await f.vault.update(state => {
    state.ontology = structuredClone(business.ontology); state.facts = structuredClone(business.facts);
    state.imports = structuredClone(business.imports);
  });
  const source = f.vault.read(), target = { ...emptyTarget(), targetId: reserved.reservation.targetId,
    workspaceId: reserved.reservation.workspaceId, generation: reserved.reservation.generation,
    accessDigest: reserved.reservation.contextDigest }, artifacts = artifactsFor(source);
  const capture = captureWorkspaceInterchange(source, artifacts);
  const candidate = new WorkspaceImportCandidateService({ source: () => ({ ready: true, inventory: capture.inventory }),
    target: () => target, assertCompleteRead: () => {} }).prepare(context,
    { text: canonicalInterchangeJson(capture.package), targetId: target.targetId });
  const retained: AuthenticatedActivationCandidate = { content: canonicalInterchangeJson(candidate),
    pin: { format: 'chausar.interchange-custody-pin.v1', kind: 'candidate', recordId: 'fresh_live_candidate',
      creationId: 'fresh_live_candidate_creation', contextDigest: interchangeDigest(context), inventory: capture.inventory,
      packageDigest: candidate.packageDigest, candidateDigest: interchangeDigest(candidate), target },
    measurement: { encrypted: true, archiveCiphertextBytes: 1, inventoryPinCiphertextBytes: 1, qualification: 'test-fixture' } };
  const authority: WorkspaceActivationAuthority = { workspaceId: target.workspaceId,
    owner: { id: 'fresh_live_owner', name: 'Synthetic independent fresh live owner', role: 'owner', active: true, epoch: 7, branches: ['*'] },
    context: { memberId: 'fresh_live_owner', role: 'owner', epoch: 7, channel: 'desktop' },
    sessionAuthorityId: 'fresh_live_session_authority', createdAt: fixedTime };
  let publication: WorkspaceActivationCommit | undefined;
  const readback = (): WorkspaceActivationReadback => {
    assert.ok(publication); return { status: 'committed', encrypted: true, ciphertextBytes: 1,
      qualification: 'test-fixture', ...structuredClone(publication) };
  };
  // The isolated host issues the validated projection. Encryption and revision
  // changes below use actual independent Vaults and actual journal artifacts.
  const ports: WorkspaceActivationPorts = {
    custody: { async read(_context, id) { assert.equal(id, retained.pin.recordId); return structuredClone(retained); } },
    async withTransaction(_context, input, work) {
      assert.equal(input.targetId, target.targetId);
      return work({ source: { ready: true, state: structuredClone(source), artifacts,
        async assertCompleteOwner(current, historical) { assert.equal(current.memberId, 'owner'); assert.equal(historical.workspace.id, source.workspace.id); },
        async assertCurrent() {} }, target: structuredClone(target), async readCandidate() { return structuredClone(retained); },
      async assertCurrent() {}, async allocateAuthority() { return structuredClone(authority); },
      async commit(value) { publication = structuredClone(value); }, async readback() { return readback(); } });
    }, async readback() { return readback(); },
  };
  const host = new WorkspaceActivationHost(ports, { approvedSyntheticWorkspaceIds: [source.workspace.id], allowedSyntheticSourceIds: ['demo-export'],
    budgets: { maxCandidateBytes: 8_000_000, maxArtifactBytes: 1_000_000, maxArtifacts: 64, maxFacts: 1000, maxRecords: 10_000 }, retentionDays: 90 });
  const request = { candidateId: retained.pin.recordId, reviewedDigest: interchangeDigest(candidate) }, review = await host.review(context, request);
  await host.activate(context, { ...request, projectionDigest: review.projectionDigest, activationId: 'fresh_live_activation', confirmed: true });
  assert.ok(publication); assert.equal(hash(publication.state), publication.record.stateDigest); return publication;
}

test('actual fresh Vault revisions require narrow current-live authentication while immutable evidence and unknown tokens remain unissued', async t => {
  const f = await fixture(t), reserved = await f.reserve('fresh_live_target'), publication = await issueFreshPublication(f, reserved);
  const record = publication.record, claim = { format: 'chausar.activation-local-claim.v1', sourceVaultId: f.vault.vaultId,
    activationId: record.activationId, candidateId: record.candidateId, candidateCreationId: record.candidateCreationId, pinDigest: record.pinDigest };
  const ledger = (await f.journal.listArtifacts({ purpose: 'workspace-interchange' })).find(ref => ref.id === 'wal_ledger_v1')!;
  await f.journal.writeArtifact({ id: ledger.id, purpose: ledger.purpose, expectedDigest: ledger.valueDigest,
    value: { format: 'chausar.activation-local-ledger.v1', claims: [claim] } });
  await f.journal.writeArtifact({ id: `wal_${sha(`${f.vault.vaultId}:${claim.candidateCreationId}`)}_candidate`,
    purpose: 'workspace-interchange', expectedDigest: null, value: claim });
  const bootstrap = await f.journal.writeArtifact({ id: `wal_${sha(record.activationId)}_bootstrap`, purpose: 'workspace-interchange',
    expectedDigest: null, value: { record, state: publication.state, authority: publication.authority } });
  const evidence = await f.journal.writeArtifact({ id: `wal_${sha(record.activationId)}_evidence`, purpose: 'workspace-interchange',
    expectedDigest: null, value: publication.evidence });
  const name = `attempt_${randomUUID()}`, staging = join(f.applicationDirectory, '.workspace-activation-control', 'staging', name);
  await mkdir(join(staging, 'live', 'main'), { recursive: true });
  const live = join(reserved.target, 'live'), main = join(live, 'main'), freshPassphrase = 'Synthetic fresh live independent root credential';
  await mkdir(live);
  const fresh = await Vault.createBootstrap({ directory: main, storage: 'experimental-file', passphrase: freshPassphrase,
    state: publication.state, expectedStateDigest: record.stateDigest, expectedWorkspaceId: record.workspaceId,
    expectedOwnerId: publication.authority.owner.id,
    budgets: { maxStateBytes: 1_000_000, maxJsonDepth: 32, maxJsonNodes: 20_000, maxRecords: 1000 } });
  t.after(() => fresh.vault.close());
  const freshVaultId = fresh.vault.vaultId; assert.notEqual(freshVaultId, f.vault.vaultId); assert.notEqual(freshVaultId, f.journal.vaultId);
  assert.equal(fresh.vault.read().revision, 0); assert.deepEqual(fresh.vault.read().members, [publication.authority.owner]);
  await fresh.vault.close();
  assert.deepEqual(await readdir(main), ['authority.encrypted.json']);
  const bootstrapFile = join(reserved.target, 'activation-bootstrap.encrypted.json'), evidenceFile = join(reserved.target, 'activation-evidence.encrypted.json');
  await writeFile(bootstrapFile, await readFile(artifactPath(f.journal, bootstrap)));
  await writeFile(evidenceFile, await readFile(artifactPath(f.journal, evidence)));
  const authorityFile = join(main, 'authority.encrypted.json'), initialAuthority = await readFile(authorityFile);
  const sourceEnvelope = JSON.parse(await readFile(join(f.vault.directory, 'authority.encrypted.json'), 'utf8'));
  const freshEnvelope = JSON.parse(initialAuthority.toString('utf8'));
  assert.notEqual(freshEnvelope.passphrase.salt, sourceEnvelope.passphrase.salt);
  assert.notEqual(freshEnvelope.recovery.salt, sourceEnvelope.recovery.salt);
  const files = [];
  for (const path of ['activation-bootstrap.encrypted.json', 'activation-evidence.encrypted.json', 'live/main/authority.encrypted.json']) {
    const actual = join(reserved.target, path), bytes = await readFile(actual);
    files.push({ path, witness: { ...physical(await lstat(actual, { bigint: true })), bytes: bytes.length, sha256: sha(bytes) } });
  }
  const journal = { format: 'chausar.activation-local-journal.v1', phase: 'committed', sourceVaultId: f.vault.vaultId,
    sourceWorkspaceId: f.vault.read().workspace.id, journalVaultId: f.journal.vaultId, reservation: reserved.reservation,
    reservationRef: reserved.ref, record, claim, bootstrap, evidence, files, directories: ['live', 'live/main'],
    staging: { name, physical: physical(await lstat(staging, { bigint: true })) },
    liveDirectory: physical(await lstat(live, { bigint: true })), qualification: 'encrypted-local-host' };
  const attempt = await f.journal.writeArtifact({ id: `wal_${sha(record.activationId)}_attempt`, purpose: 'workspace-interchange', expectedDigest: null, value: journal });
  const freshReceipt = { id: 'fresh_revision_receipt', at: fixedTime, status: 'accepted',
    memberId: publication.authority.owner.id, epoch: publication.authority.owner.epoch };
  let inspections = 0; const inspectedRevisions: number[] = [];
  const inspectCurrentLive = async (input: { context: Context; targetId: string; publication: WorkspaceActivationCommit }) => {
    inspections++; assert.deepEqual(input.context, context); assert.equal(input.targetId, reserved.reservation.targetId);
    assert.deepEqual(input.publication, publication);
    assert.equal(JSON.stringify(input.publication.state), JSON.stringify(publication.state));
    const opened = await Vault.open({ directory: main, storage: 'experimental-file', passphrase: freshPassphrase });
    try {
      const state = opened.read(); assert.equal(opened.vaultId, freshVaultId); assert.equal(state.schemaVersion, 1);
      assert.equal(state.workspace.demo, true); assert.deepEqual(state.workspace, publication.state.workspace);
      assert.deepEqual(state.members, [publication.authority.owner]); assert.deepEqual(state.policy, publication.state.policy);
      assert.equal(authorize(opened, publication.authority.context, 'admin').epoch, 7);
      assert.ok(Number.isSafeInteger(state.revision) && state.revision >= 0 && state.revision <= 1);
      inspectedRevisions.push(state.revision);
      if (state.revision === 0) assert.equal(hash(state), record.stateDigest);
      assert.deepEqual(state.receipts, state.revision === 0 ? [] : [freshReceipt]);
      if (state.revision === 1) {
        assert.equal(state.receipts[0].memberId, publication.authority.owner.id);
        assert.equal(state.receipts[0].epoch, publication.authority.owner.epoch);
      }
      for (const field of ['answers', 'decisions', 'actions', 'jobs', 'learning', 'plugins', 'modelReceipts',
        'activity', 'conversations', 'routes', 'sessions', 'unsupported', 'schedules'] as const)
        assert.deepEqual(state[field], [], field);
      for (const field of ['ontology', 'facts', 'imports', 'conflicts', 'merges', 'tombstones', 'sourceRules'] as const)
        assert.equal(JSON.stringify(state[field]), JSON.stringify(publication.state[field]), field);
    } finally { await opened.close(); }
  };
  const custody = f.local({ workspaceActivation: { journalVault: f.journal, inspectCurrentLive } });
  const source = await f.capture(), journalBefore = await image(f.journal.directory);
  const first = await custody.ports.withSource(context, null, async lease => captureWorkspaceBackupV2(lease.capture, budgets));
  assert.equal(first.pin.fullWorkspacePortable, false);
  const firstMeasured = custody.diagnostics()!.physicalFiles.find(item => item.path === 'application/targets/fresh_live_target/live/main/authority.encrypted.json')!;
  assert.equal(firstMeasured.bytes, initialAuthority.length); assert.equal(firstMeasured.sha256, sha(initialAuthority));
  const update = await Vault.open({ directory: main, storage: 'experimental-file', passphrase: freshPassphrase });
  try {
    await update.update(state => { state.receipts.push(structuredClone(freshReceipt)); });
    assert.equal(update.read().revision, 1); assert.equal(update.read().receipts.length, 1);
  } finally { await update.close(); }
  const currentAuthority = await readFile(authorityFile); assert.notEqual(sha(currentAuthority), sha(initialAuthority));
  await withoutOpening(authorityFile, () => assert.rejects(f.local().ports.withSource(context, null, async () => {}), code('BACKUP_ACTIVATION_CUSTODY_CHANGED')));
  const second = await custody.ports.withSource(context, null, async lease => captureWorkspaceBackupV2(lease.capture, budgets));
  const secondMeasured = custody.diagnostics()!.physicalFiles.find(item => item.path === firstMeasured.path)!;
  assert.equal(secondMeasured.bytes, currentAuthority.length); assert.equal(secondMeasured.sha256, sha(currentAuthority));
  assert.notEqual(secondMeasured.sha256, firstMeasured.sha256); assert.notEqual(second.pin.source.enumerationId, first.pin.source.enumerationId);
  assert.ok(inspections >= 4); assert.ok(inspectedRevisions.includes(0)); assert.ok(inspectedRevisions.includes(1));
  assert.deepEqual(workspaceBackupV2Bytes(second, budgets).artifacts, source.artifacts);
  assert.deepEqual(await image(f.journal.directory), journalBefore); assert.deepEqual(await f.capture(), source);
  assert.deepEqual((await f.journal.readArtifact(attempt)).value, journal);
  const invalidGuard = async (input: Parameters<typeof inspectCurrentLive>[0]) => { await inspectCurrentLive(input); return 'deferred-admission'; };
  await assert.rejects(f.local({ workspaceActivation: { journalVault: f.journal, inspectCurrentLive: invalidGuard as never } })
    .ports.withSource(context, null, async () => {}), code('BACKUP_ACTIVATION_LIVE_GUARD'));
  const immutable = await readFile(evidenceFile); await writeFile(evidenceFile, Buffer.concat([immutable, Buffer.from('\n')]));
  await withoutOpening(evidenceFile, () => assert.rejects(custody.ports.withSource(context, null, async () => {}), code('BACKUP_ACTIVATION_CUSTODY_CHANGED')));
  await writeFile(evidenceFile, immutable);
  const token = join(main, 'operator-token.encrypted.json'); await writeFile(token, 'Synthetic unissued fresh target token');
  await withoutOpening(token, () => assert.rejects(custody.ports.withSource(context, null, async () => {}), code('BACKUP_ACTIVATION_STAGING_UNBOUND')));
  assert.deepEqual(await image(f.journal.directory), journalBefore); assert.deepEqual(await f.capture(), source);
});
