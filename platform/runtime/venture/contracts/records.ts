// Venture records contract. Types only; public imports use ../contracts.ts.
import type { DEPARTMENT_IDS, PROPOSAL_KINDS, NETWORK_IMPORT_KINDS, TIE_BANDS, SEARCH_FIELDS, PIPELINE_STAGES, LOST_REASONS, OUTREACH_KINDS } from '../contract-values.ts';
import type { FamilyId } from '../core/first-run-types.ts';
import type { LayoutBy, LayoutChange, LayoutPlace, LayoutState } from '../views/layout-core.ts';
import type { IdeaPipeline } from '../playbooks/kit/records-rules.ts';
import type { MailAttachment } from '../build/records-connect.ts';
import type { BpsString, IsoDate, IsoTime, Json, LineAuthor, MinorString, PricingModel, RecordBase } from './business.ts';
import type { Display } from './spend.ts';
import type { DelegateCli, DeliveryRunStatus, HarnessState, PlaybookPatch, ScreenNote } from './delivery.ts';
import type { ModelPresetId } from './models.ts';
import type { PaymentMethod, PriceFigure } from './money.ts';
import type { WriteCapKind } from './views.ts';
import type { QueueKind } from './queue.ts';

export type DepartmentId = typeof DEPARTMENT_IDS[number];

/** Keeper's jobs: the engine's own work, run as code, never AI (4A1). The probes (4G2) and the calendar feed (4E3) write runs too. */
export type KeeperJobId = 'backups' | 'journal-sweep' | 'connection-checks' | 'rule-freshness' | 'rate-tables' | 'posting-steps' | 'network-strength' | 'probes' | 'calendar-feed'
  | 'monitors';

// 5A6 (K16): the owner's page monitors
export type KeeperOutcome = 'ok' | 'warn' | 'failed';

/** The last run of one Keeper job: one record per job, replaced each run (4A1). */
export type KeeperRunRecord = RecordBase<'venture-keeper-run'> & { job: KeeperJobId; outcome: KeeperOutcome; line: string };

/**
 * The owner cleared an agent's quarantine (4A1, venture.team.clearQuarantine), with the health digest and reason they
 * saw. Health counts failed runs and undeclared outside actions only after the newest clear for that agent.
 */
export type HealthClearRecord = RecordBase<'venture-health-clear'> & { agentId: string; digest: string; reason: string };

/** Who wrote a line in an agent's thread: the owner, the agent, or Chausar passing on the chief's brief (4C1 brief-agent). */
export type AgentMessageFrom = 'owner' | 'agent' | 'chausar';

/**
 * A typed part of a chat answer (4B1, 4C1): words; a figure that a tool of this answer returned, with its receipt and
 * key; or a number the model wrote, shown as a model estimate. Code checks every figure part before it is stored.
 */
export type ChatPart =
  | { kind: 'text'; text: string }
  | { kind: 'figure'; receiptId: string; key: string; display: Display }
  | { kind: 'estimate'; text: string }
  /** C7: a section of Chausar's own guide, its words filled in by code from guide-data.json, with the link to it. */
  | { kind: 'guide'; anchor: string; title: string; text: string; link: string };

/** What an agent's reply suggests the screen opens: a New order sheet prefilled with the owner's request. Nothing is created (4B1). */
/** C5 task 5: connect-ai is the next step under a reply written without an AI; set by code, never read from model text. */
export type AgentSuggestion = { kind: 'order'; offerId: string | null; request: string } | { kind: 'connect-ai' };

/** One message in an agent's thread (4B1). answered: it was recorded as the answer to that run's open question (A2). */
export type AgentMessageRecord = RecordBase<'venture-agent-message'> & {
  agent: string;
  from: AgentMessageFrom;
  text: string;
  parts: ChatPart[];
  author: LineAuthor;
  callId: string | null;
  runId: string | null;
  proposalId: string | null; // an instruction or note proposal (venture-agent-proposal), or a drafted proposal (venture-proposal)
  suggestion: AgentSuggestion | null;
  answered: { runId: string; handoff: number } | null;
};

/**
 * 'instruction': a "from now on" change to the agent's steps (4B1); 'note': a note from the owner's own words (4B2);
 * 'import': an agent file's standing orders and persona, never a direct change (4J17).
 */
export type AgentProposalKind = 'instruction' | 'note' | 'import';

export type AgentProposalStatus = 'drafted' | 'accepted' | 'rejected';

/** One line of a change to a step's guidance, with the lines around it. */
export type DiffLine = { op: 'same' | 'add' | 'remove'; text: string };

/** 'always': loaded into every act task of the agent, 2,000 characters in all; 'topic': recalled when it shares a word with the order (4B2). */
export type AgentNoteLoad = 'always' | 'topic';

export type AgentNoteScope = 'agent' | `client:${string}`;

/**
 * A change the owner's words asked for, waiting for Accept (4B1, 4B2). An instruction holds the typed patch (proposedBy
 * 'owner'), the versions, the hash of the playbook it was drafted against and the step's guidance as diff lines; a
 * note holds the note as it will be saved. quoteDigest: a rejected quote is never proposed again.
 */
export type AgentProposalRecord = RecordBase<'venture-agent-proposal'> & {
  agent: string;
  proposalKind: AgentProposalKind;
  quote: string;
  quoteDigest: string;
  messageId: string | null;
  patch: PlaybookPatch | null;
  fromVersion: number | null;
  toVersion: number | null;
  parentHash: string | null;
  diff: DiffLine[];
  appliesTo: string | null;
  note: { scope: AgentNoteScope; load: AgentNoteLoad; text: string } | null;
  label: string | null; // 'Drafted by Chausar from your words' when templates drafted it
  status: AgentProposalStatus;
  digest: string;
  decidedAt: IsoTime | null;
  decidedBy: string | null;
  /** 4J17 (A18), kind 'import': the owner patches an agent file adds, the persona it sets, and what was left out with why. */
  imported?: { patches: PlaybookPatch[]; persona: PersonaFields | null; skipped: string[] };
  /** C7: an instruction the agent offered after the owner signed off a draft they edited (agents/way-of-working.ts). */
  offered?: { runId: string; digest: string };
};

/**
 * One chat consent per business covers agent chat, Chats and network search, which send client or contact data to the
 * owner's AI (4B1). It names the connected AI; a change of AI connection makes it stale.
 */
export type ChatConsentRecord = RecordBase<'venture-chat-consent'> & {
  textDigest: string;
  presetId: ModelPresetId | null;
  connectionId: string | null;
  model: string | null;
  by: string;
  /** C7: a backup AI's consent for routines, given when the owner turned the backup on; the main chat consent ignores it. */
  backup?: true;
};

/** A note an agent keeps (4B2), from the owner's own words only. scope 'client:<id>' when the words name a client. */
export type AgentNoteRecord = RecordBase<'venture-agent-note'> & {
  agent: string;
  scope: AgentNoteScope;
  load: AgentNoteLoad;
  text: string;
  source: { kind: 'owner-words' | 'owner-edit'; quote: string | null; messageId: string | null };
  captured: IsoDate;
  hash: string;
  forgotten: boolean;
};

export type NoteSnapshot = { text: string; hash: string; scope: AgentNoteScope; load: AgentNoteLoad };

/** Every change to a note, so it can be undone exactly (4B2): who made it, and the note before and after. */
export type AgentNoteChangeRecord = RecordBase<'venture-agent-note-change'> & {
  agent: string;
  noteId: string;
  who: 'owner' | 'cofounder' | 'proposal' | 'undo';
  before: NoteSnapshot | null;
  after: NoteSnapshot | null;
  undoOf: string | null;
};

/** A Chats thread with Chausar as chief of staff (4C1), in the open business's vault. routine: the routine that posts into it (4J13). */
export type ChiefThreadRecord = RecordBase<'venture-chief-thread'> & {
  title: string; pinned: boolean; routine: string | null; lastAt: IsoTime;
  /** W6 6G1 (D42): the owner's snooze (its wake time), their Settle, and when they last changed the chat's state. */
  snoozedUntil?: IsoTime | null; settledAt?: IsoTime | null; stateAt?: IsoTime | null;
};

/** W6 6G1: the owner's number of quiet days before a chat settles on its own (0 is never); the newest is in use. */
export type ChatSettleRecord = RecordBase<'venture-chat-settle'> & { days: number };

/** W6 6H3 (D40): one change to an owner's layout of a place (views/layout-core.ts), who made it and its line. */
/** C5 task 1: every agent this member has met on Team; the newest of theirs is in use. */
export type TeamIntroRecord = RecordBase<'venture-team-intro'> & { agentIds: string[] };

export type LayoutRecord = RecordBase<'venture-layout'> & { place: LayoutPlace; state: LayoutState; by: LayoutBy; line: string; op: LayoutChange['op'] };

/** W6 6H3: the owner's AI offered a place; the app shows a link the owner opens, never opening it by itself. */
export type LayoutGoRecord = RecordBase<'venture-layout-go'> & { href: string; title: string };

/** One message in a Chats thread (4C1): the owner's words, or the chief's typed answer with the receipts its tools returned. */
export type ChiefMessageRecord = RecordBase<'venture-chief-message'> & {
  /** Regenerable private source summary; Forget removes it rather than retaining anonymous copied text. */
  recordReport?: true;
  threadId: string;
  from: 'owner' | 'chief';
  text: string;
  parts: ChatPart[];
  author: LineAuthor;
  callIds: string[];
  receiptIds: string[];
  proposalIds: string[];
  routedTo: string | null; // the agent a message beginning with its name went to (A15)
  /** W6 6G1: the chief's question back ("Which agent...?"), waiting for the owner until they write again. */
  ask?: string | null;
  read: boolean;
  /** 4C1: the receipted figures the answer quotes, for the "Worked by the calculator" table. */
  worked?: { label: string; value: string; receiptId: string }[];
  /** 4C1: the engine's lines for what the answer left out (a figure with no receipt, a proposal Chausar cannot make). */
  dropped?: string[];
  /** 4C2 review: the counts by code (4J14, Q21) when the AI's answer failed or there is no AI, for the screen to word. */
  counted?: ChiefCounted | null;
  /** C5 task 5: an answer written with no AI carries Connect your AI as a button. */
  suggestion?: { kind: 'connect-ai' };
};

/** 4C2 review: what code counted from the vault: each kind's records, and the new ones in each month (oldest first). */
export type ChiefCounted = { entities: { kind: string; count: number }[]; months: { month: string; count: number }[] };

export type ProposalKind = typeof PROPOSAL_KINDS[number];

export type ProposalStatus = 'drafted' | 'raised' | 'approved' | 'dismissed' | 'refused';

/** A proposal (4C1): drafted, raised to Today, then approved or dismissed. input: what the engine method for its kind takes. */
export type ProposalRecord = RecordBase<'venture-proposal'> & {
  proposalKind: ProposalKind;
  /** W6 6H1: 'app', a mini app proposed it (appId); it is raised on Today at once and decided like any other. */
  source: 'chief' | 'agent' | 'meeting' | 'idea' | 'app';
  appId?: string | null;
  threadId: string | null;
  messageId: string | null;
  agent: string | null;
  title: string;
  line: string;
  input: Json;
  spends: boolean;
  sends: boolean;
  status: ProposalStatus;
  digest: string;
  raisedAt: IsoTime | null;
  decidedAt: IsoTime | null;
  decidedBy: string | null;
  outcome: string | null;
};

export type NetworkImportKind = typeof NETWORK_IMPORT_KINDS[number];

/** Where one fact about a person came from: an import's row, the owner's own words, or a public page (4D3). */
export type SourceRef = { connector: NetworkImportKind | 'owner' | 'web'; importId: string | null; row: number | null; url?: string };

/** 'link' (4D2): the owner said this person knows another (detail { personId, note }); a warm path's second leg on the owner's word. */
export type PersonFactKind = 'name' | 'email' | 'phone' | 'linkedin' | 'role' | 'meeting' | 'mail' | 'message' | 'connection' | 'contact' | 'client' | 'you-said' | 'web' | 'link';

/** One fact about a person with its source row. detail holds kind-specific fields (a meeting's attendee count, a mail's direction). */
export type PersonFact = { id: string; kind: PersonFactKind; value: string; date: IsoDate | null; detail: Json | null; source: SourceRef };

export type PersonRole = { title: string | null; company: string | null; asOf: IsoDate | null; source: SourceRef };

/** A person in the owner's network (4D1). roles keeps earlier roles a re-import replaced (4D3); history journals merges and splits. */
export type PersonRecord = RecordBase<'venture-person'> & {
  name: string;
  handles: { emails: string[]; phones: string[]; linkedinUrl: string | null };
  role: PersonRole | null;
  roles: PersonRole[];
  facts: PersonFact[];
  hidden: boolean;
  clientId: string | null;
  history: { op: 'import' | 'merge' | 'split' | 'hide' | 'show' | 'know' | 'link'; from: string[]; at: IsoTime; by: string }[];
};

/** One import of the owner's file (4D1): what it read, made, merged and dropped (message text, photos, notes). */
export type NetworkImportRecord = RecordBase<'venture-network-import'> & {
  importKind: NetworkImportKind;
  fileName: string;
  digest: string;
  rows: number;
  people: number;
  merged: number;
  dropped: { what: string; count: number }[];
  forgottenSkipped: number;
  undoneAt: IsoTime | null;
  /**
   * People already in the network that this import merged into another (into), as they were, and the records the merge
   * moved from them to into (cards, drafts, evidence rows, search entries by index, people whose split history now names
   * into), so Undo puts every one back exactly.
   */
  absorbed?: NetworkAbsorbed[];
  /** People already here this import changed: their client link and hidden flag before and after, for Undo. */
  before?: { id: string; clientId: string | null; hidden: boolean; clientIdAfter: string | null; hiddenAfter: boolean }[];
};

export type NetworkAbsorbed = {
  into: string;
  person: PersonRecord;
  /**
   * searches: each moved result by what it holds (fit, page, checks) and how many shown entries moved, so Undo finds them
   * by person even after other entries went. copies: older imports' Undo copies (by the person they hold) that pointed at
   * the person merged away and now point at into.
   */
  repointed: {
    cards: string[]; drafts: string[]; evidence: string[]; searches: { id: string; results: { fitBp: number; url: string | null; checks: string }[]; shown: number }[];
    splits: string[]; copies?: { importId: string; persons: string[] }[];
  };
};

/**
 * A person the owner asked Chausar to forget (4D1): a keyed one-way check of each handle (HMAC-SHA256 with the business's
 * network key, which lives on the engine's secret shelf, never in a record), so a later import skips them; names: the
 * same keyed check of each word of their name (three letters or more), so a later meeting title naming them reads
 * "Meeting". kept: what the law keeps. Empty lists: there was no key to make the checks with.
 */
export type ForgottenRecord = RecordBase<'venture-forgotten'> & {
  hashes: { kind: 'email' | 'phone' | 'linkedin'; hash: string }[]; names: string[]; kept: string[]; by: string; scheme: 'hmac-sha256';
};

export type TieBand = typeof TIE_BANDS[number];

export type TieSignalKind = 'mail-both' | 'mail-one' | 'meeting' | 'client' | 'contact' | 'linkedin-messages' | 'linkedin-connection' | 'you-said';

/**
 * One signal of a tie, in basis points, faded by its half-life from its last date (4D2). count: what the weight is
 * multiplied by (months, meetings) or 1; weightBp: after the cap, before fading. source: where it came from, in words
 * ('Email export, takeout.mbox'); line: what it is ('Mail both ways in 6 months, the last on 20 Oct 2026').
 */
export type TieSignal = { kind: TieSignalKind; count: number; last: IsoDate | null; weightBp: number; decayedBp: number; source: string; line: string };

/**
 * How well the owner knows one person, computed in code (4D2). digest: over what the tie rests on (each signal's kind,
 * count, last day, weight, source and line) and its band; a tie keeps its id while that stays the same.
 */
export type TieRecord = RecordBase<'venture-tie'> & { personId: string; signals: TieSignal[]; scoreBp: number; band: TieBand; computedAt: IsoTime; digest: string };

/** One step of a tie receipt, in whole numbers: a weight times its count, a cap, a fade, the sum, the band. */
export type TieStep = { op: 'multiply' | 'cap' | 'fade' | 'add' | 'band'; inputs: string[]; result: string; rule: string };

/**
 * A tie's receipt (4D2), served by venture.receipt.get beside price and sum receipts: one line per signal with its
 * source, and every step from the weights to the band, worked out by code from the stored tie, never by a model. stale:
 * what the tie rests on has changed since (venture.network.recompute works it out again).
 */
export type TieReceipt = {
  id: string; kind: 'venture-tie'; ventureId: string; at: IsoTime; personId: string; operation: 'venture.tie'; unit: 'bp';
  lines: Display[]; steps: TieStep[]; figures: PriceFigure[]; totalBp: string; band: TieBand; allowedNumbers: string[];
  explanation: Display; digest: string; stale: boolean;
};

/**
 * A receipt for a figure a Today row states (4J1), served by venture.receipt.get beside price, sum and tie receipts and
 * worked out again by code from the stored record it names on every read, never by a model: the most a call can cost
 * from the price table, the room a cap window adds, a spend quote, the prices a plan version sets, this month's spend
 * against its limit. Each figure's amount is in its own unit: 'micros' (micro-USD), 'minor' (the currency's minor unit)
 * or 'rate' (rupees per dollar in ten-thousandths). stale: the record no longer says this.
 */
export type RowFigure = { key: string; label: string; amount: string; unit: 'micros' | 'minor' | 'rate'; currency: string; display: Display };

export type RowFigureReceipt = {
  id: string; kind: 'row-figure'; ventureId: string; at: IsoTime; operation: 'venture.row-figure';
  // 4G2: 'week-total' and 'week-average', the two figures of a "moved sharply" notice (views/probe-figures.ts).
  // 4F3: 'scope-cap', a run's spend cap as its scope froze it when it started.
  // 5A2: 'go-no-go', a GO card's maximum loss against the owner's limit (playbooks/kit/go-no-go.ts).
  subject: { type: 'call-cost' | 'judge-cost' | 'cap-room' | 'spend-quote' | 'plan-price' | 'month-spend' | 'week-total' | 'week-average' | 'scope-cap' | 'go-no-go'; recordId: string };
  figures: RowFigure[]; allowedNumbers: string[]; explanation: Display; digest: string; stale: boolean;
};

/** One trait a plain-English search looks for (4D3). */
export type SearchTrait = { id: string; label: string };

/** One trait checked on one person: yes, partly or not supported, with the quote and the stored field it came from. */
export type TraitCheck = { traitId: string; check: 'yes' | 'partly' | 'not-supported'; quote: string | null; field: string | null };

export type SearchField = typeof SEARCH_FIELDS[number];

/**
 * What code runs a search by (4D3), from the structured query the owner's AI made of their words: per trait, the stored
 * fields and the words to look for in them (to gather candidates, and to run a saved search again in code after an
 * import); clients, months without contact (calendar months, by date arithmetic) and the least band are exact filters
 * code checks.
 */
export type SearchFilters = {
  terms: { traitId: string; fields: SearchField[]; words: string[] }[];
  clients: 'any' | 'only' | 'none';
  quietMonths: number | null;
  knownAtLeast: Exclude<TieBand, 'cold'> | null;
};

/**
 * One person (or, for web: true, one public page) a search checked (4D3). by 'code': code alone checked the words (a
 * saved search's re-run after an import, added: that import's id); otherwise the owner's AI scored it in call callId and
 * code checked every quote. page: a web result's page as the web search showed it, screened; never a person's profile.
 */
export type NetworkSearchResult = {
  personId: string | null; url: string | null; fitBp: number; checks: TraitCheck[];
  by?: 'model' | 'code'; added?: string; callId?: string | null; page?: { title: string; text: string; host: string };
};

/**
 * One plain-English search (4D3): its traits, how many it read, what it found, who was shown, and its name once saved.
 * filters: what code runs it by (absent on records older than 4D3's code). traitsCallId: the call that made the traits;
 * batches: each scoring call and the people whose fields it carried, so Forget can erase those calls' text.
 */
export type NetworkSearchRecord = RecordBase<'venture-network-search'> & {
  text: string;
  traits: SearchTrait[];
  candidates: number;
  web: boolean;
  callIds: string[];
  results: NetworkSearchResult[];
  shown: string[];
  saved: { name: string; at: IsoTime } | null;
  filters?: SearchFilters;
  traitsCallId?: string | null;
  batches?: { callId: string; people: string[] }[];
};

export type PipelineStage = typeof PIPELINE_STAGES[number];

export type LostReason = typeof LOST_REASONS[number];

/** The owner's lawful basis for a cold email (4E2). */
export type LawfulBasis = 'they-wrote-first' | 'existing-contact' | 'public-business-contact';

/** What made a card (C13): an import row, a search, a saved search, the owner, or a lead's source page. */
export type OpportunityTrigger = { kind: 'import' | 'search' | 'saved-search' | 'owner' | 'lead'; ref: string | null; line: string };

/** One move between stages with the evidence it needs (4E1). */
export type StageMove = {
  from: PipelineStage | null; to: PipelineStage; at: IsoTime; by: string;
  evidence: { kind: 'send' | 'reply' | 'owner' | 'quote' | 'client' | 'reason' | 'lead'; id: string | null; line: string };
};

/** A follow-up sequence, copied onto the card when it starts so a later change to the settings never rewrites it (4E1). */
export type FollowupSequence = {
  kind: 'intro-request' | 'first-email' | 'message';
  steps: { afterDays: number; channel: OutreachChannel | null }[];
  weekdays: number[];
  sendTime: string;
  copiedAt: IsoTime;
};

/**
 * One send the owner recorded on a card, or one reply they got (4E1): what follow-ups count from. on: the owner's day
 * it happened; at: when it was recorded; kind: a send's place (the first note or a follow-up); ref: the draft, the
 * inbound message or the lead's draft it rests on. Chausar never sends.
 */
export type CardTouch = {
  what: 'sent' | 'reply'; on: IsoDate; at: IsoTime; kind: 'first' | 'nudge' | null; channel: OutreachSentChannel | null; ref: string | null; by: string;
};

/** One card on the pipeline (4E1). */
export type OpportunityRecord = RecordBase<'venture-opportunity'> & {
  personId: string; // a person in the network; for a lead that matches nobody there, the lead's own id
  stage: PipelineStage;
  trigger: OpportunityTrigger;
  history: StageMove[];
  next: { text: string; due: IsoDate } | null; // the owner's own next step; follow-ups come from sequence and touches
  sequence: FollowupSequence | null;
  nudges: number;
  leadId: string | null;
  clientId: string | null;
  linkedFrom: string | null; // the Not now card an "Ask again" card follows
  lostReason: LostReason | null;
  askAgainFrom: IsoDate | null;
  basis: LawfulBasis | null;
  touches?: CardTouch[]; // 4E1: absent on a card stored before it, read as none
  votes?: CardVote[]; // 4E1: per-factor votes for the lead score, absent when there are none
};

/** One owner rule for the lead score (C12): fields from a fixed list, protected traits refused. */
export type ScoreRule = { field: string; operator: 'is' | 'contains' | 'at-least' | 'at-most'; value: string; points: number };

/** One vote on one factor of a card's score (C12): the page that backs it, or the word "guess". */
export type CardVote = { factor: string; points: number; evidence: string };

/** The owner's pipeline settings (4E1): allowed weekdays (ISO, 1 is Monday), send time, daily and weekly caps, score rules. */
export type PipelineSettingsRecord = RecordBase<'venture-pipeline-settings'> & {
  weekdays: number[];
  sendTime: string;
  caps: PipelineCaps;
  scoreRules: ScoreRule[];
};

/** The send governor's lanes (4E2): LinkedIn notes and messages count apart; a call is not governed. */
export type OutreachLane = 'linkedin-note' | 'linkedin-message' | 'whatsapp' | 'email';

/** Owner-set daily and weekly outreach caps, per-lane caps, and five weekly warm-up percentages. */
export type PipelineCaps = { newPerDay: number; perWeek: number; channels?: Partial<Record<OutreachLane, number>>; channelWeeks?: Partial<Record<OutreachLane, number | null>>; warmupPercent?: number[] };

export type OutreachKind = typeof OUTREACH_KINDS[number];

export type OutreachChannel = 'email' | 'linkedin' | 'whatsapp';

/** How the owner sent it, recorded by the owner's "I sent it" (4E2). Chausar never sends. */
export type OutreachSentChannel = 'own-mailbox' | 'linkedin' | 'whatsapp' | 'phone';

/** A message Chausar drafted for the owner to send from their own app (4E2). footer: only on cold email. */
export type OutreachRecord = RecordBase<'venture-outreach'> & {
  opportunityId: string | null;
  invoiceId: string | null;
  personId: string | null;
  outreachKind: OutreachKind;
  channel: OutreachChannel;
  to: string | null;
  subject: string | null;
  text: string;
  blurb: string | null;
  footer: { unsubscribe: string; postalAddress: string } | null;
  sourceUrl: string | null;
  basis: LawfulBasis | null;
  lints: { rule: string; line: string }[];
  by: 'agent' | 'owner';
  callId: string | null;
  digest: string;
  sent: { at: IsoTime; channel: OutreachSentChannel; recordedAt: IsoTime; recordedBy: string } | null;
  acceptedOn: IsoDate | null; // a connection note LinkedIn's export later shows accepted
  language?: OutreachLanguage; // 4E2: the language it was drafted in; absent is English
  noteLimit?: 200 | 300; // 4E2: a connection note's limit, the owner's free or Premium account
  /** 4E2: who else the draft names: the person a double opt-in introduces, the target of an intro request. Forget removes it. */
  aboutPersonId?: string | null;
  /** 4E2: the import whose LinkedIn export showed the connection note accepted; its Undo takes the acceptance back. */
  acceptedBy?: string | null;
};

/** The languages Chausar drafts in (4E2). */
export type OutreachLanguage = 'en' | 'hi';

/** The owner's read-only mailbox (4E3). The app password lives on the engine's secret shelf, never in a record. */
export type MailboxRecord = RecordBase<'venture-mailbox'> & {
  host: string;
  port: number;
  user: string;
  status: 'connected' | 'disconnected' | 'failed';
  uidValidity: string | null;
  cursor: string | null;
  lastSync: IsoTime | null;
  line: string;
};

/** What code decided about an inbound message before any model read it (4E3). */
export type InboundTriage = 'opt-out' | 'auto-reply' | 'thanks' | 'bounce' | 'owner-reply' | 'bot-question' | 'talking' | 'unmatched';

/** One inbound message from someone in the network or the pipeline (4E3). Chausar's own processed state, never the mailbox's. */
export type InboundRecord = RecordBase<'venture-inbound'> & {
  messageId: string;
  from: string;
  to: string[];
  date: IsoTime;
  subject: string;
  references: string[];
  matched: { opportunityId: string; confidenceBp: number } | null;
  triage: InboundTriage;
  line: string;
  processed: boolean;
  screen: ScreenNote | null;
  /** 4E3: who in the network it is from (by email, then LinkedIn address, then name and company), or null. */
  personId?: string | null;
  /** 4E3: the cards it may be about, by code's confidence, when none was clear enough to attach (the owner confirms). */
  candidates?: { opportunityId: string; confidenceBp: number }[];
  /** 4E3: what a reply the owner answers asks about, found in code. */
  topics?: InboundTopic[];
  /**
   * 4E3: what a delivery report said about each address Chausar wrote to in the last 30 days: bounced (5.x.x, blocked),
   * its domain gone (5.1.2, 5.4.4: the address blocked, the domain only if the owner says so), or held 90 days (4.x.x).
   */
  bounces?: { address: string; status: string; scope: 'address' | 'domain' | 'suppress'; until: IsoDate | null }[];
  /** 4E3: a domain a report says takes no mail, waiting for the owner to say whether to block all of it. */
  domainAsk?: string | null;
  /**
   * 4E3: an opt-out: the addresses blocked at once (always the one it came from), and what waits for the owner: the
   * open cards to close as Lost (when the receiving server could not prove the mail) and the person's own addresses to
   * block (when it was matched by name or LinkedIn, not by address).
   */
  optOut?: { blocked: string[]; close: string[]; block: string[] };
  /** 4E3: Hindi words in the reply, so the fixed answer to "are you a bot" is drafted in Hindi too. */
  hindi?: boolean;
  /** 4E3: what the owner decided on it: matched it to a card, said it was not about one, moved the card, or set it aside. */
  handled?: { how: 'confirmed' | 'not-them' | 'moved' | 'done'; at: IsoTime; by: string } | null;
  /**
   * 5A6 (mail in): 'file-import' for a message from an .eml or .mbox file the owner imported (build/mail-in.ts); absent
   * for 4E3's mailbox sync. Only an imported message keeps its new words (text, screened, at most 4,000 characters; null
   * when the screen held them) and its attachments (MailAttachment); the import it came in is importId.
   */
  source?: 'file-import';
  text?: string | null;
  attachments?: MailAttachment[];
  importId?: string;
};

/** What a reply asks about, so the owner answers it (4E3, C11). */
export type InboundTopic = 'price' | 'contract' | 'meeting' | 'buying';

/**
 * The owner's private calendar address (4E3): the host only, since the address itself reads the whole calendar and so
 * lives on the engine's secret shelf. events: calls with people in the network that ended lately or end today, kept
 * only so Today can ask for notes after each (no titles, no other attendees); notesAt: notes added or declined.
 */
export type CalendarFeedRecord = RecordBase<'venture-calendar-feed'> & {
  host: string;
  status: 'set' | 'removed' | 'failed';
  lastRead: IsoTime | null;
  /** 4J7 (K6): how the last read at lastRead ended, for the connector truth; absent on records written before. */
  lastOutcome?: 'answered' | 'failed';
  digest: string | null;
  line: string;
  events: { id: string; endAt: IsoTime; personIds: string[]; notesAt: IsoTime | null; declined: boolean }[];
};

/** The owner is away from one day to another (4F1). */
export type AwayRecord = RecordBase<'venture-away'> & { from: IsoDate; to: IsoDate; by: string; clearedAt: IsoTime | null };

/** Pause all (4F1): new runs are refused while paused; stopRunning also stopped the running ones. The newest record wins. */
export type PauseRecord = RecordBase<'venture-pause'> & { paused: boolean; stopRunning: boolean; by: string };

/**
 * The owner raised one write cap for one day on their calendar (4F2, venture.runs.allowWrites): that day the cap is
 * doubled, once. capThen: the cap as it stood when raised.
 */
export type WriteAllowanceRecord = RecordBase<'venture-write-allowance'> & { capKind: WriteCapKind; day: IsoDate; capThen: number; by: string };

/**
 * One needs-you item the owner was told about (4G1): one episode of its row's subject on Today, so it never notifies
 * twice while it stays. An episode ends when the row leaves Today, the owner decided that row, or its run waits on the
 * owner again; a later return is a new record. Once ended, the title is a kind word (no client or person name stays),
 * and the record is deleted 30 days later.
 */
export type NotificationRecord = RecordBase<'venture-notification'> & {
  subject: string;
  rowId: string;
  rowKind: QueueKind;
  title: string;
  readAt: IsoTime | null;
  alertedAt: IsoTime | null;
  digestOn: IsoDate | null;
  expiresAt: IsoTime | null;
  /**
   * How an alert outside the app settled this item (4G1, set with alertedAt): 'sent' an alert counted it; 'seen' the
   * owner was watching when it came; 'paused' it came during a pause; 'off' no outside channel was on. Null or absent
   * while it waits (quiet hours, or the wait between alerts). Only 'sent' items count as alerts; urgent: an item
   * expiring within 2 hours whose alert passed quiet hours and the wait.
   */
  alert?: NotificationAlert | null;
  urgent?: boolean;
  /** When this episode ended (see above); absent or null while it is on Today. */
  endedAt?: IsoTime | null;
  /**
   * 4G3: the moments an alert counting this item could not go out at all (nothing left this computer). They stay in the
   * alert history, so the pacing holds while the item waits again; gaveUpAt: the third such moment, after which it no
   * longer waits and the next new item brings the count.
   */
  tries?: IsoTime[];
  gaveUpAt?: IsoTime | null;
};

export type NotificationAlert = 'sent' | 'seen' | 'paused' | 'off';

/**
 * One day's digest (4G1), written by code at the owner's hour: the line, the notifications it listed for the first
 * time, how many earlier ones still wait, the runs that finished since the last digest, and the sum receipt behind
 * money ready to invoice. alertedAt: when its count went outside the app, else null.
 */
export type NotifyDigestRecord = RecordBase<'venture-notify-digest'> & {
  day: IsoDate;
  line: string;
  needYou: number;
  listed: string[];
  stillWaiting: number;
  runIds: string[];
  ready: { display: string; receiptId: string } | null;
  alertedAt: IsoTime | null;
};

/** The owner's notification settings (4G1, 4G3). relay: the owner's own https address alerts post a count to. The newest wins. */
export type NotifySettingsRecord = RecordBase<'venture-notify-settings'> & {
  pausedUntil: IsoTime | null;
  quietHours: { from: string; to: string } | null;
  digest: { hour: number } | null;
  push: boolean;
  tray: boolean;
  relay: string | null;
  /** W6 6F6: the owner's own Telegram bot is set (its token and chat id live in protected storage, never here); details: titles opt-in. */
  telegram?: { details: boolean; savedAt: IsoTime } | null;
};

/**
 * One browser push subscription on a known push service (4G3), tied to the hosted session that made it: sessionHash is
 * a hash of that session's id (never the id). It ends when that session signs out or is revoked, not when it idles or
 * expires. A gone or ended one is deleted, not kept.
 */
export type PushSubscriptionRecord = RecordBase<'venture-push-subscription'> & {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  host: string;
  sessionHash: string | null;
  /** Deliveries in a row that failed after their one retry; the third removes the subscription. */
  failures: number;
  /** The last such failure (when, and the push service's answer; null when none came), cleared by the next success. */
  lastFailure?: { at: IsoTime; status: number | null } | null;
};

/**
 * The hosted app's web push key (VAPID, 4G3). Trusted host composition, never a payload: the private half stays in the
 * host, and sign answers the raw P-256 signature (r then s, 64 bytes) over data. publicKey: the uncompressed point as
 * base64url, the key a browser subscribes with. subject: the contact the push services see (mailto: or https:), or null.
 */
export type WebPushPort = { readonly publicKey: string; readonly subject: string | null; sign(data: Uint8Array): Uint8Array };

/** What a check of the owner's command-line AI found on this computer, from evidence only (4H1). */
export type CliCheckRecord = RecordBase<'venture-cli-check'> & {
  cli: DelegateCli;
  found: boolean;
  version: string | null;
  flags: 'match' | 'mismatch' | 'unknown';
  missingFlags: string[];
  signedIn: 'yes' | 'no' | 'unknown';
  /** named (A2): a failure the tool named, in its owner words with the fix (models/ai-failure.ts). */
  lastTask: { at: IsoTime; outcome: 'succeeded' | 'failed'; named?: Display } | null;
};

/** The owner's goal for one month: money invoiced before tax (4I1). A newer goal for the same month is the one in use. */
export type GoalRecord = RecordBase<'venture-goal'> & { month: string; amountMinor: MinorString; currency: string; by: string };

/** Who decided one item, and on what rule (4J1, O17). */
export type DecisionRecord = RecordBase<'venture-decision'> & {
  subject: string;
  action: string;
  who: 'owner' | 'cofounder' | 'accountant' | 'saved-rule' | 'timeout' | 'chausar';
  ruleId: string | null;
  reason: string;
  rowId: string | null;
  /** One-shot A3 (after review): the role of the member who decided (an owner, or a cofounder deciding for them). */
  role?: import('../../contracts.ts').Role;
};

/** The owner's own edit of a draft (4J2), with the hash of the draft it replaced; a later agent revision never overwrites it. */
export type DraftEditRecord = RecordBase<'venture-draft-edit'> & {
  runId: string; rowId: string; text: string; replacedHash: string; by: string; undoneAt: IsoTime | null;
  /** The text the edit replaced (the merge base when an agent revision lands later) and the owner's edit before it, for Undo. */
  replaced?: string; prior?: string | null;
  /** One-shot A3 (after review): the role of the member who edited; only the owner's own edit lifts the agent's checks. */
  role?: import('../../contracts.ts').Role;
};

/**
 * 4J2 (O5): the owner sent a draft back with words, or asked the agent to fix failed checks. words: what the revision
 * turn is told, beginning "Revise this to: "; previous: the text the owner saw, which the agent revises (their edit,
 * else the agent's draft); base: the agent's own draft, the merge base when the revision lands; callId: the revision
 * job ID once native work starts (blank before launch); prior: the saved run state, so Undo restores the draft before work has
 * started. checks: a fix's targets.
 */
export type DraftRevision = {
  socialPost?: { postId: string; n: number; posts: { channel: string; text: string }[]; prior: import('../playbooks/social/approvals.ts').GhostwritingState };
  by: 'send-back' | 'fix'; words: string; rowId: string | null; at: IsoTime; callId: string; base: string; previous?: string;
  prior: { callId: string | null; phase: HarnessState['phase'] | null; status?: DeliveryRunStatus }; checks?: string[];
};

/** 4J2 (O6): one part of a landed revision's paragraph merge: paragraphs alike in all three, or one changed stretch. */
export type DraftMergePart =
  | { kind: 'same'; text: string[] }
  | { kind: 'change'; id: string; owner: string[]; agent: string[]; by: 'agent' | 'both'; status: 'open' | 'taken' | 'dropped' };

/**
 * 4J2 (O6): the three-snapshot merge made when a revision landed: the base the owner and the agent started from, the
 * owner's version, and the parts. edited: the owner had their own version; replacement: their choice on it, if any.
 */
export type DraftMerge = { at: IsoTime; edited: boolean; owner: string; parts: DraftMergePart[]; replacement: 'confirmed' | 'kept' | null };

/** 4J2: a fix's checks run again after its revision landed, and what that made of the fix (delivery/verdicts.ts fixStatus). */
export type DraftFix = { checks: string[]; status: 'fixed' | 'partially-fixed' | 'not-fixed' | 'unverified'; at: IsoTime };

export type TriageField = 'due' | 'client' | 'kind' | 'money' | 'business';

/** How the owner wants Today ordered, from fixed fields (4J2). A rule never hides a row. */
export type TriageRule = { keys: { field: TriageField; order: 'asc' | 'desc' }[]; words: string };

export type TriageRuleRecord = RecordBase<'venture-triage-rule'> & { rule: TriageRule; digest: string; by: string };

/** Unsent edits of one settings form, kept in the vault, never browser storage (4J2, O22). */
export type SettingsDraftRecord = RecordBase<'venture-settings-draft'> & { form: string; values: Json; by: string; clearedAt?: IsoTime | null };

/** One line of a bill, with the tax name and rate at that time (4J5). */
export type BillLine = { description: string; amountMinor: MinorString; taxName: string; taxRateBps: BpsString };

/**
 * 4J20: a bill line as venture.bills.add takes it: the amount as the owner typed it (amount, read in the business's
 * currency) or in minor units, and the rate as typed (taxRate, a percentage) or in basis points; one of each.
 */
export type BillLineInput = { description: string; taxName: string }
  & ({ amount: string; amountMinor?: never } | { amountMinor: MinorString; amount?: never })
  & ({ taxRate: string; taxRateBps?: never } | { taxRateBps: BpsString; taxRate?: never });

/** 4J20: an amount as typed (amount, read in its currency) or in minor units (amountMinor), one of them. */
export type TypedAmount = { amount: string; amountMinor?: never } | { amountMinor: MinorString; amount?: never };

/** A bill the business owes (4J5). States partial, paid and overdue are derived. */
export type BillRecord = RecordBase<'venture-bill'> & {
  vendor: string;
  lines: BillLine[];
  currency: string;
  billDate: IsoDate;
  dueDate: IsoDate;
  recurring: 'monthly' | 'quarterly' | null;
  /** 'cancelled': an expected bill of a repeat the owner stopped; it is never shown or counted. */
  status: 'draft' | 'posted' | 'cancelled';
  totalMinor: MinorString;
  paidMinor: MinorString;
  payments: { id: string; amountMinor: MinorString; paidOn: IsoDate; method: PaymentMethod; factId: string | null }[];
  /** Whether its GST was left out of the costs as claimable, kept from its first payment so later ones agree. */
  taxClaimed?: boolean;
};

/**
 * One-shot C4 (T20): one share of an issued invoice. 'whatsapp' and 'email': the owner's own app opened with it; 'file':
 * the file was saved; 'marked': the owner said it was sent. Only 'marked' makes the invoice sent: opening an app is not sending.
 */
export type InvoiceShareHow = 'whatsapp' | 'email' | 'file' | 'marked';

export type InvoiceShareRecord = RecordBase<'venture-invoice-share'> & { invoiceId: string; how: InvoiceShareHow };

/** A credit note against one invoice (4J5): on the always-ask floor, so it waits on Today until issued. */
export type CreditNoteRecord = RecordBase<'venture-credit-note'> & {
  invoiceId: string;
  amountMinor: MinorString;
  currency: string;
  reason: string;
  number: string | null;
  status: 'waiting' | 'issued' | 'cancelled';
  digest: string;
  issuedAt: IsoTime | null;
  /** Who issued or cancelled it on Today (the owner's member id). */
  decidedBy?: string;
  /** Its share before tax, worked out when issued (the last of a full credit takes the rest, so the shares add up). */
  beforeTaxMinor?: MinorString;
};

/** A recurring invoice (4J5): each due date makes a draft on Today, never issued by itself. */
export type RecurringInvoiceRecord = RecordBase<'venture-recurring-invoice'> & {
  clientId: string;
  offerId: string;
  frequency: 'monthly' | 'quarterly';
  startOn: IsoDate;
  end: IsoDate | null;
  nextOn: IsoDate | null;
  stoppedAt: IsoTime | null;
  /** The days late a reminder is due on for this schedule's invoices; absent: 3, 10 and 30. */
  reminderDays?: number[];
  /** The owner's price includes the tax (M15). */
  taxInclusive?: boolean;
  /** The drafts this schedule made, one per due date. */
  made?: { on: IsoDate; orderId: string; invoiceId: string }[];
};

/** One run of the connection checks (4J7): a cheap real read per connected connector, never a secret. */
export type ConnectorCheckRecord = RecordBase<'venture-connector-check'> & {
  /** name and fix (4J7): the row's connection in words and its one-sentence fix, null when nothing needs fixing. */
  rows: { connectorId: string; outcome: 'answered' | 'failed' | 'skipped'; line: string; account: string | null; expiresOn: IsoDate | null; name?: string; fix?: string | null }[];
};

/** A single-use link a client uploads one file through (4J7): the token's hash only, valid 15 minutes. */
export type FileRequestRecord = RecordBase<'venture-file-request'> & {
  orderId: string;
  note: string | null;
  tokenHash: string;
  expiresAt: IsoTime;
  lockedAt: IsoTime | null;
  usedAt: IsoTime | null;
  uploadId: string | null;
};

/** The owner's profile (4J9): first name for the greeting, and services the business does not sell (C21). */
export type OwnerProfileRecord = RecordBase<'venture-owner-profile'> & {
  firstName: string | null; excludedServices: string[];
  /** Wave 6 (6C2, 6C7): the profession family the plan was kept with (core/families.ts); absent in older records. */
  familyId?: FamilyId | null;
};

/**
 * 4J8. An offer the owner added to the plan: its stable plan offer id (offer_own_1 upward, never reused), its words and
 * how it is charged, kept in step with the plan's words; removedAt once the owner took it out. Never a price: that is
 * on the plan's offer, set by the owner.
 */
export type OwnerOfferRecord = RecordBase<'venture-owner-offer'> & {
  offerId: string; name: string; description: string; pricingModel: PricingModel; removedAt: IsoTime | null;
  youtubeService?: import('../playbooks/youtube/offers2.ts').YoutubeServiceId;
};

/**
 * The public half of a receipt signing key (4J10), kept for good once a receipt is signed with it, so old signatures
 * can still be checked. The private half is never stored: it is derived from the vault's own key when the vault opens
 * (SecretName receipt:signing), so no export, backup or record carries it.
 */
export type SigningKeyRecord = RecordBase<'venture-signing-key'> & { algorithm: 'ed25519'; publicKey: string };

/**
 * The chained journal (4J10, H26), one record per business. Each link covers one item of the journal: a step of an
 * entry or a post, a website edit's log line, an end state, the outcome per target, a tool call a saved rule allowed.
 * seq counts on from 1; prevDigest is the link before it, or the break that started this chain; digest is sha256 over
 * the link's canonical JSON; body is sha256 over the item. An item is linked once, when a Chausar write first makes it.
 * breaks: each break the owner accepted (venture.journal.acceptBreak), newest last; the chain is checked from it on.
 */
export type JournalChainLink = { seq: number; prevDigest: string; digest: string; item: string; body: string };

export type JournalChainBreak = { at: IsoTime; by: string; fromSeq: number; startSeq: number; digest: string; line: string };

export type JournalChainRecord = RecordBase<'venture-journal-chain'> & { links: JournalChainLink[]; breaks: JournalChainBreak[] };

/** One stored receipt's Ed25519 signature (4J10) over its canonical JSON, by the business's key (keyId, its record). */
export type ReceiptSignatureRecord = RecordBase<'venture-receipt-signature'> & {
  receiptId: string; receiptKind: 'venture-price-receipt' | 'venture-sum-receipt' | 'venture-work-receipt' | 'venture-tie'; keyId: string; signature: string;
};

/**
 * What venture.receipt.get adds to a signed receipt: the signature, the public half (SPKI, base64) that checks it, and
 * signed, the exact stored receipt as canonical JSON, which is what was signed, whatever view the answer shows.
 */
export type ReceiptSignature = { algorithm: 'ed25519'; publicKey: string; signature: string; signedAt: IsoTime; signed: string };

/** What an order is for and how done is proved (4J12, H24). Protected items are enforced by code; checks have stable ids. */
export type OrderContract = {
  goal: string;
  scope: string[];
  constraints: string[];
  protected: { kind: 'phrase' | 'file'; value: string }[];
  deliverables: { id: string; what: string; stage: string; doneWhen: string }[];
  checks: { id: string; what: string }[];
};

/**
 * One mark on a deliverable or acceptance check of a signed contract (4J12): done with its evidence, skipped with its
 * reason, or reopened, which only the auditor does. Marks append; the newest mark of an item is its state.
 */
export type ContractMark = { itemId: string; state: 'done' | 'skipped' | 'reopened'; evidence: string | null; reason: string | null; by: 'agent' | 'owner' | 'auditor'; at: IsoTime };

/**
 * One revision of an order's contract (4J12); revisions append. marks: the item marks so far (a new revision carries
 * them for the items it keeps). files: when signed, the digests of the order's files that the contract protects, so a
 * draft whose run changed one fails its checks.
 */
export type OrderContractRecord = RecordBase<'venture-order-contract'> & {
  orderId: string;
  contract: OrderContract;
  revision: number;
  proposedBy: 'owner' | 'agent';
  digest: string;
  signedAt: IsoTime | null;
  signedBy: string | null;
  marks?: ContractMark[];
  files?: { name: string; digests: string[] }[];
};

/** How a report up the team ends (4J12, H25). Only failed and needs_decision, to the owner, reach Today. */
export type RelayReport = 'done' | 'blocked' | 'failed' | 'needs_decision';

/** order: work down to a helper; report: one step up; handover: work to a sibling, with a brief; message: anything else. */
export type RelayKind = 'order' | 'report' | 'handover' | 'message';

/**
 * One message between two agents of a team, or a report up to the owner (to 'owner'), 4J12 (agents/relay.ts). from
 * is set by code from the turn's role, never by the words. text and brief are as the untrusted screen left them (the
 * held words when it held them); brief, on orders and handovers, carries the return cap and the spend line code adds.
 * status: delivered when the receiver is working now and reads it at its next turn, queued while it is idle. depth:
 * how many messages led to this one in its root task, this one included.
 */
export type AgentRelayRecord = RecordBase<'venture-agent-relay'> & {
  from: string;
  to: string;
  relayKind: RelayKind;
  rootId: string;
  causeId: string | null;
  depth: number;
  text: string;
  brief: string | null;
  report: RelayReport | null;
  status: 'delivered' | 'queued';
  screen: ScreenNote | null;
};

/** When a routine runs (4J13): never cron text. */
export type RoutineSchedule =
  | { kind: 'once'; at: IsoTime }
  | { kind: 'interval'; everyMinutes: number; from: IsoTime }
  | { kind: 'calendar'; weekdays: number[]; time: string; timeZone: string }
  /** C4 task 32: one day of the month (1 to 28) at a time in a named zone ("On the 1st of each month, 9:00 am"). */
  | { kind: 'monthly'; day: number; time: string; timeZone: string }
  /** C7: a trigger: it starts on a confirmed event and only drafts (build/event-triggers.ts). */
  | { kind: 'event'; source: 'razorpay' | 'cal-com'; event: 'payment' | 'booking' | 'booking-cancelled' };

/** A routine (4J13): a standalone prompt on a schedule, for an agent or the chief. It never approves anything. */
export type RoutineRecord = RecordBase<'venture-routine'> & {
  recordReport?: 'va-morning'|'va-weekly';
  /** C7: a trigger's facts: the blanks its prompt uses, shown when it is saved and sent with each event. */
  facts?: string[];
  name: string;
  agent: string | null;
  setBy: 'owner' | 'agent' | 'chief';
  prompt: string;
  schedule: RoutineSchedule;
  on: boolean;
  removedAt: IsoTime | null;
};

export type RoutineRunState = 'queued' | 'running' | 'needs-input' | 'completed' | 'failed' | 'missed' | 'skipped' | 'interrupted';

/** One occurrence of a routine (4J13). missed: how many occurrences one missed run stands for. */
export type RoutineRunRecord = RecordBase<'venture-routine-run'> & {
  routineId: string;
  dueAt: IsoTime;
  state: RoutineRunState;
  line: string;
  missed: number;
  runId: string | null;
  threadId: string | null;
  /** C7: a run parked as queued until the AI plan resets (resetsAt null: no reset known, looked at again every 30 minutes). */
  waitsFor?: { cli: DelegateCli; resetsAt: IsoTime | null };
  /** C7: when the run started waiting for the plan. */
  waitingSince?: IsoTime;
  /** C7: when the run last parked on Today, if after it was made; its 24 hours count from here. */
  parkedAt?: IsoTime;
  /** C7: the backup AI a run went to and why ("Ran on Claude Code because your Codex plan was used up."). */
  ranOn?: { presetId: ModelPresetId; label: string; why: string } | null;
  /** C7: the client whose data the run carries (an event trigger's run), if any. */
  clientId?: string | null;
  /** C7: a trigger's prompt with its blanks filled by code; sent instead of the routine's own words. */
  filled?: string;
};

/** One run of the guardrail drills against the playbook hash (4J15). */
export type DrillRunRecord = RecordBase<'venture-drill-run'> & {
  playbookHash: string;
  results: { drill: string; stopped: boolean; twinPassed: boolean; line: string }[];
  passed: boolean;
};

/** The business voice in six typed sections (4J17). */
export type VoiceSections = { audience: string[]; howITalk: string[]; neverUse: string[]; wordsIUse: string[]; willNotClaim: string[]; format: string[] };

/** The business voice for one language and channel (4J17); validated only after a held-out sample passed. */
export type VoiceRecord = RecordBase<'venture-voice'> & {
  language: 'en' | 'hi';
  channel: string | null;
  on: boolean;
  sections: VoiceSections;
  validated: boolean;
  learnedFrom: number;
  /**
   * Each venture.voice.set is a new version for its language and channel, kept, so the owner can go back (append-only).
   * draft: a voice venture.voice.learn worked out, waiting unsaved until the owner sets it; never checked or used.
   * learned: the word counts and verbatim lines code kept from the owner's own texts, and the held-out check; null by hand.
   */
  version: number;
  draft: boolean;
  learned: { counts: { word: string; count: number }[]; lines: string[]; heldOut: { passed: boolean; line: string } } | null;
};

/** An agent's persona, after the fixed rules (4J17). It never asks for a tool, a number or a change to facts or safety. */
export type PersonaFields = {
  tone: string | null;
  replyLength: 'short' | 'medium' | 'long' | null;
  greeting: string | null;
  handOffLine: string | null;
  blockedTopics: string[];
  signOff: string | null;
};

/**
 * One version of an agent's persona (4J17): each venture.persona.set, or an accepted import, is a new version, kept, so
 * the owner can go back. source: who set it: the owner on the page, an agent file they accepted, or going back.
 */
export type PersonaRecord = RecordBase<'venture-persona'> & { agent: string; persona: PersonaFields; version: number; source: 'owner' | 'import' | 'undo' };

/** One source of what the AI knows (4J18): text, a screened link, a file, or a best past piece of work. */
export type KnowledgeRecord = RecordBase<'venture-knowledge'> & {
  sourceKind: 'text' | 'link' | 'file' | 'past-work';
  title: string;
  text: string;
  url: string | null;
  uploadId: string | null;
  runId: string | null;
  screen: ScreenNote | null;
  removedAt: IsoTime | null;
};

/** An idea code made from evidence (4J18): it retires when its evidence no longer holds; dismissals are remembered. */
export type IdeaRecord = RecordBase<'venture-idea'> & {
  title: string;
  reason: string;
  evidence: { kind: string; id: string; line: string }[];
  prompt: string;
  rule: string;
  status: 'open' | 'started' | 'dismissed' | 'retired';
  decidedAt: IsoTime | null;
  /** Ink v2 wave 5 (5A3): an idea in the pipeline (rule 'pipeline'), its stage, author, days and grade; absent on 4J18's ideas. */
  pipeline?: IdeaPipeline;
};
