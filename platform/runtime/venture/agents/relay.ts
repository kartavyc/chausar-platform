// Chausar venture launcher, agents (Ink v2 wave 4, package 4J12, catalogue H25): the rules for agents messaging each
// other inside one team. Work goes down (an order, to one's own helper) and reports go one step up (to the parent, or
// to the owner from the top) as done, blocked, failed or needs_decision; only failed and needs_decision, to the owner,
// reach Today. A message goes only to a parent, a sibling or a child, and is marked delivered (the receiver is working
// and reads it at its next turn) or queued (it is idle). A handover passes work to a sibling with a brief and is never
// handed back. Code adds a return cap and a spend line to every helper brief. Cascade caps (depth 4, 12 messages per
// root task, 3 mentions) refuse with one fixed sentence. Every message is untrusted content for its receiver: it passes
// the untrusted screen in enforce mode, with a rule for words that try to grant tools or approvals, and a message has
// no field that could carry a grant: the receiver's tools and gates stay its own step's. No shipped team has a helper
// in W4 (FlagshipRole.parent is unset everywhere), so nothing here runs on a real order yet.
// The rules follow Beeline's commander and system events, prime-agent's agent-message skill, Xiryn's squad block and
// agent-harness's brief guard (2026-10-23 harvest, cards2/harness-a.md and harness-b.md); this is a rewrite.
import { ChausarError, check, type Context, type State } from '../../contracts.ts';
import { exactPayload, findRecord, formatMicros, identifier, listRecords, plainText, type VentureTx } from '../records.ts';
import type { AgentRelayRecord, ChatPart, RelayKind, RelayReport, VentureDeps, VentureRecord } from '../contracts.ts';
import { HELPER_RETURN_CAP, helperBrief } from './helper-brief.ts';
import { ERASED_NAMED } from './notes.ts';
import { runStepsIn, draftStepIn, type TeamLedger } from '../money/department-spend.ts';
import { roleOfTurn } from '../playbooks/departments.ts';
import type { FlagshipDelivery } from '../playbooks/steps.ts';
import { HELD_WORDS, screenNote, screenUntrusted, type ScreenFinding } from '../policy/untrusted.ts';
import { teamFlagship } from '../views/team-shape.ts';
import { AGENT_ID, agentName, short } from '../views/shared.ts';
import type { W4RowItem } from '../views/queue-w4.ts';
import { appendAgentMessage } from './store.ts';

/** The owner, above the team's top: where a top-level agent's report goes. */
export const OWNER = 'owner';
export const RELAY_CAPS = Object.freeze({ depth: 4, turnsPerRoot: 12, mentions: 3 });
/** The one sentence an agent reads when a message would pass a cascade cap. */
export const RELAY_CAPPED_LINE = 'This would pass the work along too many times. Chausar stopped it here.';
export const RELAY_REPORTS: readonly RelayReport[] = ['done', 'blocked', 'failed', 'needs_decision'];
/** The reports to the owner that become a Today row. done and blocked stay in the agent's chat. */
export const TODAY_REPORTS: readonly RelayReport[] = ['failed', 'needs_decision'];
export { HELPER_RETURN_CAP, helperBrief };

const RELAY_KINDS: readonly RelayKind[] = ['order', 'report', 'handover', 'message'];
const ONLY_KIN = 'An agent messages only its parent, its siblings and its own helpers.';
const NEVER_BACK = 'This work was handed over to you, and work is never handed back. Report up instead.';
const HANDED_ON = 'That agent already handed this work over, so it does not take it back. Hand it to someone else or report up.';

export type RelayMember = { id: string; name: string; parentId: string | null };
/** A team as relays see it: who reports to whom, and who is working now. */
export type RelayTeam = { members: readonly RelayMember[]; working: ReadonlySet<string> };
/**
 * One message an agent sends. from: set by code from the turn's role, never from the words. causeId: the message this
 * one answers or passes on: one sent to this sender, in the same root task. brief: what an order or handover asks;
 * spend: what the root task has spent and its cap, for the spend line code adds to the brief. report: the outcome of a
 * report. The root task is not here: code passes the run's id to relaySend.
 */
export type RelaySendInput = {
  kind: RelayKind;
  from: string;
  to: string;
  causeId?: string | null;
  text: string;
  brief?: string;
  spend?: { spentMicros: string; capMicros: string };
  report?: RelayReport;
};
/** The receipt the sender reads back. */
export type RelayReceipt = { id: string; status: AgentRelayRecord['status']; depth: number };
const INPUT_FIELDS = ['kind', 'from', 'to', 'causeId', 'text', 'brief', 'spend', 'report'] as const;

// ---------------------------------------------------------------------------
// The team's shape
// ---------------------------------------------------------------------------

/** The role a helper reports to in a flagship playbook's team (FlagshipRole.parent), or null. Team's parentId. */
export function parentOf(flagship: Pick<FlagshipDelivery, 'roles'> | null, roleId: string): string | null {
  return flagship?.roles.find(role => role.id === roleId)?.parent ?? null;
}

/**
 * The relay team of a flagship playbook's roles, or of the one delivery agent. Refuses a parent that is not on the
 * team, a loop of parents, and a tree deeper than the depth cap (AGENT_RELAY_REFUSED).
 */
export function relayTeamOf(flagship: Pick<FlagshipDelivery, 'roles'> | null, working: ReadonlySet<string> = new Set()): RelayTeam {
  const members: RelayMember[] = flagship ? flagship.roles.map(role => ({ id: role.id, name: role.name, parentId: role.parent ?? null })) : [{ id: AGENT_ID, name: 'Delivery', parentId: null }];
  const byId = new Map(members.map(member => [member.id, member]));
  for (const member of members) {
    let at: RelayMember | undefined = member;
    for (let level = 1; at?.parentId; level += 1) {
      check(byId.has(at.parentId), 'AGENT_RELAY_REFUSED', `${member.name} reports to ${at.parentId}, who is not on this team.`);
      check(level <= RELAY_CAPS.depth && at.parentId !== member.id, 'AGENT_RELAY_REFUSED', `${member.name}'s line of parents goes round or is too deep.`);
      at = byId.get(at.parentId);
    }
  }
  return { members, working };
}

/**
 * Each member's spend rolled up: its own and all its helpers', down the tree, in BigInt. Team shows a parent's spend
 * with its helpers' in it (today one harness agent runs every role, so a role's spend is already the team's).
 */
export function rolledUpSpend(members: readonly RelayMember[], own: ReadonlyMap<string, bigint>): Map<string, bigint> {
  const out = new Map<string, bigint>();
  for (const member of members) out.set(member.id, own.get(member.id) ?? 0n);
  for (const member of members) {
    let parent = member.parentId;
    for (let level = 0; parent && level < members.length; level += 1) {
      out.set(parent, (out.get(parent) ?? 0n) + (own.get(member.id) ?? 0n));
      parent = members.find(item => item.id === parent)?.parentId ?? null;
    }
  }
  return out;
}

/**
 * Each role's own spend from the records: the paid model calls of the harness turns that role made (the rule the
 * department split uses, playbooks/departments.ts roleOfTurn). Calls no single role can claim count for nobody here.
 */
export function roleSpend(ledger: TeamLedger): Map<string, bigint> {
  const out = new Map<string, bigint>();
  const flagship = ledger.flagship;
  if (!flagship) return out;
  const cost = new Map<string, bigint>();
  for (const record of ledger.state.conversations as { kind?: unknown; id?: unknown; costMicros?: unknown }[]) {
    if (record?.kind === 'venture-model-call' && typeof record.id === 'string' && typeof record.costMicros === 'string' && /^\d{1,30}$/.test(record.costMicros)) cost.set(record.id, BigInt(record.costMicros));
  }
  const add = (role: string | null | undefined, callId: string) => { if (role) out.set(role, (out.get(role) ?? 0n) + cost.get(callId)!); };
  for (const run of listRecords(ledger.state, 'venture-delivery-run', ledger.venture.id)) {
    const turns = new Set<string>();
    for (const turn of run.harness?.turns ?? []) {
      if (!turn.callId || !cost.has(turn.callId)) continue;
      turns.add(turn.callId);
      add(roleOfTurn(flagship, runStepsIn(ledger, run), turn, draftStepIn(ledger, run)), turn.callId);
    }
    // The run's own call, when it is not a turn's: a one-step draft, or a write turn, is the drafting role's (the rule
    // the department split uses); any other is the team's.
    if (run.callId && cost.has(run.callId) && !turns.has(run.callId) && (!run.harness || run.harness.phase === 'write')) {
      const step = draftStepIn(ledger, run);
      add(step ? flagship.roleOf[step] : null, run.callId);
    }
  }
  return out;
}

/**
 * Team's nesting (views/team.ts): over the members shown, each helper names its parent (parentId), and when the team
 * has a helper each member's spend is its own, a parent's rolled up with its helpers' (rolledUpSpend). own is asked
 * only then. A team with no helper, or one whose parents do not make a team (a parent not shown), is left as it is.
 * suffix: the estimate words when a call's price is not confirmed. Members off the playbook's roles (Keeper) stay put.
 */
export function nestTeam<T extends { id: string; spend: string }>(agents: readonly T[], flagship: Pick<FlagshipDelivery, 'roles'> | null, own: () => ReadonlyMap<string, bigint>, suffix: string): (T & { parentId?: string })[] {
  if (!flagship || !flagship.roles.some(role => role.parent)) return [...agents];
  let team: RelayTeam;
  try { team = relayTeamOf({ roles: flagship.roles.filter(role => agents.some(agent => agent.id === role.id)) }); } catch { return [...agents]; }
  if (!team.members.some(member => member.parentId)) return [...agents];
  const spent = own();
  const rolled = rolledUpSpend(team.members, spent);
  return agents.map(agent => {
    const member = team.members.find(item => item.id === agent.id);
    if (!member) return agent;
    const helps = team.members.some(item => item.parentId === member.id);
    const spend = `${formatMicros(String(helps ? rolled.get(member.id) ?? 0n : spent.get(member.id) ?? 0n))}${suffix}${helps ? ' with its helpers' : ''}`;
    return { ...agent, spend, ...(member.parentId ? { parentId: member.parentId } : {}) };
  });
}

type Kin = 'parent' | 'child' | 'sibling' | 'owner' | null;
/** How the receiver stands to the sender. The owner is above the team's top members. */
function kinOf(team: RelayTeam, from: RelayMember, to: string): Kin {
  if (to === OWNER) return from.parentId === null ? 'owner' : null;
  const other = team.members.find(member => member.id === to)!;
  if (other.id === from.id) return null;
  if (from.parentId === other.id) return 'parent';
  if (other.parentId === from.id) return 'child';
  return from.parentId !== null && other.parentId === from.parentId ? 'sibling' : from.parentId === null && other.parentId === null ? 'sibling' : null;
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

/** Words in a message that try to grant tools or approvals: held, because an agent never grants either. */
const GRANT_WORDS = /\b(?:you (?:now )?(?:may|can|are allowed to) (?:use|call|run)|i (?:grant|give) you|(?:the )?owner (?:has |already )*approved|(?:approval|permission) (?:is |was |has been )?(?:given|granted)|(?:skip|bypass) (?:the )?(?:approval|gate|check)|set (?:the )?gate to auto|auto[- ]approve|you (?:now )?have (?:the )?permission to|you(?:'re| are) (?:now )?(?:authori[sz]ed|cleared|allowed) to)\b/i;
/**
 * The same in Hindi, aimed at the receiver: "you" (तुम्हें, तुमको, आपको) and, within a few words, permission or the
 * right (अनुमति, इजाज़त, अधिकार). Words about an approval that grant the receiver nothing ("बिल मंज़ूर हो गया") pass.
 * Compared after NFC, so a nukta written either way matches.
 */
const GRANT_WORDS_HI = new RegExp('(?:तुम्हें|तुम्हे|तुमको|तुम को|आपको|आप को)(?:\\s+\\S+){0,4}?\\s*(?:अनुमति|इजाज़त|इजाजत|अधिकार)'.normalize('NFC'), 'u');
function grantClaims(text: string): ScreenFinding[] {
  return GRANT_WORDS.test(text) || GRANT_WORDS_HI.test(text.normalize('NFC')) ? [{ kind: 'injection', what: 'Words that try to grant tools or approvals. An agent never grants either.' }] : [];
}

/** Screens one agent's words for another, in enforce mode: what the receiver may read, and the note. */
function screened(text: string): { text: string; note: AgentRelayRecord['screen'] } {
  const result = screenUntrusted({ source: 'tool-output', text }, { mode: 'enforce', checks: [grantClaims] });
  return { text: result.text ?? HELD_WORDS, note: screenNote(result) };
}

/** The members a message names with an @ (by id or name), counted once each. */
function mentions(team: RelayTeam, text: string): number {
  const lower = text.toLowerCase();
  return team.members.filter(member => [member.id, member.name].some(name => new RegExp(`@${name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z0-9-])`).test(lower))).length;
}


function readSpend(value: unknown): { spentMicros: string; capMicros: string } {
  const spend = exactPayload(value, ['spentMicros', 'capMicros'], ['spentMicros', 'capMicros']);
  check(typeof spend.spentMicros === 'string' && /^\d{1,15}$/.test(spend.spentMicros) && typeof spend.capMicros === 'string' && /^\d{1,15}$/.test(spend.capMicros)
    && BigInt(spend.spentMicros) <= BigInt(spend.capMicros), 'INVALID_VENTURE_REQUEST', 'A helper brief needs what was spent and the cap, in micro units, spent no more than the cap.');
  return { spentMicros: spend.spentMicros, capMicros: spend.capMicros };
}

/** A model-written line for the owner's chat: a number in it is shown as a model estimate. */
const ownerParts = (text: string): ChatPart[] => (/\d/.test(text) ? [{ kind: 'estimate', text }] : [{ kind: 'text', text }]);

/**
 * Sends one message inside the caller's transaction and returns its receipt. Refuses fields a message does not have
 * (no tools, approvals, gates or posture: INVALID_VENTURE_REQUEST), anyone off the team (AGENT_NOT_FOUND), the wrong
 * direction for its kind and anyone but a parent, sibling or child (AGENT_RELAY_REFUSED), a handover back to whoever
 * handed the work over (AGENT_RELAY_REFUSED), a message after the root task's first that names no cause, or a cause not
 * sent to this sender in this task (INVALID_VENTURE_REQUEST), and a message past a cascade cap (AGENT_RELAY_CAPPED, one fixed
 * sentence). The words pass the untrusted screen; held words are stored as the held line. A report to the owner is
 * also written into the sender's own chat, and a failed or needs_decision one shows on Today (relayNoticeRows).
 */
export function relaySend(tx: VentureTx, team: RelayTeam, rootId: string, input: RelaySendInput): RelayReceipt {
  const root = findRecord(tx.state, 'venture-delivery-run', rootId);
  check(root && root.ventureId === tx.venture!.id, 'RUN_NOT_FOUND', 'That run was not found.');
  const body = exactPayload(input, INPUT_FIELDS, ['kind', 'from', 'to', 'text']);
  check(RELAY_KINDS.includes(body.kind as RelayKind), 'INVALID_VENTURE_REQUEST', 'A message is an order, a report, a handover or a message.');
  const kind = body.kind as RelayKind;
  const fromId = identifier(body.from, 'From'), to = identifier(body.to, 'To');
  const from = team.members.find(member => member.id === fromId);
  check(from && (to === OWNER || team.members.some(member => member.id === to)), 'AGENT_NOT_FOUND', 'That agent is not on this team.');
  const text = plainText(body.text, 'The message', { min: 1, max: 4000 });
  // Direction by kind: orders down, reports one step up, handovers across, messages to kin only.
  const kin = kinOf(team, from, to);
  const allowed: Record<RelayKind, readonly Kin[]> = { order: ['child'], report: ['parent', 'owner'], handover: ['sibling'], message: ['parent', 'child', 'sibling'] };
  check(kin !== null && allowed[kind].includes(kin), 'AGENT_RELAY_REFUSED', kind === 'order' ? 'Work goes down: an agent gives orders only to its own helpers.'
    : kind === 'report' ? 'A report goes one step up: to the parent, or to the owner from the top of the team.' : kind === 'handover' ? 'A handover passes work to a sibling.' : ONLY_KIN);
  let report: RelayReport | null = null;
  if (kind === 'report') {
    check(RELAY_REPORTS.includes(body.report as RelayReport), 'INVALID_VENTURE_REQUEST', 'A report ends done, blocked, failed or needs_decision.');
    report = body.report as RelayReport;
  } else check(body.report === undefined, 'INVALID_VENTURE_REQUEST', 'Only a report has an outcome.');
  let brief: string | null = null;
  if (kind === 'order' || kind === 'handover') {
    brief = helperBrief(screened(plainText(body.brief, 'The brief', { min: 3, max: 2000 })).text, readSpend(body.spend));
  } else check(body.brief === undefined && body.spend === undefined, 'INVALID_VENTURE_REQUEST', 'Only an order or a handover carries a brief.');
  const sent = listRecords(tx.state, 'venture-agent-relay', tx.venture!.id).filter(record => record.rootId === rootId);
  if (kind === 'handover') {
    check(!sent.some(record => record.relayKind === 'handover' && record.from === to && record.to === from.id), 'AGENT_RELAY_REFUSED', NEVER_BACK);
    check(!sent.some(record => record.relayKind === 'handover' && record.from === to), 'AGENT_RELAY_REFUSED', HANDED_ON);
  }
  // Cascade caps.
  const causeId = body.causeId === undefined || body.causeId === null ? null : identifier(body.causeId, 'Cause');
  // After a root task's first message, each one names the message it answers, so depth is always counted.
  check(causeId || sent.length === 0, 'INVALID_VENTURE_REQUEST', "After a task's first message, each message names the message it answers.");
  const cause = causeId ? findRecord(tx.state, 'venture-agent-relay', causeId) : null;
  check(!causeId || (cause && cause.ventureId === tx.venture!.id && cause.rootId === rootId && cause.to === from.id), 'INVALID_VENTURE_REQUEST', 'That message is not one sent to you in this task.');
  const depth = (cause?.depth ?? 0) + 1;
  if (depth > RELAY_CAPS.depth || sent.length >= RELAY_CAPS.turnsPerRoot || mentions(team, text) > RELAY_CAPS.mentions) throw new ChausarError('AGENT_RELAY_CAPPED', RELAY_CAPPED_LINE);
  const words = screened(text);
  const status: AgentRelayRecord['status'] = to === OWNER || team.working.has(to) ? 'delivered' : 'queued';
  const record = tx.put<AgentRelayRecord>({
    ...tx.base('venture-agent-relay'), from: from.id, to, relayKind: kind, rootId, causeId, depth, text: words.text, brief, report, status, screen: words.note,
  });
  if (to === OWNER) {
    const said = appendAgentMessage(tx, { agent: from.id, from: 'agent', text: words.text, parts: ownerParts(words.text), author: 'model', runId: null });
    tx.emit('agent.message', { agent: from.id, messageId: said.id });
    if (report && TODAY_REPORTS.includes(report)) tx.emit('queue.changed', {});
  }
  return { id: record.id, status, depth };
}

/**
 * Forget of a person in the owner's network (network/forget.ts removePersonData, DPDP): every message between agents
 * whose words or brief name them becomes ERASED_NAMED, the way 4B2 erases agent messages; who sent it to whom, its
 * kind, outcome, depth and times stay. Today's line is read from the words, so it names them nowhere either.
 */
export function eraseRelaysNaming(tx: VentureTx, mentionsName: (text: unknown) => boolean): void {
  for (const record of tx.list('venture-agent-relay')) {
    const text = mentionsName(record.text), brief = record.brief !== null && mentionsName(record.brief);
    if (!text && !brief) continue;
    tx.replace<AgentRelayRecord>({ ...record, text: text ? ERASED_NAMED : record.text, brief: brief ? ERASED_NAMED : record.brief });
  }
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** One message as its receiver reads it: untrusted content, the screen's note, never a grant. */
export type RelayInboxItem = { id: string; from: string; kind: RelayKind; report: RelayReport | null; text: string; brief: string | null; untrusted: true; screen: AgentRelayRecord['screen'] };

/** The messages to one agent, oldest first, as untrusted content. */
export function relayInbox(state: State, venture: VentureRecord, agentId: string): RelayInboxItem[] {
  return listRecords(state, 'venture-agent-relay', venture.id).filter(record => record.to === agentId)
    .map(record => ({ id: record.id, from: record.from, kind: record.relayKind, report: record.report, text: record.text, brief: record.brief, untrusted: true, screen: record.screen }));
}

/** A team member's name for the owner: a flagship role's, the delivery agent's, else its id. */
function memberName(state: State, venture: VentureRecord, id: string): string {
  const role = teamFlagship(state, venture)?.roles.find(item => item.id === id);
  return role?.name ?? (id === AGENT_ID ? agentName(state, venture) : id);
}

/**
 * Today's notice rows (views/probes.ts): one per report to the owner that ended failed or needs_decision. Open goes to
 * the agent's chat, where the report is; Later is queue.ts's.
 */
export function relayNoticeRows(_deps: VentureDeps, _ctx: Context, state: State, venture: VentureRecord): W4RowItem[] {
  return listRecords(state, 'venture-agent-relay', venture.id).filter(record => record.to === OWNER && record.report !== null && TODAY_REPORTS.includes(record.report))
    .map(record => {
      const name = memberName(state, venture, record.from);
      return {
        kind: 'notice' as const, subject: `relay:${record.id}`, version: record.id, createdAt: record.at, agent: record.from,
        title: record.report === 'failed' ? `${name} could not finish a task` : `${name} needs your decision`,
        // The agent's own words; a number in them is the model's, so the line says so.
        line: /\d/.test(record.text) ? `${short(`${name} reported: ${record.text}`, 170)} (model estimate)` : short(`${name} reported: ${record.text}`, 200),
        actions: [{ id: 'later' as const, label: 'Later', primary: false }, { id: 'open' as const, label: 'Open the chat', primary: true }],
        navigate: `Open ${name}'s chat on Team to read the report.`,
      };
    });
}
