# Connector and semantic gate join

Historical alignment: the standalone lane reviewed connector-framework commit `af089b75de85b8a07025f29970f609449aefc338`, branch `codex/shared-connectors-20261001`, without editing that sibling worktree. Parent subsequently integrated the shared runtime. The current implementation is in `platform/runtime/engine-connectors.ts`, `engine-semantic.ts` and `semantic-translation.ts`; its qualification remains limited to explicit synthetic profiles.

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

These callbacks are injected engine code, with no permissive defaults. They are not functions accepted from a mapping pack or uploaded file. The standalone helper does no persistence, acquisition, SQL or write dispatch. The current `EngineSemanticService` implements the callbacks from Engine-owned custody, capture, review, evidence and anchor records. `EngineConnectorService` rechecks current access, profile qualification and capture bindings around the publication transaction; a missing semantic port refuses publication.

The gate verifies ledger custody, exact qualified measure membership, company/branch/period/source-receipt/snapshot/fingerprint equality, profile equality, current rights and evidence, current source readiness, retained anchors and expiry. It returns `permitted`, a `synthetic-tested` or `unqualified` level, `bindingHash`, `semanticEvidenceId`, `measure`, trusted `checkedAt`, reason codes and fixed `liveVerified: false` / `writebackQualified: false`. It cannot promote synthetic evidence into sandbox/live support or create registry evidence/attestations on its own.

Both integration stages are implemented for synthetic profiles. `EngineConnectorService.publish` installs the synchronous `CursorImportService.beforeInsert` hook immediately before fact insertion. The hook calls `EngineSemanticService.beforePublish`, which checks rights, exact source custody, independent controls, golden/holdout cases and runtime projection, then retains the operation ledger, a separate Engine-owned head/binding/proof anchor and the connector semantic proof in the same state transaction as the facts. Asynchronous admission is refused. After publication, connector consumer readiness requires both `CursorImportService.assertReady` and `EngineSemanticService.assertReady`; the latter verifies the retained evidence and anchor, current authority/dependencies, published projection and exact requested measures through this gate. The standalone post-publication helper remains distinct from the pre-insert hook.

The semantic evidence contract is `OperationEvidence` in `src/contracts.ts`: exact company/product/operation/period/currency/snapshot scope, compiler version/source-build hash, pack/rules/ontology/schema fingerprints, original source row receipt/hash, independent report identity/hash, rights/provenance manifest hash, whole-business/template/configuration split hash, independent golden row/operation hash, exact decimal values, counted source rows, exclusions/controls, issues/clarification, and hash-chain identity/previous link. The corresponding current-dependency schema is `CurrentSemanticDependencies`. No raw mapped fact alone can substitute for this evidence.

Exact translation is implemented as an opt-in installed profile in `semantic-translation.ts`. It reruns the reviewed translator on retained raw-backed decoded rows at publication and readiness, binds the implementation/configuration and separate wire/decoded/compiler schema and row hashes, conserves rows through explicit bijective lineage, and anchors the translation digest with semantic evidence. The runtime projection separately checks identity, date, scope, net/tax/currency, units, quantity and refund links. Its current supported projection requires safe integer quantities, no exclusions and no inferred FX; broader decimal quantities or accounting semantics require a supported contract, not silent coercion or flattened controls.

The original standalone gate tests used injected synthetic host verifiers; that historical limitation does not describe the integrated Engine implementation. Real-source custody, authenticated upstream controls, external corpus admission and native vendor qualification remain unqualified. Engine-owned local hashes and retained anchors do not establish publisher signatures or secure independent append-only storage. Native phones remain remote companions with cached briefs; this module supplies no on-phone engine or phone approval path.
