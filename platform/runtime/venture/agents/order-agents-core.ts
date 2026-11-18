// The agents that do each order, and what a proposed agent may not be given (seen in the real app on Windows, 15 Nov
// 2026). Accepting a plan brings in the agents that do its orders: a playbook's own (a translation business gets a
// Translator and a Checker), else the one delivery agent of the eight fixed steps. The owner never saw them at setup,
// and the AI, not knowing of them, gave two proposed agents the same job ("Prepares Hindi-English translation drafts",
// "Prepares subtitle drafts from your video files"): five agents after acceptance, two pairs doing one job, one of them
// promising work on video it cannot open. A hired agent works in chat, routines and trackers and reads only its listed
// records (agents/hire.ts). So:
//   - About you tells the AI who will do each order and shows them on the card beside the proposed team;
//   - a proposed duty that is the order work of a playbook's own agents is taken out (orderWorkIn);
//   - so is a duty on audio, video, images or files (fileWorkIn).
// This file imports nothing of the engine, so the app's fake engine holds a team to the same rules.

import { RUN_FIXED_WORDS } from '../views/run-words.ts';

/** An agent that does orders, as the owner reads it: its name and one line on what it does. */
export type OrderAgent = { name: string; does: string };
/**
 * flagship: they are a playbook's own agents, each with a step of the order; else the one delivery agent. code: the
 * names of the playbook's own code roles (Billing, Chausar), which join with the plan too. They are not shown as order
 * agents, but no agent on the team may take one of their names.
 */
export type OrderAgents = { agents: OrderAgent[]; flagship: boolean; code?: string[] };

/** What the one delivery agent of the eight fixed steps does (agents/roles.ts and views/team.ts say the same). */
export const DELIVERY_JOB = RUN_FIXED_WORDS.deliveryJob;
/**
 * The same agent where no order flow fits the work (the plain service type: a maker of goods, work in no listed kind).
 * The owner records the order and makes and delivers it; the agent's part is the reply. Said as no more than that.
 */
export const OWN_ORDER_JOB = 'Drafts the reply to each order for you to check.';

/**
 * Keeper, which joins every team with the accepted plan (views/keeper.ts KEEPER_NAME; a test holds the names equal). It
 * does no order and is code, not AI, so it is never given to the AI as an order agent; but the owner is shown every
 * agent that will join (seen on Windows, 15 Nov 2026: Keeper appeared on Team after acceptance, listed nowhere before).
 */
export const KEEPER_JOINS: OrderAgent = Object.freeze({ name: 'Keeper', does: 'Runs backups and routine checks by fixed rules. It is code, not AI.' });

/** The delivery agent's name by the plan's service type (contracts.ts SERVICE_TYPES; views/shared.ts agentName reads this). */
export const DELIVERY_AGENT_NAMES: Readonly<Record<string, string>> = Object.freeze({
  agency: 'Marketing agent', studio: 'Studio agent', consulting: 'Consulting agent', bookkeeping: 'Bookkeeping agent',
  research: 'Research agent', content: 'Content agent', support: 'Support agent', other: 'Delivery agent',
  teaching: 'Teaching agent', 'local-services': 'Bookings agent', licensed: 'Practice agent',
});

/** The one delivery agent of a plan with no playbook of its own, by its service type. */
export function deliveryAgent(serviceType: string): OrderAgent {
  return { name: DELIVERY_AGENT_NAMES[serviceType] ?? DELIVERY_AGENT_NAMES.other!, does: serviceType === 'other' || !DELIVERY_AGENT_NAMES[serviceType] ? OWN_ORDER_JOB : DELIVERY_JOB };
}

const MEDIA = '(?:video|audio|voice|sound|image|photo|picture|recording|footage|podcast|scan)s?';
const FILES = `(?:${MEDIA}|files?|uploads?|attachments?|pdfs?|documents?|spreadsheets?)`;
/**
 * Work on audio, video, images or files: made "from your video files", from files or documents at all, a file of some
 * media, anything transcribed, uploaded or attached, or a media thing edited, cut, captioned or recorded. Words about
 * media that is only listed or tracked ("Lists video ideas", "Tracks photo shoot bookings") are not such work.
 */
const FILE_WORK = new RegExp([
  String.raw`\bfrom\s+(?:[\p{L}'-]+\s+){0,3}${FILES}\b`,
  String.raw`\b${MEDIA}\s+files?\b`,
  String.raw`\btranscri\w+`,
  String.raw`\b(?:uploaded|attached|scanned)\b`,
  String.raw`\b(?:edits?|cuts?|trims?|subtitles?|captions?|dubs?|records?|retouch\w*|converts?|opens?)\s+(?:[\p{L}'-]+\s+){0,2}${MEDIA}\b`,
].join('|'), 'iu');

/** Whether a job or a duty promises work on audio, video, images or files, which a hired agent cannot open. */
export function fileWorkIn(line: string): boolean {
  return FILE_WORK.test(line.replace(/\s+/g, ' '));
}

/** Acts that make or check the thing that is sold. Keeping, tracking, listing, flagging and summarising never do. */
const MAKES = new Set(['prepares', 'drafts', 'writes', 'checks', 'reviews', 'edits', 'translates', 'proofreads', 'makes', 'creates', 'produces', 'designs', 'narrates', 'subtitles', 'captions']);
/** What sales and admin work is about: with one of these the line is the team's own work, whatever it names. */
const SALES = /\b(?:proposals?|quotes?|quotations?|messages?|emails?|outreach|descriptions?|leads?|prospects?|pipeline|follow[- ]?ups?|reminders?|trackers?|invoices?|payments?|offers?|samples?|pitch(?:es)?|posts?|lists?|orders?|enquir\w+|inquir\w+|ideas?|calendar|(?:sales|marketing|contract|buyer)\s+materials?)\b/i;
/** Words an offer's name shares with any business: no sign of what is sold. */
const GENERIC = new Set(['service', 'services', 'work', 'works', 'order', 'orders', 'plan', 'plans', 'package', 'packages', 'monthly', 'yearly', 'weekly', 'custom', 'bulk', 'support', 'help', 'client', 'clients', 'customer', 'customers', 'business', 'creator', 'creators', 'video', 'videos', 'small', 'local', 'online', 'with', 'from', 'your', 'each', 'that', 'this', 'other', 'agent']);
/** A word as it is compared: "translation", "translator" and "translate" are one, "subtitles" and "subtitle" too. */
const stem = (word: string) => (word.length >= 7 ? word.slice(0, 6) : word.length > 4 && word.endsWith('s') ? word.slice(0, -1) : word);
const tokens = (text: string) => text.toLowerCase().split(/[^\p{L}]+/u).filter(word => word.length >= 4 && !GENERIC.has(word));

/**
 * Whether a job or a duty is the order work itself: it makes or checks (MAKES) the thing that is sold, named by a word
 * of an offer's name or of an order-doing agent's name, and is not sales or admin work (SALES: a quote for it, a
 * description of it, its orders tracked). Conservative on purpose: a line code cannot tell stays with the team.
 */
export function orderWorkIn(line: string, words: { offers: readonly string[]; roles: readonly string[] }): boolean {
  const said = line.replace(/\s+/g, ' ').trim();
  const act = said.toLowerCase().split(/[^\p{L}]+/u).find(Boolean);
  if (!act || !MAKES.has(act) || SALES.test(said)) return false;
  const things = new Set([...words.offers, ...words.roles].flatMap(tokens).map(stem));
  return tokens(said).map(stem).some(word => things.has(word));
}


/**
 * Whether an agent's words are the work an order agent already does: two or more of that agent's own words (stemmed,
 * the words every business shares left out) are in them. "Keeps order enquiries organised", "Lists missing order
 * details" is the Reader that "Reads enquiries and lists what is missing".
 */
export function sameWorkAs(lines: readonly string[], does: string): boolean {
  const said = new Set(lines.flatMap(tokens).map(stem));
  return new Set(tokens(does).map(stem).filter(word => said.has(word))).size >= 2;
}
