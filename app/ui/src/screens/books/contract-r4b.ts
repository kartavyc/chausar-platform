/**
 * Reply checks for the Books round-4 additions (docs/lanes/work-books.md, "Round 4 contracts"):
 * the two publish strategies of a copy (BK-09), the rest of a record's time line (BK-12), the
 * demo clock from the frame (BK-15), the not-counted count from receipts (BK-19), the core
 * deletion (BK-20), word boxes and every page of a bill (WK-13/BK-18) and the workspace time
 * zone. Each is checked before anything is drawn.
 */
import { bool, count, either, id, instant, isoDate, list, literal, nullable, object, oneOf, record, text, type Check } from '../work/kit/validate.ts';

const name = text(400);
const code = text(64);
const when: Check<string> = either(instant, isoDate);

export const STRATEGIES = ['prospective', 'retrospective'] as const;
export const strategyImpact = object({ strategy: oneOf(STRATEGIES), digest: nullable(text(200)), affectedAnswers: count, rebuild: count, activeWork: count, preserved: count, code: nullable(code) });
export type StrategyImpact = ReturnType<typeof strategyImpact>;

export const TIMELINE_TYPES = ['reminder', 'action', 'reminder-sent', 'payment-noted', 'note'] as const;
export const TIMELINE_SOURCES = ['actions', 'writeback-journal', 'memory'] as const;
export const timelineMoreReply = object({
  recordId: id, omitted: count, journal: object({ available: bool }),
  entries: list(object({ at: when, type: oneOf(TIMELINE_TYPES), what: nullable(text(600)), status: nullable(name), source: oneOf(TIMELINE_SOURCES), ref: nullable(name) }), 200),
});
export type TimelineMore = ReturnType<typeof timelineMoreReply>;

export const receiptsNotCounted = object({
  available: bool,
  receipts: list(object({ receiptId: id, operation: name, at: when, notCounted: list(object({ currency: text(3), rows: count }), 50) }), 20),
});

export const box = object({ x: count, y: count, w: count, h: count });
export type Box = ReturnType<typeof box>;
export const outline = list(object({ page: count, width: count, height: count, boxes: list(box, 1500), omitted: count }), 50);
export type Outline = ReturnType<typeof outline>;

/** `todayx.shell` as Books reads it: only whether the workspace is a demo and its clock. */
export const shellClock = object({
  workspace: object({ demo: bool }),
  clock: (value: unknown, path: string) => {
    const source = record(value, path);
    return source['mode'] === 'demo' ? object({ mode: literal('demo'), date: isoDate })(value, path) : object({ mode: literal('real') })(value, path);
  },
});
export type ShellClock = ReturnType<typeof shellClock>;

/** `ui.context` as Books reads it: only the workspace time zone, when one is set. */
export const zoneReply = object({}, { timeZone: nullable(text(100)) });
