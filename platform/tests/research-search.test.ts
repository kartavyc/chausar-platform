import test from 'node:test';
import assert from 'node:assert/strict';
import { hash, type Context } from '../runtime/contracts.ts';
import { OntologyService } from '../runtime/ontology.ts';
import { CalculatorService } from '../runtime/calculator.ts';
import { InvestigationService } from '../runtime/investigations.ts';
import { ReportService } from '../runtime/reports.ts';
import { ResearchSearchService, type ResearchSearchPort } from '../runtime/research-search.ts';
import type { AuthorizedInvestigationSearchProjection, InvestigationSearchRequest, InvestigationSearchResult } from '../runtime/investigation-search.ts';
import { FixtureStateStore } from './database-fixtures.ts';
import { Engine } from '../runtime/engine.ts';
import { PostgresInvestigationSearch } from '../runtime/investigation-search.ts';
import { ChausarError } from '../runtime/contracts.ts';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve, isAbsolute } from 'node:path';

const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const request: InvestigationSearchRequest = { method: 'simple-token-conjunction-v1', query: 'August',
  bounds: { maxDocuments: 10, maxTextBytes: 65536, maxMatches: 10 } };
function fixtureResult(projection: AuthorizedInvestigationSearchProjection, input: InvestigationSearchRequest): InvestigationSearchResult {
  const documents = [...projection.documents].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return { engine: 'injected-sql', serverIdentity: null, method: input.method, queryDigest: hash(input.query),
    projectionDigest: hash({ complete: true, documents }), matches: documents.map(({ text: _, ...pin }) => pin),
    completeness: { class: 'complete-authorized-projection', documents: documents.length,
      textBytes: documents.reduce((sum, document) => sum + Buffer.byteLength(document.text), 0), matchedDocuments: documents.length,
      indexReadiness: 'fresh-transactional-projection' }, bounds: { ...input.bounds } };
}
async function fixture() {
  const store = new FixtureStateStore();
  await new OntologyService(store).publish(owner, 'ecommerce');
  const investigations = new InvestigationService(store);
  let saved = await investigations.create(owner, { objective: 'August empty-source investigation', branch: 'main', asOf: new Date().toISOString(), sourceIds: [],
    steps: [{ id: 'august', label: 'August empty collection scope', request: { operation: 'received', period: { from: '2026-08-01', to: '2026-08-31' } } }],
    hypotheses: [{ id: 'unverified', text: 'August timing remains a guess.', uncertainty: 'unverified', forReceiptIds: [], againstReceiptIds: [] }],
    budget: { maxSteps: 2, maxReceiptRows: 10, maxContextBytes: 16384 } });
  saved = await investigations.advance(owner, saved.id, { expectedRevision: saved.revision });
  const calculator = new CalculatorService(store), receipt = calculator.receipt(owner, saved.receiptIds[0]);
  const reports = new ReportService(store);
  await reports.decision(owner, { text: 'August review stays a private local draft.', reviewDate: '2026-10-15', receiptIds: [receipt.id], hypotheses: ['No established cause.'], branch: 'main' });
  const service = (port: ResearchSearchPort) => new ResearchSearchService(store, { calculator: {}, reports: {}, adapter: async () => port });
  return { store, service, saved };
}

test('authorized host join pins current investigations and journal evidence without upgrading injected SQL', async () => {
  const value = await fixture(); let seen: AuthorizedInvestigationSearchProjection | undefined;
  const result = await value.service({ search: async (projection, input) => { seen = projection; return fixtureResult(projection, input); } }).search(owner, request);
  assert.equal(seen!.expectedDocuments, 2); assert.equal(seen!.complete, true);
  assert.deepEqual(new Set(seen!.documents.map(document => document.kind)), new Set(['investigation', 'journal']));
  assert.ok(seen!.documents.some(document => document.text.includes('not an established cause')));
  assert.equal(result.engine, 'injected-sql'); assert.equal(result.serverIdentity, null); assert.equal(result.qualification, 'injected-sql-fixture');
  assert.equal(result.scope, 'current-authorized-valid-investigations-and-journals'); assert.match(result.interpretation, /no universal absence/);
});

test('a concurrent current trust change refuses a formerly valid search projection before release', async () => {
  const value = await fixture();
  await assert.rejects(value.service({ search: async (projection, input) => {
    const result = fixtureResult(projection, input); await value.store.update(state => { state.policy.allowedSources = []; }); return result;
  } }).search(owner, request), (error: any) => error.code === 'SEARCH_AUTHORITY_CHANGED');
});

test('a concurrent private-record revision change refuses old pinned search matches', async () => {
  const value = await fixture();
  await assert.rejects(value.service({ search: async (projection, input) => {
    const result = fixtureResult(projection, input); await value.store.update(state => {
      state.answers.find(item => item.id === value.saved.id)!.revision++;
    }); return result;
  } }).search(owner, request), (error: any) => error.code === 'SEARCH_AUTHORITY_CHANGED');
});

test('a faulty host port cannot release altered or repeated result pins', async () => {
  for (const duplicate of [false, true]) {
    const value = await fixture();
    await assert.rejects(value.service({ search: async (projection, input) => {
      const result = fixtureResult(projection, input);
      if (duplicate) result.matches = [result.matches[0], result.matches[0]];
      else result.matches[0].digest = '0'.repeat(64);
      return result;
    } }).search(owner, request), (error: any) => error.code === 'SEARCH_RESULT_CHANGED');
  }
});

test('stale evidence is excluded from the defined valid corpus without a universal absence claim', async () => {
  const value = await fixture(); await value.store.update(state => { state.receipts[0].stale = true; });
  const result = await value.service({ search: async (projection, input) => {
    assert.equal(projection.expectedDocuments, 0); return fixtureResult(projection, input);
  } }).search(owner, request);
  assert.equal(result.completeness.documents, 0); assert.equal(result.matches.length, 0);
  assert.match(result.interpretation, /this authorized projection/);
});

test('an owned search shutdown failure still closes the actual encrypted Vault and releases its lock', async t => {
  const root = resolve(tmpdir()), directory = await mkdtemp(join(root, 'chausar-search-cleanup-'));
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file' });
  t.after(async () => {
    await engine.close(); const child = relative(root, resolve(directory));
    assert.ok(child && !child.startsWith('..') && !isAbsolute(child) && directory.startsWith(join(root, 'chausar-search-cleanup-')));
    await rm(directory, { recursive: true, force: true });
  });
  const passphrase = 'Synthetic search cleanup encrypted fixture passphrase';
  await engine.request('workspace.create', { name: 'Synthetic cleanup', passphrase, pack: 'ecommerce', demo: false });
  const vault = engine.vault!; let closed = false;
  const closeVault = vault.close.bind(vault);
  t.mock.method(vault, 'close', async () => { await closeVault(); closed = true; });
  // A labelled constructor fixture makes no database connection or provider call.
  t.mock.method(PostgresInvestigationSearch, 'connect', async () => ({
    search: async (projection: AuthorizedInvestigationSearchProjection, input: InvestigationSearchRequest) => fixtureResult(projection, input),
    close: async () => { throw new ChausarError('SEARCH_TIMEOUT', 'Injected owned-pool shutdown timeout.'); },
  }) as unknown as PostgresInvestigationSearch);
  engine.options.storage = 'postgres'; engine.options.postgresUrl = 'postgresql://synthetic:synthetic-fixture@127.0.0.1:54321/chausar_test';
  assert.equal((await engine.request('research.search', request)).qualification, 'injected-sql-fixture');
  await assert.rejects(engine.request('workspace.lock'), (error: any) => error.code === 'SEARCH_TIMEOUT');
  assert.equal(closed, true); assert.equal(engine.vault, null);
  engine.options.storage = 'experimental-file'; delete engine.options.postgresUrl;
  await engine.request('workspace.open', { passphrase });
  assert.equal((await engine.request('workspace.status')).open, true, 'Actual authority lock was released despite the independent pool failure.');
});
