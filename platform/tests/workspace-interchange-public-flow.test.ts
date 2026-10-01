import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { Engine } from '../runtime/engine.ts';
import { createLocalServer } from '../runtime/server.ts';
import type { Binding, ImportInput } from '../runtime/ingest.ts';
import type { WorkspaceInterchangeHostSummary } from '../runtime/workspace-interchange-host.ts';

// Actual loopback HTTP, Engine, experimental encrypted Vault, private artifact
// files and local custody. Authored synthetic business only; no migration,
// historical-State activation, providers, native GUI or live vendor qualification.
const sourceId = 'synthetic-interchange-public-source';
const passphrase = 'Synthetic interchange public passphrase only';
const source: ImportInput = {
  sourceId, format: 'csv',
  content: 'id,kind,date,amount,tax,currency,branch,status,note\n'
    + 'I1,invoice,2026-09-02,100.00,10.00,INR,main,issued,=1+1 literal\n'
    + 'I2,invoice,2026-09-03,200.00,20.00,INR,main,issued,हिन्दी literal\n'
    + 'P1,payment,2026-09-04,50.00,0.00,INR,main,settled,000001\n'
    + 'S1,sale,2026-09-05,75.00,0.00,INR,main,delivered,900719925474099391',
  recipe: {
    version: 1, id: 'synthetic-interchange-public-recipe', system: 'synthetic-csv', edition: '1',
    scope: { company: 'Synthetic Interchange', branches: ['main'] },
    bindings: [
      { target: 'entityId', source: 'id', type: 'string', nulls: 'reject' },
      { target: 'kind', source: 'kind', type: 'string', nulls: 'reject' },
      { target: 'validFrom', source: 'date', type: 'date', dateFormat: 'ISO', nulls: 'reject' },
      ...['amountMinor', 'taxMinor'].map((target): Binding => ({ target, source: target === 'amountMinor' ? 'amount' : 'tax',
        type: 'money', moneyUnit: 'major', currency: 'INR', nulls: 'reject' })),
      ...['currency', 'branch', 'status'].map((target): Binding => ({ target, source: target, type: 'string', nulls: 'reject' })),
    ],
    allowedKinds: ['invoice', 'payment', 'sale'], allowedStatuses: ['issued', 'settled', 'delivered'],
    ignoredFields: ['note'], onUnmapped: 'reject',
  },
  expectedTotals: { rowCount: 4, amountMinor: '42500' },
};

const EXPORT = { destinationId: 'synthetic_public_export', confirmed: true };
const PREPARE = { exportId: EXPORT.destinationId, candidateId: 'synthetic_public_candidate', targetId: 'synthetic_empty_target' };
const controlFile = (id: string, part: 'archive' | 'pin' | 'commit') =>
  `wic_${createHash('sha256').update(id).digest('hex')}_${part}.encrypted.json`;
const forbiddenSummaryKeys = new Set(['archive', 'state', 'facts', 'imports', 'receipts', 'definitions', 'recipes',
  'members', 'actions', 'jobs', 'sessions', 'routes', 'plugins', 'policy', 'ontology', 'content', 'passphrase',
  'recoveryCode', 'recoveryKit', 'key', 'snapshot', 'ciphertext', 'moduleBase64', 'tokenHash']);

function boundedPublicSummary(value: unknown) {
  function visit(item: unknown) {
    if (!item || typeof item !== 'object') return;
    for (const [key, child] of Object.entries(item)) { assert.equal(forbiddenSummaryKeys.has(key), false, `Public summary exposed ${key}`); visit(child); }
  }
  visit(value);
  const text = JSON.stringify(value);
  assert.equal(text.includes(source.content), false); assert.equal(text.includes(passphrase), false);
  assert.equal(text.includes('=1+1 literal'), false); assert.equal(text.includes('हिन्दी literal'), false);
}

async function setup(t: TestContext) {
  const parent = await realpath(tmpdir());
  if (process.platform === 'win32') assert.match(parent, /^C:\\/i);
  const directory = await mkdtemp(join(parent, 'chausar-interchange-public-'));
  let providerCalls = 0;
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file',
    gateway: { http: async () => { providerCalls++; throw new Error('No live provider in this explicitly synthetic interchange acceptance.'); } } });
  const app = createLocalServer(engine);
  t.after(async () => {
    try { await app.close(); }
    finally {
      const target = await realpath(directory), child = relative(parent, target);
      assert.ok(child && !child.startsWith('..') && !isAbsolute(child) && child.startsWith('chausar-interchange-public-'));
      assert.equal(target, directory);
      await rm(target, { recursive: true, force: true });
    }
  });
  const { origin, token } = await app.listen();
  const raw = async (method: string, payload: unknown = {}, bearer = token) => {
    const response = await fetch(`${origin}/api/rpc`, { method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` }, body: JSON.stringify({ method, payload }) });
    return { status: response.status, body: await response.json() as any };
  };
  const rpc = async (method: string, payload: unknown = {}, bearer = token) => {
    const response = await raw(method, payload, bearer); assert.equal(response.status, 200, JSON.stringify(response.body)); return response.body.result;
  };
  await rpc('workspace.create', { name: 'Synthetic public interchange', passphrase, demo: true, pack: 'retail' });
  const imported = await rpc('sources.import', structuredClone(source)); assert.equal(imported.retainedInput, undefined);
  const asOf = new Date(Date.now() + 1).toISOString(), receipts: any[] = [];
  for (const operation of ['billed', 'received', 'earned']) receipts.push(await rpc('calculation.run', { operation, sourceIds: [sourceId], asOf }));
  assert.deepEqual(receipts.map(receipt => [receipt.operation, receipt.totalMinor]), [['billed', '30000'], ['received', '5000'], ['earned', '7500']]);
  assert.equal(engine.vault!.read().answers.filter(answer => receipts.some(receipt => receipt.id === answer.receiptId)).length, 3);
  const custodyDirectory = join(directory, 'main', 'private-artifacts', 'workspace-interchange');
  const ciphertextFiles = async () => {
    let names: string[];
    try { names = await readdir(custodyDirectory); }
    catch (error: any) { if (error.code === 'ENOENT') return new Map<string, number>(); throw error; }
    const result = new Map<string, number>();
    for (const name of names.sort()) {
      assert.match(name, /^[A-Za-z0-9_-]+\.encrypted\.json$/);
      const file = join(custodyDirectory, name), stat = await lstat(file), bytes = await readFile(file);
      assert.equal(stat.isFile(), true); assert.equal(stat.isSymbolicLink(), false); assert.equal(stat.size, bytes.length); assert.ok(stat.size > 0);
      const envelope = JSON.parse(bytes.toString()); assert.equal(envelope.format, 'chausar.private-artifact.v1');
      assert.equal(typeof envelope.ciphertext?.data, 'string'); assert.ok(envelope.ciphertext.data.length > 0);
      assert.equal(bytes.includes(Buffer.from(source.content)), false); assert.equal(bytes.includes(Buffer.from(passphrase)), false);
      assert.equal(bytes.includes(Buffer.from('=1+1 literal')), false); assert.equal(bytes.includes(Buffer.from('हिन्दी literal')), false);
      result.set(name, stat.size);
    }
    return result;
  };
  const assertMeasured = async (summary: WorkspaceInterchangeHostSummary) => {
    boundedPublicSummary(summary); assert.equal(summary.inert, true); assert.equal(summary.activation, 'root-only');
    assert.equal(summary.inventory.stores, 26); assert.equal(summary.inventory.categoryCounts.length, 9);
    assert.ok(summary.inventory.categoryCounts.find(item => item.category === 'source-originals')!.count > 0);
    assert.ok(summary.inventory.categoryCounts.find(item => item.category === 'mapping-recipes')!.count > 0);
    assert.ok(summary.bytes.wireUtf8 > 0); assert.ok(summary.bytes.retainedArtifacts > 0);
    const files = await ciphertextFiles();
    assert.equal(summary.bytes.archiveCiphertext, files.get(controlFile(summary.recordId, 'archive')));
    assert.equal(summary.bytes.inventoryPinCiphertext, files.get(controlFile(summary.recordId, 'pin')));
    assert.ok(files.get(controlFile(summary.recordId, 'commit'))! > 0);
    assert.equal(summary.custodyQualification, 'encrypted-local-host');
  };
  const exportAndPrepare = async () => {
    const exported = await rpc('workspace.interchange.export', EXPORT) as WorkspaceInterchangeHostSummary;
    const candidate = await rpc('workspace.interchange.prepare', PREPARE) as WorkspaceInterchangeHostSummary;
    return { exported, candidate };
  };
  return { engine, rpc, raw, directory, receipts, custodyDirectory, ciphertextFiles, assertMeasured, exportAndPrepare,
    providerCalls: () => providerCalls, target: join(directory, PREPARE.targetId) };
}

test('actual public HTTP encrypted export/candidate survives lock/reopen/exact review and discard without target activation', async t => {
  const value = await setup(t), original = value.engine.vault!.read();
  const { exported, candidate } = await value.exportAndPrepare();
  await value.assertMeasured(exported); await value.assertMeasured(candidate);
  assert.equal(candidate.packageDigest, exported.packageDigest); assert.notEqual(candidate.target!.workspaceId, original.workspace.id);
  assert.deepEqual(await readdir(value.target), []); assert.deepEqual(value.engine.vault!.read(), original);
  const reviewInput = { candidateId: PREPARE.candidateId, reviewedDigest: candidate.reviewedDigest };
  const wrong = await value.raw('workspace.interchange.review', { ...reviewInput, reviewedDigest: '0'.repeat(64) });
  assert.equal(wrong.status, 400); assert.equal(wrong.body.error.code, 'INTERCHANGE_REVIEW_CHANGED'); assert.equal(wrong.body.result, undefined);
  assert.deepEqual(await value.rpc('workspace.interchange.review', reviewInput), candidate);
  const diagnostics = await value.rpc('workspace.interchange.diagnostics');
  assert.equal(diagnostics.fullWorkspacePortabilityQualified, false);
  assert.equal(diagnostics.sourceScope, 'desktop-business-payload-with-control-exclusions');
  assert.ok(diagnostics.controlArtifactsExcluded > 0); assert.ok(diagnostics.measuredCaptureMs >= 0); boundedPublicSummary(diagnostics);
  await value.rpc('workspace.lock'); await value.rpc('workspace.open', { passphrase });
  assert.deepEqual(value.engine.vault!.read(), original, 'An ordinary no-op reopen must preserve the exact reviewed source generation.');
  assert.deepEqual(await value.rpc('workspace.interchange.review', reviewInput), candidate);
  await value.assertMeasured(candidate);
  const discarded = await value.rpc('workspace.interchange.discard', { recordId: PREPARE.candidateId, reviewedDigest: candidate.reviewedDigest });
  assert.deepEqual(discarded, { discarded: true, recordId: PREPARE.candidateId });
  const files = await value.ciphertextFiles();
  assert.equal(files.has(controlFile(PREPARE.candidateId, 'archive')), false); assert.equal(files.has(controlFile(PREPARE.candidateId, 'pin')), false);
  assert.ok(files.get(controlFile(PREPARE.candidateId, 'commit'))! > 0);
  assert.equal(files.has(controlFile(EXPORT.destinationId, 'archive')), true); assert.equal(files.has(controlFile(EXPORT.destinationId, 'pin')), true);
  assert.deepEqual(await readdir(value.target), [], 'Discard must leave the target uninitialized; it never mounts historical State.');
  const unavailable = await value.raw('workspace.interchange.review', reviewInput);
  assert.equal(unavailable.status, 400); assert.equal(unavailable.body.error.code, 'INTERCHANGE_CUSTODY_NOT_COMMITTED'); assert.equal(unavailable.body.result, undefined);
  for (const receipt of value.receipts) assert.deepEqual(await value.rpc('receipts.get', { id: receipt.id }), receipt);
  assert.deepEqual(value.engine.vault!.read(), original); assert.equal(value.providerCalls(), 0);
});

test('public source mutation invalidates the pinned candidate without rewriting its ciphertext or historical receipt identities', async t => {
  const value = await setup(t), { candidate } = await value.exportAndPrepare();
  const before = await value.ciphertextFiles(), changed = structuredClone(source);
  changed.content = changed.content.replace('I1,invoice,2026-09-02,100.00', 'I1,invoice,2026-09-02,101.00');
  changed.expectedTotals = { rowCount: 4, amountMinor: '42600' }; await value.rpc('sources.import', changed);
  const refused = await value.raw('workspace.interchange.review', { candidateId: PREPARE.candidateId, reviewedDigest: candidate.reviewedDigest });
  assert.equal(refused.status, 400); assert.equal(refused.body.error.code, 'INTERCHANGE_AUTHORITY_CHANGED'); assert.equal(refused.body.result, undefined);
  assert.deepEqual(await value.ciphertextFiles(), before); assert.deepEqual(await readdir(value.target), []);
  assert.ok(value.receipts.every(receipt => value.engine.vault!.read().receipts.some(retained => retained.id === receipt.id)));
  assert.equal(value.providerCalls(), 0);
});

test('public current source revocation blocks export, candidate review and discard before exposing archive content', async t => {
  const value = await setup(t), { candidate } = await value.exportAndPrepare(), before = await value.ciphertextFiles();
  await value.rpc('trust.update', { allowedSources: [] });
  const requests: [string, unknown][] = [
    ['workspace.interchange.export', { destinationId: 'revoked_export', confirmed: true }],
    ['workspace.interchange.review', { candidateId: PREPARE.candidateId, reviewedDigest: candidate.reviewedDigest }],
    ['workspace.interchange.discard', { recordId: PREPARE.candidateId, reviewedDigest: candidate.reviewedDigest }],
  ];
  for (const [method, payload] of requests) {
    const refused = await value.raw(method, payload); assert.equal(refused.status, 400); assert.equal(refused.body.error.code, 'SOURCE_REVOKED');
    assert.equal(refused.body.result, undefined); boundedPublicSummary(refused.body);
  }
  assert.deepEqual(await value.ciphertextFiles(), before); assert.deepEqual(await readdir(value.target), []); assert.equal(value.providerCalls(), 0);
});

test('public nonowner context cannot export or reopen another account exact candidate even with its digest', async t => {
  const value = await setup(t);
  const invite = await value.rpc('auth.invite', { name: 'Synthetic separate reader', role: 'viewer', branches: ['main'] });
  const accepted = await value.rpc('auth.accept', { token: invite.token });
  const { candidate } = await value.exportAndPrepare(), before = await value.ciphertextFiles();
  for (const [method, payload] of [
    ['workspace.interchange.export', { destinationId: 'other_account_export', confirmed: true }],
    ['workspace.interchange.review', { candidateId: PREPARE.candidateId, reviewedDigest: candidate.reviewedDigest }],
  ] as const) {
    const refused = await value.raw(method, payload, accepted.token); assert.equal(refused.status, 403); assert.equal(refused.body.error.code, 'FORBIDDEN');
    assert.equal(refused.body.result, undefined); boundedPublicSummary(refused.body);
  }
  assert.deepEqual(await value.ciphertextFiles(), before); assert.equal(value.providerCalls(), 0);
});

test('public target custody refuses unrelated existing directories and actual later target content without deleting them', async t => {
  const value = await setup(t), unrelated = join(value.directory, 'unrelated_target');
  await mkdir(unrelated); await writeFile(join(unrelated, 'owned-synthetic-marker.txt'), 'Synthetic unrelated content remains intact', { flag: 'wx' });
  const exported = await value.rpc('workspace.interchange.export', EXPORT);
  const refused = await value.raw('workspace.interchange.prepare', { ...PREPARE, targetId: 'unrelated_target' });
  assert.equal(refused.status, 400); assert.equal(refused.body.error.code, 'INTERCHANGE_TARGET_EXISTS'); assert.equal(refused.body.result, undefined);
  assert.equal(await readFile(join(unrelated, 'owned-synthetic-marker.txt'), 'utf8'), 'Synthetic unrelated content remains intact');
  const candidate = await value.rpc('workspace.interchange.prepare', PREPARE);
  await writeFile(join(value.target, 'new-synthetic-entry.txt'), 'Target became nonempty', { flag: 'wx' });
  const before = await value.ciphertextFiles();
  const changed = await value.raw('workspace.interchange.review', { candidateId: PREPARE.candidateId, reviewedDigest: candidate.reviewedDigest });
  assert.equal(changed.status, 400); assert.equal(changed.body.error.code, 'INTERCHANGE_TARGET_NOT_EMPTY'); assert.equal(changed.body.result, undefined);
  assert.deepEqual(await value.ciphertextFiles(), before);
  await value.rpc('workspace.interchange.discard', { recordId: PREPARE.candidateId, reviewedDigest: candidate.reviewedDigest });
  assert.equal(await readFile(join(value.target, 'new-synthetic-entry.txt'), 'utf8'), 'Target became nonempty');
  assert.equal((await value.ciphertextFiles()).has(controlFile(exported.recordId, 'archive')), true); assert.equal(value.providerCalls(), 0);
});

test('public complete copy refuses newly configured external sync custody without selecting a readiness bypass', async t => {
  const value = await setup(t), before = value.engine.vault!.read();
  // Trusted host configuration only, not a fabricated qualified reader/gate.
  // The selected local business scope has no independent external sync inventory.
  value.engine.options.sync = {};
  const refused = await value.raw('workspace.interchange.export', EXPORT);
  assert.equal(refused.status, 400); assert.equal(refused.body.error.code, 'INTERCHANGE_EXTERNAL_CUSTODY_REQUIRED'); assert.equal(refused.body.result, undefined);
  assert.equal((await value.ciphertextFiles()).size, 0); assert.deepEqual(value.engine.vault!.read(), before); assert.equal(value.providerCalls(), 0);
});
