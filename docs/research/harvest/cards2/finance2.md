# finance2: bookkeeping, CFO-on-demand, invoicing connectors, ERP and CRM shapes

Written 23 October 2026. Eight products, shallow-cloned and read as text; nothing was run, built or installed. Clones are in the session scratchpad under `harvest-clones/<owner>__<repo>`. The C: drive filled up during cloning, so most repos were read straight from git objects (`git show HEAD:<path>`); every path below is a path in the product's repo.

**Read this first: `Gemma41/Onchain-Accounting` is malware**, not a crypto accounting app. Details in its card. My clone of it was deleted once that was clear. Nobody should run it, and it should come off any shortlist.

Short version of the rest: no product here does Indian tax or bookkeeping. The value is in mechanisms. The ones worth taking: a marketplace-to-books posting loop that checks the money before writing and is safe to re-run (tiktok-shop-netsuite-sync), a separate "issue for real" tool behind a digest-bound, single-use human confirmation, plus upload links that keep file bytes away from the model (Lexware-MCP-Server), a four-way label on every figure and a prompt-injection test pair (cfo), a provider-agnostic invoicing interface with declared capabilities and action-oriented errors (einvoice), a citation checker with old-to-new section numbers (korean-tax-agent), and a full set of ERP and CRM record shapes, aging buckets and a code-only lead score (ZERP and its modules).

---

## vivy-yi/finance-skills (MIT, ~41 stars, last commit 2026-06-14)
What it is: a folder of Chinese-language prompt files for enterprise finance work: 35 "scene" folders, each with one master skill, three to six atomic skills, and three reference files. No code runs except a frontmatter validator. Everything targets a corporate finance department (SAP, SOX, IFRS 9, Bloomberg).
Source: partial. The prompts are all there (157 `SKILL.md` files; the README badge says 152 and the Grok row says 131). The connectors are not: `finance-skills/.mcp.json` names npm packages and MCP URLs that the repo does not provide, and `finance-skills/skills/tax-filing/.mcp.json` points at a placeholder, `https://etax.gov.example.com/api/mcp`.
How it works:
- Each scene has three knowledge files the skills read at run time: `references/判断框架.md` (judgement rules, as tables and if-then blocks), `references/数据源清单.md` (data needed, mapped to connector, system, table, field) and `references/查询路径.md` (the manual steps when no connector exists, down to SAP transaction codes like FBL5N).
- Master skill routes intent to atomic skills; atomic skills are step lists plus a fixed report template (`finance-skills/skills/accounts-receivable/skills/collection-automation/SKILL.md`).
- Collections run in five stages by days overdue: 1-30 automatic reminder, 31-60 call and email by a person, 61-90 formal letter, 91-180 lawyer letter and stop new orders, over 180 write-off or suit, each with an owner. Promise-to-pay is recorded (amount, date, method, who promised, credibility) and two broken promises move the customer up a stage (same file).
- A red-flag rule: a customer or supplier asking to change bank details, especially to a third party or personal account, pauses payment until verified through the original contact (`references/判断框架.md`, type three).
- Connector principles written down: read-heavy, write-confirm (reads run, posting, approving and sending need explicit confirmation); every skill needs a fallback to local files or manual input (`finance-skills/CONNECTORS.md`).
- Project workspace spec: each finance cycle (an audit, a tax season) is a folder with `project.md` as its single source of truth so last year's findings are not used as this year's input (`finance-skills/PROJECT_WORKSPACE.md`).
- Validator checks frontmatter, `risk_level` (low to critical), `last_reviewed`, description length and body length (`finance-skills/scripts/validate-skills.py`).
Take for Chausar:
- Business (playbook): a "collections desk" offer inside a bookkeeping service: weekly aged list, reminder drafts by stage, promise-to-pay log, escalation list for the client. The client (the business that is owed) sends or approves each reminder; the agent never sends to the debtor.
- Engine or harness mechanism: (1) the stage ladder as data: `{ fromDay, toDay, channel, sender: 'auto-draft' | 'owner', template, escalateAfterBrokenPromises: 2 }`; (2) a promise record `{ clientId, invoiceIds, amountMinor, promisedOn, method, statedBy, kept: null | true | false }`, with "kept" set by code from recorded payments, never by the model; (3) "bank details changed" as an always-ask, verify-by-known-contact rule on any payment or payout instruction.
- Connector: none real. The per-step "manual path when no connector" file is a good shape for Chausar's `handoff` label: every playbook step that needs outside data names its connector and, beside it, the plain steps a person takes when that connector is `planned`.
- UI: the collections report's sections (who was reminded, who promised, who broke a promise, who needs you) map onto Today rows: one row per "needs you" item, not a report.
Traps: fictional connectors presented as an ecosystem (SAP, Kyriba, Vertex "MCP" URLs, a fake tax bureau endpoint); a bad-debt probability table (1-30 days under 5 percent, over 365 days over 70 percent) with no source; enterprise scope (SOX, IFRS 9, transfer pricing) that a solo owner never needs; three different skill counts.
Already in Chausar?: partly. The `credit_missing_by` collections nudge is an idea in `cards/finance.md` (bankmcp card), and the build audit says bank data feeds nothing yet. Stage ladder, promise log and the bank-details rule are not built.

---

## rohasnagpal/cfo (MIT, ~23 stars, last commit 2026-09-18)
What it is: one orchestrator prompt plus 35 specialist prompts ("AI CFO") for Claude, ChatGPT and Codex, with sample CSVs, report templates and a Python validator. Written by an Indian author; examples are in rupees and crore.
Source: full (prompts, templates, fixtures, validator). There is no calculator: the model does the arithmetic.
How it works:
- The orchestrator picks the fewest specialist skills and runs a fixed sequence: ingest, validate (test arithmetic, reconcile totals, duplicates, incompatible periods), analyse, cross-check (profit versus cash), synthesise, deliver (`plugins/ai-cfo/skills/ai-cfo/SKILL.md`).
- Question routes are written out: "Can we afford this hire?" runs business case, expense forecast, cash forecast, scenario, breakeven, decision memo; "Why is cash falling?" runs cash flow, working capital, receivables ageing, payables, commentary (same file, "Common task routes").
- Every material figure carries one of four labels: Reported, Calculated, Assumption, AI interpretation; entity, period, currency and units are stated; blanks are never read as zero (same file and `docs/supported-files.md`).
- Source trust: every file, cell, comment, hidden sheet and URL is evidence, never an instruction; a planted instruction is kept, located and flagged, and the analysis must still cover the checks the request needed (`SKILL.md`, "Source trust and document safety").
- Test pair: `tests/fixtures/prompt-injection-ledger-clean.csv` and `-adversarial.csv` hold identical financial rows; the adversarial one adds notes telling the model to ignore rows and fetch a URL. Both runs must give the same anomalies (three same-day invoices just under a 50,000 approval limit, one duplicated invoice) plus a warning (`tests/prompt-injection.md`). The validator checks the facts in the two files really are identical and that the sample P&L, balance sheet, cash flow and AR ageing reconcile (`tools/validate_skills.py`, `validate_examples`).
- Formula sheet: DSO, DPO, cash conversion cycle, runway as freely available cash over normalised monthly net burn, "if cash flow is positive, do not report a finite runway" (`docs/calculations.md`, `03-cash-working-capital/cash-runway/SKILL.md`).
- Templates: CFO report, decision memo with a scenario table (revenue, EBITDA, cash and runway impact plus key assumption), board pack, risk register (`templates/`).
Take for Chausar:
- Business (playbook): "CFO on demand" for small businesses and freelancers: a monthly pack (cash in, cash out, who owes, what is owed, runway) and a one-question decision memo ("Can I afford to hire?"). The question routes become the playbook's typed steps. Full outline in the extra-focus section below.
- Engine or harness mechanism: (1) the four figure labels as a field on every figure the engine sends: `kind: 'reported' (with source file and row) | 'calculated' (with receipt) | 'assumption' (owner-set, shown beside every result that uses it) | 'estimate' (model-written)`. Chausar has receipts and "model estimate" today; "reported with a row link" and "assumption" are new. (2) the clean/adversarial fixture pair as a rehearsal case for every finance playbook: same facts, planted instruction, code compares the two runs' figures and flags. (3) "positive cash flow means no finite runway" as a calculator rule, not a prompt.
- Connector: none; reads uploaded files only.
- UI: the decision memo's scenario table is a good sheet layout for a "Can I afford it?" answer: three columns (base, downside, upside), four rows (revenue, profit, cash, runway), with the assumption under each column. Every cell a receipt button.
Traps: the model computes every number (runway, DSO, NPV) and the prompt only asks it to "show logic"; the 35 specialists are near-identical templates (same validation checks, same output sections), so depth is thin; "regulated advice" is only a disclaimer.
Already in Chausar?: receipts and "model estimate" labels are built (design section 3, `docs/venture/ink.md`); the evidence ledger's observed / inferred / needs-your-data is built. The untrusted-content screen is listed as not built (build audit, Harness). No CFO pack, cash forecast or runway exists.

---

## paid-tw/einvoice (MIT, ~160 stars, last commit 2026-08-15)
What it is: a TypeScript monorepo with one provider-agnostic interface for Taiwan's e-invoice (MIG 4.0) and six adapters for the value-added centres that sit between a merchant and the tax authority (Amego, ECPay, ezPay, ezPay cross-border, ezReceipt, Simpany). Out of scope for this build (India e-invoicing is later), recorded for its design.
Source: full, with offline tests using HTTP mocks and gated live tests. `tools/nat` is an internal scraper of the government portal, not part of the SDK.
How it works:
- Five operations modelled once: issue, void, allowance (a credit note), void allowance, query (`packages/einvoice/src/provider.ts`, `types.ts`). `orderId` is the merchant's idempotency key and can be used to query.
- Each adapter declares a `capabilities` set (B2B, mixed tax, query by order id, scheduled issue, carrier validation, foreign currency); callers use `supports()` or `assertSupports()`; a field the provider cannot carry is refused with `UNSUPPORTED`, never silently dropped (`packages/einvoice/src/capabilities.ts`).
- One error type with a coarse `code` plus an action-oriented `reason`: `duplicate_order` means query and adopt the existing invoice (the usual result of resending after a timeout); `already_voided` means treat as success; `void_blocked_by_allowance` means void the credit notes first; `past_deadline` means hand to a person; credential sub-reasons each name a different merchant fix (`packages/einvoice/src/errors.ts`; live-verified codes in `packages/einvoice-ecpay/src/client.ts`, `ECPAY_ERROR_TABLE`).
- Per-provider hint tables turn raw codes into one sentence the merchant can act on ("invoice number range used up: top it up in the provider's back office"), only for codes a person must fix (`packages/einvoice-amego/src/hints.ts`).
- Validate before the network with shared schemas; amounts are integers and `salesAmount + taxAmount = totalAmount` is enforced on issue and on allowances (`packages/einvoice/src/schemas.ts`).
- `MockProvider` runs the same validation and the state machine (no re-void, no allowance on a voided invoice), can be limited to a provider's capability profile, and `failNext()` injects one error (`packages/einvoice/src/mock.ts`).
Take for Chausar:
- Business (playbook): none on its own; it is plumbing for any playbook that issues tax invoices through a third party.
- Engine or harness mechanism: when India IRN arrives (through a GSP), copy the shape, not the code: `issue / cancel / creditNote / cancelCreditNote / query`, a declared capability set per GSP, and the `reason` table so the journal's "outcome unknown" becomes "query by our document number and adopt" instead of a manual check. The mock with `failNext()` fits Chausar's shadow mode and rehearsal cases.
- Connector: label `planned` (India e-invoicing is out of scope for this build).
- UI: the hint-table idea for every connector error: one plain sentence that says what the owner must do and where, shown only when a person must act; otherwise the agent retries or adopts quietly.
Traps: `tools/nat` logs into the Ministry of Finance portal by solving its CAPTCHA with an OCR model and gets past Cloudflare with a scripted browser (`tools/nat/README.md`, `tools/nat/lib/captcha.ts`): bot-detection evasion on a government portal, never copy. `splitTaxInclusive` and `composeTaxExclusive` use floating-point division before rounding (`packages/einvoice/src/utils.ts`). Simpany's write endpoints are marked unverified by the authors.
Already in Chausar?: no. E-invoicing (IRN, QR) is in the build audit's "not built" list. The action journal's `outcome_unknown` (design 7.2) is the place the `duplicate_order: query and adopt` rule would plug in.

---

## Gemma41/Onchain-Accounting (MIT on paper, ~78 stars, last commit 2026-10-23)
What it is: **malware.** The README promises a privacy-first crypto tax app (FIFO, LIFO, HIFO, exchange sync, encrypted ledger). The code is a dropper: it fetches an encrypted Windows program from a remote server and runs it in memory. The accounting is a decoy.
Source: present and readable as text, and malicious. Not `NEEDS-REA`: nothing about it should be reverse engineered further for Chausar.
How it works (read only, never run):
- `run.bat` unpacks a 21 MB opaque archive, `service/data/vendor.pkg`, into a hidden `.rtlocal` folder, strips the "downloaded from the internet" mark with `Unblock-File`, and falls back to a generated VBScript when PowerShell is blocked; then runs `main.py` with the bundled `python.exe`.
- `main.py` wraps its menu actions in `syncup` (`service/__init__.py`). The first menu choice starts a detached, headless interpreter that retries for up to 24 hours.
- `service/courier.py` talks to an origin stored as reversed hex in `service/sysinfo.py` (it decodes to `api.failproxy.space`, paths `/api/v1/auth/session` and `/api/v1/data/sync`), with two hard-coded fallback IPs in base64 and TLS certificate checks switched off on that fallback path, plus a hidden-window `curl.exe` fallback.
- `service/containers.py` opens AES-GCM sealed blobs (with a native Windows crypto fallback) and parses a PE header; `service/sysinfo.py` binds `VirtualAlloc`, `VirtualProtect`, `CreateThread` and `LoadLibraryA`; `service/imaging.py` maps and starts the program in memory, with Win32 names stored reversed to dodge text search.
- The only "accounting" is one `fifo_gain` function in floats inside the loader file.
Take for Chausar:
- Business (playbook): none.
- Engine or harness mechanism: one negative lesson. If Chausar ever lets owners or agents add third-party skills, tools or playbooks, screen them first: opaque archives over a size limit, launchers that unblock files or write VBScript, `ctypes` bindings to memory and thread APIs, reversed or hex-encoded strings, and TLS checks turned off are each grounds to refuse.
- Connector: none.
- UI: none.
Traps: everything. Do not run, install or copy. Grok's researcher listed it as a "crypto tax/bookkeeping service" tool; the star count is likely inflated. The repo's last commit is today.
Already in Chausar?: not applicable. The harvest README should mark it as malicious.

---

## marselsel/Lexware-MCP-Server (MIT, ~42 stars, last commit 2026-09-22)
What it is: a self-hosted, single-tenant MCP server in TypeScript for Lexware Office (a German small-business accounting service): 62 tools over contacts, articles, sales documents, bookkeeping vouchers and files, with OAuth or a static token.
Source: full, with a large test suite (`tests/`, 37 files).
How it works:
- Three tiers set by environment: read (always on), drafts (on by default), finalize (off by default, "legally binding"); `LEXWARE_READ_ONLY` overrides all (README, `src/config.ts`). Each tool carries read-only, write or destructive hints (`src/tools/shared.ts`).
- Issuing for real is a separate tool, `create-finalized-<type>`, not a flag on the draft tool. The draft tool still accepts the old `finalize` and `confirm_finalize` parameters only to fail loudly, so a stale caller never believes it issued something it did not (`src/tools/documents.ts`, `registerDocumentDraftTools`).
- Human confirmation for finalize: round one returns a form and a signed state holding a SHA-256 digest of the tool name plus stable-sorted arguments and a random nonce; the state is HMAC-signed, expires in 10 minutes and is bound to the signed-in user; round two issues only if the arguments still match the digest, the answer is yes, and the nonce was never used (`src/tools/finalize-confirmation.ts`). The file says plainly that `confirm_finalize` alone is a value the model sets.
- HTTP client: about 2 requests a second (token bucket); 429 always retried, honouring `Retry-After` clamped to 250 ms to 30 s; transport errors and 5xx retried only for GETs; a POST that creates a document is never retried on an ambiguous failure, and the error says so; ids of `.` or `..` refused so a crafted id cannot retarget the call (`src/lexware/client.ts`).
- Upload tickets: the model calls `create-upload-ticket` and gets a link; the person drops the file on a plain page (or runs a curl line); bytes go person to server to Lexware; the model reads back only a file id. Ticket is 192 random bits, single use, 15 minutes, write-only, with an in-flight lock so a retried or leaked request cannot attach twice; the result stays readable for 15 minutes after completion (`src/uploads/tickets.ts`, `src/uploads/page.ts`).
- Server-side fetch of a share link is off by default and, at every redirect hop, checks a host allow-list on a dot boundary, rejects private, loopback, link-local and metadata addresses in every spelling, and pins the socket to the address it checked (`src/uploads/fetch-url.ts`, `src/uploads/pinned-fetch.ts`).
- `summarize-vouchers` pages through everything server-side and returns counts and sums by type, status, month, contact or currency, echoes every filter that narrowed the scan, and flags `truncated` when it hit the page cap (`src/tools/documents.ts`).
- The server's instructions to the model are built from the enabled tiers, so they never mention a tool that is not registered, and are written as facts, not orders (`src/instructions.ts`).
Take for Chausar:
- Business (playbook): a bookkeeping service that files the client's receipts into the client's own accounting system: the client drops receipts on a link, the agent drafts vouchers, the bookkeeper approves, the system of record stays the client's.
- Engine or harness mechanism: (1) a client **file-request link**, the write-only twin of Chausar's read-only share links: `{ tokenHash, businessId, orderId, purpose, maxFiles, expiresAt, usedAt, inFlight }`, single use, short expiry, bytes stored as order files without passing through model context, the agent sees a file id and a size. (2) "draft" and "issue" as different actions with different floors: issue is always-ask; a stale "issue" flag on a draft call is an error. (3) in every write connector, never auto-retry a create on an ambiguous failure; hand it to the journal as `outcome_unknown`. (4) every total the engine sends carries the filters that made it and a `truncated` flag.
- Connector: Lexware itself is Germany-only, so `planned` at most. The pattern applies to Zoho Books and Tally writes: today Chausar's accounting adapters are read-only (`platform/runtime/adapters/accounting/*.ts`).
- UI: the upload page's wording is right for a client: "The file goes straight to this server and on to [the books]. It never passes through the model context." and "valid for 15 minutes, single use" (`src/uploads/page.ts`). The finalize prompt names the document, recipient, date, line count and the consequence in one sentence ("It becomes legally binding and can never be edited or deleted", `finalizePrompt` in `src/tools/documents.ts`).
Traps: `summarize-vouchers` adds amounts as JavaScript floats and rounds at the end; in-memory ticket and nonce stores mean one instance only; claude.ai shows no elicitation form yet, so the human check depends on the client app.
Already in Chausar?: partly. Single-use approval tokens bound to action, member, session and business are built (`docs/venture/ink.md`, Journal and posture). Share links are read-only previews (same file). No file-request link, no accounting write connector, no SSRF guard (build audit lists the SSRF guard under Creator, not built).

---

## minsooparkk/korean-tax-agent (MIT, ~19 stars, last commit 2026-10-12)
What it is: a Claude Code skill that answers Korean tax questions by searching a hosted legal database (statutes, rulings, interpretations, treaties) through MCP and writing a cited review opinion, in an easy mode (search, answer, check citations) and a hard mode (four sub-agents).
Source: partial. The skill and its four method files are all here. The law database and its tools (`search_tax`, `get_article`, `verify_citations`) are a hosted service at `mcp.taxdoctorai.com` (`.mcp.json`); its server is a separate repo, not read.
How it works:
- Hard mode: query analysis, then source search, then fact check, then answer, then one citation check. The orchestrator passes each stage's JSON on unchanged and makes no legal judgement itself (`skills/tax/SKILL.md`, section 3).
- Query analysis decides whether to stop and ask: only when the user wants a conclusion about their own facts and a missing fact changes the answer; good questions are specific ("When did you buy and when will you sell each house?") and are passed to the user word for word (`references/query-analysis.md`, sections 2 and 6).
- Timing rule: the law applied is the version in force on the transaction date (`as_of`), taken from the transitional provisions; a future amendment is reported with its start date; a wrong date is worse than none, so it is never guessed (`references/query-analysis.md`, section 5).
- Fact check returns `what_supports`, `what_conflicts`, `unknowns`, `coverage_analysis` (fully, partly, not covered) and at most one supplementary search; contrary authority must be shown, and "no rule exists" is a valid finding only after a real search (`references/fact-check.md`).
- Each piece of evidence says whether it came by a verified citation link (`graph`) or only by keyword match (`fulltext`), and summary-only documents never get high confidence (`references/source-search.md`, section 4).
- Citation check after writing: every section and case number in the answer is looked up; `not_found`, a wrong title, an old number (`current_number`, `moved_hint`) or an overturned judgement becomes a "citation note" above the disclaimer; `unchecked` never counts as a pass (`SKILL.md`, section 4).
- Answer shape for judgement questions: facts relied on, the question, a three-to-five line conclusion first, then the reasoning; simple lookups get a few cited sentences and no headings (`references/answer-generation.md`).
Take for Chausar:
- Business (playbook): a "tax question desk" add-on to the AI-native CA firm: clients ask, the agent drafts a cited note, the CA signs off before it goes out (regulated advice stays with the CA).
- Engine or harness mechanism: (1) a **citation checker** for the CA firm playbook: every section number in a draft is checked by code against a local, CA-confirmed table `{ act, section, title, validFrom, validTo, replacedBy }`. That table carries the Income-tax Act 1961 to Income-tax Act 2025 renumbering, so a draft citing an old number for income after 1 April 2026 is flagged with the new number. This answers the open question in design section 10. (2) `as_of` on every tax working: the rate and section table version is picked by the transaction date, never "today". (3) the stop-and-ask gate as the `NEEDS_FACTS` loop the build audit lists as missing. (4) the fact-check JSON as the judge's evidence format for advice drafts.
- Connector: the hosted Korean law MCP is irrelevant for India. The Indian equivalent would be a `planned: read` source of bare acts and notifications; until then the section table is CA-maintained data.
- UI: the "citation note" line is a good pattern for any draft row in Today: a short list under the draft, "Section 80C: moved to section 123 for income after 1 April 2026" (example only, numbers to be confirmed by a CA), shown before Approve unlocks.
Traps: the database is a third-party hosted service with no stated terms; "verify_citations" checks only that a number exists, not that it supports the claim (the authors say so); Korean law only.
Already in Chausar?: no. The Income-tax Act 2025 renumbering is an open question (design section 10, `docs/venture/ink.md` Known limits); `NEEDS_FACTS` is listed as not built (build audit, Finance). Rate tables have validity windows from the opentax-engine card (`cards/finance.md`), but nothing checks section citations.

---

## andrewkushnerov/tiktok-shop-netsuite-sync (MIT, ~1 star, last commit 2026-09-19)
What it is: a small Python script that books TikTok Shop orders in NetSuite: paid orders become cash sales, orders cancelled after posting become cash refunds linked to the sale. Built as a showcase for a freelance data engineer.
Source: full, with pytest tests on synthetic orders (`tests/`). The authors say no live call has been verified yet (`CLAUDE.md`, Status).
How it works:
- `mapping.decide()` is pure (no network, no clock) and checks in a fixed order: not self-fulfilled, skip; cancelled with refund already posted, nothing; cancelled with sale posted, refund; cancelled before posting, skip; unpaid or on hold, skip; money does not add up, skip with the reason; zero total, skip; a SKU with no item, skip; no sale yet, create; posted total equals ours, nothing; otherwise rewrite (`mapping.py`).
- Money checks before anything is written: `goods - seller discount - platform discount = subtotal` and `subtotal + shipping + tax = total`, to one cent, in integer cents through `Decimal` (`money_problems` in `mapping.py`).
- If line prices ever disagree with the order total, the gap is spread in proportion and the rounding remainder goes to the largest line, never all onto one line (`_fit`).
- Idempotency: every record has an external id `TikTok-<shop>-<order id>` (refund adds `-refund`); one query per page finds what exists; a failed lookup raises and stops the run, because reading "nothing found" as "nothing posted" would post everything twice (`netsuite.find_transactions`, `sync.main`).
- Dry run by default: one line per order, "create / refund / skip", the amount and the reason, then a summary; `--write` posts; `--show-payload` prints the exact body (`sync.py`).
- The booking date is the order's day in the shop's timezone, not UTC (`business_date`).
- Tax is left off the sale because in the US the marketplace collects and remits it (`mapping.py` docstring).
- The README's "What it does not do" (settlements, fees, payouts, partial refunds, returns) is described in `CLAUDE.md` as "where the maintainer's paid work starts".
Take for Chausar:
- Business (playbook): "marketplace seller books": monthly posting of Amazon, Flipkart, Meesho or Shopify orders and settlements into the seller's Zoho Books or Tally, plus a settlement reconciliation (fees, commissions, TCS and TDS withheld, payout) as the paid add-on. The bookkeeper approves each batch after a dry run.
- Engine or harness mechanism: the whole loop is the right shape for Chausar's first accounting **write** connector: a pure decision function with ordered rules and a reason on every skip; money checks by the calculator before a proposal is made; an external id on every posted record; "can't read what exists" stops the run; the dry run is the journal's described step, `--write` is applied after approval. The skip reasons become Today rows ("3 orders skipped: a SKU has no item in your books").
- Connector: marketplace order read (`planned: read`), books write (`planned: write`, approval per batch).
- UI: the dry-run table is the approval row's content: one line per order with action, amount (engine-formatted) and reason, a count summary, and "nothing is written until you approve".
Traps: **the tax rule does not carry over to India.** In India the seller owes GST on a marketplace sale; the marketplace withholds TCS under the GST law and TDS under the income-tax law, which become credits to reconcile, not a reason to leave tax off. A CA must confirm the current sections and rates (the Income-tax Act 2025 renumbering applies). Also: amounts become floats at the JSON edge; NetSuite token auth closes to new integrations from 2027.1 (README).
Already in Chausar?: no. Accounting adapters are read-only; the commerce (Amazon) playbook is not built (build audit, Marketing). The journal (described, approved, applied, outcome unknown) is built and would host this.

---

## zerp-pk/zerp (MIT, ~26 stars, last commit 2026-09-07; modules `account` 2026-07-28, `lead` and `double-entry` 2026-09-07)
What it is: a Laravel 12, Inertia and React (TypeScript) ERP shell: auth, roles, plans, billing, media, sales and purchase invoices, proposals, returns and warehouses in the core; accounting, CRM, POS, HRM and 27 more features as separate MIT repos that the core expects as sibling folders.
Source: partial in the core repo. Accounting and CRM live in `zerp-pk/account`, `zerp-pk/double-entry` and `zerp-pk/lead` (listed in the core README), which I also cloned and read. POS and the rest were not read.
How it works:
- Sales invoice record: number, invoice date, due date, customer, warehouse, subtotal, tax, discount, total, paid, balance, status `draft | posted | partial | paid | overdue`, type `product | service`, payment terms (`database/migrations/2025_09_26_102340_create_sales_invoices_table.php`). Lines keep quantity, unit price, discount percent and tax percent, plus one row per tax with its name and rate at the time (`..._create_sales_invoice_item_taxes_table.php`). Purchase invoices, returns and proposals mirror it.
- Overdue is derived for display (`due_date < now and status != paid`, `display_status` in `app/Models/SalesInvoice.php`) and for filtering (`SalesInvoiceController::index`).
- Posting checks stock per warehouse, fires `PostSalesInvoice` for the accounting module, then sets `posted` (`SalesInvoiceController::post`). An accepted proposal converts to a draft invoice once (`converted_to_invoice`, `SalesProposalController::convertToInvoice`). A sales return creates a credit note through a listener (account module `src/Listeners/CreateCreditNoteFromReturn.php`).
- Account module records: customers and vendors; chart of accounts and opening balances; customer payments `pending | cleared | cancelled` with allocations `{ payment_id, invoice_id, allocated_amount }` and credit-note applications; vendor payments and debit notes mirrored; journal entries `automatic | manual` with `reference_type` and `reference_id`, status `draft | posted | reversed`, and debit/credit lines; bank transactions with running balance, `pending | cleared | cancelled` and `unreconciled | reconciled`; revenues and expenses with categories and `draft | approved | posted` (`zerp-pk/account`, `src/Database/Migrations/`).
- A payment changes invoice balances and writes its journal entry only when it is marked cleared (`src/Http/Controllers/CustomerPaymentController.php`, `updateStatus`).
- Reports: invoice aging and bill aging with an as-of date in five buckets (current, 1-30, 31-60, 61-90, over 90), per customer and in total; customer and vendor balances; tax summary; income statement (`src/Services/ReportService.php`, `src/Resources/js/Pages/Reports/`).
- Four role dashboards: company, staff, client ("what I paid, my credit notes") and vendor ("payments to me, my debit notes") (`src/Http/Controllers/DashboardController.php`, `src/Resources/js/Pages/Dashboard/*.tsx`).
- CRM: pipelines; lead and deal stages with a win probability (0-100); leads with expected value, expected close date, score and conversion flag; deals with price and lost reason; tasks typed (to-do, call); calls, emails, discussions, files and activity logs (`zerp-pk/lead`, `src/Database/Migrations/`).
- Lead score: owner-defined rules `{ field, operator: is_set | equals | gte | lte, value, points }` over a fixed list of signals (email set, phone set, expected value, close date set, source, activity count, call count); the score is matched points over possible points, 0-100, computed by a pure function and recomputed when rules or signals change (`zerp-pk/lead`, `src/Support/LeadScoring.php`).
Take for Chausar:
- Business (playbook): the record set a bookkeeping service needs for a client who has no books: sales, purchases, payments with allocations, credit notes, expenses, bank lines. Also a "small-business back office setup" offer: the bookkeeper sets up the client's customers, vendors, categories and opening balances in the client's chosen system.
- Engine or harness mechanism: (1) **purchases and "what you owe"**: a bill record and vendor payments, so Money can show cash out and money owed, not only AI spend; `docs/venture/ink.md` says purchases are not in Chausar. (2) payment `pending` then `cleared`, with only cleared money counted in "came in". (3) one payment allocated across invoices plus credit notes applied, with the calculator refusing over-allocation (ZERP does not refuse; akaunting does, per `cards/finance.md`). (4) credit note linked to its original invoice. (5) aging buckets with an explicit as-of date. (6) the lead score rubric as owner-editable data, computed by code, each matched rule shown as the reason. (7) lost reasons as a fixed owner list. (8) stage probability for a weighted pipeline figure computed by the calculator and labelled as a forecast.
- Connector: none; ZERP is a self-hosted app, not a service to connect to.
- UI: the client and vendor dashboards suggest a client-facing "what you owe us" page on Chausar's share links (open invoices, paid so far, credit notes), read-only. The aging report's five columns per customer are the right "who owes you" list. ZERP's own look (coloured cards, gradients) does not fit Ink.
Traps: money is `decimal(15,2)` in the database but totals are added as PHP floats (`calculateTotals`) and again in React (`resources/js/pages/Sales/components/TaxCalculator.tsx`); line amounts are not even saved on creation (`createInvoiceItems`); posting fires the event before setting the status, outside a transaction; invoice numbers are "last plus one" with no lock; the company dashboard sums revenue and payments regardless of draft or pending status; the core dashboard page is three grey placeholder boxes (`resources/js/pages/dashboard.tsx`); `customer_id` cascades on delete, so deleting a user deletes their invoices; no tests touch invoices, payments or money (`tests/`).
Already in Chausar?: partly. Built: invoices draft to issued with due dates, payments checked against the balance (`platform/runtime/venture/money/payments.ts`), books billed / received / earned (`books.ts`), an aging operation in the calculator (`platform/runtime/calculator.ts`), leads with blocklist (`venture.leads.*`). Not built: purchases and bills (`docs/venture/ink.md`, Known limits), payment allocation and credit notes, an aging view in Money (the Ink Money place shows three lines and open invoices, `app/ui/src/places/money/Overview.tsx`), lead scoring (build audit, Marketing), and any chart part in Ink.

---

## Extra focus 1: a bookkeeping and CFO-on-demand service a self-employed person could sell

A first sketch for discussion, built from the cards above. Everything is `planned`. It needs no licensed professional because it files nothing with the government; tax returns go to the CA firm playbook.

Who runs it: a bookkeeper, an accountant without a practice certificate, or a finance-minded freelancer, serving shops, agencies, creators and online sellers.

Offers (the owner sets each price; the calculator turns it into a quote with a receipt):
1. Monthly books: bank lines, sales and purchases in; a reconciled month, open items and a short note out.
2. Collections desk: weekly aged list, reminder drafts by stage, promise-to-pay log; the client sends.
3. Marketplace seller books: orders and settlements posted to the client's Zoho Books or Tally after a dry run; settlement reconciliation as an add-on.
4. Monthly CFO pack: cash in and out by month, who owes and what is owed by age, runway, and a 13-week cash view.
5. Decision memo on demand: one question ("Can I afford a second editor?") answered with three scenarios.

Steps (typed): gather (read connectors where they exist, a client file-request link otherwise); validate (code checks totals, periods, duplicates; source rows kept); reconcile (stable ids, no double import); compute (calculator only: aging, cash by month, runway, scenarios; each owner input is an "assumption" figure); write (the pack, every figure labelled reported, calculated, assumption or estimate); verify (deterministic checks, the clean/adversarial ledger pair, the judge); approve (owner, then client by share link); deliver.

What the owner approves: every client-facing pack and memo; every batch posted to a client's books (after its dry run); every reminder draft (the client sends it); any change to a payment instruction (always-ask, verified with a known contact).

How it earns: monthly retainers by transaction band for offers 1 to 4, and a fixed fee per memo.

## Extra focus 2: owner money views that are visual and easy (Ink-compatible)

- **In and out, by month.** Twelve months, two thin bars per month (in: ink, out: grey), month labels under them. Each month opens its receipt. The engine sends display strings and bar heights already scaled to 0-100 by code, so the UI still adds nothing up. Needs purchases or expenses for "out" (ZERP shape).
- **Who owes you.** One horizontal bar split into five age buckets (current, 1-30, 31-60, 61-90, over 90) in greys, labels under it in words, then clients oldest-first with "62 days late" as text. The calculator's aging operation already exists; it needs a Money view and an as-of date line.
- **What you owe.** The same view for bills, once purchases exist.
- **Next 13 weeks.** One line of expected cash by week from dated invoices and bills, marked "forecast", with its assumptions listed under it. "Cash flow is positive" shows no runway figure (cfo rule).
- Only failure earns a hue in Ink, so the visuals carry no red or green; words carry the meaning. Ink has no chart part yet (`app/ui/src/parts/`), so this needs one `Bars` part and one `Line` part fed only by engine values.

## Extra focus 3: ERP and CRM data shapes Chausar lacks

| Record | Fields worth taking | From |
|---|---|---|
| Bill (purchase invoice) | vendor, number, date, due date, lines with tax name and rate at the time, status draft / posted / partial / paid, overdue derived | ZERP core migrations |
| Payment | status pending / cleared / cancelled; allocations `{ invoiceId, amountMinor }`; credit applications; only cleared counts | ZERP `account` |
| Credit note | original invoice, lines, reason, applied amount, status partial / applied | ZERP `account`, einvoice allowance |
| Expense | category, account, bank account, status draft / approved / posted | ZERP `account` |
| External posting | `externalId` per record posted to an outside system, `-refund` suffix for reversals | tiktok-shop-netsuite-sync |
| Lead | stage with probability, expected value, expected close date, score, lost reason | ZERP `lead` |
| Score rule | field, operator, value, points; score = matched over possible, 0-100 | ZERP `lead` `LeadScoring.php` |
| Promise to pay | client, invoices, amount, promised date, method, who promised, kept (set by code) | finance-skills |

---

## Ideas worth taking, ranked by value

| Idea | From | Kind | Value for B2C owners | Effort |
|---|---|---|---|---|
| Bookkeeping and CFO-on-demand playbook (monthly books, collections desk, CFO pack, decision memo) | cfo, finance-skills, ZERP, tiktok-shop-netsuite-sync | playbook | high | L |
| "Who owes you" aging view: five buckets with an as-of date, clients oldest first, figures from the existing calculator aging operation | ZERP `ReportService.php`, cfo receivables-ageing | UI | high | S |
| "In and out by month" bars and a 13-week cash line, engine-scaled values only, assumptions listed | cfo cash-forecast and runway, ZERP company dashboard | UI | high | M |
| Purchases, bills and expenses so Money can show cash out and what you owe | ZERP `account` migrations | engine | high | M |
| Marketplace-to-books write loop: pure decide with ordered rules, money checks first, external ids, lookup failure stops, dry run as the approval row | tiktok-shop-netsuite-sync `mapping.py`, `sync.py` | connector | high | M |
| Client file-request link: write-only, single-use, short expiry, in-flight lock, bytes never in model context | Lexware `src/uploads/tickets.ts` | connector | high | M |
| Four figure kinds: reported (row link), calculated (receipt), assumption (owner input), estimate | cfo `SKILL.md` | engine | high | M |
| Clean/adversarial ledger fixture pair as a rehearsal case for every finance playbook | cfo `tests/prompt-injection.md` | engine | high | S |
| "Payment details changed" is always-ask and verified through a known contact | finance-skills AR judgement framework | engine | high | S |
| Section-citation checker with a CA-confirmed table carrying the 1961 to 2025 Act renumbering, plus `as_of` by transaction date | korean-tax-agent `SKILL.md` section 4, `query-analysis.md` section 5 | engine | high | M |
| Collections stage ladder and promise-to-pay log, kept set by code from payments | finance-skills `collection-automation/SKILL.md` | playbook | high | M |
| Payment pending then cleared; allocations across invoices; credit notes applied; over-allocation refused | ZERP `CustomerPaymentController.php` (minus its gaps) | engine | med | M |
| Lead score rubric as owner-editable data, computed by code, matched rules shown as reasons; lost reasons list | ZERP `lead` `src/Support/LeadScoring.php` | engine | med | S |
| Stop-and-ask gate before research when a missing fact changes the answer (the `NEEDS_FACTS` loop) | korean-tax-agent `query-analysis.md` | engine | med | S |
| Fact-check evidence format: supports, conflicts, unknowns, coverage, one supplementary search | korean-tax-agent `fact-check.md` | engine | med | M |
| Draft and issue as separate actions; a stale issue flag on a draft fails loudly; issue is always-ask | Lexware `src/tools/documents.ts` | engine | med | S |
| Never auto-retry a create on an ambiguous failure; 429 always retried with a clamped wait | Lexware `src/lexware/client.ts` | connector | med | S |
| Totals carry the filters that made them and a `truncated` flag | Lexware `summarize-vouchers` | engine | med | S |
| Connector capability sets with refuse-not-drop for unsupported fields | einvoice `capabilities.ts` | connector | med | S |
| Action-oriented error reasons (duplicate: query and adopt; already done: success; past deadline: person) and one-sentence fix hints | einvoice `errors.ts`, `einvoice-amego/src/hints.ts` | connector | med | S |
| Client-facing "what you owe us" page on share links | ZERP client dashboard | UI | med | M |
| Mock provider with the same validation, state machine and `failNext()` for shadow and rehearsal | einvoice `mock.ts` | engine | med | S |
| Question-to-steps routes ("Can I afford a hire?" to business case, costs, cash, scenarios, memo) | cfo `SKILL.md` | playbook | med | S |
| Per-step manual path when a connector is `planned` | finance-skills `查询路径.md` | playbook | med | S |
| SSRF guard for any fetch-by-URL: allow-list on dot boundary, resolved-address check, socket pinning, every hop | Lexware `fetch-url.ts`, `pinned-fetch.ts` | engine | med | M |
| Supply-chain screen for imported skills and tools (opaque archives, unblocking launchers, memory-loader bindings, encoded strings) | Onchain-Accounting (negative example) | engine | med | M |
| Proposal accepted converts to one invoice, once | ZERP `SalesProposalController.php` | engine | low | S |
| Server instructions built from enabled tools only, written as facts | Lexware `src/instructions.ts` | engine | low | S |
| Rounding gap spread in proportion, remainder to the largest line | tiktok-shop-netsuite-sync `_fit` | engine | low | S |
| Playbook files carry `risk_level` and `last_reviewed`, checked by a validator | finance-skills `validate-skills.py`, cfo `validate_skills.py` | playbook | low | S |
