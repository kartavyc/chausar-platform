# Fresh native demo profile and provider refusal

This checkpoint addresses the two observed demo startup defects on exact base `dbc1435cb1cbfd84430894a286334dfd7f4904db` (`checkpoint/portable-ui-dbc1435-20261003`). Core fixes: `c16f90237a4cb74948bfefee596407e07c450398`; final functional code including parent temp-directory adaptation: `2177316ca116ea23f431c97c85e1add2b096400c`. Final integration and main remain with the parent. This is application regression evidence, not a security review or native release qualification.

## Launcher contract

`scripts/desktop-launch.mjs` exports `desktopLaunchEnvironment(environment = process.env, demo = false, temporaryDirectory = tmpdir())`. Pass `true` for a synthetic launch. It returns a copy of the environment with an unused `CHAUSAR_DEMO_PROFILE_ROOT`, selected as a direct child of `realpathSync(temporaryDirectory)`. It does not create that directory or launch an executable. The built-in launcher now passes its explicit demo mode to this helper. If the parent gives the child a fresh `TEMP`/`TMPDIR`, pass that same owned temporary directory as the third argument; it must be the directory the Electron child will resolve as its OS temp directory.

A parent launcher may use that helper and retain the returned root as its owned artifact path. Alternatively it may set `CHAUSAR_DEMO_PROFILE_ROOT` to an **absent absolute direct child of the physical OS temporary directory**. Do not pre-create that root with `mkdtemp`, reuse a root, or supply a real Electron profile. If the variable is absent, main selects its own unused temporary root.

`app/desktop/demo-profile.cjs` exports `bindDemoProfile(app, environment = process.env)` and `assertDemoProfile(app, profile)`. `bindDemoProfile` exclusively claims the root with non-recursive `mkdirSync`, creates `userData` and `sessionData` beneath it, sets both Electron paths, and verifies the resulting getters. Existing files/directories/symlinks refuse with `EEXIST`; invalid/non-temporary/overlapping paths refuse before mutation. The returned profile object is frozen and includes `root`, `userData`, `sessionData`, and `vaults`.

`app/desktop/main.cjs` recognizes `--demo` or packaged `chausarPreview: true` synchronously from its own package metadata. It binds the profile before `requestSingleInstanceLock()` and before `whenReady()`/session/storage startup. The worker vault path is pinned to `<root>/userData/vaults`, overriding inherited `CHAUSAR_VAULT_DIRECTORY`; main verifies the profile again before starting the worker. Binding or freshness failures stop startup. Production uses its existing profile, instance lock, database and custody manifest behavior.

The two directories are explicitly bound because Electron stores application configuration in `userData` and Chromium session/cache state in `sessionData`; the latter must be set before ready. See the [official Electron app path documentation](https://www.electronjs.org/docs/latest/api/app#appsetpathname-path).

The parent should retain the root and distinguish a spawned PID from a successfully ready engine/window. This change does not add a native readiness handshake. Clean up only that owned synthetic root after the process has stopped, if it is no longer needed for preview evidence.

## Immutable provider contract

`platform/runtime/engine.ts` captures host demo mode in a private field and supplies it after gateway option spreading on every Vault attachment. `platform/runtime/gateway.ts` captures its own private demo flag. Changing Engine/Gateway options, workspace demo metadata, routes, send policy or historical approvals cannot remove the guard.

Demo route configuration, model previews and model execution return `DEMO_PROVIDER_DISABLED` before credential lookup, budget reservation, receipt mutation or HTTP/CLI transport. The same dispatch boundary covers model tests, analysis, planner/business context, continuation and synthesis. Route status does not inspect credential environment variables in demo mode. Engine speech configuration/preview/approval/transcription uses the same immutable refusal before its independent speech service can dispatch.

`platform/runtime/{server,worker}.ts` skip provider-evidence and keychain activation in demo, including trusted injected hooks. Production retains the existing admission loaders, send policy, exact one-use approval, command pinning and cost policies. The local calculator remains available for synthetic previews.

## Regression evidence

Environment: Node `v24.19.0`, Linux; no project dependency installation. `/workspace/.agents` and `.codex` are empty and the repository contains no `AGENTS.md` or `SKILL.md`. Relevant repository ownership/scope instructions were read; the delegated fixes authorize this isolated shared-runtime change.

Focused run on final functional code: **220 passed / 220 tests**, no failures, skips or cancellations. [Retained summary](demo-isolation-dbc1435-20261003-focused.json). Command:

```sh
node --test --test-concurrency=1 \
  platform/tests/desktop-demo-profile.test.ts \
  platform/tests/desktop-main.test.ts \
  platform/tests/desktop-launch.test.ts \
  platform/tests/desktop-ipc-methods.test.ts \
  platform/tests/desktop-runtime.test.ts \
  platform/tests/demo-provider-isolation.test.ts \
  platform/tests/gateway.test.ts \
  platform/tests/conversation-gateway.test.ts \
  platform/tests/conversation-planner.test.ts \
  platform/tests/conversation-synthesis-gateway.test.ts \
  platform/tests/codex-cli.test.ts \
  platform/tests/codex-cli-host.test.ts \
  platform/tests/codex-cli-host-entrypoints.test.ts \
  platform/tests/speech.test.ts
```

The new profile tests execute actual CommonJS source in VMs with fake Electron/filesystems, including Linux and Windows path semantics. The new provider tests execute actual Gateway/Engine/host source with authored fake ports and confirm zero provider, credential and default filesystem effects in demo. Existing Codex host production tests now mock the PostgreSQL connection boundary with synthetic fresh encrypted-file snapshots; the production storage policy itself is unchanged.

`node scripts/check.mjs` passed syntax and JSON validation for **531 source files**. `git diff --check` passed. `npm run typecheck` could not execute: `tsc: not found`. TypeScript is absent, as are Electron, electron-builder, `pg` and `@duckdb/node-api`; no compiler/dependencies were acquired. Typechecking and dependency-backed native checks remain unavailable here.

The single full open-suite attempt used core-fix commit `c16f90237a4cb74948bfefee596407e07c450398`, `node --test --test-reporter=tap --test-concurrency=1 platform/tests/*.test.ts`, and a 600-second deadline. Only PATH/SystemRoot/WINDIR/TEMP/TMP/LANG/LC_ALL were inherited; provider, credential, accounting-artifact and Python settings were omitted. It hit that deadline while running `workspace-activation-postgres.test.ts`, after emitting **2,583 top-level results**, and produced no final test summary. It is **incomplete and red**, not a full-suite pass. [Retained diagnostics](demo-isolation-dbc1435-20261003-open-suite.json) contain 148 immutable demo-provider refusals, five demo-keychain activation expectation failures, 35 unchanged Windows-owned-root requirement failures, and two failed-subtest containers. These are retained diagnostic counts, not final whole-suite test totals; the run also emitted dependency-related skips.

Older provider-dispatch fixtures use `demo: true` as a storage shortcut and conflict with immutable demo refusal. Relevant direct test files include conversation turns/synthesis, Codex Engine, conversation calculation, business-context HTTP, phone public join, desktop harness and renderer worker journeys; shared phone/comparison/calculation acceptance fixtures have the same dependency. Existing demo keychain factory tests also expect custody injection that this synthetic composition now omits. Frozen acceptance fixtures and evidence remain intact. Their production provider/custody journeys need separate synthetic production adapters, rather than a demo bypass.

The 35 census failures are in unchanged `postgres-transfer-native-census.test.ts`: its unchanged helper requires `C:` owned scratch roots and its NO-START lifecycle requires `C:` run roots, so Linux `/tmp` fixtures refuse. Their test/census/lifecycle blobs match the base exactly (`59987026f22ba73a295ea33f1e58f3c3eff10652`, `40438c89b41f8466def303ee0d2b762fd57197a3`, `c6d551faad048fd8995344945fc9c0e4d1268347`). No guard was changed and no PostgreSQL process was launched. The final temp-directory adaptation was then checked by the complete focused run above; the full suite was not repeated.

## Independent code review

Fixed point: `dbc1435cb1cbfd84430894a286334dfd7f4904db`; reviewed core code: `c16f90237a4cb74948bfefee596407e07c450398`. Two independent agents reviewed Standards and Spec in parallel using the delegated task as the concrete spec. Both also reviewed the small `c16f902...2177316` parent-temp adaptation and reported no material findings.

### Standards

Documented violations: none. The diff respects authorized module ownership and preservation, labels synthetic fixture boundaries, and exercises actual Engine/RPC composition. No material heuristic code smell requires a change.

### Spec

Functional findings: none. Fresh profile binding precedes instance lock/storage; immutable provider refusal covers later model paths; production consent/admission remains intact; package and frozen evidence are unchanged. The reviewer independently ran **37/37 passing** profile/main/provider/launcher tests with source/VM/fake boundaries.

Findings: Standards **0**, Spec **0**. Native Electron acceptance remains outstanding.

## Preservation and remaining acceptance

Root `package.json` is unchanged at blob `82e71a3cc8a570d651ccb002c72fd3d4fa26730e`. Existing native qualification documents, source manifests, UI acceptance evidence and original checkout are unchanged. No main branch edits, Electron/Chrome/PostgreSQL/native credential-helper launch, real profile/credential access, package acquisition, security-setting change, CI rerun or billing action occurred.

The parent still needs first native acceptance on the intended host: confirm the bound user/session/vault paths and isolated process readiness, render the preview and legacy transition, exercise local synthetic calculation, confirm provider refusal after configuration/test/planner/synthesis actions, and stop the process cleanly. Existing native/database evidence is historical and is not inherited by this changed source. Signing, production providers and a broader security review are outside this task.
