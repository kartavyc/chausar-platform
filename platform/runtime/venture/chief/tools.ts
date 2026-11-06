// Chausar venture launcher, chief (Ink v2 wave 4, package 4C1, catalogue A1, spec 5.4): the chief's read tools. Each
// one calls the engine's own read handlers with the owner's context and returns plain facts for the model plus the
// figures it may quote, each with the receipt behind it and that receipt's key. No tool writes the business: the only
// records a read can add are receipts, a sum receipt for a sum not added up before (as every Money read does) and an
// offer's price receipt for a plan version not priced before (as venture.price.quote makes it). A name a tool does
// not know gets TOOL_NOT_ALLOWED and the answer goes on without it. Every word that came from outside or from a person
// (client names, card titles, run purposes, agents' lines, journal lines, offer names), and every figure label built
// from them, passes the untrusted screen first, so words aimed at the AI never reach it; a held one is left out or
// replaced by plain words. Ids travel in fields named id, which the chat's id-number screen leaves alone.
import { type Context, type State } from '../../contracts.ts';
import type { AcrossFigureId, BlueprintRecord, BusinessSnapshot, ChatPart, Json, Offer, PriceReceiptRecord, VentureDeps, VentureRecord } from '../contracts.ts';
import { asOfWords, readSnapshots, savedReceipts, unreadableLine } from '../money/across.ts';
import { findRecord, listRecords, ventureAction } from '../records.ts';
import { buildPriceReceipt } from '../money/quote.ts';
import { acceptedBlueprintOrNull, readAs } from '../delivery/shared.ts';
import { screenUntrusted } from '../policy/untrusted.ts';
import { screenSettingOf } from '../policy/untrusted-methods.ts';
import { queueListHandler } from '../views/queue.ts';
import { runsListHandler } from '../views/runs.ts';
import { teamListHandler } from '../views/team.ts';
import { journalListHandler } from '../journal/list.ts';
import { booksSummary } from '../money/books.ts';
import { moneyOverview } from '../money/overview.ts';
import { listInvoices } from '../money/invoices.ts';
import { listClients } from '../money/clients.ts';
import { goalView } from '../money/goals.ts';
import { latestBlueprint } from '../money/shared.ts';
import { clientNameFor, short } from '../views/shared.ts';
import { listedWays } from './fit.ts';

/** A figure a tool returned: the receipt behind it, the receipt's key for it, what it is, and the receipt's own display. */
export type ToolFigure = { receiptId: string; key: string; label: string; display: string };
export type ToolResult =
  | { tool: string; data: Json; figures: ToolFigure[] }
  | { tool: string; error: string; line: string };

/** The read tools, in the order the model is told about them. */
export const TOOL_CATALOGUE: readonly { name: string; what: string }[] = Object.freeze([
  { name: 'queue', what: "What needs the owner on Today: each card's kind, title and line." },
  { name: 'runs', what: 'Recent runs: who did them, what for, and how they stand.' },
  { name: 'team', what: 'The agents and their departments: who is working, waiting or idle, jobs done this week and spend this month.' },
  { name: 'money', what: 'Money: what clients owe, what came in and what AI cost this month, billed, received and earned this month and last month, open invoices, and the monthly goal when set.' },
  { name: 'clients', what: 'Clients, what each owes, and the open orders with their totals and ids.' },
  { name: 'plan', what: 'The plan: the offers with their ids, units and whether each has a price.' },
  { name: 'journal', what: 'The latest twenty outside actions in the journal and how each stands.' },
  { name: 'businesses', what: 'The other businesses on this computer, whether each is locked, and for each that is not, its totals and counts as saved when it was last open.' },
  { name: 'ways', what: 'The ways to earn Chausar can run: each with its hours a week (a model estimate), its team, what the owner does, and whether the owner runs it already.' },
]);
export const TOOL_NOT_ALLOWED_LINE = 'There is no read tool by that name. Chausar has read tools only, and none of them writes.';
/** Where this host keeps no summaries of closed businesses (4J6), the chief reads the open business only. */
export const OPEN_ONLY_LINE = 'Chausar can read only the open business.';
/** 4J6: how the chief reads the other businesses on this computer. */
export const SNAPSHOT_LINE = 'Other businesses are read from what Chausar saved when each was last open, every figure as of then. A locked one is never read.';

type Read = { data: Json; figures: ToolFigure[] };
type Tool = (deps: VentureDeps, ctx: Context, state: State, venture: VentureRecord) => Promise<Read>;

/** Outside words as the chat may send them: through the untrusted screen in enforce mode, else left out (null). */
export function outsideWords(state: State, venture: VentureRecord, text: string | null | undefined, max = 160): string | null {
  if (!text) return null;
  const screened = screenUntrusted({ source: 'client-file', text }, { mode: 'enforce', released: screenSettingOf(state, venture.id).released }).text;
  return screened === null ? null : short(screened, max);
}

/** The key a stored receipt holds its figure under: a sum receipt's own key, a price receipt's total. Null when unknown. */
function keyOf(state: State, receiptId: string | null | undefined): { key: string; display: string } | null {
  if (!receiptId) return null;
  const sum = findRecord(state, 'venture-sum-receipt', receiptId);
  if (sum?.figures[0]) return { key: sum.figures[0].key, display: sum.figures[0].display };
  const price = findRecord(state, 'venture-price-receipt', receiptId);
  const total = price?.figures.find(item => item.key === 'total');
  if (total) return { key: total.key, display: total.display };
  const work = findRecord(state, 'venture-work-receipt', receiptId);
  if (work?.figures[0]) return { key: work.figures[0].key, display: work.figures[0].display };
  return null;
}

/** A figure for a stored receipt, with the display the receipt itself holds. */
function stored(state: State, receiptId: string | null | undefined, label: string): ToolFigure[] {
  const found = keyOf(state, receiptId);
  return found && receiptId ? [{ receiptId, key: found.key, label, display: found.display }] : [];
}

/**
 * A figure's label that names something from outside (a client, a card's title, a run's purpose): the outside words go
 * through the untrusted screen, and a held one gives the plain fallback ("A client owes"), so no label carries them.
 */
function label(state: State, venture: VentureRecord, outside: string | null | undefined, said: (words: string) => string, fallback: string): string {
  const words = outsideWords(state, venture, outside, 60);
  return words === null ? fallback : said(words);
}

const queue: Tool = async (deps, ctx, state, venture) => {
  const list = await queueListHandler(deps, ctx, {});
  const rows = list.rows.filter(row => row.kind !== 'locked').slice(0, 20);
  const fresh = deps.store.read();
  return {
    data: {
      needsYou: list.needsYou,
      cards: rows.map(row => ({ kind: row.kind, title: outsideWords(state, venture, row.title), line: outsideWords(state, venture, row.line ?? null), agent: row.agent ?? null, at: row.createdAt })),
    },
    figures: rows.flatMap(row => (row.change?.receiptId
      ? stored(fresh, row.change.receiptId, label(state, venture, row.title, title => `${row.change!.label} on "${title}"`, `${row.change.label} on a card`))
      : [])),
  };
};

const runs: Tool = async (deps, ctx, state, venture) => {
  const list = (await runsListHandler(deps, ctx, {})).runs.slice(0, 15);
  const fresh = deps.store.read();
  return {
    data: { runs: list.map(run => ({ id: run.runId, agent: run.agent, purpose: outsideWords(state, venture, run.purpose), state: run.state, startedAt: run.startedAt })) },
    figures: list.flatMap(run => (run.receiptId ? stored(fresh, run.receiptId, label(state, venture, run.purpose, purpose => `Result of "${purpose}"`, 'Result of a run')) : [])),
  };
};

const team: Tool = async (deps, ctx, state, venture) => {
  const view = await teamListHandler(deps, ctx, {});
  const figures: ToolFigure[] = [];
  const fresh = deps.store.read();
  for (const department of view.departments ?? []) {
    figures.push(...stored(fresh, department.spendThisMonth.receiptId, `${department.name}: AI spend this month`));
    figures.push(...stored(fresh, department.doneThisWeek.receiptId, `${department.name}: jobs done this week`));
  }
  if (view.totals) {
    figures.push(...stored(fresh, view.totals.spendThisMonth.receiptId, 'The team: AI spend this month'));
    figures.push(...stored(fresh, view.totals.doneThisWeek.receiptId, 'The team: jobs done this week'));
  }
  return {
    data: {
      agents: view.agents.map(agent => ({ id: agent.id, name: agent.name, kind: agent.kind ?? 'agent', department: agent.department ?? null, state: agent.state ?? null, now: outsideWords(state, venture, agent.now) })),
      departments: (view.departments ?? []).map(department => ({ id: department.id, name: department.name, ...department.counts })),
    },
    figures,
  };
};

const money: Tool = async (deps, ctx, state, venture) => {
  const figures: ToolFigure[] = [];
  const overview = await moneyOverview(deps, ctx, {});
  let fresh = deps.store.read();
  for (const line of overview.lines) figures.push(...stored(fresh, line.receiptId, line.label).map(item => ({ ...item, display: line.value })));
  for (const [period, words] of [['this-month', 'this month'], ['last-month', 'last month']] as const) {
    const books = await booksSummary(deps, ctx, { period });
    for (const item of books.figures) figures.push({ receiptId: item.receiptId, key: item.operation, label: `${item.label}, ${words}`, display: item.display });
  }
  const goal = await goalView(deps, ctx, null);
  fresh = deps.store.read();
  const goalFigures: [string, { receiptId: string | null; display: string } | null][] = [
    ['The goal this month', goal.goal], ['Invoiced this month, before tax', goal.invoiced], ['Ready to issue', goal.ready],
    ['Still to invoice for the goal', goal.stillToInvoice], ['Received so far this month', goal.receivedSoFar],
  ];
  for (const [label, item] of goalFigures) if (item?.receiptId) figures.push(...stored(fresh, item.receiptId, label));
  const open = (await listInvoices(deps, ctx, {})).filter(invoice => (invoice.status === 'issued' || invoice.status === 'part-paid') && invoice.number !== null);
  for (const invoice of open) figures.push(...stored(fresh, invoice.priceReceiptId, `Invoice ${invoice.number} total`));
  return {
    data: {
      month: goal.month, goalSet: goal.state === 'set', daysLeft: goal.daysLeft,
      openInvoices: open.map(invoice => ({ id: invoice.id, number: invoice.number, client: outsideWords(state, venture, clientNameFor(state, venture.id, invoice.orderId)), dueDate: invoice.dueDate, status: invoice.status })),
    },
    figures,
  };
};

const clients: Tool = async (deps, ctx, state, venture) => {
  const rows = await listClients(deps, ctx, {});
  const fresh = deps.store.read();
  const offers = new Map((acceptedBlueprintOrNull(fresh, venture)?.offers ?? []).map(offer => [offer.id, offer.name.value]));
  const orders = listRecords(fresh, 'venture-order', venture.id).filter(order => order.status === 'open' || order.status === 'delivered');
  const figures: ToolFigure[] = [];
  for (const row of rows) if (row.owed) figures.push(...stored(fresh, row.owed.receiptId, label(state, venture, row.name, name => `${name} owes`, 'A client owes')));
  for (const order of orders) {
    figures.push(...stored(fresh, order.priceReceiptId, label(state, venture, clientNameFor(fresh, venture.id, order.id), name => `Order total for ${name}`, 'Order total for a client')));
  }
  return {
    data: {
      clients: rows.map(row => ({ id: row.id, name: outsideWords(state, venture, row.name) })),
      orders: orders.map(order => ({ id: order.id, client: outsideWords(state, venture, clientNameFor(fresh, venture.id, order.id)), offer: outsideWords(state, venture, offers.get(order.offerId)), status: order.status, at: order.at })),
    },
    figures,
  };
};

/** The offer's price receipt for the plan as it is now, at the offer's usual quantity, or undefined. */
function offerReceipt(state: State, venture: VentureRecord, plan: BlueprintRecord, offer: Offer): PriceReceiptRecord | undefined {
  return listRecords(state, 'venture-price-receipt', venture.id).find(receipt => receipt.subject.type === 'offer' && receipt.subject.offerId === offer.id
    && receipt.inputs.blueprintDigest === plan.digest && receipt.inputs.quantity === offer.pricing.defaultQuantity && !receipt.stale);
}

/**
 * The plan: its offers with their ids and units, and for every priced offer a price receipt built the way
 * venture.price.quote builds one (the unit price and the total at the offer's usual quantity), made once per version of
 * the plan and served again after that, so "what do I charge for this" always has a receipted answer.
 */
const plan: Tool = async (deps, ctx, state, venture) => {
  const blueprint = latestBlueprint(listRecords(state, 'venture-blueprint', venture.id));
  const priced = (blueprint?.offers ?? []).filter(offer => offer.pricing.unitPriceMinor !== null);
  if (blueprint && priced.some(offer => !offerReceipt(state, venture, blueprint, offer))) {
    await ventureAction(deps, ctx, 'prepare', 'chief.plan', tx => {
      const latest = latestBlueprint(tx.list('venture-blueprint'));
      if (!latest || latest.digest !== blueprint.digest) return;
      for (const offer of latest.offers) {
        if (offer.pricing.unitPriceMinor !== null && !offerReceipt(tx.state, tx.venture!, latest, offer)) {
          buildPriceReceipt(tx, { type: 'offer', offerId: offer.id }, { quantity: offer.pricing.defaultQuantity }, latest, offer, null);
        }
      }
    });
  }
  const fresh = deps.store.read();
  const figures: ToolFigure[] = [];
  for (const offer of blueprint ? priced : []) {
    const receipt = offerReceipt(fresh, venture, blueprint!, offer);
    if (!receipt) continue;
    const name = outsideWords(state, venture, offer.name.value, 60) ?? 'An offer';
    for (const figure of receipt.figures.filter(item => item.key === 'unit' || item.key === 'total')) {
      const said = figure.key === 'unit' ? `${name}: price per ${offer.pricing.quantityUnit}` : `${name}: total for ${receipt.inputs.quantity} ${offer.pricing.quantityUnit}`;
      figures.push({ receiptId: receipt.id, key: figure.key, label: said, display: figure.display });
    }
  }
  return {
    data: {
      name: outsideWords(state, venture, blueprint?.name.value ?? venture.workingName),
      offers: (blueprint?.offers ?? []).map(offer => ({ id: offer.id, name: outsideWords(state, venture, offer.name.value), unit: offer.pricing.quantityUnit, priced: offer.pricing.unitPriceMinor !== null })),
    },
    figures,
  };
};

const journal: Tool = async (deps, ctx, state, venture) => {
  const entries = (await journalListHandler(deps, ctx, { limit: 20 })).entries;
  const fresh = deps.store.read();
  return {
    data: { entries: entries.map(entry => ({ action: entry.action, state: entry.state, at: entry.at, line: outsideWords(state, venture, entry.line) })) },
    figures: entries.flatMap(entry => stored(fresh, entry.receiptId, `Journal: ${entry.action}`)),
  };
};

const businesses: Tool = async (deps, ctx, state, venture) => {
  let refs: Awaited<ReturnType<NonNullable<VentureDeps['workspace']>['businesses']>> = [];
  try { refs = await deps.workspace?.businesses() ?? []; } catch { refs = []; }
  const open = deps.workspace?.current().id ?? null;
  // 4J6: a business that opens with this computer is read from what Chausar saved when it was last open; none is locked.
  const reads = await readSnapshots(deps);
  const saved = new Map(reads.map(read => [read.id, read]));
  const figures: ToolFigure[] = [];
  const others: Json[] = [];
  for (const ref of refs.filter(item => item.id !== open)) {
    const name = outsideWords(state, venture, ref.name ?? 'A business') ?? 'A business';
    const snapshot = ref.opens === 'with-this-computer' ? saved.get(ref.id)?.snapshot ?? null : null;
    const when = snapshot ? `as of ${asOfWords(snapshot.asOf, venture.country)}, when you last opened it` : null;
    others.push({ name, locked: ref.opens !== 'with-this-computer', ...(snapshot ? { saved: { when, invoicesLate: snapshot.money?.late ?? null, ...snapshot.runs, needsYou: snapshot.needsYou } } : {}) });
    if (snapshot?.money) figures.push(...savedFigures(await savedReceipts(deps, ctx, venture, snapshot), snapshot, name, when!));
  }
  return { data: { line: reads.length ? SNAPSHOT_LINE : OPEN_ONLY_LINE, others }, figures };
};

/** What a saved summary's figures are, for the chief: each with its receipt here and when it was saved. */
const SAVED_LABELS: Readonly<Record<AcrossFigureId, string>> = Object.freeze({
  invoiced: 'invoiced this month', received: 'received this month', owed: 'clients owe', spend: 'AI and tools this month',
});
function savedFigures(receipts: Record<AcrossFigureId, string>, snapshot: BusinessSnapshot, name: string, when: string): ToolFigure[] {
  return (['invoiced', 'received', 'owed', 'spend'] as const).map(what => ({
    receiptId: receipts[what], key: 'total', label: `${name}: ${SAVED_LABELS[what]}, ${when}`, display: snapshot.money![what].display,
  }));
}

/**
 * 4J6 (4C1 item 6): the chief's answer about another business that opens with this computer, written by code from what
 * Chausar saved when it was last open: every figure with its receipt here and when it was saved. One never saved, or
 * that could not be read, says so; where this host keeps no summaries, null (the chief reads the open business only).
 */
export async function savedAnswer(deps: VentureDeps, ctx: Context, businessId: string, name: string): Promise<ChatPart[] | null> {
  const read = (await readSnapshots(deps)).find(item => item.id === businessId);
  if (!read) return null;
  const snapshot = read.snapshot;
  if (read.read === 'unreadable') return [{ kind: 'text', text: `${unreadableLine(name)} Open it to ask about it.` }];
  if (!snapshot) return [{ kind: 'text', text: `Chausar has nothing saved about ${name} yet. Open it once to ask about it.` }];
  const { venture } = readAs(deps, ctx, 'read');
  const parts: ChatPart[] = [{ kind: 'text', text: `${name}, as of ${asOfWords(snapshot.asOf, venture.country)}, when you last opened it:` }];
  if (snapshot.money) {
    const receipts = await savedReceipts(deps, ctx, venture, snapshot);
    for (const what of ['invoiced', 'received', 'owed', 'spend'] as const) {
      const words = SAVED_LABELS[what];
      parts.push({ kind: 'text', text: `${words[0].toUpperCase()}${words.slice(1)}` }, { kind: 'figure', receiptId: receipts[what], key: 'total', display: snapshot.money[what].display });
    }
  } else parts.push({ kind: 'text', text: 'It was still being set up then.' });
  const counts = [
    ...(snapshot.money ? [`${snapshot.money.late} ${snapshot.money.late === 1 ? 'invoice' : 'invoices'} late`] : []),
    `${snapshot.runs.working} running`, `${snapshot.runs.waiting} waiting`, ...(snapshot.runs.stopped ? [`${snapshot.runs.stopped} stopped`] : []),
    `${snapshot.needsYou} ${snapshot.needsYou === 1 ? 'needs' : 'need'} you`,
  ];
  parts.push({ kind: 'text', text: `${counts.join(', ')}. Open ${name} to see its own receipts.` });
  return parts;
}

/**
 * 4C2 review: the ways to earn (core's listWays, 4J8), so a question such as "Which way fits 5 hours a week?" is answered
 * from them: each way's hours a week are a model estimate, given as words and as the range's ends; no figures, since no
 * amount here has a receipt (what clients pay is left out for that reason). Read only.
 */
const ways: Tool = async deps => {
  const listed = await listedWays(deps);
  if (!listed) return { data: { line: 'Chausar lists no ways to earn here yet.', ways: [] }, figures: [] };
  return {
    data: {
      line: 'Hours a week are model estimates.',
      ways: listed.ways.map(way => ({
        id: way.id, label: way.label, category: way.category, hours: way.hours, minHours: way.minHours, maxHours: way.maxHours,
        youDo: way.youDo, team: way.team.map(member => member.role), yours: way.yours.length > 0,
      })),
    },
    figures: [],
  };
};

const TOOLS: Readonly<Record<string, Tool>> = Object.freeze({ queue, runs, team, money, clients, plan, journal, businesses, ways });

/** Runs one read tool by name: its facts and figures, TOOL_NOT_ALLOWED for a name it does not know, or the refusal it met. */
export async function runTool(deps: VentureDeps, ctx: Context, name: string): Promise<ToolResult> {
  const tool = Object.hasOwn(TOOLS, name) ? TOOLS[name] : undefined;
  if (!tool) return { tool: name, error: 'TOOL_NOT_ALLOWED', line: TOOL_NOT_ALLOWED_LINE };
  const { state, venture } = readAs(deps, ctx, 'read');
  try {
    const read = await tool(deps, ctx, state, venture);
    return { tool: name, data: read.data, figures: read.figures };
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    if (typeof code !== 'string' || !/^[A-Z_]{1,64}$/.test(code)) throw error;
    return { tool: name, error: code, line: short((error as Error).message, 200) };
  }
}
