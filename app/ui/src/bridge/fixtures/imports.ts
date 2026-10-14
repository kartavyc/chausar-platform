/**
 * A typed fixture of the connectors-ext `imports.*` family for bank statement PDFs, serving the
 * real shapes of docs/lanes/connectors-ext.md "FR-07 contract" (platform/runtime/connectors-ext/fr07.ts),
 * so first run's FR-07 can be previewed and tested on the fake engine. It is not built in: a
 * preview or test adds it with `registerFakeMethods('imports', importsFixture())` and removes it
 * with the returned function.
 *
 * - `imports.readerStatus({})` → `{ status, pdfText, pdfOcr, reason, sizeBytes: null }`
 * - `imports.installReader({})` → always refuses `READER_INSTALL_UNAVAILABLE` (`DEMO_EXTERNAL_DISABLED` in demo)
 * - `imports.providePassword({ sourceId, password })` → `{ held: true, sourceId, expiresInSeconds: 600, usedOnce: true }`;
 *   `PASSWORD_INVALID` for an empty, overlong or control-character password. It does not check the
 *   password: the next preview of that source uses it once and wipes it.
 * - `imports.preview({ sourceId, kind: 'pdf', bytesBase64 })` → the envelope plus `fr07`
 * - `imports.commit({ sourceId, envelopeId })` → the `fr07` result, now imported
 *
 * Which answer a synthetic file gets is chosen by a marker word in its bytes:
 *   LOCKED     needs the password `SYNTHETIC_PDF_PASSWORD` (PASSWORD_REQUIRED, then WRONG_PASSWORD)
 *   PICTURE    PICTURE_ONLY            NOTAPDF   INVALID_PDF
 *   BADLINE    PDF_LINE_UNREADABLE     TOOLONG   PDF_PAGE_LIMIT
 *   CUTSHORT   refused, CUT_SHORT      FILTERED  refused, FILTERED with both totals
 *   NOTADDING  refused, DOES_NOT_ADD_UP at line 17
 *   SCANNED    accepted, read by OCR   QUESTION  abstained (a question)
 *   EXPIRED    accepted, but commit refuses ENVELOPE_EXPIRED
 * A second commit of the same bytes for the same source is a duplicate. Every figure is invented,
 * in whole paise.
 */
import type { FakeHandler } from '../fake.ts';

export const SYNTHETIC_PDF_PASSWORD = 'synthetic-statement-password';
export interface ImportsFixtureOptions {
  /** `not-installed` is PYTHON_NOT_CONFIGURED; `library-missing` is PDF_LIBRARY_MISSING. */
  readonly reader?: 'installed' | 'not-installed' | 'library-missing';
  /** Whether OCR for scanned pages is there (default: yes when installed). */
  readonly ocr?: boolean;
  /** A demo launch: installing the reader is refused as DEMO_EXTERNAL_DISABLED. */
  readonly demo?: boolean;
}

type Reason = 'CUT_SHORT' | 'FILTERED' | 'DOES_NOT_ADD_UP';
interface Read { readonly id: string; readonly sourceId: string; readonly body: string; readonly status: 'accepted' | 'refused' | 'abstained'; readonly code: string | null; readonly reason: Reason | null; readonly ocr: boolean; committed: { importId: string; rows: number; duplicate: boolean } | null }

const refuse = (code: string) => Object.assign(new Error('The synthetic imports fixture refused the request.'), { code });
const SOURCE = /^[A-Za-z0-9_.:-]{1,100}$/;
const LINES = 42, OPENING = '12500000', CLOSING = '14830050';
function text(bytesBase64: unknown): string {
  if (typeof bytesBase64 !== 'string' || bytesBase64.length === 0) throw refuse('INVALID_PDF');
  try { return atob(bytesBase64); } catch { throw refuse('INVALID_PDF'); }
}
function exactKeys(payload: Readonly<Record<string, unknown>>, keys: readonly string[]): void {
  if (!Object.keys(payload).every(key => keys.includes(key)) || !keys.every(key => Object.hasOwn(payload, key))) throw refuse('CONNECTOR_REQUEST_INVALID');
}

export function importsFixture(options: ImportsFixtureOptions = {}): Readonly<Record<string, FakeHandler>> {
  const reader = options.reader ?? 'installed';
  const installed = reader === 'installed';
  const ocr = installed && (options.ocr ?? true);
  const held = new Map<string, string>();
  const reads = new Map<string, Read>();
  const committed = new Set<string>();
  let next = 0;

  const fr07 = (read: Read) => {
    const refused = read.status === 'refused';
    return {
      envelopeId: read.id, sourceId: read.sourceId, kind: 'bank-statement',
      state: read.committed ? 'imported' : read.status === 'accepted' ? 'checked' : read.status === 'abstained' ? 'question' : 'refused',
      reason: read.reason, code: read.code, line: read.reason === 'DOES_NOT_ADD_UP' ? 17 : null,
      totals: read.reason === 'FILTERED' ? { expected: CLOSING, observed: '14700050' } : null,
      linesRead: refused && read.reason === 'CUT_SHORT' ? 30 : LINES, openingMinor: OPENING, closingMinor: read.reason === 'CUT_SHORT' ? null : CLOSING,
      checkPassed: read.status === 'accepted', readByOcr: read.ocr,
      kept: { file: 'not-kept', record: 'books-sources-history' },
      imported: read.committed ? { ...read.committed } : null,
    };
  };
  const envelope = (read: Read) => ({
    id: read.id, sourceId: read.sourceId, status: read.status,
    refusal: read.code === null ? null : { code: read.code, reason: 'A synthetic refusal; never shown.' },
    abstention: read.status === 'abstained' ? { reason: 'BANK_COLUMNS_AMBIGUOUS', question: 'A synthetic question; never shown.' } : null,
    checks: [{ id: 'closing-balance', status: read.status === 'accepted' ? 'passed' : 'failed', expected: CLOSING, observed: CLOSING }],
    observed: { rowCount: LINES, total: '2330050', unit: 'INR' }, sourceTotals: null,
    balances: { opening: OPENING, closing: CLOSING }, unmappedFields: [],
    notices: read.ocr ? ['OCR read a scanned page (experimental).'] : [], pendingRows: read.status === 'accepted' ? LINES : 0,
    fr07: fr07(read),
  });

  return Object.freeze({
    readerStatus: payload => {
      exactKeys(payload, []);
      return installed
        ? { status: 'installed', pdfText: true, pdfOcr: ocr, reason: null, sizeBytes: null }
        : { status: 'not-installed', pdfText: false, pdfOcr: false, reason: reader === 'library-missing' ? 'PDF_LIBRARY_MISSING' : 'PYTHON_NOT_CONFIGURED', sizeBytes: null };
    },
    installReader: payload => { exactKeys(payload, []); throw refuse(options.demo ? 'DEMO_EXTERNAL_DISABLED' : 'READER_INSTALL_UNAVAILABLE'); },
    providePassword: payload => {
      exactKeys(payload, ['sourceId', 'password']);
      const sourceId = payload['sourceId'], password = payload['password'];
      if (typeof sourceId !== 'string' || !SOURCE.test(sourceId)) throw refuse('CONNECTOR_REQUEST_INVALID');
      if (typeof password !== 'string' || password.length < 1 || password.length > 256 || /[\u0000-\u001f]/.test(password)) throw refuse('PASSWORD_INVALID');
      held.set(sourceId, password);
      return { held: true, sourceId, expiresInSeconds: 600, usedOnce: true };
    },
    preview: payload => {
      exactKeys(payload, ['sourceId', 'kind', 'bytesBase64']);
      const sourceId = payload['sourceId'];
      if (typeof sourceId !== 'string' || !SOURCE.test(sourceId) || payload['kind'] !== 'pdf') throw refuse('CONNECTOR_REQUEST_INVALID');
      const body = text(payload['bytesBase64']);
      // Single use: reading the password removes it.
      const password = held.get(sourceId); held.delete(sourceId);
      if (!installed) throw refuse('READER_NOT_INSTALLED');
      if (body.includes('NOTAPDF')) throw refuse('INVALID_PDF');
      if (body.includes('LOCKED')) {
        if (password === undefined) throw refuse('PASSWORD_REQUIRED');
        if (password !== SYNTHETIC_PDF_PASSWORD) throw refuse('WRONG_PASSWORD');
      }
      for (const [marker, code] of [['PICTURE', 'PICTURE_ONLY'], ['BADLINE', 'PDF_LINE_UNREADABLE'], ['TOOLONG', 'PDF_PAGE_LIMIT']] as const) if (body.includes(marker)) throw refuse(code);
      const content = ([['CUTSHORT', 'CUT_SHORT', 'SOURCE_CUT_SHORT'], ['FILTERED', 'FILTERED', 'SOURCE_TOTAL_MISMATCH'], ['NOTADDING', 'DOES_NOT_ADD_UP', 'BALANCE_BROKEN']] as const).find(([marker]) => body.includes(marker));
      const question = body.includes('QUESTION');
      const read: Read = {
        id: `envelope_${++next}`, sourceId, body,
        status: content ? 'refused' : question ? 'abstained' : 'accepted',
        code: content ? content[2] : null, reason: content ? content[1] : null,
        ocr: body.includes('SCANNED') && ocr, committed: null,
      };
      reads.set(read.id, read);
      return envelope(read);
    },
    commit: payload => {
      exactKeys(payload, ['sourceId', 'envelopeId']);
      const read = typeof payload['envelopeId'] === 'string' ? reads.get(payload['envelopeId']) : undefined;
      if (read === undefined) throw refuse('ENVELOPE_NOT_FOUND');
      if (read.sourceId !== payload['sourceId']) throw refuse('CONNECTOR_REQUEST_INVALID');
      if (read.status !== 'accepted') throw refuse('IMPORT_NOT_ACCEPTED');
      if (read.body.includes('EXPIRED')) throw refuse('ENVELOPE_EXPIRED');
      if (read.committed === null) {
        const key = `${read.sourceId}\u0000${read.body}`;
        read.committed = { importId: `import_${read.id}`, rows: LINES, duplicate: committed.has(key) };
        committed.add(key);
      }
      return fr07(read);
    },
  });
}
