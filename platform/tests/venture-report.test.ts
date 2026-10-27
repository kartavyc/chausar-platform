// Ink v2 wave 5, package 5A5 (P11): client reports. Typed blocks whose figures cannot exist without a receipt; one
// self-contained HTML file, the same bytes for the same input, with a manifest of every file's sha256; a PDF through the
// desktop's print port (none on hosted, none when the computer cannot draw Hindi); DOCX and XLSX; and a share link
// scoped to dates and channels, hashed, served only by the hosted Chausar, with rotate and disable and a view count.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Context } from '../runtime/contracts.ts';
import { APP_ONLY_METHODS, METHOD_OWNERS, W5_METHOD_LEVELS } from '../runtime/venture/contracts.ts';
import type { DeliveryRunRecord, VentureDeps, WorkReceiptRecord } from '../runtime/venture/contracts.ts';
import { listRecords, ventureAction } from '../runtime/venture/records.ts';
import { handlers } from '../runtime/venture/playbooks/index.ts';
import { hindiNumberWords, resolveBlocks, type SourceReceipt } from '../runtime/venture/playbooks/kit/report/blocks.ts';
import { renderReportHtml } from '../runtime/venture/playbooks/kit/report/render-html.ts';
import { manifestOf, writeReportFolder } from '../runtime/venture/playbooks/kit/report/manifest.ts';
import { PDF_WORDS, type PrintPort, type PrintRequest } from '../runtime/venture/playbooks/kit/report/pdf.ts';
import { REPORT_SHARE_WORDS, reportSharePage } from '../runtime/venture/playbooks/kit/report/share.ts';
import { readDocx, readXlsx } from '../runtime/venture/playbooks/kit/ooxml/read.ts';
import type { ReportListView, ReportShareView, ReportView } from '../runtime/venture/playbooks/kit/records-report.ts';
import { code, owner, phone, seedBlueprint, seedOrder, seedRun, setup, type Env } from './venture-views-env.ts';

type Handler = (deps: VentureDeps, ctx: Context, payload: unknown) => Promise<unknown>;
const call = <T>(deps: VentureDeps, method: string, payload: unknown = {}, ctx: Context = owner) => (handlers as Record<string, Handler>)[method](deps, ctx, payload) as Promise<T>;
const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const bytesOf = (file: { contentBase64: string }) => new Uint8Array(Buffer.from(file.contentBase64, 'base64'));
const PUBLIC = 'https://app.example.com';
const FAKE_PDF = Buffer.from('%PDF-1.7\n% a fake PDF for tests\n%%EOF\n');

/** A print port that records what it was asked and answers as told. */
function printer(answer: 'ok' | 'font-missing' = 'ok'): PrintPort & { asked: PrintRequest[] } {
  const asked: PrintRequest[] = [];
  return { asked, async print(request) { asked.push(request); return answer === 'ok' ? { ok: true, pdfBase64: FAKE_PDF.toString('base64') } : { ok: false, reason: 'font-missing' }; } };
}
const desktop = (env: Env, print?: PrintPort): VentureDeps => ({ ...env.deps, host: 'desktop', ...(print ? { print } : {}) });
const hosted = (env: Env): VentureDeps => ({ ...env.deps, host: 'hosted-web', publicUrl: PUBLIC });

/** An accepted run whose draft cites a social report receipt: Instagram views for September, LinkedIn views for August. */
async function reportRun(env: Env, words = 'We posted every week. Reach grew by about 20 percent.', fields: Partial<DeliveryRunRecord> = {}) {
  const plan = await seedBlueprint(env);
  const { order, client } = await seedOrder(env, plan);
  const run = await seedRun(env, order, { status: 'accepted', servedBy: 'model', renderedText: 'September report', ...fields });
  const receipt = await ventureAction(env.deps, owner, 'prepare', 'seed.receipt', tx => tx.put<WorkReceiptRecord>({
    ...tx.base('venture-work-receipt'), operation: 'social.report', runRef: { kind: 'delivery', runId: run.id }, currency: 'INR',
    inputs: { tables: [], columns: {}, rowIds: [] }, steps: [],
    figures: [
      { key: 'w1.views', label: 'Instagram views', minor: '12400', display: '12,400', currency: 'INR', unit: 'count' },
      { key: 'w2.views', label: 'LinkedIn views', minor: '3100', display: '3,100', currency: 'INR', unit: 'count' },
    ],
    reconciliation: null, allowedNumbers: [], explanation: 'Instagram views: 12,400. LinkedIn views: 3,100.', digest: 'receipt-digest',
    report: [
      { platform: 'instagram', month: '2026-09', key: 'views', formula: 'sum of views', inputs: { fileId: 'f1', fileName: 'ig.csv', fileDigest: 'd1', columns: ['Views'], rows: [2] }, unit: 'count' },
      { platform: 'linkedin', month: '2026-08', key: 'views', formula: 'sum of views', inputs: { fileId: 'f2', fileName: 'li.csv', fileDigest: 'd2', columns: ['Views'], rows: [2] }, unit: 'count' },
    ],
  }));
  const deliverable: DeliveryRunRecord['deliverable'] = {
    title: 'September report for <Cafe Aroma>',
    sections: [
      { heading: 'What we did', parts: [{ kind: 'text', text: words }] },
      { heading: 'Instagram', parts: [{ kind: 'figure', receiptId: receipt.id, figureKey: 'w1.views' }] },
      { heading: 'LinkedIn', parts: [{ kind: 'figure', receiptId: receipt.id, figureKey: 'w2.views' }] },
    ],
    questionsForClient: [],
  };
  const stored = await ventureAction(env.deps, owner, 'prepare', 'seed.deliverable', tx => tx.replace<DeliveryRunRecord>({ ...tx.find('venture-delivery-run', run.id)!, deliverable }));
  return { run: stored, receipt, order, client };
}

test('the five report methods belong to the playbooks package and are built; share, rotate and disable are approvals inside the app', async () => {
  for (const method of ['venture.report.render', 'venture.report.list', 'venture.report.share', 'venture.report.shareRotate', 'venture.report.shareDisable'] as const) {
    assert.equal(METHOD_OWNERS[method], 'playbooks');
    const env = await setup();
    await assert.rejects(call(env.deps, method, { nonsense: true }), (error: any) => error?.code !== 'NOT_BUILT_YET');
  }
  assert.deepEqual(['venture.report.render', 'venture.report.share', 'venture.report.shareRotate', 'venture.report.shareDisable'].filter(method => APP_ONLY_METHODS.includes(method as never)),
    ['venture.report.share', 'venture.report.shareRotate', 'venture.report.shareDisable']);
  assert.equal(W5_METHOD_LEVELS['venture.report.render'], 'prepare');
  assert.equal(W5_METHOD_LEVELS['venture.report.list'], 'read');
  assert.equal(W5_METHOD_LEVELS['venture.report.share'], 'approve');
});

const SOURCES: SourceReceipt[] = [{ id: 'receipt_a', figures: [
  { key: 'total', label: 'Total billed', display: '₹12,400.00', minor: '1240000', unit: 'money', scope: { channel: null, from: null, to: null } },
  { key: 'ig', label: 'Instagram', display: '900', minor: '900', unit: 'count', scope: { channel: 'instagram', from: '2026-09-01', to: '2026-09-30' } },
  { key: 'li', label: 'LinkedIn', display: '300', minor: '300', unit: 'count', scope: { channel: 'linkedin', from: '2026-09-01', to: '2026-09-30' } },
] }];

test('a metric or a bar without a receipt the run has refuses to render; prose with a number is a model estimate; a quote is shown as written', () => {
  assert.throws(() => resolveBlocks([{ kind: 'metric', label: 'Total', receiptId: null, key: 'total' }], SOURCES), code('REPORT_BLOCK_UNSOURCED'));
  assert.throws(() => resolveBlocks([{ kind: 'metric', label: 'Total', receiptId: 'receipt_other', key: 'total' }], SOURCES), code('REPORT_BLOCK_UNSOURCED'));
  assert.throws(() => resolveBlocks([{ kind: 'metric', label: 'Total', receiptId: 'receipt_a', key: 'nope' }], SOURCES), code('REPORT_BLOCK_UNSOURCED'));
  assert.throws(() => resolveBlocks([{ kind: 'bars', label: 'Views', bars: [{ label: 'Instagram', receiptId: 'receipt_a', key: 'ig' }, { label: 'Typed', receiptId: null, key: null }] }], SOURCES), code('REPORT_BLOCK_UNSOURCED'));
  const blocks = resolveBlocks([
    { kind: 'heading', text: 'Summary' },
    { kind: 'prose', text: 'Reach grew by about 20 percent.' },
    { kind: 'prose', text: 'Posting stayed steady.' },
    { kind: 'metric', label: 'Billed', receiptId: 'receipt_a', key: 'total' },
    { kind: 'bars', label: 'Views by channel', bars: [{ label: 'Instagram', receiptId: 'receipt_a', key: 'ig' }, { label: 'LinkedIn', receiptId: 'receipt_a', key: 'li' }] },
    { kind: 'quote', text: 'Loved the reels!', by: 'Client' },
  ], SOURCES);
  assert.deepEqual(blocks.map(block => block.kind === 'prose' ? block.estimate : null), [null, true, false, null, null, null]);
  assert.deepEqual(blocks[3], { kind: 'metric', label: 'Billed', display: '₹12,400.00', unit: 'money', receiptId: 'receipt_a', key: 'total', channel: null, from: null, to: null });
  assert.deepEqual(blocks[4].kind === 'bars' ? blocks[4].bars.map(bar => [bar.display, bar.width]) : null, [['900', 100], ['300', 33]]);
  const html = renderReportHtml({ title: 'September', business: 'Ledger Cafe Books', asOf: '30 Sep 2026', blocks });
  assert.match(html, /Reach grew by about 20 percent\.<\/p><p class="note">Model estimate<\/p>/);
  assert.equal((html.match(/Model estimate/g) ?? []).length, 1, 'prose with no number carries no label');
  assert.match(html, /Loved the reels!/);
  assert.match(html, /Shown as written/);
  assert.match(html, /Receipt receipt_a/);
});

test('the HTML is one file with no outside address, every value escaped, and the same bytes for the same input', () => {
  const blocks = resolveBlocks([
    { kind: 'heading', text: '<script>alert(1)</script>' },
    { kind: 'prose', text: 'Tom & "Jerry" <b>bold</b> it\'s हिंदी में' },
    { kind: 'metric', label: '<img src=x>', receiptId: 'receipt_a', key: 'total' },
  ], SOURCES);
  const doc = { title: 'A & B <report>', business: 'Ledger "Cafe" Books', asOf: '30 Sep 2026', blocks };
  const html = renderReportHtml(doc);
  assert.equal(html, renderReportHtml(doc));
  assert.ok(html.startsWith('<!doctype html>'));
  assert.equal(/<(script|img|link|iframe|object|embed)\b|<[^>]+\s(src|href)=|url\(|@import/i.test(html), false, 'no script, image, link, frame or outside resource');
  assert.equal(/https?:\/\//.test(html), false, 'no outside address');
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(html.includes('Tom &amp; &quot;Jerry&quot; &lt;b&gt;bold&lt;/b&gt; it&#39;s'));
  assert.ok(html.includes('lang="hi"'), 'Hindi words are marked as Hindi');
  // The share link itself is the only address a report may carry.
  const linked = renderReportHtml({ ...doc, link: 'https://app.example.com/share/AAAA' });
  assert.deepEqual(linked.match(/https?:\/\/[^\s"<]+/g), ['https://app.example.com/share/AAAA']);
  // The manifest lists each file's sha256, and is the same text for the same files.
  const files = [{ name: 'report.html', bytes: new Uint8Array(Buffer.from(html)) }];
  const manifest = manifestOf(files);
  assert.deepEqual(JSON.parse(manifest.text).files, [{ name: 'report.html', bytes: Buffer.byteLength(html), sha256: sha256(html) }]);
  assert.equal(manifest.text, manifestOf(files).text);
});

test('render on the desktop makes the HTML, the PDF through the print port, DOCX and XLSX, with a manifest of every file', async () => {
  const env = await setup();
  const { run, receipt } = await reportRun(env);
  const print = printer();
  const view = await call<ReportView>(desktop(env, print), 'venture.report.render', { runId: run.id, formats: ['html', 'pdf', 'docx', 'xlsx'] });
  assert.deepEqual(view.files.map(file => [file.name, file.format]), [
    ['september-report-for-cafe-aroma.html', 'html'], ['september-report-for-cafe-aroma.pdf', 'pdf'],
    ['september-report-for-cafe-aroma.docx', 'docx'], ['september-report-for-cafe-aroma.xlsx', 'xlsx'],
  ]);
  assert.deepEqual(view.notes, []);
  assert.equal(view.estimates, 1);
  assert.deepEqual(view.channels, ['instagram', 'linkedin']);
  assert.deepEqual(view.period, { from: '2026-08-01', to: '2026-09-30' });
  const [html, pdf, docx, xlsx] = view.files.map(bytesOf);
  assert.equal(print.asked.length, 1);
  assert.equal(print.asked[0].html, Buffer.from(html).toString('utf8'), 'the PDF is printed from the same HTML');
  assert.deepEqual(print.asked[0].scripts, ['latin']);
  assert.deepEqual(Buffer.from(pdf), FAKE_PDF);
  const manifest = JSON.parse(Buffer.from(bytesOf(view.manifest)).toString('utf8'));
  assert.deepEqual(manifest.files, view.files.map(file => ({ name: file.name, bytes: file.bytes, sha256: sha256(bytesOf(file)) })));
  assert.equal(view.manifest.sha256, sha256(bytesOf(view.manifest)));
  const text = Buffer.from(html).toString('utf8');
  assert.ok(text.includes('September report for &lt;Cafe Aroma&gt;'));
  assert.ok(text.includes('12,400') && text.includes(`Receipt ${receipt.id}`));
  assert.ok(readDocx(docx).paragraphs.includes('September report for <Cafe Aroma>'));
  assert.ok(readDocx(docx).paragraphs.includes(`Instagram views: 12,400 (receipt ${receipt.id})`));
  assert.deepEqual(readXlsx(xlsx).sheets[0].rows, [
    ['Figure', 'Value', 'Channel', 'From', 'To', 'Receipt'],
    ['Instagram views', '12400', 'instagram', '2026-09-01', '2026-09-30', receipt.id],
    ['LinkedIn views', '3100', 'linkedin', '2026-08-01', '2026-08-31', receipt.id],
  ]);
  const [record] = listRecords(env.store.read(), 'venture-report');
  assert.equal(record.id, view.id);
  assert.equal(record.runId, run.id);
  assert.deepEqual(record.receiptIds, [receipt.id]);
});

test('Hindi the computer cannot draw keeps the HTML with the reason; hosted makes HTML only; a figure with no receipt makes nothing', async () => {
  const env = await setup();
  const { run } = await reportRun(env, 'हमने हर हफ्ते पोस्ट किया।');
  const print = printer('font-missing');
  const view = await call<ReportView>(desktop(env, print), 'venture.report.render', { runId: run.id, formats: ['pdf'] });
  assert.deepEqual(print.asked[0].scripts, ['latin', 'devanagari']);
  assert.deepEqual(view.files.map(file => file.format), ['html']);
  assert.deepEqual(view.notes, [PDF_WORDS.hindi]);
  assert.equal(PDF_WORDS.hindi, 'The PDF could not draw Hindi on this computer, so the report is the HTML file.');
  const onHosted = await call<ReportView>(hosted(env), 'venture.report.render', { runId: run.id });
  assert.deepEqual(onHosted.files.map(file => file.format), ['html']);
  assert.deepEqual(onHosted.notes, [PDF_WORDS.hosted]);
  assert.equal(PDF_WORDS.hosted, 'A PDF needs the desktop app.');
  // Only HTML asked: no PDF, no note.
  assert.deepEqual((await call<ReportView>(hosted(env), 'venture.report.render', { runId: run.id, formats: ['html'] })).notes, []);

  const other = await setup();
  const { run: bad } = await reportRun(other);
  await ventureAction(other.deps, owner, 'prepare', 'seed.bad', tx => tx.replace<DeliveryRunRecord>({ ...bad, deliverable: { ...bad.deliverable!, sections: [{ heading: 'X', parts: [{ kind: 'figure', receiptId: 'receipt_missing', figureKey: 'total' }] }] } }));
  await assert.rejects(call(desktop(other, printer()), 'venture.report.render', { runId: bad.id }), code('REPORT_BLOCK_UNSOURCED'));
  assert.equal(listRecords(other.store.read(), 'venture-report').length, 0);
  await assert.rejects(call(other.deps, 'venture.report.render', { runId: bad.id, formats: ['rtf'] }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(call(other.deps, 'venture.report.render', { runId: 'delivery_missing' }), code('DELIVERY_NOT_FOUND'));
});

test('a share link on the hosted Chausar: the token once, only its hash kept, only what is inside the dates and channels shown, views counted', async () => {
  const env = await setup();
  const { run } = await reportRun(env);
  const deps = hosted(env);
  const report = await call<ReportView>(deps, 'venture.report.render', { runId: run.id, formats: ['html'] });
  await assert.rejects(call(deps, 'venture.report.share', { reportId: report.id, from: '2026-09-01', to: '2026-09-30' }, phone), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(call(deps, 'venture.report.share', { reportId: report.id, from: '2026-09-30', to: '2026-09-01' }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(call(deps, 'venture.report.share', { reportId: report.id, from: '2026-09-01', to: '2026-09-30', channels: ['tiktok'] }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(call(deps, 'venture.report.share', { reportId: 'report_missing', from: '2026-09-01', to: '2026-09-30' }), code('REPORT_NOT_FOUND'));

  const made = await call<ReportShareView>(deps, 'venture.report.share', { reportId: report.id, from: '2026-09-01', to: '2026-09-30', channels: ['instagram'] });
  const token = /^https:\/\/app\.example\.com\/share\/([A-Za-z0-9_-]{32})$/.exec(made.url ?? '')?.[1];
  assert.ok(token, made.url ?? 'no url');
  assert.deepEqual({ ...made, url: null }, { id: made.id, reportId: report.id, url: null, from: '2026-09-01', to: '2026-09-30', channels: ['instagram'], state: 'open', expiresAt: '2026-11-14T10:00:00.000Z', views: 0, viewedAt: null });
  const stored = JSON.stringify(env.store.read());
  assert.equal(stored.includes(token), false, 'the token is never stored');
  assert.ok(stored.includes(sha256(token)));

  // The owner's own look never counts; the client's opens do. Only September's Instagram figure is in scope.
  const preview = await reportSharePage(deps, owner, token, { preview: true });
  assert.ok(preview);
  assert.equal(preview.kind, 'report');
  assert.equal(preview.canAnswer, false);
  assert.ok(preview.text.includes('Instagram views: 12,400'));
  assert.equal(preview.text.includes('LinkedIn'), false, 'a channel outside the scope is not shown');
  assert.equal(/<img|pixel|https?:/i.test(preview.text), false, 'no pixel, no address');
  await reportSharePage(deps, owner, token);
  await reportSharePage(deps, owner, token);
  const [link] = listRecords(env.store.read(), 'venture-report-share');
  assert.equal(link.views, 2);
  assert.equal(link.viewedAt, '2026-10-15T10:00:00.000Z');
  assert.equal(await reportSharePage(deps, owner, `${token.slice(0, 31)}x`), null);

  // A scope of August and LinkedIn shows the LinkedIn figure and not Instagram's.
  const august = await call<ReportShareView>(deps, 'venture.report.share', { reportId: report.id, from: '2026-08-01', to: '2026-08-31' });
  const augustPage = await reportSharePage(deps, owner, august.url!.slice(-32));
  assert.ok(augustPage?.text.includes('LinkedIn views: 3,100'));
  assert.equal(augustPage?.text.includes('Instagram views'), false, 'a month outside the dates is not shown');

  // Rotate: a new token, the old one opens nothing. Disable: nothing opens; disabling twice changes nothing.
  const rotated = await call<ReportShareView>(deps, 'venture.report.shareRotate', { shareId: made.id });
  assert.equal(rotated.id, made.id);
  assert.notEqual(rotated.url, made.url);
  assert.equal(await reportSharePage(deps, owner, token), null);
  const fresh = rotated.url!.slice(-32);
  assert.ok(await reportSharePage(deps, owner, fresh));
  const disabled = await call<ReportShareView>(deps, 'venture.report.shareDisable', { shareId: made.id });
  assert.deepEqual([disabled.state, disabled.url, disabled.reason], ['disabled', null, REPORT_SHARE_WORDS.disabled]);
  assert.equal(await reportSharePage(deps, owner, fresh), null);
  assert.deepEqual(await call(deps, 'venture.report.shareDisable', { shareId: made.id }), disabled);
  await assert.rejects(call(deps, 'venture.report.shareRotate', { shareId: made.id }), code('REPORT_SHARE_DISABLED'));
});

test('off the hosted Chausar a link is kept without an address and says why; a changed draft or one not accepted cannot be shared', async () => {
  const env = await setup();
  const { run } = await reportRun(env);
  const report = await call<ReportView>(env.deps, 'venture.report.render', { runId: run.id, formats: ['html'] });
  const kept = await call<ReportShareView>(env.deps, 'venture.report.share', { reportId: report.id, from: '2026-08-01', to: '2026-09-30' });
  assert.deepEqual([kept.url, kept.reason], [null, REPORT_SHARE_WORDS.notServed]);
  assert.deepEqual(kept.channels, ['instagram', 'linkedin']);
  await ventureAction(env.deps, owner, 'prepare', 'seed.edit', tx => tx.replace<DeliveryRunRecord>({ ...tx.find('venture-delivery-run', run.id)!, status: 'edited', editedText: 'New words.' }));
  await assert.rejects(call(env.deps, 'venture.report.share', { reportId: report.id, from: '2026-08-01', to: '2026-09-30' }), code('REPORT_STALE'));

  const other = await setup();
  const { run: waiting } = await reportRun(other, 'Fine.', { status: 'waiting-for-you' });
  const early = await call<ReportView>(other.deps, 'venture.report.render', { runId: waiting.id, formats: ['html'] });
  await assert.rejects(call(other.deps, 'venture.report.share', { reportId: early.id, from: '2026-08-01', to: '2026-09-30' }), code('DELIVERY_NOT_READY'));
});

test('a temporary business on the hosted app makes reports but shares none', async () => {
  const env = await setup();
  const { run } = await reportRun(env);
  const trial: VentureDeps = { ...hosted(env), trial: () => true };
  const report = await call<ReportView>(trial, 'venture.report.render', { runId: run.id, formats: ['html'] });
  await assert.rejects(call(trial, 'venture.report.share', { reportId: report.id, from: '2026-08-01', to: '2026-09-30' }), code('TRIAL_LIMIT'));
  assert.equal(listRecords(env.store.read(), 'venture-report-share').length, 0);
});

test('the vault keeps what a report is and its checksums, never the bytes of its files; the answer carries them once', async () => {
  const env = await setup();
  const { run } = await reportRun(env);
  const view = await call<ReportView>(desktop(env, printer()), 'venture.report.render', { runId: run.id, formats: ['html', 'pdf', 'docx', 'xlsx'] });
  assert.ok(view.files.every(file => file.contentBase64.length > 0));
  const [record] = listRecords(env.store.read(), 'venture-report');
  assert.deepEqual(record.files, view.files.map(({ contentBase64: _bytes, ...meta }) => meta));
  assert.deepEqual(record.manifest, { name: 'manifest.json', bytes: view.manifest.bytes, sha256: view.manifest.sha256 });
  assert.equal(JSON.stringify(record).includes('contentBase64'), false, 'no bytes in the vault');
  assert.ok(JSON.stringify(record).length < 20_000);
});

test('venture.report.list: each report of an order or a run, newest first, with every link, its state, views and end, never an address', async () => {
  const env = await setup();
  const { run, order } = await reportRun(env);
  const deps = hosted(env);
  const first = await call<ReportView>(deps, 'venture.report.render', { runId: run.id, formats: ['html'] });
  env.advance(60_000);
  const second = await call<ReportView>(deps, 'venture.report.render', { runId: run.id, formats: ['html', 'xlsx'] });
  const link = await call<ReportShareView>(deps, 'venture.report.share', { reportId: second.id, from: '2026-08-01', to: '2026-09-30' });
  await reportSharePage(deps, owner, link.url!.slice(-32));
  const listed = await call<ReportListView>(deps, 'venture.report.list', { orderId: order.id }, phone);
  assert.deepEqual(listed.reports.map(report => report.id), [second.id, first.id]);
  assert.deepEqual(listed.reports[0].files.map(file => file.format), ['html', 'xlsx']);
  assert.equal(JSON.stringify(listed).includes('contentBase64'), false);
  assert.deepEqual(listed.reports[0].links, [{ ...link, url: null, reason: REPORT_SHARE_WORDS.shownOnce, views: 1, viewedAt: '2026-10-15T10:01:00.000Z' }]);
  assert.deepEqual(listed.reports[1].links, []);
  assert.equal(JSON.stringify(listed).includes(link.url!.slice(-32)), false, 'never the token');
  assert.deepEqual((await call<ReportListView>(deps, 'venture.report.list', { runId: run.id })).reports.map(report => report.id), [second.id, first.id]);
  assert.deepEqual((await call<ReportListView>(deps, 'venture.report.list', {})).reports.length, 2);
  assert.deepEqual((await call<ReportListView>(deps, 'venture.report.list', { orderId: 'order_other' })).reports, []);
  await assert.rejects(call(deps, 'venture.report.list', { orderId: order.id, runId: run.id }), code('INVALID_VENTURE_REQUEST'));
  await call(deps, 'venture.report.shareDisable', { shareId: link.id });
  assert.equal((await call<ReportListView>(deps, 'venture.report.list', { runId: run.id })).reports[0].links[0].state, 'disabled');
});

test('a title or heading with a number the owner did not write is a model estimate, and so is a number in Hindi words', async () => {
  const env = await setup();
  const { run } = await reportRun(env, 'पोस्ट तीन गुना ज़्यादा लोगों तक पहुंचीं।');
  await ventureAction(env.deps, owner, 'prepare', 'seed.title', tx => {
    const now = tx.find('venture-delivery-run', run.id)!;
    return tx.replace<DeliveryRunRecord>({ ...now, deliverable: { ...now.deliverable!, title: 'Reach up 40 percent', sections: [{ heading: 'Top 3 posts', parts: [{ kind: 'text', text: 'Steady.' }] }, ...now.deliverable!.sections] } });
  });
  const view = await call<ReportView>(env.deps, 'venture.report.render', { runId: run.id, formats: ['html'] });
  const [record] = listRecords(env.store.read(), 'venture-report');
  assert.equal(record.titleEstimate, true);
  assert.deepEqual(record.blocks.filter(block => block.kind === 'heading').map(block => [block.text, block.kind === 'heading' && block.estimate]),
    [['Top 3 posts', true], ['What we did', false], ['Instagram', false], ['LinkedIn', false]]);
  assert.equal(record.blocks.find(block => block.kind === 'prose' && block.text.startsWith('पोस्ट'))?.kind === 'prose' && (record.blocks.find(block => block.kind === 'prose' && block.text.startsWith('पोस्ट')) as { estimate: boolean }).estimate, true);
  const html = Buffer.from(view.files[0].contentBase64, 'base64').toString('utf8');
  assert.match(html, /<h1>Reach up 40 percent<\/h1><p class="note">Model estimate<\/p>/);
  assert.match(html, /<h2>Top 3 posts<\/h2><p class="note">Model estimate<\/p>/);
  assert.equal(hindiNumberWords('दो सौ लोग'), true);
  assert.equal(hindiNumberWords('एक वेब पेज, हर हफ्ते'), false, 'एक is also the word "a"; it alone is not a number');
});

test('a served link stops opening once the draft changes after the report was made', async () => {
  const env = await setup();
  const { run } = await reportRun(env);
  const deps = hosted(env);
  const report = await call<ReportView>(deps, 'venture.report.render', { runId: run.id, formats: ['html'] });
  const link = await call<ReportShareView>(deps, 'venture.report.share', { reportId: report.id, from: '2026-08-01', to: '2026-09-30' });
  const token = link.url!.slice(-32);
  assert.ok(await reportSharePage(deps, owner, token));
  await ventureAction(env.deps, owner, 'prepare', 'seed.edit', tx => tx.replace<DeliveryRunRecord>({ ...tx.find('venture-delivery-run', run.id)!, status: 'edited', editedText: 'New words.' }));
  assert.equal(await reportSharePage(deps, owner, token), null);
  assert.equal(await reportSharePage(deps, owner, token, { preview: true }), null);
  assert.equal(listRecords(env.store.read(), 'venture-report-share')[0].views, 1, 'a page that did not open counts no view');
});

test('writeReportFolder writes every file and manifest.json together, or nothing', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'chausar-report-'));
  try {
    const files = [{ name: 'report.html', bytes: new Uint8Array(Buffer.from('<p>hi</p>')) }, { name: 'report.xlsx', bytes: new Uint8Array([1, 2, 3]) }];
    const manifest = await writeReportFolder(folder, files);
    assert.deepEqual((await readdir(folder)).sort(), ['manifest.json', 'report.html', 'report.xlsx']);
    assert.equal(await readFile(join(folder, 'manifest.json'), 'utf8'), manifest.text);
    assert.equal(JSON.parse(manifest.text).files[1].sha256, sha256(new Uint8Array([1, 2, 3])));
    await assert.rejects(writeReportFolder(folder, files), code('EXPORT_EXISTS'));
    assert.deepEqual((await readdir(folder)).sort(), ['manifest.json', 'report.html', 'report.xlsx']);
  } finally { await rm(folder, { recursive: true, force: true }); }
});
