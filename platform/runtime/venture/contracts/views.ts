// Venture views contract. Types only; public imports use ../contracts.ts.
import type { PlaybookOrigin } from '../playbook-origins.ts';
import type { ComposeAttachmentNote } from '../onboarding-contracts.ts';
import type { BankAlertRule } from '../build/bank.ts';
import type { FamilyId } from '../core/first-run-types.ts';
import type { TableStamp } from '../playbooks/ca-firm/rates.ts';
import type { CaEngine } from '../playbooks/ca-firm/receipt.ts';
import type { PriceGuideView } from '../core/price-ranges.ts';
import type { PipelineIdeaView } from '../playbooks/kit/records-rules.ts';
import type { PriceStep } from '../money/price-types.ts';
import type { TalkConsentInput, TalkHeard, TalkSaid, TalkSetupInput, TalkStarted, TalkView } from '../agents/talk-core.ts';
import type { FeedbackAnswerInput, FeedbackConsentInput, FeedbackCrashInput, FeedbackCrashKept, FeedbackView } from '../core/feedback-core.ts';
import type { AppPermission } from '../apps/frame.ts';
import type { Display, ModelReceiptView, SpendLead } from './spend.ts';
import type { BlueprintPatch, IsoDate, IsoTime, Json, MicroString, MinorString, RecordBase } from './business.ts';
import type { ClientRecord, InvoiceNext, InvoiceRecord, PriceFigure } from './money.ts';
import type { AgentMessageFrom, AgentNoteLoad, AgentNoteScope, AgentProposalKind, AgentProposalStatus, AgentSuggestion, ChatPart, ChiefCounted, DepartmentId, DiffLine, InboundTriage, KeeperJobId, KeeperOutcome, KnowledgeRecord, LawfulBasis, NetworkImportKind, OrderContract, OutreachChannel, OutreachKind, OutreachLanguage, OutreachSentChannel, PersonaFields, PipelineCaps, PipelineStage, ProposalKind, ProposalStatus, ReceiptSignatureRecord, RoutineRunState, RoutineSchedule, ScoreRule, TieBand, TriageRule, VoiceSections } from './records.ts';
import type { BankConsentView, BankMatchRecord, ConnectorPostState, PostingCandidate, PostingStepId } from './build.ts';
import type { AgentView, QueueDecision, QueueKind, QueueRow, RunDetail, RunState, RunStep } from './queue.ts';
import type { CheckId, DelegateCli } from './delivery.ts';
import type { ModelAvailability, ModelPresetId, ModelTier } from './models.ts';

/**
 * venture.money.overview: three lines code adds up in BigInt, each with the receipt behind it. rupees: the AI spend line
 * in rupees at the owner's own rate, with that rate; absent without one.
 */
/** kind, source, uses and basis (4J4, M13 and M14): how the line's figure was made. */
export interface MoneyOverviewLine {
  id: 'owed' | 'received' | 'spent'; label: Display; value: Display; receiptId?: string; estimate?: boolean; rupees?: Display;
  /** 4Z3: the AI spend line as the owner's currency leads it (the 'spent' line only). */
  lead?: SpendLead;
  /** C4 (T23): a business billing in rupees with no rupee rate set, so the owner can be offered "Set a rupee rate". */
  needsRate?: boolean;
  kind?: FigureKind; source?: FigureSource; uses?: Display[]; basis?: TotalBasis;
}

/** One-shot C6: every invoice issued in a month has nothing left to pay, with the receipt that lists them and their payments. */
export type PaidInFullView = { line: Display; receiptId: string };

/** paidInFull (one-shot C6): this month on the owner's calendar; absent while the business has no country. */
export interface MoneyOverview { lines: MoneyOverviewLine[]; paidInFull?: PaidInFullView | null }

/** venture.tax.working: the tax working for a period, every figure from code with its receipt. */
export interface TaxWorkingLine { label: Display; value: Display; receiptId?: string }

export interface TaxWorkingSection { id: string; title: Display; lines: TaxWorkingLine[]; note?: Display }

export interface TaxWorkingView { period: Display; sections: TaxWorkingSection[]; needsCaConfirmation: boolean }

/** venture.ca.get (the AI-native CA firm playbook): the CA of record, rate tables waiting for the CA, and sign-off requests. */
export interface CaPendingRate { tableId: string; title: Display; version: string; validFrom: string; validTo: string | null; citations: string[] }

export interface CaRequestView { signoffId?: string | null; id: string; deliveryId: string; title: Display; state: 'sent' | 'signed' | 'returned'; at: string }

/** The newest regulated draft a run made with the calculator's receipts (Ink v2 2A2): its run, its title and those receipts. */
export interface CaLatestPapers { deliveryId: string; title: Display; receiptIds: string[] }

export interface CaFirmView { citations?: import('../playbooks/ca-firm/records.ts').CaCitationsView; ca: { name: string; membershipNo: string } | null; pendingRates: CaPendingRate[]; requests: CaRequestView[]; latestPapers: CaLatestPapers | null }

/**
 * venture.share.*: a read-only preview link for a client. url is null when no public address is set; reason says why.
 * answer: the client's answer on this link, given through it or recorded by the owner (Ink v2 wave 2); absent until one.
 * revoked: the owner took the link back; only then present. 4J7: shareKind (absent for a draft), viewedAt once the
 * page was opened through its token, and comments once the client left one; each only when present.
 */
export interface ShareLinkView {
  id: string; url: string | null; reason?: Display; expiresAt: string; answer?: ShareAnswerView; revoked?: true;
  shareKind?: Exclude<ShareKind, 'draft'>; viewedAt?: IsoTime; comments?: ShareComment[];
}

/** venture.client.list rows: what the client owes on open invoices, summed in BigInt, with the sum's receipt. */
export type ClientListRow = ClientRecord & { owed?: { display: Display; receiptId: string } };

/** venture.invoice.list rows: the invoice total, formatted, and the price receipt behind it. */
/** next (4J5, M12): the invoice's one next step by its state, the same as its view's. */
/** late (4J4, M9): on an open invoice past its due day, the days on the owner's calendar ("71 days late"). */
export type InvoiceListRow = InvoiceRecord & { total?: Display; receiptId?: string; next?: InvoiceNext; late?: { days: number; line: Display }; /** One-shot C4 (T20): as InvoiceView.sent. */ sent?: boolean };

/**
 * A receipt for a sum code made from venture records: what clients owe on open invoices, what came in this month, what
 * AI and tools cost this month. Each addend names its record; the steps are BigInt additions. venture.receipt.get serves
 * it beside price receipts. unit 'micros' is micro-USD (spend); 'minor' is the venture currency's minor unit.
 */
export type SumReceiptSubject =
  | { type: 'agent-cost'; spendId: string }
  | { type: 'agent-job-cost'; runId: string }
  // W6 6G5: spend of one agent or one routine this UTC month, or of one routine run or one delivery run (month null).
  | { type: 'spent-by'; scope: 'agent' | 'routine' | 'routine-run' | 'run'; id: string; month: string | null }
  | { type: 'tax-total'; from: IsoDate; to: IsoDate; currency: string; taxLabel: string }
  | { type: 'owed'; clientId: string | null }
  | { type: 'received'; from: IsoDate; to: IsoDate }
  | { type: 'spent'; month: string }
  // Ink v2 wave 4: each plan lives in its owner's file and money/sums.ts currentPlan calls it (package 4-0 named them).
  // AI and tool spend of one department, or 'shared' for spend no single role can claim, from one day to another (4A1).
  | { type: 'spent-department'; department: DepartmentId | 'shared'; from: IsoDate; to: IsoDate }
  // Invoices before tax this month: issued ones less issued credit notes, or drafts ready to issue (4I1).
  | { type: 'invoiced'; month: string; which: 'issued' | 'ready' }
  // How the month stands against its goal (4I1): day null, still to invoice or past the goal by; a day, today's pace on
  // that day, ahead or behind by (a new receipt each day). Both add up the goal in use, so a replaced goal reads stale.
  | { type: 'goal'; month: string; goalId: string; day: IsoDate | null }
  // One-shot C6: what is left to pay on every invoice issued in the month (each total less its payments and credits).
  | { type: 'paid-in-full'; month: string }
  // Open balances in five buckets by days late (4J4).
  // late (4J20): the late ones alone, more than zero days past their due date.
  | { type: 'aging'; asOf: IsoDate; late?: true }
  // A month's money in and out, and what was left (4J4).
  | { type: 'flow'; month: string; part: 'in' | 'out' | 'left' }
  // One week of the 13-week cash forecast, if clients pay on time or if the late ones never pay (4J4).
  // scenario 'bank': the statements' closing balances alone, on asOf (week is asOf).
  | { type: 'cash'; asOf: IsoDate; week: IsoDate; scenario: 'on-time' | 'late-unpaid' | 'bank' }
  // One client's invoiced amount against the AI and tool spend of their orders (4J4).
  | { type: 'margin'; month: string; clientId: string; part: 'invoiced' | 'spend' | 'margin' }
  // A count, not money: people reaching each pipeline stage (4E1), ties in each band (4D2), jobs per department (4A1).
  // scope names what is counted (a stage, 'all', a department) over the days from and to.
  | { type: 'count'; what: 'funnel' | 'bands' | 'jobs'; scope: string; from: IsoDate; to: IsoDate }
  // What calls still running hold this UTC month (as the spend limit counts it), for one department, the shared part or
  // the whole team (4A1). Each is already inside the month's spend at its estimate; this says how much of it is held.
  | { type: 'held'; scope: DepartmentId | 'shared' | 'all'; month: string }
  // What is owed on open bills, those due on or before a day, or all of them when due is null (4J5).
  // billId (4J20): one bill, its lines and tax less what was paid (its balance).
  | { type: 'bills'; due: IsoDate | null; billId?: string }
  // One client's money for their statement (4J5, M17): paid so far, credit notes issued, or, with invoiceId, how one
  // invoice's balance is made (its total less what was paid and credited).
  | { type: 'statement'; clientId: string; part: 'paid' | 'credited' | 'balance'; invoiceId: string | null }
  // One figure across the businesses on this computer (4J6): with open, the open business's own sum as of now (its
  // records), then each other business's figure as its snapshot saved it, with when. month: the calendar month that
  // invoiced and received belong to, the UTC month for spend, null for owed. currency: all of them share it.
  | { type: 'across'; what: AcrossFigureId; month: string | null; currency: string; open: boolean; others: { businessId: string; name: string; asOf: IsoTime; amount: string }[] }
  // The total quote of a set the owner approved in one go (4J2, O9): each picked row in order, with what approving it
  // can cost in micro-dollars as code worked it out then (the subject holds it, so the receipt never drifts).
  | { type: 'set'; items: { rowId: string; label: string; micros: MicroString }[] }
  // W6 6H1: an amount a mini app asked the calculator for: the operation and its inputs in minor units, so the receipt
  // never drifts (apps/calc.ts).
  | { type: 'app-calc'; appId: string; operation: 'add' | 'times' | 'percent-off'; amounts: string[]; count: string | null; percentBps: string | null; currency: string };

/** 4J6. The figures a snapshot keeps and the across views show. */
export type AcrossFigureId = 'invoiced' | 'received' | 'owed' | 'spend';

export type SumReceiptRecord = RecordBase<'venture-sum-receipt'> & {
  /** C4 (T27): what was counted and over which dates, in code words; added when served, never stored or signed. */
  basis?: Display;
  subject: SumReceiptSubject;
  operation: 'venture.sum';
  currency: string;
  /** 'count': a count of records, not money (Ink v2 wave 4); totalMinor holds the count. */
  unit: 'minor' | 'micros' | 'count';
  /** rupeeRate (4J4): the rupees per US dollar an amount was converted at (ten-thousandths of a rupee), beside its record's id. */
  addends: { recordId: string; label: string; amount: string; display: string; rupeeRate?: string }[];
  steps: PriceStep[];
  figures: PriceFigure[];
  totalMinor: string;
  estimate: boolean; // true when any addend is an estimate (an unconfirmed price, a held reservation)
  allowedNumbers: string[]; // every number a later sentence may cite
  explanation: string;
  digest: string; // over the subject and the addends; a newer sum with other addends makes this one stale
  stale: boolean;
};

/**
 * A read-only preview link for one delivery draft (venture.share.*). The record keeps the token's sha256, never the token,
 * and a copy of the exact draft text the link shows. The client's answer goes through the social playbook's approvals
 * (playbooks/social/approvals.ts): decide-once, on the digest shown, before the link ends.
 */
export type ShareLinkStoredRecord = RecordBase<'venture-share-link'> & {
  /** A shared request room, showing only its current owner-approved brief. */
  roomId?: string;
  /** 5I: exact career source and rendered-file identity. */
  career?: {threadId:string;approvalDigest:string};
  /** 5J1: exact source, glossary and translation version on a hosted client review link. */
  translation?: { jobId: string; approvalDigest: string };
  deliveryId: string;
  clientId: string | null;
  tokenHash: string;
  title: string;
  text: string;
  draftDigest: string;
  expiresAt: IsoTime;
  state: 'open' | 'closed' | 'revoked';
  revokedAt: IsoTime | null;
  /** Whether a usable address was made at creation: false when no public address was set, so nobody can open it. */
  served: boolean;
  /** recordedFor (4J7, O20): the client the answer is recorded under; absent on answers recorded before. */
  decisions: { draftId: string; decision: 'approved' | 'changes'; comment: string | null; at: IsoTime; digest: string; via: 'share-link' | 'owner-recorded'; recordedBy: string | null; recordedFor?: string | null }[];
  /**
   * 4J7 (O20, M17, U11): what the link shows. Absent: 'draft'. 'order-status' shows a live order's steps (deliveryId
   * holds the order id), 'statement' a client's "What you owe us" (the client id), 'books' a month's figures for the
   * owner's accountant ('books:<month>'). Only a draft link can be answered.
   */
  shareKind?: ShareKind;
  /** 4J7 (O20): when the link's page was first opened through its token; the owner's own preview never counts. */
  viewedAt?: IsoTime | null;
  /** 4J7 (O20): the client's comments per item (per post), without an account; text only, screened before any prompt. */
  comments?: ShareComment[];
  /** 4J7 (M17): the open invoices a statement showed, so a client's view becomes each one's Viewed line. */
  invoiceIds?: string[];
  /** 4J7 (M17, U11): the sum receipts behind a statement's or a month's figures, sealed when the link was made. */
  receiptIds?: string[];
};

export type ShareKind ='draft' | 'order-status' | 'statement' | 'books';

/** One comment on one item of a shared draft: item is a post id ('<run>.post-<n>') or 'draft' for the whole. */
export type ShareComment = { item: string; text: string; at: IsoTime; recordedFor: string | null };

// ---------------------------------------------------------------------------
// 9d. Ink v2 wave 2: what the newly wired pieces answer. app/ui mirrors them in app/ui/src/engine/types.ts.
// ---------------------------------------------------------------------------

/**
 * venture.delivery.judge: the rules judge's call on one ready real-order draft, previewed and waiting for the owner to
 * send it (venture.delivery.judgeSend with this digest). It carries the client's words, so it never goes on its own.
 */
export interface DeliveryJudgePreview { runId: string; digest: string; estimatedMaxCostDisplay: Display; containsClientData: true }

/** venture.posting.propose: the post waits on Today for the owner's approval. line says so; warnings are the risk gate's. */
export interface PostingProposal { postId: string; connectorId: string; draftId: string; part: number | null; state: ConnectorPostState; line: Display; warnings: Display[] }

/**
 * venture.posting.checkSteps: each browser step's candidates with the day each last matched exactly one visible
 * element, and stepsCheckedOn, the oldest such day across the three steps (null while any step has none). The confirm
 * step also carries the platform's response rule, dated by a post the response confirmed. boxAndButtonCheckedOn: the
 * oldest day across the text box and the post button, the steps a check can see.
 */
export interface PostingStepsView {
  connectorId: string;
  steps: {
    step: PostingStepId;
    candidates: (PostingCandidate & { key: string; checkedOn: IsoDate | null; addedBy: 'chausar' | 'owner' })[];
    response?: { key: string; method: string; path: string; checkedOn: IsoDate | null };
  }[];
  stepsCheckedOn: IsoDate | null;
  boxAndButtonCheckedOn: IsoDate | null;
  line: Display;
}

/** A client's answer on a shared draft, given through the link or recorded by the owner (venture.share.recordAnswer). */
export interface ShareAnswerView { draftId: string; decision: 'approved' | 'changes'; comment: string | null; at: IsoTime; via: 'share-link' | 'owner-recorded' }

/**
 * One post a draft holds: a line "Channel: text", numbered from 1 in text order over every channel, as
 * '<delivery run id>.post-<n>' (playbooks/social/run-approvals.ts). connectorId is null for a channel with no posting
 * connector in this build.
 */
export interface DraftPostView { draftId: string; channel: string; name: string; connectorId: string | null; text: string }

/**
 * The posting limits the owner may set for one channel, in the owner's units (playbooks/social/post-limits.ts):
 * posts in 24 hours, minutes between posts, warm-up days, the near-duplicate threshold in whole percent, the link streak.
 */
export type OwnerPostingLimitsView = { capPer24h: number; minGapMinutes: number; warmUpDays: number; duplicatePercent: number; linkStreak: number };

/** The owner's limits for one channel (venture.posting.limits.set). An empty set means Chausar's own limits. */
export type PostingLimitsRecord = RecordBase<'venture-posting-limits'> & { connectorId: string; limits: Partial<OwnerPostingLimitsView> };

/** venture.posting.limits.*: per channel, Chausar's own limits, the owner's settings, and the ones the risk gate uses. */
export interface PostingLimitsView {
  channels: { connectorId: string; name: string; house: OwnerPostingLimitsView; owner: Partial<OwnerPostingLimitsView>; inUse: OwnerPostingLimitsView }[];
  line: Display;
}

/**
 * venture.social.calendar: the calendar file the engine built (UTF-8 with a byte order mark), the name to save it under
 * and its row count. blocked: each post it left out, with its channel's name, its words and why. defused: the posts
 * whose cell starts with a mark spreadsheets read as a formula, so the file put an apostrophe first. threads: the posts
 * written as the numbered thread parts code split them into, in one cell, to post by hand part by part. gaps: where the
 * draft's posts and the plan's slots do not match, one line per channel.
 */
export interface SocialCalendarFile {
  csv: string; fileName: string; rows: number; blocked: { draftId: string; name: string; text: string; line: Display }[];
  defused: string[]; threads: string[]; gaps: Display[];
}

/**
 * How a bank statement row reads against the books (venture.bank.ledger): a transfer between the owner's own accounts,
 * money in that looks like an invoice's payment, plain money in or out, or a row the owner already decided.
 */
export type BankRowClass = 'own-transfer' | 'suggested-payment' | 'money-in' | 'money-out' | 'applied' | 'skipped';

/**
 * dateDisplay: the row's date as the owner's country writes it. description and counterparty are null off the app
 * channel (phone, MCP, a tainted context). flag: the engine's words when something about the row needs the owner's eye
 * (already recorded as a typed payment, or recorded in the books but paired as an own transfer), else null.
 */
export interface BankLedgerRow {
  id: string; accountId: string; account: string; date: IsoDate; dateDisplay: Display; amount: Display; direction: 'in' | 'out';
  description: string | null; counterparty: string | null; classification: BankRowClass; flag: Display | null;
  /** The other own account's row an own transfer pairs with; null when unpaired. */
  pairedWith: string | null;
  /** The invoice a money-in row looks like it pays, with the engine's words ("pays it in full"); null when none matched. */
  suggestion: { invoiceId: string; number: string; line: Display } | null;
  /** What the owner decided on this row (venture.bank.apply), or null. */
  decided: BankMatchRecord['as'] | null;
}

/** consent: the account's read-only bank access in words (consentStatus), null when never given; provider: why nothing reads the bank yet. */
export interface BankLedgerView {
  accounts: { id: string; label: string; currency: string; consent: BankConsentView['status'] | null }[]; rows: BankLedgerRow[]; line: Display; provider: Display;
}

/** venture.bank.apply: the row as it reads now, the engine's line, and the books receipt when a payment or a cost was recorded. */
export interface BankApplyResult { row: BankLedgerRow; line: Display; receiptId?: string }

/** venture.bank.alerts.*: each account's alert rules, each rule in the engine's words, and where alerts go, in words; never the address itself. */
export interface BankAlertsView { accounts: { account: string; accountId: string; rules: BankAlertRule[]; ruleLines: Display[]; destination: Display }[] }

/** An explanation the CA of record recorded for one portal difference on a stored CA receipt (venture.ca.explainDiff). */
export interface CaDiffExplanation { receiptId: string; key: string; note: string; caName: string; membershipNo: string; at: IsoTime }

/**
 * venture.ca.receipt: a stored CA receipt as the CA reads it, worked again from its inputs with the exact table
 * versions it stamped. 'differs' names the first key that came out differently; 'table-gone' when a stamped version no
 * longer exists, which is never read as 'same'.
 */
export interface CaReceiptView {
  id: string; runId: string | null; engine: CaEngine | 'portal-diff';
  figures: { key: string; label: string; display: Display }[];
  steps: { key: string; label: string; display: Display; section: string | null }[];
  tables: TableStamp[]; assumptions: string[]; openQuestions: string[];
  rederived: 'same' | 'differs' | 'table-gone'; differs: { key: string; line: Display } | null;
  explanations: CaDiffExplanation[];
  /** On a portal diff only: each key that is not the same, both sides as figures, and the CA's explanation or null (Ink v2 2A2). */
  portalDifferences?: { key: string; label: string; state: 'differs' | 'missing-on-portal' | 'only-on-portal'; ours: Display | null; portal: Display | null; explanation: string | null }[];
}

/** One dated platform rule a flagship playbook's checks rest on (venture.rules.list), as the owner reads it. */
export interface PlatformRuleView {
  id: string; platform: string; rule: Display; checkedOn: IsoDate; stale: boolean;
  /** The step or check ids of the playbook that use this rule. */
  usedBy: string[];
  limitations: string[];
  source: { title: string; url: string } | null;
  /** Ink v2 wave 5 (5A3): every source it was read from; a house rule's is "Chausar's own rule" with no address (url ''). */
  sources: { title: string; url: string }[];
  line: Display;
}

/** 5A3 (P6): a recipe the owner can follow: when to use it, steps with why, how to read the result, common mistakes. */
export interface RecipeView { id: string; name: Display; whenToUse: Display; steps: { do: Display; why: Display }[]; howToRead: Display; mistakes: Display[] }

/** 5A3 (P6): one row of the measurement-boundaries table: what this evidence can say and what it cannot. */
export interface BoundaryView { evidence: Display; canSay: Display; cannotSay: Display }

/**
 * venture.rules.list: the playbook's rules with their freshness, its risk level and when it was last reviewed; for a kit
 * playbook (5A3) also its recipes and its measurement boundaries (empty for the flagships). Empty with no playbook.
 */
/** Wave 6 (6C5): one locked rule as its attestation screen shows it. */
export type LockedRuleView = {
  id: string; playbook: string; topic: string; rule: string; limitations: string; needs: 'lawyer' | 'ca';
  sources: { title: string; url: string }[]; digest: string; attestable: boolean; attestedOn: IsoDate | null; line: string;
};

/** venture.rules.locks and venture.rules.attest: the business's locked rules, the words the owner ticks, and the hard stops. */
export type RuleLocksView = {
  playbook: { id: string; label: string } | null; rules: LockedRuleView[]; words: string; line: string;
  hardStops: { id: string; line: string }[];
};

/** Wave 6 (6C6): a profession's side-work question, rules and regulator switches, and the recorded answer. */
export type ComplianceView = {
  profession: { id: string; label: string; family: string | null };
  question: string; responsibility: string;
  /** One-shot C4 task 3: the line shown when the owner has no day job. */
  noDayJob: string;
  /**
   * W6 6E6: a checked statute carries the official page read and the day; an unchecked one has nulls. W6 (3 November
   * 2026): verdict is the line at the owner's size for a statute with a size threshold, else null.
   */
  rules: { id: string; title: string; line: string; checked: boolean; source: { url: string; publisher: string; title: string } | null; checkedOn: IsoDate | null; checkedDay: string | null; size: string | null; verdict: string | null }[];
  switchedOff: { tool: string; line: string }[];
  hardStops: { id: string; line: string }[];
  digest: string;
  recorded: { professionId: string; sideWork: 'no-day-job' | 'allowed' | 'not-allowed' | 'not-sure'; acknowledgedOn: IsoDate } | null;
  /** W6 (3 November 2026): the size question (core/business-size.ts), or null when no rule of the profession counts size. */
  size: import('../core/business-size.ts').SizeAsk | null;
};

export interface RulesListView {
  playbook: { id: string; label: string; riskLevel: string; lastReviewed: IsoDate } | null;
  rules: PlatformRuleView[];
  summary: Display;
  recipes: RecipeView[];
  boundaries: BoundaryView[];
}

/**
 * venture.judge.auto.get and .set: whether the judge runs on its own on every ready draft for a client or the public,
 * when its standing consent was recorded (null until then, or while off), and the setting's sheet line in plain words.
 */
export interface JudgeAutoView { auto: boolean; consentAt: IsoTime | null; line: Display }

/**
 * The owner's whisper.cpp for transcripts made on this computer (venture.transcription.set): full paths to whisper-cli
 * and to its model file, both null once cleared. The newest is in use; the engine puts it in place when the workspace
 * opens (platform/runtime/speech.ts restoreLocal). Never on the hosted server.
 */
export type TranscriptionSetupRecord = RecordBase<'venture-transcription-setup'> & { command: string | null; model: string | null };

/**
 * W6 6I1 (D45): push-to-talk settings, newest wins: the notice agreed by its digest (null until agreed or after a
 * withdraw), whether recordings are kept (off by default), the service that turns speech into words, and Sarvam's
 * approved rate (its digest) with the owner's monthly limit in paise.
 */
export type TalkSettingRecord = RecordBase<'venture-talk-setting'> & {
  consentDigest: string | null; consentAt: IsoTime | null; keepAudio: boolean; listen: 'whisper-local' | 'sarvam'; capMinor: string; rateDigest: string | null;
};

/** W6 6I1: one recording turned into words: its service, length and cost in paise; its audio only when kept; never its words. */
export type TalkHeardRecord = RecordBase<'venture-talk-heard'> & {
  provider: 'whisper-local' | 'sarvam'; durationMs: number; costMinor: string; phase: 'sending' | 'done' | 'failed';
  audioBase64: string; audioDigest: string; erasedAt: IsoTime | null;
};

/** W6 6I1: the views and inputs live in the browser-safe agents/talk-core.ts, so the app reads the same shapes. */
export type { TalkConsentInput, TalkHeard, TalkSaid, TalkSetupInput, TalkStarted, TalkView } from '../agents/talk-core.ts';

/**
 * W6 6J2 (D47): the owner's report choices, newest wins: the notice agreed by its digest (null until agreed, after a
 * withdraw or a deletion request), usage and crash reports each on or off, the random report id, the milestones and
 * questions already sent or asked, the last send's answers, and the last deletion request.
 */
export type FeedbackSettingRecord = RecordBase<'venture-feedback-setting'> & {
  consentDigest: string | null; consentAt: IsoTime | null; usage: boolean; crashes: boolean; reportId: string | null;
  milestonesSent: string[]; asked: string[]; sentAny: boolean;
  lastSend: import('../core/feedback-core.ts').FeedbackSend | null;
  deletion: { at: IsoTime; reportId: string; line: string } | null;
};

/** W6 6J2: one scrubbed crash or one fixed answer waiting for Send report; its words are erased once sent or dropped. */
export type FeedbackItemRecord = RecordBase<'venture-feedback-item'> & {
  item: 'crash' | 'answer'; status: 'queued' | 'sent' | 'dropped';
  crash: import('../core/feedback-core.ts').KeptCrash | null; answer: { question: string; answer: string } | null;
};

/** W6 6J2: the views and inputs live in the browser-safe core/feedback-core.ts, so the app reads the same shapes. */
export type { FeedbackAnswerInput, FeedbackConsentInput, FeedbackCrashInput, FeedbackCrashKept, FeedbackPreview, FeedbackView } from '../core/feedback-core.ts';

/**
 * venture.transcription.get and .set: the setup's honest status (set up, not set up, or its files are not where they
 * were set up, checked on disk each time), its paths, whether ffmpeg is on this computer too, and a plain line.
 */
export interface TranscriptionSetupView { status: 'set-up' | 'not-set-up' | 'files-missing'; command: string | null; model: string | null; ffmpeg: boolean; line: Display }

// --- Wave 4 views (what the methods answer). Every figure arrives formatted with its receipt. ---

/** A figure with the receipt behind it. */
export type MoneyFigureView = { display: Display; receiptId: string };

/** One point of a series the engine scaled in code: valuePermille of the largest point, null (never 0) where there is no data. */
export type SeriesPoint = {
  key: string; label: Display; value: Display | null; valuePermille: number | null; receiptId: string | null;
  /** A money point in rupees at the owner's rate, labelled with that rate (4A1); absent without a rate or a value. */
  rupees?: Display;
  /** 4Z3: a money point as the owner's currency leads it; absent where there is no value. */
  lead?: SpendLead;
};

/** 4A1. healthy, or failing (two failed runs in a row), quarantined, degraded, each with one plain reason and the digest Clear quarantine sends. */
export type AgentHealthStatus = 'healthy' | 'failing' | 'quarantined' | 'degraded';

export type AgentHealth = { status: AgentHealthStatus; reason: Display | null; digest: string };

/**
 * 4A1. Spend this UTC month (as the spend limit and Money count it) in dollars, rupees beside them at the owner's rate,
 * and how much of it calls still running hold, in words with its own receipt. Calls running count at their estimate.
 */
/** sharePermille (4A2): a department's or the shared part's share of the month's whole spend, floored; 0 when nothing was spent. */
/** rate (4A2): the owner's rupee rate in words, the same words `rupees` and `held` end with, sent with them. */
/** lead (4Z3): the spend as the owner's currency leads it. */
export type DepartmentSpend = { display: Display; receiptId: string; rupees?: Display; rate?: Display; held?: Display; heldReceiptId?: string; sharePermille?: number; lead?: SpendLead };

export type DepartmentView = {
  id: DepartmentId;
  name: Display;
  counts: { working: number; waiting: number; stopped: number; idle: number };
  /** permille (4A2): this week's count scaled to the busiest department's, floored; 0 when no department did a job. */
  doneThisWeek: { count: number; receiptId: string; permille?: number };
  spendThisMonth: DepartmentSpend;
  series: { jobs: SeriesPoint[]; spend: SeriesPoint[] };
};

/** 4A1. One Keeper job and its last run, from records only; note says "Not run yet" or "Not on the hosted app". */
export type KeeperJobView = { id: KeeperJobId; name: Display; lastRun: { at: IsoTime; outcome: KeeperOutcome; line: Display } | null; note: Display | null };

export interface KeeperView { jobs: KeeperJobView[] }

export interface TeamListView {
  agents: AgentView[];
  /** 4A1: the five departments; always sent once 4A1 lands. */
  departments?: DepartmentView[];
  /** 4A1: spend no single role can claim ("Shared by the team"), with its own receipt; null when none. */
  shared?: DepartmentSpend | null;
  /**
   * 4A1: the team's totals, from the same partition as the departments: jobs done this week, and this month's spend,
   * which is Money's own figure (the departments and the shared part add up to it), with what calls running hold.
   */
  totals?: { doneThisWeek: { count: number; receiptId: string }; spendThisMonth: DepartmentSpend; held: MoneyFigureView | null };
  /** 4A1: a quarantine no single agent can claim (one cause, one digest; Clear quarantine with agentId 'team'). */
  teamHealth?: AgentHealth;
  /** W6 6G2: the Retired shelf, oldest first; sent only when an agent is retired. */
  retired?: RetiredAgentView[];
  /** C5 task 1: the agents this member has not met yet, each with its code-written line (name and job). */
  introduce?: { agentId: string; line: string }[];
}

/**
 * W6 6G2 (D43): an agent the owner retired. to: the agent that took over its steps, or the owner. routines: the ids
 * retiring switched off, which Bring back switches on again. digest: the check screen the owner saw. restoredAt: set
 * by Bring back; the record stays as history.
 */
export type AgentRetirementRecord = RecordBase<'venture-agent-retirement'> & {
  agent: string; name: string; to: string; routines: string[]; digest: string; restoredAt: IsoTime | null;
};

/** W6 6G2. One agent on the Retired shelf; to is null when the owner took over its work. */
export type RetiredAgentView = { id: string; name: string; role: Display; department?: DepartmentId; at: IsoTime; to: { id: string; name: string } | null; line: Display };

/** W6 6G2. One item still moving that the check screen names: a run, the agent's question, a proposal in its chat, a Today card. */
export type RetireInFlight = { id: string; kind: 'run' | 'question' | 'proposal' | 'today'; line: Display };

/**
 * W6 6G2. What the owner reads before retiring an agent: what it holds, what is in flight, the routines that switch off,
 * who can take over (the owner always can, as 'owner'), the fixed promise of what is kept, why it cannot retire (the
 * last AI agent) or null, and the digest venture.agents.retire takes.
 */
export interface RetireCheckView {
  agent: { id: string; name: string; role: Display };
  holds: { steps: Display[]; instructions: number; notes: number; messages: number };
  inFlight: RetireInFlight[];
  routines: { id: string; name: string; when: Display }[];
  to: { id: string; name: string }[];
  kept: Display;
  blocked: Display | null;
  digest: string;
}

/** W6 6H1 (D39): a mini app's permission, tool names and versions live in the browser-safe apps/frame.ts. */
export type { AppPermission } from '../apps/frame.ts';

/** W6 6H1: one version of a mini app: the HTML the owner's AI wrote (data, never run outside the frame), what its code needs. */
export type MiniAppVersion = { version: number; at: IsoTime; html: string; summary: string; permissions: AppPermission[]; ask: string; callId: string | null; digest: string };

export type MiniAppMessage = { at: IsoTime; from: 'owner' | 'chausar'; text: string; version: number | null };

/**
 * W6 6H1: a mini app. current: the version in use. grant: what the owner allowed on the permission screen (its digest
 * binds the app, the version shown and those permissions), null until allowed or after Turn off. notes: the app's own
 * notes (key to text), deleted with it.
 */
export type MiniAppRecord = RecordBase<'venture-mini-app'> & {
  name: string; versions: MiniAppVersion[]; current: number;
  grant: { permissions: AppPermission[]; version: number; digest: string; at: IsoTime } | null;
  pinned: boolean; notes: Record<string, string>; messages: MiniAppMessage[];
};

export type MiniAppPermissionView = { id: AppPermission; verb: 'Read' | 'Keep' | 'Use' | 'Propose'; line: Display };

/** W6 6H1: an app on the Apps place. reads: the chips that say what it reads or uses. allowed: it may run now. */
export type MiniAppCard = { id: string; name: string; version: number; summary: Display; reads: Display[]; pinned: boolean; madeAt: IsoTime; allowed: boolean };

/**
 * W6 6H1: one app, opened. document: the frame document (policy, bridge, then the app's HTML). tools: the bridge tools
 * that answer now (what the current version uses and the owner allowed). ask: the permission screen, when the current
 * version needs something not allowed yet (first: nothing allowed yet), with the digest venture.apps.grant takes.
 */
export type MiniAppView = MiniAppCard & {
  uri: string; document: string;
  /** C4 task 29: the app reads the business, and every read it may make has nothing to show now. */
  empty: boolean;
  versions: { version: number; at: IsoTime; summary: Display; current: boolean }[];
  permissions: MiniAppPermissionView[];
  grant: { permissions: AppPermission[]; at: IsoTime } | null;
  ask: { digest: string; added: AppPermission[]; first: boolean } | null;
  tools: string[];
  messages: MiniAppMessage[];
  never: Display;
};

/** W6 6H1: what the bridge answers for a tools/call, in the MCP CallToolResult shape. */
export type MiniAppCallResult = { content: { type: 'text'; text: string }[]; structuredContent: Json; isError: false };

export interface AgentRetired { retired: RetiredAgentView; line: Display }

export interface AgentRestored { agent: AgentView; routines: number; line: Display }

/** 4B1. needed: the consent sheet shows text and digest; stale: the AI connection changed; not-needed: templates only. */
export type ChatConsentView = { state: 'needed' | 'given' | 'stale' | 'not-needed'; text: Display | null; digest: string | null; at: IsoTime | null };

/**
 * proposalId (4B3): on the agent's reply to a request on the floor, the drafted proposal it raised to Today (its row's
 * subject is proposal:<id>), so the thread can open that card.
 */
export type AgentMessageView = { id: string; at: IsoTime; from: AgentMessageFrom; parts: ChatPart[]; suggestion?: AgentSuggestion; answered?: { runId: string }; proposalId?: string };

/** 4B1, 4B2. status 'stale': drafted against an older version; line then says so in the engine's words. */
export type AgentProposalView = {
  id: string; at: IsoTime; agent: string; kind: AgentProposalKind; status: AgentProposalStatus | 'stale';
  quote: string; title: Display; appliesTo: Display | null; diff: DiffLine[];
  fromVersion: number | null; toVersion: number | null; note: { text: string; scope: AgentNoteScope } | null;
  digest: string; line: Display | null;
  /** C7: an offer the agent made after an edited sign-off: "Offered by {agent} after you approved {run}". */
  offered?: Display;
};

/**
 * 4B1. One run the agent owned a step in, folded in its thread; recalled: the notes its turns carried (4B2), a note the
 * owner forgot since marked forgotten, with no words of it.
 */
export type AgentRunItem = { runId: string; at: IsoTime; purpose: Display; state: RunState; done: number; total: number; steps: RunStep[]; recalled: { id: string; text: string; forgotten?: boolean }[] };

export type AgentThreadItem =
  | { type: 'message'; message: AgentMessageView }
  | { type: 'run'; run: AgentRunItem }
  | { type: 'proposal'; proposal: AgentProposalView };

/** 4B1. The agent's open question, kept in one fixed place above the thread. */
export type AgentWaiting = { runId: string; rowId: string; question: Display };

export interface AgentThreadView {
  agent: { id: string; name: string; role: string };
  items: AgentThreadItem[];
  waiting: AgentWaiting | null;
  more: boolean;
  consent: ChatConsentView;
  /** W6 6G2: set while the agent is retired; the thread is read only on the Retired shelf. */
  retired?: { at: IsoTime; line: Display };
}

export interface AgentSendResult { added: AgentThreadItem[]; line: Display | null }

export interface AgentProposalDecision { proposal: AgentProposalView; line: Display; playbook?: { id: string; version: number } }

export interface AgentVersionUndo { playbookId: string; version: number; line: Display }

/** 4B1. One standing order in use on the agent's steps: the step, the version it arrived in and the owner's quote. */
export type StandingOrderView = { stepId: string; step: Display; text: string; since: number; quote: string; at: IsoTime };

/**
 * 4B3: what the agent panel reads, without writing (currentPlaybook, never ensurePlaybook). playbook: the version in use
 * (its hash is the digest venture.agents.version.undo takes), or null before one is stored. rebuildDue: the plan changed
 * (or this build grants more tools) since, so the next run or change builds a new version first. steps: the agent's own
 * steps in that version, with their guidance and check ids. undo: what Undo would do now: point back at the version the
 * last change was made from, rebuild without it, or null when the agent has no change from the owner in use.
 */
export type StandingPlaybookView = { id: string; version: number; hash: string; origin: PlaybookOrigin; at: IsoTime };

export type StandingStepView = { stepId: string; title: Display; guidance: string[]; checks: CheckId[] };

export type StandingUndoView = { kind: 'back'; version: number } | { kind: 'rebuild' };

export interface StandingOrdersView { orders: StandingOrderView[]; playbook: StandingPlaybookView | null; rebuildDue: boolean; steps: StandingStepView[]; undo: StandingUndoView | null }

/** 4B2. */
export type AgentNoteView = { id: string; scope: AgentNoteScope; load: AgentNoteLoad; text: string; source: Display; captured: IsoDate; hash: string };

/** erases (4B3): undoing this change takes the note away, which erases its words like Forget (the UI asks first). */
export type NoteChangeView = { id: string; noteId: string; at: IsoTime; who: 'owner' | 'cofounder' | 'proposal' | 'undo'; line: Display; undone: boolean; erases: boolean };

/** 4B2. forgetLine: what the owner reads before Forget, which erases the words and cannot be undone. */
export interface AgentNotesView { notes: AgentNoteView[]; changes: NoteChangeView[]; usedChars: number; limitChars: number; forgetLine?: Display }

export interface AgentNoteChange { note: AgentNoteView | null; change: NoteChangeView }

/**
 * 4C1. amounts (4C2 review): each receipted figure lastLine states, exactly as written there, at its offset in UTF-16 code
 * units, with its receipt, so the screen wraps exactly that span in a Figure. lastLine is never cut inside one.
 */
export type ChiefLineAmount = { text: Display; start: number; length: number; receiptId: string };

export type ChiefThreadSummary = {
  id: string; title: string; pinned: boolean; lastAt: IsoTime; lastLine: Display; amounts: ChiefLineAmount[]; unread: number;
  /**
   * W6 6G1 (D42): the chat's one state; snoozedUntil while snoozed; settled says when and whether by the owner or after
   * the quiet days; waiting: a step or the chief's question waits for the owner, so it is never hidden.
   */
  state: ChiefThreadState; snoozedUntil: IsoTime | null; settled: { at: IsoTime; by: 'owner' | 'auto' } | null; waiting: boolean;
};

export type ChiefThreadGroupKey = 'pinned' | 'today' | 'this-week' | 'last-week' | 'earlier' | 'snoozed';

/** W6 6G1 (D42). */
export type ChiefThreadState = 'pinned' | 'active' | 'snoozed' | 'settled';

export type ChiefSnoozePreset = 'later' | 'tomorrow' | 'next-week';

/** W6 6G1: a snooze choice, its wake time worked out by the engine on the owner's clock. */
export type ChiefSnoozeOption = { id: ChiefSnoozePreset; until: IsoTime };

/** W6 6G1: what venture.chief.thread.state takes; a snooze names a preset or an exact future time (Undo sends that). */
export type ChiefThreadStateInput = { threadId: string; state: ChiefThreadState; preset?: ChiefSnoozePreset; until?: IsoTime };

/** W6 6G1: undo: the request that puts the chat back exactly as it was; line: the engine's words for what happened. */
export interface ChiefThreadStateResult { thread: ChiefThreadSummary; undo: ChiefThreadStateInput; line: Display }

/** W6 6G1: the owner's quiet days (0 is never), the number before (for Undo), and the engine's words. */
export interface ChiefSettleResult { days: number; undo: number; line: Display }

/** 4C2 review: consent is the business's one chat consent now (agents/consent.ts), so the screen agrees to exactly that text and digest. */
export interface ChiefThreadsView {
  groups: { key: ChiefThreadGroupKey; label: Display; threads: ChiefThreadSummary[] }[]; consent: ChatConsentView;
  /** W6 6G1: the archive (settled chats, the latest settled first) and the owner's quiet days before a chat settles. */
  settled: ChiefThreadSummary[]; settleAfterDays: number;
}

/** 4C1. secondAsk: Approve asks once more because it spends or sends. what (4C2 review): the step's own line; line says where it stands. */
export type ProposalView = {
  id: string; at: IsoTime; kind: ProposalKind; status: ProposalStatus; title: Display; line: Display; what: Display;
  agent: string | null; rowId: string | null; digest: string; secondAsk: boolean;
};

/** 4C1. worked: the calculator's lines when the answer carries them; dropped: the engine's lines for figures it left out. */
export type ChiefMessageView = {
  id: string; at: IsoTime; from: 'owner' | 'chief'; parts: ChatPart[]; proposals: ProposalView[];
  routedTo: { agent: string; name: string } | null; worked: { label: Display; value: Display; receiptId: string }[]; dropped: Display[];
  /** 4C2 review: the counts by code, or null. */
  counted: ChiefCounted | null;
  /** C5 task 5: Connect your AI, under an answer written with no AI. */
  suggestion?: { kind: 'connect-ai' };
};

/** snooze (W6 6G1): the snooze choices now, none while the chat waits for the owner. */
export interface ChiefThreadView { thread: ChiefThreadSummary; messages: ChiefMessageView[]; more: boolean; snooze: ChiefSnoozeOption[] }

/** 4C1. ask: the chief's question back ("Which agent: Editor or Researcher?"); it never guesses. */
export interface ChiefSendResult { thread: ChiefThreadSummary; added: ChiefMessageView[]; ask: Display | null }

/** 4C1. One way to earn that fits, labelled a model estimate. */
export type ChiefFit = { wayId: string; line: Display; estimate: true };

export interface ProposalRaised { proposal: ProposalView; rowId: string | null; line: Display }

/** 4D1. */
export type PersonSummary = {
  id: string; name: string; initials: string; title: Display | null; company: string | null;
  band: TieBand | null; dots: number; hidden: boolean; degree: '1st' | '2nd' | null;
};

export type MergeSuggestion = { a: string; b: string; line: Display };

/**
 * 4D4: consent, the chat consent a network search needs, when it is needed (state 'needed' or 'stale', with the text the
 * owner reads and its digest for venture.chats.consent); null when it holds or nothing is sent (templates only).
 */
/** chips (C5 task 10): up to three search chips built by code from the owner's own network; none from hidden people. */
export interface PeopleView { people: PersonSummary[]; suggestions: MergeSuggestion[]; total: number; consent: ChatConsentView | null; chips?: string[] }

/** 4D1. One field Chausar keeps about a person, with its source row: the DPDP "What Chausar keeps about this person". */
export type PersonFieldView = { field: string; value: Display; source: Display; sourceId: string };

/** 4D2. A warm path; a connector leg with no fact behind it is "possible path, not confirmed". */
export type WarmPathView = { kind: 'direct' | 'same-company' | 'connector'; via: { id: string; name: string } | null; confirmed: boolean; strength: TieBand; line: Display };

export interface PersonView {
  person: PersonSummary;
  fields: PersonFieldView[];
  how: { line: Display; receiptId: string | null }[];
  paths: WarmPathView[];
  card: PipelineCardView | null;
  drafts: OutreachView[];
  merged: boolean;
  web: { text: string; url: string }[];
  /** 4D4: the LinkedIn address the files hold, normalised, or null. */
  linkedin: string | null;
}

/** 4D1. stale: "Imported 3 months ago. Download a new copy to catch new connections." once older than 60 days. */
export type NetworkSourceCard = { kind: NetworkImportKind; fileName: string; at: IsoTime; kept: number; dropped: number; line: Display; stale: Display | null };

/**
 * 4D2. How many ties sit in each band, from one count receipt. 4D4: permille, each band's share of all the ties counted,
 * per mille, floored in code (0 when nothing is counted), so a screen draws the bars without dividing.
 */
export type NetworkBandCounts = { close: number; knowWell: number; know: number; metOnce: number; cold: number };

export type NetworkBands = NetworkBandCounts & { receiptId: string; permille: NetworkBandCounts };

/** 4D4: webSearch, whether a web search is set up here (the host composed one), so a screen says so in place of the web choice. */
/**
 * 4E4: mailbox and calendar, the read-only mailbox's and the calendar address's state as their own methods answer it
 * (never the app password or the address itself), so Connections reads them on load; null on the hosted app, which
 * reads neither.
 */
export interface NetworkSourcesView {
  sources: NetworkSourceCard[]; bands: NetworkBands | null; webSearch: 'set-up' | 'not-set-up';
  mailbox: MailboxView | null; calendar: CalendarFeedView | null;
}

export type NetworkImportView = {
  id: string; kind: NetworkImportKind; fileName: string; at: IsoTime; rows: number; people: number; merged: number;
  dropped: { what: string; count: number }[]; undone: boolean; line: Display;
};

/** 4D1. check: what an import would keep and drop, with three samples, storing nothing; import: what it did. */
export type NetworkImportResult =
  | { mode: 'check'; kept: number; dropped: { what: string; count: number }[]; people: number; merged: number; samples: { name: string; line: Display }[]; line: Display }
  | { mode: 'import'; import: NetworkImportView; line: Display };

/**
 * 4D1. removed: the people the import alone brought in, who go. goes: the owner-made work that goes with them, by person
 * ("Neha Shah: a pipeline card and 1 draft"). preview: true when nothing was changed and this only says what would go.
 */
export interface NetworkImportUndo { import: NetworkImportView; removed: number; goes: Display[]; preview: boolean; line: Display }

export interface PersonSplit { person: PersonView; split: PersonView }

export interface NetworkForgotten { line: Display; kept: Display[] }

export interface NetworkRecompute { ties: number; computedAt: IsoTime; line: Display }

/** 4D3. why: built by code from checked quotes and their sources, never model prose. */
export type SearchResultView = {
  person: PersonSummary | null; url: string | null; fitBp: number; why: Display;
  checks: { trait: Display; check: 'yes' | 'partly' | 'not-supported'; quote: string | null; source: Display | null }[];
  path: WarmPathView | null; inPipeline: PipelineStage | null; cold: boolean;
  /** 4D4: the tie's receipt (how well the owner knows them), and the LinkedIn address their files hold; null for a web result. */
  receiptId: string | null; linkedin: string | null;
};

/**
 * 4D3. What the web part of a search did, for the screens to branch on (never the words): off (not asked), not-set-up
 * (no web search here), skipped (asked, but the search is about people the owner knows, or the words held an id
 * number), failed (the web search did not answer), none (asked, nothing usable came back), found (cold results added).
 */
export type SearchWebState = 'off' | 'not-set-up' | 'skipped' | 'failed' | 'none' | 'found';

export interface NetworkSearchView {
  id: string; text: string; traits: { id: string; label: Display }[]; results: SearchResultView[];
  summary: Display; more: boolean; webLine: Display | null; web: SearchWebState;
}

export type SavedSearchView = { id: string; name: string; at: IsoTime };

/** 4D3. "Before you write": public pages only, each line with its URL. web: what the look-up did, for the screens to branch on. */
export interface PersonResearch { lines: { text: string; url: string }[]; line: Display; web: 'not-set-up' | 'failed' | 'none' | 'found' }

/** 4E1. */
export type PipelineCardView = {
  id: string; personId: string; name: string; initials: string; company: string | null; stage: PipelineStage;
  band: TieBand | null; dots: number; path: WarmPathView | null;
  next: { text: Display; due: IsoDate; line: Display; late: boolean } | null;
  draft: Display | null; business: string; trigger: Display;
  /** 4E4: the waiting draft the draft line names (the newest not sent), so the screens open it again after a reload. */
  draftId: string | null; draftChannel: OutreachChannel | null;
  /**
   * 4E4: for each kind and channel a draft may take here, whether it is cold outreach (customers/leads.ts coldOutreach,
   * read with the tie of whoever it goes to: an intro's connector, else the card's person) and whether it still needs
   * its lawful basis (cold, and no basis kept on the card for its own person). basis: the one kept on the card.
   */
  outreach: { kind: OutreachKind; channel: OutreachChannel; cold: boolean; needsBasis: boolean }[];
  basis: LawfulBasis | null;
  /** 4E4: on a Proposal card, the quote it rests on, with its price receipt; on a Won card, the client it made, in words. */
  quote: { value: Display; receiptId: string } | null;
  client: { name: string; line: Display } | null;
  score: { bucket: 'hot' | 'warm' | 'cold'; reasons: Display[] } | null;
  timeline: { what: 'sent' | 'scheduled' | 'projected' | 'reply' | 'accepted'; at: IsoDate; line: Display; estimated: boolean }[]; // accepted: 4E2
  // 4E1: blocked, the blocklist covers them (a flag, never a stage); thread, how long since they last wrote, once they have.
  blocked?: Display;
  thread?: { age: 'alive' | 'cooling' | 'presumed-dead'; days: number; line: Display };
};

export type PipelineColumnView ={ stage: PipelineStage; label: Display; sub: Display; count: number; folded: boolean; cards: PipelineCardView[] };

export type StatTileView = { id: string; label: Display; value: Display; line: Display | null; receiptId: string | null };

/** 4E1. forecast: from the last 90 days with its receipt, or the line "Not enough history yet". */
export interface PipelineView {
  columns: PipelineColumnView[];
  tiles: StatTileView[];
  /** 4E4: reachedPermille, the stage's count against the largest stage's, so a bar is drawn without dividing; share, movedOnPermille in words ("71%"). */
  funnel: { stage: PipelineStage; reached: number; movedOnPermille: number | null; receiptId: string; reachedPermille: number; share: Display | null }[];
  forecast: { value: Display; label: Display; receiptId: string } | { line: Display } | null;
  /**
   * 4E4: the quotes the business made (venture.price.quote receipts), newest first, at most QUOTE_PICKS, for a Proposal
   * move's evidence. A quote names no person, so the list is the business's, not one card's.
   */
  quotes: PipelineQuoteView[];
}

/** 4E4: one quote the board offers as Proposal evidence: its offer's name, quantity and amount before tax (or its total). */
export type PipelineQuoteView = { receiptId: string; offer: Display; quantity: string; value: Display; at: IsoTime };

export type FollowupView = { cardId: string; name: string; company: string | null; line: Display; due: IsoDate; late: boolean; channel: OutreachChannel | null; draftId: string | null };

export interface FollowupsView { due: FollowupView[]; later: FollowupView[] }

export interface PipelineCardResult { card: PipelineCardView; line: Display }

export interface PipelineSettingsView { weekdays: number[]; sendTime: string; caps: PipelineCaps; scoreRules: ScoreRule[]; line: Display }

/** 4E1. What a pipeline move rests on, as the owner gives it. */
export type PipelineEvidenceInput = { kind: 'reply' | 'quote' | 'note' | 'client'; id?: string; on?: IsoDate; text?: string };

/**
 * 4E2. counter: a connection note's characters against the owner's limit. author: written by the owner's AI, by
 * Chausar's own template, or (a lead list draft) by the owner. accepted: the day LinkedIn's export showed a connection
 * note accepted. 4E2's own views always carry author, language and accepted; they are optional so a view another
 * package builds (4J5's reminder) still types, and read there as a template, English, not accepted.
 */
export type OutreachView = {
  id: string; opportunityId: string | null; kind: OutreachKind; channel: OutreachChannel; to: Display | null;
  subject: string | null; text: string; blurb: string | null; footer: { unsubscribe: string; postalAddress: string } | null;
  lints: { rule: string; line: Display }[]; counter: { used: number; limit: number } | null;
  sent: { at: IsoTime; channel: OutreachSentChannel } | null; digest: string;
  author?: 'model' | 'template' | 'owner'; language?: OutreachLanguage; accepted?: { on: IsoDate; line: Display } | null;
  /** 4E2: the engine's words for the sheet: Chausar never sends, and counts only the notes the owner marks as sent. */
  line?: Display;
  /** 4E4: how many sentences the forwardable note has, counted by code; null with no note. */
  blurbSentences?: number | null;
};

/** 4E2. One handoff to the owner's own app; nothing is sent. */
export type OutreachHandoff =
  | { action: 'mailto'; url: string; line: Display }
  | { action: 'linkedin'; profileUrl: string; text: string; line: Display }
  | { action: 'whatsapp'; url: string; line: Display }
  /** A message too long for one link the desktop opens (30,000 characters): the owner copies the text instead. */
  | { action: 'copy'; to: string | null; subject: string | null; text: string; line: Display };

export interface OutreachSentResult { draft: OutreachView; card: PipelineCardView | null; line: Display }

export interface OutreachRestriction { channel: OutreachChannel; until: IsoTime; line: Display }

/** 4E3. */
/** 4E4: needsPassword, connected but the app password is no longer on the shelf (the app was opened again since). */
export interface MailboxView { connected: boolean; host: string | null; user: string | null; lastSync: IsoTime | null; line: Display; needsPassword: boolean }

export interface MailboxSync { mailbox: MailboxView; added: number; line: Display }

export type InboundView = { id: string; from: string; date: IsoTime; subject: string; triage: InboundTriage; matched: { opportunityId: string; name: string } | null; line: Display };

export interface InboundListView { items: InboundView[] }

/** 4E4: nextRead, when the morning read comes next (six on the owner's clock), while the address is on the shelf; else null. */
export interface CalendarFeedView { set: boolean; host: string | null; lastRead: IsoTime | null; line: Display; nextRead: IsoTime | null }

/**
 * 4E3. "After a call": people mentioned, and intros and next steps as drafted proposals. steps: every step and intro the
 * notes hold, each with its proposal, or with the engine's line saying why it has none (no date written in the notes, no
 * card for that person).
 */
export interface MeetingDigestView {
  people: { name: string; personId: string | null }[]; proposals: ProposalView[]; line: Display;
  steps: { text: Display; person: string | null; due: IsoDate | null; proposalId: string | null; line: Display }[];
}

/** 4F1. lost: what a force stop throws away, in the engine's words. */
export interface RunControlResult { run: RunDetail; line: Display; lost?: Display }

export interface PauseView { paused: boolean; stopped: number; line: Display }

/** 4F1. A code-built list for the owner's time away; autoReply is text for the owner to paste into their own mail app. */
export interface AwayView {
  away: { from: IsoDate; to: IsoDate } | null;
  promises: { due: IsoDate; line: Display }[];
  keepsRunning: Display[];
  approvalsWaiting: number;
  autoReply: string | null;
  line: Display;
  /** Once the time away began: Today's rows made between the two days, for the "Since you left" filter. */
  since?: { from: IsoDate; to: IsoDate; rowIds: string[] };
}

/** 4F2. The per-day write caps an agent can hit. */
export type WriteCapKind = 'drafts' | 'books-lines' | 'messages';

export interface AllowWritesView { kind: WriteCapKind; line: Display }

/** 4G1. title: the row's title, for the in-app centre only. */
/** ended (one-shot C4 task 7): present once the item no longer waits on the owner; the centre shows it as plain text. */
export type NotificationView = { id: string; rowId: string; kind: QueueKind; title: Display; at: IsoTime; read: boolean; ended?: true };

/**
 * 4G1. digest: the newest daily digest, for the centre only: its line, the items it listed for the first time, how many
 * earlier ones still wait, and the sum receipts behind its money figures. Null before the first digest.
 */
export interface NotifyListView { items: NotificationView[]; unread: number; digest: NotifyDigestView | null }

export interface NotifyDigestView { id: string; day: IsoDate; at: IsoTime; line: Display; items: NotificationView[]; stillWaiting: number; receiptIds: string[] }

/** 4G1. keepsRunning: what keeps going while the app is closed, from records. */
export interface NotifySettingsView {
  pausedUntil: IsoTime | null; quietHours: { from: string; to: string } | null; digest: { hour: number } | null;
  push: boolean; tray: boolean; keepsRunning: Display[]; line: Display;
}

/** 4G3. A browser PushSubscription as JSON. */
export type PushSubscriptionInput = { endpoint: string; keys: { p256dh: string; auth: string }; expirationTime?: number | null };

export interface PushKeyView { publicKey: string }

export interface PushStateView { subscribed: boolean; line: Display }

export interface RelayView { relay: Display | null; line: Display }

/** W6 6F6. said: what a test alert did, only on a test. */
export interface TelegramView { connected: boolean; details: boolean; line: Display; said?: Display }

/** W6 6F7. Phone access on this Wi-Fi (or Tailscale): the listener's state, a one-time pairing link when one was asked for. */
export interface PhoneAccessView {
  on: boolean; addresses: { via: 'wifi' | 'tailscale'; address: string }[]; phones: number;
  link: string | null; expiresAt: IsoTime | null; line: Display;
  /** The pairing link as a QR code the phone's camera can read (money/qr.ts), or null. */
  qr: { size: number; rows: string[] } | null;
}

/** 4H1. Never signedIn 'yes' without evidence; state stays 'unverified' until one real task succeeded. */
export type CliStatusView = {
  cli: DelegateCli; label: Display; found: boolean; path: string | null; version: string | null;
  flags: 'match' | 'mismatch' | 'unknown'; missingFlags: string[]; signedIn: 'yes' | 'no' | 'unknown';
  terms: 'accepted' | 'pending' | 'not-needed'; lastTask: { at: IsoTime; outcome: 'succeeded' | 'failed'; named?: Display } | null;
  state: ModelAvailability; line: Display; fix: Display | null;
  /** A2: Codex only, when the host keeps a Codex trust: the setup in use, or the found Codex waiting for the owner's yes. */
  setup?: import('../core/first-run-types.ts').CodexSetupView;
  /** A2: after a failed last task, the provider's status page when it says the provider has problems. */
  provider?: import('../core/first-run-types.ts').ProviderTrouble;
  /** D4 task 6: a look kept between starts, and when it was really taken; the fresh look replaces it within seconds. */
  kept?: true; checkedAt?: IsoTime;
};

export interface CliStatusList { clis: CliStatusView[]; line: Display }

/** 4H1. The tiers each agent's steps use and the preset that serves each; the team runs as one agent. */
export type RoleModelView = { agent: string; name: string; tiers: { tier: ModelTier; presetId: ModelPresetId; model: string | null; price: Display; usable: boolean }[] };

export interface RoleModelsView { roles: RoleModelView[]; line: Display }

/** 4I1. The waiting Today row with the most money at stake, then the nearest deadline; goalAfter is code ("Goal after: 92%"). */
export interface NextBestStep {
  rowId: string; title: Display; agent: string | null; line: Display; figure: MoneyFigureView | null; goalAfter: Display | null;
  /** 4I2: the goal's whole percent once this is done, for the screen to word; null with goalAfter. */
  goalAfterPercent: number | null;
}

/** 4I1. A sum on the goal card: receiptId null when nothing was added up (a zero with nothing to prove, and no receipt written). */
export type GoalFigureView = { display: Display; receiptId: string | null };

/**
 * 4I1. Money invoiced this month toward the goal, before tax. Permilles are BigInt floors; unset shows last month and no
 * suggestion. elapsedDays counts today as gone; lastDay is true on the month's last day (say "Last day", not "0 days left").
 */
export interface GoalView {
  month: string;
  state: 'set' | 'unset';
  goal: MoneyFigureView | null;
  invoiced: GoalFigureView;
  ready: GoalFigureView;
  stillToInvoice: MoneyFigureView | null;
  receivedSoFar: GoalFigureView;
  invoicedPermille: number | null;
  readyPermille: number | null;
  pacePermille: number;
  pace: 'ahead' | 'behind' | null;
  paceReceiptId: string | null;
  /** 4I2: whole percents for the screen to word (floored; invoicedPercent may pass 100, the bar's permille never does). */
  invoicedPercent: number | null;
  pacePercent: number;
  /** 4I2: past the goal (more invoiced than the goal), and by how much, with the goal's receipt; else false and null. */
  past: boolean;
  pastBy: MoneyFigureView | null;
  /** 4I2: how far ahead of or behind today's pace (see pace), with the pace receipt; null when there is no pace. */
  paceBy: MoneyFigureView | null;
  elapsedDays: number;
  monthDays: number;
  daysLeft: number;
  lastDay: boolean;
  lastMonth: GoalFigureView | null;
  line: Display;
  next: NextBestStep | null;
  briefing: { rowIds: string[]; more: number } | null;
  /** One-shot C6: the month's invoices are all paid (at least one issued, none with a balance), else null. */
  paidInFull: PaidInFullView | null;
}

/** 4I1. A goal the owner's AI suggested from the plan's offers and prices only: a model estimate. */
/** 4I2: typed is the amount as the owner would type it in the goal field ("150000.00"), read back by goals.set. */
export interface GoalSuggestion { amountMinor: MinorString; display: Display; estimate: true; line: Display; typed: string }

/** 4J1. */
/**
 * by: the member who decided (the owner or a cofounder), null for a saved rule or a timeout. ruleId: the saved rule's
 * record (a team gate, an allow for this session), with rule its words; both null when no rule decided.
 */
export type DecisionView = {
  id: string; at: IsoTime; subject: string; action: string; who: 'owner' | 'cofounder' | 'accountant' | 'saved-rule' | 'timeout' | 'chausar';
  rule: Display | null; ruleId: string | null; reason: Display; line: Display; by: string | null;
  /** A4 review (L5): the reader's own decision. */
  mine: boolean;
  /** 4J19: the agent whose step a saved rule or a gate is about (venture.team.gate takes it), else null. */
  agentId: string | null;
  /** C4 (T26): what the decision was about, for the screen to open; null when that thing is gone or cannot be opened. */
  opens: DecisionOpens;
};

export type DecisionOpens = { kind: 'invoice' | 'run' | 'order' | 'plan' | 'price' | 'client'; id: string } | null;

export interface DecisionsView { decisions: DecisionView[] }

export interface AllowSessionView { stepId: string; line: Display }

/** 4J2. */
export interface QueueSetResult { decisions: QueueDecision[]; line: Display; receiptId?: string }

/**
 * 4J2 review: a set as the server works it out before the owner approves it: the digest venture.queue.set takes, each
 * picked row with what approving it can cost, the total with its sum receipt, whether the set asks twice (any item
 * does), and why any item can't go in a set (the set is refused while any is listed).
 */
export interface QueueSetPreview {
  digest: string;
  items: { rowId: string; title: Display; kind: QueueKind; cost: Display }[];
  total: { display: Display; receiptId: string };
  secondAsk: boolean;
  refusals: { rowId: string; reason: string; line: Display }[];
}

export interface QueueUndoResult { restored: boolean; line: Display }

export interface TriagePreview { rule: TriageRule | null; choices: TriageRule[]; rows: QueueRow[]; digest: string; by: 'model' | 'choices' }

export interface TriageRuleView { rule: TriageRule; line: Display }

/** 4J2. One paragraph change between the accepted text and an agent's later edit. */
export type DraftChangeView = { id: string; paragraph: number; before: string; after: string; by: 'owner' | 'agent'; status: 'open' | 'taken' | 'dropped' };

/**
 * line: "You edited this. The agent's new version is beside yours." when the owner had their own version, else how the
 * agent's revision was merged; replacement: offered when the owner's version is stale beside the agent's new one.
 */
export interface DraftChangesView {
  changes: DraftChangeView[]; line?: Display;
  replacement?: { id: 'replacement'; status: 'open' | 'confirmed' | 'kept'; review: Display; confirm: Display; confirmLine: Display; keep: Display };
}

export type SettingsDraftView = { form: string; values: Json; at: IsoTime };

export interface SettingsDraftsView { drafts: SettingsDraftView[] }

export interface SettingsDraftSaved { form: string; at: IsoTime; line: Display }

/**
 * 4J4 (M13). How a money figure was made: reported (read from a file, with its row), calculated (code added it up, with
 * its receipt), assumption (an input taken as given, shown beside each result that uses it) or estimate (a model's,
 * always "model estimate" and never a receipt). source says where it came from in the same four ways.
 */
export type FigureKind = 'reported' | 'calculated' | 'assumption' | 'estimate';

export type FigureSource =
  | { from: 'file'; recordId: string; row: string; line: Display }
  | { from: 'receipt'; receiptId: string }
  | { from: 'input'; line: Display }
  | { from: 'model' };

/** 4J4 (M14). How a total was made: what it counted, whether it stopped short, and what it left out and why ("2 not counted: no rate"). */
export type TotalBasis = { filters: Display[]; truncated: boolean; notCounted: { count: number; line: Display } | null };

/**
 * 4J4. A money figure with its kind and source (M13) and the sum receipt that proves it. uses: the assumptions it rests
 * on, in words, to show beside it; projected: a forecast, never what happened; estimate: its receipt holds amounts not
 * known yet (calls still running at their estimate, or a forecast); basis: how a total was made (M14).
 */
export type KindedFigure = MoneyFigureView & { kind: FigureKind; source: FigureSource; uses?: Display[]; projected?: true; estimate?: true; basis?: TotalBasis };

/** 4J4. countLine: "1 invoice", "None". permille: of the total, floored, at least 1 for a bucket that holds anything. */
export type AgingBucketId = 'not-due' | '1-30' | '31-60' | '61-90' | 'over-90';

export type AgingBucketView = { id: AgingBucketId; label: Display; count: number; countLine: Display; amount: KindedFigure; permille: number };

/** One open invoice in the aging, oldest due first: late is null while it is not due yet. */
export type AgingInvoiceView = {
  invoiceId: string; number: string; client: string; dueDate: IsoDate; bucket: AgingBucketId; late: { days: number; line: Display } | null; balance: KindedFigure;
};

export interface AgingView {
  asOf: IsoDate;
  buckets: AgingBucketView[];
  total: KindedFigure;
  invoices: AgingInvoiceView[];
  line: Display;
  /** 4J20: what the late ones owe, with its own receipt (their aging sum); null when none is late. */
  late: KindedFigure | null;
}

/**
 * 4J4. A side with nothing recorded is null, never zero; left is null only when both are. receiptId: the left figure's.
 * note: "AI spend not counted: no rupee rate set" when the month had AI spend Chausar could not count in rupees.
 */
export type FlowMonthView = {
  month: string; label: Display; in: KindedFigure | null; out: KindedFigure | null; left: KindedFigure | null;
  inPermille: number | null; outPermille: number | null; receiptId: string | null; note: Display | null;
};

export interface FlowView { months: FlowMonthView[]; line: Display; basis: TotalBasis }

/** 4J4. Point 0 is today (what is in the bank now, actual); points 1 to 13 are the weeks ahead (projected). */
export type CashPointView = {
  week: IsoDate; label: Display; actual: KindedFigure | null; forecast: KindedFigure | null; actualPermille: number | null; forecastPermille: number | null;
};

/** 4J4. Money due in or out in the next three weeks, by date; the receipt is its week's, which names it. */
export type CashItemView = { on: IsoDate; line: Display; direction: 'in' | 'out'; amount: KindedFigure };

/** 4J20: a draft issued today: due on its terms from today, in that week, its total as priced. */
export type CashIssueView = { invoiceId: string; client: string; due: IsoDate; week: IsoDate; amount: KindedFigure };

export type CashLowest = KindedFigure & { week: IsoDate; line: Display };

export interface CashView {
  bank: (KindedFigure & { on: IsoDate }) | null;
  /** What is in the bank now: the statement's balance and what was recorded since it. */
  opening: KindedFigure | null;
  points: CashPointView[];
  /** 4Z2: each only when its lowest week falls below today's cash (opening); null when cash stays at or above it. */
  lowest: { onTime: CashLowest | null; ifLateNeverPay: CashLowest | null };
  /** The weekly usual costs the forecast takes as given (an assumption), with the receipt of the first week that uses it. */
  usualCosts: KindedFigure | null;
  /** C4 (T28): nothing is due in or out in the window and no usual costs are taken, so the line stays flat: why, in words. */
  flat?: Display;
  assumptions: Display[];
  nextWeeks: CashItemView[];
  /** 4J20: each draft invoice issued today, the week its money is due in and its total, proved by its price receipt. */
  ifIssued: CashIssueView[];
  /** Level lines with their labels, per mille of the chart's scale (zero, when the scale goes below it). */
  ticks: { permille: number; label: Display }[];
  /** What the forecast counted and what it left out (another currency, no due date). */
  basis: TotalBasis;
  line: Display;
}

export type MarginRowView = { clientId: string; client: string; invoiced: KindedFigure; spend: KindedFigure | null; margin: KindedFigure | null; note: Display | null };

export interface MarginsView { month: string; rows: MarginRowView[]; line: Display; basis: TotalBasis; /** C4 (T23): the spend is left out only for want of a rupee rate. */ needsRate?: boolean }

/** 4J4. The month's CSV for the owner's CA; cells that could run as a formula are prefixed. */
export interface MoneyExportFile { fileName: string; csv: string; rows: number; line: Display; receipts?: SignedReceiptsFile; /** C4 (T24): the name in owner words, and the business and the month for the read-me. */ ownerFileName?: string; business?: Display; period?: Display; format?: 'csv' | 'tally-xml' | 'gstr1-csv' }

/**
 * 4J10: the business's signed receipts with their signatures and the public halves of its keys, which the CA's export
 * carries and node scripts/verify-receipts.mjs checks offline. Never a private half.
 */
export type SignedReceiptsFile = {
  format: 'chausar-signed-receipts/1'; business: string; algorithm: 'ed25519'; publicKey: string | null; keys: { id: string; publicKey: string }[];
  receipts: { id: string; kind: ReceiptSignatureRecord['receiptKind']; receipt: unknown; signature: string; signedAt: IsoTime; publicKey: string }[];
};

/** 4J5. */
export type BillView = {
  id: string; vendor: string; billDate: IsoDate; dueDate: IsoDate; total: Display; paid: Display; balance: Display;
  state: 'draft' | 'posted' | 'partial' | 'paid' | 'overdue'; recurring: 'monthly' | 'quarterly' | null;
  /** 4J20 (bills.list): the receipt of this bill's balance (its lines and tax less what was paid). */
  receiptId?: string;
  /** One-shot C4 (T22): a posted bill with money left on it, due on the owner's own day today. */
  dueToday: boolean;
  /** One-shot C4 (T22): what it is for, from its lines ("Printer paper, and 1 more"); null when a line only names the vendor. */
  purpose: string | null;
};

/**
 * owed: what open bills add up to, with its receipt; null when nothing is owed. One-shot C4 (T22): terms, each vendor's
 * days from bill date to due date on its newest bill, and defaultDueDays for a vendor with none, which bills.add uses
 * when no due date is given.
 */
export interface BillsView { bills: BillView[]; owed?: MoneyFigureView | null; terms?: { vendor: string; days: number }[]; defaultDueDays?: number }

export interface BillResult { bill: BillView; receiptId?: string }

export type CreditNoteView = { id: string; invoiceId: string; amount: Display; reason: string; state: 'waiting' | 'issued' | 'cancelled'; number: string | null; rowId: string | null; line: Display;
  /** 4J20: the receipt that names the note's amount (the invoice's balance with it), while waiting or issued; null once cancelled. */
  receiptId: string | null };

export type RecurringInvoiceView = { id: string; clientId: string; offerId: string; frequency: 'monthly' | 'quarterly'; startOn: IsoDate; end: IsoDate | null; nextOn: IsoDate | null; line: Display };

export interface RecurringInvoicesView { items: RecurringInvoiceView[] }

/** 4J6. A business that opens with a passphrase shows nothing until opened; others show their snapshot "as of" when last opened. */
export type BusinessSnapshotView = { businessId: string; name: string; open: boolean; locked: boolean; asOf: IsoTime | null; line: Display; lineKey: AcrossLineKey };

/**
 * 4J6. What a row's line says, so a screen can word it in Hindi: open now, no country yet, as of asOf (and still being
 * set up then), locked with a passphrase, the key missing on this computer, unreadable, or nothing saved yet.
 */
export type AcrossLineKey = 'open' | 'no-country' | 'as-of' | 'as-of-setting-up' | 'locked' | 'key-missing' | 'unreadable' | 'none';

/** 4J6. One business a total or count left out, and why (month: the month its summary was saved in, for other-month). */
export type AcrossLeftOut = { businessId: string; name: string; why: 'locked' | 'key-missing' | 'unreadable' | 'none' | 'setting-up' | 'other-month'; month: string | null };

/**
 * 4J6. receipts: a receipt in the open business for each figure shown (the open business's own sums; for another
 * business, a receipt that says what its snapshot saved and when). Its own receipts open only after switching to it.
 * total: what was invoiced in `month` before tax across the businesses it could count, only when they share one
 * currency (added in BigInt from the minor amounts); line says which were left out and why. lineKey, counted,
 * currencies and notCounted say the same in parts, so a screen can word it in Hindi.
 */
export interface AcrossMoneyView {
  /** spendRupees, spendRate (4J20): the spend in rupees at the owner's own rate, and that rate in words; absent without one. */
  businesses: (BusinessSnapshotView & { invoiced: Display | null; received: Display | null; owed: Display | null; late: number | null; spend: Display | null; spendRupees?: Display; spendRate?: Display; spendLead?: SpendLead; receipts?: Partial<Record<AcrossFigureId, string>> })[];
  total: MoneyFigureView | null;
  line: Display;
  lineKey: 'counted' | 'currencies' | 'nothing'; month: string; counted: number; currencies: string[]; notCounted: AcrossLeftOut[];
}

export interface AcrossRunsView {
  businesses: (BusinessSnapshotView & { working: number | null; waiting: number | null; stopped: number | null; needsYou: number | null })[];
  line: Display;
  /** The sums the line states, and the businesses it left out (4J6), so a screen can word it in Hindi. */
  totals: { working: number; waiting: number; stopped: number; needsYou: number; businesses: number }; notCounted: AcrossLeftOut[];
}

/** 4J7. */
export type ConnectorCheckRow = { connectorId: string; name: string; outcome: 'answered' | 'failed' | 'skipped'; line: Display; account: string | null; expiresOn: IsoDate | null; fix: Display | null };

export interface ConnectorChecksView { at: IsoTime; rows: ConnectorCheckRow[]; health: { ready: number; warnings: number; blocking: number } }

export interface FileRequestView { id: string; orderId: string; url: string | null; reason?: Display; expiresAt: IsoTime; line: Display }

/**
 * 4J8. One way to earn per registered playbook that runs today (playbooks/ways.ts). The hours and what clients usually
 * pay are a model's, so both are labelled a model estimate with their basis (clientsPay.source), never a receipt or a
 * promise. department: the playbook's own (its service type's, 4A1), for the icon tint. team: the playbook's agents
 * only (code is never shown as AI), with their departments. starter: a sentence a tile's Start puts in the one-sentence
 * box (never sent by itself); it picks this playbook. yours: the businesses of this kind the host named (the open one;
 * 4J6 adds the others), never from a payload.
 */
export type WayCategory = 'content' | 'marketing' | 'money-and-tax' | 'shops-and-firms';

/** needs: what the way needs in plain words, besides the owner's time (hours): the owner's own AI, and the connections that work today. */
export type WayNeeds = { ai: Display; connections: Display };

export type WayView = {
  id: string; playbook: string; label: Display; category: WayCategory; department: DepartmentId; line: Display;
  hours: Display; minHours: number; maxHours: number; hoursEstimate: true; youDo: Display;
  team: { role: string; initials: string; department: DepartmentId }[]; teamLine: Display;
  /**
   * W6 6C3 (D17): where the way's profession has a credible range for this service, text and per are that range's,
   * estimate is false and source names its publishers and date; otherwise they are the model estimate as before.
   * guide: the profession's sourced ranges or "No reliable data"; absent when the way maps to no beta profession.
   * rangeId: which of the guide's ranges is shown, only when estimate is false.
   */
  clientsPay?: { text: Display; per: Display; estimate: boolean; source: Display; guide?: PriceGuideView; rangeId?: string };
  /**
   * W6 F4 (founder, 2 November 2026): a desk the owner runs for themselves (kit ownUse) has no clientsPay. saves says
   * what it saves the owner instead: text the hours a month ("2 to 6 h a month"), always a model estimate with its basis
   * (source), and line what it keeps straight, in words. Every other way has clientsPay and no saves.
   */
  saves?: { text: Display; line: Display; estimate: true; source: Display };
  needs: WayNeeds;
  starter: Display;
  yours: { businessId: string; name: string }[];
  /** W6 6E6 (D2): the profession families this way serves (core/professions.ts), in the families' order. */
  families: FamilyId[];
};

/** categories: only those with a way, with counts; upTo: the "Up to 5 h a week" filter (maxHours at most 5) and its count. */
export interface WaysView {
  ways: WayView[];
  categories: { id: WayCategory; label: Display; count: number }[];
  upTo: { maxHours: number; label: Display; count: number };
  /** W6 6E6 (D2): the families that have a way, in the families' order, each with its count of ways. */
  families: { id: FamilyId; label: Display; count: number }[];
}

/**
 * 4J8. One change a plan suggestion makes, in plain words: before and after (empty before for an offer added).
 * estimate is always false: a suggestion's words never hold a number or a price, so nothing in them is an estimate.
 */
export type PlanChangeView = {
  field: 'oneLiner' | 'customer' | 'offer-name' | 'offer-description' | 'offer-added'; offerId: string | null;
  before: Display; after: Display; line: Display; estimate: boolean;
};

/**
 * 4J8. "Add this to {business}": the open business's own AI suggests how the plan's words change, and at most one new
 * offer, to take in the owner's sentence (and a dropped file, as background only). patch: exactly what
 * venture.blueprint.update takes, or null when nothing changes; the owner applies it there with basedOn (their own
 * action; a plan changed since is refused as stale), then accepts the plan as today. Never a price: a new offer starts
 * with none (left says so). Nothing is stored but the call's own record.
 */
export interface PlanSuggestionView {
  basedOn: { blueprintId: string; digest: string };
  patch: BlueprintPatch | null;
  changes: PlanChangeView[];
  attachment?: ComposeAttachmentNote;
  left: Display;
  line: Display;
  callId: string | null;
}

/** 4J9. kept: only on the answer that removed a stored name, Forget's backups line (earlier backups still hold it). */
export interface OwnerView { firstName: string | null; excludedServices: string[]; businessName: string; kept?: Display[]; familyId?: FamilyId | null }

/** 4J10. reason (4J22a): only 'changed' and 'unsigned-since' are mismatches; the others are not confirmed. */
export type ReceiptVerifyReason = 'signed' | 'changed' | 'unsigned-since' | 'unsigned-old' | 'no-key' | 'key-gone';

export interface ReceiptVerifyView { id: string; valid: boolean; label: 'reproduction_ready' | 'incomplete' | 'signature_only'; reason: ReceiptVerifyReason; line: Display }

/** digest: what the owner saw (the first bad entry and the newest), sent back to accept exactly this break. */
export interface JournalChainView { state: 'ok' | 'corrupt'; entries: number; firstBadSeq: number | null; line: Display; digest: string }

/**
 * 4J12. The newest revision: proposedBy who wrote it (an agent may change only scope and checks), items each
 * deliverable's and check's state from its newest mark, with the evidence or reason.
 */
export interface OrderContractView {
  orderId: string; contract: OrderContract; revision: number; digest: string; signed: { at: IsoTime; by: string } | null; line: Display;
  proposedBy?: 'owner' | 'agent';
  items?: OrderContractItem[];
}

export type OrderContractItem = { id: string; kind: 'deliverable' | 'check'; state: 'open' | 'done' | 'skipped'; evidence: Display | null; reason: Display | null };

/** 4J13. when: the schedule in words with its time zone. prompt (4J22a): sent back to turn it off, on or change it; only
 * for a role that may change routines (owner, cofounder). */
export type RoutineView = { /** C7: a trigger's facts: what each event sends, in words. */ facts?: Display[]; id: string; name: string; agent: string | null; prompt?: string; recordReport?: 'va-morning' | 'va-weekly'; schedule: RoutineSchedule; when: Display; on: boolean; next: IsoTime | null; line: Display };

export interface RoutinesView { routines: RoutineView[] }

/**
 * One-shot C4 task 32: a ready routine the plan already names, for the owner to add through the form (nothing stored).
 * step: the plan's step it comes from; when: the schedule in words.
 */
export type RoutineSuggestion = { name: string; agent: string | null; prompt: string; schedule: RoutineSchedule; when: Display; step: string };

export interface RoutineSuggestionsView { suggestions: RoutineSuggestion[] }

/** receipt (W6 6G5): the model receipt of a run that asked an AI; absent before it ran. */
/** ranOn (C7): the backup AI the run went to and why, in owner words. */
export type RoutineRunView = { id: string; dueAt: IsoTime; state: RoutineRunState; line: Display; receipt?: ModelReceiptView; ranOn?: Display };

export interface RoutineRunsView { runs: RoutineRunView[] }

export type RoutineInput = { id?: string; name: string; agent?: string | null; prompt: string; schedule: RoutineSchedule; on: boolean; recordReport?: 'va-morning'|'va-weekly' };

/** 4J14. Options already scored, reordered by the owner's weights in code; a model figure is an estimate only. */
export type RankedOptionView = { id: string; label: Display; text: Display; score: number; estimate: Display | null; failed: boolean };

export interface RerankView { options: RankedOptionView[] }

/** 4J15. */
export type DrillRunView = { id: string; at: IsoTime; playbookHash: string; version: number | null; passed: boolean; results: { drill: Display; stopped: boolean; twinPassed: boolean; line: Display }[] };

export interface DrillRunsView { runs: DrillRunView[] }

/** 4J15. Even with every item met, auto with spot checks stays locked. */
export interface AutoReadinessView { agent: string; items: { id: string; label: Display; met: boolean; line: Display }[]; locked: true; line: Display }

/** 4J15. A dash where a figure is unknown (null). */
export interface ShadowSummaryView { agent: string; wouldHaveGone: number | null; held: number | null; changed: number | null; offers: Display[]; line: Display }

/** 4J16. Each guidance line with the check that can see it. */
export type GuidanceLineView = { stepId: string; text: string; check: string | null; state: 'measured' | 'dark' | 'unmeasured' };

/**
 * 4J16 (Q15): a part of the drafts the owner corrected in at least 60 percent of at least 3 reviews. It changes nothing:
 * the owner says the rule in that agent's chat (starter prefills it and is never sent), as a 4B1 proposal.
 */
export type FixTheRuleView = { field: string; stepId: string | null; agent: string | null; corrected: number; reviews: number; line: string; starter: string };

export interface GuidanceView { lines: GuidanceLineView[]; fixTheRule?: FixTheRuleView[] }

/**
 * 4J17. version: the one in use for that language and channel; undo: the voice to set to go back to the version before
 * (null at the first). draft: what venture.voice.learn worked out, unsaved until the owner sets it, with its check line.
 */
export type VoiceView = {
  voices: { language: 'en' | 'hi'; channel: string | null; on: boolean; sections: VoiceSections; validated: boolean; version?: number; undo?: VoiceInput | null }[];
  line: Display;
  draft?: { language: 'en' | 'hi'; channel: string | null; sections: VoiceSections; validated: boolean; learnedFrom: number; lines: string[]; line: Display } | null;
};

export type VoiceInput = { language: 'en' | 'hi'; channel?: string | null; on: boolean; sections: VoiceSections };

/** 4J17. An agent's skills with a "try this" starter that prefills and never sends. */
export type AgentSkillView = { name: Display; line: Display; starter: string };

/** 4J17. version: the persona in use (0 before any is set); undo: the persona to set to go back one version (null at the first). */
export interface PersonaView { agent: string; persona: PersonaFields; skills: AgentSkillView[]; line: Display; version?: number; undo?: PersonaFields | null }

export interface PersonaTestView { results: { scenario: Display; reply: string }[]; cost: Display; line: Display }

/** 4J17. An agent's steps, persona and standing orders, without notes. */
export interface AgentExportFile { fileName: string; text: string }

/** 4J18. */
export type KnowledgeSourceInput =
  | { kind: 'text'; title: string; text: string }
  | { kind: 'link'; url: string }
  | { kind: 'file'; uploadId: string }
  | { kind: 'past-work'; runId: string };

export type KnowledgeSourceView = { id: string; kind: KnowledgeRecord['sourceKind']; title: string; at: IsoTime; line: Display };

/**
 * requests: "To answer 6 questions from October 2026 well, add files about refunds and delivery times", one a month.
 * line: who reads the sources, in honest words: each act and writing turn carries the ones that share words with its
 * order, screened again as read (agents/knowledge-recall.ts).
 */
export interface KnowledgeView { sources: KnowledgeSourceView[]; requests: Display[]; line: Display }

export interface KnowledgeTestView { hits: { sourceId: string; title: string; line: Display }[]; line: Display }

export type IdeaView = { id: string; title: Display; reason: Display; evidence: { id: string; line: Display }[]; prompt: string };

/** 4J18. Who is waiting on the owner: real records only. */
export type WaitingOnYouView = { id: string; recordId: string; line: Display };

/** pipeline (Ink v2 wave 5, 5A3): the ideas the owner and the agents added, newest first, on the same records. */
export interface IdeasView { ideas: IdeaView[]; waiting: WaitingOnYouView[]; pipeline: PipelineIdeaView[] }

export interface IdeaStarted { proposal: ProposalView | null; suggestion: AgentSuggestion | null; line: Display }

/**
 * 4J18. One line of the capability page: its list, what it is about (key: tool:<name>, step:<id>, input:<kind>,
 * outbox:<connector>, model:provider, effect:<kind>, host:<name>, cli:<name>, or nothing), and its honest state, so a
 * screen can word it in Hindi. 'records': Chausar only records it for the owner (an outbox proposal).
 */
export type CapabilityItemView = { list: 'see' | 'do' | 'off'; key: string; state: 'works' | 'reads' | 'records' | 'hands-off' | 'planned' | 'off'; line: Display };

/**
 * 4J18. What an agent can see, can do, and "if it is off here, it can't do it"; an empty list never means everything.
 * canSee, canDo and off are the lines of items, list by list.
 */
export interface CapabilityPageView { agent: string; canSee: Display[]; canDo: Display[]; off: Display[]; items: CapabilityItemView[]; line: Display }

/** A business on this computer as the views see it. id is its workspace folder, the id workspace.list uses. */
export type VentureBusinessRef ={ id: string; name: string | null; opens: 'with-this-computer' | 'needs-passphrase' | 'key-missing'; openedAt: string | null };

/**
 * Trusted host composition, never from a payload: what the views may know about the businesses on this computer.
 * The engine passes it; tests inject a stub. Without it the queue covers the open business only.
 */
export type VentureWorkspacePort = {
  /** The open business. */
  current(): { id: string; name: string };
  /** Every business on this computer, the open one included. Empty on the hosted web server. */
  businesses(): Promise<VentureBusinessRef[]>;
  /** Whether the open business has a recovery code; null when this host keeps no such record. */
  recovery(): Promise<'made' | 'not-made' | 'unknown' | null>;
  /**
   * Ink v2 wave 4 (4A1, Keeper's backups job): whether automatic backups are on, and the automatic backups only (a copy
   * the owner made by hand or a safety copy is not Keeper's run): how many, the newest, when the next is due, and the
   * schedule's last error. null where this host keeps none (the hosted web server, a computer without custody).
   */
  backups?(): Promise<{ auto: boolean; count: number; newestAt: IsoTime | null; nextDueAt: IsoTime | null; lastError: string | null } | null>;
  /**
   * C5 task 17: writes one file of the open business in Chausar's own exports folder, under the managed name
   * chausar-<workspace id>-<tail>, and answers its name; null where this host keeps no folder (the hosted app).
   */
  keepFile?(tail: string, text: string): Promise<string | null>;
  /** C5 task 22: the open business's readable copies on this computer the owner hasn't said to keep, by file name and time. */
  readableExports?(): Promise<{ file: string; at: IsoTime }[]>;
  /** C5 task 22: Keep it: that copy is never asked about again. */
  keepReadable?(file: string): Promise<void>;
  /** C5 task 22: Delete: removes exactly that copy. */
  deleteReadable?(file: string): Promise<void>;
  /**
   * Ink v2 wave 4 (4J6): what Chausar saved about each other business on this computer when it was last open, the open
   * one left out. A business that opens with a passphrase (or whose key this computer lost) is never read: `locked`. A
   * saved file that is tampered with, from another computer, or for another vault is `unreadable`. Empty on hosted.
   */
  snapshots?(): Promise<BusinessSnapshotRead[]>;
  /**
   * 4J6 (C10): the never-contact list the businesses on this computer share, as keyed one-way checks only. has: whether
   * any of these addresses (an email, a phone in E.164, a LinkedIn profile address) is on it; it throws TIER_UNAVAILABLE
   * when the list holds checks and this computer's key does not answer. add: puts them on it for good. Absent on hosted.
   */
  neverContact?: { has(values: readonly string[]): Promise<boolean>; add(values: readonly string[]): Promise<void> };
};

/** 4J6. One figure a snapshot keeps: the amount in minor units (micro-dollars for AI spend), as shown, and its receipt in its own business. */
export type SnapshotFigure = { amount: string; unit: 'minor' | 'micros'; currency: string; display: Display; receiptId: string };

/**
 * 4J6. The minimum another business may know about one that is closed: its name, the playbook its idea picks, when this
 * was taken, money (this month's invoiced and received on its own calendar month `month`, owed and late as of then, AI
 * spend this UTC month) and counts of runs and of what needs the owner. Never a client's name, a title, a message or a
 * file. money is null for a business still in its interview (no country yet).
 */
export type BusinessSnapshot = {
  format: 'chausar.snapshot.v1'; businessId: string; vaultId: string; name: string; playbook: string | null; asOf: IsoTime;
  money: { month: string; currency: string; invoiced: SnapshotFigure; received: SnapshotFigure; owed: SnapshotFigure; late: number; spend: SnapshotFigure } | null;
  runs: { working: number; waiting: number; stopped: number }; needsYou: number;
};

/** 4J6. Another business as its snapshot reads: none saved yet, locked (never read), unreadable, or the snapshot. */
export type BusinessSnapshotRead = VentureBusinessRef & { read: 'saved' | 'none' | 'locked' | 'unreadable'; snapshot: BusinessSnapshot | null };
