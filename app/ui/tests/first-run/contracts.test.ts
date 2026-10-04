import assert from 'node:assert/strict';
import test from 'node:test';
import {
  COMPILED_SUM_CONTENT_KEYS, STARTER_PACK_IDS, canPublish, compiledSumContentJson, draftOf, firstRunFailure, isStarterPackId, meaningText, publishedContentJson, sameAuthority, sameContext,
  validateDraft, validateOntologyReadback, validatePacks, validatePublished, withMeaning,
} from '../../src/screens/first-run/contracts.ts';
import type { Definition } from '../../src/screens/first-run/contracts.ts';
import { compiledSumsVerified, definitionJson, draftJson, publishedHashVerified, publishedVerified, settingsJson, webCryptoDigest } from '../../src/screens/first-run/digest.ts';
import { ENGINE_PACK_IDS, engine, nodeDigest, rehashed, sha256 } from './fixture.ts';
import type { UiContext } from '../../src/host/contracts.ts';

/** Synthetic data only: the frozen Engine's own starter packs and compiler through the checked fixture boundary, no business facts. */
const must = <T>(value: T | null | undefined, what = 'value'): T => { if (value === null || value === undefined) throw new Error(`missing ${what}`); return value; };
const rejects = (run: () => unknown, label: string) => assert.throws(run, (error: unknown) => (error as { code?: unknown }).code === 'INVALID_REPLY', label);
const edit = (value: unknown, change: (obj: Record<string, unknown>) => void): unknown => { const copy = structuredClone(value) as Record<string, unknown>; change(copy); return copy; };
const records = (value: unknown, key: string): Record<string, unknown>[] => (value as Record<string, unknown[]>)[key] as Record<string, unknown>[];
const seat = (over: Partial<{ role: UiContext['member']['role']; epoch: number; workspace: string; member: string; key: string }> = {}): UiContext => ({
  workspace: { id: over.workspace ?? 'workspace_fixture', name: 'Fixture', demo: true },
  member: { id: over.member ?? 'member_fixture', name: 'Fixture', role: over.role ?? 'owner', epoch: over.epoch ?? 1, branches: ['*'] },
  contextKey: over.key ?? 'a'.repeat(64),
});
const definitionNamed = (definitions: readonly Definition[], name: string): Definition => must(definitions.find(item => item.name === name), name);

test('the six Engine starter packs validate in Engine order, exactly six, and come back frozen and detached', async () => {
  const frozen = await engine();
  const raw = frozen.rawPacks();
  const checked = validatePacks(raw);
  assert.deepEqual(checked.map(pack => pack.pack), ENGINE_PACK_IDS);
  assert.deepEqual([...STARTER_PACK_IDS], ENGINE_PACK_IDS, 'the selectable starters are exactly the Engine six');
  const firstPack = must(checked[0]);
  assert.ok(Object.isFrozen(checked) && Object.isFrozen(firstPack) && Object.isFrozen(must(firstPack.definitions[0])));
  assert.equal(JSON.stringify(checked), JSON.stringify(raw), 'key order and content are preserved exactly');
  (raw[0] as { label: string }).label = 'mutated after validation';
  assert.equal(firstPack.label, 'Online brand');
  assert.ok(checked.every(pack => pack.currency === 'INR' && pack.gstMode === 'regular'), 'every pack proposes INR and regular GST; the screen must still ask');
  rejects(() => validatePacks(raw.slice(0, 5)), 'five packs are not the Engine list');
  rejects(() => validatePacks([...frozen.rawPacks(), edit(frozen.rawPack(0), obj => { obj.pack = 'extra_pack'; })]), 'a seventh pack is not a starter');
  rejects(() => validatePacks([...frozen.rawPacks()].reverse()), 'the Engine order is the only order');
  rejects(() => validatePacks(frozen.rawPacks().map((pack, index) => (index === 0 ? edit(pack, obj => { obj.pack = 'Custom Acme workspace'; }) : pack))), 'a custom identity is never a selectable starter');
  assert.equal(isStarterPackId('saas'), true);
  assert.equal(isStarterPackId('Custom Acme workspace'), false);
});

test('malformed, inherited, accessor, oversized and unsafe pack data is refused', async () => {
  const frozen = await engine();
  const one = () => frozen.rawPack(0);
  rejects(() => validatePacks([]), 'no packs');
  rejects(() => validatePacks([one(), one()]), 'duplicate pack ids');
  rejects(() => validateDraft(edit(one(), obj => { obj.extra = true; })), 'unknown property');
  rejects(() => validateDraft(edit(one(), obj => { delete obj.gstMode; })), 'missing property');
  rejects(() => validateDraft(edit(one(), obj => { obj.gstMode = 'exempt'; })), 'unknown GST mode');
  rejects(() => validateDraft(edit(one(), obj => { obj.currency = 'inr'; })), 'currency code shape');
  rejects(() => validateDraft(edit(one(), obj => { obj.label = undefined; })), 'undefined value');
  rejects(() => validateDraft(edit(one(), obj => { (obj.fields as Record<string, unknown>).amountMinor = 'string'; })), 'a definition bound to a non-money field');
  rejects(() => validateDraft(edit(one(), obj => { must(records(obj, 'definitions')[0]).currency = 'USD'; })), 'definition currency differs from the draft');
  rejects(() => validateDraft(edit(one(), obj => { must(records(obj, 'definitions')[0]).meaning = 'too short'; })), 'meaning under the Engine minimum');
  rejects(() => validateDraft(edit(one(), obj => { must(records(obj, 'definitions')[0]).meaning = 'contains a control \u0007 character here'; })), 'control characters');
  rejects(() => validateDraft(edit(one(), obj => { must(records(obj, 'definitions')[1]).name = 'billed'; })), 'duplicate measure names');
  rejects(() => validateDraft(edit(one(), obj => { must(records(obj, 'definitions')[0]).sign = 2; })), 'invalid sign');
  rejects(() => validateDraft(edit(one(), obj => { must(records(obj, 'definitions')[0]).extra = 'x'; })), 'unknown definition property');
  rejects(() => validateDraft(edit(one(), obj => { obj.fields = JSON.parse('{"__proto__": "money"}'); })), 'prototype-named field');
  rejects(() => validateDraft(Object.assign(Object.create({ pack: 'ecommerce' }) as Record<string, unknown>, one())), 'inherited prototype');
  const accessor: Record<string, unknown> = structuredClone(one());
  Object.defineProperty(accessor, 'label', { get: () => 'Online brand', enumerable: true, configurable: true });
  rejects(() => validateDraft(accessor), 'accessor property');
  rejects(() => validateDraft(Object.assign(structuredClone(one()), { [Symbol('x')]: 1 })), 'symbol property');
  rejects(() => validateDraft(edit(one(), obj => { obj.pack = 'Custom Acme workspace'; })), 'a reviewable draft must be a starter');
  assert.equal(validateDraft(edit(one(), obj => { obj.pack = 'Custom Acme workspace'; }), 'draft', 'identity').pack, 'Custom Acme workspace', 'a published identity may be custom');
  rejects(() => validateDraft(edit(one(), obj => { obj.pack = 'x'.repeat(101); }), 'draft', 'identity'), 'a custom identity is bounded');
  rejects(() => validateDraft(edit(one(), obj => { obj.pack = 'two\nlines'; }), 'draft', 'identity'), 'a custom identity is one line');
});

test('a compiled dictionary validates, its Engine hash and compiled artifact hashes are verified over its exact content, and tampering is detected', async () => {
  const frozen = await engine();
  const compiled = frozen.compileRaw(frozen.rawPack(0), 3, 'member_fixture');
  const checked = validatePublished(structuredClone(compiled));
  assert.equal(checked.hash, compiled.hash);
  assert.equal(sha256(publishedContentJson(checked)), compiled.hash, 'the content JSON without hash is exactly what the Engine hashed');
  const digest = webCryptoDigest();
  assert.equal(await digest('fixture text'), sha256('fixture text'), 'WebCrypto SHA-256 agrees with Node SHA-256');
  assert.equal(await publishedHashVerified(checked, digest), true);
  assert.equal(await compiledSumsVerified(checked, digest), true, 'every definitionHash and artifact digest recomputes over the received objects');
  assert.equal(await publishedVerified(checked, digest), true);
  const sums = must(checked.compiledSums);
  const first = must(sums[0]);
  assert.equal(sha256(definitionJson(definitionNamed(checked.definitions, first.definitionName))), first.definitionHash);
  assert.equal(sha256(compiledSumContentJson(first)), first.digest);
  const tampered = validatePublished(edit(compiled, obj => { obj.label = 'Tampered label'; }));
  assert.equal(await publishedHashVerified(tampered, digest), false);
  assert.equal(draftJson(draftOf(checked)), JSON.stringify(frozen.rawPack(0)), 'the draft part of the publication is exactly the submitted draft');
  rejects(() => validatePublished(edit(compiled, obj => { obj.hash = 'not-a-hash'; })), 'hash shape');
  rejects(() => validatePublished(edit(compiled, obj => { obj.version = 0; })), 'version');
  rejects(() => validatePublished(edit(compiled, obj => { obj.schema = { ...(obj.schema as object), extraField: 'money' }; })), 'schema differs from fields');
  rejects(() => validatePublished(edit(compiled, obj => { must(records(obj, 'compiledSums')[0]).dictionaryVersion = 2; })), 'compiled sum revision');
  rejects(() => validatePublished(edit(compiled, obj => { must(records(obj, 'operations')[0]).definitions = ['unknown_measure']; })), 'operation over an unknown definition');
  // The independent audit's case: a compiled sum naming a different record kind, with the overall hash recomputed, is structurally refused.
  const rebound = rehashed(edit(compiled, obj => { must(records(obj, 'compiledSums')[0]).recordKind = 'payment'; }) as Record<string, unknown>);
  rejects(() => validatePublished(rebound), 'a compiled sum must bind exactly its definition');
  rejects(() => validatePublished(rehashed(edit(compiled, obj => { must(records(obj, 'compiledSums')[0]).moneyField = 'taxMinor'; }) as Record<string, unknown>)), 'money field drift');
  rejects(() => validatePublished(rehashed(edit(compiled, obj => { must(records(obj, 'compiledSums')[0]).nullPolicy = 'exclude'; }) as Record<string, unknown>)), 'null policy drift');
  rejects(() => validatePublished(rehashed(edit(compiled, obj => { must(records(obj, 'compiledSums')[0]).operationId = 'net_sales'; }) as Record<string, unknown>)), 'a multi-definition operation has no compiled sum');
  rejects(() => validatePublished(rehashed(edit(compiled, obj => { (obj.compiledSums as unknown[]).pop(); }) as Record<string, unknown>)), 'every single-definition sum operation is compiled');
  rejects(() => validatePublished(rehashed(edit(compiled, obj => { ((obj.checks as Record<string, unknown>).nullRules as Record<string, unknown>).billed = 'exclude'; }) as Record<string, unknown>)), 'null rules are derived from the definitions');
  // A compiled artifact with a wrong digest but a consistent binding passes the shape and fails the asynchronous hash check.
  const forged = validatePublished(rehashed(edit(compiled, obj => { must(records(obj, 'compiledSums')[0]).digest = 'e'.repeat(64); }) as Record<string, unknown>));
  assert.equal(await publishedHashVerified(forged, digest), true, 'the overall hash was recomputed by the forger');
  assert.equal(await compiledSumsVerified(forged, digest), false);
  assert.equal(await publishedVerified(forged, digest), false);
  const forgedDefinition = validatePublished(rehashed(edit(compiled, obj => { must(records(obj, 'compiledSums')[0]).definitionHash = 'e'.repeat(64); }) as Record<string, unknown>));
  assert.equal(await compiledSumsVerified(forgedDefinition, nodeDigest), false);
  for (let index = 0; index < 6; index++) {
    assert.equal(await publishedVerified(frozen.compile(frozen.pack(index), 1), nodeDigest), true, `Engine pack ${index} verifies completely`);
  }
});

test('a compiled sum digest is over the compiler\'s fixed field order, exactly as the Engine reconstructs it: a reordered artifact digested over its wire order is refused with the Engine, a reordered artifact with the compiler digest is accepted with the Engine', async () => {
  const frozen = await engine();
  const compiled = frozen.compileRaw(frozen.rawPack(0), 1, 'member_fixture');
  const sums = records(compiled, 'compiledSums');
  const original = must(sums[0]);
  const operationId = String(original.operationId);
  const definition = must(records(compiled, 'definitions').find(item => item.name === original.definitionName), 'bound definition');
  assert.deepEqual([...COMPILED_SUM_CONTENT_KEYS], ['contractVersion', 'compilerVersion', 'type', 'operationId', 'definitionName', 'recordKind', 'moneyField', 'currency', 'sign', 'nullPolicy', 'dictionaryVersion', 'definitionHash'], 'the compiler content order of compiled-calculation.ts');
  assert.equal(frozen.assertCompiledSum(original, operationId, definition, 1), null, 'the genuine artifact passes the Engine assertion');
  // The independent repro: same values, reversed wire order, digest recomputed over that wire order, whole hash recomputed.
  const reversed: Record<string, unknown> = Object.fromEntries(Object.entries(original).filter(([key]) => key !== 'digest').reverse());
  const wireDigested = { ...reversed, digest: sha256(JSON.stringify(reversed)) };
  assert.notEqual(wireDigested.digest, original.digest);
  assert.equal(frozen.assertCompiledSum(wireDigested, operationId, definition, 1), 'COMPILED_SUM_MISMATCH', 'the Engine refuses a digest over the wire order');
  const wireDictionary = validatePublished(rehashed({ ...compiled, compiledSums: [wireDigested, ...sums.slice(1)] }));
  assert.equal(await publishedHashVerified(wireDictionary, nodeDigest), true, 'the whole hash was recomputed by the forger and verifies on its own');
  assert.equal(await compiledSumsVerified(wireDictionary, nodeDigest), false, 'this slice refuses it exactly as the Engine does');
  assert.equal(await publishedVerified(wireDictionary, nodeDigest), false);
  // Same values in the reversed wire order but with the compiler-order digest: the Engine accepts it, and so does this slice.
  const compilerDigested = { ...reversed, digest: original.digest };
  assert.equal(frozen.assertCompiledSum(compilerDigested, operationId, definition, 1), null);
  const compilerDictionary = validatePublished(rehashed({ ...compiled, compiledSums: [compilerDigested, ...sums.slice(1)] }));
  assert.equal(await compiledSumsVerified(compilerDictionary, nodeDigest), true);
  const checkedFirst = must(must(validatePublished(structuredClone(compiled)).compiledSums)[0]);
  assert.equal(compiledSumContentJson(checkedFirst), JSON.stringify(Object.fromEntries(COMPILED_SUM_CONTENT_KEYS.map(key => [key, original[key]]))), 'the content JSON is the compiler order of the received values');
  assert.equal(sha256(compiledSumContentJson(checkedFirst)), original.digest);
  // The whole dictionary hash, the draft and the definitions stay over their authored order: nothing else is canonicalized.
  assert.equal(sha256(publishedContentJson(validatePublished(structuredClone(compiled)))), compiled.hash);
  assert.equal(sha256(JSON.stringify(definition)), original.definitionHash, 'definitionHash is over the authored definition order');
  // Every genuine artifact of all six Engine packs agrees with the Engine's own assertion and verifies here.
  for (let index = 0; index < 6; index++) {
    const dictionary = frozen.compile(frozen.pack(index), 1);
    for (const sum of must(dictionary.compiledSums)) assert.equal(frozen.assertCompiledSum(sum, sum.operationId, definitionNamed(dictionary.definitions, sum.definitionName), 1), null, `${dictionary.pack} ${sum.operationId}`);
    assert.equal(await publishedVerified(dictionary, nodeDigest), true, `Engine pack ${index} verifies completely`);
  }
});

test('ontology.get is the current/history envelope at this HEAD; a custom published identity is accepted there; a bare dictionary is refused', async () => {
  const frozen = await engine();
  const compiled = frozen.compileRaw(frozen.rawPack(0), 1, 'owner');
  const empty = validateOntologyReadback({ current: null, history: [] });
  assert.equal(empty.current, null);
  const loaded = validateOntologyReadback({ current: structuredClone(compiled), history: [structuredClone(compiled)] });
  assert.equal(loaded.current?.hash, compiled.hash);
  assert.equal(loaded.history.length, 1);
  // The frozen Engine test suite publishes `Custom Acme workspace`; that valid current dictionary must not block the step.
  const custom = frozen.compileRaw({ ...frozen.rawPack(0), pack: 'Custom Acme workspace', label: 'Explicit synthetic custom dictionary' }, 1, 'owner');
  const customReadback = validateOntologyReadback({ current: custom, history: [custom] });
  assert.equal(customReadback.current?.pack, 'Custom Acme workspace');
  assert.equal(await publishedVerified(must(customReadback.current), nodeDigest), true);
  rejects(() => validateOntologyReadback(structuredClone(compiled)), 'bare dictionary');
  rejects(() => validateOntologyReadback({ current: null }), 'missing history');
  rejects(() => validateOntologyReadback({ current: null, history: [], extra: 1 }), 'extra key');
});

test('a changed meaning keeps every other binding, the key order and the other definitions exactly', async () => {
  const frozen = await engine();
  const draft = validateDraft(frozen.rawPack(0));
  const changed = withMeaning(draft, 'earned', 'Delivered goods only, by the delivery date in the courier record.');
  assert.equal(Object.keys(changed).join(','), Object.keys(draft).join(','));
  const before = definitionNamed(draft.definitions, 'earned');
  const after = definitionNamed(changed.definitions, 'earned');
  assert.equal(Object.keys(after).join(','), Object.keys(before).join(','));
  assert.deepEqual({ ...after, meaning: before.meaning }, { ...before });
  assert.equal(JSON.stringify(changed.definitions.filter(item => item.name !== 'earned')), JSON.stringify(draft.definitions.filter(item => item.name !== 'earned')));
  assert.equal(settingsJson(changed), settingsJson(draft), 'settings are untouched by a meaning change');
  assert.notEqual(definitionJson(after), definitionJson(before));
  rejects(() => withMeaning(draft, 'earned', 'short'), 'Engine minimum length');
  rejects(() => withMeaning(draft, 'missing', 'A meaning for a measure that does not exist.'), 'unknown name');
  assert.equal(meaningText('  exactly eleven+  '), '  exactly eleven+  ', 'the exact typed text is kept');
});

test('authority identity and failure mapping are fixed codes, never raw errors', () => {
  assert.equal(canPublish(seat()), true);
  assert.equal(canPublish(seat({ role: 'cofounder' })), true);
  assert.equal(canPublish(seat({ role: 'accountant' })), false);
  assert.equal(canPublish(seat({ role: 'viewer' })), false);
  assert.equal(sameAuthority(seat(), seat({ key: 'b'.repeat(64) })), true, 'a changed key is the same seat');
  assert.equal(sameContext(seat(), seat({ key: 'b'.repeat(64) })), false);
  assert.equal(sameAuthority(seat(), seat({ epoch: 2 })), false);
  assert.equal(sameAuthority(seat(), seat({ role: 'cofounder' })), false);
  assert.equal(sameAuthority(seat(), seat({ workspace: 'other' })), false);
  assert.deepEqual(firstRunFailure(Object.assign(new Error('x'), { code: 'INVALID_DEFINITION' })), { code: 'PUBLISH_REFUSED', engineCode: 'INVALID_DEFINITION' });
  assert.deepEqual(firstRunFailure(Object.assign(new Error('x'), { code: 'authority_denied' })), { code: 'ACCESS_DENIED' });
  assert.deepEqual(firstRunFailure(Object.assign(new Error('x'), { code: 'VAULT_LOCKED' })), { code: 'VAULT_LOCKED' });
  assert.deepEqual(firstRunFailure(new Error('socket closed')), { code: 'REQUEST_FAILED' });
  assert.deepEqual(firstRunFailure(null), { code: 'REQUEST_FAILED' });
  const proxyError = new Proxy({}, { getOwnPropertyDescriptor() { throw new Error('trap'); } });
  assert.deepEqual(firstRunFailure(proxyError), { code: 'REQUEST_FAILED' });
});
