# Integrated changes after the requirements assessment

The detailed ledger is an evidence snapshot at `3160d5a896b5fb3539405948671d530367cfe30d`. Historical source/evidence links in its index pin that commit. The records deliberately retain partial/missing/unverified scope rather than infer full acceptance from later framework changes. This file records subsequent integration progress until each affected requirement is reassessed with exact new evidence.

## Committed lane imports

- Durable jobs: source `48cf6a248b220f7d3502cd14d1e1ed75be06c373`, imported by committed patch onto the remote ancestry as `8c611338d4225e51e72028154b22f9db72fd25d9`. Seven paths. The producer reported 232 tests and 60 syntax-checked source files; those are producer results, not this coordinator's execution evidence or proof of product wiring.
- Connector framework: source `af089b75de85b8a07025f29970f609449aefc338`, imported as `94952b5819183046d23b125af5e58d9f8a6e3ef3`. Thirteen paths. The producer reported 139 focused tests and 67 syntax-checked source files; that does not qualify the 56 adapters or install a public consumer guard.

No uncommitted source work from either producer was imported. Their original roots and the recovered checkout remain unchanged. Source repository ownership checking was denied by Git for the jobs producer worktree; no global safe-directory or OS security setting was changed. Integration used the explicitly supplied committed patch and its declared source SHA.

## Wiring and bounded verification in progress

- Jobs Engine/RPC/lifecycle integration uses the authoritative Engine store, pinned-owner execution, release guards, exclusive-open recovery and actual registered local calculator/evidence/action-preparation ports. It requires explicit host policy settings; no active-job or price default is invented.
- A functional runner review found unbounded provider readback waits. The integration fix must add a watchdog/abort contract, preserve uncertain outcomes and reserved exposure, and prove no automatic redispatch.
- Connector public integration must install trusted host ports and semantic/decoder/custody gates, expose the read-to-publish flow, and call `assertReady` before certifying calculation readiness. Synthetic test profiles remain labelled fixtures; no external write provider is installed.
- Prove each new public flow with synthetic Engine/RPC integration cases. Standalone runner/framework unit tests are insufficient.

## Publication and release gates

The authorized GitHub capability became unavailable (`Unknown tool` from read actions). Current remote verification and publication are blocked until that capability is restored. No shell network retry is used as a substitute. Earlier baseline publication at `3160d5a` remains the last verified remote state.

Dedicated security review remains blocked and unverified. No source test count or integrated synthetic flow certifies a complete production, hosted, native or external-provider release. Legal/vendor/live access, exact write-back approval, credentials/spending and platform acceptance remain separately tracked.
