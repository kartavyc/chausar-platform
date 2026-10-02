import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import { createLocalServer } from '../runtime/server.ts';
import { ExperimentalFileSnapshotAdapter } from '../runtime/vault.ts';
import { ChausarError, hash, type Context } from '../runtime/contracts.ts';
import type { Binding, ImportInput } from '../runtime/ingest.ts';
import { descendants, dialogFor, find, harness, hasText, namedButton } from './fixtures/conversation-acceptance-renderer.ts';

// Actual isolated synthetic HTTP, encrypted Vault, calculator and strict desktop IPC.
// Test-only legacy-record setup and completed-write faults grant no live/native/GUI qualification.
const sourceId = 'synthetic-legacy-answer-public', passphrase = 'Synthetic answer recovery fixture passphrase only';
const clock = '2026-10-02T12:00:00.000Z', newClock = '2026-10-03T12:00:00.000Z';
const period = { from: '2026-09-01', to: '2026-09-30' };
const scope = () => ({ asOf: newClock, period: { ...period }, comparePeriod: null, onDate: null });
const input: ImportInput = { sourceId, format: 'csv',
  content: 'id,kind,date,amount,tax,currency,branch,status\nI1,invoice,2026-09-02,100.00,10.00,INR,main,issued',
  recipe: { version: 1, id: 'synthetic-legacy-answer-recipe', system: 'synthetic-csv', edition: '1',
    scope: { company: 'Synthetic Recovery', branches: ['main'] }, bindings: [
      { target: 'entityId', source: 'id', type: 'string', nulls: 'reject' },
      { target: 'kind', source: 'kind', type: 'string', nulls: 'reject' },
      { target: 'validFrom', source: 'date', type: 'date', dateFormat: 'ISO', nulls: 'reject' },
      ...['amountMinor', 'taxMinor'].map((target): Binding => ({ target, source: target === 'amountMinor' ? 'amount' : 'tax',
        type: 'money', moneyUnit: 'major', currency: 'INR', nulls: 'reject' })),
      ...['currency', 'branch', 'status'].map((target): Binding => ({ target, source: target, type: 'string', nulls: 'reject' })),
    ], allowedKinds: ['invoice'], allowedStatuses: ['issued'], onUnmapped: 'reject' },
  expectedTotals: { rowCount: 1, amountMinor: '10000' } };

async function fixture(t: TestContext) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(clock) });
  // Match the Vault's canonical physical path even when Windows TEMP uses an alias.
  const base = await realpath(resolve(tmpdir())), directory = await mkdtemp(join(base, 'chausar-answer-recovery-public-'));
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file' });
  const app = createLocalServer(engine), { origin, token } = await app.listen();
  t.after(async () => { await app.close(); const target = resolve(directory), child = relative(base, target);
    assert.ok(child && !child.startsWith('..') && !isAbsolute(child) && child.startsWith('chausar-answer-recovery-public-'));
    await rm(target, { recursive: true, force: true }); });
  const raw = async (method: string, payload: unknown = {}, bearer = token) => {
    const response = await fetch(`${origin}/api/rpc`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` },
      body: JSON.stringify({ method, payload }) }); return { status: response.status, body: await response.json() as any };
  };
  const rpc = async (method: string, payload: unknown = {}, bearer = token) => { const value = await raw(method, payload, bearer);
    assert.equal(value.status, 200, JSON.stringify(value.body)); return value.body.result; };
  await rpc('workspace.create', { name: 'Synthetic Recovery', passphrase, demo: false, pack: 'retail' });
  await rpc('sources.import', input);
  const originalReceipt = await rpc('calculation.run', { operation: 'billed', period, sourceIds: [sourceId], branch: 'main', asOf: clock });
  const originalAnswerId = engine.vault!.read().answers.find(answer => answer.receiptId === originalReceipt.id)!.id as string;
  // Deliberately author a legacy fixture; production recovery NEVER removes or invents this cutoff.
  await engine.vault!.update(state => { delete state.answers.find(answer => answer.id === originalAnswerId)!.request.asOf; });
  const original = () => ({ answer: engine.vault!.read().answers.find(answer => answer.id === originalAnswerId),
    receipt: engine.vault!.read().receipts.find(receipt => receipt.id === originalReceipt.id) });
  const declaration = (review: any, timeScope = scope()) => ({ answerId: originalAnswerId, source: review.source,
    reviewedEvidencePin: review.reviewedEvidencePin, timeScope, confirmedNewCalculation: true });
  const prepare = async () => { const review = await rpc('answers.recovery.review', { answerId: originalAnswerId });
    return rpc('answers.recovery.prepare', declaration(review)); };
  const executePayload = (issued: any) => ({ newRequestId: issued.newRequestId, preparationDigest: issued.preparationDigest });
  const reopen = async () => { await rpc('workspace.lock'); await rpc('workspace.open', { passphrase }); };
  const refusal = async (method: string, payload: unknown, codes: string[]) => { const response = await raw(method, payload);
    assert.notEqual(response.status, 200); assert.ok(codes.includes(response.body.error.code), JSON.stringify(response.body)); };
  return { engine, rpc, raw, directory, originalAnswerId, originalReceipt, original, prepare, declaration, executePayload, reopen, refusal };
}

test('public fresh recovery uses the current dictionary, declared cutoff and one Vault revision; originals still block retrospective promotion', async t => {
  const f = await fixture(t);
  t.mock.timers.setTime(Date.parse(newClock));
  await f.rpc('memory.correct', { id: f.engine.vault!.read().facts[0].id, fields: { amountMinor: '25000' } });
  const dictionary = (await f.rpc('ontology.get')).current;
  const draft = Object.fromEntries(['pack', 'label', 'currency', 'gstMode', 'fields', 'definitions'].map(key => [key, dictionary[key]]));
  const definition = draft.definitions.find((item: any) => item.name === 'billed');
  definition.field = 'taxMinor'; definition.meaning = 'Synthetic current owner definition: count only explicitly reported invoice tax amounts.';
  const published = await f.rpc('ontology.publish', { draft });
  const originalBytes = JSON.stringify(f.original()), review = await f.rpc('answers.recovery.review', { answerId: f.originalAnswerId });
  assert.equal(review.status, 'new-time-scope-required'); assert.equal(review.historicalReplay, false);
  assert.equal(review.originalRequest.asOf, undefined); assert.equal(Object.hasOwn(review, 'asOf'), false);
  assert.equal(review.dictionary.hash, published.hash);
  const issued = await f.rpc('answers.recovery.prepare', f.declaration(review));
  const before = f.engine.vault!.read(), result = await f.rpc('answers.recovery.execute', f.executePayload(issued)), after = f.engine.vault!.read();
  assert.equal(result.status, 'completed'); assert.equal(after.revision, before.revision + 1);
  assert.equal(after.receipts.length, before.receipts.length + 1); assert.equal(after.answers.length, before.answers.length + 1);
  assert.equal(result.receipt.totalMinor, '1000'); assert.equal(result.receipt.dictionaryHash, published.hash);
  assert.equal(result.receipt.ontologyVersion, published.version); assert.equal(result.receipt.asOf, newClock);
  assert.equal(result.receipt.restatement, undefined); assert.equal(result.lineage.historicalReplay, false);
  assert.equal(result.lineage.grantsAuthority, false); assert.equal(result.lineage.newRequestDigest, hash(result.answer.request));
  assert.equal(result.lineage.source.originalAnswerId, f.originalAnswerId); assert.notEqual(result.answer.id, f.originalAnswerId);
  assert.equal(JSON.stringify(f.original()), originalBytes); assert.equal(f.original().answer.request.asOf, undefined);
  const repeated = await f.rpc('answers.recovery.execute', f.executePayload(issued)); assert.deepEqual(repeated, result);
  assert.equal(f.engine.vault!.read().revision, after.revision);
  await f.reopen(); assert.deepEqual(await f.rpc('answers.recovery.get', { newRequestId: issued.newRequestId }), result);
  assert.deepEqual((await f.rpc('answers.recovery.list', { answerId: f.originalAnswerId })).items, [result]);
  const replacement = { ...published.definitions.find((item: any) => item.name === 'billed'), field: 'amountMinor',
    meaning: 'Synthetic new private trial: explicitly reported current invoice net amount.' };
  const trial = await f.rpc('trials.create', { version: 1, savedAnswerIds: [result.answer.id], change: { type: 'definition', name: 'billed', replacement } });
  await f.rpc('trials.evaluate', { trialId: trial.trialId });
  await f.refusal('trials.impact', { trialId: trial.trialId, strategy: 'retrospective' }, ['TRIAL_REBUILD_REQUIRED']);
  assert.equal(JSON.stringify(f.original()), originalBytes);
});

test('public preparation rejects unknown fields, missing or inferred times, forged source pins, and pinned requests without writes', async t => {
  const f = await fixture(t), review = await f.rpc('answers.recovery.review', { answerId: f.originalAnswerId });
  const before = f.engine.vault!.read(), declaration = f.declaration(review);
  const variants = [
    { ...declaration, newRequestId: 'caller-issued-id' },
    { ...declaration, confirmedNewCalculation: false },
    { ...declaration, timeScope: { ...scope(), asOf: '2026-10-03' } },
    { ...declaration, timeScope: { ...scope(), asOf: '2026-02-30T00:00:00Z' } },
    { ...declaration, timeScope: { ...scope(), chooseNow: true } },
    { ...declaration, timeScope: { asOf: newClock, period, comparePeriod: null } },
    { ...declaration, source: { ...review.source, originalReceiptDigest: '0'.repeat(64) } },
    { ...declaration, reviewedEvidencePin: '0'.repeat(64) },
  ];
  for (const payload of variants) await f.refusal('answers.recovery.prepare', payload,
    ['INVALID_ANSWER_RECOVERY', 'ANSWER_RECOVERY_CONFIRMATION_REQUIRED', 'INVALID_ASOF', 'ANSWER_RECOVERY_SOURCE_CHANGED', 'ANSWER_RECOVERY_EVIDENCE_CHANGED']);
  await f.refusal('answers.recovery.review', { answerId: f.originalAnswerId, authority: true }, ['INVALID_ANSWER_RECOVERY']);
  assert.deepEqual(f.engine.vault!.read(), before);
  const pinned = await f.rpc('calculation.run', { operation: 'billed', sourceIds: [sourceId], asOf: clock });
  const answerId = f.engine.vault!.read().answers.find(answer => answer.receiptId === pinned.id)!.id;
  await f.refusal('answers.recovery.review', { answerId }, ['ANSWER_RECOVERY_NOT_UNPINNED']);
});

test('changed current evidence and exact preparation digest refuse before another receipt is persisted', async t => {
  const f = await fixture(t), issued = await f.prepare(), before = f.engine.vault!.read();
  await f.refusal('answers.recovery.execute', { ...f.executePayload(issued), preparationDigest: '0'.repeat(64) }, ['ANSWER_RECOVERY_PREPARATION_CHANGED']);
  assert.deepEqual(f.engine.vault!.read(), before);
  t.mock.timers.setTime(Date.parse(newClock));
  await f.rpc('memory.correct', { id: before.facts[0].id, fields: { amountMinor: '25000' } });
  const changed = f.engine.vault!.read();
  await f.refusal('answers.recovery.execute', f.executePayload(issued), ['ANSWER_RECOVERY_SOURCE_CHANGED', 'ANSWER_RECOVERY_EVIDENCE_CHANGED']);
  assert.deepEqual(f.engine.vault!.read(), changed);
  const next = await f.prepare(), result = await f.rpc('answers.recovery.execute', f.executePayload(next));
  assert.equal(result.receipt.totalMinor, '25000'); assert.notEqual(next.newRequestId, issued.newRequestId);
});

test('an authored legacy kinds-filter fixture refuses without dropping its filter or retaining a partial fresh result', async t => {
  const f = await fixture(t), reviewed = await f.rpc('answers.recovery.review', { answerId: f.originalAnswerId });
  // This is deliberately authored legacy state, NOT a request the current calculator can produce.
  // CalculatorService permits the key syntactically but explicitly refuses supplied kinds at admission.
  for (const kinds of [['invoice'], []] as string[][]) {
    await f.engine.vault!.update(state => { state.answers.find(answer => answer.id === f.originalAnswerId)!.request.kinds = kinds; });
    const before = f.engine.vault!.read(), originalBytes = JSON.stringify(f.original());
    await f.refusal('answers.recovery.review', { answerId: f.originalAnswerId }, ['INVALID_ANSWER_RECOVERY']);
    await f.refusal('answers.recovery.prepare', f.declaration(reviewed), ['INVALID_ANSWER_RECOVERY']);
    await f.refusal('calculation.run', { ...f.original().answer.request, asOf: newClock }, ['INVALID_CALCULATION']);
    assert.deepEqual(f.engine.vault!.read(), before, 'Refusal creates no issued preparation, fresh receipt, answer or lineage.');
    assert.equal(JSON.stringify(f.original()), originalBytes);
    assert.ok(Object.hasOwn(f.original().answer.request, 'kinds')); assert.deepEqual(f.original().answer.request.kinds, kinds);
  }
});

test('actual current owner, epoch, source access and unqualified managed-source guards withhold public recovery', async t => {
  const f = await fixture(t), issued = await f.prepare();
  const invited = await f.rpc('auth.invite', { name: 'Synthetic cofounder', role: 'cofounder', branches: ['*'] });
  const accepted = await f.rpc('auth.accept', { token: invited.token });
  const other = await f.raw('answers.recovery.get', { newRequestId: issued.newRequestId }, accepted.token);
  assert.notEqual(other.status, 200); assert.equal(other.body.error.code, 'ANSWER_RECOVERY_OWNER_REQUIRED');
  const stale: Context = { memberId: 'owner', role: 'owner', epoch: 2, channel: 'desktop' };
  await assert.rejects(f.engine.requestAs(stale, 'answers.recovery.review', { answerId: f.originalAnswerId }), (error: any) => error.code === 'ACCESS_REVOKED');
  await f.rpc('trust.update', { allowedSources: ['another-source'] });
  await f.refusal('answers.recovery.get', { newRequestId: issued.newRequestId }, ['SOURCE_REVOKED']);
  await f.refusal('answers.recovery.list', { answerId: f.originalAnswerId }, ['SOURCE_REVOKED']);
  await f.rpc('trust.update', { allowedSources: ['*'] });
  const ready = await f.prepare();
  await f.engine.vault!.update(state => { state.imports.push({ id: 'synthetic-incomplete-capture', type: 'connector-capture-v1', sourceId,
    domain: { company: 'Synthetic Recovery', dataset: 'invoices', branches: ['main'], period } }); });
  const before = f.engine.vault!.read();
  await f.refusal('answers.recovery.execute', f.executePayload(ready), ['CONNECTOR_CONSUMER_BINDING_REQUIRED', 'SOURCE_NOT_READY']);
  assert.deepEqual(f.engine.vault!.read(), before);
});

test('completed physical commit with lost acknowledgement fences same-handle retries and reopens the one durable fresh result', async t => {
  const f = await fixture(t), issued = await f.prepare(), before = f.engine.vault!.read(), originals = JSON.stringify(f.original());
  const prototype = ExperimentalFileSnapshotAdapter.prototype, original = prototype.commit;
  let completed = 0;
  const hook = t.mock.method(prototype, 'commit', async function (this: ExperimentalFileSnapshotAdapter, ...args: Parameters<typeof original>) {
    await original.apply(this, args);
    if (this.file.startsWith(f.directory) && completed++ === 0) throw new ChausarError('SYNTHETIC_LOST_COMMIT_ACK', 'Synthetic acknowledgement lost after the real encrypted file commit.');
  });
  try {
    await f.refusal('answers.recovery.execute', f.executePayload(issued), ['ANSWER_RECOVERY_OUTCOME_UNKNOWN']);
    assert.equal(completed, 1); assert.equal(f.engine.vault!.read().receipts.length, before.receipts.length);
    const unknown = await f.rpc('answers.recovery.get', { newRequestId: issued.newRequestId });
    assert.equal(unknown.status, 'outcome-unknown'); assert.equal(unknown.requiresReopen, true);
    await f.refusal('answers.recovery.execute', f.executePayload(issued), ['ANSWER_RECOVERY_OUTCOME_UNKNOWN']);
    assert.equal(completed, 1, 'An ambiguous handle may not silently dispatch another calculator write.');
  } finally { hook.mock.restore(); }
  await f.reopen(); const result = await f.rpc('answers.recovery.get', { newRequestId: issued.newRequestId });
  assert.deepEqual((await f.rpc('answers.recovery.list', { answerId: f.originalAnswerId })).items, [result]);
  assert.equal(result.status, 'completed'); assert.equal(f.engine.vault!.read().revision, before.revision + 1);
  assert.equal(f.engine.vault!.read().receipts.length, before.receipts.length + 1);
  assert.equal(JSON.stringify(f.original()), originals);
  assert.deepEqual(await f.rpc('answers.recovery.execute', f.executePayload(issued)), result);
  const encrypted = await readFile(join(f.directory, 'main', 'authority.encrypted.json'), 'utf8');
  assert.equal(encrypted.includes('fresh-answer-recovery-lineage-v1'), false);
});

test('concurrent exact public retries preserve the configured verifier and commit only one fresh receipt and lineage', async t => {
  const f = await fixture(t), issued = await f.prepare(), before = f.engine.vault!.read();
  let calls = 0;
  // Explicitly labelled trusted-host verifier fixture. It proves configuration wiring, NOT native SQL qualification.
  f.engine.services.calculator.verifier = async (receipt: any) => {
    calls++; assert.equal(receipt.asOf, newClock); assert.equal(receipt.dictionaryHash, issued.dictionary.hash);
    return { qualification: 'synthetic-configured-verifier-test-only', requestDigest: issued.preparation.requestDigest };
  };
  const results = await Promise.all([f.rpc('answers.recovery.execute', f.executePayload(issued)), f.rpc('answers.recovery.execute', f.executePayload(issued))]);
  assert.deepEqual(results[0], results[1]); assert.equal(calls, 1);
  assert.equal(results[0].receipt.databaseProof.qualification, 'synthetic-configured-verifier-test-only');
  const after = f.engine.vault!.read(); assert.equal(after.revision, before.revision + 1);
  assert.equal(after.receipts.length, before.receipts.length + 1); assert.equal(after.answers.length, before.answers.length + 1);
  const next = await f.prepare(), ready = f.engine.vault!.read();
  f.engine.services.calculator.verifier = async () => { throw new ChausarError('SYNTHETIC_VERIFIER_REFUSAL', 'Explicitly labelled host verifier test refusal.'); };
  await f.refusal('answers.recovery.execute', f.executePayload(next), ['SYNTHETIC_VERIFIER_REFUSAL']);
  assert.deepEqual(f.engine.vault!.read(), ready, 'Verifier refusal persists neither a partial receipt nor uncommitted lineage.');
});

test('real renderer and strict IPC require a newly declared time scope and retain public fresh-result readback', async t => {
  const f = await fixture(t), h = await harness({ mount: true, dispatch: (method, payload) => f.rpc(method, payload) });
  await namedButton(h.app, 'Older calculations').dispatch('click');
  const older = dialogFor(h.body, 'Older calculations'); await namedButton(older, 'Review fresh calculation').dispatch('click');
  const dialog = dialogFor(h.body, 'Fresh calculation from an older answer'), controls = descendants(dialog);
  const timestamp = find(dialog, node => node.tagName === 'input' && node.attributes.type === 'text');
  const dates = controls.filter(node => node.tagName === 'input' && node.attributes.type === 'date');
  assert.equal(timestamp.value, ''); assert.ok(dates.every(node => node.value === ''));
  const mode = find(dialog, node => node.tagName === 'select'), form = find(dialog, node => node.tagName === 'form');
  assert.equal(mode.value, '');
  await form.dispatch('submit'); assert.equal(h.calls.filter(call => call.method === 'answers.recovery.prepare').length, 0);
  timestamp.value = '2026-10-03T17:30:00+05:30'; mode.value = 'period'; dates[0].value = period.from; dates[1].value = period.to;
  find(dialog, node => node.tagName === 'input' && node.attributes.type === 'checkbox').checked = true;
  await form.dispatch('submit');
  assert.equal(h.rejected.length, 0); const prepared = h.calls.find(call => call.method === 'answers.recovery.prepare');
  assert.deepEqual(prepared.payload.timeScope, { asOf: timestamp.value, period, comparePeriod: null, onDate: null });
  assert.equal(prepared.payload.confirmedNewCalculation, true); assert.equal(prepared.payload.newRequestId, undefined);
  await namedButton(dialog, 'Create this fresh calculation').dispatch('click');
  assert.ok(hasText(dialog, 'Fresh calculation completed. The original answer and receipt remain unchanged.'));
  const wire = h.calls.find(call => call.method === 'answers.recovery.execute');
  assert.deepEqual(Object.keys(wire.payload).sort(), ['newRequestId', 'preparationDigest']);
  const result = await f.rpc('answers.recovery.get', { newRequestId: wire.payload.newRequestId });
  assert.equal(result.status, 'completed'); assert.equal(result.receipt.asOf, newClock);
  assert.equal(f.original().answer.request.asOf, undefined);
  const count = h.calls.filter(call => call.method === 'answers.recovery.prepare').length;
  await form.dispatch('submit'); assert.equal(h.calls.filter(call => call.method === 'answers.recovery.prepare').length, count);
  dialog.close();
  await namedButton(older, 'Check earlier fresh requests').dispatch('click');
  const readback = dialogFor(h.body, 'Earlier fresh calculation requests');
  assert.ok(hasText(readback, 'Separate fresh calculation; the original answer remains unchanged.'));
  assert.equal(h.calls.filter(call => call.method === 'answers.recovery.execute').length, 1, 'Rediscovery must never execute implicitly.');
});
