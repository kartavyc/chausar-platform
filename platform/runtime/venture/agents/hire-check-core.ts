// C7 task 13 (the part the fake engine shares, so it imports nothing of the engine's contracts): the code checks on one more agent the owner hires. A hired agent works in chat, routines and trackers only,
// owns no delivery step and always asks before anything leaves; these checks hold its words to that before the owner is
// shown the review card. Short plain fields; reads only from HIRE_READS; a department the engine knows; no hard stop
// anywhere in its words (HIRE_HARD_STOP, with that stop's own line); and no duty that sends, pays, posts, deletes or
// changes a price without the owner (HIRE_FLOOR). The interview, the record and the screens are C7 tasks 14 to 16.
import { ChausarError } from '../../portable.ts';
import { HARD_STOP_WORDS } from '../policy/hard-stops.ts';
import { hardStopIn } from '../policy/hard-stop-words.ts';

export const HIRE_READS = Object.freeze(['clients', 'orders', 'runs', 'money', 'plan', 'journal', 'notes', 'trackers'] as const);
export type HireRead = typeof HIRE_READS[number];
export type HireRole = { name: string; job: string; duties: string[]; reads: HireRead[]; department: string };
/** What the engine knows and the fake repeats: its departments, and its words for the floor's acts. */
export type HireRules = { departments: readonly string[]; floorWords: readonly string[] };
export const HIRE_LIMITS = Object.freeze({ name: 40, job: 120, duty: 160, duties: 5 });
/** Names the engine keeps for itself. */
const RESERVED_NAMES = Object.freeze(['chausar', 'keeper']);
/**
 * Words that say the agent would act without the owner. The owner is "me" in words they type and "you" in words the
 * AI writes for them (core/owner-voice.ts): every check below reads the two the same way.
 */
const UNATTENDED = /\b(?:without\s+(?:asking|approval|(?:my|your)\s+approval|checking|(?:my|your)\s+ok|me|you)|automatically|auto-?(?:send|pay|post|delete|reply)\w*|on\s+(?:its|their|his|her)\s+own|by\s+(?:itself|themselves))\b/;
/** The floor's acts: send and post, money out and delete (effects.ts), and a price change. */
const FLOOR_ACT_WORDS = Object.freeze(['sends', 'posts', 'pays', 'deletes', 'removes', 'emails', 'shares', 'replies', 'price', 'prices', 'pricing', 'discount', 'discounts', 'reprice']);

const invalid = (message: string) => new ChausarError('INVALID_VENTURE_REQUEST', message);
const plain = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function text(value: unknown, limit: number, what: string): string {
  if (typeof value !== 'string' || !value.trim()) throw invalid(`Give the agent ${what}.`);
  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (trimmed.length > limit) throw invalid(`Keep the agent's ${what} to ${limit} characters.`);
  return trimmed;
}
// The floor here is a first line only, a check on the words an owner writes for a hired agent. The real guard for every
// outward act is the engine's approval gates: whatever a hired agent's duties say, a send, payment, post, deletion,
// booking, filing or price change still waits for the owner's approval of that exact thing.
/** Verbs that act on the floor when they lead a duty or follow "and", "then", "to", "also" or "will" (review round 1). */
const FLOOR_VERBS = new Set(['send', 'sends', 'sending', 'post', 'posts', 'posting', 'publish', 'publishes', 'email', 'emails', 'message', 'messages', 'reply', 'replies', 'answer', 'answers', 'respond', 'responds', 'upload', 'uploads', 'forward', 'forwards', 'share', 'shares', 'pay', 'pays', 'paying', 'refund', 'refunds', 'transfer', 'transfers', 'charge', 'charges', 'buy', 'buys', 'purchase', 'purchases', 'order', 'orders', 'book', 'books', 'submit', 'submits', 'sign', 'signs', 'accept', 'accepts', 'decline', 'declines', 'delete', 'deletes', 'remove', 'removes', 'erase', 'erases', 'purge', 'purges', 'cancel', 'cancels', 'reprice', 'reprices', 'discount', 'discounts']);
/** Verbs that are outward only with others in the clause: scheduling with someone, filing a return or a form. */
const WITH_OTHERS: Readonly<Record<string, RegExp>> = Object.freeze({
  schedule: /\b(?:with|clients?|customers?|leads?|people|guests?|patients?|vendors?|calls?|meetings?|posts?|appointments?)\b/,
  file: /\b(?:returns?|forms?|gst|tds|itr|tax(?:es)?|claims?|complaints?|applications?)\b/,
});
const WITH_OTHERS_OF: Readonly<Record<string, string>> = Object.freeze({ schedule: 'schedule', schedules: 'schedule', file: 'file', files: 'file' });
const PRICE_VERBS = new Set(['cut', 'cuts', 'lower', 'lowers', 'raise', 'raises', 'change', 'changes', 'set', 'sets', 'update', 'updates', 'drop', 'drops']);
const PRICE_WORDS = new Set(['price', 'prices', 'pricing', 'rate', 'rates', 'fee', 'fees']);
const VERB_PLACE = new Set(['and', 'then', 'to', 'also', 'will', 'can']);
/**
 * Words that keep the owner in the act: the agent drafts, suggests or asks, or the act goes to the owner only (review
 * round 2: "Reminds me to send invoices", "Tells me when..."). A reminder or an explanation to a client is outward, so
 * "Reminds clients to pay" is not owner-first.
 */
const OWNER_FIRST = /\b(?:draft\w*|suggest\w*|propos\w*|prepares?|preparing|asks?\s+(?:me|you|first|before)|asking\s+(?:me|you)|(?:for|with|after|until|once)\s+(?:my|your)\s+(?:approval|ok|review|sign-off)|(?:after|until|once|when)\s+(?:i|you)\s+(?:approve|review|say|agree)|for\s+(?:me|you)\s+to|(?:send|sends|email|emails|message|messages|tell|tells|share|shares|forward|forwards)\s+(?:it\s+|them\s+)?(?:to\s+)?(?:me|you)|(?:remind|reminds|notify|notifies|alert|alerts|warn|warns|ping|pings|show|shows|tell|tells)\s+(?:me|you)|with\s+(?:me|you))\b/;
/**
 * A duty read as clauses, so "Drafts and sends invoices" is two acts and the send is judged on its own. Review round 3:
 * a period, semicolon, ampersand, slash, spaced dash, new line, "plus", "also" or "while" starts a clause too, so
 * "Pays vendors. Reminds me on Fridays." is judged on "pays vendors".
 */
const CLAUSES = /\s*([.,;&/\n]|\s-\s|\band\b|\bthen\b|\bbut\b|\bplus\b|\balso\b|\bwhile\b)\s*/;
/** Reminding, notifying or messaging anyone but the owner is an outward message (review round 3). */
const OUTWARD_VERBS = new Set(['remind', 'reminds', 'notify', 'notifies', 'alert', 'alerts', 'warn', 'warns', 'ping', 'pings', 'tell', 'tells', 'text', 'texts', 'call', 'calls', 'contact', 'contacts', 'invite', 'invites', 'greet', 'greets', 'thank', 'thanks', 'follow', 'follows', 'chase', 'chases', 'nudge', 'nudges', 'whatsapp', 'whatsapps', 'dm', 'dms']);
/**
 * C7 (main lane): the duty floor is an allow-list. A duty's clause passes only when its act is one of these, kept inside
 * the business (keeping, tracking, listing, checking, drafting, suggesting and the like), or when it is directed at the
 * owner (OWNER_FIRST). Scheduling and filing count as inside unless they name others (WITH_OTHERS). Any other act refuses.
 */
const INTERNAL_VERBS = new Set(['keep', 'keeps', 'track', 'tracks', 'list', 'lists', 'check', 'checks', 'flag', 'flags', 'summarise', 'summarises', 'summarize', 'summarizes',
  'draft', 'drafts', 'suggest', 'suggests', 'prepare', 'prepares', 'propose', 'proposes', 'read', 'reads', 'note', 'notes', 'log', 'logs', 'record', 'records',
  'watch', 'watches', 'monitor', 'monitors', 'sort', 'sorts', 'organise', 'organises', 'organize', 'organizes', 'research', 'researches', 'find', 'finds',
  'compare', 'compares', 'plan', 'plans', 'write', 'writes', 'calculate', 'calculates', 'count', 'counts', 'review', 'reviews', 'update', 'updates',
  'tag', 'tags', 'label', 'labels', 'collect', 'collects', 'gather', 'gathers', 'study', 'studies', 'measure', 'measures', 'outline', 'outlines', 'brainstorm', 'brainstorms',
  'schedule', 'schedules', 'file', 'files']);
/** Words that open a clause without being its act: when, how often, for whom. Skipped to find the act. */
const LEAD_WORDS = new Set(['automatically', 'also', 'always', 'regularly', 'carefully', 'quickly', 'then', 'every', 'each', 'daily', 'weekly', 'monthly',
  'on', 'in', 'at', 'by', 'for', 'with', 'when', 'if', 'before', 'after', 'once', 'until', 'the', 'a', 'an', 'my', 'all', 'any', 'morning', 'evening', 'night',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'week', 'month', 'day', 'first', 'last', 'next']);
/** The clause's act: its first word that is not a lead word, or null when it has none (a fragment such as "on Fridays"). */
function actOf(words: readonly string[]): string | null {
  return words.find(word => !LEAD_WORDS.has(word) && !/^\d+$/.test(word)) ?? null;
}
/** Whether a duty's clause is an act kept inside the business (WITH_OTHERS decides scheduling and filing). */
function insideAct(words: readonly string[]): boolean {
  const act = actOf(words);
  if (act === null) return true;
  if (!INTERNAL_VERBS.has(act)) return false;
  const shared = WITH_OTHERS_OF[act];
  return !shared || !WITH_OTHERS[shared]!.test(words.slice(words.indexOf(act) + 1).join(' '));
}

/**
 * A list of things under one verb is one act (found live, 14 Nov 2026: "Tracks replies and orders" was refused). After
 * "and", a comma, "&", "/" or "plus", a clause reads as more things for the verb before it, not as a new act, when that
 * verb is in the third person with something after it ("Tracks leads") and the clause opens with a thing: a word with
 * no third-person "s" ("order status", "client feedback"), or a plural with nothing after it but when or whose
 * ("orders", "refunds for each month"). A word that is only ever a verb ("pays"), a known verb with something to act
 * on ("orders supplies", "emails them") and a bare verb aimed at people ("email clients") are still judged as acts.
 */
const LIST_JOINS = new Set(['and', ',', '&', '/', 'plus']);
const THING_PLURALS = new Set(['orders', 'replies', 'messages', 'emails', 'posts', 'answers', 'charges', 'refunds', 'transfers', 'purchases', 'shares', 'uploads', 'calls', 'texts', 'contacts', 'invites', 'alerts', 'discounts', 'bookings', 'updates', 'notes', 'records', 'lists', 'plans', 'reviews', 'files', 'schedules', 'drafts', 'labels', 'tags', 'logs', 'checks', 'flags', 'counts', 'reads']);
const THING_BARE = new Set(['order', 'reply', 'message', 'email', 'post', 'answer', 'charge', 'refund', 'transfer', 'purchase', 'upload', 'call', 'text', 'contact', 'invite', 'alert', 'discount', 'follow']);
const AFTER_THING = new Set(['for', 'from', 'in', 'on', 'of', 'by', 'about', 'at', 'each', 'every', 'daily', 'weekly', 'monthly', 'that', 'which', 'due']);
const ACTED_ON = new Set(['them', 'him', 'her', 'it', 'everyone', 'people', 'clients', 'client', 'customers', 'customer', 'leads', 'lead', 'vendors', 'vendor', 'buyers', 'buyer', 'guests', 'patients']);
const knownVerb = (word: string) => INTERNAL_VERBS.has(word) || FLOOR_VERBS.has(word) || OUTWARD_VERBS.has(word) || PRICE_VERBS.has(word) || word in WITH_OTHERS_OF;
/** Whether a clause after a list join names more things for the verb before it (see LIST_JOINS). */
function moreThings(words: readonly string[]): boolean {
  const first = words[0], next = words[1];
  if (first === undefined) return false;
  if (first.endsWith('s') && !THING_BARE.has(first)) {
    if (knownVerb(first) && !THING_PLURALS.has(first)) return false;
    return next === undefined || AFTER_THING.has(next);
  }
  if (knownVerb(first)) return THING_BARE.has(first) && next !== undefined && !ACTED_ON.has(next);
  return true;
}
/** Whether a clause that passed can head a list: a third-person verb with something after it. */
function headsList(words: readonly string[]): boolean {
  const act = actOf(words);
  return act !== null && act.length > 2 && act.endsWith('s') && words.indexOf(act) < words.length - 1;
}

/**
 * An act the owner does is not the agent acting (found in the real app, 16 Nov 2026: the AI's own duty "Drafts short
 * captions for you to review and post." was refused, since "post" after "and" was read as the agent's act). The owner
 * acts in what follows "for me to" or "for you to", "so I can" or "so you can", and "I" or "you" before a verb at the
 * start of a clause or after "that", "when", "once" and the like ("you approve"). What stands before those words in the
 * clause is still the agent's and is judged ("Posts so you can rest"). A clause joined by "and", a comma or "then" goes
 * on with the owner's act only when it opens with a verb in its bare form ("and post"): the agent's own act is said in
 * the third person ("and posts them") and is judged. In a duty whose own acts are bare ("Draft captions for me to
 * review"), the form cannot tell the two apart, so a bare verb with something of its own to act on ("and post them")
 * is judged as the agent's.
 */
const OWNER_VERBS = Object.freeze(['approve', 'review', 'check', 'read', 'edit', 'rewrite', 'post', 'send', 'publish', 'share', 'upload', 'forward', 'email', 'message', 'reply', 'answer',
  'pay', 'refund', 'buy', 'order', 'book', 'sign', 'submit', 'file', 'confirm', 'decide', 'choose', 'pick', 'copy', 'paste', 'print', 'use', 'accept', 'decline', 'cancel',
  'delete', 'remove', 'agree', 'say', 'ok', 'call', 'text', 'price', 'record', 'deliver']);
const OWNER_VERB_SET: ReadonlySet<string> = new Set(OWNER_VERBS);
const MAY = '(?:can|could|may|might|will)';
const OWNER_ACTS = new RegExp(`\\bfor\\s+(?:me|you)\\s+to\\s+[a-z]|\\bso\\s+(?:that\\s+)?(?:i|you)\\s+${MAY}\\s+[a-z]`
  + `|(?:^\\s*|\\b(?:that|which|what|when|once|after|until|before|if|as|so)\\s+)(?:i|you)\\s+(?:${MAY}\\s+[a-z]|(?:then\\s+|just\\s+|only\\s+|always\\s+)?(?:${OWNER_VERBS.join('|')})\\b)`);
const OWNER_JOINS = new Set(['and', ',', 'then', '&', 'plus']);
/** Words after a bare verb that are not a thing of its own to act on: where, when, to whom. */
const AFTER_OWNER_VERB = new Set([...AFTER_THING, 'to', 'with', 'myself', 'yourself', 'later', 'when', 'once', 'after', 'if', 'as']);
/** Whether the agent acts inside words that open as the owner's ("you can relax as it posts"): then none of it is the owner's. */
const AGENT_SUBJECTS = new Set(['it', 'they', 'he', 'she', 'agent', 'chausar']);
const agentActsIn = (part: string) => part.split(/[^a-z0-9]+/).filter(Boolean).some((word, index, all) => AGENT_SUBJECTS.has(word) && all[index + 1] !== undefined && knownVerb(all[index + 1]!));
/** Whether a clause after a join goes on with the act the owner was doing (see OWNER_ACTS). */
function ownerGoesOn(words: readonly string[], agentBare: boolean): boolean {
  const first = words[0], next = words[1];
  if (first === undefined || !OWNER_VERB_SET.has(first)) return false;
  return !agentBare || next === undefined || AFTER_OWNER_VERB.has(next);
}

/**
 * True when the words have the agent send, pay, post, delete or change a price without the owner. allowList (duties):
 * also true when a clause's act is not one kept inside the business and the clause is not directed at the owner.
 */
function actsWithoutOwner(words: string, floorActs: ReadonlySet<string>, allowList = false): boolean {
  const flat = words.toLowerCase(), tokens = flat.split(/[^a-z0-9]+/).filter(Boolean);
  if (UNATTENDED.test(flat) && tokens.some(word => floorActs.has(word))) return true;
  const pieces = flat.split(CLAUSES);
  let join = '', head = false, owner = false, agentBare = false;
  for (let at = 0; at < pieces.length; at += 2) {
    const whole = pieces[at]!;
    if (at > 0) join = (pieces[at - 1] ?? '').trim();
    if (!whole) continue;
    // The owner's act, going on from the clause before or starting in this one, is not the agent's.
    if (owner && OWNER_JOINS.has(join) && ownerGoesOn(whole.split(/[^a-z0-9]+/).filter(Boolean), agentBare)) continue;
    const mark = whole.search(OWNER_ACTS);
    owner = mark >= 0 && !agentActsIn(whole.slice(mark));
    const ownerFirst = OWNER_FIRST.test(whole);
    const clause = owner && !ownerFirst ? whole.slice(0, mark) : whole;
    const words = clause.split(/[^a-z0-9]+/).filter(Boolean);
    if (!words.length) { head = false; continue; }
    const act = actOf(words);
    if (act !== null && knownVerb(act) && !act.endsWith('s')) agentBare = true;
    const listed = head && LIST_JOINS.has(join) && moreThings(words);
    if (!listed) {
      head = false;
      if (ownerFirst) { head = headsList(words); continue; }
      if (allowList && !insideAct(words)) return true;
    }
    const acts = words.some((word, index) => {
      if (listed && index === 0) return false;
      // After "it" the verb is the agent's own ("when it sends them").
      if (index > 0 && !VERB_PLACE.has(words[index - 1]!) && words[index - 1] !== 'it') return false;
      if (FLOOR_VERBS.has(word)) return true;
      if (WITH_OTHERS_OF[word] && WITH_OTHERS[WITH_OTHERS_OF[word]!]!.test(words.slice(index + 1).join(' '))) return true;
      if (OUTWARD_VERBS.has(word) && words[index + 1] !== undefined && !['me', 'myself', 'you', 'yourself'].includes(words[index + 1]!)) return true;
      return PRICE_VERBS.has(word) && words.slice(index + 1, index + 4).some(next => PRICE_WORDS.has(next));
    });
    if (acts) return true;
    if (!listed) head = headsList(words);
  }
  return false;
}

/** The role, trimmed, when every check passes; otherwise a ChausarError with plain words. */
export function checkHireWith(rules: HireRules, role: HireRole, context: { agentNames: readonly string[] }): HireRole {
  const floorActs = new Set([...rules.floorWords, ...FLOOR_ACT_WORDS]);
  if (!plain(role) || Object.keys(role).sort().join() !== 'department,duties,job,name,reads') throw invalid('A hired agent needs exactly a name, a job, its duties, what it reads and a department.');
  const name = text(role.name, HIRE_LIMITS.name, 'a name');
  if (RESERVED_NAMES.includes(name.toLowerCase())) throw invalid(`${name} is a name Chausar keeps for itself. Pick another.`);
  if ((context?.agentNames ?? []).some(other => typeof other === 'string' && other.trim().toLowerCase() === name.toLowerCase())) throw invalid(`Another agent is already called ${name}. Pick another name.`);
  const job = text(role.job, HIRE_LIMITS.job, 'a job');
  if (!Array.isArray(role.duties) || role.duties.length < 1 || role.duties.length > HIRE_LIMITS.duties) throw invalid(`Give the agent one to ${HIRE_LIMITS.duties} duties.`);
  const duties = role.duties.map(duty => text(duty, HIRE_LIMITS.duty, 'duty'));
  if (!Array.isArray(role.reads) || role.reads.some(read => !HIRE_READS.includes(read)) || new Set(role.reads).size !== role.reads.length) throw invalid(`A hired agent reads only from: ${HIRE_READS.join(', ')}.`);
  if (!rules.departments.includes(role.department)) throw invalid(`Put the agent in one of the departments: ${rules.departments.join(', ')}.`);
  for (const words of [name, job, ...duties]) {
    const stop = hardStopIn(words);
    if (stop) throw new ChausarError('HIRE_HARD_STOP', `${stop.line} ${HARD_STOP_WORDS}`);
  }
  // The raw words, so a new line still separates two acts (the stored fields have their spaces collapsed).
  for (const [index, words] of [role.job, ...role.duties].entries()) {
    if (actsWithoutOwner(words, floorActs, index > 0)) throw new ChausarError('HIRE_FLOOR', 'A hired agent asks you before anything is sent, paid, posted, deleted or priced. Write that duty so it drafts for your approval.');
  }
  return { name, job, duties, reads: [...role.reads], department: role.department };
}
