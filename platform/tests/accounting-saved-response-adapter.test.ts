import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sha256 } from '../runtime/adapters/accounting/common.ts';
import { createZohoSavedResponseAdapter, zohoSavedResponseConfiguration, ZOHO_SAVED_RESPONSE_OPERATION_ID,
  ZOHO_SAVED_RESPONSE_VERSION, type ZohoSavedResponseConfig, type ZohoSavedResponseProfile } from '../runtime/adapters/accounting/zoho-saved-response.ts';
import { ReadTransportError, type ReadPageRequest, type ReadTransportContext } from '../runtime/connector-framework/read.ts';
import type { ConnectorOperationScope } from '../runtime/connector-framework/registry.ts';

// Authored synthetic credit notes only; no vendor account or file export qualification.
const raw = readFileSync(new URL('./fixtures/accounting/zoho/creditnotes-page.json', import.meta.url));
const profile: ZohoSavedResponseProfile = { organizationId: '12345', companyId: 'synthetic-company', dataset: 'synthetic-creditnotes', pageSha256: [sha256(raw)] };
const request: ReadPageRequest = { authority: { tenantId: 'synthetic-workspace', sourceId: 'synthetic-source',
  companyId: profile.companyId, organizationId: profile.organizationId }, dataScope: { company: profile.companyId, dataset: profile.dataset, branches: ['all'] }, cursor: null };
const context = (signal = new AbortController().signal): ReadTransportContext => ({ signal, timeoutMs: 1000, maxBytes: 1_000_000, attempt: 1, retryOwner: 'dispatcher',
  authorization: { scope: request.authority, authorityRevision: 'synthetic-owner-1', grantedScopes: ['files.read'], expiresAtMs: 9_000_000_000_000, credentialReference: null } });
function operation(input = profile): ConnectorOperationScope {
  return { connectorId: 'zoho-books', connectorVersion: ZOHO_SAVED_RESPONSE_VERSION, operationId: ZOHO_SAVED_RESPONSE_OPERATION_ID,
    kind: 'export', transport: 'file', applicability: { applicationVersion: 'v3', module: 'creditnotes', edition: 'synthetic-fixture',
      deploymentProfile: 'synthetic', configuration: zohoSavedResponseConfiguration(input) } };
}
function config(content: Uint8Array = raw, additions: Partial<ZohoSavedResponseConfig> = {}): ZohoSavedResponseConfig {
  const selected = { ...profile, pageSha256: [sha256(content)] };
  return { ...selected, environment: 'synthetic', operation: operation(selected),
    readFile: async () => ({ content, contentType: 'application/json', organizationId: selected.organizationId, companyId: selected.companyId }), ...additions };
}
const received = (bytes: number, kind = 'invalid-request') => (error: unknown) => error instanceof ReadTransportError && error.kind === kind && error.receivedBytes === bytes;

test('saved response preserves BOM/CRLF/native numbers and retains unavailable source time, totals and snapshot', async () => {
  const bytes = Buffer.from('\uFEFF' + raw.toString('utf8').replaceAll('\n', '\r\n'));
  const adapter = createZohoSavedResponseAdapter(config(bytes)), page = await adapter.readPage(request, context());
  assert.deepEqual(page.content, new Uint8Array(bytes)); assert.equal(sha256(page.content), sha256(bytes));
  assert.equal(page.rowCount, 1); assert.deepEqual(page.continuation, { kind: 'complete' });
  assert.deepEqual(page.source, { reportReference: null, generatedAtMs: null, snapshotId: null, completeness: 'unknown', totalRows: null });
  assert.equal(adapter.mode, 'export'); assert.equal(adapter.retrySafety, 'single-attempt'); assert.deepEqual(adapter.requiredAuthScopes, ['files.read']);
  bytes[0] = 0; assert.notEqual(sha256(page.content), sha256(bytes));
});

test('file set, company, dataset, parser version and independent export operation stay pinned', async () => {
  const selected = config(), adapter = createZohoSavedResponseAdapter(selected);
  Reflect.set(selected.pageSha256, '0', sha256('changed file')); selected.companyId = 'changed-company';
  selected.operation.operationId = 'changed-operation'; selected.operation.applicability.module = 'invoices';
  assert.ok(Object.isFrozen(adapter)); assert.ok(Object.isFrozen(adapter.operation.applicability));
  assert.equal(Reflect.set(adapter.requiredAuthScopes, '0', 'other'), false);
  const page = await adapter.readPage(request, context()); assert.equal(page.rowCount, 1);
  assert.notEqual(zohoSavedResponseConfiguration(profile), zohoSavedResponseConfiguration({ ...profile, dataset: 'other' }));
  for (const patch of [{ companyId: 'other' }, { pageSha256: [sha256('other')] },
    { operation: { ...operation(), kind: 'read' as const, transport: 'api' as const } },
    { operation: { ...operation(), connectorVersion: 'books-v3-adapter-2' } }]) {
    assert.throws(() => createZohoSavedResponseAdapter(config(raw, patch)), { code: 'ZOHO_SAVED_OPERATION_MISMATCH' });
  }
  for (const hashes of [[], ['invalid'], Array(21).fill(sha256(raw))]) {
    assert.throws(() => zohoSavedResponseConfiguration({ ...profile, pageSha256: hashes }), { code: 'ZOHO_SAVED_MANIFEST_INVALID' });
  }
});

test('unsupported company/domain/cursor and mismatched authorization refuse before the host reads files', async () => {
  let calls = 0;
  const adapter = createZohoSavedResponseAdapter(config(raw, { readFile: async () => { calls++; throw new Error('Must not read'); } }));
  for (const changed of [
    { ...request, authority: { ...request.authority, organizationId: '99999' } },
    { ...request, dataScope: { ...request.dataScope!, dataset: 'other' } },
    { ...request, dataScope: { ...request.dataScope!, branches: ['branch-a'] } },
    { ...request, dataScope: { ...request.dataScope!, period: { from: '2026-09-01', to: '2026-09-30' } } },
    { ...request, cursor: { kind: 'token' as const, token: 'source-instructions' } },
    { ...request, cursor: { kind: 'page' as const, page: 2 } },
  ]) await assert.rejects(adapter.readPage(changed, context()));
  await assert.rejects(adapter.readPage(request, { ...context(), authorization: { ...context().authorization,
    scope: { ...request.authority, sourceId: 'other-source' } } }), { code: 'ZOHO_SAVED_AUTHORITY_MISMATCH' });
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(adapter.readPage(request, context(aborted.signal)), received(0, 'cancelled'));
  assert.equal(calls, 0);
});

test('incomplete, extra, wrong-page and truncated saved responses cannot manufacture a terminal chain', async () => {
  const original = raw.toString('utf8');
  for (const content of [original.replace('"has_more_page": false', '"has_more_page": true'),
    original.replace('"page": 1', '"page": 2'), original.replace('"has_more_page": false', '"has_more_page": null'), original.slice(0, -10)]) {
    const bytes = Buffer.from(content), adapter = createZohoSavedResponseAdapter(config(bytes));
    await assert.rejects(adapter.readPage(request, context()), received(bytes.byteLength));
  }
  const extra = { ...profile, pageSha256: [sha256(raw), sha256(raw)] };
  const adapter = createZohoSavedResponseAdapter(config(raw, { ...extra, operation: operation(extra) }));
  await assert.rejects(adapter.readPage(request, context()), received(raw.byteLength));
});

test('changed bytes, foreign custody, encoding, invalid UTF-8, oversized files and cancellation account for received bytes', async () => {
  for (const patch of [{ organizationId: '99999' }, { companyId: 'foreign' }, { contentType: 'application/json; charset=utf-16' },
    { content: Buffer.from(raw.toString('utf8') + ' ') }]) {
    const file = { content: raw, contentType: 'application/json', companyId: profile.companyId, organizationId: profile.organizationId, ...patch };
    const adapter = createZohoSavedResponseAdapter(config(raw, { readFile: async () => file }));
    await assert.rejects(adapter.readPage(request, context()), received(file.content.byteLength));
  }
  const invalid = Uint8Array.from([0xff]);
  await assert.rejects(createZohoSavedResponseAdapter(config(invalid)).readPage(request, context()), received(invalid.byteLength));
  await assert.rejects(createZohoSavedResponseAdapter(config()).readPage(request, { ...context(), maxBytes: 10 }), received(raw.byteLength));
  const abort = new AbortController();
  const cancelled = createZohoSavedResponseAdapter(config(raw, { readFile: async () => {
    abort.abort(); return { content: raw, contentType: 'application/json', companyId: profile.companyId, organizationId: profile.organizationId };
  } }));
  await assert.rejects(cancelled.readPage(request, context(abort.signal)), received(raw.byteLength, 'cancelled'));
});
