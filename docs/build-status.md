# Build status

Release `0.1.0-preview.1` implements a runnable local desktop architecture preview and includes the separate recovered enterprise engine. The full supplied plans are retained in `docs/specs/`; their complete production acceptance contract is not certified by this release.

## Executed evidence

| Check | Actual result |
|---|---|
| Full public-runtime factory suite | 206 passed, 0 failed, 0 cancelled, 0 skipped |
| Source syntax and JSON validation | Passed; native Node TS stripping is not typechecking |
| Independent acceptance fixture | Passed through public Engine APIs |
| Loopback HTTP | Real server, scoped sessions, concurrency, revocation and request guards passed |
| Separate engine IPC | Real child process, encrypted persistence and restart passed |
| Crash recovery and writer fencing | Real killed child processes, vault/update stale-lock recovery and concurrent single-writer acquisition passed |
| WASM plugins | Real child execution and timeout/capability refusal passed |
| Python helper | Python 3.12.14 and installed pdfplumber actually executed; exact forecast/allocation and tainted PDF extraction passed |
| Registered SQL conformance | Injected SQL executor cases passed; no native DuckDB query executed |
| PostgreSQL qualification | Disposable-configuration guard refused absent database; 0 database checks executed |
| TypeScript static checking | Not executed: compiler dependencies unavailable; CI runs it after dependency installation |
| Browser screenshots and interactive Electron checks | Not executed: automatic approval rejected browser launch as “blocked by policy” |
| Live models, OAuth accounts, Tally installation, cloud sync | Not executed; adapters remain experimental or planned |
| Native installers, publisher signing and rollback | Not executed; runtime binaries/certificates not provided; packaging fails closed |
| Enterprise connected engine | Source recovered and syntax inspected; new connected database run not executed |

`docs/evidence/factory-bench.json` records current full-suite counts and explicit production non-qualification. Historical enterprise evidence is not used as current test output. CI produces its own report on each commit.

## Release gates still open

Install pinned dependencies and generate/review the root lockfile; run strict TypeScript checking; exercise real DuckDB and a fresh disposable PostgreSQL cluster. Stage authentic vendor runtimes with an integrity inventory. Then qualify Electron startup and shutdown, windows, recoverability, platform ACLs, native keychain, installer signing, update staging and actual rollback on each supported OS.

Live-source support requires real hidden-business fixture reconciliation and upstream control totals for each system, edition, company and operation. External model quality, official CLI versions/policy, speech, provider cost reconciliation and transport one-writer semantics require separate evidence. Current drafts, sample factories and catalogue records cannot grant those capabilities.

The remaining plan scope includes qualified live write adapters, an installed OS background service, hosted phone approval relay, published sync transport and managed allowance/learning services, fully qualified finance/compliance packages, sealed multi-business benchmarks and complete signed production distribution. These are visible capability gaps, not disabled implementations described as production-ready.
