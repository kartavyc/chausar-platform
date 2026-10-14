import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { Engine } from '../runtime/engine.ts';
import type { HttpRequest } from '../runtime/gateway.ts';
import { installSyntheticProductionStorage } from './fixtures/synthetic-production-engine.ts';
import { OPEN_BENCH, benchShopImport, type OpenBenchCase } from '../runtime/models-ext/bench/open-bench.ts';
import { liveEligible } from '../runtime/models-ext/bench/live.ts';

// Live mode end to end: the workspace's REAL gateway sends to a local fake provider on 127.0.0.1.
// Nothing here reaches the internet; every request lands on the fake server below.
const code = (name: string) => (e: any) => e.code === name;
const CLARIFY = 'Please say which published calculation and period you want.';
const MARKERS = ['PRIVATE-MARK-7731', 'cust-private-9', 'private-books'];
const CASES = ['billed-sep', 'aging-sep', 'margin-sep', 'forecast-next-month', 'attack-supplier-note', 'earned-q3'];

type Seen = { path: string; headers: Record<string, unknown>; body: string; caseId: string; language: string };

function intended(c: OpenBenchCase, path: string) {
  // The local fake answers unsupported questions with a figure instead of asking (wrong); the cloud fake asks (correct refusal).
  if (c.expected.kind === 'refusal') return { operation: 'earned', period: null, branch: null, customerId: null, clarification: path === '/api/chat' ? null : CLARIFY };
  const operation = path === '/v1/responses' && c.id === 'margin-sep' ? 'net_sales' : c.expected.operation;
  return { operation, period: c.expected.scope.period ?? null, branch: null, customerId: null, clarification: null };
}

async function fakeProvider() {
  const seen: Seen[] = [];
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      const data = JSON.parse(body), path = request.url ?? '';
      const input = JSON.parse(path === '/api/chat' ? data.messages[1].content : data.input);
      const found = OPEN_BENCH.cases.flatMap(c => (['en', 'hi'] as const).filter(l => c.question[l] === input.question).map(language => ({ c, language })))[0];
      assert.ok(found, 'The fake provider received a bench question.');
      seen.push({ path, headers: request.headers, body, caseId: found.c.id, language: found.language });
      const text = JSON.stringify(intended(found.c, path));
      response.setHeader('content-type', 'application/json');
      if (path === '/api/chat' && found.c.id === 'earned-q3' && found.language === 'hi') { response.statusCode = 500; response.end('{"error":"overloaded"}'); return; }
      if (path === '/api/chat') response.end(JSON.stringify({ model: 'fake-local', message: { role: 'assistant', content: text }, done: true, done_reason: 'stop', prompt_eval_count: 1500, eval_count: 40 }));
      else {
        assert.equal(request.headers.authorization, 'Bearer sk-bench-live-test');
        response.end(JSON.stringify({ id: 'resp_fake', object: 'response', status: 'completed',
          output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] }], usage: { input_tokens: 1500, output_tokens: 40 } }));
      }
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, seen, port: (server.address() as AddressInfo).port };
}

function privateImport() {
  const base = benchShopImport();
  return { ...base, sourceId: 'private-books', content: base.content.replaceAll('Delivered goods', 'PRIVATE-MARK-7731 goods').replaceAll('customer-a', 'cust-private-9') };
}

test('live comparison through the real gateway: plan, approve exactly, run once, budget cap, refusals', async t => {
  const fake = await fakeProvider(), directory = await mkdtemp(join(tmpdir(), 'chausar-mx-'));
  // HTTPS routes reach the fake through the injected transport; it keeps the gateway's endpoint and posts to 127.0.0.1.
  const http = async (request: HttpRequest) => {
    const response = await fetch(`http://127.0.0.1:${fake.port}${new URL(request.endpoint).pathname}`, { method: 'POST', headers: request.headers, body: request.body, redirect: 'error' });
    return { status: response.status, body: await response.text(), endpoint: request.endpoint };
  };
  const engine = new Engine({ directory, ...installSyntheticProductionStorage(directory, ['main'], t.mock), gateway: { http } });
  t.after(async () => { await engine.shutdown(); await rm(directory, { recursive: true, force: true }); fake.server.close(); });
  await engine.request('workspace.create', { name: 'Test Shop', passphrase: 'correct horse battery staple 42', demo: false, pack: 'ecommerce', folder: 'main' });
  await engine.request('sources.import', privateImport());
  const bars = await engine.request('bench.setPassBars', { minRightOrRefusedBps: 6000 });

  await engine.request('models.configure', { config: { id: 'local', kind: 'ollama', model: 'fake-local', endpoint: `http://127.0.0.1:${fake.port}/api/chat` } });
  await engine.request('models.configure', { config: { id: 'cloud', kind: 'openai-responses', model: 'fake-responses', maxCostMinor: '500', budgetMinor: '1000000',
    inputPerMillionMinor: '25000', outputPerMillionMinor: '100000' }, secret: 'sk-bench-live-test' });
  await engine.request('models.configure', { config: { id: 'nokey', kind: 'openai-compatible', model: 'fake-compatible' } });
  await engine.request('models.configure', { config: { id: 'claude', kind: 'claude-cli', model: 'claude-sonnet-4-5' } });

  const planInput = { caseIds: CASES, runs: 2, budgetCapMinor: '100000', barsDigest: bars.digest };
  await assert.rejects(engine.request('bench.planLive', planInput), code('SEND_DISABLED'));
  await engine.request('trust.update', { policy: { send: 'samples' } });
  await assert.rejects(engine.request('bench.planLive', { ...planInput, routeIds: ['nokey'] }), code('BENCH_ROUTE_NOT_QUALIFIED'));
  await assert.rejects(engine.request('bench.planLive', { ...planInput, routeIds: ['claude'] }), code('BENCH_ROUTE_NOT_QUALIFIED'));
  await assert.rejects(engine.request('bench.planLive', { ...planInput, caseIds: ['earned-main-sep'] }), code('BENCH_CASE_NOT_LIVE'));
  await assert.rejects(engine.request('bench.planLive', { ...planInput, budgetCapMinor: 1000 }), code('BENCH_INVALID'));
  await assert.rejects(engine.request('bench.planLive', { ...planInput, barsDigest: 'c'.repeat(64) }), code('BENCH_BARS_CHANGED'));
  await assert.rejects(engine.request('bench.planLive', { ...planInput, extra: 1 }), code('BENCH_INVALID'));

  // Default routes: qualified ones run; the rest are skipped with their stated reason.
  const plan = await engine.request('bench.planLive', planInput);
  assert.deepEqual(plan.routes.map((r: any) => r.routeId), ['cloud', 'local']);
  assert.deepEqual(plan.skipped.map((s: any) => [s.routeId, s.code]), [['claude', 'BENCH_ROUTE_NOT_QUALIFIED'], ['nokey', 'BENCH_ROUTE_NOT_QUALIFIED']]);
  assert.match(plan.skipped[1].reason, /credential/);
  assert.equal(plan.calls, 48); assert.equal(plan.worstCaseMinor, String(24 * 500 + 24 * 100)); assert.equal(plan.callsWithinCap, 48);
  assert.match(plan.digest, /^[a-f0-9]{64}$/); assert.equal(plan.barsDigest, bars.digest);
  assert.equal(plan.notLive.length, OPEN_BENCH.cases.filter(c => liveEligible(c)).length);
  assert.equal(fake.seen.length, 0, 'Preparing a plan sends nothing.');

  // Approval: exact digest, desktop only, never from a tainted or phone context, and never by a viewer.
  const owner = (await engine.request('trust.get')).members.find((m: any) => m.id === 'owner');
  const as = (ctx: Record<string, unknown>, method: string, payload = {}) => engine.requestAs({ memberId: owner.id, role: owner.role, epoch: owner.epoch, channel: 'desktop', ...ctx } as any, method, payload);
  await assert.rejects(engine.request('bench.approveLive', { planId: plan.id, planDigest: 'd'.repeat(64) }), code('BENCH_PLAN_CHANGED'));
  await assert.rejects(as({ sourceTainted: true }, 'bench.approveLive', { planId: plan.id, planDigest: plan.digest }), code('BENCH_APPROVAL_DESKTOP_ONLY'));
  await assert.rejects(as({ channel: 'mcp' }, 'bench.approveLive', { planId: plan.id, planDigest: plan.digest }), code('BENCH_APPROVAL_DESKTOP_ONLY'));
  await assert.rejects(as({ channel: 'phone' }, 'bench.approveLive', { planId: plan.id, planDigest: plan.digest }), code('OPEN_DESKTOP'));
  const viewer = await engine.request('members.add', { id: 'viewer-1', name: 'Viewer', role: 'viewer', branches: ['main'] });
  const asViewer = (method: string, payload = {}) => engine.requestAs({ memberId: viewer.id, role: viewer.role, epoch: viewer.epoch, channel: 'desktop' }, method, payload);
  await assert.rejects(asViewer('bench.planLive', planInput), code('FORBIDDEN'));
  await assert.rejects(asViewer('bench.approveLive', { planId: plan.id, planDigest: plan.digest }), code('FORBIDDEN'));
  await assert.rejects(engine.request('bench.compare', { live: true, planId: plan.id, approvalId: 'bench_approval_missing', barsDigest: bars.digest }), code('BENCH_APPROVAL_NOT_FOUND'));

  // Expiry: an approval older than ten minutes is refused and nothing is sent.
  const stale = await engine.request('bench.approveLive', { planId: plan.id, planDigest: plan.digest });
  assert.equal(Date.parse(stale.expiresAt) - Date.parse(stale.createdAt), 600000);
  const realNow = Date.now.bind(Date), later = realNow() + 601000;
  const clock = t.mock.method(Date, 'now', () => later);
  await assert.rejects(engine.request('bench.compare', { live: true, planId: plan.id, approvalId: stale.id, barsDigest: bars.digest }), code('BENCH_APPROVAL_EXPIRED'));
  clock.mock.restore();
  assert.equal(fake.seen.length, 0);
  await assert.rejects(asViewer('bench.compare', { live: true, planId: plan.id, approvalId: stale.id, barsDigest: bars.digest }), code('FORBIDDEN'));

  // An approval from someone whose access was revoked after approving is refused at run time.
  const cofounder = await engine.request('members.add', { id: 'cofounder-1', name: 'Cofounder', role: 'cofounder', branches: ['*'] });
  const byCofounder = await engine.requestAs({ memberId: cofounder.id, role: cofounder.role, epoch: cofounder.epoch, channel: 'desktop' }, 'bench.approveLive', { planId: plan.id, planDigest: plan.digest });
  // Removing the only cofounder needs the cofounder too (Trust dual control): ask, then the cofounder confirms.
  const removal = await engine.request('trustx.removeSeat', { memberId: cofounder.id });
  await engine.requestAs({ memberId: cofounder.id, role: cofounder.role, epoch: cofounder.epoch, channel: 'desktop' }, 'trustx.confirmChange', { id: removal.change.id });
  await assert.rejects(engine.request('bench.compare', { live: true, planId: plan.id, approvalId: byCofounder.id, barsDigest: bars.digest }), code('BENCH_APPROVAL_REVOKED'));
  assert.equal(fake.seen.length, 0);

  const approval = await engine.request('bench.approveLive', { planId: plan.id, planDigest: plan.digest });
  const result = await engine.request('bench.compare', { live: true, planId: plan.id, approvalId: approval.id, barsDigest: bars.digest });
  assert.equal(result.mode, 'live'); assert.equal(result.recorded, 'live'); assert.equal(result.stopped, null); assert.deepEqual(result.leftUndone, []);
  assert.deepEqual(result.plan, { id: plan.id, digest: plan.digest });

  // One attempt per question per run: each (route, case, language) reached the provider exactly twice (two runs), never more, even after a failure.
  assert.equal(fake.seen.length, 48);
  const counts = new Map<string, number>();
  for (const s of fake.seen) counts.set(`${s.path}|${s.caseId}|${s.language}`, (counts.get(`${s.path}|${s.caseId}|${s.language}`) ?? 0) + 1);
  assert.equal(counts.size, 24); assert.ok([...counts.values()].every(n => n === 2));

  // Nothing from the workspace's own facts left: no private marker, no shop source, in any body or header.
  for (const s of fake.seen) for (const marker of MARKERS) assert.ok(!s.body.includes(marker) && !JSON.stringify(s.headers).includes(marker), marker);
  for (const s of fake.seen) {
    const input = JSON.parse(s.path === '/api/chat' ? JSON.parse(s.body).messages[1].content : JSON.parse(s.body).input);
    assert.deepEqual(input.shape, []); assert.deepEqual(input.samples, []); assert.deepEqual(input.selectors, { branches: [], customerIds: [] });
  }

  const [cloud, local] = result.routes;
  assert.deepEqual([cloud.routeId, cloud.status, cloud.jobs, cloud.right, cloud.wrong, cloud.refused, cloud.correctRefusals], ['cloud', 'scored', 24, 16, 4, 4, 4]);
  assert.ok(cloud.misses.some((m: any) => m.caseId === 'margin-sep' && m.detail === 'chose net_sales'));
  assert.deepEqual([local.routeId, local.jobs, local.right, local.wrong, local.refused, local.correctRefusals], ['local', 24, 18, 4, 2, 0]);
  assert.deepEqual(local.refusalCodes, { MODEL_FAILED: 2 });
  // Aging is worked at the bench's fixed business day, so it is right whatever today is.
  assert.ok(!local.misses.some((m: any) => m.caseId === 'aging-sep'));
  // Cost: measured from receipts at configured rates for the cloud route; the local route has no rates, so its reservation counts, labelled.
  assert.deepEqual([cloud.cost.measuredMinor, cloud.cost.measuredCalls, cloud.cost.reservedCalls], [String(24 * 42), 24, 0]);
  assert.deepEqual([local.cost.measuredCalls, local.cost.reservedMinor, local.cost.reservedCalls], [0, String(24 * 100), 24]);
  assert.equal(result.committedMinor, String(24 * 42 + 24 * 100));
  assert.equal(cloud.secretsLeaked, 'not counted'); assert.deepEqual(cloud.verdict.notJudged, ['secretsLeaked']);
  assert.equal(cloud.actionsWithoutPermission, 0); assert.equal(cloud.attacksObeyed, 0);

  // Receipts exist in the workspace, one attempt each, none needing an outbound approval.
  const receipts = (await engine.request('activity.list')).modelReceipts;
  for (const id of [...cloud.receiptIds, ...local.receiptIds]) {
    const receipt = receipts.find((r: any) => r.id === id);
    assert.ok(receipt, id); assert.equal(receipt.attempts, 1); assert.deepEqual(receipt.sourceIds, []); assert.deepEqual(receipt.factIds, []);
  }
  assert.equal(receipts.filter((r: any) => local.receiptIds.includes(r.id) && r.status === 'failed').length, 2);
  assert.ok(!JSON.stringify(await engine.request('bench.result', { id: result.id })).includes('sk-bench-live-test'));

  // Single use: the same approval, or the executed plan, cannot run again.
  await assert.rejects(engine.request('bench.compare', { live: true, planId: plan.id, approvalId: approval.id, barsDigest: bars.digest }), code('BENCH_APPROVAL_USED'));
  await assert.rejects(engine.request('bench.approveLive', { planId: plan.id, planDigest: plan.digest }), code('BENCH_PLAN_NOT_FOUND'));
  assert.equal(fake.seen.length, 48);

  // Budget cap: three local calls of 100 paise each against a 250 paise cap; the third is left undone.
  const small = await engine.request('bench.planLive', { routeIds: ['local'], caseIds: ['billed-sep', 'margin-sep', 'earned-q3'], languages: ['en'], budgetCapMinor: '250', barsDigest: bars.digest });
  assert.deepEqual([small.calls, small.worstCaseMinor, small.callsWithinCap], [3, '300', 2]);
  const capped = await engine.request('bench.compare', { live: true, planId: small.id, approvalId: (await engine.request('bench.approveLive', { planId: small.id, planDigest: small.digest })).id, barsDigest: bars.digest });
  assert.equal(capped.stopped, 'budget-cap'); assert.equal(capped.committedMinor, '200');
  assert.deepEqual(capped.leftUndone, [{ routeId: 'local', caseId: 'earned-q3', language: 'en', run: 1 }]);
  assert.equal(capped.routes[0].jobs, 2); assert.equal(fake.seen.length, 50);

  // A tainted caller: the plan approval never substitutes for the gateway's outbound approval, so the cloud route is skipped.
  const tainted = await engine.request('bench.planLive', { routeIds: ['cloud', 'local'], caseIds: ['billed-sep'], languages: ['en'], budgetCapMinor: '10000', barsDigest: bars.digest });
  const taintedApproval = await engine.request('bench.approveLive', { planId: tainted.id, planDigest: tainted.digest });
  const taintedResult = await as({ sourceTainted: true }, 'bench.compare', { live: true, planId: tainted.id, approvalId: taintedApproval.id, barsDigest: bars.digest });
  assert.deepEqual([taintedResult.routes[0].status, taintedResult.routes[0].skipCode, taintedResult.routes[0].jobs], ['skipped', 'BENCH_OUTBOUND_APPROVAL_REQUIRED', 0]);
  assert.deepEqual([taintedResult.routes[1].status, taintedResult.routes[1].right], ['scored', 1]);
  assert.equal(fake.seen.filter(s => s.path === '/v1/responses').length, 24, 'No send to the cloud route without its own outbound approval.');

  // Bars changed after approval: refused before any call; route changed after approval: refused as stale.
  const third = await engine.request('bench.planLive', { routeIds: ['local'], caseIds: ['billed-sep'], languages: ['en'], budgetCapMinor: '1000', barsDigest: bars.digest });
  const thirdApproval = await engine.request('bench.approveLive', { planId: third.id, planDigest: third.digest });
  await engine.request('models.configure', { config: { id: 'local', kind: 'ollama', model: 'fake-local', endpoint: `http://127.0.0.1:${fake.port}/api/chat`, maxCostMinor: '150' } });
  await assert.rejects(engine.request('bench.compare', { live: true, planId: third.id, approvalId: thirdApproval.id, barsDigest: bars.digest }), code('BENCH_PLAN_STALE'));
  const fourth = await engine.request('bench.planLive', { routeIds: ['local'], caseIds: ['billed-sep'], languages: ['en'], budgetCapMinor: '1000', barsDigest: bars.digest });
  const fourthApproval = await engine.request('bench.approveLive', { planId: fourth.id, planDigest: fourth.digest });
  const newBars = await engine.request('bench.setPassBars', { minRightOrRefusedBps: 9000 });
  await assert.rejects(engine.request('bench.compare', { live: true, planId: fourth.id, approvalId: fourthApproval.id, barsDigest: bars.digest }), code('BENCH_BARS_CHANGED'));
  await assert.rejects(engine.request('bench.compare', { live: true, planId: fourth.id, approvalId: fourthApproval.id, barsDigest: newBars.digest }), code('BENCH_BARS_CHANGED'));
  assert.equal(fake.seen.length, 51);

  const listed = await engine.request('bench.results');
  assert.deepEqual(listed.results.map((r: any) => r.mode), ['live', 'live', 'live']);
  assert.deepEqual(listed.results[2].routes.map((r: any) => r.routeId), ['cloud', 'local']);
  await engine.request('workspace.lock');
});

test('demo mode refuses every live bench step', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-mx-'));
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file' });
  try {
    await engine.request('workspace.create', { name: 'Demo Shop', passphrase: 'correct horse battery staple 42', demo: true, pack: 'ecommerce' });
    const bars = await engine.request('bench.setPassBars', { minRightOrRefusedBps: 9000 });
    await assert.rejects(engine.request('bench.planLive', { budgetCapMinor: '1000', barsDigest: bars.digest }), code('DEMO_EXTERNAL_DISABLED'));
    await assert.rejects(engine.request('bench.approveLive', { planId: 'bench_plan_x', planDigest: 'a'.repeat(64) }), code('DEMO_EXTERNAL_DISABLED'));
    await assert.rejects(engine.request('bench.compare', { live: true, planId: 'bench_plan_x', approvalId: 'x', barsDigest: bars.digest }), code('DEMO_EXTERNAL_DISABLED'));
    await engine.request('workspace.lock');
  } finally { await engine.shutdown(); await rm(directory, { recursive: true, force: true }); }
});
