/** EvoOntology: the dictionary over MCP, the builder agent and the self-evolution loop (filled by the dictionary part of the lane). */
import type { State } from '../contracts.ts';
import type { MethodSpec } from '../modules/types.ts';

export const dictionaryMethods: Record<string, MethodSpec> = {};
export function purgeDictionary(_state: State, _reason: { sourceIds: readonly string[]; removedIds: ReadonlySet<string> }): number { return 0; }
/** Scheduled proposal of small dictionary edits; runs only while autonomy is on and never publishes. */
export async function dictionaryTick(_ctx: import('../contracts.ts').Context, _host: import('../modules/types.ts').ModuleHost, _scheduler: import('../modules/types.ts').SchedulerHost): Promise<unknown[]> { return []; }
