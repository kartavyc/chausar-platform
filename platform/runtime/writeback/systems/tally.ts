/**
 * Tally write adapters: TallyPrime's XML interface over HTTP on this computer (port 9000 by default).
 * Local Tally has no credentials, so the host must be 127.0.0.1 or localhost and the connection's
 * company must be the one the payload names. Amounts go on the wire as rupee decimals converted
 * exactly from paise: a debit is a negative AMOUNT with ISDEEMEDPOSITIVE Yes, a credit a positive
 * AMOUNT with ISDEEMEDPOSITIVE No. Every text is escaped; replies are parsed by a small, bounded,
 * strict XML reader that refuses DTDs, processing instructions and unknown entities.
 */
import { check, ChausarError } from '../../contracts.ts';
import { WIRE_LIMITS, wire } from '../http.ts';
import { account } from '../reference.ts';
import type { ActionAdapter, AdapterContext, DoReceipt, Observation, Preparation, SystemAdapters, WireObject } from '../types.ts';
import { date, list, oneOf, optionalText, paise, record, rupees, str, text, toPaise } from '../validate.ts';

export type XmlNode = { name: string; attrs: Record<string, string>; kids: XmlNode[]; text: string };
const unreadable = () => new ChausarError('WRITE_REPLY_INVALID', 'Tally sent a reply Chausar cannot read.');
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
export const xmlEscape = (value: string) => value.replace(/[&<>"']/g, char => ESCAPES[char]);
function decode(raw: string): string {
  return raw.replace(/&(#x[\da-fA-F]{1,6}|#\d{1,7}|[a-z]{2,4});|&/g, (_match, entity?: string) => {
    if (!entity) throw unreadable();
    if (!entity.startsWith('#')) { if (!Object.hasOwn(ENTITIES, entity)) throw unreadable(); return ENTITIES[entity]; }
    const point = entity[1] === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
    if (point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff)) throw unreadable();
    return String.fromCodePoint(point);
  });
}
const TOKEN = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[A-Za-z_][\w.:-]*\s*=\s*(?:"[^"<]*"|'[^'<]*'))*)\s*(\/?)>|([^<]+)/y;
const ATTRIBUTE = /([A-Za-z_][\w.:-]*)\s*=\s*(?:"([^"<]*)"|'([^'<]*)')/g;
/** One element tree from a reply of at most the wire byte limit, 32 levels and 100 000 elements. */
export function parseXml(source: string): XmlNode {
  if (typeof source !== 'string' || Buffer.byteLength(source) > WIRE_LIMITS.maxBytes) throw unreadable();
  const input = source.replace(/^﻿/, '').replace(/^\s*<\?xml\s[^<>?]*\?>/, ''), token = new RegExp(TOKEN.source, 'y');
  const stack: XmlNode[] = []; let root: XmlNode | null = null, count = 0;
  while (token.lastIndex < input.length) {
    const m = token.exec(input); if (!m) throw unreadable();
    const top = stack.at(-1);
    if (m[6] !== undefined) { if (top) top.text += decode(m[6]); else if (m[6].trim()) throw unreadable(); continue; }
    if (m[1] !== undefined) { if (!top) throw unreadable(); top.text += m[1]; continue; }
    if (m[3] === undefined) continue;
    if (m[2]) { if (!top || top.name !== m[3] || m[4] || m[5]) throw unreadable(); stack.pop(); continue; }
    const node: XmlNode = { name: m[3], attrs: Object.create(null), kids: [], text: '' };
    for (const a of m[4].matchAll(ATTRIBUTE)) { if (a[1] in node.attrs) throw unreadable(); node.attrs[a[1]] = decode(a[2] ?? a[3]); }
    if (++count > 100_000 || stack.length >= 32) throw unreadable();
    if (top) top.kids.push(node); else if (root) throw unreadable(); else root = node;
    if (!m[5]) stack.push(node);
  }
  if (!root || stack.length) throw unreadable();
  return root;
}
export const kids = (node: XmlNode | undefined, name: string) => node ? node.kids.filter(kid => kid.name === name) : [];
function one(node: XmlNode | undefined, name: string): XmlNode | undefined { const found = kids(node, name); if (found.length > 1) throw unreadable(); return found[0]; }
/** A scalar child's trimmed text, '' when absent. */
export function val(node: XmlNode | undefined, name: string): string { const field = one(node, name); if (field?.kids.length) throw unreadable(); return (field?.text ?? '').trim(); }

function endpoint(ctx: AdapterContext, company: string): string {
  const host = account(ctx, 'host', /^[^\s/@]{1,253}$/), port = account(ctx, 'port', /^\d{1,5}$/);
  check(host === '127.0.0.1' || host === 'localhost', 'WRITE_ORIGIN_REFUSED', 'Tally is reached only on this computer.');
  check(Number(port) > 0 && Number(port) < 65536, 'WRITE_CONNECTION_INCOMPLETE', 'The connection is missing an account detail.');
  check(account(ctx, 'company', /^.{1,200}$/) === company, 'WRITE_CONNECTION_MISMATCH', 'The action names a different company from the connection.');
  return `http://${host}:${port}/`;
}
async function send(ctx: AdapterContext, company: string, xml: string): Promise<XmlNode> {
  const response = await ctx.http(wire('POST', endpoint(ctx, company), { accept: 'text/xml' }, xml, 'text/xml'));
  check(response.status === 200, 'WRITE_SYSTEM_REFUSED', 'Tally refused the request.');
  return parseXml(response.body);
}
const envelope = (request: 'Export' | 'Import', head: string, company: string, statics = '', tdl = '', data = '') =>
  `<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>${request}</TALLYREQUEST>${head}</HEADER><BODY><DESC><STATICVARIABLES>${request === 'Export' ? '<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>' : ''}<SVCURRENTCOMPANY>${xmlEscape(company)}</SVCURRENTCOMPANY>${statics}</STATICVARIABLES>${tdl}</DESC>${data}</BODY></ENVELOPE>`;
/** Objects named `tag` in an export reply, from TALLYMESSAGE or COLLECTION holders. */
function exported(doc: XmlNode, tag: string): XmlNode[] {
  if (doc.name !== 'ENVELOPE') throw unreadable();
  check(val(one(doc, 'HEADER'), 'STATUS') === '1', 'WRITE_SYSTEM_REFUSED', 'Tally refused the export. Check that the company is open in Tally.');
  const data = one(one(doc, 'BODY'), 'DATA'); if (!data) throw unreadable();
  return [...kids(data, 'TALLYMESSAGE'), ...kids(data, 'COLLECTION')].flatMap(holder => kids(holder, tag));
}
const master = (node: XmlNode) => ({ name: node.attrs.NAME ?? val(node, 'NAME'), parent: val(node, 'PARENT'), masterId: val(node, 'MASTERID') });
async function masters(ctx: AdapterContext, company: string, type: 'Ledger' | 'Group') {
  const doc = await send(ctx, company, envelope('Export', `<TYPE>Collection</TYPE><ID>Chausar ${type}s</ID>`, company, '',
    `<TDL><TDLMESSAGE><COLLECTION NAME="Chausar ${type}s" ISMODIFY="No"><TYPE>${type}</TYPE><FETCH>NAME,PARENT,MASTERID</FETCH></COLLECTION></TDLMESSAGE></TDL>`));
  return exported(doc, type.toUpperCase()).map(master);
}
/** Import result counts, from the RESPONSE reply or a version 1 envelope's IMPORTRESULT. */
function imported(doc: XmlNode, idField: 'LASTVCHID' | 'LASTMID'): DoReceipt {
  const result = doc.name === 'RESPONSE' ? doc : doc.name === 'ENVELOPE' ? one(one(one(doc, 'BODY'), 'DATA'), 'IMPORTRESULT') : undefined;
  if (!result) throw unreadable();
  const count = (name: string) => { const value = val(result, name) || '0'; if (!/^\d{1,9}$/.test(value)) throw unreadable(); return Number(value); };
  const errors = count('ERRORS') + kids(result, 'LINEERROR').length, created = count('CREATED'), altered = count('ALTERED');
  if (errors > 0 || created + altered === 0) return { outcome: 'rejected', externalId: null, data: { errors } };
  check(created === 1 && altered === 0, 'WRITE_REPLY_INVALID', 'Tally sent an import result Chausar cannot read.');
  const id = val(result, idField);
  return { outcome: 'provider-claims-applied', externalId: id && id !== '0' ? id : null, data: { created } };
}

type Line = { ledger: string; amountMinor: string; side: 'debit' | 'credit' };
type Voucher = { company: string; voucherType: string; voucherNumber: string; date: string; party: string; narration?: string; lines: Line[] };
const TYPES = ['Sales', 'Purchase', 'Receipt', 'Payment', 'Journal', 'Contra'] as const;
function voucherXml(p: Voucher, key: string): string {
  const e = xmlEscape;
  const entries = p.lines.map(l => `<ALLLEDGERENTRIES.LIST><LEDGERNAME>${e(l.ledger)}</LEDGERNAME><ISDEEMEDPOSITIVE>${l.side === 'debit' ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE>${l.ledger === p.party ? '<ISPARTYLEDGER>Yes</ISPARTYLEDGER>' : ''}<AMOUNT>${l.side === 'debit' ? '-' : ''}${rupees(l.amountMinor)}</AMOUNT></ALLLEDGERENTRIES.LIST>`).join('');
  return envelope('Import', '<TYPE>Data</TYPE><ID>Vouchers</ID>', p.company, '', '', `<DATA><TALLYMESSAGE><VOUCHER REMOTEID="${e(key)}" VCHTYPE="${e(p.voucherType)}" ACTION="Create"><DATE>${p.date.replaceAll('-', '')}</DATE><VOUCHERTYPENAME>${e(p.voucherType)}</VOUCHERTYPENAME><VOUCHERNUMBER>${e(p.voucherNumber)}</VOUCHERNUMBER><PARTYLEDGERNAME>${e(p.party)}</PARTYLEDGERNAME>${p.narration ? `<NARRATION>${e(p.narration)}</NARRATION>` : ''}${entries}</VOUCHER></TALLYMESSAGE></DATA>`);
}
/** Days either side of the voucher date that look-first and read-back search: a voucher entered under another date is still found. */
export const LOOK_WINDOW_DAYS = 31;
const shift = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00.000Z`) + days * 86400000).toISOString().slice(0, 10).replaceAll('-', '');
/** Day Book vouchers within a bounded window around the payload's date, with its type and number. Tally numbers vouchers per type. */
async function sameNumber(ctx: AdapterContext, p: Voucher): Promise<XmlNode[]> {
  const doc = await send(ctx, p.company, envelope('Export', '<TYPE>Data</TYPE><ID>Day Book</ID>', p.company, `<SVFROMDATE>${shift(p.date, -LOOK_WINDOW_DAYS)}</SVFROMDATE><SVTODATE>${shift(p.date, LOOK_WINDOW_DAYS)}</SVTODATE>`));
  return exported(doc, 'VOUCHER').filter(v => val(v, 'VOUCHERNUMBER') === p.voucherNumber && (val(v, 'VOUCHERTYPENAME') || v.attrs.VCHTYPE) === p.voucherType);
}
function observedVoucher(node: XmlNode): WireObject {
  const day = val(node, 'DATE'); if (!/^\d{8}$/.test(day)) throw unreadable();
  const lines = [...kids(node, 'ALLLEDGERENTRIES.LIST'), ...kids(node, 'LEDGERENTRIES.LIST')].map(entry => {
    const amount = toPaise(val(entry, 'AMOUNT')), debit = amount.startsWith('-');
    if (amount !== '0' && val(entry, 'ISDEEMEDPOSITIVE') !== (debit ? 'Yes' : 'No')) throw unreadable();
    return { ledger: val(entry, 'LEDGERNAME'), amountMinor: debit ? amount.slice(1) : amount, side: debit ? 'debit' : 'credit' };
  });
  return { voucherNumber: val(node, 'VOUCHERNUMBER'), voucherType: val(node, 'VOUCHERTYPENAME') || str(node.attrs.VCHTYPE), date: `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6)}`, party: val(node, 'PARTYLEDGERNAME'), lines };
}

const voucherCreate: ActionAdapter<any> = {
  validate(payload) {
    const p = record(payload, ['company', 'voucherType', 'voucherNumber', 'date', 'party', 'lines'], ['narration']);
    const lines = list(p.lines, 50, item => { const l = record(item, ['ledger', 'amountMinor', 'side']); return { ledger: text(l.ledger, 200), amountMinor: paise(l.amountMinor), side: oneOf(l.side, ['debit', 'credit'] as const) }; });
    check(lines.length >= 2, 'INVALID_WRITE_PAYLOAD', 'A voucher needs at least two lines.');
    const total = (side: string) => lines.filter(l => l.side === side).reduce((sum, l) => sum + BigInt(l.amountMinor), 0n);
    check(total('debit') === total('credit'), 'INVALID_VOUCHER_UNBALANCED', 'The debit and credit lines do not balance.');
    return { company: text(p.company, 200), voucherType: oneOf(p.voucherType, TYPES), voucherNumber: text(p.voucherNumber, 50), date: date(p.date), party: text(p.party, 200), ...(p.narration === undefined ? {} : { narration: optionalText(p.narration, 2000)! }), lines } as Voucher;
  },
  async prepare(ctx, p: Voucher, key) {
    const same = await sameNumber(ctx, p);
    check(same.every(v => v.attrs.REMOTEID === key), 'WRITE_PRECONDITION_FAILED', 'Another voucher of this type already has this number.');
    if (!same.length) {
      const ledgers = new Set((await masters(ctx, p.company, 'Ledger')).map(l => l.name));
      check([p.party, ...p.lines.map(l => l.ledger)].every(name => ledgers.has(name)), 'WRITE_PRECONDITION_FAILED', 'A ledger named in the voucher is not in this Tally company.');
    }
    const fields = { voucherNumber: p.voucherNumber, voucherType: p.voucherType, date: p.date, party: p.party, lines: p.lines };
    return { before: null, command: { company: p.company, ...fields, ...(p.narration ? { narration: p.narration } : {}), remoteId: key, xml: voucherXml(p, key) }, postconditions: fields,
      preview: { fields: [{ name: 'Voucher', before: '', after: `${p.voucherType} ${p.voucherNumber}` }, { name: 'Date', before: '', after: p.date }, { name: 'Party', before: '', after: p.party },
        ...(p.narration ? [{ name: 'Narration', before: '', after: p.narration }] : []), ...p.lines.map((l, index) => ({ name: `Line ${index + 1}`, before: '', after: `${l.side === 'debit' ? 'Dr' : 'Cr'} ${l.ledger} ₹${rupees(l.amountMinor)}` }))] },
      target: { label: `${p.voucherType} voucher ${p.voucherNumber}`, ref: p.voucherNumber }, sourceVersion: null, alreadyApplied: same.length ? { externalId: val(same[0], 'MASTERID') || null } : null };
  },
  async do(ctx, p: Voucher, preparation) { return imported(await send(ctx, p.company, str(preparation.command.xml)), 'LASTVCHID'); },
  async readBack(ctx, p: Voucher, _preparation, key): Promise<Observation> {
    const same = await sameNumber(ctx, p);
    if (same.length > 1) return { outcome: 'conflicting', reason: 'More than one voucher of this type has this number.' };
    if (!same.length) return { outcome: 'inconclusive', reason: 'No voucher with this number is in the Day Book yet.' };
    if (same[0].attrs.REMOTEID !== key) return { outcome: 'conflicting', reason: 'The voucher with this number was not entered by this action.' };
    return { outcome: 'confirmed-applied', observed: observedVoucher(same[0]), externalId: val(same[0], 'MASTERID') || null, businessSuccess: true };
  },
};

type LedgerNew = { company: string; name: string; parent: string };
/** The ledger master by name. Tally compares names without case, so a differently cased match is reported too. */
async function ledgerNamed(ctx: AdapterContext, p: LedgerNew) {
  const doc = await send(ctx, p.company, envelope('Export', `<TYPE>Object</TYPE><SUBTYPE>Ledger</SUBTYPE><ID TYPE="Name">${xmlEscape(p.name)}</ID>`, p.company, '<SVEXPORTINPLAINFORMAT>No</SVEXPORTINPLAINFORMAT>'));
  return exported(doc, 'LEDGER').map(master);
}
const ledgerCreate: ActionAdapter<any> = {
  validate(payload) {
    const p = record(payload, ['company', 'name', 'parent']);
    return { company: text(p.company, 200), name: text(p.name, 200), parent: text(p.parent, 200) } as LedgerNew;
  },
  async prepare(ctx, p: LedgerNew): Promise<Preparation> {
    check((await masters(ctx, p.company, 'Group')).some(g => g.name === p.parent), 'WRITE_PRECONDITION_FAILED', 'The parent group is not in this Tally company.');
    const found = await ledgerNamed(ctx, p);
    check(found.length <= 1 && found.every(l => l.name === p.name && l.parent === p.parent), 'WRITE_PRECONDITION_FAILED', 'A ledger with this name already exists in another form or group.');
    const e = xmlEscape, xml = envelope('Import', '<TYPE>Data</TYPE><ID>All Masters</ID>', p.company, '', '', `<DATA><TALLYMESSAGE><LEDGER NAME="${e(p.name)}" ACTION="Create"><NAME.LIST><NAME>${e(p.name)}</NAME></NAME.LIST><PARENT>${e(p.parent)}</PARENT></LEDGER></TALLYMESSAGE></DATA>`);
    return { before: null, command: { company: p.company, name: p.name, parent: p.parent, xml }, postconditions: { name: p.name, parent: p.parent },
      preview: { fields: [{ name: 'Ledger', before: '', after: p.name }, { name: 'Group', before: '', after: p.parent }] },
      target: { label: `Ledger ${p.name}`, ref: p.name }, sourceVersion: null, alreadyApplied: found.length ? { externalId: found[0].masterId || null } : null };
  },
  async do(ctx, p: LedgerNew, preparation) { return imported(await send(ctx, p.company, str(preparation.command.xml)), 'LASTMID'); },
  async readBack(ctx, p: LedgerNew): Promise<Observation> {
    const found = (await ledgerNamed(ctx, p)).filter(l => l.name === p.name);
    if (found.length > 1) return { outcome: 'conflicting', reason: 'More than one ledger has this name.' };
    if (!found.length) return { outcome: 'inconclusive', reason: 'No ledger has this name yet.' };
    return { outcome: 'confirmed-applied', observed: { name: found[0].name, parent: found[0].parent }, externalId: found[0].masterId || null, businessSuccess: true };
  },
};

export const tallyAdapters: SystemAdapters = Object.freeze({ 'voucher.create': voucherCreate, 'ledger.create': ledgerCreate });
