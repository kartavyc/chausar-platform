import assert from 'node:assert/strict';
import test from 'node:test';
import { formatAddress, parseAddress, sameAddress, SEVEN_PLACES, withSheet, withoutSheet } from '../src/app/routes.ts';
import type { Address, PlaceId } from '../src/app/presentation.ts';

test('a fresh or empty address opens Today as the authoritative start place', () => {
  for (const hash of ['', '#', '#/', '/', '///']) {
    assert.deepEqual(parseAddress(hash), { place: 'today' }, hash);
  }
  assert.deepEqual(SEVEN_PLACES, ['today', 'ask', 'work', 'books', 'reports', 'tools', 'trust']);
});

test('valid place, sub-place and single-sheet addresses round-trip without losing identity', () => {
  const places: readonly PlaceId[] = [...SEVEN_PLACES, 'company', 'clients', 'more'];
  for (const place of places) {
    const variants: readonly Address[] = [
      { place },
      { place, sub: 'review' },
      { place, sub: 'review', sheet: 'approval-12' },
      { place, sheet: 'receipt-4' },
    ];
    for (const address of variants) {
      assert.deepEqual(parseAddress(formatAddress(address)), address);
      assert.equal(sameAddress(parseAddress(formatAddress(address)), address), true);
    }
  }
});

test('engine-issued opaque action and receipt sheet IDs round-trip without losing their underscores', () => {
  // platform/runtime/contracts.ts newId(prefix) emits prefix_<UUID>.
  const addresses: readonly Address[] = [
    { place: 'work', sub: 'approvals', sheet: 'action_7c13d496-35af-471c-a180-165679bdb6c0' },
    { place: 'today', sheet: 'receipt_96a9ae39-19f6-472f-a2ea-3b5061a6c1ef' },
    { place: 'books', sub: 'history', sheet: 'receipt_96a9ae39-19f6-472f-a2ea-3b5061a6c1ef' },
  ];
  for (const address of addresses) {
    const hash = formatAddress(address);
    assert.deepEqual(parseAddress(hash), address, `retain the exact engine reference in ${hash}`);
    assert.equal(sameAddress(parseAddress(hash), address), true);
  }
});

test('sheet identities match the checked bridge dot and 200-character boundary', () => {
  for (const sheet of ['receipt.v2_7c13d496-35af-471c-a180-165679bdb6c0', `A${'x'.repeat(199)}`]) {
    const address: Address = { place: 'work', sub: 'approvals', sheet };
    assert.deepEqual(parseAddress(formatAddress(address)), address);
  }
  for (const sheet of [`A${'x'.repeat(200)}`, '.receipt', 'receipt\n']) {
    assert.deepEqual(parseAddress(`#/work/approvals?sheet=${sheet}`), { place: 'work', sub: 'approvals' });
  }
});

test('extra or malformed path segments discard sheet context while preserving a safe list address', () => {
  const sheet = 'action_7c13d496-35af-471c-a180-165679bdb6c0';
  for (const path of ['/work/approvals/foreign', '/work/approvals/', '/work//approvals']) {
    assert.deepEqual(parseAddress(`#${path}?sheet=${sheet}`), { place: 'work', sub: 'approvals' }, path);
  }
  assert.deepEqual(parseAddress(`#/work/approval_list?sheet=${sheet}`), { place: 'work' });
});

test('duplicate or foreign queries cannot retain a sheet from an ambiguous route', () => {
  const sheet = 'action_7c13d496-35af-471c-a180-165679bdb6c0';
  for (const query of [
    `sheet=${sheet}&sheet=${sheet}`,
    `sheet=&sheet=${sheet}`,
    `sheet=${sheet}&sheet=receipt.other`,
    `sheet=${sheet}&other=value`,
    `other=value&sheet=${sheet}`,
    `sheet=${sheet}?sheet=receipt.other`,
    `sheet=${sheet}=other`,
  ]) {
    assert.deepEqual(parseAddress(`#/work/approvals?${query}`), { place: 'work', sub: 'approvals' }, query);
  }
});

test('opaque sheet identifiers do not relax the constrained sub-place slug grammar', () => {
  for (const sub of ['approval_list', 'Action', '%2Fapproval', 'a'.repeat(65)]) {
    assert.deepEqual(parseAddress(`#/work/${sub}`), { place: 'work' }, sub);
  }
  assert.deepEqual(parseAddress('#/work/approvals'), { place: 'work', sub: 'approvals' });
});

test('an unknown place returns a clean Today address instead of carrying foreign action context', () => {
  for (const hash of ['#/payment/send?sheet=money', '#/unknown/review?sheet=approval-12', '#/WORK/approvals?sheet=approval-12']) {
    assert.deepEqual(parseAddress(hash), { place: 'today' }, hash);
  }
});

test('query text cannot inject a path or unsafe sheet identity', () => {
  for (const value of ['../approve', 'a/b', '%2Fapprove', '<script>']) {
    assert.deepEqual(parseAddress(`#/work/approvals?sheet=${value}`), { place: 'work', sub: 'approvals' }, value);
  }
  assert.deepEqual(parseAddress('#/work/approvals?other=approval-12'), { place: 'work', sub: 'approvals' });
});

test('closing or replacing a sheet retains its owning list and does not mutate the loaded address', () => {
  const loaded: Address = Object.freeze({ place: 'work', sub: 'approvals', sheet: 'approval-12' });
  assert.deepEqual(withoutSheet(loaded), { place: 'work', sub: 'approvals' });
  assert.deepEqual(withSheet(loaded, 'receipt-4'), { place: 'work', sub: 'approvals', sheet: 'receipt-4' });
  assert.equal(loaded.sheet, 'approval-12');
  assert.equal(sameAddress(loaded, { place: 'work', sub: 'approvals', sheet: 'approval-13' }), false);
  assert.equal(sameAddress(loaded, { place: 'work', sub: 'jobs', sheet: 'approval-12' }), false);
  assert.equal(sameAddress(loaded, { place: 'books', sub: 'approvals', sheet: 'approval-12' }), false);
});
