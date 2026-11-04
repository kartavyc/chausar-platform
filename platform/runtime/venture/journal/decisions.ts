// Chausar venture launcher, journal (Ink v2 wave 4, package 4J1; catalogue O17): the decision record. Every decision
// says who made it (the owner or a cofounder, a saved rule, or a timeout), when, on what rule and why, wherever it was
// made. venture.decisions.list reads it from the records that hold it:
// - the owner's decisions on Today (venture-queue-decision, written once per row by views/queue.ts);
// - decisions engine code records itself (venture-decision): a review from Work or the run sheet (delivery/runs.ts), a
//   plan accepted in the business menu (core/blueprint.ts), "allow for this session", a timed question that ran out
//   (4J13), "I sent it" (4E);
// - the gates the owner set on Team (venture-team-gate);
// - each outside effect the owner approved or refused, or that nobody decided in time (the journal's own steps, posts
//   included), such as a send to the owner's AI approved from the run sheet or an invoice issued from Money;
// - the tool calls a saved rule let run without asking (ToolCallRecord.allowedBy, stamped by the harness as the call is
//   made), one entry per run and step.
// A decision made on Today also leaves the record of what it ran (the review, the journal step): matched to that exact
// row, it is listed once, as the Today decision; nothing is matched by time. The journal shows each step a saved rule allowed, with the agent and step venture.team.gate
// { gate: 'hold' } takes to stop always allowing it. Nothing here is a model's.
import { authorize, type Context, type State } from '../../contracts.ts';
import { currentVenture, exactPayload, findRecord, listRecords, type VentureTx } from '../records.ts';
import type {
  ConnectorPostRecord, DecisionRecord, DecisionsView, DecisionView, Display, IsoTime, JournalEntry, JournalRecord, QueueActionId, ToolCallRecord,
  VentureDeps, VentureRecord,
} from '../contracts.ts';
import { playbookInUse, teamFlagship } from '../views/team-shape.ts';
import { AGENT_ID } from '../views/shared.ts';

/** The newest decisions venture.decisions.list returns. */
export const DECISIONS_MAX = 500;

/**
 * What one decision recorded outside Today says. ruleId: the saved rule's record, when a rule decided. who: only for a
 * decision no member made (a timeout, a saved rule, or Chausar's own note, such as a gallery business reusing another's
 * AI); a member's decision is the member's own (recordDecision).
 */
export type DecisionInput = Pick<DecisionRecord, 'subject' | 'action' | 'ruleId' | 'reason' | 'rowId'> & { who?: DecisionRecord['who'] };

/** A member's decision by their role: a cofounder's, an accountant's, else the owner's. */
type MemberWho = 'owner' | 'cofounder' | 'accountant';
const memberWho = (role: string | undefined): MemberWho => (role === 'cofounder' ? 'cofounder' : role === 'accountant' ? 'accountant' : 'owner');
/** One-shot A4 (A3 leftover): who a member is, by their record in the vault. */
const whoIs = (state: State, memberId: string | null | undefined) => memberWho(state.members.find(member => member.id === memberId)?.role);

/** Records one decision inside the caller's transaction, as the member the transaction runs for. Writes only; callers emit. */
export function recordDecision(tx: VentureTx, input: DecisionInput): DecisionRecord {
  // One-shot A3 (after review): with the role of the member it runs for, so a cofounder's decision is never the owner's.
  // One-shot A4: who, too, comes from that role for every member's decision; only a timeout, a saved rule or Chausar's
  // own note names itself.
  const who = input.who === 'timeout' || input.who === 'saved-rule' || input.who === 'chausar' ? input.who : memberWho(tx.ctx.role);
  return tx.put<DecisionRecord>({ ...tx.base('venture-decision'), role: tx.ctx.role, ...input, who });
}

/** Each Today action in a few words, for the record's line. */
const ACTION_WORDS: Readonly<Record<QueueActionId, string>> = Object.freeze({
  approve: 'Approve', deny: 'No', later: 'Later', watch: 'Watch', read: 'Read', answer: 'Answer', 'send-to-ca': 'Send to CA', open: 'Open',
  connect: 'Connect', 'set-prices': 'Set prices', keep: 'Keep', issue: 'Issue', 'run-again': 'Run again', sent: 'I sent it',
  continue: 'Continue', stop: 'Stop', resume: 'Resume',
});

/**
 * A4 review (L5): the member a line names, as the reader sees it: the reader's own decision is You's; another member's is
 * named by their role.
 */
const WHO_WORDS: Readonly<Record<MemberWho, string>> = Object.freeze({ owner: 'The owner', cofounder: 'Your cofounder', accountant: 'Your accountant' });
const subjectOf = (state: State, memberId: string | null | undefined, reader: string | null): string => (reader !== null && memberId === reader ? 'You' : WHO_WORDS[whoIs(state, memberId)]);

export const DECISION_WORDS = Object.freeze({
  today: (action: string, reason: string, who = 'You') => `${who} chose ${action} on Today: ${reason}`,
  /** One-shot A4 (rows 33, 46): the plan's row is decided on Today, in Prices or on the plan page, so it names no place. */
  plan: (action: string, reason: string, who = 'You') => `${who} chose ${action}: ${reason}`,
  owner: (reason: string) => `You decided: ${reason}`,
  cofounder: (reason: string) => `Your cofounder decided: ${reason}`,
  decided: (who: string, reason: string) => `${who} decided: ${reason}`,
  timeout: (reason: string) => `No answer in time: ${reason}`,
  approved: (what: string, who = 'You') => `${who} approved it: ${what}`,
  refused: (what: string, who = 'You') => `${who} said no: ${what}`,
  gate: (step: string, gate: 'auto' | 'hold', who = 'You') => (gate === 'auto' ? `${who} set '${step}' to run on its own.` : `${who} set '${step}' to wait for you.`),
  autoRule: (step: string) => `Your Auto setting on '${step}'`,
  sessionRule: (step: string) => `Your allow for this session on '${step}'`,
  someRule: 'A saved rule',
  autoLine: (step: string) => `Allowed by your Auto setting on '${step}', without asking`,
  sessionLine: (step: string) => `Allowed for this session on '${step}', without asking`,
  calls: (count: number) => `${count} calls`,
  ran: (tool: string) => `The agent ran ${tool} without asking.`,
  ranMany: (count: number, tools: string) => `The agent made ${count} calls without asking: ${tools}.`,
  journalAction: 'Ran without asking',
});

/** A journal step the sweep wrote because nobody decided in time (journal/journal.ts). */
const NOBODY_DECIDED = /^Nobody decided in time/;

/** The step titles of the playbook a run used, else the playbook in use. */
function stepTitle(state: State, venture: VentureRecord, stepId: string, playbookId?: string): string {
  const steps = ((playbookId ? findRecord(state, 'venture-playbook', playbookId) : undefined) ?? playbookInUse(state, venture))?.steps ?? [];
  return steps.find(step => step.id === stepId)?.title ?? stepId;
}

// ---------------------------------------------------------------------------
// Steps a saved rule let run without asking, one group per run and step
// ---------------------------------------------------------------------------

type Allowed = {
  runId: string; stepId: string; rule: 'auto' | 'session'; calls: ToolCallRecord[]; firstAt: IsoTime; at: IsoTime; title: string; agentId: string;
  ruleId: string | null;
};

/** The saved rule in force for a step when a call ran: the newest Auto setting, or the newest allow for this session. */
function ruleAt(state: State, venture: VentureRecord, rule: 'auto' | 'session', stepId: string, at: IsoTime): string | null {
  if (rule === 'auto') {
    const gates = listRecords(state, 'venture-team-gate', venture.id).filter(gate => gate.agentId === AGENT_ID && gate.stepId === stepId && gate.at <= at);
    const newest = gates[gates.length - 1];
    return newest && newest.gate === 'auto' ? newest.id : null;
  }
  const grants = listRecords(state, 'venture-decision', venture.id).filter(item => item.action === 'allow-session' && item.subject === `step:${stepId}` && item.at <= at);
  return grants[grants.length - 1]?.id ?? null;
}

/** The calls of the business's delivery runs a saved rule let run without asking, grouped by run, step and rule. */
function allowedGroups(state: State, venture: VentureRecord): Allowed[] {
  const flagship = teamFlagship(state, venture);
  const groups: Allowed[] = [];
  for (const run of listRecords(state, 'venture-delivery-run', venture.id)) {
    const byStep = new Map<string, Allowed>();
    for (const call of run.harness?.toolCalls ?? []) {
      const allowedBy = call.allowedBy;
      if (!allowedBy || !allowedBy.stepId) continue;
      const at = call.startedAt ?? run.at;
      const key = `${allowedBy.stepId} ${allowedBy.rule}`;
      const known = byStep.get(key);
      if (known) {
        known.calls.push(call);
        if (at > known.at) known.at = at;
        continue;
      }
      const group: Allowed = {
        runId: run.id, stepId: allowedBy.stepId, rule: allowedBy.rule, calls: [call], firstAt: at, at,
        title: stepTitle(state, venture, allowedBy.stepId, run.playbookId), agentId: flagship?.roleOf[allowedBy.stepId] ?? AGENT_ID,
        ruleId: ruleAt(state, venture, allowedBy.rule, allowedBy.stepId, at),
      };
      byStep.set(key, group);
      groups.push(group);
    }
  }
  return groups;
}

const groupId = (group: Allowed) => `${group.runId}/${group.stepId}${group.rule === 'session' ? ':session' : ''}`;
const ruleLine = (group: Allowed): Display => (group.rule === 'auto' ? DECISION_WORDS.autoLine(group.title) : DECISION_WORDS.sessionLine(group.title));

/**
 * The journal's entries for the steps a saved rule let run without asking: one per run and step (however many calls it
 * made), with the rule and how to stop always allowing it, so they never crowd out the owner's outside effects.
 */
export function allowedByEntries(state: State, venture: VentureRecord): JournalEntry[] {
  return allowedGroups(state, venture).map(group => ({
    id: groupId(group), action: DECISION_WORDS.journalAction, target: group.title, state: 'applied', at: group.at,
    line: group.calls.length > 1 ? `${ruleLine(group)} · ${DECISION_WORDS.calls(group.calls.length)}` : ruleLine(group),
    allowedBy: { rule: group.rule, agentId: group.agentId, stepId: group.stepId, ruleId: group.ruleId },
  }));
}

// ---------------------------------------------------------------------------
// The record
// ---------------------------------------------------------------------------

/** The review verdicts delivery/runs.ts records. */
const REVIEW_ACTIONS = new Set(['accepted', 'edited', 'rejected']);
/** A call id as a Today row's version spells it (views/queue.ts part). */
const asVersion = (value: string) => value.replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 80);
const versionOfRow = (rowId: string) => rowId.slice(rowId.lastIndexOf(':') + 1);

/**
 * The records each Today click left of what it ran, matched to that exact row, never by time: a send row's version names
 * its call (the journal entry of that call), a review row the review of its run recorded with the click, a plan row its
 * plan version (the decision recorded with that row id), an invoice, post or bank alert row its own record. Ids of
 * venture-decision records and of journal steps ('<record id>/<step index>').
 */
function ranByClicks(state: State, venture: VentureRecord): Set<string> {
  const ran = new Set<string>();
  const decisions = listRecords(state, 'venture-decision', venture.id);
  const entries = listRecords(state, 'venture-journal-entry', venture.id).filter(record => !record.shadow);
  const posts = listRecords(state, 'venture-connector-post', venture.id);
  const stepsOf = (record: JournalRecord | ConnectorPostRecord, by: string) => record.journal.forEach((step, index) => {
    if ((step.state === 'approved' || step.state === 'rejected') && step.by === by) ran.add(`${record.id}/${index}`);
  });
  for (const click of listRecords(state, 'venture-queue-decision', venture.id)) {
    const version = versionOfRow(click.rowId);
    const id = click.subject.slice(click.subject.indexOf(':') + 1);
    if (click.subject.startsWith('run:') && version.startsWith('send-')) {
      for (const entry of entries) {
        if (entry.action !== 'delivery.send') continue;
        const [runId, ...rest] = entry.subject.split(':');
        if (runId === id && rest.length === 1 && asVersion(rest[0]) === version.slice('send-'.length)) stepsOf(entry, click.decidedBy);
      }
    } else if (click.subject.startsWith('run:') && version.startsWith('review')) {
      // The review the click ran is recorded in its perform, just before the click: the run's newest review by that member.
      const review = decisions.filter(item => item.subject === click.subject && REVIEW_ACTIONS.has(item.action) && item.memberId === click.decidedBy && item.at <= click.at).at(-1);
      if (review) ran.add(review.id);
    } else if (click.subject.startsWith('plan:')) {
      for (const item of decisions) if (item.rowId === click.rowId) ran.add(item.id);
    } else if (click.subject.startsWith('invoice:')) {
      for (const entry of entries) if (entry.action === 'invoice.issue' && entry.subject === id) stepsOf(entry, click.decidedBy);
    } else if (click.subject.startsWith('post:')) {
      for (const post of posts) if (post.id === id) stepsOf(post, click.decidedBy);
    } else if (click.subject.startsWith('bank-alert:')) {
      for (const entry of entries) if (entry.action === 'bank.alert' && entry.subject === click.subject) stepsOf(entry, click.decidedBy);
    }
  }
  return ran;
}

/** The words for a rule a decision names: a team gate's Auto setting, an allow for this session, else a saved rule. */
function ruleWords(state: State, venture: VentureRecord, ruleId: string | null): Display | null {
  if (!ruleId) return null;
  const gate = findRecord(state, 'venture-team-gate', ruleId);
  if (gate && gate.ventureId === venture.id) return DECISION_WORDS.autoRule(stepTitle(state, venture, gate.stepId));
  const grant = findRecord(state, 'venture-decision', ruleId);
  if (grant && grant.ventureId === venture.id && grant.action === 'allow-session') return DECISION_WORDS.sessionRule(stepTitle(state, venture, grant.subject.replace(/^step:/, '')));
  return DECISION_WORDS.someRule;
}

/** The agent whose step a rule is about: a team gate's agent, else none (an allow for this session names only a step). */
function agentOfRule(state: State, venture: VentureRecord, ruleId: string | null): string | null {
  if (!ruleId) return null;
  const gate = findRecord(state, 'venture-team-gate', ruleId);
  return gate && gate.ventureId === venture.id ? gate.agentId : null;
}

/** The Today row subject a journalled effect stands for, when Today shows it: a send to the AI, an invoice, a bank alert. */
function todaySubjectOfEntry(entry: JournalRecord): string | null {
  if (entry.action === 'delivery.send') return `run:${entry.subject.split(':')[0]}`;
  if (entry.action === 'invoice.issue') return `invoice:${entry.subject}`;
  if (entry.action === 'bank.alert') return entry.subject;
  return null;
}

/** The owner's and the sweep's decisions on outside effects: each approved or refused journal step, posts included. */
function journalDecisions(state: State, venture: VentureRecord, reader: string | null): DecisionView[] {
  const members = new Set(state.members.map(member => member.id));
  const records: { record: JournalRecord | ConnectorPostRecord; today: string | null }[] = [
    ...listRecords(state, 'venture-journal-entry', venture.id).filter(record => !record.shadow).map(record => ({ record, today: todaySubjectOfEntry(record) })),
    ...listRecords(state, 'venture-connector-post', venture.id).map(record => ({ record, today: `post:${record.id}` })),
  ];
  const listed: DecisionView[] = [];
  for (const { record, today } of records) {
    record.journal.forEach((step, index) => {
      if (step.state !== 'approved' && step.state !== 'rejected') return;
      const base = { id: `${record.id}/${index}`, at: step.at, subject: today ?? `journal:${record.id}`, rule: null, ruleId: null, reason: step.line, agentId: null, mine: reader !== null && step.by === reader };
      if (members.has(step.by)) {
        const approved = step.state === 'approved';
        const who = whoIs(state, step.by), subject = subjectOf(state, step.by, reader);
        listed.push({
          ...base, action: approved ? 'approve' : 'reject', who, line: approved ? DECISION_WORDS.approved(record.describe, subject) : DECISION_WORDS.refused(record.describe, subject), by: step.by,
        });
      } else if (step.state === 'rejected' && NOBODY_DECIDED.test(step.line)) {
        listed.push({ ...base, action: 'reject', who: 'timeout', line: DECISION_WORDS.timeout(record.describe), by: null, mine: false });
      }
    });
  }
  return listed;
}

/** Every decision of the open business, newest first, a Today click listed once. */
export function decisionViews(state: State, venture: VentureRecord, reader: string | null = null): DecisionView[] {
  const today = listRecords(state, 'venture-queue-decision', venture.id).map((record): DecisionView => {
    const who = whoIs(state, record.decidedBy);
    const words = record.subject.startsWith('plan:') ? DECISION_WORDS.plan : DECISION_WORDS.today;
    return {
      id: record.id, at: record.at, subject: record.subject, action: record.action, who, rule: null, ruleId: null, reason: record.line,
      line: words(ACTION_WORDS[record.action] ?? record.action, record.line, subjectOf(state, record.decidedBy, reader)), by: record.decidedBy, agentId: null,
      mine: reader !== null && record.decidedBy === reader,
    };
  });
  const others: DecisionView[] = [];
  for (const record of listRecords(state, 'venture-decision', venture.id)) {
    const member = record.who !== 'timeout' && record.who !== 'saved-rule' && record.who !== 'chausar';
    const line = member ? DECISION_WORDS.decided(subjectOf(state, record.memberId, reader), record.reason) : record.who === 'timeout' ? DECISION_WORDS.timeout(record.reason) : record.reason;
    others.push({
      id: record.id, at: record.at, subject: record.subject, action: record.action, who: record.who, rule: ruleWords(state, venture, record.ruleId), ruleId: record.ruleId,
      reason: record.reason, line, by: member ? record.memberId : null, agentId: agentOfRule(state, venture, record.ruleId), mine: member && reader !== null && record.memberId === reader,
    });
  }
  for (const gate of listRecords(state, 'venture-team-gate', venture.id)) {
    const who = whoIs(state, gate.memberId);
    const words = DECISION_WORDS.gate(stepTitle(state, venture, gate.stepId), gate.gate, subjectOf(state, gate.memberId, reader));
    others.push({ id: gate.id, at: gate.at, subject: `step:${gate.stepId}`, action: `gate-${gate.gate}`, who, rule: null, ruleId: null, reason: words, line: words, by: gate.memberId, agentId: gate.agentId, mine: reader !== null && gate.memberId === reader });
  }
  others.push(...journalDecisions(state, venture, reader));
  for (const group of allowedGroups(state, venture)) {
    const tools = [...new Set(group.calls.map(call => call.tool))].join(', ');
    others.push({
      id: groupId(group), at: group.at, subject: `step:${group.stepId}`, action: tools, who: 'saved-rule',
      rule: group.rule === 'auto' ? DECISION_WORDS.autoRule(group.title) : DECISION_WORDS.sessionRule(group.title), ruleId: group.ruleId,
      reason: group.calls.length === 1 ? DECISION_WORDS.ran(tools) : DECISION_WORDS.ranMany(group.calls.length, tools), line: ruleLine(group), by: null,
      agentId: group.agentId, mine: false,
    });
  }
  // The record of what a Today click ran is that click, matched to its exact row (ranByClicks).
  const ran = ranByClicks(state, venture);
  const views = [...today, ...others.filter(item => !ran.has(item.id))];
  return views.map((view, index) => ({ view, index }))
    .sort((a, b) => (a.view.at < b.view.at ? 1 : a.view.at > b.view.at ? -1 : b.index - a.index))
    .map(({ view }) => view)
    .slice(0, DECISIONS_MAX);
}

/** venture.decisions.list {} (read): who decided what, when, on what rule and why, newest first. */
export async function decisionsListHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<DecisionsView> {
  exactPayload(payload ?? {}, []);
  authorize(deps.store, ctx);
  const state = deps.store.read();
  const venture = currentVenture(state);
  // A4 review (L5): the lines as this reader sees them.
  return { decisions: venture ? decisionViews(state, venture, ctx.memberId) : [] };
}
