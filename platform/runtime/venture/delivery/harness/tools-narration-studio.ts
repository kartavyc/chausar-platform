// Chausar delivery harness: the narration-studio playbook's own tools (Narration and audiobooks; Ink v2 wave 5,
// packages 5Q). Package 5-0 registered each name with a stub that answers NOT_BUILT_YET; the package replaces each stub
// with the tool. Only this playbook's roles may hold them (5A1's grants from the definition's tools). Written for
// Chausar; nothing here is learned from an outside source.
import type { ToolName } from '../../contracts.ts';
import { notBuiltTool } from './tool-stub.ts';
import type { Spec } from './tools.ts';

type NarrationStudioToolName = Extract<ToolName, 'narration.markup' | 'narration.verify'>;

export const NARRATION_STUDIO_TOOLS: Readonly<Record<NarrationStudioToolName, Spec>> = Object.freeze({
  'narration.markup': notBuiltTool('narration.markup', 'compute', 'The script marked up for reading: pauses, names and numbers.'), // 5Q
  'narration.verify': notBuiltTool('narration.verify', 'compute', 'Each narrated sentence heard back and scored against its text.'), // 5Q
});
