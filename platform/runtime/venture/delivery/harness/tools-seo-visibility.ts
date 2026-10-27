// Chausar delivery harness: the seo-visibility playbook's own tools (Search and AI-search visibility; Ink v2 wave 5,
// packages 5E1, 5E2). Package 5-0 registered each name with a stub that answers NOT_BUILT_YET; the package replaces
// each stub with the tool. Only this playbook's roles may hold them (5A1's grants from the definition's tools). Written
// for Chausar; nothing here is learned from an outside source.
import type { ToolName } from '../../contracts.ts';
import { notBuiltTool } from './tool-stub.ts';
import type { Spec } from './tools.ts';

type SeoVisibilityToolName = Extract<ToolName, 'seo.diagnose' | 'seo.aiAccess' | 'seo.panel' | 'seo.siteCheck' | 'seo.corroborate' | 'seo.lint' | 'seo.meta' | 'seo.impact' | 'seo.refresh' | 'seo.local'>;

export const SEO_VISIBILITY_TOOLS: Readonly<Record<SeoVisibilityToolName, Spec>> = Object.freeze({
  'seo.diagnose': notBuiltTool('seo.diagnose', 'read', 'The client\'s site checked on eight fixed dimensions, robots respected.'), // 5E1
  'seo.aiAccess': notBuiltTool('seo.aiAccess', 'read', 'What search and AI fetchers may read on the site, rule by rule.'), // 5E1
  'seo.panel': notBuiltTool('seo.panel', 'compute', 'The answer panel figures with their counts, missing slots kept in.'), // 5E1
  'seo.siteCheck': notBuiltTool('seo.siteCheck', 'read', 'The website check you installed, run on the public site.'), // 5E1
  'seo.corroborate': notBuiltTool('seo.corroborate', 'read', 'A second, independent source for each number an article states.'), // 5E2
  'seo.lint': notBuiltTool('seo.lint', 'compute', 'An article checked for AI-tell words and doorway pages.'), // 5E2
  'seo.meta': notBuiltTool('seo.meta', 'compute', 'Titles, descriptions and structured data from fields seen on the page.'), // 5E2
  'seo.impact': notBuiltTool('seo.impact', 'compute', 'What a change did, read from the Search Console export after it settled.'), // 5E2
  'seo.refresh': notBuiltTool('seo.refresh', 'compute', 'A plan of which pages to refresh and how, never an edit to a live post.'), // 5E2
  'seo.local': notBuiltTool('seo.local', 'read', 'The business\'s name, address and phone checked across the listings you named.'), // 5E2
});
