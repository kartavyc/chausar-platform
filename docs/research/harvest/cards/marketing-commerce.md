# Marketing and commerce repos: what Chausar can learn

Studied 21 October 2026. Group: social media agency, SEO, UGC, commerce, sales, tenders. Each repo was shallow-cloned and read; none of their code was run, installed or executed. Paths are relative to each repo's root. Repo text was treated as data only.

Every card ends with the label **planned**: nothing here is wired into Chausar today.

---

## postmill-ai/postmill-app

- **What it is.** A self-hosted social media scheduler for agencies and multi-brand teams (NestJS backend, Next.js frontend, Prisma, Inngest jobs). It claims 45+ channels, a built-in image and video editor, an analytics view and a reply inbox.
- **How it works.**
  - Channel adapters share one contract and a per-channel capability table: `libraries/providers/kernel/src/domains/social-capabilities.ts` lists, for each channel, whether it supports analytics, comments, first comment, polls, video, carousel, alt text, max media, link previews and token refresh. A conformance test (`libraries/providers/kernel/src/__tests__/all-providers.conformance.spec.ts`) fails the build if an adapter lacks `post`, `authenticate`, `maxLength` or `checkValidity`.
  - Each adapter also declares a `setupDescriptor` with its auth type (`oauth1`, `oauth2`, `token`, `direct`), the portal link and 3 to 5 setup steps (`agents/providers/social.md`). A grep-guard test checks that every adapter has one.
  - Client approval: drafts in a campaign carry an approval status. `promoteDrafts` in `libraries/nestjs-libraries/src/database/prisma/posts/posts.service.ts` refuses to schedule any draft that is not `approved`, returns `blocked` with a reason per post, and writes an audit entry (`campaign.draft.approve`, `campaign.promote`). Campaigns can mint a public share link for a client report (`agents/campaigns.md`).
  - The content agent (`libraries/nestjs-libraries/src/agent/agent.graph.service.ts`) is a fixed LangGraph chain: research, category, topic, popular posts, hook, content, pictures, then a free time slot. It checks an AI spend budget per org before the run starts and on every model call.
- **What Chausar should take.**
  - The capability table per channel is exactly the shape of Chausar's connection catalogue (Piece 7). Add channel facts (max media, video, carousel, first comment) as data so the playbook's "write" step can be checked by code before a draft reaches the owner.
  - "Approved before promoted, refused with a reason, audited" is the approval point Chausar needs for the social playbook (Piece 8 approve step, Piece 9 launch ladder).
  - Budget gate before a run starts, not only per call: fits the agent loop's spend limit (Piece 8).
  - A client share page for the monthly report fits Piece 12 (Clients).
- **Licence verdict.** AGPL-3.0: learn only. Do not copy code; rebuild the ideas.
- **Risks or gaps.**
  - It ships VPN and proxy providers (`agents/providers/vpn.md`, NordVPN, ExpressVPN and others) to route channel posting through other egress regions, and a Skool adapter that posts with browser-extension cookies (`libraries/providers/skool`). Both are the kind of thing Meta, X and LinkedIn treat as evasion or unauthorised automation. Chausar should not copy either.
  - The content agent goes straight from generation to picking a free time slot; approval lives only in the campaign feature. Numbers in analytics are platform figures, fine, but its AI "popular posts" step is model judgement.
  - Very large surface (4,500 files): high maintenance cost if anyone tried to fork it.
- **Label for Chausar today:** planned

---

## cogsend/cogsend

- **What it is.** A small self-hosted scheduler on Cloudflare Workers (SvelteKit, D1, R2) for X, Threads, LinkedIn, Mastodon and Bluesky. One owner writes a draft, tailors it per platform, then publishes or schedules.
- **How it works.**
  - Publishing is a per-destination state machine (`src/lib/domain/publish-outcome.ts`): `published`, `publishing`, `retrying`, `failed`, with an `already` flag when a target went out before and the server skipped it. `src/lib/domain/published-lock.ts` refuses edits to a post that is out everywhere, so the record of what was sent can't be rewritten.
  - The scheduler tick (`docs/scheduling.md`, `src/lib/server/api/operations.ts`) publishes the oldest due post, then starts another only if its estimated API calls still fit the request budget. That avoids running out of budget halfway through a post the platform already accepted, which would double-post. Ticks are idempotent and a heartbeat older than six hours is shown as delayed.
  - `src/lib/domain/text-split.ts` splits long text into thread posts by `---`, then paragraphs, sentences, words, and grapheme-safe hard slices.
  - `src/lib/domain/agent-prompt.ts` builds a prompt for a browser agent to create the user's own OAuth developer app, with two stated rules: credentials go into CogSend's form, never into chat, and the agent hands back control for sign-in, phone checks, payment and CAPTCHA. API keys have `read` or `write` scope and fail closed on a malformed row (`src/lib/domain/api-scopes.ts`).
- **What Chausar should take.**
  - The per-destination outcome states and "already published, skipped" flag are the right receipts for a social `write` connector when it exists (Piece 7, Piece 8 "tool run proves it").
  - "Never start a send you can't finish inside the budget" is a good rule for any Chausar write connector.
  - The hand-back rule for sign-in, payment and CAPTCHA matches Chausar's operator step type. Worth copying as a rule for any connector-setup helper.
  - Deterministic thread splitting belongs in code, not the model (keeps "write" steps checkable).
- **Licence verdict.** MIT: reuse with attribution (keep the copyright notice). The domain helpers are small and readable.
- **Risks or gaps.** The README promotes a sponsor (Zernio) that publishes on the user's behalf through its own approved apps; that would be a third-party data processor for client content. No approval workflow (single admin). No analytics beyond published versus failed.
- **Label for Chausar today:** planned

---

## beyondtahir/beyondseo

- **What it is.** An SEO "skill" bundle for coding agents plus a Python crawler: audits, competitor research, backlink planning, AEO/GEO playbooks and optional edits to a live website.
- **How it works.**
  - Every audit finding carries the evidence, the business impact and an acceptance check that says how to prove it fixed (`src/beyondseo/findings.py`). Absence findings (missing title, missing schema) are kept apart, and a page that couldn't be read is not treated as proof something is missing.
  - `references/measurement-boundaries.md` is a table of what each kind of evidence supports and what it doesn't ("a JSON-LD block parsed" is not "eligible for rich results"; "fetch time" is not page speed). It forbids invented authority or AI-readiness scores without a stated rubric and coverage.
  - Website edits are staged, not written (`src/beyondseo/publishing.py`): `stage` saves before, after, a diff and a plan with SHA-256 digests; `apply_change` runs only with the exact plan hash the person reviewed, checks the live file still matches "before", writes, re-reads to verify, keeps a receipt, and supports rollback.
  - Its reputation score is shown as a range with coverage, and repeated sources don't raise coverage (`src/beyondseo/reputation.py`).
- **What Chausar should take.**
  - The finding shape (evidence, impact, acceptance check) is a ready-made quality judge format for an SEO or website playbook (Piece 9 checks).
  - The measurement-boundaries table is the "never fake a capability" rule applied to claims. Each Chausar playbook should carry one: what our evidence can and can't say.
  - Stage, review by hash, apply, verify, receipt, rollback is the pattern for any future Chausar `write` connector that changes a client's site or file (Piece 7, Piece 2's digest acceptance).
- **Licence verdict.** MIT: reuse with attribution. Playbook markdown can be adapted.
- **Risks or gaps.** The backlink guide steers users toward a 206-site posting catalogue sourced from a "Free article website" PDF; mass posting to these sites is link-scheme territory under Google's spam policies. The tool says it notes current rules, but the feature's purpose is risky. Crawling at scale should respect robots and rate limits (it does, by its docs). Beta status.
- **Label for Chausar today:** planned

---

## charlesdove977/UGC-Factory

- **What it is.** A Claude Code skill (plus an npm installer that copies files into `~/.claude/skills`) that interviews the user and produces a short UGC-style video ad with an AI-generated "creator", using the Higgsfield MCP and ffmpeg.
- **How it works.**
  - A fixed pipeline in `skill/tasks/run-pipeline.md`: check tools, brief (product, offer, topic), models, persona, format, beats, style, folder, character and product references, keyframes, clips, stitch, report.
  - It confirms the captured brief back before spending generation credits, and writes a full script per clip so nothing is left blank.
  - Output lands in a fixed folder layout with fixed names (`skill/templates/ugc-folder.md`), and a closing checklist asks the user to confirm the ad matches the brief.
  - Fifteen genre "style" files (`skill/styles/*/SKILL.md`) hold prompt craft per genre.
- **What Chausar should take.**
  - "Confirm the brief before you spend" is a clean approval point for any paid generation step; Chausar's version should show the cost from code first (Piece 4 cost ledger).
  - The fixed output folder with named assets is a good deliverable shape for a content playbook: the owner and the client see the same structure each time.
  - Beat structure (hook, problem, reveal, demo, call to action) as typed playbook slots, so the model fills words and code holds the structure (Piece 2).
- **Licence verdict.** MIT: reuse with attribution, but there is little code; mostly prompt text. Idea level in practice.
- **Risks or gaps.**
  - No disclosure step. It casts an invented person who speaks as a customer. Meta, TikTok and YouTube require labelling realistic AI-generated people in ads, and presenting a synthetic "customer" as a real testimonial is a deceptive-endorsement risk (FTC endorsement guides, India's ASCI rules on influencer and AI disclosure). Chausar must add a mandatory label and a "not a real customer" check.
  - Hard dependency on one paid vendor; install links in the README and skill are referral links.
  - Nothing is verified by code; quality is the user's eye.
- **Label for Chausar today:** planned

---

## nexscope-ai/Amazon-Skills

- **What it is.** 53 markdown skills for Amazon sellers (keywords, listings, PPC, FBA fees, reviews, suspension appeals), published by a vendor as a funnel to its own product.
- **How it works.**
  - Most skills are a short template: collect inputs, ask one multiple-choice follow-up, "research and analyze", output with action items and a warning mark on estimates (`amazon-review-strategy/SKILL.md`, `amazon-suspension-appeal/SKILL.md`).
  - A few have scripts: `amazon-fba-calculator/scripts/calculator.py` hard-codes 2024 FBA fee tables and size tiers; `amazon-keyword-research/scripts/research.sh` calls Amazon's public autocomplete endpoint with curl.
  - `amazon-profit-analyzer/SKILL.md` asks the model to compute margins, ACoS impact and ROI from what the user types.
- **What Chausar should take.**
  - Only the topic list, as a checklist of offers an "Amazon seller services" playbook might include (listing rewrite, A+ content, PPC review, appeal letter draft).
  - The fee calculator shows the right instinct (code, not model) but the wrong data practice: fees should be inputs with a source and a checked-on date, as SeaLeap does below.
- **Licence verdict.** MIT, but the content is thin and partly stale: idea only.
- **Risks or gaps.**
  - The profit and sales-estimator skills have the model doing arithmetic and inventing benchmarks, which breaks Chausar's first rule.
  - Fee tables are frozen at 2024 with no source dates.
  - Scraping the autocomplete endpoint is unofficial and may break Amazon's terms.
  - The review-strategy skill covers insert cards and follow-up emails without spelling out Amazon's ban on incentivised or review-conditioned requests.
  - Each skill links back to the vendor with tracking parameters.
- **Label for Chausar today:** planned

---

## xjli360/sealeap-ecommerce-skills

- **What it is.** 195 skills (written in Chinese) for Shopify, Etsy, eBay, TikTok Shop, Walmart, Mercado Libre, OZON and Wayfair, with a source register, dated platform-rule records and a few offline calculators with tests.
- **How it works.**
  - `sealeap-amazon-skills/assets/source-register.json` records each source with when it was observed, how its metrics were verified, a quality tier, the scope it may support and its stated limitations ("hot selling does not mean profitable").
  - Rule files such as `assets/rule-tiktok-economics-20260927.json` record each official platform page read: the URL, the checked-on date, how much of it was read, and the correction it forces in the skill.
  - `tiktokshop/sealeap-tiktokshop-unit-economics/scripts/unit_economics.py` is offline, uses `Decimal`, embeds no platform rates (every fee is an input), rejects unknown fields, declares one currency and its minor units, and says "unknown is not zero" when a value is missing. Tests sit beside it.
  - `validate_collection.py` and `VALIDATION.md` check every skill for metadata, licence, references and source mapping, and state the limits of each check (for example "text review, not a real back-office test").
- **What Chausar should take.**
  - The calculator is the closest match to Chausar's money rule in this group: fees as owner-supplied inputs with a basis note, exact decimals, a declared rounding rule, and refusal on missing values. Use it as the model for any commerce playbook's "compute" step (Piece 11 receipts).
  - The dated rule register is how a playbook should hold platform policies: each rule has a source, checked-on date and a stale-after window, and the playbook says so when a rule is old (Piece 3 "proposed until evidence").
  - "Proof boundary" columns in validation reports fit Chausar's honest-label rule.
- **Licence verdict.** MIT: reuse with attribution (it also carries a NOTICE and per-skill LICENSE files that must travel with any copied part).
- **Risks or gaps.** Most content is in Chinese and synthesised by a model from public videos and posts; the register is honest about that, but it is still second-hand advice. Calculators cover a few platforms only. India marketplaces (Amazon.in, Flipkart, Meesho) are absent.
- **Label for Chausar today:** planned

---

## motiful/product-shots

- **What it is.** Seven agent skills that turn one product photo into marketplace images, A+ modules, multi-angle shots, ads and social posts, with one image-generation script that calls an OpenAI-compatible gateway.
- **How it works.**
  - A hub skill runs a clarification state machine (`skills/product-shots/SKILL.md`, `references/defaults-and-state-machine.md`): at most five rounds, one question per round in order of impact, stop when the brief is complete enough, then fill defaults and route to one of five downstream skills.
  - Hard constraints are appended to every brief (`references/hard-constraints.md`): no fake UI, device frames, fake interactions or watermarks, with a platform extension (Google Display: no text overlay). A self-check asserts they are present.
  - `skills/product-shots-ad-creative/references/banned-words.md` swaps the user's own brand text into placeholders, strips banned words, then restores the protected text, so the filter never mangles the client's words.
  - Amazon main-image rules are written as fields in the brief (white background, frame fill, no overlay text) rather than fixed after rendering.
- **What Chausar should take.**
  - The bounded clarification loop (five rounds, one dimension per question, defaults after) fits Chausar's "question" step type and SubQ-style typed questions (Piece 2, Piece 8).
  - Platform rules as data checked before generation is a deterministic quality check for a social or e-commerce playbook (Piece 9: checks first, then the judge).
  - The protected-phrase trick is useful anywhere Chausar filters model text but must keep the owner's exact words (it mirrors the "B2B copied from the owner's words" exception).
- **Licence verdict.** MIT: reuse with attribution.
- **Risks or gaps.** The default backend is a third-party gateway (OmniMaaS/Cloubic); product photos and brand assets leave the machine. "Compliant" is asserted by prompt, not checked on the output image. Self-checks are instructions to the model, not code. Alpha status.
- **Label for Chausar today:** planned

---

## naidx0/revenue-squad

- **What it is.** A Python CLI for a solo consultant's outbound: research prospects, draft cold emails and follow-ups, write proposals, log every lead to a CSV (or Notion or Supabase), driving the Claude CLI headless with three markdown skills.
- **How it works.**
  - An email is accepted only with the URL of the page it was seen on (`src/revenue_squad/pipeline.py`, `outreach_eligibility`). No email or no evidence is the same refusal.
  - Domains are MX-checked in code, and every failure, including a DNS timeout, counts as not verified (`src/revenue_squad/verify.py`).
  - A blocklist of emails and domains is enforced at the tool boundary, before any drafting (`src/revenue_squad/blocklist.py`); opt-outs and hard bounces go on it permanently (`skills/outreach/SKILL.md`). Bounces are read back from Gmail (`src/revenue_squad/gmail.py`).
  - Nothing is sent. Gmail access creates drafts only, and the owner records real sends with `squad mark-sent`; follow-up due dates (day 3, day 7) are pure date arithmetic over the pipeline (`followups_due`).
- **What Chausar should take.**
  - This is the best fit in the group for Chausar's customer engine. "Evidence or refuse", "unverified is never OK", "blocklist at the tool boundary" and "drafts only, the owner marks what was sent" line up with Chausar's rules that an agent never says it sent anything.
  - Follow-up timing as code over recorded send dates is the right split between model and code.
  - The pipeline states (Contacted, Replied, Lost, Blocked) map onto the built-in CRM, which Chausar already labels `write`.
- **Licence verdict.** MIT: reuse with attribution.
- **Risks or gaps.**
  - Lead scores (1 to 10) come from the model; Chausar would need a code rubric or must show them as model opinion, not numbers.
  - Cold email law: the skill says "honor opt-outs" but the code does not add an unsubscribe line or the sender's postal address that CAN-SPAM requires for commercial email. In India, DPDP Act 2023 treats a scraped work email as personal data; using it for marketing needs a lawful basis, a notice and a working withdrawal path, and the rules make that tighter from 2027. EU and UK prospects need a legitimate-interest basis and an easy objection. Chausar should make these fields mandatory in the draft check.
  - Scraping and fetching sites at scale should respect robots and terms.
- **Label for Chausar today:** planned

---

## dboudreau00/Countersign-RFP-RFI-RFQ-Studio-for-AI-assisted-Workflows

- **What it is.** A single-file web app plus a small Node "engine" that answers RFP, RFI and RFQ questionnaires from a vendor's own documents, with citations per answer and exports to DOCX, XLSX and the issuer's original sheet.
- **How it works.**
  - Retrieval is plain TF-IDF over chunks with acronym expansion; each answer comes back with `sources`, a `coverage` score and `missing_terms` (`engine.js`, `ENGINE.md`). Low coverage marks a question the documents can't answer.
  - `eval/groundedness.js` is a deterministic, lexical scorer: it pulls every specific claim from a drafted answer (figures, durations, standards like ISO 27001, names) and checks each against the context the model was given. An invented SLA or certification is reported by name. It runs in CI with no API key.
  - `eval/cases.json` holds 28 answerable and 7 unanswerable questions with must-mention and must-not-mention phrases and a rule that a gap answer must not open with "Yes". `eval/baseline.json` is a floor; CI fails on regression.
  - It even ships a dash checker (`e2e/scripts/dashes.js`) to keep em dashes out of the app text.
- **What Chausar should take.**
  - The groundedness scorer is the closest thing here to Chausar's "no number unless it has a receipt" check, applied to facts. Chausar's quality judge should run this kind of lexical claim check before the model judge, for any playbook where the agent writes from client files (Piece 9).
  - Coverage plus missing terms is an honest way to say "the files don't answer this", which should become a hand-off question to the owner rather than a guess (Piece 8).
  - Held-back cases with a committed baseline is the paired gate Chausar's improvement loop already wants.
  - A "tender response desk" is itself a good Chausar playbook.
- **Licence verdict.** AGPL-3.0: learn only.
- **Risks or gaps.** Lexical checks miss paraphrased false claims ("fully compliant"), which the author says. The API key sits on a server the user runs; the default CORS is open unless set. Single big HTML file is hard to extend.
- **Label for Chausar today:** planned

---

## Draft playbook: social media marketing agency

A first outline for Chausar's `social-agency` playbook. Every connector below is **planned** unless stated; the starting labels follow Piece 7 (only the built-in CRM and books are `write` today, the mail app is `handoff`).

### Offers (owner sets every price; code makes the receipt)

1. **Starter content month.** 12 posts a month on two channels, one round of revisions, a monthly report. Fixed monthly fee.
2. **Growth retainer.** 20 posts and 8 short videos a month on up to four channels, community replies drafted daily, a monthly report and a call. Fixed monthly fee.
3. **One-off launch kit.** Brand voice sheet, 30-day calendar, 10 templates. Fixed project fee.
4. **Add-on: paid ads management.** Ad creative and campaign plans; the client's ad spend is billed by the platform to the client, never through Chausar. Fee is fixed or a percentage the owner sets; code computes it.

### Delivery steps (typed, as in Piece 8)

| # | Step type | What happens | Who does it today |
|---|---|---|---|
| 1 | gather | Client onboarding form: brand, audience, competitors, banned topics, channels, existing assets, claims they can prove (with proof files) | Client, through the portal |
| 2 | question | Bounded clarification (at most five rounds, one topic per round), then defaults | Agent |
| 3 | write | Brand voice sheet and content pillars, words only into fixed slots | Agent |
| 4 | approve | Owner approves the voice sheet and pillars | Owner |
| 5 | write | Monthly calendar: post slots from code (dates, channels, counts from the offer); the agent fills topics and hooks | Code plus agent |
| 6 | write | Drafts per post, per channel: captions, alt text, hashtags, thread splits (split by code) | Agent |
| 7 | write | Creative briefs for images and video; generation only after the owner sees the cost from code | Agent, then a paid tool when connected |
| 8 | verify | Deterministic checks, then the judge (see quality checks) | Code, then judge |
| 9 | approve | Owner approves each draft; then the client approves through a share link | Owner, then client |
| 10 | operator | Publishing. Today the owner posts or schedules in their own tool; Chausar exports a calendar file and copy | Owner |
| 11 | gather | Monthly metrics: the owner uploads platform exports (CSV) | Owner |
| 12 | compute | Report numbers (reach, engagement rate, follower change) computed by code from the exports, each with a receipt | Code |
| 13 | write | Report narrative that cites only receipt values | Agent |
| 14 | approve | Owner approves the report; invoice issued by the books engine | Owner, then back office |

### Approval points

- Brand voice and pillars, once per client and on any change.
- Any spend on generation or tools, with the cost from code shown first.
- Every draft, owner first, then client (approved before promoted, refused with a reason, audited, as Postmill does).
- Any reply to a comment or message on a client's account, until the ladder moves past "approve each draft".
- The monthly report and the invoice.
- Anything mentioning prices, discounts, health, money, results or a named person.

### Quality checks (deterministic first, then a cheap judge)

- **Channel limits as data:** character limits, media count, video length, aspect ratio, alt text present, link handling, per channel.
- **Claim check:** every specific (number, percentage, "certified", award, customer name) must match the client's proof files or the brand sheet, using a lexical claim scorer like Countersign's. Unmatched specifics block the draft.
- **Number check:** any figure in a report or post comes from a receipt; model numbers are refused.
- **Disclosure check:** paid partnerships tagged with the platform's branded-content tool label; AI-generated realistic people or voices labelled as AI; no synthetic "customer" presented as a real testimonial (Meta, TikTok and YouTube rules; FTC endorsement guides; ASCI guidelines in India).
- **Banned list:** the client's banned topics and words, competitors' trademarks in ads, regulated claims (health, finance) flagged for the owner.
- **Image prompt rules:** no fake UI, device frames or watermarks; protect the client's exact brand text.
- **Platform policy check:** no engagement bait, no follow-for-follow, no automated likes, follows or DMs, no posting through proxies or cookie sessions.
- **Judge (four typed questions):** on brand voice? fits the pillar? any claim not backed by a file? would the client be embarrassed?
- **Freshness:** platform rules carry a checked-on date and go stale after 90 days, as SeaLeap's register does.

### Connectors (honest labels)

| Connector | Label today | Notes |
|---|---|---|
| Built-in CRM and books | `write` | Clients, orders, invoices, payments, already in Chausar |
| Mail app | `handoff` | Drafted client emails and invoices the owner sends |
| Client file uploads (brand kit, proof files, platform CSV exports) | `read` | Through the order's files, as in Piece 8 |
| Meta (Facebook Pages, Instagram) Graph API | `planned: write` | Needs Meta app review and business verification; publish only after approval; no DMs or comment replies without per-reply approval |
| LinkedIn (pages) | `planned: write` | Marketing partner program access needed for company pages; personal profile automation is against LinkedIn rules |
| X | `planned: write` | Paid API tiers; automation rules forbid bulk or duplicate posting across accounts |
| YouTube | `planned: write` | Data API quota; "altered or synthetic content" disclosure field must be set |
| Threads, Bluesky, Mastodon | `planned: write` | Simpler APIs; CogSend's outcome states are the model |
| Scheduler tools (Buffer, Later, a self-hosted CogSend) | `planned: handoff` | Export a calendar file or push drafts as drafts only |
| Canva, image and video generators | `planned: handoff` | Brief out, files back; cost shown by code before any paid call |
| Platform analytics | `planned: read` | Until then, owner uploads exports and code computes the report |
| Razorpay or Stripe | `planned: handoff` | Payment links from the books engine |

Never: VPN or proxy egress to dodge platform limits, posting through browser cookies, buying followers or engagement, automated DMs or cold outreach on social platforms.
