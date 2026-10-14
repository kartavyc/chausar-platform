/** Shared helpers for the Trust and Tools part of the lane (`laneState(state).tools`). */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { hostname } from 'node:os';
import { check } from '../contracts.ts';
import type { State } from '../contracts.ts';
import { laneState } from './lane-state.ts';

export type Tools = Record<string, any>;
export function tools(state: State): Tools { return laneState(state).tools; }

/** Requests are closed objects; `language` is accepted everywhere. */
export function fields(payload: Record<string, any>, allowed: string[]): Record<string, any> {
  check(payload && typeof payload === 'object' && !Array.isArray(payload) && Object.keys(payload).every(key => key === 'language' || allowed.includes(key)),
    'INVALID_FIELDS', 'This request has a field it does not take.');
  return payload;
}
export const sha256 = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');

/** Sorted-key JSON of plain data; undefined fields are dropped as they are on disk. */
export function canonicalJson(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(item => item === undefined ? 'null' : canonicalJson(item)).join(',')}]`;
  return `{${Object.keys(value).filter(key => (value as any)[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${canonicalJson((value as any)[key])}`).join(',')}}`;
}

/** This computer as a short label; the raw host name never leaves this function. */
export const computerLabel = () => `computer-${sha256(hostname()).slice(0, 8)}`;

export function memberName(state: State, memberId: unknown): string {
  return typeof memberId === 'string' ? state.members.find(member => member.id === memberId)?.name ?? 'A former member' : 'Chausar';
}

/** True when a record names the source or one of its facts anywhere inside it. */
export function references(value: unknown, sourceId: string, factIds: ReadonlySet<string>, seen = new Set<unknown>()): boolean {
  if (typeof value === 'string') return value === sourceId || factIds.has(value);
  if (!value || typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  return Object.values(value).some(item => references(item, sourceId, factIds, seen));
}

export function shipped<T>(name: string): T { return JSON.parse(readFileSync(new URL(`./${name}`, import.meta.url), 'utf8')) as T; }

export const paise = (value: unknown): bigint => typeof value === 'string' && /^\d{1,30}$/.test(value) ? BigInt(value) : 0n;
export const newestFirst = <T extends { at: string }>(items: T[]) => items.sort((a, b) => b.at.localeCompare(a.at));
