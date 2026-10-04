# Independent first-run design and React DOM review

Sealed 2026-10-04 from the final Codex correction source. This reviewer made no product/source edits or Claude author calls. All checks used synthetic data, the installed read-only TypeScript/React/jsdom dependencies, and external verification scripts. No browser, native app, service, network acquisition or real business data was used. Runtime TypeScript transpilation in these scripts is not a strict typecheck; the coordinator owns the separately recorded strict checks.

The independently inspected source passes the bounded review described below. No remaining callback, source-meaning preservation or tested copy-budget defect was found.

## Persisted results

- `first-run-ui-audit-sealed-4896.json`: 4,896 settled DOM states, all six packs, English/Hindi interfaces and Simple/Guided/Books. Twelve production files have identical before/after SHA256 values; `sourceStableDuringRun` is true and `changedFiles` is empty. Completed at 07:26:10.129 UTC.
- `first-run-stale-publish-sealed.json`: actual React DOM plus actual controller. Same React batch Change followed by the retained, still-connected Publish control produces zero `ontology.publish` calls. The unsaved editor remains active. The separate committed-control case also produces zero calls. This is a synthetic stale-callback test, not a claim of an ordinary sequential browser race.
- `first-run-navigation-sealed.json`: 13 actual-controller/DOM intent cases. Valid repeated Continue/settings presses deliver exactly once. Cancel, false live guard, lock, context/pack changes, cancellation during context read, and synchronous lock inside a LEFT observer all deliver zero callbacks. Valid handoff leaves calendar, time zone, ordering and Today defaults explicitly `not-configured`.
- `first-run-disclosure-sealed.json`: 72 genuine Original summary click cases pass with exact Engine text, replacement and restoration. The other 144 Binding/fields cases are explicitly recorded as unavailable because those controls were removed; they are not counted as exercised passes.

The 4,896-case copy matrix contains 504 stock expanded rows, 432 stock editors including actual `textarea.value`, 72 closed reviews, 3,024 changed/accepted changed row states, and 864 changed/published states. Changed fixtures add only `Reviewed: ` to the exact Engine meaning. The latter two groups include current text, genuine Original open/restore, and editor/validation/discard states where applicable. Every stock full-meaning check and initial-editor exact-value check passed. The changed groups have empty preservation and filled-action failure arrays. All tested states have at most one filled action; tested quiet/action labels meet the source's 22-character limit.

| State group | Cases | Simple max / 90 | Guided max / 120 | Books max / 170 |
| --- | ---: | ---: | ---: | ---: |
| Stock expanded | 504 | 87 | 97 | 102 |
| Stock editor, including value | 432 | 85 | 95 | 100 |
| Stock closed review | 72 | 57 | 69 | 75 |
| Changed/accepted changed | 3,024 | 89 | 99 | 104 |
| Changed/published | 864 | 90 | 100 | 105 |

There are zero over-budget cases in each group and view. Published changed Ecommerce Earned in the Hindi interface sets the maxima. The exact changed Hindi spot check remains unchanged after acceptance, is marked `data-origin="changed"` and has no false English `lang` attribute. The original English Engine meaning remains separately inspectable. Language arrows move both choice and focus; activating the focused radio preserves the selected language. Row arrows move focus, Escape discards and returns row focus, unmount cancels once, and no synthetic publication occurs without an explicit Publish click.

## Source pins and relevant owned guards

All complete pins are persisted in the matrix. Principal final SHA256 values:

- `Meanings.tsx`: `40f81e46fd3005bc1a6703ab466d1d9cc4939a67c484cddd0ed9e233c4a0aba6`
- `controller.ts`: `5c7ea2805ada038d0324bf856442d7fa3b1f7d005740e7ebf94c71d3bddbfb2f`
- `FirstRun.tsx`: `bdff78fdd2d4c29632de7ec91bfc20206b8caca898bb539f41e2207e6ccb45d9`
- `FirstRun.module.css`: `3c42529ca5ebab090e1831863503b4183c2f1809885c9ced8728864edf9e3d82`
- `text/en.json`: `8ac4a43ad7755e9af7adbb632bb841aa758b62440773bcf7bb04fa1335f574ab`
- `text/hi.json`: `115a118736fa757315dad30f476259101692b1dc0e858840c3b3e160c6c34eaa`

`Meanings.tsx:172` determines Engine provenance by exact equality with the original proposal, independently of accepted status. Lines 186-201 replace the current meaning with Original and hide current-row acceptance/change controls while Original is shown. Lines 265-323 hold a synchronous revision/epoch edit guard, invalidating retained Publish callbacks before React commits the editor. Lines 310 and 343 consume one-shot controller admission before calling parent navigation. `FirstRun.tsx:126-130` keeps radio focus and selection aligned; lines 203-206 cancel on unmount. Parent stage certification is explicit in `FirstRun.tsx:45-80`; parent-owned FR-01 view and root `data-view` setup are documented at lines 58-61.

## Reference qualification and integration limits

The retained approved references were read from the task-18 `inputs` directory. `screens.md:197-204` supplies FR-06's six plain business rows, unchecked draft state and conversation action; `screens.md:215-225` supplies FR-08's word/proposed meaning/state rows, six-step shell, explicit acceptance and opened row actions. The main design at lines 124 and 337-367 supplies no first-run rail, minimal actions, one filled button, bounded labels and focus requirements. Main lines 422-442 describe the three views; lines 450-459 place language/view before pack/meaning steps. No Guided-only exception was found. `build.md:456` sets main-area limits at rest to 90/120/170; line 465 includes labels, figures and status words. This review conservatively counts settled open rows, Original states and actual editor values. The phrase "at rest" does not further define optional disclosure scope.

The exact retained S09 light/dark images were extracted to `reference-evidence/S09-Setup.light.png` and `.dark.png` and inspected without launching a browser. They support the centred six-step shell and minimal rows. FR-06 has retained text but no dedicated picture; dedicated Simple/Books FR-06/FR-08 pictures were not found. Accordingly, Simple zero-word previews and Books preview density have source-budget support but cannot receive an exact-picture or pixel-fidelity claim. Native Hindi reader approval, real rendering/zoom/target geometry and screen-reader behavior remain unverified under the user's native/browser restrictions. See `first-run-reference-qualification.md` for retained document/image hashes and exact reference qualification.

The copy pass applies to stock Engine meanings and bounded synthetic edits. It does not prove 90/120/170 words for every longer user-authored meaning or draft textarea value. Exact user meanings must be preserved; no arbitrary truncation or new user-text policy was introduced to manufacture such a guarantee.

The shared mount, bootstrap, router, Engine and desktop adapter registration remain parent-owned. Parent integration must preserve explicit stage certification, the actual selected view/root tokens, live lock/context authority and one-shot result admission. Existing Engine `workspace.create` auto-publishes its default dictionary; this isolated slice cannot make a full-product no-auto-publication claim. The reviewed UI itself performs no publication before explicit UI action and adds no timezone, accounting, calendar, ordering or Today metric policy.

Historical author-only stdout recorded four bounded published overages before catalogue shortening: Ecommerce Earned current/restored, English 91 and Hindi 92 in Simple, with earlier catalogue pins `en675c7cbd...` / `hi9e8fa5d3...`. Those were not independent prior-matrix failures because the earlier 4,032-state audit excluded published variants. The sealed independent run above includes all 864 such published variants and passes.
