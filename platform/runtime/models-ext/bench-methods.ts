import { isAbsolute } from 'node:path';
import { check, newId, now, type Context, type State } from '../contracts.ts';
import { moduleState, peekModuleState, type MethodSpec, type ModuleHost } from '../modules/types.ts';
import { MODULE_ID, type ModulePart } from './part.ts';
import { OPEN_BENCH, OPEN_BENCH_DIGEST, BENCH_LANGUAGES } from './bench/open-bench.ts';
import { BENCH_ROUTE_KINDS, type BenchRouteKind } from './bench/transcripts.ts';
import { FIXED_BARS, RECOMMENDED_BARS, barsDigest, validateBars, type PassBars } from './bench/bars.ts';
import { replayBench, type RouteRates, type RouteRow } from './bench/replay.ts';

type StatedBars = { bars: PassBars; digest: string; setAt: string; setBy: string };
type BenchResult = {
  id: string; schema: 'chausar.route-bench-result.v1'; mode: 'offline-replay'; startedAt: string; finishedAt: string; by: string;
  bench: { version: number; digest: string; cases: number; languages: readonly string[] };
  bars: PassBars; barsDigest: string; barsSetAt: string; runs: number; recorded: 'synthetic' | 'live' | 'mixed' | 'none'; routes: RouteRow[];
};
type BenchState = { bars: StatedBars | null; results: BenchResult[] };
const HISTORY = 20;

function benchOf(state: State): BenchState {
  const ns = moduleState<Record<string, any>>(state, MODULE_ID, () => ({}));
  return ns.bench ??= { bars: null, results: [] };
}
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

const compare: MethodSpec = { permission: 'prepare', async handler(ctx, payload, host) {
  only(payload, ['routes', 'runs', 'barsDigest', 'live']);
  check(payload.live === undefined || payload.live === false, 'BENCH_LIVE_NOT_BUILT', 'Live comparison against real routes is not built. Record transcripts with your own keys and replay them offline.');
  const routes = payload.routes ?? [...BENCH_ROUTE_KINDS], runs = payload.runs ?? 5;
  check(Array.isArray(routes) && routes.length > 0 && routes.every(r => BENCH_ROUTE_KINDS.includes(r)) && new Set(routes).size === routes.length, 'BENCH_INVALID', 'Choose distinct route kinds from the bench list.');
  check(Number.isInteger(runs) && runs >= 1 && runs <= 5, 'BENCH_INVALID', 'Choose one to five runs.');
  check(typeof payload.barsDigest === 'string' && /^[a-f0-9]{64}$/.test(payload.barsDigest), 'BENCH_BARS_REQUIRED', 'State the pass bars and pass their digest before the run.');
  const before = peekBench(host.store.read())?.bars;
  check(before, 'BENCH_BARS_REQUIRED', 'State the pass bars before the run.');
  check(before.digest === payload.barsDigest, 'BENCH_BARS_CHANGED', 'The pass bars changed since they were stated. Review the current bars and start again.');
  const transcripts = host.options.benchTranscripts;
  check(transcripts === undefined || typeof transcripts === 'string' && isAbsolute(transcripts), 'BENCH_TRANSCRIPTS_INVALID', 'The trusted transcript folder must be an absolute path.');
  const startedAt = now();
  const rows = await replayBench({ routes, runs, bars: before.bars, rates: configuredRates(host.store.read()), ...(transcripts ? { transcripts } : {}) });
  const labels = new Set(rows.filter(r => r.status === 'scored').map(r => r.recorded));
  const result: BenchResult = { id: newId('bench'), schema: 'chausar.route-bench-result.v1', mode: 'offline-replay', startedAt, finishedAt: now(), by: ctx.memberId,
    bench: { version: OPEN_BENCH.version, digest: OPEN_BENCH_DIGEST, cases: OPEN_BENCH.cases.length, languages: BENCH_LANGUAGES },
    bars: before.bars, barsDigest: before.digest, barsSetAt: before.setAt, runs, recorded: labels.size === 0 ? 'none' : labels.size > 1 ? 'mixed' : [...labels][0]!, routes: rows };
  return host.store.update(state => {
    const bench = benchOf(state);
    check(bench.bars?.digest === before.digest, 'BENCH_BARS_CHANGED', 'The pass bars changed during the run. The result was not kept.');
    bench.results = [result, ...bench.results].slice(0, HISTORY);
    return structuredClone(result);
  });
} };

const results: MethodSpec = { permission: 'read', handler(_ctx, payload, host) {
  only(payload, []);
  return { results: (peekBench(host.store.read())?.results ?? []).map(r => ({ id: r.id, startedAt: r.startedAt, finishedAt: r.finishedAt, runs: r.runs, recorded: r.recorded,
    barsDigest: r.barsDigest, routes: r.routes.map(row => ({ route: row.route, status: row.status, passed: row.verdict?.passed ?? null })) })) };
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
  'bench.compare': compare, 'bench.results': results, 'bench.result': result,
} };
