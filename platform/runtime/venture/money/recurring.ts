// Chausar venture launcher, money (Ink v2 wave 4, package 4J5, M12): recurring invoices for retainers, and the engine's
// schedule run. venture.invoice.recurring sets one schedule per client and offer (monthly, or quarterly, which bills a
// monthly offer 3 months at a time), from today or later, with an optional end and the days late its reminders are due
// on. Each due date makes an order and its draft invoice, dated that day, which waits on Today for the owner to issue:
// never issued by itself. runMoneySchedules drafts what is due, catching up missed days with each draft dated its own
// day, and drafts repeating bills (bills.ts); the journal sweep (build/journal-sweep.ts) runs it when a vault opens and
// every few minutes, and a schedule that cannot draft (no price, no plan) waits, saying why, and is tried again.
import { check, type Context, type State } from '../../contracts.ts';
import {
  activateTerm, currentVenture, exactPayload, formatVentureDate, isoDate, listRecords, readVenture, requireAppChannel, ventureAction, type VentureTx,
} from '../records.ts';
import { localDayAt } from '../local-day.ts';
import { flagshipOffer, flagshipPlan } from '../playbooks/plan.ts';
import { orderIntake } from '../playbooks/intake.ts';
import {youtubeServiceOffer} from '../playbooks/youtube/service-offer.ts';
import {requireYoutubeServiceBinding} from '../playbooks/youtube/service-binding.ts';
import { draftDueBillsIn, repeatingBillsDue } from './bills.ts';
import { draftInvoiceIn } from './invoices.ts';
import { buildPriceReceipt } from './quote.ts';
import { scheduleDate } from './schedule.ts';
import { oneLine, recordId, requireAcceptedBlueprint, requireOffer, requirePrice } from './shared.ts';
import type { Offer, OrderRecord, RecurringInvoiceRecord, RecurringInvoicesView, RecurringInvoiceView, VentureDeps, VentureRecord } from '../contracts.ts';

/** The most drafts one schedule makes in one run, so a long-closed app catches up a year at most. */
const MAX_CATCH_UP = 12;
/** Days until each drafted invoice is due, as a prepared invoice's default. */
const DUE_IN_DAYS = 15;
const MAX_REMINDER_DAYS = 6;

/** A monthly offer billed every 3 months is 3 months each; every other offer its own default quantity. */
function quantityFor(offer: Offer, frequency: RecurringInvoiceRecord['frequency']): string {
  return offer.pricing.quantityUnit === 'month' && frequency === 'quarterly' ? '3' : offer.pricing.defaultQuantity;
}

/** The drafts a schedule made since its start. */
function madeSince(schedule: RecurringInvoiceRecord): number {
  return (schedule.made ?? []).filter(item => item.on >= schedule.startOn).length;
}

/** The schedule's next date after k drafts since its start, or null past its end. */
function nextAfter(schedule: Pick<RecurringInvoiceRecord, 'startOn' | 'frequency' | 'end'>, day: string | null): string | null {
  // The schedule's first date after a day, its start when nothing was drafted since it: a changed frequency or end never
  // drafts a period twice, and the day of the month stays the start's.
  let k = 0;
  let next = scheduleDate(schedule.startOn, schedule.frequency, 0);
  while (day !== null && next <= day && k < 1200) next = scheduleDate(schedule.startOn, schedule.frequency, ++k);
  return schedule.end !== null && next > schedule.end ? null : next;
}

/** The last day a schedule drafted for since its start, or null. */
function lastDrafted(made: RecurringInvoiceRecord['made'], startOn: string): string | null {
  const since = (made ?? []).map(item => item.on).filter(on => on >= startOn).sort();
  return since.length ? since[since.length - 1] : null;
}

/** Why a schedule cannot draft now, in the owner's words, or null. Reads only. */
function blockedBy(state: State, venture: VentureRecord, schedule: RecurringInvoiceRecord): string | null {
  const plan = listRecords(state, 'venture-blueprint', venture.id).find(item => item.id === venture.acceptedBlueprintId && item.status === 'accepted');
  if (!plan) return 'Accept your plan first.';
  if (!listRecords(state, 'venture-client', venture.id).some(item => item.id === schedule.clientId)) return 'The client was not found.';
  const offer = plan.offers.find(item => item.id === schedule.offerId);
  if (!offer) return 'Your plan has no such offer now.';
  return offer.pricing.unitPriceMinor === null ? `Set your price for ${oneLine(offer.name.value)} first.` : null;
}

/** One schedule as the screens show it, in the engine's words. */
export function recurringView(state: State, venture: VentureRecord, schedule: RecurringInvoiceRecord, today: string): RecurringInvoiceView {
  const date = (iso: string) => formatVentureDate(iso, venture.country.dateOrder);
  const plan = listRecords(state, 'venture-blueprint', venture.id).find(item => item.id === venture.acceptedBlueprintId);
  const offer = plan?.offers.find(item => item.id === schedule.offerId);
  const client = listRecords(state, 'venture-client', venture.id).find(item => item.id === schedule.clientId);
  const every = schedule.frequency === 'monthly' ? 'every month' : 'every 3 months';
  const until = schedule.end === null ? '' : ` until ${date(schedule.end)}`;
  const each = offer && schedule.frequency === 'quarterly' && offer.pricing.quantityUnit === 'month' ? ', 3 months each' : '';
  const blocked = schedule.nextOn !== null && schedule.nextOn <= today ? blockedBy(state, venture, schedule) : null;
  const tail = schedule.nextOn === null ? `Finished: ${(schedule.made ?? []).length} drafted.`
    : blocked ? `The draft for ${date(schedule.nextOn)} cannot be made yet: ${blocked}`
      : `Next draft on ${date(schedule.nextOn)}, for you to check and issue.`;
  const what = offer ? oneLine(offer.name.value) : 'An offer no longer in your plan';
  return {
    id: schedule.id, clientId: schedule.clientId, offerId: schedule.offerId, frequency: schedule.frequency, startOn: schedule.startOn,
    end: schedule.end, nextOn: schedule.nextOn, line: `${what} for ${client?.name ?? 'a client'}, ${every} from ${date(schedule.startOn)}${until}${each}. ${tail}`,
  };
}

/** The order one due date makes: the schedule's client and offer, priced by its own receipt at the plan's price now. */
function orderIn(tx: VentureTx, deps: VentureDeps, schedule: RecurringInvoiceRecord, on: string): OrderRecord {
  const venture = tx.venture;
  check(venture, 'VENTURE_NOT_FOUND', 'Start a business first.');
  const blueprint = requireAcceptedBlueprint(venture, tx.list('venture-blueprint'));
  const client = tx.find('venture-client', schedule.clientId);
  check(client, 'CLIENT_NOT_FOUND', 'The client of this schedule was not found.');
  const offer = requireOffer(blueprint, schedule.offerId);
  requirePrice(offer);
  requireYoutubeServiceBinding(tx.state,venture,offer);
  const intake = orderIntake(undefined, youtubeServiceOffer(flagshipPlan(venture.idea),offer)??flagshipOffer(flagshipPlan(venture.idea), offer), { by: tx.ctx.memberId, at: tx.now, today: localDayAt(tx.now, venture.country), host: deps.host });
  const base = tx.base('venture-order');
  const quantity = quantityFor(offer, schedule.frequency);
  const taxInclusive = schedule.taxInclusive === true;
  const receipt = buildPriceReceipt(tx, { type: 'order', orderId: base.id }, { quantity, taxInclusive }, blueprint, offer, client);
  const order = tx.put<OrderRecord>({
    ...base, clientId: client.id, offerId: offer.id, quantity, status: 'open', priceReceiptId: receipt.id, deliveredOn: null, saleFactId: null,
    request: `From your ${schedule.frequency} schedule: ${oneLine(offer.name.value)}, dated ${formatVentureDate(on, venture.country.dateOrder)}.`,
    ...(intake ? { intake } : {}), ...(taxInclusive ? { taxInclusive: true } : {}),
  });
  activateTerm(tx, 'order', { recordId: order.id, kind: 'venture-order' });
  tx.emit('order-created', { orderId: order.id });
  return order;
}

/** Inside a venture transaction: drafts one schedule's due dates up to a day. Answers how many it drafted. */
function draftScheduleIn(tx: VentureTx, deps: VentureDeps, scheduleId: string, today: string): number {
  let schedule = tx.find('venture-recurring-invoice', scheduleId);
  check(schedule, 'INVALID_VENTURE_REQUEST', 'This schedule was not found.');
  let drafted = 0;
  for (let count = 0; count < MAX_CATCH_UP && schedule.stoppedAt === null && schedule.nextOn !== null && schedule.nextOn <= today; count++) {
    const on: string = schedule.nextOn;
    let made: NonNullable<RecurringInvoiceRecord['made']> = schedule.made ?? [];
    if (!made.some(item => item.on === on)) {
      const order = orderIn(tx, deps, schedule, on);
      const invoice = draftInvoiceIn(tx, { orderId: order.id, dueInDays: DUE_IN_DAYS, issueDate: on });
      made = [...made, { on, orderId: order.id, invoiceId: invoice.id }];
      drafted++;
    }
    schedule = tx.replace<RecurringInvoiceRecord>({ ...schedule, made, nextOn: nextAfter(schedule, on) });
  }
  if (drafted) tx.emit('queue.changed', { recurringId: scheduleId });
  return drafted;
}

/** The days late a schedule's reminders are due on: 1 to 6 whole days from 1 to 365, each later than the one before. */
function reminderDaysInput(value: unknown): number[] {
  check(Array.isArray(value) && value.length >= 1 && value.length <= MAX_REMINDER_DAYS
    && value.every((day, index) => Number.isInteger(day) && day >= 1 && day <= 365 && (index === 0 || day > value[index - 1])),
  'INVALID_VENTURE_REQUEST', `Pick 1 to ${MAX_REMINDER_DAYS} reminder days from 1 to 365 days late, each later than the one before.`);
  return [...value as number[]];
}

/**
 * venture.invoice.recurring { clientId, offerId, frequency, startOn, end?, reminderDays?, taxInclusive? } (approve, app
 * only): sets the schedule for a client and an offer, or changes the one they have. A schedule that starts today
 * drafts today's invoice at once; nothing is ever issued by itself.
 */
export async function recurringSet(deps: VentureDeps, ctx: Context, payload: unknown): Promise<{ recurring: RecurringInvoiceView }> {
  requireAppChannel(ctx, 'venture.invoice.recurring');
  const body = exactPayload(payload, ['clientId', 'offerId', 'frequency', 'startOn', 'end', 'reminderDays', 'taxInclusive'], ['clientId', 'offerId', 'frequency', 'startOn']);
  const clientId = recordId(body.clientId, 'Client');
  const offerId = recordId(body.offerId, 'Offer');
  check(body.frequency === 'monthly' || body.frequency === 'quarterly', 'INVALID_VENTURE_REQUEST', 'Choose monthly or quarterly.');
  const frequency = body.frequency as RecurringInvoiceRecord['frequency'];
  const startOn = isoDate(body.startOn, 'Start date');
  const end = body.end === undefined ? null : isoDate(body.end, 'End date');
  check(end === null || end >= startOn, 'INVALID_VENTURE_REQUEST', 'The end date must be on or after the start date.');
  const reminderDays = body.reminderDays === undefined ? null : reminderDaysInput(body.reminderDays);
  check(body.taxInclusive === undefined || typeof body.taxInclusive === 'boolean', 'INVALID_VENTURE_REQUEST', 'Say whether the price includes tax with true or false.');
  const taxInclusive = body.taxInclusive === true;

  return ventureAction(deps, ctx, 'approve', 'recurring.set', tx => {
    const venture = tx.venture;
    check(venture, 'VENTURE_NOT_FOUND', 'Start a business first.');
    const today = localDayAt(tx.now, venture.country);
    const existing = tx.list('venture-recurring-invoice').find(item => item.clientId === clientId && item.offerId === offerId && item.stoppedAt === null);
    // A new schedule, or a changed start, begins today or later; changing anything else keeps the running start.
    if (!existing || existing.startOn !== startOn) check(startOn >= today, 'INVALID_VENTURE_REQUEST', 'Start today or later. Draft earlier invoices one by one.');
    const blueprint = requireAcceptedBlueprint(venture, tx.list('venture-blueprint'));
    check(tx.find('venture-client', clientId), 'CLIENT_NOT_FOUND', 'Add this client first.');
    const offer = requireOffer(blueprint, offerId);
    requirePrice(offer);
    // An offer that needs something on each order (footage rights) is ordered by hand, never on a schedule.
    requireYoutubeServiceBinding(tx.state,venture,offer);
    orderIntake(undefined, youtubeServiceOffer(flagshipPlan(venture.idea),offer)??flagshipOffer(flagshipPlan(venture.idea), offer), { by: ctx.memberId, at: tx.now, today, host: deps.host });
    const fields = {
      clientId, offerId, frequency, startOn, end, nextOn: nextAfter({ startOn, frequency, end }, lastDrafted(existing?.made, startOn)), stoppedAt: null,
      ...(reminderDays ? { reminderDays } : {}), ...(taxInclusive ? { taxInclusive: true } : {}),
    };
    let stored: RecurringInvoiceRecord;
    if (existing) {
      // The changed schedule keeps what it drafted; its reminder days and tax choice are the ones given now.
      const { reminderDays: _days, taxInclusive: _inclusive, ...kept } = existing;
      stored = tx.replace<RecurringInvoiceRecord>({ ...kept, ...fields, made: existing.made ?? [] });
    } else {
      stored = tx.put<RecurringInvoiceRecord>({ ...tx.base('venture-recurring-invoice'), ...fields, made: [] });
    }
    draftScheduleIn(tx, deps, stored.id, today);
    const latest = tx.find('venture-recurring-invoice', stored.id) as RecurringInvoiceRecord;
    return { recurring: recurringView(tx.state, venture, latest, today) };
  });
}

/** venture.invoice.recurringList {} (read): every schedule, oldest first. */
export async function recurringList(deps: VentureDeps, ctx: Context, payload: unknown): Promise<RecurringInvoicesView> {
  exactPayload(payload, []);
  const { state, venture } = readVenture(deps, ctx);
  const today = localDayAt(deps.clock(), venture.country);
  return { items: listRecords(state, 'venture-recurring-invoice', venture.id).map(schedule => recurringView(state, venture, schedule, today)) };
}

/**
 * The schedule run: drafts every recurring invoice and bill that is due today on the owner's calendar or was missed.
 * Each schedule drafts in its own commit, so one that cannot (and says why on its line) never holds up the others.
 * Writes nothing when nothing is due. Never throws: the sweep that calls it stands whatever happens here.
 */
export async function runMoneySchedules(deps: VentureDeps, ctx: Context): Promise<{ invoices: number; bills: number }> {
  const done = { invoices: 0, bills: 0 };
  try {
    const state = deps.store.read();
    const venture = currentVenture(state);
    if (!venture) return done;
    const today = localDayAt(deps.clock(), venture.country);
    const due = listRecords(state, 'venture-recurring-invoice', venture.id)
      .filter(item => item.stoppedAt === null && item.nextOn !== null && item.nextOn <= today && blockedBy(state, venture, item) === null);
    for (const schedule of due) {
      try { done.invoices += await ventureAction(deps, ctx, 'prepare', 'recurring.draft', tx => draftScheduleIn(tx, deps, schedule.id, today)); } catch { /* tried again on the next sweep */ }
    }
    if (repeatingBillsDue(deps.store.read(), venture, today)) {
      try { done.bills = await ventureAction(deps, ctx, 'prepare', 'bills.repeat', tx => draftDueBillsIn(tx, today)); } catch { /* tried again on the next sweep */ }
    }
  } catch { /* nothing could be read: the next sweep looks again */ }
  return done;
}
