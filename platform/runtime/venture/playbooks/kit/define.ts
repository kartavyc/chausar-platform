// Chausar playbook kit: the shape every wave 5 playbook fills in its playbooks/<id>/definition.ts (Ink v2 wave 5, plan
// "Package 5A1", the definition table). Types only: package 5-0 wrote them so batch 1 and every business package code
// against one shape; 5A1 adds definePlaybook (the checks that refuse a bad definition) and the adapter into the
// flagships' FlagshipPlan, FlagshipDelivery and FlagshipCheckInput beside these types, and may tighten a field here.
// Departments are wave 4's ids (4A1, playbooks/departments.ts): 'sales' is "Sales and clients". The dated rule, the
// recipe and the measurement boundary are 5A3's shapes, declared here so a definition can hold them before 5A3 lands;
// 5A3's kit/rules.ts re-exports DatedRule from here rather than declaring a second one. Written for Chausar; nothing
// here is learned from an outside source.
import type { DepartmentId, IsoDate, PlaybookCheckResult, PlaybookStep, PricingModel, WayCategory } from '../../contracts.ts';
import type { RightsBasis } from '../../delivery/rights.ts';
import type { RuleFloor } from '../../delivery/judge/rules.ts';
import type { FlagshipCheckInput } from '../draft-checks.ts';
import type { PlaybookRegistration } from '../registry.ts';

/** A kit intake value as the order keeps it (OrderIntake.fields). A file is an upload id; money is minor units as text. */
export type IntakeValue = string | boolean | readonly string[] | null;

/** Who an offer's work is for: 'client' and 'public' work gets the automatic judge (2C1 judgeAuto); 'internal' none. */
export type OfferAudience = 'client' | 'public' | 'internal';

export type KitOffer = {
  id: string;
  name: string;
  description: string;
  pricing: PricingModel;
  /** What one unit is, as it reads after a price: "per episode", "per video minute". */
  unit: string;
  /** Always 'owner-sets': the owner sets every price (definePlaybook refuses anything else). */
  price: 'owner-sets';
  /** The step ids the offer runs, in order; with more than one run, the chain (5A1 kit/chain.ts) carries them across runs. */
  stages: readonly string[];
  includes: readonly string[];
  /** At least one offer of every kit playbook can be offered as a paid pilot (5A2 pilotOf). */
  pilotable: boolean;
  /** The rights bases accepted at intake when the offer touches third-party media; empty when it touches none. */
  rights: readonly RightsBasis[];
  /** The intake field ids the offer asks for. */
  intake: readonly string[];
  audience: OfferAudience;
};

export type KitRole = {
  id: string;
  name: string;
  /** 'code' roles (Chausar, Keeper, Billing) say they are code, never AI; 'person' is the owner or someone they name. */
  kind: 'agent' | 'code' | 'person';
  department: DepartmentId;
  /** One line on what the role does, in plain words. */
  job: string;
};

/**
 * One step: the engine's PlaybookStep (with 4J12's next, maxLoops, onExceeded and timeoutMs) plus who does it, what it
 * makes, how many days it may wait on a person before a Today row, why it always asks (floor) and the connector it
 * needs (a catalogue id).
 */
export type KitStep = PlaybookStep & {
  role: string;
  produces: string;
  waitDays?: number;
  floor?: string;
  connector?: string;
};

export type KitApproval = {
  id: string;
  words: string;
  step: string;
  who: 'owner' | 'client' | 'ca' | 'other';
  /** On the always-ask floor: asks at every posture. */
  floor: boolean;
  /** Asks a second time before it acts (money, sending, deleting). */
  secondAsk: boolean;
};

/** The six honest connector labels: what works today, and what is planned with who it waits on. */
export type KitConnectorLabel = 'write' | 'read' | 'handoff' | 'planned: write' | 'planned: read' | 'planned: handoff';

export type KitConnector = {
  id: string;
  name: string;
  label: KitConnectorLabel;
  note: string;
  /** Required when the label is planned (P5): what the owner does by hand meanwhile. */
  manualPath?: string;
  /** Required when the label is planned: the outside party it waits on (an app review, a partner programme). */
  waitsOn?: string;
  desktopOnly?: boolean;
  /** The connector catalogue entry it is, when it has one (build/catalogue.ts or build/catalogue/<id>.ts). */
  catalogueId?: string;
};

export type IntakeFieldKind = 'rights' | 'choice' | 'yes-no' | 'text' | 'list' | 'date' | 'money' | 'file' | 'consent';

export type KitIntakeField = {
  id: string;
  label: string;
  help: string;
  kind: IntakeFieldKind;
  required: boolean;
  /** The choices, for a 'choice' field. */
  options?: readonly string[];
};

/** One deterministic check's result on a kit draft: the engine's shape. */
export type KitCheckResult = PlaybookCheckResult;
export type KitCheck = (input: FlagshipCheckInput) => KitCheckResult[];

/** A yes or no rule for the judge, with its floor: a share of yes votes, or a required yes. */
export type KitJudgeRule = { id: string; question: string; text: string; floor: RuleFloor };

/** One committed baseline case: a draft scored by code, never a model. */
export type KitBaselineCase = { id: string; request: string; draft: string; meta?: Readonly<Record<string, string>> };
export type KitBaseline = {
  name: string;
  /** The folder under playbooks/<id>/ holding baselines/<id>.json. */
  folder: string;
  score(testCase: KitBaselineCase, draft: string, meta: Readonly<Record<string, string>>): { pass: boolean; why: string };
};

/** How a dated rule was read: an official source, a secondary one, Chausar's own house rule, or not confirmed. */
export type RuleRead = 'official' | 'secondary' | 'house' | 'unconfirmed';

/** One dated rule (P1's register, generalised by 5A3): what it says, where it came from, when it was checked, who uses it. */
export type DatedRule = {
  id: string;
  scope: string;
  topic: string;
  /** The rule in plain words. */
  rule: string;
  /** A limit's value and unit, as data (never computed by a model). */
  value?: string;
  unit?: string;
  sources: readonly { title: string; url: string }[];
  checkedOn: IsoDate;
  read: RuleRead;
  how: string;
  /** The step and check ids that rest on this rule. */
  usedBy: readonly string[];
  limitations: string;
  /** Default 90. */
  recheckAfterDays?: number;
  /** For a rule a CA or lawyer must confirm: who and when, or null until then (rehearsal only). */
  confirmedBy?: { name: string; on: IsoDate } | null;
};

/** P6: a recipe the owner can follow, with the why of each step and the mistakes to avoid. */
export type KitRecipe = {
  id: string;
  name: string;
  whenToUse: string;
  steps: readonly { do: string; why: string }[];
  howToRead: string;
  /** A mistake marked judge becomes a judge rule with its own floor. */
  mistakes: readonly { text: string; judge?: boolean }[];
};

/** P6: what one kind of evidence can say and cannot say. */
export type KitBoundary = { evidence: string; canSay: string; cannotSay: string };

/** One practice client: clean, messy or pushy, with its request and files. */
export type KitPracticeClient = {
  kind: 'clean' | 'messy' | 'pushy';
  name: string;
  request: string;
  files: readonly { name: string; text: string }[];
};

/** Which offers, approvals and connectors the one-page plan names. */
export type KitPlanPicks = { offers: readonly string[]; approvals: readonly string[]; connectors: readonly string[] };

/**
 * The Start gallery's tile: category, icon, line, what the owner does and the hours a week, the team (at most four role
 * ids) and what clients usually pay. Hours and pay are a model estimate, always labelled so (wave 4's ways.ts WayData
 * is how the gallery shows them today; 5A1 maps one onto the other).
 */
export type StartTile = {
  category: WayCategory;
  icon: string;
  line: string;
  youDo: { hoursMin: number; hoursMax: number; line: string };
  team: { roleIds: readonly string[]; line: string };
  pay: { minRupees: number; maxRupees: number; per: string };
};

/** What the honest exit (5A2 scopeOf) reads: phrases in and out of scope, and where to point the rest. */
export type KitScope = { inScope: readonly string[]; outOfScope: readonly string[]; pointElsewhere: string };

/** Everything a business package fills in its playbooks/<id>/definition.ts (the plan's 5A1 table). */
export type PlaybookDefinition = {
  registration: PlaybookRegistration;
  offers: readonly KitOffer[];
  roles: readonly KitRole[];
  steps: readonly KitStep[];
  approvals: readonly KitApproval[];
  connectors: readonly KitConnector[];
  intakeFields: readonly KitIntakeField[];
  checks: readonly KitCheck[];
  checkIds: readonly string[];
  judgeRules: readonly KitJudgeRule[];
  baseline: KitBaseline;
  rules: readonly DatedRule[];
  boundaries: readonly KitBoundary[];
  recipes: readonly KitRecipe[];
  practice: readonly KitPracticeClient[];
  /** The playbook's own tool names (contracts.ts TOOL_NAMES), granted only to its own roles. */
  tools: readonly string[];
  planPicks: KitPlanPicks;
  /** The writing step for an order on this offer. */
  draftStep(offerId: string | null): string;
  startTile: StartTile;
  scope: KitScope;
  /** What is never built for this playbook, in plain words. */
  notBuilt: readonly string[];
  /** Every string shown to people, for the word checks and the Hindi file (playbooks/<id>/hi.json). */
  words(): readonly string[];
};
