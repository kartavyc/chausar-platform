// Chausar delivery harness: the phone-receptionist playbook's own tools (AI phone receptionist; Ink v2 wave 5, packages
// 5R6). Package 5-0 registered each name with a stub that answers NOT_BUILT_YET; the package replaces each stub with
// the tool. Only this playbook's roles may hold them (5A1's grants from the definition's tools). Written for Chausar;
// nothing here is learned from an outside source.
import type { ToolName } from '../../contracts.ts';
import { notBuiltTool } from './tool-stub.ts';
import type { Spec } from './tools.ts';

type PhoneReceptionistToolName = Extract<ToolName, 'calls.cost' | 'calls.log'>;

export const PHONE_RECEPTIONIST_TOOLS: Readonly<Record<PhoneReceptionistToolName, Spec>> = Object.freeze({
  'calls.cost': notBuiltTool('calls.cost', 'compute', 'The calls\' cost worked out by code from the provider\'s dated prices.'), // 5R6
  'calls.log': notBuiltTool('calls.log', 'compute', 'A call logged with what was said and who it was handed to.'), // 5R6
});
