# Independent first-run CAS / attempt join

The FR-06 / FR-08 slice is joined to backend `52d1226f0eac6bfd18d7b68074b44b2d42a33bc0` in the isolated branch `private/first-run-cas-join-52d1226-20261004-01a0ef70`. Original UI `da7da1a39116ed263d47498ed6740d863652b81c` and correction `82e0045dd17e69e70c9879e807257bc79395e81d` were cherry-picked without conflicts; their 39 historical evidence files remain unchanged. This join changes only first-run-owned files. No shared host/bootstrap/router/desktop adapter, Engine, Saved or Today file is edited.

Publication now sends the exact frozen reviewed draft, explicit current-hash CAS baseline (null for deferred first publication), and one private crypto.randomUUID attempt identity. Scoped lookup consumes exactly `{current,history,attempt}`. All eight receipt fields bind private scope/digest/baseline/version to unique verified history. A null or missing receipt cannot prove non-publication. There is no automatic retry. A historical committed receipt releases uncertainty without enabling Continue for a superseded dictionary. Entry/exit guard cancellation and locking cannot resurrect private review state or dispatch after departure. The existing seven explicit review decisions and authored recognition meanings remain intact.

## Final frozen checks

| Check | Result |
| --- | --- |
| Strict production UI and first-run test projects | Both exit 0; `--skipLibCheck false --incremental false`, original strict configs |
| Combined first-run/compiler/controller/actual Engine/catalogue/source-safety Node tests | 139/139 pass, zero fail/skip/cancel |
| React/jsdom first-run tests | 24/24 pass, original 60000ms per-test timeout, 109.59s total on canonical Git bytes |
| Inventory | 13/13 pass, unchanged raw-byte generator and ten original tests |
| Global UI source checker | Exit 0, zero findings, original pending limitations retained |
| Syntax and JSON | Exit 0, 620 source files |
| Selected actual backend source batch | 84/84 pass, including repaired demo VM bindings and retained receipt isolation |
| Independent actual Engine review | 14/14 falsification/lifecycle probes and 93/93 selected Node tests pass |
| Full root strict compile | **Exit 2, seven current errors outside this slice** |

All eight final command logs record unchanged source hashes during execution. The earlier 84-case backend batch ran while unrelated UI authoring continued; its backend files and selected backend tip remained unchanged. That distinction is recorded explicitly. The React suite asserts 2,934 reading states, exact meanings/provenance, Simple/Guided/Books preview sizes 1/2/3, both languages and six packs, and ceilings 90/120/170. Its default reporter printed the passing summary, so no new numerical maximum is claimed from that log. Earlier detailed copy matrices remain historical evidence. No timeout, copy-budget or compiler setting was relaxed.

Publication log copies normalize CRLF to LF and trim blank EOF lines; the full external raw logs remain preserved. checks.json pins both raw and publication hashes. No diagnostic or test outcome is removed.

Staging found seven changed files with mixed checkout line endings. Their exact CRLF-to-LF equivalence is preserved in [code EOL proof](backend-join-code-eol-equivalence.json), and the raw source/logs remain outside the checkpoint. All eight final commands and independent probes were rerun on canonical Git bytes. The nine changed code/document files are required to match their tested hashes byte-for-byte in the staged index; this requalification makes no source or compiler exception.

The independent review preserves six failed guard cases at the prior controller candidate as history and verifies all current entry/exit cases fixed. See [independent review](backend-join-independent-review.md), [exact programs/logs/hashes](backend-join-independent-review.json), [checks](checks.json), and [source pins](source-sha256.json).

## Current blockers and parent gates

The fresh full root compile on this backend still reports four ontology.ts type errors at 47:59, 137:47 and 257:42/58, plus three PostgreSQL probe-fixture errors at 4:60, 106:40 and 116:10, including unavailable pg module/types. [Exact diagnostics](backend-join-final-root-strict.txt). No backend repair, package acquisition, omitted source or type suppression was used. The previous six demo binding failures are historical; the selected 52d1226f source batch passes.

Both shared desktop sanitized error allowlists omit all fourteen dictionary refusal codes. They collapse them to REQUEST_FAILED, which safely remains unresolved. Parent integration must preserve the known safe codes, provide the dedicated mutation-aware four-method port, select explicit deferred creation, gate before eager dashboard/Today navigation, register the mount outside the existing main, retain one controller through remount, and wire cancel/invalidate/issuance/one-shot admission. [Narrow host handoff](backend-join-host-handoff.md) and [slice README](../../../../src/screens/first-run/README.md).

The retained-v2 backend preserves original receipt origins and refuses inherited attempt replay. Ordinary deferred create/reopen/review is supported. Fresh-owner activation of an unpublished deferred source remains deliberately unsupported pending provisioning policy. Calendar, business timezone, ordering and exact customizable pack-specific Today defaults remain not-configured; no UTC, chart, metric or accounting policy is inferred.

Initial frontend authorship remains actual installed Claude Code 2.1.286, actual claude-fable-5-1, explicit High and Fast off, with unchanged [nonsecret authorship evidence](../authorship.json) and [session settings](../claude-session-settings.json). The user explicitly authorized subsequent Codex 6.1 Sol Ultra corrections and this join. No new Claude call, substitute UI model, paid fallback, global setting or author-session interruption occurred here.

This is a private skip-CI source checkpoint. Main and the original/correction branches remain separate. Direct actual Engine tests use synthetic encrypted experimental-file Vaults in verified temporary children; they do not qualify the desktop bridge or a live installed first run. No native/browser/Electron/PostgreSQL/service/provider launch, credentials inspection, dependency acquisition or real business data was used. FR-06's dedicated image and exact Simple/Books first-run geometry are absent from retained references; native Hindi, fonts/zoom/wrapping, screen-reader/contrast, pixels and full-product journeys remain unqualified.
