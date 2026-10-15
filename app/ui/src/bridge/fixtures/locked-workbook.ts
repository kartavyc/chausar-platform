/**
 * A typed fixture of a locked (password-encrypted) Excel workbook for FR-07, serving core-data's
 * round 4 contract (docs/lanes/core-data.md "Encrypted workbooks", `platform/runtime/workbook.ts`
 * and `core-data/ecma376.ts` on `claude/lane-core-data` at a24e95f; not merged in this base):
 *
 * - `sources.workbookPreview` / `sources.workbookImport` `{ sourceId, bytesBase64, sheet?, recipe?, expectedTotals?, password? }`
 *   and `sources.workbook { bytesBase64, sheet?, password? }` for the locked bytes refuse
 *   `PASSWORD_REQUIRED` without a password, `WORKBOOK_PASSWORD_INVALID` for one that is not a
 *   1 to 255 character string (or holds a lone surrogate), and `WRONG_PASSWORD` for a wrong one.
 *   With `SYNTHETIC_WORKBOOK_PASSWORD` they answer as for the plain workbook it holds.
 * - `core: 'today'` is this base's core instead: `readWorkbook` refuses the OLE file as
 *   `UNSUPPORTED_WORKBOOK` and ignores any `password`.
 * - `refuse` makes the opened file refuse with one of core-data's other locked-workbook codes
 *   (`WORKBOOK_ENCRYPTION_UNSUPPORTED` before the password is checked, the rest after).
 *
 * The `sources` family is the fake engine's own, so this is a port wrapper rather than a
 * `registerFakeMethods` family: `lockedWorkbookPort(base)` answers these three methods for the
 * locked bytes and passes everything else (other files included) to `base`. Every figure is
 * invented, in whole paise.
 */

export const SYNTHETIC_WORKBOOK_PASSWORD = 'synthetic-workbook-password';

/** An OLE compound file header, then `EncryptionInfo` in UTF-16LE as the Office encrypted package names its stream, then a marker. */
const LOCKED_BYTES = String.fromCharCode(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1) + 'EncryptionInfo'.split('').map(char => `${char}\u0000`).join('') + 'SYNTHETIC-LOCKED-WORKBOOK';
export const LOCKED_WORKBOOK_BASE64 = btoa(LOCKED_BYTES);

export type LockedRefusal = 'WORKBOOK_ENCRYPTION_UNSUPPORTED' | 'WORKBOOK_ENCRYPTION_INVALID' | 'WORKBOOK_CFB_INVALID' | 'WORKBOOK_INTEGRITY_FAILED';
export interface LockedWorkbookOptions {
  /** `core-data` (default): the round 4 password path. `today`: this base's core, which has none. */
  readonly core?: 'core-data' | 'today';
  readonly refuse?: LockedRefusal;
}
export interface FixturePort { request(method: string, payload?: unknown): Promise<unknown> }

/** The sheet inside, as `sources.workbook` gives it. */
export const LOCKED_SHEET: readonly (readonly string[])[] = Object.freeze([
  Object.freeze(['id', 'date', 'Invoice Value']), Object.freeze(['inv-1', '2026-09-03', '1000.00']), Object.freeze(['inv-2', '2026-09-12', '2000.00']),
]);
const COVERAGE = { sourceRows: 2, importedRows: 2, rejectedRows: 0, expectedRows: 2, reconciled: true };
const PREVIEW = { accepted: true, errors: [], unmappedFields: [], facts: [{}, {}], totalsMinor: '300000', coverage: COVERAGE, format: 'csv', qualification: 'experimental' };
const IMPORTED = { id: 'import_locked_fixture', coverage: COVERAGE, totalsMinor: '300000' };
const WORKBOOK = { sheets: [{ name: 'Sales', rows: LOCKED_SHEET }], coverage: { format: 'xlsx', sheetCount: 1, selectedSheetCount: 1, nonEmptyCells: 9, allocatedCells: 9, formulaCells: 0, readOnly: true }, warnings: [] };

const refusal = (code: string) => Object.assign(new Error('The synthetic locked workbook refused the request.'), { code });
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const KEYS: Readonly<Record<string, readonly string[]>> = {
  'sources.workbookPreview': ['sourceId', 'bytesBase64', 'sheet', 'recipe', 'expectedTotals', 'password'],
  'sources.workbookImport': ['sourceId', 'bytesBase64', 'sheet', 'recipe', 'expectedTotals', 'password'],
  'sources.workbook': ['bytesBase64', 'sheet', 'password'],
};

/** Answers one request for the locked bytes as the chosen core would. */
export function lockedWorkbookAnswer(method: string, payload: Readonly<Record<string, unknown>>, options: LockedWorkbookOptions = {}): unknown {
  const keys = KEYS[method];
  if (keys === undefined || !Object.keys(payload).every(key => keys.includes(key))) throw refusal('INVALID_REQUEST');
  if (options.core === 'today') throw refusal('UNSUPPORTED_WORKBOOK');
  if (Object.hasOwn(payload, 'password')) {
    const password = payload['password'];
    if (typeof password !== 'string' || password.length < 1 || password.length > 255 || LONE_SURROGATE.test(password)) throw refusal('WORKBOOK_PASSWORD_INVALID');
  }
  if (options.refuse === 'WORKBOOK_ENCRYPTION_UNSUPPORTED') throw refusal(options.refuse);
  if (!Object.hasOwn(payload, 'password')) throw refusal('PASSWORD_REQUIRED');
  if (payload['password'] !== SYNTHETIC_WORKBOOK_PASSWORD) throw refusal('WRONG_PASSWORD');
  if (options.refuse !== undefined) throw refusal(options.refuse);
  return structuredClone(method === 'sources.workbook' ? WORKBOOK : method === 'sources.workbookImport' ? IMPORTED : PREVIEW);
}

/** `base` with the three workbook methods answered for the locked bytes. */
export function lockedWorkbookPort<P extends FixturePort>(base: P, options: LockedWorkbookOptions = {}): P {
  return {
    ...base,
    request: async (method: string, payload: unknown = {}) => {
      if (Object.hasOwn(KEYS, method) && isRecord(payload) && payload['bytesBase64'] === LOCKED_WORKBOOK_BASE64) return lockedWorkbookAnswer(method, payload, options);
      return base.request(method, payload);
    },
  };
}
