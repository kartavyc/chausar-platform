import type { EngineModule } from './types.ts';
import { audit, check, now, type Context } from '../contracts.ts';
import type { ModuleHost } from './types.ts';
import { addDays, capabilities, faultReport, firstRun, frameOf, help, phoneMessages, shell, status, updateFrame, validDay, worthALook } from '../frame-today/frame.ts';
import { activityFilter, activityPage, auditEvents, modelEvents } from '../frame-today/activity.ts';
import { checkIdentity, identityCard, identityFields } from '../frame-today/identity.ts';
import { setupChecklist } from '../frame-today/setup-rules.ts';

const keys = (payload: Record<string, unknown>, allowed: readonly string[]) =>
  check(Object.keys(payload).every(key => allowed.includes(key)), 'INVALID_TODAYX_REQUEST', 'This request has fields it does not use.');

async function clockSet(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  keys(payload, ['date']);
  check(validDay(payload.date), 'INVALID_TODAYX_REQUEST', 'Give the demo start date as YYYY-MM-DD.');
  await updateFrame(host, ctx, 'admin', (frame, state) => {
    check(state.workspace.demo === true, 'DEMO_CLOCK_REAL_WORKSPACE', 'This workspace is real. The demo clock is not available.');
    check(frame.clock === null, 'DEMO_CLOCK_ALREADY_SET', 'The demo clock start date is set once. Move it forward instead.');
    frame.clock = { date: payload.date, setAt: now() };
    audit(state, 'demo.clock-set', { memberId: ctx.memberId });
  });
  return shell(ctx, host);
}

async function clockAdvance(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  keys(payload, ['by']);
  check(payload.by === 'day' || payload.by === 'week', 'INVALID_TODAYX_REQUEST', 'Move the demo clock forward by a day or a week.');
  await updateFrame(host, ctx, 'admin', (frame, state) => {
    check(state.workspace.demo === true, 'DEMO_CLOCK_REAL_WORKSPACE', 'This workspace is real. The demo clock is not available.');
    check(frame.clock !== null, 'DEMO_CLOCK_NOT_SET', 'Set the demo start date first.');
    // Only forward: the date can only grow, so the clock never goes back.
    frame.clock = { date: addDays(frame.clock.date, payload.by === 'week' ? 7 : 1), setAt: frame.clock.setAt };
    audit(state, 'demo.clock-advanced', { memberId: ctx.memberId });
  });
  return shell(ctx, host);
}

/** Lane-owned engine methods. Only the owning lane edits this file. */
export const frameTodayModule: EngineModule = {
  id: 'frame-today',
  methods: {
    'todayx.shell': { permission: 'read', handler: (ctx, payload, host) => { keys(payload, []); return shell(ctx, host); } },
    'todayx.clock.set': { permission: 'admin', handler: clockSet },
    'todayx.clock.advance': { permission: 'admin', handler: clockAdvance },
    'todayx.jobsPaused.dismiss': { permission: 'read', handler: async (ctx, payload, host) => {
      keys(payload, []);
      await updateFrame(host, ctx, 'read', frame => { frame.jobsPausedDismissedAt[ctx.memberId] = now(); });
      return shell(ctx, host);
    } },
    'todayx.lock.settings': { permission: 'admin', handler: async (ctx, payload, host) => {
      keys(payload, ['minutes']);
      check(Number.isInteger(payload.minutes) && payload.minutes >= 1 && payload.minutes <= 240, 'INVALID_TODAYX_REQUEST', 'Choose between 1 and 240 minutes.');
      await updateFrame(host, ctx, 'admin', frame => { frame.autoLockMinutes = payload.minutes; });
      return shell(ctx, host);
    } },
    'todayx.status': { permission: 'read', handler: (ctx, payload, host) => { keys(payload, []); return status(ctx, host); } },
    'todayx.capabilities': { permission: 'read', handler: (_ctx, payload) => { keys(payload, []); return capabilities(); } },
    'todayx.worthALook': { permission: 'read', handler: (ctx, payload, host) => { keys(payload, []); return worthALook(ctx, host); } },
    'todayx.activity': { permission: 'read', handler: async (ctx, payload, host) => {
      const filter = activityFilter(payload);
      const receipts = (() => { try { return host.services.gateway?.receipts(ctx) ?? []; } catch { return []; } })();
      return activityPage([...auditEvents(host.store, ctx), ...modelEvents(host.store.read(), ctx, receipts)], filter);
    } },
    'todayx.firstRun.status': { permission: 'read', handler: async (ctx, payload, host) => {
      keys(payload, []);
      const { steps, blocked, leftThisComputer } = await firstRun(ctx, host);
      return { steps, blocked, leftThisComputer };
    } },
    'todayx.identity.check': { permission: 'read', handler: (_ctx, payload) => {
      keys(payload, ['fields']);
      return { fields: checkIdentity(identityFields(payload.fields)) };
    } },
    'todayx.identity.save': { permission: 'prepare', handler: (ctx, payload, host) => {
      keys(payload, ['fields', 'gstMode']);
      const card = identityCard(payload.fields, payload.gstMode, now());
      return updateFrame(host, ctx, 'prepare', (frame, state) => {
        frame.identity = card;
        audit(state, 'identity.saved', { memberId: ctx.memberId, rowCount: Object.keys(card.fields).length });
        return structuredClone(card);
      });
    } },
    'todayx.identity.get': { permission: 'read', handler: (_ctx, payload, host) => { keys(payload, []); return structuredClone(frameOf(host.store.read()).identity); } },
    'todayx.setupChecklist': { permission: 'read', handler: (_ctx, payload, host) => { keys(payload, []); return setupChecklist(frameOf(host.store.read()).identity); } },
    'todayx.help': { permission: 'read', handler: (_ctx, payload) => { keys(payload, []); return help(); } },
    'todayx.faultReport': { permission: 'read', handler: (ctx, payload, host) => { keys(payload, []); return faultReport(ctx, host); } },
    'todayx.phoneMessages': { permission: 'read', handler: (_ctx, payload, host) => { keys(payload, []); return phoneMessages(host); } },
  },
  /**
   * Nothing this module keeps is derived from a source: the identity card is typed by a person,
   * and the clock, lock and dismissal settings are workspace preferences. Activity and status are
   * computed on each call from records the engine itself purges, so no cache can outlive a source.
   */
  purge: () => 0,
};

