// Onboarding v2 renderer (P-renderer): connect an AI first, one open box, a plan the AI composed from checked blocks
// and drawn by launch.js from a fixed view registry, prices the owner types, then Keep it safe, the recovery code,
// Accept and Build, all in look B. Runs the real launch.js and app.js through the shared harness (fake DOM, real
// preload, real IPC validator). The fake engine answers from fixtures/venture/renderer/onboarding.ts, picks the
// fixture by the test-only kind rules, and applies the owner's edits with the engine's own patch function.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AI_HALF_CONNECTED_WORDS, AI_OPTION_IDS, AI_OPTION_WORDS, AI_STATUS_CHIPS, AI_UNCHECKED_LINE, COMPOSE_REFUSED_WORDS, KIND_LABELS, NOT_A_SERVICE_WORDS, OPEN_BOX_TEXT, VIEW_REGISTRY,
} from '../runtime/venture/onboarding-contracts.ts';
import { AVAILABILITY_REASONS } from '../runtime/venture/models/presets.ts';
import { Vault } from '../runtime/vault.ts';
import * as O from './fixtures/venture/renderer/onboarding.ts';
import {
  Element, KEY, ancestors, button, buttons, click, control, cssSource, descendants, find, flush, harness, hasClass, launchSource, place, restText, restWords, root, text, tick, type, visibleText,
} from './launch-renderer-harness.ts';
import type { EngineOptions, HarnessOptions } from './launch-renderer-harness.ts';

type H = Awaited<ReturnType<typeof harness>>;
const screen = (h: H) => find(h.app, node => hasClass(node, 'ob-root'), 'Expected the look B frame.');
const step = (h: H) => screen(h).attributes['data-step'];
const title = (host: Element) => find(host, node => hasClass(node, 'ob-title')).textContent;
const optionRow = (host: Element, id: string) => find(host, node => node.tagName === 'details' && node.attributes['data-option'] === id, `Expected the ${id} row.`);
const summaryOf = (node: Element) => node.children.find(child => child.tagName === 'summary')!;
const goButton = (host: Element) => find(host, node => node.attributes['aria-label'] === 'Make my plan');
const leftPane = (h: H) => find(h.app, node => hasClass(node, 'ob-ask'));
const rightPane = (h: H) => find(h.app, node => hasClass(node, 'ob-field'));
const methods = (h: H) => h.calls.map(call => call.method);
const callsOf = (h: H, method: string) => h.calls.filter(call => call.method === method);
/** Filled buttons a person can see at rest. */
function filledAtRest(host: Element) {
  return descendants(host).filter(node => node.tagName === 'button' && (hasClass(node, 'ob-btn') || node.className === 'launch-btn')
    && !node.hidden && !ancestors(node).some(parent => parent.hidden || (parent.tagName === 'details' && !parent.open)));
}
async function open(details: Element) { details.open = true; await details.dispatch('toggle'); await flush(); }
async function boot(engine: EngineOptions = {}, options: HarnessOptions = {}) {
  const h = await harness(engine, options);
  await h.renderer.boot(); await flush();
  return h;
}
const connected = (draft: EngineOptions['draft'] = {}, rest: EngineOptions = {}) => ({ ...rest, draft: { ai: O.statusPair, ...draft } });
async function askFor(h: H, sentence: string) {
  await type(find(h.app, node => node.tagName === 'textarea'), sentence);
  await click(goButton(h.app)); await flush();
}
/** Types and presses go without waiting for the answer, for a request the test holds open. */
async function askAndHold(h: H, sentence: string) {
  await type(find(h.app, node => node.tagName === 'textarea'), sentence);
  void goButton(h.app).dispatch('click'); await flush();
}
/** A fill that waits until the test releases it, so the Working screen can be read. */
function heldFill(plan: () => unknown) {
  const gate: { release: () => void } = { release: () => {} };
  const override = () => new Promise(resolve => { gate.release = () => resolve(plan()); });
  return { gate, override };
}

// ---------------------------------------------------------------------------------------------
// 1 to 5: Connect an AI first
// ---------------------------------------------------------------------------------------------
test('first run asks for the AI: four rows in order, honest chips, no word says it works, the unchecked line once', async () => {
  const h = await boot();
  assert.equal(step(h), 'ai');
  assert.equal(title(h.app), 'Connect an AI first.');
  assert.deepEqual(methods(h), ['workspace.status', 'venture.ai.status', 'venture.ai.options']);
  const rows = descendants(h.app).filter(node => node.tagName === 'details' && node.attributes['data-option']);
  assert.deepEqual(rows.map(node => node.attributes['data-option']), [...AI_OPTION_IDS]);
  const view = O.options();
  for (const option of view.options) {
    const summary = summaryOf(optionRow(h.app, option.id));
    assert.deepEqual(summary.children.map(child => child.textContent), [option.label, AI_STATUS_CHIPS[option.status]], `${option.id} shows its label and chip`);
  }
  assert.equal(/\b(works|working)\b/i.test(restText(h.app)), false, 'no word at rest says works or working');
  assert.equal(descendants(h.app).filter(node => node.ownText === AI_UNCHECKED_LINE).length, 1, 'the unchecked line shows once');
  const verified = await boot({ draft: { presets: O.presetsVerified } });
  assert.equal(text(verified.app).includes(AI_UNCHECKED_LINE), false, 'the line is computed: hidden when every connectable preset was checked');
  assert.equal(h.rejected.length, 0);
});

test('the ChatGPT row says "Not open yet" at rest and its exact reason when opened, sends nothing, and points at an OpenAI key', async () => {
  const h = await boot();
  const chatgpt = optionRow(h.app, 'chatgpt-sign-in');
  assert.equal(summaryOf(chatgpt).children[1].textContent, 'Not open yet');
  await open(chatgpt);
  assert.ok(text(chatgpt).includes(AI_OPTION_WORDS['chatgpt-sign-in'].why), 'the exact reason');
  assert.deepEqual(descendants(chatgpt).filter(node => node.tagName === 'button').map(node => node.textContent), ['Use an OpenAI key instead'], 'no control that connects');
  const before = h.calls.length;
  await click(button(chatgpt, 'Use an OpenAI key instead'));
  assert.equal(h.calls.length, before, 'nothing is sent');
  const keyRow = optionRow(h.app, 'api-key');
  assert.equal(keyRow.open, true);
  assert.equal(keyRow.attributes['data-provider'], 'openai');
  assert.ok(text(keyRow).includes('GPT-6 Luna.') && text(keyRow).includes('Model id, as your account shows it'));
});

test('the recommended Anthropic pair: consent first, fast then main with the digests, a key outside any form, cleared after', async () => {
  const h = await boot();
  await open(optionRow(h.app, 'api-key'));
  const pair = find(h.app, node => node.attributes['data-preset'] === 'recommended');
  assert.ok(text(pair).includes('One key: Claude Haiku 5.5 for quick work, Sonnet 5.5 for plans.'));
  assert.ok(text(pair).includes(`Can connect · ${O.LIVE_KEY}`), 'the chip and the verification note');
  assert.ok(text(pair).includes(O.presets[0].consentText), 'consent word for word');
  const key = find(pair, node => node.tagName === 'input' && node.attributes.type === 'password');
  assert.equal(key.attributes.autocomplete, 'off');
  assert.equal(ancestors(key).some(node => node.tagName === 'form'), false, 'the key field sits outside any form');
  const connect = button(pair, 'Connect');
  assert.equal(connect.disabled, true);
  await type(key, KEY);
  await click(connect);
  assert.equal(callsOf(h, 'venture.ai.connect').length, 0, 'nothing is sent before the box is ticked');
  await tick(find(pair, node => node.tagName === 'input' && node.attributes.type === 'checkbox'));
  await click(connect);
  assert.deepEqual(callsOf(h, 'venture.ai.connect').map(call => call.payload), [
    { presetId: 'anthropic-haiku-5-5', consentDigest: O.presets[0].consentDigest, apiKey: KEY, tiers: ['fast'] },
    { presetId: 'anthropic-sonnet-5-5', consentDigest: O.presets[1].consentDigest, apiKey: KEY, tiers: ['main'] },
  ]);
  assert.equal(key.value, '', 'the key is cleared');
  assert.equal(step(h), 'idea', 'a usable main tier moves on to the open box');
  assert.equal(h.rejected.length, 0);
});

test('half connected: the second call fails, the screen says so, asks for the key again and sends one main call', async () => {
  const draft = { failMain: true };
  const h = await boot({ draft });
  await open(optionRow(h.app, 'api-key'));
  let pair = find(h.app, node => node.attributes['data-preset'] === 'recommended');
  await type(find(pair, node => node.tagName === 'input' && node.attributes.type === 'password'), KEY);
  await tick(find(pair, node => node.tagName === 'input' && node.attributes.type === 'checkbox'));
  await click(button(pair, 'Connect'));
  assert.equal(step(h), 'ai', 'Connect does not move on without a main tier');
  pair = find(h.app, node => node.attributes['data-preset'] === 'recommended');
  assert.ok(text(pair).includes(AI_HALF_CONNECTED_WORDS));
  assert.ok(text(pair).includes(O.PASS_THROUGH.MODEL_FAILED), "the engine's error words");
  const again = find(pair, node => node.tagName === 'input' && node.attributes.type === 'password');
  assert.equal(again.value, '', 'the key field again, empty');
  draft.failMain = false;
  await type(again, KEY);
  await tick(find(pair, node => node.tagName === 'input' && node.attributes.type === 'checkbox'));
  await click(button(pair, 'Connect Sonnet 5.5 for plans'));
  assert.deepEqual(callsOf(h, 'venture.ai.connect').map(call => call.payload.presetId), ['anthropic-haiku-5-5', 'anthropic-sonnet-5-5', 'anthropic-sonnet-5-5'], 'only the main call again');
  assert.deepEqual(callsOf(h, 'venture.ai.connect').at(-1)!.payload.tiers, ['main']);
  assert.equal(step(h), 'idea');
  // A reload while half connected opens the key row in the same state.
  const reloaded = await boot({ draft: { ai: O.statusHalf } });
  assert.equal(optionRow(reloaded.app, 'api-key').open, true);
  assert.ok(buttons(reloaded.app, 'Connect Sonnet 5.5 for plans').length === 1);
});

test('an AI for plans with nothing for quick work stays on Connect, because the engine reads the sentence on the quick tier', async () => {
  const h = await boot({ draft: { ai: O.statusMainOnly } });
  assert.equal(step(h), 'ai');
  assert.equal(title(h.app), 'Connect an AI first.', 'no Back, since the open box could not be used');
  assert.equal(callsOf(h, 'venture.compose.get').length, 0, 'no held plan is asked for');
  assert.ok(text(screen(h)).includes('Continue without AI'), 'the skip link still promises no AI, since none can plan yet');
});

test('a returning owner can open their business from the first screen, since every restart starts on Connect', async () => {
  const h = await boot();
  assert.equal(step(h), 'ai');
  await click(button(screen(h), 'Open my business'));
  assert.equal(step(h), 'back');
  assert.equal(title(h.app), 'Welcome back.');
  // Once an AI is connected for plans, Connect is "Change your AI." and the open box carries the way back in.
  const connected = await boot({ draft: { ai: O.statusPair } });
  await click(button(screen(connected), 'Change AI'));
  assert.equal(buttons(screen(connected), 'Open my business').length, 0);
});

test('Claude Code waits behind the terms gate; once open, Check and connect sends only the preset and consent; Codex says why', async () => {
  const pending = await boot();
  const claude = optionRow(pending.app, 'claude-code');
  assert.equal(summaryOf(claude).children[1].textContent, 'Needs setup');
  await open(claude);
  assert.ok(text(claude).includes(AVAILABILITY_REASONS.claudeTerms), 'the terms words');
  assert.equal(buttons(claude, 'Check and connect').length, 0, 'no connect control while the gate is closed');
  const codex = optionRow(pending.app, 'codex');
  await open(codex);
  assert.ok(text(codex).includes(AI_OPTION_WORDS.codex.why));
  assert.equal(button(codex, 'Connect').disabled, true, 'Codex cannot connect while it needs setup');

  const gate = await boot({ draft: { gateOpen: true } });
  const row = optionRow(gate.app, 'claude-code');
  assert.equal(summaryOf(row).children[1].textContent, 'Can connect');
  await open(row);
  await tick(find(row, node => node.tagName === 'input' && node.attributes.type === 'checkbox'));
  await click(button(row, 'Check and connect'));
  const claudePreset = O.presetsGateOpen.find(preset => preset.id === 'claude-code-cli')!;
  assert.deepEqual(callsOf(gate, 'venture.ai.connect').map(call => call.payload), [{ presetId: 'claude-code-cli', consentDigest: claudePreset.consentDigest }]);
  assert.equal(step(gate), 'idea');
});

test('Continue without AI leads to the open box and then the built-in plan, labelled as not fitted', async () => {
  const h = await boot();
  await click(button(h.app, 'Continue without AI'));
  assert.equal(title(h.app), 'What do you want to do?');
  await askFor(h, 'Monthly bookkeeping for cafes.');
  assert.deepEqual(h.calls.at(-1), { method: 'venture.preview', payload: { idea: 'Monthly bookkeeping for cafes.', countryCode: 'IN' } });
  assert.ok(visibleText(h.app).includes('Built-in plan, not fitted to what you wrote.'));
  assert.equal(callsOf(h, 'venture.compose.decide').length, 0, 'no AI call without an AI');
});

// ---------------------------------------------------------------------------------------------
// 6 to 9: the open box, Working, the plan, prices
// ---------------------------------------------------------------------------------------------
test('the open box: one textarea, examples fill it at once with no request, submit sends exactly the text and country', async () => {
  const h = await boot(connected(), { language: 'en-GB' });
  assert.equal(title(h.app), 'What do you want to do?');
  assert.deepEqual(methods(h), ['workspace.status', 'venture.ai.status', 'venture.compose.get', 'venture.countries']);
  assert.equal(descendants(h.app).filter(node => node.tagName === 'textarea').length, 1);
  const examples = find(h.app, node => node.tagName === 'details' && summaryOf(node)?.textContent === 'Examples');
  assert.equal(examples.open, false, 'the examples wait in a fold');
  await open(examples);
  const before = h.calls.length;
  await click(button(examples, 'Dog walking for nurses'));
  assert.equal(find(h.app, node => node.tagName === 'textarea').value, O.DOG_TEXT, 'the full sentence, at once');
  assert.equal(h.calls.length, before, 'no request');
  await click(goButton(h.app)); await flush();
  assert.deepEqual(callsOf(h, 'venture.compose.decide').map(call => call.payload), [{ text: O.DOG_TEXT, countryCode: 'GB' }]);
});

test('Working shows still outlines in the decided views; the plan draws each view by its id, lead open, first support folded', async () => {
  let hh: H;
  const fill = heldFill(() => O.planFor('dog', hh.world.draft.decision!));
  hh = await boot(connected({}, { overrides: { 'venture.compose.fill': fill.override } }), { language: 'en-GB' });
  await askAndHold(hh, O.DOG_TEXT);
  assert.equal(step(hh), 'working');
  assert.deepEqual(descendants(hh.app).filter(node => hasClass(node, 'ob-outline')).map(node => node.attributes['data-view']), ['offers-first', 'pages', 'notes']);
  assert.ok(text(hh.app).includes('Writing your plan with Claude Sonnet 5.5. This can take a minute.'));
  assert.equal(descendants(hh.app).some(node => /spin|loading/.test(node.className)), false, 'no spinner');
  fill.gate.release(); await flush();
  assert.equal(step(hh), 'plan');
  const lead = find(hh.app, node => node.tagName === 'section' && node.attributes['data-view'] === 'offers-first');
  assert.equal(ancestors(lead).some(node => node.tagName === 'details'), false, 'the lead view is open at rest');
  assert.deepEqual(descendants(lead).filter(node => hasClass(node, 'ob-offer-name')).map(node => node.textContent), ['Weekly walks', 'Walk pack']);
  const pages = find(hh.app, node => node.tagName === 'details' && node.attributes['data-view'] === 'pages');
  assert.equal(pages.open, false);
  assert.equal(summaryOf(pages).textContent, 'Your website');
  const more = find(hh.app, node => node.tagName === 'details' && summaryOf(node)?.textContent === 'More of your plan');
  assert.ok(descendants(more).some(node => node.attributes['data-view'] === 'notes'), 'later support views live in More of your plan');
  assert.ok(text(more).includes(`Chausar read this as: ${KIND_LABELS.idea}.`));

  const skill = await boot(connected());
  await askFor(skill, O.EXCEL_TEXT);
  const steps = find(skill.app, node => node.tagName === 'section' && node.attributes['data-view'] === 'steps-first');
  assert.deepEqual(descendants(steps).filter(node => hasClass(node, 'ob-who')).map(node => node.textContent), ['You', 'You', 'Agent drafts'], 'who chips from the block data');
  assert.equal(find(skill.app, node => node.tagName === 'details' && node.attributes['data-view'] === 'questions').open, false);

  const problem = await boot(connected());
  await askFor(problem, O.CAFE_TEXT);
  const audience = find(problem.app, node => node.tagName === 'section' && node.attributes['data-view'] === 'audience-first');
  assert.ok(text(audience).includes('Small cafe owners') && text(audience).includes('Bills get lost and the books fall behind.'));
});

test('not a service shows the refusal and offers a built-in plan with no fill; a refused plan offers three ways on and draws none', async () => {
  const h = await boot(connected());
  await askFor(h, O.LANDLORD_TEXT);
  assert.equal(step(h), 'not-a-service');
  assert.equal(title(h.app), "Chausar can't plan this one.");
  assert.ok(text(h.app).includes(NOT_A_SERVICE_WORDS));
  assert.equal(callsOf(h, 'venture.compose.fill').length, 0, 'no fill for a refusal');
  await click(button(h.app, 'Use a built-in plan'));
  assert.deepEqual(h.calls.at(-1), { method: 'venture.preview', payload: { idea: O.LANDLORD_TEXT, countryCode: 'IN' } });
  assert.ok(visibleText(h.app).includes('Built-in plan, not fitted to what you wrote.'));

  const refusal = () => { throw Object.assign(new Error(O.COMPOSE_REFUSED.message), { code: O.COMPOSE_REFUSED.code }); };
  const refused = await boot(connected({}, { overrides: { 'venture.compose.fill': refusal } }));
  await askFor(refused, O.CAFE_TEXT);
  assert.equal(step(refused), 'refused');
  assert.equal(title(refused.app), "There's no plan to show.");
  assert.ok(text(refused.app).includes(COMPOSE_REFUSED_WORDS));
  for (const words of ['Try again', 'Change what I wrote', 'Use a built-in plan']) assert.equal(buttons(refused.app, words).length, 1, words);
  assert.equal(descendants(refused.app).some(node => node.tagName === 'section' && node.attributes['data-view']), false, 'no plan is drawn');
  const sent = find(refused.app, node => node.tagName === 'details' && summaryOf(node)?.textContent === 'What was sent');
  await open(sent);
  assert.deepEqual(callsOf(refused, 'venture.ai.calls').map(call => call.payload), [{ limit: 20 }]);
  assert.ok(text(sent).includes('Writing your plan') && text(sent).includes("failed Chausar's checks"), 'a rejected answer says it failed the checks');
  assert.equal(text(sent).includes('refused'), false, 'nobody refused: the AI answered and Chausar rejected it');
  await click(button(refused.app, 'Try again'));
  assert.equal(callsOf(refused, 'venture.compose.fill').length, 2, 'Try again fills again with the same decision');
  assert.equal(callsOf(refused, 'venture.compose.decide').length, 1);
  await click(button(refused.app, 'Use a built-in plan'));
  assert.equal(h.calls.at(-1)!.method, 'venture.preview');
});

test('prices: every offer is listed, typed text goes as typed, the engine display comes back, no tax or total before the vault', async () => {
  const h = await boot(connected(), { language: 'en-GB' });
  await askFor(h, O.DOG_TEXT);
  await click(button(h.app, 'Set your prices'));
  assert.equal(step(h), 'prices');
  assert.deepEqual(descendants(h.app).filter(node => hasClass(node, 'ob-price-row')).map(node => node.attributes['data-offer']), ['offer_1', 'offer_2']);
  const walks = find(h.app, node => node.attributes['aria-label'] === 'Price of Weekly walks, in GBP');
  assert.equal(walks.attributes.placeholder, undefined, 'no placeholder');
  await type(walks, '18');
  await walks.dispatch('change'); await flush();
  const plan = h.world.draft.plan!;
  assert.deepEqual(callsOf(h, 'venture.compose.update').map(call => call.payload), [{ composeId: plan.composeId, patch: { offers: [{ id: 'offer_1', unitPrice: '18' }] } }]);
  assert.equal(find(h.app, node => node.className === 'ob-fig').textContent, plan.offers[0].priceDisplay, "the engine's display string");
  await type(find(h.app, node => node.attributes['aria-label'] === 'Price of Walk pack, in GBP'), '60.50');
  for (const banned of [/\btotal\b/i, /\bVAT at\b/, /incl/i]) assert.equal(banned.test(restText(h.app)), false, `${banned} before Keep it safe`);
  await click(button(h.app, 'Keep this plan'));
  assert.deepEqual(callsOf(h, 'venture.compose.update').at(-1)!.payload.patch, { offers: [{ id: 'offer_2', unitPrice: '60.50' }] }, 'an unsent price goes before Keep it safe');
  assert.equal(step(h), 'keep');
  for (const call of callsOf(h, 'venture.compose.update')) assert.deepEqual(Object.keys(call.payload).sort(), ['composeId', 'patch'], 'never the plan itself');
});

// ---------------------------------------------------------------------------------------------
// 10 to 13: keep it safe, the recovery code, Accept and Build; reload; pairing and Welcome back
// ---------------------------------------------------------------------------------------------
test('Keep it safe, the recovery code, venture.create by id and digest, a receipt per priced offer, Accept, then Build in look B', async () => {
  const h = await boot(connected(), { language: 'en-GB' });
  await askFor(h, O.DOG_TEXT);
  await click(button(h.app, 'Set your prices'));
  const walks = find(h.app, node => node.attributes['aria-label'] === 'Price of Weekly walks, in GBP');
  await type(walks, '18'); await walks.dispatch('change'); await flush();
  const kept = h.world.draft.plan!;
  await click(button(h.app, 'Keep this plan'));
  assert.equal(control(h.app, 'Working name').value, kept.name.value, 'prefilled with the plan name');
  await type(control(h.app, 'Passphrase'), 'long-enough-passphrase');
  await type(control(h.app, 'Type it again'), 'long-enough-passphrase');
  await find(h.app, node => node.tagName === 'form').dispatch('submit'); await flush();
  assert.equal(step(h), 'code');
  assert.ok(visibleText(rightPane(h)).includes('Locked on this computer'));
  await tick(find(h.app, node => node.tagName === 'input' && node.attributes.type === 'checkbox'));
  await click(button(h.app, 'Continue')); await flush();
  assert.equal(step(h), 'open');
  const order = h.calls.slice(h.calls.findIndex(call => call.method === 'workspace.create'));
  assert.deepEqual(order.slice(0, 7), [
    { method: 'workspace.create', payload: { name: kept.name.value, passphrase: 'long-enough-passphrase', pack: 'services', folder: 'leeds-shift-walkers' } },
    { method: 'workspace.status', payload: {} },
    { method: 'venture.create', payload: { idea: O.DOG_TEXT, countryCode: 'GB', workingName: kept.name.value, composeId: kept.composeId, composedDigest: kept.digest } },
    { method: 'venture.price.quote', payload: { offerId: 'offer_1' } },
    { method: 'venture.get', payload: {} }, { method: 'venture.blueprint.get', payload: {} }, { method: 'venture.models.status', payload: {} },
  ]);
  for (const words of ['Your website', 'Tools to connect', 'Check before you start']) assert.ok(descendants(h.app).some(node => node.tagName === 'summary' && node.textContent === words), words);
  assert.ok(text(h.app).includes('GBP 18.00'), 'the receipt display');
  await click(button(h.app, 'Accept plan')); await flush();
  assert.equal(step(h), 'build');
  assert.deepEqual(h.calls.slice(h.calls.findIndex(call => call.method === 'venture.blueprint.accept') - 1).map(call => call.method),
    ['venture.blueprint.get', 'venture.blueprint.accept', 'venture.models.status', 'venture.build.brief', 'venture.build.status']);
  assert.deepEqual(callsOf(h, 'venture.blueprint.accept')[0].payload, { digest: O.composedBlueprintView.blueprint.digest });
  assert.equal(h.rejected.length, 0);
});

test('the recovery code: a real code in chunks of up to four that rejoin to it exactly; Copy and Save as file take the exact string', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-recovery-'));
  try {
    const { vault, recoveryCode } = await Vault.create({ directory, storage: 'experimental-file', passphrase: 'Synthetic recovery chunks only', name: 'Synthetic recovery chunks' });
    await vault.close();
    const h = await boot();
    let continued = 0;
    h.renderer.launch.showRecoveryCode({ recoveryCode, folder: 'main' }, () => { continued++; });
    const chunks = descendants(h.app).filter(node => hasClass(node, 'ob-chunk')).map(node => node.textContent);
    assert.equal(chunks.join(''), recoveryCode, 'the chunks rejoin to the exact code');
    assert.ok(chunks.every(chunk => chunk.length >= 1 && chunk.length <= 4), 'every chunk holds one to four characters');
    assert.equal(chunks.slice(0, -1).every(chunk => chunk.length === 4), true, 'fixed chunks of four from the start');
    await click(button(h.app, 'Copy'));
    assert.deepEqual(h.clipboard, [recoveryCode]);
    await click(button(h.app, 'Save as file'));
    assert.ok(h.saved()[0].text!.split('\n').includes(recoveryCode));
    assert.equal(button(h.app, 'Continue').disabled, true);
    await tick(find(h.app, node => node.tagName === 'input' && node.attributes.type === 'checkbox'));
    await click(button(h.app, 'Continue'));
    assert.equal(continued, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('a reload with a connected AI and a held plan resumes on the plan, from engine memory only', async () => {
  const h = await boot({ draft: { ai: O.statusPair, held: { key: 'dog', decision: O.dogDecision, plan: O.dogPlan } } });
  assert.equal(step(h), 'plan');
  assert.equal(title(h.app), O.dogPlan.name.value);
  assert.deepEqual(methods(h), ['workspace.status', 'venture.ai.status', 'venture.compose.get']);
  for (const storage of ['localStorage', 'sessionStorage', 'indexedDB']) assert.equal(launchSource.includes(storage), false, `${storage} is never touched`);
});

test('a tax made of capitals keeps them inside a sentence, and the renderer sources hold no control characters', async () => {
  const h = await boot({ draft: { ai: O.statusPair, held: { key: 'dog', decision: O.dogDecision, plan: O.dogPlan } } });
  assert.equal(O.dogPlan.backOffice.taxLabel, 'VAT');
  assert.ok(text(screen(h)).includes('Tax: not registered for VAT.'), 'VAT stays in capitals');
  // A stray control character once turned a regex's \b into a backspace, so "VAT" read "vat".
  for (const [name, source] of [['launch.js', launchSource], ['styles.css', cssSource]]) {
    assert.equal(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(source), false, `${name} holds a control character`);
  }
});

test('pairing and Welcome back are drawn in look B and send what the old screens sent', async () => {
  const pairing = await harness({}, { browser: { open: () => null } });
  pairing.renderer.state.token = null;
  await pairing.renderer.boot(); await flush();
  assert.equal(step(pairing), 'pair');
  assert.equal(title(pairing.app), 'Pair this browser.');
  const code = control(pairing.app, 'Pairing link or code');
  assert.equal(code.attributes.type, 'password');
  await type(code, 'A'.repeat(43));
  await find(pairing.app, node => node.tagName === 'form').dispatch('submit'); await flush();
  assert.equal(pairing.renderer.state.token, 'A'.repeat(43));
  assert.equal(code.value, '', 'the code is not kept in the field');
  assert.equal(step(pairing), 'ai', 'paired: the engine status opens Connect');

  const world: { open: boolean } = { open: false };
  const h = await boot({ overrides: { 'workspace.open': () => { world.open = true; return { workspace: { name: 'Ledger Cafe Books' } }; }, 'workspace.recover': () => ({ workspace: { name: 'Ledger Cafe Books' } }) } });
  await click(button(h.app, 'Continue without AI'));
  await click(button(h.app, 'Open it'));
  assert.equal(step(h), 'back');
  assert.equal(title(h.app), 'Welcome back.');
  await type(control(h.app, 'Passphrase'), 'long-enough-passphrase');
  await find(h.app, node => node.tagName === 'form').dispatch('submit'); await flush();
  assert.deepEqual(callsOf(h, 'workspace.open').map(call => call.payload), [{ folder: 'main', passphrase: 'long-enough-passphrase' }]);
  assert.equal(world.open, true);

  const recover = await boot({ overrides: { 'workspace.recover': () => ({ workspace: { name: 'Ledger Cafe Books' } }) } });
  recover.renderer.launch.openExisting('');
  await click(button(recover.app, 'Use my recovery code'));
  await type(control(recover.app, 'Vault folder'), 'ledger-cafe-books');
  await type(control(recover.app, 'Recovery code'), 'DEMO-RECOVERY-CODE');
  await type(control(recover.app, 'New passphrase'), 'another-long-passphrase');
  await type(control(recover.app, 'Type it again'), 'another-long-passphrase');
  await find(recover.app, node => node.tagName === 'form').dispatch('submit'); await flush();
  assert.deepEqual(callsOf(recover, 'workspace.recover').map(call => call.payload), [{ folder: 'ledger-cafe-books', recoveryCode: 'DEMO-RECOVERY-CODE', passphrase: 'another-long-passphrase' }]);
});

// ---------------------------------------------------------------------------------------------
// 14 to 16: words at rest, model names, the right pane
// ---------------------------------------------------------------------------------------------
/**
 * Accept and Build reuse the business and build places (52 and 55 words as places). In onboarding they fold what
 * they can (founder flag F10): Accept drops the version number and the Offers heading, which leaves the longest
 * composed plan (three priced four-word offers, a sixty-character name, a replay) at exactly 45; Build measures 44.
 */
const BUDGETS: Record<string, number> = {
  pair: 35, ai: 45, idea: 45, working: 45, plan: 45, prices: 45, 'not-a-service': 35, refused: 40, error: 45,
  'built-in': 45, 'built-in-prices': 45, keep: 45, code: 45, setup: 25, open: 45, build: 45, back: 40,
};
function measure(t: { diagnostic(message: string): void }, label: string, h: H, budget = BUDGETS[label]) {
  const words = restWords(h.app);
  t.diagnostic(`${label}: ${words} words at rest (budget ${budget})`);
  if (process.env.P7_SHOW_WORDS) t.diagnostic(restText(h.app));
  assert.ok(words <= budget, `${label} shows ${words} words at rest, over ${budget}: ${restText(h.app)}`);
  assert.ok(filledAtRest(h.app).length <= 1, `${label}: one filled button at most`);
  return words;
}

test('words at rest: every screen within its budget with the longest answers, the longest country and the longest model words', async t => {
  // Connect, then the open box in the United Arab Emirates with Claude Code connected.
  measure(t, 'ai', await boot());
  const maxDraft = { ai: O.statusClaudeCode };
  const idea = await boot({ draft: maxDraft }, { language: 'en-AE' });
  assert.ok(text(idea.app).includes('Based in United Arab Emirates'));
  measure(t, 'idea', idea);

  // Working: reading, then writing, with every decided view outlined.
  for (const key of ['maxSteps', 'maxAudience', 'maxOffers'] as const) {
    const decision = O.maxDecisions[key];
    let release: () => void = () => {};
    const working = await boot({ draft: maxDraft, overrides: {
      'venture.compose.decide': () => new Promise(resolve => { release = () => resolve(decision); }),
      'venture.compose.fill': () => new Promise(() => {}),
    } }, { language: 'en-AE' });
    await type(find(working.app, node => node.tagName === 'textarea'), O.MAX_TEXT);
    void goButton(working.app).dispatch('click'); await flush();
    measure(t, 'working', working);
    release(); await flush();
    assert.ok(text(working.app).includes('Writing your plan with Claude Code (Sonnet 5.5). This can take a minute.'));
    measure(t, 'working', working);
  }
  // The plan and the prices, resumed from the held plan.
  for (const key of ['maxSteps', 'maxAudience', 'maxOffers'] as const) {
    const plan = O.maxPlans[key];
    const h = await boot({ draft: { ...maxDraft, held: { key, decision: O.maxDecisions[key], plan } } });
    assert.equal(step(h), 'plan');
    measure(t, 'plan', h);
    await click(button(h.app, 'Set your prices'));
    for (const offer of plan.offers) await type(find(h.app, node => node.attributes['aria-label'] === `Price of ${offer.name.value}, in AED`), '1250');
    measure(t, 'prices', h);
  }
  // Not a service, refused, and every error that passes straight through.
  const notService = await boot(connected());
  await askFor(notService, O.LANDLORD_TEXT);
  measure(t, 'not-a-service', notService);
  const refused = await boot(connected({}, { overrides: { 'venture.compose.fill': () => { throw Object.assign(new Error(O.COMPOSE_REFUSED.message), { code: 'COMPOSE_REFUSED' }); } } }));
  await askFor(refused, O.CAFE_TEXT);
  measure(t, 'refused', refused);
  for (const [code, message] of Object.entries(O.PASS_THROUGH)) {
    assert.ok(message.split(/\s+/).length <= 30, `${code}: the engine's words fit in thirty`);
    if (code === 'NO_MODEL_CONNECTED') continue; // goes back to Connect, as the cleared draft does
    const failing = await boot(connected({}, { overrides: { 'venture.compose.fill': () => { throw Object.assign(new Error(message), { code }); } } }));
    await askFor(failing, O.CAFE_TEXT);
    assert.equal(step(failing), 'error', code);
    assert.ok(text(failing.app).includes(message), `${code}: the engine's own words`);
    measure(t, 'error', failing);
  }
  // The built-in plan and its price screen.
  const builtIn = await boot();
  await click(button(builtIn.app, 'Continue without AI'));
  await askFor(builtIn, 'Monthly bookkeeping for cafes and small shops in Pune.');
  measure(t, 'built-in', builtIn);
  await click(button(builtIn.app, 'Set your price'));
  measure(t, 'built-in-prices', builtIn);
  // Keep it safe, the recovery code, setting up, Accept and Build, from the longest plan.
  const keep = await boot({ draft: { ...maxDraft, held: { key: 'maxOffers', decision: O.maxDecisions.maxOffers, plan: O.maxPlans.maxOffers } } });
  await click(button(keep.app, 'Set your prices'));
  await click(button(keep.app, 'Keep this plan'));
  assert.equal(control(keep.app, 'Working name').value, O.MAX.name);
  measure(t, 'keep', keep);
  keep.renderer.launch.showRecoveryCode({ recoveryCode: 'A1b2-C3d4_E5f6G7h8I9j0K1l2M3n4O5p6Q7r8', folder: 'northumberlands-neighbourhoods-companionships-collaboratives' }, () => {});
  measure(t, 'code', keep);
  const flow = await boot(connected(), { language: 'en-GB' });
  await askFor(flow, O.DOG_TEXT);
  await click(button(flow.app, 'Set your prices'));
  const walks = find(flow.app, node => node.attributes['aria-label'] === 'Price of Weekly walks, in GBP');
  await type(walks, '18'); await walks.dispatch('change'); await flush();
  await click(button(flow.app, 'Keep this plan'));
  await type(control(flow.app, 'Passphrase'), 'long-enough-passphrase');
  await type(control(flow.app, 'Type it again'), 'long-enough-passphrase');
  await find(flow.app, node => node.tagName === 'form').dispatch('submit'); await flush();
  await tick(find(flow.app, node => node.tagName === 'input' && node.attributes.type === 'checkbox'));
  await click(button(flow.app, 'Continue')); await flush();
  measure(t, 'open', flow);
  await click(button(flow.app, 'Accept plan')); await flush();
  measure(t, 'build', flow);
  // Setting up waits on venture.create.
  const slow = await boot({ draft: { ai: O.statusPair, held: { key: 'dog', decision: O.dogDecision, plan: O.dogPlan } }, overrides: { 'venture.create': () => new Promise(() => {}) } }, { language: 'en-GB' });
  await click(button(slow.app, 'Set your prices'));
  await click(button(slow.app, 'Keep this plan'));
  await type(control(slow.app, 'Passphrase'), 'long-enough-passphrase');
  await type(control(slow.app, 'Type it again'), 'long-enough-passphrase');
  await find(slow.app, node => node.tagName === 'form').dispatch('submit'); await flush();
  await tick(find(slow.app, node => node.tagName === 'input' && node.attributes.type === 'checkbox'));
  await click(button(slow.app, 'Continue'));
  assert.equal(step(slow), 'setup');
  measure(t, 'setup', slow);
  // Pairing and Welcome back.
  const pairing = await harness({}, { browser: { open: () => null } });
  pairing.renderer.state.token = null;
  await pairing.renderer.boot(); await flush();
  measure(t, 'pair', pairing);
  const back = await boot();
  back.renderer.launch.openExisting('');
  measure(t, 'back', back);
});

test('words at rest on Accept and Build with the longest composed plan: three priced offers, each with a receipt', async t => {
  let fixture: ReturnType<typeof O.composedBlueprintFor> | null = null;
  let accepted = false;
  const h = await boot({ draft: { ai: O.statusClaudeCode, held: { key: 'maxOffers', decision: O.maxDecisions.maxOffers, plan: O.maxPlans.maxOffers } }, overrides: {
    'venture.get': () => fixture?.venture ?? null,
    'venture.blueprint.get': () => (accepted ? fixture!.accepted : fixture!.draft),
    'venture.blueprint.accept': () => { accepted = true; return fixture!.accepted; },
    'venture.price.quote': (_method, payload) => fixture!.draft.offerReceipts[payload.offerId],
  } }, { language: 'en-AE' });
  await click(button(h.app, 'Set your prices'));
  for (const offer of O.maxPlans.maxOffers.offers) {
    const input = find(h.app, node => node.attributes['aria-label'] === `Price of ${offer.name.value}, in AED`);
    await type(input, '1250'); await input.dispatch('change'); await flush();
  }
  await click(button(h.app, 'Keep this plan'));
  await type(control(h.app, 'Passphrase'), 'long-enough-passphrase');
  await type(control(h.app, 'Type it again'), 'long-enough-passphrase');
  await find(h.app, node => node.tagName === 'form').dispatch('submit'); await flush();
  fixture = O.composedBlueprintFor(h.world.draft.plan!, O.composedVentureView);
  await tick(find(h.app, node => node.tagName === 'input' && node.attributes.type === 'checkbox'));
  await click(button(h.app, 'Continue')); await flush();
  assert.equal(step(h), 'open');
  assert.deepEqual(callsOf(h, 'venture.price.quote').map(call => call.payload.offerId), ['offer_1', 'offer_2', 'offer_3'], 'a receipt for every priced offer');
  for (const offer of O.maxPlans.maxOffers.offers) assert.ok(text(h.app).includes(offer.name.value));
  assert.ok(visibleText(h.app).includes('From a synthetic recording'), 'who wrote it still shows at rest');
  assert.equal(measure(t, 'open', h), 45, 'the longest plan fills the budget exactly');
  await click(button(h.app, 'Accept plan')); await flush();
  assert.equal(step(h), 'build');
  measure(t, 'build', h);
});

test('model names come from the live status: a replay says synthetic recording, a replay plan says so too, Claude Code names Sonnet', async () => {
  const replay = await boot({ draft: { ai: O.statusPairReplay, replay: true }, overrides: { 'venture.compose.fill': () => new Promise(() => {}) } }, { language: 'en-GB' });
  await askAndHold(replay, O.DOG_TEXT);
  const working = text(replay.app);
  assert.ok(working.includes('Writing your plan from a synthetic recording. This can take a minute.'));
  assert.equal(/Haiku|Sonnet|GPT/.test(working), false, 'no model is named in a replay');
  const replayPlan = O.planFor('dog', O.dogDecision, O.WRITTEN_REPLAY);
  const heldReplay = await boot({ draft: { ai: O.statusPair, held: { key: 'dog', decision: O.dogDecision, plan: replayPlan } } });
  assert.ok(visibleText(heldReplay.app).includes('Drafted from a synthetic recording.'), 'a replay plan says so even when the status is live');
  const live = await boot({ draft: { ai: O.statusPair, held: { key: 'dog', decision: O.dogDecision, plan: O.dogPlan } } });
  assert.ok(visibleText(live.app).includes('Drafted with Claude Sonnet 5.5.'));

  let release: () => void = () => {};
  const claude = await boot({ draft: { ai: O.statusClaudeCode }, overrides: { 'venture.compose.decide': () => new Promise(resolve => { release = () => resolve(O.dogDecision); }), 'venture.compose.fill': () => new Promise(() => {}) } });
  await type(find(claude.app, node => node.tagName === 'textarea'), O.DOG_TEXT);
  void goButton(claude.app).dispatch('click'); await flush();
  assert.ok(text(claude.app).includes('Reading what you wrote with Claude Code (Sonnet 5.5).'));
  release(); await flush();
  assert.ok(text(claude.app).includes('Writing your plan with Claude Code (Sonnet 5.5).'));
  assert.equal(text(claude.app).includes('Haiku'), false, 'Claude Code never names Haiku');
});

test('the right pane is decorative: aria-hidden, only its two fixed phrases or words from the left pane; the phone strip has none', async () => {
  const words = (node: Element) => visibleText(node).join(' ').split(/\s+/).filter(token => /[\p{L}\p{N}]/u.test(token));
  const allowed = ['Your business', 'Locked on this computer'];
  const check = (h: H, label: string) => {
    const pane = rightPane(h);
    assert.equal(pane.attributes['aria-hidden'], 'true', `${label}: aria-hidden`);
    const typed = descendants(leftPane(h)).filter(node => node.tagName === 'textarea').map(node => node.value);
    const left = new Set([...words(leftPane(h)), ...typed.join(' ').split(/\s+/)]);
    const phrase = visibleText(pane).join(' ').replace(/\s+/g, ' ').trim();
    const rest = allowed.reduce((value, item) => value.replace(item, ' '), phrase);
    for (const word of rest.split(/\s+/).filter(Boolean)) assert.ok(left.has(word), `${label}: "${word}" in the right pane is not in the left pane`);
    const strip = find(h.app, node => hasClass(node, 'ob-strip'));
    assert.equal(strip.attributes['aria-hidden'], 'true');
    assert.deepEqual(words(strip), [], `${label}: the strip has no words`);
  };
  const h = await boot(connected(), { language: 'en-GB' });
  check(h, 'idea');
  assert.ok(visibleText(rightPane(h)).includes('Your business'));
  await type(find(h.app, node => node.tagName === 'textarea'), O.DOG_TEXT);
  check(h, 'idea, typed');
  await click(goButton(h.app)); await flush();
  check(h, 'plan');
  await click(button(h.app, 'Set your prices'));
  check(h, 'prices');
  await click(button(h.app, 'Keep this plan'));
  check(h, 'keep');
  await type(control(h.app, 'Passphrase'), 'long-enough-passphrase');
  await type(control(h.app, 'Type it again'), 'long-enough-passphrase');
  await find(h.app, node => node.tagName === 'form').dispatch('submit'); await flush();
  check(h, 'code');
});

// ---------------------------------------------------------------------------------------------
// 17 and 18: the look B tokens, and the renderer copies of the contract
// ---------------------------------------------------------------------------------------------
test('look B tokens sit on the root while an .ob-root is in the page, in light and both dark rules, and paint html and body', () => {
  const css = cssSource.replace(/\r\n/g, '\n');
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(match => ({ selector: match[1].trim(), body: match[2] }));
  const defining = rules.filter(rule => /--ob-[\w-]+\s*:/.test(rule.body));
  assert.ok(defining.length >= 3);
  for (const rule of defining) assert.ok(rule.selector.startsWith(':root') && rule.selector.includes(':has(.ob-root)'), `--ob-* defined outside the root rules: ${rule.selector}`);
  const light = defining.find(rule => rule.selector === ':root:has(.ob-root)');
  const darkMedia = defining.find(rule => rule.selector === ':root:has(.ob-root):not([data-theme="light"])');
  const darkTheme = defining.find(rule => rule.selector === ':root[data-theme="dark"]:has(.ob-root)');
  assert.ok(light && darkMedia && darkTheme, 'one light rule and two dark rules');
  assert.match(css, /@media \(prefers-color-scheme:dark\)\{:root:has\(\.ob-root\):not\(\[data-theme="light"\]\)\{/);
  const names = (body: string) => new Set([...body.matchAll(/(--ob-[\w-]+)\s*:/g)].map(match => match[1]));
  const used = new Set([...css.matchAll(/var\((--ob-[\w-]+)\)/g)].map(match => match[1]));
  for (const rule of [light, darkMedia, darkTheme]) for (const name of used) assert.ok(names(rule!.body).has(name), `${name} is not defined in ${rule!.selector}`);
  const page = rules.find(rule => rule.selector === 'html:has(.ob-root),html:has(.ob-root) body');
  assert.ok(page && /background:var\(--ob-bg\)/.test(page.body), 'html and body get the look B background');
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)\{\.ob-root \*,\.ob-root \*::before,\.ob-root \*::after\{animation-duration:0ms!important;animation-delay:0ms!important;transition-duration:0ms!important;transition-delay:0ms!important\}\}/);
});

test('the renderer copies of the view registry, kind labels, AI rows, chips and fixed words equal the contract', async () => {
  const h = await boot();
  const copies = h.renderer.launch.copies;
  assert.deepEqual(Object.keys(copies.VIEWS), VIEW_REGISTRY.map(view => view.id));
  for (const view of VIEW_REGISTRY) {
    assert.deepEqual({ ...copies.VIEWS[view.id] }, { role: view.role, heading: view.heading, shape: view.outline.shape, rows: view.outline.rows }, view.id);
  }
  assert.deepEqual({ ...copies.KIND_LABELS }, { ...KIND_LABELS });
  assert.deepEqual([...copies.AI_OPTION_IDS], [...AI_OPTION_IDS]);
  assert.deepEqual({ ...copies.AI_STATUS_CHIPS }, { ...AI_STATUS_CHIPS });
  assert.equal(copies.AI_UNCHECKED_LINE, AI_UNCHECKED_LINE);
  assert.equal(copies.AI_HALF_CONNECTED_WORDS, AI_HALF_CONNECTED_WORDS);
  assert.equal(copies.NOT_A_SERVICE_WORDS, NOT_A_SERVICE_WORDS);
  assert.equal(copies.COMPOSE_REFUSED_WORDS, COMPOSE_REFUSED_WORDS);
  assert.equal(copies.CLAUDE_TERMS_REASON, AVAILABILITY_REASONS.claudeTerms);
  assert.deepEqual({ ...copies.OPEN_BOX_TEXT }, { ...OPEN_BOX_TEXT });
  assert.deepEqual([...copies.RIGHT_PANE_WORDS], ['Your business', 'Locked on this computer']);
});

test('the onboarding screens never compute money and never style elements from script', async () => {
  for (const banned of ['parseFloat', 'toFixed', 'BigInt', '.style', "setAttribute('style'", 'innerHTML', 'localStorage']) assert.equal(launchSource.includes(banned), false, `launch.js holds ${banned}`);
  const prices = launchSource.slice(launchSource.indexOf('function showPrices()'), launchSource.indexOf('async function runComposedSetup()'));
  assert.ok(prices.length > 1000, 'the prices screen is found');
  for (const pattern of [/Number\(/, /parseInt/, /Math\./, /\*\s*\d/, /\d\s*\*/, /\/\s*100\b/]) assert.equal(pattern.test(prices), false, `the prices screen holds ${pattern}`);
  const index = await readFile(join(root, 'app/renderer/index.html'), 'utf8');
  assert.match(index, /<meta name="color-scheme" content="light dark">/);
});

// ---------------------------------------------------------------------------------------------
// Going back, trying again and losing the draft: the screen never shows a plan for other words or a false error
// ---------------------------------------------------------------------------------------------
const refuse = (code: string, message: string) => () => { throw Object.assign(new Error(message), { code }); };
const CLEARED = 'Your AI and plan were only kept in memory, and they were cleared. Connect again.';
async function lockIt(h: H) {
  await type(control(h.app, 'Passphrase'), 'long-enough-passphrase');
  await type(control(h.app, 'Type it again'), 'long-enough-passphrase');
  await find(h.app, node => node.tagName === 'form').dispatch('submit'); await flush();
}
async function continuePastCode(h: H) {
  await tick(find(h.app, node => node.tagName === 'input' && node.attributes.type === 'checkbox'));
  await click(button(h.app, 'Continue')); await flush();
}
const heldDog = (rest: EngineOptions = {}, ai = O.statusPair): EngineOptions => ({ ...rest, draft: { ai, held: { key: 'dog', decision: O.dogDecision, plan: O.dogPlan } } });

test('a new sentence refused by decide, then Try again, reads the new sentence and never fills the old plan', async () => {
  const h = await boot(heldDog({ overrides: { 'venture.compose.decide': refuse(O.COMPOSE_REFUSED.code, O.COMPOSE_REFUSED.message) } }), { language: 'en-GB' });
  assert.equal(title(h.app), O.dogPlan.name.value);
  await click(button(h.app, 'Change what I wrote'));
  await askFor(h, O.CAFE_TEXT);
  assert.equal(step(h), 'refused');
  await click(button(h.app, 'Try again')); await flush();
  assert.deepEqual(callsOf(h, 'venture.compose.decide').map(call => call.payload), [{ text: O.CAFE_TEXT, countryCode: 'GB' }, { text: O.CAFE_TEXT, countryCode: 'GB' }], 'Try again reads the new sentence');
  assert.equal(callsOf(h, 'venture.compose.fill').length, 0, 'the old plan is never filled for the new words');
  assert.equal(text(h.app).includes(O.dogPlan.name.value), false, 'the old plan is not shown');
  assert.equal(step(h), 'refused');
});

test('a sentence under ten characters is caught in the box; decide refusing what was typed goes back to the box, not the AI error', async () => {
  const h = await boot(connected());
  await askFor(h, 'Tutoring');
  assert.equal(step(h), 'idea');
  assert.ok(text(h.app).includes('Say a little more: at least 10 characters.'));
  assert.equal(callsOf(h, 'venture.compose.decide').length, 0, 'nothing is sent');

  const typed = await boot(connected({}, { overrides: { 'venture.compose.decide': refuse('INVALID_VENTURE_REQUEST', 'What you want to do contains characters Chausar cannot keep.') } }));
  await askFor(typed, O.CAFE_TEXT);
  assert.equal(step(typed), 'idea', 'back to the box');
  assert.ok(text(typed.app).includes('What you want to do contains characters Chausar cannot keep.'));
  assert.equal(text(typed.app).includes("The AI didn't answer."), false);
  assert.equal(find(typed.app, node => node.tagName === 'textarea').value, O.CAFE_TEXT, 'the sentence stays in the box');

  const failing = await boot(connected({}, { overrides: { 'venture.compose.fill': refuse('MODEL_FAILED', O.PASS_THROUGH.MODEL_FAILED) } }));
  await askFor(failing, O.CAFE_TEXT);
  assert.equal(step(failing), 'error');
  await click(button(failing.app, 'Change what I wrote'));
  assert.equal(step(failing), 'idea', 'the AI error screen has a way back to the box');
});

test('a plan the engine lost sends the owner back to Connect: on a price, on Keep this plan, and on venture.create with the vault kept', async () => {
  // A price typed after the engine dropped the plan.
  const price = await boot(heldDog(), { language: 'en-GB' });
  await click(button(price.app, 'Set your prices'));
  price.world.draft.plan = null; price.world.draft.decision = null; price.world.draft.ai = O.statusNone;
  const walks = find(price.app, node => node.attributes['aria-label'] === 'Price of Weekly walks, in GBP');
  await type(walks, '18'); await walks.dispatch('change'); await flush();
  assert.equal(step(price), 'ai');
  assert.ok(text(price.app).includes(CLEARED));

  // Keep this plan with nothing new typed: the engine is asked first, so no vault is made for a plan it lost.
  const keep = await boot(heldDog(), { language: 'en-GB' });
  await click(button(keep.app, 'Set your prices'));
  keep.world.draft.plan = null; keep.world.draft.decision = null;
  await click(button(keep.app, 'Keep this plan'));
  assert.equal(step(keep), 'ai');
  assert.ok(text(keep.app).includes(CLEARED));
  assert.equal(callsOf(keep, 'workspace.create').length, 0);

  // venture.create after the vault: the plan is gone, the vault stays open, and the next plan goes straight to setup.
  let creates = 0;
  const hh: H = await boot(heldDog({ overrides: {
    'venture.create': () => {
      creates++;
      if (creates === 1) throw Object.assign(new Error('Your plan was only kept in memory, and it is gone. Make it again.'), { code: 'COMPOSE_NOT_FOUND' });
      const world = hh.world;
      world.venture = true; world.composed = true; world.blueprint = 'draft'; world.draft.plan = null; world.draft.decision = null;
      return O.composedVentureView;
    },
  } }), { language: 'en-GB' });
  await click(button(hh.app, 'Set your prices'));
  await click(button(hh.app, 'Keep this plan'));
  await lockIt(hh);
  await continuePastCode(hh);
  assert.equal(step(hh), 'ai', 'back to Connect');
  assert.ok(text(hh.app).includes(CLEARED));
  assert.equal(callsOf(hh, 'venture.get').length, 1, 'the vault was asked whether the business was made after all');
  await click(button(hh.app, 'Back'));
  assert.equal(step(hh), 'idea');
  assert.equal(buttons(hh.app, 'Open the back office').length, 1, 'the vault is still open');
  await askFor(hh, O.DOG_TEXT);
  await click(button(hh.app, 'Set your prices'));
  await click(button(hh.app, 'Keep this plan')); await flush();
  assert.equal(step(hh), 'open', 'straight to setup and Accept, no second vault');
  assert.equal(callsOf(hh, 'workspace.create').length, 1);
  assert.equal(creates, 2);
});

test('setup after a create that committed: a timed out create counts once the vault has the business, and a failed quote retries to Accept', async () => {
  let quotes = 0;
  const hh: H = await boot(heldDog({ overrides: {
    'venture.create': () => {
      const world = hh.world;
      world.venture = true; world.composed = true; world.blueprint = 'draft'; world.draft.plan = null; world.draft.decision = null;
      throw Object.assign(new Error('Chausar took too long to answer.'), { code: 'REQUEST_TIMEOUT' });
    },
    'venture.price.quote': () => {
      quotes++;
      if (quotes === 1) throw Object.assign(new Error('The calculator could not price this offer.'), { code: 'INVALID_AMOUNT' });
      return O.composedReceipt;
    },
  } }), { language: 'en-GB' });
  await click(button(hh.app, 'Set your prices'));
  const walks = find(hh.app, node => node.attributes['aria-label'] === 'Price of Weekly walks, in GBP');
  await type(walks, '18'); await walks.dispatch('change'); await flush();
  await click(button(hh.app, 'Keep this plan'));
  await lockIt(hh);
  await continuePastCode(hh);
  assert.equal(step(hh), 'setup');
  assert.ok(text(hh.app).includes('The calculator could not price this offer.'));
  assert.equal(buttons(hh.app, 'Back to the plan').length, 0, 'no way back to a plan the engine no longer holds');
  await click(button(hh.app, 'Try again')); await flush();
  assert.equal(step(hh), 'open', 'Try again reaches Accept');
  assert.equal(callsOf(hh, 'venture.create').length, 1, 'create is not sent again once it committed');
  assert.deepEqual(callsOf(hh, 'venture.price.quote').map(call => call.payload), [{ offerId: 'offer_1' }, { offerId: 'offer_1' }]);
});

test('Setting up says receipts only when an offer has a price to quote', async () => {
  const slow = await boot(heldDog({ overrides: { 'venture.create': () => new Promise(() => {}) } }), { language: 'en-GB' });
  await click(button(slow.app, 'Set your prices'));
  await click(button(slow.app, 'Keep this plan'));
  await lockIt(slow);
  await continuePastCode(slow);
  assert.equal(step(slow), 'setup');
  assert.ok(visibleText(slow.app).includes('Saving your plan.'));
  assert.equal(text(slow.app).includes('receipts'), false);
});

test('the eyebrow names the AI that wrote the plan, even after the owner connected another', async () => {
  const h = await boot(heldDog({}, O.statusLuna));
  assert.ok(visibleText(h.app).includes('Drafted with Claude Sonnet 5.5.'), "the plan's own writtenBy");
  assert.equal(text(h.app).includes('GPT-6 Luna'), false);
  const plan = O.planFor('dog', O.dogDecision, { presetId: 'claude-code-cli', model: 'claude-sonnet-5-5', replay: false });
  const claude = await boot({ draft: { ai: O.statusPair, held: { key: 'dog', decision: O.dogDecision, plan } } });
  assert.ok(visibleText(claude.app).includes('Drafted with Claude Code (Sonnet 5.5).'));
});

test('with an AI connected, Change AI offers Back and a built-in plan, never "without AI"', async () => {
  const h = await boot(connected());
  assert.equal(buttons(h.app, 'Connect an AI').length, 0);
  await click(button(h.app, 'Change AI'));
  assert.equal(step(h), 'ai');
  assert.equal(buttons(h.app, 'Continue without AI').length, 0, 'the AI stays connected, so the link may not say without AI');
  assert.equal(buttons(h.app, 'Use a built-in plan').length, 1);
  await click(button(h.app, 'Back'));
  assert.equal(step(h), 'idea');
  await askFor(h, O.DOG_TEXT);
  assert.equal(callsOf(h, 'venture.compose.decide').length, 1, 'Back keeps using the connected AI');
  await click(button(h.app, 'Change what I wrote'));
  await click(button(h.app, 'Change AI'));
  await click(button(h.app, 'Use a built-in plan'));
  assert.equal(step(h), 'idea');
  assert.equal(buttons(h.app, 'Change AI').length, 1, 'still connected, so the box says Change AI');
});

test('after a reload the kept plan names its tools from the connector catalogue, never by id', async () => {
  const p = await place('business', { overrides: { 'venture.get': () => O.composedVentureView, 'venture.blueprint.get': () => O.composedBlueprintView } });
  const tools = find(p.content, node => node.tagName === 'details' && node.children[0]?.textContent === 'Tools to connect');
  assert.ok(text(tools).includes('Cal.com: Clients pick walk times that fit their shifts.'));
  assert.equal(text(tools).includes('cal-com:'), false);
  assert.deepEqual(p.calls.filter(call => call.method === 'venture.connectors.list').map(call => call.payload), [{}]);
});

test('motion happens once: the progress segment fills when it changes and the lock badge drops in once', async () => {
  const h = await boot(heldDog(), { language: 'en-GB' });
  const segment = () => find(h.app, node => node.tagName === 'li' && hasClass(node, 'now'));
  assert.equal(hasClass(segment(), 'ob-seg-new'), true, 'the first plan frame fills its segment');
  await click(button(h.app, 'Set your prices'));
  assert.equal(hasClass(segment(), 'ob-seg-new'), false, 'prices is the same segment: no refill');
  await click(button(h.app, 'Back'));
  assert.equal(hasClass(segment(), 'ob-seg-new'), false, 'back to the plan: no refill');
  await click(button(h.app, 'Set your prices'));
  await click(button(h.app, 'Keep this plan'));
  assert.equal(hasClass(segment(), 'ob-seg-new'), true, 'Keep safe is a new segment');
  await lockIt(h);
  assert.equal(step(h), 'code');
  assert.equal(hasClass(segment(), 'ob-seg-new'), false, 'the code screen is still Keep safe');
  const badge = find(h.app, node => hasClass(node, 'ob-badge'));
  assert.equal(badge.hidden, false);
  assert.equal(hasClass(badge, 'ob-badge-new'), false, 'the badge dropped in on Keep it safe and does not again');
  assert.match(cssSource, /\.ob-progress li\.ob-seg-new \.ob-seg i\{animation:ob-fill/);
  assert.match(cssSource, /\.ob-badge\.ob-badge-new\{animation:ob-badge/);
  assert.equal(/\.ob-progress li\.now \.ob-seg i\{animation/.test(cssSource), false);
});
