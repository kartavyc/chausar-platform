import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { check } from '../contracts.ts';
import { readWorkbook } from '../workbook.ts';
import { DECODERS, RECIPES, runRegistered } from './recipes/index.ts';
import type { RecipeOutcome } from './types.ts';

/**
 * The fixture harness. Each group folder under fixtures/connectors may hold `cases.json`: a list of
 * synthetic files, the recipe to run and what must come out (status, total, rows, refusal code).
 * Every expected total is either the file's own stated total or a figure asserted independently in
 * the lane's hand-written tests. API recipes are covered by their adapter tests over recorded
 * responses, and worksheet and PDF bank recipes by the bank tests that build those inputs.
 */
export const HARNESS_EXEMPT: Readonly<Record<string, string>> = Object.freeze({
  'bank.statement-sheet': 'Built as an in-memory XLSX in connectors-ext-bank.test.ts.',
  'bank.statement-sheet-drcr': 'Built as an in-memory XLSX in connectors-ext-bank.test.ts.',
  'bank.pdf-text': 'Runs through the PDF helper fake in connectors-ext-bank.test.ts.',
});
export type FixtureCase = {
  name: string; recipe: string; file: string;
  /** For API recipes: a JSON file holding `{ records, meta }`. Worksheets: an .xlsx file. */
  input?: 'text' | 'rows' | 'records';
  reportTotals?: { rowCount: number | null; total: string };
  expect: { status: RecipeOutcome['status']; total?: string; rows?: number; code?: string; reason?: string; unmapped?: string[] };
};
export type CaseResult = { group: string; name: string; recipe: string; passed: boolean; problems: string[]; outcome: Pick<RecipeOutcome, 'status' | 'observed' | 'refusal' | 'abstention'> };

export function loadCases(root: string): { group: string; cases: FixtureCase[] }[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory()).flatMap(entry => {
    const file = `${root}/${entry.name}/cases.json`;
    if (!existsSync(file)) return [];
    const cases = JSON.parse(readFileSync(file, 'utf8')) as FixtureCase[];
    check(Array.isArray(cases) && cases.every(item => typeof item.name === 'string' && typeof item.recipe === 'string' && typeof item.file === 'string' && item.expect && typeof item.expect.status === 'string'),
      'FIXTURE_CASES_INVALID', 'A cases file lists named cases with a recipe, a file and an expectation.');
    return [{ group: entry.name, cases }];
  });
}
export function runCase(root: string, group: string, item: FixtureCase): CaseResult {
  const recipe = RECIPES.get(item.recipe), problems: string[] = [];
  check(recipe, 'RECIPE_NOT_FOUND', 'A fixture case names an unknown recipe.');
  const accepts = DECODERS.get(recipe.decoder)!.accepts, path = `${root}/${group}/${item.file}`;
  const input = accepts === 'text' ? { text: readFileSync(path, 'utf8') }
    : accepts === 'rows' ? { rows: path.endsWith('.json') ? JSON.parse(readFileSync(path, 'utf8')) as string[][] : readWorkbook(readFileSync(path)).sheets[0].rows }
    : JSON.parse(readFileSync(path, 'utf8')) as { records: Record<string, unknown>[]; meta?: Record<string, string> };
  const outcome = runRegistered(item.recipe, input, item.reportTotals ? { reportTotals: item.reportTotals } : {});
  if (recipe.group !== group) problems.push('recipe belongs to another group');
  if (outcome.status !== item.expect.status) problems.push(`status ${outcome.status} != ${item.expect.status}`);
  if (item.expect.total !== undefined && outcome.observed.total !== item.expect.total) problems.push(`total ${outcome.observed.total} != ${item.expect.total}`);
  if (item.expect.rows !== undefined && outcome.observed.rowCount !== item.expect.rows) problems.push(`rows ${outcome.observed.rowCount} != ${item.expect.rows}`);
  const code = outcome.refusal?.code ?? null;
  if (item.expect.code !== undefined && code !== item.expect.code) problems.push(`code ${code} != ${item.expect.code}`);
  if (item.expect.reason !== undefined && outcome.abstention?.reason !== item.expect.reason) problems.push(`reason ${outcome.abstention?.reason} != ${item.expect.reason}`);
  if (item.expect.unmapped !== undefined && JSON.stringify(outcome.unmappedFields) !== JSON.stringify(item.expect.unmapped)) problems.push('unmapped fields differ');
  return { group, name: item.name, recipe: item.recipe, passed: problems.length === 0, problems, outcome: { status: outcome.status, observed: outcome.observed, refusal: outcome.refusal, abstention: outcome.abstention } };
}
export function runHarness(root: string): { results: CaseResult[]; uncovered: string[] } {
  const results = loadCases(root).flatMap(({ group, cases }) => cases.map(item => runCase(root, group, item)));
  const covered = new Set(results.filter(result => result.outcome.status === 'accepted').map(result => result.recipe));
  return { results, uncovered: [...RECIPES.values()].filter(item => item.decoder !== 'api-records' && !Object.hasOwn(HARNESS_EXEMPT, item.id) && !covered.has(item.id)).map(item => item.id).sort() };
}
