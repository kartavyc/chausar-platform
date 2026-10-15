/**
 * AS-11 what-ifs and AS-13 the best plan under limits (experimental).
 *
 * A what-if changes one assumption through the published price scenario; the calculator holds
 * volume constant and never writes a fact. Its figures are labelled "what if".
 *
 * The plan tries each price change in a stated range through the same published scenario, one
 * receipt per step, and keeps the steps that meet every limit. It recommends the feasible step
 * with the highest scenario revenue, says which limit is tight there, or, when none meets all,
 * which limits clash. Exact integers only.
 */
import { check, type Context } from '../contracts.ts';
import type { ModuleHost } from '../modules/types.ts';
import type { CalculationReceipt } from '../calculator.ts';
import type { Period } from '../memory.ts';
import type { PlanReply, WhatIfReply } from './contracts.ts';
import { checkStop, stopToken } from './round4.ts';
import { businessToday, core, currentDictionary, identifier, input, list, minorString, namedPeriod, period, requireId , openReceipt } from './shared.ts';

function periodFrom(host: ModuleHost, request: Record<string, any>): Period {
  return request.period !== undefined ? period(request.period) : namedPeriod(request.periodId ?? 'last-month', businessToday(host, request.today));
}
function scenarioReady(host: ModuleHost, ctx: Context) {
  const dictionary = currentDictionary(host, ctx);
  check(dictionary, 'ASK_NO_DICTIONARY', 'Publish what your words mean before asking for numbers.');
  check(dictionary.operations.some(o => o.id === 'scenario' && o.type === 'scenario'), 'ASK_NO_CALCULATION', 'The price what-if needs a published earned definition.');
}
const figure = (receipt: CalculationReceipt, key: string) => {
  const found = receipt.figures.find(f => f.key === key); check(found, 'ASK_REFUSED', 'The scenario did not return its figures.'); return found.minor;
};
async function scenario(host: ModuleHost, p: Period, bps: string, branch?: string) {
  return core<CalculationReceipt>(host, 'calculation.run', { operation: 'scenario', period: p, assumptions: { priceChangeBps: bps }, ...(branch === undefined ? {} : { branch }) });
}

export async function whatIf(ctx: Context, payload: unknown, host: ModuleHost): Promise<WhatIfReply> {
  const request = input(payload, ['period', 'periodId', 'priceChangeBps', 'branch', 'today'], ['priceChangeBps']);
  scenarioReady(host, ctx);
  const p = periodFrom(host, request), bps = minorString(request.priceChangeBps);
  const branch = request.branch === undefined || request.branch === null ? undefined : (check(identifier(request.branch), 'ASK_INVALID', 'Choose a branch by its name.'), request.branch as string);
  const receipt = await scenario(host, p, bps, branch);
  return { label: 'what-if', assumption: { name: 'price', beforeBps: '0', afterBps: bps },
    books: { minor: figure(receipt, 'baseline'), receiptId: receipt.id }, withChange: { minor: figure(receipt, 'scenario'), receiptId: receipt.id },
    change: { minor: figure(receipt, 'change'), receiptId: receipt.id }, period: p, branch: branch ?? null };
}

export async function plan(ctx: Context, payload: unknown, host: ModuleHost): Promise<PlanReply> {
  const request = input(payload, ['period', 'periodId', 'limits', 'fromBps', 'toBps', 'stepBps', 'today'], ['limits', 'fromBps', 'toBps', 'stepBps']);
  scenarioReady(host, ctx);
  const p = periodFrom(host, request);
  const limits = list(request.limits, 10, (entry, index) => {
    const limit = input(entry, ['figure', 'op', 'minor'], ['figure', 'op', 'minor']);
    check(['scenario', 'change'].includes(limit.figure) && ['atLeast', 'atMost'].includes(limit.op), 'ASK_INVALID', 'A limit names the scenario or the change, and at least or at most.');
    return { index, figure: limit.figure as 'scenario' | 'change', op: limit.op as 'atLeast' | 'atMost', minor: minorString(limit.minor) };
  });
  check(limits.length > 0, 'ASK_INVALID', 'State at least one limit.');
  const from = BigInt(minorString(request.fromBps)), to = BigInt(minorString(request.toBps)), step = BigInt(minorString(request.stepBps));
  check(step > 0n && from <= to && (to - from) / step <= 40n, 'ASK_INVALID', 'Try at most forty-one price steps, from the lower to the higher change.');
  const meets = (limit: (typeof limits)[number], scenarioMinor: bigint, changeMinor: bigint) => {
    const value = limit.figure === 'scenario' ? scenarioMinor : changeMinor, bound = BigInt(limit.minor);
    return limit.op === 'atLeast' ? value >= bound : value <= bound;
  };
  const tried: { bps: bigint; scenario: bigint; change: bigint; receiptId: string; ok: boolean[] }[] = [];
  const token = stopToken(ctx, host);
  for (let bps = from; bps <= to; bps += step) {
    checkStop(token);
    const receipt = await scenario(host, p, String(bps));
    const s = BigInt(figure(receipt, 'scenario')), c = BigInt(figure(receipt, 'change'));
    tried.push({ bps, scenario: s, change: c, receiptId: receipt.id, ok: limits.map(limit => meets(limit, s, c)) });
  }
  const feasible = tried.filter(t => t.ok.every(Boolean));
  const best = feasible.reduce<(typeof tried)[number] | null>((top, t) => top === null || t.scenario > top.scenario || t.scenario === top.scenario && (t.bps < 0n ? -t.bps : t.bps) < (top.bps < 0n ? -top.bps : top.bps) ? t : top, null);
  // Tight: moving one step further in the direction that would raise revenue breaks this limit.
  const nextUp = best ? tried.find(t => t.bps === best.bps + step) ?? null : null, nextDown = best ? tried.find(t => t.bps === best.bps - step) ?? null : null;
  const tight = (i: number) => best !== null && [nextUp, nextDown].some(t => t !== null && !t.ok[i] && t.scenario >= best.scenario);
  const alone = (i: number) => tried.some(t => t.ok[i]);
  // Clash: every limit can be met on its own somewhere, yet no step meets all of them.
  const clash = best ? [] : limits.filter(limit => alone(limit.index)).map(limit => limit.index);
  return { label: 'experimental', feasible: best !== null, tried: tried.length, clash,
    limits: limits.map(limit => ({ ...limit, tight: tight(limit.index), alone: alone(limit.index) })),
    recommended: best ? { bps: String(best.bps), scenarioMinor: String(best.scenario), changeMinor: String(best.change), receiptId: best.receiptId } : null };
}

/** A saved what-if read back from its receipt, under current access. */
export async function whatIfGet(ctx: Context, payload: unknown, host: ModuleHost): Promise<WhatIfReply> {
  const request = input(payload, ['receiptId'], ['receiptId']);
  const receipt = await openReceipt(host, ctx, request.receiptId);
  check(receipt.operation === 'scenario' && receipt.period, 'ASK_NOT_FOUND', 'This is not a what-if.');
  return { label: 'what-if', assumption: { name: 'price', beforeBps: '0', afterBps: figure(receipt, 'priceChangeBps') },
    books: { minor: figure(receipt, 'baseline'), receiptId: receipt.id }, withChange: { minor: figure(receipt, 'scenario'), receiptId: receipt.id },
    change: { minor: figure(receipt, 'change'), receiptId: receipt.id }, period: receipt.period, branch: receipt.branch };
}
