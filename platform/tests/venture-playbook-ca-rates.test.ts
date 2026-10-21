// P3-ca-firm: the rate tables are versioned data with validity windows, citations and section references, each
// flagged for the CA's confirmation; the money helpers round only by a named rule.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OPEN_QUESTIONS, RATE_TABLES, RENUMBERING_QUESTION, rateTableFor, rateTableHash, useRateTable, validateRateTables,
  type RateConfirmation,
} from '../runtime/venture/playbooks/ca-firm/rates.ts';
import { applyBps, divRound, floorToMultiple, monthsOrPart, round288 } from '../runtime/venture/playbooks/ca-firm/money.ts';

const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected, error?.message); return true; };

test('rate tables: every version has a window, citations, section references and the CA flag', () => {
  validateRateTables(RATE_TABLES);
  assert.ok(RATE_TABLES.length >= 5);
  for (const table of RATE_TABLES) {
    assert.match(table.id, /^in-[a-z0-9-]+$/);
    assert.ok(Number.isInteger(table.version) && table.version >= 1, table.id);
    assert.match(table.validFrom, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(table.validTo === null || table.validTo > table.validFrom, table.id);
    assert.ok(table.citations.length >= 1, table.id);
    for (const citation of table.citations) {
      assert.ok(citation.source.length > 3, table.id);
      // Nobody has checked the source yet: that is the CA's job, and the table says so.
      assert.equal(citation.checkedOn, null, table.id);
    }
    assert.equal(table.needsCaConfirmation, true, table.id);
    for (const section of table.sections) {
      assert.equal(section.needsCaConfirmation, true, `${table.id} ${section.section}`);
      assert.ok(section.act.length > 0);
    }
    assert.match(rateTableHash(table), /^[a-f0-9]{64}$/);
  }
  // The renumbering question stays open and visible on every income-tax table.
  assert.ok(OPEN_QUESTIONS.includes(RENUMBERING_QUESTION));
  assert.match(RENUMBERING_QUESTION, /Income-tax Act, 2025/);
  for (const table of RATE_TABLES.filter(item => item.kind !== 'gst-rates')) assert.ok(table.openQuestions.includes(RENUMBERING_QUESTION), table.id);
});

test('rate tables: a new rate is a new version with its own window, never an edit', () => {
  const gst = RATE_TABLES.filter(table => table.id === 'in-gst-rates');
  assert.deepEqual(gst.map(table => [table.version, table.validFrom, table.validTo]), [[1, '2024-08-01', '2025-09-22'], [2, '2025-09-22', null]]);
  assert.equal(rateTableFor('gst-rates', '2025-09-21').version, 1);
  assert.equal(rateTableFor('gst-rates', '2025-09-22').version, 2);
  assert.ok((rateTableFor('gst-rates', '2025-09-21').payload as { ratesBps: string[] }).ratesBps.includes('1200'));
  assert.ok(!(rateTableFor('gst-rates', '2025-09-22').payload as { ratesBps: string[] }).ratesBps.includes('1200'));
  assert.ok((rateTableFor('gst-rates', '2025-09-22').payload as { ratesBps: string[] }).ratesBps.includes('4000'));
  assert.throws(() => rateTableFor('gst-rates', '2024-07-31'), code('RATE_TABLE_MISSING'));
  assert.throws(() => rateTableFor('income-tax', '2026-04-01'), code('RATE_TABLE_MISSING'));
  // Two versions of one table must not overlap.
  const overlapping = [...RATE_TABLES, { ...gst[1], version: 3, validFrom: '2025-10-01' }];
  assert.throws(() => validateRateTables(overlapping), /overlap/);
});

test('rate tables: a real client needs the CA to confirm this exact version; rehearsal runs unconfirmed and says so', () => {
  const table = rateTableFor('income-tax', '2025-04-01');
  const rehearsal = useRateTable(table, { mode: 'rehearsal', confirmations: [] });
  assert.deepEqual([rehearsal.id, rehearsal.version, rehearsal.confirmed, rehearsal.needsCaConfirmation], [table.id, 1, false, true]);
  assert.throws(() => useRateTable(table, { mode: 'client', confirmations: [] }), code('RATE_UNCONFIRMED'));
  const confirmation: RateConfirmation = { tableId: table.id, version: 1, hash: rateTableHash(table), caName: 'CA Asha Rao', membershipNumber: '123456', at: '2026-10-20T09:00:00.000Z' };
  const stamped = useRateTable(table, { mode: 'client', confirmations: [confirmation] });
  assert.equal(stamped.confirmed, true);
  assert.equal(stamped.confirmedBy, 'CA Asha Rao (ICAI 123456)');
  // A confirmation of other content (a changed table under the same version) does not count.
  assert.throws(() => useRateTable(table, { mode: 'client', confirmations: [{ ...confirmation, hash: 'f'.repeat(64) }] }), code('RATE_UNCONFIRMED'));
});

test('money: rounding is always named, and the statutory roundings work on whole paise', () => {
  assert.equal(divRound(5n, 2n, 'half-up'), 3n);
  assert.equal(divRound(5n, 2n, 'half-even'), 2n);
  assert.equal(divRound(7n, 2n, 'half-even'), 4n);
  assert.equal(divRound(5n, 2n, 'floor'), 2n);
  assert.equal(divRound(5n, 2n, 'ceil'), 3n);
  assert.equal(divRound(-5n, 2n, 'half-up'), -3n);
  assert.equal(applyBps(1_08_300_00n, 400n), 4_332_00n);
  // Section 288A and 288B: paise are ignored, then the nearest ten rupees, five going up.
  assert.equal(round288(70_096_00n), 70_100_00n);
  assert.equal(round288(70_094_99n), 70_090_00n);
  assert.equal(round288(70_095_00n), 70_100_00n);
  assert.equal(round288(70_094_99n + 1n), 70_100_00n);
  // Rule 119A: a fraction of one hundred rupees is ignored.
  assert.equal(floorToMultiple(50_099_99n, 100_00n), 50_000_00n);
  // A month or part of a month.
  assert.equal(monthsOrPart('2026-08-01', '2026-08-01'), 1);
  assert.equal(monthsOrPart('2026-08-01', '2026-09-20'), 2);
  assert.equal(monthsOrPart('2026-04-01', '2026-07-31'), 4);
  assert.equal(monthsOrPart('2026-04-01', '2026-08-01'), 5);
  assert.equal(monthsOrPart('2026-08-01', '2026-07-31'), 0);
  assert.equal(monthsOrPart('2026-01-31', '2026-02-28'), 1);
});
