// Chausar venture launcher, views: venture.queue.view { id, kind? } (read). What a Today row is about, in words the
// owner reads before deciding: a draft's text and the files it read, the exact text a run sends to the owner's AI, a
// heavy-work brief, an agent's question, an invoice, the plan, a CA sign-off request, the rate tables waiting for the
// CA, a post's exact text, a cost to approve, or a suggested value. id is a Today row id; with kind it is instead the
// id in a row's viewRef. Text only: every figure is already formatted by code, and model numbers say so.
import { ChausarError, check, type Context, type State } from '../../contracts.ts';
import { formatMinor } from '../../currency.ts';
import { exactPayload, formatVentureDate, listRecords, readVenture } from '../records.ts';
import type {
  BlueprintRecord, DeliveryRunRecord, Display, InvoiceRecord, Labelled, PlanFlagshipStep, QueueItemView, QueueRow, VentureDeps, VentureRecord,
} from '../contracts.ts';
import { invoiceView } from '../money/invoices.ts';
import { openSpendQuotes } from '../money/spend.ts';
import { postingName } from '../build/posting.ts';
import { openDelegation } from '../delivery/harness/loop.ts';
import { DELEGATE_LABELS } from '../delivery/harness/delegate.ts';
import { holdOfHandoff } from '../policy/holds.ts';
import type { RateTable } from '../playbooks/ca-firm/rates.ts';
import { caOfRecord, rateKey, sentTo, signoffFor, signoffRequests, unconfirmedRateTables } from '../playbooks/ca-firm/signoff.ts';
import { queueRowsWithSubjects } from './queue.ts';
import { agentName, businessOf, clientNameFor } from './shared.ts';

type Section = QueueItemView['sections'][number];
type Head = { businessName: string; agent?: string };

/** Longest text a view returns, in lines: a view is for reading on a screen, not a dump. */
const MAX_LINES = 400;
const MODEL_ESTIMATE = ' (model estimate)';
const DONE_BY: Readonly<Record<string, string>> = { agent: 'an agent', you: 'you', 'agent-then-you': 'an agent, then you check it' };
/** Who does a flagship playbook's step, in a few words: "the Packager, an agent", "Chausar, in code with no AI", "you". */
function stepDoer(step: PlanFlagshipStep): string {
  if (step.doneBy === 'agent') return `the ${step.who}, an agent`;
  if (step.doneBy === 'code') return `${step.who}, in code with no AI`;
  return step.doneBy === 'you' ? 'you' : step.who;
}
const SUBJECT_WORDS: Readonly<Record<string, string>> = {
  'gst-working': 'A GST working', 'tds-working': 'A TDS working', 'itr-data-pack': 'An income tax data pack', letter: 'A letter on the firm\'s letterhead',
};

const gone = () => new ChausarError('QUEUE_ITEM_NOT_FOUND', 'This was resolved elsewhere, or it is not in this business.');
/** The same id part views/queue.ts builds row subjects with. */
const part = (value: string) => value.replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 80);

/** Splits text into lines for a section, keeping blank lines out and the length bounded. */
function linesOf(text: string): Display[] {
  const lines = text.split(/\r?\n/).map(line => line.trimEnd()).filter(line => line.trim().length > 0);
  return lines.length > MAX_LINES ? [...lines.slice(0, MAX_LINES), `And ${lines.length - MAX_LINES} more lines.`] : lines;
}

/** A rendered draft ('# Title', '## Heading', text) as sections; the title line is left to the view's title. */
function draftSections(text: string): Section[] {
  const sections: Section[] = [];
  let current: Section = { lines: [] };
  for (const line of linesOf(text)) {
    if (/^# /.test(line)) continue;
    const heading = /^## (.+)$/.exec(line);
    if (heading) {
      if (current.heading || current.lines.length) sections.push(current);
      current = { heading: heading[1], lines: [] };
    } else current.lines.push(line);
  }
  if (current.heading || current.lines.length) sections.push(current);
  return sections;
}

const labelled = (line: Labelled<string>) => `${line.value}${line.estimate ? MODEL_ESTIMATE : ''}`;

function filesSection(state: State, venture: VentureRecord, run: DeliveryRunRecord): Section[] {
  const ids = run.harness?.uploadIds ?? run.uploadIds ?? [];
  if (!ids.length) return [];
  const uploads = new Map(listRecords(state, 'venture-upload', venture.id).map(upload => [upload.id, upload]));
  return [{ heading: 'Files the agent works from', lines: ids.map(id => uploads.get(id)?.name ?? 'A file that is no longer here') }];
}

function checksLine(run: DeliveryRunRecord): Display | undefined {
  if (!run.checks.length) return undefined;
  const passed = run.checks.filter(item => item.passed).length;
  return `${passed} of ${run.checks.length} checks passed.`;
}

// ---------------------------------------------------------------------------
// One view per thing a row can be about
// ---------------------------------------------------------------------------

function planView(head: Head, blueprint: BlueprintRecord): QueueItemView {
  const currency = blueprint.backOffice.currency;
  const offerLine = (offer: BlueprintRecord['offers'][number]) => {
    const price = offer.pricing.unitPriceMinor === null ? 'no price yet' : `${formatMinor(offer.pricing.unitPriceMinor, currency)} per ${offer.pricing.quantityUnit}`;
    return `${labelled(offer.name)}: ${price}. ${labelled(offer.description)}`;
  };
  const tax = blueprint.backOffice;
  const taxLine = tax.taxRegistered.value
    ? `You charge ${tax.taxLabel}${tax.taxRegistered.label === 'assumption' ? ' (Chausar assumed this; confirm it)' : ''}.`
    : `You do not charge ${tax.taxLabel}${tax.taxRegistered.label === 'assumption' ? ' (Chausar assumed this; confirm it)' : ''}.`;
  return {
    kind: 'plan', id: blueprint.id, ...head, title: labelled(blueprint.name), line: labelled(blueprint.oneLiner),
    sections: [
      { heading: 'Who it is for', lines: [labelled(blueprint.customer)] },
      { heading: 'What you sell', lines: blueprint.offers.map(offerLine) },
      // A flagship playbook's plan lists the steps that run, in place of the four template steps.
      {
        heading: 'How the work is done',
        lines: blueprint.flagshipSteps
          ? blueprint.flagshipSteps.map(step => `${labelled(step.title)}: ${stepDoer(step)}.`)
          : blueprint.deliverySteps.map(step => `${labelled(step.title)}: ${DONE_BY[step.doneBy] ?? step.doneBy}. ${step.note}`),
      },
      { heading: 'What you approve', lines: blueprint.approvals.map(labelled) },
      { heading: 'Back office', lines: [taxLine, tax.invoiceKind === 'tax-invoice' ? 'Invoices are tax invoices.' : 'Invoices are plain invoices.', ...tax.taxInvoiceMissing.map(item => `Missing for a tax invoice: ${item}.`)] },
    ],
  };
}

/** A delivery run: the draft when there is one, else what the run waits on (the AI's exact text, a brief, a question). */
function runItem(state: State, venture: VentureRecord, head: Head, run: DeliveryRunRecord, prefer: 'draft' | 'run'): QueueItemView {
  const client = clientNameFor(state, venture.id, run.orderId);
  const files = filesSection(state, venture, run);
  const text = run.editedText ?? run.renderedText;
  if (text && (prefer === 'draft' || run.status !== 'waiting-for-you')) {
    const title = run.deliverable?.title ? `${run.deliverable.title}` : `Draft reply for ${client}`;
    const notes = [checksLine(run), run.deliverable?.estimate ? 'Numbers the agent wrote in its own words are model estimates; figures from receipts are not.' : undefined]
      .filter((line): line is string => !!line);
    return {
      kind: 'draft', id: run.id, ...head, title, line: `For ${client}. You send it yourself.`,
      sections: [...draftSections(text), ...files, ...(notes.length ? [{ heading: 'Checks', lines: notes }] : [])],
    };
  }
  if (run.status === 'waiting-for-you' && run.preview) {
    return {
      kind: 'draft', id: run.id, ...head, title: `The text that goes to your AI for ${client}`,
      line: `The most it can cost: ${run.preview.estimatedMaxCostDisplay}. Nothing goes to the client.`,
      sections: [{ heading: 'Exact text', lines: linesOf(run.preview.payloadText) }, ...files],
    };
  }
  if (run.status === 'brief-waiting' && run.harness) {
    const open = openDelegation(run.harness);
    if (open) {
      return {
        kind: 'draft', id: run.id, ...head, title: `The brief for ${DELEGATE_LABELS[open.cli]} on ${client}'s order`,
        line: `It runs on this computer with only this order's files, for at most ${open.limits.minutes} minutes.`,
        sections: [{ heading: 'Exact brief', lines: linesOf(open.briefText) }, ...files],
      };
    }
  }
  if (run.status === 'needs-answer' && run.harness) {
    const openIndex = run.harness.handoffs.map(item => item.answer).lastIndexOf(null);
    const question = openIndex >= 0 ? run.harness.handoffs[openIndex] : null;
    const hold = question ? holdOfHandoff(run.harness, openIndex) : null;
    return {
      kind: 'draft', id: run.id, ...head, title: hold ? `A step on hold for ${client}` : `A question about ${client}'s order`,
      ...(question ? { line: question.question } : {}),
      sections: [
        ...(hold ? [{ heading: 'What it wants to run', lines: [`${hold.tool}: ${hold.reason}`] }] : []),
        ...run.harness.turns.filter(turn => turn.note).slice(-5).map(turn => ({ heading: `Step ${turn.turn}`, lines: linesOf(turn.note) })),
        ...files,
      ],
    };
  }
  return {
    kind: 'draft', id: run.id, ...head, title: `The draft for ${client}`,
    line: run.status === 'failed' ? (run.harness?.stopReason ?? 'This run stopped before it finished. Nothing was sent to the client.') : 'There is no draft text yet.',
    sections: files,
  };
}

function invoiceItem(state: State, venture: VentureRecord, head: Head, invoice: InvoiceRecord, deps: VentureDeps): QueueItemView {
  const view = invoiceView(state, venture, invoice, deps);
  const due = invoice.dueDate ? `Due ${formatVentureDate(invoice.dueDate, venture.country.dateOrder)}.` : undefined;
  return {
    kind: 'file', id: invoice.id, ...head, title: `${invoice.documentTitle} ${invoice.number ?? '(draft)'} for ${view.client.name}`, ...(due ? { line: due } : {}),
    sections: [
      { heading: 'The invoice', lines: linesOf(view.documentText) },
      { heading: 'Figures', lines: view.figures.map(figure => `${figure.label}: ${figure.display}`) },
      ...(view.notes.length ? [{ heading: 'Notes', lines: view.notes }] : []),
    ],
  };
}

function signoffItem(state: State, venture: VentureRecord, head: Head, requestId: string): QueueItemView | null {
  const request = signoffRequests(state, venture.id).find(item => item.id === requestId);
  if (!request) return null;
  const ca = caOfRecord(state, venture.id);
  const decided = signoffFor(state, venture.id, request.id);
  const sent = sentTo(state, venture.id, request.id);
  const where = decided ? `${decided.decision === 'signed' ? 'Signed off' : 'Returned'} by ${decided.caName}.`
    : sent ? `With ${sent.caName}, who signs by typing their ICAI membership number.` : `Waiting to be sent to ${ca?.name ?? 'your CA of record'}.`;
  const run = request.deliveryId ? listRecords(state, 'venture-delivery-run', venture.id).find(item => item.id === request.deliveryId) : undefined;
  const text = run ? run.editedText ?? run.renderedText : null;
  return {
    kind: 'file', id: request.id, ...head, title: request.title, line: `${request.clientName ? `For ${request.clientName}. ` : ''}${where}`,
    sections: [
      { heading: 'What the papers are', lines: [
        `${SUBJECT_WORDS[request.subjectKind] ?? 'Regulated papers'}. Nothing regulated leaves Chausar until the CA signs it.`,
        `They rest on ${request.receiptIds.length === 1 ? 'one receipt' : `${request.receiptIds.length} receipts`}: ${request.receiptIds.join(', ')}.`,
      ] },
      ...(text ? draftSections(text) : []),
    ],
  };
}

function ratesItem(state: State, venture: VentureRecord, head: Head, rowId: string, title: string, sentOnly: boolean): QueueItemView {
  const open = unconfirmedRateTables(state, venture.id).filter(table => !!sentTo(state, venture.id, rateKey(table)) === sentOnly);
  const lines = (table: RateTable) => [
    `Version ${table.version}, from ${formatVentureDate(table.validFrom, venture.country.dateOrder)}${table.validTo ? ` until ${formatVentureDate(table.validTo, venture.country.dateOrder)}` : ''}. ${table.appliesTo}`,
    ...table.citations.map(citation => `Source: ${[citation.source, citation.part].filter(Boolean).join(', ')}${citation.url ? ` (${citation.url})` : ''}`),
    ...table.openQuestions,
  ];
  return {
    kind: 'file', id: rowId, ...head, title, line: 'The CA checks each rate against its sources before real client work uses it. Rehearsal does not wait.',
    sections: open.map(table => ({ heading: table.title, lines: lines(table) })),
  };
}

// ---------------------------------------------------------------------------
// Resolving what the owner asked for
// ---------------------------------------------------------------------------

function byRef(deps: VentureDeps, state: State, venture: VentureRecord, head: Head, kind: string, id: string): QueueItemView | null {
  if (kind === 'plan') {
    const blueprint = listRecords(state, 'venture-blueprint', venture.id).find(item => item.id === id);
    return blueprint ? planView(head, blueprint) : null;
  }
  if (kind === 'draft' || kind === 'run') {
    const run = listRecords(state, 'venture-delivery-run', venture.id).find(item => item.id === id);
    if (run) return runItem(state, venture, { ...head, agent: agentName(state, venture) }, run, kind === 'draft' ? 'draft' : 'run');
    const post = listRecords(state, 'venture-connector-post', venture.id).find(item => item.id === id);
    if (post) {
      return {
        kind: 'draft', id: post.id, ...head, ...(post.agent ? { agent: post.agent } : {}),
        title: `Post to ${postingName(post.connectorId)}${post.account ? ` as ${post.account}` : ''}`, line: post.describe,
        sections: [{ heading: 'Exact text', lines: linesOf(post.text) }, ...(post.risk ? [{ heading: 'Risk', lines: [post.risk] }] : [])],
      };
    }
    return null;
  }
  if (kind === 'file') {
    const invoice = listRecords(state, 'venture-invoice', venture.id).find(item => item.id === id);
    if (invoice) return invoiceItem(state, venture, head, invoice, deps);
    return signoffItem(state, venture, head, id);
  }
  return null;
}

/** A row with no viewRef: a cost to approve, a suggested value, the rate tables for the CA. Setup rows only open a place. */
function byRow(state: State, venture: VentureRecord, head: Head, row: QueueRow, subject: string): QueueItemView | null {
  if (subject.startsWith('spend-quote:')) {
    const quote = openSpendQuotes(state).find(item => subject === `spend-quote:${part(item.id)}`);
    if (!quote) return null;
    return {
      kind: 'file', id: row.id, ...head, title: `The cost of ${quote.label}`, line: 'One approval pays for this one call, within the hour.',
      sections: [{ lines: [`It may cost ${quote.figure}.`, 'If it costs less, you pay what it costs. If the price changes, it asks again.'] }],
    };
  }
  if (subject.startsWith('evidence:')) {
    const record = listRecords(state, 'venture-evidence', venture.id).find(item => subject === `evidence:${part(item.id)}`);
    if (!record) return null;
    return {
      kind: 'file', id: row.id, ...head, title: row.title, ...(row.line ? { line: row.line } : {}),
      sections: [{ lines: [
        record.claim === 'needs-your-data' ? 'Chausar cannot see this value.' : `Suggested: ${record.value}${record.type === 'model-inferred' ? ' (the AI inferred this; nothing checked it)' : ''}`,
        `Where it came from: ${record.source}`,
        `How sure: ${record.strength}.`,
      ] }],
    };
  }
  if (subject === 'ca-rates:send') return ratesItem(state, venture, head, row.id, row.title, false);
  if (subject === 'ca-rates:sign') return ratesItem(state, venture, head, row.id, row.title, true);
  return null;
}

/** venture.queue.view { id, kind? } (read): what a Today row is about. QUEUE_ITEM_NOT_FOUND when it is gone. */
export async function queueViewHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<QueueItemView> {
  const body = exactPayload(payload, ['id', 'kind'], ['id']);
  check(typeof body.id === 'string' && /^[A-Za-z0-9_.:-]{3,400}$/.test(body.id), 'INVALID_VENTURE_REQUEST', 'Send the id of the row, or of the thing it points at.');
  check(body.kind === undefined || ['draft', 'file', 'run', 'plan'].includes(body.kind as string), 'INVALID_VENTURE_REQUEST', 'kind is draft, file, run or plan.');
  const { state, venture } = readVenture(deps, ctx);
  const head: Head = { businessName: businessOf(deps, state).name };
  const id = body.id as string;
  if (body.kind === undefined) {
    const found = (await queueRowsWithSubjects(deps, ctx)).find(item => item.row.id === id);
    if (found) {
      const { row, subject } = found;
      check(row.businessId === businessOf(deps, state).id, 'QUEUE_ITEM_NOT_FOUND', 'Open that business to read this.');
      const rowHead = { ...head, ...(row.agent ? { agent: row.agent } : {}) };
      const view = row.viewRef ? byRef(deps, state, venture, rowHead, row.viewRef.kind, row.viewRef.id) : byRow(state, venture, rowHead, row, subject);
      if (view) return view;
      throw new ChausarError('QUEUE_ITEM_NOT_FOUND', 'This row has nothing to read. It opens its place instead.');
    }
  }
  const view = byRef(deps, state, venture, head, (body.kind as string | undefined) ?? '', id)
    ?? (body.kind === undefined ? (byRef(deps, state, venture, head, 'draft', id) ?? byRef(deps, state, venture, head, 'file', id) ?? byRef(deps, state, venture, head, 'plan', id)) : null);
  if (!view) throw gone();
  return view;
}
