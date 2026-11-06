import {wholeCount} from '../../playbooks/kit/count.ts';
// Original Chausar social content tools, catalogue S2/S5 (MIT and learn-only ideas; no outside code).
import { socialSourceText } from '../../playbooks/social/source-text.ts';
import { check, ChausarError } from '../../../contracts.ts';
import { digest, findRecord } from '../../records.ts';
import type { Json, WorkFigure } from '../../contracts.ts';
import { sourceInventory } from '../../playbooks/social/inventory.ts';
import { socialFormats } from '../../playbooks/social/formats.ts';
import { socialSlots, type SocialSlotKind } from '../../playbooks/social/slot-kinds.ts';
import { fileOf, receiptOut, type Spec, type ToolEnv, type ToolResult } from './tools.ts';
import type { SocialChannel } from '../../playbooks/social/channels.ts';
/** Only an actual run source can supply the inventory, never facts typed by the agent. */
function sourceOf(env: ToolEnv, value: unknown): {
    text: string;
    id: string;
    name: string;
    digest: string;
} {
    check(typeof value === 'string' && value.length <= 100000, 'SOCIAL_SOURCE_INVALID', 'Choose the source file or the exact client source.');
    const state = env.runRef.kind === 'delivery' ? env.deps.store.read() : null;
    const run = state && env.runRef.kind === 'delivery' ? findRecord(state, 'venture-delivery-run', env.runRef.runId) : null;
    const order = state && run?.ventureId === env.ventureId ? findRecord(state, 'venture-order', run.orderId) : null;
    if (state)
        check(order?.ventureId === env.ventureId, 'SOCIAL_SOURCE_INVALID', 'Choose the source for this delivery order.');
    if (/^f[1-9][0-9]*$/.test(value)) {
        const file = fileOf(env, value);
        if (state && order) {
            const live = findRecord(state, 'venture-upload', file.id);
            check(live?.ventureId === env.ventureId && (live.scope.kind === 'order' || live.scope.kind === 'media') && live.scope.orderId === order.id && (!order.intake?.fields?.sourceFile || file.id === order.intake.fields.sourceFile) && live.contentBase64 === file.contentBase64 && live.digest === file.digest && digest(live.contentBase64) === file.digest, 'SOCIAL_SOURCE_INVALID', 'The source binding or file bytes changed. Read the selected source again.');
        }
        const text = socialSourceText(file.format, Buffer.from(file.contentBase64, 'base64').toString('utf8'));
        return { text, id: file.id, name: file.name, digest: file.digest };
    }
    if (order?.ventureId === env.ventureId && !order.intake?.fields?.sourceFile && order.request === value)
        return { text: value, id: order.id, name: 'Client source', digest: digest(value) };
    throw new ChausarError('SOCIAL_SOURCE_INVALID', 'Choose the source file or the exact client source.');
}
function counted(env: ToolEnv, data: Record<string, unknown>, counts: Record<string, number>, sources: {
    id: string;
    name: string;
    digest: string;
}[]): ToolResult {
    const figures: WorkFigure[] = Object.entries(counts).map(([key, value]) => ({ key, label: key, minor: String(value), display: String(value), currency: env.currency, unit: 'count' }));
    const body = { operation: 'work.totals' as const, runRef: env.runRef, currency: env.currency, inputs: { tables: sources, columns: {}, rowIds: [] }, steps: figures.map(figure => ({ op: 'count' as const, inputs: sources.map(source => source.digest), result: figure.display, rule: 'Count distinct source inventory items or declared calendar slots.' })), figures, reconciliation: null, allowedNumbers: figures.map(figure => figure.display), explanation: 'Counts computed from the source attached to this run.' };
    const receipt = receiptOut(env, { ...body, digest: digest(body) });
    return { result: { ...data, receipt: receipt.alias, figures: receipt.figures } as Json, receipts: [receipt.record], proofs: [{ kind: 'totals', receiptId: receipt.record.id }] };
}
const line = (about: string, max = 200) => ({ type: 'text' as const, required: true, max, about });
/** Pure domain refusals retain their code through the harness boundary. */
async function domain(run: () => ToolResult): Promise<ToolResult> {
    try {
        return run();
    }
    catch (error) {
        if (error instanceof ChausarError)
            throw error;
        const failure = error as Error & {
            code?: string;
        };
        throw new ChausarError(failure.code ?? 'SOCIAL_INPUT_INVALID', failure.message);
    }
}
export const SOCIAL_CONTENT_TOOLS: Record<'social.inventory' | 'social.formats' | 'social.slots', Spec> = {
    'social.inventory': { name: 'social.inventory', effect: 'compute', tier: 'code', endsTurn: false, summary: 'Counts claims, numbers, stories, mistakes and quotes in the actual client source. Thin sources stop.', input: { source: line('The source file alias, or the exact client source from the order.', 100000) }, async run(env, input) {
            return domain(() => {
                const source = sourceOf(env, input.source), inventory = sourceInventory(source.text);
                check(inventory.counts.total >= 4, 'SOURCE_THIN', 'The source is too thin for a week of posts. Send a longer piece or a voice note.');
                return counted(env, inventory, inventory.counts, [source]);
            });
        } },
    'social.formats': { name: 'social.formats', effect: 'compute', tier: 'code', endsTurn: false, summary: 'Chooses channel formats from the files this run has, with the reason for each choice.', input: { channels: { type: 'list', required: true, max: 5, item: { type: 'enum', required: true, values: ['linkedin', 'instagram', 'facebook', 'x', 'threads', 'tiktok', 'youtube-shorts'], about: 'One target channel.' }, about: 'Three to five distinct target channels.' } }, async run(env, input) { return domain(() => ({ result: { formats: socialFormats({ channels: input.channels as SocialChannel[], footage: false, images: env.files.some(file => file.format === 'image') }) } })); } },
    'social.slots': { name: 'social.slots', effect: 'compute', tier: 'code', endsTurn: false, summary: 'Checks value and selling slots against the owner cap, with one goal and audience action per draft.', input: { slots: { type: 'list', required: true, max: 155, about: 'The proposed slots.', item: { type: 'object', required: true, about: 'One slot.', fields: { id: line('The code-made slot id.', 80), kind: { type: 'enum', required: true, values: ['value', 'sell'], about: 'Value or selling.' }, goals: { type: 'list', required: true, max: 10, item: line('One goal.'), about: 'The draft goals.' }, actions: { type: 'list', required: true, max: 10, item: line('One audience action.'), about: 'The audience actions.' } } } } }, async run(env, input) {
            return domain(() => {
                const cap = env.intake?.fields?.sellingCap;
                const result = socialSlots(input.slots as SocialSlotKind[], cap === undefined ? 20 : typeof cap === 'string' && /^\d{1,3}$/.test(cap) ? wholeCount(cap) : NaN);
                return counted(env, result, { selling: result.selling, total: result.total }, [{ id: 'slots', name: 'Proposed slots', digest: digest(input.slots) }]);
            });
        } },
};
