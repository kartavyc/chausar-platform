// Chausar venture launcher, core (P1): the interview.
// Two optional opening questions (from a model or the templates), then fixed engine questions about price and
// tax. Every country is asked about tax. Prices and rates are parsed by code, never by a model.
import { authorize, ChausarError, check, type Context } from '../../contracts.ts';
import {
  bpsPercent, copiedTokens, exactPayload, identifier, percentBps, plainText, requireVenture, ventureAction,
} from '../records.ts';
import { INTERVIEW_IDS, SERVICE_TYPES } from '../contracts.ts';
import type {
  CountryProfile, InterviewAnswer, InterviewModelOutput, InterviewQuestion, InterviewRecord, InterviewView, Json,
  ModelTask, PricingModel, ServiceType, VentureDeps, VentureRecord,
} from '../contracts.ts';
import { taxWord } from './countries.ts';
import { interviewOf } from './lookups.ts';
import { classifyIdea, serviceTemplate, type ServiceTemplate } from './service-types.ts';
import { flagshipPlan } from '../playbooks/plan.ts';
import { optionalFlag, ownerPrice, styledWords } from './words.ts';

export type StoredQuestion = InterviewRecord['questions'][number];

export const INTERVIEW_LIMIT = 6;
export const PRICING_MODELS: readonly PricingModel[] = Object.freeze(['monthly', 'project', 'hourly'] as const);
export const UNIT_OF: Readonly<Record<PricingModel, 'month' | 'project' | 'hour'>> = Object.freeze({ monthly: 'month', project: 'project', hourly: 'hour' });

export const INTERVIEW_INSTRUCTIONS = "You help a new owner plan a service business. Pick the service type that fits the idea. Write one or two short questions whose answers would most change the plan. Never write digits, prices, percentages or amounts: Chausar's calculator handles every number. Use plain words, no dashes, no hype.";

/** Passed to the model port exactly; it has no number types and no keywords beyond the closed list. */
export const INTERVIEW_SCHEMA: Json = {
  type: 'object', additionalProperties: false, required: ['serviceType', 'questions'],
  properties: {
    serviceType: { type: 'string', enum: ['agency', 'studio', 'consulting', 'bookkeeping', 'research', 'content', 'support', 'other'] },
    questions: {
      type: 'array', items: {
        type: 'object', additionalProperties: false,
        required: ['field', 'kind', 'text', 'choices'],
        properties: {
          field: { type: 'string', enum: ['customer', 'first-offer', 'channel'] },
          kind: { type: 'string', enum: ['choice', 'text'] },
          text: { type: 'string', description: 'One short question. No digits, prices or amounts.' },
          choices: { type: 'array', items: { type: 'string', description: 'A short answer label. No digits.' } },
        },
      },
    },
  },
};

export function isPricingModel(value: unknown): value is PricingModel {
  return typeof value === 'string' && (PRICING_MODELS as readonly string[]).includes(value);
}

export function priceQuestionText(model: PricingModel, currency: string): string {
  return `What will you charge for one ${UNIT_OF[model]}, in ${currency}? You can change it later.`;
}

/** The country's rate as percent text for the owner to keep, or null when it varies or is unknown. */
export function taxRatePrefill(country: CountryProfile): string | null {
  return country.tax.standardRateBps === '0' ? null : bpsPercent(country.tax.standardRateBps);
}

function taxQuestionText(country: CountryProfile): string {
  const mode = country.tax.mode;
  if (mode === 'gst' || mode === 'vat') return `Are you registered for ${taxWord(country.tax.label)}, so you charge it on your invoices?`;
  if (mode === 'sales-tax') return 'Do you charge sales tax on your invoices?';
  return 'Do you charge any tax on your invoices?';
}

/**
 * Fixed engine questions, in order: pricing model, price, tax. q_tax_rate is added only after a yes on q_tax. lead puts
 * one pricing choice first: a flagship playbook's first offer is sold per project or per month, so its own way leads.
 */
export function engineQuestions(country: CountryProfile, model: PricingModel = 'monthly', lead: PricingModel | null = null): InterviewQuestion[] {
  const choices = [{ id: 'monthly', label: 'Per month' }, { id: 'project', label: 'Per project' }, { id: 'hourly', label: 'Per hour' }];
  if (lead) choices.sort((a, b) => Number(b.id === lead) - Number(a.id === lead));
  return [
    {
      id: INTERVIEW_IDS.pricingModel, kind: 'choice', field: 'pricing-model', text: 'How will you charge?',
      choices,
      by: 'engine', required: true, prefill: null,
    },
    { id: INTERVIEW_IDS.price, kind: 'money', field: 'price', text: priceQuestionText(model, country.currency), choices: [], by: 'engine', required: false, prefill: null },
    { id: INTERVIEW_IDS.tax, kind: 'yesno', field: 'tax-registered', text: taxQuestionText(country), choices: [], by: 'engine', required: true, prefill: null },
  ];
}

export function taxRateQuestion(country: CountryProfile): InterviewQuestion {
  return {
    id: INTERVIEW_IDS.taxRate, kind: 'rate', field: 'tax-rate', text: `What ${taxWord(country.tax.label)} rate do you charge, in percent?`,
    choices: [], by: 'engine', required: true, prefill: taxRatePrefill(country),
  };
}

/** The two opening questions as stored questions: q_1, then q_2 when present. Choice ids are c_1, c_2, ... */
export function openingQuestions(output: InterviewModelOutput, by: 'model' | 'template'): InterviewQuestion[] {
  return output.questions.slice(0, 2).map((q, index) => ({
    id: index === 0 ? INTERVIEW_IDS.first : INTERVIEW_IDS.second,
    kind: q.kind,
    field: q.field,
    text: q.text,
    choices: q.kind === 'choice' ? q.choices.map((label, i) => ({ id: `c_${i + 1}`, label })) : [],
    by,
    required: false,
    prefill: null,
  }));
}

/**
 * The template interview the plan preview fills inline, q_tax_rate included (shown only after a yes). lead: a flagship
 * playbook's first offer pricing, asked first and priced in its unit.
 */
export function previewQuestions(template: ServiceTemplate, country: CountryProfile, lead: PricingModel | null = null): InterviewQuestion[] {
  return [...openingQuestions(templateInterview(template), 'template'), ...engineQuestions(country, lead ?? 'monthly', lead), taxRateQuestion(country)];
}

export function templateInterview(template: ServiceTemplate): InterviewModelOutput {
  return { serviceType: template.type, questions: template.questions.map(q => ({ ...q, choices: [...q.choices] })) };
}

export function storedQuestion(question: InterviewQuestion): StoredQuestion {
  return { ...question, answer: null, answerMinor: null, answerBps: null, answeredAt: null };
}

function plainQuestion(question: StoredQuestion): InterviewQuestion {
  return {
    id: question.id, kind: question.kind, field: question.field, text: question.text,
    choices: question.choices.map(c => ({ ...c })), by: question.by, required: question.required, prefill: question.prefill,
  };
}

export function interviewDone(interview: InterviewRecord): boolean {
  return interview.questions.length > 0 && interview.questions.every(q => q.answer !== null);
}

export function interviewView(interview: InterviewRecord): InterviewView {
  const next = interview.questions.find(q => q.answer === null);
  return {
    interview,
    next: next ? plainQuestion(next) : null,
    done: interviewDone(interview),
    asked: interview.questions.filter(q => q.answer !== null).length,
    limit: INTERVIEW_LIMIT,
  };
}

/** Local authority over what the interview model returned. Refuses with MODEL_OUTPUT_REJECTED. */
export function validateInterviewOutput(raw: unknown, allowed: readonly string[]): InterviewModelOutput {
  const code = 'MODEL_OUTPUT_REJECTED';
  const body = exactPayload(raw, ['serviceType', 'questions'], ['serviceType', 'questions'], code);
  check(typeof body.serviceType === 'string' && (SERVICE_TYPES as readonly string[]).includes(body.serviceType), code, 'The AI chose a service type Chausar does not know.');
  check(Array.isArray(body.questions) && body.questions.length >= 1 && body.questions.length <= 2, code, 'The AI should write one or two questions.');
  const questions = (body.questions as unknown[]).map(item => {
    const q = exactPayload(item, ['field', 'kind', 'text', 'choices'], ['field', 'kind', 'text', 'choices'], code);
    check(q.field === 'customer' || q.field === 'first-offer' || q.field === 'channel', code, 'The AI asked about something Chausar does not plan for.');
    check(q.kind === 'choice' || q.kind === 'text', code, 'The AI wrote a question Chausar cannot show.');
    const text = styledWords(q.text, 'question', 160, allowed);
    check(Array.isArray(q.choices), code, 'The AI wrote answer choices Chausar cannot show.');
    const given = q.choices as unknown[];
    let choices: string[] = [];
    if (q.kind === 'choice') {
      check(given.length >= 2 && given.length <= 4, code, 'A choice question needs two to four answers.');
      choices = given.map(label => styledWords(label, 'answer choice', 60, allowed));
    } else {
      check(given.length === 0, code, 'A question with a typed answer has no choices.');
    }
    return { field: q.field as 'customer' | 'first-offer' | 'channel', kind: q.kind as 'choice' | 'text', text, choices };
  });
  return { serviceType: body.serviceType as ServiceType, questions };
}

export function interviewTask(venture: VentureRecord, template: () => InterviewModelOutput): ModelTask<InterviewModelOutput> {
  const allowed = copiedTokens(venture.idea);
  return {
    purpose: 'interview',
    instructions: INTERVIEW_INSTRUCTIONS,
    input: { idea: venture.idea, country: venture.country.name, currency: venture.country.currency, serviceTypes: [...SERVICE_TYPES] },
    schemaName: 'venture-interview',
    schema: structuredClone(INTERVIEW_SCHEMA),
    validate: raw => validateInterviewOutput(raw, allowed),
    template,
    containsClientData: false,
    maxOutputTokens: 2048,
  };
}

// ---------------------------------------------------------------------------
// Answers
// ---------------------------------------------------------------------------

type ParsedAnswer = { answer: InterviewAnswer; answerMinor: string | null; answerBps: string | null };
const ANSWER_KEYS = ['choiceId', 'text', 'amount', 'yes', 'rate', 'skipped', 'assumed'] as const;

/**
 * Checks one answer against its question's kind. Exactly one answer field; skipping only optional questions. The one
 * exception is { yes: false, assumed: true } on the tax question: the owner gave no answer and a screen filled the
 * default, so the plan keeps it as an assumption until the owner confirms it.
 */
export function parseAnswer(question: StoredQuestion, value: unknown, country: CountryProfile): ParsedAnswer {
  const given = exactPayload(value, ANSWER_KEYS);
  const keys = Object.keys(given).filter(name => name !== 'assumed');
  check(keys.length === 1, 'INVALID_VENTURE_REQUEST', 'Send exactly one answer.');
  const key = keys[0];
  if (Object.hasOwn(given, 'assumed')) {
    check(given.assumed === true && question.id === INTERVIEW_IDS.tax && key === 'yes' && given.yes === false, 'INVALID_VENTURE_REQUEST',
      'Only the tax answer can be assumed, and only as not charging tax.');
    return { answer: { yes: false, assumed: true }, answerMinor: null, answerBps: null };
  }
  if (key === 'skipped') {
    check(given.skipped === true, 'INVALID_VENTURE_REQUEST', 'Send skipped as true to skip a question.');
    check(!question.required, 'INVALID_VENTURE_REQUEST', 'This question needs an answer.');
    return { answer: { skipped: true }, answerMinor: null, answerBps: null };
  }
  const wrongKind = 'This answer does not fit the question.';
  switch (question.kind) {
    case 'choice': {
      check(key === 'choiceId', 'INVALID_VENTURE_REQUEST', wrongKind);
      const choiceId = given.choiceId;
      check(typeof choiceId === 'string' && question.choices.some(c => c.id === choiceId), 'INVALID_VENTURE_REQUEST', 'Choose one of the answers given.');
      return { answer: { choiceId }, answerMinor: null, answerBps: null };
    }
    case 'text': {
      check(key === 'text', 'INVALID_VENTURE_REQUEST', wrongKind);
      return { answer: { text: plainText(given.text, 'Your answer', { min: 1, max: 300 }) }, answerMinor: null, answerBps: null };
    }
    case 'money': {
      check(key === 'amount', 'INVALID_VENTURE_REQUEST', wrongKind);
      const price = ownerPrice(given.amount, country.currency);
      return { answer: { amount: price.text }, answerMinor: price.minor, answerBps: null };
    }
    case 'yesno': {
      check(key === 'yes' && typeof given.yes === 'boolean', 'INVALID_VENTURE_REQUEST', 'Answer yes or no.');
      return { answer: { yes: given.yes as boolean }, answerMinor: null, answerBps: null };
    }
    case 'rate': {
      check(key === 'rate', 'INVALID_VENTURE_REQUEST', wrongKind);
      const bps = percentBps(given.rate, 'Your tax rate');
      return { answer: { rate: bpsPercent(bps) }, answerMinor: null, answerBps: bps };
    }
    default:
      throw new ChausarError('INVALID_VENTURE_REQUEST', wrongKind);
  }
}

/** Stores an answer on a question of a draft interview, with the follow-on changes it implies. */
export function storeAnswer(interview: InterviewRecord, questionId: string, parsed: ParsedAnswer, country: CountryProfile, at: string): void {
  const question = interview.questions.find(q => q.id === questionId);
  check(question, 'QUESTION_NOT_FOUND', 'That question is not part of this interview.');
  question.answer = parsed.answer;
  question.answerMinor = parsed.answerMinor;
  question.answerBps = parsed.answerBps;
  question.answeredAt = at;
  if (questionId === INTERVIEW_IDS.pricingModel) {
    const model = isPricingModel(parsed.answer.choiceId) ? parsed.answer.choiceId : 'monthly';
    const price = interview.questions.find(q => q.id === INTERVIEW_IDS.price);
    if (price) price.text = priceQuestionText(model, country.currency);
  }
  if (questionId === INTERVIEW_IDS.tax) {
    const hasRate = interview.questions.some(q => q.id === INTERVIEW_IDS.taxRate);
    if (parsed.answer.yes === true && !hasRate) interview.questions.push(storedQuestion(taxRateQuestion(country)));
    if (parsed.answer.yes !== true && hasRate) interview.questions = interview.questions.filter(q => q.id !== INTERVIEW_IDS.taxRate);
  }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/** venture.interview.next { useTemplate? } (prepare). Writes the questions once; later calls return them. */
export async function interviewNext(deps: VentureDeps, ctx: Context, payload: unknown): Promise<InterviewView> {
  const body = exactPayload(payload, ['useTemplate']);
  const useTemplate = optionalFlag(body, 'useTemplate');
  authorize(deps.store, ctx, 'prepare');
  const state = deps.store.read();
  const venture = requireVenture(state);
  const existing = interviewOf(state, venture.id);
  if (existing.questions.length > 0) return interviewView(existing);

  const template = serviceTemplate(classifyIdea(venture.idea));
  const fromTemplate = () => templateInterview(template);
  let output: InterviewModelOutput;
  let by: 'model' | 'template';
  let callIds: string[] = [];
  if (useTemplate) {
    output = fromTemplate();
    by = 'template';
  } else {
    // Before any write. When templates serve the fast tier, the port returns the template and sends nothing.
    const outcome = await deps.models.generate(ctx, interviewTask(venture, fromTemplate));
    output = outcome.value;
    by = outcome.by;
    callIds = outcome.callId ? [outcome.callId] : [];
  }

  return ventureAction(deps, ctx, 'prepare', 'interview.generate', tx => {
    const venture = tx.venture as VentureRecord;
    const current = interviewOf(tx.state, venture.id);
    if (current.questions.length > 0) return interviewView(current);
    // A flagship playbook keeps its own base type and asks its first offer's pricing first (playbooks/plan.ts).
    const flagship = flagshipPlan(venture.idea);
    const lead = flagship?.offers[0]?.model ?? null;
    const serviceType = flagship?.serviceType ?? output.serviceType;
    const questions = [...openingQuestions(output, by), ...engineQuestions(venture.country, lead ?? 'monthly', lead)].map(storedQuestion);
    const record: InterviewRecord = {
      ...current,
      serviceType: { value: serviceType, label: 'assumption', by },
      questions,
      modelCallIds: [...current.modelCallIds, ...callIds],
      source: by,
    };
    tx.replace(record);
    tx.touch({ serviceType });
    tx.emit('interview-updated', { source: by, questions: questions.length });
    return interviewView(record);
  });
}

/** venture.interview.answer { questionId, answer } (prepare). Answers may change until the plan is accepted. */
export async function interviewAnswer(deps: VentureDeps, ctx: Context, payload: unknown): Promise<InterviewView> {
  const body = exactPayload(payload, ['questionId', 'answer'], ['questionId', 'answer']);
  const questionId = identifier(body.questionId, 'The question');
  return ventureAction(deps, ctx, 'prepare', 'interview.answer', tx => {
    const venture = tx.venture as VentureRecord;
    check(venture.acceptedBlueprintId === null, 'INTERVIEW_DONE', 'Your plan is accepted. Change it on the plan instead.');
    const interview = interviewOf(tx.state, venture.id);
    const question = interview.questions.find(q => q.id === questionId);
    check(question, 'QUESTION_NOT_FOUND', 'That question is not part of this interview.');
    const parsed = parseAnswer(question, body.answer, venture.country);
    storeAnswer(interview, questionId, parsed, venture.country, tx.now);
    tx.replace(interview);
    tx.emit('interview-updated', { questionId });
    return interviewView(interview);
  });
}
