// Chausar venture launcher, views (Ink v2 wave 4, package 4-0): the seam between Today's queue (views/queue.ts) and the
// wave 4 row sources: proposals from Chats (chief/rows.ts, 4C1), follow-ups and replies from the pipeline
// (network/followup-rows.ts, 4E1; network/inbound-rows.ts, 4E3), needs-you notices (views/probes.ts, 4G2) and run
// controls (delivery/run-control-rows.ts, 4F1 and 4F2). Each source returns W4RowItems; queue.ts gives each its
// business, id and digest, records Later itself, keeps the navigation actions (open, read, watch, connect, set prices,
// keep) as navigation, and sends every other decision here. There is one function per new action and per new kind;
// each package replaces only its own NOT_BUILT_YET stub, so no package edits queue.ts.
import { ChausarError, type Context, type State } from '../../contracts.ts';
import type { Display, QueueAction, QueueActionId, QueueChange, QueueKind, QueueRow, VentureDeps, VentureRecord } from '../contracts.ts';

/**
 * Where a wave 4 row comes from. 'money': credit notes waiting for the owner to issue them (money/credits.ts, 4J5).
 * 'routine': a routine's run waiting for the owner's go-ahead (agents/routine-runner.ts, 4J13). 'idea' (Ink v2 wave 5,
 * 5A3): a published idea waiting for its grade (playbooks/kit/ideas.ts), whose only actions are Open and Later.
 * 'sales-proposal' (5A2): a sales proposal waiting for the owner to read and approve (playbooks/kit/proposal.ts).
 */
export type W4RowSource = 'proposal' | 'followup' | 'reply' | 'notice' | 'run-control' | 'money' | 'routine' | 'idea' | 'sales-proposal';
/**
 * A row a wave 4 source makes, before queue.ts adds the business, the id (subject and version) and the digest.
 * subject: what the row stands for, the same across its versions, in identifier characters only (letters, digits and
 * _ . : -). version: changes whenever what the owner decides on changes. navigate: the line a navigation action answers.
 */
export type W4RowItem = {
  kind: QueueKind;
  subject: string;
  version: string;
  createdAt: string;
  title: string;
  line?: string;
  agent?: string;
  change?: QueueChange;
  viewRef?: QueueRow['viewRef'];
  actions: QueueAction[]; // one or two; exactly one primary
  descriptionComplete?: boolean;
  navigate?: string;
  followup?: QueueRow['followup']; // 4E1: a follow-up row's parts
  reply?: QueueRow['reply']; // 4E3: a reply row's parts
  needs?: QueueRow['needs']; // 4E3: what Approve needs as its answer (the day of an undated next step)
  notice?: QueueRow['notice']; // 4G2: a needs-you probe's parts (which probe, severity, deep link, receipts)
};
/**
 * A wave 4 row source: the open business's rows of one kind, read from records only. shown: the subjects Today already
 * has from the rows built before it (4G2's probes use it so they never repeat another row; other sources ignore it).
 */
export type W4RowSourceFn = (deps: VentureDeps, ctx: Context, state: State, venture: VentureRecord, shown?: ReadonlySet<string>) => W4RowItem[] | Promise<W4RowItem[]>;
/** One decision on a wave 4 row, after queue.ts checked the digest, the action offered, the view and the answer. */
export type W4Decision = { source: W4RowSource; row: Omit<QueueRow, 'digest'>; subject: string; action: QueueActionId; answer: string | null };
/** What a decision did, in the engine's words, with the receipt it made when there is one. */
export type W4Outcome = { line: Display; receiptId?: string };
type Decide = (deps: VentureDeps, ctx: Context, decision: W4Decision) => Promise<W4Outcome>;

const notBuiltYet: Decide = async () => { throw new ChausarError('NOT_BUILT_YET', 'This part of Chausar is not built yet.'); };

// --- By action: the four new action ids ---
/** 4E1 follow-up rows (network/followup-rows.ts), loaded on use. */
const followups = () => import('../network/followup-rows.ts');
/**
 * 4E1, 4E2: "I sent it" after a handoff on a follow-up or reminder row. 4E1 records a follow-up's; a reminder row (its
 * subject `reminder:<draft id>`, from whichever source 4J5 shows it in) is recorded by 4E2 (network/outreach.ts).
 */
export const decideSent: Decide = async (deps, ctx, decision) => (decision.subject.startsWith('reminder:')
  ? (await import('../network/outreach.ts')).decideReminderSent(deps, ctx, decision)
  : decision.source === 'followup'
    ? (await followups()).decideFollowupSent(deps, ctx, decision)
    : notBuiltYet(deps, ctx, decision));
/** 4F1 run controls (delivery/run-controls.ts), loaded on use so this seam imports no delivery code. */
const runControls = () => import('../delivery/run-controls.ts');
/** 4F1: Continue at the round gate, with the owner's optional words for the next turn (answer). */
export const decideContinue: Decide = async (deps, ctx, decision) => (await runControls()).decideGateContinue(deps, ctx, decision);
/** 4F1: Stop at the round gate. */
export const decideStop: Decide = async (deps, ctx, decision) => (await runControls()).decideGateStop(deps, ctx, decision);
/** 4F1: Resume a stopped run. */
export const decideResume: Decide = async (deps, ctx, decision) => (await runControls()).decideResume(deps, ctx, decision);

// --- By kind: the four new kinds, for every other action on them ---
/** 4C1: approve runs the real engine method for the proposal's kind after the gate runs again; deny dismisses it. Loaded on use. */
export const decideProposal: Decide = async (deps, ctx, decision) => (await import('../chief/proposals.ts')).decideProposal(deps, ctx, decision);
/** 4E1: a follow-up row's other actions (it offers only Open, which is navigation, and I sent it). */
export const decideFollowup: Decide = async (deps, ctx, decision) => (await followups()).decideFollowupOther(deps, ctx, decision);
/** 4E3: a reply row: confirm a match ("Is this from Priya about Acme?"), or move the card to Talking. Loaded on use. */
export const decideReply: Decide = async (deps, ctx, decision) => (await import('../network/inbound-rows.ts')).decideReplyRow(deps, ctx, decision);
/** 4G2: a notice row's actions other than Open and Later (views/probes.ts refuses them in words), loaded on use. */
export const decideNotice: Decide = async (deps, ctx, decision) => (await import('./probes.ts')).decideNoticeRow(deps, ctx, decision);
/** 4F1, 4F2: any other action on a run-control row (Run again on a stopped run; 4F2 adds raising a write cap). */
export const decideRunControl: Decide = async (deps, ctx, decision) => (decision.subject.startsWith('writecap:')
  ? (await import('../delivery/harness/write-caps.ts')).decideWriteCapRow(deps, ctx, decision)
  : (await runControls()).decideRunAgain(deps, ctx, decision));

/** 4J5: Issue or Cancel on a waiting credit note (money/credits.ts), loaded on use. */
export const decideMoney: Decide = async (deps, ctx, decision) => (await import('../money/credits.ts')).decideMoneyRow(deps, ctx, decision);
/** 4J13: Run it or Not now on a routine's waiting run (agents/routine-runner.ts), loaded on use. */
export const decideRoutineRow: Decide = async (deps, ctx, decision) => (await import('../agents/routine-runner.ts')).decideRoutine(deps, ctx, decision);

const BY_ACTION: Readonly<Partial<Record<QueueActionId, Decide>>> = { sent: decideSent, continue: decideContinue, stop: decideStop, resume: decideResume };
const BY_SOURCE: Readonly<Record<W4RowSource, Decide>> = {
  proposal: decideProposal, followup: decideFollowup, reply: decideReply, notice: decideNotice, 'run-control': decideRunControl, money: decideMoney,
  routine: decideRoutineRow,
  // 5A3: a grade row offers only Open (navigation) and Later, which queue.ts handles; the grade is given on Work.
  idea: async () => { throw new ChausarError('INVALID_VENTURE_REQUEST', 'Open Work, then Ideas, to grade it.'); },
  // 5A2: Approve on a sales proposal the owner read (playbooks/kit/proposal.ts), loaded on use.
  'sales-proposal': async (deps, ctx, decision) => (await import('../playbooks/kit/proposal.ts')).decideSalesProposalRow(deps, ctx, decision),
};

/** Runs one decision on a wave 4 row: a new action id goes to its own function, any other to its row's source. */
export async function decideW4Row(deps: VentureDeps, ctx: Context, decision: W4Decision): Promise<W4Outcome> {
  const decide = BY_ACTION[decision.action] ?? BY_SOURCE[decision.source];
  return decide(deps, ctx, decision);
}
