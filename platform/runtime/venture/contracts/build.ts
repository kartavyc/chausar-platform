// Venture build contract. Types only; public imports use ../contracts.ts.
import type { BUILDER_IDS, CONNECTOR_CATEGORIES, JOURNAL_ACTION_IDS } from '../contract-values.ts';
import type { BankAlert, BankAlertRule } from '../build/bank.ts';
import type { ScheduledPostBinding } from '../playbooks/social/scheduled-core.ts';
import type { IsoDate, IsoTime, Json, MinorString, RecordBase } from './business.ts';
import type { Display } from './spend.ts';

export type BuilderId = typeof BUILDER_IDS[number];

export type BriefLintRule = 'required-section' | 'required-text' | 'too-long' | 'em-dash' | 'banned-word' | 'contact-detail' | 'price-mismatch' | 'brief-id' | 'first-line';

export type BriefLint = { ok: boolean; findings: { rule: BriefLintRule; line: number | null; message: string }[] };

export type BriefRecord = RecordBase<'venture-brief'> & {
  briefId: string; // ^chb_[a-z0-9]{8}$
  version: number;
  markdown: string; // at most 9000 characters
  chars: number;
  digest: string;
  blueprintDigest: string;
  priceReceiptIds: string[];
  /** mixed (review of A1, row 13): the AI wrote the brief, but a field it left empty came from the built-in words. */
  wordsBy: 'model' | 'template' | 'mixed';
  modelCallId: string | null;
  /** The call that asked again for a field the first answer left empty (review of A1, row 13); null when the template answered it. */
  fillCallId?: string | null;
  lint: BriefLint;
  /** True when the model's words hold a number: a model estimate. Prices in the brief come only from receipts. */
  estimate?: true;
};

export type HandoffPlan = {
  handoffId: string; // the venture-handoff record; send it back with venture.build.handoffOpened
  builder: BuilderId;
  mode: 'link' | 'copy';
  url: string; // https only; bare site in copy mode
  clipboardText: string | null;
  promptChars: number;
  urlChars: number;
  notes: string[]; // fixed lines: privacy and how to turn on GitHub sync for this builder
  label: 'handoff';
  status: 'available' | 'planned';
};

/** C5 task 35: the brief by file: website-brief.md, and the note file the builder reads the brief id from. */
export type BriefFilePlan = {
  handoffId: string; // send it back with venture.build.handoffOpened once the file is saved
  builder: BuilderId;
  files: { name: string; text: string }[];
};

export type HandoffRecord = RecordBase<'venture-handoff'> & {
  builder: BuilderId;
  mode: 'link' | 'copy' | 'file';
  briefId: string;
  briefDigest: string;
  urlChars: number;
  urlDigest: string;
  openedAt: IsoTime | null; // set by venture.build.handoffOpened after the browser opened it or the copy worked
};

export type RepoRef = { owner: string; name: string };

export type BuildStatusWord = 'waiting-for-repo' | 'repo-connected' | 'builder-making-changes' | 'quiet' | 'sync-conflict' | 'repo-not-readable';

export type BuildStatus = {
  word: BuildStatusWord;
  asOf: IsoTime;
  readId: string | null;
  repo: { fullName: string; private: boolean | null; defaultBranch: string | null; htmlUrl: string | null };
  lastCommit: { sha: string; at: IsoTime; by: 'lovable' | 'replit' | 'you' | 'repo-account' | 'other'; message: string } | null; // message: one line, at most 200 characters
  briefMarker: 'found' | 'older' | 'missing' | 'not-checked';
  briefMarkerVersion: number | null; // the brief version whose id was found
  markerFile: string | null;
  uiWorkflow: 'found' | 'needs-fix' | 'missing' | 'not-checked'; // 'needs-fix': no 'contents: read', or uses pull_request_target
  checks: 'passed' | 'failed' | 'none-reported' | 'not-readable'; // only from the run named 'UI lint'
  deployment: { host: string | null; url: string; at: IsoTime } | null; // url is shown as text with a copy button, never a link
  syncConflictBranch: string | null;
  cannotSay: string[];
};

export type BuildFollowRecord = RecordBase<'venture-build-follow'> & {
  repo: RepoRef;
  tokenState: 'none' | 'in-memory';
  linkedAt: IsoTime;
  lastStatus: BuildStatus | null;
};

export type GitHubReadRecord = RecordBase<'venture-build-read'> & {
  repo: RepoRef;
  calls: { path: string; status: number; etag: string | null; bodyDigest: string; fetchedAt: IsoTime }[];
  transport: 'github-api' | 'fixture';
};

export type GitHubRequest = { path: string; accept: 'json' | 'raw'; etag: string | null; token: string | null };

export type GitHubResponse = { status: number; etag: string | null; body: string; rateRemaining: number | null };

export type GitHubTransport = { read(request: GitHubRequest): Promise<GitHubResponse>; kind: 'github-api' | 'fixture' };

/** Recorded GitHub API pages for tests. Keys are request paths. Strict JSON on disk.
 * String bodies may contain {{name}} placeholders filled by the fixture transport's vars callback. */
export type GitHubFixture = {
  label: 'synthetic recording';
  responses: Record<string, { status: number; etag: string | null; body: Json | string }>;
};

export type ConnectorCategory = typeof CONNECTOR_CATEGORIES[number];

export type ConnectorModeName = 'handoff' | 'read' | 'write';

export type ConnectorMode = {
  mode: ConnectorModeName;
  status: 'available' | 'planned';
  qualification: 'built-in' | 'fixture-tested' | 'unqualified';
  what: string; // one plain line: what this mode does
  /** 4J7 (K6): how far this mode is proven on this business (build/connector-truth.ts). Set on every card. */
  ladder?: ConnectorLadder;
};

/**
 * 4J7 (K6), the connector truth ladder, lowest to highest: 'documented' (the platform documents it; Chausar does not do
 * it), 'discovered' (Chausar's code does it, tested on a recording or built in, not yet seen working on this business),
 * 'read-verified' (a real read answered here), 'write-verified' (a real write here, read back). 'unavailable': it can't
 * run here at all.
 */
export type ConnectorLadder = 'documented' | 'discovered' | 'read-verified' | 'write-verified' | 'unavailable';

/** 4J7 (K6): one operation a connector really takes, with the only fields it accepts. */
export type ConnectorCapability = { operation: string; mode: ConnectorModeName | PostingModeName; fields: string[] };

/** 4J7 (K11): how to set a connector up with the least access, in Chausar's words (build/guides.ts). */
export type ConnectorGuide = {
  /** Numbered least-privilege steps, in order. */
  steps: string[];
  /** The step people skip. */
  skipped: string;
  /** What the platform charges, with the day Chausar's note was written; "No charge" for Chausar's own parts. */
  charges: { line: string; checkedOn: IsoDate | null };
  /** "Chausar checks access before marking it connected." */
  checks: string;
  /** What it sends, for example "Sends: nothing, so nothing here can change Zoho." */
  sends: string;
  /** What the agents can and can't do with it. */
  agentLimits: string;
  /** A half-configured connection's missing setting, by name; null when nothing is missing. */
  missing: string | null;
};

export type ConnectorCard = {
  id: string;
  name: string;
  category: ConnectorCategory;
  categoryLabel: string;
  modes: ConnectorMode[];
  chips: string[]; // e.g. ['handoff', 'planned: read'] or ['planned: handoff', 'planned: write']
  regions: ('global' | 'india')[];
  regionNote: string | null;
  auth: string;
  vendorUrl: string | null; // a plain 'Visit site' link, not a mode; origin must be in EXTERNAL_ORIGINS
  note: string; // shown on the card
  starter: boolean; // one of about six shown first for this venture
  /** How this connector posts today: the first available posting mode, else the owner-browser-session one. Absent when it does not post. */
  posting?: PostingOption;
  /** Every posting mode in the order api, owner-browser-session, handoff, each with its status, risk and requirements. Empty when it does not post. */
  postingOptions: PostingOption[];
  /** 4J7 (K11): the setup guide; every catalogue card has one. */
  guide?: ConnectorGuide;
  /** 4J7 (K6): the operations it really takes and their fields; empty when it takes none in this build. */
  capabilities?: ConnectorCapability[];
};

/**
 * 'api': the platform's own API, which needs its app review first. 'owner-browser-session': the owner's own signed-in
 * account in a browser on this computer, driven after the owner approves each post. 'handoff': the owner posts it there.
 * Never built: proxy or VPN rotation, fingerprint spoofing, or posting to accounts that are not the owner's.
 */
export type PostingModeName = 'api' | 'owner-browser-session' | 'handoff';

export type PostingOption = {
  mode: PostingModeName;
  status: 'available' | 'planned';
  /** 'unqualified' while available means the code runs but has not been checked against the live site. */
  qualification: 'built-in' | 'fixture-tested' | 'unqualified';
  what: string; // one plain line: what this mode does
  risk: string | null; // shown beside the mode, for example 'The platform may restrict this account.'
  requires: string[]; // what has to be true first, for example 'Meta app review'
  reason: string | null; // why a planned option is planned; null when available
  /**
   * The browser mode of a text platform only (Ink v2 wave 2, 2B2): the oldest day across the three posting steps on
   * which one of the step's candidates last matched exactly one visible element; null while any step has none.
   */
  stepsCheckedOn?: IsoDate | null;
  /** The same mode: the oldest day the text box and the post button last worked, the steps a check can see; null when not checked. */
  boxAndButtonCheckedOn?: IsoDate | null;
  /** 4J7 (K6): how far this posting mode is proven on this business (build/connector-truth.ts). Set on every card. */
  ladder?: ConnectorLadder;
};

/** Each post is its own journal entry: described, then approved, then applied, rejected or outcome_unknown. Never resent. */
export type ConnectorPostState = 'described' | 'approved' | 'applied' | 'rejected' | 'outcome_unknown';

export type OpenPostingAccountRecord = RecordBase<'venture-open-posting-account'> & {account:import('../build/open-posting-core.ts').OpenPostingAccount;active:boolean;revision:number};

export type ConnectorPostRecord = RecordBase<'venture-connector-post'> & {
  openAccountDigest?: string;
  /** One exact owner-approved due slot, included in the post digest. */
  scheduled?: ScheduledPostBinding;
  connectorId: string;
  mode: Exclude<PostingModeName, 'handoff'>;
  account: string | null; // the owner's own account, as the owner named it
  text: string; // the post, untrusted agent or owner words
  agent: string | null; // the agent that proposed it; null when the owner wrote it
  digest: string; // what the owner approves: id, connector, mode, account and text
  state: ConnectorPostState;
  describe: string; // one plain line for the approver
  risk: string | null;
  claimedAt: IsoTime | null; // set by the claim, in its own commit after the approval, before the browser or API is touched
  decidedBy: string | null;
  outcome: { line: string; url: string | null; by: 'platform' | 'owner' | 'engine' } | null;
  journal: { state: ConnectorPostState; at: IsoTime; by: string; line: string }[];
  /** The bound approval (P2-journal): the token's hash only, never the token. Absent on posts made before the journal. */
  approval?: ApprovalSeal | null;
  /** An agent proposal waits fifteen minutes (P2-journal). Absent on posts made before the journal. */
  expiresAt?: IsoTime | null;
  /** Whether describe and the view show everything this will send (W1 H21). Absent or false: the approver is told it is incomplete. */
  descriptionComplete?: boolean;
  /** The delivery draft the post comes from, and that draft's digest when proposed (W1 H6). A post is never free text. */
  draftId?: string | null;
  draftDigest?: string | null;
  /** Which of the draft's posts for this channel, from 1, when it holds several. */
  part?: number | null;
  /** The pre-post risk gate's warnings when it was proposed (Ink v2 wave 2, K5), each naming its rule; absent when none. */
  warnings?: string[];
} & JournalAfter;

/**
 * A security check or a platform block seen on one posting channel (W1 H19). 'challenge' (a check, verify or 403 page)
 * stops every automatic action on that channel until the owner clears it; 'blocked' freezes the channel, reads too,
 * until 'until' (72 hours) and is never cleared early. A session that ended is not a hold: the owner signs in again.
 */
export type ChannelHoldRecord = RecordBase<'venture-channel-hold'> & {
  connectorId: string;
  site: string; // the host the browser was on
  cause: 'challenge' | 'blocked';
  line: string;
  until: IsoTime | null; // blocked: when the freeze ends; challenge: null, until the owner clears it
  postId: string | null;
  clearedAt: IsoTime | null;
  clearedBy: string | null;
};

/** The three steps a browser post takes (build/browser.ts): fill the text box, press post, see the post confirmed. */
export type PostingStepId = 'textbox' | 'submit' | 'confirm';

/** One way to find a step's element, in Playwright's public locator terms. name: a role's accessible name; lang: the UI language it is for. */
export type PostingCandidate = { kind: 'test-id' | 'role' | 'aria-label' | 'xpath'; value: string; name?: string; lang?: string };

/**
 * One posting connector's browser steps as checked on this computer (venture.posting.checkSteps): the day each candidate
 * last matched exactly one visible element, by step and candidate key, and the candidates the owner picked by clicking
 * the element once in the window. Shipped candidates stay unchecked until a check run dates them.
 */
export type PostingStepsRecord = RecordBase<'venture-posting-steps'> & {
  connectorId: string;
  checked: { step: PostingStepId; key: string; checkedOn: IsoDate }[];
  added: { step: PostingStepId; key: string; candidate: PostingCandidate; addedOn: IsoDate }[];
};

/** The business's untrusted screen (policy/untrusted.ts): observe until the owner turns on enforce; the newest record wins. */
export type ScreenSettingRecord = RecordBase<'venture-screen-setting'> & { mode: 'observe' | 'enforce' };

/** Held content the owner let through, bound to that exact content's digest; changed content is held again. */
export type UntrustedReleaseRecord = RecordBase<'venture-untrusted-release'> & { digest: string };

/**
 * Whether the rules judge runs on its own on every ready draft that goes to a client or the public (judgeAuto), the
 * newest record wins and none means on. consent: the standing consent for those judge calls, which carry the client's
 * words to the owner's own AI, recorded once: when the owner turns it on ('set'), when the owner approves a write turn
 * whose approval showed the judge's notice and cost ('default', entryId that approved journal entry), or when the owner
 * sends a judge call that waited for want of it ('send', entryId that send's entry); null while off (delivery/judge-run.ts).
 */
/** C5 task 7: Allow AI for new clients, on or off, with the digest of the words the owner confirmed; the newest is in use. */
export type ClientAiDefaultRecord = RecordBase<'venture-client-ai-default'> & { on: boolean; digest: string };

/** C5 task 16: the CA's email and WhatsApp number; the newest is in use. */
export type AccountantRecord = RecordBase<'venture-accountant'> & { email: string | null; whatsapp: string | null };

/** C5 task 17: the standing order for the monthly CA pack. The newest is in use. */
export type CaPackOrderRecord = RecordBase<'venture-ca-pack-order'> & { on: boolean };

/** C5 task 17: one month's pack, made once. file: its name in Chausar's exports folder. doneAt: the owner sent it, so its row left Today. */
export type CaPackRecord = RecordBase<'venture-ca-pack'> & { month: string; file: string; what: string; doneAt: IsoTime | null };

export type JudgeSettingRecord = RecordBase<'venture-judge-setting'> & {
  auto: boolean;
  consent: { at: IsoTime; by: string; how: 'set' | 'default' | 'send'; entryId: string | null } | null;
};

export type JournalActionId = typeof JOURNAL_ACTION_IDS[number];

export type JournalState = ConnectorPostState;

export type JournalStep = { state: JournalState; at: IsoTime; by: string; line: string };

/**
 * What an approval leaves behind. The token itself reaches only the code that applies it, never a record, a log or a
 * model. usedAt and key are set by the claim, in its own commit, before the effect starts: one token, one apply.
 */
/** approvedBy: null when no person approved it: a send under a standing setting (the rules judge on its own). */
export type ApprovalSeal = { tokenHash: string; approvedBy: string | null; at: IsoTime; expiresAt: IsoTime; usedAt: IsoTime | null; key: string | null };

export type JournalRecord = RecordBase<'venture-journal-entry'> & {
  action: JournalActionId;
  subject: string; // the record it acts on, such as an invoice id, or a run and its call
  target: string; // who or what it touches, in plain words
  actionDigest: string; // exactly what the owner approves
  describe: string; // one plain line for the approver
  agent: string | null; // the agent that proposed it; null when the owner did
  shadow: boolean; // rehearsal: simulated for the agent, never approved or applied
  quote: { figure: string; payer: string } | null; // bound like a spend quote: the draft, the figure and the payer, for an hour
  state: JournalState;
  claimedAt: IsoTime | null; // committed before the effect starts
  decidedBy: string | null;
  outcome: { line: string; url: string | null; by: 'platform' | 'owner' | 'engine' } | null;
  receiptId: string | null;
  journal: JournalStep[];
  approval: ApprovalSeal | null;
  expiresAt: IsoTime;
  /** Whether describe shows everything this will send (W1 H21): false unless the proposer said true. Absent on older entries. */
  descriptionComplete?: boolean;
  /** 4J10 (H28): the account the owner approved this for; it never runs under another (ACCOUNT_FENCE). Absent: none named. */
  account?: string | null;
  /** 4J10 (H28): the connected service's operation a connector.write runs, one Chausar knows (send-deliverable). */
  operation?: string;
  /** 4J10 (H28): keys this action provides, and keys it waits for: it runs after their providers apply, and ends with a refusal. */
  provides?: string[];
  dependsOn?: string[];
  /** 4J10 (H27): a retry of an entry on several targets, and the failed targets it covers, never more. */
  retryOf?: string | null;
  covers?: string[];
} & JournalAfter;

/**
 * 4J10 (H27): what a provider reports after applied (accepted, processed, shown, result; verified needs a dated
 * acceptance check), and, for an action on several targets, how each target ended. On journal entries and posts.
 */
export type JournalEndState = 'accepted' | 'processed' | 'shown' | 'result' | 'verified';

export type JournalEndStep = { state: JournalEndState; at: IsoTime; by: 'platform' | 'engine' | 'owner'; line: string; check?: { id: string; checkedOn: IsoDate } };

export type JournalTargetOutcome = { id: string; outcome: 'applied' | 'rejected' | 'partial' | 'unknown' | 'throttled'; line: string };

export type JournalAfter = { ends?: JournalEndStep[]; targets?: JournalTargetOutcome[] } & ChainStamp;

/**
 * 4J10 (H26): the seq of a record's first link in the chained journal, stamped on the record when it is first linked, so
 * a vault holding stamped records with no chain record or no pin reads corrupt instead of as one from before the chain.
 */
export type ChainStamp = { chainSeq?: number };

export type BrowserProbe = { present: boolean; reason: string };

/** added: the candidates the owner picked for this platform on this computer (venture-posting-steps), tried first. */
/**
 * clickBy: milliseconds since 1970 after which the browser never presses the post button (the journal may already have
 * closed the post as unknown by then).
 */
export type BrowserPostJob = { postId: string; connectorId: string; text: string; timeoutMs: number; added?: PostingStepPick[]; clickBy?: number };

/** One candidate the owner picked for a step by clicking the element once in the window (Ink v2 wave 2, 2B2). */
export type PostingStepPick = { step: PostingStepId; candidate: PostingCandidate };

/** venture.posting.checkSteps asks the browser to find each step's candidates on the compose page, without typing or clicking. */
export type BrowserStepsJob = { connectorId: string; timeoutMs: number; added: PostingStepPick[] };

/**
 * 'checked': how many visible elements each candidate matched (only exactly one counts), and what the owner picked for
 * a step none matched. 'signed-out': the owner signs in first. 'not-run': the reason, a hold the page showed, or
 * refused when the script guard refused a page script. audit: the guard's lines, sha256 and counts only.
 */
export type BrowserStepsResult =
  | { outcome: 'checked'; steps: { step: PostingStepId; key: string; visible: number }[]; picked: PostingStepPick[]; audit: string[] }
  | { outcome: 'signed-out'; line: string; audit: string[] }
  | { outcome: 'not-run'; line: string; hold?: BrowserSiteHold; refused?: boolean; audit: string[] };

/** A security check or a platform block the browser saw on the site (W1 H19). The posting code keeps it as a channel hold. */
export type BrowserSiteHold = { kind: 'challenge' | 'blocked'; site: string };

/** 'not-sent': the platform was never reached, so nothing went out. 'unknown': it may have gone out; check before posting again. */
export type BrowserPostResult =
  | { outcome: 'posted'; line: string; url: string | null; checked?: { step: PostingStepId; key: string }[] }
  | { outcome: 'not-sent'; line: string; hold?: BrowserSiteHold }
  | { outcome: 'unknown'; line: string; hold?: BrowserSiteHold };

/**
 * Drives the owner's own browser on this computer. The real one needs Playwright with Chromium already installed.
 * clearHold: the owner cleared a platform's security check; the hold kept beside the profile folders ends (W1 H19).
 * signIn: opens the platform's own sign-in page in the Chausar profile and settles when the owner closes the window
 * (venture.posting.signIn does not wait for it, Ink v2 wave 2).
 */
export type BrowserPort = {
  probe(): Promise<BrowserProbe>; post(job: BrowserPostJob): Promise<BrowserPostResult>; clearHold?(connectorId: string): Promise<void>;
  /**
   * 4J10 (H28): the account signed in to this platform in the Chausar profile, as the platform names it; null when it
   * cannot tell. A post approved for a named account is refused unless this names the same one (ACCOUNT_FENCE).
   */
  signedInAccount?(connectorId: string): Promise<string | null>;
  signIn?(connectorId: string): Promise<BrowserProbe>;
  /** Finds each posting step's candidates on the compose page without typing or clicking (venture.posting.checkSteps). */
  checkSteps?(job: BrowserStepsJob): Promise<BrowserStepsResult>;
};

export type ApiPostPort = { post(job: BrowserPostJob): Promise<BrowserPostResult>; signedInAccount?(connectorId: string): Promise<string | null> };

/** A post's fingerprint (playbooks/social/risk-gate.ts postPrint): sha256 prefixes of its word groups and linked sites. */
export type PostPrint = { shingles: string[]; domains: string[] };

/** One post that went out, or may have, from any business on this computer: its fingerprint, never its words. */
export type PostLogEntry = { id: string; connectorId: string; at: IsoTime; print: PostPrint };

/**
 * One posting history per computer (build/post-log.ts), kept beside the browser profiles, so two businesses signed in
 * to the same account are counted together by the risk gate (Ink v2 wave 2, K5).
 */
export type PostLogPort = { read(connectorId: string): PostLogEntry[]; append(entry: PostLogEntry): void; remove(connectorId: string, ids: readonly string[]): void };

export type ConnectorPorts = {
  browser?: BrowserPort;
  /** Connector ids whose API app review is recorded (the real host reads CHAUSAR_APP_REVIEWED). */
  appReviewed?: readonly string[];
  /** API posting clients by connector id. None ship in this build. */
  api?: Readonly<Record<string, ApiPostPort>>;
  postTimeoutMs?: number;
  /** The per-computer post log; the real host leaves it out and gets the one on disk beside the browser profiles. */
  postLog?: PostLogPort;
};

/** A staged edit to one website file: applied only with the exact plan digest the owner reviewed, verified, reversible. */
export type SiteEditState = 'staged' | 'applying' | 'applied' | 'rolled-back' | 'rejected' | 'needs-inspection';

export type SiteEditRecord = RecordBase<'venture-site-edit'> & ChainStamp & {
  target: { kind: 'local-folder' | 'github' | 'cloudflare-kv'; identity: string };
  path: string;
  summary: string;
  before: string;
  after: string;
  beforeDigest: string;
  afterDigest: string;
  planDigest: string;
  state: SiteEditState;
  log: { at: IsoTime; by: string; step: 'staged' | 'applied' | 'verified' | 'rolled-back' | 'rejected' | 'needs-inspection'; line: string }[];
};

/**
 * A bank account the owner imports statements into (venture.bank.import, venture.bank.consent). label is the owner's
 * own name for it. consent is read-only access with an end date; no bank provider is wired, so provider stays null and
 * polls (unattended reads, four a day at most) stays empty until one is.
 */
export type BankConsentData = {
  id: string; provider: string | null; accountLabel: string; scope: 'read-only'; grantedAt: IsoTime; expiresAt: IsoTime; revokedAt: IsoTime | null;
};

/**
 * rules: the owner's alert rules for this account (build/bank.ts evaluateAlerts); alertAddress: where alerts go, set
 * by the owner inside the app only. Both absent until the owner sets them (venture.bank.alerts.set).
 */
export type BankAccountRecord = RecordBase<'venture-bank-account'> & {
  label: string; currency: string; consent: BankConsentData | null; polls: IsoTime[];
  rules?: BankAlertRule[]; alertAddress?: { url: string; setBy: string; setAt: IsoTime } | null;
};

/** amountMinor is signed: money in positive, money out negative. id is stable, so a second import never counts a row twice. */
export type BankTransactionData = {
  id: string; date: IsoDate; amountMinor: MinorString; currency: string; counterparty: string | null; description: string | null;
  reference: string | null; balanceAfterMinor: MinorString | null; source: 'statement-csv' | 'provider';
};

/**
 * One statement import: only the transactions it added, with how many were already there and which lines were refused.
 * alerts: what the owner's alert rules found in this import (2D), absent when none did; Today shows them in the app.
 */
export type BankImportRecord = RecordBase<'venture-bank-import'> & {
  accountId: string; fileDigest: string; transactions: BankTransactionData[]; duplicates: number; rejected: { line: number; reason: string }[]; line: string;
  alerts?: BankAlert[];
};

export type BankImportResult = {
  account: string; accountId: string; added: number; duplicates: number; rejected: { line: number; reason: string }[]; line: Display; transactions: number;
};

export type BankConsentView = {
  account: string; accountId: string; consent: BankConsentData;
  status: { state: 'active' | 'expiring' | 'expired' | 'revoked'; daysLeft: number; line: Display };
  provider: Display; // why nothing reads the bank yet
};

/**
 * The owner's decision on one bank statement row (venture.bank.apply): recorded as a payment of an invoice, written to
 * the books as a cost, or skipped. One per row; the payment, the books fact or neither is named. transactionId is the
 * ledger row id, '<account id>:<transaction id>', unique in the business even when two accounts hold the same file.
 */
export type BankMatchRecord = RecordBase<'venture-bank-match'> & {
  transactionId: string; accountId: string; as: 'payment' | 'cost' | 'skip';
  invoiceId: string | null; paymentId: string | null; factId: string | null;
};

/** Leads (customers/leads.ts): a lead needs its source page; an email counts once a mail server check found a server. */
export type LeadEmailCheck = { status: 'unverified' | 'verified' | 'failed'; at: IsoTime | null; line: string };

export type OutreachDraftView = {
  id: string; leadId: string; to: string; subject: string; text: string;
  footer: { businessName: string; postalAddress: string; unsubscribe: string }; sourceUrl: string; by: 'agent' | 'owner'; at: IsoTime; digest: string;
};

export type LeadSendView = { draftId: string; sentAt: IsoTime; recordedBy: string; recordedAt: IsoTime; channel: 'own-mailbox' };

/** A lead's stage moves forward only; won and lost are terminal; blocked (an opt-out) is never left. Each move keeps its evidence. */
export type LeadStageView = 'new' | 'drafted' | 'contacted' | 'replied' | 'won' | 'lost' | 'blocked';

export type LeadMoveView = { from: LeadStageView; to: LeadStageView; at: IsoTime; by: string; evidence: { kind: 'draft' | 'send' | 'reply' | 'outcome' | 'opt-out'; id: string } };

export type LeadView = {
  id: string; name: string; company: string | null; email: string | null; emailDomain: string | null; sourceUrl: string; emailCheck: LeadEmailCheck;
  status: LeadStageView; drafts: OutreachDraftView[]; sends: LeadSendView[]; moves: LeadMoveView[]; addedBy: string; addedAt: IsoTime;
};

export type LeadRecord = RecordBase<'venture-lead'> & Omit<LeadView, 'id'>;

/** The business's outreach settings: the postal address every draft carries (set by the owner only) and the blocklist. */
export type LeadSettingsRecord = RecordBase<'venture-lead-settings'> & {
  postalAddress: string | null; blockedEmails: string[]; blockedDomains: string[];
  /** 4E2: phones (E.164) and LinkedIn profile addresses, so a "stop" on WhatsApp or LinkedIn is honoured; absent is none. */
  blockedHandles?: string[];
};
