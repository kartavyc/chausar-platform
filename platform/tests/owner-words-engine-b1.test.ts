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
import { PEOPLE_WORDS } from '../runtime/venture/people/people-data.ts';

const FAMILIES = ['money-tax', 'teaching', 'creative', 'writing', 'local-services', 'documents', 'research', 'people', 'shop-office', 'tech', 'licensed'] as const;
const strings = (value: unknown): string[] => (typeof value === 'string' ? [value] : value && typeof value === 'object' ? Object.values(value).flatMap(strings) : []);
const banned = bannedIn;

test('B1 fix round 1: engine-made screen words carry no developer word', () => {
  const lines = [
    KEEPER_ROLE, ...strings(KEEPER_WORDS), ...strings(KIND_WORDS), ...Object.keys(KIND_WORDS).map(kind => endedTitle(kind as keyof typeof KIND_WORDS)),
    ...strings(CARD_LABELS), ...strings(RAIL_NAMES),
    // B1 fix round 2: people search's lines ("Not tried live yet, needs your key").
    ...strings(PEOPLE_WORDS),
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

// B1 fix round 2 (quality finding 5): a refusal that quotes another's words (a CSV that would not read, a pack's server
// reference) quotes only words the owner may read; anything else is left out of the line.
test('B1 fix round 2: quotable keeps owner words and plain sentences, and drops the rest', async () => {
  const { quotable } = await import('../runtime/owner-flag.ts');
  const { ChausarError, InternalError } = await import('../runtime/contracts.ts');
  assert.equal(quotable(new ChausarError('INVALID_VENTURE_REQUEST', 'Use a web address starting with https (or http on this computer), with no password and nothing after ? or #. Add a password in its own box.')), 'Use a web address starting with https (or http on this computer), with no password and nothing after ? or #. Add a password in its own box.');
  assert.equal(quotable(new Error('A quoted cell was cut short.')), 'A quoted cell was cut short.');
  for (const inner of [new InternalError('UNSAFE_PATH', 'Choose an explicit non-root absolute directory.'), new ChausarError('REENTRANT_TRANSACTION', 'Nested vault operations are not supported.'),
    new Error('The engine stopped.'), Object.assign(new Error("ENOENT: no such file, open 'C:\\x\\y.csv'"), { code: 'ENOENT' }), new Error('Unexpected token < in JSON at position 0\n    at JSON.parse'), 'a string', null]) {
    assert.equal(quotable(inner), null, String((inner as Error)?.message ?? inner));
  }
  const { readFile } = await import('node:fs/promises');
  for (const file of ['venture/delivery/harness/files.ts', 'venture/packs/pack-format.ts']) {
    assert.doesNotMatch(await readFile(new URL(`../runtime/${file}`, import.meta.url), 'utf8'), /\$\{\(error as Error\)\.message\}/, file);
  }
});
