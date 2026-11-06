// Chausar venture launcher, money across businesses (Ink v2 wave 4, package 4J6): the open business's summary for the
// others on this computer, and venture.money.across. Each business keeps its own encrypted vault and only one opens at
// a time, so the others are read from the summary the engine saved when each was last open (workspace-snapshots.ts),
// every figure "as of" then. A summary holds totals and counts only: never a client's name, a title or a message.
// Figures of another business get a receipt here that says what was saved and when (subject 'across'); its own
// receipts open only after switching to it. A total adds only one currency, in BigInt from the minor amounts, and
// says which businesses it left out and why. A business that opens with a passphrase shows nothing.
import type { Context, State } from '../../contracts.ts';
import type {
  AcrossFigureId, AcrossLeftOut, AcrossLineKey, AcrossMoneyView, BusinessSnapshot, BusinessSnapshotRead, Display, SnapshotFigure, VentureDeps, VentureRecord,
} from '../contracts.ts';
import { currentVenture, exactPayload, readVenture } from '../records.ts';
import { pickPlaybook } from '../playbooks/registry.ts';
import { blocklistOf } from '../network/pipeline.ts';
import { runsListHandler } from '../views/runs.ts';
import { queueListHandler } from '../views/queue.ts';
import { calendarMonth, todayLocal } from './dates.ts';
import { lateOf } from './aging.ts';
import { invoicedPlan, monthWords } from './goal-plans.ts';
import { openInvoices, owedPlan, planTotal, receivedPlan, spentPlan, sumReceipt, type SumPlan } from './sums.ts';
import { acrossPlan, asOfWords, type AcrossSubject } from './across-plan.ts';
import { rupeeFigure, rupeeRateShort, rupeeRateWords, rupeesOf, spendLead } from './spend.ts';

export { asOfWords } from './across-plan.ts';

export const OPEN_LINE = 'Open now.';
export const NO_COUNTRY_LINE = 'Finish setting up this business to see its money here.';
/** What a row says about a business it cannot show, by why. */
export const lockedLine = (name: string) => `${name} is locked with a passphrase, so Chausar shows nothing about it until you open it.`;
export const keyMissingLine = (name: string) => `${name} can't open with this computer right now, so Chausar shows nothing about it until you open it.`;
export const unreadableLine = (name: string) => `Couldn't read what Chausar saved about ${name}.`;
export const noneLine = (name: string) => `Chausar has nothing saved about ${name} yet. Open it once and it shows here.`;
export const asOfLine = (when: string) => `As of ${when}, when you last opened it.`;
export const SETTING_UP_LINE = 'It was still being set up then.';

/** The other businesses as their summaries read, the open one left out; none without the host's port (the hosted app). */
export async function readSnapshots(deps: VentureDeps): Promise<BusinessSnapshotRead[]> {
  let reads: BusinessSnapshotRead[] = [];
  try { reads = await deps.workspace?.snapshots?.() ?? []; } catch { reads = []; }
  const open = deps.workspace?.current().id ?? null;
  return reads.filter(read => read.id !== open);
}

/** The name a row shows for another business: its saved name, else the one its card lists. */
export const nameOf = (read: BusinessSnapshotRead): string => read.snapshot?.name ?? read.name ?? 'A business';

/** What a row says when it cannot show a business, with its key; null when it shows its summary. */
export function withheld(read: BusinessSnapshotRead): { line: string; key: AcrossLineKey; why: AcrossLeftOut['why'] } | null {
  const name = nameOf(read);
  if (read.read === 'locked') return read.opens === 'key-missing' ? { line: keyMissingLine(name), key: 'key-missing', why: 'key-missing' } : { line: lockedLine(name), key: 'locked', why: 'locked' };
  if (read.read === 'unreadable') return { line: unreadableLine(name), key: 'unreadable', why: 'unreadable' };
  if (read.read === 'none' || !read.snapshot) return { line: noneLine(name), key: 'none', why: 'none' };
  return null;
}

/** Why a business is not counted, in a few words. */
function whyWords(item: AcrossLeftOut): string {
  if (item.why === 'locked' || item.why === 'key-missing') return 'locked';
  if (item.why === 'unreadable') return 'could not be read';
  if (item.why === 'none') return 'nothing saved yet';
  if (item.why === 'setting-up') return 'still being set up';
  return `saved in ${monthWords(item.month ?? '')}`;
}
/** ' Not counted: Sitara Events (locked), Neon Desk (saved in September 2026).' or nothing. */
export function notCountedWords(items: readonly AcrossLeftOut[]): string {
  return items.length ? ` Not counted: ${items.map(item => `${item.name} (${whyWords(item)})`).join(', ')}.` : '';
}

// ---------------------------------------------------------------------------
// The open business's summary
// ---------------------------------------------------------------------------

/** A figure as the summary keeps it: the plan's total with the receipt that holds it. */
async function kept(deps: VentureDeps, ctx: Context, venture: VentureRecord, plan: SumPlan): Promise<SnapshotFigure> {
  const receipt = await sumReceipt(deps, ctx, venture.id, plan);
  return { amount: String(planTotal(plan)), unit: plan.unit === 'micros' ? 'micros' : 'minor', currency: plan.currency, display: receipt.figures[0].display, receiptId: receipt.id };
}

/** Runs now, as Work counts them: working, waiting on the owner, and stopped (by the owner or a breaker). */
export async function runCounts(deps: VentureDeps, ctx: Context): Promise<BusinessSnapshot['runs']> {
  const runs = (await runsListHandler(deps, ctx, { state: 'active' })).runs;
  const stopped = runs.filter(run => run.stop?.state === 'stopped').length;
  return {
    working: runs.filter(run => run.state === 'active').length,
    waiting: runs.filter(run => run.state === 'waiting' && run.stop?.state !== 'stopped').length,
    stopped,
  };
}

/**
 * The open business's summary for the others on this computer (the engine adds its folder and vault id and saves it),
 * and the addresses its own blocklist keeps out (whole emails, phones and LinkedIn pages: a blocked domain stays its own
 * rule), which the engine adds to the shared never-contact list as keyed checks. Null without a business. Reads only;
 * the sums it adds up may write their receipts, as every Money read does.
 */
export async function businessSnapshot(deps: VentureDeps, ctx: Context): Promise<{ snapshot: Omit<BusinessSnapshot, 'format' | 'businessId' | 'vaultId'>; neverContact: string[] } | null> {
  const state = deps.store.read();
  const venture = currentVenture(state);
  if (!venture) return null;
  const runs = await runCounts(deps, ctx);
  const needsYou = (await queueListHandler(deps, ctx, {})).needsYou;
  const blocklist = blocklistOf(state, venture.id);
  const neverContact = [...new Set([...blocklist.emails, ...(blocklist.handles ?? [])])].sort();
  return {
    snapshot: {
      name: venture.workingName, playbook: pickPlaybook(venture.idea)?.id ?? null, asOf: deps.clock().toISOString(),
      money: venture.country ? await moneyNow(deps, ctx, state, venture) : null, runs, needsYou,
    },
    neverContact,
  };
}

/** The money part of a summary: this month on the business's own calendar, owed and late as of today, AI spend this UTC month. */
async function moneyNow(deps: VentureDeps, ctx: Context, state: State, venture: VentureRecord): Promise<NonNullable<BusinessSnapshot['money']>> {
  const today = todayLocal(deps.clock, venture.country);
  const month = today.slice(0, 7), period = calendarMonth(month), currency = venture.country.currency;
  return {
    month, currency,
    invoiced: await kept(deps, ctx, venture, invoicedPlan(state, venture, { type: 'invoiced', month, which: 'issued' })),
    received: await kept(deps, ctx, venture, receivedPlan(state, venture, period.from, period.to)),
    owed: await kept(deps, ctx, venture, owedPlan(state, venture, null)),
    late: openInvoices(state, venture.id).filter(invoice => invoice.currency === currency && lateOf(invoice, today) !== null).length,
    spend: await kept(deps, ctx, venture, spentPlan(state, venture, deps.clock().toISOString().slice(0, 7))),
  };
}

// ---------------------------------------------------------------------------
// The 'across' receipt
// ---------------------------------------------------------------------------

/** A receipt here for one figure another business's summary saved. */
async function savedReceipt(deps: VentureDeps, ctx: Context, venture: VentureRecord, snapshot: BusinessSnapshot, what: AcrossFigureId): Promise<string> {
  const money = snapshot.money!;
  const figure = money[what];
  const subject: AcrossSubject = {
    type: 'across', what, month: what === 'owed' ? null : what === 'spend' ? snapshot.asOf.slice(0, 7) : money.month, currency: figure.currency, open: false,
    others: [{ businessId: snapshot.businessId, name: snapshot.name, asOf: snapshot.asOf, amount: figure.amount }],
  };
  return (await sumReceipt(deps, ctx, venture.id, acrossPlan(deps.store.read(), venture, subject))).id;
}

/** The receipts here for each figure of another business's summary. */
export async function savedReceipts(deps: VentureDeps, ctx: Context, venture: VentureRecord, snapshot: BusinessSnapshot): Promise<Record<AcrossFigureId, string>> {
  return {
    invoiced: await savedReceipt(deps, ctx, venture, snapshot, 'invoiced'), received: await savedReceipt(deps, ctx, venture, snapshot, 'received'),
    owed: await savedReceipt(deps, ctx, venture, snapshot, 'owed'), spend: await savedReceipt(deps, ctx, venture, snapshot, 'spend'),
  };
}

// ---------------------------------------------------------------------------
// venture.money.across
// ---------------------------------------------------------------------------

type MoneyRow = AcrossMoneyView['businesses'][number];

/** A list in words: 'A', 'A and B', 'A, B and C'. */
export function listWords(items: readonly string[]): string {
  return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

/**
 * venture.money.across {} (read): the open business live, with its own receipts, then every other business on this
 * computer from its summary, "as of" when it was saved, with a receipt here for each figure. The total is what was
 * invoiced this month before tax (the open business's calendar month, or the UTC month while it has no country yet),
 * only when every business it counts bills in one currency, added in BigInt from the minor amounts, with a receipt that
 * lists each business's part; a summary from another month, a locked business and one that could not be read are left
 * out, and the line names them. On the hosted app only the open business shows.
 */
export async function moneyAcross(deps: VentureDeps, ctx: Context, payload: unknown): Promise<AcrossMoneyView> {
  exactPayload(payload, []);
  const { state, venture } = readVenture(deps, ctx);
  const businessId = deps.workspace?.current().id ?? 'open';
  // 4J20: each business's AI spend also in rupees at the owner's own rate (this business's), as Team's spend is (4A2).
  const rupees = venture.country ? rupeesOf(state, venture) : null;
  // 4Z3: and the spend as the owner's currency leads it, two decimals of dollars at most. A saved summary of another
  // business carries no rate or country (chausar.snapshot.v1), so its spend leads by the open business's choice and
  // rate, and its line says so rather than pass that rate off as its own.
  const inRupees = (spend: SnapshotFigure | undefined, open = true) => {
    if (!spend || spend.unit !== 'micros') return {};
    const lead = spendLead(spend.amount, rupees);
    const borrowed = !open && rupees && lead.other ? { ...lead, beside: `${lead.other} at the open business's rate, ${rupeeRateShort(rupees)}` } : lead;
    return { ...(rupees ? { spendRupees: rupeeFigure(spend.amount, rupees), spendRate: rupeeRateWords(rupees) } : {}), spendLead: borrowed };
  };
  const own = await businessSnapshot(deps, ctx);
  const money = own?.snapshot.money ?? null;
  const month = money?.month ?? deps.clock().toISOString().slice(0, 7);
  const rows: MoneyRow[] = [{
    businessId, name: venture.workingName, open: true, locked: false, asOf: null, line: money ? OPEN_LINE : NO_COUNTRY_LINE, lineKey: money ? 'open' : 'no-country',
    invoiced: money?.invoiced.display ?? null, received: money?.received.display ?? null, owed: money?.owed.display ?? null,
    late: money?.late ?? null, spend: money?.spend.display ?? null, ...inRupees(money?.spend),
    ...(money ? { receipts: { invoiced: money.invoiced.receiptId, received: money.received.receiptId, owed: money.owed.receiptId, spend: money.spend.receiptId } } : {}),
  }];
  const counted: BusinessSnapshot[] = [];
  const left: AcrossLeftOut[] = [];
  for (const read of await readSnapshots(deps)) {
    const name = nameOf(read), hidden = withheld(read), snapshot = read.snapshot;
    if (hidden || !snapshot) {
      const shown = hidden ?? { line: noneLine(name), key: 'none' as const, why: 'none' as const };
      rows.push({ businessId: read.id, name, open: false, locked: read.read === 'locked', asOf: null, line: shown.line, lineKey: shown.key, invoiced: null, received: null, owed: null, late: null, spend: null });
      left.push({ businessId: read.id, name, why: shown.why, month: null });
      continue;
    }
    const line = asOfLine(asOfWords(snapshot.asOf, venture.country));
    const saved = snapshot.money;
    rows.push({
      businessId: read.id, name, open: false, locked: false, asOf: snapshot.asOf, line: saved ? line : `${line} ${SETTING_UP_LINE}`, lineKey: saved ? 'as-of' : 'as-of-setting-up',
      invoiced: saved?.invoiced.display ?? null, received: saved?.received.display ?? null, owed: saved?.owed.display ?? null,
      late: saved?.late ?? null, spend: saved?.spend.display ?? null, ...inRupees(saved?.spend, false),
      ...(saved ? { receipts: await savedReceipts(deps, ctx, venture, snapshot) } : {}),
    });
    if (!saved) left.push({ businessId: read.id, name, why: 'setting-up', month: null });
    else if (saved.month !== month) left.push({ businessId: read.id, name, why: 'other-month', month: saved.month });
    else counted.push(snapshot);
  }
  const notCounted = notCountedWords(left);
  const currencies = [...new Set([...(money ? [money.currency] : []), ...counted.map(snapshot => snapshot.money!.currency)])].sort();
  const parts = (money ? 1 : 0) + counted.length;
  const base = { businesses: rows, month, counted: parts, currencies, notCounted: left };
  if (!currencies.length) return { ...base, total: null, lineKey: 'nothing', line: `Nothing to add up yet.${notCounted}` };
  if (currencies.length > 1) return { ...base, total: null, lineKey: 'currencies', line: `Your businesses bill in ${listWords(currencies)}, so Chausar does not add them together.${notCounted}` };
  const subject: AcrossSubject = {
    type: 'across', what: 'invoiced', month, currency: currencies[0], open: !!money,
    others: counted.map(snapshot => ({ businessId: snapshot.businessId, name: snapshot.name, asOf: snapshot.asOf, amount: snapshot.money!.invoiced.amount })),
  };
  const receipt = await sumReceipt(deps, ctx, venture.id, acrossPlan(deps.store.read(), venture, subject));
  const line: Display = `Invoiced in ${monthWords(month)} ${parts === 1 ? 'in 1 business' : `across ${parts} businesses`}.${notCounted}`;
  return { ...base, total: { display: receipt.figures[0].display, receiptId: receipt.id }, lineKey: 'counted', line };
}
