import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import type { Context, State } from '../runtime/contracts.ts';
import { Vault } from '../runtime/vault.ts';
import { starterPacks, type Dictionary, type OntologyService, type OntologySnapshot } from '../runtime/ontology.ts';

// Actual Engine dispatch and serialized encrypted file Vault, using only
// synthetic local data. These fixtures exercise no native, PostgreSQL, browser,
// provider, credential or acquisition integration and claim no qualification.
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const passphrase = 'Synthetic first-run dictionary review passphrase';
const dictionary = () => structuredClone(starterPacks.find(pack => pack.pack === 'retail')!);

async function fixture(t: TestContext) {
  const base = await realpath(tmpdir());
  const directory = await realpath(await mkdtemp(join(base, 'chausar-engine-ontology-review-')));
  const engines: Engine[] = [];
  const engineFor = () => {
    const engine = new Engine({ directory, demo: true, storage: 'experimental-file' });
    engines.push(engine); return engine;
  };
  t.after(async () => {
    try { for (const engine of engines) await engine.close(); }
    finally {
      const actual = await realpath(directory), child = relative(base, actual);
      assert.equal(dirname(actual), base);
      assert.ok(child && !isAbsolute(child) && !child.startsWith('..') && child.startsWith('chausar-engine-ontology-review-'));
      await rm(actual, { recursive: true, force: true });
    }
  });
  return { directory, engineFor, engine: engineFor(),
    ciphertext: () => readFile(join(directory, 'main', 'authority.encrypted.json')) };
}
const create = (engine: Engine, extra: Record<string, unknown> = {}) => engine.requestAs(owner, 'workspace.create', {
  name: 'Synthetic first-run dictionary review', passphrase, demo: false, ...extra,
});

test('deferred Engine creation and fresh reopen publish no dictionary until the exact reviewed first submission', async t => {
  const f = await fixture(t);
  await create(f.engine, { dictionaryMode: 'deferred' });
  const fresh = f.engine.vault!.read(), ciphertext = await f.ciphertext();
  assert.deepEqual(fresh.ontology, { current: null, history: [], firstRunReviewRequired: true });
  assert.equal(fresh.revision, 0);
  assert.equal(fresh.learning.length, 0); assert.equal(fresh.activity.length, 0);
  assert.deepEqual(await f.engine.requestAs(owner, 'ontology.get', {}), { current: null, history: [] });
  assert.deepEqual(await f.engine.requestAs(owner, 'ontology.get', { attemptId: 'synthetic-first-review' }),
    { current: null, history: [], attempt: null });
  await f.engine.requestAs(owner, 'ontology.packs', {});
  assert.deepEqual(f.engine.vault!.read(), fresh); assert.deepEqual(await f.ciphertext(), ciphertext);
  await f.engine.requestAs(owner, 'workspace.lock', {});
  const reopened = f.engineFor();
  await reopened.requestAs(owner, 'workspace.open', { passphrase });
  assert.deepEqual(reopened.vault!.read(), fresh); assert.deepEqual(await f.ciphertext(), ciphertext);
  assert.deepEqual(await reopened.requestAs(owner, 'ontology.get', {}), { current: null, history: [] });

  const draft = dictionary();
  for (const unreviewed of [draft, { draft }, { pack: 'retail' },
    { draft, expectedCurrentHash: null }, { pack: 'retail', expectedCurrentHash: null }]) {
    await assert.rejects(reopened.requestAs(owner, 'ontology.publish', unreviewed), { code: 'DICTIONARY_REVIEW_REQUIRED' });
    assert.deepEqual(reopened.vault!.read(), fresh); assert.deepEqual(await f.ciphertext(), ciphertext);
  }
  const published: Dictionary = await reopened.requestAs(owner, 'ontology.publish', {
    draft, expectedCurrentHash: null, attemptId: 'synthetic-first-review',
  });
  assert.equal(published.version, 1); assert.equal(published.pack, 'retail');
  const result: OntologySnapshot = await reopened.requestAs(owner, 'ontology.get', { attemptId: 'synthetic-first-review' });
  assert.deepEqual(result.current, published); assert.deepEqual(result.history, [published]);
  assert.equal(result.attempt?.dictionaryHash, published.hash);
  assert.equal(result.attempt?.expectedCurrentHash, null);
  const stored = reopened.vault!.read();
  assert.equal(stored.revision, 1); assert.equal(Object.hasOwn(stored.ontology, 'firstRunReviewRequired'), false);
  assert.equal(stored.learning.filter(entry => entry.category === 'dictionary').length, 1);
  assert.equal(stored.activity.filter(entry => entry.event === 'dictionary.published').length, 1);
  await reopened.requestAs(owner, 'workspace.lock', {});
  const again = f.engineFor(); await again.requestAs(owner, 'workspace.open', { passphrase });
  assert.deepEqual(await again.requestAs(owner, 'ontology.get', { attemptId: 'synthetic-first-review' }), result);
  assert.deepEqual(again.vault!.read(), stored);
});

test('deferred review requirement is present in the initial encrypted commit before Engine attaches the Vault', async t => {
  const f = await fixture(t), createVault = Vault.create.bind(Vault);
  let initial: State | undefined, initialCiphertext: Buffer | undefined;
  const captured = t.mock.method(Vault, 'create', async (...args: Parameters<typeof createVault>) => {
    const result = await createVault(...args);
    initial = result.vault.read(); initialCiphertext = await f.ciphertext();
    assert.equal(initial.revision, 0);
    assert.deepEqual(initial.ontology, { current: null, history: [], firstRunReviewRequired: true });
    assert.equal(initial.learning.length, 0); assert.equal(initial.activity.length, 0);
    return result;
  });
  await create(f.engine, { dictionaryMode: 'deferred' }); captured.mock.restore();
  assert.ok(initial); assert.ok(initialCiphertext);
  assert.deepEqual(f.engine.vault!.read(), initial, 'Attach and creation completion perform no second authority update.');
  assert.deepEqual(await f.ciphertext(), initialCiphertext);
  await f.engine.requestAs(owner, 'workspace.lock', {});
  await f.engine.requestAs(owner, 'workspace.open', { passphrase });
  assert.deepEqual(f.engine.vault!.read(), initial);
  assert.deepEqual(await f.ciphertext(), initialCiphertext);
});

test('omitted and explicit legacy creation retain immediate starter and synthetic demo behavior', async t => {
  for (const [label, input, expectedPack, demo] of [
    ['omitted legacy', {}, 'ecommerce', false],
    ['explicit legacy', { dictionaryMode: 'legacy', pack: 'services' }, 'services', false],
    ['synthetic demo legacy', { demo: true }, 'ecommerce', true],
  ] as const) await t.test(label, async sub => {
    const f = await fixture(sub); await create(f.engine, input);
    const result: OntologySnapshot = await f.engine.requestAs(owner, 'ontology.get', {});
    assert.equal(result.current?.pack, expectedPack); assert.equal(result.current?.version, 1);
    assert.deepEqual(result.history, [result.current]); assert.equal(Object.hasOwn(result, 'attempt'), false);
    assert.equal(f.engine.vault!.read().facts.length > 0, demo);
    assert.equal(f.engine.vault!.read().activity.filter(entry => entry.event === 'dictionary.published').length, 1);
  });
});

test('invalid or ambiguous deferred creation refuses before workspace custody is created', async t => {
  const f = await fixture(t);
  for (const input of [
    { dictionaryMode: 'unreviewed' }, { dictionaryMode: null }, { dictionaryMode: undefined },
    { dictionaryMode: 'deferred', demo: true },
    { dictionaryMode: 'deferred', demo: 'true' }, { dictionaryMode: 'deferred', demo: 1 },
    { dictionaryMode: 'deferred', pack: 'retail' }, { dictionaryMode: 'deferred', pack: undefined },
    { dictionaryMode: 'deferred', demoFixtureMonth: '2026-09' },
    { dictionaryMode: 'deferred', demoFixtureMonth: undefined },
  ]) {
    await assert.rejects(create(f.engine, input), { code: 'INVALID_DICTIONARY_MODE' });
    assert.equal(f.engine.vault, null);
    assert.deepEqual(await readdir(f.directory), [], 'Invalid first-run selection creates no workspace files.');
  }
});

test('deferred creation retains its initial options across asynchronous workspace creation', async t => {
  const f = await fixture(t);
  const input: Record<string, unknown> = { name: 'Synthetic reviewed creation input', passphrase, demo: false, dictionaryMode: 'deferred' };
  const pending = f.engine.requestAs(owner, 'workspace.create', input);
  input.demo = true; input.demoFixtureMonth = '2026-09'; input.dictionaryMode = 'legacy'; input.pack = 'ecommerce';
  input.name = 'Synthetic changed creation input'; input.passphrase = 'Synthetic changed passphrase';
  await pending;
  const state = f.engine.vault!.read();
  assert.equal(state.workspace.name, 'Synthetic reviewed creation input'); assert.equal(state.workspace.demo, false);
  assert.deepEqual(state.ontology, { current: null, history: [], firstRunReviewRequired: true });
  assert.equal(state.facts.length, 0); assert.equal(state.revision, 0);
  assert.equal(state.learning.length, 0); assert.equal(state.activity.length, 0);
  await f.engine.requestAs(owner, 'workspace.lock', {});
  await f.engine.requestAs(owner, 'workspace.open', { passphrase });
  assert.deepEqual(f.engine.vault!.read(), state, 'Creation uses the originally admitted local synthetic passphrase.');
});

test('deferred creation retains the legacy fresh-owner authorization requirement', async t => {
  for (const context of [
    { ...owner, memberId: 'synthetic-other-owner' },
    { ...owner, epoch: 2 },
    { ...owner, role: 'cofounder' as const },
    { ...owner, role: 'viewer' as const },
  ]) await t.test(`${context.memberId}:${context.role}:${context.epoch}`, async sub => {
    const f = await fixture(sub);
    await assert.rejects(f.engine.requestAs(context, 'workspace.create', {
      name: 'Synthetic refused fresh authority', passphrase, demo: false, dictionaryMode: 'deferred',
    }), { code: 'ACCESS_REVOKED' });
    assert.equal(f.engine.vault, null); assert.deepEqual(f.engine.services, {});
    await assert.rejects(readFile(join(f.directory, 'main', 'authority.encrypted.json')), { code: 'ENOENT' });
  });
});

test('Engine preserves adjacent publication CAS and attempts and rejects forged request options', async t => {
  const f = await fixture(t); await create(f.engine);
  const original: OntologySnapshot = await f.engine.requestAs(owner, 'ontology.get', {});
  assert.ok(original.current);
  const published: Dictionary = await f.engine.requestAs(owner, 'ontology.publish', {
    draft: dictionary(), expectedCurrentHash: original.current.hash, attemptId: 'synthetic-winning-review',
  });
  const stored = f.engine.vault!.read(), ciphertext = await f.ciphertext();
  await assert.rejects(f.engine.requestAs(owner, 'ontology.publish', {
    draft: dictionary(), expectedCurrentHash: original.current.hash, attemptId: 'synthetic-stale-review',
  }), { code: 'DICTIONARY_CONFLICT' });
  const found: OntologySnapshot = await f.engine.requestAs(owner, 'ontology.get', { attemptId: 'synthetic-winning-review' });
  assert.equal(found.attempt?.attemptId, 'synthetic-winning-review');
  assert.equal(found.attempt?.dictionaryHash, published.hash);
  const missing: OntologySnapshot = await f.engine.requestAs(owner, 'ontology.get', { attemptId: 'synthetic-stale-review' });
  assert.equal(missing.attempt, null);
  for (const [method, payload] of [
    ['ontology.get', { attemptId: 'synthetic-winning-review', memberId: 'owner' }],
    ['ontology.get', { attemptId: undefined }],
    ['ontology.publish', { draft: dictionary(), expectedCurrentHash: published.hash, attemptId: 'synthetic-forged-review', memberId: 'owner' }],
    ['ontology.publish', { draft: dictionary(), expectedCurrentHash: published.hash, attemptId: 'synthetic-forged-review', options: { expectedCurrentHash: original.current.hash } }],
    ['ontology.publish', { draft: dictionary(), attemptId: 'synthetic-no-baseline' }],
    ['ontology.publish', { draft: dictionary(), expectedCurrentHash: undefined, attemptId: 'synthetic-undefined-baseline' }],
  ] as const) await assert.rejects(f.engine.requestAs(owner, method, payload), { code: 'INVALID_DICTIONARY_OPTIONS' });
  assert.deepEqual(f.engine.vault!.read(), stored); assert.deepEqual(await f.ciphertext(), ciphertext);
});

test('Engine dispatch preserves legacy direct drafts and named starter packs with explicit publication options', async t => {
  const f = await fixture(t); await create(f.engine);
  const initial: OntologySnapshot = await f.engine.requestAs(owner, 'ontology.get', {});
  assert.ok(initial.current);
  const direct = dictionary(); direct.label = 'Synthetic direct legacy reviewed draft';
  const first: Dictionary = await f.engine.requestAs(owner, 'ontology.publish', direct);
  assert.equal(first.version, 2); assert.equal(first.label, direct.label);
  const second: Dictionary = await f.engine.requestAs(owner, 'ontology.publish', { pack: 'services' });
  assert.equal(second.version, 3); assert.equal(second.pack, 'services');
  const third: Dictionary = await f.engine.requestAs(owner, 'ontology.publish', {
    pack: 'retail', expectedCurrentHash: second.hash, attemptId: 'synthetic-reviewed-pack-wrapper',
  });
  assert.equal(third.version, 4); assert.equal(third.pack, 'retail');
  const result: OntologySnapshot = await f.engine.requestAs(owner, 'ontology.get', { attemptId: 'synthetic-reviewed-pack-wrapper' });
  assert.deepEqual(result.history, [initial.current, first, second, third]);
  assert.equal(result.attempt?.dictionaryHash, third.hash); assert.equal(result.attempt?.expectedCurrentHash, second.hash);
});

test('Engine dropped publication response is attributable only by its exact retained attempt after later publication', async t => {
  const f = await fixture(t); await create(f.engine, { dictionaryMode: 'deferred' });
  const firstRequest = { draft: dictionary(), expectedCurrentHash: null, attemptId: 'synthetic-response-lost' };
  const service = f.engine.services.ontology as OntologyService;
  const publishPayload = service.publishPayload.bind(service);
  const droppedResponse = new Error('Synthetic dispatcher response lost after encrypted publication');
  const dropped = t.mock.method(service, 'publishPayload', async (...args: Parameters<typeof publishPayload>) => {
    await publishPayload(...args); throw droppedResponse;
  });
  await assert.rejects(f.engine.requestAs(owner, 'ontology.publish', firstRequest), error => error === droppedResponse);
  dropped.mock.restore();
  const first: OntologySnapshot = await f.engine.requestAs(owner, 'ontology.get', { attemptId: firstRequest.attemptId });
  assert.ok(first.current); assert.ok(first.attempt);
  const later: Dictionary = await f.engine.requestAs(owner, 'ontology.publish', {
    draft: dictionary(), expectedCurrentHash: first.current.hash, attemptId: 'synthetic-later-identical-draft',
  });
  const stored = f.engine.vault!.read(), ciphertext = await f.ciphertext();
  const receipt: OntologySnapshot = await f.engine.requestAs(owner, 'ontology.get', { attemptId: firstRequest.attemptId });
  assert.deepEqual(receipt.attempt, first.attempt);
  assert.deepEqual(receipt.current, later); assert.equal(receipt.history.length, 2);
  const retry: Dictionary = await f.engine.requestAs(owner, 'ontology.publish', firstRequest);
  assert.deepEqual(retry, first.current);
  assert.deepEqual(f.engine.vault!.read(), stored); assert.deepEqual(await f.ciphertext(), ciphertext);
});
