/**
 * Reply checks for the write-back additions to Work (docs/lanes/work-books.md, "Write-back in
 * Work"). Every field here is optional on the base shapes in contract.ts, so a reply without
 * them still draws; a field that is present must be valid.
 */
import { amount, bool, count, id, isoDate, list, literal, nullable, object, oneOf, text, type Check } from './kit/validate.ts';
import { actionView, approvalDetail, catalogueEntry, catalogueRow, practice, type ActionView, type ApprovalDetail, type CatalogueEntry, type CatalogueRow, type Practice } from './contract.ts';

const short = text(400);
const long = text(4000);
const day = isoDate;

export const wbExtra = object({
  system: short, action: short, systemTitle: short,
  catalogueKind: oneOf(['inside-undoable', 'seen-outside', 'money', 'cannot-undo'] as const), waitsBecause: long,
  connection: nullable(object({ label: short, environment: short, removed: bool })),
  notices: list(object({ kind: short, at: short }), 50), externalId: nullable(short), settledBy: nullable(oneOf(['person', 'system'] as const)),
});
export type WbExtra = ReturnType<typeof wbExtra>;

export const paymentNote = object({ id, text: object({ en: long, hi: long }), source: long, checkedOn: day, notLegalAdvice: literal(true) });
export type PaymentNote = ReturnType<typeof paymentNote>;
const channel = oneOf(['email', 'whatsapp'] as const);
export const reminder = object({
  customerId: nullable(short), invoiceId: nullable(short), channel: nullable(channel),
  asWritten: nullable(long), invoiceLink: nullable(long), outstanding: nullable(amount),
  notes: nullable(list(paymentNote, 10)),
  agreement: list(object({ channel, answer: oneOf(['yes', 'no', 'not-asked'] as const), source: nullable(short), on: nullable(day) }), 4),
  stoppedOn: nullable(day),
  caps: nullable(object({ perCustomer: count, perDay: count, day: nullable(day), preparedOnDay: count, customerOnDay: count, reached: bool, customerReached: bool })),
  blocked: nullable(object({ code: short, reason: long })),
});
export type Reminder = ReturnType<typeof reminder>;

const sheetExtra = object({}, { writeback: wbExtra, secondAsk: object({ by: oneOf(['typed-amount', 'passphrase'] as const) }), reminder });
/** The approval sheet with its write-back additions. */
export const approvalSheet: Check<ApprovalDetail & ReturnType<typeof sheetExtra>> = (value, path) => Object.freeze({ ...approvalDetail(value, path), ...sheetExtra(value, path) });
export type ApprovalSheetReply = ReturnType<typeof approvalSheet>;

const recordExtra = object({}, { writeback: wbExtra, notice: object({ kind: short, message: long }) });
/** One action's record with its write-back additions. */
export const actionRecord: Check<ActionView & ReturnType<typeof recordExtra>> = (value, path) => Object.freeze({ ...actionView(value, path), ...recordExtra(value, path) });
export type ActionRecord = ReturnType<typeof actionRecord>;

const QUALIFICATION = ['synthetic-tested', 'sandbox-verified', 'live-verified', 'unqualified'] as const;
const rowExtra = object({}, { qualification: nullable(oneOf(QUALIFICATION)), writeScore: nullable(text(20)) });
export const catalogueRowFull: Check<CatalogueRow & ReturnType<typeof rowExtra>> = (value, path) => Object.freeze({ ...catalogueRow(value, path), ...rowExtra(value, path) });
export const catalogueFull = object({ rows: list(catalogueRowFull), writeback: object({ available: bool }) });
const entryExtra = object({}, {
  qualification: nullable(oneOf(QUALIFICATION)), writeScore: nullable(text(20)), waitsBecause: nullable(long),
  plannedStatus: nullable(oneOf(['live', 'experimental', 'prepare-only', 'not-yet'] as const)), businessReference: nullable(long), approvalLifetime: nullable(short),
  reviewedOn: nullable(day), installed: bool, grants: count, undo: nullable(long),
  connections: list(object({ id, label: short, environment: oneOf(['live', 'sandbox', 'practice'] as const), read: bool, write: bool }), 50),
});
export const catalogueEntryFull: Check<CatalogueEntry & ReturnType<typeof entryExtra>> = (value, path) => Object.freeze({ ...catalogueEntry(value, path), ...entryExtra(value, path) });
export type CatalogueEntryFull = ReturnType<typeof catalogueEntryFull>;

const practiceExtra = object({}, { outcome: short, requests: count });
export const practiceRun: Check<Practice & ReturnType<typeof practiceExtra>> = (value, path) => Object.freeze({ ...practice(value, path), ...practiceExtra(value, path) });

/** approvals.exportPrepared: the two files written into the exports folder. */
export const exported = object({ files: list(object({ name: short, path: long, bytes: count }), 10) });
export type Exported = ReturnType<typeof exported>;

