import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { ImportInput, MappingRecipe } from '../../runtime/ingest.ts';
import type { BenchmarkPackage, FixtureId } from './contracts.ts';

export const FIXTURE_SOURCE = 'bilingual-synthetic-shop-v1';
export const PERIOD = { from: '2026-09-01', to: '2026-09-30' };
export const UNSUPPORTED_MESSAGE = 'I cannot calculate that yet. Choose a published calculation and an explicit period; the question was added to the wanted list.';
export const packageUrl = new URL('../../../fixtures/bilingual-benchmark/v1/questions.json', import.meta.url);
export const shopUrl = new URL('../../../fixtures/bilingual-benchmark/v1/shop.csv', import.meta.url);
export const largeUrl = new URL('../../../fixtures/bilingual-benchmark/v1/large.csv', import.meta.url);
// Paths are relative to platform/benchmarks/bilingual, not the caller's cwd.
export const methodUrl = new URL('../../../docs/bilingual-benchmark-method.md', import.meta.url);

// Git may check out LF source files as CRLF on Windows. Pin text content across fresh copies.
export function sha256(text: string): string { return createHash('sha256').update(text.replaceAll('\r\n', '\n'), 'utf8').digest('hex'); }
export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, item]) => JSON.stringify(key) + ':' + canonical(item)).join(',') + '}';
}
export function invariant(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
const fixtures: FixtureId[] = ['shop', 'large', 'viewer-main', 'source-revoked', 'member-revoked', 'other-receipt-owner'];
export function validatePackage(value: unknown): asserts value is BenchmarkPackage {
  const p = value as BenchmarkPackage;
  invariant(p && p.schema === 'chausar.bilingual-synthetic-package.v1' && p.version === 1 && p.fixtureOrigin === 'authored-synthetic', 'Unsupported synthetic benchmark package.');
  invariant(p.hiddenDatasetsIncluded === false && p.sealedDatasetsIncluded === false && p.attackPackIncluded === false, 'Only the authored open synthetic question package is accepted.');
  invariant(Array.isArray(p.cases) && p.cases.length > 0 && p.cases.length <= 100, 'Benchmark requires a bounded nonempty case list.');
  const ids = new Set<string>();
  for (const c of p.cases) {
    invariant(c && /^[a-z][a-z0-9-]{1,80}$/.test(c.id) && !ids.has(c.id), 'Case identifiers must be distinct plain identifiers.'); ids.add(c.id);
    invariant(fixtures.includes(c.fixture) && ['authored-typed-request', 'local-question-parser'].includes(c.track), 'Unregistered benchmark fixture or track.');
    invariant(['calculation.run', 'conversation.ask', 'receipts.get'].includes(c.method), 'Only read/calculation public benchmark methods are permitted.');
    invariant((c.track === 'local-question-parser') === (c.method === 'conversation.ask'), 'The question-parser track must execute the original question.');
    invariant(c.payload && typeof c.payload === 'object' && !Array.isArray(c.payload) && !['routeId', 'purpose', 'previewId', 'approvalId'].some(k => Object.hasOwn(c.payload, k)), 'Model-dispatch fields are excluded from the benchmark.');
    for (const language of ['en', 'hi'] as const) {
      invariant(typeof c.question?.[language] === 'string' && c.question[language].trim().length > 0 && c.question[language].length <= 8000, 'Each case needs both original language questions.');
      invariant(typeof c.worked?.[language] === 'string' && c.worked[language].trim().length > 10, 'Each language needs an independent worked answer or refusal explanation.');
      const e = 'kind' in c.expected ? c.expected : c.expected[language];
      invariant(e && ['answer', 'refusal'].includes(e.kind), 'Every case/language needs an explicit answer or refusal oracle.');
      if (e.kind === 'answer') {
        invariant(/^-?\d+$/.test(e.valueMinor) && e.currency === 'INR' && /^[a-z][a-z0-9_]*$/.test(e.operation), 'Answer oracle must contain exact integer minor units and a declared operation.');
        invariant(e.figures && Object.values(e.figures).every(n => typeof n === 'string' && /^-?\d+$/.test(n)), 'Figure oracles require exact integer strings.');
        invariant(Array.isArray(e.entities) && new Set(e.entities).size === e.entities.length && ['empty', 'reconciled-imports'].includes(e.completeness), 'Answer oracle must pin row identities and coverage.');
      } else invariant(e.mechanism === 'error-code' ? /^[A-Z][A-Z_]+$/.test(e.code) : e.mechanism === 'unsupported-question' && e.message === UNSUPPORTED_MESSAGE, 'A refusal must name its exact public mechanism.');
    }
  }
  invariant(p.cases.some(c => c.track === 'authored-typed-request') && p.cases.some(c => c.track === 'local-question-parser'), 'Both synthetic tracks are required.');
}
export async function loadPackage() {
  const [questions, shop, large, method] = await Promise.all([packageUrl, shopUrl, largeUrl, methodUrl].map(url => readFile(url, 'utf8')));
  const data: unknown = JSON.parse(questions); validatePackage(data);
  return { data, shop, large, fingerprints: { questionsSha256: sha256(questions), shopSha256: sha256(shop), largeSha256: sha256(large), methodSha256: sha256(method) } };
}
export function importInput(content: string, large = false): ImportInput {
  const recipe: MappingRecipe = {
    version: 1, id: 'bilingual-synthetic-map-v1', system: 'authored-synthetic-csv', edition: '1',
    scope: { company: 'Synthetic Bilingual Shop', branches: ['main', 'west'] },
    bindings: [
      { target: 'entityId', source: 'id', type: 'string', nulls: 'reject' },
      { target: 'kind', source: 'kind', type: 'string', nulls: 'reject' },
      { target: 'validFrom', source: 'date', type: 'date', dateFormat: 'ISO', nulls: 'reject' },
      { target: 'amountMinor', source: 'amount', type: 'money', moneyUnit: 'major', currency: 'INR', nulls: 'reject' },
      ...['currency', 'customerId', 'invoiceId', 'orderId', 'status', 'description', 'branch'].map(source => ({ target: source, source, type: 'string' as const, nulls: 'omit' as const })),
      { target: 'dueDate', source: 'dueDate', type: 'date', dateFormat: 'ISO', nulls: 'omit' },
    ],
    allowedKinds: ['sale', 'refund', 'cost', 'invoice', 'payment'], allowedStatuses: ['delivered', 'settled', 'unpaid', 'cancelled', 'draft'], onUnmapped: 'reject',
  };
  return { sourceId: FIXTURE_SOURCE, format: 'csv', content, recipe, expectedTotals: large ? { rowCount: 1, amountMinor: '9007199254740993' } : { rowCount: 12, amountMinor: '885500' } };
}
