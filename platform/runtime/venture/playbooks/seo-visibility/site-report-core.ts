// Browser-safe lintapple report contract. lintapple (MIT), independently validated public JSON shape.
import type { WebsiteCheckData } from './records.ts';
const reportError = (code: string, words: string) => Object.assign(new Error(words), { code });
export function parseWebsiteReport(url: string, raw: unknown, hash: (value: unknown) => string, previousReceipt: string | null = null): WebsiteCheckData {
    let parsed: URL;
    try {
        parsed = new URL(url);
    }
    catch {
        throw reportError('SITE_CHECK_INVALID', 'Choose the client site URL.');
    }
    if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password)
        throw reportError('SITE_CHECK_INVALID', 'Choose the client site URL.');
    url = parsed.href;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || JSON.stringify(raw).length > 1000000)
        throw reportError('SITE_CHECK_INVALID', 'Give a bounded lintapple JSON report.');
    const report = raw as Record<string, unknown>;
    if (report.url !== url || !Array.isArray(report.runs) || !Array.isArray(report.findings) || report.findings.length > 2000)
        throw reportError('SITE_CHECK_INVALID', 'The report must cover this exact site and its checked views.');
    const coverage = new Set(report.runs.map((run: any) => `${run?.viewport?.width}|${run?.colorScheme}`));
    if (!['390|light', '390|dark', '1280|light', '1280|dark'].every(key => coverage.has(key)))
        throw reportError('SITE_CHECK_INCOMPLETE', 'The report needs phone and desktop in light and dark.');
    const grouped = new Map<string, WebsiteCheckData['findings'][number]>();
    for (const rawFinding of report.findings) {
        if (!rawFinding || typeof rawFinding !== 'object' || Array.isArray(rawFinding))
            throw reportError('SITE_CHECK_INVALID', 'A finding is unreadable.');
        const f = rawFinding as Record<string, unknown>;
        if (!['rule', 'selector', 'message', 'actual', 'expected', 'fix'].every(key => typeof f[key] === 'string' && (f[key] as string).length <= 2000))
            throw reportError('SITE_CHECK_INVALID', 'Each finding needs what was measured, expected and how to fix it.');
        const key = JSON.stringify([f.rule, f.selector, f.expected, f.state ?? null, f.framePath ?? null, f.phase ?? null]);
        const before = grouped.get(key);
        if (before) {
            before.repeats++;
            before.unresolved ||= f.status === 'unresolved';
        }
        else
            grouped.set(key, { what: f.message as string, selector: f.selector as string, measured: f.actual as string, expected: f.expected as string, fix: f.fix as string, repeats: 1, unresolved: f.status === 'unresolved' });
    }
    return { url, receipt: hash(raw), findings: [...grouped.values()], approved: false, previousReceipt, checkedFrames: report.runs.length, limits: 'Omitted frames and unmeasured controls are not passes. Visual quality still needs your review.' };
}
