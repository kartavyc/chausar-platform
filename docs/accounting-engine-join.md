# Accounting Engine join: retained candidates, certified admission refused

This join starts at integration baseline `0424ce11da4e8a6ad1f911adb3c5deadabeaede6` and imports only the verified standalone accounting slice `39d15618baf91684c72d0718b5c5c52da9131167`. The supplied patch SHA-256 is `57e3ff728a4d20a61dab7375ae3476633d6c0e97f2d2824a8033f91d63b391d8`. No files from the later `143d08a` continuation were mixed in. Historical accounting documentation and `accounting-validation.json` describe the standalone slice; they are not current release or vendor certification evidence.

The imported native acquisition/parser families are Tally XML, Zoho Books, QuickBooks Online and Xero. TallyPrime 7 native JSON remains envelope-only and refuses accounting mapping with `TALLY_NATIVE_JSON_MAPPING_UNQUALIFIED` until readable source schema exists. This join changes no shared Engine, framework, semantic package, catalogue, dependency, renderer, desktop or phone source. It installs no credential, provider transport, write operation or qualification evidence.

## Host registration interface

The barrel `platform/runtime/adapters/accounting/index.ts` exports `createAccountingConnectorCandidate(config: AccountingEngineRegistration)` from `engine-registration.ts`. The configuration is the existing `EngineConnectorProfile` contract, with `readOperation` derived from the installed native reader, the decoder supplied as `AccountingDecoderConfig`, and an explicit data-only mapping proposal:

```ts
type AccountingEngineRegistration = Omit<EngineConnectorProfile, 'readOperation' | 'decoder'> & {
  decoder: AccountingDecoderConfig;
  mapping: {
    id: string; currency: string;
    eventTypes: Readonly<Record<string, string>>;
    statuses: Readonly<Record<string, string>>;
  };
};
```

The host supplies the actual native reader/parser, observed native wire fingerprint, independent exact read/import implementation digests, company/organization/dataset/one-branch domain, resource/version/edition/configuration, selected amount measure, reviewed currency precision map, content types and explicit freshness policy. Synthetic registrations require `environment: 'synthetic'` and `syntheticFixture: true`. The builder refuses mismatched read/import product applicability, decoder/company/domain drift and silent synthetic labels. It selects no business event, status, date, tax, currency, company, branch or write-back policy.

The result is `{ profile, proposal, admission }`. `profile` is an ordinary `EngineConnectorProfile`; `proposal` still requires real owner mapping review. `admission` always says `semanticQualification: 'unqualified'`, `ready: false`, `liveVerified: false`, `writebackQualified: false`. It is a list of unresolved integration dependencies, not a semantic decision or proof.

Root can install the candidate through the existing trusted constructor interface, without adding any RPC-installable code:

```ts
const candidate = createAccountingConnectorCandidate(hostAccountingConfiguration);
const connectorRuntime: EngineConnectorOptions = {
  profiles: [candidate.profile],
  registry: actualHostRegistry,
  clock: actualHostClock,
  authorizeRead: actualCurrentReadGrantResolver,
  semanticGate: actualTwoStageSemanticGate,
};
// EngineOptions.connectorRuntime receives this object.
```

Definitions and evidence must be independently registered for exact read and import operations. The candidate builder registers neither. Do not copy the test registry, transport, grants or authored fixture assertions into a production host. Existing actual semantic rights/case/golden/holdout admission and independent durable ledger anchors remain mandatory before fact insertion and again at consumer readiness. An absent or incompatible gate remains a refusal.

## Existing public methods

No new RPC methods are needed for registration. The installed consumer retains its existing named contracts:

| Method | Payload |
| --- | --- |
| `connectors.profiles` | `{}` |
| `connectors.read` | `{ profileId }` |
| `connectors.reviewMapping` | `{ profileId, recipe, evidence: { reportId, sha256 } }` |
| `connectors.capture` | `{ acquisitionId, reviewId, recipe, idempotencyKey }` |
| `connectors.publish` | `{ profileId, captureId, sourceTotals }` |
| `connectors.ready` | `{ profileId }` |
| `connectors.captureStatus` | `{ profileId, captureId }` |
| `connectors.releaseRead` | `{ acquisitionId }` |

The consumer's current payload allowlists, bounded read bytes/custody, same-owner acquisition, current grants, source/reviewer access and exact version/generation fences stay authoritative. These RPC payloads cannot install a parser, endpoint, credential grant, registry entry, semantic dossier, ledger head or approval. `calculation.run`, `conversation.ask`, reports and typed jobs use the shared readiness guards.

The executable public HTTP test installs the actual candidate into Engine, lists its unqualified fixture profile, refuses unqualified read before transport (`CONNECTOR_DEFINITION_UNQUALIFIED`), and refuses both `What was billed?` and `calculation.run({operation:'billed'})` with `SOURCE_NOT_READY`. It verifies zero new facts, receipts and transport calls. A separately installed synthetic read definition exercises the actual Zoho reader; the public consumer then refuses its honestly unknown source time with `CONNECTOR_SOURCE_NOT_CURRENT`. No provider timestamp or snapshot is invented to continue.

## Capture evidence inspection, not semantic admission

`inspectAccountingSemanticCapture(context, input: ConnectorSemanticInput, clock: ReadClock)` is a synchronous read-only trusted-host helper. It accepts the actual five-field semantic decoder descriptor (`id`, `version`, `schemaSha256`, `identityNamespace`, `definitionHash`), authoritative persisted framework capture and read link. It checks current caller/acquisition owner/source/branch/reviewer access, recipe and dictionary identity, current exact registry definitions under the installed clock, native page hashes and counts, decoder re-execution and retained row equality. Informational `input.at` cannot override the host clock.

The result preserves original page SHA-256, native observed wire schema SHA-256, decoded row hashes, original source time/snapshot/completeness and all 16 decoded custody fields including the full serialized accounting record. It sets compiler schema/rows hashes to `null` and keeps readiness/semantic qualification false/unqualified. It inserts no rows, facts, semantic records, ledger or anchor. Inspection does not grant redistribution, training, qualification or vendor account access.

The existing framework synthetic subtotal-to-billed receipt test remains an explicitly unqualified arithmetic/custody demonstration. It does not use a certified Engine path: the fixture has unknown source snapshot/time and the framework's `assertReady(..., true)` refuses it. The real Engine semantic adapter with no accounting dossier also refuses this native fixture (`SEMANTIC_DOSSIER_REQUIRED`). No qualified semantic fixture port or fallback was supplied.

## Shared extension contracts still required

Root owns these boundaries; this join does not edit them or select their product policies:

1. **Native acquisition evidence.** Stock native adapters correctly preserve unknown source clock/snapshot. Zoho, Xero and Tally currently admit `branches: ['all']` without a period. QuickBooks transaction profiles can pin an explicit posting-date period; account profiles cannot. A derived publication period/branch is separate reviewed provenance, not permission to relabel the acquired native scope. Real completion/current snapshot/observation evidence must precede certified readiness. Capture time, response time and caller assertions are not replacements.
2. **Distinct wire and compiler schemas.** The native decoder has 16 custody fields, while a semantic pack has explicit identity/kind/date/amount/tax/currency/status/company/branch/registration/quantity/unit/link bindings. Those 13 roles are commonly represented by the authored 14-field synthetic-register schema; neither field count nor that fixture is an accounting schema. `EngineSemanticService.#source` currently requires compiler rows to equal captured decoder rows and compiler schema hash to equal the native wire fingerprint. A future explicit reviewed translation contract must bind native page hashes, decoder/configuration definition, captured decoded-row hash, translated SourceBatch rows/schema hashes, company rules and semantic mapping fingerprint separately. Hashes must not be substituted for each other.
3. **Exact semantic/runtime projection.** The stock mapping is a custody proposal; it does not map tax, quantity, unit, registration or refund/related links. A reviewed product/configuration-specific translator and runtime recipe must preserve those controls, native subtype/direction/status, line/allocation meaning, company scope and independent net/tax/gross totals. No missing value becomes tax zero, quantity one, a settlement or an earned event. Invoice dates remain invoice dates.
4. **Full intended accounting types.** Current semantic runtime projection refuses exclusions and only accepts safe whole-number quantities; source-report joining requires currency scale two. Accounting custody retains fractional quantities, source draft/void states, balances and explicit precision zero through six. Supporting them requires exact typed runtime/compiler joins and exclusion lineage, not dropping rows, rounding values or forcing scale two. The intended accounting scope is not reduced by these current limits.
5. **Two-stage actual qualification.** The framework now has the synchronous `beforeInsert` hook, already consumed by Engine's actual semantic gate. Rights admission plus `qualifyCase`/independent golden/disjoint holdout must finish in that draft before insertion. Persist genuine operation evidence and a separate durable hash-chain anchor; then verify actual gate decisions, current access/reviewer/registry/clock/custody/readiness/mapping/compiler/dossier dependencies before every certified calculation and receipt release. Sandbox/live/native vendor qualification is absent here; the current concrete Engine semantic adapter qualifies authored synthetic cases only.
6. **Vendor/legal/organization evidence.** Named operations still require readable exact resource schemas, versioned actual-account samples, authorized organization custody, independent source reports and applicable rights/consent. The historical Zoho refund-list slice is not the excluded follow-up's corrected source profile. QuickBooks broader OAuth scope does not add any local write capability. No final write-back set or live transport was selected.

## Joined validation

The seven accounting test files pass **106/106**, zero failures/cancellations/skips, with serial file concurrency in approximately 3.29 seconds. This includes the historical 99 accounting tests and seven new host registration/custody/refusal tests. The fixture dictionary now uses each authored scenario's explicit currency, so the Xero direction test reaches its intended unmapped-value refusal instead of first failing on an accidental INR/NZD mismatch. This changes no production currency or FX policy.

Strict TypeScript 5.9.3 passes against baseline `tsconfig.json` using the existing read-only dependency junction. No dependency/download/install command or D: write was used. Root's broad 878-test checkpoint was not rerun concurrently. Evidence logs are `task/integration-checks/accounting-join-targeted.tap` and `typecheck-accounting-join.log`; they are lane validation, not release or end-to-end vendor qualification.

All 24 authored native fixture SHA-256 values match the historical manifest. The worktree fixture bytes were restored to the committed LF form declared by their local `.gitattributes` before the final focused run, preserving custody hashes across Windows checkouts.
