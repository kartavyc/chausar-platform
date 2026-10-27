// Chausar delivery harness: the support-desk playbook's own tools (Support desk for small shops; Ink v2 wave 5,
// packages 5G). Package 5-0 registered each name with a stub that answers NOT_BUILT_YET; the package replaces each stub
// with the tool. Only this playbook's roles may hold them (5A1's grants from the definition's tools). Written for
// Chausar; nothing here is learned from an outside source.
import type { ToolName } from '../../contracts.ts';
import { notBuiltTool } from './tool-stub.ts';
import type { Spec } from './tools.ts';

type SupportDeskToolName = Extract<ToolName, 'support.match' | 'support.ticket'>;

export const SUPPORT_DESK_TOOLS: Readonly<Record<SupportDeskToolName, Spec>> = Object.freeze({
  'support.match': notBuiltTool('support.match', 'compute', 'The answer in the shop\'s own sources that matches a customer\'s question.'), // 5G
  'support.ticket': notBuiltTool('support.ticket', 'compute', 'A support ticket\'s state and due time, kept by code.'), // 5G
});
