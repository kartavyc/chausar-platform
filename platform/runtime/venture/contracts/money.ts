// Venture money contract. Types only; public imports use ../contracts.ts.
import type { FootageRights } from '../delivery/rights.ts';
import type { SocialChannel } from '../playbooks/social/channels.ts';
import type { IntakeValue } from '../playbooks/kit/define.ts';
import type { CountryCode, TaxMode, CountryProfile } from '../core/country-types.ts';
import type { TaxTreatment, PriceStep } from '../money/price-types.ts';
import type { BpsString, IsoDate, IsoTime, MinorString, RecordBase } from './business.ts';
import type { Display } from './spend.ts';
import type { InvoiceShareHow } from './records.ts';
import type { CreditNoteView } from './views.ts';

// ---------------------------------------------------------------------------
// 6. Money (P3): price receipts, clients, orders, invoices, payments, books
// ---------------------------------------------------------------------------

/** How tax is worked out on one receipt. 'cgst-sgst', 'igst' and 'zero-rated-lut' are India only. */
export type {TaxTreatment,PriceStep} from '../money/price-types.ts';

export type PriceFigure = {
  key: 'unit' | 'subtotal' | 'discount' | 'taxable' | 'tax' | 'cgst' | 'sgst' | 'igst' | 'total' | 'paid' | 'balance' | 'credited';
  label: string; // 'Total', 'CGST at 9%' ...
  minor: MinorString;
  display: string; // the owner form (owner-format.ts formatMoney) or, where it leaves the app, the exact form
  currency: string;
};

export type PriceReceiptRecord = RecordBase<'venture-price-receipt'> & {
  subject: { type: 'offer'; offerId: string } | { type: 'order'; orderId: string } | { type: 'invoice'; invoiceId: string };
  operation: 'venture.price';
  currency: string;
  minorDigits: number;
  inputs: {
    unitPriceMinor: MinorString;
    quantity: string;
    discountBps: BpsString;
    taxMode: TaxMode;
    taxRateBps: BpsString;
    taxTreatment: TaxTreatment;
    unitPriceBy: 'told-by-you';
    taxRateBy: 'country-table' | 'told-by-you' | 'not-registered';
    blueprintDigest: string; // digest of the blueprint version priced, draft or accepted
    /** 4J5 (M15): the unit price already includes the tax, so code splits it; absent on every other receipt. */
    taxInclusive?: true;
    /** Wave 6 (6D1): this receipt prices one part of an order, cut from the whole order's receipt (money/invoice-parts.ts). */
    part?: { kind: 'advance' | 'milestone' | 'partial' | 'final'; shareBps: BpsString | null; basisReceiptId: string; earlierMinor: MinorString };
    /** Wave 6 (6D4): priced in the order's own currency at the owner's own price for a client abroad. */
    currencyBy?: 'order';
  };
  steps: PriceStep[];
  figures: PriceFigure[];
  totalMinor: MinorString;
  allowedNumbers: string[]; // every number a later sentence may cite
  explanation: string; // template sentence built from figures, never model text
  digest: string;
  stale: boolean; // true when the offer price or tax setting changed later
};

export type ClientAiConsent = {
  id: string;
  revision: number;
  disclosureDigest: string;
  grantedAt: IsoTime;
  grantedBy: string;
  withdrawnAt: IsoTime | null;
};

export type ClientAiConsentView = {
  clientId: string;
  clientName: string;
  status: 'required' | 'agreed' | 'withdrawn';
  disclosure: string;
  disclosureDigest: string;
  consent: ClientAiConsent | null;
};

export type ClientRecord = RecordBase<'venture-client'> & {
  aiConsent?: ClientAiConsent;
  /** The one owner shop identity; never a paying customer. */
  self?: true;
  name: string; // one line
  email: string | null;
  countryCode: CountryCode | null;
  taxId: string | null; // the client's GSTIN or VAT number, when they gave one
  stateCode: string | null; // India only: the client's GST state code, for place of supply
  note: string | null;
  /** C4 task 18: Forget of the person behind this client: the timeline holds nothing from before this time. */
  timelineClearedAt?: IsoTime;
  /**
   * One-shot C6: the phone or WhatsApp number as the owner typed it, and its WhatsApp digits (country code first, no
   * plus) worked out by code (clients/phone.ts). Absent means none. Used only to open WhatsApp; never read by a model
   * (clients/phone.ts CLIENT_AI_FIELDS); erased by Forget.
   */
  phone?: string | null;
  whatsapp?: string | null;
};

export type OrderRecord = RecordBase<'venture-order'> & {
  sellerShopify?: import('../playbooks/online-seller/shopify-records.ts').SellerShopifyBody;
  sellerStorefront?: import('../playbooks/online-seller/storefront-records.ts').SellerStorefrontBody;
  youtubePublic?: import('../playbooks/youtube/public-state.ts').YoutubePublicRead;
  youtubeResearch?: import('../playbooks/youtube/research-state.ts').YoutubeResearchBody;
  /** The exact page fetched with owner approval for a narration explainer. */
  narrationFetched?: {fileId:string;url:string;finalUrl:string;digest:string};
  socialPostHistory?: import('../playbooks/social/slots-live.ts').SocialHookHistory[];
  socialGhostwriting?: import('../playbooks/social/approvals.ts').GhostwritingState;
  socialProduction?: import('../playbooks/social/production-types.ts').SocialProduction;
  /** Owner shop work creates no customer sale, invoice or client share. */
  internal?: true;
  clientId: string;
  offerId: string;
  quantity: string;
  request: string; // what the client asked for, owner-typed; client data
  status: 'open' | 'invoiced' | 'delivered' | 'cancelled';
  priceReceiptId: string;
  deliveredOn: IsoDate | null;
  saleFactId: string | null;
  /** What a flagship playbook's offer asks at intake (venture/playbooks/intake.ts). Absent for every other offer. */
  intake?: OrderIntake;
  /** 4J5 (M15): the owner's price for this order includes the tax; its receipts split it. Absent: tax is added. */
  taxInclusive?: boolean;
  /**
   * Ink v2 wave 5 (named by 5-0, kept by 5A1's chain, playbooks/kit/chain.ts): the stage of a kit offer's stages this
   * order is at, counted from 1, and where the chain stands. Absent on an order that is not a chain.
   */
  socialChain?: import('../playbooks/social/chain.ts').SocialChainPin;
  chainStage?: number;
  chainState?: 'running' | 'waiting' | 'stopped' | 'done';
  /** 5A1: when the chain last moved (a stage, a wait on the client, a stop), for the waiting rows on Today. */
  chainSince?: IsoTime;
  /**
   * Ink v2 wave 5 (5A2, the honest exit, playbooks/kit/exit.ts): the order is for the in-scope part of the ask only;
   * rest lists what the playbook does not do, and reply the fixed words for the client. Absent when all of it is in scope.
   */
  outOfScope?: { rest: string[]; reply: string };
  /** Wave 6 (6D1): when the whole order is due to be paid, owner-set; the final invoice is due then unless told otherwise. */
  dueDate?: IsoDate;
  /** Wave 6 (6D4): the owner's own price in the client's currency, for a client abroad. Never converted. */
  foreignPrice?: import('../money/billing-types.ts').ForeignPrice;
};

/**
 * A flagship offer's intake, checked by code when the order is made. rights: the rights to the footage, required for
 * an offer that cuts footage (delivery/rights.ts). cutFile: the finished cut on this computer, for the finishing check.
 */
export type OrderIntake = {
  rights: FootageRights | null;
  format: 'long' | 'short';
  aiVoice: boolean;
  aiPresenter: boolean;
  paidPromotion: boolean;
  cutFile: string | null;
  /**
   * A social content calendar order (Ink v2 wave 2): the month, the channels, posts per channel and the weekdays it
   * posts on (ISO numbers: 1 is Monday, 7 is Sunday). Code plans the slots and their dates (social/calendar.ts); a
   * model never picks a date.
   */
  calendar?: { month: string; channels: SocialChannel[]; postsPerChannel: number; weekdays: number[] };
  /** The client's own word lists the social checks read: banned words and topics, competitors, phrases never flagged. */
  clientRules?: { bannedWords: string[]; bannedTopics: string[]; competitors: string[]; protectedPhrases: string[] };
  /**
   * Ink v2 wave 5 (named by 5-0, checked by 5A1's playbooks/kit/intake.ts): a kit playbook's own intake fields, by field
   * id, as the definition's intakeFields name them.
   */
  fields?: Record<string, IntakeValue>;
};

/**
 * Ink v2 wave 4 (4J3): an order's stage steps on Work, from the playbook's stage list (playbooks/order-stages.ts) and
 * the records only (money/order-steps.ts). state: done; waits (on the owner: something waits for them on Today);
 * not-yet; always-asks (an outside step that never runs without the owner); unknown (an outside step whose last try
 * ended with its outcome unknown). waitsOn says who it waits on when that is not the owner (the CA, the client); due,
 * the day a payment is due. detail is the state in the engine's words; line is "<label>, <detail>". reason is a code
 * for the detail, so the screen can say it in its own words (English and Hindi); absent on a plain done, not yet or
 * always asks. An engine-failed draft is 'failed', never 'stopped' (stopping is the owner's or a breaker's).
 */
export type OrderStageId = 'agreed' | 'price' | 'episode' | 'publish' | 'files-in' | 'books' | 'gst' | 'calendar' | 'drafts' | 'client-ok' | 'posts' | 'report' | 'draft' | 'sent' | 'invoice' | 'paid';

export type OrderStageState = 'done' | 'waits' | 'not-yet' | 'always-asks' | 'unknown';

export type OrderStageReason =
  | 'new-price' | 'ready' | 'question' | 'approval' | 'brief' | 'failed' | 'stopped' | 'rejected' | 'working' | 'practice'
  | 'send-unknown' | 'post-unknown' | 'issue-unknown' | 'ca-signed' | 'ca-returned' | 'with-ca' | 'send-to-ca' | 'no-ca'
  | 'client-approved' | 'client-changes' | 'with-client' | 'link-ended' | 'posts-waiting' | 'posting' | 'planned' | 'to-issue' | 'issued' | 'due' | 'part-paid';

export interface OrderStageView { id: OrderStageId; label: Display; state: OrderStageState; detail: Display; line: Display; waitsOn?: 'you' | 'ca' | 'client'; due?: IsoDate; reason?: OrderStageReason }

/** What waits on the owner in one order (4J3): "2 wait on you: the new price and the episode draft." */
export interface OrderWaitsOnYou { count: number; items: { stage: OrderStageId; what: Display }[]; line: Display }

/** venture.order.list's row (4J3): the order as stored, with its stage steps and what waits on the owner, or null. */
export type OrderListRow = OrderRecord & { stages: OrderStageView[]; waitsOnYou: OrderWaitsOnYou | null; price: OrderPrice | null };

/** One-shot C4 task 11: an order's price as its receipt's Total figure says it, with that receipt's id. */
export interface OrderPrice { display: Display; receiptId: string }

/** taxRateBps (4J5, M15): the rate charged on this line when it was drafted; absent on invoices drafted before. */
export type InvoiceLine = { description: string; quantity: string; unitMinor: MinorString; amountMinor: MinorString; taxRateBps?: BpsString };

export type InvoiceRecord = RecordBase<'venture-invoice'> & {
  number: string | null; // 'INV-0001' when issued; null for drafts
  documentTitle: 'TAX INVOICE' | 'INVOICE' | 'INVOICE (not a tax invoice)';
  orderId: string;
  clientId: string;
  currency: string;
  issueDate: IsoDate | null;
  dueDate: IsoDate | null;
  dueInDays: number; // 0 to 90
  lines: InvoiceLine[];
  subtotalMinor: MinorString;
  discountMinor: MinorString;
  taxMinor: MinorString;
  totalMinor: MinorString;
  taxLabel: string;
  taxRateBps: BpsString;
  taxTreatment: TaxTreatment;
  taxLines: { label: string; rateBps: BpsString; minor: MinorString }[]; // one line, two for CGST and SGST, none when no tax
  supplierTaxId: string | null;
  clientTaxId: string | null;
  placeOfSupply: string | null; // India only, e.g. 'Maharashtra (27)' or 'Outside India (export of services)'
  sacCode: string | null;
  priceReceiptId: string;
  status: 'draft' | 'issued' | 'part-paid' | 'paid' | 'void';
  digest: string; // what the owner approves on issue
  issuedAt: IsoTime | null;
  factIds: string[];
  booksReceiptId: string | null; // calculator receipt for 'billed', kept only when its total equals the taxable amount
  booksNote: string | null; // why booksReceiptId is null, in words
  paidMinor: MinorString;
  balanceMinor: MinorString;
  /** Wave 6 (6D1): the part of its order this invoice bills; absent on a whole-order invoice. */
  part?: import('../money/billing-types.ts').InvoicePart;
  /** Wave 6 (6D1): the owner's payment terms line, as saved when drafted; absent when they set none. */
  terms?: string;
  /** Wave 6 (6D1): this invoice's own reminder days late; absent: its schedule's, else the business default. */
  reminderDays?: number[];
  /** Wave 6 (6D3): the Razorpay Payment Link made for it, on the owner's approval. */
  payLink?: import('../money/billing-types.ts').PayLinkState;
};

/** 'cheque' (4J5, M11): pending until the owner clears it or a bank row pays it. */
export type PaymentMethod = 'bank-transfer' | 'upi' | 'card' | 'cash' | 'payment-link' | 'other' | 'cheque';

export type PaymentRecord = RecordBase<'venture-payment'> & {
  invoiceId: string;
  amountMinor: MinorString; // the money that came in; TDS the client deducted is apart, in tds
  currency: string;
  receivedOn: IsoDate; // a cleared cheque: the day it cleared (the day it came is chequeOn)
  method: PaymentMethod;
  factId: string | null; // null only while a cheque is pending: the books count it once it clears
  booksReceiptId: string | null; // calculator receipt for 'received', kept only when its total equals this payment
  booksNote: string | null; // e.g. 'The books receipt covers more than this payment.'
  /** The bank statement row this payment was recorded from (venture.bank.apply); absent when the owner typed it. */
  bankTransactionId?: string;
  // Ink v2 wave 4 (4J5, M11, M15). state: absent on payments recorded before, which read as cleared.
  state?: 'pending' | 'cleared';
  chequeOn?: IsoDate;
  clearedBy?: string;
  clearedAt?: IsoTime;
  /** One payment split across invoices: each part is its own record; groupId and the whole amount are shared. */
  split?: { groupId: string; totalMinor: MinorString };
  /** TDS the client deducted (India): settles the invoice with the cash, pending the client's certificate. */
  tds?: { section: string; amountMinor: MinorString };
};

/** One next step for an invoice by its state, in the engine's words (4J5, M12). draftId: a reminder drafted, not sent yet. */
export type InvoiceNext = { action: 'issue' | 'wait' | 'remind' | 'clear' | 'none'; line: Display; draftId?: string };

/** One line of an invoice's short timeline (4J5, M12): events by date, then where it stands now. */
export type InvoiceTimelineEntry = {
  what: 'issued' | 'viewed' | 'paid' | 'cheque' | 'credited' | 'reminder' | 'reminded' | 'awaiting' | 'settled' | 'shared' | 'marked';
  on: IsoDate;
  line: Display;
  /** One-shot C4 (T20): on a 'shared' line, how the owner shared it. */
  how?: Exclude<InvoiceShareHow, 'marked'>;
};

export type InvoiceView = {
  /** Profile saved with this invoice's price, even if the owner later moves. */
  country?: CountryProfile;
  invoice: InvoiceRecord;
  client: ClientRecord;
  receipt: PriceReceiptRecord;
  payments: PaymentRecord[];
  documentText: string; // plain-text invoice built by deterministic code
  figures: PriceFigure[]; // subtotal, tax lines, total, paid, balance
  notes: string[]; // e.g. what is missing for a tax invoice, why a books receipt is absent
  // Ink v2 wave 4 (4J5). rateChange: a draft whose rate is no longer the plan's; recalculating is the owner's choice.
  next?: InvoiceNext;
  timeline?: InvoiceTimelineEntry[];
  rateChange?: { charged: BpsString; now: BpsString; line: Display };
  credits?: CreditNoteView[];
  /** 4J20: an open invoice past its due day, as invoice.list rows say it; absent otherwise. */
  late?: { days: number; line: Display };
  /** Wave 6 (6D1): how much of the order is billed, when the order is billed in parts. */
  billed?: import('../money/billing-types.ts').OrderBilledView;
  /** Wave 6 (6D2, 6D3): how the client pays this invoice, built by code from its balance. */
  howToPay?: import('../money/billing-types.ts').HowToPayView;
  /** One-shot C4 (T20): true only once the owner marked it sent; a share that opened their own app is not sending. */
  sent: boolean;
  /** C5 task 12: the method a new payment starts from (the newest payment's, else UPI in rupees, else bank transfer). */
  paymentDefaults?: { method: PaymentMethod };
  /** One-shot C6: an issued invoice with nothing left to pay. */
  paidInFull?: boolean;
};

export type BooksFigure = { operation: 'billed' | 'received' | 'earned'; label: string; receiptId: string; minor: MinorString; display: string; stale: boolean; zero?: true };

/** A books period the Money place can choose; the engine works out its dates on the owner's local calendar. */
export type BooksPeriodKey = 'all' | 'this-month' | 'last-month' | 'this-year';

export type BooksPeriodChoice = { key: BooksPeriodKey; label: string; from: IsoDate; to: IsoDate };

export type BooksSummary = {
  period: { from: IsoDate; to: IsoDate };
  // The next four are always set by the engine; optional only so older fixtures still type.
  periodKey?: BooksPeriodKey | 'custom'; // 'custom' when the request gave from or to
  periods?: BooksPeriodChoice[]; // every choice with its dates, in the order to show them
  today?: IsoDate; // the owner's local day, in timeZone
  timeZone?: string; // IANA zone for the venture's country; 'UTC' for another country
  currency: string;
  figures: BooksFigure[];
  openInvoices: { invoiceId: string; number: string; clientName: string; balanceMinor: MinorString; balanceDisplay: string; dueDate: IsoDate }[];
  notes: string[]; // honest limits, e.g. about tax and aging; the first one is shown under the Money place
  /** 4J4: the month asked for as the period ('2026-09'), when one was. */
  month?: string;
  /** 4J4: the month before, each figure with its receipt, when the period is one whole calendar month; else null. */
  previous?: { month: string; label: Display; period: { from: IsoDate; to: IsoDate }; figures: BooksFigure[] } | null;
};
