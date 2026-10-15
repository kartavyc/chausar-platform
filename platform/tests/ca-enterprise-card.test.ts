import test from 'node:test';
import assert from 'node:assert/strict';
import { canonical, linkDigest, LINK_CODE, macCard, macMatches, newLinkCode, parseCard, sealCard, type StatusCard, type UnsealedCard } from '../runtime/ca-enterprise/card.ts';

// Synthetic values only.
const code = 'ABCDEFGHJKMNPQ23';
function body(): UnsealedCard {
  return {
    v: 1, kind: 'chausar.ca-status', workspaceId: 'workspace_synthetic-1', link: linkDigest(code), issuedAt: '2026-10-15T06:00:00.000Z', month: '2026-09',
    booksReadAt: '2026-10-14T10:00:00.000Z', close: { bank: 'done', gst: 'in-progress', tds: 'not-done', tb: 'refused' },
    cosign: { meanings: 2, recipes: null, accountClasses: 0 }, questions: { count: 1, oldestAt: '2026-10-01T00:00:00.000Z' },
    handover: { tb: 'not-ready', bankRec: 'not-ready', gstMatch: 'ready', tdsMatch: 'not-ready', ageing: 'refused' },
    dueNext: { code: 'gstr1-monthly', date: '2026-11-11' }, seats: [{ seat: 'accountant', endsOn: null }, { seat: 'ca', endsOn: '2027-03-31' }], consent: 'v-test',
  };
}
const card = (): StatusCard => sealCard(code, body());
const invalid = (e: any) => { assert.equal(e.code, 'CA_CARD_INVALID', e.message); return true; };
/** A copy of the sealed card with one change applied at a path. */
function changed(change: (c: any) => void): unknown { const c: any = structuredClone(card()); change(c); return c; }

test('a sealed card parses back to itself and its MAC is the HMAC of the canonical body', () => {
  const sealed = card();
  assert.deepEqual(parseCard(JSON.parse(JSON.stringify(sealed))), sealed);
  assert.match(sealed.mac, /^[0-9a-f]{64}$/);
  assert.equal(macMatches(code, sealed), true);
  assert.equal(macMatches('ZZZZZZZZZZZZZZZZ', sealed), false);
  const shuffled = Object.fromEntries(Object.entries(body()).reverse()) as UnsealedCard;
  assert.equal(macCard(code, shuffled), sealed.mac, 'key order does not change the MAC');
  assert.equal(canonical({ b: [1, { d: 1, c: 2 }], a: null }), '{"a":null,"b":[1,{"c":2,"d":1}]}');
  assert.equal(parseCard(changed(c => { c.dueNext = null; c.booksReadAt = null; c.seats = []; c.questions = { count: null, oldestAt: null }; })).dueNext, null);
});

test('every change to a field breaks the MAC', () => {
  for (const change of [(c: any) => { c.close.bank = 'not-done'; }, (c: any) => { c.cosign.meanings = 3; }, (c: any) => { c.issuedAt = '2026-10-15T06:00:00.001Z'; }, (c: any) => { c.seats.pop(); }]) {
    assert.equal(macMatches(code, parseCard(changed(change))), false);
  }
});

test('the validator refuses extra keys, missing keys, bad enums, free text, bad numbers and oversize cards', () => {
  const refusals: [string, (c: any) => void][] = [
    ['extra top-level key', c => { c.note = 'Paid by Asha Traders'; }],
    ['extra nested key', c => { c.close.amount = 'done'; }],
    ['extra seat key', c => { c.seats[0].name = 'Ravi'; }],
    ['extra due key', c => { c.dueNext.what = 'GSTR-1'; }],
    ['missing key', c => { delete c.handover; }],
    ['missing nested key', c => { delete c.cosign.recipes; }],
    ['bad close enum', c => { c.close.gst = 'filed'; }],
    ['bad ready enum', c => { c.handover.ageing = 'yes'; }],
    ['bad seat', c => { c.seats[0].seat = 'owner'; }],
    ['free text in the workspace id', c => { c.workspaceId = 'Sales of 12,34,567 to Asha Traders'; }],
    ['free text in consent', c => { c.consent = 'I agree to share everything'; }],
    ['free text in a due code', c => { c.dueNext.code = 'Pay ₹45,000 GST'; }],
    ['a figure where a count goes', c => { c.cosign.meanings = '1234567'; }],
    ['a fractional count', c => { c.questions.count = 1.5; }],
    ['a negative count', c => { c.cosign.accountClasses = -1; }],
    ['a count above the bound', c => { c.cosign.recipes = 1_000_001; }],
    ['bad month', c => { c.month = '2026-13'; }],
    ['bad date', c => { c.dueNext.date = '2026-02-30'; }],
    ['bad time', c => { c.issuedAt = '15 October 2026'; }],
    ['bad link', c => { c.link = 'not-a-digest'; }],
    ['bad mac', c => { c.mac = 'abc'; }],
    ['wrong version', c => { c.v = 2; }],
    ['wrong kind', c => { c.kind = 'chausar.books'; }],
    ['too many seats', c => { c.seats = Array.from({ length: 21 }, () => ({ seat: 'ca', endsOn: null })); }],
    ['seats not a list', c => { c.seats = { seat: 'ca' }; }],
  ];
  for (const [name, change] of refusals) assert.throws(() => parseCard(changed(change)), invalid, name);
  assert.throws(() => parseCard(null), invalid);
  assert.throws(() => parseCard([card()]), invalid);
  assert.throws(() => parseCard('{"v":1}'), invalid);
  assert.throws(() => parseCard(changed(c => { c.workspaceId = 'x'.repeat(80); c.seats = Array.from({ length: 20 }, () => ({ seat: 'accountant', endsOn: '2027-01-01' })); c.extra = 'y'.repeat(4000); })), (e: any) => e.code === 'CA_CARD_INVALID' && /too large/.test(e.message));
  const cyclic: any = changed(() => {}); cyclic.close.self = cyclic;
  assert.throws(() => parseCard(cyclic), invalid);
  assert.throws(() => parseCard(Object.assign(Object.create({ inherited: true }), card())), invalid);
});

test('link codes are 16 base32 letters from a random source and the link is their digest', () => {
  const codes = new Set(Array.from({ length: 200 }, newLinkCode));
  assert.equal(codes.size, 200);
  for (const item of codes) assert.match(item, LINK_CODE);
  assert.match(linkDigest(code), /^[0-9a-f]{64}$/);
  assert.notEqual(linkDigest(code), linkDigest('ABCDEFGHJKMNPQ24'));
});
