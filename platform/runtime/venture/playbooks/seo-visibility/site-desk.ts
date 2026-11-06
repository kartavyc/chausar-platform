// Chausar website report desk and monthly re-check. lintapple (MIT), original guarded scheduled check integration.
import { check } from '../../../contracts.ts';
import type { SeoFindingRecord } from '../../contracts.ts';
import { exactPayload, readVenture, listRecords, digest, requireAppChannel, ventureAction } from '../../records.ts';
import { websiteReport, approveWebsiteCheck } from './site-check.ts';
import type { SeoWebsiteItem } from './records.ts';
import type { DeskHandlers } from '../desk-types.ts';
const asItem = (record: SeoFindingRecord): SeoWebsiteItem => ({ id: record.id, report: record.website!, recheck: record.recheck ?? null });
export const SEO_WEBSITE_DESK: DeskHandlers = { website: {
        async list(deps, ctx, payload) { const p = exactPayload(payload, ['playbook', 'kind', 'filter'], ['playbook', 'kind']); check(p.filter === undefined || p.filter === null, 'INVALID_VENTURE_REQUEST', 'This website report list has no filters.'); const { state, venture } = readVenture(deps, ctx); return { playbook: 'seo-visibility', kind: 'website', rows: listRecords(state, 'venture-seo-finding', venture.id).filter(record => record.website).map(asItem), line: 'Website check reports, each bound to its report hash.' }; },
        async get(deps, ctx, payload) { exactPayload(payload, ['playbook', 'kind', 'id'], ['playbook', 'kind', 'id']); const { state, venture } = readVenture(deps, ctx); const record = listRecords(state, 'venture-seo-finding', venture.id).find(record => record.id === payload.id && record.website); check(record, 'SITE_CHECK_NOT_FOUND', 'That website check was not found.'); const item = asItem(record); return { playbook: 'seo-visibility', kind: 'website', item, digest: digest(item) }; },
        async act(deps, ctx, payload) {
            requireAppChannel(ctx, 'venture.desk.act');
            exactPayload(payload, ['playbook', 'kind', 'id', 'action', 'payload', 'digest'], ['playbook', 'kind', 'id', 'action', 'payload']);
            const result = await ventureAction(deps, ctx, 'approve', 'seo.website.' + payload.action, tx => {
                let record: SeoFindingRecord;
                if (payload.action === 'import') {
                    check(payload.id === 'new' && payload.digest === undefined, 'INVALID_VENTURE_REQUEST', 'A new website check has no prior digest.');
                    const p = exactPayload(payload.payload, ['url', 'report'], ['url', 'report']);
                    check(typeof p.url === 'string', 'SITE_CHECK_INVALID', 'Choose the client site URL.');
                    const report = websiteReport(p.url, p.report);
                    check(JSON.stringify(report).length <= 45000, 'SITE_CHECK_TOO_LARGE', 'This report has too many findings to keep safely. Split the check by page.');
                    const previous = tx.list('venture-seo-finding').filter(item => item.website?.url === report.url).at(-1)?.website?.receipt ?? null;
                    record = tx.put<SeoFindingRecord>({ ...tx.base('venture-seo-finding'), sourceUrl: report.url, ruleId: 'website-check', evidenceDigest: report.receipt, state: 'open', website: { ...report, previousReceipt: previous }, recheck: null });
                }
                else {
                    exactPayload(payload.payload, []);
                    const found = tx.list('venture-seo-finding').find(item => item.id === payload.id && item.website);
                    check(found, 'SITE_CHECK_NOT_FOUND', 'That website check was not found.');
                    record = found;
                    check(payload.digest === digest(asItem(record)), 'SITE_CHECK_STALE', 'This report changed. Review it again.');
                    if (payload.action === 'approve')
                        record = tx.replace({ ...record, website: approveWebsiteCheck(record.website!, record.website!.receipt) });
                    else if (payload.action === 'schedule') {
                        check(record.website!.approved, 'APPROVAL_REQUIRED', 'Approve this report before scheduling its re-check.');
                        check(deps.host !== 'hosted-web', 'SITE_CHECK_DESKTOP_ONLY', 'Scheduled website checks run in the desktop app.');
                        check(!tx.list('venture-seo-finding').some(item => item.sourceUrl === record.sourceUrl && item.recheck && ['active', 'collecting'].includes(item.recheck.state)), 'SITE_CHECK_SCHEDULED', 'This site already has an active re-check. Stop it before creating another.');
                        record = tx.replace({ ...record, recheck: { claimId: null, state: 'active', nextAt: new Date(Date.parse(tx.now) + 30 * 86400000).toISOString(), lastAt: null, latestReceipt: record.website!.receipt, latestReportId: record.id, error: null } });
                    }
                    else if (payload.action === 'stop-recheck') {
                        check(record.recheck && ['active', 'collecting', 'held'].includes(record.recheck.state), 'SITE_CHECK_NOT_FOUND', 'There is no re-check to stop.');
                        record = tx.replace({ ...record, recheck: { ...record.recheck, state: 'stopped', nextAt: null, claimId: null } });
                    }
                    else
                        check(false, 'INVALID_VENTURE_REQUEST', 'This website report action is not available.');
                }
                tx.emit('desk.changed', { playbook: 'seo-visibility', id: record.id });
                return { playbook: 'seo-visibility' as const, kind: 'website', id: record.id, result: asItem(record), line: payload.action === 'schedule' ? 'Re-check approved for every thirty days on this desktop with the installed checker. Each report still needs your approval.' : 'Website check saved.' };
            });
            if (payload.action === 'stop-recheck') {
                const { stopWebsiteRecheck } = await import('./site-recheck.ts');
                stopWebsiteRecheck(deps.store, payload.id);
            }
            return result;
        },
    } };
