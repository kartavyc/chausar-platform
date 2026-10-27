// Chausar delivery harness: the podcast-to-article playbook's own tools (Podcast to articles; Ink v2 wave 5, packages
// 5L). Package 5-0 registered each name with a stub that answers NOT_BUILT_YET; the package replaces each stub with the
// tool. Only this playbook's roles may hold them (5A1's grants from the definition's tools). Written for Chausar;
// nothing here is learned from an outside source.
import type { ToolName } from '../../contracts.ts';
import { notBuiltTool } from './tool-stub.ts';
import type { Spec } from './tools.ts';

type PodcastToArticleToolName = Extract<ToolName, 'article.ledger' | 'article.style'>;

export const PODCAST_TO_ARTICLE_TOOLS: Readonly<Record<PodcastToArticleToolName, Spec>> = Object.freeze({
  'article.ledger': notBuiltTool('article.ledger', 'compute', 'Each sentence of the article tied to where the transcript says it.'), // 5L
  'article.style': notBuiltTool('article.style', 'compute', 'The article checked against the client\'s style.'), // 5L
});
