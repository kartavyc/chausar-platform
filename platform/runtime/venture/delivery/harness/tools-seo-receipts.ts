// SEO computed-count receipt adapter. Original Chausar code, following the existing work receipt interface.
import type { ToolEnv, ToolResult } from './tools.ts';
import type { WorkFigure } from '../../contracts.ts';
import { digest } from '../../records.ts';
import { receiptOut } from './tools.ts';
/** Keeps count figures and their evidence hashes in a real work receipt before the agent can quote them. */
export function seoCountReceipt(env: ToolEnv, data: unknown, counts: Readonly<Record<string, number>>, sources: {
    id: string;
    name: string;
    digest: string;
}[]): ToolResult {
    const figures: WorkFigure[] = Object.entries(counts).map(([key, value]) => ({ key, label: key.charAt(0).toUpperCase() + key.slice(1), minor: String(value), display: String(value), currency: env.currency, unit: 'count' }));
    const body = { operation: 'work.totals' as const, runRef: env.runRef, currency: env.currency, inputs: { tables: sources, columns: {}, rowIds: [] }, steps: figures.map(figure => ({ op: 'count' as const, inputs: sources.map(source => source.digest), result: figure.display, rule: 'Count the checked evidence slots; missing evidence remains unknown.' })), figures, reconciliation: null, allowedNumbers: figures.map(figure => figure.display), explanation: 'Counts from the checked evidence. Missing checks remain in the planned denominator.' };
    const receipt = receiptOut(env, { ...body, digest: digest(body) });
    return { result: { data, receipt: receipt.alias, figures: receipt.figures }, receipts: [receipt.record], proofs: [{ kind: 'totals', receiptId: receipt.record.id }] };
}
