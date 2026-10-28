// Chausar seller CSV boundary, independent code from the research contracts. No outside library copied.
import { computeAds, computeUnitEconomics, computeListing, computeSettlements, computeIndiaListing, readImageDimensions, exact, sellerRefuse, type SellerUse, type EconomicsInput, type SellerEvidence } from './model.ts';
export type SellerMode = 'economics' | 'ads' | 'settlement' | 'listing';
export const SELLER_MODES: readonly SellerMode[] = ['economics', 'ads', 'settlement', 'listing'];
/** Bounded RFC-style CSV parser shared by the engine and fake; quoted commas/newlines stay in one cell. */
export function sellerCsv(text: string): Record<string, string>[] {
  if (text.length > 1000000) sellerRefuse('UPLOAD_LIMIT', 'Add a seller CSV smaller than one megabyte.');
  const rows: string[][] = []; let row: string[] = [], cell = '', quote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === '"') { if (quote && text[i + 1] === '"') { cell += '"'; i++; } else quote = !quote; }
    else if (!quote && (c === ',' || c === '\n' || c === '\r')) {
      row.push(cell); cell = ''; if (c !== ',') { if (c === '\r' && text[i + 1] === '\n') i++; if (row.some(Boolean)) rows.push(row); row = []; }
    } else cell += c;
    if (cell.length > 20000 || row.length > 60 || rows.length > 500) sellerRefuse('SELLER_INPUT_INVALID', 'The seller sheet is too large.');
  }
  if (quote) sellerRefuse('SELLER_INPUT_INVALID', 'A quoted CSV cell was not closed.');
  row.push(cell); if (row.some(Boolean)) rows.push(row);
  const header = rows.shift()?.map(c => c.replace(/^\uFEFF/, '').trim());
  if (!header?.length || new Set(header).size !== header.length || header.some(key => !key || ['__proto__', 'constructor', 'prototype'].includes(key))) sellerRefuse('SELLER_INPUT_INVALID', 'Use unique named CSV columns.');
  return rows.map(values => {
    if (values.length !== header!.length) sellerRefuse('SELLER_INPUT_INVALID', 'A seller CSV row has the wrong number of columns.');
    return Object.fromEntries(header!.map((key, i) => [key, values[i]!])) as Record<string, string>;
  });
}
/** Input-file validation; never accepts provider secrets or silently renames another format. */
export function sellerFile(raw: unknown): { name: string; contentBase64: string; text: string } {
  exact(raw, ['name', 'contentBase64']);
  const { name, contentBase64 } = raw;
  if (typeof name !== 'string' || name.length > 120 || !/^[^\\/\u0000-\u001f]+\.csv$/i.test(name) || typeof contentBase64 !== 'string' || contentBase64.length > 1400000 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(contentBase64)) sellerRefuse('SELLER_INPUT_INVALID', 'Add a UTF-8 CSV export from the seller.');
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(contentBase64 as string), c => c.charCodeAt(0))); }
  catch { sellerRefuse('SELLER_INPUT_INVALID', 'Add a readable UTF-8 CSV export.'); }
  return { name: name as string, contentBase64: contentBase64 as string, text: text! };
}
/** Reads evidenced economics rows; tax confirmations are trusted configuration, never cells in an agent-selected file. */
export function economicsRows(rows: readonly Record<string, string>[], tax: Pick<EconomicsInput, 'tcsRule' | 'tdsRule'>): EconomicsInput {
  const input: Record<string, unknown> = { ...tax };
  for (const row of rows) {
    const field = row.field;
    if (!field || Object.hasOwn(input, field)) sellerRefuse('SELLER_INPUT_INVALID', 'Each economics input must appear once.');
    input[field] = row.type === 'unknown'
      ? { type: 'unknown', source: row.source ?? '', observedAt: row.observedAt ?? '', missingReason: row.missingReason ?? '' } satisfies SellerEvidence
      : { type: row.type, value: row.value, source: row.source, observedAt: row.observedAt };
  }
  return input as EconomicsInput;
}
/** Runs one named check from source-file rows. No number is taken from a model tool argument. */
export function analyseSellerRows(mode: SellerMode, rows: readonly Record<string, string>[], use: SellerUse & { confirmedBy?: { name: string; on: string } | null; checkedOn?: string }, tax: Pick<EconomicsInput, 'tcsRule' | 'tdsRule'>, images: { name: string; width: number; height: number; source: string }[] = [], economics?: readonly Record<string, string>[]) {
  if (!SELLER_MODES.includes(mode) || !rows.length) sellerRefuse('SELLER_INPUT_INVALID', 'Choose a check and add its source rows.');
  if (mode === 'economics') return computeUnitEconomics(economicsRows(rows, tax), use);
  if (mode === 'ads') {
    if (rows.length !== 1) sellerRefuse('SELLER_INPUT_INVALID', 'Use one ads totals row for this check.');
    const r = rows[0]!;
    return computeAds({ spendMinor: r.spendMinor, salesMinor: r.salesMinor, reportedAcosBps: r.reportedAcosBps || null, basis: r.basis || null, source: r.source, observedAt: r.observedAt }, economics ? computeUnitEconomics(economicsRows(economics, tax), use) : undefined);
  }
  if (mode === 'settlement') return computeSettlements(rows.map(r => ({ orderId: r.orderId, expectedMinor: r.expectedMinor, paidMinor: r.paidMinor, source: r.source, observedAt: r.observedAt,
    adjustments: (['fee-slab', 'weight-change', 'return-deduction'] as const).flatMap((kind, i) => { const key = ['feeSlabMinor', 'weightChangeMinor', 'returnDeductionMinor'][i]!; return r[key] ? [{ kind, minor: r[key]!, source: r[`${key}Source`] || r.source! }] : []; }), holdReasons: r.holdReasons ? r.holdReasons.split('|') : [] })));
  if (rows.length !== 1) sellerRefuse('SELLER_INPUT_INVALID', 'Use one listing row for this check.');
  const r = rows[0]!;
  const listing = computeListing({ marketplace: r.marketplace, title: r.title || null, bullets: r.bullets ? r.bullets.split('|') : null, description: r.description || null, images: images.length ? images : null });
  // Legal checks are explicitly separate from the house rubric; client use cannot invent a lawyer confirmation.
  if (!['yes', 'no'].includes(r.packaged ?? '')) sellerRefuse('SELLER_INPUT_INVALID', 'Say yes or no to packaged goods before checking India declarations.');
  const india = computeIndiaListing({ packaged: r.packaged === 'yes', sellingMinor: r.sellingMinor, mrpMinor: r.mrpMinor || null, countryOfOrigin: r.countryOfOrigin || '', sellerDetails: r.sellerDetails || '' }, use);
  return { ...listing, india };
}


/** Optional listing photos; dimensions are derived only from bytes, never a caller claim. */
export function sellerImageFiles(raw: unknown) {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > 4) sellerRefuse('SELLER_INPUT_INVALID', 'Add at most four listing photos to one check.');
  return raw.map(value => {
    exact(value, ['name', 'contentBase64']);
    if (typeof value.name !== 'string' || value.name.length > 120 || !/\.(?:png|jpe?g|webp)$/i.test(value.name) || /[\\/\u0000-\u001f]/.test(value.name) || typeof value.contentBase64 !== 'string' || value.contentBase64.length > 1400000 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.contentBase64)) sellerRefuse('SELLER_INPUT_INVALID', 'Add readable product photos with their original filenames.');
    const dimensions = readImageDimensions(Uint8Array.from(atob(value.contentBase64 as string), c => c.charCodeAt(0)));
    return { name: value.name as string, contentBase64: value.contentBase64 as string, dimensions };
  });
}
