// Original Chausar social preflight. Owner inputs and actual order files gate every model preview.
import { check, ChausarError, type State } from '../../../contracts.ts';
import type { OrderRecord, VentureRecord } from '../../contracts.ts';
import { acceptedBlueprintOrNull } from '../../delivery/shared.ts';
import { communityDecision, requireCommunityGo } from './community.ts';
import { repurposeSource } from './repurpose.ts';
import { socialFormats } from './formats.ts';
import type { SocialChannel } from './channels.ts';
import { boundSocialSource } from './bound-source.ts';
import { digest,listRecords } from '../../records.ts';
import { findRecord } from '../../records.ts';
import { socialLegalBlock } from './legal-confirmation.ts';
export { boundSocialSource } from './bound-source.ts';
export function refuseSocialDraft(state: State, venture: VentureRecord, order: OrderRecord, today = new Date().toISOString().slice(0,10)): void {
    const key = acceptedBlueprintOrNull(state, venture)?.offers.find(offer => offer.id === order.offerId)?.playbookOffer;
    const fields = order.intake?.fields ?? {};
    try {
        if (order.socialChain) {
            const client = findRecord(state, 'venture-client', order.clientId);
            const legal = socialLegalBlock({ countries: [venture.country.code, client?.countryCode], rehearsal: venture.launchStage === 'shadow', paid: order.intake?.paidPromotion === true, synthetic: order.intake?.aiVoice === true || order.intake?.aiPresenter === true });
            check(!legal, 'RULE_UNCONFIRMED', legal ?? 'A lawyer must confirm the applicable disclosure rules.');
        }
        if (key === 'community-replies') {
            const decision = communityDecision({ rules: typeof fields.communityRules === 'string' ? fields.communityRules : '', promotion: fields.communityPromotion as boolean, links: fields.communityLinks as boolean, flair: typeof fields.communityFlair === 'string' ? fields.communityFlair : '' });
            requireCommunityGo(decision);
        }
        if (key === 'repurpose-pack') {
            repurposeSource(boundSocialSource(state, venture, order));
            socialFormats({ channels: fields.channels as SocialChannel[], footage: false, images: false });
        }
        if (fields.sellingCap !== undefined)
            check(typeof fields.sellingCap === 'string' && /^\d{1,3}$/.test(fields.sellingCap) && Number(fields.sellingCap) <= 100, 'SOCIAL_INPUT_INVALID', 'The selling cap is a whole percentage from 0 to 100.');
    }
    catch (error) {
        if (error instanceof ChausarError)
            throw error;
        const problem = error as Error & {
            code?: string;
        };
        throw new ChausarError(problem.code ?? 'SOCIAL_INPUT_INVALID', problem.message);
    }
}
