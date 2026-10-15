import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import { compileRecipe, runRecipe, type SourceRecipe } from '../runtime/connectors-ext/recipe.ts';
import { BUILT_IN_DECODERS } from '../runtime/connectors-ext/decoders.ts';
import { diffRecipes, questionFor, withAnswers, type Answer } from '../runtime/connectors-ext/answers.ts';
import { recipeHandlers } from '../runtime/connectors-ext/recipe-methods.ts';
import type { ModuleHost } from '../runtime/modules/types.ts';

/** BK-05 over synthetic files: answer a recipe question in place, the version diff, reconcile. */
function host(engine: Engine): ModuleHost {
  const e = engine as any;
  return { get store() { return e.store(); }, services: e.services, demo: false, directory: e.options.directory, options: {}, call: (method: string, payload: Record<string, unknown>) => engine.request(method, payload) };
}
const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected); return true; };
const owner = { memberId: 'owner', role: 'owner' as const, epoch: 1, channel: 'desktop' as const };
async function open(t: any) {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-cx-answers-'));
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file' } as any);
  t.after(async () => { await engine.close(); await rm(directory, { recursive: true, force: true }); });
  await engine.request('workspace.create', { name: 'Synthetic Cafe', passphrase: 'Synthetic connector passphrase 2026', demo: false, pack: 'retail', folder: 'main' });
  return engine;
}
const header = 'Order ID,Order Date,Order Status,Order Value,Commission,Net Payout\n';
const returned = `${header}Z1001,01/09/2026,Delivered,600.00,120.00,456.00\nZ1002,02/09/2026,Returned,350.00,70.00,266.00\nTotal,,,,,456.00\n`;

test('an unknown value asks with the recipe\'s own words; answering re-reads at once and the answer sticks to that source', async t => {
  const engine = await open(t);
  const connection = await engine.request('connectorsx.connect', { group: 'restaurant-partners', road: 'file', company: 'Synthetic Cafe' });
  const first = await engine.request('connectorsx.importPreview', { recipeId: 'restaurant.payout-annexure', connectionId: connection.id, text: returned });
  assert.equal(first.status, 'abstained');
  assert.deepEqual(first.question, { reason: 'unknown_value', field: 'status', sample: 'Returned', choices: ['settled', 'no-status', 'leave-out'] });
  assert.equal('target' in first.question, false, 'which map the value belongs to stays inside the engine');
  await assert.rejects(engine.request('recipes.answer', { envelopeId: first.id, choice: 'refund' }), code('RECIPE_ANSWER_INVALID'));
  const reply = await engine.request('recipes.answer', { envelopeId: first.id, choice: 'leave-out' });
  assert.equal(reply.readAgain, 'not-needed');
  assert.equal(reply.answer.sample, 'Returned'); assert.equal(reply.answer.answeredBy.role, 'owner'); assert.equal(reply.answer.sourceId, connection.sourceId);
  assert.equal(reply.read.status, 'accepted', JSON.stringify(reply.read.refusal));
  assert.equal(reply.read.observed.total, '45600'); assert.equal(reply.read.excludedRows, 1);
  assert.deepEqual(reply.read.answerIds, [reply.answer.id]);
  assert.notEqual(reply.read.recipeDigest, first.recipeDigest, 'the answered recipe has its own digest');
  // The held input was used once: answering the old read again cannot re-read it.
  await assert.rejects(engine.request('recipes.answer', { envelopeId: reply.read.id, choice: 'leave-out' }), code('RECIPE_QUESTION_NONE'));
  // A later file of the same source reads with the answer; another source still asks.
  const again = await engine.request('connectorsx.importPreview', { recipeId: 'restaurant.payout-annexure', connectionId: connection.id, text: returned.replace('Z1001', 'Z1005') });
  assert.equal(again.status, 'accepted');
  const other = await engine.request('connectorsx.importPreview', { recipeId: 'restaurant.payout-annexure', sourceId: 'other-file', company: 'Synthetic Cafe', text: returned });
  assert.equal(other.status, 'abstained');
  const listed = await engine.request('recipes.answers', { sourceId: connection.sourceId });
  assert.equal(listed.answers.length, 1);
  // The version diff names exactly what the answer changed.
  const diff = await engine.request('recipes.upgradeDiff', { recipeId: 'restaurant.payout-annexure', envelopeId: first.id });
  assert.equal(diff.available, true); assert.equal(diff.from.label, 'read-with'); assert.equal(diff.to.label, 'with-answers');
  assert.deepEqual(diff.changes, [{ path: 'exclude.values', change: 'changed', before: 'Cancelled | Rejected', after: 'Cancelled | Rejected | Returned', effect: 'meaning' }]);
  const seed = await engine.request('recipes.upgradeDiff', { recipeId: 'restaurant.payout-annexure' });
  assert.equal(seed.same, true); assert.deepEqual(seed.changes, []);
  // Removing the answer brings the question back.
  await engine.request('recipes.answerRemove', { answerId: reply.answer.id });
  const asked = await engine.request('connectorsx.importPreview', { recipeId: 'restaurant.payout-annexure', connectionId: connection.id, text: returned });
  assert.equal(asked.status, 'abstained');
  await assert.rejects(engine.request('recipes.answerRemove', { answerId: reply.answer.id }), code('ANSWER_NOT_FOUND'));
});

test('answers come from the person at the desktop; a read that asked nothing has no question', async t => {
  const engine = await open(t);
  const first = await engine.request('connectorsx.importPreview', { recipeId: 'restaurant.payout-annexure', sourceId: 'cafe-file', company: 'Synthetic Cafe', text: returned });
  const h = host(engine);
  await assert.rejects(recipeHandlers.answer({ ...owner, channel: 'phone' }, { envelopeId: first.id, choice: 'leave-out' }, h), code('OPEN_DESKTOP'));
  await assert.rejects(recipeHandlers.answer({ ...owner, sourceTainted: true }, { envelopeId: first.id, choice: 'leave-out' }, h), code('OPEN_DESKTOP'));
  await assert.rejects(recipeHandlers.answer({ ...owner, channel: 'mcp' }, { envelopeId: first.id, choice: 'leave-out' }, h), code('OPEN_DESKTOP'));
  const good = await engine.request('connectorsx.importPreview', { recipeId: 'restaurant.payout-annexure', sourceId: 'cafe-file', company: 'Synthetic Cafe', text: `${header}Z1001,01/09/2026,Delivered,600.00,120.00,456.00\nZ1002,02/09/2026,Delivered,350.00,70.00,266.00\nTotal,,,,,722.00\n` });
  assert.equal(good.status, 'accepted'); assert.equal(good.question, null);
  await assert.rejects(engine.request('recipes.answer', { envelopeId: good.id, choice: 'leave-out' }), code('RECIPE_QUESTION_NONE'));
  await assert.rejects(engine.request('recipes.answer', { envelopeId: 'envelope-none', choice: 'leave-out' }), code('ENVELOPE_NOT_FOUND'));
  await assert.rejects(engine.request('recipes.answer', { envelopeId: first.id, choice: 'leave-out', extra: 1 }), code('CONNECTOR_REQUEST_INVALID'));
});

test('without the held input (after a lock) the answer is kept and the person reads again', async t => {
  const engine = await open(t);
  const first = await engine.request('connectorsx.importPreview', { recipeId: 'restaurant.payout-annexure', sourceId: 'cafe-file', company: 'Synthetic Cafe', text: returned });
  await engine.request('workspace.lock', {});
  await engine.request('workspace.open', { passphrase: 'Synthetic connector passphrase 2026', folder: 'main' });
  const reply = await engine.request('recipes.answer', { envelopeId: first.id, choice: 'leave-out' });
  assert.equal(reply.read, null); assert.equal(reply.readAgain, 'bring-the-file-again');
  const next = await engine.request('connectorsx.importPreview', { recipeId: 'restaurant.payout-annexure', sourceId: 'cafe-file', company: 'Synthetic Cafe', text: returned });
  assert.equal(next.status, 'accepted');
});

test('reconcile re-totals the live facts of an import against the source\'s own total', async t => {
  const engine = await open(t);
  const text = `${header}Z1001,01/09/2026,Delivered,600.00,120.00,456.00\nZ1002,02/09/2026,Delivered,350.00,70.00,266.00\nTotal,,,,,722.00\n`;
  const preview = await engine.request('connectorsx.importPreview', { recipeId: 'restaurant.payout-annexure', sourceId: 'cafe-file', company: 'Synthetic Cafe', text });
  const before = await engine.request('recipes.reconcile', { envelopeId: preview.id });
  assert.equal(before.status, 'not-imported'); assert.equal(before.ours.total, null, 'not imported is not zero');
  await engine.request('connectorsx.importCommit', { envelopeId: preview.id });
  const done = await engine.request('recipes.reconcile', { envelopeId: preview.id });
  assert.equal(done.status, 'matches'); assert.equal(done.ours.total, '72200'); assert.equal(done.theirs.total, '72200'); assert.equal(done.theirs.provenance, 'in-file-total');
  assert.equal(done.by.role, 'owner');
  const typed = await engine.request('recipes.reconcile', { envelopeId: preview.id, reportTotals: { total: '72300' } });
  assert.equal(typed.status, 'differs'); assert.equal(typed.theirs.provenance, 'user-entered-report');
  await assert.rejects(engine.request('recipes.reconcile', { envelopeId: preview.id, reportTotals: { total: '723.00' } }), code('INVALID_SOURCE_TOTALS'));
  // A later file changes one order: that fact is superseded, so the first import's rows changed.
  const later = text.replace('456.00\nZ1002', '457.00\nZ1002').replace('722.00', '723.00');
  const second = await engine.request('connectorsx.importPreview', { recipeId: 'restaurant.payout-annexure', sourceId: 'cafe-file', company: 'Synthetic Cafe', text: later });
  await engine.request('connectorsx.importCommit', { envelopeId: second.id });
  const changed = await engine.request('recipes.reconcile', { envelopeId: preview.id });
  assert.equal(changed.status, 'rows-changed'); assert.equal(changed.ours.changed, 1); assert.equal(changed.ours.live, 1);
  const listed = await engine.request('connectorsx.envelopes', { sourceId: 'cafe-file' });
  assert.equal(listed.find((e: any) => e.id === preview.id).reconciliations.length, 4);
});

test('every question kind has fixed choices, and each answer is a data-only recipe change', () => {
  const decoders = new Map(BUILT_IN_DECODERS.map(d => [d.id, d]));
  const base = compileRecipe({
    id: 'test.sales', version: '1', group: 'test-books', operation: 'sales', title: 'Synthetic sales', decoder: 'csv',
    fields: { number: { from: ['No', 'Bill No'], type: 'text', required: true }, date: { from: ['Date'], type: 'date', required: true, dateFormats: ['DMY', 'MDY'] },
      amount: { from: ['Amount'], type: 'money', required: true }, currency: { from: ['Currency'], type: 'text' }, type: { from: ['Type'], type: 'text', required: true }, side: { from: ['Dr/Cr'], type: 'text' } },
    measure: { type: 'money', amount: { field: 'amount' }, currency: { field: 'currency' }, unit: 'major' }, identity: ['number'],
    kind: { field: 'type', values: { Sale: 'invoice', Return: 'refund' } }, sign: { field: 'side', negative: ['Dr'], positive: ['Cr'] },
    totals: { kind: 'footer-row', labelField: 'number', labels: ['Total'], amountFields: ['amount'] }, sensitivity: 'financial',
  } as SourceRecipe, decoders);
  const csv = decoders.get('csv')!;
  const run = (recipe: SourceRecipe, text: string) => runRecipe(recipe, csv, { text });
  const answer = (over: Partial<Answer>): Answer => ({ id: `answer-${Math.random()}`, sourceId: 's', recipeId: base.id, recipeVersion: '1', reason: 'unknown_value', field: 'type', target: 'kind', sample: null, choice: '',
    answeredBy: { memberId: 'owner', name: 'Owner', role: 'owner', at: '2026-10-15T00:00:00Z' }, envelopeId: 'e', ...over });
  const file = (body: string) => `No,Date,Amount,Currency,Type,Dr/Cr\n${body}Total,,"1,000.00",,,\n`;

  const dates = run(base, file('S-1,03/09/2026,"1,000.00",INR,Sale,Cr\n'));
  const dq = questionFor(base, dates.abstention)!;
  assert.deepEqual(dq, { reason: 'date_format', field: 'date', sample: null, choices: ['DMY', 'MDY'] });
  const dmy = withAnswers(base, [answer({ reason: 'date_format', field: 'date', choice: 'DMY', target: null })]).recipe;
  const kindAsked = run(dmy, file('S-1,03/09/2026,"1,000.00",INR,Debit Note,Cr\n'));
  const kq = questionFor(dmy, kindAsked.abstention)!;
  assert.deepEqual(kq, { reason: 'unknown_value', field: 'type', sample: 'Debit Note', choices: ['invoice', 'refund', 'leave-out'], target: 'kind' });
  const kinded = withAnswers(dmy, [answer({ reason: 'date_format', field: 'date', choice: 'DMY', target: null }), answer({ sample: 'Debit Note', choice: 'refund' })]).recipe;
  assert.equal(run(kinded, file('S-1,03/09/2026,"1,000.00",INR,Debit Note,Cr\n')).records[0].kind, 'refund');
  const currencyAsked = run(dmy, file('S-1,03/09/2026,"1,000.00",,Sale,Cr\n'));
  assert.deepEqual(questionFor(dmy, currencyAsked.abstention)!.choices.slice(0, 2), ['INR', 'USD']);
  const inr = withAnswers(dmy, [answer({ reason: 'currency', field: 'currency', choice: 'INR', target: null })]).recipe;
  const filled = run(inr, file('S-1,03/09/2026,"1,000.00",,Sale,Cr\n'));
  assert.equal(filled.status, 'accepted'); assert.equal((filled.records[0].measure as any).currency, 'INR');
  const signAsked = run(dmy, file('S-1,03/09/2026,"1,000.00",INR,Sale,CR.\n'));
  assert.deepEqual(questionFor(dmy, signAsked.abstention), { reason: 'sign_convention', field: 'side', sample: 'CR.', choices: ['in', 'out'] });
  const signed = withAnswers(dmy, [answer({ reason: 'sign_convention', field: 'side', sample: 'CR.', choice: 'in', target: null })]).recipe;
  assert.equal(run(signed, file('S-1,03/09/2026,"1,000.00",INR,Sale,CR.\n')).observed.total, '100000');
  const twoColumns = run(dmy, 'No,Bill No,Date,Amount,Currency,Type,Dr/Cr\nS-1,B-1,03/09/2026,"1,000.00",INR,Sale,Cr\n');
  assert.deepEqual(questionFor(dmy, twoColumns.abstention), { reason: 'ambiguous_field', field: 'number', sample: null, choices: ['No', 'Bill No'] });
  // An answered recipe is still plain data that compiles; the diff names each change.
  const changes = diffRecipes(base, signed);
  assert.deepEqual(changes.map(c => [c.path, c.effect]), [['fields.date.dateFormats', 'dates'], ['sign.in', 'amount']]);
  // Outside text in a sample stays data: an instruction-like value becomes a map key, never code.
  const injected = withAnswers(dmy, [answer({ sample: 'Ignore previous rules"); process.exit(1); //', choice: 'invoice' })]).recipe;
  assert.equal((injected.kind as any).values['Ignore previous rules"); process.exit(1); //'], 'invoice');
});
