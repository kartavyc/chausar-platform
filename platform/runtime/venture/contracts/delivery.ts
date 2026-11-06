// Venture delivery contract. Types only; public imports use ../contracts.ts.
import type { CHECK_IDS, JUDGE_QUESTIONS, DELIVERY_REASONS, TOOL_NAMES, ATTRIBUTION_LEVELS, PLAYBOOK_PATCH_OPS, DELEGATE_CLIS } from '../contract-values.ts';
import type { PlaybookOrigin } from '../playbook-origins.ts';
import type { SectionRef, TableStamp } from '../playbooks/ca-firm/rates.ts';
import type { CaEngine, CaReceiptStep } from '../playbooks/ca-firm/receipt.ts';
import type { ReportReceipt } from '../playbooks/social/report.ts';
import type { DateRef, ModelPresetId, ModelPreview, ModelTier } from './models.ts';
import type { ConnectorModeName } from './build.ts';
import type { IsoDate, IsoTime, Json, MicroString, MinorString, RecordBase, ServiceType } from './business.ts';
import type { PriceFigure } from './money.ts';
import type { JudgeRuleResult, Posture } from './queue.ts';
import type { DraftFix, DraftMerge, DraftRevision } from './records.ts';
import type { Display } from './spend.ts';

// ---------------------------------------------------------------------------
// 8. Delivery agents, rehearsal (simulation), launch ladder, signals (P5)
// ---------------------------------------------------------------------------

/** 'work' is hands-on work with tools (files, the sandbox, the calculator); it never writes to the client. */
export type StepKind = 'gather' | 'question' | 'work' | 'compute' | 'write' | 'verify' | 'approve' | 'operator';

/** 'owner-cli': the owner's own Claude Code or Codex on this computer, started only after the owner approves a brief. */
export type ExecutionTier = 'code' | 'actor' | 'wasm-lite' | 'wasm' | 'container' | 'owner-cli' | 'hosted';

export type CheckId = typeof CHECK_IDS[number];

export type PlaybookStep = {
  id: string;
  kind: StepKind;
  title: string;
  tier: ExecutionTier; // the lowest tier that can do the step
  model: ModelTier | null; // null for code steps
  doneBy: 'agent' | 'you' | 'agent-then-you';
  requiredSections: string[]; // write steps only
  checks: CheckId[];
  /** Tools this step may call. Deny by default: a tool not named here is refused. Absent on older records. */
  tools?: ToolName[];
  /** Extra instructions for this step, words only. The improvement loop adds and removes these. */
  guidance?: string[];
  /**
   * Ink v2 wave 4 (4J12 validates them, 4F2 skips an optional step under budget pressure; no shipped step has them in
   * W4): skipped first under pressure; edges to the next step by outcome; a loop cap and what happens past it; a
   * timeout with an ordered list of steps to fail over to.
   */
  optional?: boolean;
  next?: StepEdge[];
  maxLoops?: number;
  onExceeded?: 'blocked' | 'failed';
  timeoutMs?: number;
  failover?: string[];
  /**
   * 4J12 (H23): an approval step's gate. When the owner has not decided within timeoutMs, the run ends with the
   * default: blocked or failed, never approved (a gate that times out never decides for the owner).
   */
  gate?: { timeoutMs: number; default: 'blocked' | 'failed' };
  /**
   * Ink v2 wave 4 (4F1, O21): the connector modes an agent step needs, by catalogue id. A run whose agent step needs a
   * mode that is only planned does not start (RUN_CAPABILITY_MISSING); nothing is put in its place.
   */
  needs?: { connector: string; mode: ConnectorModeName }[];
};

/** One edge from a step to the next by its outcome (4J12). */
export type StepEdge = { on: 'done' | 'failed' | 'blocked' | 'timeout'; to: string };

export type PlaybookRecord = RecordBase<'venture-playbook'> & {
  version: number;
  hash: string; // digest of steps (format 2: of steps, limits and aliases); recorded on every run
  blueprintDigest: string;
  serviceType: ServiceType;
  steps: PlaybookStep[];
  validated: true;
  tierCeiling: ExecutionTier;
  /** 2 for playbooks with agent tools. Older records have no format and are rebuilt on first use. */
  format?: 2;
  limits?: HarnessLimits;
  /** Extra words that find a dictionary entry, by entry id. Model-specific exposure, changed by the improvement loop. */
  aliases?: Record<string, string[]>;
  /** The patches applied on top of the plan's steps, oldest first. A rebuild for a changed plan applies them again. */
  patches?: PlaybookPatch[];
  parentId?: string | null; // the version this one was patched from
  /** 'owner': a version the owner's own words made from chat ("from now on", 4B1). */
  origin?: PlaybookOrigin;
  /**
   * The flagship playbook whose typed steps these are (venture/playbooks/steps.ts), for a plan that playbook made.
   * Its checks run on every draft (playbookChecks) and its roles are the team. Absent on the eight fixed steps.
   */
  flagship?: string;
};

export type TextPart =
  | { kind: 'text'; text: string }
  | { kind: 'figure'; receiptId: string; figureKey: PriceFigure['key'] | WorkFigureKey }
  | { kind: 'date'; dateRef: DateRef; iso: IsoDate };

/** Work that code rendered from a work receipt and attached after the agent's words. */
export type DeliverableAttachment = { kind: 'reconciliation'; receiptId: string };

/** A draft reply. Never called a deliverable on screen: agents in this build only draft. */
export type Deliverable = {
  title: string;
  sections: { heading: string; parts: TextPart[] }[];
  questionsForClient: string[];
  attachments?: DeliverableAttachment[];
  /** True when the model's words hold a number: shown as a model estimate. Only figure parts carry receipts. */
  estimate?: true;
  /**
   * Ink v2 wave 4 (4J16, Q4): the quotes code moved to their time in the transcript before the checks (round 1 of the
   * quote check, playbooks/draft-checks.ts withQuoteFixes), one line each. Set by code only; absent when none moved.
   */
  quoteFixes?: string[];
};

/** notChecked: rules-judge only, when no rule was settled by a vote with checked evidence. It is not a pass, and not a failure either. */
export type CheckResult = { check: CheckId; passed: boolean; detail: string; notChecked?: true };

/**
 * One deterministic check of a flagship playbook on a draft (venture/playbooks/draft-checks.ts), run by code with no
 * model. 'not-run' says why it could not run (no cut, no transcript, ffmpeg not here); it is never a pass. A 'fail'
 * blocks Accept like a failed CheckResult.
 */
export type PlaybookCheckResult = { playbook: string; check: string; outcome: 'pass' | 'fail' | 'not-run'; detail: string };

export type Scenario = {
  id: string;
  serviceType: ServiceType;
  title: string;
  persona: string;
  brief: string;
  expectedOutcome: string;
  stoppingCriteria: ('deliverable-ready' | 'client-asks-for-person' | 'turn-limit')[];
  turnLimit: number; // 1 to 4
  episodes: number; // 1 to 3
  mocks: Record<string, 'record-only'>;
  checks: CheckId[];
  source: 'template' | 'signal';
  signalId: string | null;
  /** Practice files this made-up client sends; the agent loop works on them. Absent when there are none. */
  files?: string[];
  /**
   * Ink v2 wave 4 (4J16, Q15): on a case made from the owner's edit or send-back, what a practice draft must and must
   * not do, made by code from the review (delivery/corrections.ts). Absent on other cases.
   */
  expectations?: CorrectionExpectation[];
};

/** 4J16 (Q15): one typed expectation of a regression case. Its words come from fixed lists and headings, never the client's. */
export type CorrectionExpectation =
  | { kind: 'mentions'; text: string } | { kind: 'not-mentions'; text: string }
  | { kind: 'hands-off'; to: 'client' | 'owner' } | { kind: 'uses-tool'; tool: string } | { kind: 'cites'; what: 'figure' };

/** 4J16: an expectation checked on a practice draft; 'not-checked' for a template outline or a check that cannot run. */
export type ExpectationResult = { expectation: CorrectionExpectation; outcome: 'pass' | 'fail' | 'not-checked'; detail: string };

export type JudgeQuestionId = typeof JUDGE_QUESTIONS[number];

/** estimate: true when the judge's reason holds a number it wrote; never a receipt. */
export type JudgeAnswer = { question: JudgeQuestionId; answer: 'yes' | 'no' | 'unsure' | 'not-judged'; reason: string; callId: string | null; estimate?: true };

export type EpisodeTurn = { turn: number; by: 'client' | 'agent'; text: string; author: 'model' | 'template'; callId: string | null };

export type MockEffect = { connector: string; operation: string; payloadDigest: string; recordedAt: IsoTime };

export type Episode = {
  scenarioId: string;
  index: number;
  turns: EpisodeTurn[];
  deliverable: Deliverable | null;
  renderedText: string | null;
  mocks: MockEffect[];
  checks: CheckResult[];
  judge: JudgeAnswer[];
  passed: boolean;
  firstFailure: string | null;
  costMicros: MicroString;
  /** The agent's turns, tool calls and work when the practice client sent files. Absent or null otherwise. */
  harness?: HarnessState | null;
  /** A flagship playbook's own checks on this practice draft; a 'fail' fails the episode. Absent for other playbooks. */
  playbookChecks?: PlaybookCheckResult[];
  /** 4J16 (Q15): the case's expectations from the owner's corrections, checked on this draft; a 'fail' fails the episode. */
  expectations?: ExpectationResult[];
};

export type SimulationRunRecord = RecordBase<'venture-simulation-run'> & {
  playbookId: string;
  playbookHash: string;
  scenarioIds: string[];
  episodes: Episode[];
  passed: boolean;
  summary: { scenarios: number; passed: number; failed: number };
  costMicros: MicroString;
  costDisplay: string;
  startedAt: IsoTime;
  finishedAt: IsoTime;
  modelMode: 'model' | 'template' | 'mixed';
};

export type DeliveryReason = typeof DELIVERY_REASONS[number];

/**
 * 'needs-answer': the agent handed off with a question, and the run waits for the owner's answer. 'brief-waiting': the
 * agent asked for heavy work, and the run waits for the owner to approve or decline the exact brief.
 */
/** 'stopped': the owner stopped it, or a breaker did (Ink v2 wave 4, 4F1 and 4F2); finished steps are kept and Resume goes on. */
export type DeliveryRunStatus = 'waiting-for-you' | 'needs-answer' | 'brief-waiting' | 'ready-for-review' | 'accepted' | 'edited' | 'rejected' | 'failed' | 'stopped';

/** A run's immutable selected workflow, bound to its original base and intake. */
export type DeliveryWorkflow = {
  orderId: string; offerId: string; baseHash: string; intakeDigest: string; hash: string;
  steps: PlaybookStep[]; limits: HarnessLimits; aliases: Record<string, string[]>;
  dictionary: { id: string; kind: 'term' | 'offer' | 'step' | 'approval' | 'setting' | 'definition' | 'concept'; name: string; meaning: string; aliases: string[] }[];
};

export type DeliveryRunRecord = RecordBase<'venture-delivery-run'> & {
  agentJob?: {
    scope: import('../agent-runtime/driver-types.ts').AgentJobScope;
    sourceDigest: string;
    draftDigest: string | null;
    /** The native tool and automatic quality review settled before owner acceptance. */
    reviewReady?: boolean;
    /** A2: the job went quiet and was stopped by the watchdog; its notes so far are kept. */
    quiet?: boolean;
    /** A2 second review: with quiet, the watchdog stopped the job because it ran past its time limit. */
    overtime?: boolean;
    /** A2: sites that refused three times in a row and were not asked again in this job (build/site-breaker.ts). */
    unavailableSites?: string[];
    failure?: import('../delivery/failure-words.ts').FailureWords;
    recalled?: string[];
    sourcesRead?: { id: string; version: string }[];
    screens?: { tool: string; note: ScreenNote }[];
    proposal: import('../agent-runtime/job-tools.ts').JobProposal | null;
    proposalAt?: string;
    messages: { id: string; text: string; label: 'model-estimate'; chatId?: string }[];
    ownerNotes?: { text: string; at: string; by: string }[];
    calculations?: ToolCallRecord[];
    pendingFacts?: { digest: string; missing: import('../playbooks/ca-firm/needs-facts.ts').MissingFact[]; question: string; callId: string; at: string };
    factAnswers?: { digest: string; question: string; answer: string; at: string; by: string; turn: number }[];
    tools: { id: string; name: string; status: 'running' | 'done' | 'failed' }[];
    model?: string;
    usage?: import('../agent-runtime/driver-types.ts').AgentUsage;
    cost?: { display: string; state: 'priced' | 'unknown'; spendId: string; receiptId?: string };
    /** W6 6G5: the AI the job ran on, written when it started: the preset (absent when the host did not name one), the model asked for and the tier. */
    route?: { presetId?: ModelPresetId; model: string; tier: ModelTier };
    pendingApproval?: { request: import('../agent-runtime/driver-types.ts').AgentApprovalRequest; digest: string };
  };
  careerPackBinding?: string;
  /** Exact owner-approved room brief this VA delivery read. */
  devReportBinding?: string;
  phoneReportBinding?: string;
  watchReportBinding?: string;
  triageReportBinding?: string;
  appTestingBinding?: string;
  vaBriefBinding?: string;
  /** Exact R2 source rows; proposed mappings remain owner-reviewed separately. */
  formsSourceBinding?: string;
  socialGhostwriting?: import('../playbooks/social/approvals.ts').GhostwritingState;
  workflow?: DeliveryWorkflow;
  orderId: string;
  /** Ink v2 wave 5 (5A1, playbooks/kit/chain.ts): the chain stage this run drafts, when the order is past its first; absent is stage 1. */
  chainStage?: number;
  playbookId: string;
  playbookHash: string;
  status: DeliveryRunStatus;
  servedBy: 'model' | 'template' | 'owner'; // 'template': an outline no AI wrote, that never read the client's request; 'owner': the owner's own copy (4J2)
  practice: boolean; // true for drafts made at the shadow stage: never copied, saved or accepted
  callId: string | null;
  preview: ModelPreview | null; // set while waiting for the owner to approve the send
  deliverable: Deliverable | null;
  renderedText: string | null;
  checks: CheckResult[];
  verdict: { choice: 'accepted' | 'edited' | 'rejected'; reason: DeliveryReason | null; at: IsoTime } | null;
  /**
   * One-shot C4 task 15: what a reject changed, so Undo puts it back exactly. Left out when the reject moved the order on
   * as well (a chain's stage), which Undo can't take back: only a reject with this can be undone.
   */
  rejectedFrom?: { verdict: DeliveryRunRecord['verdict']; editedText: string | null; practice: boolean } | null;
  editedText: string | null;
  /** The agent loop, for an order with files. Each model turn waits for the owner's approval of its exact text. */
  harness?: HarnessState | null;
  uploadIds?: string[]; // the client files this run may read, fixed when the run starts
  /** A flagship playbook's own checks on the draft; a 'fail' blocks Accept. Absent for other playbooks. */
  playbookChecks?: PlaybookCheckResult[];
  /**
   * The rules judge on this real-order draft. Its call carries the client's words: it goes on its own only under the
   * business's standing consent (judgeAuto, auto: true), else it waits for the owner to send it (venture.delivery.judge,
   * then judgeSend). Its verdict is the rules-judge result in checks. Absent until the judge was asked.
   * draftDigest: the draft it read (judged once per draft); estimatedMaxCostDisplay: the most the call could cost, as
   * the model port wrote it; line: why it did not run or failed, in plain words, else null.
   */
  judge?: {
    status: 'waiting' | 'done' | 'failed'; callId: string | null; preview: ModelPreview | null; at: IsoTime;
    draftDigest?: string; auto?: boolean; estimatedMaxCostDisplay?: string | null; line?: string | null;
    /** 4J14 (Q7): each rule's result as code counted it when the judge answered (judge-run.ts); absent before 4J14. */
    rules?: JudgeRuleResult[];
    /**
     * 4J13 (H30): the automatic judge waits while the owner works on the desktop with a local or busy AI (status
     * 'waiting', no preview, line "Waiting: ..."); the cost bound its approval showed, kept so the sweep's retry goes
     * on its own only within it. Absent otherwise.
     */
    deferred?: { boundMicros: string | null; bound: string };
  };
  /**
   * Set by the commit that makes a draft ready when its write turn's approval showed the judge's notice: the judge is
   * due, so Accept waits until it was asked or until (delivery/runs.ts judgeReading). boundMicros: the most the judge's
   * check could cost as shown (bound is its words), null when no price was known; the judge goes on its own only within
   * it. Cleared once the judge was asked.
   */
  judgePending?: { boundMicros: string | null; bound: string; until: IsoTime } | null;
  /** Ink v2 wave 4 (4F1, O21): what this run may do, frozen when it started. Absent on runs made before. */
  scope?: RunScope;
  /** Ink v2 wave 4 (4F2, H32): when an AI-written draft was kept, stamped in that commit; the drafts cap counts these. */
  readyAt?: IsoTime;
  /**
   * Ink v2 wave 4 (4J1, J2): what the owner's Accept or edit covered, file by file (file id to sha256 of its bytes), set
   * when the draft hands over files; a share, post or send of them is FILE_CHANGED once any byte differs.
   */
  manifest?: FileManifest | null;
  /**
   * 4J1: the times a changed file cleared the owner's acceptance and sent the draft back for review, when the last one
   * was and which files had changed; Today's review row takes a new version from it. Absent until it first happens.
   */
  reopened?: { count: number; at: IsoTime; files: string[] };
  /** 4J13 (H34): the lease an approved call holds on its run while it is out; renewed while it runs; absent or null otherwise. */
  lease?: RunLease | null;
  /** 4J13 (H34): set when Chausar stopped while an approved call ran: the run went back to waiting and nothing was sent again. */
  interrupted?: RunInterruption;
  /** 4J13 (H30): what background jobs reported into this run, once each by message id (the delivery marker). */
  reports?: RunReport[];
  /** Ink v2 wave 4 (4J18): a one-step draft's sources from what the AI knows, by id, as its approved text carried them. */
  knowledge?: string[];
  /** 4J2 (O5): a send-back or fix waiting for its revision turn to land; null or absent otherwise (delivery/revise.ts). */
  revision?: DraftRevision | null;
  /** 4J2 (O6): the paragraph merge made when the last revision landed; editedText holds its result when it differs. */
  merge?: DraftMerge | null;
  /** 4J2: the last fix's checks run again on the revised draft, and the fix's status. */
  fix?: DraftFix | null;
  /** 4J2 review: the draft that went out which this owner draft was copied from (venture.delivery.copy). */
  copiedFrom?: string;
};

/**
 * 4J13 (H34): an approve call's lease on its run. holder: the engine process that took it; callId: the call it covers;
 * expiresAt: the dated recheck, renewed while the call runs; reason: why the run is held, in plain words.
 */
export type RunLease = { holder: string; token: string; callId: string; takenAt: IsoTime; expiresAt: IsoTime; reason: string };

/**
 * 4J13 (H34): every step state of an interrupted run: the stored calls of its earlier turns (done, error, or skipped when
 * cancelled), then the cut turn's from its run.call events (running: it never came back; done; error). The cut turn's
 * calls that had not started are not listed: the turn's plan reaches the vault only when the turn commits, so a call
 * still pending at the crash is not known to anyone. Steps of the playbook not reached show as pending on the run sheet.
 */
export type RunInterruption = { at: IsoTime; line: string; callId: string; steps: { callId: string; state: RunStepState }[] };

/** 4J13 (H34): one step's state, as it survives a restart. */
export type RunStepState = 'pending' | 'running' | 'done' | 'error' | 'skipped';

/** 4J13 (H30): one report a background job delivered into the run that asked; warning: set when it named no sources. */
export type RunReport = { messageId: string; from: 'heavy-work' | 'research'; at: IsoTime; line: string; sources: string[]; warning: string | null };

/** The files one Accept covered (4J1): file id to sha256 of its bytes, who accepted and when. */
export type FileManifest = { files: Record<string, string>; at: IsoTime; by: string };

/**
 * A run's scope (4F1): the tools granted, the ones that propose an outside action for the owner's approval, the spend
 * cap and the posture it works at, as they were when the run started.
 */
export type RunScope = { tools: ToolName[]; actions: ToolName[]; capMicros: MicroString; posture: Posture; frozenAt: IsoTime };

/**
 * A delivery run as the screens read it: the stored record plus what the engine would allow right now, at today's
 * launch stage. Never stored.
 */
export type DeliveryRunView = DeliveryRunRecord & {
  practiceNow: boolean; // a practice draft at today's stage: never accepted, copied or saved
  awaitingYou: boolean; // belongs on Today's list of things waiting for the owner
  canApprove: boolean; // waiting for the owner, and the engine would send it if approved now
  canAccept: boolean; // ready for review, and the engine would take Accept now
  acceptBlocked: string | null; // why Accept is refused, in plain words; null when canAccept or the run is not ready
  /**
   * One-shot A3 (S2): ready for review and the owner may edit it on Today: not practice, its AI work handed over, not
   * held for the quality check, the CA's sign-off or its files. A draft whose only block is a failed check may be edited,
   * and the owner's own version is then not held to the agent's failed checks.
   */
  canEdit: boolean;
  /**
   * On a waiting write turn when the judge would then read the draft on its own and no standing consent is recorded:
   * the setting's words and what the judge's check could cost, read before approving (delivery/judge-run.ts). Set by
   * the delivery methods and Today; absent or null otherwise.
   */
  judgeNotice?: string | null;
  /** 4H1 (U17): which engine wrote the draft ("Written by Claude Sonnet 5.5", or the template's words); null before an answer. */
  writtenBy?: Display | null;
};

export type SignalRecord = RecordBase<'venture-signal'> & {
  source: 'owner-rejected' | 'owner-edited' | 'check-failed';
  runId: string;
  /** Also the id of the first rule the rules judge failed a real draft on (a JudgeRule id, judge-run.ts). */
  reason: DeliveryReason | CheckId | (string & {}) | null;
  scenarioId: string | null; // set once turned into a rehearsal case
  /** One-shot C4 task 15: the owner took back the reject this came from. Nothing reads it from then on (liveSignals). */
  withdrawnAt?: IsoTime | null;
};

export type ImprovementReadiness = {
  judged: number;
  rejectedOrEdited: number;
  due: boolean; // at least 10 judged with at least 3 rejected or edited, or 14 days with any judged
  reason: string;
  status: 'available' | 'planned'; // 'available' since the gated improvement loop (venture.improve.*) landed
};

/**
 * Wave 6 (6C4 / D19): the two stages the owner sees, Practice and Live (you approve each). The vault keeps its older
 * stage names (core/launch-stage.ts maps them); the unfinished stages are never listed.
 */
export type LaunchStatus = {
  stage: 'practice' | 'live';
  liveSince: IsoTime | null;
  stages: { stage: 'practice' | 'live'; allowed: boolean; reason: string; current: boolean }[];
  acceptedDeliveries: number;
  improvement: ImprovementReadiness;
};

export type CapabilityState = 'available' | 'needs-setup' | 'unverified' | 'planned' | 'unavailable';

export type CapabilityStatus = { id: string; group: 'runtime' | 'storage' | 'sandbox' | 'models' | 'connectors'; label: string; state: CapabilityState; reason: string };

export type ToolName = typeof TOOL_NAMES[number];

/**
 * read: looks and changes nothing. compute: the calculator, which answers with receipts. sandbox: agent-written code
 * in a sandbox. handoff: asks a person and ends the turn. outside-write: only ever recorded for the owner's approval.
 * delegate: writes a brief for the owner's own command-line tool; nothing starts until the owner approves it.
 */
export type ToolEffect = 'read' | 'compute' | 'sandbox' | 'handoff' | 'outside-write' | 'delegate';

/** One execution outcome type, as agentOS has it. */
export type ExecutionOutcome = 'succeeded' | 'failed' | 'cancelled' | 'timedOut';

export type ToolError = { code: string; name: string; message: string; details?: Json };

/** What every tool returns to the agent: the agentOS host-function envelope. */
export type ToolEnvelope = { ok: true; result: Json } | { ok: false; error: ToolError };

export type ToolCallRecord = {
  id: string;
  turn: number;
  tool: string; // as the model asked, even when unknown or refused
  input: Json | null; // the parsed input; null when it did not parse
  inputDigest: string;
  envelope: ToolEnvelope;
  outcome: ExecutionOutcome;
  effect: ToolEffect | null; // null for an unknown tool
  tier: ExecutionTier | null;
  receiptIds: string[]; // work receipts this call made
  tableIds: string[]; // tables this call made
  /** When the call started and finished, for the step times the runs view shows. Absent on calls that never ran and on runs made before step times. */
  startedAt?: IsoTime;
  finishedAt?: IsoTime;
  /** The label on what the call returned (policy/taint.ts): untrusted when it carries outside content. Absent on calls that never ran. */
  integrity?: ResultIntegrity;
  /** What the untrusted screen found in the result (policy/untrusted.ts). Absent when it found nothing or did not run. */
  screen?: ScreenNote;
  /**
   * Ink v2 wave 4 (4J1, O17): the call ran without asking, allowed by a saved rule: the step's Auto setting ('auto') or
   * the owner's allow for this session ('session'). The decision record (journal/decisions.ts) reads it. Absent otherwise.
   */
  allowedBy?: { rule: 'auto' | 'session'; stepId: string | null };
};

/** Whether a result can be trusted: untrusted once it carries outside content (a client file, a tool's output). */
export type ResultIntegrity = 'trusted' | 'untrusted';

/** The screen's note on one result: its mode, what it decided, the digest a release binds to, and what it found where. */
export type ScreenNote = {
  mode: 'observe' | 'enforce';
  status: 'clean' | 'flagged' | 'quarantined' | 'released';
  digest: string;
  findings: { kind: string; what: string; at?: string }[];
};

/**
 * When outside content first entered a run (the taint latch). Once set it stays for the rest of the run. A real order
 * is latched from its first turn: the client's request and file names are outside content (client-request).
 */
export type TaintMark = {
  turn: number;
  source: 'client-request' | 'client-file' | 'mail' | 'post' | 'web-page' | 'tool-output' | 'client-answer';
  toolCallId: string | null;
  tool: string | null;
};

export type AgentTurnRecord = {
  turn: number;
  step: 'act' | 'write';
  note: string; // words only; never the model's private reasoning
  calls: { tool: string; input: string }[];
  finished: boolean;
  forced: boolean; // the last allowed step: tools off, say what was found and what is left
  by: 'model' | 'template';
  callId: string | null;
  costMicros: MicroString;
  /** Ink v2 wave 4 (4B2): the notes this turn's input carried, by id; absent when it recalled none. */
  recalled?: string[];
  /** Ink v2 wave 4 (4J18): the sources from what the AI knows this turn's input carried, by id; absent when none. */
  knowledge?: string[];
  /** Ink v2 wave 4: the playbook role whose step this turn worked on (4A1 departments, 4B1 threads). */
  role?: string;
};

/** screen: what the untrusted screen found in a client's answer the owner relayed (policy/untrusted.ts); absent when nothing. */
/**
 * 4J13 (A13): expiresAt, when the question stops being answerable (24 hours unless the playbook says otherwise); null:
 * it never expires (a NEEDS_FACTS hand-off, 4J16: the facts are needed however long they take); absent on older runs.
 * answeredBy 'timeout': nobody answered in time, so Chausar closed it and declined any held call. Never the owner's no.
 */
/** card (4J17, A14): the question card the agent asked, when it offered answers or asked a round of questions. */
export type HandoffRequest = { to: 'client' | 'owner'; question: string; turn: number; answer: string | null; answeredBy: 'owner' | 'practice-client' | 'timeout' | null; screen?: ScreenNote; choices?: HandoffChoice[]; expiresAt?: IsoTime | null; card?: QuestionCard };

/**
 * One choice an agent offers with its question to the owner (Ink v2 wave 4: 4J3 shows them on Today's card, 4J17's
 * questions fill them). label: a short name such as 'A'; text: the option in the agent's words; estimate: a figure the
 * model wrote about it ("Views in 30 days": "12,000 to 18,000"), which is only ever shown as a model estimate.
 * gains, costs, recommended (4J17): what the choice gains and costs, in the agent's words, and the agent's pick (first).
 */
export type HandoffChoice = { label: string; text: string; estimate?: { label: string; value: string }; gains?: string; costs?: string; recommended?: boolean };

/**
 * 4J17 (A14): questions done well. A card holds one question with answers to pick from, or a round of two to eight
 * related questions, each with the agent's best guess, so one short reply answers them all ("1 yes, 2 B"). Answers
 * list the agent's pick first, each with what it gains and costs; free text is always open, with an escape. Every word
 * passed the untrusted screen and the money check (agents/questions.ts) before it was stored.
 */
export type QuestionOption = { label: string; text: string; gains: string; costs: string; recommended: boolean };

export type QuestionItem = { number: number; text: string; guess: string; options: QuestionOption[] };

export type QuestionCard = { round: number; lead: string; items: QuestionItem[]; freeText: true; escape: string; example: string };

/** What a tool run proves. A draft may say work was done only when a proof of that kind exists. */
/** 'delegated': the owner's own tool ran on the order's files. It backs no claim of finished work on its own. */
export type ClaimProofKind = 'file-read' | 'transformed' | 'totals' | 'matched' | 'reconciled' | 'balanced' | 'delegated';

export type ClaimProof = { kind: ClaimProofKind; toolCallId: string; receiptId: string | null; tableId: string | null };

export type HarnessLimits = {
  maxTurns: number; // act turns before the forced last step
  maxToolCalls: number;
  maxCallsPerTurn: number;
  maxCostMicros: MicroString; // this run's model spend cap, on top of the monthly limit
  keepOutputs: number; // the newest tool results the model sees whole; older ones shrink to stubs
  stubChars: number;
  /** 4J12 (H23): the run's deadline, from its start. Past it the run ends blocked. Absent on every shipped playbook. */
  deadlineMs?: number;
};

export type HarnessState = {
  /** Deterministic prerequisites completed before a writing preview, with no model turn. */
  codePrerequisites?: {tool:'social.report'|'seller.shortlist'|'seller.catalogueSheet'|'seller.multiStore';result:Json}[];
  version: 1;
  phase: 'act' | 'write' | 'needs-answer' | 'brief' | 'done' | 'stopped'; // 'brief': a heavy-work brief waits for the owner
  limits: HarnessLimits;
  used: { turns: number; toolCalls: number; costMicros: MicroString };
  grant: ToolName[]; // fixed from the playbook when the run starts; every other tool is refused
  turns: AgentTurnRecord[];
  toolCalls: ToolCallRecord[];
  handoffs: HandoffRequest[];
  uploadIds: string[];
  tableIds: string[];
  workReceiptIds: string[];
  proofs: ClaimProof[];
  sections: 'reply' | 'report'; // 'report' once a tool run proved a work product
  stopReason: string | null; // plain words when the loop stopped early
  mocks: MockEffect[]; // outside writes the agent proposed: recorded, never carried out
  delegations?: DelegationRequest[]; // heavy-work briefs, in order; absent on runs made before heavy work
  rounds?: AuditRound[]; // the round ledger, one entry per act turn; absent on runs made before the auditor
  holds?: PolicyHold[]; // tool calls the policy held for the owner (P2-posture); absent until one is held
  taint?: TaintMark; // when outside content first entered the run; absent until then, never cleared (policy/taint.ts)
  capWindows?: CapWindow[]; // room the owner allowed past the run's spend cap, one per approval on Today; absent until one
  // Ink v2 wave 4 (run controls and breakers, 4F1 and 4F2); each absent until used.
  control?: RunControl; // a stop the owner asked for, read between calls so it works while a turn runs
  alreadyTried?: AlreadyTried[]; // what failed before a breaker stop, carried into the next turn on Resume
  steer?: SteerNote[]; // the owner's words for the next turn, each used once
  gate?: RoundGate; // the owner's gate after each round (or every few rounds)
  repairs?: RepairTurn[]; // the one repair turn a badly shaped answer gets
  workedMs?: number; // 4F1: the time the run's approved turns took to run, summed; time waiting on the owner is not counted
  breaker?: BreakerTrip; // 4F2: the newest time the repeat-failure breaker stopped the run; the breaker counts calls after it
};

/**
 * The repeat-failure breaker stopping a run (4F2, H22): which rule tripped, the run's line in plain words, the error
 * that kept coming back, the call it tripped on (the breaker counts only the calls after it from then on), and the
 * "How to fix it" words when the owner must act.
 */
export type BreakerTrip = { trigger: BreakerTrigger; line: string; error: string; callId: string; at: IsoTime; fix: string | null; fixKind?: FixKind | null };

/** 4F2: which rule of the repeat-failure breaker stopped a run. */
export type BreakerTrigger = 'same-error' | 'same-action' | 'failures-in-row';

/** 4F2 (O14): the kind of an AI call's failure, for the screen's own words (English and Hindi). */
export type RunFailureKind = 'allowance-spent' | 'not-signed-in' | 'offline' | 'too-long' | 'out-of-date' | 'unknown' | 'plan-used-up' | 'rate-limited' | 'step-limit' | 'connection-dropped' | 'model-missing';

/** 4F2 (O14): what the owner does to fix a failure, as a code the screen words for itself. */
export type FixKind = 'raise-limit' | 'sign-in' | 'run-again-online' | 'split-work' | 'update-tool' | 'install-ffmpeg' | 'set-up-docker' | 'get-python-image' | 'set-up-cli' | 'wait-for-plan' | 'run-again' | 'choose-model' | 'wait-a-minute';

/**
 * A stop the owner asked for (4F1). force: the step in progress is thrown away; else the call in progress finishes.
 * cutCallId: the model call a force stop cut while it was out, until its turn comes back and is settled (its cost
 * counted, nothing it made kept); Resume waits for it. Absent or null otherwise.
 */
export type RunControl = { stop: { at: IsoTime; by: string; force: boolean } | null; stoppedAt: IsoTime | null; line: string | null; cutCallId?: string | null };

/** One thing a run tried before a breaker stopped it, in purpose words, and the error it met (4F2). */
export type AlreadyTried = { tool: string; tried: string; error: string };

/**
 * The owner's words for the agent's next turn (4F1 steer): at most 500 characters, used once, with the turn that took it.
 * callId: the preview whose text carried it last; only the turn that runs that call takes it.
 */
export type SteerNote = { text: string; at: IsoTime; by: string; pickedUpTurn: number | null; callId?: string | null };

/**
 * Why the round gate stopped to ask (4F1). 'needs-answer' is never set by the gate itself: a round that ends with a
 * question already waits on the owner through its question row on Today.
 */
export type RoundGateReason = 'finished' | 'limit' | 'needs-answer' | 'blocked' | 'failures';

/** The owner's gate after each round (4F1): on, how often, the round waiting on the owner, words for the next turn, extra turns allowed. */
export type RoundGate = {
  on: boolean; every: 1 | 2 | 3 | 5;
  waiting: { round: number; reason: RoundGateReason; line: string } | null;
  ownerNote: string | null; extraTurns: number;
};

/** The one repair turn a turn the model answered in the wrong shape gets (4F2, H35). */
export type RepairTurn = { turn: number; reason: string };

/** One more window of spend for a run, allowed by the owner on Today when its next call would have crossed its cap. */
export type CapWindow = { micros: MicroString; at: IsoTime; by: string };

/**
 * One tool call the policy held for the owner (venture/policy): it did not run. The owner's answer to its hand-off
 * decides it; an approval lets exactly that tool with that input run once, in the next act turn, and never again.
 */
export type PolicyHold = {
  id: string;
  toolCallId: string;
  tool: string;
  stepId: string | null;
  inputDigest: string;
  code: string; // the policy's reason code: step_on_hold, posture, floor, tainted
  reason: string; // plain words
  turn: number; // the act turn that asked
  handoff: number; // index of its hand-off in handoffs
  status: 'waiting' | 'approved' | 'declined' | 'used';
  validTurn: number | null; // the one act turn an approval covers
};

/**
 * The auditor's check of one step (one tool call): read-only, against the step's real output (the run's receipts and
 * tables, the client's files). Only audited steps count as progress or back a claim of finished work. evidence: the
 * ids of what it read. A step that was refused, failed or cancelled is kept here as evidence, not progress.
 */
export type AuditStep = { toolCallId: string; tool: string; audited: boolean; reason: string; evidence: string[] };

/** One round of the agent loop: the manager's plan (the act turn's note), each executor step with its audit, and how many were audited. */
export type AuditRound = { round: number; plan: string; steps: AuditStep[]; progress: number };

/** A file a client sent, kept in the vault. Its content is client data, except Chausar's made-up practice files. */
/** transcript: an SRT or VTT file of what was said, with timings (venture/playbooks/youtube/transcript.ts). */
/** image: a still from an order's cut (Ink v2 wave 4, 4J3), a JPEG kept only as the order's poster. */
/** image and audio (5A4): a client's photo, cleaned at intake, and a recording kept as it came (playbooks/kit/media-intake.ts). */
export type UploadFormat = 'docx' | 'csv' | 'xlsx' | 'pdf' | 'transcript' | 'image' | 'audio';

export type UploadRecord = RecordBase<'venture-upload'> & {
  name: string;
  format: UploadFormat;
  bytes: number;
  digest: string;
  contentBase64: string;
  /**
   * poster (4J3): the order's one still from its cut (delivery/poster.ts). Its own scope, so no agent tool, run file
   * list or order file count ever reads it as a file the client sent. media (5A4): an order's photos and recordings, in
   * their own scope for the same reason.
   */
  scope: { kind: 'order'; orderId: string } | { kind: 'practice'; scenarioId: string } | { kind: 'poster'; orderId: string } | { kind: 'media'; orderId: string };
  clientData: boolean;
  /**
   * Where it came from: the client, a transcript made on this computer from the client's footage, or a still taken
   * from the cut on this computer (4J3). Absent means the client.
   */
  origin?: 'client' | 'local-transcription' | 'poster' | 'client-link';
  /**
   * 4J7 (K9): the file request link it came through, when the client uploaded it there. Such a file's name is Chausar's
   * own ('client-upload-1.csv'), so no word the client chose reaches an agent; clientName keeps the client's name for
   * the owner, screened as untrusted (null when the screen held it or Forget erased it).
   */
  fileRequestId?: string;
  clientName?: string | null;
};

export type UploadView = Omit<UploadRecord, 'contentBase64'>;

/** Which run a table or a work receipt belongs to. */
export type WorkRunRef =
  | { kind: 'delivery'; runId: string }
  | { kind: 'rehearsal'; scenarioId: string; episode: number }
  | { kind: 'improvement'; runId: string; scenarioId: string };

export type WorkTableRow = { id: string; cells: Record<string, string> };

/**
 * A table a tool made: a sandbox program's output, bills picked from PDFs, or a table code computed from the client's
 * files (a ranked list of hooks, an edit list; tools.ts computedTable). Tables read from files are not stored.
 */
export type WorkTableRecord = RecordBase<'venture-work-table'> & {
  name: string;
  columns: string[];
  rows: WorkTableRow[];
  source:
    | { kind: 'transform'; fromTableId: string; tier: ExecutionTier; driver: string; programDigest: string; moduleDigest: string | null }
    | { kind: 'picked'; uploadIds: string[] }
    | { kind: 'computed'; tool: ToolName; uploadIds: string[] };
  runRef: WorkRunRef;
  digest: string;
};

/** 'total', 'opening', 'inflows', 'group-1' ... Each figure in a work receipt has a short key. */
export type WorkFigureKey = string;

/** unit 'percent': minor holds hundredths of a percent ('1234' is 12.34%). unit 'post': minor is '0' and display is the post's id. */
export type WorkFigure = { key: WorkFigureKey; label: string; minor: MinorString; display: string; currency: string; unit: 'money' | 'count' | 'percent' | 'post' };

export type WorkStep = { op: 'add' | 'subtract' | 'count' | 'compare' | 'match'; inputs: string[]; result: string; rule: string };

export type ReconciliationLine = { rowId: string; date: IsoDate | null; text: string; amountMinor: MinorString; display: string };

export type Reconciliation = {
  balanced: boolean; // the computed closing balance equals the statement's closing balance
  statementClosing: boolean; // false when the statement had no balance column, so balanced could not be checked
  matched: { bankRowId: string; billRowId: string; amountMinor: MinorString; display: string; bankText: string; billText: string; rule: 'agent-key' | 'bill-number' | 'amount-and-name' | 'amount-only' }[];
  unmatchedBank: ReconciliationLine[]; // money out with no bill
  unmatchedBills: ReconciliationLine[]; // bills with no payment in the statement
  moneyIn: ReconciliationLine[];
};

/** The calculator's answer for agent work. Every money figure is BigInt arithmetic on amounts code read from the file. */
/**
 * 'ca.engine': one of the CA firm's tax engines worked it (delivery/harness/tools-ca.ts), and ca keeps its whole
 * receipt. 'social.report': the report figures from a platform's exports (tools-social.ts), each kept in report.
 */
export type WorkReceiptRecord = RecordBase<'venture-work-receipt'> & {
  operation: 'work.sum' | 'work.totals' | 'work.reconcile' | 'seo.claim' | 'ca.engine' | 'social.report' | 'seller.compute' | 'youtube.compute'
    // W6 6F2: a calculator from an owner-added pack (packs/packs.ts)
    | 'pack.calc';
  runRef: WorkRunRef;
  currency: string;
  inputs: { tables: { id: string; name: string; digest: string }[]; columns: Record<string, string>; rowIds: string[] };
  steps: WorkStep[];
  figures: WorkFigure[];
  reconciliation: Reconciliation | null;
  allowedNumbers: string[];
  explanation: string; // built by code from the figures
  digest: string;
  /**
   * The CA engine's receipt, inputs included, so it can be worked again with the exact table versions it stamped
   * (venture.ca.receipt). caReceiptId is the engine's own receipt digest. Only on operation 'ca.engine'.
   */
  ca?: {
    engine: CaEngine | 'portal-diff'; inputs: Json; inputsDigest: string; caReceiptId: string;
    table: TableStamp | null; tables: TableStamp[]; sections: SectionRef[]; assumptions: string[]; openQuestions: string[]; working: Json;
    /** The engine's own steps (each figure with the section it rests on) and its explanation, so the stored receipt is whole. */
    steps?: CaReceiptStep[]; explanation?: string;
  };
  /** Each report figure's platform, month, formula and the export file, columns and rows it came from. Only on 'social.report'. */
  report?: Pick<ReportReceipt, 'platform' | 'month' | 'key' | 'formula' | 'inputs' | 'unit'>[];
};

export type AttributionLevel = typeof ATTRIBUTION_LEVELS[number];

export type PlaybookPatchOp = typeof PLAYBOOK_PATCH_OPS[number];

export type PlaybookPatch = {
  id: string;
  level: AttributionLevel;
  op: PlaybookPatchOp;
  stepId: string;
  value: string;
  note: { hypothesis: string; expectedFixes: string[]; likelyRegressions: string[] };
  /** 'owner': a change the owner's own words asked for in chat (4B1), checked under the owner rules of applyPatch. */
  proposedBy: 'model' | 'chausar' | 'owner';
  parentHash: string;
  /** An owner patch only (4B1): the message it came from and the owner's words, quoted. */
  source?: { messageId: string; quote: string };
};

export type ImprovementCase = { scenarioId: string; set: 'pool' | 'reserve' | 'rehearsal'; signalId: string | null };

export type CaseScore = { passed: boolean; checksPassed: number; checksRun: number; judgeYes: number; critical: string | null; firstFailure: string | null };

/** pairwise: the judge's preference between the two drafts, asked only when the scores tie and the drafts differ. */
export type GatePreference = { winner: 'parent' | 'candidate' | null; detail: string };

export type GateCase = { scenarioId: string; set: 'reserve' | 'rehearsal'; parent: CaseScore; candidate: CaseScore; winner: 'parent' | 'candidate' | 'tie'; pairwise?: GatePreference };

export type GateResult = {
  cases: GateCase[];
  wins: number;
  losses: number;
  ties: number;
  candidateCritical: number;
  newBlockFailures: number;
  decision: 'keep-candidate' | 'keep-parent';
  reason: string;
};

export type Diagnosis = {
  clusters: { reason: string; step: string; level: AttributionLevel; count: number }[];
  chosen: { reason: string; step: string; level: AttributionLevel } | null;
};

export type ImprovementRound = {
  round: number;
  diagnosis: Diagnosis;
  patch: PlaybookPatch | null;
  refused: string | null; // why code refused the patch before any spend, or why the round stopped
  candidateHash: string | null;
  gate: GateResult | null;
  /** Ink v2 wave 4 (4J16, Q16): the change this round tried, as an experiment (delivery/experiments.ts). Absent on older runs. */
  experiment?: ExperimentRecord;
};

/** 4J16 (Q16): the control of an experiment: the old version rehearsed on the same practice cases, from this window of signals. */
export type ExperimentControl = { kind: 'parent-on-same-cases'; playbookHash: string; cases: number; window: { from: IsoTime; to: IsoTime } };

/**
 * 4J16 (Q16): one change tried as an experiment. control null: no real control, so the result is only observed;
 * 'no-effect': a control, and no case won or lost. Displays are in rupees at the owner's rate, else USD.
 */
export type ExperimentRecord = {
  hypothesis: string; change: string; patchId: string; control: ExperimentControl | null;
  budget: { capMicros: MicroString; capDisplay: string; spentMicros: MicroString; spentDisplay: string };
  stopRules: string[]; rollbackRule: string;
  result: { kind: 'caused' | 'no-effect' | 'observed'; line: string };
  /** 4J22a (4J15, Q12): the change's lift on the same paired cases; null without a control; absent on older runs. */
  lift?: ExperimentLift | null;
};

/** The lift of one experiment (delivery/lift.ts): its line says model estimate when it concludes; digest is its receipt's. */
export type ExperimentLift = { cases: number; reachable: boolean; direction: 'better' | 'worse' | 'none'; estimate: boolean; line: string; digest: string };

export type ImprovementRunRecord = RecordBase<'venture-improvement-run'> & {
  status: 'kept-candidate' | 'kept-parent' | 'incomplete';
  parentPlaybookId: string;
  parentHash: string;
  candidatePlaybookId: string | null; // a new playbook version; the parent is never overwritten
  frozen: { pool: ImprovementCase[]; reserve: ImprovementCase[]; rehearsal: ImprovementCase[]; digest: string };
  rounds: ImprovementRound[];
  maxRounds: number;
  costMicros: MicroString;
  costDisplay: string;
  modelMode: 'model' | 'template' | 'mixed';
  incompleteReason: string | null;
  changes: string[]; // plain words for each change the candidate makes
  digest: string; // what the owner approves to adopt the candidate
  /** When the run began; its record is written when it ends. Absent on runs made before the runs view listed them. */
  startedAt?: IsoTime;
  /** The owner went back from this run's adopted version (venture.improve.rollback); it is not offered again. */
  rolledBack?: { at: IsoTime; by: string };
};

export type ImprovementStatus = {
  readiness: ImprovementReadiness;
  activePlaybookId: string | null;
  latest: ImprovementRunRecord | null;
  /** The newest kept candidate that is not adopted yet and still fits the current plan. */
  candidate: { runId: string; playbookId: string; digest: string; changes: string[] } | null;
  /**
   * The version in use (Ink v2 wave 2). rollback: what venture.improve.rollback takes to go back to the version it was
   * made from, with that version's number; null unless it came from an improvement run and the older one still fits.
   */
  inUse?: {
    playbookId: string; version: number; hash: string; origin: PlaybookOrigin;
    rollback: { playbookId: string; version: number; digest: string } | null;
  } | null;
};

/** The container tier's process port: Docker only, injected by tests. Nothing else runs through it. */
export type SandboxProcessRequest = { command: 'docker'; args: string[]; stdin: string; timeoutMs: number; maxOutputBytes: number };

export type SandboxProcessResponse = { exitCode: number | null; stdout: string; stderr: string; timedOut: boolean; truncated: boolean };

export type SandboxPorts = { process?: (request: SandboxProcessRequest) => Promise<SandboxProcessResponse> };

export type DelegateCli = typeof DELEGATE_CLIS[number];

export type DelegateProcessRequest = { command: string; args: string[]; cwd: string; env: Record<string, string>; stdin: string; timeoutMs: number; maxOutputBytes: number };

export type DelegateProcessResponse = { exitCode: number | null; stdout: string; stderr: string; timedOut: boolean; truncated: boolean };

/** Finds the installed tool and runs it. Tests inject a port that points at a fake command-line tool. */
export type DelegatePorts = {
  locate(cli: DelegateCli): Promise<string | null>;
  process(request: DelegateProcessRequest): Promise<DelegateProcessResponse>;
};

export type DelegateLimits = { minutes: number; maxTurns: number; budgetMicros: MicroString | null };

/**
 * One heavy-work request on a run. 'waiting' until the owner approves or declines the exact brief; 'running' while
 * the tool works; then 'declined' or 'finished'. The digest covers everything the owner approves.
 */
export type DelegationRequest = {
  toolCallId: string;
  turn: number;
  cli: DelegateCli;
  executable: string;
  version: string;
  briefText: string; // the exact text the tool gets, on standard input and as BRIEF.md
  uploadIds: string[]; // the files copied into the folder, nothing else
  limits: DelegateLimits;
  digest: string;
  status: 'waiting' | 'running' | 'declined' | 'finished';
  startedAt: IsoTime | null;
  delegateRunId: string | null;
};

/** What a heavy-work run left: files and a log, all untrusted. Money figures count only once the calculator recomputed them. */
export type DelegateOutput = { name: string; bytes: number; digest: string; text: string | null; note: string | null };

export type DelegateFigure = { label: string; claimed: string; receiptId: string | null; matches: boolean | null; note: string };

export type DelegateRunRecord = RecordBase<'venture-delegate-run'> & {
  runId: string;
  toolCallId: string;
  cli: DelegateCli;
  executable: string;
  version: string;
  approvedDigest: string;
  limits: DelegateLimits;
  outcome: ExecutionOutcome;
  exitCode: number | null;
  reason: string; // plain words, built by code
  outputs: DelegateOutput[];
  log: string; // the end of what the tool printed, untrusted
  reportedCost: string | null; // the cost the tool printed, as it printed it; untrusted; the spend ledger settles the run's reservation at it, labelled as the tool's own report
  figures: DelegateFigure[];
  uncheckedNumbers: number; // numbers in the summary the calculator did not recompute
  untrusted: true;
};
