// Round 6 (re-check 026): Today's Earlier lists what happened in the business, as the engine's venture.earlier.list does
// (platform/tests/venture-earlier.test.ts): outside effects, decisions (a Today click among them, in the decision
// record's own words) and searches for customers that ended. The fake answers the same way, from the same function.
import { describe, expect, it } from 'vitest';
import { FakeEngine } from '../../src/engine/fake';
import type { BlueprintViewLite, EarlierEntry, QueueDecision, QueueList } from '../../src/engine/types';

const earlier = async (engine: FakeEngine, params: Record<string, unknown> = {}) => ((await engine.request('venture.earlier.list', params as never)) as { entries: EarlierEntry[] }).entries;

describe('venture.earlier.list in the fake', () => {
  it('a price accepted on Today is listed first, in the decision record\'s words; the journal lines follow', async () => {
    const engine = new FakeEngine();
    const before = await earlier(engine);
    expect(before.length).toBeGreaterThan(0);
    expect(before.every((entry) => entry.from === 'journal'), 'the step a saved rule let run is the journal\'s line, not a second row').toBe(true);
    const plan = await engine.request('venture.blueprint.get', {}) as BlueprintViewLite;
    const [first] = plan.blueprint.offers;
    await engine.request('venture.blueprint.update', { patch: { offers: [{ id: first!.id, unitPrice: '3000' }] } });
    const row = ((await engine.request('venture.queue.list', { scope: 'current' })) as QueueList).rows.find((item) => item.viewRef?.kind === 'plan')!;
    const decided = await engine.request('venture.queue.decide', { id: row.id, digest: row.digest, action: 'approve' }) as QueueDecision;
    expect(decided.outcome).toBe('done');
    const [top] = await earlier(engine);
    expect(top).toMatchObject({ from: 'decision', title: `You chose Approve: New price for ${first!.name.value} accepted.`, line: null, state: 'applied' });
    const { decisions } = await engine.request('venture.decisions.list', {}) as { decisions: { line: string }[] };
    expect(decisions[0]!.line).toBe(top!.title);
  });

  it('limit holds, and a bad limit or field is refused as the engine refuses it', async () => {
    const engine = new FakeEngine();
    expect(await earlier(engine, { limit: 1 })).toHaveLength(1);
    for (const params of [{ limit: 0 }, { limit: 51 }, { limit: 1.5 }, { other: 1 }]) {
      await expect(earlier(engine, params)).rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST' });
    }
  });
});
