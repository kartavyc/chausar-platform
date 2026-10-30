// Browser-safe CA plan fixture. Engine parity is checked by venture-ca-plan-parity.test.ts.
import rows from './fixtures-ca-plan.json';
import registry from './fixtures-playbook-picks.json';
import type { BlueprintViewLite, OfferIntakeLite, OfferLite } from './types';
export function fakeCaForIdea(idea: string): boolean {
    const text = idea.toLowerCase().replace(/\s+/g, ' ');
    let best = '', length = 0;
    for (const entry of registry)
        for (const phrase of entry.picks)
            if (phrase.length > length && text.includes(phrase)) {
                best = entry.id;
                length = phrase.length;
            }
    return best === 'ca-firm';
}
export function fakeCaPlan(base: BlueprintViewLite, preserve = false): BlueprintViewLite {
    const label = (value: string) => ({ value, label: 'assumption' as const, by: 'template' as const });
    const offers: OfferLite[] = preserve ? base.blueprint.offers.map(offer => ({ ...offer, playbookOffer: offer.playbookOffer ?? (offer.id === 'offer_books' ? 'monthly-books' : offer.id === 'offer_gst' ? 'gst-working' : undefined) })) : [];
    const intake: Record<string, OfferIntakeLite> = { ...base.intake };
    for (const row of rows) {
        let offer = offers.find(offer => offer.playbookOffer === row.id);
        if (!offer) {
            offer = { id: 'offer_' + row.id.replace(/-/g, '_'), playbookOffer: row.id, name: label(row.name), description: label(row.description), pricing: { model: row.pricing as 'monthly' | 'project', quantityUnit: row.pricing === 'monthly' ? 'month' : 'project', unitPriceMinor: null, unitPriceLabel: 'not-set', defaultQuantity: '1' } };
            offers.push(offer);
        }
        if (row.intake)
            intake[offer.id] = { rights: [], fields: [], kit: structuredClone(row.intake) as OfferIntakeLite['kit'] };
    }
    return { ...base, blueprint: { ...base.blueprint, serviceType: 'bookkeeping', offers }, playbook: { id: 'ca-firm', label: 'AI-native CA firm' }, offerReceipts: { ...(preserve ? base.offerReceipts : {}), ...Object.fromEntries(offers.filter(offer => !base.offerReceipts[offer.id]).map(offer => [offer.id, null])) }, intake };
}
