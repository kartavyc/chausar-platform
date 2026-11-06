// Chausar venture launcher, agents (Ink v2 wave 4, package 4B2, catalogue A5 and A6, spec 5.2): an agent's notes, which
// the owner reads, corrects, forgets and undoes. A note is kept only in the owner's own words: typed in the agent's
// notes, or proposed from the owner's message in its thread and accepted (proposals.ts). Every change is a change row
// with who made it and the note before and after, so an edit can be undone exactly; a correction carries the hash of
// the note it was based on and is refused if the note changed since. Forget removes a note by its id, never by asking a
// model, and erases its words everywhere Chausar kept them (the note, its change rows, the proposal card, the owner's
// message it came from and the finished model calls that carried it), so it cannot be undone; instructions the owner
// approved and the owner's other messages keep their words. Forget of a person in the owner's network erases every note, change,
// proposal and message that names them (eraseNotesNaming, DPDP). A note never tells the agent to act on the floor,
// money, tools, checks or limits, never states money, never holds a number the owner did not say or a card, bank
// account, Aadhaar or one-time code number (recall.ts has the rules and the masks). A name Chausar cannot place on one
// client (two clients called Meera, a name in another script, someone only in the network) is asked about, never kept
// agent-wide. The notes an agent always reads stay within 2,000 characters, and it keeps at most 40 about one client.
import { ChausarError, check, type Context, type State } from '../../contracts.ts';
import type {
  AgentNoteChange, AgentNoteChangeRecord, AgentNoteLoad, AgentNoteRecord, AgentNoteScope, AgentNotesView, AgentNoteView, AgentProposalRecord, ClientRecord,
  NoteChangeView, NoteSnapshot, VentureDeps, VentureRecord,
} from '../contracts.ts';
import { digest, exactPayload, identifier, listRecords, plainText, requireAppChannel, tidyWords, ventureAction, type VentureTx } from '../records.ts';
import { localDayAt } from '../local-day.ts';
import { plainHindi, unsaidFigure } from '../delivery/harness/patches.ts';
import { readAs } from '../delivery/shared.ts';
import { listPeople } from '../network/store.ts';
import { holdsIdNumber } from './answer.ts';
import { chatAgent, type ChatAgent } from './roles.ts';
import { ACT_STEP_KINDS, ALWAYS_LIMIT, holdsWords, maskNote, noteRefusal, noteText, scopeClient, screenIds, type NoteProblem } from './recall.ts';
import { eraseKnowledgeHolding } from './knowledge.ts';

export type { NoteProblem } from './recall.ts';

/** The longest one note may be. */
export const MAX_NOTE = 600;
/** The most notes an agent keeps about one client. */
export const CLIENT_NOTES = 40;
/** The line the owner reads before Forget. */
export const FORGET_LINE = "Forget erases these words. You can't undo it.";
export const NOTE_CHANGED_LINE = 'This note changed since you opened it. Your draft is still here.';
export const NOTE_ID_REFUSED = 'That looks like a card, bank account, Aadhaar or one-time code number. Notes never keep those, so nothing was saved.';
/** What an owner's message becomes once the note it made is forgotten. */
export const ERASED_MESSAGE = 'Erased: you asked me to forget these words.';
/** What a message becomes once a person it named is forgotten. */
export const ERASED_NAMED = 'Erased: it named someone you asked Chausar to forget.';
/** What a finished model call's stored text becomes once it carried a note the owner forgot. */
export const ERASED_CALL = 'Erased: you asked Chausar to forget these words.';
/** The Forget reply: what is erased, and what keeps its words. */
const FORGOT_LINE = 'You forgot a note. Its words are erased. Instructions you approved and your other messages keep their words.';
const FORGET_FINAL = "Forget erased this note's words, so it can't be undone.";
const UNSAID_NUMBER = 'That note has a number you did not say. A note keeps only the numbers in your own words.';
const TOO_SHORT = 'Tell me what to remember in a few words.';
const TOO_LONG = `That is too long for a note. Keep it under ${MAX_NOTE} characters.`;
const NOT_FOUND = 'That note was not found.';

// ---------------------------------------------------------------------------
// The owner's words as a note
// ---------------------------------------------------------------------------

/** Words that only say "remember" before the note: remember (that, to), keep in mind, note (that), and the Hindi twins याद रखना, ध्यान रखना (कि). */
const LEAD = /^\s*(?:(?:please|pls|also|and|ok|okay)[\s,]+)*(?:remember|keep\s+in\s+mind|please\s+note|note|yaad\s+rakh(?:na|o|ein|en|iye|iyega)|dhyan\s+rakh(?:na|o|ein|en|iye)|याद\s+(?:रखना|रखें|रखिए|रखो)|ध्यान\s+(?:रखना|रखें|रखिए|रखो))(?:\s+(?:that|this|to|ki|कि))?(?:\s*[,:;.-]\s*|\s+|$)/iu;
/** The same words after the note: ", remember", ", keep that in mind", ", याद रखना". */
const TAIL = /[\s,;:.-]*(?:(?:please\s+)?remember(?:\s+(?:that|this|it))?|keep\s+(?:that|this|it)\s+in\s+mind|yaad\s+rakh(?:na|o|ein|en|iye|iyega)|dhyan\s+rakh(?:na|o|ein|en|iye)|याद\s+(?:रखना|रखें|रखिए|रखो)|ध्यान\s+(?:रखना|रखें|रखिए|रखो))\s*[.!।]?\s*$/iu;

/**
 * The note the owner's words make, in their own words, tidied: "remember that" (and its twins) taken off the start or
 * the end, spaces collapsed, the first letter capitalised and a full stop added after English words. No word is added
 * or changed.
 */
export function noteValue(words: string): string {
  const rest = tidyWords(words).replace(LEAD, '').replace(TAIL, '').trim();
  if (!rest) return '';
  const first = rest.charAt(0).toUpperCase() + rest.slice(1);
  return /[\p{Script=Latin}\p{Nd}]$/u.test(first) ? `${first}.` : first;
}

/** A note's words compared as the same note: tidied, in lower case. */
export const noteKey = (text: string): string => tidyWords(text).toLowerCase();

// ---------------------------------------------------------------------------
// Which client a note is about
// ---------------------------------------------------------------------------

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const fold = (text: string) => plainHindi(text.normalize('NFKC')).toLowerCase();
const EDGE = '[\\p{L}\\p{M}\\p{Nd}]';
/** True when the words hold the name, whole, in any case and either way of writing a nukta. */
const holdsName = (words: string, name: string) => new RegExp(`(?<!${EDGE})${escaped(fold(name))}(?!${EDGE})`, 'u').test(fold(words));
/** True when the words hold the name written as a name: with a capital letter (a script without capitals as it is). */
const holdsProperName = (words: string, name: string) => {
  const proper = /\p{Lu}|\p{Ll}/u.test(name) ? name.charAt(0).toUpperCase() + name.slice(1).toLowerCase() : name;
  return new RegExp(`(?<!${EDGE})${escaped(proper.normalize('NFKC'))}(?!${EDGE})`, 'u').test(words.normalize('NFKC'));
};
const partsOf = (name: string) => name.trim().split(/\s+/).filter(part => part.length >= 3);
const DEVANAGARI = /[ऀ-ॿ]/u;
/** Devanagari consonants as the Latin letter they sound like, for comparing a name across scripts (vowels, ह and य left out). */
const SOUNDS: Readonly<Record<string, string>> = Object.freeze({
  'क': 'k', 'ख': 'k', 'ग': 'g', 'घ': 'g', 'ङ': 'n', 'च': 'c', 'छ': 'c', 'ज': 'j', 'झ': 'j', 'ञ': 'n', 'ट': 't', 'ठ': 't', 'ड': 'd', 'ढ': 'd',
  'ण': 'n', 'त': 't', 'थ': 't', 'द': 'd', 'ध': 'd', 'न': 'n', 'प': 'p', 'फ': 'p', 'ब': 'b', 'भ': 'b', 'म': 'm', 'र': 'r', 'ल': 'l', 'ळ': 'l',
  'व': 'v', 'श': 's', 'ष': 's', 'स': 's', 'ं': 'n', 'ँ': 'n',
});
/** Common Hindi words a name's sound could be mistaken for (my, your, this, has, remember ...). */
const COMMON_HINDI: ReadonlySet<string> = new Set([
  'मेरा', 'मेरी', 'मेरे', 'तेरा', 'तेरी', 'तेरे', 'हमारा', 'हमारी', 'हमारे', 'आपका', 'आपकी', 'आपके', 'उसका', 'उसकी', 'उसके', 'इसका', 'इसकी', 'इसके',
  'उनका', 'उनकी', 'उनके', 'है', 'हैं', 'था', 'थी', 'थे', 'में', 'से', 'पर', 'और', 'कि', 'भी', 'नहीं', 'तो', 'हो', 'कर', 'करना', 'करो', 'करें',
  'रखना', 'रखो', 'याद', 'ध्यान', 'लिए', 'साथ', 'बाद', 'पहले', 'अब', 'आगे', 'हमेशा', 'कभी', 'सब', 'कुछ', 'बहुत', 'यह', 'वह', 'ये', 'वो', 'जब', 'तब',
  'क्या', 'क्यों', 'कैसे', 'कौन', 'कहाँ', 'तारीख', 'तक', 'चाहिए', 'वाला', 'वाली', 'वाले', 'बार', 'दिन', 'हर', 'नंबर', 'बदल', 'गया', 'गई', 'गए',
]);

/** A name's sound for comparing across scripts: its consonants as Latin letters, repeats once. */
function soundOf(word: string): string {
  let sound: string;
  if (DEVANAGARI.test(word)) sound = [...word.normalize('NFD')].map(char => SOUNDS[char] ?? '').join('');
  else {
    sound = word.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
      .replace(/ch/g, 'C').replace(/sh/g, 's').replace(/([tdbpkgj])h/g, '$1').replace(/[cq]/g, 'k').replace(/C/g, 'c')
      .replace(/f/g, 'p').replace(/w/g, 'v').replace(/z/g, 'j').replace(/x/g, 'ks').replace(/[^bcdgjklmnprstv]/g, '');
  }
  return sound.replace(/(.)\1+/g, '$1');
}

/** Where a note's words belong: one client, nowhere in particular (the agent's own), or a question for the owner. */
export type Placement = { client: ClientRecord | null } | { ask: string };

/**
 * The client of this business the owner's words name, by code. A full name (a client's, or a network contact's who is
 * a client) places the note with that client; a first name places it only when one client has it. Two clients called
 * Meera, a contact who is in the owner's network but not a client, and a name written in another script than the
 * client's (मीरा for Meera) are asked about ("Which Meera?"), never kept agent-wide.
 */
export function placeNote(state: State, venture: VentureRecord, words: string): Placement {
  const clients = listRecords(state, 'venture-client', venture.id).filter(client => client.name.trim().length >= 3);
  const clientOf = (id: string | null) => (id ? clients.find(client => client.id === id) ?? null : null);
  const people = listPeople(state, venture.id).filter(person => person.name.trim().length >= 3 && !person.name.includes('@'));
  const named = (list: string[]) => `Which client is this about, ${list.join(' or ')}? A note is kept with one client.`;
  const network = (first: string) => `Which ${first}? ${first} is in your network but not one of your clients, and a note about a person is kept only with a client.`;

  // Full names first, the longest kept when one holds another.
  const full = new Map<string, ClientRecord>();
  for (const client of clients) if (holdsName(words, client.name)) full.set(client.id, client);
  for (const person of people) { const client = clientOf(person.clientId); if (client && holdsName(words, person.name)) full.set(client.id, client); }
  const kept = [...full.values()].sort((a, b) => b.name.length - a.name.length).filter((client, index, all) => !all.slice(0, index).some(other => fold(other.name).includes(fold(client.name))));
  if (kept.length > 1) return { ask: named(kept.map(client => client.name)) };
  if (kept.length === 1) return { client: kept[0] };
  const contact = people.find(person => !clientOf(person.clientId) && holdsName(words, person.name));
  if (contact) return { ask: network(partsOf(contact.name)[0] ?? contact.name) };

  // First names: any client's; a network contact's only when written as a name.
  const firsts: { target: string; first: string; client: ClientRecord | null }[] = [];
  for (const client of clients) { const first = partsOf(client.name)[0]; if (first && holdsName(words, first)) firsts.push({ target: client.id, first, client }); }
  for (const person of people) {
    const first = partsOf(person.name)[0];
    if (!first || !holdsProperName(words, first)) continue;
    const client = clientOf(person.clientId);
    firsts.push({ target: client?.id ?? person.id, first, client });
  }
  const targets = new Map(firsts.map(item => [item.target, item]));
  if (targets.size > 1) {
    const sameFirst = new Set(firsts.map(item => fold(item.first))).size === 1;
    return { ask: sameFirst ? `Which ${firsts[0].first}? Write the full name as it is in Clients.` : named([...targets.values()].map(item => item.client?.name ?? item.first)) };
  }
  if (targets.size === 1) {
    const only = [...targets.values()][0];
    return only.client ? { client: only.client } : { ask: network(only.first) };
  }

  // A client's name written in the other script: asked about, never guessed.
  for (const token of words.matchAll(/[\p{L}\p{M}]+/gu)) {
    const word = token[0];
    if (word.length < 3 || COMMON_HINDI.has(word) || (!DEVANAGARI.test(word) && !/^\p{Lu}/u.test(word))) continue;
    const sound = soundOf(word);
    if (sound.length < 2) continue;
    const matches = clients.some(client => client.name.trim().split(/\s+/).some(part => DEVANAGARI.test(part) !== DEVANAGARI.test(word) && soundOf(part) === sound));
    if (matches) return { ask: `Which ${word}? Write the full name as it is in Clients.` };
  }
  return { client: null };
}

// ---------------------------------------------------------------------------
// The rules a note passes
// ---------------------------------------------------------------------------

/** A note as it will be kept: its words after the masks, its scope and how it loads, and the client it is about. */
export type NoteDraft = { text: string; scope: AgentNoteScope; load: AgentNoteLoad; client: ClientRecord | null };

/**
 * Checks words for a note, by code. text: the note's words; quote: the owner's own words they came from (the same for
 * a note the owner typed). options.scope: the scope the owner already saw (accepting a proposal); options.fallback: a
 * correction's own scope, kept when its words name no client. Else the words are placed (placeNote): with the client
 * they name, the agent's own when they name none, or refused with a question. The words are then masked (maskNote) and
 * refused when they hold an id number, fail the note rules (recall.ts noteRefusal) or hold a number the owner did not say.
 */
export function draftNote(state: State, venture: VentureRecord, text: string, quote: string, options: { scope?: AgentNoteScope; fallback?: AgentNoteScope } = {}): NoteDraft | NoteProblem {
  const words = tidyWords(text);
  if (words.length < 2) return { code: 'INVALID_VENTURE_REQUEST', reason: TOO_SHORT };
  if (words.length > MAX_NOTE) return { code: 'INVALID_VENTURE_REQUEST', reason: TOO_LONG };
  let client: ClientRecord | null = null;
  let scope: AgentNoteScope;
  if (options.scope !== undefined) {
    scope = options.scope;
    client = listRecords(state, 'venture-client', venture.id).find(item => item.id === scopeClient(scope)) ?? null;
  } else {
    const placed = placeNote(state, venture, quote === text ? words : quote);
    if ('ask' in placed) return { code: 'INVALID_VENTURE_REQUEST', reason: placed.ask };
    client = placed.client;
    scope = client ? `client:${client.id}` : options.fallback ?? 'agent';
    if (!client && options.fallback) client = listRecords(state, 'venture-client', venture.id).find(item => item.id === scopeClient(options.fallback!)) ?? null;
  }
  if (holdsIdNumber(screenIds(words, scope))) return { code: 'CHAT_KEY_REFUSED', reason: NOTE_ID_REFUSED };
  const masked = maskNote(words, scope);
  const refused = noteRefusal(masked, quote);
  if (refused) return refused;
  if (unsaidFigure(masked, quote)) return { code: 'INVALID_VENTURE_REQUEST', reason: UNSAID_NUMBER };
  return { text: masked, scope, load: scopeClient(scope) === null ? 'always' : 'topic', client };
}

export const isProblem = (draft: NoteDraft | NoteProblem): draft is NoteProblem => 'reason' in draft;

/** Where a note reaches, in honest words: the steps that work on an order's files read it; a writer's notes wait. */
export function noteReach(agent: ChatAgent, draft: Pick<NoteDraft, 'client'>): string {
  if (!agent.steps.some(step => ACT_STEP_KINDS.has(step.kind))) {
    return `${agent.name} keeps this note, but runs do not read it yet: notes reach only the steps that work on an order's files.`;
  }
  return draft.client
    ? `${agent.name} reads this note when it works on ${draft.client.name}'s files and the note fits the order.`
    : `${agent.name} reads this note whenever it works on an order's files.`;
}

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

const hashOf = (draft: Pick<NoteSnapshot, 'text' | 'scope' | 'load'>) => digest({ text: draft.text, scope: draft.scope, load: draft.load });
const blank = (snapshot: NoteSnapshot | null): NoteSnapshot | null => (snapshot ? { ...snapshot, text: '', hash: '' } : null);

/** The note as a change row keeps it, or null when it is forgotten (or not there). */
function snapshotOf(note: AgentNoteRecord | null | undefined): NoteSnapshot | null {
  return note && !note.forgotten ? { text: note.text, hash: note.hash, scope: note.scope, load: note.load } : null;
}

/** The agent's notes in use (not forgotten), in the order they were saved. */
export function agentNotes(state: State, venture: VentureRecord, agentId: string): AgentNoteRecord[] {
  return listRecords(state, 'venture-agent-note', venture.id).filter(note => note.agent === agentId && !note.forgotten);
}

/**
 * Why the agent has no room for a note, or null: the notes it always reads stay within 2,000 characters in all, and it
 * keeps at most 40 notes about one client. replacing: the note a correction or undo changes.
 */
export function roomProblem(state: State, venture: VentureRecord, agent: Pick<ChatAgent, 'id' | 'name'>, next: Pick<NoteSnapshot, 'text' | 'scope' | 'load'>, replacing: string | null): string | null {
  const others = agentNotes(state, venture, agent.id).filter(note => note.id !== replacing);
  if (next.load === 'always') {
    const used = others.filter(note => note.load === 'always').reduce((sum, note) => sum + note.text.length, 0);
    return used + next.text.length <= ALWAYS_LIMIT ? null : `The notes ${agent.name} always reads are full: 2,000 characters in all. Shorten or forget one first.`;
  }
  if (others.filter(note => note.scope === next.scope).length < CLIENT_NOTES) return null;
  const client = listRecords(state, 'venture-client', venture.id).find(item => item.id === scopeClient(next.scope));
  return `${agent.name} keeps ${CLIENT_NOTES} notes about ${client?.name ?? 'this client'} already. Forget one first.`;
}

/** Refuses a note the agent has no room for (NOTES_FULL, roomProblem). */
export function checkRoom(state: State, venture: VentureRecord, agent: Pick<ChatAgent, 'id' | 'name'>, next: Pick<NoteSnapshot, 'text' | 'scope' | 'load'>, replacing: string | null): void {
  const problem = roomProblem(state, venture, agent, next, replacing);
  check(problem === null, 'NOTES_FULL', problem ?? '');
}

/** Model calls that are over (answered, failed or expired); a preview still waiting is made again before it can go (runs.ts). */
const FINISHED_CALLS: ReadonlySet<string> = new Set(['completed', 'failed', 'expired']);

/**
 * Erases one note's words everywhere Chausar kept them: the note (and the owner's words its source quotes), every
 * change row of it, the note proposals that made it or held the same words and the owner's messages they came from,
 * the agent's own replies that repeat the words, and the stored text of every finished model call that carried them
 * (an act turn, a chat answer): that text becomes ERASED_CALL and the call gets erasedAt, keeping its digest, ids, costs
 * and times. The ids and times stay everywhere, so the thread and the journal still show that something was there.
 * Instructions the owner approved (playbook versions) and the owner's other messages keep their words.
 */
function eraseNote(tx: VentureTx, note: AgentNoteRecord): AgentNoteRecord {
  const rows = tx.list('venture-agent-note-change').filter(change => change.noteId === note.id);
  const texts = [...new Set([note.text, ...rows.flatMap(row => [row.before?.text ?? '', row.after?.text ?? ''])].filter(Boolean))];
  const keys = new Set(texts.map(noteKey));
  const holds = (value: unknown) => typeof value === 'string' && texts.some(text => holdsWords(value, text) || noteKey(value).includes(noteKey(text)));
  for (const row of rows) tx.replace<AgentNoteChangeRecord>({ ...row, before: blank(row.before), after: blank(row.after) });
  eraseKnowledgeHolding(tx, texts); // 4J18: a source in what the AI knows that repeats these words loses them too
  const proposals = tx.list('venture-agent-proposal').filter(item => item.agent === note.agent && item.proposalKind === 'note'
    && ((note.source.messageId !== null && item.messageId === note.source.messageId) || (!!item.note?.text && keys.has(noteKey(item.note.text)))));
  for (const item of proposals) tx.replace<AgentProposalRecord>({ ...item, quote: '', quoteDigest: '', note: item.note ? { ...item.note, text: '' } : null });
  const sources = new Set([note.source.messageId, ...proposals.map(item => item.messageId)].filter((id): id is string => id !== null));
  for (const message of tx.list('venture-agent-message')) {
    if (message.agent !== note.agent) continue;
    const said = message.from === 'owner' ? sources.has(message.id) : holds(message.text) || message.parts.some(part => holds((part as { text?: unknown }).text));
    if (said) tx.replace({ ...message, text: ERASED_MESSAGE, parts: [{ kind: 'text' as const, text: ERASED_MESSAGE }] });
  }
  for (const call of tx.list('venture-model-call')) {
    if (!FINISHED_CALLS.has(call.status) || !(holds(call.payloadText) || holds(call.error?.message))) continue;
    tx.replace({ ...call, payloadText: ERASED_CALL, ...(call.error ? { error: { ...call.error, message: holds(call.error.message) ? ERASED_CALL : call.error.message } } : {}), erasedAt: tx.now });
  }
  return tx.replace<AgentNoteRecord>({ ...note, text: '', hash: '', forgotten: true, source: { ...note.source, quote: null } });
}

/**
 * Writes one change to a note and its change row: a new note (note null), new words, or the note taken away (after
 * null), which erases its words everywhere (eraseNote) and cannot be undone.
 */
function writeChange(tx: VentureTx, input: {
  agent: string; note: AgentNoteRecord | null; after: NoteSnapshot | null; who: AgentNoteChangeRecord['who']; undoOf: string | null;
  source?: AgentNoteRecord['source'];
}): { note: AgentNoteRecord; change: AgentNoteChangeRecord } {
  const { agent, note, after } = input;
  let stored: AgentNoteRecord;
  if (!note) {
    check(after, 'INVALID_VENTURE_REQUEST', NOT_FOUND);
    stored = tx.put<AgentNoteRecord>({
      ...tx.base('venture-agent-note'), agent, scope: after.scope, load: after.load, text: after.text,
      source: input.source ?? { kind: 'owner-edit', quote: null, messageId: null }, captured: localDayAt(tx.now, tx.venture!.country), hash: after.hash, forgotten: false,
    });
  } else {
    stored = after ? tx.replace<AgentNoteRecord>({ ...note, scope: after.scope, load: after.load, text: after.text, hash: after.hash, forgotten: false }) : note;
  }
  const change = tx.put<AgentNoteChangeRecord>({
    ...tx.base('venture-agent-note-change'), agent, noteId: stored.id, who: input.who, before: snapshotOf(note), after, undoOf: input.undoOf,
  });
  if (note && !after) return { note: eraseNote(tx, note), change: tx.find('venture-agent-note-change', change.id)! };
  return { note: stored, change };
}

/** The snapshot a draft makes. */
const snapshotFrom = (draft: Pick<NoteDraft, 'text' | 'scope' | 'load'>): NoteSnapshot => ({ text: draft.text, hash: hashOf(draft), scope: draft.scope, load: draft.load });

/**
 * Keeps the note a proposal showed, inside the owner's Accept (proposals.ts): its words checked again by the same
 * rules, with the scope the owner saw, the room checked, and a change row from the proposal. The source keeps the
 * owner's words as the proposal masked them.
 */
export function keepProposedNote(tx: VentureTx, agent: ChatAgent, record: AgentProposalRecord): AgentNoteRecord {
  const venture = tx.venture!;
  check(record.note && record.note.text, 'INVALID_VENTURE_REQUEST', 'These words were erased, so there is nothing to keep.');
  const draft = draftNote(tx.state, venture, record.note.text, record.quote, { scope: record.note.scope });
  if (isProblem(draft)) throw new ChausarError(draft.code, draft.reason);
  checkRoom(tx.state, venture, agent, draft, null);
  return writeChange(tx, {
    agent: agent.id, note: null, after: snapshotFrom(draft), who: 'proposal', undoOf: null,
    source: { kind: 'owner-words', quote: maskNote(record.quote, draft.scope), messageId: record.messageId },
  }).note;
}

/**
 * Forget of a person in the owner's network (network/forget.ts removePersonData, DPDP): every note that names them is
 * forgotten and its words erased everywhere (eraseNote); any other change row, note or instruction proposal and agent
 * message that names them has those words erased too. mentionsName: the forget's own test for their name in free text.
 */
export function eraseNotesNaming(tx: VentureTx, mentionsName: (text: unknown) => boolean): void {
  for (const note of tx.list('venture-agent-note')) {
    if (note.forgotten || !(mentionsName(note.text) || mentionsName(note.source.quote))) continue;
    tx.put<AgentNoteChangeRecord>({ ...tx.base('venture-agent-note-change'), agent: note.agent, noteId: note.id, who: 'owner', before: blank(snapshotOf(note)), after: null, undoOf: null });
    eraseNote(tx, note);
  }
  for (const row of tx.list('venture-agent-note-change')) {
    if (mentionsName(row.before?.text) || mentionsName(row.after?.text)) tx.replace<AgentNoteChangeRecord>({ ...row, before: blank(row.before), after: blank(row.after) });
  }
  for (const item of tx.list('venture-agent-proposal')) {
    const patch = item.patch;
    if (![item.quote, item.note?.text, item.appliesTo, patch?.value, patch?.source?.quote, ...item.diff.map(line => line.text)].some(mentionsName)) continue;
    tx.replace<AgentProposalRecord>({
      ...item, quote: '', quoteDigest: '', note: item.note ? { ...item.note, text: '' } : null, appliesTo: mentionsName(item.appliesTo) ? null : item.appliesTo,
      diff: item.diff.map(line => (mentionsName(line.text) ? { ...line, text: '' } : line)),
      patch: patch ? { ...patch, value: mentionsName(patch.value) ? '' : patch.value, ...(patch.source ? { source: { ...patch.source, quote: '' } } : {}) } : null,
    });
  }
  for (const message of tx.list('venture-agent-message')) {
    if (!mentionsName(message.text) && !message.parts.some(part => mentionsName((part as { text?: unknown }).text))) continue;
    tx.replace({ ...message, text: ERASED_NAMED, parts: [{ kind: 'text' as const, text: ERASED_NAMED }] });
  }
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

/** A note as the owner reads it: its words read through the masks again, where it came from and when. */
export function noteView(note: AgentNoteRecord): AgentNoteView {
  const quote = note.source.kind === 'owner-words' && note.source.quote ? maskNote(note.source.quote, note.scope) : null;
  return {
    id: note.id, scope: note.scope, load: note.load, text: noteText(note), source: quote ? `You said: '${quote}'` : 'You wrote this note.',
    captured: note.captured, hash: note.hash,
  };
}

/** The changes an undo that still stands has undone. An undo is newer than what it undoes, so newest first decides. */
function undoneIds(changes: readonly AgentNoteChangeRecord[]): Set<string> {
  const undone = new Set<string>();
  for (const change of [...changes].reverse()) if (change.undoOf && !undone.has(change.id)) undone.add(change.undoOf);
  return undone;
}

function changeLine(change: AgentNoteChangeRecord): string {
  if (change.who === 'proposal') return 'Saved from your words.';
  if (change.who === 'undo') return change.after === null ? 'Undo took the note away. Its words are erased.' : change.before === null ? 'Undo put the note back.' : 'Undo put the earlier words back.';
  return change.before === null ? 'You added a note.' : change.after === null ? FORGOT_LINE : 'You corrected a note.';
}

function changeView(change: AgentNoteChangeRecord, undone: ReadonlySet<string>): NoteChangeView {
  // erases (4B3): undoing a change that had no note before it takes the note away, which erases its words like Forget.
  return { id: change.id, noteId: change.noteId, at: change.at, who: change.who, line: changeLine(change), undone: undone.has(change.id), erases: change.before === null };
}

function agentChanges(state: State, venture: VentureRecord, agentId: string): AgentNoteChangeRecord[] {
  return listRecords(state, 'venture-agent-note-change', venture.id).filter(change => change.agent === agentId);
}

/** The answer to an edit, a forget or an undo: the note as it is now (null when forgotten) and the change just made. */
function changed(state: State, venture: VentureRecord, written: { note: AgentNoteRecord; change: AgentNoteChangeRecord }): AgentNoteChange {
  const undone = undoneIds(agentChanges(state, venture, written.change.agent));
  return { note: written.note.forgotten ? null : noteView(written.note), change: changeView(written.change, undone) };
}

// ---------------------------------------------------------------------------
// The methods
// ---------------------------------------------------------------------------

/**
 * venture.agents.notes.list { agent } (read): the agent's notes in use, in the order they were saved, every change
 * newest first (with whether an undo that stands undid it), how much of the 2,000 characters it always reads is used,
 * and the line the owner reads before Forget.
 */
export async function notesListHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<AgentNotesView> {
  const body = exactPayload(payload, ['agent'], ['agent']);
  const agentId = identifier(body.agent, 'Agent');
  const { state, venture } = readAs(deps, ctx, 'read');
  const agent = chatAgent(state, venture, agentId);
  const notes = agentNotes(state, venture, agent.id);
  const changes = agentChanges(state, venture, agent.id);
  const undone = undoneIds(changes);
  return {
    notes: notes.map(noteView), changes: [...changes].reverse().map(change => changeView(change, undone)),
    usedChars: notes.filter(note => note.load === 'always').reduce((sum, note) => sum + note.text.length, 0), limitChars: ALWAYS_LIMIT, forgetLine: FORGET_LINE,
  };
}

/**
 * venture.agents.notes.edit { agent, noteId?, text, basedOn? } (approve, app only): a new note in the owner's words,
 * or a correction of one. basedOn: the hash of the note as the owner opened it; a note changed (or forgotten) since is
 * NOTE_CHANGED, and the owner's draft stays on their screen. A note is about the client its words name, else the
 * agent's own (a correction keeps its scope unless its words name a client); a name Chausar cannot place is asked about.
 * The words pass the note rules (draftNote) and the room (checkRoom).
 */
export async function notesEditHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<AgentNoteChange> {
  requireAppChannel(ctx, 'venture.agents.notes.edit');
  const body = exactPayload(payload, ['agent', 'noteId', 'text', 'basedOn'], ['agent', 'text']);
  const agentId = identifier(body.agent, 'Agent');
  const noteId = body.noteId === undefined ? null : identifier(body.noteId, 'Note');
  check(body.basedOn === undefined || (typeof body.basedOn === 'string' && body.basedOn.length > 0 && body.basedOn.length <= 128), 'INVALID_VENTURE_REQUEST', 'Send the version of the note you corrected.');
  const basedOn = (body.basedOn as string | undefined) ?? null;
  check(noteId !== null || basedOn === null, 'INVALID_VENTURE_REQUEST', 'A new note is not based on another one.');
  check(noteId === null || basedOn !== null, 'INVALID_VENTURE_REQUEST', 'Send the version of the note you corrected.');
  const words = plainText(body.text, 'The note', { min: 2, max: MAX_NOTE });
  readAs(deps, ctx, 'approve');
  return ventureAction(deps, ctx, 'approve', 'agents.notes.edit', tx => {
    const venture = tx.venture!;
    const agent = chatAgent(tx.state, venture, agentId);
    const current = noteId === null ? null : tx.find('venture-agent-note', noteId) ?? null;
    if (noteId !== null) {
      check(current && current.agent === agent.id, 'INVALID_VENTURE_REQUEST', NOT_FOUND);
      check(!current.forgotten && current.hash === basedOn, 'NOTE_CHANGED', NOTE_CHANGED_LINE);
    }
    const draft = draftNote(tx.state, venture, words, words, current ? { fallback: current.scope } : {});
    if (isProblem(draft)) throw new ChausarError(draft.code, draft.reason);
    check(!current || draft.text !== current.text || draft.scope !== current.scope, 'INVALID_VENTURE_REQUEST', 'That is the note as it is now.');
    checkRoom(tx.state, venture, agent, draft, current?.id ?? null);
    const written = writeChange(tx, { agent: agent.id, note: current, after: snapshotFrom(draft), who: 'owner', undoOf: null });
    return changed(tx.state, venture, written);
  });
}

/**
 * venture.agents.notes.forget { agent, noteId } (approve, app only): removes the note by its id and erases its words
 * everywhere Chausar kept them, so it cannot be undone. No model is asked.
 */
export async function notesForgetHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<AgentNoteChange> {
  requireAppChannel(ctx, 'venture.agents.notes.forget');
  const body = exactPayload(payload, ['agent', 'noteId'], ['agent', 'noteId']);
  const agentId = identifier(body.agent, 'Agent');
  const noteId = identifier(body.noteId, 'Note');
  readAs(deps, ctx, 'approve');
  return ventureAction(deps, ctx, 'approve', 'agents.notes.forget', tx => {
    const venture = tx.venture!;
    const agent = chatAgent(tx.state, venture, agentId);
    const note = tx.find('venture-agent-note', noteId);
    check(note && note.agent === agent.id && !note.forgotten, 'INVALID_VENTURE_REQUEST', NOT_FOUND);
    return changed(tx.state, venture, writeChange(tx, { agent: agent.id, note, after: null, who: 'owner', undoOf: null }));
  });
}

/**
 * venture.agents.notes.undo { agent, changeId } (approve, app only): puts a note's words back exactly as they were
 * before an edit; an undo is a change too, so undoing the undo puts the edit back. Undoing a note's first change takes
 * the note away, which erases its words like Forget. Refused with UNDO_NOTHING once a note's words are erased (Forget
 * cannot be undone) or when an undo that stands already undid the change, and with NOTE_CHANGED when the note changed
 * after it (the later change is undone first).
 */
export async function notesUndoHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<AgentNoteChange> {
  requireAppChannel(ctx, 'venture.agents.notes.undo');
  const body = exactPayload(payload, ['agent', 'changeId'], ['agent', 'changeId']);
  const agentId = identifier(body.agent, 'Agent');
  const changeId = identifier(body.changeId, 'Change');
  readAs(deps, ctx, 'approve');
  return ventureAction(deps, ctx, 'approve', 'agents.notes.undo', tx => {
    const venture = tx.venture!;
    const agent = chatAgent(tx.state, venture, agentId);
    const change = tx.find('venture-agent-note-change', changeId);
    check(change && change.agent === agent.id, 'INVALID_VENTURE_REQUEST', 'That change was not found.');
    const note = tx.find('venture-agent-note', change.noteId);
    check(note, 'INVALID_VENTURE_REQUEST', NOT_FOUND);
    check(!note.forgotten && (change.before === null || change.before.text !== ''), 'UNDO_NOTHING', FORGET_FINAL);
    check(!undoneIds(agentChanges(tx.state, venture, agent.id)).has(change.id), 'UNDO_NOTHING', 'You already undid that change.');
    const now = snapshotOf(note);
    const same = now === null || change.after === null ? now === change.after : now.hash === change.after.hash && now.scope === change.after.scope && now.load === change.after.load;
    check(same, 'NOTE_CHANGED', 'This note changed after that. Undo the later change first.');
    if (change.before) checkRoom(tx.state, venture, agent, change.before, note.id);
    return changed(tx.state, venture, writeChange(tx, { agent: agent.id, note, after: change.before, who: 'undo', undoOf: change.id }));
  });
}
