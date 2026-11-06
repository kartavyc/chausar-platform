// Chausar seller calculations, independently written from commerce.md and sealeap-amazon-skills ideas (MIT).
// Browser-safe domain core shared by the real and fake engines. It reads no files and performs no outside effect.
export type SellerEvidence = { type: 'fact' | 'estimate' | 'assumption'; value: string; source: string; observedAt: string }
  | { type: 'unknown'; source: string; observedAt: string; missingReason: string };
export type SellerRate = { id: string; rateBps: string; source: string; checkedOn: string; confirmedBy: { name: string; on: string } | null };
export type SalesBasis = 'gst-inclusive' | 'taxable';
export type EconomicsInput = {
  sellingMinor: SellerEvidence; gstBps: SellerEvidence; referralBps: SellerEvidence; referralBasis: SellerEvidence;
  closingMinor: SellerEvidence; shippingMinor: SellerEvidence; feesGstBps: SellerEvidence; stockMinor: SellerEvidence;
  stockGstMinor: SellerEvidence; packagingMinor: SellerEvidence; adsMinor: SellerEvidence; adsGstMinor: SellerEvidence;
  returnBps: SellerEvidence; returnLossMinor: SellerEvidence; inputCredit: SellerEvidence;
  tcsRule: SellerRate; tdsRule: SellerRate; tdsBasis: SellerEvidence;
};
export type SellerUse = { rehearsal: boolean; today?: string };
export type EconomicsResult = { status: 'ready'; figures: Record<string, string>; inputs: EconomicsInput; basis: string[]; line: string; rehearsal: boolean };
/** A domain refusal; engine facades convert it to ChausarError, the fake to EngineError. */
export function sellerRefuse(code: string, message: string): never { throw Object.assign(new Error(message), { code }); }
/** Rejects unknown keys rather than silently accepting a different contract. */
export function exact(value: unknown, keys: readonly string[], required: readonly string[] = keys): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key)) || required.some(key => !Object.hasOwn(value, key))) sellerRefuse('SELLER_INPUT_INVALID', 'Use exactly the fields named in this seller sheet.');
}
/** Half-up arithmetic in integer minor units, including negative differences. */
export function sellerRound(n: bigint, d: bigint): bigint {
  if (d <= 0n) sellerRefuse('SELLER_INPUT_INVALID', 'The calculation needs a positive denominator.');
  const sign = n < 0n ? -1n : 1n; const a = n < 0n ? -n : n;
  return sign * ((a * 2n + d) / (d * 2n));
}
/** A documented nonnegative minor amount or rate, never a floating point value. */
export function sellerInteger(value: unknown, name: string): bigint {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,17})$/.test(value)) sellerRefuse('SELLER_INPUT_INVALID', `${name} must be a nonnegative whole number as text.`);
  return BigInt(value as string);
}
/** Evidence requires a source and a timezone-aware observed time, including for zero and unknown. */
export function readEvidence(value: unknown, name: string): SellerEvidence {
  const e = value as SellerEvidence;
  exact(e, e?.type === 'unknown' ? ['type', 'source', 'observedAt', 'missingReason'] : ['type', 'source', 'observedAt', 'value']);
  if (!['fact', 'estimate', 'assumption', 'unknown'].includes(e.type) || typeof e.source !== 'string' || !e.source.trim() || e.source.length > 500
    || typeof e.observedAt !== 'string' || !/^\d{4}-\d\d-\d\dT.+(?:Z|[+-]\d\d:\d\d)$/.test(e.observedAt) || !Number.isFinite(Date.parse(e.observedAt))) sellerRefuse('SELLER_INPUT_INVALID', `${name} needs its evidence type, source and observed time with timezone.`);
  if (e.type === 'unknown') { if (typeof e.missingReason !== 'string' || !e.missingReason.trim()) sellerRefuse('SELLER_INPUT_INVALID', `${name} needs a missing reason.`); }
  else if (typeof e.value !== 'string') sellerRefuse('SELLER_INPUT_INVALID', `${name} needs its value as text.`);
  return e;
}
/** A real calendar day used by dated fee and tax sources. */
export function sellerDay(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d\d-\d\d$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}
/** Tax rates come from a dated source confirmed by a CA for client work, never a model default. */
export function sellerRate(raw: unknown, use: SellerUse): SellerRate {
  exact(raw, ['id', 'rateBps', 'source', 'checkedOn', 'confirmedBy']);
  const r = raw as unknown as SellerRate;
  const today = use.today ?? new Date(Date.now() + 19800000).toISOString().slice(0, 10);
  if (!r.id || typeof r.source !== 'string' || !r.source.trim() || !sellerDay(r.checkedOn) || r.checkedOn > today || sellerInteger(r.rateBps, 'Rate') > 10000n) sellerRefuse('SELLER_INPUT_INVALID', 'Use a dated tax source with its rate.');
  if (r.confirmedBy !== null) {
    exact(r.confirmedBy, ['name', 'on']);
    if (typeof r.confirmedBy.name !== 'string' || !r.confirmedBy.name.trim() || !sellerDay(r.confirmedBy.on) || r.confirmedBy.on < r.checkedOn || r.confirmedBy.on > today) sellerRefuse('SELLER_INPUT_INVALID', 'Use the CA name and confirmation day.');
  }
  if (!use.rehearsal && !r.confirmedBy) sellerRefuse('RULE_UNCONFIRMED', 'Your CA must confirm the dated tax source before client work.');
  return r;
}
const ECONOMIC_FIELDS = ['sellingMinor', 'gstBps', 'referralBps', 'closingMinor', 'shippingMinor', 'feesGstBps', 'stockMinor', 'stockGstMinor', 'packagingMinor', 'adsMinor', 'adsGstMinor', 'returnBps', 'returnLossMinor', 'inputCredit', 'referralBasis', 'tdsBasis'] as const;
/** Three tied views of an owner's supplied seller economics. No advice to buy stock or change prices. */
export function computeUnitEconomics(raw: unknown, use: SellerUse): EconomicsResult {
  exact(raw, [...ECONOMIC_FIELDS, 'tcsRule', 'tdsRule']);
  const input = raw as unknown as EconomicsInput;
  const entries = ECONOMIC_FIELDS.map(key => [key, readEvidence(input[key], key)] as const);
  const missing = entries.filter(([, e]) => e.type === 'unknown').map(([key, e]) => ({ field: key, reason: e.type === 'unknown' ? e.missingReason : '' }));
  if (missing.length) { const error = Object.assign(new Error('The unit economics sheet is held until the missing inputs are known.'), { code: 'UNIT_ECONOMICS_HOLD', missing }); throw error; }
  const tcs = sellerRate(input.tcsRule, use), tds = sellerRate(input.tdsRule, use);
  const values = Object.fromEntries(entries.map(([key, e]) => [key, e.type === 'unknown' ? '' : e.value])) as Record<typeof ECONOMIC_FIELDS[number], string>;
  if (!['yes', 'no'].includes(values.inputCredit)) sellerRefuse('SELLER_INPUT_INVALID', 'Say yes or no to eligible input credit.');
  if (!['gst-inclusive', 'taxable'].includes(values.referralBasis) || !['gst-inclusive', 'taxable'].includes(values.tdsBasis)) sellerRefuse('SELLER_INPUT_INVALID', 'Name the referral and TDS sales bases from the source.');
  const n = (key: Exclude<typeof ECONOMIC_FIELDS[number], 'inputCredit' | 'referralBasis' | 'tdsBasis'>) => sellerInteger(values[key], key);
  for (const key of ['gstBps', 'referralBps', 'feesGstBps', 'returnBps'] as const) if (n(key) > 10000n) sellerRefuse('SELLER_INPUT_INVALID', 'A percentage cannot be above its whole.');
  const sale = n('sellingMinor'); if (sale === 0n) sellerRefuse('SELLER_INPUT_INVALID', 'The selling price must be above zero.');
  const taxable = sellerRound(sale * 10000n, 10000n + n('gstBps')), output = sale - taxable;
  const referral = sellerRound((values.referralBasis === 'gst-inclusive' ? sale : taxable) * n('referralBps'), 10000n);
  const fees = referral + n('closingMinor') + n('shippingMinor'), feeGst = sellerRound(fees * n('feesGstBps'), 10000n);
  const tcsAmount = sellerRound(taxable * BigInt(tcs.rateBps), 10000n), tdsAmount = sellerRound((values.tdsBasis === 'gst-inclusive' ? sale : taxable) * BigInt(tds.rateBps), 10000n);
  const payout = sale - fees - feeGst - tcsAmount - tdsAmount;
  const returns = sellerRound(n('returnLossMinor') * n('returnBps'), 10000n);
  const credit = values.inputCredit === 'yes', inputTax = credit ? feeGst + n('stockGstMinor') + n('adsGstMinor') : 0n;
  const gstCash = output - inputTax - tcsAmount;
  if (gstCash < 0n) throw Object.assign(new Error('Unused GST credit needs your CA review; it is not assumed to be a cash refund.'), { code: 'UNIT_ECONOMICS_HOLD', missing: [{ field: 'creditUtilisation', reason: 'Unused GST credit treatment needs review' }] });
  const contribution = taxable - fees - n('stockMinor') - n('packagingMinor') - n('adsMinor') - returns - (credit ? 0n : feeGst + n('stockGstMinor') + n('adsGstMinor'));
  const tie = payout - n('stockMinor') - n('stockGstMinor') - n('packagingMinor') - n('adsMinor') - n('adsGstMinor') - gstCash - returns + tdsAmount;
  if (tie !== contribution) sellerRefuse('UNIT_ECONOMICS_NO_TIE', 'The contribution, payout and GST cash views do not tie.');
  const figures = Object.fromEntries(Object.entries({ taxableMinor: taxable, outputGstMinor: output, referralMinor: referral, feesMinor: fees, feesGstMinor: feeGst,
    tcsMinor: tcsAmount, tdsMinor: tdsAmount, payoutMinor: payout, returnsMinor: returns, gstCashMinor: gstCash, contributionMinor: contribution,
    beforeAdsMinor: contribution + n('adsMinor') + (credit ? 0n : n('adsGstMinor')), contributionBps: sellerRound(contribution * 10000n, taxable), tieMinor: tie }).map(([key, v]) => [key, v.toString()]));
  return { status: 'ready', figures, inputs: input, basis: [...new Set(entries.map(([, e]) => e.type))], line: 'This is not a buying decision.', rehearsal: use.rehearsal };
}
/** Break-even ACOS only after the owner names the sales basis of their advertising export. */
export function computeBreakEven(result: EconomicsResult, basis: SalesBasis | null): { bps: string; basis: SalesBasis } {
  if (!basis || !['gst-inclusive', 'taxable'].includes(basis)) sellerRefuse('ADS_BASIS_REQUIRED', 'Say whether the ads report counts GST-inclusive sales or taxable value.');
  const sale = result.inputs.sellingMinor; if (sale.type === 'unknown') sellerRefuse('UNIT_ECONOMICS_HOLD', 'The selling price is unknown.');
  const base = basis === 'gst-inclusive' ? BigInt(sale.value) : BigInt(result.figures.taxableMinor!);
  return { bps: sellerRound(BigInt(result.figures.beforeAdsMinor!) * 10000n, base).toString(), basis };
}

export type AdsInput = { spendMinor: string; salesMinor: string; reportedAcosBps: string | null; basis: SalesBasis | null; source: string; observedAt: string };
/** Recomputes ACOS from raw export amounts, without trusting the report's percentage. */
export function computeAds(raw: unknown, economics?: EconomicsResult) {
  exact(raw, ['spendMinor', 'salesMinor', 'reportedAcosBps', 'basis', 'source', 'observedAt']);
  const input = raw as unknown as AdsInput;
  readEvidence({ type: 'fact', value: input.spendMinor, source: input.source, observedAt: input.observedAt }, 'Ads export');
  const spend = sellerInteger(input.spendMinor, 'Spend'), sales = sellerInteger(input.salesMinor, 'Sales');
  if (input.basis !== null && !['gst-inclusive', 'taxable'].includes(input.basis)) sellerRefuse('SELLER_INPUT_INVALID', 'Choose the sales basis from the ads export.');
  const reported = input.reportedAcosBps === null ? null : sellerInteger(input.reportedAcosBps, 'Reported ACOS');
  const acos = sales === 0n ? null : sellerRound(spend * 10000n, sales);
  const delta = acos !== null && reported !== null ? (acos > reported ? acos - reported : reported - acos) : null;
  const reconciles = delta === null ? null : delta <= 1n;
  const breakEven = input.basis && economics ? computeBreakEven(economics, input.basis) : null;
  return { acosBps: acos?.toString() ?? null, reconciles, breakEven, reason: !input.basis ? 'ADS_BASIS_REQUIRED' : !economics ? 'ECONOMICS_REQUIRED' : sales === 0n ? 'NO_ATTRIBUTED_SALES' : null,
    line: reconciles === false ? 'The ads report does not reconcile.' : sales === 0n ? 'There are no attributed sales to compare.' : 'ACOS was recomputed from spend and sales.', source: input.source };
}

export type SettlementInput = { orderId: string; expectedMinor: string; paidMinor: string; source: string; observedAt: string;
  adjustments: { kind: 'fee-slab' | 'weight-change' | 'return-deduction'; minor: string; source: string }[]; holdReasons: string[] };
/** Named payout differences, not a claim filing or a receivable entry. */
export function computeSettlements(raw: unknown) {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 500) sellerRefuse('SELLER_INPUT_INVALID', 'Use a settlement export with a bounded set of order lines.');
  const seen = new Set<string>();
  const rows = (raw as SettlementInput[]).map(input => {
    exact(input, ['orderId', 'expectedMinor', 'paidMinor', 'source', 'observedAt', 'adjustments', 'holdReasons']);
    if (typeof input.orderId !== 'string' || !input.orderId.trim() || seen.has(input.orderId)) sellerRefuse('SELLER_INPUT_INVALID', 'Each settlement order id must be unique.');
    seen.add(input.orderId);
    readEvidence({ type: 'fact', value: input.paidMinor, source: input.source, observedAt: input.observedAt }, 'Settlement');
    const delta = sellerInteger(input.expectedMinor, 'Expected payout') - sellerInteger(input.paidMinor, 'Actual payout');
    if (!Array.isArray(input.adjustments) || input.adjustments.length > 30 || !Array.isArray(input.holdReasons) || input.holdReasons.some(reason => typeof reason !== 'string' || !reason.trim() || reason.length > 300)) sellerRefuse('SELLER_INPUT_INVALID', 'Use named differences with evidence and hold reasons.');
    const differences: { kind: string; minor: string; source: string }[] = input.adjustments.map(a => {
      exact(a, ['kind', 'minor', 'source']);
      if (!['fee-slab', 'weight-change', 'return-deduction'].includes(a.kind) || typeof a.source !== 'string' || !a.source.trim()) sellerRefuse('SELLER_INPUT_INVALID', 'Each difference needs its reason and source.');
      sellerInteger(a.minor, 'Adjustment'); return { ...a };
    });
    const remaining = delta - differences.reduce((sum, item) => sum + BigInt(item.minor), 0n);
    const holdReasons = [...input.holdReasons];
    if (remaining !== 0n) { differences.push({ kind: 'unknown', minor: remaining.toString(), source: 'Unexplained settlement balance' }); holdReasons.push('Unexplained settlement balance'); }
    return { orderId: input.orderId, differenceMinor: delta.toString(), differences, holdReasons, claimKind: 'estimate for review, not receivable' as const, submitted: false as const, source: input.source };
  });
  return { rows, submitted: false as const, line: 'Nothing submitted. The seller files any claim.' };
}

export type ListingInput = { marketplace: 'amazon-in' | 'flipkart' | 'meesho'; title: string | null; bullets: string[] | null; description: string | null; images: { name: string; width: number; height: number; source: string }[] | null };
/** Dated, openly labelled rubric data; category-specific marketplace policies still need an owner export. */
export const SELLER_LISTING_RULES = Object.freeze({
  'amazon-in': { checkedOn: '2026-10-27', titleMax: 200, repeats: 2, imagesMin: 1, pixelsMin: 1000, read: 'official', source: 'https://sellercentral.amazon.in/seller-forums/discussions/t/ad1b21a8-548c-4a01-a809-bf8d4469f108', limitation: 'Public announcement says most categories; category-specific help may differ. Pixel target is our zoom-readiness rubric.' },
  flipkart: { checkedOn: '2026-10-27', titleMax: 80, repeats: 2, imagesMin: 1, pixelsMin: 1000, read: 'house', source: 'Chausar own rubric', limitation: 'Not a verified Flipkart category policy.' },
  meesho: { checkedOn: '2026-10-27', titleMax: 80, repeats: 2, imagesMin: 1, pixelsMin: 1000, read: 'house', source: 'Chausar own rubric', limitation: 'Not a verified Meesho category policy.' },
});
/** Data coverage first; missing fields never earn an invented score. */
export function computeListing(raw: unknown) {
  exact(raw, ['marketplace', 'title', 'bullets', 'description', 'images']);
  const input = raw as unknown as ListingInput;
  if (!Object.hasOwn(SELLER_LISTING_RULES, input.marketplace)) sellerRefuse('SELLER_INPUT_INVALID', 'Choose a marketplace this rubric covers.');
  const rules = SELLER_LISTING_RULES[input.marketplace];
  for (const key of ['title', 'description'] as const) if (input[key] !== null && (typeof input[key] !== 'string' || input[key]!.length > 20000)) sellerRefuse('SELLER_INPUT_INVALID', 'Use the listing text from the export.');
  if (input.bullets !== null && (!Array.isArray(input.bullets) || input.bullets.length > 30 || input.bullets.some(b => typeof b !== 'string' || b.length > 5000))) sellerRefuse('SELLER_INPUT_INVALID', 'Use the bullet list from the export.');
  if (input.images !== null && (!Array.isArray(input.images) || input.images.length > 30)) sellerRefuse('SELLER_INPUT_INVALID', 'Use a bounded set of product images.');
  for (const image of input.images ?? []) {
    exact(image, ['name', 'width', 'height', 'source']);
    if (typeof image.name !== 'string' || !image.name.trim() || typeof image.source !== 'string' || !image.source.trim() || !Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width < 1 || image.height < 1) sellerRefuse('SELLER_INPUT_INVALID', 'Image dimensions must come from a readable image header.');
  }
  const fields = ['title', 'bullets', 'description', 'images'] as const;
  const present = fields.filter(key => input[key] !== null && (typeof input[key] === 'string' ? input[key]!.trim().length > 0 : (input[key] as unknown[])!.length > 0));
  const questions = fields.filter(key => !present.includes(key)).map(field => ({ field, words: `Upload ${field} to unlock this check.` }));
  const findings: { code: string; field: string; fix: string }[] = [];
  const titleWords = (input.title ?? '').split(/\s+/).filter(Boolean), counts = new Map<string, number>();
  const banned = new Set(['best', 'free', 'sale', 'discount', 'guaranteed', 'bestseller', 'amazing', 'cheapest']);
  const triage = titleWords.map(phrase => {
    const word = phrase.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''); const seen = counts.get(word) ?? 0; counts.set(word, seen + 1);
    const action = banned.has(word) ? 'delete' : seen > 0 ? 'move' : 'keep';
    if (banned.has(word)) findings.push({ code: 'TITLE_PROMOTION', field: 'title', fix: 'Remove promotional or subjective wording.' });
    if (seen >= rules.repeats) findings.push({ code: 'TITLE_REPEAT', field: 'title', fix: 'Remove the repeated title word.' });
    return { phrase, action };
  });
  if (input.title && [...input.title].length > rules.titleMax) findings.push({ code: 'TITLE_LONG', field: 'title', fix: 'Check the category limit and move extra detail into the bullets.' });
  for (const image of input.images ?? []) if (Math.min(image.width, image.height) < rules.pixelsMin) findings.push({ code: 'IMAGE_SMALL', field: 'images', fix: 'Upload a larger product image for the zoom-readiness rubric.' });
  const complete = present.length === fields.length;
  return { coverage: { present: present.length, of: fields.length, line: 'Data coverage comes before the listing score.' }, score: complete ? Math.max(0, 100 - findings.length * 10) : null,
    reason: complete ? null : 'LISTING_EVIDENCE_MISSING', basis: 'Chausar own rubric, not a marketplace internal score', questions, findings, triage,
    manual: ['Check the main image background by eye.'], rules: { ...rules } };
}
/** Reads PNG, JPEG or WebP dimensions from headers, never from a filename or the model. */
export function readImageDimensions(bytes: Uint8Array): { width: number; height: number } {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 24 && [137,80,78,71,13,10,26,10].every((n, i) => bytes[i] === n) && String.fromCharCode(...bytes.slice(12,16)) === 'IHDR') {
    const width = v.getUint32(16), height = v.getUint32(20); if (width && height) return { width, height };
  }
  if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216) {
    let p = 2;
    while (p + 4 <= bytes.length) {
      if (bytes[p++] !== 255) break;
      while (bytes[p] === 255) p++;
      const marker = bytes[p++]; if (marker === 217 || marker === 218 || p + 2 > bytes.length) break;
      const size = v.getUint16(p); if (size < 2 || p + size > bytes.length) break;
      if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker!) && size >= 7) {
        const height = v.getUint16(p + 3), width = v.getUint16(p + 5); if (width && height) return { width, height };
      }
      p += size;
    }
  }
  if (bytes.length >= 30 && String.fromCharCode(...bytes.slice(0,4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8,12)) === 'WEBP' && String.fromCharCode(...bytes.slice(12,16)) === 'VP8X') {
    return { width: 1 + bytes[24]! + (bytes[25]! << 8) + (bytes[26]! << 16), height: 1 + bytes[27]! + (bytes[28]! << 8) + (bytes[29]! << 16) };
  }
  sellerRefuse('IMAGE_HEADER_UNREADABLE', 'The image header does not provide readable dimensions.');
}

export type IndiaListingInput = { packaged: boolean; sellingMinor: string; mrpMinor: string | null; countryOfOrigin: string; sellerDetails: string };
/** Legal rows are rehearsal-only until a lawyer confirms this exact dated rule version. */
export function computeIndiaListing(raw: unknown, use: SellerUse & { confirmedBy?: { name: string; on: string } | null; checkedOn?: string }) {
  exact(raw, ['packaged', 'sellingMinor', 'mrpMinor', 'countryOfOrigin', 'sellerDetails']);
  const input = raw as unknown as IndiaListingInput;
  if (typeof input.packaged !== 'boolean' || typeof input.countryOfOrigin !== 'string' || typeof input.sellerDetails !== 'string') sellerRefuse('SELLER_INPUT_INVALID', 'Record the packaged-goods status, origin and seller details.');
  if (!use.rehearsal && (!use.confirmedBy || !use.confirmedBy.name.trim() || !sellerDay(use.confirmedBy.on) || Boolean(use.checkedOn && use.confirmedBy.on < use.checkedOn) || use.confirmedBy.on > (use.today ?? new Date(Date.now() + 19800000).toISOString().slice(0, 10)))) sellerRefuse('RULE_UNCONFIRMED', 'A lawyer must confirm the India listing rules before client work.');
  const findings: { code: string; field: string; fix: string }[] = [];
  const sale = sellerInteger(input.sellingMinor, 'Selling price');
  if (input.packaged && input.mrpMinor === null) findings.push({ code: 'MRP_REQUIRED', field: 'mrpMinor', fix: 'Add the MRP from the package.' });
  else if (input.packaged && input.mrpMinor !== null && sale > sellerInteger(input.mrpMinor, 'MRP')) findings.push({ code: 'PRICE_ABOVE_MRP', field: 'sellingMinor', fix: 'Ask the seller to set a price within the package MRP.' });
  if (input.packaged && !input.countryOfOrigin.trim()) findings.push({ code: 'ORIGIN_REQUIRED', field: 'countryOfOrigin', fix: 'Add the country of origin from the package.' });
  if (!input.sellerDetails.trim()) findings.push({ code: 'SELLER_DETAILS_REQUIRED', field: 'sellerDetails', fix: 'Add the seller name and contact details.' });
  return { findings, rehearsal: use.rehearsal, basis: 'India listing declarations, confirmed rules required for client use', passed: findings.length === 0 };
}
/** The code figures from a seller result, shared by tool receipts and the browser-only fake engine. */
export function sellerNumbers(result: unknown): Record<string, string> {
  const r = result as { figures?: Record<string, string>; acosBps?: string | null; rows?: { differenceMinor: string; differences?: { minor: string }[] }[]; score?: number | null };
  if (r.figures) return r.figures;
  if (r.acosBps !== undefined) return { ...(r.acosBps === null ? {} : { acosBps: r.acosBps }), ...((r as { breakEven?: { bps: string } | null }).breakEven ? { breakEvenBps: (r as { breakEven: { bps: string } }).breakEven.bps } : {}) };
  if (r.rows) return Object.fromEntries(r.rows.flatMap((row, i) => [[`differenceMinor${i + 1}`, row.differenceMinor], ...(row.differences ?? []).map((item, j) => [`differencePart${i + 1}_${j + 1}Minor`, item.minor])]));
  return r.score === null || r.score === undefined ? {} : { listingScore: String(r.score) };
}



/** Formats a signed basis-point figure without splitting the negative sign. */
export function sellerPercent(value: string): string {
  const n = BigInt(value), a = n < 0n ? -n : n;
  return `${n < 0n ? '-' : ''}${a / 100n}.${String(a % 100n).padStart(2, '0')}%`;
}
