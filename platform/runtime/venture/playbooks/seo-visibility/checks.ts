// Chausar SEO checks. GEOHub (AGPL, ideas only) and seo-agent (MIT); rebuilt independently.
import type { KitCheck } from '../kit/define.ts';
/** Promises of rankings or citations are refused; explicit disclaimers do not become promises. */
export function promisesRanking(words: string): boolean {
    for (const clause of words.split(/[.!?\n।;]|\bbut\b|\bhowever\b/iu)) {
        for (const match of clause.matchAll(/\b(?:guarantee(?:d)?|promise(?:d)?|assur(?:e|ed))\b/gi)) {
            const at = match.index!;
            const before = clause.slice(0, at), after = clause.slice(at + match[0].length);
            const denied = /(?:\b(?:do not|does not|did not|cannot|can't|never|not)\s+(?:\w+\s+){0,2}|\bno\s+(?:ranking|citation|traffic)(?:\s+or\s+(?:ranking|citation|traffic))?\s+is\s+)$/i.test(before) || /^\s+(?:is\s+)?(?:not|never)\b/i.test(after);
            if (!denied && /\b(?:rank\w*|citation\w*|traffic)\b/i.test(clause.slice(Math.max(0, at - 70), at + match[0].length + 70)))
                return true;
        }
        if (/(?:रैंक(?:िंग)?|पहला स्थान|ट्रैफिक|उद्धरण)/u.test(clause) && /(?:गारंटी|पक्का)/u.test(clause) && !/(?:गारंटी|पक्का)[^।]{0,15}नहीं|नहीं[^।]{0,15}(?:गारंटी|पक्का)/u.test(clause))
            return true;
    }
    return false;
}
/** Draft checks never treat a promised ranking as a deliverable. */
export const seoDraftChecks: KitCheck = input => {
    const words = input.deliverable.sections.flatMap(section => section.parts.flatMap(part => part.kind === 'text' ? [part.text] : [])).join(' ');
    return [{ playbook: 'seo-visibility', check: 'no-ranking-promise', outcome: promisesRanking(words) ? 'fail' : 'pass', detail: promisesRanking(words) ? 'The draft promises a ranking or citation.' : 'No ranking or citation is promised.' }];
};
/** The held-back baseline checks case-specific evidence boundaries as well as the promise ban. */
export function scoreSeoBaseline(id: string, draft: string): {
    pass: boolean;
    why: string;
} {
    const requirements: Record<string, RegExp[]> = {
        'clinic-visibility-check': [/source gaps?[^.!?]{0,35}unknown/i, /fix/i, /evidence/i],
        'blocked-training-bot-only': [/training/i, /separate/i, /search/i, /does not prove/i],
        'empty-without-js': [/empty without JavaScript/i, /HTML/i],
        'panel-not-enough-data': [/not enough data/i, /missing/i, /denominator/i],
        'promise-ranking-refused': [/refused/i, /no forecast/i],
    };
    const expected = requirements[id];
    const pass = Boolean(expected) && expected!.every(pattern => pattern.test(draft)) && !promisesRanking(draft);
    return { pass, why: pass ? 'The case evidence and limits are stated.' : 'The draft omits a case boundary or promises results.' };
}
