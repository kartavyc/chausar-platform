# D1 selected-post revisions checkpoint

Implementation slice: LinkedIn eight/twelve-post packs, five declared structures, selected-post revisions across social channels, exact per-post client approvals, and extra-round quotes.

The first two ghostwriting revisions are included per order/post. Later rounds require the owner-set price and the exact quote digest before a model preview. The quote carries a resolvable code receipt; an approved charge retains that receipt after the price changes. No payment is sent by this action. A concurrent second click cannot reserve the same round. Undo restores an unsent reservation; a failed model response does not reset the used round.

The revision landing uses the same actual-post parser as the canvas. It maps actual post ordinals to section, text part and line, so companion alt text, hashtags and Post plan rows cannot become revision targets. The selected candidate line is merged into the original structured deliverable. Other post bodies, title, questions, companion text, CRLF, indentation and channel labels are preserved. An owner edit outside actual post lines refuses before preview if it cannot be represented safely by the structured draft. Checks run again on the merged draft.

Client decisions bind post id, channel and exact words. The latest answer wins; conflicting answers at the same timestamp fail closed. An exact current whole-pack approval carries forward to untouched posts even if an older cleared per-post record exists. The selected post returns to pending. Forget clears matching decision comments without resetting revision counts or charges.

The fake engine has an explicitly labelled demo revision preview and only changes the selected post on approval. Its extra-round receipts use the current venture currency and currency minor-unit precision. Shared answers bind the exact shared pack. Monthly due reminders derive at the local day of the rehearsal business, using the shared country-zone mapping, include other accessible workspaces, hide inaccessible ones and disappear after delivery. Open is navigation and does not dismiss a reminder.

Latest focused evidence, 27 October 2026:

- Real ghostwriting tests: 13/13 after the companion/multiline merge regression. Includes actual delivery preview/approve, count/structure checks, twelve-post schema, exact client decisions, concurrency/failure/undo, extra-round receipt lookup and historical proof.
- Existing send-back regression suite: 11/11 before the final location-parser refinement.
- Fake revision plus chain tests: 15/15 after the location-parser refinement. Public India and US full-chain quote/receipt paths; JPY/BHD precision and large INR cases; comment erasure.
- Fake due reminder tests: 3/3, including inaccessible workspace, all-business list, India/US local-day boundaries and navigation behavior.
- Independent SEO reviewer closed stage 1 and code-quality review before the final companion/multiline finding. The independent receipt reviewer closed the receipt finding. The final location-parser fix was independently re-reviewed with the original companion and multiline reproductions: 26/26 nearby engine tests and 22/22 fake/UI tests passed. Both receipt and merge findings are closed.

Global typechecks, full UI/build/shards and visual gates are owned by the root agent. This note does not claim those gates or a whole-package PASS.


## D1 channel metadata follow-up, 28 October

During D2 integration, the LinkedIn capability matrix still claimed automated posting in its API and owner-browser descriptions despite the runtime copy-and-open refusal. Both automated modes now have empty can lists and explicitly instruct the owner to post approved words manually. Handoff remains unchanged. The API-label regression was observed RED in results/w5-d1-linkedin-metadata-red.txt; the metadata and live publish-boundary suites pass17/17 in w5-d1-linkedin-metadata-green.txt. No runtime automation was enabled. Owned hunks: social/channels.ts LinkedIn modes and venture-playbook-social.test.ts assertions.

Separate reviewer seller_f2 read the final metadata correction and confirmed spec PASS and quality PASS.
