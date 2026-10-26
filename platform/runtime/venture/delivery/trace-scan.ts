// Chausar venture launcher, delivery package (Ink v2 wave 4, package 4J15, catalogue Q14): the trace scan.
// Before any judge reads a run, code scans the run's own records (Chausar's, never anything outside): every tool call's
// input and result, every turn note, every hand-off, the draft and what heavy work left behind. It looks for three
// things: a secret (a key, a token, a password; never repeated, only named), a call that reached outside Chausar (a
// tool Chausar does not ship, or one that sends, reaches out or moves money and ran; a recorded request for the owner
// is not one), and a write outside the work folder (an absolute path, a home folder, or one that climbs out with '..').
// A judge or check that calls tools is audited against its allowlist (the tools that only read): any other tool fails
// the audit. A check that edits what it checks has its verdict voided and the files put back (guardedCheck).
// The real-order judge refuses a run whose scan found something (judge-run.ts notJudgeable).
// Ideas taken, code written here: SkillEvaluator tier3/eval_core/checks.py (deterministic trace checks before a judge),
// OpenQodex packages/core/src/completion.ts (a check may not change what it checks), LongHorizon auditor_agent.py
// (an auditor's tool allowlist). Rewrites in TypeScript, not copies.
import type { State } from '../../contracts.ts';
import { listRecords } from '../records.ts';
import { TOOL_NAMES } from '../contracts.ts';
import type { DeliveryRunRecord, HarnessState, ToolName } from '../contracts.ts';
import { REDACTED, secretFindings } from '../core/secrets.ts';
import { classifyEffects, toolDeclaration } from '../policy/effects.ts';
import { RECORDS_ONLY } from '../policy/ladder.ts';

export type TraceFindingKind = 'secret' | 'outbound' | 'outside-write' | 'tool-not-allowed';
/** at: where in the run (a tool call id, turn.N, handoff.N, draft, output:N); what: plain words, never the value. */
export type TraceFinding = { kind: TraceFindingKind; at: string; what: string };
export type TraceScan = { clean: boolean; findings: TraceFinding[]; line: string | null };
export type ScanInput = {
  harness: HarnessState | null | undefined;
  draft?: string | null;
  /** What heavy work left behind, by name, as its run record lists it. */
  delegateOutputs?: readonly { name: string }[];
  /** For an auditor's or a check's own run: the only tools it may call. */
  allowlist?: readonly string[] | null;
};

/** The tools an auditor or a check may call: Chausar's own that only read. Anything that writes, sends or records does not. */
export const AUDITOR_TOOLS: readonly ToolName[] = Object.freeze(TOOL_NAMES.filter(name => {
  const declared = toolDeclaration(name);
  return declared !== null && declared.effects.length > 0 && declared.effects.every(effect => effect === 'read');
}));
export const CHECK_EDITED_LINE = 'This check changed what it checked, so its verdict does not count. What it changed was put back.';
export const CHECK_UNGUARDED_LINE = 'This check could not be guarded against changing what it checks, so it did not run and has no verdict.';

const WORDS: Readonly<Record<TraceFindingKind, string>> = Object.freeze({
  secret: 'something that looks like a key or a password',
  outbound: 'a call that reached outside Chausar',
  'outside-write': 'a write outside the work folder',
  'tool-not-allowed': 'a tool outside the allowed list',
});
const OUTSIDE_EFFECTS = new Set(['send', 'egress', 'money']);
/** Input fields that name where something is written or read. */
const PATH_KEYS = /^(?:path|paths|file|files|filename|folder|dir|directory|out|output|outputs|outpath|outfile|target|dest|destination|save|saveas|write|writeto)$/i;
const MAX_DEPTH = 12;

function text(value: unknown): string {
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value) ?? ''; } catch { return ''; }
}

/**
 * Whether a text holds a secret: one the shared rules find, or the mark the loop leaves where it took one out
 * ([redacted secret]). The loop stores turn notes and results with secrets redacted, so the mark is the evidence.
 */
function holdsSecret(value: string): boolean {
  return value.includes(REDACTED) || secretFindings(value).length > 0;
}

/** True for a path that leaves the work folder: absolute, a drive, a share, a home folder, or one that climbs with '..'. */
function leavesWorkFolder(path: string): boolean {
  const trimmed = path.trim();
  if (/^(?:[\\/]|[A-Za-z]:|~)/.test(trimmed)) return true;
  return trimmed.split(/[\\/]+/).includes('..');
}

/** Every string under a path-like key in a call's input, however deep. */
function pathsIn(value: unknown, depth = 0, underPathKey = false): string[] {
  if (depth > MAX_DEPTH) return [];
  if (typeof value === 'string') return underPathKey ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(item => pathsIn(item, depth + 1, underPathKey));
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([key, item]) => pathsIn(item, depth + 1, PATH_KEYS.test(key)));
  return [];
}

/** A call that ran and reached outside: a tool Chausar does not ship, or one that sends, reaches out or moves money. */
function reachedOutside(call: HarnessState['toolCalls'][number]): boolean {
  if (call.outcome !== 'succeeded' || RECORDS_ONLY.includes(call.tool)) return false;
  if (!toolDeclaration(call.tool)) return true;
  if (call.effect === 'outside-write') return true;
  const { effects } = classifyEffects({ name: call.tool, effect: call.effect ?? null, input: (call.input ?? null) as Record<string, unknown> | null });
  return effects.some(effect => OUTSIDE_EFFECTS.has(effect));
}

/** The scan's words for a run with findings, or null when it is clean. */
function scanLine(findings: readonly TraceFinding[]): string | null {
  if (!findings.length) return null;
  const listed = findings.slice(0, 4).map(item => `${item.what} (${item.at})`);
  const more = findings.length > 4 ? ` and ${findings.length - 4} more` : '';
  const joined = listed.length === 1 ? listed[0] : `${listed.slice(0, -1).join(', ')} and ${listed[listed.length - 1]}`;
  return `Before any judge reads this run, code scanned it and found ${joined}${more}. No judge reads this run. Look at it in Work before you decide on the draft yourself.`;
}

/** Scans one run's trace, by code, before any judge. Reads only what it is given. */
export function scanTrace(input: ScanInput): TraceScan {
  const findings: TraceFinding[] = [];
  const add = (kind: TraceFindingKind, at: string) => { if (!findings.some(item => item.kind === kind && item.at === at)) findings.push({ kind, at, what: WORDS[kind] }); };
  const state = input.harness ?? null;
  const allow = input.allowlist ? new Set(input.allowlist) : null;
  for (const turn of state?.turns ?? []) if (holdsSecret(text(turn.note)) || holdsSecret(text(turn.calls))) add('secret', `turn.${turn.turn}`);
  for (const call of state?.toolCalls ?? []) {
    const result = call.envelope.ok ? call.envelope.result : call.envelope.error.message;
    if (holdsSecret(text(call.input)) || holdsSecret(text(result))) add('secret', call.id);
    if (allow && !allow.has(call.tool)) add('tool-not-allowed', call.id);
    if (reachedOutside(call)) add('outbound', call.id);
    if (pathsIn(call.input).some(leavesWorkFolder)) add('outside-write', call.id);
  }
  (state?.handoffs ?? []).forEach((handoff, index) => {
    if (holdsSecret(`${text(handoff.question)} ${text(handoff.answer ?? '')}`)) add('secret', `handoff.${index + 1}`);
  });
  (input.delegateOutputs ?? []).forEach((output, index) => { if (leavesWorkFolder(String(output.name ?? ''))) add('outside-write', `output:${index + 1}`); });
  if (input.draft && holdsSecret(input.draft)) add('secret', 'draft');
  return { clean: findings.length === 0, findings, line: scanLine(findings) };
}

/** The scan of one stored delivery run: its agent loop, its draft and the outputs of its heavy-work runs. */
export function scanRun(state: State, run: Pick<DeliveryRunRecord, 'id' | 'ventureId' | 'harness' | 'renderedText'>): TraceScan {
  const outputs = listRecords(state, 'venture-delegate-run', run.ventureId).filter(record => record.runId === run.id).flatMap(record => record.outputs);
  return scanTrace({ harness: run.harness ?? null, draft: run.renderedText, delegateOutputs: outputs });
}

/**
 * The same data in one fixed key order, so a copy compares equal to what it was taken from. A Map is its entries in
 * order, a Set its members in order, bytes their values, a big number its digits.
 */
function stable(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (item instanceof Map) return { '#map': [...item.entries()] };
    if (item instanceof Set) return { '#set': [...item.values()] };
    if (ArrayBuffer.isView(item)) return { '#bytes': Array.from(item as unknown as ArrayLike<number>) };
    if (typeof item === 'bigint') return { '#bigint': String(item) };
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      return Object.fromEntries(Object.keys(item as object).sort().map(key => [key, (item as Record<string, unknown>)[key]]));
    }
    return item;
  }) ?? '';
}

const kindOf = (value: unknown) => (Array.isArray(value) ? 'array' : value instanceof Map ? 'map' : value instanceof Set ? 'set'
  : value !== null && typeof value === 'object' && !ArrayBuffer.isView(value) ? 'object' : null);

/**
 * Puts a subject back as the copy says, in place and all the way down, so everyone holding it or any part of it (the
 * draft inside a wrapper, one file of a list) sees the original again.
 */
function putBack(subject: object, copy: object): void {
  const fresh = structuredClone(copy);
  restore(subject, fresh);
}

function restore(target: object, from: object): void {
  if (Array.isArray(target)) {
    const source = from as unknown[];
    for (let index = 0; index < Math.min(target.length, source.length); index += 1) target[index] = settle(target[index], source[index]);
    target.length = source.length;
    for (let index = 0; index < source.length; index += 1) if (!(index in target)) target[index] = source[index];
    return;
  }
  if (target instanceof Map) { target.clear(); for (const [key, item] of from as Map<unknown, unknown>) target.set(key, item); return; }
  if (target instanceof Set) { target.clear(); for (const item of from as Set<unknown>) target.add(item); return; }
  const record = target as Record<string, unknown>, source = from as Record<string, unknown>;
  for (const key of Object.keys(record)) if (!Object.hasOwn(source, key)) delete record[key];
  for (const key of Object.keys(source)) record[key] = settle(record[key], source[key]);
}

/** One value put back: restored in place when it is the same kind of container, else the copy's value. */
function settle(current: unknown, wanted: unknown): unknown {
  const kind = kindOf(current);
  if (kind !== null && kind === kindOf(wanted)) { restore(current as object, wanted as object); return current; }
  return wanted;
}

/** The playbook check id a voided run of a flagship playbook's own checks reports as failed. */
export const CHECKS_UNCHANGED_ID = 'checks-left-unchanged';

/**
 * A flagship playbook's own checks, guarded: if they changed the draft, the files, the tables or the tool calls they
 * read, what they changed is put back and their verdict is replaced by one failed result, which blocks Accept.
 */
export async function guardedPlaybookChecks<R>(flagship: string, subject: object, run: () => Promise<R[]>): Promise<(R | { playbook: string; check: string; outcome: 'fail'; detail: string })[]> {
  const guarded = await guardedCheck(subject, run);
  if (!guarded.voided) return guarded.verdict!;
  return [{ playbook: flagship, check: CHECKS_UNCHANGED_ID, outcome: 'fail', detail: guarded.line! }];
}

/**
 * Runs a check on a subject (files, a draft, a record) and makes sure it did not change it. A check that edited what it
 * checked has its verdict voided (null) and the subject is put back; one that throws has it put back too. A subject
 * that cannot be copied (it holds a function, say) cannot be guarded, so the check does not run and has no verdict.
 */
export async function guardedCheck<S extends object, T>(subject: S, run: (subject: S) => T | Promise<T>): Promise<{ verdict: T | null; voided: boolean; line: string | null }> {
  let copy: S;
  let before: string;
  try {
    copy = structuredClone(subject);
    before = stable(subject);
  } catch {
    return { verdict: null, voided: true, line: CHECK_UNGUARDED_LINE };
  }
  let verdict: T;
  try {
    verdict = await run(subject);
  } catch (error) {
    if (stable(subject) !== before) putBack(subject, copy);
    throw error;
  }
  if (stable(subject) === before) return { verdict, voided: false, line: null };
  putBack(subject, copy);
  return { verdict: null, voided: true, line: CHECK_EDITED_LINE };
}

