// Chausar delivery harness: the job-search-desk playbook's own tools (Job-search and career desk; Ink v2 wave 5,
// packages 5I). Package 5-0 registered each name with a stub that answers NOT_BUILT_YET; the package replaces each stub
// with the tool. Only this playbook's roles may hold them (5A1's grants from the definition's tools). Written for
// Chausar; nothing here is learned from an outside source.
import type { ToolName } from '../../contracts.ts';
import { notBuiltTool } from './tool-stub.ts';
import type { Spec } from './tools.ts';

type JobSearchDeskToolName = Extract<ToolName, 'career.facts' | 'career.capture' | 'career.shortlist' | 'career.score'>;

export const JOB_SEARCH_DESK_TOOLS: Readonly<Record<JobSearchDeskToolName, Spec>> = Object.freeze({
  'career.facts': notBuiltTool('career.facts', 'compute', 'The client\'s own facts, each with where it came from.'), // 5I
  'career.capture': notBuiltTool('career.capture', 'compute', 'A job listing the client pasted, saved with its source.'), // 5I
  'career.shortlist': notBuiltTool('career.shortlist', 'compute', 'Jobs shortlisted against the client\'s facts.'), // 5I
  'career.score': notBuiltTool('career.score', 'compute', 'How well a job fits the client\'s facts, by code.'), // 5I
});
