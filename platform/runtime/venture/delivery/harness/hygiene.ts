// Chausar delivery harness (Ink v2 wave 4, package 4J11, catalogue H29): context hygiene, what an act turn reads of the
// run so far. Three rules, all code and no model call:
// 1. Unconfirmed actions: everything journalled for this order that may still happen or may already have happened
//    (described, approved, outcome_unknown) rides in the history as a list, and Chausar's own fixed line in the
//    instructions (UNCONFIRMED_LINE) says never to propose them again and to ask the owner, naming the id. The list comes
//    only from journalled records: the order's posts (a post names its draft, a run of the order), invoices and credit
//    notes on the order, and journal entries named after one of its runs. Shadow entries never happened, phone alerts
//    (4G3) are owner notices that settle themselves, and a turn's own send to the owner's AI is how the turn reached the
//    agent, so none of those count. Target and line pass the untrusted screen before they go back into a prompt.
// 2. Older turns fold into a summary in fixed sections made from the run's own records (calls, audits, tables,
//    receipts, questions). Nothing tells the agent to call a tool again.
// 3. A result over PREVIEW_LIMIT_CHARS, or the largest ones while a turn's results pass BATCH_CHARS, shows a short
//    preview naming its call; the whole result stays on the stored call, as every result does.
// The pattern follows OpenGCUA's context_risk.py (unconfirmed actions), pi-plans' compaction.ts (fixed sections) and
// trueforge's LargeToolResponse.ts (large results), surveyed in the 2026-10-21 harvest; written here, not copied.
import type { State } from '../../../contracts.ts';
import { findRecord, listRecords } from '../../records.ts';
import type { ConnectorPostRecord, HarnessState, Json, JournalRecord, ToolCallRecord } from '../../contracts.ts';
import { redactSecrets } from '../../core/secrets.ts';
import { JOURNAL_ACTIONS } from '../../journal/journal.ts';
import { heldWords, screenUntrusted, type ScreenSetting, type UntrustedSource } from '../../policy/untrusted.ts';
import { screenSettingOf } from '../../policy/untrusted-methods.ts';

export const UNCONFIRMED_HEADING = 'Unconfirmed actions';
/** Chausar's own words about the list, in the instructions (and beside the list): what the agent can do about them. */
export const UNCONFIRMED_LINE = 'These may already have happened. Never propose them again; if one matters, ask the owner, naming its id.';
/** About 6,000 tokens: a single result longer than this shows as a preview. */
export const PREVIEW_LIMIT_CHARS = 24000;
/** About 10,000 tokens: one turn's results together; past this the largest show as previews. */
export const BATCH_CHARS = 40000;
/** What the history shows of a result too long to show whole. */
export const PREVIEW_CHARS = 600;
/** The summary's sections, always all of them and always in this order. */
export const HISTORY_SECTIONS = ['turnsTaken', 'earlierTurns', 'audited', 'notAudited', 'refused', 'made', 'questions'] as const;
export const HISTORY_SUMMARY_NOTE = "Chausar wrote this summary from the run's own records, in fixed sections. No AI wrote it.";
/** What an older result cut to a stub says. It never tells the agent to call the tool again. */
export const SHORTENED_NOTE = '(shortened by Chausar. Work from the summary and the newer results; never repeat an outside action.)';
/** What a previewed result says: only what is true. The stored call keeps every result whole. */
export const KEPT_NOTE = "This result was too long to show whole, so here is its start. The full result is kept with this call in the run's record. To see more, read a smaller part, such as a later page or fewer rows.";

/** The states of an action that may still happen or may already have happened. */
const OPEN_STATES: readonly string[] = ['described', 'approved', 'outcome_unknown'];
/**
 * Journal actions that are never the agent's to check: phone alerts (4G3, owner-only notices of a count that settle
 * themselves) and Chausar's own send of a turn to the owner's AI (the turn the agent is reading).
 */
const NOT_THE_AGENTS: ReadonlySet<string> = new Set(['notify.push', 'notify.relay', 'delivery.send']);

export type UnconfirmedAction = { id: string; action: string; target: string; state: 'described' | 'approved' | 'outcome_unknown'; line: string };

/** Words from a record, screened as outside content (an agent's post, a client's name) and through the secret screen. */
function screened(text: string, source: UntrustedSource, setting: ScreenSetting, max: number): string {
  const result = screenUntrusted({ source, text: text.slice(0, 4000) }, setting);
  const words = result.status === 'quarantined' ? heldWords(result) : result.text ?? heldWords(result);
  return redactSecrets(words).slice(0, max);
}

/** Whether a journal entry belongs to this order: named after one of its runs, or an invoice or credit note on it. */
function entryOfOrder(state: State, entry: JournalRecord, orderId: string, runPrefixes: readonly string[]): boolean {
  if (runPrefixes.some(prefix => entry.subject.startsWith(prefix))) return true;
  if (entry.action === 'invoice.issue') return findRecord(state, 'venture-invoice', entry.subject)?.orderId === orderId;
  if (entry.action === 'credit.issue') {
    const note = findRecord(state, 'venture-credit-note', entry.subject);
    return !!note && findRecord(state, 'venture-invoice', note.invoiceId)?.orderId === orderId;
  }
  return false;
}

/**
 * Everything journalled for this order that is described, approved or of unknown outcome, oldest first, in the
 * journal's own words (its last line), screened. Read from journalled records only: the order's posts, journal entries
 * named after its runs, and its invoices and credit notes. Nothing the agent wrote in the run and nothing a model made.
 * Other orders are left out, so another client's actions never reach this one.
 */
export function unconfirmedActions(state: State, ventureId: string, orderId: string): UnconfirmedAction[] {
  const runs = listRecords(state, 'venture-delivery-run', ventureId).filter(run => run.orderId === orderId).map(run => run.id);
  const prefixes = runs.map(id => `${id}:`);
  const setting = screenSettingOf(state, ventureId);
  const item = (record: JournalRecord | ConnectorPostRecord, action: string, source: UntrustedSource): UnconfirmedAction & { at: string } => ({
    id: record.id, action, target: screened(record.kind === 'venture-connector-post' ? record.connectorId : record.target, 'tool-output', setting, 120),
    state: record.state as UnconfirmedAction['state'], line: screened(record.journal.at(-1)?.line ?? record.describe, source, setting, 300), at: record.at,
  });
  const entries = listRecords(state, 'venture-journal-entry', ventureId)
    .filter(entry => !entry.shadow && !NOT_THE_AGENTS.has(entry.action) && OPEN_STATES.includes(entry.state) && entryOfOrder(state, entry, orderId, prefixes))
    .map(entry => item(entry, JOURNAL_ACTIONS[entry.action]?.label ?? entry.action, 'tool-output'));
  const posts = listRecords(state, 'venture-connector-post', ventureId)
    .filter(post => OPEN_STATES.includes(post.state) && !!post.draftId && runs.includes(post.draftId))
    .map(post => item(post, JOURNAL_ACTIONS['connector.post'].label, 'post'));
  return [...entries, ...posts].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)).map(({ at: _at, ...rest }) => rest);
}

/** The Unconfirmed actions list as the history carries it, or null when there are none (the text then stays the same). */
export function unconfirmedBlock(actions: readonly UnconfirmedAction[]): Json | null {
  return actions.length ? { heading: UNCONFIRMED_HEADING, note: UNCONFIRMED_LINE, actions: actions.map(action => ({ ...action })) } : null;
}

/** The instructions with Chausar's fixed line about the list, only when there is one, so the text stays the same without. */
export function withUnconfirmed(instructions: string, actions: readonly UnconfirmedAction[] | undefined): string {
  return actions?.length ? `${instructions} ${UNCONFIRMED_HEADING}: ${UNCONFIRMED_LINE}` : instructions;
}

/** How long a value is as the agent would read it. */
export function resultChars(value: unknown): number {
  return (JSON.stringify(value) ?? '').length;
}

const resultOf = (call: Pick<ToolCallRecord, 'envelope'>): unknown => (call.envelope.ok ? call.envelope.result : null);

/**
 * The calls of one turn whose results the history shows as a preview: each one over PREVIEW_LIMIT_CHARS, and then,
 * while the turn's results still pass BATCH_CHARS, the largest of the rest.
 */
export function previewedCalls(calls: readonly ToolCallRecord[]): Set<string> {
  const out = new Set<string>();
  const sizes = new Map(calls.filter(call => call.envelope.ok).map(call => [call.id, resultChars(resultOf(call))] as const));
  for (const [id, size] of sizes) if (size > PREVIEW_LIMIT_CHARS) out.add(id);
  const total = () => [...sizes].reduce((sum, [id, size]) => sum + (out.has(id) ? PREVIEW_CHARS : size), 0);
  const rest = [...sizes].filter(([id]) => !out.has(id)).sort((a, b) => b[1] - a[1]);
  for (const [id] of rest) { if (total() <= BATCH_CHARS) break; out.add(id); }
  return out;
}

/** A result as the history shows it once it is too long: its start, its length, and the call that keeps it whole. */
export function previewOf(call: Pick<ToolCallRecord, 'id' | 'envelope'>): Json {
  const text = JSON.stringify(resultOf(call)) ?? '';
  return { shortened: true, call: call.id, chars: text.length, preview: text.slice(0, PREVIEW_CHARS), note: KEPT_NOTE };
}

/** Short names for what the run made: t1, t2 for tables, w1, w2 for receipts, in the order they were made. */
const aliases = (ids: readonly string[], letter: string) => ids.map((_, index) => `${letter}${index + 1}`);

/**
 * The summary of the run so far in HISTORY_SECTIONS, from its own records only: the turns taken, the older turns
 * folded into it (their notes and call ids), what the auditor passed and did not, what was refused, what the run
 * made, and the questions asked and whether they were answered.
 */
export function historySummary(state: HarnessState, folded: readonly number[]): Json {
  const audits = new Map((state.rounds ?? []).flatMap(round => round.steps.map(step => [step.toolCallId, step] as const)));
  const calls = state.toolCalls;
  const sections: Record<(typeof HISTORY_SECTIONS)[number], Json> = {
    turnsTaken: state.used.turns,
    earlierTurns: state.turns.filter(turn => turn.step === 'act' && folded.includes(turn.turn))
      .map(turn => ({ turn: turn.turn, note: turn.note, calls: calls.filter(call => call.turn === turn.turn).map(call => call.id) })),
    audited: calls.filter(call => audits.get(call.id)?.audited === true).map(call => ({ call: call.id, tool: call.tool })),
    notAudited: calls.filter(call => call.envelope.ok && audits.get(call.id)?.audited === false).map(call => ({ call: call.id, tool: call.tool, why: audits.get(call.id)!.reason })),
    refused: calls.filter(call => !call.envelope.ok).map(call => ({ call: call.id, tool: call.tool, code: call.envelope.ok ? '' : call.envelope.error.code })),
    made: { tables: aliases(state.tableIds, 't'), receipts: aliases(state.workReceiptIds, 'w') },
    questions: state.handoffs.map(handoff => ({ to: handoff.to, question: handoff.question, answered: handoff.answer !== null })),
  };
  return { note: HISTORY_SUMMARY_NOTE, sections };
}
