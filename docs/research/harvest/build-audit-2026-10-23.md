# What of the Grok harvest is in the build, 23 October 2026

Checked against chausar-platform main at 11a73e83, by reading code and tests (nothing was run). Six read-only audits, one per card plus the frontend studies. 354 ideas and traps in total.

| Slice | Built | Partial | Not built | Skipped on purpose |
|---|---|---|---|---|
| Harness (qm, cloudflare-os, omnigent, decionis, floe-guard, llm-space, LongHorizon) | 20 | 12 | 9 | 0 |
| Quality and data ops (SkillEvaluator, agentbehavior, open-computer-use, helix-foundry, py-idp, opendesk, crm) | 10 | 13 | 10 | 4 |
| Creator and the YouTube playbook | 26 | 25 | 22 | 4 |
| Finance and the CA firm playbook | 20 | 18 | 7 | 3 |
| Marketing, commerce and the social agency playbook | 17 | 24 | 15 | 5 |
| Frontend studies (16 products) and the old renderer's must-keep list | 45 | 31 | 12 | 2 |
| **Total** | **138** | **123** | **75** | **18** |

"Built" means code plus a test. Many "partial" items are tested library code that nothing in the app or a run calls yet.

The other 94 of the 129 products Grok found were never read: only Grok's one-line description exists for them (recruiting, helpdesks, translation, marketplace sellers, SEO, newsletters, video editors, computer use, app builders).

## Safety and correctness gaps (fix first)

1. CA sign-off blocks nothing. Accept ignores the not-run sign-off check and a share link can carry the draft to the client (runtime/venture/delivery/runs.ts:717, build/share-links.ts:31,84).
2. Tax engines are unreachable. Income tax, interest, TDS, AIS/26AS reconcile and the portal diff are called only by tests; the compute step has no tools, so a "GST working" draft with no GST figure passes (ca-firm/playbook.ts:181-184, tests/venture-playbook-wiring-delivery.test.ts:273-279).
3. "Outcome unknown" can't be settled from the app. resolveUnknown and resolveUnknownPost have no engine method or button, so that subject stays refused for good (journal/journal.ts:368, build/posting.ts:281).
4. The per-run spend cap is checked after a turn, so the last call can pass it (delivery/harness/loop.ts:274).
5. Ink lost the REQUEST_TIMEOUT re-read: a timed-out decision shows "Couldn't send" instead of re-reading the stored result (app/ui/src/parts/ApprovalRow.tsx:93-96).
6. The post path takes free text and never checks the draft passed its checks or that the client approved it (build/posting.ts:158). It is unreachable today because no method proposes a post.
7. Rate tables stop at FY 2025-26 (TDS) and AY 2026-27, so current-year TDS is already refused (ca-firm/rates.ts).

8. Bugs found during the second harvest pass:
   - `recordSend` (runtime/venture/customers/leads.ts:180) sets every lead to 'contacted', so a lead already marked 'replied' moves backwards. Pipeline stages must move forward only.
   - Leads.tsx waits for `SOURCE_REQUIRED` and `POSTAL_ADDRESS_REQUIRED`, but the real engine sends `LEADS_SOURCE_REQUIRED` and `LEADS_ADDRESS_MISSING`, so with the real engine the postal address field never appears and the first draft fails. UI tests pass only because the fake engine uses the short codes.
   - The business menu (260px) is clipped by the 220px rail and the phone top bar; Welcome.tsx PassphraseOpen never resets `live.current`, so under StrictMode a wrong passphrase shows nothing.
   - browser.ts posting steps have one selector each and `checkedOn: null`.

## Built but not wired (no caller in the app or a run)

- Social: calendar slots, thread splits, calendar export, draft-before-schedule gate, report figures from exports, narrative receipt check, rule freshness.
- YouTube: hook ranking (agent writes two, code scores one), EDL build, chapter drafting, Studio retention reader, rule freshness.
- Judges: the cited-evidence rules judge runs only on rehearsal cases made from owner feedback; real orders and the standard practice clients never get it. Ink has no control that starts a rehearsal or improvement run.
- Evidence ledger: complete, but no agent tool records facts.
- Bank: imported statements feed nothing; consent, polling and alert code has no provider and no screen.
- Posting: no method proposes a post and nothing opens the sign-in window; on desktop the owner can't record a client's answer though the app says to.

## Not built, by area

- Harness: untrusted-content screen with observe then enforce, account fence on posts, restricted-data latch and risk score for the auto rung, drop to a cheaper model, signed receipts with an offline verifier, reproducibility label, per-kind reject cleanup and action dependencies, typed mock tools.
- Quality: with/without-playbook lift, lucky-correct-negative fixtures, trace scan for secrets and out-of-folder writes, "not applicable" votes, correction-driven review, model-writes-query over the books, multi-currency, lease work queue, computer use.
- Creator: voice.md per business, outlier over channel median, speaking rate, project folder and render, beat sheet, safe zones, commentary share, face on edge, one bounded auto-repair, after-publish review, channel review add-on, transcription, Data and Analytics API reads, editor hand-off, scheduling, SSRF guard, stock-phrase humanizer.
- Finance: NEEDS_FACTS loop, AIS/26AS/Form 16/2B readers, ITR data pack, both-regime comparison and set-off, stored CA receipts, TDS withheld on payments, tax-inclusive prices, prompt-cache prices, CA practice clients, e-invoicing (IRN, QR), Account Aggregator provider.
- Marketing: SEO, commerce (Amazon) and tender playbooks, commerce calculator, image-prompt rules, beat slots, creator consent records, bounce read-back, follow-up dates, Replied and Lost, DPDP/GDPR/CAN-SPAM fields, lead scoring, client banned words and competitors in the intake, Threads, Bluesky, Mastodon.
- Frontend: stop a run, edit a draft (deny and reopen), send back with your own words, undo for drafts, approval expiry, "Sends to the client" line, change count line, standalone approval page, OS notifications and quiet hours, run scope line, price beside a control and "nothing spent yet", what-keeps-running footer, autosave; plus slipped must-keeps (storage notice only on Keep, AI key field inside a form, word-budget tests only on Money, real-browser walk at 1280 and 390).
