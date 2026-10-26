// Ink v2 wave 4, package 4J4 (U11, P12): the month for the owner's CA. venture.money.export (inside the app, the owner's
// approval level) answers CSV text with only what a CA needs: the month's invoices, credit notes, cleared payments and
// costs, with their receipts and two receipted totals. Chausar never sends it; the owner saves it and shares it. Any
// cell that begins like a formula (=, +, -, @, a tab or a carriage return) is prefixed with an apostrophe so a
// spreadsheet shows it as text. The desktop saves it to a file the owner picks: a temporary file is written, flushed and
// renamed, and an existing file is replaced only when the owner chose to (EXPORT_EXISTS otherwise).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as fsp from 'node:fs/promises';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Context } from '../runtime/contracts.ts';
import { APP_ONLY_METHODS, METHOD_OWNERS, W4_METHOD_LEVELS, type MoneyExportFile, type SumReceiptRecord } from '../runtime/venture/contracts.ts';
import { VentureHost } from '../runtime/venture/host.ts';
import { csvCell } from '../runtime/venture/money/export.ts';
import { goalBusiness, invoice } from './venture-goals-helpers.ts';
import { bankCosts, foreignInvoice, foreignPayment, issueCredit } from './venture-money-env.ts';
import { code, owner, phone } from './venture-views-env.ts';

const require = createRequire(import.meta.url);
const saving = require('../../app/desktop/money-export.cjs');
const contract = require('../../app/desktop/ipc-contract.cjs');

/** RFC 4180 rows: quoted cells may hold commas, quotes (doubled) and line breaks. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { cell += '"'; index++; } else if (char === '"') quoted = false; else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(cell); cell = ''; }
    else if (char === '\r' && text[index + 1] === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; index++; }
    else cell += char;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const HEADER = ['Section', 'Date', 'Number', 'Party', 'Party tax ID', 'Place of supply', 'Description', 'Before tax', 'Tax', 'Total', 'Status', 'Method', 'TDS section', 'TDS', 'Receipt', 'Currency'];

/**
 * October 2026: INV-0001 to Cafe Aroma Demo on 5 Oct (1975000 before tax, 355500 GST, 2330500), INR 1,000.00 paid on
 * 20 Oct; INV-0002 to a client whose name begins with "=" on 6 Oct; a bank row of INR 1,500.00 out whose words begin
 * with "+"; a bill from a vendor whose name begins with "@" paid on 9 Oct (INR 500.00, no tax). A September invoice is
 * not in October's export.
 */
async function month() {
  const env = await goalBusiness();
  await invoice(env, '1', '2026-09-03');
  const aroma = await invoice(env, '1', '2026-10-05');
  await env.money('venture.payment.record', { invoiceId: aroma.invoice.id, amount: '1000.00', receivedOn: '2026-10-20', method: 'upi' });
  const risky = await env.money<{ id: string }>('venture.client.add', { name: '=HYPERLINK("http://evil.example","Pay")', countryCode: 'IN', stateCode: '27' });
  const order = await env.money<{ id: string }>('venture.order.create', { clientId: risky.id, offerId: 'offer_1', quantity: '1', request: 'Books.' });
  const draft = await env.money<{ invoice: { id: string; digest: string } }>('venture.invoice.prepare', { orderId: order.id, issueDate: '2026-10-06' });
  await env.money('venture.invoice.issue', { invoiceId: draft.invoice.id, digest: draft.invoice.digest });
  await bankCosts(env, ['2026-10-08,"+CASH, WITHDRAWAL",-1500.00,,90000.00']);
  const bill = await env.money<{ bill: { id: string } }>('venture.bills.add', { vendor: '@SUM(1+1)', billDate: '2026-10-01', dueDate: '2026-10-15', lines: [{ description: 'Stationery', amountMinor: '50000', taxName: '', taxRateBps: '0' }] });
  await env.money('venture.bills.pay', { billId: bill.bill.id, amountMinor: '50000', paidOn: '2026-10-09', method: 'upi' });
  return { env, aroma };
}

test('export: the month\'s invoices, payments and costs as CSV for the CA, with receipts and receipted totals', async () => {
  const { env, aroma } = await month();
  const file = await env.money<MoneyExportFile>('venture.money.export', { month: '2026-10' });
  assert.equal(file.fileName, 'ledger-cafe-books-2026-10-for-ca.csv');
  assert.ok(file.csv.startsWith('\uFEFF'), 'a byte order mark, so a spreadsheet reads the names as UTF-8');
  assert.ok(file.csv.endsWith('\r\n'));
  const rows = parseCsv(file.csv.slice(1));
  assert.deepEqual(rows[0], HEADER);
  assert.equal(file.rows, rows.length - 1);
  const section = (name: string) => rows.filter(row => row[0] === name);
  assert.deepEqual(section('Invoice').map(row => [row[1], row[2], row[7], row[8], row[9], row[10]]), [
    ['2026-10-05', 'INV-0002', '19750.00', '3555.00', '23305.00', 'Part paid'],
    ['2026-10-06', 'INV-0003', '19750.00', '3555.00', '23305.00', 'Issued'],
  ]);
  assert.equal(section('Invoice')[0][14], aroma.invoice.priceReceiptId);
  assert.deepEqual(section('Payment').map(row => [row[1], row[2], row[3], row[9], row[10], row[11]]), [['2026-10-20', 'INV-0002', 'Cafe Aroma Demo', '1000.00', 'Cleared', 'UPI']]);
  assert.deepEqual(section('Cost').map(row => [row[1], row[3], row[6], row[7], row[8], row[9], row[11]]), [
    ['2026-10-08', '', "'+CASH, WITHDRAWAL", '1500.00', '0.00', '1500.00', 'Bank statement'],
    ['2026-10-09', "'@SUM(1+1)", "Bill from @SUM(1+1)", '500.00', '0.00', '500.00', 'Bill paid'],
  ]);
  // Totals, each with its receipt: invoiced before tax 1975000 x 2 = 3950000; received 100000.
  const totals = section('Total');
  assert.deepEqual(totals.map(row => [row[6], row[7], row[9]]), [['Invoiced before tax, less credit notes', '39500.00', ''], ['Received, tax included', '', '1000.00']]);
  const invoiced = await env.money<SumReceiptRecord>('venture.receipt.get', { id: totals[0][14] });
  assert.equal(invoiced.totalMinor, '3950000');
  // Formula cells are text: the "=" client, the "+" bank words and the "@" vendor all begin with an apostrophe.
  assert.ok(rows.some(row => row[3] === `'=HYPERLINK("http://evil.example","Pay")`));
  // Text cells never begin like a formula; an amount column holds plain numbers, a minus kept where one belongs.
  for (const row of rows) row.forEach((cell, index) => assert.ok(!/^[=+\-@\t\r]/.test(cell) || ([7, 8, 9, 13].includes(index) && /^-\d+\.\d{2}$/.test(cell)), `cell ${cell}`));
  assert.equal(file.line, 'October 2026 for your CA: 2 invoices, 1 payment and 2 costs. Chausar does not send it; save it and share it yourself.');
  // Only what a CA needs: no client email, no request text.
  assert.ok(!file.csv.includes('owner@aroma.example') && !file.csv.includes('Close the month of books.'));
});

test('export is the owner\'s, inside the app, for one month', async () => {
  const { env } = await month();
  await assert.rejects(env.money('venture.money.export', { month: '2026-10' }, phone), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(env.money('venture.money.export', {}), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(env.money('venture.money.export', { month: 'October' }), code('INVALID_VENTURE_REQUEST'));
  const empty = await env.money<MoneyExportFile>('venture.money.export', { month: '2026-08' });
  assert.deepEqual([empty.rows, empty.line], [0, 'August 2026 for your CA: nothing was invoiced, paid or spent. Chausar does not send it; save it and share it yourself.']);
});

test('a month whose credit notes outweigh its invoices keeps the minus on its total; amounts are numbers, never text', async () => {
  const env = await goalBusiness();
  // A September invoice, credited 10% in October (233050 with tax; 233050 x 1975000 / 2330500 = 197500 before tax).
  const september = await invoice(env, '1', '2026-09-03');
  await issueCredit(env, september, '233050');
  const rows = parseCsv((await env.money<MoneyExportFile>('venture.money.export', { month: '2026-10' })).csv.slice(1));
  const credit = rows.find(row => row[0] === 'Credit note')!;
  assert.deepEqual([credit[7], credit[8], credit[9]], ['1975.00', '355.50', '2330.50']);
  const invoiced = rows.find(row => row[0] === 'Total' && row[6].startsWith('Invoiced'))!;
  assert.equal(invoiced[7], '-1975.00', 'October invoiced nothing and credited 197500 before tax: 0 - 197500');
  const receipt = await env.money<SumReceiptRecord>('venture.receipt.get', { id: invoiced[14] });
  assert.equal(receipt.totalMinor, '-197500');
});

test('money in another currency is listed in its own currency for the CA, and kept out of the totals, which say so', async () => {
  const { env, aroma } = await month();
  await foreignInvoice(env, aroma.invoice, { issueDate: '2026-10-12' });
  await foreignPayment(env, '2026-10-21');
  const rows = parseCsv((await env.money<MoneyExportFile>('venture.money.export', { month: '2026-10' })).csv.slice(1));
  const usd = rows.find(row => row[2] === 'USD-0001')!;
  assert.deepEqual([usd[0], usd[1], usd[7], usd[9], usd[15]], ['Invoice', '2026-10-12', '19750.00', '23305.00', 'USD']);
  assert.deepEqual(rows.filter(row => row[0] === 'Payment').map(row => [row[9], row[15]]), [['1000.00', 'INR'], ['1000.00', 'USD']]);
  assert.ok(rows.filter(row => ['Invoice', 'Payment', 'Cost'].includes(row[0])).every(row => row[15] !== ''), 'every money row names its currency');
  // The totals are in INR alone: 3950000 and 100000, as before; the USD rows are named and left out of them.
  assert.deepEqual(rows.filter(row => row[0] === 'Total').map(row => [row[7], row[9], row[15]]), [['39500.00', '', 'INR'], ['', '1000.00', 'INR']]);
  assert.deepEqual(rows.filter(row => row[0] === 'Not in totals').map(row => row[6]), [
    '1 invoice in another currency is listed in its own currency and left out of the totals: Chausar has no rate to INR.',
    '1 payment in another currency is listed in its own currency and left out of the totals: Chausar has no rate to INR.',
  ]);
});

test('through VentureHost: each 4J4 method\'s owner, level and app-only flag hold, and the export is the owner\'s inside the app', async () => {
  const { env } = await month();
  const methods = ['venture.money.aging', 'venture.money.flow', 'venture.money.cash', 'venture.money.margins', 'venture.money.export'] as const;
  for (const method of methods) assert.equal(METHOD_OWNERS[method], 'money', method);
  assert.deepEqual(methods.map(method => W4_METHOD_LEVELS[method]), ['read', 'read', 'read', 'read', 'approve']);
  assert.deepEqual(methods.filter(method => APP_ONLY_METHODS.includes(method)), ['venture.money.export']);
  await env.store.update(state => { state.members.push({ id: 'viewer', name: 'Viewer', role: 'viewer', active: true, epoch: 1, branches: ['*'] }); });
  const viewer: Context = { memberId: 'viewer', role: 'viewer', epoch: 1, channel: 'desktop' };
  const payloads: Record<(typeof methods)[number], unknown> = {
    'venture.money.aging': {}, 'venture.money.flow': {}, 'venture.money.cash': {}, 'venture.money.margins': { month: '2026-10' }, 'venture.money.export': { month: '2026-10' },
  };
  for (const host of ['test', 'hosted-web'] as const) {
    const engine = new VentureHost(env.store, env.deps.services, { demo: true, storage: 'experimental-file', clock: env.deps.clock, host, workspace: env.workspace });
    try {
      const web: Context = { ...owner, channel: 'web' };
      for (const method of methods) assert.ok(await engine.request(host === 'hosted-web' ? web : owner, method, payloads[method]), `${host} ${method}`);
      // The reads are open to any member and to the phone; the export is the owner's, inside the app.
      for (const method of methods.slice(0, 4)) assert.ok(await engine.request(viewer, method, payloads[method]), `viewer ${method}`);
      assert.ok(await engine.request(phone, 'venture.money.aging', {}));
      await assert.rejects(engine.request(phone, 'venture.money.export', payloads['venture.money.export']), code('APP_APPROVAL_REQUIRED'));
      await assert.rejects(engine.request({ ...owner, channel: 'mcp' } as Context, 'venture.money.export', payloads['venture.money.export']), code('APP_APPROVAL_REQUIRED'));
      await assert.rejects(engine.request(viewer, 'venture.money.export', payloads['venture.money.export']), code('FORBIDDEN'));
      const file = await engine.request(web, 'venture.money.export', payloads['venture.money.export']) as MoneyExportFile;
      assert.ok(file.csv.startsWith('\uFEFFSection,'), `${host}: the CSV comes back for the page to download`);
    } finally {
      engine.close();
    }
  }
});

test('csvCell prefixes every formula start and quotes what needs it', () => {
  assert.deepEqual(['=1+1', '+91 98', '-5', '@SUM(A1)', 'plain', ''].map(csvCell), ["'=1+1", "'+91 98", "'-5", "'@SUM(A1)", 'plain', '']);
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('\tTab'), "'\tTab");
  assert.equal(csvCell('\rReturn'), "\"'\rReturn\"");
  assert.equal(csvCell('two\nlines'), '"two\nlines"');
});

async function folder(run: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'chausar-export-'));
  try { await run(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

/** The real file system with some calls replaced, to reach the paths a real disk rarely takes. */
function fsWith(overrides: Record<string, (...args: any[]) => Promise<unknown>>) {
  return { ...fsp, ...overrides };
}

test('the desktop writes a temporary file and renames it over a target it reserved, and never replaces a file unless told to', async () => {
  await folder(async dir => {
    const target = join(dir, 'ledger-cafe-books-2026-10-for-ca.csv');
    await saving.writeAtomic(target, 'first\r\n');
    assert.equal(await readFile(target, 'utf8'), 'first\r\n');
    await assert.rejects(saving.writeAtomic(target, 'second\r\n'), (error: { code?: string }) => error.code === 'EXPORT_EXISTS');
    assert.equal(await readFile(target, 'utf8'), 'first\r\n', 'the old file is untouched');
    await saving.writeAtomic(target, 'second\r\n', { replace: true });
    assert.equal(await readFile(target, 'utf8'), 'second\r\n');
    assert.deepEqual(await readdir(dir), ['ledger-cafe-books-2026-10-for-ca.csv'], 'no temporary file is left behind');
  });
});

test('when the rename fails, the reserved name and the temporary file are both taken away, and the words name no path', async () => {
  await folder(async dir => {
    const target = join(dir, 'export.csv');
    const failing = fsWith({ rename: async () => { throw Object.assign(new Error(`EPERM: operation not permitted, rename '${dir}'`), { code: 'EPERM' }); } });
    await assert.rejects(saving.writeAtomic(target, 'text', { fs: failing }), (error: { code?: string; message?: string }) =>
      error.code === 'EXPORT_NOT_SAVED' && !error.message!.includes(dir) && /could not write/i.test(error.message!));
    assert.deepEqual(await readdir(dir), [], 'nothing is left: not the reserved name, not the temporary file');
    // A write that fails part way (the disk is full) leaves nothing either.
    const full = fsWith({ open: async (path: string, flags: string, mode?: number) => {
      const handle = await fsp.open(path, flags, mode);
      return path.endsWith('.tmp') ? Object.assign(Object.create(handle), { writeFile: async () => { throw Object.assign(new Error(`ENOSPC: no space left, write '${path}'`), { code: 'ENOSPC' }); }, close: () => handle.close() }) : handle;
    } });
    await assert.rejects(saving.writeAtomic(target, 'text', { fs: full }), (error: { code?: string; message?: string }) => error.code === 'EXPORT_NOT_SAVED' && /space/.test(error.message!) && !error.message!.includes(dir));
    assert.deepEqual(await readdir(dir), []);
  });
});

test('the save channel answers only the app\'s window, asks the engine for the month, and saves where the owner picked', async () => {
  await folder(async dir => {
    const contents: any = { mainFrame: { url: 'chausar://app/index.html' } };
    const window = { webContents: contents };
    const trusted = { sender: contents, senderFrame: contents.mainFrame };
    const asked: unknown[] = [];
    const engine = { request: async (method: string, payload: unknown) => { asked.push([method, payload]); return { fileName: 'ledger-cafe-books-2026-10-for-ca.csv', csv: '\uFEFFSection\r\n', rows: 0, line: 'x' }; } };
    let picked: string | null = join(dir, 'chosen.csv');
    const shown: any[] = [];
    const dialog = { showSaveDialog: async (_owner: unknown, options: any) => { shown.push(options); return picked ? { canceled: false, filePath: picked } : { canceled: true }; } };
    const deps = { dialog, window, engine, assertTrustedSender: contract.assertTrustedSender, publicError: contract.publicError, documents: dir };
    assert.equal(contract.MONEY_EXPORT_CHANNEL, 'chausar:money:saveExport');

    const refused = await saving.saveMoneyExport({ sender: {}, senderFrame: {} }, { month: '2026-10' }, deps);
    assert.deepEqual([refused.ok, refused.error.code], [false, 'UNTRUSTED_SENDER']);
    for (const input of [{ month: '2026-10', path: 'C:/Windows/x.csv' }, { month: '2026-10', replace: true }, { month: 'October' }]) {
      const bad = await saving.saveMoneyExport(trusted, input, deps);
      assert.deepEqual([bad.ok, bad.error.code], [false, 'INVALID_REQUEST'], JSON.stringify(input));
    }
    assert.deepEqual(asked, [], 'nothing was asked of the engine for a refused request');

    const saved = await saving.saveMoneyExport(trusted, { month: '2026-10' }, deps);
    assert.deepEqual(saved, { ok: true, result: { saved: true, name: 'chosen.csv', line: 'Saved chosen.csv for your CA. Chausar did not send it anywhere.' } });
    assert.deepEqual(asked, [['venture.money.export', { month: '2026-10' }]]);
    assert.equal(shown[0].defaultPath, join(dir, 'ledger-cafe-books-2026-10-for-ca.csv'));
    assert.ok(shown[0].properties.includes('showOverwriteConfirmation'), 'the system dialog asks before a file is replaced');
    assert.equal(await readFile(join(dir, 'chosen.csv'), 'utf8'), '\uFEFFSection\r\n');
    // The owner picked the same file again and the system dialog asked them: that is their choice to replace it.
    await writeFile(join(dir, 'chosen.csv'), 'old');
    assert.equal((await saving.saveMoneyExport(trusted, { month: '2026-10' }, deps)).ok, true);
    assert.equal(await readFile(join(dir, 'chosen.csv'), 'utf8'), '\uFEFFSection\r\n');
    // A file that appears under the picked name after the dialog closed is never written over.
    picked = join(dir, 'late.csv');
    const racing = { ...deps, fs: fsWith({ stat: async (path: string) => { if (path === picked) { await writeFile(path, 'someone else'); throw Object.assign(new Error('gone'), { code: 'ENOENT' }); } return fsp.stat(path); } }) };
    const late = await saving.saveMoneyExport(trusted, { month: '2026-10' }, racing);
    assert.deepEqual([late.ok, late.error.code], [false, 'EXPORT_EXISTS']);
    assert.equal(await readFile(join(dir, 'late.csv'), 'utf8'), 'someone else');
    // A folder Chausar may not write to: plain words, no path.
    picked = join(dir, 'locked.csv');
    const locked = { ...deps, fs: fsWith({ open: async () => { throw Object.assign(new Error(`EACCES: permission denied, open '${picked}'`), { code: 'EACCES' }); } }) };
    const denied = await saving.saveMoneyExport(trusted, { month: '2026-10' }, locked);
    assert.deepEqual([denied.ok, denied.error.code], [false, 'EXPORT_NOT_SAVED']);
    assert.ok(!denied.error.message.includes(dir) && /another folder/.test(denied.error.message), denied.error.message);
    picked = null;
    assert.deepEqual(await saving.saveMoneyExport(trusted, { month: '2026-10' }, deps), { ok: true, result: null }, 'cancelled: nothing written');
    assert.deepEqual((await readdir(dir)).sort(), ['chosen.csv', 'late.csv']);
  });
});

test('4J20: the desktop also saves the signed receipts beside the CSV, named from the picked file, so the CA can check them', async () => {
  await folder(async dir => {
    const contents: any = { mainFrame: { url: 'chausar://app/index.html' } };
    const trusted = { sender: contents, senderFrame: contents.mainFrame };
    const receipts = { format: 'chausar-signed-receipts/1', business: 'Ledger Cafe Books', algorithm: 'ed25519', publicKey: 'pk', keys: [], receipts: [] };
    const engine = { request: async () => ({ fileName: 'ledger-cafe-books-2026-10-for-ca.csv', csv: 'Section\r\n', rows: 0, line: 'x', receipts }) };
    const dialog = { showSaveDialog: async () => ({ canceled: false, filePath: join(dir, 'october.csv') }) };
    const deps = { dialog, window: { webContents: contents }, engine, assertTrustedSender: contract.assertTrustedSender, publicError: contract.publicError, documents: dir };
    const saved = await saving.saveMoneyExport(trusted, { month: '2026-10' }, deps);
    assert.deepEqual(saved, { ok: true, result: { saved: true, name: 'october.csv', receipts: 'october-receipts.json', line: 'Saved october.csv and october-receipts.json for your CA. Chausar did not send them anywhere.' } });
    assert.deepEqual(JSON.parse(await readFile(join(dir, 'october-receipts.json'), 'utf8')), receipts);
    assert.deepEqual((await readdir(dir)).sort(), ['october-receipts.json', 'october.csv']);
  });
});

test('4J20: both names are checked before either is written: a new CSV beside an old receipts file replaces it, and a failed receipts write leaves no CSV', async () => {
  await folder(async dir => {
    const contents: any = { mainFrame: { url: 'chausar://app/index.html' } };
    const trusted = { sender: contents, senderFrame: contents.mainFrame };
    const receipts = { format: 'chausar-signed-receipts/1', business: 'Ledger Cafe Books', algorithm: 'ed25519', publicKey: 'pk', keys: [], receipts: [] };
    const engine = { request: async () => ({ fileName: 'ledger-cafe-books-2026-10-for-ca.csv', csv: 'Section\r\n', rows: 0, line: 'x', receipts }) };
    const dialog = { showSaveDialog: async () => ({ canceled: false, filePath: join(dir, 'october.csv') }) };
    const deps = { dialog, window: { webContents: contents }, engine, assertTrustedSender: contract.assertTrustedSender, publicError: contract.publicError, documents: dir };

    // An old receipts file from an earlier export, and no CSV: the CSV is new, the old receipts carry the CSV's own name.
    await writeFile(join(dir, 'october-receipts.json'), '{"old":true}\n');
    const saved = await saving.saveMoneyExport(trusted, { month: '2026-10' }, deps);
    assert.equal(saved.ok, true, JSON.stringify(saved));
    assert.equal(saved.result.receipts, 'october-receipts.json');
    assert.deepEqual(JSON.parse(await readFile(join(dir, 'october-receipts.json'), 'utf8')), receipts);
    assert.equal(await readFile(join(dir, 'october.csv'), 'utf8'), 'Section\r\n');
    assert.deepEqual((await readdir(dir)).sort(), ['october-receipts.json', 'october.csv']);
  });

  await folder(async dir => {
    const contents: any = { mainFrame: { url: 'chausar://app/index.html' } };
    const trusted = { sender: contents, senderFrame: contents.mainFrame };
    const engine = { request: async () => ({ fileName: 'ledger-cafe-books-2026-10-for-ca.csv', csv: 'Section\r\n', rows: 0, line: 'x', receipts: { format: 'chausar-signed-receipts/1' } }) };
    const dialog = { showSaveDialog: async () => ({ canceled: false, filePath: join(dir, 'october.csv') }) };
    // The disk fills while the receipts are written: nothing is left behind, not the CSV, not a reserved name, no temp file.
    const full = fsWith({
      open: async (path: string, flags: string, mode?: number) => {
        if (String(path).includes('october-receipts.json') && String(path).endsWith('.tmp')) throw Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' });
        return fsp.open(path, flags, mode);
      },
    });
    const deps = { dialog, window: { webContents: contents }, engine, assertTrustedSender: contract.assertTrustedSender, publicError: contract.publicError, documents: dir, fs: full };
    const saved = await saving.saveMoneyExport(trusted, { month: '2026-10' }, deps);
    assert.equal(saved.ok, false);
    assert.equal(saved.error.code, 'EXPORT_NOT_SAVED');
    assert.deepEqual(await readdir(dir), []);
  });
});
