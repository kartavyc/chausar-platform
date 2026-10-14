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
 *   FR-07     sources.preview, sources.import, sources.workbookPreview, sources.workbookImport
 *   FR-08     ui.context, ontology.packs, ontology.get, ontology.publish, through the existing slice
 *   FR-09     ontology.get (the published menu), calculation.run, receipts.get
 *   FR-12     todayx.setupChecklist
 *   FR-13     workspace.recover, workspace.restore, todayx.recoveryContact.request (refused until
 *             the hosted relay exists)
 *   every step  todayx.firstRun.status
 *
 * FR-07 bank statement PDFs go through the connectors-ext `imports.*` family (`imports.readerStatus`,
 * `imports.installReader`, `imports.preview`, `imports.providePassword`, `imports.commit`). PDF is
 * offered only when `imports.readerStatus` answers; until then it stays out of the picker. The
 * PDF's password passes once to `imports.providePassword` and is never held. Sheets have no
 * password path: an encrypted workbook (`ENCRYPTED_ZIP`, or an OLE file named .xlsx) shows
 * "password needed" with the not-built words and no field.
 *
 * A reply of `UNKNOWN_METHOD`, `INVALID_REQUEST` or `METHOD_UNAVAILABLE` is "not built yet"
 * for that step. Engine prose (an error message, a preview's question) is never shown: only
 * fixed codes become words. File cells, column names and route labels are data, drawn as text.
 */

import { ReplyValidationError } from '../../bridge/validate.ts';
import { notBuilt } from '../../bridge/todayx-contract.ts';
import type { IdentityCard, IdentityField } from '../../bridge/todayx-contract.ts';

/* ------------------------------------------------------------------ the port */

export type ImportFormat = 'csv' | 'xlsx' | 'pdf';
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
};
/** A bank statement PDF for the connectors-ext `imports.*` family. */
export type PdfRequest = { readonly sourceId: string; readonly kind: 'pdf'; readonly bytesBase64: string };
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
  'ontology.get': Record<string, never>;
  'calculation.run': { readonly operation: string };
  'receipts.get': { readonly id: string };
  'workspace.recover': { readonly folder: string; readonly recoveryCode: string; readonly passphrase: string };
  'workspace.restore': { readonly folder: string; readonly backupFile: string; readonly passphrase: string };
  'imports.readerStatus': Record<string, never>;
  'imports.installReader': Record<string, never>;
  'imports.preview': PdfRequest;
  'imports.providePassword': { readonly sourceId: string; readonly password: string };
  'imports.commit': PdfRequest;
  'todayx.diskCheck': Record<string, never>;
  'todayx.device.get': Record<string, never>;
  'todayx.device.set': { readonly language: 'en' | 'hi'; readonly view: 'simple' | 'guided' | 'books' };
  'todayx.workspaces': Record<string, never>;
  'todayx.recoveryContact.request': { readonly folder: string };
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

/** Refusals of `imports.preview` that have the design's own words (connectors-ext codes). */
export const PDF_REFUSALS = ['PASSWORD_REQUIRED', 'WRONG_PASSWORD', 'PICTURE_ONLY', 'CUT_SHORT', 'FILTERED', 'DOES_NOT_ADD_UP', 'READER_NOT_INSTALLED'] as const;
/** Refused whole, with the reason from the fixed list. */
export const PDF_WHOLE_REASONS: ReadonlySet<string> = new Set(['PICTURE_ONLY', 'CUT_SHORT', 'FILTERED', 'DOES_NOT_ADD_UP']);

export interface ReaderStatus { readonly state: 'installed' | 'not-installed'; readonly sizeBytes: number | null }
/** `imports.readerStatus` / `imports.installReader`. */
export function validateReaderStatus(value: unknown): ReaderStatus {
  const obj = rec(value, 'reader');
  const state = obj.state === 'installed' || obj.state === 'not-installed' ? obj.state : invalid('reader.state');
  const size = obj.sizeBytes === undefined || obj.sizeBytes === null ? null : whole(obj.sizeBytes, 'reader.sizeBytes');
  return Object.freeze({ state, sizeBytes: size });
}

/**
 * The bank-PDF preview, read loosely: only the fields drawn are checked, each may be absent
 * (drawn as "not known", never as zero). Money is whole paise as a digit string.
 */
export interface PdfPreview { readonly lines: number | null; readonly openingMinor: string | null; readonly closingMinor: string | null; readonly check: 'passed' | 'failed' | null }
export function validatePdfPreview(value: unknown): PdfPreview {
  const obj = rec(value, 'pdf');
  const optional = <T>(key: string, read: (item: unknown, path: string) => T): T | null => obj[key] === undefined || obj[key] === null ? null : read(obj[key], `pdf.${key}`);
  const check = obj.check === undefined || obj.check === null ? null : obj.check === 'passed' || obj.check === 'failed' ? obj.check : invalid('pdf.check');
  return Object.freeze({
    lines: optional('lines', whole), openingMinor: optional('openingMinor', (item, path) => digits(item, path, true)),
    closingMinor: optional('closingMinor', (item, path) => digits(item, path, true)), check,
  });
}
