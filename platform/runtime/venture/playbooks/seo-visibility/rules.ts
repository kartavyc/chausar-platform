// Chausar SEO rule register, checked against vendor documentation on 27 October 2026. No source copied.
import type { DatedRule } from '../kit/define.ts';
const official = (id: string, topic: string, rule: string, url: string, usedBy: string[]): DatedRule => ({
    id, scope: 'Search visibility', topic, rule, sources: [{ title: topic, url }], checkedOn: '2026-10-27', read: 'official',
    how: 'Read the official documentation on build day.', usedBy, limitations: 'Published controls describe access, never a ranking guarantee.', needs: null,
});
export const SEO_RULES: readonly DatedRule[] = [
    official('robots', 'Robots access', 'Respect the site robots rules before reading a page.', 'https://developers.google.com/search/docs/crawling-indexing/robots/intro', ['diagnose']),
    official('googlebot', 'Google search crawler', 'Googlebot is a search crawler.', 'https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers', ['diagnose']),
    official('google-extended', 'Google training control', 'Google-Extended controls model uses separately from Google search.', 'https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers', ['diagnose']),
    official('oai-searchbot', 'OpenAI search crawler', 'OAI-SearchBot is for search rather than model training.', 'https://developers.openai.com/api/docs/bots', ['diagnose']),
    official('gptbot', 'OpenAI training crawler', 'GPTBot is a model training crawler, counted separately from search.', 'https://developers.openai.com/api/docs/bots', ['diagnose']),
    official('claude-searchbot', 'Claude search crawler', 'Claude-SearchBot indexes content for search.', 'https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler', ['diagnose']),
    official('claudebot', 'Claude training crawler', 'ClaudeBot collects content that may contribute to training.', 'https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler', ['diagnose']),
    official('perplexitybot', 'Perplexity search crawler', 'PerplexityBot is a search crawler, separate from user initiated fetching.', 'https://docs.perplexity.ai/docs/resources/perplexity-crawlers', ['diagnose']),
    official('spam-policies', 'Search spam policies', 'Never cloak pages, promise rankings or build doorway pages.', 'https://developers.google.com/search/docs/essentials/spam-policies', ['no-ranking-promise']),
    { id: 'llms-proposal', scope: 'Search visibility', topic: 'The llms.txt proposal', rule: 'The llms.txt file is a proposal, not a ranking requirement.', sources: [{ title: 'The llms.txt proposal', url: 'https://llmstxt.org/' }], checkedOn: '2026-10-27', read: 'secondary', how: 'Read the proposal on build day.', usedBy: ['diagnose'], limitations: 'Its presence does not prove visibility.', needs: null },
];
