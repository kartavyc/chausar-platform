import assert from 'node:assert/strict';
import type {TestContext} from 'node:test';
import {createHash} from 'node:crypto';
import {mkdtemp, readdir, realpath, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, isAbsolute, join, relative} from 'node:path';
import {Engine, type EngineOptions} from '../../runtime/engine.ts';
import {createLocalServer} from '../../runtime/server.ts';
import {Vault, type VaultEncryptedCustodyCapture} from '../../runtime/vault.ts';
import type {ImportInput, MappingRecipe} from '../../runtime/ingest.ts';
import type {WorkspaceActivationPolicy} from '../../runtime/workspace-activation.ts';

// Public HTTP operations author every business/control/trial record. Trusted
// Vault reads observe genuine encrypted custody; no hand-authored State or ports.
export const A = 'independent-activation-register-a', B = 'independent-activation-register-b';
export const PERIOD = {from: '2026-09-01', to: '2026-09-30'};
export const OLD_CUT = '2026-10-01T12:00:00.000Z', CURRENT_CUT = '2026-10-03T12:00:00.000Z';
export const SOURCE_PASSWORD = 'Synthetic independent source credential only';
export const JOURNAL_PASSWORD = 'Synthetic independent journal credential only';
export const TARGET_PASSWORD = 'Synthetic independently allocated target credential only';
export const SECRET = 'SYNTHETIC_ACTIVATION_PRIVATE_MARKER_483912';
export const IDS = {material: 'independent_material', backup: 'independent_backup', inert: 'independent_inert',
  candidate: 'independent_candidate', target: 'independent_target', activation: 'independent_activation'};
export const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
export const artifactId = (prefix: string, id: string, part: string) => `${prefix}_${sha(id)}_${part}`;
export const budgets = {maxArchiveUtf8Bytes: 16_000_000, maxEntryBytes: 6_000_000,
  maxTotalEntryBytes: 12_000_000, maxEntries: 100, maxJsonDepth: 128, maxJsonNodes: 200_000};
const captureBudgets = {maxArtifacts: 100, maxEntryBytes: 6_000_000, maxTotalEntryBytes: 12_000_000};

export function publicMetadata(value: unknown) {
  const text = JSON.stringify(value);
  for (const secret of [SOURCE_PASSWORD, JOURNAL_PASSWORD, TARGET_PASSWORD, SECRET]) assert.equal(text.includes(secret), false);
  for (const key of ['content', 'authorityBase64', 'dataBase64', 'ciphertext', 'passphrase', 'recoveryCode', 'tokenHash', 'directory']) {
    assert.equal(text.includes(`"${key}"`), false, `Public summary disclosed ${key}.`);
  }
}

async function http(engine: Engine) {
  const app = createLocalServer(engine), {origin, token} = await app.listen();
  const raw = async (method: string, payload: unknown = {}, credential = token) => {
    const response = await fetch(`${origin}/api/rpc`, {method: 'POST', headers: {
      'content-type': 'application/json', authorization: `Bearer ${credential}`}, body: JSON.stringify({method, payload})});
    return {status: response.status, body: await response.json() as any};
  };
  const rpc = async <T = any>(method: string, payload: unknown = {}): Promise<T> => {
    const result = await raw(method, payload);
    assert.equal(result.status, 200, `${method}: ${result.body.error?.code} ${result.body.error?.message}`);
    return result.body.result as T;
  };
  const refuse = async (method: string, payload: unknown, codes: string[]) => {
    const result = await raw(method, payload);
    assert.notEqual(result.status, 200, `${method} unexpectedly succeeded.`);
    assert.ok(codes.includes(result.body.error?.code), `${method}: ${result.body.error?.code}`);
    publicMetadata(result.body); return result.body.error.code as string;
  };
  return {app, engine, origin, token, raw, rpc, refuse};
}
export type Http = Awaited<ReturnType<typeof http>>;

function input(sourceId: string): ImportInput {
  const mapping: MappingRecipe = {version: 1, id: `map-${sourceId}`, system: 'synthetic-csv', edition: '1',
    scope: {company: 'Independent synthetic activation shop', branches: ['main', 'other']}, bindings: [
      {target: 'entityId', source: 'id', type: 'string', nulls: 'reject'},
      {target: 'kind', source: 'kind', type: 'string', nulls: 'reject'},
      {target: 'validFrom', source: 'date', type: 'date', dateFormat: 'ISO', nulls: 'reject'},
      ...['amountMinor', 'taxMinor'].map(target => ({target, source: target, type: 'money' as const,
        moneyUnit: 'minor' as const, currency: 'INR', nulls: 'reject' as const})),
      ...['currency', 'branch', 'status', 'description'].map(target => ({target, source: target,
        type: 'string' as const, nulls: 'reject' as const})),
    ], allowedKinds: ['invoice', 'payment', 'sale', 'cost'], allowedStatuses: ['issued', 'settled'], onUnmapped: 'reject'};
  const description = `"${SECRET}, multilingual ₹\nsecond retained line"`;
  const rows = sourceId === A ? [
    `00017,invoice,2026-09-01,10000,1000,INR,main,issued,${description}`,
    `P1,payment,2026-09-04,7000,0,INR,main,settled,${description}`,
    `S1,sale,2026-09-30,12500,0,INR,main,settled,${description}`,
    `C1,cost,2026-09-09,3000,0,INR,main,settled,${description}`,
    `I2,invoice,2026-09-30,40000,4000,INR,other,issued,${description}`,
    `HUGE,invoice,2026-08-31,900719925474099325,900719925474099325,INR,main,issued,${description}`,
  ] : [`B1,invoice,2026-09-11,90000,9000,INR,main,issued,${description}`];
  return {sourceId, format: 'csv', recipe: mapping,
    content: ['id,kind,date,amountMinor,taxMinor,currency,branch,status,description', ...rows].join('\r\n'),
    expectedTotals: {rowCount: rows.length, amountMinor: sourceId === A ? '900719925474171825' : '90000'}};
}

export async function fixture(t: TestContext) {
  t.mock.timers.enable({apis: ['Date'], now: new Date('2026-09-30T23:59:58.000Z')});
  const base = await realpath(tmpdir());
  if (process.platform === 'win32') assert.match(base, /^C:\\/i, 'Synthetic scratch must be on C.');
  const directory = await realpath(await mkdtemp(join(base, 'chausar-activation-independent-')));
  assert.equal(dirname(directory), base);
  const apps = new Set<Http>(); let journal: Vault | undefined, providerCalls = 0;
  const options: EngineOptions = {directory, storage: 'experimental-file', demo: true,
    backupCustody: {budgets, filesystemBudgets: {maxFiles: 100, maxBytes: 16_000_000, maxDepth: 16}},
    gateway: {http: async () => {providerCalls++; throw Error('Live inference is forbidden in this synthetic fixture.');}}};
  let source = await http(new Engine(options)); apps.add(source);
  t.after(async () => {
    for (const app of apps) await app.app.close(); await journal?.close();
    const actual = await realpath(directory), child = relative(base, actual);
    assert.equal(dirname(actual), base);
    assert.ok(child && !isAbsolute(child) && !child.startsWith('..') && child.startsWith('chausar-activation-independent-'));
    await rm(actual, {recursive: true, force: true}); assert.equal(providerCalls, 0);
  });
  await source.rpc('workspace.create', {name: 'Independent synthetic activation shop', pack: 'retail',
    passphrase: SOURCE_PASSWORD, demo: false});
  const inputs = [input(A), input(B)], imports = [];
  for (const value of inputs) {
    const imported = await source.rpc('sources.import', value); assert.equal(imported.coverage.reconciled, true);
    assert.equal(imported.totalsMinor, value.expectedTotals!.amountMinor); imports.push(imported);
  }
  const facts = await source.rpc('memory.list'), invoice = facts.facts.find((fact: any) => fact.entityId === '00017');
  assert.ok(invoice, 'Leading-zero identity must survive actual CSV import.');
  t.mock.timers.setTime(Date.parse('2026-10-02T12:00:00.000Z'));
  await source.rpc('memory.correct', {id: invoice.id, fields: {amountMinor: '25000', taxMinor: '1500'}});
  const dictionary = (await source.rpc('ontology.get')).current;
  const draft = Object.fromEntries(['pack', 'label', 'currency', 'gstMode', 'fields', 'definitions'].map(key => [key, dictionary[key]]));
  (draft.definitions as any[]).find(definition => definition.name === 'billed').field = 'taxMinor';
  (draft.definitions as any[]).find(definition => definition.name === 'billed').meaning = 'Independent activation: billed is explicitly imported invoice tax.';
  await source.rpc('ontology.publish', {draft});
  t.mock.timers.setTime(Date.parse(CURRENT_CUT));
  const published = (await source.rpc('ontology.get')).current;
  const saved = await source.rpc('calculation.run', {operation: 'billed', sourceIds: [A], branch: 'main', period: PERIOD, asOf: CURRENT_CUT});
  assert.equal(saved.totalMinor, '1500');
  const answer = (await source.rpc('trials.savedQuestions')).find((item: any) => item.receiptId === saved.id);
  assert.ok(answer);
  const replacement = {...published.definitions.find((definition: any) => definition.name === 'billed'),
    field: 'amountMinor', meaning: 'Independent inert diagnostic trial of reported invoice net amount.'};
  const createTrial = () => source.rpc('trials.create', {version: 1, savedAnswerIds: [answer.id],
    change: {type: 'definition', name: 'billed', replacement}});
  const activeTrial = await createTrial(), evaluation = await source.rpc('trials.evaluate', {trialId: activeTrial.trialId});
  assert.equal(evaluation.status, 'evaluated');
  const discardedTrial = await createTrial(), discarded = await source.rpc('trials.discard', {trialId: discardedTrial.trialId});
  assert.equal(discarded.cleanupComplete, true);
  const member = await source.rpc('members.add', {name: 'Independent historical accountant', role: 'accountant', branches: ['main']});
  const session = await source.rpc('auth.session', {memberId: member.id});
  assert.equal((await source.raw('workspace.status', {}, session.token)).status, 200);
  await source.rpc('trust.update', {send: 'shape', autonomy: true, sharing: true, retentionDays: 3650});
  const prior = await source.rpc('workspace.interchange.export', {destinationId: 'independent_discarded_export', confirmed: true});
  await source.rpc('workspace.interchange.discard', {recordId: prior.recordId, reviewedDigest: prior.packageDigest});
  const historical = source.engine.vault!.read();
  const material = await source.rpc('workspace.interchange.export', {destinationId: IDS.material, confirmed: true}); publicMetadata(material);
  const original = await source.engine.vault!.snapshot(() => source.engine.vault!.captureEncryptedCustody(captureBudgets));
  const originalDisk = await encryptedFiles(source.engine.vault!.directory);
  assert.deepEqual(originalDisk, Object.fromEntries([
    ['authority.encrypted.json', sha(original.authority)],
    ...original.artifacts.map(item => [join('private-artifacts', item.ref.purpose, `${item.ref.id}.encrypted.json`), sha(item.bytes)]),
  ]), 'Independent physical ciphertext census must match every captured authority/artifact, with no omitted file.');
  const made = await source.rpc('workspace.backup.v2.create', {destinationId: IDS.backup, confirmed: true}); publicMetadata(made);
  const reviewed = await source.rpc('workspace.backup.v2.read', {backupId: IDS.backup}); publicMetadata(reviewed);
  const inert = await source.rpc('workspace.backup.v2.restoreInert', {backupId: IDS.backup, targetId: IDS.inert,
    reviewedDigest: made.archiveDigest, confirmed: true}); publicMetadata(inert);
  const archive = await source.engine.vault!.readArtifact({id: artifactId('wb2', IDS.backup, 'archive'), purpose: 'workspace-interchange'});
  const archiveText = (archive.value as {content: string}).content;
  journal = (await Vault.create({directory: join(directory, 'independent-journal'), storage: 'experimental-file',
    name: 'Independent separate synthetic control vault', passphrase: JOURNAL_PASSWORD, demo: false})).vault;
  const policy: WorkspaceActivationPolicy = {approvedSyntheticWorkspaceIds: [historical.workspace.id],
    allowedSyntheticSourceIds: [A, B], retentionDays: 90,
    budgets: {maxCandidateBytes: 32_000_000, maxArtifactBytes: 24_000_000, maxArtifacts: 100, maxFacts: 100, maxRecords: 2000}};
  const install = (inputPolicy = policy, credential: NonNullable<EngineOptions['workspaceActivation']>['targetPassphrase'] = async () => TARGET_PASSWORD) => {
    source.engine.options.workspaceActivation = {journalVault: journal!, policy: inputPolicy, targetPassphrase: credential};
  };
  const reattach = async () => {await source.rpc('workspace.lock'); await source.rpc('workspace.open', {passphrase: SOURCE_PASSWORD});};
  install(); await reattach();
  const selection = {backupId: IDS.backup, materialId: IDS.material, inertTargetId: IDS.inert,
    inertCreationId: inert.creationId, candidateId: IDS.candidate, targetId: IDS.target,
    reviewedArchiveDigest: made.archiveDigest, confirmed: true};
  return {directory, original, originalDisk, historical, inputs, imports, activeTrial, discardedTrial, session, published,
    reviewed, inert, made, archiveText, policy, selection, install, reattach,
    get source() {return source;}, get journal() {return journal!;},
    async prepare() {
      const reservation = await source.rpc('workspace.activation.target.create', {targetId: IDS.target, confirmed: true});
      assert.equal(reservation.authorityRecords, 0); assert.ok(reservation.stores.every((store: any) => store.records === 0));
      assert.deepEqual(await readdir(join(directory, IDS.target)), []);
      const bridge = await source.rpc('workspace.backup.activation.prepare', selection); publicMetadata(bridge);
      const review = await source.rpc('workspace.activation.review', {candidateId: IDS.candidate, reviewedDigest: bridge.reviewedDigest});
      publicMetadata(review);
      const execute = {candidateId: IDS.candidate, reviewedDigest: bridge.reviewedDigest,
        projectionDigest: review.projectionDigest, activationId: IDS.activation, confirmed: true};
      return {reservation, bridge, review, execute};
    },
    async target() {const target = await http(await source.engine.activatedWorkspaceEngine(source.engine.bootstrapContext(), IDS.activation));
      apps.add(target); return target;},
    async close(app: Http) {await app.app.close(); apps.delete(app);},
    async restart() {
      await source.app.close(); apps.delete(source); await journal!.close();
      journal = await Vault.open({directory: join(directory, 'independent-journal'), storage: 'experimental-file', passphrase: JOURNAL_PASSWORD});
      source = await http(new Engine(options)); apps.add(source); install();
      await source.rpc('workspace.open', {passphrase: SOURCE_PASSWORD});
    },
  };
}

export async function encryptedFiles(directory: string) {
  const result: Record<string, string> = {};
  const walk = async (path: string) => {
    for (const entry of await readdir(path, {withFileTypes: true})) {
      assert.equal(entry.isSymbolicLink(), false);
      const file = join(path, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile() && entry.name.endsWith('.encrypted.json')) result[relative(directory, file)] = sha(await readFile(file));
    }
  };
  await walk(directory); return result;
}

export function assertArchiveInventory(text: string, original: VaultEncryptedCustodyCapture) {
  const archive = JSON.parse(text);
  assert.equal(archive.backupFormat, 'chausar.backup.v2'); assert.equal(archive.pin.fullWorkspacePortable, false);
  assert.deepEqual(Buffer.from(archive.authorityBase64, 'base64'), Buffer.from(original.authority));
  assert.deepEqual(archive.pin.authority, {bytes: original.authority.length, sha256: sha(original.authority)});
  const expected = [...original.artifacts].sort((a, b) => a.ref.purpose.localeCompare(b.ref.purpose) || a.ref.id.localeCompare(b.ref.id));
  assert.equal(archive.artifacts.length, expected.length); assert.equal(archive.pin.artifacts.length, expected.length);
  const keys = archive.artifacts.map((item: any) => `${item.purpose}/${item.id}`);
  assert.equal(new Set(keys).size, expected.length);
  for (const actual of expected) {
    const saved = archive.artifacts.find((item: any) => item.id === actual.ref.id && item.purpose === actual.ref.purpose);
    assert.ok(saved); assert.deepEqual(Buffer.from(saved.dataBase64, 'base64'), Buffer.from(actual.bytes));
    const manifest = archive.pin.artifacts.find((item: any) => item.id === actual.ref.id && item.purpose === actual.ref.purpose);
    assert.deepEqual(manifest, {id: actual.ref.id, purpose: actual.ref.purpose, valueDigest: actual.ref.valueDigest,
      bytes: actual.bytes.length, sha256: sha(actual.bytes)});
  }
}
