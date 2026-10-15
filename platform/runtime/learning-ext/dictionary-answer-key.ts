/**
 * The hand-worked answer key. A key is a small canonical file, an optional mapping recipe and
 * cases whose expected totals were worked out by hand. Running a key publishes a candidate
 * dictionary into a fresh in-memory sandbox, imports the rows and asks the calculator for each
 * case. Nothing here touches the workspace store, and no expected value is computed here.
 */
import { check, ChausarError, initialState, type Context, type State, type StateStore } from '../contracts.ts';
import { canonical, digest } from '../actions.ts';
import { CalculatorService } from '../calculator.ts';
import { demoCsv, demoRecipe, ImportService, type MappingRecipe } from '../ingest.ts';
import { validDate } from '../memory.ts';
import { OntologyService, type DictionaryDraft } from '../ontology.ts';

export type AnswerCase = { id: string; operation: string; period: { from: string; to: string }; onDate?: string; expectedMinor: string };
export type AnswerKey = { id: string; label: string; rows: string; recipe?: MappingRecipe; expectedTotals?: { rowCount: number; amountMinor: string }; cases: AnswerCase[] };
export type CaseResult = { id: string; passed: boolean; expectedMinor: string; actualMinor?: string; code?: string };
export type KeyRun = { keyDigest: string; passed: boolean; cases: CaseResult[]; failing: string[] };

const september = { from: '2026-09-01', to: '2026-09-30' };
/**
 * Worked by hand from the demo fixture (see business-engine.test.ts): invoices 1,000 + 2,000; cash
 * 600 + 2,000; delivered 1,000 + 1,500; returns 100; imported costs 400 + 700; net 2,500 - 100;
 * contribution 2,400 - 1,100; first invoice still owed 1,000 - 600 - 100 on 30 September.
 */
export const defaultAnswerKey: AnswerKey = {
  id: 'demo-hand-worked', label: 'Demo shop, September, worked by hand', rows: demoCsv,
  expectedTotals: { rowCount: 10, amountMinor: '1230000' },
  cases: [
    { id: 'billed', operation: 'billed', period: september, expectedMinor: '300000' },
    { id: 'received', operation: 'received', period: september, expectedMinor: '260000' },
    { id: 'earned', operation: 'earned', period: september, expectedMinor: '250000' },
    { id: 'refunds', operation: 'refunds', period: september, expectedMinor: '10000' },
    { id: 'costs', operation: 'costs', period: september, expectedMinor: '110000' },
    { id: 'net-sales', operation: 'net_sales', period: september, expectedMinor: '240000' },
    { id: 'margin', operation: 'margin', period: september, expectedMinor: '130000' },
    { id: 'aging', operation: 'aging', period: september, onDate: '2026-09-30', expectedMinor: '30000' },
  ],
};

const plain = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const keys = (value: Record<string, unknown>, allowed: string[]) => Object.keys(value).every(key => allowed.includes(key));

/** Validate an owner-supplied key as typed data. The recipe itself is checked by the import service in the sandbox. */
export function assertAnswerKey(value: unknown): AnswerKey {
  check(plain(value) && keys(value, ['id', 'label', 'rows', 'recipe', 'expectedTotals', 'cases']), 'INVALID_ANSWER_KEY', 'An answer key holds an id, a label, rows, an optional recipe and its cases.');
  check(typeof value.id === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(value.id) && typeof value.label === 'string' && value.label.trim().length > 0 && value.label.length <= 120,
    'INVALID_ANSWER_KEY', 'Give the answer key a plain identifier and a short label.');
  check(typeof value.rows === 'string' && value.rows.length > 0 && value.rows.length <= 1_000_000 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value.rows), 'INVALID_ANSWER_KEY', 'Answer key rows are canonical CSV text of at most one megabyte.');
  check(value.recipe === undefined || plain(value.recipe), 'INVALID_ANSWER_KEY', 'An answer key recipe is mapping data.');
  if (value.expectedTotals !== undefined) {
    const totals = value.expectedTotals;
    check(plain(totals) && keys(totals, ['rowCount', 'amountMinor']) && Number.isSafeInteger(totals.rowCount) && (totals.rowCount as number) >= 0
      && typeof totals.amountMinor === 'string' && /^-?\d{1,30}$/.test(totals.amountMinor), 'INVALID_ANSWER_KEY', 'Source totals need a row count and an exact minor-unit amount.');
  }
  check(Array.isArray(value.cases) && value.cases.length > 0 && value.cases.length <= 50, 'INVALID_ANSWER_KEY', 'An answer key has 1 to 50 cases.');
  const ids = new Set<string>();
  for (const item of value.cases) {
    check(plain(item) && keys(item, ['id', 'operation', 'period', 'onDate', 'expectedMinor']), 'INVALID_ANSWER_CASE', 'A case holds an id, an operation, a period, an optional date and the expected total.');
    check(typeof item.id === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(item.id) && !ids.has(item.id), 'INVALID_ANSWER_CASE', 'Case identifiers are plain and unique.');
    check(typeof item.operation === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(item.operation), 'INVALID_ANSWER_CASE', 'Name a calculation by its identifier.');
    const period = item.period;
    check(plain(period) && keys(period, ['from', 'to']) && validDate(period.from) && validDate(period.to) && (period.from as string) <= (period.to as string), 'INVALID_ANSWER_CASE', 'Give each case an explicit calendar period.');
    check(item.onDate === undefined || validDate(item.onDate), 'INVALID_ANSWER_CASE', 'An aging date is a calendar date.');
    check(typeof item.expectedMinor === 'string' && /^-?\d{1,30}$/.test(item.expectedMinor), 'INVALID_ANSWER_CASE', 'Expected totals are exact minor-unit strings worked out by hand.');
    ids.add(item.id);
  }
  return JSON.parse(canonical(value)) as AnswerKey;
}

/** A private, transactional in-memory store for one sandbox run. */
class SandboxStore implements StateStore {
  #state: State; #queue: Promise<unknown> = Promise.resolve();
  constructor(state: State) { this.#state = state; }
  read() { return this.#state; }
  update<T>(change: (state: State) => T | Promise<T>): Promise<T> {
    const run = this.#queue.then(async () => { const copy = structuredClone(this.#state); const result = await change(copy); copy.revision++; this.#state = copy; return result; });
    this.#queue = run.catch(() => undefined);
    return run;
  }
}
const codeOf = (error: unknown) => error instanceof ChausarError ? error.code : 'ANSWER_KEY_ERROR';

/** Run every case against a candidate draft in a fresh sandbox. Expected values are compared as exact strings. */
export async function runAnswerKey(key: AnswerKey, draft: DictionaryDraft): Promise<KeyRun> {
  const keyDigest = digest(key);
  const store = new SandboxStore(initialState(key.label, true));
  const ctx: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
  const failAll = (code: string): KeyRun => {
    const cases = key.cases.map(item => ({ id: item.id, passed: false, expectedMinor: item.expectedMinor, code }));
    return { keyDigest, passed: false, cases, failing: cases.map(item => item.id) };
  };
  try { await new OntologyService(store).publish(ctx, structuredClone(draft)); } catch (error) { return failAll(codeOf(error)); }
  try {
    const imports = new ImportService(store), recipe = structuredClone(key.recipe ?? demoRecipe);
    const input = { sourceId: 'answer-key', format: 'csv' as const, content: key.rows, recipe };
    // A key without declared source totals reconciles to its own rows; the cases are the check.
    const expectedTotals = key.expectedTotals ?? (() => { const preview = imports.preview(ctx, input); return { rowCount: preview.coverage.sourceRows, amountMinor: preview.totalsMinor }; })();
    await imports.commit(ctx, { ...input, expectedTotals });
  } catch (error) { return failAll(codeOf(error)); }
  const calculator = new CalculatorService(store), cases: CaseResult[] = [];
  for (const item of key.cases) {
    try {
      const receipt = await calculator.calculate(ctx, { operation: item.operation, period: { ...item.period }, ...(item.onDate ? { onDate: item.onDate } : {}) });
      cases.push({ id: item.id, passed: receipt.totalMinor === item.expectedMinor, expectedMinor: item.expectedMinor, actualMinor: receipt.totalMinor });
    } catch (error) { cases.push({ id: item.id, passed: false, expectedMinor: item.expectedMinor, code: codeOf(error) }); }
  }
  const failing = cases.filter(item => !item.passed).map(item => item.id);
  return { keyDigest, passed: failing.length === 0, cases, failing };
}

/** Cases that passed before an edit and fail after it. */
export function regressions(before: KeyRun, after: KeyRun): string[] {
  const passed = new Set(before.cases.filter(item => item.passed).map(item => item.id));
  return after.cases.filter(item => !item.passed && passed.has(item.id)).map(item => item.id);
}
