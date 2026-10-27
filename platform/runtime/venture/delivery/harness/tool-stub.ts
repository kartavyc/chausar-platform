// Chausar delivery harness: the stub every wave 5 tool name answers until its package lands (Ink v2 wave 5, package
// 5-0). A leaf module: the tool files import it while tools.ts may still be loading. Written for Chausar; nothing here
// is learned from an outside source.
import { ChausarError } from '../../../contracts.ts';
import type { ToolEffect, ToolName } from '../../contracts.ts';
import type { Spec } from './tools.ts';

/** What a stub tool answers: the engine's NOT_BUILT_YET, as a tool failure the agent reads. */
export const NOT_BUILT_TOOL = 'This tool is not built yet.';

/** A tool named in the contract whose package has not landed: it takes no input and answers NOT_BUILT_YET. */
export function notBuiltTool(name: ToolName, effect: ToolEffect, about: string): Spec {
  return {
    name, effect, tier: 'code', endsTurn: false, input: {},
    summary: `Not built yet. ${about}`,
    async run() { throw new ChausarError('NOT_BUILT_YET', NOT_BUILT_TOOL); },
  };
}
