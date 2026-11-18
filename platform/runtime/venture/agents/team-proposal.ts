// A small team proposed from the plan (founder, 14 Nov 2026: "let's build a few agents during setup"). In the same About
// you answer as the way to earn (core/way.ts), the owner's AI proposes one to three agents whose jobs come from the
// owner's own plan: a name, a one-line job, one to five duties and what each reads. Code holds every agent to the rules
// a hand hire passes (hire-check-core.ts: plain short fields, reads from HIRE_READS only, no hard stop, and duties that
// only keep, track, list, check, flag, summarise, draft, suggest or prepare), and to the way's own plain-words rule: no
// price, no link, and no promise of results. An agent that fails is dropped and the rest stay.
//
// Each kept agent carries the digest of its own card. venture.agents.hire.team (agents/hire.ts) takes the cards the
// owner kept and hires only a card whose digest still matches its words; the hired record keeps that digest, so the same
// card is never hired twice.
//
// Seen in the real app on Windows (15 Nov 2026), and held here since:
//   - every proposed agent was hired into Operations, so Team said "No agents in Sales and clients yet" beside an agent
//     whose job is the customer pipeline. The AI now names each agent's department from the engine's own list; a
//     missing or unknown one is worked out by code from the agent's duties and reads (departmentFor).
//   - two proposed agents were given the order work the playbook's own agents do, and one a duty on video files. A
//     duty that is such work is taken out; an agent whose job is such work, or with no duty left, is dropped
//     (agents/order-agents-core.ts).
// This file imports no engine store code, so the app's fake engine checks a team with the same keptTeamWith.
import { ChausarError, digest, type Json } from '../../portable.ts';
import { plainLine } from '../core/way.ts';
import { ownerVoice } from '../core/owner-voice.ts';
import { HIRE_LIMITS, HIRE_READS, type HireRead, type HireRole } from './hire-check-core.ts';
import { KEEPER_JOINS, fileWorkIn, orderWorkIn, sameWorkAs, type OrderAgents } from './order-agents-core.ts';

/**
 * Said on Team beside the hired agents while the plan is not accepted (views/team.ts): the plan's own agents and Keeper
 * join with it. Here, so the app's fake engine says the same words.
 */
export const TEAM_WAITS_FOR_PLAN = 'The agents that do your orders join when you accept your plan.';
/** A setup team is small: the owner reads every card before keeping the plan. */
export const TEAM_MAX = 3;
/** The engine's departments (contracts.ts DEPARTMENT_IDS; a test holds the two lists equal), named here for the fake. */
export const TEAM_DEPARTMENTS = Object.freeze(['sales', 'marketing', 'production', 'money', 'operations'] as const);
export type TeamDepartment = typeof TEAM_DEPARTMENTS[number];
/** Where a card with no department is hired (a card made before departments); the owner moves it on Team as any hired agent. */
export const TEAM_DEPARTMENT: TeamDepartment = 'operations';
/** department: where the agent works, from TEAM_DEPARTMENTS. Absent only on a card made before departments. */
export type TeamAgent = { name: string; job: string; duties: string[]; reads: HireRead[]; department?: TeamDepartment };
/** An agent as the owner reads it: its words and the digest of exactly those words. */
export type TeamCard = TeamAgent & { digest: string };
/** The hand hire's own check, with what its caller knows (the engine's departments and floor words, or the fake's). */
export type HireChecker = (role: HireRole, context: { agentNames: readonly string[] }) => HireRole;

const FIELDS = ['name', 'job', 'duties', 'reads'] as const;
/** The team as the AI writes it names a department too; code checks it and works one out when it is missing or unknown. */
const WRITTEN = [...FIELDS, 'department'] as const;
const line = { type: 'string' };
/** The team as the AI writes it: an empty list is how it says it has too little to go on yet. */
export const TEAM_SCHEMA: Json = {
  type: 'array',
  items: {
    type: 'object', additionalProperties: false, required: [...WRITTEN],
    properties: { name: line, job: line, duties: { type: 'array', items: line }, reads: { type: 'array', items: { type: 'string', enum: [...HIRE_READS] } }, department: { type: 'string', enum: [...TEAM_DEPARTMENTS] } },
  },
} as unknown as Json;

/** A promise of results: an agent drafts and tracks; it never says what the owner will get. */
const PROMISE = /\b(?:guarantee\w*|promis\w*|assure[sd]?)\b/i;
const WORDS_LINE = 'An agent on your team is plain words: no price, no link and no promise of results.';
const FILES_LINE = 'An agent on your team works from your records, notes and text: it has no duty on audio, video, images or files.';
const SHAPE_LINE = 'Each agent is a name, a job, its duties and what it reads.';
const STALE_LINE = 'This changed since you read it. Read it again.';
const invalid = (message: string) => new ChausarError('INVALID_VENTURE_REQUEST', message);
const plain = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const closed = (value: unknown, keys: readonly string[]): value is Record<string, unknown> => plain(value) && Object.keys(value).sort().join() === [...keys].sort().join();
/** An agent's four parts, with or without a department beside them. */
const shaped = (value: unknown): value is Record<string, unknown> => closed(value, FIELDS) || closed(value, WRITTEN);
export const isTeamDepartment = (value: unknown): value is TeamDepartment => typeof value === 'string' && (TEAM_DEPARTMENTS as readonly string[]).includes(value);

/** The digest of one agent's card: its parts as the owner reads them, the department among them when the card has one. */
export function teamCardDigest(agent: TeamAgent): string {
  return digest({ kind: 'venture-team-agent', name: agent.name, job: agent.job, duties: [...agent.duties], reads: [...agent.reads], ...(agent.department ? { department: agent.department } : {}) });
}

/** What each department's work is about, as an agent's job and duties say it. Production is where orders are done: never guessed. */
const DEPARTMENT_WORDS: readonly (readonly [TeamDepartment, RegExp])[] = Object.freeze([
  // Outreach is Sales and clients, except outreach copy: words written to be read are Marketing's.
  ['sales', /\b(?:leads?|prospects?|customers?|clients?|buy(?:s|ers?)?|pipeline|follow[- ]?ups?|outreach(?! copy)|quotes?|proposals?|enquir\w+|inquir\w+|sales|deals?)\b/i],
  ['marketing', /\b(?:posts?|content|social|newsletters?|campaigns?|brand\w*|marketing|audience|blogs?|catalogues?|captions?|hashtags?|instagram|facebook|reels?|ads|adverts?|advertis\w*|promotions?|flyers?|posters?|copywrit\w*|(?:outreach|ad|marketing|website) copy)\b/i],
  ['money', /\b(?:invoices?|payments?|expenses?|receipts?|bills?|books|ledgers?|tax(?:es)?|dues?)\b/i],
] as const);

/**
 * The department code gives an agent whose own is missing or unknown, and where a hand hire starts (agents/hire.ts):
 * the one most of its job and duties speak of (customers and follow ups: Sales and clients; posts, captions, social
 * media, ads and outreach copy: Marketing; invoices and payments: Money), a tie going
 * to the earlier of those; reading Money counts once for Money. Nothing of those: Operations.
 */
export function departmentFor(agent: { job: string; duties: readonly string[]; reads: readonly string[] }): TeamDepartment {
  let best: TeamDepartment = TEAM_DEPARTMENT, most = 0;
  for (const [department, words] of DEPARTMENT_WORDS) {
    const count = [agent.job, ...agent.duties].filter(text => words.test(text)).length + (department === 'money' && agent.reads.includes('money') ? 1 : 0);
    if (count > most) { best = department; most = count; }
  }
  return best;
}

/**
 * One agent, tidied, when it passes the hand hire's check and the plain-words rule; otherwise a ChausarError with the
 * hire's own code (HIRE_HARD_STOP, HIRE_FLOOR) or INVALID_VENTURE_REQUEST. names: the agents it may not share a name with.
 */
export function checkedTeamAgent(check: HireChecker, value: unknown, names: readonly string[]): TeamAgent {
  if (!shaped(value)) throw invalid(SHAPE_LINE);
  // A department that is not one of the engine's is worked out by code; a card with none (made before departments) keeps none.
  const given = Object.hasOwn(value, 'department');
  const checked = check({ name: value.name, job: value.job, duties: value.duties, reads: value.reads, department: isTeamDepartment(value.department) ? value.department : TEAM_DEPARTMENT } as HireRole, { agentNames: names });
  for (const words of [checked.name, checked.job, ...checked.duties]) {
    if (plainLine(words, Math.max(HIRE_LIMITS.job, HIRE_LIMITS.duty)) === null || PROMISE.test(words)) throw invalid(WORDS_LINE);
    // A hired agent reads only its listed records: it opens no file and hears no recording (order-agents-core.ts).
    if (words !== checked.name && fileWorkIn(words)) throw invalid(FILES_LINE);
  }
  const department = isTeamDepartment(value.department) ? value.department : departmentFor(checked);
  return { name: checked.name, job: checked.job, duties: checked.duties, reads: checked.reads, ...(given ? { department } : {}) };
}

/** What a proposed team is held against beside the hire rules: what is sold, and who does each order (core/about.ts). */
export type TeamContext = { offers: readonly { name: string }[]; orderAgents: OrderAgents | null };

/**
 * An agent as the AI wrote it, with the duties it cannot have taken out: work on audio, video, images or files, and,
 * where a playbook's own agents do the orders, the order work itself. Null when its job is such work or no duty is
 * left. A department is always on the result: the AI's own, checked later, or none yet for code to work out.
 */
function fitted(value: unknown, context: TeamContext | undefined): unknown {
  if (!plain(value) || typeof value.job !== 'string' || !Array.isArray(value.duties)) return value;
  const order = context?.orderAgents?.flagship ? { offers: context.offers.map(offer => offer.name), roles: context.orderAgents.agents.map(agent => agent.name) } : null;
  const not = (words: unknown) => typeof words === 'string' && (fileWorkIn(words) || (order !== null && orderWorkIn(words, order)));
  if (not(value.job)) return null;
  const duties = value.duties.filter(duty => !not(duty));
  return duties.length ? { ...value, duties, department: value.department ?? null } : null;
}

/** An agent as the AI wrote it with its job and duties said to the owner ("you"); anything else is left for the check to refuse. */
function inOwnerVoice(value: unknown): unknown {
  if (!plain(value)) return value;
  return {
    ...value,
    ...(typeof value.job === 'string' ? { job: ownerVoice(value.job) } : {}),
    ...(Array.isArray(value.duties) ? { duties: value.duties.map(duty => (typeof duty === 'string' ? ownerVoice(duty) : duty)) } : {}),
  };
}

/**
 * The name an agent gets by rule when the one it was given is taken: the agent noun of what it does, from the first
 * word of its job and then of each duty (the acts the AI is asked to start them with, and the two it uses beside them).
 */
const NAME_OF_ACT: Readonly<Record<string, string>> = Object.freeze({
  keeps: 'Organiser', tracks: 'Tracker', lists: 'Lister', checks: 'Checker', flags: 'Spotter', summarises: 'Summariser', summarizes: 'Summariser',
  drafts: 'Drafter', suggests: 'Adviser', prepares: 'Planner', finds: 'Scout', reminds: 'Reminder',
});
/** The name a playbook's own code goes by on Team, and the engine's own: never an agent's. */
const CODE_NAME = 'Chausar';
const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * No two agents in one business show the same name (found in the real app, 16 Nov 2026: the AI proposed a "Reader" and
 * the booking desk's order crew brought its own "Reader"; Team then listed Reader twice). The names the plan's own team
 * takes are known before the plan is kept (agents/order-agents.ts): its order agents, its code roles, Keeper and
 * Chausar itself. A proposed agent with one of those names, or with the name of an agent already kept, is:
 *   - merged into the order agent of that name when its words are that agent's work (sameWorkAs): it is left out, and
 *     the order agent, which the card shows beside the team, does it;
 *   - else named after what it does (NAME_OF_ACT), by the first of its acts whose name is free. Never a number.
 * Null when it is merged, or when none of its acts gives a free name: the owner can hire it by hand under their own name.
 */
function named(value: unknown, context: TeamContext | undefined, kept: readonly string[]): unknown {
  if (!plain(value) || typeof value.name !== 'string' || typeof value.job !== 'string' || !Array.isArray(value.duties)) return value;
  const order = context?.orderAgents ?? null;
  const taken = [...(order?.agents.map(agent => agent.name) ?? []), ...(order?.code ?? []), KEEPER_JOINS.name, CODE_NAME, ...kept];
  const name = value.name;
  if (!taken.some(other => sameName(other, name))) return value;
  const lines = [value.job, ...value.duties.filter((duty): duty is string => typeof duty === 'string')];
  const twin = order?.flagship ? order.agents.find(agent => sameName(agent.name, name)) : undefined;
  if (twin && sameWorkAs(lines, twin.does)) return null;
  const free = lines.map(line => NAME_OF_ACT[line.trim().split(/\s+/)[0]?.toLowerCase() ?? '']).find(found => found !== undefined && !taken.some(other => sameName(other, found)));
  return free ? { ...value, name: free } : null;
}

/**
 * The team as it is kept: the first TEAM_MAX agents that pass, each with its card's digest. An agent that fails any
 * rule is dropped, and one whose name is taken is merged or named by rule (named); anything that is not a list keeps
 * no team. Each agent is
 * checked as the AI wrote it and again in the owner voice (core/owner-voice.ts), and is kept in that voice: the words
 * the owner reads on the card and on Team, which the card's digest is of.
 */
export function keptTeamWith(check: HireChecker, value: unknown, context?: TeamContext): TeamCard[] {
  if (!Array.isArray(value)) return [];
  const team: TeamCard[] = [];
  for (const written of value) {
    if (team.length === TEAM_MAX) break;
    try {
      const item = named(fitted(written, context), context, team.map(kept => kept.name));
      if (item === null) continue;
      // The names the plan's own team takes are refused too, as the hand hire refuses them (agents/hire.ts).
      const names = [...team.map(kept => kept.name), ...(context?.orderAgents?.agents.map(agent => agent.name) ?? []), ...(context?.orderAgents?.code ?? [])];
      checkedTeamAgent(check, item, names);
      const agent = checkedTeamAgent(check, inOwnerVoice(item), names);
      team.push({ ...agent, digest: teamCardDigest(agent) });
    } catch { /* this agent is dropped; the rest stay */ }
  }
  return team;
}

/**
 * The cards a hire request carries, in the owner's order: one to TEAM_MAX, each exactly a card. A digest that is not
 * the digest of the card's own words is APPROVAL_STALE: the words are not the ones the owner was shown.
 */
export function teamCards(value: unknown): TeamCard[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > TEAM_MAX) throw invalid(`Hire one to ${TEAM_MAX} agents from your plan.`);
  return value.map(item => {
    if (!(closed(item, [...FIELDS, 'digest']) || closed(item, [...WRITTEN, 'digest'])) || typeof item.name !== 'string' || typeof item.job !== 'string'
      || !Array.isArray(item.duties) || !item.duties.every(duty => typeof duty === 'string') || !Array.isArray(item.reads) || !item.reads.every(read => typeof read === 'string')
      || (Object.hasOwn(item, 'department') && !isTeamDepartment(item.department))) throw invalid(SHAPE_LINE);
    const agent: TeamAgent = { name: item.name, job: item.job, duties: item.duties as string[], reads: item.reads as HireRead[], ...(isTeamDepartment(item.department) ? { department: item.department } : {}) };
    if (typeof item.digest !== 'string' || !/^[0-9a-f]{64}$/.test(item.digest) || item.digest !== teamCardDigest(agent)) throw new ChausarError('APPROVAL_STALE', STALE_LINE);
    return { ...agent, digest: item.digest };
  });
}
