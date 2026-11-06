// Venture queue contract. Types only; public imports use ../contracts.ts.
import type { VENTURE_EVENTS } from '../contract-values.ts';
import type { IsoDate, IsoTime, Json, MicroString, RecordBase } from './business.ts';
import type { Display, ModelReceiptView } from './spend.ts';
import type { DepartmentId, InboundTopic, OutreachChannel } from './records.ts';
import type { FixKind, QuestionCard, RoundGateReason, RunFailureKind, RunStepState } from './delivery.ts';
import type { AgentHealth } from './views.ts';

export type VentureEventName = typeof VENTURE_EVENTS[number];

export type VentureEventRecord = RecordBase<'venture-event'> & { seq: number; name: VentureEventName; data: Json };

// ---------------------------------------------------------------------------
// 9b. Views for the Ink frontend (P1-A). app/ui mirrors these in app/ui/src/engine/types.ts.
// Display and SpendRow, also in the shared contract, are declared in section 8c.
// ---------------------------------------------------------------------------

/**
 * Ink v2 wave 4: 'sent' is the owner's "I sent it" after a handoff (4E1, 4E2); 'continue' and 'stop' answer the round
 * gate (4F1); 'resume' goes on with a stopped run (4F1).
 */
export type QueueActionId = 'approve' | 'deny' | 'later' | 'watch' | 'read' | 'answer' | 'send-to-ca' | 'open' | 'connect' | 'set-prices' | 'keep' | 'issue' | 'run-again'
  | 'sent' | 'continue' | 'stop' | 'resume' | 'show-file';

export interface QueueAction { id: QueueActionId; label: string; primary: boolean; secondAsk?: boolean; requiresView?: boolean }

export interface QueueChange { label?: string; before?: Display; after: Display; receiptId?: string; estimate?: boolean; ownerEntered?: true }

/**
 * 'bank': a bank statement row to record as a payment, or a bank alert (Ink v2 wave 2). Ink v2 wave 4: 'proposal', a
 * proposal from Chats raised to Today (4C1); 'followup', a follow-up due by date (4E1); 'reply', inbound mail that needs
 * the owner (4E3); 'notice', a needs-you probe (4G2). Their decisions go to views/queue-w4.ts.
 */
export type QueueKind = 'draft' | 'price' | 'quote' | 'plan' | 'invoice' | 'signoff' | 'question' | 'setup' | 'locked' | 'connector' | 'bank'
  | 'proposal' | 'followup' | 'reply' | 'notice';

export interface QueueRow {
  id: string; businessId: string; businessName: string; agent?: string; kind: QueueKind;
  title: string; line?: string; change?: QueueChange; digest: string; createdAt: string;
  actions: QueueAction[]; // one or two; exactly one primary
  viewRef?: { kind: 'draft' | 'file' | 'run' | 'plan'; id: string };
  /** Only on rows that propose an outside action (W1 H21): false when part of what it will send is not shown. */
  descriptionComplete?: boolean;
  // Ink v2 wave 4: added after the row's digest by views/row-meta.ts (4J1) and views/previews.ts (4J3); each absent
  // until its package fills it and whenever there is nothing real to say.
  meta?: QueueRowMeta;
  sendsTo?: QueueSendsTo;
  attempt?: { n: number; lastError: Display | null };
  counts?: QueueCount[];
  price?: { display: Display; receiptId: string; line: Display; free?: Display };
  changeCount?: { line: Display; details: Display[]; coverage: Display };
  preview?: QueuePreview;
  /** 4J1: every amount the row's line, change or price states, each with its proof; added after the digest like meta. */
  amounts?: QueueAmount[];
  /** 4E1: a follow-up row's parts, so the screen can say it in its own words (and in Hindi). Part of the row's digest. */
  followup?: QueueFollowup;
  /** 4E3: a reply row's parts (and a meeting-notes notice's), for the screen's own words and Hindi. Part of the row's digest. */
  reply?: QueueReply;
  /** 4E3: what Approve needs from the owner as its answer: the day, for a next step drafted from notes that wrote none. */
  needs?: { answer: 'day'; line: Display };
  /** 4G2: a needs-you probe's notice parts. Part of the row's digest. */
  notice?: QueueNotice;
}

/**
 * The needs-you probes (4G2, O10): failed posts, a broken connection, drafts waiting, a calendar gap, a sharp move, a
 * stalled client. 'idea' (Ink v2 wave 5, 5A3): a published idea whose seven days are over, waiting for its grade.
 */
export type NoticeProbe = 'post' | 'connection' | 'drafts' | 'calendar' | 'moved' | 'stalled' | 'idea' | 'bill' | 'ca-pack' | 'readable-copy';

/**
 * A probe's notice (4G2): which probe made it, how much it matters, the screen Open goes to (an app address such as
 * #/connections), and each amount its line states, written exactly as there, with the receipt behind it, in the order
 * the line states them (any currency: the text is matched as written, not by a money pattern).
 */
export type QueueNotice = { probe: NoticeProbe; severity: 'high' | 'medium' | 'low'; link: string; figures?: { text: Display; receiptId: string }[]; /** C5 task 17: the file of Chausar's exports folder Show in folder shows. */ file?: string };

/**
 * A reply row's parts (4E3): which mail, why it waits on the owner (a match to confirm, a move to Talking, a reply to
 * write yourself, the fixed answer to "are you a bot", notes after a call), who, the card, what it asks about, and for a
 * handoff the address and the screened subject. draft: the fixed honest answer, only on a bot question.
 */
export type QueueReply = {
  inboundId: string | null; reason: 'confirm' | 'talking' | 'owner-reply' | 'bot-question' | 'meeting-notes' | 'opt-out' | 'bounce-domain';
  name: string; company: string | null; opportunityId: string | null; eventId: string | null; topics: InboundTopic[];
  from: string | null; subject: string | null; draft: string | null;
};

/** A follow-up row's parts (4E1): the card (a lead's id for a lead's card), who, the due day and lateness, the channel and the drafted nudge. */
export type QueueFollowup = { cardId: string; name: string; company: string | null; due: IsoDate; daysLate: number; channel: OutreachChannel | null; draftId: string | null };

/** Where an approved row's action goes, from the action's declared effect and its connector (4J1). */
export type QueueSendsTo = 'client' | 'public' | 'bank' | 'portal';

/**
 * One amount a Today row states (4J1), each occurrence its own: where names the field (the line, the change's before or
 * after, the price beside Approve, or one change count detail line, by index); text is field.slice(start, start + length),
 * counted in UTF-16 code units as JavaScript strings are. Its proof is a receipt venture.receipt.get serves, or estimate
 * when a model wrote it, never both.
 */
export type QueueAmount = { text: Display; where: 'line' | 'change.before' | 'change.after' | 'price' | 'details'; index?: number; start: number; length: number }
  & ({ receiptId: string; estimate?: never } | { estimate: true; receiptId?: never });

/**
 * The meta line of a row (4J1): the client, the business and the time; expiresAt only from a real expiry, never
 * invented; waitingLong after 24 hours; staleDraft on a draft older than 14 days.
 */
export interface QueueRowMeta {
  client: string | null; business: string; at: IsoTime; expiresAt?: IsoTime; waitingLong?: Display; staleDraft?: Display;
  /** 4J16 (Q4): the quotes code moved to their time in the transcript on this draft, one line each, shown beside Approve. */
  quoteFixes?: Display[];
}

/** One count against a platform limit, on a post row (4J1), for example 212 of 3,000 characters. */
export type QueueCount = { label: Display; count: number; limit: number };

/**
 * What a row's card shows before it is opened (4J3, views/previews.ts), from the owner's own records only. A field
 * without its source is left out; a preview never carries a made-up image, and drawing one never counts as viewed.
 * Every amount is a PreviewFigure with its receipt; words a model wrote are PreviewWords with their estimate flag.
 * video: a YouTube draft's package title, its length (from the run's edit list, else the transcript), the chapter
 * count only when the chapters check passed, the check counts, and the still from the cut when one is kept (a JPEG
 * data address, at most POSTER_MAX_BYTES). paper 'invoice': the invoice's lines, tax lines (none for a business not
 * registered for tax) and total, all with the price receipt; paper 'working': a CA paper's figures with their receipts
 * and who signs it. post: the exact text and its counts against the platform's limits. choice: a question's options;
 * a figure on an option is only ever a model estimate.
 */
export type QueuePreview =
  | { kind: 'video'; title: PreviewWords; format: 'long' | 'short'; duration?: PreviewLength; chapters?: number; checks: { passed: number; run: number; notRun: number }; poster?: { uploadId: string; src: string } }
  | { kind: 'paper'; paper: 'invoice'; title: Display; from: Display; to: Display; lines: (PreviewFigure & { quantity: string; unit: Display })[]; subtotal: PreviewFigure; discount?: PreviewFigure; taxLines: PreviewFigure[]; total: PreviewFigure; due?: { days: number; date: IsoDate | null; display: Display } }
  | { kind: 'paper'; paper: 'working'; title: Display; client: Display | null; working: PreviewFigure[]; more: number; signer: { name: Display; state: 'to-send' | 'with-ca' } | null }
  | { kind: 'post'; connectorId: string; platform: Display; account: Display | null; mode: 'api' | 'owner-browser-session'; text: string; textEstimate?: true; counts: QueueCount[]; short?: { title: PreviewWords; length?: PreviewLength } }
  | { kind: 'choice'; question: PreviewWords; options: { label: Display; text: PreviewWords; estimate?: { label: Display; value: Display }; gains?: Display; costs?: Display; recommended?: boolean }[]; card?: QuestionCard };

/**
 * An engine-formatted amount and the receipt it comes from (4J3): a preview shows no amount without one. receiptKind
 * names the method that opens the receipt: price and sum through venture.receipt.get, ca (a CA engine's receipt kept on
 * a work receipt) through venture.ca.receipt, work (any other work receipt) through venture.work.get.
 * A post's textEstimate: a model wrote the text and it holds a number or an amount no receipt backs; the text stays exact.
 */
export type PreviewFigure = { label: Display; value: Display; receiptId: string; receiptKind: PreviewReceiptKind };

export type PreviewReceiptKind = 'price' | 'sum' | 'ca' | 'work';

/** Words as a preview shows them. estimate: a model wrote a number in them that no receipt backs ("model estimate"). */
export type PreviewWords = { text: Display; estimate?: true };

/** A length worked out by code: whole seconds, "11 min 42 s", "11:42", and what it was measured from. */
export type PreviewLength = { seconds: number; display: Display; clock: Display; from: 'edit-list' | 'transcript' };

export interface QueueList { rows: QueueRow[]; summary: Display; needsYou: number; businesses: number }

export interface QueueDecision {
  outcome: 'done' | 'stale' | 'refused'; line: Display; receiptId?: string; latest?: QueueRow; reason?: string;
  /** B4 task 7: a done decision venture.queue.undo can take back (one price accepted on one press). */
  undoable?: true;
}

export type RunState = 'active' | 'waiting' | 'done' | 'failed';

export interface RunStep {
  id: string; purpose: string; state: 'done' | 'current' | 'pending' | 'waiting' | 'failed'; elapsed?: Display;
  /** C5 task 4: this step's own working time, and the time the run waited for the owner just before it; both from stamped times only. */
  working?: Display; waiting?: Display;
  tools?: RunToolLine[]; evidence?: { kind: string; id: string; label: string }[]; error?: string; audited?: boolean;
  /** 4J14 (Q6): on the read step, how much of the client's files code handed over; on the run's own sheet only. */
  coverage?: CoverageView;
  /** 4J14 (Q6): on the check step, the checks that could not run: id (playbook:check) and the engine's line ("Not run: ..."). */
  notRun?: { id: string; line: Display }[];
}

/**
 * Ink v2 wave 4 (4J14, Q6): coverage, fraction first ("1,204 of 1,210 lines matched"). done and total are counted by
 * code; null where nothing observed them, never 0. complete only when every counted item was seen.
 */
export type CoverageView = {
  done: number | null; total: number | null; unit: 'rows' | 'lines' | 'pages' | 'items' | 'bank-lines'; verb: 'read' | 'matched' | 'used';
  complete: boolean; line: Display;
  /** On an 'items' count only: the units it adds up (rows and lines), so the screen words it for itself. */
  units?: ('rows' | 'lines' | 'pages' | 'bank-lines')[];
};

/** 4J14 (Q7): one line of a run's report, its outcome from the one table (delivery/verdicts.ts); judgment for a judged rule. */
export type ReportItem = {
  id: string; outcome: 'pass' | 'fail' | 'not-run' | 'not-checked' | 'unknown'; line: Display;
  /** The line without its outcome word, for the screen's own words (Hindi). */
  detail: Display;
  /** A judged rule: its word, and why it was dropped below the keep line (delivery/verdicts.ts keepJudgment). */
  judgment?: 'strong' | 'fair' | 'weak' | 'no' | null; drop?: Display;
};

/** 4J14 (Q7): one judge rule's result as code counted it: its outcome, the checked yes votes and the votes cast. */
export type JudgeRuleResult = { rule: string; outcome: 'pass' | 'fail' | 'unverified'; yes: number; votes: number };

/**
 * 4J14 (Q7, Q8): a draft's report in three columns: measured by code, looked at by a model, and what needs a human.
 * findings: each failure by class. verdict: PASS, REWRITE or DO NOT SEND as a code, null while the review is incomplete
 * (review.line "Review incomplete: this is not a review."). result and coverage only where the run had client files: a
 * result is partial unless coverage is complete. generatedBy: what made it; stale once the draft changed after it.
 */
export interface DeliverableReport {
  measured: ReportItem[]; lookedAt: ReportItem[]; needsHuman: { code: string; line: Display }[];
  findings: { class: 'hard-error' | 'content' | 'creative'; id: string; line: Display }[];
  verdict: 'pass' | 'rewrite' | 'do-not-send' | null; verdictLine: Display;
  review: { complete: boolean; line: Display | null };
  result?: 'complete' | 'partial'; coverage?: CoverageView;
  generatedBy: ('code' | 'judge')[]; at: IsoTime; stale: boolean; staleLine: Display | null;
}

/**
 * One tool call on the run sheet. Ink v2 wave 4 (4F1, U7): state, on a call with measured times or one that never ran,
 * and ms, its measured time, only where both times were stamped.
 */
export type RunToolLine = { name: string; line: string; state?: 'done' | 'error' | 'cancelled'; ms?: number };

/**
 * Ink v2 wave 4 (4F1): usually, "Usually 3 to 5 min" from the last five finished runs of the same playbook steps, only
 * once three finished (U6); stop, a stop on its way (stopping) or done (stopped), in the engine's words (O1).
 * 4J3 (frames on run tiles): poster, on a YouTube delivery run only, the still kept from its order's cut (a small JPEG
 * data address, delivery/poster.ts), or null when none is kept; absent on every other run. venture.runs.list carries the
 * image (src) once per order, on its newest YouTube run, and src null on the others; venture.runs.get carries it whole.
 */
export interface RunSummary {
  runId: string; businessId: string; agent: string; purpose: string; state: RunState; startedAt: string; elapsed: Display;
  /** Completion and practice are recorded facts, so Work never infers them from a title or start date. */
  finishedAt?: IsoTime;
  practice?: true;
  /**
   * C5 task 4: the run's time apart: worked (elapsed less every wait for the owner) and waited (each span from the run
   * waiting to the next thing it did). Only on runs whose calls carry stamped times; an older run shows elapsed alone.
   */
  progress?: { done: number; total: number } | 'indeterminate'; result?: Display; receiptId?: string; estimate?: boolean;
  usually?: Display; stop?: { state: 'stopping' | 'stopped'; line: Display; trigger?: 'same-error' | 'same-action' | 'failures-in-row' };
  poster?: { uploadId: string; src: string | null } | null;
  /** 4H2 (U17): which engine wrote the run's draft, the line DeliveryRunView.writtenBy carries; absent before an answer. */
  writtenBy?: Display;
  /**
   * One-shot C4 task 12 (views/runs.ts runTimes): elapsed is the time the run worked, without its waits on the owner;
   * waited is those waits together, absent when the run's events show none; waitingSince is when the current wait on
   * the owner began, on a run waiting now.
   */
  waited?: Display;
  waitingSince?: IsoTime;
  /** One-shot C4 task 12: the client a delivery run worked for (never the own shop), for a link to the client sheet. */
  client?: { id: string; name: string };
  /** One-shot C4 task 17: on an improvement run, its kept version still waits to be adopted (Work's row links to Use this version). */
  adoptReady?: true;
}

/**
 * screen: one line saying what the untrusted screen noted in the run's outside content, never the words (W1 H9).
 * Ink v2 wave 4 (4F1): scope, frozen when the run started (O21); steer, the owner's notes for the next turn (O3); gate,
 * the round gate (O2); live, the calls of the turn in flight, from the run.call events (U7).
 */
export interface RunDetail extends RunSummary {
  agentProgress?: {
    canResume?: boolean;
    cost?: {display:string;state:'priced'|'unknown';spendId:string;receiptId?:string};
    messages: { id: string; text: string; label: 'model-estimate' }[];
    tools: { id: string; name: string; status: 'running' | 'done' | 'failed' }[];
    model?: string;
    /** A2: sites this job stopped asking after three refusals in a row. */
    unavailableSites?: string[];
    pendingApproval?: { request: import('../agent-runtime/driver-types.ts').AgentApprovalRequest; digest: string };
  };
  steps: RunStep[]; question?: { id: string; text: string; choices?: string[]; card?: QuestionCard }; error?: string; screen?: Display;
  scope?: RunScopeView; steer?: { text: Display; at: IsoTime; line: Display }[];
  gate?: { on: boolean; every: 1 | 2 | 3 | 5; waiting: { round: number; reason: RoundGateReason; line: Display } | null };
  live?: { callId: string; state: 'start' | 'done' | 'error' }[];
  /** W6 6G5 (D44): the run's model receipt, on its own sheet (venture.runs.get) for delivery runs. */
  modelReceipt?: ModelReceiptView;
  /** 4F2 (O14): "How to fix it", only when the owner must act on a failed or breaker-stopped run. */
  fix?: Display;
  /** 4F2 (O14): the failure in the table's plain words, and codes for the screen's own words (English and Hindi). */
  failure?: { kind: RunFailureKind; line: Display }; fixKind?: FixKind;
  /** 4J3 (A17): the Delivered card, on an accepted or edited delivery run only (delivery/delivered.ts). */
  delivered?: DeliveredView;
  /**
   * 4J14 (Q8): on a run that acted outside, Success only when a code check of the real result passed, Not checked
   * without one, Failed when the agent gave up or the platform refused (delivery/outcomes.ts). Absent otherwise.
   */
  outcome?: { outcome: 'success' | 'not-checked' | 'failed'; line: Display };
  /** 4J14 (Q7, Q8): the draft's report, on a run with a draft, on its own sheet (venture.runs.get) only. */
  report?: DeliverableReport;
  /** 4J13 (H34): set when Chausar stopped while a step of this run was out; each step's state as it survived. */
  interrupted?: { at: IsoTime; line: Display; steps: { callId: string; state: RunStepState }[] };
  /** 4J13 (H30): what background jobs reported into this run, oldest first; warning when one named no sources. */
  reports?: { at: IsoTime; from: 'heavy-work' | 'research'; line: Display; sources: string[]; warning: Display | null }[];
}

/**
 * The Delivered card of an accepted run (4J3, A17). files: what the run handed over, made by its own tools (tables its
 * succeeded calls made, what the owner's own command-line tool left), each with its digest. changed: apart from those,
 * the files on the order that changed while the run went on, made by someone else; changedLine labels them "Changed
 * during this run, not proven to be the agent's." source is a code the screen words for itself (English and Hindi).
 */
export interface DeliveredView { line: Display; files: DeliveredFile[]; changed: DeliveredFile[]; changedLine: Display | null }

export interface DeliveredFile { id: string; name: Display; digest: string; at: IsoTime; source: 'table' | 'delegate' | 'order-file' | 'transcript' | 'poster'; line: Display }

/** A run's scope as the run sheet shows it (4F1): tools and outside actions in purpose words, the cap, the posture. */
/** 4F3: capReceiptId, the cap's receipt (views/row-receipts.ts); capRupees and capRate, the cap in rupees at the owner's own rate, only with a rate set. */
export interface RunScopeView { tools: Display[]; actions: Display[]; cap: Display; posture: Posture; line: Display; capReceiptId: string; capRupees?: Display; capRate?: Display }

export type Posture = 'rehearsal' | 'shadow' | 'approve-each' | 'auto-spot-check';

export interface AgentView {
  id: string; name: string; role: string; now: Display; posture: Posture; spend: Display;
  /** C7: an agent the owner hired: the day, its duties and what it reads. It owns no steps and always asks. */
  hired?: { line: Display; duties: string[]; reads: { read: string; why: string }[] };
  last?: { line: Display; receiptId?: string; estimate?: boolean };
  steps: { id: string; purpose: string; gate: 'auto' | 'hold'; floor: boolean }[];
  // Ink v2 wave 4 (4A1 unless named): the agent's department; 'code' for the code role and for Keeper; its state from
  // facts only; its health; the helper's parent (4J12); who set its posture (O16); whether it has a chat (4B1).
  department?: DepartmentId;
  kind?: 'agent' | 'code';
  state?: 'working' | 'waiting' | 'failed' | 'idle';
  health?: AgentHealth;
  parentId?: string | null;
  postureSetBy?: 'business' | 'agent';
  chat?: boolean;
}

export type VentureRunEventType = 'run.started' | 'run.step' | 'run.waiting' | 'run.done' | 'run.failed' | 'queue.changed'
  | 'agent.message' | 'chief.message' | 'proposal.created' | 'notify.new' | 'pipeline.changed' | 'run.stopped' | 'run.call' | 'keeper.ran'
  | 'chain.changed' | 'desk.changed' | 'idea.changed' | 'privacy.forgotten';

/** seq: the event's place in the business's log, so a client that reconnects replays the gap (4G1); count: on notify.new only. */
export interface VentureRunEvent { type: VentureRunEventType; businessId: string; runId?: string; at: string; seq?: number; count?: number }

/**
 * One-shot C3 task 9: what goes to the screens: a run event, or a `work.step` frame (work-progress.ts), which has no seq
 * and is never in the event log. businessId is '' before any business is open.
 */
export type VentureFrame = VentureRunEvent | import('../../work-progress.ts').WorkStepEvent;

// phase 2 views (SpendRow is in section 8c)
/**
 * Ink v2 wave 4 (4J1, O17): allowedBy, on an entry for a step that ran without asking: the saved rule, the agent and step
 * it is on (Stop always allowing is venture.team.gate { agentId, stepId, gate: 'hold' }), and the rule's record id.
 */
export interface JournalEntry {
  id: string; action: string; target: string; state: 'described' | 'approved' | 'applied' | 'rejected' | 'outcome_unknown'; at: string; line: Display; receiptId?: string;
  allowedBy?: { rule: 'auto' | 'session'; agentId: string; stepId: string; ruleId: string | null };
  /** 4J10 (H27): how far it went after applied, as the provider reported, and how each target ended. Absent when none. */
  endState?: 'accepted' | 'processed' | 'shown' | 'result' | 'verified';
  targets?: { id: string; outcome: 'applied' | 'rejected' | 'partial' | 'unknown' | 'throttled'; line: Display }[];
}

/** dismissed: the owner said no to this suggestion (venture.evidence.dismiss); it stays in the ledger and leaves Today. */
export interface EvidenceItem { id: string; subject: string; field: string; value: Display; type: string; strength: 'verified' | 'strong' | 'weak'; claim: 'observed' | 'inferred' | 'needs-your-data'; source: string; applied: boolean; dismissed?: boolean }

/**
 * One piece of evidence for one field (P2-evidence, venture/evidence/). subject is 'business' or 'client:<id>'. type is
 * what code accepted; claimedType what was claimed (a claim with no matching tool result in its run is downgraded to
 * model-inferred and flagged). Only verified evidence overwrites a stored value on its own; the rest waits as a suggestion.
 */
export type EvidenceRecord = RecordBase<'venture-evidence'> & {
  subject: string;
  field: string;
  value: string; // '' for needs-your-data: Chausar cannot see the value
  type: string;
  claimedType: string;
  strength: EvidenceItem['strength'];
  scoreBp: number; // combined fixed weights, in basis points
  claim: EvidenceItem['claim'];
  source: string; // plain words: where it came from, or why it was not checked
  by: 'owner' | 'agent' | 'engine';
  runId: string | null;
  toolCallId: string | null;
  flag: string | null; // why the claimed type was not accepted
  applied: boolean; // this value is the stored one for its field
  appliedAt: IsoTime | null;
  /** When the owner dismissed this suggestion; absent or null while it stands. A dismissed one never comes back to Today. */
  dismissedAt?: IsoTime | null;
};

/** One owner decision on a Today row. Decide-once: a second decision on the same row id is refused. */
export type QueueDecisionRecord = RecordBase<'venture-queue-decision'> & {
  rowId: string;
  subject: string; // the thing the row stands for, the same across its versions
  digest: string; // the row digest the owner decided on
  action: QueueActionId;
  line: string;
  receiptId: string | null;
  decidedBy: string; // memberId of the person who decided
  /** 4J2 review: set when the owner undid this decision; Today then shows the row again and it can be decided anew. */
  undoneAt?: IsoTime | null;
};

/** 4J2 review: the owner opened one exact version of a Today row inside the app (venture.queue.view); a set needs one for each item that must be read first. */
export type QueueViewMarkRecord = RecordBase<'venture-queue-view'> & { rowId: string; rowDigest: string };

/** The gate on one agent step. The newest record per agent and step wins; no record means the default. */
export type TeamGateRecord = RecordBase<'venture-team-gate'> & { agentId: string; stepId: string; gate: 'auto' | 'hold' };

/** An agent's own posture (P2-posture). The newest record per agent wins; it can only tighten the business posture. */
export type AgentPostureRecord = RecordBase<'venture-agent-posture'> & { agentId: string; posture: Posture };

/**
 * One spot-check decision for a run at auto with spot checks (P2-posture). Every such run gets one, sampled or not, so
 * the ordinal is a plain count. A sampled run waits on Today for the owner to look at it.
 */
export type SpotCheckRecord = RecordBase<'venture-spot-check'> & {
  runId: string;
  agentId: string;
  ordinal: number; // 1 for the agent's first run at this posture
  spendMicros: MicroString;
  rule: { everyNth: number; overMicros: MicroString };
  sampled: boolean;
  reason: 'every-nth' | 'over-spend' | null;
  line: string; // plain words: why it was or was not picked
  review: { verdict: 'looks-right' | 'needs-work'; by: string; at: IsoTime } | null;
};

// ---------------------------------------------------------------------------
// 9c. Ink final pass: the views and actions the last screens need. app/ui mirrors them in app/ui/src/engine/types.ts.
// ---------------------------------------------------------------------------

/**
 * venture.queue.view: what a Today row is about, in words the owner reads before deciding (a draft's text and files, an
 * invoice, the plan, a CA sign-off request, a post's exact text). Text only; every figure arrives formatted.
 */
export interface QueueItemView {
  kind: 'draft' | 'file' | 'plan'; id: string; businessName: string; agent?: string;
  title: string; line?: Display;
  sections: { heading?: string; lines: Display[] }[];
  /** One-shot C4 task 16: on a draft, each amount its text holds, with its receipt or as a model estimate (delivery/deliverable.ts draftAmounts). */
  amounts?: { display: Display; receiptId?: string; receiptKind?: 'work'; estimate?: true }[];
}
