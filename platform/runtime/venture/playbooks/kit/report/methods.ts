// Chausar playbook kit (Ink v2 wave 5, package 5A5, P11): venture.report.render, a client report of one run's draft.
// The draft's sections become blocks (playbooks/kit/report/blocks.ts), every figure checked against the run's receipts;
// the HTML is made first (render-html.ts) and is always one of the files; the PDF is printed from that same HTML on
// the desktop (pdf.ts); DOCX and XLSX are made by code (ooxml/). A manifest lists each file's sha256. The files are
// answer carries their bytes once, for the screen to offer as downloads; the vault keeps the report's blocks and each
// file's name, size and sha256, never the bytes (a later save makes the report again). venture.report.list lists them.
// The print happens before the record is written, never inside the vault's transaction; the transaction checks the
// draft is still the one rendered. Written for Chausar; nothing here is learned from an outside source.
import { createHash } from 'node:crypto';
import { check, type Context } from '../../../../contracts.ts';
import type { ReportRecord, VentureDeps } from '../../../contracts.ts';
import { copiedTokens, exactPayload, formatVentureDate, identifier, listRecords, readVenture, ventureAction } from '../../../records.ts';
import { clientDraft } from '../../../build/draft-text.ts';
import { todayIso, ventureReceipts } from '../../../delivery/shared.ts';
import { writeDocx } from '../ooxml/docx.ts';
import { writeXlsx, type XlsxCell } from '../ooxml/xlsx.ts';
import { blocksOfDraft, coverageOf, sourcesOf, titleEstimate } from './blocks.ts';
import { manifestOf } from './manifest.ts';
import { pdfOf } from './pdf.ts';
import { reportShareView } from './share.ts';
import { REPORT_WORDS, renderReportHtml } from './render-html.ts';
import type { ReportBlock, ReportFile, ReportFormat, ReportListItem, ReportListView, ReportView } from '../records-report.ts';
import { currencyMinorDigits } from '../../../../currency.ts';

/** The files a report can be made as, in the order they are listed. */
export const REPORT_FORMATS: readonly ReportFormat[] = Object.freeze(['html', 'pdf', 'docx', 'xlsx']);
/** What render makes when no formats are named: the HTML and, on the desktop, its PDF. */
const DEFAULT_FORMATS: readonly ReportFormat[] = Object.freeze(['html', 'pdf']);
/** The most a report's files may weigh together, kept in the vault. */
const MAX_REPORT_BYTES = 12_000_000;

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** A file name from the title: lower case letters, digits and dashes, or 'report'. */
function slug(title: string): string {
  return title.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '') || 'report';
}

/** The report as DOCX sections: each heading starts one; figures show their receipt; estimates and quotes say so. */
function docxSections(blocks: readonly ReportBlock[]): { heading: string; paragraphs: string[] }[] {
  const sections: { heading: string; paragraphs: string[] }[] = [];
  const current = () => sections.at(-1) ?? (sections.push({ heading: 'Report', paragraphs: [] }), sections[0]);
  for (const block of blocks) {
    if (block.kind === 'heading') { sections.push({ heading: block.estimate ? `${block.text} (${REPORT_WORDS.estimate.toLowerCase()})` : block.text, paragraphs: [] }); continue; }
    const into = current().paragraphs;
    if (block.kind === 'prose') into.push(block.estimate ? `${block.text} (${REPORT_WORDS.estimate.toLowerCase()})` : block.text);
    else if (block.kind === 'metric') into.push(`${block.label}: ${block.display} (receipt ${block.receiptId})`);
    else if (block.kind === 'bars') into.push(block.label, ...block.bars.map(bar => `${bar.label}: ${bar.display} (receipt ${bar.receiptId})`));
    else into.push(`"${block.text}"${block.by ? `, ${block.by}` : ''} (${REPORT_WORDS.asWritten.toLowerCase()})`);
  }
  return sections;
}

/** The report's figures as one sheet: each metric and bar, its value (money as text with its decimals), scope and receipt. */
function figureRows(blocks: readonly ReportBlock[], currency: string, minors: Map<string, string>): XlsxCell[][] {
  const rows: XlsxCell[][] = [['Figure', 'Value', 'Channel', 'From', 'To', 'Receipt']];
  const value = (receiptId: string, key: string, unit: string, display: string): XlsxCell => {
    const minor = minors.get(`${receiptId}|${key}`);
    if (minor !== undefined && unit === 'money') return { money: minor, digits: currencyMinorDigits(currency) };
    if (minor !== undefined && unit === 'count') return { count: minor };
    return display;
  };
  for (const block of blocks) {
    if (block.kind === 'metric') rows.push([block.label, value(block.receiptId, block.key, block.unit, block.display), block.channel, block.from, block.to, block.receiptId]);
    if (block.kind === 'bars') for (const bar of block.bars) rows.push([`${block.label}: ${bar.label}`, value(bar.receiptId, bar.key, 'text', bar.display), block.channel, block.from, block.to, bar.receiptId]);
  }
  if (rows.length === 1) rows.push(['This report has no figures.']);
  return rows;
}

/**
 * venture.report.render { runId, formats? } (prepare): a report of one run's draft, made as HTML (always) and any of
 * PDF, DOCX and XLSX asked for (HTML and PDF by default). A figure with no receipt the run has refuses
 * (REPORT_BLOCK_UNSOURCED) and nothing is kept. A PDF not made says why in notes.
 */
export async function reportRender(deps: VentureDeps, ctx: Context, payload: unknown): Promise<ReportView> {
  const body = exactPayload(payload, ['runId', 'formats'], ['runId']);
  const runId = identifier(body.runId, 'Draft');
  const asked = body.formats === undefined ? DEFAULT_FORMATS : body.formats;
  check(Array.isArray(asked) && asked.length >= 1 && asked.length <= REPORT_FORMATS.length && new Set(asked).size === asked.length
    && asked.every(format => (REPORT_FORMATS as readonly unknown[]).includes(format)), 'INVALID_VENTURE_REQUEST', 'Choose the report files from HTML, PDF, DOCX and XLSX.');
  const formats = REPORT_FORMATS.filter(format => format === 'html' || (asked as unknown[]).includes(format));
  const { state, venture } = readVenture(deps, ctx);
  const run = listRecords(state, 'venture-delivery-run', venture.id).find(item => item.id === runId);
  check(run, 'DELIVERY_NOT_FOUND', 'That draft was not found.');
  check(!run.practice, 'PRACTICE_DRAFT', 'A practice draft never goes to a client.');
  check(run.deliverable, 'REPORT_NOT_READY', 'This draft has nothing to make a report from yet.');
  const work = listRecords(state, 'venture-work-receipt', venture.id).filter(item => item.runRef.kind === 'delivery' && item.runRef.runId === run.id);
  const prices = ventureReceipts(state, venture.id);
  const sources = sourcesOf(work, prices);
  // Numbers the owner wrote (the order's request, the business idea) are the owner's, not a model's.
  const order = listRecords(state, 'venture-order', venture.id).find(item => item.id === run.orderId);
  const allowed = copiedTokens(order?.request ?? '', venture.idea);
  const blocks = blocksOfDraft(run.deliverable, sources, allowed);
  const draft = clientDraft(run);
  const titleNumbers = titleEstimate(draft.title, allowed);
  const today = todayIso(deps, venture);
  const asOf = venture.country ? formatVentureDate(today, venture.country.dateOrder) : today;
  const html = renderReportHtml({ title: draft.title, titleEstimate: titleNumbers, business: venture.workingName, asOf, blocks });
  const name = slug(draft.title);
  const made: { format: ReportFormat; bytes: Uint8Array }[] = [{ format: 'html', bytes: new Uint8Array(Buffer.from(html, 'utf8')) }];
  const notes: string[] = [];
  if (formats.includes('pdf')) {
    const printed = await pdfOf(deps, html);
    if (printed.pdf) made.push({ format: 'pdf', bytes: printed.pdf });
    if (printed.note) notes.push(printed.note);
  }
  if (formats.includes('docx')) made.push({ format: 'docx', bytes: writeDocx({ cover: { title: titleNumbers ? `${draft.title} (${REPORT_WORDS.estimate.toLowerCase()})` : draft.title, lines: [`${REPORT_WORDS.preparedBy} ${venture.workingName}`, `${REPORT_WORDS.asOf} ${asOf}`] }, sections: docxSections(blocks) }) });
  if (formats.includes('xlsx')) {
    const minors = new Map(sources.flatMap(source => source.figures.map(figure => [`${source.id}|${figure.key}`, figure.minor] as const)));
    const currency = venture.country?.currency ?? 'INR';
    made.push({ format: 'xlsx', bytes: writeXlsx({ sheets: [{ name: 'Figures', rows: figureRows(blocks, currency, minors) }] }) });
  }
  const files: ReportFile[] = made.map(file => ({
    name: `${name}.${file.format}`, format: file.format, bytes: file.bytes.length, sha256: sha256(file.bytes), contentBase64: Buffer.from(file.bytes).toString('base64'),
  }));
  const manifest = manifestOf(made.map(file => ({ name: `${name}.${file.format}`, bytes: file.bytes })));
  const manifestBytes = new Uint8Array(Buffer.from(manifest.text, 'utf8'));
  check(made.reduce((sum, file) => sum + file.bytes.length, manifestBytes.length) <= MAX_REPORT_BYTES, 'REPORT_TOO_LARGE', 'This report is too large to keep. Make it with fewer files.');
  const receiptIds = [...new Set(blocks.flatMap(block => block.kind === 'metric' ? [block.receiptId] : block.kind === 'bars' ? block.bars.map(bar => bar.receiptId) : []))];
  const coverage = coverageOf(blocks);
  return ventureAction(deps, ctx, 'prepare', 'report.render', tx => {
    const now = tx.find('venture-delivery-run', run.id);
    check(now && clientDraft(now).digest === draft.digest, 'REPORT_STALE', 'The draft changed while the report was being made. Make it again.');
    const record = tx.put<ReportRecord>({
      ...tx.base('venture-report'), runId: run.id, orderId: run.orderId, clientId: tx.find('venture-order', run.orderId)?.clientId ?? null,
      title: draft.title, titleEstimate: titleNumbers, draftDigest: draft.digest, formats: [...formats], blocks, receiptIds, channels: coverage.channels,
      period: coverage.period, files: files.map(({ contentBase64: _bytes, ...meta }) => meta), manifest: { name: 'manifest.json', bytes: manifestBytes.length, sha256: sha256(manifestBytes) },
      notes,
    });
    // The bytes go to the screen once and are never kept: a later save makes the report again.
    return {
      id: record.id, runId: record.runId, title: record.title, formats: record.formats, files, notes: record.notes,
      manifest: { ...record.manifest, contentBase64: Buffer.from(manifestBytes).toString('base64') },
      channels: record.channels, period: record.period, estimates: estimatesOf(record),
    };
  });
}

/** How many lines of a report are model estimates: its title, headings and prose with a number no receipt backs. */
function estimatesOf(report: Pick<ReportRecord, 'titleEstimate' | 'blocks'>): number {
  return (report.titleEstimate ? 1 : 0) + report.blocks.filter(block => (block.kind === 'prose' || block.kind === 'heading') && block.estimate).length;
}

/**
 * venture.report.list { orderId? | runId? } (read): the business's reports, newest first, for one order or one run when
 * named (both at once refuses), each with every link to it: its state, views and end date, never its address or token.
 */
export async function reportList(deps: VentureDeps, ctx: Context, payload: unknown): Promise<ReportListView> {
  const body = exactPayload(payload ?? {}, ['orderId', 'runId']);
  check(body.orderId === undefined || body.runId === undefined, 'INVALID_VENTURE_REQUEST', 'Name an order or a draft, not both.');
  const orderId = body.orderId === undefined ? undefined : identifier(body.orderId, 'Order');
  const runId = body.runId === undefined ? undefined : identifier(body.runId, 'Draft');
  const { state, venture } = readVenture(deps, ctx);
  const now = deps.clock().toISOString();
  const links = listRecords(state, 'venture-report-share', venture.id);
  const reports = listRecords(state, 'venture-report', venture.id)
    .filter(report => (orderId === undefined || report.orderId === orderId) && (runId === undefined || report.runId === runId))
    .reverse();
  return {
    reports: reports.map((report): ReportListItem => ({
      id: report.id, runId: report.runId, orderId: report.orderId, title: report.title, at: report.at, formats: [...report.formats],
      files: report.files.map(file => ({ ...file })), manifest: { ...report.manifest }, notes: [...report.notes], channels: [...report.channels],
      period: report.period, estimates: estimatesOf(report),
      links: links.filter(link => link.reportId === report.id).reverse().map(link => reportShareView(link, now)),
    })),
  };
}
