// Only non-money names produced by CA tools, or source ids already attached to this run.
import type { ToolCallRecord } from '../../contracts.ts';
export function caNamedTokens(calls: readonly ToolCallRecord[], files: readonly {
    name: string;
    id?: string;
    file?: string;
}[]): string[] {
    const names: string[] = [];
    for (const call of calls)
        if (call.tool === 'tax.formChooser' && call.envelope.ok) {
            const result = call.envelope.result as Record<string, unknown>;
            if (typeof result.form === 'string' && /^ITR-[1-4]$/.test(result.form))
                names.push(result.form.toLowerCase());
        }
    for (const call of calls)
        if (call.tool === 'tax.citations' && call.envelope.ok) {
            const result = call.envelope.result as Record<string, unknown>;
            if (Array.isArray(result.findings))
                for (const item of result.findings)
                    if (item && typeof item === 'object' && item.passed === true && typeof item.sourceId === 'string' && /^ita(?:1961|2025)-[a-z0-9-]+$/i.test(item.sourceId))
                        names.push(item.sourceId.toLowerCase());
        }
    for (const [index, file] of files.entries())
        if (/law|act|statute|notification/i.test(file.name)) {
            names.push((file.file ?? 'f' + (index + 1)).toLowerCase());
            if (file.id)
                names.push(file.id.toLowerCase());
        }
    return [...new Set(names)];
}
