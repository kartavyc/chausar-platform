/**
 * SubQ Snap: an experimental decision-model route. Snap does not write text; it returns a
 * probability distribution over named options. Chausar asks it two `choice` questions: which
 * registered calculation answers the question, and which period preset the question names.
 * Decisions API: https://docs.subq.ai/endpoints/decisions-api/ (`POST /v1/systemone`,
 * model `subq-snap-preview`, Bearer key, input tokens billed, `output_tokens` always 0).
 * Only the analytical plan form is supported; branch and customer selectors are never filled.
 */
import { check } from '../contracts.ts';

export const SUBQ_SNAP_ENDPOINT = 'https://api.subq.ai/v1/systemone';
/** Below this confidence the plan asks for clarification instead of acting on the choice. */
export const SNAP_MIN_CONFIDENCE = 0.6;
const NONE_FITS = 'none_fits';
const NO_PERIOD = 'no_period';
const PERIOD = /^p_(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})$/;

const day = (date: Date) => date.toISOString().slice(0, 10);
const utc = (year: number, month: number, date: number) => new Date(Date.UTC(year, month, date));

/** Calendar presets relative to the preview date; the option name carries the exact dates. */
export function periodPresets(today: Date): Record<string, string> {
  const y = today.getUTCFullYear(), m = today.getUTCMonth();
  const fyStart = m >= 3 ? y : y - 1, q = Math.floor(m / 3) * 3;
  const presets: [string, Date, Date][] = [
    ['This calendar month', utc(y, m, 1), utc(y, m + 1, 0)],
    ['Last calendar month', utc(y, m - 1, 1), utc(y, m, 0)],
    ['This calendar quarter', utc(y, q, 1), utc(y, q + 3, 0)],
    ['Last calendar quarter', utc(y, q - 3, 1), utc(y, q, 0)],
    ['This Indian financial year (April to March)', utc(fyStart, 3, 1), utc(fyStart + 1, 2, 31)],
    ['Last Indian financial year (April to March)', utc(fyStart - 1, 3, 1), utc(fyStart, 2, 31)],
  ];
  return Object.fromEntries([[NO_PERIOD, 'The question names no period, or a period not listed here.'],
    ...presets.map(([label, from, to]) => [`p_${day(from)}_${day(to)}`, `${label}: ${day(from)} to ${day(to)}`])]);
}

export function subqSnapPayload(route: { model: string }, instructions: string, input: string, schema: any, schemaName: string, today = new Date()): string {
  const operations: unknown = schema?.properties?.operation?.enum;
  check(schemaName === 'analytical_plan' && Array.isArray(operations) && operations.length > 0 && operations.length < 255,
    'SNAP_PURPOSE_UNSUPPORTED', 'SubQ Snap only chooses a registered calculation and its period. Use a text route for conversations.');
  return JSON.stringify({ model: route.model, state: { instructions, request: JSON.parse(input) }, questions: {
    operation: { type: 'choice', instructions: 'Which registered calculation answers the question? Choose none_fits when none does.',
      criteria: { ...Object.fromEntries((operations as string[]).map(id => [id, null])), [NONE_FITS]: 'No listed calculation answers the question.' } },
    period: { type: 'choice', instructions: 'Which period does the question ask about?', criteria: periodPresets(today) },
  } });
}

function choice(answer: any, options: string[]): { choice: string; confidence: number; ranked: string[] } {
  check(answer && answer.type === 'choice' && typeof answer.choice === 'string' && options.includes(answer.choice)
    && typeof answer.confidence === 'number' && answer.confidence >= 0 && answer.confidence <= 1
    && answer.probabilities && typeof answer.probabilities === 'object', 'INVALID_PLAN', 'The decision model returned an invalid choice.');
  const ranked = options.filter(option => typeof answer.probabilities[option] === 'number')
    .sort((a, b) => answer.probabilities[b] - answer.probabilities[a]);
  return { choice: answer.choice, confidence: answer.confidence, ranked };
}

/** Turns Snap's choices into the gateway's plan shape. The usual plan validator still runs. */
export function parseSubqSnapOutput(data: any, payload: string): { value: unknown; usage?: any } {
  check(!data.detail, 'MODEL_FAILED', 'The provider returned an error rather than a completed response.');
  const asked = JSON.parse(payload).questions;
  const operations = Object.keys(asked.operation.criteria), periods = Object.keys(asked.period.criteria);
  check(data.answers && typeof data.answers === 'object' && Object.keys(data.answers).every(key => ['operation', 'period'].includes(key)),
    'INVALID_PLAN', 'The decision model answered an unasked question.');
  const operation = choice(data.answers.operation, operations), period = choice(data.answers.period, periods);
  const best = operation.choice !== NONE_FITS ? operation.choice : operation.ranked.find(option => option !== NONE_FITS) ?? operations[0];
  const unsure = operation.choice === NONE_FITS || operation.confidence < SNAP_MIN_CONFIDENCE;
  const dates = period.confidence >= SNAP_MIN_CONFIDENCE ? PERIOD.exec(period.choice) : null;
  const clarification = unsure ? 'Please say which calculation you want.'
    : period.choice !== NO_PERIOD && !dates ? 'Please say which period you mean.' : null;
  return { value: { operation: best, period: dates ? { from: dates[1], to: dates[2] } : null, branch: null, customerId: null, clarification },
    usage: { input_tokens: data.usage?.input_tokens, output_tokens: data.usage?.output_tokens ?? 0 } };
}
