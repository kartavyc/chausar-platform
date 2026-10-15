// Chausar venture launcher, core (P1): the blueprint (the one-page plan).
// Code makes the structure (offers and their pricing, steps, approval count, back office, starter connectors)
// from the interview; a model or the templates only write words into named slots. The structure is hashed before
// the model writes and again inside the write, so nothing moves while it writes (APPROVAL_STALE otherwise).
import { authorize, check, type Context } from '../../contracts.ts';
import {
  activateTerm, bpsPercent, copiedTokens, digest, exactPayload, percentBps, requireAppChannel, requireVenture, singleLine,
  tidyWords, ventureAction, type VentureTx,
} from '../records.ts';
import { APPROVAL_COUNT, INTERVIEW_IDS, OFFER_IDS, SECOND_OFFER_MODEL, STARTER_CONNECTORS, STEP_IDS, STEP_PLAN } from '../contracts.ts';
import type {
  BackOffice, BlueprintModelOutput, BlueprintRecord, BlueprintStep, BlueprintView, CountryProfile, InterviewRecord, Json,
  Labelled, ModelTask, Offer, PricingModel, ServiceType, TermRecord, VentureDeps, VentureRecord, VentureStatus,
} from '../contracts.ts';
import { interviewDone, isPricingModel, priceQuestionText, storedQuestion, taxRateQuestion, UNIT_OF } from './interview.ts';
import { blueprintView, interviewOf, latestBlueprint, nextBlueprintVersion } from './lookups.ts';
import { offerWords, serviceTemplate } from './service-types.ts';
import { cleanSacCode, cleanTaxId, cleanTaxState, withTaxInvoiceFields } from './tax-fields.ts';
import { DEFAULT_WORKING_NAME, labelled, optionalFlag, ownerPrice, styledWords, toldByYou } from './words.ts';

// ---------------------------------------------------------------------------
// Structure (pure, code-made)
// ---------------------------------------------------------------------------

export type BlueprintStructure = {
  serviceType: ServiceType;
  offers: { id: string; pricing: Offer['pricing'] }[];
  steps: { id: string; doneBy: BlueprintStep['doneBy']; capability: BlueprintStep['capability']; note: string }[];
  approvals: number;
  backOffice: BackOffice;
  starterConnectorIds: string[];
};

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

/** The code-made structure from the venture and its interview answers. Pure. */
export function structureOf(venture: VentureRecord, interview: InterviewRecord): BlueprintStructure {
  const country = venture.country;
  const type = venture.serviceType ?? interview.serviceType.value;
  const answerOf = (id: string) => interview.questions.find(q => q.id === id);
  const chosen = answerOf(INTERVIEW_IDS.pricingModel)?.answer?.choiceId;
  const model: PricingModel = isPricingModel(chosen) ? chosen : 'monthly';
  const price = answerOf(INTERVIEW_IDS.price)?.answerMinor ?? null;
  const registered = answerOf(INTERVIEW_IDS.tax)?.answer?.yes === true;
  const rate = answerOf(INTERVIEW_IDS.taxRate)?.answerBps ?? null;
  const standard = country.tax.standardRateBps;
  const backOffice = previewBackOffice(country);
  backOffice.taxRegistered = toldByYou(registered);
  if (registered) {
    backOffice.taxRateBps = rate ?? '0';
    backOffice.taxRateBy = rate !== null && standard !== '0' && rate === standard ? 'country-table' : 'told-by-you';
  }
  withTaxInvoiceFields(backOffice, country);
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
  return {
    serviceType: blueprint.serviceType,
    offers: blueprint.offers.map(o => ({ id: o.id, pricing: o.pricing })),
    steps: blueprint.deliverySteps.map(s => ({ id: s.id, doneBy: s.doneBy, capability: s.capability, note: s.note })),
    approvals: blueprint.approvals.length,
    backOffice: blueprint.backOffice,
    starterConnectorIds: blueprint.starterConnectorIds,
  };
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
  for (const id of interviewClosed ? OFFER_IDS : [OFFER_IDS[1]]) {
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

/** Local authority over the blueprint words. Ids must come back exactly; every string is checked words. */
export function validateBlueprintOutput(raw: unknown, allowed: readonly string[]): BlueprintModelOutput {
  const code = 'MODEL_OUTPUT_REJECTED';
  const keys = ['name', 'oneLiner', 'customer', 'offers', 'steps', 'approvals'];
  const body = exactPayload(raw, keys, keys, code);
  const name = styledWords(body.name, 'business name', 60, allowed);
  const oneLiner = styledWords(body.oneLiner, 'one line summary', 160, allowed);
  const customer = styledWords(body.customer, 'customer line', 200, allowed);
  check(Array.isArray(body.offers) && body.offers.length === OFFER_IDS.length, code, 'The AI changed the offers in the plan.');
  const offers = (body.offers as unknown[]).map((item, index) => {
    const offer = exactPayload(item, ['id', 'name', 'description'], ['id', 'name', 'description'], code);
    check(offer.id === OFFER_IDS[index], code, 'The AI changed the offers in the plan.');
    return { id: OFFER_IDS[index] as string, name: styledWords(offer.name, 'offer name', 60, allowed), description: styledWords(offer.description, 'offer description', 200, allowed) };
  });
  check(Array.isArray(body.steps) && body.steps.length === STEP_IDS.length, code, 'The AI changed the steps in the plan.');
  const steps = (body.steps as unknown[]).map((item, index) => {
    const step = exactPayload(item, ['id', 'title'], ['id', 'title'], code);
    check(step.id === STEP_IDS[index], code, 'The AI changed the steps in the plan.');
    return { id: STEP_IDS[index] as string, title: styledWords(step.title, 'step title', 80, allowed) };
  });
  check(Array.isArray(body.approvals) && body.approvals.length === APPROVAL_COUNT, code, 'The AI changed what you approve.');
  const approvals = (body.approvals as unknown[]).map(item => styledWords(item, 'approval', 120, allowed));
  return { name, oneLiner, customer, offers, steps, approvals };
}

/**
 * Template words for the plan; the name is the owner's working name. Each offer is worded for how it is charged in
 * the structure (the owner's choice for offer_1), so an hourly offer never reads 'Monthly ...'.
 */
export function templateWords(venture: VentureRecord, type: ServiceType, models?: readonly PricingModel[]): BlueprintModelOutput {
  const template = serviceTemplate(type);
  return {
    name: venture.workingName,
    oneLiner: template.oneLiner,
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

export function blueprintTask(venture: VentureRecord, interview: InterviewRecord, structure: BlueprintStructure, template: () => BlueprintModelOutput): ModelTask<BlueprintModelOutput> {
  const allowed = copiedTokens(venture.idea, ...typedAnswers(interview));
  return {
    purpose: 'blueprint',
    instructions: BLUEPRINT_INSTRUCTIONS,
    input: {
      idea: venture.idea,
      serviceType: structure.serviceType,
      country: venture.country.name,
      answers: openingAnswers(interview),
      structure: {
        offers: structure.offers.map(o => ({ id: o.id, pricingModel: o.pricing.model })),
        steps: structure.steps.map(s => ({ id: s.id, doneBy: s.doneBy })),
        approvals: APPROVAL_COUNT,
      },
    },
    schemaName: 'venture-blueprint',
    schema: structuredClone(BLUEPRINT_SCHEMA),
    validate: raw => validateBlueprintOutput(raw, allowed),
    template,
    containsClientData: false,
    maxOutputTokens: 4096,
  };
}

/** Who the business is for, in the owner's own words, when they typed it as text. */
function ownerCustomer(interview: InterviewRecord): string | null {
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
};

function labelWords(output: BlueprintModelOutput, by: 'model' | 'template', venture: VentureRecord, interview: InterviewRecord): PlanWords {
  const say = (value: string) => labelled(value, 'assumption', by);
  const name = by === 'model'
    ? say(output.name)
    : venture.workingName === DEFAULT_WORKING_NAME ? labelled(venture.workingName, 'assumption', 'template') : toldByYou(venture.workingName);
  const typed = ownerCustomer(interview);
  return {
    name,
    oneLiner: say(output.oneLiner),
    customer: typed ? toldByYou(typed) : say(output.customer),
    offers: output.offers.map(o => ({ name: say(o.name), description: say(o.description) })),
    steps: output.steps.map(s => say(s.title)),
    approvals: output.approvals.map(say),
  };
}

function assemble(tx: VentureTx, structure: BlueprintStructure, words: PlanWords, source: 'model' | 'template', modelCallIds: string[], version: number): BlueprintRecord {
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
    offers: structure.offers.map((o, index) => ({ id: o.id, name: words.offers[index].name, description: words.offers[index].description, pricing: structuredClone(o.pricing) })),
    deliverySteps: structure.steps.map((s, index) => ({ id: s.id, title: words.steps[index], doneBy: s.doneBy, capability: s.capability, note: s.note })),
    approvals: words.approvals,
    backOffice: structuredClone(structure.backOffice),
    starterConnectorIds: [...structure.starterConnectorIds],
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

const PATCH_KEYS = ['name', 'oneLiner', 'customer', 'taxRegistered', 'taxRate', 'taxId', 'taxState', 'sacCode', 'lutConfirmed', 'offers'] as const;
const OFFER_PATCH_KEYS = ['id', 'name', 'description', 'unitPrice', 'pricingModel'] as const;

/** What an edit changed that the open interview also holds, so the two stay the same. */
type InterviewMirror = { pricingModel?: PricingModel; price?: { text: string; minor: string } | null; tax?: boolean };

function applyOfferPatches(blueprint: BlueprintRecord, value: unknown, country: CountryProfile, mirror: InterviewMirror): void {
  check(Array.isArray(value) && value.length >= 1 && value.length <= OFFER_IDS.length, 'INVALID_VENTURE_REQUEST', 'Send one change for each offer you edit.');
  const seen = new Set<string>();
  for (const item of value as unknown[]) {
    const change = exactPayload(item, OFFER_PATCH_KEYS, ['id']);
    const id = change.id;
    check(typeof id === 'string' && (OFFER_IDS as readonly string[]).includes(id) && !seen.has(id), 'INVALID_VENTURE_REQUEST', 'Name each offer once, as offer_1 or offer_2.');
    seen.add(id);
    check(Object.keys(change).length > 1, 'INVALID_VENTURE_REQUEST', 'Send at least one change for the offer.');
    const offer = blueprint.offers.find(o => o.id === id);
    check(offer, 'OFFER_NOT_FOUND', 'That offer is not in your plan.');
    if (has(change, 'name')) offer.name = toldByYou(singleLine(change.name, 'The offer name', { min: 2, max: 60 }));
    if (has(change, 'description')) offer.description = toldByYou(singleLine(change.description, 'The offer description', { min: 2, max: 200 }));
    if (has(change, 'pricingModel')) {
      const model = change.pricingModel;
      check(isPricingModel(model), 'INVALID_VENTURE_REQUEST', 'Choose per month, per project or per hour.');
      offer.pricing.model = model;
      offer.pricing.quantityUnit = UNIT_OF[model];
      // Template words follow the new pricing; the owner's own words and the AI's words stay as they are.
      const words = offerWords(blueprint.serviceType, OFFER_IDS.indexOf(id as typeof OFFER_IDS[number]), model);
      if (!has(change, 'name') && offer.name.by === 'template') offer.name = labelled(words.name, 'assumption', 'template');
      if (!has(change, 'description') && offer.description.by === 'template') offer.description = labelled(words.description, 'assumption', 'template');
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

function applyTaxPatch(backOffice: BackOffice, patch: Record<string, unknown>, country: CountryProfile, mirror: InterviewMirror): void {
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
  const interview = interviewOf(state, venture.id);
  check(interviewDone(interview), 'INTERVIEW_INCOMPLETE', 'Answer the questions about your price and tax first.');
  const fromInterview = digest(structureOf(venture, interview));
  const planned = carryOver(structureOf(venture, interview), latestBlueprint(state, venture.id), venture.acceptedBlueprintId !== null, venture.country);
  const plannedHash = digest(planned);

  const fromTemplate = () => templateWords(venture, planned.serviceType, planned.offers.map(o => o.pricing.model));
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
    const structureNow = structureOf(current, currentInterview);
    const stale = 'Your plan changed while its words were being written. Write it again.';
    check(digest(structureNow) === fromInterview, 'APPROVAL_STALE', stale);
    const structure = carryOver(structureNow, latestBlueprint(tx.state, current.id), current.acceptedBlueprintId !== null, current.country);
    check(digest(structure) === plannedHash, 'APPROVAL_STALE', stale);
    const words = labelWords(output, by, current, currentInterview);
    const record = assemble(tx, structure, words, by, callIds, nextBlueprintVersion(tx.state, current.id));
    tx.put(record);
    tx.touch({ blueprintId: record.id, status: statusAtLeast(current.status, 'blueprint') });
    tx.emit('blueprint-drafted', { blueprintId: record.id, version: record.version, source: by });
    return blueprintView(tx.state, record);
  });
}

/** venture.blueprint.get {} (read): the newest version with its current offer receipts, or null. */
export async function blueprintGet(deps: VentureDeps, ctx: Context, payload: unknown): Promise<BlueprintView | null> {
  exactPayload(payload, []);
  authorize(deps.store, ctx);
  const state = deps.store.read();
  const venture = requireVenture(state);
  const latest = latestBlueprint(state, venture.id);
  return latest ? blueprintView(state, latest) : null;
}

/** venture.blueprint.update { patch } (prepare): owner edits make a new draft version. */
export async function blueprintUpdate(deps: VentureDeps, ctx: Context, payload: unknown): Promise<BlueprintView> {
  const body = exactPayload(payload, ['patch'], ['patch']);
  const patch = exactPayload(body.patch, PATCH_KEYS);
  check(Object.keys(patch).length > 0, 'INVALID_VENTURE_REQUEST', 'Send at least one change.');
  return ventureAction(deps, ctx, 'prepare', 'blueprint.update', tx => {
    const venture = tx.venture as VentureRecord;
    const country = venture.country;
    const latest = latestBlueprint(tx.state, venture.id);
    check(latest, 'BLUEPRINT_NOT_FOUND', 'Write your plan first.');
    const next: BlueprintRecord = { ...structuredClone(latest), ...tx.base('venture-blueprint'), version: nextBlueprintVersion(tx.state, venture.id), status: 'draft' };
    const mirror: InterviewMirror = {};
    if (has(patch, 'name')) next.name = toldByYou(singleLine(patch.name, 'The business name', { min: 2, max: 60 }));
    if (has(patch, 'oneLiner')) next.oneLiner = toldByYou(singleLine(patch.oneLiner, 'The one line summary', { min: 2, max: 160 }));
    if (has(patch, 'customer')) next.customer = toldByYou(singleLine(patch.customer, 'Who it is for', { min: 2, max: 200 }));
    if (has(patch, 'offers')) applyOfferPatches(next, patch.offers, country, mirror);
    applyTaxPatch(next.backOffice, patch, country, mirror);
    withTaxInvoiceFields(next.backOffice, country);
    seal(next);
    tx.put(next);
    if (venture.acceptedBlueprintId === null) mirrorIntoInterview(tx, venture, next, mirror);
    tx.touch({ blueprintId: next.id, status: statusAtLeast(venture.status, 'blueprint') });
    tx.emit('blueprint-drafted', { blueprintId: next.id, version: next.version, source: 'owner' });
    return blueprintView(tx.state, next);
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
    tx.emit('blueprint-accepted', { blueprintId: accepted.id, version: accepted.version, digest: accepted.digest });
    return blueprintView(tx.state, accepted);
  });
}
