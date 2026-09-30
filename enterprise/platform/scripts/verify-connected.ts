import assert from 'node:assert/strict';

/** Test-only fixture authority. Implement with tenant-scoped chausar_core SQL. */
export interface FixtureMutations {
  removeMandateOwners(): Promise<void>;
  assignReplacementOwner(): Promise<void>;
  revokeLeaderGrant(): Promise<void>;
  restore(): Promise<void>;
}

export interface ConnectedContext {
  baseUrl: string;
  leaderToken: string;
  regionalToken: string;
  createWorkflow(investigationId: string): Promise<unknown>;
  signalOwnerAssigned(investigationId: string): Promise<unknown>;
  queryWorkflow(investigationId: string): Promise<unknown>;
  db: unknown;
  fixtures: FixtureMutations;
  /** Exact runtime state predicate, supplied by the workflow integration. */
  isWaitingForOwner(state: unknown): boolean;
  timeoutMs?: number;
  mandateId?: string;
  regionalMandateId?: string;
}

export interface CheckReceipt { name: string; passed: true; }

async function request(ctx: ConnectedContext, path: string, token: string,
                       body?: object): Promise<{ status: number; body: any }> {
  const response = await fetch(new URL(path, ctx.baseUrl), {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(Math.min(ctx.timeoutMs ?? 60_000, 15_000)),
  });
  const text = await response.text();
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { parsed = { nonJsonResponse: true }; }
  return { status: response.status, body: parsed };
}

async function until<T>(ctx: ConnectedContext, label: string,
                        read: () => Promise<T>, ready: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + (ctx.timeoutMs ?? 60_000);
  while (Date.now() < deadline) {
    const value = await read();
    if (ready(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

export async function createInvestigation(ctx: ConnectedContext, token: string,
                                           mandateId = ctx.mandateId ?? 'watch-profit',
                                           dispatch = true): Promise<string> {
  const response = await request(ctx, '/v1/investigations', token, {
    mandateId, metricIds: ['gross_inr', 'shipment_quantity', 'refund_inr'],
    requestId: `acceptance-${crypto.randomUUID()}`,
  });
  assert.equal(response.status, 201, 'create investigation HTTP status');
  assert.equal(typeof response.body.investigationId, 'string');
  assert.ok(response.body.investigationId.length > 0);
  if (dispatch) await ctx.createWorkflow(response.body.investigationId);
  return response.body.investigationId;
}

export async function waitForResult(ctx: ConnectedContext, id: string, token: string): Promise<string> {
  const investigation = await until(ctx, 'completed investigation', async () => {
    const response = await request(ctx, `/v1/investigations/${encodeURIComponent(id)}`, token);
    assert.equal(response.status, 200, 'read investigation HTTP status');
    assert.notEqual(response.body.status, 'failed', 'investigation failed');
    return response.body;
  }, body => body.status === 'completed');
  assert.equal(typeof investigation.resultId, 'string');
  assert.ok(investigation.resultId.length > 0);
  return investigation.resultId;
}

export async function verifyConnected(ctx: ConnectedContext): Promise<CheckReceipt[]> {
  const receipts: CheckReceipt[] = [];
  const pass = (name: string) => receipts.push({ name, passed: true });
  const ontology = await request(ctx, '/v1/ontology', ctx.leaderToken);
  assert.equal(ontology.status, 200);
  assert.ok(ontology.body.definitionId);
  assert.ok(ontology.body.revision !== undefined);
  assert.ok(ontology.body.metrics);
  pass('published ontology available');

  const broadId = await createInvestigation(ctx, ctx.leaderToken);
  const resultId = await waitForResult(ctx, broadId, ctx.leaderToken);
  const resultPath = `/v1/results/${encodeURIComponent(resultId)}`;
  const result = await request(ctx, resultPath, ctx.leaderToken);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.metrics, { gross_inr: 24700, shipment_quantity: 20, refund_inr: 75 });
  assert.equal(result.body.evidence.definitionId, ontology.body.definitionId);
  assert.equal(result.body.evidence.definitionRevision, ontology.body.revision);
  assert.ok(result.body.evidence.sourceRevision !== undefined);
  assert.deepEqual([...result.body.evidence.scopeRegions].sort(), ['north', 'south']);
  pass('real connected broad metrics and evidence');

  assert.equal((await request(ctx, resultPath, ctx.regionalToken)).status, 403);
  pass('stored broad result denied to regional viewer');

  const northId = await createInvestigation(ctx, ctx.regionalToken, ctx.regionalMandateId ?? 'watch-north');
  const northResultId = await waitForResult(ctx, northId, ctx.regionalToken);
  const northResult = await request(ctx, `/v1/results/${encodeURIComponent(northResultId)}`, ctx.regionalToken);
  assert.equal(northResult.status, 200);
  assert.deepEqual(northResult.body.metrics, { gross_inr: 300, shipment_quantity: 9, refund_inr: 35 });
  assert.deepEqual(northResult.body.evidence.scopeRegions, ['north']);
  pass('regional workflow computes northern inputs only');

  const duplicateBody = { mandateId: ctx.mandateId ?? 'watch-profit',
    metricIds: ['gross_inr', 'shipment_quantity', 'refund_inr'], requestId: `duplicate-${crypto.randomUUID()}` };
  const first = await request(ctx, '/v1/investigations', ctx.leaderToken, duplicateBody);
  const second = await request(ctx, '/v1/investigations', ctx.leaderToken, duplicateBody);
  assert.equal(first.status, 201);
  assert.ok(second.status === 200 || second.status === 201);
  assert.equal(typeof first.body.investigationId, 'string');
  assert.equal(second.body.investigationId, first.body.investigationId);
  await ctx.createWorkflow(first.body.investigationId);
  await waitForResult(ctx, first.body.investigationId, ctx.leaderToken);
  pass('duplicate request preserves investigation identity');

  // Mutation sequence is supplied by the runner after actual fixture schema is fixed.
  try {
    const pausedId = await createInvestigation(ctx, ctx.leaderToken, ctx.mandateId ?? 'watch-profit', false);
    await ctx.fixtures.removeMandateOwners();
    await ctx.createWorkflow(pausedId);
    await until(ctx, 'owner waiting state', () => ctx.queryWorkflow(pausedId), ctx.isWaitingForOwner);
    const paused = await request(ctx, `/v1/investigations/${encodeURIComponent(pausedId)}`, ctx.leaderToken);
    assert.equal(paused.status, 200);
    assert.notEqual(paused.body.status, 'completed');
    assert.ok(!paused.body.resultId, 'ownerless investigation must not publish a result');
    pass('last owner removal pauses new work');
    await ctx.fixtures.assignReplacementOwner();
    await ctx.signalOwnerAssigned(pausedId);
    await waitForResult(ctx, pausedId, ctx.leaderToken);
    pass('replacement owner allows continuation');
    await ctx.fixtures.revokeLeaderGrant();
    assert.equal((await request(ctx, resultPath, ctx.leaderToken)).status, 403);
    pass('current grant revocation prevents stored result release');
  } finally {
    await ctx.fixtures.restore();
  }
  return receipts;
}
