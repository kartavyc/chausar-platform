import { check, ChausarError, type Context } from '../contracts.ts';
import type { ModuleHost } from '../modules/types.ts';
import { handlers } from './service.ts';
import { peekCx, type Envelope } from './state.ts';

/**
 * FR-07, "Bring a file": the `imports.*` methods the first-run screen calls. A PDF statement runs
 * through the bank-statement recipe (text first, OCR for scanned pages); CSV and XLSX delegate to
 * the core `sources.*` importer. A PDF password lives in engine memory only, for one use.
 */
const SOURCE = /^[A-Za-z0-9_.:-]{1,100}$/;
const REQUEST = 'CONNECTOR_REQUEST_INVALID';
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
export const PASSWORD_TTL_MS = 10 * 60 * 1000;
type Held = { password: string; expiresAt: number; memberId: string };
/**
 * Keyed by the open vault object: locking or closing drops the vault, so its passwords become
 * unreachable and are collected. Nothing here is persisted, backed up, logged or audited by value.
 */
const holds = new WeakMap<object, Map<string, Held>>();
function held(host: ModuleHost): Map<string, Held> {
  const vault = host.store as object; let map = holds.get(vault);
  if (!map) { map = new Map(); holds.set(vault, map); }
  for (const [key, item] of map) if (item.expiresAt <= Date.now()) map.delete(key);
  return map;
}
/** Single use: reading the password removes it. */
function take(host: ModuleHost, ctx: Context, sourceId: string): string | undefined {
  const map = held(host), item = map.get(sourceId); map.delete(sourceId);
  return item && item.memberId === ctx.memberId ? item.password : undefined;
}
function trusted(ctx: Context) {
  check((ctx.channel === undefined || ctx.channel === 'desktop') && ctx.sourceTainted !== true, 'OPEN_DESKTOP', 'Do this yourself in the desktop app.');
}
const plain = (value: unknown): value is Record<string, any> => value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
function shape(payload: Record<string, unknown>, allowed: readonly string[], required: readonly string[]) {
  check(plain(payload) && Object.keys(payload).every(key => allowed.includes(key)) && required.every(key => Object.hasOwn(payload, key)), REQUEST, 'This request has unexpected or missing fields.');
}

/** The fixed FR-07 refusals a screen shows for a thrown PDF failure. */
const THROWN: Record<string, { code: string; message: string }> = {
  PASSWORD_REQUIRED: { code: 'PASSWORD_REQUIRED', message: 'This PDF has a password. Enter it to read the file once on this computer.' },
  WRONG_PASSWORD: { code: 'WRONG_PASSWORD', message: 'That password did not open the file.' },
  PDF_SCANNED_PAGE: { code: 'PICTURE_ONLY', message: 'This statement is a picture. Chausar cannot read it yet.' },
  OCR_DEPENDENCY_UNAVAILABLE: { code: 'PICTURE_ONLY', message: 'This statement is a picture. Chausar cannot read it yet.' },
  PDF_OCR_LOW_CONFIDENCE: { code: 'PICTURE_ONLY', message: 'This statement is a picture that could not be read clearly enough.' },
  PYTHON_UNAVAILABLE: { code: 'READER_NOT_INSTALLED', message: 'The PDF reader is not installed yet.' },
  PDF_DEPENDENCY_UNAVAILABLE: { code: 'READER_NOT_INSTALLED', message: 'The PDF reader is not installed yet.' },
  PDF_HELPER_REQUIRED: { code: 'READER_NOT_INSTALLED', message: 'The PDF reader is not installed yet.' },
};
/** Content refusals return an envelope; this is the FR-07 reason for each. */
const REASONS: Record<string, 'CUT_SHORT' | 'FILTERED' | 'DOES_NOT_ADD_UP'> = {
  SOURCE_CUT_SHORT: 'CUT_SHORT', BALANCE_CLOSING_MISMATCH: 'CUT_SHORT', BALANCE_MISSING: 'CUT_SHORT',
  SOURCE_TOTAL_MISMATCH: 'FILTERED', SOURCE_ROW_MISMATCH: 'FILTERED', BANK_SUMMARY_MISMATCH: 'FILTERED',
  BALANCE_BROKEN: 'DOES_NOT_ADD_UP',
};
export type Fr07Result = {
  envelopeId: string; sourceId: string; kind: 'bank-statement'; state: 'checked' | 'refused' | 'question' | 'imported';
  reason: 'CUT_SHORT' | 'FILTERED' | 'DOES_NOT_ADD_UP' | null; code: string | null; line: number | null;
  totals: { expected: string | number | null; observed: string | number | null } | null;
  linesRead: number; openingMinor: string | null; closingMinor: string | null; checkPassed: boolean;
  readByOcr: boolean; kept: { file: 'not-kept'; record: 'books-sources-history' };
  imported: { importId: string; rows: number; duplicate: boolean } | null;
};
export function fr07Result(envelope: Envelope): Fr07Result {
  const code = envelope.refusal?.code ?? null, reason = code ? REASONS[code] ?? null : null;
  const failed = envelope.checks.find(item => item.status === 'failed');
  const closing = envelope.checks.find(item => item.id === 'closing-balance');
  return { envelopeId: envelope.id, sourceId: envelope.sourceId, kind: 'bank-statement',
    state: envelope.committed ? 'imported' : envelope.status === 'accepted' ? 'checked' : envelope.status === 'abstained' ? 'question' : 'refused',
    reason, code, line: envelope.refusal?.line ?? failed?.line ?? null,
    totals: reason === 'FILTERED' && failed ? { expected: failed.expected ?? null, observed: failed.observed ?? null } : null,
    linesRead: envelope.observed.rowCount, openingMinor: envelope.balances?.opening ?? null, closingMinor: envelope.balances?.closing ?? null,
    checkPassed: envelope.status === 'accepted' && closing?.status === 'passed',
    readByOcr: envelope.notices.some(notice => /OCR/.test(notice)),
    kept: { file: 'not-kept', record: 'books-sources-history' },
    imported: envelope.committed ? { importId: envelope.committed.importId, rows: envelope.committed.rows, duplicate: envelope.committed.duplicate } : null };
}
function envelopeFor(host: ModuleHost, id: unknown): Envelope {
  check(typeof id === 'string' && id.length > 0 && id.length <= 100, REQUEST, 'Choose a file that was read.');
  const found = peekCx(host.store.read()).envelopes.find(item => item.id === id);
  check(found, 'ENVELOPE_NOT_FOUND', 'This file is no longer waiting.');
  return found;
}

export const imports = {
  providePassword(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
    trusted(ctx); shape(payload, ['sourceId', 'password'], ['sourceId', 'password']);
    check(typeof payload.sourceId === 'string' && SOURCE.test(payload.sourceId), REQUEST, 'Choose the file this password opens.');
    check(typeof payload.password === 'string' && payload.password.length >= 1 && payload.password.length <= 256 && !/[\u0000-\u001f]/.test(payload.password), 'PASSWORD_INVALID', 'Type the password as the file was given.');
    held(host).set(payload.sourceId, { password: payload.password, expiresAt: Date.now() + PASSWORD_TTL_MS, memberId: ctx.memberId });
    return { held: true, sourceId: payload.sourceId, expiresInSeconds: PASSWORD_TTL_MS / 1000, usedOnce: true };
  },
  async preview(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
    trusted(ctx);
    shape(payload, ['sourceId', 'kind', 'bytesBase64', 'content', 'sheet', 'recipe', 'expectedTotals', 'company', 'branch'], ['sourceId', 'kind']);
    check(typeof payload.sourceId === 'string' && SOURCE.test(payload.sourceId), REQUEST, 'Name the file.');
    if (payload.kind === 'csv') return host.call('sources.preview', { sourceId: payload.sourceId, format: 'csv', content: payload.content, ...(payload.recipe ? { recipe: payload.recipe } : {}), ...(payload.expectedTotals ? { expectedTotals: payload.expectedTotals } : {}) });
    if (payload.kind === 'xlsx') return host.call('sources.workbookPreview', { sourceId: payload.sourceId, bytesBase64: payload.bytesBase64, ...(payload.sheet ? { sheet: payload.sheet } : {}), ...(payload.recipe ? { recipe: payload.recipe } : {}), ...(payload.expectedTotals ? { expectedTotals: payload.expectedTotals } : {}) });
    check(payload.kind === 'pdf', REQUEST, 'Bring a PDF, CSV or XLSX file.');
    check(typeof payload.bytesBase64 === 'string' && payload.bytesBase64.length > 0 && payload.bytesBase64.length <= 5_600_000 && BASE64.test(payload.bytesBase64), 'INVALID_PDF', 'Choose a PDF statement smaller than four megabytes.');
    const password = take(host, ctx, payload.sourceId);
    const company = typeof payload.company === 'string' && payload.company.length > 0 ? payload.company : host.store.read().workspace.name;
    let envelope: any;
    try {
      envelope = await handlers.importPreview(ctx, { recipeId: 'bank.pdf-text', sourceId: payload.sourceId, company, ...(payload.branch ? { branch: payload.branch } : {}), pdfBase64: payload.bytesBase64 }, host, password ? { password } : {});
    } catch (error) {
      const code = (error as any)?.code, mapped = typeof code === 'string' ? THROWN[code] : undefined;
      if (mapped) throw new ChausarError(mapped.code, mapped.message);
      throw error;
    }
    return { ...envelope, fr07: fr07Result(envelopeFor(host, envelope.id)) };
  },
  async commit(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
    shape(payload, ['sourceId', 'envelopeId'], ['sourceId', 'envelopeId']);
    const envelope = envelopeFor(host, payload.envelopeId);
    check(envelope.sourceId === payload.sourceId, REQUEST, 'This read belongs to another file.');
    await handlers.importCommit(ctx, { envelopeId: envelope.id }, host);
    return fr07Result(envelopeFor(host, envelope.id));
  },
  result(_ctx: Context, payload: Record<string, any>, host: ModuleHost) {
    shape(payload, ['envelopeId'], ['envelopeId']);
    return fr07Result(envelopeFor(host, payload.envelopeId));
  },
  /** Whether the trusted helper and its PDF libraries are present. Opens no file; reads no workspace data. */
  async readerStatus(_ctx: Context, payload: Record<string, any>, host: ModuleHost) {
    shape(payload, [], []);
    const helper = host.services.helper;
    const configured = typeof helper?.options?.executable === 'string' && helper.options.executable.length > 0;
    if (!configured) return { status: 'not-installed', pdfText: false, pdfOcr: false, reason: 'PYTHON_NOT_CONFIGURED', sizeBytes: null };
    try {
      const { result } = await helper.run('pdf.status', {});
      return { status: result.pdfText === true ? 'installed' : 'not-installed', pdfText: result.pdfText === true, pdfOcr: result.pdfOcr === true,
        reason: result.pdfText === true ? null : 'PDF_LIBRARY_MISSING', sizeBytes: null };
    } catch (error) {
      return { status: 'not-installed', pdfText: false, pdfOcr: false, reason: typeof (error as any)?.code === 'string' ? (error as any).code : 'HELPER_EXECUTION_FAILED', sizeBytes: null };
    }
  },
  installReader(_ctx: Context, payload: Record<string, any>) {
    shape(payload, [], []);
    throw new ChausarError('READER_INSTALL_UNAVAILABLE', 'This build does not download the PDF reader. The installer must bundle Python with pdfplumber, pypdfium2, Pillow and tesseract.');
  },
};
