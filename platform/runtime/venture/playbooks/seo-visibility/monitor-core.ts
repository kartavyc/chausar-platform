// Chausar bounded monitor state. beyondseo (MIT), original implementation and browser-safe validation.
export type SeoMonitorBody = {
    url: string;
    root: string;
    cycles: number;
    intervalSeconds: number;
    state: 'draft' | 'active' | 'collecting' | 'complete' | 'stopped' | 'held';
    approvedDigest: string | null;
    completed: number;
    lastAt: string | null;
    nextAt: string | null;
    error: string | null;
    evidence: {
        index: number;
        folder: string;
        receipt: string;
        at: string;
    }[];
};
export type SeoMonitorItem = SeoMonitorBody & {
    id: string;
};
/** A strict plan shared by the real and fake owner configuration routes. */
export function checkedMonitorPlan(raw: unknown): {
    cycles: number;
    intervalSeconds: number;
} {
    const fail = () => { throw Object.assign(new Error('Use bounded whole cycles at least a minute apart.'), { code: 'MONITOR_INVALID' }); };
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        return fail();
    const p = raw as Record<string, unknown>;
    if (Object.keys(p).some(key => !['cycles', 'intervalSeconds'].includes(key)) || !Number.isInteger(p.cycles) || (p.cycles as number) < 1 || (p.cycles as number) > 10000 || !Number.isInteger(p.intervalSeconds) || (p.intervalSeconds as number) < 60 || (p.intervalSeconds as number) > Math.floor(Number.MAX_SAFE_INTEGER / 1000))
        return fail();
    return { cycles: p.cycles as number, intervalSeconds: p.intervalSeconds as number };
}
