/** Chart-of-accounts sorting proposals and the ladder step 3 dataset export (filled by the accounts part of the lane). */
import type { State } from '../contracts.ts';
import type { MethodSpec } from '../modules/types.ts';

export const accountsMethods: Record<string, MethodSpec> = {};
export function purgeAccounts(_state: State, _reason: { sourceIds: readonly string[]; removedIds: ReadonlySet<string> }): number { return 0; }
