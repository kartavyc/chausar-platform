# Private trial custody host

`PrivateTrialHostService` owns private artifact orchestration over the isolated
`PrivateTrialService`. Engine owns the public route and installs trusted ports.
There is no filesystem, key, model, connector transport, or publication implementation
in this module.

The `PrivateTrialArtifactPort` accepts only opaque identifiers and the purpose
`private-trial`. Root custody authenticates encrypted bytes before reads, measures
actual encrypted artifact bytes, and compares `expectedDigest` under its writer
lock. `null` means create-only; the digest is SHA256 of `JSON.stringify(value)`.
Fork and evaluation payloads each have an independently written encrypted issuance
binding. Caller-recomputed hashes cannot mint that binding. Reopening resolves the
binding and payloads from custody, checks current workspace/member/epoch, exact
authority and saved-request pins, and current view-specific readiness. Binding
identity is checked again after awaited payload reads.

Public `create`, `evaluate`, `read`, and `list` return summaries and authorized
evaluation receipts. They never return baseline/candidate States or raw retained
recipe inputs. Evaluation is retained once; calling it again checks and reads the
same evaluation rather than creating new receipt identities. Current failures are
refusals, including stale authority and revoked readiness. A stale private trial
can still be discarded by its currently authorized original member/epoch.

`discard` first CAS-writes a durable encrypted tombstone, then attempts bounded
payload removal. It reports the supplied measured removed bytes, tombstone bytes,
elapsed time, and incomplete cleanup identities. The tombstone remains so that a
failed deletion or restart cannot resurrect resolution. Unissued fork/evaluation
payloads from a lost CAS receive bounded cleanup; a failed cleanup remains an
unreachable custody artifact and must be included in root inventory. This is not
a power-loss or complete garbage-collection qualification.

`promotionImpact` exposes the core's complete dependency/rebuild/active-work
inventory and exact acknowledgement digest. `promote` prepares the inert proposal,
CAS-reserves the issuance binding, and calls the root-owned `promoteAtomic` port
with the exact proposal, fork and retained evaluation. Root must call
`assertCurrent(commitView)` synchronously against the commit-state view inside its
single live publication transaction. Root owns dictionary publication, temporal
producer replacement, dependency rebuilding and preserved historical receipts.
The callback returns only `{ publicationId }`. Reservations block concurrent
discard/evaluation. A thrown or unacknowledged callback remains reserved for
explicit root reconciliation, since its live commit outcome may be uncertain.
No source-only test proves the root's publication or native database behavior.

The focused host tests use an explicitly in-memory custody contract fixture. They
prove orchestration, persistence across host instances, current guards, independent
issuance checks, discard races and promotion handoff. Real encrypted disk costs,
Vault reopening, and public Engine/RPC/IPC acceptance belong to root joined tests.
All evaluations retain `isolated-source-replay`; they do not qualify vendors,
native databases, models, GUI journeys, or shared/team trials.
