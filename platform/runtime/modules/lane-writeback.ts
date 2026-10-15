/**
 * writeback.*: the full write catalogue, its five steps over the ActionService journal, Practice,
 * the write-back recipe test, and invoice follow-up for real customers. See docs/lanes/writeback.md.
 *
 * Trusted host options (EngineOptions.modules.writeback), all optional:
 *   http, dial      production transports (default: the real bounded HTTPS client and TLS mail dialer)
 *   credentials     the credential broker for outside systems; absent → WRITE_CREDENTIALS_UNAVAILABLE
 *   clock           an ISO clock (the labelled test clock in drills)
 *   timeZone        the business day for reminder caps (default Asia/Kolkata)
 *   whatsappStatuses  delivery statuses fed from WhatsApp callbacks (hosted relay)
 */
import { join } from 'node:path';
import { check, ChausarError } from '../contracts.ts';
import type { Context } from '../contracts.ts';
import type { EngineModule, ModuleHost } from './types.ts';
import { peekModuleState, moduleState } from './types.ts';
import { realDialer, realTransport } from '../writeback/http.ts';
import { initState, MODULE_ID, ownCredential, readState, WritebackService, type SecondAsk, type Settings, type WritebackState } from '../writeback/service.ts';
import { ConnectorCredentialStore } from '../connectors-ext/credentials.ts';
import type { WhatsAppStatus } from '../writeback/systems/whatsapp.ts';
import { installedAdapters } from '../writeback/systems/index.ts';
import { qualify, qualifySandbox, runPractice } from '../writeback/practice.ts';
import { checkPaid, consents, FOLLOW_UP, inbound, journal, journalSent, prepareReminder, recordConsent, reminderEvidence, type FollowUpHost } from '../writeback/follow-up.ts';
import type { FakeBundle } from '../writeback/practice.ts';
import type { Dialer, SystemId, Transport, WriteCredentials } from '../writeback/types.ts';
import { audit } from '../contracts.ts';
import { current } from '../actions.ts';
import { instant, integer, list, record, text } from '../writeback/validate.ts';
import { capsView, overview } from '../writeback/overview.ts';

/** Practice connections keep their fake systems for the life of the app, per workspace. */
const practiceWorlds = new Map<string, Map<SystemId, FakeBundle>>();
/** Single-use second-ask grants for this app run; never written to the vault. */
const secondAsks = new Map<string, SecondAsk>();
const reauthFailures = new Map<string, { count: number; since: number }>();
/**
 * Per-member approval secrets (core-gateway-auth), called as the same caller:
 *   auth.approvalSecret.status {}          → { set: boolean }   (this member has their own secret)
 *   auth.approvalSecret.verify { secret }  → { verified: boolean }
 * A missing method means the store is not installed: the owner's vault passphrase stays the second ask.
 */
const ABSENT = ['UNKNOWN_METHOD', 'METHOD_UNAVAILABLE'];
export function memberSecrets(host: ModuleHost) {
  return {
    async available(_ctx: Context) {
      try { const reply = await host.call('auth.approvalSecret.status', {}); return record(reply, ['set'], []).set === true; }
      catch (error) { if (error instanceof ChausarError && ABSENT.includes(error.code)) return false; throw error; }
    },
    async verify(_ctx: Context, secret: string) {
      const reply = record(await host.call('auth.approvalSecret.verify', { secret }), ['verified']);
      check(typeof reply.verified === 'boolean', 'WRITE_REPLY_INVALID', 'The approval secret check sent an answer Chausar cannot read.');
      return reply.verified;
    },
  };
}
/** WhatsApp delivery statuses: a host option, else the hosted relay through hosted.messageStatuses, else none. */
function statusSource(host: ModuleHost, option: unknown) {
  return async (_ctx: unknown, query: { reference: string; messageId: string | null }): Promise<WhatsAppStatus[]> => {
    if (typeof option === 'function') return option(_ctx, query);
    let reply: unknown;
    try { reply = await host.call('hosted.messageStatuses', { reference: query.reference, messageId: query.messageId }); }
    catch (error) { if (error instanceof ChausarError && ['UNKNOWN_METHOD', 'METHOD_UNAVAILABLE', 'INVALID_REQUEST'].includes(error.code)) return []; throw error; }
    check(Array.isArray(reply) && reply.length <= 100, 'WRITE_REPLY_INVALID', 'The relay sent statuses Chausar cannot read.');
    return reply.map(item => {
      const r = record(item, ['messageId', 'status', 'at', 'reference']);
      check(['sent', 'delivered', 'read', 'failed'].includes(String(r.status)), 'WRITE_REPLY_INVALID', 'The relay sent an unknown status.');
      return { messageId: text(r.messageId, 200, /^[A-Za-z0-9._=:+\/-]{1,200}$/), status: r.status as WhatsAppStatus['status'], at: instant(r.at), reference: text(r.reference, 40, /^CHS-[0-9A-F]{16}$/) };
    });
  };
}

/** Practice systems load only when first used, so the app runs without them. */
let fakes: typeof import('../../fakes/index.ts') | null = null;
async function practiceKit() { fakes ??= await import('../../fakes/index.ts'); return fakes; }
/** The write-back day: a trusted host option, else the workspace time zone (core-data), else India. */
export function writebackZone(host: ModuleHost): string {
  const valid = (zone: unknown): zone is string => { if (typeof zone !== 'string' || zone.length > 64) return false; try { new Intl.DateTimeFormat('en', { timeZone: zone }); return true; } catch { return false; } };
  const option = (host.options as any).timeZone, workspace = (host.store.read().workspace as { timeZone?: unknown }).timeZone;
  return valid(option) ? option : valid(workspace) ? workspace : 'Asia/Kolkata';
}
function services(host: ModuleHost) {
  const o = host.options as Record<string, any>;
  const clock = typeof o.clock === 'function' ? o.clock as () => string : () => new Date().toISOString();
  const timeZone = writebackZone(host);
  let follow: FollowUpHost;
  const service = new WritebackService(host.store, {
    http: (typeof o.http === 'function' ? o.http : realTransport) as Transport, dial: (typeof o.dial === 'function' ? o.dial : realDialer) as Dialer,
    credentials: typeof o.credentials === 'function' ? o.credentials as WriteCredentials : undefined,
    clock, directory: host.directory, demo: host.demo, adapters: installedAdapters({ whatsappStatuses: statusSource(host, o.whatsappStatuses) as any }),
    verifyPassphrase: typeof (host.store as any).verifyPassphrase === 'function' ? (secret: string) => (host.store as any).verifyPassphrase(secret) : typeof o.verifyPassphrase === 'function' ? o.verifyPassphrase as (secret: string) => Promise<boolean> : undefined,
    secondAsk: secondAsks, reauthFailures, memberSecrets: memberSecrets(host),
    practice: (workspaceId, connection) => {
      check(fakes, 'PRACTICE_UNAVAILABLE', 'Practice systems are not installed in this app.'); const { fakeFactory } = fakes;
      const world = practiceWorlds.get(workspaceId) ?? new Map<SystemId, FakeBundle>(); practiceWorlds.set(workspaceId, world);
      if (!world.has(connection.system)) world.set(connection.system, fakeFactory(connection.system, clock));
      const bundle = world.get(connection.system)!;
      return { http: bundle.fake.transport ?? (async () => { throw new Error('no http'); }), dial: bundle.fake.dial ?? (async () => { throw new Error('no mail'); }), secret: bundle.secret };
    },
    evidence: { [FOLLOW_UP]: (ctx, envelope) => reminderEvidence(follow, ctx, envelope) },
    settled: (ctx, action, envelope) => journalSent(follow, ctx, action, envelope),
  });
  follow = { service, calculator: host.services.calculator, timeZone };
  return { service, follow };
}
const ws = (host: ModuleHost) => services(host).service;
/** Loads the practice kit first when this workspace has a practice connection. */
async function ready(host: ModuleHost) {
  if ((peekModuleState<WritebackState>(host.store.read(), MODULE_ID)?.connections ?? []).some(c => c.environment === 'practice')) await practiceKit();
  return services(host);
}

async function configure(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  const p = record(payload, [], ['approvalHours', 'reminderCapPerCustomer', 'reminderCapPerDay', 'stopWords']);
  return host.store.update(state => {
    current(state, ctx, 'admin'); check(!ctx.sourceTainted, 'TAINTED_APPROVAL', 'Imported text cannot change limits.');
    const settings: Settings = moduleState(state, MODULE_ID, initState).settings;
    if (p.approvalHours !== undefined) {
      const hours = record(p.approvalHours, [], ['inside-undoable', 'seen-outside', 'money', 'cannot-undo']);
      for (const [kind, value] of Object.entries(hours)) settings.approvalHours[kind as keyof Settings['approvalHours']] = integer(value, 1, 24 * 30);
    }
    if (p.reminderCapPerCustomer !== undefined) settings.reminderCapPerCustomer = integer(p.reminderCapPerCustomer, 0, 5);
    if (p.reminderCapPerDay !== undefined) settings.reminderCapPerDay = integer(p.reminderCapPerDay, 0, 500);
    if (p.stopWords !== undefined) settings.stopWords = list(p.stopWords, 20, item => text(item, 40));
    audit(state, 'writeback.settings', { fields: Object.keys(p) });
    return structuredClone(settings);
  });
}

/**
 * Start-up options for the installed app when the host passes none. Credentials live in the same
 * sealed store connectors-ext uses (connector-credentials in the app folder), so one sign-in serves a
 * linked connection's reads and writes; a connection with no read side (mail) keeps its own entry.
 * Demo mode installs none. Writing still needs the owner's per-action write grant.
 */
export function writebackHostOptions(input: { directory: string; demo: boolean; env: Readonly<Record<string, string | undefined>> }): Record<string, unknown> {
  const options: Record<string, unknown> = {};
  const zone = input.env.CHAUSAR_WRITEBACK_TIME_ZONE;
  if (typeof zone === 'string' && /^[A-Za-z_]+\/[A-Za-z_+-]+$/.test(zone)) options.timeZone = zone;
  if (input.demo) return options;
  const store = new ConnectorCredentialStore(join(input.directory, 'connector-credentials'));
  options.credentialStore = store;
  // Reads the sealed entry directly and never refreshes a sign-in: connectors-ext owns refresh, so two
  // modules never race to spend the same refresh token.
  options.credentials = (async (_ctx, scope) => {
    check(scope.environment !== 'practice', 'WRITE_CREDENTIALS_UNAVAILABLE', 'Practice connections never use real credentials.');
    const item = store.get(scope.sourceId);
    check(item && (item.system === scope.group || scope.group.startsWith(`${item.system}-`)), 'WRITE_CREDENTIALS_UNAVAILABLE', 'Sign in to this system, or enter its key, first.');
    if (item.kind === 'key') return credentialFields(scope.system, item.secret);
    check(!item.expiresAt || Date.parse(item.expiresAt) - 60_000 > Date.now(), 'WRITE_SIGN_IN_EXPIRED', 'The sign-in for this system has expired. Read from it once under Connectors to renew it, then try again.');
    return credentialFields(scope.system, item.accessToken);
  }) satisfies WriteCredentials;
  return options;
}
/** One stored secret per connection; key pairs are stored as `id:secret` (the connectors-ext convention). */
export function credentialFields(system: SystemId, token: string): Record<string, string> {
  check(typeof token === 'string' && token.length > 0 && token.length <= 8192 && !/[\r\n]/.test(token), 'WRITE_CREDENTIALS_UNAVAILABLE', 'The stored credential is not usable.');
  if (system !== 'razorpay' && system !== 'mail') return { accessToken: token };
  const at = token.indexOf(':'); check(at > 0 && at < token.length - 1, 'WRITE_CREDENTIALS_UNAVAILABLE', 'This system needs both parts of its key, written as id:secret.');
  return system === 'razorpay' ? { keyId: token.slice(0, at), keySecret: token.slice(at + 1) } : { username: token.slice(0, at), password: token.slice(at + 1) };
}
function trusted(ctx: Context) { check((ctx.channel === undefined || ctx.channel === 'desktop') && ctx.sourceTainted !== true, 'OPEN_DESKTOP', 'Do this yourself in the desktop app.'); }
function ownConnection(ctx: Context, host: ModuleHost, connectionId: unknown, revokedToo = false) {
  const connection = readState(host.store.read()).connections.find(c => c.id === connectionId && (revokedToo || !c.revokedAt));
  check(connection, 'WRITE_CONNECTION_NOT_FOUND', 'That connection does not exist.');
  check(!connection.link, 'WRITE_CREDENTIAL_LINKED', 'This connection uses the sign-in of its linked read connection. Change it under Connectors.');
  check(connection.environment !== 'practice', 'INVALID_REQUEST', 'A practice connection never uses a real credential.');
  const store = (host.options as any).credentialStore as ConnectorCredentialStore | undefined; check(store, 'CREDENTIAL_STORE_REQUIRED', 'The local credential store is not available in this launch.');
  void ctx; return { connection, store };
}
async function credentialsSet(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  trusted(ctx); const p = record(payload, ['connectionId', 'secret']);
  const { connection, store } = ownConnection(ctx, host, p.connectionId);
  check(typeof p.secret === 'string' && p.secret.length >= 4 && p.secret.length <= 4096 && !/[\u0000-\u001f]/.test(p.secret), 'CREDENTIAL_INVALID', 'Paste the key exactly as the system shows it.');
  credentialFields(connection.system, p.secret);
  store.set(ownCredential(connection), { kind: 'key', system: connection.system, secret: p.secret, storedAt: new Date().toISOString() });
  await host.store.update(state => { current(state, ctx, 'admin'); audit(state, 'writeback.credential-stored', { connectionId: connection.id }); });
  return { stored: true, connectionId: connection.id };
}
async function credentialsRemove(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  trusted(ctx); const p = record(payload, ['connectionId']); const { connection, store } = ownConnection(ctx, host, p.connectionId, true);
  const removed = store.remove(ownCredential(connection));
  await host.store.update(state => { current(state, ctx, 'admin'); audit(state, 'writeback.credential-removed', { connectionId: connection.id }); });
  return { removed, connectionId: connection.id };
}
function credentialsStatus(ctx: Context, _payload: Record<string, any>, host: ModuleHost) {
  const store = (host.options as any).credentialStore as ConnectorCredentialStore | undefined;
  const member = host.store.read().members.find(m => m.id === ctx.memberId);
  const visible = (branch: string) => Boolean(member && (member.branches.includes('*') || member.branches.includes(branch)));
  const present = (sourceId: string) => { try { return store ? store.has(sourceId).present : false; } catch { return 'unreadable' as const; } };
  return readState(host.store.read()).connections.filter(c => !c.revokedAt && (!c.link || visible(c.link.branch)))
    .map(c => ({ connectionId: c.id, linked: Boolean(c.link), present: c.environment === 'practice' ? true : present(ownCredential(c)) }));
}

export const writebackModule: EngineModule = {
  id: 'writeback',
  hostOptions: writebackHostOptions,
  methods: {
    'writeback.catalogue': { permission: 'read', handler: (ctx, _p, host) => ws(host).catalogue(ctx) },
    'writeback.catalogueEntry': { permission: 'read', handler: (ctx, p, host) => ws(host).catalogueEntry(ctx, p.system, p.action) },
    'writeback.wanted': { permission: 'read', handler: (ctx, _p, host) => ws(host).wanted(ctx) },
    'writeback.request': { permission: 'prepare', handler: (ctx, p, host) => { const s = ws(host); const row = s.catalogue(ctx).find(r => r.system === p.system && r.action === p.action); return row ?? s.refuseUnlisted(ctx, p.system, p.action); } },
    'writeback.settings': { permission: 'read', handler: (_ctx, _p, host) => structuredClone((peekModuleState<WritebackState>(host.store.read(), MODULE_ID) ?? initState()).settings) },
    'writeback.configure': { permission: 'admin', handler: configure },
    'writeback.credentials.set': { permission: 'admin', handler: credentialsSet },
    'writeback.credentials.remove': { permission: 'admin', handler: credentialsRemove },
    'writeback.credentials.status': { permission: 'read', handler: credentialsStatus },
    'writeback.overview': { permission: 'read', handler: (ctx, _p, host) => {
      const store = (host.options as any).credentialStore as ConnectorCredentialStore | undefined;
      return overview(ws(host), ctx, sourceId => { if (!store) return false; try { return store.has(sourceId).present; } catch { return 'unreadable'; } });
    } },
    'writeback.caps': { permission: 'read', handler: (ctx, _p, host) => capsView(ws(host), ctx, writebackZone(host)) },
    'writeback.connections': { permission: 'read', handler: (ctx, _p, host) => ws(host).connections(ctx) },
    'writeback.connect': { permission: 'admin', handler: async (ctx, p, host) => { if (p.environment === 'practice') await practiceKit(); return ws(host).connect(ctx, p); } },
    'writeback.grant': { permission: 'admin', handler: (ctx, p, host) => ws(host).grant(ctx, p) },
    'writeback.disconnect': { permission: 'admin', handler: async (ctx, p, host) => {
      const removed = await ws(host).disconnect(ctx, p.connectionId);
      // A connection's own secret leaves with it; a linked sign-in stays with its read connection.
      const store = (host.options as any).credentialStore as ConnectorCredentialStore | undefined;
      if (store && !removed.link && removed.environment !== 'practice') store.remove(ownCredential(removed));
      return removed;
    } },
    'writeback.prepare': { permission: 'prepare', handler: async (ctx, p, host) => (await ready(host)).service.prepare(ctx, { connectionId: p.connectionId, action: p.action, payload: p.payload, intentId: p.intentId, sourceIds: p.sourceIds, sourceTainted: p.sourceTainted }) },
    'writeback.change': { permission: 'prepare', handler: async (ctx, p, host) => (await ready(host)).service.change(ctx, p.id, p.payload) },
    'writeback.reauth': { permission: 'approve', handler: async (ctx, p, host) => (await ready(host)).service.reauth(ctx, p.id, p.digest, p.passphrase) },
    'writeback.approve': { permission: 'approve', handler: async (ctx, p, host) => (await ready(host)).service.approve(ctx, p.id, p.digest, p.secondAsk) },
    'writeback.drop': { permission: 'approve', handler: (ctx, p, host) => ws(host).drop(ctx, p.id) },
    'writeback.execute': { permission: 'prepare', handler: async (ctx, p, host) => (await ready(host)).service.execute(ctx, p.id) },
    'writeback.readBack': { permission: 'prepare', handler: async (ctx, p, host) => (await ready(host)).service.readBack(ctx, p.id) },
    'writeback.settle': { permission: 'approve', handler: async (ctx, p, host) => (await ready(host)).service.settle(ctx, p.id, p.said) },
    'writeback.reconcile': { permission: 'admin', handler: async (ctx, _p, host) => (await ready(host)).service.reconcileAll(ctx) },
    'writeback.afterRestore': { permission: 'read', handler: (ctx, _p, host) => ws(host).afterRestore(ctx) },
    'writeback.ledger': { permission: 'read', handler: (ctx, p, host) => ws(host).ledger(ctx, p) },
    'writeback.get': { permission: 'read', handler: (ctx, p, host) => ws(host).get(ctx, p.id) },
    'writeback.practice': { permission: 'prepare', handler: async (ctx, p, host) => runPractice(ws(host), ctx, p, (await practiceKit()).fakeFactory) },
    'writeback.practiceRuns': { permission: 'read', handler: (_ctx, _p, host) => structuredClone((peekModuleState<WritebackState>(host.store.read(), MODULE_ID) ?? initState()).practiceRuns) },
    'writeback.qualify': { permission: 'admin', handler: async (ctx, _p, host) => { const kit = await practiceKit(); return qualify(ws(host), ctx, kit.qualificationCases, kit.fakeFactory); } },
    'writeback.qualifySandbox': { permission: 'admin', external: true, handler: async (ctx, p, host) => qualifySandbox((await ready(host)).service, ctx, p) },
    'writeback.followUp.consent': { permission: 'prepare', handler: (ctx, p, host) => recordConsent(services(host).follow, ctx, p) },
    'writeback.followUp.consents': { permission: 'read', handler: (ctx, _p, host) => consents(services(host).follow, ctx) },
    'writeback.followUp.prepare': { permission: 'prepare', handler: async (ctx, p, host) => prepareReminder((await ready(host)).follow, ctx, p) },
    'writeback.followUp.inbound': { permission: 'approve', handler: async (ctx, p, host) => inbound((await ready(host)).follow, ctx, p) },
    'writeback.followUp.checkPaid': { permission: 'prepare', handler: (ctx, p, host) => checkPaid(services(host).follow, ctx, p) },
    'writeback.followUp.journal': { permission: 'read', handler: (ctx, _p, host) => journal(services(host).follow, ctx) },
  },
  purge(state, reason) {
    const wb = peekModuleState<WritebackState>(state, MODULE_ID); if (!wb) return 0;
    const sources = new Set(reason.sourceIds); let removed = 0;
    const keep = <T>(items: T[], gone: (item: T) => boolean) => { const kept = items.filter(item => !gone(item)); removed += items.length - kept.length; return kept; };
    wb.consents = keep(wb.consents ?? [], c => c.sourceId !== null && sources.has(c.sourceId));
    wb.journal = keep(wb.journal ?? [], j => j.sourceIds.some(s => sources.has(s)) || (j.actionId !== null && reason.removedIds.has(j.actionId)));
    wb.attestations = keep(wb.attestations ?? [], a => reason.removedIds.has(a.actionId));
    wb.notices = keep(wb.notices ?? [], n => reason.removedIds.has(n.actionId));
    wb.practiceRuns = keep(wb.practiceRuns ?? [], r => r.actionId !== null && reason.removedIds.has(r.actionId));
    for (const map of [wb.preparedAt ?? {}, wb.approvedAt ?? {}, wb.tainted ?? {}] as Record<string, unknown>[]) for (const id of Object.keys(map)) if (reason.removedIds.has(id)) { delete map[id]; removed += 1; }
    return removed;
  },
  /** With autonomy on: drop expired yeses and expired preparations, and look at unknown results. Never sends. */
  async tick(ctx, host) {
    const wb = peekModuleState<WritebackState>(host.store.read(), MODULE_ID);
    const pending = (host.store.read().actions as any[]).filter(a => typeof a.connector === 'string' && a.connector.startsWith('wb-') && ['prepared', 'approved', 'unknown'].includes(a.status));
    if (!wb || pending.length === 0) return [];
    const { service } = await ready(host); const expired = await service.expireAll(ctx);
    const unknown = pending.some(a => a.status === 'unknown') && !host.demo ? (await service.reconcileAll(ctx).catch(() => null))?.reconciled ?? [] : [];
    return expired.length || unknown.length ? [{ module: 'writeback', expired, looked: unknown }] : [];
  },
};
