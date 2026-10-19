// P-engine (onboarding v2): the draft desk through the real Engine (demo, experimental file storage, a temp folder,
// synthetic replay recordings). Connect an AI before any vault, compose, keep it safe, and the handover into the vault.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Context } from '../runtime/contracts.ts';
import type { BlueprintView, ModelCallRecord, ModelReplayFixture, ModelStatusView, VentureView } from '../runtime/venture/contracts.ts';
import { AI_OPTION_IDS, DRAFT_IDLE_MS } from '../runtime/venture/onboarding-contracts.ts';
import type { AiOptionsView, AiStatusView, ComposeDecision, ComposedPlan } from '../runtime/venture/onboarding-contracts.ts';
import { AVAILABILITY_REASONS } from '../runtime/venture/models/presets.ts';
import { DOG_COMPOSE, DOG_DECIDE, DOG_TEXT, claudeCliEntry, planEntries } from './fixtures/venture/compose-unit/plans.ts';
import { PASSPHRASE, TEST_KEY, compose, connectPair, engineFor, presetOf } from './fixtures/venture/compose-unit/harness.ts';

const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected, error?.message); return true; };
const START = Date.parse('2026-10-18T09:00:00.000Z');
const MINUTE = 60_000;
function movingClock() {
  let now = START;
  return { clock: () => new Date(now), advance: (ms: number) => { now += ms; } };
}
const DOG_BLUEPRINT: ModelReplayFixture['responses'][number] = {
  purpose: 'blueprint', kind: 'anthropic-messages', model: 'claude-sonnet-5-5', status: 200, mustInclude: ['agent-then-you', 'Dog walking for'],
  body: {
    id: 'msg_synthetic_blueprint', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', stop_reason: 'end_turn', stop_details: null, usage: { input_tokens: 900, output_tokens: 200 },
    content: [{ type: 'text', text: JSON.stringify({
      name: 'Shift Paws', oneLiner: 'Dog walks for nurses on long shifts.', customer: 'Nurses in Leeds on long shifts.',
      offers: [{ id: 'offer_1', name: 'Weekly walks', description: 'Walks on the days you work.' }, { id: 'offer_2', name: 'Holiday cover', description: 'Visits while you are away.' }],
      steps: [{ id: 'step_1', title: 'Agree walk times' }, { id: 'step_2', title: 'Walk the dogs' }, { id: 'step_3', title: 'Reply to owners' }, { id: 'step_4', title: 'Get paid' }],
    }) }],
  },
};
const DOG_RESPONSES = [...planEntries(DOG_TEXT, DOG_DECIDE, DOG_COMPOSE), DOG_BLUEPRINT];

async function filesUnder(directory: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) out.push(...await filesUnder(path)); else out.push(path);
  }
  return out;
}
async function settle<T>(pending: Promise<T>): Promise<{ value: T } | { error: any }> {
  try { return { value: await pending }; } catch (error) { return { error }; }
}

test('before any vault: four Connect rows; ChatGPT is not open with no presets; the API key row is unverified', async t => {
  const { engine } = await engineFor(t);
  const options = await engine.request('venture.ai.options', {}) as AiOptionsView;
  assert.deepEqual(options.options.map(option => option.id), [...AI_OPTION_IDS]);
  const chatgpt = options.options.find(option => option.id === 'chatgpt-sign-in')!;
  assert.deepEqual([chatgpt.status, chatgpt.canConnect, chatgpt.presetIds], ['not-open', false, []]);
  assert.equal(options.options.find(option => option.id === 'api-key')!.status, 'unverified');
  assert.equal(options.unchecked, true);
  assert.equal(options.status.scope, 'before-vault');
  assert.equal(options.status.idleUntil, null, 'nothing connected');
  assert.equal(engine.vault, null);
});

test('connect the recommended pair before any vault; refusals for a wrong consent, built-in templates, a short key and a Haiku model id', async t => {
  const { engine } = await engineFor(t);
  const options = await engine.request('venture.ai.options', {}) as AiOptionsView;
  const haiku = presetOf(options, 'anthropic-haiku-5-5');
  await assert.rejects(engine.request('venture.ai.connect', { presetId: haiku.id, consentDigest: 'f'.repeat(64), apiKey: TEST_KEY }), code('MODEL_CONSENT_REQUIRED'));
  await assert.rejects(engine.request('venture.ai.connect', { presetId: 'built-in-templates', consentDigest: presetOf(options, 'built-in-templates').consentDigest }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(engine.request('venture.ai.connect', { presetId: haiku.id, consentDigest: haiku.consentDigest, apiKey: 'short' }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(engine.request('venture.ai.connect', { presetId: haiku.id, consentDigest: haiku.consentDigest, apiKey: TEST_KEY, model: 'claude-haiku-5-5' }), code('INVALID_VENTURE_REQUEST'));
  const status = await connectPair(engine);
  assert.equal(status.scope, 'before-vault');
  assert.deepEqual([status.tiers.fast.presetId, status.tiers.main.presetId], ['anthropic-haiku-5-5', 'anthropic-sonnet-5-5']);
  assert.ok(status.tiers.fast.usable && status.tiers.main.usable);
  assert.ok(status.connections.every(connection => connection.keyLoaded));
  assert.ok(status.idleUntil, 'the idle timer runs before any vault');
  assert.equal(status.sendPolicy, 'shape');
  assert.equal(JSON.stringify(status).includes(TEST_KEY), false);
});

test('half connected: the main call fails, quick work stays connected, and a main-only connect completes the pair', async t => {
  const { engine } = await engineFor(t);
  const options = await engine.request('venture.ai.options', {}) as AiOptionsView;
  await engine.request('venture.ai.connect', { presetId: 'anthropic-haiku-5-5', consentDigest: presetOf(options, 'anthropic-haiku-5-5').consentDigest, apiKey: TEST_KEY });
  await assert.rejects(engine.request('venture.ai.connect', { presetId: 'anthropic-sonnet-5-5', consentDigest: 'wrong', apiKey: TEST_KEY }), code('MODEL_CONSENT_REQUIRED'));
  const half = await engine.request('venture.ai.status', {}) as AiStatusView;
  assert.equal(half.tiers.fast.presetId, 'anthropic-haiku-5-5');
  assert.equal(half.tiers.main.presetId, 'built-in-templates', 'no usable main tier yet');
  const full = await engine.request('venture.ai.connect', { presetId: 'anthropic-sonnet-5-5', consentDigest: presetOf(options, 'anthropic-sonnet-5-5').consentDigest, apiKey: TEST_KEY }) as AiStatusView;
  assert.equal(full.tiers.main.presetId, 'anthropic-sonnet-5-5');
  assert.equal(full.connections.filter(connection => connection.status === 'connected').length, 2);
});

test('the Claude Code gate: pending refuses before and in the vault; accepted runs the version check and connects', async t => {
  const pending = (await engineFor(t, { claudeCodeTerms: 'pending' })).engine;
  const closed = await pending.request('venture.ai.options', {}) as AiOptionsView;
  const row = closed.options.find(option => option.id === 'claude-code')!;
  assert.deepEqual([row.status, row.canConnect], ['needs-setup', false]);
  assert.equal(presetOf(closed, 'claude-code-cli').availabilityReason, AVAILABILITY_REASONS.claudeTerms);
  const claude = presetOf(closed, 'claude-code-cli');
  await assert.rejects(pending.request('venture.ai.connect', { presetId: 'claude-code-cli', consentDigest: claude.consentDigest }), (error: any) => error.code === 'PRESET_UNAVAILABLE' && error.message === AVAILABILITY_REASONS.claudeTerms);
  await pending.request('workspace.create', { name: 'Gate test', passphrase: PASSPHRASE, pack: 'services' });
  await pending.request('venture.create', { idea: DOG_TEXT, countryCode: 'GB', workingName: 'Gate test' });
  await assert.rejects(pending.request('venture.models.connect', { presetId: 'claude-code-cli', consentDigest: claude.consentDigest }), code('PRESET_UNAVAILABLE'));

  const accepted = (await engineFor(t, { claudeCodeTerms: 'accepted', responses: [claudeCliEntry('decide', DOG_DECIDE, ['chausar-decide-v1']), claudeCliEntry('compose', DOG_COMPOSE, ['chausar-compose-v1'])] })).engine;
  const open = await accepted.request('venture.ai.options', {}) as AiOptionsView;
  assert.equal(open.options.find(option => option.id === 'claude-code')!.canConnect, true);
  const status = await accepted.request('venture.ai.connect', { presetId: 'claude-code-cli', consentDigest: presetOf(open, 'claude-code-cli').consentDigest }) as AiStatusView;
  assert.deepEqual([status.tiers.fast.presetId, status.tiers.main.presetId], ['claude-code-cli', 'claude-code-cli']);
  const { plan } = await compose(accepted, DOG_TEXT, 'GB');
  assert.equal(plan.writtenBy.presetId, 'claude-code-cli');
  assert.equal(plan.writtenBy.model, 'claude-sonnet-5-5');
});

test('decide then fill on recordings; the calls are listed with payload text that holds no key, and no key is anywhere', async t => {
  const { engine, directory } = await engineFor(t, { responses: DOG_RESPONSES });
  await connectPair(engine);
  const { decision, plan } = await compose(engine, DOG_TEXT, 'GB');
  assert.deepEqual([decision.kind, decision.views], ['idea', ['offers-first', 'pages', 'notes']]);
  assert.equal(plan.writtenBy.replay, true);
  assert.equal(plan.text, DOG_TEXT);
  const calls = await engine.request('venture.ai.calls', {}) as ModelCallRecord[];
  assert.deepEqual(calls.map(call => call.purpose), ['compose', 'decide'], 'newest first');
  assert.deepEqual(calls.map(call => call.presetId), ['anthropic-sonnet-5-5', 'anthropic-haiku-5-5']);
  for (const call of calls) {
    assert.equal(call.payloadText.includes(TEST_KEY), false);
    assert.equal(call.containsClientData, false);
    assert.match(call.payloadText, call.purpose === 'decide' ? /chausar-decide-v1/ : /chausar-compose-v1/);
  }
  await assert.rejects(engine.request('venture.ai.calls', { limit: 0 }), code('INVALID_VENTURE_REQUEST'));
  const priced = await engine.request('venture.compose.update', { composeId: plan.composeId, patch: { offers: [{ id: 'offer_1', unitPrice: '18' }] } }) as ComposedPlan;
  // Keep it safe, then make the business: the key moves to the vault's memory-only shelf, never to disk.
  await engine.request('workspace.create', { name: 'Shift Paws Leeds', passphrase: PASSPHRASE, pack: 'services' });
  const errors: unknown[] = [];
  errors.push(await settle(engine.request('venture.ai.connect', { presetId: 'anthropic-haiku-5-5', consentDigest: 'x', apiKey: TEST_KEY })));
  await engine.request('venture.create', { idea: DOG_TEXT, countryCode: 'GB', workingName: 'Shift Paws Leeds', composeId: priced.composeId, composedDigest: priced.digest });
  const results = [
    await engine.request('venture.models.status', {}), await engine.request('venture.models.calls', {}), await engine.request('venture.blueprint.get', {}),
    await engine.request('venture.get', {}),
  ];
  errors.push(await settle(engine.request('venture.ai.status', {})));
  assert.equal(JSON.stringify(results).includes(TEST_KEY), false);
  assert.equal(JSON.stringify(engine.vault!.read()).includes(TEST_KEY), false);
  assert.equal(JSON.stringify(errors, (key, value) => (value instanceof Error ? { code: (value as any).code, message: value.message, stack: value.stack } : value)).includes(TEST_KEY), false);
  await engine.request('workspace.lock', {});
  for (const file of await filesUnder(directory)) assert.equal((await readFile(file)).includes(TEST_KEY), false, file);
});

test('lifetime: idle sixty minutes clears the keys; Keep it safe pauses the timer so the plan survives the recovery code', async t => {
  const { clock, advance } = movingClock();
  const { engine } = await engineFor(t, { clock, responses: [...DOG_RESPONSES, ...planEntries(DOG_TEXT, DOG_DECIDE, DOG_COMPOSE)] });
  await connectPair(engine);
  advance(DRAFT_IDLE_MS - MINUTE);
  assert.ok((await engine.request('venture.ai.status', {}) as AiStatusView).connections.every(c => c.keyLoaded), 'a request inside the hour resets the timer');
  advance(DRAFT_IDLE_MS);
  const cleared = await engine.request('venture.ai.status', {}) as AiStatusView;
  assert.deepEqual(cleared.connections, [], 'an hour idle wipes the draft');
  await assert.rejects(engine.request('venture.compose.decide', { text: DOG_TEXT, countryCode: 'GB' }), code('NO_MODEL_CONNECTED'));
  await assert.rejects(engine.request('venture.compose.fill', { composeId: 'compose_gone' }), code('COMPOSE_NOT_FOUND'));

  await connectPair(engine);
  const { plan } = await compose(engine, DOG_TEXT, 'GB');
  await engine.request('workspace.create', { name: 'Shift Paws Leeds', passphrase: PASSPHRASE, pack: 'services' });
  advance(DRAFT_IDLE_MS + MINUTE); // the owner reads and saves the recovery code
  const held = await engine.request('venture.compose.get', {}) as { decision: ComposeDecision; plan: ComposedPlan };
  assert.equal(held.plan.digest, plan.digest);
  assert.equal((await engine.request('venture.ai.status', {}) as AiStatusView).idleUntil, null, 'paused while a vault with no venture is open');
  const view = await engine.request('venture.create', { idea: DOG_TEXT, countryCode: 'GB', composeId: plan.composeId, composedDigest: plan.digest }) as VentureView;
  assert.equal(view.venture.workingName, 'Shift Paws Leeds');
  const status = await engine.request('venture.models.status', {}) as ModelStatusView;
  assert.ok(status.connections.filter(c => c.status === 'connected').every(c => c.keyLoaded), 'the keys moved to the vault shelf');
  // With a venture in the open vault every draft method refuses.
  for (const method of ['venture.ai.options', 'venture.ai.status', 'venture.compose.get'] as const) await assert.rejects(engine.request(method, {}), code('VENTURE_EXISTS'));
});

test('lifetime: lock, open, recover and restore clear the draft; a new Engine on the same folder starts empty', async t => {
  const { engine, directory } = await engineFor(t, { responses: DOG_RESPONSES });
  await connectPair(engine);
  const created = await engine.request('workspace.create', { name: 'Clearing test', passphrase: PASSPHRASE, pack: 'services' });
  await engine.request('workspace.lock', {});
  assert.deepEqual((await engine.request('venture.ai.status', {}) as AiStatusView).connections, [], 'lock clears');
  await connectPair(engine);
  await engine.request('workspace.open', { passphrase: PASSPHRASE });
  assert.deepEqual((await engine.request('venture.ai.status', {}) as AiStatusView).connections, [], 'open clears');
  await engine.request('workspace.lock', {});
  await connectPair(engine);
  await engine.request('workspace.recover', { recoveryCode: created.recoveryCode, passphrase: 'another-long-enough-passphrase' });
  assert.deepEqual((await engine.request('venture.ai.status', {}) as AiStatusView).connections, [], 'recover clears');
  await engine.request('workspace.lock', {});
  await connectPair(engine);
  await assert.rejects(engine.request('workspace.restore', { backupFile: '../outside.backup', passphrase: PASSPHRASE }), code('INVALID_PATH'));
  assert.deepEqual((await engine.request('venture.ai.status', {}) as AiStatusView).connections, [], 'restore clears before it opens anything');
  await connectPair(engine);
  const fresh = (await engineFor(t, { directory })).engine;
  assert.deepEqual((await fresh.request('venture.ai.status', {}) as AiStatusView).connections, [], 'a new Engine starts empty: keys never touched disk');
  await fresh.close();
});

test('handover: venture.create writes the composition, the answered interview, blueprint v1, the adopted AI and its calls, and wipes the draft', async t => {
  const { engine } = await engineFor(t, { responses: DOG_RESPONSES });
  const connected = await connectPair(engine);
  let { plan } = await compose(engine, DOG_TEXT, 'GB');
  plan = await engine.request('venture.compose.update', { composeId: plan.composeId, patch: { offers: [{ id: 'offer_1', unitPrice: '18' }, { id: 'offer_2', unitPrice: '60.50' }] } }) as ComposedPlan;
  const draftCalls = await engine.request('venture.ai.calls', {}) as ModelCallRecord[];
  await engine.request('workspace.create', { name: 'Shift Paws Leeds', passphrase: PASSPHRASE, pack: 'services' });
  await assert.rejects(engine.request('venture.create', { idea: DOG_TEXT, countryCode: 'GB', composeId: plan.composeId, composedDigest: 'a'.repeat(64) }), code('APPROVAL_STALE'));
  await assert.rejects(engine.request('venture.create', { idea: DOG_TEXT, countryCode: 'GB', composeId: 'compose_missing', composedDigest: plan.digest }), code('COMPOSE_NOT_FOUND'));
  await assert.rejects(engine.request('venture.create', { idea: DOG_TEXT, countryCode: 'IN', composeId: plan.composeId, composedDigest: plan.digest }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(engine.request('venture.create', { idea: DOG_TEXT, countryCode: 'GB', composeId: plan.composeId }), code('INVALID_VENTURE_REQUEST'));
  const before = engine.vault!.read().policy.send;
  const view = await engine.request('venture.create', { idea: DOG_TEXT, countryCode: 'GB', composeId: plan.composeId, composedDigest: plan.digest }) as VentureView;
  const state = engine.vault!.read();
  const ventureId = view.venture.id;
  const kinds = (kind: string) => state.conversations.filter((record: any) => record.kind === kind && record.ventureId === ventureId);
  const [composition] = kinds('venture-composition');
  assert.equal(composition.composeId, plan.composeId);
  assert.equal(composition.planDigest, plan.digest);
  assert.equal(composition.planKind, 'idea');
  assert.deepEqual(composition.pricing, [{ id: 'offer_1', model: 'monthly', unitPriceMinor: '1800' }, { id: 'offer_2', model: 'project', unitPriceMinor: '6050' }]);
  const [interview] = kinds('venture-interview');
  assert.equal(interview.source, 'model');
  assert.deepEqual(interview.questions.find((q: any) => q.id === 'q_pricing_model').choices.map((c: any) => c.id), ['monthly'], 'a subscription is priced per month only');
  const [blueprint] = kinds('venture-blueprint');
  assert.deepEqual([blueprint.version, blueprint.source, blueprint.offers.map((o: any) => o.block)], [1, 'model', ['subscription', 'package']]);
  assert.deepEqual(blueprint.pages.map((p: any) => p.block), ['home', 'offers-prices', 'booking', 'faq']);
  assert.deepEqual(blueprint.notes.map((n: any) => n.block), ['insurance', 'safety']);
  assert.equal(view.venture.blueprintId, blueprint.id);
  assert.equal(view.venture.serviceType, 'other');
  const connections = kinds('venture-model-connection');
  assert.deepEqual(connections.map((c: any) => c.id).sort(), connected.connections.map(c => c.id).sort(), 'adopted connections keep their ids');
  assert.ok(connections.every((c: any) => c.memberId === engine.context.memberId && c.ventureId === ventureId));
  const calls = kinds('venture-model-call');
  assert.deepEqual(calls.map((c: any) => c.id).sort(), draftCalls.map(c => c.id).sort(), 'adopted calls keep their ids');
  const draftAt = Object.fromEntries(draftCalls.map(call => [call.id, call.at]));
  assert.ok(calls.every((c: any) => c.at === draftAt[c.id]), 'and their times');
  const events = (await engine.request('venture.events', {}) as { events: { name: string }[] }).events.map(event => event.name);
  assert.deepEqual(events.slice(0, 6), ['venture-created', 'plan-composed', 'interview-updated', 'blueprint-drafted', 'model-connected', 'model-connected']);
  assert.ok(events.includes('send-policy-changed') || before !== 'nothing');
  assert.equal(engine.vault!.read().policy.send, 'shape');
  // "What was sent" in the vault lists the calls made before the vault.
  assert.deepEqual((await engine.request('venture.models.calls', {}) as ModelCallRecord[]).map(call => call.purpose), ['compose', 'decide']);
  // The keys reached the vault shelf: a rewrite reaches the model.
  const rewritten = (await engine.request('venture.blueprint.draft', {}) as BlueprintView).blueprint;
  assert.deepEqual([rewritten.version, rewritten.source, rewritten.name.value], [2, 'model', 'Shift Paws']);
  // Before acceptance the starter connectors are the composed plan's own: its tools, the country's rail and the books.
  const starters = await engine.request('venture.connectors.list', { starterOnly: true }) as { id: string }[];
  assert.deepEqual(starters.map(card => card.id).sort(), ['cal-com', 'chausar-books', 'github', 'lovable', 'stripe', 'whatsapp']);
  // The draft is empty and closed now.
  await assert.rejects(engine.request('venture.compose.get', {}), code('VENTURE_EXISTS'));
});

test('handover without a composed plan: an AI connected before the vault is still adopted with the built-in plan', async t => {
  const { engine } = await engineFor(t, { responses: DOG_RESPONSES });
  await connectPair(engine);
  await engine.request('workspace.create', { name: 'Built-in plan', passphrase: PASSPHRASE, pack: 'services' });
  await engine.request('venture.create', { idea: DOG_TEXT, countryCode: 'GB', workingName: 'Built-in plan' });
  const status = await engine.request('venture.models.status', {}) as ModelStatusView;
  assert.deepEqual(status.connections.filter(c => c.status === 'connected').map(c => c.presetId).sort(), ['anthropic-haiku-5-5', 'anthropic-sonnet-5-5']);
  assert.ok(status.connections.every(c => c.keyLoaded));
  const view = await engine.request('venture.get', {}) as VentureView;
  assert.equal(view.checklist[0].id, 'ai');
  assert.equal(view.checklist[0].done, true);
  assert.equal(engine.vault!.read().conversations.some((r: any) => r.kind === 'venture-composition'), false);
});

test('app channel: connect, decide and fill refuse a phone or tainted context', async t => {
  const { engine } = await engineFor(t, { responses: DOG_RESPONSES });
  const options = await engine.request('venture.ai.options', {}) as AiOptionsView;
  const contexts: Context[] = [
    { memberId: 'owner', role: 'owner', epoch: 1, channel: 'phone' },
    { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop', sourceTainted: true },
  ];
  for (const ctx of contexts) {
    await assert.rejects(engine.requestAs(ctx, 'venture.ai.connect', { presetId: 'anthropic-haiku-5-5', consentDigest: presetOf(options, 'anthropic-haiku-5-5').consentDigest, apiKey: TEST_KEY }), code('APP_APPROVAL_REQUIRED'));
    await assert.rejects(engine.requestAs(ctx, 'venture.compose.decide', { text: DOG_TEXT, countryCode: 'GB' }), code('APP_APPROVAL_REQUIRED'));
    await assert.rejects(engine.requestAs(ctx, 'venture.compose.fill', { composeId: 'compose_x' }), code('APP_APPROVAL_REQUIRED'));
  }
  assert.deepEqual((await engine.request('venture.ai.status', {}) as AiStatusView).connections, []);
  // Compose input rules: the open box takes ten to two thousand characters, from a known country.
  await connectPair(engine);
  await assert.rejects(engine.request('venture.compose.decide', { text: 'Too short', countryCode: 'GB' }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(engine.request('venture.compose.decide', { text: DOG_TEXT, countryCode: 'ZZ' }), code('UNKNOWN_COUNTRY'));

});

test('handover after every connection was disconnected: the calls made before the vault still move in, and no AI is claimed', async t => {
  const { engine } = await engineFor(t, { responses: DOG_RESPONSES });
  const connected = await connectPair(engine);
  const { plan } = await compose(engine, DOG_TEXT, 'GB');
  for (const connection of connected.connections) await engine.request('venture.ai.disconnect', { connectionId: connection.id });
  const draftCalls = await engine.request('venture.ai.calls', {}) as ModelCallRecord[];
  assert.equal(draftCalls.length, 2);
  await engine.request('workspace.create', { name: 'Shift Paws Leeds', passphrase: PASSPHRASE, pack: 'services' });
  const view = await engine.request('venture.create', { idea: DOG_TEXT, countryCode: 'GB', composeId: plan.composeId, composedDigest: plan.digest }) as VentureView;
  const state = engine.vault!.read();
  const calls = state.conversations.filter((record: any) => record.kind === 'venture-model-call' && record.ventureId === view.venture.id);
  assert.deepEqual(calls.map((call: any) => call.id).sort(), draftCalls.map(call => call.id).sort(), 'the calls the plan names are in the vault');
  const [blueprint] = state.conversations.filter((record: any) => record.kind === 'venture-blueprint');
  assert.ok(blueprint.modelCallIds.every((id: string) => calls.some((call: any) => call.id === id)), 'every call id the blueprint names resolves');
  assert.deepEqual((await engine.request('venture.models.calls', {}) as ModelCallRecord[]).map(call => call.purpose), ['compose', 'decide']);
  // No connection was left, so none is adopted, no key moves, and the checklist does not say an AI is connected.
  assert.equal(state.conversations.some((record: any) => record.kind === 'venture-model-connection'), false);
  assert.deepEqual((await engine.request('venture.models.status', {}) as ModelStatusView).connections, []);
  assert.equal(view.checklist.find(item => item.id === 'ai')!.done, false);
  await assert.rejects(engine.request('venture.compose.get', {}), code('VENTURE_EXISTS'));
});

test('a phone or tainted context learns nothing about the vault: it is refused as outside the app before VENTURE_EXISTS', async t => {
  const { engine } = await engineFor(t, { responses: DOG_RESPONSES });
  await engine.request('workspace.create', { name: 'Order of checks', passphrase: PASSPHRASE, pack: 'services' });
  await engine.request('venture.create', { idea: DOG_TEXT, countryCode: 'GB', workingName: 'Order of checks' });
  const phone: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'phone' };
  for (const method of ['venture.ai.status', 'venture.compose.get', 'venture.ai.options']) {
    await assert.rejects(engine.requestAs(phone, method, {}), code('APP_APPROVAL_REQUIRED'), method);
    await assert.rejects(engine.request(method, {}), code('VENTURE_EXISTS'), method);
  }
});

test('the Claude Code gate holds at run time: a connection made while it was open does not run once it is closed', async t => {
  const responses = [claudeCliEntry('decide', DOG_DECIDE, ['chausar-decide-v1']), claudeCliEntry('compose', DOG_COMPOSE, ['chausar-compose-v1'])];
  const { engine, directory } = await engineFor(t, { claudeCodeTerms: 'accepted', responses });
  const options = await engine.request('venture.ai.options', {}) as AiOptionsView;
  await engine.request('venture.ai.connect', { presetId: 'claude-code-cli', consentDigest: presetOf(options, 'claude-code-cli').consentDigest });
  const { plan } = await compose(engine, DOG_TEXT, 'GB');
  await engine.request('workspace.create', { name: 'Gate later', passphrase: PASSPHRASE, pack: 'services' });
  await engine.request('venture.create', { idea: DOG_TEXT, countryCode: 'GB', composeId: plan.composeId, composedDigest: plan.digest });
  await engine.request('workspace.lock', {});
  // The same vault on an engine whose host has not accepted the terms.
  const closed = (await engineFor(t, { claudeCodeTerms: 'pending', responses, directory })).engine;
  t.after(async () => { await closed.close().catch(() => {}); });
  await closed.request('workspace.open', { passphrase: PASSPHRASE });
  const status = await closed.request('venture.models.status', {}) as ModelStatusView;
  assert.equal(status.tiers.main.presetId, 'claude-code-cli');
  assert.deepEqual([status.tiers.main.usable, status.tiers.main.reason], [false, AVAILABILITY_REASONS.claudeTerms]);
  await assert.rejects(closed.request('venture.blueprint.draft', {}), (error: any) => error.code === 'PRESET_UNAVAILABLE' && error.message === AVAILABILITY_REASONS.claudeTerms);
});
