// Chausar venture launcher, agents (Ink v2 wave 4, package 4B1, catalogue A3 and A4): the owner's changes in use and
// going back from one. The owner's accepted "from now on" changes are owner patches in the playbook in use; an agent's
// standing orders are its owner guidance lines still in use on its steps, each with the version it arrived in and the
// owner's words. Undo points the business back at the version the change was made from (which stays stored), or, when
// later changes sit on top, builds a new version from the plan without that change so the later ones stay.
import { check, type Context, type State } from '../../contracts.ts';
import type { AgentVersionUndo, PlaybookPatch, PlaybookRecord, StandingOrdersView, StandingOrderView, StandingUndoView, VentureDeps, VentureRecord } from '../contracts.ts';
import { digest, exactPayload, findRecord, identifier, listRecords, requireAppChannel, ventureAction } from '../records.ts';
import { buildBody, currentPlaybook, ensurePlaybook, fits, grantTopUp, ownerVersion } from '../delivery/playbook.ts';
import { describePatch } from '../delivery/harness/patches.ts';
import { acceptedBlueprint, acceptedBlueprintOrNull, readAs } from '../delivery/shared.ts';
import { chatAgent, roleOfStep, type ChatAgent } from './roles.ts';

/** The agent an owner patch belongs to: the agent of the message it came from, else the role that does its step. */
export function patchAgent(state: State, agent: Pick<ChatAgent, 'flagship'>, patch: PlaybookPatch): string | null {
  const message = patch.source ? findRecord(state, 'venture-agent-message', patch.source.messageId) : undefined;
  return message?.agent ?? roleOfStep(agent.flagship, patch.stepId);
}

/** This agent's owner patches in a playbook, oldest first. */
export function ownerPatchesOf(state: State, agent: Pick<ChatAgent, 'id' | 'flagship'>, playbook: PlaybookRecord | null): PlaybookPatch[] {
  return (playbook?.patches ?? []).filter(patch => patch.proposedBy === 'owner' && patchAgent(state, agent, patch) === agent.id);
}

/** The guidance lines the owner added to this agent's steps and that are still in use: the only lines chat may remove. */
export function ownerLines(state: State, agent: Pick<ChatAgent, 'id' | 'flagship'>, playbook: PlaybookRecord | null): string[] {
  const steps = new Map((playbook?.steps ?? []).map(step => [step.id, step.guidance ?? []]));
  return ownerPatchesOf(state, agent, playbook).filter(patch => patch.op === 'guidance.add' && (steps.get(patch.stepId) ?? []).includes(patch.value)).map(patch => patch.value);
}

/** The first version of this business that carried a patch: where it arrived (a rebuild for a new plan keeps its id). */
function arrivedIn(state: State, venture: VentureRecord, patchId: string): PlaybookRecord | null {
  let first: PlaybookRecord | null = null;
  for (const record of listRecords(state, 'venture-playbook', venture.id)) {
    if ((record.patches ?? []).some(patch => patch.id === patchId) && (!first || record.version < first.version)) first = record;
  }
  return first;
}

/**
 * The agent's standing orders: each owner guidance line in use on its steps (added from chat and not taken away since),
 * with the step, the version it arrived in, the owner's words and when.
 */
export function standingOrders(state: State, venture: VentureRecord, agent: ChatAgent): StandingOrderView[] {
  const playbook = agent.playbook;
  if (!playbook) return [];
  const steps = new Map(playbook.steps.map(step => [step.id, step]));
  const orders: StandingOrderView[] = [];
  for (const patch of ownerPatchesOf(state, agent, playbook)) {
    const step = steps.get(patch.stepId);
    if (patch.op !== 'guidance.add' || !step || !(step.guidance ?? []).includes(patch.value) || !agent.stepIds.includes(step.id)) continue;
    if (orders.some(order => order.stepId === step.id && order.text === patch.value)) continue;
    const arrived = arrivedIn(state, venture, patch.id) ?? playbook;
    orders.push({ stepId: step.id, step: step.title, text: patch.value, since: arrived.version, quote: patch.source?.quote ?? '', at: arrived.at });
  }
  return orders;
}

/**
 * What Undo would do now, read without writing, as versionUndoHandler decides it: point back at the version the
 * agent's last owner change was made from, rebuild from the plan without that change, or nothing (no change in use).
 */
function undoPlan(state: State, venture: VentureRecord, agent: ChatAgent): StandingUndoView | null {
  const current = agent.playbook;
  const changes = ownerPatchesOf(state, agent, current);
  if (!current || !changes.length) return null;
  const change = changes.at(-1)!;
  const rest = (current.patches ?? []).filter(patch => patch.id !== change.id);
  const blueprint = acceptedBlueprintOrNull(state, venture);
  const parent = current.parentId ? findRecord(state, 'venture-playbook', current.parentId) : undefined;
  if (blueprint && current.origin === 'owner' && current.patches?.at(-1)?.id === change.id && parent && fits(parent, blueprint, venture)
    && digest(parent.patches ?? []) === digest(rest) && grantTopUp(parent, blueprint, venture) === null) {
    return { kind: 'back', version: parent.version };
  }
  return { kind: 'rebuild' };
}

/**
 * venture.agents.orders.list { agent } (read): the agent's standing orders, from the playbook in use, and what the
 * agent panel shows beside them (4B3), all read without writing (currentPlaybook, never ensurePlaybook): the version
 * in use, whether the next run or change rebuilds it first (the plan changed, or this build grants more tools), the
 * agent's own steps with their guidance and check ids, and what Undo would do.
 */
export async function ordersListHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<StandingOrdersView> {
  const body = exactPayload(payload, ['agent'], ['agent']);
  const agentId = identifier(body.agent, 'Agent');
  const { state, venture } = readAs(deps, ctx, 'read');
  const agent = chatAgent(state, venture, agentId);
  const current = agent.playbook;
  const blueprint = acceptedBlueprintOrNull(state, venture);
  const rebuildDue = !!blueprint && (!current || !fits(current, blueprint, venture) || grantTopUp(current, blueprint, venture) !== null);
  return {
    orders: standingOrders(state, venture, agent),
    playbook: current ? { id: current.id, version: current.version, hash: current.hash, origin: current.origin ?? 'plan', at: current.at } : null,
    rebuildDue,
    steps: agent.steps.map(step => ({ stepId: step.id, title: step.title, guidance: [...(step.guidance ?? [])], checks: [...step.checks] })),
    undo: undoPlan(state, venture, agent),
  };
}

/**
 * venture.agents.version.undo { agent, digest } (approve, app only): goes back from the agent's latest owner change in
 * use. digest: the hash of the version in use as the owner saw it (APPROVAL_STALE otherwise). When that version came
 * from this change, the business points back at the version it was made from, which stays stored; when later changes
 * sit on top, or the older version lacks tool grants this build gives, a new version is built from the plan with every
 * change but this one, so the later ones and the grants stay. Refused with UNDO_NOTHING when the agent has no change
 * from the owner in use, and with UNDO_CONFLICT naming a later change that would no longer apply without this one. The
 * playbook a changed plan makes is built first (ensurePlaybook), so a version read before the plan changed is stale.
 */
export async function versionUndoHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<AgentVersionUndo> {
  requireAppChannel(ctx, 'venture.agents.version.undo');
  const body = exactPayload(payload, ['agent', 'digest'], ['agent', 'digest']);
  const agentId = identifier(body.agent, 'Agent');
  check(typeof body.digest === 'string' && /^[a-f0-9]{64}$/.test(body.digest), 'INVALID_VENTURE_REQUEST', 'Send the digest of the version you saw in use.');
  const seen = body.digest;
  const { state, venture: open } = readAs(deps, ctx, 'approve');
  chatAgent(state, open, agentId);
  await ensurePlaybook(deps, ctx);
  return ventureAction(deps, ctx, 'approve', 'agents.version.undo', tx => {
    const venture = tx.venture!;
    const agent = chatAgent(tx.state, venture, agentId);
    const current = currentPlaybook(tx.state, venture);
    const changes = ownerPatchesOf(tx.state, agent, current);
    check(current && changes.length, 'UNDO_NOTHING', `${agent.name} has no change from you in use, so there is nothing to undo.`);
    check(current.hash === seen, 'APPROVAL_STALE', 'The version in use changed since you read it. Read it again.');
    const change = changes.at(-1)!;
    const rest = (current.patches ?? []).filter(patch => patch.id !== change.id);
    const blueprint = acceptedBlueprint(tx.state, venture);
    const parent = current.parentId ? tx.find('venture-playbook', current.parentId) : undefined;
    // This version is the change itself: go back to the version it was made from, as W2's rollback does, unless that
    // version lacks tool grants this build gives (a top-up came after the change), which a rebuild keeps.
    if (current.origin === 'owner' && current.patches?.at(-1)?.id === change.id && parent && fits(parent, blueprint, venture)
      && digest(parent.patches ?? []) === digest(rest) && grantTopUp(parent, blueprint, venture) === null) {
      tx.touch({ playbookId: parent.id });
      tx.emit('playbook-adopted', { playbookId: parent.id, version: parent.version, hash: parent.hash, rolledBack: true, fromPlaybookId: current.id });
      return { playbookId: parent.id, version: parent.version, line: `Back to version ${parent.version}. Version ${current.version} stays stored.` };
    }
    // Rebuild from the plan without this one, and refuse if a later change needed it.
    const rebuilt = buildBody(tx.state, venture, blueprint, rest);
    const lost = rebuilt.dropped[0];
    check(!lost, 'UNDO_CONFLICT', lost ? `Undoing this would also undo a later change that needs it: ${describePatch(lost, current.steps)} Undo that one first.` : '');
    const record = ownerVersion(tx, current, rebuilt.body, rebuilt.applied, { undoneFrom: current.id });
    const later = (current.patches ?? []).findIndex(patch => patch.id === change.id) < (current.patches ?? []).length - 1;
    return { playbookId: record.id, version: record.version, line: `Version ${record.version} is in use without that change.${later ? ' Your later changes stay.' : ''}` };
  });
}
