# Isolated four-slice synthetic integration candidate

This candidate starts at actual remote main `87c400870563b92803841d3a198cee801f7740df`. It imports only these verified private source checkpoints, with no cherry-pick conflicts:

| Slice | Exact source commit | Verified source ref |
| --- | --- | --- |
| Plugin/MCP receipts | `34d3db50ac8aa7188a5c07940516ab1f19541c24` | `checkpoint/plugin-verified-receipt-access-34d3db50` |
| Saved accounting responses | `d623f0cd4cff3ac1c167c4900a8c2c08350d017e` | `checkpoints/cloudchausar-accounting-d623f0c-20261003` |
| Invoice follow-up | `d6cfb28499c0317871d7e81c3c7e225dea95672e` | `checkpoint/invoice-follow-up-d6cfb284-20261003-0102` |
| Durable phone continuation | `4c86ff3e47b78e841e4f5f3fcd68fe962646d34d` | `checkpoint/phone-durable-continuation-20261003-4c86ff3e47b7` |

Transfer `1ca71782`, PGlite `1cd1591` and custom-field `4d227e3` are excluded. Parent owns authoritative main integration. This checkpoint is source integration evidence, with zero vendor qualification and no release, live model, native database, real account, recipient transport or paid action claim.

## Installed invoice contract

The trusted optional `EngineOptions.invoiceFollowUp: InvoiceHostOptions` supplies every policy value explicitly. Engine requires experimental demo mode; the host additionally requires a labelled synthetic workspace. Server, worker, renderer, dependencies and product defaults are unchanged. The host uses Engine's actual Vault and the same guarded calculator options as `calculation.run` and receipt reads. Existing connector readiness/receipt guards remain authoritative.

Engine and desktop IPC register the source contract's 15 named methods: create, consent.record, run, read, reconcile, pause, resume, cancel, approve, accept, reject, and reminder.approve/execute/reconcile/cancel under `invoiceFollowUp.`. Engine create requires the exact explicit owner and `requiresApproval: true`; goal, rupee budget, stop rules, sources, step reservations and other limits are validated by the existing host/job contracts. Source host admission also requires the explicit owner. No host enables workspace autonomy automatically. Every reminder needs explicit current simulated customer opt-in and its own exact unexpired approval.

Generic `jobs.*` and `actions.*` ID operations refuse invoice mandates/actions with `INVOICE_CONTRACT_REQUIRED`. Invoice jobs are omitted from generic job listing; the dedicated read contract performs their evidence checks. The simulated connector stays outside the generic action registry. This preserves exact owner control, no objective amendment, expiry/reservations and unresolved-reminder checks before acceptance.

Engine's trusted lifecycle invokes the dedicated scheduler. `invoiceFollowUp.tick` and `.recover` are absent from renderer/member registration. Exclusive reopening recovers interrupted invoice work/reservations before generic recovery; idle reopen does not add a recovery revision. Shutdown interrupts both runners. Generic scheduling/recovery skips typed goals installed by another runner. Phone access to invoice operations and existing companion approval/upload remain `OPEN_DESKTOP`.

## Accounting boundary

The saved Zoho reader already implements the documented `ExportReadAdapter` dispatcher/import bridge contract and the existing trusted accounting candidate builder. No new accounting RPC or production registration policy is needed. Native source time, coherent snapshot and completeness remain unavailable; Engine refuses readiness and calculations rather than using local file-read time. Synthetic subtotal/receipt tests retain their unqualified arithmetic status.

The added retained-state test rebuilds the dispatcher, registry, decoder and import bridge, rejects old issued read DTOs, freshly reads pinned original pages, and replays capture/publication without duplicating facts. It checks original page hashes, source/read links and receipt provenance, and tests file-grant/member/source revocation. This is a JSON-round-trip test-store restart, distinct from the invoice public test's encrypted Vault reopening.

Remaining accounting joins are honest source observation/snapshot evidence, reviewed native-wire-to-compiler translation with distinct hashes, exact typed accounting projection, actual semantic rights/golden/holdout admission and durable ledger anchor. The existing dispatcher also omits received-page byte accounting when in-flight grant revocation refuses delivery; refusal/no-delivery is tested, and no complete byte-receipt claim is made. Mapping supersession/quarantine replay needs a defined coordinator contract. Invoice aging has no period input, so bounded managed accounting profiles continue to fail existing period guards; this candidate does not claim qualified accounting-to-invoice consumption.

## Validation and remaining acceptance

Only installed Node dependencies are used. TypeScript is absent (`npm run typecheck`: `tsc: not found`); no acquisition or workaround was attempted. Public synthetic tests use explicit dictionary publication and source imports, exact owner/mandate/reminder approvals, loopback HTTP, encrypted reopen, existing receipt/MCP access, current revocation and signed companion refusals. Runner coexistence and source failure/recovery tests retain idempotency, budget and receipt provenance. The portable source build is unsigned and is not a native installer.

The same public Engine also installs the exact saved-accounting candidate through the existing trusted constructor. Selecting its unqualified source causes `SOURCE_NOT_READY` before invoice proof, receipt, reminder or file-reader activity. Reopen retains that stopped/uncertain attempt for explicit reconciliation. Selecting only the declared local synthetic invoice/bank sources still computes correctly in that same Engine; accounting qualification is never borrowed from those local sources.

Live channel/vendor selection, consent observation ordering and re-opt-in after STOP, qualified bank matching, product caps/expiry/day boundary and measured outcomes remain parent decisions and qualification work. Native phone/desktop/UI acceptance, native databases, hosted execution and the blocked dedicated security audit are outside this candidate's evidence.
