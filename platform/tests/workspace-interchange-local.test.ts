import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { lstat, mkdir, mkdtemp, readFile, realpath, readdir, rm, unlink, writeFile } from 'node:fs/promises';
import { hash } from '../runtime/contracts.ts';
import { demoCsv, demoRecipe } from '../runtime/ingest.ts';
import { Vault } from '../runtime/vault.ts';
import { WorkspaceInterchangeHost } from '../runtime/workspace-interchange-host.ts';
import { createWorkspaceInterchangeLocalPorts } from '../runtime/workspace-interchange-local.ts';
import { interchangeDigest, readHistoricalWorkspaceState, retainedArtifactBytes, inspectWorkspaceInterchange } from '../runtime/workspace-interchange.ts';
import { deterministicShopState, interchangeOwner } from './fixtures/workspace-interchange-fixture.ts';

const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const syntheticPassphrase = 'interchange synthetic fixture passphrase';
const code = (expected: string) => (error: any) => error?.code === expected;

async function fixture(t: TestContext) {
  const base = await realpath(tmpdir());
  if (process.platform === 'win32') assert.match(base, /^C:\\/i, 'Validate canonical C-drive scratch BEFORE creating fixture files.');
  const applicationDirectory = await realpath(await mkdtemp(join(base, 'chausar-interchange-local-')));
  assert.equal(dirname(applicationDirectory), base);
  const created = await Vault.create({ directory: join(applicationDirectory, 'source'), name: 'Synthetic custody fixture',
    passphrase: syntheticPassphrase, storage: 'experimental-file', demo: true });
  let vault = created.vault;
  await vault.update(draft => {
    const state = deterministicShopState(); state.workspace.id = draft.workspace.id;
    const input = { sourceId: 'demo-export', format: 'csv' as const, content: demoCsv, recipe: demoRecipe,
      expectedTotals: { rowCount: 10, amountMinor: '1230000' } };
    state.imports[0].retainedInput = { version: 1, generation: 1, input, digest: hash(input) };
    Object.assign(draft, state);
  });
  let guardCalls = 0;
  const local = () => createWorkspaceInterchangeLocalPorts({ vault, applicationDirectory, qualification: 'test-fixture',
    assertCompleteOwner: async () => { guardCalls++; } });
  const custody = local(); const host = new WorkspaceInterchangeHost(custody.ports);
  t.after(async () => {
    await vault.close();
    const actual = await realpath(applicationDirectory);
    assert.equal(dirname(actual), base); assert.match(actual.split(/[\\/]/).at(-1)!, /^chausar-interchange-local-/);
    await rm(actual, { recursive: true, force: true });
  });
  return { get vault() { return vault; }, applicationDirectory, custody, host, guardCalls: () => guardCalls,
    async reopen() {
      await vault.close(); vault = await Vault.open({ directory: join(applicationDirectory, 'source'), storage: 'experimental-file', passphrase: syntheticPassphrase });
      const reopened = local(); return { custody: reopened, host: new WorkspaceInterchangeHost(reopened.ports) };
    } };
}

test('actual encrypted Vault/FS custody preserves all stores, opaque managed backups, independent pins and a durable empty target', { timeout: 30_000 }, async t => {
  const f = await fixture(t), state = f.vault.read();
  await mkdir(join(f.vault.directory, 'reports'));
  const report = Buffer.from('synthetic retained report =1+1\r\nहिसाब');
  await writeFile(join(f.vault.directory, 'reports', 'draft.txt'), report);
  await mkdir(join(f.applicationDirectory, 'backups'));
  const backupName = `chausar-${state.workspace.id}-1.backup`;
  await f.vault.backup(join(f.applicationDirectory, 'backups', backupName));
  const before = f.vault.read();
  const exported = await f.host.export(interchangeOwner, { destinationId: 'export_one', confirmed: true });
  assert.equal(exported.custodyQualification, 'test-fixture'); assert.equal(exported.inventory.stores, 26);
  assert.ok(exported.bytes.archiveCiphertext > exported.bytes.wireUtf8); assert.ok(exported.bytes.inventoryPinCiphertext > 0);
  const retained = await f.custody.ports.custody.read(interchangeOwner, 'export_one');
  const archive = inspectWorkspaceInterchange(retained.content);
  assert.deepEqual(readHistoricalWorkspaceState(archive), before);
  assert.ok(archive.artifacts.some(item => item.manifest.category === 'report-files' && retainedArtifactBytes(item).equals(report)));
  const backup = await readFile(join(f.applicationDirectory, 'backups', backupName));
  assert.ok(archive.artifacts.some(item => item.manifest.category === 'other-retained' && retainedArtifactBytes(item).equals(backup)));
  const refs = await f.vault.listArtifacts({ purpose: 'workspace-interchange' });
  assert.equal(refs.length, 3, 'Archive, independent pin and final issuance binding are three separate authentic ciphertexts.');
  for (const ref of refs) {
    const path = join(f.vault.directory, 'private-artifacts', 'workspace-interchange', `${ref.id}.encrypted.json`);
    assert.equal((await lstat(path)).size, ref.diskBytes);
    const ciphertext = await readFile(path, 'utf8');
    assert.ok(!ciphertext.includes('synthetic retained report')); assert.ok(!ciphertext.includes('demo-export'));
  }
  const prepared = await f.host.prepare(interchangeOwner, { exportId: 'export_one', candidateId: 'candidate_one', targetId: 'empty_one' });
  assert.equal(prepared.inert, true); assert.equal(prepared.activation, 'root-only');
  assert.notEqual(prepared.target!.workspaceId, state.workspace.id);
  assert.deepEqual(await readdir(f.custody.targetPath('empty_one')), [], 'Target has zero stores, artifacts, authority or lock/control files.');
  const candidate = await f.custody.ports.custody.read(interchangeOwner, 'candidate_one');
  assert.equal(candidate.pin.kind, 'candidate');
  if (candidate.pin.kind === 'candidate') {
    assert.equal(candidate.pin.target.stores.length, 28); assert.ok(candidate.pin.target.stores.every(item => item.records === 0));
    assert.equal(candidate.pin.target.categoryCounts.length, 9); assert.ok(candidate.pin.target.categoryCounts.every(item => item.count === 0));
    assert.equal(candidate.pin.target.authorityRecords, 0);
  }
  const restarted = await f.reopen();
  const reviewed = await restarted.host.review(interchangeOwner, { candidateId: 'candidate_one', reviewedDigest: prepared.reviewedDigest });
  assert.deepEqual(reviewed, prepared); assert.deepEqual(f.vault.read(), before);
  const actualCost = restarted.custody.custodyMeasurement('candidate_one')!;
  assert.equal(actualCost.operation, 'read'); assert.ok(actualCost.bindingCiphertextBytes > 0);
  assert.equal(actualCost.totalRetainedCiphertextBytes, actualCost.archiveCiphertextBytes + actualCost.inventoryPinCiphertextBytes + actualCost.bindingCiphertextBytes);
  const diagnostic = restarted.custody.diagnostics()!;
  assert.equal(diagnostic.fullWorkspacePortabilityQualified, false); assert.ok(diagnostic.controlArtifactsExcluded >= 7);
  assert.ok(diagnostic.namespaceDispositions.some(item => item.namespace === 'private-artifacts/workspace-interchange'));
  assert.deepEqual(diagnostic.externalKeyCustodyDependencies, [`backups/${backupName}`]); assert.ok(diagnostic.measuredCaptureMs >= 0);
  assert.ok(f.guardCalls() > 10);
  t.diagnostic(JSON.stringify({ sourceOnly: true, nativeQualified: false, archiveCiphertextBytes: exported.bytes.archiveCiphertext,
    inventoryPinCiphertextBytes: exported.bytes.inventoryPinCiphertext, candidateCiphertextBytes: prepared.bytes.archiveCiphertext,
    measuredCaptureMs: diagnostic.measuredCaptureMs, stores: prepared.inventory.stores, artifacts: prepared.inventory.artifacts,
    reopenVerified: true, activation: false, fullWorkspacePortabilityQualified: false }));
});

test('discard authenticates both digests, revokes issuance before deletion and makes custody IDs durable single-use', async t => {
  const f = await fixture(t), summary = await f.host.export(interchangeOwner, { destinationId: 'single_use', confirmed: true });
  const retained = await f.custody.ports.custody.read(interchangeOwner, 'single_use');
  await assert.rejects(f.custody.ports.custody.remove(interchangeOwner, { recordId: 'single_use', expectedPinDigest: '0'.repeat(64),
    expectedContentDigest: interchangeDigest(retained.content) }), code('INTERCHANGE_REVIEW_CHANGED'));
  assert.deepEqual(await f.host.discard(interchangeOwner, { recordId: 'single_use', reviewedDigest: summary.reviewedDigest }), { discarded: true, recordId: 'single_use' });
  await assert.rejects(f.custody.ports.custody.read(interchangeOwner, 'single_use'), code('INTERCHANGE_CUSTODY_NOT_COMMITTED'));
  const refs = await f.vault.listArtifacts({ purpose: 'workspace-interchange' });
  assert.equal(refs.length, 1); assert.ok(refs[0].id.endsWith('_commit'));
  const tombstone = (await f.vault.readArtifact(refs[0])).value as any; assert.equal(tombstone.state, 'discarded');
  const measured = f.custody.custodyMeasurement('single_use')!;
  assert.equal(measured.state, 'discarded'); assert.equal(measured.totalRetainedCiphertextBytes, refs[0].diskBytes);
  assert.equal(measured.removedCiphertextBytes, summary.bytes.archiveCiphertext + summary.bytes.inventoryPinCiphertext);
  await assert.rejects(f.host.export(interchangeOwner, { destinationId: 'single_use', confirmed: true }), code('INTERCHANGE_OUTPUT_EXISTS'));
  const reopened = await f.reopen();
  await assert.rejects(reopened.host.export(interchangeOwner, { destinationId: 'single_use', confirmed: true }), code('INTERCHANGE_OUTPUT_EXISTS'));
});

test('root target allocation refuses unrelated pre-existing directories and detects every unexpected actual target entry', async t => {
  const f = await fixture(t);
  await f.host.export(interchangeOwner, { destinationId: 'export_target', confirmed: true });
  await mkdir(join(f.applicationDirectory, 'unrelated'));
  await assert.rejects(f.host.prepare(interchangeOwner, { exportId: 'export_target', candidateId: 'candidate_unrelated', targetId: 'unrelated' }), code('INTERCHANGE_TARGET_EXISTS'));
  assert.deepEqual(await readdir(join(f.applicationDirectory, 'unrelated')), []);
  const prepared = await f.host.prepare(interchangeOwner, { exportId: 'export_target', candidateId: 'candidate_target', targetId: 'target_actual' });
  const unexpected = join(f.custody.targetPath('target_actual'), 'user-work.txt'); await writeFile(unexpected, 'synthetic user work must stay');
  await assert.rejects(f.host.review(interchangeOwner, { candidateId: 'candidate_target', reviewedDigest: prepared.reviewedDigest }), code('INTERCHANGE_TARGET_NOT_EMPTY'));
  assert.equal(await readFile(unexpected, 'utf8'), 'synthetic user work must stay');
  await f.host.discard(interchangeOwner, { recordId: 'candidate_target', reviewedDigest: prepared.reviewedDigest });
  assert.equal(await readFile(unexpected, 'utf8'), 'synthetic user work must stay');
});

test('missing legacy originals, altered hashes, unclassified filesystem entries and plugin bodies refuse a complete capture', async t => {
  const f = await fixture(t), original = f.vault.read();
  await f.vault.update(state => { delete state.imports[0].retainedInput; });
  await assert.rejects(f.host.export(interchangeOwner, { destinationId: 'missing_body', confirmed: true }), code('INTERCHANGE_IMPORT_MATERIAL'));
  await f.vault.update(state => { state.imports = structuredClone(original.imports); state.imports[0].retainedInput.input.content += '\nchanged'; });
  await assert.rejects(f.host.export(interchangeOwner, { destinationId: 'changed_body', confirmed: true }), code('INTERCHANGE_IMPORT_MATERIAL'));
  await f.vault.update(state => { state.imports = structuredClone(original.imports); });
  const unknown = join(f.vault.directory, 'unclassified.fixture'); await writeFile(unknown, 'Do not guess its category');
  await assert.rejects(f.host.export(interchangeOwner, { destinationId: 'unknown_namespace', confirmed: true }), code('INTERCHANGE_INVENTORY_INCOMPLETE')); await unlink(unknown);
  await f.vault.update(state => { state.plugins.push({ id: 'missing_binary', manifest: { sourceIds: [] } }); });
  await assert.rejects(f.host.export(interchangeOwner, { destinationId: 'missing_plugin', confirmed: true }), code('INTERCHANGE_PLUGIN_MATERIAL'));
  assert.deepEqual(await f.vault.listArtifacts({ purpose: 'workspace-interchange' }), []);
});

test('actual connector pages and full reviewed recipes are preserved without promoting qualification; changed raw/provenance pins refuse', async t => {
  const f = await fixture(t), content = '\uFEFF{"synthetic":true}\r\n', bytes = Buffer.byteLength(content), pageHash = sha(content);
  const domain = { company: 'fixture company', dataset: 'fixture dataset', branches: ['Main'] };
  const capture = { type: 'connector-capture-v1', id: 'capture_fixture', sourceId: 'connector_fixture', reviewId: 'review_fixture',
    recipe: demoRecipe, recipeHash: interchangeDigest(demoRecipe), domain, operationKey: 'fixture:import', decoderId: 'fixture_decoder',
    decoderVersion: '1', schemaSha256: sha('synthetic-schema'), decoderDefinitionHash: sha('synthetic-definition'), identityNamespace: 'fixture-identities',
    totalBytes: bytes, status: 'quarantined', gaps: [{ code: 'SYNTHETIC_UNQUALIFIED' }],
    pages: [{ deliveryId: 'fixture_delivery', content, sha256: pageHash, bytes }] };
  const review = { type: 'connector-mapping-review-v1', id: 'review_fixture', sourceId: capture.sourceId, recipeHash: capture.recipeHash,
    domain, operationKey: capture.operationKey, decoderId: capture.decoderId, decoderVersion: capture.decoderVersion, schemaSha256: capture.schemaSha256 };
  const link = { type: 'connector-read-import-link-v1', id: 'link_fixture', sourceId: capture.sourceId, captureId: capture.id,
    importOperationKey: capture.operationKey, decoderDefinitionHash: capture.decoderDefinitionHash, identityNamespace: capture.identityNamespace,
    authorityScopeHash: sha('synthetic authority'), dataScopeHash: interchangeDigest(domain),
    readReceipt: { pages: 1, bytes, contentHashes: [pageHash], authorityScopeHash: sha('synthetic authority'),
      dataScopeHash: interchangeDigest(domain), operationKey: 'fixture:read' },
    pages: [{ deliveryId: 'fixture_delivery', provenance: { contentSha256: pageHash, byteLength: bytes, schemaFingerprint: capture.schemaSha256,
      authorityScopeHash: sha('synthetic authority'), dataScopeHash: interchangeDigest(domain), operationKey: 'fixture:read' } }] };
  await f.vault.update(state => { state.imports.push(review, capture, link); });
  await f.host.export(interchangeOwner, { destinationId: 'captured_pages', confirmed: true });
  const retained = await f.custody.ports.custody.read(interchangeOwner, 'captured_pages'), archive = inspectWorkspaceInterchange(retained.content);
  assert.ok(archive.artifacts.some(item => item.manifest.category === 'source-originals' && retainedArtifactBytes(item).equals(Buffer.from(content))));
  const historical = readHistoricalWorkspaceState(archive).imports.find(item => item.id === capture.id);
  assert.equal(historical.status, 'quarantined'); assert.deepEqual(historical.gaps, capture.gaps);
  await f.vault.update(state => { state.imports.find(item => item.id === capture.id).pages[0].content += 'tampered'; });
  await assert.rejects(f.host.export(interchangeOwner, { destinationId: 'tampered_pages', confirmed: true }), code('INTERCHANGE_IMPORT_MATERIAL'));
  await f.vault.update(state => { state.imports.find(item => item.id === capture.id).pages[0].content = content;
    state.imports.find(item => item.id === link.id).pages[0].provenance.byteLength++; });
  await assert.rejects(f.host.export(interchangeOwner, { destinationId: 'tampered_provenance', confirmed: true }), code('INTERCHANGE_IMPORT_MATERIAL'));
});

test('current authority and actual source file changes invalidate review while another owner context cannot read custody', async t => {
  const f = await fixture(t);
  await f.host.export(interchangeOwner, { destinationId: 'authority_export', confirmed: true });
  const prepared = await f.host.prepare(interchangeOwner, { exportId: 'authority_export', candidateId: 'authority_candidate', targetId: 'authority_target' });
  await assert.rejects(f.custody.ports.custody.read({ ...interchangeOwner, epoch: 2 }, 'authority_export'), code('ACCESS_REVOKED'));
  await f.vault.update(state => { state.policy.retentionDays++; });
  await assert.rejects(f.host.review(interchangeOwner, { candidateId: 'authority_candidate', reviewedDigest: prepared.reviewedDigest }), code('INTERCHANGE_AUTHORITY_CHANGED'));
});

test('a failed final source fence revokes its exact newly-created custody without leaving a published candidate', async t => {
  const f = await fixture(t); await mkdir(join(f.vault.directory, 'reports'));
  const report = join(f.vault.directory, 'reports', 'mutable.txt'); await writeFile(report, 'before');
  const ports = { ...f.custody.ports, custody: { ...f.custody.ports.custody,
    create: async (...args: Parameters<typeof f.custody.ports.custody.create>) => {
      const result = await f.custody.ports.custody.create(...args); await writeFile(report, 'after'); return result;
    } } };
  await assert.rejects(new WorkspaceInterchangeHost(ports).export(interchangeOwner, { destinationId: 'failed_fence', confirmed: true }), code('INTERCHANGE_AUTHORITY_CHANGED'));
  await assert.rejects(f.custody.ports.custody.read(interchangeOwner, 'failed_fence'), code('INTERCHANGE_CUSTODY_NOT_COMMITTED'));
  const refs = await f.vault.listArtifacts({ purpose: 'workspace-interchange' });
  assert.equal(refs.length, 1); assert.equal(((await f.vault.readArtifact(refs[0])).value as any).state, 'discarded');
});

test('post-publication commit acknowledgement failure is resolved to a revoked tombstone and exact ciphertext cleanup', async t => {
  const f = await fixture(t), original = f.vault.writeArtifact.bind(f.vault); let failed = false;
  f.vault.writeArtifact = async input => {
    const result = await original(input);
    if (input.id.endsWith('_commit') && (input.value as any).state === 'committed' && !failed) { failed = true; throw new Error('synthetic acknowledgement failure after actual commit'); }
    return result;
  };
  await assert.rejects(f.host.export(interchangeOwner, { destinationId: 'post_commit_failure', confirmed: true }), /synthetic acknowledgement failure/);
  const refs = await f.vault.listArtifacts({ purpose: 'workspace-interchange' });
  assert.equal(refs.length, 1); assert.equal(((await f.vault.readArtifact(refs[0])).value as any).state, 'discarded');
  await assert.rejects(f.custody.ports.custody.read(interchangeOwner, 'post_commit_failure'), code('INTERCHANGE_CUSTODY_NOT_COMMITTED'));
  await assert.rejects(f.host.export(interchangeOwner, { destinationId: 'post_commit_failure', confirmed: true }), code('INTERCHANGE_OUTPUT_EXISTS'));
});

test('post-publication archive and pin acknowledgement faults clean up their exact unacknowledged owned ciphertexts', async t => {
  for (const stage of ['archive', 'pin']) await t.test(stage, async subtest => {
    const f = await fixture(subtest), original = f.vault.writeArtifact.bind(f.vault); let failed = false;
    f.vault.writeArtifact = async input => {
      const result = await original(input);
      if (input.id.endsWith(`_${stage}`) && !failed) { failed = true; throw new Error(`synthetic ${stage} acknowledgement failure`); }
      return result;
    };
    await assert.rejects(f.host.export(interchangeOwner, { destinationId: `failed_${stage}`, confirmed: true }), new RegExp(`synthetic ${stage} acknowledgement failure`));
    assert.deepEqual(await f.vault.listArtifacts({ purpose: 'workspace-interchange' }), []);
    await f.host.export(interchangeOwner, { destinationId: `failed_${stage}`, confirmed: true });
    assert.equal((await f.vault.listArtifacts({ purpose: 'workspace-interchange' })).length, 3);
  });
});

test('post-publication target reservation acknowledgement failure revokes only the actual owned reservation and empty directory', async t => {
  const f = await fixture(t); await f.host.export(interchangeOwner, { destinationId: 'reservation_export', confirmed: true });
  const original = f.vault.writeArtifact.bind(f.vault); let failed = false;
  f.vault.writeArtifact = async input => {
    const result = await original(input);
    if (input.id.endsWith('_reservation') && !failed) { failed = true; throw new Error('synthetic reservation acknowledgement failure'); }
    return result;
  };
  await assert.rejects(f.host.prepare(interchangeOwner, { exportId: 'reservation_export', candidateId: 'reservation_candidate', targetId: 'reservation_target' }), /synthetic reservation acknowledgement failure/);
  await assert.rejects(lstat(f.custody.targetPath('reservation_target')), { code: 'ENOENT' });
  assert.ok(!(await f.vault.listArtifacts({ purpose: 'workspace-interchange' })).some(ref => ref.id.endsWith('_reservation')));
  assert.equal((await f.vault.listArtifacts({ purpose: 'workspace-interchange' })).length, 3);
});

test('retained private forks are admitted against CURRENT historical source rights and must have their owned issuance binding', async t => {
  const f = await fixture(t), historical = f.vault.read();
  const trialId = 'private_fixture', body: any = { version: 1, type: 'private-trial-fork-v1', id: trialId,
    workspaceId: historical.workspace.id, memberId: 'owner', epoch: 1, baseline: historical, candidate: structuredClone(historical) };
  body.digest = hash(body);
  const forkRef = await f.vault.writeArtifact({ id: `${trialId}-fork`, purpose: 'private-trial', expectedDigest: null, value: body });
  const binding = { version: 1, type: 'private-trial-issued-binding-v1', trialId, workspaceId: historical.workspace.id,
    memberId: 'owner', epoch: 1, status: 'active', fork: { ref: forkRef, issuedDigest: body.digest }, evaluation: null };
  await f.vault.writeArtifact({ id: `${trialId}-binding`, purpose: 'private-trial', expectedDigest: null, value: binding });
  await f.host.export(interchangeOwner, { destinationId: 'private_retained', confirmed: true });
  const retained = await f.custody.ports.custody.read(interchangeOwner, 'private_retained');
  assert.ok(inspectWorkspaceInterchange(retained.content).artifacts.some(item => item.manifest.category === 'other-retained'
    && item.text.includes('private-trial-fork-v1')));
  await f.vault.update(state => { state.facts = []; state.imports = []; state.policy.allowedSources = ['another-source']; });
  await assert.rejects(f.host.export(interchangeOwner, { destinationId: 'revoked_private', confirmed: true }), code('SOURCE_REVOKED'));
});

test('two individually permitted files exceeding the aggregate budget refuse the second allocation', async t => {
  const f = await fixture(t); await mkdir(join(f.vault.directory, 'reports'));
  for (const [name, size] of [['a.sparse', 40], ['b.sparse', 25]] as const) {
    const file = await import('node:fs/promises').then(fs => fs.open(join(f.vault.directory, 'reports', name), 'wx'));
    try { await file.truncate(size * 1024 * 1024); } finally { await file.close(); }
  }
  await assert.rejects(f.host.export(interchangeOwner, { destinationId: 'oversized_file', confirmed: true }), code('INTERCHANGE_LIMIT'));
  assert.deepEqual(await f.vault.listArtifacts({ purpose: 'workspace-interchange' }), []);
});

test('a private active issuance with missing retained payloads refuses completeness while a discarded tombstone is inert', async t => {
  const f = await fixture(t), trialId = 'missing_private';
  const binding = { version: 1, type: 'private-trial-issued-binding-v1', trialId, workspaceId: f.vault.read().workspace.id,
    memberId: 'owner', epoch: 1, status: 'active', evaluation: null,
    fork: { ref: { id: `${trialId}-fork`, purpose: 'private-trial', valueDigest: '1'.repeat(64), diskBytes: 500 }, issuedDigest: '2'.repeat(64) } };
  const ref = await f.vault.writeArtifact({ id: `${trialId}-binding`, purpose: 'private-trial', expectedDigest: null, value: binding });
  await assert.rejects(f.host.export(interchangeOwner, { destinationId: 'missing_private_export', confirmed: true }), code('INTERCHANGE_PRIVATE_TRIAL_MATERIAL'));
  await f.vault.writeArtifact({ id: ref.id, purpose: 'private-trial', expectedDigest: ref.valueDigest, value: { ...binding, status: 'discarded' } });
  await f.host.export(interchangeOwner, { destinationId: 'discarded_private_export', confirmed: true });
});
