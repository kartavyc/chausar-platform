// Chausar venture launcher, core (P1): the blueprint (the one-page plan).
// Code makes the structure (offers and their pricing, steps, approval count, back office, starter connectors)
// from the interview; a model or the templates only write words into named slots. The structure is hashed before
// the model writes and again inside the write, so nothing moves while it writes (APPROVAL_STALE otherwise).
import { authorize, check, ChausarError, type Context } from '../../contracts.ts';
import {
  activateTerm, bpsPercent, copiedTokens, digest, exactPayload, percentBps, requireAppChannel, requireVenture, singleLine,
  tidyWords, ventureAction, type VentureTx,
} from '../records.ts';
import { APPROVAL_COUNT, INTERVIEW_IDS, OFFER_IDS, SECOND_OFFER_MODEL, SERVICE_TYPE_LABELS, STARTER_CONNECTORS, STEP_IDS, STEP_PLAN } from '../contracts.ts';
import type {
  BackOffice, BlueprintModelOutput, BlueprintRecord, BlueprintStep, BlueprintView, CountryProfile, InterviewRecord, Json,
  Labelled, ModelTask, Offer, PlanFlagshipStep, PricingModel, ServiceType, TermRecord, VentureDeps, VentureRecord, VentureStatus,
} from '../contracts.ts';
import type {
  ApprovalBlockId, ComposedPlan, CompositionRecord, NoteBlockId, OfferBlockId, PageBlockId, StepBlockId, ToolBlockId,
} from '../onboarding-contracts.ts';
import { WORD_CAPS } from '../onboarding-contracts.ts';
import { APPROVAL_BLOCKS, OFFER_BLOCKS, STEP_BLOCKS, allowedPricingWords } from './blocks.ts';
import { interviewDone, isPricingModel, priceQuestionText, storedQuestion, taxRateQuestion, UNIT_OF } from './interview.ts';
import { blueprintView, compositionOf, interviewOf, latestBlueprint, nextBlueprintVersion } from './lookups.ts';
import { offerWords, serviceTemplate } from './service-types.ts';
import { cleanSacCode, cleanTaxId, cleanTaxState, withTaxInvoiceFields } from './tax-fields.ts';
import { DEFAULT_WORKING_NAME, labelled, modelLine, noMarkup, optionalFlag, ownerPrice, styledWords, toldByYou, wordCap } from './words.ts';
import { flagshipPlan, flagshipStarterIds, type FlagshipPlan } from '../playbooks/plan.ts';
import { flagshipDelivery } from '../playbooks/steps.ts';
import type { OwnerOfferRecord } from '../contracts.ts';
import { addOwnerOffer, liveOwnerOffers, ownerOfferInput, removeOwnerOffer, syncOwnerOffers } from './owner-offers.ts';
import { recordDecision } from '../journal/decisions.ts';

// ---------------------------------------------------------------------------
// Flagship playbooks (playbooks/plan.ts): their words are fixed engine words on the plan
// ---------------------------------------------------------------------------

/** A flagship playbook's offer names and descriptions, in plan order. The AI never rewrites them. */
export function flagshipOfferWords(plan: FlagshipPlan): { name: Labelled<string>; description: Labelled<string> }[] {
  return plan.offers.map(offer => ({ name: labelled(offer.name, 'assumption', 'engine'), description: labelled(offer.description, 'assumption', 'engine') }));
}

/** A flagship playbook's approvals on the plan, in its own words. */
export function flagshipApprovalLines(plan: FlagshipPlan): Labelled<string>[] {
  return plan.approvals.map(item => labelled(item.words, 'assumption', 'engine'));
}

/**
 * The steps a flagship playbook delivers with, as the plan lists them: each step's own title, fixed engine words, and
 * who does it (playbooks/steps.ts). They are the steps that run, so the plan the owner accepts names them.
 */
export function flagshipStepLines(plan: FlagshipPlan): PlanFlagshipStep[] {
  return (flagshipDelivery(plan.id)?.plan ?? []).map(step => ({ id: step.id, title: labelled(step.title, 'assumption', 'engine'), doneBy: step.doneBy, who: step.who }));
}

/** The flagship plan a structure was made from: its offers keep the playbook's offer ids. Null for every other plan. */
function structureFlagship(structure: Pick<BlueprintStructure, 'offers'> | undefined, venture: Pick<VentureRecord, 'idea'>): FlagshipPlan | null {
  return structure?.offers.some(offer => offer.playbookOffer) ? flagshipPlan(venture.idea) : null;
}

/** Words for each structure offer from its playbook offer, so the words follow the offer, never its position. */
function flagshipWordsFor(structure: Pick<BlueprintStructure, 'offers'>, plan: FlagshipPlan): { name: Labelled<string>; description: Labelled<string> }[] {
  const words = flagshipOfferWords(plan);
  return structure.offers.map((offer, index) => words[plan.offers.findIndex(item => item.key === offer.playbookOffer)] ?? words[index]);
}

/**
 * True when a working name is no name the owner gave: the default, or the plan's own label (a screen that names the
 * workspace after the plan's label, such as "YouTube channel" or "Creative studio"). The plan marks it an assumption.
 */
export function isPlanLabelName(name: string, labels: readonly (string | null | undefined)[]): boolean {
  const key = (value: string) => value.replace(/\s+/g, ' ').trim().toLowerCase();
  return name === DEFAULT_WORKING_NAME || labels.some(label => !!label && key(label) === key(name));
}

// ---------------------------------------------------------------------------
// Structure (pure, code-made)
// ---------------------------------------------------------------------------

/** The library blocks of a composed plan. Present only for composed ventures, so template structure hashes are unchanged. */
export type StructureBlocks = {
  offers: OfferBlockId[];
  steps: StepBlockId[];
  approvals: ApprovalBlockId[];
  pages: PageBlockId[];
  tools: ToolBlockId[];
  notes: NoteBlockId[];
};
export type BlueprintStructure = {
  serviceType: ServiceType;
  /**
   * playbookOffer: present only on a flagship playbook's plan, so every other structure hash is unchanged. owner: an
   * offer the owner added (4J8), always after the plan's own offers; present only on those.
   */
  offers: { id: string; pricing: Offer['pricing']; playbookOffer?: string; owner?: true }[];
  steps: { id: string; doneBy: BlueprintStep['doneBy']; capability: BlueprintStep['capability']; note: string }[];
  approvals: number;
  backOffice: BackOffice;
  starterConnectorIds: string[];
  blocks?: StructureBlocks;
};

/** A record is composed when any offer or step carries a block. Template records carry none. */
export function isComposedRecord(blueprint: Pick<BlueprintRecord, 'offers' | 'deliverySteps'>): boolean {
  return blueprint.offers.some(offer => offer.block !== undefined) || blueprint.deliverySteps.some(step => step.block !== undefined);
}

export const COMPOSED_TEMPLATE_REFUSED = "This plan was made with your AI. Built-in words don't fit it.";
export const COMPOSED_NEEDS_AI = 'This plan was made with your AI. Connect an AI to rewrite it.';

const has = (record: Record<string, unknown>, key: string) => Object.hasOwn(record, key);

export function offerPricing(model: PricingModel, unitPriceMinor: string | null): Offer['pricing'] {
  return { model, quantityUnit: UNIT_OF[model], unitPriceMinor, unitPriceLabel: unitPriceMinor === null ? 'not-set' : 'told-by-you', defaultQuantity: '1' };
}

export function starterConnectorIds(country: CountryProfile): string[] {
  return STARTER_CONNECTORS.map(id => (id === '<payment-rail>' ? country.paymentRails[0] : id));
}

/** Who does each step comes from STEP_PLAN, copied, never chosen by a model. */
export function stepPlan(): BlueprintStructure['steps'] {
  return STEP_PLAN.map(step => ({ id: step.id, doneBy: step.doneBy, capability: step.capability, note: step.note }));
}

/** The back office before the owner answers: not registered, an assumption made by the engine. */
export function previewBackOffice(country: CountryProfile): BackOffice {
  return withTaxInvoiceFields({
    currency: country.currency,
    taxMode: country.tax.mode,
    taxLabel: country.tax.label,
    taxRegistered: labelled(false, 'assumption', 'engine'),
    taxRateBps: '0',
    taxRateBy: 'not-registered',
    taxId: null,
    taxState: null,
    sacCode: null,
    lutConfirmed: false,
    invoiceKind: country.tax.invoiceKind,
    taxInvoiceReady: false,
    taxInvoiceMissing: [],
    paymentRail: country.paymentRails[0],
    invoicePrefix: 'INV',
  }, country);
}

/** Starter connectors for a composed plan: the builder, GitHub, the country's payment rail, the plan's tools, the books. */
export function composedStarterIds(country: CountryProfile, tools: readonly string[]): string[] {
  return [...new Set(['lovable', 'github', country.paymentRails[0], ...tools, 'chausar-books'])];
}

/**
 * The code-made structure from the venture and its interview answers, and for a composed venture its composition:
 * offer_1 is priced from the interview as today, offer_2 onwards from the owner's pricing before the vault, and the
 * steps come from the composition's step blocks and the block library. An idea that picks a flagship playbook takes
 * that playbook's offers (each keeps its playbook offer id), approval count, connectors and base service type
 * (playbooks/plan.ts), composed or not. Pure.
 */
export function structureOf(venture: VentureRecord, interview: InterviewRecord, composition: CompositionRecord | null = null, owned: readonly OwnerOfferRecord[] = []): BlueprintStructure {
  return withOwnerOffers(planStructure(venture, interview, composition), owned);
}

/**
 * Ink v2 wave 4 (4J8): the offers the owner added, after the plan's own, each priced as the owner chose to charge it and
 * with no price yet (carryOver keeps a price the owner set). With none, the structure is unchanged, so no hash moves.
 */
function withOwnerOffers(structure: BlueprintStructure, owned: readonly OwnerOfferRecord[]): BlueprintStructure {
  if (!owned.length) return structure;
  return { ...structure, offers: [...structure.offers, ...owned.map(record => ({ id: record.offerId, pricing: offerPricing(record.pricingModel, null), owner: true as const }))] };
}

function planStructure(venture: VentureRecord, interview: InterviewRecord, composition: CompositionRecord | null): BlueprintStructure {
  const country = venture.country;
  const flagship = flagshipPlan(venture.idea);
  const type = flagship?.serviceType ?? (composition ? composition.family : venture.serviceType ?? interview.serviceType.value);
  const answerOf = (id: string) => interview.questions.find(q => q.id === id);
  const chosen = answerOf(INTERVIEW_IDS.pricingModel)?.answer?.choiceId;
  const model: PricingModel = isPricingModel(chosen) ? chosen : flagship?.offers[0].model ?? 'monthly';
  const price = answerOf(INTERVIEW_IDS.price)?.answerMinor ?? null;
  const taxAnswer = answerOf(INTERVIEW_IDS.tax)?.answer ?? null;
  const registered = taxAnswer?.yes === true;
  const rate = answerOf(INTERVIEW_IDS.taxRate)?.answerBps ?? null;
  const standard = country.tax.standardRateBps;
  const backOffice = previewBackOffice(country);
  // Only the owner's own yes or no is told by you. A default a screen filled in is an assumption until the owner
  // confirms it on the plan; with no answer at all the preview's own assumption stays.
  if (taxAnswer?.assumed === true) backOffice.taxRegistered = labelled(false, 'assumption', 'template');
  else if (typeof taxAnswer?.yes === 'boolean') backOffice.taxRegistered = toldByYou(registered);
  if (registered) {
    backOffice.taxRateBps = rate ?? '0';
    backOffice.taxRateBy = rate !== null && standard !== '0' && rate === standard ? 'country-table' : 'told-by-you';
  }
  withTaxInvoiceFields(backOffice, country);
  if (composition) {
    const output = composition.output;
    // A flagship playbook's offers and approvals replace the ones the AI picked; its pages, tools and steps stay.
    const offers: { block: OfferBlockId; pricingModel: PricingModel; playbookOffer?: string }[] = flagship
      ? flagship.offers.map(offer => ({ block: offer.block, pricingModel: offer.model, playbookOffer: offer.key }))
      : output.offers.map(offer => ({ block: offer.block, pricingModel: offer.pricingModel }));
    const approvals: ApprovalBlockId[] = flagship ? flagship.approvals.map(item => item.block) : [...output.approvals];
    const tools = output.tools.map(tool => tool.block);
    return {
      serviceType: type,
      offers: offers.map((offer, index) => {
        const id = `offer_${index + 1}`;
        const own = offer.playbookOffer ? { playbookOffer: offer.playbookOffer } : {};
        if (index === 0) return { id, pricing: offerPricing(model, price), ...own };
        const kept = composition.pricing.find(item => item.id === id);
        return { id, pricing: offerPricing(kept?.model ?? offer.pricingModel, kept?.unitPriceMinor ?? null), ...own };
      }),
      steps: output.steps.map((step, index) => {
        const data = STEP_BLOCKS[step.block];
        return { id: `step_${index + 1}`, doneBy: data.doneBy, capability: data.capability, note: data.note };
      }),
      approvals: approvals.length,
      backOffice,
      starterConnectorIds: composedStarterIds(country, flagship ? [...flagship.connectors, ...tools] : tools),
      blocks: {
        offers: offers.map(offer => offer.block),
        steps: output.steps.map(step => step.block),
        approvals,
        pages: output.pages.map(page => page.block),
        tools,
        notes: [...output.notes],
      },
    };
  }
  if (flagship) {
    return {
      serviceType: type,
      offers: flagship.offers.map((offer, index) => ({
        id: `offer_${index + 1}`, pricing: index === 0 ? offerPricing(model, price) : offerPricing(offer.model, null), playbookOffer: offer.key,
      })),
      steps: stepPlan(),
      approvals: flagship.approvals.length,
      backOffice,
      starterConnectorIds: flagshipStarterIds(flagship, country),
    };
  }
  return {
    serviceType: type,
    offers: [
      { id: OFFER_IDS[0], pricing: offerPricing(model, price) },
      { id: OFFER_IDS[1], pricing: offerPricing(SECOND_OFFER_MODEL[type], null) },
    ],
    steps: stepPlan(),
    approvals: APPROVAL_COUNT,
    backOffice,
    starterConnectorIds: starterConnectorIds(country),
  };
}

export function structureFromBlueprint(blueprint: BlueprintRecord): BlueprintStructure {
  const structure: BlueprintStructure = {
    serviceType: blueprint.serviceType,
    offers: blueprint.offers.map(o => ({ id: o.id, pricing: o.pricing, ...(o.playbookOffer ? { playbookOffer: o.playbookOffer } : {}), ...(o.addedByOwner ? { owner: true as const } : {}) })),
    steps: blueprint.deliverySteps.map(s => ({ id: s.id, doneBy: s.doneBy, capability: s.capability, note: s.note })),
    approvals: blueprint.approvals.length,
    backOffice: blueprint.backOffice,
    starterConnectorIds: blueprint.starterConnectorIds,
  };
  // A composed record hashes its blocks too, so a rewrite can change words but never the block structure.
  if (isComposedRecord(blueprint)) {
    structure.blocks = {
      offers: blueprint.offers.filter(o => !o.addedByOwner).map(o => o.block as OfferBlockId),
      steps: blueprint.deliverySteps.map(s => s.block as StepBlockId),
      approvals: [...(blueprint.approvalBlocks ?? [])],
      pages: (blueprint.pages ?? []).map(p => p.block),
      tools: (blueprint.tools ?? []).map(t => t.block),
      notes: (blueprint.notes ?? []).map(n => n.block),
    };
  }
  return structure;
}

/** Digest of the whole blueprint except id, at, digest and status, so accepting a version keeps its digest. */
export function blueprintDigest(blueprint: BlueprintRecord): string {
  const { id: _id, at: _at, digest: _digest, status: _status, ...rest } = blueprint;
  return digest(rest);
}

function seal(blueprint: BlueprintRecord): BlueprintRecord {
  blueprint.structureHash = digest(structureFromBlueprint(blueprint));
  blueprint.digest = blueprintDigest(blueprint);
  return blueprint;
}

/**
 * Owner settings the interview never asks for (registration number, state, SAC code, LUT, the second offer's
 * pricing) are kept from the previous version. Once the plan was accepted the interview is closed, so every
 * owner setting on the previous version is kept.
 */
export function carryOver(structure: BlueprintStructure, previous: BlueprintRecord | null, interviewClosed: boolean, country: CountryProfile): BlueprintStructure {
  if (!previous) return structure;
  const next = structuredClone(structure);
  const backOffice = next.backOffice, before = previous.backOffice;
  backOffice.taxId = before.taxId;
  backOffice.taxState = before.taxState;
  backOffice.sacCode = before.sacCode;
  backOffice.lutConfirmed = before.lutConfirmed;
  // The structure's own offer ids: offer_2 onwards always keep their pricing; offer_1 too once the interview is closed.
  const ids = next.offers.map(o => o.id);
  for (const id of interviewClosed ? ids : ids.slice(1)) {
    const was = previous.offers.find(o => o.id === id);
    const offer = next.offers.find(o => o.id === id);
    if (was && offer) offer.pricing = structuredClone(was.pricing);
  }
  if (interviewClosed) {
    backOffice.taxRegistered = structuredClone(before.taxRegistered);
    backOffice.taxRateBps = before.taxRateBps;
    backOffice.taxRateBy = before.taxRateBy;
  }
  withTaxInvoiceFields(backOffice, country);
  return next;
}

const STATUS_ORDER: readonly VentureStatus[] = ['interview', 'blueprint', 'build', 'rehearsal', 'live'];
/** Moves the venture status forward to at least `wanted`; never back. */
export function statusAtLeast(current: VentureStatus, wanted: VentureStatus): VentureStatus {
  return STATUS_ORDER.indexOf(current) >= STATUS_ORDER.indexOf(wanted) ? current : wanted;
}

// ---------------------------------------------------------------------------
// Words (model or template)
// ---------------------------------------------------------------------------

export const BLUEPRINT_INSTRUCTIONS = "Write the words for a one-page service business plan. The structure is fixed: keep every id exactly as given and write only names, descriptions and titles. Name and describe each offer to fit how it is charged, as given by its pricingModel: per month, per project or per hour. Step three is the step an agent drafts from the client's message; the other steps are done by the owner for now. Never write digits, prices, percentages or amounts. Plain words, no dashes, no hype.";

export const BLUEPRINT_SCHEMA: Json = {
  type: 'object', additionalProperties: false,
  required: ['name', 'oneLiner', 'customer', 'offers', 'steps', 'approvals'],
  properties: {
    name: { type: 'string', description: 'Business name. No digits.' },
    oneLiner: { type: 'string', description: 'One sentence. No digits or prices.' },
    customer: { type: 'string', description: 'Who it is for. No digits.' },
    offers: {
      type: 'array', items: {
        type: 'object', additionalProperties: false,
        required: ['id', 'name', 'description'],
        properties: {
          id: { type: 'string', enum: ['offer_1', 'offer_2'] },
          name: { type: 'string', description: 'Offer name. No digits or prices.' },
          description: { type: 'string', description: 'One sentence. No digits or prices.' },
        },
      },
    },
    steps: {
      type: 'array', items: {
        type: 'object', additionalProperties: false,
        required: ['id', 'title'],
        properties: {
          id: { type: 'string', enum: ['step_1', 'step_2', 'step_3', 'step_4'] },
          title: { type: 'string', description: 'Short step title. No digits.' },
        },
      },
    },
    approvals: { type: 'array', items: { type: 'string', description: 'Something the owner approves. No digits.' } },
  },
};

/**
 * The ids a plan's words are written for: the template's, or a composed plan's own (whose approvals are fixed words).
 * flagship: a flagship playbook's plan, whose offers and approvals are the playbook's fixed words, so the model writes
 * neither (playbooks/plan.ts).
 */
export type BlueprintIds = { offers: readonly string[]; steps: readonly string[]; approvals: number; composed: boolean; flagship?: true };
export const TEMPLATE_IDS: BlueprintIds = Object.freeze({ offers: OFFER_IDS, steps: STEP_IDS, approvals: APPROVAL_COUNT, composed: false });

export function idsOf(structure: BlueprintStructure): BlueprintIds {
  const flagship = structure.offers.some(offer => offer.playbookOffer);
  if (!structure.blocks && !flagship) return TEMPLATE_IDS;
  return {
    offers: structure.offers.filter(o => !o.owner).map(o => o.id), steps: structure.steps.map(s => s.id), approvals: structure.approvals, composed: !!structure.blocks,
    ...(flagship ? { flagship: true as const } : {}),
  };
}

/** Composed plans keep the onboarding word caps and refuse markup, as when they were composed. */
function planWords(value: unknown, field: string, max: number, allowed: readonly string[], cap: number | null): string {
  const words = styledWords(value, field, max, allowed);
  if (cap === null) return words;
  wordCap(words, field, cap);
  return noMarkup(words, field);
}

/**
 * Local authority over the blueprint words. Ids must come back exactly, in order (the structure's own ids); every
 * string is checked words. A composed plan's approvals are fixed words, so the model writes none; a flagship playbook's
 * offers and approvals are the playbook's own words, so the model writes neither.
 */
export function validateBlueprintOutput(raw: unknown, allowed: readonly string[], ids: BlueprintIds = TEMPLATE_IDS): BlueprintModelOutput {
  const code = 'MODEL_OUTPUT_REJECTED';
  const composed = ids.composed;
  const caps = (key: keyof typeof WORD_CAPS) => (composed ? WORD_CAPS[key] : null);
  const keys = ids.flagship ? ['name', 'oneLiner', 'customer', 'steps']
    : composed ? ['name', 'oneLiner', 'customer', 'offers', 'steps'] : ['name', 'oneLiner', 'customer', 'offers', 'steps', 'approvals'];
  const body = exactPayload(raw, keys, keys, code);
  const name = planWords(body.name, 'business name', 60, allowed, caps('name'));
  const oneLiner = planWords(body.oneLiner, 'one line summary', 160, allowed, caps('oneLiner'));
  const customer = planWords(body.customer, 'customer line', 200, allowed, caps('customer'));
  check(ids.flagship || (Array.isArray(body.offers) && body.offers.length === ids.offers.length), code, 'The AI changed the offers in the plan.');
  const offers = ids.flagship ? [] : (body.offers as unknown[]).map((item, index) => {
    const offer = exactPayload(item, ['id', 'name', 'description'], ['id', 'name', 'description'], code);
    check(offer.id === ids.offers[index], code, 'The AI changed the offers in the plan.');
    return { id: ids.offers[index], name: planWords(offer.name, 'offer name', 60, allowed, caps('offerName')), description: planWords(offer.description, 'offer description', 200, allowed, caps('offerDescription')) };
  });
  check(Array.isArray(body.steps) && body.steps.length === ids.steps.length, code, 'The AI changed the steps in the plan.');
  const steps = (body.steps as unknown[]).map((item, index) => {
    const step = exactPayload(item, ['id', 'title'], ['id', 'title'], code);
    check(step.id === ids.steps[index], code, 'The AI changed the steps in the plan.');
    return { id: ids.steps[index], title: planWords(step.title, 'step title', 80, allowed, caps('stepTitle')) };
  });
  if (composed || ids.flagship) return { name, oneLiner, customer, offers, steps, approvals: [] };
  check(Array.isArray(body.approvals) && body.approvals.length === ids.approvals, code, 'The AI changed what you approve.');
  const approvals = (body.approvals as unknown[]).map(item => styledWords(item, 'approval', 120, allowed));
  return { name, oneLiner, customer, offers, steps, approvals };
}

/** The blueprint schema for these ids: id enums from the structure's own ids; no approvals for a composed plan. */
export function blueprintSchema(ids: BlueprintIds): Json {
  const schema = structuredClone(BLUEPRINT_SCHEMA) as any;
  schema.properties.offers.items.properties.id.enum = [...ids.offers];
  schema.properties.steps.items.properties.id.enum = [...ids.steps];
  if (ids.composed) {
    delete schema.properties.approvals;
    schema.required = schema.required.filter((key: string) => key !== 'approvals');
    schema.properties.name.description = 'Business name, four words or fewer. No numbers.';
    schema.properties.offers.items.properties.name.description = 'Offer name, four words or fewer. No numbers or prices.';
    schema.properties.steps.items.properties.title.description = 'Step title, four words or fewer. No numbers.';
  }
  if (ids.flagship) {
    // A flagship playbook's offers and approvals are its own words: the model is asked for neither.
    delete schema.properties.offers;
    delete schema.properties.approvals;
    schema.required = schema.required.filter((key: string) => key !== 'offers' && key !== 'approvals');
  }
  return schema;
}

/**
 * Template words for the plan; the name is the owner's working name. Each offer is worded for how it is charged in
 * the structure (the owner's choice for offer_1), so an hourly offer never reads 'Monthly ...'. An idea that picks a
 * flagship playbook takes its summary as the one line, and its offers and approvals stay the playbook's (labelWords).
 */
export function templateWords(venture: VentureRecord, type: ServiceType, models?: readonly PricingModel[]): BlueprintModelOutput {
  const template = serviceTemplate(type);
  const flagship = flagshipPlan(venture.idea);
  return {
    name: venture.workingName,
    oneLiner: flagship?.oneLiner ?? template.oneLiner,
    customer: template.customer,
    offers: OFFER_IDS.map((id, index) => {
      const words = models?.[index] ? offerWords(type, index, models[index]) : template.offers[index];
      return { id, name: words.name, description: words.description };
    }),
    steps: STEP_IDS.map((id, index) => ({ id, title: template.steps[index] })),
    approvals: [...template.approvals],
  };
}

const OPENING_IDS: readonly string[] = [INTERVIEW_IDS.first, INTERVIEW_IDS.second];

/** The owner's answers to the opening questions, as words for the model: the chosen label or the typed text. */
export function openingAnswers(interview: InterviewRecord): { question: string; answer: string }[] {
  const answers: { question: string; answer: string }[] = [];
  for (const q of interview.questions) {
    if (!OPENING_IDS.includes(q.id) || !q.answer || q.answer.skipped) continue;
    const answer = q.kind === 'choice' ? q.choices.find(c => c.id === q.answer?.choiceId)?.label : q.answer.text;
    if (answer) answers.push({ question: q.text, answer });
  }
  return answers;
}

function typedAnswers(interview: InterviewRecord): string[] {
  return interview.questions.filter(q => OPENING_IDS.includes(q.id) && typeof q.answer?.text === 'string').map(q => q.answer?.text as string);
}

/** For a composed plan: which step is the drafting step and that approvals are fixed, in place of step three. */
export const COMPOSED_BLUEPRINT_INSTRUCTIONS = "Write the words for a one-page service business plan. The structure is fixed: keep every id exactly as given and write only names, descriptions and titles. Name and describe each offer to fit how it is charged, as given by its pricingModel: per month, per project or per hour. The step whose doneBy is agent-then-you is the step an agent drafts from the client's message; the other steps are done by the owner. Keep a business name, offer names and step titles to four words or fewer. Never write numbers in digits or in words, prices, percentages, amounts, links or markup. Plain words, no dashes, no hype.";

/** For a flagship playbook's plan: its offers and approvals are fixed, so only the name, summary, customer and steps are written. */
export const FLAGSHIP_BLUEPRINT_INSTRUCTIONS = "Write the words for a one-page service business plan that follows the named playbook. The offers and what the owner approves are fixed by the playbook, so write only the business name, the one line summary, the customer line and the step titles, keeping every step id exactly as given. The step whose doneBy is agent-then-you is the step an agent drafts from the client's message; the other steps are done by the owner. Never write digits, prices, percentages or amounts. Plain words, no dashes, no hype.";

export function blueprintTask(venture: VentureRecord, interview: InterviewRecord, structure: BlueprintStructure, template: () => BlueprintModelOutput): ModelTask<BlueprintModelOutput> {
  const allowed = copiedTokens(venture.idea, ...typedAnswers(interview));
  const ids = idsOf(structure);
  const flagship = ids.flagship ? structureFlagship(structure, venture) : null;
  return {
    purpose: 'blueprint',
    instructions: flagship ? FLAGSHIP_BLUEPRINT_INSTRUCTIONS : ids.composed ? COMPOSED_BLUEPRINT_INSTRUCTIONS : BLUEPRINT_INSTRUCTIONS,
    input: {
      idea: venture.idea,
      serviceType: structure.serviceType,
      ...(flagship ? { playbook: flagship.label } : {}),
      country: venture.country.name,
      answers: openingAnswers(interview),
      structure: {
        offers: structure.offers.filter(o => !o.owner).map(o => ({ id: o.id, pricingModel: o.pricing.model })),
        steps: structure.steps.map(s => ({ id: s.id, doneBy: s.doneBy })),
        approvals: ids.composed || flagship ? 0 : APPROVAL_COUNT,
      },
    },
    schemaName: 'venture-blueprint',
    schema: blueprintSchema(ids),
    validate: raw => validateBlueprintOutput(raw, allowed, ids),
    template,
    containsClientData: false,
    maxOutputTokens: 4096,
  };
}

/** Who the business is for, in the owner's own words, when they typed it as text. */
export function ownerCustomer(interview: InterviewRecord): string | null {
  const q = interview.questions.find(x => OPENING_IDS.includes(x.id) && x.field === 'customer' && typeof x.answer?.text === 'string');
  if (!q) return null;
  const words = tidyWords(q.answer?.text as string);
  return words.length >= 2 && words.length <= 200 ? words : null;
}

type PlanWords = {
  name: Labelled<string>;
  oneLiner: Labelled<string>;
  customer: Labelled<string>;
  offers: { name: Labelled<string>; description: Labelled<string> }[];
  steps: Labelled<string>[];
  approvals: Labelled<string>[];
  /** A flagship playbook's own delivery steps, fixed engine words; absent on every other plan. */
  flagshipSteps?: PlanFlagshipStep[];
};

function labelWords(output: BlueprintModelOutput, by: 'model' | 'template', venture: VentureRecord, interview: InterviewRecord, structure?: BlueprintStructure, owned: readonly OwnerOfferRecord[] = []): PlanWords {
  // A number in the model's words makes the line a model estimate; template words hold no numbers.
  const allowed = copiedTokens(venture.idea, ...typedAnswers(interview));
  const say = (value: string) => (by === 'model' ? modelLine(value, allowed) : labelled(value, 'assumption', by));
  // A flagship playbook's offers and approvals are its own fixed words; a composed plan's approvals are the approval
  // blocks' fixed words. Neither is ever model words.
  const flagship = structureFlagship(structure, venture);
  const approvals = flagship ? flagshipApprovalLines(flagship)
    : structure?.blocks ? structure.blocks.approvals.map(block => labelled(APPROVAL_BLOCKS[block].words, 'assumption', 'engine'))
      : output.approvals.map(say);
  // A working name that is only the plan's own label (a screen named the workspace after it) is no name the owner gave.
  const type = structure?.serviceType ?? interview.serviceType.value;
  const name = by === 'model'
    ? say(output.name)
    : isPlanLabelName(venture.workingName, [flagship?.label ?? flagshipPlan(venture.idea)?.label, SERVICE_TYPE_LABELS[type]])
      ? labelled(venture.workingName, 'assumption', 'template') : toldByYou(venture.workingName);
  const typed = ownerCustomer(interview);
  return {
    name,
    oneLiner: say(output.oneLiner),
    customer: typed ? toldByYou(typed) : say(output.customer),
    offers: [
      ...(flagship && structure ? flagshipWordsFor({ offers: structure.offers.filter(o => !o.owner) }, flagship) : output.offers.map(o => ({ name: say(o.name), description: say(o.description) }))),
      // 4J8: the offers the owner added keep the owner's own words; Rewrite with AI never writes them.
      ...(structure?.offers ?? []).filter(o => o.owner).map(o => {
        const record = owned.find(item => item.offerId === o.id);
        check(record, 'APPROVAL_STALE', 'Your plan changed while its words were being written. Write it again.');
        return { name: toldByYou(record.name), description: toldByYou(record.description) };
      }),
    ],
    steps: output.steps.map(s => say(s.title)),
    approvals,
    ...(flagship ? { flagshipSteps: flagshipStepLines(flagship) } : {}),
  };
}

/**
 * One blueprint version from a structure and words. A composed plan carries its block ids onto offers and steps, and
 * keeps the previous version's pages, tools, notes, composition and approval blocks unchanged.
 */
function assemble(tx: VentureTx, structure: BlueprintStructure, words: PlanWords, source: 'model' | 'template', modelCallIds: string[], version: number, previous: BlueprintRecord | null = null): BlueprintRecord {
  const blocks = structure.blocks;
  const record: BlueprintRecord = {
    ...tx.base('venture-blueprint'),
    version,
    status: 'draft',
    source,
    structureHash: '',
    digest: '',
    modelCallIds,
    serviceType: structure.serviceType,
    name: words.name,
    oneLiner: words.oneLiner,
    customer: words.customer,
    offers: structure.offers.map((o, index) => ({
      id: o.id, ...(blocks && blocks.offers[index] ? { block: blocks.offers[index] } : {}), ...(o.playbookOffer ? { playbookOffer: o.playbookOffer } : {}),
      ...(o.owner ? { addedByOwner: true as const } : {}),
      name: words.offers[index].name, description: words.offers[index].description, pricing: structuredClone(o.pricing),
    })),
    deliverySteps: structure.steps.map((s, index) => ({
      id: s.id, ...(blocks ? { block: blocks.steps[index] } : {}), title: words.steps[index], doneBy: s.doneBy, capability: s.capability, note: s.note,
    })),
    approvals: words.approvals,
    backOffice: structuredClone(structure.backOffice),
    starterConnectorIds: [...structure.starterConnectorIds],
    ...(words.flagshipSteps ? { flagshipSteps: words.flagshipSteps } : {}),
  };
  if (blocks && previous) {
    record.composition = structuredClone(previous.composition ?? null);
    record.approvalBlocks = [...(previous.approvalBlocks ?? blocks.approvals)];
    record.pages = structuredClone(previous.pages ?? []);
    record.tools = structuredClone(previous.tools ?? []);
    record.notes = structuredClone(previous.notes ?? []);
  }
  return seal(record);
}

/**
 * Blueprint version 1 of a composed plan, written by venture.create: words from the plan the owner kept (labelled as
 * the AI's assumptions, the customer line told by you when the owner typed it), the structure from structureOf, and
 * the pages, tools, notes and approval blocks copied from the composition.
 */
export function assembleComposedBlueprint(tx: VentureTx, structure: BlueprintStructure, interview: InterviewRecord, composition: CompositionRecord, plan: ComposedPlan): BlueprintRecord {
  check(structure.blocks, 'INVALID_VENTURE_REQUEST', 'This plan was not composed.');
  const blocks = structure.blocks;
  const typed = ownerCustomer(interview);
  // A flagship playbook's plan keeps the playbook's approvals in its own words (playbooks/plan.ts).
  const flagship = structureFlagship(structure, { idea: composition.text });
  const record: BlueprintRecord = {
    ...tx.base('venture-blueprint'),
    version: 1,
    status: 'draft',
    source: 'model',
    structureHash: '',
    digest: '',
    modelCallIds: [...composition.decideCallIds, ...composition.composeCallIds],
    serviceType: structure.serviceType,
    name: structuredClone(plan.name),
    oneLiner: structuredClone(plan.oneLiner),
    customer: typed ? toldByYou(typed) : structuredClone(plan.customer),
    offers: structure.offers.map((o, index) => ({
      id: o.id, block: blocks.offers[index], ...(o.playbookOffer ? { playbookOffer: o.playbookOffer } : {}),
      name: structuredClone(plan.offers[index].name), description: structuredClone(plan.offers[index].description), pricing: structuredClone(o.pricing),
    })),
    deliverySteps: structure.steps.map((s, index) => ({
      id: s.id, block: blocks.steps[index], title: structuredClone(plan.steps[index].title), doneBy: s.doneBy, capability: s.capability, note: s.note,
    })),
    approvals: flagship ? flagshipApprovalLines(flagship) : blocks.approvals.map(block => labelled(APPROVAL_BLOCKS[block].words, 'assumption', 'engine')),
    backOffice: structuredClone(structure.backOffice),
    starterConnectorIds: [...structure.starterConnectorIds],
    composition: { id: composition.id, composeId: composition.composeId, kind: composition.planKind, views: structuredClone(composition.views) },
    approvalBlocks: [...blocks.approvals],
    pages: structuredClone(plan.pages),
    tools: plan.tools.map(tool => ({ block: tool.block, reason: structuredClone(tool.reason) })),
    notes: structuredClone(plan.notes),
    ...(flagship ? { flagshipSteps: flagshipStepLines(flagship) } : {}),
  };
  return seal(record);
}

// ---------------------------------------------------------------------------
// Terms
// ---------------------------------------------------------------------------

const TERM_WORDS: Readonly<Record<TermRecord['key'], { name: string; meaning: string }>> = Object.freeze({
  client: { name: 'Client', meaning: 'A person or business that buys from you.' },
  offer: { name: 'Offer', meaning: 'A service you sell, with the price and unit from your plan.' },
  order: { name: 'Order', meaning: 'A request from a client to buy one of your offers.' },
  deliverable: { name: 'Deliverable', meaning: 'The work you hand a client for an order, after you check it.' },
  invoice: { name: 'Invoice', meaning: 'The bill you send a client for an order.' },
  payment: { name: 'Payment', meaning: 'Money a client pays you against an invoice.' },
  'revision-round': { name: 'Revision round', meaning: 'A chance for the client to ask for changes to the work.' },
  'retainer-period': { name: 'Retainer period', meaning: 'The month that a monthly offer covers.' },
});

export function termKeysFor(blueprint: BlueprintRecord): TermRecord['key'][] {
  const keys: TermRecord['key'][] = ['client', 'offer', 'order', 'deliverable', 'invoice', 'payment'];
  if (['agency', 'studio', 'content'].includes(blueprint.serviceType)) keys.push('revision-round');
  if (blueprint.offers.find(o => o.id === OFFER_IDS[0])?.pricing.model === 'monthly') keys.push('retainer-period');
  return keys;
}

/** Business terms start proposed and turn active only when evidence arrives. Each key is made once. */
function ensureTerms(tx: VentureTx, blueprint: BlueprintRecord): void {
  const existing = new Set(tx.list('venture-term').map(t => t.key));
  for (const key of termKeysFor(blueprint)) {
    if (existing.has(key)) continue;
    const term: TermRecord = { ...tx.base('venture-term'), key, name: TERM_WORDS[key].name, meaning: TERM_WORDS[key].meaning, lifecycle: 'proposed', evidence: [] };
    tx.put(term);
  }
}

// ---------------------------------------------------------------------------
// Owner edits
// ---------------------------------------------------------------------------

const PATCH_KEYS = ['name', 'oneLiner', 'customer', 'taxRegistered', 'taxRate', 'taxId', 'taxState', 'sacCode', 'lutConfirmed', 'offers', 'addOffer', 'removeOffer'] as const;
const DIGEST_TEXT = /^[a-f0-9]{64}$/;
const STALE_SUGGESTION = 'Your plan changed since this was suggested. Ask again, then apply it.';

/** The plan version a patch was made from (a suggestion's basedOn): its id and digest. */
function basedOnOf(value: unknown): { blueprintId: string; digest: string } {
  const body = exactPayload(value, ['blueprintId', 'digest'], ['blueprintId', 'digest']);
  check(typeof body.blueprintId === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(body.blueprintId), 'INVALID_VENTURE_REQUEST', 'Send the id of the plan the change was made from.');
  check(typeof body.digest === 'string' && DIGEST_TEXT.test(body.digest), 'INVALID_VENTURE_REQUEST', 'Send the digest of the plan the change was made from.');
  return { blueprintId: body.blueprintId, digest: body.digest };
}
const OFFER_PATCH_KEYS = ['id', 'name', 'description', 'unitPrice', 'pricingModel'] as const;

/** What an edit changed that the open interview also holds, so the two stay the same. */
type InterviewMirror = { pricingModel?: PricingModel; price?: { text: string; minor: string } | null; tax?: boolean };

function applyOfferPatches(blueprint: BlueprintRecord, value: unknown, country: CountryProfile, mirror: InterviewMirror): void {
  const ids = blueprint.offers.map(o => o.id);
  check(Array.isArray(value) && value.length >= 1 && value.length <= ids.length, 'INVALID_VENTURE_REQUEST', 'Send one change for each offer you edit.');
  const seen = new Set<string>();
  for (const item of value as unknown[]) {
    const change = exactPayload(item, OFFER_PATCH_KEYS, ['id']);
    const id = change.id;
    check(typeof id === 'string' && ids.includes(id) && !seen.has(id), 'INVALID_VENTURE_REQUEST', `Name each offer once, as ${ids.join(' or ')}.`);
    seen.add(id);
    check(Object.keys(change).length > 1, 'INVALID_VENTURE_REQUEST', 'Send at least one change for the offer.');
    const offer = blueprint.offers.find(o => o.id === id);
    check(offer, 'OFFER_NOT_FOUND', 'That offer is not in your plan.');
    if (has(change, 'name')) offer.name = toldByYou(singleLine(change.name, 'The offer name', { min: 2, max: 60 }));
    if (has(change, 'description')) offer.description = toldByYou(singleLine(change.description, 'The offer description', { min: 2, max: 200 }));
    if (has(change, 'pricingModel')) {
      const model = change.pricingModel;
      check(isPricingModel(model), 'INVALID_VENTURE_REQUEST', 'Choose per month, per project or per hour.');
      // A composed offer can only be priced the ways its block allows, before and after the vault.
      if (offer.block) {
        const allowed = OFFER_BLOCKS[offer.block].allowed;
        check(allowed.includes(model), 'INVALID_VENTURE_REQUEST', `This offer can only be priced ${allowedPricingWords(allowed)}.`);
      }
      offer.pricing.model = model;
      offer.pricing.quantityUnit = UNIT_OF[model];
      // Template words follow the new pricing; the owner's own words and the AI's words stay as they are.
      const index = OFFER_IDS.indexOf(id as typeof OFFER_IDS[number]);
      if (index >= 0) {
        const words = offerWords(blueprint.serviceType, index, model);
        if (!has(change, 'name') && offer.name.by === 'template') offer.name = labelled(words.name, 'assumption', 'template');
        if (!has(change, 'description') && offer.description.by === 'template') offer.description = labelled(words.description, 'assumption', 'template');
      }
      if (id === OFFER_IDS[0]) mirror.pricingModel = model;
    }
    if (has(change, 'unitPrice')) {
      if (change.unitPrice === null) {
        offer.pricing.unitPriceMinor = null;
        offer.pricing.unitPriceLabel = 'not-set';
        if (id === OFFER_IDS[0]) mirror.price = null;
      } else {
        const price = ownerPrice(change.unitPrice, country.currency);
        offer.pricing.unitPriceMinor = price.minor;
        offer.pricing.unitPriceLabel = 'told-by-you';
        if (id === OFFER_IDS[0]) mirror.price = price;
      }
    }
  }
}

export function applyTaxPatch(backOffice: BackOffice, patch: Record<string, unknown>, country: CountryProfile, mirror: InterviewMirror): void {
  const india = country.code === 'IN';
  for (const key of ['taxState', 'sacCode', 'lutConfirmed']) {
    if (has(patch, key)) check(india, 'INVALID_VENTURE_REQUEST', 'This setting is only for businesses in India.');
  }
  if (has(patch, 'taxRegistered')) {
    check(typeof patch.taxRegistered === 'boolean', 'INVALID_VENTURE_REQUEST', 'Say yes or no to charging tax.');
    const was = backOffice.taxRegistered.value;
    backOffice.taxRegistered = toldByYou(patch.taxRegistered);
    if (!patch.taxRegistered) {
      backOffice.taxRateBps = '0';
      backOffice.taxRateBy = 'not-registered';
    } else if (!was) {
      // The country prefill only exists where the table has a rate ('0' means it varies or is unknown). Without
      // one, a rate here would claim a source that does not exist, so the owner must give their own.
      check(country.tax.standardRateBps !== '0' || has(patch, 'taxRate'), 'INVALID_TAX_RATE', 'Enter the rate you charge when you turn tax on.');
      backOffice.taxRateBps = country.tax.standardRateBps;
      backOffice.taxRateBy = 'country-table';
    }
    mirror.tax = true;
  }
  if (has(patch, 'taxRate')) {
    const bps = percentBps(patch.taxRate, 'Your tax rate');
    check(backOffice.taxRegistered.value, 'INVALID_TAX_RATE', 'Turn tax on before you set a rate.');
    backOffice.taxRateBps = bps;
    backOffice.taxRateBy = 'told-by-you';
    mirror.tax = true;
  }
  if (has(patch, 'taxId')) backOffice.taxId = patch.taxId === null ? null : cleanTaxId(patch.taxId, country);
  if (has(patch, 'taxState')) backOffice.taxState = patch.taxState === null ? null : cleanTaxState(patch.taxState);
  if (has(patch, 'sacCode')) backOffice.sacCode = patch.sacCode === null ? null : cleanSacCode(patch.sacCode);
  if (has(patch, 'lutConfirmed')) {
    check(typeof patch.lutConfirmed === 'boolean', 'INVALID_VENTURE_REQUEST', 'Say yes or no to the LUT.');
    backOffice.lutConfirmed = patch.lutConfirmed;
  }
  if (india && backOffice.taxId) {
    // A GSTIN's first two digits are the state it is registered in.
    const code = backOffice.taxId.slice(0, 2);
    if ((has(patch, 'taxId') && !has(patch, 'taxState')) || backOffice.taxState === null) backOffice.taxState = code;
    check(backOffice.taxState === code, 'INVALID_TAX_ID', 'Your state must match the first two digits of your GSTIN.');
  }
}

/** Before acceptance the interview stays the source of price and tax answers, so a rewrite keeps the owner's edits. */
function mirrorIntoInterview(tx: VentureTx, venture: VentureRecord, blueprint: BlueprintRecord, mirror: InterviewMirror): void {
  if (mirror.pricingModel === undefined && mirror.price === undefined && mirror.tax === undefined) return;
  const interview = interviewOf(tx.state, venture.id);
  if (interview.questions.length === 0) return;
  const country = venture.country;
  const set = (id: string, answer: InterviewRecord['questions'][number]['answer'], minor: string | null, bps: string | null) => {
    const q = interview.questions.find(x => x.id === id);
    if (!q) return;
    q.answer = answer;
    q.answerMinor = minor;
    q.answerBps = bps;
    q.answeredAt = tx.now;
  };
  if (mirror.pricingModel !== undefined) {
    set(INTERVIEW_IDS.pricingModel, { choiceId: mirror.pricingModel }, null, null);
    const price = interview.questions.find(q => q.id === INTERVIEW_IDS.price);
    if (price) price.text = priceQuestionText(mirror.pricingModel, country.currency);
  }
  if (mirror.price !== undefined) set(INTERVIEW_IDS.price, mirror.price ? { amount: mirror.price.text } : { skipped: true }, mirror.price?.minor ?? null, null);
  if (mirror.tax !== undefined) {
    const backOffice = blueprint.backOffice;
    set(INTERVIEW_IDS.tax, { yes: backOffice.taxRegistered.value }, null, null);
    const hasRate = interview.questions.some(q => q.id === INTERVIEW_IDS.taxRate);
    if (backOffice.taxRegistered.value) {
      if (!hasRate) interview.questions.push(storedQuestion(taxRateQuestion(country)));
      set(INTERVIEW_IDS.taxRate, { rate: bpsPercent(backOffice.taxRateBps) }, null, backOffice.taxRateBps);
    } else if (hasRate) {
      interview.questions = interview.questions.filter(q => q.id !== INTERVIEW_IDS.taxRate);
    }
  }
  tx.replace(interview);
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/** venture.blueprint.draft { useTemplate? } (prepare). "Rewrite with AI" is this call without useTemplate. */
export async function blueprintDraft(deps: VentureDeps, ctx: Context, payload: unknown): Promise<BlueprintView> {
  const body = exactPayload(payload, ['useTemplate']);
  const useTemplate = optionalFlag(body, 'useTemplate');
  authorize(deps.store, ctx, 'prepare');
  const state = deps.store.read();
  const venture = requireVenture(state);
  const composition = compositionOf(state, venture.id);
  // A composed plan has no built-in words that fit it: refuse before any work.
  check(!(composition && useTemplate), 'INVALID_VENTURE_REQUEST', COMPOSED_TEMPLATE_REFUSED);
  const interview = interviewOf(state, venture.id);
  check(interviewDone(interview), 'INTERVIEW_INCOMPLETE', 'Answer the questions about your price and tax first.');
  // 4J8: the offers the owner added stay on every rewrite, with their words and prices.
  const owned = liveOwnerOffers(state, venture.id);
  const fromInterview = digest(structureOf(venture, interview, composition, owned));
  const planned = carryOver(structureOf(venture, interview, composition, owned), latestBlueprint(state, venture.id), venture.acceptedBlueprintId !== null, venture.country);
  const plannedHash = digest(planned);

  // With no AI serving the main tier the port takes the template route; for a composed plan that is a clear refusal,
  // never a record built from two template offers and four template steps.
  const fromTemplate = composition
    ? (): BlueprintModelOutput => { throw new ChausarError('NO_MODEL_CONNECTED', COMPOSED_NEEDS_AI); }
    : () => templateWords(venture, planned.serviceType, planned.offers.map(o => o.pricing.model));
  let output: BlueprintModelOutput;
  let by: 'model' | 'template';
  let callIds: string[] = [];
  if (useTemplate) {
    output = fromTemplate();
    by = 'template';
  } else {
    // Before any write. The task carries no amounts and no client data.
    const outcome = await deps.models.generate(ctx, blueprintTask(venture, interview, planned, fromTemplate));
    output = outcome.value;
    by = outcome.by;
    callIds = outcome.callId ? [outcome.callId] : [];
  }

  return ventureAction(deps, ctx, 'prepare', 'blueprint.draft', tx => {
    const current = tx.venture as VentureRecord;
    const currentInterview = interviewOf(tx.state, current.id);
    check(interviewDone(currentInterview), 'INTERVIEW_INCOMPLETE', 'Answer the questions about your price and tax first.');
    const ownedNow = liveOwnerOffers(tx.state, current.id);
    const structureNow = structureOf(current, currentInterview, compositionOf(tx.state, current.id), ownedNow);
    const stale = 'Your plan changed while its words were being written. Write it again.';
    check(digest(structureNow) === fromInterview, 'APPROVAL_STALE', stale);
    const previous = latestBlueprint(tx.state, current.id);
    const structure = carryOver(structureNow, previous, current.acceptedBlueprintId !== null, current.country);
    check(digest(structure) === plannedHash, 'APPROVAL_STALE', stale);
    const words = labelWords(output, by, current, currentInterview, structure, ownedNow);
    const record = assemble(tx, structure, words, by, callIds, nextBlueprintVersion(tx.state, current.id), previous);
    tx.put(record);
    tx.touch({ blueprintId: record.id, status: statusAtLeast(current.status, 'blueprint') });
    tx.emit('blueprint-drafted', { blueprintId: record.id, version: record.version, source: by });
    return blueprintView(tx.state, record, deps.host);
  });
}

/** venture.blueprint.get {} (read): the newest version with its current offer receipts, or null. */
export async function blueprintGet(deps: VentureDeps, ctx: Context, payload: unknown): Promise<BlueprintView | null> {
  exactPayload(payload, []);
  authorize(deps.store, ctx);
  const state = deps.store.read();
  const venture = requireVenture(state);
  const latest = latestBlueprint(state, venture.id);
  return latest ? blueprintView(state, latest, deps.host) : null;
}

/**
 * venture.blueprint.update { patch, basedOn? } (prepare): owner edits make a new draft version. basedOn (4J8): refused
 * APPROVAL_STALE unless the newest plan of the open business is still that one. addOffer and removeOffer (4J8): an
 * offer the owner adds, with no price, or takes out again.
 */
export async function blueprintUpdate(deps: VentureDeps, ctx: Context, payload: unknown): Promise<BlueprintView> {
  const body = exactPayload(payload, ['patch', 'basedOn'], ['patch']);
  const patch = exactPayload(body.patch, PATCH_KEYS);
  check(Object.keys(patch).length > 0, 'INVALID_VENTURE_REQUEST', 'Send at least one change.');
  const basedOn = Object.hasOwn(body, 'basedOn') ? basedOnOf(body.basedOn) : null;
  const adding = has(patch, 'addOffer') ? ownerOfferInput(patch.addOffer) : null;
  return ventureAction(deps, ctx, 'prepare', 'blueprint.update', tx => {
    const venture = tx.venture as VentureRecord;
    const country = venture.country;
    const latest = latestBlueprint(tx.state, venture.id);
    check(latest, 'BLUEPRINT_NOT_FOUND', 'Write your plan first.');
    if (basedOn) check(latest.id === basedOn.blueprintId && latest.digest === basedOn.digest && latest.ventureId === venture.id, 'APPROVAL_STALE', STALE_SUGGESTION);
    const next: BlueprintRecord = { ...structuredClone(latest), ...tx.base('venture-blueprint'), version: nextBlueprintVersion(tx.state, venture.id), status: 'draft' };
    const mirror: InterviewMirror = {};
    if (has(patch, 'name')) next.name = toldByYou(singleLine(patch.name, 'The business name', { min: 2, max: 60 }));
    if (has(patch, 'oneLiner')) next.oneLiner = toldByYou(singleLine(patch.oneLiner, 'The one line summary', { min: 2, max: 160 }));
    if (has(patch, 'customer')) next.customer = toldByYou(singleLine(patch.customer, 'Who it is for', { min: 2, max: 200 }));
    if (has(patch, 'removeOffer')) removeOwnerOffer(tx, next, patch.removeOffer);
    if (has(patch, 'offers')) applyOfferPatches(next, patch.offers, country, mirror);
    if (adding) addOwnerOffer(tx, next, adding);
    syncOwnerOffers(tx, next);
    applyTaxPatch(next.backOffice, patch, country, mirror);
    withTaxInvoiceFields(next.backOffice, country);
    seal(next);
    tx.put(next);
    if (venture.acceptedBlueprintId === null) mirrorIntoInterview(tx, venture, next, mirror);
    tx.touch({ blueprintId: next.id, status: statusAtLeast(venture.status, 'blueprint') });
    tx.emit('blueprint-drafted', { blueprintId: next.id, version: next.version, source: 'owner' });
    return blueprintView(tx.state, next, deps.host);
  });
}

/** venture.blueprint.accept { digest } (approve, inside the app): accepts the newest draft whose digest matches. */
export async function blueprintAccept(deps: VentureDeps, ctx: Context, payload: unknown): Promise<BlueprintView> {
  requireAppChannel(ctx, 'venture.blueprint.accept');
  const body = exactPayload(payload, ['digest'], ['digest']);
  check(typeof body.digest === 'string' && /^[a-f0-9]{64}$/.test(body.digest), 'INVALID_VENTURE_REQUEST', 'Send the digest of the plan you read.');
  return ventureAction(deps, ctx, 'approve', 'blueprint.accept', tx => {
    const venture = tx.venture as VentureRecord;
    const latest = latestBlueprint(tx.state, venture.id);
    check(latest, 'BLUEPRINT_NOT_FOUND', 'Write your plan first.');
    check(latest.status === 'draft' && latest.digest === body.digest && blueprintDigest(latest) === latest.digest, 'APPROVAL_STALE', 'Your plan changed since you read it. Read it again, then accept.');
    const accepted = tx.replace<BlueprintRecord>({ ...latest, status: 'accepted' });
    tx.touch({ acceptedBlueprintId: accepted.id, status: statusAtLeast(venture.status, 'build') });
    ensureTerms(tx, accepted);
    activateTerm(tx, 'offer', { recordId: accepted.id, kind: 'venture-blueprint' });
    // 4J1 (O17): who accepted the plan and when, wherever they did (journal/decisions.ts).
    // rowId: the Today row this version is shown as (views/queue.ts planRows), so a click there is listed once.
    recordDecision(tx, { subject: `plan:${venture.id}`, action: 'accept', who: 'owner', ruleId: null, reason: `Plan version ${accepted.version} accepted.`, rowId: `plan:${venture.id}:${accepted.id}` });
    tx.emit('blueprint-accepted', { blueprintId: accepted.id, version: accepted.version, digest: accepted.digest });
    return blueprintView(tx.state, accepted, deps.host);
  });
}
