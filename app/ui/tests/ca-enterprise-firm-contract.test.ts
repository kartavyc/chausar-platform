// The CA console's reply validators (docs/lanes/ca-enterprise.md, Round 4 contracts):
// good shapes are read; extra keys, missing keys, bad enums and bad counts are refused.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  normaliseLinkCode, parseObject, validateAssigned, validateBatch, validateBatches, validateCaStatus, validateClientCode, validateClientsList,
  validateConsent, validateCosign, validateFirmSet, validateFirmStatus, validateFirmToday, validateHandover, validateImported, validateKinds,
  validateLibrary, validateLibraryAdded, validateLibraryExport, validateLibraryRemoved, validateLinked, validateOpened, validatePeople,
  validateQuestions, validateStatusCard, validateUnlinked,
} from '../src/screens/ca-enterprise/firm/contract.ts';

const AT = '2026-10-14T09:00:00Z';
const HEX = 'a'.repeat(64);
const CLOSE = { bank: 'done', gst: 'in-progress', tds: 'not-done', tb: 'refused' };
const HANDOVER = { tb: 'ready', bankRec: 'not-ready', gstMatch: 'refused', tdsMatch: 'ready', ageing: 'ready' };
const ROW = {
  clientId: 'client_1', name: 'Demo shop', state: 'joined', booksReadAt: AT, close: CLOSE, awaiting: null,
  dueNext: { code: 'gstr3b-monthly', date: '2026-10-20' }, cardAt: AT, stale: false, seat: { seat: 'ca', endsOn: '2026-12-31' },
};
const LIST = { month: '2026-09', rows: [ROW], counts: { needsYou: 1, closeNotDone: 1, all: 3 }, nextCursor: 'c2' };
export const CARD = {
  v: 1, kind: 'chausar.ca-status', workspaceId: 'ws_demo-1', link: HEX, issuedAt: AT, month: '2026-09', booksReadAt: null, close: CLOSE,
  cosign: { meanings: 2, recipes: null, accountClasses: 0 }, questions: { count: 1, oldestAt: AT }, handover: HANDOVER,
  dueNext: null, seats: [{ seat: 'accountant', endsOn: null }], consent: 'draft-1', mac: 'b'.repeat(64),
};
const BATCH = {
  batchId: 'batch_1', kind: 'gst-guide', month: '2026-09', at: AT, state: 'held',
  rows: [{ clientId: 'c1', name: 'A', result: 'held', code: 'CA_RELAY_NOT_DEPLOYED' }, { clientId: 'c2', name: 'B', result: 'not-joined' }],
};

const without = (o: Record<string, unknown>, key: string) => Object.fromEntries(Object.entries(o).filter(([k]) => k !== key));

test('clients.list: a good page is read; "not known" stays null, never 0', () => {
  const v = validateClientsList(LIST);
  assert.equal(v.rows[0]!.awaiting, null);
  assert.equal(v.rows[0]!.close?.gst, 'in-progress');
  assert.equal(v.nextCursor, 'c2');
  assert.deepEqual(validateClientsList({ ...LIST, rows: [{ ...ROW, state: 'invited', booksReadAt: null, close: null, dueNext: null, cardAt: null, seat: null }] }).rows[0]!.state, 'invited');
});

test('clients.list: extra, missing and bad fields are refused', () => {
  assert.throws(() => validateClientsList({ ...LIST, extra: 1 }), { code: 'INVALID_REPLY' });
  assert.throws(() => validateClientsList(without(LIST, 'counts')), { code: 'INVALID_REPLY' });
  assert.throws(() => validateClientsList({ ...LIST, rows: [{ ...ROW, amount: '1200' }] }), { code: 'INVALID_REPLY' });
  assert.throws(() => validateClientsList({ ...LIST, rows: [{ ...ROW, state: 'left' }] }));
  assert.throws(() => validateClientsList({ ...LIST, rows: [{ ...ROW, close: { ...CLOSE, gst: 'loading' } }] }));
  assert.throws(() => validateClientsList({ ...LIST, rows: [{ ...ROW, awaiting: -1 }] }));
  assert.throws(() => validateClientsList({ ...LIST, rows: [{ ...ROW, awaiting: 1.5 }] }));
  assert.throws(() => validateClientsList({ ...LIST, rows: [{ ...ROW, awaiting: '3' }] }));
  assert.throws(() => validateClientsList({ ...LIST, rows: [{ ...ROW, dueNext: { code: 'GSTR 3B', date: '2026-10-20' } }] }));
  assert.throws(() => validateClientsList({ ...LIST, rows: [{ ...ROW, dueNext: { code: 'gstr1', date: '2026-02-30' } }] }));
  assert.throws(() => validateClientsList({ ...LIST, month: '2026-13' }));
  assert.throws(() => validateClientsList({ ...LIST, rows: [{ ...ROW, seat: { seat: 'owner', endsOn: null } }] }));
  assert.throws(() => validateClientsList(null));
  assert.throws(() => validateClientsList([LIST]));
});

test('the status card has exactly its keys; a figure or free text cannot ride along', () => {
  const card = validateStatusCard(CARD);
  assert.equal(card.cosign.recipes, null);
  assert.equal(card.seats[0]!.seat, 'accountant');
  assert.throws(() => validateStatusCard({ ...CARD, note: 'hello' }));
  assert.throws(() => validateStatusCard(without(CARD, 'mac')));
  assert.throws(() => validateStatusCard({ ...CARD, v: 2 }));
  assert.throws(() => validateStatusCard({ ...CARD, kind: 'other' }));
  assert.throws(() => validateStatusCard({ ...CARD, link: 'XYZ' }));
  assert.throws(() => validateStatusCard({ ...CARD, cosign: { ...CARD.cosign, amount: 5 } }));
  assert.throws(() => validateStatusCard({ ...CARD, handover: { ...HANDOVER, ageing: 'done' } }));
  assert.throws(() => validateStatusCard({ ...CARD, seats: Array.from({ length: 21 }, () => ({ seat: 'ca', endsOn: null })) }));
  assert.throws(() => validateStatusCard({ ...CARD, workspaceId: '../x' }));
});

test('castatus replies', () => {
  const s = validateCaStatus({ link: null, consent: null, wording: { version: 'draft-1', approved: false, text: 'Draft words.' }, lastCardAt: null });
  assert.equal(s.wording.approved, false);
  assert.equal(validateCaStatus({ link: { firmName: 'Demo and Co', linkedAt: AT }, consent: { version: 'v1', at: AT }, wording: { version: 'v1', approved: true, text: null }, lastCardAt: AT }).link?.firmName, 'Demo and Co');
  assert.throws(() => validateCaStatus({ link: null, consent: null, wording: { version: 'v1', approved: 'yes', text: null }, lastCardAt: null }));
  assert.throws(() => validateCaStatus({ link: null, consent: null, wording: { version: 'v1', approved: true, text: null } }));
  assert.equal(validateLinked({ firmName: 'F', linkedAt: AT }).firmName, 'F');
  assert.throws(() => validateLinked({ firmName: '', linkedAt: AT }));
  assert.deepEqual(validateUnlinked({ unlinked: true }), { unlinked: true });
  assert.throws(() => validateUnlinked({ unlinked: false }));
  assert.equal(validateConsent({ consent: null }).consent, null);
  assert.throws(() => validateConsent({ consent: { version: 'v1' } }));
});

test('firm status, setup and name', () => {
  assert.equal(validateFirmStatus({ firm: null }).firm, null);
  const firm = { name: 'Demo and Co', reportName: null, pricing: 'planned' };
  assert.equal(validateFirmStatus({ firm }).firm?.pricing, 'planned');
  assert.throws(() => validateFirmStatus({ firm: { ...firm, pricing: 'paid' } }));
  assert.equal(validateFirmSet({ firm }).firm.name, 'Demo and Co');
  assert.throws(() => validateFirmSet({ firm: null }));
});

test('codes, guides, imports and opening', () => {
  const shown = validateClientCode({ clientId: 'client_1', code: 'ABCDEFGHIJKLMNO2', guide: { html: '<p>Guide</p>' } });
  assert.equal(shown.code, 'ABCDEFGHIJKLMNO2');
  assert.throws(() => validateClientCode({ clientId: 'client_1', code: 'abc', guide: { html: 'x' } }));
  assert.throws(() => validateClientCode({ clientId: 'client_1', code: 'ABCDEFGHIJKLMNO2', guide: { html: 'x', script: 'y' } }));
  assert.equal(validateImported({ clientId: 'c1', cardAt: AT }).clientId, 'c1');
  assert.throws(() => validateImported({ clientId: 'c1', cardAt: 'yesterday' }));
  assert.equal(validateOpened({ clientId: 'c1', workspaceId: 'ws1', seat: { seat: 'ca', endsOn: '2026-12-31' } }).seat.endsOn, '2026-12-31');
  assert.throws(() => validateOpened({ clientId: 'c1', workspaceId: 'ws1', seat: { seat: 'ca' } }));
});

test('firm.today, cosign, questions and handover', () => {
  const today = validateFirmToday({
    month: '2026-09', awaiting: [{ clientId: 'c1', name: 'A', cosign: 2, questions: null, total: null }],
    due: [{ clientId: 'c1', name: 'A', code: 'tds-deposit', date: '2026-10-07' }], totals: { clients: 3, awaiting: 2 },
  });
  assert.equal(today.awaiting[0]!.questions, null);
  assert.throws(() => validateFirmToday({ month: '2026-09', awaiting: [], due: [], totals: { clients: 3 } }));
  assert.throws(() => validateFirmToday({ month: '2026-09', awaiting: [{ clientId: 'c1', name: 'A', cosign: 2, questions: 0, total: 2, amount: '100' }], due: [], totals: { clients: 1, awaiting: 2 } }));
  assert.equal(validateCosign({ rows: [{ clientId: 'c1', name: 'A', meanings: 1, recipes: null, accountClasses: 0 }] }).rows.length, 1);
  assert.throws(() => validateCosign({ rows: [{ clientId: 'c1', name: 'A', meanings: 1, recipes: null }] }));
  assert.equal(validateQuestions({ rows: [{ clientId: 'c1', name: 'A', count: null, oldestAt: null }] }).rows[0]!.count, null);
  assert.equal(validateHandover({ month: '2026-09', rows: [{ clientId: 'c1', name: 'A', handover: null }, { clientId: 'c2', name: 'B', handover: HANDOVER }] }).rows.length, 2);
  assert.throws(() => validateHandover({ month: '2026-09', rows: [{ clientId: 'c1', name: 'A', handover: { ...HANDOVER, extra: 'ready' } }] }));
});

test('many: kinds and batches', () => {
  assert.equal(validateKinds({ kinds: [{ id: 'gst-guide', needsMonth: true }] }).kinds[0]!.needsMonth, true);
  assert.throws(() => validateKinds({ kinds: [{ id: 'send-money', needsMonth: false }] }));
  const b = validateBatch(BATCH);
  assert.equal(b.rows[0]!.code, 'CA_RELAY_NOT_DEPLOYED');
  assert.equal('code' in b.rows[1]!, false);
  assert.throws(() => validateBatch({ ...BATCH, state: 'done' }));
  assert.throws(() => validateBatch({ ...BATCH, rows: [{ clientId: 'c1', name: 'A', result: 'failed' }] }));
  assert.throws(() => validateBatch({ ...BATCH, rows: [{ clientId: 'c1', name: 'A', result: 'held', code: 'relay down' }] }));
  assert.equal(validateBatches({ batches: [BATCH] }).batches.length, 1);
  assert.throws(() => validateBatches({ batches: Array.from({ length: 51 }, () => BATCH) }));
});

test('library and people', () => {
  const item = { id: 'lib_1', kind: 'recipe', title: 'GST match', addedAt: AT };
  assert.equal(validateLibrary({ items: [item] }).items[0]!.kind, 'recipe');
  assert.throws(() => validateLibrary({ items: [{ ...item, kind: 'macro' }] }));
  assert.throws(() => validateLibrary({ items: [{ ...item, body: {} }] }));
  assert.equal(validateLibraryAdded({ item }).item.id, 'lib_1');
  assert.equal(validateLibraryRemoved({ id: 'lib_1', removed: true }).removed, true);
  assert.equal(validateLibraryExport({ file: { name: 'gst-match.json', json: '{}' } }).file.name, 'gst-match.json');
  assert.throws(() => validateLibraryExport({ file: { name: '../x.sh', json: '{}' } }));
  const people = validatePeople({ people: [{ memberId: 'm1', name: 'Asha', role: 'owner', clients: '*' }, { memberId: 'm2', name: 'Kiran', role: 'staff', clients: ['c1'] }] });
  assert.deepEqual(people.people[1]!.clients, ['c1']);
  assert.throws(() => validatePeople({ people: [{ memberId: 'm1', name: 'Asha', role: 'owner', clients: 'all' }] }));
  assert.throws(() => validatePeople({ people: [{ memberId: 'm1', name: 'Asha', role: 'owner', clients: ['c1', 'c1'] }] }));
  assert.deepEqual(validateAssigned({ memberId: 'm2', clients: [] }).clients, []);
});

test('local checks: a pasted card is one object; a link code is 16 letters A-Z and digits 2-7', () => {
  assert.deepEqual(parseObject('{"v":1}'), { v: 1 });
  assert.equal(parseObject('[1]'), null);
  assert.equal(parseObject('null'), null);
  assert.equal(parseObject('not json'), null);
  assert.equal(normaliseLinkCode('abcd efgh-ijkl mno2'), 'ABCDEFGHIJKLMNO2');
  assert.equal(normaliseLinkCode('ABCDEFGHIJKLMNO1'), null);
  assert.equal(normaliseLinkCode('ABC'), null);
});
