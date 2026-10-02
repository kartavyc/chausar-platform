import assert from 'node:assert/strict';
import type {CalculationReceipt, CalculationRequest, ReceiptRow} from '../../runtime/calculator.ts';
import type {Context} from '../../runtime/contracts.ts';
import {demoCsv, demoRecipe, type ImportInput} from '../../runtime/ingest.ts';

// Public functional helper only. The caller owns actual workspace/adapter/HTTP
// lifecycle, creates the default retail dictionary, and permits main AND west.
// This file installs no storage/provider, creates no State, and executes on import nothing.
export type PublicRpc = (method: string, payload?: unknown) => Promise<unknown>;
export type ExpectedNewOwner = Pick<Context, 'memberId' | 'epoch'>;
export type ReceiptTriplet = [CalculationReceipt, CalculationReceipt, CalculationReceipt];
export const SOURCE_ID = 'independent-postgres-september-register';
export const PERIOD = {from: '2026-09-01', to: '2026-09-30'} as const;
export const CONTROL_TOTAL = '1230000';
export const CONTROL_ROWS = 10;
export const SOURCE_CSV = demoCsv;

export function sourceInput(): ImportInput {
  return {sourceId: SOURCE_ID, format: 'csv', content: SOURCE_CSV, recipe: structuredClone(demoRecipe),
    expectedTotals: {rowCount: CONTROL_ROWS, amountMinor: CONTROL_TOTAL}};
}

type SeedRecord = {id: string; sourceId: string; format: string; rowIds: string[]; totalsMinor: string;
  expectedTotals: {rowCount: number; amountMinor: string}; coverage: {
    sourceRows: number; importedRows: number; rejectedRows: number; expectedRows: number | null; reconciled: boolean;
  }};

/** Call after actual public retail workspace creation. No private facts are seeded. */
export async function seed(rpc: PublicRpc) {
  const input = sourceInput(), imported = await rpc('sources.import', input) as SeedRecord;
  assert.ok(imported && typeof imported === 'object');
  assert.equal(typeof imported.id, 'string'); assert.ok(imported.id.length > 0);
  assert.equal(imported.sourceId, SOURCE_ID); assert.equal(imported.format, 'csv');
  assert.equal(imported.totalsMinor, '1230000');
  assert.deepEqual(imported.expectedTotals, {rowCount: 10, amountMinor: '1230000'});
  assert.deepEqual(imported.coverage, {sourceRows: 10, importedRows: 10, rejectedRows: 0, expectedRows: 10, reconciled: true});
  assert.equal(imported.rowIds.length, 10); assert.equal(new Set(imported.rowIds).size, 10);
  return {input, imported};
}

type LiteralRow = Pick<ReceiptRow, 'entityId' | 'kind' | 'sourceRow' | 'validFrom' | 'amountMinor' | 'branch' | 'status'>;
type Golden = {operation: 'billed' | 'received' | 'earned'; totalMinor: string; rows: readonly LiteralRow[]};
// These values are literal independent oracles, never summed from returned facts,
// receipts, the production calculator or a SQL result. CSV header is source row one.
export const GOLDENS: readonly Golden[] = [
  {operation: 'billed', totalMinor: '300000', rows: [
    {entityId: 'inv-1', kind: 'invoice', sourceRow: 2, validFrom: '2026-09-03', amountMinor: '100000', branch: 'main', status: 'unpaid'},
    {entityId: 'inv-2', kind: 'invoice', sourceRow: 7, validFrom: '2026-09-12', amountMinor: '200000', branch: 'west', status: 'paid'},
  ]},
  {operation: 'received', totalMinor: '260000', rows: [
    {entityId: 'pay-1', kind: 'payment', sourceRow: 4, validFrom: '2026-09-05', amountMinor: '60000', branch: 'main', status: 'settled'},
    {entityId: 'pay-2', kind: 'payment', sourceRow: 9, validFrom: '2026-09-13', amountMinor: '200000', branch: 'west', status: 'settled'},
  ]},
  {operation: 'earned', totalMinor: '250000', rows: [
    {entityId: 'sale-1', kind: 'sale', sourceRow: 3, validFrom: '2026-09-04', amountMinor: '100000', branch: 'main', status: 'delivered'},
    {entityId: 'sale-2', kind: 'sale', sourceRow: 8, validFrom: '2026-09-14', amountMinor: '150000', branch: 'west', status: 'delivered'},
  ]},
];

export function calculationRequest(operation: Golden['operation']): CalculationRequest {
  // Omitting branch deliberately includes both main and west. A main-only run
  // would yield 100000/60000/100000 and must fail the full September oracle.
  return {operation, period: {...PERIOD}, sourceIds: [SOURCE_ID]};
}

function rowProjection(row: ReceiptRow): LiteralRow & {sourceId: string; measureField?: string} {
  return {entityId: row.entityId, kind: row.kind, sourceRow: row.sourceRow, validFrom: row.validFrom,
    amountMinor: row.amountMinor, branch: row.branch, status: row.status, sourceId: row.sourceId, measureField: row.measureField};
}
const byEntity = <T extends {entityId: string}>(rows: readonly T[]) => [...rows].sort((a, b) => a.entityId.localeCompare(b.entityId));

function assertReceipt(receipt: CalculationReceipt, golden: Golden, owner?: ExpectedNewOwner) {
  assert.ok(receipt && typeof receipt === 'object');
  assert.equal(typeof receipt.id, 'string'); assert.ok(receipt.id.length > 0);
  assert.equal(receipt.operation, golden.operation);
  assert.equal(receipt.totalMinor, golden.totalMinor); assert.equal(receipt.valueMinor, golden.totalMinor);
  assert.deepEqual(receipt.period, PERIOD); assert.equal(receipt.comparePeriod, null); assert.equal(receipt.branch, null);
  assert.deepEqual(receipt.requestedSourceIds, [SOURCE_ID]); assert.deepEqual(receipt.sourceIds, [SOURCE_ID]);
  assert.equal(receipt.currency, 'INR'); assert.equal(receipt.stale, false); assert.equal(receipt.staleReason, undefined);
  assert.equal(receipt.restatement, undefined); assert.deepEqual(receipt.assumptions, {});
  assert.match(receipt.dictionaryHash, /^[a-f0-9]{64}$/); assert.match(receipt.definitionHash, /^[a-f0-9]{64}$/);
  assert.ok(Number.isSafeInteger(receipt.ontologyVersion) && receipt.ontologyVersion > 0);
  assert.ok(typeof receipt.memberId === 'string' && receipt.memberId.length > 0);
  assert.ok(Number.isSafeInteger(receipt.epoch) && receipt.epoch > 0);
  if (owner) {assert.equal(receipt.memberId, owner.memberId); assert.equal(receipt.epoch, owner.epoch);}
  assert.equal(receipt.rows.length, 2); assert.equal(new Set(receipt.rowIds).size, 2);
  assert.deepEqual([...receipt.rowIds].sort(), receipt.rows.map(row => row.factId).sort());
  assert.deepEqual(byEntity(receipt.rows.map(rowProjection)), byEntity(golden.rows.map(row => ({...row,
    sourceId: SOURCE_ID, measureField: 'amountMinor'}))));
  assert.deepEqual(receipt.definitions.map(row => ({name: row.name, kind: row.kind, field: row.field, currency: row.currency})),
    [{name: golden.operation, kind: golden.rows[0].kind, field: 'amountMinor', currency: 'INR'}]);
  assert.equal(receipt.coverage.selectedRows, 2); assert.equal(receipt.coverage.countedRows, 2);
  assert.equal(receipt.coverage.unresolvedConflicts, 0); assert.equal(receipt.coverage.completeness, 'reconciled-imports');
  assert.deepEqual(receipt.coverage.gaps, []); assert.equal(receipt.coverage.importIds.length, 1);
  assert.deepEqual(receipt.figures.map(row => ({key: row.key, minor: row.minor, unit: row.unit, currency: row.currency})),
    [{key: 'total', minor: golden.totalMinor, unit: 'money', currency: 'INR'}]);
}

/** Sequential actual calculation -> retained read, under the caller's current owner. */
export async function assertThreeReceipts(rpc: PublicRpc, expectedNewOwner?: ExpectedNewOwner): Promise<ReceiptTriplet> {
  const receipts: CalculationReceipt[] = [];
  for (const golden of GOLDENS) {
    const receipt = await rpc('calculation.run', calculationRequest(golden.operation)) as CalculationReceipt;
    assertReceipt(receipt, golden, expectedNewOwner);
    assert.deepEqual(await rpc('receipts.get', {id: receipt.id}), receipt);
    receipts.push(receipt);
  }
  assert.equal(new Set(receipts.map(row => row.id)).size, 3);
  assert.equal(new Set(receipts.map(row => row.dictionaryHash)).size, 1);
  assert.equal(new Set(receipts.map(row => `${row.memberId}:${row.epoch}`)).size, 1);
  for (const receipt of receipts) assert.deepEqual(await rpc('receipts.get', {id: receipt.id}), receipt);
  return receipts as ReceiptTriplet;
}

/** Use first target triplet and genuinely reopened target triplet, not source history. */
export function assertSixUniqueReceiptIds(first: readonly CalculationReceipt[], reopened: readonly CalculationReceipt[]) {
  assert.equal(first.length, 3); assert.equal(reopened.length, 3);
  assert.equal(new Set([...first, ...reopened].map(row => row.id)).size, 6,
    'Reopened calculations must issue three fresh IDs, preserving the first three.');
  for (let index = 0; index < GOLDENS.length; index++) {
    assertReceipt(first[index], GOLDENS[index]); assertReceipt(reopened[index], GOLDENS[index]);
    for (const key of ['memberId', 'epoch', 'dictionaryHash', 'definitionHash', 'ontologyVersion'] as const)
      assert.equal(reopened[index][key], first[index][key]);
    assert.deepEqual(reopened[index].rows, first[index].rows);
  }
}

/** On the new actual Engine/pool, reauthenticate the earlier immutable receipts. */
export async function assertRetainedReceipts(rpc: PublicRpc, receipts: readonly CalculationReceipt[]) {
  for (const receipt of receipts) assert.deepEqual(await rpc('receipts.get', {id: receipt.id}), receipt);
}
