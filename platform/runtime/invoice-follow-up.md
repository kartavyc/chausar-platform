# Bounded invoice follow-up source contract

`InvoiceFollowUpHost` composes the existing `JobService`, `DurableJobRunner`, calculator and `ActionService`. It installs an `invoice-follow-up` goal and a `simulated-invoice-reminder.send` connector inside this dedicated host. Every operation requires a labelled demo workspace. There is no model, network transport, timer or native database adapter.

The input declares a goal, acceptance test, review date, pinned owner, exact sources, rupee budget in paise, step reservations, stop deadline/run count, allowed action and explicit `latest`/`skip` catch-up. Two mandatory child tasks calculate balances with payment/bank evidence and prepare reminder drafts. Owner acceptance resolves an occurrence; repeating acceptance retains the existing job scheduler. Missing consent or disputed evidence returns a question rather than an action.

The host requires explicit simulated costs, approval lifetime, day-boundary function, daily/customer caps and stop word. These are configuration values, not a decision on product pricing or recommended cap defaults. Message cash exposure is zero: this connector cannot transfer money; its simulated delivery cost still reserves and charges the same mandate budget.

`dispatch(context, method, request)` is the public source contract:

| Method prefix `invoiceFollowUp.` | Request |
| --- | --- |
| `create` | Existing job config without `type`/`plan`, plus `InvoiceJobInput` |
| `consent.record` | Request identity, customer, simulated recipient, yes/no/not-asked/stopped, source/evidence/date |
| `run`, `read`, `reconcile`, `pause`, `resume`, `cancel` | `{ id }` |
| `approve` | `{ id, digest }` for a mandate configured to require review |
| `accept` | `{ id, repeat? }` |
| `reject` | `{ id, reason }` |
| `reminder.approve` | `{ id, digest }` |
| `reminder.execute`, `reminder.reconcile`, `reminder.cancel` | `{ id }` |
| `tick` | `{ awake, windowOpen, backgroundEnabled }` |
| `recover` | `{}` after exclusive store reopening |

Each reminder binds the exact invoice balance proof, amount, due date, invoice link, recipient consent and occurrence. Individual approval expires under the supplied clock; expiry drops the approval to prepared and records a ledger entry. A person may review the unchanged current preview again. Changed facts, customer merges, source access or consent require fresh evidence; reapproval cannot revive stale evidence. Consent events have immutable request identities and are per customer/channel/owner epoch. `stopped` represents an observed stop-word response.

Preparation and its durable operation marker commit together. Simulated delivery reserves cost before the action attempt; the local sent journal and cost charge commit together. Lost responses retain one uncertain action and resolve by readback without dispatching again. An exclusive restart can prove a reserved local effect absent and release its cost, while preserving sent records. Recovery refuses active work. Cancellation prevents future effects but does not erase historical sent/unknown outcomes. Stale annotations are excluded from historical content identity so later payment evidence cannot prevent delivery readback.

`sent` and `paid` remain separate dated journals. Paid requires full books payment plus a unique exact synthetic bank match for each payment. Credits alone, unmatched/duplicate/future bank lines and disputes cannot establish payment. This fixture bank contract uses `bank_line` facts with `paymentEntityId`, customer/invoice links, currency, amount and `status: matched`; it is not a qualified live bank matching policy. Reminder text is generated from retained calculator rows and its own pinned per-invoice proof, never imported free text.

## Integration requirements and scope

This owned patch edits no shared Engine, Vault, Gateway, server, worker, contracts, package or lockfile. The combined checkpoint already composes the host with the authoritative store and guarded calculator options, registers invoice RPCs, and connects exclusive startup recovery and awake/window/background lifecycle. Dedicated tick/recovery touches only invoice jobs/actions. The host owns its simulated connector/action approval path; a generic action approval alone cannot satisfy the invoice expiry/reservation guards. Direct source tests and the existing synthetic Engine HTTP/encrypted-reopen tests are separate from the pending public purge gate and native/UI acceptance.

Current resource/source limits and historical receipt authorization use existing contracts. Source tests reopen copied synthetic state; the combined Engine tests also exercise encrypted experimental-file reopen. Live connector qualification remains integration work. Live recipient/channel policy, bank adapter semantics, founder cap/expiry/day choices, all-missed-run catch-up, regulated owner guidance, a 14-day measured outcome, and full native/UI acceptance are outside this bounded slice. Consent updates follow owner submission order while retaining their observation date; observation ordering and re-opt-in after a stop remain policy choices. New mandate creation is not idempotent; repeated run/step/action identities are. Objective replacement requires a separate reviewed mandate.

Requirements: [Day 7 actions and collections](../../docs/specs/CHAUSAR-LIVE-BUILD-PLAN.md#day-7-the-companion-takes-an-action), original questlog `day7.blocks[5]` and `day8.blocks[2–4]` in [the original questlog](../../docs/specs/CHAUSAR-LIVE-QUESTLOG.html), [Day 8 mandates](../../docs/specs/CHAUSAR-LIVE-BUILD-PLAN.md#day-8-give-the-companion-a-job), and [shared ownership](../../docs/requirements/module-ownership.md).

Run `node --test platform/tests/invoice-follow-up-*.test.ts`; `node platform/tests/invoice-follow-up.artifact.ts` emits the minimal synthetic week and five-rupee-stop evidence. No dependency acquisition is needed.

## Source deletion and retention contract

New proofs, operation journals, individual approvals, simulated deliveries and paid journals carry direct `sourceIds`, `factIds` and `at`. Operation result values also carry that lineage, so generic retention reaches embedded job settlements and deliverables. Fact scope mirrors the existing proof freshness digest: every fact in the explicitly admitted sources participates, including credits, exclusions and ambiguous bank evidence. Consequently expiry of another fact in that pinned source scope can invalidate the proof. Preparation, approval and delivery add the separately pinned consent source. This changes no retention duration, budget rule or delivery policy.

Operation commits and delivery reservation/effect transitions atomically retain opaque `invoice-operation-no-resend-v1` and `invoice-delivery-no-resend-v1` tombstones. These contain domain-separated identity hashes, exact request/preview hashes and simulated resource costs, with no invoice amounts, recipient, source/fact IDs, proof bodies or reminder text. Missing operation payload plus a marker reconciles as `unknown` and cannot redispatch or refund its held reservation. A terminal delivery marker cannot be downgraded by an older reservation. Only these invoice operational tombstone kinds are excluded from proof freshness; existing source/content/retention tombstones still invalidate evidence. Existing approved proof and preview digests are never recomputed.

The Engine/Trust owner must join `prepareInvoicePurge(state, selection, at)` from `invoice-follow-up-lineage.ts` inside the existing authorized, serialized Trust transaction:

* `deleteSource`: after `sourceDeletionScope` derives source/fact scope, before removing facts or derived arrays; pass `{ sourceId }` and the purge instant.
* `cleanup`: after computing `expiredFacts`, before filtering any array; pass `{ expiredFactIds: [...expiredFacts], cutoff: new Date(cutoff).toISOString() }` and `at.toISOString()`.

The helper derives legacy lineage before references disappear, removes affected invoice payloads/mandates/actions, and preserves one exact `invoice-mandate-accounting-v1` snapshot of the mandate's budget, spent and held amounts. That immutable aggregate is separate from per-operation provider costs and must never be summed with them. Restored purged mandate IDs cannot read, run or acquire a new reservation, and lifecycle ticks exclude them. Legacy orphan journals with unprovable lineage lose their payload and retain opaque identity/cost; no replacement source scope is guessed. Approval alone does not consume an execution key. The helper does not mutate pinned proofs, payloads or settlements. It is an internal pre-purge hook, not a new RPC, and does not supply its own authorization or policy defaults.

This patch leaves the shared join to the coordinator. Engine must keep its existing managed-copy purge after the Trust transaction, interrupt/fence affected active workers and preserve opaque custody across close/reopen. Vault/restore owners must apply the purge/restore custody hook before recovery and prevent an older restored payload or reservation from overriding retained terminal identity/accounting. The owned unit tests exercise current direct Trust purges and explicit helper-before-Trust legacy/uncertain-cost paths; they do not claim the coordinator's unchanged public purge regression has passed.
