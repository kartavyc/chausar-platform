import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTallyExportAdapter, parseTallyNativeJson, parseTallyNativeJsonEnvelope, parseTallyXml, parseTallyXmlDocument, reconcileTallyVoucher, tallyOperation, tallyXmlSchemaFingerprint } from '../runtime/adapters/accounting/tally.ts';
import type { TallyProfile } from '../runtime/adapters/accounting/tally.ts';
import type { ReadPageRequest, ReadTransportContext } from '../runtime/connector-framework/read.ts';
import { ReadTransportError } from '../runtime/connector-framework/read.ts';

const xml = readFileSync(new URL('./fixtures/accounting/tally/vouchers-v1.xml', import.meta.url), 'utf8');
const accounts = readFileSync(new URL('./fixtures/accounting/tally/accounts-offline.xml', import.meta.url), 'utf8');
const native = readFileSync(new URL('./fixtures/accounting/tally/native7-envelope.json', import.meta.url), 'utf8');
const profile: TallyProfile = { applicationVersion: '7.0', wireFormat: 'xml-v1', envelopeVariant: 'response-v1', resource: 'vouchers', companyId: 'company-a', companyName: 'Synthetic Company', edition: 'fixture', configuration: 'fixture-tally-7-v1', deploymentProfile: 'synthetic-file', baseCurrency: 'INR' };
const nativeProfile: TallyProfile = { ...profile, wireFormat: 'native-json-v7' };
const accountProfile: TallyProfile = { ...profile, envelopeVariant: 'offline-native', resource: 'accounts' };
const errorCode = (code: string) => (error: unknown) => error instanceof Error && 'code' in error && error.code === code;
const request: ReadPageRequest = { authority: { tenantId: 'tenant-a', sourceId: 'tally-source', companyId: 'company-a' }, dataScope: { company: 'company-a', dataset: 'vouchers', branches: ['all'] }, cursor: null };
function context(): ReadTransportContext { return { authorization: { scope: request.authority, authorityRevision: 'fixture', grantedScopes: ['tally.export.read'], expiresAtMs: 1_999_999_999_999, credentialReference: null }, signal: new AbortController().signal, timeoutMs: 1000, maxBytes: 4 * 1024 * 1024, attempt: 1, retryOwner: 'dispatcher' }; }
const wrap = (voucher: string) => `<ENVELOPE><HEADER><VERSION>1</VERSION><STATUS>1</STATUS></HEADER><BODY><DATA><TALLYMESSAGE>${voucher}</TALLYMESSAGE></DATA></BODY></ENVELOPE>`;
const basicVoucher = (extra = '') => `<VOUCHER><MASTERID>1</MASTERID><DATE>20260930</DATE><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><VOUCHERNUMBER>1</VOUCHERNUMBER>${extra}</VOUCHER>`;

test('Tally XML preserves invoice ledger signs, inventory/batch breakdowns and exact high precision', () => {
  const page = parseTallyXml(xml, profile), invoice = page.records[0];
  assert.equal(page.records.length, 4); assert.equal(invoice.kind, 'invoice'); assert.equal(invoice.id, 'master:101');
  assert.equal(invoice.date, '2026-09-30'); assert.equal(invoice.lines[0].amount, '-118.000000000000000001');
  assert.equal(invoice.lines[0].description, 'Synthetic Buyer & Sons'); assert.equal(invoice.lines[0].source.debit, true);
  assert.equal(invoice.lines[2].quantity, '2'); assert.equal(invoice.lines[2].unitAmount, '50.00');
  assert.equal(invoice.lines[2].source.representation, 'inventory-breakdown');
  assert.equal(invoice.lines[3].source.representation, 'inventory-accounting-allocation');
  assert.deepEqual(invoice.source.balanceCheck, { state: 'balanced', signedTotal: '0.000000000000000000', reason: null });
  assert.equal(invoice.total, null); assert.equal(invoice.taxTotal, null); assert.equal(invoice.status, 'unknown');
  assert.equal(page.totalRows, null); assert.equal(page.sourceGeneratedAtMs, null); assert.equal(page.snapshotId, null);
});

test('Tally credits, receipt and payment are distinct source types; no unproved refund/settlement status', () => {
  const [invoice, credit, receipt, payment] = parseTallyXml(xml, profile).records;
  assert.equal(credit.kind, 'credit-note'); assert.equal(credit.lines[0].amount, '25.00');
  assert.equal(credit.allocations[0].documentId, 'SYN-1'); assert.equal(credit.allocations[0].source.billType, 'Agst Ref');
  assert.equal(receipt.kind, 'payment'); assert.equal(receipt.sourceStatus, 'Receipt');
  assert.equal(payment.kind, 'payment'); assert.equal(payment.sourceStatus, 'Payment'); assert.equal(payment.status, 'unknown');
  assert.equal(invoice.sourceType, 'Sales'); assert.equal(invoice.direction, 'receivable');
  assert.equal(credit.direction, 'receivable'); assert.equal(receipt.direction, 'inflow'); assert.equal(payment.direction, 'outflow');
  const purchase = parseTallyXml(wrap(basicVoucher().replace('Sales', 'Purchase')), profile).records[0];
  assert.equal(purchase.sourceType, 'Purchase'); assert.equal(purchase.direction, 'payable');
  assert.ok(payment.warnings.includes('tally-void-deletion-flags-unqualified'));
  assert.ok(payment.warnings.includes('tally-payment-refund-interpretation-unqualified'));
  assert.notEqual(invoice.id, credit.id); assert.notEqual(receipt.id, payment.id);
});

test('Tally account group hierarchy supplies reviewed classification candidates, with ambiguity unknown', () => {
  const page = parseTallyXml(accounts, accountProfile);
  assert.equal(page.records.length, 4); assert.equal(page.records[0].kind, 'account');
  assert.equal(page.records[0].account?.classification, 'asset');
  assert.deepEqual(page.records[0].source.groupPath, ['Synthetic Regional Debtors', 'Sundry Debtors']);
  assert.equal(page.records[1].account?.classification, 'income');
  assert.equal(page.records[2].account?.classification, 'unknown'); // taxes can be liabilities or assets
  assert.equal(page.records[3].account?.classification, 'unknown');
  assert.ok(page.records[0].warnings.includes('tally-account-classification-requires-human-review'));
  assert.throws(() => parseTallyXml(accounts.replace('Action="Create"', 'Action="Delete"'), accountProfile), errorCode('TALLY_COMMAND_NOT_EXPORT'));
  assert.throws(() => parseTallyXml(accounts.replace('Import Data', 'Execute'), accountProfile), errorCode('TALLY_COMMAND_NOT_EXPORT'));
});

test('Tally exact release, wire format and envelope variants cannot be substituted', () => {
  assert.notDeepEqual(tallyOperation(profile, 'import'), tallyOperation({ ...profile, applicationVersion: '6.0' }, 'import'));
  assert.throws(() => tallyOperation({ ...nativeProfile, applicationVersion: '6.0' }, 'import'), errorCode('TALLY_PROFILE_UNSUPPORTED'));
  assert.throws(() => parseTallyXml(xml.replace('<VERSION>1</VERSION>', '<VERSION>7</VERSION>'), profile), errorCode('TALLY_WIRE_VERSION_UNSUPPORTED'));
  assert.throws(() => parseTallyXml(accounts, profile));
  assert.throws(() => parseTallyXml(xml, nativeProfile), errorCode('TALLY_PROFILE_MISMATCH'));
  assert.notDeepEqual(tallyOperation(profile, 'import'), tallyOperation({ ...profile, baseCurrency: 'USD' }, 'import'));
  assert.notDeepEqual(tallyOperation(profile, 'import'), tallyOperation({ ...profile, companyId: 'company-b' }, 'import'));
  assert.notDeepEqual(tallyOperation(profile, 'import'), tallyOperation({ ...profile, companyName: 'Renamed Company' }, 'import'));
  assert.throws(() => tallyOperation({ ...profile, configuration: '*' }, 'import'), errorCode('TALLY_PROFILE_INVALID'));
  const earlierRelease = parseTallyXml(xml, { ...profile, applicationVersion: '6.0' });
  assert.equal(earlierRelease.records[0].source.applicationVersion, '6.0');
  assert.equal(earlierRelease.records[0].lines[0].amount, '-118.000000000000000001');
  assert.equal(parseTallyXml(accounts, { ...accountProfile, applicationVersion: '6.0' }).records.length, 4);
});

test('Tally rejects status failures, source commands, company mismatch and unsupported objects', () => {
  assert.throws(() => parseTallyXml(xml.replace('<STATUS>1</STATUS>', '<STATUS>0</STATUS>'), profile), errorCode('TALLY_SOURCE_FAILURE'));
  assert.throws(() => parseTallyXml(xml.replace('<STATUS>1</STATUS>', '<STATUS>1</STATUS><TALLYREQUEST>Import</TALLYREQUEST>'), profile), errorCode('TALLY_COMMAND_NOT_EXPORT'));
  assert.throws(() => parseTallyXml(wrap(basicVoucher().replace('<VOUCHER>', '<VOUCHER ACTION="Cancel">')), profile), errorCode('TALLY_COMMAND_NOT_EXPORT'));
  assert.throws(() => parseTallyXml(accounts.replace('Synthetic Company', 'Other Company'), accountProfile), errorCode('TALLY_COMPANY_MISMATCH'));
  assert.throws(() => parseTallyXml(wrap('<STOCKITEM><NAME>x</NAME></STOCKITEM>'), profile), errorCode('TALLY_OBJECT_UNSUPPORTED'));
});

test('Tally XML refuses DTD/entity attacks, duplicate scalars/attributes, namespaces and malformed roots', () => {
  assert.throws(() => parseTallyXmlDocument('<!DOCTYPE ENVELOPE [<!ENTITY x SYSTEM "file:///secret">]><ENVELOPE/>'), errorCode('TALLY_XML_DECLARATION_FORBIDDEN'));
  assert.throws(() => parseTallyXmlDocument('<ENVELOPE>&external;</ENVELOPE>'), errorCode('TALLY_XML_ENTITY_UNSUPPORTED'));
  assert.throws(() => parseTallyXmlDocument('<ENVELOPE>&#0;</ENVELOPE>'), errorCode('TALLY_XML_ENTITY_UNSUPPORTED'));
  assert.throws(() => parseTallyXmlDocument('<ENVELOPE>&#xFFFE;</ENVELOPE>'), errorCode('TALLY_XML_ENTITY_UNSUPPORTED'));
  assert.throws(() => parseTallyXmlDocument('<ENVELOPE>\uFFFF</ENVELOPE>'), errorCode('TALLY_XML_INVALID'));
  assert.throws(() => parseTallyXmlDocument('<ENVELOPE>]]></ENVELOPE>'), errorCode('TALLY_XML_INVALID'));
  assert.throws(() => parseTallyXmlDocument('<ENVELOPE a="1" a="2"/>'), errorCode('TALLY_XML_ATTRIBUTE_INVALID'));
  assert.throws(() => parseTallyXml(wrap(basicVoucher('<DATE>20260930</DATE>')), profile), errorCode('TALLY_XML_FIELD_AMBIGUOUS'));
  assert.throws(() => parseTallyXmlDocument('<ENVELOPE></OTHER>'), errorCode('TALLY_XML_INVALID'));
  assert.throws(() => parseTallyXmlDocument('<ENVELOPE/><ENVELOPE/>'), errorCode('TALLY_XML_INVALID'));
  assert.throws(() => parseTallyXml(xml.replaceAll('ENVELOPE', 'x:ENVELOPE'), profile), errorCode('TALLY_XML_ENVELOPE_UNSUPPORTED'));
});

test('Tally XML parser bounds depth and text and safely handles quoted delimiters/CDATA/numeric entities', () => {
  assert.throws(() => parseTallyXmlDocument('<x>'.repeat(50) + '</x>'.repeat(50)), errorCode('TALLY_XML_LIMIT'));
  assert.throws(() => parseTallyXmlDocument('<x>' + 'a'.repeat(100_001) + '</x>'), errorCode('TALLY_XML_LIMIT'));
  const node = parseTallyXmlDocument('<ENVELOPE test="a &gt; b"><NAME><![CDATA[<literal>]]>&#x20B9;</NAME></ENVELOPE>');
  assert.equal(node.attributes.test, 'a > b'); assert.equal(node.children[0].text, '<literal>₹');
});

test('Tally XML date, identity, logical and source amount meaning remain explicit', () => {
  assert.throws(() => parseTallyXml(wrap('<VOUCHER><DATE>20260230</DATE><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><VOUCHERNUMBER>1</VOUCHERNUMBER></VOUCHER>'), profile));
  assert.throws(() => parseTallyXml(wrap('<VOUCHER><DATE>30-Sep-2026</DATE><MASTERID>1</MASTERID></VOUCHER>'), profile), errorCode('TALLY_DATE_UNSUPPORTED'));
  assert.throws(() => parseTallyXml(wrap('<VOUCHER><DATE>20260930</DATE></VOUCHER>'), profile), errorCode('TALLY_VOUCHER_IDENTITY_REQUIRED'));
  assert.throws(() => parseTallyXml(wrap(basicVoucher('<ISINVOICE>True</ISINVOICE>')), profile), errorCode('TALLY_XML_LOGICAL_INVALID'));
  const record = parseTallyXml(wrap(basicVoucher('<AMOUNT>123.400</AMOUNT>')), profile).records[0];
  assert.equal(record.total, '123.400'); assert.equal(record.currency, 'INR');
  const unsupported = parseTallyXml(wrap(basicVoucher('<AMOUNT>USD 2.00 @ INR 80.00 = INR 160.00</AMOUNT>')), profile).records[0];
  assert.equal(unsupported.total, null); assert.equal(unsupported.currency, null); assert.ok(unsupported.warnings.includes('tally-amount-presentation-unsupported'));
  const missingCurrency = parseTallyXml(wrap(basicVoucher('<AMOUNT>2.00</AMOUNT>')), { ...profile, baseCurrency: null }).records[0];
  assert.equal(missingCurrency.currency, null);
});

test('Tally journal balancing excludes nested item/batch breakups and marks overlapping representations unavailable', () => {
  const balanced = parseTallyXmlDocument(basicVoucher('<LEDGERENTRIES.LIST><LEDGERNAME>Buyer</LEDGERNAME><AMOUNT>-10.00</AMOUNT></LEDGERENTRIES.LIST><LEDGERENTRIES.LIST><LEDGERNAME>Sales</LEDGERNAME><AMOUNT>10.00</AMOUNT><INVENTORYALLOCATIONS.LIST><AMOUNT>10.00</AMOUNT></INVENTORYALLOCATIONS.LIST></LEDGERENTRIES.LIST>'));
  assert.equal(reconcileTallyVoucher(balanced).state, 'balanced');
  const unbalanced = structuredClone(balanced); unbalanced.children.find(node => node.name === 'LEDGERENTRIES.LIST')!.children.find(node => node.name === 'AMOUNT')!.text = '-10.01';
  assert.deepEqual(reconcileTallyVoucher(unbalanced), { state: 'unbalanced', signedTotal: '-0.01', reason: null });
  const duplicate = parseTallyXmlDocument(basicVoucher('<LEDGERENTRIES.LIST><LEDGERNAME>Sales</LEDGERNAME><AMOUNT>10.00</AMOUNT></LEDGERENTRIES.LIST><ALLINVENTORYENTRIES.LIST><ACCOUNTINGALLOCATIONS.LIST><LEDGERNAME>Sales</LEDGERNAME><AMOUNT>10.00</AMOUNT></ACCOUNTINGALLOCATIONS.LIST></ALLINVENTORYENTRIES.LIST>'));
  assert.deepEqual(reconcileTallyVoucher(duplicate), { state: 'unavailable', signedTotal: null, reason: 'ambiguous-ledger-and-inventory-representation' });
});

test('Tally classification detects cyclic and duplicate group definitions', () => {
  const cyclic = accounts.replace('<PARENT>Sundry Debtors</PARENT>', '<PARENT>Synthetic Regional Debtors</PARENT>');
  assert.throws(() => parseTallyXml(cyclic, accountProfile), errorCode('TALLY_GROUP_CYCLE'));
  const duplicate = accounts.replace('</REQUESTDATA>', '<GROUP><NAME>Synthetic Regional Debtors</NAME><PARENT>Sundry Debtors</PARENT></GROUP></REQUESTDATA>');
  assert.throws(() => parseTallyXml(duplicate, accountProfile), errorCode('TALLY_GROUP_AMBIGUOUS'));
});

test('Tally observed schema changes when fields/attributes change, while scalar values remain stable', () => {
  assert.equal(tallyXmlSchemaFingerprint(xml, profile), tallyXmlSchemaFingerprint(xml.replace('SYN-1', 'SYN-OTHER'), profile));
  assert.notEqual(tallyXmlSchemaFingerprint(xml, profile), tallyXmlSchemaFingerprint(xml.replace('<MASTERID>101</MASTERID>', '<MASTERID>101</MASTERID><UNKNOWN>1</UNKNOWN>'), profile));
  assert.notEqual(tallyXmlSchemaFingerprint(xml, profile), tallyXmlSchemaFingerprint(xml.replace('<VOUCHER>', '<VOUCHER REMOTEID="unknown">'), profile));
});

test('Tally native7 envelope only preserves opaque objects; no invented accounting schema can import', () => {
  const parsed = parseTallyNativeJsonEnvelope(native, nativeProfile);
  assert.equal(parsed.messageCount, 1); assert.deepEqual(parsed.document.tallymessage, [{}]);
  assert.ok(parsed.warnings.includes('tally-native-json-import-unqualified'));
  assert.throws(() => parseTallyNativeJson(native, nativeProfile), errorCode('TALLY_NATIVE_JSON_MAPPING_UNQUALIFIED'));
  assert.throws(() => parseTallyNativeJsonEnvelope('{"status":"1","data":{},"custom":[]}', nativeProfile), errorCode('TALLY_JSON_ENVELOPE_UNSUPPORTED'));
  assert.throws(() => parseTallyNativeJsonEnvelope('{"status":"1","status":"0","data":{}}', nativeProfile), errorCode('ACCOUNTING_JSON_KEY_INVALID'));
  assert.throws(() => parseTallyNativeJsonEnvelope('{"status":"0","data":{}}', nativeProfile), errorCode('TALLY_SOURCE_FAILURE'));
  assert.throws(() => parseTallyNativeJsonEnvelope('{"status":1,"data":{}}', nativeProfile), errorCode('TALLY_SOURCE_FAILURE'));
  const numericShape = parseTallyNativeJsonEnvelope('{"status":"1","data":{"opaque":1}}', nativeProfile);
  const stringShape = parseTallyNativeJsonEnvelope('{"status":"1","data":{"opaque":"1"}}', nativeProfile);
  assert.notEqual(numericShape.schemaFingerprint, stringShape.schemaFingerprint);
  assert.throws(() => parseTallyNativeJsonEnvelope(native, profile), errorCode('TALLY_PROFILE_MISMATCH'));
});

test('Tally injected export reader binds custody and returns unchanged raw bytes with unknown source completeness', async () => {
  const bytes = new TextEncoder().encode(xml); let calls = 0;
  const adapter = createTallyExportAdapter({ profile, environment: 'synthetic', readExport: async () => { calls++; return { content: bytes, contentType: 'application/xml', companyId: 'company-a', companyName: 'Synthetic Company' }; } });
  const page = await adapter.readPage(request, context());
  assert.equal(calls, 1); assert.deepEqual(page.content, bytes); assert.notEqual(page.content, bytes);
  assert.equal(page.rowCount, 4); assert.deepEqual(page.continuation, { kind: 'complete' });
  assert.deepEqual(page.source, { reportReference: null, generatedAtMs: null, snapshotId: null, completeness: 'unknown', totalRows: null });
  assert.equal(adapter.mode, 'export'); assert.equal(adapter.retrySafety, 'single-attempt'); assert.equal(adapter.sideEffects, 'none');
  assert.throws(() => { adapter.operation.operationId = 'changed'; }, TypeError);
  assert.throws(() => { adapter.operation.applicability.configuration = 'changed'; }, TypeError);
});

test('Tally file domain refuses another company, partial branches, periods and cursor before acquisition', async () => {
  let calls = 0;
  const adapter = createTallyExportAdapter({ profile, environment: 'synthetic', readExport: async () => { calls++; throw new Error('must not run'); } });
  await assert.rejects(adapter.readPage({ ...request, authority: { ...request.authority, companyId: 'other' } }, context()), errorCode('ACCOUNTING_COMPANY_MISMATCH'));
  await assert.rejects(adapter.readPage({ ...request, dataScope: { ...request.dataScope!, branches: ['branch-a'] } }, context()), errorCode('TALLY_EXPORT_DOMAIN_UNQUALIFIED'));
  await assert.rejects(adapter.readPage({ ...request, dataScope: { ...request.dataScope!, period: { from: '2026-09-01', to: '2026-09-30' } } }, context()), errorCode('TALLY_EXPORT_DOMAIN_UNQUALIFIED'));
  await assert.rejects(adapter.readPage({ ...request, cursor: { kind: 'page', page: 2 } }, context()), errorCode('TALLY_EXPORT_DOMAIN_UNQUALIFIED'));
  assert.equal(calls, 0);
});

test('Tally acquisition accounts failed bytes and refuses UTF-16, custody mismatch and semantic native JSON', async () => {
  const bytes = new TextEncoder().encode(xml);
  const adapter = (content = bytes, contentType = 'application/xml', companyId = 'company-a', selectedProfile = profile) => createTallyExportAdapter({ profile: selectedProfile, environment: 'synthetic', readExport: async () => ({ content, contentType, companyId, companyName: 'Synthetic Company' }) });
  const failed = (error: unknown) => error instanceof ReadTransportError && error.kind === 'unsupported' && error.receivedBytes === bytes.byteLength;
  await assert.rejects(adapter(bytes, 'application/xml;charset=utf-16').readPage(request, context()), failed);
  await assert.rejects(adapter(bytes, 'application/xml', 'other').readPage(request, context()), failed);
  const smallContext = { ...context(), maxBytes: 10 };
  await assert.rejects(adapter().readPage(request, smallContext), (error: unknown) => error instanceof ReadTransportError && error.kind === 'invalid-request' && error.receivedBytes === bytes.byteLength);
  const nativeBytes = new TextEncoder().encode(native);
  await assert.rejects(adapter(nativeBytes, 'application/json', 'company-a', nativeProfile).readPage(request, context()), (error: unknown) => error instanceof ReadTransportError && error.kind === 'unsupported' && error.receivedBytes === nativeBytes.byteLength);
});
