// P3-ca-firm: the rate tables are versioned data with validity windows, citations and section references, each
// flagged for the CA's confirmation; the money helpers round only by a named rule.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACT_2025_QUESTION, CARRIED_FORWARD, OPEN_QUESTIONS, RATE_TABLE_HISTORY, RATE_TABLES, RENUMBERING_QUESTION, REHEARSAL, rateTableFor, rateTableHash, useRateTable, validateRateTables,
  type IncomeTaxPayload, type RateConfirmation, type RateTable, type TdsPayload,
} from '../runtime/venture/playbooks/ca-firm/rates.ts';
import { applyBps, divRound, floorToMultiple, monthsOrPart, round288 } from '../runtime/venture/playbooks/ca-firm/money.ts';
import { computeIncomeTax, incomeTaxTable } from '../runtime/venture/playbooks/ca-firm/income-tax.ts';
import { tdsTable, tdsWorking } from '../runtime/venture/playbooks/ca-firm/tds.ts';

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
  assert.throws(() => rateTableFor('income-tax', '2027-04-01'), code('RATE_TABLE_STALE'));
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

// ---------------------------------------------------------------------------
// W1 H7: current-year tables, picked by the transaction date, refusing past every window
// ---------------------------------------------------------------------------

const OFFICIAL = /^https:\/\/(?:www\.)?(?:incometaxindia\.gov\.in|incometax\.gov\.in|indiabudget\.gov\.in)\//;
const byId = (id: string) => RATE_TABLES.find(table => table.id === id)!;

test('H7: a TDS table for FY 2026-27 and an income-tax table for AY 2027-28, each with its window, official citations and no CA confirmation yet', () => {
  const tds = byId('in-tds-fy-2026-27') as RateTable<TdsPayload>;
  const income = byId('in-income-tax-ay-2027-28') as RateTable<IncomeTaxPayload>;
  assert.ok(tds && income, 'both new tables are kept');
  assert.deepEqual([tds.kind, tds.version, tds.validFrom, tds.validTo, tds.payload.financialYear], ['tds-sections', 1, '2026-04-01', '2027-04-01', '2026-27']);
  assert.deepEqual([income.kind, income.version, income.validFrom, income.validTo, income.payload.assessmentYear, income.payload.previousYear],
    ['income-tax', 1, '2026-04-01', '2027-04-01', '2027-28', '2026-27']);
  for (const table of [tds, income]) {
    // Every source is an official page; a figure no official page gave is carried forward and says so.
    for (const citation of table.citations) {
      assert.equal(citation.checkedOn, null, table.id);
      if (citation.url !== null) assert.match(citation.url, OFFICIAL, `${table.id}: ${citation.source}`);
      else assert.equal(citation.note, CARRIED_FORWARD, `${table.id}: a citation with no address is a carried-forward one`);
    }
    assert.ok(table.citations.some(citation => citation.url !== null), table.id);
    // Unconfirmed: works in rehearsal and says nobody confirmed it; a real client's work refuses it.
    const stamp = useRateTable(table, REHEARSAL);
    assert.deepEqual([stamp.confirmed, stamp.confirmedBy], [false, null]);
    assert.throws(() => useRateTable(table, { mode: 'client', confirmations: [] }), code('RATE_UNCONFIRMED'));
    assert.ok(table.openQuestions.includes(ACT_2025_QUESTION) && OPEN_QUESTIONS.includes(ACT_2025_QUESTION), table.id);
  }
  assert.equal(CARRIED_FORWARD, 'carried forward from FY 2025-26, not verified, needs CA confirmation');
  // The income-tax table carries some figures forward; the TDS table's every rate came from an official page.
  assert.ok(income.citations.some(citation => citation.note === CARRIED_FORWARD));
  assert.ok(!tds.citations.some(citation => citation.note === CARRIED_FORWARD));
});

test('H7: section numbers follow the renumbering rule: the Income-tax Act, 2025 where an official page gave it, flagged for the CA either way', () => {
  const tds = byId('in-tds-fy-2026-27');
  const income = byId('in-income-tax-ay-2027-28');
  const ref = (table: RateTable, key: string) => { const found = table.sections.find(item => item.key === key)!; return `${found.act} ${found.section}`; };
  assert.equal(ref(tds, 'tds-194C'), 'Income-tax Act, 2025 393(1), Table serial 6(i)');
  assert.equal(ref(tds, 'tds-194J'), 'Income-tax Act, 2025 393(1), Table serial 6(iii)');
  assert.equal(ref(tds, 'tds-194T'), 'Income-tax Act, 2025 393(1), Table serial 7');
  assert.equal(ref(tds, 'no-pan'), 'Income-tax Act, 2025 397(2)');
  assert.equal(ref(tds, 'deposit'), 'Income-tax Rules, 2026 218');
  assert.equal(ref(income, 'new-regime'), 'Income-tax Act, 2025 202(1)');
  assert.equal(ref(income, 'rebate'), 'Income-tax Act, 2025 156');
  assert.equal(ref(income, 'rounding-tax'), 'Income-tax Act, 2025 516');
  // Not found on an official page: the 1961 number is carried forward, and the CA confirms it.
  assert.equal(ref(income, 'deduction-80D'), 'Income-tax Act, 1961 80D');
  for (const table of [tds, income]) {
    assert.ok(table.sections.every(item => item.needsCaConfirmation === true), table.id);
    assert.ok(table.openQuestions.includes(RENUMBERING_QUESTION), table.id);
  }
});

test('H7: the version is picked by the transaction date, never the clock; a date past every window is stale', () => {
  assert.equal(rateTableFor('tds-sections', '2026-03-31').id, 'in-tds-fy-2025-26');
  assert.equal(rateTableFor('tds-sections', '2026-04-01').id, 'in-tds-fy-2026-27');
  assert.equal(rateTableFor('income-tax', '2026-03-31').id, 'in-income-tax-ay-2026-27');
  assert.equal(rateTableFor('income-tax', '2026-04-01').id, 'in-income-tax-ay-2027-28');
  assert.equal(incomeTaxTable('2027-28').id, 'in-income-tax-ay-2027-28');
  assert.equal(tdsTable('2026-27').id, 'in-tds-fy-2026-27');
  // Past every table's window: stale, with a plain reason. Before the first window: missing, as before.
  assert.throws(() => rateTableFor('tds-sections', '2027-04-01'), code('RATE_TABLE_STALE'));
  assert.throws(() => incomeTaxTable('2028-29'), code('RATE_TABLE_STALE'));
  assert.throws(() => tdsTable('2027-28'), (error: any) => { assert.equal(error.code, 'RATE_TABLE_STALE'); assert.match(error.message, /CA/); return true; });
  assert.throws(() => rateTableFor('tds-sections', '2025-03-31'), code('RATE_TABLE_MISSING'));
  // Two tables of one kind must never cover the same day, whatever their ids.
  const clash = { ...byId('in-tds-fy-2026-27'), id: 'in-tds-fy-2026-27-copy', validFrom: '2026-10-01' };
  assert.throws(() => validateRateTables([...RATE_TABLES, clash]), /overlap/);
});

test('TDS FY 2025-26 version 2: with no PAN, the highest of the rate or 20% (206AA); version 1 is kept for history only', () => {
  const current = rateTableFor('tds-sections', '2025-06-01') as RateTable<TdsPayload>;
  assert.deepEqual([current.id, current.version, current.validFrom, current.validTo], ['in-tds-fy-2025-26', 2, '2025-04-01', '2026-04-01']);
  assert.equal(current.payload.noPanMultiplier, '1');
  const first = RATE_TABLE_HISTORY.find(table => table.id === 'in-tds-fy-2025-26' && table.version === 1) as RateTable<TdsPayload>;
  assert.ok(first, 'version 1 is kept');
  assert.equal(first.payload.noPanMultiplier, '2');
  assert.notEqual(rateTableHash(first), rateTableHash(current), 'a new hash, so the CA confirms version 2 again');
  assert.ok(!RATE_TABLES.includes(first), 'only current versions are picked for new work');
  validateRateTables(RATE_TABLE_HISTORY);
  // The note a client reads says the rule as the Act words it.
  const R = (rupees: number) => String(BigInt(rupees) * 100n);
  const tds = tdsWorking({ financialYear: '2025-26', payments: [{ id: 'r1', payee: 'Gupta Estates', pan: null, payeeKind: 'individual', section: '194I-building', date: '2025-04-05', amountMinor: R(60_000) }] });
  assert.equal(tds.table?.version, 2);
  const note = (tds.working as ReturnType<typeof tdsWorking>['working']).payments[0].note;
  assert.match(note, /the rate in the Act, the rate in force or 20%, whichever is highest/);
  assert.doesNotMatch(note, /twice/);
});

test('H7: the engines work FY 2026-27 TDS and AY 2027-28 income tax from the new tables', () => {
  const R = (rupees: number) => String(BigInt(rupees) * 100n);
  const tds = tdsWorking({ financialYear: '2026-27', payments: [
    { id: 'c1', payee: 'Sharma Builders', pan: 'AAAFS1234K', payeeKind: 'firm', section: '194C', date: '2026-05-10', amountMinor: R(35_000) },
    { id: 'r1', payee: 'Gupta Estates', pan: null, payeeKind: 'individual', section: '194I-building', date: '2027-03-05', amountMinor: R(60_000) },
  ] });
  assert.equal(tds.table?.id, 'in-tds-fy-2026-27');
  const rows = (tds.working as ReturnType<typeof tdsWorking>['working']);
  assert.deepEqual(rows.payments.map(row => [row.id, row.rateBps, row.tdsMinor]), [['c1', '200', R(700)], ['r1', '2000', R(12_000)]]);
  // Section 397(2): without a PAN, the highest of the rate or 20 percent.
  assert.match(rows.payments[1].note, /the rate in force or 20%, whichever is highest/);
  assert.deepEqual(rows.challans.map(item => [item.month, item.depositDue]), [['2026-05', '2026-06-07'], ['2027-03', '2027-04-30']]);
  assert.ok(tds.sections.some(item => item.section === '393(1), Table serial 6(i)'));
  // A payment outside the year is refused, as before.
  assert.throws(() => tdsWorking({ financialYear: '2026-27', payments: [{ id: 'x', payee: 'X', pan: null, payeeKind: 'firm', section: '194C', date: '2026-03-31', amountMinor: R(40_000) }] }), code('TAX_INPUT_INVALID'));

  const tax = computeIncomeTax({ assessmentYear: '2027-28', regime: 'new', residency: 'resident', ageBand: 'below-60', salaryMinor: R(15_00_000) });
  assert.equal(tax.table?.id, 'in-income-tax-ay-2027-28');
  assert.equal(tax.figures.find(item => item.key === 'tax-liability-rounded')!.minor, R(97_500));
  assert.ok(tax.sections.some(item => item.act === 'Income-tax Act, 2025' && item.section === '202(1)'));
  assert.ok(tax.openQuestions.includes(ACT_2025_QUESTION));
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
