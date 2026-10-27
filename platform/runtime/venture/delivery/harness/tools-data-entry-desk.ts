// Chausar delivery harness: the data-entry-desk playbook's own tools (Data entry desk; Ink v2 wave 5, packages 5R2).
// Package 5-0 registered each name with a stub that answers NOT_BUILT_YET; the package replaces each stub with the
// tool. Only this playbook's roles may hold them (5A1's grants from the definition's tools). Written for Chausar;
// nothing here is learned from an outside source.
import type { ToolName } from '../../contracts.ts';
import { notBuiltTool } from './tool-stub.ts';
import type { Spec } from './tools.ts';

type DataEntryDeskToolName = Extract<ToolName, 'forms.map' | 'forms.readBack'>;

export const DATA_ENTRY_DESK_TOOLS: Readonly<Record<DataEntryDeskToolName, Spec>> = Object.freeze({
  'forms.map': notBuiltTool('forms.map', 'compute', 'The record\'s fields matched to the client\'s form.'), // 5R2
  'forms.readBack': notBuiltTool('forms.readBack', 'read', 'A saved record read back from the client\'s system and compared.'), // 5R2
});
