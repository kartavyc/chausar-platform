# 5R1 working notes

Package incomplete. No full package approval or commit yet.

Read the plan, X1/X7 catalogue rows and source cards. Current source fetches inspected OpenMuse `packages/domain/src/agent.ts`, Xiryn `lib/templates.ts`, and Beeline `docs/agent-corners.md`. Open Duet upstream fetches for README, routine documentation and service returned metadata errors. Its catalogue evidence and Chausar's existing 4J13 implementation inform reuse; no claim of a fresh successful upstream read. Original code, no source copied.

## Built so far

- `kit/client-room-core.ts`, `client-room-state.ts`, `client-room.ts`: exact owner-approved versions, bounded scope/deliverable/deadline, current order price receipt, manual request provenance, real hosted share requests and only approved client-visible text. Any kit definition enables the common room route with `clientRoom: true`.
- `client-room-privacy.ts`: linked-client and handle-based erasure deletes every room version and token. Controls-only requests cannot consume saved slots.
- `virtual-assistant/payment.ts`: payment fields always refuse with `PAYMENT_FIELD_REFUSED`; exact manual item/quantity/unit-price handoff uses BigInt multiplication and a receipt. No purchase executes.
- Registration, definition and machine-drafted Hindi: both owner-priced offers, four agent/code roles plus owner, six workflow steps, approval floors, house-only rules with `needs: null`.
- `virtual-assistant/routines.ts`: morning and weekly presets reuse `venture.routines.set` and the existing 4J13 queue. Every occurrence waits for approval. A typed record report builds a private owner-chat message from saved mail, monitors and Today, with source identity/digest on every line. No model or network call. An ordinary AI routine keeps its existing behavior.
- Forget drops regenerable private record summaries, since a report may mix several clients' records. Financial ledgers remain intact. This conservative choice avoids retaining anonymous source copies.
- Code brief checks and three committed domain baseline cases. Full delivery source wiring remains.

## Tests and reviews

Core missing-module RED then3/3 GREEN; actual public room route NOT_BUILT_YET RED then2/2 GREEN; opaque client Forget RED then3/3 public-room GREEN. Separate reviewer added four public regressions. Two genuine findings were repaired: handle-only personal data survived Forget, and controls-only text became an empty saved request. Independent final10/10 PASS, Stage1 SPEC PASS then Stage2 QUALITY PASS, in `results/r1-independent-final.log`. That review covers the shared room foundation only.

Registration null RED then GREEN. Actual routine handler rejected the new report field RED; after wiring, existing queue approval and code-only private chat pass. Report-copy Forget failed with one retained message, then passed after erasure. Current routine tests2/2; registration/baseline plus routines4/4 in `results/w5-r1-definition-baseline-green.txt`. No claim of broad gates or full R1 review.

## Remaining

Finish source-bound tool/delivery behavior, owner desk/fake, intake and guide fixtures, Hindi review entries, receipt UI, end-to-end tests, separate full spec then quality reviews, isolated precommit checks and commit in batch-four order.

## 29 October delivery and owner-boundary continuation

The real `va.brief` tool now resolves the current approved room from this exact delivery order; input fields cannot select another order. Missing tool RED then1/1 GREEN in w5-r1-tools logs.

Native VA desk `payment` refuses all payment entry with the exact required refusal and retains nothing. `purchase.preview` returns the exact owner-entered item, quantity, code-computed total and inspectable multiplication receipt; it never invokes a shop or payment service. Real public desk NOT_BUILT_YET RED then3/3 nearby GREEN in w5-r1-delivery-handoff-green.log.

Deliveries now bind `vaBriefBinding` to the exact current room version. Start, approval, physical model dispatch, post-answer continuation, tool application, next previews, repairs, final commits, judge reads and Accept recheck it. A newly approved revision cannot make an old delivery current. The built-in option copies the approved brief with a real price figure part and clearly says client work has not been completed. The regular model path retains its exact-preview approval. The definition's compute step no longer carries an invalid approval-floor descriptor; routine configuration and queue execution still use their actual always-ask guards.

The public start/Accept regression failed with Missing expected rejection before binding, then passed. A stronger actual canAccept check caught literal money and receipt IDs being emitted as prose; the copy now uses the real receipt figure and only approved facts as grounding. A judge-transport mutation test removed only the new VA hooks and proved one forbidden synthetic send; exact original bytes were restored in finally. Corrected eligible-draft fixture and restored guard pass. Separate reviewer found a reapproved revision during the model await was retained; that genuine RED is fixed at post-answer and commit boundaries, with5/5 nearby tests in w5-r1-post-answer-green.log. Independent re-review is pending.

Current broader R1/room/adjacent judge run25/25 in w5-r1-root-native-current.log. That checkpoint preceded the final post-answer repair and does not replace final gates. The routine foundation separately passed spec and quality with3/3 in r1-routines-independent.log. Full package remains incomplete while owner UI, fake room/order-receipt/routine parity, metadata and final review are built.

The final configured-model regression verifies that the actual approval preview contains the approved deliverable and deadline references, then a synthetic model answer with the real price figure passes checks and Accept. Its RED showed those approved facts missing from the preview. Separate delivery re-review completed Stage 1 SPEC PASS then Stage 2 QUALITY PASS, four tests in r1-delivery-independent-final.log. This closes the native delivery review only; owner/fake and full-package review still remain.

## Native privacy review closure

The actual public Forget regression exposed opaque model payloads and active runs linked by the approved room order. The repair resolves exact order/run/call identities before erasure, stops every matching run, clears previews, rendered and edited drafts, model payloads and derived room/share/report data, and cancels matching orders while retaining the financial receipt and model-cost metadata. A second genuine RED covered a contact present only in the order request and closes every room for that order. Logs: w5-r1-delivery-forget-red.log, w5-r1-delivery-handle-red.log, w5-r1-delivery-forget-final.log (12/12). Separate reviewer Stage 1 SPEC PASS and Stage 2 QUALITY PASS, r1-privacy-independent-final.log (9/9).

Owner/fake implementation and evidence are in NOTES-5R1-UI.md. Independent owner review found retained order labels and delayed purchase replies after a privacy event with a failed refresh. Genuine RED and repair now clear selection/private buffers and fence late replies, while benign desk refresh preserves unsaved edits. Root independently passed7/7 in w5-r1-root-owner-privacy-final.log, plus earlier19/19 owner/fake/translation checks. Owner/fake Stage 1 SPEC PASS, Stage 2 QUALITY PASS. HI390 room and EN390 receipt were inspected. Whole-package isolated assembly, remaining metadata parity and precommit gates still need verification.
