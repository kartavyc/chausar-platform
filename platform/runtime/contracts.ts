import { randomUUID, createHash } from 'node:crypto';
import type { ScenarioRecord } from './scenario-contracts.ts';
import type { LessonState } from './lesson-contracts.ts';

export class ChausarError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.name = 'ChausarError'; this.code = code; }
}
export function check(condition: unknown, code: string, message: string): asserts condition {
  if (!condition) throw new ChausarError(code, message);
}
export const newId = (prefix = 'item') => `${prefix}_${randomUUID()}`;
export const hash = (value: unknown) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
export const now = () => new Date().toISOString();
export function minor(value: string | number): string {
  const text = String(value).trim().replaceAll(',', '');
  check(/^-?\d+(\.\d{1,2})?$/.test(text), 'INVALID_AMOUNT', 'Use an amount with at most two decimal places.');
  const sign = text.startsWith('-') ? -1n : 1n;
  const [whole, fraction = ''] = text.replace(/^-/, '').split('.');
  return String(sign * (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))));
}
export const money = (value: string | bigint, currency = 'INR') => {
  const n = BigInt(value); const negative = n < 0n; const absolute = negative ? -n : n;
  return `${currency === 'INR' ? '₹' : currency + ' '}${negative ? '-' : ''}${(absolute / 100n).toLocaleString('en-IN')}.${String(absolute % 100n).padStart(2, '0')}`;
};
export type Role = 'owner' | 'cofounder' | 'accountant' | 'viewer';
export type Context = { memberId: string; role: Role; epoch: number; channel?: 'desktop' | 'phone' | 'mcp'; sourceTainted?: boolean };
export type TrustPolicy = { send: 'nothing' | 'shape' | 'samples'; autonomy: boolean; allowedSources: string[]; retentionDays: number; sharing: boolean };
/** `scope: 'mcp'` marks a numbers-only member (a paired assistant): only the numbers server accepts its sessions. */
export type Member = { id: string; name: string; role: Role; active: boolean; epoch: number; branches: string[]; scope?: 'mcp' };
export type Fact = { id: string; entityId: string; sourceId: string; sourceRow: number; kind: string; validFrom: string; validTo: string | null; learnedAt: string; supersededAt: string | null; fields: Record<string, unknown>; deletedAt?: string; branch?: string };
export type State = {
  schemaVersion: number; revision: number; workspace: { id: string; name: string; currency: string; demo: boolean; createdAt: string };
  members: Member[]; policy: TrustPolicy; ontology: any; facts: Fact[]; imports: any[]; receipts: any[]; answers: any[]; decisions: any[];
  actions: any[]; jobs: any[]; learning: any[]; plugins: any[]; modelReceipts: any[]; activity: any[]; conflicts: any[]; merges: any[]; tombstones: any[];
  conversations: any[]; routes: any[]; sessions: any[]; unsupported: any[]; schedules: any[]; sourceRules: any[];
  /** Private encrypted custody; absence in an older workspace is an empty namespace. */
  scenarioRecords?: ScenarioRecord[]; lessonState?: LessonState;
  /** Engine-module namespaces (platform/runtime/modules). Absence is an empty namespace. */
  extensions?: Record<string, unknown>;
};
export interface StateStore {
  read(): State;
  update<T>(change: (state: State) => T | Promise<T>): Promise<T>;
}
export function initialState(name: string, demo = false): State {
  return {
    schemaVersion: 1, revision: 0, workspace: { id: newId('workspace'), name, currency: 'INR', demo, createdAt: now() },
    members: [{ id: 'owner', name: 'Workspace owner', role: 'owner', active: true, epoch: 1, branches: ['*'] }],
    policy: { send: 'nothing', autonomy: false, allowedSources: ['*'], retentionDays: 90, sharing: false }, ontology: null,
    facts: [], imports: [], receipts: [], answers: [], decisions: [], actions: [], jobs: [], learning: [], plugins: [], modelReceipts: [], activity: [], conflicts: [], merges: [], tombstones: [], conversations: [], routes: [], sessions: [], unsupported: [], schedules: [], sourceRules: [],
  };
}
/** A core change to Send, Sharing or seats, described for the registered change guards. */
export type CoreChange = { kind: 'policy'; patch: Partial<TrustPolicy> } | { kind: 'invite' | 'member-add'; role: Role } | { kind: 'member-revoke'; memberId: string };
type CoreHooks = {
  /** Throws to refuse a core change before it applies (dual control). */
  change: (state: State, context: Context, change: CoreChange) => void;
  /** True when the member's seat has ended; every request is then refused. */
  seatEnded: (state: State, memberId: string) => boolean;
  /** True when the member's seat may not see data from this source (markings). */
  sourceHidden: (state: State, member: Member, sourceId: string) => boolean;
};
const coreHooks: { [K in keyof CoreHooks]: Set<CoreHooks[K]> } = { change: new Set(), seatEnded: new Set(), sourceHidden: new Set() };
/** Engine modules register these guards at load (late-bound to avoid import cycles). */
export function registerCoreHook<K extends keyof CoreHooks>(kind: K, hook: CoreHooks[K]): void { (coreHooks[kind] as Set<CoreHooks[K]>).add(hook); }
export function guardChange(state: State, context: Context, change: CoreChange): void { for (const hook of coreHooks.change) hook(state, context, change); }
export function sourceHidden(state: State, member: Member, sourceId: string): boolean { for (const hook of coreHooks.sourceHidden) if (hook(state, member, sourceId)) return true; return false; }
export function authorize(store: StateStore, context: Context, permission: 'read' | 'prepare' | 'approve' | 'admin' = 'read'): Member {
  const state = store.read(); const member = state.members.find(m => m.id === context.memberId);
  check(member?.active && member.epoch === context.epoch && member.role === context.role, 'ACCESS_REVOKED', 'Your workspace access has changed. Sign in again.');
  for (const ended of coreHooks.seatEnded) check(!ended(state, member.id), 'ACCESS_REVOKED', 'Your workspace access has changed. Sign in again.');
  if (permission !== 'read') check(member.role !== 'viewer', 'FORBIDDEN', 'Your role can only read.');
  if (permission === 'approve' || permission === 'admin') check(['owner', 'cofounder'].includes(member.role), 'FORBIDDEN', 'An owner must approve this change.');
  return member;
}
export function audit(state: State, event: string, details: Record<string, unknown> = {}) {
  state.activity.push({ id: newId('event'), at: now(), event, details });
}
