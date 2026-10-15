/**
 * FR-07 "Proposed meanings (draft)": a small adapter over learning-ext's dictionary builder.
 *
 * - `learningx.dictionaryProposals` { limit } (read) lists the drafts already made; one built
 *   from this very sheet (same SHA-256 of its text) is shown again rather than built twice.
 * - Otherwise `learningx.dictionaryBuild` { files: [{ content }] } (prepare) profiles the sheet's
 *   columns (names and types, never values) and keeps the result as a draft proposal.
 * - An Excel sheet is sent the same way as CSV text: the engine's own reading of the workbook
 *   (`sources.workbook` → `{ sheets: [{ name, rows }] }`, the cells `sources.workbookPreview`
 *   reads) becomes CSV text here with the engine's quoting (`workbookSheetToCSV`). Only a
 *   workbook with one sheet is read, as `sources.workbookPreview` does without a chosen sheet.
 *   A PDF statement has no sheet: "sheets only". A locked workbook gives no draft ("locked"): its
 *   password was used once for the preview and once for the import and is not kept, so
 *   `sources.workbook` is asked without one and answers `PASSWORD_REQUIRED`.
 *
 * Nothing here accepts a meaning: adoption is FR-08's step and the owner's click. Only the
 * parts the list draws are read from a reply, and each is checked first. Column headers come
 * from the file and are shown as written, as data. When the learningx family is absent the
 * list says "not built yet".
 */

import { ReplyValidationError } from '../../bridge/validate.ts';
import { failureOf, type JourneyFailure, type JourneyPort, type PickedFile } from './journey-contracts.ts';

export type MeaningType = 'string' | 'money' | 'date' | 'integer' | 'boolean';
export type Confidence = 'high' | 'medium' | 'low';
export interface ProposedColumn {
  /** The column header from the file, as written. */
  readonly header: string;
  readonly type: MeaningType;
  readonly confidence: Confidence;
  /** The starter pack already has this field. */
  readonly existing: boolean;
}
export interface ProposalView {
  readonly id: string;
  readonly status: 'proposed' | 'adopted' | 'failed-answer-key';
  readonly pack: string;
  readonly packConfidence: Confidence;
  readonly columns: readonly ProposedColumn[];
  /** Columns that bind the record itself (id, kind, date, branch) or have no usable name. */
  readonly skipped: readonly { readonly header: string; readonly reason: 'record-identity-column' | 'no-safe-name' | 'other' }[];
  readonly contentHashes: readonly string[];
}
export type ProposalsOutcome =
  | { readonly kind: 'ready'; readonly proposal: ProposalView }
  | { readonly kind: 'sheets-only' }
  | { readonly kind: 'locked' }
  | { readonly kind: 'failed'; readonly failure: JourneyFailure };

type Rec = Record<string, unknown>;
const invalid = (path: string): never => { throw new ReplyValidationError(path); };
const rec = (value: unknown, path: string): Rec => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Rec : invalid(path);
const list = (value: unknown, path: string, maximum: number): readonly unknown[] => Array.isArray(value) && value.length <= maximum ? value : invalid(path);
const text = (value: unknown, path: string, maximum = 200): string => typeof value === 'string' && value.length <= maximum && !/[\u0000-\u001f\u007f]/.test(value) ? value : invalid(path);
const oneOf = <T extends string>(options: readonly T[], value: unknown, path: string): T => typeof value === 'string' && (options as readonly string[]).includes(value) ? value as T : invalid(path);
const CONFIDENCE: readonly Confidence[] = ['high', 'medium', 'low'];
const TYPES: readonly MeaningType[] = ['string', 'money', 'date', 'integer', 'boolean'];

/** One learning-ext proposal, reduced to what the thin list draws. */
export function validateProposal(value: unknown, path = 'proposal'): ProposalView {
  const obj = rec(value, path);
  const pack = rec(obj['pack'], `${path}.pack`);
  const columns = list(obj['evidence'], `${path}.evidence`, 200).map((item, index) => {
    const column = rec(item, `${path}.evidence[${index}]`);
    if (typeof column['existing'] !== 'boolean') invalid(`${path}.evidence[${index}].existing`);
    return Object.freeze({ header: text(column['header'], `${path}.evidence[${index}].header`), type: oneOf(TYPES, column['type'], `${path}.evidence[${index}].type`),
      confidence: oneOf(CONFIDENCE, column['confidence'], `${path}.evidence[${index}].confidence`), existing: column['existing'] as boolean });
  });
  const skipped = list(obj['skipped'], `${path}.skipped`, 500).map((item, index) => {
    const row = rec(item, `${path}.skipped[${index}]`);
    const reason = row['reason'] === 'record-identity-column' || row['reason'] === 'no-safe-name' ? row['reason'] : 'other' as const;
    return Object.freeze({ header: text(row['header'], `${path}.skipped[${index}].header`), reason });
  });
  const hashes = list(obj['contentHashes'], `${path}.contentHashes`, 10).map((item, index) => typeof item === 'string' && /^[a-f0-9]{64}$/.test(item) ? item : invalid(`${path}.contentHashes[${index}]`));
  return Object.freeze({
    id: text(obj['id'], `${path}.id`), status: oneOf(['proposed', 'adopted', 'failed-answer-key'] as const, obj['status'], `${path}.status`),
    pack: text(pack['pack'], `${path}.pack.pack`, 64), packConfidence: oneOf(CONFIDENCE, pack['confidence'], `${path}.pack.confidence`),
    columns: Object.freeze(columns), skipped: Object.freeze(skipped), contentHashes: Object.freeze(hashes),
  });
}

/** `learningx.dictionaryProposals` → { items, total }. */
export function validateProposals(value: unknown): readonly ProposalView[] {
  const obj = rec(value, 'proposals');
  if (typeof obj['total'] !== 'number' || !Number.isSafeInteger(obj['total']) || obj['total'] < 0) invalid('proposals.total');
  return Object.freeze(list(obj['items'], 'proposals.items', 50).map((item, index) => validateProposal(item, `proposals.items[${index}]`)));
}

async function sha256(textValue: string): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle === undefined) return null;
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(textValue));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

const MAX_SHEET_ROWS = 100_000;
/** Allocated cells, empty ones included (the engine bounds non-empty cells at 100,000). */
const MAX_SHEET_CELLS = 2_000_000;

/** `sources.workbook` → the one sheet's cells, checked; more than one sheet needs a chosen sheet. */
export function validateWorkbookSheet(value: unknown): readonly (readonly string[])[] {
  const obj = rec(value, 'workbook');
  const sheets = list(obj['sheets'], 'workbook.sheets', 64);
  if (sheets.length !== 1) throw Object.assign(new Error('Choose one sheet.'), { code: 'SHEET_REQUIRED' });
  const sheet = rec(sheets[0], 'workbook.sheets[0]');
  text(sheet['name'], 'workbook.sheets[0].name');
  let cells = 0;
  return list(sheet['rows'], 'workbook.sheets[0].rows', MAX_SHEET_ROWS).map((row, index) => list(row, `workbook.sheets[0].rows[${index}]`, 16_384).map((cell, column) => {
    if (typeof cell !== 'string' || cell.length > 100_000 || ++cells > MAX_SHEET_CELLS) invalid(`workbook.sheets[0].rows[${index}][${column}]`);
    return cell as string;
  }));
}

/** The engine's own CSV form of a sheet (platform/runtime/workbook.ts `workbookSheetToCSV`). */
export function sheetToCsv(rows: readonly (readonly string[])[]): string {
  return rows.map(row => row.map(value => /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value).join(',')).join('\n');
}

/** The sheet's text as learning-ext reads it: the CSV as written, or the Excel sheet as CSV. */
async function sheetText(rpc: JourneyPort, file: PickedFile): Promise<string | null> {
  if (file.format === 'csv') return file.content;
  if (file.format === 'xlsx') return sheetToCsv(validateWorkbookSheet(await rpc.request('sources.workbook', { bytesBase64: file.bytesBase64 })));
  return null;
}

/** The draft for one held sheet: an existing proposal for the same text, else a new one. */
export async function proposalsFor(rpc: JourneyPort, file: PickedFile): Promise<ProposalsOutcome> {
  if (file.format === 'pdf') return { kind: 'sheets-only' };
  try {
    const content = await sheetText(rpc, file);
    if (content === null) return { kind: 'sheets-only' };
    const digest = await sha256(content);
    const existing = validateProposals(await rpc.request('learningx.dictionaryProposals', { limit: 20 }));
    const same = digest === null ? undefined : existing.find(item => item.status === 'proposed' && item.contentHashes.includes(digest));
    if (same !== undefined) return { kind: 'ready', proposal: same };
    return { kind: 'ready', proposal: validateProposal(await rpc.request('learningx.dictionaryBuild', { files: [{ content }] })) };
  } catch (error) {
    const failure = failureOf(error);
    if (file.format === 'xlsx' && failure.kind === 'refused' && failure.code === 'PASSWORD_REQUIRED') return { kind: 'locked' };
    return { kind: 'failed', failure };
  }
}

/** One request per held sheet for the life of the journey. */
export function proposalCache(rpc: JourneyPort): (file: PickedFile) => Promise<ProposalsOutcome> {
  const held = new Map<string, Promise<ProposalsOutcome>>();
  return file => {
    const key = file.format === 'csv' ? `csv:${file.content}` : `${file.format}:${file.name}:${file.bytesBase64}`;
    let found = held.get(key);
    if (found === undefined) { found = proposalsFor(rpc, file); held.set(key, found); }
    return found;
  };
}
