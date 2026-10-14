import { audit, check } from '../contracts.ts';
import type { Context } from '../contracts.ts';
import type { MethodSpec, ModuleHost } from '../modules/types.ts';
import { agreement, ALWAYS_WAITS, autoRun, DEFAULT_DAILY_COUNT, kindTable, routine, today, usedToday } from './autonomy.ts';
import type { JobsExtSettings } from './state.ts';
import { lane, peekLane } from './state.ts';

type Preset = 'ask-everything' | 'routine' | 'all-but-always-waits';
const PRESETS = new Set<Preset>(['ask-everything', 'routine', 'all-but-always-waits']);
const CAPS: Partial<Record<keyof JobsExtSettings, [number, number]>> = { activeJobCap: [1, 50], failureLimit: [1, 10], reminderPerCustomerPerDay: [1, 5], reminderPerDay: [1, 200], groupMax: [1, 50] };

function fields(payload: unknown, allowed: string[], code: string) {
  check(payload && typeof payload === 'object' && !Array.isArray(payload) && Object.keys(payload).every(key => allowed.includes(key)), code, 'The request has fields this method does not take.');
  return payload as Record<string, any>;
}
const appOnly = (ctx: Context) => check(!ctx.sourceTainted && ctx.channel !== 'phone', 'APP_APPROVAL_REQUIRED', 'Change what runs on its own inside the app.');

/** The engine's module tick: auto-runs switched-on kinds while the master switch is on. */
export const autonomyTick = (ctx: Context, host: ModuleHost): Promise<unknown[]> => autoRun(ctx, host);

/** jobsx.autonomy*: the per-kind autonomy switch, the always-waits list, daily caps and agreement. */
export const autonomyMethods: Record<string, MethodSpec> = {
  'jobsx.autonomy': { permission: 'read', async handler(ctx, payload, host) {
    fields(payload, [], 'INVALID_AUTONOMY');
    const table = await kindTable(ctx, host); const state = host.store.read(); const ns = peekLane(state); const day = today(host); const agreed = agreement(state);
    return {
      master: state.policy.autonomy === true, preset: ns.autonomy.preset,
      kinds: [...table.values()].sort((a, b) => a.kind.localeCompare(b.kind)).map(row => {
        const entry = ns.autonomy.kinds[row.kind];
        return { kind: row.kind, title: row.title, impact: row.impact, switchable: row.switchable, on: row.switchable && entry?.on === true,
          dailyCount: entry?.dailyCount ?? DEFAULT_DAILY_COUNT, usedToday: usedToday(state, row.kind, day), agreement: agreed.get(row.kind) ?? { approved: 0, declined: 0 } };
      }),
      alwaysWaits: { intro: ALWAYS_WAITS.intro, items: [...ALWAYS_WAITS.items] }, caps: ns.settings,
    };
  } },
  'jobsx.setAutonomy': { permission: 'admin', async handler(ctx, payload, host) {
    appOnly(ctx); const body = fields(payload, ['kind', 'on', 'dailyCount'], 'INVALID_AUTONOMY');
    check(typeof body.kind === 'string' && body.kind.length > 0 && body.kind.length <= 200, 'INVALID_AUTONOMY', 'Name one kind of action.');
    check(typeof body.on === 'boolean', 'INVALID_AUTONOMY', 'Say whether the switch is on or off.');
    const dailyCount = body.dailyCount ?? DEFAULT_DAILY_COUNT;
    check(Number.isSafeInteger(dailyCount) && dailyCount >= 1 && dailyCount <= 100, 'INVALID_AUTONOMY', 'The daily count is a whole number from 1 to 100.');
    const row = (await kindTable(ctx, host)).get(body.kind);
    check(row, 'UNSUPPORTED_ACTION', 'This action is absent from the written connector catalogue.');
    check(!body.on || row.switchable, 'ALWAYS_WAITS', 'This always waits for a person. It has no switch.');
    return host.store.update(state => {
      const ns = lane(state);
      if (row.switchable) ns.autonomy.kinds[row.kind] = { on: body.on, dailyCount }; else delete ns.autonomy.kinds[row.kind];
      ns.autonomy.preset = 'custom';
      audit(state, 'jobsx.autonomy.changed', { kind: row.kind, on: body.on && row.switchable, dailyCount, memberId: ctx.memberId });
      return { kind: row.kind, on: body.on && row.switchable, dailyCount, preset: ns.autonomy.preset };
    });
  } },
  'jobsx.autonomyPreset': { permission: 'admin', async handler(ctx, payload, host) {
    appOnly(ctx); const body = fields(payload, ['preset'], 'INVALID_AUTONOMY');
    check(PRESETS.has(body.preset), 'INVALID_AUTONOMY', 'Choose ask everything, routine, or all but the always-waits list.');
    const preset = body.preset as Preset; const table = await kindTable(ctx, host);
    return host.store.update(state => {
      const ns = lane(state); const kinds: typeof ns.autonomy.kinds = {};
      for (const row of table.values()) if (row.switchable) {
        const on = preset === 'all-but-always-waits' || (preset === 'routine' && routine(row));
        kinds[row.kind] = { on, dailyCount: preset === 'routine' ? DEFAULT_DAILY_COUNT : ns.autonomy.kinds[row.kind]?.dailyCount ?? DEFAULT_DAILY_COUNT };
      }
      ns.autonomy.kinds = kinds; ns.autonomy.preset = preset;
      audit(state, 'jobsx.autonomy.preset', { preset, memberId: ctx.memberId });
      return { preset, on: Object.entries(kinds).filter(([, entry]) => entry.on).map(([kind]) => kind).sort() };
    });
  } },
  'jobsx.caps': { permission: 'read', handler(ctx, payload, host) {
    fields(payload, [], 'INVALID_CAPS'); return peekLane(host.store.read()).settings;
  } },
  'jobsx.setCaps': { permission: 'admin', async handler(ctx, payload, host) {
    appOnly(ctx); const body = fields(payload, Object.keys(CAPS), 'INVALID_CAPS');
    check(Object.keys(body).length > 0, 'INVALID_CAPS', 'Name at least one limit to change.');
    for (const [key, value] of Object.entries(body)) {
      const [low, high] = CAPS[key as keyof JobsExtSettings]!;
      check(Number.isSafeInteger(value) && value >= low && value <= high, 'INVALID_CAPS', 'Each limit is a whole number inside its allowed range.');
    }
    return host.store.update(state => {
      const ns = lane(state); Object.assign(ns.settings, body);
      audit(state, 'jobsx.caps.changed', { fields: Object.keys(body).sort(), memberId: ctx.memberId });
      return structuredClone(ns.settings);
    });
  } },
};
