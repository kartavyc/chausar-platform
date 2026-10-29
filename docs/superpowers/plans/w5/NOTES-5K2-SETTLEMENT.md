# 5K2 settlement UI and demo review

This is a bounded independent review of the settlement UI/demo increment, not a review of all 5K2. Engine/provider/public settlement work had a separate review by seller_f2.

- STAGE 1: PASS. STAGE 2: PASS. Reviewer: batch1_verify, 29 October 2026.
- Scope: BooksSettlement.tsx, BooksFinance seller-month insertion and scope guards, fake-books-settlement.ts, settlement EN/HI text and review registration, books-settlement.test.tsx and fake-books-settlement.test.ts.
- Fixed genuine scope regression: a previously loaded seller month stayed visible when the owner selected another company/cycle. Loaded detail and work rows now match the current selection, client and cycle. Regression also covers a delayed response from the old selection.
- Fixed exact-approval regression: selecting another payment source kept the old proposal's approval enabled. A nonblank changed file now locks that approval until the owner prepares the matching proposal; reopening a staged proposal with a blank picker still works.
- Fixed refusal parity: fake stage checked monthly row kind before connection/mapping, while the real public handler checked the current account first. Real public reproduction and fake regression now agree on code and wording.
- RED evidence: results/k2-settlement-independent-scope-red.txt, k2-settlement-independent-source-red.txt and k2-settlement-independent-parity-red.txt. Real refusal reproduction: k2-settlement-real-refusal.ts/.txt.
- Independent final command: npx vitest run --config app/ui/vitest.config.ts app/ui/tests/engine/fake-books-settlement.test.ts app/ui/tests/places/books-settlement.test.tsx app/ui/tests/places/books-finance.test.tsx. Result: 10/10, results/k2-settlement-independent-final.txt.
- Screens: results/k2-settlement-independent-shots/en-390-dark.png and hi-390-dark.png. Actual component with an explicitly synthetic staged review fixture; no provider write was made or claimed. Both measured viewport/scroll width390, axe zero violations. Inspected both PNGs.
- A small visible gap was missing between outcome ID and state. Root applied existing token-based s.row layout, verified in source after capture. The stored PNGs precede that spacing-only correction.
- Exact request bytes and receipt figures are exposed before approval. Unknown outcomes offer no resend. Missing receipts lock approval. The shipped demo refuses unavailable provider reads and invents no successful posting.
- Root owns final typechecks, whole-wave tests, word baseline, full screenshot walk and PR. Temporary screenshot harness and browser profile were removed; local server and browser stopped. No git mutation.
