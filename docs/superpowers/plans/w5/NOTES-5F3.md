# 5F3 seller connectors and store assistant, 29 October 2026

The current implementation and review checkpoint below supersedes the historical checkpoints that follow. No Git mutations.

## Current author handoff and review

All F3 implementation paths are now present. Root independently issued Stage 1 SPEC PASS after the native Shopify, hosted Storefront, model budget and owner/fake integration reviews. Stage 2 QUALITY PASS is recorded in the final closure below. Earlier bounded reviews remain in results/w5-f3-root-native-review.txt (10/10) and results/w5-f3-root-widget-review.txt (17/17). No actual merchant account, production token, live write or legal approval was used.

The owner desk exposes Shopify connect/read, exact price/title/stock preview with receipt and approval, unknown-outcome handling, and separately configured Storefront catalogue/notice. Every buyer model call waits for exact owner approval of its current question, model and maximum code quote. A standing configuration cannot approve unknown future buyer prompts. This conservative interpretation of the founder rule belongs in the PR decisions. Storefront buyer use remains labelled planned pending named lawyer confirmation; the manual shop link remains available. Other marketplaces keep their documented planned or exact owner-template handoff status. No scraping or automated messaging was added.

The fake uses the same pure account/configuration validators and native error order. Browser rehearsal cannot access these native provider APIs and refuses honestly after validating exact fields, current order and pause state. It does not invent a remote connection or a buyer conversation. Owner UI native review snapshots are explicitly synthetic fixtures; public FakeEngine onboarding/setup is exercised separately.

Two new source-executed baseline cases preserve the eight existing seller cases, for ten total. They exercise actual Shopify stale-source refusal and Storefront unknown-product refusal. Missing and corrupted source inputs fail. They do not qualify a live provider. Integration caught the stale committed case count, which was corrected from eight to ten; results/w5-f3-baseline-integration-green.txt passes 3/3 after the genuine prior failure in w5-f3-engine-final.txt (56/57).

Final author UI checks: results/w5-f3-ui-final.txt passes 61/61 across owner setup, exact Shopify review, Storefront approval and expiry, fake parity, template channels, localized guides/cards, actual buyer-script expiry, all UI text and source rules. The restricted first retry could not open generated temporary files (w5-f3-owner-receipt-green.txt); the normal C-temp rerun passed. Both engine and UI typechecks exit 0: w5-f3-types-final.txt and w5-f3-ui-types-final2.txt.

Final privacy regressions: root's idle-screen late refresh genuinely failed (w5-f3-owner-late-expiry-red.txt); current render time and final click expiry checks close it. Self-audit found an opened receipt surviving session end/Forget (w5-f3-owner-receipt-red.txt). The UI now stores only its receipt ID and derives all receipt data from current nonexpired pending membership. Old question objects are not retained in local receipt state. Both regressions pass in the 61-test final run. The actual widget script also clears rendered answers and unsaved question input at the server expiry even after polling has stopped.

Final screenshots: results/w5-f3-shots/owner-{setup,review,assistant,guide}-{en-1280-light,en-390-dark,hi-390-dark}.png, twelve captures with no horizontal overflow, recorded in w5-f3-owner-shots-final.log. Inspected EN390 assistant and HI390 review after replacing oversized Field checkboxes with token-sized native checkboxes and full label hit areas. Buyer screenshots widget-{en,hi}-{answer,expired}-390.png exercise actual served HTML and JS with synthetic transport, not a live provider; expiry clears the answer and input. All owned servers and Chrome sessions stopped in finally. Temporary screenshot harnesses are removed after capture.

## Ownership manifest for isolation

Whole new build modules: marketplaces.ts, seller-connector-modes.ts, seller-guides.ts, shopify-admin-core.ts, shopify-admin.ts, storefront-assistant-core.ts, storefront-assistant-memory.ts, storefront-assistant-model.ts, storefront-assistant-session.ts, storefront-assistant.ts, storefront-widget-http.ts, storefront-widget-page.ts. Whole new online-seller modules: operations.ts, connector-baseline.ts, connector-metadata.ts, shopify-{desk,privacy,records,runtime,state,write}.ts, storefront-{desk,entry,permission,records}.ts. Whole new shared leaves: core/session-cleanup.ts and models/budget.ts.

Whole UI files: fake-seller-connectors.ts; SellerConnections.tsx, SellerShopify.tsx, SellerStorefront.tsx, SellerCheck.tsx and SellerCheck.module.css; connections/SellerGuide.ts and SellerCardWords.ts; EN/HI pb-seller-connectors.json, pb-seller-guides.json and pb-seller-cards.json. Whole tests: venture-marketplaces, venture-shopify-{admin,transport,state,desk}, venture-storefront-{assistant,transport,session,model,desk,privacy}, hosted-storefront, venture-seller-f3-{metadata,baseline}; UI seller-{connectors,shopify,storefront,template-channels,guides,card-words}, fake-seller-connectors, storefront-widget and helpers/seller-client.

Narrow shared engine edits: catalogue/online-seller provider rows; build/connectors mode arrays and planned buyer gate; build/guides HAND spread; online-seller desk kind registration, privacy call, definition connector/owner-step metadata, rule registration, Hindi map, baseline two cases/count and score delegation, catalogue-sheets channel allowlist; host trusted Storefront entry plus memory cleanup; playbooks/index lazy entry export; hosted/app token directory and entry; hosted/server fixed widget route; models/port monthly-cap accounting at its reservation checks; venture/contracts exact F3 error declarations; models existing tests for generic budget accounting. Preserve unrelated F2 operations, alert and source edits in the shared worktree.

Narrow shared UI edits: fake-online-seller kind merge; OnlineSellerDesk connection button/panel; SellerReports channel choices; connections Guide and card localization adapters; hi-review new UI key lists plus widget engine source. The separately added narration error declarations in venture/contracts and NOTES-5Q belong to Q, not F3.

Remaining integration work is root-owned: final quality verdict, isolated package staging, batch gates, measured words baseline and final wave walk/PR. No whole-wave completion claim.

## Historical checkpoints

## Authority and current official documentation

Read the wave plan F3, SL11/Later SL13, commerce.md research, BRIEF/REVIEW and current F2 source/notes. F2 staging, exact price parsing and current caps are reused. No vendor implementation was copied.

- Shopify owner organization apps now use the Dev Dashboard and client credentials, not the old create-token screen: https://shopify.dev/docs/apps/build/authentication-authorization/client-credentials-grant . The documented own-organization route has no outside review requirement; public/other-merchant distribution is not claimed.
- Pinned GraphQL2026-10: variant prices via productVariantsBulkUpdate (allowPartialUpdates:false), title via productUpdate, inventory movements via inventoryAdjustQuantities. Official mutation and InventoryChangeInput pages confirm changeFromQuantity CAS and required @idempotent keys since2026-04: https://shopify.dev/docs/api/admin-graphql/latest/mutations/inventoryAdjustQuantities , https://shopify.dev/docs/api/admin-graphql/latest/input-objects/InventoryChangeInput , https://shopify.dev/docs/api/usage/idempotent-requests . Do not use legacy compareQuantity or absolute stock overwrites.
- Pagination uses pageInfo/endCursor, bounded250 rows/page; no total until hasNextPage:false: https://shopify.dev/docs/api/usage/pagination-graphql . Stock reads name one exact location.
- Storefront public-token setup and Shopify checkout: https://shopify.dev/docs/storefronts/headless/building-with-the-storefront-api/getting-started , https://shopify.dev/docs/storefronts/headless/building-with-the-storefront-api/cart/manage . Widget implementation remains pending.
- Amazon developer registration and seller authorization remain required: https://developer-docs.amazon.com/sp-api/docs/sp-api-registration-overview . Amazon Ads official API page opened but returned no extractable body, so no new capability is inferred.
- Flipkart developer access requires its seller application, not a seller password: https://seller.flipkart.com/api-docs/FMSAPI.html . Shiprocket requires a separate API user/token: https://apidocs.shiprocket.in/ . Delhivery requires owner token/onboarding: https://help.delhivery.com/docs/api-token-generation . Those adapters remain planned.
- Meesho confirms manual catalogue CSV and category templates: https://supplier.meesho.com/how-it-works . AJIO confirms manual Excel/CSV: https://seller.ajio.com/ajiocommerce/faq/ . Myntra/Nykaa/JioMart current entry pages were opened but expose only loading/JS/auth screens. Their current account templates must come from the owner; no public API/schema is asserted.
- Meta catalogue help returned login/temporary-block text. No further fetch or bypass attempted. WhatsApp official business page describes owner business-app use. Sorftime page timed out; paid-key API contract remains explicitly unverified. These remain the plan's handoff/planned paths, never scraping routes.

## Concrete code and test-first evidence

- build/marketplaces.ts: fifteen honest provider rows, manual paths, waits and dated documentation checks. Shopify rows stay planned during this incomplete implementation. No liveVerified date is invented.
- online-seller/operations.ts: six allowlisted official methods, scopes, safety and null liveVerified. No generic mutation passthrough in the public plan.
- build/shopify-admin-core.ts: exact trusted Shopify host, bounded cursor pages, partial-read totals withheld, exact BigInt currency values, selected-location stock, F2 price/stock/title staging, current CAS/idempotency request construction.
- build/shopify-admin.ts: fixed owner-store token and2026-10 GraphQL URLs, bounded guarded network transport, no redirects/retries, final synchronous beforeDispatch after DNS; unsupported async guards consumed/refused cleanly. This is an internal adapter, not yet wired to owner effects.
- online-seller/shopify-state.ts: source/session/store/client/connection-bound dry preview, exact single-use claim, current cap/source recheck, expiry, unknown unless successful mutation plus exact read-back. Reopening any terminal or sending state cannot re-arm it.
- Tests were written before modules. Correct missing-module REDs then GREEN: marketplaces2, Shopify core5, transport3, state2. Logs results/w5-f3-{marketplaces,shopify-core,shopify-transport,shopify-state}-{red,green}.txt. No paid call, actual provider test or live store qualification occurred.

## Remaining implementation

Native durable owner desk, journal and exact pre-send/read-back boundaries, current order/permission/Forget, account-scoped verification dates, native/fake parity, catalogue/guide wiring, hosted session-only AI widget with public Storefront token, exact per-query owner approval/spend and no buyer persistence, UI/Hindi/screens, source baseline and full independent spec/quality review. No package completion claim.

Session-only AI direction sent to root for review: reuse existing native OpenAI/Anthropic body/parser and cost functions, keep buyer body entirely outside persisted ModelPort records, preserve spend metadata and exact owner-approved widget settings. Root clarified that configuration or a standing budget cannot approve future paid buyer prompts. Each remote model call requires a memory-only exact prompt/model/cost preview, owner approval, expiry and single-use claim; the buyer sees waiting/manual shop link meanwhile. Model output limited to known product IDs and an answer enum; code supplies source prices/receipt/cart links. Live consent requires named professional confirmation; manual shop link meanwhile.


## Native and hosted API checkpoint

Native Shopify bounded SPEC PASS / QUALITY PASS by root after independent10/10 in results/w5-f3-root-native-review.txt. Earlier core findings closed: real parameterized InventoryLevel IDs bind item and location; absent SKU stays absent until exact owner mapping; signed oversold stock is readable but a write waits for manual correction. Actual account qualification remains absent; all provider responses in this checkpoint are labelled test fixtures.

The native owner desk now supports connect, read, exact F2 preview and journalled price/title/movement changes. Successful writes require a valid mutation acknowledgement and exact read-back; uncertain outcomes never resend. Public tests cover current session/store/client/caps, post-DNS source revocation, malformed fields before authentication, explicit vendor refusal, and opaque-client Forget of receipts and keys. Definite refusal journal status had a genuine RED (outcome_unknown instead of rejected), fixed to the shared not-sent outcome. Additional validation RED/GREEN logs: w5-f3-journal-rejection and w5-f3-validation.

The Storefront API path is now integrated through the public hosted route and the owner desk. Storefront core only reads fixed public-products pages and validates every ID, currency and integer price; partial products or variants withhold totals. Model output is only a status and known available variant IDs. Code renders title, source price receipt and cart permalink with Not charged here. Cart format checked at https://shopify.dev/docs/apps/build/checkout/create-cart-permalinks and https://help.shopify.com/en/manual/checkout-settings/cart-permalink . No cart or order mutation exists.

The shop owner explicitly reads/configures a public catalogue snapshot. It expires for AI work after15minutes; refresh requires another owner-approved configuration read. Every buyer question separately waits for exact owner approval. Configuration does not approve future paid prompts. Buyer consent precedes a10minute bounded memory-only session. The native ephemeral API route reuses existing model request/parser/cost/spend code but never creates a saved model-call body. Prompt and response are never in durable state; spend retains random request identifiers, rate and cost only. Provider retention is disclosed separately. Native pause, stale source, key changes, expired or ended sessions and Forget all invalidate approval. Lock/actor shutdown invokes a small package-independent core/session-cleanup registry before clearing secrets.

The hosted widget uses a nonce CSP, exact shop frame ancestor, same-origin POSTs, no query-string buyer data, no browser storage and end-on-pagehide. Its initial notice identifies AI and every cart link identifies Shopify checkout with no charge here. Public actions only prepare requests; the owner desk makes the paid call. The current implementation is unavailable for live buyers until the new seller-storefront-permission register receives named lawyer confirmation. Tests explicitly inject a synthetic reviewer and restore the pending rule afterward. No actual legal confirmation is claimed.

Shared monthly-cap fix: models/budget.ts counts metadata-only model spend alongside existing model calls, skips paired ordinary spend rows, preserves pending reservations, and is used by the generic port at its two reservation checks and the ephemeral route. Public generic RED proved a full existing session spend was otherwise ignored. GREEN6/6 in w5-f3-model-budget-green.txt. Concurrent widget approval test proves atomic cap reservation and no double count. This is the only generic model behavior change.

Latest focused combined engine/hosted40/40: results/w5-f3-integrated-engine.txt. Test-first logs for storefront core, transport, session, model, desk, privacy, notifications and hosted route are results/w5-f3-storefront-*-{red,green}.txt and w5-f3-hosted-{red,green}.txt. Final whole F3 review remains pending. Owner React UI, fake parity, connector cards/guides/metadata, source baseline, final types and screenshots remain unfinished.

## Final independent package review closure

Root completed Stage 1 SPEC PASS and Stage 2 QUALITY PASS. Fresh independent owner/fake checks passed 11/11 in results/w5-f3-root-owner-final.txt. Root inspected EN390 assistant and HI390 exact Shopify review pixels and accepted the final layout/type evidence, late-expiry regression and receipt-on-Forget correction. All blocker and should-fix findings are closed. Live provider qualification remains absent and buyer use remains planned pending named lawyer confirmation. Integration gates and isolated commit remain root-owned.


## Isolated integration addendum

The candidate builder revealed that browser Connections omitted the new provider cards even though the owner desk paths existed. Actual FakeEngine RED (w5-f3-public-catalogue-red.txt) failed on missing shopify-admin. Native-generated fixtures-seller-connectors.json and a small withSellerCards merge now supply the exact native modes, guides and capabilities in both public/internal fake list paths. Native parity5/5 and public FakeEngine4/4 passed; root independently reviewed the delta SPEC PASS / QUALITY PASS. No account or provider result is invented.

Isolation on44b2021 initially omitted the existing Shopify journal operation allowlist, causing three ACTION_DENYLISTED failures. The builder now includes only the existing shopify-price/title/stock additions in journal/action-extras.ts. Revalidation remains required before commit.
