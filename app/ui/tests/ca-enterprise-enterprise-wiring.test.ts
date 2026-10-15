// ca-enterprise host wiring: `caent.shell`, `castatus.inside` and lens replies are checked before
// the host uses them; anything off-contract leaves the desktop defaults. Synthetic data only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DESKTOP_FACTS, insideBanner, validateInside, validateLens, validateShellFacts } from '../src/screens/ca-enterprise/host-wiring.ts';
import { enterpriseWords } from '../src/screens/ca-enterprise/enterprise/words.ts';

const GOOD = { kind: 'enterprise', administers: true, allowed: ['today.today', 'trust.reviews', 'trust.reviews'], views: ['guided', 'books'], home: { place: 'company', sub: 'health' } };

test('a good caent.shell reply is kept, with duplicate grants folded', () => {
  assert.deepEqual(validateShellFacts(GOOD), {
    kind: 'enterprise', administers: true, allowed: ['today.today', 'trust.reviews'], views: ['guided', 'books'], home: { place: 'company', sub: 'health' },
  });
  assert.deepEqual(validateShellFacts({ kind: 'desktop', administers: false, allowed: null, views: null, home: null }), DESKTOP_FACTS);
  assert.deepEqual(validateShellFacts({ ...GOOD, home: { place: 'today' } })?.home, { place: 'today' });
  assert.equal(validateShellFacts({ ...GOOD, kind: 'ca-firm' })?.kind, 'ca-firm');
});

test('every off-contract caent.shell reply is refused (the host then keeps the desktop defaults)', () => {
  const bad: unknown[] = [
    null, undefined, 'enterprise', [], {},
    { ...GOOD, kind: 'browser' },
    { ...GOOD, kind: undefined },
    { ...GOOD, administers: 'yes' },
    { ...GOOD, allowed: 'all' },
    { ...GOOD, allowed: ['Trust.Access'] },
    { ...GOOD, allowed: [42] },
    { ...GOOD, allowed: undefined },
    { ...GOOD, views: ['guided', 'wide'] },
    { ...GOOD, views: [] },
    { ...GOOD, views: ['books', 'books'] },
    { ...GOOD, home: 'company' },
    { ...GOOD, home: { place: 'nowhere' } },
    { ...GOOD, home: { place: 'company', sub: '../x' } },
    { ...GOOD, home: { place: 'company', sub: 7 } },
  ];
  for (const reply of bad) assert.equal(validateShellFacts(reply), null, JSON.stringify(reply));
});

test('the lens reply is checked', () => {
  assert.deepEqual(validateLens({ lens: 'finance', lenses: ['whole-group', 'finance'] }), { lens: 'finance', lenses: ['whole-group', 'finance'] });
  assert.equal(validateLens({ lens: 'marketing', lenses: [] }), null);
  assert.equal(validateLens({ lens: 'finance', lenses: ['nope'] }), null);
  assert.equal(validateLens(null), null);
});

test('castatus.inside: outside gives no banner; inside gives the CA-03 sentence through the read-only kind', () => {
  assert.deepEqual(validateInside({ inside: false }), { inside: false });
  assert.equal(insideBanner(validateInside({ inside: false }), 'en'), null);
  assert.equal(insideBanner(null, 'en'), null);
  const inside = validateInside({ inside: true, firmName: 'Mehta & Co', workspaceName: 'Shop A', seat: 'ca', endsOn: '2026-12-31', can: ['read', 'export'] });
  assert.ok(inside !== null && inside.inside);
  const banner = insideBanner(inside, 'en');
  assert.equal(banner?.kind, 'read-only');
  assert.equal(banner?.textKey, 'ENX-ca03.banner');
  assert.equal(banner?.action, undefined);
  assert.deepEqual(banner?.values, { workspace: 'Shop A', firm: 'Mehta & Co', hasFirm: 'yes', seat: 'ca', dated: 'yes', date: '31 Dec 2026' });
  assert.ok(enterpriseWords.en['ENX-ca03.banner'] && enterpriseWords.hi['ENX-ca03.banner']);
  const open = insideBanner(validateInside({ inside: true, firmName: null, workspaceName: 'Shop A', seat: 'accountant', endsOn: null, can: ['prepare'] }), 'hi');
  assert.deepEqual(open?.values, { workspace: 'Shop A', firm: '', hasFirm: 'no', seat: 'accountant', dated: 'no', date: '' });
});

test('off-contract castatus.inside replies are refused', () => {
  const base = { inside: true, firmName: 'F', workspaceName: 'W', seat: 'ca', endsOn: '2026-12-31', can: ['read'] };
  for (const reply of [null, {}, { inside: 'yes' }, { ...base, seat: 'owner' }, { ...base, workspaceName: '' }, { ...base, endsOn: '31-12-2026' },
    { ...base, can: ['approve'] }, { ...base, firmName: 3 }]) {
    assert.equal(validateInside(reply), null, JSON.stringify(reply));
  }
});
