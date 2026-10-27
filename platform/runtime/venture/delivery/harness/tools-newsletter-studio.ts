// Chausar delivery harness: the newsletter-studio playbook's own tools (Newsletter service; Ink v2 wave 5, packages
// 5N). Package 5-0 registered each name with a stub that answers NOT_BUILT_YET; the package replaces each stub with the
// tool. Only this playbook's roles may hold them (5A1's grants from the definition's tools). Written for Chausar;
// nothing here is learned from an outside source.
import type { ToolName } from '../../contracts.ts';
import { notBuiltTool } from './tool-stub.ts';
import type { Spec } from './tools.ts';

type NewsletterStudioToolName = Extract<ToolName, 'newsletter.presend' | 'newsletter.import' | 'newsletter.slices' | 'newsletter.stats'>;

export const NEWSLETTER_STUDIO_TOOLS: Readonly<Record<NewsletterStudioToolName, Spec>> = Object.freeze({
  'newsletter.presend': notBuiltTool('newsletter.presend', 'compute', 'An issue checked before it goes: links, size and the unsubscribe line.'), // 5N
  'newsletter.import': notBuiltTool('newsletter.import', 'compute', 'The subscriber list from an export, with consent kept.'), // 5N
  'newsletter.slices': notBuiltTool('newsletter.slices', 'compute', 'The list split into groups by code.'), // 5N
  'newsletter.stats': notBuiltTool('newsletter.stats', 'compute', 'An issue\'s opens and clicks from its export.'), // 5N
});
