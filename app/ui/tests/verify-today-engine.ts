/** Optional read-only proof against the frozen Engine's actual memory fixtures and
 * ReportService. No native database, external services, live books or file writes.
 * Run: node app/ui/tests/verify-today-engine.ts <ce5-engine-source-root> */
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createBrowserTodayReader, createDesktopTodayReader } from '../src/bridge/today-host.ts';
import type { BriefTodayRequest, DashboardTodayRequest, DesktopTodayReadPort } from '../src/bridge/today-host.ts';

interface FixtureStore { read(): { workspace: unknown; facts: readonly unknown[]; imports: readonly unknown[]; policy: unknown; ontology: unknown; activity: readonly unknown[] } }
interface FixtureCalculator { calculate(context: unknown, request: unknown): Promise<unknown>; receipt(context: unknown, id: string): unknown }
interface FixtureSource {
  readonly fixtureOwner: unknown;
  readonly fixturePeriod: { readonly from: string; readonly to: string };
  readonly databaseFixtures: readonly { readonly id: string }[];
  prepareDatabaseFixture(fixture: { readonly id: string }): Promise<{ readonly store: FixtureStore; readonly calculator: FixtureCalculator }>;
}
interface ReportSource { readonly ReportService: new (store: FixtureStore) => { brief(context: unknown, request: BriefTodayRequest): Promise<unknown> } }
const root = process.argv[2]; if (!root) throw new Error('Pass the frozen ce5 Engine source root.');
const fixtureSource: FixtureSource = await import(pathToFileURL(resolve(root, 'platform/tests/database-fixtures.ts')).href);
const reportSource: ReportSource = await import(pathToFileURL(resolve(root, 'platform/runtime/reports.ts')).href);
const fixture = fixtureSource.databaseFixtures.find(fixture => fixture.id === 'shop-margin'); if (!fixture) throw new Error('The actual independent margin fixture is unavailable.');
const prepared = await fixtureSource.prepareDatabaseFixture(fixture);
const reportService = new reportSource.ReportService(prepared.store);
const wire = (value: unknown): unknown => JSON.parse(JSON.stringify(value));
let dashboardReceiptReads = 0, briefReceiptReads = 0;
async function dashboard(request: DashboardTodayRequest): Promise<unknown> {
  // Match the frozen dashboard aggregate constructor, using its actual calculator.
  // This proves DTO compatibility; it does not claim execution of Engine.request.
  const calculations: unknown[] = [];
  for (const operation of ['billed', 'received', 'earned', 'margin']) calculations.push(await prepared.calculator.calculate(fixtureSource.fixtureOwner, { operation, ...(request.period ? { period: request.period } : {}) }));
  const state = prepared.store.read();
  return wire({ workspace: state.workspace, calculations, factCount: state.facts.length, sources: state.imports.length, decisions: [], waitingActions: [], jobs: [], policy: state.policy, dictionary: state.ontology, lastActivity: state.activity.slice(-8).reverse() });
}
const desktopPort: DesktopTodayReadPort = { async request(method, payload) {
  if ('id' in payload) {
    if (method !== 'receipts.get') throw new Error('The aggregate request has a receipt identity.');
    dashboardReceiptReads++; return wire(prepared.calculator.receipt(fixtureSource.fixtureOwner, payload.id));
  }
  if (method === 'dashboard.get') return dashboard(payload);
  if (method === 'reports.brief') return wire(await reportService.brief(fixtureSource.fixtureOwner, payload));
  throw new Error('The receipt request has no identity.');
} };
const desktop = await createDesktopTodayReader(desktopPort).dashboard({ title: 'Today', date: '2026-10-01', request: { period: fixtureSource.fixturePeriod }, selections: [{ operation: 'earned', figureKey: 'total' }, { operation: 'margin', figureKey: 'contribution' }, { operation: 'margin', figureKey: 'marginBps' }] });
if (!desktop.ok) throw new Error(desktop.code);
assert.equal(dashboardReceiptReads, 4); assert.equal(desktop.value.today.pendingCount, null);
const earned = desktop.value.today.stats[0]!.figure, contribution = desktop.value.today.stats[1]!.figure, ratio = desktop.value.today.stats[2]!.figure;
assert.equal(earned.kind, 'money'); if (earned.kind === 'money') assert.equal(earned.paise, '250000');
assert.equal(contribution.kind, 'money'); if (contribution.kind === 'money') assert.equal(contribution.paise, '130000');
assert.equal(ratio.kind, 'percent'); if (ratio.kind === 'percent') assert.equal(ratio.basisPoints, '5416');
assert.equal(desktop.value.statsEvidence[2]!.engineFigure.display, '5416 bps');
const browser = await createBrowserTodayReader({ async call(message) {
  if (message.method === 'reports.brief') return wire(await reportService.brief(fixtureSource.fixtureOwner, message.payload));
  if (message.method === 'dashboard.get') return dashboard(message.payload);
  briefReceiptReads++; return wire(prepared.calculator.receipt(fixtureSource.fixtureOwner, message.payload.id));
} }).brief({ title: 'Today', date: '2026-10-01', request: { period: fixtureSource.fixturePeriod, onDate: '2026-10-01', asOf: '2100-01-01T00:00:00Z', branch: 'main', sourceIds: ['answer-key'], ritual: 'friday' }, selections: [{ operation: 'net_sales', figureKey: 'total' }, { operation: 'margin', figureKey: 'contribution' }, { operation: 'margin', figureKey: 'marginBps' }] });
if (!browser.ok) throw new Error(browser.code);
assert.equal(briefReceiptReads, 5); assert.equal(browser.value.brief?.delivery.state, 'draft');
assert.equal(browser.value.brief?.headline, 'Your weekly review is ready');
assert.deepEqual(browser.value.statsEvidence[0]!.scope.requestedSourceIds, ['answer-key']);
const net = browser.value.today.stats[0]!.figure; assert.equal(net.kind, 'money'); if (net.kind === 'money') assert.equal(net.paise, '240000');
assert.equal(Object.hasOwn(browser.value.brief!.report, 'html'), false);
console.log(JSON.stringify({ evidence: 'ce5-today-memory-source-compatibility', synthetic: true, actualCalculator: true, actualReportService: true, dashboardReceiptReads, briefReceiptReads, selectedExactFigures: 6, engineRequestExecuted: false, passed: true }));
