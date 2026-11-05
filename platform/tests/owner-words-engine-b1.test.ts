// B1 fix round 1 (quality findings 3 and 4): the words the engine itself puts on a screen (Team's role lines, the needs
// list, the alert titles, the Keeper's lines, the arrange refusal) use none of the developer words the app keeps off
// screens. One list for all of it: platform/runtime/owner-flag.ts DEVELOPER_WORDS, which the app's error edge and the
// catalogue test use too.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEVELOPER_WORDS, bannedIn } from '../runtime/owner-flag.ts';
import { KEEPER_ROLE, KEEPER_WORDS } from '../runtime/venture/views/keeper.ts';
import { KIND_WORDS, endedTitle } from '../runtime/venture/notify/centre.ts';
import { CARD_LABELS, RAIL_NAMES, businessNeeds } from '../runtime/venture/core/needs-data.ts';
import { applyChange, defaultLayout } from '../runtime/venture/views/layout-core.ts';

const FAMILIES = ['money-tax', 'teaching', 'creative', 'writing', 'local-services', 'documents', 'research', 'people', 'shop-office', 'tech', 'licensed'] as const;
const strings = (value: unknown): string[] => (typeof value === 'string' ? [value] : value && typeof value === 'object' ? Object.values(value).flatMap(strings) : []);
const banned = bannedIn;

test('B1 fix round 1: engine-made screen words carry no developer word', () => {
  const lines = [
    KEEPER_ROLE, ...strings(KEEPER_WORDS), ...strings(KIND_WORDS), ...Object.keys(KIND_WORDS).map(kind => endedTitle(kind as keyof typeof KIND_WORDS)),
    ...strings(CARD_LABELS), ...strings(RAIL_NAMES),
    ...[null, ...FAMILIES].flatMap(family => ['IN', 'US', null].flatMap(country => strings(businessNeeds(family, country)))),
  ];
  assert.ok(lines.length > 50);
  const found = lines.flatMap(line => banned(line).map(word => `${word}: ${line}`));
  assert.deepEqual(found, []);
});

test('B1 fix round 1: the Keeper says what it does in plain words, and an unknown arrange step does too', () => {
  assert.equal(KEEPER_ROLE, 'Keeps Chausar running by fixed rules, not AI: backups, delivery checks, connection checks, rule and rate dates, posting steps and network strength.');
  assert.throws(() => applyChange('today', defaultLayout('today'), { op: 'undo' } as never, 'owner'), (error: Error) => {
    assert.equal(error.message, 'Use Undo or Keep on the page for that.');
    return banned(error.message).length === 0;
  });
});

// B1 fix round 2 (quality finding 1): one helper finds the developer words, for the error edge and every scan.
test('B1 fix round 2: bannedIn names each developer word a line uses, whole words only, plurals too', () => {
  assert.deepEqual(bannedIn('Unable to unlock vault. Check your credential or restore a valid backup.'), ['vault', 'credential']);
  assert.deepEqual(bannedIn('The Engines and the VAULTS, and the vault again.'), ['engine', 'vault']);
  assert.deepEqual(bannedIn('Not tried live yet. A fixture-tested call.'), ['fixture']);
  assert.deepEqual(bannedIn('Vaultkeeper digested the engineer\'s notes.'), []);
  assert.deepEqual(bannedIn('Plain words for the owner.'), []);
  for (const word of DEVELOPER_WORDS) assert.deepEqual(bannedIn(`a ${word} here`), [word], word);
});
