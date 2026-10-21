// Chausar venture launcher, core: the composer (onboarding v2, spec section 6).
// Two model calls: decide (cheap tier) reads the owner's sentence and picks views from the fixed registry; compose
// (main tier) picks blocks from the checked library and writes short words for them. Code checks every id, count,
// word and word cap, then assembles the plan. The model never writes markup, a number (in digits or in words), a
// price, or who does a step. One repair call each, then a clear refusal: never a made-up or template plan.
import { check, ChausarError } from '../../contracts.ts';
import { formatMinor } from '../../currency.ts';
import { copiedTokens, digest, exactPayload } from '../records.ts';
import { SERVICE_TYPE_LABELS, SERVICE_TYPES } from '../contracts.ts';
import type {
  BackOffice, CountryProfile, InterviewAnswer, Json, ModelOutcome, ModelTask, PricingModel, ServiceType,
} from '../contracts.ts';
import {
  APPROVAL_BLOCK_IDS, BLOCK_LIMITS, COMPOSE_REFUSED_WORDS, KIND_LABELS, NOT_A_SERVICE_WORDS, NOTE_BLOCK_IDS, OFFER_BLOCK_IDS,
  OFFER_REFS, ONBOARDING_MARKERS, ONBOARDING_MAX_OUTPUT, ONBOARDING_SCHEMAS, OPEN_BOX_KINDS, PAGE_BLOCK_IDS, PAGE_REFS,
  QUESTION_BLOCK_IDS, QUESTION_REFS, STEP_BLOCK_IDS, STEP_REFS, TOOL_BLOCK_IDS, VIEW_PICKS, VIEW_REGISTRY, WORD_CAPS, WORD_LIMITS,
} from '../onboarding-contracts.ts';
import type {
  ApprovalBlockId, ComposeDecision, ComposedOffer, ComposedPlan, ComposedQuestion, ComposeModelOutput, ComposePatch, DecideModelOutput,
  DraftCompose, NoteBlockId, OpenBoxKind, PlanKind, ToolBlockId, ViewId, ViewSelection, ViewSlotOutput, WrittenBy,
} from '../onboarding-contracts.ts';
import { connectorCard } from '../build/connectors.ts';
import { catalogueEntry } from '../build/catalogue.ts';
import {
  APPROVAL_BLOCKS, NOTE_BLOCKS, OFFER_BLOCKS, PAGE_BLOCKS, QUESTION_BLOCKS, STEP_BLOCKS, TOOL_BLOCKS, allowedPricingWords, isApprovalBlock,
  isNoteBlock, isOfferBlock, isPageBlock, isQuestionBlock, isStepBlock, isToolBlock,
} from './blocks.ts';
import { applyTaxPatch, offerPricing, previewBackOffice } from './blueprint.ts';
import { countryProfile } from './countries.ts';
import { engineQuestions, isPricingModel, parseAnswer, storedQuestion, taxRateQuestion } from './interview.ts';
import { isViewId, viewSpec } from './views.ts';
import { labelled, modelLine, noMarkup, ownerPrice, styledWords, wordCap } from './words.ts';
import { withTaxInvoiceFields } from './tax-fields.ts';

const REJECTED = 'MODEL_OUTPUT_REJECTED';
const reject = (message: string): never => { throw new ChausarError(REJECTED, message); };
const PRICING_MODELS: readonly PricingModel[] = ['monthly', 'project', 'hourly'];

type WordKey = keyof typeof WORD_LIMITS;
const FIELD_WORDS: Readonly<Record<WordKey, string>> = Object.freeze({
  reading: 'reading', name: 'business name', oneLiner: 'one line summary', customer: 'customer line', offerName: 'offer name',
  offerDescription: 'offer description', stepTitle: 'step title', pageTitle: 'page title', pagePurpose: 'page purpose',
  toolReason: 'tool reason', questionText: 'question', choice: 'answer choice', who: 'who line', pain: 'problem line',
});

/** One model string through every check of section 4: styled words (no numbers in digits or words), the word cap, no markup. */
export function composeWords(value: unknown, key: WordKey, allowed: readonly string[]): string {
  const field = FIELD_WORDS[key];
  // Composer words are refused for a long dash rather than tidied, so the repair path tells the model.
  check(typeof value !== 'string' || !value.includes('\u2014'), REJECTED, `The ${field} used a long dash. Use a comma or a full stop.`);
  const words = styledWords(value, field, WORD_LIMITS[key], allowed);
  wordCap(words, field, WORD_CAPS[key]);
  return noMarkup(words, field);
}

// ---------------------------------------------------------------------------
// Decide
// ---------------------------------------------------------------------------

export const DECIDE_INSTRUCTIONS = [
  'chausar-decide-v1.',
  'Read one sentence a person wrote about what they want to do.',
  'Say whether it is an idea for a service, a skill they have, a problem other people have that a service could fix, or not something a person could sell to other people as a service (not-a-service).',
  'Pick the closest of the listed service families.',
  'Restate what the person wants in one plain sentence of twelve words or fewer.',
  'Pick two to four of the listed views: exactly one lead view, first, then support views in the order they should be shown. Read each view pick line to choose. For not-a-service, pick no views.',
  'Never write numbers, in digits or in words (no "two", "ten", "half", "twice"). Never write money words such as pounds, rupees, free or discount, and never write prices or amounts.',
  'Plain words, no dashes.',
].join(' ');

export const DECIDE_SCHEMA: Json = {
  type: 'object', additionalProperties: false, required: ['kind', 'family', 'reading', 'views'],
  properties: {
    kind: { type: 'string', enum: [...OPEN_BOX_KINDS] },
    family: { type: 'string', enum: [...SERVICE_TYPES] },
    reading: { type: 'string', description: 'One plain sentence, twelve words or fewer, saying what the person wants to do. No numbers in digits or words, no prices or amounts.' },
    views: {
      type: 'array', items: { type: 'string', enum: VIEW_REGISTRY.map(view => view.id) },
      description: 'Two to four view ids. Exactly one lead view, first. None when kind is not-a-service.',
    },
  },
};

const REPAIR_LINE = (problem: string) => `Your last answer was refused: ${problem} Answer again, following every rule.`;

export function decideInput(text: string, country: CountryProfile, problem: string | null = null): Json {
  const input: { [key: string]: Json } = {
    marker: problem === null ? ONBOARDING_MARKERS.decide : ONBOARDING_MARKERS.redecide,
    text, country: country.name, kinds: [...OPEN_BOX_KINDS],
    views: VIEW_REGISTRY.map(view => ({ id: view.id, role: view.role, pick: view.pick })),
  };
  if (problem !== null) input.problem = problem;
  return input;
}

/** Local authority over decide. Refuses with MODEL_OUTPUT_REJECTED, naming the field and the rule. */
export function validateDecide(raw: unknown, allowed: readonly string[]): DecideModelOutput {
  const keys = ['kind', 'family', 'reading', 'views'];
  const body = exactPayload(raw, keys, keys, REJECTED);
  check(typeof body.kind === 'string' && (OPEN_BOX_KINDS as readonly string[]).includes(body.kind), REJECTED, 'The kind was not one of idea, skill, problem or not-a-service.');
  const kind = body.kind as OpenBoxKind;
  check(Array.isArray(body.views), REJECTED, 'The views were not a list.');
  const views = body.views as unknown[];
  if (kind === 'not-a-service') {
    check(views.length === 0, REJECTED, 'A sentence that is not a service gets no views.');
    return Object.freeze({ kind, family: 'other', reading: '', views: [] });
  }
  check(typeof body.family === 'string' && (SERVICE_TYPES as readonly string[]).includes(body.family), REJECTED, 'The family was not one of the listed service families.');
  const reading = composeWords(body.reading, 'reading', allowed);
  check(views.length >= VIEW_PICKS.min && views.length <= VIEW_PICKS.max, REJECTED, 'Pick two to four views.');
  check(views.every(isViewId), REJECTED, 'A view was not one of the listed views.');
  const ids = views as ViewId[];
  check(new Set(ids).size === ids.length, REJECTED, 'Each view may be picked once.');
  check(ids.filter(id => viewSpec(id).role === 'lead').length === 1, REJECTED, 'Pick exactly one lead view.');
  check(viewSpec(ids[0]).role === 'lead', REJECTED, 'The lead view must come first.');
  return Object.freeze({ kind, family: body.family as ServiceType, reading, views: Object.freeze([...ids]) as ViewId[] });
}

export function decideTask(text: string, country: CountryProfile, problem: string | null = null): ModelTask<DecideModelOutput> {
  const allowed = copiedTokens(text);
  return {
    purpose: 'decide',
    instructions: problem === null ? DECIDE_INSTRUCTIONS : `${DECIDE_INSTRUCTIONS.replace(ONBOARDING_MARKERS.decide, ONBOARDING_MARKERS.redecide)} ${REPAIR_LINE(problem)}`,
    input: decideInput(text, country, problem),
    schemaName: ONBOARDING_SCHEMAS.decide,
    schema: structuredClone(DECIDE_SCHEMA),
    validate: raw => validateDecide(raw, allowed),
    containsClientData: false,
    maxOutputTokens: ONBOARDING_MAX_OUTPUT.decide,
  };
}

// ---------------------------------------------------------------------------
// Compose: schema, input, validation
// ---------------------------------------------------------------------------

/** The refs or ids a lead-refs slot may name. */
function slotEnum(id: ViewId): readonly string[] {
  switch (viewSpec(id).draws) {
    case 'offers': return OFFER_REFS;
    case 'steps': return STEP_REFS;
    case 'pages': return PAGE_REFS;
    case 'tools': return TOOL_BLOCK_IDS;
    case 'questions': return QUESTION_REFS;
    case 'notes': return NOTE_BLOCK_IDS;
    default: return [];
  }
}

function slotSchema(id: ViewId): Json {
  if (viewSpec(id).slot === 'audience') {
    return {
      type: 'object', additionalProperties: false, required: ['who', 'pain'],
      properties: {
        who: { type: 'string', description: 'Who it helps, seven words or fewer. No numbers.' },
        pain: { type: 'string', description: 'What goes wrong for them, eight words or fewer. No numbers.' },
      },
    };
  }
  return {
    type: 'object', additionalProperties: false, required: ['lead'],
    properties: { lead: { type: 'array', items: { type: 'string', enum: [...slotEnum(id)] }, description: 'The items this view shows first.' } },
  };
}

/** The compose schema for the decided views: only those views under views.properties, all required. No number type anywhere. */
export function composeSchema(views: readonly ViewId[]): Json {
  const strings = (description: string): Json => ({ type: 'string', description });
  return {
    type: 'object', additionalProperties: false,
    required: ['name', 'oneLiner', 'customer', 'offers', 'steps', 'approvals', 'pages', 'tools', 'questions', 'notes', 'views'],
    properties: {
      name: strings('Business name, four words or fewer. No numbers.'),
      oneLiner: strings('One sentence. No numbers or prices.'),
      customer: strings('Who it is for. No numbers.'),
      offers: {
        type: 'array', description: 'One to three offers.', items: {
          type: 'object', additionalProperties: false, required: ['block', 'name', 'description', 'pricingModel'],
          properties: {
            block: { type: 'string', enum: [...OFFER_BLOCK_IDS] },
            name: strings('Offer name, four words or fewer. No numbers or prices.'),
            description: strings('One sentence. No numbers or prices.'),
            pricingModel: { type: 'string', enum: [...PRICING_MODELS] },
          },
        },
      },
      steps: {
        type: 'array', description: 'Three to six steps, exactly one draft-reply.', items: {
          type: 'object', additionalProperties: false, required: ['block', 'title'],
          properties: { block: { type: 'string', enum: [...STEP_BLOCK_IDS] }, title: strings('Step title, four words or fewer. No numbers.') },
        },
      },
      approvals: { type: 'array', description: 'One to four, including each-draft.', items: { type: 'string', enum: [...APPROVAL_BLOCK_IDS] } },
      pages: {
        type: 'array', description: 'Four to six pages, including home and offers-prices.', items: {
          type: 'object', additionalProperties: false, required: ['block', 'title', 'purpose'],
          properties: { block: { type: 'string', enum: [...PAGE_BLOCK_IDS] }, title: strings('Page title, four words or fewer.'), purpose: strings('One sentence. No numbers.') },
        },
      },
      tools: {
        type: 'array', description: 'Two to six tools.', items: {
          type: 'object', additionalProperties: false, required: ['block', 'reason'],
          properties: { block: { type: 'string', enum: [...TOOL_BLOCK_IDS] }, reason: strings('Why this tool, one short sentence. No numbers.') },
        },
      },
      questions: {
        type: 'array', description: 'One or two when the questions view is listed, else none.', items: {
          type: 'object', additionalProperties: false, required: ['block', 'kind', 'text', 'choices'],
          properties: {
            block: { type: 'string', enum: [...QUESTION_BLOCK_IDS] },
            kind: { type: 'string', enum: ['choice', 'text'] },
            text: strings('One short question. Never about prices. No numbers.'),
            choices: { type: 'array', items: strings('A short answer. No numbers.') },
          },
        },
      },
      notes: { type: 'array', description: 'One to three when the notes view is listed, else none.', items: { type: 'string', enum: [...NOTE_BLOCK_IDS] } },
      views: {
        type: 'object', additionalProperties: false, required: [...views],
        properties: Object.fromEntries(views.map(id => [id, slotSchema(id)])),
      },
    },
  };
}

export const COMPOSE_INSTRUCTIONS = [
  'chausar-compose-v1.',
  'Build a plan for a small service business only from the listed blocks, with ids exactly as listed.',
  'The first offer is offer_1, the second offer_2, and so on; the same for steps (step_1), pages (page_1) and questions (q_1).',
  'Fill the slots only for the listed views.',
  'Keep within the word limits: a business name of four words or fewer, offer names of four words or fewer, step titles of four words or fewer.',
  "Chausar decides who does each step; an agent in this build only drafts replies from the client's message.",
  'Never write numbers in digits or in words, money words, prices, percentages, amounts, links or markup.',
  'Plain words, no dashes, no hype.',
].join(' ');

export const COMPOSE_RULES: readonly string[] = Object.freeze([
  'Offers: one to three, each from a listed offer block, priced only in a way that block allows. Offer names differ from each other.',
  'Steps: three to six, each block once, exactly one draft-reply. Send, deliver-files, follow-up and get-paid come only after draft-reply.',
  'Approvals: one to four, each once, always including each-draft.',
  'Pages: four to six, each once, always including home and offers-prices.',
  'Tools: two to six, each once.',
  'Questions: one or two when the questions view is listed, else none. A choice question has two to four choices; a text question has none. Never ask about prices.',
  'Notes: one to three when the notes view is listed, else none.',
  'Word limits: business name four words, one line summary and customer line twenty four words, offer name four words, offer description thirty words, step title four words, page title four words, page purpose twenty four words, tool reason eighteen words, question twenty words, each choice five words, who seven words, problem eight words.',
]);

export function composeInput(decision: ComposeDecision, problem: string | null = null): Json {
  const input: { [key: string]: Json } = {
    marker: problem === null ? ONBOARDING_MARKERS.compose : ONBOARDING_MARKERS.recompose,
    text: decision.text,
    country: decision.country.name,
    kind: decision.kind,
    family: decision.family?.value ?? 'other',
    reading: decision.reading?.value ?? '',
    views: decision.views.map(id => {
      const spec = viewSpec(id);
      return { id, slot: spec.slot === 'audience' ? 'audience' : 'lead-refs', lead: [...spec.lead], pick: spec.pick };
    }),
    blocks: {
      offers: OFFER_BLOCK_IDS.map(id => ({ id, means: OFFER_BLOCKS[id].means, allowed: [...OFFER_BLOCKS[id].allowed] })),
      steps: STEP_BLOCK_IDS.map(id => ({ id, means: STEP_BLOCKS[id].means, doneBy: STEP_BLOCKS[id].doneBy })),
      approvals: APPROVAL_BLOCK_IDS.map(id => ({ id, words: APPROVAL_BLOCKS[id].words })),
      pages: PAGE_BLOCK_IDS.map(id => ({ id, means: PAGE_BLOCKS[id].means })),
      tools: TOOL_BLOCK_IDS.map(id => ({ id, name: TOOL_BLOCKS[id].name, category: TOOL_BLOCKS[id].category })),
      questions: QUESTION_BLOCK_IDS.map(id => ({ id, means: QUESTION_BLOCKS[id].means })),
      notes: NOTE_BLOCK_IDS.map(id => ({ id, words: NOTE_BLOCKS[id].words })),
    },
    rules: [...COMPOSE_RULES],
  };
  if (problem !== null) input.problem = problem;
  return input;
}

// The spec's list, and the other forms of the same words: Chausar asks about money itself, never the AI.
const MONEY_QUESTION = /\b(price|prices|pricing|priced|charge|charges|charging|cost|costs|costing|fee|fees|rate|rates|pay|paid|paying|payment|payments|budget|budgets|spend|spending|money|afford)\b/i;
type ComposeContext = { views: readonly ViewId[]; allowed: readonly string[] };

function list(value: unknown, label: string, [min, max]: readonly [number, number]): unknown[] {
  check(Array.isArray(value), REJECTED, `The ${label} were not a list.`);
  const items = value as unknown[];
  check(items.length >= min && items.length <= max, REJECTED, `The plan needs ${COUNT_WORDS[min]} to ${COUNT_WORDS[max]} ${label}.`);
  return items;
}
const COUNT_WORDS: Readonly<Record<number, string>> = Object.freeze({ 0: 'no', 1: 'one', 2: 'two', 3: 'three', 4: 'four', 6: 'six' });
function unique(values: readonly string[], message: string) {
  check(new Set(values).size === values.length, REJECTED, message);
}

/**
 * Local authority over compose, in the order of spec 6.4: exact keys everywhere, the top-level words, each block
 * list (offers, steps, approvals, pages, tools, questions, notes), then the view slots and the cross rules.
 */
export function validateCompose(raw: unknown, ctx: ComposeContext): ComposeModelOutput {
  const { allowed } = ctx;
  const decided = [...ctx.views];
  const keys = ['name', 'oneLiner', 'customer', 'offers', 'steps', 'approvals', 'pages', 'tools', 'questions', 'notes', 'views'];
  const body = exactPayload(raw, keys, keys, REJECTED);
  const name = composeWords(body.name, 'name', allowed);
  const oneLiner = composeWords(body.oneLiner, 'oneLiner', allowed);
  const customer = composeWords(body.customer, 'customer', allowed);

  const offers = list(body.offers, 'offers', BLOCK_LIMITS.offers).map(item => {
    const offer = exactPayload(item, ['block', 'name', 'description', 'pricingModel'], ['block', 'name', 'description', 'pricingModel'], REJECTED);
    if (!isOfferBlock(offer.block)) reject('An offer used a block Chausar does not have.');
    const block = offer.block as ComposeModelOutput['offers'][number]['block'];
    const offerName = composeWords(offer.name, 'offerName', allowed);
    const description = composeWords(offer.description, 'offerDescription', allowed);
    check(isPricingModel(offer.pricingModel), REJECTED, 'An offer was not priced per month, per project or per hour.');
    const model = offer.pricingModel as PricingModel;
    check(OFFER_BLOCKS[block].allowed.includes(model), REJECTED, `The ${block} offer can only be priced ${allowedPricingWords(OFFER_BLOCKS[block].allowed)}.`);
    return { block, name: offerName, description, pricingModel: model };
  });
  unique(offers.map(offer => offer.name.toLowerCase()), 'Two offers had the same name.');

  const steps = list(body.steps, 'steps', BLOCK_LIMITS.steps).map(item => {
    const step = exactPayload(item, ['block', 'title'], ['block', 'title'], REJECTED);
    if (!isStepBlock(step.block)) reject('A step used a block Chausar does not have.');
    return { block: step.block as ComposeModelOutput['steps'][number]['block'], title: composeWords(step.title, 'stepTitle', allowed) };
  });
  const stepBlocks = steps.map(step => step.block);
  unique(stepBlocks, 'A step block was used twice.');
  check(stepBlocks.filter(block => block === 'draft-reply').length === 1, REJECTED, 'The steps need exactly one draft-reply step.');
  const draftAt = stepBlocks.indexOf('draft-reply');
  for (const later of ['send', 'deliver-files', 'follow-up', 'get-paid'] as const) {
    const at = stepBlocks.indexOf(later);
    check(at < 0 || at > draftAt, REJECTED, `The ${later} step must come after the draft-reply step.`);
  }

  const approvals = list(body.approvals, 'approvals', BLOCK_LIMITS.approvals).map(item => {
    if (!isApprovalBlock(item)) reject('An approval was not one of the listed approvals.');
    return item as ApprovalBlockId;
  });
  unique(approvals, 'An approval was listed twice.');
  check(approvals.includes('each-draft'), REJECTED, 'The approvals must include each-draft.');

  const pages = list(body.pages, 'pages', BLOCK_LIMITS.pages).map(item => {
    const page = exactPayload(item, ['block', 'title', 'purpose'], ['block', 'title', 'purpose'], REJECTED);
    if (!isPageBlock(page.block)) reject('A page used a block Chausar does not have.');
    return { block: page.block as ComposeModelOutput['pages'][number]['block'], title: composeWords(page.title, 'pageTitle', allowed), purpose: composeWords(page.purpose, 'pagePurpose', allowed) };
  });
  const pageBlocks = pages.map(page => page.block);
  unique(pageBlocks, 'A page block was used twice.');
  check(pageBlocks.includes('home') && pageBlocks.includes('offers-prices'), REJECTED, 'The pages must include home and offers-prices.');

  const tools = list(body.tools, 'tools', BLOCK_LIMITS.tools).map(item => {
    const tool = exactPayload(item, ['block', 'reason'], ['block', 'reason'], REJECTED);
    if (!isToolBlock(tool.block)) reject('A tool was not one of the listed tools.');
    const entry = catalogueEntry(tool.block as string);
    check(entry, REJECTED, 'A tool was not one of the listed tools.');
    check(entry.category !== 'payments', REJECTED, 'Payment tools come from the country, not the AI.');
    return { block: tool.block as ToolBlockId, reason: composeWords(tool.reason, 'toolReason', allowed) };
  });
  unique(tools.map(tool => tool.block), 'A tool was listed twice.');

  const askQuestions = decided.includes('questions');
  const questions = list(body.questions, 'questions', askQuestions ? [1, BLOCK_LIMITS.questions[1]] : [0, 0]).map(item => {
    const q = exactPayload(item, ['block', 'kind', 'text', 'choices'], ['block', 'kind', 'text', 'choices'], REJECTED);
    if (!isQuestionBlock(q.block)) reject('A question used a block Chausar does not have.');
    check(q.kind === 'choice' || q.kind === 'text', REJECTED, 'A question was not a choice or a typed answer.');
    const text = composeWords(q.text, 'questionText', allowed);
    check(!MONEY_QUESTION.test(text), REJECTED, 'A question asked about money. Chausar asks about prices itself.');
    check(Array.isArray(q.choices), REJECTED, 'A question had answer choices Chausar cannot show.');
    const given = q.choices as unknown[];
    let choices: string[] = [];
    if (q.kind === 'choice') {
      check(given.length >= 2 && given.length <= 4, REJECTED, 'A choice question needs two to four answers.');
      choices = given.map(choice => composeWords(choice, 'choice', allowed));
      check(!choices.some(choice => MONEY_QUESTION.test(choice)), REJECTED, 'An answer choice was about money. Chausar asks about prices itself.');
      unique(choices.map(choice => choice.toLowerCase()), 'A question offered the same answer twice.');
    } else {
      check(given.length === 0, REJECTED, 'A question with a typed answer has no choices.');
    }
    return { block: q.block as ComposeModelOutput['questions'][number]['block'], kind: q.kind as 'choice' | 'text', text, choices };
  });
  unique(questions.map(q => q.block), 'A question block was used twice.');

  const noteView = decided.includes('notes');
  const notes = list(body.notes, 'notes', noteView ? [1, BLOCK_LIMITS.notes[1]] : [0, 0]).map(item => {
    if (!isNoteBlock(item)) reject('A note was not one of the listed notes.');
    return item as NoteBlockId;
  });
  unique(notes, 'A note was listed twice.');

  const slots = exactPayload(body.views, decided, decided, REJECTED);
  check(Object.keys(slots).length === decided.length, REJECTED, 'The views were not the ones decided.');
  const views: Record<string, ViewSlotOutput> = {};
  for (const id of decided) {
    const spec = viewSpec(id);
    if (spec.slot === 'audience') {
      const slot = exactPayload(slots[id], ['who', 'pain'], ['who', 'pain'], REJECTED);
      views[id] = { who: composeWords(slot.who, 'who', allowed), pain: composeWords(slot.pain, 'pain', allowed) };
      continue;
    }
    const slot = exactPayload(slots[id], ['lead'], ['lead'], REJECTED);
    check(Array.isArray(slot.lead) && slot.lead.every(ref => typeof ref === 'string'), REJECTED, `The ${id} view did not list its items.`);
    const lead = slot.lead as string[];
    unique(lead, `The ${id} view named an item twice.`);
    const present: readonly string[] = spec.draws === 'offers' ? OFFER_REFS.slice(0, offers.length)
      : spec.draws === 'steps' ? STEP_REFS.slice(0, steps.length)
        : spec.draws === 'pages' ? PAGE_REFS.slice(0, pages.length)
          : spec.draws === 'questions' ? QUESTION_REFS.slice(0, questions.length)
            : spec.draws === 'tools' ? tools.map(tool => tool.block)
              : notes;
    check(lead.every(ref => present.includes(ref)), REJECTED, `The ${id} view named an item that is not in the plan.`);
    check(lead.length >= spec.lead[0] && lead.length <= spec.lead[1], REJECTED, `The ${id} view named too few or too many items.`);
    views[id] = { lead: [...lead] };
  }

  return deepFreeze({ name, oneLiner, customer, offers, steps, approvals, pages, tools, questions, notes, views });
}

export function composeTask(decision: ComposeDecision, problem: string | null = null): ModelTask<ComposeModelOutput> {
  const allowed = copiedTokens(decision.text);
  return {
    purpose: 'compose',
    instructions: problem === null ? COMPOSE_INSTRUCTIONS : `${COMPOSE_INSTRUCTIONS.replace(ONBOARDING_MARKERS.compose, ONBOARDING_MARKERS.recompose)} ${REPAIR_LINE(problem)}`,
    input: composeInput(decision, problem),
    schemaName: ONBOARDING_SCHEMAS.compose,
    schema: composeSchema(decision.views),
    validate: raw => validateCompose(raw, { views: decision.views, allowed }),
    containsClientData: false,
    maxOutputTokens: ONBOARDING_MAX_OUTPUT.compose,
  };
}

/**
 * One repair, then a clear refusal (spec 6.6). Only MODEL_OUTPUT_REJECTED triggers the repair, and only a second
 * MODEL_OUTPUT_REJECTED becomes COMPOSE_REFUSED; every other error passes through with the port's own words. The
 * rejected text is never sent back: only the engine's description of the problem.
 */
export async function withRepair<T>(run: (problem: string | null) => Promise<ModelOutcome<T>>): Promise<ModelOutcome<T>> {
  let problem: string;
  try { return await run(null); } catch (error: any) {
    if (error?.code !== REJECTED) throw error;
    problem = typeof error.message === 'string' && error.message ? error.message : "The answer did not pass Chausar's checks.";
  }
  try { return await run(problem); } catch (error: any) {
    if (error?.code === REJECTED) throw new ChausarError('COMPOSE_REFUSED', COMPOSE_REFUSED_WORDS);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Decisions and assembly (pure)
// ---------------------------------------------------------------------------

export function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export function makeDecision(input: {
  composeId: string; text: string; country: CountryProfile; output: DecideModelOutput; callIds: string[]; writtenBy: WrittenBy; at: string;
}): ComposeDecision {
  const service = input.output.kind !== 'not-a-service';
  return {
    composeId: input.composeId, text: input.text, country: structuredClone(input.country), kind: input.output.kind,
    family: service ? labelled(input.output.family, 'assumption', 'model') : null,
    reading: service ? modelLine(input.output.reading, copiedTokens(input.text)) : null,
    views: service ? [...input.output.views] : [],
    refusal: service ? null : NOT_A_SERVICE_WORDS,
    callIds: [...input.callIds], writtenBy: { ...input.writtenBy }, at: input.at,
  };
}

/** The plan's digest: everything except composeId and digest. Every owner edit makes a new one. */
export function planDigest(plan: Omit<ComposedPlan, 'digest'> | ComposedPlan): string {
  const { composeId: _id, digest: _digest, ...rest } = plan as ComposedPlan;
  return digest(rest);
}

/** Builds the plan from a validated decision and output. Pure: no clock, no store, no model. */
export function assembleComposed(decision: ComposeDecision, output: ComposeModelOutput, country: CountryProfile, meta: { writtenBy: WrittenBy; composeCallIds: string[] }): ComposedPlan {
  check(decision.kind !== 'not-a-service' && decision.family && decision.reading, 'COMPOSE_NOT_A_SERVICE', NOT_A_SERVICE_WORDS);
  const allowed = copiedTokens(decision.text);
  const say = (value: string) => modelLine(value, allowed);
  const kind = decision.kind as PlanKind;
  const views: ViewSelection[] = decision.views.map(id => {
    const slot = output.views[id];
    if (id === 'audience-first') {
      const audience = slot as { who: string; pain: string };
      return { id, who: say(audience.who), pain: say(audience.pain) };
    }
    return { id, lead: [...(slot as { lead: string[] }).lead] };
  });
  const offers: ComposedOffer[] = output.offers.map((offer, index) => ({
    id: OFFER_REFS[index], block: offer.block, name: say(offer.name), description: say(offer.description),
    pricing: offerPricing(offer.pricingModel, null), allowedPricing: [...OFFER_BLOCKS[offer.block].allowed], priceDisplay: null,
  }));
  const questions: ComposedQuestion[] = output.questions.map((q, index) => ({
    id: QUESTION_REFS[index], kind: q.kind, field: QUESTION_BLOCKS[q.block].field, text: q.text,
    choices: q.kind === 'choice' ? q.choices.map((label, i) => ({ id: `c_${i + 1}`, label })) : [],
    by: 'model', required: false, prefill: null, block: q.block, answer: null,
  }));
  const plan: Omit<ComposedPlan, 'digest'> = {
    composeId: decision.composeId,
    text: decision.text,
    country: structuredClone(country),
    kind,
    kindLabel: KIND_LABELS[kind],
    family: structuredClone(decision.family),
    familyLabel: SERVICE_TYPE_LABELS[decision.family.value],
    reading: structuredClone(decision.reading),
    views,
    name: say(output.name),
    oneLiner: say(output.oneLiner),
    customer: say(output.customer),
    offers,
    steps: output.steps.map((step, index) => {
      const data = STEP_BLOCKS[step.block];
      return { id: STEP_REFS[index], block: step.block, title: say(step.title), doneBy: data.doneBy, capability: data.capability, note: data.note };
    }),
    approvals: output.approvals.map(block => ({ value: APPROVAL_BLOCKS[block].words, label: 'assumption' as const, by: 'engine' as const, block })),
    pages: output.pages.map((page, index) => ({ id: PAGE_REFS[index], block: page.block, title: say(page.title), purpose: say(page.purpose) })),
    tools: output.tools.map(tool => ({ block: tool.block, reason: say(tool.reason), card: connectorCard(catalogueEntry(tool.block)!, true) })),
    questions,
    notes: output.notes.map(block => ({ block, text: NOTE_BLOCKS[block].words })),
    backOffice: previewBackOffice(country),
    taxQuestion: engineQuestions(country)[2],
    taxRateQuestion: taxRateQuestion(country),
    calls: { decide: [...decision.callIds], compose: [...meta.composeCallIds] },
    writtenBy: { ...meta.writtenBy },
    by: 'model',
    saved: false,
  };
  return { ...plan, digest: planDigest(plan) } as ComposedPlan;
}

const RECHECK_FAILED = 'Your plan could not be checked again. Make it again from what you wrote.';
/** The largest owner price ownerPrice accepts, in minor units. */
const MAX_OWNER_PRICE_MINOR = 1_000_000_000_000n;

/**
 * Re-checks a held plan before venture.create adopts it: the stored model output passes every compose rule again,
 * and assembling it again with the owner's edits gives exactly the held plan's digest.
 */
export function revalidateComposed(held: DraftCompose): ComposedPlan {
  const { decision, output, plan } = held;
  const validated = validateCompose(structuredClone(output), { views: decision.views, allowed: copiedTokens(decision.text) });
  const rebuilt = assembleComposed(decision, validated, plan.country, { writtenBy: plan.writtenBy, composeCallIds: plan.calls.compose }) as ComposedPlan;
  rebuilt.offers.forEach((offer, index) => {
    const kept = plan.offers[index];
    if (!kept) return;
    // The owner's pricing is checked again too: a model the block allows, and a price only as ownerPrice makes them.
    check(offer.allowedPricing.includes(kept.pricing.model), 'INVALID_VENTURE_REQUEST', RECHECK_FAILED);
    const minor = kept.pricing.unitPriceMinor;
    check(minor === null || (/^[1-9]\d{0,12}$/.test(minor) && BigInt(minor) <= MAX_OWNER_PRICE_MINOR), 'INVALID_VENTURE_REQUEST', RECHECK_FAILED);
    offer.pricing = structuredClone(kept.pricing);
    offer.priceDisplay = kept.priceDisplay;
  });
  rebuilt.questions.forEach((question, index) => { question.answer = structuredClone(plan.questions[index]?.answer ?? null); });
  rebuilt.backOffice = structuredClone(plan.backOffice);
  rebuilt.digest = planDigest(rebuilt);
  check(rebuilt.digest === plan.digest, 'INVALID_VENTURE_REQUEST', RECHECK_FAILED);
  return rebuilt;
}

// ---------------------------------------------------------------------------
// Owner edits before the vault (venture.compose.update)
// ---------------------------------------------------------------------------

const PATCH_KEYS = ['countryCode', 'offers', 'taxRegistered', 'taxRate', 'answers'] as const;
const has = (record: Record<string, unknown>, key: string) => Object.hasOwn(record, key);

/** Applies one owner patch to a held plan. No model call. Prices only from ownerPrice; display from formatMinor. */
export function applyComposePatch(current: ComposedPlan, value: unknown): ComposedPlan {
  const patch = exactPayload(value, PATCH_KEYS) as Record<string, unknown> & ComposePatch;
  check(Object.keys(patch).length > 0, 'INVALID_VENTURE_REQUEST', 'Send at least one change.');
  const plan = structuredClone(current) as ComposedPlan;

  if (has(patch, 'countryCode')) {
    const country = countryProfile(patch.countryCode);
    plan.country = country;
    plan.backOffice = previewBackOffice(country);
    plan.taxQuestion = engineQuestions(country)[2];
    plan.taxRateQuestion = taxRateQuestion(country);
    for (const offer of plan.offers) { offer.pricing = offerPricing(offer.pricing.model, null); offer.priceDisplay = null; }
    plan.tools = plan.tools.map(tool => ({ ...tool, card: connectorCard(catalogueEntry(tool.block)!, true) }));
  }
  const country = plan.country;

  if (has(patch, 'offers')) {
    check(Array.isArray(patch.offers) && patch.offers.length >= 1 && patch.offers.length <= plan.offers.length, 'INVALID_VENTURE_REQUEST', 'Send one change for each offer you edit.');
    const seen = new Set<string>();
    for (const item of patch.offers as unknown[]) {
      const change = exactPayload(item, ['id', 'unitPrice', 'pricingModel'], ['id']);
      check(typeof change.id === 'string' && !seen.has(change.id), 'INVALID_VENTURE_REQUEST', 'Name each offer once.');
      seen.add(change.id as string);
      const offer = plan.offers.find(o => o.id === change.id);
      check(offer, 'OFFER_NOT_FOUND', 'That offer is not in your plan.');
      check(Object.keys(change).length > 1, 'INVALID_VENTURE_REQUEST', 'Send at least one change for the offer.');
      if (has(change, 'pricingModel')) {
        check(isPricingModel(change.pricingModel), 'INVALID_VENTURE_REQUEST', 'Choose per month, per project or per hour.');
        check(offer.allowedPricing.includes(change.pricingModel), 'INVALID_VENTURE_REQUEST', `This offer can only be priced ${allowedPricingWords(offer.allowedPricing)}.`);
        offer.pricing = offerPricing(change.pricingModel, offer.pricing.unitPriceMinor);
      }
      if (has(change, 'unitPrice')) {
        if (change.unitPrice === null) {
          offer.pricing = offerPricing(offer.pricing.model, null);
          offer.priceDisplay = null;
        } else {
          const price = ownerPrice(change.unitPrice, country.currency);
          offer.pricing = offerPricing(offer.pricing.model, price.minor);
          offer.priceDisplay = formatMinor(price.minor, country.currency);
        }
      }
    }
  }

  if (has(patch, 'taxRegistered') || has(patch, 'taxRate')) {
    const backOffice: BackOffice = plan.backOffice;
    applyTaxPatch(backOffice, { ...(has(patch, 'taxRegistered') ? { taxRegistered: patch.taxRegistered } : {}), ...(has(patch, 'taxRate') ? { taxRate: patch.taxRate } : {}) }, country, {});
    withTaxInvoiceFields(backOffice, country);
  }

  if (has(patch, 'answers')) {
    check(Array.isArray(patch.answers) && patch.answers.length >= 1 && patch.answers.length <= QUESTION_REFS.length, 'INVALID_VENTURE_REQUEST', 'Send one answer for each question you answer.');
    for (const item of patch.answers as unknown[]) {
      const given = exactPayload(item, ['questionId', 'answer'], ['questionId', 'answer']);
      const question = plan.questions.find(q => q.id === given.questionId);
      check(question, 'QUESTION_NOT_FOUND', 'That question is not part of your plan.');
      question.answer = parseAnswer(storedQuestion(question), given.answer, country).answer as InterviewAnswer;
    }
  }

  plan.digest = planDigest(plan);
  return plan;
}
