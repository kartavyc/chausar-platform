// Chausar venture launcher, CRM upgrades (wave 6, package 6G3, D44): the shapes, request checks and views that the
// engine (crm/crm.ts) and the fake engine share, so the two answer alike. Pure: no state store, no clock, no node.
//
// Field history: every change to a client, company or person field is one change row (who, what, before, after,
// when), written beside the record; the record itself is never rewritten to hold its history, so clients kept before
// wave 6 stay exactly as they were and simply have no rows yet. A reference (a client's company, a company's members,
// a list stage) keeps an id, never a copied name, and the view names it at read time, so Forget has fewer copies to find.
// Pipelines as lists: the owner's own lists, each with its own stages (the main pipeline keeps its board and its rules);
// a client, person or company sits in a list at one stage, and every move is a change row on that member.
// A Company has two-way links: one link record per member, read from both sides. Timeline: what the owner logged
// (a call, a WhatsApp message, a meeting, a note), the sends and replies recorded on the client's pipeline cards, and
// the client's invoices, newest first. WhatsApp and calls are logged by the owner: Chausar has no WhatsApp connection.
import { check } from '../../portable.ts';
import { validDate } from '../../date-core.ts';
import { redactSecrets } from '../core/secrets.ts';

export type CrmWho = 'owner' | 'agent' | 'chausar';
/** One change to one field (venture-crm-change). subject: 'client:<id>', 'company:<id>', 'person:<id>' or 'list:<id>'. */
export type CrmChangeBody = { subject: string; field: string; before: string | null; after: string | null; by: CrmWho; ref: string | null };
/** A company (venture-company). */
export type CompanyBody = { name: string; domain: string | null; note: string | null };
/** One member of a company (venture-crm-link). member: 'client:<id>' or 'person:<id>'; one company per member. */
export type CrmLinkBody = { companyId: string; member: string };
export type CrmEntryKind = 'call' | 'whatsapp' | 'meeting' | 'note';
export const CRM_ENTRY_KINDS: readonly CrmEntryKind[] = ['call', 'whatsapp', 'meeting', 'note'];
/** One thing the owner logged on a client's timeline (venture-crm-entry). */
export type CrmEntryBody = { clientId: string; entryKind: CrmEntryKind; on: string; text: string };
/** One of the owner's lists (venture-crm-list): a pipeline with its own stages. */
export type CrmListBody = { name: string; stages: string[] };
/** A member at one stage of one list (venture-crm-list-item). */
export type CrmListItemBody = { listId: string; member: string; stage: string };

export type FieldChangeView = {
  id: string; subject: string; field: string; label: string; who: string; at: string; line: string;
  /** The values in words (a reference named at read time), or null. They are the owner's or the client's words. */
  before: string | null; after: string | null;
};
export type TimelineKind = CrmEntryKind | 'sent' | 'reply' | 'invoice';
export type TimelineEntryView = {
  id: string; kind: TimelineKind; on: string; at: string; line: string;
  /** The owner's own words for a logged entry; null otherwise. */
  text: string | null;
  /** The client the entry is about (a company's timeline holds its clients' entries). */
  clientId: string;
};
export type CrmRef = { id: string; name: string };
export type ClientCrmView = { clientId: string; company: CrmRef | null; history: FieldChangeView[]; timeline: TimelineEntryView[]; lists: { listId: string; name: string; stage: string }[] };
/** A client or person after a company link changed: their company now and their history. */
export type CrmMemberView = { member: string; company: CrmRef | null; history: FieldChangeView[] };
export type CompanyRow = { id: string; name: string; domain: string | null; clients: number; people: number };
export type CompanyView = { company: CompanyRow & { note: string | null }; clients: CrmRef[]; people: CrmRef[]; history: FieldChangeView[]; timeline: TimelineEntryView[] };
export type CrmListRow = { id: string; name: string; stages: string[]; count: number };
export type CrmListEntry = { member: string; kind: 'client' | 'person' | 'company'; name: string; at: string };
export type CrmListView = { list: CrmListRow; groups: { stage: string; entries: CrmListEntry[] }[]; history: FieldChangeView[]; line: string };

export const MAX_COMPANIES = 500;
export const MAX_LISTS = 30;
export const MAX_LIST_ENTRIES = 500;
export const MAX_TIMELINE = 200;
export const LISTS_LINE = 'Your pipeline keeps its board. A list is another pipeline with its own stages; nothing in a list is ever sent.';
export const LOGGED_LINE = 'You log calls and WhatsApp messages here yourself. Chausar has no WhatsApp connection.';

const BAD = 'INVALID_VENTURE_REQUEST';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DOMAIN = /^(?=.{3,120}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;
const ID = /^[A-Za-z0-9_.:-]{1,200}$/;
const MEMBER = /^(client|person|company):[A-Za-z0-9_.-]{1,180}$/;

// ---------------------------------------------------------------------------
// Request checks (the same words as records.ts plainText, singleLine and exactPayload)
// ---------------------------------------------------------------------------

export function crmPayload(value: unknown, allowed: readonly string[], required: readonly string[] = []): Record<string, unknown> {
  check(value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)), BAD, 'Send one request object.');
  const record = value as Record<string, unknown>;
  check(Object.keys(record).every(key => allowed.includes(key)) && required.every(key => Object.hasOwn(record, key)), BAD, 'Send the required fields and nothing else.');
  return record;
}
export function crmText(value: unknown, field: string, min: number, max: number, oneLine = false): string {
  check(typeof value === 'string', BAD, `${field} must be text.`);
  if (oneLine) check(!/[\n\r\t]/.test(value.trim()), BAD, `${field} must be one line.`);
  const text = value.replace(/\r\n/g, '\n').trim();
  check(text.length >= min && text.length <= max, BAD, `${field} must be between ${min} and ${max} characters.`);
  check(!/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(text), BAD, `${field} contains characters Chausar cannot keep.`);
  return redactSecrets(text);
}
export function crmId(value: unknown, field: string): string {
  check(typeof value === 'string' && ID.test(value), BAD, `${field} must be a known identifier.`);
  return value;
}
const fold = (text: string) => text.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * venture.crm.client.edit { clientId, field, value }: one of the client fields the ledger writes back (name, email, note,
 * and one-shot C6's phone, whose WhatsApp digits the ledger works out again; clients/phone.ts checks it there).
 */
export function parseClientEdit(payload: unknown): { clientId: string; field: 'name' | 'email' | 'note' | 'phone'; value: string } {
  const body = crmPayload(payload, ['clientId', 'field', 'value'], ['clientId', 'field', 'value']);
  const clientId = crmId(body.clientId, 'Client');
  check(body.field === 'name' || body.field === 'email' || body.field === 'note' || body.field === 'phone', BAD, 'Choose the name, the email, the phone or the note.');
  const field = body.field;
  const value = field === 'name' ? crmText(body.value, 'Client name', 2, 120, true) : field === 'email' ? crmText(body.value, 'Email', 3, 200, true)
    : field === 'phone' ? crmText(body.value, 'Phone or WhatsApp', 3, 40, true) : crmText(body.value, 'Note', 1, 500);
  if (field === 'email') check(EMAIL.test(value), BAD, 'Use an email address like name@example.com.');
  return { clientId, field, value };
}

/** venture.crm.company.save { companyId?, name?, domain?, note? }: a new company needs a name; null clears domain or note. */
export function parseCompanySave(payload: unknown): { companyId: string | null; name?: string; domain?: string | null; note?: string | null } {
  const body = crmPayload(payload, ['companyId', 'name', 'domain', 'note']);
  const companyId = body.companyId === undefined ? null : crmId(body.companyId, 'Company');
  check(companyId !== null || body.name !== undefined, BAD, 'Give the company a name.');
  check(companyId === null || ['name', 'domain', 'note'].some(key => Object.hasOwn(body, key)), BAD, 'Say what to change.');
  const out: { companyId: string | null; name?: string; domain?: string | null; note?: string | null } = { companyId };
  if (body.name !== undefined) out.name = crmText(body.name, 'Company name', 2, 120, true);
  if (body.domain !== undefined) {
    if (body.domain === null) out.domain = null;
    else {
      const domain = crmText(body.domain, 'Website', 3, 200, true).toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
      check(DOMAIN.test(domain), BAD, 'Use a website like example.com.');
      out.domain = domain;
    }
  }
  if (body.note !== undefined) out.note = body.note === null ? null : crmText(body.note, 'Note', 1, 500);
  return out;
}

/** venture.crm.link { companyId, member }: companyId null takes the member out of its company. */
export function parseLink(payload: unknown): { companyId: string | null; member: string } {
  const body = crmPayload(payload, ['companyId', 'member'], ['companyId', 'member']);
  const companyId = body.companyId === null ? null : crmId(body.companyId, 'Company');
  check(typeof body.member === 'string' && MEMBER.test(body.member) && !body.member.startsWith('company:'), BAD, 'Choose a client or a person.');
  return { companyId, member: body.member };
}

/** venture.crm.log { clientId, kind, on, text }: what the owner logged; never a day after today. */
export function parseLog(payload: unknown, today: string): { clientId: string; kind: CrmEntryKind; on: string; text: string } {
  const body = crmPayload(payload, ['clientId', 'kind', 'on', 'text'], ['clientId', 'kind', 'on', 'text']);
  const clientId = crmId(body.clientId, 'Client');
  check(CRM_ENTRY_KINDS.includes(body.kind as CrmEntryKind), BAD, 'Choose a call, a WhatsApp message, a meeting or a note.');
  check(validDate(body.on), BAD, 'Use a date like 2026-10-15.');
  check((body.on as string) <= today, BAD, 'Log what already happened, today or before.');
  return { clientId, kind: body.kind as CrmEntryKind, on: body.on as string, text: crmText(body.text, 'What happened', 2, 1000) };
}

/** venture.crm.list.save { listId?, name, stages }: two to eight stages, each named once. */
export function parseListSave(payload: unknown): { listId: string | null; name: string; stages: string[] } {
  const body = crmPayload(payload, ['listId', 'name', 'stages'], ['name', 'stages']);
  const listId = body.listId === undefined ? null : crmId(body.listId, 'List');
  const name = crmText(body.name, 'List name', 2, 60, true);
  check(Array.isArray(body.stages) && body.stages.length >= 2 && body.stages.length <= 8, BAD, 'A list has two to eight stages.');
  const stages = (body.stages as unknown[]).map(stage => crmText(stage, 'Stage', 1, 40, true));
  check(new Set(stages.map(fold)).size === stages.length, BAD, 'Name each stage once.');
  return { listId, name, stages };
}

/** venture.crm.list.place { listId, member, stage }: stage null takes the member out of the list. */
export function parseListPlace(payload: unknown): { listId: string; member: string; stage: string | null } {
  const body = crmPayload(payload, ['listId', 'member', 'stage'], ['listId', 'member', 'stage']);
  const listId = crmId(body.listId, 'List');
  check(typeof body.member === 'string' && MEMBER.test(body.member), BAD, 'Choose a client, a person or a company.');
  const stage = body.stage === null ? null : crmText(body.stage, 'Stage', 1, 40, true);
  return { listId, member: body.member, stage };
}

/** The same name, compared as one: spaces, case and width folded. */
export const sameName = (a: string, b: string) => fold(a) === fold(b);

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

const FIELD_LABEL: Readonly<Record<string, string>> = Object.freeze({
  name: 'Name', email: 'Email', phone: 'Phone or WhatsApp', note: 'Note', domain: 'Website', company: 'Company', member: 'Member', stages: 'Stages',
});

/** Who made a change, in words. */
export function whoWords(by: CrmWho): string {
  return by === 'owner' ? 'You' : by === 'agent' ? 'An agent' : 'Chausar';
}

/** What a stored value reads as: a reference by its name now, a list of stages joined, text as it is. */
export type NameOf = (ref: string) => string | null;
function valueWords(field: string, value: string | null, nameOf: NameOf): string | null {
  if (value === null) return null;
  if (field === 'company' || field === 'member') return nameOf(value) ?? 'someone no longer here';
  if (field === 'stages') { try { return (JSON.parse(value) as string[]).join(', '); } catch { return value; } }
  return value;
}

/** One change row as the screens read it. listName: a list's name, for a 'list.<id>' field. */
export function changeView(change: { id: string; at: string } & CrmChangeBody, nameOf: NameOf, listName: (id: string) => string | null): FieldChangeView {
  const label = change.field.startsWith('list.') ? listName(change.field.slice('list.'.length)) ?? 'A list' : FIELD_LABEL[change.field] ?? change.field;
  const before = valueWords(change.field, change.before, nameOf), after = valueWords(change.field, change.after, nameOf);
  const who = whoWords(change.by);
  const verb = change.field === 'member'
    ? (after !== null ? 'added' : 'took out')
    : before === null ? 'set' : after === null ? 'cleared' : 'changed';
  const line = change.field === 'member' ? `${who} ${verb} a member` : change.field.startsWith('list.') && after === null ? `${who} took this out of ${label}` : `${who} ${verb} ${label}`;
  return { id: change.id, subject: change.subject, field: change.field, label, who, at: change.at, line, before, after };
}

/** A record's history, newest first. added: the record's own start ('Added to Clients'), which has no row of its own. */
export function historyOf(changes: readonly ({ id: string; at: string } & CrmChangeBody)[], subject: string, nameOf: NameOf, listName: (id: string) => string | null, added: { at: string; line: string } | null): FieldChangeView[] {
  // Newest first; two changes made at the same moment keep the order they were written in, the later first.
  const rows = changes.map((change, index) => ({ change, index })).filter(item => item.change.subject === subject)
    .sort((a, b) => (a.change.at < b.change.at ? 1 : a.change.at > b.change.at ? -1 : b.index - a.index))
    .map(item => changeView(item.change, nameOf, listName));
  if (added) rows.push({ id: `added:${subject}`, subject, field: 'record', label: 'Record', who: '', at: added.at, line: added.line, before: null, after: null });
  return rows;
}

const LOGGED_WORDS: Readonly<Record<CrmEntryKind, string>> = Object.freeze({
  call: 'You logged a call', whatsapp: 'You logged a WhatsApp message', meeting: 'You logged a meeting', note: 'You added a note',
});
const SENT_WORDS: Readonly<Record<string, string>> = Object.freeze({
  'own-mailbox': 'You sent an email', whatsapp: 'You sent a WhatsApp message', phone: 'You called', linkedin: 'You sent a LinkedIn message',
});
const INVOICE_WORDS: Readonly<Record<string, string>> = Object.freeze({ issued: 'issued', 'part-paid': 'part paid', paid: 'paid', void: 'cancelled' });

export type TimelineInput = {
  clientId: string;
  logged: readonly ({ id: string; at: string } & CrmEntryBody)[];
  touches: readonly { id: string; what: 'sent' | 'reply'; on: string; at: string; channel: string | null }[];
  invoices: readonly { id: string; number: string | null; status: string; on: string | null; at: string }[];
};

/** A client's timeline, newest first (day, then time, then id): at most MAX_TIMELINE entries. Draft invoices are left out. */
export function timelineOf(input: TimelineInput): TimelineEntryView[] {
  const entries: TimelineEntryView[] = [];
  for (const entry of input.logged) {
    if (entry.clientId !== input.clientId) continue;
    entries.push({ id: entry.id, kind: entry.entryKind, on: entry.on, at: entry.at, line: LOGGED_WORDS[entry.entryKind], text: entry.text, clientId: input.clientId });
  }
  for (const touch of input.touches) {
    const line = touch.what === 'reply' ? 'They replied' : SENT_WORDS[touch.channel ?? ''] ?? 'You sent a message';
    entries.push({ id: touch.id, kind: touch.what, on: touch.on, at: touch.at, line, text: null, clientId: input.clientId });
  }
  for (const invoice of input.invoices) {
    if (!invoice.number || !invoice.on || !INVOICE_WORDS[invoice.status]) continue;
    entries.push({ id: invoice.id, kind: 'invoice', on: invoice.on, at: invoice.at, line: `Invoice ${invoice.number} ${INVOICE_WORDS[invoice.status]}`, text: null, clientId: input.clientId });
  }
  return newestFirst(entries).slice(0, MAX_TIMELINE);
}

/** Timeline entries newest first: day, then time, then id. */
export function newestFirst(entries: TimelineEntryView[]): TimelineEntryView[] {
  return [...entries].sort((a, b) => (a.on !== b.on ? (a.on < b.on ? 1 : -1) : a.at !== b.at ? (a.at < b.at ? 1 : -1) : a.id < b.id ? -1 : 1));
}

/** The kind of a member reference. */
export const memberKind = (member: string): 'client' | 'person' | 'company' => member.slice(0, member.indexOf(':')) as 'client' | 'person' | 'company';
export const memberId = (member: string): string => member.slice(member.indexOf(':') + 1);

/** A list's groups: each stage in the list's order, its entries by name. */
export function listGroups(list: CrmListBody, items: readonly { member: string; stage: string; at: string }[], nameOf: NameOf): CrmListView['groups'] {
  return list.stages.map(stage => ({
    stage,
    entries: items.filter(item => item.stage === stage)
      .map(item => ({ member: item.member, kind: memberKind(item.member), name: nameOf(item.member) ?? 'someone no longer here', at: item.at }))
      .sort((a, b) => fold(a.name) < fold(b.name) ? -1 : fold(a.name) > fold(b.name) ? 1 : a.member < b.member ? -1 : 1),
  }));
}
