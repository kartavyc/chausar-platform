# Connector and semantic gate join

Read-only alignment against connector-framework commit `af089b75de85b8a07025f29970f609449aefc338`, branch `codex/shared-connectors-20261001`. The sibling worktree was not edited. Parent owns all shared wiring, persisted custody, current authorization and database integration.

The exact executable gate schema is exported from `src/publication-gate.ts`:

```ts
evaluateConnectorSemanticGate(
  request: ConnectorSemanticGateRequest,
  host: ConnectorSemanticGateHost,
): ConnectorSemanticGateDecision
```

`ConnectorSemanticGateRequest` has exactly `binding`, `ledger`, `expectedHead`, `measure` and `evidenceId`. `measure` is the semantic calculation (`earned`, `billed`, etc.); the connector's acquisition and import operation IDs are independent.

`ConnectorSemanticBinding` has exactly:

- `contractVersion: 1`, `workspaceId`, `sourceId`.
- `readScope`, `importScope`, each mirroring the sibling `ConnectorOperationScope`: connector ID/version, operation ID/kind, transport, application version/edition/module/configuration/deployment profile, optional region. Acquisition is read/export/guided-export; import is file import. Writes are refused.
- `readDefinitionDigest`, `readEvidenceDigest`, `importDefinitionDigest`, `importEvidenceDigest`, `importImplementationDigest`, `recipeHash`, `semanticMappingFingerprint`.
- `captureId`, positive `generation`, `reviewId` and `decoder: { id, version, definitionHash, schemaSha256, identityNamespace }`.
- `domain: { company, dataset, branches, period: { from, to } }`. The logical connector dataset is separate from `datasetManifestId`, which identifies the exact corpus/artifact admission.
- `datasetManifestId`, `sourceReceiptId`, `sourceRowsHash` and nonempty `originalPageHashes`.
- `snapshot: { kind: 'source-snapshot', id }`, canonical UTC `sourceObservedAt`, `at`, `expiresAt`, and `minimum` (`synthetic-tested`, `sandbox-verified`, `live-verified`). The latter two are refused by this prototype.

Every digest is lowercase SHA-256. Raw page hashes preserve original acquired bytes; `sourceRowsHash` separately fingerprints exact decoded records. Do not substitute a decoded-row hash for a native page-byte receipt, or the semantic schema hash for a differently defined decoder schema fingerprint.

The mandatory trusted engine host supplies:

- `now()`: current engine time. Expiry and registry evidence are evaluated against this clock, not a replayed payload timestamp.
- `retainedLedgerHead(binding)`: the independently persisted semantic ledger anchor. A caller-supplied, rehashed ledger/head never establishes qualification. The anchor is checked before and after evaluation.
- `verifyCustody(binding)`: verifies the in-process read issuance seal or parent-owned persisted custody, original byte receipts, capture/generation, source/domain/snapshot, decoder, owner review and the reviewed baseline recipe-to-semantic-fingerprint link. It returns `{ bindingHash, verified: true }` only for that exact frozen binding. DTO booleans, source text and deserialized JSON cannot implement this verifier.
- `assertCurrentAccess(binding)`: rechecks current workspace/source/company/branch grants and reviewer authority, returning `true` only on success.
- `assertCaptureReady(binding)`: calls `CursorImportService.assertReady(ctx, sourceId, domain, true)`, then returns `true`. It blocks unresolved overlapping quarantines, incomplete publication and unverified snapshot consistency.
- `qualification(scope, trustedNow)`: checks exact independent current read/import registrations and capabilities with registry `assertDefinition`/`assertCapability` at the required actual environment. It returns current permission/level and definition/evidence/implementation digests; registration alone is insufficient.
- `currentDependencies(binding, evidence)`: resolves current mapping/schema/row-set/snapshot/report/rights/split/golden hashes from trusted storage. Source rows cannot supply this result.

These callbacks are injected engine code, with no permissive defaults. They are not functions accepted from a mapping pack or uploaded file. The helper does no persistence, acquisition, SQL or write dispatch. Parent must use the same authorization/fence snapshots across async work and recheck the gate around consumer result publication as required by its engine contract.

The gate verifies ledger custody, exact qualified measure membership, company/branch/period/source-receipt/snapshot/fingerprint equality, profile equality, current rights and evidence, current source readiness, retained anchors and expiry. It returns `permitted`, a `synthetic-tested` or `unqualified` level, `bindingHash`, `semanticEvidenceId`, `measure`, trusted `checkedAt`, reason codes and fixed `liveVerified: false` / `writebackQualified: false`. It cannot promote synthetic evidence into sandbox/live support or create registry evidence/attestations on its own.

There are two integration stages. First, run rights admission and `qualifyCase` on the fenced complete decoded source before inserting newly qualified facts; parent must wire this into cursor validation/publication. Second, after publication, require both the framework's `assertReady` and this helper before certifying query/answer readiness. The current sibling `assertReady` requires a published capture, so this helper alone is not a pre-insert hook and does not stop the existing sibling `publish` method from inserting facts. That shared publication extension remains a parent task.

The semantic evidence contract is `OperationEvidence` in `src/contracts.ts`: exact company/product/operation/period/currency/snapshot scope, compiler version/source-build hash, pack/rules/ontology/schema fingerprints, original source row receipt/hash, independent report identity/hash, rights/provenance manifest hash, whole-business/template/configuration split hash, independent golden row/operation hash, exact decimal values, counted source rows, exclusions/controls, issues/clarification, and hash-chain identity/previous link. The corresponding current-dependency schema is `CurrentSemanticDependencies`. No raw mapped fact alone can substitute for this evidence.

The existing fixture ontology and sibling importer's integer-quantity/currency/recipe assumptions require explicit translation into the parent compiler's normalized contracts. Do not silently coerce decimal quantities, flatten per-kind/currency/tax controls into one amount or infer FX. No cross-lane end-to-end acceptance or real-source custody verifier was run here. Gate tests use explicitly injected synthetic host verifiers only. Native phones remain remote companions with cached briefs; this module supplies no on-phone engine or phone approval path.
