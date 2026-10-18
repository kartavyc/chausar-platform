// Sample onboarding results for the renderer tests (onboarding v2, P-renderer). A synthetic recording: written by hand
// against the onboarding contract, never captured from a live engine or model provider. The decisions and plans are
// built from hand-written model output that first passes the engine's own checks (validateDecide, validateCompose)
// and is then assembled by the engine's own pure assembly, so every plan here has the shape the engine really sends.
// No amount is worked out here: prices are the owner's typed text, formatted by the engine's own patch function.
import type { AiOptionsView, AiStatusView, ComposeDecision, ComposedPlan, ComposeModelOutput, DecideModelOutput, OpenBoxKind, WrittenBy } from '../../../../runtime/venture/onboarding-contracts.ts';
import type { BlueprintView, CountryProfile, ModelCallRecord, ModelPreset, ModelPresetId, ModelStatusView, PriceReceiptRecord, VentureView } from '../../../../runtime/venture/contracts.ts';
import { assembleComposed, makeDecision, validateCompose, validateDecide } from '../../../../runtime/venture/core/compose.ts';
import { countryProfile } from '../../../../runtime/venture/core/countries.ts';
import { aiOptionsView } from '../../../../runtime/venture/draft/handlers.ts';
import { AVAILABILITY_REASONS } from '../../../../runtime/venture/models/presets.ts';
import { copiedTokens } from '../../../../runtime/venture/records.ts';
import * as F from './results.ts';

export const label = 'synthetic recording' as const;
const at = '2026-10-18T09:30:00.000Z';
const hex = (seed: string) => seed.repeat(64).slice(0, 64);
const base = { ventureId: 'venture_draft_demo', memberId: 'owner', epoch: 1, at };

// ---------------------------------------------------------------------------------------------
// Countries: the engine's own profiles
// ---------------------------------------------------------------------------------------------
export const gb: CountryProfile = countryProfile('GB');
export const india: CountryProfile = countryProfile('IN');
export const uae: CountryProfile = countryProfile('AE');
export const countries: CountryProfile[] = [india, gb, uae, countryProfile('US'), countryProfile('XX')];

// ---------------------------------------------------------------------------------------------
// Presets before the vault, with live availability and the Claude Code terms gate
// ---------------------------------------------------------------------------------------------
export const LIVE_KEY = 'Not yet checked with a live key.';
export const LIVE_TASK = 'Not yet checked on a real task.';
const live = (id: ModelPresetId, change: Partial<ModelPreset>): ModelPreset => ({ ...F.presets.find(preset => preset.id === id)!, ...change });
/** The terms gate pending (the default in every build): Claude Code needs setup and says why. */
export const presets: ModelPreset[] = [
  live('anthropic-haiku-5-5', { availability: 'ready', availabilityReason: AVAILABILITY_REASONS.anthropic, verificationNote: LIVE_KEY }),
  live('anthropic-sonnet-5-5', { availability: 'ready', availabilityReason: AVAILABILITY_REASONS.anthropic, verificationNote: LIVE_KEY }),
  live('openai-gpt-6-luna', { availability: 'unverified', availabilityReason: AVAILABILITY_REASONS.luna, verificationNote: LIVE_KEY }),
  live('claude-code-cli', { availability: 'needs-setup', availabilityReason: AVAILABILITY_REASONS.claudeTerms, verificationNote: LIVE_TASK }),
  live('codex-cli', { availability: 'needs-setup', availabilityReason: AVAILABILITY_REASONS.codexMissing, verificationNote: LIVE_TASK }),
  live('built-in-templates', { verificationNote: null }),
];
/** The terms gate open and Claude Code found on this computer. */
export const presetsGateOpen: ModelPreset[] = presets.map(preset => (preset.id === 'claude-code-cli'
  ? { ...preset, availability: 'unverified', availabilityReason: AVAILABILITY_REASONS.claudeFound } : preset));
/** A preset list where every preset that can connect has been checked with a live account (to prove the line is computed). */
export const presetsVerified: ModelPreset[] = presets.map(preset => (preset.availability === 'ready' || preset.availability === 'unverified'
  ? { ...preset, verification: 'built-in', verificationNote: null } : preset));

// ---------------------------------------------------------------------------------------------
// AI status before the vault
// ---------------------------------------------------------------------------------------------
type Tier = ModelStatusView['tiers']['fast'];
const templatesTier: Tier = { presetId: 'built-in-templates', model: null, usable: true, reason: 'No AI connected; using built-in templates', verification: 'built-in', verificationNote: null };
const tier = (presetId: ModelPresetId, model: string, note = LIVE_KEY): Tier => ({ presetId, model, usable: true, reason: 'Ready.', verification: 'not-live-verified', verificationNote: note });
const connection = (id: string, presetId: ModelPresetId, model: string, tiers: ('fast' | 'main')[], routeKind: ModelStatusView['connections'][number]['routeKind'], endpoint: string): ModelStatusView['connections'][number] => ({
  ...base, id, kind: 'venture-model-connection', presetId, routeKind, model, endpoint, tiers, consentDigest: presets.find(item => item.id === presetId)!.consentDigest,
  consentedAt: at, monthlyCapMicros: '5000000', status: 'connected', keyLoaded: true, usable: true, reason: 'Ready.', verification: 'not-live-verified',
  verificationNote: routeKind === 'claude-cli' || routeKind === 'codex-cli' ? LIVE_TASK : LIVE_KEY,
});
const status = (connections: ModelStatusView['connections'], tiers: ModelStatusView['tiers'], replay = false): AiStatusView => ({
  connections, tiers, spentThisMonthMicros: '0', spentThisMonthDisplay: 'USD 0.0000', estimate: false, sendPolicy: 'shape',
  replay: { active: replay, label: replay ? 'synthetic recording' : null }, scope: 'before-vault', idleUntil: connections.length ? '2026-10-18T10:30:00.000Z' : null,
});
const haikuConnection = connection('vmc_draft_haiku', 'anthropic-haiku-5-5', 'claude-haiku-5-5', ['fast'], 'anthropic-messages', 'https://api.anthropic.com/v1/messages');
const sonnetConnection = connection('vmc_draft_sonnet', 'anthropic-sonnet-5-5', 'claude-sonnet-5-5', ['main'], 'anthropic-messages', 'https://api.anthropic.com/v1/messages');
export const statusNone: AiStatusView = status([], { fast: templatesTier, main: templatesTier });
/** The recommended pair: one Anthropic key, Haiku for quick work, Sonnet for plans. */
export const statusPair: AiStatusView = status([haikuConnection, sonnetConnection], { fast: tier('anthropic-haiku-5-5', 'claude-haiku-5-5'), main: tier('anthropic-sonnet-5-5', 'claude-sonnet-5-5') });
export const statusPairReplay: AiStatusView = { ...statusPair, replay: { active: true, label: 'synthetic recording' } };
/** The first call of the pair connected and the second did not: quick work only. */
export const statusHalf: AiStatusView = status([haikuConnection], { fast: tier('anthropic-haiku-5-5', 'claude-haiku-5-5'), main: templatesTier });
export const statusLuna: AiStatusView = status([connection('vmc_draft_luna', 'openai-gpt-6-luna', 'gpt-6-luna', ['fast', 'main'], 'openai-responses', 'https://api.openai.com/v1/responses')],
  { fast: tier('openai-gpt-6-luna', 'gpt-6-luna'), main: tier('openai-gpt-6-luna', 'gpt-6-luna') });
/** Claude Code on this computer: one model, Sonnet 5.5, for both tiers. */
export const statusClaudeCode: AiStatusView = status([connection('vmc_draft_claude', 'claude-code-cli', 'claude-sonnet-5-5', ['fast', 'main'], 'claude-cli', 'cli://claude')],
  { fast: tier('claude-code-cli', 'claude-sonnet-5-5', LIVE_TASK), main: tier('claude-code-cli', 'claude-sonnet-5-5', LIVE_TASK) });

export const options = (aiStatus: AiStatusView = statusNone, list: ModelPreset[] = presets, gateOpen = false): AiOptionsView => aiOptionsView(list, aiStatus, gateOpen);

// ---------------------------------------------------------------------------------------------
// Decisions and plans: hand-written model output, checked by the engine, assembled by the engine
// ---------------------------------------------------------------------------------------------
export const WRITTEN: WrittenBy = { presetId: 'anthropic-sonnet-5-5', model: 'claude-sonnet-5-5', replay: false };
export const WRITTEN_REPLAY: WrittenBy = { ...WRITTEN, replay: true };
export const DOG_TEXT = 'Dog walking for busy nurses in Leeds.';
export const EXCEL_TEXT = "I'm good at Excel and I want to teach it.";
export const CAFE_TEXT = 'Small cafes lose track of their bills.';
export const LANDLORD_TEXT = "My landlord won't fix the heating.";
export const MAX_TEXT = 'I can help retired neighbours with council letters and forms in Dubai.';

const decideOutputs: Record<string, DecideModelOutput> = {
  dog: { kind: 'idea', family: 'other', reading: 'Dog walks for nurses who work long shifts in Leeds.', views: ['offers-first', 'pages', 'notes'] },
  excel: { kind: 'skill', family: 'consulting', reading: 'Teach Excel to people who want to work faster.', views: ['steps-first', 'questions', 'tools'] },
  cafe: { kind: 'problem', family: 'bookkeeping', reading: 'Help small cafes keep their bills in order.', views: ['audience-first', 'tools', 'pages'] },
  landlord: { kind: 'not-a-service', family: 'other', reading: 'A heating repair the landlord owes.', views: [] },
  // Every model string at its word cap: twelve words and close to ninety characters.
  maxSteps: { kind: 'skill', family: 'support', reading: 'Thoughtful help with council letters and official paperwork for retired Dubai householders', views: ['steps-first', 'notes', 'pages', 'tools'] },
  maxAudience: { kind: 'problem', family: 'support', reading: 'Thoughtful help with council letters and official paperwork for retired Dubai householders', views: ['audience-first', 'notes', 'pages'] },
  maxOffers: { kind: 'idea', family: 'support', reading: 'Thoughtful help with council letters and official paperwork for retired Dubai householders', views: ['offers-first', 'notes', 'pages'] },
};

const dogOutput: ComposeModelOutput = {
  name: 'Leeds Shift Walkers',
  oneLiner: 'Calm dog walks for nurses whose shifts run long, booked around the rota.',
  customer: 'Nurses and hospital staff in Leeds with dogs at home during long shifts.',
  offers: [
    { block: 'subscription', name: 'Weekly walks', description: 'Regular walks on the days you work, with a short note after each walk.', pricingModel: 'monthly' },
    { block: 'package', name: 'Walk pack', description: 'A set of walks to use when your rota changes.', pricingModel: 'project' },
  ],
  steps: [
    { block: 'book-time', title: 'Agree walk times' }, { block: 'in-person-work', title: 'Walk the dogs' },
    { block: 'draft-reply', title: 'Reply to messages' }, { block: 'get-paid', title: 'Send the invoice' },
  ],
  approvals: ['each-draft', 'prices-invoices'],
  pages: [
    { block: 'home', title: 'Home', purpose: 'What the service is and how to book a walk.' },
    { block: 'offers-prices', title: 'Walks and prices', purpose: 'Each walk offer with its price as Chausar gives it.' },
    { block: 'booking', title: 'Book a walk', purpose: 'Pick the days you need a walk.' },
    { block: 'faq', title: 'Questions', purpose: 'Short answers about keys, weather and dogs that pull.' },
  ],
  tools: [{ block: 'cal-com', reason: 'Clients pick walk times that fit their shifts.' }, { block: 'whatsapp', reason: 'Quick messages about keys and walk times.' }],
  questions: [],
  notes: ['insurance', 'safety'],
  views: { 'offers-first': { lead: ['offer_1', 'offer_2'] }, pages: { lead: ['page_1', 'page_3'] }, notes: { lead: ['insurance'] } },
};
const excelOutput: ComposeModelOutput = {
  name: 'Sheet Smart Lessons',
  oneLiner: 'Friendly Excel lessons for office staff who want to work faster.',
  customer: 'Office staff and small business owners who use spreadsheets every day.',
  offers: [
    { block: 'session', name: 'Excel lesson', description: 'A focused lesson on the formulas and tables you use at work.', pricingModel: 'hourly' },
    { block: 'course', name: 'Excel basics course', description: 'A short set of lessons from tables to charts.', pricingModel: 'project' },
  ],
  steps: [
    { block: 'book-time', title: 'Book a lesson' }, { block: 'meet-client', title: 'Teach the lesson' },
    { block: 'draft-reply', title: 'Answer follow up questions' }, { block: 'follow-up', title: 'Check on progress' },
  ],
  approvals: ['each-draft'],
  pages: [
    { block: 'home', title: 'Home', purpose: 'What you teach and who it is for.' },
    { block: 'offers-prices', title: 'Lessons and prices', purpose: 'Each lesson offer with its price as Chausar gives it.' },
    { block: 'how-it-works', title: 'How lessons work', purpose: 'From booking to the lesson to the follow up.' },
    { block: 'booking', title: 'Book a lesson', purpose: 'Pick a time for your lesson.' },
  ],
  tools: [{ block: 'google-calendar', reason: 'Lesson times on your calendar.' }, { block: 'google-drive', reason: 'Practice sheets shared with each learner.' }],
  questions: [{ block: 'customer', kind: 'choice', text: 'Who would you like to teach first?', choices: ['Office staff', 'College students', 'Shop owners'] }],
  notes: [],
  views: { 'steps-first': { lead: ['step_1', 'step_2', 'step_3'] }, questions: { lead: ['q_1'] }, tools: { lead: ['google-calendar'] } },
};
const cafeOutput: ComposeModelOutput = {
  name: 'Cafe Bill Keepers',
  oneLiner: 'Bill sorting for small cafes, with a short note you check before it goes out.',
  customer: 'Owners of small cafes who keep paper bills in a drawer.',
  offers: [
    { block: 'retainer', name: 'Monthly bill sorting', description: 'Bills sorted and matched to the bank each month.', pricingModel: 'monthly' },
    { block: 'setup', name: 'Catch up on bills', description: 'Past bills put in order before the monthly work starts.', pricingModel: 'project' },
  ],
  steps: [
    { block: 'collect-inputs', title: 'Collect the bills' }, { block: 'hands-on-work', title: 'Match bills to bank' },
    { block: 'draft-reply', title: 'Draft the monthly note' }, { block: 'send', title: 'Send the note' },
  ],
  approvals: ['each-draft', 'client-files'],
  pages: [
    { block: 'home', title: 'Home', purpose: 'What the service does for a cafe.' },
    { block: 'offers-prices', title: 'Services and prices', purpose: 'Each offer with its price as Chausar gives it.' },
    { block: 'start-request', title: 'Get started', purpose: 'A short form to ask for help with the bills.' },
    { block: 'about', title: 'About us', purpose: 'Who sorts the bills.' },
  ],
  tools: [{ block: 'whatsapp', reason: 'Cafes send photos of bills.' }, { block: 'zoho-books', reason: 'Books kept where the cafe can see them.' }],
  questions: [],
  notes: [],
  views: { 'audience-first': { who: 'Small cafe owners', pain: 'Bills get lost and the books fall behind.' }, tools: { lead: ['whatsapp'] }, pages: { lead: ['page_1', 'page_2'] } },
};
// The longest answers the engine accepts: four-word names of up to sixty characters, four-word offer names and step
// titles, a seven-word who and an eight-word pain.
const MAX_NAME = 'Northumberlands Neighbourhoods Companionships Collaboratives';
const maxCommon = {
  name: MAX_NAME,
  oneLiner: 'Patient help with letters, forms and calls for retired neighbours who would rather not face the paperwork alone.',
  customer: 'Retired neighbours and their families who find council letters and official forms hard to read and answer.',
  offers: [
    { block: 'session' as const, name: 'Letter reading home visit', description: 'A visit at home to read the letters with you and agree what to do next.', pricingModel: 'hourly' as const },
    { block: 'one-off-project' as const, name: 'Council form filling help', description: 'One council form filled in with you and checked before it goes out.', pricingModel: 'project' as const },
    { block: 'retainer' as const, name: 'Monthly paperwork check in', description: 'A regular check of new letters each month, with a short note of what needs doing.', pricingModel: 'monthly' as const },
  ],
  steps: [
    { block: 'book-time' as const, title: 'Agree a visit time' }, { block: 'in-person-work' as const, title: 'Visit and read letters' },
    { block: 'draft-reply' as const, title: 'Draft the reply letter' }, { block: 'send' as const, title: 'Post the reply letter' },
  ],
  approvals: ['each-draft' as const, 'client-files' as const],
  pages: [
    { block: 'home' as const, title: 'Home', purpose: 'What the help is and how to ask for a visit.' },
    { block: 'offers-prices' as const, title: 'Help and prices', purpose: 'Each offer with its price as Chausar gives it.' },
    { block: 'start-request' as const, title: 'Ask for a visit', purpose: 'A short form to ask for a visit.' },
    { block: 'about' as const, title: 'Who we are', purpose: 'Who visits and how they keep letters private.' },
  ],
  tools: [{ block: 'whatsapp' as const, reason: 'Families send photos of new letters.' }, { block: 'google-calendar' as const, reason: 'Visit times on one calendar.' }],
  questions: [],
  notes: ['personal-data' as const, 'regulated-advice' as const],
};
const maxStepsOutput: ComposeModelOutput = {
  ...maxCommon,
  views: { 'steps-first': { lead: ['step_1', 'step_2', 'step_3'] }, notes: { lead: ['personal-data'] }, pages: { lead: ['page_1', 'page_3'] }, tools: { lead: ['whatsapp'] } },
};
const maxAudienceOutput: ComposeModelOutput = {
  ...maxCommon,
  views: { 'audience-first': { who: 'Retired neighbours with piles of council letters', pain: 'Official forms arrive and nobody helps them answer' }, notes: { lead: ['personal-data'] }, pages: { lead: ['page_1', 'page_3'] } },
};
const maxOffersOutput: ComposeModelOutput = {
  ...maxCommon,
  views: { 'offers-first': { lead: ['offer_1', 'offer_2'] }, notes: { lead: ['personal-data'] }, pages: { lead: ['page_1', 'page_3'] } },
};

const composeOutputs: Record<string, ComposeModelOutput> = { dog: dogOutput, excel: excelOutput, cafe: cafeOutput, maxSteps: maxStepsOutput, maxAudience: maxAudienceOutput, maxOffers: maxOffersOutput };
const textOf: Record<string, string> = { dog: DOG_TEXT, excel: EXCEL_TEXT, cafe: CAFE_TEXT, landlord: LANDLORD_TEXT, maxSteps: MAX_TEXT, maxAudience: MAX_TEXT, maxOffers: MAX_TEXT };
const countryOf: Record<string, CountryProfile> = { dog: gb, excel: india, cafe: india, landlord: gb, maxSteps: uae, maxAudience: uae, maxOffers: uae };
export type PlanKey = 'dog' | 'excel' | 'cafe' | 'maxSteps' | 'maxAudience' | 'maxOffers';
export type DecisionKey = PlanKey | 'landlord';

/** A decision as the engine makes it, for the sentence and country the owner sent. */
export function decisionFor(key: DecisionKey, text = textOf[key], country = countryOf[key], writtenBy: WrittenBy = { presetId: 'anthropic-haiku-5-5', model: 'claude-haiku-5-5', replay: false }): ComposeDecision {
  const output = validateDecide(structuredClone(decideOutputs[key]), copiedTokens(text));
  return makeDecision({ composeId: `compose_demo_${key}`, text, country, output, callIds: [`vmcall_decide_${key}`], writtenBy, at });
}
/** The plan the engine assembles for a decision, from output that passes every compose check. */
export function planFor(key: PlanKey, decision: ComposeDecision = decisionFor(key), writtenBy: WrittenBy = WRITTEN): ComposedPlan {
  const output = validateCompose(structuredClone(composeOutputs[key]), { views: decision.views, allowed: copiedTokens(decision.text) });
  return assembleComposed(decision, output, decision.country, { writtenBy, composeCallIds: [`vmcall_compose_${key}`] });
}
/** Which fixture the fake engine answers for a sentence, from the test-only kind rules. */
export const KIND_FIXTURE: Readonly<Record<OpenBoxKind, DecisionKey>> = Object.freeze({ idea: 'dog', skill: 'excel', problem: 'cafe', 'not-a-service': 'landlord' });

export const dogDecision = decisionFor('dog');
export const dogPlan = planFor('dog', dogDecision);
export const excelPlan = planFor('excel');
export const cafePlan = planFor('cafe');
export const landlordDecision = decisionFor('landlord');
export const maxDecisions = { maxSteps: decisionFor('maxSteps'), maxAudience: decisionFor('maxAudience'), maxOffers: decisionFor('maxOffers') };
export const maxPlans = { maxSteps: planFor('maxSteps', maxDecisions.maxSteps), maxAudience: planFor('maxAudience', maxDecisions.maxAudience), maxOffers: planFor('maxOffers', maxDecisions.maxOffers) };
export const MAX = Object.freeze({ name: MAX_NAME, reading: decideOutputs.maxSteps.reading, who: 'Retired neighbours with piles of council letters', pain: 'Official forms arrive and nobody helps them answer' });

// ---------------------------------------------------------------------------------------------
// Errors: the refusal and the words of every code that passes straight through (section 6.6)
// ---------------------------------------------------------------------------------------------
export const COMPOSE_REFUSED = { code: 'COMPOSE_REFUSED', message: "The AI's answer failed Chausar's checks again. No plan was saved. Both tries are listed under What was sent." };
export const PASS_THROUGH: Readonly<Record<string, string>> = Object.freeze({
  MODEL_REFUSAL: 'The AI declined to answer this request. Nothing was retried.',
  MODEL_FAILED: 'Chausar could not reach the model provider. Nothing was retried.',
  MODEL_INCOMPLETE: 'The AI stopped before the end of its answer. Nothing was retried.',
  MODEL_TIMEOUT: 'The model did not answer in time. Chausar did not retry it.',
  BUDGET_REACHED: "This month's AI spending cap is reached. Raise the cap or wait for next month.",
  SEND_DISABLED: 'Your privacy setting sends nothing to models. Change it on Trust & access, or use built-in templates.',
  NO_MODEL_CONNECTED: 'Connect an AI, or use the built-in templates for this step.',
  MODEL_KEY_MISSING: 'Enter your key again. Chausar keeps keys in memory only.',
  CLI_UNAVAILABLE: 'Claude Code did not answer on this computer. Check that it is installed and signed in.',
  RATE_LIMITED: 'The AI company asked Chausar to slow down. Try again in a minute.',
});

/** "What was sent" before the vault: the decide call and two refused compose calls. */
const call = (id: string, purpose: 'decide' | 'compose', tier: 'fast' | 'main', presetId: ModelPresetId, model: string, done: boolean): ModelCallRecord => ({
  ...base, id, kind: 'venture-model-call', purpose, tier, presetId, connectionId: presetId === 'anthropic-haiku-5-5' ? 'vmc_draft_haiku' : 'vmc_draft_sonnet', routeKind: 'anthropic-messages',
  model, consent: 'standing', endpoint: 'https://api.anthropic.com/v1/messages', payloadText: `{"marker":"chausar-${purpose}-v1","text":"${DOG_TEXT}"}`, payloadDigest: hex('7'),
  payloadTruncated: false, containsClientData: false, status: done ? 'completed' : 'failed', approvedDigest: null, approvedAt: null, approvedBy: null,
  estimatedMaxCostMicros: '9000', priceConfirmed: true, usage: done ? { inputTokens: 900, outputTokens: 120 } : null, costMicros: done ? '1500' : null,
  outputDigest: done ? hex('8') : null, error: done ? null : { code: 'MODEL_OUTPUT_REJECTED', message: 'The offer description wrote a number or a price in words. Numbers come from Chausar\'s calculator, not the AI.' }, replay: false,
});
export const calls: ModelCallRecord[] = [
  call('vmcall_compose_2', 'compose', 'main', 'anthropic-sonnet-5-5', 'claude-sonnet-5-5', false),
  call('vmcall_compose_1', 'compose', 'main', 'anthropic-sonnet-5-5', 'claude-sonnet-5-5', false),
  call('vmcall_decide_1', 'decide', 'fast', 'anthropic-haiku-5-5', 'claude-haiku-5-5', true),
];

// ---------------------------------------------------------------------------------------------
// After Keep it safe: the business and its kept, composed plan in the vault
// ---------------------------------------------------------------------------------------------
export const composedVentureView: VentureView = {
  ...F.ventureView,
  venture: { ...F.ventureView.venture, idea: DOG_TEXT, workingName: dogPlan.name.value, country: gb, serviceType: 'other', status: 'blueprint', launchStage: 'rehearsal', acceptedBlueprintId: null },
};
/** The receipt for offer_1 at the owner's typed GBP 18.00, not registered for VAT, so the total is the price. */
export const composedReceipt: PriceReceiptRecord = {
  ...F.offerReceipt, id: 'vpr_walks', currency: 'GBP',
  inputs: { ...F.offerReceipt.inputs, unitPriceMinor: '1800', taxMode: 'vat', taxRateBps: '0', taxRateBy: 'not-registered', blueprintDigest: hex('9') },
  steps: [
    { op: 'multiply', inputs: ['1800', '1'], resultMinor: '1800', rule: 'unit price times quantity' },
    { op: 'discount', inputs: ['1800', '0'], resultMinor: '0', rule: 'discount in basis points, rounded half up to the minor unit' },
    { op: 'tax', inputs: ['1800', '0'], resultMinor: '0', rule: 'tax in basis points, rounded half up to the minor unit' },
    { op: 'add', inputs: ['1800', '0'], resultMinor: '1800', rule: 'taxable amount plus tax' },
  ],
  figures: [
    { key: 'unit', label: 'Unit price', minor: '1800', display: 'GBP 18.00', currency: 'GBP' },
    { key: 'subtotal', label: 'Subtotal', minor: '1800', display: 'GBP 18.00', currency: 'GBP' },
    { key: 'discount', label: 'Discount', minor: '0', display: 'GBP 0.00', currency: 'GBP' },
    { key: 'taxable', label: 'Taxable amount', minor: '1800', display: 'GBP 18.00', currency: 'GBP' },
    { key: 'tax', label: 'VAT, not registered', minor: '0', display: 'GBP 0.00', currency: 'GBP' },
    { key: 'total', label: 'Total', minor: '1800', display: 'GBP 18.00', currency: 'GBP' },
  ],
  totalMinor: '1800', allowedNumbers: ['1800', '18.00', '0', '1'], explanation: '1 x month at GBP 18.00, no VAT = GBP 18.00.', digest: hex('a'),
};
export const composedBlueprintView: BlueprintView = {
  blueprint: {
    ...F.blueprintDraftView.blueprint, source: 'model', digest: hex('9'), serviceType: 'other', name: dogPlan.name, oneLiner: dogPlan.oneLiner, customer: dogPlan.customer,
    offers: dogPlan.offers.map(({ allowedPricing: _allowed, priceDisplay: _display, ...offer }, index) => (index === 0
      ? { ...offer, pricing: { ...offer.pricing, unitPriceMinor: '1800', unitPriceLabel: 'told-by-you' as const } } : offer)),
    deliverySteps: dogPlan.steps, approvals: dogPlan.approvals.map(({ block: _block, ...line }) => line),
    backOffice: { ...dogPlan.backOffice }, starterConnectorIds: ['lovable', 'github', gb.paymentRails[0], 'cal-com', 'whatsapp', 'chausar-books'],
    composition: { id: 'composition_demo', composeId: dogPlan.composeId, kind: 'idea', views: dogPlan.views },
    approvalBlocks: dogPlan.approvals.map(item => item.block), pages: dogPlan.pages, tools: dogPlan.tools.map(item => ({ block: item.block, reason: item.reason })), notes: dogPlan.notes,
  },
  offerReceipts: { offer_1: composedReceipt, offer_2: null },
};
export const composedBlueprintAccepted: BlueprintView = { ...composedBlueprintView, blueprint: { ...composedBlueprintView.blueprint, status: 'accepted' } };
