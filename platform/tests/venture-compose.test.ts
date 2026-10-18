// P-engine (onboarding v2): the composer, the block library, the view registry, the number guard and the repair
// path; the composed plan in the vault and its later versions; the boundary rules. Synthetic recordings only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { ChausarError, initialState } from '../runtime/contracts.ts';
import { DRAFT_METHODS, PRE_VAULT_METHODS } from '../runtime/venture/contracts.ts';
import type { BlueprintView, ModelCallRecord, ModelPreset, ModelStatusView, VentureView } from '../runtime/venture/contracts.ts';
import {
  AI_HALF_CONNECTED_WORDS, AI_OPTION_IDS, AI_OPTION_WORDS, AI_STATUS_CHIPS, AI_UNCHECKED_LINE, APPROVAL_BLOCK_IDS, COMPOSE_REFUSED_WORDS,
  KIND_LABELS, NOTE_BLOCK_IDS, NOT_A_SERVICE_WORDS, OFFER_BLOCK_IDS, ONBOARDING_METHODS, PAGE_BLOCK_IDS, QUESTION_BLOCK_IDS,
  STEP_BLOCK_IDS, TOOL_BLOCK_IDS, VIEW_IDS, VIEW_REGISTRY,
} from '../runtime/venture/onboarding-contracts.ts';
import type { AiOptionsView, AiStatusView, ComposeDecision, ComposedPlan, ComposeModelOutput, ViewId } from '../runtime/venture/onboarding-contracts.ts';
import { assertNoNumbers, assertNoSpelledNumbers, copiedTokens, digest, doneClaimFindings, houseStyleFindings } from '../runtime/venture/records.ts';
import {
  APPROVAL_BLOCKS, NOTE_BLOCKS, OFFER_BLOCKS, PAGE_BLOCKS, QUESTION_BLOCKS, STEP_BLOCKS, TOOL_BLOCKS, blockFixedWords,
} from '../runtime/venture/core/blocks.ts';
import {
  DECIDE_SCHEMA, applyComposePatch, assembleComposed, composeSchema, makeDecision, validateCompose, validateDecide,
} from '../runtime/venture/core/compose.ts';
import { structureFromBlueprint, structureOf } from '../runtime/venture/core/blueprint.ts';
import { allowedViewPicks } from '../runtime/venture/core/views.ts';
import { countryProfile } from '../runtime/venture/core/countries.ts';
import { CONNECTOR_CATALOGUE } from '../runtime/venture/build/catalogue.ts';
import { briefTask, briefTemplateWords, hasClientArea, planPages } from '../runtime/venture/build/brief.ts';
import { playbookSteps } from '../runtime/venture/delivery/playbook.ts';
import { assertSchemaSafe } from '../runtime/venture/models/schema.ts';
import { AVAILABILITY_REASONS, PRESETS } from '../runtime/venture/models/presets.ts';
import { aiOptionsView } from '../runtime/venture/draft/index.ts';
import {
  CAFE_COMPOSE, CAFE_DECIDE, CAFE_TEXT, DOG_COMPOSE, DOG_DECIDE, DOG_TEXT, EXCEL_COMPOSE, EXCEL_DECIDE, EXCEL_TEXT, anthropicEntry, planEntries,
} from './fixtures/venture/compose-unit/plans.ts';
import { PASSPHRASE, TEST_KEY, compose, connectPair, engineFor } from './fixtures/venture/compose-unit/harness.ts';

const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected, error?.message); return true; };
const rejected = (pattern?: RegExp) => (error: any) => {
  assert.equal(error?.code, 'MODEL_OUTPUT_REJECTED', error?.message);
  if (pattern) assert.match(error.message, pattern);
  return true;
};
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

const GB = countryProfile('GB');
const writtenBy = { presetId: 'anthropic-sonnet-5-5' as const, model: 'claude-sonnet-5-5', replay: true };
function decisionOf(output: typeof DOG_DECIDE, text: string, country = GB): ComposeDecision {
  return makeDecision({ composeId: 'compose_unit', text, country, output, callIds: ['modelcall_decide'], writtenBy, at: '2026-10-18T10:00:00.000Z' });
}
const clone = <T>(value: T): T => structuredClone(value);

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
  assert.deepEqual(Object.keys(PAGE_BLOCKS), [...PAGE_BLOCK_IDS]);
  assert.deepEqual(Object.keys(QUESTION_BLOCKS), [...QUESTION_BLOCK_IDS]);
  assert.deepEqual(Object.keys(NOTE_BLOCKS), [...NOTE_BLOCK_IDS]);
  assert.deepEqual(Object.keys(TOOL_BLOCKS), [...TOOL_BLOCK_IDS]);
  const strings: [string, string][] = [
    ...blockFixedWords().map(value => [value, 'block'] as [string, string]),
    ...AI_OPTION_IDS.flatMap(id => [AI_OPTION_WORDS[id].label, AI_OPTION_WORDS[id].line, AI_OPTION_WORDS[id].why].map(value => [value, id] as [string, string])),
    ...Object.values(AI_STATUS_CHIPS).map(value => [value, 'chip'] as [string, string]),
    [AI_UNCHECKED_LINE, 'unchecked'], [AI_HALF_CONNECTED_WORDS, 'half'], [NOT_A_SERVICE_WORDS, 'not a service'], [COMPOSE_REFUSED_WORDS, 'refused'],
    ...Object.values(KIND_LABELS).map(value => [value, 'kind'] as [string, string]),
    ...VIEW_REGISTRY.flatMap(view => [[view.heading, view.id], [view.pick, view.id]] as [string, string][]),
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
  assert.equal(why, "OpenAI lets only open-source tools, personal hobby projects and partners it picks use a ChatGPT plan. Chausar is a commercial app and hasn't been approved yet. Use an OpenAI key for now.");
  assert.doesNotMatch(why, /Codex|Claude|Anthropic/);
  assert.equal(AI_OPTION_WORDS['chatgpt-sign-in'].line, 'Not open to Chausar yet.');
});

function statusStub(): AiStatusView {
  return {
    connections: [], tiers: {
      fast: { presetId: 'built-in-templates', model: null, usable: true, reason: '', verification: 'built-in', verificationNote: null },
      main: { presetId: 'built-in-templates', model: null, usable: true, reason: '', verification: 'built-in', verificationNote: null },
    },
    spentThisMonthMicros: '0', spentThisMonthDisplay: 'USD 0.0000', estimate: false, sendPolicy: 'shape', replay: { active: true, label: 'synthetic recording' },
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
  assert.deepEqual(view.options.map(option => option.id), [...AI_OPTION_IDS]);
  const byId = Object.fromEntries(view.options.map(option => [option.id, option]));
  assert.equal(byId['api-key'].status, 'unverified', 'Anthropic ready and OpenAI unverified: the weakest wins');
  assert.equal(AI_STATUS_CHIPS[byId['api-key'].status], 'Can connect');
  assert.deepEqual(byId['api-key'].recommended, { fast: 'anthropic-haiku-5-5', main: 'anthropic-sonnet-5-5' });
  assert.equal(byId['api-key'].canConnect, true);
  assert.deepEqual(byId['chatgpt-sign-in'], { id: 'chatgpt-sign-in', ...AI_OPTION_WORDS['chatgpt-sign-in'], status: 'not-open', canConnect: false, presetIds: [], recommended: null });
  assert.equal(byId['claude-code'].status, 'needs-setup');
  assert.equal(byId['claude-code'].canConnect, false, 'the terms gate is pending');
  assert.equal(byId.codex.canConnect, false);
  assert.equal(view.unchecked, true);
  assert.equal(aiOptionsView(livePresets(), statusStub(), true).options.find(option => option.id === 'claude-code')!.canConnect, true, 'gate open: Check and connect runs the version check');
  // Every connectable preset verified: the unchecked line hides.
  const verified = livePresets(Object.fromEntries(PRESETS.map(spec => [spec.id, { verification: 'built-in' as const, verificationNote: null }])));
  assert.equal(aiOptionsView(verified, statusStub(), false).unchecked, false);
});

test('catalogue and registry: every tool block is a catalogue connector and never a payment one; three lead views', () => {
  const catalogue = new Map(CONNECTOR_CATALOGUE.map(entry => [entry.id, entry]));
  for (const id of TOOL_BLOCK_IDS) {
    assert.ok(catalogue.has(id), id);
    assert.notEqual(catalogue.get(id)!.category, 'payments', id);
  }
  assert.deepEqual(VIEW_REGISTRY.map(view => view.id), [...VIEW_IDS]);
  assert.deepEqual(VIEW_REGISTRY.filter(view => view.role === 'lead').map(view => view.id), ['offers-first', 'steps-first', 'audience-first']);
});

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

function walk(node: unknown, visit: (node: Record<string, unknown>) => void) {
  if (Array.isArray(node)) { node.forEach(item => walk(item, visit)); return; }
  if (node && typeof node === 'object') { visit(node as Record<string, unknown>); for (const child of Object.values(node)) walk(child, visit); }
}

test('schemas: decide and every compose schema for every allowed view pick pass assertSchemaSafe, with no number type anywhere', () => {
  const picks = allowedViewPicks();
  assert.ok(picks.length > 100, 'every lead view with one to three support views in any order');
  for (const schema of [DECIDE_SCHEMA, ...picks.map(views => composeSchema(views))]) {
    assertSchemaSafe(schema);
    walk(schema, node => { assert.notEqual(node.type, 'number'); assert.notEqual(node.type, 'integer'); });
    assert.doesNotMatch(JSON.stringify(schema), /"(number|integer)"/);
  }
  const schema = composeSchema(['offers-first', 'pages']) as any;
  assert.deepEqual(Object.keys(schema.properties.views.properties), ['offers-first', 'pages']);
  assert.deepEqual(schema.properties.views.required, ['offers-first', 'pages']);
});

// ---------------------------------------------------------------------------
// validateDecide
// ---------------------------------------------------------------------------

test('validateDecide refuses each broken rule with MODEL_OUTPUT_REJECTED', () => {
  const allowed = copiedTokens(DOG_TEXT);
  assert.deepEqual(validateDecide(clone(DOG_DECIDE), allowed), DOG_DECIDE);
  const bad: [string, unknown][] = [
    ['unknown view', { ...DOG_DECIDE, views: ['offers-first', 'gallery'] }],
    ['two lead views', { ...DOG_DECIDE, views: ['offers-first', 'steps-first'] }],
    ['lead not first', { ...DOG_DECIDE, views: ['pages', 'offers-first'] }],
    ['one view', { ...DOG_DECIDE, views: ['offers-first'] }],
    ['five views', { ...DOG_DECIDE, views: ['offers-first', 'pages', 'tools', 'questions', 'notes'] }],
    ['digit in reading', { ...DOG_DECIDE, reading: 'Walk dogs for 2 nurses' }],
    ['spelled price in reading', { ...DOG_DECIDE, reading: 'Walk dogs for twenty pounds' }],
    ['thirteen words', { ...DOG_DECIDE, reading: 'Walk the dogs of nurses who work long shifts in the city of Leeds' }],
    ['markup in reading', { ...DOG_DECIDE, reading: 'Walk <b>dogs</b> for nurses' }],
    ['views for not-a-service', { kind: 'not-a-service', family: 'other', reading: '', views: ['offers-first', 'pages'] }],
    ['extra key', { ...DOG_DECIDE, extra: true }],
    ['unknown family', { ...DOG_DECIDE, family: 'pets' }],
  ];
  for (const [label, raw] of bad) assert.throws(() => validateDecide(raw, allowed), rejected(), label);
  assert.deepEqual(validateDecide({ kind: 'not-a-service', family: 'whatever', reading: 'ignored 9', views: [] }, allowed).views, []);
});

// ---------------------------------------------------------------------------
// validateCompose
// ---------------------------------------------------------------------------

const DOG_CTX = { views: DOG_DECIDE.views, allowed: copiedTokens(DOG_TEXT) };
function dogWith(change: (plan: any) => void): unknown {
  const plan = clone(DOG_COMPOSE) as any;
  change(plan);
  return plan;
}

test('validateCompose refuses every rule of section 6.4', () => {
  assert.deepEqual(validateCompose(clone(DOG_COMPOSE), DOG_CTX), DOG_COMPOSE);
  const cases: [string, (plan: any) => void, RegExp?][] = [
    ['unknown block', p => { p.offers[0].block = 'franchise'; }],
    ['no draft-reply', p => { p.steps[2].block = 'follow-up'; }],
    ['two draft-replies', p => { p.steps[0].block = 'draft-reply'; }],
    ['send before draft-reply', p => { p.steps[1] = { block: 'send', title: 'Send it' }; p.steps.reverse(); }],
    ['missing each-draft', p => { p.approvals = ['prices-invoices']; }],
    ['missing home', p => { p.pages[0].block = 'about'; }],
    ['missing offers-prices', p => { p.pages[1].block = 'about'; }],
    ['payments tool', p => { p.tools[0].block = 'stripe'; }],
    ['pricing not allowed', p => { p.offers[0].pricingModel = 'hourly'; }],
    ['question about price', p => { p.questions = [{ block: 'area', kind: 'text', text: 'What will you charge?', choices: [] }]; }],
    ['choice count', p => { p.questions = [{ block: 'area', kind: 'choice', text: 'Where do you work?', choices: ['Leeds'] }]; }],
    ['questions without the view', p => { p.questions = [{ block: 'area', kind: 'text', text: 'Where do you work?', choices: [] }]; }],
    ['notes without the view', p => { p.notes = []; }],
    ['view keys not decided', p => { p.views = { 'offers-first': { lead: ['offer_1'] }, pages: { lead: ['page_1', 'page_2'] } }; }],
    ['lead ref to a missing item', p => { p.views['offers-first'].lead = ['offer_1', 'offer_3']; }],
    ['lead count out of range', p => { p.views.pages.lead = ['page_1']; }],
    ['digit', p => { p.offers[0].description = 'Walks for 2 dogs at once.'; }],
    ['currency sign', p => { p.offers[0].description = 'Walks from £ each time.'; }],
    ['magnitude word', p => { p.oneLiner = 'Walks for thousands of dogs in Leeds.'; }],
    ['em dash', p => { p.oneLiner = 'Dog walks \u2014 for nurses in Leeds.'; }],
    ['banned word', p => { p.oneLiner = 'We leverage local walkers for nurses.'; }],
    ['finished-work claim', p => { p.oneLiner = 'Every walk is completed and checked.'; }],
    ['markup', p => { p.offers[0].description = 'Walks <b>every</b> week.'; }],
    ['link', p => { p.pages[0].purpose = 'See https://example.org for more.'; }],
    ['five-word name', p => { p.name = 'Shift Paws Dog Walks Leeds'; }],
    ['five-word offer name', p => { p.offers[0].name = 'Weekly walks for busy nurses'; }],
    ['five-word step title', p => { p.steps[1].title = 'Walk the dogs each day'; }],
    ['Twenty pounds a walk', p => { p.offers[0].description = 'Twenty pounds a walk.'; }, /in words/],
    ['fifty rupees', p => { p.oneLiner = 'Walks for fifty rupees.'; }],
    ['ten sessions', p => { p.offers[1].description = 'Covers ten sessions while you are away.'; }],
    ['GBP', p => { p.offers[1].description = 'Priced in GBP while you are away.'; }],
    ['half price', p => { p.offers[1].description = 'Half price for nurses.'; }],
    ['free first visit', p => { p.offers[0].description = 'A free first visit.'; }],
    ['a second visit', p => { p.offers[0].description = 'A second visit on long days.'; }],
    ['two-day course', p => { p.offers[1].description = 'A two-day cover plan.'; }],
    ['twice a week', p => { p.offers[0].description = 'Walks twice a week.'; }],
    ['discounted rates', p => { p.oneLiner = 'Discounted walks for nurses in Leeds.'; }],
    ['same offer name', p => { p.offers[1].name = 'weekly WALKS'; }],
    ['step block twice', p => { p.steps[0].block = 'in-person-work'; }],
  ];
  for (const [label, change, pattern] of cases) assert.throws(() => validateCompose(dogWith(change), DOG_CTX), rejected(pattern), label);
  // These pass: copied letter-and-digit tokens, a currency code the owner wrote, and allowed compounds and words.
  const passes: [string, string, (plan: any) => void][] = [
    ['B2B', 'Help B2B teams with dog walks in Leeds.', p => { p.oneLiner = 'Dog walks for B2B teams in Leeds.'; }],
    ['CAD drawings', 'CAD drawings for small builders in Leeds.', p => { p.offers[0].description = 'Clear CAD drawings for builders.'; }],
    ['stress-free', DOG_TEXT, p => { p.offers[0].description = 'Stress-free walks on the days you work.'; }],
    ['second-hand', DOG_TEXT, p => { p.offers[1].description = 'Walks with second-hand leads you lend us.'; }],
    ['your first client', DOG_TEXT, p => { p.oneLiner = 'Walks ready for your first client in Leeds.'; }],
    ['one visit', DOG_TEXT, p => { p.offers[1].description = 'One visit each day while you are away.'; }],
  ];
  for (const [label, text, change] of passes) validateCompose(dogWith(change), { views: DOG_DECIDE.views, allowed: copiedTokens(text) }), label;
  assert.throws(() => validateCompose(dogWith(p => { p.offers[0].description = 'Clear CAD drawings for builders.'; }), DOG_CTX), rejected(), 'CAD without the owner writing it');
  // The other two sentence kinds validate too.
  validateCompose(clone(EXCEL_COMPOSE), { views: EXCEL_DECIDE.views, allowed: copiedTokens(EXCEL_TEXT) });
  validateCompose(clone(CAFE_COMPOSE), { views: CAFE_DECIDE.views, allowed: copiedTokens(CAFE_TEXT) });
});

// ---------------------------------------------------------------------------
// Assembly and owner edits (pure)
// ---------------------------------------------------------------------------

test('assembleComposed is pure: ids by order, labels, step data from the library, tool cards, allowed pricing, and a digest per edit', () => {
  const decision = decisionOf(DOG_DECIDE, DOG_TEXT);
  const output = validateCompose(clone(DOG_COMPOSE), DOG_CTX);
  const meta = { writtenBy, composeCallIds: ['modelcall_compose'] };
  const plan = assembleComposed(decision, output, GB, meta);
  assert.deepEqual(assembleComposed(decision, output, GB, meta), plan, 'the same inputs give the same plan');
  assert.deepEqual(plan.offers.map(offer => offer.id), ['offer_1', 'offer_2']);
  assert.deepEqual(plan.steps.map(step => step.id), ['step_1', 'step_2', 'step_3', 'step_4']);
  assert.deepEqual(plan.pages.map(page => page.id), ['page_1', 'page_2', 'page_3', 'page_4']);
  assert.deepEqual(plan.name, { value: 'Shift Paws Leeds', label: 'assumption', by: 'model' });
  assert.equal(plan.kindLabel, KIND_LABELS.idea);
  const walk = plan.steps[1];
  assert.deepEqual([walk.block, walk.doneBy, walk.capability, walk.note], ['in-person-work', 'you', 'yours', STEP_BLOCKS['in-person-work'].note]);
  assert.equal(plan.steps.find(step => step.block === 'draft-reply')!.capability, 'drafts-now');
  assert.deepEqual(plan.offers.map(offer => offer.allowedPricing), [['monthly'], ['project']]);
  assert.deepEqual(plan.offers.map(offer => [offer.pricing.unitPriceMinor, offer.priceDisplay]), [[null, null], [null, null]]);
  assert.deepEqual(plan.approvals.map(approval => [approval.block, approval.value, approval.by]), [['each-draft', APPROVAL_BLOCKS['each-draft'].words, 'engine'], ['prices-invoices', APPROVAL_BLOCKS['prices-invoices'].words, 'engine']]);
  assert.deepEqual(plan.notes.map(note => note.text), [NOTE_BLOCKS.insurance.words, NOTE_BLOCKS.safety.words]);
  assert.deepEqual(plan.tools.map(tool => [tool.block, tool.card.id, tool.card.starter]), [['cal-com', 'cal-com', true], ['whatsapp', 'whatsapp', true]]);
  assert.deepEqual(plan.views.map(view => view.id), ['offers-first', 'pages', 'notes']);
  assert.equal(plan.backOffice.taxRegistered.value, false);
  assert.equal(plan.taxQuestion.id, 'q_tax');
  assert.deepEqual(plan.calls, { decide: ['modelcall_decide'], compose: ['modelcall_compose'] });

  const priced = applyComposePatch(plan, { offers: [{ id: 'offer_1', unitPrice: '18' }, { id: 'offer_2', unitPrice: '60.50' }] });
  assert.notEqual(priced.digest, plan.digest);
  assert.deepEqual(priced.offers.map(offer => [offer.pricing.unitPriceMinor, offer.pricing.unitPriceLabel, offer.priceDisplay]), [['1800', 'told-by-you', 'GBP 18.00'], ['6050', 'told-by-you', 'GBP 60.50']]);
  assert.equal(plan.offers[0].pricing.unitPriceMinor, null, 'the patch never changes the plan it was given');
  const taxed = applyComposePatch(priced, { taxRegistered: true });
  assert.notEqual(taxed.digest, priced.digest);
  assert.equal(taxed.backOffice.taxRegistered.value, true);
  assert.throws(() => applyComposePatch(plan, { offers: [{ id: 'offer_1', pricingModel: 'hourly' }] }), code('INVALID_VENTURE_REQUEST'));
  assert.throws(() => applyComposePatch(plan, { offers: [{ id: 'offer_3', unitPrice: '5' }] }), code('OFFER_NOT_FOUND'));
  assert.throws(() => applyComposePatch(plan, { offers: [{ id: 'offer_1', unitPrice: '0' }] }), code('INVALID_AMOUNT'));
  assert.throws(() => applyComposePatch(plan, { answers: [{ questionId: 'q_1', answer: { text: 'Leeds' } }] }), code('QUESTION_NOT_FOUND'));
  assert.throws(() => applyComposePatch(plan, { countryCode: 'ZZ' }), code('UNKNOWN_COUNTRY'));
  const india = applyComposePatch(priced, { countryCode: 'IN' });
  assert.equal(india.country.code, 'IN');
  assert.equal(india.backOffice.currency, 'INR');
  assert.ok(india.offers.every(offer => offer.pricing.unitPriceMinor === null && offer.priceDisplay === null), 'a new currency clears every price');
  // Turning tax on where the country has no standard rate needs a rate.
  const us = applyComposePatch(plan, { countryCode: 'US' });
  assert.throws(() => applyComposePatch(us, { taxRegistered: true }), code('INVALID_TAX_RATE'));
  assert.equal(applyComposePatch(us, { taxRegistered: true, taxRate: '8.25' }).backOffice.taxRateBps, '825');
  // Answers for the skill plan.
  const skill = assembleComposed(decisionOf(EXCEL_DECIDE, EXCEL_TEXT), validateCompose(clone(EXCEL_COMPOSE), { views: EXCEL_DECIDE.views, allowed: [] }), GB, meta);
  assert.deepEqual(skill.questions.map(q => [q.id, q.field, q.by, q.required]), [['q_1', 'customer', 'model', false], ['q_2', 'other', 'model', false]]);
  assert.deepEqual(skill.questions[0].choices.map(choice => choice.id), ['c_1', 'c_2', 'c_3']);
  const answered = applyComposePatch(skill, { answers: [{ questionId: 'q_1', answer: { choiceId: 'c_2' } }, { questionId: 'q_2', answer: { skipped: true } }] });
  assert.deepEqual(answered.questions.map(q => q.answer), [{ choiceId: 'c_2' }, { skipped: true }]);
  assert.throws(() => applyComposePatch(skill, { answers: [{ questionId: 'q_1', answer: { choiceId: 'c_9' } }] }), code('INVALID_VENTURE_REQUEST'));
  assert.deepEqual(skill.offers.map(offer => offer.allowedPricing), [['hourly', 'project'], ['project'], ['project']]);
  assert.equal(applyComposePatch(skill, { offers: [{ id: 'offer_1', pricingModel: 'project' }] }).offers[0].pricing.quantityUnit, 'project');
});

// ---------------------------------------------------------------------------
// The repair path, through the real Engine and the draft desk
// ---------------------------------------------------------------------------

async function callsOf(engine: any): Promise<ModelCallRecord[]> {
  return await engine.request('venture.ai.calls', { limit: 100 }) as ModelCallRecord[];
}

test('repair: a rejected compose then a valid one gives a plan with two compose calls, the first failed; the repair sends the problem, not the rejected text', async t => {
  const broken = { ...clone(DOG_COMPOSE), offers: [{ ...DOG_COMPOSE.offers[0], description: 'Walks for 2 dogs at once.' }, DOG_COMPOSE.offers[1]] };
  const { engine } = await engineFor(t, { responses: [
    ...planEntries(DOG_TEXT, DOG_DECIDE, broken),
    anthropicEntry('compose', DOG_COMPOSE, ['chausar-recompose-v1', DOG_TEXT.slice(0, 16)]),
  ] });
  await connectPair(engine);
  const { plan } = await compose(engine, DOG_TEXT, 'GB');
  assert.equal(plan.name.value, 'Shift Paws Leeds');
  assert.equal(plan.calls.compose.length, 2);
  const calls = await callsOf(engine);
  const composeCalls = calls.filter(call => call.purpose === 'compose').reverse();
  assert.deepEqual(composeCalls.map(call => call.status), ['failed', 'completed']);
  assert.equal(composeCalls[0].error?.code, 'MODEL_OUTPUT_REJECTED');
  assert.deepEqual(composeCalls.map(call => call.id), plan.calls.compose);
  const repair = composeCalls[1].payloadText;
  assert.match(repair, /chausar-recompose-v1/);
  assert.match(repair, /Your last answer was refused/);
  assert.match(repair, /offer description contained a number/);
  assert.doesNotMatch(repair, /Walks for 2 dogs/, 'the rejected text is never sent back');
  assert.doesNotMatch(composeCalls[0].payloadText, /GBP|"currency"/, 'the compose input holds no currency');
});

test('repair: rejected twice is COMPOSE_REFUSED with no plan; rejected then a timeout is the timeout; a failed call is never repaired', async t => {
  const unknown = { ...clone(DOG_COMPOSE), offers: [{ ...DOG_COMPOSE.offers[0], block: 'franchise' }] } as unknown as ComposeModelOutput;
  const twice = await engineFor(t, { responses: [
    ...planEntries(DOG_TEXT, DOG_DECIDE, unknown),
    anthropicEntry('compose', unknown, ['chausar-recompose-v1']),
  ] });
  await connectPair(twice.engine);
  const decision = await twice.engine.request('venture.compose.decide', { text: DOG_TEXT, countryCode: 'GB' }) as ComposeDecision;
  await assert.rejects(twice.engine.request('venture.compose.fill', { composeId: decision.composeId }), (error: any) => error.code === 'COMPOSE_REFUSED' && error.message === COMPOSE_REFUSED_WORDS);
  const state = await twice.engine.request('venture.compose.get', {}) as { decision: ComposeDecision; plan: ComposedPlan | null };
  assert.equal(state.plan, null, 'no plan is ever stored from a refused answer');
  assert.equal(state.decision.composeId, decision.composeId, 'the decision stays, so Try again calls fill again');
  assert.deepEqual((await callsOf(twice.engine)).filter(call => call.purpose === 'compose').map(call => call.status), ['failed', 'failed']);

  // Rejected, then the repair times out: the timeout passes through with the port's words.
  const timeout = await engineFor(t, { responses: [
    ...planEntries(DOG_TEXT, DOG_DECIDE, unknown),
    { ...anthropicEntry('compose', DOG_COMPOSE, ['chausar-recompose-v1']), body: { type: 'message', content: [{ type: 'text', text: '{}' }], stop_reason: 'max_tokens', usage: { input_tokens: 1, output_tokens: 1 } } },
  ] });
  await connectPair(timeout.engine);
  const second = await timeout.engine.request('venture.compose.decide', { text: DOG_TEXT, countryCode: 'GB' }) as ComposeDecision;
  await assert.rejects(timeout.engine.request('venture.compose.fill', { composeId: second.composeId }), code('MODEL_INCOMPLETE'));

  // A failed call (HTTP error) is never repaired.
  const failed = await engineFor(t, { responses: [
    ...planEntries(DOG_TEXT, DOG_DECIDE, null),
    { ...anthropicEntry('compose', DOG_COMPOSE, ['chausar-compose-v1']), status: 500 },
    anthropicEntry('compose', DOG_COMPOSE, ['chausar-recompose-v1']),
  ] });
  await connectPair(failed.engine);
  const third = await failed.engine.request('venture.compose.decide', { text: DOG_TEXT, countryCode: 'GB' }) as ComposeDecision;
  await assert.rejects(failed.engine.request('venture.compose.fill', { composeId: third.composeId }), code('MODEL_FAILED'));
  assert.equal((await callsOf(failed.engine)).filter(call => call.purpose === 'compose').length, 1, 'one call, no repair');
});

test('repair: decide with two lead views then a valid redecide; a not-a-service sentence gets no views and fill refuses', async t => {
  const { engine } = await engineFor(t, { responses: [
    anthropicEntry('decide', { ...DOG_DECIDE, views: ['offers-first', 'steps-first'] }, ['chausar-decide-v1']),
    anthropicEntry('decide', DOG_DECIDE, ['chausar-redecide-v1']),
    anthropicEntry('decide', { kind: 'not-a-service', family: 'other', reading: 'Fix the heating', views: [] }, ['chausar-decide-v1', 'My landlord']),
  ] });
  await connectPair(engine);
  const decision = await engine.request('venture.compose.decide', { text: DOG_TEXT, countryCode: 'GB' }) as ComposeDecision;
  assert.deepEqual(decision.views, ['offers-first', 'pages', 'notes']);
  assert.equal(decision.callIds.length, 2);
  const landlord = await engine.request('venture.compose.decide', { text: "My landlord won't fix the heating.", countryCode: 'GB' }) as ComposeDecision;
  assert.deepEqual([landlord.kind, landlord.views, landlord.family, landlord.reading, landlord.refusal], ['not-a-service', [], null, null, NOT_A_SERVICE_WORDS]);
  await assert.rejects(engine.request('venture.compose.fill', { composeId: landlord.composeId }), code('COMPOSE_NOT_A_SERVICE'));
  await assert.rejects(engine.request('venture.compose.fill', { composeId: decision.composeId }), code('COMPOSE_NOT_FOUND'), 'decide replaces any earlier session');
});

// ---------------------------------------------------------------------------
// The composed plan in the vault, and its later versions
// ---------------------------------------------------------------------------

async function keptVenture(t: any, extra: { responses?: any[] } = {}) {
  const { engine } = await engineFor(t, { responses: [...planEntries(EXCEL_TEXT, EXCEL_DECIDE, EXCEL_COMPOSE), ...(extra.responses ?? [])] });
  await connectPair(engine);
  let { plan } = await compose(engine, EXCEL_TEXT, 'GB');
  plan = await engine.request('venture.compose.update', { composeId: plan.composeId, patch: { offers: [{ id: 'offer_1', unitPrice: '40' }, { id: 'offer_3', unitPrice: '120' }], answers: [{ questionId: 'q_2', answer: { text: 'Leeds' } }] } }) as ComposedPlan;
  await engine.request('workspace.create', { name: 'Clear Sheets', passphrase: PASSPHRASE, pack: 'services' });
  const view = await engine.request('venture.create', { idea: EXCEL_TEXT, countryCode: 'GB', workingName: 'Clear Sheets', composeId: plan.composeId, composedDigest: plan.digest }) as VentureView;
  const first = await engine.request('venture.blueprint.get', {}) as BlueprintView;
  return { engine, plan, view, first: first.blueprint };
}

const BLUEPRINT_WORDS = {
  name: 'Clear Sheets Lessons', oneLiner: 'Calm Excel lessons for people at work.', customer: 'Office workers who want ease with Excel.',
  offers: [{ id: 'offer_1', name: 'Excel lesson', description: 'A lesson on what you need now.' }, { id: 'offer_2', name: 'Basics course', description: 'Lessons from the start.' }, { id: 'offer_3', name: 'Workbook check', description: 'A look at your workbook.' }],
  steps: [{ id: 'step_1', title: 'Gather the workbook' }, { id: 'step_2', title: 'Teach the lesson' }, { id: 'step_3', title: 'Send the notes' }, { id: 'step_4', title: 'Check in later' }, { id: 'step_5', title: 'Get paid' }],
};

test('the composed plan in the vault: structureOf equals structureFromBlueprint(v1), and the structure holds the blocks', async t => {
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
  // The interview arrives answered, with the pricing question limited to offer_1's block.
  assert.ok(interview.questions.every((q: any) => q.answer !== null));
  assert.deepEqual(interview.questions.find((q: any) => q.id === 'q_pricing_model').choices.map((c: any) => c.id), ['project', 'hourly']);
  assert.deepEqual(interview.questions.find((q: any) => q.id === 'q_price').answer, { amount: '40.00' });
  assert.deepEqual(interview.questions.find((q: any) => q.id === 'q_2').answer, { text: 'Leeds' });
  assert.deepEqual(interview.questions.find((q: any) => q.id === 'q_1').answer, { skipped: true });
  await assert.rejects(engine.request('venture.interview.answer', { questionId: 'q_pricing_model', answer: { choiceId: 'monthly' } }), code('INVALID_VENTURE_REQUEST'));
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

test('boundary: nothing under platform/runtime imports from platform/tests; DRAFT_METHODS equals ONBOARDING_METHODS; the pre-vault two stay two', async () => {
  const runtime = new URL('../runtime/', import.meta.url);
  for (const file of await filesUnder(runtime.pathname.replace(/^\/([A-Za-z]:)/, '$1'))) {
    const source = await readFile(file, 'utf8');
    assert.doesNotMatch(source, /from\s+['"][^'"]*platform\/tests\/|from\s+['"](?:\.\.\/)+tests\/|import\(\s*['"][^'"]*\/tests\//, relative(process.cwd(), file));
  }
  assert.deepEqual([...DRAFT_METHODS], [...ONBOARDING_METHODS]);
  assert.deepEqual([...PRE_VAULT_METHODS], ['venture.countries', 'venture.preview']);
  assert.ok(initialState('x').policy, 'imports stay used');
  assert.ok(ChausarError);
});

