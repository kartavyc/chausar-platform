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
import { check } from '../contracts.ts';
import type { Context } from '../contracts.ts';
import type { EngineModule, ModuleHost } from './types.ts';
import { peekModuleState, moduleState } from './types.ts';
import { realDialer, realTransport } from '../writeback/http.ts';
import { initState, MODULE_ID, WritebackService, type Settings, type WritebackState } from '../writeback/service.ts';
import { installedAdapters } from '../writeback/systems/index.ts';
import { qualify, runPractice } from '../writeback/practice.ts';
import { checkPaid, consents, FOLLOW_UP, inbound, journal, journalSent, prepareReminder, recordConsent, reminderEvidence, type FollowUpHost } from '../writeback/follow-up.ts';
import { fakeFactory, qualificationCases } from '../../fakes/index.ts';
import type { FakeBundle } from '../writeback/practice.ts';
import type { Dialer, SystemId, Transport, WriteCredentials } from '../writeback/types.ts';
import { audit } from '../contracts.ts';
import { current } from '../actions.ts';
import { integer, list, record, text } from '../writeback/validate.ts';

/** Practice connections keep their fake systems for the life of the app, per workspace. */
const practiceWorlds = new Map<string, Map<SystemId, FakeBundle>>();

function services(host: ModuleHost) {
  const o = host.options as Record<string, any>;
  const clock = typeof o.clock === 'function' ? o.clock as () => string : () => new Date().toISOString();
  const timeZone = typeof o.timeZone === 'string' ? o.timeZone : 'Asia/Kolkata';
  let follow: FollowUpHost;
  const service = new WritebackService(host.store, {
    http: (typeof o.http === 'function' ? o.http : realTransport) as Transport, dial: (typeof o.dial === 'function' ? o.dial : realDialer) as Dialer,
    credentials: typeof o.credentials === 'function' ? o.credentials as WriteCredentials : undefined,
    clock, directory: host.directory, demo: host.demo, adapters: installedAdapters(typeof o.whatsappStatuses === 'function' ? { whatsappStatuses: o.whatsappStatuses } : {}),
    practice: (workspaceId, connection) => {
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

export const writebackModule: EngineModule = {
  id: 'writeback',
  methods: {
    'writeback.catalogue': { permission: 'read', handler: (ctx, _p, host) => ws(host).catalogue(ctx) },
    'writeback.catalogueEntry': { permission: 'read', handler: (ctx, p, host) => ws(host).catalogueEntry(ctx, p.system, p.action) },
    'writeback.wanted': { permission: 'read', handler: (ctx, _p, host) => ws(host).wanted(ctx) },
    'writeback.request': { permission: 'prepare', handler: (ctx, p, host) => { const s = ws(host); const row = s.catalogue(ctx).find(r => r.system === p.system && r.action === p.action); return row ?? s.refuseUnlisted(ctx, p.system, p.action); } },
    'writeback.settings': { permission: 'read', handler: (_ctx, _p, host) => structuredClone((peekModuleState<WritebackState>(host.store.read(), MODULE_ID) ?? initState()).settings) },
    'writeback.configure': { permission: 'admin', handler: configure },
    'writeback.connections': { permission: 'read', handler: (ctx, _p, host) => ws(host).connections(ctx) },
    'writeback.connect': { permission: 'admin', handler: (ctx, p, host) => ws(host).connect(ctx, p) },
    'writeback.grant': { permission: 'admin', handler: (ctx, p, host) => ws(host).grant(ctx, p) },
    'writeback.disconnect': { permission: 'admin', handler: (ctx, p, host) => ws(host).disconnect(ctx, p.connectionId) },
    'writeback.prepare': { permission: 'prepare', handler: (ctx, p, host) => ws(host).prepare(ctx, { connectionId: p.connectionId, action: p.action, payload: p.payload, intentId: p.intentId, sourceIds: p.sourceIds }) },
    'writeback.change': { permission: 'prepare', handler: (ctx, p, host) => ws(host).change(ctx, p.id, p.payload) },
    'writeback.approve': { permission: 'approve', handler: (ctx, p, host) => ws(host).approve(ctx, p.id, p.digest) },
    'writeback.drop': { permission: 'approve', handler: (ctx, p, host) => ws(host).drop(ctx, p.id) },
    'writeback.execute': { permission: 'prepare', handler: (ctx, p, host) => ws(host).execute(ctx, p.id) },
    'writeback.readBack': { permission: 'prepare', handler: (ctx, p, host) => ws(host).readBack(ctx, p.id) },
    'writeback.settle': { permission: 'approve', handler: (ctx, p, host) => ws(host).settle(ctx, p.id, p.said) },
    'writeback.reconcile': { permission: 'admin', handler: (ctx, _p, host) => ws(host).reconcileAll(ctx) },
    'writeback.afterRestore': { permission: 'read', handler: (ctx, _p, host) => ws(host).afterRestore(ctx) },
    'writeback.ledger': { permission: 'read', handler: (ctx, p, host) => ws(host).ledger(ctx, p) },
    'writeback.get': { permission: 'read', handler: (ctx, p, host) => ws(host).get(ctx, p.id) },
    'writeback.practice': { permission: 'prepare', handler: (ctx, p, host) => runPractice(ws(host), ctx, p, fakeFactory) },
    'writeback.practiceRuns': { permission: 'read', handler: (_ctx, _p, host) => structuredClone((peekModuleState<WritebackState>(host.store.read(), MODULE_ID) ?? initState()).practiceRuns) },
    'writeback.qualify': { permission: 'admin', handler: (ctx, _p, host) => qualify(ws(host), ctx, qualificationCases, fakeFactory) },
    'writeback.followUp.consent': { permission: 'prepare', handler: (ctx, p, host) => recordConsent(services(host).follow, ctx, p) },
    'writeback.followUp.consents': { permission: 'read', handler: (ctx, _p, host) => consents(services(host).follow, ctx) },
    'writeback.followUp.prepare': { permission: 'prepare', handler: (ctx, p, host) => prepareReminder(services(host).follow, ctx, p) },
    'writeback.followUp.inbound': { permission: 'approve', handler: (ctx, p, host) => inbound(services(host).follow, ctx, p) },
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
    for (const map of [wb.preparedAt ?? {}, wb.approvedAt ?? {}]) for (const id of Object.keys(map)) if (reason.removedIds.has(id)) { delete map[id]; removed += 1; }
    return removed;
  },
  /** With autonomy on: drop expired yeses and expired preparations, and look at unknown results. Never sends. */
  async tick(ctx, host) {
    const service = ws(host); const expired = await service.expireAll(ctx);
    let looked: unknown = null; try { if (!host.demo) looked = await service.reconcileAll(ctx); } catch { looked = null; }
    return [{ module: 'writeback', expired, looked }];
  },
};
