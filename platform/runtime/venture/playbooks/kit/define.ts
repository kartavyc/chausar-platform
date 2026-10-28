// Chausar playbook kit: the shape every wave 5 playbook fills in its playbooks/<id>/definition.ts (Ink v2 wave 5, plan
// "Package 5A1", the definition table). Types only: package 5-0 wrote them so batch 1 and every business package code
// against one shape; 5A1 adds definePlaybook (the checks that refuse a bad definition) and the adapter into the
// flagships' FlagshipPlan, FlagshipDelivery and FlagshipCheckInput beside these types, and may tighten a field here.
// Departments are wave 4's ids (4A1, playbooks/departments.ts): 'sales' is "Sales and clients". The dated rule, the
// recipe and the measurement boundary are 5A3's shapes, declared here so a definition can hold them before 5A3 lands;
// 5A3's kit/rules.ts re-exports DatedRule from here rather than declaring a second one. Written for Chausar; nothing
// here is learned from an outside source.
import { ChausarError } from '../../../contracts.ts';
import { DEPARTMENT_IDS, TOOL_NAMES } from '../../contracts.ts';
import type { DepartmentId, IsoDate, PlaybookCheckResult, PlaybookStep, PricingModel, WayCategory } from '../../contracts.ts';
import type { ApprovalBlockId } from '../../onboarding-contracts.ts';
import type { RightsBasis } from '../../delivery/rights.ts';
import type { RuleFloor } from '../../delivery/judge/rules.ts';
import { validateFlow } from '../../delivery/flow.ts';
import type { FlagshipCheckInput } from '../draft-checks.ts';
import { validateRegistry, type PlaybookRegistration } from '../registry.ts';
import { allWords, hiProblem, keepHi, loadHi, wordProblem, type HiFile } from './words.ts';
import { createRequire } from 'node:module';
import type { ToolName } from '../../contracts.ts';
import { TOOL_GROUPS } from '../../delivery/harness/tool-groups.ts';
import { validateRules } from './rules.ts';
import { localDayAt } from '../../local-day.ts';
import { recipeJudgeRules, validateRecipes } from './recipes.ts';
import { validateBoundaries } from './boundaries.ts';
import { validateManualPaths, withManualPaths } from './manual-path.ts';

/** One person seen or heard in the work, with the voice consent recorded for them (5A4), or null when none is yet. */
export type IntakePerson = { name: string; consentId: string | null };
/**
 * A kit intake value as the order keeps it (OrderIntake.fields). A file is an upload id; money is minor units as text;
 * people (5A4) are each person with their consent.
 */
export type IntakeValue = string | boolean | readonly string[] | readonly IntakePerson[] | null;

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
  /** The library approval it refines on the one-page plan (5A1); 'each-draft' when absent. */
  block?: ApprovalBlockId;
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

/** 'people' (5A4): the people seen or heard in the work, each with their recorded consent (kit/voice-consent.ts). */
export type IntakeFieldKind = 'rights' | 'choice' | 'yes-no' | 'text' | 'list' | 'date' | 'money' | 'file' | 'consent' | 'people';

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
  /**
   * Who must confirm the rule before a client's work rests on it (5A3): 'ca', 'lawyer', or null for a rule that needs
   * no one. Never left out, so a tax or legal rule cannot fail open (validateRules refuses a rule without it).
   */
  needs: 'ca' | 'lawyer' | null;
  /**
   * Present exactly when needs is not null: who confirmed it and when, or null until then (practice runs only). A rule
   * that needs no one carries none.
   */
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

// ---------------------------------------------------------------------------
// definePlaybook: the checks that refuse a bad definition (5A1)
// ---------------------------------------------------------------------------

const CONNECTOR_LABELS: readonly KitConnectorLabel[] = ['write', 'read', 'handoff', 'planned: write', 'planned: read', 'planned: handoff'];
const INTAKE_KINDS: readonly IntakeFieldKind[] = ['rights', 'choice', 'yes-no', 'text', 'list', 'date', 'money', 'file', 'consent', 'people'];
const PRICING: readonly PricingModel[] = ['monthly', 'project', 'hourly'];
const AUDIENCES: readonly OfferAudience[] = ['client', 'public', 'internal'];
const CATEGORIES: readonly WayCategory[] = ['content', 'marketing', 'money-and-tax', 'shops-and-firms'];
const ROLE_KINDS: readonly KitRole['kind'][] = ['agent', 'code', 'person'];
const WHO: readonly KitApproval['who'][] = ['owner', 'client', 'ca', 'other'];
/** The most hours a week a tile may say the owner works. */
export const TILE_MAX_HOURS = 60;
/** The most roles a tile's team shows. */
export const TILE_MAX_TEAM = 4;

/**
 * The engine's own playbook checks and tool ceiling, read when definePlaybook runs, never at import: delivery/playbook.ts
 * and the harness load the flagship playbooks, which load this file, so a static import here would meet them half set
 * up (kit/installed.ts loads the landed definitions on first use for the same reason).
 */
function engine(): {
  validatePlaybook: (steps: PlaybookStep[], extras: { limits: unknown; aliases: Record<string, string[]> }) => unknown;
  DEFAULT_LIMITS: object;
  toolCeiling: (type: PlaybookRegistration['serviceType'], flagship: string | null, definitions: readonly PlaybookDefinition[]) => ToolName[];
} {
  const load = createRequire(import.meta.url);
  return { ...load('../../delivery/playbook.ts'), ...load('../../delivery/harness/loop.ts'), ...load('../../delivery/harness/patches.ts') };
}

/** The kit fields of a step that are not the engine's: who does it, what it makes, waits, floor and connector. */
const KIT_STEP_FIELDS = ['role', 'produces', 'waitDays', 'floor', 'connector'] as const;

/** A kit step as the engine runs it: the engine's PlaybookStep without the kit's own fields. */
export function engineStep(step: KitStep): PlaybookStep {
  const copy: Record<string, unknown> = structuredClone({ ...step });
  for (const field of KIT_STEP_FIELDS) delete copy[field];
  return copy as PlaybookStep;
}

/**
 * A definition's steps as the engine runs them, in order, each step that needs a planned connector with its manual
 * path in its guidance (5A3 kit/manual-path.ts), so the agent asks for the export instead of pretending to fetch it.
 */
export function kitEngineSteps(definition: Pick<PlaybookDefinition, 'steps' | 'connectors'>): PlaybookStep[] {
  return withManualPaths(definition).map(engineStep);
}

/**
 * Refuses a bad definition with PLAYBOOK_DEFINITION_INVALID, naming the playbook and the field. Checks the
 * registration, the roles (each in one of the five departments), the steps (each done by a role it has, edges to steps
 * it has, every loop capped, a floor step with its approval point), the offers (stages it has, intake fields it has,
 * 'owner-sets' as the price), the approvals, the connectors (one of the six labels; a planned one names its manual path
 * and who it waits on), the intake fields, the judge rules (each with a floor), the tools, the tile (hours from one to
 * sixty, the fewest first; rupees above zero, the lowest first; at most four team roles it has) and every shown string
 * (house style, no claim of finished work, no number, and its Hindi in hi.json). Each step holds only tools inside its
 * own ceiling (patches.ts toolCeiling with this definition alone), its own tools are the kit's or its own group's, and
 * its engine steps pass the engine's own validatePlaybook. 5A3's dated rules, recipes, measurement boundaries and manual
 * paths are checked by their own functions (their codes: RULE_INVALID, RECIPE_INVALID, BOUNDARY_INVALID,
 * MANUAL_PATH_MISSING), and the recipes' judge mistakes join the judge rules.
 * hi: the playbook's Hindi; default its own playbooks/<id>/hi.json. today: the day the rules are checked against
 * (default the India calendar day now). Returns the definition, frozen.
 */
export function definePlaybook(definition: PlaybookDefinition, hi?: HiFile, today: IsoDate = localDayAt(new Date(), { code: 'IN' })): PlaybookDefinition {
  const id = typeof definition?.registration?.id === 'string' ? definition.registration.id : 'new';
  const refuse = (field: string, why: string): never => {
    throw new ChausarError('PLAYBOOK_DEFINITION_INVALID', `The ${id} playbook's ${field}: ${why}`);
  };
  try { validateRegistry([definition.registration]); } catch (error) { refuse('registration', (error as Error).message); }

  const roles = new Map<string, KitRole>();
  for (const role of definition.roles ?? []) {
    if (roles.has(role.id)) refuse('roles', `the role ${role.id} is listed twice.`);
    roles.set(role.id, role);
    if (!ROLE_KINDS.includes(role.kind)) refuse('roles', `${role.name} needs a kind: agent, code or person.`);
    if (!(DEPARTMENT_IDS as readonly string[]).includes(role.department)) refuse('roles', `${role.name} needs one of the five departments.`);
  }

  const steps = new Map<string, KitStep>();
  for (const step of definition.steps ?? []) {
    if (steps.has(step.id)) refuse('steps', `the step ${step.id} is listed twice.`);
    steps.set(step.id, step);
  }
  for (const step of steps.values()) {
    if (!roles.has(step.role)) refuse('steps', `the step ${step.id} is done by ${step.role}, which is not one of its roles.`);
    for (const edge of step.next ?? []) if (!steps.has(edge.to)) refuse('steps', `the step ${step.id} leads to ${edge.to}, which is not one of its steps.`);
    if (step.maxLoops !== undefined && !(Number.isInteger(step.maxLoops) && step.maxLoops >= 1 && step.maxLoops <= 3)) refuse('steps', `the step ${step.id} may come back one to three times.`);
    if (step.waitDays !== undefined && !(Number.isInteger(step.waitDays) && step.waitDays >= 1 && step.waitDays <= 90)) refuse('steps', `the step ${step.id} may wait one to ninety days.`);
    if (step.connector !== undefined && !(definition.connectors ?? []).some(connector => connector.id === step.connector)) refuse('steps', `the step ${step.id} needs the connector ${step.connector}, which is not one of its connectors.`);
    for (const tool of step.tools ?? []) if (!(TOOL_NAMES as readonly string[]).includes(tool)) refuse('steps', `the step ${step.id} holds ${tool}, which is not a tool Chausar has.`);
  }
  try { validateFlow(kitEngineSteps(definition)); } catch (error) { refuse('steps', (error as Error).message); }
  // Its own tools: the kit's shared ones or its own group's, never another playbook's (tool-groups.ts).
  for (const tool of definition.tools ?? []) {
    if (!(TOOL_NAMES as readonly string[]).includes(tool)) refuse('tools', `${tool} is not a tool Chausar has.`);
    const group = TOOL_GROUPS[tool as keyof typeof TOOL_GROUPS];
    if (group !== 'kit' && group !== id) refuse('tools', `${tool} is another playbook's tool.`);
  }
  // Each step holds only what this playbook's agents may ever hold, by the engine's own ceiling.
  const { validatePlaybook, DEFAULT_LIMITS, toolCeiling } = engine();
  const ceiling = toolCeiling(definition.registration.serviceType, id, [definition]);
  for (const step of steps.values()) {
    for (const tool of step.tools ?? []) if (!ceiling.includes(tool)) refuse('steps', `the step ${step.id} holds ${tool}, which this playbook's agents may not hold.`);
  }
  try { validatePlaybook(kitEngineSteps(definition), { limits: { ...DEFAULT_LIMITS }, aliases: {} }); } catch (error) { refuse('steps', (error as Error).message); }

  const fields = new Map<string, KitIntakeField>();
  for (const field of definition.intakeFields ?? []) {
    if (fields.has(field.id)) refuse('intakeFields', `the field ${field.id} is listed twice.`);
    fields.set(field.id, field);
    if (!INTAKE_KINDS.includes(field.kind)) refuse('intakeFields', `the field ${field.id} has an unknown kind.`);
    if (field.kind === 'choice' && !(field.options ?? []).length) refuse('intakeFields', `the choice ${field.id} needs its options.`);
  }

  const offers = definition.offers ?? [];
  if (!offers.length) refuse('offers', 'it needs at least one offer.');
  for (const offer of offers) {
    if ((offer as { price: unknown }).price !== 'owner-sets') refuse('offers', `the offer ${offer.id} must leave its price to the owner ('owner-sets').`);
    if (!PRICING.includes(offer.pricing)) refuse('offers', `the offer ${offer.id} is sold monthly, by the project or by the hour.`);
    if (!AUDIENCES.includes(offer.audience)) refuse('offers', `the offer ${offer.id} is for a client, the public or internal use.`);
    if (!offer.stages.length) refuse('offers', `the offer ${offer.id} needs its stages.`);
    for (const stage of offer.stages) if (!steps.has(stage)) refuse('offers', `the offer ${offer.id} names the step ${stage}, which does not exist.`);
    for (const field of offer.intake) if (!fields.has(field)) refuse('offers', `the offer ${offer.id} asks for ${field}, which is not one of its intake fields.`);
  }
  if (!offers.some(offer => offer.pilotable)) refuse('offers', 'at least one offer can be a paid pilot.');

  for (const approval of definition.approvals ?? []) {
    if (!steps.has(approval.step)) refuse('approvals', `the approval ${approval.id} is on the step ${approval.step}, which does not exist.`);
    if (!WHO.includes(approval.who)) refuse('approvals', `the approval ${approval.id} needs who decides.`);
  }
  for (const step of steps.values()) {
    if (step.floor === undefined) continue;
    const points = (definition.approvals ?? []).filter(approval => approval.step === step.id);
    if (!points.length) refuse('steps', `the step ${step.id} always asks, so it needs an approval point.`);
    const off = points.find(approval => !approval.floor);
    if (off) refuse('approvals', `the step ${step.id} always asks, so its approval ${off.id} must be on the floor too.`);
  }

  for (const connector of definition.connectors ?? []) {
    if (!CONNECTOR_LABELS.includes(connector.label)) refuse('connectors', `the connector ${connector.id} needs one of the six labels: write, read, handoff, or planned.`);
  }
  // 5A3 (P5): a planned connector's manual path and who it waits on are checked once, by validateManualPaths below.

  for (const rule of definition.judgeRules ?? []) {
    const floor = rule.floor as { kind?: unknown; percent?: unknown } | undefined;
    const ok = floor?.kind === 'required-yes' || (floor?.kind === 'share' && Number.isInteger(floor.percent) && (floor.percent as number) >= 1 && (floor.percent as number) <= 100);
    if (!ok) refuse('judgeRules', `the rule ${rule.id} needs a floor: a share of yes votes or a required yes.`);
  }
  if (!steps.has(definition.draftStep(null))) refuse('draftStep', 'its usual writing step is not one of its steps.');
  if (definition.checks.length !== definition.checkIds.length) refuse('checkIds', 'each check needs its id.');

  const tile = definition.startTile;
  if (!CATEGORIES.includes(tile.category)) refuse('startTile', 'it needs a category: content, marketing, money and tax, or shops and firms.');
  const { hoursMin, hoursMax } = tile.youDo;
  if (!Number.isInteger(hoursMin) || !Number.isInteger(hoursMax) || hoursMin < 1 || hoursMin > hoursMax || hoursMax > TILE_MAX_HOURS) {
    refuse('startTile', 'the hours a week are whole hours from one to sixty, the fewest first.');
  }
  const { minRupees, maxRupees } = tile.pay;
  if (!Number.isSafeInteger(minRupees) || !Number.isSafeInteger(maxRupees) || minRupees < 1 || minRupees > maxRupees) refuse('startTile', 'what clients pay is whole rupees above zero, the lowest first.');
  if (tile.team.roleIds.length > TILE_MAX_TEAM) refuse('startTile', 'its team shows at most four roles.');
  for (const role of tile.team.roleIds) if (!roles.has(role)) refuse('startTile', `its team names ${role}, which is not one of its roles.`);

  const kinds = (definition.practice ?? []).map(client => client.kind).sort().join(',');
  if (kinds !== 'clean,messy,pushy') refuse('practice', 'it needs three practice clients: a clean, a messy and a pushy one.');
  for (const client of definition.practice) {
    if (!client.request?.trim()) refuse('practice', `the ${client.kind} client needs a request.`);
    for (const file of client.files) if (!/\.(csv|srt|vtt)$/i.test(file.name)) refuse('practice', `${file.name} is not a file the tools read: CSV, SRT or VTT.`);
  }

  // 5A3: the dated rules, recipes, measurement boundaries and manual paths, in their own codes, before their words are
  // read; and a recipe's judge rule never takes a judge rule's id.
  validateRules(definition.rules, definition, today);
  validateRecipes(definition.recipes);
  validateBoundaries(definition.boundaries);
  validateManualPaths(definition);
  const fromRecipes = recipeJudgeRules(definition.recipes);
  const own = new Set((definition.judgeRules ?? []).map(rule => rule.id));
  for (const rule of fromRecipes) if (own.has(rule.id)) refuse('judgeRules', `${rule.id} is also a recipe's judge rule; give it another id.`);

  const hindi = hi ?? loadHi(id);
  for (const text of allWords(definition)) {
    const problem = wordProblem(text) ?? hiProblem(hindi, text);
    if (problem) refuse('words', `${JSON.stringify(text)} ${problem}.`);
  }
  if (hi) keepHi(id, hi);
  return Object.freeze({ ...definition, judgeRules: Object.freeze([...definition.judgeRules, ...fromRecipes]) });
}
