import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../runtime/engine.ts';

// Synthetic data only. The real engine, in demo mode: every external read stays disabled.
const sourceId = 'synthetic-r2-source';
const input = { sourceId, format: 'csv',
  content: 'id,kind,date,amount,tax,currency,branch,status,channel\nI1,invoice,2026-09-02,100.00,10.00,INR,main,issued,shop\nI2,invoice,2026-09-03,200.00,20.00,INR,main,issued,web\nP1,payment,2026-09-04,50.00,0.00,INR,main,settled,shop',
  recipe: { version: 1, id: 'synthetic-r2-recipe', system: 'synthetic-csv', edition: '1', scope: { company: 'Synthetic R2', branches: ['main'] },
    bindings: [
      { target: 'entityId', source: 'id', type: 'string', nulls: 'reject' }, { target: 'kind', source: 'kind', type: 'string', nulls: 'reject' },
      { target: 'validFrom', source: 'date', type: 'date', dateFormat: 'ISO', nulls: 'reject' },
      { target: 'amountMinor', source: 'amount', type: 'money', moneyUnit: 'major', currency: 'INR', nulls: 'reject' },
      { target: 'taxMinor', source: 'tax', type: 'money', moneyUnit: 'major', currency: 'INR', nulls: 'reject' },
      ...['currency', 'branch', 'status'].map(target => ({ target, source: target, type: 'string', nulls: 'reject' })),
    ], allowedKinds: ['invoice', 'payment'], allowedStatuses: ['issued', 'settled'], onUnmapped: 'report' },
  expectedTotals: { rowCount: 3, amountMinor: '35000' } };

async function open(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-books-r2-'));
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file' });
  t.after(async () => { await engine.close(); await rm(directory, { recursive: true, force: true }); });
  await engine.request('workspace.create', { name: 'Synthetic R2 Shop', passphrase: 'Synthetic r2 passphrase 2026', demo: false, pack: 'retail', folder: 'main' });
  return engine;
}

test('sources through the real connector lane: systems, connect, a connection row, demo refuses reads, sign-in, disconnect', async t => {
  const engine = await open(t);
  const systems = await engine.request('books.systems', {});
  assert.equal(systems.available, true);
  const tally = systems.systems.find((s: any) => s.id === 'tally');
  assert.ok(tally && tally.available && tally.ways.includes('interface') && tally.operations.length > 1);
  assert.ok(tally.operations.every((op: any) => ['tested', 'experimental', 'planned', 'not-possible'].includes(op.status)));
  assert.deepEqual(tally.settings, ['company', 'ledgers']); assert.equal(tally.liveVerified, false);

  await assert.rejects(engine.request('books.connect', { group: 'tally', road: 'interface', company: 'Synthetic R2', settings: { apiKey: 'x' } }), { code: 'CREDENTIAL_NOT_ACCEPTED' });
  const made = await engine.request('books.connect', { group: 'tally', road: 'interface', company: 'Synthetic R2', settings: { company: 'Synthetic R2' } });
  assert.equal(made.group, 'tally'); assert.equal(made.status, 'active');

  const sources = await engine.request('books.sources', {});
  const row = sources.rows.find((r: any) => r.sourceId === made.sourceId);
  assert.ok(row, 'a connected system with no import yet is a row');
  assert.equal(row.connected, true); assert.equal(row.way, 'this-computer'); assert.equal(row.scope, 'Synthetic R2'); assert.equal(row.experimental, true);
  assert.equal(row.months.length, 12); assert.ok(row.months.every((m: any) => m.state === 'not-loaded-yet'));
  assert.deepEqual(row.connection, { connectionId: made.connectionId, group: 'tally', road: 'interface', status: 'active' });

  const one = await engine.request('books.source', { sourceId: made.sourceId });
  assert.equal(one.connection.connectionId, made.connectionId); assert.ok(one.connection.operations.some((op: any) => op.id === 'sales-register'));
  assert.deepEqual(one.envelopes, []);

  await assert.rejects(engine.request('books.readNow', { sourceId: made.sourceId, operation: 'sales-register', period: { from: '2026-09-01', to: '2026-09-30' } }), { code: 'DEMO_EXTERNAL_DISABLED' });
  const signIn = await engine.request('books.signIn', { sourceId: made.sourceId });
  assert.equal(signIn.method, 'key'); assert.match(signIn.instruction, /Tally needs no sign-in/);
  assert.equal((await engine.request('books.pause', { sourceId: made.sourceId, paused: true })).status, 'paused');
  assert.deepEqual(await engine.request('books.disconnect', { sourceId: made.sourceId }), { sourceId: made.sourceId, removed: true, factsKept: false });
  assert.equal((await engine.request('books.sources', {})).rows.some((r: any) => r.sourceId === made.sourceId), false);

  await engine.request('sources.import', input);
  await assert.rejects(engine.request('books.readNow', { sourceId, operation: 'sales-register' }), { code: 'CONNECTION_REQUIRED' });
  const recipes = await engine.request('books.recipes', {});
  assert.equal(recipes.available, true); assert.ok(recipes.recipes.some((r: any) => r.id === 'tally.sales-register' && r.state === 'seed'));
  const recipe = await engine.request('books.recipe', { recipeId: 'tally.sales-register' });
  assert.equal(recipe.check, null); assert.ok(recipe.bindings.length > 0 && recipe.bindings.every((b: any) => b.acceptedBy === null));
});

test('map a field through the learning grammar, accept by a named person, and memory with business profile entries', async t => {
  const engine = await open(t);
  await engine.request('sources.import', input);
  const unmapped = await engine.request('books.unmapped', {});
  assert.deepEqual(unmapped.fields.map((f: any) => [f.field, f.origin, f.mappable]), [['channel', 'file', true]]);
  const proposal = await engine.request('books.mapField', { sourceId, field: 'channel', target: 'description', type: 'string' });
  assert.equal(proposal.state, 'proposed'); assert.equal(proposal.fieldBound, true);
  const added = proposal.bindings.find((b: any) => b.source === 'channel');
  assert.deepEqual([added.state, added.acceptedBy, added.change], ['proposed', null, 'new']);
  await assert.rejects(engine.request('books.decideProposal', { id: proposal.id, decision: 'accept', digest: 'x' }), { code: 'PREVIEW_CHANGED' });
  assert.equal(proposal.valid, true, JSON.stringify(proposal.issues)); assert.deepEqual(proposal.removed, []);
  {
    const accepted = await engine.request('books.decideProposal', { id: proposal.id, decision: 'accept', digest: proposal.digest });
    assert.equal(accepted.state, 'accepted'); assert.equal(accepted.decided.role, 'owner'); assert.ok(accepted.libraryId);
    assert.equal(accepted.bindings.find((b: any) => b.source === 'channel').grade, 'owner');
  }

  const recorded = await engine.request('business.profile.record', { field: 'industry', value: 'Stationery retail', origin: 'owner-told', sourceId: 'owner-notes', validFrom: '2026-09-01' });
  await engine.request('business.profile.record', { field: 'industry', value: 'Stationery and gifts retail', origin: 'owner-told', sourceId: 'owner-notes', validFrom: '2026-09-01', replacesId: recorded.id });
  await engine.request('books.remember', { text: 'Pay suppliers on Fridays.', kind: 'preference' });
  const memory = await engine.request('books.memory', {});
  const profile = memory.lines.filter((l: any) => l.origin === 'business-profile');
  assert.equal(profile.length, 1);
  assert.deepEqual([profile[0].text, profile[0].kind, profile[0].status, profile[0].source, profile[0].field, profile[0].readOnly], ['Stationery and gifts retail', 'claim', 'corrected', 'told-by-owner', 'industry', true]);
  assert.deepEqual(profile[0].earlier.map((e: any) => e.text), ['Stationery retail']);
  assert.ok(memory.lines.some((l: any) => l.text === 'Pay suppliers on Fridays.'));
  await assert.rejects(engine.request('books.memoryEdit', { id: profile[0].id, text: 'x' }), { code: 'PROFILE_LINE_READ_ONLY' });
  assert.deepEqual(await engine.request('books.forget', { id: profile[0].id }), { id: profile[0].id, deleted: true });
  assert.equal((await engine.request('books.memory', {})).lines.some((l: any) => l.origin === 'business-profile'), false);
  assert.deepEqual(await engine.request('business.profile.history', {}), []);
});

test('try a meaning change on a copy through core trials: two columns, receipts, discard; removing a word is refused', async t => {
  const engine = await open(t);
  await engine.request('sources.import', input);
  const asOf = new Date(Date.now() + 1).toISOString();
  const billed = await engine.request('calculation.run', { operation: 'billed', sourceIds: [sourceId], asOf });
  await engine.request('calculation.run', { operation: 'received', sourceIds: [sourceId], asOf });
  const questions = await engine.request('books.trialQuestions', {});
  assert.equal(questions.available, true); assert.equal(questions.questions.length, 2);
  const word = (await engine.request('books.meaning', { name: 'billed' })).word;
  const draft = await engine.request('books.draft', { name: 'billed', definition: { label: word.label, meaning: 'Synthetic trial: billed counts invoice tax only.', kind: word.kind, field: 'taxMinor', nulls: word.nulls } });

  const trial = await engine.request('books.trial', { draftId: draft.id });
  assert.equal(trial.experimental, true); assert.equal(trial.status, 'evaluated'); assert.equal(trial.draftId, draft.id);
  const row = trial.rows.find((r: any) => r.operation === 'billed');
  assert.deepEqual([row.now.value, row.withChange.value, row.differs], [{ minor: '30000' }, { minor: '3000' }, true]);
  assert.equal(row.now.receiptId, billed.id); assert.equal(row.withChange.receiptId, null); assert.ok(row.withChange.receipt.definitions.includes('billed'));
  assert.equal(trial.rows.find((r: any) => r.operation === 'received').differs, false);
  assert.ok(trial.impact?.digest); assert.ok(trial.evaluationDigest);
  assert.equal((await engine.request('books.trialRead', { draftId: draft.id })).trial.trialId, trial.trialId);
  assert.deepEqual(await engine.request('receipts.get', { id: billed.id }).then((r: any) => r.totalMinor), '30000', 'the copy changed nothing live');

  const discarded = await engine.request('books.trialDiscard', { trialId: trial.trialId });
  assert.equal(discarded.status, 'discarded');
  assert.deepEqual(await engine.request('books.trialRead', { draftId: draft.id }), { trial: null });

  await engine.request('books.discard', { draftId: draft.id });
  const removal = await engine.request('books.draft', { name: 'billed', definition: null });
  await assert.rejects(engine.request('books.trial', { draftId: removal.id }), { code: 'TRIAL_CHANGE_UNSUPPORTED' });
});

test('publishing a tried change promotes the copy under the release rules', async t => {
  const engine = await open(t);
  await engine.request('sources.import', input);
  const asOf = new Date(Date.now() + 1).toISOString();
  await engine.request('calculation.run', { operation: 'billed', sourceIds: [sourceId], asOf });
  const before = (await engine.request('books.meanings', {})).dictionary.version;
  const word = (await engine.request('books.meaning', { name: 'billed' })).word;
  const draft = await engine.request('books.draft', { name: 'billed', definition: { label: word.label, meaning: 'Synthetic trial: billed counts invoice tax only.', kind: word.kind, field: 'taxMinor', nulls: word.nulls } });
  const trial = await engine.request('books.trial', { draftId: draft.id });
  const published = await engine.request('books.trialPublish', { trialId: trial.trialId, evaluationDigest: trial.evaluationDigest, impactDigest: trial.impact.digest });
  assert.equal(published.status, 'promoted'); assert.equal(published.draftId, draft.id);
  const after = await engine.request('books.meanings', {});
  assert.equal(after.dictionary.version, before + 1);
  assert.equal(after.drafts.find((d: any) => d.id === draft.id).state, 'published');
});
