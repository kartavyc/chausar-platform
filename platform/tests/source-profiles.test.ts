import test from 'node:test';
import assert from 'node:assert/strict';
import { PHONEPE_PULSE_HOLD, SOURCE_CATALOGUE_SCOPE, SOURCE_PROFILES } from '../runtime/source-profiles.ts';

function profile(id: string) {
  const found = SOURCE_PROFILES.find(p => p.id === id);
  assert.ok(found, `Missing reviewed mapping profile: ${id}`);
  return found;
}
function invariant(profileId: string, invariantId: string) {
  const found = profile(profileId).invariants.find(i => i.id === invariantId);
  assert.ok(found, `Missing source meaning: ${profileId}/${invariantId}`);
  return found;
}

test('source profiles retain evidence boundaries and make no extractor or live-account qualification claim', () => {
  const ids = SOURCE_PROFILES.map(p => p.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const source of SOURCE_PROFILES) {
    assert.equal(source.qualification, 'metadata-only');
    assert.equal(source.executableExtractor, false);
    assert.equal(source.liveVerified, false);
    assert.ok(source.evidence.length > 0);
    const invariants = source.invariants.map(i => i.id);
    assert.equal(new Set(invariants).size, invariants.length);
    for (const rule of source.invariants) {
      assert.ok(rule.requirement.length > 20);
      assert.ok(rule.forbiddenMappings.length > 0);
      assert.ok(rule.requiredEvidence.length > 0);
    }
    for (const evidence of source.evidence) {
      if (evidence.provenance === 'lane-reviewed-primary-source') {
        assert.equal(new URL(evidence.url).protocol, 'https:');
        assert.equal(evidence.independentlyReviewedInThisLane, true);
        assert.equal(evidence.reviewedBy, 'root-implementation-lane');
      } else assert.equal(evidence.primaryVerification, 'pending');
    }
  }
});

test('Razorpay paid order state cannot establish net revenue or absence of refunds', () => {
  const rule = invariant('razorpay-orders', 'paid-order-survives-refund');
  assert.ok(rule.forbiddenMappings.includes('paid-order-status-to-net-revenue'));
  assert.ok(rule.forbiddenMappings.includes('paid-order-status-to-no-refunds'));
  assert.ok(rule.requiredEvidence.includes('captured-payment-records'));
  assert.ok(rule.requiredEvidence.includes('successful-refund-records'));
  assert.deepEqual(profile('razorpay-orders').evidence.map(e => e.provenance === 'lane-reviewed-primary-source' ? e.url : null), [
    'https://razorpay.com/docs/api/orders/fetch-with-id/?preferred-country=IN',
  ]);
});

test('Shopify separates original/current order totals, nonbillable drafts, and successful refund movements', () => {
  const totals = invariant('shopify-order-refund', 'original-current-order-totals-distinct');
  assert.ok(totals.forbiddenMappings.includes('totalPriceSet-as-currentTotalPriceSet'));
  assert.ok(totals.forbiddenMappings.includes('currentTotalPriceSet-as-original-total'));
  assert.ok(totals.requiredEvidence.includes('shop-money-and-presentment-money-currency-identity'));
  const taxMode = invariant('shopify-order-refund', 'subtotal-tax-mode-reviewed');
  assert.ok(taxMode.forbiddenMappings.includes('tax-inclusive-subtotal-as-tax-exclusive-measure'));
  assert.ok(taxMode.forbiddenMappings.includes('missing-tax-mode-as-tax-exclusive'));
  assert.ok(taxMode.forbiddenMappings.includes('profile-metadata-as-automatic-tax-conversion'));
  assert.ok(taxMode.requiredEvidence.includes('explicit-taxesIncluded-mode'));
  assert.ok(taxMode.requiredEvidence.includes('reviewed-subtotal-and-tax-basis'));
  const drafts = invariant('shopify-order-refund', 'draft-order-nonbillable');
  assert.ok(drafts.forbiddenMappings.includes('DraftOrder-to-billable-invoice'));
  assert.ok(drafts.forbiddenMappings.includes('DraftOrder-to-earned-sale'));
  const refunds = invariant('shopify-order-refund', 'refund-object-needs-successful-transactions');
  for (const forbidden of ['Refund-object-to-successful-money-movement', 'pending-refund-transaction-to-completed-refund', 'failed-refund-transaction-to-completed-refund', 'embedded-refunds-to-ignored-source-fields']) assert.ok(refunds.forbiddenMappings.includes(forbidden));
  for (const required of ['successful-refund-transaction-status', 'refund-transaction-kind', 'stable-refund-transaction-identity']) assert.ok(refunds.requiredEvidence.includes(required));
  const evidence = profile('shopify-order-refund').evidence;
  assert.deepEqual(evidence.filter(e => e.provenance === 'lane-reviewed-primary-source').map(e => e.url), [
    'https://shopify.dev/docs/api/admin-graphql/latest/objects/order',
    'https://shopify.dev/docs/api/admin-graphql/latest/objects/refund',
  ]);
  assert.ok(evidence.some(e => e.provenance === 'user-supplied-requirement' && e.primaryVerification === 'pending'), 'DraftOrder source verification remains distinct.');
});

test('AIS value states remain distinct and AIS/26AS matching cannot double-count income', () => {
  const states = invariant('ais-26as', 'ais-value-states-distinct');
  for (const forbidden of ['reported-as-processed', 'processed-as-accepted', 'accepted-as-reported', 'missing-tax-value-to-zero']) assert.ok(states.forbiddenMappings.includes(forbidden));
  const reconciliation = invariant('ais-26as', 'ais-26as-reconcile-without-double-counting');
  assert.ok(reconciliation.forbiddenMappings.includes('AIS-plus-26AS-independent-income-sum'));
  assert.ok(reconciliation.forbiddenMappings.includes('matched-AIS-26AS-item-counted-twice'));
  assert.ok(reconciliation.requiredEvidence.includes('unmatched-and-disputed-item-records'));
});

test('Tally formats require explicit release profiles and Zoho examples cannot qualify a company', () => {
  const tally = invariant('tally-release-format', 'tally-format-bound-to-edition-release');
  assert.ok(tally.forbiddenMappings.includes('TallyPrime-7-native-JSON-as-earlier-XML-profile'));
  assert.ok(tally.requiredEvidence.includes('product-edition-and-release'));
  assert.ok(tally.requiredEvidence.includes('declared-export-format'));
  const zoho = invariant('zoho-example-coherence', 'example-is-not-golden-company');
  assert.ok(zoho.forbiddenMappings.includes('incoherent-vendor-example-as-golden-company'));
  assert.ok(zoho.requiredEvidence.includes('explicit-organization-and-country'));
  assert.ok(zoho.requiredEvidence.includes('regional-tax-field-coherence'));
  for (const id of ['ais-26as', 'tally-release-format', 'zoho-example-coherence', 'phonepe-pulse-terms']) assert.ok(profile(id).evidence.every(e => e.provenance === 'user-supplied-requirement' && e.primaryVerification === 'pending'));
});

test('PhonePe Pulse collection and reuse remain on hold for both licence and website terms', () => {
  assert.equal(PHONEPE_PULSE_HOLD.collectionAllowed, false);
  assert.equal(PHONEPE_PULSE_HOLD.reuseAllowed, false);
  assert.ok(PHONEPE_PULSE_HOLD.releaseRequires.includes('repository-licence-clarification'));
  assert.ok(PHONEPE_PULSE_HOLD.releaseRequires.includes('website-terms-clarification'));
  assert.ok(invariant('phonepe-pulse-terms', 'collection-reuse-hold').forbiddenMappings.includes('repository-licence-alone-as-website-reuse-permission'));
});

test('requested catalogue scope retains QuickBooks and all fifty original targets alongside six additions', () => {
  assert.equal(SOURCE_CATALOGUE_SCOPE.originalTargetCount, 50);
  assert.equal(SOURCE_CATALOGUE_SCOPE.requestedAdditionCount, 6);
  assert.equal(SOURCE_CATALOGUE_SCOPE.requestedTargetCount, 56);
  assert.equal(SOURCE_CATALOGUE_SCOPE.originalTargetCount + SOURCE_CATALOGUE_SCOPE.requestedAdditionCount, SOURCE_CATALOGUE_SCOPE.requestedTargetCount);
  assert.ok(SOURCE_CATALOGUE_SCOPE.requiredRetainedConnectorIds.includes('quickbooks'));
  assert.equal(SOURCE_CATALOGUE_SCOPE.qualification, 'requested-scope-only');
});
