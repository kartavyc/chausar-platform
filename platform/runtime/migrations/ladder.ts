// D12: the migration ladder. One number for all data, CURRENT_SCHEMA (State.schemaVersion). Every change to a stored
// shape adds one numbered step in steps/ and moves the number up by one. A step is pure (no file, network or clock read
// beyond the `at` it is given), re-runnable (twice equals once), never deletes a record (one it cannot bring forward
// goes to State.unsupported with the step's name and reason) and sets the data version to its own `to`. migrate() runs
// the steps from the data's version upward on a copy; data newer than this app is refused with both numbers and left
// alone. Vault.open (vault.ts) reads every business through here.
import { ChausarError, InternalError } from '../portable.ts';
import { BUILT_STEPS } from './steps/index.ts';

export const CURRENT_SCHEMA = 2;

export type LadderStep = { from: number; to: number; name: string; run(state: any, at: string): any };

/** The real steps, in order. */
export const STEPS: readonly LadderStep[] = BUILT_STEPS;

/** Data saved by a newer Chausar: answered only after the key opened the data, and the file is never touched. */
export class DataNewerError extends ChausarError {
  found: number;
  supported: number;
  constructor(found: number, supported: number) {
    super('DATA_NEWER', 'This business was saved by a newer version of Chausar. Update Chausar to open it. Nothing was changed.');
    this.found = found;
    this.supported = supported;
  }
}

// In developer words (a step's name); the app says the code's own line (owner-flag.ts INTERNAL_LINE_CODES).
const failed = (message: string) => new InternalError('DATA_MIGRATION_FAILED', message);
/** Every record the State holds, counted across its lists (moved records count in unsupported). */
const recordCount = (state: unknown) => Object.values(state as Record<string, unknown>).filter(Array.isArray).reduce((sum: number, list) => sum + (list as unknown[]).length, 0);

/** What is wrong with a list of steps for a ladder up to `current`: gaps, jumps, repeats, steps past the top. */
export function ladderProblems(steps: readonly LadderStep[], current = CURRENT_SCHEMA): string[] {
  const problems: string[] = [];
  for (const step of steps) {
    if (step.to !== step.from + 1) problems.push(`${step.name} goes from ${step.from} to ${step.to}; a step moves one number`);
    if (step.to > current) problems.push(`${step.name} goes past the current number ${current}`);
  }
  for (let version = 1; version < current; version++) {
    const from = steps.filter(step => step.from === version);
    if (from.length > 1) problems.push(`two steps from ${version}`);
    if (!from.some(step => step.to === version + 1)) problems.push(`no step from ${version} to ${version + 1}`);
  }
  return problems;
}

/** Brings State up to `current` on a copy: { state, from, to, steps }. The input is never changed. */
export function migrate(input: unknown, at: string, steps: readonly LadderStep[] = STEPS, current = CURRENT_SCHEMA): { state: unknown; from: number; to: number; steps: string[] } {
  const found = (input as { schemaVersion?: unknown } | null)?.schemaVersion;
  if (!Number.isSafeInteger(found)) throw new ChausarError('DATA_INVALID', 'The business data has no whole data version.');
  const from = found as number;
  if (from > current) throw new DataNewerError(from, current);
  if (from === current) return { state: input, from, to: current, steps: [] };
  let state = structuredClone(input) as Record<string, unknown>;
  const ran: string[] = [];
  for (let version = from; version < current; version++) {
    const step = steps.find(item => item.from === version && item.to === version + 1);
    if (!step) throw failed(`There is no step from ${version} to ${version + 1}, so this data cannot be brought up to date.`);
    const before = recordCount(state);
    let next: unknown;
    try { next = step.run(structuredClone(state), at); }
    catch { throw failed(`Step ${step.name} could not bring the data from ${version} to ${version + 1}.`); }
    if ((next as { schemaVersion?: unknown } | null)?.schemaVersion !== version + 1) throw failed(`Step ${step.name} did not set the data version to ${version + 1}.`);
    const lost = before - recordCount(next);
    if (lost > 0) throw failed(`Step ${step.name} would drop ${lost} record${lost === 1 ? '' : 's'}; a step moves what it cannot bring forward to unsupported.`);
    state = next as Record<string, unknown>;
    ran.push(step.name);
  }
  return { state, from, to: current, steps: ran };
}
