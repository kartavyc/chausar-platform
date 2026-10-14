import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState } from '../runtime/contracts.ts';
import type { Context, State, StateStore } from '../runtime/contracts.ts';
import { canSeeFact } from '../runtime/memory.ts';
import { visibleFacts } from '../runtime/trust.ts';
import { coreState, seatOf } from '../runtime/trust-ext/core-state.ts';
import { seatHasEnded } from '../runtime/trust-ext/core-seats.ts';
import '../runtime/trust-ext/core-hooks.ts';

// Synthetic books only: 20,000 facts, 20,000 activity entries and one dated CA seat.
class MemoryStore implements StateStore {
  state: State = initialState('Synthetic large books');
  read() { return this.state; }
  async update<T>(change: (state: State) => T | Promise<T>): Promise<T> { return await change(this.state); }
}
const BOUND_MS = 300; // measured near 100 ms (accountant) and 12 ms (owner); 1.7 s for the accountant before the seat index

function books() {
  const store = new MemoryStore(); const state = store.state; const at = new Date().toISOString();
  state.members.push({ id: 'accountant-1', name: 'Synthetic accountant', role: 'accountant', branches: ['*'], active: true, epoch: 1 } as any);
  state.members.push({ id: 'ca-1', name: 'Synthetic CA', role: 'viewer', branches: ['*'], active: true, epoch: 1 } as any);
  for (let i = 0; i < 20000; i++) state.facts.push({ id: `f${i}`, entityId: `e${i}`, sourceId: `synthetic-${i % 20}`, sourceRow: i, kind: 'invoice', validFrom: '2026-04-01', validTo: null, learnedAt: at, supersededAt: null, fields: {} } as any);
  for (let i = 0; i < 20; i++) state.imports.push({ id: `imp${i}`, sourceId: `synthetic-${i}`, type: 'csv' } as any);
  for (let i = 0; i < 20000; i++) state.activity.push({ id: `ev${i}`, at, event: 'calculation.completed', details: {} } as any);
  state.activity.push({ id: 'ev-accept', at, event: 'auth.invitation.accepted', details: { memberId: 'ca-1', invitationId: 'invite-ca' } } as any);
  coreState(state).seats['invite-ca'] = { inviteId: 'invite-ca', seat: 'ca', name: 'Synthetic CA', endsOn: '2099-01-01', invitedBy: 'owner', at };
  return store;
}
const time = (work: () => unknown) => { const start = performance.now(); const result = work(); return { result, ms: performance.now() - start }; };

test('fact reads stay fast with 20,000 facts, 20,000 activity entries and a dated CA seat', () => {
  const store = books(); const state = store.state;
  const accountant: Context = { memberId: 'accountant-1', role: 'accountant', epoch: 1, channel: 'desktop' };
  const read = time(() => visibleFacts(store, accountant).length);
  assert.equal(read.result, 20000); assert.ok(read.ms < BOUND_MS, `accountant visibleFacts took ${Math.round(read.ms)} ms`);
  const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
  const loop = time(() => state.facts.filter(f => canSeeFact(store, owner, f)).length);
  assert.equal(loop.result, 20000); assert.ok(loop.ms < BOUND_MS, `owner canSeeFact loop took ${Math.round(loop.ms)} ms`);
  // The seat still comes from the invitation, and the end date still applies.
  assert.equal(seatOf(state, state.members.find(m => m.id === 'ca-1')!), 'ca');
  assert.equal(seatHasEnded(state, 'ca-1'), false); assert.equal(seatHasEnded(state, 'ca-1', '2099-01-02'), true);
  assert.equal(seatHasEnded(state, 'owner', '2099-01-02'), false); assert.equal(seatHasEnded(state, 'accountant-1', '2099-01-02'), false);
  // A later acceptance is seen: the index is rebuilt when the activity log grows.
  state.members.push({ id: 'ca-2', name: 'Synthetic CA two', role: 'viewer', branches: ['*'], active: true, epoch: 1 } as any);
  assert.equal(seatOf(state, state.members.at(-1)!), 'viewer');
  state.activity.push({ id: 'ev-accept-2', at: new Date().toISOString(), event: 'auth.invitation.accepted', details: { memberId: 'ca-2', invitationId: 'invite-ca' } } as any);
  assert.equal(seatOf(state, state.members.at(-1)!), 'ca');
});
