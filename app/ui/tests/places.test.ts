import assert from 'node:assert/strict';
import test from 'node:test';
import { keyPlaces, morePlaces, placeAllowed, railCountShown, railEntry, railPlaces, resolveAddress, subAllowed } from '../src/app/places.ts';
import type { ShellConfig } from '../src/app/places.ts';
import { formatAddress, parseAddress, SEVEN_PLACES } from '../src/app/routes.ts';
import type { Address } from '../src/app/presentation.ts';

test('Guided and Books keep all seven places in authoritative order', () => {
  for (const view of ['guided', 'books'] as const) {
    const config: ShellConfig = { kind: 'desktop', view };
    assert.deepEqual(railPlaces(config).map(place => place.id), SEVEN_PLACES);
    assert.deepEqual(keyPlaces(config), SEVEN_PLACES);
    assert.equal(placeAllowed(config, 'company'), false);
    assert.equal(placeAllowed(config, 'clients'), false);
  }
});

test('Simple keeps four rail entries and all other places reachable through More and keyboard', () => {
  const config: ShellConfig = { kind: 'desktop', view: 'simple' };
  assert.deepEqual(railPlaces(config).map(place => place.id), ['today', 'ask', 'work', 'more']);
  assert.deepEqual(morePlaces().map(place => place.id), ['books', 'reports', 'tools', 'trust']);
  assert.deepEqual(keyPlaces(config), SEVEN_PLACES);
  for (const id of SEVEN_PLACES) assert.equal(placeAllowed(config, id), true, id);
  assert.equal(placeAllowed(config, 'more'), true);
  assert.equal(placeAllowed({ kind: 'desktop', view: 'guided' }, 'more'), false);
});

test('Company appears only for an enterprise installation administrator', () => {
  const ordinary: ShellConfig = { kind: 'enterprise', view: 'guided', administers: false };
  const admin: ShellConfig = { ...ordinary, administers: true };
  assert.deepEqual(railPlaces(ordinary).map(place => place.id), SEVEN_PLACES);
  assert.deepEqual(railPlaces(admin).map(place => place.id), [...SEVEN_PLACES, 'company']);
  assert.equal(placeAllowed(ordinary, 'company'), false);
  assert.equal(placeAllowed(admin, 'company'), true);
  assert.equal(placeAllowed(admin, 'clients'), false);
});

test('enterprise role filtering does not expose a sub-place outside its supplied grant list', () => {
  const config: ShellConfig = { kind: 'enterprise', view: 'guided', allowed: new Set(['work.approvals', 'books.records']) };
  const offered = railPlaces(config).flatMap(place => place.subs.map(sub => `${place.id}.${sub.id}`));
  assert.deepEqual(offered, ['work.approvals', 'books.records']);
});

test('the CA firm rail stays at client-status scope and does not offer firm-level Ask or Books', () => {
  const config: ShellConfig = { kind: 'ca-firm', view: 'guided' };
  const firmPlaces = ['today', 'clients', 'work', 'reports', 'tools', 'trust'];
  assert.deepEqual(railPlaces(config).map(place => place.id), firmPlaces);
  assert.deepEqual(keyPlaces(config), firmPlaces);
  assert.equal(placeAllowed(config, 'ask'), false);
  assert.equal(placeAllowed(config, 'books'), false);
  assert.equal(placeAllowed(config, 'company'), false);
  assert.equal(placeAllowed(config, 'more'), false);
  assert.equal(placeAllowed(config, 'clients'), true);
});

test('a Jobs-only role repairs denied Approvals and bare Work to the explicit highlighted Jobs address', () => {
  const config: ShellConfig = { kind: 'enterprise', view: 'guided', allowed: new Set(['work.jobs']) };
  const work = railPlaces(config).find(place => place.id === 'work');
  assert.ok(work);
  assert.deepEqual(work.subs.map(sub => sub.id), ['jobs']);
  const denied: Address = Object.freeze({ place: 'work', sub: 'approvals', sheet: 'action_7c13d496-35af-471c-a180-165679bdb6c0' });
  assert.deepEqual(resolveAddress(config, denied), { place: 'work', sub: 'jobs' });
  assert.deepEqual(resolveAddress(config, { place: 'work' }), { place: 'work', sub: 'jobs' });
  assert.equal(denied.sub, 'approvals');
  assert.equal(denied.sheet, 'action_7c13d496-35af-471c-a180-165679bdb6c0');
});

test('a permitted role address retains its exact opaque sheet while a denied place cannot leak its sheet', () => {
  const config: ShellConfig = { kind: 'enterprise', view: 'guided', allowed: new Set(['work.jobs']) };
  const permitted: Address = { place: 'work', sub: 'jobs', sheet: 'job_7c13d496-35af-471c-a180-165679bdb6c0' };
  assert.deepEqual(resolveAddress(config, permitted), permitted);
  assert.deepEqual(resolveAddress(config, { place: 'trust', sub: 'people', sheet: 'member_96a9ae39-19f6-472f-a2ea-3b5061a6c1ef' }), { place: 'work', sub: 'jobs' });
});

test('an empty enterprise grant list offers no private rail or keyboard destination', () => {
  const config: ShellConfig = { kind: 'enterprise', view: 'guided', allowed: new Set() };
  assert.equal(placeAllowed(config, 'today'), false);
  assert.deepEqual(railPlaces(config), []);
  assert.deepEqual(keyPlaces(config).filter(place => placeAllowed(config, place)), []);
});

test('an empty enterprise grant list resolves incoming addresses to explicit no-access', () => {
  const config: ShellConfig = { kind: 'enterprise', view: 'guided', allowed: new Set() };
  for (const address of [{ place: 'today' }, { place: 'work', sub: 'jobs' }] as const) {
    // A null route or a separately discriminated no-access state is acceptable.
    // Neither may resolve to a normal private place under an empty grant list.
    const result: unknown = resolveAddress(config, address);
    assert.ok(result === null || (typeof result === 'object' && result !== null && 'kind' in result && result.kind === 'no-access'));
  }
});

test('unknown grant names cannot invent an authorized private place or sub-place', () => {
  const config: ShellConfig = { kind: 'enterprise', view: 'guided', administers: true, allowed: new Set(['today.private', 'work.unknown', 'company.unknown']) };
  assert.deepEqual(railPlaces(config), []);
  assert.equal(placeAllowed(config, 'today'), false);
  assert.equal(placeAllowed(config, 'work'), false);
  assert.equal(placeAllowed(config, 'company'), false);
  assert.equal(resolveAddress(config, { place: 'work', sub: 'unknown', sheet: 'action_7c13d496-35af-471c-a180-165679bdb6c0' }), null);
});

test('an Activity-only Today grant chooses the displayed Activity sub-place and drops repaired sheet context', () => {
  const config: ShellConfig = { kind: 'enterprise', view: 'guided', allowed: new Set(['today.activity', 'work.jobs']) };
  assert.deepEqual(railPlaces(config).find(place => place.id === 'today')?.subs.map(sub => sub.id), ['activity']);
  const expected = { place: 'today', sub: 'activity' };
  assert.deepEqual(resolveAddress(config, { place: 'today' }), expected);
  assert.deepEqual(resolveAddress(config, { place: 'today', sheet: 'receipt_96a9ae39-19f6-472f-a2ea-3b5061a6c1ef' }), expected);
  assert.deepEqual(resolveAddress(config, { place: 'today', sub: 'today', sheet: 'receipt_96a9ae39-19f6-472f-a2ea-3b5061a6c1ef' }), expected);
  assert.deepEqual(resolveAddress(config, { place: 'books', sub: 'accounts', sheet: 'receipt_96a9ae39-19f6-472f-a2ea-3b5061a6c1ef' }), expected);
});

test('the CA address guard drops firm-level Ask and Books and their prior sheet context', () => {
  const config: ShellConfig = { kind: 'ca-firm', view: 'guided' };
  for (const place of ['ask', 'books'] as const) {
    assert.deepEqual(resolveAddress(config, { place, sub: 'saved', sheet: 'receipt_96a9ae39-19f6-472f-a2ea-3b5061a6c1ef' }), { place: 'today' });
  }
});

test('each shell rejects unauthored sub-place context before showing a retained sheet', () => {
  const sheet = 'action_7c13d496-35af-471c-a180-165679bdb6c0';
  const ca: ShellConfig = { kind: 'ca-firm', view: 'guided' };
  assert.equal(subAllowed(ca, 'work', 'approvals'), false);
  assert.equal(subAllowed(ca, 'work', 'cosign'), true);
  assert.deepEqual(resolveAddress(ca, { place: 'work', sub: 'approvals', sheet }), { place: 'work' });
  assert.deepEqual(resolveAddress(ca, { place: 'work', sub: 'cosign', sheet }), { place: 'work', sub: 'cosign', sheet });
  assert.deepEqual(resolveAddress(ca, { place: 'clients', sub: 'unknown', sheet }), { place: 'clients' });
  assert.deepEqual(resolveAddress(ca, { place: 'clients' }), { place: 'clients' });
  assert.deepEqual(resolveAddress(ca, { place: 'today' }), { place: 'today' });
  for (const config of [{ kind: 'desktop', view: 'guided' }, { kind: 'enterprise', view: 'guided' }] satisfies readonly ShellConfig[]) {
    assert.deepEqual(resolveAddress(config, { place: 'work', sub: 'unknown', sheet }), { place: 'work' });
  }
  assert.deepEqual(resolveAddress({ kind: 'desktop', view: 'simple' }, { place: 'books', sub: 'unknown', sheet }), { place: 'books' });
});

test('a role without Today access cannot expose its retained Today rail count', () => {
  const jobsOnly: ShellConfig = { kind: 'enterprise', view: 'guided', allowed: new Set(['work.jobs']) };
  assert.equal(railCountShown(jobsOnly, 'today'), false);
  assert.equal(railCountShown(jobsOnly, 'work'), false);
  assert.equal(railCountShown({ ...jobsOnly, allowed: new Set(['today.today']) }, 'today'), true);
  assert.equal(railCountShown({ kind: 'ca-firm', view: 'guided' }, 'clients'), true);
  assert.equal(railCountShown({ kind: 'desktop', view: 'simple' }, 'today'), true);
  assert.equal(railCountShown({ kind: 'desktop', view: 'guided' }, 'clients'), false);
});

test('Simple More remains the active rail entry while the actual Books address and receipt stay intact', () => {
  const config: ShellConfig = { kind: 'desktop', view: 'simple' };
  const address: Address = { place: 'books', sub: 'accounts', sheet: 'receipt_96a9ae39-19f6-472f-a2ea-3b5061a6c1ef' };
  const more = railPlaces(config).find(place => place.id === 'more');
  assert.ok(more);
  assert.equal(more.nameKey, 'SH-01.place.more');
  assert.equal(railEntry(config, address.place), 'more');
  assert.equal(railEntry({ kind: 'desktop', view: 'guided' }, address.place), 'books');
  const resolved = resolveAddress(config, address);
  assert.ok(resolved);
  assert.deepEqual(resolved, address);
  assert.deepEqual(parseAddress(formatAddress(resolved)), address);
});
