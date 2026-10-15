/**
 * The gateway's new methods: route order (models.setLadder), route states (models.probe), discarding a waiting send
 * (models.discard) and the monthly cap as enforced (models.capStatus). The deciding purpose and bench fixture selectors
 * are in-process only (ModelGateway.previewDecision / executeDecision / preview's trusted argument), never RPC.
 */
import { check } from '../contracts.ts';
import type { Context } from '../contracts.ts';
import type { MethodSpec, ModuleHost } from '../modules/types.ts';
import { peekModuleState } from '../modules/types.ts';
import { capMonth, capTimeZone, monthlyCap, monthlySpend, registerMonthlyCap } from '../gateway.ts';
import { current } from '../actions.ts';
import { probeRoute, realPorts, type ProbePorts } from './probe.ts';

// The cap a person sets on Trust › Models (trustx.setModelCap) is the one the gateway enforces.
registerMonthlyCap(state => {
  const cap = peekModuleState<{ tools?: { modelCap?: unknown } }>(state, 'reports-tools-trust')?.tools?.modelCap;
  return typeof cap === 'string' ? cap : null;
});

function exact(payload: Record<string, any>, allowed: string[]) {
  check(payload && typeof payload === 'object' && !Array.isArray(payload) && Object.keys(payload).every(key => allowed.includes(key)), 'INVALID_REQUEST', 'This request has a field it does not take.');
}
function ports(host: ModuleHost): ProbePorts {
  const injected = host.options.probe as Partial<ProbePorts> | undefined;
  check(injected === undefined || (typeof injected === 'object' && ['run', 'http', 'which'].every(k => typeof (injected as any)[k] === 'function')), 'PROBE_HOST_OPTIONS_INVALID', 'The probe ports are functions.');
  return (injected as ProbePorts | undefined) ?? realPorts;
}

export function capStatus(ctx: Context, host: ModuleHost) {
  const state = host.store.read(); const member = current(state, ctx);
  const cap = monthlyCap(state); const spent = BigInt(monthlySpend(state).spentMinor);
  // Spend is the whole workspace's, so only the owner and cofounder see the amounts.
  const sees = ['owner', 'cofounder'].includes(member.role);
  return { month: capMonth(state), timeZone: capTimeZone(state), enforced: true as const,
    monthlyCapMinor: cap === null ? null : cap.toString(),
    spentMinor: sees ? spent.toString() : null,
    remainingMinor: sees && cap !== null ? (cap > spent ? cap - spent : 0n).toString() : null,
    reached: cap !== null && spent >= cap };
}

export const gatewayMethods: Record<string, MethodSpec> = {
  'models.setLadder': { permission: 'admin', handler: (ctx, payload, host) => { exact(payload, ['order']); return host.services.gateway.setLadder(ctx, payload.order); } },
  'models.discard': { permission: 'prepare', handler: (ctx, payload, host) => { exact(payload, ['id']); return host.services.gateway.discard(ctx, payload.id); } },
  'models.capStatus': { permission: 'read', handler: (ctx, payload, host) => { exact(payload, []); return capStatus(ctx, host); } },
  'models.probe': { permission: 'read', async handler(ctx, payload, host) {
    exact(payload, ['routeId', 'deep']);
    check(payload.routeId === undefined || (typeof payload.routeId === 'string' && payload.routeId.length <= 200), 'INVALID_REQUEST', 'Name one route, or none for all.');
    check(payload.deep === undefined || typeof payload.deep === 'boolean', 'INVALID_REQUEST', 'deep is true or false.');
    const deep = payload.deep === true;
    // Running a local program or asking a local model is the owner's or cofounder's call, made in the app.
    if (deep) { current(host.store.read(), ctx, 'admin'); check(ctx.channel !== 'phone' && !ctx.sourceTainted, 'APP_APPROVAL_REQUIRED', 'Check routes deeply inside the app.'); }
    const gateway = host.services.gateway; const routes: any[] = gateway.listRoutes(ctx);
    const chosen = payload.routeId === undefined ? routes : routes.filter(r => r.id === payload.routeId);
    check(chosen.length > 0 || payload.routeId === undefined, 'ROUTE_NOT_FOUND', 'Model route was not found.');
    const state = host.store.read(); const receipts: any[] = gateway.receipts(ctx);
    const evidence = gateway.options?.codexCli?.capabilities?.evidence?.kind ?? null;
    const out = [];
    for (const route of chosen) out.push(await probeRoute(route, { order: routes.indexOf(route) + 1, send: state.policy.send, demo: host.demo, deep, receipts, codexEvidence: typeof evidence === 'string' ? evidence : null, ports: ports(host) }));
    return { routes: out, send: state.policy.send };
  } },
};
