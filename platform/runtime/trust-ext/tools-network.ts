/** TR-08 models and cost, TR-09 the network ledger and the canary. */
import { randomBytes } from 'node:crypto';
import { check, now } from '../contracts.ts';
import type { Context, State } from '../contracts.ts';
import type { ModuleHost } from '../modules/types.ts';
import { canonicalJson, fields, newestFirst, paise, shipped, tools } from './tools-common.ts';

type Terms = { keeps: string; keepsFor: string; trains: string; country: string; termsUrl: string; readOn: string; hosts?: string[] };
const TERMS = shipped<{ version: number; readOn: string; kinds: Record<string, Terms> }>('tools-terms.v1.json');
const SENT = new Set(['dispatching', 'completed', 'failed']);
const PURPOSE: Record<string, string> = {
  analysis: 'To plan a calculation', 'business-context': 'To answer a question about the business', conversation: 'To answer a question',
  'conversation-synthesis': 'To write up results that were already calculated',
};
const WAITING_LIMIT = 4000;

function termsFor(route: any): Omit<Terms, 'hosts'> | null {
  const entry = Object.hasOwn(TERMS.kinds, route.kind) ? TERMS.kinds[route.kind] : undefined;
  if (!entry) return null;
  if (entry.hosts) { let host = ''; try { host = new URL(route.endpoint).host; } catch { /* no endpoint: unknown provider */ } if (!entry.hosts.includes(host)) return null; }
  const { hosts: _, ...terms } = entry; return terms;
}
function destination(endpoint: unknown): string {
  if (typeof endpoint !== 'string') return 'Unknown';
  if (endpoint.startsWith('cli://')) return endpoint.startsWith('cli://codex') ? 'OpenAI, through the Codex program' : 'Anthropic, through the Claude program';
  try { return new URL(endpoint).host; } catch { return 'Unknown'; }
}
const cost = (receipt: any) => typeof receipt.costReservedMinor === 'string' && receipt.costReservedMinor !== '0' ? receipt.costReservedMinor : typeof receipt.estimatedCostMinor === 'string' ? receipt.estimatedCostMinor : null;

function healthOf(route: any, receipts: any[]): string {
  if (!route.enabled) return 'off';
  const last = receipts.filter(r => r.routeId === route.id && SENT.has(r.status)).sort((a, b) => String(b.dispatchedAt ?? b.at).localeCompare(String(a.dispatchedAt ?? a.at)))[0];
  if (last?.status === 'failed') return 'failing';
  if (route.kind.endsWith('-cli')) return 'not-checked';
  return route.credentialConfigured ? 'ready' : 'needs-key';
}

export function modelsView(ctx: Context, host: ModuleHost) {
  const state = host.store.read(); const gateway = host.services.gateway;
  const routes: any[] = gateway.listRoutes(ctx); const receipts: any[] = gateway.receipts(ctx).filter((r: any) => r.kind === 'model-preview');
  const month = now().slice(0, 7);
  const spent = receipts.filter(r => SENT.has(r.status) && String(r.dispatchedAt ?? r.at).startsWith(month)).reduce((sum, r) => sum + paise(cost(r)), 0n);
  let voice: string | null = null;
  try { const providers: any[] = host.services.speech?.providers(ctx) ?? []; voice = providers.find(p => p.enabled)?.kind ?? null; } catch { voice = null; }
  return {
    routes: routes.map((route, index) => {
      const last = receipts.filter(r => r.routeId === route.id && r.status === 'completed').sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt)))[0];
      return { id: route.id, kind: route.kind, label: route.label ?? `${route.kind} ${route.model}`, health: healthOf(route, receipts), order: index + 1,
        terms: termsFor(route), lastAnswerCostMinor: last ? cost(last) : null };
    }),
    spendThisMonthMinor: spent.toString(), monthlyCapMinor: tools(state).modelCap ?? null,
    voice: { provider: voice, minutesThisMonth: 0 },
  };
}

export async function setModelCap(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  const { monthlyCapMinor } = fields(payload, ['monthlyCapMinor']);
  check(monthlyCapMinor === null || (typeof monthlyCapMinor === 'string' && /^\d{1,15}$/.test(monthlyCapMinor)), 'INVALID_CAP', 'Give the monthly cap as whole paise, or none.');
  await host.store.update(state => { tools(state).modelCap = monthlyCapMinor === null ? null : BigInt(monthlyCapMinor).toString(); });
  return modelsView(ctx, host);
}

type Item = { id: string; at: string; kind: string; destination: string; why: string; bytes: number | null; outcome: 'allowed' | 'stopped' | 'waiting'; pluginId?: string; waitingContent?: string };
export function networkView(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  const { kind, pluginId, limit = 200 } = fields(payload, ['kind', 'pluginId', 'limit']);
  check(kind === undefined || ['model', 'connector', 'action', 'sharing', 'phone', 'sync', 'plugin'].includes(kind), 'INVALID_REQUEST', 'Choose a known kind of call.');
  check(pluginId === undefined || (typeof pluginId === 'string' && pluginId.length <= 200), 'INVALID_REQUEST', 'Choose a plugin.');
  check(Number.isSafeInteger(limit) && limit >= 1 && limit <= 1000, 'INVALID_REQUEST', 'Ask for 1 to 1000 calls.');
  const state = host.store.read(); const items: Item[] = [];
  for (const r of host.services.gateway.receipts(ctx) as any[]) {
    if (r.kind !== 'model-preview') continue;
    const bytes = typeof r.payload === 'string' ? Buffer.byteLength(r.payload) : null; const base = { id: r.id, kind: 'model', destination: destination(r.endpoint), why: PURPOSE[r.purpose] ?? 'To ask the AI model', bytes };
    if (SENT.has(r.status)) items.push({ ...base, at: String(r.dispatchedAt ?? r.at), outcome: r.status === 'failed' && !r.dispatchedAt ? 'stopped' : 'allowed' });
    else if (r.status === 'preview' && r.approvalRequired === true)
      items.push({ ...base, at: String(r.at), outcome: 'waiting', ...(typeof r.payload === 'string' ? { waitingContent: r.payload.slice(0, WAITING_LIMIT) } : {}) });
  }
  for (const item of state.imports) if (typeof item?.type === 'string' && item.type.startsWith('connector-'))
    items.push({ id: String(item.id), at: String(item.createdAt ?? item.at ?? item.capturedAt ?? ''), kind: 'connector', destination: String(item.profileId ?? item.connector ?? 'A connected system'), why: 'To read your records', bytes: null, outcome: 'allowed' });
  for (const action of state.actions) if (action.connector !== 'local' && ['executing', 'verified', 'unknown', 'rejected'].includes(action.status) && action.attempts?.length)
    items.push({ id: action.id, at: String(action.attempts[0].startedAt ?? action.createdAt), kind: 'action', destination: String(action.connector), why: `To do an approved ${String(action.operation)}`, bytes: Buffer.byteLength(canonicalJson(action.payload)), outcome: 'allowed' });
  for (const record of state.learning) if (record.type === 'export')
    items.push({ id: record.id, at: record.at, kind: 'sharing', destination: String(record.receiver), why: 'To share the shape of your work, without names or amounts', bytes: Buffer.byteLength(canonicalJson(record.payload)), outcome: record.outcome === 'sent' || record.outcome === 'unknown' ? 'allowed' : 'stopped' });
  for (const event of state.activity) if (event.event === 'sync.push.completed')
    items.push({ id: event.id, at: event.at, kind: 'sync', destination: 'Your sync store', why: 'To copy the locked workspace to your other device', bytes: null, outcome: 'allowed' });
  for (const plugin of state.plugins) for (const run of plugin.runs ?? [])
    items.push({ id: run.id, at: run.at, kind: 'plugin', destination: 'this computer', why: `${String(plugin.manifest?.name ?? 'A plugin')} ran in its locked box`, bytes: null, outcome: run.outcome === 'success' ? 'allowed' : 'stopped', pluginId: plugin.id });
  const filtered = items.filter(item => (!kind || item.kind === kind) && (!pluginId || item.pluginId === pluginId));
  const canary = tools(state).canary;
  return { items: newestFirst(filtered).slice(0, limit), canary: { planted: Boolean(canary?.value), alert: canary?.alert ?? null } };
}

export async function plantCanary(_ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  fields(payload, []);
  const at = now(); const value = `CANARY-${randomBytes(12).toString('hex')}`;
  await host.store.update(state => { tools(state).canary = { value, plantedAt: at, alert: null }; });
  return { planted: true as const, at };
}

/** Scan every model request payload for the planted value; a hit stops every send. */
export function canaryHit(state: State): { at: string; callId: string } | null {
  const canary = tools(state).canary; if (!canary?.value) return null;
  if (canary.alert) return canary.alert;
  const hit = state.modelReceipts.find(r => r.kind === 'model-preview' && JSON.stringify(r).includes(canary.value));
  return hit ? { at: now(), callId: hit.id } : null;
}
export async function checkCanary(_ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  fields(payload, []);
  const alert = canaryHit(host.store.read());
  if (!alert) return { alert: null };
  await host.store.update(state => { const canary = tools(state).canary; if (canary && !canary.alert) canary.alert = alert; });
  if (host.store.read().policy.send !== 'nothing') await host.call('trust.update', { send: 'nothing' });
  return { alert };
}
