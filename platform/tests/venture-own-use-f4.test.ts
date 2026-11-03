// W6 founder follow-up F4 (2 November 2026): a desk the owner runs for themselves. Its Start tile shows what it saves
// the owner (hours a month, a model estimate, and what it keeps straight in words), never a "clients pay" range. The
// kit marks such a desk with ownUse, and definePlaybook holds the marker and the tile together for every desk.
import test from 'node:test';
import assert from 'node:assert/strict';
import { definePlaybook, type PlaybookDefinition, type StartTile } from '../runtime/venture/playbooks/kit/define.ts';
import { kitWay } from '../runtime/venture/playbooks/kit/tile.ts';
import { kitDefinitions } from '../runtime/venture/playbooks/kit/installed.ts';
import { listWays } from '../runtime/venture/core/ways.ts';
import { WAY_SAVES_SOURCE } from '../runtime/venture/playbooks/ways.ts';
import { TRADING_JOURNAL_DATA } from '../runtime/venture/playbooks/trading-journal/definition-data.ts';
import { kitFixture } from './fixtures/venture/kit-fixture.ts';

function refused(definition: PlaybookDefinition, field: string, words: RegExp) {
  assert.throws(() => definePlaybook(definition), (error: any) => {
    assert.equal(error?.code, 'PLAYBOOK_DEFINITION_INVALID', error?.message);
    assert.match(error.message, new RegExp(`^The kit-fixture work plan's ${field}: `), error.message);
    assert.match(error.message, words);
    return true;
  });
}

/** The fixture as an own-use desk: every offer internal, no pilot, the tile saying what it saves. */
function ownUse(overrides: Partial<PlaybookDefinition> = {}): PlaybookDefinition {
  const base = kitFixture();
  const { pay: _pay, ...tile } = base.startTile;
  return kitFixture({
    ownUse: true,
    offers: base.offers.map(offer => ({ ...offer, audience: 'internal' as const, pilotable: false })),
    startTile: { ...tile, saves: { hoursMin: 2, hoursMax: 5, line: 'Your posts and records kept in one place.' } },
    ...overrides,
  });
}

test('F4: an own-use desk passes with what it saves and no price range', () => {
  const definition = definePlaybook(ownUse());
  assert.equal(definition.ownUse, true);
  assert.equal(definition.startTile.pay, undefined);
  assert.deepEqual(definition.startTile.saves, { hoursMin: 2, hoursMax: 5, line: 'Your posts and records kept in one place.' });
});

test('F4: the kit holds the own-use marker and the tile together', () => {
  const base = ownUse();
  const tile = (change: Partial<StartTile>) => ({ ...base.startTile, ...change });
  // An own-use desk shows no clients pay range and must say what it saves.
  refused(ownUse({ startTile: tile({ pay: { minRupees: 500, maxRupees: 3000, per: 'a trader a month' } }) }), 'startTile', /own use.*no price range/i);
  const { saves: _saves, ...noSaves } = base.startTile;
  refused(ownUse({ startTile: noSaves }), 'startTile', /what it saves/);
  refused(ownUse({ startTile: tile({ saves: { hoursMin: 6, hoursMax: 2, line: 'Kept straight.' } }) }), 'startTile', /fewest first/);
  refused(ownUse({ startTile: tile({ saves: { hoursMin: 0, hoursMax: 2, line: 'Kept straight.' } }) }), 'startTile', /whole hours/);
  refused(ownUse({ startTile: tile({ saves: { hoursMin: 1, hoursMax: 2, line: ' ' } }) }), 'startTile', /what it keeps straight/);
  // An own-use desk has no clients: no client or public offer, and no paid pilot.
  refused(ownUse({ offers: kitFixture().offers }), 'offers', /own use/);
  refused(ownUse({ offers: ownUse().offers.map(offer => ({ ...offer, pilotable: true })) }), 'offers', /pilot/);
  // A desk whose every offer is internal must carry the marker, so no own-use desk shows a clients pay range by accident.
  const internalOnly = kitFixture({ offers: kitFixture().offers.map(offer => ({ ...offer, audience: 'internal' as const })) });
  refused(internalOnly, 'ownUse', /every offer is for your own use/);
  // A client desk never says what it saves instead of what clients pay.
  refused(kitFixture({ startTile: { ...kitFixture().startTile, saves: { hoursMin: 1, hoursMax: 2, line: 'Kept straight.' } } }), 'startTile', /clients pay/);
  const { pay: _pay, ...noPay } = kitFixture().startTile;
  refused(kitFixture({ startTile: noPay }), 'startTile', /clients pay/);
  refused(kitFixture({ ownUse: 'yes' as never }), 'ownUse', /true or left out/);
});

test('F4: the trading journal is marked own use and its tile says what it saves', () => {
  assert.equal(TRADING_JOURNAL_DATA.ownUse, true);
  assert.equal(TRADING_JOURNAL_DATA.startTile.pay, undefined);
  assert.ok(TRADING_JOURNAL_DATA.startTile.saves);
  assert.ok(TRADING_JOURNAL_DATA.offers.every(offer => offer.audience === 'internal' && !offer.pilotable));
  // Every landed desk: own use exactly when every offer is internal, and then a saves tile.
  for (const definition of kitDefinitions()) {
    const internal = definition.offers.every(offer => offer.audience === 'internal');
    assert.equal(definition.ownUse === true, internal, definition.registration.id);
    assert.equal(definition.startTile.saves !== undefined, internal, definition.registration.id);
    assert.equal(definition.startTile.pay !== undefined, !internal, definition.registration.id);
  }
});

test('F4: the gallery shows an own-use desk with what it saves, as a model estimate, and no clients pay', () => {
  const way = kitWay(definePlaybook(ownUse()));
  assert.equal(way.pay, undefined);
  assert.deepEqual(way.saves, { min: 2, max: 5, line: 'Your posts and records kept in one place.' });
  const view = listWays({});
  const journal = view.ways.find(item => item.playbook === 'trading-journal')!;
  assert.equal(journal.clientsPay, undefined);
  const saves = TRADING_JOURNAL_DATA.startTile.saves!;
  assert.deepEqual(journal.saves, { text: `${saves.hoursMin} to ${saves.hoursMax} h a month`, line: saves.line, estimate: true, source: WAY_SAVES_SOURCE.en });
  assert.match(WAY_SAVES_SOURCE.en, /^Model estimate/);
  assert.doesNotMatch(JSON.stringify(journal), /₹/);
  for (const other of view.ways.filter(item => item.playbook !== 'trading-journal')) {
    assert.equal(other.saves, undefined, other.id);
    assert.ok(other.clientsPay, other.id);
  }
});
