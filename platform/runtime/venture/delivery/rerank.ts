// Chausar delivery (Ink v2 wave 4, 4J14, catalogue Q23): preference sliders. venture.options.rerank re-orders options
// code already scored by the owner's own weights, in code, with no AI call. The scored options are a run's hooks
// (W2 2E's scorer, playbooks/youtube/checks.ts): each has five properties from 0 to 100, and a weight from 0 to 10 per
// property gives a weighted mean. A hook below the scorer's floor fails its check: no weight lifts it, it stays in the
// list, last, marked failed, and still goes to review.
//
// Ideas taken, code written here: bridgeclip's editorial weights, which re-rank judged options without asking again.
import { check, type Context } from '../../contracts.ts';
import type { RankedOptionView, RerankView, ToolCallRecord, VentureDeps, WorkTableRecord } from '../contracts.ts';
import { exactPayload, findRecord, identifier, listRecords } from '../records.ts';
import { HOOK_FLOOR, hookScore, sameHook, YOUTUBE_TABLES, type HookProperty } from '../playbooks/youtube/checks.ts';
import { readAs } from './shared.ts';

const PROPERTIES: readonly HookProperty[] = Object.freeze(['specificity', 'address', 'stakes', 'curiosity', 'brevity']);
export const MAX_WEIGHT = 10;

/** The owner's weights: only the five properties, each a whole number from 0 to 10, at least one above 0; a missing one is 0. */
export function readWeights(value: unknown): Record<HookProperty, number> {
  check(value !== null && typeof value === 'object' && !Array.isArray(value), 'INVALID_VENTURE_REQUEST', 'Send the weights as one number per property.');
  const given = value as Record<string, unknown>;
  const weights = Object.fromEntries(PROPERTIES.map(key => [key, 0])) as Record<HookProperty, number>;
  for (const [key, weight] of Object.entries(given)) {
    check((PROPERTIES as readonly string[]).includes(key), 'INVALID_VENTURE_REQUEST', `Weigh only ${PROPERTIES.join(', ')}.`);
    check(Number.isInteger(weight) && (weight as number) >= 0 && (weight as number) <= MAX_WEIGHT, 'INVALID_VENTURE_REQUEST', `Give each weight as a whole number from 0 to ${MAX_WEIGHT}.`);
    weights[key as HookProperty] = weight as number;
  }
  check(PROPERTIES.some(key => weights[key] > 0), 'INVALID_VENTURE_REQUEST', 'Give at least one weight above 0.');
  return weights;
}

/**
 * The hooks a scorer's table came from, in the order they were written: the cleaned words its own call answered with
 * (kept and the others), else the kept hooks in the table itself.
 */
function scoredHooks(table: WorkTableRecord, calls: readonly ToolCallRecord[]): string[] {
  const made = calls.find(item => item.tool === YOUTUBE_TABLES.hooks.tool && item.outcome === 'succeeded' && item.tableIds.includes(table.id));
  const answer = made?.envelope.ok ? made.envelope.result as { kept?: unknown; others?: unknown } | null : null;
  const fromAnswer = [answer?.kept, answer?.others].flatMap(list => (Array.isArray(list) ? list : []))
    .flatMap(item => (typeof (item as { hook?: unknown } | null)?.hook === 'string' ? [(item as { hook: string }).hook] : []));
  const hooks = fromAnswer.length ? fromAnswer : table.rows.map(row => row.cells.Hook ?? '').filter(hook => hook.trim());
  const written = Array.isArray((made?.input as { hooks?: unknown } | null)?.hooks) ? (made!.input as { hooks: unknown[] }).hooks.filter((hook): hook is string => typeof hook === 'string') : [];
  const order = (hook: string) => { const at = written.findIndex(item => sameHook(item, hook)); return at < 0 ? written.length + hooks.indexOf(hook) : at; };
  return [...hooks].sort((a, b) => order(a) - order(b));
}

/** Whole-number weighted mean of the five properties, rounded half up. */
function weighted(properties: Record<HookProperty, number>, weights: Record<HookProperty, number>): number {
  const sum = PROPERTIES.reduce((total, key) => total + weights[key], 0);
  const total = PROPERTIES.reduce((acc, key) => acc + weights[key] * properties[key], 0);
  return Math.floor((2 * total + sum) / (2 * sum));
}

/**
 * venture.options.rerank { questionId, weights } (read): questionId is the table a scorer made in a run. Every hook it
 * scored is scored again by the same code and ordered: passing hooks first by the owner's weighted score (ties: the
 * scorer's own score, then the order written), then failures, which always go to review. Nothing is stored or sent.
 */
export async function optionsRerankHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<RerankView> {
  const body = exactPayload(payload, ['questionId', 'weights'], ['questionId', 'weights']);
  const questionId = identifier(body.questionId, 'Question');
  const weights = readWeights(body.weights);
  const { state, venture } = readAs(deps, ctx, 'read');
  const table = findRecord(state, 'venture-work-table', questionId);
  check(table && table.ventureId === venture.id && table.source.kind === 'computed' && table.source.tool === YOUTUBE_TABLES.hooks.tool,
    'QUESTION_NOT_FOUND', 'Those scored options were not found.');
  const runId = table.runRef.kind === 'rehearsal' ? null : table.runRef.runId;
  const run = runId ? listRecords(state, 'venture-delivery-run', venture.id).find(item => item.id === runId) : undefined;
  const hooks = scoredHooks(table, run?.harness?.toolCalls ?? []);
  check(hooks.length > 0, 'QUESTION_NOT_FOUND', 'Those scored options were not found.');
  const ranked = hooks.map((hook, index) => {
    const score = hookScore(hook);
    return { index, verdict: score.verdict, failed: score.verdict < HOOK_FLOOR, view: {
      id: `${table.id}.${index + 1}`, label: `Hook ${index + 1}`, text: score.hook, score: weighted(score.properties, weights), estimate: null, failed: score.verdict < HOOK_FLOOR,
    } satisfies RankedOptionView };
  }).sort((a, b) => (a.failed ? 1 : 0) - (b.failed ? 1 : 0) || b.view.score - a.view.score || b.verdict - a.verdict || a.index - b.index);
  return { options: ranked.map(item => item.view) };
}
