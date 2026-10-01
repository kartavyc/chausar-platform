# Connected local sync, forecasts and alerts

This source checkpoint joins three independently delivered modules to the public Engine, loopback HTTP server and typed desktop request contracts. All demonstrated business data is synthetic. Source checks and public-route tests do not qualify a real connector, model, desktop GUI, hosted service or complete product release.

## Encrypted publication and writer admission

An explicitly configured `EngineOptions.sync` requires a separate `SyncWriterAdmission` bound to the exact workspace, vault and device. `FileSyncWriterAdmission` uses a dedicated local control directory and an explicit administrator review of the current state digest, authority fence, writer member and epoch, device and expiry. Grants last at most 120 seconds; no automatic renewal or takeover occurs. Missing, expired, revoked or conflicting authority opens the existing vault for reads and refuses mutations.

The writer grant differs from the transport's publication lease. A transport fence protects its encrypted head; the writer grant protects the actual Vault transaction and publication dispatch. The same cooperative process lock spans the transaction, and the guard checks expiry immediately before the authority commit. Current authenticated desktop actor, membership epoch and source grants remain required. Ordinary local use with no sync configuration retains its existing writer behavior.

Initial enrollment first persists a read-only fence-zero record with the exact state digest and observed clock floor. If the reviewed grant expires before admission, a later fresh explicit review can proceed from that record; an established missing or corrupt authority is still refused. Already accepted Vault updates drain successfully during close. Rejected volatile sync configuration changes roll back while holding the admission lock; durable Vault commits have no synthetic rollback.

`sync.writer.status` reads the current admission. `sync.writer.review` requires a closed payload containing `expectedFence`, `expectedStateDigest`, `deviceId`, `memberId`, `epoch`, `expiresAt` and a review `reason`. The trusted host supplies persistent signing keys, device identity, reviewed peer keys and the admission port; RPC cannot supply a signing key or create its own trusted actor. This checkpoint does not implement a persistent key broker, interactive device enrollment or a GUI for these controls.

The public flow is preview, exact approval and one encrypted push. Pull verifies the signed chain and restores into a separate empty staged directory. It does not replace the live vault. An explicit subsequent open is subject to the receiving device's writer admission. `sync.reconcile` reads the original retained publication expectation after a lost acknowledgement; it neither resends, resets approval, changes the receipt nor treats transport evidence as signer verification.

The concrete transport and writer control are qualified here only for cooperating local processes using real local directories. Cloud folders, different machines, remote stores and power-loss durability remain unverified. A crash between the Vault commit and admission-record commit leaves a state conflict requiring explicit recovery; it does not silently select or rewrite either copy.

## Receipt-backed forecasts

`forecasts.evaluate` fits and evaluates the delivered bounded monthly historical forecast slice using existing reconciled calculation receipts. `forecasts.get` rereads a saved evaluation with current member, source, epoch and receipt checks. It does not accept caller-supplied evidence or dispatch a model. The public test imports CSV through the actual HTTP importer, publishes the metric definition, creates five calculation receipts and evaluates horizons of one and three months. It distinguishes information available at the operational cutoff from later corrected, restated history.

These deterministic synthetic cases establish the wired path and refusal behavior. They do not establish predictive accuracy on external data, causal inference, every forecast family or a production model qualification.

## Receipt-backed alerts

`alerts.create`, `alerts.publish`, `alerts.evaluate`, `alerts.list` and `alerts.get` expose the delivered alert definitions, threshold episodes and local notices. Evaluation uses the existing guarded exact calculator. Missing or empty evidence remains uncertain; it does not automatically clear an alert. Repeated evaluation, escalation, hysteresis, clearing, corrected or retracted evidence and encrypted restart are exercised through actual imports and receipts.

Saved results are private to their current authorized owner and scope. Changed membership, source grants, definition meanings and evidence can withhold rereading or evaluation. This checkpoint does not send a message, execute an action or install a scheduler. Durable background alert scheduling and external notification delivery require their own joined and qualified flows.

## Evidence and remaining qualification

The public-route acceptance files are `platform/tests/sync-engine.test.ts`, `forecast-http.test.ts` and `alerts-http.test.ts`. The separate writer component has `sync-writer-admission.test.ts`; each delivered module also retains its own tests. The coordinator's external aggregate report pins the final checked commit and tree, includes all applicable app and semantic tests, root strict TypeScript, portable phone TypeScript, syntax/JSON and the Windows headless worker. That worker is not an Electron GUI or installer check.

Independent full-product acceptance, native UI and installer checks, live vendor and model qualification, hosted/enterprise completion, remote collaboration and release signing remain separate requirements. The dedicated security review remains blocked and unverified; these ordinary feature checks provide no overall release security-pass claim.
