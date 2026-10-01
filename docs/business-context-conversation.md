# Grounded business context conversation

The existing analytical gateway accepts only a published calculation operation and scoped selectors. Its instruction at `platform/runtime/gateway.ts:32` asks for a calculation even when a question has no matching operation; its shape vocabulary omits business and about. `Engine.conversation.ask` currently sends that plan to the calculator, or uses the calculator's narrow local question patterns. This explains the unsupported answer independently of account or model availability.

`platform/runtime/conversation-context.ts` adds a separate bounded local evidence contract. A model selects exact context-bound generic claim aliases and declared unknown categories. It supplies no prose, amounts, SQL, tools, actions or citations. The local renderer rehydrates and checks the current manifest, then renders its stored evidence text with exact local citations. Generic aliases identify categories within one pinned manifest; they are not workspace, source, customer or record identifiers.

## Root writer and reader contracts

```ts
const hooks: BusinessContextHooks = {
  assertEvidenceReady(context, refs) {
    // Installed Engine checks actual managed captures, published semantic
    // evidence, current source authority, domain coverage and freshness.
    // It returns only source identifiers whose managed gate actually passed.
    return { qualifiedSourceIds: refs.managedSourceIds };
  },
};
const manifest = buildBusinessContext(store, context, {
  sourceIds, branch, asOf, onDate, period,
}, hooks);
const shape = businessContextDisclosure(manifest, 'shape');
const samples = businessContextDisclosure(manifest, 'samples', [{ claimId }]);
const selection = validateBusinessSelection(providerTypedValue, manifest);
const answer = renderBusinessAnswer(store, context, manifest, selection, hooks);
```

The readiness example illustrates the interface; merely returning an identifier without checking its real gate is not qualification. Missing or insufficient readiness for a managed capture/binding fails with `BUSINESS_EVIDENCE_UNQUALIFIED`. Calling a void hook cannot qualify raw CSV observations. A records claim is `evidence-qualified` only when all its cited sources are managed and explicitly qualified. Raw imported record kinds are labelled observations, with no industry, product, financial-total or causal inference. Empty managed domains still require the installed hook.

The root must compose the disclosure into its tools-disabled provider body and bind the exact application payload, schema purpose, destination, route revision, original local question hash, normalized scope and manifest digest to the existing outbound preview. It must recheck context and readiness before preview admission, immediately before dispatch and before release. Existing one-attempt behavior, owner/cofounder approval, expiry, single use, budget reservation, endpoint and receipt boundaries remain required. The module does not dispatch or approve requests. `nothing` continues to deny model transfers; local authorized metadata and profile rendering need no model call.

Shape projection contains only generic claim capabilities, provenance classes and unknown categories. It omits local values, names, citation/source/workspace/customer identifiers, hashes, locators and record counts. Samples add at most five explicitly selected bounded claim text scalars, never automatic samples. The root's exact payload approval authorizes the concrete selected values; calling the projection itself grants no outbound consent.

`BusinessContextRequest` has optional `sourceIds`, `branch`, `asOf`, `onDate` and inclusive `period`. The manifest normalizes its business date and known-on cut, retains explicit synthetic-workspace status, pins the current dictionary hash plus observed content, and retains source/fact/profile lineage. Current-member role and epoch, branch and source grants, retention, tombstones, facts, source precedence, profile revisions, workspace identity/metadata and dictionary revisions determine reuse. Corrections and conflicts are selected through the existing two-clock memory path. Future-effective profile corrections preserve earlier business-date views. Conflicting permitted rows remain visible as dispute citations; they do not become supported claims. Denied source content or its existence is not described as an unknown cause.

The Engine should store the returned answer's `sourceIds`, `rowIds`, `profileIds` and `contextDigest` on its answer, model receipt and conversation records. Existing source deletion and retention then remove dependent records. Saved answers must be revalidated before reading; a digest or old citation alone grants no current access. The Engine remains responsible for its managed backup/export purge when exposing profile deletion.

## Explicit sourced profiles

`BusinessProfileService.record(context, input)` requires a declared profile field (`industry`, `products`, `customers`, `business_model`, `location`), a bounded nonfinancial value, explicit `owner-told` or `draft-assumption` origin, source, business date and optional branch/correction reference. Owner statements require current owner/cofounder authority and cannot be promoted from outside-tainted work. Drafts remain unverified and do not fill unknown categories. No default industry, business model, location or product is supplied.

The service atomically writes a typed generic conversation record and a bitemporal fact, bound by the exact fact hash. Imported text with lookalike profile fields cannot establish owner attribution. `history` returns permitted retained versions; `remove` deletes the selected sourced field/origin/branch version chain and local lineage-dependent answer/receipt records. This prevents a deleted correction from silently reviving its predecessor. Other sourced fields remain separate. Corrections retain earlier records until deletion. Values with digits, monetary symbols, percentages or spelled numeric magnitudes are refused by this nonfinancial interface; the calculator and separate sourced numeric interfaces remain the financial authority.

Workspace names are metadata. A selected dictionary pack describes published meanings; it does not establish the business's actual industry. Owner statements are attributed claims, rather than independently verified operations. The answer always exposes the manifest's remaining unknowns and unresolved conflicts, even if a selector omits them. Its bounded authorized search cannot prove universal absence.

## Requirements and acceptance boundary

This implements bounded parts of `LIVE-D01-B14` and `GAP-AGT-38` (typed sourced claims, two clocks and a small profile), `LIVE-D01-B15` (owner-told/draft assumptions and unknowns), `LIVE-D08-B07` and `GAP-AGT-28` (source and taint), `FIP-08-03/08-08` (governed claims and context), and `FIP-22-11/12/13/16/18` (authorized evidence, completeness limits, context qualifiers, claim support and scope). Source clauses are in `docs/specs/CHAUSAR-LIVE-BUILD-PLAN.md:125-126,901`, `GAP-REGISTER.md:44,63,352`, and `CHAUSAR-FINAL-IN-DEPTH-PLAN.md:855,925,2233-2279`. The mapped ledger preserves their full requirements and partial/unverified dispositions.

Exact cited text and deterministic templates establish this bounded support contract. Citation existence alone does not establish general natural-language entailment. Complete searchable conversation memory, preferences, resumption, relational follow-up resolution, knowledge retrieval, native-language review and real-model quality remain separate full-scope work. This module does not reduce those requirements or certify the native route, third-party connectors, hosted services, release security or deployment.

Focused synthetic fixtures exercise value-free shape and explicit samples, unknown/tampered selections and citations, current branch/source/epoch cuts, stale definitions/workspace/facts, retention/conflicts, managed readiness, owner/draft bitemporal history, financial/model-narrative refusal and a real experimental encrypted Vault reopen. No live provider or native GUI is exercised.
