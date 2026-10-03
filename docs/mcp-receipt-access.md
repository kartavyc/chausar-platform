# Current permission and exact receipt access through MCP

## Delivered join

The existing public MCP calculation path now checks every owned calculation receipt through the Engine's already configured `CalculatorService.receipt` reader. Previously the presence of `memberId` skipped that reader. The new join preserves counted/excluded row access, missing/deleted evidence refusal and current connector receipt readiness without duplicating calculator semantics or broadening source-level access to unrelated branches.

Two service-owned closed-schema tools complete the receipt access path: `open_receipt` and `list_counted_rows`. The latter requires an exact receipt digest and returns at most 100 retained counted rows. Both check current authority and full evidence on every request. Calculations include the digest with the existing exact integer minor-unit string and receipt. Repeated receipt/page reads create no additional calculation receipts or actions, and the evidence survives encrypted local lock/reopen with a fresh authenticated handshake.

This implements the missing retained-evidence portion of the full-plan four read-only requests (menu, calculation, receipt, what was counted), described in `specs/CHAUSAR-LIVE-BUILD-PLAN.md:674` and Day 9. It preserves the existing WASM scalar ABI and does not add plugin credentials or external provider access. A bare stored-scalar service registration remains compatible; row-backed receipts require a current reader. No shared Engine, Vault, calculator, analytics, root package or lockfile changes are needed.

## Baseline and ownership

- Supplied clean checkout branch: `work`.
- Checked-out base: `87c400870563b92803841d3a198cee801f7740df`.
- Read-only `git ls-remote origin refs/heads/main` returned that same SHA on 2026-10-03. No fetch, push or main mutation was performed.
- Isolated implementation branch: `slice/plugin-verified-receipt-access`.
- Before edits, `node --test platform/tests/workflows-plugins-learning-mcp.test.ts` passed 15/15 tests on the clean base under Node `v24.19.0`.
- `AGENTS.md` and `.agents/skills` were absent from the accessible checkout and ancestor workspace. Read existing plugin contracts, module ownership, current questlog and relevant full-plan clauses before implementation.
- Changes are limited to `platform/runtime/mcp.ts`, plugin/MCP acceptance tests and supporting documentation/evidence. The existing product acceptance test now expects the two additive receipt tools.

## Deterministic verification

The combined bounded run passed **74 tests, 0 failures, 0 skips**:

```sh
node --test platform/tests/mcp-receipt-access.test.ts platform/tests/mcp-receipt-public-acceptance.test.ts platform/tests/workflows-plugins-learning-mcp.test.ts platform/tests/workflows-actions.test.ts platform/tests/acceptance.test.ts
```

Evidence: [test output](verification/mcp-receipt-access-tests.txt) and [source/JSON check](verification/mcp-receipt-access-source-check.txt).

Public acceptance uses actual synthetic CSV import, encrypted experimental-file authority storage, the actual Engine and authenticated loopback `/mcp` HTTP surface. Its independently expected total is `900719925474099400` integer minor units, above the JavaScript safe integer range. An independent canonical JSON digest oracle checks the exact stored receipt. Tests cover mixed-branch sources, scoped readers, foreign receipts, source/session/member revocation, definition staleness, source deletion, bounded queries, wrong digest pins, repeated pages and encrypted reopen. They prove zero model dispatches and no business actions.

Source acceptance additionally covers missing and deleted counted/excluded facts, current reader readiness refusal, reader substitution, authority/ledger changes during verification, in-flight completion/failure after member revocation, source revocation during completion, readerless row-evidence refusal, forged/missing receipts and mismatched numbers. Refusals withhold synthetic private diagnostic messages and unrecognized callback codes. Historical superseded evidence is preserved when it remains legitimately readable at its saved knowledge cut.

`npm run typecheck` could not execute: `tsc` is not installed in this checkout/environment. No package acquisition or alternate registry route was attempted. Syntax/JSON validation is distinct from TypeScript qualification.

## Remaining qualification

This is deterministic source and synthetic public-contract acceptance, not full Day 9 or release sign-off. Per-assistant pairing, off-by-default disclosure, trust-panel send policy, GUI/activity acceptance, signed plugin trust roots/blocklists and actual outside-assistant interoperability remain tracked in the full plan. The pinned `2025-11-25` protocol is unchanged. Native database, installed-dependency TypeScript, target-platform, real provider/user-data and external-delivery qualification were not run. Dedicated security review remains blocked/unverified. No live LLM, paid service, real user data, external send, native database launch or real account/security change was performed.
