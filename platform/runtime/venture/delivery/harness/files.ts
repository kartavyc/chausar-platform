// Chausar delivery harness: the files a client sends with an order, and the tables the agent's tools read from them.
// Files live in the vault as client data. CSV, XLSX and transcripts (SRT or VTT, read as timed lines with segment ids)
// are read by code in this process; PDF text comes from the
// trusted Python helper (pdf.extract). The shared hosted server never runs the Python helper, so there a PDF is refused
// before it is stored. Practice files for rehearsal are made up by Chausar and never stored. On the desktop a YouTube
// order's transcript can also be made on this computer from the cut named at intake (venture.files.transcribe).
import { audit, check, ChausarError, type Context } from '../../../contracts.ts';
import { localPathProblem } from '../../../speech.ts';
import { readWorkbook } from '../../../workbook.ts';
import { digest, exactPayload, findRecord, identifier, listRecords, requireAppChannel, singleLine, ventureAction } from '../../records.ts';
import type { UploadFormat, UploadRecord, UploadView, VentureDeps, WorkTableRecord, WorkTableRow } from '../../contracts.ts';
import { readAs } from '../shared.ts';
import { csvRows } from './cells.ts';
import { dictionaryEntries, ownerDefinitions } from './dictionary.ts';
import { parseTranscript, type Cue } from '../../playbooks/youtube/transcript.ts';
import { HOSTED_NO_TRANSCRIBE, makeLocalTranscript, transcriptName, transcriptPrompt } from '../../playbooks/youtube/transcribe.ts';

/** Fits one desktop request (two million bytes) once encoded. */
export const MAX_UPLOAD_BYTES = 1_450_000;
export const MAX_UPLOADS_PER_ORDER = 10;
export const MAX_FILE_ROWS = 5000;
export const MAX_CELL_CHARS = 500;
/** Why the hosted web server takes no PDFs: their text needs the Python helper, which never runs on a shared server. */
export const HOSTED_NO_PDF = "The shared hosted server can't read PDFs: that needs Chausar's Python helper, which never runs there. Add the bills as CSV or XLSX, or use the desktop app.";

/** An upload as the tools see it: a stored client file, or a practice file Chausar made up. */
export type FileLike = Pick<UploadRecord, 'id' | 'name' | 'format' | 'bytes' | 'digest' | 'contentBase64' | 'clientData'>;
/**
 * A table the agent can address by id: rows read from a file, or a table a tool made earlier in the run. origin says
 * where its cells came from: a client file, bills picked from PDFs (amounts chosen from what code read), a program
 * (labels and keys only, never amounts), or code that worked a table out from the client's files (a ranked list of
 * hooks, an edit list). madeFrom is the table a program read.
 */
export type SourceTable = {
  id: string; name: string; columns: string[]; rows: WorkTableRow[]; digest: string; kind: 'file' | 'work'; uploadId: string | null;
  origin: 'file' | 'transform' | 'picked' | 'computed'; madeFrom: string | null;
};

export function uploadView(record: UploadRecord): UploadView {
  const { contentBase64: _content, ...view } = record;
  return view;
}

/** The format from the name and the first bytes. A name that disagrees with the content is refused. */
export function sniffFormat(name: string, bytes: Uint8Array): UploadFormat {
  const lower = name.toLowerCase();
  const head = Buffer.from(bytes.subarray(0, 5)).toString('latin1');
  if (lower.endsWith('.pdf')) { check(head === '%PDF-', 'UNSUPPORTED_UPLOAD', 'This file is named .pdf but is not a PDF.'); return 'pdf'; }
  if (lower.endsWith('.xlsx')) { check(head.startsWith('PK\u0003\u0004'), 'UNSUPPORTED_UPLOAD', 'This file is named .xlsx but is not an XLSX workbook.'); return 'xlsx'; }
  if (lower.endsWith('.csv') || lower.endsWith('.txt')) {
    try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw new ChausarError('UNSUPPORTED_UPLOAD', 'This CSV is not UTF-8 text. Save it as CSV UTF-8 and add it again.'); }
    return 'csv';
  }
  if (lower.endsWith('.srt') || lower.endsWith('.vtt')) {
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw new ChausarError('UNSUPPORTED_UPLOAD', 'This transcript is not UTF-8 text. Export it again as SRT or VTT in UTF-8 and add it again.'); }
    check(parseTranscript(text).length > 0, 'UNSUPPORTED_UPLOAD', 'This transcript has no timed lines. Export it again as SRT or VTT and add it again.');
    return 'transcript';
  }
  throw new ChausarError('UNSUPPORTED_UPLOAD', 'Add a CSV, XLSX or PDF file, or a transcript as SRT or VTT. Photos and scans need a reader this build does not have.');
}

/** A transcript's lines in file order, each with its segment id (seg-1, seg-2 ...), the only way agents name a moment. */
export function transcriptCues(file: FileLike): Cue[] {
  check(file.format === 'transcript', 'TOOL_FAILED', `${file.name} is not a transcript.`);
  return parseTranscript(Buffer.from(file.contentBase64, 'base64').toString('utf8'));
}

/** venture.files.add { orderId, name, contentBase64 } (app only): one client file for an order, kept in the vault. */
export async function filesAddHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<UploadView> {
  requireAppChannel(ctx, 'venture.files.add');
  const body = exactPayload(payload, ['orderId', 'name', 'contentBase64'], ['orderId', 'name', 'contentBase64']);
  const orderId = identifier(body.orderId, 'Order');
  const name = singleLine(body.name, 'File name', { max: 120 });
  const encoded = body.contentBase64;
  check(typeof encoded === 'string' && encoded.length > 0 && encoded.length <= Math.ceil(MAX_UPLOAD_BYTES / 3) * 4 && /^[A-Za-z0-9+/]*={0,2}$/.test(encoded),
    'UPLOAD_LIMIT', 'Add a file smaller than one and a half megabytes.');
  const bytes = Buffer.from(encoded, 'base64');
  check(bytes.length > 0 && bytes.length <= MAX_UPLOAD_BYTES, 'UPLOAD_LIMIT', 'Add a file smaller than one and a half megabytes.');
  const format = sniffFormat(name, bytes);
  check(!(format === 'pdf' && deps.host === 'hosted-web'), 'TIER_UNAVAILABLE', HOSTED_NO_PDF);
  const file: FileLike = { id: 'upload_check', name, format, bytes: bytes.length, digest: digest(encoded), contentBase64: encoded, clientData: true };
  if (format === 'csv' || format === 'xlsx') tablesOfFile(file); // refuse a file the tools could never read, before it is stored
  readAs(deps, ctx, 'prepare');
  return ventureAction(deps, ctx, 'prepare', 'files.add', tx => {
    const order = tx.find('venture-order', orderId);
    check(order, 'ORDER_NOT_FOUND', 'That order was not found.');
    const existing = tx.list('venture-upload').filter(upload => upload.scope.kind === 'order' && upload.scope.orderId === orderId);
    check(existing.length < MAX_UPLOADS_PER_ORDER, 'UPLOAD_LIMIT', `An order holds at most ${MAX_UPLOADS_PER_ORDER} files.`);
    const record: UploadRecord = {
      ...tx.base('venture-upload'), name, format, bytes: bytes.length, digest: file.digest, contentBase64: encoded,
      scope: { kind: 'order', orderId }, clientData: true,
    };
    tx.put(record);
    // The event never carries the file name: it can hold a client's name.
    tx.emit('upload-added', { uploadId: record.id, orderId, format });
    return uploadView(record);
  });
}

/** One transcript per order, and room for it among the order's files. */
function roomForTranscript(uploads: readonly UploadRecord[]): void {
  check(!uploads.some(upload => upload.format === 'transcript'), 'TRANSCRIPT_EXISTS', 'This order already has a transcript.');
  check(uploads.length < MAX_UPLOADS_PER_ORDER, 'UPLOAD_LIMIT', `An order holds at most ${MAX_UPLOADS_PER_ORDER} files.`);
}

/**
 * venture.files.transcribe { orderId } (app only, desktop): the order's transcript made on this computer from the
 * cut named at intake, by the ffmpeg and whisper.cpp already here (playbooks/youtube/transcribe.ts). It is kept as
 * the order's transcript, client data, marked as made here. Refused plainly when either program is missing.
 */
export async function filesTranscribeHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<UploadView> {
  requireAppChannel(ctx, 'venture.files.transcribe');
  const body = exactPayload(payload, ['orderId'], ['orderId']);
  const orderId = identifier(body.orderId, 'Order');
  check(deps.host !== 'hosted-web', 'TIER_UNAVAILABLE', HOSTED_NO_TRANSCRIBE);
  const { state, venture } = readAs(deps, ctx, 'prepare');
  const order = findRecord(state, 'venture-order', orderId);
  check(order && order.ventureId === venture.id, 'ORDER_NOT_FOUND', 'That order was not found.');
  const cutFile = order.intake?.cutFile ?? null;
  check(cutFile, 'INVALID_VENTURE_REQUEST', 'This order names no finished cut on this computer. Add the transcript as an SRT or VTT file instead.');
  const problem = localPathProblem(cutFile);
  check(!problem, 'INVALID_VENTURE_REQUEST', `The cut: ${problem}`);
  const ofOrder =(uploads: readonly UploadRecord[]) => uploads.filter(upload => upload.scope.kind === 'order' && upload.scope.orderId === orderId);
  roomForTranscript(ofOrder(listRecords(state, 'venture-upload', venture.id)));
  const prompt = transcriptPrompt(dictionaryEntries(state, venture, {}, ownerDefinitions(deps, ctx)));
  const made = await makeLocalTranscript(deps, ctx, { cutFile, prompt });
  const bytes = Buffer.byteLength(made.srt, 'utf8');
  check(bytes <= MAX_UPLOAD_BYTES, 'UPLOAD_LIMIT', 'The transcript is larger than an order file can be, one and a half megabytes. Nothing was kept.');
  const encoded = Buffer.from(made.srt, 'utf8').toString('base64');
  const name = transcriptName(cutFile);
  return ventureAction(deps, ctx, 'prepare', 'files.transcribe', tx => {
    check(tx.find('venture-order', orderId), 'ORDER_NOT_FOUND', 'That order was not found.');
    roomForTranscript(ofOrder(tx.list('venture-upload')));
    const record: UploadRecord = {
      ...tx.base('venture-upload'), name, format: 'transcript', bytes, digest: digest(encoded), contentBase64: encoded,
      scope: { kind: 'order', orderId }, clientData: true, origin: 'local-transcription',
    };
    tx.put(record);
    // The activity row goes in with the upload, so there is never one for a transcript that was not kept.
    audit(tx.state, 'speech.file.transcribed', { uploadId: record.id, orderId, providerId: made.providerId, cues: made.cues });
    // The event never carries the file name: it can hold a client's name.
    tx.emit('upload-added', { uploadId: record.id, orderId, format: 'transcript' });
    return uploadView(record);
  });
}

/** venture.files.list { orderId? }: files without their content, oldest first. */
export async function filesListHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<UploadView[]> {
  const body = exactPayload(payload, ['orderId']);
  const orderId = body.orderId === undefined ? null : identifier(body.orderId, 'Order');
  const { state, venture } = readAs(deps, ctx, 'read');
  return listRecords(state, 'venture-upload', venture.id)
    .filter(upload => orderId === null || (upload.scope.kind === 'order' && upload.scope.orderId === orderId))
    .map(uploadView);
}

function namedColumns(header: readonly string[]): string[] {
  const used = new Set<string>();
  return header.map((raw, index) => {
    const base = raw.trim().replace(/\s+/g, ' ').slice(0, 60) || `Column ${index + 1}`;
    let name = base, n = 2;
    while (used.has(name)) { name = `${base} (${n})`; n += 1; }
    used.add(name);
    return name;
  });
}

function tableFrom(id: string, name: string, grid: string[][], uploadId: string): SourceTable {
  const start = grid.findIndex(row => row.some(cell => cell.trim().length));
  check(start >= 0, 'TOOL_FAILED', `${name} has no rows.`);
  const width = Math.max(...grid.slice(start).map(row => row.length));
  const header = namedColumns(Array.from({ length: width }, (_, i) => grid[start][i] ?? ''));
  const body = grid.slice(start + 1).filter(row => row.some(cell => cell.trim().length));
  check(body.length <= MAX_FILE_ROWS, 'TOOL_FAILED', `${name} has more than ${MAX_FILE_ROWS} rows.`);
  const rows: WorkTableRow[] = body.map((row, index) => ({
    id: `r${index + 1}`,
    cells: Object.fromEntries(header.map((column, i) => [column, (row[i] ?? '').trim().slice(0, MAX_CELL_CHARS)])),
  }));
  return { id, name, columns: header, rows, digest: digest({ header, rows }), kind: 'file', uploadId, origin: 'file', madeFrom: null };
}

const tableCache = new Map<string, SourceTable[]>();

/** The tables in a CSV (one) or an XLSX workbook (one per sheet with data). Cached by content digest. */
export function tablesOfFile(file: FileLike): SourceTable[] {
  check(file.format !== 'pdf', 'TOOL_FAILED', 'A PDF has pages, not tables. Read its text instead.');
  check(file.format !== 'transcript', 'TOOL_FAILED', 'A transcript has timed lines, not tables. Read its lines instead.');
  const key = `${file.id}:${file.digest}`;
  const cached = tableCache.get(key);
  if (cached) return cached;
  const bytes = Buffer.from(file.contentBase64, 'base64');
  let tables: SourceTable[];
  if (file.format === 'csv') {
    let grid: string[][];
    try { grid = csvRows(bytes.toString('utf8')); } catch (error) { throw new ChausarError('TOOL_FAILED', `${file.name} is not a readable CSV: ${(error as Error).message}`); }
    tables = [tableFrom(file.id, file.name, grid, file.id)];
  } else {
    let workbook;
    try { workbook = readWorkbook(new Uint8Array(bytes)); } catch (error) {
      throw new ChausarError('TOOL_FAILED', `${file.name} could not be read: ${error instanceof ChausarError ? error.message : 'the workbook is damaged.'}`);
    }
    tables = workbook.sheets
      .map((sheet, index) => ({ sheet, index }))
      .filter(({ sheet }) => sheet.rows.some(row => row.some(cell => cell.trim().length)))
      .map(({ sheet, index }) => tableFrom(`${file.id}.s${index + 1}`, `${file.name} (${sheet.name})`, sheet.rows, file.id));
    check(tables.length > 0, 'TOOL_FAILED', `${file.name} has no sheet with data.`);
  }
  if (tableCache.size > 32) tableCache.delete(tableCache.keys().next().value!);
  tableCache.set(key, tables);
  return tables;
}

/** A table a tool made earlier, in the shape the tools read. */
export function tableOfRecord(record: WorkTableRecord): SourceTable {
  return {
    id: record.id, name: record.name, columns: [...record.columns], rows: record.rows, digest: record.digest, kind: 'work', uploadId: null,
    origin: record.source.kind, madeFrom: record.source.kind === 'transform' ? record.source.fromTableId : null,
  };
}

export type PdfPages = { pages: { page: number; text: string }[]; coverage: string };
const pdfCache = new Map<string, PdfPages>();

/**
 * PDF text through the trusted Python helper. Refuses honestly when the helper or its PDF library is missing, and
 * always on the hosted web server, where the helper never runs.
 */
export async function pdfPages(deps: VentureDeps, file: FileLike): Promise<PdfPages> {
  check(deps.host !== 'hosted-web', 'TIER_UNAVAILABLE', HOSTED_NO_PDF);
  check(file.format === 'pdf', 'TOOL_FAILED', 'Only a PDF has pages to read.');
  const cached = pdfCache.get(file.digest);
  if (cached) return cached;
  const helper = deps.services.helper;
  check(helper, 'TOOL_FAILED', 'Reading PDFs needs the Python helper, which is not set up on this computer.');
  let output: { result: any };
  try { output = await helper.run('pdf.extract', { pdfBase64: file.contentBase64, maxPages: 20 }); } catch (error) {
    const code = (error as { code?: unknown })?.code;
    const why = code === 'PYTHON_UNAVAILABLE' ? 'Reading PDFs needs Python on this computer, set up for Chausar.'
      : code === 'PDF_DEPENDENCY_UNAVAILABLE' ? 'Reading PDFs needs the pdfplumber library in Chausar\'s Python.'
        : code === 'PDF_PAGE_LIMIT' ? `${file.name} has more pages than the reader takes.`
          : `${file.name} could not be read as a PDF.`;
    throw new ChausarError('TOOL_FAILED', why);
  }
  const pages = output?.result?.pages;
  check(Array.isArray(pages) && pages.every((page: any) => Number.isInteger(page?.page) && typeof page?.text === 'string'), 'TOOL_FAILED', 'The PDF reader returned something Chausar could not read.');
  const result: PdfPages = {
    pages: pages.map((page: any) => ({ page: page.page, text: String(page.text).slice(0, 20000) })),
    coverage: typeof output.result.coverage === 'string' ? output.result.coverage : 'Text extraction only.',
  };
  if (pdfCache.size > 16) pdfCache.delete(pdfCache.keys().next().value!);
  pdfCache.set(file.digest, result);
  return result;
}
