/**
 * Driving plans: the typed steps a session runs on one window (WK-14, experimental).
 *
 * A plan is data, never code: focus the window, press a checked chord, wait for a title,
 * type the export file name Chausar made, wait for that file, or take a picture of the window.
 * There is no step that types other text, clicks, or reads a field, so a plan cannot enter a
 * password, answer a one-time code or solve a captcha. Every plan is checked when it is
 * registered: chords through `parseChord`, patterns compiled with a size limit.
 *
 * A plan for a real program that has not been run against that program is `verified: false`
 * and refuses to start (`DRIVING_PLAN_UNVERIFIED`): pressing unchecked keys in an accounting
 * program is not something to learn on a person's books.
 */
import { check } from '../contracts.ts';
import { parseChord, type Chord } from './driver.ts';

export type PlanStep =
  | { readonly kind: 'focus'; readonly say: string }
  | { readonly kind: 'keys'; readonly chord: Chord; readonly say: string; readonly settleMs: number }
  | { readonly kind: 'wait-title'; readonly pattern: RegExp; readonly say: string; readonly timeoutMs: number }
  | { readonly kind: 'type-file-name'; readonly extension: string; readonly say: string }
  | { readonly kind: 'wait-file'; readonly say: string; readonly timeoutMs: number }
  | { readonly kind: 'snapshot'; readonly say: string };
export type Plan = {
  readonly id: string; readonly title: string;
  /** The program this plan is for, matched against the window's program name; null means any window. */
  readonly app: RegExp | null; readonly appLabel: string;
  /** Connector groups (connectors-ext) whose screen road may use this plan. */
  readonly groups: readonly string[];
  readonly produces: 'png' | 'csv' | 'xml' | 'xlsx' | 'xls' | 'txt' | 'pdf' | 'json' | 'html';
  readonly status: 'experimental' | 'tested-synthetic';
  readonly verified: boolean;
  /** Absolute folders the program saves into by default, searched for the exact export name. */
  readonly folders: readonly string[];
  readonly steps: readonly PlanStep[];
};

const EXTENSIONS = ['csv', 'xml', 'xlsx', 'xls', 'txt', 'pdf', 'json', 'html'] as const;
const invalid = (reason: string): never => { check(false, 'DRIVING_PLAN_INVALID', reason); throw new Error(reason); };
const say = (value: unknown) => typeof value === 'string' && value.length > 0 && value.length <= 200 && !/[\u0000-\u001f]/.test(value) ? value : invalid('Each step says what it does in a short sentence.');
const ms = (value: unknown, fallback: number, max: number) => value === undefined ? fallback : Number.isInteger(value) && (value as number) >= 0 && (value as number) <= max ? value as number : invalid('A step waits a whole number of milliseconds within its limit.');
const pattern = (value: unknown) => {
  if (value instanceof RegExp) return value.source.length <= 200 ? new RegExp(value.source, 'i') : invalid('A title pattern is short.');
  return typeof value === 'string' && value.length > 0 && value.length <= 200 ? new RegExp(value, 'i') : invalid('A title pattern is short.');
};

/** Checks a plan written as plain data and returns the frozen, typed plan. */
export function definePlan(input: Record<string, any>): Plan {
  check(input !== null && typeof input === 'object', 'DRIVING_PLAN_INVALID', 'A plan is a set of named fields.');
  check(typeof input.id === 'string' && /^[a-z0-9][a-z0-9.-]{2,63}$/.test(input.id), 'DRIVING_PLAN_INVALID', 'A plan has a short lower-case id.');
  check(Array.isArray(input.steps) && input.steps.length > 0 && input.steps.length <= 40, 'DRIVING_PLAN_INVALID', 'A plan has between one and forty steps.');
  const produces = input.produces;
  check(produces === 'png' || (EXTENSIONS as readonly string[]).includes(produces), 'DRIVING_PLAN_INVALID', 'A plan names the file it produces.');
  const steps: PlanStep[] = input.steps.map((step: any): PlanStep => {
    switch (step?.kind) {
      case 'focus': return { kind: 'focus', say: say(step.say) };
      case 'keys': return { kind: 'keys', chord: parseChord(step.chord), say: say(step.say), settleMs: ms(step.settleMs, 300, 10_000) };
      case 'wait-title': return { kind: 'wait-title', pattern: pattern(step.pattern), say: say(step.say), timeoutMs: ms(step.timeoutMs, 10_000, 120_000) };
      case 'type-file-name':
        check((EXTENSIONS as readonly string[]).includes(step.extension) && step.extension === produces, 'DRIVING_PLAN_INVALID', 'The typed file name ends in the format the plan produces.');
        return { kind: 'type-file-name', extension: step.extension, say: say(step.say) };
      case 'wait-file': return { kind: 'wait-file', say: say(step.say), timeoutMs: ms(step.timeoutMs, 60_000, 600_000) };
      case 'snapshot': return { kind: 'snapshot', say: say(step.say) };
      default: return invalid('A step is one of the known kinds.');
    }
  });
  const typed = steps.filter(step => step.kind === 'type-file-name').length, waited = steps.filter(step => step.kind === 'wait-file').length;
  check(produces === 'png' ? steps.some(step => step.kind === 'snapshot') && typed === 0 && waited === 0 : typed === 1 && waited === 1 && steps.findIndex(s => s.kind === 'type-file-name') < steps.findIndex(s => s.kind === 'wait-file'),
    'DRIVING_PLAN_INVALID', 'A file plan types its name once and then waits for that file; a picture plan only takes pictures.');
  check(steps[0].kind === 'focus', 'DRIVING_PLAN_INVALID', 'A plan starts by focusing its window.');
  const folders = input.folders ?? [];
  check(Array.isArray(folders) && folders.length <= 8 && folders.every((f: unknown) => typeof f === 'string' && f.length <= 300 && (f.startsWith('/') || /^[A-Za-z]:\\/.test(f))), 'DRIVING_PLAN_INVALID', 'Plan folders are absolute paths.');
  const groups = input.groups ?? [];
  check(Array.isArray(groups) && groups.length <= 10 && groups.every((g: unknown) => typeof g === 'string' && /^[a-z0-9-]{2,60}$/.test(g)), 'DRIVING_PLAN_INVALID', 'Plan groups are connector group ids.');
  check(['experimental', 'tested-synthetic'].includes(input.status) && typeof input.verified === 'boolean', 'DRIVING_PLAN_INVALID', 'A plan states its label and whether it was checked.');
  return Object.freeze({ id: input.id, title: say(input.title), app: input.app === null || input.app === undefined ? null : pattern(input.app), appLabel: say(input.appLabel ?? 'Any program'),
    groups: Object.freeze([...groups]), produces, status: input.status, verified: input.verified, folders: Object.freeze([...folders]), steps: Object.freeze(steps) });
}

/**
 * The plans this version ships. The window picture is the one plan tested end to end (on a
 * synthetic window under Xvfb). The Tally plan is written from Tally Prime's documented export
 * keys but has not been run against Tally, so it refuses to start until it is.
 */
export const BUILT_IN_PLANS: readonly Plan[] = Object.freeze([
  definePlan({ id: 'window.picture', title: 'A picture of the report on screen', app: null, appLabel: 'Any program', groups: [], produces: 'png', status: 'tested-synthetic', verified: true,
    steps: [{ kind: 'focus', say: 'Bring the chosen window to the front.' }, { kind: 'snapshot', say: 'Take a picture of the window.' }] }),
  definePlan({ id: 'tally.report-export', title: 'Export the open Tally report as Excel-readable XML', app: 'tally', appLabel: 'TallyPrime', groups: ['tally'], produces: 'xml', status: 'experimental', verified: false,
    folders: ['C:\\TallyPrime', 'C:\\Program Files\\TallyPrime'],
    steps: [
      { kind: 'focus', say: 'Bring Tally to the front, on the report you opened.' },
      { kind: 'keys', chord: 'alt+e', say: 'Open Export for this report.', settleMs: 800 },
      { kind: 'wait-title', pattern: 'export', say: 'Wait for the Export screen.', timeoutMs: 10_000 },
      { kind: 'type-file-name', extension: 'xml', say: 'Type the export file name.' },
      { kind: 'keys', chord: 'enter', say: 'Send the export.', settleMs: 500 },
      { kind: 'wait-file', say: 'Wait for the exported file.', timeoutMs: 120_000 },
    ] }),
]);

export function planFor(plans: readonly Plan[], id: string): Plan {
  const plan = plans.find(item => item.id === id);
  check(plan, 'DRIVING_PLAN_NOT_FOUND', 'Choose one of the listed driving plans.');
  return plan;
}

/** The plan description other lanes and screens read (no patterns, no chords as objects). */
export function describePlan(plan: Plan) {
  return { id: plan.id, title: plan.title, app: plan.appLabel, groups: [...plan.groups], produces: plan.produces, status: plan.status, verified: plan.verified, steps: plan.steps.map(step => step.say) };
}
