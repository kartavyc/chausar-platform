import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { authorize, ChausarError, hash, type Context, type State } from '../runtime/contracts.ts';
import { demoCsv, demoRecipe } from '../runtime/ingest.ts';
import { acquireProcessLock } from '../runtime/process-lock.ts';
import { Vault, type PrivateArtifactRef } from '../runtime/vault.ts';
import { WorkspaceInterchangeHost } from '../runtime/workspace-interchange-host.ts';
import { createWorkspaceInterchangeLocalPorts } from '../runtime/workspace-interchange-local.ts';
import { interchangeDigest, readHistoricalWorkspaceState } from '../runtime/workspace-interchange.ts';
import { WorkspaceActivationHost, type AuthenticatedActivationCandidate, type WorkspaceActivationAuthority,
  type WorkspaceActivationPolicy } from '../runtime/workspace-activation.ts';
import { WorkspaceActivationLocalCustody, type WorkspaceActivationLocalOptions } from '../runtime/workspace-activation-local.ts';
import { deterministicShopState, fixedTime, interchangeOwner } from './fixtures/workspace-interchange-fixture.ts';

// Synthetic C-temp files and actual experimental-file Vault encryption only.
// The explicitly labelled bootstrap fixture is not a target Vault/Engine initialization port.
const purpose = 'workspace-interchange' as const;
const passphrase = 'synthetic activation fixture passphrase';
const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const code = (expected: string) => (error: unknown) => error instanceof ChausarError && error.code === expected;
const artifactPath = (vault: Vault, id: string) => join(vault.directory, 'private-artifacts', purpose, `${id}.encrypted.json`);
const reference = ({ value: _value, ...ref }: PrivateArtifactRef & { value: unknown }) => ref;
const same = (a: unknown, b: unknown) => assert.equal(interchangeDigest(a), interchangeDigest(b));
const attemptId = (activationId: string) => `wal_${sha(activationId)}_attempt`;
const liveId = (activationId: string) => `fixture_${sha(activationId)}_live`;
type FixtureLive = { format: 'chausar.activation-live-test-fixture.v1'; initial: State; current: State;
  authority: WorkspaceActivationAuthority; initialDigest: string };

async function fixture(t: TestContext) {
  const base = await realpath(tmpdir());
  if (process.platform === 'win32') assert.match(base, /^C:\\/i, 'Validate C-drive scratch before any fixture writes.');
  const applicationDirectory = await realpath(await mkdtemp(join(base, 'chausar-activation-local-')));
  assert.equal(dirname(applicationDirectory), base);
  let sourceVault: Vault | undefined, journalVault: Vault | undefined;
  t.after(async () => {
    await sourceVault?.close(); await journalVault?.close();
    const actual = await realpath(applicationDirectory);
    assert.equal(dirname(actual), base); assert.match(actual.split(/[\\/]/).at(-1)!, /^chausar-activation-local-/);
    await rm(actual, { recursive: true, force: true });
  });
  sourceVault = (await Vault.create({ directory: join(applicationDirectory, 'source'), name: 'Synthetic source',
    passphrase, storage: 'experimental-file', demo: true })).vault;
  journalVault = (await Vault.create({ directory: join(applicationDirectory, 'journal'), name: 'Synthetic activation journal',
    passphrase, storage: 'experimental-file', demo: true })).vault;
  await sourceVault.update(draft => {
    const state = deterministicShopState(); state.workspace.id = draft.workspace.id;
    const input = { sourceId: 'demo-export', format: 'csv' as const, content: demoCsv, recipe: demoRecipe,
      expectedTotals: { rowCount: 10, amountMinor: '1230000' } };
    state.imports[0].retainedInput = { version: 1, generation: 1, input, digest: hash(input) };
    state.sessions.push({ id: 'historical_session', token: 'synthetic_old_session_token' });
    state.routes.push({ id: 'historical_route', approved: true });
    Object.assign(draft, state);
  });
  const targetId = 'target_fixture', candidateId = 'candidate_fixture';
  let prepared = 0, allocated = 0, inspected = 0;
  let sourceGuards = 0, completeOwnerGuards = 0, candidateReads = 0;
  let ready = true;
  let inspectionHook: ((targetDirectory: string) => Promise<void>) | undefined;
  let completeOwnerHook: (() => Promise<void>) | undefined;
  let allocationHook: (() => Promise<void>) | undefined;
  let custody = localInterchange();
  function localInterchange() {
    return createWorkspaceInterchangeLocalPorts({ vault: sourceVault!, applicationDirectory, qualification: 'encrypted-local-host',
      assertCompleteOwner: async () => {
        if (!ready) throw new ChausarError('INTERCHANGE_NOT_READY', 'Synthetic consumer readiness revoked.');
      } });
  }
  const interchangeHost = new WorkspaceInterchangeHost(custody.ports);
  await interchangeHost.export(interchangeOwner, { destinationId: 'export_fixture', confirmed: true });
  const issued = await interchangeHost.prepare(interchangeOwner, { exportId: 'export_fixture', candidateId, targetId });
  const candidate = await custody.ports.custody.read(interchangeOwner, candidateId);
  assert.equal(candidate.pin.kind, 'candidate');
  const sourceInitial = sourceVault.read();
  const policy: WorkspaceActivationPolicy = { approvedSyntheticWorkspaceIds: [sourceInitial.workspace.id],
    allowedSyntheticSourceIds: ['demo-export'], retentionDays: 90,
    budgets: { maxCandidateBytes: 4 * 1024 * 1024, maxArtifactBytes: 4 * 1024 * 1024,
      maxArtifacts: 100, maxFacts: 100, maxRecords: 1000 } };

  async function readCandidate(context: Context, id: string): Promise<AuthenticatedActivationCandidate> {
    candidateReads++;
    authorize(sourceVault!, context, 'admin');
    const prefix = `wic_${sha(id)}`;
    const commit = await sourceVault!.readArtifact({ id: `${prefix}_commit`, purpose });
    const binding = commit.value as { format: string; state: string; recordId: string; instance: string; contextDigest: string;
      archive: PrivateArtifactRef; pin: PrivateArtifactRef; contentDigest: string; pinDigest: string };
    assert.equal(binding.format, 'chausar.interchange-local-binding.v1'); assert.equal(binding.state, 'committed');
    assert.equal(binding.recordId, id); assert.ok(binding.instance); assert.equal(binding.contextDigest, interchangeDigest(context));
    const archive = await sourceVault!.readArtifact({ id: `${prefix}_archive`, purpose });
    const pin = await sourceVault!.readArtifact({ id: `${prefix}_pin`, purpose });
    same(reference(archive), binding.archive); same(reference(pin), binding.pin);
    const archiveValue = archive.value as { format: string; recordId: string; content: string };
    const pinValue = pin.value as { format: string; recordId: string; pin: AuthenticatedActivationCandidate['pin'] };
    assert.equal(archiveValue.format, 'chausar.interchange-local-archive.v1'); assert.equal(archiveValue.recordId, id);
    assert.equal(pinValue.format, 'chausar.interchange-local-pin.v1'); assert.equal(pinValue.recordId, id);
    assert.equal(interchangeDigest(archiveValue.content), binding.contentDigest);
    assert.equal(interchangeDigest(pinValue.pin), binding.pinDigest);
    return { content: archiveValue.content, pin: structuredClone(pinValue.pin), measurement: { encrypted: true,
      archiveCiphertextBytes: archive.diskBytes, inventoryPinCiphertextBytes: pin.diskBytes, qualification: 'encrypted-local-host' } };
  }
  function options(): WorkspaceActivationLocalOptions {
    return { sourceVault: sourceVault!, journalVault: journalVault!, applicationDirectory,
      source: { withSource: (context, expected, work) => custody.ports.withSource(context, expected, lease => work({
        ...lease,
        assertCurrent: async () => { sourceGuards++; await lease.assertCurrent(); },
        assertCompleteOwner: async (ctx, historical) => {
          completeOwnerGuards++; await lease.assertCompleteOwner(ctx, historical); await completeOwnerHook?.();
        },
      })) },
      candidates: { read: (context, id) => custody.ports.custody.read(context, id),
        withCandidate: async (context, id, work) => {
          const lock = await acquireProcessLock(candidateLockPath(id), { busyCode: 'ACTIVATION_CANDIDATE_BUSY' });
          try { return await work(() => readCandidate(context, id)); } finally { await lock.release(); }
        } },
      bootstrap: {
        allocateAuthority: async (_context, target) => {
          allocated++;
          await allocationHook?.();
          const memberId = `fresh_owner_${randomUUID()}`;
          return { workspaceId: target.workspaceId,
            owner: { id: memberId, name: 'Fresh synthetic owner', role: 'owner', active: true, epoch: 1, branches: ['*'] },
            context: { memberId, role: 'owner', epoch: 1, channel: 'desktop' },
            sessionAuthorityId: `fresh_session_${randomUUID()}`, createdAt: fixedTime };
        },
        prepare: async ({ stagingDirectory, publication }) => {
          prepared++;
          const live: FixtureLive = { format: 'chausar.activation-live-test-fixture.v1', initial: publication.state,
            current: publication.state, authority: publication.authority, initialDigest: hash(publication.state) };
          const ref = await journalVault!.writeArtifact({ id: liveId(publication.record.activationId), purpose, value: live, expectedDigest: null });
          await copyFile(artifactPath(journalVault!, ref.id), join(stagingDirectory, 'live', 'authority.encrypted.json'));
          await mkdir(join(stagingDirectory, 'live', 'empty-artifacts'));
          return { liveFiles: ['live/authority.encrypted.json'], qualification: 'test-fixture' };
        },
        inspect: async ({ targetDirectory, publication }) => {
          inspected++;
          const retained = await journalVault!.readArtifact({ id: liveId(publication.record.activationId), purpose });
          const bytes = await readFile(join(targetDirectory, 'live', 'authority.encrypted.json'));
          assert.deepEqual(bytes, await readFile(artifactPath(journalVault!, retained.id)), 'Live ciphertext must equal authenticated current custody.');
          const live = retained.value as FixtureLive;
          assert.equal(live.format, 'chausar.activation-live-test-fixture.v1');
          assert.equal(JSON.stringify(live.initial), JSON.stringify(publication.state));
          assert.equal(live.initialDigest, publication.record.stateDigest); same(live.authority, publication.authority);
          assert.equal(live.current.workspace.id, publication.state.workspace.id);
          assert.ok(live.current.revision >= live.initial.revision);
          assert.deepEqual(live.current.members, [publication.authority.owner]);
          authorize({ read: () => live.current, update: async () => { throw new Error('Read-only bootstrap inspection.'); } },
            publication.authority.context, 'admin');
          await inspectionHook?.(targetDirectory);
        },
      }, budgets: { maxFiles: 30, maxBytes: 8 * 1024 * 1024, maxDepth: 5 } };
  }
  function candidateLockPath(id = candidateId) {
    return join(applicationDirectory, '.workspace-interchange-control', 'records', `${sha(`${sourceVault!.vaultId}:${id}`)}.lock`);
  }
  let local = new WorkspaceActivationLocalCustody(options());
  let host = new WorkspaceActivationHost(local.ports, policy);
  const request = { candidateId, reviewedDigest: issued.reviewedDigest };
  return { applicationDirectory, candidate, sourceInitial, request, targetId,
    get sourceVault() { return sourceVault!; }, get journalVault() { return journalVault!; },
    get local() { return local; }, get host() { return host; },
    targetPath: () => local.targetPath(targetId),
    targetLockPath: () => join(applicationDirectory, '.workspace-interchange-control', 'targets', `${sha(local.targetPath(targetId))}.lock`),
    candidateLockPath, counts: () => ({ prepared, allocated, inspected }), setReady: (value: boolean) => { ready = value; },
    guardCounts: () => ({ sourceGuards, completeOwnerGuards, candidateReads }),
    resetGuardCounts: () => { sourceGuards = 0; completeOwnerGuards = 0; candidateReads = 0; },
    onCompleteOwner: (hook: (() => Promise<void>) | undefined) => { completeOwnerHook = hook; },
    onAllocation: (hook: (() => Promise<void>) | undefined) => { allocationHook = hook; },
    onInspection: (hook: ((targetDirectory: string) => Promise<void>) | undefined) => { inspectionHook = hook; },
    async activate(activationId = 'activation_fixture') {
      const review = await host.review(interchangeOwner, request);
      return host.activate(interchangeOwner, { ...request, projectionDigest: review.projectionDigest, activationId, confirmed: true });
    },
    async advanceLive(activationId: string) {
      const retained = await journalVault!.readArtifact({ id: liveId(activationId), purpose });
      const live = structuredClone(retained.value) as FixtureLive;
      live.current.revision++; live.current.activity.push({ id: 'later_live_activity', at: fixedTime });
      await journalVault!.writeArtifact({ id: retained.id, purpose, value: live, expectedDigest: retained.valueDigest });
      await copyFile(artifactPath(journalVault!, retained.id), join(local.targetPath(targetId), 'live', 'authority.encrypted.json'));
    },
    async reopen() {
      await sourceVault!.close(); await journalVault!.close();
      sourceVault = await Vault.open({ directory: join(applicationDirectory, 'source'), storage: 'experimental-file', passphrase });
      journalVault = await Vault.open({ directory: join(applicationDirectory, 'journal'), storage: 'experimental-file', passphrase });
      custody = localInterchange(); local = new WorkspaceActivationLocalCustody(options()); host = new WorkspaceActivationHost(local.ports, policy);
    },
  };
}

async function treeBytes(root: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  const visit = async (directory: string, prefix: string) => {
    for (const name of (await readdir(directory)).sort()) {
      const path = join(directory, name), key = `${prefix}${name}`, stat = await lstat(path);
      assert.equal(stat.isSymbolicLink(), false);
      if (stat.isDirectory()) await visit(path, `${key}/`);
      else result[key] = (await readFile(path)).toString('base64');
    }
  };
  await visit(root, ''); return result;
}

async function holdChildLock(t: TestContext, path: string) {
  const modulePath = new URL('../runtime/process-lock.ts', import.meta.url).href;
  const script = `const {acquireProcessLock}=await import(process.argv[2]);
    const lock=await acquireProcessLock(process.argv[1]);
    const timer=setTimeout(async()=>{await lock.release();process.exit(2);},12000);
    process.stdin.once('data',async()=>{clearTimeout(timer);await lock.release();process.exit(0);});
    process.stdout.write('LOCKED\\n');`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script, path, modulePath],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = '', output = '';
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  const exit = new Promise<number | null>(resolve => child.once('exit', resolve));
  t.after(async () => {
    if (child.exitCode === null) child.stdin.end('release');
    const timer = setTimeout(() => child.kill(), 3000);
    try { await exit; } finally { clearTimeout(timer); }
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Child lock did not become ready: ${stderr}`)), 5000);
    child.stdout.on('data', chunk => {
      output += chunk.toString();
      if (output.includes('LOCKED\n')) { clearTimeout(timer); resolve(); }
    });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', status => { clearTimeout(timer); if (!output.includes('LOCKED\n')) reject(new Error(`Child exited ${status}: ${stderr}`)); });
  });
  return async () => { child.stdin.end('release'); assert.equal(await exit, 0, stderr); };
}

test('real Local review performs one source guard per complete fence while retaining owner and candidate checks', { timeout: 30_000 }, async t => {
  const f = await fixture(t);
  const review = await f.host.review(interchangeOwner, f.request);
  assert.equal(review.candidateId, f.request.candidateId);
  const counts = f.guardCounts();
  t.diagnostic(JSON.stringify({ ...counts, bootstrapQualification: 'test-fixture', nativeStorageQualified: false }));
  // Local entry/exit plus three complete Host fences. Each Host fence still
  // checks complete owner access and rereads the held authenticated candidate.
  assert.equal(counts.completeOwnerGuards, 3);
  assert.equal(counts.candidateReads, 9);
  assert.equal(counts.sourceGuards, 5, 'The complete Local fence already asserts the source; adjacent source-only checks duplicate capture.');
  assert.deepEqual(f.counts(), { prepared: 0, allocated: 0, inspected: 0 });
  assert.deepEqual(await readdir(f.targetPath()), []);
  assert.deepEqual(await f.journalVault.listArtifacts({ purpose }), []);
});

test('real Local fences refuse changes across awaited owner, allocation and empty-exit boundaries', { timeout: 60_000 }, async t => {
  await t.test('readiness revoked after complete-owner admission', async subtest => {
    const f = await fixture(subtest);
    let changed = false;
    f.onCompleteOwner(async () => { await Promise.resolve(); changed = true; f.setReady(false); });
    await assert.rejects(f.host.review(interchangeOwner, f.request), code('INTERCHANGE_NOT_READY'));
    assert.equal(changed, true); assert.equal(f.guardCounts().completeOwnerGuards, 1);
    assert.deepEqual(f.counts(), { prepared: 0, allocated: 0, inspected: 0 });
    assert.deepEqual(await readdir(f.targetPath()), []);
    assert.deepEqual(await f.journalVault.listArtifacts({ purpose }), []);
  });

  for (const boundary of ['allocation', 'empty_exit'] as const) {
    for (const change of ['owner', 'readiness', 'candidate', 'target'] as const) await t.test(`${boundary}: ${change}`, async subtest => {
      const f = await fixture(subtest), pin = f.candidate.pin;
      assert.equal(pin.kind, 'candidate'); if (pin.kind !== 'candidate') throw new Error('The fixture must issue a candidate.');
      let changed = false, preserved: { path: string; bytes: Buffer } | undefined;
      const mutation = async () => {
        await Promise.resolve(); changed = true;
        if (change === 'owner') {
          // Simulate current authority revocation at the trusted Vault read boundary;
          // actual Local authorization still decides admission, never a fake guard.
          const revoked = f.sourceVault.read(); revoked.members[0].active = false;
          subtest.mock.method(f.sourceVault, 'read', () => structuredClone(revoked));
        } else if (change === 'readiness') f.setReady(false);
        else if (change === 'target') {
          const path = join(f.targetPath(), 'late_unrelated.txt'), bytes = Buffer.from('synthetic work that must survive refusal');
          await writeFile(path, bytes, { flag: 'wx' }); preserved = { path, bytes };
        } else {
          // Rebind genuinely authenticated ciphertext to another issuance instance.
          // Controls stay valid for source inventory; the held exact-candidate guard
          // must detect the changed creation ID independently.
          const prefix = `wic_${sha(f.request.candidateId)}`;
          const retainedPin = await f.sourceVault.readArtifact({ id: `${prefix}_pin`, purpose });
          const pinValue = structuredClone(retainedPin.value) as { pin: AuthenticatedActivationCandidate['pin'] };
          pinValue.pin.creationId = `changed_${randomUUID()}`;
          const nextPin = await f.sourceVault.writeArtifact({ id: retainedPin.id, purpose, value: pinValue,
            expectedDigest: retainedPin.valueDigest });
          const retainedCommit = await f.sourceVault.readArtifact({ id: `${prefix}_commit`, purpose });
          await f.sourceVault.writeArtifact({ id: retainedCommit.id, purpose,
            value: { ...(retainedCommit.value as Record<string, unknown>), pin: nextPin, pinDigest: interchangeDigest(pinValue.pin) },
            expectedDigest: retainedCommit.valueDigest });
          const path = artifactPath(f.sourceVault, retainedPin.id); preserved = { path, bytes: await readFile(path) };
        }
      };
      const expected = { owner: 'ACCESS_REVOKED', readiness: 'INTERCHANGE_NOT_READY',
        candidate: 'ACTIVATION_CANDIDATE_CHANGED', target: 'ACTIVATION_TARGET_CHANGED' }[change];
      const transactionPins = { candidateId: f.request.candidateId, targetId: f.targetId,
        expectedInventory: pin.inventory, expectedTarget: pin.target };
      if (boundary === 'allocation') f.onAllocation(mutation);
      await assert.rejects(f.local.ports.withTransaction(interchangeOwner, transactionPins, async lease => {
        if (boundary === 'allocation') await lease.allocateAuthority();
        else await mutation();
        return 'must not escape a changed held fence';
      }), code(expected));
      assert.equal(changed, true);
      assert.deepEqual(f.counts(), { prepared: 0, allocated: boundary === 'allocation' ? 1 : 0, inspected: 0 });
      assert.deepEqual(await f.journalVault.listArtifacts({ purpose }), []);
      assert.deepEqual(await readdir(f.targetPath()), change === 'target' ? ['late_unrelated.txt'] : []);
      if (preserved) assert.deepEqual(await readFile(preserved.path), preserved.bytes, 'Refusal must preserve the changed custody for inspection.');
    });
  }
});

test('actual activation storage retains exact encrypted original and ordered bootstrap independently of later live revisions', { timeout: 30_000 }, async t => {
  const f = await fixture(t), summary = await f.activate();
  assert.equal(summary.status, 'committed'); assert.equal(summary.qualification, 'test-fixture');
  assert.deepEqual((await readdir(join(f.targetPath(), 'live'))).sort(), ['authority.encrypted.json', 'empty-artifacts']);
  assert.deepEqual(await readdir(join(f.targetPath(), 'live', 'empty-artifacts')), [], 'Root-prepared empty namespaces survive physical publication.');
  assert.ok(summary.ciphertextBytes > 0); assert.equal(f.counts().prepared, 1);
  const read = await f.local.ports.readback(interchangeOwner, { activationId: summary.activationId });
  assert.equal(read.status, 'committed'); if (read.status !== 'committed') return;
  assert.equal(read.evidence.content, f.candidate.content); same(read.evidence.pin, f.candidate.pin);
  assert.deepEqual(readHistoricalWorkspaceState(JSON.parse(read.evidence.content).archive), f.sourceInitial);
  assert.equal(read.state.revision, 0); assert.deepEqual(read.state.members, [read.authority.owner]);
  assert.notEqual(read.state.workspace.id, f.sourceInitial.workspace.id);
  assert.notEqual(read.authority.owner.id, interchangeOwner.memberId);
  assert.deepEqual(read.state.sessions, []); assert.deepEqual(read.state.routes, []);
  assert.equal(JSON.stringify(read.state.ontology), JSON.stringify(f.sourceInitial.ontology));
  assert.equal(read.record.stateDigest, hash(read.state)); assert.deepEqual(f.sourceVault.read(), f.sourceInitial);
  const immutableBefore = await readFile(join(f.targetPath(), 'activation-bootstrap.encrypted.json'));
  const evidenceBefore = await readFile(join(f.targetPath(), 'activation-evidence.encrypted.json'));
  for (const bytes of [immutableBefore, evidenceBefore, await readFile(join(f.targetPath(), 'live', 'authority.encrypted.json'))]) {
    assert.ok(!bytes.includes(Buffer.from('demo-export'))); assert.ok(!bytes.includes(Buffer.from('synthetic_old_session_token')));
  }
  await f.advanceLive(summary.activationId); await f.reopen();
  const resolved = await f.host.resolve(interchangeOwner, { activationId: summary.activationId });
  assert.equal(resolved.status, 'committed');
  const restarted = await f.local.ports.readback(interchangeOwner, { activationId: summary.activationId });
  assert.equal(restarted.status, 'committed'); if (restarted.status !== 'committed') return;
  assert.equal(JSON.stringify(restarted.state), JSON.stringify(read.state));
  assert.deepEqual(await readFile(join(f.targetPath(), 'activation-bootstrap.encrypted.json')), immutableBefore);
  assert.deepEqual(await readFile(join(f.targetPath(), 'activation-evidence.encrypted.json')), evidenceBefore);
  assert.equal(f.counts().prepared, 1, 'Resolve must never republish or initialize the live subtree.');
  t.diagnostic(JSON.stringify({ actualEncryptedFiles: true, sourceAndJournalReopened: true, bootstrapQualification: 'test-fixture',
    usableVaultOrEngineQualified: false, ciphertextBytes: restarted.ciphertextBytes, initialRevision: restarted.state.revision }));
});

test('lost final journal acknowledgement resolves measured committed custody after closing and reopening both Vaults', { timeout: 30_000 }, async t => {
  const f = await fixture(t), original = f.journalVault.writeArtifact.bind(f.journalVault);
  let lost = false;
  f.journalVault.writeArtifact = async input => {
    const ref = await original(input);
    if ((input.value as { phase?: string }).phase === 'committed' && !lost) { lost = true; throw new Error('Synthetic final durable acknowledgement lost.'); }
    return ref;
  };
  await assert.rejects(f.activate('activation_lost_ack'), code('ACTIVATION_COMMIT_UNKNOWN'));
  assert.equal(lost, true); assert.equal(f.counts().prepared, 1);
  const before = await treeBytes(f.targetPath()); await f.reopen();
  const resolved = await f.host.resolve(interchangeOwner, { activationId: 'activation_lost_ack' });
  assert.equal(resolved.status, 'committed'); assert.deepEqual(await treeBytes(f.targetPath()), before);
  assert.equal(f.counts().prepared, 1);
  const journal = await f.journalVault.readArtifact({ id: attemptId('activation_lost_ack'), purpose });
  assert.equal((journal.value as { phase: string }).phase, 'committed');
});

test('prepared and physically partial publication remain unknown across restart without adoption or retry', { timeout: 40_000 }, async t => {
  for (const fault of ['before_links', 'after_first_link'] as const) await t.test(fault, async subtest => {
    const f = await fixture(subtest), original = f.sourceVault.withCustodyWriterAdmission.bind(f.sourceVault);
    f.sourceVault.withCustodyWriterAdmission = async work => original(async assertCurrent => {
      if (fault === 'before_links') throw new Error('Synthetic crash boundary after durable preparation.');
      await writeFile(join(f.targetPath(), 'activation-evidence.encrypted.json'), 'synthetic unrelated collision', { flag: 'wx' });
      return work(assertCurrent);
    });
    const activationId = `activation_${fault}`;
    await assert.rejects(f.activate(activationId), code('ACTIVATION_COMMIT_UNKNOWN'));
    const journal = await f.journalVault.readArtifact({ id: attemptId(activationId), purpose });
    assert.equal((journal.value as { phase: string }).phase, 'prepared');
    const before = await treeBytes(f.targetPath());
    if (fault === 'before_links') assert.deepEqual(before, {});
    else {
      assert.ok(before['activation-bootstrap.encrypted.json']);
      assert.equal(Buffer.from(before['activation-evidence.encrypted.json'], 'base64').toString(), 'synthetic unrelated collision');
      assert.equal(before['live/authority.encrypted.json'], undefined);
    }
    await f.reopen();
    assert.deepEqual(await f.host.resolve(interchangeOwner, { activationId }),
      { status: 'unknown', activationId, reasonCode: 'ACTIVATION_ATTEMPT_UNRESOLVED' });
    assert.deepEqual(await treeBytes(f.targetPath()), before); assert.equal(f.counts().prepared, 1);
    // Empty only this independently created synthetic target, preserving its reserved physical directory.
    assert.equal(dirname(f.targetPath()), f.applicationDirectory); assert.equal(f.targetPath(), join(f.applicationDirectory, f.targetId));
    for (const entry of await readdir(f.targetPath())) await rm(join(f.targetPath(), entry), { recursive: true, force: true });
    const review = await f.host.review(interchangeOwner, f.request);
    for (const replayId of [activationId, `${activationId}_new`]) {
      await assert.rejects(f.host.activate(interchangeOwner, { ...f.request, projectionDigest: review.projectionDigest,
        activationId: replayId, confirmed: true }), code('ACTIVATION_COMMIT_UNKNOWN'));
    }
    assert.deepEqual(await readdir(f.targetPath()), []); assert.equal(f.counts().prepared, 1);
    await assert.rejects(f.journalVault.readArtifact({ id: attemptId(`${activationId}_new`), purpose }), code('ARTIFACT_NOT_FOUND'));
  });
});

test('separate child processes hold actual target and candidate issuance exclusion before any activation publication', { timeout: 40_000 }, async t => {
  for (const which of ['target', 'candidate'] as const) await t.test(which, async subtest => {
    const f = await fixture(subtest), review = await f.host.review(interchangeOwner, f.request);
    const release = await holdChildLock(subtest, which === 'target' ? f.targetLockPath() : f.candidateLockPath());
    try {
      await assert.rejects(f.host.activate(interchangeOwner, { ...f.request, projectionDigest: review.projectionDigest,
        activationId: `activation_${which}_busy`, confirmed: true }), code(which === 'target' ? 'ACTIVATION_BUSY' : 'INTERCHANGE_BUSY'));
      assert.deepEqual(await readdir(f.targetPath()), []); assert.equal(f.counts().prepared, 0); assert.equal(f.counts().allocated, 0);
      assert.deepEqual(await f.journalVault.listArtifacts({ purpose }), []);
    } finally { await release(); }
    assert.equal((await f.activate(`activation_${which}_released`)).status, 'committed');
  });
});

test('current source authority and readiness remain mandatory for activation and restart inspection', { timeout: 30_000 }, async t => {
  const f = await fixture(t), summary = await f.activate('activation_authority');
  await assert.rejects(f.host.resolve({ ...interchangeOwner, sourceTainted: true }, { activationId: summary.activationId }), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(f.host.resolve({ ...interchangeOwner, epoch: 2 }, { activationId: summary.activationId }), code('ACCESS_REVOKED'));
  f.setReady(false);
  await assert.rejects(f.host.resolve(interchangeOwner, { activationId: summary.activationId }), code('INTERCHANGE_NOT_READY'));
  f.setReady(true);
  await f.sourceVault.update(state => { state.members[0].active = false; });
  await f.reopen();
  await assert.rejects(f.host.resolve(interchangeOwner, { activationId: summary.activationId }), code('ACCESS_REVOKED'));
  assert.equal(f.counts().prepared, 1);
});

test('replaced target physical generation is unknown even when every ciphertext byte is identical', { timeout: 30_000 }, async t => {
  const f = await fixture(t), summary = await f.activate('activation_replaced'), before = await treeBytes(f.targetPath());
  const preserved = join(f.applicationDirectory, 'preserved_synthetic_target');
  assert.equal(dirname(f.targetPath()), f.applicationDirectory); assert.equal(dirname(preserved), f.applicationDirectory);
  await rename(f.targetPath(), preserved); await mkdir(f.targetPath()); await mkdir(join(f.targetPath(), 'live'));
  for (const [name, bytes] of Object.entries(before)) await writeFile(join(f.targetPath(), name), Buffer.from(bytes, 'base64'));
  assert.deepEqual(await treeBytes(f.targetPath()), before); await f.reopen();
  assert.deepEqual(await f.host.resolve(interchangeOwner, { activationId: summary.activationId }),
    { status: 'unknown', activationId: summary.activationId, reasonCode: 'ACTIVATION_CUSTODY_UNRESOLVED' });
  assert.deepEqual(await treeBytes(f.targetPath()), before); assert.deepEqual(await treeBytes(preserved), before);
  assert.equal(f.counts().prepared, 1);
});

test('extra target entries and changed immutable ciphertext refuse restart custody without removing evidence', { timeout: 30_000 }, async t => {
  const f = await fixture(t), summary = await f.activate('activation_changed'), extra = join(f.targetPath(), 'unrelated.txt');
  await writeFile(extra, 'synthetic unrelated target work');
  assert.equal((await f.host.resolve(interchangeOwner, { activationId: summary.activationId })).status, 'unknown');
  assert.equal(await readFile(extra, 'utf8'), 'synthetic unrelated target work'); await unlink(extra);
  const evidence = join(f.targetPath(), 'activation-evidence.encrypted.json'), bytes = await readFile(evidence);
  bytes[bytes.length - 2] ^= 1; await writeFile(evidence, bytes);
  assert.equal((await f.host.resolve(interchangeOwner, { activationId: summary.activationId })).status, 'unknown');
  assert.deepEqual(await readFile(evidence), bytes); assert.equal(f.counts().prepared, 1);
});

test('atomic ledger reservation survives lost acknowledgement before attempt and claim records exist', { timeout: 30_000 }, async t => {
  const f = await fixture(t), original = f.journalVault.writeArtifact.bind(f.journalVault);
  let lost = false;
  f.journalVault.writeArtifact = async input => {
    const result = await original(input);
    if (input.id === 'wal_ledger_v1' && !lost) { lost = true; throw new Error('Synthetic durable ledger acknowledgement lost.'); }
    return result;
  };
  await assert.rejects(f.activate('activation_ledger_lost'), code('ACTIVATION_COMMIT_UNKNOWN'));
  assert.equal(lost, true); assert.equal(f.counts().prepared, 0); assert.deepEqual(await readdir(f.targetPath()), []);
  assert.deepEqual((await f.journalVault.listArtifacts({ purpose })).map(ref => ref.id), ['wal_ledger_v1']);
  await f.reopen();
  assert.deepEqual(await f.host.resolve(interchangeOwner, { activationId: 'activation_ledger_lost' }),
    { status: 'unknown', activationId: 'activation_ledger_lost', reasonCode: 'ACTIVATION_ATTEMPT_NOT_FOUND' });
  const review = await f.host.review(interchangeOwner, f.request);
  await assert.rejects(f.host.activate(interchangeOwner, { ...f.request, projectionDigest: review.projectionDigest,
    activationId: 'activation_ledger_replay', confirmed: true }), code('ACTIVATION_COMMIT_UNKNOWN'));
  assert.deepEqual(await readdir(f.targetPath()), []); assert.equal(f.counts().prepared, 0);
  assert.deepEqual((await f.journalVault.listArtifacts({ purpose })).map(ref => ref.id), ['wal_ledger_v1']);
});

test('restart repeats physical custody and current admission after asynchronous live inspection', { timeout: 30_000 }, async t => {
  const f = await fixture(t), summary = await f.activate('activation_inspection_fence');
  const extra = join(f.targetPath(), 'late_unrelated.txt');
  f.onInspection(async targetDirectory => {
    assert.equal(targetDirectory, f.targetPath()); await writeFile(extra, 'synthetic late unrelated target work', { flag: 'wx' });
  });
  assert.deepEqual(await f.host.resolve(interchangeOwner, { activationId: summary.activationId }),
    { status: 'unknown', activationId: summary.activationId, reasonCode: 'ACTIVATION_CUSTODY_UNRESOLVED' });
  assert.equal(await readFile(extra, 'utf8'), 'synthetic late unrelated target work'); await unlink(extra);
  f.onInspection(async () => { f.setReady(false); });
  await assert.rejects(f.host.resolve(interchangeOwner, { activationId: summary.activationId }), code('INTERCHANGE_NOT_READY'));
  f.setReady(true); f.onInspection(undefined);
  assert.equal((await f.host.resolve(interchangeOwner, { activationId: summary.activationId })).status, 'committed');
  assert.equal(f.counts().prepared, 1);
});
