/**
 * A typed fixture of the connectors-ext `imports.*` family for bank statement PDFs, so first run's
 * FR-07 can be previewed and tested before that lane's methods exist. It is not built in: the
 * family belongs to connectors-ext, so a preview or test adds it with
 * `registerFakeMethods('imports', importsFixture())` and removes it with the returned function.
 *
 * Contract (as agreed with connectors-ext):
 * - `imports.readerStatus({})` → `{ state: 'installed' | 'not-installed', sizeBytes? }`
 * - `imports.installReader({})` → the same shape, now installed
 * - `imports.preview({ sourceId, kind: 'pdf', bytesBase64 })` → `{ lines, openingMinor, closingMinor, check }`
 *   or a refusal: PASSWORD_REQUIRED, WRONG_PASSWORD, PICTURE_ONLY, CUT_SHORT, FILTERED, DOES_NOT_ADD_UP, READER_NOT_INSTALLED
 * - `imports.providePassword({ sourceId, password })` → `{ ok: true }`
 * - `imports.commit({ sourceId, kind: 'pdf', bytesBase64 })` → `{ id, sourceId }`
 *
 * Which answer a synthetic file gets is chosen by a marker word in its bytes: `LOCKED` needs the
 * password `SYNTHETIC_PDF_PASSWORD`, `PICTURE`, `CUTSHORT`, `FILTERED` and `NOTADDING` are refused
 * whole. Every figure is invented, in whole paise.
 */
import type { FakeHandler } from '../fake.ts';

export const SYNTHETIC_PDF_PASSWORD = 'synthetic-statement-password';
export interface ImportsFixtureOptions { readonly reader?: 'installed' | 'not-installed' }
export interface PdfPreviewFixture { readonly lines: number; readonly openingMinor: string; readonly closingMinor: string; readonly check: 'passed' | 'failed' }

const refuse = (code: string) => Object.assign(new Error('The synthetic imports fixture refused the request.'), { code });
function text(bytesBase64: unknown): string {
  if (typeof bytesBase64 !== 'string') throw refuse('INVALID_REQUEST');
  try { return atob(bytesBase64); } catch { throw refuse('INVALID_REQUEST'); }
}

export function importsFixture(options: ImportsFixtureOptions = {}): Readonly<Record<string, FakeHandler>> {
  let installed = (options.reader ?? 'installed') === 'installed';
  const unlocked = new Set<string>();
  const status = () => (installed ? { state: 'installed' } : { state: 'not-installed', sizeBytes: 48_200_000 });
  const preview = (payload: Readonly<Record<string, unknown>>): PdfPreviewFixture => {
    if (payload['kind'] !== 'pdf' || typeof payload['sourceId'] !== 'string') throw refuse('INVALID_REQUEST');
    if (!installed) throw refuse('READER_NOT_INSTALLED');
    const body = text(payload['bytesBase64']);
    if (body.includes('LOCKED') && !unlocked.has(payload['sourceId'])) throw refuse('PASSWORD_REQUIRED');
    for (const [marker, code] of [['PICTURE', 'PICTURE_ONLY'], ['CUTSHORT', 'CUT_SHORT'], ['FILTERED', 'FILTERED'], ['NOTADDING', 'DOES_NOT_ADD_UP']] as const) if (body.includes(marker)) throw refuse(code);
    return { lines: 42, openingMinor: '12500000', closingMinor: '14830050', check: 'passed' };
  };
  return Object.freeze({
    readerStatus: () => status(),
    installReader: () => { installed = true; return status(); },
    preview: payload => preview(payload),
    providePassword: payload => {
      if (typeof payload['sourceId'] !== 'string' || typeof payload['password'] !== 'string') throw refuse('INVALID_REQUEST');
      if (payload['password'] !== SYNTHETIC_PDF_PASSWORD) throw refuse('WRONG_PASSWORD');
      unlocked.add(payload['sourceId']);
      return { ok: true };
    },
    commit: payload => { preview(payload); return { id: `import_${String(payload['sourceId'])}`, sourceId: payload['sourceId'] }; },
  });
}
