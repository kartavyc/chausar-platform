// Chausar fixed-dimension diagnosis. GEOHub (AGPL, ideas only), seo-agent (MIT); independently written.
import { ChausarError } from '../../../contracts.ts';
import { digest } from '../../records.ts';
import { checkFetchPolicy, politeFetch, robotsSafe, type PoliteNet } from '../../build/fetch-policy.ts';
import { pinnedSend } from '../../core/net-guard.ts';
import { assessAiAccess, htmlText } from './ai-access.ts';
export const SEO_DIMENSIONS = ['crawl-access', 'indexability', 'titles-descriptions', 'headings', 'structured-data', 'internal-links', 'content-substance', 'ai-access'] as const;
export type SeoDimension = typeof SEO_DIMENSIONS[number];
export type PageDiagnosis = {
    url: string;
    sha256: string | null;
    dimensions: Record<SeoDimension, boolean | null>;
    gap: string | null;
};
const fixes: Record<SeoDimension, {
    severity: 'high' | 'medium' | 'low';
    impact: string;
    effort: string;
    fix: string;
}> = {
    'crawl-access': { severity: 'high', impact: 'Reading access', effort: 'Check server settings', fix: 'Check the server response and robots rules.' },
    indexability: { severity: 'high', impact: 'Index eligibility', effort: 'Check page settings', fix: 'Review the noindex setting with the site owner.' },
    'titles-descriptions': { severity: 'medium', impact: 'Page description', effort: 'Edit page metadata', fix: 'Give the page a useful title and description.' },
    headings: { severity: 'medium', impact: 'Page structure', effort: 'Edit the heading', fix: 'Add a clear main heading.' },
    'structured-data': { severity: 'low', impact: 'Machine readable context', effort: 'Check eligible schema', fix: 'Check which structured data fits the visible page.' },
    'internal-links': { severity: 'medium', impact: 'Site navigation', effort: 'Add a relevant link', fix: 'Link to a useful page on the same site.' },
    'content-substance': { severity: 'medium', impact: 'Useful page text', effort: 'Review the page copy', fix: 'Add useful visible details about the service.' },
    'ai-access': { severity: 'medium', impact: 'Search fetcher access', effort: 'Review access settings', fix: 'Review search fetcher robots rules; keep training separate.' },
};
const empty = (): Record<SeoDimension, boolean | null> => Object.fromEntries(SEO_DIMENSIONS.map(id => [id, null])) as Record<SeoDimension, boolean | null>;
const attribute = (tag: string, key: string): string | null => new RegExp('(?:^|\\s)' + key + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i').exec(tag)?.slice(1).find(value => value !== undefined) ?? null;
const internalLinks = (html: string, base: URL): string[] => [...html.matchAll(/<a\b[^>]*>/gi)].flatMap(match => {
    const href = attribute(match[0], 'href');
    if (!href)
        return [];
    try {
        const url = new URL(href.replace(/&amp;/g, '&'), base);
        url.hash = '';
        return url.origin === base.origin && /^https?:$/.test(url.protocol) ? [url.href] : [];
    }
    catch {
        return [];
    }
});
/** Read a bounded site as Chausar, respecting robots and the network guard at every redirect. */
export async function diagnoseSite(raw: string, net: PoliteNet = {}) {
    const site = checkFetchPolicy(raw);
    if (/^(?:www\.)?google\.[a-z.]+$/.test(site.hostname) && site.pathname.startsWith('/search'))
        throw new ChausarError('FETCH_POLICY_REFUSED', 'Chausar never scrapes Google search results.');
    const guarded = { resolve: net.resolve, send: robotsSafe(net.send ?? pinnedSend, net.resolve) };
    const read = (url: string) => politeFetch({ url, maxBytes: 512 * 1024, timeoutMs: 10000, maxRedirects: 3 }, guarded);
    let robots: string | null = null;
    try {
        const response = await politeFetch({ url: site.origin + '/robots.txt', maxBytes: 512 * 1024, timeoutMs: 10000 }, net);
        if (response.status === 200)
            robots = response.body.toString('utf8');
        else if (response.status >= 400 && response.status < 500)
            robots = '';
    }
    catch { /* unknown access stays unknown */ }
    let candidates: string[] = [];
    try {
        const sitemap = await read(site.origin + '/sitemap.xml');
        if (sitemap.status === 200)
            candidates = [...sitemap.body.toString('utf8').matchAll(/<loc\b[^>]*>([^<]+)<\/loc>/gi)].flatMap(match => {
                try {
                    const url = checkFetchPolicy(match[1].trim().replace(/&amp;/g, '&'));
                    url.hash = '';
                    return url.origin === site.origin ? [url.href] : [];
                }
                catch {
                    return [];
                }
            });
    }
    catch { /* bounded homepage fallback */ }
    let homepage: Awaited<ReturnType<typeof read>> | null = null;
    if (!candidates.length) {
        try {
            homepage = await read(site.href);
            candidates = [site.href, ...(homepage.status === 200 ? internalLinks(homepage.body.toString('utf8'), site) : [])];
        }
        catch {
            candidates = [site.href];
        }
    }
    candidates = [...new Set(candidates)].slice(0, 10);
    const pages: PageDiagnosis[] = [];
    for (const url of candidates) {
        const dimensions = empty();
        try {
            const answer = homepage?.url === url ? homepage : await read(url);
            if (answer.status < 200 || answer.status >= 300)
                throw new ChausarError('SEO_SOURCE_GAP', 'The page did not return readable content.');
            const html = answer.body.toString('utf8');
            if (!/text\/html/i.test(answer.headers['content-type'] ?? '') && !/<(?:html|head|body|title)\b/i.test(html))
                throw new ChausarError('SEO_SOURCE_GAP', 'The page did not return HTML.');
            const meta = [...html.matchAll(/<meta\b[^>]*>/gi)].map(match => match[0]);
            const noindex = meta.some(tag => /^(?:robots|googlebot)$/i.test(attribute(tag, 'name') ?? '') && /\bnoindex\b/i.test(attribute(tag, 'content') ?? '')) || /\bnoindex\b/i.test(answer.headers['x-robots-tag'] ?? '');
            dimensions['crawl-access'] = true;
            dimensions.indexability = !noindex;
            dimensions['titles-descriptions'] = /<title\b[^>]*>\s*[^<\s][\s\S]*?<\/title>/i.test(html) && meta.some(tag => attribute(tag, 'name')?.toLowerCase() === 'description' && Boolean(attribute(tag, 'content')?.trim()));
            dimensions.headings = /<h1\b[^>]*>\s*[^<\s]/i.test(html);
            const schemas = [...html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
            dimensions['structured-data'] = schemas.some(match => { try {
                const parsed = JSON.parse(match[1]);
                return parsed !== null && typeof parsed === 'object';
            }
            catch {
                return false;
            } });
            dimensions['internal-links'] = internalLinks(html, new URL(url)).length > 0;
            dimensions['content-substance'] = htmlText(html).length >= 200;
            const access = assessAiAccess({ robots, path: new URL(url).pathname, html });
            dimensions['ai-access'] = access.search.unknown > 0 ? null : access.search.allowed === access.search.of;
            pages.push({ url, sha256: digest(answer.body.toString('base64')), dimensions, gap: null });
        }
        catch (error) {
            pages.push({ url, sha256: null, dimensions: empty(), gap: error instanceof ChausarError ? error.code : 'NET_FAILED' });
        }
    }
    const observed = pages.reduce((sum, page) => sum + Object.values(page.dimensions).filter(value => value !== null).length, 0);
    const passed = pages.reduce((sum, page) => sum + Object.values(page.dimensions).filter(value => value === true).length, 0);
    const evidenced = SEO_DIMENSIONS.filter(id => pages.some(page => page.dimensions[id] !== null)).length;
    const backlog = SEO_DIMENSIONS.flatMap(id => {
        const affected = pages.filter(page => page.dimensions[id] === false).map(page => page.url);
        return affected.length ? [{ id, ...fixes[id], pages: affected }] : [];
    }).sort((a, b) => ['high', 'medium', 'low'].indexOf(a.severity) - ['high', 'medium', 'low'].indexOf(b.severity));
    return { site: site.href, pages, gaps: pages.filter(page => page.gap !== null).map(page => ({ url: page.url, code: page.gap })), confidence: { observed, planned: pages.length * SEO_DIMENSIONS.length }, headline: `${evidenced} of ${SEO_DIMENSIONS.length} dimensions have evidence`, rubric: { label: 'our rubric', passed, of: observed }, backlog, receipt: digest(pages) };
}
