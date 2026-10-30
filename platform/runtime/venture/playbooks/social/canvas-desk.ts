// Original Chausar social canvas, derived from this business's real order, files and current draft.
import { check, type Context } from '../../../contracts.ts';
import type { Json, VentureDeps, OrderRecord, VentureRecord } from '../../contracts.ts';
import type { State } from '../../../contracts.ts';
import type { DeskHandlers, DeskGetPayload } from '../desk-types.ts';
import { digest, exactPayload, findRecord, listRecords } from '../../records.ts';
import { readAs, acceptedBlueprintOrNull } from '../../delivery/shared.ts';
import { clientDraft } from '../../build/draft-text.ts';
import { boundSocialSource } from './run-guard.ts';
import { socialCanvas, type SocialCanvasView } from './canvas.ts';
import type { SocialChannel } from './channels.ts';
export type SocialCanvasDeskTypes = {
    canvas: {
        filter: Json;
        row: SocialCanvasView;
        item: SocialCanvasView;
        actions: Record<string, never>;
    };
};
function view(state: State, venture: VentureRecord, order: OrderRecord): SocialCanvasView {
    const run = listRecords(state, 'venture-delivery-run', venture.id).filter(run => run.orderId === order.id && !run.practice && run.deliverable && run.status !== 'rejected').sort((a, b) => b.at.localeCompare(a.at)).at(0);
    let source: string | null = null, sourceProblem: string | null = null;
    if (order.intake?.fields?.sourceFile)
        try {
            source = boundSocialSource(state, venture, order);
        }
        catch (error) {
            sourceProblem = (error as Error).message;
        }
    const raw = order.intake?.fields?.channels;
    const supported = ['instagram', 'facebook', 'linkedin', 'x', 'threads', 'tiktok', 'youtube-shorts', 'bluesky', 'mastodon', 'telegram', 'discord'];
    const channels = Array.isArray(raw) ? raw.filter((value): value is SocialChannel => typeof value === 'string' && supported.includes(value)) : order.intake?.calendar?.channels ?? [];
    const images = listRecords(state, 'venture-upload', venture.id).some(file => file.format === 'image' && (file.scope.kind === 'order' || file.scope.kind === 'media') && file.scope.orderId === order.id);
    return socialCanvas({ orderId: order.id, request: order.request, runId: run?.id ?? null, text: run ? (clientDraft(run).text ?? '') : '', channels, source, sourceProblem, images });
}
function socialOrder(state: State, venture: VentureRecord, id: string): OrderRecord {
    const order = findRecord(state, 'venture-order', id);
    check(order && order.ventureId === venture.id, 'ORDER_NOT_FOUND', 'That order was not found.');
    const offer = acceptedBlueprintOrNull(state, venture)?.offers.find(offer => offer.id === order.offerId);
    check(offer?.playbookOffer && ['content-calendar', 'community-replies', 'monthly-report', 'ugc-ads', 'repurpose-pack', 'linkedin-ghostwriting'].includes(offer.playbookOffer), 'INVALID_VENTURE_REQUEST', 'Choose a social order.');
    return order;
}
async function get(deps: VentureDeps, ctx: Context, p: DeskGetPayload) {
    exactPayload(p, ['playbook', 'kind', 'id'], ['playbook', 'kind', 'id']);
    const { state, venture } = readAs(deps, ctx, 'read');
    const item = view(state, venture, socialOrder(state, venture, p.id));
    return { playbook: 'social-agency' as const, kind: 'canvas', item, digest: digest(item) };
}
export const SOCIAL_CANVAS_DESK: DeskHandlers = { canvas: { get, async list(deps, ctx, p) {
            exactPayload(p, ['playbook', 'kind', 'filter'], ['playbook', 'kind']);
            const filter = exactPayload(p.filter ?? {}, ['orderId']);
            check(filter.orderId === undefined || typeof filter.orderId === 'string' && filter.orderId.length > 0 && filter.orderId.length <= 120, 'INVALID_VENTURE_REQUEST', 'Choose an order by its ID.');
            const { state, venture } = readAs(deps, ctx, 'read');
            const rows = typeof filter.orderId === 'string' ? [view(state, venture, socialOrder(state, venture, filter.orderId))] : listRecords(state, 'venture-order', venture.id).filter(order => order.status !== 'cancelled').flatMap(order => { try {
                return [view(state, venture, socialOrder(state, venture, order.id))];
            }
            catch {
                return [];
            } });
            return { playbook: 'social-agency', kind: 'canvas', rows, line: 'Drafts and source inventory for your social orders.' };
        } } };
