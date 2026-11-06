// C7 task 2: the plan meter kept for one engine (one computer), fed by the drivers during real work and by a used-up
// failure the tools named. A used-up failure gives no reset time, so it holds for USED_UP_HOLD_MS and is then looked at
// again; any later reading from the tool that is not used up clears it. Nothing here guesses a figure.
import type { DelegateCli, IsoTime, ModelPresetId } from '../contracts.ts';
import { PlanMeter, type PlanReading } from './plan-meter.ts';
import type { AiFailureKind } from './ai-failure.ts';

/** A used-up failure with no reset known is looked at again after this long (the routine line says 30 minutes). */
export const USED_UP_HOLD_MS = 30 * 60_000;

export class PlanBook {
  readonly meter = new PlanMeter();
  #usedUp = new Map<DelegateCli, number>();

  note(reading: PlanReading): void {
    this.meter.note(reading);
    if (reading.windows.length && reading.state !== 'used-up') this.#usedUp.delete(reading.cli);
  }

  /** A failure the tool named: a used-up plan marks that tool used up, its reset unknown. */
  failed(cli: DelegateCli, kind: AiFailureKind | null | undefined, at: IsoTime): void {
    if (kind === 'usage-limit' && Number.isFinite(Date.parse(at))) this.#usedUp.set(cli, Date.parse(at));
  }

  read(cli: DelegateCli, now: IsoTime): PlanReading {
    const reading = this.meter.read(cli, now), since = this.#usedUp.get(cli), at = Date.parse(now);
    if (since === undefined || !Number.isFinite(at) || at - since >= USED_UP_HOLD_MS || reading.state === 'used-up') return reading;
    return { ...reading, state: 'used-up', readAt: reading.readAt ?? new Date(since).toISOString() };
  }
}

/** One book per engine object (the store, or the model port), so every handler and job on this computer shares it. */
const BOOKS = new WeakMap<object, PlanBook>();
export function planBookOf(key: object): PlanBook {
  let book = BOOKS.get(key);
  if (!book) { book = new PlanBook(); BOOKS.set(key, book); }
  return book;
}

/** The tool whose plan a preset runs on: Codex and Claude Code only. */
export function planCliOf(presetId: ModelPresetId | undefined | null): DelegateCli | null {
  return presetId === 'codex-cli' ? 'codex' : presetId === 'claude-code-cli' ? 'claude-code' : null;
}
