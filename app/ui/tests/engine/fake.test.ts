import { describe, expect, it, vi } from 'vitest';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { EngineError, type ConnectorCardLite, type QueueKind, type QueueList } from '../../src/engine/types';
import { connectorLabelOf } from '../../src/parts/ConnectorLabel';

const list = (engine: FakeEngine, scope: 'all' | 'current' = 'all') => engine.request('venture.queue.list', { scope }) as Promise<QueueList>;

describe('fake engine: the queue', () => {
  it('has a row of every kind across the businesses, oldest first, each with one primary action', async () => {
    const engine = new FakeEngine();
    const queue = await list(engine);
    const kinds = new Set(queue.rows.map((r) => r.kind));
    for (const kind of ['draft', 'price', 'quote', 'plan', 'invoice', 'signoff', 'question', 'setup', 'locked', 'connector'] as QueueKind[]) expect(kinds.has(kind), kind).toBe(true);
    const created = queue.rows.map((r) => r.createdAt);
    expect(created).toEqual([...created].sort());
    for (const row of queue.rows) {
      expect(row.actions.length === 1 || row.actions.length === 2, row.id).toBe(true);
      expect(row.actions.filter((a) => a.primary), row.id).toHaveLength(1);
    }
    expect(new Set(queue.rows.map((r) => r.businessName))).toEqual(new Set(['Lumen Studio', 'Ledgerline', 'Sitara Events']));
    expect(queue.needsYou).toBe(queue.rows.length);
    expect(queue.summary).toBe(`${queue.rows.length} need you, across 3 businesses`);
    const current = await list(engine, 'current');
    expect(current.rows.every((r) => r.businessId === 'lumen')).toBe(true);
  });

  it('decides once: a second decision is refused', async () => {
    const engine = new FakeEngine();
    const row = (await list(engine)).rows.find((r) => r.kind === 'price')!;
    const first = await engine.request('venture.queue.decide', { id: row.id, digest: row.digest, action: 'approve' });
    expect(first).toMatchObject({ outcome: 'done', receiptId: expect.stringMatching(/^R-\d{4}$/) });
    expect((first as { line: string }).line).toMatch(/^Approved · R-\d{4}$/);
    const second = await engine.request('venture.queue.decide', { id: row.id, digest: row.digest, action: 'approve' });
    expect(second).toMatchObject({ outcome: 'refused', reason: 'ALREADY_DECIDED' });
    expect((await list(engine)).rows.some((r) => r.id === row.id)).toBe(false);
  });

  it('refuses a stale digest and hands back the new version', async () => {
    const engine = new FakeEngine();
    const row = (await list(engine)).rows.find((r) => r.kind === 'quote')!;
    const changed = engine.touch(row.id);
    expect(changed.digest).not.toBe(row.digest);
    const decision = await engine.request('venture.queue.decide', { id: row.id, digest: row.digest, action: 'approve' });
    expect(decision).toMatchObject({ outcome: 'stale', latest: { id: row.id, digest: changed.digest } });
    const retry = await engine.request('venture.queue.decide', { id: row.id, digest: changed.digest, action: 'approve' });
    expect(retry).toMatchObject({ outcome: 'done' });
  });

  it('refuses approval before the draft was viewed (VIEW_FIRST)', async () => {
    const engine = new FakeEngine();
    const row = (await list(engine)).rows.find((r) => r.kind === 'draft')!;
    expect(row.actions.find((a) => a.primary)?.requiresView).toBe(true);
    const early = await engine.request('venture.queue.decide', { id: row.id, digest: row.digest, action: 'approve' });
    expect(early).toMatchObject({ outcome: 'refused', reason: 'VIEW_FIRST' });
    const viewed = await engine.request('venture.queue.decide', { id: row.id, digest: row.digest, action: 'approve', viewed: true });
    expect(viewed).toMatchObject({ outcome: 'done' });
  });

  it('an answer needs words', async () => {
    const engine = new FakeEngine();
    const row = (await list(engine)).rows.find((r) => r.actions.some((a) => a.id === 'answer'))!;
    expect(await engine.request('venture.queue.decide', { id: row.id, digest: row.digest, action: 'answer', answer: ' ' })).toMatchObject({ outcome: 'refused', reason: 'ANSWER_REQUIRED' });
    expect(await engine.request('venture.queue.decide', { id: row.id, digest: row.digest, action: 'answer', answer: 'Option B' })).toMatchObject({ outcome: 'done' });
  });

  it('tells listeners the queue changed after a decision', async () => {
    const engine = new FakeEngine();
    const client = createFakeClient(engine);
    const listener = vi.fn();
    client.subscribe(listener);
    const row = (await client.request('venture.queue.list', {})).rows.find((r) => r.kind === 'signoff')!;
    await client.request('venture.queue.decide', { id: row.id, digest: row.digest, action: 'send-to-ca' });
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ type: 'queue.changed', businessId: row.businessId }));
  });
});

describe('fake engine: runs, team, money and connections', () => {
  it('has runs in every state, with indeterminate progress and a model estimate', async () => {
    const engine = new FakeEngine();
    const { runs } = (await engine.request('venture.runs.list', { state: 'all' })) as { runs: { state: string; progress?: unknown; estimate?: boolean; runId: string }[] };
    expect(new Set(runs.map((r) => r.state))).toEqual(new Set(['active', 'waiting', 'done', 'failed']));
    expect(runs.some((r) => r.progress === 'indeterminate')).toBe(true);
    expect(runs.some((r) => r.estimate === true)).toBe(true);
    const active = (await engine.request('venture.runs.list', { state: 'active' })) as { runs: { state: string }[] };
    expect(active.runs.every((r) => r.state === 'active' || r.state === 'waiting')).toBe(true);
    const failed = runs.find((r) => r.state === 'failed')!;
    const detail = (await engine.request('venture.runs.get', { runId: failed.runId })) as { error?: string; steps: { state: string }[] };
    expect(detail.error).toMatch(/ffmpeg/);
    expect(detail.steps.some((s) => s.state === 'failed')).toBe(true);
    await expect(engine.request('venture.runs.get', { runId: 'nope' })).rejects.toBeInstanceOf(EngineError);
  });

  it('refuses to loosen a floor step (GATE_FLOOR) and allows the rest', async () => {
    const engine = new FakeEngine();
    const { agents } = (await engine.request('venture.team.list', {})) as { agents: { id: string; steps: { id: string; floor: boolean; gate: string }[] }[] };
    const withFloor = agents.find((a) => a.steps.some((s) => s.floor))!;
    const floor = withFloor.steps.find((s) => s.floor)!;
    const loose = await engine.request('venture.team.gate', { agentId: withFloor.id, stepId: floor.id, gate: 'auto' }).catch((e: unknown) => e);
    expect((loose as EngineError).code).toBe('GATE_FLOOR');
    const open = agents.flatMap((a) => a.steps.map((s) => ({ a, s }))).find(({ s }) => !s.floor && s.gate === 'hold')!;
    const updated = (await engine.request('venture.team.gate', { agentId: open.a.id, stepId: open.s.id, gate: 'auto' })) as { agent: { steps: { id: string; gate: string }[] } };
    expect(updated.agent.steps.find((s) => s.id === open.s.id)?.gate).toBe('auto');
  });

  it('switching business changes the current venture and team; a passphrase business refuses', async () => {
    const engine = new FakeEngine();
    expect(((await engine.request('venture.get', {})) as { venture: { workingName: string } }).venture.workingName).toBe('Lumen Studio');
    await engine.request('workspace.open', { folder: 'ledgerline' });
    expect(((await engine.request('venture.get', {})) as { venture: { workingName: string } }).venture.workingName).toBe('Ledgerline');
    const locked = await engine.request('workspace.open', { folder: 'sitara' }).catch((e: unknown) => e);
    expect((locked as EngineError).code).toBe('PASSPHRASE_REQUIRED');
  });

  it('has receipts, spend of every kind, journal states, evidence and every connector label', async () => {
    const engine = new FakeEngine();
    const receipt = (await engine.request('venture.receipt.get', { id: 'R-0415' })) as { figures: { display: string }[] };
    expect(receipt.figures.length).toBeGreaterThan(0);
    const books = (await engine.request('venture.books.summary', {})) as { figures: { receiptId: string }[]; openInvoices: unknown[] };
    expect(books.figures.every((f) => /^R-\d{4}$/.test(f.receiptId))).toBe(true);
    const spend = (await engine.request('venture.spend.list', {})) as { rows: { kind: string }[] };
    expect(new Set(spend.rows.map((r) => r.kind))).toEqual(new Set(['estimate', 'billed', 'refused']));
    const journal = (await engine.request('venture.journal.list', {})) as { entries: { state: string }[] };
    expect(new Set(journal.entries.map((e) => e.state))).toEqual(new Set(['described', 'approved', 'applied', 'rejected', 'outcome_unknown']));
    const evidence = (await engine.request('venture.evidence.list', {})) as { items: { claim: string }[] };
    expect(new Set(evidence.items.map((e) => e.claim))).toEqual(new Set(['observed', 'inferred', 'needs-your-data']));
    const cards = (await engine.request('venture.connectors.list', {})) as ConnectorCardLite[];
    const labels = new Set(cards.map(connectorLabelOf));
    expect(labels).toEqual(new Set(['handoff', 'read', 'write', 'planned']));
    expect(cards.some((c) => c.posting?.mode === 'owner-browser-session')).toBe(true);
  });
});
