# Grounded final synthesis integration contract

Source base: `5d7575751f09367a8266c6424b54f627221d5c22`, tree `e1f59ff2646baa452026ff64dd8956059ede012a`. This published checkpoint executes local tools but has no model-authored final synthesis. The contract here is preparatory; it does not add a provider call or qualify a complete conversation.

## Ownership

Parent gateway worker `01a0f62e-3801-733e-b61c-596d5c5b1048` owns a **new** `platform/runtime/conversation-synthesis.ts` and dedicated new tests. Do not edit Engine, ModelGateway, existing planner/history, renderer, IPC, manifests, or this contract. Coordinator owns those integrations in `integration/conversation-synthesis-from5d`, worktree `task/luna-synthesis-engine`. Main and the clean published worktree stay unchanged.

The worker should return a pure JSON schema/instruction builder, strict output validator and reference materializer. It must not fetch data, run a model, approve a request, write state or grant authority. Import the types in `conversation-synthesis-contract.ts`. If an implementation needs to change the boundary, return the exact proposed adjustment to the coordinator rather than changing shared files.

## Input and output

`GroundedToolSummary` contains the exact reviewed objective plus ordered admitted tool results and bounded evidence aliases. Aliases are fresh opaque per-payload references, not source, row, receipt, member or customer IDs. Claim text retains its origin/qualification and citation aliases. Figure and scope descriptors carry labels, units and aliases; their exact values remain local. Every unknown, conflict, incomplete coverage, synthetic/unqualified evidence warning and tool error becomes a required caution. Error projection uses an approved generic code/label, not arbitrary internal error text.

`GroundedSynthesisOutput` contains natural prose paragraphs with evidence references and typed `slot` parts. Slots resolve only to admitted claim, figure or scope references; amounts, currencies, percentages, counts and dates must come from current local slots, not model arithmetic or numeric fields. Free prose must not introduce unsupported numeric assertions or upgrade owner-stated, draft, synthetic, partial or unqualified evidence. All required caution references must be retained; the host also renders their canonical local text independently. The output schema accepts no tool requests, actions, raw Markdown/HTML links, source data, undeclared fields or new authority.

Validate bounded bytes/depth/strings, plain JSON and exact keys, distinct aliases, existing references with correct kinds, ordered tool membership, citation closure, nonempty grounded paragraphs, supported slots, and complete required cautions. Refuse malformed, oversized, foreign, duplicate or incomplete references. Regression fixtures should cover money/percentage/date/count injection, Unicode and number-word variants, partial/all-error results, unknowns, conflicting and synthetic evidence, and revoked/tampered bindings. Citation membership alone does not prove that prose is semantically true; do not claim broad semantic qualification from schema tests.

The host-only `ConversationSynthesisBinding` retains canonical tool-turn/planner IDs, the exact result/input digests and exact local evidence bindings. Never include it in model messages. The materializer gets a host-installed current-text resolver, never a resolver or receipt supplied through RPC or model output.

## Existing admission hooks on the source base

- `ConversationHistoryService.get(ctx, toolTurnId)` in `platform/runtime/conversation-history.ts` resolves a canonical retained composite under current access, retention, model receipt and all successful child bindings. It does not call a provider or recalculate. Resolve through this method, never directly from `State.conversations`.
- `ConversationHistoryService.currentReceipt(ctx, receiptId, view)` checks the exact local `CalculationReceipt`, member/epoch, staleness, retention, selected source access and every retained/used/excluded row. `Figure.display` is the authoritative rendered value, with `key`, `minor`, `unit` and optional `currency` retained locally. Preserve exclusions, coverage and assumptions as cautions.
- `ModelGateway.assertConversationReceipt(ctx, plannerReceiptId, view)` in `platform/runtime/gateway.ts` checks the exact completed planning response, route/policy/grants/retention/trust/selected source/manifest and continuation bindings. Stage two needs its own equivalent current receipt guard; the planner receipt cannot authorize a second request.
- `assertBusinessContextCurrent(view, ctx, manifest, services.businessContextHooks)` and `renderBusinessAnswer(...)` in `platform/runtime/conversation-context.ts` enforce current sourced claims and readiness. A worker cannot supply qualification evidence. Preserve every unknown/conflict and the scope's `syntheticFixture`/limitations.
- Use `new ConversationHistoryService(view, existingHistory.options)` for atomic snapshot readback when saving, with all injected guards honoring that `view`. Recheck the canonical composite, planner receipt and exact child receipts at preview, dispatch, async completion, atomic persistence and saved reopen.

Existing composite history admission uses exact answer/record key sets. Do not append a narrative to the old signed composite and assume it will be admitted. Coordinator will introduce a separately signed synthesis record and current reader, binding the canonical tool turn, planning and synthesis receipt IDs, exact input/output digests and full selected source/row lineage. Saved reopen must only validate/read; it must not invoke a provider. Revoked/stale/expired/ambiguous authority withholds the narrative and its cached text.

## Consent, UI and checks

The second stage is a separate exact outbound preview and one-use approval, including the objective, any retained continuation text, claim text and derived summaries. Shape-only consent does not implicitly cover private claim text or derived business values. Do not reuse the existing approved single planner attempt, auto retry, invoke a live provider/CLI, or make a paid fallback. No additional live inference is authorized for this code lane.

Coordinator will wire the final narrative above locally rendered receipts/cautions through strict Engine/RPC and current history readback, retaining the existing continuation/revocation guards. Synthetic fixtures should exercise a real planning -> tool -> separately reviewed synthesis -> materialized answer -> receipt -> reopen flow, plus invalid/stale/failing paths. Exact calculator figures remain authoritative. Native GUI, live model inference and overall product acceptance remain unverified until their own evidence exists.
