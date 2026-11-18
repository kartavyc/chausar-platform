// A hired agent's capability page (venture.agents.capabilities for an agent the owner hired, at setup or on Team).
// A hired agent owns no step of the work, so the page of a plan's agent (capabilities.ts: steps, the team's tools) has
// nothing true to say about it, and until 15 Nov 2026 the engine answered "That agent was not found". This is its own
// page, in its own words: what it reads is what its hire card lists (hired-facts.ts reads nothing else), what it does
// is its duties, in chat, in routines and in the trackers it keeps, and what is off is everything a hired agent can
// never do: send, pay, post, delete or change a price, search or contact anyone, work on an order's files. It always
// asks first (views/team.ts HIRE_POSTURE_FIXED). True before and after the plan is accepted.
// Pure: no store and no engine import beyond the hire's own list of reads, so the app's fake engine builds the same page.
import { HIRE_READS, type HireRead } from './hire-check-core.ts';

type Item = { list: 'see' | 'do' | 'off'; key: string; state: 'works' | 'reads' | 'records' | 'hands-off' | 'planned' | 'off'; line: string };
export type HiredCapabilityPage = { agent: string; canSee: string[]; canDo: string[]; off: string[]; items: Item[]; line: string };

/** Only clients who let their records go to the owner's AI are read (chief/client-context.ts). */
const CONSENT = 'only for clients who let their records go to your AI';
/** What each area on a hire card gives the agent to read (hired-facts.ts, through the chief's read tools). */
export const HIRED_READ_WORDS: Readonly<Record<HireRead, string>> = Object.freeze({
  clients: `Your clients and their orders, ${CONSENT}.`,
  orders: `Your open and delivered orders, ${CONSENT}.`,
  runs: `Recent jobs: who did each, what for and how it stands, ${CONSENT}.`,
  money: 'Money: what clients owe, what came in, what AI cost and the open invoices, each figure with its receipt.',
  plan: 'Your plan: the offers you sell.',
  journal: 'The latest twenty outside actions in the journal and how each stands.',
  notes: 'Its own notes.',
  trackers: 'The trackers it keeps: their names and columns.',
});

export const HIRED_PAGE_WORDS = Object.freeze({
  line: 'You hired this agent. It works in chat, in routines and in the trackers it keeps, reads only what its hire card lists, and always asks you first.',
  chat: 'What you write in its chat, and what your business is in your own words.',
  noReads: 'Nothing else: its hire card lists nothing for it to read.',
  noDuties: 'It has no duties yet. Add them in its sheet on Team.',
  answers: 'Answer you in its chat, from what it reads.',
  routines: 'Run a routine you set for it. Each time, the result waits for you on Today.',
  trackers: 'Add rows to a tracker it keeps, when you ask. Each row carries its name and has Undo.',
  asks: 'Ask you before anything leaves. This cannot be loosened.',
  provider: 'Send your message, with what it reads, to your own AI provider: your key or the CLI you set up.',
  write: "Can't send, pay, post, delete or change a price: it holds no tool that does any of these.",
  reach: "Can't search the web, find customers or contact anyone.",
  orders: "Can't work on an order's files: it owns no step of the work.",
  reads: "Can't read anything its hire card does not list.",
  amounts: "Can't see any amount: its hire card does not list money.",
  /** After a duty that sounds like a search for customers, so the page never says the agent works at what it cannot do. */
  listsOnly: 'Only the ones a search found or you added: it does not search.',
});

/**
 * A duty that sounds like a search for customers (seen on Windows, 15 Nov 2026: "Works: Lists possible cafe customers"
 * beside "Can't search the web, find customers or contact anyone"): it starts by listing or finding, and names
 * customers the business does not have yet (possible, potential, likely ones, leads, prospects) or a public source. A
 * list of the clients the owner already has is not one.
 */
const SOUNDS_LIKE_SEARCH = /^(?:lists?|finds?|builds?|compiles?|gathers?|shortlists?|searches|researches|looks?\s+for|identif\w+)\b.*\b(?:(?:possible|potential|prospective|likely)\s+(?:[\p{L}'-]+\s+){0,3}(?:customers?|clients?|buyers?|leads?)|leads?|prospects?|public\s+(?:listings?|sources?|directories|maps?))\b/iu;

const item = (list: Item['list'], key: string, state: Item['state'], line: string): Item => ({ list, key, state, line });
const sentence = (text: string) => { const words = text.trim(); return /[.!?]$/.test(words) ? words : `${words}.`; };

/** The page for one hired agent, from its hire alone: its duties and the reads on its card. Reads only. */
export function hiredCapabilityPage(hired: { id: string; duties: readonly string[]; reads: readonly { read: string }[] }): HiredCapabilityPage {
  const chosen = HIRE_READS.filter(read => hired.reads.some(entry => entry.read === read));
  const items: Item[] = [
    item('see', 'hire:chat', 'reads', HIRED_PAGE_WORDS.chat),
    ...(chosen.length ? chosen.map(read => item('see', `read:${read}`, 'reads', HIRED_READ_WORDS[read])) : [item('see', 'hire:no-reads', 'off', HIRED_PAGE_WORDS.noReads)]),
    ...(hired.duties.length ? hired.duties.map((duty, index) => item('do', `duty:${index + 1}`, 'works', SOUNDS_LIKE_SEARCH.test(duty.trim()) ? `${sentence(duty)} ${HIRED_PAGE_WORDS.listsOnly}` : sentence(duty))) : [item('do', 'hire:no-duties', 'off', HIRED_PAGE_WORDS.noDuties)]),
    item('do', 'hire:answers', 'works', HIRED_PAGE_WORDS.answers),
    item('do', 'hire:routines', 'works', HIRED_PAGE_WORDS.routines),
    item('do', 'hire:trackers', 'works', HIRED_PAGE_WORDS.trackers),
    item('do', 'hire:asks', 'works', HIRED_PAGE_WORDS.asks),
    item('do', 'hire:provider', 'works', HIRED_PAGE_WORDS.provider),
    item('off', 'hire:write', 'off', HIRED_PAGE_WORDS.write),
    item('off', 'hire:reach', 'off', HIRED_PAGE_WORDS.reach),
    item('off', 'hire:orders', 'off', HIRED_PAGE_WORDS.orders),
    item('off', 'hire:reads', 'off', HIRED_PAGE_WORDS.reads),
    ...(chosen.includes('money') ? [] : [item('off', 'hire:amounts', 'off', HIRED_PAGE_WORDS.amounts)]),
  ];
  const of = (list: Item['list']) => items.filter(entry => entry.list === list).map(entry => entry.line);
  return { agent: hired.id, canSee: of('see'), canDo: of('do'), off: of('off'), items, line: HIRED_PAGE_WORDS.line };
}
