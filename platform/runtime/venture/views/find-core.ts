import { ChausarError } from '../../portable.ts';

// C2 task 1: one matcher for every kind of thing the command bar finds. Browser safe (no node: import; its first
// statement is an import, the check.mjs trap in AGENTS.md), so the engine's venture.find, the fake and the page
// catalogue all parse, match, rank and cut snippets the same way and rank on one scale. Nothing here reads or writes
// a business; the handler (C2 task 2) hands it the rows each list already shows the owner. The types of a chat's parts
// are written out here, not imported from contracts.ts, so the app's stricter type check does not take in the engine.

type IsoTime = string;
type ChatPart = { kind: 'text' | 'estimate'; text: string } | { kind: 'figure'; receiptId: string; display: string };
type ChiefLineAmount = { text: string; start: number; length: number; receiptId: string };

export const FIND_KINDS = Object.freeze(['client', 'invoice', 'order', 'run', 'chat'] as const);
export type FindKind = typeof FIND_KINDS[number];
export type FindRequest = { text: string; kinds?: FindKind[]; limit?: number };
export type ParsedFindRequest = { text: string; kinds: FindKind[]; limit: number };
/** Where the match is in the item's title, for highlighting: UTF-16 offsets into that field's own text. */
export type FindHit = { field: string; start: number; length: number };
export type FindSnippet = { line: string; amounts: ChiefLineAmount[]; hit?: { start: number; length: number } };
type Scored = { id: string; score: number; hit: FindHit | null };
export type FindItem = Scored & (
  | { kind: 'client'; name: string; at: IsoTime }
  | { kind: 'invoice'; number: string; clientName: string | null; status: string; total: string; receiptId: string | null; at: IsoTime }
  | { kind: 'order'; request: string; clientName: string | null; status: string; at: IsoTime }
  | { kind: 'run'; purpose: string; agentName: string | null; state: string; at: IsoTime }
  | { kind: 'chat'; title: string; state: string; lastAt: IsoTime; at: IsoTime; snippet: (FindSnippet & { from: 'owner' | 'chief' }) | null }
);
export type FindGroup = { kind: FindKind; best: number; items: FindItem[]; more: number };
export type FindView = { groups: FindGroup[] };
export type FindField = { name: string; text: string; number?: boolean };

export const FIND_LIMITS = Object.freeze({ text: 200, limit: 20, defaultLimit: 5, minQuery: 2, snippet: 120 });
/** Scores: a whole field equal to the words, else per word a word start or a match inside a word; the title counts double. */
const WHOLE = 100, START = 2, INSIDE = 1, TITLE_WEIGHT = 2;
/** A score at or above this means a whole field equals the words. */
export const FIND_WHOLE_SCORE = WHOLE;

const refuse = (message: string) => new ChausarError('INVALID_VENTURE_REQUEST', message);
const plain = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** The find request, checked field by field. The refusal words never repeat what the owner typed. */
export function parseFindRequest(payload: unknown): ParsedFindRequest {
  if (!plain(payload)) throw refuse('Send the words to find.');
  const extra = Object.keys(payload).filter(key => !['text', 'kinds', 'limit'].includes(key));
  if (extra.length) throw refuse('A find takes only the words, the kinds of thing to look in and how many to show.');
  if (typeof payload.text !== 'string') throw refuse('Send the words to find.');
  if (payload.text.length > FIND_LIMITS.text) throw refuse(`Find takes at most ${FIND_LIMITS.text} characters. Shorten the words and try again.`);
  let kinds: FindKind[] = [...FIND_KINDS];
  if (payload.kinds !== undefined) {
    if (!Array.isArray(payload.kinds) || !payload.kinds.length || payload.kinds.some(kind => !FIND_KINDS.includes(kind as FindKind)) || new Set(payload.kinds).size !== payload.kinds.length) {
      throw refuse(`Find looks in clients, invoices, orders, runs and chats only.`);
    }
    kinds = [...payload.kinds] as FindKind[];
  }
  let limit: number = FIND_LIMITS.defaultLimit;
  if (payload.limit !== undefined) {
    if (!Number.isInteger(payload.limit) || (payload.limit as number) < 1 || (payload.limit as number) > FIND_LIMITS.limit) throw refuse(`Show from 1 to ${FIND_LIMITS.limit} of each kind.`);
    limit = payload.limit as number;
  }
  return { text: payload.text, kinds, limit };
}

/** The text in the matcher's form, with the place in the original text of each character it keeps. */
function folded(text: string): { flat: string; at: number[] } {
  let flat = '';
  const at: number[] = [];
  let index = 0;
  for (const char of text) {
    const code = char.charCodeAt(0);
    // Plain ASCII (most of what a business writes) skips normalizing: a chat of fifty messages is folded on every find.
    const mapped = code < 128
      ? (code === 32 || (code >= 9 && code <= 13) ? ' ' : code >= 65 && code <= 90 ? String.fromCharCode(code + 32) : char)
      : /\s/.test(char) ? ' ' : char.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
    for (const out of mapped) {
      if (out === ' ' && (!flat || flat.endsWith(' '))) continue;
      flat += out; at.push(index);
    }
    index += char.length;
  }
  if (flat.endsWith(' ')) { flat = flat.slice(0, -1); at.pop(); }
  at.push(index);
  return { flat, at };
}

/** The words of a query or field: accents dropped, lower case, spaces collapsed. Under two characters it is no words. */
export function wordsOf(text: string): string[] {
  const { flat } = folded(typeof text === 'string' ? text : '');
  return flat.length < FIND_LIMITS.minQuery ? [] : flat.split(' ');
}

const wordChar = (char: string | undefined) => !!char && /[\p{L}\p{N}]/u.test(char);
/** Runs of letters and of digits; a digit run loses its leading zeros. INV-0041 is [inv, 41]. */
function numberTokens(text: string): string[] {
  return (folded(text).flat.match(/\p{L}+|\p{N}+/gu) ?? []).map(token => /^\p{N}+$/u.test(token) ? token.replace(/^0+(?=\d)/, '') : token);
}
/** Where a word sits in a field: 2 at a word start, 1 inside a word, 0 not there; and the first best place. */
function placeIn(flat: string, word: string): { tier: number; start: number } {
  let best = { tier: 0, start: -1 };
  for (let from = flat.indexOf(word); from !== -1; from = flat.indexOf(word, from + 1)) {
    const tier = wordChar(flat[from - 1]) ? INSIDE : START;
    if (tier > best.tier) best = { tier, start: from };
    if (tier === START) break;
  }
  return best;
}
/** A number field: the word's tokens must appear in a row; a digit token must be equal, a letter token may start one. */
function numberPlace(field: string[], word: string): number {
  const query = numberTokens(word);
  if (!query.length) return 0;
  for (let start = 0; start + query.length <= field.length; start++) {
    const fits = query.every((token, offset) => /^\p{N}/u.test(token) ? field[start + offset] === token : (field[start + offset] ?? '').startsWith(token));
    if (fits) return start === 0 ? START : INSIDE;
  }
  return 0;
}

/**
 * Every query word must match a field. A whole field equal to the words beats a word start, which beats a match inside
 * a word; the first field (the title) counts double. The hit is where the first word sits in the title, or null.
 */
export function match(query: string | string[], fields: readonly FindField[]): { score: number; hit: FindHit | null } | null {
  const words = Array.isArray(query) ? query : wordsOf(query);
  if (!words.length || !fields.length) return null;
  const joined = words.join(' ');
  const prepared = fields.map((field, index) => ({ field, weight: index === 0 ? TITLE_WEIGHT : 1, folded: folded(field.text ?? ''), tokens: field.number ? numberTokens(field.text ?? '') : null }));
  const title = prepared[0]!;
  for (const item of prepared) {
    const equal = item.tokens ? words.length === 1 && numberTokens(joined).join(' ') === item.tokens.join(' ') && item.tokens.length > 0 : item.folded.flat === joined;
    if (equal) return { score: WHOLE * item.weight, hit: item === title ? { field: title.field.name, start: 0, length: title.field.text.length } : null };
  }
  let score = 0;
  for (const word of words) {
    let best = 0;
    for (const item of prepared) {
      const tier = item.tokens ? numberPlace(item.tokens, word) : placeIn(item.folded.flat, word).tier;
      best = Math.max(best, tier * item.weight);
    }
    if (!best) return null;
    score += best;
  }
  let hit: FindHit | null = null;
  if (title.tokens) {
    if (numberPlace(title.tokens, words[0]!)) hit = { field: title.field.name, start: 0, length: title.field.text.length };
  } else {
    const place = placeIn(title.folded.flat, words[0]!);
    if (place.tier) {
      const start = title.folded.at[place.start]!, end = title.folded.at[place.start + words[0]!.length - 1]! + 1;
      hit = { field: title.field.name, start, length: Math.max(1, end - start) };
    }
  }
  return { score, hit };
}

/** Score, then newest first, then id; more is how many were left out. */
export function rank<T extends { id: string; score: number; at: IsoTime }>(items: readonly T[], limit: number): { items: T[]; more: number } {
  const sorted = [...items].sort((a, b) => b.score - a.score || (a.at < b.at ? 1 : a.at > b.at ? -1 : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { items: sorted.slice(0, limit), more: Math.max(0, sorted.length - limit) };
}

/**
 * A chat message cut to at most 120 characters around the first hit, on whole words, with the receipted amounts inside
 * it at their new offsets. An amount the window would cut is left out with its words, as lastLineOf does. Null: no hit.
 */
export function snippetOf(parts: readonly ChatPart[], query: string | string[]): FindSnippet | null {
  const words = Array.isArray(query) ? query : wordsOf(query);
  if (!words.length) return null;
  let text = '';
  const amounts: ChiefLineAmount[] = [];
  for (const part of parts) {
    const piece = (part.kind === 'figure' ? part.display : part.text).replace(/\s+/g, ' ').trim();
    if (!piece) continue;
    if (text) text += ' ';
    if (part.kind === 'figure') amounts.push({ text: piece, start: text.length, length: piece.length, receiptId: part.receiptId });
    text += piece;
  }
  const { flat, at } = folded(text);
  let first = -1, firstWord = '';
  for (const word of words) {
    const place = flat.indexOf(word);
    if (place !== -1 && (first === -1 || place < first)) { first = place; firstWord = word; }
  }
  if (first === -1) return null;
  const hitStart = at[first]!, hitEnd = at[first + firstWord.length - 1]! + 1, room = FIND_LIMITS.snippet;
  let start = Math.max(0, Math.min(hitStart - Math.floor((room - (hitEnd - hitStart)) / 3), text.length - room));
  if (start > 0 && text[start - 1] !== ' ') { const space = text.indexOf(' ', start); start = space === -1 || space >= hitStart ? hitStart : space + 1; }
  let end = Math.min(text.length, start + room);
  if (end < text.length && text[end] !== ' ') { const space = text.lastIndexOf(' ', end); end = space > hitEnd ? space : Math.max(hitEnd, end); }
  for (const amount of amounts) {
    const amountEnd = amount.start + amount.length;
    if (amount.start < start && start < amountEnd) { const space = text.indexOf(' ', amountEnd); start = space === -1 ? amountEnd : space + 1; }
    if (amount.start < end && end < amountEnd) end = amount.start;
  }
  while (start < end && text[start] === ' ') start++;
  while (end > start && text[end - 1] === ' ') end--;
  const line = text.slice(start, end);
  const kept = amounts.filter(amount => amount.start >= start && amount.start + amount.length <= end).map(amount => ({ ...amount, start: amount.start - start }));
  return { line, amounts: kept, ...(hitStart >= start && hitEnd <= end ? { hit: { start: hitStart - start, length: hitEnd - hitStart } } : {}) };
}

/**
 * C2 task 2: the rows each kind's list shows the owner, as the engine and the fake hand them over: an order's whole
 * request (the item carries its first 80 characters), a chat's messages as stored. A kind left out is not looked in.
 */
export type FindSources = {
  client?: readonly { id: string; name: string; at: IsoTime }[];
  invoice?: readonly { id: string; number: string | null; clientName: string | null; status: string; total: string; receiptId: string | null; at: IsoTime }[];
  order?: readonly { id: string; request: string; clientName: string | null; status: string; at: IsoTime }[];
  run?: readonly { id: string; purpose: string; agentName: string | null; state: string; at: IsoTime }[];
  chat?: readonly { id: string; title: string; state: string; lastAt: IsoTime; messages: readonly { from: string; parts: readonly ChatPart[] }[] }[];
};

const REQUEST_SHOWN = 80;
/** An order's request as its find row shows it: the first 80 characters, cut at a space, with "..." when cut. */
export function requestShown(request: string): string {
  const single = request.replace(/\s+/g, ' ').trim();
  if (single.length <= REQUEST_SHOWN) return single;
  const cut = single.slice(0, REQUEST_SHOWN - 3);
  const space = cut.lastIndexOf(' ');
  return `${(space > REQUEST_SHOWN / 2 ? cut.slice(0, space) : cut).trimEnd()}...`;
}
const textOf = (parts: readonly ChatPart[]) => parts.map(part => part.kind === 'figure' ? part.display : part.text).join(' ');

/** Every matching row of the asked kinds, ranked; groups in score order, ties in FIND_KINDS order, empty ones left out. */
export function findIn(request: ParsedFindRequest, sources: FindSources): FindView {
  const words = wordsOf(request.text);
  if (!words.length) return { groups: [] };
  const groups: FindGroup[] = [];
  for (const kind of FIND_KINDS) {
    if (!request.kinds.includes(kind) || !sources[kind]) continue;
    const found: FindItem[] = [];
    const add = (fields: FindField[], make: (scored: { score: number; hit: FindHit | null }) => FindItem) => {
      const scored = match(words, fields);
      if (scored) found.push(make(scored));
    };
    if (kind === 'client') {
      for (const row of sources.client!) add([{ name: 'name', text: row.name }], scored => ({ kind, id: row.id, name: row.name, at: row.at, ...scored }));
    } else if (kind === 'invoice') {
      for (const row of sources.invoice!) {
        add([{ name: 'number', text: row.number ?? '', number: true }, { name: 'clientName', text: row.clientName ?? '' }], scored => ({
          kind, id: row.id, number: row.number ?? '', clientName: row.clientName, status: row.status, total: row.total, receiptId: row.receiptId, at: row.at, ...scored,
        }));
      }
    } else if (kind === 'order') {
      for (const row of sources.order!) {
        const request = requestShown(row.request);
        add([{ name: 'request', text: request }, { name: 'clientName', text: row.clientName ?? '' }, { name: 'requestWhole', text: row.request }], scored => ({
          kind, id: row.id, request, clientName: row.clientName, status: row.status, at: row.at, ...scored,
        }));
      }
    } else if (kind === 'run') {
      for (const row of sources.run!) {
        add([{ name: 'purpose', text: row.purpose }, { name: 'agentName', text: row.agentName ?? '' }], scored => ({
          kind, id: row.id, purpose: row.purpose, agentName: row.agentName, state: row.state, at: row.at, ...scored,
        }));
      }
    } else {
      for (const row of sources.chat!) {
        const fields: FindField[] = [{ name: 'title', text: row.title }, ...row.messages.map((message, index) => ({ name: `message${index}`, text: textOf(message.parts) }))];
        add(fields, scored => {
          let snippet: (FindSnippet & { from: 'owner' | 'chief' }) | null = null;
          // When the title does not hold the first word: the newest message that holds a word.
          if (!scored.hit) {
            for (let index = row.messages.length - 1; index >= 0 && !snippet; index -= 1) {
              const cut = snippetOf(row.messages[index]!.parts, words);
              if (cut) snippet = { ...cut, from: row.messages[index]!.from === 'owner' ? 'owner' : 'chief' };
            }
          }
          return { kind: 'chat', id: row.id, title: row.title, state: row.state, lastAt: row.lastAt, at: row.lastAt, snippet, ...scored };
        });
      }
    }
    if (!found.length) continue;
    const { items, more } = rank(found, request.limit);
    groups.push({ kind, best: items[0]!.score, items, more });
  }
  const order = (kind: FindKind) => FIND_KINDS.indexOf(kind);
  return { groups: groups.sort((a, b) => b.best - a.best || order(a.kind) - order(b.kind)) };
}
