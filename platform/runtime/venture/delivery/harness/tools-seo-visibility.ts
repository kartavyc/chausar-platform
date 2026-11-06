// SEO tools. GEOHub (AGPL ideas only), seo-agent and lintapple (MIT); independent code, lazy imports avoid table cycles.
import { ChausarError } from '../../../contracts.ts';
import type { ToolName } from '../../contracts.ts';
import { SEO_MONTHLY_TOOLS } from './tools-seo-monthly.ts';
import type { Field, Spec } from './tools.ts';
type SeoVisibilityToolName = Extract<ToolName, 'seo.diagnose' | 'seo.aiAccess' | 'seo.panel' | 'seo.siteCheck' | 'seo.corroborate' | 'seo.lint' | 'seo.meta' | 'seo.impact' | 'seo.refresh' | 'seo.local'>;
const line = (about: string, max = 500, required = true): Field => ({ type: 'text', required, max, about });
export const SEO_VISIBILITY_TOOLS: Readonly<Record<SeoVisibilityToolName, Spec>> = Object.freeze({
    'seo.diagnose': { name: 'seo.diagnose', effect: 'read', tier: 'code', endsTurn: false, summary: 'Checks a bounded client site on fixed dimensions; missing evidence stays unknown.', input: { url: line('The client public site URL.') }, async run(env, input) { const { diagnoseSite } = await import('../../playbooks/seo-visibility/diagnose.ts'); const data = await diagnoseSite(String(input.url), env.deps.net); const { seoCountReceipt } = await import('./tools-seo-receipts.ts'); return seoCountReceipt(env, data, { observed: data.confidence.observed, planned: data.confidence.planned, passed: data.rubric.passed }, data.pages.filter(page => page.sha256 !== null).map(page => ({ id: page.url, name: page.url, digest: page.sha256! }))); } },
    'seo.aiAccess': { name: 'seo.aiAccess', effect: 'read', tier: 'code', endsTurn: false, summary: 'Reads robots and raw HTML as Chausar, separating search access from training access.', input: { url: line('The client public page URL.') }, async run(env, input) {
            const { checkFetchPolicy, politeFetch, robotsSafe } = await import('../../build/fetch-policy.ts');
            const { pinnedSend } = await import('../../core/net-guard.ts');
            const { assessAiAccess } = await import('../../playbooks/seo-visibility/ai-access.ts');
            const url = checkFetchPolicy(String(input.url));
            const net = env.deps.net ?? {};
            const guarded = { resolve: net.resolve, send: robotsSafe(net.send ?? pinnedSend, net.resolve) };
            const robots = await politeFetch({ url: url.origin + '/robots.txt', maxBytes: 512 * 1024 }, net);
            const html = await politeFetch({ url: url.href, maxBytes: 512 * 1024 }, guarded);
            let llms = null;
            try {
                const response = await politeFetch({ url: url.origin + '/llms.txt', maxBytes: 256 * 1024 }, guarded);
                llms = { status: response.status, contentType: response.headers['content-type'] ?? '', text: response.body.toString('utf8') };
            }
            catch { /* a missing optional proposal never proves a failure */ }
            const data = assessAiAccess({ robots: robots.status === 200 ? robots.body.toString('utf8') : robots.status >= 400 && robots.status < 500 ? '' : null, path: url.pathname, html: html.status === 200 ? html.body.toString('utf8') : null, llms });
            const { seoCountReceipt } = await import('./tools-seo-receipts.ts');
            const { digest } = await import('../../records.ts');
            return seoCountReceipt(env, data, { allowed: data.search.allowed, planned: data.search.of, unknown: data.search.unknown }, [{ id: url.href, name: url.href, digest: digest([robots.body.toString('base64'), html.body.toString('base64')]) }]);
        } },
    'seo.panel': { name: 'seo.panel', effect: 'compute', tier: 'code', endsTurn: false, summary: 'Counts approved answer-panel slots with the missing slots in the denominator. Never collects paid answers.', input: { panelId: line('An approved panel id.', 80) }, async run(env, input) {
            const { currentVenture, listRecords, findRecord } = await import('../../records.ts');
            const { seoPanelItem } = await import('../../playbooks/seo-visibility/desk.ts');
            const state = env.deps.store.read();
            const venture = currentVenture(state);
            if (!venture || venture.id !== env.ventureId)
                throw new ChausarError('PANEL_NOT_FOUND', 'That answer panel was not found.');
            const panel = listRecords(state, 'venture-seo-panel', venture.id).find(item => item.id === input.panelId);
            if (!panel)
                throw new ChausarError('PANEL_NOT_FOUND', 'That answer panel was not found.');
            const run = env.runRef.kind === 'delivery' ? findRecord(state, 'venture-delivery-run', env.runRef.runId) : null;
            if (!run || run.ventureId !== env.ventureId || !panel.orderId || panel.orderId !== run.orderId)
                throw new ChausarError('PANEL_ORDER_REQUIRED', 'Use an approved answer panel linked to this delivery order.');
            if (panel.state !== 'approved')
                throw new ChausarError('PANEL_APPROVAL_REQUIRED', 'Approve the panel before recording answers.');
            const data = seoPanelItem(state, venture, panel).metrics;
            const { seoCountReceipt } = await import('./tools-seo-receipts.ts');
            return seoCountReceipt(env, data, { mentions: data.mentions.numerator, planned: data.mentions.denominator, missing: data.mentions.missing, filled: data.filled }, [{ id: panel.id, name: 'Approved answer panel', digest: panel.approvedDigest! }]);
        } },
    'seo.siteCheck': { name: 'seo.siteCheck', effect: 'read', tier: 'code', endsTurn: false, summary: 'Reads the owner installed website checker or an uploaded JSON report, keeping its hash and coverage limits.', input: { url: line('The client public site URL.'), file: line('Optional order file alias holding the lintapple JSON report, saved as UTF-8 text.', 20, false) }, async run(env, input) {
            const check = await import('../../playbooks/seo-visibility/site-check.ts');
            if (input.file) {
                const { fileOf } = await import('./tools.ts');
                const file = fileOf(env, input.file);
                if (file.bytes > 1000000)
                    throw new ChausarError('SITE_CHECK_INVALID', 'Give a bounded lintapple JSON report.');
                let raw: unknown;
                try {
                    raw = JSON.parse(Buffer.from(file.contentBase64, 'base64').toString('utf8'));
                }
                catch {
                    throw new ChausarError('SITE_CHECK_INVALID', 'Give a bounded lintapple JSON report.');
                }
                const data = check.websiteReport(String(input.url), raw);
                const { seoCountReceipt } = await import('./tools-seo-receipts.ts');
                return seoCountReceipt(env, data, { findings: data.findings.length, checkedFrames: data.checkedFrames }, [{ id: file.id, name: file.name, digest: data.receipt }]);
            }
            if (env.deps.host === 'hosted-web') throw new ChausarError('SITE_CHECK_DESKTOP_ONLY', 'Run the installed website checker in the desktop app, or upload its JSON report here.');
            const data = await check.runPublicWebsiteCheck(String(input.url), env.deps.net);
            const { seoCountReceipt } = await import('./tools-seo-receipts.ts');
            return seoCountReceipt(env, data, { findings: data.findings.length, checkedFrames: data.checkedFrames }, [{ id: data.url, name: 'Website checker report', digest: data.receipt }]);
        } },
    ...SEO_MONTHLY_TOOLS,
});
