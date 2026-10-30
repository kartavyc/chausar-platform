// Chausar scheduled website checks. lintapple (MIT), original guarded local job; every result needs separate approval.
import { randomUUID } from 'node:crypto';
import { check, ChausarError, type Context } from '../../../contracts.ts';
import type { VentureDeps, SeoFindingRecord } from '../../contracts.ts';
import { currentVenture, listRecords, ventureAction } from '../../records.ts';
import { installedWebsiteChecker, runPublicWebsiteCheck, type WebsiteCheck } from './site-check.ts';
const busy = new WeakSet<object>();
const running = new WeakMap<object, Map<string, AbortController>>();
/** Called only after the owner's exact Stop action has committed. */
export function stopWebsiteRecheck(store: object, id: string): void { running.get(store)?.get(id)?.abort(); }
/** One due approved job per tick. Restarted claims pause; no result is ever approved or shared automatically. */
export async function runWebsiteRechecksDue(deps: VentureDeps, ctx: Context): Promise<void> {
    if (deps.host === 'hosted-web' || busy.has(deps.store) || deps.closing?.signal.aborted)
        return;
    busy.add(deps.store);
    const release = deps.closing?.hold();
    try {
        const venture = currentVenture(deps.store.read());
        if (!venture)
            return;
        const now = deps.clock().toISOString();
        for (const row of listRecords(deps.store.read(), 'venture-seo-finding', venture.id).filter(row => row.recheck?.state === 'collecting'))
            await ventureAction(deps, ctx, 'prepare', 'seo.website.interrupted', tx => { const found = tx.find('venture-seo-finding', row.id); if (found?.recheck?.state === 'collecting')
                tx.replace({ ...found, recheck: { ...found.recheck, state: 'held', error: 'SITE_CHECK_INTERRUPTED', nextAt: null, claimId: null } }); });
        const due = listRecords(deps.store.read(), 'venture-seo-finding', venture.id).filter(row => row.recheck?.state === 'active' && row.recheck.nextAt && row.recheck.nextAt <= now).sort((a, b) => a.recheck!.nextAt!.localeCompare(b.recheck!.nextAt!))[0];
        if (!due)
            return;
        const claimed = await ventureAction(deps, ctx, 'prepare', 'seo.website.claim', tx => { const found = tx.find('venture-seo-finding', due.id); if (!found?.recheck || found.recheck.state !== 'active')
            return null; check(found.website?.approved, 'APPROVAL_REQUIRED', 'Approve the source report before its re-check.'); return tx.replace({ ...found, recheck: { ...found.recheck, state: 'collecting', lastAt: tx.now, claimId: randomUUID() } }); });
        if (!claimed?.recheck)
            return;
        let report: WebsiteCheck | null = null, error: string | null = null;
        const stopped = () => { const current = listRecords(deps.store.read(), 'venture-seo-finding', venture.id).find(row => row.id === claimed.id)?.recheck; return deps.closing?.signal.aborted || current?.state !== 'collecting' || current.claimId !== claimed.recheck!.claimId; };
        const abort = new AbortController();
        const registry = running.get(deps.store) ?? new Map<string, AbortController>();
        running.set(deps.store, registry);
        registry.set(claimed.id, abort);
        const close = () => abort.abort();
        deps.closing?.signal.addEventListener('abort', close, { once: true });
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            check(!stopped(), 'SITE_CHECK_INTERRUPTED', 'This re-check was stopped.');
            const checker = deps.seoWebsiteChecker === undefined ? installedWebsiteChecker(deps.net) : deps.seoWebsiteChecker;
            check(checker, 'SITE_CHECK_PLANNED', 'Install lintapple yourself or upload its JSON report. Chausar never installs it.');
            const pending = runPublicWebsiteCheck(claimed.sourceUrl, deps.net, { async run(url, signal) { check(!stopped(), 'SITE_CHECK_INTERRUPTED', 'This re-check was stopped.'); return checker.run(url, signal); } }, abort.signal);
            const interrupted = new Promise<never>((_, reject) => abort.signal.addEventListener('abort', () => reject(abort.signal.reason instanceof ChausarError ? abort.signal.reason : new ChausarError('SITE_CHECK_INTERRUPTED', 'This re-check was stopped.')), { once: true }));
            timer = setTimeout(() => abort.abort(new ChausarError('SITE_CHECK_TIMEOUT', 'The website check timed out. Nothing was shared.')), 30000);
            report = await Promise.race([pending, interrupted]);
            check(!stopped(), 'SITE_CHECK_INTERRUPTED', 'This re-check was stopped.');
            check(JSON.stringify(report).length <= 45000, 'SITE_CHECK_TOO_LARGE', 'This report has too many findings to keep safely. Split the check by page.');
        }
        catch (cause) {
            error = cause instanceof ChausarError ? cause.code : 'SITE_CHECK_FAILED';
        }
        finally {
            clearTimeout(timer);
            deps.closing?.signal.removeEventListener('abort', close);
            if (registry.get(claimed.id) === abort)
                registry.delete(claimed.id);
        }
        await ventureAction(deps, ctx, 'prepare', 'seo.website.finish', tx => {
            const found = tx.find('venture-seo-finding', claimed.id);
            if (!found?.recheck || found.recheck.state !== 'collecting' || found.recheck.claimId !== claimed.recheck!.claimId)
                return;
            let made: SeoFindingRecord | null = null;
            if (report && !error)
                made = tx.put<SeoFindingRecord>({ ...tx.base('venture-seo-finding'), sourceUrl: found.sourceUrl, ruleId: 'website-check', evidenceDigest: report.receipt, state: 'open', website: { ...report, approved: false, previousReceipt: found.recheck.latestReceipt }, recheck: null });
            tx.replace({ ...found, recheck: { ...found.recheck, state: error ? 'held' : 'active', claimId: null, error, nextAt: error ? null : new Date(Date.parse(tx.now) + 30 * 86400000).toISOString(), latestReceipt: made?.website?.receipt ?? found.recheck.latestReceipt, latestReportId: made?.id ?? found.recheck.latestReportId } });
            tx.emit('desk.changed', { playbook: 'seo-visibility', id: found.id });
        });
    }
    finally {
        release?.();
        busy.delete(deps.store);
    }
}
