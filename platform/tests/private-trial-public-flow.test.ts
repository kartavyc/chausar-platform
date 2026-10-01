import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, isAbsolute } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import { createLocalServer } from '../runtime/server.ts';
import type { Binding, ImportInput } from '../runtime/ingest.ts';

const sourceId = 'synthetic-trial-public-source';
const passphrase = 'Synthetic public trial passphrase only';
const input: ImportInput = { sourceId, format: 'csv',
  content: 'id,kind,date,amount,tax,currency,branch,status\nI1,invoice,2026-09-02,100.00,10.00,INR,main,issued\nI2,invoice,2026-09-03,200.00,20.00,INR,main,issued\nP1,payment,2026-09-04,50.00,0.00,INR,main,settled\nS1,sale,2026-09-05,75.00,0.00,INR,main,delivered',
  recipe: { version: 1, id: 'synthetic-trial-public-recipe', system: 'synthetic-csv', edition: '1', scope: { company: 'Synthetic Trial', branches: ['main'] },
    bindings: [
      { target: 'entityId', source: 'id', type: 'string', nulls: 'reject' }, { target: 'kind', source: 'kind', type: 'string', nulls: 'reject' },
      { target: 'validFrom', source: 'date', type: 'date', dateFormat: 'ISO', nulls: 'reject' },
      ...['amountMinor', 'taxMinor'].map((target): Binding => ({ target, source: target === 'amountMinor' ? 'amount' : 'tax', type: 'money', moneyUnit: 'major', currency: 'INR', nulls: 'reject' })),
      ...['currency', 'branch', 'status'].map((target): Binding => ({ target, source: target, type: 'string', nulls: 'reject' })),
    ], allowedKinds: ['invoice', 'payment', 'sale'], allowedStatuses: ['issued', 'settled', 'delivered'], onUnmapped: 'reject' },
  expectedTotals: { rowCount: 4, amountMinor: '42500' } };

async function setup(t: TestContext, secondInvoicePending = false) {
  const parent = await realpath(tmpdir()); if (process.platform === 'win32') assert.match(parent, /^C:\\/i);
  const directory = await mkdtemp(join(parent, 'chausar-trial-public-')); let providerCalls = 0;
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file', gateway: { http: async () => { providerCalls++; throw new Error('No provider in this synthetic source flow.'); } } });
  const app = createLocalServer(engine), { origin, token } = await app.listen();
  t.after(async () => { await app.close(); const child = relative(parent, directory);
    assert.ok(child && !child.startsWith('..') && !isAbsolute(child) && child.startsWith('chausar-trial-public-')); await rm(directory, { recursive: true, force: true }); });
  const raw = async (method: string, payload: unknown = {}, bearer = token) => { const response = await fetch(`${origin}/api/rpc`, { method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` }, body: JSON.stringify({ method, payload }) }); return { status: response.status, body: await response.json() as any }; };
  const rpc = async (method: string, payload: unknown = {}, bearer = token) => { const response = await raw(method, payload, bearer); assert.equal(response.status, 200, JSON.stringify(response.body)); return response.body.result; };
  await rpc('workspace.create', { name: 'Synthetic public trials', passphrase, demo: true, pack: 'retail' });
  const source = structuredClone(input);
  if (secondInvoicePending) { source.content = source.content.replace('I2,invoice,2026-09-03,200.00,20.00,INR,main,issued', 'I2,invoice,2026-09-03,200.00,20.00,INR,main,pending'); source.recipe!.allowedStatuses.push('pending'); }
  const imported = await rpc('sources.import', source); assert.equal(imported.retainedInput, undefined);
  assert.ok((await rpc('sources.list')).every((record: any) => record.retainedInput === undefined));
  const asOf = new Date(Date.now() + 1).toISOString(), originals: any[] = [];
  for (const operation of ['billed', 'received', 'earned']) originals.push(await rpc('calculation.run', { operation, sourceIds: [sourceId], asOf }));
  const saved = (await rpc('trials.savedQuestions')).filter((answer: any) => answer.request.sourceIds?.[0] === sourceId);
  assert.equal(saved.length, 3); const dictionary = (await rpc('ontology.get')).current;
  const replacement = { ...dictionary.definitions.find((definition: any) => definition.name === 'billed'), field: 'taxMinor',
    meaning: 'Explicit synthetic owner trial: billed counts only separately retained invoice tax amounts.' };
  return { engine, rpc, raw, directory, originals, saved, replacement, source, providerCalls: () => providerCalls };
}

test('public HTTP private trial creates encrypted custody, reopens, shows exact paired receipts and physically discards', async t => {
  const value = await setup(t), before = value.engine.vault!.read();
  const trial = await value.rpc('trials.create', { version: 1, savedAnswerIds: value.saved.map((answer: any) => answer.id), change: { type: 'definition', name: 'billed', replacement: value.replacement } });
  assert.equal(trial.baseline, undefined); assert.equal(trial.candidate, undefined); assert.ok(trial.cost.forkDiskBytes > 0);
  const evaluated = await value.rpc('trials.evaluate', { trialId: trial.trialId });
  assert.deepEqual(evaluated.evaluation.comparisons.map((comparison: any) => [comparison.baseline.receipt.totalMinor, comparison.candidate.receipt.totalMinor, comparison.totalDeltaMinor]), [['30000', '3000', '-27000'], ['5000', '5000', '0'], ['7500', '7500', '0']]);
  assert.deepEqual(value.engine.vault!.read(), before); assert.equal(value.providerCalls(), 0);
  await value.rpc('workspace.lock'); await value.rpc('workspace.open', { passphrase });
  const reopened = await value.rpc('trials.get', { trialId: trial.trialId }); assert.deepEqual(reopened.evaluation, evaluated.evaluation);
  const removed = await value.rpc('trials.discard', { trialId: trial.trialId });
  assert.equal(removed.cleanupComplete, true); assert.equal(removed.removedDiskBytes, evaluated.cost.forkDiskBytes + evaluated.cost.evaluationDiskBytes); assert.ok(removed.retainedTombstoneDiskBytes > 0);
  assert.equal((await value.raw('trials.get', { trialId: trial.trialId })).status, 400); assert.deepEqual(await value.rpc('trials.list'), []);
  const repeated = await value.rpc('trials.discard', { trialId: trial.trialId }); assert.equal(repeated.cleanupComplete, true); assert.equal(repeated.removedDiskBytes, 0);
  for (const receipt of value.originals) assert.deepEqual(await value.rpc('receipts.get', { id: receipt.id }), receipt);
});

test('public successive recipe promotions retain authenticated generations and two-clock history through one and zero counted invoices', async t => {
  const value = await setup(t, true); let recipe = structuredClone(value.source.recipe!);
  recipe.allowedStatuses.push('cancelled'); recipe.bindings.find(binding => binding.target === 'status')!.values = { issued: 'cancelled', pending: 'pending', settled: 'settled', delivered: 'delivered' };
  let savedIds = value.saved.map((answer: any) => answer.id);
  const promote = async (expected: string) => {
    const created = await value.rpc('trials.create', { version: 1, savedAnswerIds: savedIds, change: { type: 'recipe', sourceId, recipeId: recipe.id, replacement: recipe } });
    const evaluated = await value.rpc('trials.evaluate', { trialId: created.trialId });
    assert.equal(evaluated.evaluation.comparisons[0].candidate.status, 'calculated', JSON.stringify(evaluated.evaluation.comparisons[0].candidate));
    assert.equal(evaluated.evaluation.comparisons[0].candidate.receipt.totalMinor, expected);
    const impact = await value.rpc('trials.impact', { trialId: created.trialId, strategy: 'prospective' });
    await value.rpc('trials.promote', { trialId: created.trialId, evaluationDigest: evaluated.evaluationDigest, strategy: 'prospective', acknowledgedImpactDigest: impact.digest });
    const asOf = new Date(Date.now() + 1).toISOString();
    for (const operation of ['billed', 'received', 'earned']) { const receipt = await value.rpc('calculation.run', { operation, sourceIds: [sourceId], asOf });
      if (operation === 'billed') assert.equal(receipt.totalMinor, expected); }
    savedIds = (await value.rpc('trials.savedQuestions')).filter((answer: any) => !answer.stale && answer.request.sourceIds?.[0] === sourceId).map((answer: any) => answer.id);
    assert.equal(savedIds.length, 3);
  };
  await promote('20000'); recipe.bindings.find(binding => binding.target === 'status')!.values = { issued: 'cancelled', pending: 'cancelled', settled: 'settled', delivered: 'delivered' };
  await promote('0');
  assert.equal(value.engine.vault!.read().imports.filter(record => record.type === 'producer-relation-publication-v1').length, 2);
  const historical = await value.rpc('calculation.run', value.saved[0].request); assert.equal(historical.totalMinor, '30000');
  for (const receipt of value.originals) assert.deepEqual(await value.rpc('receipts.get', { id: receipt.id }), receipt);
  await value.rpc('workspace.lock'); await value.rpc('workspace.open', { passphrase });
  assert.equal((await value.rpc('calculation.run', { operation: 'billed', sourceIds: [sourceId], asOf: new Date().toISOString() })).totalMinor, '0');
  assert.equal(value.providerCalls(), 0);
});

test('public retrospective publication appends explicitly labelled new evidence without rewriting its original knowledge cuts', async t => {
  const value = await setup(t);
  const created = await value.rpc('trials.create', { version: 1, savedAnswerIds: value.saved.map((answer: any) => answer.id), change: { type: 'definition', name: 'billed', replacement: value.replacement } });
  const evaluated = await value.rpc('trials.evaluate', { trialId: created.trialId });
  const impact = await value.rpc('trials.impact', { trialId: created.trialId, strategy: 'retrospective' });
  const promoted = await value.rpc('trials.promote', { trialId: created.trialId, evaluationDigest: evaluated.evaluationDigest, strategy: 'retrospective', acknowledgedImpactDigest: impact.digest });
  const restated = value.engine.vault!.read().answers.filter(answer => answer.publicationId === promoted.publicationId);
  assert.equal(restated.length, 3); assert.ok(restated.every(answer => answer.interpretation === 'restated-private-diagnostic'));
  assert.deepEqual(restated.map(answer => answer.request.asOf), value.saved.map((answer: any) => answer.request.asOf));
  assert.deepEqual(await Promise.all(restated.map(async answer => { const receipt = await value.rpc('receipts.get', { id: answer.receiptId }); return [receipt.operation, receipt.totalMinor]; })).then(rows => rows.sort()), [['billed', '3000'], ['earned', '7500'], ['received', '5000']]);
  const contexts = new Map<string, unknown>();
  for (const answer of restated) {
    const saved = value.saved.find((record: any) => record.id === answer.originalAnswerId)!;
    const original = value.originals.find(receipt => receipt.id === saved.receiptId)!;
    const receipt = await value.rpc('receipts.get', { id: answer.receiptId });
    assert.notEqual(receipt.id, original.id); assert.equal(receipt.asOf, original.asOf);
    assert.deepEqual(receipt.restatement, { version: 1, interpretation: 'restated-private-diagnostic', trialId: created.trialId,
      forkDigest: created.forkDigest, candidateStateDigest: created.candidatePin.stateDigest, publicationId: promoted.publicationId,
      originalAnswerId: saved.id, originalReceiptId: original.id });
    const context = await value.rpc('trials.receiptContext', { receiptId: receipt.id });
    assert.equal(context.interpretation, 'restated-private-diagnostic'); assert.equal(context.receiptId, receipt.id);
    assert.equal(context.forkDigest, created.forkDigest); assert.deepEqual(context.candidatePin, created.candidatePin);
    assert.deepEqual(context.originalReceipt, original); assert.equal(context.change.type, 'definition');
    assert.equal(context.baseline, undefined); assert.equal(context.candidate, undefined); assert.equal(context.recipeEvidence, undefined);
    assert.deepEqual(context.rows.map((row: any) => row.factId), receipt.rowIds);
    for (const row of context.rows) {
      assert.deepEqual(row.original, row.restated, 'A definition restatement changes meaning without fabricating different source facts.');
      assert.equal(row.restated.id, row.factId); assert.equal(row.restated.sourceId, sourceId);
    }
    contexts.set(receipt.id, context);
  }
  const originalContext = await value.raw('trials.receiptContext', { receiptId: value.originals[0].id });
  assert.equal(originalContext.status, 400); assert.equal(originalContext.body.error.code, 'RESTATEMENT_CONTEXT_REQUIRED');
  await value.rpc('workspace.lock'); await value.rpc('workspace.open', { passphrase });
  for (const [receiptId, context] of contexts) assert.deepEqual(await value.rpc('trials.receiptContext', { receiptId }), context);
  for (const receipt of value.originals) assert.deepEqual(await value.rpc('receipts.get', { id: receipt.id }), receipt);
  assert.equal(value.providerCalls(), 0);
});

test('public recipe restatement retains inspectable candidate lineage across encrypted reopen and current-access revocation', async t => {
  const value = await setup(t), recipe = structuredClone(value.source.recipe!);
  recipe.bindings.find(binding => binding.target === 'kind')!.values = { invoice: 'sale', payment: 'payment', sale: 'sale' };
  const created = await value.rpc('trials.create', { version: 1, savedAnswerIds: value.saved.map((answer: any) => answer.id),
    change: { type: 'recipe', sourceId, recipeId: recipe.id, replacement: recipe } });
  const evaluated = await value.rpc('trials.evaluate', { trialId: created.trialId });
  const impact = await value.rpc('trials.impact', { trialId: created.trialId, strategy: 'retrospective' });
  const promoted = await value.rpc('trials.promote', { trialId: created.trialId, evaluationDigest: evaluated.evaluationDigest,
    strategy: 'retrospective', acknowledgedImpactDigest: impact.digest });
  const answers = value.engine.vault!.read().answers.filter(answer => answer.publicationId === promoted.publicationId);
  const receipts = await Promise.all(answers.map(answer => value.rpc('receipts.get', { id: answer.receiptId })));
  assert.deepEqual(receipts.map(receipt => [receipt.operation, receipt.totalMinor]).sort(), [['billed', '0'], ['earned', '37500'], ['received', '5000']]);
  const earned = receipts.find(receipt => receipt.operation === 'earned')!;
  const earnedAnswer = answers.find(answer => answer.receiptId === earned.id)!;
  const original = value.originals.find(receipt => receipt.operation === 'earned')!;
  assert.deepEqual(earned.restatement, { version: 1, interpretation: 'restated-private-diagnostic', trialId: created.trialId,
    forkDigest: created.forkDigest, candidateStateDigest: created.candidatePin.stateDigest, publicationId: promoted.publicationId,
    originalAnswerId: earnedAnswer.originalAnswerId, originalReceiptId: original.id });
  assert.equal(earned.asOf, original.asOf); assert.equal(original.totalMinor, '7500');
  const context = await value.rpc('trials.receiptContext', { receiptId: earned.id });
  assert.deepEqual(context.originalReceipt, original); assert.deepEqual(context.change.replacement, recipe);
  assert.equal(context.baseline, undefined); assert.equal(context.candidate, undefined); assert.equal(context.recipeEvidence, undefined);
  assert.deepEqual(context.rows.map((row: any) => row.factId), earned.rowIds);
  assert.deepEqual(context.rows.map((row: any) => [row.original.entityId, row.original.kind, row.restated.kind, row.restated.fields.amountMinor]).sort(),
    [['I1', 'invoice', 'sale', '10000'], ['I2', 'invoice', 'sale', '20000'], ['S1', 'sale', 'sale', '7500']]);
  for (const row of context.rows) {
    assert.equal(row.original.id, row.factId); assert.equal(row.restated.id, row.factId);
    assert.equal(row.original.sourceId, sourceId); assert.equal(row.restated.sourceId, sourceId);
    const counted = earned.rows.find((record: any) => record.factId === row.factId)!;
    assert.equal(counted.kind, row.restated.kind); assert.equal(counted.amountMinor, row.restated.fields.amountMinor);
  }
  await value.rpc('workspace.lock'); await value.rpc('workspace.open', { passphrase });
  assert.deepEqual(await value.rpc('receipts.get', { id: earned.id }), earned);
  assert.deepEqual(await value.rpc('trials.receiptContext', { receiptId: earned.id }), context);
  for (const receipt of value.originals) assert.deepEqual(await value.rpc('receipts.get', { id: receipt.id }), receipt);
  const invite = await value.rpc('auth.invite', { name: 'Synthetic other private reader', role: 'viewer', branches: ['main'] });
  const member = await value.rpc('auth.accept', { token: invite.token });
  const other = await value.raw('trials.receiptContext', { receiptId: earned.id }, member.token);
  assert.equal(other.status, 403); assert.equal(other.body.error.code, 'RECEIPT_FORBIDDEN'); assert.equal(other.body.result, undefined);
  await value.rpc('trust.update', { allowedSources: [] });
  const revoked = await value.raw('trials.receiptContext', { receiptId: earned.id });
  assert.equal(revoked.status, 400); assert.equal(revoked.body.error.code, 'SOURCE_REVOKED'); assert.equal(revoked.body.result, undefined);
  await value.rpc('trust.update', { allowedSources: ['*'] });
  assert.deepEqual(await value.rpc('trials.receiptContext', { receiptId: earned.id }), context);
  assert.equal(value.providerCalls(), 0);
});

for (const dependency of ['unpinned', 'other-member'] as const) test(`public retrospective preflight refuses ${dependency} rebuilds without reserving its trial`, async t => {
  const value = await setup(t); let otherBearer: string | undefined;
  if (dependency === 'other-member') {
    const invite = await value.rpc('auth.invite', { name: 'Synthetic separate calculator', role: 'accountant', branches: ['main'] });
    otherBearer = (await value.rpc('auth.accept', { token: invite.token })).token;
  }
  const created = await value.rpc('trials.create', { version: 1, savedAnswerIds: value.saved.map((answer: any) => answer.id),
    change: { type: 'definition', name: 'billed', replacement: value.replacement } });
  const evaluated = await value.rpc('trials.evaluate', { trialId: created.trialId });
  const additional = await value.rpc('calculation.run', { operation: 'billed', sourceIds: [sourceId],
    ...(dependency === 'other-member' ? { asOf: new Date().toISOString() } : {}) }, otherBearer);
  if (dependency === 'unpinned') {
    // A deliberately retained legacy fixture, not a new unpinned public request.
    // The current calculator now captures every newly resolved receipt cut.
    await value.engine.vault!.update(state => { const legacy = state.answers.find(answer => answer.receiptId === additional.id)!; delete legacy.request.asOf; });
  }
  const dependencyAnswer = value.engine.vault!.read().answers.find(answer => answer.receiptId === additional.id)!;
  const bindingBefore = await value.engine.vault!.readArtifact({ id: `${created.trialId}-binding`, purpose: 'private-trial' });
  const stateBefore = value.engine.vault!.read();
  const refusedImpact = await value.raw('trials.impact', { trialId: created.trialId, strategy: 'retrospective' });
  assert.equal(refusedImpact.status, 400); assert.equal(refusedImpact.body.error.code, 'TRIAL_REBUILD_REQUIRED');
  assert.ok(refusedImpact.body.error.message.includes(dependencyAnswer.id)); assert.equal(refusedImpact.body.result, undefined);
  const refusedPromotion = await value.raw('trials.promote', { trialId: created.trialId, evaluationDigest: evaluated.evaluationDigest,
    strategy: 'retrospective', acknowledgedImpactDigest: '0'.repeat(64) });
  assert.equal(refusedPromotion.status, 400); assert.equal(refusedPromotion.body.error.code, 'TRIAL_REBUILD_REQUIRED');
  assert.deepEqual(value.engine.vault!.read(), stateBefore);
  assert.deepEqual(await value.engine.vault!.readArtifact({ id: `${created.trialId}-binding`, purpose: 'private-trial' }), bindingBefore);
  assert.deepEqual((await value.rpc('trials.get', { trialId: created.trialId })).evaluation, evaluated.evaluation);
  assert.equal((await value.rpc('trials.discard', { trialId: created.trialId })).cleanupComplete, true);
  for (const receipt of value.originals) assert.deepEqual(await value.rpc('receipts.get', { id: receipt.id }), receipt);
  assert.equal(value.providerCalls(), 0);
});

test('public exact-impact promotion atomically publishes the reviewed dictionary and preserves original historical receipts', async t => {
  const value = await setup(t);
  const created = await value.rpc('trials.create', { version: 1, savedAnswerIds: value.saved.map((answer: any) => answer.id), change: { type: 'definition', name: 'billed', replacement: value.replacement } });
  const evaluated = await value.rpc('trials.evaluate', { trialId: created.trialId });
  const impact = await value.rpc('trials.impact', { trialId: created.trialId, strategy: 'prospective' });
  const changed = await value.raw('trials.promote', { trialId: created.trialId, evaluationDigest: evaluated.evaluationDigest, strategy: 'prospective', acknowledgedImpactDigest: '0'.repeat(64) });
  assert.equal(changed.status, 400); assert.equal(changed.body.error.code, 'TRIAL_IMPACT_NOT_ACKNOWLEDGED');
  const promoted = await value.rpc('trials.promote', { trialId: created.trialId, evaluationDigest: evaluated.evaluationDigest, strategy: 'prospective', acknowledgedImpactDigest: impact.digest });
  assert.equal(promoted.status, 'promoted'); assert.equal((await value.rpc('ontology.get')).current.hash, created.candidatePin.dictionaryHash);
  const current = await value.rpc('calculation.run', { operation: 'billed', sourceIds: [sourceId], asOf: new Date().toISOString() }); assert.equal(current.totalMinor, '3000');
  for (const receipt of value.originals) assert.deepEqual(await value.rpc('receipts.get', { id: receipt.id }), receipt);
  await value.rpc('workspace.lock'); await value.rpc('workspace.open', { passphrase }); assert.equal((await value.rpc('ontology.get')).current.hash, created.candidatePin.dictionaryHash);
  assert.equal(value.providerCalls(), 0);
});

test('public source deletion removes retained trial copies and incomplete snapshot backups refuse before deletion', async t => {
  const value = await setup(t);
  const created = await value.rpc('trials.create', { version: 1, savedAnswerIds: value.saved.map((answer: any) => answer.id),
    change: { type: 'definition', name: 'billed', replacement: value.replacement } });
  await value.rpc('trials.evaluate', { trialId: created.trialId });
  assert.equal((await value.engine.vault!.listArtifacts({ purpose: 'private-trial' })).length, 3);
  const refused = await value.raw('workspace.backup');
  assert.equal(refused.status, 400); assert.equal(refused.body.error.code, 'ARTIFACT_BACKUP_REQUIRED');
  const removed = await value.rpc('sources.delete', { id: sourceId });
  assert.equal(removed.copiesRemoved.filter((path: string) => path.startsWith('private-artifacts/private-trial/')).length, 3);
  assert.deepEqual(await value.engine.vault!.listArtifacts({ purpose: 'private-trial' }), []);
  assert.deepEqual(await value.rpc('trials.list'), []);
  assert.ok(value.engine.vault!.read().imports.every(record => record.sourceId !== sourceId));
  assert.ok(value.engine.vault!.read().facts.every(fact => fact.sourceId !== sourceId));
  const backup = await value.rpc('workspace.backup'); assert.equal(typeof backup.path, 'string');
  assert.equal(value.providerCalls(), 0);
});

test('forgetting another source preserves surviving receipts and explicitly revokes their complete-fork context', async t => {
  const value = await setup(t), otherSource = 'synthetic-unrelated-forgotten-source';
  await value.rpc('sources.import', { ...structuredClone(value.source), sourceId: otherSource });
  const asOf = new Date(Date.now() + 1).toISOString();
  for (const operation of ['billed', 'received', 'earned']) await value.rpc('calculation.run', { operation, sourceIds: [sourceId], asOf });
  const saved = (await value.rpc('trials.savedQuestions')).filter((answer: any) => !answer.stale && answer.request.sourceIds?.[0] === sourceId);
  assert.equal(saved.length, 3);
  const created = await value.rpc('trials.create', { version: 1, savedAnswerIds: saved.map((answer: any) => answer.id),
    change: { type: 'definition', name: 'billed', replacement: value.replacement } });
  const evaluated = await value.rpc('trials.evaluate', { trialId: created.trialId });
  const impact = await value.rpc('trials.impact', { trialId: created.trialId, strategy: 'retrospective' });
  const promoted = await value.rpc('trials.promote', { trialId: created.trialId, evaluationDigest: evaluated.evaluationDigest,
    strategy: 'retrospective', acknowledgedImpactDigest: impact.digest });
  const restated = value.engine.vault!.read().receipts.filter(receipt => receipt.restatement?.publicationId === promoted.publicationId);
  assert.equal(restated.length, 6); // All six acknowledged original/rebuilt A requests remain eligible.
  for (const receipt of restated) assert.equal((await value.rpc('trials.receiptContext', { receiptId: receipt.id })).interpretation, 'restated-private-diagnostic');
  await value.rpc('sources.delete', { id: otherSource });
  assert.deepEqual(await value.engine.vault!.listArtifacts({ purpose: 'private-trial' }), []);
  assert.ok(value.engine.vault!.read().imports.every(record => record.sourceId !== otherSource));
  for (const receipt of restated) {
    assert.deepEqual(await value.rpc('receipts.get', { id: receipt.id }), receipt);
    const refused = await value.raw('trials.receiptContext', { receiptId: receipt.id });
    assert.equal(refused.status, 400); assert.equal(refused.body.error.code, 'RESTATEMENT_CUSTODY_REVOKED');
    assert.equal(refused.body.result, undefined);
  }
  const revocation = value.engine.vault!.read().tombstones.find(item => item.kind === 'private-restatement-custody');
  assert.deepEqual(revocation.receiptIds, restated.map(receipt => receipt.id).sort());
  await value.rpc('workspace.lock'); await value.rpc('workspace.open', { passphrase });
  for (const receipt of restated) {
    assert.deepEqual(await value.rpc('receipts.get', { id: receipt.id }), receipt);
    assert.equal((await value.raw('trials.receiptContext', { receiptId: receipt.id })).body.error.code, 'RESTATEMENT_CUSTODY_REVOKED');
  }
  assert.equal(value.providerCalls(), 0);
});
