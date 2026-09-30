/**
 * Parent-provided source review constraints. These are neither adapters nor
 * qualification evidence. The semantic qualification lane owns licensed corpus,
 * golden/holdout cases and the eventual mapping-pack gate.
 */
export type SourceProfileNotice = {
  id: string; product: string; operationMeaning: string;
  disposition: 'semantic-review-required' | 'collection-and-reuse-held';
  invariants: readonly string[]; sourceReferences: readonly string[];
  provenance: 'parent-source-review';
};
const notices: SourceProfileNotice[] = [
  { id: 'razorpay-paid-is-not-net', product: 'Razorpay', operationMeaning: 'Orders, payments and refunds', disposition: 'semantic-review-required', invariants: [
    'An order paid status can persist after refunds and cannot define net revenue.',
    'Qualify settlement, fulfillment, refund and net-sales meanings as separate observations/events.',
  ], sourceReferences: ['https://razorpay.com/docs/api/orders/fetch-with-id/?preferred-country=IN'], provenance: 'parent-source-review' },
  { id: 'shopify-drafts-return-basis-and-cash', product: 'Shopify', operationMeaning: 'Orders, returns and refund transactions', disposition: 'semantic-review-required', invariants: [
    'Seeded draft orders do not establish delivered or settled business activity.',
    'totalPriceSet and currentTotalPriceSet have different return bases; select one reviewed measure and prevent double subtraction.',
    'A refund object alone does not prove cash movement; successful transaction status requires separate evidence.',
  ], sourceReferences: ['https://shopify.dev/docs/api/admin-graphql/latest/objects/order', 'https://shopify.dev/docs/api/admin-graphql/latest/objects/refund'], provenance: 'parent-source-review' },
  { id: 'ais-26as-claim-equivalence', product: 'AIS / Form 26AS', operationMeaning: 'Tax information claims', disposition: 'semantic-review-required', invariants: [
    'AIS reported, processed and accepted values have distinct meanings and cannot silently substitute for one another.',
    'AIS and Form 26AS may describe the same underlying item; their observations cannot be summed as independent transactions.',
  ], sourceReferences: [], provenance: 'parent-source-review' },
  { id: 'tally-versioned-wire-profile', product: 'TallyPrime', operationMeaning: 'Native JSON and XML/export acquisition', disposition: 'semantic-review-required', invariants: [
    'TallyPrime 7 native JSON and earlier XML/export routes require separate application-version and wire-schema profiles.',
    'Qualification of one export representation does not qualify another representation or application version.',
  ], sourceReferences: [], provenance: 'parent-source-review' },
  { id: 'zoho-coherent-installation-golden', product: 'Zoho Books', operationMeaning: 'Regional tax and invoice meanings', disposition: 'semantic-review-required', invariants: [
    'Generic API examples mixing GST, VAT and CFDI do not form a coherent golden company.',
    'Qualification binds one company, regional configuration, currency and reviewed net/tax interpretation.',
  ], sourceReferences: [], provenance: 'parent-source-review' },
  { id: 'phonepe-pulse-terms-unresolved', product: 'PhonePe Pulse', operationMeaning: 'Public corpus collection and reuse', disposition: 'collection-and-reuse-held', invariants: [
    'Conflicting GitHub CDLA and website noncommercial terms require clarification before collection or reuse.',
    'Public availability does not establish licensing permission, and a read capability cannot clear this hold.',
  ], sourceReferences: [], provenance: 'parent-source-review' },
];
export const SOURCE_PROFILE_NOTICES: readonly Readonly<SourceProfileNotice>[] = Object.freeze(notices.map(n => Object.freeze({ ...n, invariants: Object.freeze([...n.invariants]), sourceReferences: Object.freeze([...n.sourceReferences]) })));
