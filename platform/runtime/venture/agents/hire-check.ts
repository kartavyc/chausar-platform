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
/** True when the words have the agent send, pay, post, delete or change a price without the owner. */
function actsWithoutOwner(words: string): boolean {
  const flat = words.toLowerCase();
  return UNATTENDED.test(flat) && flat.split(/[^a-z]+/).some(word => FLOOR_ACTS.has(word));
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
  for (const words of [job, ...duties]) {
    if (actsWithoutOwner(words)) throw new ChausarError('HIRE_FLOOR', 'A hired agent asks you before anything is sent, paid, posted, deleted or priced. Write that duty so it drafts for your approval.');
  }
  return { name, job, duties, reads: [...role.reads], department: role.department };
}
