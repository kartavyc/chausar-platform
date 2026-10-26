// Chausar venture launcher, views (Ink v2 wave 4, package 4J3): card previews on Today's rows (a video's title and
// checks, an invoice's paper lines, a post's exact text and counts, a question's choices). Package 4-0 put the hook here;
// views/queue.ts calls it after each row's digest is made.
//
// Every preview is read from the owner's own records, never sample data: a YouTube draft's package (its title, its
// length from the run's edit list or else its transcript, its chapter count once the chapters check passed, its check
// counts, and the still from the cut when one is kept, delivery/poster.ts); an invoice draft's lines, tax lines and
// total, each with the price receipt; a CA paper's working figures, each with its receipt; a proposed post's exact text
// with its counts against the platform's limits (playbooks/social/channels.ts); a question's choices. Words a model wrote
// are checked like any agent words (agent-words.ts): a number no receipt backs sets the estimate flag, and a figure on a
// choice is only ever a model estimate. Simple first: an invoice from a business not registered for tax has no tax
// lines, and no preview carries tax numbers or registration details. A row with nothing real to show gets none, and
// drawing a preview never counts as viewed: that stays the screen's own rule (ApprovalRow), on Read or Watch.
import type { State } from '../../contracts.ts';
import { formatMinor } from '../../currency.ts';
import { assertNoMoney, currentVenture, findRecord, listRecords, modelNumbers } from '../records.ts';
import type {
  ConnectorPostRecord, DeliveryRunRecord, InvoiceRecord, PreviewFigure, PreviewLength, PreviewReceiptKind, PreviewWords, QueueCount, QueuePreview, QueueRow,
  UploadRecord, VentureRecord, WorkReceiptRecord,
} from '../contracts.ts';
import { postingName } from '../build/posting.ts';
import { transcriptCues } from '../delivery/harness/files.ts';
import { MODEL_ESTIMATE_LABEL } from '../delivery/judge/claim-check.ts';
import { posterView, youtubeRun } from '../delivery/poster.ts';
import { acceptedBlueprintOrNull } from '../delivery/shared.ts';
import { caOfRecord, sentTo, signoffRequests } from '../playbooks/ca-firm/signoff.ts';
import { CHANNEL_CAPABILITIES, SOCIAL_CHANNELS } from '../playbooks/social/channels.ts';
import { countCharacters, hashtagsOf } from '../playbooks/social/checks.ts';
import { clock, parseChapters, parsePackageText } from '../playbooks/youtube/checks.ts';
import { agentWordsLabeller } from './agent-words.ts';
import { short } from './shared.ts';

/** How agent-words.ts marks a number with no receipt, right after it. A preview carries the flag instead. */
const ESTIMATE_MARK = ` (${MODEL_ESTIMATE_LABEL})`;
/** The most working figures a CA paper's card shows; the rest are counted, and the paper itself shows them all. */
const WORKING_SHOWN = 6;
/** The most choices a card lists. */
const MAX_CHOICES = 8;

type Labeller = (words: string) => string;

/** Words as a preview shows them: shortened, checked against the run's receipts, the estimate flag set when one is missing. */
function wordsOf(label: Labeller, raw: string, max: number): PreviewWords {
  const labelled = label(short(raw, max));
  if (!labelled.includes(ESTIMATE_MARK)) return { text: labelled };
  return { text: labelled.split(ESTIMATE_MARK).join(''), estimate: true };
}

// ---------------------------------------------------------------------------
// A YouTube draft
// ---------------------------------------------------------------------------

/** A length in whole seconds as the screens say it: "48 s", "10 min", "11 min 42 s", "1 h 2 min 5 s", and as a clock. */
function lengthOf(seconds: number, from: PreviewLength['from']): PreviewLength {
  const h = Math.floor(seconds / 3600), m = Math.floor(seconds / 60) % 60, s = seconds % 60;
  const parts = [...(h ? [`${h} h`] : []), ...(m ? [`${m} min`] : []), ...(s || (!h && !m) ? [`${s} s`] : [])];
  return { seconds, display: parts.join(' '), clock: clock(seconds * 1000), from };
}

/** The run's newest edit list, as the youtube.editList tool worked it out: its kept frames over its frame rate. */
function editListLength(run: DeliveryRunRecord): PreviewLength | null {
  const call = [...(run.harness?.toolCalls ?? [])].reverse().find(item => item.tool === 'youtube.editList' && item.outcome === 'succeeded' && item.envelope.ok);
  if (!call || !call.envelope.ok) return null;
  const result = call.envelope.result as { runtimeFrames?: unknown; fps?: unknown } | null;
  const frames = result?.runtimeFrames, fps = result?.fps;
  if (!Number.isSafeInteger(frames) || !Number.isSafeInteger(fps) || (fps as number) < 1 || (frames as number) < 0) return null;
  return lengthOf(Math.floor((frames as number) / (fps as number)), 'edit-list');
}

/** How long the talk runs by the run's transcript: the end of its last timed line. Read once per file content. */
const transcriptEnds = new Map<string, number | null>();
function transcriptLength(state: State, venture: VentureRecord, run: DeliveryRunRecord): PreviewLength | null {
  const ids = run.harness?.uploadIds ?? run.uploadIds ?? [];
  const file = listRecords(state, 'venture-upload', venture.id).find((upload: UploadRecord) => ids.includes(upload.id) && upload.format === 'transcript');
  if (!file) return null;
  let endMs = transcriptEnds.get(file.digest);
  if (endMs === undefined) {
    try { endMs = transcriptCues(file).at(-1)?.endMs ?? null; } catch { endMs = null; }
    if (transcriptEnds.size > 32) transcriptEnds.delete(transcriptEnds.keys().next().value!);
    transcriptEnds.set(file.digest, endMs);
  }
  return endMs === null ? null : lengthOf(Math.floor(endMs / 1000), 'transcript');
}

/** A YouTube draft's package as code reads it: the title the agent wrote, how long it runs, and its description. */
function videoFacts(state: State, venture: VentureRecord, run: DeliveryRunRecord): { title: PreviewWords; length: PreviewLength | null; description: string } | null {
  const deliverable = run.deliverable;
  if (!deliverable) return null;
  const lines = deliverable.sections.flatMap(section => section.parts.flatMap(part => (part.kind === 'text' ? [part.text] : [])));
  const pkg = parsePackageText(lines.join('\n'));
  const raw = pkg.title.trim() || deliverable.title.trim();
  if (!raw) return null;
  return {
    title: wordsOf(agentWordsLabeller(state, venture, run), raw, 160),
    length: editListLength(run) ?? transcriptLength(state, venture, run),
    description: pkg.description,
  };
}

function videoPreview(state: State, venture: VentureRecord, run: DeliveryRunRecord): QueuePreview | null {
  if (!youtubeRun(state, venture, run)) return null;
  const facts = videoFacts(state, venture, run);
  if (!facts) return null;
  const order = findRecord(state, 'venture-order', run.orderId);
  // A check that could not run, or a judge that settled nothing, is neither passed nor failed: it is counted apart.
  const counted = run.checks.filter(result => !result.notChecked);
  const own = run.playbookChecks ?? [];
  const checks = {
    passed: counted.filter(result => result.passed).length + own.filter(result => result.outcome === 'pass').length,
    run: counted.length + own.filter(result => result.outcome !== 'not-run').length,
    notRun: run.checks.length - counted.length + own.filter(result => result.outcome === 'not-run').length,
  };
  const chaptersPassed = own.some(result => result.check === 'chapters' && result.outcome === 'pass');
  const chapters = chaptersPassed ? parseChapters(facts.description).length : 0;
  const poster = order ? posterView(state, venture.id, order.id) : null;
  return {
    kind: 'video', title: facts.title, format: order?.intake?.format ?? 'long',
    ...(facts.length ? { duration: facts.length } : {}), ...(chapters > 0 ? { chapters } : {}), checks,
    ...(poster ? { poster } : {}),
  };
}

// ---------------------------------------------------------------------------
// Papers: an invoice draft, a CA paper waiting for the CA
// ---------------------------------------------------------------------------

function dueWords(days: number): string {
  if (days === 0) return 'Due on receipt';
  return days === 1 ? 'Due in 1 day' : `Due in ${days} days`;
}

/**
 * An invoice draft's paper: every figure with its price receipt (venture.receipt.get serves it), from the plan version
 * the invoice was priced with. An invoice whose total is not its own receipt's shows no paper: a figure is never shown
 * with a receipt that does not prove it.
 */
function invoicePaper(state: State, venture: VentureRecord, invoice: InvoiceRecord): QueuePreview | null {
  if (invoice.status !== 'draft') return null;
  const client = findRecord(state, 'venture-client', invoice.clientId);
  const receipt = listRecords(state, 'venture-price-receipt', venture.id).find(item => item.id === invoice.priceReceiptId);
  if (!client || client.ventureId !== venture.id || !receipt || receipt.totalMinor !== invoice.totalMinor) return null;
  const receiptId = receipt.id;
  const money = (minor: string) => formatMinor(minor, invoice.currency);
  const figure = (label: string, minor: string): PreviewFigure => ({ label, value: money(minor), receiptId, receiptKind: 'price' });
  // Simple first: tax lines only for a business that charges tax on this invoice; registration details stay on the paper.
  const taxed = invoice.taxTreatment !== 'none' && invoice.taxLines.length > 0;
  // The seller's name as the plan version this invoice was priced with gave it (money/invoices.ts pricedBlueprint).
  const priced = listRecords(state, 'venture-blueprint', venture.id).find(plan => plan.digest === receipt.inputs.blueprintDigest)
    ?? acceptedBlueprintOrNull(state, venture);
  return {
    kind: 'paper', paper: 'invoice', title: `${invoice.documentTitle} ${invoice.number ?? '(draft)'}`,
    from: priced?.name.value ?? venture.workingName, to: client.name,
    lines: invoice.lines.map(line => ({ label: line.description, quantity: line.quantity, unit: money(line.unitMinor), value: money(line.amountMinor), receiptId, receiptKind: 'price' as const })),
    subtotal: figure('Subtotal', invoice.subtotalMinor),
    ...(BigInt(invoice.discountMinor) > 0n ? { discount: figure('Discount', invoice.discountMinor) } : {}),
    taxLines: taxed ? invoice.taxLines.map(line => figure(line.label, line.minor)) : [],
    total: figure('Total', invoice.totalMinor),
    due: { days: invoice.dueInDays, date: invoice.dueDate, display: dueWords(invoice.dueInDays) },
  };
}

/**
 * Which method opens a work receipt: a CA engine's receipt kept whole on it through venture.ca.receipt (the CA reads
 * it worked again), any other through venture.work.get. Neither is a price or sum receipt for venture.receipt.get.
 */
function workReceiptKind(receipt: WorkReceiptRecord): PreviewReceiptKind {
  return receipt.operation === 'ca.engine' && receipt.ca ? 'ca' : 'work';
}

function workingPaper(state: State, venture: VentureRecord, requestId: string): QueuePreview | null {
  const request = signoffRequests(state, venture.id).find(item => item.id === requestId);
  if (!request) return null;
  const receipts = new Map(listRecords(state, 'venture-work-receipt', venture.id).map(receipt => [receipt.id, receipt]));
  const figures: PreviewFigure[] = request.receiptIds.flatMap(id => {
    const receipt = receipts.get(id);
    if (!receipt) return [];
    const receiptKind = workReceiptKind(receipt);
    return receipt.figures.filter(item => item.unit !== 'post').map(item => ({ label: item.label, value: item.display, receiptId: receipt.id, receiptKind }));
  });
  if (!figures.length) return null;
  const sent = sentTo(state, venture.id, request.id);
  const ca = caOfRecord(state, venture.id);
  return {
    kind: 'paper', paper: 'working', title: request.title, client: request.clientName,
    working: figures.slice(0, WORKING_SHOWN), more: Math.max(0, figures.length - WORKING_SHOWN),
    signer: sent ? { name: sent.caName, state: 'with-ca' } : ca ? { name: ca.name, state: 'to-send' } : null,
  };
}

// ---------------------------------------------------------------------------
// A post, a question's choices
// ---------------------------------------------------------------------------

/**
 * A post's counts against its platform's limits, from the dated channel table (characters as the platform counts them,
 * and hashtags where the platform has a cap); none for a platform not on it. Exported so a row's own counts can match.
 */
export function postCounts(post: Pick<ConnectorPostRecord, 'connectorId' | 'text'>): QueueCount[] {
  const channel = SOCIAL_CHANNELS.map(id => CHANNEL_CAPABILITIES[id]).find(item => item.connectorId === post.connectorId);
  if (!channel) return [];
  return [
    { label: 'characters', count: countCharacters(post.text, channel.id), limit: channel.maxChars },
    ...(channel.maxHashtags !== null ? [{ label: 'hashtags', count: hashtagsOf(post.text).length, limit: channel.maxHashtags }] : []),
  ];
}

/** Whether words state an amount of money, by the same check model words go through (records.ts assertNoMoney). */
function namesMoney(words: string): boolean {
  try { assertNoMoney(words, 'post'); return false; } catch { return true; }
}

function postPreview(state: State, venture: VentureRecord, post: ConnectorPostRecord): QueuePreview | null {
  if (post.state !== 'described') return null;
  const run = post.draftId ? findRecord(state, 'venture-delivery-run', post.draftId) : undefined;
  const order = run && run.ventureId === venture.id ? findRecord(state, 'venture-order', run.orderId) : undefined;
  // The Short the post comes from, when its draft is a YouTube Short: its title and, when known, its length.
  const facts = run && order?.intake?.format === 'short' && youtubeRun(state, venture, run) ? videoFacts(state, venture, run) : null;
  // A post an agent proposed, or one cut from a draft a model wrote, is model words: a number or an amount in it has no
  // receipt, so the card says so. The text itself stays exact, as it will be posted.
  const modelWritten = post.agent !== null || (!!run && run.ventureId === venture.id && run.servedBy === 'model');
  const textEstimate = modelWritten && (modelNumbers(post.text) || namesMoney(post.text));
  return {
    kind: 'post', connectorId: post.connectorId, platform: postingName(post.connectorId), account: post.account, mode: post.mode,
    text: post.text, ...(textEstimate ? { textEstimate: true as const } : {}), counts: postCounts(post),
    ...(facts ? { short: { title: facts.title, ...(facts.length ? { length: facts.length } : {}) } } : {}),
  };
}

const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

function choicePreview(state: State, venture: VentureRecord, run: DeliveryRunRecord): QueuePreview | null {
  if (run.status !== 'needs-answer' || !run.harness) return null;
  const open = [...run.harness.handoffs].reverse().find(handoff => handoff.answer === null);
  const choices = open?.to === 'owner' && Array.isArray(open.choices) ? open.choices.filter(choice => text(choice?.label) && text(choice?.text)) : [];
  // 4J17 (A14): a card the agent asked rides whole (its words passed the untrusted screen and the money check when
  // asked, agents/questions.ts); a round of questions has its preview too, with no single set of options.
  const card = open?.to === 'owner' && open.card && Array.isArray(open.card.items) && open.card.items.length ? open.card : null;
  if (!open || (choices.length < 2 && !(card && card.items.length > 1))) return null;
  const label = agentWordsLabeller(state, venture, run);
  if (choices.length < 2) return { kind: 'choice', question: wordsOf(label, open.question, 1200), options: [], card: structuredClone(card!) };
  return {
    kind: 'choice', question: wordsOf(label, open.question, 300), ...(card ? { card: structuredClone(card) } : {}),
    options: choices.slice(0, MAX_CHOICES).map((choice, index) => {
      const estimate = choice.estimate && text(choice.estimate.label) && text(choice.estimate.value) ? choice.estimate : null;
      // A choice's name is a short tag; one that holds a number is named by its place instead, so no figure goes unlabelled.
      const name = short(choice.label, 40);
      return {
        label: modelNumbers(name) ? String.fromCharCode(65 + index) : name, text: wordsOf(label, choice.text, 200),
        ...(estimate ? { estimate: { label: short(estimate.label, 80), value: short(estimate.value, 60) } } : {}),
        ...(text(choice.gains) ? { gains: short(choice.gains, 120) } : {}), ...(text(choice.costs) ? { costs: short(choice.costs, 120) } : {}),
        ...(typeof choice.recommended === 'boolean' ? { recommended: choice.recommended } : {}),
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// The hook
// ---------------------------------------------------------------------------

function previewOf(state: State, venture: VentureRecord, row: QueueRow): QueuePreview | null {
  const ref = row.viewRef;
  if (!ref) return null;
  const run = () => {
    const found = findRecord(state, 'venture-delivery-run', ref.id);
    return found && found.ventureId === venture.id ? found : null;
  };
  if (row.kind === 'draft' && ref.kind === 'draft') { const found = run(); return found ? videoPreview(state, venture, found) : null; }
  if (row.kind === 'question' && ref.kind === 'run') { const found = run(); return found ? choicePreview(state, venture, found) : null; }
  if (row.kind === 'invoice' && ref.kind === 'file') {
    const invoice = findRecord(state, 'venture-invoice', ref.id);
    return invoice && invoice.ventureId === venture.id ? invoicePaper(state, venture, invoice) : null;
  }
  if (row.kind === 'signoff' && ref.kind === 'file') return workingPaper(state, venture, ref.id);
  if (row.kind === 'connector' && ref.kind === 'draft') {
    const post = findRecord(state, 'venture-connector-post', ref.id);
    return post && post.ventureId === venture.id ? postPreview(state, venture, post) : null;
  }
  return null;
}

/**
 * Adds a preview to the rows that have something real to show. It keeps every row, in the same order, with the same id
 * and digest, and adds only the preview field. A record that cannot be read gives that row no preview, never a broken
 * Today.
 */
export function withPreviews(state: State, rows: QueueRow[]): QueueRow[] {
  const venture = currentVenture(state);
  // A business still in its interview has no country yet (so no dates, no calendar), and no orders or runs to preview.
  if (!venture || !venture.country) return rows;
  return rows.map(row => {
    let preview: QueuePreview | null = null;
    try { preview = previewOf(state, venture, row); } catch { preview = null; }
    return preview ? { ...row, preview } : row;
  });
}
