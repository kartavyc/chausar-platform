// SEO website fake: exact report validation and owner approval, using Chausar's real browser-safe report schema.
import { EngineError } from './types';
import type { FakeDeskKind } from './fake-playbooks';
import type { W4DeskHost } from './fake-w4';
import type { SeoWebsiteItem } from '../../../../platform/runtime/venture/playbooks/seo-visibility/records';
import { parseWebsiteReport } from '../../../../platform/runtime/venture/playbooks/seo-visibility/site-report-core';
const need = (ok: unknown, code: string, words: string) => {
    if (!ok)
        throw new EngineError(code, words);
};
const exact = (raw: unknown, keys: string[], required = keys) => { need(raw && typeof raw === 'object' && !Array.isArray(raw), 'INVALID_VENTURE_REQUEST', 'Send one request object.'); const p = raw as Record<string, unknown>; need(Object.keys(p).every(key => keys.includes(key)) && required.every(key => Object.hasOwn(p, key)), 'INVALID_VENTURE_REQUEST', 'Send the required fields and nothing else.'); return p; };
/** Imported report hashes survive remounts and rechecks; the original large report is not retained. */
export function fakeSeoWebsiteKind(host: W4DeskHost): FakeDeskKind {
    const all = new Map<string, Map<string, SeoWebsiteItem>>();
    let sequence = 0;
    const current = () => {
        if (!all.has(host.current()))
            all.set(host.current(), new Map());
        return all.get(host.current())!;
    };
    const item = (id: unknown) => { const found = current().get(String(id)); need(found, 'SITE_CHECK_NOT_FOUND', 'That website check was not found.'); return structuredClone(found!); };
    const guarded = <T,>(run: () => T): T => {
        try {
            return run();
        }
        catch (error) {
            if (error instanceof Error && 'code' in error)
                throw new EngineError(String(error.code), error.message);
            throw error;
        }
    };
    return {
        list(p) { return guarded(() => { const body = exact(p, ['playbook', 'kind', 'filter'], ['playbook', 'kind']); need(body.filter === undefined || body.filter === null, 'INVALID_VENTURE_REQUEST', 'This website report list has no filters.'); return { playbook: 'seo-visibility', kind: 'website', rows: [...current().values()].map(value => structuredClone(value)), line: 'Website check reports, each bound to its report hash.' }; }); },
        get(p) { return guarded(() => { const body = exact(p, ['playbook', 'kind', 'id']); const value = item(body.id); return { playbook: 'seo-visibility', kind: 'website', item: value, digest: host.digest(value) }; }); },
        act(p) {
            return guarded(() => {
                const body = exact(p, ['playbook', 'kind', 'id', 'action', 'payload', 'digest'], ['playbook', 'kind', 'id', 'action', 'payload']);
                let value: SeoWebsiteItem;
                if (body.action === 'import') {
                    need(body.id === 'new' && body.digest === undefined, 'INVALID_VENTURE_REQUEST', 'A new website check has no prior digest.');
                    const input = exact(body.payload, ['url', 'report']);
                    need(typeof input.url === 'string', 'SITE_CHECK_INVALID', 'Choose the client site URL.');
                    const report = parseWebsiteReport(input.url as string, input.report, host.digest);
                    need(JSON.stringify(report).length <= 45000, 'SITE_CHECK_TOO_LARGE', 'This report has too many findings to keep safely. Split the check by page.');
                    const previous = [...current().values()].filter(value => value.report.url === report.url).at(-1)?.report.receipt ?? null;
                    value = { id: 'seofinding_' + (++sequence), report: { ...report, previousReceipt: previous }, recheck: null };
                }
                else {
                    exact(body.payload, []);
                    value = item(body.id);
                    need(body.digest === host.digest(value), 'SITE_CHECK_STALE', 'This report changed. Review it again.');
                    if (body.action === 'approve')
                        value.report.approved = true;
                    else if (body.action === 'schedule') {
                        need(value.report.approved, 'APPROVAL_REQUIRED', 'Approve this report before scheduling its re-check.');
                        need(!host.hosted(), 'SITE_CHECK_DESKTOP_ONLY', 'Scheduled website checks run in the desktop app.');
                        need(![...current().values()].some(item => item.report.url === value.report.url && item.recheck && ['active', 'collecting'].includes(item.recheck.state)), 'SITE_CHECK_SCHEDULED', 'This site already has an active re-check. Stop it before creating another.');
                        value.recheck = { claimId: null, state: 'active', nextAt: new Date(Date.parse(host.now()) + 30 * 86400000).toISOString(), lastAt: null, latestReceipt: value.report.receipt, latestReportId: value.id, error: null };
                    }
                    else if (body.action === 'stop-recheck') {
                        need(value.recheck && ['active', 'collecting', 'held'].includes(value.recheck.state), 'SITE_CHECK_NOT_FOUND', 'There is no re-check to stop.');
                        value.recheck = { ...value.recheck!, state: 'stopped', nextAt: null, claimId: null };
                    }
                    else
                        need(false, 'INVALID_VENTURE_REQUEST', 'This website report action is not available.');
                }
                current().set(value.id, structuredClone(value));
                host.emit({ type: 'desk.changed', businessId: host.current(), id: value.id } as never);
                return { playbook: 'seo-visibility', kind: 'website', id: value.id, result: structuredClone(value), line: body.action === 'schedule' ? 'Re-check approved for every thirty days on this desktop with the installed checker. Each report still needs your approval.' : 'Website check saved.' };
            });
        },
    };
}
