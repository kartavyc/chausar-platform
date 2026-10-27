// Chausar delivery harness: the website-studio playbook's own tools (Website builder; Ink v2 wave 5, packages 5P).
// Package 5-0 registered each name with a stub that answers NOT_BUILT_YET; the package replaces each stub with the
// tool. Only this playbook's roles may hold them (5A1's grants from the definition's tools). Written for Chausar;
// nothing here is learned from an outside source.
import type { ToolName } from '../../contracts.ts';
import { notBuiltTool } from './tool-stub.ts';
import type { Spec } from './tools.ts';

type WebsiteStudioToolName = Extract<ToolName, 'site.requirements' | 'site.uiReport' | 'site.flow' | 'site.preview'>;

export const WEBSITE_STUDIO_TOOLS: Readonly<Record<WebsiteStudioToolName, Spec>> = Object.freeze({
  'site.requirements': notBuiltTool('site.requirements', 'compute', 'The site\'s requirements from the brief, each checkable.'), // 5P
  'site.uiReport': notBuiltTool('site.uiReport', 'compute', 'The site\'s screens checked against the requirements.'), // 5P
  'site.flow': notBuiltTool('site.flow', 'compute', 'The screen flow checked step by step.'), // 5P
  'site.preview': notBuiltTool('site.preview', 'read', 'A preview of the client\'s site, read as a visitor sees it.'), // 5P
});
