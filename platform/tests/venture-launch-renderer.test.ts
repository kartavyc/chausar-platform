// Launch renderer (P7): runs the real launch.js and app.js in one vm context with a fake DOM whose innerHTML and
// outerHTML setters throw, the real preload, and the real IPC contract validator. The engine is a fake that
// answers from the typed synthetic fixtures in fixtures/venture/renderer. No network, no Electron, no model.
// The harness itself lives in launch-renderer-harness.ts, shared with the onboarding renderer test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import vm from 'node:vm';
import { EVIDENCE_METHODS, EXTERNAL_ORIGINS, INDIA_STATES } from '../runtime/venture/contracts.ts';
import type { DeliveryRunRecord, DeliveryRunView, ModelPreset, Scenario, VentureEventRecord } from '../runtime/venture/contracts.ts';
import { houseStyleFindings } from '../runtime/venture/records.ts';
import * as F from './fixtures/venture/renderer/results.ts';
import * as O from './fixtures/venture/renderer/onboarding.ts';
import {
  BACK_OFFICE_IDS, BOTH_RECORDED, CLIENT, EXPERIMENTAL, Element, KEY, LAUNCH_IDS, PERIODS, RECORDING, ZONE, ancestors, appSource, booksFor, button, buttons, click,
  control, cssSource, descendants, draftRow, hasClass, find, flush, harness, indexSource, launchSource, makeTab, openDialog, openDraft, ownerDay, place, root, text, tick, type, visibleText, wordCount,
} from './launch-renderer-harness.ts';
import type { EngineOptions, FakeTab, HarnessOptions } from './launch-renderer-harness.ts';

// ---------------------------------------------------------------------------------------------
// 1 to 3: connect an AI first, or continue without one: the open box, the built-in plan, keep it safe
// ---------------------------------------------------------------------------------------------
const title = (host: Element) => find(host, node => hasClass(node, 'ob-title')).textContent;
const goButton = (host: Element) => find(host, node => node.attributes['aria-label'] === 'Make my plan', 'Expected the round go button.');
/** Filled buttons a person can see at rest: the look B button and the reused launch button. */
const filledAtRest = (host: Element) => descendants(host).filter(node => node.tagName === 'button' && (hasClass(node, 'ob-btn') || node.className === 'launch-btn') && !ancestors(node).some(parent => parent.hidden || (parent.tagName === 'details' && !parent.open)));
/** Boots on Connect, then takes "Continue without AI" to the open box: the built-in templates path. */
async function withoutAi(engine: EngineOptions = {}, options: HarnessOptions = {}) {
  const h = await harness(engine, options);
  await h.renderer.boot(); await flush();
  assert.equal(title(h.app), 'Connect an AI first.');
  await click(button(h.app, 'Continue without AI'));
  return h;
}
/** From the open box to the built-in plan, then its price screen. */
async function builtInPlan(h: Awaited<ReturnType<typeof harness>>, idea: string) {
  await type(find(h.app, node => node.tagName === 'textarea'), idea);
  await click(goButton(h.app));
}

test('first screen connects an AI first; without one the open box asks one question with one textarea', async () => {
  const h = await withoutAi();
  assert.equal(title(h.app), 'What do you want to do?');
  assert.equal(descendants(h.app).filter(node => node.tagName === 'textarea').length, 1);
  assert.equal(descendants(h.body).filter(node => node.tagName === 'input' && node.attributes.type === 'password').length, 0);
  assert.deepEqual(h.calls.map(call => call.method), ['workspace.status', 'venture.ai.status', 'workspace.list', 'venture.ai.options', 'venture.countries']);
  assert.match(text(h.app), /Based in India/);
  assert.ok(buttons(h.app, 'Connect an AI').length === 1, 'without an AI the box offers to connect one');
  assert.ok(filledAtRest(h.app).length <= 1, 'one filled button at most');
  assert.equal(h.rejected.length, 0);
});

test('the round go button sends exactly the idea and country for a built-in plan, labelled as one, with no vault or passphrase', async () => {
  const h = await withoutAi();
  await builtInPlan(h, 'Monthly bookkeeping for cafes and small shops in Pune.');
  assert.deepEqual(h.calls.at(-1), { method: 'venture.preview', payload: { idea: 'Monthly bookkeeping for cafes and small shops in Pune.', countryCode: 'IN' } });
  assert.deepEqual(Object.keys(h.calls.at(-1)!.payload).sort(), ['countryCode', 'idea']);
  assert.ok(visibleText(h.app).includes('Built-in plan, not fitted to what you wrote.'), 'the built-in plan says so at rest');
  for (const words of ['Monthly books', 'Catch up', 'Collect bills and bank statements', 'Draft the monthly report for review', 'Set your price']) assert.ok(text(h.app).includes(words), words);
  assert.equal(descendants(h.app).filter(node => node.className === 'launch-chip' && node.textContent === 'planned: agent').length, 3);
  await click(button(h.app, 'Set your price'));
  assert.equal(title(h.app), 'Set your price.');
  assert.ok(descendants(h.app).some(node => node.className === 'launch-chip' && node.textContent === 'Assumption: not registered for GST'));
  assert.equal(descendants(h.body).filter(node => node.tagName === 'input' && node.attributes.type === 'password').length, 0);
  assert.equal(h.calls.some(call => call.method === 'workspace.create'), false);
  assert.ok(filledAtRest(h.app).length <= 1, 'one filled button at most');
});

test('every plan step and every approval carries its own label, before and after the plan is kept', async () => {
  const told = <T extends { label: string }>(line: T) => ({ ...line, label: 'told-by-you' });
  const preview = {
    ...F.preview,
    deliverySteps: F.preview.deliverySteps.map((step, index) => (index === 1 ? { ...step, title: told(step.title) } : step)),
    approvals: [F.preview.approvals[0], told(F.preview.approvals[1])],
  };
  const labelsIn = (host: Element, words: string) => {
    const part = find(host, node => (node.className === 'launch-section' || node.tagName === 'details') && node.children[0]?.textContent === words, `Expected the "${words}" part.`);
    return {
      steps: descendants(part).filter(node => node.className === 'launch-row').map(row => descendants(row).find(node => node.className.split(' ').includes('launch-row-label'))?.textContent),
      approvals: descendants(part).filter(node => node.className.split(' ').includes('launch-approval')).map(line => [line.children[0].textContent, line.children.at(-1)!.textContent]),
    };
  };
  const h = await withoutAi({ overrides: { 'venture.preview': () => preview } });
  await builtInPlan(h, 'Monthly bookkeeping for cafes.');
  assert.deepEqual(labelsIn(h.app, 'Steps').steps, ['assumption', 'told by you', 'assumption', 'assumption']);
  assert.deepEqual(labelsIn(h.app, 'You approve').approvals, [['Every monthly report before it reaches a client', 'assumption'], ['Any message that asks a client for money', 'told by you']]);
  // Chausar takes no payments itself, so the back office line never says it does.
  assert.ok(text(h.app).includes('Clients pay through Razorpay links on your site, and you record each payment here.'));
  assert.equal(text(h.app).includes('Payments by'), false);

  const kept = { ...F.blueprintDraftView, blueprint: { ...F.blueprintDraftView.blueprint, deliverySteps: preview.deliverySteps, approvals: preview.approvals } };
  const owned = await place('business', { blueprint: 'draft', overrides: { 'venture.blueprint.get': () => kept } });
  assert.deepEqual(labelsIn(owned.content, 'Steps').steps, ['assumption', 'told by you', 'assumption', 'assumption']);
  assert.deepEqual(labelsIn(owned.content, 'You approve').approvals, [['Every monthly report before it reaches a client', 'assumption'], ['Any message that asks a client for money', 'told by you']]);
});

test('keeping the plan makes a services vault named from the plan, with no passphrase, then sets up the business in order with typed answers', async () => {
  const h = await withoutAi();
  await builtInPlan(h, 'Monthly bookkeeping for cafes and small shops in Pune.');
  await click(button(h.app, 'Set your price'));
  await type(find(h.app, node => node.attributes['aria-label'] === 'Your price, in INR'), '2,499');
  await click(button(h.app, 'Change'));
  await click(button(h.app, 'Yes'));
  assert.equal(find(h.app, node => node.attributes['aria-label'] === 'GST rate, in percent').value, '18', 'the rate is prefilled from the preview');
  await click(button(h.app, 'Tell us more (optional)'));
  await click(button(h.app, 'Small shops'));
  await click(button(h.app, 'Keep this plan')); await flush();

  // No Keep it safe and no recovery code: the engine names the folder and this computer keeps the key.
  assert.equal(text(h.app).includes('Keep it safe.'), false);
  assert.equal(text(h.app).includes('Save your recovery code.'), false);
  assert.deepEqual(h.calls.find(call => call.method === 'workspace.create'), { method: 'workspace.create', payload: { name: 'Bookkeeping studio', pack: 'services', folder: null } });
  assert.equal(descendants(h.body).filter(node => node.tagName === 'input' && node.attributes.type === 'password').length, 0, 'no passphrase field anywhere');
  const sequence = h.after('venture.create').slice(0, 11);
  assert.deepEqual(sequence, [
    { method: 'venture.create', payload: { idea: 'Monthly bookkeeping for cafes and small shops in Pune.', countryCode: 'IN', workingName: 'Bookkeeping studio' } },
    { method: 'venture.interview.next', payload: { useTemplate: true } },
    { method: 'venture.interview.answer', payload: { questionId: 'q_1', answer: { choiceId: 'c_2' } } },
    { method: 'venture.interview.answer', payload: { questionId: 'q_2', answer: { skipped: true } } },
    { method: 'venture.interview.answer', payload: { questionId: 'q_pricing_model', answer: { choiceId: 'monthly' } } },
    { method: 'venture.interview.answer', payload: { questionId: 'q_price', answer: { amount: '2,499' } } },
    { method: 'venture.interview.answer', payload: { questionId: 'q_tax', answer: { yes: true } } },
    { method: 'venture.interview.answer', payload: { questionId: 'q_tax_rate', answer: { rate: '18' } } },
    { method: 'venture.blueprint.draft', payload: { useTemplate: true } },
    { method: 'venture.price.quote', payload: { offerId: 'offer_1' } },
    { method: 'venture.get', payload: {} },
  ]);
  assert.equal(h.rejected.length, 0, 'no payload carried undefined');
  assert.ok(text(h.app).includes('INR 2,948.82'), 'the kept plan shows the receipt total');
  assert.ok(text(h.app).includes('Accept plan'));
});

test('the experimental notice shows on Setting up, and the passphrase fallback keeps its recovery code once', async () => {
  const slow = await withoutAi({ overrides: { 'venture.create': () => new Promise(() => {}) } });
  await builtInPlan(slow, 'Monthly bookkeeping for cafes.');
  await click(button(slow.app, 'Set your price'));
  void button(slow.app, 'Keep this plan').dispatch('click'); await flush();
  assert.equal(title(slow.app), 'Setting up your plan');
  assert.ok(text(slow.app).includes(EXPERIMENTAL), 'experimental notice on Setting up');

  const h = await withoutAi({ custody: { unavailable: 'platform' } });
  await builtInPlan(h, 'Monthly bookkeeping for cafes.');
  await click(button(h.app, 'Set your price'));
  await click(button(h.app, 'Keep this plan')); await flush();
  assert.equal(title(h.app), 'Choose a passphrase.');
  await type(control(h.app, 'Passphrase'), 'long-enough-passphrase');
  await type(control(h.app, 'Type it again'), 'long-enough-passphrase');
  await find(h.app, node => node.tagName === 'form').dispatch('submit'); await flush();
  assert.deepEqual(h.calls.filter(call => call.method === 'workspace.create').at(-1)!.payload, { name: 'Bookkeeping studio', pack: 'services', folder: null, passphrase: 'long-enough-passphrase' });
  assert.equal(title(h.app), 'Save your recovery code.');
  assert.equal(find(h.app, node => hasClass(node, 'ob-code')).textContent, 'DEMO-RECOVERY-CODE', 'the chunks are the exact code');
  await click(button(h.app, 'Save as file'));
  const [savedCode] = h.saved();
  assert.equal(savedCode.filename, 'chausar-recovery-code.txt');
  assert.match(savedCode.text!, /^Chausar recovery code\nWorkspace: Bookkeeping studio\nWorkspace folder: bookkeeping-studio\n/);
  assert.ok(savedCode.text!.split('\n').includes('DEMO-RECOVERY-CODE'), 'the saved file holds the exact code on its own line');
  const go = button(h.app, 'Continue');
  assert.equal(go.disabled, true, 'Continue waits for the box');
  await tick(find(h.app, node => node.tagName === 'input' && node.attributes.type === 'checkbox'));
  await click(go); await flush();
  assert.equal(h.calls.filter(call => call.method === 'venture.create').length, 1);
});

test('without a price the price question is skipped and no quote is asked for', async () => {
  const h = await withoutAi();
  await builtInPlan(h, 'Podcast editing for small creators.');
  await click(button(h.app, 'Set your price'));
  await click(button(h.app, 'Per hour'));
  assert.deepEqual(h.calls.at(-1), { method: 'venture.preview', payload: { idea: 'Podcast editing for small creators.', countryCode: 'IN', pricingModel: 'hourly' } }, 'the plan is asked for again, worded for hourly work');
  assert.equal(find(h.app, node => node.className === 'launch-choice on').textContent, 'Per hour', 'the choice stays after the plan is drawn again');
  await click(button(h.app, 'Keep this plan')); await flush();
  assert.equal(h.calls.find(call => call.method === 'workspace.create')!.payload.folder, null, 'the engine names the folder');
  const answers = h.calls.filter(call => call.method === 'venture.interview.answer').map(call => [call.payload.questionId, call.payload.answer]);
  assert.deepEqual(answers, [['q_1', { skipped: true }], ['q_2', { skipped: true }], ['q_pricing_model', { choiceId: 'hourly' }], ['q_price', { skipped: true }], ['q_tax', { yes: false }]]);
  assert.equal(h.calls.some(call => call.method === 'venture.price.quote'), false);
});

test('an open vault with no business resumes at Connect and keeps the plan without asking for a passphrase', async () => {
  const h = await withoutAi({ open: true, venture: false, blueprint: null });
  assert.equal(title(h.app), 'What do you want to do?');
  assert.ok(buttons(h.app, 'Open the back office').length === 1);
  await builtInPlan(h, 'Monthly bookkeeping for cafes.');
  await click(button(h.app, 'Set your price'));
  await click(button(h.app, 'Keep this plan')); await flush();
  assert.equal(h.calls.some(call => call.method === 'workspace.create'), false);
  assert.deepEqual(h.calls.find(call => call.method === 'venture.create')!.payload, { idea: 'Monthly bookkeeping for cafes.', countryCode: 'IN', workingName: 'Ledger Cafe Books' });
});

// ---------------------------------------------------------------------------------------------
// 4: Add your AI
// ---------------------------------------------------------------------------------------------
test('Add your AI connects the recommended pair with consent, a key outside any form, and the Luna model id', async () => {
  const h = await place('today');
  await click(button(h.content, 'Add your AI (optional)'));
  const sheet = openDialog(h.body);
  assert.ok(text(sheet).includes('Which AI should do the work?'));
  assert.ok(text(sheet).includes('AI answers here come from a synthetic recording.'));
  const recommended = find(sheet, node => node.dataset.preset === 'recommended');
  const key = find(recommended, node => node.tagName === 'input' && node.attributes.type === 'password');
  assert.equal(key.attributes.autocomplete, 'off');
  assert.equal(ancestors(key).some(node => node.tagName === 'form'), false, 'the key field is not inside a form');
  assert.ok(text(recommended).includes('Chausar keeps this in memory only. If your browser offers to save it, choose Never.'));
  assert.ok(text(recommended).includes(F.presets[0].consentText), 'consent text shown word for word');
  const connect = button(recommended, 'Connect');
  assert.equal(connect.disabled, true);
  await type(key, KEY);
  await click(connect);
  assert.equal(h.calls.filter(call => call.method === 'venture.models.connect').length, 0, 'nothing sent before the box is ticked');
  await tick(find(recommended, node => node.tagName === 'input' && node.attributes.type === 'checkbox'));
  assert.equal(connect.disabled, false);
  await click(connect);
  assert.deepEqual(h.calls.filter(call => call.method === 'venture.models.connect').map(call => call.payload), [
    { presetId: 'anthropic-haiku-5-5', consentDigest: F.presets[0].consentDigest, apiKey: KEY, tiers: ['fast'] },
    { presetId: 'anthropic-sonnet-5-5', consentDigest: F.presets[1].consentDigest, apiKey: KEY, tiers: ['main'] },
  ]);
  assert.equal(key.value, '', 'the key is cleared');
  assert.match(text(recommended), /Connected: Claude Haiku 5.5 for quick work/);

  const rowsInOrder = descendants(sheet).filter(node => node.className === 'launch-preset').map(node => node.dataset.preset);
  assert.deepEqual(rowsInOrder, ['built-in-templates', 'anthropic-haiku-5-5', 'openai-gpt-6-luna', 'anthropic-sonnet-5-5', 'claude-code-cli', 'codex-cli'], 'cheapest first');
  const luna = find(sheet, node => node.dataset.preset === 'openai-gpt-6-luna');
  assert.ok(text(luna).includes('unverified'));
  const model = control(luna, 'Model id, as your account shows it');
  assert.equal(model.value, 'gpt-6-luna');
  await type(model, 'gpt-6-luna-2026');
  const lunaKey = find(luna, node => node.tagName === 'input' && node.attributes.type === 'password');
  assert.equal(ancestors(lunaKey).some(node => node.tagName === 'form'), false);
  await type(lunaKey, 'sk-openai-demo-000000000000000000');
  await tick(find(luna, node => node.tagName === 'input' && node.attributes.type === 'checkbox'));
  await click(button(luna, 'Connect'));
  assert.deepEqual(h.calls.filter(call => call.method === 'venture.models.connect').at(-1)!.payload, { presetId: 'openai-gpt-6-luna', consentDigest: F.presets[2].consentDigest, apiKey: 'sk-openai-demo-000000000000000000', model: 'gpt-6-luna-2026' });
  assert.equal(lunaKey.value, '');

  const claude = find(sheet, node => node.dataset.preset === 'claude-code-cli');
  assert.ok(text(claude).includes('Uses your own sign-in on this computer.'));
  assert.ok(buttons(claude, 'Check and connect').length === 1);
  await click(button(find(sheet, node => node.dataset.preset === 'built-in-templates'), 'Keep using templates'));
  assert.deepEqual(h.calls.filter(call => call.method === 'venture.models.connect').at(-1)!.payload, { presetId: 'built-in-templates', consentDigest: F.presets[5].consentDigest });
  assert.equal(h.rejected.length, 0);
});

test('while the Claude Code terms gate is closed, the Add your AI sheet says why and offers no Check and connect', async () => {
  const h = await place('today', { overrides: { 'venture.models.presets': () => O.presets } });
  await click(button(h.content, 'Add your AI (optional)'));
  const claude = find(openDialog(h.body), node => node.dataset.preset === 'claude-code-cli');
  assert.ok(text(claude).includes('needs setup'), 'the row reads needs setup');
  assert.ok(text(claude).includes("Chausar hasn't yet accepted Anthropic's terms for running Claude Code."), 'the terms words');
  assert.equal(buttons(claude, 'Check and connect').length, 0, 'no connect control while the gate is closed');
});

test('Add your AI says beside ready that the Anthropic rows were not checked with a live key, once', async () => {
  const LIVE = 'Not yet checked with a live key.';
  const noted = (preset: ModelPreset): ModelPreset => ({
    ...preset,
    verificationNote: preset.verification === 'built-in' ? null : preset.needsKey ? LIVE : 'Not yet checked on a real task.',
    availabilityReason: preset.id.startsWith('anthropic-') ? `Uses your Anthropic key. ${LIVE}` : preset.availabilityReason,
  });
  const h = await place('today', { overrides: { 'venture.models.presets': () => F.presets.map(noted) } });
  await click(button(h.content, 'Add your AI (optional)'));
  const sheet = openDialog(h.body);
  for (const id of ['anthropic-haiku-5-5', 'anthropic-sonnet-5-5']) {
    const summary = find(find(sheet, node => node.dataset.preset === id), node => node.tagName === 'summary');
    const parts = summary.children.filter(node => node.tagName !== '#text').map(node => node.textContent);
    assert.deepEqual(parts.slice(1), ['ready', LIVE, 'Uses your Anthropic key.'], `${id}: the note sits beside ready and shows once`);
  }
  const recommended = find(sheet, node => node.dataset.preset === 'recommended');
  assert.ok(text(recommended).includes(LIVE), 'the recommended pair says it too');
  const luna = find(find(sheet, node => node.dataset.preset === 'openai-gpt-6-luna'), node => node.tagName === 'summary');
  assert.equal(text(luna).includes(LIVE), false, 'an unverified row already says why in its own words');
  const templates = find(find(sheet, node => node.dataset.preset === 'built-in-templates'), node => node.tagName === 'summary');
  assert.equal(/Not yet/.test(text(templates)), false, 'the built-in templates need no such note');
});

// ---------------------------------------------------------------------------------------------
// 5 and 6: the plan with receipts, and Build
// ---------------------------------------------------------------------------------------------
test('the plan shows the receipt display exactly, opens the receipt, and accepts the exact digest', async () => {
  const h = await place('business', { blueprint: 'draft' });
  const figure = find(h.content, node => node.className === 'launch-fig-btn');
  assert.equal(figure.textContent, 'INR 2,948.82');
  assert.equal(figure.textContent, F.offerReceipt.figures.find(item => item.key === 'total')!.display);
  await click(figure);
  const sheet = openDialog(h.body);
  for (const words of ['GST at 18%', 'INR 449.82', F.offerReceipt.explanation, 'unit price times quantity']) assert.ok(text(sheet).includes(words), words);
  await click(button(sheet, 'Close'));
  assert.ok(text(h.content).includes('For a tax invoice, add: Your GSTIN, Your state, Your SAC code.'));
  await click(button(h.content, 'Accept plan'));
  assert.deepEqual(h.calls.find(call => call.method === 'venture.blueprint.accept')!.payload, { digest: F.blueprintDraftView.blueprint.digest });
  assert.equal(h.renderer.state.page, 'build');
  for (const banned of ['parseFloat', 'toFixed', 'BigInt']) assert.equal(launchSource.includes(banned), false, `launch.js must not contain ${banned}`);
});

test('tax invoice details send only what changed and price the plan again', async () => {
  const h = await place('business', { blueprint: 'draft' });
  await click(button(h.content, 'Add them'));
  const sheet = openDialog(h.body);
  const states = descendants(control(sheet, 'Your state')).filter(node => node.tagName === 'option').map(node => node.textContent);
  assert.deepEqual(states.slice(0, 3), ['From your GSTIN', 'Andaman and Nicobar Islands (35)', 'Andhra Pradesh (37)'], 'states sorted by name');
  assert.equal(states.length, Object.keys(INDIA_STATES).length + 1);
  await type(control(sheet, 'Your GSTIN'), '27ZZZZZ9999Z1Z8');
  await type(control(sheet, 'Your SAC code'), '998222');
  await click(button(sheet, 'Save'));
  assert.deepEqual(h.calls.find(call => call.method === 'venture.blueprint.update')!.payload, { patch: { taxId: '27ZZZZZ9999Z1Z8', sacCode: '998222' } });
  assert.ok(h.after('venture.blueprint.update').some(call => call.method === 'venture.blueprint.get'), 'the plan is read again after the change');
});

test('Build shows the brief first and opens Lovable only through the link opener, then marks it opened', async () => {
  const h = await place('build');
  const nodes = descendants(h.content);
  const opening = nodes.findIndex(node => node.className === 'launch-brief');
  const lovable = nodes.findIndex(node => node.tagName === 'button' && node.textContent === 'Open in Lovable');
  assert.ok(opening >= 0 && lovable > opening, 'brief text comes before the Open buttons');
  assert.match(nodes[opening].textContent, /A calm site for a bookkeeping studio/);
  assert.ok(text(h.content).includes('Replit receives the brief when its page opens.'));
  assert.ok(visibleText(h.content).includes('Replit receives the brief when its page opens.'), 'the Replit note shows at rest, before any click');
  await click(nodes[lovable]);
  const handoff = h.calls.findIndex(call => call.method === 'venture.build.handoff');
  assert.deepEqual(h.calls[handoff].payload, { builder: 'lovable' });
  assert.deepEqual(h.opened, [new URL(F.handoffPlans.lovable.url).href]);
  assert.deepEqual(h.calls[handoff + 1], { method: 'venture.build.handoffOpened', payload: { handoffId: 'vho_lovable' } });
  assert.ok(text(h.content).includes('Lovable keeps your brief in this browser until you press send.'), 'the plan notes show under the buttons');
});

test('a refused link never marks the builder opened', async () => {
  const failing = await place('build', {}, { openExternal: () => { throw Object.assign(new Error('The system browser refused.'), { code: 'OPEN_FAILED' }); } });
  await click(button(failing.content, 'Open in Lovable'));
  assert.equal(failing.calls.some(call => call.method === 'venture.build.handoffOpened'), false);
  assert.ok(text(failing.content).includes('The system browser refused.'));

  for (const url of ['http://lovable.dev/#prompt=x', 'https://user:secret@lovable.dev/#prompt=x', 'https://lovable.example/#prompt=x']) {
    const h = await place('build', { overrides: { 'venture.build.handoff': () => ({ ...F.handoffPlans.lovable, url }) } });
    await click(button(h.content, 'Open in Lovable'));
    assert.equal(h.externalInvokes.length, 0, `${url} is refused before any call`);
    assert.equal(h.calls.some(call => call.method === 'venture.build.handoffOpened'), false);
    assert.match(text(h.content), /Use one partner link\.|Chausar opens only its listed partner sites\./);
  }
  const h = await harness();
  await assert.rejects(h.renderer.openExternal('http://lovable.dev/'), { code: 'INVALID_EXTERNAL_URL' });
  await assert.rejects(h.renderer.openExternal('https://a:b@github.com/'), { code: 'INVALID_EXTERNAL_URL' });
  await assert.rejects(h.renderer.openExternal('https://example.com/'), { code: 'EXTERNAL_URL_NOT_ALLOWED' });
  assert.equal(h.externalInvokes.length, 0);
  await h.renderer.openExternal('https://razorpay.com/');
  assert.deepEqual(h.opened, ['https://razorpay.com/']);
});

test('in a paired browser, Open in Lovable opens the tab inside the click, before any request, then sends the link there', async () => {
  const tab = makeTab();
  const h = await place('build', {}, { browser: { open: () => tab } });
  assert.ok(text(h.content).includes('Hand your brief') || text(h.content).includes('Open in Lovable'), 'the build place loaded over /api/rpc');
  const before = h.calls.length;
  await click(button(h.content, 'Open in Lovable'));
  assert.deepEqual(h.opens.map(item => item.args), [['', '_blank']]);
  assert.equal(h.opens[0].callsBefore, before, 'the tab opens before venture.build.handoff is asked for');
  assert.equal(tab.opener, null, 'the builder page gets no handle back to Chausar');
  assert.equal(tab.url, new URL(F.handoffPlans.lovable.url).href);
  assert.equal(tab.closed, false);
  assert.deepEqual(h.calls.slice(before), [{ method: 'venture.build.handoff', payload: { builder: 'lovable' } }, { method: 'venture.build.handoffOpened', payload: { handoffId: 'vho_lovable' } }]);
  assert.ok(text(h.content).includes('Lovable opened in your browser.'));

  const cards = await place('connections', {}, { browser: { open: () => makeTab() } });
  await click(button(find(cards.content, node => node.dataset.connector === 'bolt'), 'Open'));
  assert.equal(cards.opens.length, 0, 'a copy handoff opens no tab');
  await click(button(find(cards.content, node => node.dataset.connector === 'razorpay'), 'Visit site'));
  assert.equal(cards.opens.length, 0, 'a vendor page opens from the click itself, with no waiting first');
  const visit = cards.anchors.find(node => node.attributes.href === 'https://razorpay.com/');
  assert.ok(visit, 'the vendor page opened through a temporary link');
  assert.equal(visit.attributes.target, '_blank');
  assert.equal(visit.attributes.rel, 'noopener noreferrer');
});

test('in a paired browser, a blocked tab sends nothing, and a failed handoff or a refused link closes the tab and sends nothing', async () => {
  const blocked = await place('build', {}, { browser: { open: () => null } });
  const before = blocked.calls.length;
  await click(button(blocked.content, 'Open in Lovable'));
  assert.equal(blocked.calls.length, before, 'no request at all');
  assert.ok(text(blocked.content).includes('Your browser blocked the new tab. Allow pop-ups for Chausar and try again.'));

  const failingTab = makeTab();
  const failing = await place('build', { overrides: { 'venture.build.handoff': () => { throw Object.assign(new Error('Write the brief again first.'), { code: 'BRIEF_STALE' }); } } }, { browser: { open: () => failingTab } });
  await click(button(failing.content, 'Open in Lovable'));
  assert.equal(failingTab.closed, true, 'the empty tab is closed');
  assert.equal(failingTab.url, null);
  assert.equal(failing.calls.some(call => call.method === 'venture.build.handoffOpened'), false);
  assert.ok(text(failing.content).includes('Write the brief again first.'));

  const refusedTab = makeTab();
  const refused = await place('build', { overrides: { 'venture.build.handoff': () => ({ ...F.handoffPlans.lovable, url: 'https://lovable.example/#prompt=x' }) } }, { browser: { open: () => refusedTab } });
  await click(button(refused.content, 'Open in Lovable'));
  assert.equal(refusedTab.closed, true);
  assert.equal(refusedTab.url, null, 'an unlisted site never loads');
  assert.equal(refused.calls.some(call => call.method === 'venture.build.handoffOpened'), false);
  assert.ok(text(refused.content).includes('Chausar opens only its listed partner sites.'));
});

test('Bolt on Connections copies the brief, then marks the handoff opened; a failed copy sends nothing', async () => {
  const h = await place('connections');
  const bolt = find(h.content, node => node.dataset.connector === 'bolt');
  await click(button(bolt, 'Open'));
  assert.deepEqual(h.clipboard, [F.handoffPlans.bolt.clipboardText]);
  assert.deepEqual(h.calls.filter(call => call.method.startsWith('venture.build.')).map(call => call.method), ['venture.build.handoff', 'venture.build.handoffOpened']);
  assert.equal(h.externalInvokes.length, 0, 'copy mode opens nothing');

  const noClipboard = await place('connections', {}, { clipboard: false });
  await click(button(find(noClipboard.content, node => node.dataset.connector === 'bolt'), 'Open'));
  assert.equal(noClipboard.calls.some(call => call.method === 'venture.build.handoffOpened'), false);
  assert.ok(text(noClipboard.content).includes('This window cannot copy. Use Save instead.'));

  const refused = await place('connections', {}, { clipboard: 'refuse' });
  const refusedBolt = find(refused.content, node => node.dataset.connector === 'bolt');
  await click(button(refusedBolt, 'Open'));
  assert.equal(refused.calls.some(call => call.method === 'venture.build.handoffOpened'), false);
  assert.ok(text(refused.content).includes('This window could not copy. Use Save instead.'), 'a refused copy is told in plain words');
  assert.equal(text(refused.content).includes('writeText'), false);
  await click(button(refusedBolt, 'Save brief'));
  assert.deepEqual(refused.saved(), [{ filename: 'brief.md', type: 'text/markdown', text: F.handoffPlans.bolt.clipboardText }], 'the card offers Save beside the refused copy');
  assert.equal(refused.calls.some(call => call.method === 'venture.build.handoffOpened'), false, 'saving is not opening');

  const visit = await place('connections');
  await click(button(find(visit.content, node => node.dataset.connector === 'razorpay'), 'Visit site'));
  assert.deepEqual(visit.opened, ['https://razorpay.com/']);
  assert.equal(buttons(find(visit.content, node => node.dataset.connector === 'razorpay'), 'Open').length, 0, 'a planned chip has no button of its own');
  assert.equal(buttons(find(visit.content, node => node.dataset.connector === 'mail-app'), 'Open').length, 0, 'the mail app has no button');
});

test('following GitHub sends the repo and key from outside any form, clears the key, then reads GitHub', async () => {
  const h = await place('build', { build: 'unfollowed' });
  const key = find(h.content, node => node.tagName === 'input' && node.attributes.type === 'password');
  assert.equal(key.attributes.autocomplete, 'off');
  assert.equal(ancestors(key).some(node => node.tagName === 'form'), false, 'the token field is outside any form');
  assert.ok(text(h.content).includes('Choose Only select repositories, then pick this one repo.'));
  await type(control(h.content, 'Your app repo on GitHub'), 'demo-owner/ledger-cafe-books');
  await type(key, 'github_pat_demo_0000000000000000');
  await click(button(h.content, 'Follow'));
  const link = h.calls.findIndex(call => call.method === 'venture.build.link');
  assert.deepEqual(h.calls[link].payload, { repo: 'demo-owner/ledger-cafe-books', token: 'github_pat_demo_0000000000000000' });
  assert.deepEqual(h.calls[link + 1], { method: 'venture.build.sync', payload: {} });
  assert.equal(key.value, '');
  await click(button(h.content, 'Create a read-only key'));
  assert.deepEqual(h.opened, [new URL(F.buildStatus.tokenLink).href]);
});

test('the followed build shows status words, whose account changed it, and the synthetic recording line', async () => {
  const h = await place('build');
  for (const words of ['Repo connected', 'Last change: Add the services page. By Lovable', 'Brief marker found. UI check passed.', 'These answers come from a synthetic recording, not your real repo.', "What Chausar can't see", 'Check GitHub now']) assert.ok(text(h.content).includes(words), words);
  assert.equal(descendants(h.content).some(node => node.tagName === 'a'), false, 'no links are drawn from engine data');
  // The brief and GitHub both answer from recordings here, so one line at rest says so for the page.
  const atRest = visibleText(h.content);
  assert.equal(atRest.filter(words => words === BOTH_RECORDED).length, 1, 'one recording line at rest');
  assert.equal(atRest.includes(RECORDING), false, 'not a second line for the brief');
  assert.ok(atRest.includes('Repo connected') && atRest.includes('Details'), 'the state word at rest, the rest one fold away');

  // GitHub alone answering from a recording keeps its own words at rest.
  const live = { ...F.modelsConnected, replay: { active: false, label: null } };
  const githubOnly = await place('build', { overrides: { 'venture.models.status': () => live } });
  assert.ok(visibleText(githubOnly.content).includes('These answers come from a synthetic recording, not your real repo.'));
  assert.equal(text(githubOnly.content).includes(BOTH_RECORDED), false);
  await click(button(h.content, 'Check GitHub now'));
  assert.ok(h.calls.some(call => call.method === 'venture.build.sync'));
});

// ---------------------------------------------------------------------------------------------
// 7 and 8: the shell, and engine text staying text
// ---------------------------------------------------------------------------------------------
test('the shell draws seven launch places, then the twelve back office views under one group', async () => {
  const h = await place('today');
  const nav = find(h.app, node => node.tagName === 'nav');
  const pageButtons = descendants(nav).filter(node => node.tagName === 'button' && node.dataset.page);
  assert.deepEqual(pageButtons.slice(0, 7).map(node => node.dataset.page), LAUNCH_IDS);
  const group = find(nav, node => node.tagName === 'details' && node.className === 'nav-group');
  assert.equal(group.children[0].textContent, 'Back office');
  assert.deepEqual(descendants(group).filter(node => node.tagName === 'button' && node.dataset.page).map(node => node.dataset.page), BACK_OFFICE_IDS);
  assert.equal(LAUNCH_IDS.some(id => BACK_OFFICE_IDS.includes(id)), false, 'no id collision');
  assert.deepEqual([...h.renderer.launch.pages.map((entry: string[]) => entry[0])], LAUNCH_IDS);
  assert.equal(find(h.app, node => node.className === 'avatar').textContent, 'L');
  assert.equal(find(h.app, node => node.id === 'current-page').textContent, 'Today');
  assert.equal(find(h.app, node => node.id === 'shell').classList.contains('on-launch'), true);
  assert.equal(group.open, false, 'the back office starts closed on a launch place');

  await h.renderer.navigate('models'); await flush();
  assert.equal(find(h.app, node => node.id === 'shell').classList.contains('on-launch'), false);
  assert.equal(find(h.app, node => node.id === 'current-page').textContent, 'Models');
  assert.equal(find(h.app, node => node.tagName === 'details' && node.className === 'nav-group').open, true, 'the back office group opens for a back office view');
  const models = find(h.app, node => node.id === 'page-content');
  assert.ok(text(models).includes("Your business's AI connections"));
  assert.ok(text(models).includes('They follow your send setting on Trust & access.'));
  assert.ok(text(models).includes('claude-haiku-5-5') && text(models).includes('quick work'));
  assert.ok(text(models).includes('claude-sonnet-5-5') && text(models).includes('plans and drafts'));
  h.renderer.renderShell(); await flush();
  assert.equal(find(h.app, node => node.tagName === 'details' && node.className === 'nav-group').open, true, 'opens when a back office view is current');
});

test('engine text such as an img tag stays a text node', async () => {
  const unsafe = { ...F.preview, oneLiner: { ...F.preview.oneLiner, value: F.UNSAFE_TEXT }, serviceLabel: F.UNSAFE_TEXT };
  const engine = await withoutAi({ overrides: { 'venture.preview': () => unsafe } });
  await builtInPlan(engine, F.UNSAFE_TEXT);
  assert.ok(descendants(engine.app).filter(node => node.tagName === '#text' && node.textContent === F.UNSAFE_TEXT).length >= 2);
  assert.equal(descendants(engine.app).some(node => node.tagName === 'img' && node.attributes.src !== './assets/icon.svg'), false, 'only the brand mark is an image');
  const build = await place('build');
  assert.ok(text(build.content).includes(F.UNSAFE_TEXT), 'brief text containing markup is shown as text');
  assert.equal(descendants(build.content).some(node => node.tagName === 'img'), false, 'only the app icon is an image');
});

// ---------------------------------------------------------------------------------------------
// 9: static checks
// ---------------------------------------------------------------------------------------------
test('launch.js and the launch styles follow the house rules', () => {
  const launchCss = cssSource.slice(cssSource.indexOf('/* launch'));
  assert.ok(launchCss.length > 1000, 'the launch section is appended to styles.css');
  for (const [name, source] of [['launch.js', launchSource], ['launch css', launchCss]] as const) {
    assert.equal(source.includes(String.fromCharCode(0x2014)), false, `${name}: no em dash`);
    assert.deepEqual(houseStyleFindings(source), [], `${name}: no banned words`);
  }
  for (const banned of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'eval(', 'new Function', 'localStorage', 'sessionStorage', 'document.write']) assert.equal(launchSource.includes(banned), false, banned);
  assert.equal(/^\s*(import|export)\s/m.test(launchSource), false, 'classic script');
  assert.equal(cssSource.includes('infinite'), false, 'nothing loops');
  for (const match of launchCss.matchAll(/(\d*\.?\d+)(ms|s)\b/g)) {
    const ms = match[2] === 's' ? Number(match[1]) * 1000 : Number(match[1]);
    assert.ok(ms <= 400, `duration ${match[0]} is over 400 ms`);
  }
  for (const match of launchCss.matchAll(/animation(?:-iteration-count)?:([^;}]+)/g)) {
    for (const token of match[1].trim().split(/\s+/)) if (/^\d+$/.test(token)) assert.equal(token, '1', 'animations run once');
  }
  assert.match(launchCss, /prefers-reduced-motion:reduce\)\{[^}]*0ms/);
  assert.match(launchCss, /prefers-reduced-motion:reduce\)\{\.ob-root \*,/, 'the reduced-motion rule covers look B');
  assert.match(launchCss, /prefers-color-scheme:dark/);
  // Look B sets geometry by attributes and colour by classes: the CSP allows no inline style.
  for (const banned of ['.style', "setAttribute('style'", 'style=']) assert.equal(launchSource.includes(banned), false, `launch.js: ${banned}`);
  assert.match(indexSource, /<meta name="color-scheme" content="light dark">/, 'index.html offers light and dark');
  assert.equal(/\.loading:before\{[^}]*animation/.test(cssSource), false, 'the spinner is a still mark');
});

test('the renderer copies of the contract lists match the contracts', async () => {
  const h = await harness();
  for (const method of EVIDENCE_METHODS) assert.ok(h.renderer.evidenceChanges.includes(method), `${method} is in evidenceChanges`);
  assert.deepEqual(JSON.parse(JSON.stringify(h.renderer.EXTERNAL_ORIGINS)), [...EXTERNAL_ORIGINS]);
  const states = Object.fromEntries([...launchSource.slice(launchSource.indexOf('const INDIA_STATES')).split('});')[0].matchAll(/'(\d\d)': '([^']+)'/g)].map(match => [match[1], match[2]]));
  assert.deepEqual(states, { ...INDIA_STATES });
});

test('launch.js does nothing when it loads and defines one frozen factory', () => {
  const sandbox: Record<string, unknown> = {};
  vm.runInNewContext(launchSource, sandbox, { filename: 'launch.js' });
  const factory = sandbox.ChausarLaunch as { version: number; create: unknown };
  assert.equal(Object.isFrozen(factory), true);
  assert.equal(factory.version, 1);
  assert.equal(typeof factory.create, 'function');
  assert.deepEqual(Object.keys(sandbox), ['ChausarLaunch']);
});

test('without launch.js the app keeps its old setup screen and shell', async () => {
  const body = new Element('body'), app = new Element('div'), notifications = new Element('div');
  app.id = 'app'; notifications.id = 'notifications'; body.append(app, notifications);
  const document = {
    body, createElement: (tag: string) => new Element(tag), createTextNode: (value: unknown) => { const node = new Element('#text'); node.textContent = String(value); return node; },
    createElementNS: (_namespace: string, tag: string) => new Element(tag), getElementById: (id: string) => descendants(body).find(node => node.id === id) ?? null, querySelectorAll: (selector: string) => body.querySelectorAll(selector),
  };
  const context = vm.createContext({ document, Node: Element, crypto: { randomUUID }, URL, URLSearchParams, structuredClone, console, setTimeout: () => 0, clearTimeout() {}, window: { chausar: { request: async () => ({}) }, location: { origin: 'chausar://app', hash: '', pathname: '/index.html', search: '' }, history: { replaceState() {} }, addEventListener() {} } });
  vm.runInContext(appSource.replace(/\bboot\(\);\s*$/, '') + '\n;globalThis.__plain = { launch, applyWorkspaceStatus, state };', context);
  const plain = context.__plain;
  assert.equal(plain.launch, null);
  plain.applyWorkspaceStatus({ open: false });
  assert.ok(text(app).includes('Welcome to Chausar.'), 'the old vault form');
  plain.state.workspace = { name: 'Kiran Retail Demo' };
  plain.applyWorkspaceStatus({ open: true, workspace: { name: 'Kiran Retail Demo' } }); await flush();
  const nav = find(app, node => node.tagName === 'nav');
  assert.deepEqual(descendants(nav).filter(node => node.tagName === 'button' && node.dataset.page).map(node => node.dataset.page), BACK_OFFICE_IDS);
  assert.equal(descendants(nav).some(node => node.tagName === 'details'), false);
});

// ---------------------------------------------------------------------------------------------
// 10: words at rest
// ---------------------------------------------------------------------------------------------
/**
 * Words at rest with the fixtures, as counted on 16 October after the second pass. The founder's taste is 35 to 45
 * words on a screen at rest, 60 at most; each place may not grow past its count here without a reason.
 * Agents grew from 52 to 56 on 16 October with the delivery harness screens: one folded line, "Improvement: not due
 * yet", says whether the improvement loop is due. A client's files show only inside the opened order.
 */
const WORDS_AT_REST: Record<string, number> = { today: 50, business: 52, build: 55, clients: 20, agents: 56, money: 57, connections: 31 };
const WORDS_CEILING = 60;

test('each of the seven places stays at its recorded words at rest, 60 at most, with one filled button at most', async t => {
  for (const id of LAUNCH_IDS) {
    const h = await place(id);
    const words = wordCount(h.content);
    t.diagnostic(`${id}: ${words} words at rest`);
    if (process.env.P7_SHOW_WORDS) t.diagnostic(visibleText(h.content).join(' ').replace(/\s+/g, ' '));
    assert.ok(words > 10, `${id} rendered (${words} words)`);
    assert.ok(WORDS_AT_REST[id] <= WORDS_CEILING, `${id}: the recorded count is under the ceiling`);
    assert.ok(words <= WORDS_AT_REST[id], `${id} shows ${words} words at rest, more than ${WORDS_AT_REST[id]}: ${visibleText(h.content).join(' ').replace(/\s+/g, ' ')}`);
    assert.ok(descendants(h.content).filter(node => node.className === 'launch-btn').length <= 1, `${id}: one filled button at most`);
    assert.equal(text(h.content).includes('The engine could not load this view'), false, `${id} loaded`);
    assert.equal(descendants(h.content).some(node => node.className === 'footer-note'), false, `${id}: no back office footer`);
  }
});

// ---------------------------------------------------------------------------------------------
// 11: agents, long requests, practice drafts, outlines, money notices
// ---------------------------------------------------------------------------------------------
test('Rehearse runs one practice client per request and recovers a timed-out run from the stored result', async () => {
  let runs = 0;
  const h = await place('agents', { overrides: {
    'venture.simulation.run': (_method, payload) => {
      runs++;
      if (runs === 2) throw Object.assign(new Error('The engine did not answer in time.'), { code: 'REQUEST_TIMEOUT' });
      return F.simulationRun(payload.scenarioIds[0]);
    },
  } });
  await click(button(h.content, 'Rehearse')); await flush();
  const simulationCalls = h.calls.filter(call => call.method === 'venture.simulation.run');
  assert.deepEqual(simulationCalls.map(call => call.payload), F.scenarios.map(item => ({ scenarioIds: [item.id] })));
  const afterTimeout = h.calls.slice(h.calls.indexOf(simulationCalls[1]) + 1);
  assert.equal(afterTimeout[0].method, 'venture.launch.status');
  assert.deepEqual(afterTimeout[1], { method: 'venture.simulation.get', payload: { runId: 'vsr_bookkeeping-messy' } });
  const messy = find(h.content, node => node.dataset.scenario === 'bookkeeping-messy');
  assert.match(text(messy), /A messy client.*passed/);
  assert.ok(text(messy).includes('USD 0.0021'));
  assert.equal(text(h.content).includes('did not answer in time'), false, 'a timeout is not shown as a failure');
  assert.equal(text(h.content).includes('Still working'), false);
});

test('template rehearsal says it was not judged, and the ladder shows the blocked reason and planned stages', async () => {
  const h = await place('agents', { models: 'templates', overrides: {
    'venture.launch.status': () => F.launchStatusRehearsal,
    'venture.simulation.run': (_method, payload) => F.simulationRun(payload.scenarioIds[0], { modelMode: 'template' }),
  } });
  assert.ok(text(h.content).includes("Connect an AI and rehearse with it first. Template outlines can't be judged."));
  assert.equal(descendants(h.content).filter(node => node.tagName === 'button' && /^Move to/.test(node.textContent)).length, 0);
  const ladder = find(h.content, node => node.className === 'launch-ladder');
  assert.equal(descendants(ladder).filter(node => node.className === 'launch-row-note' && node.textContent === 'planned').length, 2);
  assert.ok(text(h.content).includes('No AI connected. Built-in templates write outlines.'));
  await click(button(h.content, 'Rehearse')); await flush();
  assert.equal(descendants(h.content).filter(node => node.tagName === 'p' && node.textContent === 'Template outline, not judged').length, 3);
});

test('a shadow stage offers one move to the next stage', async () => {
  const h = await place('agents');
  await click(button(h.content, 'Move to approve each draft'));
  assert.deepEqual(h.calls.find(call => call.method === 'venture.launch.advance')!.payload, { to: 'approve-each' });
});

test('a waiting draft shows the exact payload and sends it once after the box is ticked', async () => {
  const live = { ...F.modelsConnected, replay: { active: false, label: null } };
  const h = await place('agents', { overrides: { 'venture.models.status': () => live } });
  await openDraft(h.content, /to approve/);
  const sheet = openDialog(h.body);
  assert.ok(text(sheet).includes('This is exactly what will be sent to Claude Sonnet 5.5'));
  assert.equal(text(sheet).includes(RECORDING), false, 'no recording line when real calls are made');
  assert.ok(text(sheet).includes('Send this exact text once.'));
  assert.ok(text(sheet).includes(F.waitingRun.preview!.payloadText));
  const approve = button(sheet, 'Approve and send');
  assert.equal(approve.disabled, true);
  await tick(find(sheet, node => node.tagName === 'input' && node.attributes.type === 'checkbox'));
  await click(approve);
  assert.deepEqual(h.calls.filter(call => call.method === 'venture.delivery.approve').map(call => call.payload), [{ runId: 'vdr_wait', digest: F.waitingRun.preview!.digest }]);
  assert.ok(text(sheet).includes('Practice draft. Not for the client.'), 'the result appears where the action was');
  assert.equal(text(sheet).includes(RECORDING), false);
});

test('in a demo with recordings, a draft reply opened from Clients says a synthetic recording answers, waiting and ready', async () => {
  let release: () => void = () => {};
  const pending = new Promise<void>(accept => { release = accept; });
  const h = await place('clients', { overrides: { 'venture.delivery.approve': async () => { await pending; return F.practiceRun; } } }, { timers: true });
  await click(button(h.content, 'Draft a reply'));
  const sheet = openDialog(h.body);
  const recordingBefore = (tag: string) => {
    const nodes = descendants(sheet);
    const line = nodes.findIndex(node => node.tagName === 'p' && node.textContent === RECORDING);
    const target = nodes.findIndex(node => node.tagName === tag);
    assert.ok(line >= 0, 'the recording line is on the sheet');
    assert.ok(target > line, `the recording line sits above the ${tag}`);
  };
  recordingBefore('pre');
  assert.ok(text(sheet).includes('This is exactly what Chausar would send to Claude Sonnet 5.5. In this demo a synthetic recording answers instead.'));
  assert.equal(text(sheet).includes('will be sent to'), false, 'nothing claims a send to the model in a demo');
  assert.ok(text(sheet).includes('Approve this exact text once.'));
  assert.ok(text(sheet).includes(F.waitingRun.preview!.payloadText));

  await tick(find(sheet, node => node.tagName === 'input' && node.attributes.type === 'checkbox'));
  void button(sheet, 'Approve and send').dispatch('click'); await flush();
  assert.ok(text(sheet).includes('Writing a draft reply from a synthetic recording'));
  assert.equal(text(sheet).includes('with Claude Sonnet 5.5'), false);
  release(); await flush(12);
  assert.ok(text(sheet).includes('Practice draft. Not for the client.'), 'the ready draft is shown where the action was');
  recordingBefore('pre');

  const outline = await place('agents');
  await openDraft(outline.content, /outline/);
  assert.equal(text(openDialog(outline.body)).includes(RECORDING), false, 'a template outline had no AI, so no recording line');
});

test('in a demo with recordings, rewriting the plan says a synthetic recording writes it', async () => {
  let release: () => void = () => {};
  const pending = new Promise<void>(accept => { release = accept; });
  const h = await place('business', { blueprint: 'draft', overrides: { 'venture.blueprint.draft': async () => { await pending; return F.blueprintDraftView; } } }, { timers: true });
  void button(h.content, 'Rewrite with AI').dispatch('click'); await flush();
  assert.ok(text(h.content).includes('Writing your plan from a synthetic recording'));
  assert.equal(text(h.content).includes('with Claude Sonnet 5.5'), false);
  release(); await flush(12);
  assert.ok(text(h.content).includes('Accept plan'));
});

test('an approval that times out re-reads the stored draft instead of showing an error', async () => {
  const timeout = () => { throw Object.assign(new Error('The engine did not answer in time.'), { code: 'REQUEST_TIMEOUT' }); };
  const approveTimedOut = async (list?: () => unknown, onApprove?: () => void) => {
    const h = await place('agents', { overrides: { 'venture.delivery.approve': () => { onApprove?.(); return timeout(); }, ...(list ? { 'venture.delivery.list': list } : {}) } });
    await openDraft(h.content, /to approve/);
    const sheet = openDialog(h.body);
    await tick(find(sheet, node => node.tagName === 'input' && node.attributes.type === 'checkbox'));
    await click(button(sheet, 'Approve and send'));
    assert.equal(h.calls.at(-1)!.method, 'venture.delivery.list');
    assert.equal(text(sheet).includes('did not answer in time'), false);
    return sheet;
  };
  let approved = false;
  const stored = await approveTimedOut(() => (approved ? [{ ...F.practiceRun, id: 'vdr_wait' }, F.outlineRun] : [F.waitingRun, F.practiceRun]), () => { approved = true; });
  assert.ok(text(stored).includes('Practice draft. Not for the client.'), 'the stored draft is shown');
  assert.ok(text(stored).includes('Total: INR 2,948.82'));
  const stillWaiting = await approveTimedOut();
  assert.ok(text(stillWaiting).includes('Still working. Check again in a minute.'), 'the run is still waiting, so the screen says so');
  assert.equal(buttons(stillWaiting, 'Check again').length, 1);
});

test('a practice draft cannot be accepted, copied or saved; a template outline says no AI wrote it', async () => {
  const h = await place('agents');
  await openDraft(h.content, /to review, practice/);
  let sheet = openDialog(h.body);
  assert.ok(text(sheet).includes('Practice draft. Not for the client.'));
  for (const label of ['Accept', 'Copy', 'Save']) assert.equal(buttons(sheet, label).length, 0, `no ${label} on a practice draft`);
  assert.equal(buttons(sheet, 'Edit').length, 1);
  assert.equal(buttons(sheet, 'Reject').length, 1);
  await click(button(sheet, 'Close'));

  await openDraft(h.content, /outline/);
  sheet = openDialog(h.body);
  assert.ok(text(sheet).includes("Template outline. No AI wrote this and it doesn't read the client's request."));
  await click(button(sheet, 'Accept'));
  assert.deepEqual(h.calls.find(call => call.method === 'venture.delivery.review')!.payload, { runId: 'vdr_outline', verdict: 'accepted' });
  assert.equal(buttons(sheet, 'Copy').length, 1, 'an accepted draft can be copied');
});

test('the kept plan names the payment links honestly and writes tax names in plain case', async () => {
  const draft = F.blueprintDraftView.blueprint;
  const salesTax = { ...F.blueprintDraftView, offerReceipts: {}, blueprint: { ...draft, backOffice: { ...draft.backOffice, taxLabel: 'Sales tax', taxRegistered: { value: false, label: 'told-by-you' as const, by: 'owner' as const }, paymentRail: 'stripe' } } };
  const h = await place('business', { blueprint: 'draft', overrides: { 'venture.blueprint.get': () => salesTax } });
  await click(find(h.content, node => node.tagName === 'summary' && node.textContent === 'Back office'));
  assert.ok(text(h.content).includes('Tax: not registered for sales tax.'));
  assert.ok(text(h.content).includes('Clients pay through Stripe links on your site, and you record each payment here.'));
  assert.equal(text(h.content).includes('Payments by'), false);
});

test('a draft with a failed check offers Edit and Reject, not Accept', async () => {
  const failed: DeliveryRunRecord = { ...F.outlineRun, id: 'vdr_failed', checks: [{ check: 'required-sections', passed: false, detail: 'The Next steps section is missing.' }] };
  const h = await place('agents', { overrides: { 'venture.delivery.list': () => [failed] } });
  await openDraft(h.content, /outline/);
  const sheet = openDialog(h.body);
  assert.equal(buttons(sheet, 'Accept').length, 0, 'the engine refuses Accept after a failed check, so the sheet does not offer it');
  assert.equal(buttons(sheet, 'Edit').length, 1);
  assert.equal(buttons(sheet, 'Reject').length, 1);
  assert.ok(text(sheet).includes("A check failed, so this draft can't be accepted as it is. Edit it or reject it."));
  assert.ok(text(sheet).includes('The Next steps section is missing.'));
});

test('the money place and the invoice sheet show the experimental notice; issuing names the exact total', async () => {
  const money = await place('money');
  assert.ok(text(money.content).includes(EXPERIMENTAL));
  assert.ok(text(money.content).includes('Billed and earned leave out tax. Received is the cash that came in, tax included.'));
  for (const display of ['INR 2,499.00', 'INR 2,948.82']) assert.ok(text(money.content).includes(display));
  await click(button(money.content, 'INR 2,499.00'));
  assert.deepEqual(money.calls.at(-1), { method: 'receipts.get', payload: { id: 'rcpt_billed_1' } });
  assert.ok(text(openDialog(money.body)).includes('Billed from one invoice fact in the books.'));

  const clients = await place('clients');
  await click(button(clients.content, 'Open draft invoice'));
  const sheet = openDialog(clients.body);
  assert.equal(descendants(sheet).filter(node => node.textContent === EXPERIMENTAL && node.tagName === 'span').length, 1, 'the notice shows once');
  const issue = button(sheet, 'Issue invoice');
  assert.equal(issue.disabled, true);
  const confirm = find(sheet, node => node.tagName === 'label' && node.textContent === 'I checked this invoice. Its total is INR 2,948.82.');
  await tick(find(confirm, node => node.tagName === 'input'));
  await click(issue);
  assert.deepEqual(clients.calls.find(call => call.method === 'venture.invoice.issue')!.payload, { invoiceId: 'vin_1', digest: F.invoiceDraftView.invoice.digest });
  assert.equal(find(sheet, node => node.className === 'launch-sheet-title').textContent, 'Invoice INV-0001', 'the title follows the issued invoice');
  assert.ok(text(sheet).includes('Record a payment'));
  await type(control(sheet, 'Amount received'), '2948.82');
  await click(button(sheet, 'Record payment'));
  const payment = clients.calls.find(call => call.method === 'venture.payment.record')!.payload;
  assert.equal(payment.amount, '2948.82', 'the amount goes to the engine as typed');
  assert.equal(payment.method, 'bank-transfer');
  assert.equal(payment.receivedOn, ownerDay(), "the date field starts at the owner's day, the engine's day basis");
});

test('clients and orders: add a client and an order with typed text, draft a reply, mark delivered', async () => {
  const h = await place('clients');
  await click(button(h.content, 'Add client'));
  let sheet = openDialog(h.body);
  await type(control(sheet, 'Name'), 'Cafe Aroma Demo');
  await type(control(sheet, 'Email'), 'owner@aroma.example');
  const state = control(sheet, 'State, for place of supply');
  state.value = '27';
  await click(button(sheet, 'Add client'));
  assert.deepEqual(h.calls.find(call => call.method === 'venture.client.add')!.payload, { name: 'Cafe Aroma Demo', email: 'owner@aroma.example', countryCode: 'IN', stateCode: '27' });

  const fresh = await place('clients');
  await click(button(fresh.content, 'New order'));
  sheet = openDialog(fresh.body);
  await type(control(sheet, 'What the client asked for'), F.order.request);
  await click(button(sheet, 'Add order'));
  assert.deepEqual(fresh.calls.find(call => call.method === 'venture.order.create')!.payload, { clientId: 'vcl_1', offerId: 'offer_1', request: F.order.request, quantity: '1' });

  const orders = await place('clients');
  await click(button(orders.content, 'Draft a reply'));
  assert.deepEqual(orders.calls.find(call => call.method === 'venture.delivery.run')!.payload, { orderId: 'vor_1' });
  assert.ok(text(openDialog(orders.body)).includes('This is exactly what Chausar would send to Claude Sonnet 5.5. In this demo a synthetic recording answers instead.'));
  await click(button(openDialog(orders.body), 'Close'));
  const again = await place('clients');
  await click(button(again.content, 'Mark delivered'));
  const date = control(again.content, 'Delivered on');
  date.value = '2026-10-04';
  await click(buttons(again.content, 'Mark delivered').at(-1)!);
  assert.deepEqual(again.calls.find(call => call.method === 'venture.order.deliver')!.payload, { orderId: 'vor_1', deliveredOn: '2026-10-04' });
});

test('while a model writes, the screen shows a still outline and one line of words, never a spinner', async () => {
  let release: () => void = () => {};
  const pending = new Promise<void>(accept => { release = accept; });
  const h = await place('agents', { overrides: { 'venture.simulation.run': async (_method, payload) => { await pending; return F.simulationRun(payload.scenarioIds[0]); } } }, { timers: true });
  void button(h.content, 'Rehearse').dispatch('click'); await flush();
  const clean = find(h.content, node => node.dataset.scenario === 'bookkeeping-clean');
  assert.ok(descendants(clean).some(node => node.className === 'launch-outline' && node.attributes['aria-hidden'] === 'true'));
  assert.ok(text(clean).includes('Rehearsing with a practice client: A tidy client'));
  assert.equal(descendants(h.app).some(node => /loading|spinner|shimmer|pulse/.test(node.className)), false);
  release(); await flush(12);
  assert.ok(text(find(h.content, node => node.dataset.scenario === 'bookkeeping-clean')).includes('passed'));
});

test('Today lists what awaits the owner, the checklist as 7 of 12, the money line and the day line', async () => {
  const h = await place('today');
  for (const words of ['A draft to approve', 'A practice draft to review', 'A draft to review', 'A draft invoice to issue', 'Add your AI (optional)', 'Checklist, 7 of 12', 'This month', 'Billed (without tax)', 'Received (with tax)', 'Earned (without tax)', 'Plan accepted', 'GitHub checked']) {
    assert.ok(text(h.content).includes(words), words);
  }
  assert.equal(buttons(h.content, 'Review').length, 0, 'each row is its own button');
  assert.deepEqual(h.calls.filter(call => call.method === 'venture.events').map(call => call.payload), [{ limit: 1 }, { afterSeq: 8, limit: 6 }]);
  assert.deepEqual(h.calls.find(call => call.method === 'venture.books.summary')!.payload, { period: 'this-month' });
  const day = new Date(`${ownerDay()}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  assert.equal(find(h.content, node => node.className === 'launch-eyebrow').textContent, day, "the day line is the owner's day, as the engine counts it");
  await click(button(h.content, 'INR 2,948.82'));
  assert.deepEqual(h.calls.at(-1), { method: 'receipts.get', payload: { id: 'rcpt_received_1' } });
  await click(button(h.content, 'A draft to approve'));
  assert.equal(h.renderer.state.page, 'agents');
});

test('once the business approves each draft, Today drops practice drafts and the sheet offers Accept only where the engine takes it', async () => {
  const approveEach = { ...F.ventureView, venture: { ...F.ventureView.venture, launchStage: 'approve-each' as const } };
  // An older answer without the engine's flags: the screen works the same rule out from the stage.
  const plain = await place('today', { overrides: { 'venture.get': () => approveEach, 'venture.delivery.list': () => [F.practiceRun, F.outlineRun] } });
  assert.equal(text(plain.content).includes('practice draft'), false, 'no practice draft on Today at approve each');
  assert.ok(text(plain.content).includes('A draft to review'));

  // The engine's flags win: a practice draft read now, an outline it takes, and one blocked by a failed check.
  const view = (run: DeliveryRunRecord, flags: Partial<DeliveryRunView>): DeliveryRunView => ({ ...run, practiceNow: false, awaitingYou: true, canApprove: false, canAccept: true, acceptBlocked: null, ...flags });
  const blockedReason = 'This draft failed a check: The Next steps section is missing. Edit it or reject it.';
  const runs = [
    view(F.practiceRun, { practiceNow: true, awaitingYou: false, canAccept: false, acceptBlocked: 'This is a practice draft.' }),
    view(F.outlineRun, {}),
    view({ ...F.outlineRun, id: 'vdr_blocked', checks: [{ check: 'required-sections', passed: false, detail: 'The Next steps section is missing.' }] }, { canAccept: false, acceptBlocked: blockedReason }),
  ];
  const flagged = await place('today', { overrides: { 'venture.get': () => approveEach, 'venture.delivery.list': () => runs } });
  assert.equal(text(flagged.content).includes('practice draft'), false);
  assert.ok(text(flagged.content).includes('2 drafts to review'));

  const agents = await place('agents', { overrides: { 'venture.get': () => approveEach, 'venture.delivery.list': () => runs } });
  const rowsNow = descendants(agents.content).filter(node => node.className === 'launch-row' && node.textContent.startsWith(CLIENT));
  await click(button(rowsNow[0], CLIENT));
  let sheet = openDialog(agents.body);
  assert.ok(text(sheet).includes('Practice draft. Not for the client.'));
  assert.equal(buttons(sheet, 'Accept').length, 0, 'a practice draft has no Accept');
  assert.equal(text(sheet).includes('This is a practice draft.'), false, 'the practice line says it once');
  await click(button(sheet, 'Close'));
  await click(button(rowsNow[2], CLIENT));
  sheet = openDialog(agents.body);
  assert.equal(buttons(sheet, 'Accept').length, 0, 'the engine would refuse it, so no Accept');
  assert.ok(text(sheet).includes(blockedReason), "the engine's own reason is shown");
  await click(button(sheet, 'Close'));
  await click(button(rowsNow[1], CLIENT));
  assert.equal(buttons(openDialog(agents.body), 'Accept').length, 1, 'Accept where the engine takes it');

  // A waiting draft the engine would not send now (its approval ran out) offers no Approve.
  const expired = await place('agents', { overrides: { 'venture.delivery.list': () => [view(F.waitingRun, { awaitingYou: false, canApprove: false })] } });
  assert.equal(text(expired.content).includes('to approve'), true);
  await openDraft(expired.content, /to approve/);
  const expiredSheet = openDialog(expired.body);
  assert.equal(buttons(expiredSheet, 'Approve and send').length, 0);
  assert.ok(text(expiredSheet).includes("Chausar can't send this one now"));
  const expiredToday = await place('today', { overrides: { 'venture.delivery.list': () => [view(F.waitingRun, { awaitingYou: false, canApprove: false })] } });
  assert.equal(text(expiredToday.content).includes('to approve'), false, 'Today leaves out a draft that can no longer be sent');

  // At shadow, an agent draft that was not made as practice still can't be accepted: the engine treats it as practice.
  const stale = { ...F.practiceRun, id: 'vdr_stale', practice: false };
  const shadow = await place('agents', { overrides: { 'venture.delivery.list': () => [stale] } });
  await openDraft(shadow.content, /practice/);
  assert.equal(buttons(openDialog(shadow.body), 'Accept').length, 0);
});

test('Practise this turns a rejected or edited draft into a rehearsal case through venture.simulation.fromSignal', async () => {
  const signal = (seq: number, runId: string, source: string, signalId: string): VentureEventRecord => ({ ...F.events[0], id: `vev_${seq}`, seq, name: 'signal-recorded', data: { signalId, runId, source, reason: null } });
  const history = [signal(15, 'vdr_outline', 'check-failed', 'vsg_check'), signal(16, 'vdr_outline', 'owner-rejected', 'vsg_owner'), signal(17, 'vdr_other', 'owner-edited', 'vsg_other')];
  const caseScenario: Scenario = { ...F.scenarios[0], id: 'signal-vsg_owner', title: 'A client like the draft you rejected', source: 'signal', signalId: 'vsg_owner' };
  const events = (_method: string, payload: Record<string, any>) => (payload.limit === 1 && !payload.afterSeq ? { events: [], lastSeq: 17 } : { events: [...F.events, ...history].filter(event => event.seq > (payload.afterSeq ?? 0)), lastSeq: 17 });
  const h = await place('agents', { overrides: { 'venture.events': events, 'venture.simulation.fromSignal': () => caseScenario } });
  await openDraft(h.content, /outline/);
  const sheet = openDialog(h.body);
  assert.equal(buttons(sheet, 'Practise this').length, 0, 'nothing to practise before a review');
  await click(button(sheet, 'Reject'));
  await click(button(sheet, 'Practise this'));
  assert.deepEqual(h.calls.filter(call => call.method === 'venture.simulation.fromSignal').map(call => call.payload), [{ signalId: 'vsg_owner' }], "the owner's review, not the earlier check");
  assert.ok(text(sheet).includes('Added to rehearsal on Agents: A client like the draft you rejected.'));
  assert.equal(buttons(sheet, 'Practise this').length, 0, 'made once');

  const edited = await place('agents', { overrides: { 'venture.events': events } });
  await openDraft(edited.content, /outline/);
  const editSheet = openDialog(edited.body);
  await click(button(editSheet, 'Edit'));
  await type(control(editSheet, 'Your edit'), 'A shorter reply.');
  await click(button(editSheet, 'Save edit'));
  assert.equal(buttons(editSheet, 'Practise this').length, 1, 'an edited draft can be practised too');

  const missing = await place('agents', { overrides: { 'venture.events': () => ({ events: [], lastSeq: 0 }) } });
  await openDraft(missing.content, /outline/);
  const lost = openDialog(missing.body);
  await click(button(lost, 'Reject'));
  await click(button(lost, 'Practise this'));
  assert.equal(missing.calls.some(call => call.method === 'venture.simulation.fromSignal'), false, 'no signal, no request');
  assert.ok(text(lost).includes("Chausar couldn't find your review of this draft"));

  // The case rehearses with the others on Agents.
  const later = await place('agents', { overrides: { 'venture.simulation.scenarios': () => [...F.scenarios, caseScenario] } });
  const caseRow = find(later.content, node => node.dataset.scenario === 'signal-vsg_owner');
  assert.ok(text(caseRow).includes('practice case from your review'));
  await click(button(later.content, 'Rehearse')); await flush();
  assert.ok(later.calls.some(call => call.method === 'venture.simulation.run' && call.payload.scenarioIds[0] === 'signal-vsg_owner'));
});

test("Money offers the engine's periods and the owner's own dates, and heads the page with the chosen days", async () => {
  const h = await place('money');
  assert.deepEqual(h.calls.filter(call => call.method === 'venture.books.summary').at(-1)!.payload, { period: 'this-month' });
  const pick = find(h.content, node => node.tagName === 'select' && node.attributes['aria-label'] === 'Period');
  assert.deepEqual(descendants(pick).filter(node => node.tagName === 'option').map(node => node.textContent), ['All time', 'This month', 'Last month', 'This year', 'Choose dates']);
  assert.equal(pick.value, 'this-month');
  assert.equal(find(h.content, node => node.className === 'launch-eyebrow').textContent, '1 Oct to 31 Oct 2026');
  pick.value = 'last-month'; await pick.dispatch('change'); await flush();
  assert.deepEqual(h.calls.filter(call => call.method === 'venture.books.summary').at(-1)!.payload, { period: 'last-month' });
  let content = find(h.app, node => node.id === 'page-content');
  assert.equal(find(content, node => node.tagName === 'select').value, 'last-month');

  const custom = find(content, node => node.tagName === 'select');
  const before = h.calls.length;
  custom.value = 'custom'; await custom.dispatch('change'); await flush();
  assert.equal(h.calls.length, before, 'choosing dates sends nothing until Show');
  await type(control(content, 'From'), '2026-10-05');
  await type(control(content, 'To'), '2026-10-12');
  await click(button(content, 'Show'));
  assert.deepEqual(h.calls.filter(call => call.method === 'venture.books.summary').map(call => call.payload).slice(-2), [{ from: '2026-10-05', to: '2026-10-12' }, { from: '2026-10-05', to: '2026-10-12' }]);
  content = find(h.app, node => node.id === 'page-content');
  assert.equal(find(content, node => node.tagName === 'select').value, 'custom');
  assert.equal(find(content, node => node.className === 'launch-eyebrow').textContent, '5 Oct to 12 Oct 2026');
});

// ---------------------------------------------------------------------------------------------
// 12: the delivery harness: files on an order, agent turns, the agent's question, the report's reconciliation,
// and the improvement loop
// ---------------------------------------------------------------------------------------------
/** A file the owner picked, as the browser's File gives it to the screen. */
function pickedFile(name: string, content: string | Uint8Array, size?: number) {
  const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
  return { name, size: size ?? bytes.length, type: '', arrayBuffer: async () => bytes.slice().buffer };
}
const LIVE_MODELS = { ...F.modelsConnected, replay: { active: false, label: null } };
const squaresIn = (node: Element) => descendants(node).filter(item => item.className.startsWith('launch-sq ')).map(item => item.className.slice('launch-sq '.length));

test('an order lists its files and adds the one the owner picks, as base64 from outside any form', async () => {
  const h = await place('clients');
  assert.deepEqual(h.calls.filter(call => call.method === 'venture.files.list').map(call => call.payload), [{}], 'one read for every order');
  const order = find(h.content, node => node.className === 'launch-order');
  for (const name of ['bank-september.csv', 'bills-september.csv']) assert.ok(text(order).includes(name), name);
  assert.equal(wordCount(h.content) <= WORDS_AT_REST.clients, true, 'files show only when the order is opened');
  const input = find(order, node => node.tagName === 'input' && node.attributes.type === 'file') as Element & { files?: unknown[] };
  assert.equal(input.hidden, true, 'the button stands in for the browser control');
  assert.equal(input.attributes.accept, '.csv,.xlsx,.pdf');
  assert.equal(ancestors(input).some(node => node.tagName === 'form'), false);
  let chooserOpened = 0;
  input.addEventListener('click', () => { chooserOpened++; });
  await click(button(order, 'Add a file'));
  assert.equal(chooserOpened, 1, 'Add a file opens the file chooser');

  const csv = 'Supplier,Amount\nFresh Dairy,"12,000.00"\n';
  input.files = [pickedFile('bills-october.csv', csv)];
  await input.dispatch('change'); await flush();
  assert.deepEqual(h.calls.filter(call => call.method === 'venture.files.add').map(call => call.payload), [{ orderId: 'vor_1', name: 'bills-october.csv', contentBase64: Buffer.from(csv).toString('base64') }]);
  assert.ok(text(order).includes('bills-october.csv'), 'the new file joins the list');
  assert.equal(input.value, '', 'the chooser is cleared, so the same file can be picked again');

  const before = h.calls.length;
  input.files = [pickedFile('statement.pdf', new Uint8Array(4), 1_450_001)];
  await input.dispatch('change'); await flush();
  assert.equal(h.calls.length, before, 'a file over the limit is refused before any request');
  assert.ok(text(order).includes('Add a file smaller than one and a half megabytes.'));
});

test('an order at ten files offers no Add a file, and a refused file shows the engine words where it was added', async () => {
  const ten = Array.from({ length: 10 }, (_, index) => ({ ...F.uploads[0], id: `upload_${index}`, name: `file-${index}.csv` }));
  const full = await place('clients', { overrides: { 'venture.files.list': () => ten } });
  assert.equal(buttons(full.content, 'Add a file').length, 0);
  assert.ok(text(full.content).includes('Ten files, the most an order holds.'));

  const refuse = () => { throw Object.assign(new Error('This file is named .pdf but is not a PDF.'), { code: 'UNSUPPORTED_UPLOAD' }); };
  const h = await place('clients', { overrides: { 'venture.files.add': refuse } });
  const input = find(h.content, node => node.tagName === 'input' && node.attributes.type === 'file') as Element & { files?: unknown[] };
  input.files = [pickedFile('scan.pdf', 'not a pdf')];
  await input.dispatch('change'); await flush();
  const order = find(h.content, node => node.className === 'launch-order');
  assert.ok(text(order).includes('This file is named .pdf but is not a PDF.'));
  assert.ok(text(order).includes('UNSUPPORTED_UPLOAD'));
});

test('a harness turn shows which turn it is, what the tools did in plain words and the exact text to approve', async () => {
  const h = await place('agents', { overrides: { 'venture.models.status': () => LIVE_MODELS, 'venture.delivery.list': () => [F.turnRun], 'venture.delivery.approve': () => F.askingRun } });
  await openDraft(h.content, /to approve/);
  const sheet = openDialog(h.body);
  assert.deepEqual(h.calls.filter(call => call.method === 'venture.files.list').map(call => call.payload), [{ orderId: 'vor_1' }]);
  const progress = find(sheet, node => node.className === 'launch-progress');
  assert.equal(text(progress), 'Turn 2 of 4');
  assert.deepEqual(squaresIn(progress), ['cha', 'now', 'off', 'off'], 'one mark per turn: done, this one, the rest');
  for (const words of [
    'Listed the files', 'Read bank-september.csv', 'Read f3', 'There is no file f3.', 'List the files and read the bank statement columns.',
    'This is exactly what will be sent to Claude Haiku 5.5', F.turnRun.preview!.payloadText, 'Most it can cost: USD 0.0080.',
    'Tools run on this computer between turns. Nothing reaches the client.',
  ]) assert.ok(text(sheet).includes(words), words);
  const approve = button(sheet, 'Approve and send');
  assert.equal(approve.disabled, true);
  await tick(find(sheet, node => node.tagName === 'input' && node.attributes.type === 'checkbox'));
  await click(approve);
  assert.deepEqual(h.calls.filter(call => call.method === 'venture.delivery.approve').map(call => call.payload), [{ runId: 'vdr_turn', digest: F.turnRun.preview!.digest }]);
  // The turn ran: the reconciliation and the hand-off are in the list, and the question waits for the owner.
  for (const words of ['Reconciled bank-september.csv with the bills', 'Asked you a question', 'The agent asks you', 'Is the payment to Hardware Mart a business cost?']) assert.ok(text(sheet).includes(words), words);
  assert.equal(descendants(sheet).filter(node => node.className === 'launch-quote').length, 1, 'the open question is asked once, below the turns');
  assert.ok(control(sheet, 'Your answer'));
  assert.equal(buttons(sheet, 'Approve and send').length, 0, 'nothing to approve while the agent waits for an answer');
});

test("the agent's question takes the owner's answer, then the next turn and the write step show their exact text", async () => {
  const h = await place('agents', { overrides: { 'venture.models.status': () => LIVE_MODELS, 'venture.delivery.list': () => [F.askingRun], 'venture.delivery.approve': () => F.writeRun } });
  await openDraft(h.content, /to answer/);
  const sheet = openDialog(h.body);
  assert.equal(text(find(sheet, node => node.className === 'launch-progress')), 'Turn 2 of 4');
  assert.ok(text(sheet).includes('Your answer goes into the next turn, which shows you its exact text first.'));
  await click(button(sheet, 'Send answer'));
  assert.equal(h.calls.some(call => call.method === 'venture.delivery.answer'), false, 'an empty answer sends nothing');
  assert.ok(text(sheet).includes('Write your answer first.'));
  await type(control(sheet, 'Your answer'), `  ${F.ANSWER}  `);
  await click(button(sheet, 'Send answer'));
  assert.deepEqual(h.calls.filter(call => call.method === 'venture.delivery.answer').map(call => call.payload), [{ runId: 'vdr_turn', answer: F.ANSWER }]);
  assert.equal(text(find(sheet, node => node.className === 'launch-progress')), 'Turn 3 of 4');
  assert.ok(text(sheet).includes(`You answered: ${F.ANSWER}`), 'the answer stays with the question');
  assert.ok(text(sheet).includes(F.answeredRun.preview!.payloadText));

  await tick(find(sheet, node => node.tagName === 'input' && node.attributes.type === 'checkbox'));
  await click(button(sheet, 'Approve and send'));
  assert.equal(text(find(sheet, node => node.className === 'launch-progress')), 'Last step: the report');
  assert.ok(text(sheet).includes('This is exactly what will be sent to Claude Sonnet 5.5'));
  assert.ok(text(sheet).includes('Totalled bank-september.csv by group'));
});

test('a client question is asked by the owner, and a forced last step says why the agent stopped', async () => {
  const toClient = { ...F.askingRun, harness: { ...F.askingRun.harness!, handoffs: [{ ...F.askingRun.harness!.handoffs[0], to: 'client' as const }] } };
  const asking = await place('agents', { overrides: { 'venture.delivery.list': () => [toClient] } });
  await openDraft(asking.content, /to answer/);
  const sheet = openDialog(asking.body);
  assert.ok(text(sheet).includes('The agent asks the client'));
  assert.ok(text(sheet).includes('Ask the client, then write what they said.'));
  assert.ok(control(sheet, "The client's answer"));

  const forced = { ...F.writeRun, harness: { ...F.writeRun.harness!, stopReason: 'The agent used all its turns.' } };
  const stopped = await place('agents', { overrides: { 'venture.delivery.list': () => [forced] } });
  await openDraft(stopped.content, /to approve/);
  assert.ok(text(openDialog(stopped.body)).includes('The agent used all its turns.'));
});

test('a ready report shows its reconciliation from the work receipt, as a picture and figures, and opens the receipt', async () => {
  const h = await place('agents', { overrides: { 'venture.delivery.list': () => [F.reportRun] } });
  await openDraft(h.content, /to review/);
  const sheet = openDialog(h.body);
  assert.deepEqual(h.calls.filter(call => call.method === 'venture.work.get').map(call => call.payload), [{ id: 'work_reconcile' }]);
  const reconciliation = find(sheet, node => node.className === 'launch-reconciliation');
  assert.ok(text(reconciliation).includes('The statement balances.'));
  const picture = find(reconciliation, node => node.className === 'launch-strip launch-match');
  assert.deepEqual(squaresIn(picture), ['cha', 'cha', 'cha', 'unsure', 'off'], 'one mark per payment or bill: matched, no bill, not paid');
  assert.equal(picture.attributes['aria-label'], 'Payments matched to bills: 3. Payments with no bill: 1. Bills not paid in this statement: 1.');
  for (const words of ['Payments matched to bills', 'Payments with no bill', 'Bills not paid in this statement', 'UPI HARDWARE MART', 'INR 4,500.00', 'Clean Linen CL-77', 'INR 2,200.00']) assert.ok(text(reconciliation).includes(words), words);
  const receipt = find(reconciliation, node => node.tagName === 'details' && node.children[0]?.textContent === 'Work receipt');
  assert.equal(receipt.open, false, 'the receipt opens on request');
  for (const words of ['Opening balance', 'INR 50,000.00', 'Closing balance on the statement', 'INR 37,500.00', 'money out, every row', 'bank-september.csv', 'Receipt work_reconcile']) assert.ok(text(receipt).includes(words), words);
  assert.ok(text(sheet).includes('Done in 3 turns with 6 tool calls.'));
  assert.ok(text(reconciliation).includes('NEFT FRESH DAIRY, bill Fresh Dairy FD-118'), 'each match is listed under its count');
  const report = find(sheet, node => node.tagName === 'pre');
  assert.equal(text(report), F.reportRun.renderedText!.slice(0, F.reportRun.renderedText!.lastIndexOf('\n\n## Reconciliation\n')), "the agent's words exactly, and the attached reconciliation once, from its receipt");
});

test('a reconciliation that does not balance, or has no balance column, says so plainly', async () => {
  const unbalanced = { ...F.workReceipt, reconciliation: { ...F.workReceipt.reconciliation!, balanced: false } };
  const off = await place('agents', { overrides: { 'venture.delivery.list': () => [F.reportRun], 'venture.work.get': () => unbalanced } });
  await openDraft(off.content, /to review/);
  assert.ok(text(openDialog(off.body)).includes('The statement does not balance.'));
  const noBalance = { ...F.workReceipt, reconciliation: { ...F.workReceipt.reconciliation!, balanced: false, statementClosing: false } };
  const unchecked = await place('agents', { overrides: { 'venture.delivery.list': () => [F.reportRun], 'venture.work.get': () => noBalance } });
  await openDraft(unchecked.content, /to review/);
  assert.ok(text(openDialog(unchecked.body)).includes('The statement has no balance column, so the closing balance was not checked.'));
});

test('Today lists the agent question to answer and a playbook change to review', async () => {
  const h = await place('today', { overrides: { 'venture.delivery.list': () => [F.askingRun], 'venture.improve.status': () => F.improveWithCandidate } });
  assert.ok(text(h.content).includes('A question to answer'));
  assert.ok(text(h.content).includes('A playbook change to review'));
  await click(button(h.content, 'A question to answer'));
  assert.equal(h.renderer.state.page, 'agents');
});

test('Agents shows improvement readiness, runs the loop, shows the kept change in plain words and adopts it by its digest', async () => {
  let status: unknown = F.improveIdle;
  const h = await place('agents', { overrides: {
    'venture.improve.status': () => status,
    'venture.improve.run': () => { status = F.improveWithCandidate; return F.improveKeptRun; },
    'venture.improve.adopt': () => { status = { ...F.improveIdle, activePlaybookId: 'vpb_2', latest: F.improveKeptRun }; return F.adoptedPlaybook; },
  } });
  const improvement = () => find(h.content, node => node.className === 'launch-improve');
  const summary = () => find(improvement(), node => node.tagName === 'summary').textContent;
  assert.equal(summary(), 'Improvement: not due yet');
  assert.ok(text(improvement()).includes(F.improveIdle.readiness.reason));
  assert.ok(text(improvement()).includes('2 drafts reviewed, 1 rejected or edited.'));
  await click(button(improvement(), 'Run the improvement loop'));
  assert.deepEqual(h.calls.filter(call => call.method === 'venture.improve.run').map(call => call.payload), [{}]);
  assert.equal(summary(), 'Improvement: a change to adopt');
  assert.equal(buttons(improvement(), 'Run the improvement loop').length, 0, 'with a change waiting, Adopt is the one button');
  assert.ok(button(improvement(), 'Run the loop again'));
  assert.ok(text(improvement()).includes('2 won, 2 tied, 0 lost'));
  for (const words of [
    'Kept a new version', 'The new version won more cases than it lost, with no new critical error.', 'USD 0.0084',
    'Adds to "Draft the monthly report for review": Keep each section to a few short sentences.',
  ]) assert.ok(text(improvement()).includes(words), words);
  assert.deepEqual(squaresIn(find(improvement(), node => node.className === 'launch-strip launch-gate')), ['cha', 'cha', 'off', 'off'], 'won two, tied two, lost none');
  await click(button(improvement(), 'Adopt this version'));
  assert.deepEqual(h.calls.filter(call => call.method === 'venture.improve.adopt').map(call => call.payload), [{ runId: 'improve_1', digest: F.improveKeptRun.digest }]);
  assert.ok(text(improvement()).includes('Now using version 2.'));
  assert.equal(buttons(improvement(), 'Adopt this version').length, 0);
});

test('the improvement loop says plainly why it could not run, and a stale change is not adopted', async () => {
  const notReady = () => { throw Object.assign(new Error('There is nothing to improve yet: no draft was rejected or edited, no check failed and no rehearsal failed.'), { code: 'IMPROVEMENT_NOT_READY' }); };
  const h = await place('agents', { overrides: { 'venture.improve.run': notReady } });
  await click(button(h.content, 'Run the improvement loop'));
  assert.ok(text(h.content).includes('There is nothing to improve yet'));

  const stale = () => { throw Object.assign(new Error('The playbook changed since this run, so its result no longer applies. Run the loop again.'), { code: 'CANDIDATE_STALE' }); };
  const later = await place('agents', { overrides: { 'venture.improve.status': () => F.improveWithCandidate, 'venture.improve.adopt': stale } });
  await click(button(later.content, 'Adopt this version'));
  assert.ok(text(later.content).includes('The playbook changed since this run'));
  assert.ok(text(later.content).includes('CANDIDATE_STALE'));
});

// ---------------------------------------------------------------------------------------------
// Heavy work: a brief for the owner's own Claude Code or Codex, what came back, and the untrusted record
// ---------------------------------------------------------------------------------------------
const delegateReceipt = (_method: string, payload: Record<string, any>) => {
  const receipt = F.delegateReceipts[payload.id];
  assert.ok(receipt, `Unknown work receipt ${payload.id}`);
  return receipt;
};
const agentDid = (sheet: Element) => find(sheet, node => node.tagName === 'details' && node.children[0]?.textContent === 'What the agent did');

test('a brief waiting shows the tool and version, the exact brief, its files, the time limit and where the tool sends what it reads', async () => {
  const h = await place('agents', { overrides: { 'venture.models.status': () => LIVE_MODELS, 'venture.delivery.list': () => [F.briefRun], 'venture.delivery.delegate': () => F.delegatedRun } });
  assert.ok(text(draftRow(h.content, /brief to approve/)).includes(CLIENT));
  await openDraft(h.content, /brief to approve/);
  const sheet = openDialog(h.body);
  assert.equal(text(find(sheet, node => node.className === 'launch-progress')), 'Turn 2 of 4');
  for (const words of [
    'The agent asks to hand this job to Claude Code', 'Claude Code 2.1.0 on this computer gets this exact brief and copies of the files.',
    'Files: bank-september.csv, bills-september.csv. It stops after 10 minutes.',
    'Claude Code sends what it reads to Anthropic under your own plan.',
    'Wrote a brief for Claude Code', 'The statement is long, so hand the sorting to Claude Code.',
  ]) assert.ok(text(sheet).includes(words), words);
  find(sheet, node => node.tagName === 'pre' && node.textContent === F.briefText, 'the exact brief, as the tool gets it');
  assert.equal(agentDid(sheet).open, true, 'what the agent did sits open while the run waits on the owner');
  for (const hidden of ['claude.cmd', '2000000', 'USD 2']) assert.equal(text(sheet).includes(hidden), false, `no ${hidden} on screen`);
  assert.equal(buttons(sheet, 'Approve and send').length, 0);
  assert.equal(descendants(sheet).filter(node => node.className === 'launch-btn').length, 1, 'Approve and start is the one filled button');
  assert.ok(button(sheet, 'Decline'));

  await click(button(sheet, 'Approve and start'));
  assert.deepEqual(h.calls.filter(call => call.method === 'venture.delivery.delegate').map(call => call.payload), [{ runId: 'vdr_turn', digest: F.delegation.digest, decision: 'approve' }]);
  assert.equal(buttons(sheet, 'Approve and start').length, 0, 'the brief is settled');
  assert.ok(text(sheet).includes('Handed the job to Claude Code'));
  assert.ok(text(sheet).includes('This is exactly what will be sent to Claude Haiku 5.5'), 'the next turn shows its exact text');
  assert.equal(h.rejected.length, 0);
});

test('while the owner\'s tool works the sheet shows a still outline and one line, for as long as it takes', async () => {
  let finish!: (value: unknown) => void;
  const h = await place('agents', { overrides: { 'venture.delivery.list': () => [F.briefRun], 'venture.delivery.delegate': () => new Promise(accept => { finish = accept; }) } }, { timers: true });
  await openDraft(h.content, /brief to approve/);
  const sheet = openDialog(h.body);
  button(sheet, 'Approve and start').click();
  await flush();
  assert.ok(text(sheet).includes('Claude Code is working on copies of the files. This can take up to 10 minutes.'));
  assert.ok(find(sheet, node => node.className === 'launch-outline'));
  assert.equal(buttons(sheet, 'Approve and start').length + buttons(sheet, 'Decline').length, 0, 'nothing to click twice while it runs');
  finish(F.delegatedRun); await flush();
  assert.ok(text(sheet).includes('Handed the job to Claude Code'));
  assert.equal(descendants(sheet).filter(node => node.className === 'launch-outline').length, 0);
});

test('an approve that is refused shows the engine words where the brief was, and the brief stays', async () => {
  const off = () => { throw Object.assign(new Error('Sending is off for this workspace, so the tool was not started. Change it on Trust & access.'), { code: 'SEND_DISABLED' }); };
  const h = await place('agents', { overrides: { 'venture.delivery.list': () => [F.briefRun], 'venture.delivery.delegate': off } });
  await openDraft(h.content, /brief to approve/);
  const sheet = openDialog(h.body);
  await click(button(sheet, 'Approve and start'));
  assert.ok(text(sheet).includes('Sending is off for this workspace, so the tool was not started.'));
  assert.ok(text(sheet).includes('SEND_DISABLED'));
  assert.ok(button(sheet, 'Approve and start'), 'the brief can still be approved or declined');
});

test('Decline tells the agent and shows the next turn; the declined brief reads plainly', async () => {
  const h = await place('agents', { overrides: { 'venture.models.status': () => LIVE_MODELS, 'venture.delivery.list': () => [F.briefRun], 'venture.delivery.delegate': () => F.declinedRun } });
  await openDraft(h.content, /brief to approve/);
  const sheet = openDialog(h.body);
  await click(button(sheet, 'Decline'));
  assert.deepEqual(h.calls.filter(call => call.method === 'venture.delivery.delegate').map(call => call.payload), [{ runId: 'vdr_turn', digest: F.delegation.digest, decision: 'decline' }]);
  assert.ok(text(sheet).includes('You declined the brief'));
  assert.ok(text(sheet).includes('This is exactly what will be sent to Claude Haiku 5.5'));
  assert.equal(buttons(sheet, 'What Claude Code made').length, 0, 'a declined brief made nothing');
});

test('what the agent did says what the tool did in plain words, with its file names and figure refs, never its numbers', async () => {
  const h = await place('agents', { overrides: { 'venture.models.status': () => LIVE_MODELS, 'venture.delivery.list': () => [F.delegatedRun] } });
  await openDraft(h.content, /to approve/);
  const did = agentDid(openDialog(h.body));
  for (const words of [
    'Handed the job to Claude Code', 'Made summary.md, by-supplier.csv, figures.json and chart.png.',
    'Figures the calculator worked out again: w2.total, w3.total.',
  ]) assert.ok(text(did).includes(words), words);
  for (const hidden of [F.TOOL_SUMMARY, F.MASKED_SUMMARY, 'Sorted', '42500', '31000', '38,000']) assert.equal(text(did).includes(hidden), false, `no "${hidden}" in what the agent did`);
  assert.equal(buttons(did, 'Receipt').length, 2, 'one receipt per figure the calculator worked out');

  const late = await place('agents', { overrides: { 'venture.delivery.list': () => [F.timedOutRun] } });
  await openDraft(late.content, /to approve/);
  const lateDid = agentDid(openDialog(late.body));
  assert.ok(text(lateDid).includes('Claude Code ran past its time limit'));
  assert.ok(text(lateDid).includes('Made by-supplier.csv.'));
  assert.equal(text(lateDid).includes('Figures the calculator'), false);

  const failedCall = { ...F.timedOutRun.harness!.toolCalls.at(-1)!, outcome: 'failed' as const, envelope: { ok: false as const, error: { code: 'DELEGATE_FAILED', name: 'DelegateFailed', message: 'Claude Code stopped with an error. It left 0 files.' } } };
  const failedRun = { ...F.timedOutRun, harness: { ...F.timedOutRun.harness!, toolCalls: [...F.timedOutRun.harness!.toolCalls.slice(0, -1), failedCall] } };
  const failed = await place('agents', { overrides: { 'venture.delivery.list': () => [failedRun] } });
  await openDraft(failed.content, /to approve/);
  const failedDid = agentDid(openDialog(failed.body));
  assert.ok(text(failedDid).includes('Claude Code stopped with an error'));
  assert.ok(text(failedDid).includes('Claude Code stopped with an error. It left 0 files.'), 'the engine says why');
});

test('what Claude Code made opens on request, labelled as written by another AI and not checked, with figures against the calculator', async () => {
  const h = await place('agents', { overrides: {
    'venture.delivery.list': () => [F.delegatedRun], 'venture.work.get': delegateReceipt,
    'venture.delegate.get': (_method, payload) => { assert.equal(payload.id, 'delegaterun_1'); return F.delegateRecord; },
  } });
  await openDraft(h.content, /to approve/);
  const sheet = openDialog(h.body);
  assert.equal(h.calls.some(call => call.method === 'venture.delegate.get'), false, 'nothing is read until the owner asks');
  await click(button(sheet, 'What Claude Code made'));
  assert.deepEqual(h.calls.filter(call => call.method === 'venture.delegate.get').map(call => call.payload), [{ id: 'delegaterun_1' }]);
  const made = find(sheet, node => node.className === 'launch-delegated');
  for (const words of [
    'Written by Claude Code, another AI, on this computer. Chausar has not checked it.', 'Claude Code finished and left 4 files.',
    'Money out', 'same as the calculator', 'Money in', "differs; only the calculator's total may be cited",
    'Bills total', 'It names a PDF; the calculator reads amounts from tables.',
    '3 numbers in its summary were not worked out again.', 'It printed a cost of USD 0.42 on your plan. Chausar did not check it or count it.',
    'summary.md', 'by-supplier.csv', 'figures.json', 'chart.png', 'Kept by name only.', 'Record delegaterun_1',
  ]) assert.ok(text(made).includes(words), words);
  assert.equal(buttons(sheet, 'What Claude Code made').length, 0, 'the link gives way to what it opened');
  const summaryFile = find(made, node => node.tagName === 'details' && node.children[0]?.textContent === 'summary.md');
  assert.equal(summaryFile.open, false, "each file's text opens on request");
  assert.ok(text(summaryFile).includes(F.TOOL_SUMMARY), "the file is shown as the tool wrote it");
  assert.ok(find(made, node => node.tagName === 'details' && node.children[0]?.textContent === 'The end of its log'));
  // The calculator's own figure opens from its receipt; the tool's value is never shown beside it.
  for (const claimed of ['42500.00', '31000', '38,000']) assert.equal(visibleText(made).join(' ').includes(claimed), false, `the tool's ${claimed} is not drawn as a figure`);
  const moneyOut = find(made, node => node.className === 'launch-row' && node.textContent.startsWith('Money out'));
  await click(button(moneyOut, 'Receipt'));
  assert.deepEqual(h.calls.filter(call => call.method === 'venture.work.get').map(call => call.payload), [{ id: 'work_delegate_out' }]);
  assert.ok(text(moneyOut).includes('INR 42,500.00'));
  assert.ok(text(moneyOut).includes('Receipt work_delegate_out'));
});

test('a brief whose tool never reported back can be declined, and one still running offers nothing to click', async () => {
  const h = await place('agents', { overrides: { 'venture.delivery.list': () => [{ ...F.strandedRun, awaitingYou: true }], 'venture.delivery.delegate': () => F.declinedRun } });
  await openDraft(h.content, /brief to approve/);
  const sheet = openDialog(h.body);
  assert.ok(text(sheet).includes('Claude Code was started and has not reported back. Chausar may have closed while it worked.'));
  assert.equal(buttons(sheet, 'Approve and start').length, 0);
  await click(button(sheet, 'Decline'));
  assert.deepEqual(h.calls.filter(call => call.method === 'venture.delivery.delegate').map(call => call.payload), [{ runId: 'vdr_turn', digest: F.delegation.digest, decision: 'decline' }]);

  const working = await place('agents', { overrides: { 'venture.delivery.list': () => [{ ...F.strandedRun, awaitingYou: false }] } });
  await openDraft(working.content, /brief to approve/);
  const busySheet = openDialog(working.body);
  assert.ok(text(busySheet).includes('Claude Code is working on it. Check again in a few minutes.'));
  assert.equal(buttons(busySheet, 'Approve and start').length + buttons(busySheet, 'Decline').length, 0);
});

test('Today lists a brief waiting for the owner as awaiting them', async () => {
  const h = await place('today', { overrides: { 'venture.delivery.list': () => [{ ...F.briefRun, awaitingYou: true }] } });
  assert.ok(text(h.content).includes('A brief to approve'));
  await click(button(h.content, 'A brief to approve'));
  assert.equal(h.renderer.state.page, 'agents');
  const later = await place('today', { overrides: { 'venture.delivery.list': () => [{ ...F.briefRun, awaitingYou: false }] } });
  assert.equal(text(later.content).includes('A brief to approve'), false, "the engine's awaitingYou decides");
});

test('the heavy-work capability rows read like the other sandbox rows', async () => {
  const h = await place('agents');
  const how = find(h.content, node => node.tagName === 'details' && node.children[0]?.textContent === 'How agents work');
  const rowOf = (title: string) => find(how, node => node.className === 'launch-row' && node.children[1]?.children[0]?.textContent === title, `Expected the ${title} row.`);
  const claude = rowOf('Heavy work: Claude Code'), codex = rowOf('Heavy work: Codex'), containers = rowOf('Containers');
  assert.ok(text(claude).includes('unverified'));
  assert.ok(text(claude).includes('Claude Code 2.1.0 is on this computer. Not yet tried on a real order.'));
  assert.ok(text(codex).includes('needs setup'));
  assert.ok(text(codex).includes('Codex is not on this computer. Install it and sign in, then look again.'));
  const shape = (node: Element): unknown => ({ tag: node.tagName, cls: node.className, children: node.children.filter(child => child.tagName !== '#text').map(shape) });
  assert.deepEqual(shape(claude), shape(containers));
  assert.deepEqual(squaresIn(claude), ['off']);
});
