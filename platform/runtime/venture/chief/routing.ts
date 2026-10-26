// Chausar venture launcher, chief (Ink v2 wave 4, package 4C1, catalogue A15): one message wakes at most one agent, by
// code, never by a model's guess. Every agent the words name is counted, by plain name or @name: more than one, and
// the chief asks which agent; exactly one, and an @name anywhere or the name at the start sends the words to that
// agent's chat; a name only in the middle of a question leaves it with the chief. An agent is named by its name
// ("Story editor"), the last word of its name when no other agent's name ends the same way ("Editor"), the same in
// Devanagari ("एडिटर"), or its id after an @ ("@story-editor"). Hindi is compared without the nukta. Reads only.
import type { State } from '../../contracts.ts';
import type { VentureRecord } from '../contracts.ts';
import { acceptedBlueprintOrNull } from '../delivery/shared.ts';
import { currentPlaybook, deliveryFlagship } from '../delivery/playbook.ts';
import { flagshipDelivery } from '../playbooks/steps.ts';
import { chatAgent, type ChatAgent } from '../agents/roles.ts';
import { AGENT_ID } from '../views/shared.ts';

export type TeamAgent = { id: string; name: string; job: string };
export type Routing =
  | { kind: 'agent'; agent: TeamAgent; words: string }
  | { kind: 'ask'; question: string }
  | null;

/**
 * The words of the agents' names in Devanagari, as an owner writing Hindi spells them: the flagship roles (YouTube,
 * CA practice, social agency) and the one delivery agent of the eight fixed steps. A fixed list, each with its English twin.
 */
const DEVANAGARI: Readonly<Record<string, readonly string[]>> = Object.freeze({
  intake: ['इनटेक', 'इंटेक'], clerk: ['क्लर्क'], producer: ['प्रोड्यूसर'], story: ['स्टोरी'], editor: ['एडिटर'], packager: ['पैकेजर'],
  tax: ['टैक्स'], preparer: ['प्रिपेयरर'], reconciler: ['रिकंसाइलर'], working: ['वर्किंग'], papers: ['पेपर्स'], writer: ['राइटर'],
  auditor: ['ऑडिटर'], strategist: ['स्ट्रैटेजिस्ट', 'स्ट्रेटेजिस्ट'], creative: ['क्रिएटिव'], checker: ['चेकर'], analyst: ['एनालिस्ट'],
  agent: ['एजेंट'], marketing: ['मार्केटिंग'], studio: ['स्टूडियो'], consulting: ['कंसल्टिंग'], bookkeeping: ['बुककीपिंग'],
  research: ['रिसर्च'], content: ['कंटेंट'], support: ['सपोर्ट'], delivery: ['डिलीवरी'],
});

const brief = (agent: ChatAgent): TeamAgent => ({ id: agent.id, name: agent.name, job: agent.job });

/** The agents the owner can chat with, in team order: the playbook's agents, or the one delivery agent of the eight fixed steps. */
export function teamAgents(state: State, venture: VentureRecord): TeamAgent[] {
  const plan = acceptedBlueprintOrNull(state, venture);
  const flagship = flagshipDelivery(currentPlaybook(state, venture)?.flagship ?? (plan ? deliveryFlagship(venture, plan) : null));
  const ids = flagship ? flagship.roles.filter(role => role.kind === 'agent').map(role => role.id) : [AGENT_ID];
  const agents: TeamAgent[] = [];
  for (const id of ids) {
    try { agents.push(brief(chatAgent(state, venture, id))); } catch { /* not on this team now */ }
  }
  return agents;
}

/** A name as a pattern: escaped, any case, and a Devanagari letter matching with or without its nukta. */
const pattern = (alias: string) => alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/([\u0900-\u0963])/gu, '$1\u093C?');
const BEFORE = String.raw`(?<![\p{L}\p{M}\p{Nd}@_-])`;
const AFTER = String.raw`(?![\p{L}\p{M}\p{Nd}_-])`;

type Alias = { agent: TeamAgent; alias: string; atOnly: boolean };

/** Every way the owner may name each agent, longest first. */
function aliases(agents: readonly TeamAgent[]): Alias[] {
  const words = (name: string) => name.trim().toLowerCase().split(/\s+/);
  const found: Alias[] = [];
  for (const agent of agents) {
    const parts = words(agent.name);
    const last = parts.at(-1) ?? '';
    const own = new Set([agent.name.toLowerCase()]);
    const lastUnique = last.length >= 4 && agents.filter(other => words(other.name).at(-1) === last).length === 1;
    if (lastUnique) own.add(last);
    if (parts.every(part => DEVANAGARI[part])) own.add(parts.map(part => DEVANAGARI[part][0]).join(' '));
    if (lastUnique) for (const spelling of DEVANAGARI[last] ?? []) own.add(spelling);
    for (const alias of own) found.push({ agent, alias, atOnly: false });
    found.push({ agent, alias: agent.id.toLowerCase(), atOnly: true });
  }
  return found.sort((a, b) => b.alias.length - a.alias.length);
}

/** Agents in team order, each once. */
function distinct(agents: readonly TeamAgent[], named: readonly TeamAgent[]): TeamAgent[] {
  return agents.filter(agent => named.some(item => item.id === agent.id));
}

/** The chief's question back when the words name more than one agent. */
export function whichAgent(named: readonly TeamAgent[]): string {
  const names = named.map(agent => agent.name);
  return `Which agent: ${names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names.at(-1)}` : names[0]}?`;
}

/**
 * Where the owner's words go: to one agent (with the words it gets, its name taken off the front, or the @ off an
 * @name), a question back when they name more than one agent, or null when the chief answers itself.
 */
export function routeOf(state: State, venture: VentureRecord, text: string): Routing {
  const agents = teamAgents(state, venture);
  if (!agents.length) return null;
  const all = aliases(agents);
  const trimmed = text.trim();
  const names = (item: Alias) => new RegExp(`${BEFORE}${item.atOnly ? '@' : '@?'}${pattern(item.alias)}${AFTER}`, 'iu').test(trimmed);
  const named = distinct(agents, all.filter(names).map(item => item.agent));
  if (named.length > 1) return { kind: 'ask', question: whichAgent(named) };
  if (named.length === 0) return null;

  const agent = named[0];
  const own = all.filter(item => item.agent.id === agent.id);
  for (const item of own) {
    const lead = new RegExp(`^${item.atOnly ? '@' : '@?'}${pattern(item.alias)}${AFTER}[\\s,:;.-]*`, 'iu').exec(trimmed);
    if (!lead) continue;
    const words = trimmed.slice(lead[0].length).trim();
    return words ? { kind: 'agent', agent, words } : null;
  }
  const at = own.map(item => new RegExp(`${BEFORE}@(?=${pattern(item.alias)}${AFTER})`, 'iu')).find(found => found.test(trimmed));
  return at ? { kind: 'agent', agent, words: trimmed.replace(at, '').trim() } : null;
}

/** An agent's name for a routed message, or its id when it has left the team. */
export function agentNameOf(state: State, venture: VentureRecord, id: string): string {
  try { return chatAgent(state, venture, id).name; } catch { return id; }
}
