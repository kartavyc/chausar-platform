import { isAbsolute } from 'node:path';
import { check, newId, now, type Context, type State } from '../contracts.ts';
import { moduleState, peekModuleState, type MethodSpec, type ModuleHost } from '../modules/types.ts';
import { MODULE_ID, type ModulePart } from './part.ts';
import { OPEN_BENCH, OPEN_BENCH_DIGEST, BENCH_LANGUAGES } from './bench/open-bench.ts';
import { BENCH_ROUTE_KINDS, type BenchRouteKind } from './bench/transcripts.ts';
import { FIXED_BARS, RECOMMENDED_BARS, barsDigest, validateBars, type PassBars } from './bench/bars.ts';
import { replayBench, type RouteRates, type RouteRow } from './bench/replay.ts';
import { LIVE_APPROVAL_MS, assertPlanCurrent, buildPlan, runLive, type LiveApproval, type LiveCall, type LivePlan, type LiveRouteRow, type LiveState } from './bench/live.ts';

type StatedBars = { bars: PassBars; digest: string; setAt: string; setBy: string };
type ResultBase = {
  id: string; schema: 'chausar.route-bench-result.v1'; startedAt: string; finishedAt: string; by: string;
  bench: { version: number; digest: string; cases: number; languages: readonly string[] };
  bars: PassBars; barsDigest: string; barsSetAt: string; runs: number;
};
type OfflineResult = ResultBase & { mode: 'offline-replay'; recorded: 'synthetic' | 'live' | 'mixed' | 'none'; routes: RouteRow[] };
type LiveResult = ResultBase & { mode: 'live'; recorded: 'live'; plan: { id: string; digest: string }; approvalId: string; caseIds: string[]; languages: string[];
  budgetCapMinor: string; budgetCap: string; worstCaseMinor: string; stopped: 'budget-cap' | null; committedMinor: string; committed: string;
  leftUndone: LiveCall[]; skipped: LivePlan['skipped']; notLive: LivePlan['notLive']; notes: string[]; routes: LiveRouteRow[] };
type BenchResult = OfflineResult | LiveResult;
type BenchState = { bars: StatedBars | null; results: BenchResult[]; live?: LiveState };
const HISTORY = 20;

function benchOf(state: State): BenchState {
  const ns = moduleState<Record<string, any>>(state, MODULE_ID, () => ({}));
  return ns.bench ??= { bars: null, results: [] };
}
function liveOf(state: State): LiveState { return benchOf(state).live ??= { plans: [], approvals: [] }; }
function peekBench(state: State): BenchState | undefined { return peekModuleState<Record<string, any>>(state, MODULE_ID)?.bench; }
function only(payload: Record<string, unknown>, keys: string[]) {
  check(payload && typeof payload === 'object' && !Array.isArray(payload) && Object.keys(payload).every(key => keys.includes(key)), 'BENCH_INVALID', 'This bench request has an undeclared field.');
}

/** Rates come from the workspace's own configured route of each kind; without both rates cost is not counted. */
function configuredRates(state: State): Partial<Record<BenchRouteKind, RouteRates>> {
  const rates: Partial<Record<BenchRouteKind, RouteRates>> = {};
  for (const route of [...state.routes].filter(r => r.enabled && r.inputPerMillionMinor && r.outputPerMillionMinor).sort((a, b) => a.priority - b.priority || (a.id < b.id ? -1 : 1)))
    if (BENCH_ROUTE_KINDS.includes(route.kind) && !rates[route.kind as BenchRouteKind]) rates[route.kind as BenchRouteKind] = { routeId: route.id, inputPerMillionMinor: route.inputPerMillionMinor, outputPerMillionMinor: route.outputPerMillionMinor };
  return rates;
}

const cases: MethodSpec = { permission: 'read', handler(_ctx: Context, payload) {
  only(payload, []);
  return { schema: OPEN_BENCH.schema, version: OPEN_BENCH.version, digest: OPEN_BENCH_DIGEST, origin: OPEN_BENCH.origin, languages: BENCH_LANGUAGES,
    shop: { source: OPEN_BENCH.shopSource, csv: OPEN_BENCH.shopCsv }, cases: structuredClone(OPEN_BENCH.cases) };
} };

const passBars: MethodSpec = { permission: 'read', handler(_ctx, payload, host: ModuleHost) {
  only(payload, []);
  const stated = peekBench(host.store.read())?.bars ?? null;
  return { ...(stated ? structuredClone(stated) : { bars: null, digest: null, setAt: null, setBy: null }), recommended: RECOMMENDED_BARS, fixed: FIXED_BARS };
} };

const setPassBars: MethodSpec = { permission: 'admin', async handler(ctx, payload, host) {
  const bars = validateBars(payload), digest = barsDigest(bars);
  return host.store.update(state => {
    const bench = benchOf(state);
    if (bench.bars?.digest !== digest) bench.bars = { bars, digest, setAt: now(), setBy: ctx.memberId };
    return structuredClone(bench.bars);
  });
} };

function checkBarsDigest(value: unknown, stated: StatedBars | null | undefined): asserts stated is StatedBars {
  check(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value), 'BENCH_BARS_REQUIRED', 'State the pass bars and pass their digest before the run.');
  check(stated, 'BENCH_BARS_REQUIRED', 'State the pass bars before the run.');
  check(stated.digest === value, 'BENCH_BARS_CHANGED', 'The pass bars changed since they were stated. Review the current bars and start again.');
}
const benchInfo = () => ({ version: OPEN_BENCH.version, digest: OPEN_BENCH_DIGEST, cases: OPEN_BENCH.cases.length, languages: BENCH_LANGUAGES });

function keep(host: ModuleHost, barsDigest: string, result: BenchResult) {
  return host.store.update(state => {
    const bench = benchOf(state);
    check(bench.bars?.digest === barsDigest, 'BENCH_BARS_CHANGED', 'The pass bars changed during the run. The result was not kept.');
    bench.results = [result, ...bench.results].slice(0, HISTORY);
    return structuredClone(result);
  });
}

async function compareOffline(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  only(payload, ['routes', 'runs', 'barsDigest', 'live']);
  const routes = payload.routes ?? [...BENCH_ROUTE_KINDS], runs = payload.runs ?? 5;
  check(Array.isArray(routes) && routes.length > 0 && routes.every(r => BENCH_ROUTE_KINDS.includes(r)) && new Set(routes).size === routes.length, 'BENCH_INVALID', 'Choose distinct route kinds from the bench list.');
  check(Number.isInteger(runs) && runs >= 1 && runs <= 5, 'BENCH_INVALID', 'Choose one to five runs.');
  const before = peekBench(host.store.read())?.bars;
  checkBarsDigest(payload.barsDigest, before);
  const transcripts = host.options.benchTranscripts;
  check(transcripts === undefined || typeof transcripts === 'string' && isAbsolute(transcripts), 'BENCH_TRANSCRIPTS_INVALID', 'The trusted transcript folder must be an absolute path.');
  const startedAt = now();
  const rows = await replayBench({ routes, runs, bars: before.bars, rates: configuredRates(host.store.read()), ...(transcripts ? { transcripts } : {}) });
  const labels = new Set(rows.filter(r => r.status === 'scored').map(r => r.recorded));
  const result: OfflineResult = { id: newId('bench'), schema: 'chausar.route-bench-result.v1', mode: 'offline-replay', startedAt, finishedAt: now(), by: ctx.memberId,
    bench: benchInfo(), bars: before.bars, barsDigest: before.digest, barsSetAt: before.setAt, runs, recorded: labels.size === 0 ? 'none' : labels.size > 1 ? 'mixed' : [...labels][0]!, routes: rows };
  return keep(host, before.digest, result);
}

function liveId(value: unknown, what: string) {
  check(typeof value === 'string' && value.length > 0 && value.length <= 200, 'BENCH_INVALID', `Choose one ${what}.`);
}

/** Live comparison of an approved plan: the approval is consumed before the first call and the plan runs once. */
async function compareLive(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  check(!host.demo, 'DEMO_EXTERNAL_DISABLED', 'Synthetic demo mode keeps external systems disabled.');
  only(payload, ['live', 'planId', 'approvalId', 'barsDigest']);
  liveId(payload.planId, 'bench plan'); liveId(payload.approvalId, 'bench plan approval');
  const state = host.store.read(), stated = peekBench(state)?.bars;
  checkBarsDigest(payload.barsDigest, stated);
  const plan = peekBench(state)?.live?.plans.find(p => p.id === payload.planId);
  check(plan, 'BENCH_PLAN_NOT_FOUND', 'That bench plan is not kept. Prepare a new plan.');
  check(plan.createdBy === ctx.memberId && plan.epoch === ctx.epoch, 'FORBIDDEN', 'This bench plan belongs to another account.');
  const gateway = host.services.gateway;
  assertPlanCurrent(plan, gateway.listRoutes(ctx), state, stated.digest, host.demo);
  const startedAt = now();
  await host.store.update(current => {
    const live = liveOf(current), saved = live.plans.find(p => p.id === plan.id), approval = live.approvals.find(a => a.id === payload.approvalId);
    check(approval && approval.planId === plan.id && approval.planDigest === plan.digest, 'BENCH_APPROVAL_NOT_FOUND', 'Approve exactly this bench plan first.');
    check(!approval.used && saved?.status === 'planned', 'BENCH_APPROVAL_USED', 'This bench plan approval was already used. Prepare and approve a new plan.');
    check(Date.parse(approval.expiresAt) > Date.now(), 'BENCH_APPROVAL_EXPIRED', 'This bench plan approval expired. Approve the plan again.');
    const approver = current.members.find(m => m.id === approval.approverId);
    check(approver?.active && approver.epoch === approval.approverEpoch && ['owner', 'cofounder'].includes(approver.role), 'BENCH_APPROVAL_REVOKED', 'The person who approved this plan no longer has approval rights. Approve the plan again.');
    check(benchOf(current).bars?.digest === plan.barsDigest, 'BENCH_BARS_CHANGED', 'The pass bars changed since the plan was prepared. Prepare a new plan.');
    approval.used = true; saved.status = 'executing';
  });
  let outcome: Awaited<ReturnType<typeof runLive>> | undefined;
  try { outcome = await runLive(ctx, plan, gateway, host.store, stated.bars); }
  finally {
    await host.store.update(current => { const saved = liveOf(current).plans.find(p => p.id === plan.id); if (saved) saved.status = outcome ? 'executed' : 'interrupted'; });
  }
  const result: LiveResult = { id: newId('bench'), schema: 'chausar.route-bench-result.v1', mode: 'live', startedAt, finishedAt: now(), by: ctx.memberId,
    bench: benchInfo(), bars: stated.bars, barsDigest: stated.digest, barsSetAt: stated.setAt, runs: plan.runs, recorded: 'live',
    plan: { id: plan.id, digest: plan.digest }, approvalId: payload.approvalId, caseIds: plan.caseIds, languages: plan.languages,
    budgetCapMinor: plan.budgetCapMinor, budgetCap: plan.budgetCap, worstCaseMinor: plan.worstCaseMinor, stopped: outcome.stopped,
    committedMinor: outcome.committedMinor, committed: outcome.committed, leftUndone: outcome.leftUndone, skipped: plan.skipped, notLive: plan.notLive,
    notes: outcome.notes, routes: outcome.routes };
  return keep(host, stated.digest, result);
}

const compare: MethodSpec = { permission: 'prepare', handler: (ctx, payload, host) => payload?.live === true ? compareLive(ctx, payload, host) : compareOffline(ctx, payload, host) };

/** Prepare: the exact live plan, its digest and its conservative worst-case reservation. Nothing is sent. */
const planLive: MethodSpec = { permission: 'prepare', external: true, async handler(ctx, payload, host) {
  only(payload, ['routeIds', 'caseIds', 'languages', 'runs', 'budgetCapMinor', 'barsDigest']);
  const state = host.store.read(), stated = peekBench(state)?.bars;
  checkBarsDigest(payload.barsDigest, stated);
  const plan = buildPlan(ctx, payload, host.services.gateway.listRoutes(ctx), state, stated, host.demo);
  return host.store.update(current => {
    const live = liveOf(current);
    live.plans = [plan, ...live.plans.filter(p => p.status !== 'planned' || p.createdBy !== ctx.memberId)].slice(0, HISTORY);
    return structuredClone(plan);
  });
} };

/** Approve exactly one plan digest, from the desktop app only. The approval expires and is used once. */
const approveLive: MethodSpec = { permission: 'approve', external: true, async handler(ctx, payload, host) {
  check(ctx.channel === 'desktop' && !ctx.sourceTainted, 'BENCH_APPROVAL_DESKTOP_ONLY', 'Approve a live bench plan inside the desktop app.');
  only(payload, ['planId', 'planDigest']);
  liveId(payload.planId, 'bench plan');
  check(typeof payload.planDigest === 'string' && /^[a-f0-9]{64}$/.test(payload.planDigest), 'BENCH_INVALID', 'Pass the digest of the plan you reviewed.');
  const state = host.store.read(), plan = peekBench(state)?.live?.plans.find(p => p.id === payload.planId);
  check(plan && plan.status === 'planned', 'BENCH_PLAN_NOT_FOUND', 'That bench plan is not waiting for approval. Prepare a new plan.');
  check(plan.digest === payload.planDigest, 'BENCH_PLAN_CHANGED', 'The plan digest differs from the plan you reviewed.');
  assertPlanCurrent(plan, host.services.gateway.listRoutes(ctx), state, peekBench(state)?.bars?.digest, host.demo);
  return host.store.update(current => {
    const live = liveOf(current), at = Date.now();
    check(live.plans.some(p => p.id === plan.id && p.status === 'planned' && p.digest === plan.digest), 'BENCH_PLAN_NOT_FOUND', 'That bench plan is not waiting for approval. Prepare a new plan.');
    const approval: LiveApproval = { id: newId('bench_approval'), planId: plan.id, planDigest: plan.digest, approverId: ctx.memberId, approverEpoch: ctx.epoch,
      createdAt: new Date(at).toISOString(), expiresAt: new Date(at + LIVE_APPROVAL_MS).toISOString(), used: false };
    live.approvals = [approval, ...live.approvals.filter(a => Date.parse(a.expiresAt) > at)].slice(0, HISTORY);
    return structuredClone(approval);
  });
} };

const results: MethodSpec = { permission: 'read', handler(_ctx, payload, host) {
  only(payload, []);
  return { results: (peekBench(host.store.read())?.results ?? []).map(r => ({ id: r.id, mode: r.mode, startedAt: r.startedAt, finishedAt: r.finishedAt, runs: r.runs, recorded: r.recorded,
    barsDigest: r.barsDigest, routes: (r.routes as (RouteRow | LiveRouteRow)[]).map(row => ({ route: row.route, ...('routeId' in row ? { routeId: row.routeId } : {}), status: row.status, passed: row.verdict?.passed ?? null })) })) };
} };

const result: MethodSpec = { permission: 'read', handler(_ctx, payload, host) {
  only(payload, ['id']);
  check(typeof payload.id === 'string' && payload.id.length <= 200, 'BENCH_INVALID', 'Choose one bench result.');
  const found = peekBench(host.store.read())?.results.find(r => r.id === payload.id);
  check(found, 'BENCH_RESULT_NOT_FOUND', 'That bench result is not kept.');
  return structuredClone(found);
} };

export const benchPart: ModulePart = { methods: {
  'bench.cases': cases, 'bench.passBars': passBars, 'bench.setPassBars': setPassBars,
  'bench.compare': compare, 'bench.planLive': planLive, 'bench.approveLive': approveLive, 'bench.results': results, 'bench.result': result,
} };
