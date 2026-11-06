// Chausar venture launcher, network (Ink v2 wave 4, package 4D1): importing the owner's own files into their network.
// Six kinds of file, all downloaded by the owner: LinkedIn's Connections and Messages exports, a contacts CSV or vCard,
// a calendar ICS and a mail export. The desktop reads the file on the owner's computer and sends only what Chausar
// keeps (extract.ts); the engine reads that projection again as a second guard (projection.ts), and projects a raw file
// itself the same way. Nothing is fetched or scraped. At most 4 MB of text and 20,000 people a file; a line that cannot
// be read refuses the whole file with its line; every refusal leaves the store as it was. One record per person, merged
// by email, phone or LinkedIn address, never by a name alone; a merge records what it moved. Check answers what an
// import would do and stores nothing; Undo removes exactly what one import made, and says first what goes with it.
import { createHash } from 'node:crypto';
import { authorize, check, ChausarError, type Context, type State } from '../../contracts.ts';
import { NETWORK_IMPORT_KINDS } from '../contracts.ts';
import type {
  IsoDate, IsoTime, NetworkAbsorbed, NetworkImportKind, NetworkImportRecord, NetworkImportResult, NetworkImportUndo, NetworkImportView, OpportunityRecord,
  OutreachRecord, PersonFact, PersonRecord, RecordBase, VentureDeps, VentureRecord,
} from '../contracts.ts';
import { exactPayload, formatVentureDate, identifier, listRecords, readVenture, requireAppChannel, requireVenture, singleLine, ventureAction } from '../records.ts';
import { localDayAt } from '../local-day.ts';
import { forgottenFact, forgottenIndex, forgottenMatch, networkKey, removePersonData, withoutForgotten, type ForgottenIndex } from './forget.ts';
import {
  absorb, clientsByEmail, derive, handleKeys, hasIdentity, KIND_LABEL, linkClient, pairKey, repoint, roleWords, splitPairs, unrepoint, writePeople,
} from './people.ts';
import { readImportText, type ReadProjection } from './projection.ts';
import { count, fold, plural, type ParsedEntry } from './text.ts';
import { recomputeTies, writeTies } from './strength.ts';
import { clearAcceptedNotes, markAcceptedNotes } from './accepted.ts';
import { afterImportSearches, headlineEntry, undoImportSearches } from './saved-searches.ts';

/** The largest text Chausar reads at once, in bytes of UTF-8 (the desktop's projection, or a raw file). */
export const MAX_IMPORT_BYTES = 4 * 1024 * 1024;
/** The most people one file may name. */
export const MAX_IMPORT_PEOPLE = 20_000;
export const HOSTED_IMPORT = 'Import your network in the desktop app. It reads the file on your computer.';

/** '6.2' for a size in bytes, to one decimal of a megabyte (1,048,576 bytes), in whole-number arithmetic. */
export function megabytes(bytes: number): string {
  const tenths = Math.round((bytes * 10) / 1_048_576);
  return `${Math.floor(tenths / 10)}.${tenths % 10}`;
}

/** The file's name as the owner sees it: its last path part, one line. */
function fileNameOf(value: unknown): string {
  const text = typeof value === 'string' ? value.split(/[\\/]/).pop() ?? '' : value;
  return singleLine(text, 'The file name', { min: 1, max: 200 });
}

/** The digest an import is known by: the kind and the exact text. The same file again is refused. */
const fileDigest = (kind: NetworkImportKind, text: string) => createHash('sha256').update(`${kind}\n${text}`).digest('hex');

type Parsed = { kind: NetworkImportKind; fileName: string; digest: string; file: ReadProjection };

/** Reads the payload and the file; refuses a hosted call, an unknown kind, a big file and any line it cannot read. */
function readImport(deps: VentureDeps, venture: VentureRecord, body: Record<string, unknown>): Parsed {
  check(deps.host !== 'hosted-web', 'TIER_UNAVAILABLE', HOSTED_IMPORT);
  check(typeof body.kind === 'string' && (NETWORK_IMPORT_KINDS as readonly string[]).includes(body.kind), 'INVALID_VENTURE_REQUEST',
    'Choose one of the files Chausar reads: LinkedIn connections or messages, a contacts CSV or vCard, a calendar file or a mail export.');
  const kind = body.kind as NetworkImportKind;
  const fileName = fileNameOf(body.name);
  check(typeof body.text === 'string', 'INVALID_VENTURE_REQUEST', 'Send the file as text.');
  check(body.check === undefined || typeof body.check === 'boolean', 'INVALID_VENTURE_REQUEST', 'check is true or false.');
  const text = body.text;
  const bytes = Buffer.byteLength(text, 'utf8');
  check(bytes <= MAX_IMPORT_BYTES, 'NETWORK_FILE_TOO_LARGE', `This file is ${megabytes(bytes)} MB; Chausar reads at most 4 MB at once. Export a smaller part and import each one.`);
  check(text.trim().length > 0, 'NETWORK_FILE_INVALID', 'Line 1: the file is empty. Nothing was imported.');
  // today (4D2): meetings after the owner's day bring no one and no path.
  return { kind, fileName, digest: fileDigest(kind, text), file: readImportText(kind, text, venture.country, localDayAt(deps.clock(), venture.country)) };
}

/** Refuses a file this business already imported and has not undone. */
function refuseRepeat(imports: NetworkImportRecord[], digest: string, venture: VentureRecord): void {
  const before = imports.find(record => record.digest === digest && !record.undoneAt);
  if (!before) return;
  throw new ChausarError('NETWORK_ALREADY_IMPORTED',
    `You already imported this file on ${formatVentureDate(localDayAt(before.at, venture.country), venture.country.dateOrder)} (${before.fileName}). Chausar keeps each file once.`);
}

export type ImportPlan = {
  put: PersonRecord[];
  replace: PersonRecord[];
  remove: Set<string>;
  absorbed: NetworkAbsorbed[];
  before: NonNullable<NetworkImportRecord['before']>;
  people: number;
  merged: number;
  kept: number;
  forgottenSkipped: number;
  samples: { name: string; line: string }[];
};

/**
 * What an import does to the network, worked out without writing. Entries matching a forgotten person are left out.
 * The rest join by their handles (union-find over the people already here and this file's entries): the same email,
 * phone or LinkedIn address is one person, and an entry joining two people already here merges them, the younger into
 * the older (hidden if either was, split history carried), unless the owner split those two apart. Each joined entry
 * adds its name, handles and role once per import, and its connection, saved-contact, mail, meeting and message facts
 * with their source line.
 */
export function planImport(input: {
  existing: PersonRecord[]; entries: ParsedEntry[]; kind: NetworkImportKind; importId: string; at: IsoTime; today: IsoDate; by: string;
  forgotten: ForgottenIndex | null; clients: ReadonlyMap<string, string>; newBase: () => RecordBase<'venture-person'>;
}): ImportPlan {
  const { existing } = input;
  const forgottenHit = new Set<string>();
  // 4D3: a LinkedIn headline in a name ("Neha Shah | Founder at Glow") is cut off, and kept as the title when none was given.
  const entries = input.entries.map(headlineEntry).filter(item => {
    const hit = forgottenMatch(input.forgotten, { emails: item.emails, phones: item.phones, linkedinUrl: item.linkedinUrl });
    if (hit) forgottenHit.add(hit);
    return !hit;
  });
  const total = existing.length + entries.length;
  const parent = Array.from({ length: total }, (_, i) => i);
  const members = Array.from({ length: total }, (_, i) => (i < existing.length ? [i] : [] as number[]));
  const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const apart = splitPairs(existing);
  const union = (a: number, b: number) => {
    const ra = find(a), rb = find(b);
    if (ra === rb) return;
    for (const x of members[ra]) for (const y of members[rb]) if (apart.has(pairKey(existing[x].id, existing[y].id))) return;
    parent[rb] = ra;
    members[ra] = [...members[ra], ...members[rb]];
    members[rb] = [];
  };
  const owner = new Map<string, number>();
  existing.forEach((person, i) => { for (const key of handleKeys(person.handles)) if (!owner.has(key)) owner.set(key, i); });
  entries.forEach((item, j) => {
    const node = existing.length + j;
    for (const key of handleKeys({ emails: item.emails, phones: item.phones, linkedinUrl: item.linkedinUrl })) {
      const found = owner.get(key);
      if (found === undefined) owner.set(key, node);
      else union(node, found);
    }
  });
  const groups = new Map<number, number[]>();
  entries.forEach((_, j) => {
    const root = find(existing.length + j);
    groups.set(root, [...(groups.get(root) ?? []), j]);
  });
  check(groups.size <= MAX_IMPORT_PEOPLE, 'NETWORK_FILE_TOO_LARGE',
    `This file names ${count(groups.size)} people; Chausar imports at most ${count(MAX_IMPORT_PEOPLE)} from one file. Split it and import each part.`);

  const plan: ImportPlan = { put: [], replace: [], remove: new Set(), absorbed: [], before: [], people: 0, merged: 0, kept: 0, forgottenSkipped: forgottenHit.size, samples: [] };
  // The people already here as this import leaves them; only the ones it changes are written.
  const current = new Map(existing.map(person => [person.id, person]));
  const changed = new Set<string>();
  let factNo = 0;
  for (const [root, rows] of groups) {
    const here = members[root].slice().sort((a, b) => a - b);
    let person: PersonRecord;
    if (here.length) {
      const original = existing[here[0]];
      person = structuredClone(current.get(original.id)!);
      person.history = [...person.history, { op: 'merge', from: [input.importId], at: input.at, by: input.by }];
      for (const index of here.slice(1)) {
        const other = current.get(existing[index].id)!;
        const merged = absorb(person, other, [...current.values()], { at: input.at, by: input.by, extra: [input.importId] });
        person = merged.target;
        for (const third of merged.remapped) { current.set(third.id, third); changed.add(third.id); }
        plan.absorbed.push({ into: person.id, person: structuredClone(existing[index]), repointed: { cards: [], drafts: [], evidence: [], searches: [], splits: merged.remapped.map(third => third.id) } });
        plan.remove.add(other.id);
        current.delete(other.id);
      }
      plan.merged += 1;
    } else {
      person = { ...input.newBase(), name: '', handles: { emails: [], phones: [], linkedinUrl: null }, role: null, roles: [], facts: [], hidden: false, clientId: null, history: [{ op: 'import', from: [input.importId], at: input.at, by: input.by }] };
      plan.people += 1;
    }
    // Name, handles and role once per import per person; every other fact with its line.
    const seen = new Set(person.facts.filter(fact => fact.source.importId === input.importId).map(fact => `${fact.kind}\n${fold(fact.value)}`));
    const add = (item: ParsedEntry, fact: Omit<PersonFact, 'id' | 'source'>, identity: boolean) => {
      const key = `${fact.kind}\n${fold(fact.value)}`;
      if (identity && seen.has(key)) return;
      seen.add(key);
      factNo += 1;
      person.facts.push({ ...fact, id: `${input.importId}.${factNo}`, source: { connector: input.kind, importId: input.importId, row: item.line } });
    };
    for (const j of rows) {
      const item = entries[j];
      if (item.name) add(item, { kind: 'name', value: item.name, date: null, detail: null }, true);
      for (const email of item.emails) add(item, { kind: 'email', value: email, date: null, detail: null }, true);
      for (const phone of item.phones) add(item, { kind: 'phone', value: phone, date: null, detail: null }, true);
      if (item.linkedinUrl) add(item, { kind: 'linkedin', value: item.linkedinUrl, date: null, detail: null }, true);
      if (item.role) add(item, { kind: 'role', value: roleWords(item.role.title, item.role.company), date: input.today, detail: { title: item.role.title, company: item.role.company } }, true);
      // A forgotten person's address leaves "with" lists, and a title naming them reads "Meeting" (keyed checks).
      for (const fact of item.facts) add(item, withoutForgotten(fact, input.forgotten), false);
    }
    person = linkClient(derive(person), input.clients);
    if (here.length) {
      const original = existing[here[0]];
      current.set(person.id, person);
      changed.add(person.id);
      if (original.clientId !== person.clientId || original.hidden !== person.hidden) {
        plan.before.push({ id: person.id, clientId: original.clientId, hidden: original.hidden, clientIdAfter: person.clientId, hiddenAfter: person.hidden });
      }
    } else plan.put.push(person);
    if (plan.samples.length < 3) plan.samples.push({ name: person.name, line: sampleLine(person) });
  }
  plan.replace = [...changed].filter(id => current.has(id)).map(id => current.get(id)!);
  plan.kept = plan.people + plan.merged;
  return plan;
}

/** A sample's one line: the role, else the first handle. */
function sampleLine(person: PersonRecord): string {
  const role = person.role ? roleWords(person.role.title, person.role.company) : '';
  return role || person.handles.emails[0] || person.handles.phones[0] || person.handles.linkedinUrl || 'No role or address';
}

/** 'Dropped message text, 3 lines; notes, 1.' or ''. */
function droppedWords(dropped: { what: string; count: number }[]): string {
  if (!dropped.length) return '';
  const items = dropped.map(item => (item.what === 'Message text' ? `message text, ${plural(item.count, 'line', 'lines')}` : `${item.what.toLowerCase()}, ${count(item.count)}`));
  return ` Dropped ${items.join('; ')}.`;
}

function forgottenWords(skipped: number): string {
  if (!skipped) return '';
  return skipped === 1 ? ' 1 person you asked Chausar to forget was left out.' : ` ${count(skipped)} people you asked Chausar to forget were left out.`;
}

/** One import as the screens show it. */
export function importView(record: NetworkImportRecord, venture: VentureRecord): NetworkImportView {
  const day = formatVentureDate(localDayAt(record.at, venture.country), venture.country.dateOrder);
  const undone = record.undoneAt ? ` Undone on ${formatVentureDate(localDayAt(record.undoneAt, venture.country), venture.country.dateOrder)}.` : '';
  return {
    id: record.id, kind: record.importKind, fileName: record.fileName, at: record.at, rows: record.rows, people: record.people, merged: record.merged,
    dropped: record.dropped, undone: record.undoneAt !== null,
    line: `${KIND_LABEL[record.importKind]}, ${record.fileName}, imported ${day}: ${count(record.people)} new, ${count(record.merged)} already in your network.${undone}`,
  };
}

function planFor(deps: VentureDeps, state: State, venture: VentureRecord, parsed: Parsed, importId: string, at: IsoTime, by: string, newBase: () => RecordBase<'venture-person'>): ImportPlan {
  return planImport({
    existing: listRecords(state, 'venture-person', venture.id), entries: parsed.file.entries, kind: parsed.kind, importId, at,
    today: localDayAt(at, venture.country), by, forgotten: forgottenIndex(listRecords(state, 'venture-forgotten', venture.id), networkKey(deps)),
    clients: clientsByEmail(listRecords(state, 'venture-client', venture.id)), newBase,
  });
}

/**
 * venture.network.import { kind, name, text, check? } (approve, inside the app; never on the hosted app). text is the
 * desktop's projection of the owner's file, or the raw file. check: true answers what the import would keep and drop,
 * with three samples, and stores nothing. Otherwise one transaction writes the people and one venture-network-import
 * record; any refusal leaves the store as it was.
 */
export async function networkImport(deps: VentureDeps, ctx: Context, payload: unknown): Promise<NetworkImportResult> {
  requireAppChannel(ctx, 'venture.network.import');
  const body = exactPayload(payload, ['kind', 'name', 'text', 'check'], ['kind', 'name', 'text']);
  check(deps.host !== 'hosted-web', 'TIER_UNAVAILABLE', HOSTED_IMPORT);
  authorize(deps.store, ctx, 'approve');
  if (body.check === true) {
    const state = deps.store.read();
    const venture = requireVenture(state);
    const parsed = readImport(deps, venture, body);
    refuseRepeat(listRecords(state, 'venture-network-import', venture.id), parsed.digest, venture);
    const at = deps.clock().toISOString();
    let n = 0;
    const plan = planFor(deps, state, venture, parsed, 'netimport_check', at, ctx.memberId,
      () => ({ id: `person_check_${(n += 1)}`, kind: 'venture-person', ventureId: venture.id, memberId: ctx.memberId, epoch: ctx.epoch, at }));
    const dropped = parsed.file.dropped;
    return {
      mode: 'check', kept: plan.kept, dropped, people: plan.people, merged: plan.merged, samples: plan.samples,
      line: `Chausar would keep ${plural(plan.kept, 'person', 'people')} from ${parsed.fileName}: ${count(plan.people)} new, ${count(plan.merged)} already in your network.${droppedWords(dropped)}${forgottenWords(plan.forgottenSkipped)} Nothing is saved until you import.`,
    };
  }
  return ventureAction(deps, ctx, 'approve', 'network.import', tx => {
    const venture = tx.venture!;
    const parsed = readImport(deps, venture, body);
    refuseRepeat(tx.list('venture-network-import'), parsed.digest, venture);
    const base = tx.base('venture-network-import');
    const plan = planFor(deps, tx.state, venture, parsed, base.id, tx.now, ctx.memberId, () => tx.base('venture-person'));
    writePeople(tx, { put: plan.put, replace: plan.replace, remove: plan.remove });
    for (const item of plan.absorbed) Object.assign(item.repointed, repoint(tx, item.person.id, item.into));
    const dropped = parsed.file.dropped;
    const record = tx.put<NetworkImportRecord>({
      ...base, importKind: parsed.kind, fileName: parsed.fileName, digest: parsed.digest, rows: parsed.file.rows, people: plan.people, merged: plan.merged,
      dropped, forgottenSkipped: plan.forgottenSkipped, undoneAt: null,
      ...(plan.absorbed.length ? { absorbed: plan.absorbed } : {}), ...(plan.before.length ? { before: plan.before } : {}),
    });
    // After an import, one line each, in this order: 4D2 works the ties out again, 4D3 re-runs saved searches and
    // notes job changes, 4E2 marks connection notes LinkedIn's export shows accepted.
    recomputeTies(tx);
    afterImportSearches(tx, record);
    markAcceptedNotes(tx, record);
    return {
      mode: 'import', import: importView(record, venture),
      line: `Imported ${plural(plan.kept, 'person', 'people')} from ${parsed.fileName}: ${count(plan.people)} new, ${count(plan.merged)} already in your network.${droppedWords(dropped)}${forgottenWords(plan.forgottenSkipped)}`,
    };
  });
}

type UndoPlan = { replace: PersonRecord[]; put: PersonRecord[]; gone: PersonRecord[]; restored: NetworkAbsorbed[]; goes: string[] };

/**
 * What undoing one import does, worked out without writing. People it merged away come back as they were (without
 * facts from imports undone since, and never one the owner asked Chausar to forget); facts and history entries it made
 * come off everyone; client links and hidden flags it changed go back where nothing changed them since; people left
 * with nothing of their own go, and goes names the pipeline cards and drafts that would go with them.
 */
function undoPlan(state: State, ventureId: string, record: NetworkImportRecord, index: ForgottenIndex | null, skipCopies: boolean): UndoPlan {
  const undone = new Set(listRecords(state, 'venture-network-import', ventureId).filter(item => item.undoneAt).map(item => item.id));
  undone.add(record.id);
  const people = new Map(listRecords(state, 'venture-person', ventureId).map(person => [person.id, person]));
  const touched = new Set<string>();
  const put: PersonRecord[] = [], restored: NetworkAbsorbed[] = [];
  for (const item of skipCopies ? [] : [...(record.absorbed ?? [])].reverse()) {
    const target = people.get(item.into);
    if (!target || people.has(item.person.id) || forgottenMatch(index, item.person.handles)) continue;
    const theirs = new Set(item.person.facts.map(fact => fact.id));
    people.set(item.into, { ...target, facts: target.facts.filter(fact => !theirs.has(fact.id)) });
    touched.add(item.into);
    const back = derive({
      ...item.person,
      facts: item.person.facts.filter(fact => (!fact.source.importId || !undone.has(fact.source.importId)) && !forgottenFact(index, fact)).map(fact => withoutForgotten(fact, index)),
    });
    if (!hasIdentity(back)) continue;
    put.push(back);
    restored.push(item);
    for (const id of item.repointed.splits) {
      const third = people.get(id);
      if (!third) continue;
      people.set(id, { ...third, history: third.history.map(entry => (entry.op === 'split' && entry.from[0] === item.into ? { ...entry, from: [back.id, ...entry.from.slice(1)] } : entry)) });
      touched.add(id);
    }
  }
  for (const item of record.before ?? []) {
    const person = people.get(item.id);
    if (!person) continue;
    const clientId = person.clientId === item.clientIdAfter ? item.clientId : person.clientId;
    const hidden = person.hidden === item.hiddenAfter ? item.hidden : person.hidden;
    if (clientId !== person.clientId || hidden !== person.hidden) { people.set(item.id, { ...person, clientId, hidden }); touched.add(item.id); }
  }
  const replace: PersonRecord[] = [], gone: PersonRecord[] = [];
  for (const person of people.values()) {
    const facts = person.facts.filter(fact => fact.source.importId !== record.id);
    const history = person.history.filter(entry => !entry.from.includes(record.id));
    if (facts.length === person.facts.length && history.length === person.history.length && !touched.has(person.id)) continue;
    const next = derive({ ...person, facts, history });
    if (!hasIdentity(next)) gone.push(person);
    else replace.push(next);
  }
  const cards = listRecords(state, 'venture-opportunity', ventureId) as OpportunityRecord[];
  const drafts = listRecords(state, 'venture-outreach', ventureId) as OutreachRecord[];
  const goes = gone.flatMap(person => {
    const theirCards = cards.filter(card => card.personId === person.id).map(card => card.id);
    const theirDrafts = drafts.filter(draft => draft.personId === person.id || (draft.opportunityId !== null && theirCards.includes(draft.opportunityId))).length;
    const parts = [...(theirCards.length ? [theirCards.length === 1 ? 'a pipeline card' : `${count(theirCards.length)} pipeline cards`] : []), ...(theirDrafts ? [plural(theirDrafts, 'draft', 'drafts')] : [])];
    return parts.length ? [`${person.name}: ${parts.join(' and ')}`] : [];
  });
  return { replace, put, gone, restored, goes };
}

/**
 * Undo goes newest first among imports that merged the same people: an older import is refused while a later live one
 * kept an Undo copy holding facts this import made or moved, and the refusal names the import to undo first.
 */
function refuseOutOfOrder(imports: NetworkImportRecord[], record: NetworkImportRecord): void {
  const moved = new Set((record.absorbed ?? []).flatMap(item => item.person.facts.map(fact => fact.id)));
  const later = imports.slice(imports.findIndex(item => item.id === record.id) + 1).filter(item => !item.undoneAt);
  const blocking = later.reverse().find(item => (item.absorbed ?? []).some(copy => copy.person.facts.some(fact => fact.source.importId === record.id || moved.has(fact.id))));
  check(!blocking, 'INVALID_VENTURE_REQUEST', `Undo ${blocking?.fileName} first: it merged people this import also changed. Then undo this one.`);
}

/** The forgotten list for an Undo: when its checks cannot run (no key), no Undo copy is restored. */
function undoIndex(deps: VentureDeps, state: State, ventureId: string): { index: ForgottenIndex | null; skipCopies: boolean } {
  try { return { index: forgottenIndex(listRecords(state, 'venture-forgotten', ventureId), networkKey(deps)), skipCopies: false }; }
  catch { return { index: null, skipCopies: true }; }
}

/**
 * venture.network.importUndo { importId, preview? } (approve, inside the app): removes exactly what one import made, as
 * undoPlan says. preview: true answers what would go (the people, and the owner-made cards and drafts with them) and
 * changes nothing. The import is marked undone, so the same file may be imported again.
 */
export async function networkImportUndo(deps: VentureDeps, ctx: Context, payload: unknown): Promise<NetworkImportUndo> {
  requireAppChannel(ctx, 'venture.network.importUndo');
  const body = exactPayload(payload, ['importId', 'preview'], ['importId']);
  const importId = identifier(body.importId, 'importId');
  check(body.preview === undefined || typeof body.preview === 'boolean', 'INVALID_VENTURE_REQUEST', 'preview is true or false.');
  const findRecord = (records: NetworkImportRecord[]) => {
    const record = records.find(item => item.id === importId);
    check(record, 'INVALID_VENTURE_REQUEST', 'This import is not in this business.');
    check(!record.undoneAt, 'INVALID_VENTURE_REQUEST', 'This import was undone already.');
    return record;
  };
  if (body.preview === true) {
    authorize(deps.store, ctx, 'approve');
    const { state, venture } = readVenture(deps, ctx);
    const imports = listRecords(state, 'venture-network-import', venture.id);
    const record = findRecord(imports);
    refuseOutOfOrder(imports, record);
    const forgotten = undoIndex(deps, state, venture.id);
    const plan = undoPlan(state, venture.id, record, forgotten.index, forgotten.skipCopies);
    return {
      import: importView(record, venture), removed: plan.gone.length, goes: plan.goes, preview: true,
      line: `Undo would remove ${plural(plan.gone.length, 'person', 'people')} this import brought in, and take off what it added to others.${plan.goes.length ? ` Owner-made work goes with them: ${plan.goes.join('; ')}.` : ''} Nothing has changed yet.`,
    };
  }
  return ventureAction(deps, ctx, 'approve', 'network.importUndo', tx => {
    const imports = tx.list('venture-network-import');
    const record = findRecord(imports);
    refuseOutOfOrder(imports, record);
    const venture = tx.venture!;
    const forgotten = undoIndex(deps, tx.state, venture.id);
    const plan = undoPlan(tx.state, venture.id, record, forgotten.index, forgotten.skipCopies);
    writePeople(tx, { replace: plan.replace, put: plan.put });
    for (const item of plan.restored) unrepoint(tx, item);
    const removed = removePersonData(tx, plan.gone, { erase: false });
    const updated = tx.replace<NetworkImportRecord>({ ...record, undoneAt: tx.now, ...(record.absorbed ? { absorbed: [] } : {}), ...(record.before ? { before: [] } : {}) });
    if (removed.cards || removed.drafts) tx.emit('pipeline.changed', {});
    writeTies(tx); // 4D2: no tie keeps strength the undone file gave
    undoImportSearches(tx, record.id); // 4D3: the saved-search matches and job changes the undone file showed go
    clearAcceptedNotes(tx, record); // 4E2: connection notes only the undone file showed accepted are not accepted any more
    return {
      import: importView(updated, venture), removed: plan.gone.length, goes: plan.goes, preview: false,
      line: `Undid ${updated.fileName}: ${plural(plan.gone.length, 'person', 'people')} it brought in ${plan.gone.length === 1 ? 'is' : 'are'} gone, and what it added to others came off.${plan.goes.length ? ` With them went ${plan.goes.join('; ')}.` : ''}`,
    };
  });
}
