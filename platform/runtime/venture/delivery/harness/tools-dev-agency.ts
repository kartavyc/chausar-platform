// Chausar delivery harness: the dev-agency playbook's own tools (Dev agency: maintenance, QA and security reviews; Ink
// v2 wave 5, packages 5R4). Package 5-0 registered each name with a stub that answers NOT_BUILT_YET; the package
// replaces each stub with the tool. Only this playbook's roles may hold them (5A1's grants from the definition's
// tools). Written for Chausar; nothing here is learned from an outside source.
import type { ToolName } from '../../contracts.ts';
import { notBuiltTool } from './tool-stub.ts';
import type { Spec } from './tools.ts';

type DevAgencyToolName = Extract<ToolName, 'qa.verdict' | 'security.scan'>;

export const DEV_AGENCY_TOOLS: Readonly<Record<DevAgencyToolName, Spec>> = Object.freeze({
  'qa.verdict': notBuiltTool('qa.verdict', 'compute', 'The verdict from the test run, by code.'), // 5R4
  'security.scan': notBuiltTool('security.scan', 'read', 'The code scanned for security problems, with the owner of the code allowing it.'), // 5R4
});
