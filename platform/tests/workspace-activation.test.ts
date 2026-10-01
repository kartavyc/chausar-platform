import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import test from 'node:test';
import { authorize, ChausarError, hash, type Context, type State } from '../runtime/contracts.ts';
import { CalculatorService, type CalculationReceipt, type CalculationRequest } from '../runtime/calculator.ts';
import { selectFacts } from '../runtime/memory.ts';
import { WorkspaceImportCandidateService } from '../runtime/workspace-import-candidate.ts';
import { canonicalInterchangeJson, captureWorkspaceInterchange, compareRecalculatedReceipt, interchangeDigest, readHistoricalWorkspaceState } from '../runtime/workspace-interchange.ts';
import { WorkspaceActivationHost, type AuthenticatedActivationCandidate, type WorkspaceActivationAuthority, type WorkspaceActivationCommit,
  type WorkspaceActivationPolicy, type WorkspaceActivationPorts, type WorkspaceActivationReadback } from '../runtime/workspace-activation.ts';
import { artifactsFor, deterministicShopState, emptyTarget, fixedTime, interchangeOwner, InterchangeFixtureStore } from './fixtures/workspace-interchange-fixture.ts';

// SOURCE PACKAGE FIXTURES ONLY. Actual AES-GCM in private memory, never a native Vault/Engine/filesystem transaction.
// No GUI, provider/model, database, scheduler, download, user vault mutation or real migration.
const code = (expected: string) => (error: unknown) => error instanceof ChausarError && error.code === expected;
const policy: WorkspaceActivationPolicy = { approvedSyntheticWorkspaceIds: ['workspace_synthetic_source'], allowedSyntheticSourceIds: ['demo-export'],
  budgets: { maxCandidateBytes: 8_000_000, maxArtifactBytes: 1_000_000, maxArtifacts: 64, maxFacts: 1000, maxRecords: 10_000 }, retentionDays: 90 };
type Cipher = { nonce: Buffer; tag: Buffer; body: Buffer };
function fixture(seed: State = deterministicShopState(), policyInput: WorkspaceActivationPolicy = policy) {
  let state = structuredClone(seed), target = emptyTarget();
  const key = randomBytes(32), activations = new Map<string, Cipher>(), consumed = new Set<string>();
  let held = false, ready = true, completeAccess = true, commits = 0, allocations = 0, assertions = 0;
  let onAssert: ((count: number) => void) | undefined, onCommit: (() => void) | undefined;
  let loseAck = false, unknownReadback = false, corruptReadback = false, canonicalStateReadback = false, guardReturn: unknown;
  const authority: WorkspaceActivationAuthority = { workspaceId: target.workspaceId,
    owner: { id: 'fresh_synthetic_owner', name: 'New synthetic owner', role: 'owner', active: true, epoch: 7, branches: ['*'] },
    context: { memberId: 'fresh_synthetic_owner', role: 'owner', epoch: 7, channel: 'desktop' },
    sessionAuthorityId: 'fresh_synthetic_session_authority', createdAt: fixedTime };
  function encrypt(text: string, aad: string): Cipher {
    const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, nonce); cipher.setAAD(Buffer.from(aad));
    return { nonce, body: Buffer.concat([cipher.update(text), cipher.final()]), tag: cipher.getAuthTag() };
  }
  function decrypt(cipher: Cipher, aad: string): string {
    const decipher = createDecipheriv('aes-256-gcm', key, cipher.nonce); decipher.setAAD(Buffer.from(aad)); decipher.setAuthTag(cipher.tag);
    return Buffer.concat([decipher.update(cipher.body), decipher.final()]).toString('utf8');
  }
  const capture = captureWorkspaceInterchange(state, artifactsFor(state));
  const candidate = new WorkspaceImportCandidateService({ source: () => ({ ready: true, inventory: capture.inventory }), target: () => target,
    assertCompleteRead: () => {} }).prepare(interchangeOwner, { text: canonicalInterchangeJson(capture.package), targetId: target.targetId });
  const initial: AuthenticatedActivationCandidate = { content: canonicalInterchangeJson(candidate),
    pin: { format: 'chausar.interchange-custody-pin.v1', kind: 'candidate', recordId: 'candidate_fixture', creationId: 'creation_fixture',
      contextDigest: interchangeDigest(interchangeOwner), inventory: capture.inventory, packageDigest: candidate.packageDigest,
      candidateDigest: interchangeDigest(candidate), target: structuredClone(target) },
    measurement: { encrypted: true, archiveCiphertextBytes: 1, inventoryPinCiphertextBytes: 1, qualification: 'test-fixture' } };
  let archiveCipher = encrypt(initial.content, 'candidate_fixture:archive'), pinCipher = encrypt(JSON.stringify(initial.pin), 'candidate_fixture:pin');
  function candidateRead(): AuthenticatedActivationCandidate {
    return { content: decrypt(archiveCipher, 'candidate_fixture:archive'), pin: JSON.parse(decrypt(pinCipher, 'candidate_fixture:pin')),
      measurement: { encrypted: true, archiveCiphertextBytes: archiveCipher.body.length + 28, inventoryPinCiphertextBytes: pinCipher.body.length + 28, qualification: 'test-fixture' } };
  }
  function readback(activationId: string): WorkspaceActivationReadback {
    const ciphertext = activations.get(activationId);
    if (!ciphertext || unknownReadback) return { status: 'unknown', activationId, reasonCode: 'FIXTURE_UNKNOWN' };
    const publication = JSON.parse(decrypt(ciphertext, `activation:${activationId}`)) as WorkspaceActivationCommit;
    if (corruptReadback) publication.state.sessions.push({ id: 'carried_old_session' });
    if (canonicalStateReadback) { publication.state = JSON.parse(canonicalInterchangeJson(publication.state)); publication.record.stateDigest = hash(publication.state); }
    return { status: 'committed', encrypted: true, qualification: 'test-fixture', ciphertextBytes: ciphertext.body.length + 28, ...publication };
  }
  const ports: WorkspaceActivationPorts = {
    custody: { async read(_ctx, candidateId) { assert.equal(candidateId, initial.pin.recordId); return candidateRead(); } },
    async withTransaction(context, input, work) {
      assert.equal(held, false); held = true;
      assert.equal(input.targetId, target.targetId); assert.equal(input.candidateId, initial.pin.recordId);
      const stateFence = interchangeDigest(state), targetFence = interchangeDigest(target), recordFence = interchangeDigest(candidateRead());
      const sourceCurrent = async () => {
        assert.equal(held, true);
        if (interchangeDigest(state) !== stateFence) throw new ChausarError('INTERCHANGE_AUTHORITY_CHANGED', 'Fixture source changed during held transaction.');
        if (!ready) throw new ChausarError('INTERCHANGE_NOT_READY', 'Fixture consumers are not currently ready.');
      };
      try {
        const result = await work({ source: { ready, state: structuredClone(state), artifacts: artifactsFor(state),
          async assertCompleteOwner(ctx, historical) {
            assert.equal(held, true); assert.equal(ctx.memberId, context.memberId); assert.equal(historical.workspace.id, state.workspace.id);
            if (!completeAccess) throw new ChausarError('INTERCHANGE_READ_SCOPE_REQUIRED', 'Fixture all-row access revoked.');
            await sourceCurrent(); return guardReturn as void;
          }, assertCurrent: sourceCurrent }, target: structuredClone(target), async readCandidate() { assert.equal(held, true); return candidateRead(); },
          async assertCurrent() {
            assertions++; onAssert?.(assertions); await sourceCurrent();
            if (interchangeDigest(target) !== targetFence) throw new ChausarError('INTERCHANGE_TARGET_CHANGED', 'Fixture physical target identity or generation changed.');
            if (interchangeDigest(candidateRead()) !== recordFence) throw new ChausarError('INTERCHANGE_REVIEW_CHANGED', 'Fixture independent candidate issuance changed.');
          },
          async allocateAuthority() { assert.equal(held, true); allocations++; return structuredClone(authority); },
          async commit(publication) {
            assert.equal(held, true); await sourceCurrent();
            if (interchangeDigest(target) !== targetFence) throw new ChausarError('INTERCHANGE_TARGET_CHANGED', 'Fixture target changed before commit.');
            if (consumed.has(publication.record.candidateCreationId) || activations.has(publication.record.activationId)) throw new ChausarError('ACTIVATION_SINGLE_USE', 'Fixture durable candidate and activation IDs are single-use.');
            consumed.add(publication.record.candidateCreationId);
            activations.set(publication.record.activationId, encrypt(JSON.stringify(publication), `activation:${publication.record.activationId}`));
            commits++; onCommit?.();
            if (loseAck) throw new Error('Fixture lost acknowledgement after durable commit.');
          }, async readback() { assert.equal(held, true); return readback([...activations.keys()].at(-1)!); } });
        await sourceCurrent(); return result;
      } finally { held = false; }
    },
    async readback(context, input) { assert.equal(held, false); authorize(new InterchangeFixtureStore(state), context, 'admin'); return readback(input.activationId); },
  };
  const host = () => new WorkspaceActivationHost(ports, policyInput);
  const request = { candidateId: initial.pin.recordId, reviewedDigest: initial.pin.kind === 'candidate' ? initial.pin.candidateDigest : '' };
  return { host, ports, authority, request, candidateRead, readback, state: () => structuredClone(state), target: () => structuredClone(target),
    mutateState: (change: (value: State) => void) => change(state), mutateTarget: (change: (value: ReturnType<typeof emptyTarget>) => void) => change(target),
    replaceCandidate: (change: (value: AuthenticatedActivationCandidate) => void) => { const value = candidateRead(); change(value); archiveCipher = encrypt(value.content, 'candidate_fixture:archive'); pinCipher = encrypt(JSON.stringify(value.pin), 'candidate_fixture:pin'); },
    setReady: (value: boolean) => { ready = value; }, setAccess: (value: boolean) => { completeAccess = value; },
    onAssert: (hook: (count: number) => void) => { onAssert = hook; }, onCommit: (hook: () => void) => { onCommit = hook; },
    setLoseAck: () => { loseAck = true; }, setUnknown: (value: boolean) => { unknownReadback = value; }, setCorrupt: () => { corruptReadback = true; },
    setCanonicalState: () => { canonicalStateReadback = true; },
    setGuardReturn: (value: unknown) => { guardReturn = value; }, counts: () => ({ commits, allocations, held }),
    corruptCiphertext: () => { archiveCipher.body[0] ^= 1; } };
}
async function reviewed(f: ReturnType<typeof fixture>) { return f.host().review(interchangeOwner, f.request); }
async function activate(f: ReturnType<typeof fixture>, activationId = 'activation_fixture') {
  const review = await reviewed(f);
  return f.host().activate(interchangeOwner, { ...f.request, projectionDigest: review.projectionDigest, activationId, confirmed: true });
}

test('fixture activation keeps complete encrypted history inert and issues fresh owner/session authority', async () => {
  const source = deterministicShopState();
  for (const name of ['sessions', 'routes', 'plugins', 'jobs', 'actions', 'schedules', 'decisions', 'modelReceipts', 'conversations'] as const) source[name].push({ id: `historical_${name}`, approved: true, status: 'ready', token: 'old_bearer' });
  source.sourceRules.push({ id: 'old_grant', sourceId: 'demo-export', memberIds: ['owner'], roles: ['owner'], allow: true });
  const f = fixture(source), review = await reviewed(f), result = await activate(f);
  assert.equal(result.qualification, 'test-fixture'); assert.deepEqual(result.ownerContext, f.authority.context);
  assert.equal(result.sessionAuthorityId, f.authority.sessionAuthorityId); assert.deepEqual(review.inertSourceRuleIds, ['old_grant']);
  const read = f.readback(result.activationId); assert.equal(read.status, 'committed'); if (read.status !== 'committed') return;
  assert.equal(read.evidence.content, f.candidateRead().content); assert.deepEqual(read.evidence.pin, f.candidateRead().pin);
  assert.deepEqual(read.state.facts, source.facts); assert.deepEqual(read.state.ontology, source.ontology); assert.deepEqual(read.state.imports, source.imports);
  assert.equal(read.state.workspace.id, f.target().workspaceId); assert.notEqual(read.state.workspace.id, source.workspace.id);
  for (const name of ['sessions', 'routes', 'plugins', 'jobs', 'actions', 'schedules', 'decisions', 'modelReceipts', 'conversations', 'receipts', 'answers'] as const) assert.deepEqual(read.state[name], []);
  assert.deepEqual(read.state.sourceRules, []); assert.equal(read.state.policy.send, 'nothing'); assert.equal(read.state.policy.autonomy, false);
  assert.throws(() => authorize(new InterchangeFixtureStore(read.state), interchangeOwner), code('ACCESS_REVOKED'));
  assert.deepEqual(await f.host().resolve(interchangeOwner, { activationId: result.activationId }), result);
  assert.deepEqual(f.counts(), { commits: 1, allocations: 1, held: false });
});

test('fixture target activation and restarted host produce three new business-equivalent receipts under fresh authority', async () => {
  const sourceStore = new InterchangeFixtureStore(deterministicShopState());
  const requests: CalculationRequest[] = ['billed', 'received', 'earned'].map(operation => ({ operation, sourceIds: ['demo-export'], period: { from: '2026-09-01', to: '2026-09-30' }, asOf: fixedTime }));
  const answers = ['300000', '260000', '250000'], originals: CalculationReceipt[] = [];
  for (const request of requests) originals.push(await new CalculatorService(sourceStore).calculate(interchangeOwner, request));
  const f = fixture(sourceStore.read()), activation = await activate(f), retained = f.readback(activation.activationId);
  assert.equal(retained.status, 'committed'); if (retained.status !== 'committed') return;
  const targetStore = new InterchangeFixtureStore(retained.state), calculator = new CalculatorService(targetStore);
  for (let index = 0; index < requests.length; index++) {
    const receipt = await calculator.calculate(activation.ownerContext, requests[index]);
    assert.equal(receipt.totalMinor, answers[index]); assert.notEqual(receipt.id, originals[index].id);
    // Fresh authority is an intentional difference. Every remaining semantic field must compare exactly.
    assert.deepEqual(compareRecalculatedReceipt(originals[index], receipt).changedFields.sort(), ['epoch', 'memberId']);
    const reauthorized = { ...originals[index], memberId: activation.ownerContext.memberId, epoch: activation.ownerContext.epoch };
    assert.equal(compareRecalculatedReceipt(reauthorized, receipt).equivalent, true);
    assert.throws(() => calculator.receipt(interchangeOwner, receipt.id), code('ACCESS_REVOKED'));
  }
  const restartedHost = f.host(); assert.equal((await restartedHost.resolve(interchangeOwner, { activationId: activation.activationId })).status, 'committed');
  const restartedStore = new InterchangeFixtureStore(JSON.parse(JSON.stringify(targetStore.read())));
  for (let index = 0; index < requests.length; index++) {
    const receipt = await new CalculatorService(restartedStore).calculate(activation.ownerContext, requests[index]);
    assert.equal(receipt.totalMinor, answers[index]);
    assert.equal(compareRecalculatedReceipt({ ...originals[index], memberId: activation.ownerContext.memberId, epoch: activation.ownerContext.epoch }, receipt).equivalent, true);
  }
});

test('fixture explicit knowledge cuts preserve correction order, source precedence, merge undo and tombstones', async () => {
  const source = deterministicShopState();
  const original = source.facts[0], historical = { ...structuredClone(original), id: 'older_invoice', learnedAt: '2026-09-20T00:00:00.000Z', supersededAt: fixedTime, fields: { ...original.fields, amountMinor: '90000' } };
  source.facts.unshift(historical);
  source.facts.push({ ...structuredClone(original), id: 'equal_time_later', fields: { ...original.fields, amountMinor: '100000' } });
  source.sourceRules.push({ id: 'precedence', kind: original.kind, sourceIds: ['demo-export'], at: '2026-09-23T00:00:00.000Z', by: 'owner' });
  source.sourceRules.push({ id: 'agreement', kind: 'unused_kind', sourceIds: [], at: fixedTime, by: 'owner' });
  source.merges.push({ id: 'customer_merge', type: 'merge', entityIds: ['c1', 'c2'], targetId: 'c1', at: '2026-09-24T00:00:00.000Z', by: 'owner' },
    { id: 'customer_undo', type: 'undo', mergeId: 'customer_merge', at: '2026-09-26T00:00:00.000Z', by: 'owner' });
  source.tombstones.push({ id: 'old_deletion', factId: 'unused_deleted_fact', deletedAt: fixedTime });
  const f = fixture(source), activated = await activate(f), read = f.readback(activated.activationId); if (read.status !== 'committed') return;
  assert.deepEqual(read.state.sourceRules, source.sourceRules); assert.deepEqual(read.state.merges, source.merges); assert.deepEqual(read.state.tombstones, source.tombstones);
  assert.equal(JSON.stringify(read.state.ontology), JSON.stringify(source.ontology));
  assert.equal(JSON.stringify(read.state.facts), JSON.stringify(source.facts));
  for (const asOf of ['2026-09-21T00:00:00.000Z', '2026-09-25T00:00:00.000Z', fixedTime]) {
    assert.deepEqual(selectFacts(new InterchangeFixtureStore(read.state), activated.ownerContext, { asOf }), selectFacts(new InterchangeFixtureStore(source), interchangeOwner, { asOf }));
    const request = { operation: 'billed', asOf, period: { from: '2026-09-01', to: '2026-09-30' } };
    const before = await new CalculatorService(new InterchangeFixtureStore(source)).calculate(interchangeOwner, request);
    const after = await new CalculatorService(new InterchangeFixtureStore(read.state)).calculate(activated.ownerContext, request);
    assert.equal(compareRecalculatedReceipt({ ...before, memberId: activated.ownerContext.memberId, epoch: activated.ownerContext.epoch }, after).equivalent, true);
  }
});

test('fixture admission refuses labels, managed imports, source scope and unreviewed policy', async t => {
  await t.test('demo and synthetic source labels do not approve an unknown workspace identity', async () => {
    const state = deterministicShopState(); state.workspace.id = 'unapproved_synthetic_label';
    await assert.rejects(() => reviewed(fixture(state)), code('ACTIVATION_SYNTHETIC_ONLY'));
  });
  await t.test('legacy-looking connector metadata does not bypass managed gates', async () => {
    const state = deterministicShopState(); state.imports[0].type = 'connector-capture-v1';
    const recipe = artifactsFor(state).artifacts.find(item => item.category === 'mapping-recipes')!;
    state.imports[0].recipeHash = interchangeDigest(JSON.parse(Buffer.from(recipe.bytes).toString('utf8')));
    await assert.rejects(() => reviewed(fixture(state)), code('ACTIVATION_MANAGED_SOURCE'));
  });
  await t.test('unapproved source refuses entire activation without a scope cut', async () => {
    const state = deterministicShopState(); state.facts[0].sourceId = 'unapproved_source';
    await assert.rejects(() => reviewed(fixture(state)), code('ACTIVATION_SOURCE_PROFILE'));
  });
  await t.test('runtime typed records cannot masquerade as legacy inputs', async () => {
    const state = deterministicShopState(); state.imports[0].type = 'engine-semantic-evidence-v1';
    await assert.rejects(() => reviewed(fixture(state)), code('ACTIVATION_LEGACY_IMPORT'));
  });
  await t.test('import-only sources also require current access', async () => {
    const state = deterministicShopState(); state.imports.push({ ...structuredClone(state.imports[0]), id: 'blocked_import_only', sourceId: 'blocked_empty_source', rowIds: [] });
    state.policy.allowedSources = ['demo-export'];
    const f = fixture(state, { ...policy, allowedSyntheticSourceIds: ['demo-export', 'blocked_empty_source'] });
    await assert.rejects(() => reviewed(f), code('SOURCE_REVOKED')); assert.equal(f.counts().commits, 0);
  });
  await t.test('even authenticated dictionaries require a supported compiler catalogue', async () => {
    const state = deterministicShopState(); state.ontology.current.operations[0].type = 'unsupported_operation';
    const { hash: _oldHash, ...content } = state.ontology.current; state.ontology.current.hash = hash(content);
    await assert.rejects(() => reviewed(fixture(state)), code('ACTIVATION_DICTIONARY'));
  });
  await t.test('changed fresh retention policy changes acknowledged projection', async () => {
    const f = fixture(), review = await reviewed(f);
    const changedHost = new WorkspaceActivationHost(f.ports, { ...policy, retentionDays: 30 });
    await assert.rejects(() => changedHost.activate(interchangeOwner, { ...f.request, projectionDigest: review.projectionDigest, activationId: 'activation_changed_policy', confirmed: true }), code('ACTIVATION_PROJECTION_CHANGED'));
    assert.equal(f.counts().commits, 0);
  });
});

test('fixture exact acknowledgement and changing fences refuse before publication', async t => {
  for (const [name, change, expected] of [
    ['current source inventory', (f: ReturnType<typeof fixture>) => f.mutateState(s => { s.workspace.name = 'source_changed'; }), 'INTERCHANGE_AUTHORITY_CHANGED'],
    ['reserved target generation', (f: ReturnType<typeof fixture>) => f.mutateTarget(target => { target.generation = 'changed_generation'; }), 'INTERCHANGE_TARGET_CHANGED'],
    ['consumer readiness', (f: ReturnType<typeof fixture>) => f.setReady(false), 'INTERCHANGE_NOT_READY'],
    ['complete row access', (f: ReturnType<typeof fixture>) => f.setAccess(false), 'INTERCHANGE_READ_SCOPE_REQUIRED'],
  ] as const) await t.test(name, async () => {
    const f = fixture(), review = await reviewed(f); change(f);
    await assert.rejects(() => f.host().activate(interchangeOwner, { ...f.request, projectionDigest: review.projectionDigest, activationId: 'activation_changed', confirmed: true }), code(expected));
    assert.equal(f.counts().commits, 0);
  });
  await t.test('target replacement during a held precommit fence', async () => {
    const f = fixture(), review = await reviewed(f); f.onAssert(() => f.mutateTarget(target => { target.generation = 'replaced_under_lock'; }));
    await assert.rejects(() => f.host().activate(interchangeOwner, { ...f.request, projectionDigest: review.projectionDigest, activationId: 'activation_race', confirmed: true }), code('INTERCHANGE_TARGET_CHANGED'));
    assert.equal(f.counts().commits, 0);
  });
  await t.test('review digest and explicit confirmation are exact', async () => {
    const f = fixture(), review = await reviewed(f);
    await assert.rejects(() => f.host().activate(interchangeOwner, { ...f.request, reviewedDigest: '0'.repeat(64), projectionDigest: review.projectionDigest, activationId: 'activation_bad_digest', confirmed: true }), code('INTERCHANGE_REVIEW_CHANGED'));
    await assert.rejects(() => f.host().activate(interchangeOwner, { ...f.request, projectionDigest: review.projectionDigest, activationId: 'activation_no_confirmation', confirmed: false as unknown as true }), code('CONFIRMATION_REQUIRED'));
    assert.equal(f.counts().commits, 0);
  });
});

test('fixture restart preserves single-use and explicit unknown-commit resolution never retries', async () => {
  const f = fixture(), review = await reviewed(f); f.setLoseAck();
  const input = { ...f.request, projectionDigest: review.projectionDigest, activationId: 'activation_lost_ack', confirmed: true as const };
  await assert.rejects(() => f.host().activate(interchangeOwner, input), code('ACTIVATION_COMMIT_UNKNOWN'));
  assert.equal(f.counts().commits, 1);
  f.setUnknown(true);
  assert.deepEqual(await f.host().resolve(interchangeOwner, { activationId: input.activationId }), { status: 'unknown', activationId: input.activationId, reasonCode: 'FIXTURE_UNKNOWN' });
  assert.equal(f.counts().commits, 1); f.setUnknown(false);
  const recovered = await f.host().resolve(interchangeOwner, { activationId: input.activationId }); assert.equal(recovered.status, 'committed');
  await assert.rejects(() => f.host().activate(interchangeOwner, input), code('ACTIVATION_COMMIT_UNKNOWN'));
  await assert.rejects(() => f.host().activate(interchangeOwner, { ...input, activationId: 'different_activation_replay' }), code('ACTIVATION_COMMIT_UNKNOWN'));
  assert.equal(f.counts().commits, 1);
  const persisted = f.readback(input.activationId); if (persisted.status !== 'committed') return;
  const candidate = JSON.parse(persisted.evidence.content); assert.equal(candidate.inert, true);
  assert.deepEqual(readHistoricalWorkspaceState(candidate.archive), f.state());
});

test('fixture corrupt readback or lease-exit failure leaves publication unresolved with no cleanup/retry', async t => {
  await t.test('exact encrypted readback cannot attach an old session', async () => {
    const f = fixture(); f.onCommit(() => f.setCorrupt());
    await assert.rejects(() => activate(f), code('ACTIVATION_COMMIT_UNKNOWN')); assert.equal(f.counts().commits, 1);
    await assert.rejects(() => f.host().resolve(interchangeOwner, { activationId: 'activation_fixture' }), code('ACTIVATION_READBACK'));
  });
  await t.test('authority change on lease exit is unknown even after successful commit', async () => {
    const f = fixture(); f.onCommit(() => f.mutateState(state => { state.revision++; }));
    await assert.rejects(() => activate(f), code('ACTIVATION_COMMIT_UNKNOWN')); assert.equal(f.counts().commits, 1);
  });
  await t.test('consistent canonical hashes cannot hide reordered semantic keys on restart', async () => {
    const f = fixture(), result = await activate(f); f.setCanonicalState();
    await assert.rejects(() => f.host().resolve(interchangeOwner, { activationId: result.activationId }), code('ACTIVATION_READBACK'));
    assert.equal(f.counts().commits, 1);
  });
});

test('fixture malformed authority, missing ports, budgets, taint and guard values fail closed', async t => {
  await t.test('fresh owner cannot reuse historical owner tuple', async () => {
    const f = fixture(); f.authority.owner.id = 'owner'; f.authority.context.memberId = 'owner';
    await assert.rejects(() => activate(f), code('ACTIVATION_AUTHORITY')); assert.equal(f.counts().commits, 0);
  });
  await t.test('root constructor ports and budgets are mandatory', () => {
    assert.throws(() => new WorkspaceActivationHost({} as WorkspaceActivationPorts, policy), code('ACTIVATION_ROOT_REQUIRED'));
    const f = fixture(); assert.throws(() => new WorkspaceActivationHost(f.ports, { ...policy, budgets: { ...policy.budgets, maxFacts: 0 } }), code('ACTIVATION_POLICY'));
  });
  await t.test('budgets refuse the complete archive without truncation', async () => {
    await assert.rejects(() => reviewed(fixture(undefined, { ...policy, budgets: { ...policy.budgets, maxFacts: 1 } })), code('ACTIVATION_LIMIT'));
  });
  await t.test('boolean guard admission is refused', async () => {
    const f = fixture(); f.setGuardReturn(true); await assert.rejects(() => reviewed(f), code('ACTIVATION_GUARD'));
  });
  await t.test('source-tainted context cannot review', async () => {
    const f = fixture(); await assert.rejects(() => f.host().review({ ...interchangeOwner, sourceTainted: true }, f.request), code('INTERCHANGE_CONTEXT_CHANGED'));
  });
  await t.test('ciphertext modification is not an authenticated candidate', async () => {
    const f = fixture(); f.corruptCiphertext(); await assert.rejects(() => reviewed(f)); assert.equal(f.counts().commits, 0);
  });
});
