// Chausar delivery harness: the lead-generation playbook's own tools (Lead generation and appointment setting; Ink v2
// wave 5, packages 5M). Package 5-0 registered each name with a stub that answers NOT_BUILT_YET; the package replaces
// each stub with the tool. Only this playbook's roles may hold them (5A1's grants from the definition's tools). Written
// for Chausar; nothing here is learned from an outside source.
import type { ToolName } from '../../contracts.ts';
import { notBuiltTool } from './tool-stub.ts';
import type { Spec } from './tools.ts';

type LeadGenerationToolName = Extract<ToolName, 'leads.osm' | 'leads.enrich' | 'leads.dedupe' | 'community.vote'>;

export const LEAD_GENERATION_TOOLS: Readonly<Record<LeadGenerationToolName, Spec>> = Object.freeze({
  'leads.osm': notBuiltTool('leads.osm', 'read', 'Local businesses from OpenStreetMap, whose terms allow it.'), // 5M
  'leads.enrich': notBuiltTool('leads.enrich', 'read', 'A business\'s public details from its own site.'), // 5M
  'leads.dedupe': notBuiltTool('leads.dedupe', 'compute', 'Duplicate leads merged by code.'), // 5M
  'community.vote': notBuiltTool('community.vote', 'compute', 'Votes on which lead to call first, counted by code.'), // 5M
});
