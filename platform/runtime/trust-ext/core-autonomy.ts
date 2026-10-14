/** TR-05 Do: presets, per-kind switches with daily limits, the fixed always-waits list, and caps. */
import { authorize, audit, check } from '../contracts.ts';
import type { Context, State } from '../contracts.ts';
import type { ModuleHost } from '../modules/types.ts';
import { actionKinds, coreState, defaultCaps, peekCore } from './core-state.ts';
import type { Caps, KindRule, Preset } from './core-state.ts';

/** Fixed: no switches, and nothing here ever runs on its own. */
export const alwaysWaits = [
  { id: 'cannot-undo', words: 'Anything that cannot be undone, and in particular:' },
  { id: 'money', words: 'Money: paying, collecting, refunding or moving it.' },
  { id: 'outside-messages', words: 'Messages to people outside the business.' },
  { id: 'deleting', words: 'Deleting anything.' },
  { id: 'prices', words: 'Changing prices.' },
  { id: 'stock', words: 'Changing stock.' },
  { id: 'listings', words: 'Changing listings.' },
  { id: 'sharing', words: 'Sharing.' },
  { id: 'outside-invites', words: 'Invites to people outside the business.' },
  { id: 'webhooks', words: 'Webhooks.' },
  { id: 'tax-filings', words: 'Tax filings: Chausar prepares them only; you or your CA files them.' },
] as const;
const waitIds = new Set<string>(alwaysWaits.map(w => w.id));
export const presets: Record<Exclude<Preset, 'custom'>, string[]> = {
  'ask-everything': [], routine: ['reminder', 'brief', 'sheet-update', 'calendar-event', 'report'], 'all-but-waits': actionKinds.map(k => k.kind),
};

export function kindRules(state: State): KindRule[] {
  const stored = peekCore(state).autonomy?.kinds ?? {};
  return actionKinds.map(base => ({ ...base, ...(stored[base.kind] ?? {}), kind: base.kind }));
}
const caps = (state: State): Caps => ({ ...defaultCaps, ...(peekCore(state).autonomy?.caps ?? {}) });

const kindOf = (action: any): string => String(action.kind ?? action.operation ?? '');
const matches = (kind: string, action: any) => { const k = kindOf(action).toLowerCase(); return k === kind || k.includes(kind.split('-')[0].replace(/s$/, '')); };
const decided = (action: any) => action.approval || ['approved', 'executing', 'verified', 'unknown'].includes(action.status) ? true : action.status === 'cancelled' ? false : null;
const amountOf = (action: any): string | null => { const v = action.payload?.amountMinor; return typeof v === 'string' && /^\d+$/.test(v) ? v : null; };

/** How often the kind's limits would have made the same call as the person, from decided actions of that kind. */
function agreement(state: State, rule: KindRule) {
  let agreed = 0, total = 0;
  for (const action of state.actions) {
    if (!matches(rule.kind, action)) continue; const approved = decided(action); if (approved === null) continue;
    const amount = amountOf(action); const within = amount === null || BigInt(amount) === 0n || (rule.maxAmountMinorPerDay !== null && BigInt(amount) <= BigInt(rule.maxAmountMinorPerDay));
    total++; if (within === approved) agreed++;
  }
  return total ? { agreed, total } : null;
}

export function autonomyView(state: State) {
  return { preset: peekCore(state).autonomy?.preset ?? 'ask-everything', kinds: kindRules(state).map(rule => ({ ...rule, agreement: agreement(state, rule) })),
    alwaysWaits: alwaysWaits.map(w => ({ ...w })), caps: caps(state) };
}

/** The gate other lanes call before anything runs on its own. `amountMinor` is the day's total for this kind including this one. */
export function autonomyDecision(state: State, input: { kind: string; amountMinor?: string | null; countToday: number; customerCountToday?: number }): { allowed: boolean; reason: string } {
  if (waitIds.has(input.kind)) return { allowed: false, reason: 'ALWAYS_WAITS' };
  const rule = kindRules(state).find(k => k.kind === input.kind); if (!rule) return { allowed: false, reason: 'UNKNOWN_KIND' };
  if (!state.policy.autonomy) return { allowed: false, reason: 'AUTONOMY_OFF' };
  if (!rule.on) return { allowed: false, reason: 'KIND_OFF' };
  if (!Number.isInteger(input.countToday) || input.countToday < 0 || input.countToday >= rule.maxPerDay) return { allowed: false, reason: 'DAILY_COUNT' };
  const limits = caps(state);
  if (rule.kind === 'reminder') {
    if (input.countToday >= limits.remindersPerDay) return { allowed: false, reason: 'REMINDERS_PER_DAY' };
    if ((input.customerCountToday ?? 0) >= limits.remindersPerCustomerPerDay) return { allowed: false, reason: 'REMINDERS_PER_CUSTOMER' };
  }
  if (input.amountMinor !== undefined && input.amountMinor !== null) {
    if (typeof input.amountMinor !== 'string' || !/^\d+$/.test(input.amountMinor)) return { allowed: false, reason: 'INVALID_AMOUNT' };
    if (BigInt(input.amountMinor) > 0n) {
      if (rule.maxAmountMinorPerDay === null) return { allowed: false, reason: 'NO_AMOUNT_LIMIT' };
      if (BigInt(input.amountMinor) > BigInt(rule.maxAmountMinorPerDay)) return { allowed: false, reason: 'DAILY_AMOUNT' };
    }
  }
  return { allowed: true, reason: 'WITHIN_LIMITS' };
}

const paise = (v: unknown) => v === null || (typeof v === 'string' && /^\d{1,15}$/.test(v));
const count = (v: unknown, max: number) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= max;

export async function setAutonomy(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  check(payload.alwaysWaits === undefined && !waitIds.has(payload.kind?.kind) && !waitIds.has(payload.preset), 'ALWAYS_WAITS', 'Anything on the always-waits list always waits for you.');
  check(Object.keys(payload).every(k => ['preset', 'kind', 'caps', 'language'].includes(k)), 'INVALID_AUTONOMY', 'Change a preset, one kind, or the limits.');
  if (payload.preset !== undefined) check(Object.hasOwn(presets, payload.preset), 'INVALID_AUTONOMY', 'Choose ask everything, routine, or everything except what always waits.');
  const k = payload.kind;
  if (k !== undefined) {
    check(k && typeof k === 'object' && actionKinds.some(a => a.kind === k.kind), 'UNKNOWN_KIND', 'Choose a kind of action on this list.');
    check(k.on === undefined || typeof k.on === 'boolean', 'INVALID_AUTONOMY', 'A switch is on or off.');
    check(k.maxPerDay === undefined || count(k.maxPerDay, 1000), 'INVALID_AUTONOMY', 'A daily count is a whole number up to 1000.');
    check(k.maxAmountMinorPerDay === undefined || paise(k.maxAmountMinorPerDay), 'INVALID_AMOUNT', 'A daily amount is whole paise, or none.');
  }
  const c = payload.caps;
  if (c !== undefined) {
    check(c && typeof c === 'object' && Object.keys(c).every(key => Object.hasOwn(defaultCaps, key)), 'INVALID_AUTONOMY', 'Unknown limit.');
    check(c.remindersPerCustomerPerDay === undefined || count(c.remindersPerCustomerPerDay, 10), 'INVALID_AUTONOMY', 'Reminders per customer per day is a whole number up to 10.');
    check(c.remindersPerDay === undefined || count(c.remindersPerDay, 500), 'INVALID_AUTONOMY', 'Reminders per day is a whole number up to 500.');
    check(c.activeJobs === undefined || count(c.activeJobs, 100), 'INVALID_AUTONOMY', 'Active jobs is a whole number up to 100.');
    check(c.monthlyAiCapMinor === undefined || paise(c.monthlyAiCapMinor), 'INVALID_AMOUNT', 'The monthly AI cap is whole paise, or none.');
  }
  check(payload.preset !== undefined || k !== undefined || c !== undefined, 'INVALID_AUTONOMY', 'Change a preset, one kind, or the limits.');
  const anyOn = await host.store.update(state => {
    authorize({ read: () => state, update: host.store.update.bind(host.store) }, ctx, 'admin');
    const auto = coreState(state).autonomy;
    if (payload.preset !== undefined) { const on = presets[payload.preset as keyof typeof presets]; for (const rule of kindRules(state)) auto.kinds[rule.kind] = { ...(auto.kinds[rule.kind] ?? {}), on: on.includes(rule.kind) } as any; auto.preset = payload.preset; }
    if (k !== undefined) {
      const current = kindRules(state).find(r => r.kind === k.kind)!;
      auto.kinds[k.kind] = { on: k.on ?? current.on, maxPerDay: k.maxPerDay ?? current.maxPerDay, maxAmountMinorPerDay: k.maxAmountMinorPerDay === undefined ? current.maxAmountMinorPerDay : k.maxAmountMinorPerDay };
      auto.preset = 'custom';
    }
    if (c !== undefined) auto.caps = { ...caps(state), ...structuredClone(c) };
    audit(state, 'trustx.autonomy.changed', { memberId: ctx.memberId, preset: auto.preset, kind: k?.kind ?? null, caps: c ? Object.keys(c) : [] });
    return kindRules(state).some(r => r.on);
  });
  // Switching every kind off also stops the engine's scheduled work. Switching a kind on never starts it:
  // the engine's one autonomy switch would run every scheduled job, not only that kind.
  if (!anyOn && host.store.read().policy.autonomy) await host.services.trust.updatePolicy(ctx, { autonomy: false });
  return autonomyView(host.store.read());
}
