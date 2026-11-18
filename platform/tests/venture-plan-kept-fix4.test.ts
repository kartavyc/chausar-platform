// Fix round 4 (real-app problem 19): Codex's plan use read "This week: 0% used, resets Fri" and, a few minutes later,
// "Codex hasn't reported its plan use yet." Between the two the owner had closed the business and opened it again. The
// reading is the tool's on this computer, yet it was kept against the open business's vault object, which is made anew
// each time a business opens, so the reading went with the old one. It is kept against the engine now. And a later read
// that brings nothing readable never takes the place of a reading: the last one stays, with its time.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChausarError, type Context } from '../runtime/contracts.ts';
import { Engine } from '../runtime/engine.ts';
import type { GitHubTransport, ModelTransport, VentureDeps } from '../runtime/venture/contracts.ts';
import { handlers } from '../runtime/venture/models/index.ts';
import { planBookFor, planBookOf } from '../runtime/venture/models/plan-book.ts';
import { PlanMeter, fromCodexLimits } from '../runtime/venture/models/plan-meter.ts';
import { VentureTestStore } from './venture-test-store.ts';

const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const NOW = '2026-11-06T10:00:00.000Z';
const reset = (iso: string) => Math.floor(Date.parse(iso) / 1000);
const WEEK = { rateLimits: { secondary: { usedPercent: 0, windowDurationMins: 10080, resetsAt: reset('2026-11-09T05:00:00Z') } } };
function deps(options: { planKey?: object; codexPlan?: () => Promise<unknown> } = {}) {
  return { store: new VentureTestStore(), clock: () => new Date(NOW), host: 'desktop', models: { codexPlan: options.codexPlan }, ...(options.planKey ? { planKey: options.planKey } : {}) } as unknown as VentureDeps;
}
type Tool = { source: string; state: string; windows: { line: string }[] };
const codexOf = async (d: VentureDeps, payload: unknown = {}): Promise<Tool> => (await (handlers as any)['venture.models.plan'](d, owner, payload)).tools[1];

test('the reading is kept against the engine, not the open business: a business opened again, or another one, still shows it', async () => {
  const engine = {};
  const first = deps({ planKey: engine });
  planBookFor(first).note(fromCodexLimits(WEEK, '2026-11-06T09:55:00.000Z'));
  assert.deepEqual((await codexOf(first)).windows.map(window => window.line), ['This week: 0% used, resets Mon']);
  // Closed and opened again: a new vault object, the same engine.
  const again = deps({ planKey: engine });
  assert.notEqual(again.store, first.store);
  const codex = await codexOf(again);
  assert.deepEqual(codex.windows.map(window => window.line), ['This week: 0% used, resets Mon']);
  assert.equal(codex.source, 'As Codex reported at 9:55 am.');
  // Another engine (another computer, another test) starts with nothing; with no engine named, the store is the key.
  assert.equal((await codexOf(deps({ planKey: {} }))).source, "Codex hasn't reported its plan use yet.");
  const bare = deps();
  assert.equal(planBookFor(bare), planBookOf(bare.store));
});

test('a later read with nothing readable never replaces a reading: the last one stays, with its time', async () => {
  let answer: unknown = { rateLimits: { secondary: { usedPercent: null, windowDurationMins: 10080, resetsAt: null } } };
  const d = deps({ codexPlan: async () => answer });
  planBookFor(d).note(fromCodexLimits(WEEK, '2026-11-06T09:55:00.000Z'));
  // Check now, and Codex answers a window it could not fill in.
  const unreadable = await codexOf(d, { fresh: true });
  assert.deepEqual(unreadable.windows.map(window => window.line), ['This week: 0% used, resets Mon']);
  assert.equal(unreadable.source, 'As Codex reported at 9:55 am.');
  // An answer with no windows at all, and no answer, change nothing either.
  for (answer of [{ rateLimits: {} }, {}, null]) assert.equal((await codexOf(d, { fresh: true })).source, 'As Codex reported at 9:55 am.');
  // A newer reading does take its place, with its own time.
  answer = { rateLimits: { secondary: { usedPercent: 12, windowDurationMins: 10080, resetsAt: reset('2026-11-09T05:00:00Z') } } };
  const newer = await codexOf(d, { fresh: true });
  assert.deepEqual([newer.windows.map(window => window.line), newer.source], [['This week: 12% used, resets Mon'], 'As Codex reported at 10:00 am.']);
});

test('the meter: an unreadable window fills a gap but never overwrites a readable one; a window whose reset has passed still reads not reported', () => {
  const meter = new PlanMeter();
  const unknownWeek = { rateLimits: { secondary: { usedPercent: 140, windowDurationMins: 10080, resetsAt: reset('2026-11-09T05:00:00Z') } } };
  // Nothing kept yet: the tool did report, so the window shows as not reported with the time of that report.
  meter.note(fromCodexLimits(unknownWeek, '2026-11-06T09:00:00.000Z'));
  assert.deepEqual([meter.read('codex', NOW).windows.map(window => window.state), meter.read('codex', NOW).readAt], [['unknown'], '2026-11-06T09:00:00.000Z']);
  meter.note(fromCodexLimits(WEEK, '2026-11-06T09:30:00.000Z'));
  meter.note(fromCodexLimits(unknownWeek, '2026-11-06T09:45:00.000Z'));
  const kept = meter.read('codex', NOW);
  assert.deepEqual([kept.windows.map(window => [window.kind, window.usedPercent]), kept.readAt], [[['week', 0]], '2026-11-06T09:30:00.000Z']);
  // A report that fills one window and cannot read the other takes the first and keeps the second as last read.
  meter.note(fromCodexLimits({ rateLimits: { primary: { usedPercent: 30, windowDurationMins: 300, resetsAt: reset('2026-11-06T14:00:00Z') }, secondary: { usedPercent: null, windowDurationMins: 10080, resetsAt: null } } }, '2026-11-06T09:50:00.000Z'));
  const both = meter.read('codex', NOW);
  assert.deepEqual([both.windows.map(window => [window.kind, window.usedPercent]), both.readAt], [[['five-hour', 30], ['week', 0]], '2026-11-06T09:50:00.000Z']);
  // Past its reset, a window is unknown again (nothing is guessed), as before.
  assert.deepEqual(meter.read('codex', '2026-11-10T00:00:00.000Z').windows.map(window => window.state), ['unknown', 'unknown']);
});

// The real engine: lock and open make a new vault and a new venture host; the plan reading stays.
const noGitHub: GitHubTransport = { kind: 'fixture', read: async () => ({ status: 404, etag: null, body: '{"message":"Not Found"}', rateRemaining: null }) };
const transport: ModelTransport = {
  replay: true,
  http: async () => { throw new ChausarError('FIXTURE_MISSING', 'No recording in this test.'); },
  process: async request => { if (request.purpose === 'version-check') return { exitCode: 0, stdout: 'synthetic recording' }; throw new ChausarError('FIXTURE_MISSING', 'No recording in this test.'); },
};

test('the real engine keeps the reading when the business is closed and opened again', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-plan-kept-'));
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file', venture: { host: 'test', modelTransport: transport, githubTransport: noGitHub } });
  t.after(async () => { await engine.close(); await rm(directory, { recursive: true, force: true }); });
  const passphrase = 'long-enough-passphrase';
  await engine.request('workspace.create', { name: 'Indore Custom Cakes', passphrase, pack: 'services' });
  await engine.request('venture.create', { idea: 'Custom cakes for offices in Indore.', countryCode: 'IN', workingName: 'Indore Custom Cakes' });
  const codex = async () => ((await engine.request('venture.models.plan', {})) as { tools: Tool[] }).tools[1]!;
  assert.equal((await codex()).source, "Codex hasn't reported its plan use yet.");
  // What a Codex job's driver does when Codex reports its limits during real work (agent-runtime/runner.ts onPlan).
  const soon = new Date(Date.now() + 3 * 86_400_000).toISOString();
  planBookOf(engine).note(fromCodexLimits({ rateLimits: { secondary: { usedPercent: 0, windowDurationMins: 10080, resetsAt: reset(soon) } } }, new Date().toISOString()));
  const before = await codex();
  assert.match(before.windows[0]!.line, /^This week: 0% used, resets /);
  await engine.request('workspace.lock', {});
  await engine.request('workspace.open', { passphrase });
  const after = await codex();
  assert.deepEqual([after.windows.map(window => window.line), after.source], [before.windows.map(window => window.line), before.source]);
});
