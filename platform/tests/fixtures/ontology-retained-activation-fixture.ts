import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative } from 'node:path';
import type { TestContext } from 'node:test';
import { authorize, check, type Context, type State } from '../../runtime/contracts.ts';
import { Vault } from '../../runtime/vault.ts';
import { WorkspaceActivationHost, type AuthenticatedActivationCandidate, type WorkspaceActivationAuthority,
  type WorkspaceActivationCommit, type WorkspaceActivationPorts, type WorkspaceActivationReadback } from '../../runtime/workspace-activation.ts';
import { WorkspaceImportCandidateService } from '../../runtime/workspace-import-candidate.ts';
import { canonicalInterchangeJson, captureWorkspaceInterchange, interchangeDigest } from '../../runtime/workspace-interchange.ts';
import { artifactsFor, emptyTarget, fixedTime, InterchangeFixtureStore } from './workspace-interchange-fixture.ts';
import { retainedOwner, retainedSource } from './workspace-interchange-retained-fixture.ts';

// Existing source orchestration with authenticated synthetic Node ciphertext.
// No native/database/browser, external credentials, listener or business effect.
type Cipher = { nonce: Buffer; tag: Buffer; body: Buffer };
export function ontologyRetainedActivationFixture(readSource: () => State,
  completeRead: (context: Context, historical: State) => void = () => {},
  options: { sourceContext?: Context; targetWorkspaceId?: string; freshOwnerId?: string } = {}) {
  const sourceContext = options.sourceContext ?? retainedOwner;
  const freshOwnerId = options.freshOwnerId ?? 'fresh_ontology_owner';
  const captured = readSource(), capture = captureWorkspaceInterchange(captured, artifactsFor(captured)), target = emptyTarget();
  if (options.targetWorkspaceId) target.workspaceId = options.targetWorkspaceId;
  const candidate = new WorkspaceImportCandidateService({ source: () => ({ ready: true, inventory: capture.inventory }),
    target: () => target, assertCompleteRead: completeRead }).prepare(sourceContext,
    { text: canonicalInterchangeJson(capture.package), targetId: target.targetId });
  const issued: AuthenticatedActivationCandidate = { content: canonicalInterchangeJson(candidate),
    pin: { format: 'chausar.interchange-custody-pin.v1', recordId: 'ontology_retained_candidate',
      creationId: 'ontology_retained_issuance', contextDigest: interchangeDigest(sourceContext),
      inventory: capture.inventory, packageDigest: candidate.packageDigest, kind: 'candidate',
      candidateDigest: interchangeDigest(candidate), target },
    measurement: { encrypted: true, archiveCiphertextBytes: 1, inventoryPinCiphertextBytes: 1, qualification: 'test-fixture' } };
  const key = randomBytes(32);
  function encrypt(text: string, aad: string): Cipher {
    const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(Buffer.from(aad));
    return { nonce, body: Buffer.concat([cipher.update(text), cipher.final()]), tag: cipher.getAuthTag() };
  }
  function decrypt(value: Cipher, aad: string): string {
    const cipher = createDecipheriv('aes-256-gcm', key, value.nonce);
    cipher.setAAD(Buffer.from(aad)); cipher.setAuthTag(value.tag);
    return Buffer.concat([cipher.update(value.body), cipher.final()]).toString('utf8');
  }
  const archive = encrypt(issued.content, 'ontology:archive'), independentPin = encrypt(JSON.stringify(issued.pin), 'ontology:pin');
  const candidateRead = (): AuthenticatedActivationCandidate => ({ content: decrypt(archive, 'ontology:archive'),
    pin: JSON.parse(decrypt(independentPin, 'ontology:pin')), measurement: { encrypted: true,
      archiveCiphertextBytes: archive.body.length + 28, inventoryPinCiphertextBytes: independentPin.body.length + 28,
      qualification: 'test-fixture' } });
  const authority: WorkspaceActivationAuthority = { workspaceId: target.workspaceId,
    owner: { id: freshOwnerId, name: 'Fresh synthetic ontology owner', role: 'owner', active: true, epoch: 7, branches: ['*'] },
    context: { memberId: freshOwnerId, role: 'owner', epoch: 7, channel: 'desktop' },
    sessionAuthorityId: 'fresh_ontology_session', createdAt: fixedTime };
  let committed: Cipher | undefined, commits = 0, allocations = 0, guards = 0;
  function readback(): WorkspaceActivationReadback {
    if (!committed) return { status: 'unknown', activationId: 'ontology_retained_activation', reasonCode: 'FIXTURE_UNCOMMITTED' };
    return { status: 'committed', encrypted: true, qualification: 'test-fixture', ciphertextBytes: committed.body.length + 28,
      ...JSON.parse(decrypt(committed, 'ontology:activation')) as WorkspaceActivationCommit };
  }
  const current = async () => {
    guards++;
    check(interchangeDigest(readSource()) === interchangeDigest(captured), 'INTERCHANGE_AUTHORITY_CHANGED',
      'The exact captured synthetic source State changed.');
  };
  const ports: WorkspaceActivationPorts = {
    custody: { async read() { return candidateRead(); } },
    async withTransaction(_context, _input, work) {
      const result = await work({ source: { ready: true, state: readSource(), artifacts: artifactsFor(captured), assertCurrent: current,
        async assertCompleteOwner(context, historical) { completeRead(context, historical); await current(); } },
        target, async readCandidate() { return candidateRead(); }, assertCurrent: current,
        async allocateAuthority() { allocations++; return structuredClone(authority); },
        async commit(value) {
          await current(); check(!committed, 'ACTIVATION_SINGLE_USE', 'Synthetic activation publication is single-use.');
          committed = encrypt(JSON.stringify(value), 'ontology:activation'); commits++;
        }, async readback() { return readback(); } });
      await current(); return result;
    },
    async readback(context) { authorize(new InterchangeFixtureStore(readSource()), context, 'admin'); return readback(); },
  };
  const host = () => new WorkspaceActivationHost(ports, { approvedSyntheticWorkspaceIds: [captured.workspace.id],
    allowedSyntheticSourceIds: [retainedSource], retentionDays: 90,
    budgets: { maxCandidateBytes: 8_000_000, maxArtifactBytes: 1_000_000, maxArtifacts: 64, maxFacts: 1000, maxRecords: 10_000 } });
  const request = { candidateId: issued.pin.recordId, reviewedDigest: interchangeDigest(candidate) };
  return { host, request, candidateRead, readback, counts: () => ({ commits, allocations, guards }),
    async activate() {
      const review = await host().review(sourceContext, request);
      const summary = await host().activate(sourceContext, { ...request, projectionDigest: review.projectionDigest,
        activationId: 'ontology_retained_activation', confirmed: true });
      return { review, summary };
    } };
}

export async function openOntologyActivatedTarget(t: TestContext,
  readback: Extract<WorkspaceActivationReadback, { status: 'committed' }>) {
  const base = await realpath(tmpdir()), directory = await realpath(await mkdtemp(join(base, 'chausar-ontology-retained-target-')));
  const passphrase = 'Synthetic ontology retained activation passphrase';
  let vault = (await Vault.createBootstrap({ directory, storage: 'experimental-file', passphrase, state: readback.state,
    expectedStateDigest: readback.record.stateDigest, expectedWorkspaceId: readback.state.workspace.id,
    expectedOwnerId: readback.authority.owner.id,
    budgets: { maxStateBytes: 8_000_000, maxJsonDepth: 128, maxJsonNodes: 200_000, maxRecords: 10_000 } })).vault;
  t.after(async () => {
    await vault.close();
    const actual = await realpath(directory), child = relative(base, actual);
    assert.equal(dirname(actual), base);
    assert.ok(child && !isAbsolute(child) && !child.startsWith('..') && child.startsWith('chausar-ontology-retained-target-'));
    await rm(actual, { recursive: true, force: true });
  });
  return { directory, get vault() { return vault; },
    ciphertext: () => readFile(join(directory, 'authority.encrypted.json')),
    async reopen() {
      await vault.close(); vault = await Vault.open({ directory, storage: 'experimental-file', passphrase });
    } };
}
