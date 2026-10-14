/** A stateful TallyPrime company in memory, served over Tally's XML-over-HTTP interface: groups, ledgers, vouchers. */
import { readFileSync } from 'node:fs';
import { HttpFake, reply, type Route } from '../http-fake.ts';
import { kids, parseXml, val, xmlEscape as e, type XmlNode } from '../../runtime/writeback/systems/tally.ts';
import type { WireObject, WireRequest } from '../../runtime/writeback/types.ts';
import { rupees, toPaise } from '../../runtime/writeback/validate.ts';

type Rec = Record<string, any>;
export type TallyMaster = { name: string; parent: string; masterId: string };
export type TallyLine = { ledger: string; amountMinor: string; side: 'debit' | 'credit' };
export type TallyVoucher = { masterId: string; remoteId: string; voucherType: string; voucherNumber: string; date: string; party: string; narration: string; lines: TallyLine[] };
export type TallySeed = { company: string; groups: TallyMaster[]; ledgers: TallyMaster[]; vouchers: TallyVoucher[] };
export const tallySeed: TallySeed = JSON.parse(readFileSync(new URL('../../../fixtures/writeback/tally.json', import.meta.url), 'utf8'));

const xml = (body: string, status = 200) => reply(status, body, { 'content-type': 'text/xml; charset=utf-8' });
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export class TallyFake extends HttpFake {
  readonly system = 'tally' as const;
  readonly company: string;
  groups: TallyMaster[]; ledgers: TallyMaster[]; vouchers: TallyVoucher[];
  #next = 1000;
  constructor(seed: TallySeed = tallySeed) {
    super(); this.company = seed.company;
    this.groups = structuredClone(seed.groups); this.ledgers = structuredClone(seed.ledgers); this.vouchers = structuredClone(seed.vouchers);
  }
  /** Local Tally has no credentials; the company named in each request body is checked instead. */
  protected authorized(_request: WireRequest) { return true; }
  /** Tally serves every request on `/`; only the body says whether it imports. The base class logs a request before routing, so the route reads it from there. */
  protected routes(): Route[] {
    const writes = /<TALLYREQUEST>\s*Import\s*<\/TALLYREQUEST>/.test(this.log.at(-1)?.body ?? '');
    return [{ method: 'POST', path: /^\/$/, write: writes, handle: request => this.#serve(request) }];
  }
  #serve(request: WireRequest) {
    let doc: XmlNode; try { doc = parseXml(request.body ?? ''); } catch { return xml('<RESPONSE>Unknown Request, cannot be processed</RESPONSE>', 400); }
    const head = kids(doc, 'HEADER')[0], body = kids(doc, 'BODY')[0], desc = kids(body, 'DESC')[0], statics = kids(desc, 'STATICVARIABLES')[0];
    const verb = val(head, 'TALLYREQUEST'), company = val(statics, 'SVCURRENTCOMPANY');
    if (doc.name !== 'ENVELOPE' || val(head, 'VERSION') !== '1') return xml('<RESPONSE>Unknown Request, cannot be processed</RESPONSE>', 400);
    if (verb === 'Import') {
      if (company !== this.company) return this.#result(0, 0, ['Could not find the company'], '0', '0');
      return this.#import(kids(kids(body, 'DATA')[0], 'TALLYMESSAGE').flatMap(message => message.kids));
    }
    if (verb !== 'Export') return xml('<RESPONSE>Unknown Request, cannot be processed</RESPONSE>', 400);
    if (company !== this.company) return xml(`<ENVELOPE><HEADER><VERSION>1</VERSION><STATUS>0</STATUS></HEADER><BODY><DATA><LINEERROR>Could not set SVCurrentCompany to ${e(company)}</LINEERROR></DATA></BODY></ENVELOPE>`);
    const type = val(head, 'TYPE'), id = val(head, 'ID');
    const ok = (data: string) => xml(`<ENVELOPE><HEADER><VERSION>1</VERSION><STATUS>1</STATUS></HEADER><BODY><DESC></DESC><DATA>${data}</DATA></BODY></ENVELOPE>`);
    if (type === 'Data' && id === 'Day Book') {
      const from = val(statics, 'SVFROMDATE'), to = val(statics, 'SVTODATE');
      return ok(this.vouchers.filter(v => v.date.replaceAll('-', '') >= from && v.date.replaceAll('-', '') <= to).map(v => `<TALLYMESSAGE>${this.#voucherXml(v)}</TALLYMESSAGE>`).join(''));
    }
    if (type === 'Collection') {
      const kind = val(kids(kids(kids(desc, 'TDL')[0], 'TDLMESSAGE')[0], 'COLLECTION')[0], 'TYPE');
      const items = kind === 'Ledger' ? this.ledgers : kind === 'Group' ? this.groups : null;
      if (!items) return xml('<RESPONSE>Unknown Request, cannot be processed</RESPONSE>', 400);
      return ok(`<COLLECTION>${items.map(m => this.#masterXml(kind.toUpperCase(), m)).join('')}</COLLECTION>`);
    }
    if (type === 'Object' && val(head, 'SUBTYPE') === 'Ledger') return ok(this.ledgers.filter(l => same(l.name, id)).map(l => `<TALLYMESSAGE>${this.#masterXml('LEDGER', l)}</TALLYMESSAGE>`).join(''));
    return xml('<RESPONSE>Unknown Request, cannot be processed</RESPONSE>', 400);
  }
  #masterXml(tag: string, m: TallyMaster) { return `<${tag} NAME="${e(m.name)}"><PARENT TYPE="String">${e(m.parent)}</PARENT><MASTERID>${m.masterId}</MASTERID></${tag}>`; }
  #voucherXml(v: TallyVoucher) {
    const lines = v.lines.map(l => `<ALLLEDGERENTRIES.LIST><LEDGERNAME>${e(l.ledger)}</LEDGERNAME><ISDEEMEDPOSITIVE>${l.side === 'debit' ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE><AMOUNT>${l.side === 'debit' ? '-' : ''}${rupees(l.amountMinor)}</AMOUNT></ALLLEDGERENTRIES.LIST>`).join('');
    return `<VOUCHER REMOTEID="${e(v.remoteId)}" VCHTYPE="${e(v.voucherType)}" ACTION="Create"><DATE>${v.date.replaceAll('-', '')}</DATE><VOUCHERTYPENAME>${e(v.voucherType)}</VOUCHERTYPENAME><VOUCHERNUMBER>${e(v.voucherNumber)}</VOUCHERNUMBER><PARTYLEDGERNAME>${e(v.party)}</PARTYLEDGERNAME><NARRATION>${e(v.narration)}</NARRATION><MASTERID>${v.masterId}</MASTERID>${lines}</VOUCHER>`;
  }
  #result(created: number, altered: number, errors: string[], lastVch: string, lastMid: string) {
    return xml(`<RESPONSE><CREATED>${created}</CREATED><ALTERED>${altered}</ALTERED><DELETED>0</DELETED><LASTVCHID>${lastVch}</LASTVCHID><LASTMID>${lastMid}</LASTMID><COMBINED>0</COMBINED><IGNORED>0</IGNORED><ERRORS>${errors.length}</ERRORS><CANCELLED>0</CANCELLED>${errors.map(m => `<LINEERROR>${e(m)}</LINEERROR>`).join('')}</RESPONSE>`);
  }
  #import(objects: XmlNode[]) {
    const errors: string[] = []; let created = 0, altered = 0, lastVch = '0', lastMid = '0';
    for (const node of objects) {
      if (node.name === 'LEDGER') {
        const name = node.attrs.NAME ?? '', parent = val(node, 'PARENT');
        if (!name || !this.groups.some(g => g.name === parent)) { errors.push(`Group '${parent}' does not exist!`); continue; }
        if (this.ledgers.some(l => same(l.name, name))) { errors.push(`Ledger '${name}' already exists!`); continue; }
        const masterId = String(this.#next++); this.ledgers.push({ name, parent, masterId }); created++; lastMid = masterId;
      } else if (node.name === 'VOUCHER') {
        let lines: TallyLine[];
        try {
          lines = kids(node, 'ALLLEDGERENTRIES.LIST').map(entry => {
            const amount = toPaise(val(entry, 'AMOUNT')), debit = amount.startsWith('-');
            if (val(entry, 'ISDEEMEDPOSITIVE') !== (debit ? 'Yes' : 'No')) throw new Error('sign');
            return { ledger: val(entry, 'LEDGERNAME'), amountMinor: debit ? amount.slice(1) : amount, side: debit ? 'debit' : 'credit' } as TallyLine;
          });
        } catch { errors.push('Voucher amounts could not be read!'); continue; }
        const party = val(node, 'PARTYLEDGERNAME'), day = val(node, 'DATE'), remoteId = node.attrs.REMOTEID ?? '';
        const voucherType = val(node, 'VOUCHERTYPENAME') || (node.attrs.VCHTYPE ?? ''), voucherNumber = val(node, 'VOUCHERNUMBER');
        const unknown = [party, ...lines.map(l => l.ledger)].find(name => !this.ledgers.some(l => l.name === name));
        if (unknown !== undefined) { errors.push(`Ledger '${unknown}' does not exist!`); continue; }
        if (lines.length < 2 || lines.reduce((sum, l) => sum + (l.side === 'debit' ? -1n : 1n) * BigInt(l.amountMinor), 0n) !== 0n) { errors.push('Voucher totals do not match!'); continue; }
        if (!/^\d{8}$/.test(day)) { errors.push('Voucher date is missing!'); continue; }
        const record = { remoteId, voucherType, voucherNumber, date: `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6)}`, party, narration: val(node, 'NARRATION'), lines };
        const mine = remoteId ? this.vouchers.find(v => v.remoteId === remoteId) : undefined;
        if (this.vouchers.some(v => v !== mine && v.voucherType === voucherType && v.voucherNumber === voucherNumber)) { errors.push(`Voucher number '${voucherNumber}' already exists!`); continue; }
        if (mine) { Object.assign(mine, record); altered++; lastVch = mine.masterId; }
        else { const masterId = String(this.#next++); this.vouchers.push({ masterId, ...record }); created++; lastVch = masterId; }
      } else errors.push('Unknown object!');
    }
    return this.#result(created, altered, errors, lastVch, lastMid);
  }
  prime(payload: WireObject, _before: WireObject | null) {
    const p = payload as Rec, nextId = () => String(this.#next++);
    const group = (name: string) => { if (!this.groups.some(g => g.name === name)) this.groups.push({ name, parent: 'Primary', masterId: nextId() }); };
    if (typeof p.parent === 'string') group(p.parent);
    const names = [p.party, ...(Array.isArray(p.lines) ? p.lines.map((l: Rec) => l.ledger) : [])].filter((name): name is string => typeof name === 'string');
    for (const name of names) if (!this.ledgers.some(l => l.name === name)) { group('Sundry Debtors'); this.ledgers.push({ name, parent: 'Sundry Debtors', masterId: nextId() }); }
  }
  snapshot(): WireObject { return structuredClone({ company: this.company, groups: this.groups, ledgers: this.ledgers, vouchers: this.vouchers }) as WireObject; }
}
