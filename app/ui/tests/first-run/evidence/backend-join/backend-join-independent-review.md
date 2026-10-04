Independent review passed the canonical first-run controller in the direct actual Engine scope: **14/14 independent probes and 93/93 selected Node tests passed**. The earlier six guard-reentry failures are fixed. Shared desktop integration remains unqualified, and the full root strict compile has **seven current blockers**.

Reviewed checkout: `first-run-cas-join`, HEAD `0eb8edc6a3670b7745bcd2c92ee775725f003c65`, based on backend `52d1226f0eac6bfd18d7b68074b44b2d42a33bc0`. Source hashes stayed unchanged before and after the independent runs. Full commands, stdin programs, outputs, source hashes and separate prior-candidate history are retained in [backend-join-independent-review.json](backend-join-independent-review.json).

| Reviewed file | SHA-256 |
| --- | --- |
| first-run/controller.ts | `b65a55e5a8ae44e0462d4efed18df97a4862bed156885475b3257eadbf1e0664` |
| first-run/contracts.ts | `bfe37efd5f87a7dc39f78369e27094fb424a16c69bf9c3c09859095cbdefbe7d` |
| tests/first-run/controller.test.ts | `edbd042d48b4be0219a281751e66b1a06bdce103d665ff595d96998091db698e` |
| platform/runtime/ontology.ts | `35419b3b65f39506f08e73d1167ec1f1440dab9ad37c909ec577d7728e9ffede` |

The current verdict follows a fresh rerun of all fourteen independent probes and all 93 selected Node tests on canonical owned-source bytes. Independently reading the seven preserved raw files proves that removing only each CR byte immediately before LF yields the current bytes exactly. All nine owned source paths equal their staged Git bytes; the two actual Engine fixture/test files already had identical bytes. The checker and compiler rules were unchanged. The prior passing controller hash `23cd01df0e90e81e3fbcf898401829d8329d4a1694cf226f8b914a5680119230` and its 14/14 + 93/93 results remain in byte-identical `backend-join-independent-review-before-canonical.md/json` archives, separate from the older failed guard candidate. Full comparison results, raw/staged hashes and preserved archive hashes appear under `canonicalByteVerification` and `preCanonicalQualificationHistory` in the JSON.

The independent commands ran from the reviewed checkout. Three literal PowerShell stdin programs invoked `node --input-type=module`; their exact commands are in the JSON. They passed these six receipt/CAS probes:

- Missing attempt key and explicit null after an actual committed lost reply both retain unknown status, the same private identity, and the unresolved fence. Neither permits a replay.
- Forging a historical compiled definition hash and recomputing its artifact and dictionary hashes still fails the definition-binding proof. Restoring trusted readback recovers the same attempt without another publish.
- Reversed draft property order survives review, dispatch and the Engine receipt digest exactly. A changed-pack pin issues nothing.
- An actual competing commit yields source `DICTIONARY_CONFLICT`, classified as a definite raw-call refusal. An explicit later press detects the changed context and issues nothing.
- A later actual lookup refusal remains unresolved and cannot prove the earlier publication did not commit.

Eight lifecycle cases also passed: initial and final load guards, and initial publication and settings-departure guards, each synchronously cancelled or invalidated the controller and returned true. Every call refused with `READ_INVALIDATED`; state stayed neutral, settings admitted no draft, and publication issued nothing. Targeting used actual state and request checkpoints, not a fixed guard call index.

At prior controller hash `1a9b00331f0f3752326d0312789805731af9a2592a62924921431dfd7c46e822`, final load guards restored choose context/packs, initial publish guards dispatched after departure, and settings guards admitted the old private draft. Both cancel and lock variants failed. Those six actual Engine failures remain under `priorCandidateHistory` in the JSON, distinct from the current passing verdict.

The additional independent command was:

```text
node --test --test-reporter=spec app/ui/tests/first-run/contracts.test.ts app/ui/tests/first-run/review.test.ts app/ui/tests/first-run/controller.test.ts app/ui/tests/first-run/engine-join.test.ts
```

It exited 0 with 93 passes and zero failures. The actual Engine fixture forwards `Engine.requestAs` and uses encrypted experimental-file Vaults containing synthetic data in verified Temp children. The source tests also cover all eight receipt bindings, retained historical commitment without current Continue, queued accepted updates with null lookup, exact replay without a new write, actor/epoch authority, nonnull-baseline version-2 cancel/lock/reopen retention, and changed pack pins. The checked nonliteral import isolates the strict UI test graph; it does not establish a full backend strict pass.

Read-only inspection of root-owned final logs confirmed UI strict and test strict exit 0, 139/139 combined Node passes, 13/13 inventory passes, 24/24 React tests, syntax/JSON checks for 620 files and source-check exit 0, all pinned to the same frozen controller. The current inventory is canonical LF at `71f9d7ea1481625e959860036a966ba5b73565ed9be6748e1eed87ae1f26d77b`; the shared checker is the previously qualified canonical source at `ddfbdff01b4b02353769a6a5b3b888bd7ecd8c6a9074203b29190dbe2a4dbe1f`. Earlier raw CRLF checkout bytes are not the current inventory qualification.

Fresh root-owned full compilation ran `node ./node_modules/typescript/bin/tsc --noEmit --project tsconfig.json --skipLibCheck false --incremental false` on the same source at 09:20:06–09:20:31 UTC and exited **2**. The [final root strict output](backend-join-final-root-strict.txt) still reports:

- `ontology.ts:47:59` TS2551: number has no value property.
- `ontology.ts:137:47` TS18046: history is unknown.
- `ontology.ts:257:42` and `:257:58` TS2339: draft/pack are not narrowed on the request union.
- `postgres-transfer-independent-native-probes.ts:4:60` TS2307: pg module/types unavailable.
- The same fixture at `:106:40` TS7006: client implicit any; `:116:10` TS2571: object unknown.

These are current compile blockers, not only historical diagnostics. No omitted files, relaxed strict setting, cast suppression or acquisition was used to turn that result into a pass.

Both shared sanitized allowlists have zero intersection with the complete fourteen-code `ENGINE_DICTIONARY_REFUSALS` set. The exact required additions to both `app/desktop/preload.cjs` and `app/ui/src/bridge/client.ts` are:

```text
INVALID_DICTIONARY INVALID_CURRENCY INVALID_GST_MODE INVALID_FIELD
INVALID_DEFINITION RESERVED_MEASURE UNKNOWN_PACK COMPILED_SUM_INVALID
INVALID_DICTIONARY_OPTIONS INVALID_DICTIONARY_RECEIPT
DICTIONARY_REVIEW_REQUIRED DICTIONARY_CONFLICT
DICTIONARY_ATTEMPT_REUSED DICTIONARY_ATTEMPT_AUTHORITY
```

IPC already registers the ontology methods and its public uppercase error filter preserves those codes. Preload and the renderer currently replace them with `REQUEST_FAILED`. The controller safely retains uncertainty on that generic code; direct Engine evidence therefore cannot claim desktop definite-refusal parity.

Parent mounting still requires a dedicated restricted four-method port that preserves exact CAS/attempt payloads and sanitized codes; the ordinary guarded request rejects the legitimate publication contextKey change. Mount first-run before eager Today refresh and forced Today routing, outside the standard main landmark. Retain one controller across remount, invalidate on lock/revocation and cancel on departure. Subscribe to issuance and treat Today/Saved as possibly stale from dispatch. Supply controlled language/view, honest stages, explicit destinations and immediate one-shot admission with a final parent authority check. Preserve all four not-configured handoff fields. Fresh first-run workspaces must use explicit deferred creation; omitted dictionaryMode still takes the legacy publication path.

The reviewer edited no repository files, refs, dependencies, shared host settings, other worktrees or old evidence. Only these two external review files were created. Existing fixtures created and cleaned bounded synthetic Temp data. No native/browser/Electron/PostgreSQL/service/provider execution, acquisition, credentials inspection or author CLI was performed. No live host, pixel, accessibility, native Hindi or font qualification is claimed.
