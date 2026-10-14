import { audit, check, ChausarError, now } from '../contracts.ts';
import type { Context, State } from '../contracts.ts';
import { moduleState, peekModuleState } from '../modules/types.ts';
import type { ModuleHost } from '../modules/types.ts';
import { MODULE_ID } from './part.ts';
import type { ModulePart } from './part.ts';
import { ROUTE_CATALOGUE } from './catalogue.ts';
import { DAY, DIGITS, PRICE_TABLE, ageDays, findPrice, paisePerMillion, requestCostMinor, validPrice } from './pricing.ts';
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
      return { at: now(), currency: 'INR', routes: meters,
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
    'modelsx.connectAllowance': { permission: 'admin', external: true, handler: (ctx, payload, host) => connectAllowance(ctx, payload, host) },
  },
};
