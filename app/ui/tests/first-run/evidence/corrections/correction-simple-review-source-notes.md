# Stable Simple correction: independent source and copy review

Reviewed the stable working files in `first-run-checkout` against published commit `da7da1a39116ed263d47498ed6740d863652b81c`. This review changed no product file and ran no tests, browser, native application, model CLI or common checker. Source inspection found no correction-specific issue. The parent's separate word-count, closed-slot and callback checks remain the evidence for runtime acceptance.

## Reviewed byte pins

Actual SHA-256 values match the supplied stable pins:

| File under `app/ui/src/screens/first-run/` | SHA-256 |
| --- | --- |
| `rows.tsx` | `6fce9bb55c51119909241e73d10423a5ca851a12c9196d878a19ecc5823ef755` |
| `Meanings.tsx` | `293229a3aa21b8088fe74a79855931ab231008b0dbb77a7e2ae6aebd03ea1835` |
| `text/en.json` | `022c96c0bd5e654ca536d1c39a47ba4702b5945219d31fe0f65f4044640b962b` |
| `text/hi.json` | `b85aa908c124e3dd2b85a7daa4d99f16be3c1ad9376d84c5ad76989940e115ed` |
| `FirstRun.module.css` (unchanged) | `3c42529ca5ebab090e1831863503b4183c2f1809885c9ced8728864edf9e3d82` |

The scoped diff has one runtime change: `rows.tsx:43` changes Simple's preview limit from zero to one word. Guided remains two, Books three. `Meanings.tsx` changes only its explanatory comment. English has five changed catalogue values and Hindi four; no heading, catalogue key, interpolation value, required state or action label is removed. CSS has no diff.

## Approved reference rules

Read directly from the retained authoritative documents under `C:/Users/karta/Documents/Codex/2026-10-01/task-18/inputs/`:

- Main design, line 251: the row includes a short grey note after its word.
- Main design, line 253: a row may truncate words with ellipsis when space is tight; full text remains in the sheet.
- Main design, line 422: a view may change presentation and movement, while truth, permission and receipts remain the same.
- Main design, line 440: Simple preserves access rather than hiding screens permanently.
- Main design, line 442: view and language remain separate choices.
- `screens.md:221`: FR-08 shows progress and each proposal's word, proposed meaning and state; the open row shows evidence and Accept/Change; blocked facts and local privacy remain at the bottom.

A nonempty exact-prefix preview is consistent with these rules. A zero-word Simple meaning preview had no documented first-run exception. The references do not establish exact first-run Simple geometry or dedicated Hindi pixels.

## Meaning and required information preservation

`rows.tsx:56-60` still takes the first words of the actual meaning, in order. It introduces no paraphrase. Its truncation marker remains U+2026 (verified from the actual source character code 8230). The one-word limit therefore affects only the closed preview.

Unchanged `Meanings.tsx:175-179` derives that preview from `definition.meaning` and preserves text provenance. Unchanged `Meanings.tsx:183` initializes the editor with the exact full current meaning; line 187 renders the exact full current meaning; lines 191-194 retain the exact original proposal in its disclosure. The existing disclosure switches between complete current and original versions instead of repeating both simultaneously. No new condition removes either version or truncates editor values to meet a word budget.

The row still includes its square, word, preview and state at `Meanings.tsx:134-137`. Evidence remains at line 188; Accept and Change at lines 198-201. Currency, GST mode, current publication, and the unavailable-settings fact remain at lines 228-243. The status, publication/hash detail, pending configuration and local-privacy footer remain at lines 391-394. All of these paths are unchanged by this correction.

Unchanged CSS `FirstRun.module.css:115-123` uses the existing muted note token for the preview and permits one-line ellipsis. The word, state, full meaning, original disclosure and footer styling remain unchanged. This is source compatibility with the grey-note rule, not a claim that every physical viewport has enough width to reveal the prefix.

## All nine changed interface values

| Catalogue and line | Change | Semantic review |
| --- | --- | --- |
| English `text/en.json:23` | Progress becomes `{done}/{of}` | Preserves completed count and total; numerator is still the completed count. |
| Hindi `text/hi.json:23` | Progress becomes `{done}/{of}` | Same completed/total meaning; both placeholders remain. |
| English `text/en.json:39` | `Currency and GST` becomes `Currency, GST` | Names both settings; detailed currency and GST-mode labels are unchanged. |
| Hindi `text/hi.json:39` | `FR-08.settings.word` compactly names currency and GST | Names the same two settings. The actual UTF-8 catalogue is authoritative. |
| English `text/en.json:49` | Configuration becomes `Pending: calendar, ordering, Today.` | Keeps all three unresolved configuration facts; does not claim completion or automatic configuration. |
| Hindi `text/hi.json:49` | `FR-08.footer.calendar` compactly identifies calendar, ordering and Today as pending | Keeps all three choices as remaining/uncompleted. The actual UTF-8 catalogue is authoritative. |
| English `text/en.json:51` | Review instruction becomes `Accept every row.` | Retains the required all-row acceptance instruction. Publish label and all-reviewed publication gating remain unchanged. |
| English `text/en.json:54` | Publication becomes `Version {version} published, read back.` | Retains the version, publication and verified readback facts. The published branch remains unchanged. |
| Hindi `text/hi.json:50` | `FR-08.footer.local` compactly states that nothing has left the computer | Retains the same device privacy boundary. The actual UTF-8 catalogue is authoritative. |

The English and Hindi FR-08 headings remain unchanged. Language selection and engine-versus-user meaning language provenance remain unchanged. This is a source-level semantic review, not native Hindi typography or accessibility approval.

## Acceptance limits

This report establishes the stable source/copy correction and preservation of required information. It does not independently establish the 90-word ceiling, the parent's DOM/callback matrix, physical clipping, exact Simple pixel fidelity, font/wrapping/zoom behavior, native Hindi review, or full-product/native acceptance. Dedicated first-run Simple visual references remain missing. No earlier sealed result was rewritten.
