// Social media agency playbook: the monthly report. Figures come from the platform exports the client uploads, computed
// by code in exact whole numbers (BigInt), each with a receipt naming the file, its digest, the rows and the columns.
// Unknown is never zero: a missing cell stops that figure. The narrative may only cite figures a receipt holds.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  EXPORT_PROFILES, checkReportNarrative, computePlatformReport, monthlyReport, parseExport, type ExportFile, type ReportReceipt,
} from '../runtime/venture/playbooks/social/report.ts';

const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected, error?.message); return true; };
const fixture = async (name: string): Promise<ExportFile> => ({
  id: `upload_${name}`, name, text: await readFile(new URL(`./fixtures/venture/social/${name}`, import.meta.url), 'utf8'),
});
const figure = (report: { receipts: ReportReceipt[] }, key: string) => report.receipts.find(receipt => receipt.key === key);

test('export profiles: two platforms, each naming its columns and its engagement formula', () => {
  assert.deepEqual(Object.keys(EXPORT_PROFILES).sort(), ['instagram', 'linkedin']);
  assert.match(EXPORT_PROFILES.instagram.engagement.formula, /likes, comments, shares and saves/i);
  assert.match(EXPORT_PROFILES.linkedin.engagement.formula, /impressions/i);
});

test('parse: the Instagram export is read by column name; a file of another kind is refused', async () => {
  const file = await fixture('instagram-content-2026-09.csv');
  const parsed = parseExport(file, 'instagram');
  assert.equal(parsed.rows.length, 6);
  assert.equal(parsed.rows[0].row, 2, 'rows are numbered as the spreadsheet shows them');
  assert.equal(parsed.rows[1].values.reach, 2450n);
  assert.equal(parsed.rows[1].published, '2026-09-02');
  assert.throws(() => parseExport(file, 'linkedin'), code('EXPORT_NOT_RECOGNISED'));
  assert.throws(() => parseExport({ ...file, text: '' }, 'instagram'), code('EXPORT_NOT_RECOGNISED'));
});

test('report: Instagram figures for September, exact, from the rows in the month only', async () => {
  const report = computePlatformReport(await fixture('instagram-content-2026-09.csv'), 'instagram', '2026-09');
  assert.equal(report.posts, 5);
  assert.deepEqual(report.excludedRows, [{ row: 2, reason: 'Published on 2026-08-29, outside 2026-09.' }]);
  assert.equal(figure(report, 'posts')!.value, '5');
  assert.equal(figure(report, 'views')!.display, '21,735');
  assert.equal(figure(report, 'reach')!.display, '16,581');
  assert.equal(figure(report, 'engagements')!.value, '1521');
  const rate = figure(report, 'engagement-rate')! as any;
  assert.equal(rate.display, '9.17%');
  assert.equal(rate.numerator, '1521');
  assert.equal(rate.denominator, '16581');
  assert.equal(figure(report, 'follows')!.display, '41');
  assert.equal(figure(report, 'top-post')!.value, '17900000000000003');
  assert.match(figure(report, 'reach')!.formula, /counted more than once/i, 'summed reach is labelled honestly');
});

test('report: LinkedIn figures use its own columns and impressions; the export rate column is never copied', async () => {
  const report = computePlatformReport(await fixture('linkedin-updates-2026-09.csv'), 'linkedin', '2026-09');
  assert.equal(report.posts, 3);
  assert.equal(figure(report, 'impressions')!.display, '6,010');
  assert.equal(figure(report, 'engagements')!.value, '398');
  assert.equal(figure(report, 'engagement-rate')!.display, '6.62%');
  assert.equal(figure(report, 'top-post')!.value, 'https://www.linkedin.com/feed/update/urn:li:activity:7002/');
  assert.equal(figure(report, 'reach'), undefined, 'LinkedIn updates have no reach column');
});

test('receipts: each names the file, its digest, the rows and the columns, and has a stable id', async () => {
  const file = await fixture('instagram-content-2026-09.csv');
  const first = computePlatformReport(file, 'instagram', '2026-09');
  const again = computePlatformReport(file, 'instagram', '2026-09');
  const reach = figure(first, 'reach')! as any;
  assert.equal(reach.inputs.fileId, file.id);
  assert.match(reach.inputs.fileDigest, /^[0-9a-f]{64}$/);
  assert.deepEqual(reach.inputs.rows, [3, 4, 5, 6, 7]);
  assert.deepEqual(reach.inputs.columns, ['Reach']);
  assert.match(reach.id, /^sr_[0-9a-f]{16}$/);
  assert.deepEqual(first.receipts.map(receipt => receipt.id), again.receipts.map(receipt => receipt.id));
  const changed = computePlatformReport({ ...file, text: file.text.replace('"2,450"', '"2,451"') }, 'instagram', '2026-09');
  assert.notEqual(figure(changed, 'reach')!.id, reach.id);
});

test('unknown is not zero: a missing or broken cell stops that figure and says which row', async () => {
  const file = await fixture('instagram-content-2026-09.csv');
  const blank = computePlatformReport({ ...file, text: file.text.replace('"4,118"', '""') }, 'instagram', '2026-09');
  assert.equal(figure(blank, 'reach'), undefined);
  assert.equal(figure(blank, 'engagement-rate'), undefined, 'the rate needs reach too');
  assert.equal(figure(blank, 'engagements')!.value, '1521', 'other figures still compute');
  assert.ok(blank.missing.some(item => item.key === 'reach' && /row 6/.test(item.line)), JSON.stringify(blank.missing));
  const decimal = computePlatformReport({ ...file, text: file.text.replace('"201"', '"201.5"') }, 'instagram', '2026-09');
  assert.equal(figure(decimal, 'engagements'), undefined);
  assert.ok(decimal.missing.some(item => /whole number/.test(item.line)));
  const twice = file.text.trim().split('\n');
  assert.throws(() => computePlatformReport({ ...file, text: [...twice, twice[3]].join('\n') }, 'instagram', '2026-09'), code('EXPORT_DUPLICATE_POST'));
  assert.throws(() => computePlatformReport(file, 'instagram', '2026-9'), code('INVALID_VENTURE_REQUEST'));
});

test('dates: the export date order can be set; an impossible date is refused, not guessed', async () => {
  const file = await fixture('linkedin-updates-2026-09.csv');
  const flipped = computePlatformReport(file, 'linkedin', '2026-04', { dateOrder: 'day-month-year' });
  assert.equal(flipped.posts, 1, '09/04/2026 read day first is 9 April');
  const broken = computePlatformReport({ ...file, text: file.text.replace('09/25/2026', '09/31/2026') }, 'linkedin', '2026-09');
  assert.equal(broken.posts, 2);
  assert.ok(broken.excludedRows.some(item => item.row === 4 && /date/i.test(item.reason)));
});

test('monthly report: both platforms together; the narrative may cite only receipt figures', async () => {
  const report = monthlyReport({
    month: '2026-09',
    files: [
      { file: await fixture('instagram-content-2026-09.csv'), platform: 'instagram' },
      { file: await fixture('linkedin-updates-2026-09.csv'), platform: 'linkedin' },
    ],
  });
  assert.deepEqual(report.platforms.map(item => item.platform), ['instagram', 'linkedin']);
  assert.equal(report.receipts.length, report.platforms.reduce((sum, item) => sum + item.receipts.length, 0));
  const good = checkReportNarrative('In September 2026 the Instagram posts reached 16,581 accounts in total, with an engagement rate of 9.17%. On LinkedIn the rate was 6.62%.', report.receipts);
  assert.equal(good.passed, true, JSON.stringify(good.unmatched));
  const bad = checkReportNarrative('Engagement grew 12% and reach rose to 17,000.', report.receipts);
  assert.equal(bad.passed, false);
  assert.deepEqual(bad.unmatched, ['12%', '17,000']);
  assert.match(bad.line, /no receipt/i);
});
