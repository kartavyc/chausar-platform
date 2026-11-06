// Original Chausar repurposing boundaries, from catalogue S2 (MIT ideas, no outside code).
import { check } from '../../../contracts.ts';
import { checkClaims } from '../../delivery/judge/claim-check.ts';
import { sourceInventory, type SourceInventory } from './inventory.ts';
/** Require enough distinct source material before spending on a week of drafts. */
export function repurposeSource(source: string): SourceInventory {
    const inventory = sourceInventory(source);
    check(inventory.counts.total >= 4, 'SOURCE_THIN', 'The source is too thin for a week of posts. Send a longer piece or a voice note.');
    return inventory;
}
/** Specific claims read only the supplied source; general faithfulness is also judged before Accept. */
export function repurposeClaims(text: string, source: string) {
    return checkClaims(text, [{ id: 'repurpose-source', text: source }]);
}
export {hookVariety} from './hook-variety.ts';
