# Enterprise compiler prerequisite status

Checked on 1 October 2026 against integration base
`f28edb59b8baf19daf46547bad39dab86c2b5d38` in an isolated worktree.
The strict package compiler remains blocked: exit 2, 22 diagnostics.

`src/activities.ts` imports `@temporalio/common` directly. The manifest previously
depended on its transitive installation through other Temporal packages. It now
declares `@temporalio/common` at the existing `1.13.2` pin. The package-local lock
root records that declaration; the existing package entry, resolved URL and
integrity are unchanged. This is a declaration repair, not dependency acquisition
or new verification of inherited lock provenance.

Run `npm run test:contract` from this directory after TypeScript is available.
The tests inspect actual production/script imports, including Cube's `require`
calls, for undeclared packages and check exact direct pins against the local lock.
The import contract test failed before the repair for `@temporalio/common`; after
the repair both tests pass under Node 24.13.1 with TypeScript 5.9.3. These tests
verify dependency declarations, not installed dependency completeness or runtime
acceptance. The `typecheck` command and strict compiler settings are unchanged.

The authorized, verified operator stage was
`D:/Chausar/build-tools/project-dependencies/20261001000938489`. Its engine scope
provides `pg@8.23.0`, `@types/node@24.0.0`, `@types/pg@8.15.5` and
`typescript@5.9.3`. It does not provide the following direct enterprise packages:

| Package | Existing declared pin |
| --- | --- |
| `@cubejs-backend/postgres-driver` | `1.7.29` |
| `@cubejs-backend/server-core` | `1.7.29` |
| `@temporalio/client` | `1.13.2` |
| `@temporalio/common` | `1.13.2` |
| `@temporalio/worker` | `1.13.2` |
| `@temporalio/workflow` | `1.13.2` |
| `@temporalio/testing` | `1.13.2` |
| `express` | `4.22.2` |
| `@types/express` | `4.17.21` |
| `openai` | `7.15.0` |
| `zod` | `4.6.1` |

The baseline and final compiler output are identical: 14 `TS2307` missing-module
diagnostics, 5 `TS7006`, 1 `TS7053` and 2 `TS18046`. The eight secondary diagnostics
occur where Express supplies middleware parameter types (`cube.ts`), OpenAI
supplies response item types (`model-gateway.ts`), Zod supplies the plan reason
union (`natural-investigation.ts`), or Temporal constructors narrow a caught
unknown error (`workflows.ts`). Source inspection found no independently
demonstrated defect at those sites. Actual package declarations are still needed
to determine whether any source errors remain; no clean compiler pass is claimed.
Cube packages are also runtime prerequisites even though their `require` calls
do not produce missing-module compiler diagnostics.

Reproduce the strict check from the repository root, with the verified stage
available through a local `node_modules` junction:

```powershell
& 'C:\Program Files\nodejs\node.exe' 'D:\Chausar\build-tools\project-dependencies\20261001000938489\node_modules\typescript\bin\tsc' --noEmit --pretty false --project enterprise/platform/tsconfig.json
```

Registry acquisition was explicitly denied. No package installation, alternative
cache acquisition, vendor declaration stubs, compiler weakening, connected
services or model calls were attempted. Supplying the genuine enterprise
dependency graph through an authorized operator process is the prerequisite for
rerunning the strict check and evaluating any remaining source diagnostics.
Connected acceptance separately requires the actual disposable PostgreSQL,
Cube and Temporal services described in `acceptance.md` and `runtime-contract.md`.
