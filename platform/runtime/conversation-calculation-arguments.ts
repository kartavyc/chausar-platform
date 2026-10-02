import { check, hash } from './contracts.ts';
import type { Period } from './memory.ts';

/** Trusted host input retained with the exact owner-approved planner payload.
 * Never populate this from model output or imported source text. */
export type ReviewedConversationCalculationParameters = {
  period?: Period;
  comparePeriod?: Period;
  assumptions?: { priceChangeBps: string };
};
export type ConversationCalculationArguments = {
  operation: string; period?: Period; branch?: string; customerId?: string;
  comparePeriod?: Period; assumptions?: { priceChangeBps: string };
};
export type ConversationCalculationContext = {
  operations: readonly string[];
  selectors?: { branches?: readonly string[]; customerIds?: readonly string[] };
  reviewedCalculationParameters?: ReviewedConversationCalculationParameters;
};

const INVALID = 'INVALID_CONVERSATION_PLAN';
const BASE_KEYS = ['operation', 'period', 'branch', 'customerId'] as const;
const SCENARIO_PATTERN = '^-?[0-9]+$';
export const OWNER_REQUESTED_SCENARIO_LABEL = 'Owner-requested price assumption in basis points; scenario only, not a measured fact.';

function plain(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}
function fields(value: unknown, allowed: readonly string[], required: readonly string[] = allowed): asserts value is Record<string, unknown> {
  check(plain(value) && Object.getOwnPropertySymbols(value).length === 0
    && Object.keys(value).every(key => allowed.includes(key)) && required.every(key => Object.hasOwn(value, key)),
  INVALID, 'Calculation parameters have missing or undeclared fields.');
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    check(allowed.includes(key) && descriptor.enumerable && Object.hasOwn(descriptor, 'value'), INVALID, 'Calculation parameters must contain plain data fields.');
  }
}
function validDay(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString().slice(0, 10) === value;
}
function period(value: unknown): Period {
  fields(value, ['from', 'to']);
  check(validDay(value.from) && validDay(value.to) && value.from <= value.to, INVALID, 'Select an exact inclusive calendar period.');
  return { from: value.from, to: value.to };
}
function assumptions(value: unknown): { priceChangeBps: string } {
  fields(value, ['priceChangeBps']);
  check(typeof value.priceChangeBps === 'string' && value.priceChangeBps.length <= 20000 && new RegExp(SCENARIO_PATTERN).test(value.priceChangeBps),
    INVALID, 'A price assumption must be an exact integer string in basis points.');
  const bps = BigInt(value.priceChangeBps);
  check(bps >= -10000n && bps <= 100000n, INVALID, 'The price assumption is outside the existing calculator range.');
  return { priceChangeBps: value.priceChangeBps };
}

/** Also use at host request admission, before preview/approval. Copies only
 * backend-supported parameters; malformed host inputs never unlock an op. */
export function validateReviewedConversationCalculationParameters(raw: unknown): ReviewedConversationCalculationParameters {
  fields(raw, ['period', 'comparePeriod', 'assumptions'], []);
  const result: ReviewedConversationCalculationParameters = {};
  if (Object.hasOwn(raw, 'period')) result.period = period(raw.period);
  if (Object.hasOwn(raw, 'comparePeriod')) result.comparePeriod = period(raw.comparePeriod);
  if (Object.hasOwn(raw, 'assumptions')) result.assumptions = assumptions(raw.assumptions);
  return result;
}
function reviewed(context: ConversationCalculationContext): ReviewedConversationCalculationParameters {
  return validateReviewedConversationCalculationParameters(context.reviewedCalculationParameters === undefined ? {} : context.reviewedCalculationParameters);
}

/** These local plain questions are safe to use for missing-input clarification.
 * The validator never turns a model execution call into implicit approval. */
export function conversationCalculationClarification(operation: string, parameters: ReviewedConversationCalculationParameters = {}): string | null {
  const input = validateReviewedConversationCalculationParameters(parameters);
  if (operation === 'change') {
    if (!input.period && !input.comparePeriod) return 'Which current and comparison periods should I use?';
    if (!input.period) return 'Which current period should I use?';
    if (!input.comparePeriod) return 'Which comparison period should I use?';
  }
  if (operation === 'scenario' && !input.assumptions) return 'What price change in basis points should I assume?';
  return null;
}

/** Exact disclosure for the gateway to bind into preview, approval and receipt.
 * Values here are owner inputs, never amounts inferred from workspace facts. */
export function conversationCalculationParameterDisclosure(parameters: ReviewedConversationCalculationParameters = {}) {
  const input = validateReviewedConversationCalculationParameters(parameters);
  return {
    kind: 'owner-requested-calculation-parameters' as const,
    period: input.period ?? null, comparePeriod: input.comparePeriod ?? null,
    assumptions: input.assumptions ? { origin: 'owner-requested' as const, label: OWNER_REQUESTED_SCENARIO_LABEL, ...input.assumptions } : null,
    missingInputClarifications: { change: conversationCalculationClarification('change', input), scenario: conversationCalculationClarification('scenario', input) },
  };
}

export function validateConversationCalculationArguments(raw: unknown, context: ConversationCalculationContext): ConversationCalculationArguments {
  check(plain(raw) && Object.hasOwn(raw, 'operation'), INVALID, 'The planner must select a registered calculation.');
  const descriptor = Object.getOwnPropertyDescriptor(raw, 'operation');
  check(descriptor && Object.hasOwn(descriptor, 'value'), INVALID, 'The operation must be a plain data field.');
  const operation = descriptor.value;
  check(typeof operation === 'string' && context.operations.includes(operation), INVALID, 'The planner selected an unregistered calculation.');
  fields(raw, operation === 'change' ? [...BASE_KEYS, 'comparePeriod'] : operation === 'scenario' ? [...BASE_KEYS, 'assumptions'] : BASE_KEYS);
  const input = reviewed(context), args: ConversationCalculationArguments = { operation };
  if (raw.period !== null) args.period = period(raw.period);
  if (raw.branch !== null) {
    check(typeof raw.branch === 'string' && context.selectors?.branches?.includes(raw.branch), INVALID, 'The planner selected an unavailable branch.');
    args.branch = raw.branch;
  }
  if (raw.customerId !== null) {
    check(typeof raw.customerId === 'string' && context.selectors?.customerIds?.includes(raw.customerId), INVALID, 'The planner selected an unavailable customer.');
    args.customerId = raw.customerId;
  }
  if (input.period) check(args.period && hash(args.period) === hash(input.period), INVALID, 'The planner changed the exact reviewed period.');
  if (operation === 'change') {
    check(conversationCalculationClarification(operation, input) === null, INVALID, 'Clarify the missing reviewed current or comparison period.');
    args.comparePeriod = period(raw.comparePeriod);
    check(hash(args.comparePeriod) === hash(input.comparePeriod), INVALID, 'The planner changed the exact reviewed comparison period.');
  }
  if (operation === 'scenario') {
    check(conversationCalculationClarification(operation, input) === null, INVALID, 'Clarify the missing owner-requested price assumption.');
    args.assumptions = assumptions(raw.assumptions);
    check(hash(args.assumptions) === hash(input.assumptions), INVALID, 'The planner changed the exact owner-requested price assumption.');
  }
  return args;
}

/** Disjoint wire objects keep ordinary calls' original four required fields.
 * New operations exist in the schema only with their exact reviewed inputs. */
export function conversationCalculationArgumentSchemas(context: ConversationCalculationContext) {
  const input = reviewed(context);
  const strings = (values: readonly string[]) => values.length ? { type: 'string', enum: [...new Set(values)] } : { not: {} };
  const selector = (values: readonly string[] = []) => ({ anyOf: [{ type: 'null' }, strings(values)] });
  const calendarPeriod = (pin?: Period) => ({ type: 'object', additionalProperties: false, required: ['from', 'to'], properties: {
    from: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', format: 'date', ...(pin ? { enum: [pin.from] } : {}) },
    to: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', format: 'date', ...(pin ? { enum: [pin.to] } : {}) },
  } });
  const base = { period: input.period ? calendarPeriod(input.period) : { anyOf: [{ type: 'null' }, calendarPeriod()] },
    branch: selector(context.selectors?.branches), customerId: selector(context.selectors?.customerIds) };
  const legacy = { type: 'object', additionalProperties: false, required: [...BASE_KEYS], properties: {
    operation: strings(context.operations.filter(id => id !== 'change' && id !== 'scenario')), ...base,
  } };
  const comparison = context.operations.includes('change') && input.period && input.comparePeriod ? {
    type: 'object', additionalProperties: false, required: [...BASE_KEYS, 'comparePeriod'], properties: {
      operation: strings(['change']), ...base, comparePeriod: calendarPeriod(input.comparePeriod),
    },
  } : undefined;
  const scenario = context.operations.includes('scenario') && input.assumptions ? {
    type: 'object', additionalProperties: false, required: [...BASE_KEYS, 'assumptions'], properties: {
      operation: strings(['scenario']), ...base, assumptions: { type: 'object', additionalProperties: false, required: ['priceChangeBps'],
        description: OWNER_REQUESTED_SCENARIO_LABEL, properties: { priceChangeBps: { type: 'string', pattern: SCENARIO_PATTERN,
          enum: [input.assumptions.priceChangeBps], description: 'Exact signed integer basis points requested by the owner; range minus ten thousand through one hundred thousand.' } } },
    },
  } : undefined;
  return { legacy, comparison, scenario };
}
