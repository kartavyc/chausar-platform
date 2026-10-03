/** Optional read-only source-compatibility proof. No host services or real data are used.
 * Run: node app/ui/tests/verify-current-engine.ts <current-engine-repo-root> */
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { projectCalculationReceipt } from '../src/bridge/validate.ts';
import { figureFromReceipt } from '../src/bridge/projections.ts';

interface EngineFixture { readonly id: string; readonly request: unknown; readonly expected?: { readonly primary: string; readonly figures: Readonly<Record<string, string>> } }
interface ExistingEngineFixtures {
  readonly databaseFixtures: readonly EngineFixture[];
  readonly fixtureOwner: unknown;
  prepareDatabaseFixture(fixture: EngineFixture): Promise<{ readonly calculator: { calculate(context: unknown, request: unknown): Promise<unknown> } }>;
}
const root = process.argv[2];
if (!root) throw new Error('Pass the current engine source root for this optional proof.');
const source: ExistingEngineFixtures = await import(pathToFileURL(resolve(root, 'platform/tests/database-fixtures.ts')).href);
let receipts = 0, figures = 0, unknowns = 0;
for (const fixture of source.databaseFixtures) {
  if (!fixture.expected) continue;
  const prepared = await source.prepareDatabaseFixture(fixture);
  // Match the JSON serialization of both current host transports.
  const wire: unknown = JSON.parse(JSON.stringify(await prepared.calculator.calculate(source.fixtureOwner, fixture.request)));
  const evidence = projectCalculationReceipt(wire);
  assert.equal(evidence.valueMinor, fixture.expected.primary, `${fixture.id}: retained primary`);
  for (const [key, exact] of Object.entries(fixture.expected.figures)) {
    const output = figureFromReceipt(evidence, key);
    if (output.kind === 'missing') {
      assert.equal(output.state, 'unknown');
      assert.ok(evidence.coverage.completeness === 'empty' || (evidence.coverage.completeness === 'partial' && evidence.coverage.countedRows === 0));
      unknowns++;
    } else if (output.kind === 'money') assert.equal(output.paise, exact, `${fixture.id}: ${key}`);
    else if (output.kind === 'percent') assert.equal(output.basisPoints, exact, `${fixture.id}: ${key}`);
    else assert.fail('Current calculator does not emit count figures.');
    figures++;
  }
  receipts++;
}
console.log(JSON.stringify({ evidence: 'existing-engine-fixture-compatibility', synthetic: true, receipts, figures, unknowns, passed: true }));
