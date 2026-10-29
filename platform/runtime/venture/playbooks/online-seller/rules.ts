// Chausar dated seller rules. Official source documents checked 27 October 2026; no external code copied.
import type { DatedRule } from '../kit/define.ts';
import {STOREFRONT_PERMISSION_RULE} from './storefront-permission.ts';
export const SELLER_RULES: readonly DatedRule[] = [
  STOREFRONT_PERMISSION_RULE,
  ...[
    {id:'seller-change-caps',topic:'Owner change limits',rule:'Recheck source provenance and owner caps before preparing the exact handoff.',usedBy:['financial-draft']},
    {id:'seller-stock-movements',topic:'Stock and payout records',rule:'Write stock movements under one authority and keep refunds separate from earnings.',usedBy:['financial-draft']},
    {id:'seller-research-review',topic:'Product research boundaries',rule:'Show deterministic evidence and every risk before any model view or buying decision.',usedBy:['research-draft']},
    {id:'seller-photo-reference',topic:'Real product references',rule:'Keep the real main product photo in every image brief and require an exact quote approval.',usedBy:['photo-draft']},
  ].map(rule=>({...rule,scope:'seller',sources:[],checkedOn:'2026-10-28',read:'house' as const,how:'Chausar house rule.',limitations:'Every outside change needs your approval.',needs:null})),
  { id: 'seller-tcs', scope: 'india', topic: 'Marketplace tax collection', rule: 'Tax collection is a credit to reconcile, not an extra expense.', value: '50', unit: 'basis-points', sources: [{ title: 'CBIC notifications explained by PIB', url: 'https://www.pib.gov.in/PressReleasePage.aspx?PRID=2087659' }], checkedOn: '2026-10-27', read: 'official', how: 'Read the official summary of the notification.', usedBy: ['economics', 'financial-draft'], limitations: 'Your CA confirms applicability and the tax base before client work.', needs: 'ca', confirmedBy: null },
  { id: 'seller-tds', scope: 'india', topic: 'Marketplace income tax deduction', rule: 'Income tax deducted is a credit to reconcile with the seller statement.', value: '10', unit: 'basis-points', sources: [{ title: 'Income Tax Department, e-commerce deduction', url: 'https://www.incometaxindia.gov.in/w/section-194-o-5' }], checkedOn: '2026-10-27', read: 'official', how: 'Read the official section and its amendment note.', usedBy: ['economics', 'financial-draft'], limitations: 'Your CA confirms the current Act mapping, applicability and statement base.', needs: 'ca', confirmedBy: null },
  { id: 'seller-india', scope: 'india', topic: 'Packaged goods and seller declarations', rule: 'Check the package MRP, country of origin and seller details before delivery.', sources: [{ title: 'Consumer Affairs legal metrology notices', url: 'https://consumeraffairs.gov.in/pages/latest-news' }, { title: 'Official declaration summary', url: 'https://www.pib.gov.in/Pressreleaseshare.aspx?PRID=1843147' }], checkedOn: '2026-10-27', read: 'official', how: 'Read the ministry notices and the official declaration summary.', usedBy: ['india-listing', 'listing-draft'], limitations: 'Recent amendments and category exemptions need a lawyer to confirm them.', needs: 'lawyer', confirmedBy: null },
  { id: 'seller-listing-rubric', scope: 'listing', topic: 'Listing health rubric', rule: 'Use our own rubric and state missing data before any score.', sources: [{ title: 'Amazon India public title announcement', url: 'https://sellercentral.amazon.in/seller-forums/discussions/t/ad1b21a8-548c-4a01-a809-bf8d4469f108' }, { title: 'Amazon India image guide', url: 'https://sell.amazon.in/ss/beginners-guide' }], checkedOn: '2026-10-27', read: 'official', how: 'Read public title and image guidance.', usedBy: ['listing'], limitations: 'Category-specific title rules can differ; other marketplace thresholds are house guidance.', needs: null },
  { id: 'seller-no-filing', scope: 'all', topic: 'Claims and reviews', rule: 'Never file a claim or buy or reward a review.', sources: [], checkedOn: '2026-10-27', read: 'house', how: 'Chausar house rule.', usedBy: ['estimate-not-receivable', 'no-incentivised-reviews'], limitations: 'The seller sends every claim.', needs: null },
];

/** The checked but unconfirmed tax sources; only trusted rule configuration can carry CA confirmation. */
export function sellerTaxSources() {
  const rate = (id: string) => { const r = SELLER_RULES.find(rule => rule.id === id)!; return { id, rateBps: r.value!, source: r.sources[0]!.url, checkedOn: r.checkedOn, confirmedBy: r.confirmedBy ?? null }; };
  return { tcsRule: rate('seller-tcs'), tdsRule: rate('seller-tds') };
}

/** Trusted dated declaration rule; caller files cannot supply legal confirmation. */
export function sellerIndiaRule() { const rule = SELLER_RULES.find(item => item.id === 'seller-india')!; return { checkedOn: rule.checkedOn, confirmedBy: rule.confirmedBy ?? null }; }
