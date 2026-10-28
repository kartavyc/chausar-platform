// Original Chausar social intake fields. Generic kit fields share the existing order form.
import type { KitIntakeField } from '../kit/define.ts';
const field = (id: string, label: string, help: string, kind: KitIntakeField['kind'], required = false, options?: string[]): KitIntakeField => ({ id, label, help, kind, required, ...(options ? { options } : {}) });
const common = [field('sellingCap', 'Selling share cap', 'A whole percentage from 0 to 100. The default is 20.', 'text'), field('revisionDue', 'Revision due date', 'The day the monthly revisions are due.', 'date')];
export function socialIntakeFields(offer: string): KitIntakeField[] | undefined {
    if (offer === 'monthly-report')
        return [field('reportMonth', 'Report month', 'The month of the client exports, as YYYY-MM.', 'text', true)];
    const fields = [...common];
    if (offer === 'community-replies')
        fields.push(field('communityRules', 'Community rules', 'Paste the actual community rules before drafting.', 'text', true), field('communityPromotion', 'Promotes your business', 'Say whether the planned reply promotes your business.', 'yes-no', true), field('communityLinks', 'Includes links', 'Say whether the planned reply includes a link.', 'yes-no', true), field('communityFlair', 'Flair', 'The flair you will use when the community requires it.', 'text'));
    if (offer === 'repurpose-pack')
        fields.push(field('sourceFile', 'Source transcript', 'Upload the client source as SRT, VTT or a CSV with a text column.', 'file', true), field('channels', 'Channels', 'Choose three to five: linkedin, x, facebook, instagram, threads, tiktok or youtube-shorts.', 'list', true));
    if (offer === 'linkedin-ghostwriting')
        fields.push(field('postCount', 'Posts each month', 'Choose eight or twelve posts.', 'choice', true, ['8', '12']), field('extraRoundPrice', 'Extra revision round', 'Your price per post for a revision after the two included rounds.', 'money', true));
    return fields;
}
