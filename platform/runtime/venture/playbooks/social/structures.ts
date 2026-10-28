// Five LinkedIn structures are data, shared by drafting, checks and the canvas.
import type { FlagshipCheckInput } from '../draft-checks.ts';
import type { PlaybookCheckResult } from '../../contracts.ts';
import { ghostwritingTextChecks } from './ghostwriting-core.ts';
export { LINKEDIN_STRUCTURES, LINKEDIN_GUIDANCE, structureOf, ghostwritingSections } from './structures-data.ts';
export function ghostwritingChecks(input: FlagshipCheckInput): PlaybookCheckResult[] {
    if (input.offerKey !== 'linkedin-ghostwriting')
        return [];
    const text = input.deliverable.sections.map(section => '## ' + section.heading + '\n' + section.parts.filter(part => part.kind === 'text').map(part => part.text).join('\n')).join('\n');
    return ghostwritingTextChecks(text, input.intake?.fields?.postCount).map(result => ({ ...result, playbook: 'social-agency' }));
}
