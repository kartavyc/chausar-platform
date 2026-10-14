import type { State } from '../contracts.ts';
import type { MethodSpec } from '../modules/types.ts';

export const sharingMethods: Record<string, MethodSpec> = {};
export function purgeSharing(_state: State, _reason: { sourceIds: readonly string[]; removedIds: ReadonlySet<string> }): number { return 0; }
