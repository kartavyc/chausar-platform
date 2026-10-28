// Chausar fake bounded monitor configuration. beyondseo (MIT), original code; no background network or disk writes.
import { EngineError } from './types';
import type { FakeDeskKind } from './fake-playbooks';
import type { W4DeskHost } from './fake-w4';
import { fakeCheckedFetchUrl } from './fake-kit-connect';
import { localPathProblem } from '../../../../platform/runtime/local-paths';
import { checkedMonitorPlan, type SeoMonitorItem } from '../../../../platform/runtime/venture/playbooks/seo-visibility/monitor-core';
const need = (ok: unknown, code: string, words: string): void => { if (!ok)
    throw new EngineError(code, words); };
const exact = (raw: unknown, keys: string[], required = keys) => { need(raw && typeof raw === 'object' && !Array.isArray(raw), 'INVALID_VENTURE_REQUEST', 'Send one request object.'); const p = raw as Record<string, unknown>; need(Object.keys(p).every(key => keys.includes(key)) && required.every(key => Object.hasOwn(p, key)), 'INVALID_VENTURE_REQUEST', 'Send the required fields and nothing else.'); return p; };
// Windows absolute paths only, matching path.resolve after localPathProblem validation.
function monitorRoot(raw: string): string {
    const parts: string[] = [];
    for (const part of raw.slice(3).split(/[\\/]+/)) { if (part === '..') parts.pop(); else if (part && part !== '.') parts.push(part); }
    return raw.slice(0, 2) + '\\' + parts.join('\\');
}
/** A fake plan waits for its first tick; no fabricated evidence is shown. */
export function fakeSeoMonitorKind(host: W4DeskHost): FakeDeskKind {
    const all = new Map<string, Map<string, SeoMonitorItem>>();
    let sequence = 0;
    const current = () => { if (!all.has(host.current()))
        all.set(host.current(), new Map()); return all.get(host.current())!; };
    const item = (id: unknown) => { const found = current().get(String(id)); need(found, 'MONITOR_NOT_FOUND', 'That bounded monitor was not found.'); return structuredClone(found!); };
    const guarded = <T,>(run: () => T): T => { try {
        return run();
    }
    catch (error) {
        if (error instanceof Error && 'code' in error)
            throw new EngineError(String(error.code), error.message);
        throw error;
    } };
    return {
        list(p) { return guarded(() => { const body = exact(p, ['playbook', 'kind', 'filter'], ['playbook', 'kind']); need(body.filter === undefined || body.filter === null, 'INVALID_VENTURE_REQUEST', 'This monitor list has no filters.'); return { playbook: 'seo-visibility', kind: 'monitor', rows: [...current().values()].map(value => structuredClone(value)), line: 'Bounded site checks run only while this desktop business is open.' }; }); },
        get(p) { return guarded(() => { const body = exact(p, ['playbook', 'kind', 'id']); const value = item(body.id); return { playbook: 'seo-visibility', kind: 'monitor', item: value, digest: host.digest(value) }; }); },
        act(p) {
            return guarded(() => {
                const body = exact(p, ['playbook', 'kind', 'id', 'action', 'payload', 'digest'], ['playbook', 'kind', 'id', 'action', 'payload']);
                need(!host.hosted(), 'MONITOR_DESKTOP_ONLY', 'Bounded evidence collection runs in the desktop app.');
                let value: SeoMonitorItem;
                if (body.action === 'create') {
                    need(body.id === 'new' && body.digest === undefined, 'INVALID_VENTURE_REQUEST', 'A new monitor has no prior digest.');
                    const input = exact(body.payload, ['url', 'root', 'cycles', 'intervalSeconds']);
                    need(typeof input.url === 'string' && input.url.length <= 2000, 'MONITOR_INVALID', 'Give the client public site URL.');
                    const url = fakeCheckedFetchUrl(input.url).href;
                    need(typeof input.root === 'string' && !localPathProblem(input.root, 'win32'), 'MONITOR_INVALID', 'Choose a full local evidence folder path.');
                    const plan = checkedMonitorPlan({ cycles: input.cycles, intervalSeconds: input.intervalSeconds });
                    need(Date.parse(host.now()) + plan.intervalSeconds * 1000 <= 8640000000000000, 'MONITOR_INVALID', 'Choose an interval within the supported calendar.');
                    value = { id: 'seomonitor_' + (++sequence), url, root: monitorRoot(input.root as string), ...plan, state: 'draft', approvedDigest: null, completed: 0, lastAt: null, nextAt: null, error: null, evidence: [] };
                }
                else {
                    exact(body.payload, []);
                    value = item(body.id);
                    need(body.digest === host.digest(value), 'MONITOR_STALE', 'This monitor changed. Review it again.');
                    if (body.action === 'approve') {
                        need(value.state === 'draft', 'MONITOR_FROZEN', 'This monitor is already decided. Create a new plan for a change.');
                        value.approvedDigest = host.digest({ url: value.url, root: value.root, cycles: value.cycles, intervalSeconds: value.intervalSeconds });
                        value.state = 'active';
                        value.nextAt = host.now();
                    }
                    else if (body.action === 'stop') {
                        need(['draft', 'active', 'collecting'].includes(value.state), 'MONITOR_FROZEN', 'This monitor is already stopped or finished.');
                        value.state = 'stopped';
                        value.nextAt = null;
                    }
                    else
                        need(false, 'INVALID_VENTURE_REQUEST', 'Choose a monitor action shown in this desk.');
                }
                current().set(value.id, structuredClone(value));
                host.emit({ type: 'desk.changed', businessId: host.current(), id: value.id } as never);
                return { playbook: 'seo-visibility', kind: 'monitor', id: value.id, result: structuredClone(value), line: body.action === 'approve' ? 'Exact bounded monitor approved.' : 'Bounded monitor saved.' };
            });
        }
    };
}
