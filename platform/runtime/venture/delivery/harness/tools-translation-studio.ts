// Chausar delivery harness: the translation-studio playbook's own tools (Translation and subtitles; Ink v2 wave 5,
// packages 5J1, 5J2). Package 5-0 registered each name with a stub that answers NOT_BUILT_YET; the package replaces
// each stub with the tool. Only this playbook's roles may hold them (5A1's grants from the definition's tools). Written
// for Chausar; nothing here is learned from an outside source.
import type { ToolName } from '../../contracts.ts';
import { notBuiltTool } from './tool-stub.ts';
import type { Spec } from './tools.ts';

type TranslationStudioToolName = Extract<ToolName, 'translate.check' | 'translate.terms' | 'subtitle.check' | 'dub.align' | 'dub.verify'>;

export const TRANSLATION_STUDIO_TOOLS: Readonly<Record<TranslationStudioToolName, Spec>> = Object.freeze({
  'translate.check': notBuiltTool('translate.check', 'compute', 'A translation checked segment by segment by code.'), // 5J1
  'translate.terms': notBuiltTool('translate.terms', 'compute', 'Every term checked against the client\'s locked glossary.'), // 5J1
  'subtitle.check': notBuiltTool('subtitle.check', 'compute', 'Subtitles checked for timing, length and reading speed.'), // 5J1
  'dub.align': notBuiltTool('dub.align', 'compute', 'The dub lined up with the video, segment by segment.'), // 5J2
  'dub.verify': notBuiltTool('dub.verify', 'compute', 'The dub heard back and scored against its text.'), // 5J2
});
