import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import { recordedHttp } from '../runtime/adapters/read-kit.ts';
import { tallyRegisterRequestBody, tallyRegisterTotalRequestBody } from '../runtime/adapters/accounting/tally-registers.ts';
import { tallyCompanies, tallyExporter, tallyImportExport, tallyLedgers } from '../runtime/connectors-ext/tally-export.ts';
import { cxState, peekCx } from '../runtime/connectors-ext/state.ts';
import type { ModuleHost } from '../runtime/modules/types.ts';

// Synthetic data only: the company, ledgers and vouchers are made up.
const owner = { memberId: 'owner', role: 'owner' as const, epoch: 1, channel: 'desktop' as const };
const phone = { ...owner, channel: 'phone' as const };
const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected); assert.doesNotMatch(error.message, /Zebra|Sales GST|\d{4,}/); return true; };
const fx = (name: string) => readFileSync(new URL(`../../fixtures/connectors/tally/${name}`, import.meta.url), 'utf8');
const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const COMPANY = 'Zebra Synthetic Traders \'$(Get-Date)\' "x"; exit';
const LEDGERS = ['Sales GST 18%', 'Sales GST 5%'];
const april = { from: '2026-04-01', to: '2026-04-30' };

async function temp(t: any, prefix: string) { const dir = await mkdtemp(join(tmpdir(), prefix)); t.after(() => rm(dir, { recursive: true, force: true })); return dir; }
async function open(t: any, options: Record<string, unknown> = {}) {
  const directory = await temp(t, 'chausar-cx-tally-export-');
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file' } as any);
  t.after(() => engine.close());
  await engine.request('workspace.create', { name: 'Synthetic Traders', passphrase: 'Synthetic connector passphrase 2026', demo: false, pack: 'retail', folder: 'main' });
  const e = engine as any;
  const host: ModuleHost = { get store() { return e.store(); }, services: e.services, demo: false, directory, options, call: (method: string, payload: Record<string, unknown>) => engine.request(method, payload) } as any;
  const file = await engine.request('connectorsx.connect', { group: 'tally', road: 'file', company: COMPANY });
  return { engine, host, file, directory };
}
/** The request bodies and digests a script carries, read back from its base64. */
function scriptRequests(script: string) {
  return [...script.matchAll(/@\{ digest = '([0-9a-f]{64})'; body = '([A-Za-z0-9+/=]+)' \}/g)].map(m => ({ digest: m[1], body: Buffer.from(m[2], 'base64').toString('utf8') }));
}
const answers = (exportId: string, responses: { requestDigest: string; body: Buffer | string }[]) =>
  JSON.stringify({ format: 'chausar-tally-answers', version: 1, exportId, responses: responses.map(r => ({ requestDigest: r.requestDigest, bodyBase64: Buffer.from(r.body).toString('base64') })) });
async function exported(host: ModuleHost, connectionId: string) {
  const reply: any = await tallyExporter(owner, { connectionId, register: 'sales', period: april, ledgers: LEDGERS, baseCurrency: 'INR' }, host);
  const [register, total] = scriptRequests(reply.script);
  return { reply, register, total };
}

test('the exporter script carries exactly the register requests, in base64 only, with a bilingual guide', async t => {
  const { host, file, engine } = await open(t);
  const { reply, register, total } = await exported(host, file.id);
  assert.deepEqual(scriptRequests(reply.script).map(r => r.body), [tallyRegisterRequestBody('sales', COMPANY, april), tallyRegisterTotalRequestBody('sales', COMPANY, april)]);
  assert.deepEqual([register.digest, total.digest], [sha(register.body), sha(total.body)]);
  assert.match(register.body, /<SVCURRENTCOMPANY>Zebra Synthetic Traders &apos;\$\(Get-Date\)&apos; &quot;x&quot;; exit<\/SVCURRENTCOMPANY>/);
  for (const clear of ['Zebra', 'Get-Date)', 'SVCURRENTCOMPANY', 'Sales GST']) assert.equal(reply.script.includes(clear), false, `${clear} never appears in clear`);
  assert.match(reply.script, /^[\x00-\x7f]*$/, 'the script is plain ASCII, so Windows PowerShell 5.1 reads it without a byte order mark');
  assert.match(reply.script, /Invoke-WebRequest -Uri \$endpoint -Method Post -Body \$bytes -ContentType 'text\/xml; charset=utf-8' -UseBasicParsing/);
  assert.match(reply.script, /\$endpoint = 'http:\/\/127\.0\.0\.1:9000\/'/);
  assert.match(reply.script, /changes nothing in Tally and sends nothing anywhere else/);
  assert.match(reply.script, /Join-Path \$PSScriptRoot \$answerFile/);
  assert.equal(reply.fileName, 'chausar-tally-sales-2026-04-01-to-2026-04-30.ps1');
  assert.match(reply.guide.en, /powershell -ExecutionPolicy Bypass -File chausar-tally-sales-2026-04-01-to-2026-04-30\.ps1/);
  assert.match(reply.guide.en, /F1 \(Help\) > Settings > Connectivity/); assert.match(reply.guide.en, /changes nothing in Tally and sends nothing anywhere else/);
  assert.match(reply.guide.hi, /[ऀ-ॿ]/); assert.match(reply.guide.hi, /पोर्ट 9000/); assert.match(reply.guide.hi, /कुछ नहीं बदलती/);
  for (const text of [reply.guide.en, reply.guide.hi]) assert.equal(text.includes('Zebra'), false);
  const days = (Date.parse(reply.expiresAt) - Date.now()) / 86_400_000; assert.ok(days > 29.9 && days <= 30);
  const [stored] = peekCx((engine as any).store().read()).tallyExports!;
  assert.deepEqual({ ...stored, createdAt: '', expiresAt: '' }, { exportId: reply.exportId, connectionId: file.id, sourceId: file.sourceId, register: 'sales', period: april, company: COMPANY, ledgers: LEDGERS, baseCurrency: 'INR',
    requestDigests: [register.digest, total.digest], createdAt: '', expiresAt: '', createdBy: 'owner' }, 'the request is remembered, never an answer');
  // Registered as a prepare method on the engine, which is not external.
  const viaEngine: any = await engine.request('connectorsx.tally.exporter', { connectionId: file.id, register: 'purchase', period: april, ledgers: ['Purchase GST 18%'], baseCurrency: 'INR' });
  assert.match(viaEngine.script, /Purchase Register/);
  await assert.rejects(tallyExporter(owner, { connectionId: file.id, register: 'sales', period: april, ledgers: [], baseCurrency: 'INR' }, host), code('CONFIG_INVALID'));
  await assert.rejects(tallyExporter(owner, { connectionId: file.id, register: 'sales', period: april, ledgers: LEDGERS, baseCurrency: 'rupees' }, host), code('CONFIG_INVALID'));
  await assert.rejects(tallyExporter(owner, { connectionId: file.id, register: 'sales', period: { from: '2026-05-01', to: '2026-04-01' }, ledgers: LEDGERS, baseCurrency: 'INR' }, host), code('PERIOD_INVALID'));
  await assert.rejects(tallyExporter(owner, { connectionId: 'connection_missing', register: 'sales', period: april, ledgers: LEDGERS, baseCurrency: 'INR' }, host), code('CONNECTION_NOT_FOUND'));
  const razor = await engine.request('connectorsx.connect', { group: 'razorpay', road: 'file', company: 'Synthetic Traders' });
  await assert.rejects(tallyExporter(owner, { connectionId: razor.id, register: 'sales', period: april, ledgers: LEDGERS, baseCurrency: 'INR' }, host), code('TALLY_CONNECTION_REQUIRED'));
  await assert.rejects(tallyExporter(phone, { connectionId: file.id, register: 'sales', period: april, ledgers: LEDGERS, baseCurrency: 'INR' }, host), code('OPEN_DESKTOP'));
  await assert.rejects(tallyExporter({ ...owner, sourceTainted: true }, { connectionId: file.id, register: 'sales', period: april, ledgers: LEDGERS, baseCurrency: 'INR' }, host), code('OPEN_DESKTOP'));
});

test('an answer file round-trips through the register reader and the recipe, checked against the group movement', async t => {
  const { host, file, engine } = await open(t);
  const { reply, register, total } = await exported(host, file.id);
  const text = answers(reply.exportId, [{ requestDigest: register.digest, body: fx('sales-vouchers.xml') }, { requestDigest: total.digest, body: fx('sales-total.xml') }]);
  const envelope: any = await engine.request('connectorsx.tally.importExport', { connectionId: file.id, text });
  assert.equal(envelope.status, 'accepted', JSON.stringify(envelope.refusal ?? envelope.abstention));
  assert.equal(envelope.road, 'file'); assert.equal(envelope.recipeId, 'tally.sales-register'); assert.equal(envelope.sourceId, file.sourceId);
  assert.equal(envelope.observed.total, '1500050'); assert.equal(envelope.observed.rowCount, 2); assert.equal(envelope.excludedRows, 1);
  assert.equal(envelope.sourceTotals.provenance, 'source-declared'); assert.equal(envelope.sourceTotals.total, '1500050');
  assert.ok(envelope.checks.some((c: any) => c.status === 'passed' && c.expected === '1500050'), JSON.stringify(envelope.checks));
  assert.deepEqual(envelope.requestedPeriod, april); assert.deepEqual(envelope.read, { pages: 2, requests: 2, bytes: Buffer.byteLength(fx('sales-vouchers.xml')) + Buffer.byteLength(fx('sales-total.xml')) });
  assert.equal(envelope.pendingRows, 2);
  // A byte order mark from an editor is tolerated; the answers are the same.
  assert.equal((await tallyImportExport(owner, { connectionId: file.id, text: `﻿${text}` }, host) as any).status, 'accepted');

  // Tampered: a voucher amount changed after Tally answered. The recipe's check against the group movement refuses it.
  const tampered = fx('sales-vouchers.xml').replace('<AMOUNT>10000.00</AMOUNT>', '<AMOUNT>10001.00</AMOUNT>');
  const refused: any = await tallyImportExport(owner, { connectionId: file.id, text: answers(reply.exportId, [{ requestDigest: register.digest, body: tampered }, { requestDigest: total.digest, body: fx('sales-total.xml') }]) }, host);
  assert.equal(refused.status, 'refused'); assert.equal(refused.refusal.code, 'SOURCE_TOTAL_MISMATCH'); assert.equal(refused.pendingRows, 0);

  // Tally's own error answer keeps the reader's code, and is recorded as a failed read.
  await assert.rejects(tallyImportExport(owner, { connectionId: file.id, text: answers(reply.exportId, [{ requestDigest: register.digest, body: fx('lineerror.xml') }]) }, host), code('TALLY_SOURCE_ERROR'));
  const latest: any = (await engine.request('connectorsx.envelopes', { connectionId: file.id, limit: 1 }))[0];
  assert.equal(latest.status, 'failed'); assert.equal(latest.refusal.code, 'TALLY_SOURCE_ERROR'); assert.equal(latest.road, 'file');
});

test('Tally answering in UTF-16 with a byte order mark is read the same', async t => {
  const { host, file } = await open(t);
  const { reply, register, total } = await exported(host, file.id);
  const utf16 = (text: string) => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
  const envelope: any = await tallyImportExport(owner, { connectionId: file.id, text: answers(reply.exportId, [{ requestDigest: register.digest, body: utf16(fx('sales-vouchers.xml')) }, { requestDigest: total.digest, body: utf16(`<?xml version="1.0" encoding="UTF-16"?>${fx('sales-total.xml')}`) }]) }, host);
  assert.equal(envelope.status, 'accepted', JSON.stringify(envelope.refusal)); assert.equal(envelope.observed.total, '1500050');
  // Without the byte order mark the bytes are read as UTF-8, never guessed: UTF-16 text is then not XML, and bad UTF-8 is refused.
  await assert.rejects(tallyImportExport(owner, { connectionId: file.id, text: answers(reply.exportId, [{ requestDigest: register.digest, body: Buffer.from(fx('sales-vouchers.xml'), 'utf16le') }]) }, host), code('TALLY_XML_INVALID'));
  await assert.rejects(tallyImportExport(owner, { connectionId: file.id, text: answers(reply.exportId, [{ requestDigest: register.digest, body: Buffer.from([0x3c, 0xc3, 0x28]) }]) }, host), code('SOURCE_ENCODING_INVALID'));
});

test('answer files for unknown, foreign or expired exports, or for other requests, are refused', async t => {
  const { host, file, engine } = await open(t);
  const { reply, register, total } = await exported(host, file.id);
  const good = [{ requestDigest: register.digest, body: fx('sales-vouchers.xml') }, { requestDigest: total.digest, body: fx('sales-total.xml') }];
  await assert.rejects(tallyImportExport(owner, { connectionId: file.id, text: answers('tallyexport_unknown', good) }, host), code('TALLY_EXPORT_UNKNOWN'));
  const other = await engine.request('connectorsx.connect', { group: 'tally', road: 'file', company: 'Other Synthetic Co' });
  await assert.rejects(tallyImportExport(owner, { connectionId: other.id, text: answers(reply.exportId, good) }, host), code('TALLY_EXPORT_UNKNOWN'), 'an export belongs to its own connection');
  // A response for a request Chausar never made.
  const foreign = sha(tallyRegisterRequestBody('sales', COMPANY, { from: '2026-05-01', to: '2026-05-31' }));
  await assert.rejects(tallyImportExport(owner, { connectionId: file.id, text: answers(reply.exportId, [...good, { requestDigest: foreign, body: fx('sales-vouchers.xml') }]) }, host), code('TALLY_EXPORT_MISMATCH'));
  // The register request has no answer in the file.
  await assert.rejects(tallyImportExport(owner, { connectionId: file.id, text: answers(reply.exportId, [good[1]]) }, host), code('TALLY_EXPORT_MISMATCH'));
  // Answers swapped between the two requests are refused by the reader, not accepted.
  await assert.rejects(tallyImportExport(owner, { connectionId: file.id, text: answers(reply.exportId, [{ requestDigest: register.digest, body: fx('sales-total.xml') }, { requestDigest: total.digest, body: fx('sales-vouchers.xml') }]) }, host), code('TALLY_OBJECT_UNSUPPORTED'));
  // Not an answer file.
  for (const text of ['not json', '[]', JSON.stringify({ format: 'chausar-tally-answers', version: 2, exportId: reply.exportId, responses: [] }),
    JSON.stringify({ ...JSON.parse(answers(reply.exportId, good)), extra: true }), answers(reply.exportId, [good[0], good[0]]),
    JSON.stringify({ format: 'chausar-tally-answers', version: 1, exportId: reply.exportId, responses: [{ requestDigest: register.digest, bodyBase64: 'not base64!' }] })])
    await assert.rejects(tallyImportExport(owner, { connectionId: file.id, text }, host), code('TALLY_EXPORT_INVALID'), text.slice(0, 40));
  await assert.rejects(tallyImportExport(owner, { connectionId: file.id, text: 'x'.repeat(24 * 1024 * 1024 + 1) }, host), code('TALLY_EXPORT_INVALID'));
  await assert.rejects(tallyImportExport(owner, { connectionId: file.id, text: answers(reply.exportId, good), extra: 1 }, host), code('CONNECTOR_REQUEST_INVALID'));
  // Expired after 30 days.
  await host.store.update(state => { for (const item of cxState(state).tallyExports!) item.expiresAt = new Date(Date.now() - 1000).toISOString(); });
  await assert.rejects(tallyImportExport(owner, { connectionId: file.id, text: answers(reply.exportId, good) }, host), code('TALLY_EXPORT_UNKNOWN'));
  // Bounded and purged with the source.
  for (let i = 0; i < 52; i++) await tallyExporter(owner, { connectionId: file.id, register: 'sales', period: april, ledgers: LEDGERS, baseCurrency: 'INR' }, host);
  assert.equal(peekCx(host.store.read()).tallyExports!.length, 50);
  const { purgeSources } = await import('../runtime/connectors-ext/state.ts');
  await host.store.update(state => { purgeSources(state, [file.sourceId]); });
  assert.equal(peekCx(host.store.read()).tallyExports!.length, 0);
});

test('companies and ledgers come from Tally on this computer, desktop only', async t => {
  const calls: any[] = [];
  const http = async (request: any) => recordedHttp({ 'POST http://127.0.0.1:9000/': { body: request.body.includes('<ID>ChausarCompanies</ID>') ? fx('companies.xml') : fx('ledgers.xml'), headers: { 'content-type': 'text/xml' } } }, calls)(request);
  const { host, file, engine } = await open(t, { http });
  const local = await engine.request('connectorsx.connect', { group: 'tally', road: 'interface', company: 'Synthetic Traders', settings: { company: 'Demo Traders', baseCurrency: 'INR', ledgers: 'Sales GST 18%' } });
  assert.deepEqual(await tallyCompanies(owner, { connectionId: local.id }, host), { companies: [{ name: 'Demo Traders', booksFrom: '2026-04-01' }, { name: 'Demo Traders (Old)', booksFrom: '2025-04-01' }] });
  assert.deepEqual(await tallyLedgers(owner, { connectionId: local.id }, host), { ledgers: [{ name: 'Sales GST 18%', parent: 'Sales Accounts' }, { name: 'Sales GST 5%', parent: 'Sales Accounts' }, { name: 'Asha Stores', parent: 'Sundry Debtors' }, { name: 'Purchase GST 18%', parent: 'Purchase Accounts' }] });
  assert.equal(calls.length, 2); assert.match(calls[1].body, /<SVCURRENTCOMPANY>Demo Traders<\/SVCURRENTCOMPANY>/);
  await assert.rejects(tallyCompanies(phone, { connectionId: local.id }, host), code('OPEN_DESKTOP'));
  await assert.rejects(tallyLedgers(phone, { connectionId: local.id }, host), code('OPEN_DESKTOP'));
  await assert.rejects(tallyCompanies(owner, { connectionId: file.id }, host), code('READ_NOT_AVAILABLE'), 'a file connection is not on this computer');
  await assert.rejects(engine.request('connectorsx.tally.companies', { connectionId: local.id }), code('DEMO_EXTERNAL_DISABLED'));
  await assert.rejects(engine.request('connectorsx.tally.ledgers', { connectionId: local.id }), code('DEMO_EXTERNAL_DISABLED'));
});

const pwsh = ['pwsh', 'powershell'].find(name => spawnSync(name, ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'], { encoding: 'utf8' }).status === 0);
test('the script runs in PowerShell against a loopback Tally and its answer file imports', { skip: pwsh ? false : 'PowerShell (pwsh) is not installed on this machine, so the script is not run here.' }, async t => {
  const server = createServer((request, response) => {
    let body = ''; request.on('data', chunk => { body += chunk; });
    request.on('end', () => { response.writeHead(200, { 'content-type': 'text/xml; charset=utf-16' }); response.end(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(body.includes('<ID>ChausarGroupTotal</ID>') ? fx('sales-total.xml') : fx('sales-vouchers.xml'), 'utf16le')])); });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => server.close());
  const { host, file } = await open(t);
  const reply: any = await tallyExporter(owner, { connectionId: file.id, register: 'sales', period: april, ledgers: LEDGERS, baseCurrency: 'INR' }, host, { endpoint: `http://127.0.0.1:${(server.address() as any).port}/` });
  const folder = await temp(t, 'chausar-cx-tally-script-');
  await writeFile(join(folder, reply.fileName), reply.script);
  const run = spawnSync(pwsh!, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(folder, reply.fileName)], { encoding: 'utf8', timeout: 60_000 });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  const text = await readFile(join(folder, reply.fileName.replace(/\.ps1$/, '-answers.json')), 'utf8');
  const envelope: any = await tallyImportExport(owner, { connectionId: file.id, text }, host);
  assert.equal(envelope.status, 'accepted', JSON.stringify(envelope.refusal)); assert.equal(envelope.observed.total, '1500050');
});
