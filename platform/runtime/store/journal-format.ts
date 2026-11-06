import type { State } from '../contracts.ts';
import { InternalError } from '../portable.ts';
export type CollectionDelta = { indexed: boolean; put: { key: string; value: unknown }[]; remove: string[]; order?: string[] };
export type StateDelta = { from: number; revision: number; fields: Record<string, unknown>; collections: Record<string, CollectionDelta>; byteDelta: number };
const refuse = (): never => { throw new InternalError('UNLOCK_FAILED', 'Unable to open the encrypted journal.'); };
function ids(rows: unknown[]): string[] | null {
  const keys = rows.map(row => row && typeof row === 'object' && typeof (row as { id?: unknown }).id === 'string' ? 'id:' + (row as { id: string }).id : '');
  return keys.every(Boolean) && new Set(keys).size === keys.length ? keys : null;
}
function keys(rows: unknown[], indexed: boolean): string[] { return indexed ? rows.map((_, index) => 'index:' + index) : ids(rows) ?? refuse(); }
const bytes = (text: string) => Buffer.byteLength(text);
export function stateDelta(before: State, after: State): StateDelta {
  if (!Number.isSafeInteger(after.revision) || after.revision <= before.revision || before.workspace.id !== after.workspace.id) refuse();
  const prior = before as unknown as Record<string, unknown>, next = after as unknown as Record<string, unknown>;
  if (Object.keys(prior).sort().join('|') !== Object.keys(next).sort().join('|')) refuse();
  const delta: StateDelta = { from: before.revision, revision: after.revision, fields: {}, collections: {}, byteDelta: 0 };
  for (const field of Object.keys(prior)) {
    const left = prior[field], right = next[field];
    if (Array.isArray(left)) {
      if (!Array.isArray(right)) refuse();
      const indexed = !ids(left) || !ids(right), oldKeys = keys(left, indexed), newKeys = keys(right, indexed);
      const old = new Map(oldKeys.map((key, index) => [key, JSON.stringify(left[index])]));
      const fresh = new Map(newKeys.map((key, index) => [key, JSON.stringify(right[index])]));
      const change: CollectionDelta = { indexed, put: [], remove: [] };
      for (const [key, value] of old) { delta.byteDelta -= bytes(value); if (!fresh.has(key)) change.remove.push(key); }
      for (let index = 0; index < newKeys.length; index++) { const key = newKeys[index]!, value = fresh.get(key)!; delta.byteDelta += bytes(value); if (old.get(key) !== value) change.put.push({ key, value: right[index] }); }
      delta.byteDelta += Math.max(0, right.length - 1) - Math.max(0, left.length - 1);
      if (oldKeys.join('\0') !== newKeys.join('\0')) change.order = newKeys;
      if (change.put.length || change.remove.length || change.order) delta.collections[field] = change;
    } else {
      const a = JSON.stringify(left), b = JSON.stringify(right); delta.byteDelta += bytes(b) - bytes(a);
      if (field !== 'revision' && a !== b) delta.fields[field] = right;
    }
  }
  return delta;
}
export function applyStateDelta(before: State, delta: StateDelta): State {
  if (delta.from !== before.revision || !Number.isSafeInteger(delta.revision) || delta.revision <= before.revision) refuse();
  const state = structuredClone(before), out = state as unknown as Record<string, unknown>;
  for (const [field, value] of Object.entries(delta.fields)) {
    if (!Object.hasOwn(out, field) || Array.isArray(out[field]) || field === 'revision') refuse(); out[field] = value;
  }
  for (const [field, change] of Object.entries(delta.collections)) {
    const rows = out[field]; if (!Array.isArray(rows) || typeof change.indexed !== 'boolean') refuse();
    const original = keys(rows, change.indexed), values = new Map(original.map((key, index) => [key, rows[index]]));
    for (const key of change.remove) { if (!values.delete(key)) refuse(); }
    for (const item of change.put) values.set(item.key, item.value);
    const order = change.order ?? original;
    if (new Set(order).size !== order.length || order.length !== values.size || order.some(key => !values.has(key))) refuse();
    out[field] = order.map(key => values.get(key));
  }
  state.revision = delta.revision; if (state.workspace.id !== before.workspace.id) refuse(); return state;
}
