// The CA console's modules are looked up before every other lane's, so they must claim only
// addresses that never exist in the desktop shell, plus their own sub-places.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Address } from '../src/app/presentation.ts';
import { railPlaces, resolveAddress } from '../src/app/places.ts';
import { FIRM_SCREENS, firmScreenFor } from '../src/screens/ca-enterprise/firm/routing.ts';
import { firmSubPlaces } from '../src/screens/ca-enterprise/firm/subplaces.ts';
import { firmWords } from '../src/screens/ca-enterprise/firm/words.ts';

const CLAIMED: ReadonlyArray<[Address, string]> = [
  [{ place: 'today' }, 'today'],
  [{ place: 'clients' }, 'clients'],
  [{ place: 'clients', sub: 'any' }, 'clients'],
  [{ place: 'clients', sheet: 'client_1' }, 'clients'],
  [{ place: 'work', sub: 'cosign' }, 'cosign'],
  [{ place: 'work', sub: 'many' }, 'many'],
  [{ place: 'work', sub: 'questions' }, 'questions'],
  [{ place: 'reports', sub: 'handover' }, 'handover'],
  [{ place: 'tools', sub: 'library' }, 'library'],
  [{ place: 'tools', sub: 'invite' }, 'invite'],
  [{ place: 'trust', sub: 'firmname' }, 'firmname'],
  [{ place: 'trust', sub: 'clientaccess' }, 'clientaccess'],
  [{ place: 'trust', sub: 'cafirm' }, 'cafirm'],
];

const NOT_CLAIMED: ReadonlyArray<Address> = [
  { place: 'trust', sub: 'people' }, { place: 'trust' }, { place: 'trust', sub: 'rules' }, { place: 'trust', sub: 'access' },
  { place: 'work' }, { place: 'work', sub: 'approvals' }, { place: 'work', sub: 'jobs' },
  { place: 'reports' }, { place: 'reports', sub: 'packs' }, { place: 'reports', sub: 'duedates' },
  { place: 'tools' }, { place: 'tools', sub: 'smallapps' }, { place: 'tools', sub: 'phone' },
  { place: 'today', sub: 'today' }, { place: 'today', sub: 'activity' },
  { place: 'books' }, { place: 'books', sub: 'sources' }, { place: 'books', sub: 'meanings' }, { place: 'books', sub: 'cosign' },
  { place: 'ask' }, { place: 'ask', sub: 'new' }, { place: 'company' }, { place: 'company', sub: 'signin' },
  { place: 'work', sub: 'constructor' }, { place: 'trust', sub: 'toString' }, { place: 'tools', sub: '__proto__' },
];

test('each firm screen claims exactly its own addresses', () => {
  for (const [address, screen] of CLAIMED) assert.equal(firmScreenFor(address), screen, JSON.stringify(address));
  assert.deepEqual([...new Set(CLAIMED.map(([, s]) => s))].sort(), [...FIRM_SCREENS].sort());
});

test('no desktop, enterprise or other lane address is claimed', () => {
  for (const address of NOT_CLAIMED) assert.equal(firmScreenFor(address), null, JSON.stringify(address));
});

test('every desktop and enterprise rail address but this lane’s own sub-place is left to the other lanes', () => {
  for (const shell of [{ kind: 'desktop', view: 'guided' }, { kind: 'enterprise', view: 'books', administers: true }] as const) {
    for (const place of railPlaces(shell)) {
      for (const sub of place.subs) {
        const screen = firmScreenFor({ place: place.id, sub: sub.id });
        if (place.id === 'trust' && sub.id === 'cafirm') assert.equal(screen, 'cafirm');
        else assert.equal(screen, null, `${shell.kind}: ${place.id}/${sub.id}`);
      }
    }
  }
});

test('the ca-firm rail lists the firm screens and this lane’s CA-08 sub-place; trust/people stays in the rail for its owner', () => {
  const rail = railPlaces({ kind: 'ca-firm', view: 'books' });
  const trust = rail.find((p) => p.id === 'trust')!.subs.map((s) => s.id);
  assert.deepEqual(trust, ['people', 'firmname', 'clientaccess']);
  assert.equal(firmScreenFor({ place: 'trust', sub: 'people' }), null);
  assert.equal(trust.includes('cafirm'), false);
  assert.deepEqual(resolveAddress({ kind: 'ca-firm', view: 'books' }, { place: 'trust', sub: 'clientaccess' }), { place: 'trust', sub: 'clientaccess' });
  assert.deepEqual(resolveAddress({ kind: 'desktop', view: 'guided' }, { place: 'trust', sub: 'cafirm' }), { place: 'trust', sub: 'cafirm' });
  assert.notDeepEqual(resolveAddress({ kind: 'desktop', view: 'guided' }, { place: 'trust', sub: 'clientaccess' }), { place: 'trust', sub: 'clientaccess' });
});

test('sub-places carry their names, and every word has Hindi', () => {
  for (const sub of firmSubPlaces) {
    const key = `SH-01.sub.${sub.place}.${sub.id}`;
    assert.ok(firmWords.en[key] && firmWords.hi[key], key);
  }
  assert.deepEqual(Object.keys(firmWords.hi).sort(), Object.keys(firmWords.en).sort());
  for (const [key, value] of Object.entries(firmWords.en)) {
    assert.ok(key.startsWith('CAX-') || key.startsWith('SH-01.sub.'), key);
    assert.doesNotMatch(value, /[—!]/u, `${key}: no em dash or exclamation mark`);
    assert.ok(firmWords.hi[key]!.trim().length > 0, key);
  }
});
