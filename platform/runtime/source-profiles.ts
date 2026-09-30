/** Declarative source meanings for future reviewed mappings. This module performs no extraction. */
export type SourceEvidence =
  | { provenance: 'lane-reviewed-primary-source'; url: string; reviewScope: string; reviewedBy: 'root-implementation-lane'; independentlyReviewedInThisLane: true }
  | { provenance: 'user-supplied-requirement'; primaryVerification: 'pending'; note: string };
export type SourceInvariant = {
  id: string;
  requirement: string;
  forbiddenMappings: readonly string[];
  requiredEvidence: readonly string[];
};
export type SourceProfile = {
  id: string;
  source: string;
  surface: string;
  qualification: 'metadata-only';
  executableExtractor: false;
  liveVerified: false;
  evidence: readonly SourceEvidence[];
  invariants: readonly SourceInvariant[];
};

const primary = (url: string, reviewScope: string): SourceEvidence => ({
  provenance: 'lane-reviewed-primary-source', url, reviewScope, reviewedBy: 'root-implementation-lane', independentlyReviewedInThisLane: true,
});
const supplied = (note: string): SourceEvidence => ({ provenance: 'user-supplied-requirement', primaryVerification: 'pending', note });
function metadata(profile: Omit<SourceProfile, 'qualification' | 'executableExtractor' | 'liveVerified'>): SourceProfile {
  return { ...profile, qualification: 'metadata-only', executableExtractor: false, liveVerified: false };
}

export const SOURCE_PROFILES: readonly SourceProfile[] = Object.freeze([
  metadata({
    id: 'razorpay-orders', source: 'Razorpay', surface: 'Orders API',
    evidence: [primary('https://razorpay.com/docs/api/orders/fetch-with-id/?preferred-country=IN', 'Order status and refunded-payment behavior; independently reviewed by the root implementation lane.')],
    invariants: [
      {
        id: 'paid-order-survives-refund',
        requirement: 'An order can retain paid status after its payment is refunded. Order status is an order lifecycle signal.',
        forbiddenMappings: ['paid-order-status-to-net-revenue', 'paid-order-status-to-no-refunds'],
        requiredEvidence: ['captured-payment-records', 'successful-refund-records', 'explicit-currency-and-net-basis', 'independent-source-reconciliation'],
      },
    ],
  }),
  metadata({
    id: 'shopify-order-refund', source: 'Shopify', surface: 'Admin GraphQL Order and Refund; DraftOrder is a separate object',
    evidence: [
      primary('https://shopify.dev/docs/api/admin-graphql/latest/objects/order', 'Original/current order totals and tax-inclusive subtotal mode; independently reviewed by the root implementation lane.'),
      primary('https://shopify.dev/docs/api/admin-graphql/latest/objects/refund', 'Refund objects and associated financial transactions; independently reviewed by the root implementation lane.'),
      supplied('DraftOrder must be kept separate and nonbillable. No DraftOrder primary page was supplied or independently verified in this lane.'),
    ],
    invariants: [
      {
        id: 'original-current-order-totals-distinct',
        requirement: 'Order.totalPriceSet is the original total before returns; Order.currentTotalPriceSet is the current total after returns. Preserve both meanings and currency sets.',
        forbiddenMappings: ['totalPriceSet-as-currentTotalPriceSet', 'currentTotalPriceSet-as-original-total', 'order-total-to-earned-revenue-without-recognition'],
        requiredEvidence: ['explicit-order-field-identity', 'shop-money-and-presentment-money-currency-identity', 'independent-source-reconciliation'],
      },
      {
        id: 'subtotal-tax-mode-reviewed',
        requirement: 'Order.subtotalPriceSet can include tax when taxesIncluded is true. Preserve and review the source tax mode before binding subtotal to a tax-exclusive measure; this profile performs no automatic tax conversion.',
        forbiddenMappings: ['tax-inclusive-subtotal-as-tax-exclusive-measure', 'missing-tax-mode-as-tax-exclusive', 'profile-metadata-as-automatic-tax-conversion'],
        requiredEvidence: ['explicit-taxesIncluded-mode', 'reviewed-subtotal-and-tax-basis', 'reconciled-tax-exclusive-amount-before-tax-exclusive-binding'],
      },
      {
        id: 'draft-order-nonbillable',
        requirement: 'DraftOrder is nonbillable source state. A draft total cannot become a posted invoice or earned sale.',
        forbiddenMappings: ['DraftOrder-to-billable-invoice', 'DraftOrder-to-earned-sale'],
        requiredEvidence: ['explicit-source-object-type', 'posted-Order-evidence-before-billing'],
      },
      {
        id: 'refund-object-needs-successful-transactions',
        requirement: 'A Refund object alone does not establish a completed movement of money. Count refund movements only from successful refund transactions with explicit amounts and currencies.',
        forbiddenMappings: ['Refund-object-to-successful-money-movement', 'pending-refund-transaction-to-completed-refund', 'failed-refund-transaction-to-completed-refund', 'embedded-refunds-to-ignored-source-fields'],
        requiredEvidence: ['successful-refund-transaction-status', 'refund-transaction-kind', 'explicit-transaction-amount-and-currency', 'stable-refund-transaction-identity', 'independent-source-reconciliation'],
      },
    ],
  }),
  metadata({
    id: 'ais-26as', source: 'AIS and Form 26AS', surface: 'Reviewed tax information and reconciliation',
    evidence: [supplied('The user requires distinct AIS reported, processed, and accepted meanings, and reconciliation with Form 26AS. Primary references remain pending.')],
    invariants: [
      {
        id: 'ais-value-states-distinct',
        requirement: 'AIS reported, processed, and accepted values are different states. Preserve the selected state and its provenance.',
        forbiddenMappings: ['reported-as-processed', 'processed-as-accepted', 'accepted-as-reported', 'missing-tax-value-to-zero'],
        requiredEvidence: ['explicit-AIS-value-state', 'tax-year-and-taxpayer-scope', 'feedback-and-processing-lineage'],
      },
      {
        id: 'ais-26as-reconcile-without-double-counting',
        requirement: 'AIS and Form 26AS are reconciliation evidence for potentially overlapping items. Do not add their totals as independent income sources.',
        forbiddenMappings: ['AIS-plus-26AS-independent-income-sum', 'matched-AIS-26AS-item-counted-twice'],
        requiredEvidence: ['matched-item-identity-and-period', 'amount-and-tax-category-comparison', 'unmatched-and-disputed-item-records'],
      },
    ],
  }),
  metadata({
    id: 'tally-release-format', source: 'Tally', surface: 'Explicit product edition, release, and export format',
    evidence: [supplied('The user requires a TallyPrime 7 native JSON profile and XML profiles for earlier releases. This does not qualify either format or a live installation.')],
    invariants: [
      {
        id: 'tally-format-bound-to-edition-release',
        requirement: 'Select native JSON through an explicit TallyPrime 7 edition/release profile. Earlier XML integrations need their own edition/release profiles; one profile cannot qualify all Tally installations.',
        forbiddenMappings: ['TallyPrime-7-native-JSON-as-earlier-XML-profile', 'unversioned-Tally-profile-as-universal-format', 'format-availability-as-live-installation-qualification'],
        requiredEvidence: ['product-edition-and-release', 'declared-export-format', 'reviewed-company-ledger-mapping', 'installation-specific-qualification'],
      },
    ],
  }),
  metadata({
    id: 'zoho-example-coherence', source: 'Zoho Books', surface: 'Organization, country, and tax semantics of example data',
    evidence: [supplied('The user identifies country/organization/tax incoherence in Zoho example data. The example is not a qualified company fixture; primary sample verification remains pending.')],
    invariants: [
      {
        id: 'example-is-not-golden-company',
        requirement: 'Validate organization country, regional tax fields, currency, and company scope together. Incoherent vendor example data cannot serve as a golden company or real-installation qualification.',
        forbiddenMappings: ['incoherent-vendor-example-as-golden-company', 'sample-organization-as-qualified-live-company', 'tax-fields-without-country-and-organization-coherence'],
        requiredEvidence: ['explicit-organization-and-country', 'regional-tax-field-coherence', 'explicit-currency', 'independent-company-control-totals'],
      },
    ],
  }),
  metadata({
    id: 'phonepe-pulse-terms', source: 'PhonePe Pulse', surface: 'Collection and reuse permission assessment',
    evidence: [supplied('The user places collection and reuse on hold until repository licence and website terms are clarified. No terms were independently verified in this lane.')],
    invariants: [
      {
        id: 'collection-reuse-hold',
        requirement: 'Keep PhonePe Pulse collection and reuse on hold until both the applicable licence and website terms are clarified.',
        forbiddenMappings: ['public-availability-as-collection-permission', 'repository-licence-alone-as-website-reuse-permission', 'unclear-terms-as-approved-reuse'],
        requiredEvidence: ['repository-licence-clarification', 'website-terms-clarification', 'recorded-collection-and-reuse-decision'],
      },
    ],
  }),
]);

/** Requested catalogue scope, separate from installed or qualified connector capabilities. */
export const SOURCE_CATALOGUE_SCOPE = Object.freeze({
  originalTargetCount: 50,
  requestedAdditionCount: 6,
  requestedTargetCount: 56,
  requiredRetainedConnectorIds: Object.freeze(['quickbooks']),
  qualification: 'requested-scope-only' as const,
  evidence: supplied('The user retains the original fifty targets, including QuickBooks, and requests six additions. Parent registry work owns the named additions.'),
});

export const PHONEPE_PULSE_HOLD = Object.freeze({
  collectionAllowed: false,
  reuseAllowed: false,
  status: 'awaiting-licence-and-website-terms-clarification' as const,
  releaseRequires: Object.freeze(['repository-licence-clarification', 'website-terms-clarification', 'recorded-collection-and-reuse-decision']),
});
