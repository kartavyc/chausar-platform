/**
 * The written list of what Chausar can do. One row per action per system. If an action is not
 * in this table it does not exist: a request for it is refused with "Not in the list yet" and
 * recorded on the wanted list. Each row carries the eleven fields the "What it can do" screen
 * shows, plus its write-back recipe (required fields, preconditions, the reference for not
 * doing it twice, the read-back query). The recipe's tested score is computed separately.
 */
import { check } from '../contracts.ts';
import { digest } from '../actions.ts';
import type { SystemId } from './types.ts';

export type Kind = 'inside-undoable' | 'seen-outside' | 'money' | 'cannot-undo';
export type Status = 'live' | 'experimental' | 'prepare-only' | 'not-yet';
export type CatalogueEntry = {
  /** 1 */ system: SystemId;
  /** 2 */ action: string;
  title: string;
  /** 3: what kind of change it is */ kind: Kind;
  tier: 1 | 2 | 'prepare-only';
  /** 4: on the always-waits list (money, messages to outsiders, deleting, anything that cannot be undone) */ alwaysWaits: boolean;
  waitsBecause: string;
  /** 5: the founder's planned status; it shows as experimental until sandbox or live evidence exists */ plannedStatus: Status;
  /** 6: how it avoids doing it twice */ idempotency: string;
  /** 7: the business reference written into the system */ businessReference: string;
  /** 8: how it reads back */ readBack: string;
  /** 9: how long a lost reply can still be settled by looking, in hours; null when the system gives no way to look */ retryWindowHours: number | null;
  /** 10: how long a yes lasts, in hours */ approvalLifetimeHours: number;
  /** 11: when this row was last reviewed and when it must be reviewed again */ reviewedOn: string; expiresOn: string;
  reversal: string | null;
  recipe: { requiredFields: string[]; preconditions: string[]; reference: string; readBackQuery: string };
};

const MESSAGE_HOURS = 24, INSIDE_HOURS = 24 * 7, MONEY_HOURS = 24;
const reviewed = { reviewedOn: '2026-10-14', expiresOn: '2027-04-14' };
const waits = {
  money: 'Money always waits for a person.',
  message: 'A message to someone outside the business always waits for a person.',
  irreversible: 'A change that cannot be undone (prices, stock, listings, sharing, filings) always waits for a person.',
  inside: 'Every change waits for your yes; this one can be undone and may be approved in a group.',
};

const rows: CatalogueEntry[] = [
  // Tally: XML over the local HTTP interface on port 9000.
  { system: 'tally', action: 'voucher.create', title: 'Enter a voucher in Tally', kind: 'inside-undoable', tier: 1, alwaysWaits: false, waitsBecause: waits.inside, plannedStatus: 'experimental',
    idempotency: 'Looks first for a voucher with the same voucher number and Chausar remote id in the company; imports with ACTION="Create" only when none exists.',
    businessReference: 'Voucher number, plus the Chausar effect key as the voucher REMOTEID.', readBack: 'Exports the Day Book for the voucher date and compares the voucher by number: type, date, party, ledger amounts.',
    retryWindowHours: 24 * 30, approvalLifetimeHours: INSIDE_HOURS, ...reviewed, reversal: 'Alter or delete the voucher in Tally; Chausar prepares that as a new action.',
    recipe: { requiredFields: ['company', 'voucherType', 'voucherNumber', 'date', 'party', 'lines'], preconditions: ['Tally is open with the named company loaded.', 'Every ledger named in the lines exists.', 'The debit and credit lines balance in paise.'], reference: 'voucherNumber', readBackQuery: 'Day Book export for the voucher date, filtered by voucher number.' } },
  { system: 'tally', action: 'ledger.create', title: 'Create a ledger in Tally', kind: 'inside-undoable', tier: 1, alwaysWaits: false, waitsBecause: waits.inside, plannedStatus: 'experimental',
    idempotency: 'Ledger names are unique in a Tally company: looks for the name first and creates only when absent.', businessReference: 'Ledger name.',
    readBack: 'Exports the ledger master by name and compares its group.', retryWindowHours: 24 * 30, approvalLifetimeHours: INSIDE_HOURS, ...reviewed, reversal: 'Delete the unused ledger in Tally.',
    recipe: { requiredFields: ['company', 'name', 'parent'], preconditions: ['The parent group exists.', 'No ledger has this name.'], reference: 'name', readBackQuery: 'Ledger master export by name.' } },
  // Zoho Books.
  { system: 'zoho-books', action: 'invoice.createDraft', title: 'Create a draft invoice in Zoho Books', kind: 'inside-undoable', tier: 1, alwaysWaits: false, waitsBecause: waits.inside, plannedStatus: 'live',
    idempotency: 'Looks first for an invoice whose reference number is the Chausar effect reference; creates a draft only when none exists. Drafts are never sent.',
    businessReference: 'reference_number set to the effect reference.', readBack: 'Lists invoices by reference_number and compares customer, date, lines and total.',
    retryWindowHours: 24 * 30, approvalLifetimeHours: INSIDE_HOURS, ...reviewed, reversal: 'Delete the draft invoice (a new action that always waits).',
    recipe: { requiredFields: ['customerId', 'date', 'lines'], preconditions: ['The customer exists in the organisation.', 'The invoice is created as a draft.'], reference: 'reference_number', readBackQuery: 'GET /invoices?reference_number=' } },
  { system: 'zoho-books', action: 'invoice.paymentReminder', title: 'Send a payment reminder from Zoho Books', kind: 'seen-outside', tier: 2, alwaysWaits: true, waitsBecause: waits.message, plannedStatus: 'live',
    idempotency: 'Reads the invoice comments for a reminder carrying the effect reference before sending; sends at most once per effect key.',
    businessReference: 'The effect reference written into the reminder body.', readBack: 'Reads the invoice comments and looks for the reminder with the effect reference.',
    retryWindowHours: 24 * 7, approvalLifetimeHours: MESSAGE_HOURS, ...reviewed, reversal: null,
    recipe: { requiredFields: ['invoiceId', 'to', 'subject', 'body'], preconditions: ['The invoice is unpaid.', 'The customer agreed to reminders on this channel.'], reference: 'effect reference in body', readBackQuery: 'GET /invoices/{id}/comments' } },
  { system: 'zoho-books', action: 'payment.record', title: 'Record a customer payment in Zoho Books', kind: 'inside-undoable', tier: 2, alwaysWaits: false, waitsBecause: waits.inside, plannedStatus: 'live',
    idempotency: 'Looks first for a customer payment whose reference number is the effect reference; records only when none exists.',
    businessReference: 'reference_number set to the effect reference (the bank reference is kept in the description).', readBack: 'Lists customer payments by reference_number and compares amount, date and the invoice applied.',
    retryWindowHours: 24 * 30, approvalLifetimeHours: INSIDE_HOURS, ...reviewed, reversal: 'Delete the recorded payment (a new action that always waits).',
    recipe: { requiredFields: ['customerId', 'invoiceId', 'amountMinor', 'date', 'mode'], preconditions: ['The invoice balance is at least the amount.'], reference: 'reference_number', readBackQuery: 'GET /customerpayments?reference_number=' } },
  { system: 'zoho-books', action: 'contact.create', title: 'Create a contact in Zoho Books', kind: 'inside-undoable', tier: 1, alwaysWaits: false, waitsBecause: waits.inside, plannedStatus: 'experimental',
    idempotency: 'Contact names are unique in an organisation: looks for the exact name first and creates only when absent.', businessReference: 'contact_name.',
    readBack: 'Lists contacts by exact name and compares type and email.', retryWindowHours: 24 * 30, approvalLifetimeHours: INSIDE_HOURS, ...reviewed, reversal: 'Mark the contact inactive.',
    recipe: { requiredFields: ['name', 'type'], preconditions: ['No contact has this name.'], reference: 'contact_name', readBackQuery: 'GET /contacts?contact_name=' } },
  { system: 'zoho-books', action: 'contact.update', title: 'Change a contact in Zoho Books', kind: 'inside-undoable', tier: 1, alwaysWaits: false, waitsBecause: waits.inside, plannedStatus: 'experimental',
    idempotency: 'Sets absolute field values, so a repeat changes nothing; refuses when the contact changed since the preview.', businessReference: 'contact_id.',
    readBack: 'Reads the contact and compares every changed field.', retryWindowHours: 24 * 30, approvalLifetimeHours: INSIDE_HOURS, ...reviewed, reversal: 'Set the fields back to their before values.',
    recipe: { requiredFields: ['contactId', 'changes'], preconditions: ['The contact still holds the before values.'], reference: 'contact_id', readBackQuery: 'GET /contacts/{id}' } },
  { system: 'zoho-books', action: 'bill.createFromPhoto', title: 'Book a purchase bill read from a photo', kind: 'inside-undoable', tier: 1, alwaysWaits: false, waitsBecause: waits.inside, plannedStatus: 'experimental',
    idempotency: 'Looks first for a bill with the same vendor and bill number; creates only when none exists.', businessReference: 'bill_number from the photo, plus reference_number set to the effect reference.',
    readBack: 'Lists bills by reference_number and compares vendor, date, lines and total.', retryWindowHours: 24 * 30, approvalLifetimeHours: INSIDE_HOURS, ...reviewed, reversal: 'Delete the bill (a new action that always waits).',
    recipe: { requiredFields: ['vendorId', 'billNumber', 'date', 'lines'], preconditions: ['The vendor exists.', 'No bill from this vendor has this number.'], reference: 'reference_number', readBackQuery: 'GET /bills?reference_number=' } },
  // Razorpay.
  { system: 'razorpay', action: 'paymentLink.create', title: 'Create a Razorpay payment link', kind: 'money', tier: 2, alwaysWaits: true, waitsBecause: waits.money, plannedStatus: 'experimental',
    idempotency: 'reference_id is unique per account: Razorpay refuses a second link with the same reference, and Chausar looks for it first.', businessReference: 'reference_id set to the effect reference.',
    readBack: 'Lists payment links by reference_id and compares amount, currency and description. The link is created with notifications off.', retryWindowHours: 24 * 30, approvalLifetimeHours: MONEY_HOURS, ...reviewed, reversal: 'Cancel the payment link.',
    recipe: { requiredFields: ['amountMinor', 'description', 'customer'], preconditions: ['Notifications are off: Chausar never lets Razorpay message the customer.'], reference: 'reference_id', readBackQuery: 'GET /v1/payment_links?reference_id=' } },
  { system: 'razorpay', action: 'refund.create', title: 'Refund a Razorpay payment', kind: 'money', tier: 2, alwaysWaits: true, waitsBecause: waits.money, plannedStatus: 'experimental',
    idempotency: 'Sends the effect key as the X-Refund-Idempotency header and the effect reference as the refund receipt; looks for a refund with that receipt first.', businessReference: 'receipt set to the effect reference.',
    readBack: 'Lists the payment\'s refunds and compares amount and receipt.', retryWindowHours: 24, approvalLifetimeHours: MONEY_HOURS, ...reviewed, reversal: null,
    recipe: { requiredFields: ['paymentId', 'amountMinor'], preconditions: ['The payment is captured.', 'The refund does not exceed what is left to refund.'], reference: 'receipt', readBackQuery: 'GET /v1/payments/{id}/refunds' } },
  // Shopify. Prices, stock and listings cannot be undone once customers see them.
  { system: 'shopify', action: 'variant.price', title: 'Change a product price in Shopify', kind: 'cannot-undo', tier: 2, alwaysWaits: true, waitsBecause: waits.irreversible, plannedStatus: 'experimental',
    idempotency: 'Sets an absolute price; refuses when the variant\'s price or updated_at changed since the preview.', businessReference: 'variant id.',
    readBack: 'Reads the variant and compares the price.', retryWindowHours: 24 * 7, approvalLifetimeHours: MONEY_HOURS, ...reviewed, reversal: 'Set the old price again (a new action that always waits).',
    recipe: { requiredFields: ['variantId', 'priceMinor'], preconditions: ['The variant still has the before price.'], reference: 'variant id', readBackQuery: 'GET /variants/{id}.json' } },
  { system: 'shopify', action: 'inventory.set', title: 'Set stock at a location in Shopify', kind: 'cannot-undo', tier: 2, alwaysWaits: true, waitsBecause: waits.irreversible, plannedStatus: 'experimental',
    idempotency: 'Sets an absolute quantity; refuses when the available quantity changed since the preview.', businessReference: 'inventory item id and location id.',
    readBack: 'Reads the inventory level and compares the available quantity.', retryWindowHours: 24, approvalLifetimeHours: MONEY_HOURS, ...reviewed, reversal: 'Set the old quantity again (a new action that always waits).',
    recipe: { requiredFields: ['inventoryItemId', 'locationId', 'available'], preconditions: ['The level still has the before quantity.'], reference: 'inventory item and location', readBackQuery: 'GET /inventory_levels.json' } },
  { system: 'shopify', action: 'product.status', title: 'List or unlist a product in Shopify', kind: 'cannot-undo', tier: 2, alwaysWaits: true, waitsBecause: waits.irreversible, plannedStatus: 'experimental',
    idempotency: 'Sets an absolute status; refuses when the product changed since the preview.', businessReference: 'product id.',
    readBack: 'Reads the product and compares its status.', retryWindowHours: 24 * 7, approvalLifetimeHours: MONEY_HOURS, ...reviewed, reversal: 'Set the old status again (a new action that always waits).',
    recipe: { requiredFields: ['productId', 'status'], preconditions: ['The product still has the before status.'], reference: 'product id', readBackQuery: 'GET /products/{id}.json' } },
  // Google Workspace (drive.file scope; nothing is shared).
  { system: 'google-workspace', action: 'sheets.append', title: 'Add a row to a Google Sheet', kind: 'inside-undoable', tier: 1, alwaysWaits: false, waitsBecause: waits.inside, plannedStatus: 'live',
    idempotency: 'The first column holds the effect reference; Chausar reads the key column first and appends only when the reference is absent.', businessReference: 'Effect reference in the first column.',
    readBack: 'Reads the sheet\'s key column and the row holding the reference, and compares every cell.', retryWindowHours: 24 * 30, approvalLifetimeHours: INSIDE_HOURS, ...reviewed, reversal: 'Clear the row.',
    recipe: { requiredFields: ['spreadsheetId', 'sheet', 'values'], preconditions: ['The sheet exists and its first column is the key column.'], reference: 'first column', readBackQuery: "GET /values/'{sheet}'!A:A then the row." } },
  { system: 'google-workspace', action: 'sheets.update', title: 'Change cells in a Google Sheet', kind: 'inside-undoable', tier: 1, alwaysWaits: false, waitsBecause: waits.inside, plannedStatus: 'experimental',
    idempotency: 'Writes absolute values to an exact range; refuses when the range changed since the preview.', businessReference: 'Spreadsheet id and A1 range.',
    readBack: 'Reads the range and compares every cell.', retryWindowHours: 24 * 30, approvalLifetimeHours: INSIDE_HOURS, ...reviewed, reversal: 'Write the before values back.',
    recipe: { requiredFields: ['spreadsheetId', 'range', 'values'], preconditions: ['The range still holds the before values.'], reference: 'range', readBackQuery: 'GET /values/{range}' } },
  { system: 'google-workspace', action: 'calendar.createEvent', title: 'Add an event to your Google Calendar', kind: 'inside-undoable', tier: 1, alwaysWaits: false, waitsBecause: waits.inside, plannedStatus: 'experimental',
    idempotency: 'The event id is derived from the effect key; Google refuses a second event with the same id.', businessReference: 'Event id derived from the effect key.',
    readBack: 'Gets the event by id and compares title, start and end.', retryWindowHours: 24 * 30, approvalLifetimeHours: INSIDE_HOURS, ...reviewed, reversal: 'Delete the event.',
    recipe: { requiredFields: ['calendarId', 'summary', 'start', 'end'], preconditions: ['No guests: an invitation would be a message to outsiders.'], reference: 'event id', readBackQuery: 'GET /calendars/{id}/events/{eventId}' } },
  { system: 'google-workspace', action: 'drive.createFile', title: 'Save a file to your Google Drive', kind: 'inside-undoable', tier: 1, alwaysWaits: false, waitsBecause: waits.inside, plannedStatus: 'experimental',
    idempotency: 'The file carries the effect reference as a private app property; Chausar searches for it first and creates only when absent.', businessReference: 'appProperties.chausarEffect.',
    readBack: 'Searches files by the app property and compares name, type and size.', retryWindowHours: 24 * 30, approvalLifetimeHours: INSIDE_HOURS, ...reviewed, reversal: 'Move the file to the bin.',
    recipe: { requiredFields: ['name', 'mimeType', 'contentBase64'], preconditions: ['The file is not shared.'], reference: 'appProperties.chausarEffect', readBackQuery: 'GET /files?q=appProperties has …' } },
  // WhatsApp Business Cloud API.
  { system: 'whatsapp', action: 'template.send', title: 'Send an approved WhatsApp template message', kind: 'seen-outside', tier: 2, alwaysWaits: true, waitsBecause: waits.message, plannedStatus: 'experimental',
    idempotency: 'Sent at most once per effect key; the send journal outside the vault blocks a second send even after a restore. WhatsApp itself offers no idempotency key.', businessReference: 'biz_opaque_callback_data set to the effect reference.',
    readBack: 'Reads the delivery statuses recorded from WhatsApp\'s status callbacks for the message id. Without a status the result stays not sure and a person settles it.', retryWindowHours: null, approvalLifetimeHours: MESSAGE_HOURS, ...reviewed, reversal: null,
    recipe: { requiredFields: ['to', 'template', 'language', 'parameters'], preconditions: ['The template is approved by Meta.', 'The customer agreed to messages on WhatsApp.'], reference: 'biz_opaque_callback_data', readBackQuery: 'Status callbacks for the message id.' } },
  // Mail over the user's own SMTP server.
  { system: 'mail', action: 'smtp.send', title: 'Send an email from your own mail server', kind: 'seen-outside', tier: 2, alwaysWaits: true, waitsBecause: waits.message, plannedStatus: 'live',
    idempotency: 'The Message-ID is derived from the effect key. Chausar searches the Sent folder for it before sending, and the send journal blocks a second send even after a restore.', businessReference: 'Message-ID header.',
    readBack: 'Searches the Sent folder over IMAP for the Message-ID. Without IMAP the result stays not sure and a person settles it.', retryWindowHours: 24 * 7, approvalLifetimeHours: MESSAGE_HOURS, ...reviewed, reversal: null,
    recipe: { requiredFields: ['to', 'subject', 'body'], preconditions: ['The recipient agreed to be contacted.'], reference: 'Message-ID', readBackQuery: 'IMAP UID SEARCH HEADER Message-ID in the Sent folder.' } },
  // Tax filings are prepared only, for good.
  { system: 'gst-portal', action: 'return.file', title: 'File a GST return', kind: 'cannot-undo', tier: 'prepare-only', alwaysWaits: true, waitsBecause: 'Tax filings are prepared only. You or your CA files them.', plannedStatus: 'prepare-only',
    idempotency: 'Never sent by Chausar.', businessReference: 'GSTIN and return period.', readBack: 'None: Chausar never files.', retryWindowHours: null, approvalLifetimeHours: INSIDE_HOURS, ...reviewed, reversal: null,
    recipe: { requiredFields: ['gstin', 'period', 'form'], preconditions: ['Prepared only.'], reference: 'GSTIN and period', readBackQuery: 'None.' } },
];

export const CATALOGUE: readonly CatalogueEntry[] = Object.freeze(rows.map(row => Object.freeze(row)));
for (const row of CATALOGUE) {
  check(!row.alwaysWaits || row.tier !== 1, 'INVALID_CATALOGUE', 'An always-waits row can never be grouped as tier 1.');
  check(row.kind === 'inside-undoable' || row.alwaysWaits, 'INVALID_CATALOGUE', 'Messages, money and irreversible changes are on the always-waits list.');
}

export function entry(system: string, action: string): CatalogueEntry | undefined {
  return CATALOGUE.find(row => row.system === system && row.action === action);
}
export function catalogueDigest(row: CatalogueEntry): string { return digest(row); }
/** Unverified rows show as experimental: a planned status is earned by sandbox or live evidence. */
export function effectiveStatus(row: CatalogueEntry, qualified: 'synthetic-tested' | 'sandbox-verified' | 'live-verified' | 'unqualified'): Status {
  if (row.plannedStatus === 'prepare-only' || row.plannedStatus === 'not-yet') return row.plannedStatus;
  if (row.plannedStatus === 'live') return qualified === 'live-verified' || qualified === 'sandbox-verified' ? 'live' : 'experimental';
  return 'experimental';
}
