// Orders (Ink v2 wave 4, package 4J3): an order's stage steps on Work, read from the records only. The stage list is
// the playbook's (playbooks/order-stages.ts); each stage's rule reads its state here: done, waits on the owner, not
// yet, always asks, or unknown when the last try of an outside step ended with its outcome unknown. Nothing is guessed:
// a stage with no record that settles it is "not yet", and an outside step that never runs without the owner says it
// always asks. The words are the engine's; each reading also carries a reason code, and the screen keys its own words
// (English and Hindi) on the stage id, the state and that code. The records are indexed once per order list.
import type { State } from '../../contracts.ts';
import { formatVentureDate, listRecords } from '../records.ts';
import type {
  BlueprintRecord, CaFirmRecord, ConnectorPostRecord, DeliveryRunRecord, InvoiceRecord, IsoDate, JournalRecord, OrderRecord, OrderStageReason,
  OrderStageState, OrderStageView, OrderWaitsOnYou, PlaybookRecord, ShareLinkStoredRecord, VentureRecord,
} from '../contracts.ts';
import { countedAnswer } from '../build/share-links.ts';
import { runView } from '../delivery/runs.ts';
import { acceptedBlueprintOrNull } from '../delivery/shared.ts';
import { stageListFor, type StageRule } from '../playbooks/order-stages.ts';
import { pickPlaybook } from '../playbooks/registry.ts';
import { latestBlueprint } from './shared.ts';

type SignoffRequest = Extract<CaFirmRecord, { entry: 'signoff-request' }>;
type Signoff = Extract<CaFirmRecord, { entry: 'signoff' }>;
type SentToCa = Extract<CaFirmRecord, { entry: 'sent-to-ca' }>;

/** The records an order list reads, each list read once and indexed by what the rules look up. */
export type OrderIndex = {
  state: State;
  venture: VentureRecord;
  nowMs: number;
  runsByOrder: Map<string, DeliveryRunRecord[]>;
  /** The sends of each run to the owner's AI, the judge's own sends left out. */
  sendsByRun: Map<string, JournalRecord[]>;
  issuesByInvoice: Map<string, JournalRecord[]>;
  invoicesByOrder: Map<string, InvoiceRecord[]>;
  linksByRun: Map<string, ShareLinkStoredRecord[]>;
  postsByRun: Map<string, ConnectorPostRecord[]>;
  /** The orders that hold at least one file the client sent. */
  ordersWithFiles: Set<string>;
  /** The runs a monthly report receipt names. */
  reportRuns: Set<string>;
  gstRequestsByRun: Map<string, SignoffRequest[]>;
  signoffByRequest: Map<string, Signoff>;
  sentByKey: Map<string, SentToCa>;
  caNamed: boolean;
  priceReceipts: Set<string>;
  playbooks: Map<string, PlaybookRecord>;
  accepted: BlueprintRecord | null;
  latest: BlueprintRecord | null;
};

/** What one stage's rule reads for one order. */
export type StageContext = {
  index: OrderIndex;
  order: OrderRecord;
  /** The order's delivery runs, oldest first, and the newest of them. */
  runs: DeliveryRunRecord[];
  newest: DeliveryRunRecord | null;
  /** The stage's English label, for the words that name it. */
  label: string;
};
/** A rule's reading: the state, its words and reason code, who it waits on when not the owner, a due day, what waits. */
export type StageReading = { state: OrderStageState; detail: string; reason?: OrderStageReason; waitsOn?: 'ca' | 'client'; due?: IsoDate; what?: string };

const NOT_YET: StageReading = { state: 'not-yet', detail: 'not yet' };
const DONE: StageReading = { state: 'done', detail: 'done' };
const ALWAYS_ASKS: StageReading = { state: 'always-asks', detail: 'always asks you' };
const waits = (detail: string, reason: OrderStageReason, what: string): StageReading => ({ state: 'waits', detail, reason, what });
const notYet = (detail: string, reason: OrderStageReason, extra: Pick<StageReading, 'waitsOn' | 'due'> = {}): StageReading => ({ state: 'not-yet', detail, reason, ...extra });
/** The verdicts after which nothing more of a run goes to the owner's AI. */
const FINISHED: readonly DeliveryRunRecord['status'][] = ['accepted', 'edited', 'rejected'];

/** The newest of records in stored order, by time, a later record winning a tie. */
function newest<T extends { at: string }>(records: readonly T[] | undefined): T | null {
  let found: T | null = null;
  for (const record of records ?? []) if (!found || record.at >= found.at) found = record;
  return found;
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value); else map.set(key, [value]);
}

/** Every record the stage rules read, indexed once for all of the business's orders. */
export function orderIndex(state: State, venture: VentureRecord, nowMs: number): OrderIndex {
  const id = venture.id;
  const index: OrderIndex = {
    state, venture, nowMs, runsByOrder: new Map(), sendsByRun: new Map(), issuesByInvoice: new Map(), invoicesByOrder: new Map(), linksByRun: new Map(),
    postsByRun: new Map(), ordersWithFiles: new Set(), reportRuns: new Set(), gstRequestsByRun: new Map(), signoffByRequest: new Map(), sentByKey: new Map(),
    caNamed: false, priceReceipts: new Set(listRecords(state, 'venture-price-receipt', id).map(receipt => receipt.id)),
    playbooks: new Map(listRecords(state, 'venture-playbook', id).map(playbook => [playbook.id, playbook])),
    accepted: acceptedBlueprintOrNull(state, venture), latest: latestBlueprint(listRecords(state, 'venture-blueprint', id)),
  };
  for (const run of listRecords(state, 'venture-delivery-run', id)) push(index.runsByOrder, run.orderId, run);
  for (const entry of listRecords(state, 'venture-journal-entry', id)) {
    if (entry.action === 'invoice.issue') push(index.issuesByInvoice, entry.subject, entry);
    // A send is `<run id>:<call id>`; the judge's own reading of a draft is `<run id>:judge:<call id>`, never the draft's.
    if (entry.action === 'delivery.send' && !entry.subject.includes(':judge:')) {
      const cut = entry.subject.indexOf(':');
      if (cut > 0) push(index.sendsByRun, entry.subject.slice(0, cut), entry);
    }
  }
  for (const invoice of listRecords(state, 'venture-invoice', id)) if (invoice.status !== 'void') push(index.invoicesByOrder, invoice.orderId, invoice);
  for (const link of listRecords(state, 'venture-share-link', id)) push(index.linksByRun, link.deliveryId, link);
  for (const post of listRecords(state, 'venture-connector-post', id)) if (post.draftId) push(index.postsByRun, post.draftId, post);
  for (const upload of listRecords(state, 'venture-upload', id)) if (upload.scope.kind === 'order') index.ordersWithFiles.add(upload.scope.orderId);
  for (const receipt of listRecords(state, 'venture-work-receipt', id)) {
    if (receipt.operation === 'social.report' && receipt.runRef.kind === 'delivery') index.reportRuns.add(receipt.runRef.runId);
  }
  for (const entry of listRecords(state, 'venture-ca-firm', id)) {
    if (entry.entry === 'signoff-request' && entry.subjectKind === 'gst-working' && entry.deliveryId) push(index.gstRequestsByRun, entry.deliveryId, entry);
    else if (entry.entry === 'signoff') index.signoffByRequest.set(entry.requestId, entry);
    else if (entry.entry === 'sent-to-ca') index.sentByKey.set(entry.itemKey, entry);
    else if (entry.entry === 'ca-of-record') index.caNamed = true;
  }
  return index;
}

/** Whether a new price for this order's offer waits in the plan: a draft version whose price differs from the accepted one. */
function newPriceWaits(index: OrderIndex, order: OrderRecord): boolean {
  const { accepted, latest } = index;
  if (order.status !== 'open' || !accepted || !latest || latest.status !== 'draft') return false;
  const price = (plan: BlueprintRecord) => plan.offers.find(offer => offer.id === order.offerId)?.pricing.unitPriceMinor ?? null;
  return price(latest) !== price(accepted);
}

/** The words for a stage's draft, as what waits on the owner: "the draft", "the drafts", "the episode draft", "a failed draft". */
function draftWhat(label: string, kind: 'draft' | 'failed' | 'stopped'): string {
  if (kind !== 'draft') return `a ${kind} draft`;
  if (label === 'Draft') return 'the draft';
  if (label === 'Drafts') return 'the drafts';
  return `the ${label.toLowerCase()} draft`;
}

function draftReading(context: StageContext): StageReading {
  const { index, order, newest: run } = context;
  if (!run) return NOT_YET;
  // The last send to the owner's AI that may or may not have gone out: never sent again, so the owner checks it. A
  // draft already accepted, edited or rejected sends nothing more, so an old unknown send of it is not reopened.
  if (!FINISHED.includes(run.status) && newest(index.sendsByRun.get(run.id))?.state === 'outcome_unknown') {
    return { state: 'unknown', detail: 'not sure: the last send timed out', reason: 'send-unknown' };
  }
  const open = order.status === 'open';
  switch (run.status) {
    case 'accepted': case 'edited': return DONE;
    case 'rejected': return notYet('rejected, not drafted again yet', 'rejected');
    // An engine-failed run reads failed, never stopped (stopping is the owner's or a breaker's).
    case 'failed': return open ? waits('failed, Run again waits on you', 'failed', draftWhat(context.label, 'failed')) : notYet('failed', 'failed');
    case 'stopped': return waits('stopped, Resume waits on you', 'stopped', draftWhat(context.label, 'stopped'));
    default: break;
  }
  const view = runView(run, index.venture, index.nowMs, index.state);
  if (!view.awaitingYou) return view.status === 'ready-for-review' && view.practiceNow ? notYet('a practice draft, not for clients', 'practice') : notYet('the agent is working', 'working');
  if (view.status === 'ready-for-review') return waits('ready, waits for you to read it', 'ready', draftWhat(context.label, 'draft'));
  if (view.status === 'needs-answer') return waits('a question waits on you', 'question', 'a question');
  if (view.status === 'brief-waiting') return waits('a brief waits for your approval', 'brief', 'a brief to approve');
  return waits('a step waits for your approval', 'approval', 'a step to approve');
}

function caReading(context: StageContext): StageReading {
  const { index } = context;
  const request = newest(context.runs.flatMap(run => index.gstRequestsByRun.get(run.id) ?? []));
  if (!request) return NOT_YET;
  const decided = index.signoffByRequest.get(request.id);
  if (decided) return decided.decision === 'signed' ? { state: 'done', detail: `signed by ${decided.caName}`, reason: 'ca-signed' } : notYet('returned by your CA', 'ca-returned');
  if (index.sentByKey.has(request.id)) return notYet("waits for your CA's sign-off", 'with-ca', { waitsOn: 'ca' });
  return index.caNamed ? waits('waits for you to send it to your CA', 'send-to-ca', 'the papers for your CA') : notYet('name your CA of record to send it', 'no-ca');
}

/**
 * The newest draft's Client OK: the answer the engine counts for that draft as it is now (build/share-links.ts
 * countedAnswer, the same answer ALREADY_DECIDED reads, a link the owner took back included). With none, it waits on
 * the client only while a link the client can open exists (served, not ended, not taken back); a served link that
 * ended with no answer waits on nobody; a link kept but not served is the owner's to send and record.
 */
function clientReading(context: StageContext): StageReading {
  const { index, newest: run } = context;
  if (!run) return NOT_YET;
  const answer = countedAnswer(index.state, run);
  if (answer) return answer.decision === 'approved' ? { state: 'done', detail: 'your client approved it', reason: 'client-approved' } : waits('your client asked for changes', 'client-changes', "your client's changes");
  const served = (index.linksByRun.get(run.id) ?? []).filter(link => link.served);
  if (served.some(link => link.state !== 'revoked' && link.revokedAt === null && Date.parse(link.expiresAt) > index.nowMs)) return notYet('waits for your client', 'with-client', { waitsOn: 'client' });
  return served.length ? notYet('the link ended with no answer', 'link-ended') : NOT_YET;
}

function postsReading(context: StageContext): StageReading {
  const posts = context.runs.flatMap(run => context.index.postsByRun.get(run.id) ?? []);
  if (posts.some(post => post.state === 'outcome_unknown')) return { state: 'unknown', detail: 'not sure: the last post timed out', reason: 'post-unknown' };
  const waiting = posts.filter(post => post.state === 'described').length;
  if (waiting) return waits(waiting === 1 ? 'a post waits for your approval' : `${waiting} posts wait for your approval`, 'posts-waiting', waiting === 1 ? 'the post' : `${waiting} posts`);
  if (posts.some(post => post.state === 'approved')) return notYet('posting now', 'posting');
  if (posts.some(post => post.state === 'applied') || context.order.deliveredOn !== null) return DONE;
  return ALWAYS_ASKS;
}

function invoiceReading(context: StageContext): StageReading {
  const invoice = newest(context.index.invoicesByOrder.get(context.order.id));
  if (!invoice) return NOT_YET;
  if (newest(context.index.issuesByInvoice.get(invoice.id))?.state === 'outcome_unknown') return { state: 'unknown', detail: 'not sure: the last issue timed out', reason: 'issue-unknown' };
  if (invoice.status === 'draft') return waits('ready to issue, waits on you', 'to-issue', 'the invoice');
  return { state: 'done', detail: invoice.number ?? 'done', reason: 'issued' };
}

function paidReading(context: StageContext): StageReading {
  const invoice = newest((context.index.invoicesByOrder.get(context.order.id) ?? []).filter(item => item.status !== 'draft'));
  if (!invoice) return NOT_YET;
  if (invoice.status === 'paid') return DONE;
  const due = invoice.dueDate;
  const country = context.index.venture.country;
  // A business still in its interview has no country yet: the day is written as the engine stores it.
  const when = due ? `due ${country ? formatVentureDate(due, country.dateOrder) : due}` : null;
  if (invoice.status === 'part-paid') return notYet(when ? `part paid, ${when}` : 'part paid', 'part-paid', due ? { due } : {});
  return when && due ? notYet(when, 'due', { due }) : NOT_YET;
}

/** How each record rule reads its stage's state. Every rule a stage list names has one (venture-order-steps.test.ts). */
export const STAGE_RULE_READERS: Readonly<Record<StageRule, (context: StageContext) => StageReading>> = Object.freeze({
  order: () => DONE,
  price: context => {
    if (!context.index.priceReceipts.has(context.order.priceReceiptId)) return NOT_YET;
    return newPriceWaits(context.index, context.order) ? waits('a new price waits on you', 'new-price', 'the new price') : DONE;
  },
  draft: draftReading,
  files: context => (context.index.ordersWithFiles.has(context.order.id) ? DONE : NOT_YET),
  'ca-signoff': caReading,
  calendar: context => (context.order.intake?.calendar ? { state: 'done', detail: 'planned', reason: 'planned' } : NOT_YET),
  'client-ok': clientReading,
  posts: postsReading,
  report: context => (context.runs.some(run => context.index.reportRuns.has(run.id)) ? DONE : NOT_YET),
  sent: context => (context.order.deliveredOn !== null ? DONE : ALWAYS_ASKS),
  invoice: invoiceReading,
  paid: paidReading,
});

/**
 * The flagship playbook an order follows: the playbook its newest run ran on, else the business's flagship when the
 * order's offer is that playbook's own; null for the fixed steps.
 */
function orderFlagship(index: OrderIndex, order: OrderRecord, run: DeliveryRunRecord | null): string | null {
  const playbook = run ? index.playbooks.get(run.playbookId) : undefined;
  if (playbook) return playbook.flagship ?? null;
  const offer = index.accepted?.offers.find(item => item.id === order.offerId);
  return offer?.playbookOffer ? pickPlaybook(index.venture.idea)?.id ?? null : null;
}

/** "a", "a and b", "a, b and c". */
function listWords(items: readonly string[]): string {
  return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** One order's stage steps and what waits on the owner, from the indexed records only. */
export function orderSteps(index: OrderIndex, order: OrderRecord): { stages: OrderStageView[]; waitsOnYou: OrderWaitsOnYou | null } {
  const runs = index.runsByOrder.get(order.id) ?? [];
  const run = newest(runs);
  const items: OrderWaitsOnYou['items'] = [];
  const stages = stageListFor(orderFlagship(index, order, run)).map((stage): OrderStageView => {
    const reading = STAGE_RULE_READERS[stage.rule]({ index, order, runs, newest: run, label: stage.label });
    if (reading.state === 'waits') items.push({ stage: stage.id, what: reading.what ?? `the ${stage.label.toLowerCase()}` });
    const waitsOn = reading.state === 'waits' ? 'you' as const : reading.waitsOn;
    return {
      id: stage.id, label: stage.label, state: reading.state, detail: reading.detail, line: `${stage.label}, ${reading.detail}`,
      ...(waitsOn ? { waitsOn } : {}), ...(reading.due ? { due: reading.due } : {}), ...(reading.reason ? { reason: reading.reason } : {}),
    };
  });
  const waitsOnYou = items.length
    ? { count: items.length, items, line: `${items.length} ${items.length === 1 ? 'waits' : 'wait'} on you: ${listWords(items.map(item => item.what))}.` }
    : null;
  return { stages, waitsOnYou };
}
