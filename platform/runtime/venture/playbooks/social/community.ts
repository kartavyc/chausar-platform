// Original Chausar community preflight, catalogue S13 (marketing-skill, MIT ideas only).
export type CommunityDecision = {
    go: boolean;
    reasons: {
        rule: string;
        line: number;
        code: 'promotion' | 'links' | 'flair';
    }[];
};
/** Evaluate the owner's proposed action against exact pasted rule lines before requesting a draft. */
export function communityDecision(input: {
    rules: string;
    promotion: boolean;
    links: boolean;
    flair: string;
}): CommunityDecision {
    if (typeof input.rules !== 'string' || !input.rules.trim())
        throw Object.assign(new Error('Paste this community\'s rules before drafting.'), { code: 'COMMUNITY_RULES_REQUIRED' });
    if (input.rules.length > 20000 || typeof input.promotion !== 'boolean' || typeof input.links !== 'boolean' || typeof input.flair !== 'string' || input.flair.length > 100)
        throw Object.assign(new Error('Give the community rules and the planned promotion, links and flair.'), { code: 'SOCIAL_INPUT_INVALID' });
    const reasons: CommunityDecision['reasons'] = [];
    for (const [index, raw] of input.rules.split(/\r?\n/u).entries()) {
        const rule = raw.trim();
        if (input.promotion && /\b(?:no|avoid|ban(?:ned)?)\s+self[ -]promotion\b|self[ -]promotion\s+(?:is\s+)?(?:not allowed|prohibited)|खुद का प्रचार.*(?:नहीं|मना)/iu.test(rule))
            reasons.push({ rule, line: index + 1, code: 'promotion' });
        if (input.links && /\b(?:no|avoid)\s+(?:external\s+)?links\b|links\s+(?:are\s+)?(?:not allowed|prohibited)|लिंक.*(?:नहीं|मना)/iu.test(rule))
            reasons.push({ rule, line: index + 1, code: 'links' });
        if (!input.flair.trim() && /\bflair\s+(?:is\s+)?(?:required|needed|mandatory)|\b(?:use|add)\s+(?:a\s+)?flair|फ्लेयर.*(?:ज़रूरी|जरूरी|अनिवार्य)/iu.test(rule))
            reasons.push({ rule, line: index + 1, code: 'flair' });
    }
    return { go: reasons.length === 0, reasons };
}
/** A blocked decision never reaches a model call. */
export function requireCommunityGo(decision: CommunityDecision): void {
    if (!decision.go)
        throw Object.assign(new Error('This community\'s rules do not allow the planned post. Change it before drafting.'), { code: 'COMMUNITY_NO_GO' });
}
/** Deterministic promotional phrases supplement the owner's planned intent; the judge checks paraphrases. */
export function hasCommunityPromotion(text: string): boolean {
    return text.split(/(?<=[.!?।])\s+|\n/u).some(sentence => {
        const found = /\b(?:buy|shop|order|book|hire|subscribe|contact|visit|try)\s+(?:from\s+|at\s+|with\s+)?(?:our|my|us|me)\b|\b(?:our|my)\s+(?:shop|service|product|store|course).{0,35}\b(?:sale|discount|offer)\b|\buse\s+(?:my|our)\s+code\b|(?:हमारी|हमारा|हमारे).{0,25}(?:खरीदें|बुक करें|छूट|ऑर्डर)/iu.exec(sentence);
        if (!found)
            return false;
        return !/\b(?:do not|don't|never|not to)\s*$/iu.test(sentence.slice(0, found.index));
    });
}
