// C7 task 1: the AI plan meter. How much of the owner's Codex or Claude Code plan is used, read only from what the tools
// themselves report during real work: Codex's account/rateLimits/updated notification and account/rateLimits/read answer
// (Codex 0.166.0: { rateLimits: { primary, secondary: { usedPercent, windowDurationMins, resetsAt (unix seconds) },
// rateLimitReachedType } }), and Claude Code's rate_limit_event (rate_limit_info { status, rateLimitType, resetsAt,
// utilization }). Claude Code's experimental usage read is not used (the founder's answer, 5 Nov). Every reading keeps
// its source and read time; a percent outside 0 to 100, a reset that does not read, or a reset that has passed makes
// that window unknown. Nothing here guesses a figure, and an odd shape is unknown, never an error.
import type { DelegateCli, IsoTime } from '../contracts.ts';

export type PlanWindowKind = 'five-hour' | 'week';
export type PlanState = 'ok' | 'near' | 'used-up' | 'unknown';
export type PlanWindow = { kind: PlanWindowKind; usedPercent: number | null; resetsAt: IsoTime | null; state: PlanState };
export type PlanReading = { cli: DelegateCli; windows: PlanWindow[]; state: PlanState; source: 'codex' | 'claude-code'; readAt: IsoTime | null };

/** Codex reports a percent but no warning of its own: at or above this the window reads near (a Chausar choice). */
export const CODEX_NEAR_PERCENT = 80;
const KINDS: readonly PlanWindowKind[] = ['five-hour', 'week'];
const CODEX_WINDOW: Readonly<Record<number, PlanWindowKind>> = { 300: 'five-hour', 10_080: 'week' };
const CLAUDE_WINDOW: Readonly<Record<string, PlanWindowKind>> = { five_hour: 'five-hour', seven_day: 'week' };
const RANK: Readonly<Record<PlanState, number>> = { unknown: 0, ok: 1, near: 2, 'used-up': 3 };

const plain = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const time = (value: unknown): IsoTime | null => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(Date.parse(value)).toISOString() : null;
/** A reset as the tools send it: whole unix seconds (or milliseconds, if a tool ever sends them), else null. */
function resetTime(value: unknown): IsoTime | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  const ms = value < 1e12 ? value * 1000 : value, date = new Date(ms);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
const percent = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
const unknownWindow = (kind: PlanWindowKind): PlanWindow => ({ kind, usedPercent: null, resetsAt: null, state: 'unknown' });
function overall(windows: PlanWindow[]): PlanState {
  return windows.reduce<PlanState>((worst, window) => RANK[window.state] > RANK[worst] ? window.state : worst, 'unknown');
}
const sorted = (windows: PlanWindow[]) => [...windows].sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind));
function reading(cli: DelegateCli, windows: PlanWindow[], readAt: IsoTime | null): PlanReading {
  const live = readAt ? sorted(windows) : [];
  return { cli, windows: live, state: overall(live), source: cli, readAt };
}

/** Codex's rate-limit report (the notification's params, the read's answer, or the snapshot itself) as a reading. */
export function fromCodexLimits(raw: unknown, readAt: IsoTime): PlanReading {
  const snapshot = plain(raw) && plain(raw.rateLimits) ? raw.rateLimits : plain(raw) && ('primary' in raw || 'secondary' in raw) ? raw : null;
  const windows: PlanWindow[] = [];
  if (snapshot) {
    for (const slot of [snapshot.primary, snapshot.secondary]) {
      if (!plain(slot)) continue;
      const kind = typeof slot.windowDurationMins === 'number' ? CODEX_WINDOW[slot.windowDurationMins] : undefined;
      if (!kind || windows.some(window => window.kind === kind)) continue;
      const used = percent(slot.usedPercent), resetsAt = resetTime(slot.resetsAt);
      windows.push(used === null || resetsAt === null ? unknownWindow(kind) : { kind, usedPercent: used, resetsAt, state: used >= 100 ? 'used-up' : used >= CODEX_NEAR_PERCENT ? 'near' : 'ok' });
    }
    if (typeof snapshot.rateLimitReachedType === 'string' && windows.length && !windows.some(window => window.state === 'used-up')) {
      const fullest = windows.filter(window => window.usedPercent !== null).sort((a, b) => b.usedPercent! - a.usedPercent!)[0];
      if (fullest) fullest.state = 'used-up';
    }
  }
  return reading('codex', windows, time(readAt));
}

/** One Claude Code rate_limit_event's info as a reading: the five-hour and weekly windows only. */
export function fromClaudeLimit(info: unknown, readAt: IsoTime): PlanReading {
  const windows: PlanWindow[] = [];
  if (plain(info) && typeof info.rateLimitType === 'string' && CLAUDE_WINDOW[info.rateLimitType] && ['allowed', 'allowed_warning', 'rejected'].includes(info.status as string)) {
    const kind = CLAUDE_WINDOW[info.rateLimitType], resetsAt = resetTime(info.resetsAt);
    const used = info.utilization === undefined || info.utilization === null ? null : percent(info.utilization);
    const unreadable = resetsAt === null || (info.utilization !== undefined && info.utilization !== null && used === null);
    if (unreadable) windows.push(unknownWindow(kind));
    else windows.push({ kind, usedPercent: used, resetsAt, state: info.status === 'rejected' ? 'used-up' : info.status === 'allowed_warning' ? 'near' : 'ok' });
  }
  return reading('claude-code', windows, time(readAt));
}

/**
 * The meter kept per computer in engine memory. note() keeps the newest window of each kind per tool (a report names
 * one or two windows; the others stay as last read); read() turns a window whose reset has passed into unknown.
 */
export class PlanMeter {
  #kept = new Map<DelegateCli, { windows: PlanWindow[]; readAt: IsoTime }>();

  note(next: PlanReading): void {
    if (!next.readAt || !next.windows.length) return;
    const before = this.#kept.get(next.cli)?.windows ?? [];
    const windows = [...before.filter(window => !next.windows.some(fresh => fresh.kind === window.kind)), ...next.windows.map(window => ({ ...window }))];
    this.#kept.set(next.cli, { windows, readAt: next.readAt });
  }

  read(cli: DelegateCli, now: IsoTime): PlanReading {
    const kept = this.#kept.get(cli), at = Date.parse(now);
    if (!kept) return { cli, windows: [], state: 'unknown', source: cli, readAt: null };
    const windows = kept.windows.map(window => window.resetsAt !== null && Number.isFinite(at) && Date.parse(window.resetsAt) > at ? { ...window } : unknownWindow(window.kind));
    return reading(cli, windows, kept.readAt);
  }
}
