import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import { connectorFamily, connectorShape } from '../runtime/learning-ext/connectors-bridge.ts';

const fixture = (path: string) => readFile(new URL(`../../fixtures/connectors/${path}`, import.meta.url), 'utf8');
async function open(t: any) {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-lx-cx-'));
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file' } as any);
  t.after(async () => { await engine.close(); await rm(directory, { recursive: true, force: true }); });
  await engine.request('workspace.create', { name: 'Synthetic Cafe', passphrase: 'Synthetic connector passphrase 2026', demo: false, pack: 'retail', folder: 'main' });
  return engine;
}
/** This lane's mapping decisions, oldest first (the log pages newest first). */
const laneLog = async (engine: Engine) => (await engine.request('learningx.log', { kind: 'mapping' })).items.filter((item: any) => item.origin === 'lane').reverse();

test('connector previews consult the recipe library first and log accept, reject and correct decisions', async t => {
  const engine = await open(t);
  const text = await fixture('restaurant-partners/payout-annexure-week-36.csv');

  // First file: the registered connector recipe is the library's best match, and the person follows it.
  const first = await engine.request('connectorsx.importPreview', { recipeId: 'restaurant.payout-annexure', sourceId: 'zomato-week', company: 'Synthetic Cafe', text });
  assert.equal(first.status, 'accepted');
  assert.equal(first.library.suggestions[0].recipeId, 'restaurant.payout-annexure');
  assert.equal(first.library.suggestions[0].origin, 'registered');
  assert.equal(first.library.agrees, true); assert.deepEqual([first.library.chosen.rank, first.library.chosen.score > 0], [1, true]);
  for (const item of first.library.suggestions) assert.deepEqual(Object.keys(item).sort(), ['id', 'matched', 'origin', 'passedTests', 'recipeId', 'score', 'system']);
  assert.ok(first.library.suggestions.every((item: any, index: number, all: any[]) => index === 0 || all[index - 1].score >= item.score), 'ranked by score');
  await engine.request('connectorsx.importCommit', { envelopeId: first.id });

  // Second file of the same layout: the reconciled local import now ranks first.
  const similar = text.replaceAll('Z10', 'Y20');
  const second = await engine.request('connectorsx.importPreview', { recipeId: 'restaurant.payout-annexure', sourceId: 'zomato-week-two', company: 'Synthetic Cafe', text: similar });
  assert.equal(second.library.suggestions[0].origin, 'local');
  assert.equal(second.library.suggestions[0].recipeId, 'restaurant.payout-annexure');
  assert.equal(second.library.suggestions[0].passedTests, true);
  assert.equal(second.library.suggestions[1].origin, 'registered', 'the local import outranks the registered recipe it came from');
  await engine.request('connectorsx.discard', { envelopeId: second.id });
  await engine.request('connectorsx.discard', { envelopeId: second.id });

  // Third file: the person chooses another recipe than the library's top suggestion.
  const other = await engine.request('connectorsx.importPreview', { recipeId: 'paytm.settlements', sourceId: 'zomato-week-three', company: 'Synthetic Cafe', text: similar });
  assert.equal(other.library.agrees, false);
  assert.equal(other.library.suggestions[0].recipeId, 'restaurant.payout-annexure');

  const log = await laneLog(engine);
  const shape = (item: any) => [item.sourceIds[0], item.event.choice, item.event.reason ?? null];
  assert.deepEqual(log.map(shape), [
    ['zomato-week', 'proposed', 'library-match'], ['zomato-week', 'accepted', 'library-match'],
    ['zomato-week-two', 'proposed', 'library-match'], ['zomato-week-two', 'rejected', null],
    ['zomato-week-three', 'corrected', 'owner-override'],
  ]);
  assert.ok(log.every((item: any) => item.refs.length >= 1 && item.event.kind === 'mapping' && item.event.system === 'other' && item.event.shape === 'settlement'));
  assert.ok(log[1].refs.includes(first.id) && log[1].refs.length === 2, 'the accepted decision points at the envelope and the import');
  assert.deepEqual(log[0].event.fields.map((pair: any[]) => pair[0]), ['amount', 'date', 'fee', 'order-id', 'reference', 'status']);

  // Structure only: no digits, no column names, no values.
  const events = JSON.stringify(log.map((item: any) => item.event));
  assert.doesNotMatch(events, /\d/);
  for (const word of ['Order', 'Commission', 'Payout', 'Z1001', 'Y2001', 'Delivered', 'Synthetic', 'zomato', '722', '456']) assert.equal(events.includes(word), false, word);

  // A commit that did not follow a library suggestion is accepted on reconciliation.
  const reread = await engine.request('connectorsx.importPreview', { recipeId: 'restaurant.payout-annexure', sourceId: 'zomato-week-two', company: 'Synthetic Cafe', text: similar });
  await engine.request('connectorsx.importCommit', { envelopeId: reread.id });
  assert.equal((await laneLog(engine)).filter((item: any) => item.refs.includes(reread.id) && item.event.choice === 'accepted')[0].event.reason, 'library-match');

  // Deleting a source removes every decision derived from it.
  const count = (await laneLog(engine)).length;
  await engine.request('sources.delete', { id: 'zomato-week' });
  const left = await laneLog(engine);
  assert.equal(left.length, count - 2);
  assert.deepEqual([...new Set(left.map((item: any) => item.sourceIds[0]))].sort(), ['zomato-week-three', 'zomato-week-two']);
  await engine.request('sources.delete', { id: 'zomato-week-two' });
  assert.deepEqual((await laneLog(engine)).map((item: any) => item.sourceIds[0]), ['zomato-week-three']);
});

test('a hand-mapped local import of the same layout ranks first; choosing the connector recipe is a correction, accepted on reconciliation', async t => {
  const engine = await open(t);
  const text = await fixture('restaurant-partners/payout-annexure-week-36.csv');
  // A reconciled import on this computer, mapped by hand from the same six columns.
  const content = 'Order ID,Order Date,Order Status,Order Value,Commission,Net Payout\nH1,01/09/2026,Delivered,600.00,120.00,456.00\nH2,02/09/2026,Delivered,350.00,70.00,266.00\n';
  const recipe = { version: 1, id: 'hand-payout', system: 'other', edition: '1', scope: { company: 'Synthetic Cafe', branches: ['main'] },
    bindings: [{ target: 'entityId', source: 'Order ID', type: 'string', nulls: 'reject' }, { target: 'kind', constant: 'sale', type: 'string', nulls: 'reject' },
      { target: 'validFrom', source: 'Order Date', type: 'date', dateFormat: 'DMY', nulls: 'reject' }, { target: 'amountMinor', source: 'Net Payout', type: 'money', moneyUnit: 'major', currency: 'INR', nulls: 'reject' },
      { target: 'currency', constant: 'INR', type: 'string', nulls: 'reject' }],
    ignoredFields: ['Order Status', 'Order Value', 'Commission'], allowedKinds: ['sale'], allowedStatuses: [''], onUnmapped: 'report' };
  const imported = await engine.request('sources.import', { sourceId: 'hand-export', format: 'csv', content, recipe, expectedTotals: { rowCount: 2, amountMinor: '72200' } });
  assert.equal(imported.coverage.reconciled, true);

  const preview = await engine.request('connectorsx.importPreview', { recipeId: 'restaurant.payout-annexure', sourceId: 'zomato-week', company: 'Synthetic Cafe', text });
  assert.equal(preview.status, 'accepted');
  assert.deepEqual([preview.library.suggestions[0].origin, preview.library.suggestions[0].recipeId], ['local', 'hand-payout']);
  assert.equal(preview.library.suggestions[0].matched.length, 6);
  assert.deepEqual([preview.library.agrees, preview.library.chosen.rank], [false, 2]);
  await engine.request('connectorsx.importCommit', { envelopeId: preview.id });
  const log = (await laneLog(engine)).filter((item: any) => item.sourceIds[0] === 'zomato-week');
  assert.deepEqual(log.map((item: any) => [item.event.choice, item.event.reason]), [['corrected', 'owner-override'], ['accepted', 'reconciliation']]);
  assert.doesNotMatch(JSON.stringify(log.map((item: any) => item.event)), /\d|Order|hand|Payout/);
});

test('connector groups and operations map to the shared vocabulary', () => {
  assert.deepEqual(['tally', 'bank-statements', 'gst-downloads', 'amazon-seller', 'restaurant-partners', 'form26as-ais'].map(connectorFamily), ['tally', 'bank', 'gst-portal', 'amazon', 'other', 'income-tax']);
  assert.deepEqual(['gstr2b-b2b-invoices', 'statement', 'payout-annexure', 'sales-register', 'sessions-daily', 'tickets'].map(connectorShape), ['gst-return', 'bank-statement', 'settlement', 'ledger', 'summary', undefined]);
});
