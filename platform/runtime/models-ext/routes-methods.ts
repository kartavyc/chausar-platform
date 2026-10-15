import { audit, check, ChausarError, now } from '../contracts.ts';
import type { Context, State } from '../contracts.ts';
import { moduleState, peekModuleState } from '../modules/types.ts';
import type { ModuleHost } from '../modules/types.ts';
import { MODULE_ID } from './part.ts';
import type { ModulePart } from './part.ts';
import { ROUTE_CATALOGUE } from './catalogue.ts';
import { DAY, DIGITS, PRICE_TABLE, ageDays, findPrice, paisePerMillion, requestCostMinor, validPrice } from './pricing.ts';
import { validateEndpoint } from '../gateway.ts';
import { voiceMeters } from './voice-usage.ts';
import { monthOf, workspaceZone } from './months.ts';
import type { FxSetting, PriceEntry } from './pricing.ts';

type RoutesState = { fx?: FxSetting; overrides: PriceEntry[] };
const NOT_COUNTED = 'not counted';
const KINDS = ROUTE_CATALOGUE.map(entry => entry.kind);
const TOKEN_PRICED = new Set(['openai-responses', 'anthropic-messages', 'openai-compatible', 'managed', 'subq-snap']);

function routesState(state: State): RoutesState {
  const ns = moduleState(state, MODULE_ID, () => ({} as Record<string, unknown>));
  return (ns.routes ??= { overrides: [] }) as RoutesState;
}
function peekRoutes(state: State): RoutesState {
  return (peekModuleState<Record<string, unknown>>(state, MODULE_ID)?.routes as RoutesState | undefined) ?? { overrides: [] };
}
function keys(payload: Record<string, unknown>, allowed: string[], code = 'INVALID_REQUEST') {
  check(Object.keys(payload).every(key => allowed.includes(key)), code, 'The request has an unknown field.');
}
function table(routes: RoutesState): PriceEntry[] {
  return [...routes.overrides, ...PRICE_TABLE.filter(entry => !routes.overrides.some(o => o.kind === entry.kind && o.model === entry.model))];
}
function rates(entry: PriceEntry, fx: FxSetting | undefined) {
  return fx ? { inputPerMillionMinor: paisePerMillion(entry.inputUsdMicroPerMillion, fx), outputPerMillionMinor: paisePerMillion(entry.outputUsdMicroPerMillion, fx) } : null;
}
const sum = (values: string[]) => values.reduce((total, value) => total + BigInt(value), 0n);

/** Rupee meter for one configured route, from the gateway's own counters and receipts. */
function meter(state: State, route: any) {
  const receipts = state.modelReceipts.filter(r => r.routeId === route.id && ['completed', 'failed', 'dispatching'].includes(r.status));
  const measured = receipts.filter(r => r.status === 'completed' && typeof r.actualCostMinor === 'string');
  const consumed = BigInt(route.costConsumedMinor ?? '0'), budget = BigInt(route.budgetMinor);
  const remaining = budget > consumed ? budget - consumed : 0n;
  const measuredTotal = sum(measured.map(r => r.actualCostMinor));
  return { routeId: route.id, kind: route.kind, model: route.model, label: route.label ?? null, enabled: route.enabled, currency: 'INR',
    budgetMinor: route.budgetMinor, consumedMinor: String(consumed), remainingMinor: String(remaining), maxCostPerCallMinor: route.maxCostMinor,
    nextCallFits: route.enabled && consumed + BigInt(route.maxCostMinor) <= budget,
    dispatched: receipts.length, completed: receipts.filter(r => r.status === 'completed').length, failed: receipts.filter(r => r.status === 'failed').length,
    measuredCalls: measured.length, measuredMinor: String(measuredTotal),
    costPerAnswerMinor: measured.length ? String((measuredTotal + BigInt(measured.length) - 1n) / BigInt(measured.length)) : NOT_COUNTED,
    ratesConfigured: Boolean(route.inputPerMillionMinor && route.outputPerMillionMinor),
    note: route.kind.endsWith('-cli') ? 'Your plan with usage limits; the reservation is a local cap, not a bill.'
      : measured.length ? 'Measured at the configured rates from provider-reported tokens; failed calls keep their reservation.'
      : 'Reserved amounts only; no measured cost yet.' };
}

function catalogue(ctx: Context, host: ModuleHost) {
  const routes: any[] = host.services.gateway.listRoutes(ctx);
  return { schema: 'chausar.model-routes.v1', singleAttempt: true, rule: 'One route, one attempt, no rerouting after an error. Every request is checked against the send level and written down word for word before it leaves.',
    routes: ROUTE_CATALOGUE.map(entry => ({ ...entry, configured: routes.filter(route => route.kind === entry.kind).map(route => ({ id: route.id, model: route.model, enabled: route.enabled,
      credentialConfigured: route.credentialConfigured, verification: route.verification, revision: route.revision })) })) };
}

function pricing(state: State) {
  const routes = peekRoutes(state);
  return { currency: 'INR', fx: routes.fx ? { ...routes.fx, ageDays: ageDays(routes.fx.asOf) } : NOT_COUNTED,
    fxNote: routes.fx ? 'Rupee costs use this rate.' : 'No exchange rate is set, so rupee costs are not counted. An owner sets it in paise per US dollar with the date it was read.',
    entries: table(routes).map(entry => ({ ...entry, ageDays: ageDays(entry.asOf), ...(rates(entry, routes.fx) ?? { inputPerMillionMinor: NOT_COUNTED, outputPerMillionMinor: NOT_COUNTED }) })) };
}

function cost(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  keys(payload, ['routeId', 'kind', 'model', 'inputTokens', 'outputTokens']);
  const state = host.store.read(); let kind = payload.kind, model = payload.model, configured: any;
  if (payload.routeId !== undefined) {
    configured = (host.services.gateway.listRoutes(ctx) as any[]).find(route => route.id === payload.routeId);
    check(configured, 'ROUTE_NOT_FOUND', 'Model route was not found.'); kind = configured.kind; model = configured.model;
  }
  check(KINDS.includes(kind) && typeof model === 'string' && model.length > 0 && model.length <= 128, 'INVALID_REQUEST', 'Name a route, or a route kind and model.');
  const base = { kind, model, inputTokens: payload.inputTokens, outputTokens: payload.outputTokens, currency: 'INR' };
  if (!TOKEN_PRICED.has(kind)) return { ...base, costMinor: kind === 'ollama' ? '0' : NOT_COUNTED, basis: kind === 'ollama' ? 'Local model on your machine.' : 'Subscription plan; not billed per request.' };
  if (configured?.inputPerMillionMinor && configured?.outputPerMillionMinor) return { ...base, basis: 'configured-route-rates',
    inputPerMillionMinor: configured.inputPerMillionMinor, outputPerMillionMinor: configured.outputPerMillionMinor,
    costMinor: requestCostMinor(payload.inputTokens, payload.outputTokens, configured.inputPerMillionMinor, configured.outputPerMillionMinor) };
  const routes = peekRoutes(state), entry = findPrice(table(routes), kind, model);
  if (!entry) return { ...base, costMinor: NOT_COUNTED, basis: 'No dated price is known for this model.' };
  const perMillion = rates(entry, routes.fx);
  if (!perMillion) return { ...base, costMinor: NOT_COUNTED, basis: 'No exchange rate is set.', price: entry };
  return { ...base, basis: 'dated-price-table', price: entry, fx: routes.fx, ...perMillion,
    costMinor: requestCostMinor(payload.inputTokens, payload.outputTokens, perMillion.inputPerMillionMinor, perMillion.outputPerMillionMinor) };
}

/** The trusted host clock when one is given (tests, fixtures), else the system clock. */
function clockNow(host: ModuleHost): Date {
  const clock = host.options.clock;
  if (clock === undefined) return new Date();
  check(typeof clock === 'function', 'CLOCK_INVALID', 'The configured clock is not usable.');
  const value = clock(), at = value instanceof Date ? value : new Date(value);
  check(Number.isFinite(at.getTime()), 'CLOCK_INVALID', 'The configured clock is not usable.');
  return at;
}
/** Calendar month of an instant in the workspace's time zone (India when none or an unknown one is set); shared with voice in months.ts. */
export { monthOf };
const zoneOf = workspaceZone;

/** Model spend this month across every route: measured where the provider reported usage, else the reservation. */
function monthSpend(state: State, month: string) {
  const zone = zoneOf(state);
  const calls = state.modelReceipts.filter(r => r.routeId && ['completed', 'failed', 'dispatching'].includes(r.status) && typeof (r.dispatchedAt ?? r.createdAt) === 'string'
    && monthOf(r.dispatchedAt ?? r.createdAt, zone) === month);
  const measured = calls.filter(r => typeof r.actualCostMinor === 'string'), reserved = calls.filter(r => typeof r.actualCostMinor !== 'string');
  const measuredMinor = sum(measured.map(r => r.actualCostMinor)), reservedMinor = sum(reserved.map(r => r.costReservedMinor ?? '0'));
  const voice = voiceMeters(state, month, zone), voiceCost = voice.voiceCostMinor === NOT_COUNTED ? 0n : BigInt(voice.voiceCostMinor);
  return { month, timeZone: zone, calls: calls.length, modelSpendMinor: String(measuredMinor + reservedMinor), spendMinor: String(measuredMinor + reservedMinor + voiceCost),
    measuredMinor: String(measuredMinor), reservedMinor: String(reservedMinor), voiceMinutesMs: voice.voiceMinutesMs, voiceCostMinor: voice.voiceCostMinor };
}

/** jobs-ext's unit price: one unit is one model request. */
function price(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  keys(payload, ['routeId']);
  check(typeof payload.routeId === 'string' && payload.routeId.length > 0 && payload.routeId.length <= 120, 'INVALID_REQUEST', 'Name one model route.');
  const route = (host.services.gateway.listRoutes(ctx) as any[]).find(item => item.id === payload.routeId);
  check(route, 'ROUTE_NOT_FOUND', 'Model route was not found.');
  check(!route.kind.endsWith('-cli'), 'ROUTE_ESTIMATE_UNAVAILABLE', 'This route runs on your plan, not per request, so it has no price per request.');
  const pricedAt = clockNow(host).toISOString();
  if (route.kind === 'ollama') return { routeId: route.id, unitMinor: '0', basis: 'zero', pricedAt };
  const measured = host.store.read().modelReceipts.filter(r => r.routeId === route.id && r.status === 'completed' && typeof r.actualCostMinor === 'string');
  if (measured.length) {
    const total = sum(measured.map(r => r.actualCostMinor));
    return { routeId: route.id, unitMinor: String((total + BigInt(measured.length) - 1n) / BigInt(measured.length)), basis: 'measured', pricedAt };
  }
  return { routeId: route.id, unitMinor: route.maxCostMinor, basis: 'estimate', pricedAt };
}

type OllamaHttp = (request: { url: string; timeoutMs: number; maxBytes: number }) => Promise<{ status: number; body: string }>;
async function ollamaGet(request: { url: string; timeoutMs: number; maxBytes: number }) {
  const response = await fetch(request.url, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(request.timeoutMs) });
  const reader = response.body?.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  if (reader) try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; check(size <= request.maxBytes, 'RESPONSE_TOO_LARGE', 'The local model list was too large.'); chunks.push(value); } } finally { reader.releaseLock(); }
  return { status: response.status, body: Buffer.concat(chunks).toString('utf8') };
}

/**
 * FR-05: the models installed in the local Ollama, read from loopback only. Nothing leaves the machine.
 * Naming another endpoint is for an owner or cofounder in the untainted desktop app: anyone else could use it to learn
 * which local ports answer. Everyone else reads only the configured (or default) endpoint.
 */
async function localList(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  keys(payload, ['endpoint']);
  check(!host.demo, 'DEMO_PROVIDER_DISABLED', 'Synthetic demo mode keeps model providers disabled.');
  if (payload.endpoint !== undefined) check(['owner', 'cofounder'].includes(ctx.role) && ctx.channel === 'desktop' && !ctx.sourceTainted,
    'LOCAL_ENDPOINT_APP_ONLY', 'Only an owner in the desktop app can name another local model address. Leave it out to read the configured one.');
  const configured = host.store.read().routes.find(r => r.kind === 'ollama' && r.enabled)?.endpoint;
  const base = new URL(validateEndpoint(payload.endpoint ?? configured ?? 'http://127.0.0.1:11434/api/chat', 'ollama'));
  const url = `${base.origin}/api/tags`;
  const http = (host.options.ollamaHttp as OllamaHttp | undefined) ?? ollamaGet;
  let reply: { status: number; body: string };
  try { reply = await http({ url, timeoutMs: 3000, maxBytes: 1048576 }); }
  catch (error) {
    if (error instanceof ChausarError && error.code === 'RESPONSE_TOO_LARGE') throw error;
    return { endpoint: base.origin, reachable: false, models: [], words: 'No local model service answered on this computer. Install Ollama and pull a model, then try again.' };
  }
  if (reply.status !== 200) return { endpoint: base.origin, reachable: false, models: [], words: 'The local model service did not list its models.' };
  let data: any; try { data = JSON.parse(reply.body); } catch { throw new ChausarError('LOCAL_LIST_INVALID', 'The local model service returned an unreadable list.'); }
  check(data && Array.isArray(data.models) && data.models.length <= 500, 'LOCAL_LIST_INVALID', 'The local model service returned an unreadable list.');
  const models = data.models.filter((m: any) => m && typeof m.name === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(m.name)).map((m: any) => ({
    name: m.name, sizeBytes: Number.isSafeInteger(m.size) && m.size >= 0 ? m.size : null,
    modifiedAt: typeof m.modified_at === 'string' && Number.isFinite(Date.parse(m.modified_at)) ? new Date(m.modified_at).toISOString() : null,
    family: typeof m.details?.family === 'string' && /^[a-z0-9._-]{1,40}$/i.test(m.details.family) ? m.details.family : null }));
  return { endpoint: base.origin, reachable: true, models, skipped: data.models.length - models.length };
}

/** Route fields the gateway accepts back on reconfiguration. Credentials are untouched. */
const ROUTE_FIELDS = ['id', 'kind', 'model', 'endpoint', 'command', 'enabled', 'budgetMinor', 'maxCostMinor', 'maxOutputTokens', 'inputPerMillionMinor', 'outputPerMillionMinor', 'credentialEnv', 'label'];
function routeConfig(route: any, change: Record<string, unknown>) {
  const config: Record<string, unknown> = {};
  for (const key of ROUTE_FIELDS) if (route[key] !== undefined && route[key] !== null) config[key] = route[key];
  if (route.kind.endsWith('-cli') || route.kind === 'ollama') delete config.endpoint;
  if (!route.kind.endsWith('-cli')) delete config.command;
  return { ...config, ...change };
}

async function connectAllowance(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  keys(payload, ['model', 'budgetMinor', 'maxCostMinor']);
  let grant: any;
  try { grant = await host.call('hosted.allowanceCredential', {}); }
  catch (error) {
    // Not built, not set up in this app, not paired, or demo mode: all mean there is no allowance to connect yet.
    if (error instanceof ChausarError && ['UNKNOWN_METHOD', 'METHOD_UNAVAILABLE', 'INVALID_REQUEST', 'HOSTED_NOT_CONFIGURED', 'HOSTED_NOT_PAIRED', 'DEMO_EXTERNAL_DISABLED'].includes(error.code))
      throw new ChausarError('ALLOWANCE_NOT_AVAILABLE', 'The Chausar allowance is not available yet. Pair this computer with the hosted service first.');
    throw error;
  }
  check(grant && typeof grant === 'object' && typeof grant.endpoint === 'string' && typeof grant.credential === 'string' && grant.credential.length > 0,
    'ALLOWANCE_NOT_AVAILABLE', 'The hosted service did not return an allowance credential.');
  const model = payload.model ?? grant.model;
  return host.services.gateway.configureRoute(ctx, { id: 'route_managed_allowance', kind: 'managed', model, endpoint: grant.endpoint, label: 'Chausar allowance',
    ...(payload.budgetMinor !== undefined ? { budgetMinor: payload.budgetMinor } : grant.budgetMinor !== undefined ? { budgetMinor: grant.budgetMinor } : {}),
    ...(payload.maxCostMinor !== undefined ? { maxCostMinor: payload.maxCostMinor } : {}) }, grant.credential);
}

export const routesPart: ModulePart = {
  methods: {
    'modelsx.catalogue': { permission: 'read', handler: (ctx, _payload, host) => catalogue(ctx, host) },
    'modelsx.pricing': { permission: 'read', handler: (_ctx, payload, host) => { keys(payload, []); return pricing(host.store.read()); } },
    'modelsx.setFx': { permission: 'admin', handler: (ctx, payload, host) => {
      keys(payload, ['paisePerUsd', 'asOf']);
      check(typeof payload.paisePerUsd === 'string' && DIGITS.test(payload.paisePerUsd) && BigInt(payload.paisePerUsd) > 0n && BigInt(payload.paisePerUsd) < 10000000n,
        'INVALID_FX', 'Give the rate as whole paise per US dollar.');
      check(typeof payload.asOf === 'string' && DAY.test(payload.asOf) && !Number.isNaN(Date.parse(payload.asOf)) && Date.parse(payload.asOf) <= Date.now(),
        'INVALID_FX', 'Give the date the rate was read.');
      return host.store.update(state => { const routes = routesState(state); routes.fx = { paisePerUsd: payload.paisePerUsd, asOf: payload.asOf, setBy: ctx.memberId };
        audit(state, 'modelsx.fx.set', { paisePerUsd: payload.paisePerUsd, asOf: payload.asOf }); return structuredClone(routes.fx); });
    } },
    'modelsx.setPrice': { permission: 'admin', handler: (ctx, payload, host) => {
      keys(payload, ['kind', 'model', 'price']);
      check(KINDS.includes(payload.kind) && TOKEN_PRICED.has(payload.kind) && typeof payload.model === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(payload.model),
        'INVALID_PRICE', 'Name a priced route kind and an exact model.');
      const entry = validPrice(payload.price, payload.kind, payload.model, ctx.memberId);
      return host.store.update(state => { const routes = routesState(state);
        routes.overrides = [...routes.overrides.filter(o => !(o.kind === entry.kind && o.model === entry.model)), entry];
        audit(state, 'modelsx.price.set', { kind: entry.kind, model: entry.model, asOf: entry.asOf }); return structuredClone(entry); });
    } },
    'modelsx.applyPricing': { permission: 'admin', handler: async (ctx, payload, host) => {
      keys(payload, ['routeId']);
      const route = (host.services.gateway.listRoutes(ctx) as any[]).find(item => item.id === payload.routeId);
      check(route, 'ROUTE_NOT_FOUND', 'Model route was not found.');
      check(TOKEN_PRICED.has(route.kind), 'PRICING_NOT_APPLICABLE', 'This route is not billed per token.');
      const routes = peekRoutes(host.store.read()), entry = findPrice(table(routes), route.kind, route.model);
      check(entry, 'PRICE_UNKNOWN', 'No dated price is known for this model. Enter one first.');
      const perMillion = rates(entry, routes.fx); check(perMillion, 'FX_NOT_SET', 'Set the exchange rate first.');
      const updated = await host.services.gateway.configureRoute(ctx, routeConfig(route, perMillion));
      return { route: updated, price: entry, fx: routes.fx };
    } },
    'modelsx.cost': { permission: 'read', handler: (ctx, payload, host) => cost(ctx, payload, host) },
    'modelsx.meters': { permission: 'read', handler: (ctx, payload, host) => {
      keys(payload, []); const state = host.store.read();
      const meters = (host.services.gateway.listRoutes(ctx) as any[]).map(route => meter(state, route));
      return { at: now(), currency: 'INR', routes: meters, month: monthSpend(state, monthOf(clockNow(host), zoneOf(state))),
        totals: { budgetMinor: String(sum(meters.map(m => m.budgetMinor))), consumedMinor: String(sum(meters.map(m => m.consumedMinor))),
          measuredMinor: String(sum(meters.map(m => m.measuredMinor))) } };
    } },
    'modelsx.jobCost': { permission: 'read', handler: (ctx, payload, host) => {
      keys(payload, ['receiptIds']);
      check(Array.isArray(payload.receiptIds) && payload.receiptIds.length <= 1000 && payload.receiptIds.every((id: unknown) => typeof id === 'string' && id.length <= 200),
        'INVALID_REQUEST', 'Give up to 1000 model receipt IDs.');
      const visible = new Map((host.services.gateway.receipts(ctx) as any[]).map(r => [r.id, r]));
      const found = payload.receiptIds.map((id: string) => visible.get(id)).filter(Boolean);
      const measured = found.filter((r: any) => typeof r.actualCostMinor === 'string');
      return { currency: 'INR', requested: payload.receiptIds.length, found: found.length, missing: payload.receiptIds.length - found.length,
        reservedMinor: String(sum(found.map((r: any) => r.costReservedMinor ?? '0'))), measuredMinor: String(sum(measured.map((r: any) => r.actualCostMinor))),
        unmeasured: found.length - measured.length, note: found.length - measured.length ? 'Some calls have no measured cost; their reservation is counted instead.' : 'Every call was measured.' };
    } },
    'modelsx.price': { permission: 'read', handler: (ctx, payload, host) => price(ctx, payload, host) },
    'modelsx.localList': { permission: 'read', handler: (ctx, payload, host) => localList(ctx, payload, host) },
    'modelsx.connectAllowance': { permission: 'admin', external: true, handler: (ctx, payload, host) => connectAllowance(ctx, payload, host) },
  },
};
