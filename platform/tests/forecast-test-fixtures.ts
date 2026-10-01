import { hash, type Context, type Fact } from '../runtime/contracts.ts';
import type { CalculationReceipt, CalculationRequest } from '../runtime/calculator.ts';
import type { ForecastRequest, ForecastResolvedEvidence } from '../runtime/forecast-contracts.ts';
import { compileDictionary, starterPacks } from '../runtime/ontology.ts';

// Labelled synthetic source fixtures only. These establish no native database,
// connector/provider, model, live operational, or calibrated interval qualification.
export const forecastFixtureOwner: Context = { memberId: 'owner', role: 'owner', epoch: 1 };
export type ForecastSourceFixture = { request: ForecastRequest; evidence: ForecastResolvedEvidence };

export function forecastMonth(month: string) {
  const [year, number] = month.split('-').map(Number);
  return { from: `${month}-01`, to: new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10) };
}

export function addForecastMonth(fixture: ForecastSourceFixture, input: {
  id: string; month: string; amountMinor: string; asOf?: string; learnedAt?: string;
  entityId?: string; sourceId?: string; branch?: string; currency?: string; kind?: string;
}) {
  const dictionary = fixture.evidence.dictionary;
  const period = forecastMonth(input.month);
  const asOf = input.asOf ?? new Date(Date.parse(`${period.to}T00:00:00.000Z`) + 86_400_000).toISOString();
  const sourceId = input.sourceId ?? 'forecast-source';
  const branch = input.branch ?? 'main';
  const fact: Fact = {
    id: `fact-${input.id}`, entityId: input.entityId ?? `entity-${input.id}`, sourceId, sourceRow: 2,
    kind: input.kind ?? 'invoice', validFrom: `${input.month}-15`, validTo: null,
    learnedAt: input.learnedAt ?? `${input.month}-16T00:00:00.000Z`, supersededAt: null, branch,
    fields: { amountMinor: input.amountMinor, currency: input.currency ?? dictionary.currency, status: 'settled' },
  };
  const definition = dictionary.definitions.find(value => value.name === fixture.request.operation)!;
  const sum = dictionary.compiledSums!.find(value => value.operationId === fixture.request.operation)!;
  const request: CalculationRequest = { operation: fixture.request.operation, sourceIds: [...fixture.request.sourceIds], branch, period, asOf };
  const receipt: CalculationReceipt = {
    id: input.id, memberId: forecastFixtureOwner.memberId, epoch: forecastFixtureOwner.epoch,
    sourceIds: [sourceId], requestedSourceIds: [...fixture.request.sourceIds], operation: fixture.request.operation,
    createdAt: asOf, asOf, period, comparePeriod: null, branch, currency: dictionary.currency,
    ontologyVersion: dictionary.version, dictionaryHash: dictionary.hash, definitionHash: hash([definition]),
    definitions: [structuredClone(definition)], compiledCalculation: { dictionaryHash: dictionary.hash, sum: structuredClone(sum) },
    figures: [{ key: 'total', label: definition.label, minor: input.amountMinor, display: `${dictionary.currency} ${input.amountMinor} minor`, unit: 'money', currency: dictionary.currency }],
    valueMinor: input.amountMinor, totalMinor: input.amountMinor, rowIds: [fact.id],
    rows: [{ factId: fact.id, entityId: fact.entityId, sourceId, sourceRow: fact.sourceRow, kind: fact.kind,
      amountMinor: input.amountMinor, measureField: definition.field, validFrom: fact.validFrom, branch, status: 'settled' }],
    exclusions: [], coverage: { selectedRows: 1, countedRows: 1, excludedRows: 0, unresolvedConflicts: 0,
      importIds: [`synthetic-import-${input.id}`], completeness: 'reconciled-imports', gaps: [] },
    assumptions: {}, explanation: 'Labelled synthetic source receipt; not live qualification.', stale: false,
    allowedNumbers: [input.amountMinor],
  };
  const entry = { receipt, request };
  fixture.evidence.facts.push(fact);
  fixture.evidence.imports.push({ id: `synthetic-import-${input.id}`, sourceId, rowIds: [fact.id], coverage: { reconciled: true },
    label: 'Synthetic retained source reconciliation; no native/live qualification.' });
  fixture.evidence.receipts.push(entry);
  return entry;
}

export function sourceForecastFixture(amounts: string[] = ['10', '20', '30']): ForecastSourceFixture {
  const dictionary = compileDictionary(starterPacks.find(pack => pack.pack === 'retail')!, 1, 'owner', '2025-12-01T00:00:00.000Z');
  const fixture: ForecastSourceFixture = {
    request: { version: 1, mode: 'operational-as-known', operation: 'billed', dictionaryHash: dictionary.hash,
      sourceIds: ['forecast-source'], branch: 'main', horizonsMonths: [1, 3], cadenceMonths: 1,
      minimumTrainingMonths: 2, method: 'linear-trend-v1', benchmark: 'last-observed-v1', availabilityLagMs: 0,
      origins: [{ id: 'march-origin', eventCutoff: '2026-03-31', knowledgeCut: '2026-04-02T00:00:00.000Z',
        trainingReceiptIds: amounts.map((_, index) => `training-${index + 1}`), targets: [
          { horizonMonths: 1, receiptId: 'target-april' }, { horizonMonths: 3, receiptId: 'target-june' },
        ] }],
    },
    evidence: { dictionary, receipts: [], facts: [], imports: [], sourceRules: [] },
  };
  amounts.forEach((amountMinor, index) => addForecastMonth(fixture, { id: `training-${index + 1}`, month: `2026-${String(index + 1).padStart(2, '0')}`, amountMinor }));
  addForecastMonth(fixture, { id: 'target-april', month: '2026-04', amountMinor: '40', asOf: '2026-05-02T00:00:00.000Z' });
  addForecastMonth(fixture, { id: 'target-june', month: '2026-06', amountMinor: '60', asOf: '2026-07-02T00:00:00.000Z' });
  return fixture;
}
