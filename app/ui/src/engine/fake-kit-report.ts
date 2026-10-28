/**
 * The fake engine's answers for client reports and their share links (Ink v2 wave 5, package 5A5), in the engine's
 * shapes, codes, words and order (platform/runtime/venture/playbooks/kit/report/methods.ts and share.ts). The fake has
 * no receipts of its own, so its sample keeps two social figures for episode 12's script (Instagram in September,
 * LinkedIn in August) and, for episode 14's, a figure with no receipt (REPORT_BLOCK_UNSOURCED). Prose with a number is
 * a model estimate. Reports are kept without their bytes, as the engine keeps them (venture.report.list). It
 * answers as the local web app does: no print port, so a PDF says "A PDF needs the desktop app."; DOCX and XLSX are real
 * (stored, not deflated) zips. Share links get an address only when the fake answers as the hosted app. Written for
 * Chausar; nothing is learned from an outside source.
 */

import { EngineError } from './types';
import { reportNumberEstimate } from './fake-report-numbers';
import type { CaView, DeliveryLite, ReportFileView, ReportFormat, ReportListItem, ReportListView, ReportShareView, ReportView } from './types';
import type { W4DeskHost } from './fake-w4';

const METHODS = new Set<string>([
  'venture.report.render',
  'venture.report.share',
  'venture.report.shareRotate',
  'venture.report.shareDisable',
  'venture.report.list',
]);
const FORMATS: readonly ReportFormat[] = ['html', 'pdf', 'docx', 'xlsx'];
const WORDS = {
  exact: 'Send the required fields and nothing else.',
  formats: 'Choose the report files from HTML, PDF, DOCX and XLSX.',
  noDraft: 'That draft was not found.',
  practice: 'A practice draft never goes to a client.',
  notReady: 'This draft has nothing to make a report from yet.',
  hosted: 'A PDF needs the desktop app.',
  noReport: 'That report was not found. Make it again.',
  noShare: 'That report link was not found.',
  disabledShare: 'This link is turned off. Share the report again for a new one.',
  order: 'The link ends on or after the day it starts.',
  channels: 'Choose up to 20 channels by name.',
  shareNotReady: 'Only a draft you accepted, or one ready for you to accept, can go to your client.',
  notServed: 'Report links open only on the hosted Chausar with a public address. Send your client the report file yourself.',
  shownOnce: 'The link was shown once, when it was made.',
  disabled: 'You turned this link off. It no longer opens.',
  ended: 'This link has ended. Rotate it to share the report again.',
  trial: "A temporary business can't share links or send alerts from this server. Add your email to keep this business, then you can.",
  unsourced: 'A figure in this report has no receipt, so the report was not made. Every number a report shows comes from a receipt.',
  stale: 'The draft changed after this report was made. Make the report again, then share it.',
  both: 'Name an order or a draft, not both.',
  caNone: 'These are regulated papers. Name your CA of record, who signs them off before you accept or share them.',
  caNotSent: 'These regulated papers have not gone to your CA yet. Send them to your CA, who signs them off before you accept or share them.',
  caSent: 'These regulated papers are with your CA, waiting for the sign-off. You accept or share them once your CA signs.',
  caReturned: 'Your CA returned these papers, so they cannot be accepted or shared. Draft them again.',
} as const;
const SHARE_HOURS = 720;
const ISO_DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

const invalid = (message: string) => new EngineError('INVALID_VENTURE_REQUEST', message);
function exact(p: Record<string, unknown>, allowed: readonly string[], required: readonly string[]): void {
  if (!Object.keys(p).every((key) => allowed.includes(key)) || !required.every((key) => Object.hasOwn(p, key))) throw invalid(WORDS.exact);
}
function id(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.:-]{1,200}$/.test(value)) throw invalid(`${field} must be a known identifier.`);
  return value;
}

const utf8 = (text: string) => new TextEncoder().encode(text);
function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(binary);
}
const escapeXml = (value: string) => value.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[ch]!);
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

const CRC = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
  return table;
})();
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
type Field = readonly [at: number, value: number, size: 2 | 4];
function header(size: number, fields: readonly Field[]): Uint8Array {
  const view = new DataView(new ArrayBuffer(size));
  for (const [at, value, bytes] of fields) { if (bytes === 4) view.setUint32(at, value, true); else view.setUint16(at, value, true); }
  return new Uint8Array(view.buffer);
}
/** A zip of stored entries, with UTF-8 names and the date 1 Jan 1980 (the engine deflates; a fake need not). */
function storedZip(files: { name: string; text: string }[]): Uint8Array {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = utf8(file.name), data = utf8(file.text), crc = crc32(data);
    parts.push(header(30, [[0, 0x04034b50, 4], [4, 20, 2], [6, 0x0800, 2], [12, 0x21, 2], [14, crc, 4], [18, data.length, 4], [22, data.length, 4], [26, name.length, 2]]), name, data);
    central.push(header(46, [[0, 0x02014b50, 4], [4, 20, 2], [6, 20, 2], [8, 0x0800, 2], [14, 0x21, 2], [16, crc, 4], [20, data.length, 4], [24, data.length, 4], [28, name.length, 2], [42, offset, 4]]), name);
    offset += 30 + name.length + data.length;
  }
  const size = central.reduce((sum, part) => sum + part.length, 0);
  const all = [...parts, ...central, header(22, [[0, 0x06054b50, 4], [8, files.length, 2], [10, files.length, 2], [12, size, 4], [16, offset, 4]])];
  const out = new Uint8Array(all.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of all) { out.set(part, at); at += part.length; }
  return out;
}

const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG = 'http://schemas.openxmlformats.org/package/2006/relationships';
const TYPES = 'http://schemas.openxmlformats.org/package/2006/content-types';
const DEFAULTS = '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>';
function docx(title: string, lines: string[]): Uint8Array {
  const para = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
  return storedZip([
    { name: '[Content_Types].xml', text: `${HEAD}<Types xmlns="${TYPES}">${DEFAULTS}<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>` },
    { name: '_rels/.rels', text: `${HEAD}<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/></Relationships>` },
    { name: 'word/document.xml', text: `${HEAD}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${[title, ...lines].map(para).join('')}<w:sectPr/></w:body></w:document>` },
  ]);
}
function xlsx(figures: readonly SampleFigure[]): Uint8Array {
  const main = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const cell = (ref: string, text: string) => `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(text)}</t></is></c>`;
  const head = ['Figure', 'Value', 'Channel', 'From', 'To', 'Receipt'].map((text, index) => cell(`${'ABCDEF'[index]}1`, text)).join('');
  return storedZip([
    { name: '[Content_Types].xml', text: `${HEAD}<Types xmlns="${TYPES}">${DEFAULTS}<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>` },
    { name: '_rels/.rels', text: `${HEAD}<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: 'xl/workbook.xml', text: `${HEAD}<workbook xmlns="${main}" xmlns:r="${REL}"><sheets><sheet name="Figures" sheetId="1" r:id="rId1"/></sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', text: `${HEAD}<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>` },
    { name: 'xl/worksheets/sheet1.xml', text: `${HEAD}<worksheet xmlns="${main}"><sheetData><row r="1">${head}</row>${figures.length ? figures.map((figure, index) => `<row r="${index + 2}">${[figure.label, figure.display.replace(/,/g, ''), figure.channel, figure.from, figure.to, figure.receiptId ?? ''].map((text, column) => cell(`${'ABCDEF'[column]}${index + 2}`, text)).join('')}</row>`).join('') : `<row r="2">${cell('A2', 'This report has no figures.')}</row>`}</sheetData></worksheet>` },
  ]);
}

/** One figure of the fake's sample, as a social report receipt gives it: its channel and its month. */
type SampleFigure = { label: string; display: string; channel: string; from: string; to: string; receiptId: string | null };
/** The sample's figures by draft: a receipt each for episode 12; none for episode 14's, so it refuses as the engine does. */
const FIGURES: Readonly<Record<string, readonly SampleFigure[]>> = {
  'd-ep12-script': [
    { label: 'Instagram views', display: '12,400', channel: 'instagram', from: '2026-09-01', to: '2026-09-30', receiptId: 'receipt_fake_social' },
    { label: 'LinkedIn views', display: '3,100', channel: 'linkedin', from: '2026-08-01', to: '2026-08-31', receiptId: 'receipt_fake_social' },
  ],
  'd-ep14-script': [{ label: 'Downloads', display: '900', channel: 'youtube', from: '2026-10-01', to: '2026-10-31', receiptId: null }],
};

type HeldReport = Omit<ReportView, 'files' | 'manifest'> & {
  businessId: string; orderId: string; at: string; draftDigest: string;
  files: Omit<ReportFileView, 'contentBase64'>[]; manifest: { name: 'manifest.json'; bytes: number; sha256: string };
};
type HeldShare = Omit<ReportShareView, 'url' | 'reason' | 'state'> & { businessId: string; state: 'open' | 'disabled'; served: boolean };

export class FakeKitReportDesk {
  protected readonly host: W4DeskHost;
  protected readonly fresh: boolean;
  private readonly reports: HeldReport[] = [];
  private readonly shares: HeldShare[] = [];
  private seq = 0;

  constructor(host: W4DeskHost, options: { fresh?: boolean } = {}) {
    this.host = host;
    this.fresh = options.fresh ?? false;
  }

  handles(method: string): boolean {
    return METHODS.has(method);
  }

  request(method: string, p: Record<string, unknown>): unknown {
    switch (method) {
      case 'venture.report.render': return this.render(p);
      case 'venture.report.list': return this.list(p);
      case 'venture.report.share': return this.share(p);
      case 'venture.report.shareRotate': return this.rotate(p);
      default: return this.disable(p);
    }
  }

  private draft(runId: string): DeliveryLite {
    const run = (this.host.ask('venture.delivery.list', {}) as DeliveryLite[]).find((item) => item.id === runId);
    if (!run) throw new EngineError('DELIVERY_NOT_FOUND', WORDS.noDraft);
    return run;
  }

  /** The words a client sees of a draft, as the engine's clientDraft picks them. */
  private wordsOf(run: DeliveryLite): string {
    return ((run.status === 'edited' || run.status === 'accepted') && run.editedText ? run.editedText : run.renderedText) ?? '';
  }

  private render(p: Record<string, unknown>): ReportView {
    exact(p, ['runId', 'formats'], ['runId']);
    const runId = id(p.runId, 'Draft');
    const asked = p.formats === undefined ? ['html', 'pdf'] : p.formats;
    if (!Array.isArray(asked) || asked.length < 1 || asked.length > 4 || new Set(asked).size !== asked.length || !asked.every((format) => (FORMATS as readonly unknown[]).includes(format))) throw invalid(WORDS.formats);
    const formats = FORMATS.filter((format) => format === 'html' || asked.includes(format));
    const run = this.draft(runId);
    if (run.practice) throw new EngineError('PRACTICE_DRAFT', WORDS.practice);
    if (!run.deliverable) throw new EngineError('REPORT_NOT_READY', WORDS.notReady);
    const edited = (run.status === 'edited' || run.status === 'accepted') && !!run.editedText;
    const figures = edited ? [] : FIGURES[runId] ?? [];
    if (figures.some((figure) => figure.receiptId === null)) throw new EngineError('REPORT_BLOCK_UNSOURCED', WORDS.unsourced);
    const title = run.deliverable.title;
    const words = this.wordsOf(run);
    const paragraphs = words.split(/\n\s*\n/).map((line) => line.trim()).filter(Boolean);
    const estimate = reportNumberEstimate;
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body><main><h1>${escapeHtml(title)}</h1>`
      + (estimate(title) ? '<p class="note">Model estimate</p>' : '')
      + paragraphs.map((line) => `<p>${escapeHtml(line)}</p>${estimate(line) ? '<p class="note">Model estimate</p>' : ''}`).join('')
      + figures.map((figure) => `<div class="metric"><p>${escapeHtml(figure.label)}</p><p>${escapeHtml(figure.display)}</p><p class="src">Receipt ${figure.receiptId ?? ''}</p></div>`).join('')
      + '</main></body></html>\n';
    const name = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'report';
    const made: { format: ReportFormat; bytes: Uint8Array }[] = [{ format: 'html', bytes: utf8(html) }];
    const notes: string[] = formats.includes('pdf') ? [WORDS.hosted] : [];
    if (formats.includes('docx')) made.push({ format: 'docx', bytes: docx(estimate(title) ? `${title} (model estimate)` : title, [...paragraphs.map(line => estimate(line) ? `${line} (model estimate)` : line), ...figures.map((figure) => `${figure.label}: ${figure.display} (receipt ${figure.receiptId ?? ''})`)]) });
    if (formats.includes('xlsx')) made.push({ format: 'xlsx', bytes: xlsx(figures) });
    const files: ReportFileView[] = made.map((file) => {
      const content = base64(file.bytes);
      return { name: `${name}.${file.format}`, format: file.format, bytes: file.bytes.length, sha256: this.host.digest(content), contentBase64: content };
    });
    const manifest = utf8(`${JSON.stringify({ format: 'chausar-report-manifest/1', files: files.map((file) => ({ name: file.name, bytes: file.bytes, sha256: file.sha256 })) }, null, 2)}\n`);
    const channels = [...new Set(figures.map((figure) => figure.channel))].sort();
    const period = figures.length ? { from: figures.map((figure) => figure.from).sort()[0]!, to: figures.map((figure) => figure.to).sort().at(-1)! } : null;
    const view: ReportView = {
      id: `report_fake${++this.seq}`, runId, title, formats, files,
      manifest: { name: 'manifest.json', bytes: manifest.length, sha256: this.host.digest(base64(manifest)), contentBase64: base64(manifest) },
      notes, channels, period, estimates: (estimate(title) ? 1 : 0) + paragraphs.filter(estimate).length,
    };
    // Kept as the engine keeps it: what the report is and each file's checksum, never the bytes.
    this.reports.push({
      ...view, businessId: this.host.current(), orderId: run.orderId, at: this.host.now(), draftDigest: words,
      files: files.map(({ contentBase64: _bytes, ...meta }) => meta), manifest: { name: 'manifest.json', bytes: view.manifest.bytes, sha256: view.manifest.sha256 },
    });
    return view;
  }

  private list(p: Record<string, unknown>): ReportListView {
    exact(p, ['orderId', 'runId'], []);
    if (p.orderId !== undefined && p.runId !== undefined) throw invalid(WORDS.both);
    const orderId = p.orderId === undefined ? undefined : id(p.orderId, 'Order');
    const runId = p.runId === undefined ? undefined : id(p.runId, 'Draft');
    const reports = this.reports.filter((report) => report.businessId === this.host.current() && (orderId === undefined || report.orderId === orderId) && (runId === undefined || report.runId === runId));
    return {
      reports: [...reports].reverse().map((report): ReportListItem => ({
        id: report.id, runId: report.runId, orderId: report.orderId, title: report.title, at: report.at, formats: [...report.formats],
        files: report.files.map((file) => ({ ...file })), manifest: { ...report.manifest }, notes: [...report.notes], channels: [...report.channels],
        period: report.period, estimates: report.estimates, links: this.shares.filter((link) => link.reportId === report.id).map((link) => this.view(link)),
      })),
    };
  }

  private view(held: HeldShare, url: string | null = null): ReportShareView {
    const state = held.state === 'disabled' ? 'disabled' : Date.parse(held.expiresAt) <= Date.parse(this.host.now()) ? 'ended' : 'open';
    const reason = url ? undefined : state === 'disabled' ? WORDS.disabled : !held.served ? WORDS.notServed : state === 'ended' ? WORDS.ended : WORDS.shownOnce;
    return {
      id: held.id, reportId: held.reportId, url, ...(reason ? { reason } : {}), from: held.from, to: held.to, channels: [...held.channels],
      state, expiresAt: held.expiresAt, views: held.views, viewedAt: held.viewedAt,
    };
  }

  /** A new address and thirty more days for a link; an address only when the fake answers as the hosted app. */
  private address(held: HeldShare): string | null {
    held.expiresAt = new Date(Date.parse(this.host.now()) + SHARE_HOURS * 3_600_000).toISOString();
    const token = `${this.host.digest(`${held.id}:${++this.seq}`)}${'x'.repeat(32)}`.replace(/[^A-Za-z0-9_-]/g, 'x').slice(0, 32);
    return held.served ? `https://chausar.test/share/${token}` : null;
  }

  /** The engine's checkSharable: the draft's state, practice, Accept now, the words unchanged, and a CA's sign-off. */
  private sharable(report: HeldReport): void {
    const run = this.draft(report.runId);
    if (!['ready-for-review', 'accepted', 'edited'].includes(run.status)) throw new EngineError('DELIVERY_NOT_READY', WORDS.shareNotReady);
    if (run.practice || run.practiceNow) throw new EngineError('PRACTICE_DRAFT', WORDS.practice);
    if (run.status === 'ready-for-review' && run.canAccept === false) throw new EngineError('DELIVERY_NOT_READY', run.acceptBlocked ?? WORDS.shareNotReady);
    if (this.wordsOf(run) !== report.draftDigest) throw new EngineError('REPORT_STALE', WORDS.stale);
    const ca = this.host.ask('venture.ca.get', {}) as CaView | null;
    const regulated = ca && (ca.latestPapers?.deliveryId === run.id || ca.requests.some((request) => request.deliveryId === run.id));
    if (!ca || !regulated) return;
    const request = ca.requests.find((item) => item.deliveryId === run.id);
    if (!ca.ca) throw new EngineError('CA_SIGNOFF_REQUIRED', WORDS.caNone);
    if (!request) throw new EngineError('CA_SIGNOFF_REQUIRED', WORDS.caNotSent);
    if (request.state === 'sent') throw new EngineError('CA_SIGNOFF_REQUIRED', WORDS.caSent);
    if (request.state === 'returned') throw new EngineError('CA_SIGNOFF_REQUIRED', WORDS.caReturned);
  }

  private share(p: Record<string, unknown>): ReportShareView {
    exact(p, ['reportId', 'from', 'to', 'channels'], ['reportId', 'from', 'to']);
    const reportId = id(p.reportId, 'Report');
    if (typeof p.from !== 'string' || !ISO_DATE.test(p.from)) throw invalid('From must be a date like 2026-10-15.');
    if (typeof p.to !== 'string' || !ISO_DATE.test(p.to)) throw invalid('To must be a date like 2026-10-15.');
    if (p.from > p.to) throw invalid(WORDS.order);
    if (p.channels !== undefined && (!Array.isArray(p.channels) || p.channels.length > 20 || !p.channels.every((item) => typeof item === 'string' && item.length >= 1 && item.length <= 40))) throw invalid(WORDS.channels);
    const report = this.reports.find((item) => item.id === reportId && item.businessId === this.host.current());
    if (!report) throw new EngineError('REPORT_NOT_FOUND', WORDS.noReport);
    const channels = p.channels === undefined ? [...report.channels] : [...new Set(p.channels as string[])].sort();
    const unknown = channels.filter((channel) => !report.channels.includes(channel));
    if (unknown.length) throw invalid(`This report has nothing from ${unknown.join(', ')}. Choose from ${report.channels.join(', ') || 'none'}.`);
    this.sharable(report);
    if (this.host.trial?.()) throw new EngineError('TRIAL_LIMIT', WORDS.trial);
    const held: HeldShare = {
      id: `reportshare_fake${++this.seq}`, reportId, businessId: this.host.current(), from: p.from, to: p.to, channels, state: 'open',
      served: this.host.hosted(), expiresAt: this.host.now(), views: 0, viewedAt: null,
    };
    const url = this.address(held);
    this.shares.unshift(held);
    return this.view(held, url);
  }

  private held(p: Record<string, unknown>): HeldShare {
    exact(p, ['shareId'], ['shareId']);
    const shareId = id(p.shareId, 'Link');
    const held = this.shares.find((item) => item.id === shareId && item.businessId === this.host.current());
    if (!held) throw new EngineError('REPORT_SHARE_NOT_FOUND', WORDS.noShare);
    return held;
  }

  private rotate(p: Record<string, unknown>): ReportShareView {
    const held = this.held(p);
    if (held.state === 'disabled') throw new EngineError('REPORT_SHARE_DISABLED', WORDS.disabledShare);
    const report = this.reports.find((item) => item.id === held.reportId);
    if (!report) throw new EngineError('REPORT_NOT_FOUND', WORDS.noReport);
    this.sharable(report);
    held.served = this.host.hosted();
    return this.view(held, this.address(held));
  }

  private disable(p: Record<string, unknown>): ReportShareView {
    const held = this.held(p);
    held.state = 'disabled';
    return this.view(held);
  }
}
