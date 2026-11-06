// C7 task 13: the code checks on one more agent the owner hires. A hired agent works in chat, routines and trackers only,
// owns no delivery step and always asks before anything leaves; these checks hold its words to that before the owner is
// shown the review card. Short plain fields; reads only from HIRE_READS; a department the engine knows; no hard stop
// anywhere in its words (HIRE_HARD_STOP, with that stop's own line); and no duty that sends, pays, posts, deletes or
// changes a price without the owner (HIRE_FLOOR). The interview, the record and the screens are C7 tasks 14 to 16.
import { ChausarError } from '../../portable.ts';
import { DEPARTMENT_IDS, type DepartmentId } from '../contracts.ts';
import { HARD_STOP_WORDS } from '../policy/hard-stops.ts';
import { hardStopIn } from '../policy/hard-stop-words.ts';
import { DESTRUCTIVE_WORDS } from '../policy/effects.ts';

export const HIRE_READS = Object.freeze(['clients', 'orders', 'runs', 'money', 'plan', 'journal', 'notes', 'trackers'] as const);
export type HireRead = typeof HIRE_READS[number];
export type HireRole = { name: string; job: string; duties: string[]; reads: HireRead[]; department: DepartmentId };
export const HIRE_LIMITS = Object.freeze({ name: 40, job: 120, duty: 160, duties: 5 });
/** Names the engine keeps for itself. */
const RESERVED_NAMES = Object.freeze(['chausar', 'keeper']);
/** Words that say the agent would act without the owner. */
const UNATTENDED = /\b(?:without\s+(?:asking|approval|my\s+approval|checking|my\s+ok|me)|automatically|auto-?(?:send|pay|post|delete|reply)\w*|on\s+(?:its|their|his|her)\s+own|by\s+(?:itself|themselves))\b/;
/** The floor's acts: send and post, money out and delete (effects.ts), and a price change. */
const FLOOR_ACTS = new Set([...DESTRUCTIVE_WORDS.send, ...DESTRUCTIVE_WORDS.moneyOut, ...DESTRUCTIVE_WORDS.delete, 'sends', 'posts', 'pays', 'deletes', 'removes', 'emails', 'shares', 'replies', 'price', 'prices', 'pricing', 'discount', 'discounts', 'reprice']);

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
const OWNER_FIRST = /\b(?:draft\w*|suggest\w*|propos\w*|prepares?|preparing|asks?\s+(?:me|first|before)|asking\s+me|(?:for|with|after|until|once)\s+(?:my|your)\s+(?:approval|ok|review|sign-off)|(?:after|until|once|when)\s+i\s+(?:approve|review|say|agree)|for\s+me\s+to|(?:send|sends|email|emails|message|messages|tell|tells|share|shares|forward|forwards)\s+(?:it\s+|them\s+)?(?:to\s+)?me|(?:remind|reminds|notify|notifies|alert|alerts|warn|warns|ping|pings|show|shows|tell|tells)\s+me|with\s+me)\b/;
/**
 * A duty read as clauses, so "Drafts and sends invoices" is two acts and the send is judged on its own. Review round 3:
 * a period, semicolon, ampersand, slash, spaced dash, new line, "plus", "also" or "while" starts a clause too, so
 * "Pays vendors. Reminds me on Fridays." is judged on "pays vendors".
 */
const CLAUSES = /\s*(?:[.,;&/\n]|\s-\s|\band\b|\bthen\b|\bbut\b|\bplus\b|\balso\b|\bwhile\b)\s*/;
/** Reminding, notifying or messaging anyone but the owner is an outward message (review round 3). */
const OUTWARD_VERBS = new Set(['remind', 'reminds', 'notify', 'notifies', 'alert', 'alerts', 'warn', 'warns', 'ping', 'pings', 'tell', 'tells', 'text', 'texts', 'call', 'calls', 'contact', 'contacts', 'invite', 'invites', 'greet', 'greets', 'thank', 'thanks', 'follow', 'follows', 'chase', 'chases', 'nudge', 'nudges', 'whatsapp', 'whatsapps', 'dm', 'dms']);
/** True when the words have the agent send, pay, post, delete or change a price without the owner. */
function actsWithoutOwner(words: string): boolean {
  const flat = words.toLowerCase(), tokens = flat.split(/[^a-z0-9]+/).filter(Boolean);
  if (UNATTENDED.test(flat) && tokens.some(word => FLOOR_ACTS.has(word))) return true;
  return flat.split(CLAUSES).filter(Boolean).some(clause => {
    if (OWNER_FIRST.test(clause)) return false;
    const words = clause.split(/[^a-z0-9]+/).filter(Boolean);
    return words.some((word, index) => {
      if (index > 0 && !VERB_PLACE.has(words[index - 1])) return false;
      if (FLOOR_VERBS.has(word)) return true;
      if (WITH_OTHERS_OF[word] && WITH_OTHERS[WITH_OTHERS_OF[word]].test(words.slice(index + 1).join(' '))) return true;
      if (OUTWARD_VERBS.has(word) && words[index + 1] !== undefined && !['me', 'myself'].includes(words[index + 1])) return true;
      return PRICE_VERBS.has(word) && words.slice(index + 1, index + 4).some(next => PRICE_WORDS.has(next));
    });
  });
}

/** The role, trimmed, when every check passes; otherwise a ChausarError with plain words. */
export function checkHire(role: HireRole, context: { agentNames: readonly string[] }): HireRole {
  if (!plain(role) || Object.keys(role).sort().join() !== 'department,duties,job,name,reads') throw invalid('A hired agent needs exactly a name, a job, its duties, what it reads and a department.');
  const name = text(role.name, HIRE_LIMITS.name, 'a name');
  if (RESERVED_NAMES.includes(name.toLowerCase())) throw invalid(`${name} is a name Chausar keeps for itself. Pick another.`);
  if ((context?.agentNames ?? []).some(other => typeof other === 'string' && other.trim().toLowerCase() === name.toLowerCase())) throw invalid(`Another agent is already called ${name}. Pick another name.`);
  const job = text(role.job, HIRE_LIMITS.job, 'a job');
  if (!Array.isArray(role.duties) || role.duties.length < 1 || role.duties.length > HIRE_LIMITS.duties) throw invalid(`Give the agent one to ${HIRE_LIMITS.duties} duties.`);
  const duties = role.duties.map(duty => text(duty, HIRE_LIMITS.duty, 'duty'));
  if (!Array.isArray(role.reads) || role.reads.some(read => !HIRE_READS.includes(read)) || new Set(role.reads).size !== role.reads.length) throw invalid(`A hired agent reads only from: ${HIRE_READS.join(', ')}.`);
  if (!DEPARTMENT_IDS.includes(role.department)) throw invalid(`Put the agent in one of the departments: ${DEPARTMENT_IDS.join(', ')}.`);
  for (const words of [name, job, ...duties]) {
    const stop = hardStopIn(words);
    if (stop) throw new ChausarError('HIRE_HARD_STOP', `${stop.line} ${HARD_STOP_WORDS}`);
  }
  // The raw words, so a new line still separates two acts (the stored fields have their spaces collapsed).
  for (const words of [role.job, ...role.duties]) {
    if (actsWithoutOwner(words)) throw new ChausarError('HIRE_FLOOR', 'A hired agent asks you before anything is sent, paid, posted, deleted or priced. Write that duty so it drafts for your approval.');
  }
  return { name, job, duties, reads: [...role.reads], department: role.department };
}
