import { check } from '../../contracts.ts';
import { ReadTransportError } from '../../connector-framework/read.ts';
import type { ExportReadAdapter, ReadEnvironment, ReadPageRequest, ReadTransportContext } from '../../connector-framework/read.ts';
import type { ConnectorOperationScope } from '../../connector-framework/registry.ts';
import { array, assertCompany, currency, date, decimal, makeLine, makeRecord, object, parseExactJson, requiredText, sha256, wireSchemaFingerprint } from './common.ts';
import type { AccountingAccount, AccountingLine, AccountingPage, AccountingRecord } from './common.ts';

/** Exact fixture-tested profiles, not a claim about every release or configuration. */
export type TallyProfile = {
  applicationVersion: '6.0' | '7.0'; wireFormat: 'xml-v1' | 'native-json-v7';
  envelopeVariant: 'response-v1' | 'offline-native'; resource: 'vouchers' | 'accounts';
  companyId: string; companyName: string; edition: string; configuration: string; deploymentProfile: string;
  /** Explicitly reviewed company currency. No implicit INR or symbol-to-ISO inference. */
  baseCurrency: string | null;
};
export type TallyXmlNode = { name: string; attributes: Record<string, string>; children: TallyXmlNode[]; text: string };
export type TallyExportFile = { content: Uint8Array; contentType: string; companyId: string; companyName: string };
export type TallyExportReader = (request: ReadPageRequest, context: ReadTransportContext) => Promise<TallyExportFile>;

function profileChecked(input: TallyProfile): TallyProfile {
  const profile = structuredClone(input);
  check(Object.keys(profile).every(key => ['applicationVersion', 'wireFormat', 'envelopeVariant', 'resource', 'companyId', 'companyName', 'edition', 'configuration', 'deploymentProfile', 'baseCurrency'].includes(key)), 'TALLY_PROFILE_INVALID', 'Only the reviewed source profile fields are accepted.');
  check(['6.0', '7.0'].includes(profile.applicationVersion) && ['xml-v1', 'native-json-v7'].includes(profile.wireFormat)
    && ['response-v1', 'offline-native'].includes(profile.envelopeVariant) && ['vouchers', 'accounts'].includes(profile.resource),
  'TALLY_PROFILE_UNSUPPORTED', 'An exact supported Tally format and release profile is required.');
  check(profile.wireFormat !== 'native-json-v7' || profile.applicationVersion === '7.0', 'TALLY_PROFILE_UNSUPPORTED', 'Native JSON requires the separate Release 7.0 profile.');
  for (const value of [profile.companyId, profile.companyName, profile.edition, profile.configuration, profile.deploymentProfile]) requiredText(value, 'TALLY_PROFILE_INVALID');
  check(![profile.edition, profile.configuration, profile.deploymentProfile].some(value => value.includes('*')), 'TALLY_PROFILE_INVALID', 'Wildcard applicability is not a reviewed profile.');
  currency(profile.baseCurrency);
  return profile;
}
export function tallyOperation(input: TallyProfile, kind: 'export' | 'import'): ConnectorOperationScope {
  const profile = profileChecked(input);
  return Object.freeze({ connectorId: 'tally', connectorVersion: '1.0.0', operationId: `${profile.wireFormat}.${profile.envelopeVariant}.${profile.resource}.${kind}`, kind, transport: 'file',
    applicability: Object.freeze({ applicationVersion: profile.applicationVersion, edition: profile.edition, module: profile.resource,
      configuration: `tally-profile:${sha256(JSON.stringify(profile))}`, deploymentProfile: profile.deploymentProfile }) });
}

/** Dependency-free bounded XML subset. DTDs, external entities, processing instructions and namespace aliases are never resolved. */
export function parseTallyXmlDocument(content: string): TallyXmlNode {
  check(typeof content === 'string' && Buffer.byteLength(content) <= 4 * 1024 * 1024, 'TALLY_XML_LIMIT', 'XML source exceeds the byte limit.');
  let input = content.replace(/^\uFEFF/, ''), position = 0, nodes = 0;
  check(!/[^\t\n\r\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/u.test(input), 'TALLY_XML_INVALID', 'XML contains invalid characters.');
  if (input.startsWith('<?xml')) {
    const declaration = /^<\?xml\s+version=(?:"1\.0"|'1\.0')(?:\s+encoding=(?:"UTF-8"|'UTF-8'|"utf-8"|'utf-8'))?(?:\s+standalone=(?:"(?:yes|no)"|'(?:yes|no)'))?\s*\?>/.exec(input);
    check(declaration, 'TALLY_XML_ENCODING_UNSUPPORTED', 'Only declared UTF-8 XML 1.0 is supported.'); input = input.slice(declaration[0].length);
  }
  const stack: TallyXmlNode[] = []; let root: TallyXmlNode | null = null;
  const fail = () => check(false, 'TALLY_XML_INVALID', 'Malformed or ambiguous XML is refused.');
  const decode = (raw: string): string => {
    check(!/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[\da-fA-F]+);)/.test(raw), 'TALLY_XML_ENTITY_UNSUPPORTED', 'Only predefined and numeric character entities are accepted.');
    return raw.replace(/&([^;]+);/g, (_match, entity: string) => {
      const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
      if (Object.hasOwn(named, entity)) return named[entity];
      const point = entity.startsWith('#x') ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
      check(Number.isSafeInteger(point) && (point === 9 || point === 10 || point === 13 || point >= 32 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) && point !== 0xfffe && point !== 0xffff), 'TALLY_XML_ENTITY_UNSUPPORTED', 'Invalid numeric entity is refused.');
      return String.fromCodePoint(point);
    });
  };
  const append = (raw: string, cdata = false) => {
    check(cdata || !raw.includes(']]>'), 'TALLY_XML_INVALID', 'A CDATA delimiter cannot occur in ordinary XML text.');
    if (!stack.length) { if (raw.trim()) fail(); return; }
    const current = stack.at(-1)!; current.text += cdata ? raw : decode(raw);
    check(current.text.length <= 100_000, 'TALLY_XML_LIMIT', 'XML field exceeds the text limit.');
  };
  while (position < input.length) {
    if (input[position] !== '<') { const end = input.indexOf('<', position); append(input.slice(position, end < 0 ? undefined : end)); position = end < 0 ? input.length : end; continue; }
    if (input.startsWith('<!--', position)) { const end = input.indexOf('-->', position + 4); if (end < 0 || input.slice(position + 4, end).includes('--')) fail(); position = end + 3; continue; }
    if (input.startsWith('<![CDATA[', position)) { const end = input.indexOf(']]>', position + 9); if (end < 0 || !stack.length) fail(); append(input.slice(position + 9, end), true); position = end + 3; continue; }
    check(!input.startsWith('<!', position) && !input.startsWith('<?', position), 'TALLY_XML_DECLARATION_FORBIDDEN', 'XML declarations and executable instructions are refused.');
    let end = position + 1, quote: string | null = null;
    for (; end < input.length; end++) { const char = input[end]; if (quote) { if (char === quote) quote = null; } else if (char === '"' || char === "'") quote = char; else if (char === '>') break; }
    if (end === input.length || quote) fail();
    const tag = input.slice(position + 1, end); position = end + 1;
    if (tag.startsWith('/')) { const name = tag.slice(1); if (!/^[A-Za-z_][A-Za-z0-9_.:-]*\s*$/.test(name) || !stack.length || stack.at(-1)!.name !== name.trim()) fail(); stack.pop(); continue; }
    const selfClosing = tag.endsWith('/'), body = selfClosing ? tag.slice(0, -1) : tag;
    const match = /^([A-Za-z_][A-Za-z0-9_.:-]*)([\s\S]*)$/.exec(body); if (!match) { fail(); continue; }
    const node: TallyXmlNode = { name: match[1], attributes: {}, children: [], text: '' }; let rest = match[2];
    while (rest.length) {
      if (!rest.trim()) break;
      const attribute = /^\s+([A-Za-z_][A-Za-z0-9_.:-]*)\s*=\s*(?:"([^"<]*)"|'([^'<]*)')/.exec(rest);
      if (!attribute) { fail(); break; }
      check(!Object.hasOwn(node.attributes, attribute[1]) && !['__proto__', 'constructor', 'prototype'].includes(attribute[1]), 'TALLY_XML_ATTRIBUTE_INVALID', 'Duplicate or reserved XML attributes are refused.');
      check(Object.keys(node.attributes).length < 32, 'TALLY_XML_LIMIT', 'XML attribute limit exceeded.');
      node.attributes[attribute[1]] = decode(attribute[2] ?? attribute[3]); rest = rest.slice(attribute[0].length);
    }
    check(++nodes <= 200_000 && stack.length < 48, 'TALLY_XML_LIMIT', 'XML structural limit exceeded.');
    if (stack.length) stack.at(-1)!.children.push(node); else { if (root) fail(); root = node; }
    if (!selfClosing) stack.push(node);
  }
  check(root !== null && stack.length === 0, 'TALLY_XML_INVALID', 'XML must contain one complete root.'); return root;
}
const children = (node: TallyXmlNode, ...names: string[]) => node.children.filter(child => names.includes(child.name));
function one(node: TallyXmlNode, name: string, required = false): TallyXmlNode | null {
  const matches = children(node, name); check(matches.length <= 1 && (!required || matches.length === 1), 'TALLY_XML_FIELD_AMBIGUOUS', 'A required XML scalar or container is missing or duplicated.'); return matches[0] ?? null;
}
function scalar(node: TallyXmlNode, name: string): string | null {
  const field = one(node, name); if (!field) return null;
  check(field.children.length === 0, 'TALLY_XML_SCALAR_REQUIRED', 'An XML field must be scalar.'); return field.text.trim();
}
function logical(node: TallyXmlNode, name: string): boolean | null {
  const value = scalar(node, name); if (value === null || value === '') return null;
  check(value === 'Yes' || value === 'No', 'TALLY_XML_LOGICAL_INVALID', 'The XML logical field must be Yes or No.'); return value === 'Yes';
}
function amount(node: TallyXmlNode, warnings: string[], name = 'AMOUNT'): string | null {
  const value = scalar(node, name); if (value === null || value === '') return null;
  if (!/^-?(?:0|[1-9]\d{0,99})(?:\.\d{1,100})?$/.test(value)) { warnings.push('tally-amount-presentation-unsupported'); return null; }
  return decimal(value);
}
function sourceDate(node: TallyXmlNode): string | null {
  const value = scalar(node, 'DATE'); if (!value) return null;
  check(/^\d{8}$/.test(value), 'TALLY_DATE_UNSUPPORTED', 'Only the documented YYYYMMDD calendar date is mapped.');
  return date(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`);
}
function quantity(value: string | null, warnings: string[]): string | null {
  if (!value) return null; const match = /^(-?(?:0|[1-9]\d{0,99})(?:\.\d{1,100})?)(?:\s+[^\d\s].*)?$/.exec(value);
  if (!match) { warnings.push('tally-compound-quantity-unsupported'); return null; } return decimal(match[1]);
}
function rate(value: string | null, warnings: string[]): string | null {
  if (!value) return null; const match = /^(-?(?:0|[1-9]\d{0,99})(?:\.\d{1,100})?)(?:\/[^\s]+)?$/.exec(value);
  if (!match) { warnings.push('tally-rate-presentation-unsupported'); return null; } return decimal(match[1]);
}

function exportObjects(document: TallyXmlNode, profile: TallyProfile): TallyXmlNode[] {
  check(document.name === 'ENVELOPE', 'TALLY_XML_ENVELOPE_UNSUPPORTED', 'The exact Tally envelope is required.');
  const header = one(document, 'HEADER', profile.envelopeVariant === 'response-v1');
  if (header) {
    const version = scalar(header, 'VERSION'); check(version === '1' || profile.envelopeVariant === 'offline-native' && version === null, 'TALLY_WIRE_VERSION_UNSUPPORTED', 'XML messaging version 1 is separate from the application release.');
    const status = scalar(header, 'STATUS');
    if (profile.envelopeVariant === 'response-v1') check(status === '1', 'TALLY_SOURCE_FAILURE', 'An explicit successful XML export response is required.');
    else check(status === null || status === '1', 'TALLY_SOURCE_FAILURE', 'The offline envelope reports failure.');
    const request = scalar(header, 'TALLYREQUEST');
    check(request === null || profile.envelopeVariant === 'offline-native' && request === 'Import Data', 'TALLY_COMMAND_NOT_EXPORT', 'Only the declared offline native importable-export wrapper may contain Import Data metadata.');
  }
  const body = one(document, 'BODY', true)!; let data: TallyXmlNode;
  if (profile.envelopeVariant === 'response-v1') data = one(body, 'DATA', true)!;
  else {
    const importData = one(body, 'IMPORTDATA', true)!; const description = one(importData, 'REQUESTDESC', true)!;
    const report = scalar(description, 'REPORTNAME');
    check(report === (profile.resource === 'vouchers' ? 'Vouchers' : 'All Masters'), 'TALLY_REPORT_UNSUPPORTED', 'The selected native export report must match its declared resource.');
    const variables = one(description, 'STATICVARIABLES');
    if (variables) { const company = scalar(variables, 'SVCURRENTCOMPANY'); check(company === null || company === profile.companyName, 'TALLY_COMPANY_MISMATCH', 'An embedded company selection does not match the bound company.'); }
    data = one(importData, 'REQUESTDATA', true)!;
  }
  check(!data.text.trim(), 'TALLY_SOURCE_FAILURE', 'Unstructured export error text is refused.');
  const collections = children(data, 'COLLECTION');
  check(collections.length <= 1 && !(collections.length && children(data, 'TALLYMESSAGE', 'VOUCHER', 'LEDGER', 'GROUP').length), 'TALLY_XML_FIELD_AMBIGUOUS', 'Ambiguous export containers are refused.');
  const container = collections[0] ?? data;
  const output: TallyXmlNode[] = [];
  for (const item of container.children) {
    if (item.name === 'TALLYMESSAGE') output.push(...item.children);
    else output.push(item);
  }
  check(output.every(node => ['VOUCHER', 'LEDGER', 'GROUP'].includes(node.name)), 'TALLY_OBJECT_UNSUPPORTED', 'This profile accepts only documented vouchers, ledger masters and group masters.');
  check(output.every(node => Object.entries(node.attributes).filter(([key]) => /^action$/i.test(key)).every(([_key, value]) => profile.envelopeVariant === 'offline-native' && value === 'Create')), 'TALLY_COMMAND_NOT_EXPORT', 'Only Create metadata in an offline native export is accepted; other action packets require a separate profile.');
  check(profile.resource === 'vouchers' ? output.every(node => node.name === 'VOUCHER') : output.every(node => node.name !== 'VOUCHER'), 'TALLY_RESOURCE_MISMATCH', 'The export contains another accounting resource.');
  return output;
}

const predefined: Record<string, AccountingAccount['classification']> = {
  'Capital Account': 'equity', 'Reserves & Surplus': 'equity', 'Current Assets': 'asset', 'Fixed Assets': 'asset', Investments: 'asset',
  'Bank Accounts': 'asset', 'Cash-in-Hand': 'asset', 'Deposits (Asset)': 'asset', 'Loans & Advances (Asset)': 'asset', 'Stock-in-Hand': 'asset', 'Sundry Debtors': 'asset',
  'Current Liabilities': 'liability', 'Loans (Liability)': 'liability', 'Sundry Creditors': 'liability', Provisions: 'liability',
  'Bank OD A/c': 'liability', 'Secured Loans': 'liability', 'Unsecured Loans': 'liability',
  'Sales Accounts': 'income', 'Direct Incomes': 'income', 'Indirect Incomes': 'income', 'Purchase Accounts': 'expense', 'Direct Expenses': 'expense', 'Indirect Expenses': 'expense',
};
function classification(parent: string | null, groups: Map<string, string | null>): { classification: AccountingAccount['classification']; path: string[] } {
  const path: string[] = []; let cursor = parent;
  while (cursor) {
    check(!path.includes(cursor) && path.length < 48, 'TALLY_GROUP_CYCLE', 'A group hierarchy contains a cycle or exceeds its limit.'); path.push(cursor);
    if (Object.hasOwn(predefined, cursor)) return { classification: predefined[cursor], path };
    if (!groups.has(cursor)) break; cursor = groups.get(cursor)!;
  }
  return { classification: 'unknown', path };
}
function ledgerLine(node: TallyXmlNode, warnings: string[]): AccountingLine {
  const debit = logical(node, 'ISDEEMEDPOSITIVE'), signed = amount(node, warnings);
  if (debit !== null && signed !== null && !/^\-?0(?:\.0+)?$/.test(signed) && debit !== signed.startsWith('-')) warnings.push('tally-debit-sign-contradiction');
  return makeLine({ description: scalar(node, 'LEDGERNAME'), accountId: scalar(node, 'LEDGERNAME'), amount: signed,
    source: { representation: 'ledger-posting', debit, partyLedger: logical(node, 'ISPARTYLEDGER'), xml: node } });
}
function inventoryLine(node: TallyXmlNode, warnings: string[]): AccountingLine {
  return makeLine({ description: scalar(node, 'STOCKITEMNAME'), quantity: quantity(scalar(node, 'BILLEDQTY'), warnings),
    unitAmount: rate(scalar(node, 'RATE'), warnings), amount: amount(node, warnings),
    source: { representation: 'inventory-breakdown', actualQuantity: scalar(node, 'ACTUALQTY'), billedQuantity: scalar(node, 'BILLEDQTY'), rate: scalar(node, 'RATE'),
      outward: logical(node, 'ISDEEMEDPOSITIVE') === null ? null : !logical(node, 'ISDEEMEDPOSITIVE')!, xml: node } });
}
/** Reconcile documented journal postings only. Item and batch breakdowns do not add a second amount. */
export function reconcileTallyVoucher(node: TallyXmlNode): { state: 'balanced' | 'unbalanced' | 'unavailable'; signedTotal: string | null; reason: string | null } {
  const direct = children(node, 'LEDGERENTRIES.LIST', 'ALLLEDGERENTRIES.LIST');
  const inventory = children(node, 'ALLINVENTORYENTRIES.LIST', 'INVENTORYENTRIES.LIST').flatMap(item => children(item, 'ACCOUNTINGALLOCATIONS.LIST'));
  const directNames = new Set(direct.map(item => scalar(item, 'LEDGERNAME')));
  if (inventory.some(item => directNames.has(scalar(item, 'LEDGERNAME')))) return { state: 'unavailable', signedTotal: null, reason: 'ambiguous-ledger-and-inventory-representation' };
  const warnings: string[] = [], postings = [...direct, ...inventory].map(item => amount(item, warnings));
  if (!postings.length || postings.some(value => value === null) || warnings.length) return { state: 'unavailable', signedTotal: null, reason: 'posting-amount-unavailable' };
  const values = postings as string[], scale = Math.max(...values.map(value => value.split('.')[1]?.length ?? 0));
  const sum = values.reduce((total, value) => {
    const negative = value.startsWith('-'), [whole, fraction = ''] = value.replace(/^-/, '').split('.');
    const exact = BigInt(whole + fraction.padEnd(scale, '0')); return total + (negative ? -exact : exact);
  }, 0n);
  const absolute = (sum < 0n ? -sum : sum).toString().padStart(scale + 1, '0');
  const signedTotal = `${sum < 0n ? '-' : ''}${scale ? absolute.slice(0, -scale) + '.' + absolute.slice(-scale) : absolute}`;
  return { state: sum === 0n ? 'balanced' : 'unbalanced', signedTotal, reason: null };
}
function voucher(node: TallyXmlNode, profile: TallyProfile): AccountingRecord {
  const warnings: string[] = ['tally-payment-settlement-unknown', 'tally-tax-schema-unqualified', 'tally-void-deletion-flags-unqualified'];
  const calendarDate = sourceDate(node), type = scalar(node, 'VOUCHERTYPENAME'), number = scalar(node, 'VOUCHERNUMBER'), masterId = scalar(node, 'MASTERID');
  const identity = masterId ? `master:${requiredText(masterId)}` : calendarDate && type && number ? `voucher:${sha256(JSON.stringify([calendarDate, type, number]))}` : null;
  check(identity, 'TALLY_VOUCHER_IDENTITY_REQUIRED', 'A source master ID or documented date/type/number identity is required.');
  if (!masterId) warnings.push('tally-composite-identity-requires-review');
  const ledgerNodes = children(node, 'LEDGERENTRIES.LIST', 'ALLLEDGERENTRIES.LIST'), inventoryNodes = children(node, 'ALLINVENTORYENTRIES.LIST', 'INVENTORYENTRIES.LIST');
  check(!(children(node, 'LEDGERENTRIES.LIST').length && children(node, 'ALLLEDGERENTRIES.LIST').length)
    && !(children(node, 'ALLINVENTORYENTRIES.LIST').length && children(node, 'INVENTORYENTRIES.LIST').length), 'TALLY_REPRESENTATION_AMBIGUOUS', 'Mixed alternative posting collections require separate qualification.');
  const lines = ledgerNodes.map(item => ledgerLine(item, warnings));
  for (const item of inventoryNodes) {
    lines.push(inventoryLine(item, warnings));
    lines.push(...children(item, 'ACCOUNTINGALLOCATIONS.LIST').map(allocation => { const result = ledgerLine(allocation, warnings); result.source.representation = 'inventory-accounting-allocation'; return result; }));
  }
  for (const item of ledgerNodes) lines.push(...children(item, 'INVENTORYALLOCATIONS.LIST').map(allocation => inventoryLine(allocation, warnings)));
  const allocations = ledgerNodes.flatMap(item => children(item, 'BILLALLOCATIONS.LIST').map(allocation => ({
    documentId: scalar(allocation, 'NAME'), documentKind: null, amount: amount(allocation, warnings),
    source: { billType: scalar(allocation, 'BILLTYPE'), ledgerName: scalar(item, 'LEDGERNAME'), identityBasis: 'bill-reference-name-not-document-id', xml: allocation },
  })));
  const balanceCheck = reconcileTallyVoucher(node); if (balanceCheck.state !== 'balanced') warnings.push(`tally-journal-${balanceCheck.state}`);
  const kind = type === 'Sales' || type === 'Purchase' ? 'invoice' : type === 'Credit Note' ? 'credit-note' : type === 'Receipt' || type === 'Payment' ? 'payment' : 'voucher';
  const direction = type === 'Sales' || type === 'Credit Note' ? 'receivable' : type === 'Purchase' ? 'payable' : type === 'Receipt' ? 'inflow' : type === 'Payment' ? 'outflow' : 'unknown';
  if (kind === 'payment') warnings.push('tally-payment-refund-interpretation-unqualified');
  if (kind === 'voucher') warnings.push('tally-voucher-type-not-normalized');
  const total = amount(node, warnings); if (total === null) warnings.push('tally-explicit-document-total-unavailable');
  if (profile.baseCurrency === null || warnings.includes('tally-amount-presentation-unsupported')) warnings.push('tally-currency-unavailable');
  return makeRecord({ id: identity!, kind, sourceType: type, direction, date: calendarDate, currency: warnings.includes('tally-amount-presentation-unsupported') ? null : profile.baseCurrency,
    total, lines, allocations, sourceStatus: type, source: { companyId: profile.companyId, companyName: profile.companyName,
      wireFormat: profile.wireFormat, applicationVersion: profile.applicationVersion, configurationProfile: profile.configuration, identityBasis: masterId ? 'source-master-id' : 'date-type-number',
      isInvoice: logical(node, 'ISINVOICE'), voucherType: type, voucherNumber: number, balanceCheck, xml: node }, warnings: [...new Set(warnings)] });
}
export function parseTallyXml(content: string, input: TallyProfile): AccountingPage {
  const profile = profileChecked(input); check(profile.wireFormat === 'xml-v1', 'TALLY_PROFILE_MISMATCH', 'XML and native JSON profiles are independent.');
  const nodes = exportObjects(parseTallyXmlDocument(content), profile), groups = new Map<string, string | null>();
  for (const node of nodes.filter(item => item.name === 'GROUP')) {
    const name = requiredText(scalar(node, 'NAME') ?? node.attributes.NAME, 'TALLY_GROUP_NAME_REQUIRED');
    check(!groups.has(name), 'TALLY_GROUP_AMBIGUOUS', 'Duplicate group definitions require quarantine.'); groups.set(name, scalar(node, 'PARENT'));
  }
  // Validate even unused custom groups, so malformed hierarchies cannot pass in metadata.
  for (const name of groups.keys()) classification(name, groups);
  const records = nodes.filter(node => node.name !== 'GROUP').map(node => {
    if (node.name === 'VOUCHER') return voucher(node, profile);
    const name = requiredText(scalar(node, 'NAME') ?? node.attributes.NAME, 'TALLY_LEDGER_NAME_REQUIRED'), parent = scalar(node, 'PARENT'), classified = classification(parent, groups);
    return makeRecord({ id: `ledger:${sha256(name)}`, kind: 'account', sourceType: 'Ledger', currency: profile.baseCurrency,
      account: { code: null, name, sourceType: 'LEDGER', sourceClass: parent, classification: classified.classification },
      source: { companyId: profile.companyId, companyName: profile.companyName, configurationProfile: profile.configuration, groupPath: classified.path, xml: node },
      warnings: ['tally-account-classification-requires-human-review', ...(classified.classification === 'unknown' ? ['tally-group-classification-unavailable'] : [])] });
  });
  return { records, continuation: { kind: 'complete' }, totalRows: null, sourceGeneratedAtMs: null, snapshotId: null,
    warnings: ['tally-file-end-is-not-company-completeness', 'tally-independent-source-totals-required', 'tally-source-snapshot-unverified'] };
}
/** Observed element/attribute paths: new optional fields conservatively produce a new schema. */
export function tallyXmlSchemaFingerprint(content: string, input: TallyProfile): string {
  const profile = profileChecked(input), root = parseTallyXmlDocument(content); exportObjects(root, profile);
  const paths = new Set<string>();
  const visit = (node: TallyXmlNode, prefix: string) => { const path = `${prefix}/${node.name}`; paths.add(path); for (const key of Object.keys(node.attributes)) paths.add(`${path}/@${key}`); node.children.forEach(child => visit(child, path)); };
  visit(root, ''); return sha256(JSON.stringify({ profile: { release: profile.applicationVersion, variant: profile.envelopeVariant, resource: profile.resource }, paths: [...paths].sort() }));
}
/** Envelope-only reader. Native object keys are unavailable in accessible official schema samples. */
export function parseTallyNativeJsonEnvelope(content: string, input: TallyProfile): { document: Record<string, unknown>; schemaFingerprint: string; messageCount: number | null; warnings: string[] } {
  const profile = profileChecked(input); check(profile.wireFormat === 'native-json-v7' && profile.envelopeVariant === 'response-v1', 'TALLY_PROFILE_MISMATCH', 'Only the documented Release 7 native response envelope is parsed.');
  const document = object(parseExactJson(content));
  const shape = object(parseExactJson(content, true));
  check(Object.keys(document).every(key => ['status', 'cmp_info', 'parms', 'tallymessage', 'data', 'result'].includes(key)), 'TALLY_JSON_ENVELOPE_UNSUPPORTED', 'Custom JSON and report-specific formats require independent schemas.');
  check(document.status === '1' && shape.status === 'string', 'TALLY_SOURCE_FAILURE', 'An explicit successful native JSON export envelope is required.');
  if (document.cmp_info !== undefined) object(document.cmp_info);
  if (document.parms !== undefined) array(document.parms);
  if (document.data !== undefined) object(document.data);
  if (document.result !== undefined) object(document.result);
  const messages = document.tallymessage === undefined ? null : array(document.tallymessage);
  if (messages) messages.forEach(entry => object(entry));
  check(messages !== null || document.data !== undefined, 'TALLY_JSON_DATA_REQUIRED', 'An export data container is required.');
  return { document, schemaFingerprint: wireSchemaFingerprint(content), messageCount: messages?.length ?? null,
    warnings: ['tally-native-json-accounting-schema-unavailable', 'tally-message-count-is-not-qualified-record-count', 'tally-native-json-import-unqualified'] };
}
export function parseTallyNativeJson(content: string, profile: TallyProfile): AccountingPage {
  parseTallyNativeJsonEnvelope(content, profile);
  check(false, 'TALLY_NATIVE_JSON_MAPPING_UNQUALIFIED', 'Native voucher and ledger schemas need official readable samples or authorized exports before mapping.');
}
/** Operator/host-selected export bytes only. No filesystem path, endpoint, credential resolution or Tally request execution. */
export function createTallyExportAdapter(config: { profile: TallyProfile; environment: ReadEnvironment; readExport: TallyExportReader }): ExportReadAdapter {
  const profile = profileChecked(config.profile), environment = config.environment, readExport = config.readExport;
  check(['synthetic', 'sandbox', 'live'].includes(environment) && typeof readExport === 'function', 'TALLY_ADAPTER_INVALID', 'A trusted export reader and actual environment are required.');
  return Object.freeze<ExportReadAdapter>({ mode: 'export', operation: tallyOperation(profile, 'export'), environment, sideEffects: 'none', retrySafety: 'single-attempt', retryOwner: 'dispatcher',
    requiredAuthScopes: Object.freeze(['tally.export.read']), pagination: Object.freeze({ kind: 'none' }),
    async readPage(request: ReadPageRequest, context: ReadTransportContext) {
      assertCompany(request, profile.companyId);
      check(request.cursor === null && request.dataScope?.dataset === profile.resource && request.dataScope.branches.length === 1 && request.dataScope.branches[0] === 'all' && request.dataScope.period === undefined,
        'TALLY_EXPORT_DOMAIN_UNQUALIFIED', 'Only the bound complete-file resource and explicit all-branches export domain can be acquired.');
      if (context.signal.aborted) throw new ReadTransportError('cancelled');
      const file = await readExport(request, context);
      check(file.content instanceof Uint8Array, 'TALLY_EXPORT_BYTES_REQUIRED', 'The trusted reader must supply original bytes.');
      const bytes = file.content.byteLength;
      if (bytes > context.maxBytes || bytes > 4 * 1024 * 1024) throw new ReadTransportError('invalid-request', null, 'settled', bytes);
      const content = new Uint8Array(file.content);
      if (context.signal.aborted) throw new ReadTransportError('cancelled', null, 'settled', bytes);
      try {
        check(file.companyId === profile.companyId && file.companyName === profile.companyName, 'TALLY_COMPANY_MISMATCH', 'Export custody must bind the exact selected company.');
        const expected = profile.wireFormat === 'xml-v1' ? /^(?:application|text)\/xml(?:;|$)/i : /^application\/json(?:;|$)/i;
        check(expected.test(file.contentType) && !/charset\s*=\s*(?!utf-8(?:\s*;|\s*$))/i.test(file.contentType), 'TALLY_ENCODING_UNSUPPORTED', 'This custody route supports only UTF-8 in the declared format.');
        const text = new TextDecoder('utf-8', { fatal: true }).decode(content);
        const page = profile.wireFormat === 'xml-v1' ? parseTallyXml(text, profile) : parseTallyNativeJson(text, profile);
        return { content, contentType: file.contentType, rowCount: page.records.length, continuation: page.continuation,
          schemaFingerprint: tallyXmlSchemaFingerprint(text, profile), source: { reportReference: null, generatedAtMs: null, snapshotId: null, completeness: 'unknown', totalRows: null } };
      } catch { throw new ReadTransportError('unsupported', null, 'settled', bytes); }
    },
  });
}
