// Versions of the owner's instruction changes (Ink v2 wave 4, package 4B1, catalogue A3 and A4, spec 5.2 and 8):
// accepting a "from now on" proposal writes a new playbook version (versions are never overwritten) and points the
// business at it; a run already going keeps its version; a proposal drafted against an older version is stale; undo
// points back at the parent, or rebuilds without that change so later changes stay; a plan change carries the owner's
// changes; and the agent's standing orders are the owner's guidance in use on its steps.
import test from 'node:test';
import assert from 'node:assert/strict';
import { digest, findRecord, listRecords, ventureAction } from '../runtime/venture/records.ts';
import { code, owner, phone } from './venture-judge-helpers.ts';
import { agentBusiness, consent, episodeOrder, playbookIdOf, scriptChat, type AgentEnv } from './venture-agent-helpers.ts';

const CAPTIONS = 'Always add burned-in captions to shorts.';
const PINNED = 'Always add a pinned comment that asks one question.';

/** The owner asks one agent for a standing change; the model drafts exactly the line given. Returns the proposal view. */
async function propose(env: AgentEnv, agent: string, stepId: string, value: string, words = `From now on, ${value.charAt(0).toLowerCase()}${value.slice(1)}`) {
  scriptChat(env, { patch: () => ({ stepId, op: 'guidance.add', value }) });
  const sent = await env.agents('venture.agents.thread.send', { agent, text: words });
  const item = sent.added.find((entry: any) => entry.type === 'proposal');
  assert.ok(item, JSON.stringify(sent.added));
  return item.proposal;
}
const accept = (env: AgentEnv, proposal: { id: string; digest: string }) => env.agents('venture.agents.proposal.decide', { id: proposal.id, digest: proposal.digest, decision: 'accept' });

async function ready() {
  const env = await agentBusiness();
  await consent(env);
  const first = await env.call('venture.delivery.playbook');
  return { env, first };
}

test('accept: a new version from the owner\'s words, the old one kept, the business pointed at it', async () => {
  const { env, first } = await ready();
  const proposal = await propose(env, 'story-editor', 'find', CAPTIONS);
  assert.equal(proposal.fromVersion, first.version);
  assert.equal(proposal.toVersion, first.version + 1);
  const before = structuredClone(findRecord(env.store.read(), 'venture-playbook', first.id));
  await assert.rejects(env.agents('venture.agents.proposal.decide', { id: proposal.id, digest: proposal.digest, decision: 'accept' }, phone), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(env.agents('venture.agents.proposal.decide', { id: proposal.id, digest: 'e'.repeat(64), decision: 'accept' }), code('APPROVAL_STALE'));

  const decided = await accept(env, proposal);
  assert.equal(decided.proposal.status, 'accepted');
  assert.equal(decided.playbook.version, first.version + 1);
  assert.equal(decided.line, `Version ${first.version + 1} is in use now. You can undo it.`);
  const made = findRecord(env.store.read(), 'venture-playbook', decided.playbook.id)!;
  assert.equal(made.origin, 'owner');
  assert.equal(made.parentId, first.id);
  assert.deepEqual(made.patches!.map(patch => patch.value), [...(first.patches ?? []).map((patch: any) => patch.value), CAPTIONS]);
  assert.deepEqual(made.steps.find(step => step.id === 'find')!.guidance, [CAPTIONS]);
  assert.equal(made.validated, true);
  assert.equal(playbookIdOf(env), made.id);
  assert.deepEqual(findRecord(env.store.read(), 'venture-playbook', first.id), before, 'versions are never overwritten');
  const adopted = listRecords(env.store.read(), 'venture-event').filter(event => event.name === 'playbook-adopted').at(-1)!;
  assert.deepEqual(adopted.data, { playbookId: made.id, version: made.version, hash: made.hash, proposalId: proposal.id });
  assert.equal((await env.call('venture.delivery.playbook')).id, made.id, 'runs use the owner\'s version');

  await assert.rejects(accept(env, proposal), code('PROPOSAL_DECIDED'));
  const orders = await env.agents('venture.agents.orders.list', { agent: 'story-editor' });
  assert.deepEqual(orders.orders.map((order: any) => [order.stepId, order.text, order.since, order.quote]), [['find', CAPTIONS, made.version, `From now on, ${CAPTIONS.charAt(0).toLowerCase()}${CAPTIONS.slice(1)}`]]);
  assert.match(orders.orders[0].step, /Write the hooks/);
  assert.deepEqual((await env.agents('venture.agents.orders.list', { agent: 'packager' })).orders, [], 'standing orders are per agent');
});

test('reject: the decision is stored and nothing changes', async () => {
  const { env, first } = await ready();
  const proposal = await propose(env, 'story-editor', 'find', CAPTIONS);
  const decided = await env.agents('venture.agents.proposal.decide', { id: proposal.id, digest: proposal.digest, decision: 'reject' });
  assert.equal(decided.proposal.status, 'rejected');
  assert.equal(decided.playbook, undefined);
  assert.equal(playbookIdOf(env), first.id);
  assert.equal(listRecords(env.store.read(), 'venture-playbook').length, 1);
  await assert.rejects(env.agents('venture.agents.proposal.decide', { id: proposal.id, digest: proposal.digest, decision: 'accept' }), code('PROPOSAL_DECIDED'));
});

test('a run already going keeps its version, and the thread says so (spec 8)', async () => {
  const { env, first } = await ready();
  const order = await episodeOrder(env);
  const run = await env.call('venture.delivery.run', { orderId: order.id });
  assert.equal(run.status, 'waiting-for-you');
  const proposal = await propose(env, 'packager', 'package', PINNED);
  const decided = await accept(env, proposal);
  assert.equal(decided.line, `Version ${first.version + 1} is in use from the next run. Run 1 keeps version ${first.version}.`);
  assert.equal(findRecord(env.store.read(), 'venture-delivery-run', run.id)!.playbookId, first.id);
  const thread = await env.agents('venture.agents.thread.list', { agent: 'packager' });
  const said = thread.items.filter((item: any) => item.type === 'message').map((item: any) => item.message.parts[0].text);
  assert.ok(said.includes(decided.line), 'the thread keeps the line');
});

test('a proposal drafted against an older version is stale: the thread says so and it cannot be decided (spec 8)', async () => {
  const { env, first } = await ready();
  const older = await propose(env, 'story-editor', 'find', CAPTIONS);
  const other = await propose(env, 'packager', 'package', PINNED);
  await accept(env, other);
  const thread = await env.agents('venture.agents.thread.list', { agent: 'story-editor' });
  const view = thread.items.find((item: any) => item.type === 'proposal' && item.proposal.id === older.id).proposal;
  assert.equal(view.status, 'stale');
  const line = `This was drafted against version ${first.version}; version ${first.version + 1} is in use now. Ask again and I will redraft it.`;
  assert.equal(view.line, line);
  await assert.rejects(accept(env, older), (error: any) => { assert.equal(error.code, 'PROPOSAL_STALE'); assert.equal(error.message, line); return true; });
  assert.equal(findRecord(env.store.read(), 'venture-agent-proposal', older.id)!.status, 'drafted');
});

test('undo: the business points back at the version the change was made from, which stays stored', async () => {
  const { env, first } = await ready();
  await assert.rejects(env.agents('venture.agents.version.undo', { agent: 'story-editor', digest: first.hash }), code('UNDO_NOTHING'));
  const decided = await accept(env, await propose(env, 'story-editor', 'find', CAPTIONS));
  const made = findRecord(env.store.read(), 'venture-playbook', decided.playbook.id)!;
  await assert.rejects(env.agents('venture.agents.version.undo', { agent: 'story-editor', digest: made.hash }, phone), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(env.agents('venture.agents.version.undo', { agent: 'story-editor', digest: first.hash }), code('APPROVAL_STALE'));
  await assert.rejects(env.agents('venture.agents.version.undo', { agent: 'packager', digest: made.hash }), code('UNDO_NOTHING'));
  const stored = structuredClone(made);

  const undone = await env.agents('venture.agents.version.undo', { agent: 'story-editor', digest: made.hash });
  assert.deepEqual(undone, { playbookId: first.id, version: first.version, line: `Back to version ${first.version}. Version ${made.version} stays stored.` });
  assert.equal(playbookIdOf(env), first.id);
  assert.deepEqual(findRecord(env.store.read(), 'venture-playbook', made.id), stored);
  assert.deepEqual((await env.agents('venture.agents.orders.list', { agent: 'story-editor' })).orders, []);
  await assert.rejects(env.agents('venture.agents.version.undo', { agent: 'story-editor', digest: first.hash }), code('UNDO_NOTHING'));
});

test('undo with a later change on top: a new version without that change, and the later change stays', async () => {
  const { env, first } = await ready();
  await accept(env, await propose(env, 'story-editor', 'find', CAPTIONS));
  const later = await accept(env, await propose(env, 'packager', 'package', PINNED));
  const top = findRecord(env.store.read(), 'venture-playbook', later.playbook.id)!;
  const undone = await env.agents('venture.agents.version.undo', { agent: 'story-editor', digest: top.hash });
  assert.equal(undone.version, top.version + 1);
  assert.equal(undone.line, `Version ${top.version + 1} is in use without that change. Your later changes stay.`);
  const rebuilt = findRecord(env.store.read(), 'venture-playbook', undone.playbookId)!;
  assert.equal(rebuilt.origin, 'owner');
  assert.equal(rebuilt.parentId, top.id);
  assert.deepEqual(rebuilt.patches!.map(patch => patch.value), [PINNED]);
  assert.deepEqual(rebuilt.steps.find(step => step.id === 'find')!.guidance, []);
  assert.ok(rebuilt.steps.find(step => step.id === 'package')!.guidance!.includes(PINNED));
  assert.equal(playbookIdOf(env), rebuilt.id);
  assert.deepEqual((await env.agents('venture.agents.orders.list', { agent: 'story-editor' })).orders, []);
  assert.equal((await env.agents('venture.agents.orders.list', { agent: 'packager' })).orders.length, 1);
  assert.ok(first.version < top.version);
});

test('undo refuses when a later change would no longer apply, naming it', async () => {
  const { env } = await ready();
  const decided = await accept(env, await propose(env, 'story-editor', 'find', CAPTIONS));
  // The improvement loop later took the owner's line away again: undoing the owner's line would leave that change nothing to remove.
  const improved = await ventureAction(env.deps, owner, 'approve', 'seed.improvement', tx => {
    const current = tx.find('venture-playbook', decided.playbook.id)!;
    const patch = { id: 'patch_model', level: 'harness' as const, op: 'guidance.remove' as const, stepId: 'find', value: CAPTIONS, proposedBy: 'model' as const, parentHash: current.hash, note: { hypothesis: 'Shorter.', expectedFixes: [], likelyRegressions: [] } };
    const steps = current.steps.map(step => step.id === 'find' ? { ...step, guidance: [] } : step);
    const record = tx.put({ ...current, ...tx.base('venture-playbook'), version: current.version + 1, steps, hash: digest({ steps, limits: current.limits, aliases: current.aliases }), patches: [...current.patches!, patch], parentId: current.id, origin: 'improvement' as const });
    tx.touch({ playbookId: record.id });
    return record;
  });
  await assert.rejects(env.agents('venture.agents.version.undo', { agent: 'story-editor', digest: improved.hash }), (error: any) => {
    assert.equal(error.code, 'UNDO_CONFLICT');
    assert.match(error.message, /Removes from "Write the hooks, or pick the moments by transcript segment": Always add burned-in captions to shorts\./);
    return true;
  });
  assert.equal(playbookIdOf(env), improved.id, 'nothing changed');
});

test('a plan change rebuilds the playbook with the owner\'s changes, and they still show as standing orders', async () => {
  const { env } = await ready();
  const decided = await accept(env, await propose(env, 'story-editor', 'find', CAPTIONS));
  await ventureAction(env.deps, owner, 'admin', 'seed.plan-change', tx => {
    const plan = tx.list('venture-blueprint').find(item => item.id === tx.venture!.acceptedBlueprintId)!;
    const changed = tx.put({ ...plan, ...tx.base('venture-blueprint'), version: plan.version + 1, digest: digest({ changedFrom: plan.digest }) });
    tx.touch({ acceptedBlueprintId: changed.id, blueprintId: changed.id });
  });
  const rebuilt = await env.call('venture.delivery.playbook');
  assert.notEqual(rebuilt.id, decided.playbook.id);
  assert.equal(rebuilt.origin, 'plan');
  assert.deepEqual(rebuilt.steps.find((step: any) => step.id === 'find').guidance, [CAPTIONS]);
  const orders = await env.agents('venture.agents.orders.list', { agent: 'story-editor' });
  assert.deepEqual(orders.orders.map((order: any) => [order.text, order.since]), [[CAPTIONS, decided.playbook.version]]);
});

test('orders.list: unknown agents and Keeper are refused', async () => {
  const { env } = await ready();
  await assert.rejects(env.agents('venture.agents.orders.list', { agent: 'nobody' }), code('AGENT_NOT_FOUND'));
  await assert.rejects(env.agents('venture.agents.orders.list', { agent: 'keeper' }), code('AGENT_IS_CODE'));
  await assert.rejects(env.agents('venture.agents.orders.list', {}), code('INVALID_VENTURE_REQUEST'));
});

// ---------------------------------------------------------------------------
// Review fixes (S7 and the top-up nit)
// ---------------------------------------------------------------------------

test('undo reads the playbook a changed plan makes first, so the version it makes fits the plan in use (S7)', async () => {
  const { env } = await ready();
  const decided = await accept(env, await propose(env, 'story-editor', 'find', CAPTIONS));
  const seen = findRecord(env.store.read(), 'venture-playbook', decided.playbook.id)!;
  const plan = await ventureAction(env.deps, owner, 'admin', 'seed.plan-change', tx => {
    const accepted = tx.list('venture-blueprint').find(item => item.id === tx.venture!.acceptedBlueprintId)!;
    const changed = tx.put({ ...accepted, ...tx.base('venture-blueprint'), version: accepted.version + 1, digest: digest({ changedFrom: accepted.digest }) });
    tx.touch({ acceptedBlueprintId: changed.id, blueprintId: changed.id });
    return changed;
  });
  // The plan's rebuild has the same steps, so the version the owner saw is still the one in use by its hash.
  const undone = await env.agents('venture.agents.version.undo', { agent: 'story-editor', digest: seen.hash });
  const after = findRecord(env.store.read(), 'venture-playbook', undone.playbookId)!;
  assert.deepEqual(after.steps.find(step => step.id === 'find')!.guidance, []);
  assert.equal(after.blueprintDigest, plan.digest, 'the version undo makes fits the plan in use');
  assert.equal((await env.call('venture.delivery.playbook')).id, after.id, 'no rebuild is needed after the undo');
  assert.deepEqual((await env.agents('venture.agents.orders.list', { agent: 'story-editor' })).orders, []);
});

test('undo of an owner version this build topped up with new tool grants keeps the grants (nit)', async () => {
  const { env, first } = await ready();
  const decided = await accept(env, await propose(env, 'story-editor', 'find', CAPTIONS));
  // Both versions as an older build stored them, without a tool this build grants: the next read tops the owner version up.
  await ventureAction(env.deps, owner, 'admin', 'seed.older-grants', tx => {
    for (const id of [first.id, decided.playbook.id]) {
      const stored = tx.find('venture-playbook', id)!;
      tx.replace({ ...stored, steps: stored.steps.map(step => step.id === 'intake' ? { ...step, tools: (step.tools ?? []).filter(tool => tool !== 'evidence.record') } : step) });
    }
  });
  const topped = await env.call('venture.delivery.playbook');
  assert.notEqual(topped.id, decided.playbook.id);
  assert.ok(topped.steps.find((step: any) => step.id === 'intake').tools.includes('evidence.record'));
  const undone = await env.agents('venture.agents.version.undo', { agent: 'story-editor', digest: topped.hash });
  const after = findRecord(env.store.read(), 'venture-playbook', undone.playbookId)!;
  assert.notEqual(after.id, first.id, 'not the older version without the grant');
  assert.ok(after.steps.find(step => step.id === 'intake')!.tools!.includes('evidence.record'), 'the grant stays');
  assert.deepEqual(after.steps.find(step => step.id === 'find')!.guidance, [], 'the change is gone');
  assert.equal((await env.call('venture.delivery.playbook')).id, after.id, 'no further top-up is needed');
});

// ---------------------------------------------------------------------------
// 4B3: the agent panel reads the version in use without writing
// ---------------------------------------------------------------------------

const playbookWrites = (env: AgentEnv) => ({
  versions: listRecords(env.store.read(), 'venture-playbook').length,
  ready: listRecords(env.store.read(), 'venture-event').filter(event => event.name === 'playbook-ready' || event.name === 'playbook-adopted').length,
});

test('orders.list (4B3): before a version is stored it says so, lists the agent\'s steps from the plan, and writes nothing', async () => {
  const env = await agentBusiness();
  const before = playbookWrites(env);
  const view = await env.agents('venture.agents.orders.list', { agent: 'story-editor' });
  assert.deepEqual(playbookWrites(env), before, 'opening the panel never makes a version');
  assert.equal(view.playbook, null);
  assert.equal(view.rebuildDue, true);
  assert.equal(view.undo, null);
  assert.ok(view.steps.length > 0);
  const find = view.steps.find((step: any) => step.stepId === 'find');
  assert.match(find.title, /Write the hooks/);
  assert.deepEqual(find.guidance, []);
  assert.ok(Array.isArray(find.checks));
  assert.equal(view.steps.some((step: any) => step.stepId === 'package'), false, 'only the agent\'s own steps');
});

test('orders.list (4B3): the version in use, its steps\' guidance, and what Undo would do, all read without writing', async () => {
  const { env, first } = await ready();
  let view = await env.agents('venture.agents.orders.list', { agent: 'story-editor' });
  assert.deepEqual(view.playbook, { id: first.id, version: first.version, hash: first.hash, origin: 'plan', at: first.at });
  assert.equal(view.rebuildDue, false);
  assert.equal(view.undo, null);

  const decided = await accept(env, await propose(env, 'story-editor', 'find', CAPTIONS));
  view = await env.agents('venture.agents.orders.list', { agent: 'story-editor' });
  assert.equal(view.playbook.version, decided.playbook.version);
  assert.equal(view.playbook.origin, 'owner');
  assert.deepEqual(view.steps.find((step: any) => step.stepId === 'find').guidance, [CAPTIONS]);
  assert.deepEqual(view.undo, { kind: 'back', version: first.version });

  await accept(env, await propose(env, 'packager', 'package', PINNED));
  view = await env.agents('venture.agents.orders.list', { agent: 'story-editor' });
  assert.deepEqual(view.undo, { kind: 'rebuild' }, 'a later change sits on top');
  assert.deepEqual((await env.agents('venture.agents.orders.list', { agent: 'packager' })).undo, { kind: 'back', version: decided.playbook.version });

  await ventureAction(env.deps, owner, 'admin', 'seed.plan-change', tx => {
    const plan = tx.list('venture-blueprint').find(item => item.id === tx.venture!.acceptedBlueprintId)!;
    const changed = tx.put({ ...plan, ...tx.base('venture-blueprint'), version: plan.version + 1, digest: digest({ changedFrom: plan.digest }) });
    tx.touch({ acceptedBlueprintId: changed.id, blueprintId: changed.id });
  });
  const before = playbookWrites(env);
  view = await env.agents('venture.agents.orders.list', { agent: 'story-editor' });
  assert.equal(view.rebuildDue, true, 'the plan changed since');
  assert.deepEqual(playbookWrites(env), before, 'the rebuild waits for the next run or change');
  assert.equal((await env.agents('venture.agents.thread.list', { agent: 'story-editor' })).items.length > 0, true);
  assert.deepEqual(playbookWrites(env), before, 'reading the thread writes nothing either');
});
