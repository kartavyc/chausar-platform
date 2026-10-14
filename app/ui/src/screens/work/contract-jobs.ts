/**
 * Reply checks for the job additions of round 2 (docs/lanes/work-books.md, "Jobs: round 2"):
 * person steps on the time line (WK-16), the measure (WK-08), the schedule and the way each
 * change goes (WK-07, WK-11), the month-end choice and Chausar is driving (WK-14). Every
 * field here is optional on the job sheet, so an older engine still draws.
 */
import { InvalidReply, amount, bool, count, either, id, instant, list, literal, nullable, object, oneOf, text, type Check } from './kit/validate.ts';
import { job, jobStep, jobTemplate, jobTemplates } from './contract.ts';

const short = text(400);
const long = text(4000);

/** WK-16: a step only a person can do. */
export const personStep = object({
  at: instant, event: literal('person-step'), kind: literal('person'), stepId: id, what: long,
  who: object({ kind: oneOf(['you', 'person'] as const), name: short, memberId: nullable(id) }),
  done: bool, doneAt: nullable(instant), doneBy: nullable(short), canDone: bool,
});
export type PersonStep = ReturnType<typeof personStep>;
/** A time line row: a person's step when it says so, else the core event row. */
export const timelineRow: Check<PersonStep | ReturnType<typeof jobStep>> = (value, path) =>
  (value !== null && typeof value === 'object' && (value as { kind?: unknown }).kind === 'person' ? personStep : jobStep)(value, path);

/** WK-08: the measure against its goal. Each point names its receipt; a gap is a missing word. */
export const measure = object({
  name: short, goal: amount, goalReceiptId: nullable(id),
  points: list(object({ at: instant, value: amount, receiptId: id }), 400),
});
export type Measure = ReturnType<typeof measure>;
export const schedule = either(
  object({ kind: literal('interval'), everyDays: nullable(count), everyMs: count }),
  object({ kind: literal('calendar'), rule: oneOf(['month-end', 'calendar'] as const), at: nullable(short), timeZone: short, paused: bool }),
);
export type Schedule = ReturnType<typeof schedule>;
const way = oneOf(['jobsx', 'core', 'not-built'] as const);
export const manage = object({ edit: way, delete: oneOf(['jobsx', 'cancel'] as const), missedRule: way, personStep: oneOf(['jobsx', 'not-built'] as const) });
export type Manage = ReturnType<typeof manage>;

const sheetExtra = object({ timeline: list(timelineRow) }, { measure: nullable(measure), schedule, manage });
/** The job sheet: the round-1 job, with the round-2 fields when the engine sends them. */
export const jobSheet = (value: unknown, path: string) => Object.freeze({ ...job(value, path), ...sheetExtra(value, path) });
export type JobSheet = ReturnType<typeof jobSheet>;

/** Templates, with the month-end choice. */
const templateExtra = object({}, { schedule: oneOf(['interval', 'month-end'] as const) });
export const templatesWithSchedule = (value: unknown, path: string) => {
  const base = jobTemplates(value, path);
  const rows = (value as { templates: unknown[] }).templates;
  const extra = object({}, { monthEnd: object({ available: bool }) })(value, path);
  return Object.freeze({
    ...base, monthEnd: extra.monthEnd ?? { available: false },
    templates: base.templates.map((t, i) => Object.freeze({ ...t, ...templateExtra(rows[i], `${path}.templates[${i}]`) })),
  });
};
export type TemplateWithSchedule = ReturnType<typeof jobTemplate> & { readonly schedule?: 'interval' | 'month-end' };

export const edited = object({ id, via: oneOf(['jobsx', 'core'] as const) });
export const deleted = object({ id, state: oneOf(['deleted', 'cancelled'] as const), note: nullable(literal('cancel-keeps-record')) });
export const missedSet = object({ id, missedRun: oneOf(['skip', 'run-once-on-wake'] as const), via: oneOf(['jobsx', 'core'] as const) });
export const stepDone = object({ jobId: id, stepId: id, done: bool });

/** WK-14. Nothing is drawn as driving unless the session lane says so. */
export const DRIVING_STATES = ['idle', 'driving', 'sign-in', 'paused-by-you', 'stopped-by-key', 'stopped', 'step-failed', 'done'] as const;
const rules = object({ windows: literal(1), mode: literal('read-export'), typesSecrets: literal(false) });
const drivingStatusShape = object({
  state: oneOf(DRIVING_STATES), window: nullable(object({ id, title: short })),
  steps: list(object({ at: instant, text: long, state: oneOf(['done', 'running', 'failed'] as const) }), 200), reason: nullable(short),
});
export type DrivingStatus = ReturnType<typeof drivingStatusShape>;
const drivingWindow = object({ id, title: short, app: short });
export type DrivingWindow = ReturnType<typeof drivingWindow>;
export type Driving = { readonly available: false } | { readonly available: true; readonly status: DrivingStatus; readonly windows?: readonly DrivingWindow[] };
export const driving: Check<Driving> = (value, path) => {
  const head = object({ available: bool, rules })(value, path);
  if (!head.available) return Object.freeze({ available: false as const });
  const body = object({ status: drivingStatusShape }, { windows: list(drivingWindow, 100) })(value, path);
  return Object.freeze({ available: true as const, ...body });
};

export { InvalidReply };
export const isPersonStep = (row: PersonStep | ReturnType<typeof jobStep>): row is PersonStep => (row as { kind?: unknown }).kind === 'person';
