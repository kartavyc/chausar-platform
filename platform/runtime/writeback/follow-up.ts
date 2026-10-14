/**
 * Invoice follow-up for real customers: a reminder with the invoice link, sent once after your yes
 * through your own mail server or WhatsApp, read back, and journalled as `sent`. Whether the
 * customer pays is a separate, later fact (`paid`): only a books payment matched to one bank line.
 *
 * - Only customers who agreed on that channel are written to; the recipient is the address they
 *   agreed with, never text found in an invoice or a note.
 * - A daily cap per customer and in total, and a stop word, are enforced before preparing.
 * - The balance comes from the calculator's aging receipt; the text is a fixed template filled from
 *   that receipt. No model writes it and no model does its arithmetic.
 * - The reminder pins the evidence it was built from; if the invoice, the customer or the consent
 *   changes before dispatch, the reminder is cancelled and nothing is sent.
 */
import { canonical, current, digest } from '../actions.ts';
import type { PreparedAction } from '../actions.ts';
import { audit, authorize, check, newId } from '../contracts.ts';
import type { Context, State } from '../contracts.ts';
import { moduleState } from '../modules/types.ts';
import { initState, MODULE_ID, readState, type Consent, type Envelope, type WritebackService } from './service.ts';
import { date, email, oneOf, phone, record, rupees, text } from './validate.ts';

export const FOLLOW_UP = 'invoice-follow-up';
type Calculator = { calculate(context: Context, request: Record<string, unknown>): Promise<any> };
export type FollowUpHost = { service: WritebackService; calculator: Calculator; timeZone: string };

export function dayKey(at: string, timeZone: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(at));
}
const consentFor = (state: State, customerId: string, channel: string) => readState(state).consents.filter(c => c.customerId === customerId && c.channel === channel).at(-1);

/** The invoice's open balance from the calculator's aging receipt, and the digest the reminder pins. */
export async function invoiceEvidence(host: FollowUpHost, context: Context, input: { customerId: string; invoiceId: string; sourceIds: string[] }) {
  const at = host.service.now();
  const receipt = await host.calculator.calculate(context, { operation: 'aging', customerId: input.customerId, ...(input.sourceIds.length ? { sourceIds: input.sourceIds } : {}), asOf: at, onDate: at.slice(0, 10) });
  check(receipt && receipt.operation === 'aging' && Array.isArray(receipt.rows) && Array.isArray(receipt.definitions), 'FOLLOW_UP_EVIDENCE_MISSING', 'The balance could not be calculated.');
  const kind = (name: string) => receipt.definitions.find((d: any) => d.name === name)?.kind;
  const mine = (k: string | undefined) => k ? receipt.rows.filter((r: any) => r.kind === k && r.invoiceId === input.invoiceId && r.customerId === input.customerId) : [];
  const invoices = mine(kind('billed')), payments = mine(kind('received')), credits = mine(kind('refunds'));
  check(invoices.length === 1, 'INVOICE_LINK_REQUIRED', 'The invoice and customer must resolve to exactly one counted invoice.');
  const sum = (rows: any[]) => rows.reduce((n, row) => n + BigInt(row.amountMinor), 0n);
  const outstanding = BigInt(invoices[0].amountMinor) - sum(payments) - sum(credits);
  const state = host.service.store.read(); const fact = state.facts.find(f => f.id === invoices[0].factId);
  const link = typeof fact?.fields.invoiceLink === 'string' && /^https:\/\/[^\s]{1,500}$/.test(fact.fields.invoiceLink) ? fact.fields.invoiceLink : null;
  const dueDate = typeof fact?.fields.dueDate === 'string' && /^\d{4}-\d\d-\d\d$/.test(fact.fields.dueDate) ? fact.fields.dueDate : null;
  const pinned = { invoice: invoices.map((r: any) => [r.entityId, r.amountMinor, r.customerId]), payments: payments.map((r: any) => [r.entityId, r.amountMinor]), credits: credits.map((r: any) => [r.entityId, r.amountMinor]),
    fact: fact ? { entityId: fact.entityId, fields: fact.fields, supersededAt: fact.supersededAt } : null, completeness: receipt.coverage?.completeness ?? null };
  return { receiptId: String(receipt.id), outstandingMinor: (outstanding > 0n ? outstanding : 0n).toString(), billedMinor: String(invoices[0].amountMinor), dueDate, link, disputed: fact?.fields.disputed === true,
    incomplete: ['partial', 'empty'].includes(String(receipt.coverage?.completeness)), payments, digest: digest(pinned) };
}

export async function recordConsent(host: FollowUpHost, context: Context, input: Record<string, unknown>) {
  const p = record(input, ['requestId', 'customerId', 'channel', 'destination', 'answer', 'observedOn'], ['sourceId']);
  const channel = oneOf(p.channel, ['email', 'whatsapp'] as const);
  const consent: Consent = { id: newId('consent'), requestId: text(p.requestId, 100), customerId: text(p.customerId, 100), channel, destination: channel === 'email' ? email(p.destination) : phone(p.destination),
    answer: oneOf(p.answer, ['yes', 'no', 'not-asked', 'stopped'] as const), observedOn: date(p.observedOn), sourceId: p.sourceId === undefined ? null : text(p.sourceId, 100), recordedBy: context.memberId, at: host.service.now() };
  return host.service.store.update(state => {
    current(state, context, 'prepare'); check(!context.sourceTainted, 'TAINTED_APPROVAL', 'Imported text cannot record consent.');
    const wb = moduleState(state, MODULE_ID, initState);
    const prior = wb.consents.find(c => c.requestId === consent.requestId);
    if (prior) { check(canonical({ ...prior, id: '', at: '', recordedBy: '' }) === canonical({ ...consent, id: '', at: '', recordedBy: '' }), 'IDEMPOTENCY_CONFLICT', 'This consent request already holds a different answer.'); return structuredClone(prior); }
    wb.consents.push(consent); audit(state, 'writeback.consent', { customerId: consent.customerId, channel, answer: consent.answer });
    return structuredClone(consent);
  });
}
export function consents(host: FollowUpHost, context: Context) { authorize(host.service.store, context); return structuredClone(readState(host.service.store.read()).consents); }

const reminders = (state: State, customerId?: string) => (state.actions as PreparedAction[]).filter(a => a.connector?.startsWith('wb-') && (a.payload as any)?.evidence?.kind === FOLLOW_UP && (!customerId || (a.payload as any).evidence.detail.customerId === customerId));

/** Prepare one reminder. Refuses with a plain reason when consent, cap or evidence does not allow it. */
export async function prepareReminder(host: FollowUpHost, context: Context, input: Record<string, unknown>) {
  const p = record(input, ['connectionId', 'customerId', 'invoiceId'], ['sourceIds', 'language']);
  const customerId = text(p.customerId, 100), invoiceId = text(p.invoiceId, 100), language = p.language === undefined ? 'en' : oneOf(p.language, ['en', 'hi'] as const);
  const sourceIds = p.sourceIds === undefined ? [] : (check(Array.isArray(p.sourceIds) && p.sourceIds.length <= 20, 'INVALID_SOURCES', 'Source IDs are a list.'), p.sourceIds.map(s => text(s, 100)));
  const state = host.service.store.read(); current(state, context, 'prepare');
  const connection = readState(state).connections.find(c => c.id === p.connectionId && !c.revokedAt);
  check(connection && (connection.system === 'mail' || connection.system === 'whatsapp'), 'FOLLOW_UP_CHANNEL_UNSUPPORTED', 'Reminders go through your mail server or WhatsApp.');
  const channel = connection.system === 'mail' ? 'email' : 'whatsapp';
  const consent = consentFor(state, customerId, channel);
  check(consent?.answer !== 'stopped', 'FOLLOW_UP_STOPPED', 'No reminder: this customer asked to stop.');
  check(consent?.answer === 'yes', 'FOLLOW_UP_NO_CONSENT', 'No reminder: this customer has not agreed to reminders.');
  const settings = readState(state).settings, today = dayKey(host.service.now(), host.timeZone);
  const live = (a: PreparedAction) => !['cancelled', 'rejected'].includes(a.status) && (a.payload as any).evidence.detail.day === today;
  check(reminders(state, customerId).filter(live).length < settings.reminderCapPerCustomer, 'FOLLOW_UP_DAILY_CAP', 'This customer already has a reminder today.');
  check(reminders(state).filter(live).length < settings.reminderCapPerDay, 'FOLLOW_UP_DAILY_CAP', 'Today\'s reminder limit is reached.');
  const evidence = await invoiceEvidence(host, context, { customerId, invoiceId, sourceIds });
  check(!evidence.disputed && !evidence.incomplete, 'FOLLOW_UP_NEEDS_REVIEW', 'This invoice is disputed or its records are incomplete. Look at it first.');
  check(BigInt(evidence.outstandingMinor) > 0n, 'FOLLOW_UP_NOTHING_DUE', 'Nothing is due on this invoice.');
  const amount = `₹${rupees(evidence.outstandingMinor)}`;
  const lines = language === 'hi'
    ? [`नमस्ते। बिल ${invoiceId} पर ${amount} बाकी है${evidence.dueDate ? ` (देय तिथि ${evidence.dueDate})` : ''}।`, ...(evidence.link ? [`भुगतान के लिए: ${evidence.link}`] : []), 'ये याद-दिलाने वाले संदेश बंद करने के लिए STOP लिखें।']
    : [`Hello. Invoice ${invoiceId} has ${amount} due${evidence.dueDate ? ` since ${evidence.dueDate}` : ''}.`, ...(evidence.link ? [`You can pay here: ${evidence.link}`] : []), 'Reply STOP to stop these reminders.'];
  const payload = channel === 'email'
    ? { to: [consent.destination], subject: language === 'hi' ? `भुगतान की याद: बिल ${invoiceId}` : `Payment reminder: invoice ${invoiceId}`, body: lines.join('\n') }
    : { to: consent.destination, template: 'payment_reminder', language, parameters: [invoiceId, amount, evidence.dueDate ?? '-'] };
  const consentDigest = digest({ id: consent.id, destination: consent.destination, answer: consent.answer });
  return host.service.prepare(context, { connectionId: connection.id, action: channel === 'email' ? 'smtp.send' : 'template.send', payload, sourceIds,
    intentId: `follow-up:${customerId}:${invoiceId}:${today}`,
    evidence: { kind: FOLLOW_UP, digest: digest({ invoice: evidence.digest, consent: consentDigest }), detail: { customerId, invoiceId, day: today, channel, consentId: consent.id, receiptId: evidence.receiptId, sourceIds, outstandingMinor: evidence.outstandingMinor } } });
}
/** Re-derived at dispatch: a changed invoice, merge, payment or consent cancels the reminder. */
export async function reminderEvidence(host: FollowUpHost, context: Context, envelope: Envelope) {
  const detail = envelope.evidence!.detail as any; const state = host.service.store.read();
  const consent = consentFor(state, detail.customerId, detail.channel);
  check(consent && consent.id === detail.consentId && consent.answer === 'yes', 'FOLLOW_UP_NO_CONSENT', 'Consent changed.');
  const evidence = await invoiceEvidence(host, context, { customerId: detail.customerId, invoiceId: detail.invoiceId, sourceIds: detail.sourceIds });
  return digest({ invoice: evidence.digest, consent: digest({ id: consent.id, destination: consent.destination, answer: consent.answer }) });
}
export async function journalSent(host: FollowUpHost, context: Context, action: PreparedAction, envelope: Envelope) {
  if (envelope.evidence?.kind !== FOLLOW_UP) return;
  const detail = envelope.evidence.detail as any;
  await host.service.store.update(state => {
    const wb = moduleState(state, MODULE_ID, initState); if (wb.journal.some(j => j.kind === 'sent' && j.actionId === action.id)) return;
    wb.journal.push({ id: newId('journal'), kind: 'sent', invoiceId: detail.invoiceId, customerId: detail.customerId, actionId: action.id, on: dayKey(host.service.now(), host.timeZone), at: host.service.now(), sourceIds: action.sourceIds, evidence: envelope.evidence!.digest });
    audit(state, 'writeback.follow-up.sent', { actionId: action.id });
  });
  void context;
}
/** Paid is a separate fact: the books show nothing due and every payment matches exactly one bank line. */
export async function checkPaid(host: FollowUpHost, context: Context, input: Record<string, unknown>) {
  const p = record(input, ['customerId', 'invoiceId'], ['sourceIds']);
  const customerId = text(p.customerId, 100), invoiceId = text(p.invoiceId, 100);
  const sourceIds = p.sourceIds === undefined ? [] : (check(Array.isArray(p.sourceIds), 'INVALID_SOURCES', 'Source IDs are a list.'), p.sourceIds.map(s => text(s, 100)));
  const evidence = await invoiceEvidence(host, context, { customerId, invoiceId, sourceIds });
  const state = host.service.store.read(); const used = new Set<string>(); const reasons: string[] = [];
  for (const payment of evidence.payments) {
    const lines = state.facts.filter(f => f.kind === 'bank_line' && !f.supersededAt && !f.deletedAt && f.fields.status === 'matched' && f.fields.paymentEntityId === payment.entityId && f.fields.amountMinor === payment.amountMinor && (!sourceIds.length || sourceIds.includes(f.sourceId)));
    if (lines.length === 1 && !used.has(lines[0].id)) used.add(lines[0].id); else reasons.push('A books payment has no single matching bank line.');
  }
  const paid = BigInt(evidence.outstandingMinor) === 0n && evidence.payments.length > 0 && reasons.length === 0 && !evidence.incomplete;
  if (!paid) return { paid: false, outstandingMinor: evidence.outstandingMinor, reasons: BigInt(evidence.outstandingMinor) > 0n ? ['Something is still due.', ...reasons] : reasons.length ? reasons : ['No payment was recorded.'], receiptId: evidence.receiptId };
  return host.service.store.update(state0 => {
    current(state0, context, 'prepare'); const wb = moduleState(state0, MODULE_ID, initState);
    const prior = wb.journal.find(j => j.kind === 'paid' && j.invoiceId === invoiceId && j.customerId === customerId);
    if (!prior) { wb.journal.push({ id: newId('journal'), kind: 'paid', invoiceId, customerId, actionId: null, on: dayKey(host.service.now(), host.timeZone), at: host.service.now(), sourceIds, evidence: evidence.digest }); audit(state0, 'writeback.follow-up.paid', { invoiceId }); }
    return { paid: true, outstandingMinor: '0', receiptId: evidence.receiptId, bankLines: used.size };
  });
}
export function journal(host: FollowUpHost, context: Context) { authorize(host.service.store, context); return structuredClone(readState(host.service.store.read()).journal); }
/** An observed reply. Outside text is data: it is compared with the stop words and then discarded. */
export async function inbound(host: FollowUpHost, context: Context, input: Record<string, unknown>) {
  const p = record(input, ['customerId', 'channel', 'text', 'observedOn']);
  const customerId = text(p.customerId, 100), channel = oneOf(p.channel, ['email', 'whatsapp'] as const), observedOn = date(p.observedOn);
  check(typeof p.text === 'string' && p.text.length <= 5000, 'INVALID_REQUEST', 'The reply is too long.');
  const words = readState(host.service.store.read()).settings.stopWords;
  const said = p.text.trim().replace(/\s+/g, ' ').toUpperCase();
  if (!words.some(word => said === word.toUpperCase())) return { stopped: false };
  const consent = consentFor(host.service.store.read(), customerId, channel);
  await recordConsent(host, context, { requestId: `stop:${customerId}:${channel}:${observedOn}`, customerId, channel, destination: consent?.destination ?? (channel === 'email' ? 'unknown@stop.invalid' : '10000000'), answer: 'stopped', observedOn });
  const dropped: string[] = [];
  for (const action of reminders(host.service.store.read(), customerId)) {
    if (!['prepared', 'approved'].includes(action.status) || (action.payload as any).evidence.detail.channel !== channel) continue;
    await host.service.drop(context, action.id); dropped.push(action.id);
  }
  return { stopped: true, dropped };
}
