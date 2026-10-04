import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, mkdtemp, readFile, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative } from 'node:path';
import test, { type TestContext } from 'node:test';
import type { CalculationReceipt, CalculationRequest } from '../runtime/calculator.ts';
import { Engine, type EngineOptions } from '../runtime/engine.ts';
import { demoCsv, demoRecipe } from '../runtime/ingest.ts';
import { starterPacks, type Dictionary, type OntologySnapshot } from '../runtime/ontology.ts';
import { createLocalServer } from '../runtime/server.ts';
import { Vault } from '../runtime/vault.ts';
import type { WorkspaceActivationPolicy, WorkspaceActivationSummary } from '../runtime/workspace-activation.ts';
import { validateWorkspaceBackupV2Capture, type WorkspaceBackupV2Budgets } from '../runtime/workspace-backup-v2.ts';
import { readHistoricalWorkspaceState, retainedArtifactBytes, validateWorkspaceInterchange } from '../runtime/workspace-interchange.ts';
import { RETAINED_INTERCHANGE_FORMAT, RETAINED_STATE_PROFILE, type WorkspaceImportCandidate } from '../runtime/workspace-interchange-contracts.ts';

// Actual loopback HTTP, Engine, encrypted file source/journal/target Vaults and
// create-only local activation. Every business input and credential is synthetic.
// This is source integration evidence; it qualifies no native SQL, GUI, provider,
// real workspace, inferred Today policy or complete workspace portability.
const SOURCE_PASSWORD = 'Synthetic first-run journey source credential';
const RECOVERED_PASSWORD = 'Synthetic first-run journey recovered credential';
const TARGET_PASSWORD = 'Synthetic first-run journey fresh target credential';
const JOURNAL_PASSWORD = 'Synthetic first-run journey separate journal credential';
const SOURCE = 'demo-export';
const ATTEMPT = 'synthetic_reviewed_first_submission';
const LATER_ATTEMPT = 'synthetic_later_source_submission';
const IDS = { material: 'journey_material', backup: 'journey_backup', inert: 'journey_inert',
  candidate: 'journey_candidate', target: 'journey_target', activation: 'journey_activation' };
const budgets: WorkspaceBackupV2Budgets = { maxArchiveUtf8Bytes: 8_000_000, maxEntryBytes: 4_000_000,
  maxTotalEntryBytes: 6_000_000, maxEntries: 100, maxJsonDepth: 128, maxJsonNodes: 100_000 };
const captureBudgets = { maxArtifacts: 99, maxEntryBytes: budgets.maxEntryBytes, maxTotalEntryBytes: budgets.maxTotalEntryBytes };
const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const artifactId = (prefix: string, id: string, part: string) => `${prefix}_${sha(id)}_${part}`;
const draft = () => structuredClone(starterPacks.find(pack => pack.pack === 'retail')!);
type Http = { app: ReturnType<typeof createLocalServer>; engine: Engine; token: string;
  rpc<T = any>(method: string, payload?: unknown): Promise<T>;
  raw(method: string, payload?: unknown, bearer?: string): Promise<{ status: number; body: any }>;
  refuse(method: string, payload: unknown, codes: string[], bearer?: string): Promise<void> };

async function fixture(t: TestContext) {
  const base = await realpath(tmpdir());
  if (process.platform === 'win32') assert.match(base, /^C:\\/i);
  const prefix = 'chausar-first-run-transfer-', directory = await realpath(await mkdtemp(join(base, prefix)));
  const apps = new Set<Http>();
  const servers = new Set<ReturnType<typeof createLocalServer>>();
  let journal: Vault | undefined, providerCalls = 0, sourcePassword = SOURCE_PASSWORD;
  const timings: { method: string; elapsedMs: number; status: number; code?: string }[] = [];
  const options: EngineOptions = { directory, demo: true, storage: 'experimental-file',
    backupCustody: { budgets, filesystemBudgets: { maxFiles: 100, maxBytes: 12_000_000, maxDepth: 16 } },
    gateway: { http: async () => { providerCalls++; throw Error('This synthetic source fixture forbids provider transport.'); } } };
  async function http(engine: Engine): Promise<Http> {
    const app = createLocalServer(engine); servers.add(app);
    const { origin, token } = await app.listen();
    assert.equal(new URL(origin).hostname, '127.0.0.1');
    const raw = async (method: string, payload: unknown = {}, bearer = token) => {
      const started = Date.now();
      const response = await fetch(`${origin}/api/rpc`, { method: 'POST', signal: AbortSignal.timeout(30_000),
        headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` }, body: JSON.stringify({ method, payload }) });
      const body = await response.json() as any, elapsedMs = Date.now() - started;
      timings.push({ method, elapsedMs, status: response.status, ...(body.error ? { code: body.error.code } : {}) });
      assert.ok(elapsedMs < 30_000, `${method} exceeded the unchanged HTTP deadline.`);
      return { status: response.status, body };
    };
    const rpc = async <T = any>(method: string, payload: unknown = {}): Promise<T> => {
      const response = await raw(method, payload);
      assert.equal(response.status, 200, `${method}: ${response.body.error?.code ?? 'RPC failed'}`);
      assert.equal(response.body.error, undefined); return response.body.result as T;
    };
    const refuse = async (method: string, payload: unknown, codes: string[], bearer = token) => {
      const response = await raw(method, payload, bearer);
      assert.notEqual(response.status, 200); assert.equal(response.body.result, undefined);
      assert.ok(codes.includes(response.body.error?.code), `${method}: ${response.body.error?.code}`);
      for (const secret of [SOURCE_PASSWORD, RECOVERED_PASSWORD, TARGET_PASSWORD, JOURNAL_PASSWORD, bearer])
        assert.equal(JSON.stringify(response.body).includes(secret), false);
    };
    const result = { app, engine, token, rpc, raw, refuse }; apps.add(result); return result;
  }
  t.after(async () => {
    const drains = await Promise.allSettled([...servers].map(app => app.close(5000)));
    // An unfinished activation can still own journal work. Preserve it immediately
    // after any server drain rejection; only drained servers permit journal close.
    const serversDrained = drains.every(value => value.status === 'fulfilled');
    const journalDrains = await Promise.allSettled(serversDrained && journal ? [journal.close()] : []);
    const failures = [...drains, ...journalDrains].filter((value): value is PromiseRejectedResult => value.status === 'rejected');
    t.diagnostic(JSON.stringify({ qualification: 'synthetic-http-encrypted-local-host-source-only', requests: timings,
      nativeExecution: false, providerCalls, serversClosed: drains.filter(value => value.status === 'fulfilled').length,
      cleanupDrained: failures.length === 0, ...(failures.length ? { retainedOwnedDirectory: directory } : {}) }));
    // A client abort does not cancel server-side work. Never remove its custody
    // while an owned server/Engine or the journal failed to drain completely.
    if (failures.length) throw new AggregateError(failures.map(value => value.reason), 'Owned synthetic fixture did not drain; its directory is preserved.');
    const actual = await realpath(directory), child = relative(base, actual), stat = await lstat(actual);
    assert.equal(actual, directory); assert.equal(dirname(actual), base);
    assert.ok(child && !isAbsolute(child) && !child.startsWith('..') && child.startsWith(prefix));
    assert.equal(stat.isDirectory(), true); assert.equal(stat.isSymbolicLink(), false);
    await rm(actual, { recursive: true, force: true });
    assert.equal(providerCalls, 0);
  });
  let source = await http(new Engine(options));
  const created = await source.rpc('workspace.create', { name: 'Synthetic first-run transfer business',
    passphrase: sourcePassword, demo: false, dictionaryMode: 'deferred' });
  assert.equal(typeof created.recoveryCode, 'string'); assert.equal(created.recoveryKit, created.recoveryCode);
  const ciphertext = () => readFile(join(directory, 'main', 'authority.encrypted.json'));
  const restart = async (recover = false) => {
    const previous = source, oldToken = source.token;
    await previous.app.close(5000); apps.delete(previous); servers.delete(previous.app);
    source = await http(new Engine(options));
    await source.refuse('workspace.status', {}, ['UNAUTHENTICATED'], oldToken);
    if (recover) {
      sourcePassword = RECOVERED_PASSWORD;
      await source.rpc('workspace.recover', { recoveryCode: created.recoveryCode, passphrase: sourcePassword });
    } else await source.rpc('workspace.open', { passphrase: sourcePassword });
    assert.notEqual(source.engine, previous.engine);
  };
  return { directory, get source() { return source; }, ciphertext, restart,
    async enableActivation() {
      journal = (await Vault.create({ directory: join(directory, 'journal'), storage: 'experimental-file',
        name: 'Synthetic separate first-run transfer journal', demo: true, passphrase: JOURNAL_PASSWORD })).vault;
      const policy: WorkspaceActivationPolicy = { approvedSyntheticWorkspaceIds: [source.engine.vault!.read().workspace.id],
        allowedSyntheticSourceIds: [SOURCE], retentionDays: 90,
        budgets: { maxCandidateBytes: 16_000_000, maxArtifactBytes: 12_000_000, maxArtifacts: 100, maxFacts: 100, maxRecords: 1000 } };
      options.workspaceActivation = { journalVault: journal, policy, targetPassphrase: async authority => {
        assert.notEqual(authority.workspaceId, source.engine.vault!.read().workspace.id);
        assert.notEqual(authority.owner.id, 'owner'); return TARGET_PASSWORD;
      } };
      source.engine.options.workspaceActivation = options.workspaceActivation;
      await source.rpc('workspace.lock'); await source.rpc('workspace.open', { passphrase: sourcePassword });
    },
    async target() {
      const engine = await source.engine.activatedWorkspaceEngine(source.engine.bootstrapContext(), IDS.activation);
      for (const option of ['gateway', 'sync', 'durableJobs', 'connectorCredentials', 'connectorRuntime', 'workspaceActivation'] as const)
        assert.equal(engine.options[option], undefined);
      return http(engine);
    },
    async close(value: Http) { await value.app.close(5000); apps.delete(value); servers.delete(value.app); },
    get journal() { assert.ok(journal); return journal; },
  };
}

async function journey(t: TestContext, olderCut: boolean) {
  const f = await fixture(t), deferred = f.source.engine.vault!.read(), initialBytes = await f.ciphertext();
  assert.equal(deferred.revision, 0); assert.equal(deferred.workspace.demo, false);
  assert.deepEqual(deferred.ontology, { current: null, history: [], firstRunReviewRequired: true });
  assert.deepEqual(deferred.activity, []); assert.deepEqual(deferred.learning, []);
  await f.restart(); assert.deepEqual(f.source.engine.vault!.read(), deferred); assert.deepEqual(await f.ciphertext(), initialBytes);
  await f.source.refuse('ontology.publish', { draft: draft(), expectedCurrentHash: null }, ['DICTIONARY_REVIEW_REQUIRED']);
  assert.deepEqual(await f.ciphertext(), initialBytes);
  const first: Dictionary = await f.source.rpc('ontology.publish', { draft: draft(), expectedCurrentHash: null, attemptId: ATTEMPT });
  const receipt: OntologySnapshot = await f.source.rpc('ontology.get', { attemptId: ATTEMPT });
  assert.equal(first.version, 1); assert.deepEqual(receipt.current, first); assert.deepEqual(receipt.history, [first]);
  assert.equal(receipt.attempt?.dictionaryHash, first.hash); assert.equal(receipt.attempt?.expectedCurrentHash, null);
  assert.equal(receipt.attempt?.workspaceId, deferred.workspace.id); assert.equal(f.source.engine.vault!.read().revision, 1);
  const publishedState = f.source.engine.vault!.read(), publishedBytes = await f.ciphertext();
  await f.restart(); assert.deepEqual(await f.source.rpc('ontology.get', { attemptId: ATTEMPT }), receipt);
  assert.deepEqual(await f.source.rpc('ontology.publish', { draft: draft(), expectedCurrentHash: null, attemptId: ATTEMPT }), first);
  assert.deepEqual(f.source.engine.vault!.read(), publishedState); assert.deepEqual(await f.ciphertext(), publishedBytes);
  await f.source.refuse('ontology.publish', { draft: draft(), expectedCurrentHash: null, attemptId: 'synthetic_stale_first_CAS' }, ['DICTIONARY_CONFLICT']);
  assert.equal((await f.source.rpc('ontology.get', { attemptId: 'synthetic_stale_first_CAS' })).attempt, null);
  await f.source.rpc('sources.import', { sourceId: SOURCE, format: 'csv', content: demoCsv, recipe: demoRecipe,
    expectedTotals: { rowCount: 10, amountMinor: '1230000' } });
  const asOf = new Date(Math.max(...f.source.engine.vault!.read().facts.map(fact => Date.parse(fact.learnedAt))) + 1).toISOString();
  const requests: CalculationRequest[] = ['billed', 'received', 'earned'].map(operation => ({ operation,
    sourceIds: [SOURCE], period: { from: '2026-09-01', to: '2026-09-30' }, asOf }));
  const originals: CalculationReceipt[] = [];
  for (const request of requests) originals.push(await f.source.rpc('calculation.run', request));
  assert.deepEqual(originals.map(value => value.totalMinor), ['300000', '260000', '250000']);
  for (const original of originals) assert.deepEqual(await f.source.rpc('receipts.get', { id: original.id }), original);
  const historical = f.source.engine.vault!.read();
  // The independent semantic issuance is inside the complete encrypted cut.
  const material = await f.source.rpc('workspace.interchange.export', { destinationId: IDS.material, confirmed: true });
  const semantic = await f.source.engine.services.interchangeLocal.ports.custody.read(f.source.engine.bootstrapContext(), IDS.material);
  const archive = validateWorkspaceInterchange(semantic.content, semantic.pin.inventory);
  assert.equal(archive.format, RETAINED_INTERCHANGE_FORMAT); assert.equal(archive.inventory.profile.id, RETAINED_STATE_PROFILE);
  assert.deepEqual(archive.inventory.profile.ontologyNamespaces, ['publicationAttempts']);
  assert.deepEqual(readHistoricalWorkspaceState(archive), historical);
  const original = await f.source.engine.vault!.snapshot(() => f.source.engine.vault!.captureEncryptedCustody(captureBudgets));
  const backup = await f.source.rpc('workspace.backup.v2.create', { destinationId: IDS.backup, confirmed: true });
  assert.equal(backup.fullWorkspacePortable, false);
  const backupRead = await f.source.rpc('workspace.backup.v2.read', { backupId: IDS.backup });
  const saved = (await f.source.engine.vault!.readArtifact({ id: artifactId('wb2', IDS.backup, 'archive'), purpose: 'workspace-interchange' })).value as { content: string };
  const decoded = validateWorkspaceBackupV2Capture(saved.content, backupRead.sourcePin, budgets);
  assert.deepEqual(Buffer.from(decoded.capture.authority), Buffer.from(original.authority));
  assert.deepEqual(decoded.capture.artifacts, original.artifacts);
  assert.deepEqual(await f.source.engine.vault!.snapshot(() => f.source.engine.vault!.authenticateEncryptedCustody(decoded.capture, captureBudgets)), historical);
  for (const secret of [SOURCE_PASSWORD, ATTEMPT, demoCsv]) assert.equal(saved.content.includes(secret), false);
  const repeatedExport = await f.source.rpc('workspace.interchange.export', { destinationId: 'journey_after_backup_export', confirmed: true });
  assert.equal(repeatedExport.packageDigest, material.packageDigest);
  assert.equal((await f.source.rpc('workspace.interchange.diagnostics')).fullWorkspacePortabilityQualified, false);
  const restored = await f.source.rpc('workspace.backup.v2.restoreInert', { backupId: IDS.backup, targetId: IDS.inert,
    reviewedDigest: backup.archiveDigest, confirmed: true });
  assert.equal(restored.inert, true); assert.equal(restored.activation, 'root-only');
  assert.deepEqual(await readdir(join(f.directory, IDS.inert)), ['backup.inert.json']);
  const inertBytes = await readFile(join(f.directory, IDS.inert, 'backup.inert.json'));
  assert.equal(JSON.parse(inertBytes.toString('utf8')).content, saved.content);
  await assert.rejects(Vault.open({ directory: join(f.directory, IDS.inert), storage: 'experimental-file', passphrase: SOURCE_PASSWORD }), { code: 'UNLOCK_FAILED' });
  if (olderCut) {
    await f.source.rpc('ontology.publish', { draft: draft(), expectedCurrentHash: first.hash, attemptId: LATER_ATTEMPT });
    const beforeRecovery = f.source.engine.vault!.read(); await f.restart(true);
    assert.deepEqual(f.source.engine.vault!.read(), { ...beforeRecovery, revision: beforeRecovery.revision + 1 });
    assert.deepEqual(await f.source.rpc('ontology.get', { attemptId: ATTEMPT }).then((value: OntologySnapshot) => value.attempt), receipt.attempt);
    assert.equal((await f.source.rpc('ontology.get', { attemptId: LATER_ATTEMPT })).attempt.version, 2);
    const envelope = JSON.parse((await f.ciphertext()).toString('utf8')), archivedEnvelope = JSON.parse(Buffer.from(original.authority).toString('utf8'));
    assert.deepEqual(envelope.recovery, archivedEnvelope.recovery); assert.notDeepEqual(envelope.passphrase, archivedEnvelope.passphrase);
  }
  const liveSource = f.source.engine.vault!.read(), liveBytes = await f.ciphertext();
  await f.enableActivation();
  // A new local interchange service starts with no measured capture. It does
  // not promote an earlier service's transient diagnostic into current proof.
  assert.equal(await f.source.rpc('workspace.interchange.diagnostics'), null);
  const target = await f.source.rpc('workspace.activation.target.create', { targetId: IDS.target, confirmed: true });
  assert.equal(target.authorityRecords, 0); assert.deepEqual(await readdir(join(f.directory, IDS.target)), []);
  const selection = { backupId: IDS.backup, materialId: IDS.material, inertTargetId: IDS.inert,
    inertCreationId: restored.creationId, candidateId: IDS.candidate, targetId: IDS.target,
    reviewedArchiveDigest: backup.archiveDigest, confirmed: true };
  const bridge = await f.source.rpc('workspace.backup.activation.prepare', selection);
  assert.equal(bridge.fullWorkspacePortable, false); assert.equal(bridge.scope, 'authority-and-all-typed-private-artifacts');
  assert.deepEqual(bridge.namespaces, backupRead.sourcePin.namespaces);
  assert.deepEqual(bridge.externalKeyRequirements, backupRead.sourcePin.externalKeyRequirements);
  const candidateText = ((await f.journal.readArtifact({ id: artifactId('wac', IDS.candidate, 'archive'), purpose: 'workspace-interchange' })).value as { content: string }).content;
  const candidate = JSON.parse(candidateText) as WorkspaceImportCandidate;
  assert.deepEqual(readHistoricalWorkspaceState(candidate.archive), historical);
  const proof = candidate.archive.artifacts.find(value => value.manifest.id === 'backup_activation_provenance_v1'); assert.ok(proof);
  const provenance = JSON.parse(retainedArtifactBytes(proof).toString('utf8'));
  assert.equal(provenance.backup.content, saved.content); assert.equal(provenance.inert.content, saved.content);
  const reviewInput = { candidateId: IDS.candidate, reviewedDigest: bridge.reviewedDigest };
  const review = await f.source.rpc('workspace.activation.review', reviewInput);
  assert.equal(review.ontologyDisposition.publicationAttempts, 'inert-origin-evidence');
  assert.ok(review.inertStores.includes('ontology.publicationAttempts')); assert.ok(!review.liveStores.includes('ontology.publicationAttempts'));
  const execute = { ...reviewInput, projectionDigest: review.projectionDigest, activationId: IDS.activation, confirmed: true };
  await f.source.refuse('workspace.activation.execute', { ...execute, projectionDigest: '0'.repeat(64) }, ['ACTIVATION_PROJECTION_CHANGED']);
  assert.deepEqual(await readdir(join(f.directory, IDS.target)), []);
  const committed: WorkspaceActivationSummary = await f.source.rpc('workspace.activation.execute', execute);
  assert.equal(committed.status, 'committed'); assert.equal(committed.qualification, 'encrypted-local-host');
  assert.notEqual(committed.workspaceId, historical.workspace.id); assert.notEqual(committed.ownerContext.memberId, 'owner');
  assert.deepEqual(f.source.engine.vault!.read(), liveSource); assert.deepEqual(await f.ciphertext(), liveBytes);
  const fresh = await f.target(); await fresh.rpc('workspace.open', { passphrase: TARGET_PASSWORD });
  const freshState = fresh.engine.vault!.read(), freshCiphertext = () => readFile(join(fresh.engine.vault!.directory, 'authority.encrypted.json'));
  assert.equal(freshState.revision, 0); assert.notEqual(fresh.engine.vault!.vaultId, original.vaultId);
  assert.deepEqual(freshState.members.map(value => value.id), [committed.ownerContext.memberId]);
  assert.equal(freshState.ontology.current!.hash, first.hash); assert.equal(Object.hasOwn(freshState.ontology, 'publicationAttempts'), false);
  assert.deepEqual(freshState.ontology.historicalPublicationEvidence, [{ workspaceId: historical.workspace.id, publicationAttempts: [receipt.attempt] }]);
  assert.deepEqual(freshState.receipts, []); assert.deepEqual(freshState.jobs, []); assert.deepEqual(freshState.sessions, []);
  const freshEnvelope = JSON.parse((await freshCiphertext()).toString('utf8')), sourceEnvelope = JSON.parse(Buffer.from(original.authority).toString('utf8'));
  assert.notDeepEqual(freshEnvelope.passphrase, sourceEnvelope.passphrase); assert.notDeepEqual(freshEnvelope.recovery, sourceEnvelope.recovery);
  const authorityBeforeRefusal = await freshCiphertext();
  await fresh.refuse('ontology.get', { attemptId: ATTEMPT }, ['DICTIONARY_ATTEMPT_AUTHORITY']);
  for (const expectedCurrentHash of [null, first.hash]) await fresh.refuse('ontology.publish', { draft: draft(), expectedCurrentHash, attemptId: ATTEMPT }, ['DICTIONARY_ATTEMPT_AUTHORITY']);
  await fresh.refuse('receipts.get', { id: originals[0].id }, ['RECEIPT_NOT_FOUND']);
  assert.deepEqual(fresh.engine.vault!.read(), freshState); assert.deepEqual(await freshCiphertext(), authorityBeforeRefusal);
  const firstFresh: CalculationReceipt[] = [];
  for (const request of requests) firstFresh.push(await fresh.rpc('calculation.run', request));
  assert.deepEqual(firstFresh.map(value => value.totalMinor), originals.map(value => value.totalMinor));
  for (const value of firstFresh) { assert.equal(value.memberId, committed.ownerContext.memberId); assert.deepEqual(await fresh.rpc('receipts.get', { id: value.id }), value); }
  const targetState = fresh.engine.vault!.read(), previousToken = fresh.token;
  await f.close(fresh); const reopened = await f.target();
  await reopened.refuse('workspace.status', {}, ['UNAUTHENTICATED'], previousToken);
  await reopened.refuse('workspace.open', { passphrase: SOURCE_PASSWORD }, ['UNLOCK_FAILED']);
  await reopened.rpc('workspace.open', { passphrase: TARGET_PASSWORD }); assert.deepEqual(reopened.engine.vault!.read(), targetState);
  await reopened.refuse('ontology.get', { attemptId: ATTEMPT }, ['DICTIONARY_ATTEMPT_AUTHORITY']);
  for (const value of firstFresh) assert.deepEqual(await reopened.rpc('receipts.get', { id: value.id }), value);
  const secondFresh: CalculationReceipt[] = [];
  for (const request of requests) secondFresh.push(await reopened.rpc('calculation.run', request));
  assert.deepEqual(secondFresh.map(value => value.totalMinor), originals.map(value => value.totalMinor));
  for (const value of secondFresh) { assert.equal(value.memberId, committed.ownerContext.memberId); assert.deepEqual(await reopened.rpc('receipts.get', { id: value.id }), value); }
  assert.equal(new Set([...firstFresh, ...secondFresh].map(value => value.id)).size, 6);
  const next: Dictionary = await reopened.rpc('ontology.publish', { draft: draft(), expectedCurrentHash: first.hash, attemptId: 'synthetic_fresh_owner_submission' });
  assert.equal(next.version, 2); assert.equal((await reopened.rpc('ontology.get', { attemptId: 'synthetic_fresh_owner_submission' })).attempt.workspaceId, committed.workspaceId);
  assert.deepEqual(reopened.engine.vault!.read().ontology.historicalPublicationEvidence, freshState.ontology.historicalPublicationEvidence);
  const currentTargetState = reopened.engine.vault!.read();
  assert.notDeepEqual(currentTargetState.ontology, freshState.ontology);
  const targetAuthorityPath = join(reopened.engine.vault!.directory, 'authority.encrypted.json');
  const targetAuthorityBeforeReplay = await readFile(targetAuthorityPath);
  const targetImmutablePaths = ['activation-bootstrap.encrypted.json', 'activation-evidence.encrypted.json']
    .map(path => join(f.directory, IDS.target, path));
  const targetImmutableBeforeReplay = await Promise.all(targetImmutablePaths.map(path => readFile(path)));
  await f.close(reopened);
  // workspace-activation-engine.ts #inspectLive seals ontology/business identity
  // while permitting fresh receipt history. A valid new owner's publication
  // changes that projection, so the OLD activation cannot adopt or replay it.
  await f.source.refuse('workspace.activation.execute', execute, ['ACTIVATION_LIVE_CUSTODY']);
  assert.deepEqual(await readFile(targetAuthorityPath), targetAuthorityBeforeReplay,
    'Refusal cannot rewrite the current authenticated target State or its fresh owner.');
  assert.deepEqual(await Promise.all(targetImmutablePaths.map(path => readFile(path))), targetImmutableBeforeReplay);
  assert.deepEqual(f.source.engine.vault!.read(), liveSource); assert.deepEqual(await f.ciphertext(), liveBytes);
  assert.deepEqual(await readFile(join(f.directory, IDS.inert, 'backup.inert.json')), inertBytes);
  assert.equal(await f.source.rpc('workspace.interchange.diagnostics'), null);
  t.diagnostic(JSON.stringify({ olderCut, originalPublicationVersion: 1, inheritedAttemptRefused: true,
    freshReceiptsBeforeReopen: firstFresh.length, freshReceiptsAfterReopen: secondFresh.length, actualHttpDeadlineMs: 30_000 }));
}

test('deferred first review survives real HTTP backup/export/inert restore and a fresh encrypted owner refuses inherited authority', { timeout: 120_000 }, t => journey(t, false));
test('older authenticated first-review cut stays historical after later publication and recovery, with independent fresh-owner receipts', { timeout: 120_000 }, t => journey(t, true));
