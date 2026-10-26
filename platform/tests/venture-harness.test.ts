// Delivery harness tests: the light sandbox and its row language, the container tier's honest checks, reading client
// files, the work calculator and the reconciliation, the business dictionary, the tools and their deny-by-default
// grants, the bounded agent loop, and when a draft may claim work. No network, no paid calls, no docker command:
// the container tier runs through an injected port.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { ChausarError } from '../runtime/contracts.ts';
import { numberGuard } from '../runtime/calculator.ts';
import { VENTURE_ERRORS } from '../runtime/venture/contracts.ts';
import type {
  ClaimProof, Deliverable, ScenarioKind, SandboxProcessRequest, SandboxProcessResponse, ToolName, VentureDeps,
} from '../runtime/venture/contracts.ts';
import { houseStyleFindings } from '../runtime/venture/records.ts';
import { interpretRow, parseRowProgram, ROW_LANGUAGE_GUIDE } from '../runtime/venture/delivery/harness/sandbox-lang.ts';
import { compileRowProgram } from '../runtime/venture/delivery/harness/sandbox-wasm.ts';
import {
  containerAvailability, DOCKER_IMAGE_MISSING, DOCKER_MISSING, DOCKER_READY, DOCKER_STOPPED, dockerRunArgs, HOSTED_NO_AGENT_CODE, HOSTED_NO_CONTAINERS,
  labelFinding, PYTHON_IMAGE, runPythonTransform, runRowProgram,
} from '../runtime/venture/delivery/harness/sandbox.ts';
import { amountCandidates, csvRows, dateCandidates, parseDateCell, parseMoneyCell } from '../runtime/venture/delivery/harness/cells.ts';
import { HOSTED_NO_PDF, pdfPages, sniffFormat, tablesOfFile, type FileLike, type SourceTable } from '../runtime/venture/delivery/harness/files.ts';
import { reconcileMonth, sumRows, totalsBy, type WorkEnv } from '../runtime/venture/delivery/harness/work.ts';
import { browse, manifest, resolve, type DictionaryEntry } from '../runtime/venture/delivery/harness/dictionary.ts';
import { callTool, hostRefusal, offeredTools, toolManifest, type ToolEnv } from '../runtime/venture/delivery/harness/tools.ts';
import { practiceFiles, PRACTICE_FILES } from '../runtime/venture/delivery/harness/practice.ts';
import {
  actTask, answerHandoff, applyTurn, compactHistory, DEFAULT_LIMITS, finishWrite, newHarnessState, provenSentences, REPORT_SECTIONS, validateTurn,
  writeTask,
} from '../runtime/venture/delivery/harness/loop.ts';
import { claimBacked, CLAIM_PROOFS } from '../runtime/venture/delivery/harness/claims.ts';
import { runChecks } from '../runtime/venture/delivery/checks.ts';
import { renderDeliverable } from '../runtime/venture/delivery/deliverable.ts';

const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected, error?.message); return true; };
const csv = (name: string, content: string, id = `upload_${name}`): FileLike => {
  const contentBase64 = Buffer.from(content, 'utf8').toString('base64');
  return { id, name, format: 'csv', bytes: Buffer.byteLength(content), digest: `digest-${id}-${content.length}`, contentBase64, clientData: true };
};
const table = (file: FileLike): SourceTable => tablesOfFile(file)[0];
const env: WorkEnv = { currency: 'INR', dateOrder: 'day-month-year', runRef: { kind: 'rehearsal', scenarioId: 'bookkeeping-clean', episode: 0 } };
const practice = (kind: ScenarioKind) => practiceFiles({ id: `bookkeeping-${kind}`, serviceType: 'bookkeeping', source: 'template' });

// ---------------------------------------------------------------------------
// 1. The row language and the light sandbox
// ---------------------------------------------------------------------------

test('row language: refuses numbers, unknown columns and names, and type mistakes, each with a plain reason', () => {
  const columns = ['Description', 'Amount'];
  const refused: [string, RegExp][] = [
    ['out total = 4500', /no numbers/],
    ['out x = col("Missing")', /no column "Missing"/],
    ['out x = lower(y)', /before a let/],
    ['out x = contains(col("Description"))', /two values/],
    ['out x = if col("Description") then "a" else "b"', /yes or no test/],
    ['out x = if contains(col("Description"), "a") then "a" else true', /same kind/],
    ['let a = "x"', /makes no column/],
    ['out a = "x"\nout a = "y"', /twice/],
    ['out x = sum(col("Amount"))', /no function called sum/],
    ['out x = "unterminated', /closing quote/],
    ['out x = col("Description") + col("Amount")', /not part of the row language/],
  ];
  for (const [source, reason] of refused) assert.throws(() => parseRowProgram(source, columns), (error: any) => error.code === 'PROGRAM_INVALID' && reason.test(error.message), source);
  assert.throws(() => parseRowProgram('x'.repeat(5000), columns), code('PROGRAM_INVALID'));
  assert.doesNotThrow(() => parseRowProgram('# comment only\nout ok = "yes" # trailing', columns));
  // The guide every agent gets says money stays with the calculator.
  assert.match(ROW_LANGUAGE_GUIDE, /totals always come from the calculator/);
});

test('row language: the WebAssembly module gives the same values as the reference interpreter, row by row', async () => {
  const rows = [
    { Description: '  NEFT/INV-0042/Bean Brothers Coffee ', Amount: '12,000.00' },
    { Description: 'UPI/Uber India/ride', Amount: '320.00' },
    { Description: 'AWS EMEA monthly', Amount: '1,200.00' },
    { Description: 'Café Aroma, milk ☕', Amount: '90.00' },
    { Description: '', Amount: '' },
    { Description: 'aaa', Amount: 'x' },
  ];
  const source = [
    'let d = lower(trim(col("Description")))',
    'out category = if contains(d, "aws") then "Software" else if contains(d, "uber") or contains(d, "ola") then "Travel" else "Other"',
    'out key = upper(before(after(d, "/"), "/"))',
    'out neft = starts(d, "neft") and not empty(d)',
    'out tidy = replace(replace(d, "/", " "), "a", "aa")',
    'out tail = after(d, "zzz")',
    'out joined = concat(d, "|", upper(col("Description")), "|", trim(col("Description")))',
    'out same = equals(d, "aws emea monthly") or ends(d, "ride")',
  ].join('\n');
  const program = parseRowProgram(source, ['Description', 'Amount']);
  const compiled = compileRowProgram(program, rows);
  const module = await WebAssembly.compile(compiled.bytes);
  assert.deepEqual(WebAssembly.Module.imports(module), [], 'a row program imports nothing');
  const instance = await WebAssembly.instantiate(module, {});
  assert.equal((instance.exports.run as () => number)(), 0);
  const memory = instance.exports.memory as WebAssembly.Memory;
  const view = new DataView(memory.buffer);
  const base = (instance.exports.out_table as WebAssembly.Global).value as number;
  const decoder = new TextDecoder();
  rows.forEach((row, r) => {
    const got: Record<string, string> = {};
    compiled.outputs.forEach((name, k) => {
      const packed = view.getBigUint64(base + (r * compiled.outputs.length + k) * 8, true);
      got[name] = decoder.decode(new Uint8Array(memory.buffer, Number(packed & 0xffffffffn), Number(packed >> 32n)));
    });
    assert.deepEqual(got, interpretRow(program, row), `row ${r}`);
  });
});

test('light sandbox: a row program runs in the isolated worker over many rows, and values that look like money are refused', async () => {
  const rows = Array.from({ length: 900 }, (_, i) => ({ Description: i % 3 ? 'UPI/Uber India/ride' : 'NEFT/INV-0042/Bean Brothers Coffee', Amount: '1.00' }));
  const program = parseRowProgram('let d = lower(col("Description"))\nout category = if contains(d, "uber") then "Travel" else "Supplies"\nout key = upper(before(after(d, "/"), "/"))', ['Description', 'Amount']);
  const run = await runRowProgram(program, rows);
  assert.equal(run.driver, 'wasm-lite');
  assert.equal(run.rows.length, 900);
  assert.deepEqual(run.columns, ['category', 'key']);
  assert.deepEqual(run.rows.slice(0, 2), [['Supplies', 'INV-0042'], ['Travel', 'UBER INDIA']]);
  assert.match(run.moduleDigest!, /^[a-f0-9]{64}$/);
  assert.ok(run.memoryPages >= 1 && run.memoryPages <= 256);
  // A program that copies an amount out is refused before anyone uses the value.
  await assert.rejects(runRowProgram(parseRowProgram('out amount = col("Amount")', ['Description', 'Amount']), rows.slice(0, 2)),
    (error: any) => error.code === 'SANDBOX_FAILED' && /looks like (a number|an amount)/.test(error.message));
  assert.equal(labelFinding('INV-0042'), null);
  assert.equal(labelFinding('Q3 supplies'), null);
  for (const value of ['4500', '4,500.00', '2026-09-14', 'Rs 40', '\u20b940', '12%', 'INR4500', 'Rs4500', 'INR4,500.00', '4500 USD', 'total EUR-12']) assert.notEqual(labelFinding(value), null, value);
  // A program that glues a currency code to an amount is refused too.
  await assert.rejects(runRowProgram(parseRowProgram('out amt = concat("INR", col("Amount"))', ['Description', 'Amount']), rows.slice(0, 2)),
    (error: any) => error.code === 'SANDBOX_FAILED' && /looks like an amount/.test(error.message));
});

// ---------------------------------------------------------------------------
// 2. The container tier: only where Docker is present, never a download
// ---------------------------------------------------------------------------

function dockerPort(state: 'missing' | 'stopped' | 'no-image' | 'ready', run?: (request: SandboxProcessRequest) => SandboxProcessResponse) {
  const seen: SandboxProcessRequest[] = [];
  const ok = (stdout: string): SandboxProcessResponse => ({ exitCode: 0, stdout, stderr: '', timedOut: false, truncated: false });
  const process = async (request: SandboxProcessRequest): Promise<SandboxProcessResponse> => {
    seen.push(request);
    assert.equal(request.command, 'docker');
    if (state === 'missing') throw new ChausarError('TIER_UNAVAILABLE', 'docker not found');
    if (request.args[0] === 'version') return state === 'stopped' ? { exitCode: 1, stdout: '', stderr: 'daemon down', timedOut: false, truncated: false } : ok('27.0.1');
    if (request.args[0] === 'image') return state === 'no-image' ? { exitCode: 1, stdout: '', stderr: 'No such image', timedOut: false, truncated: false } : ok('sha256:abc');
    assert.ok(run, 'no container run expected');
    return run(request);
  };
  return { ports: { process }, seen };
}

test('container tier: says needs setup when Docker is missing, stopped or without the image, and unverified when ready', async () => {
  assert.deepEqual(await containerAvailability(dockerPort('missing').ports), { state: 'needs-setup', reason: DOCKER_MISSING });
  assert.deepEqual(await containerAvailability(dockerPort('stopped').ports), { state: 'needs-setup', reason: DOCKER_STOPPED });
  assert.deepEqual(await containerAvailability(dockerPort('no-image').ports), { state: 'needs-setup', reason: DOCKER_IMAGE_MISSING });
  assert.deepEqual(await containerAvailability(dockerPort('ready').ports), { state: 'unverified', reason: DOCKER_READY });
  assert.match(DOCKER_IMAGE_MISSING, /never downloads/);
  // Python refuses before running anything when the tier is not ready.
  const missing = dockerPort('missing');
  await assert.rejects(runPythonTransform(missing.ports, 'def transform(row): return {}', []), (error: any) => error.code === 'TIER_UNAVAILABLE' && error.message === DOCKER_MISSING);
  const args = dockerRunArgs();
  for (const flag of ['--network', 'none', '--read-only', '--cap-drop', 'ALL', '--pids-limit', '--memory', '--security-opt', 'no-new-privileges']) assert.ok(args.includes(flag), flag);
  assert.ok(!args.includes('pull') && args.includes('--pull=never') && args.includes(PYTHON_IMAGE), 'never downloads, even if the image vanished after the check');
});

test('container tier: runs transform(row) with the code on stdin, checks the shape, and refuses amounts', async () => {
  const rows = [{ id: 'r1', cells: { Description: 'UPI/Uber India' } }, { id: 'r2', cells: { Description: 'AWS' } }];
  const good = dockerPort('ready', request => {
    assert.ok(!request.args.join(' ').includes('def transform'), 'the code never goes on the command line');
    const input = JSON.parse(request.stdin);
    assert.match(input.code, /def transform/);
    return { exitCode: 0, stdout: JSON.stringify({ rows: [{ category: 'Travel' }, { category: 'Software' }] }), stderr: '', timedOut: false, truncated: false };
  });
  const run = await runPythonTransform(good.ports, 'def transform(row):\n    return {"category": "Travel"}', rows);
  assert.equal(run.driver, 'docker');
  assert.deepEqual(run.rows, [['Travel'], ['Software']]);
  const money = dockerPort('ready', () => ({ exitCode: 0, stdout: JSON.stringify({ rows: [{ total: '4500' }, { total: '320' }] }), stderr: '', timedOut: false, truncated: false }));
  await assert.rejects(runPythonTransform(money.ports, 'def transform(row): return {"total": "4500"}', rows), (error: any) => error.code === 'SANDBOX_FAILED' && /looks like (a number|an amount)/.test(error.message));
  const glued = dockerPort('ready', () => ({ exitCode: 0, stdout: JSON.stringify({ rows: [{ amt: 'INR5310.0' }, { amt: 'INR320.0' }] }), stderr: '', timedOut: false, truncated: false }));
  await assert.rejects(runPythonTransform(glued.ports, 'def transform(row): return {"amt": "INR" + str(float(1))}', rows), (error: any) => /looks like an amount/.test(error.message));
  const broken = dockerPort('ready', () => ({ exitCode: 1, stdout: '', stderr: 'SystemExit: NO_TRANSFORM', timedOut: false, truncated: false }));
  await assert.rejects(runPythonTransform(broken.ports, 'x = 1', rows), (error: any) => /transform\(row\)/.test(error.message));
  const slow = dockerPort('ready', () => ({ exitCode: null, stdout: '', stderr: '', timedOut: true, truncated: false }));
  await assert.rejects(runPythonTransform(slow.ports, 'def transform(row): pass', rows), (error: any) => /time limit/.test(error.message));
});

// ---------------------------------------------------------------------------
// 3. Reading client files
// ---------------------------------------------------------------------------

test('cells: amounts become exact minor units and dates follow the country, or they are refused', () => {
  const money = (raw: string, currency = 'INR') => { const parsed = parseMoneyCell(raw, currency); return parsed.ok ? parsed.minor : `refused: ${parsed.why}`; };
  assert.equal(money('4,500.00'), '450000');
  assert.equal(money('1,23,456.78'), '12345678');
  assert.equal(money('(250.50)'), '-25050');
  assert.equal(money('Rs. 1,000'), '100000');
  assert.equal(money('₹ 99.5'), '9950');
  assert.equal(money('-12'), '-1200');
  assert.equal(money('500 Cr'), '-50000');
  assert.equal(money('500 Dr'), '50000');
  assert.equal(money(''), null);
  assert.equal(money('1,500', 'JPY'), '1500');
  assert.match(String(money('12.345')), /refused: has more decimals/);
  assert.match(String(money('12 rupees')), /refused/);
  assert.match(String(money('1e5')), /refused/);
  // Another currency's mark is refused, never read as rupees; only the business's own marks pass.
  assert.equal(money('USD 12.00'), 'refused: is in another currency');
  assert.equal(money('$12'), 'refused: is in another currency');
  assert.equal(money('Ref 123'), 'refused: is not an amount');
  assert.equal(money('INR 12'), '1200');
  assert.equal(money('US$ 3.50', 'USD'), '350');
  assert.equal(money('$1,200.50', 'USD'), '120050');
  assert.equal(money('\u20b9 5', 'USD'), 'refused: is in another currency');
  assert.equal(parseDateCell('2026-09-14', 'day-month-year'), '2026-09-14');
  assert.equal(parseDateCell('03/04/2026', 'day-month-year'), '2026-04-03');
  assert.equal(parseDateCell('03/04/2026', 'month-day-year'), '2026-03-04');
  assert.equal(parseDateCell('30 Sep 2026', 'month-day-year'), '2026-09-30');
  assert.equal(parseDateCell('Sep 30, 2026', 'day-month-year'), '2026-09-30');
  assert.equal(parseDateCell('31/02/2026', 'day-month-year'), null);
  assert.equal(parseDateCell('14/09/26', 'day-month-year'), null);
  const page = 'Bill FF-0901 dated 1 Sep 2026\nPhone 9876543210\nSubtotal 3,813.56\nTotal INR 4,500.00';
  assert.deepEqual(amountCandidates(page, 'INR').map(item => [item.text, item.minor]), [['3,813.56', '381356'], ['INR 4,500.00', '450000']]);
  assert.deepEqual(dateCandidates(page, 'day-month-year').map(item => item.iso), ['2026-09-01']);
  assert.deepEqual(csvRows('a,"b,c"\r\n"x ""y""",2\n\n'), [['a', 'b,c'], ['x "y"', '2']]);
});

function storedZip(files: { name: string; text: string }[]): Buffer {
  const crc = (bytes: Buffer) => { let value = -1; for (const byte of bytes) { value ^= byte; for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0); } return (value ^ -1) >>> 0; };
  const body: Buffer[] = [], directory: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name), bytes = Buffer.from(file.text), sum = crc(bytes);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt32LE(sum, 14); local.writeUInt32LE(bytes.length, 18); local.writeUInt32LE(bytes.length, 22); local.writeUInt16LE(name.length, 26);
    const record = Buffer.alloc(46); record.writeUInt32LE(0x02014b50, 0); record.writeUInt16LE(0x0314, 4); record.writeUInt16LE(20, 6); record.writeUInt32LE(sum, 16); record.writeUInt32LE(bytes.length, 20); record.writeUInt32LE(bytes.length, 24); record.writeUInt16LE(name.length, 28); record.writeUInt32LE((0x81a4 * 65536) >>> 0, 38); record.writeUInt32LE(offset, 42);
    body.push(local, name, bytes); directory.push(record, name); offset += local.length + name.length + bytes.length;
  }
  const central = Buffer.concat(directory);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...body, central, end]);
}

/** A two-sheet bill register: an empty Notes sheet and a Bills sheet. */
function billWorkbook(): Buffer {
  const cell = (ref: string, value: string) => `<c r="${ref}" t="inlineStr"><is><t>${value}</t></is></c>`;
  const rows = [['Supplier', 'Amount', 'Supplier'], ['Fresh Farms Dairy', '4,500.00', 'x'], ['Shree Estates', '25,000.00', 'y']];
  const sheet = `<worksheet><sheetData>${rows.map((row, r) => `<row r="${r + 1}">${row.map((value, c) => cell(`${'ABC'[c]}${r + 1}`, value)).join('')}</row>`).join('')}</sheetData></worksheet>`;
  return storedZip([
    { name: '[Content_Types].xml', text: '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>' },
    { name: '_rels/.rels', text: '<Relationships><Relationship Id="book" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: 'xl/workbook.xml', text: '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Notes" sheetId="1" r:id="notes"/><sheet name="Bills" sheetId="2" r:id="bills"/></sheets></workbook>' },
    { name: 'xl/_rels/workbook.xml.rels', text: '<Relationships><Relationship Id="notes" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="bills" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>' },
    { name: 'xl/worksheets/sheet1.xml', text: '<worksheet><sheetData></sheetData></worksheet>' },
    { name: 'xl/worksheets/sheet2.xml', text: sheet },
  ]);
}

test('files: formats are checked against their content; CSV and XLSX become tables with row ids and named columns', () => {
  assert.equal(sniffFormat('bank.csv', Buffer.from('a,b')), 'csv');
  assert.equal(sniffFormat('bill.pdf', Buffer.from('%PDF-1.7')), 'pdf');
  assert.throws(() => sniffFormat('bill.pdf', Buffer.from('nope')), code('UNSUPPORTED_UPLOAD'));
  assert.throws(() => sniffFormat('photo.jpg', Buffer.from([0xff, 0xd8])), code('UNSUPPORTED_UPLOAD'));
  assert.throws(() => sniffFormat('bank.csv', Buffer.from([0xff, 0xfe, 0x00])), code('UNSUPPORTED_UPLOAD'));
  const messy = table(csv('messy.csv', 'Date,,Date\n\n2026-09-01,x,y\n,,\n2026-09-02,z'));
  assert.deepEqual(messy.columns, ['Date', 'Column 2', 'Date (2)']);
  assert.deepEqual(messy.rows.map(row => row.id), ['r1', 'r2']);
  assert.deepEqual(messy.rows[1].cells, { Date: '2026-09-02', 'Column 2': 'z', 'Date (2)': '' });
  const workbook: FileLike = { id: 'upload_xlsx', name: 'bills.xlsx', format: 'xlsx', bytes: 1, digest: 'xlsx-digest', contentBase64: billWorkbook().toString('base64'), clientData: true };
  const sheets = tablesOfFile(workbook);
  assert.deepEqual(sheets.map(sheet => [sheet.id, sheet.name]), [['upload_xlsx.s2', 'bills.xlsx (Bills)']], 'empty sheets are left out');
  assert.deepEqual(sheets[0].columns, ['Supplier', 'Amount', 'Supplier (2)']);
  assert.equal(sheets[0].rows[1].cells.Amount, '25,000.00');
});

// ---------------------------------------------------------------------------
// 4. The work calculator and the reconciliation
// ---------------------------------------------------------------------------

test('work calculator: sums and group totals are BigInt over cells code read, with receipts the number guard accepts', () => {
  const bills = table(practice('clean')[1]);
  const all = sumRows(env, bills, 'Amount', null);
  // 4500 + 12000 + 6320 + 25000 + 4500 = 52320.00
  assert.deepEqual(all.figures.map(figure => [figure.key, figure.minor, figure.display]), [['total', '5232000', 'INR 52,320.00'], ['rows', '5', '5']]);
  assert.equal(all.steps[0].result, '5232000');
  assert.doesNotThrow(() => numberGuard(all.explanation, all));
  const dairy = sumRows(env, bills, 'Amount', { column: 'Supplier', equals: 'Fresh Farms Dairy' });
  assert.equal(dairy.figures[0].minor, '900000');
  assert.deepEqual(dairy.inputs.rowIds, ['r1', 'r5']);
  assert.throws(() => sumRows(env, bills, 'Total', null), (error: any) => error.code === 'TOOL_FAILED' && /no column "Total"/.test(error.message));
  // Groups from a table a row program made, joined by row id.
  const groups: SourceTable = { id: 't', name: 'groups', columns: ['kind'], kind: 'work', uploadId: null, digest: 'd', origin: 'transform', madeFrom: bills.id, rows: bills.rows.map(row => ({ id: row.id, cells: { kind: /Dairy|Coffee/.test(row.cells.Supplier) ? 'Supplies' : 'Overheads' } })) };
  const byKind = totalsBy(env, bills, 'Amount', groups, 'kind');
  assert.deepEqual(byKind.figures.map(figure => [figure.key, figure.label, figure.minor]), [['group-1', 'Overheads', '3132000'], ['group-2', 'Supplies', '2100000'], ['total', 'Total of Amount', '5232000']]);
  const badGroups = { ...groups, rows: groups.rows.map(row => ({ id: row.id, cells: { kind: '4500' } })) };
  assert.throws(() => totalsBy(env, bills, 'Amount', badGroups, 'kind'), (error: any) => /looks like (a number|an amount)/.test(error.message));
  const notMoney = table(csv('bad.csv', 'Amount\n12 rupees'));
  assert.throws(() => sumRows(env, notMoney, 'Amount', null), (error: any) => /row r1, the Amount cell is not an amount/.test(error.message));
});

test('reconciliation: the clean practice month balances and every payment matches a bill', () => {
  const [bank, bills] = practice('clean').map(table);
  const receipt = reconcileMonth(env, {
    bank, bankColumns: { date: 'Date', description: 'Narration', moneyOut: 'Withdrawal', moneyIn: 'Deposit', balance: 'Balance' },
    bills: [{ table: bills, columns: { vendor: 'Supplier', amount: 'Amount', date: 'Bill date', number: 'Bill number' } }],
  });
  const figure = (key: string) => receipt.figures.find(item => item.key === key)!.minor;
  // Opening 50,000.00 + in 80,050.00 - out 52,320.00 = 77,730.00, the statement's own closing balance.
  assert.deepEqual(['opening', 'money-in', 'money-out', 'computed-closing', 'statement-closing', 'difference'].map(figure), ['5000000', '8005000', '5232000', '7773000', '7773000', '0']);
  const rec = receipt.reconciliation!;
  assert.equal(rec.balanced, true);
  assert.equal(rec.statementClosing, true);
  assert.deepEqual(rec.matched.map(item => [item.bankRowId, item.billRowId, item.rule]), [
    ['r3', 'r2', 'bill-number'], ['r2', 'r1', 'amount-and-name'], ['r5', 'r3', 'amount-and-name'], ['r6', 'r4', 'amount-and-name'], ['r8', 'r5', 'amount-and-name'],
  ]);
  assert.deepEqual([rec.unmatchedBank, rec.unmatchedBills], [[], []]);
  assert.deepEqual(rec.moneyIn.map(item => item.rowId), ['r4', 'r7']);
  assert.doesNotThrow(() => numberGuard(receipt.explanation, receipt));
  assert.match(receipt.digest, /^[a-f0-9]{64}$/);
});

test('reconciliation: the messy month is read newest row last, and the gaps are listed with their amounts', () => {
  const [bank, bills] = practice('messy').map(table);
  const receipt = reconcileMonth(env, {
    bank, bankColumns: { date: 'Txn Date', description: 'Description', moneyOut: 'Debit', moneyIn: 'Credit', balance: 'Balance' },
    bills: [{ table: bills, columns: { vendor: 'Vendor', amount: 'Total', date: 'Date', number: 'Ref' } }],
  });
  const rec = receipt.reconciliation!;
  assert.ok(receipt.steps.some(step => step.result === 'reversed'));
  assert.equal(rec.balanced, true);
  assert.deepEqual(rec.matched.map(item => item.rule).sort(), ['amount-and-name', 'amount-and-name', 'bill-number']);
  assert.deepEqual(rec.unmatchedBank.map(item => [item.rowId, item.text, item.display, item.date]), [
    ['r4', 'UPI/Quick Print Shop/flyers', 'INR 2,750.00', '2026-09-12'], ['r2', 'ATM cash withdrawal', 'INR 5,000.00', '2026-09-22'],
  ]);
  assert.deepEqual(rec.unmatchedBills.map(item => [item.text, item.display]), [['Kiran Electricals KE-118', 'INR 3,400.00']]);
  assert.equal(receipt.figures.find(item => item.key === 'unmatched-bank')!.minor, '775000');
});

test('reconciliation: a statement with no balance column is not called balanced, and a broken balance shows its difference', () => {
  const bills = table(csv('bills.csv', 'Supplier,Amount\nShree Estates,"25,000.00"'));
  const noBalance = table(csv('nobal.csv', 'Narration,Amount\nIMPS/Shree Estates rent,"-25,000.00"\nCard sales,"1,000.00"'));
  const plain = reconcileMonth(env, { bank: noBalance, bankColumns: { description: 'Narration', amount: 'Amount' }, bills: [{ table: bills, columns: { vendor: 'Supplier', amount: 'Amount' } }] });
  assert.deepEqual([plain.reconciliation!.balanced, plain.reconciliation!.statementClosing, plain.reconciliation!.matched.length], [false, false, 1]);
  assert.ok(!plain.figures.some(figure => figure.key === 'difference'));
  const broken = table(csv('broken.csv', 'Narration,Out,In,Balance\nOpening,,,"1,000.00"\nRent,"100.00",,"900.00"\nSales,,"50.00","990.00"'));
  const off = reconcileMonth(env, { bank: broken, bankColumns: { description: 'Narration', moneyOut: 'Out', moneyIn: 'In', balance: 'Balance' }, bills: [{ table: bills, columns: { vendor: 'Supplier', amount: 'Amount' } }] });
  assert.equal(off.reconciliation!.balanced, false);
  assert.equal(off.figures.find(figure => figure.key === 'difference')!.minor, '4000');
  assert.ok(off.steps.some(step => /breaks at row r3/.test(step.rule)));
  assert.throws(() => reconcileMonth(env, { bank: broken, bankColumns: { description: 'Narration', moneyOut: 'Out', moneyIn: 'In', amount: 'Balance' }, bills: [{ table: bills, columns: { vendor: 'Supplier', amount: 'Amount' } }] }), code('TOOL_FAILED'));
});

// ---------------------------------------------------------------------------
// 5. The business dictionary
// ---------------------------------------------------------------------------

test('dictionary: browse ranks by words with a phrase bonus, resolve says when nothing matches, and the manifest is short', () => {
  const entries: DictionaryEntry[] = [
    { id: 'term.client', kind: 'term', name: 'Client', meaning: 'A cafe or shop that pays for the monthly books.', aliases: [] },
    { id: 'concept.reconciliation', kind: 'concept', name: 'Reconciliation', meaning: 'Checking a bank statement against bills.', aliases: ['month end'] },
    { id: 'offer.offer_1', kind: 'offer', name: 'Monthly books', meaning: 'Bank matching and a monthly report.', aliases: [] },
  ];
  assert.deepEqual(browse(entries, 'month end', null).map(entry => entry.id), ['concept.reconciliation']);
  // A name match outranks a meaning match: the offer is named Monthly, the client's meaning only mentions it.
  assert.deepEqual(browse(entries, 'monthly', null).map(entry => entry.id), ['offer.offer_1', 'term.client']);
  assert.deepEqual(browse(entries, 'books', 'offer').map(entry => entry.id), ['offer.offer_1']);
  assert.deepEqual(browse(entries, 'zebra', null), []);
  assert.deepEqual(resolve(entries, ['client', 'payroll']).map(item => item.entry?.id ?? null), ['term.client', null]);
  const text = manifest(entries);
  assert.ok(text.length < 400);
  assert.match(text, /dictionary\.browse/);
  assert.doesNotMatch(text, /\d/);
});

// ---------------------------------------------------------------------------
// 6. Tools: envelopes, deny by default, proofs
// ---------------------------------------------------------------------------

function toolEnv(files: FileLike[], extra: Partial<ToolEnv> = {}): ToolEnv {
  return {
    deps: { services: {} } as unknown as VentureDeps, ventureId: 'venture_1', memberId: 'owner', epoch: 1, currency: 'INR', dateOrder: 'day-month-year',
    runRef: { kind: 'rehearsal', scenarioId: 'bookkeeping-clean', episode: 0 }, files, tables: [], receipts: [],
    dictionary: [{ id: 'term.client', kind: 'term', name: 'Client', meaning: 'A cafe that pays for the books.', aliases: [] }],
    sandbox: undefined, now: () => '2026-10-16T10:00:00.000Z', allowed: [], ...extra,
  };
}
const ALL: ToolName[] = ['files.list', 'files.read', 'dictionary.browse', 'dictionary.resolve', 'calc.sum', 'calc.totals', 'books.reconcile', 'bills.pick', 'sandbox.transform', 'sandbox.python', 'handoff.client', 'handoff.owner'];
const call = (env: ToolEnv, grant: readonly ToolName[], tool: string, input: unknown, index = 0) =>
  callTool(env, grant, 1, index, { tool, input: typeof input === 'string' ? input : JSON.stringify(input) });

test('tools: deny by default, and every refusal is an envelope with a code, a name and a message', async () => {
  const env = toolEnv(practice('clean'));
  const denied = await call(env, ['files.list'], 'calc.sum', { table: 'f2', amountColumn: 'Amount' });
  assert.deepEqual(denied.record.envelope, { ok: false, error: { code: 'TOOL_DENIED', name: 'ToolDenied', message: 'calc.sum is not granted to this agent. Use only the tools you were given.' } });
  assert.equal(denied.record.outcome, 'failed');
  assert.deepEqual(denied.receipts, []);
  assert.equal((await call(env, ALL, 'inbox.read', {})).record.envelope.ok, false);
  const badJson = await call(env, ALL, 'files.read', '{target:');
  assert.equal(!badJson.record.envelope.ok && badJson.record.envelope.error.code, 'TOOL_INPUT_INVALID');
  const unknownField = await call(env, ALL, 'files.read', { target: 'f1', part: 'sample', shell: 'rm -rf' });
  assert.match(!unknownField.record.envelope.ok ? unknownField.record.envelope.error.message : '', /unknown field shell/);
  const badChoice = await call(env, ALL, 'files.read', { target: 'f1', part: 'everything' });
  assert.match(!badChoice.record.envelope.ok ? badChoice.record.envelope.error.message : '', /must be one of/);
  const noTable = await call(env, ALL, 'files.read', { target: 'f9', part: 'sample' });
  assert.match(!noTable.record.envelope.ok ? noTable.record.envelope.error.message : '', /no file "f9"/);
  // The outside-write tool is never granted by a playbook; even when a test grants it, it only records.
  const proposed = await call(env, ['outbox.propose'], 'outbox.propose', { connector: 'mail-app', summary: 'Send the September report' });
  assert.equal(proposed.record.effect, 'outside-write');
  assert.deepEqual(proposed.record.envelope.ok && proposed.record.envelope.result, { recorded: true, sent: false, note: 'Nothing was sent. The owner approves and sends outside actions; this build only records them.' });
  assert.equal(proposed.mock?.connector, 'mail-app');
  // The manifest lists only granted tools.
  assert.deepEqual((toolManifest(['files.read', 'handoff.client']) as { tool: string }[]).map(item => item.tool), ['files.read', 'handoff.client']);
});

test('tools: reading, the calculator, a row program and a reconciliation each leave a proof and a receipt or table', async () => {
  const env = toolEnv(practice('clean'));
  const listed = await call(env, ALL, 'files.list', {});
  assert.ok(listed.record.envelope.ok);
  const sample = await call(env, ALL, 'files.read', { target: 'f1', part: 'sample' });
  assert.ok(sample.record.envelope.ok && (sample.record.envelope.result as any).sample.length === 5);
  assert.deepEqual(sample.proofs.map(proof => proof.kind), ['file-read']);
  const summed = await call(env, ALL, 'calc.sum', { table: 'f2', amountColumn: 'Amount' });
  assert.ok(summed.record.envelope.ok);
  assert.deepEqual((summed.record.envelope.result as any).figures[0], { ref: 'w1.total', label: 'Total of Amount', value: 'INR 52,320.00' });
  assert.equal(summed.receipts.length, 1);
  assert.equal(summed.record.receiptIds[0], summed.receipts[0].id);
  const program = 'let d = lower(col("Supplier"))\nout kind = if contains(d, "dairy") or contains(d, "coffee") then "Supplies" else "Overheads"';
  const transformed = await call(env, ALL, 'sandbox.transform', { table: 'f2', program });
  assert.ok(transformed.record.envelope.ok, JSON.stringify(transformed.record.envelope));
  assert.equal(transformed.record.tier, 'wasm-lite');
  assert.deepEqual(transformed.tables[0].rows.map(row => row.id), ['r1', 'r2', 'r3', 'r4', 'r5']);
  assert.deepEqual(transformed.proofs.map(proof => proof.kind), ['transformed']);
  const totals = await call(env, ALL, 'calc.totals', { table: 'f2', amountColumn: 'Amount', groupTable: 't1', groupColumn: 'kind' });
  assert.ok(totals.record.envelope.ok, JSON.stringify(totals.record.envelope));
  assert.deepEqual((totals.record.envelope.result as any).figures.map((figure: any) => figure.ref), ['w2.group-1', 'w2.group-2', 'w2.total']);
  const reconciled = await call(env, ALL, 'books.reconcile', {
    bank: 'f1', date: 'Date', description: 'Narration', moneyOut: 'Withdrawal', moneyIn: 'Deposit', balance: 'Balance',
    bills: [{ table: 'f2', vendor: 'Supplier', amount: 'Amount', number: 'Bill number' }],
  });
  assert.ok(reconciled.record.envelope.ok, JSON.stringify(reconciled.record.envelope));
  assert.deepEqual(reconciled.proofs.map(proof => proof.kind), ['reconciled', 'matched', 'balanced']);
  assert.equal((reconciled.record.envelope.result as any).receipt, 'w3');
  // A failed call leaves nothing half made.
  const failed = await call(env, ALL, 'calc.sum', { table: 'f2', amountColumn: 'Nope' });
  assert.equal(failed.record.envelope.ok, false);
  assert.equal(env.receipts.length, 3);
});

test('tools: PDFs are read through the Python helper with amounts to pick by id, and refuse honestly without it', async () => {
  const pdf: FileLike = { id: 'upload_pdf', name: 'bill.pdf', format: 'pdf', bytes: 10, digest: 'pdf-digest-1', contentBase64: Buffer.from('%PDF-1.7 synthetic').toString('base64'), clientData: true };
  const asked: unknown[] = [];
  const helper = { async run(operation: 'pdf.extract', input: { pdfBase64: string }) { asked.push([operation, input.pdfBase64.length > 0]); return { result: { pages: [{ page: 1, text: 'Fresh Farms Dairy\nBill FF-0901 dated 1 Sep 2026\nTotal INR 4,500.00' }], coverage: 'Text extraction only.' }, receipt: {} }; } };
  const env = toolEnv([pdf], { deps: { services: { helper } } as unknown as VentureDeps });
  const read = await call(env, ALL, 'files.read', { target: 'f1', part: 'pages' });
  assert.ok(read.record.envelope.ok, JSON.stringify(read.record.envelope));
  const result = read.record.envelope.result as any;
  assert.deepEqual(result.amounts, [{ id: 'a1', text: 'INR 4,500.00', line: 'Total INR 4,500.00' }]);
  assert.equal(result.dates[0].id, 'd1');
  const picked = await call(env, ALL, 'bills.pick', { picks: [{ file: 'f1', amount: 'a1', date: 'd1', supplier: 'Fresh Farms Dairy', number: 'FF-0901' }] });
  assert.ok(picked.record.envelope.ok, JSON.stringify(picked.record.envelope));
  assert.deepEqual(picked.tables[0].rows[0].cells, { Supplier: 'Fresh Farms Dairy', 'Bill number': 'FF-0901', 'Bill date': '2026-09-01', Amount: 'INR 4,500.00', File: 'f1' });
  const amountAsName = await call(env, ALL, 'bills.pick', { picks: [{ file: 'f1', amount: 'a1', supplier: '4500' }] });
  assert.match(!amountAsName.record.envelope.ok ? amountAsName.record.envelope.error.message : '', /looks like (a number|an amount)/);
  assert.deepEqual(asked, [['pdf.extract', true]], 'the text is read once and kept by digest');
  const noHelper = await call(toolEnv([{ ...pdf, digest: 'pdf-digest-2' }]), ALL, 'files.read', { target: 'f1', part: 'pages' });
  assert.match(!noHelper.record.envelope.ok ? noHelper.record.envelope.error.message : '', /Python helper/);
});

test('tools on the hosted server: row programs, Python, containers and PDFs are refused before anything starts, and are not offered', async () => {
  const dockerCalls: SandboxProcessRequest[] = [];
  const docker = async (request: SandboxProcessRequest): Promise<SandboxProcessResponse> => { dockerCalls.push(request); return { exitCode: 0, stdout: '28.0.0', stderr: '', timedOut: false, truncated: false }; };
  const helperCalls: unknown[] = [];
  const helper = { async run(operation: 'pdf.extract') { helperCalls.push(operation); return { result: { pages: [{ page: 1, text: 'Total INR 4,500.00' }] }, receipt: {} }; } };
  const pdf: FileLike = { id: 'upload_pdf_hosted', name: 'bill.pdf', format: 'pdf', bytes: 10, digest: 'pdf-digest-hosted', contentBase64: Buffer.from('%PDF-1.7 synthetic').toString('base64'), clientData: true };
  const hostedDeps = { host: 'hosted-web', services: { helper } } as unknown as VentureDeps;
  const env = toolEnv([...practice('clean').slice(0, 2), pdf], { deps: hostedDeps, sandbox: { process: docker } });
  const refusal = (outcome: Awaited<ReturnType<typeof callTool>>) => outcome.record.envelope.ok ? null : outcome.record.envelope.error;

  const program = await call(env, ALL, 'sandbox.transform', { table: 'f2', program: 'out kind = "Supplies"' });
  assert.deepEqual(refusal(program), { code: 'TIER_UNAVAILABLE', name: 'TierUnavailable', message: HOSTED_NO_AGENT_CODE });
  assert.equal(program.record.tier, 'wasm-lite');
  assert.equal(program.record.input, null, 'refused before its input is read');
  assert.deepEqual(program.tables, []);
  const python = await call(env, ALL, 'sandbox.python', { table: 'f2', code: 'def transform(row):\n    return {"kind": "x"}' });
  assert.deepEqual(refusal(python), { code: 'TIER_UNAVAILABLE', name: 'TierUnavailable', message: HOSTED_NO_CONTAINERS });
  const picked = await call(env, ALL, 'bills.pick', { picks: [{ file: 'f3', amount: 'a1', supplier: 'Fresh Farms Dairy' }] });
  assert.deepEqual(refusal(picked), { code: 'TIER_UNAVAILABLE', name: 'TierUnavailable', message: HOSTED_NO_PDF });
  const pages = await call(env, ALL, 'files.read', { target: 'f3', part: 'pages' });
  assert.deepEqual(refusal(pages), { code: 'TIER_UNAVAILABLE', name: 'TierUnavailable', message: HOSTED_NO_PDF });
  await assert.rejects(pdfPages(hostedDeps, pdf), code('TIER_UNAVAILABLE'));
  assert.deepEqual(dockerCalls, [], 'no Docker check and no container');
  assert.deepEqual(helperCalls, [], 'the Python helper never runs');

  // Reading CSV and the calculator still work: the reconciled month needs no sandbox.
  const reconciled = await call(env, ALL, 'books.reconcile', {
    bank: 'f1', date: 'Date', description: 'Narration', moneyOut: 'Withdrawal', moneyIn: 'Deposit', balance: 'Balance',
    bills: [{ table: 'f2', vendor: 'Supplier', amount: 'Amount', number: 'Bill number' }],
  });
  assert.ok(reconciled.record.envelope.ok, JSON.stringify(reconciled.record.envelope));
  assert.deepEqual(reconciled.proofs.map(proof => proof.kind), ['reconciled', 'matched', 'balanced']);

  // What the agent is offered follows the host; the grant itself does not change.
  assert.deepEqual(hostRefusal('hosted-web', 'files.read'), null);
  assert.deepEqual(offeredTools(ALL, 'hosted-web'), ALL.filter(name => !['bills.pick', 'sandbox.transform', 'sandbox.python'].includes(name)));
  assert.deepEqual(offeredTools(ALL, 'desktop'), ALL);
  assert.deepEqual(offeredTools(ALL, undefined), ALL);
  const loop = { serviceType: 'bookkeeping' as const, offer: { name: 'Monthly books', description: 'Books.' }, clientRequest: 'Close my books', playbook: { steps: [] }, dictionaryManifest: 'm', files: [], containsClientData: true, allowed: [] };
  const state = newHarnessState(ALL, DEFAULT_LIMITS, []);
  const onHosted = actTask({ ...loop, host: 'hosted-web' }, state);
  const tools = (task: typeof onHosted) => ((task.input as { tools: { tool: string }[] }).tools).map(item => item.tool);
  assert.ok(!tools(onHosted).some(name => ['bills.pick', 'sandbox.transform', 'sandbox.python'].includes(name)), tools(onHosted).join(','));
  assert.equal('rowLanguage' in (onHosted.input as object), false);
  assert.ok(!JSON.stringify(onHosted.schema).includes('sandbox.'));
  assert.deepEqual(state.grant, ALL);
  const onDesktop = actTask({ ...loop, host: 'desktop' }, state);
  assert.deepEqual(tools(onDesktop), tools(actTask(loop, state)), 'the desktop prompt is unchanged');
  assert.ok(tools(onDesktop).includes('sandbox.transform') && 'rowLanguage' in (onDesktop.input as object));
  for (const reason of [HOSTED_NO_AGENT_CODE, HOSTED_NO_CONTAINERS, HOSTED_NO_PDF]) assert.deepEqual(houseStyleFindings(reason), [], reason);
});

// ---------------------------------------------------------------------------
// 7. The bounded loop
// ---------------------------------------------------------------------------

const turn = (calls: [string, unknown][], finished = false, note = 'Work on the files') => ({ note, calls: calls.map(([tool, input]) => ({ tool, input: JSON.stringify(input) })), finished });
const meta = { by: 'model' as const, callId: 'call_1', costMicros: '1000' };

test('loop: a turn is checked, its calls run in order, and a hand-off ends the turn and cancels the rest', async () => {
  const limits = DEFAULT_LIMITS;
  assert.throws(() => validateTurn({ note: 'Add 4500', calls: [], finished: true }, limits), code('MODEL_OUTPUT_REJECTED'));
  assert.throws(() => validateTurn({ note: 'ok', calls: Array(5).fill({ tool: 'files.list', input: '{}' }), finished: false }, limits), code('MODEL_OUTPUT_REJECTED'));
  assert.throws(() => validateTurn({ note: 'ok', calls: [], finished: true, extra: 1 }, limits), code('MODEL_OUTPUT_REJECTED'));
  assert.deepEqual(validateTurn({ note: 'Read f1 then t2', calls: [], finished: true }, limits).note, 'Read f1 then t2');

  const env = toolEnv(practice('messy'));
  let state = newHarnessState(ALL, limits, env.files.map(file => file.id));
  state = await applyTurn(env, state, turn([['files.read', { target: 'f1', part: 'columns' }], ['handoff.client', { question: 'Which account is this?' }], ['files.list', {}]]), meta);
  assert.equal(state.phase, 'needs-answer');
  assert.deepEqual(state.toolCalls.map(item => [item.id, item.outcome]), [['t1.1', 'succeeded'], ['t1.2', 'succeeded'], ['t1.3', 'cancelled']]);
  assert.equal(state.used.toolCalls, 2);
  assert.equal(state.handoffs[0].question, 'Which account is this?');
  assert.throws(() => answerHandoff({ ...state, phase: 'act' }, 'x', 'owner'), code('DELIVERY_NOT_ASKING'));
  state = answerHandoff(state, 'The cafe account.', 'owner');
  assert.equal(state.phase, 'act');
  assert.equal(state.handoffs[0].answeredBy, 'owner');
  assert.ok(JSON.stringify(actTask({ serviceType: 'bookkeeping', offer: { name: 'Monthly books', description: 'Books.' }, clientRequest: 'Close my books', playbook: { steps: [] }, dictionaryManifest: 'm', files: [], containsClientData: true, allowed: [] }, state).input).includes('The cafe account.'));
});

test('loop: turn, tool-call and spend limits force the last step, which must say what was found and what is left', async () => {
  const env = toolEnv(practice('clean'));
  const tight = { ...DEFAULT_LIMITS, maxTurns: 2, maxToolCalls: 3 };
  let state = newHarnessState(ALL, tight, []);
  state = await applyTurn(env, state, turn([['files.list', {}], ['files.list', {}]]), meta);
  assert.equal(state.phase, 'act');
  state = await applyTurn(env, state, turn([['files.list', {}], ['files.list', {}]]), meta);
  assert.equal(state.phase, 'write');
  assert.equal(state.stopReason, 'The agent used all its turns.');
  assert.deepEqual(state.toolCalls.map(item => item.outcome), ['succeeded', 'succeeded', 'succeeded', 'cancelled']);
  assert.equal(!state.toolCalls[3].envelope.ok && state.toolCalls[3].envelope.error.code, 'HARNESS_LIMIT');
  const spendy = await applyTurn(env, newHarnessState(ALL, { ...DEFAULT_LIMITS, maxCostMicros: '500' }, []), turn([]), meta);
  assert.equal(spendy.stopReason, 'The run reached its spending limit.');
  const task = writeTask({
    serviceType: 'bookkeeping', offer: { name: 'Monthly books', description: 'Books.' }, clientRequest: 'Close my books', playbook: { steps: [] }, dictionaryManifest: 'm', files: [],
    containsClientData: false, idea: 'Books', allowed: [], priceRefs: { figures: [], dates: [{ ref: 'today', label: "Today's date", iso: '2026-10-16' }] }, templateTotalRef: 'offer_1.total', proven: [],
  }, state, []);
  assert.match(task.instructions, /stopped before it finished/);
  assert.equal((task.input as any).stopped, 'The agent used all its turns.');
  const done = finishWrite(state, meta);
  assert.equal(done.phase, 'done');
  assert.equal(done.turns.at(-1)!.forced, true);
});

test('loop: older tool results shrink to stubs so each turn stays about the same size', async () => {
  const env = toolEnv(practice('clean'));
  let state = newHarnessState(ALL, { ...DEFAULT_LIMITS, keepOutputs: 1, stubChars: 80 }, []);
  state = await applyTurn(env, state, turn([['files.read', { target: 'f1', part: 'rows' }], ['files.read', { target: 'f2', part: 'rows' }]]), meta);
  // 4J11 (H29): the history is { summary, turns }, and a stub never says to call the tool again.
  const history = (compactHistory(state) as any).turns;
  const [older, newer] = history[0].calls;
  assert.equal(typeof older.result, 'string');
  assert.match(older.result, /shortened by Chausar/);
  assert.doesNotMatch(older.result, /call the tool again/);
  assert.ok(older.result.length < 220);
  assert.equal(typeof newer.result, 'object');
});

test('loop: proven work switches the reply to report sections and is described in words only', async () => {
  const env = toolEnv(practice('clean'));
  let state = newHarnessState(ALL, DEFAULT_LIMITS, env.files.map(file => file.id));
  state = await applyTurn(env, state, turn([['files.read', { target: 'f1', part: 'sample' }], ['books.reconcile', {
    bank: 'f1', description: 'Narration', moneyOut: 'Withdrawal', moneyIn: 'Deposit', balance: 'Balance', bills: [{ table: 'f2', vendor: 'Supplier', amount: 'Amount' }],
  }]], true), meta);
  assert.equal(state.phase, 'write');
  assert.equal(state.sections, 'report');
  const names = (id: string) => env.files.find(file => file.id === id)?.name ?? 'a file';
  const sentences = provenSentences(state, env.receipts, names);
  assert.deepEqual(sentences, [
    'The agent read bank-statement-september.csv.',
    'The calculator reconciled the bank statement against the bills and checked the closing balance.',
    'The calculator matched payments in the statement to bills.',
    'The statement balances: the closing balance worked out equals the one on the statement.',
  ]);
  for (const sentence of sentences) assert.doesNotMatch(sentence, /\d/);
  assert.deepEqual(REPORT_SECTIONS, ['Summary', 'What we did', 'What needs your answer', 'Next steps']);
});

// ---------------------------------------------------------------------------
// 8. Claims: a done claim needs a tool run that proves it
// ---------------------------------------------------------------------------

test('claims: each claimed verb needs its proof, and sending or filing is never proven', () => {
  const proof = (kind: ClaimProof['kind']): ClaimProof => ({ kind, toolCallId: 't1.1', receiptId: null, tableId: null });
  assert.equal(claimBacked('We reconciled', []), false);
  assert.equal(claimBacked('We reconciled', [proof('reconciled')]), true);
  assert.equal(claimBacked('we have matched', [proof('reconciled')]), false);
  assert.equal(claimBacked('we have matched', [proof('matched')]), true);
  assert.equal(claimBacked('are reviewed', [proof('file-read')]), true);
  for (const verb of ['sent', 'filed', 'posted', 'submitted', 'uploaded', 'fixed']) {
    assert.equal(CLAIM_PROOFS[verb], null, verb);
    assert.equal(claimBacked(`we ${verb}`, (['file-read', 'transformed', 'totals', 'matched', 'reconciled', 'balanced'] as const).map(proof)), false, verb);
  }
});

test('checks: no-done-claims passes a claim a tool proved, fails one it did not, and a report needs report headings', () => {
  const deliverable: Deliverable = {
    title: 'Your September books',
    sections: REPORT_SECTIONS.map(heading => ({ heading, parts: [{ kind: 'text', text: heading === 'What we did' ? 'We reconciled your statement and we matched each payment.' : 'Plain words for this part of the report.' }] })),
    questionsForClient: [],
  };
  const base = {
    checks: ['no-done-claims', 'required-sections'] as const, deliverable, renderedText: renderDeliverable(deliverable, [], { dateOrder: 'day-month-year' }),
    serviceType: 'bookkeeping' as const, allowed: [], receipts: [], ventureId: 'v', mocks: [], mockModes: {}, agentTurns: 1, turnLimit: 1, askedQuestions: false,
  };
  const proof = (kind: ClaimProof['kind']): ClaimProof => ({ kind, toolCallId: 't1.1', receiptId: null, tableId: null });
  const without = runChecks({ ...base, checks: [...base.checks] });
  assert.deepEqual(without.map(item => item.passed), [false, false]);
  assert.match(without[0].detail, /We reconciled/);
  const half = runChecks({ ...base, checks: [...base.checks], proofs: [proof('reconciled')], sections: REPORT_SECTIONS });
  assert.equal(half[0].passed, false);
  assert.match(half[0].detail, /we matched/);
  const backed = runChecks({ ...base, checks: [...base.checks], proofs: [proof('reconciled'), proof('matched')], sections: REPORT_SECTIONS });
  assert.deepEqual(backed.map(item => [item.passed, item.detail]), [[true, 'Every claim of finished work matches a tool run that proves it.'], [true, 'Every required section is there.']]);
});

// ---------------------------------------------------------------------------
// 9. What review found: amounts only from files, joins, statement direction, dates, words-only questions
// ---------------------------------------------------------------------------

test('calculator: a table a program made never supplies amounts, and a joined table must be made from the one it joins', async () => {
  const env = toolEnv(practice('clean'));
  const keys = await call(env, ALL, 'sandbox.transform', { table: 'f2', program: 'out kind = if contains(lower(col("Supplier")), "dairy") then "Dairy" else "Other"' });
  assert.ok(keys.record.envelope.ok, JSON.stringify(keys.record.envelope));
  const fromProgram = await call(env, ALL, 'calc.sum', { table: 't1', amountColumn: 'kind' });
  assert.match(!fromProgram.record.envelope.ok ? fromProgram.record.envelope.error.message : '', /made by a program, so it holds labels and keys, not amounts/);
  const wrongJoin = await call(env, ALL, 'calc.totals', { table: 'f1', amountColumn: 'Withdrawal', groupTable: 't1', groupColumn: 'kind' });
  assert.match(!wrongJoin.record.envelope.ok ? wrongJoin.record.envelope.error.message : '', /was not made from/);
  const twice = await call(env, ALL, 'books.reconcile', { bank: 'f1', description: 'Narration', moneyOut: 'Withdrawal', moneyIn: 'Deposit', balance: 'Balance', bills: [{ table: 'f2', vendor: 'Supplier', amount: 'Amount' }, { table: 'f2', vendor: 'Supplier', amount: 'Amount' }] });
  assert.match(!twice.record.envelope.ok ? twice.record.envelope.error.message : '', /each bill table once/);
  const billsFromProgram = await call(env, ALL, 'books.reconcile', { bank: 'f1', description: 'Narration', moneyOut: 'Withdrawal', moneyIn: 'Deposit', balance: 'Balance', bills: [{ table: 't1', vendor: 'kind', amount: 'kind' }] });
  assert.equal(billsFromProgram.record.envelope.ok, false);
  assert.equal(env.receipts.length, 0, 'no refused call made a receipt');
  // Digits in a column name or a filter value are labels, not numbers the receipt must hold.
  const named = table(csv('named.csv', 'Item,Column 3\nRent 2026,"1,000.00"\nPower,500.00'));
  assert.doesNotThrow(() => sumRows(env as unknown as WorkEnv, named, 'Column 3', { column: 'Item', equals: 'Rent 2026' }));
});

test('reconciliation: dates decide which way a statement runs, so one bad balance never swaps the opening and the closing', () => {
  const [, bills] = practice('messy').map(table);
  const edited = PRACTICE_FILES['bookkeeping-messy'][0].content.replace('"70,980.00"', '"70,900.00"');
  const bank = table(csv('messy-edited.csv', edited));
  const receipt = reconcileMonth(env, {
    bank, bankColumns: { date: 'Txn Date', description: 'Description', moneyOut: 'Debit', moneyIn: 'Credit', balance: 'Balance' },
    bills: [{ table: bills, columns: { vendor: 'Vendor', amount: 'Total', date: 'Date', number: 'Ref' } }],
  });
  const figure = (key: string) => receipt.figures.find(item => item.key === key)!.minor;
  assert.ok(receipt.steps.some(step => step.result === 'reversed'));
  assert.deepEqual([figure('opening'), figure('statement-closing')], ['5333000', '6148000']);
  assert.equal(receipt.reconciliation!.balanced, false, 'a broken running balance is never called balanced');
  assert.ok(receipt.steps.some(step => /running balance breaks at row/.test(step.rule)));
  // Without dates, the order with fewer breaks wins.
  const undated = table(csv('undated.csv', edited.split('\n').map(line => line.split(',').slice(1).join(',')).join('\n').replace(/^Description/, 'Description')));
  const second = reconcileMonth(env, { bank: undated, bankColumns: { description: 'Description', moneyOut: 'Debit', moneyIn: 'Credit', balance: 'Balance' }, bills: [{ table: bills, columns: { vendor: 'Vendor', amount: 'Total' } }] });
  assert.equal(second.figures.find(item => item.key === 'statement-closing')!.minor, '6148000');
});

test('reconciliation: a payment settles a bill dated on or before it, the oldest first', () => {
  const bank = table(csv('bank.csv', 'Date,Narration,Out,In,Balance\n2026-09-01,Opening,,,"10,000.00"\n2026-09-02,UPI/Fresh Farms Dairy/milk,"4,500.00",,"5,500.00"'));
  const bills = table(csv('bills.csv', 'Date,Supplier,Number,Amount\n2026-09-27,Fresh Farms Dairy,FF-0927,"4,500.00"\n2026-09-01,Fresh Farms Dairy,FF-0901,"4,500.00"'));
  const receipt = reconcileMonth(env, { bank, bankColumns: { date: 'Date', description: 'Narration', moneyOut: 'Out', moneyIn: 'In', balance: 'Balance' }, bills: [{ table: bills, columns: { vendor: 'Supplier', amount: 'Amount', date: 'Date', number: 'Number' } }] });
  assert.deepEqual(receipt.reconciliation!.matched.map(item => [item.bankRowId, item.billRowId]), [['r2', 'r2']], 'the bill dated after the payment stays unpaid');
  assert.deepEqual(receipt.reconciliation!.unmatchedBills.map(item => item.text), ['Fresh Farms Dairy FF-0927']);
});

test('words only: hand-off questions and agent notes never carry an amount', async () => {
  const env = toolEnv(practice('clean'), { allowed: ['q3'] });
  const asked = await call(env, ALL, 'handoff.client', { question: 'Is the 500 difference a fee?' });
  assert.equal(!asked.record.envelope.ok && asked.record.envelope.error.code, 'TOOL_INPUT_INVALID');
  assert.equal(asked.handoff, null);
  const copied = await call(env, ALL, 'handoff.owner', { question: 'Is this for Q3?' });
  assert.equal(copied.handoff?.question, 'Is this for Q3?');
  assert.throws(() => validateTurn({ note: 'Rs4500 paid twice', calls: [], finished: true }, DEFAULT_LIMITS), code('MODEL_OUTPUT_REJECTED'));
  assert.throws(() => validateTurn({ note: 'Check the 4500 payment', calls: [], finished: true }, DEFAULT_LIMITS), code('MODEL_OUTPUT_REJECTED'));
  assert.equal(validateTurn({ note: 'Read f1, f1.s2 and w1.total', calls: [], finished: true }, DEFAULT_LIMITS).note, 'Read f1, f1.s2 and w1.total');
  assert.equal(validateTurn({ note: 'Look at Q3 bills', calls: [], finished: true }, DEFAULT_LIMITS, ['q3']).note, 'Look at Q3 bills');
  // Closing the books needs a statement that balances, not only a reconciliation that ran.
  const proof = (kind: ClaimProof['kind']): ClaimProof => ({ kind, toolCallId: 't1.1', receiptId: null, tableId: null });
  assert.equal(claimBacked('are closed', [proof('reconciled')]), false);
  assert.equal(claimBacked('are closed', [proof('reconciled'), proof('balanced')]), true);
});

// ---------------------------------------------------------------------------
// 10. Practice files and static rules for the harness folder
// ---------------------------------------------------------------------------

test('practice files: made up by Chausar, not client data, and every practice month reads cleanly', () => {
  assert.deepEqual(Object.keys(PRACTICE_FILES), ['bookkeeping-clean', 'bookkeeping-messy']);
  // The clean month also has a sales register, for a CA firm's GST working (W2 2A1).
  for (const [kind, count] of [['clean', 3], ['messy', 2]] as const) {
    const files = practice(kind);
    assert.equal(files.length, count);
    assert.ok(files.every(file => file.clientData === false && file.format === 'csv'));
    for (const file of files) assert.ok(table(file).rows.length >= 4);
  }
  assert.deepEqual(practiceFiles({ id: 'bookkeeping-pushback', serviceType: 'bookkeeping', source: 'template' }), []);
  assert.equal(practiceFiles({ id: 'signal-x', serviceType: 'bookkeeping', source: 'signal' })[0].name, 'bank-statement-messy.csv');
  assert.deepEqual(practiceFiles({ id: 'content-clean', serviceType: 'content', source: 'template' }), []);
});

test('static: harness files use listed error codes, never float money arithmetic, and keep house style', async () => {
  const folder = new URL('../runtime/venture/delivery/harness/', import.meta.url);
  const files = (await readdir(folder)).filter(name => name.endsWith('.ts'));
  assert.ok(files.length >= 14, files.join(','));
  // Codes other components report (the WebAssembly worker, the Python helper, the container runner), passed through or read.
  const passThrough = new Set(['MEMORY_LIMIT', 'CELL_LIMIT', 'OUTPUT_LIMIT', 'TABLE_LIMIT', 'UNAPPROVED_IMPORT', 'ROW_PROGRAM_FAILED', 'OUTPUT_BOUNDS', 'NOT_A_DICT', 'NO_TRANSFORM', 'PYTHON_UNAVAILABLE', 'PDF_DEPENDENCY_UNAVAILABLE', 'PDF_PAGE_LIMIT',
    // An environment name heavy work passes on to Codex so it finds its own sign-in; not an error code.
    'CODEX_HOME',
    // 4J11 (H31): settings a project .env may set for heavy work (delegate-process.ts DOTENV_ALLOWLIST); not error codes.
    'LC_ALL', 'NO_COLOR']);
  for (const name of files) {
    const source = await readFile(new URL(name, folder), 'utf8');
    for (const match of source.matchAll(/'([A-Z]+(?:_[A-Z]+)+)'/g)) assert.ok((VENTURE_ERRORS as readonly string[]).includes(match[1]) || passThrough.has(match[1]), `${name}: ${match[1]}`);
    for (const banned of ['parseFloat', 'toFixed', 'Math.round', 'Number(']) assert.ok(!source.includes(banned), `${name} uses ${banned}`);
    assert.deepEqual(houseStyleFindings(source), [], name);
  }
});

