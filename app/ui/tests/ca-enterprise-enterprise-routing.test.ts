// ca-enterprise routing: the enterprise module is looked up before every other lane, so it must
// claim exactly the addresses the desktop shell never has, plus this lane's own sub-places.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Address } from '../src/app/presentation.ts';
import { railPlaces, resolveAddress } from '../src/app/places.ts';
import { COMPANY_SUBS, enterpriseRoute, handlesEnterprise } from '../src/screens/ca-enterprise/enterprise/routing.ts';
import { enterpriseSubPlaces } from '../src/screens/ca-enterprise/enterprise/subplaces.ts';
import { enterpriseWords } from '../src/screens/ca-enterprise/enterprise/words.ts';

const CLAIMED: Address[] = [
  { place: 'company' },
  ...COMPANY_SUBS.map((sub): Address => ({ place: 'company', sub })),
  { place: 'trust', sub: 'channels' },
  { place: 'trust', sub: 'reviews' },
  { place: 'trust', sub: 'teams' },
  { place: 'trust', sub: 'holds' },
  { place: 'trust', sub: 'edition' },
  { place: 'books', sub: 'companies' },
];

test('the module claims exactly the intended addresses, sheets included', () => {
  for (const a of CLAIMED) {
    assert.equal(handlesEnterprise(a), true, JSON.stringify(a));
    assert.equal(handlesEnterprise({ ...a, sheet: 'x1' }), true);
  }
  assert.equal(COMPANY_SUBS.length, 9);
  assert.deepEqual(enterpriseRoute({ place: 'company' }), { screen: 'company', sub: null });
  assert.deepEqual(enterpriseRoute({ place: 'company', sub: 'keys' }), { screen: 'company', sub: 'keys' });
  assert.deepEqual(enterpriseRoute({ place: 'books', sub: 'companies' }), { screen: 'companies' });
});

test('it never claims another lane’s address', () => {
  const never: Address[] = [
    { place: 'trust' }, { place: 'trust', sub: 'access' }, { place: 'trust', sub: 'markings' }, { place: 'trust', sub: 'retention' },
    { place: 'trust', sub: 'people' }, { place: 'trust', sub: 'rules' }, { place: 'trust', sub: 'vault' }, { place: 'trust', sub: 'constructor' },
    { place: 'books' }, { place: 'books', sub: 'sources' }, { place: 'books', sub: 'meanings' }, { place: 'books', sub: 'records' },
    { place: 'today' }, { place: 'today', sub: 'today' }, { place: 'today', sub: 'activity' },
    { place: 'company', sub: 'other' }, { place: 'clients' }, { place: 'more' }, { place: 'ask' },
  ];
  for (const sub of [undefined, 'approvals', 'jobs', 'actions', 'cando', 'cases', 'agents', 'cosign', 'many', 'questions']) never.push(sub === undefined ? { place: 'work' } : { place: 'work', sub });
  for (const sub of [undefined, 'packs', 'weekahead', 'briefs', 'duedates', 'exports', 'sent', 'handover']) never.push(sub === undefined ? { place: 'reports' } : { place: 'reports', sub });
  for (const a of never) assert.equal(handlesEnterprise(a), false, JSON.stringify(a));
});

test('lane sub-places: Reviews, Teams and Holds only in the enterprise shell; Edition on the desktop and in the enterprise shell', () => {
  const desktopTrust = railPlaces({ kind: 'desktop', view: 'guided' }).find((p) => p.id === 'trust')!.subs.map((s) => s.id);
  assert.ok(desktopTrust.includes('edition'));
  for (const id of ['reviews', 'teams', 'holds', 'channels', 'access']) assert.equal(desktopTrust.includes(id), false, id);
  const enterpriseTrust = railPlaces({ kind: 'enterprise', view: 'guided', administers: true }).find((p) => p.id === 'trust')!.subs.map((s) => s.id);
  for (const id of ['access', 'markings', 'retention', 'channels', 'reviews', 'teams', 'holds', 'edition']) assert.ok(enterpriseTrust.includes(id), id);
  for (const s of enterpriseSubPlaces) {
    const key = `SH-01.sub.${s.place}.${s.id}`;
    assert.ok(enterpriseWords.en[key] && enterpriseWords.hi[key], key);
  }
  // A role's grants gate the lane sub-places like any other.
  const gated = { kind: 'enterprise' as const, view: 'books' as const, administers: false, allowed: new Set(['trust.reviews']) };
  assert.deepEqual(resolveAddress(gated, { place: 'trust', sub: 'reviews' }), { place: 'trust', sub: 'reviews' });
  assert.deepEqual(resolveAddress(gated, { place: 'trust', sub: 'holds' }), { place: 'trust', sub: 'reviews' });
  assert.deepEqual(resolveAddress(gated, { place: 'company' }), { place: 'trust', sub: 'reviews' });
});

test('every enterprise word has Hindi, and every ENX key is used under its own prefix', () => {
  assert.deepEqual(Object.keys(enterpriseWords.hi).sort(), Object.keys(enterpriseWords.en).sort());
  for (const key of Object.keys(enterpriseWords.en)) assert.match(key, /^(ENX-|SH-01\.sub\.)/);
});
