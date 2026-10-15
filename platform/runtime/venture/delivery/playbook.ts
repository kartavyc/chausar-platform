// Chausar venture launcher, delivery package (P5): the playbook a delivery agent follows.
// Steps are fixed by code. The only words taken from the plan are the drafting step's title.
// In this build the gather, clarify and draft steps run as one model call over the client's message only.
import { check, type Context } from '../../contracts.ts';
import { digest, exactPayload, ventureAction } from '../records.ts';
import { CHECK_IDS, REQUIRED_SECTIONS } from '../contracts.ts';
import type {
  BlueprintRecord, CheckId, ExecutionTier, PlaybookRecord, PlaybookStep, StepKind, VentureDeps,
} from '../contracts.ts';
import { acceptedBlueprint, latestPlaybook, readAs } from './shared.ts';

const STEP_KINDS: readonly StepKind[] = ['gather', 'question', 'compute', 'write', 'verify', 'approve', 'operator'];
const TIER_ORDER: readonly ExecutionTier[] = ['code', 'actor', 'wasm-lite', 'wasm', 'container', 'hosted'];
/** The highest tier this build can run. Sandboxes are planned. */
export const TIER_CEILING: ExecutionTier = 'actor';
const CODE_ONLY_KINDS: readonly StepKind[] = ['compute', 'verify', 'approve', 'operator'];

/** Checks the verify step runs on every draft reply: all of them except the ones that only make sense in a rehearsal. */
export const VERIFY_CHECKS: readonly CheckId[] = CHECK_IDS.filter(id => id !== 'questions-raised' && id !== 'turn-limit');
export const DRAFT_CHECKS: readonly CheckId[] = ['no-numeric-prose', 'figures-resolve', 'required-sections', 'house-style', 'length-bounds', 'no-done-claims'];

/** The seven fixed steps for an accepted plan. */
export function playbookSteps(blueprint: BlueprintRecord): PlaybookStep[] {
  const drafting = blueprint.deliverySteps.find(step => step.id === 'step_3');
  check(drafting, 'INVALID_VENTURE_REQUEST', 'The plan has no drafting step.');
  return [
    { id: 'gather', kind: 'gather', title: "Read the client's message and pull out what is needed", tier: 'actor', model: 'fast', doneBy: 'agent', requiredSections: [], checks: [] },
    { id: 'clarify', kind: 'question', title: 'Decide what is still unclear', tier: 'actor', model: 'fast', doneBy: 'agent', requiredSections: [], checks: ['questions-raised'] },
    { id: 'price', kind: 'compute', title: 'Take prices from the calculator', tier: 'code', model: null, doneBy: 'agent', requiredSections: [], checks: ['figures-resolve'] },
    { id: 'draft', kind: 'write', title: drafting.title.value, tier: 'actor', model: 'main', doneBy: 'agent', requiredSections: [...REQUIRED_SECTIONS[blueprint.serviceType]], checks: [...DRAFT_CHECKS] },
    { id: 'verify', kind: 'verify', title: 'Check the draft', tier: 'code', model: null, doneBy: 'agent', requiredSections: [], checks: [...VERIFY_CHECKS] },
    { id: 'approve', kind: 'approve', title: 'You review the draft', tier: 'code', model: null, doneBy: 'you', requiredSections: [], checks: [] },
    { id: 'send', kind: 'operator', title: 'Send it to the client (you copy it for now)', tier: 'code', model: null, doneBy: 'you', requiredSections: [], checks: ['no-outside-writes'] },
  ];
}

const refuse = (message: string) => check(false, 'INVALID_VENTURE_REQUEST', message);

/**
 * Only validated playbooks run. Refuses duplicate ids, a code, approval or operator step with a model, a tier above
 * the ceiling, a write step without required sections or without the done-claim check, and an operator step that
 * comes before an approval step.
 */
export function validatePlaybook(steps: PlaybookStep[]): { hash: string; validated: true; tierCeiling: ExecutionTier } {
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
    if (TIER_ORDER.indexOf(step.tier) > TIER_ORDER.indexOf(TIER_CEILING)) refuse(`The step ${step.id} needs the ${step.tier} tier, which this build does not have.`);
    check(step.model === null || step.model === 'fast' || step.model === 'main', 'INVALID_VENTURE_REQUEST', `The step ${step.id} names an unknown model tier.`);
    if (CODE_ONLY_KINDS.includes(step.kind) && step.model !== null) refuse(`The step ${step.id} is done by code or by you, so it never uses a model.`);
    check(Array.isArray(step.checks) && step.checks.every(id => (CHECK_IDS as readonly string[]).includes(id)), 'INVALID_VENTURE_REQUEST', `The step ${step.id} names an unknown check.`);
    check(Array.isArray(step.requiredSections) && step.requiredSections.every(section => typeof section === 'string' && section.length > 0), 'INVALID_VENTURE_REQUEST', `The step ${step.id} has an unreadable section list.`);
    if (step.kind === 'write' && step.requiredSections.length === 0) refuse(`The writing step ${step.id} needs its required sections.`);
    if (step.kind === 'write' && !step.checks.includes('no-done-claims')) refuse(`The writing step ${step.id} must check that the draft never claims finished work.`);
    if (step.kind === 'operator' && !approvalSeen) refuse(`The step ${step.id} acts outside Chausar before you approve.`);
    if (step.kind === 'approve') approvalSeen = true;
  }
  return { hash: digest(steps), validated: true, tierCeiling: TIER_CEILING };
}

/**
 * Returns the playbook for the accepted plan, building and storing a new version when the plan changed.
 * Runs in its own transaction, never inside another one.
 */
export async function ensurePlaybook(deps: VentureDeps, ctx: Context): Promise<PlaybookRecord> {
  const { state, venture } = readAs(deps, ctx, 'prepare');
  const blueprint = acceptedBlueprint(state, venture);
  const latest = latestPlaybook(state, venture.id);
  if (latest && latest.blueprintDigest === blueprint.digest) return latest;
  return ventureAction(deps, ctx, 'prepare', 'delivery.playbook', tx => {
    const current = tx.venture!;
    const accepted = acceptedBlueprint(tx.state, current);
    const existing = latestPlaybook(tx.state, current.id);
    if (existing && existing.blueprintDigest === accepted.digest) return existing;
    const steps = playbookSteps(accepted);
    const { hash, tierCeiling } = validatePlaybook(steps);
    const record: PlaybookRecord = {
      ...tx.base('venture-playbook'), version: (existing?.version ?? 0) + 1, hash, blueprintDigest: accepted.digest,
      serviceType: accepted.serviceType, steps, validated: true, tierCeiling,
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
