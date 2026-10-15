import test from 'node:test';
import assert from 'node:assert/strict';
import { availability } from '../runtime/jobs-ext/proposals.ts';
import { prepareReminder } from '../runtime/jobs-ext/adapters.ts';
import { template, type JobTemplate } from '../runtime/jobs-ext/templates.ts';
import { DAY, owner, csv, fixture } from './jobs-ext-fixture.ts';

// Synthetic fixtures and stub hosts only.

test('a template whose method is not registered stays "not built", whatever the base contains', async () => {
  const missing: JobTemplate = { ...template('gst-matching'), requires: { operations: [], method: 'nowhere.notBuilt' } };
  const host: any = { services: { ontology: { current: () => ({ operations: [] }) } }, options: {}, demo: true };
  assert.deepEqual(await availability(host, owner, missing), { available: false, code: 'TEMPLATE_NOT_BUILT', reason: 'This job needs a part of Chausar that is not built yet.' });
});

test('an agent-touched reminder reaches writeback with the outside-text mark on the call’s context; a clean one has none', async () => {
  const calls: { method: string; payload: any; options?: any }[] = [];
  const host: any = { services: { actions: { prepare: async () => ({ id: 'local-draft-id' }) } },
    call: async (method: string, payload: any, options?: any) => { calls.push({ method, payload, options });
      if (method === 'writeback.connections') return [{ id: 'conn-mail', system: 'mail', environment: 'sandbox', write: ['smtp.send'] }];
      if (method === 'writeback.followUp.prepare') return { id: `wb-${calls.length}`, status: 'prepared' };
      throw Object.assign(new Error('unknown'), { code: 'UNKNOWN_METHOD' }); } };
  const request = { invoiceId: 'INV-1', customerId: 'cust-1', text: 'Synthetic', channel: 'mail' as const, idempotencyKey: 'synthetic-key-1', sourceIds: ['s'] };
  const tainted = await prepareReminder(host, { ...owner, sourceTainted: true }, request);
  const clean = await prepareReminder(host, owner, request);
  const prepares = calls.filter(c => c.method === 'writeback.followUp.prepare');
  assert.deepEqual(prepares[0].options, { tainted: true }); assert.equal(prepares[1].options, undefined);
  // writeback's reminder payload is a strict record: the mark travels on the context, never as an extra field.
  assert.deepEqual(Object.keys(prepares[0].payload).sort(), ['connectionId', 'customerId', 'invoiceId', 'sourceIds']);
  assert.equal(tainted.prepared && tainted.via, 'writeback'); assert.equal(clean.prepared && clean.via, 'writeback');
  // writeback's own refusals are rules: the case is blocked with the reason, not a failed step.
  host.call = async (method: string) => { if (method === 'writeback.connections') return [{ id: 'conn-mail', system: 'mail', environment: 'live', write: ['smtp.send'] }]; throw Object.assign(new Error('x'), { code: 'FOLLOW_UP_NO_CONSENT' }); };
  assert.deepEqual(await prepareReminder(host, owner, request), { prepared: false, reason: 'no-agreement' });
  // Without a send-granted connection, a local draft is prepared and nothing is sent.
  host.call = async (method: string) => { if (method === 'writeback.connections') return [{ id: 'conn-mail', system: 'mail', environment: 'live', write: [] }]; throw Object.assign(new Error('x'), { code: 'UNKNOWN_METHOD' }); };
  assert.deepEqual(await prepareReminder(host, owner, request), { prepared: true, actionId: 'local-draft-id', via: 'local-draft' });
});

test('GST matching runs against the connectors lane, then waits for a person to file', async t => {
  const { ui, engine, clock } = await fixture(t);
  await ui('trust.update', { autonomy: true });
  const purchases = (sourceId: string, invoice: string) => { const file: any = csv([{ id: `p-${sourceId}`, kind: 'purchase', date: '2026-09-10', amount: '500.00', customer: '27AAPFU0939F1ZV', invoice }], sourceId);
    file.recipe.allowedKinds = ['purchase']; return file; };
  await ui('sources.import', purchases('synthetic-register', 'PUR-1')); await ui('sources.import', purchases('synthetic-gstr2b', 'PUR-1'));
  await assert.rejects(ui('jobsx.propose', { template: 'gst-matching' }), { code: 'GST_SOURCES_REQUIRED' });
  const card = await ui('jobsx.propose', { template: 'gst-matching', overrides: { gstSources: { registerSourceId: 'synthetic-register', gstr2bSourceId: 'synthetic-gstr2b' } } });
  const { job } = await ui('jobsx.approveProposal', { id: card.id, digest: card.digest });
  clock.now += DAY; await engine.tick();
  const view = await ui('jobsx.get', { id: job.id });
  assert.equal(view.state, 'waiting-for-you', 'filing is a step for a person');
  const step = view.waitingForYou.find((w: any) => w.kind === 'person-step');
  await ui('jobsx.personStep.done', { id: step.id }); await engine.tick();
  const result = await ui('jobsx.result', { id: job.id });
  assert.equal(result.done[0], '1 purchase lines match GSTR-2B. 0 differ in amount, 0 are in your books only, 0 are in GSTR-2B only, 0 are probable matches for you to confirm and 0 were set aside.');
  assert.equal(result.status, 'awaiting-acceptance');
});

test('the deciding agent uses the gateway’s "decide" purpose when it exists, and stays a lookup when the gateway refuses it', async () => {
  const { GatewayAgent } = await import('../runtime/jobs-ext/gateway-agent.ts');
  const receipts: any[] = []; const requests: any[] = [];
  const decideGateway = (answer: unknown) => ({
    store: { read: () => ({ modelReceipts: receipts, routes: [{ id: 'route-api', kind: 'openai-compatible', revision: 1, maxCostMinor: '300', enabled: true }] }), update: async () => undefined } as any,
    listRoutes: () => [{ id: 'route-api', kind: 'openai-compatible', revision: 1, maxCostMinor: '300', enabled: true }],
    preview: async (_ctx: any, request: any) => { requests.push(request); return { id: `p${requests.length}`, approvalRequired: false, purpose: request.purpose, options: request.options }; },
    execute: async () => ({ kind: 'decision', decision: answer, receipt: { id: 'r1', actualCostMinor: '42' } }),
  });
  const item: any = { id: 'c', jobId: 'j', template: 'receivables-week', fields: { bucket: '61-90' }, recordIds: [], sourceIds: [], tainted: false };
  const calc = async () => ({ id: 'calc' });
  const chose = await new GatewayAgent({ gateway: decideGateway({ option: 'remind', confidence: 0.9 }), routeId: 'route-api', calculate: calc }).decide(item, ['remind', 'wait', 'ask-owner'], new AbortController().signal, owner);
  assert.equal(requests[0].purpose, 'decide'); assert.deepEqual(requests[0].options, ['remind', 'wait', 'ask-owner']);
  assert.deepEqual([chose.decision, chose.confidence, chose.costMinor], ['remind', 0.9, '42']);
  const odd = await new GatewayAgent({ gateway: decideGateway({ option: 'pay-now', confidence: 1 }), routeId: 'route-api', calculate: calc }).decide(item, ['remind', 'wait', 'ask-owner'], new AbortController().signal, owner);
  assert.deepEqual([odd.decision, odd.confidence], ['ask-owner', 0], 'only an offered option counts');
  // A gateway without the purpose refuses it; the agent falls back to the lookup request.
  const fallbackRequests: any[] = [];
  const old: any = { ...decideGateway(null), preview: async (_c: any, request: any) => { fallbackRequests.push(request); if (request.purpose === 'decide') throw Object.assign(new Error('x'), { code: 'INVALID_CONVERSATION_PURPOSE' }); return { id: 'p', approvalRequired: false }; },
    execute: async () => ({ kind: 'analysis', plan: { operation: 'aging' }, receipt: { id: 'r', actualCostMinor: '5' } }) };
  const looked = await new GatewayAgent({ gateway: old, routeId: 'route-api', calculate: calc }).decide(item, ['remind', 'wait', 'ask-owner'], new AbortController().signal, owner);
  assert.equal(fallbackRequests.length, 2); assert.equal(fallbackRequests[1].purpose, undefined);
  assert.deepEqual([looked.decision, looked.receiptIds], ['ask-owner', ['calc']]);
});

test('modelsx.price in the agreed shape prices a route; a missing or malformed one is never counted as free', async () => {
  const { routePrice } = await import('../runtime/jobs-ext/adapters.ts');
  const host = (reply: unknown): any => ({ options: {}, store: { read: () => ({ routes: [] }) }, call: async (method: string) => { if (method === 'modelsx.price') { if (reply instanceof Error) throw reply; return reply; } throw Object.assign(new Error('x'), { code: 'UNKNOWN_METHOD' }); } });
  assert.deepEqual(await routePrice(host({ routeId: 'r', unitMinor: '3', basis: 'measured', pricedAt: '2026-10-01T00:00:00.000Z' }), 'r'),
    { routeId: 'r', unitMinor: '3', basis: 'measured', pricedAt: '2026-10-01T00:00:00.000Z', source: 'modelsx' });
  await assert.rejects(routePrice(host({ unitMinor: '0.5', basis: 'measured', pricedAt: '2026-10-01' }), 'r'), { code: 'ROUTE_PRICE_INVALID' });
  await assert.rejects(routePrice(host(Object.assign(new Error('x'), { code: 'UNKNOWN_METHOD' })), 'r'), { code: 'ROUTE_PRICE_UNAVAILABLE' });
  // A route models-ext does not know falls through to host prices; a CLI estimate refusal stands.
  const notFound = host(Object.assign(new Error('x'), { code: 'ROUTE_NOT_FOUND' }));
  await assert.rejects(routePrice(notFound, 'r'), { code: 'ROUTE_PRICE_UNAVAILABLE' });
  assert.deepEqual(await routePrice({ ...notFound, options: { routePrices: { r: { unitMinor: '2' } } } }, 'r'), { routeId: 'r', unitMinor: '2', basis: 'measured', pricedAt: '1970-01-01T00:00:00.000Z', source: 'host' });
  await assert.rejects(routePrice(host(Object.assign(new Error('x'), { code: 'ROUTE_ESTIMATE_UNAVAILABLE' })), 'r'), { code: 'ROUTE_ESTIMATE_UNAVAILABLE' });
});

test('the stock check runs once the dictionary publishes stock_on_hand (core-data’s quantity measure)', async () => {
  const stock = template('stock-check');
  const host = (operations: string[]): any => ({ services: { ontology: { current: () => ({ operations: operations.map(id => ({ id })) }) } }, options: {}, demo: true });
  assert.deepEqual(await availability(host([]), owner, stock), { available: false, code: 'TEMPLATE_CALCULATION_MISSING', reason: 'Your published meanings have no calculation this job needs.' });
  assert.deepEqual(await availability(host(['stock_on_hand']), owner, stock), { available: true });
});

test('round 4 review: a model may only propose a reminder; preview refusals are never charged; core missed notes can be marked read', async t => {
  const { GatewayAgent } = await import('../runtime/jobs-ext/gateway-agent.ts');
  const gw = (answer: unknown, previewError?: Error): any => ({
    store: { read: () => ({ modelReceipts: [], routes: [{ id: 'route-api', kind: 'openai-compatible', revision: 1, maxCostMinor: '300', enabled: true }] }) },
    listRoutes: () => [{ id: 'route-api', kind: 'openai-compatible', revision: 1, maxCostMinor: '300', enabled: true }],
    preview: async () => { if (previewError) throw previewError; return { id: 'p', approvalRequired: false, purpose: 'decide' }; },
    execute: async () => ({ kind: 'decision', decision: answer, receipt: { id: 'r', actualCostMinor: '1' } }) });
  const item: any = { id: 'c', jobId: 'j', template: 'receivables-week', fields: { bucket: '61-90' }, recordIds: [], sourceIds: [], tainted: false };
  const options = ['remind', 'wait', 'ask-owner']; const signal = new AbortController().signal; const calc = async () => ({ id: 'x' });
  assert.equal((await new GatewayAgent({ gateway: gw({ option: 'wait', confidence: 0.99 }), routeId: 'route-api', calculate: calc }).decide(item, options, signal, owner)).decision, 'ask-owner', 'waiting or closing a case is a person’s call');
  const refused = await new GatewayAgent({ gateway: gw(null, Object.assign(new Error('x'), { code: 'PAYLOAD_TOO_LARGE' })), routeId: 'route-api', calculate: calc }).decide(item, options, signal, owner).catch(e => e);
  assert.equal(refused.code, 'PAYLOAD_TOO_LARGE'); assert.equal(refused.dispatched, false, 'nothing left the machine, so nothing is charged');
  const asked: any[] = [];
  const agentTask = { ...gw(null), preview: async (_c: any, r: any) => { asked.push(r); return { id: 'q', approvalRequired: false }; }, execute: async () => ({ kind: 'analysis', plan: { operation: 'aging' }, receipt: { id: 'r' } }) };
  await new GatewayAgent({ gateway: agentTask, routeId: 'route-api', calculate: calc }).decide({ ...item, template: 'agent-task' }, ['done', 'needs-you'], signal, owner);
  assert.equal(asked[0].purpose, undefined, 'a job in your own words stays a lookup');
  // Core-run jobs' missed notes can be marked read.
  const { ui, engine, clock } = await fixture(t);
  await ui('trust.update', { autonomy: true });
  const brief = await ui('jobs.create', { type: 'owner-brief', goal: 'Synthetic owner brief each day', budgetMinor: '10', stopRule: { maxRuns: 5, deadline: new Date(clock.now + 10 * DAY).toISOString() }, catchup: 'skip', intervalMs: DAY, graceMs: 0 });
  clock.now += 3 * DAY + 1000; await engine.tick();
  const notes = (await ui('jobsx.missed')).filter((n: any) => n.jobId === brief.id);
  assert.ok(notes.length >= 1 && notes.every((n: any) => n.seen === false));
  await ui('jobsx.missed.seen', { ids: notes.map((n: any) => n.id) });
  assert.ok((await ui('jobsx.missed')).filter((n: any) => n.jobId === brief.id).every((n: any) => n.seen === true));
});
