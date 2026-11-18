// Chausar venture launcher, chief: how much Chausar may use the owner's AI on its own each day. The daily review
// (review.ts) runs without the owner asking, on the owner's own AI plan or key, so the owner sets its allowance: how
// many times a day Chausar may ask the AI by itself, and on a key the most those calls may cost in a day. Both are the
// owner's settings with defaults, kept on the business; neither is a ceiling the owner cannot change. On the owner's
// Codex or Claude plan nothing is priced, so only the count holds, and the plan meter (models/plan-book.ts) holds a run
// while the plan is used up or past the owner's pause point; on a key the month's AI limit (money/spend.ts) holds too.
// When the allowance is used the review says so in one line, plans from the records and looks again the next day.
// The words are plan-view.ts's.
import { formatTime, ownerZone } from '../../owner-format.ts';
import { check, type State } from '../../contracts.ts';
import type { ChiefOwnUseView, ChiefPlanRecord, IsoDate, MicroString, ModelPresetId, VentureDeps, VentureRecord } from '../contracts.ts';
import { planHold } from '../agents/routine-runner.ts';
import { usdToMicros } from '../models/cost.ts';
import { planCliOf } from '../models/plan-book.ts';
import { CLI_LABELS } from '../models/presets.ts';
import { keyedPreset, METER_WORDS } from '../money/spend-meter.ts';
import { monthSpendNow } from '../money/spend.ts';
import { OWN_USE_DEFAULT, OWN_USE_RUNS_MAX, OWN_USE_WORDS, ownUseViewOf } from './plan-view.ts';

export type OwnUse = { runsPerDay: number; capMicros: MicroString };
export type OwnUsed = { runs: number; micros: bigint };

/** The owner's allowance, or the defaults. */
export function ownUseOf(venture: Pick<VentureRecord, 'chiefOwnUse'>): OwnUse {
  const saved = venture.chiefOwnUse;
  return saved ? { runsPerDay: saved.runsPerDay, capMicros: saved.capMicros } : { ...OWN_USE_DEFAULT };
}

/** What Chausar used on its own on a day of the owner's calendar; a count kept for another day is nothing today. */
export function ownUsedOn(record: Pick<ChiefPlanRecord, 'ownUse'> | null, today: IsoDate): OwnUsed {
  const kept = record?.ownUse;
  return kept && kept.day === today ? { runs: kept.runs, micros: BigInt(kept.micros) } : { runs: 0, micros: 0n };
}

/** The allowance the owner sent, checked: whole runs from 0 to 24, and the day's limit on a key typed in US dollars. */
export function ownUseInput(body: { runsPerDay?: unknown; cap?: unknown }, current: OwnUse): OwnUse {
  const next = { ...current };
  if (body.runsPerDay !== undefined) {
    check(Number.isInteger(body.runsPerDay) && (body.runsPerDay as number) >= 0 && (body.runsPerDay as number) <= OWN_USE_RUNS_MAX, 'INVALID_VENTURE_REQUEST', OWN_USE_WORDS.runsRange);
    next.runsPerDay = body.runsPerDay as number;
  }
  if (body.cap !== undefined) next.capMicros = usdToMicros(body.cap, { field: 'The daily limit', decimals: 2 });
  return next;
}

/**
 * Why Chausar may not ask the owner's AI on its own now, in one plain sentence, or null when it may. Read from the
 * owner's allowance, what was used today, the month's AI limit on a key, and the plan meter on a plan.
 */
export function ownUseHold(deps: VentureDeps, state: State, venture: VentureRecord, used: OwnUsed, presetId: ModelPresetId | null, nowIso: string): string | null {
  const allowance = ownUseOf(venture);
  if (allowance.runsPerDay === 0) return OWN_USE_WORDS.never;
  if (used.runs >= allowance.runsPerDay) return OWN_USE_WORDS.runs(used.runs);
  if (keyedPreset(presetId)) {
    if (used.micros >= BigInt(allowance.capMicros)) return OWN_USE_WORDS.cap(allowance.capMicros);
    const month = monthSpendNow(state, venture.id, nowIso);
    return month.capMicros !== null && BigInt(month.spentMicros) >= BigInt(month.capMicros) ? METER_WORDS.monthUsed : null;
  }
  const cli = planCliOf(presetId);
  const held = cli ? planHold(deps, venture, cli) : null;
  if (!cli || !held) return null;
  return OWN_USE_WORDS.plan(CLI_LABELS[cli], held.resetsAt ? formatTime(held.resetsAt, ownerZone(venture.country?.code, 'UTC')) : null);
}

/** What is left of the day's limit on a key, never below zero; null on a plan, where nothing is priced. */
export function ownUseLeftMicros(venture: VentureRecord, used: OwnUsed, presetId: ModelPresetId | null): MicroString | null {
  if (!keyedPreset(presetId)) return null;
  const left = BigInt(ownUseOf(venture).capMicros) - used.micros;
  return (left > 0n ? left : 0n).toString();
}

/** The allowance as the owner reads it (plan-view.ts ownUseViewOf), for the AI the chat goes to now. */
export function ownUseView(venture: VentureRecord, used: OwnUsed, presetId: ModelPresetId | null): ChiefOwnUseView {
  return ownUseViewOf(ownUseOf(venture), used.runs, keyedPreset(presetId));
}
