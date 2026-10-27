// Chausar delivery harness: the tender-desk playbook's own tools (Tender and proposal desk; Ink v2 wave 5, packages
// 5O). Package 5-0 registered each name with a stub that answers NOT_BUILT_YET; the package replaces each stub with the
// tool. Only this playbook's roles may hold them (5A1's grants from the definition's tools). Written for Chausar;
// nothing here is learned from an outside source.
import type { ToolName } from '../../contracts.ts';
import { notBuiltTool } from './tool-stub.ts';
import type { Spec } from './tools.ts';

type TenderDeskToolName = Extract<ToolName, 'tender.questions' | 'tender.ground'>;

export const TENDER_DESK_TOOLS: Readonly<Record<TenderDeskToolName, Spec>> = Object.freeze({
  'tender.questions': notBuiltTool('tender.questions', 'compute', 'Every question in the tender, listed by code.'), // 5O
  'tender.ground': notBuiltTool('tender.ground', 'compute', 'Each answer found in the client\'s own documents, with where.'), // 5O
});
