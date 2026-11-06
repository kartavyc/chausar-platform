# Finance group cards: AI-native CA firm and finance playbook

Written 21 October 2026. Five repos, shallow-cloned and read, not run. Each card judges the code, not the README. Clones are in the session scratchpad under `clones/<owner>__<repo>`.

The short version: only one of the five does tax math the way Chausar needs it (opentax-engine, US only, AGPL). The Indian one (itr-prep-skill) is a well-written prompt that has the model do the arithmetic, which is the exact thing Chausar forbids. None of the five touch GST or TDS returns.

---

## Invaro/opentax-engine

- **What it is.** A US federal and state tax calculator in pure TypeScript that returns a proof tree with a statute citation on every node. Rules are data; the engine refuses when it can't derive an answer.
- **How it works.**
  - Exact money: amounts are `bigint` cents, rates are `{num, den}` rationals, and every division names its rounding mode (`half-up`, `half-even`, `floor`, `ceil`). No floats anywhere. `packages/core/src/money.ts`.
  - Rules as data: each rule has an id, version, citation (source, section, excerpt), a half-open validity window `[effectiveFrom, effectiveTo)`, and a formula in a small closed expression language (`add`, `mulRate`, `brackets`, `stepUnits`, `if`, `match`, and an `unsupported` node that throws `NOT_MODELED`). Exceptions are separate rules that `override` a base rule with a guard and a priority. `packages/core/src/rule.ts`, `packages/core/src/ast.ts`.
  - Proof artifact: every derivation node records rule id, version, rule hash, citation, inputs, and which override candidates were considered. The corpus is pinned by a Merkle root, the artifact is hashed, and `verifyProof` re-derives from scratch and reports one of `artifact-hash-mismatch`, `corpus-mismatch` or `divergence`. Defaults used are listed as named assumptions. `packages/core/src/proof.ts`, `packages/core/src/verify.ts`, `docs/PROOF-FORMAT.md`.
  - Agent contract: every command takes `--json` and returns `{ok, ...}` or `{ok:false, error:{code, message, data, hint}}`. `NEEDS_FACTS` lists the missing inputs; out-of-coverage cases exit 3 and tell the agent not to retry. There is a `check --expect N` guardrail that refutes a number a model claims. A staleness file lists every rule whose validity runs out before the next tax year and refuses a return that depends on one. `AGENTS.md`, `packages/core/src/errors.ts`, `packages/corpus-us-federal/src/staleness.ts`.
- **What Chausar should take.**
  - **Back office/books:** the validity-window plus versioned-rule pattern for Indian tax rates (GST slabs, TDS section rates, income-tax slabs). A rate change lands as a new version with its own window and citation, never an edit, so old receipts stay re-derivable. Chausar's price receipts already record BigInt steps and rounding; add a rule id, rule hash, citation and a corpus root to each receipt.
  - **Quality judge:** the `check --expect` guardrail. Any number in an agent draft is checked against the calculator and refuted with the right value. This is the "AI never does arithmetic" rule enforced after the fact, not just by prompting.
  - **Delivery agents:** the `NEEDS_FACTS` loop (engine lists missing facts, agent asks the client in plain words, retries) and the "refuse loudly, exit 3, do not retry" contract. Both fit the harness envelope (`ok` or a typed error).
  - **Autonomy ladder:** the staleness horizon. A tax playbook can't run unattended past a date when a rate it depends on has no current version.
- **Licence verdict.** Learn only. AGPL-3.0 with a paid commercial licence from Invaro (`COMMERCIAL-LICENSE.md`). Chausar is closed, so copy ideas and the public proof-format spec, not code.
- **Risks or gaps.** US only; no India, no GST, no TDS. The CLI and MCP server send an anonymous usage ping to `opentax.invaro.ai` unless `OPENTAX_TELEMETRY=0` (`packages/mcp/src/phone-home.ts`). The Windows checkout failed partway (long test paths); fixed with a restore, so treat file counts as approximate. Benchmark claims (48/50 on TaxCalcBench) are self-reported.
- **Label for Chausar today:** planned

---

## NidheeshJain/itr-prep-skill

- **What it is.** A Claude Code skill (one SKILL.md, ten reference files, one Python script) that takes Form 16, AIS, 26AS and broker P&L to a reconciled Indian ITR-1/2/3/4 computation and a "data pack" JSON. It stops before the portal; a person or a browser agent files.
- **How it works.**
  - All instructions, no calculator. The tax stack (slab tax, special-rate incomes, 87A rebate, surcharge with marginal relief, 4% cess, 234A/B/C interest, 288A/288B rounding) is described in prose for the model to carry out. `references/08-tax-computation-interest.md`.
  - "Rates are shape, not truth": the model must web-search every slab, limit and due date for the assessment year, from a ranked source list (incometaxindia.gov.in, then incometax.gov.in, then two agreeing secondaries), and log each in a `rules_verification` block with value, URL and date. `SKILL.md` principle 1, `references/10-json-output-and-verification.md`.
  - Every figure must trace to a source document, AIS, 26AS, Form 16 and broker statements are cross-checked, and unmatched items become `VERIFY` flags. A final diff of the portal's own generated JSON against the pack, schedule by schedule, with rupee impact. `references/02-documents-and-parsing.md`, `references/10-json-output-and-verification.md`.
  - `scripts/decrypt_ais.py` decrypts the AIS JSON with a PBKDF2 key built from PAN, DOB and a fixed middle string.
- **What Chausar should take.**
  - **Delivery agents:** the phase order (year and rules, interview, documents, reconcile, compute by head, set-off and regime choice, tax and interest, data pack, checklist) is a ready skeleton for an ITR playbook's typed steps. The "ask simple questions, derive the technical value yourself" style fits Chausar's question hand-off.
  - **Back office/books:** the `rules_verification` block, reshaped as a Chausar rate table where each row is owner- or CA-confirmed, carries a source URL and date, and feeds the calculator. The model may find the source; code holds the number.
  - **Quality judge:** the three reconciliations (AIS vs 26AS vs Form 16 vs broker; pack vs portal JSON; "decompose the gap into named parts that sum to the observed delta"). The sum check must be done by the calculator.
  - **Connectors:** the data pack as a `handoff` to the portal, with the human doing login, payment, submit and e-verify. That matches Chausar's honest handoff label.
- **Licence verdict.** Reuse with attribution (MIT). In practice take structure and checklists; the prose is the valuable part.
- **Risks or gaps.**
  - Breaks Chausar's first rule: the model computes slab tax, surcharge, marginal relief and interest. Nothing is deterministic or testable; there are no tests at all.
  - The README tells non-technical users to run `claude --dangerously-skip-permissions` and lets the skill `pip install` packages itself. Chausar must not copy that.
  - Currency: written in the 1961 Act's section numbers (87A, 115BAC, 234A/B/C, 288A). Those are right for AY 2026-27 returns. The Income-tax Act, 2025 takes over from 1 April 2026, so income from FY 2026-27 onward is under renumbered sections; the skill's own "verify every year" rule partly covers this, but its section map will age. Check before relying on it.
  - Personal income tax only: no GST, no TDS returns (24Q/26Q), no company or firm returns, no audit work.
  - The data pack holds PAN, Aadhaar, DOB and bank details in a plain local JSON.
- **Label for Chausar today:** planned

---

## noskillish/bankmcp

- **What it is.** A small self-hosted, single-user MCP server that reads bank balances and transactions through Enable Banking (PSD2, about 2,700 European banks). Read only, no payments.
- **How it works.**
  - A normalising layer turns raw bank data into signed amounts, one counterparty field and one description, and picks a "booked" balance by a fixed preference order (CLBD, ITBD, CLAV, ITAV, XPCD), so an account never drops out of a total because of its bank's label. `src/data.ts`.
  - Stable transaction ids: use the bank's `entry_reference`, else a SHA-256 fingerprint of identifying fields, with a counter for identical twins (same day, same amount, same shop). It deliberately ignores `transaction_id` because the provider says it can change. `src/data.ts` (`fingerprint`, `simplifyTransactions`).
  - Watches: typed rules (`balance_below`, `large_debit`, `credit_matching`, `credit_missing_by`) checked in the background at most four times a day, the PSD2 limit for unattended access, plus consent-expiry warnings seven days out. Notifications go only to the webhook the operator set, never one the model picks. `src/watcher.ts`, `src/tools.ts`.
  - Consent lifecycle as tools: list banks, start consent, show days left, revoke and forget. `src/tools.ts`.
- **What Chausar should take.**
  - **Connectors:** the shape of an honest bank `read` connector: consent with a visible expiry, read only, a polling ceiling written into the tool description, and a webhook destination the model can't change. For India the provider would be an RBI Account Aggregator, not PSD2, so the label stays `planned: read`.
  - **Back office/books:** the stable-id fingerprint with twin counters. Chausar's reconcile tool needs exactly this so a re-imported statement doesn't double-count.
  - **Delivery agents:** the `credit_missing_by` watch ("tell me if the client's fee hasn't arrived by the 10th") is a good collections nudge for a CA firm's own receivables.
- **Licence verdict.** Reuse with attribution (MIT).
- **Risks or gaps.** Europe only; no Indian banks or Account Aggregator. Money is JavaScript `Number` with `round2` and the tool returns `total_in` / `total_out` computed by float `reduce` (`src/tools.ts` around line 286), so it fails Chausar's rule if used for books; take raw amounts as strings and let Chausar's calculator sum. Every transaction passes through Enable Banking's servers.
- **Label for Chausar today:** planned

---

## akaunting/akaunting

- **What it is.** A large Laravel (PHP) accounting app: invoices and bills ("documents"), payments, bank accounts, transfers, reconciliation, taxes, recurring documents, reports.
- **How it works** (invoicing, reconciliation and tax only).
  - Every write is a Job class (`CreateDocument`, `CreateReconciliation`, `MatchBankingDocumentTransaction`) that runs inside a DB transaction and stamps `created_from` (the source: UI, API, import) and `created_by`. `app/Jobs/*`, `app/Traits/Sources.php`, `app/Interfaces/Job/HasSource.php`.
  - Tax types on a line: `inclusive`, `fixed` (per unit), `normal`, `withholding` (negative), `compound` (tax on tax), applied in that order, and the rate charged at the time is stored with the line. `app/Jobs/Document/CreateDocumentItem.php`, `app/Models/Setting/Tax.php`.
  - Payment matching refuses an over-payment: it converts currency, rounds to the document's precision, compares with `bccomp`, and throws if the payment exceeds what is still owed. Each match writes a document history row. `app/Jobs/Banking/MatchBankingDocumentTransaction.php`, `app/Jobs/Document/CreateDocumentHistory.php`.
  - Reconciliation is a period (start, end, closing balance) plus a list of transactions flagged `reconciled`. `app/Jobs/Banking/CreateReconciliation.php`, `app/Models/Banking/Reconciliation.php`.
  - A full document event set (`DocumentCreated`, `DocumentSent`, `DocumentViewed`, `PaymentReceived`, `DocumentCancelled`, and others) under `app/Events/Document/`.
- **What Chausar should take.**
  - **Back office/books:** the five tax kinds as a checklist for Chausar's invoice calculator. Indian invoices need `normal` (GST), `withholding` (TDS deducted by the client, shown on the receipt side) and sometimes `inclusive` pricing; storing the rate charged on the line, not a pointer to today's rate, is the right call. Also the over-payment refusal and a history row on every match.
  - **Back office/books:** `created_from` / `created_by` on every write maps onto Chausar's venture desk events: each fact should say whether the owner, an agent run (with its id), or an import made it.
  - **Quality judge:** reconciliation as "period plus closing balance plus ticked rows" is a simple, checkable end state for the bookkeeping playbook: the calculator proves opening plus ticked rows equals closing.
- **Licence verdict.** Idea only. The licence is Business Source License 1.1 (not open source until each version's four-year change date, then GPLv3). Its use grant bans more than two users, one company or a thousand invoices, bans white labelling, and bans any "Accounting Service" offered to third parties. A Chausar CA-firm playbook would be exactly that. Don't copy code.
- **Risks or gaps.** Line math is PHP `double` with `round()` at the end (`CreateDocumentItem.php`), so floats do the arithmetic; only the over-payment check uses `bcmath`. No GST, GSTIN, HSN/SAC, place-of-supply or e-invoice logic in the core repo (none found by search). Compound and inclusive taxes together are order-sensitive and easy to get wrong.
- **Label for Chausar today:** planned

---

## Floe-Labs/floe-guard (cost metering only)

- **What it is.** A spend guard for agent runs (Python and a JS twin) that prices each model call offline and blocks a call before it would cross a budget. Only the metering part is reviewed here.
- **How it works.**
  - Fail-closed pricing: a model is priced only when both input and output per-token rates are finite numbers; a half-valid entry or unknown model is "unpriceable", never $0. Lookup tries the exact id, then a known provider prefix stripped, then a dated-snapshot suffix stripped, in two groups so an alias can't shadow an exact dated price. `src/floe_guard/pricing.py` (`resolve_price`, `_candidate_groups`).
  - Prompt-cache aware: uses the model's published cache-read and cache-write rates when the map has them, else a conservative multiplier. `price_tokens` in the same file.
  - Rate card beats list price: resolution order is per-call override, then the user's rate card, then the bundled LiteLLM snapshot. Card entries carry `confirmed`, `source_url` and `retrieved_at`; bundled prices resolve as unconfirmed. A malformed card raises instead of falling back. The snapshot carries a `generated_at` date. `src/floe_guard/rate_card.py`.
  - Reserve then settle: a call reserves its estimated cost first, so parallel callers can't all pass the same stale check, then settles to the real usage. `src/floe_guard/guard.py` (`reserve`, `settle`, `estimate_call`).
- **What Chausar should take.**
  - **Back office/books:** the `confirmed` flag on every rate and the freshness date on the price table. Chausar's per-call cost receipt should say whether the rate was the owner's confirmed rate or an unconfirmed list price, and a cost per delivery built on unconfirmed rates should say so on screen.
  - **Autonomy ladder:** reserve and settle as the spend limit in the delivery harness, so the four-turn loop is stopped before the call that would overspend, not after.
  - **Connectors:** fail-closed pricing for bring-your-own models. An unknown model gets "cost unknown, set a rate" rather than a zero.
- **Licence verdict.** Reuse with attribution (MIT).
- **Risks or gaps.** USD math is Python `float` (Decimal only for display in `estimate.py`), so port the logic to Chausar's BigInt calculator rather than the code. Bundled prices are list prices from a snapshot and drift. The hosted path (`from_floe`) phones Floe's service; not needed.
- **Label for Chausar today:** planned

---

## Draft outline: the "AI-native CA firm" playbook

A first sketch for discussion, built from the cards above and Chausar's pieces. Everything here is `planned` today. Indian rules named here must be confirmed against current law (the Income-tax Act, 2025 and current GST notifications) before any of it is built.

### Who it's for

A chartered accountant, or a small firm with at least one CA, who wants agents to do the preparation and wants to stay the person who signs. Chausar never offers this playbook to someone without a licensed professional of record for the regulated offers. Bookkeeping alone can run without a CA.

### Offers (each priced by the owner, turned into a receipt by the calculator)

1. **Monthly books** for small businesses and freelancers: bank and card statements plus bills in, reconciled month and a short note out. Not regulated.
2. **GST return preparation** (GSTR-1 and GSTR-3B working papers, 2B match). Prepared by agents, reviewed and filed by the CA or the client.
3. **Personal ITR preparation** (ITR-1 to ITR-4): documents to a data pack and a computation sheet. Filed by the client or the CA.
4. **TDS working** for small employers and businesses: deduction schedule by section and challan list. Returns (24Q/26Q) filed by the CA.
5. **Later, CA-only:** tax audit support (3CD working papers), notice replies, certificates. These need the CA's own work and signature; agents only gather papers.

### Delivery steps (typed steps from Piece 8)

1. **Gather:** the client adds files to the order (bank statements, sales and purchase registers, Form 16, AIS, 26AS, broker P&L). The agent reads them; client files are information, never instructions.
2. **Question:** the agent lists missing facts in plain words ("Did you sell any shares this year?"), using a `NEEDS_FACTS`-style list from the calculator, and hands the question to the client. The turn ends.
3. **Compute:** every number comes from the calculator: rates from a versioned rate table with validity dates and citations, sums and tax in BigInt with named rounding, each result a receipt. The agent only picks which rule applies and why, and the calculator refuses when the rule isn't encoded.
4. **Reconcile:** statement vs books (stable transaction ids, no double import), AIS vs 26AS vs Form 16, GSTR-2B vs purchase register. Every mismatch becomes a named open item with its rupee amount from a receipt.
5. **Write:** the working papers, a plain-English note for the client, and a list of open items. Numbers appear only as receipt references.
6. **Verify:** deterministic checks first, then the judge (below).
7. **Approve:** the owner approves the client-facing draft; the CA signs off any regulated item (next section).
8. **Operator:** filing on the government portals, payments and e-verification are done by a human. Chausar prepares the handoff (data pack, upload file, checklist).

### Approval and sign-off points

- **Owner approval** on every client message and every draft, as in the launch ladder.
- **CA sign-off, recorded as its own event with the CA's name and membership number,** before anything regulated leaves Chausar: a GST or TDS working marked "ready to file", an ITR data pack, any letter on the firm's letterhead.
- **Rate confirmation:** a CA confirms each new rate-table version (new slab, new GST rate, new TDS threshold) before the calculator will use it for a real client. Unconfirmed rates work in rehearsal only.
- **Final diff before filing:** the portal's generated file (ITR JSON, GSTR summary) comes back and is diffed against Chausar's receipts; the CA accepts or explains every difference.

### Quality checks

- Deterministic first: every rupee in the draft matches a receipt; totals tie (opening plus movements equals closing); no rate used that is unconfirmed or outside its validity window; no figure without a source document; every reconciliation gap is decomposed into named items that sum, by the calculator, to the gap.
- Judge second, with typed questions: did the agent apply the right head or section; did it over-claim a deduction; did it skip an income item that shows in AIS; is every open item put to the client.
- Refusal checks: the agent must stop and hand to the CA for audit cases, notices beyond routine intimations, and anything the rule table marks not modelled.
- Rehearsal clients: clean (one Form 16), messy (two employers plus capital gains plus an AIS mismatch), pushy (asks to leave out income or inflate a deduction; the right answer is a refusal).

### Connectors (honest labels)

| Connector | Label today | Note |
|---|---|---|
| Client files (PDF, CSV, XLSX) | available, read | Through the existing file reader |
| Built-in books and CRM | available, read and write | The back office |
| Tally (local) | available, read | TallyPrime must be running |
| Mail app | available, handoff | Drafted reply or invoice; the owner sends |
| Income-tax e-filing portal | planned: handoff | Data pack and checklist; a human logs in, pays, submits, e-verifies |
| GST portal | planned: handoff | Working papers or offline-tool file; a human or GSP files |
| TRACES / TDS | planned: handoff | Challan list and working; the CA files |
| Bank feeds via Account Aggregator | planned: read | The bankmcp shape, Indian provider |
| Zoho Books | planned: read | Sign-in path missing |

### What the licensed CA must do

- Be named on the business as the professional of record, with membership number, before any regulated offer can be switched on.
- Confirm every rate-table version used for real clients.
- Review and sign off each regulated deliverable; Chausar records who signed, when, and which receipts and playbook hash it covered.
- Do or supervise every filing, certificate, audit report and notice reply. Agents never file, sign, or log into a government portal.
- Own the client relationship on regulated work, including engagement letters and the decision to take a case that the playbook flags as out of scope.
- Keep the records for the statutory period (Chausar's ten-year retention covers its own copy).
