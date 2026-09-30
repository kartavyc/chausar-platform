# Source-profile mapping invariants

`platform/runtime/source-profiles.ts` records meanings, prohibited mappings, required evidence, and pending verification for future source mappings. It contains metadata only. It neither extracts vendor records nor qualifies a live account. `platform/tests/source-profiles.test.ts` checks that these declared boundaries remain present; its passing result is not evidence of executing vendor APIs or calculating vendor revenue.

| Profile | Mapping invariant | Evidence status |
|---|---|---|
| Razorpay Orders | An order can remain `paid` after a refunded payment. Paid order state cannot establish net revenue or absence of refunds. Require captured-payment and successful-refund evidence, explicit currency/net basis, and reconciliation. | Exact primary Orders page independently reviewed by the root implementation lane. |
| Shopify Order | Preserve `totalPriceSet` as original total before returns and `currentTotalPriceSet` as current total after returns. Preserve shop and presentment currency identities. Neither total establishes earned revenue without recognition evidence. `subtotalPriceSet` can include tax when `taxesIncluded=true`; require reviewed tax mode and tax basis before a tax-exclusive binding. This metadata performs no automatic conversion. | Exact primary GraphQL Order page independently reviewed by the root implementation lane. |
| Shopify Refund | A Refund object alone does not prove completed movement of money. Refund movements require successful refund transactions, explicit transaction amounts/currencies, and stable transaction identities. Embedded refunds cannot be silently ignored. | Exact primary GraphQL Refund page independently reviewed by the root implementation lane. |
| Shopify DraftOrder | Keep DraftOrder separate and nonbillable; a draft cannot become a posted invoice or earned sale. | User-supplied requirement; DraftOrder primary-source verification pending. |
| AIS / Form 26AS | Preserve reported, processed, and accepted states separately. Match overlapping AIS/26AS items as reconciliation evidence, with unmatched/disputed records retained. Their totals are not independent income sums. | User-supplied requirement; primary-source verification pending. |
| Tally | Bind native JSON to an explicit TallyPrime 7 edition/release profile. Earlier XML profiles also need explicit edition/release qualification. Format availability does not qualify an installation. | User-supplied requirement; primary-source verification pending. |
| Zoho examples | Verify organization, country, regional tax fields, currency, and company controls together. An incoherent vendor example cannot be a golden company fixture. | User-supplied requirement; primary-source verification pending. |
| PhonePe Pulse | Collection and reuse remain on hold until both repository licence and website terms are clarified and the decision is recorded. | User-supplied hold; licence/terms verification pending. |

The supplied primary references are [Razorpay: Fetch an Order](https://razorpay.com/docs/api/orders/fetch-with-id/?preferred-country=IN), [Shopify: Order](https://shopify.dev/docs/api/admin-graphql/latest/objects/order), and [Shopify: Refund](https://shopify.dev/docs/api/admin-graphql/latest/objects/refund). The root implementation lane independently browsed all three exact primary pages and confirmed the lifecycle, total, refund, and tax-mode meanings recorded above. These mutable documentation URLs do not establish a qualified deployment version; the eventual adapter needs an explicit source/API version and installation evidence.

The requested catalogue preserves the original **50** targets, including **QuickBooks**, and adds **6** for a total of **56**. `SOURCE_CATALOGUE_SCOPE` records that requested scope separately from installed connector capabilities. The parent owns the named registry additions. Metadata presence gives no adapter an implemented or live-verified status.

Run the focused metadata contract checks with:

```powershell
node --test platform/tests/source-profiles.test.ts
```

Remaining work includes implementing and qualifying source-specific extractors/mappings, attaching versioned primary evidence for the pending rules, reconciling genuine installation fixtures against independent source controls, and clarifying PhonePe Pulse permissions before collection or reuse. No collection, live API request, external write, or source-term decision was performed for these metadata artifacts.

The existing local Shopify order-export parser has separate executable regression checks in `platform/tests/shopify-money-states.test.ts`. It preserves explicit DraftOrder identities and cancellation states, rejects other explicit object types, and refuses recipes that promote original orders to received or earned events. Order exports require an explicit boolean-false source tax mode; missing, inclusive or ambiguous modes require a reviewed tax profile. Embedded refund records require a separate reviewed transaction profile. These refusals retain incomplete source meanings rather than silently calculating a net or tax-exclusive amount. The prior synthetic order fixture now explicitly declares its tax-exclusive source mode. These are synthetic local tests, not GraphQL extraction or live account qualification.
