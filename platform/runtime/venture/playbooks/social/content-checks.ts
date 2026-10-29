// Original Chausar social draft boundaries, run even when an agent skips a tool.
import {INFLUENCER_PACKET_CHECK} from './influencer-completion.ts';
import type { FlagshipCheckInput } from '../draft-checks.ts';
import type { PlaybookCheckResult } from '../../contracts.ts';
import { deliverableWords, checkClaims } from '../../delivery/judge/claim-check.ts';
import { sourceInventory } from './inventory.ts';
import { socialSlotChecks } from './slots-live.ts';
import { socialSourceText } from './source-text.ts';
import { communityDecision, hasCommunityPromotion } from './community.ts';
import { repurposeCoverage } from './repurpose-coverage.ts';
export function socialContentChecks(input: FlagshipCheckInput): Omit<PlaybookCheckResult, 'playbook'>[] {
    const results: Omit<PlaybookCheckResult, 'playbook'>[] = [...socialSlotChecks(input)], words = [deliverableWords(input.deliverable), ...input.deliverable.sections.map(section => section.heading)].join("\n"), fields = input.intake?.fields ?? {};
    if(input.offerKey==='influencer-campaign')results.push({...INFLUENCER_PACKET_CHECK});
    if (input.offerKey === 'repurpose-pack') {
        const text = input.deliverable.sections.map(section => '## ' + section.heading + '\n' + section.parts.filter(part => part.kind === 'text').map(part => part.text).join('\n')).join('\n');
        results.push(repurposeCoverage(text, fields.channels));
        try {
            const file = input.files.find(file => file.id === fields.sourceFile);
            if (!file)
                throw new Error('The source file for this order is missing.');
            const source = socialSourceText(file.format, Buffer.from(file.contentBase64, 'base64').toString('utf8'));
            const inventory = sourceInventory(source);
            if (inventory.counts.total < 4)
                throw new Error('The source is too thin for a week of posts. Send a longer piece or a voice note.');
            // A Post plan ordinal binds metadata to a post. Only that structural prefix is exempt;
            // every goal, action, hook and other displayed surface still supplies its factual claims.
            const sourceWords = [deliverableWords({ ...input.deliverable, sections: input.deliverable.sections.map(section => section.heading.trim().toLowerCase() === 'post plan' ? { ...section, parts: section.parts.map(part => part.kind === 'text' ? { ...part, text: part.text.replace(/^([ \t]*Post[ \t]+)[1-9][0-9]{0,2}(?=[ \t]*\|)/gim, '$1').replace(/\|[ \t]*(Value|Sell)[ \t]*\|[ \t]*Goal:/gi, match => match.toLowerCase()).replace(/\|[ \t]*(Reader action|Hook):/gi, match => match.toLowerCase()) } : part) } : section) }), ...input.deliverable.sections.map(section => section.heading)].join('\n');
            const claims = checkClaims(sourceWords, [{ id: file.id, text: source }], { known: input.known, dateOrder: input.dateOrder === 'month-day-year' ? 'month-day-year' : 'day-month-year' });
            results.push({ check: 'source-faithful', outcome: claims.passed ? 'pass' : 'fail', detail: claims.passed ? 'Specific claims match only the bound source. The judge still checks facts said in other words.' : claims.detail });
        }
        catch (error) {
            results.push({ check: 'source-faithful', outcome: 'fail', detail: (error as Error).message });
        }
    }
    if (input.offerKey === 'community-replies') {
        try {
            const decision = communityDecision({ rules: typeof fields.communityRules === 'string' ? fields.communityRules : '', promotion: fields.communityPromotion === true || hasCommunityPromotion(words), links: fields.communityLinks === true || /https?:\/\/|www\./iu.test(words), flair: typeof fields.communityFlair === 'string' ? fields.communityFlair : '' });
            results.push({ check: 'community-rules', outcome: decision.go ? 'pass' : 'fail', detail: decision.go ? 'The draft follows the pasted rule phrases.' : decision.reasons.map(reason => `Rule line ${reason.line}: "${reason.rule}"`).join(' ') });
        }
        catch (error) {
            results.push({ check: 'community-rules', outcome: 'fail', detail: (error as Error).message });
        }
    }
    return results;
}
