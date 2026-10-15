/**
 * AS-12: a forecast that says how much to trust it, shown only when it beats the simple baseline.
 *
 * One receipt per complete calendar month of history is worked out through the published sum.
 * The engine's forecast evaluation then backtests the linear trend against the last observed
 * month on the latest months, held back one at a time. When the trend's error is lower, the next
 * month's trend value is the answer, with a range from the largest held-back error; otherwise
 * the baseline is the answer and the page says so. Under 24 months there is no test at all.
 *
 * The evaluation runs in the engine's restated-diagnostic mode: it scores the current books'
 * view of past months, not what was known at the time. The method line says so.
 */
import { check, hash, now, type Context, type State } from '../contracts.ts';
import type { ModuleHost } from '../modules/types.ts';
import { canSeeFact } from '../memory.ts';
import type { CalculationReceipt } from '../calculator.ts';
import type { SavedForecastEvaluation } from '../forecast-contracts.ts';
import type { AskState, ForecastReply } from './contracts.ts';
import { addMonths, askState, businessToday, peekAsk, codeOf, core, currentDictionary, input, monthEnd, monthStart, translate } from './shared.ts';
import { operationOf } from './menu.ts';
import { checkStop, stopToken } from './round4.ts';

export const NEEDED_MONTHS = 24;
const HELD_BACK = 6;

/** Exact least-squares line through (0, y0) … (n-1, yn-1), evaluated at x, truncated toward zero. */
export function trendAt(values: readonly bigint[], x: bigint): bigint {
  const n = BigInt(values.length); check(n >= 2n, 'ASK_INVALID', 'A trend needs at least two months.');
  let sx = 0n, sy = 0n, sxy = 0n, sxx = 0n;
  values.forEach((y, i) => { const xi = BigInt(i); sx += xi; sy += y; sxy += xi * y; sxx += xi * xi; });
  const slopeN = n * sxy - sx * sy, slopeD = n * sxx - sx * sx;
  // value = (sy - slope*sx)/n + slope*x = (sy*D - N*sx + N*x*n) / (n*D)
  return (sy * slopeD - slopeN * sx + slopeN * x * n) / (n * slopeD);
}

const truncate = (exact: { numerator: string; denominator: string } | null) => exact === null ? null : String(BigInt(exact.numerator) / BigInt(exact.denominator));

export async function forecast(ctx: Context, payload: unknown, host: ModuleHost): Promise<ForecastReply> {
  const request = input(payload, ['operationId', 'today'], ['operationId']);
  const dictionary = currentDictionary(host, ctx);
  check(dictionary, 'ASK_NO_DICTIONARY', 'Publish what your words mean before asking for numbers.');
  const operation = operationOf(dictionary, request.operationId);
  check(operation, 'ASK_NO_CALCULATION', 'No published calculation has this name.');
  check(operation.type === 'sum' && (operation.definitions.length === 1 || operation.id === 'net_sales'), 'ASK_NOT_FORECASTABLE', 'Only a published sum of money can be forecast.');
  const today = businessToday(host, request.today), kinds = new Set(dictionary.definitions.filter(d => operation.definitions.includes(d.name)).map(d => d.kind));
  const state = host.store.read(), member = state.members.find(m => m.id === ctx.memberId);
  // A forecast covers every branch, or the one branch a seat holds; anything else is a rule, said before any work.
  const branch = member?.branches.includes('*') ? null : member?.branches.length === 1 ? member.branches[0]! : undefined;
  check(branch !== undefined, 'ASK_STOPPED_BY_RULE', 'A rule in Trust stops this answer for your seat.');
  const facts = state.facts.filter(f => kinds.has(f.kind) && !f.deletedAt && !f.supersededAt && (branch === null || f.branch === branch) && canSeeFact(host.store, ctx, f));
  const first = facts.map(f => f.validFrom.slice(0, 7)).sort()[0];
  const [ty, tm] = [Number(today.slice(0, 4)), Number(today.slice(5, 7))], [ly, lm] = addMonths(ty, tm, -1);
  const months: [number, number][] = [];
  if (first) { let [y, m] = [Number(first.slice(0, 4)), Number(first.slice(5, 7))]; while (y * 12 + m <= ly * 12 + lm && months.length < 240) { months.push([y, m]); [y, m] = addMonths(y, m, 1); } }
  if (months.length < NEEDED_MONTHS) return { state: 'not-enough-history', months: months.length, needed: NEEDED_MONTHS };
  const sourceIds = [...new Set(facts.map(f => f.sourceId))].sort();
  // The same inputs give the same receipts: reuse them rather than adding a receipt per month per run.
  const definitionHash = hash(dictionary.definitions.filter(d => operation.definitions.includes(d.name)));
  const key = runKey(state, ctx, { operationId: operation.id, branch, sourceIds, dictionaryHash: dictionary.hash, definitionHash, kinds: [...kinds].sort(), months: months.map(([y, m]) => monthStart(y, m)) });
  const previous = peekAsk(state).forecastRuns?.find(run => run.key === key && run.memberId === ctx.memberId);
  const token = stopToken(ctx, host);
  let history = previous ? await reopen(host, previous.receipts) : null;
  const reused = history !== null;
  const asOf = reused ? previous!.asOf : now();
  if (!history) {
    history = [];
    for (const [y, m] of months) {
      checkStop(token);
      const receipt = await core<CalculationReceipt>(host, 'calculation.run', { operation: operation.id, sourceIds, period: { from: monthStart(y, m), to: monthEnd(y, m) }, asOf, ...(branch === null ? {} : { branch }) });
      history.push({ month: monthStart(y, m).slice(0, 7), minor: receipt.valueMinor, receiptId: receipt.id });
    }
  }
  const held = history.slice(-HELD_BACK), origins = held.map((target, k) => {
    const cutoffIndex = history.length - HELD_BACK + k - 1, [cy, cm] = months[cutoffIndex]!, [ny, nm] = addMonths(cy, cm, 1);
    return { id: `origin-${k + 1}`, eventCutoff: monthEnd(cy, cm), knowledgeCut: `${monthStart(ny, nm)}T00:00:00.000Z`,
      trainingReceiptIds: history.slice(0, cutoffIndex + 1).map(h => h.receiptId), targets: [{ horizonMonths: 1, receiptId: target.receiptId }] };
  });
  let evaluation: SavedForecastEvaluation | null = null;
  // A saved evaluation is reused only when the engine replays it and its evidence still verifies.
  if (reused && previous!.evaluationId) { try { evaluation = await host.call('forecasts.get', { id: previous!.evaluationId }) as SavedForecastEvaluation; } catch { evaluation = null; } }
  checkStop(token);
  if (!evaluation) try {
    evaluation = await host.call('forecasts.evaluate', { version: 1, mode: 'restated-diagnostic', operation: operation.id, dictionaryHash: dictionary.hash, sourceIds, branch,
      horizonsMonths: [1], cadenceMonths: 1, minimumTrainingMonths: 12, method: 'linear-trend-v1', benchmark: 'last-observed-v1', availabilityLagMs: 0, origins }) as SavedForecastEvaluation;
  } catch (error) {
    const code = codeOf(error);
    if (['FORECAST_COVERAGE_GAP', 'FORECAST_GAP', 'FORECAST_HISTORY_REQUIRED'].includes(code)) return { state: 'cannot-test', code: 'ASK_FORECAST_GAPS' };
    throw translate(error);
  }
  if (ctx.role !== 'viewer') await remember(host, ctx, { key, memberId: ctx.memberId, asOf, receipts: history.map(h => ({ month: h.month, receiptId: h.receiptId })), evaluationId: evaluation.id, at: now() });
  const horizon = evaluation.horizons[0]!, wins = horizon.comparison === 'lower-absolute-error';
  const values = history.map(h => BigInt(h.minor)), next = trendAt(values, BigInt(values.length));
  const spread = evaluation.folds.reduce((top, fold) => { const e = BigInt(fold.candidate.absoluteErrorMinor); return e > top ? e : top; }, 0n);
  const [fy, fm] = addMonths(ly, lm, 1);
  return {
    state: 'ready', answer: wins ? 'forecast' : 'baseline', operationId: operation.id, label: operation.label, history,
    heldBack: evaluation.folds.map(fold => ({ month: fold.targetPeriod.from.slice(0, 7), actualMinor: fold.actualMinor, forecastMinor: fold.candidate.minor, baselineMinor: fold.benchmark.minor })),
    error: { forecastMinor: truncate(horizon.candidate.meanAbsoluteErrorMinor), baselineMinor: truncate(horizon.benchmark.meanAbsoluteErrorMinor) },
    next: { month: monthStart(fy, fm).slice(0, 7), forecastMinor: wins ? String(next) : null, baselineMinor: history.at(-1)!.minor, rangeMinor: wins ? String(spread) : null },
    method: { forecast: 'linear-trend-v1', baseline: 'last-observed-v1', learnedFrom: { from: history[0]!.month, to: history.at(-1)!.month },
      testedOn: { from: held[0]!.month, to: held.at(-1)!.month } },
    evaluationId: evaluation.id, label2: 'projection', reused,
  };
}

type Run = NonNullable<AskState['forecastRuns']>[number];
/** The inputs a monthly receipt depends on: the definitions, the scope, the months, and every
 *  version of every row of those kinds in those sources, with the imports and precedence rules. */
function runKey(state: State, ctx: Context, scope: Record<string, unknown> & { sourceIds: string[]; kinds: string[] }) {
  const sources = new Set(scope.sourceIds), kinds = new Set(scope.kinds);
  // Only rows this seat may see, in its scope: a hidden change never shows through `reused`.
  const view = { read: () => state, update: async () => { throw new Error('read-only'); } };
  const rows = state.facts.filter(f => sources.has(f.sourceId) && kinds.has(f.kind) && (scope.branch === null || f.branch === scope.branch) && canSeeFact(view, ctx, f)).map(f => [f.id, f.learnedAt, f.supersededAt, f.deletedAt ?? null, f.validFrom, f.branch ?? null]);
  const imports = state.imports.filter(i => sources.has(i?.sourceId)).map(i => [i.id, i.coverage?.reconciled === true]);
  const rules = state.sourceRules.filter(r => kinds.has(r?.kind)).map(r => [r.kind, r.sourceIds, r.at]);
  return hash({ member: ctx.memberId, epoch: ctx.epoch, scope, sourceDigest: hash({ rows, imports, rules, tombstones: state.tombstones.length }) });
}
/** Reopens every retained receipt under current access; any that is gone or stale means work again. */
async function reopen(host: ModuleHost, receipts: Run['receipts']) {
  const out: { month: string; minor: string; receiptId: string }[] = [];
  for (const entry of receipts) {
    try {
      const receipt = await host.call('receipts.get', { id: entry.receiptId }) as CalculationReceipt;
      if (receipt.stale) return null;
      out.push({ month: entry.month, minor: receipt.valueMinor, receiptId: receipt.id });
    } catch { return null; }
  }
  return out;
}
async function remember(host: ModuleHost, ctx: Context, run: Run) {
  await host.store.update(state => {
    const own = askState(state), runs = (own.forecastRuns ??= []);
    const index = runs.findIndex(r => r.key === run.key && r.memberId === ctx.memberId);
    if (index >= 0) runs.splice(index, 1);
    runs.push(run);
    const mine = runs.filter(r => r.memberId === ctx.memberId);
    if (mine.length > 20) runs.splice(runs.indexOf(mine[0]!), 1);
  });
}
