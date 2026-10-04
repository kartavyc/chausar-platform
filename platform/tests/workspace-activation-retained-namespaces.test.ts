import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { authorize, check, ChausarError, type Context, type State } from '../runtime/contracts.ts';
import { createEngineLessonService } from '../runtime/engine-lessons.ts';
import { EngineScenarioService } from '../runtime/engine-scenarios.ts';
import { Vault } from '../runtime/vault.ts';
import { WorkspaceImportCandidateService } from '../runtime/workspace-import-candidate.ts';
import { canonicalInterchangeJson, captureWorkspaceInterchange, interchangeDigest, readHistoricalWorkspaceState } from '../runtime/workspace-interchange.ts';
import { WorkspaceActivationHost, type AuthenticatedActivationCandidate, type WorkspaceActivationAuthority,
  type WorkspaceActivationCommit, type WorkspaceActivationPorts, type WorkspaceActivationReadback } from '../runtime/workspace-activation.ts';
import { artifactsFor, deterministicShopState, emptyTarget, fixedTime, InterchangeFixtureStore } from './fixtures/workspace-interchange-fixture.ts';
import { pin } from './fixtures/lesson-fixture.ts';
import { retainedApplicable, retainedInterchangeFixture, retainedOwner, retainedSource } from './fixtures/workspace-interchange-retained-fixture.ts';

// Synthetic Node custody only. No native/database/browser, listener or business effect.
const refusal = (code: string) => (error: unknown) => error instanceof ChausarError && error.code === code;
type Cipher = { nonce: Buffer; tag: Buffer; body: Buffer };
function activationFixture(readSource: () => State, completeRead: (context: Context, historical: State) => void = () => {}) {
  const captured = readSource(), capture = captureWorkspaceInterchange(captured, artifactsFor(captured)), target = emptyTarget();
  const candidate = new WorkspaceImportCandidateService({ source: () => ({ ready: true, inventory: capture.inventory }),
    target: () => target, assertCompleteRead: completeRead }).prepare(retainedOwner, { text: canonicalInterchangeJson(capture.package), targetId: target.targetId });
  const issued: AuthenticatedActivationCandidate = { content: canonicalInterchangeJson(candidate),
    pin: { format: 'chausar.interchange-custody-pin.v1', recordId: 'retained_candidate', creationId: 'retained_candidate_issuance',
      contextDigest: interchangeDigest(retainedOwner), inventory: capture.inventory, packageDigest: candidate.packageDigest,
      kind: 'candidate', candidateDigest: interchangeDigest(candidate), target },
    measurement: { encrypted: true, archiveCiphertextBytes: 1, inventoryPinCiphertextBytes: 1, qualification: 'test-fixture' } };
  const key = randomBytes(32);
  function encrypt(text: string, aad: string): Cipher {
    const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, nonce); cipher.setAAD(Buffer.from(aad));
    return { nonce, body: Buffer.concat([cipher.update(text), cipher.final()]), tag: cipher.getAuthTag() };
  }
  function decrypt(value: Cipher, aad: string): string {
    const cipher = createDecipheriv('aes-256-gcm', key, value.nonce); cipher.setAAD(Buffer.from(aad)); cipher.setAuthTag(value.tag);
    return Buffer.concat([cipher.update(value.body), cipher.final()]).toString('utf8');
  }
  const archive = encrypt(issued.content, 'candidate:archive'), independentPin = encrypt(JSON.stringify(issued.pin), 'candidate:pin');
  const candidateRead = (): AuthenticatedActivationCandidate => ({ content: decrypt(archive, 'candidate:archive'),
    pin: JSON.parse(decrypt(independentPin, 'candidate:pin')), measurement: { encrypted: true,
      archiveCiphertextBytes: archive.body.length + 28, inventoryPinCiphertextBytes: independentPin.body.length + 28, qualification: 'test-fixture' } });
  const authority: WorkspaceActivationAuthority = { workspaceId: target.workspaceId,
    owner: { id: 'fresh_retained_owner', name: 'Fresh synthetic owner', role: 'owner', active: true, epoch: 7, branches: ['*'] },
    context: { memberId: 'fresh_retained_owner', role: 'owner', epoch: 7, channel: 'desktop' },
    sessionAuthorityId: 'fresh_retained_session', createdAt: fixedTime };
  let committed: Cipher | undefined, commits = 0, allocations = 0;
  function readback(): WorkspaceActivationReadback {
    if (!committed) return { status: 'unknown', activationId: 'retained_activation', reasonCode: 'FIXTURE_UNCOMMITTED' };
    return { status: 'committed', encrypted: true, qualification: 'test-fixture', ciphertextBytes: committed.body.length + 28,
      ...JSON.parse(decrypt(committed, 'activation')) as WorkspaceActivationCommit };
  }
  const current = async () => {
    check(interchangeDigest(readSource()) === interchangeDigest(captured), 'INTERCHANGE_AUTHORITY_CHANGED', 'The exact captured fixture State changed.');
  };
  const ports: WorkspaceActivationPorts = {
    custody: { async read() { return candidateRead(); } },
    async withTransaction(_context, _input, work) {
      const result = await work({ source: { ready: true, state: readSource(), artifacts: artifactsFor(captured), assertCurrent: current,
        async assertCompleteOwner(context, historical) { completeRead(context, historical); await current(); } },
        target, async readCandidate() { return candidateRead(); }, assertCurrent: current,
        async allocateAuthority() { allocations++; return structuredClone(authority); },
        async commit(value) {
          await current(); check(!committed, 'ACTIVATION_SINGLE_USE', 'Fixture publication is single-use.');
          committed = encrypt(JSON.stringify(value), 'activation'); commits++;
        }, async readback() { return readback(); } });
      await current(); return result;
    },
    async readback(context) { authorize(new InterchangeFixtureStore(readSource()), context, 'admin'); return readback(); },
  };
  const host = () => new WorkspaceActivationHost(ports, { approvedSyntheticWorkspaceIds: [captured.workspace.id],
    allowedSyntheticSourceIds: [retainedSource], retentionDays: 90,
    budgets: { maxCandidateBytes: 8_000_000, maxArtifactBytes: 1_000_000, maxArtifacts: 64, maxFacts: 1000, maxRecords: 10_000 } });
  const request = { candidateId: issued.pin.recordId, reviewedDigest: interchangeDigest(candidate) };
  return { host, request, candidateRead, readback, counts: () => ({ commits, allocations }),
    async activate() {
      const review = await host().review(retainedOwner, request);
      const summary = await host().activate(retainedOwner, { ...request, projectionDigest: review.projectionDigest,
        activationId: 'retained_activation', confirmed: true });
      return { review, summary };
    } };
}

test('fresh-owner activation retains service-produced private history exactly and exposes no old authority', async t => {
  const source = await retainedInterchangeFixture(t), original = source.vault.read(), populated = source.populated!;
  const fixture = activationFixture(() => source.vault.read(), (context, historical) => {
    const scenarioCurrent = source.scenarios().assertInterchangeRead(context, historical);
    if (historical.lessonState) source.lessons().assertInterchangeRead(context, historical.lessonState,
      { at: source.exportClock, days: source.vault.read().policy.retentionDays });
    scenarioCurrent();
  });
  const { review, summary } = await fixture.activate(), read = fixture.readback();
  assert.equal(read.status, 'committed'); if (read.status !== 'committed') return;
  assert.equal(review.inertStores.includes('scenarioRecords'), true); assert.equal(review.inertStores.includes('lessonState'), true);
  assert.equal(review.liveStores.includes('scenarioRecords'), false); assert.equal(review.liveStores.includes('lessonState'), false);
  assert.equal(read.evidence.inert, true); assert.equal(read.evidence.content, fixture.candidateRead().content);
  const restored = readHistoricalWorkspaceState(JSON.parse(read.evidence.content).archive);
  for (const namespace of ['scenarioRecords', 'lessonState'] as const) {
    assert.equal(JSON.stringify(restored[namespace]), JSON.stringify(original[namespace]), 'All nested key order, IDs, lifecycle events and digests remain exact.');
    assert.equal(Object.hasOwn(read.state, namespace), false, 'Historical private authority is not a fresh runtime namespace.');
  }
  assert.equal(restored.scenarioRecords![0].comparisons.length, 1);
  assert.equal(restored.scenarioRecords![0].revisions.length, 2);
  assert.equal(restored.lessonState!.lessons[0].events.at(-1)!.type, 'approve');
  assert.deepEqual(await fixture.host().resolve(retainedOwner, { activationId: summary.activationId }), summary);

  const targetDirectory = await mkdtemp(join(await realpath(tmpdir()), 'chausar-retained-activation-target-'));
  const target = (await Vault.createBootstrap({ directory: targetDirectory, storage: 'experimental-file',
    passphrase: 'Synthetic fresh retained activation passphrase', state: read.state,
    expectedStateDigest: read.record.stateDigest, expectedWorkspaceId: summary.workspaceId, expectedOwnerId: summary.ownerContext.memberId,
    budgets: { maxStateBytes: 8_000_000, maxJsonDepth: 128, maxJsonNodes: 200_000, maxRecords: 10_000 } })).vault;
  t.after(async () => { await target.close(); await rm(targetDirectory, { recursive: true, force: true }); });
  const scenarios = new EngineScenarioService(target, source.scenarioOptions);
  await assert.rejects(scenarios.reopen(summary.ownerContext, populated.historical.scenarioId, populated.historical.revision.id), refusal('SCENARIO_UNAVAILABLE'));
  const lessons = createEngineLessonService({ read: () => target.read(), update: change => target.update(change) }, source.lessonOptions);
  assert.deepEqual(lessons.lessons(summary.ownerContext), []);
  assert.deepEqual(lessons.applicable(summary.ownerContext, retainedApplicable), []);
  assert.throws(() => lessons.resolveGuidance(summary.ownerContext, [pin(populated.approved.candidate)], retainedApplicable), refusal('LESSON_NOT_FOUND'));
  await assert.rejects(scenarios.reopen(retainedOwner, populated.historical.scenarioId, populated.historical.revision.id), refusal('ACCESS_REVOKED'));
  assert.deepEqual(fixture.counts(), { commits: 1, allocations: 1 });
});

test('activation explicitly distinguishes absent legacy namespaces from present empty historical namespaces', async t => {
  const cases: readonly (readonly ('scenarioRecords' | 'lessonState')[])[] = [[], ['scenarioRecords'], ['lessonState'], ['scenarioRecords', 'lessonState']];
  for (const namespaces of cases) {
    await t.test(namespaces.length ? namespaces.join('+') : 'legacy absence', async () => {
      const source = deterministicShopState();
      if (namespaces.includes('scenarioRecords')) source.scenarioRecords = [];
      if (namespaces.includes('lessonState')) source.lessonState = { workspaceId: source.workspace.id, episodes: [], lessons: [] };
      const fixture = activationFixture(() => structuredClone(source)), { review, summary } = await fixture.activate(), read = fixture.readback();
      assert.equal(read.status, 'committed'); if (read.status !== 'committed') return;
      const restored = readHistoricalWorkspaceState(JSON.parse(read.evidence.content).archive);
      for (const namespace of ['scenarioRecords', 'lessonState'] as const) {
        assert.equal(Object.hasOwn(restored, namespace), Object.hasOwn(source, namespace));
        assert.equal(review.inertStores.includes(namespace), Object.hasOwn(source, namespace));
        assert.equal(JSON.stringify(restored[namespace]), JSON.stringify(source[namespace]));
        assert.equal(Object.hasOwn(read.state, namespace), false);
      }
      assert.deepEqual(await fixture.host().resolve(retainedOwner, { activationId: summary.activationId }), summary);
    });
  }
});

test('retained lesson evaluation withdrawal refuses activation before fresh authority or publication', async t => {
  const source = await retainedInterchangeFixture(t);
  const fixture = activationFixture(() => source.vault.read(), (context, historical) => {
    const scenarioCurrent = source.scenarios().assertInterchangeRead(context, historical);
    if (historical.lessonState) source.lessons().assertInterchangeRead(context, historical.lessonState,
      { at: source.exportClock, days: source.vault.read().policy.retentionDays });
    scenarioCurrent();
  });
  source.protocol.evaluationRuns.clear();
  await assert.rejects(fixture.host().review(retainedOwner, fixture.request), refusal('SYNTHETIC_EVALUATION_UNAVAILABLE'));
  assert.deepEqual(fixture.counts(), { commits: 0, allocations: 0 });
});
