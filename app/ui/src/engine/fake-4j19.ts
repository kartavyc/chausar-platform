/**
 * The fake engine's answers for the approval methods Today's screen (4J19) calls beyond one button, with the engine's
 * codes, shapes and words (platform/runtime/venture/views/queue-actions.ts, delivery/revise.ts, delivery/changes.ts,
 * views/triage.ts, journal/decisions.ts): send back with words, edit and undo, a fix after failed checks, the paragraph
 * changes of a revision, the triage rule, and the decision record. It also gives the fake's own Today rows the meta
 * the engine adds after each row's digest (views/row-meta.ts): client, business and time on every row, where a post
 * sends and its counts, a failed run's attempt. Nothing here is a model's: the fake has no AI, so the triage rule is
 * always offered as the fixed choices, as the engine does with none.
 */

import { EngineError, type DecisionView, type DeliveryLite, type DraftChangesView, type QueueDecision, type QueueRow, type TriagePreview, type TriageRule } from './types';
import type { W4DeskHost } from './fake-w4';

export const FAKE_4J19_METHODS: readonly string[] = [
  'venture.queue.sendBack', 'venture.queue.edit', 'venture.queue.undo', 'venture.delivery.fix', 'venture.delivery.changes', 'venture.delivery.decideChange',
  'venture.triage.preview', 'venture.triage.set', 'venture.decisions.list',
  // 4J19 review: a working paper's work receipt; the sample keeps none, so it answers as the engine does for an unknown id.
  'venture.work.get',
];

/** The engine's words, word for word. */
export const FAKE_4J19_WORDS = {
  sentBack: (text: string) => `Sent back with your words: ${text}`,
  sentBackLine: 'Sent back. The revision waits for your approval before anything goes to your AI.',
  planKept: (text: string) => `Not accepted. Your words: ${text}`,
  planLine: 'Kept as a draft. Your words are on the decision.',
  edited: 'You edited the draft. Your version waits for your approval.',
  editLine: 'Your version is kept. Approve it when it is ready.',
  empty: 'Say what to change first.',
  tooLong: 'Keep it to 300 characters.',
  notOffered: "Send back works on drafts and on plan changes. Use the row's own buttons here.",
  editNotOffered: 'Only a draft waiting for your review can be edited here.',
  nothing: 'Nothing to undo here.',
  restored: 'Restored until you edit this again.',
  stale: 'This click did not run anything. Here is the new version.',
  notReady: 'This draft is not waiting for your review.',
  nothingToFix: 'Nothing failed on this draft, so there is nothing to fix.',
  noMerge: 'The agent has not revised this draft, so there is nothing to decide.',
  triageStale: 'Your order changed on another screen. Look at the dry run again.',
} as const;

const SEND_BACK_MAX = 300;

/** The fixed choices (views/triage.ts TRIAGE_CHOICES), offered with or without the owner's AI. */
const TRIAGE_CHOICES: readonly TriageRule[] = [
  { keys: [{ field: 'due', order: 'asc' }], words: 'Nearest deadline first' },
  { keys: [{ field: 'money', order: 'desc' }], words: 'Most money first' },
  { keys: [{ field: 'client', order: 'asc' }], words: 'By client, A to Z' },
  { keys: [{ field: 'kind', order: 'asc' }], words: 'By kind of work' },
  { keys: [{ field: 'business', order: 'asc' }], words: 'By business, A to Z' },
  { keys: [], words: "Chausar's own order" },
];
const KEY_WORDS: Record<string, Record<'asc' | 'desc', string>> = {
  due: { asc: 'nearest deadline first', desc: 'latest deadline first' },
  client: { asc: 'client A to Z', desc: 'client Z to A' },
  kind: { asc: 'kind of work', desc: 'kind of work, reversed' },
  money: { asc: 'least money first', desc: 'most money first' },
  business: { asc: 'business A to Z', desc: 'business Z to A' },
};
const ruleLine = (rule: TriageRule) => (rule.keys.length ? `Today is ordered: ${rule.keys.map((key) => KEY_WORDS[key.field]![key.order]).join(', then ')}. Nothing is hidden.` : "Today is in Chausar's own order.");

/** The meta the engine adds to the fake's sample rows (fixtures.ts QUEUE), by row id, beside client, business and time. */
const SAMPLE_META: Readonly<Record<string, Partial<QueueRow> & { client?: string }>> = {
  'q-invoice-mehta': { client: 'Mehta Traders' },
  'q-signoff-gst': { client: 'Mehta Traders' },
  'post:linkedin-ep13:v1': { sendsTo: 'public' },
  'q-run-again-thumbs': { attempt: { n: 1, lastError: 'ffmpeg was not found on this computer.' } },
};

/** Today's rows with the meta the engine adds after the digest; ids and digests stay as they were. */
export function withFakeMeta(rows: QueueRow[]): QueueRow[] {
  return rows.map((row) => {
    if (row.meta) return row;
    const { client, ...extra } = SAMPLE_META[row.id] ?? {};
    const counts = row.preview?.kind === 'post' ? { counts: structuredClone(row.preview.counts) } : {};
    return { ...row, ...structuredClone(extra), ...counts, meta: { client: client ?? null, business: row.businessName, at: row.createdAt } };
  });
}

type Undo = { kind: 'edit' | 'send-back'; row: QueueRow; madeId: string | null; runId: string | null };
const ID_OK = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 400;

/** The fake's answers, as the engine's queue-actions, revise, changes, triage and decisions modules give them. */
export class FakeApprovalsDesk {
  private readonly host: W4DeskHost;
  private readonly undos = new Map<string, Undo>();
  private readonly decisions: DecisionView[] = [];
  private rule: TriageRule | null = null;
  private seq = 0;

  constructor(host: W4DeskHost, options: { fresh?: boolean } = {}) {
    this.host = host;
    // A step the Editor's Auto setting let run without asking, as journal/decisions.ts lists it (allowedGroups).
    if (!options.fresh) {
      this.decisions.push({
        id: 'run-31/cut', at: '2026-10-21T10:21:00.000Z', subject: 'step:cut', action: 'ffmpeg.render', who: 'saved-rule',
        rule: "Your Auto setting on 'Cut the episode'", ruleId: 'gate-cut', reason: 'The agent ran ffmpeg.render without asking.',
        line: "Allowed by your Auto setting on 'Cut the episode', without asking", by: null, agentId: 'editor',
      });
    }
  }

  request(method: string, p: Record<string, unknown>): unknown {
    switch (method) {
      case 'venture.queue.sendBack': return this.sendBack(p);
      case 'venture.queue.edit': return this.edit(p);
      case 'venture.queue.undo': return this.undo(p);
      case 'venture.delivery.fix': return this.fix(p);
      case 'venture.delivery.changes': return this.changes(p);
      case 'venture.delivery.decideChange': return this.decideChange(p);
      case 'venture.triage.preview': return this.triagePreview(p);
      case 'venture.triage.set': return this.triageSet(p);
      case 'venture.work.get': {
        if(Object.keys(p).some(key=>key!=='id')||typeof p.id!=='string'||!/^[A-Za-z0-9_.:-]{1,200}$/.test(p.id))throw new EngineError('INVALID_VENTURE_REQUEST','Work receipt must be a known identifier.');
        const receipt=this.host.workReceipt?.(p.id);if(receipt)return structuredClone(receipt);
        throw new EngineError('WORK_RECEIPT_NOT_FOUND', 'That work receipt was not found.');
      }
      case 'venture.decisions.list': return { decisions: structuredClone(this.decisions).reverse() };
      default: throw new EngineError('METHOD_NOT_ALLOWED', `The fake engine does not answer ${method}.`);
    }
  }

  private now(): string { return this.host.now(); }

  private record(subject: string, action: string, reason: string, line: string): void {
    this.decisions.push({ id: `fake-decision-${(this.seq += 1)}`, at: this.now(), subject, action, who: 'owner', rule: null, ruleId: null, reason, line, by: 'owner', agentId: null });
  }

  /** The row the owner saw, or what the engine answers instead: stale with the latest, or resolved elsewhere. */
  private seen(p: Record<string, unknown>): QueueRow | QueueDecision {
    if (!ID_OK(p.rowId)) throw new EngineError('INVALID_VENTURE_REQUEST', 'Send the id of the row you decided on.');
    if (typeof p.digest !== 'string' || !p.digest) throw new EngineError('INVALID_VENTURE_REQUEST', 'Send the digest of the row you saw.');
    const row = this.host.rows().find((item) => item.id === p.rowId);
    if (!row) {
      // As the engine's staleOrGone (views/queue-actions.ts): the same subject under a new version id is stale, with it.
      const subject = (p.rowId as string).includes(':') ? (p.rowId as string).slice(0, (p.rowId as string).lastIndexOf(':')) : null;
      const latest = subject ? this.host.rows().find((item) => item.id.includes(':') && item.id.slice(0, item.id.lastIndexOf(':')) === subject) : undefined;
      if (latest) return { outcome: 'stale', reason: 'APPROVAL_STALE', line: FAKE_4J19_WORDS.stale, latest: structuredClone(latest) };
      return { outcome: 'refused', reason: 'RESOLVED_ELSEWHERE', line: 'This was resolved elsewhere.' };
    }
    if (row.digest !== p.digest) return { outcome: 'stale', reason: 'APPROVAL_STALE', line: FAKE_4J19_WORDS.stale, latest: structuredClone(row) };
    return row;
  }

  private remove(id: string, add?: QueueRow): void {
    const rows = this.host.rows().filter((row) => row.id !== id);
    this.host.setRows(add ? [...rows, add] : rows);
    this.host.emit({ type: 'queue.changed', businessId: this.host.current(), at: this.now() });
  }

  /** A draft waiting for review: its run id (the fake's draft rows open their draft by viewRef). */
  private static reviewRun(row: QueueRow): string | null {
    return row.kind === 'draft' && row.viewRef?.kind === 'draft' && row.actions.some((action) => action.id === 'approve') ? row.viewRef.id : null;
  }

  private sendBack(p: Record<string, unknown>): QueueDecision {
    if (typeof p.text !== 'string') throw new EngineError('INVALID_VENTURE_REQUEST', 'Your words must be text.');
    if (!p.text.trim()) throw new EngineError('SEND_BACK_EMPTY', FAKE_4J19_WORDS.empty);
    if (p.text.trim().length > SEND_BACK_MAX) throw new EngineError('INVALID_VENTURE_REQUEST', FAKE_4J19_WORDS.tooLong);
    const seen = this.seen(p);
    if (!('id' in seen)) return seen;
    const text = p.text.trim();
    const runId = FakeApprovalsDesk.reviewRun(seen);
    if (runId) {
      this.undos.set(seen.id, { kind: 'send-back', row: seen, madeId: null, runId });
      this.record(`run:${runId}`, 'deny', FAKE_4J19_WORDS.sentBack(text), `You chose No on Today: ${FAKE_4J19_WORDS.sentBack(text)}`);
      this.remove(seen.id);
      return { outcome: 'done', line: FAKE_4J19_WORDS.sentBackLine };
    }
    if (seen.kind === 'plan' || seen.kind === 'price') {
      this.undos.set(seen.id, { kind: 'send-back', row: seen, madeId: null, runId: null });
      this.record(`plan:${seen.id}`, 'deny', FAKE_4J19_WORDS.planKept(text), `You chose No on Today: ${FAKE_4J19_WORDS.planKept(text)}`);
      this.remove(seen.id);
      return { outcome: 'done', line: FAKE_4J19_WORDS.planLine };
    }
    return { outcome: 'refused', reason: 'NOT_OFFERED', line: FAKE_4J19_WORDS.notOffered };
  }

  /** No and reopen: the owner's version waits for their review as a new version of the row (a new row id, as the engine's review count gives). */
  private edit(p: Record<string, unknown>): QueueDecision {
    if (typeof p.text !== 'string' || !p.text.trim()) throw new EngineError('INVALID_VENTURE_REQUEST', 'Your version must have at least 1 character.');
    const seen = this.seen(p);
    if (!('id' in seen)) return seen;
    const runId = FakeApprovalsDesk.reviewRun(seen);
    if (!runId) return { outcome: 'refused', reason: 'NOT_OFFERED', line: FAKE_4J19_WORDS.editNotOffered };
    const text = p.text;
    this.revise(runId, (run) => ({ ...run, editedText: text }));
    const { digest: _digest, ...rest } = seen;
    const madeId = `${seen.id}-edit${(this.seq += 1)}`;
    const made: QueueRow = { ...rest, id: madeId, createdAt: this.now(), digest: '' };
    made.digest = this.host.digest({ ...made, digest: undefined, text });
    this.undos.set(seen.id, { kind: 'edit', row: seen, madeId, runId });
    this.record(`run:${runId}`, 'deny', FAKE_4J19_WORDS.edited, `You chose No on Today: ${FAKE_4J19_WORDS.edited}`);
    this.remove(seen.id, made);
    return { outcome: 'done', line: FAKE_4J19_WORDS.editLine };
  }

  private revise(runId: string, change: (run: DeliveryLite) => DeliveryLite): void {
    const host = this.host as W4DeskHost & { reviseDelivery?: (id: string, revise: (run: DeliveryLite) => DeliveryLite) => DeliveryLite };
    try { host.reviseDelivery?.(runId, change); } catch { /* a sample row whose draft is not in the delivery list keeps no text */ }
  }

  private undo(p: Record<string, unknown>): { restored: boolean; line: string } {
    if (!ID_OK(p.rowId)) throw new EngineError('INVALID_VENTURE_REQUEST', 'Send the id of the row to undo.');
    const undo = this.undos.get(p.rowId);
    if (!undo) throw new EngineError('UNDO_NOTHING', FAKE_4J19_WORDS.nothing);
    if (undo.madeId && !this.host.rows().some((row) => row.id === undo.madeId)) throw new EngineError('UNDO_TOO_LATE', 'Too late to undo: this draft moved on since your edit.');
    this.undos.delete(p.rowId);
    if (undo.kind === 'edit' && undo.runId) this.revise(undo.runId, (run) => ({ ...run, editedText: null }));
    // The row comes back as a new version (the engine's reopen mark gives it a new id and digest).
    const { digest: _digest, ...rest } = undo.row;
    const back: QueueRow = { ...rest, id: `${undo.row.id}-r${(this.seq += 1)}`, createdAt: this.now(), digest: '' };
    back.digest = this.host.digest({ ...back, digest: undefined });
    if (undo.madeId) this.host.setRows(this.host.rows().filter((row) => row.id !== undo.madeId));
    this.record(undo.runId ? `run:${undo.runId}` : `plan:${undo.row.id}`, 'undo', undo.kind === 'edit' ? 'You took back your edit.' : 'You took back sending this draft back.',
      `You decided: ${undo.kind === 'edit' ? 'You took back your edit.' : 'You took back sending this draft back.'}`);
    this.remove('', back);
    return { restored: true, line: FAKE_4J19_WORDS.restored };
  }

  private delivery(runId: unknown): DeliveryLite {
    const run = (this.host.ask('venture.delivery.list', {}) as DeliveryLite[]).find((item) => item.id === runId);
    if (!run) throw new EngineError('DELIVERY_NOT_FOUND', 'That draft reply was not found.');
    return run;
  }

  /** After failed checks: a revision naming them waits for the owner's approval (status waiting-for-you). */
  private fix(p: Record<string, unknown>): DeliveryLite {
    const run = this.delivery(p.runId);
    if (run.status !== 'ready-for-review') throw new EngineError('DELIVERY_NOT_READY', FAKE_4J19_WORDS.notReady);
    const failed = [...(run.checks ?? []).filter((c) => !c.passed && !c.notChecked).map((c) => c.check), ...(run.playbookChecks ?? []).filter((c) => c.outcome === 'fail').map((c) => `${c.playbook}:${c.check}`)];
    if (!failed.length) throw new EngineError('INVALID_VENTURE_REQUEST', FAKE_4J19_WORDS.nothingToFix);
    let picked: string[];
    if (p.checks === 'all') picked = failed;
    else {
      if (!Array.isArray(p.checks) || !p.checks.length || !p.checks.every((id) => typeof id === 'string')) throw new EngineError('INVALID_VENTURE_REQUEST', 'Choose all, or the checks to fix.');
      picked = p.checks as string[];
      if (picked.some((id) => !failed.includes(id))) throw new EngineError('INVALID_VENTURE_REQUEST', 'That check did not fail on this draft.');
    }
    this.revise(run.id, (item) => ({ ...item, status: 'waiting-for-you', awaitingYou: true }));
    this.record(`run:${run.id}`, 'fix', `You asked the agent to fix: ${picked.join(', ')}.`, `You decided: You asked the agent to fix: ${picked.join(', ')}.`);
    const row = this.host.rows().find((item) => item.viewRef?.kind === 'draft' && item.viewRef.id === run.id);
    if (row) this.remove(row.id);
    return { ...structuredClone(run), status: 'waiting-for-you', awaitingYou: true };
  }

  /** No agent revision ever lands in the fake, so a draft has no paragraph changes. */
  private changes(p: Record<string, unknown>): DraftChangesView {
    this.delivery(p.runId);
    return { changes: [] };
  }

  private decideChange(p: Record<string, unknown>): DraftChangesView {
    const run = this.delivery(p.runId);
    if (run.status !== 'ready-for-review') throw new EngineError('DELIVERY_NOT_READY', FAKE_4J19_WORDS.notReady);
    throw new EngineError('INVALID_VENTURE_REQUEST', FAKE_4J19_WORDS.noMerge);
  }

  private ruleDigest(): string { return this.host.digest({ rule: this.rule }); }

  private triagePreview(p: Record<string, unknown>): TriagePreview {
    if (typeof p.text !== 'string' || !p.text.trim() || p.text.length > 200) throw new EngineError('INVALID_VENTURE_REQUEST', 'How you want Today ordered must have 1 to 200 characters.');
    return { rule: null, choices: structuredClone([...TRIAGE_CHOICES]), rows: structuredClone(this.host.rows()), digest: this.ruleDigest(), by: 'choices' };
  }

  private triageSet(p: Record<string, unknown>): { rule: TriageRule; line: string } {
    const rule = p.rule as TriageRule | undefined;
    const fields = ['due', 'client', 'kind', 'money', 'business'];
    if (!rule || !Array.isArray(rule.keys) || rule.keys.length > 3 || !rule.keys.every((key) => fields.includes(key.field) && (key.order === 'asc' || key.order === 'desc'))) {
      throw new EngineError('INVALID_VENTURE_REQUEST', 'A rule orders by due, client, kind, money or business only.');
    }
    if (typeof rule.words !== 'string' || !rule.words.trim()) throw new EngineError('INVALID_VENTURE_REQUEST', "The rule's words must have 1 to 200 characters.");
    if (p.digest !== this.ruleDigest()) throw new EngineError('APPROVAL_STALE', FAKE_4J19_WORDS.triageStale);
    this.rule = structuredClone(rule);
    this.host.emit({ type: 'queue.changed', businessId: this.host.current(), at: this.now() });
    return { rule: structuredClone(rule), line: ruleLine(rule) };
  }
}
