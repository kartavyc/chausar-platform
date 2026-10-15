/**
 * The checked boundary of the first-run journey: the engine methods each step names, the
 * payloads it sends, and a validator for every reply before anything is drawn.
 *
 * Steps and the engine methods they use (all existing in platform/runtime/engine.ts unless
 * marked `todayx`, the frame-today family whose engine module may not exist yet):
 *   FR-01/02  todayx.workspaces, todayx.identity.check (both before the vault), todayx.identity.save
 *             (after it), todayx.device.set (the language and view, once the vault exists)
 *   FR-03/04  todayx.diskCheck (before the vault); workspace.create and its recovery kit, through
 *             the host controller only
 *   FR-05     models.list, models.configure (an API key goes through the host's own adapter)
 *   FR-07     sources.preview, sources.import, sources.workbookPreview, sources.workbookImport;
 *             proposed meanings: learningx.dictionaryProposals, learningx.dictionaryBuild (proposals.ts)
 *   FR-08     ui.context, ontology.packs, ontology.get, ontology.publish, through the existing slice
 *   FR-09     ontology.get (the published menu), calculation.run, receipts.get
 *   FR-11     todayx.idea.start, todayx.idea.tell, todayx.idea.correct (todayx.idea.get to read)
 *   FR-12     todayx.setupChecklist
 *   FR-13     workspace.recover, workspace.restore, todayx.recoveryContact.request (refused until
 *             the hosted relay exists)
 *   every step  todayx.firstRun.status
 *
 * FR-07 bank statement PDFs go through the connectors-ext `imports.*` family (`imports.readerStatus`,
 * `imports.installReader`, `imports.preview`, `imports.providePassword`, `imports.commit`), with
 * the shapes of docs/lanes/connectors-ext.md "FR-07 contract". PDF is offered only when
 * `imports.readerStatus` answers; until then it stays out of the picker. The PDF's password
 * passes once to `imports.providePassword` and is never held here. Sheets have no
 * password path: an encrypted workbook (`ENCRYPTED_ZIP`, or an OLE file named .xlsx) shows
 * "password needed" with the not-built words and no field.
 *
 * A reply of `UNKNOWN_METHOD`, `INVALID_REQUEST` or `METHOD_UNAVAILABLE` is "not built yet"
 * for that step. Engine prose (an error message, a preview's question) is never shown: only
 * fixed codes become words. File cells, column names and route labels are data, drawn as text.
 */

import { ReplyValidationError } from '../../bridge/validate.ts';
import { notBuilt } from '../../bridge/todayx-contract.ts';
import type { IdeaSection, IdeaUnknown, IdentityCard, IdentityField } from '../../bridge/todayx-contract.ts';

/* ------------------------------------------------------------------ the port */

export type ImportFormat = 'csv' | 'xlsx' | 'pdf';
/** A file brought to FR-07: CSV as text, Excel and PDF as base64 bytes. The name is data. */
export type PickedFile =
  | { readonly name: string; readonly format: 'csv'; readonly content: string }
  | { readonly name: string; readonly format: 'xlsx'; readonly bytesBase64: string }
  | { readonly name: string; readonly format: 'pdf'; readonly bytesBase64: string };
export interface ExpectedTotals { readonly rowCount: number; readonly amountMinor: string }

/** A typed, data-only mapping recipe (platform/runtime/ingest.ts `validateRecipe`). */
export type RecipeBinding = {
  readonly target: string;
  readonly source?: string;
  readonly constant?: string;
  readonly type: 'string' | 'money' | 'date';
  readonly nulls: 'reject' | 'omit';
  readonly dateFormat?: DateFormat;
  readonly moneyUnit?: 'major';
  readonly currency?: string;
};
export type MappingRecipe = {
  readonly version: 1;
  readonly id: string;
  readonly system: string;
  readonly edition: string;
  readonly scope: { readonly company: string; readonly branches: readonly string[] };
  readonly bindings: readonly RecipeBinding[];
  readonly allowedKinds: readonly string[];
  readonly allowedStatuses: readonly string[];
  readonly onUnmapped: 'report';
  readonly ignoredFields: readonly string[];
};
export type SheetRequest = {
  readonly sourceId: string;
  readonly format: 'csv';
  readonly content: string;
  readonly recipe?: MappingRecipe;
  readonly expectedTotals?: ExpectedTotals;
};
export type WorkbookRequest = {
  readonly sourceId: string;
  readonly bytesBase64: string;
  readonly recipe?: MappingRecipe;
  readonly expectedTotals?: ExpectedTotals;
  /**
   * core-data round 4: a locked workbook's password, for this one request only. Sent only after
   * the engine itself answered `PASSWORD_REQUIRED` (a core that reads workbook passwords).
   */
  readonly password?: string;
};

/** core-data's refusals for a locked workbook that have their own words on FR-07 (besides the password field's own). */
export const LOCKED_WORKBOOK_REFUSALS: ReadonlySet<string> = new Set(['WORKBOOK_INTEGRITY_FAILED', 'WORKBOOK_ENCRYPTION_UNSUPPORTED', 'WORKBOOK_ENCRYPTION_INVALID', 'WORKBOOK_CFB_INVALID', 'WORKBOOK_LIMIT']);
/** core-data's rule for a workbook password (`ecma376.ts`): 1 to 255 characters, no lone surrogate. */
export function workbookPasswordShape(typed: string): boolean {
  return typed.length >= 1 && typed.length <= 255 && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(typed);
}
/** A bank statement PDF for the connectors-ext `imports.*` family. */
export type PdfRequest = { readonly sourceId: string; readonly kind: 'pdf'; readonly bytesBase64: string };
/** Takes the envelope that `imports.preview` read, for the same source. */
export type PdfCommitRequest = { readonly sourceId: string; readonly envelopeId: string };
export type RouteKind = 'codex-cli' | 'claude-cli' | 'openai-responses' | 'openai-compatible' | 'ollama';
export type RouteConfigInput = { readonly kind: RouteKind; readonly model: string; readonly label?: string; readonly endpoint?: string };

export type JourneyPayloads = {
  'todayx.firstRun.status': Record<string, never>;
  'todayx.identity.check': { readonly fields: Readonly<Partial<Record<IdentityField, string>>> };
  'todayx.identity.save': { readonly fields: Readonly<Partial<Record<IdentityField, string>>>; readonly gstMode: IdentityCard['gstMode'] };
  'todayx.setupChecklist': Record<string, never>;
  'models.list': Record<string, never>;
  'models.configure': { readonly config: RouteConfigInput };
  'sources.preview': SheetRequest;
  'sources.import': SheetRequest;
  'sources.workbookPreview': WorkbookRequest;
  'sources.workbookImport': WorkbookRequest;
  /** The workbook's cells as the engine reads them (`readWorkbook`), for proposed meanings of an Excel sheet. */
  'sources.workbook': { readonly bytesBase64: string; readonly sheet?: string };
  'ontology.get': Record<string, never>;
  'calculation.run': { readonly operation: string };
  'receipts.get': { readonly id: string };
  'workspace.recover': { readonly folder: string; readonly recoveryCode: string; readonly passphrase: string };
  'workspace.restore': { readonly folder: string; readonly backupFile: string; readonly passphrase: string };
  /** FR-07 proposed meanings (learning-ext; may be absent): read the drafts, or build one from the held sheet. */
  'learningx.dictionaryProposals': { readonly limit?: number };
  'learningx.dictionaryBuild': { readonly files: readonly { readonly content: string }[] };
  /** FR-11 an idea (todayx). */
  'todayx.idea.start': Record<string, never>;
  'todayx.idea.get': Record<string, never>;
  'todayx.idea.tell': { readonly text: string; readonly section?: IdeaSection; readonly answers?: IdeaUnknown; readonly guess?: boolean };
  'todayx.idea.correct': { readonly claimId: string; readonly text?: string; readonly guess?: boolean; readonly withdraw?: true };
  'imports.readerStatus': Record<string, never>;
  'imports.installReader': Record<string, never>;
  'imports.preview': PdfRequest;
  'imports.providePassword': { readonly sourceId: string; readonly password: string };
  'imports.commit': PdfCommitRequest;
  'todayx.diskCheck': Record<string, never>;
  'todayx.device.get': Record<string, never>;
  'todayx.device.set': { readonly language: 'en' | 'hi'; readonly view: 'simple' | 'guided' | 'books' };
  'todayx.workspaces': Record<string, never>;
  'todayx.recoveryContact.request': { readonly folder: string };
  /** Round 4 (bridge/r4-contracts.ts): FR-05 ladder, probe and local models; the time zone; FR-10; FR-14. */
  'models.setLadder': { readonly routeIds: readonly string[] };
  'models.probe': { readonly routeId: string };
  'modelsx.localList': { readonly endpoint?: string };
  'ui.context': Record<string, never>;
  'workspace.setTimeZone': { readonly timeZone: string };
  'learningx.intakeStatus': Record<string, never>;
  'learningx.preview': { readonly boxes: readonly ('setup-shapes' | 'corrections')[] };
  'learningx.consent': { readonly previewId: string; readonly digest: string };
  'devices.join': { readonly step: 'request'; readonly folder: string; readonly deviceName?: string } | { readonly step: 'finish' | 'cancel' };
};
export type JourneyMethod = keyof JourneyPayloads;

/** The host binds this to its named-request port (`controller.places`). */
export interface JourneyPort {
  request<M extends JourneyMethod>(method: M, payload: JourneyPayloads[M]): Promise<unknown>;
}

/* ------------------------------------------------------------------ failures */

export type JourneyFailure = { readonly kind: 'not-built' } | { readonly kind: 'refused'; readonly code: string };

/** A fixed code only, never the error's message. */
export function failureOf(error: unknown): JourneyFailure {
  if (error instanceof ReplyValidationError) return { kind: 'refused', code: 'INVALID_REPLY' };
  if (notBuilt(error)) return { kind: 'not-built' };
  let code: unknown;
  try {
    const descriptor = error !== null && typeof error === 'object' ? Object.getOwnPropertyDescriptor(error, 'code') : undefined;
    code = descriptor !== undefined && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
  } catch { code = undefined; }
  return { kind: 'refused', code: typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/.test(code) ? code : 'REQUEST_FAILED' };
}

/* ---------------------------------------------------------------- validators */

type Rec = Record<string, unknown>;
function invalid(path: string): never { throw new ReplyValidationError(path); }
function rec(value: unknown, path: string): Rec {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) invalid(path);
  return value as Rec;
}
function arr(value: unknown, path: string, maximum: number): readonly unknown[] {
  if (!Array.isArray(value) || value.length > maximum) invalid(path);
  return value;
}
function whole(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) invalid(path);
  return value;
}
function digits(value: unknown, path: string, signed = false): string {
  if (typeof value !== 'string' || !(signed ? /^-?(0|[1-9][0-9]{0,30})$/ : /^(0|[1-9][0-9]{0,30})$/).test(value)) invalid(path);
  return value;
}
function plain(value: unknown, path: string, maximum = 200): string {
  if (typeof value !== 'string' || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) invalid(path);
  return value;
}
const CODE = /^[A-Z][A-Z0-9_]{1,63}$/;

export interface ImportCoverage { readonly sourceRows: number; readonly importedRows: number; readonly rejectedRows: number; readonly expectedRows: number | null; readonly reconciled: boolean }
export interface RowProblem { readonly row: number; readonly code: string }
export interface SheetPreview {
  readonly accepted: boolean;
  /** Row 0 is the whole file; any other row is the line in the file. */
  readonly problems: readonly RowProblem[];
  /** Column names from the file, shown as written. */
  readonly unmappedFields: readonly string[];
  readonly totalsMinor: string;
  readonly coverage: ImportCoverage;
  readonly format: string;
  readonly qualification: 'experimental' | 'supported';
}

function coverage(value: unknown, path: string): ImportCoverage {
  const obj = rec(value, path);
  const expected = obj.expectedRows === null ? null : whole(obj.expectedRows, `${path}.expectedRows`);
  if (typeof obj.reconciled !== 'boolean') invalid(`${path}.reconciled`);
  return Object.freeze({ sourceRows: whole(obj.sourceRows, `${path}.sourceRows`), importedRows: whole(obj.importedRows, `${path}.importedRows`), rejectedRows: whole(obj.rejectedRows, `${path}.rejectedRows`), expectedRows: expected, reconciled: obj.reconciled });
}

/** `sources.preview` / `sources.workbookPreview` (ingest.ts `ImportPreview`). The facts are not read here. */
export function validatePreview(value: unknown): SheetPreview {
  const obj = rec(value, 'preview');
  if (typeof obj.accepted !== 'boolean') invalid('preview.accepted');
  const problems = arr(obj.errors, 'preview.errors', 1_000_000).map((item, index) => {
    const error = rec(item, `preview.errors[${index}]`);
    const code = plain(error.code, `preview.errors[${index}].code`, 64);
    return Object.freeze({ row: whole(error.row, `preview.errors[${index}].row`), code: CODE.test(code) ? code : 'INVALID_ROW' });
  });
  const unmapped = arr(obj.unmappedFields, 'preview.unmappedFields', 1000).map((item, index) => plain(item, `preview.unmappedFields[${index}]`));
  arr(obj.facts, 'preview.facts', 10_000_000);
  const cover = coverage(obj.coverage, 'preview.coverage');
  if (cover.importedRows + cover.rejectedRows !== cover.sourceRows) invalid('preview.coverage');
  if (obj.accepted && problems.length > 0) invalid('preview.accepted');
  const qualification = obj.qualification === 'supported' ? 'supported' : obj.qualification === 'experimental' ? 'experimental' : invalid('preview.qualification');
  return Object.freeze({ accepted: obj.accepted, problems: Object.freeze(problems), unmappedFields: Object.freeze(unmapped), totalsMinor: digits(obj.totalsMinor, 'preview.totalsMinor', true), coverage: cover, format: plain(obj.format, 'preview.format', 32), qualification });
}

export interface ImportResult { readonly id: string; readonly coverage: ImportCoverage; readonly totalsMinor: string; readonly duplicate: boolean }
/** `sources.import` / `sources.workbookImport`: the public import record. */
export function validateImport(value: unknown): ImportResult {
  const obj = rec(value, 'import');
  const id = plain(obj.id, 'import.id');
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(id)) invalid('import.id');
  if (Object.hasOwn(obj, 'duplicate') && typeof obj.duplicate !== 'boolean') invalid('import.duplicate');
  return Object.freeze({ id, coverage: coverage(obj.coverage, 'import.coverage'), totalsMinor: digits(obj.totalsMinor, 'import.totalsMinor', true), duplicate: obj.duplicate === true });
}

/** `calculation.run`: only the receipt identity is taken; the receipt itself is read with `receipts.get`. */
export function validateCalculationId(value: unknown): string {
  const obj = rec(value, 'calculation');
  const id = plain(obj.id, 'calculation.id');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,199}$/.test(id)) invalid('calculation.id');
  return id;
}

/** `workspace.recover` / `workspace.restore`: the opened workspace's name only. */
export function validateOpened(value: unknown): { readonly name: string } {
  const obj = rec(value, 'workspace');
  const workspace = rec(obj.workspace, 'workspace.workspace');
  return Object.freeze({ name: plain(workspace.name, 'workspace.workspace.name', 100) });
}

/* -------------------------------------------------------- local, data-only helpers */

/** A plain source identifier from a file name. The name itself is data. */
export function sourceIdFor(fileName: string): string {
  const base = fileName.replace(/\.[A-Za-z0-9]{1,8}$/, '').replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^[^A-Za-z0-9]+/, '').slice(0, 60);
  return `file-${base.length > 0 ? base : 'sheet'}`;
}

/** `pdf` only when this engine reads PDFs (`imports.readerStatus` answered). */
export function formatOf(fileName: string, pdf = false): ImportFormat | null {
  if (/\.csv$/i.test(fileName) || /\.txt$/i.test(fileName)) return 'csv';
  if (/\.xlsx$/i.test(fileName)) return 'xlsx';
  if (pdf && /\.pdf$/i.test(fileName)) return 'pdf';
  return null;
}

/**
 * One CSV line as cells, for showing the first rows as plain text and naming the columns.
 * Quotes are honoured; nothing is interpreted.
 */
export function splitCsvLine(line: string): readonly string[] {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (quoted) {
      if (char === '"' && line[index + 1] === '"') { cell += '"'; index++; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { cells.push(cell); cell = ''; }
    else cell += char;
  }
  cells.push(cell);
  return cells;
}

/** The first lines of a sheet as cells, at most `limit` lines, each cell bounded. Shown as text only. */
export function firstRows(content: string, limit = 6): readonly (readonly string[])[] {
  const lines = content.replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => line.trim().length > 0).slice(0, limit);
  return lines.map(line => splitCsvLine(line).slice(0, 12).map(cell => cell.slice(0, 80)));
}

/**
 * Rupees as typed, to whole paise as a digit string. Only digits, Indian or western commas,
 * and at most two decimals. No floating point is used.
 */
export function rupeesToPaise(typed: string): string | null {
  const cleaned = typed.trim().replace(/^₹\s*/, '').replace(/,/g, '');
  const match = /^(0|[1-9][0-9]{0,15})(?:\.([0-9]{1,2}))?$/.exec(cleaned);
  if (match === null) return null;
  const rupees = match[1] ?? '0';
  const fraction = (match[2] ?? '').padEnd(2, '0');
  const joined = `${rupees}${fraction}`.replace(/^0+(?=[0-9])/, '');
  return joined;
}

export type ColumnRole = 'date' | 'customer' | 'amount' | 'invoice' | 'ignore';
export type DateFormat = 'ISO' | 'DMY';

/**
 * The recipe for "Pick your columns": one invoice per line, in rupees, on the main branch.
 * It is data only, and the engine checks every binding against the published meanings.
 * Returns null until a date, an amount and an invoice column are each chosen exactly once.
 */
export function pickedRecipe(columns: readonly string[], roles: Readonly<Record<string, ColumnRole>>, dateFormat: DateFormat, company: string): MappingRecipe | null {
  const chosen = (role: ColumnRole) => columns.filter(column => roles[column] === role);
  const date = chosen('date'), amount = chosen('amount'), invoice = chosen('invoice'), customer = chosen('customer');
  if (date.length !== 1 || amount.length !== 1 || invoice.length !== 1 || customer.length > 1) return null;
  const [dateColumn] = date, [amountColumn] = amount, [invoiceColumn] = invoice, [customerColumn] = customer;
  if (dateColumn === undefined || amountColumn === undefined || invoiceColumn === undefined) return null;
  const bindings: RecipeBinding[] = [
    { target: 'entityId', source: invoiceColumn, type: 'string', nulls: 'reject' },
    { target: 'kind', constant: 'invoice', type: 'string', nulls: 'reject' },
    { target: 'validFrom', source: dateColumn, type: 'date', dateFormat, nulls: 'reject' },
    { target: 'amountMinor', source: amountColumn, type: 'money', moneyUnit: 'major', currency: 'INR', nulls: 'reject' },
    { target: 'currency', constant: 'INR', type: 'string', nulls: 'reject' },
    { target: 'invoiceId', source: invoiceColumn, type: 'string', nulls: 'omit' },
  ];
  if (customerColumn !== undefined) bindings.push({ target: 'customerId', source: customerColumn, type: 'string', nulls: 'omit' });
  return Object.freeze({
    version: 1, id: 'picked-columns-v1', system: 'sheet', edition: '1',
    scope: Object.freeze({ company: company.slice(0, 100), branches: Object.freeze(['main']) }),
    bindings: Object.freeze(bindings), allowedKinds: Object.freeze(['invoice']), allowedStatuses: Object.freeze(['']),
    onUnmapped: 'report', ignoredFields: Object.freeze(columns.filter(column => roles[column] === 'ignore' || roles[column] === undefined)),
  });
}

/** Problem codes grouped in first-seen order, with the rows each one covers. */
export function problemsByCode(problems: readonly RowProblem[]): readonly { readonly code: string; readonly rows: readonly number[] }[] {
  const groups = new Map<string, number[]>();
  for (const problem of problems) {
    if (problem.row === 0) continue;
    const rows = groups.get(problem.code) ?? [];
    rows.push(problem.row);
    groups.set(problem.code, rows);
  }
  return [...groups.entries()].map(([code, rows]) => Object.freeze({ code, rows: Object.freeze(rows) }));
}

/** The whole-file problems (row 0), as codes. */
export function fileProblems(problems: readonly RowProblem[]): readonly string[] {
  return [...new Set(problems.filter(problem => problem.row === 0).map(problem => problem.code))];
}

/** A layout this recipe does not know: nothing would be taken from a file that has rows. */
export function unknownLayout(preview: SheetPreview): boolean {
  return preview.coverage.sourceRows > 0 && preview.coverage.importedRows === 0;
}

/** The recovery code in groups of four, for reading aloud and copying by hand. The kit itself is unchanged. */
export function groupsOfFour(code: string): readonly string[] {
  const groups: string[] = [];
  for (let index = 0; index < code.length; index += 4) groups.push(code.slice(index, index + 4));
  return groups;
}

/** The code as typed back, without the spaces that grouping adds. */
export function typedRecoveryCode(typed: string): string {
  return typed.replace(/\s+/g, '');
}

/* ------------------------------------------------------ bank statement PDFs (imports.*) */

/**
 * Thrown refusals of `imports.preview`: the file could not be read at all. The first two lead to
 * the password field and the reader is shown for `READER_NOT_INSTALLED`; the rest have fixed sentences.
 */
export const PDF_THROWN = ['PASSWORD_REQUIRED', 'WRONG_PASSWORD', 'PICTURE_ONLY', 'READER_NOT_INSTALLED', 'INVALID_PDF', 'PDF_LINE_UNREADABLE', 'PDF_PAGE_LIMIT'] as const;
/** Thrown refusals that refuse the file whole, each with its fixed sentence. */
export const PDF_WHOLE_REASONS: ReadonlySet<string> = new Set(['PICTURE_ONLY', 'INVALID_PDF', 'PDF_LINE_UNREADABLE', 'PDF_PAGE_LIMIT']);
/** Content refusals: an envelope with `status: 'refused'` and this `fr07.reason`. */
export const PDF_CONTENT_REASONS = ['CUT_SHORT', 'FILTERED', 'DOES_NOT_ADD_UP'] as const;
export type PdfContentReason = typeof PDF_CONTENT_REASONS[number];
/** Every FR-07 PDF code that has the design's own words. */
export const PDF_REFUSALS = [...PDF_THROWN, ...PDF_CONTENT_REASONS] as const;
/** `imports.installReader` always refuses in this build; these are its expected codes. */
export const READER_INSTALL_REFUSALS: ReadonlySet<string> = new Set(['READER_INSTALL_UNAVAILABLE', 'DEMO_EXTERNAL_DISABLED']);
/** `imports.commit` refusals with their own words. */
export const PDF_COMMIT_REFUSALS: ReadonlySet<string> = new Set(['IMPORT_NOT_ACCEPTED', 'ENVELOPE_NOT_FOUND', 'ENVELOPE_EXPIRED']);
/** Reader reasons with their own words; any other helper code is shown as its code. */
export const READER_REASONS: ReadonlySet<string> = new Set(['PYTHON_NOT_CONFIGURED', 'PDF_LIBRARY_MISSING']);

const SOURCE_ID = /^[A-Za-z0-9_.:-]{1,100}$/;
const RECORD_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/;
function bool(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') invalid(path);
  return value;
}
function codeOrNull(value: unknown, path: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !CODE.test(value)) invalid(path);
  return value;
}
function idOf(value: unknown, path: string, pattern = RECORD_ID): string {
  if (typeof value !== 'string' || !pattern.test(value)) invalid(path);
  return value;
}
function only(obj: Rec, value: unknown, key: string, path: string): void {
  if (obj[key] !== value) invalid(`${path}.${key}`);
}

/** `imports.readerStatus`: whether the trusted helper reads PDF text, and OCR for scanned pages. */
export interface ReaderStatus {
  readonly status: 'installed' | 'not-installed';
  readonly pdfText: boolean;
  /** OCR for scanned pages (experimental). */
  readonly pdfOcr: boolean;
  /** Null when installed; else `PYTHON_NOT_CONFIGURED`, `PDF_LIBRARY_MISSING` or the helper's code. */
  readonly reason: string | null;
}
export function validateReaderStatus(value: unknown): ReaderStatus {
  const obj = rec(value, 'reader');
  const status = obj.status === 'installed' || obj.status === 'not-installed' ? obj.status : invalid('reader.status');
  const pdfText = bool(obj.pdfText, 'reader.pdfText'), pdfOcr = bool(obj.pdfOcr, 'reader.pdfOcr');
  const reason = codeOrNull(obj.reason, 'reader.reason');
  // A whole number of bytes when the reader is installed; null otherwise.
  if (obj.sizeBytes !== null) {
    if (status !== 'installed') invalid('reader.sizeBytes');
    whole(obj.sizeBytes, 'reader.sizeBytes');
  }
  if ((status === 'installed') !== pdfText || (status === 'installed') !== (reason === null)) invalid('reader.status');
  return Object.freeze({ status, pdfText, pdfOcr, reason });
}

/** `imports.providePassword`: held once, for this source; the password is never echoed. */
export function validatePasswordHeld(value: unknown, sourceId: string): void {
  const obj = rec(value, 'password');
  only(obj, true, 'held', 'password');
  only(obj, sourceId, 'sourceId', 'password');
  only(obj, true, 'usedOnce', 'password');
  if (whole(obj.expiresInSeconds, 'password.expiresInSeconds') === 0) invalid('password.expiresInSeconds');
  if (Object.hasOwn(obj, 'password')) invalid('password.password');
}

/** A FILTERED total: paise as a digit string, or a count of lines when the row count differed. */
export type PdfTotal = { readonly kind: 'money'; readonly minor: string } | { readonly kind: 'lines'; readonly count: number } | null;
function total(value: unknown, path: string): PdfTotal {
  if (value === null) return null;
  if (typeof value === 'number') return Object.freeze({ kind: 'lines', count: whole(value, path) });
  return Object.freeze({ kind: 'money', minor: digits(value, path, true) });
}

/** The `fr07` result (connectors-ext `fr07Result`), only the fields drawn. */
export interface Fr07Result {
  readonly envelopeId: string;
  readonly sourceId: string;
  readonly state: 'checked' | 'refused' | 'question' | 'imported';
  readonly reason: PdfContentReason | null;
  readonly code: string | null;
  /** The line in the extracted text where it broke. */
  readonly line: number | null;
  /** FILTERED only. */
  readonly totals: { readonly expected: PdfTotal; readonly observed: PdfTotal } | null;
  readonly linesRead: number;
  readonly openingMinor: string | null;
  readonly closingMinor: string | null;
  readonly checkPassed: boolean;
  /** A scanned page was read by OCR (experimental). */
  readonly readByOcr: boolean;
  readonly imported: { readonly importId: string; readonly rows: number; readonly duplicate: boolean } | null;
}
export function validateFr07(value: unknown, path = 'fr07'): Fr07Result {
  const obj = rec(value, path);
  only(obj, 'bank-statement', 'kind', path);
  const state = obj.state === 'checked' || obj.state === 'refused' || obj.state === 'question' || obj.state === 'imported' ? obj.state : invalid(`${path}.state`);
  const reason = obj.reason === null ? null : (PDF_CONTENT_REASONS as readonly unknown[]).includes(obj.reason) ? obj.reason as PdfContentReason : invalid(`${path}.reason`);
  const line = obj.line === null ? null : whole(obj.line, `${path}.line`);
  let totals: Fr07Result['totals'] = null;
  if (obj.totals !== null) {
    const pair = rec(obj.totals, `${path}.totals`);
    const expected = total(pair.expected, `${path}.totals.expected`), observed = total(pair.observed, `${path}.totals.observed`);
    if (reason !== 'FILTERED' || (expected !== null && observed !== null && expected.kind !== observed.kind)) invalid(`${path}.totals`);
    totals = Object.freeze({ expected, observed });
  }
  const kept = rec(obj.kept, `${path}.kept`);
  only(kept, 'not-kept', 'file', `${path}.kept`);
  only(kept, 'books-sources-history', 'record', `${path}.kept`);
  let imported: Fr07Result['imported'] = null;
  if (obj.imported !== null) {
    const done = rec(obj.imported, `${path}.imported`);
    imported = Object.freeze({ importId: idOf(done.importId, `${path}.imported.importId`), rows: whole(done.rows, `${path}.imported.rows`), duplicate: bool(done.duplicate, `${path}.imported.duplicate`) });
  }
  if ((state === 'imported') !== (imported !== null)) invalid(`${path}.imported`);
  if (reason !== null && state !== 'refused') invalid(`${path}.reason`);
  const checkPassed = bool(obj.checkPassed, `${path}.checkPassed`);
  return Object.freeze({
    envelopeId: idOf(obj.envelopeId, `${path}.envelopeId`), sourceId: idOf(obj.sourceId, `${path}.sourceId`, SOURCE_ID),
    state, reason, code: codeOrNull(obj.code, `${path}.code`), line, totals,
    linesRead: whole(obj.linesRead, `${path}.linesRead`),
    openingMinor: obj.openingMinor === null ? null : digits(obj.openingMinor, `${path}.openingMinor`, true),
    closingMinor: obj.closingMinor === null ? null : digits(obj.closingMinor, `${path}.closingMinor`, true),
    checkPassed, readByOcr: bool(obj.readByOcr, `${path}.readByOcr`), imported,
  });
}

/** `imports.preview` for a PDF: the envelope's id and status, and its `fr07` result. Nothing else is read. */
export interface PdfPreview { readonly envelopeId: string; readonly status: 'accepted' | 'refused' | 'abstained' | 'failed'; readonly fr07: Fr07Result }
export function validatePdfPreview(value: unknown, sourceId?: string): PdfPreview {
  const obj = rec(value, 'pdf');
  const envelopeId = idOf(obj.id, 'pdf.id');
  const status = obj.status === 'accepted' || obj.status === 'refused' || obj.status === 'abstained' || obj.status === 'failed' ? obj.status : invalid('pdf.status');
  const fr07 = validateFr07(obj.fr07, 'pdf.fr07');
  if (fr07.envelopeId !== envelopeId || (sourceId !== undefined && fr07.sourceId !== sourceId)) invalid('pdf.fr07');
  const expected = status === 'accepted' ? ['checked', 'imported'] : status === 'abstained' ? ['question'] : ['refused'];
  if (!expected.includes(fr07.state)) invalid('pdf.fr07.state');
  return Object.freeze({ envelopeId, status, fr07 });
}

/** `imports.commit`: the `fr07` result, now imported, for the envelope that was taken. */
export function validatePdfCommit(value: unknown, envelopeId: string, sourceId: string): Fr07Result {
  const fr07 = validateFr07(value, 'commit');
  if (fr07.state !== 'imported' || fr07.envelopeId !== envelopeId || fr07.sourceId !== sourceId) invalid('commit.state');
  return fr07;
}
