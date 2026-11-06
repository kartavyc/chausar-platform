/**
 * The fake engine's CRM (wave 6, 6G3, D44): field history, companies with two-way links, client timelines and the
 * owner's lists, in the engine's shapes, codes, order and words. The request checks and the views come from the engine's
 * own pure file (crm/crm-data.ts), so the two cannot drift. A client's name, email and note change through the fake's
 * evidence (the host's editClient), as the engine's do through its ledger; the change row is written here, and so is
 * the row for a suggestion the owner applies (recordClientChange). Forget of a person takes their rows, links, list
 * places and their client's logged entries, as the engine's eraseCrmNaming does.
 */

import { EngineError } from './types';
import type { ClientLite } from './types';
import type { W4DeskHost } from './fake-w4';
import {
  LISTS_LINE, MAX_COMPANIES, MAX_LIST_ENTRIES, MAX_LISTS, MAX_TIMELINE, crmId, crmPayload, historyOf, listGroups, memberId, memberKind, newestFirst,
  parseClientEdit, parseCompanySave, parseLink, parseListPlace, parseListSave, parseLog, sameName, timelineOf,
  type ClientCrmView, type CompanyBody, type CompanyRow, type CompanyView, type CrmChangeBody, type CrmEntryBody, type CrmLinkBody, type CrmListBody,
  type CrmListItemBody, type CrmListRow, type CrmListView, type CrmMemberView, type CrmWho, type NameOf, type TimelineEntryView,
} from '../../../../platform/runtime/venture/crm/crm-data';
import { COUNTRY_TIME_ZONES } from '../../../../platform/runtime/venture/local-day-data';

const METHODS = new Set([
  'venture.crm.client', 'venture.crm.client.edit', 'venture.crm.companies', 'venture.crm.company', 'venture.crm.company.save', 'venture.crm.link',
  'venture.crm.log', 'venture.crm.lists', 'venture.crm.list', 'venture.crm.list.save', 'venture.crm.list.place',
]);
const BAD = 'INVALID_VENTURE_REQUEST';
const ERASED_ENTRY = 'Erased: it named someone you asked Chausar to forget.';

type Row<B> = { id: string; at: string } & B;
type Book = {
  changes: Row<CrmChangeBody>[]; companies: Row<CompanyBody>[]; links: Row<CrmLinkBody>[];
  entries: Row<CrmEntryBody>[]; lists: Row<CrmListBody>[]; items: Row<CrmListItemBody>[];
};
/** A sent or reply touch on one of a client's pipeline cards. */
export type ClientTouch = { id: string; what: 'sent' | 'reply'; on: string; at: string; channel: string | null };
export type CrmPerson = { id: string; name: string; clientId: string | null };
/** What the CRM desk needs from the rest of the fake. */
export type CrmHost = W4DeskHost & {
  clients: () => readonly ClientLite[];
  people: () => readonly CrmPerson[];
  /** The owner's own value for a client field: kept as owner-entered evidence and written to the client. */
  editClient: (clientId: string, field: 'name' | 'email' | 'note' | 'phone', value: string) => void;
  touches: (match: (card: { personId: string; clientName: string | null }) => boolean) => ClientTouch[];
};

/** A check from the engine's pure file, as the fake's own error. */
function engineChecked<T>(run: () => T): T {
  try { return run(); } catch (error) {
    if (error instanceof EngineError) throw error;
    const known = error as { code?: string; message?: string };
    throw new EngineError(known.code ?? BAD, known.message ?? 'Send the required fields and nothing else.');
  }
}
function need(condition: unknown, code: string, message: string): asserts condition {
  if (!condition) throw new EngineError(code, message);
}
const byName = <T extends { name: string }>(a: T, b: T) => (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : a.name.toLowerCase() > b.name.toLowerCase() ? 1 : 0);

export class FakeCrmDesk {
  private readonly host: CrmHost;
  private readonly books = new Map<string, Book>();
  private seq = 0;

  constructor(host: CrmHost) { this.host = host; }

  handles(method: string): boolean { return METHODS.has(method); }

  request(method: string, p: Record<string, unknown>): unknown {
    return engineChecked(() => {
      switch (method) {
        case 'venture.crm.client': return this.clientView(crmId(crmPayload(p, ['clientId'], ['clientId']).clientId, 'Client'));
        case 'venture.crm.client.edit': return this.clientEdit(p);
        case 'venture.crm.companies': crmPayload(p, []); return this.companyRows();
        case 'venture.crm.company': return this.companyView(crmId(crmPayload(p, ['companyId'], ['companyId']).companyId, 'Company'));
        case 'venture.crm.company.save': return this.companySave(p);
        case 'venture.crm.link': return this.link(p);
        case 'venture.crm.log': return this.log(p);
        case 'venture.crm.lists': crmPayload(p, []); return this.listRows();
        case 'venture.crm.list': return this.listView(crmId(crmPayload(p, ['listId'], ['listId']).listId, 'List'));
        case 'venture.crm.list.save': return this.listSave(p);
        case 'venture.crm.list.place': return this.listPlace(p);
        default: throw new EngineError('NOT_BUILT_YET', 'This part of Chausar is not built yet.');
      }
    });
  }

  private book(): Book {
    const id = this.host.current();
    let book = this.books.get(id);
    if (!book) { book = { changes: [], companies: [], links: [], entries: [], lists: [], items: [] }; this.books.set(id, book); }
    return book;
  }
  private base(kind: string): { id: string; at: string } { this.seq += 1; return { id: `${kind}_fake${this.seq}`, at: this.host.now() }; }
  private change(change: CrmChangeBody): void {
    if (change.before === change.after) return;
    this.book().changes.push({ ...this.base('crmchange'), ...change });
  }

  /** The owner applied a suggestion to a client field (the fake's evidence apply), as the engine's ledger records it. */
  recordClientChange(clientId: string, field: 'name' | 'email' | 'note', before: string | null, after: string, by: CrmWho, ref: string | null): void {
    this.change({ subject: `client:${clientId}`, field, before, after, by, ref });
  }

  /** The owner's local day, as the engine reads it: the country's own time zone. */
  private localDay(): string {
    const venture = this.host.ask('venture.get', {}) as { venture?: { country?: { code?: string } | null } } | null;
    const code = venture?.venture?.country?.code ?? 'IN';
    return new Intl.DateTimeFormat('en-CA', { timeZone: COUNTRY_TIME_ZONES[code as keyof typeof COUNTRY_TIME_ZONES] ?? 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(this.host.now()));
  }

  private nameOf(): NameOf {
    const names = new Map<string, string>();
    for (const client of this.host.clients()) names.set(`client:${client.id}`, client.name);
    for (const person of this.host.people()) names.set(`person:${person.id}`, person.name);
    for (const company of this.book().companies) names.set(`company:${company.id}`, company.name);
    return ref => names.get(ref) ?? null;
  }
  private listName(): (id: string) => string | null {
    const names = new Map(this.book().lists.map(list => [list.id, list.name]));
    return id => names.get(id) ?? null;
  }
  private client(clientId: string): ClientLite {
    const client = this.host.clients().find(item => item.id === clientId);
    need(client, 'CLIENT_NOT_FOUND', 'Choose a client from this business.');
    return client;
  }
  private company(companyId: string): Row<CompanyBody> {
    const company = this.book().companies.find(item => item.id === companyId);
    need(company, 'COMPANY_NOT_FOUND', 'That company was not found.');
    return company;
  }
  private list(listId: string): Row<CrmListBody> {
    const list = this.book().lists.find(item => item.id === listId);
    need(list, BAD, 'That list was not found.');
    return list;
  }
  private checkMember(member: string): void {
    const id = memberId(member);
    if (memberKind(member) === 'client') this.client(id);
    else if (memberKind(member) === 'person') need(this.host.people().some(person => person.id === id), BAD, 'This person is not in your network.');
    else this.company(id);
  }
  private linkOf(member: string) { return this.book().links.find(link => link.member === member) ?? null; }

  private timeline(clientId: string): TimelineEntryView[] {
    const client = this.client(clientId);
    const people = new Set(this.host.people().filter(person => person.clientId === clientId).map(person => person.id));
    const touches = this.host.touches(card => card.clientName === client.name || people.has(card.personId));
    const invoices = (this.host.ask('venture.invoice.list', {}) as { id: string; at: string; clientId: string; number: string | null; status: string; issueDate: string | null }[])
      .filter(invoice => invoice.clientId === clientId).map(invoice => ({ id: invoice.id, number: invoice.number, status: invoice.status, on: invoice.issueDate, at: invoice.at }));
    // C4 task 18, as the engine: the client's orders and the drafts the owner decided.
    const orders = (this.host.ask('venture.order.list', {}) as { id: string; at: string; clientId: string; offerId: string; internal?: true; deliveredOn: string | null }[]).filter(order => order.clientId === clientId && !order.internal);
    const offers = new Map(((this.host.ask('venture.blueprint.get', {}) as { blueprint?: { offers?: { id: string; name: { value: string } }[] } }).blueprint?.offers ?? []).map(offer => [offer.id, offer.name.value]));
    const orderIds = new Set(orders.map(order => order.id));
    const drafts = (this.host.ask('venture.delivery.list', {}) as { id: string; orderId: string; practice?: boolean; verdict?: { choice: 'accepted' | 'edited' | 'rejected'; at: string } | null }[])
      .flatMap(run => (run.verdict && !run.practice && orderIds.has(run.orderId) ? [{ id: run.id, choice: run.verdict.choice, on: run.verdict.at.slice(0, 10), at: run.verdict.at }] : []));
    return timelineOf({
      clientId, logged: this.book().entries, touches, invoices, drafts,
      orders: orders.map(order => ({ id: order.id, offer: offers.get(order.offerId) ?? null, on: order.at.slice(0, 10), at: order.at, deliveredOn: order.deliveredOn })),
    });
  }

  private clientView(clientId: string): ClientCrmView {
    const client = this.client(clientId);
    const nameOf = this.nameOf(), listName = this.listName();
    const link = this.linkOf(`client:${client.id}`);
    return {
      clientId: client.id,
      company: link ? { id: link.companyId, name: nameOf(`company:${link.companyId}`) ?? 'A company' } : null,
      history: historyOf(this.book().changes, `client:${client.id}`, nameOf, listName, { at: client.at, line: 'Added to Clients' }),
      timeline: this.timeline(client.id),
      lists: this.book().items.filter(item => item.member === `client:${client.id}`)
        .map(item => ({ listId: item.listId, name: listName(item.listId) ?? 'A list', stage: item.stage })).sort(byName),
    };
  }
  private memberView(member: string): CrmMemberView {
    const nameOf = this.nameOf(), listName = this.listName();
    const link = this.linkOf(member);
    const client = memberKind(member) === 'client' ? this.client(memberId(member)) : null;
    return {
      member, company: link ? { id: link.companyId, name: nameOf(`company:${link.companyId}`) ?? 'A company' } : null,
      history: historyOf(this.book().changes, member, nameOf, listName, client ? { at: client.at, line: 'Added to Clients' } : null),
    };
  }
  private companyRows(): CompanyRow[] {
    const { links } = this.book();
    return this.book().companies.map(company => ({
      id: company.id, name: company.name, domain: company.domain,
      clients: links.filter(link => link.companyId === company.id && memberKind(link.member) === 'client').length,
      people: links.filter(link => link.companyId === company.id && memberKind(link.member) === 'person').length,
    })).sort(byName);
  }
  private companyView(companyId: string): CompanyView {
    const company = this.company(companyId);
    const nameOf = this.nameOf(), listName = this.listName();
    const members = this.book().links.filter(link => link.companyId === company.id).map(link => link.member);
    const refs = (kind: 'client' | 'person') => members.filter(member => memberKind(member) === kind)
      .map(member => ({ id: memberId(member), name: nameOf(member) ?? 'someone no longer here' })).sort(byName);
    const clients = refs('client');
    return {
      company: { ...this.companyRows().find(row => row.id === company.id)!, note: company.note }, clients, people: refs('person'),
      history: historyOf(this.book().changes, `company:${company.id}`, nameOf, listName, { at: company.at, line: 'Added to Companies' }),
      timeline: newestFirst(clients.flatMap(client => this.timeline(client.id))).slice(0, MAX_TIMELINE),
    };
  }
  private listRows(): CrmListRow[] {
    const { items } = this.book();
    return this.book().lists.map(list => ({ id: list.id, name: list.name, stages: [...list.stages], count: items.filter(item => item.listId === list.id).length })).sort(byName);
  }
  private listView(listId: string): CrmListView {
    const list = this.list(listId);
    const nameOf = this.nameOf(), listName = this.listName();
    return {
      list: this.listRows().find(row => row.id === list.id)!,
      groups: listGroups(list, this.book().items.filter(item => item.listId === list.id), nameOf),
      history: historyOf(this.book().changes, `list:${list.id}`, nameOf, listName, { at: list.at, line: 'Made this list' }),
      line: LISTS_LINE,
    };
  }

  private clientEdit(p: Record<string, unknown>): ClientCrmView {
    const edit = parseClientEdit(p);
    const client = this.client(edit.clientId);
    need(client[edit.field] !== edit.value, BAD, `That is the ${edit.field} as it is now.`);
    const before = client[edit.field] ?? null;
    this.host.editClient(client.id, edit.field, edit.value);
    this.change({ subject: `client:${client.id}`, field: edit.field, before, after: edit.value, by: 'owner', ref: null });
    return this.clientView(client.id);
  }

  private companySave(p: Record<string, unknown>): CompanyView {
    const input = parseCompanySave(p);
    const book = this.book();
    if (input.name !== undefined) {
      const twin = book.companies.find(company => company.id !== input.companyId && sameName(company.name, input.name!));
      need(!twin, BAD, `${twin?.name} is kept already.`);
    }
    if (input.companyId === null) {
      need(book.companies.length < MAX_COMPANIES, BAD, `Chausar keeps up to ${MAX_COMPANIES} companies.`);
      const made = { ...this.base('company'), name: input.name!, domain: input.domain ?? null, note: input.note ?? null };
      book.companies.push(made);
      return this.companyView(made.id);
    }
    const company = this.company(input.companyId);
    let changed = false;
    for (const field of ['name', 'domain', 'note'] as const) {
      if (input[field] === undefined || input[field] === company[field]) continue;
      this.change({ subject: `company:${company.id}`, field, before: company[field], after: input[field] ?? null, by: 'owner', ref: null });
      (company as Record<string, unknown>)[field] = input[field];
      changed = true;
    }
    need(changed, BAD, 'That is the company as it is now.');
    return this.companyView(company.id);
  }

  private link(p: Record<string, unknown>): CrmMemberView {
    const input = parseLink(p);
    this.checkMember(input.member);
    if (input.companyId !== null) this.company(input.companyId);
    const book = this.book();
    const current = this.linkOf(input.member);
    if ((current?.companyId ?? null) === input.companyId) return this.memberView(input.member);
    if (current) {
      book.links = book.links.filter(link => link.id !== current.id);
      this.change({ subject: `company:${current.companyId}`, field: 'member', before: input.member, after: null, by: 'owner', ref: null });
    }
    if (input.companyId !== null) {
      book.links.push({ ...this.base('crmlink'), companyId: input.companyId, member: input.member });
      this.change({ subject: `company:${input.companyId}`, field: 'member', before: null, after: input.member, by: 'owner', ref: null });
    }
    this.change({ subject: input.member, field: 'company', before: current ? `company:${current.companyId}` : null, after: input.companyId ? `company:${input.companyId}` : null, by: 'owner', ref: null });
    return this.memberView(input.member);
  }

  private log(p: Record<string, unknown>): ClientCrmView {
    const input = parseLog(p, this.localDay());
    this.client(input.clientId);
    this.book().entries.push({ ...this.base('crmentry'), clientId: input.clientId, entryKind: input.kind, on: input.on, text: input.text });
    return this.clientView(input.clientId);
  }

  private listSave(p: Record<string, unknown>): CrmListView {
    const input = parseListSave(p);
    const book = this.book();
    const twin = book.lists.find(list => list.id !== input.listId && sameName(list.name, input.name));
    need(!twin, BAD, `${twin?.name} is a list already.`);
    if (input.listId === null) {
      need(book.lists.length < MAX_LISTS, BAD, `Chausar keeps up to ${MAX_LISTS} lists.`);
      const made = { ...this.base('crmlist'), name: input.name, stages: input.stages };
      book.lists.push(made);
      return this.listView(made.id);
    }
    const list = this.list(input.listId);
    const items = book.items.filter(item => item.listId === list.id);
    for (const stage of list.stages) {
      const held = items.filter(item => item.stage === stage).length;
      need(input.stages.includes(stage) || held === 0, BAD, `Move the ${held === 1 ? 'one entry' : `${held} entries`} out of ${stage} first.`);
    }
    const stagesBefore = JSON.stringify(list.stages), stagesAfter = JSON.stringify(input.stages);
    need(list.name !== input.name || stagesBefore !== stagesAfter, BAD, 'That is the list as it is now.');
    this.change({ subject: `list:${list.id}`, field: 'name', before: list.name, after: input.name, by: 'owner', ref: null });
    this.change({ subject: `list:${list.id}`, field: 'stages', before: stagesBefore, after: stagesAfter, by: 'owner', ref: null });
    list.name = input.name;
    list.stages = input.stages;
    return this.listView(list.id);
  }

  private listPlace(p: Record<string, unknown>): CrmListView {
    const input = parseListPlace(p);
    const book = this.book();
    const list = this.list(input.listId);
    this.checkMember(input.member);
    need(input.stage === null || list.stages.includes(input.stage), BAD, `Choose one of the stages of ${list.name}.`);
    const items = book.items.filter(item => item.listId === list.id);
    const current = items.find(item => item.member === input.member) ?? null;
    const before = current?.stage ?? null;
    if (input.stage === null) {
      need(current, BAD, `That is not in ${list.name}.`);
      book.items = book.items.filter(item => item.id !== current.id);
    } else if (current) {
      if (current.stage === input.stage) return this.listView(list.id);
      current.stage = input.stage;
    } else {
      need(items.length < MAX_LIST_ENTRIES, BAD, `A list holds up to ${MAX_LIST_ENTRIES} entries.`);
      book.items.push({ ...this.base('crmitem'), listId: list.id, member: input.member, stage: input.stage });
    }
    this.change({ subject: input.member, field: `list.${list.id}`, before, after: input.stage, by: 'owner', ref: null });
    return this.listView(list.id);
  }

  /** Forget of people, as the engine's eraseCrmNaming: their rows, links, list places and their clients' logged entries go. */
  forgetPeople(people: readonly { id: string; names: string[]; clientId: string | null; emails?: string[]; phones?: string[] }[], erase: boolean): void {
    const book = this.book();
    const clientIds = new Set(erase ? people.flatMap(person => (person.clientId ? [person.clientId] : [])) : []);
    const members = new Set([...people.map(person => `person:${person.id}`), ...[...clientIds].map(id => `client:${id}`)]);
    const names = erase ? namesTest(people) : () => false;
    book.changes = book.changes.filter(change => !(members.has(change.subject) || members.has(change.before ?? '') || members.has(change.after ?? '') || names(change.before) || names(change.after)));
    book.links = book.links.filter(link => !members.has(link.member));
    book.items = book.items.filter(item => !members.has(item.member));
    book.entries = book.entries.filter(entry => !clientIds.has(entry.clientId));
    if (!erase) return;
    for (const entry of book.entries) if (names(entry.text)) entry.text = ERASED_ENTRY;
    for (const company of book.companies) {
      if (names(company.name)) company.name = 'A company';
      if (names(company.note)) company.note = null;
    }
    for (const list of book.lists) if (names(list.name)) list.name = 'A list';
  }
}

/** Whether words name one of these people: a full name, a word of it three letters or longer, an email or a phone. */
export function namesTest(people: readonly { names: string[]; emails?: string[]; phones?: string[] }[]): (text: unknown) => boolean {
  const parts = new Set<string>();
  for (const person of people) {
    for (const name of person.names) {
      if (!name || name.includes('@') || name.startsWith('+') || name.startsWith('http')) continue;
      parts.add(name.trim());
      for (const word of name.split(/[\s,.]+/)) if ([...word].length >= 3) parts.add(word);
    }
  }
  const handles = people.flatMap(person => [...(person.emails ?? []), ...(person.phones ?? [])]).filter(Boolean).map(handle => handle.toLowerCase());
  const escape = (part: string) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = parts.size ? new RegExp(`(?<![\\p{L}\\p{N}])(?:${[...parts].sort((a, b) => b.length - a.length).map(escape).join('|')})(?![\\p{L}\\p{N}])`, 'iu') : null;
  return text => typeof text === 'string' && ((!!pattern && pattern.test(text)) || handles.some(handle => text.toLowerCase().includes(handle)));
}
