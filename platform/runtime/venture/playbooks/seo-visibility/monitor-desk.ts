// Chausar owner-approved bounded site monitoring. beyondseo (MIT), original code; no source copied.
import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { check, ChausarError, type Context } from '../../../contracts.ts';
import { localPathProblem } from '../../../speech.ts';
import type { VentureDeps, SeoFindingRecord } from '../../contracts.ts';
import { currentVenture, digest, exactPayload, listRecords, readVenture, requireAppChannel, ventureAction } from '../../records.ts';
import { checkFetchPolicy } from '../../build/fetch-policy.ts';
import { pinnedSend, systemResolver } from '../../core/net-guard.ts';
import type { DeskHandlers } from '../desk-types.ts';
import type { SeoMonitorItem } from './monitor-core.ts';
import { monitorPlan, runMonitorCycle, claimEvidenceFolder } from './monitor-cycles.ts';
import { diagnoseSite } from './diagnose.ts';
const itemOf = (record: SeoFindingRecord): SeoMonitorItem => ({ id: record.id, ...structuredClone(record.monitor!) });
const approvedPart = (item: SeoMonitorItem) => ({ url: item.url, root: item.root, cycles: item.cycles, intervalSeconds: item.intervalSeconds });
/** Local evidence is created only by a later tick after exact owner approval. */
export const SEO_MONITOR_DESK: DeskHandlers = { monitor: {
        async list(deps, ctx, payload) { const p = exactPayload(payload, ['playbook', 'kind', 'filter'], ['playbook', 'kind']); check(p.filter === undefined || p.filter === null, 'INVALID_VENTURE_REQUEST', 'This monitor list has no filters.'); const { state, venture } = readVenture(deps, ctx); return { playbook: 'seo-visibility', kind: 'monitor', rows: listRecords(state, 'venture-seo-finding', venture.id).filter(row => row.monitor).map(itemOf), line: 'Bounded site checks run only while this desktop business is open.' }; },
        async get(deps, ctx, payload) { exactPayload(payload, ['playbook', 'kind', 'id'], ['playbook', 'kind', 'id']); const { state, venture } = readVenture(deps, ctx); const record = listRecords(state, 'venture-seo-finding', venture.id).find(row => row.id === payload.id && row.monitor); check(record, 'MONITOR_NOT_FOUND', 'That bounded monitor was not found.'); const item = itemOf(record); return { playbook: 'seo-visibility', kind: 'monitor', item, digest: digest(item) }; },
        async act(deps, ctx, payload) {
            requireAppChannel(ctx, 'venture.desk.act');
            exactPayload(payload, ['playbook', 'kind', 'id', 'action', 'payload', 'digest'], ['playbook', 'kind', 'id', 'action', 'payload']);
            check(deps.host !== 'hosted-web', 'MONITOR_DESKTOP_ONLY', 'Bounded evidence collection runs in the desktop app.');
            return ventureAction(deps, ctx, 'approve', 'seo.monitor.' + payload.action, tx => {
                let record: SeoFindingRecord;
                if (payload.action === 'create') {
                    check(payload.id === 'new' && payload.digest === undefined, 'INVALID_VENTURE_REQUEST', 'A new monitor has no prior digest.');
                    const p = exactPayload(payload.payload, ['url', 'root', 'cycles', 'intervalSeconds'], ['url', 'root', 'cycles', 'intervalSeconds']);
                    check(typeof p.url === 'string' && p.url.length <= 2000, 'MONITOR_INVALID', 'Give the client public site URL.');
                    const url = checkFetchPolicy(p.url).href;
                    check(typeof p.root === 'string' && p.root.length <= 1000 && !localPathProblem(p.root), 'MONITOR_INVALID', 'Choose a full local evidence folder path.');
                    const plan = monitorPlan({ cycles: p.cycles, intervalSeconds: p.intervalSeconds });
                    check(Date.parse(tx.now) + plan.intervalSeconds * 1000 <= 8640000000000000, 'MONITOR_INVALID', 'Choose an interval within the supported calendar.');
                    record = tx.put<SeoFindingRecord>({ ...tx.base('venture-seo-finding'), sourceUrl: url, ruleId: 'bounded-monitor', evidenceDigest: '', state: 'open', monitor: { url, root: resolve(p.root), ...plan, state: 'draft', approvedDigest: null, completed: 0, lastAt: null, nextAt: null, error: null, evidence: [] } });
                }
                else {
                    exactPayload(payload.payload, []);
                    const found = tx.list('venture-seo-finding').find(row => row.id === payload.id && row.monitor);
                    check(found, 'MONITOR_NOT_FOUND', 'That bounded monitor was not found.');
                    record = found;
                    check(payload.digest === digest(itemOf(record)), 'MONITOR_STALE', 'This monitor changed. Review it again.');
                    if (payload.action === 'approve') {
                        check(record.monitor!.state === 'draft', 'MONITOR_FROZEN', 'This monitor is already decided. Create a new plan for a change.');
                        record = tx.replace({ ...record, monitor: { ...record.monitor!, state: 'active', approvedDigest: digest(approvedPart(itemOf(record))), nextAt: tx.now } });
                    }
                    else if (payload.action === 'stop') {
                        check(['draft', 'active', 'collecting'].includes(record.monitor!.state), 'MONITOR_FROZEN', 'This monitor is already stopped or finished.');
                        record = tx.replace({ ...record, monitor: { ...record.monitor!, state: 'stopped', nextAt: null } });
                    }
                    else
                        check(false, 'INVALID_VENTURE_REQUEST', 'Choose a monitor action shown in this desk.');
                }
                tx.emit('desk.changed', { playbook: 'seo-visibility', id: record.id });
                return { playbook: 'seo-visibility' as const, kind: 'monitor', id: record.id, result: itemOf(record), line: payload.action === 'approve' ? 'Exact bounded monitor approved.' : 'Bounded monitor saved.' };
            });
        }
    } };
const busy = new WeakSet<object>();
/** The scheduler awaits at most one bounded cycle; interrupted evidence is held, never silently retried. */
export async function runSeoMonitorsDue(deps: VentureDeps, ctx: Context): Promise<void> {
    if (deps.host === 'hosted-web' || busy.has(deps.store) || deps.closing?.signal.aborted)
        return;
    busy.add(deps.store);
    const release = deps.closing?.hold();
    try {
        const venture = currentVenture(deps.store.read());
        if (!venture)
            return;
        const now = deps.clock().toISOString();
        const rows = listRecords(deps.store.read(), 'venture-seo-finding', venture.id).filter(row => row.monitor);
        for (const row of rows.filter(row => row.monitor!.state === 'collecting'))
            await ventureAction(deps, ctx, 'prepare', 'seo.monitor.interrupted', tx => { const found = tx.find('venture-seo-finding', row.id); if (found?.monitor?.state === 'collecting')
                tx.replace({ ...found, monitor: { ...found.monitor, state: 'held', error: 'MONITOR_INTERRUPTED', nextAt: null } }); });
        const due = rows.filter(row => row.monitor!.state === 'active' && row.monitor!.nextAt && row.monitor!.nextAt <= now).sort((a, b) => a.monitor!.nextAt!.localeCompare(b.monitor!.nextAt!))[0];
        if (!due)
            return;
        const claimed = await ventureAction(deps, ctx, 'prepare', 'seo.monitor.claim', tx => {
            const found = tx.find('venture-seo-finding', due.id);
            if (!found?.monitor || found.monitor.state !== 'active')
                return null;
            check(found.monitor.approvedDigest === digest(approvedPart(itemOf(found))), 'MONITOR_STALE', 'The approved monitor configuration changed.');
            return tx.replace({ ...found, monitor: { ...found.monitor, state: 'collecting', lastAt: tx.now } });
        });
        if (!claimed?.monitor)
            return;
        const config = claimed.monitor;
        let evidence: SeoMonitorItem['evidence'][number] | null = null;
        let nextAt: string | null = null;
        let error: string | null = null;
        try {
            const deadline = Date.now() + 20000, send = deps.net?.send ?? pinnedSend;
            const stillApproved = () => { const current = listRecords(deps.store.read(), 'venture-seo-finding', venture.id).find(row => row.id === claimed.id); check(current?.monitor?.state === 'collecting' && !deps.closing?.signal.aborted, 'MONITOR_INTERRUPTED', 'Collection was stopped before the next action.'); };
            const bounded = async <T>(run: () => Promise<T>): Promise<T> => { stillApproved(); const remaining = deadline - Date.now(); check(remaining > 0, 'MONITOR_BUDGET', 'The collection time budget ended.'); let timer: ReturnType<typeof setTimeout> | undefined; try {
                return await Promise.race([run(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new ChausarError('MONITOR_BUDGET', 'The collection time budget ended.')), remaining); })]);
            }
            finally {
                clearTimeout(timer);
            } };
            const result = await runMonitorCycle({ cycles: config.cycles, intervalSeconds: config.intervalSeconds }, { index: config.completed, nowMs: Date.parse(now), lastAtMs: due.monitor!.lastAt ? Date.parse(due.monitor!.lastAt) : null, root: config.root }, { claim: claimEvidenceFolder, async collect(folder) {
                    const data = await diagnoseSite(config.url, { resolve: hostname => bounded(() => (deps.net?.resolve ?? systemResolver)(hostname)), send: target => bounded(() => send({ ...target, timeoutMs: Math.min(target.timeoutMs, deadline - Date.now()) })) });
                    stillApproved();
                    const receipt = digest(data);
                    await writeFile(join(folder, 'evidence.json'), JSON.stringify({ at: now, url: config.url, receipt, data }), { encoding: 'utf8', flag: 'wx' });
                    return receipt;
                } });
            evidence = { index: config.completed + 1, folder: result.folder, receipt: result.result, at: now };
            nextAt = result.nextAtMs === null ? null : new Date(result.nextAtMs).toISOString();
        }
        catch (cause) {
            error = cause instanceof ChausarError ? cause.code : 'MONITOR_COLLECTION_FAILED';
        }
        await ventureAction(deps, ctx, 'prepare', 'seo.monitor.finish', tx => {
            const found = tx.find('venture-seo-finding', claimed.id);
            if (!found?.monitor)
                return;
            const stopped = found.monitor.state === 'stopped';
            const completed = config.completed + (evidence ? 1 : 0);
            tx.replace({ ...found, evidenceDigest: evidence?.receipt ?? found.evidenceDigest, monitor: { ...found.monitor, completed, state: stopped ? 'stopped' : error ? 'held' : completed >= config.cycles ? 'complete' : 'active', error, nextAt: stopped || error ? null : nextAt, evidence: evidence ? [...found.monitor.evidence, evidence].slice(-20) : found.monitor.evidence } });
            tx.emit('desk.changed', { playbook: 'seo-visibility', id: found.id });
        });
    }
    finally {
        release?.();
        busy.delete(deps.store);
    }
}
