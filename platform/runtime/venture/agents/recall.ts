// Chausar venture launcher, agents (Ink v2 wave 4, package 4B2, catalogue A4, A5 and A7): what a run recalls of the
// agents' notes, and the text rules every note passes. Each act turn of a run carries, in its input and never in its
// instructions, the notes of the agents whose steps the turn works on: every always-loaded note, and at most four topic
// notes about the order's own client that share a word with the order's request, as background that grants nothing
// (delivery/harness/loop.ts actTask puts them in the input and Chausar's own NOTES_BACKGROUND line in the instructions).
// A note about another client and a forgotten note are never sent, and a note is read through the rules again each
// time: one that now tells the agent to act, states money or reads like a page aimed at an agent is left out. Keys are
// redacted, and card, bank account, Aadhaar and one-time code numbers masked, when a note is saved and again when it is
// read; phone numbers and emails are masked in every note, and a note about a client masks its PAN too. The turn keeps
// the ids of the notes its approved text carried, and a turn whose text carries a note forgotten or changed since is
// made again before it can go (staleNotes). Reads only, so the delivery harness can load it without the agents package.
import type { State } from '../../contracts.ts';
import type { AgentNoteRecord, AgentNoteScope, OrderRecord, PlaybookRecord, VentureErrorCode, VentureRecord } from '../contracts.ts';
import { listRecords } from '../records.ts';
import { digitCopy, redactSecrets, screenReadback } from '../core/secrets.ts';
import { FLOOR_REASON, MONEY_REASON, ownerControlReason, plainHindi, statesMoney } from '../delivery/harness/patches.ts';
import { screenUntrusted } from '../policy/untrusted.ts';
import { flagshipDelivery } from '../playbooks/steps.ts';
import { AGENT_ID, agentName } from '../views/shared.ts';

/** The most characters the notes an agent always reads may hold, in all. */
export const ALWAYS_LIMIT = 2000;
/** The most topic notes one act turn recalls. */
export const TOPIC_RECALL = 4;
/** Step kinds an act turn works on (the delivery harness's agent steps); the writing step writes with tools off. */
export const ACT_STEP_KINDS: ReadonlySet<string> = new Set(['gather', 'question', 'work']);
/** Why words that read like a file or a page aimed at an agent are not kept. */
export const UNTRUSTED_NOTE = 'It reads like text from a file or a page, with words aimed at an agent. A note keeps only your own words.';

/** One note as an act turn carries it: its id (so the turn can say which it recalled), the agent's name and the words. */
export type RecalledNote = { id: string; agent: string; text: string };

// ---------------------------------------------------------------------------
// Masks
// ---------------------------------------------------------------------------

/** The client a scope names, or null for the agent's own notes. */
export function scopeClient(scope: AgentNoteScope): string | null {
  return scope.startsWith('client:') ? scope.slice('client:'.length) : null;
}

/**
 * The shared screen (core/secrets.ts screenReadback): keys redacted, and card, Aadhaar, bank account (beside an IFSC)
 * and one-time code numbers masked. A client's note masks its PAN here too; the agent's own notes keep a PAN.
 */
export function screenIds(text: string, scope: AgentNoteScope): string {
  return screenReadback(redactSecrets(text), scopeClient(scope) === null ? { keep: ['pan'] } : {}).text;
}

/** Read on the copy below: ten to fifteen digits with spaces, dots, hyphens or brackets between them. */
const PHONE = /(?<![\p{L}\d])\+?\d(?:[\s.()-]{0,3}\d){9,14}(?!\d)/gu;
const EMAIL = /[\p{L}\p{Nd}._%+-]+@[\p{L}\p{Nd}-]+(?:\.[\p{L}\p{Nd}-]+)*\.\p{L}{2,}/gu;
const PAN = /(?<![\p{L}\d])[A-Z]{3}[ABCFGHJLPT][A-Z]\d{4}[A-Z](?![\p{L}\d])/giu;

/**
 * Masks phone numbers and emails (and PAN when asked) wherever they are, however they are written: they are looked for
 * on a copy with format characters and soft hyphens taken out, every digit read as 0 to 9 (core/secrets.ts digitCopy)
 * and full-width signs and letters read as plain ones, and the span each covers in the words themselves is replaced.
 */
function maskContacts(text: string, withPan: boolean): string {
  let copy = '';
  const from: number[] = [];
  let at = 0;
  for (const char of text) {
    const read = digitCopy(char).normalize('NFKC');
    for (let index = 0; index < read.length; index += 1) from.push(at);
    copy += read;
    at += char.length;
  }
  from.push(text.length);
  const spans: { start: number; end: number; label: string }[] = [];
  const find = (pattern: RegExp, label: string) => {
    for (const match of copy.matchAll(pattern)) {
      const start = from[match.index], last = from[match.index + match[0].length - 1];
      const end = last + (text.codePointAt(last)! > 0xffff ? 2 : 1);
      if (!spans.some(span => start < span.end && end > span.start)) spans.push({ start, end, label });
    }
  };
  find(EMAIL, '[redacted email]');
  if (withPan) find(PAN, '[redacted PAN]');
  find(PHONE, '[redacted phone number]');
  return spans.sort((a, b) => b.start - a.start).reduce((out, span) => out.slice(0, span.start) + span.label + out.slice(span.end), text);
}

/**
 * A note's words as they may be kept and read: the shared screen (screenIds), then phone numbers and emails masked in
 * every note, and a client's PAN however it is written.
 */
export function maskNote(text: string, scope: AgentNoteScope): string {
  return maskContacts(screenIds(text, scope), scopeClient(scope) !== null);
}

/** A stored note's words as they are read: the same masks again, so a note written by any other path is screened too. */
export function noteText(note: Pick<AgentNoteRecord, 'text' | 'scope'>): string {
  return maskNote(note.text, note.scope);
}

// ---------------------------------------------------------------------------
// Words a note may not hold
// ---------------------------------------------------------------------------

/**
 * Words that skip the owner, wherever they are: without asking or waiting, don't ask me, skip my approval, approve it
 * yourself, on your own (बिना पूछे, पूछे बिना, मत पूछो; bina pooche).
 */
const SKIPS_OWNER: readonly RegExp[] = Object.freeze([
  /\bwithout (?:asking|checking with (?:me|you)|my (?:ok|okay|approval|go-?ahead|say-?so)|approval|waiting for (?:me|my|approval))\b/i,
  /\b(?:don'?t|do not|no need to|never) (?:ask|check with|wait for) me\b|\bask me never\b/i,
  /\bskip\w*\s+(?:my |your |the |our )?(?:approval|ok|okay|sign-?off|go-?ahead|say-?so)\b/i,
  /\bapprov\w*(?:\s+\w+){0,2}\s+(?:yourself|on your own|without me)\b|\bself[- ]?approv\w*/i,
  /\bon (?:its|your) own\b/i,
  /\bbina\s+p(?:oo|u)c?hh?e\b|\bp(?:oo|u)c?hh?e\s+bina\b|बिना\s+प[ूु]छे|प[ूु]छे\s+बिना|मत\s+पूछ|पूछना\s+मत/iu,
]);
/** Words that tell the agent to do something: an instruction that starts with a verb of acting, or "you can, should, must". */
const TELLS = /^\s*(?:(?:please|kindly|just|also|always|never|don'?t|do not|ab se|hamesha)\s+)*(?:publish|post|upload|share|send|forward|e-?mail|mail|message|whatsapp|text|dm|reply|respond|pay|refund|transfer|charge|bill|invoice|delete|erase|remove|schedule|approve|skip|turn\s+off|disable|switch\s+off|drop|raise|lower|cut|increase|decrease|change|set|give|go\s+live|put|push|use|grant|allow|let)\b/i;
const YOU_MAY = /\byou\s+(?:can|could|should|must|may|might|are allowed to|have to|need to|don'?t need to)\b/i;
/** Hindi and Hinglish requests: words that end in an asking verb (करो, कर दो, भेजो, डालो; karo, kar do, bhej do). */
const TELLS_HINDI = /(?:करो|कर\s+दो|कर\s+दें|करें|कीजिए|करिए|दो|दे\s+दो|दीजिए|दें|भेजो|भेज\s+दो|डालो|डाल\s+दो)\s*[।.!]?\s*$|\b(?:karo|kar\s+do|kar\s+dena|bhej\s+do|bhejo|daal\s+do)\s*[.!]?\s*$/iu;

/** Why words cannot be a note, with the error a method refuses them with. */
export type NoteProblem = { code: VentureErrorCode; reason: string };

/**
 * Why a note's words cannot be kept or recalled, or null: they tell the agent to act on what always asks the owner,
 * money, tools, checks or limits (the owner rules of 4B1, read only on words that tell the agent to do something, so a
 * fact that mentions an invoice or a time limit is fine), skip the owner anywhere, state an amount of money, or read like
 * a file or a page with words aimed at an agent. quote: the owner's own words they came from (the same for typed words).
 */
export function noteRefusal(text: string, quote: string = text): NoteProblem | null {
  const plain = plainHindi(text.replace(/[\p{Cf}\u00AD]/gu, ''));
  if (SKIPS_OWNER.some(pattern => pattern.test(plain))) return { code: 'PATCH_OWNER_OP', reason: FLOOR_REASON };
  if (TELLS.test(plain) || YOU_MAY.test(plain) || TELLS_HINDI.test(plain)) {
    const control = ownerControlReason(plain);
    if (control !== null) return { code: 'PATCH_OWNER_OP', reason: control };
  }
  if (statesMoney(text, quote)) return { code: 'PATCH_OWNER_OP', reason: MONEY_REASON };
  for (const words of new Set([quote, text])) {
    if (screenUntrusted({ source: 'web-page', text: words }, { mode: 'enforce' }).status === 'quarantined') return { code: 'UNTRUSTED_HELD', reason: UNTRUSTED_NOTE };
  }
  return null;
}

/** A stored note's words when they may still be used (in a run or a chat answer): masked again, or null when they fail the rules now. */
export function usableNoteText(note: Pick<AgentNoteRecord, 'text' | 'scope' | 'forgotten'>): string | null {
  if (note.forgotten) return null;
  const text = noteText(note);
  return text.trim() && noteRefusal(text) === null ? text : null;
}

// ---------------------------------------------------------------------------
// Recall
// ---------------------------------------------------------------------------

/** Words of three letters or more that carry no topic, in English and Hindi (and, from, with; है, में, लिए ...). */
const STOP_WORDS: ReadonlySet<string> = new Set([
  'the', 'and', 'for', 'from', 'with', 'that', 'this', 'these', 'those', 'into', 'onto', 'about', 'over', 'under', 'then', 'than', 'they', 'them',
  'their', 'there', 'here', 'have', 'has', 'had', 'was', 'were', 'are', 'will', 'would', 'should', 'could', 'can', 'our', 'ours', 'your', 'yours',
  'you', 'his', 'her', 'hers', 'him', 'she', 'its', 'not', 'but', 'all', 'any', 'each', 'every', 'very', 'just', 'also', 'only', 'more', 'most',
  'some', 'such', 'when', 'what', 'which', 'who', 'whom', 'why', 'how', 'one', 'please', 'make', 'made', 'want', 'wants', 'need', 'needs', 'get',
  'got', 'let', 'like', 'likes', 'did', 'does', 'done', 'out', 'off', 'too', 'yet', 'via', 'per', 'own', 'mine',
  'है', 'हैं', 'में', 'लिए', 'नहीं', 'और', 'भी', 'यह', 'वह', 'था', 'थी', 'थे', 'एक', 'कुछ', 'सब', 'साथ', 'बाद', 'पहले',
]);

/** The words of a text that can name a topic: letters and digits, three or more long, lower case, no stop words. */
export function topicWords(text: string): Set<string> {
  const words = [...text.normalize('NFC').toLowerCase().matchAll(/[\p{L}\p{M}\p{Nd}]+/gu)].map(match => match[0]);
  return new Set(words.filter(word => word.length >= 3 && !STOP_WORDS.has(word)));
}

/**
 * The agents whose steps an act turn works on, by id with their names: a flagship playbook's roles that do a gather,
 * question or work step, else the one delivery agent of the eight fixed steps. The code roles keep no notes.
 */
export function actAgents(state: State, venture: VentureRecord, playbook: Pick<PlaybookRecord, 'steps' | 'flagship'>): Map<string, string> {
  const flagship = flagshipDelivery(playbook.flagship ?? null);
  const agents = new Map<string, string>();
  for (const step of playbook.steps) {
    if (!ACT_STEP_KINDS.has(step.kind)) continue;
    if (!flagship) { agents.set(AGENT_ID, agentName(state, venture)); continue; }
    const role = flagship.roles.find(item => item.id === flagship.roleOf[step.id]);
    if (role?.kind === 'agent') agents.set(role.id, role.name);
  }
  return agents;
}

/**
 * The notes one act turn of an order's run carries, in order: every always-loaded note of the agents whose steps the
 * turn works on (in the order they were saved), then at most four topic notes that share a word with the order's
 * request, the most words shared first and then the newest. A topic note about a client is recalled only for that
 * client's own orders. A forgotten note is never recalled, and each note's words pass the rules again (usableNoteText).
 */
export function recallNotes(state: State, venture: VentureRecord, playbook: Pick<PlaybookRecord, 'steps' | 'flagship'>, order: Pick<OrderRecord, 'request' | 'clientId'>): RecalledNote[] {
  const agents = actAgents(state, venture, playbook);
  const usable = listRecords(state, 'venture-agent-note', venture.id).flatMap(note => {
    const text = agents.has(note.agent) ? usableNoteText(note) : null;
    return text === null ? [] : [{ note, item: { id: note.id, agent: agents.get(note.agent)!, text } }];
  });
  const always = usable.filter(({ note }) => note.load === 'always' && note.scope === 'agent').map(({ item }) => item);
  const asked = topicWords(order.request);
  const topics = usable.flatMap(({ note, item }, index) => {
    if (note.load !== 'topic') return [];
    const client = scopeClient(note.scope);
    if (client !== null && client !== order.clientId) return [];
    const shared = [...topicWords(item.text)].filter(word => asked.has(word)).length;
    return shared > 0 ? [{ item, shared, index }] : [];
  }).sort((x, y) => y.shared - x.shared || y.index - x.index).slice(0, TOPIC_RECALL).map(({ item }) => item);
  return [...always, ...topics];
}

/**
 * The notes an approved turn's text carried, by id, in the order they were saved: each note's id is a random
 * identifier that the text holds only when the turn's input carried that note (recallNotes puts it there). Read from
 * the exact text the owner approved.
 */
export function notesCarried(state: State, venture: VentureRecord, approvedText: string): string[] {
  if (!approvedText) return [];
  return listRecords(state, 'venture-agent-note', venture.id).filter(note => approvedText.includes(note.id)).map(note => note.id);
}

/** True when the text holds these words as given, or escaped once or twice as JSON (a payload holds its input as JSON text). */
export function holdsWords(text: string, words: string): boolean {
  const once = JSON.stringify(words).slice(1, -1);
  return text.includes(words) || text.includes(once) || text.includes(JSON.stringify(once).slice(1, -1));
}

/**
 * The notes a turn's text carried that must not go now: forgotten since, failing the rules now, or changed since (their
 * words now are not the words the text holds). The turn is made again without them before anything is sent.
 */
export function staleNotes(state: State, venture: VentureRecord, approvedText: string): string[] {
  const carried = new Set(notesCarried(state, venture, approvedText));
  return listRecords(state, 'venture-agent-note', venture.id).filter(note => carried.has(note.id)).flatMap(note => {
    const text = usableNoteText(note);
    return text === null || !holdsWords(approvedText, text) ? [note.id] : [];
  });
}
