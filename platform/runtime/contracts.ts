import { runClock } from './venture/replay/scope.ts';
import { randomUUID } from 'node:crypto';
import {ChausarError,check,hash} from './portable.ts';
import { formatMoney } from './owner-format.ts';
import { CURRENT_SCHEMA } from './migrations/ladder.ts';
export {ChausarError,InternalError,asInternal,check,hash,internalCheck} from './portable.ts';

export const newId = (prefix = 'item') => `${prefix}_${randomUUID()}`;
export const now = () => runClock().toISOString();
export function minor(value: string | number): string {
  const text = String(value).trim().replaceAll(',', '');
  check(/^-?\d+(\.\d{1,2})?$/.test(text), 'INVALID_AMOUNT', 'Use an amount with at most two decimal places.');
  const sign = text.startsWith('-') ? -1n : 1n;
  const [whole, fraction = ''] = text.replace(/^-/, '').split('.');
  return String(sign * (BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0'))));
}
// One-shot B2: an amount in minor units in the owner form ("₹2,000", "$5,000"), the same as owner-format.ts formatMoney.
export const money = (value: string | bigint, currency = 'INR') => formatMoney(value, currency);
export type Role = 'owner' | 'cofounder' | 'accountant' | 'viewer';
export type Context = { memberId: string; role: Role; epoch: number; channel?: 'desktop' | 'web' | 'phone' | 'mcp'; sourceTainted?: boolean };
export type TrustPolicy = { send: 'nothing' | 'shape' | 'samples'; autonomy: boolean; allowedSources: string[]; retentionDays: number; sharing: boolean };
export type Member = { id: string; name: string; role: Role; active: boolean; epoch: number; branches: string[] };
export type Fact = { id: string; entityId: string; sourceId: string; sourceRow: number; kind: string; validFrom: string; validTo: string | null; learnedAt: string; supersededAt: string | null; fields: Record<string, unknown>; deletedAt?: string; branch?: string };
export type State = {
  schemaVersion: number; revision: number; workspace: { id: string; name: string; currency: string; demo: boolean; createdAt: string };
  members: Member[]; policy: TrustPolicy; ontology: any; facts: Fact[]; imports: any[]; receipts: any[]; answers: any[]; decisions: any[];
  actions: any[]; jobs: any[]; learning: any[]; plugins: any[]; modelReceipts: any[]; activity: any[]; conflicts: any[]; merges: any[]; tombstones: any[];
  conversations: any[]; routes: any[]; sessions: any[]; unsupported: any[]; schedules: any[]; sourceRules: any[];
};
export interface StateStore {
  read(): State;
  update<T>(change: (state: State) => T | Promise<T>): Promise<T>;
}
export function initialState(name: string, demo = false): State {
  return {
    schemaVersion: CURRENT_SCHEMA, revision: 0, workspace: { id: newId('workspace'), name, currency: 'INR', demo, createdAt: now() },
    members: [{ id: 'owner', name: 'Workspace owner', role: 'owner', active: true, epoch: 1, branches: ['*'] }],
    policy: { send: 'nothing', autonomy: false, allowedSources: ['*'], retentionDays: 90, sharing: false }, ontology: null,
    facts: [], imports: [], receipts: [], answers: [], decisions: [], actions: [], jobs: [], learning: [], plugins: [], modelReceipts: [], activity: [], conflicts: [], merges: [], tombstones: [], conversations: [], routes: [], sessions: [], unsupported: [], schedules: [], sourceRules: [],
  };
}
export function authorize(store: StateStore, context: Context, permission: 'read' | 'prepare' | 'approve' | 'admin' = 'read'): Member {
  const member = store.read().members.find(m => m.id === context.memberId);
  check(member?.active && member.epoch === context.epoch && member.role === context.role, 'ACCESS_REVOKED', 'Your workspace access has changed. Sign in again.');
  if (permission !== 'read') check(member.role !== 'viewer', 'FORBIDDEN', 'Your role can only read.');
  if (permission === 'approve' || permission === 'admin') check(['owner', 'cofounder'].includes(member.role), 'FORBIDDEN', 'An owner must approve this change.');
  return member;
}
export function audit(state: State, event: string, details: Record<string, unknown> = {}) {
  state.activity.push({ id: newId('event'), at: now(), event, details });
}
