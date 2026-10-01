import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile, readdir, realpath, unlink, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {readHistoricalWorkspaceState, retainedArtifactBytes} from '../runtime/workspace-interchange.ts';
import type {WorkspaceImportCandidate} from '../runtime/workspace-interchange-contracts.ts';
import type {CalculationReceipt, CalculationRequest} from '../runtime/calculator.ts';
import type {WorkspaceActivationSummary} from '../runtime/workspace-activation.ts';
import {A, B, PERIOD, OLD_CUT, CURRENT_CUT, IDS, SOURCE_PASSWORD, TARGET_PASSWORD,
  SECRET, artifactId, assertArchiveInventory, encryptedFiles, fixture, publicMetadata, sha,
  type Http} from './fixtures/workspace-activation-independent-acceptance.ts';

// Source-pinned independent public acceptance. Host Node only, real HTTP/Vault
// and create-only physical target publication. No private port mocks or GUI.
const historyStores = ['receipts', 'answers', 'decisions', 'actions', 'jobs', 'learning', 'plugins',
  'modelReceipts', 'activity', 'conversations', 'routes', 'sessions', 'unsupported', 'schedules'] as const;
const goldens: {request: CalculationRequest; expected: string; entities?: string[]}[] = [
  {request: {operation: 'billed', sourceIds: [A], branch: 'main', period: PERIOD, asOf: OLD_CUT}, expected: '1000', entities: ['00017']},
  {request: {operation: 'billed', sourceIds: [A], branch: 'main', period: PERIOD, asOf: CURRENT_CUT}, expected: '1500', entities: ['00017']},
  {request: {operation: 'received', sourceIds: [A], branch: 'main', period: PERIOD, asOf: CURRENT_CUT}, expected: '7000', entities: ['P1']},
  {request: {operation: 'earned', sourceIds: [A], branch: 'main', period: PERIOD, asOf: CURRENT_CUT}, expected: '12500', entities: ['S1']},
  {request: {operation: 'costs', sourceIds: [A], branch: 'main', period: PERIOD, asOf: CURRENT_CUT}, expected: '3000', entities: ['C1']},
  {request: {operation: 'margin', sourceIds: [A], branch: 'main', period: PERIOD, asOf: CURRENT_CUT}, expected: '9500'},
  {request: {operation: 'billed', sourceIds: [A], period: PERIOD, asOf: CURRENT_CUT}, expected: '5500', entities: ['00017', 'I2']},
  {request: {operation: 'billed', sourceIds: [A], branch: 'main', asOf: CURRENT_CUT},
    expected: (900719925474099325n + 1500n).toString(), entities: ['00017', 'HUGE']},
  {request: {operation: 'billed', sourceIds: [A, B], branch: 'main', period: PERIOD, asOf: CURRENT_CUT},
    expected: '10500', entities: ['00017', 'B1']},
];

function golden(receipt: CalculationReceipt, index: number, owner: WorkspaceActivationSummary['ownerContext'], dictionaryHash: string) {
  const value = goldens[index];
  assert.equal(receipt.totalMinor, value.expected); assert.equal(receipt.asOf, value.request.asOf);
  assert.equal(receipt.branch, value.request.branch ?? null); assert.deepEqual(receipt.period, value.request.period ?? null);
  assert.equal(receipt.dictionaryHash, dictionaryHash); assert.equal(receipt.memberId, owner.memberId); assert.equal(receipt.epoch, owner.epoch);
  assert.equal(receipt.stale, false); assert.equal(receipt.restatement, undefined);
  assert.deepEqual(receipt.requestedSourceIds, value.request.sourceIds);
  if (value.entities) assert.deepEqual(receipt.rows.map(row => row.entityId).sort(), [...value.entities].sort());
  if (receipt.operation === 'billed') assert.ok(receipt.rows.every(row => row.measureField === 'taxMinor'));
  assert.equal(receipt.coverage.completeness, [1, 6, 7, 8].includes(index) ? 'unreconciled-facts' : 'reconciled-imports',
    'A genuinely corrected fact lacks an original import row binding and must keep its honest coverage warning.');
  if (receipt.operation === 'margin') assert.ok(receipt.figures.some(figure => figure.key === 'marginBps'
    && figure.minor === '7600' && figure.unit === 'basis-points'));
}

async function runGoldens(app: Http, owner: WorkspaceActivationSummary['ownerContext'], dictionaryHash: string, seen: Set<string>) {
  const receipts: CalculationReceipt[] = [];
  for (let index = 0; index < goldens.length; index++) {
    const receipt = await app.rpc<CalculationReceipt>('calculation.run', goldens[index].request);
    golden(receipt, index, owner, dictionaryHash); assert.equal(seen.has(receipt.id), false); seen.add(receipt.id);
    assert.deepEqual(await app.rpc('receipts.get', {id: receipt.id}), receipt); receipts.push(receipt);
  }
  const answered = await app.rpc('conversation.ask', {question: 'What was billed?', sourceIds: [A], branch: 'main',
    period: PERIOD, asOf: CURRENT_CUT});
  assert.equal(answered.supported, true); golden(answered.receipt, 1, owner, dictionaryHash);
  assert.equal(seen.has(answered.receipt.id), false); seen.add(answered.receipt.id);
  assert.deepEqual(await app.rpc('receipts.get', {id: answered.receipt.id}), answered.receipt); receipts.push(answered.receipt);
  return receipts;
}

test('independent real public archive preserves every issued private artifact and activates exact corrected business goldens across a new Engine',
  {timeout: 240_000}, async t => {
    const f = await fixture(t);
    assertArchiveInventory(f.archiveText, f.original);
    for (const input of f.inputs) {
      const imported = f.historical.imports.find(item => item.sourceId === input.sourceId);
      assert.ok(imported); assert.equal(imported.retainedInput.version, 1); assert.equal(imported.retainedInput.generation, 1);
      assert.equal(imported.retainedInput.input.content, input.content); assert.deepEqual(imported.retainedInput.input.recipe, input.recipe);
    }
    assert.equal(f.original.artifacts.filter(item => item.ref.purpose === 'private-trial').length, 4,
      'Actual evaluated trial contributes fork/binding/evaluation; actual discarded trial contributes tombstone.');
    assert.ok(f.original.artifacts.some(item => item.ref.id === artifactId('wic', IDS.material, 'archive')));
    assert.ok(f.original.artifacts.some(item => item.ref.id === artifactId('wic', 'independent_discarded_export', 'commit')));
    assert.deepEqual(await readdir(join(f.directory, IDS.inert)), ['backup.inert.json']);
    const inertText = await readFile(join(f.directory, IDS.inert, 'backup.inert.json'), 'utf8');
    assert.equal(JSON.parse(inertText).content, f.archiveText);
    const readInert = await f.source.rpc('workspace.backup.v2.readRestored', {backupId: IDS.backup, targetId: IDS.inert,
      creationId: f.inert.creationId, reviewedDigest: f.made.archiveDigest});
    publicMetadata(readInert); assert.deepEqual(readInert.receipt, f.inert);
    const prepared = await f.prepare();
    assert.equal(prepared.bridge.scope, 'authority-and-all-typed-private-artifacts'); assert.equal(prepared.bridge.fullWorkspacePortable, false);
    assert.deepEqual(prepared.bridge.namespaces, f.reviewed.sourcePin.namespaces);
    assert.deepEqual(prepared.bridge.externalKeyRequirements, f.reviewed.sourcePin.externalKeyRequirements);
    const retained = await f.journal.readArtifact({id: artifactId('wac', IDS.candidate, 'archive'), purpose: 'workspace-interchange'});
    const candidateText = (retained.value as {content: string}).content, candidate = JSON.parse(candidateText) as WorkspaceImportCandidate;
    assert.deepEqual(readHistoricalWorkspaceState(candidate.archive), f.historical);
    const proof = candidate.archive.artifacts.find(item => item.manifest.id === 'backup_activation_provenance_v1'); assert.ok(proof);
    const provenance = JSON.parse(retainedArtifactBytes(proof).toString('utf8'));
    assert.equal(provenance.backup.content, f.archiveText); assert.equal(provenance.inert.content, f.archiveText);
    assertArchiveInventory(provenance.backup.content, f.original);
    assert.deepEqual(provenance.backup.pin.sourcePin, f.reviewed.sourcePin);
    const ciphertextBefore = await encryptedFiles(f.source.engine.vault!.directory);
    f.install({...f.policy, allowedSyntheticSourceIds: [A]}); await f.reattach();
    await f.source.refuse('workspace.activation.review', {candidateId: IDS.candidate, reviewedDigest: prepared.bridge.reviewedDigest}, ['ACTIVATION_SOURCE_PROFILE']);
    assert.deepEqual(await readdir(join(f.directory, IDS.target)), []);
    f.install(); await f.reattach();
    await f.source.refuse('workspace.activation.execute', {...prepared.execute, projectionDigest: '0'.repeat(64)}, ['ACTIVATION_PROJECTION_CHANGED']);
    await f.source.refuse('workspace.activation.execute', {...prepared.execute, confirmed: false}, ['CONFIRMATION_REQUIRED']);
    assert.deepEqual(await encryptedFiles(f.source.engine.vault!.directory), ciphertextBefore);
    const committed = await f.source.rpc<WorkspaceActivationSummary>('workspace.activation.execute', prepared.execute); publicMetadata(committed);
    assert.equal(committed.status, 'committed'); assert.equal(committed.qualification, 'encrypted-local-host');
    assert.notEqual(committed.workspaceId, f.historical.workspace.id); assert.notEqual(committed.ownerContext.memberId, 'owner');
    assert.deepEqual(f.source.engine.vault!.read(), f.historical);
    assert.deepEqual(await encryptedFiles(f.source.engine.vault!.directory), ciphertextBefore);
    const sourceToken = f.source.token, target = await f.target();
    for (const option of ['gateway', 'sync', 'durableJobs', 'connectorCredentials', 'connectorRuntime', 'workspaceActivation'] as const) {
      assert.equal(target.engine.options[option], undefined);
    }
    await target.rpc('workspace.open', {passphrase: TARGET_PASSWORD});
    const fresh = target.engine.vault!.read(); assert.equal(fresh.revision, 0); assert.notEqual(target.engine.vault!.vaultId, f.original.vaultId);
    assert.equal(fresh.members.length, 1); assert.equal(fresh.members[0].id, committed.ownerContext.memberId);
    assert.deepEqual(fresh.policy, {send: 'nothing', autonomy: false, sharing: false, allowedSources: [A, B], retentionDays: 90});
    for (const store of ['ontology', 'facts', 'imports', 'conflicts', 'merges', 'tombstones', 'sourceRules'] as const) assert.deepEqual(fresh[store], f.historical[store]);
    for (const store of historyStores) assert.deepEqual(fresh[store], [], `Historical ${store} must stay inert.`);
    for (const purpose of ['private-trial', 'workspace-interchange'] as const) assert.deepEqual(await target.engine.vault!.listArtifacts({purpose}), []);
    const sourceEnvelope = JSON.parse(Buffer.from(f.original.authority).toString('utf8'));
    const targetEnvelope = JSON.parse(await readFile(join(target.engine.vault!.directory, 'authority.encrypted.json'), 'utf8'));
    assert.notEqual(targetEnvelope.id, sourceEnvelope.id); assert.notDeepEqual(targetEnvelope.passphrase, sourceEnvelope.passphrase);
    assert.notDeepEqual(targetEnvelope.recovery, sourceEnvelope.recovery);
    const immutablePaths = ['activation-bootstrap.encrypted.json', 'activation-evidence.encrypted.json'];
    const immutable = await Promise.all(immutablePaths.map(path => readFile(join(f.directory, IDS.target, path))));
    assert.ok(immutable.every(bytes => !bytes.includes(Buffer.from(SECRET))));
    const oldReceipt = f.historical.receipts[0]; await target.refuse('receipts.get', {id: oldReceipt.id}, ['RECEIPT_NOT_FOUND']);
    const seen = new Set<string>(), first = await runGoldens(target, committed.ownerContext, f.published.hash, seen), firstToken = target.token;
    await f.close(target); await f.restart();
    const readback = await f.source.rpc<WorkspaceActivationSummary>('workspace.activation.get', {activationId: IDS.activation});
    const {ciphertextBytes: initialBytes, ...initialBinding} = committed, {ciphertextBytes: newBytes, ...newBinding} = readback;
    assert.deepEqual(newBinding, initialBinding); assert.ok(newBytes > initialBytes);
    const actualFiles = await Promise.all([...immutablePaths, join('live', 'main', 'authority.encrypted.json')]
      .map(path => readFile(join(f.directory, IDS.target, path))));
    assert.equal(newBytes, actualFiles.reduce((bytes, item) => bytes + item.length, 0));
    const restarted = await f.target(); assert.notEqual(restarted.token, firstToken); assert.notEqual(restarted.token, sourceToken);
    await restarted.rpc('workspace.open', {passphrase: TARGET_PASSWORD});
    for (const token of [sourceToken, firstToken, f.session.token]) {
      const result = await restarted.raw('workspace.status', {}, token); assert.equal(result.status, 401);
      assert.equal(result.body.error.code, 'UNAUTHENTICATED'); assert.equal(JSON.stringify(result.body).includes(token), false);
    }
    await restarted.rpc('workspace.lock');
    const oldCredential = await restarted.raw('workspace.open', {passphrase: SOURCE_PASSWORD});
    assert.notEqual(oldCredential.status, 200); assert.equal(oldCredential.body.error.code, 'UNLOCK_FAILED'); publicMetadata(oldCredential.body);
    await restarted.rpc('workspace.open', {passphrase: TARGET_PASSWORD});
    for (const receipt of first) assert.deepEqual(await restarted.rpc('receipts.get', {id: receipt.id}), receipt);
    const savedHistory = await restarted.rpc('trials.savedQuestions');
    assert.equal(savedHistory.length, 10); assert.ok(first.every(receipt => savedHistory.some((answer: any) => answer.receiptId === receipt.id)));
    const second = await runGoldens(restarted, committed.ownerContext, f.published.hash, seen);
    assert.equal(seen.size, 20); assert.equal(restarted.engine.vault!.read().receipts.length, 20);
    assert.deepEqual(restarted.engine.vault!.read().sessions, []); assert.deepEqual(restarted.engine.vault!.read().jobs, []);
    await f.close(restarted);
    const beforeReplay = await encryptedFiles(f.directory);
    await f.source.refuse('workspace.activation.execute', prepared.execute, ['ACTIVATION_SINGLE_USE', 'INTERCHANGE_TARGET_NOT_EMPTY', 'ACTIVATION_TARGET_NOT_EMPTY']);
    assert.deepEqual(await encryptedFiles(f.directory), beforeReplay);
    assert.deepEqual(await Promise.all(immutablePaths.map(path => readFile(join(f.directory, IDS.target, path)))), immutable);
    assert.equal(await readFile(join(f.directory, IDS.inert, 'backup.inert.json'), 'utf8'), inertText);
    assert.equal(((await f.journal.readArtifact(retained)).value as {content: string}).content, candidateText);
    assert.deepEqual(f.source.engine.vault!.read(), f.historical);
    t.diagnostic(JSON.stringify({qualification: 'synthetic-public-http-encrypted-host-node', originalArtifacts: f.original.artifacts.length,
      privateTrialArtifacts: 4, independentGoldenRequests: goldens.length, freshReceiptsBeforeRestart: first.length,
      freshReceiptsAfterRestart: second.length, originalAuthoritySha256: sha(f.original.authority), initialBytes, newBytes}));
  });

test('actual current source revocation refuses a reviewed activation before writes and stays refused after source/journal restart',
  {timeout: 180_000}, async t => {
    const f = await fixture(t), prepared = await f.prepare();
    await f.source.rpc('trust.update', {allowedSources: [A]});
    const state = f.source.engine.vault!.read(), before = await encryptedFiles(f.directory);
    await f.source.refuse('workspace.activation.execute', prepared.execute, ['SOURCE_REVOKED', 'INTERCHANGE_SOURCE_CHANGED', 'INTERCHANGE_INVENTORY_CHANGED', 'INTERCHANGE_AUTHORITY_CHANGED']);
    assert.deepEqual(await encryptedFiles(f.directory), before); assert.deepEqual(await readdir(join(f.directory, IDS.target)), []);
    assert.deepEqual(f.source.engine.vault!.read(), state);
    await f.restart(); const reopened = await encryptedFiles(f.directory);
    await f.source.refuse('workspace.activation.execute', prepared.execute, ['SOURCE_REVOKED', 'INTERCHANGE_SOURCE_CHANGED', 'INTERCHANGE_INVENTORY_CHANGED', 'INTERCHANGE_AUTHORITY_CHANGED']);
    assert.deepEqual(await encryptedFiles(f.directory), reopened); assert.deepEqual(await readdir(join(f.directory, IDS.target)), []);
    assert.equal(Object.keys(reopened).some(path => path.endsWith(`${artifactId('wal', IDS.activation, 'attempt')}.encrypted.json`)), false);
  });

test('real physical target occupation preserves bytes before commit and a late collision remains durably unknown without target adoption or replay',
  {timeout: 180_000}, async t => {
    const f = await fixture(t), prepared = await f.prepare(), targetDirectory = join(f.directory, IDS.target);
    const marker = join(targetDirectory, 'independent-occupied.txt'), bytes = Buffer.from('Synthetic independent target occupant 731902\n');
    assert.equal(dirname(await realpath(targetDirectory)), f.directory);
    await writeFile(marker, bytes, {flag: 'wx'});
    const before = await encryptedFiles(f.directory);
    await f.source.refuse('workspace.activation.execute', prepared.execute, ['BACKUP_ACTIVATION_TARGET_UNBOUND']);
    assert.deepEqual(await encryptedFiles(f.directory), before); assert.deepEqual(await readFile(marker), bytes);
    assert.deepEqual(await readdir(targetDirectory), ['independent-occupied.txt']);
    assert.equal(dirname(await realpath(marker)), targetDirectory); await unlink(marker);
    let credentialCalls = 0;
    f.install(f.policy, async () => {
      credentialCalls++;
      if (credentialCalls === 1) await writeFile(marker, bytes, {flag: 'wx'});
      return TARGET_PASSWORD;
    });
    await f.reattach();
    await f.source.refuse('workspace.activation.execute', prepared.execute, ['ACTIVATION_COMMIT_UNKNOWN']);
    assert.ok(credentialCalls >= 2); assert.deepEqual(await readFile(marker), bytes);
    assert.deepEqual(await readdir(targetDirectory), ['independent-occupied.txt']);
    const attempt = await f.journal.readArtifact({id: artifactId('wal', IDS.activation, 'attempt'), purpose: 'workspace-interchange'});
    const journal = attempt.value as any;
    assert.equal(journal.phase, 'prepared'); assert.equal(journal.record.activationId, IDS.activation);
    assert.equal(journal.record.candidateCreationId, prepared.bridge.candidateCreationId);
    const staging = join(f.directory, '.workspace-activation-control', 'staging', journal.staging.name);
    assert.deepEqual((await readdir(staging)).sort(), ['activation-bootstrap.encrypted.json', 'activation-evidence.encrypted.json', 'live'].sort());
    assert.equal(Object.keys(await encryptedFiles(staging)).length, 3);
    const retained = await encryptedFiles(f.directory);
    await f.source.refuse('workspace.activation.get', {activationId: IDS.activation}, ['BACKUP_ACTIVATION_TARGET_UNBOUND']);
    assert.deepEqual(await encryptedFiles(f.directory), retained);
    await f.restart();
    await f.source.refuse('workspace.activation.get', {activationId: IDS.activation}, ['BACKUP_ACTIVATION_TARGET_UNBOUND']);
    assert.deepEqual(await readFile(marker), bytes); assert.deepEqual(await encryptedFiles(f.directory), retained);
    assert.equal(dirname(await realpath(marker)), targetDirectory); await unlink(marker);
    const unknown = {status: 'unknown', activationId: IDS.activation, reasonCode: 'ACTIVATION_ATTEMPT_UNRESOLVED'};
    assert.deepEqual(await f.source.rpc('workspace.activation.get', {activationId: IDS.activation}), unknown);
    const beforeRetry = await encryptedFiles(f.directory);
    for (const activationId of [IDS.activation, 'independent_replacement_attempt']) {
      await f.source.refuse('workspace.activation.execute', {...prepared.execute, activationId}, ['ACTIVATION_COMMIT_UNKNOWN']);
      assert.deepEqual(await encryptedFiles(f.directory), beforeRetry); assert.deepEqual(await readdir(targetDirectory), []);
    }
    await f.restart();
    assert.deepEqual(await f.source.rpc('workspace.activation.get', {activationId: IDS.activation}), unknown);
    assert.deepEqual(await f.journal.readArtifact(attempt), attempt);
    assert.deepEqual(await encryptedFiles(f.directory), beforeRetry);
    t.diagnostic(JSON.stringify({qualification: 'real-physical-collision-public-unknown', phase: journal.phase,
      stagedCiphertexts: 3, publishedCiphertexts: 0, exactAndReplacementAttemptsRefused: 2}));
  });
