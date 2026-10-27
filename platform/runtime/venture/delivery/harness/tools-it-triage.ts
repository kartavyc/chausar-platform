// Chausar delivery harness: the it-triage playbook's own tools (IT triage desk; Ink v2 wave 5, packages 5R5). Package
// 5-0 registered each name with a stub that answers NOT_BUILT_YET; the package replaces each stub with the tool. Only
// this playbook's roles may hold them (5A1's grants from the definition's tools). Written for Chausar; nothing here is
// learned from an outside source.
import type { ToolName } from '../../contracts.ts';
import { notBuiltTool } from './tool-stub.ts';
import type { Spec } from './tools.ts';

type ItTriageToolName = Extract<ToolName, 'triage.summary'>;

export const IT_TRIAGE_TOOLS: Readonly<Record<ItTriageToolName, Spec>> = Object.freeze({
  'triage.summary': notBuiltTool('triage.summary', 'compute', 'A triage summary of the team\'s help channel.'), // 5R5
});
