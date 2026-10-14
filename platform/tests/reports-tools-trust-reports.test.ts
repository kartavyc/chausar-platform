import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { crc32 as zlibCrc32 } from 'node:zlib';
import { Engine } from '../runtime/engine.ts';
import type { Context } from '../runtime/contracts.ts';
import { csvFile } from '../runtime/reports-ext/export-files.ts';
import { xlsxBook, crc32 } from '../runtime/reports-ext/xlsx.ts';
import { pendingExportPaths, reportsMethods } from '../runtime/reports-ext/methods.ts';

// Synthetic records only: one month of an invented business, with a formula-shaped description.
const csv = `id,kind,date,amount,currency,customerId,invoiceId,dueDate,status,description
sale-a,sale,2026-09-03,1250.25,INR,customer-a,invoice-a,,delivered,Delivered goods
refund-a,refund,2026-09-05,125.00,INR,customer-a,invoice-a,,settled,Returned goods
cost-a,cost,2026-09-03,500.00,INR,customer-a,invoice-a,,settled,Goods cost
invoice-a,invoice,2026-09-02,2200.00,INR,customer-a,invoice-a,2026-09-15,unpaid,=1+1
payment-a,payment,2026-09-06,1100.00,INR,customer-a,invoice-a,,settled,Settled receipt
purchase-a,purchase,2026-09-04,400.00,INR,,,,settled,Raw material
`;
const recipe = {
  version: 1, id: 'synthetic-reports-v1', system: 'synthetic-csv', edition: '1', scope: { company: 'Synthetic Reports Co', branches: ['main'] },
  bindings: [
    { target: 'entityId', source: 'id', type: 'string', nulls: 'reject' }, { target: 'kind', source: 'kind', type: 'string', nulls: 'reject' },
    { target: 'validFrom', source: 'date', type: 'date', dateFormat: 'ISO', nulls: 'reject' },
    { target: 'amountMinor', source: 'amount', type: 'money', moneyUnit: 'major', currency: 'INR', nulls: 'reject' },
    { target: 'currency', source: 'currency', type: 'string', nulls: 'reject' },
    ...['customerId', 'invoiceId', 'status', 'description'].map(name => ({ target: name, source: name, type: 'string', nulls: 'omit' })),
    { target: 'dueDate', source: 'dueDate', type: 'date', dateFormat: 'ISO', nulls: 'omit' },
  ],
  allowedKinds: ['invoice', 'payment', 'sale', 'refund', 'cost', 'purchase'], allowedStatuses: ['settled', 'delivered', 'unpaid'], onUnmapped: 'reject',
};
const sourceId = 'synthetic-reports-source';
const september = { from: '2026-09-01', to: '2026-09-30' };
const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected); return true; };

async function fixture(t: any, withData = true) {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-reports-ext-'));
  let now = Date.parse('2026-10-14T06:00:00.000Z');
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file', modules: { 'reports-tools-trust': { clock: () => now } } });
  t.after(async () => {
    await engine.close(); assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(directory.split(/[\\/]/).at(-1)!.startsWith('chausar-reports-ext-')); await rm(directory, { recursive: true, force: true });
  });
  await engine.request('workspace.create', { name: 'Synthetic Reports Co', passphrase: 'Synthetic reports passphrase 2026', demo: false, pack: 'ecommerce' });
  if (withData) await engine.request('sources.import', { sourceId, format: 'csv', content: csv, recipe, expectedTotals: { rowCount: 6, amountMinor: '557525' } });
  return { engine, directory, at: (iso: string) => { now = Date.parse(iso); } };
}
const pageOf = (pack: any, id: string) => pack.pages.find((page: any) => page.id === id);
const lineOf = (page: any, sectionId: string, lineId: string) => page.sections.find((s: any) => s.id === sectionId).lines.find((l: any) => l.id === lineId);

test('packs give each page a state from registered calculations and receipt coverage, with GST modes', async t => {
  const { engine } = await fixture(t);
  const { packs, checkedAt } = await engine.request('reportsx.packs', {});
  assert.ok(Date.parse(checkedAt));
  assert.deepEqual(packs.map((p: any) => p.id), ['lender', 'ca', 'investor']);
  const [lender, ca, investor] = packs;
  assert.deepEqual(ca.gstModes, ['regular', 'composition']); assert.deepEqual(lender.gstModes, ['regular', 'composition', 'none']); assert.ok(investor.gstModes.includes('none'));
  assert.equal(pageOf(lender, 'key-financials').state, 'ready-tested');
  assert.equal(pageOf(lender, 'receivables-ageing').state, 'ready-tested');
  assert.deepEqual(pageOf(lender, 'bank-summary'), { id: 'bank-summary', title: 'Bank statement summary', state: 'not-started', reason: 'No bank statement is imported yet.' });
  assert.equal(pageOf(lender, 'gst-turnover').reason, 'Needs a GSTR-1 or GSTR-3B return imported through the GST connector.');
  assert.equal(pageOf(ca, 'purchases-gstr2b').state, 'not-started'); assert.equal(pageOf(ca, 'purchases-gstr2b').reason, 'Needs a GSTR-2B imported through the GST connector.');
  // Facts that are not reconciled to a source total make the same pages computed but untested.
  await engine.vault!.update(state => { for (const item of state.imports) item.coverage.reconciled = false; });
  const after = (await engine.request('reportsx.packs', {})).packs[0];
  assert.equal(pageOf(after, 'key-financials').state, 'ready-untested');
});

test('an empty workspace lists every page as not started with a plain reason', async t => {
  const { engine } = await fixture(t, false);
  const { packs } = await engine.request('reportsx.packs', {});
  for (const pack of packs) for (const page of pack.pages) { assert.equal(page.state, 'not-started'); assert.equal(typeof page.reason, 'string'); }
  const page = await engine.request('reportsx.page', { pack: 'lender', page: 'key-financials', period: september });
  assert.deepEqual(lineOf(page, 'operations', 'net-sales').figure, { kind: 'missing', missing: 'absent' });
});

test('every printed figure opens its calculation receipt; missing values are missing states, never zero', async t => {
  const { engine } = await fixture(t);
  const page = await engine.request('reportsx.page', { pack: 'lender', page: 'key-financials', period: september });
  assert.equal(page.title, 'Key financials (CMA-style summary)'); assert.equal(page.language, 'en'); assert.deepEqual(page.period, september);
  assert.deepEqual(lineOf(page, 'operations', 'net-sales').figure.exact, '112525');
  assert.equal(lineOf(page, 'working-capital', 'receivables').side, 'Dr');
  assert.equal(lineOf(page, 'working-capital', 'receivables').figure.exact, '97500');
  let figures = 0;
  for (const section of page.sections) for (const line of section.lines) if (line.figure.kind !== 'missing') {
    const receipt = await engine.request('receipts.get', { id: line.figure.receiptId });
    assert.equal(receipt.figures.find((f: any) => f.key === line.figure.measure.key).minor, line.figure.exact); assert.ok(page.receiptIds.includes(receipt.id)); figures++;
  }
  assert.equal(figures, 4);
  assert.match(page.footer.checkCode, /^[0-9a-f]{8}$/); assert.ok(Date.parse(page.footer.at)); assert.deepEqual(line0Labels(page), []); assert.deepEqual(page.markings, []);
  const monthly = await engine.request('reportsx.page', { pack: 'lender', page: 'monthly-sales', period: september });
  const months = monthly.sections[0].lines; assert.equal(months.length, 12); assert.equal(months.at(-1).id, '2026-09'); assert.equal(months.at(-1).figure.exact, '112525');
  assert.deepEqual(months[0].figure, { kind: 'missing', missing: 'absent' }); assert.ok(months.every((l: any) => l.figure.kind === 'missing' || l.figure.exact !== '0'));
  const gst = await engine.request('reportsx.page', { pack: 'lender', page: 'gst-turnover', period: september });
  assert.equal(gst.state, 'not-started'); assert.deepEqual(gst.sections.map((s: any) => [s.id, s.lines.length]), [['not-started', 0]]);
  assert.deepEqual(gst.gaps, ['Needs a GSTR-1 or GSTR-3B return imported through the GST connector.']);
  const projections = await engine.request('reportsx.page', { pack: 'lender', page: 'projections', period: september });
  const forecast = projections.sections.find((s: any) => s.id === 'forecast');
  assert.equal(forecast.projection, true); assert.equal(projections.sections[0].projection, false);
  assert.deepEqual(forecast.lines[0].figure, { kind: 'missing', missing: 'not-counted' }); assert.ok(forecast.gaps[0].startsWith('The forecast was refused'));
  await assert.rejects(engine.request('reportsx.page', { pack: 'lender', page: 'nope' }), code('UNKNOWN_REPORT_PAGE'));
  await assert.rejects(engine.request('reportsx.page', { pack: 'lender', page: 'key-financials', period: { from: '2026-09-30', to: '2026-09-01' } }), code('INVALID_PERIOD'));
});

test('loan page carries its disclaimer, ageing pages carry 43B(h) and TReDS notes, Hindi pages are written in Hindi', async t => {
  const { engine } = await fixture(t);
  const loan = await engine.request('reportsx.page', { pack: 'lender', page: 'loan-readiness', period: september });
  assert.equal(loan.disclaimer, 'This is not a loan offer or a promise of one.');
  const ageing = await engine.request('reportsx.page', { pack: 'ca', page: 'ageing', period: september });
  assert.deepEqual(ageing.notes.map((n: any) => n.id), ['43bh', 'treds']);
  for (const note of ageing.notes) { assert.equal(note.notLegalAdvice, true); assert.match(note.source.url, /^https:\/\/(incometaxindia\.gov\.in|www\.rbi\.org\.in)\//); assert.equal(note.source.checkedOn, '2026-10-14'); assert.ok(note.source.title); }
  assert.ok(ageing.sections[0].lines.every((l: any) => l.side === 'Dr' || l.side === 'Cr'));
  assert.equal(lineOf(ageing, 'ageing', 'days-1-30').figure.exact, '97500');
  const hindi = await engine.request('reportsx.page', { pack: 'lender', page: 'loan-readiness', period: september, language: 'hi' });
  assert.equal(hindi.title, 'क्या आप ऋण के लिए तैयार हैं?'); assert.equal(hindi.language, 'hi'); assert.equal(hindi.disclaimer, 'यह ऋण का प्रस्ताव या उसका वादा नहीं है।');
  const hindiAgeing = await engine.request('reportsx.page', { pack: 'ca', page: 'ageing', period: september, language: 'hi' });
  assert.match(hindiAgeing.notes[0].text, /धारा 43B\(h\)/); assert.equal(hindiAgeing.sections[0].lines[0].label, 'अभी देय नहीं');
  await assert.rejects(engine.request('reportsx.page', { pack: 'ca', page: 'ageing', language: 'fr' }), code('INVALID_LANGUAGE'));
});

/** Reads a stored (method 0) ZIP by its local headers and checks each entry's CRC-32. */
function unzipStored(bytes: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>(); let at = 0;
  while (bytes.readUInt32LE(at) === 0x04034b50) {
    assert.equal(bytes.readUInt16LE(at + 8), 0); const crc = bytes.readUInt32LE(at + 14), size = bytes.readUInt32LE(at + 18), nameLength = bytes.readUInt16LE(at + 26), extra = bytes.readUInt16LE(at + 28);
    const name = bytes.subarray(at + 30, at + 30 + nameLength).toString('utf8'), data = bytes.subarray(at + 30 + nameLength + extra, at + 30 + nameLength + extra + size);
    assert.equal(zlibCrc32(data), crc); entries.set(name, data); at += 30 + nameLength + extra + size;
  }
  assert.equal(bytes.readUInt32LE(bytes.length - 22), 0x06054b50); assert.equal(bytes.readUInt16LE(bytes.length - 12), entries.size);
  return entries;
}

test('CSV and XLSX write text cells as text so a spreadsheet never runs them as formulas', () => {
  assert.equal(csvFile([['=1+1', '+x', '-y', '@z', '\tq', 'ok, "quoted"', { amount: '-12.50' }]]), `'=1+1,'+x,'-y,'@z,'\tq,"ok, ""quoted""",-12.50\r\n`);
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  const sheet = unzipStored(xlsxBook('Sheet', [['=1+1', { amount: '12.34' }]])).get('xl/worksheets/sheet1.xml')!.toString('utf8');
  assert.match(sheet, /<c r="A1" t="inlineStr"><is><t xml:space="preserve">=1\+1<\/t><\/is><\/c>/); assert.match(sheet, /<c r="B1"><v>12\.34<\/v><\/c>/); assert.doesNotMatch(sheet, /<f>/);
  assert.throws(() => xlsxBook('Sheet', [[{ amount: '=1+1' }]]));
});

test('page export writes CSV, XLSX and print HTML; PDF and Tally refuse with their codes', async t => {
  const { engine, directory } = await fixture(t);
  for (const format of ['csv', 'xlsx', 'html']) {
    const file = await engine.request('reportsx.export', { pack: 'ca', page: 'ageing', format, period: september });
    assert.equal(file.format, format); assert.equal(file.encrypted, false); assert.equal(file.textCellsProtected, true);
    assert.equal(dirname(file.path), join(directory, 'exports', 'reports'));
    const bytes = await readFile(file.path); assert.equal(bytes.length, file.bytes); assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256);
    if (format === 'csv') assert.match(bytes.toString('utf8'), /Overdue 1 to 30 days,Dr,975\.00,receipt_/);
    if (format === 'xlsx') assert.match(unzipStored(bytes).get('xl/worksheets/sheet1.xml')!.toString('utf8'), /<v>975\.00<\/v>/);
    if (format === 'html') assert.match(bytes.toString('utf8'), /Not legal advice/);
  }
  await assert.rejects(engine.request('reportsx.export', { pack: 'ca', page: 'ageing', format: 'pdf' }), code('PDF_USES_PRINT'));
  await assert.rejects(engine.request('reportsx.export', { pack: 'ca', page: 'ageing', format: 'tally' }), code('TALLY_PAGE_EXPORT_NOT_AVAILABLE'));
  await assert.rejects(engine.request('reportsx.export', { pack: 'ca', page: 'ageing', format: 'docx' }), code('INVALID_EXPORT_FORMAT'));
});

test('the week ahead is built once per period, labels a late build and compares the last completed week with the one before it', async t => {
  const { engine, at } = await fixture(t);
  at('2026-09-08T06:00:00.000Z');
  const first = await engine.request('reportsx.weekAhead', { onDate: '2026-09-08' });
  assert.deepEqual(first.period, { from: '2026-09-07', to: '2026-09-13' }); assert.equal(first.scheduledFor, '2026-09-07T03:30:00.000Z');
  assert.equal(first.late, true); assert.equal(first.explanation, 'not-written'); assert.deepEqual(first.missed, []); assert.deepEqual(first.gaps, []);
  const sales = first.changed.find((item: any) => item.id === 'net_sales');
  // The week that has barely started is never compared: last completed week (31 Aug to 6 Sep) against the week before it.
  assert.equal(sales.text, 'Net sales, the week 2026-08-31 to 2026-09-06 against the week 2026-08-24 to 2026-08-30');
  assert.deepEqual(sales.chart.map((bar: any) => bar.id), ['week-before', 'last-week']);
  assert.equal(sales.chart.length, 2); assert.equal(sales.figure.exact, '112525'); assert.deepEqual(sales.chart[0].figure, { kind: 'missing', missing: 'absent' }); assert.equal(sales.chart[1].figure.exact, '112525');
  const receipt = await engine.request('receipts.get', { id: sales.figure.receiptId });
  assert.equal(receipt.totalMinor, '112525'); assert.deepEqual(receipt.period, { from: '2026-08-31', to: '2026-09-06' });
  // Next week, last week's brief is still kept and returned unchanged.
  at('2026-09-15T06:00:00.000Z');
  assert.deepEqual(await engine.request('reportsx.weekAhead', { onDate: '2026-09-10' }), first);
  // Two weeks on, an older week refuses and nothing is built or stored by the read.
  at('2026-10-14T06:00:00.000Z');
  const briefs = () => Object.keys((engine.vault!.read().extensions as any)['reports-tools-trust'].reports.briefs ?? {});
  const before = briefs();
  await assert.rejects(engine.request('reportsx.weekAhead', { onDate: '2026-09-08' }), code('WEEK_TOO_OLD'));
  await assert.rejects(engine.request('reportsx.weekAhead', { onDate: '2026-01-05' }), code('WEEK_TOO_OLD'));
  assert.deepEqual(briefs(), before);
  assert.deepEqual((await engine.request('reportsx.weekAhead', { onDate: '2026-10-05' })).period, { from: '2026-10-05', to: '2026-10-11' });
  at('2026-10-12T04:00:00.000Z');
  const onTime = await engine.request('reportsx.weekAhead', { onDate: '2026-10-12' });
  assert.equal(onTime.late, false); assert.equal(onTime.builtAt, '2026-10-12T04:00:00.000Z');
  assert.ok(onTime.due.some((item: any) => item.id === 'gstr3b-monthly:2026-10-20'));
  await assert.rejects(engine.request('reportsx.weekAhead', { onDate: '2026-10-26' }), code('WEEK_NOT_STARTED'));
  // The scheduled tick builds the brief once its time has come, and only while autonomy is on.
  await engine.request('trust.update', { autonomy: true }); engine.updateJobLifecycle({ awake: true, windowOpen: true, backgroundEnabled: false });
  at('2026-10-19T03:40:00.000Z'); assert.deepEqual(await engine.tick(), []);
  await engine.request('reportsx.setRhythm', { missedRule: 'skip' });
  at('2026-10-19T03:00:00.000Z'); await engine.tick();
  assert.equal((engine.vault!.read().extensions as any)['reports-tools-trust'].reports.briefs['owner:2026-10-19'], undefined);
  at('2026-10-19T03:40:00.000Z'); const results = await engine.tick();
  assert.ok(results.some((item: any) => item.module === 'reports' && item.late === false));
  assert.equal((await engine.request('reportsx.weekAhead', { onDate: '2026-10-21' })).builtAt, '2026-10-19T03:40:00.000Z');
  at('2026-10-26T06:00:00.000Z'); assert.ok(!(await engine.tick()).some((item: any) => item.module === 'reports'));
  assert.equal((engine.vault!.read().extensions as any)['reports-tools-trust'].reports.briefs['owner:2026-10-26'], undefined);
});

test('Friday review and rhythm settings validate, preview without digits and refuse a relay that does not exist', async t => {
  const { engine } = await fixture(t);
  const review = await engine.request('reportsx.friday', { onDate: '2026-10-16' });
  assert.deepEqual(review.period, { from: '2026-10-12', to: '2026-10-18' }); assert.deepEqual(review.decisions, []); assert.deepEqual(review.lessons, { available: true, items: [] });
  const rhythm = await engine.request('reportsx.rhythm', {});
  assert.deepEqual({ days: rhythm.days, time: rhythm.time, dailyClosing: rhythm.dailyClosing, financialYearStart: rhythm.financialYearStart, missedRule: rhythm.missedRule, mail: rhythm.mail, whatsapp: rhythm.whatsapp },
    { days: [1], time: '09:00', dailyClosing: false, financialYearStart: '04-01', missedRule: 'run-late', mail: { on: false, address: null }, whatsapp: { on: false, phone: null } });
  assert.equal(rhythm.relay, 'not-available'); assert.equal(rhythm.testMode, true); assert.equal(rhythm.whatsappTemplate, 'not-approved');
  for (const text of Object.values(rhythm.previews) as string[]) assert.doesNotMatch(text, /\d|₹/);
  await assert.rejects(engine.request('reportsx.setRhythm', { mail: { on: true, address: 'not an address' } }), code('INVALID_RHYTHM'));
  await assert.rejects(engine.request('reportsx.setRhythm', { whatsapp: { phone: '98765' } }), code('INVALID_RHYTHM'));
  await assert.rejects(engine.request('reportsx.setRhythm', { time: '25:00' }), code('INVALID_RHYTHM'));
  await assert.rejects(engine.request('reportsx.setRhythm', { days: [1, 1] }), code('INVALID_RHYTHM'));
  await assert.rejects(engine.request('reportsx.setRhythm', { surprise: true }), code('INVALID_RHYTHM'));
  await assert.rejects(engine.request('reportsx.verifyChannel', { channel: 'mail' }), code('CHANNEL_ADDRESS_REQUIRED'));
  const set = await engine.request('reportsx.setRhythm', { days: [5, 1], time: '08:30', mail: { on: true, address: 'owner@example.com' }, whatsapp: { phone: '+919876543210' } });
  assert.deepEqual(set.days, [1, 5]); assert.equal(set.mail.address, 'owner@example.com'); assert.equal(set.mailVerified, false);
  // The relay's phone.verify belongs to hosted-link; stub the host so this holds whether or not that lane is merged.
  const verify = reportsMethods['reportsx.verifyChannel']!;
  const hostWith = (call: (method: string) => Promise<unknown>) => ({ ...engine.moduleHost('reports-tools-trust', engine.context), call });
  await assert.rejects(Promise.resolve(verify.handler(engine.context, { channel: 'mail' }, hostWith(async () => { throw Object.assign(new Error('x'), { code: 'UNKNOWN_METHOD' }); }) as any)), code('RELAY_NOT_AVAILABLE'));
  assert.deepEqual(await verify.handler(engine.context, { channel: 'mail' }, hostWith(async method => { assert.equal(method, 'phone.verify'); return { verified: true }; }) as any), { channel: 'mail', verified: true });
});

test('due dates are worked out from the sourced table for a profile, mark old checks and say what is not covered', async t => {
  const { engine } = await fixture(t, false);
  const due = await engine.request('reportsx.due', { from: '2026-10-14', days: 30, profile: { kind: 'services', gstMode: 'regular', state: 'MH' } });
  assert.equal(due.caNote, 'This table has not been checked by a CA yet. Each row links to the official source.'); assert.equal(due.covered, true); assert.equal(due.table.version, 'due-dates.v1');
  const ids = due.rows.map((row: any) => row.id);
  for (const id of ['pf-ecr:2026-10-15', 'esi:2026-10-15', 'gstr3b-monthly:2026-10-20', 'gstr3b-qrmp-22:2026-10-22', 'itr-audit:2026-10-31', 'tds-return:2026-10-31', 'pt-mh-employer:2026-10-31', 'tds-deposit:2026-11-07', 'gstr1-monthly:2026-11-11'])
    assert.ok(ids.includes(id), id);
  assert.ok(!ids.some((id: string) => id.startsWith('gstr3b-qrmp-24') || id.startsWith('pt-ka') || id.startsWith('cmp08')));
  assert.deepEqual(ids, [...ids].sort((a: string, b: string) => a.split(':')[1].localeCompare(b.split(':')[1]) || a.localeCompare(b)));
  const row = due.rows.find((r: any) => r.id === 'gstr3b-monthly:2026-10-20');
  assert.equal(row.checkOld, false); assert.equal(row.lastChecked, '2026-10-14'); assert.deepEqual(row.appliesTo.gstModes, ['regular']);
  assert.deepEqual(row.source, { title: 'CBIC Notification No. 82/2020-Central Tax: CGST Rules, rule 59(2) (IFF) and rule 61 (GSTR-3B by the 20th, 22nd or 24th)',
    url: 'https://gstcouncil.gov.in/sites/default/files/2024-05/notfctn-82-central-tax-english-2020.pdf', date: '2020-11-10', confirmed: true });
  // Every source is a specific official page, never a site's home page, unless it is marked as not confirmed.
  for (const item of due.rows) {
    assert.match(item.source.url, /^https:\/\/[a-z0-9.-]+\.gov\.in\//); assert.equal(typeof item.source.confirmed, 'boolean');
    assert.ok(item.source.date === null || /^\d{4}-\d{2}-\d{2}$/.test(item.source.date));
    if (item.source.confirmed) assert.ok(new URL(item.source.url).pathname.length > 1, item.id);
  }
  const april = await engine.request('reportsx.due', { from: '2027-04-01', days: 40, profile: { kind: 'retail', gstMode: 'composition', state: 'KA' } });
  const aprilIds = april.rows.map((r: any) => r.id);
  assert.ok(aprilIds.includes('tds-deposit:2027-04-30') && !aprilIds.includes('tds-deposit:2027-04-07'));
  assert.ok(aprilIds.includes('cmp08:2027-04-18') && !aprilIds.some((id: string) => id.startsWith('gstr4')) && aprilIds.includes('pt-ka-enrolment:2027-04-30'));
  const june = await engine.request('reportsx.due', { from: '2027-06-01', days: 30, profile: { kind: 'retail', gstMode: 'composition', state: 'KA' } });
  assert.ok(june.rows.some((r: any) => r.id === 'gstr4:2027-06-30' && r.source.confirmed === true && r.source.date === '2024-07-10'));
  const companies = await engine.request('reportsx.due', { from: '2026-10-14', days: 60, profile: { kind: 'retail', gstMode: 'none', state: 'DL' } });
  assert.deepEqual(companies.rows.filter((r: any) => r.id.startsWith('mca-')).map((r: any) => r.id), ['mca-aoc4:2026-10-30', 'mca-mgt7:2026-11-29']);
  assert.ok(!aprilIds.some((id: string) => id.startsWith('gstr3b')) && april.rows.every((r: any) => r.checkOld === true));
  const uncovered = await engine.request('reportsx.due', { from: '2026-10-14', profile: { kind: 'agriculture', gstMode: 'none', state: 'MH' } });
  assert.equal(uncovered.covered, false); assert.deepEqual(uncovered.rows, []); assert.ok(uncovered.coveredKinds.includes('services'));
  await assert.rejects(engine.request('reportsx.due', { profile: { kind: 'services', gstMode: 'regular', state: 'XX' } }), code('INVALID_DUE_PROFILE'));
  assert.deepEqual(await engine.request('reportsx.setDueProfile', { kind: 'services', gstMode: 'composition', state: 'KA' }), { kind: 'services', gstMode: 'composition', state: 'KA' });
  const stored = await engine.request('reportsx.due', { from: '2026-10-14', days: 10 });
  assert.deepEqual(stored.profile, { kind: 'services', gstMode: 'composition', state: 'KA' }); assert.ok(stored.rows.some((r: any) => r.id === 'cmp08:2026-10-18'));
});

test('export everything writes open files with row counts and check numbers; deleting the source purges derived records', async t => {
  const { engine, directory, at } = await fixture(t);
  await assert.rejects(engine.request('reportsx.exportAll', {}), code('CONFIRMATION_REQUIRED'));
  const record = await engine.request('reportsx.exportAll', { confirmed: true });
  assert.equal(record.locked, false); assert.equal(record.encrypted, false); assert.ok(record.folder.startsWith(join(directory, 'exports', 'everything-')));
  const facts = record.stores.find((s: any) => s.name === 'facts'); assert.equal(facts.rows, 6); assert.equal(facts.file, 'facts.csv');
  assert.ok(!record.stores.some((s: any) => s.name === 'sessions'));
  for (const store of record.stores) assert.equal(createHash('sha256').update(await readFile(join(record.folder, store.file))).digest('hex').slice(0, 16), store.checkNumber);
  const factsCsv = await readFile(join(record.folder, 'facts.csv'), 'utf8'); assert.match(factsCsv, /,'=1\+1(,|\r\n)/); assert.doesNotMatch(factsCsv, /,=1\+1/);
  assert.equal(record.stores.find((s: any) => s.name === 'members').rows, 1);
  const locked = await engine.request('reportsx.exportAll', { confirmed: true, locked: true });
  assert.equal(locked.locked, true); assert.equal(locked.encrypted, true); await access(join(locked.folder, locked.stores[0].file));
  const list = await engine.request('reportsx.exports', {});
  assert.equal(list.warning, 'Exported files are not encrypted.'); assert.deepEqual(list.items.map((i: any) => i.id), [locked.id, record.id]);
  const question = await engine.request('reportsx.askPerson', { question: 'Is <this> right?', reason: 'Chausar cannot classify this cost yet.',
    receiptId: (await engine.request('calculation.run', { operation: 'billed', period: september })).id });
  assert.equal(question.sent, false); assert.equal(dirname(question.file.path), join(directory, 'exports', 'questions'));
  const html = await readFile(question.file.path, 'utf8'); assert.match(html, /Is &lt;this&gt; right\?/); assert.match(html, /receipt_/);
  at('2026-09-08T06:00:00.000Z'); await engine.request('reportsx.weekAhead', { onDate: '2026-09-08' });
  await engine.request('sources.delete', { id: sourceId });
  const reports = (engine.vault!.read().extensions as any)['reports-tools-trust'].reports;
  assert.deepEqual(Object.keys(reports.briefs), []); assert.deepEqual(reports.questions, []);
  assert.deepEqual(reports.exports.map((item: any) => item.id), [locked.id]);
  await assert.rejects(access(record.folder)); await assert.rejects(access(question.file.path));
});

test('a viewer reads pages but cannot export, change the rhythm or export everything; only an owner exports everything', async t => {
  const { engine } = await fixture(t);
  await engine.request('members.add', { id: 'viewer-1', name: 'Synthetic viewer', role: 'viewer' });
  await engine.request('members.add', { id: 'cofounder-1', name: 'Synthetic cofounder', role: 'cofounder' });
  const viewer: Context = { memberId: 'viewer-1', role: 'viewer', epoch: 1, channel: 'desktop' };
  const cofounder: Context = { memberId: 'cofounder-1', role: 'cofounder', epoch: 1, channel: 'desktop' };
  assert.equal((await engine.requestAs(viewer, 'reportsx.page', { pack: 'investor', page: 'headline', period: september })).page, 'headline');
  for (const [method, payload] of [['reportsx.export', { pack: 'ca', page: 'ageing', format: 'csv' }], ['reportsx.setRhythm', { time: '10:00' }], ['reportsx.exportAll', { confirmed: true }],
    ['reportsx.askPerson', { question: 'Why?', reason: 'Not yet.' }], ['reportsx.setDueProfile', { kind: 'services', gstMode: 'none', state: 'MH' }], ['reportsx.verifyChannel', { channel: 'mail' }]] as const)
    await assert.rejects(engine.requestAs(viewer, method, payload), code('FORBIDDEN'));
  await assert.rejects(engine.requestAs(cofounder, 'reportsx.exportAll', { confirmed: true }), code('FORBIDDEN'));
  await assert.rejects(engine.requestAs({ ...viewer, channel: 'phone' }, 'reportsx.packs', {}), code('OPEN_DESKTOP'));
});

test('a forecast that passed its baseline test prints as not counted with words, because its receipt does not open from this page', async t => {
  const { engine } = await fixture(t);
  (engine as any).services.reports.forecast = async () => ({ id: 'answer_synthetic', status: 'passed-local-baseline-gate', forecastMinor: '123456' });
  for (const [language, words] of [['en', 'A forecast passed its baseline test. It opens in Ask, not on this page yet.'], ['hi', 'एक अनुमान अपनी आधार-रेखा जाँच में सफल रहा। यह Ask में खुलता है, अभी इस पृष्ठ पर नहीं।']]) {
    const page = await engine.request('reportsx.page', { pack: 'lender', page: 'projections', period: september, language });
    const forecast = page.sections.find((s: any) => s.id === 'forecast');
    assert.equal(forecast.projection, true); assert.deepEqual(forecast.lines[0].figure, { kind: 'missing', missing: 'not-counted' });
    assert.deepEqual(forecast.gaps, [words]); assert.doesNotMatch(words, /\d/); assert.ok(!page.receiptIds.includes('answer_synthetic'));
    for (const section of page.sections) for (const line of section.lines) if (line.figure.kind !== 'missing') assert.ok(await engine.request('receipts.get', { id: line.figure.receiptId }));
  }
  const csvText = await readFile((await engine.request('reportsx.export', { pack: 'lender', page: 'projections', format: 'csv', period: september })).path, 'utf8');
  assert.doesNotMatch(csvText, /1234\.56|answer_synthetic/);
});

test('markings follow the data: a seat that does not see a marking gets withheld figures and words, in pages, exports and briefs', async t => {
  const { engine, at } = await fixture(t);
  await engine.request('members.add', { id: 'accountant-1', name: 'Synthetic accountant', role: 'accountant' });
  await engine.request('members.add', { id: 'cofounder-1', name: 'Synthetic cofounder', role: 'cofounder' });
  const accountant: Context = { memberId: 'accountant-1', role: 'accountant', epoch: 1, channel: 'desktop' };
  const cofounder: Context = { memberId: 'cofounder-1', role: 'cofounder', epoch: 1, channel: 'desktop' };
  const words = 'Some figures are withheld: the data is marked financial and your seat does not see it.';
  // Marked but seen by default: the accountant sees financial data until the owner turns it off.
  await engine.request('trustx.setMarking', { kind: 'financial', target: { type: 'source', sourceId }, on: true });
  const seen = await engine.requestAs(accountant, 'reportsx.page', { pack: 'lender', page: 'key-financials', period: september });
  assert.equal(lineOf(seen, 'operations', 'net-sales').figure.exact, '112525'); assert.deepEqual(seen.markings, ['financial']); assert.ok(!seen.gaps.includes(words));
  await engine.request('trustx.setSeatMarking', { seat: 'accountant', kind: 'financial', sees: false });
  const page = await engine.requestAs(accountant, 'reportsx.page', { pack: 'lender', page: 'key-financials', period: september });
  assert.deepEqual(lineOf(page, 'operations', 'net-sales').figure, { kind: 'missing', missing: 'withheld' });
  for (const section of page.sections) for (const line of section.lines) assert.equal(line.figure.kind, 'missing');
  assert.ok(page.sections.find((s: any) => s.id === 'operations').gaps.includes(words)); assert.ok(page.gaps.includes(words));
  assert.deepEqual(page.receiptIds, []); assert.deepEqual(page.markings, ['financial']);
  const hindi = await engine.requestAs(accountant, 'reportsx.page', { pack: 'lender', page: 'key-financials', period: september, language: 'hi' });
  assert.ok(hindi.gaps.some((gap: string) => gap.includes('वित्तीय')));
  // Owner and cofounder see everything by default.
  for (const [who, ctx] of [['owner', null], ['cofounder', cofounder]] as const) {
    const full = ctx ? await engine.requestAs(ctx, 'reportsx.page', { pack: 'lender', page: 'key-financials', period: september }) : await engine.request('reportsx.page', { pack: 'lender', page: 'key-financials', period: september });
    assert.equal(lineOf(full, 'operations', 'net-sales').figure.exact, '112525', who); assert.ok(!full.gaps.includes(words), who);
  }
  // An export carries the withheld words, never the value.
  for (const format of ['csv', 'html']) {
    const text = await readFile((await engine.requestAs(accountant, 'reportsx.export', { pack: 'ca', page: 'ageing', format, period: september })).path, 'utf8');
    assert.ok(text.includes(words), format); assert.match(text, /withheld/); assert.doesNotMatch(text, /975\.00|receipt_/);
  }
  const xlsx = unzipStored(await readFile((await engine.requestAs(accountant, 'reportsx.export', { pack: 'ca', page: 'ageing', format: 'xlsx', period: september })).path)).get('xl/worksheets/sheet1.xml')!.toString('utf8');
  assert.ok(xlsx.includes(words)); assert.doesNotMatch(xlsx, /975\.00/);
  // The brief withholds too, and follows a later change of the seat's visibility.
  at('2026-09-08T06:00:00.000Z');
  const brief = await engine.requestAs(accountant, 'reportsx.weekAhead', { onDate: '2026-09-08' });
  const sales = brief.changed.find((item: any) => item.id === 'net_sales');
  assert.deepEqual(sales.figure, { kind: 'missing', missing: 'withheld' }); assert.ok(sales.chart.every((bar: any) => bar.figure.missing === 'withheld'));
  assert.deepEqual(brief.gaps, [words]); assert.equal(brief.receiptIds.length, 3);
  // Only the receipts of the empty week before stay listed: none of them reads the marked source.
  for (const id of brief.receiptIds) assert.ok(!(await engine.requestAs(accountant, 'receipts.get', { id })).sourceIds.includes(sourceId));
  assert.equal((await engine.request('reportsx.weekAhead', { onDate: '2026-09-08' })).changed.find((item: any) => item.id === 'net_sales').figure.exact, '112525');
  await engine.request('trustx.setSeatMarking', { seat: 'accountant', kind: 'financial', sees: true });
  const after = await engine.requestAs(accountant, 'reportsx.weekAhead', { onDate: '2026-09-08' });
  assert.equal(after.changed.find((item: any) => item.id === 'net_sales').figure.exact, '112525'); assert.deepEqual(after.gaps, []);
});

test('a derived file that cannot be removed keeps its record as pending for the deletion report', async t => {
  const { engine } = await fixture(t);
  const file = await engine.request('reportsx.export', { pack: 'ca', page: 'ageing', format: 'csv', period: september });
  const question = await engine.request('reportsx.askPerson', { question: 'Is this right?', reason: 'Not yet.', receiptId: (await engine.request('calculation.run', { operation: 'billed', period: september })).id });
  // A path with a NUL character is refused by every file system call, so its removal fails on every platform.
  const broken = `${file.path}\u0000broken`;
  await engine.vault!.update(state => { (state.extensions as any)['reports-tools-trust'].reports.pageExports[0].path = broken; });
  assert.deepEqual(pendingExportPaths(engine.vault!.read()), []);
  await engine.request('sources.delete', { id: sourceId });
  const reports = (engine.vault!.read().extensions as any)['reports-tools-trust'].reports;
  assert.equal(reports.pageExports.length, 1); assert.equal(reports.pageExports[0].removalFailed, true);
  assert.deepEqual(reports.questions, []); await assert.rejects(access(question.file.path));
  assert.deepEqual(pendingExportPaths(engine.vault!.read()), [broken]);
});

/** Every label on a printed figure is one of the canonical labels a screen shows. */
function line0Labels(page: any): string[] {
  const canonical = new Set(['seed', 'what-if', 'projection', 'from-outside', 'approximate', 'demo-clock', 'stale']);
  const labels = page.sections.flatMap((s: any) => s.lines.flatMap((l: any) => l.figure.labels ?? []));
  return labels.filter((label: string) => !canonical.has(label));
}
