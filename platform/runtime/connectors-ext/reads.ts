import type { ApiReadSpec } from '../adapters/read-kit.ts';

/**
 * Read operations reachable through a connected system's own interface. Each binds an adapter
 * description to the recipe that maps its records and checks them against the source's totals.
 * `settings` lists the non-secret connection settings the operation reads; credentials never.
 */
export type ReadBinding = {
  group: string; id: string; label: string; recipe: string; settings: readonly string[];
  spec: ApiReadSpec<any>; config(settings: Readonly<Record<string, string>>): unknown;
  /** False when the adapter refuses live reads by design until a missing piece exists. */
  live: boolean; limitation: string;
};
export const READS: readonly ReadBinding[] = [];
export const readsFor = (group: string) => READS.filter(item => item.group === group);
