/**
 * The fake engine's answers for Ink v2 wave 4 package 4J3: the previews on Today's cards, an order's stage steps on
 * Work, and venture.files.poster. They follow the engine's rules (platform/runtime/venture/views/previews.ts,
 * money/order-steps.ts, delivery/poster.ts): previews only on the rows that have something real to show, added after
 * the row's digest; amounts with their receipts, each naming the method that opens it (the fake serves R-0419 through
 * venture.receipt.get and its CA receipt w-gst-sep through venture.ca.receipt); words a model wrote with their
 * estimate flag; no tax lines for a business not registered; never an image the engine did not take. The fake has no
 * ffmpeg, so it takes no still: the poster method answers as the engine does on a computer without ffmpeg.
 */

import {
  EngineError, type InvoiceLite, type OrderLite, type OrderStageReason, type OrderStageView, type OrderWaitsOnYou, type QueuePreview, type QueueRow, type UploadLite,
} from './types';

/** The methods this part of the fake answers (fake-w4.ts routes them here). */
export const FAKE_4J3_METHODS: readonly string[] = ['venture.files.poster'];

const X_TEXT = 'We tested five budget mics in one room. The ₹2,000 one surprised us. Full episode on the channel, link in the comments.';
const price = { receiptId: 'R-0419', receiptKind: 'price' as const };
const gst = { receiptId: 'w-gst-sep', receiptKind: 'ca' as const };

/** The previews of the fake's own Today rows (fixtures.ts QUEUE), by row id, as the engine builds them (D-Today). */
export const FAKE_PREVIEWS: Readonly<Record<string, QueuePreview>> = {
  'run:d-ep14:review-1': {
    kind: 'video', title: { text: 'The budget mic that beat the room' }, format: 'long',
    duration: { seconds: 702, display: '11 min 42 s', clock: '11:42', from: 'edit-list' }, chapters: 5, checks: { passed: 3, run: 3, notRun: 0 },
  },
  'q-invoice-mehta': {
    kind: 'paper', paper: 'invoice', title: 'TAX INVOICE (draft)', from: 'Ledgerline', to: 'Mehta Traders',
    lines: [{ label: 'Monthly books, September', quantity: '1', unit: '₹16,000.00', value: '₹16,000.00', ...price }],
    subtotal: { label: 'Subtotal', value: '₹16,000.00', ...price },
    taxLines: [{ label: 'CGST at 9%', value: '₹1,440.00', ...price }, { label: 'SGST at 9%', value: '₹1,440.00', ...price }],
    total: { label: 'Total', value: '₹18,880.00', ...price },
    due: { days: 15, date: '2026-11-05', display: 'Due in 15 days' },
  },
  // The working's figures are the CA receipt's own (fixtures-extras.ts CA_RECEIPTS w-gst-sep).
  'q-signoff-gst': {
    kind: 'paper', paper: 'working', title: 'GST working for September', client: 'Mehta Traders',
    working: [{ label: 'Output IGST', value: 'INR 900.00', ...gst }, { label: 'Net payable', value: 'INR 2,825.00', ...gst }],
    more: 0, signer: { name: 'Meera Joshi', state: 'to-send' },
  },
  'q-question-title': {
    kind: 'choice', question: { text: 'Which title for episode 15?', estimate: true },
    options: [
      { label: 'A', text: { text: 'I tried every budget mic' } },
      { label: 'B', text: { text: 'The ₹2,000 mic that beat my ₹20,000 one', estimate: true }, estimate: { label: 'Views in 30 days', value: '12,000 to 18,000' } },
    ],
  },
  'post:linkedin-ep13:v1': {
    kind: 'post', connectorId: 'x', platform: 'X', account: 'Lumen Studio', mode: 'owner-browser-session', text: X_TEXT, textEstimate: true,
    counts: [{ label: 'characters', count: [...X_TEXT].length, limit: 280 }],
    short: { title: { text: 'The ₹2,000 one surprised us', estimate: true }, length: { seconds: 48, display: '48 s', clock: '0:48', from: 'edit-list' } },
  },
};

/** Today's rows with the previews the fake has for them. The digest stays as it was: the engine adds previews after it. */
export function withFakePreviews(rows: QueueRow[]): QueueRow[] {
  return rows.map((row) => (row.preview || !Object.hasOwn(FAKE_PREVIEWS, row.id) ? row : { ...row, preview: structuredClone(FAKE_PREVIEWS[row.id]) }));
}

const stage = (
  id: OrderStageView['id'], label: string, state: OrderStageView['state'], detail: string, reason?: OrderStageReason, extra: Pick<OrderStageView, 'waitsOn' | 'due'> = {},
): OrderStageView => ({
  id, label, state, detail, line: `${label}, ${detail}`, ...(state === 'waits' ? { waitsOn: 'you' as const } : {}), ...extra, ...(reason ? { reason } : {}),
});

/** The stage steps of the fake's own orders (fixtures.ts ORDERS), as the engine reads them from records (D-Work). */
export const FAKE_ORDER_STEPS: Readonly<Record<string, { stages: OrderStageView[]; waitsOnYou: OrderWaitsOnYou | null }>> = {
  'o-boat-14': {
    stages: [
      stage('agreed', 'Agreed', 'done', 'done'), stage('price', 'Price', 'waits', 'a new price waits on you', 'new-price'), stage('episode', 'Episode', 'waits', 'ready, waits for you to read it', 'ready'),
      stage('publish', 'Publish', 'always-asks', 'always asks you'), stage('invoice', 'Invoice', 'not-yet', 'not yet'), stage('paid', 'Paid', 'not-yet', 'not yet'),
    ],
    waitsOnYou: { count: 2, items: [{ stage: 'price', what: 'the new price' }, { stage: 'episode', what: 'the episode draft' }], line: '2 wait on you: the new price and the episode draft.' },
  },
  'o-boat-12': {
    stages: [
      stage('agreed', 'Agreed', 'done', 'done'), stage('price', 'Price', 'done', 'done'), stage('episode', 'Episode', 'done', 'done'), stage('publish', 'Publish', 'done', 'done'),
      stage('invoice', 'Invoice', 'done', 'INV-0039', 'issued'), stage('paid', 'Paid', 'not-yet', 'due 28 Oct 2026', 'due', { due: '2026-10-28' }),
    ],
    waitsOnYou: null,
  },
  'o-mehta-sep': {
    stages: [
      stage('files-in', 'Files in', 'done', 'done'), stage('books', 'Books', 'done', 'done'), stage('gst', 'GST', 'not-yet', "waits for your CA's sign-off", 'with-ca', { waitsOn: 'ca' }),
      stage('invoice', 'Invoice', 'waits', 'ready to issue, waits on you', 'to-issue'), stage('paid', 'Paid', 'not-yet', 'not yet'),
    ],
    waitsOnYou: { count: 1, items: [{ stage: 'invoice', what: 'the invoice' }], line: '1 waits on you: the invoice.' },
  },
  'o-iyer-oct': {
    stages: [
      stage('files-in', 'Files in', 'not-yet', 'not yet'), stage('books', 'Books', 'not-yet', 'not yet'), stage('gst', 'GST', 'not-yet', 'not yet'),
      stage('invoice', 'Invoice', 'not-yet', 'not yet'), stage('paid', 'Paid', 'not-yet', 'not yet'),
    ],
    waitsOnYou: null,
  },
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** A day as the engine writes it for an Indian business (records.ts formatVentureDate, day month year): "05 Nov 2026". */
const dayWords = (iso: string) => { const [y, m, d] = iso.split('-'); return `${d} ${MONTHS[Number(m) - 1] ?? m} ${y}`; };

/** The fixed steps for an order the fake made itself: the Invoice and Paid steps from the order's own invoice. */
function fixedSteps(order: OrderLite, invoices: readonly InvoiceLite[]): { stages: OrderStageView[]; waitsOnYou: OrderWaitsOnYou | null } {
  const mine = invoices.filter((item) => item.orderId === order.id && item.status !== 'void').sort((a, b) => a.at.localeCompare(b.at));
  const invoice = mine.at(-1);
  const issued = mine.filter((item) => item.status !== 'draft').at(-1);
  const invoiceStage = !invoice ? stage('invoice', 'Invoice', 'not-yet', 'not yet')
    : invoice.status === 'draft' ? stage('invoice', 'Invoice', 'waits', 'ready to issue, waits on you', 'to-issue')
      : stage('invoice', 'Invoice', 'done', invoice.number ?? 'done', 'issued');
  const paidStage = !issued ? stage('paid', 'Paid', 'not-yet', 'not yet')
    : issued.status === 'paid' ? stage('paid', 'Paid', 'done', 'done')
      : issued.status === 'part-paid' ? stage('paid', 'Paid', 'not-yet', 'part paid', 'part-paid')
        : issued.dueDate ? stage('paid', 'Paid', 'not-yet', `due ${dayWords(issued.dueDate)}`, 'due', { due: issued.dueDate }) : stage('paid', 'Paid', 'not-yet', 'not yet');
  const stages = [
    stage('agreed', 'Agreed', 'done', 'done'), stage('price', 'Price', 'done', 'done'), stage('draft', 'Draft', 'not-yet', 'not yet'),
    order.deliveredOn ? stage('sent', 'Sent', 'done', 'done') : stage('sent', 'Sent', 'always-asks', 'always asks you'),
    invoiceStage, paidStage,
  ];
  const waiting = invoiceStage.state === 'waits';
  return { stages, waitsOnYou: waiting ? { count: 1, items: [{ stage: 'invoice', what: 'the invoice' }], line: '1 waits on you: the invoice.' } : null };
}

/** An order as venture.order.list answers it: with its stage steps and what waits on the owner. */
export function withFakeOrderSteps(order: OrderLite, invoices: readonly InvoiceLite[] = []): OrderLite {
  const steps = Object.hasOwn(FAKE_ORDER_STEPS, order.id) ? structuredClone(FAKE_ORDER_STEPS[order.id]) : fixedSteps(order, invoices);
  return { ...order, ...steps };
}

/** What the fake's poster method reads from the other desks. */
export interface PosterHost {
  hosted(): boolean;
  ask(method: string, params: Record<string, unknown>): unknown;
}

/**
 * venture.files.poster { orderId }: the engine's refusals in its words. The fake has no ffmpeg, so a known order with a
 * cut gets the engine's answer for a computer without it; nothing is made up.
 */
export function fakePoster(host: PosterHost, p: Record<string, unknown>): UploadLite {
  if (typeof p.orderId !== 'string' || !p.orderId || Object.keys(p).some((key) => key !== 'orderId')) throw new EngineError('INVALID_VENTURE_REQUEST', 'Send the order id.');
  if (host.hosted()) throw new EngineError('TIER_UNAVAILABLE', "The shared hosted server can't take a still: it never reads a file on your computer. Use the desktop app.");
  const order = (host.ask('venture.order.list', {}) as OrderLite[]).find((item) => item.id === p.orderId);
  if (!order) throw new EngineError('ORDER_NOT_FOUND', 'That order was not found.');
  if (!order.intake?.cutFile) throw new EngineError('INVALID_VENTURE_REQUEST', 'This order names no finished cut on this computer, so there is no still to take.');
  throw new EngineError('POSTER_NOT_AVAILABLE', "ffmpeg isn't on this computer, so there is no still. Chausar never installs it.");
}
