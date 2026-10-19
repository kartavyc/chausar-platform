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
import * as K from './fixtures/venture/renderer/custody.ts';
import * as F from './fixtures/venture/renderer/results.ts';
import { CUSTODY_WORDS } from '../runtime/workspace-custody-contracts.ts';
import { SERVICE_TYPE_LABELS } from '../runtime/venture/contracts.ts';
import {
  EXPERIMENTAL, Element, KEY, ancestors, button, buttons, click, control, cssSource, descendants, find, flush, harness, hasClass, launchSource, place, restText, restWords, root, text, tick, type, visibleText,
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
/** Presses a button without waiting for the work it starts, for a request the test holds open. */
async function press(node: Element) { void node.dispatch('click'); await flush(); }
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
  assert.deepEqual(methods(h), ['workspace.status', 'venture.ai.status', 'workspace.list', 'venture.ai.options'], 'no business on this computer, so onboarding starts');
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
  // The website card while the AI writes: the name placeholder and the engine's reading in real words; only the
  // page list is outlined, and there is no address bar to fill.
  const site = find(rightPane(hh), node => hasClass(node, 'ob-site'));
  assert.deepEqual(visibleText(site).map(item => item.trim()).filter(Boolean), ['Your business', hh.world.draft.decision!.reading!.value]);
  assert.equal(descendants(site).filter(node => node.tagName === 'i' && ancestors(node).some(parent => hasClass(parent, 'ob-soutline'))).length, 3, 'three page outlines');
  assert.equal(descendants(site).filter(node => node.tagName === 'i' && !ancestors(node).some(parent => hasClass(parent, 'ob-soutline') || hasClass(parent, 'ob-bar'))).length, 0, 'no other bars');
  assert.equal(descendants(site).some(node => node.tagName === 'span' && !node.textContent && ancestors(node).some(parent => hasClass(parent, 'ob-bar'))), false, 'no empty address pill');
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
  for (const banned of [/\btotal\b/i, /\bVAT at\b/, /incl/i]) assert.equal(banned.test(restText(h.app)), false, `${banned} before the plan is kept`);
  await click(button(h.app, 'Keep this plan')); await flush();
  assert.deepEqual(callsOf(h, 'venture.compose.update').at(-1)!.payload.patch, { offers: [{ id: 'offer_2', unitPrice: '60.50' }] }, 'an unsent price goes before the vault is made');
  assert.ok(h.calls.findIndex(call => call.method === 'workspace.create') > h.calls.findLastIndex(call => call.method === 'venture.compose.update'), 'the vault is made after the last price');
  assert.equal(step(h), 'open', 'no Keep it safe screen: the plan goes straight on');
  for (const call of callsOf(h, 'venture.compose.update')) assert.deepEqual(Object.keys(call.payload).sort(), ['composeId', 'patch'], 'never the plan itself');
});

// ---------------------------------------------------------------------------------------------
// 10 to 13: keeping the plan without a passphrase, the fallback, Accept and Build; reload; pairing and Welcome back
// ---------------------------------------------------------------------------------------------
test('Keep this plan makes the vault silently, named from the plan, then venture.create by id and digest, a receipt per priced offer, Accept and Build', async () => {
  const h = await boot(connected(), { language: 'en-GB' });
  await askFor(h, O.DOG_TEXT);
  await click(button(h.app, 'Set your prices'));
  const walks = find(h.app, node => node.attributes['aria-label'] === 'Price of Weekly walks, in GBP');
  await type(walks, '18'); await walks.dispatch('change'); await flush();
  const kept = h.world.draft.plan!;
  await click(button(h.app, 'Keep this plan')); await flush();
  assert.equal(step(h), 'open');
  for (const words of ['Keep it safe.', 'Save your recovery code.', 'Choose a passphrase.']) assert.equal(text(h.app).includes(words), false, `no "${words}" in this path`);
  assert.equal(descendants(h.body).some(node => node.tagName === 'input' && node.attributes.type === 'password'), false, 'no passphrase field anywhere');
  assert.ok(visibleText(rightPane(h)).includes('Encrypted on this computer'), 'the badge once the vault exists');
  const order = h.calls.slice(h.calls.findIndex(call => call.method === 'workspace.create'));
  assert.deepEqual(Object.keys(order[0].payload).sort(), ['folder', 'name', 'pack'], 'no passphrase key at all');
  assert.deepEqual(order.slice(0, 7), [
    { method: 'workspace.create', payload: { name: kept.name.value, pack: 'services', folder: null } },
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

test('no protected storage: the engine says why, two passphrase fields, the recovery code once, then setting up', async () => {
  const h = await boot(connected({}, { custody: { unavailable: 'blocked' } }), { language: 'en-GB' });
  await askFor(h, O.DOG_TEXT);
  await click(button(h.app, 'Set your prices'));
  const kept = h.world.draft.plan!;
  await click(button(h.app, 'Keep this plan')); await flush();
  assert.equal(step(h), 'keep');
  assert.equal(title(h.app), 'Choose a passphrase.');
  assert.ok(visibleText(h.app).includes(CUSTODY_WORDS.unavailable.blocked), "the engine's own reason");
  assert.equal(descendants(h.app).filter(node => node.tagName === 'input' && node.attributes.type === 'password').length, 2);
  assert.equal(descendants(h.app).some(node => hasClass(node, 'ob-progress')), false, 'no segment name: the plan is not accepted yet');
  await type(control(h.app, 'Passphrase'), 'long-enough-passphrase');
  await type(control(h.app, 'Type it again'), 'long-enough-passphrase');
  await find(h.app, node => node.tagName === 'form').dispatch('submit'); await flush();
  assert.deepEqual(callsOf(h, 'workspace.create').map(call => call.payload), [
    { name: kept.name.value, pack: 'services', folder: null },
    { name: kept.name.value, pack: 'services', folder: null, passphrase: 'long-enough-passphrase' },
  ], 'first without a passphrase, then with the one the owner chose');
  assert.equal(step(h), 'code');
  assert.equal(descendants(h.app).some(node => hasClass(node, 'ob-progress')), false, 'the recovery code screen names no segment either');
  assert.equal(find(h.app, node => hasClass(node, 'ob-code')).textContent, 'DEMO-RECOVERY-CODE');
  assert.ok(text(h.app).includes('in the folder leeds-shift-walkers'), 'the code screen names the folder the engine chose');
  await tick(find(h.app, node => node.tagName === 'input' && node.attributes.type === 'checkbox'));
  await click(button(h.app, 'Continue')); await flush();
  assert.equal(step(h), 'open', 'then setting up and Accept, as without the fallback');
  assert.equal(callsOf(h, 'venture.create').length, 1);
});

test('progress has five segments here (AI, Idea, Plan, Accept, Build); setting up counts as Accept', async () => {
  const h = await boot(heldDog({ overrides: { 'venture.create': () => new Promise(() => {}) } }), { language: 'en-GB' });
  const segments = () => descendants(h.app).filter(node => node.tagName === 'li' && node.parent?.parent && hasClass(node.parent.parent, 'ob-progress'));
  assert.equal(segments().length, 5);
  assert.equal(find(h.app, node => hasClass(node, 'ob-progress')).attributes['data-count'], '3/5');
  assert.deepEqual(segments().map(node => node.attributes['aria-label'] ?? node.textContent), ['AI, done', 'Idea, done', 'Plan', 'Accept, not yet', 'Build, not yet']);
  await click(button(h.app, 'Set your prices'));
  await press(button(h.app, 'Keep this plan'));
  assert.equal(step(h), 'setup');
  assert.equal(find(h.app, node => hasClass(node, 'ob-progress')).attributes['data-count'], '4/5');
});

test('the built-in plan keeps silently too: named from the kind of service, then the template setup', async () => {
  const h = await boot();
  await click(button(h.app, 'Continue without AI'));
  await askFor(h, 'Monthly bookkeeping for cafes and small shops in Pune.');
  await click(button(h.app, 'Set your price'));
  await type(find(h.app, node => node.attributes['aria-label'] === 'Your price, in INR'), '2,499');
  await click(button(h.app, 'Keep this plan')); await flush();
  assert.deepEqual(callsOf(h, 'workspace.create').map(call => call.payload), [{ name: 'Bookkeeping studio', pack: 'services', folder: null }]);
  assert.deepEqual(callsOf(h, 'venture.create')[0].payload, { idea: 'Monthly bookkeeping for cafes and small shops in Pune.', countryCode: 'IN', workingName: 'Bookkeeping studio' });
  assert.equal(step(h), 'open');
});

test('boot: one business that opens with this computer opens with no screen; closed by its owner or more than one shows Welcome back', async () => {
  const one = await boot({ custody: { businesses: [K.leeds] } });
  assert.deepEqual(callsOf(one, 'workspace.open').map(call => call.payload), [{ folder: 'leeds-shift-walkers' }], 'no passphrase, no folder typed');
  assert.equal(one.world.open, true);
  assert.equal(descendants(one.app).some(node => hasClass(node, 'ob-root') && node.attributes['data-step'] === 'back'), false);

  const closed = await boot({ custody: { businesses: [K.leeds], closedByOwner: true } });
  assert.equal(step(closed), 'back', 'the owner closed it, so it waits on Welcome back');
  assert.equal(callsOf(closed, 'workspace.open').length, 0);

  const two = await boot({ custody: { businesses: [K.leeds, K.ledger] } });
  assert.equal(step(two), 'back');
  const locked = await boot({ custody: { businesses: [K.ledger] } });
  assert.equal(step(locked), 'back', 'a business locked with a passphrase never opens by itself');

  const held = await boot({ draft: { ai: O.statusPair, held: { key: 'dog', decision: O.dogDecision, plan: O.dogPlan } }, custody: { businesses: [K.leeds] } });
  assert.equal(step(held), 'plan', 'a held draft resumes onboarding first');
  assert.equal(callsOf(held, 'workspace.list').length, 0);

  const failing = await boot({ custody: { businesses: [K.missingKey] } });
  assert.equal(step(failing), 'back', 'a key-missing business is not opened');
  const broken = await boot({ custody: { businesses: [K.leeds] }, overrides: { 'workspace.open': () => { throw Object.assign(new Error(CUSTODY_WORDS.errors.DEVICE_KEY_FAILED), { code: 'DEVICE_KEY_FAILED' }); } } });
  assert.equal(step(broken), 'back');
  const row = find(broken.app, node => hasClass(node, 'ob-biz') && node.attributes['data-folder'] === 'leeds-shift-walkers');
  assert.ok(text(row).includes(CUSTODY_WORDS.errors.DEVICE_KEY_FAILED), "the engine's words on that row");
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

  // Welcome back lists this computer's businesses: no folder to type at rest.
  const h = await boot({ custody: { businesses: [K.leeds, K.ledger, K.missingKey] } });
  assert.equal(step(h), 'back');
  assert.equal(title(h.app), 'Welcome back.');
  const shut = (node: Element) => ancestors(node).some(parent => parent.tagName === 'details' && !parent.open);
  assert.equal(descendants(h.app).some(node => node.tagName === 'input' && !shut(node)), false, 'no field at rest');
  assert.equal(buttons(h.app, 'Open by folder name').length, 0, 'the typed field waits until the list is incomplete or empty');
  const rowsAtRest = descendants(h.app).filter(node => hasClass(node, 'ob-biz') && !shut(node));
  assert.deepEqual(rowsAtRest.map(node => node.attributes['data-folder']), ['leeds-shift-walkers', 'ledger-cafe-books'], 'two rows at rest, newest opened first');
  assert.deepEqual(rowsAtRest.map(node => find(node, item => hasClass(item, 'ob-chip')).textContent), ['Opens with this computer', 'Needs your passphrase']);
  assert.ok(descendants(h.app).some(node => node.tagName === 'summary' && node.textContent === 'More businesses'), 'the rest in a fold');
  assert.equal(hasClass(button(rowsAtRest[0], 'Open'), 'ob-btn'), true, 'the first row is filled');
  assert.equal(hasClass(button(rowsAtRest[1], 'Open'), 'ob-ghost'), true, 'the others are ghost');
  // A passphrase row opens its own field; Open sends the folder and the passphrase, then clears it.
  Element.focused = null;
  const focused = () => Element.focused;
  await click(button(rowsAtRest[1], 'Open'));
  const pass = find(h.app, node => node.attributes['aria-label'] === 'Passphrase for Ledger Cafe Books');
  assert.equal(pass.attributes.type, 'password');
  assert.equal(focused()?.node, pass, 'the cursor goes in the field the owner opened');
  assert.equal(focused()?.attached, true, 'focused once the field is in the page, not before');
  assert.equal(filledAtRest(h.app).length, 1, 'one filled button while a row asks for its passphrase');
  assert.equal(hasClass(button(find(h.app, node => hasClass(node, 'ob-biz-pass')), 'Open'), 'ob-btn'), true, "the asking row's Open is the filled one");
  assert.equal(hasClass(button(rowsAtRest[0], 'Open'), 'ob-ghost'), true, 'the first row steps back to ghost');
  await type(pass, 'long-enough-passphrase');
  await click(button(find(h.app, node => hasClass(node, 'ob-biz-pass')), 'Open'));
  assert.deepEqual(callsOf(h, 'workspace.open').map(call => call.payload), [{ folder: 'ledger-cafe-books', passphrase: 'long-enough-passphrase' }]);
  assert.equal(pass.value, '', 'the passphrase is cleared');
  // Two businesses with the same name are told apart by their folder; a name of its own shows no folder.
  const twins = await boot({ custody: { businesses: [{ ...K.leeds, name: 'Bookkeeping studio', folder: 'bookkeeping-studio' }, { ...K.leeds, name: 'Bookkeeping studio', folder: 'bookkeeping-studio-2', openedAt: '2026-10-17T09:30:00.000Z' }, K.ledger] } });
  assert.deepEqual(descendants(twins.app).filter(node => hasClass(node, 'ob-biz-folder')).map(node => node.textContent), ['Folder: bookkeeping-studio', 'Folder: bookkeeping-studio-2']);
  // A this-computer row sends the folder only.
  const quick = await boot({ custody: { businesses: [K.leeds, K.ledger] } });
  await click(button(find(quick.app, node => hasClass(node, 'ob-biz') && node.attributes['data-folder'] === 'leeds-shift-walkers'), 'Open'));
  assert.deepEqual(callsOf(quick, 'workspace.open').map(call => call.payload), [{ folder: 'leeds-shift-walkers' }]);
  assert.equal(quick.world.open, true);

  // Recovery: the business from the list and the code; a new passphrase only once the engine says this computer can't keep the key.
  const recover = await boot({ custody: { businesses: [K.leeds, K.missingKey] } });
  const options = find(recover.app, node => node.tagName === 'details' && summaryOf(node)?.textContent === 'More options');
  await open(options);
  await click(button(options, 'Use a recovery code'));
  assert.equal(title(recover.app), 'Use your recovery code.');
  assert.equal(control(recover.app, 'Business').tagName, 'select', 'chosen from the list, not typed');
  control(recover.app, 'Business').value = 'pune-books';
  await type(control(recover.app, 'Recovery code'), K.RECOVERY_CODE);
  assert.equal(find(recover.app, node => hasClass(node, 'ob-pass-pair')).hidden, true, 'no new passphrase while this computer can keep the key');
  await find(recover.app, node => node.tagName === 'form').dispatch('submit'); await flush();
  assert.deepEqual(callsOf(recover, 'workspace.recover').map(call => call.payload), [{ folder: 'pune-books', recoveryCode: K.RECOVERY_CODE }]);

  const fallback = await boot({ custody: { businesses: [K.missingKey] }, overrides: { 'workspace.recover': (_method, payload) => {
    if (typeof payload.passphrase !== 'string') throw Object.assign(new Error(CUSTODY_WORDS.unavailable.failed), { code: 'DEVICE_KEYS_UNAVAILABLE' });
    return { workspace: { name: 'Pune Books' } };
  } } });
  await click(button(fallback.app, 'Use my recovery code'));
  await type(control(fallback.app, 'Recovery code'), K.RECOVERY_CODE);
  await find(fallback.app, node => node.tagName === 'form').dispatch('submit'); await flush();
  assert.equal(control(fallback.app, 'Recovery code').value, '', 'the code is cleared after each send');
  assert.equal(find(fallback.app, node => hasClass(node, 'ob-pass-pair')).hidden, false, 'now the new passphrase pair shows');
  assert.ok(visibleText(fallback.app).includes(CUSTODY_WORDS.unavailable.failed));
  await type(control(fallback.app, 'Recovery code'), K.RECOVERY_CODE);
  await type(control(fallback.app, 'New passphrase'), 'another-long-passphrase');
  await type(control(fallback.app, 'Type it again'), 'another-long-passphrase');
  await find(fallback.app, node => node.tagName === 'form').dispatch('submit'); await flush();
  assert.deepEqual(callsOf(fallback, 'workspace.recover').at(-1)!.payload, { folder: 'pune-books', recoveryCode: K.RECOVERY_CODE, passphrase: 'another-long-passphrase' });
});

test('Welcome back: an incomplete or empty list offers the typed folder; a backup restores by its name; a move takes the file and its code', async () => {
  const empty = await boot({ custody: { businesses: [], complete: false } });
  empty.renderer.launch.openExisting(''); await flush();
  assert.equal(step(empty), 'back');
  const options = find(empty.app, node => node.tagName === 'details' && summaryOf(node)?.textContent === 'More options');
  await open(options);
  await click(button(options, 'Open by folder name'));
  assert.equal(title(empty.app), 'Open by folder name.');
  await type(control(empty.app, 'Vault folder'), 'old-books');
  await find(empty.app, node => node.tagName === 'form').dispatch('submit'); await flush();
  assert.deepEqual(callsOf(empty, 'workspace.open').map(call => call.payload), [{ folder: 'old-books' }], 'no passphrase typed, so none is sent');

  const restore = await boot({ custody: { businesses: [K.ledger] } });
  const restoreOptions = find(restore.app, node => node.tagName === 'details' && summaryOf(node)?.textContent === 'More options');
  await open(restoreOptions);
  await click(button(restoreOptions, 'Restore a backup')); await flush();
  assert.equal(title(restore.app), 'Restore a backup.');
  const backupRows = descendants(restore.app).filter(node => hasClass(node, 'ob-backup'));
  assert.deepEqual(backupRows.map(node => find(node, item => hasClass(item, 'ob-chip')).textContent), ['Automatic', 'Before a change', 'You made it']);
  await click(button(backupRows[0], 'Restore'));
  assert.deepEqual(callsOf(restore, 'workspace.restore').map(call => call.payload), [{ backupFile: K.backups[0].file, folder: null }], 'the name inside backups, never a path');
  assert.equal(restore.world.open, true);

  const move = await boot({ custody: { businesses: [K.ledger] } });
  await click(button(move.app, 'Move from another computer'));
  assert.equal(title(move.app), 'Move a business here.');
  const file = find(move.app, node => node.tagName === 'input' && node.attributes.type === 'file');
  assert.equal(file.attributes.accept, '.backup,application/json');
  assert.equal(file.hidden, true, "the browser's own file control is hidden");
  let picked = 0;
  file.addEventListener('click', () => { picked++; });
  await click(button(move.app, 'Choose the move file'));
  assert.equal(picked, 1, "Chausar's button opens the file chooser");
  assert.ok(text(move.app).includes('No file chosen yet.'));
  const code = find(move.app, node => node.attributes['aria-label'] === 'The move code');
  assert.equal(code.attributes.type, 'password');
  assert.equal(code.attributes.autocomplete, 'off');
  assert.equal(ancestors(code).some(node => node.tagName === 'form'), false, 'the code field sits outside any form');
  (file as unknown as { files: unknown[] }).files = [{ name: 'chausar-move-2026-10-18.backup', text: async () => K.MOVE_TEXT }];
  await file.dispatch('change');
  assert.ok(text(move.app).includes('chausar-move-2026-10-18.backup'), "the chosen file's name beside the button");
  await type(code, K.MOVE_CODE);
  await click(button(move.app, 'Move it here')); await flush();
  assert.deepEqual(callsOf(move, 'workspace.transfer.import').map(call => call.payload), [{ fileText: K.MOVE_TEXT, transferCode: K.MOVE_CODE }]);
  assert.equal(code.value, '', 'the code is cleared');
  assert.equal(move.world.open, true);

  const big = await boot({ custody: { businesses: [K.ledger] } });
  await click(button(big.app, 'Move from another computer'));
  (find(big.app, node => node.tagName === 'input' && node.attributes.type === 'file') as unknown as { files: unknown[] }).files = [{ text: async () => 'x'.repeat(1_900_001) }];
  await type(find(big.app, node => node.attributes['aria-label'] === 'The move code'), K.MOVE_CODE);
  await click(button(big.app, 'Move it here')); await flush();
  assert.ok(text(big.app).includes(CUSTODY_WORDS.errors.TRANSFER_TOO_LARGE), 'refused before it is sent');
  assert.equal(callsOf(big, 'workspace.transfer.import').length, 0);
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
  'built-in': 45, 'built-in-prices': 45, keep: 45, code: 45, setup: 25, open: 45, build: 45, back: 45,
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
  // The passphrase fallback, the recovery code, setting up, Accept and Build, from the longest plan.
  const keep = await boot({ draft: { ...maxDraft, held: { key: 'maxOffers', decision: O.maxDecisions.maxOffers, plan: O.maxPlans.maxOffers } }, custody: { unavailable: 'no-keyring' } });
  await click(button(keep.app, 'Set your prices'));
  await click(button(keep.app, 'Keep this plan')); await flush();
  assert.equal(step(keep), 'keep');
  measure(t, 'keep', keep);
  keep.renderer.launch.showRecoveryCode({ recoveryCode: 'A1b2-C3d4_E5f6G7h8I9j0K1l2M3n4O5p6Q7r8', folder: 'northumberlands-neighbourhoods-companionships-collaboratives' }, () => {});
  measure(t, 'code', keep);
  const flow = await boot(connected(), { language: 'en-GB' });
  await askFor(flow, O.DOG_TEXT);
  await click(button(flow.app, 'Set your prices'));
  const walks = find(flow.app, node => node.attributes['aria-label'] === 'Price of Weekly walks, in GBP');
  await type(walks, '18'); await walks.dispatch('change'); await flush();
  await click(button(flow.app, 'Keep this plan')); await flush();
  measure(t, 'open', flow);
  await click(button(flow.app, 'Accept plan')); await flush();
  measure(t, 'build', flow);
  // Setting up waits on venture.create.
  const slow = await boot({ draft: { ai: O.statusPair, held: { key: 'dog', decision: O.dogDecision, plan: O.dogPlan } }, overrides: { 'venture.create': () => new Promise(() => {}) } }, { language: 'en-GB' });
  await click(button(slow.app, 'Set your prices'));
  await press(button(slow.app, 'Keep this plan'));
  assert.equal(step(slow), 'setup');
  assert.ok(text(slow.app).includes(EXPERIMENTAL), 'the experimental-storage line moved here from Keep it safe');
  measure(t, 'setup', slow);
  // Pairing and Welcome back, with the longest name, the fold for more, and the typed folder offered.
  const pairing = await harness({}, { browser: { open: () => null } });
  pairing.renderer.state.token = null;
  await pairing.renderer.boot(); await flush();
  measure(t, 'pair', pairing);
  const back = await boot({ custody: { businesses: [K.longest, K.ledger, K.missingKey], complete: false } });
  assert.equal(step(back), 'back');
  measure(t, 'back', back);
  const none = await boot();
  none.renderer.launch.openExisting(''); await flush();
  measure(t, 'back', none);
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
  fixture = O.composedBlueprintFor(h.world.draft.plan!, O.composedVentureView);
  await click(button(h.app, 'Keep this plan')); await flush();
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

test('the live preview shows the business in real words: each from the engine, the typed sentence or its fixed words; no web address, no style, still aria-hidden', async t => {
  const fixed = new Set<string>(['Your business', 'Takes shape as you type.', 'Price not set', 'before tax', 'Encrypted on this computer', 'per month', 'per project', 'per hour', ...Object.values(SERVICE_TYPE_LABELS)]);
  const phrases = (node: Element) => visibleText(node).map(item => item.trim()).filter(Boolean);
  const check = (h: H, label: string, allowed: Set<string>) => {
    const pane = rightPane(h);
    assert.equal(pane.attributes['aria-hidden'], 'true', `${label}: aria-hidden`);
    for (const phrase of phrases(pane)) assert.ok(fixed.has(phrase) || allowed.has(phrase), `${label}: "${phrase}" in the preview has no source`);
    assert.equal(/www\.|https?:|\.(com|site|co)\b/.test(phrases(pane).join(' ')), false, `${label}: no made-up web address`);
    assert.equal(descendants(pane).some(node => 'style' in node.attributes), false, `${label}: no inline style`);
    const strip = find(h.app, node => hasClass(node, 'ob-strip'));
    assert.equal(strip.attributes['aria-hidden'], 'true');
    for (const phrase of phrases(strip)) assert.ok(allowed.has(phrase) || phrase === 'Your business' || Object.values(SERVICE_TYPE_LABELS).includes(phrase), `${label}: the strip holds only the kind, the name and the typed line, not "${phrase}"`);
    return phrases(pane);
  };
  const planWords = (plan: typeof O.dogPlan) => [plan.name.value, plan.oneLiner.value, plan.familyLabel, ...plan.offers.map(offer => offer.name.value), ...plan.offers.map(offer => offer.priceDisplay).filter((item): item is string => Boolean(item)), ...plan.pages.map(item => item.title.value)];

  const h = await boot(connected(), { language: 'en-GB' });
  let shown = check(h, 'idea', new Set());
  assert.ok(shown.includes('Your business') && shown.includes('Takes shape as you type.'), 'placeholders before anything is typed');
  const site = () => find(rightPane(h), node => hasClass(node, 'ob-site'), 'Expected the website card.');
  assert.ok(visibleText(site()).includes('Your business'), 'the website card from the first screen');
  await type(find(h.app, node => node.tagName === 'textarea'), O.DOG_TEXT);
  shown = check(h, 'idea, typed', new Set([O.DOG_TEXT]));
  assert.ok(shown.includes(O.DOG_TEXT), 'the sentence, live, as typed');
  assert.ok(visibleText(site()).includes(O.DOG_TEXT), 'the website card takes the typed line too');
  assert.deepEqual(phrases(find(h.app, node => hasClass(node, 'ob-strip'))), ['Your business', O.DOG_TEXT], 'the phone strip moves as the owner types');
  assert.equal(descendants(rightPane(h)).some(node => hasClass(node, 'ob-coffers')), false, 'no empty offer boxes before there are offers');
  assert.equal(descendants(rightPane(h)).some(node => node.tagName === 'i' && !ancestors(node).some(parent => hasClass(parent, 'ob-bar'))), false, 'no grey bars, only the three dots of the window');
  assert.equal(descendants(rightPane(h)).some(node => hasClass(node, 'ob-ckind')), false, 'no kind is guessed from the typed words');
  await click(goButton(h.app)); await flush();
  const plan = h.world.draft.plan!;
  shown = check(h, 'plan', new Set(planWords(plan)));
  for (const words of [plan.familyLabel, plan.name.value, plan.oneLiner.value, ...plan.offers.map(offer => offer.name.value)]) assert.ok(shown.includes(words), `plan: ${words}`);
  assert.deepEqual(shown.filter(phrase => phrase === 'Price not set').length, plan.offers.length, 'no price before the owner types one');
  assert.ok(plan.pages.slice(0, 4).every(item => shown.includes(item.title.value)), 'the website card names the first four pages');
  assert.equal(plan.pages.slice(4).some(item => shown.includes(item.title.value)), false);
  await click(button(h.app, 'Set your prices'));
  const walks = find(h.app, node => node.attributes['aria-label'] === 'Price of Weekly walks, in GBP');
  await type(walks, '18');
  shown = check(h, 'prices, typing', new Set([...planWords(plan), 'GBP 18']));
  assert.ok(shown.includes('GBP 18') && shown.includes('before tax'), "the owner's own text beside the currency code while typing, before the engine formats it");
  await walks.dispatch('change'); await flush();
  const priced = h.world.draft.plan!;
  shown = check(h, 'prices', new Set(planWords(priced)));
  assert.ok(shown.includes(priced.offers[0].priceDisplay!) && shown.includes('before tax'), "the engine's display string, before tax");
  await click(button(h.app, 'Keep this plan')); await flush();
  assert.equal(step(h), 'open');
  const receipt = O.composedReceipt.figures.find(item => item.key === 'total')!;
  const kept = O.composedBlueprintView.blueprint;
  const keptWords = new Set([O.composedVentureView.venture.workingName, kept.name.value, kept.oneLiner.value, ...kept.offers.map(offer => offer.name.value), ...(kept.pages || []).map(item => item.title.value), receipt.label, receipt.display]);
  shown = check(h, 'accept', keptWords);
  assert.ok(shown.includes(receipt.label) && shown.includes(receipt.display), "the receipt's total, label and display as given");
  assert.ok(shown.includes('Encrypted on this computer'));
  assert.ok(shown.includes(SERVICE_TYPE_LABELS[kept.serviceType]), 'the kind from the contract labels');
  await click(button(h.app, 'Accept plan')); await flush();
  assert.equal(step(h), 'build');
  check(h, 'build', keptWords);
  assert.ok(hasClass(find(h.app, node => hasClass(node, 'ob-stage')), 'ob-site-front'), 'the website card comes forward on Build');
  t.diagnostic(`accept preview: ${shown.join(' | ')}`);

  // The built-in plan: template words, and the price exactly as typed beside the currency code.
  const built = await boot();
  await click(button(built.app, 'Continue without AI'));
  await askFor(built, 'Monthly bookkeeping for cafes.');
  const preview = { ...F.preview, idea: 'Monthly bookkeeping for cafes.' };
  const templateWords = new Set([preview.serviceLabel, preview.oneLiner.value, ...preview.offers.map(offer => offer.name.value), 'INR 2,499']);
  check(built, 'built-in plan', templateWords);
  assert.equal(find(rightPane(built), node => hasClass(node, 'ob-cname')).textContent, preview.serviceLabel, 'the name the business will be kept under, so it does not jump at Keep');
  await click(button(built.app, 'Set your price'));
  await type(find(built.app, node => node.attributes['aria-label'] === 'Your price, in INR'), '2,499');
  shown = check(built, 'built-in prices', templateWords);
  assert.ok(shown.includes('INR 2,499'), 'as typed, not formatted');

  // Welcome back: the newest business's name, already on the left, and that it is encrypted. No grey bars.
  const back = await boot({ custody: { businesses: [K.ledger] } });
  assert.deepEqual(phrases(rightPane(back)), ['Encrypted on this computer', K.ledger.name]);
  assert.deepEqual(phrases(find(back.app, node => hasClass(node, 'ob-strip'))), [K.ledger.name]);
  assert.equal(descendants(rightPane(back)).some(node => node.tagName === 'i'), false, 'no grey bars');
  // Restore names the business whose backups are listed first; Move a business here shows the card with no words or bars.
  const options = find(back.app, node => node.tagName === 'details' && summaryOf(node)?.textContent === 'More options');
  await open(options);
  await click(button(options, 'Restore a backup')); await flush();
  assert.deepEqual(phrases(rightPane(back)), ['Encrypted on this computer', K.backups[0].name]);
  await click(button(back.app, 'Back')); await flush();
  await click(button(back.app, 'Move from another computer'));
  assert.deepEqual(phrases(rightPane(back)), []);
  assert.equal(descendants(rightPane(back)).some(node => node.tagName === 'i'), false, 'no grey bars');
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
  assert.deepEqual(Object.values(copies.PREVIEW_WORDS), ['Your business', 'Takes shape as you type.', 'Price not set', 'before tax', 'Encrypted on this computer']);
  assert.deepEqual({ ...copies.SERVICE_TYPE_LABELS }, { ...SERVICE_TYPE_LABELS });
});

test('the onboarding screens never compute money and never style elements from script', async () => {
  for (const banned of ['parseFloat', 'toFixed', 'BigInt', '.style', "setAttribute('style'", 'innerHTML', 'localStorage']) assert.equal(launchSource.includes(banned), false, `launch.js holds ${banned}`);
  const prices = launchSource.slice(launchSource.indexOf('function showPrices()'), launchSource.indexOf('async function runComposedSetup()'));
  assert.ok(prices.length > 1000, 'the prices screen is found');
  for (const pattern of [/Number\(/, /parseInt/, /Math\./, /\*\s*\d/, /\d\s*\*/, /\/\s*100\b/]) assert.equal(pattern.test(prices), false, `the prices screen holds ${pattern}`);
  // The live preview shows prices as given: no +, * or - arithmetic anywhere in its code, strings and comments aside.
  const preview = launchSource.slice(launchSource.indexOf('(preview words start)'), launchSource.indexOf('(preview words end)'));
  assert.ok(preview.length > 2000, 'the preview code is found');
  const code = preview.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').replace(/`(?:\\.|[^`\\])*`/g, '""').replace(/'(?:\\.|[^'\\])*'/g, '""');
  for (const pattern of [/[^=!<>]=?\+/, /\*/, /\s-\s/, /--/, /Number\(/, /parseFloat|toFixed|BigInt|Math\./]) assert.equal(pattern.test(code), false, `the preview code holds ${pattern}`);
  const index = await readFile(join(root, 'app/renderer/index.html'), 'utf8');
  assert.match(index, /<meta name="color-scheme" content="light dark">/);
});

// ---------------------------------------------------------------------------------------------
// Going back, trying again and losing the draft: the screen never shows a plan for other words or a false error
// ---------------------------------------------------------------------------------------------
const refuse = (code: string, message: string) => () => { throw Object.assign(new Error(message), { code }); };
const CLEARED = 'Your AI and plan were only kept in memory, and they were cleared. Connect again.';
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
  await flush();
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
  await flush();
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
  await press(button(slow.app, 'Keep this plan'));
  await flush();
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

test('motion happens once: the progress segment fills when it changes, the lock badge drops in once, offer rows slot in once', async () => {
  let release: () => void = () => {};
  const h = await boot(heldDog({ overrides: { 'venture.price.quote': () => new Promise(resolve => { release = () => resolve(O.composedReceipt); }) } }), { language: 'en-GB' });
  const segment = () => find(h.app, node => node.tagName === 'li' && hasClass(node, 'now'));
  assert.equal(hasClass(segment(), 'ob-seg-new'), true, 'the first plan frame fills its segment');
  const slotted = () => descendants(rightPane(h)).filter(node => hasClass(node, 'ob-coffer') && hasClass(node, 'ob-slot')).length;
  await click(button(h.app, 'Set your prices'));
  assert.equal(hasClass(segment(), 'ob-seg-new'), false, 'prices is the same segment: no refill');
  assert.equal(slotted(), 0, 'the same offers on the next screen do not slot in again');
  await click(button(h.app, 'Back'));
  assert.equal(hasClass(segment(), 'ob-seg-new'), false, 'back to the plan: no refill');
  await click(button(h.app, 'Set your prices'));
  const walks = find(h.app, node => node.attributes['aria-label'] === 'Price of Weekly walks, in GBP');
  await type(walks, '18'); await walks.dispatch('change'); await flush();
  assert.equal(descendants(rightPane(h)).filter(node => hasClass(node, 'ob-cprice-new')).length, 1, 'the changed price fades in once');
  await press(button(h.app, 'Keep this plan'));
  assert.equal(step(h), 'setup');
  assert.equal(hasClass(segment(), 'ob-seg-new'), true, 'Accept is a new segment');
  const badge = find(h.app, node => hasClass(node, 'ob-badge'));
  assert.equal(badge.hidden, false);
  assert.equal(hasClass(badge, 'ob-badge-new'), true, 'the badge drops in when the vault exists');
  release(); await flush();
  assert.equal(step(h), 'open');
  assert.equal(hasClass(segment(), 'ob-seg-new'), false, 'Accept is still the Accept segment');
  assert.equal(hasClass(find(h.app, node => hasClass(node, 'ob-badge')), 'ob-badge-new'), false, 'the badge does not drop in again');
  assert.match(cssSource, /\.ob-progress li\.ob-seg-new \.ob-seg i\{animation:ob-fill/);
  assert.match(cssSource, /\.ob-badge\.ob-badge-new\{animation:ob-badge/);
  assert.match(cssSource, /\.ob-coffer\.ob-slot\{animation:ob-slot var\(--ob-t2\)/);
  assert.match(cssSource, /\.ob-cprice\.ob-cprice-new\{animation:ob-swap var\(--ob-t1\)/);
  assert.equal(/\.ob-progress li\.now \.ob-seg i\{animation/.test(cssSource), false);
});

test('hosted web gets the same live preview, keeps Keep it and its recovery code, and never calls a custody method', async () => {
  const h = await harness({}, { browser: { open: () => null }, hosted: true });
  await h.renderer.boot(); await flush();
  assert.equal(step(h), 'idea', 'hosted starts at the open box');
  const pane = () => visibleText(rightPane(h)).map(item => item.trim()).filter(Boolean);
  assert.ok(pane().includes('Your business'));
  await askFor(h, 'Monthly bookkeeping for cafes.');
  assert.ok(pane().includes(F.preview.serviceLabel) && pane().includes(F.preview.offers[0].name.value), 'the built-in plan in the preview');
  await click(button(h.app, 'Set your price'));
  await type(find(h.app, node => node.attributes['aria-label'] === 'Your price, in INR'), '2,499');
  assert.ok(pane().includes('INR 2,499'));
  await click(button(h.app, 'Keep this plan'));
  assert.equal(step(h), 'keep');
  assert.equal(title(h.app), 'Keep it safe.', 'hosted keeps its Keep it step');
  assert.deepEqual(descendants(find(h.app, node => hasClass(node, 'ob-progress'))).filter(node => node.tagName === 'li').map(node => node.attributes['aria-label'] ?? node.textContent),
    ['Idea, done', 'Plan, done', 'Keep safe', 'Accept, not yet', 'Build, not yet']);
  await type(control(h.app, 'Working name'), 'Ledger Cafe Books');
  assert.ok(pane().includes('Ledger Cafe Books'), 'the working name shows as it is typed');
  await find(h.app, node => node.tagName === 'form').dispatch('submit'); await flush();
  assert.deepEqual(callsOf(h, 'workspace.create').map(call => call.payload), [{ name: 'Ledger Cafe Books', pack: 'services' }]);
  assert.equal(step(h), 'code');
  assert.equal(pane().includes('Encrypted on this computer'), false, 'hosted shows no lock words: the server keeps the key');
  assert.equal(h.calls.some(call => call.method.startsWith('workspace.custody.') || ['workspace.list', 'workspace.backups.list', 'workspace.transfer.import'].includes(call.method)), false);
});
