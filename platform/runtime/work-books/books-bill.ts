/**
 * A bill photo to a booked entry (WK-13, BK-18), experimental.
 *
 * `books.billRead` reads a PDF or a JPEG/PNG photo locally through the Python helper's
 * `pdf.ocr` (a photo is first wrapped as a one-page PDF in memory) and proposes a form. Nothing
 * is stored: the proposal is held in this process for 30 minutes so `books.billConfirm` can bind
 * the person's corrected fields to the exact reading they saw (`digest`). Confirming prepares
 * the booking: through `writeback.prepare` (zoho-books `bill.createFromPhoto`) when the person
 * picks a connection, otherwise a prepare-only Tally purchase voucher. Either way the prepared
 * bill waits in the approvals queue as `bill:<id>` and is approved on the normal approval sheet.
 * Lines plus tax must equal the total to the paisa (BigInt), or the bill is refused.
 */
import { createHash } from 'node:crypto';
import { ChausarError, check, newId, now, type Context, type State } from '../contracts.ts';
import { digest } from '../actions.ts';
import type { MethodSpec, ModuleHost } from '../modules/types.ts';
import { optionalCall } from './adapters.ts';
import { input, member, plainId, text, isoDay, writeBooks, type Amount, type BooksState } from './books-common.ts';
import { parseBill, type BillProposal, type OcrPage } from './books-bill-parse.ts';
import { imageAsPdf } from './books-bill-image.ts';
import { peekSection } from './state.ts';

export const MAX_BILL_BYTES = 4 * 1024 * 1024;
const MIMES = ['application/pdf', 'image/png', 'image/jpeg'] as const;
type Mime = typeof MIMES[number];
const READ_TTL_MS = 30 * 60000, READS_KEPT = 64, MAX_PAGES = 4;
const OCR_CODES = new Set(['OCR_DEPENDENCY_UNAVAILABLE', 'PDF_DEPENDENCY_UNAVAILABLE', 'PYTHON_UNAVAILABLE']);
const PASS_CODES = new Set(['INVALID_PDF', 'PDF_PAGE_LIMIT', 'PDF_TEXT_LIMIT', 'PDF_EXTRACT_FAILED', 'HELPER_TIMEOUT', 'HELPER_INPUT_LIMIT', 'HELPER_OUTPUT_LIMIT']);
const MINOR = /^(0|[1-9]\d{0,15})$/;
const QUANTITY = /^[1-9]\d{0,5}$/;

/** Readings live only in this process, never in the vault: nothing is stored before confirm. */
type Reading = { workspaceId: string; memberId: string; expires: number; digest: string; proposal: BillProposal; mime: Mime; sha256: string };
const readings = new Map<string, Reading>();
function remember(id: string, reading: Reading) {
  const at = Date.now(); for (const [key, value] of readings) if (value.expires <= at) readings.delete(key);
  readings.set(id, reading); while (readings.size > READS_KEPT) readings.delete(readings.keys().next().value!);
}

export type BillState = 'prepared' | 'approved' | 'executing' | 'verified' | 'unknown' | 'rejected' | 'blocked' | 'cancelled';
export type StoredBill = {
  id: string; createdAt: string; by: string; memberId: string; supplier: string; billNumber: string; date: string;
  lines: { description: string; quantity: string; amountMinor: string }[]; tax: { name: string; amountMinor: string }[]; totalMinor: string;
  route: 'tally-preview' | 'zoho-books'; voucher: Voucher | null; writeback: { id: string; digest: string; connectionId: string } | null;
  state: BillState; digest: string; photo: { mime: Mime; sha256: string }; readDigest: string;
};
type Voucher = { type: string; number: string | null; date: string; lines: { ledger: string; debitMinor?: string; creditMinor?: string }[] };

function billsOf(books: BooksState): StoredBill[] {
  const holder = books as unknown as Record<string, unknown>;
  if (!Array.isArray(holder.bills)) holder.bills = [];
  return holder.bills as StoredBill[];
}
/** Prepared bills as stored (read-only); the approvals queue reads them as `bill:<id>` items. */
export function storedBills(state: State): StoredBill[] {
  const list = peekSection<Record<string, unknown>>(state, 'books')?.bills;
  return Array.isArray(list) ? list.filter((b): b is StoredBill => !!b && typeof b === 'object' && typeof (b as StoredBill).id === 'string') : [];
}
export function billView(bill: StoredBill) {
  return {
    id: bill.id, approvalId: `bill:${bill.id}`, route: bill.route, state: bill.state, supplier: bill.supplier, billNumber: bill.billNumber, date: bill.date,
    lines: bill.lines.map(l => ({ description: l.description, quantity: l.quantity, amount: { minor: l.amountMinor } as Amount })),
    tax: bill.tax.map(t => ({ name: t.name, amount: { minor: t.amountMinor } as Amount })), total: { minor: bill.totalMinor } as Amount,
    voucher: bill.voucher ? { type: bill.voucher.type, number: bill.voucher.number, date: bill.voucher.date,
      lines: bill.voucher.lines.map(l => ({ ledger: l.ledger, debit: l.debitMinor ? { minor: l.debitMinor } : null, credit: l.creditMinor ? { minor: l.creditMinor } : null })), note: 'prepare-only' as const } : null,
    writeback: bill.writeback ? { id: bill.writeback.id } : null, createdAt: bill.createdAt, by: bill.by,
  };
}

/** The helper reads the page; a missing reader is a typed refusal, never an empty form. */
async function ocr(host: ModuleHost, pdfBase64: string): Promise<{ pages: OcrPage[]; version: string }> {
  const helper = host.services.helper as { run(operation: string, input: unknown): Promise<{ result: any }> } | undefined;
  check(helper && typeof helper.run === 'function', 'OCR_DEPENDENCY_UNAVAILABLE', 'No local reader is installed on this computer.');
  let result: any;
  try { result = (await helper.run('pdf.ocr', { pdfBase64, maxPages: MAX_PAGES })).result; }
  catch (error) {
    const code = (error as { code?: unknown })?.code;
    if (typeof code === 'string' && OCR_CODES.has(code)) throw new ChausarError('OCR_DEPENDENCY_UNAVAILABLE', 'The local reader (tesseract) is not installed on this computer.');
    if (typeof code === 'string' && PASS_CODES.has(code)) throw new ChausarError(code, 'The bill could not be read.');
    throw new ChausarError('BILL_READ_FAILED', 'The bill could not be read.');
  }
  const pages = Array.isArray(result?.pages) ? result.pages : [];
  check(pages.length > 0 && pages.every((p: any) => Number.isInteger(p?.page) && p.page >= 1 && typeof p.text === 'string' && Number.isInteger(p.confidence) && p.confidence >= 0 && p.confidence <= 100),
    'BILL_READ_FAILED', 'The bill could not be read.');
  return { pages: pages.map((p: any) => ({ page: p.page, text: p.text, confidence: p.confidence })), version: typeof result.engineVersion === 'string' ? result.engineVersion.slice(0, 40) : 'unknown' };
}

/** Zoho Books connections that may book a bill: listed by writeback, not revoked, granted this action. */
async function zohoConnections(host: ModuleHost) {
  const listed = await optionalCall<unknown>(host, 'writeback.connections', {});
  if (!listed.available) return { available: false, connections: [] as { id: string; label: string }[] };
  const rows = Array.isArray(listed.value) ? listed.value : [];
  return { available: true, connections: rows.filter((c: any) => c && c.system === 'zoho-books' && !c.revokedAt && Array.isArray(c.write) && c.write.includes('bill.createFromPhoto') && typeof c.id === 'string')
    .map((c: any) => ({ id: c.id as string, label: typeof c.label === 'string' ? c.label.slice(0, 200) : c.id })) };
}

type Fields = { supplier: string; billNumber: string; date: string; lines: StoredBill['lines']; tax: StoredBill['tax']; totalMinor: string };
function corrected(value: unknown): Fields {
  const f = input(value, ['supplier', 'billNumber', 'date', 'lines', 'tax', 'totalMinor'], ['supplier', 'billNumber', 'date', 'lines', 'tax', 'totalMinor']);
  const plain = (v: unknown) => !!v && typeof v === 'object' && !Array.isArray(v);
  check(text(f.supplier) && text(f.billNumber, 100) && isoDay(f.date) && typeof f.totalMinor === 'string' && MINOR.test(f.totalMinor) && f.totalMinor !== '0'
    && Array.isArray(f.lines) && f.lines.length >= 1 && f.lines.length <= 50 && Array.isArray(f.tax) && f.tax.length <= 10, 'BILL_FIELD_MISSING', 'Fill every field: supplier, bill number, date, at least one line and the total.');
  const lines = f.lines.map((l: any) => {
    check(plain(l) && Object.keys(l).sort().join() === 'amountMinor,description,quantity' && text(l.description) && typeof l.quantity === 'string' && QUANTITY.test(l.quantity) && typeof l.amountMinor === 'string' && MINOR.test(l.amountMinor) && l.amountMinor !== '0',
      'BILL_FIELD_MISSING', 'Each line needs what it is, a whole quantity and its amount.');
    return { description: l.description.trim(), quantity: l.quantity, amountMinor: l.amountMinor };
  });
  const tax = f.tax.map((t: any) => {
    check(plain(t) && Object.keys(t).sort().join() === 'amountMinor,name' && text(t.name, 80) && typeof t.amountMinor === 'string' && MINOR.test(t.amountMinor), 'BILL_FIELD_MISSING', 'Each tax needs its name and amount.');
    return { name: t.name.trim(), amountMinor: t.amountMinor };
  });
  return { supplier: f.supplier.trim(), billNumber: f.billNumber.trim(), date: f.date, lines, tax, totalMinor: f.totalMinor };
}
const sum = (fields: Fields) => [...fields.lines, ...fields.tax].reduce((total, item) => total + BigInt(item.amountMinor), 0n);
/** A purchase voucher: each line and each tax debited, the supplier credited with the total. */
function voucherOf(fields: Fields): Voucher {
  return { type: 'Purchase', number: fields.billNumber, date: fields.date, lines: [
    ...fields.lines.map(l => ({ ledger: `Purchase: ${l.description}`.slice(0, 200), debitMinor: l.amountMinor })),
    ...fields.tax.map(t => ({ ledger: `Input ${t.name}`.slice(0, 200), debitMinor: t.amountMinor })),
    { ledger: fields.supplier, creditMinor: fields.totalMinor },
  ] };
}
/** Zoho takes a rate per unit: a line whose amount does not divide exactly by its quantity goes as one unit. Tax goes as its own line. */
function zohoLines(fields: Fields) {
  return [
    ...fields.lines.map(l => BigInt(l.amountMinor) % BigInt(l.quantity) === 0n
      ? { name: l.description, quantity: Number(l.quantity), rateMinor: String(BigInt(l.amountMinor) / BigInt(l.quantity)) }
      : { name: `${l.description} (${l.quantity})`.slice(0, 200), quantity: 1, rateMinor: l.amountMinor }),
    ...fields.tax.filter(t => t.amountMinor !== '0').map(t => ({ name: t.name, quantity: 1, rateMinor: t.amountMinor })),
  ];
}
const WRITEBACK_STATE: Record<string, BillState> = { prepared: 'prepared', approved: 'approved', executing: 'executing', verified: 'verified', unknown: 'unknown', rejected: 'rejected', cancelled: 'cancelled', blocked: 'blocked' };
async function settle(host: ModuleHost, ctx: Context, id: string, view: unknown) {
  const status = (view as { status?: unknown })?.status; const next = typeof status === 'string' ? WRITEBACK_STATE[status] : undefined;
  if (next) await writeBooks(host.store, ctx, 'prepare', books => { const bill = billsOf(books).find(b => b.id === id); if (bill) bill.state = next; });
}
function findBill(state: State, id: unknown): StoredBill {
  const bill = typeof id === 'string' ? storedBills(state).find(b => b.id === id) : undefined; check(bill, 'BILL_NOT_FOUND', 'This bill is not in the list.'); return bill;
}

/** Approval of a `bill:` item from the approvals queue: a Zoho bill is approved through writeback at the exact digest. */
export async function approveBill(ctx: Context, host: ModuleHost, id: string, expected: string) {
  const bill = findBill(host.store.read(), id);
  check(bill.route === 'zoho-books' && bill.writeback, 'PREPARE_ONLY', 'This is prepare only. Enter the voucher in Tally yourself or give it to your accountant.');
  await settle(host, ctx, id, await host.call('writeback.approve', { id: bill.writeback.id, digest: expected }));
}
export async function dropBill(ctx: Context, host: ModuleHost, id: string) {
  const bill = findBill(host.store.read(), id);
  if (bill.writeback) await host.call('writeback.drop', { id: bill.writeback.id });
  await writeBooks(host.store, ctx, 'approve', books => { const stored = billsOf(books).find(b => b.id === id); if (stored) stored.state = 'cancelled'; });
}

export const billMethods: Record<string, MethodSpec> = {
  'books.billRead': { permission: 'prepare', async handler(ctx, payload, host) {
    const request = input(payload, ['bytesBase64', 'mime'], ['bytesBase64', 'mime']);
    check(!ctx.sourceTainted, 'TAINTED_REQUEST', 'Only a person can bring a bill to read.');
    check(MIMES.includes(request.mime), 'INVALID_BOOKS_REQUEST', 'Send a PDF, a PNG or a JPEG.');
    check(typeof request.bytesBase64 === 'string' && request.bytesBase64.length > 0 && request.bytesBase64.length <= Math.ceil(MAX_BILL_BYTES / 3) * 4 && /^[A-Za-z0-9+/]+={0,2}$/.test(request.bytesBase64),
      'BILL_TOO_LARGE', 'The bill must be a file of at most 4 MB.');
    const bytes = Buffer.from(request.bytesBase64, 'base64'); check(bytes.length > 0 && bytes.length <= MAX_BILL_BYTES, 'BILL_TOO_LARGE', 'The bill must be a file of at most 4 MB.');
    const mime = request.mime as Mime; const state = host.store.read();
    let pdf: Buffer;
    if (mime === 'application/pdf') { check(bytes.subarray(0, 5).toString('latin1') === '%PDF-', 'INVALID_BILL_FILE', 'This file is not a PDF.'); pdf = bytes; }
    else {
      // The only reader of pictures is local; when it cannot carry this picture and nothing may leave, say so plainly.
      try { pdf = imageAsPdf(bytes, mime); }
      catch (error) {
        if ((error as ChausarError)?.code === 'IMAGE_OCR_NOT_AVAILABLE' && state.policy.send === 'nothing') throw new ChausarError('NOT_AVAILABLE_WITH_SEND_SETTING', 'Not available with your send setting.');
        throw error;
      }
      check(pdf.length <= MAX_BILL_BYTES, 'BILL_TOO_LARGE', 'The picture is too large to read here.');
    }
    const read = await ocr(host, pdf.toString('base64'));
    const proposal = parseBill(read.pages);
    const sha256 = createHash('sha256').update(bytes).digest('hex'); const readId = newId('billread');
    const readDigest = digest({ proposal, sha256 }); const expires = Date.now() + READ_TTL_MS;
    remember(readId, { workspaceId: state.workspace.id, memberId: ctx.memberId, expires, digest: readDigest, proposal, mime, sha256 });
    return { readId, digest: readDigest, mime, stored: false as const, expiresAt: new Date(expires).toISOString(), untrusted: true as const,
      reader: { engine: 'tesseract' as const, version: read.version, pages: read.pages.length, confidence: Math.min(...read.pages.map(p => p.confidence)) },
      ...proposal, routes: { zohoBooks: await zohoConnections(host), tallyPreview: { available: true as const } } };
  } },
  'books.billConfirm': { permission: 'prepare', async handler(ctx, payload, host) {
    const request = input(payload, ['readId', 'fields', 'digest', 'zoho'], ['readId', 'fields', 'digest']);
    check(!ctx.sourceTainted, 'TAINTED_REQUEST', 'Only a person can confirm a bill.');
    check(typeof request.readId === 'string' && typeof request.digest === 'string', 'INVALID_BOOKS_REQUEST', 'Send the reading and its digest.');
    const state = host.store.read(); const reading = readings.get(request.readId);
    check(reading && reading.expires > Date.now() && reading.workspaceId === state.workspace.id && reading.memberId === ctx.memberId, 'BILL_READ_EXPIRED', 'This reading is no longer held. Read the bill again.');
    check(reading.digest === request.digest, 'PREVIEW_CHANGED', 'This is not the reading you checked. Read the bill again.');
    const fields = corrected(request.fields);
    check(sum(fields) === BigInt(fields.totalMinor), 'BILL_TOTAL_MISMATCH', 'Lines plus tax do not equal the total. Correct a field first.');
    const zoho = request.zoho === undefined ? null : input(request.zoho, ['connectionId', 'vendorId'], ['connectionId', 'vendorId']);
    if (zoho) check(plainId(zoho.connectionId) && plainId(zoho.vendorId), 'INVALID_BOOKS_REQUEST', 'Choose the Zoho Books connection and the vendor.');
    const id = newId('bill'); const who = member(state, ctx);
    let writeback: StoredBill['writeback'] = null; let billState: BillState = 'prepared';
    if (zoho) {
      const prepared = await optionalCall<any>(host, 'writeback.prepare', { connectionId: zoho.connectionId, action: 'bill.createFromPhoto', intentId: `bill-${reading.digest.slice(0, 32)}`,
        payload: { vendorId: zoho.vendorId, billNumber: fields.billNumber, date: fields.date, lines: zohoLines(fields), photoReference: `photo-sha256:${reading.sha256.slice(0, 32)}` } });
      check(prepared.available, 'WRITEBACK_NOT_BUILT', 'Booking in Zoho Books is not built yet.');
      const view = prepared.value;
      if (view?.status === 'already-done') billState = 'verified';
      else { check(typeof view?.id === 'string' && typeof view.digest === 'string', 'INVALID_WRITEBACK_REPLY', 'The prepared booking could not be read back.'); writeback = { id: view.id, digest: view.digest, connectionId: zoho.connectionId as string }; }
    }
    const voucher = zoho ? null : voucherOf(fields);
    const bill: StoredBill = { id, createdAt: now(), by: who.name, memberId: who.id, ...fields, route: zoho ? 'zoho-books' : 'tally-preview', voucher, writeback, state: billState,
      digest: writeback?.digest ?? digest({ fields, voucher, photo: reading.sha256 }), photo: { mime: reading.mime, sha256: reading.sha256 }, readDigest: reading.digest };
    await writeBooks(host.store, ctx, 'prepare', books => { billsOf(books).push(bill); });
    readings.delete(request.readId);
    return billView(bill);
  } },
  'books.bills': { permission: 'read', handler(ctx, payload, host) {
    input(payload, []); return { bills: storedBills(host.store.read()).slice().reverse().map(billView) };
  } },
  'books.billBook': { permission: 'prepare', async handler(ctx, payload, host) {
    const { id } = input(payload, ['id'], ['id']); const bill = findBill(host.store.read(), id);
    check(bill.route === 'zoho-books' && bill.writeback, 'PREPARE_ONLY', 'This is prepare only. Enter the voucher in Tally yourself or give it to your accountant.');
    check(['approved', 'unknown'].includes(bill.state), 'INVALID_APPROVAL_STATE', 'Approve the bill first.');
    await settle(host, ctx, bill.id, await host.call(bill.state === 'unknown' ? 'writeback.readBack' : 'writeback.execute', { id: bill.writeback.id }));
    return billView(findBill(host.store.read(), bill.id));
  } },
};
