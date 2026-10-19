// Chausar venture launcher, delivery package (P5): the playbook a delivery agent follows.
// Steps are fixed by code; the only words taken from the plan are the work and drafting steps' titles. Agent steps
// name the tools they may call (deny by default) and hold guidance the improvement loop can change with typed
// patches. Playbook versions are never overwritten: every change is a new version, and the business points at one.
import { check, type Context, type State } from '../../contracts.ts';
import { digest, exactPayload, findRecord, listRecords, ventureAction } from '../records.ts';
import { CHECK_IDS, REQUIRED_SECTIONS, TOOL_NAMES } from '../contracts.ts';
import type {
  BlueprintRecord, CheckId, ExecutionTier, HarnessLimits, PlaybookPatch, PlaybookRecord, PlaybookStep, StepKind, ToolName, VentureDeps,
  VentureRecord,
} from '../contracts.ts';
import { dictionaryEntries } from './harness/dictionary.ts';
import { DEFAULT_LIMITS } from './harness/loop.ts';
import { applyPatch, toolCeiling, type PlaybookBody } from './harness/patches.ts';
import { toolSpec } from './harness/tools.ts';
import { acceptedBlueprint, latestPlaybook, readAs } from './shared.ts';

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

/** Checks the verify step runs on every draft reply: all of them except the ones that only make sense in a rehearsal. */
export const VERIFY_CHECKS: readonly CheckId[] = CHECK_IDS.filter(id => id !== 'questions-raised' && id !== 'turn-limit');
export const DRAFT_CHECKS: readonly CheckId[] = ['no-numeric-prose', 'figures-resolve', 'required-sections', 'house-style', 'length-bounds', 'no-done-claims'];
const READ_TOOLS: readonly ToolName[] = ['files.list', 'files.read', 'dictionary.browse', 'dictionary.resolve', 'handoff.client', 'handoff.owner'];
const WORK_TOOLS: readonly ToolName[] = ['files.read', 'calc.sum', 'calc.totals', 'books.reconcile', 'bills.pick', 'sandbox.transform', 'sandbox.python', 'handoff.client', 'handoff.owner', 'agent.delegate'];

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

/** The eight fixed steps for an accepted plan. */
export function playbookSteps(blueprint: BlueprintRecord): PlaybookStep[] {
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

/** A playbook is current for a plan when it was built from that exact plan in the harness format. */
function fits(playbook: PlaybookRecord | null, blueprint: BlueprintRecord): boolean {
  return !!playbook && playbook.blueprintDigest === blueprint.digest && playbook.format === 2;
}

/**
 * The body for a plan: the fixed steps, then every carried patch that still applies, in order. A patch that no
 * longer applies to the new plan is dropped and reported.
 */
export function buildBody(state: State, venture: VentureRecord, blueprint: BlueprintRecord, patches: readonly PlaybookPatch[]): { body: PlaybookBody; applied: PlaybookPatch[]; dropped: PlaybookPatch[] } {
  let body: PlaybookBody = { steps: playbookSteps(blueprint), limits: { ...DEFAULT_LIMITS }, aliases: {} };
  const entryIds = dictionaryEntries(state, venture).map(entry => entry.id);
  const applied: PlaybookPatch[] = [], dropped: PlaybookPatch[] = [];
  for (const patch of patches) {
    try { body = applyPatch(body, patch, { serviceType: blueprint.serviceType, entryIds }); applied.push(patch); } catch { dropped.push(patch); }
  }
  return { body, applied, dropped };
}

/** The hash a playbook built now for this business would have: the current one when it fits the plan. */
export function expectedPlaybookHash(state: State, venture: VentureRecord, blueprint: BlueprintRecord): string {
  const current = currentPlaybook(state, venture);
  if (current && fits(current, blueprint)) return current.hash;
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
  if (current && fits(current, blueprint)) return current;
  return ventureAction(deps, ctx, 'prepare', 'delivery.playbook', tx => {
    const live = tx.venture!;
    const accepted = acceptedBlueprint(tx.state, live);
    const existing = currentPlaybook(tx.state, live);
    if (existing && fits(existing, accepted)) return existing;
    const { body, applied } = buildBody(tx.state, live, accepted, existing?.patches ?? []);
    const { hash, tierCeiling } = validatePlaybook(body.steps, { limits: body.limits, aliases: body.aliases });
    const versions = listRecords(tx.state, 'venture-playbook', live.id).map(record => record.version);
    const record: PlaybookRecord = {
      ...tx.base('venture-playbook'), version: Math.max(0, ...versions) + 1, hash, blueprintDigest: accepted.digest,
      serviceType: accepted.serviceType, steps: body.steps, validated: true, tierCeiling, format: 2, limits: body.limits, aliases: body.aliases,
      patches: applied, parentId: existing?.id ?? null, origin: 'plan',
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

/** The checks a playbook's verify step runs; falls back to the fixed list for an older record. */
export function verifyChecks(playbook: PlaybookRecord): CheckId[] {
  const verify = playbook.steps.find(step => step.kind === 'verify');
  return verify ? [...verify.checks] : [...VERIFY_CHECKS];
}

/** The limits a run uses: the playbook's, or the defaults for an older record. */
export function playbookLimits(playbook: PlaybookRecord): HarnessLimits {
  return playbook.limits ?? { ...DEFAULT_LIMITS };
}
