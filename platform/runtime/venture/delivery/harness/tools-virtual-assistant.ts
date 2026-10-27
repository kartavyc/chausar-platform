// Chausar delivery harness: the virtual-assistant playbook's own tools (Virtual assistant service; Ink v2 wave 5,
// packages 5R1). Package 5-0 registered each name with a stub that answers NOT_BUILT_YET; the package replaces each
// stub with the tool. Only this playbook's roles may hold them (5A1's grants from the definition's tools). Written for
// Chausar; nothing here is learned from an outside source.
import type { ToolName } from '../../contracts.ts';
import { notBuiltTool } from './tool-stub.ts';
import type { Spec } from './tools.ts';

type VirtualAssistantToolName = Extract<ToolName, 'va.brief'>;

export const VIRTUAL_ASSISTANT_TOOLS: Readonly<Record<VirtualAssistantToolName, Spec>> = Object.freeze({
  'va.brief': notBuiltTool('va.brief', 'compute', 'The client\'s brief for the week from their room.'), // 5R1
});
