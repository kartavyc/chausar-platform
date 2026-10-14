/**
 * Runs one catalogue action through an adapter against a fake system, the way the writeback
 * service does: prepare, do once, read back. Used by Practice and by adapter tests.
 */
import { ChausarError } from '../runtime/contracts.ts';
import type { ActionAdapter, AdapterContext, Connection, DoReceipt, FakeSystem, Observation, Preparation, Secret, SystemId, WireObject } from '../runtime/writeback/types.ts';

export function practiceConnection(system: SystemId, account: Record<string, string>, id = `practice-${system}`): Connection {
  return { id, system, label: `Practice ${system}`, environment: 'practice', account, read: true, write: ['*'], createdAt: '2026-01-01T00:00:00.000Z', createdBy: 'practice', revokedAt: null };
}
export function fakeContext(fake: FakeSystem, connection: Connection, secret: Secret, clock: () => string = () => new Date().toISOString()): AdapterContext {
  return {
    connection, clock, credentials: async () => secret,
    http: fake.transport ?? (async () => { throw new ChausarError('FAKE_NO_HTTP', 'This practice system has no HTTP interface.'); }),
    dial: fake.dial ?? (async () => { throw new ChausarError('FAKE_NO_MAIL', 'This practice system has no mail interface.'); }),
  };
}
export type Cycle = { preparation: Preparation; receipt: DoReceipt | null; doError: string | null; observation: Observation };
export async function cycle(adapter: ActionAdapter<any>, ctx: AdapterContext, payload: unknown, key: string): Promise<Cycle> {
  const valid = adapter.validate(JSON.parse(JSON.stringify(payload)) as WireObject);
  const preparation = await adapter.prepare(ctx, valid, key);
  let receipt: DoReceipt | null = null, doError: string | null = null;
  if (!preparation.alreadyApplied) {
    try { receipt = await adapter.do(ctx, valid, preparation, key); } catch (error) { doError = error instanceof ChausarError ? error.code : 'PROVIDER_OUTCOME_UNKNOWN'; }
  }
  const observation = await adapter.readBack(ctx, valid, preparation, key, receipt);
  return { preparation, receipt, doError, observation };
}
