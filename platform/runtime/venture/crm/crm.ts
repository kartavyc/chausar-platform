// Chausar venture launcher, CRM upgrades (wave 6, package 6G3, D44): the engine's CRM methods. The rules and views are
// crm-data.ts's, shared with the fake engine. Every owner edit is made inside the app, is local (nothing is sent), and
// leaves one change row per field (crm/history.ts); a client's name, email and note change through the evidence ledger,
// which writes the row, so an agent's checked value that applies itself is in the same history. Forget of a person
// (network/forget.ts) calls eraseCrmNaming: the rows, links, logged entries and list places about them and their client
// go, and words naming them leave what stays.
import { check, type Context, type State } from '../../contracts.ts';
import type {
  ClientRecord, CompanyRecord, CrmChangeRecord, CrmEntryRecord, CrmLinkRecord, CrmListItemRecord, CrmListRecord, VentureDeps, VentureRecord,
} from '../contracts.ts';
import { listRecords, readVenture, requireAppChannel, ventureAction, type VentureTx } from '../records.ts';
import { localDayAt } from '../local-day.ts';
import { recordEvidence } from '../evidence/ledger.ts';
import { crmChange } from './history.ts';
import {
  LISTS_LINE, MAX_COMPANIES, MAX_LIST_ENTRIES, MAX_LISTS, MAX_TIMELINE, crmId, crmPayload, historyOf, listGroups, memberId, memberKind, newestFirst,
  parseClientEdit, parseCompanySave, parseLink, parseListPlace, parseListSave, parseLog, sameName, timelineOf,
  type ClientCrmView, type CompanyRow, type CompanyView, type CrmListRow, type CrmListView, type CrmMemberView, type NameOf, type TimelineEntryView,
} from './crm-data.ts';

const BAD = 'INVALID_VENTURE_REQUEST';
const NO_CLIENT = 'Choose a client from this business.';
const NO_COMPANY = 'That company was not found.';
const NO_LIST = 'That list was not found.';
/** What a logged entry's words become once the person they named is forgotten. */
export const ERASED_ENTRY = 'Erased: it named someone you asked Chausar to forget.';

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** Names every reference by what it is called now: a client, a person, a company, or null when it is gone. */
function namer(state: State, ventureId: string): NameOf {
  const names = new Map<string, string>();
  for (const client of listRecords(state, 'venture-client', ventureId)) names.set(`client:${client.id}`, client.name);
  for (const person of listRecords(state, 'venture-person', ventureId)) names.set(`person:${person.id}`, person.name);
  for (const company of listRecords(state, 'venture-company', ventureId)) names.set(`company:${company.id}`, company.name);
  return ref => names.get(ref) ?? null;
}
function listNamer(state: State, ventureId: string): (id: string) => string | null {
  const names = new Map(listRecords(state, 'venture-crm-list', ventureId).map(list => [list.id, list.name]));
  return id => names.get(id) ?? null;
}
const changesOf = (state: State, ventureId: string) => listRecords(state, 'venture-crm-change', ventureId);

function clientOf(state: State, venture: VentureRecord, clientId: string): ClientRecord {
  const client = listRecords(state, 'venture-client', venture.id).find(item => item.id === clientId);
  check(client, 'CLIENT_NOT_FOUND', NO_CLIENT);
  return client;
}
function companyOf(state: State, venture: VentureRecord, companyId: string): CompanyRecord {
  const company = listRecords(state, 'venture-company', venture.id).find(item => item.id === companyId);
  check(company, 'COMPANY_NOT_FOUND', NO_COMPANY);
  return company;
}
function listOf(state: State, venture: VentureRecord, listId: string): CrmListRecord {
  const list = listRecords(state, 'venture-crm-list', venture.id).find(item => item.id === listId);
  check(list, BAD, NO_LIST);
  return list;
}
/** The member a reference names, refused when it is not in this business. */
function checkMember(state: State, venture: VentureRecord, member: string): void {
  const id = memberId(member);
  if (memberKind(member) === 'client') check(listRecords(state, 'venture-client', venture.id).some(item => item.id === id), 'CLIENT_NOT_FOUND', NO_CLIENT);
  else if (memberKind(member) === 'person') check(listRecords(state, 'venture-person', venture.id).some(item => item.id === id), BAD, 'This person is not in your network.');
  else companyOf(state, venture, id);
}
const linkOf = (state: State, ventureId: string, member: string) => listRecords(state, 'venture-crm-link', ventureId).find(link => link.member === member) ?? null;

/** A client's timeline: what the owner logged, the sends and replies on their pipeline cards, and their invoices. */
function clientTimeline(state: State, venture: VentureRecord, clientId: string): TimelineEntryView[] {
  const people = new Set(listRecords(state, 'venture-person', venture.id).filter(person => person.clientId === clientId).map(person => person.id));
  const touches = listRecords(state, 'venture-opportunity', venture.id)
    .filter(card => card.clientId === clientId || people.has(card.personId))
    .flatMap(card => (card.touches ?? []).map((touch, index) => ({ id: `${card.id}:${index}`, what: touch.what, on: touch.on, at: touch.at, channel: touch.channel })));
  const invoices = listRecords(state, 'venture-invoice', venture.id).filter(invoice => invoice.clientId === clientId)
    .map(invoice => ({ id: invoice.id, number: invoice.number, status: invoice.status, on: invoice.issueDate, at: invoice.at }));
  return timelineOf({ clientId, logged: listRecords(state, 'venture-crm-entry', venture.id), touches, invoices });
}

export function clientCrmView(state: State, venture: VentureRecord, clientId: string): ClientCrmView {
  const client = clientOf(state, venture, clientId);
  const nameOf = namer(state, venture.id), listName = listNamer(state, venture.id);
  const link = linkOf(state, venture.id, `client:${client.id}`);
  const lists = listRecords(state, 'venture-crm-list-item', venture.id).filter(item => item.member === `client:${client.id}`)
    .map(item => ({ listId: item.listId, name: listName(item.listId) ?? 'A list', stage: item.stage }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return {
    clientId: client.id,
    company: link ? { id: link.companyId, name: nameOf(`company:${link.companyId}`) ?? 'A company' } : null,
    history: historyOf(changesOf(state, venture.id), `client:${client.id}`, nameOf, listName, { at: client.at, line: 'Added to Clients' }),
    timeline: clientTimeline(state, venture, client.id),
    lists,
  };
}

function memberView(state: State, venture: VentureRecord, member: string): CrmMemberView {
  const nameOf = namer(state, venture.id), listName = listNamer(state, venture.id);
  const link = linkOf(state, venture.id, member);
  const client = memberKind(member) === 'client' ? clientOf(state, venture, memberId(member)) : null;
  return {
    member, company: link ? { id: link.companyId, name: nameOf(`company:${link.companyId}`) ?? 'A company' } : null,
    history: historyOf(changesOf(state, venture.id), member, nameOf, listName, client ? { at: client.at, line: 'Added to Clients' } : null),
  };
}

function companyRows(state: State, ventureId: string): CompanyRow[] {
  const links = listRecords(state, 'venture-crm-link', ventureId);
  return listRecords(state, 'venture-company', ventureId).map(company => ({
    id: company.id, name: company.name, domain: company.domain,
    clients: links.filter(link => link.companyId === company.id && memberKind(link.member) === 'client').length,
    people: links.filter(link => link.companyId === company.id && memberKind(link.member) === 'person').length,
  })).sort((a, b) => (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : a.name.toLowerCase() > b.name.toLowerCase() ? 1 : 0));
}

export function companyView(state: State, venture: VentureRecord, companyId: string): CompanyView {
  const company = companyOf(state, venture, companyId);
  const nameOf = namer(state, venture.id), listName = listNamer(state, venture.id);
  const members = listRecords(state, 'venture-crm-link', venture.id).filter(link => link.companyId === company.id).map(link => link.member);
  const refs = (kind: 'client' | 'person') => members.filter(member => memberKind(member) === kind)
    .map(member => ({ id: memberId(member), name: nameOf(member) ?? 'someone no longer here' }))
    .sort((a, b) => (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : a.name.toLowerCase() > b.name.toLowerCase() ? 1 : 0));
  const clients = refs('client');
  const row = companyRows(state, venture.id).find(item => item.id === company.id)!;
  return {
    company: { ...row, note: company.note }, clients, people: refs('person'),
    history: historyOf(changesOf(state, venture.id), `company:${company.id}`, nameOf, listName, { at: company.at, line: 'Added to Companies' }),
    timeline: newestFirst(clients.flatMap(client => clientTimeline(state, venture, client.id))).slice(0, MAX_TIMELINE),
  };
}

function listRows(state: State, ventureId: string): CrmListRow[] {
  const items = listRecords(state, 'venture-crm-list-item', ventureId);
  return listRecords(state, 'venture-crm-list', ventureId)
    .map(list => ({ id: list.id, name: list.name, stages: [...list.stages], count: items.filter(item => item.listId === list.id).length }))
    .sort((a, b) => (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : a.name.toLowerCase() > b.name.toLowerCase() ? 1 : 0));
}

export function listView(state: State, venture: VentureRecord, listId: string): CrmListView {
  const list = listOf(state, venture, listId);
  const nameOf = namer(state, venture.id), listName = listNamer(state, venture.id);
  const items = listRecords(state, 'venture-crm-list-item', venture.id).filter(item => item.listId === list.id);
  return {
    list: listRows(state, venture.id).find(row => row.id === list.id)!,
    groups: listGroups(list, items, nameOf),
    history: historyOf(changesOf(state, venture.id), `list:${list.id}`, nameOf, listName, { at: list.at, line: 'Made this list' }),
    line: LISTS_LINE,
  };
}

// ---------------------------------------------------------------------------
// The methods
// ---------------------------------------------------------------------------

/** venture.crm.client { clientId } (read). */
export async function crmClient(deps: VentureDeps, ctx: Context, payload: unknown): Promise<ClientCrmView> {
  const body = crmPayload(payload, ['clientId'], ['clientId']);
  const { state, venture } = readVenture(deps, ctx);
  return clientCrmView(state, venture, crmId(body.clientId, 'Client'));
}

/**
 * venture.crm.client.edit { clientId, field, value } (prepare, inside the app): the owner's own value for the name, email
 * or note, kept as owner-entered evidence (verified, so it applies at once); the ledger's write-back records the change.
 */
export async function crmClientEdit(deps: VentureDeps, ctx: Context, payload: unknown): Promise<ClientCrmView> {
  requireAppChannel(ctx, 'venture.crm.client.edit');
  const edit = parseClientEdit(payload);
  return ventureAction(deps, ctx, 'prepare', 'crm.client.edit', tx => {
    const venture = tx.venture!;
    const client = clientOf(tx.state, venture, edit.clientId);
    check(client[edit.field] !== edit.value, BAD, `That is the ${edit.field} as it is now.`);
    recordEvidence(tx, { subject: `client:${client.id}`, field: edit.field, value: edit.value, type: 'owner-entered', by: 'owner' });
    return clientCrmView(tx.state, venture, client.id);
  });
}

/** venture.crm.companies {} (read): every company by name, with how many clients and people it has. */
export async function crmCompanies(deps: VentureDeps, ctx: Context, payload: unknown): Promise<CompanyRow[]> {
  crmPayload(payload, []);
  const { state, venture } = readVenture(deps, ctx);
  return companyRows(state, venture.id);
}

/** venture.crm.company { companyId } (read). */
export async function crmCompany(deps: VentureDeps, ctx: Context, payload: unknown): Promise<CompanyView> {
  const body = crmPayload(payload, ['companyId'], ['companyId']);
  const { state, venture } = readVenture(deps, ctx);
  return companyView(state, venture, crmId(body.companyId, 'Company'));
}

/** venture.crm.company.save { companyId?, name?, domain?, note? } (prepare, inside the app): add a company, or change its fields. */
export async function crmCompanySave(deps: VentureDeps, ctx: Context, payload: unknown): Promise<CompanyView> {
  requireAppChannel(ctx, 'venture.crm.company.save');
  const input = parseCompanySave(payload);
  return ventureAction(deps, ctx, 'prepare', 'crm.company.save', tx => {
    const venture = tx.venture!;
    const companies = listRecords(tx.state, 'venture-company', venture.id);
    if (input.name !== undefined) {
      const twin = companies.find(company => company.id !== input.companyId && sameName(company.name, input.name!));
      check(!twin, BAD, `${twin?.name} is kept already.`);
    }
    if (input.companyId === null) {
      check(companies.length < MAX_COMPANIES, BAD, `Chausar keeps up to ${MAX_COMPANIES} companies.`);
      const made = tx.put<CompanyRecord>({ ...tx.base('venture-company'), name: input.name!, domain: input.domain ?? null, note: input.note ?? null });
      return companyView(tx.state, venture, made.id);
    }
    const company = companyOf(tx.state, venture, input.companyId);
    const next: CompanyRecord = { ...company };
    let changed = false;
    for (const field of ['name', 'domain', 'note'] as const) {
      if (input[field] === undefined || input[field] === company[field]) continue;
      crmChange(tx, { subject: `company:${company.id}`, field, before: company[field], after: input[field] ?? null, by: 'owner', ref: null });
      (next as Record<string, unknown>)[field] = input[field];
      changed = true;
    }
    check(changed, BAD, 'That is the company as it is now.');
    tx.replace<CompanyRecord>(next);
    return companyView(tx.state, venture, company.id);
  });
}

/**
 * venture.crm.link { companyId, member } (prepare, inside the app): puts a client or a person in a company, or takes
 * them out (companyId null). The member's history and both companies' histories each get their row. The same link
 * again changes nothing.
 */
export async function crmLink(deps: VentureDeps, ctx: Context, payload: unknown): Promise<CrmMemberView> {
  requireAppChannel(ctx, 'venture.crm.link');
  const input = parseLink(payload);
  return ventureAction(deps, ctx, 'prepare', 'crm.link', tx => {
    const venture = tx.venture!;
    checkMember(tx.state, venture, input.member);
    if (input.companyId !== null) companyOf(tx.state, venture, input.companyId);
    const current = linkOf(tx.state, venture.id, input.member);
    if ((current?.companyId ?? null) === input.companyId) return memberView(tx.state, venture, input.member);
    if (current) {
      tx.state.conversations = tx.state.conversations.filter(record => (record as { id?: string })?.id !== current.id);
      crmChange(tx, { subject: `company:${current.companyId}`, field: 'member', before: input.member, after: null, by: 'owner', ref: null });
    }
    if (input.companyId !== null) {
      tx.put<CrmLinkRecord>({ ...tx.base('venture-crm-link'), companyId: input.companyId, member: input.member });
      crmChange(tx, { subject: `company:${input.companyId}`, field: 'member', before: null, after: input.member, by: 'owner', ref: null });
    }
    crmChange(tx, {
      subject: input.member, field: 'company', before: current ? `company:${current.companyId}` : null,
      after: input.companyId ? `company:${input.companyId}` : null, by: 'owner', ref: null,
    });
    return memberView(tx.state, venture, input.member);
  });
}

/** venture.crm.log { clientId, kind, on, text } (prepare, inside the app): a call, WhatsApp message, meeting or note the owner logs. */
export async function crmLog(deps: VentureDeps, ctx: Context, payload: unknown): Promise<ClientCrmView> {
  requireAppChannel(ctx, 'venture.crm.log');
  const { venture: open } = readVenture(deps, ctx);
  const input = parseLog(payload, localDayAt(deps.clock().toISOString(), open.country));
  return ventureAction(deps, ctx, 'prepare', 'crm.log', tx => {
    const venture = tx.venture!;
    clientOf(tx.state, venture, input.clientId);
    tx.put<CrmEntryRecord>({ ...tx.base('venture-crm-entry'), clientId: input.clientId, entryKind: input.kind, on: input.on, text: input.text });
    return clientCrmView(tx.state, venture, input.clientId);
  });
}

/** venture.crm.lists {} (read): the owner's lists by name, each with its stages and how many it holds. */
export async function crmLists(deps: VentureDeps, ctx: Context, payload: unknown): Promise<CrmListRow[]> {
  crmPayload(payload, []);
  const { state, venture } = readVenture(deps, ctx);
  return listRows(state, venture.id);
}

/** venture.crm.list { listId } (read). */
export async function crmList(deps: VentureDeps, ctx: Context, payload: unknown): Promise<CrmListView> {
  const body = crmPayload(payload, ['listId'], ['listId']);
  const { state, venture } = readVenture(deps, ctx);
  return listView(state, venture, crmId(body.listId, 'List'));
}

/** venture.crm.list.save { listId?, name, stages } (prepare, inside the app): a new list, or a new name and stages for one. */
export async function crmListSave(deps: VentureDeps, ctx: Context, payload: unknown): Promise<CrmListView> {
  requireAppChannel(ctx, 'venture.crm.list.save');
  const input = parseListSave(payload);
  return ventureAction(deps, ctx, 'prepare', 'crm.list.save', tx => {
    const venture = tx.venture!;
    const lists = listRecords(tx.state, 'venture-crm-list', venture.id);
    const twin = lists.find(list => list.id !== input.listId && sameName(list.name, input.name));
    check(!twin, BAD, `${twin?.name} is a list already.`);
    if (input.listId === null) {
      check(lists.length < MAX_LISTS, BAD, `Chausar keeps up to ${MAX_LISTS} lists.`);
      const made = tx.put<CrmListRecord>({ ...tx.base('venture-crm-list'), name: input.name, stages: input.stages });
      return listView(tx.state, venture, made.id);
    }
    const list = listOf(tx.state, venture, input.listId);
    const items = listRecords(tx.state, 'venture-crm-list-item', venture.id).filter(item => item.listId === list.id);
    for (const stage of list.stages) {
      const held = items.filter(item => item.stage === stage).length;
      check(input.stages.includes(stage) || held === 0, BAD, `Move the ${held === 1 ? 'one entry' : `${held} entries`} out of ${stage} first.`);
    }
    const stagesBefore = JSON.stringify(list.stages), stagesAfter = JSON.stringify(input.stages);
    check(list.name !== input.name || stagesBefore !== stagesAfter, BAD, 'That is the list as it is now.');
    crmChange(tx, { subject: `list:${list.id}`, field: 'name', before: list.name, after: input.name, by: 'owner', ref: null });
    crmChange(tx, { subject: `list:${list.id}`, field: 'stages', before: stagesBefore, after: stagesAfter, by: 'owner', ref: null });
    tx.replace<CrmListRecord>({ ...list, name: input.name, stages: input.stages });
    return listView(tx.state, venture, list.id);
  });
}

/**
 * venture.crm.list.place { listId, member, stage } (prepare, inside the app): puts a client, person or company at one of
 * the list's stages, moves it, or takes it out (stage null). Each is a change row on the member. The same stage again
 * changes nothing.
 */
export async function crmListPlace(deps: VentureDeps, ctx: Context, payload: unknown): Promise<CrmListView> {
  requireAppChannel(ctx, 'venture.crm.list.place');
  const input = parseListPlace(payload);
  return ventureAction(deps, ctx, 'prepare', 'crm.list.place', tx => {
    const venture = tx.venture!;
    const list = listOf(tx.state, venture, input.listId);
    checkMember(tx.state, venture, input.member);
    check(input.stage === null || list.stages.includes(input.stage), BAD, `Choose one of the stages of ${list.name}.`);
    const items = listRecords(tx.state, 'venture-crm-list-item', venture.id).filter(item => item.listId === list.id);
    const current = items.find(item => item.member === input.member) ?? null;
    const field = `list.${list.id}`;
    if (input.stage === null) {
      check(current, BAD, `That is not in ${list.name}.`);
      tx.state.conversations = tx.state.conversations.filter(record => (record as { id?: string })?.id !== current.id);
    } else if (current) {
      if (current.stage === input.stage) return listView(tx.state, venture, list.id);
      tx.replace<CrmListItemRecord>({ ...current, stage: input.stage });
    } else {
      check(items.length < MAX_LIST_ENTRIES, BAD, `A list holds up to ${MAX_LIST_ENTRIES} entries.`);
      tx.put<CrmListItemRecord>({ ...tx.base('venture-crm-list-item'), listId: list.id, member: input.member, stage: input.stage });
    }
    crmChange(tx, { subject: input.member, field, before: current?.stage ?? null, after: input.stage, by: 'owner', ref: null });
    return listView(tx.state, venture, list.id);
  });
}

// ---------------------------------------------------------------------------
// Forget
// ---------------------------------------------------------------------------

/**
 * Forget of people (network/forget.ts removePersonData, DPDP), and an import's Undo of the people it made: the change
 * rows about them and their clients, or naming them as a member, go; so do their company links and list places, and
 * the timeline entries the owner logged for their clients. On Forget (erase), what stays loses words that name them:
 * another client's logged entry reads ERASED_ENTRY, a company's note is cleared and a name that holds theirs reads
 * "A company", a list's name "A list", and any change row whose words name them goes.
 */
export function eraseCrmNaming(tx: VentureTx, input: { personIds: ReadonlySet<string>; clientIds: ReadonlySet<string>; erase: boolean; handles: readonly string[]; mentionsName: (text: unknown) => boolean }): void {
  const ventureId = tx.venture!.id;
  const members = new Set([...[...input.personIds].map(id => `person:${id}`), ...[...input.clientIds].map(id => `client:${id}`)]);
  const names = (text: unknown) => input.erase && typeof text === 'string' && (input.mentionsName(text) || input.handles.some(handle => handle && text.toLowerCase().includes(handle.toLowerCase())));
  const drop = new Set<string>();
  for (const record of tx.state.conversations as { id?: string; kind?: string; ventureId?: string; [key: string]: unknown }[]) {
    if (record?.ventureId !== ventureId) continue;
    if (record.kind === 'venture-crm-change') {
      const change = record as unknown as CrmChangeRecord;
      if (members.has(change.subject) || members.has(change.before ?? '') || members.has(change.after ?? '') || names(change.before) || names(change.after)) drop.add(change.id);
    } else if (record.kind === 'venture-crm-link' || record.kind === 'venture-crm-list-item') {
      if (members.has((record as unknown as CrmLinkRecord).member)) drop.add(record.id!);
    } else if (record.kind === 'venture-crm-entry') {
      if (input.clientIds.has((record as unknown as CrmEntryRecord).clientId)) drop.add(record.id!);
    }
  }
  if (drop.size) tx.state.conversations = tx.state.conversations.filter(record => !drop.has((record as { id?: string })?.id ?? ''));
  if (!input.erase) return;
  for (const entry of tx.list('venture-crm-entry')) if (names(entry.text)) tx.replace<CrmEntryRecord>({ ...entry, text: ERASED_ENTRY });
  for (const company of tx.list('venture-company')) {
    const name = names(company.name) ? 'A company' : company.name, note = names(company.note) ? null : company.note;
    if (name !== company.name || note !== company.note) tx.replace<CompanyRecord>({ ...company, name, note });
  }
  for (const list of tx.list('venture-crm-list')) {
    const stages = list.stages.map((stage, index) => (names(stage) ? `Stage ${index + 1}` : stage));
    if (!names(list.name) && stages.every((stage, index) => stage === list.stages[index])) continue;
    tx.replace<CrmListRecord>({ ...list, name: names(list.name) ? 'A list' : list.name, stages });
    for (const item of tx.list('venture-crm-list-item')) {
      const at = list.stages.indexOf(item.stage);
      if (item.listId === list.id && at >= 0 && stages[at] !== item.stage) tx.replace<CrmListItemRecord>({ ...item, stage: stages[at] });
    }
  }
}
