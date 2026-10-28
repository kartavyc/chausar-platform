// Original Chausar fake canvas reads actual fake order files and uses the engine's pure display model.
import { EngineError, type BlueprintViewLite, type OrderLite, type DeliveryLite } from './types';
import type { W4DeskHost } from './fake-w4';
import type { FakeDeskKind } from './fake-playbooks';
import { redactSecrets } from '../../../../platform/runtime/venture/core/secrets';
import { socialCanvas } from '../../../../platform/runtime/venture/playbooks/social/canvas';
import { socialSourceText } from '../../../../platform/runtime/venture/playbooks/social/source-text';
import type { SocialChannel } from '../../../../platform/runtime/venture/playbooks/social/channel-ids';
const need = (ok: unknown, line: string, code = 'INVALID_VENTURE_REQUEST') => { if (!ok)
    throw new EngineError(code, line); };
function exact(value: unknown, keys: string[], required: string[] = []) { need(value !== null && typeof value === 'object' && !Array.isArray(value), 'Send one request object.'); const body = value as Record<string, unknown>; need(Object.keys(body).every(key => keys.includes(key)) && required.every(key => Object.hasOwn(body, key)), 'Send the required fields and nothing else.'); return body; }
export function fakeSocialCanvas(host: W4DeskHost): FakeDeskKind {
    const orders = () => host.ask('venture.order.list', {}) as OrderLite[];
    function own(id: unknown) { need(typeof id === 'string', 'Choose an order by its ID.'); const order = orders().find(order => order.id === id); need(order, 'That order was not found.', 'ORDER_NOT_FOUND'); const plan = host.ask('venture.blueprint.get', {}) as BlueprintViewLite; const offer = plan.blueprint.offers.find(offer => offer.id === order!.offerId); need(offer?.playbookOffer && ['content-calendar', 'community-replies', 'monthly-report', 'ugc-ads', 'repurpose-pack', 'linkedin-ghostwriting'].includes(offer.playbookOffer), 'Choose a social order.'); return order!; }
    function view(order: OrderLite) {
        const files = host.orderFiles?.(order.id) ?? [], run = (host.ask('venture.delivery.list', {}) as DeliveryLite[]).filter(run => run.orderId === order.id && !run.practice && run.deliverable && run.status !== 'rejected').sort((a, b) => b.at.localeCompare(a.at)).at(0);
        let source: string | null = null, sourceProblem: string | null = null;
        const id = order.intake?.fields?.sourceFile;
        if (id)
            try {
                const file = files.find(file => file.id === id);
                if (!file)
                    throw new Error('Add the source transcript to this order.');
                source = socialSourceText(file.format, new TextDecoder().decode(Uint8Array.from(atob(file.contentBase64), char => char.charCodeAt(0))));
            }
            catch (error) {
                sourceProblem = (error as Error).message;
            }
        const raw = order.intake?.fields?.channels, supported = ['instagram', 'facebook', 'linkedin', 'x', 'threads', 'tiktok', 'youtube-shorts'];
        const channels = Array.isArray(raw) ? raw.filter((value): value is SocialChannel => typeof value === 'string' && supported.includes(value)) : (order.intake?.calendar?.channels ?? []).filter((value): value is SocialChannel => supported.includes(value));
        return socialCanvas({ orderId: order.id, request: order.request, runId: run?.id ?? null, text: redactSecrets(((run?.status === 'accepted' || run?.status === 'edited') && run.editedText ? run.editedText : run?.renderedText) ?? ''), channels, source, sourceProblem, images: files.some(file => file.format === 'image') });
    }
    return { get(raw) { const p = exact(raw, ['playbook', 'kind', 'id'], ['playbook', 'kind', 'id']); const item = view(own(p.id)); return { playbook: 'social-agency', kind: 'canvas', item, digest: host.digest(item) }; }, list(raw) { const p = exact(raw, ['playbook', 'kind', 'filter'], ['playbook', 'kind']), filter = exact(p.filter ?? {}, ['orderId']); need(filter.orderId === undefined || typeof filter.orderId === 'string' && filter.orderId.length > 0 && filter.orderId.length <= 120, 'Choose an order by its ID.'); const rows = typeof filter.orderId === 'string' ? [view(own(filter.orderId))] : orders().filter(order => order.status !== 'cancelled').flatMap(order => { try {
            return [view(own(order.id))];
        }
        catch {
            return [];
        } }); return { playbook: 'social-agency', kind: 'canvas', rows, line: 'Drafts and source inventory for your social orders.' }; } };
}
