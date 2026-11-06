// Original Chausar professional-review gate. Legal sources remain in the dated social register.
export type SocialLegalRule = { id: string; country: 'IN' | 'US'; uses: 'paid' | 'synthetic'; needs: 'lawyer'; confirmedBy: { name: string; on: string } | null };
export const SOCIAL_LEGAL_RULES: readonly SocialLegalRule[] = Object.freeze([
    {id:'asci-virtual-influencer',country:'IN',uses:'synthetic',needs:'lawyer',confirmedBy:null},
    {id:'ccpa-endorsement-2023',country:'IN',uses:'paid',needs:'lawyer',confirmedBy:null},
    {id:'meta-branded-content-d2',country:'IN',uses:'paid',needs:'lawyer',confirmedBy:null},
    { id: 'ftc-endorsement-guides', country: 'US', uses: 'paid', needs: 'lawyer', confirmedBy: null },
    { id: 'ftc-reviews-rule', country: 'US', uses: 'synthetic', needs: 'lawyer', confirmedBy: null },
    { id: 'asci-influencer-label', country: 'IN', uses: 'paid', needs: 'lawyer', confirmedBy: null },
    { id: 'asci-ai-draft-2026', country: 'IN', uses: 'synthetic', needs: 'lawyer', confirmedBy: null },
    { id: 'india-it-rules-sgi-2026', country: 'IN', uses: 'synthetic', needs: 'lawyer', confirmedBy: null },
]);
/** The register and rehearsal use the same confirmation state, never an invented sign-off. */
export function socialLegalStatus(id: string): Pick<SocialLegalRule, 'needs' | 'confirmedBy'> {
    const rule = SOCIAL_LEGAL_RULES.find(row => row.id === id)!;
    return { needs: rule.needs, confirmedBy: rule.confirmedBy };
}
/** Unknown audience scope conservatively includes both supported jurisdictions. */
export function socialLegalBlock(input: { countries: readonly (string | null | undefined)[]; rehearsal: boolean; paid: boolean; synthetic: boolean }, rules = SOCIAL_LEGAL_RULES): string | null {
    if (input.rehearsal || !input.paid && !input.synthetic) return null;
    const unknown = input.countries.some(country => !country);
    const pending = rules.filter(rule => (unknown || input.countries.includes(rule.country)) && (rule.uses === 'paid' ? input.paid : input.synthetic) && !rule.confirmedBy);
    return pending.length ? 'A lawyer must confirm the applicable disclosure rules before paid or synthetic client work. Rehearsal is available; prepare the client work by hand meanwhile. Rules: ' + pending.map(rule => rule.id).join(', ') + '.' : null;
}
