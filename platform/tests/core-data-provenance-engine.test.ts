import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import type { Context } from '../runtime/contracts.ts';
import { starterPacks } from '../runtime/ontology.ts';

// BK-08 and AS-05 through the real engine: reviews recorded only by the reviewer themself, recipe
// "accepted by" from the import commit, and the receipt's provenance stored and served. Synthetic data only.
const period = { from: '2026-09-01', to: '2026-09-30' };
const csv = `id,kind,date,amount,currency,customerId,invoiceId,orderId,dueDate,status,description,branch
order-a,sale,2026-09-03,1250.25,INR,customer-a,invoice-a,order-a,,delivered,Delivered goods,main
order-b,sale,2026-09-04,799.75,INR,customer-b,invoice-b,order-b,,delivered,Delivered goods,main
`;
const recipe = {
  version: 1, id: 'synthetic-shop-v1', system: 'synthetic-csv', edition: '1', scope: { company: 'Synthetic Shop', branches: ['main'] },
  bindings: [
    { target: 'entityId', source: 'id', type: 'string', nulls: 'reject' },
    { target: 'kind', source: 'kind', type: 'string', nulls: 'reject' },
    { target: 'validFrom', source: 'date', type: 'date', dateFormat: 'ISO', nulls: 'reject' },
    { target: 'amountMinor', source: 'amount', type: 'money', moneyUnit: 'major', currency: 'INR', nulls: 'reject' },
    { target: 'currency', source: 'currency', type: 'string', nulls: 'reject' },
    ...['customerId', 'invoiceId', 'orderId', 'status', 'description', 'branch'].map(name => ({ target: name, source: name, type: 'string', nulls: 'omit' })),
    { target: 'dueDate', source: 'dueDate', type: 'date', dateFormat: 'ISO', nulls: 'omit' },
  ],
  allowedKinds: ['sale'], allowedStatuses: ['delivered'], onUnmapped: 'reject',
};
const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected); return true; };

async function fixture(t: any) {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-core-data-provenance-'));
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file' });
  t.after(async () => { await engine.close(); await rm(directory, { recursive: true, force: true }); });
  await engine.request('workspace.create', { name: 'Synthetic Shop', passphrase: 'Synthetic provenance passphrase 2026', demo: false, pack: 'ecommerce', folder: 'main' });
  const add = async (name: string, role: string): Promise<Context> => { const m = await engine.request('members.add', { name, role }); return { memberId: m.id, role: m.role, epoch: m.epoch, channel: 'desktop' }; };
  // A cofounder is added last: after that, seat changes need two people.
  const ravi = await add('Ravi', 'accountant'), vik = await add('Vik', 'viewer');
  return { engine, ravi, vik, asha: await add('Asha', 'cofounder') };
}

test('a release is reviewed and co-signed only by other people, and every receipt then carries its provenance', async t => {
  const { engine, ravi, asha, vik } = await fixture(t);
  const dictionary = await engine.request('ontology.get', {}).then((s: any) => s.current);
  const release = { version: dictionary.version, hash: dictionary.hash };
  await assert.rejects(engine.request('meanings.review', { ...release, kind: 'review' }), code('REVIEW_SELF'));
  await assert.rejects(engine.requestAs(vik, 'meanings.review', { ...release, kind: 'review' }), code('FORBIDDEN'));
  await assert.rejects(engine.requestAs(ravi, 'meanings.review', { version: release.version, hash: 'f'.repeat(64), kind: 'review' }), code('RELEASE_NOT_FOUND'));
  await assert.rejects(engine.requestAs(ravi, 'meanings.review', { ...release, kind: 'review', memberId: 'someone' }), code('INVALID_PROVENANCE_REQUEST'));
  await assert.rejects(engine.requestAs({ ...ravi, channel: 'mcp' }, 'meanings.review', { ...release, kind: 'review' }), (error: any) => error?.code !== undefined);
  const reviewed = await engine.requestAs(ravi, 'meanings.review', { ...release, kind: 'review' });
  assert.deepEqual(reviewed.by, { memberId: ravi.memberId, name: 'Ravi' });
  await assert.rejects(engine.requestAs(ravi, 'meanings.review', { ...release, kind: 'review' }), code('ALREADY_REVIEWED'));
  await engine.requestAs(asha, 'meanings.review', { ...release, kind: 'cosign' });

  await engine.request('sources.import', { sourceId: 'synthetic-export', format: 'csv', content: csv, recipe, expectedTotals: { rowCount: 2, amountMinor: '205000' } });
  const receipt = await engine.request('calculation.run', { operation: 'revenue', period });
  assert.equal(receipt.valueMinor, '205000');
  const p = receipt.provenance;
  assert.equal(p.recipes.length, 1);
  assert.deepEqual({ ...p.recipes[0], acceptedAt: typeof p.recipes[0].acceptedAt }, { sourceId: 'synthetic-export', recipeId: 'synthetic-shop-v1', acceptedBy: 'owner', acceptedAt: 'string' });
  assert.deepEqual({ ...p.meaning, reviewedAt: typeof p.meaning.reviewedAt }, { publishedBy: 'owner', reviewedBy: ravi.memberId, coSignedBy: asha.memberId, reviewedAt: 'string' });
  assert.equal(p.forecast, null);
  assert.deepEqual(p.allowedBy, { ruleId: p.allowedBy.ruleId, check: 'source access check passed; number guard passed', device: 'desktop', memberId: 'owner', at: receipt.createdAt });
  assert.match(p.allowedBy.ruleId, /^policy\.allowed-sources:/);
  // Stored on the receipt exactly as returned.
  assert.deepEqual(await engine.request('receipts.get', { id: receipt.id }), receipt);

  const served = await engine.request('receipts.provenance', { receiptId: receipt.id });
  assert.equal(served.recorded, 'recorded');
  assert.deepEqual(served.recipes.map((r: any) => [r.sourceId, r.state, r.recipeId, r.acceptedBy.memberId]), [['synthetic-export', 'recorded', 'synthetic-shop-v1', 'owner']]);
  assert.notEqual(served.recipes[0].acceptedBy.name, 'unknown');
  assert.deepEqual(served.meaning.reviewedBy.map((r: any) => [r.name, r.via]), [['Ravi', 'meanings.review']]);
  assert.deepEqual(served.meaning.coSignedBy.map((r: any) => [r.name, r.via]), [['Asha', 'meanings.review']]);
  assert.deepEqual(served.meaning.atCalculation.reviewedBy.name, 'Ravi');
  assert.equal(served.forecast, 'not applicable');
  assert.deepEqual(served.allowedBy.device, { channel: 'desktop', deviceId: 'absent' });
  assert.equal(served.allowedBy.checkStep, 'source access check passed; number guard passed');

  // Same refusal for an unknown receipt and someone else's.
  const refusals = await Promise.all([engine.requestAs(ravi, 'receipts.provenance', { receiptId: receipt.id }), engine.request('receipts.provenance', { receiptId: 'receipt_unknown' })]
    .map(p => p.then(() => null, (e: any) => [e.code, e.message])));
  assert.deepEqual(refusals[0], ['RECEIPT_NOT_FOUND', 'This receipt is unavailable.']);
  assert.deepEqual(refusals[0], refusals[1]);
  await assert.rejects(engine.requestAs(ravi, 'receipts.get', { id: receipt.id }), code('RECEIPT_FORBIDDEN'));
});

test('definitions carry a worked example and a date used, and the release history names reviewers', async t => {
  const { engine, ravi } = await fixture(t);
  const pack = structuredClone(starterPacks.find(p => p.pack === 'ecommerce')!);
  const refunds = pack.definitions.find(d => d.name === 'refunds')!;
  const bad = structuredClone(pack); bad.definitions.find(d => d.name === 'refunds')!.example = { rows: [{ label: 'Credit note 7', amountMinor: '500', counted: true }], resultMinor: '600' };
  await assert.rejects(engine.request('ontology.publish', { draft: bad }), code('INVALID_DEFINITION'));
  Object.assign(refunds, { sign: -1, usedFrom: '2026-04-01', example: { rows: [{ label: 'Credit note 7', amountMinor: '500', counted: true }, { label: 'Cancelled order 9', amountMinor: '900', counted: false, reason: 'Cancelled before delivery.' }], resultMinor: '-500' } });
  const published = await engine.request('ontology.publish', { draft: pack });
  await engine.requestAs(ravi, 'meanings.review', { version: published.version, hash: published.hash, kind: 'review' });
  const { releases } = await engine.request('meanings.releases', {});
  assert.deepEqual(releases.map((r: any) => r.version), [1, 2]);
  const [first, second] = releases;
  assert.equal(first.reviewers, 'not reviewed'); assert.equal(first.coSigners, 'not co-signed');
  assert.deepEqual(first.publishedBy, { memberId: 'owner', name: first.publishedBy.name });
  assert.ok(first.definitions.every((d: any) => d.example === 'absent' && d.usedFrom === 'absent'));
  assert.deepEqual(second.reviewers.map((r: any) => r.name), ['Ravi']);
  const word = second.definitions.find((d: any) => d.name === 'refunds');
  assert.equal(word.usedFrom, '2026-04-01');
  assert.deepEqual(word.example.rows[1], { label: 'Cancelled order 9', amountMinor: '900', counted: false, reason: 'Cancelled before delivery.' });
  await assert.rejects(engine.request('meanings.releases', { all: true }), code('INVALID_PROVENANCE_REQUEST'));
});
