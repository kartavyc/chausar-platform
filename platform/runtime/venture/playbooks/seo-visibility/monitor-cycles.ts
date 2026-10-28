// Chausar bounded monitoring. beyondseo (MIT), independently implemented public contract.
import { mkdir, open, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { ChausarError } from '../../../contracts.ts';
import { checkedMonitorPlan } from './monitor-core.ts';
export type MonitorPlan = {
    cycles: number;
    intervalSeconds: number;
};
export type EvidencePort<T> = {
    claim(folder: string): Promise<boolean>;
    collect(folder: string): Promise<T>;
};
/** A finite bounded plan; scheduling it still requires the owner approval route. */
export function monitorPlan(raw: unknown): MonitorPlan {
    try { return checkedMonitorPlan(raw); } catch { throw new ChausarError('MONITOR_INVALID', 'Use bounded whole cycles at least a minute apart.'); }
}
/** The worker advances one cycle at a time, never sleeps or silently retries an already claimed folder. */
export async function runMonitorCycle<T>(raw: MonitorPlan, state: {
    index: number;
    nowMs: number;
    lastAtMs: number | null;
    root: string;
}, port: EvidencePort<T>) {
    const plan = monitorPlan(raw);
    if (!Number.isInteger(state.index) || state.index < 0 || state.index >= plan.cycles || !Number.isFinite(state.nowMs) || state.lastAtMs !== null && !Number.isFinite(state.lastAtMs))
        throw new ChausarError('MONITOR_INVALID', 'This cycle is outside the approved monitor plan.');
    if (state.lastAtMs !== null && state.nowMs - state.lastAtMs < plan.intervalSeconds * 1000)
        throw new ChausarError('MONITOR_TOO_SOON', 'Wait until the next approved collection time.');
    const folder = join(state.root, `cycle-${String(state.index + 1).padStart(5, '0')}`);
    if (!await port.claim(folder))
        throw new ChausarError('EVIDENCE_FOLDER_USED', 'This evidence folder is already used. Choose a fresh folder.');
    const result = await port.collect(folder);
    return { folder, result, nextAtMs: state.index + 1 < plan.cycles ? state.nowMs + plan.intervalSeconds * 1000 : null };
}
/** Exclusive marker claims a fresh folder; an interrupted cycle is preserved, never overwritten. */
export async function claimEvidenceFolder(folder: string): Promise<boolean> {
    try {
        await mkdir(folder, { recursive: true });
        if ((await readdir(folder)).length)
            return false;
        const file = await open(join(folder, '.chausar-evidence'), 'wx');
        await file.close();
        return true;
    }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST')
            return false;
        throw error;
    }
}
