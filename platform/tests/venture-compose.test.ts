// P-engine (onboarding v2): the Connect rows, the block library a composed plan was built from, a composed plan a
// vault already holds and its later versions, and the boundary rules. The plan composer itself is gone, so a composed
// plan is written into the vault by fixtures/venture/compose-unit/stored.ts. Synthetic recordings only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { ChausarError, initialState } from '../runtime/contracts.ts';
import { DRAFT_METHODS, PRE_VAULT_METHODS } from '../runtime/venture/contracts.ts';
import type { BlueprintView, ModelPreset, ModelStatusView } from '../runtime/venture/contracts.ts';
import {
  AI_HALF_CONNECTED_WORDS, AI_OPTION_IDS, AI_OPTION_WORDS, AI_STATUS_CHIPS, AI_UNCHECKED_LINE, APPROVAL_BLOCK_IDS,
  NOTE_BLOCK_IDS, OFFER_BLOCK_IDS, ONBOARDING_METHODS, PAGE_BLOCK_IDS, QUESTION_BLOCK_IDS,
  STEP_BLOCK_IDS, TOOL_BLOCK_IDS, VIEW_IDS,
} from '../runtime/venture/onboarding-contracts.ts';
import type { AiStatusView } from '../runtime/venture/onboarding-contracts.ts';
import { assertNoNumbers, assertNoSpelledNumbers, digest, doneClaimFindings, houseStyleFindings } from '../runtime/venture/records.ts';
import { APPROVAL_BLOCKS, OFFER_BLOCKS, STEP_BLOCKS } from '../runtime/venture/core/blocks.ts';
import { structureFromBlueprint, structureOf } from '../runtime/venture/core/blueprint.ts';
import { CONNECTOR_CATALOGUE } from '../runtime/venture/build/catalogue.ts';
import { briefTask, briefTemplateWords, hasClientArea, planPages } from '../runtime/venture/build/brief.ts';
import { playbookSteps } from '../runtime/venture/delivery/playbook.ts';
import { AVAILABILITY_REASONS, PRESETS } from '../runtime/venture/models/presets.ts';
import { aiOptionsView } from '../runtime/venture/draft/index.ts';
import { EXCEL_COMPOSE, EXCEL_DECIDE, EXCEL_TEXT } from './fixtures/venture/compose-unit/plans.ts';
import { PASSPHRASE, connectPair, engineFor } from './fixtures/venture/compose-unit/harness.ts';
import { storedComposedBusiness } from './fixtures/venture/compose-unit/stored.ts';

const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected, error?.message); return true; };
const MODEL_NAMES = ['Claude Haiku 5.5', 'Sonnet 5.5', 'GPT-6 Luna'];
/** Model names are the only digits fixed words may hold. */
const withoutModelNames = (value: string) => MODEL_NAMES.reduce((text, name) => text.split(name).join(''), value);

function fixedStringsPass(value: string, label: string) {
  assert.deepEqual(houseStyleFindings(value), [], label);
  assert.deepEqual(doneClaimFindings(value), [], label);
  assertNoNumbers(withoutModelNames(value), label);
  assertNoSpelledNumbers(value, label);
  assert.doesNotMatch(value, /\u2014/, label);
}

// ---------------------------------------------------------------------------
// Fixed words, rows, catalogue
// ---------------------------------------------------------------------------

test('fixed words: every block id unique and every fixed string passes house style, the number guards and no finished-work claims', () => {
  for (const ids of [OFFER_BLOCK_IDS, STEP_BLOCK_IDS, APPROVAL_BLOCK_IDS, PAGE_BLOCK_IDS, TOOL_BLOCK_IDS, QUESTION_BLOCK_IDS, NOTE_BLOCK_IDS, VIEW_IDS]) {
    assert.equal(new Set(ids).size, ids.length, ids.join(','));
  }
  assert.deepEqual(Object.keys(OFFER_BLOCKS), [...OFFER_BLOCK_IDS]);
  assert.deepEqual(Object.keys(STEP_BLOCKS), [...STEP_BLOCK_IDS]);
  assert.deepEqual(Object.keys(APPROVAL_BLOCKS), [...APPROVAL_BLOCK_IDS]);
  const strings: [string, string][] = [
    ...Object.values(STEP_BLOCKS).map(block => [block.note, 'step'] as [string, string]),
    ...Object.values(APPROVAL_BLOCKS).map(block => [block.words, 'approval'] as [string, string]),
    ...AI_OPTION_IDS.flatMap(id => [AI_OPTION_WORDS[id].label, AI_OPTION_WORDS[id].line, AI_OPTION_WORDS[id].why].map(value => [value, id] as [string, string])),
    ...Object.values(AI_STATUS_CHIPS).map(value => [value, 'chip'] as [string, string]),
    [AI_UNCHECKED_LINE, 'unchecked'], [AI_HALF_CONNECTED_WORDS, 'half'],
    [AVAILABILITY_REASONS.claudeTerms, 'terms'],
  ];
  for (const [value, label] of strings) fixedStringsPass(value, label);
  // Every frozen object is frozen all the way down.
  assert.ok(Object.isFrozen(STEP_BLOCKS) && Object.isFrozen(STEP_BLOCKS['draft-reply']));
  assert.equal(STEP_BLOCKS['draft-reply'].capability, 'drafts-now');
  assert.deepEqual(STEP_BLOCK_IDS.filter(id => STEP_BLOCKS[id].doneBy !== 'you'), ['draft-reply'], 'only draft-reply involves an agent in this build');
  assert.deepEqual(STEP_BLOCK_IDS.filter(id => STEP_BLOCKS[id].capability === 'yours'), ['meet-client', 'in-person-work', 'get-paid']);
});

test('no "works": while a row holds a preset not built in, none of its words or its chip says works or working', () => {
  for (const id of AI_OPTION_IDS) {
    const words = AI_OPTION_WORDS[id];
    for (const value of [words.label, words.line, words.why, ...Object.values(AI_STATUS_CHIPS)]) assert.doesNotMatch(value, /\b(works|working)\b/i, `${id}: ${value}`);
  }
  assert.ok(PRESETS.filter(preset => preset.id !== 'built-in-templates').every(preset => preset.verification === 'not-live-verified'));
});

test('the ChatGPT row says exactly why it is not open and names no other route', () => {
  const why = AI_OPTION_WORDS['chatgpt-sign-in'].why;
  assert.equal(why, "OpenAI lets only open-source tools, personal projects that run locally and apps it picks use a ChatGPT plan. Chausar is a commercial app and hasn't been picked yet. Use an OpenAI key for now.");
  assert.doesNotMatch(why, /Codex|Claude|Anthropic/);
  assert.equal(AI_OPTION_WORDS['chatgpt-sign-in'].line, 'Not open to Chausar yet.');
});

function statusStub(): AiStatusView {
  return {
    connections: [], tiers: {
      fast: { presetId: 'built-in-templates', model: null, usable: true, reason: '', verification: 'built-in', verificationNote: null },
      main: { presetId: 'built-in-templates', model: null, usable: true, reason: '', verification: 'built-in', verificationNote: null },
    },
    spentThisMonthMicros: '0', spentThisMonthDisplay: '$0.00', estimate: false, sendPolicy: 'shape', replay: { active: true, label: 'synthetic recording' },
    scope: 'before-vault', idleUntil: null,
  };
}
function livePresets(overrides: Partial<Record<ModelPreset['id'], Partial<ModelPreset>>> = {}): ModelPreset[] {
  const availability: Record<string, Pick<ModelPreset, 'availability' | 'availabilityReason'>> = {
    'anthropic-haiku-5-5': { availability: 'ready', availabilityReason: AVAILABILITY_REASONS.anthropic },
    'anthropic-sonnet-5-5': { availability: 'ready', availabilityReason: AVAILABILITY_REASONS.anthropic },
    'openai-gpt-6-luna': { availability: 'unverified', availabilityReason: AVAILABILITY_REASONS.luna },
    'claude-code-cli': { availability: 'needs-setup', availabilityReason: AVAILABILITY_REASONS.claudeTerms },
    'codex-cli': { availability: 'needs-setup', availabilityReason: AVAILABILITY_REASONS.codexMissing },
    'built-in-templates': { availability: 'ready', availabilityReason: AVAILABILITY_REASONS.templates },
  };
  return PRESETS.map(spec => ({ ...structuredClone(spec), ...availability[spec.id], ...(overrides[spec.id] ?? {}) }) as ModelPreset);
}

test('row status: the API key row is the weakest of its presets, ChatGPT never opens, and unchecked is computed', () => {
  const view = aiOptionsView(livePresets(), statusStub(), false);
  assert.deepEqual(view.options.map(option => option.id), AI_OPTION_IDS.filter(id => id !== 'claude-code'));
  const byId = Object.fromEntries(view.options.map(option => [option.id, option]));
  assert.equal(byId['api-key'].status, 'unverified', 'Anthropic ready and OpenAI unverified: the weakest wins');
  assert.equal(AI_STATUS_CHIPS[byId['api-key'].status], 'Can connect');
  assert.deepEqual(byId['api-key'].recommended, { fast: 'anthropic-haiku-5-5', main: 'anthropic-sonnet-5-5' });
  assert.equal(byId['api-key'].canConnect, true);
  assert.deepEqual(byId['chatgpt-sign-in'], { id: 'chatgpt-sign-in', ...AI_OPTION_WORDS['chatgpt-sign-in'], status: 'not-open', canConnect: false, presetIds: [], recommended: null });
  assert.equal(byId['claude-code'], undefined, 'pending hides Claude Code');
  assert.equal(byId.codex.canConnect, false);
  assert.equal(view.unchecked, true);
  assert.equal(aiOptionsView(livePresets(), statusStub(), true).options.find(option => option.id === 'claude-code')!.canConnect, true, 'gate open: Check and connect runs the version check');
  // Every connectable preset verified: the unchecked line hides.
  const verified = livePresets(Object.fromEntries(PRESETS.map(spec => [spec.id, { verification: 'built-in' as const, verificationNote: null }])));
  assert.equal(aiOptionsView(verified, statusStub(), false).unchecked, false);
});

test('catalogue: every tool block is a catalogue connector and never a payment one', () => {
  const catalogue = new Map(CONNECTOR_CATALOGUE.map(entry => [entry.id, entry]));
  for (const id of TOOL_BLOCK_IDS) {
    assert.ok(catalogue.has(id), id);
    assert.notEqual(catalogue.get(id)!.category, 'payments', id);
  }
});

// ---------------------------------------------------------------------------
// The composed plan in the vault, and its later versions
// ---------------------------------------------------------------------------

/** Clear Sheets: the Excel lessons plan as a vault holds it, offer_1 at GBP 40 and offer_3 at GBP 120, with the owner's AI adopted. */
async function keptVenture(t: any, extra: { responses?: any[] } = {}) {
  const { engine } = await engineFor(t, { responses: extra.responses ?? [] });
  await connectPair(engine);
  const first = await storedComposedBusiness(engine, { name: 'Clear Sheets', text: EXCEL_TEXT, countryCode: 'GB', decide: EXCEL_DECIDE, output: EXCEL_COMPOSE, price: '40', prices: { offer_3: '12000' } });
  return { engine, first: first.blueprint };
}

const BLUEPRINT_WORDS = {
  name: 'Clear Sheets Lessons', oneLiner: 'Calm Excel lessons for people at work.', customer: 'Office workers who want ease with Excel.',
  offers: [{ id: 'offer_1', name: 'Excel lesson', description: 'A lesson on what you need now.' }, { id: 'offer_2', name: 'Basics course', description: 'Lessons from the start.' }, { id: 'offer_3', name: 'Workbook check', description: 'A look at your workbook.' }],
  steps: [{ id: 'step_1', title: 'Gather the workbook' }, { id: 'step_2', title: 'Teach the lesson' }, { id: 'step_3', title: 'Send the notes' }, { id: 'step_4', title: 'Check in later' }, { id: 'step_5', title: 'Get paid' }],
};

test('a composed plan in the vault: structureOf equals structureFromBlueprint(v1), and the structure holds the blocks', async t => {
  const { engine, first } = await keptVenture(t);
  const state = engine.vault!.read();
  const venture = state.conversations.find((record: any) => record.kind === 'venture-record');
  const interview = state.conversations.find((record: any) => record.kind === 'venture-interview');
  const composition = state.conversations.find((record: any) => record.kind === 'venture-composition');
  const structure = structureOf(venture, interview, composition);
  assert.deepEqual(structure, structureFromBlueprint(first));
  assert.deepEqual(structure.blocks, { offers: ['session', 'course', 'audit'], steps: ['collect-inputs', 'meet-client', 'draft-reply', 'follow-up', 'get-paid'], approvals: ['each-draft', 'client-files'], pages: ['home', 'offers-prices', 'about', 'start-request'], tools: ['google-calendar', 'google-drive'], notes: [] });
  assert.equal(first.structureHash, digest(structure));
  assert.equal(first.source, 'model');
  assert.deepEqual(first.offers.map(offer => offer.pricing.unitPriceMinor), ['4000', null, '12000']);
  assert.deepEqual(first.deliverySteps.map(step => step.block), structure.blocks!.steps);
  assert.deepEqual(first.starterConnectorIds, ['lovable', 'github', 'stripe', 'google-calendar', 'google-drive', 'chausar-books']);
});

test('later versions keep the composed parts: Rewrite with AI and blueprint.update keep pages, tools, notes, composition, approval blocks and block ids', async t => {
  const rewrite = { purpose: 'blueprint', kind: 'anthropic-messages', model: 'claude-sonnet-5-5', status: 200, mustInclude: ['agent-then-you'],
    body: { id: 'msg_synthetic_blueprint', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content: [{ type: 'text', text: JSON.stringify(BLUEPRINT_WORDS) }], stop_reason: 'end_turn', stop_details: null, usage: { input_tokens: 900, output_tokens: 200 } } };
  const wrongIds = { ...rewrite, body: { ...rewrite.body, content: [{ type: 'text', text: JSON.stringify({ ...BLUEPRINT_WORDS, offers: BLUEPRINT_WORDS.offers.slice(0, 2) }) }] } };
  const { engine, first } = await keptVenture(t, { responses: [rewrite, wrongIds] });
  const kept = (blueprint: any) => ({
    pages: blueprint.pages, tools: blueprint.tools, notes: blueprint.notes, composition: blueprint.composition, approvalBlocks: blueprint.approvalBlocks,
    approvals: blueprint.approvals, offerBlocks: blueprint.offers.map((o: any) => o.block), stepBlocks: blueprint.deliverySteps.map((s: any) => s.block),
  });
  const second = (await engine.request('venture.blueprint.draft', {}) as BlueprintView).blueprint;
  assert.equal(second.version, 2);
  assert.equal(second.name.value, 'Clear Sheets Lessons');
  assert.equal(second.structureHash, first.structureHash, 'a rewrite changes words, never the block structure');
  assert.deepEqual(kept(second), kept(first));
  assert.deepEqual(second.approvals.map(a => a.by), ['engine', 'engine'], 'approvals keep their fixed words');
  await assert.rejects(engine.request('venture.blueprint.draft', {}), code('MODEL_OUTPUT_REJECTED'), 'a model answer with other ids is refused');

  const third = (await engine.request('venture.blueprint.update', { patch: { offers: [{ id: 'offer_3', unitPrice: '150' }] } }) as BlueprintView).blueprint;
  assert.equal(third.offers[2].pricing.unitPriceMinor, '15000');
  assert.deepEqual(kept(third), kept(first));
  await assert.rejects(engine.request('venture.blueprint.update', { patch: { offers: [{ id: 'offer_2', pricingModel: 'hourly' }] } }), (error: any) => error.code === 'INVALID_VENTURE_REQUEST' && /can only be priced per project/.test(error.message));
  await assert.rejects(engine.request('venture.blueprint.update', { patch: { offers: [{ id: 'offer_4', unitPrice: '1' }] } }), code('INVALID_VENTURE_REQUEST'));

  // After both, the playbook still finds the drafting step by block and the brief still uses the plan's pages.
  const steps = playbookSteps(third);
  assert.equal(steps.find(step => step.id === 'draft')!.title, 'Send the notes', 'the drafting step is found by its block, with the rewritten title');
  assert.equal(steps.find(step => step.id === 'work')!.title, 'Do the hands-on work with tools', 'a lesson in person is never an agent step');
  assert.deepEqual(planPages(third)!.map(page => page.title), ['Home', 'Lessons and prices', 'About me', 'Ask for a lesson']);
  assert.equal(hasClientArea(third), false);
  const task = briefTask(engine.vault!.read().conversations.find((r: any) => r.kind === 'venture-record'), third, () => briefTemplateWords(third.serviceType, { name: third.name.value, customer: third.customer.value }));
  assert.match(task.instructions, /Use these pages, in this order/);
  assert.deepEqual((task.input as any).pages.map((page: any) => page.title), ['Home', 'Lessons and prices', 'About me', 'Ask for a lesson']);
});

test('a composed plan without an AI refuses NO_MODEL_CONNECTED and writes nothing; built-in words refuse before any work', async t => {
  const { engine } = await keptVenture(t);
  await assert.rejects(engine.request('venture.blueprint.draft', { useTemplate: true }), (error: any) => error.code === 'INVALID_VENTURE_REQUEST' && error.message === "This plan was made with your AI. Built-in words don't fit it.");
  const status = await engine.request('venture.models.status', {}) as ModelStatusView;
  for (const connection of status.connections.filter(c => c.status === 'connected')) await engine.request('venture.models.disconnect', { connectionId: connection.id });
  const before = JSON.stringify(engine.vault!.read().conversations.filter((r: any) => r.kind === 'venture-blueprint'));
  await assert.rejects(engine.request('venture.blueprint.draft', {}), (error: any) => error.code === 'NO_MODEL_CONNECTED' && error.message === 'This plan was made with your AI. Connect an AI to rewrite it.');
  assert.equal(JSON.stringify(engine.vault!.read().conversations.filter((r: any) => r.kind === 'venture-blueprint')), before);
});

test('template plans keep their structure hash and playbook titles', async t => {
  const { engine } = await engineFor(t);
  await engine.request('workspace.create', { name: 'Ledger Cafe Books', passphrase: PASSPHRASE, pack: 'services' });
  await engine.request('venture.create', { idea: 'Monthly bookkeeping for cafes and small shops in Pune.', countryCode: 'IN', workingName: 'Ledger Cafe Books' });
  await engine.request('venture.interview.next', { useTemplate: true });
  for (const [questionId, answer] of [['q_1', { skipped: true }], ['q_2', { skipped: true }], ['q_pricing_model', { choiceId: 'monthly' }], ['q_price', { amount: '2499' }], ['q_tax', { yes: false }]] as const) {
    await engine.request('venture.interview.answer', { questionId, answer });
  }
  const blueprint = (await engine.request('venture.blueprint.draft', { useTemplate: true }) as BlueprintView).blueprint;
  const structure = structureFromBlueprint(blueprint);
  assert.equal('blocks' in structure, false);
  assert.equal(blueprint.structureHash, digest(structure));
  // Pinned before onboarding v2: a template structure with these inputs hashes exactly as it did then.
  assert.equal(blueprint.structureHash, TEMPLATE_STRUCTURE_HASH);
  assert.equal(blueprint.offers.some(offer => 'block' in offer), false);
  const steps = playbookSteps(blueprint);
  assert.equal(steps.find(step => step.id === 'draft')!.title, blueprint.deliverySteps[2].title.value);
  assert.equal(steps.find(step => step.id === 'work')!.title, blueprint.deliverySteps[1].title.value);
});
const TEMPLATE_STRUCTURE_HASH = '846ea4b7e54aefc01c586add970e797aef8753883717f591d24a1dc335061882';

// ---------------------------------------------------------------------------
// Boundary
// ---------------------------------------------------------------------------

async function filesUnder(directory: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) out.push(...await filesUnder(path));
    else if (/\.(ts|js|cjs|mjs)$/.test(entry.name)) out.push(path);
  }
  return out;
}

test('boundary: nothing under platform/runtime imports from platform/tests; DRAFT_METHODS equals ONBOARDING_METHODS; the pre-vault methods stay the four', async () => {
  const runtime = new URL('../runtime/', import.meta.url);
  const files = await filesUnder(decodeURIComponent(runtime.pathname).replace(/^\/([A-Za-z]:)/, '$1'));
  assert.ok(files.length > 100, 'the scan reads the runtime files');
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    assert.doesNotMatch(source, /from\s+['"][^'"]*platform\/tests\/|from\s+['"](?:\.\.\/)+tests\/|import\(\s*['"][^'"]*\/tests\//, relative(process.cwd(), file));
  }
  assert.deepEqual([...DRAFT_METHODS], [...ONBOARDING_METHODS]);
  // The draft methods are not pre-vault; the one later addition is the Start gallery's list of ways (Ink v2 wave 4, 4J8).
  // W6 6C6: the compliance check also answers before a vault exists, so a new owner sees it on Start.
  assert.deepEqual([...PRE_VAULT_METHODS], ['venture.countries', 'venture.preview', 'venture.playbooks.list', 'venture.compliance.get']);
  assert.ok(initialState('x').policy, 'imports stay used');
  assert.ok(ChausarError);
});

