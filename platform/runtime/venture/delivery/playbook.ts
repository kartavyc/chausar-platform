// Chausar venture launcher, delivery package (P5): the playbook a delivery agent follows.
// Steps are fixed by code; the only words taken from the plan are the work and drafting steps' titles. Agent steps
// name the tools they may call (deny by default) and hold guidance the improvement loop can change with typed
// patches. Playbook versions are never overwritten: every change is a new version, and the business points at one.
// The owner's own changes from chat are versions too (ownerVersion, Ink v2 wave 4).
import { check, type Context, type State } from '../../contracts.ts';
import { digest, exactPayload, findRecord, listRecords, ventureAction, type VentureTx } from '../records.ts';
import { CHECK_IDS, REQUIRED_SECTIONS, TOOL_NAMES } from '../contracts.ts';
import type {
  BlueprintRecord, CheckId, ExecutionTier, HarnessLimits, OrderIntake, PlaybookPatch, PlaybookRecord, PlaybookStep, StepKind, ToolName, VentureDeps,
  VentureRecord,
} from '../contracts.ts';
import { dictionaryEntries } from './harness/dictionary.ts';
import { DEFAULT_LIMITS } from './harness/loop.ts';
import { applyPatch, toolCeiling, type PlaybookBody } from './harness/patches.ts';
import { toolSpec } from './harness/tools.ts';
import { acceptedBlueprint, latestPlaybook, readAs } from './shared.ts';
import { DRAFT_CHECKS, VERIFY_CHECKS } from './check-lists.ts';
import { pickPlaybook } from '../playbooks/registry.ts';
import { flagshipDelivery } from '../playbooks/steps.ts';
import { validateFlow } from './flow.ts';

const STEP_KINDS: readonly StepKind[] = ['gather', 'question', 'work', 'compute', 'write', 'verify', 'approve', 'operator'];
const TIER_ORDER: readonly ExecutionTier[] = ['code', 'actor', 'wasm-lite', 'wasm', 'container', 'owner-cli', 'hosted'];
/**
 * The highest tier a playbook may name. The light sandbox runs everywhere; containers run only where Docker is set
 * up, and the owner's own command-line tool only where it is installed, after the owner approves a brief; a step asks
 * for either only through a tool that checks first. agentOS and hosted sandboxes are planned.
 */
export const TIER_CEILING: ExecutionTier = 'owner-cli';
const PLANNED_TIERS: readonly ExecutionTier[] = ['wasm', 'hosted'];
const CODE_ONLY_KINDS: readonly StepKind[] = ['compute', 'verify', 'approve', 'operator'];
const AGENT_KINDS: readonly StepKind[] = ['gather', 'question', 'work'];

/** The verify and draft check lists live in check-lists.ts, so the flagship playbooks can name them without this file. */
export { DRAFT_CHECKS, VERIFY_CHECKS };
// evidence.record (Ink v2 wave 2): the agents that read the client's files may note where a fact came from.
const READ_TOOLS: readonly ToolName[] = ['files.list', 'files.read', 'dictionary.browse', 'dictionary.resolve', 'handoff.client', 'handoff.owner', 'evidence.record'];
const WORK_TOOLS: readonly ToolName[] = ['files.read', 'calc.sum', 'calc.totals', 'books.reconcile', 'bills.pick', 'sandbox.transform', 'sandbox.python', 'handoff.client', 'handoff.owner', 'agent.delegate', 'evidence.record'];

export const GENERIC_WORK_TITLE = 'Do the hands-on work with tools';

/**
 * The plan steps the playbook takes its two titles from. A composed plan (any step has a block) finds them by block:
 * the drafting step is draft-reply, and only a hands-on-work step may name the agent's work step, so in-person work
 * or a meeting is never credited to an agent. A template plan keeps step_3 and step_2.
 */
export function playbookSources(blueprint: BlueprintRecord): { drafting: BlueprintRecord['deliverySteps'][number] | undefined; handsOn: BlueprintRecord['deliverySteps'][number] | undefined } {
  const composed = blueprint.deliverySteps.some(step => step.block !== undefined);
  if (composed) {
    return {
      drafting: blueprint.deliverySteps.find(step => step.block === 'draft-reply'),
      handsOn: blueprint.deliverySteps.find(step => step.block === 'hands-on-work'),
    };
  }
  return { drafting: blueprint.deliverySteps.find(step => step.id === 'step_3'), handsOn: blueprint.deliverySteps.find(step => step.id === 'step_2') };
}

/**
 * The flagship playbook a business delivers with: the one its idea picks, when its plan came from that playbook (the
 * plan's offers keep the playbook's offer ids, playbooks/plan.ts). A plan made before, or from the templates, keeps
 * the eight fixed steps.
 */
export function deliveryFlagship(venture: Pick<VentureRecord, 'idea'>, blueprint: Pick<BlueprintRecord, 'offers'>): string | null {
  const id = pickPlaybook(venture.idea)?.id ?? null;
  return id && flagshipDelivery(id) && blueprint.offers.some(offer => offer.playbookOffer) ? id : null;
}

/**
 * The steps for an accepted plan: a flagship playbook's own typed steps (playbooks/steps.ts), else the eight fixed
 * steps, whose work and drafting titles come from the plan.
 */
export function playbookSteps(blueprint: BlueprintRecord, flagship: string | null = null): PlaybookStep[] {
  const own = flagshipDelivery(flagship);
  if (own) return structuredClone([...own.steps]);
  const { drafting, handsOn } = playbookSources(blueprint);
  check(drafting, 'INVALID_VENTURE_REQUEST', 'The plan has no drafting step.');
  const ceiling = toolCeiling(blueprint.serviceType);
  return [
    { id: 'gather', kind: 'gather', title: "Read the client's message and files and pull out what is needed", tier: 'actor', model: 'fast', doneBy: 'agent', requiredSections: [], checks: [], tools: [...READ_TOOLS], guidance: [] },
    { id: 'clarify', kind: 'question', title: 'Decide what is still unclear', tier: 'actor', model: 'fast', doneBy: 'agent', requiredSections: [], checks: ['questions-raised'], tools: ['dictionary.resolve', 'handoff.client', 'handoff.owner'], guidance: [] },
    { id: 'work', kind: 'work', title: handsOn?.title.value ?? GENERIC_WORK_TITLE, tier: 'wasm-lite', model: 'fast', doneBy: 'agent', requiredSections: [], checks: [], tools: WORK_TOOLS.filter(tool => ceiling.includes(tool)), guidance: [] },
    { id: 'price', kind: 'compute', title: 'Take prices from the calculator', tier: 'code', model: null, doneBy: 'agent', requiredSections: [], checks: ['figures-resolve'], tools: [], guidance: [] },
    { id: 'draft', kind: 'write', title: drafting.title.value, tier: 'actor', model: 'main', doneBy: 'agent', requiredSections: [...REQUIRED_SECTIONS[blueprint.serviceType]], checks: [...DRAFT_CHECKS], tools: [], guidance: [] },
    { id: 'verify', kind: 'verify', title: 'Check the draft', tier: 'code', model: null, doneBy: 'agent', requiredSections: [], checks: [...VERIFY_CHECKS], tools: [], guidance: [] },
    { id: 'approve', kind: 'approve', title: 'You review the draft', tier: 'code', model: null, doneBy: 'you', requiredSections: [], checks: [], tools: [], guidance: [] },
    { id: 'send', kind: 'operator', title: 'Send it to the client (you copy it for now)', tier: 'code', model: null, doneBy: 'you', requiredSections: [], checks: ['no-outside-writes'], tools: [], guidance: [] },
  ];
}

const refuse = (message: string) => check(false, 'INVALID_VENTURE_REQUEST', message);

/** The digest a run records. With harness settings it covers the steps, the limits and the dictionary aliases. */
export function playbookHash(steps: PlaybookStep[], extras?: { limits: HarnessLimits; aliases: Record<string, string[]> }): string {
  return extras ? digest({ steps, limits: extras.limits, aliases: extras.aliases }) : digest(steps);
}

/**
 * Only validated playbooks run. Refuses duplicate ids, a code, approval or operator step with a model or tools, a
 * tier above the ceiling or one that is planned, an unknown tool, an outside-write tool on any step, tools on a
 * writing step, a write step without required sections or without the done-claim check, and an operator step that
 * comes before an approval step.
 */
export function validatePlaybook(steps: PlaybookStep[], extras?: { limits: HarnessLimits; aliases: Record<string, string[]> }): { hash: string; validated: true; tierCeiling: ExecutionTier } {
  check(Array.isArray(steps) && steps.length >= 1 && steps.length <= 20, 'INVALID_VENTURE_REQUEST', 'A playbook needs between one and twenty steps.');
  const ids = new Set<string>();
  let approvalSeen = false;
  for (const step of steps) {
    check(step && typeof step === 'object' && typeof step.id === 'string' && /^[a-z][a-z0-9-]{0,39}$/.test(step.id), 'INVALID_VENTURE_REQUEST', 'Each playbook step needs a short id.');
    if (ids.has(step.id)) refuse(`Two playbook steps share the id ${step.id}.`);
    ids.add(step.id);
    check(STEP_KINDS.includes(step.kind), 'INVALID_VENTURE_REQUEST', `The step ${step.id} has an unknown kind.`);
    check(typeof step.title === 'string' && step.title.trim().length > 0 && step.title.length <= 200, 'INVALID_VENTURE_REQUEST', `The step ${step.id} needs a title.`);
    check(TIER_ORDER.includes(step.tier), 'INVALID_VENTURE_REQUEST', `The step ${step.id} has an unknown tier.`);
    if (TIER_ORDER.indexOf(step.tier) > TIER_ORDER.indexOf(TIER_CEILING) || PLANNED_TIERS.includes(step.tier)) refuse(`The step ${step.id} needs the ${step.tier} tier, which this build does not have.`);
    check(step.model === null || step.model === 'fast' || step.model === 'main', 'INVALID_VENTURE_REQUEST', `The step ${step.id} names an unknown model tier.`);
    if (CODE_ONLY_KINDS.includes(step.kind) && step.model !== null) refuse(`The step ${step.id} is done by code or by you, so it never uses a model.`);
    if (step.kind === 'work' && step.model === null) refuse(`The work step ${step.id} needs an agent.`);
    check(Array.isArray(step.checks) && step.checks.every(id => (CHECK_IDS as readonly string[]).includes(id)), 'INVALID_VENTURE_REQUEST', `The step ${step.id} names an unknown check.`);
    check(Array.isArray(step.requiredSections) && step.requiredSections.every(section => typeof section === 'string' && section.length > 0), 'INVALID_VENTURE_REQUEST', `The step ${step.id} has an unreadable section list.`);
    const tools = step.tools ?? [];
    check(Array.isArray(tools) && tools.every(tool => (TOOL_NAMES as readonly string[]).includes(tool)), 'INVALID_VENTURE_REQUEST', `The step ${step.id} names an unknown tool.`);
    if (tools.length && !AGENT_KINDS.includes(step.kind)) refuse(`The step ${step.id} can't hold tools: only agent steps call tools, and the writing step has them switched off.`);
    for (const tool of tools) {
      const spec = toolSpec(tool)!;
      if (spec.effect === 'outside-write') refuse(`The step ${step.id} holds ${tool}. Outside actions wait for your approval; an agent step never holds them.`);
      if (TIER_ORDER.indexOf(spec.tier) > TIER_ORDER.indexOf(TIER_CEILING)) refuse(`The tool ${tool} needs a tier this build does not have.`);
    }
    check(step.guidance === undefined || (Array.isArray(step.guidance) && step.guidance.length <= 6 && step.guidance.every(line => typeof line === 'string' && line.length <= 200)), 'INVALID_VENTURE_REQUEST', `The step ${step.id} has unreadable guidance.`);
    if (step.kind === 'write' && step.requiredSections.length === 0) refuse(`The writing step ${step.id} needs its required sections.`);
    if (step.kind === 'write' && !step.checks.includes('no-done-claims')) refuse(`The writing step ${step.id} must check that the draft never claims unproven work.`);
    if (step.kind === 'operator' && !approvalSeen) refuse(`The step ${step.id} acts outside Chausar before you approve.`);
    if (step.kind === 'approve') approvalSeen = true;
  }
  // Ink v2 wave 4 (4J12, H23): edges, loop caps, timeouts, gates and the run deadline (delivery/flow.ts).
  validateFlow(steps, extras?.limits);
  if (extras) {
    check(Number.isInteger(extras.limits.maxTurns) && extras.limits.maxTurns >= 1 && extras.limits.maxTurns <= 8
      && Number.isInteger(extras.limits.maxToolCalls) && extras.limits.maxToolCalls >= 1 && extras.limits.maxToolCalls <= 24
      && Number.isInteger(extras.limits.maxCallsPerTurn) && extras.limits.maxCallsPerTurn >= 1 && extras.limits.maxCallsPerTurn <= 6
      && /^\d{1,9}$/.test(extras.limits.maxCostMicros), 'INVALID_VENTURE_REQUEST', 'The playbook limits are out of range.');
  }
  return { hash: playbookHash(steps, extras), validated: true, tierCeiling: TIER_CEILING };
}

/** The playbook the business uses now: the one it points at, else the newest version. */
export function currentPlaybook(state: State, venture: VentureRecord): PlaybookRecord | null {
  const pointed = venture.playbookId ? findRecord(state, 'venture-playbook', venture.playbookId) : undefined;
  return pointed && pointed.ventureId === venture.id ? pointed : latestPlaybook(state, venture.id);
}

/**
 * A playbook is current for a plan when it was built from that exact plan in the harness format, with the same
 * flagship playbook's steps (or none). Going back a version (improve.ts rollback) asks the same of the older one.
 */
export function fits(playbook: PlaybookRecord | null, blueprint: BlueprintRecord, venture: VentureRecord): boolean {
  return !!playbook && playbook.blueprintDigest === blueprint.digest && playbook.format === 2 && (playbook.flagship ?? null) === deliveryFlagship(venture, blueprint);
}

/**
 * The body for a plan: the fixed steps (or the flagship playbook's), then every carried patch that still applies, in
 * order. A patch that no longer applies to the new plan is dropped and reported.
 */
export function buildBody(state: State, venture: VentureRecord, blueprint: BlueprintRecord, patches: readonly PlaybookPatch[]): { body: PlaybookBody; applied: PlaybookPatch[]; dropped: PlaybookPatch[] } {
  const flagship = deliveryFlagship(venture, blueprint);
  let body: PlaybookBody = { steps: playbookSteps(blueprint, flagship), limits: { ...DEFAULT_LIMITS }, aliases: {} };
  const entryIds = dictionaryEntries(state, venture).map(entry => entry.id);
  const applied: PlaybookPatch[] = [], dropped: PlaybookPatch[] = [];
  for (const patch of patches) {
    try { body = applyPatch(body, patch, { serviceType: blueprint.serviceType, entryIds, flagship }); applied.push(patch); } catch { dropped.push(patch); }
  }
  return { body, applied, dropped };
}

/**
 * The steps of a stored playbook that fits its plan, with the tools this build grants its steps added (Ink v2 wave 2:
 * evidence.record on the reading steps, a flagship playbook's own tools), or null when nothing would change. For each
 * stored step whose id the build still makes: an agent step gains each tool the step built now holds that is within
 * the ceiling, that it lacks and that no adopted patch took away from it; a code step the build now runs as an agent
 * step (the CA firm's compute) takes the new step whole, when no adopted patch names it. Nothing is ever removed and
 * guidance is never touched, so an adopted improvement is kept. A result that would not validate is no change.
 */
export function grantTopUp(playbook: Pick<PlaybookRecord, 'steps' | 'patches' | 'limits' | 'aliases'>, blueprint: BlueprintRecord, venture: Pick<VentureRecord, 'idea'>): PlaybookStep[] | null {
  const flagship = deliveryFlagship(venture, blueprint);
  let built: PlaybookStep[];
  try { built = playbookSteps(blueprint, flagship); } catch { return null; }
  const now = new Map(built.map(step => [step.id, step]));
  const ceiling = toolCeiling(blueprint.serviceType, flagship);
  const patches = playbook.patches ?? [];
  const revoked = new Set(patches.filter(patch => patch.op === 'tools.revoke').map(patch => `${patch.stepId}|${patch.value}`));
  let changed = false;
  const steps = playbook.steps.map((step): PlaybookStep => {
    const fresh = now.get(step.id);
    if (!fresh || !AGENT_KINDS.includes(fresh.kind)) return step;
    if (!AGENT_KINDS.includes(step.kind)) {
      if (!CODE_ONLY_KINDS.includes(step.kind) || patches.some(patch => patch.stepId === step.id)) return step;
      changed = true;
      return { ...structuredClone(fresh), tools: (fresh.tools ?? []).filter(tool => ceiling.includes(tool)) };
    }
    const added = (fresh.tools ?? []).filter(tool => ceiling.includes(tool) && !(step.tools ?? []).includes(tool) && !revoked.has(`${step.id}|${tool}`));
    if (!added.length) return step;
    changed = true;
    return { ...step, tools: [...(step.tools ?? []), ...added] };
  });
  if (!changed) return null;
  try { validatePlaybook(steps, { limits: playbook.limits ?? { ...DEFAULT_LIMITS }, aliases: playbook.aliases ?? {} }); } catch { return null; }
  return steps;
}

/**
 * Stores a grant top-up as the next version. It keeps the version's place (its origin, parent and patches), so adopting
 * an improvement and going back from one work as they did; the version it tops up stays stored, unchanged.
 */
function putTopUp(tx: VentureTx, existing: PlaybookRecord, steps: PlaybookStep[]): PlaybookRecord {
  const limits = existing.limits ?? { ...DEFAULT_LIMITS }, aliases = existing.aliases ?? {};
  const { hash, tierCeiling } = validatePlaybook(steps, { limits, aliases });
  const versions = listRecords(tx.state, 'venture-playbook', existing.ventureId).map(record => record.version);
  const record: PlaybookRecord = { ...existing, ...tx.base('venture-playbook'), version: Math.max(0, ...versions) + 1, hash, steps, tierCeiling, limits, aliases };
  tx.put(record);
  tx.touch({ playbookId: record.id });
  tx.emit('playbook-ready', { playbookId: record.id, version: record.version, hash });
  return record;
}

/** The hash a playbook built now for this business would have: the current one when it fits the plan, with any grant top-up. */
export function expectedPlaybookHash(state: State, venture: VentureRecord, blueprint: BlueprintRecord): string {
  const current = currentPlaybook(state, venture);
  if (current && fits(current, blueprint, venture)) {
    const topped = grantTopUp(current, blueprint, venture);
    return topped ? playbookHash(topped, { limits: current.limits ?? { ...DEFAULT_LIMITS }, aliases: current.aliases ?? {} }) : current.hash;
  }
  const { body } = buildBody(state, venture, blueprint, current?.patches ?? []);
  return playbookHash(body.steps, { limits: body.limits, aliases: body.aliases });
}

/**
 * Returns the playbook for the accepted plan, building and storing a new version when the plan changed or the stored
 * one predates the harness. Adopted patches carry over. Runs in its own transaction, never inside another one.
 */
export async function ensurePlaybook(deps: VentureDeps, ctx: Context): Promise<PlaybookRecord> {
  const { state, venture } = readAs(deps, ctx, 'prepare');
  const blueprint = acceptedBlueprint(state, venture);
  const current = currentPlaybook(state, venture);
  if (current && fits(current, blueprint, venture) && !grantTopUp(current, blueprint, venture)) return current;
  return ventureAction(deps, ctx, 'prepare', 'delivery.playbook', tx => {
    const live = tx.venture!;
    const accepted = acceptedBlueprint(tx.state, live);
    const existing = currentPlaybook(tx.state, live);
    if (existing && fits(existing, accepted, live)) {
      // A version stored before this build's step tools: the same steps with the new grants added, as the next version.
      const topped = grantTopUp(existing, accepted, live);
      return topped ? putTopUp(tx, existing, topped) : existing;
    }
    const { body, applied } = buildBody(tx.state, live, accepted, existing?.patches ?? []);
    const { hash, tierCeiling } = validatePlaybook(body.steps, { limits: body.limits, aliases: body.aliases });
    const versions = listRecords(tx.state, 'venture-playbook', live.id).map(record => record.version);
    const flagship = deliveryFlagship(live, accepted);
    const record: PlaybookRecord = {
      ...tx.base('venture-playbook'), version: Math.max(0, ...versions) + 1, hash, blueprintDigest: accepted.digest,
      serviceType: accepted.serviceType, steps: body.steps, validated: true, tierCeiling, format: 2, limits: body.limits, aliases: body.aliases,
      patches: applied, parentId: existing?.id ?? null, origin: 'plan', ...(flagship ? { flagship } : {}),
    };
    tx.put(record);
    tx.touch({ playbookId: record.id });
    tx.emit('playbook-ready', { playbookId: record.id, version: record.version, hash });
    return record;
  });
}

export async function playbookHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<PlaybookRecord> {
  exactPayload(payload, []);
  return ensurePlaybook(deps, ctx);
}

/**
 * Stores a version the owner's own words made (Ink v2 wave 4, 4B1): an accepted "from now on" change, or an undo
 * that rebuilt the playbook without one. The body is validated like every other version; it keeps the version's plan,
 * service type and flagship, is the next version number, names `from` as its parent, and the business points at it.
 * Versions are never overwritten: `from` stays stored as it was. A run already going keeps the version it started on.
 */
export function ownerVersion(tx: VentureTx, from: PlaybookRecord, body: PlaybookBody, patches: readonly PlaybookPatch[], event: { proposalId?: string; undoneFrom?: string } = {}): PlaybookRecord {
  const { hash, tierCeiling } = validatePlaybook(body.steps, { limits: body.limits, aliases: body.aliases });
  const versions = listRecords(tx.state, 'venture-playbook', from.ventureId).map(record => record.version);
  const record: PlaybookRecord = {
    ...from, ...tx.base('venture-playbook'), version: Math.max(0, ...versions) + 1, hash, steps: body.steps, validated: true, tierCeiling, format: 2,
    limits: body.limits, aliases: body.aliases, patches: [...patches], parentId: from.id, origin: 'owner',
  };
  tx.put(record);
  tx.touch({ playbookId: record.id });
  tx.emit('playbook-adopted', { playbookId: record.id, version: record.version, hash, ...event });
  return record;
}

/** The checks a playbook's verify step runs; falls back to the fixed list for an older record. */
export function verifyChecks(playbook: PlaybookRecord): CheckId[] {
  const verify = playbook.steps.find(step => step.kind === 'verify');
  return verify ? [...verify.checks] : [...VERIFY_CHECKS];
}

/** The limits a run uses: the playbook's, or the defaults for an older record. */
export function playbookLimits(playbook: PlaybookRecord): HarnessLimits {
  return playbook.limits ?? { ...DEFAULT_LIMITS };
}

/**
 * How a model draft for an order is laid out, when a flagship playbook says: its drafting step for the order's offer
 * (playbooks/steps.ts), with that step's headings and guidance, then the lines code makes for this order (a content
 * calendar's slots, from intake). Null for the eight fixed steps, whose draft keeps the service type's headings (or
 * the report headings once tools proved work) and the writing step's guidance.
 */
export function flagshipDraft(playbook: Pick<PlaybookRecord, 'flagship' | 'steps'>, offerKey: string | null | undefined, intake: OrderIntake | null = null): { stepId: string; sections: string[]; guidance: string[] } | null {
  const own = flagshipDelivery(playbook.flagship);
  if (!own) return null;
  const id = own.draftStep(offerKey);
  const step = playbook.steps.find(item => item.id === id && item.kind === 'write') ?? playbook.steps.find(item => item.kind === 'write');
  return step && step.requiredSections.length ? { stepId: step.id, sections: [...step.requiredSections], guidance: [...(step.guidance ?? []), ...own.orderGuidance(offerKey, intake)] } : null;
}
