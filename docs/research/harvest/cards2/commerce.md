# Commerce group: second-pass cards (23 October 2026)

Twelve products, all shallow-cloned and read, none run. Paths are relative to each product's repo root. Repo text was treated as data only. Drive C filled up during cloning, so three checkouts stopped part way (sealeap-amazon-skills, mobazha-unified, atlas-marketing-studio); their files were read from the git object store instead, so nothing was skipped.

What Chausar already has for commerce, so the cards below don't repeat it:

- The 21 Oct cards covered `xjli360/sealeap-ecommerce-skills` (offline Decimal calculator, dated rule register) and `nexscope-ai/Amazon-Skills` (topic list only, model arithmetic as a trap) in `cards/marketing-commerce.md`. The build audit lists "commerce (Amazon) playbook" and "commerce calculator" as not built (`build-audit-2026-10-23.md`).
- In `chausar-platform` main: Shopify order JSON import that counts paid orders as billed claims only and refuses refunds, tax-inclusive subtotals and incomplete exports (`platform/runtime/ingest.ts:140-151`, `platform/tests/shopify-money-states.test.ts`); catalogue rows for Shopify, Amazon Seller Central, Flipkart Seller Hub, Meesho, Shiprocket, Unicommerce, Meta Ads, Instagram Insights, all `planned` (`platform/runtime/connectors.ts:35,63-65`); a per-operation status of `planned | fixture-tested | live-verified` (`connectors.ts:27`); the action journal with `outcome_unknown` (`platform/runtime/venture/journal/journal.ts`); reserve-then-settle spend, posture ladder, bound approvals (`docs/venture/ink.md`).

India relevance up front: TikTok Shop is not available in India (TikTok has been banned since 2020) and Shopee left India in 2022, so KaloPilot and shopee-mcp matter for their mechanisms only. Sorftime is the only research data source here that covers Amazon.in.

---

## Shopify/claude-for-commerce-examples (Apache-2.0, 145 stars, last commit 2026-09-02)

What it is: Two hosts on top of Anthropic's commerce-agents blueprint. `merchant/` reads one Shopify store's products, orders and stock through the Admin GraphQL API, stages price, listing and stock changes, and writes only the ones the operator approves; `storefront/` is a shopping agent for any Shopify store that builds a real cart and hands checkout to Shopify's own page.

Source: partial. The agent loops, gates and change ledger live in `anthropics/commerce-agents`, installed at a pinned commit (`requirements.txt`, commit `fd4d5922`). This repo holds the Shopify backends, the staging layer, an in-process stand-in store, fixtures, vendored web components and ten skills. No merchant web UI ships ("the operator-facing app is yours to build", `merchant/README.md`). Not NEEDS-REA: the blueprint is a public repo and is the next thing to read if we take the ledger.

How it works:
- Stage, approve, apply. `stage_*` tools record a change and send zero Admin mutations; `merchant/api/tests/test_staging.py` asserts this for every staging path. Only the host route `POST /changes/{id}/apply` applies: it marks that id approved for one call, runs the apply, and drops the mark so a later chat turn cannot spend it (`merchant/README.md`, "The approval path").
- Three gates, named in the trace view: approval (the agent's own `apply_change` is held), provenance (a change staged in another session or before a restart is held; product and variant ids the agent did not read through a tool in this session are refused), guardrail (caps re-checked at apply time, so tightening the config blocks a change already staged) (`vendor/web-shared/Inspector.tsx` `GATE_LABELS`, `merchant/api/staging.py` docstring, `storefront/api/tests/test_shopify_backend.py:208`).
- Write first, then move the ledger. A refused write leaves the change staged and approvable again; a multi-product write that fails part way names what was already written (`staging.py` `WriteFailed.completed`).
- A field the deployment cannot write is refused at staging, not after the owner approved it, and the refusal lists the writable fields (`merchant/README.md`, "A field this deployment cannot write is refused at staging").
- Stock moves are compare-and-set: the adjustment carries `changeFromQuantity` read a moment earlier; a mismatch is refused with "the stock moved since it was read" (`staging.py:286`, `merchant/api/local_store.py:538-552`).
- Alerts are computed, never stored, from `merchant/data/thresholds.json`: low stock per product type and per handle, slow mover (at most 2 units in 30 days with at least 12 in stock), return spike (20% with at least 4 units). Alert kinds with no API source (damaged goods, buyer messages) are left out rather than invented (`merchant/api/alerts.py` docstring).
- Every metric carries `source_note` (ShopifyQL, or "derived from the trailing order scan", or "sessions unavailable to this token"); a read the token can't do raises "cannot read marketing activities" instead of returning 0 (`merchant/api/metrics.py:145`, `merchant/api/shopify_backend.py:200`, `merchant/api/tests/test_metrics.py`).
- Skills as operating rules (`vendor/skills/merchant/*/SKILL.md`): pricing says "Quote margins; do not compute them", state the caps `max_price_delta_pct` and `max_promotion_discount_pct` before any figure, propose the smallest move, and stage a promotion only once it has scope, depth and an end date. Inventory says the daily briefing is 3 to 6 entries ranked by money at stake, then by how soon the window closes, the rest folded into one "N more" entry; a slow mover gets three named options: leave it, mark it down, pull it.

Take for Chausar:
- Business: "Shopify store back office" for an owner's own D2C store: morning briefing, restock and markdown proposals, listing fixes, all staged for approval. A second offer for other store owners: set up a shopping assistant on their Shopify store, with checkout always on Shopify.
- Engine: (1) provenance gate: an approvable change must be staged in this session from ids this session read; Chausar's token binds action, member, session and business but not "the target came from a tool result". (2) Refuse unwritable fields at staging. (3) Compare-and-set on every quantity write. (4) Alert thresholds as an owner-editable file with per-category and per-SKU overrides, and the alert line quotes the threshold. (5) `source_note` on every figure. (6) The briefing rule (3 to 6 rows, money at stake first) for Today.
- Connector: Shopify Admin GraphQL. Read: products, orders, inventory, locations, ShopifyQL reports. Write: variant prices, product fields, inventory adjustments. The scope needed per read is tabled in `merchant/README.md`. Honest label in Chausar: `planned: write`; today only the order import exists.
- UI: the handoff card says "Not charged here", "Payment happens on the shop's own checkout page", and shows a disabled "Checkout link not ready yet" until the link exists (`storefront/web/components/generative/CheckoutCard.tsx`). Quoted reviews and customer text carry "<subject>, shown as written." (`vendor/web-shared/QuotedAsData.tsx`). One present-tense line per tool ("Checking inventory alerts...", "Staging a change for review...") (`vendor/web-shared/tool-copy.ts`). Trace rows use glyphs for running, held, error, ok and say "held · approval gate" (`Inspector.tsx`). Suggestion chips written for a staged change go stale once that change moves (`vendor/web-shared/merchant.ts` `applyChangeUpdate`).

Traps: the price write is float arithmetic (`round(variant.price * ratio, 2)`, `staging.py` `_write_price`) and scaling a variant ladder by a ratio yields odd prices; the local store invents two months of order history so metrics have a prior period (fine for a demo, never for a receipt). Restock quantities ("60 units covers about three weeks") are model arithmetic over payload numbers; Chausar should compute days of cover in code and label any model figure "model estimate".

Already in Chausar?: the journal (described, approved, applied, rejected, outcome_unknown) and single-use bound tokens exist. Not there: provenance gate, staging-time field refusal, compare-and-set, thresholds file, `source_note`, briefing ranking, handoff card wording.

---

## alex-brecher/shopify-multi-store (MIT, 5 stars, last commit 2026-10-23)

What it is: A TypeScript MCP server for many Shopify stores at once: 17 cross-store reports, about 20 dedicated read and write tools, and three generic tools that reach every Admin mutation; a hosted mode where each staff member signs in with their own Shopify account.

Source: full (`src/`, `tests/*.test.mjs`, a Cloudflare Worker build, a built `dist/` also committed).

How it works:
- Generic actions: `shopify_find_actions`, `shopify_describe_action`, `shopify_run_action` (`docs/ACTIONS.md`, `src/actions/`). `dryRun` defaults to true: it validates the document against the store's API version, checks variables against input types, and resolves every record id to a title, SKU or email, changing nothing.
- The preview says whether it is complete. It is incomplete, with reasons, when targets can't be listed in advance (search or filter arguments, `*DeleteAll`, an "all" flag, more than 250 ids, ids that don't resolve). Its recommendation is then "Do not apply without narrowing", and applying needs `acknowledgeIncompletePreview: true` as well (`docs/ACTIONS.md`).
- Destructive mutations need `confirm` set to the exact mutation name, not `true`. Destructive is decided by name words (`DESTRUCTIVE_WORDS` in `src/actions/catalog.ts:108`: delete, remove, cancel, refund, void, archive, unpublish and more), by a list of money-moving or wholesale-replace mutations (`productSet`, `inventorySetQuantities`, `orderCapture`, `giftCardCreate`), and by argument rules (`notifyCustomer: true`, status `ARCHIVED`) in `DESTRUCTIVE_ARGUMENT_RULES`.
- Outcomes per target: `applied`, `rejected`, `partial`, `unknown`, `throttled`, `failed`. A mutation is never retried or resent; for partial or unknown it never suggests running the same document again, only retrying rejected parts after reading the unknown ones (`docs/ACTIONS.md`). If any store fails validation, nothing runs anywhere.
- Denylist: mutations that mint credentials, change the app's own billing, or create webhooks that keep delivering data after the user's token expires; `bulkOperationRunMutation` is refused because it would hide the inner mutation from the checks.
- Per-user access: every hosted call uses that person's own Shopify online token, so Shopify's staff permissions are the only permission system; an expired token fails with one "reconnect all stores" link and never falls back to an app token. Every call writes an audit line with user, stores, mutation, a hash of the variables and each outcome.
- Stock writes are compare-and-set (`shopify_set_inventory`, `compareQuantity` must equal the current available quantity, `src/admin-tools.ts:491-536`). Reports keep currencies separate (`src/report-tools.ts:48`).

Take for Chausar:
- Business: a "multi-store Shopify operator" add-on: catalog gap report, duplicate SKUs, price differences, low stock with transfer chances, unfulfilled orders by age bucket (`README.md`, "Ready-made reports"). Good for an owner who runs a retail and a wholesale store.
- Engine: the strongest write-safety design in this group. Take: dry run by default with a complete or incomplete preview and reasons; confirm by exact action name for destructive actions; destructive by name, by list and by argument value; per-target outcome states including `partial`; "never resend, read the unknown parts first" (matches and extends Chausar's `outcome_unknown`); a denylist for actions that outlive the session.
- Connector: Shopify Admin, per-user tokens, `write` with confirm. Label in Chausar: `planned: write`.
- UI: the stores page states each connection as "Connected as <email>" with expiry, "Expired" or "Not connected", plus one "Reconnect all" (`docs/ACTIONS.md`, "What people see"). Fits Connections.

Traps: the generic action tools let a model reach 523 mutations; Chausar should expose only named actions per playbook and keep a generic tool behind the owner. The 24-hour online token means daily reconnects.

Already in Chausar?: journal with `outcome_unknown` and single-use tokens. Not there: dry-run preview with completeness, exact-name confirm, `partial` outcome, argument-based destructive rules, denylist.

---

## ilyautov/marketplaces-mcp-ru (MIT, 52 stars, last commit 2026-10-07)

What it is: Five MCP servers on one Python core for Wildberries, Ozon Seller, Ozon Performance (ads), Yandex Market and Avito seller accounts: 1,022 API methods reached through a few meta-tools, a read/write/destructive gate, auto-pagination, and curated analysis recipes.

Source: full (`core/`, per-marketplace `endpoints.yaml` and `workflows.yaml`, offline tests).

How it works:
- Catalog-driven tools: `*_search_methods`, `*_describe_method`, `*_call_method` (reads), `*_write_method` and `*_delete_method` (gated), raw path tools, `*_fetch_all`. The catalogs are generated from the marketplaces' official OpenAPI specs; curated risk levels and descriptions are never overwritten by re-import (`README.en.md`, "How it works").
- Safety gate (`core/safety.py`): read runs; write needs `confirm_write=true`; destructive also needs `i_understand_this_modifies_data=true`. A refused call returns an error with `http_call_skipped: true` and "Nothing was sent." Mutating verbs (PUT, PATCH, DELETE) have a floor: a catalog entry can raise their level but never lower it to read, and a CI test fails the build if a mutating method is tagged read (`tests/test_safety_catalog.py:29-48`).
- Honesty about coverage: the hand-checked core (sales, stock, prices, finance, reviews) is "verified on real accounts"; the rest is "a reconnaissance map" because spec verbs were sometimes wrong (`README.en.md`, "Caveats"); Yandex Market and Avito had no live run yet and the README says so.
- `fetch_all` handles offset, last_id, cursor and date pagination, detects a repeated cursor, does not stop on a short page (servers cap page size silently), and returns `truncated: true` when it hits 10,000 items or 200 pages (`core/paginate.py:25-166`).
- `doctor --live`: one cheap real read per configured marketplace, a table of which answered, exit code 0 only if all did, secrets never printed (`core/doctor.py`).
- Workflows are data: `name`, `when_to_use`, `steps` (operation id plus why), `interpret`, `common_mistakes` (`ozon_mcp/workflows.yaml`): out-of-stock risk from days of stock, red price index, unit economics, catalog sync, content quality, ABC analysis. Common mistakes are concrete ("Treating reserved stock as available", "Requesting more than one month per call").
- Key entry has "two doors" (`docs/superpowers/specs/2026-06-24-terminal-free-cabinet-key-lifecycle-design.md`): an installer that never puts the key in chat, or a chat tool that does, guarded by `i_understand_key_goes_to_chat=True`.

Take for Chausar:
- Business: this is the template for a "marketplace seller back office" in India: Amazon SP-API and Flipkart's seller API have the same shape (big official specs, sales, stock, price, finance, returns). Recipes for days of cover, price index, ABC and unit economics carry straight over.
- Engine: (1) safety level per connector method with a verb floor and a CI test that a mutating method can never be read. (2) Per-method verification flag (live-verified vs imported from spec) shown to the owner, which slots under Chausar's `fixture-tested | live-verified`. (3) `truncated` on every multi-page read, joined to Chausar's existing `INCOMPLETE_EXPORT` refusal. (4) Workflow recipes as data with `common_mistakes`, which double as judge rules.
- Connector: WB, Ozon, Yandex Market, Avito seller APIs (read live-verified for the core, write gated). Not used in India; the pattern is the value.
- UI: a "Check connections" action that runs `doctor --live` style probes and shows one row per connector: answered, failed, skipped, with no secret on screen.

Traps: the unit-economics recipe has the model compute "Net = sale minus commission minus logistics minus returns minus ads" (`ozon_mcp/workflows.yaml:46-51`): model arithmetic. Door 2 puts a seller key into the model transcript; Chausar keeps keys in a form field only. Confirmation flags are booleans the model itself passes, so the gate only stops accidents, not a model that decides to write; Chausar's owner approval must stay outside the model.

Already in Chausar?: connector status per operation exists (`connectors.ts:27`); the always-ask floor exists in the posture design. Not there: verb floor and CI test, per-method verification, `truncated`, doctor probe, recipes as data.

---

## xjli360/sealeap-amazon-skills (MIT, 310 stars, last commit 2026-10-16)

What it is: 602 Amazon seller skills in Chinese: 38 from Amazon-authorised course material, about 490 distilled from public Douyin, WeChat, Xiaohongshu, Bilibili and YouTube posts, 12 public-research topics and 101 "app" skills that route to paid data tools (Keepa, SellerSprite, SIF, Sorftime), with about 20 offline calculators.

Source: full (skills, scripts, references). 269 of the 288 Python files are the same `mcp_research.py` template.

How it works:
- Offline calculators with strict input contracts. `app/hermes/sealeap-hermes-product-research/scripts/unit_economics.py`: every revenue and cost input is an evidence object with `evidence_type` (FACT, ESTIMATE, ASSUMPTION, UNKNOWN), `source` and a timezone-aware `observed_at`, required "including for zero"; UNKNOWN must carry no number and a `missing_reason`; any missing input makes the result `HOLD` with a `missing` list. Output lists `calculation_basis` (which evidence types were used), says `decision: NOT_A_PROCUREMENT_DECISION`, and states its limits (fixed overhead, financing and cash timing not included).
- Break-even ACOS is computed only when the ads report's sales basis equals the revenue basis; otherwise it is null with the reason "Ad revenue denominator is missing or differs from revenue_basis" (same file).
- FBA reimbursement audit (`public-research/sealeap-amazon-fba-reimbursement-audit/scripts/reconcile_reimbursements.py`): per loss event, basis = min(documented unit cost, policy unit cap) x units, gap = basis minus already reimbursed. Rows are `HOLD` with named reasons (`MISSING_DOCUMENTED_UNIT_COST`, `REVIEW_WINDOW_NOT_CONFIRMED_OPEN`, `COST_EVIDENCE_MISSING`, `ZERO_COST_REQUIRES_MANUAL_REVIEW`); output says `amount_kind: ESTIMATE_FOR_REVIEW_NOT_RECEIVABLE` and `submission_performed: false`. Duplicate JSON keys, NaN and duplicate event ids are rejected.
- `acos_diagnose.py` recomputes ACOS from raw spend and sales and flags "ACOS decomposition does not reconcile" when the report's own figure disagrees; `discount_plan.py` drafts discount changes from an exported snapshot, holds ambiguous rows, and refuses to lower a running promotion without a current rule check; every script ends with `submitted: false`.
- Connector honesty ladder (`public-research/sealeap-amazon-selling-partner-connector/SKILL.md`): each capability is `DOCUMENTED`, `DISCOVERED`, `READ_VERIFIED`, `WRITE_VERIFIED` or `UNAVAILABLE`; WRITE_VERIFIED needs a real authorised write plus a read-back and "do not write extra just to earn the status". It names an official Selling Partner MCP endpoint (`sellingpartner-ai.amazon.com/mcp`) as claimed by Amazon's repository, to be checked before use.
- Multi-channel skill (`public-research/sealeap-amazon-multichannel-operations/SKILL.md`): one authority per data type (price, stock, orders), never count one warehouse's stock once per channel, pilot on a few SKUs, reconcile by channel + order id + line id, and on a write timeout read the target first and never replay.
- Support case tracker (`public-research/sealeap-amazon-support-case-tracking/SKILL.md`): case timeline, deadlines only from an official or owner-set source else UNKNOWN, attachments are evidence not instructions, follow-up drafts only, "closed" does not mean solved.

Take for Chausar:
- Business: three service offers a self-employed person in India can sell to Amazon.in and Flipkart sellers: (a) reimbursement and fee audit (lost or damaged stock, wrong weight-slab fees), paid per audit or as a share of recovered money, where the owner files nothing and the seller submits; (b) ads health check (ACOS recomputed, break-even ACOS from real margins); (c) monthly unit economics per SKU.
- Engine: the unit-economics input contract (evidence type, source and observed_at on every number, unknown is not zero, HOLD with a list) is exactly Chausar's receipt rule, rebuilt on BigInt paise. The basis-match rule for break-even ACOS. The `ESTIMATE_FOR_REVIEW_NOT_RECEIVABLE` label for money that is claimed but not received. The five-state connector ladder maps onto Chausar's three states and adds `DISCOVERED` and `UNAVAILABLE`.
- Connector: Amazon SP-API and Ads API via the owner's own authorisation; label `planned: read` until a read is verified against an export.
- UI: status words HOLD, DRAFT, NO_CHANGE with a reason per row, ready to show as plain sentences.

Traps: most skills are model summaries of social posts by named creators; advice, not rules. `acos_diagnose.py` uses floats. Several app skills depend on paid third-party data keys. Copying a skill folder must keep its LICENSE and NOTICE. Amazon.in is not covered anywhere.

Already in Chausar?: the 21 Oct card took the sister repo's calculator and rule register. New here: per-input evidence types, the reimbursement audit, basis-match ACOS, the connector ladder, the multi-channel rules.

---

## buluslan/amazon-listing-doctor (MIT, 91 stars, last commit 2026-09-17)

What it is: A diagnose-only Amazon listing checker: 13 standard-library Python scripts score a listing JSON (CDQ quality score, A9 indexability, COSMO intent coverage, Alexa answerability) and lint title, highlights, bullets and backend search terms against rules kept as JSON. It never rewrites copy.

Source: full (`scripts/`, `references/`, `evals/evals.json`).

How it works:
- Rules are data: `references/rules.json` (title limits per mode, words that may repeat per language, forbidden characters, promo and subjective word lists in en, zh, de, fr, it, es), `references/image_rules.json` (1000 px minimum, white main background, 1:1, at least 4 images for full marks, no watermark), `references/cdq_weights.json` (attributes 30, title 25, variation 20, image 15, bullets 5, A+ 5).
- Missing data degrades the score instead of guessing: a dimension whose fields are missing reports `score: null` with a reason, never 0 or 100; the report opens with data coverage (front-end fields vs backend-only fields) and `unlock_dimensions` ("add item_highlights to unlock ...") (`scripts/compliance_report.py:99-188`, `SKILL.md` section 2.2).
- Each attribute score carries a `basis`: `user_provided`, `builtin_fallback` (a broad category list, marked as reference only) or `no_reference` ("assumed full, data gap, not verified") (`scripts/cdq_score.py:140-200`).
- Title triage sorts each phrase of a title into keep, move to highlights, move to bullets, or delete, with low-confidence phrases left for a person (`scripts/title_triage.py`).
- Principles: compliance checks are scripts, never "please avoid repeats" in a prompt, because "the LLM skips text constraints"; talk to the user in business words, never script or field names (`SKILL.md`, "重要原则" and "用户语言规范").
- `evals/evals.json`: listings that must pass with CDQ at least Good, and counter-examples that must fail on named checks.

Take for Chausar:
- Business: "Listing health check" as a fixed-price offer for marketplace sellers (per ASIN or per catalogue), and as the first step of the owner's own shop playbook. The owner approves each proposed listing change; the seller pastes or uploads the listing export.
- Engine: listing rules per marketplace as dated data; `score: null` plus reason when inputs are missing; an "unlock" list that becomes Chausar question rows ("Upload your backend search terms to check indexing"); `basis` on every score.
- Connector: none (paste or export). Front-end fields could come from SP-API Catalog Items later; backend search terms need a Seller Central export, which the repo says plainly.
- UI: the report order (data coverage first, then the verdict, then fixes) and the keep/move/delete chips per title phrase fit a draft review sheet.

Traps: "CDQ" is presented as "Amazon's internal 6-dimension ASIN quality score" with "official weight backing" (`SKILL.md:30`, `assets/report-template.md`); the weights have no source, so any Chausar score must be labelled our own rubric. The "75-character title rule from 27 July 2026" and its India mapping (`references/sites-overrides.md:136`) cite no URL in the repo; treat as unverified. The skill must introduce its author on every call (`SKILL.md:22`).

Already in Chausar?: draft checks exist for other playbooks (`platform/runtime/venture/playbooks/draft-checks.ts`); nothing for listings.

---

## spree/agent-skills (MIT, 10 stars, last commit 2026-09-30)

What it is: 38 developer skills, a subagent and two hooks that teach coding agents how Spree 6 (Rails) commerce works: catalog, pricing, inventory, checkout, order totals, returns, marketplace payouts.

Source: full (markdown skills plus two bash hooks).

How it works:
- Hooks: a PreToolUse hook blocks database drops, `TRUNCATE` or unscoped `DELETE` on order, payment, refund and customer tables, unconditional `delete_all`, and force-pushes to main; a PostToolUse hook warns on secrets in edits (`hooks/block_destructive_db.sh`, `hooks/warn_on_secrets.sh`).
- Money freeze: a placed order's totals are only re-summed, never re-derived, so "today's promotions and tax rates never rewrite last week's order"; later changes go through explicit discount or fee services that re-sum and recompute status (`partially_paid`, `overcharged`) (`skills/spree-order-totals/SKILL.md:75-100`).
- Stock counters: on hand, allocated, reserved, incoming; available = on hand minus allocated; purchasable = available minus reserved; overselling shows as allocated greater than on hand, never a negative shelf; never set a count directly, always write a movement (`skills/spree-inventory/SKILL.md:16-61`). Checkout reservations expire after 10 minutes.
- Marketplace ledger: commission is a frozen line per item; "no matching rate means no commission"; earnings and refund reversals are separate transfer rows ("never edits the earning"); only completed payouts debit the balance; `unresolved` keeps transfers claimed so the same money is never paid twice (`skills/spree-marketplace/SKILL.md:110-135`).
- Pricing keeps a price history and a "lowest price in the last 30 days" for EU Omnibus rules (`skills/spree-pricing/SKILL.md:138-151`). Returns: one eligibility rule (window per market, from placement), other gates added as hooks (`skills/spree-returns/SKILL.md:81-119`).

Take for Chausar:
- Business: none for a retail owner in India (Spree needs a developer). A Spree dev agency would use it.
- Engine: the stock counter model and movement ledger for a multi-channel seller (Amazon FBA, own warehouse feeding Flipkart, Meesho and Shopify); the payout ledger rules for reading marketplace settlements (earning row, refund reversal row, only paid-out counts as received), which matches Chausar's billed vs received split; money freeze for issued invoices; a lowest-price-in-30-days record to back honest "was" prices.
- Connector: none.
- UI: none worth taking.

Traps: the hooks rely on regexes over shell text and an opt-out env var; useful as a backstop, not as the safety model.

Already in Chausar?: billed vs received vs earned exists for Shopify imports (`platform/tests/shopify-money-states.test.ts`); stock and payout ledgers do not.

---

## DannylydST/sorftime-seller-agent (MIT, 39 stars, last commit 2026-09-20)

What it is: A skill and local MCP bridge to Sorftime's paid hosted data service (97 tools over Amazon in 14 countries including India, Walmart, TikTok Shop, Shopee, TEMU, 1688), plus local scripts for product picking, a profit calculator and a shortlist reviewer.

Source: partial. The client, bridge (`scripts/sorftime_bridge.py`, which forwards to `https://mcp.sorftime.com`), scripts and methodology cards are here; the data and the 97 tools are a hosted service paid in credits. NEEDS-REA only for the server side, which REA can't reach; nothing to reverse engineer on the client.

How it works:
- Risk badges are advisory: every product gets hard, capital, ops, trap or safe with a reason, products are never hidden, and seller profiles (newbie, grower, pro, factory, brand) change emphasis only, from a full warning table to a footnote (`SKILL.md:349-385`).
- `scripts/review_shortlist.py` gives a deterministic second opinion per product: off-topic for the keyword (NO-GO), IP or trademark words ("patent pending", Disney, Marvel), FBA fee above 35% of price, review anomalies, season windows; verdict GO, CAUTION or NO-GO with evidence, followed by a fresh-context sub-agent red team that sees only the shortlist and flags.
- "Instruction priority": a precise request runs directly with no methodology imposed; only vague requests get the guided flow (`README.md`, v3.6.0 notes).
- Tool descriptions carry their credit cost ("each call consumes 10 credits" beyond one year) (`sorftime_bridge.py:3011`).

Take for Chausar:
- Business: "Product research for a new seller" as a paid report: shortlist, risk badges, deterministic review, owner decides; data bought with the owner's own Sorftime key.
- Engine: the deterministic shortlist review before any model opinion; advisory badges that never hide items; price per call carried in the tool description so Chausar can quote before spending.
- Connector: Sorftime MCP, `read`, paid, owner's key. Label `planned: read`.
- UI: profile-based emphasis (beginner sees full warnings) is a good pattern for Chausar's first-time owners.

Traps: `scripts/calculator.py` invents fee rates in float ("FBA fee rough estimate: $2.5/kg + $3.5 base", referral 15%, TikTok 5%, Shopee 7%) and prints them like facts; never copy. The "7-member AI review panel, 82.7% adoption" is a model vote presented as validation. `config/platforms.json` drives a logged-in browser session over Sorftime's own web app.

Already in Chausar?: no.

---

## sailtonight/kalopilot-skill (MIT, 8 stars, last commit 2026-08-17)

What it is: A thin skill that sends TikTok Shop research questions to Kalodata's hosted KaloPilot agent and polls for the answer.

Source: partial. The client (`SKILL.md`, `scripts/pilot.sh`) is complete; the agent and the data are Kalodata's paid service. NEEDS-REA for the agent would only reach the web app at kalodata.com/pilot, not the server.

How it works:
- Async submit then poll: `POST .../chat/async/submit` returns a `task_id`; poll `.../async/result` after 45 s for simple and 90 s for complex questions, then every 30 s; states `running`, `completed`, `error`, `cancelled` (`SKILL.md`, "Making a Request").
- Follow-ups reuse the `task_id` for context; a new topic starts fresh.
- Rendering rules: show `text`, then `report`, then `report_url` copied verbatim ("NEVER construct, guess, or fabricate this URL"), then "(consumed N credits)". Per-item costs are listed (1 credit per video script, 1 per product comment analysis) (`references/utilities.md`).
- "Never try to answer TikTok data questions from your own knowledge."

Take for Chausar:
- Business: none in India (TikTok Shop is unavailable).
- Engine: the poll cadence by job size and the "copy links verbatim, never construct" rule for any connector that returns report links.
- Connector: Kalodata, `read`, paid. Not relevant for India.
- UI: the closing line "(consumed 10 credits)" under each result: Chausar's spend line per run.

Traps: the token is stored in plain text at `~/.kalopilot/token` and the skill asks the user to paste it into chat.

Already in Chausar?: run states and spend lines exist; the verbatim-link rule does not.

---

## bintangtimurlangit/shopee-mcp (MIT, 22 stars, last commit 2026-09-29)

What it is: An unofficial buyer-side MCP server for Shopee (search, product detail, reviews, shops, flash sales) and, when logged in, the user's own orders, cart, vouchers, likes and follows, driven through a fingerprint-patched browser.

Source: full (`src/`, unit and smoke tests).

How it works:
- Shopee guards its API with signed headers, so the server drives CloakBrowser (a Chromium with fingerprint patches) on a logged-in profile and captures the responses Shopee's own page fetches (`README.md`, "Why a browser?", `src/browser/session.ts`).
- Account tools are hidden until a login is confirmed, toggled together with one `tools/list_changed`, and can be pinned off (`src/account-mode.ts`).
- Every tool declares read-only, idempotent, destructive hints (`README.md` table, `src/tools/actions.ts` `WRITE`).
- Actions read state first and click only when a change is needed, click Shopee's own button, and report only what Shopee's response confirmed; they refuse rather than guess (a multi-variant item needs an explicit model id; add to cart never falls back to Buy Now). Nothing checks out or pays.
- Prices: one currency table with decimals per currency; an unknown currency shows its code instead of a guessed symbol (`src/utils/price.ts`).

Take for Chausar:
- Business: none in India (Shopee left in 2022).
- Engine: tools appear only when the session that backs them is live; "read state, act only if needed, report what the platform confirmed" for any owner-browser-session connector; unknown currency shown as its code.
- Connector: Shopee buyer session. Not relevant.
- UI: none.

Traps: the whole design rests on a fingerprint-patched browser to get past Shopee's anti-fraud gate. That is detection evasion, which the founder ruled out ("Not built: proxy rotation to evade detection"); Chausar's owner-browser-session mode must use an ordinary browser on the owner's own account. Shopee does have an official Open Platform for sellers.

Already in Chausar?: the owner-browser-session posting mode with a risk line exists in the design (Ink section 7.9). The login-gated tool list does not.

---

## nexscope-ai/ecommerce-ai-tools (Apache-2.0, 130 stars, last commit 2026-10-23)

What it is: The source of Nexscope's public learning site: guides, dated API evidence pages, case studies, a "product gallery" submission flow and site maintenance scripts. The Nexscope application itself is not here.

Source: NEEDS-REA. The README says "The hosted Nexscope application runs separately; its source code is not in this repository." To learn the product you would look at the web app (nexscope.ai tools pages and its REST and MCP API docs); there is no binary or Electron app. (The harvest TSV listed the licence as none; the repo has an Apache-2.0 LICENSE.)

How it works:
- Dated evidence pages (`docs/api-evidence/*.md`): a front-matter `last_reviewed` date, an "Evidence field | Observed value" table, then "what the result can support" and what it "cannot establish". Example: a price-series test returned four dated prices; records outside the window mean "cannot establish continuous daily coverage, a current price ... or a verified promotion", and a Prime price of `-1` is "not treated as a valid price" (`docs/api-evidence/amazon-price-series.md`).
- Sanitised JSON evidence is published beside each page (`docs/assets/evidence/`).
- `scripts/attribute_outbound_links.py` adds tracking parameters to outbound links.

Take for Chausar:
- Business: none directly.
- Engine: sentinel values (-1, empty arrays) are never numbers; a reading outside the requested window is reported as coverage, not filled in.
- Connector: Nexscope REST and MCP, paid, `planned: read` at most.
- UI: the "can support / cannot establish" pair is a clear way to show what a research run proves; use it under any market research result in Chausar.

Traps: links carry tracking and the free "product gallery" is a lead funnel. Nothing runnable.

Already in Chausar?: "observed / inferred / needs your data" labels exist in the evidence ledger design (Ink section 7.6); the support/cannot-establish wording does not.

---

## AtlasCloudAI/atlas-marketing-studio (no licence file, 45 stars, last commit 2026-07-23 on main)

What it is: A Next.js ad studio for e-commerce: product and presenter photos become lip-synced "UGC" ads, viral ads are remade with your product, and short drama and skit ads are generated shot by shot through Atlas Cloud's model API, with credits, Google login and Stripe top-ups.

Source: full code is present, but there is no LICENSE file; the README says "MIT" (`README.md:174`) and the GitHub API reports no licence. Treat as learn only until a licence file exists. Not NEEDS-REA: nothing is hidden, only unlicensed.

How it works:
- Fixed costs per step in code: plan 3 credits, image per shot 5, video per shot 12 (`src/lib/marketing-studio/workflow.ts`), with model choices pinned and comments recording observed provider failure rates ("4 of 6 calls returned 400").
- Credits: an atomic conditional deduct (only if balance covers it), then a ledger row; if the ledger write fails the deduct is reversed; a failed or timed-out generation is refunded and the UI says "Generation failed, your credits were refunded" (`src/lib/credits.ts`, `src/lib/marketing-studio/gen-task.ts`, `src/i18n/messages.ts:97-142`). Bring-your-own-key skips billing entirely (`src/lib/byok.ts`).
- Resume after reload: a running shot is restored from a snapshot (`src/lib/marketing-studio/resume.ts`, `src/app/marketing-studio/page.tsx:157-257`).
- Hook library as data: pain point, before-and-after tease and more, each with a recipe (`src/lib/marketing-studio/hooks.ts`).

Take for Chausar:
- Business: a "product ad videos for small sellers" offer exists here, but it overlaps the 21 Oct UGC-Factory card and needs disclosure built in.
- Engine: refund-on-failure wording and a resumable job; Chausar already has reserve-then-settle, so take only the wording and the resume snapshot idea.
- Connector: Atlas Cloud model API, paid. `planned: handoff`.
- UI: "Failed (refunded)" as a job state.

Traps: preset AI presenters and a "Selfie Testimonial" format produce synthetic customers with no AI label or "not a real customer" check (`src/lib/marketing-studio/avatars.ts`, `formats.ts:52-55`); ASCI and platform rules in India require disclosure. "Reference to Ad" remakes someone else's viral ad. No licence.

Already in Chausar?: reserve then settle and refused unknown prices exist (`docs/venture/ink.md`); disclosure checks exist in the social playbook design.

---

## mobazha/mobazha-unified (MPL-2.0, 123 stars, last commit 2026-10-03)

What it is: A React/Next.js commerce front end (storefront, checkout, orders, seller admin, marketplace views) for Mobazha's hosted or self-hosted node, with crypto checkout through per-order multisig escrow.

Source: full for the front end (2,279 files: `apps/web`, `apps/extension`, `packages/core`, `packages/ui`, `packages/commerce-kit`); the backend is a separate repo (`mobazha/mobazha`).

How it works:
- Runtime capabilities: a route renders only when the connected backend reports the capability; while config loads it shows a spinner, on error "Retry", and when off a not-found page (`apps/web/src/components/RuntimeCapabilityBoundary.tsx`).
- "Unified presents commerce; it does not become a second source of truth": the backend validates every protected action (`README.md`).
- Status displays fall back to a neutral grey label for unknown states instead of guessing a colour (`apps/web/src/components/Order/orderSettlementStatus.ts`); order states map to icon, colour token and label in one config (`orderStatusConfig.ts`).
- Written UX audits per surface, for example seller admin at 375 x 667 inside a Telegram Mini App (`docs/SELLER_ADMIN_MOBILE_UX_AUDIT.md`).

Take for Chausar:
- Business: none for India retail (crypto checkout is a poor fit).
- Engine: none new.
- Connector: none.
- UI: show a place only when its capability is on, with explicit loading and retry states; unknown status gets a neutral label. Small, already close to Chausar's honest labels.

Traps: MPL-2.0 is file-level copyleft: any copied file stays MPL and its changes must be published; prefer ideas only.

Already in Chausar?: largely, through honest connector labels and the planned-chip-has-no-button rule.

---

## Draft playbook: online seller in India (own shop, and seller services)

Two businesses a retail person in India can run with one playbook family. Every connector is `planned` unless stated, and every figure comes from code with a receipt or is labelled "model estimate".

### A. "My own shop": selling on Amazon.in, Flipkart, Meesho, Shopify and Instagram

Offers are the owner's own products; Chausar is the back office.

| # | Step type | What happens | Who |
|---|---|---|---|
| 1 | gather | Products: cost price with GST, HSN and GST rate, MRP, weight and size, country of origin, photos; channels and fee cards (each fee with source and checked-on date) | Owner |
| 2 | compute | Unit economics per SKU per channel (see the worked example) | Code |
| 3 | check | Listing health per channel: rules as data, `score: null` with a reason where fields are missing, "upload X to unlock" rows | Code |
| 4 | write | Listing fixes as staged changes: title phrase keep/move/delete, missing attributes, image defects | Agent |
| 5 | approve | Owner approves each staged change; nothing goes live without it | Owner |
| 6 | operator | Apply: Shopify via API when built; Amazon and Flipkart via API once verified; Meesho, Instagram and others by export file the owner uploads | Owner or connector |
| 7 | compute | Daily: stock counters per channel, days of cover, alerts against the owner's thresholds file | Code |
| 8 | write | Morning briefing: 3 to 6 rows ranked by money at stake, each with a figure and its inputs, or "unknown" | Agent over code figures |
| 9 | approve | Restock, markdown, pause, price move: each staged with caps shown first | Owner |
| 10 | compute | Ads: ACOS recomputed from raw spend and sales; break-even ACOS from real contribution, same sales basis | Code |
| 11 | compute | Settlement reconciliation: expected payout per order vs the marketplace settlement report, difference split into named items | Code |
| 12 | write | Claims list (lost or damaged stock, wrong fees) as "estimate for review, not receivable"; the owner files | Agent drafts, owner sends |

### B. "Seller services desk": the same work sold to other sellers

Fixed-price offers, with the client's exports as input and the owner approving every deliverable:
1. Listing health audit per catalogue (report plus fix list).
2. Reimbursement and fee audit (claims list; fee per audit or a share of recovered money, the client files).
3. Monthly unit economics and settlement reconciliation per SKU.
4. Ads health check (recomputed ACOS, break-even, wasted spend list).
5. Catalogue upload service (Meesho and Flipkart bulk sheets prepared from one product sheet).

### Unit economics with exact numbers (worked example)

Inputs below are illustrative, not current fee rates: the owner enters their own fee card with a source and checked-on date, and the CA confirms the tax rates, as in the CA firm playbook. Every line is rounded half-up to the paisa and stored in paise.

| Input (example) | Value |
|---|---|
| Selling price, GST included | ₹999.00 |
| GST rate on the product | 18% |
| Referral fee | 15% of ₹999.00 (fee base as the fee card defines it) |
| Closing fee | ₹25.00 |
| Shipping fee charged by the marketplace | ₹65.00 |
| GST on marketplace fees | 18% |
| GST TCS collected by the marketplace | 0.5% of taxable value |
| Income-tax TDS on e-commerce payments (section 194-O of the 1961 Act; its 2025 Act number needs the CA) | 0.1%, base as the marketplace's TDS statement shows (example uses taxable value) |
| Stock cost | ₹300.00 plus GST ₹54.00 |
| Packaging | ₹12.00, no GST credit |
| Ads per order | ₹80.00 plus GST ₹14.40 |
| Returns | 8% of orders, ₹120.00 lost per return |

| Output | Working | Value |
|---|---|---|
| Taxable value | 999.00 ÷ 1.18 = 846.6101... | ₹846.61 |
| Output GST | 999.00 minus 846.61 | ₹152.39 |
| Fees before GST | 149.85 + 25.00 + 65.00 | ₹239.85 |
| GST on fees | 239.85 x 18% = 43.173 | ₹43.17 |
| TCS | 846.61 x 0.5% = 4.23305 | ₹4.23 |
| TDS | 846.61 x 0.1% = 0.84661 | ₹0.85 |
| Paid out by the marketplace | 999.00 minus 283.02 minus 4.23 minus 0.85 | ₹710.90 |
| Expected return loss | 8% x 120.00 | ₹9.60 |
| GST to pay in cash | 152.39 minus 43.17 minus 54.00 minus 14.40 minus 4.23 | ₹36.59 |
| Contribution per order | 846.61 minus 239.85 minus 300.00 minus 12.00 minus 80.00 minus 9.60 | ₹205.16 (24.23% of taxable value) |
| Tie-out | payout 710.90 minus stock 354.00 minus packaging 12.00 minus ads 94.40 minus GST cash 36.59 minus returns 9.60 = 204.31, plus TDS 0.85 claimed in the income-tax return | ₹205.16 |
| Contribution before ads | 205.16 + 80.00 | ₹285.16 |
| Break-even ACOS if the ads report counts GST-inclusive sales | 285.16 ÷ 999.00 | 28.54% |
| Break-even ACOS if it counts taxable value | 285.16 ÷ 846.61 | 33.68% |

What the engine should do with this: compute three views that must tie (contribution, cash paid out, GST cash), refuse to compute break-even ACOS until the owner says which basis the ads report uses (sealeap's rule), and HOLD the whole sheet if any input is unknown. The example assumes a GST-registered seller who claims input credit; without credit, GST on fees, stock and ads becomes cost. Settlement reconciliation compares the expected ₹710.90 per order with the settlement report line and splits any difference into named items (fee slab, weight change, return deduction).

### Which marketplaces have real APIs, and which are handoff

Check each before building; labels are what Chausar should show until a read is verified against the owner's own export.

| Channel | Seller API | What it covers | Chausar label until verified |
|---|---|---|---|
| Amazon.in | Selling Partner API (India marketplace), Amazon Ads API | Orders, reports including settlement and FBA reimbursements, listings, inventory, finances; ads campaigns and reports. Needs developer registration and the seller's authorisation; buyer personal data needs extra approval. sealeap cites an official Selling Partner MCP endpoint, unverified | `planned: read`, then `write` for listings and prices after a verified write with read-back |
| Flipkart | Flipkart Marketplace Seller API (self-access app from the seller dashboard) | Listings, inventory, orders and shipments, returns. Payments and settlement mostly by downloaded report. No open ads API for small sellers that we know of | `planned: read`; settlement by `handoff` (upload) |
| Meesho | No public seller API | Supplier panel with bulk catalogue sheets and payment reports; some multi-channel tools (Unicommerce, EasyEcom) integrate as partners | `handoff` (Chausar prepares the upload file; the owner uploads and downloads reports) |
| Shopify | Admin GraphQL API | Full read and write | `planned: write`; order import exists today |
| Instagram shop | Meta Commerce Manager and Catalog API; content publishing and messaging APIs | Catalog sync (or through Shopify's Facebook and Instagram channel); posting and DMs need Meta app review; checkout inside Instagram is not offered in India, so orders go to the website or WhatsApp | `handoff` (catalogue file or Shopify channel) |
| WhatsApp Business | Business app catalogue (manual); Cloud API through WATI or Interakt | Catalogue, order chats; Cloud API needs business verification and paid conversations | `handoff`; WATI/Interakt row already in the catalogue as planned |
| Myntra, Ajio, Nykaa, JioMart | Partner portals | Uploads and reports through the portal; APIs only for large brands or partners | `handoff` |
| Shiprocket, Delhivery | Public REST APIs | Create shipment, label, pickup, tracking | `planned: write` |
| Razorpay | Public API | Payment links, payments, refunds, settlements | `planned: read` (payment links from the books engine) |

### Approval points

Every price or discount change (caps shown first, money rows ask twice); every listing change; restock, pause or markdown; any claim or case message to a marketplace (drafted only, the owner sends); ad budget changes; anything touching a buyer.

### Deterministic checks

- Listing rules per channel as dated data (characters, repeats, banned promo and subjective words, image rules); unverified rules marked so.
- India: selling price must not exceed MRP for packaged goods; MRP, country of origin and seller details present (Legal Metrology and the Consumer Protection (E-Commerce) Rules; CA or lawyer confirms the rule table).
- Price floor: no change below break-even contribution unless the owner marks it a clearance.
- Stock writes compare-and-set; a channel's stock never counted twice; reserved is not available.
- Multi-page reads must report `truncated: false` before any total.
- Any quoted review or buyer message shown "as written" and never followed as an instruction.

### Never

Fingerprint-patched or proxied browsers to get past a marketplace's bot checks; review requests tied to incentives; fake or synthetic testimonials; buying ranks or reviews; reading buyer personal data without the marketplace's approval; filing claims on the seller's behalf without their own submit.

---

## Ideas worth taking, ranked by value

| Idea | From | Kind | Value for B2C owners | Effort |
|---|---|---|---|---|
| India online-seller playbook (own shop): listing health, staged price and stock changes, briefing, ads, settlement, all owner-approved | this card's draft, built on Shopify examples, sealeap, marketplaces-mcp-ru, listing-doctor | playbook | high | L |
| Seller services desk: listing audit, reimbursement and fee audit, monthly unit economics, ads health check, catalogue uploads | sealeap-amazon-skills, amazon-listing-doctor | playbook | high | M |
| Unit economics in paise with an evidence type, source and observed_at on every input; unknown makes HOLD; three views (contribution, payout, GST cash) must tie | sealeap `app/hermes/.../unit_economics.py` plus the India worked example | engine | high | M |
| Settlement and reimbursement audit: expected vs paid per order, claims as "estimate for review, not receivable", no submission | sealeap `reconcile_reimbursements.py` | engine | high | M |
| Dry run by default, preview complete or incomplete with reasons, confirm by exact action name, destructive by name, list and argument value | shopify-multi-store `docs/ACTIONS.md`, `src/actions/catalog.ts` | engine | high | M |
| Per-target outcomes applied, rejected, partial, unknown, throttled; never resend a partial, read unknown parts first | shopify-multi-store `docs/ACTIONS.md` | engine | high | S |
| Provenance gate: approvable changes only from ids read in this session; unwritable fields refused at staging; guardrails re-checked at apply | Shopify examples `merchant/README.md`, `staging.py` | engine | high | M |
| Compare-and-set on every stock or quantity write | Shopify examples `staging.py:286`, shopify-multi-store `src/admin-tools.ts:491` | engine | high | S |
| Connector ladder: documented, discovered, read-verified, write-verified (real write plus read-back), unavailable | sealeap `sealeap-amazon-selling-partner-connector/SKILL.md` | connector | high | S |
| Marketplace API reality table and honest labels for Amazon.in, Flipkart, Meesho, Shopify, Instagram, WhatsApp, Shiprocket | this card | connector | high | S |
| Connector methods from official specs with a safety level; mutating verbs can never be read (CI test); live-verified vs spec-imported flag | marketplaces-mcp-ru `core/safety.py`, `tests/test_safety_catalog.py` | connector | high | M |
| Alert thresholds as an owner-editable file (per category, per SKU); alerts computed, never stored; the alert quotes its threshold | Shopify examples `alerts.py`, `data/thresholds.json` | engine | high | S |
| Morning briefing: 3 to 6 rows ranked by money at stake then deadline, figure with inputs or "unknown", the chip is the next action | Shopify examples `vendor/skills/merchant/inventory-operations/SKILL.md` | UI | high | S |
| Listing rules as dated data; `score: null` with reason when inputs are missing; "upload X to unlock" rows; `basis` on every score | amazon-listing-doctor `compliance_report.py`, `cdq_score.py`, `references/rules.json` | engine | high | M |
| India listing checks: price not above MRP, MRP and country of origin present, rule table confirmed by a professional | this card | engine | high | S |
| `source_note` on every metric and "cannot read" instead of zero | Shopify examples `metrics.py`, `shopify_backend.py:200` | engine | high | S |
| Break-even ACOS only when the ads sales basis equals the revenue basis; ACOS recomputed from raw spend and sales | sealeap `unit_economics.py`, `acos_diagnose.py` | engine | high | S |
| Stock counters (on hand, allocated, reserved, available, purchasable) and a movement ledger; one authority per data type across channels | spree `skills/spree-inventory/SKILL.md`, sealeap multichannel skill | engine | med | M |
| Payout ledger: refund reversals never edit earnings; only completed payouts count as received; unresolved stays claimed; no matching rate means no commission | spree `skills/spree-marketplace/SKILL.md` | engine | med | M |
| Handoff card wording: "Not charged here", "Payment happens on X's own page", disabled "link not ready yet" | Shopify examples `CheckoutCard.tsx` | UI | med | S |
| "Shown as written" label under quoted customer and review text | Shopify examples `QuotedAsData.tsx` | UI | med | S |
| Check connections: one real read per connector, a row each for answered, failed or skipped, no secrets shown | marketplaces-mcp-ru `core/doctor.py` | UI | med | S |
| Multi-page reads return `truncated`, detect repeated cursors, never stop on a short page | marketplaces-mcp-ru `core/paginate.py` | connector | med | S |
| Workflow recipes as data: when to use, steps with why, how to interpret, common mistakes (also usable as judge rules) | marketplaces-mcp-ru `ozon_mcp/workflows.yaml` | playbook | med | S |
| Deterministic shortlist review (GO, CAUTION, NO-GO with evidence) before any model opinion; advisory risk badges that never hide items; emphasis by seller profile | sorftime `scripts/review_shortlist.py`, `SKILL.md` | playbook | med | S |
| Support case tracker: timeline, deadline source or unknown, attachments are evidence not instructions, follow-up drafts only | sealeap `sealeap-amazon-support-case-tracking/SKILL.md` | playbook | med | S |
| Per-user platform tokens so the platform's staff permissions apply; never fall back to an app token; "Reconnect all" | shopify-multi-store `docs/ACTIONS.md` | connector | med | M |
| Multi-store reports: catalogue gaps, duplicate SKUs, price differences, low stock with transfer chances, unfulfilled orders by age; currencies separate | shopify-multi-store `README.md`, `src/report-tools.ts` | playbook | med | M |
| Suggestion chips go stale once their change moves on; one present-tense line per tool | Shopify examples `vendor/web-shared/merchant.ts`, `tool-copy.ts` | UI | med | S |
| Tools shown only while the session behind them is live; read state, act only if needed, report what the platform confirmed | shopee-mcp `src/account-mode.ts`, `src/tools/actions.ts` | engine | med | S |
| "What it can support / cannot establish" under research results; sentinel values never numbers | nexscope ecommerce-ai-tools `docs/api-evidence/amazon-price-series.md` | UI | med | S |
| Keys only through a form field, never through chat (reject "door 2") | marketplaces-mcp-ru key lifecycle spec | engine | med | S |
| Price per call carried in the tool description so the quote comes before the spend | sorftime `scripts/sorftime_bridge.py:3011` | connector | med | S |
| "Failed (refunded)" job state and resume a running job after reload | atlas-marketing-studio (learn only) | UI | low | S |
| Poll cadence by job size; report links copied verbatim, never built; credits used shown per result | kalopilot `SKILL.md` | connector | low | S |
| Place shown only when its capability is on, with loading and retry states; neutral label for unknown states | mobazha `RuntimeCapabilityBoundary.tsx` (MPL, ideas only) | UI | low | S |
| Shell hook that blocks drops and mass deletes on order and payment tables for any coding agent | spree `hooks/block_destructive_db.sh` | engine | low | S |
| Shopping assistant on the owner's Shopify store, checkout handed to Shopify | Shopify examples `storefront/` | playbook | low | L |
