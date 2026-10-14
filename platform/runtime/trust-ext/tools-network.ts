/** TR-08 models and cost, TR-09 the network ledger and the canary. */
import { randomBytes } from 'node:crypto';
import { audit, check, ChausarError, now } from '../contracts.ts';
import type { Context, State, StateStore } from '../contracts.ts';
import { peekLane } from './lane-state.ts';
import type { ModuleHost } from '../modules/types.ts';
import { canonicalJson, fields, newestFirst, paise, shipped, tools } from './tools-common.ts';
import { hostedLeft, modelMeters, writebackLedger } from './adapters.ts';

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

export async function modelsView(ctx: Context, host: ModuleHost) {
  const meters = await modelMeters(host);
  const state = host.store.read(); const gateway = host.services.gateway;
  const routes: any[] = gateway.listRoutes(ctx); const receipts: any[] = gateway.receipts(ctx).filter((r: any) => r.kind === 'model-preview');
  const month = now().slice(0, 7);
  // models-ext meters the month's spend in rupees from measured costs; when it answers, its figure is used
  // instead of this lane's sum of reserved and estimated costs from the receipts.
  const spent = meters.spendThisMonthMinor ?? receipts.filter(r => SENT.has(r.status) && String(r.dispatchedAt ?? r.at).startsWith(month)).reduce((sum, r) => sum + paise(cost(r)), 0n).toString();
  let voice: string | null = null;
  try { const providers: any[] = host.services.speech?.providers(ctx) ?? []; voice = providers.find(p => p.enabled)?.kind ?? null; } catch { voice = null; }
  return {
    routes: routes.map((route, index) => {
      const last = receipts.filter(r => r.routeId === route.id && r.status === 'completed').sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt)))[0];
      return { id: route.id, kind: route.kind, label: route.label ?? `${route.kind} ${route.model}`, health: healthOf(route, receipts), order: index + 1,
        terms: termsFor(route), lastAnswerCostMinor: last ? cost(last) : null };
    }),
    // Spend counts every member's requests only for owner and cofounder, who see them all. Voice minutes come
    // from models-ext's meters and stay null ("not counted yet") until that method gives them.
    spendThisMonthMinor: ['owner', 'cofounder'].includes(ctx.role) ? spent : null, monthlyCapMinor: tools(state).modelCap ?? null, capEnforced: false as const,
    voice: { provider: voice, minutesThisMonth: meters.minutesThisMonth },
  };
}

export async function setModelCap(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  const { monthlyCapMinor } = fields(payload, ['monthlyCapMinor']);
  check(monthlyCapMinor === null || (typeof monthlyCapMinor === 'string' && /^\d{1,15}$/.test(monthlyCapMinor)), 'INVALID_CAP', 'Give the monthly cap as whole paise, or none.');
  await host.store.update(state => { tools(state).modelCap = monthlyCapMinor === null ? null : BigInt(monthlyCapMinor).toString(); });
  return modelsView(ctx, host);
}

const SYSTEM: Record<string, string> = { tally: 'Tally', 'zoho-books': 'Zoho Books', razorpay: 'Razorpay', shopify: 'Shopify', 'google-workspace': 'Google Workspace',
  whatsapp: 'WhatsApp Business', mail: 'Your mail server', 'gst-portal': 'GST portal' };
const CHANNEL: Record<string, string> = { whatsapp: 'WhatsApp', telegram: 'Telegram', mail: 'Mail' };
/** writeback's words for a change, as the network ledger reads them. Not sure is waiting: it is checked before anything is sent again. */
const WRITE_OUTCOME: Record<string, ['allowed' | 'stopped' | 'waiting', string]> = {
  'waiting-for-you': ['waiting', 'Waiting for your yes.'], approved: ['waiting', 'Approved, not sent yet.'], doing: ['allowed', 'Being done now.'], done: ['allowed', 'Done and read back.'],
  'not-sure': ['waiting', 'Not sure it arrived; it is checked before anything is sent again.'], 'not-done': ['allowed', 'Sent; the system did not do it.'],
  dropped: ['stopped', 'Dropped before sending.'], 'prepare-only': ['stopped', 'Prepared only; Chausar never sends this.'],
};

type Item = { id: string; at: string; kind: string; destination: string; why: string; bytes: number | null; outcome: 'allowed' | 'stopped' | 'waiting'; pluginId?: string; waitingContent?: string };
export async function networkView(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  const { kind, pluginId, limit = 200 } = fields(payload, ['kind', 'pluginId', 'limit']);
  check(kind === undefined || ['model', 'connector', 'action', 'sharing', 'phone', 'sync', 'plugin'].includes(kind), 'INVALID_FIELDS', 'Choose a known kind of call.');
  check(pluginId === undefined || (typeof pluginId === 'string' && pluginId.length <= 200), 'INVALID_FIELDS', 'Choose a plugin.');
  check(Number.isSafeInteger(limit) && limit >= 1 && limit <= 1000, 'INVALID_FIELDS', 'Ask for 1 to 1000 calls.');
  const ledger = await writebackLedger(host);
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
  // writeback's changes come from its own ledger below.
  for (const action of state.actions) if (action.connector !== 'local' && !String(action.connector).startsWith('wb-') && ['executing', 'verified', 'unknown', 'rejected'].includes(action.status) && action.attempts?.length)
    items.push({ id: action.id, at: String(action.attempts[0].startedAt ?? action.createdAt), kind: 'action', destination: String(action.connector), why: `To do an approved ${String(action.operation)}`, bytes: Buffer.byteLength(canonicalJson(action.payload)), outcome: 'allowed' });
  for (const record of state.learning) if (record.type === 'export')
    items.push({ id: record.id, at: record.at, kind: 'sharing', destination: String(record.receiver), why: 'To share the shape of your work, without names or amounts', bytes: Buffer.byteLength(canonicalJson(record.payload)), outcome: record.outcome === 'sent' || record.outcome === 'unknown' ? 'allowed' : 'stopped' });
  for (const event of state.activity) if (event.event === 'sync.push.completed')
    items.push({ id: event.id, at: event.at, kind: 'sync', destination: 'Your sync store', why: 'To copy the locked workspace to your other device', bytes: null, outcome: 'allowed' });
  for (const row of ledger) {
    const [outcome, word] = WRITE_OUTCOME[row.word] ?? ['waiting', 'In a state this screen does not know yet.'];
    items.push({ id: row.id, at: row.at, kind: 'action', destination: row.practice ? `Practice copy of ${SYSTEM[row.system] ?? 'a system'}, on this computer` : SYSTEM[row.system] ?? 'A connected system',
      why: `${row.title}. ${word}`, bytes: null, outcome });
  }
  for (const left of hostedLeft(state)) items.push(left.kind === 'phone'
    ? { id: left.id, at: left.at, kind: 'phone', destination: `${CHANNEL[left.channel ?? ''] ?? 'A phone channel'}, through the Chausar relay`, why: 'To send you a message with a headline and a link only', bytes: null, outcome: 'allowed' }
    : { id: left.id, at: left.at, kind: 'sync', destination: 'Chausar hosted backup', why: 'To keep a backup locked on this computer before upload; the server cannot open it', bytes: null, outcome: 'allowed' });
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

const SENSITIVE = [/\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/g, /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){1,8}/g, /(?<!\d)[6-9]\d{9}(?!\d)/g];
/** Values in the books that must never leave as written: GSTINs, mail addresses and mobile numbers are
 *  swapped for stand-ins before any call. Bounded so the scan stays cheap. */
function guarded(state: State): string[] {
  const found = new Set<string>();
  for (const fact of state.facts) {
    if (fact.deletedAt) continue;
    for (const value of Object.values(fact.fields ?? {})) {
      if (typeof value !== 'string' || value.length > 500) continue;
      for (const pattern of SENSITIVE) for (const match of value.match(pattern) ?? []) { found.add(match); if (found.size >= 500) return [...found]; }
    }
  }
  return [...found];
}
/** Scan every model request payload for the planted value and for any guarded value from the books; a hit stops every send. */
export function canaryHit(state: State): { at: string; callId: string } | null {
  const canary = tools(state).canary;
  if (canary?.alert) return canary.alert;
  const needles = [...(canary?.value ? [canary.value] : []), ...guarded(state)];
  if (needles.length === 0) return null;
  const hit = state.modelReceipts.find(r => r.kind === 'model-preview' && typeof r.payload === 'string' && needles.some(needle => r.payload.includes(needle)));
  return hit ? { at: now(), callId: hit.id } : null;
}
/** The planted value or a guarded value from the books inside an outgoing payload: the call is stopped before it leaves. */
export function payloadLeaks(state: State, payload: string): boolean {
  const canary = peekLane(state)?.tools?.canary;
  return [...(canary?.value ? [canary.value as string] : []), ...guarded(state)].some(needle => payload.includes(needle));
}
export async function blockLeak(store: StateStore, outgoing: { receiptId: string; payload: string }) {
  if (!payloadLeaks(store.read(), outgoing.payload)) return;
  await store.update(state => {
    const canary = (tools(state).canary ??= { value: null, plantedAt: null, alert: null }); canary.alert ??= { at: now(), callId: outgoing.receiptId };
    audit(state, 'trustx.canary.blocked', { receiptId: outgoing.receiptId });
  });
  throw new ChausarError('CANARY_BLOCKED', 'This request carried a protected value, so nothing was sent.');
}
export async function checkCanary(_ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  fields(payload, []);
  const alert = canaryHit(host.store.read());
  if (!alert) return { alert: null };
  await host.store.update(state => { const canary = (tools(state).canary ??= { value: null, plantedAt: null, alert: null }); if (!canary.alert) canary.alert = alert; });
  if (host.store.read().policy.send !== 'nothing') await host.call('trust.update', { send: 'nothing' });
  return { alert };
}
