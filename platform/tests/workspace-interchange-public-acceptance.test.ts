import assert from 'node:assert/strict';
import { mkdir, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { basename, relative } from 'node:path';
import test from 'node:test';
import type { State } from '../runtime/contracts.ts';
import type { WorkspaceInterchange } from '../runtime/workspace-interchange-contracts.ts';
import { code, CORRECTED_SOURCE_BYTES, fixture, HINDI, LARGE_ID, LEADING_ZERO_ID, LITERAL_DESCRIPTION, ORIGINAL_SOURCE_BYTES,
  PASSWORD, RECIPE_BYTES, sha256, UNSUPPORTED_QUESTION, type Fixture } from './fixtures/workspace-interchange-public-acceptance.ts';

// Independent expectations, deliberately not imported from the implementation's
// profile. These observed public bindings must run only on the frozen joined
// Engine/preload. Exact wire assertions await a public managed readback route.
const COLLECTIONS = ['members', 'facts', 'imports', 'receipts', 'answers', 'decisions', 'actions', 'jobs', 'learning',
  'plugins', 'modelReceipts', 'activity', 'conflicts', 'merges', 'tombstones', 'conversations', 'routes', 'sessions',
  'unsupported', 'schedules', 'sourceRules'];
const SINGLETONS = ['schemaVersion', 'revision', 'workspace', 'policy', 'ontology'];
const CATEGORIES = ['source-originals', 'mapping-recipes', 'dictionary-artifacts', 'report-files', 'plugin-assets',
  'research-evidence', 'conversation-files', 'sync-evidence', 'other-retained'];
const sorted = (values: string[]) => [...values].sort();
function bytesOf(item: WorkspaceInterchange['artifacts'][number]): Buffer {
  assert.ok(item.manifest.representation === 'literal-utf8' || item.manifest.representation === 'base64');
  return Buffer.from(item.text, item.manifest.representation === 'literal-utf8' ? 'utf8' : 'base64');
}
export function assertCompleteArchive(archive: WorkspaceInterchange, expected: State, f: Fixture) {
  assert.equal(archive.format, 'chausar.workspace-interchange.v1');
  assert.equal(archive.inventory.format, 'chausar.workspace-inventory.v1');
  assert.equal(archive.inventory.stores.length, 26); assert.equal(archive.stores.length, 26);
  assert.deepEqual(sorted(archive.stores.map(item => item.manifest.name)), sorted([...COLLECTIONS, ...SINGLETONS]));
  assert.deepEqual(sorted(archive.inventory.profile.stores.map(item => item.name)), sorted([...COLLECTIONS, ...SINGLETONS]));
  assert.deepEqual(sorted(Object.keys(expected)), sorted([...COLLECTIONS, ...SINGLETONS]));
  assert.deepEqual(archive.inventory.stores, archive.stores.map(item => item.manifest));
  assert.deepEqual(archive.inventory.artifacts, archive.artifacts.map(item => item.manifest));
  assert.equal(archive.inventory.generation.workspaceId, expected.workspace.id);
  assert.equal(archive.inventory.generation.revision, expected.revision);
  assert.deepEqual(sorted(archive.inventory.profile.artifactCategories), sorted(CATEGORIES));
  assert.deepEqual(sorted(archive.inventory.categoryCounts.map(item => item.category)), sorted(CATEGORIES));
  const actual: Record<string, unknown> = {};
  for (const item of archive.stores) {
    assert.equal(item.manifest.bytes, Buffer.byteLength(item.text, 'utf8')); assert.equal(item.manifest.sha256, sha256(item.text));
    assert.deepEqual(item.manifest.generation, archive.inventory.generation);
    const value = JSON.parse(item.text); actual[item.manifest.name] = value;
    assert.equal(item.text, JSON.stringify(expected[item.manifest.name as keyof State]), 'Nested JSON property order must be retained: ' + item.manifest.name);
    assert.equal(item.manifest.records, COLLECTIONS.includes(item.manifest.name) ? value.length : 1);
    assert.equal(item.manifest.kind, COLLECTIONS.includes(item.manifest.name) ? 'collection' : 'singleton');
  }
  assert.deepEqual(actual, expected, 'Every historical State store and field must survive exact capture.');
  for (const category of CATEGORIES) assert.equal(archive.inventory.categoryCounts.find(item => item.category === category)!.count,
    archive.artifacts.filter(item => item.manifest.category === category).length);
  for (const item of archive.artifacts) {
    const bytes = bytesOf(item); assert.equal(bytes.length, item.manifest.bytes); assert.equal(sha256(bytes), item.manifest.sha256);
    assert.deepEqual(item.manifest.generation, archive.inventory.generation);
    if (item.manifest.representation === 'literal-utf8') assert.equal(bytes.toString('utf8'), item.text);
    else assert.equal(bytes.toString('base64'), item.text);
  }
  const sources = archive.artifacts.filter(item => item.manifest.category === 'source-originals');
  for (const bytes of [ORIGINAL_SOURCE_BYTES, CORRECTED_SOURCE_BYTES]) assert.ok(sources.some(item => bytesOf(item).equals(bytes)), 'Original submitted UTF-8 bytes must be retained.');
  assert.ok(archive.artifacts.some(item => item.manifest.category === 'mapping-recipes' && bytesOf(item).equals(RECIPE_BYTES)), 'The submitted recipe JSON bytes must be retained.');
  assert.deepEqual(JSON.parse(archive.readable.definitions), expected.ontology);
  assert.deepEqual(JSON.parse(archive.readable.recipes).imports, expected.imports);
  for (const imported of f.imports) {
    assert.ok(sources.some(item => item.manifest.sha256 === imported.contentHash));
    assert.ok(archive.artifacts.some(item => item.manifest.category === 'mapping-recipes' && sha256(JSON.stringify(JSON.parse(item.text))) === imported.recipeHash));
  }
  for (const receipt of f.retainedReceipts) {
    assert.deepEqual(expected.receipts.find(item => item.id === receipt.id), receipt);
    const request = f.requests[f.retainedReceipts.indexOf(receipt)];
    assert.deepEqual(expected.answers.find(item => item.receiptId === receipt.id).request, request);
  }
  assert.ok(expected.facts.some(item => item.entityId === LEADING_ZERO_ID && item.fields.description === LITERAL_DESCRIPTION));
  assert.ok(expected.facts.some(item => item.entityId === LARGE_ID && item.fields.description === HINDI + ' PRIVATE_INTERCHANGE_SOURCE'));
  assert.ok(expected.facts.some(item => item.fields.amountMinor === '-7'));
  assert.ok(expected.facts.some(item => item.entityId === LEADING_ZERO_ID && item.fields.amountMinor === '100000'));
  assert.ok(expected.facts.some(item => item.entityId === LEADING_ZERO_ID && item.fields.amountMinor === '110000'));
  assert.ok(expected.unsupported.some(item => item.question === UNSUPPORTED_QUESTION), 'Unknown business requests remain preserved literal historical data.');
}

// Observed host operation payloads only. The final adapter must call the frozen
// Engine methods through f.request/preload; no mock implementation belongs here.
export type InterchangeOperations = {
  export(input: { destinationId: string; confirmed: true }): Promise<any>;
  prepare(input: { exportId: string; candidateId: string; targetId: string }): Promise<any>;
  review(input: { candidateId: string; reviewedDigest: string }): Promise<any>;
  discard(input: { recordId: string; reviewedDigest: string }): Promise<any>;
  diagnostics(): Promise<any>;
};
export function operations(f: Fixture): InterchangeOperations {
  return {
    export: input => f.request('workspace.interchange.export', input),
    prepare: input => f.request('workspace.interchange.prepare', input),
    review: input => f.request('workspace.interchange.review', input),
    discard: input => f.request('workspace.interchange.discard', input),
    diagnostics: () => f.request('workspace.interchange.diagnostics'),
  };
}
export function assertCustodySummary(value: any, kind: 'export' | 'candidate') {
  assert.equal(value.schemaVersion, 1); assert.equal(value.kind, kind);
  assert.equal(value.inert, true); assert.equal(value.activation, 'root-only');
  assert.equal(value.custodyQualification, 'encrypted-local-host');
  for (const digest of [value.packageDigest, value.reviewedDigest, value.source.inventoryDigest]) assert.match(digest, /^[a-f0-9]{64}$/);
  assert.equal(value.inventory.stores, 26);
  assert.deepEqual(sorted(value.inventory.categoryCounts.map((item: any) => item.category)), sorted(CATEGORIES));
  assert.equal(value.inventory.artifacts, value.inventory.categoryCounts.reduce((total: number, item: any) => total + item.count, 0));
  for (const bytes of Object.values(value.bytes)) assert.ok(Number.isSafeInteger(bytes) && Number(bytes) > 0);
  if (kind === 'candidate') {
    assert.match(value.target.proofDigest, /^[a-f0-9]{64}$/);
    assert.notEqual(value.target.workspaceId, value.source.workspaceId);
  } else assert.equal(value.target, undefined);
}
export async function publicAuthoritySnapshot(f: Fixture) {
  return { workspace: await f.request('workspace.status'), jobs: await f.request('jobs.list'), plugins: await f.request('plugins.list'),
    sessions: await f.request('auth.sessions'), routes: await f.request('models.list'), actions: await f.request('actions.list'),
    history: await f.request('conversation.history', { limit: 20 }), conversation: await f.request('conversation.get', { id: f.conversationId }) };
}
export async function encryptedInertJourney(f: Fixture, api: InterchangeOperations) {
  const before = await publicAuthoritySnapshot(f);
  const exported = await api.export({ destinationId: 'public-encrypted-export', confirmed: true });
  assertCustodySummary(exported, 'export');
  const candidate = await api.prepare({ exportId: exported.recordId, candidateId: 'public-inert-candidate', targetId: 'public-empty-target' });
  assertCustodySummary(candidate, 'candidate');
  assert.equal(candidate.target.targetId, 'public-empty-target');
  assert.deepEqual(await readdir(await f.ownedPath(candidate.target.targetId)), [], 'Prepared target stays physically uninitialized.');
  assert.equal(candidate.packageDigest, exported.packageDigest); assert.deepEqual(candidate.source, exported.source);
  assert.deepEqual(candidate.inventory, exported.inventory);
  await assert.rejects(api.review({ candidateId: candidate.recordId, reviewedDigest: '0'.repeat(64) }), code('INTERCHANGE_REVIEW_CHANGED'));
  assert.deepEqual(await api.review({ candidateId: candidate.recordId, reviewedDigest: candidate.reviewedDigest }), candidate);
  assert.deepEqual(await publicAuthoritySnapshot(f), before, 'Encrypted portability must not activate, dispatch, mint authority or replace the source.');
  await f.restart();
  assert.deepEqual(await api.review({ candidateId: candidate.recordId, reviewedDigest: candidate.reviewedDigest }), candidate);
  assert.deepEqual(await publicAuthoritySnapshot(f), before);
  assert.equal(f.h.calls.some(item => ['jobs.run', 'plugins.run', 'plugins.enable', 'models.configure', 'models.preview', 'models.test'].includes(item.method)), false);
  assert.deepEqual(await api.discard({ recordId: candidate.recordId, reviewedDigest: candidate.reviewedDigest }), { discarded: true, recordId: candidate.recordId });
  return { exported, candidate, before };
}

function assertDeclaredBusinessScope(diagnostics: any) {
  assert.equal(diagnostics.sourceScope, 'desktop-business-payload-with-control-exclusions');
  assert.equal(diagnostics.fullWorkspacePortabilityQualified, false);
  const names = diagnostics.namespaceDispositions.map((item: any) => item.namespace);
  for (const name of ['authority.encrypted.json or PostgreSQL authority', 'writer.lock', 'private-artifacts/private-trial',
    'private-artifacts/workspace-interchange', '.workspace-interchange-control', 'backups/exports belonging to other workspace IDs',
    'external namespaces and process-only acquisitions']) assert.ok(names.includes(name));
  assert.ok(diagnostics.namespaceDispositions.every((item: any) => typeof item.disposition === 'string' && item.disposition.length > 0));
  assert.ok(Number.isSafeInteger(diagnostics.controlArtifactsExcluded) && diagnostics.controlArtifactsExcluded > 0);
  assert.ok(Number.isFinite(diagnostics.measuredCaptureMs) && diagnostics.measuredCaptureMs >= 0);
}
function assertCapturedBytes(diagnostics: any, category: string, bytes: Uint8Array) {
  assert.ok(diagnostics.files.some((item: any) => item.category === category && item.bytes === bytes.byteLength && item.sha256 === sha256(bytes)),
    'Actual captured retained bytes match the independent submitted/managed bytes: ' + category);
}
async function prepared(f: Fixture, suffix: string) {
  const api = operations(f);
  const exported = await api.export({ destinationId: 'export-' + suffix, confirmed: true });
  const candidate = await api.prepare({ exportId: exported.recordId, candidateId: 'candidate-' + suffix, targetId: 'target-' + suffix });
  assertCustodySummary(exported, 'export'); assertCustodySummary(candidate, 'candidate');
  return { api, exported, candidate };
}

test('public encrypted interchange retains measured business inventory and inert authority across a new Engine', { concurrency: false }, async t => {
  const f = await fixture(t);
  const backup = await f.request('workspace.backup'); assert.equal(backup.encrypted, true);
  const backupBytes = await f.readOwned(backup.path);
  const baseline = await f.referenceState();
  const { exported, before } = await encryptedInertJourney(f, operations(f));
  assert.equal(exported.inventory.records, Object.values(baseline.state).reduce((count, value) => count + (Array.isArray(value) ? value.length : 1), 0));
  const diagnostics = await operations(f).diagnostics(); assertDeclaredBusinessScope(diagnostics);
  for (const bytes of [ORIGINAL_SOURCE_BYTES, CORRECTED_SOURCE_BYTES]) assertCapturedBytes(diagnostics, 'source-originals', bytes);
  assertCapturedBytes(diagnostics, 'mapping-recipes', RECIPE_BYTES);
  assertCapturedBytes(diagnostics, 'plugin-assets', new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
  assertCapturedBytes(diagnostics, 'other-retained', backupBytes); assertCapturedBytes(diagnostics, 'other-retained', baseline.bytes);
  const backupLogicalName = relative(f.directory, backup.path).replaceAll('\\', '/');
  assert.ok(diagnostics.externalKeyCustodyDependencies.includes(backupLogicalName), 'Encrypted backup wrapping-key dependency stays explicit.');
  assert.equal(diagnostics.files.length, exported.inventory.artifacts);
  for (const category of CATEGORIES) assert.equal(diagnostics.files.filter((item: any) => item.category === category).length,
    exported.inventory.categoryCounts.find((item: any) => item.category === category).count);
  assert.deepEqual(await publicAuthoritySnapshot(f), before, 'Available public authority and history stay unchanged after inert custody/discard.');
  t.diagnostic('Business-payload inventory and known retained byte hashes are verified. Full 26-store archive text/history preservation awaits a public wire readback route.');
});

test('public review rejects actual prepared-target occupation and physical directory replacement', { concurrency: false }, async t => {
  const f = await fixture(t, false), { api, exported, candidate } = await prepared(f, 'occupation');
  const before = await publicAuthoritySnapshot(f), marker = await f.ownedPath(candidate.target.targetId, 'synthetic-unexpected.txt');
  await writeFile(marker, 'Owned synthetic target occupation\n', { flag: 'wx' });
  await assert.rejects(api.review({ candidateId: candidate.recordId, reviewedDigest: candidate.reviewedDigest }), code('INTERCHANGE_TARGET_NOT_EMPTY'));
  assert.deepEqual(await publicAuthoritySnapshot(f), before);
  await unlink(marker);
  assert.deepEqual(await api.review({ candidateId: candidate.recordId, reviewedDigest: candidate.reviewedDigest }), candidate);
  const movedCandidate = await api.prepare({ exportId: exported.recordId, candidateId: 'candidate-moved', targetId: 'target-moved' });
  const original = await f.ownedPath(movedCandidate.target.targetId), moved = await f.ownedPath('target-moved-original');
  await rename(original, moved); await mkdir(original);
  assert.deepEqual(await readdir(original), []); assert.deepEqual(await readdir(moved), []);
  await assert.rejects(api.review({ candidateId: movedCandidate.recordId, reviewedDigest: movedCandidate.reviewedDigest }), code('INTERCHANGE_TARGET_CHANGED'));
  assert.deepEqual(await publicAuthoritySnapshot(f), before);
});

test('public prepare refuses an initialized workspace and an unrelated existing empty target', { concurrency: false }, async t => {
  const f = await fixture(t, false), other = f.otherEngine();
  const initialized = await other.request('workspace.create', { name: 'Owned initialized target', folder: 'target-initialized', passphrase: PASSWORD, demo: false, pack: 'ecommerce' });
  assert.ok(initialized); await other.close();
  const initializedAuthority = await f.readOwned(await f.ownedPath('target-initialized', 'authority.encrypted.json'));
  const empty = await f.ownedPath('target-unrelated-empty'); await mkdir(empty);
  const api = operations(f), exported = await api.export({ destinationId: 'export-existing-targets', confirmed: true });
  for (const targetId of ['target-initialized', 'target-unrelated-empty']) {
    await assert.rejects(api.prepare({ exportId: exported.recordId, candidateId: 'candidate-' + targetId, targetId }), code('INTERCHANGE_TARGET_EXISTS'));
  }
  assert.deepEqual(await f.readOwned(await f.ownedPath('target-initialized', 'authority.encrypted.json')), initializedAuthority);
  assert.deepEqual(await readdir(empty), []);
});

test('public prepare and review reject stale source State after a real administrative update', { concurrency: false }, async t => {
  const f = await fixture(t, false), { api, exported, candidate } = await prepared(f, 'state');
  await f.request('members.add', { id: 'new-synthetic-viewer', name: 'Owned synthetic viewer', role: 'viewer', branches: ['main'] });
  const before = await publicAuthoritySnapshot(f);
  await assert.rejects(api.review({ candidateId: candidate.recordId, reviewedDigest: candidate.reviewedDigest }), code('INTERCHANGE_AUTHORITY_CHANGED'));
  await assert.rejects(api.prepare({ exportId: exported.recordId, candidateId: 'candidate-stale-state', targetId: 'target-stale-state' }), code('INTERCHANGE_AUTHORITY_CHANGED'));
  assert.deepEqual(await publicAuthoritySnapshot(f), before);
});

test('public prepare and review reject changed retained source bytes without a State mutation', { concurrency: false }, async t => {
  const f = await fixture(t, false), retained = await f.referenceState(), { api, exported, candidate } = await prepared(f, 'artifact');
  const path = await f.ownedPath('exports', basename(retained.path)), before = await publicAuthoritySnapshot(f);
  try {
    await writeFile(path, Buffer.concat([retained.bytes, Buffer.from('\nOwned synthetic retained-byte correction\n')]));
    assert.notEqual(sha256(await f.readOwned(path)), sha256(retained.bytes));
    await assert.rejects(api.review({ candidateId: candidate.recordId, reviewedDigest: candidate.reviewedDigest }), code('INTERCHANGE_AUTHORITY_CHANGED'));
    await assert.rejects(api.prepare({ exportId: exported.recordId, candidateId: 'candidate-stale-artifact', targetId: 'target-stale-artifact' }), code('INTERCHANGE_AUTHORITY_CHANGED'));
    assert.deepEqual(await publicAuthoritySnapshot(f), before);
  } finally { await writeFile(path, retained.bytes); }
});

test('public encrypted capture refuses an actual unclassified source entry and recovers after its removal', { concurrency: false }, async t => {
  const f = await fixture(t, false), { api, candidate } = await prepared(f, 'incomplete');
  const unexpected = await f.ownedPath('source', 'synthetic-unclassified.txt'), before = await publicAuthoritySnapshot(f);
  await writeFile(unexpected, 'Owned synthetic unclassified retained data\n', { flag: 'wx' });
  try {
    await assert.rejects(api.export({ destinationId: 'export-incomplete', confirmed: true }), code('INTERCHANGE_INVENTORY_INCOMPLETE'));
    await assert.rejects(api.review({ candidateId: candidate.recordId, reviewedDigest: candidate.reviewedDigest }), code('INTERCHANGE_INVENTORY_INCOMPLETE'));
    assert.deepEqual(await publicAuthoritySnapshot(f), before);
  } finally { await unlink(unexpected); }
  assertCustodySummary(await api.export({ destinationId: 'export-classified-again', confirmed: true }), 'export');
});

test('public custody requires the current unrestricted owner and current retained-source access', { concurrency: false }, async t => {
  const f = await fixture(t, false);
  const member = await f.request('members.add', { id: 'synthetic-cofounder', name: 'Owned synthetic cofounder', role: 'cofounder', branches: ['*'] });
  const cofounder = { memberId: member.id, role: member.role, epoch: member.epoch, channel: 'desktop' as const };
  const { api, exported, candidate } = await prepared(f, 'access');
  await assert.rejects(f.requestAs(cofounder, 'workspace.interchange.export', { destinationId: 'export-cofounder', confirmed: true }), code('FORBIDDEN'));
  await assert.rejects(f.requestAs(cofounder, 'workspace.interchange.review', { candidateId: candidate.recordId, reviewedDigest: candidate.reviewedDigest }), code('FORBIDDEN'));
  await f.request('members.revoke', { id: member.id });
  await assert.rejects(f.requestAs(cofounder, 'workspace.interchange.export', { destinationId: 'export-revoked-cofounder', confirmed: true }), code('ACCESS_REVOKED'));
  await f.request('trust.update', { allowedSources: [] });
  for (const operation of [
    () => api.export({ destinationId: 'export-source-revoked', confirmed: true }),
    () => api.prepare({ exportId: exported.recordId, candidateId: 'candidate-source-revoked', targetId: 'target-source-revoked' }),
    () => api.review({ candidateId: candidate.recordId, reviewedDigest: candidate.reviewedDigest }),
  ]) await assert.rejects(operation(), code('SOURCE_REVOKED'));
});

test('public IPC refuses unconfirmed exports and caller-supplied authority or target witness fields', { concurrency: false }, async t => {
  const f = await fixture(t, false), before = await publicAuthoritySnapshot(f);
  await assert.rejects(f.request('workspace.interchange.export', { destinationId: 'export-unconfirmed', confirmed: false }), code('CONFIRMATION_REQUIRED'));
  await assert.rejects(f.request('workspace.interchange.export', { destinationId: 'export-missing-confirmation' }), code('INVALID_INTERCHANGE_REQUEST'));
  for (const field of ['inventory', 'sourceProof', 'context', 'authority', 'ready']) {
    await assert.rejects(f.request('workspace.interchange.export', { destinationId: 'export-extra-' + field, confirmed: true, [field]: {} }), code('INVALID_INTERCHANGE_REQUEST'));
  }
  const api = operations(f), exported = await api.export({ destinationId: 'export-strict-payload', confirmed: true });
  await assert.rejects(f.request('workspace.interchange.prepare', { exportId: exported.recordId, candidateId: 'candidate-extra-target', targetId: 'target-extra-target',
    targetProof: {} }), code('INVALID_INTERCHANGE_REQUEST'));
  await assert.rejects(f.request('workspace.interchange.diagnostics', { authority: {} }), code('INVALID_INTERCHANGE_REQUEST'));
  assert.deepEqual(await publicAuthoritySnapshot(f), before);
});
