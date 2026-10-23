# Marketing group: second harvest (23 October 2026)

Nine products from the "Marketing" rows of `oss-researcher-71.tsv`. Each was shallow-cloned into its own folder under `C:\Users\karta\AppData\Local\Temp\claude\D--claude-chausar-2\9629065d-c889-4ae9-bf61-c82904c8e5ca\scratchpad\harvest-clones\<owner>__<repo>\` and read with file tools only; nothing was installed, built or run, and instruction-like text in the repos was treated as data. Licences and star counts come from the GitHub API on 23 October; dates are the last commit in the clone.

Note: drive C: was full (0 bytes free) while this was written, so shell output failed after the clones landed. All nine clones were checked with `git status` (no optional locks) and match their commits; reading was done with Read, Grep and Glob.

Paths in "How it works" are relative to each product's repo. Paths under "Already in Chausar?" are relative to `D:\claude\chausar-platform` unless they name a harvest file.

---

## mrlong0129/yominpost (MIT, 99 stars, last commit 2026-10-06)
What it is: A self-hosted studio (FastAPI, SQLite, a no-build JS front end) that turns one piece of material (text, a page URL, image links) into one draft per connected channel, runs a code risk gate on each draft, and posts through OAuth connectors now or on a schedule.
Source: full (Python app, web UI, CLI, MCP server, pytest suite). The web UI is in Chinese. TikTok, Xiaohongshu, Threads and Pinterest use a mock connector.
How it works:
- Compose loop `yominpost/services.py` `_compose_core` (line 254). `parse_material` splits text, page URLs, image and video links and fetches up to two pages through an SSRF guard that re-checks every redirect hop (`_is_public_url`, `_fetch_page`). Operator notes are kept out of the material, so instructions never end up inside the copy. Then per channel: analyze, research, strategy, write, QA, and a critique-and-rewrite loop capped at 4 rounds.
- Format comes from rules, not the model: `yominpost/stages/router.py` gives video-first platforms a short video, visual platforms a carousel when the angle is a list, X a thread for list angles or priority 0.8 and up, LinkedIn long text, and writes each rule hit to `rule_trace`. The compose loop then clamps the model's plan to what the installed tools can make (`usable_kinds` in `yominpost/capabilities.py`): no image tool and no user image means text.
- Pre-post risk gate `yominpost/platform_risk.py`: a per-platform `POLICY` table (24-hour cap, minimum gap, hashtag cap, warm-up days and warm-up cap; Instagram is 2 a day, 180 minutes apart, 14-day warm-up). A prompt-leak regex ("as an ai", "here is a post", "[hook]") blocks. An engagement-bait regex blocks on Meta platforms and warns elsewhere. Token Jaccard against the channel's last 5 posts blocks at 0.85 and warns at 0.6. A same-domain link in 2 of the last 5 posts warns. Block-level issues stop the post before the connector is called (`_publish_targets`, services.py line 999). Tests: `tests/test_platform_risk.py`.
- Circuit breaker: `is_platform_block` matches block wording ("api access blocked", "action blocked", "checkpoint_required") and is kept apart from token expiry. `freeze_channel` freezes the channel for 72 hours and writes a notice telling the owner not to retry or reconnect; publishing, health probes and even content sync then skip that channel.
- Double-post safety: an atomic claim (`UPDATE ... WHERE status='scheduled'`), targets already posted are skipped on retry, each target is saved as it finishes, and a post stuck in `publishing` after a crash becomes `failed` with "state unknown, check the platform", never rescheduled (`recover_stuck_publishing`, line 1097).
- Account health `yominpost/account_intel.py` and `platform_health.py`: facts come from script (followers, observable account age, posts in 30 days, failures), the grade follows each platform's own mechanism (Reddit karma and verified email, YouTube good-standing flags, Mastodon suspended or limited), and each result is tagged `api`, `dashboard` (the platform has it but no API, so "check in the app") or `derived`. A model may write the narrative but is told not to invent numbers, with a rule-based fallback.
- The MCP server has no publish tool on purpose (`yominpost/mcp_server.py`): agents can generate, check and save drafts only.
Take for Chausar:
- Business: a "repurpose pack" offer in the social playbook (playbook C below): one client input becomes a week of channel-native drafts.
- Engine: (1) the risk gate as code before every post in owner-browser-session or API mode, with the shape `{level: block|warn, code, msg}` per channel and the policy numbers held in the dated register with a source. (2) The platform-block breaker, separate from auth errors, that freezes reads too. (3) The format router as code, with its rule trace shown to the owner. (4) A prompt-leak lint on every outbound draft (posts, emails, articles).
- Connector: reference OAuth2 + PKCE posting code for X, LinkedIn, Reddit, Facebook Page, Instagram, YouTube Shorts, Mastodon, Bluesky, Telegram, Discord and webhooks (`yominpost/connectors/oauth_conn.py`, `real.py`, `yominpost/oauth_specs.py`). Chausar's label stays `planned: write` per channel until its app review clears. Read: Graph API account metrics (`account_intel._platform_metrics`).
- UI: the Create-post canvas (`yominpost/web/static/index.html` `#canvas`; `app.js` `cvCard`, line 1598). Chat on the left, one card per channel on the right. While working, a card shows the current stage and a percentage; when done it shows format, language, which engine wrote it (a warning chip when a template fallback wrote it), editable hook, body, CTA and hashtags, and Save draft, Schedule, Publish. "Refine just this one" (`cvFocus`) scopes the next chat message to one card; naming a platform in chat rewrites only that card, and "add X" adds a channel (`cvHandleAdjust`, line 1697). Publish first runs a preflight that lists blocks and warnings per platform (`riskPreflight`, line 45). The Connections card shows health in the platform's own words and says where the data came from.
Traps:
- QA scores are model-written (`yominpost/stages/qa.py`): the model's `overall` picks between drafts and shows on the card as "QA 87". In Chausar that is a "model estimate" or a yes/no rules judge, never a score.
- The "research" stage asks the model for platform "algorithm notes" and "winning formats" with no source: opinion shown as research.
- The mock connector returns success, so the post is stored as `posted` with a `sandbox` flag (`yominpost/connectors/mock.py`, line 66). Chausar's shadow results must never read as posted.
- `capabilities.py` reports the Jimeng tool as available when a key is set, while its own note says it is not implemented and falls back: a quiet fake capability.
- The `POLICY` numbers are conservative guesses from docs and other schedulers. Hold them in Chausar's dated register with a source and a checked-on date, not as fact.
Already in Chausar?: Engagement-bait and hashtag caps exist as draft checks (`platform/runtime/venture/playbooks/social/checks.ts`; rule `meta-engagement-bait` in `register.ts`). The owner-session risk line exists (`platform/runtime/venture/build/posting.ts`, `OWNER_SESSION_RISK`), and the journal's "outcome unknown" covers the crash case. Per-destination post states were taken from CogSend on 21 Oct (`cards/marketing-commerce.md`). Not built: cadence and warm-up caps, near-duplicate and link-streak checks, prompt-leak lint, the freeze breaker, account health.

---

## yaojingang/GEOHub (AGPL-3.0, 165 stars, last commit 2026-08-31)
What it is: A Python CLI and skill pack for AI-search visibility (GEO). It diagnoses a public site on eight weighted dimensions, measures a brand's visibility from recorded AI-answer observations, drafts evidence-lined content and plans gated experiments; everything is offline except bounded fetching.
Source: full (src, schemas, tests, evals). AGPL-3.0-only; commercial licence is "inquiry only". Learn only: describe the ideas, copy no code.
How it works:
- Site diagnosis `src/geo_seo_hub/site_diagnose.py`: from one URL it picks up to 10 representative page types (homepage, offering, proof, comparison, pricing, FAQ and so on), runs 19 checks per page and scores 8 dimensions with fixed weights (evidence and citability 16, answerability 15, AI access 15, and so on). A check it could not observe is `missing-evidence` with a null score, never 0. Confidence is observed checks over planned checks, and a page that would not load is a `source_gap` that still counts in the planned total.
- Crawler matrix `_crawler_matrix` (line 530): robots.txt is read per agent and each agent has a role, search (OAI-SearchBot, Googlebot, Bingbot) or training control (GPTBot, Google-Extended). Only search agents count toward the access score.
- Remediation backlog `_remediation_backlog` (line 902): failed checks grouped across pages, each with severity, impact 1 to 5 derived from the dimension weight, effort, affected pages and evidence ids.
- Measurement `src/geo_seo_hub/intelligence/measurement.py`: a pre-registered panel of queries × engines × timepoints × repetitions. Every observation is validated against it (no duplicate slot, same query text, same panel version, one collection method per bundle: `manual_export`, `approved_api` or `recorded_fixture`; see `schemas/engine-observation-bundle.schema.json`). Each metric (mention rate, source inclusion, citation share, position-weighted visibility, coverage) carries numerator, denominator and missing count, and missing slots stay in the denominator. A bundle of recorded fixtures adds the line "recorded fixtures do not prove live engine visibility".
- Strategy memory `src/geo_seo_hub/intelligence/optimization.py` `promote_strategy_memory`: a tactic is remembered as working only when candidate, fidelity report, experiment plan, publication handoff and publication receipt all bind by digest, the query panel is unchanged, the observation window has passed, and the weighted change is positive. `early_stop` fires after two windows with no improvement.
- Report `src/geo_seo_hub/site_report.py`: ten modules; each chart declares its source fields, eligibility rule and fallback. When evidence is short the chart is replaced by "Evidence is insufficient, so this chart was not generated", and every chart has "View chart data".
- The router answers `single_skill`, `workflow`, `clarify`, `abstain` or `unavailable`; the publish route is shown as `planned` with no write authority (README).
Take for Chausar:
- Business: the visibility check and the quarterly re-measure in playbook A.
- Engine (rebuild from the idea): the panel-and-slot measurement contract; null-not-zero scoring with a confidence figure; the search versus training crawler split; strategy memory gated on a publication receipt and an unchanged panel.
- Connector: none live. Observation bundles arrive as owner exports or approved API pulls, which fits Chausar's `read` through order files.
- UI: the chart contract and the "not generated" line; a headline like "6 of 8 dimensions have scoring evidence" instead of a bare total.
Traps: AGPL, and the commercial licence grants nothing. Its own README says production readiness is blocked and outcomes are unproven, so its scores must not be sold as rankings. The weighted total is a house rubric; label it so.
Already in Chausar?: The evidence ledger where only verified evidence overwrites (`platform/runtime/venture/evidence/ledger.ts`) and beyondseo's measurement-boundaries table (`cards/marketing-commerce.md`) are close in spirit. No visibility measurement, crawler checks or SEO playbook exist (build audit: "SEO ... playbooks" not built).

---

## XuanRanL/loamwright-SEO-Skill (Apache-2.0, 49 stars, last commit 2026-08-17)
What it is: An SEO agency's Claude Code plugin. One keyword becomes a researched, cited, de-AI'd long article posted to WordPress as a draft and checked on the live URL; there is also a site audit and post-publish monitoring.
Source: partial. The public tree is a sanitized export: the maintainer's 150+ file test suite, eval fixtures and research memos are left out (README, "What's in the public tree"). Code, agents, schemas and templates are present. The NOTICE file must travel with anything copied.
How it works:
- A Python state machine runs 45 stages and reads each artifact's verdict, not just whether the file exists (`scripts/pipeline/orchestrator.py`, `scripts/pipeline/pre_publish_gate.py`).
- One shared verdict classifier, `scripts/pipeline/fc_verdict.py`: CLEAN, CLEAN_WITH_NOTES, FIX_REQUIRED, BLOCK_PUBLISH, plus substring tripwires ("BLOCK", "DO NOT PUBLISH"); an unknown verdict fails closed. Its docstring records that 7 of 338 old fact-check files (2.1%) carried out-of-enum verdicts.
- Provenance and freshness: `fact-check.json` must carry `_generated_by` naming an allowed producer or the gate fails (`pre_publish_gate._check_provenance`). A check report older than later edits is not trusted; `check_humanizer` uses the newer `quality.json` measurement instead.
- Writers have no web tools; statistics carry `[claim:cN]` markers; the fact-checker agent verifies them with web tools (`agents/fact-checker.md`), and code then looks for an independent second source on another domain (`scripts/validate/cross_reference_check.py`, statuses corroborated, single_source, conflicting, search_failed). Competitor domains are stripped at several layers (`scripts/_core/competitor_domains.py`; live check 28 in `scripts/wordpress/verify_post.py`).
- The AI-tell lint counts 43 pattern types in code (`scripts/lint/ai_tells_detector.py`, `patterns_hit_count`); publishing is blocked at an AI-slop score of 20 or more.
- Local pages: `scripts/lint/local_uniqueness_check.py` scores local entity density, local facts, overlap with sibling city pages and word variety, and fails any page missing one of four things (a local programme or licence, a local case or press mention, a landmark or neighbourhood, a price or logistics point). This is the guard against doorway pages.
- Monitoring: the owner exports Search Console as CSV (`scripts/monitor/gsc_csv_ingest.py`). `scripts/monitor/refresh_decision_router.py` maps each signal to the smallest fix: LOW_CTR (top 10 but CTR under half the benchmark) to a title and meta rewrite, PAGE2_DEPTH (position 11 to 20, many impressions) to a depth rewrite, CONTENT_GAP to a new article, CANNIBALIZE to consolidation, NOT_IN_AI to AI-overview work. It writes a plan and never edits a live post.
- WordPress: draft status by default, live only on explicit opt-in, then 29 structural checks on the live URL (`scripts/wordpress/verify_post.py`). A cost ledger with per-article, daily, weekly and monthly caps halts for approval near a limit (`scripts/_core/cost_ledger.py`).
Take for Chausar:
- Business: the monthly content retainer in playbook A, including local city and service pages that pass the doorway check.
- Engine: (1) one verdict enum per check where unknown fails closed, a `generatedBy` provenance field the gate checks, and "a report older than the draft is stale". (2) The refresh router as code over GSC exports. (3) The local uniqueness check. (4) A corroboration status per number. (5) A per-deliverable spend cap beside the monthly cap.
- Connector: WordPress REST with an application password, `write` for drafts only; publishing stays the owner's step. Search Console: CSV upload as `read` now, the API as `planned: read`.
- UI: the refresh plan as rows: the page, the signal in plain words ("on page one but few people click"), the smallest fix, and its cost from code.
Traps: the "linear growth" screenshots are marketing, not evidence. Keyword-density bands and CTR-by-position benchmarks are third-party heuristics; label them. `scripts/fetch/ai_search_probe.py` calls model APIs and records the results as "ChatGPT", "Claude" and so on, but API answers are not what the consumer apps show. SerpApi (optional) resells scraped Google results. The agent-side fact check is model work; only the corroboration search and the lints are code.
Already in Chausar?: claim checks against source files (`platform/runtime/venture/delivery/judge/claim-check.ts`), staged site edits (`platform/runtime/venture/build/site-edits.ts`, from beyondseo), the monthly cap and ask-first figure (`platform/runtime/venture/money/spend.ts`), and "Not checked" rather than "Failed" for unsettled rules (`platform/runtime/venture/delivery/judge/rules.ts`). Not built: one fail-closed verdict enum across all gates, a provenance field, the freshness rule, the refresh router, the local uniqueness check, a WordPress connector, and the stock-phrase humanizer (build audit, Creator).

---

## citeworthyio/seo-agent (MIT, 54 stars, last commit 2026-08-12)
What it is: A Cloudflare Worker that crawls one site daily, files SEO and AI-crawler findings by rule, drafts title, description and JSON-LD fixes with a small model, applies them only after approval as reversible edge overrides, and judges each change's effect from Search Console.
Source: full (TypeScript, tests for most rules, a separate injector Worker). Running it needs a paid Workers plan.
How it works:
- Crawl and rules: `src/crawl.ts` reads the sitemap (or a bounded link crawl that honours robots.txt) and snapshots the delivered head; `src/rules.ts` files findings keyed `(path, rule)` that open, stay open and auto-resolve once the condition clears.
- Drafts, `src/propose.ts`: one queue job per fixable finding. Descriptions must be 70 to 160 characters, a complete sentence, free of banned terms (checked after generation) and different from what is served; titles have length bounds; a doubled brand suffix is fixed with no model. JSON-LD drafts may use only what the crawl saw and must omit any field it could not read; output is validated, and `<` and `>` are escaped (`sanitizeJsonLd`).
- Apply: approval writes `override:<path>` to KV; the site's injector merges it and fails open (`injector/src/index.ts`); every apply and revert is journaled. `src/verify.ts` compares approved overrides with what the crawl received and files `injection_regression`, but suppresses it only on positive knowledge that the layer was never live; an unknown never hides a real outage.
- AI checks (`src/aeo.ts`, `src/robotstxt.ts`, `src/llmstxt.ts`): a page body that is empty for a fetcher without JavaScript, an AI user agent blocked by the CDN while a plain fetch works, robots.txt blocking an answer-engine bot, llms.txt answering 200 with HTML.
- Impact, `src/impact.ts` `verdictFor`: 14- and 28-day windows before and after, with a 3-day settle gap. `insufficient_data` under 50 impressions; helped if CTR rises 15% or position improves by 1.0 without impressions falling more than 20%; hurt is the mirror; mixed signals are neutral. The README states that hurt is "a prompt to look, never proof".
- Citation probes, `src/citations.ts`: weekly, per engine and query, through APIs, with the README's caveat that engine APIs are a proxy for the consumer apps; changes become `citation_lost` and `citation_gained` findings.
- Dashboard, `src/dashboard.ts`: Overview cards that each link into a tab; Findings with Dismiss (mute until restored) and Draft fix; Proposals with the current value struck through beside the proposed one; Changes with a verdict chip (helped, hurt, neutral, and a dashed grey "insufficient data") beside Revert; a chip "applied, confirming on the next crawl".
Take for Chausar:
- Business: the "fix and measure" monthly retainer in playbook A.
- Engine: (1) `verdictFor` thresholds and windows as a pure function over GSC export rows, with `insufficient_data` as a normal result. (2) Findings as sensors: auto-resolve, and dismiss means mute until restored. (3) JSON-LD drafts limited to observed fields, validated and escaped. (4) The AI-access checks above.
- Connector: Cloudflare KV edge overrides as a third site-edit target beside local folder and GitHub (`write`, approved, reversible). Search Console API as `planned: read`.
- UI: a remediation chip on each finding; the old value struck through beside the new; the verdict chip with its dashed "not enough data" state; tick marks on the clicks chart where each change landed.
Traps: AI referral counts are a floor, because Google AI Overviews arrive as ordinary Google search (the README says so). API citation probes are proxies. The README's "AI content lane", which serves different HTML to AI user agents, drifts toward cloaking unless the content is identical to what people see.
Already in Chausar?: stage, review by hash, apply, verify and roll back exists (`platform/runtime/venture/build/site-edits.ts`); the struck-through old value on approval rows is in the Ink spec (`frontend/README.md`). New: impact verdicts, sensor findings, AI-access checks, edge overrides.

---

## Mahanaicoach/google-maps-scraper-kit (MIT, 1,727 stars, last commit 2026-10-14)
What it is: A wrapper around the gosom/google-maps-scraper Docker image: a standard-library Python CLI and a Claude skill that turn "dentists in Denver" into a CSV of name, phone, email, website, category, address, rating and review count, then visit each business website for emails and social links.
Source: partial. The scraping engine is not in the repo; `docker-compose.yml` pulls the `gosom/google-maps-scraper` image (MIT, credited in `CREDITS.md`). The kit's own code is `scripts/scrape.py`, `scripts/scrape.sh`, `scripts/test_scrape.py` and the skill.
How it works:
- `scripts/scrape.py` geocodes the city through OpenStreetMap Nominatim at one request a second. `--grid N` splits the city's bounding box into N×N tiles, run one after another to get past Maps' cap of about 120 results, dedupes on place_id, then cid, then link, then name plus address, and drops rows outside the box.
- Email pass (`enrich_emails`, `extract_emails`, `contact_links`): the homepage first, then up to three contact or about pages on the same host. Junk is filtered (image extensions, site-builder domains, "name@"), emails on the site's own domain come first, at most three are kept, and it prints the found rate ("12/40 from the engine, +9 from contact pages").
- Socials (`enrich_socials`): regex over the homepage for Instagram, Facebook and LinkedIn links, skipping non-profile paths.
- The skill tells the agent to warn once and carry on with big jobs, to add rotating proxies against rate limits, and "do not gate, force-stop or demand confirmation" (`.claude/skills/google-maps-scraper/SKILL.md`, line 166).
Take for Chausar:
- Business: none as built. A local-lead playbook needs other sources (playbook B).
- Engine: only the website enrichment logic is worth rebuilding: own-domain emails first, junk filters, contact pages on the same host only, and an honest found rate. Every lead keeps its source URL, as Chausar already requires.
- Connector: OpenStreetMap Nominatim for geocoding (`read`, one request a second, a named User-Agent, attribution). Google Maps scraping: never.
- UI: the found-rate line as the summary, for example "emails found for 21 of 40 businesses".
Traps: scraping Google Maps breaks Google's terms, which the README admits ("It is against Google's Terms of Service"). Proxy rotation exists to get around rate limits, which is evasion. The skill is written to avoid asking for confirmation. Phones and emails are personal data: the README cites GDPR, CCPA and CAN-SPAM, and in India the DPDP Act applies (whether a business owner's self-published number falls under the Act's exclusion for data the person made public needs a legal read). Cold WhatsApp messages to scraped numbers break WhatsApp Business policy, which requires opt-in, and promotional calls or SMS to numbers on India's DND register fall under TRAI's commercial communication rules.
Already in Chausar?: source URL required, MX check, blocklist before drafting, drafts only (`platform/runtime/venture/customers/leads.ts`, from revenue-squad on 21 Oct). Not built: any lead-source connector.

---

## sunmughan/meta-automation (MIT, 93 stars, last commit 2026-10-19)
What it is: A Node runtime that drives the user's logged-in Chrome over CDP to like, comment, DM, follow, connect and post on Threads, Facebook and LinkedIn on its own, plus a second mode that writes and submits Freelancer.com bids. A model reads the page, picks the next action and judges whether it worked.
Source: full (JavaScript; the tests are mostly static structure audits). The primary model tier is a local Antigravity language server.
How it works:
- The loop in `src/social/agentic-social-runner.js`: snapshot the page, `nextBestAction.decide`, a model plan, one action, a fresh snapshot, then `verifyTransition`, where a model compares before and after; touchpoints go to a relationship engine.
- Gating (lines 200 to 254) checks the onboarding switches (`autoDm`, `autoFollow` and so on), dry run, approval mode and rate limits, but only when the model's own `plan.businessAction` is LIKE, COMMENT, REPLY, DM, CONNECT, FOLLOW or PUBLISH. An action the model leaves unlabelled skips every gate. In approval mode the action is just skipped and logged; nothing is queued for a person.
- `src/safety/anti-ban.js`: hourly and daily caps per action and platform, minimum gaps, a 7:00 to 23:00 "human activity window", session breaks, warm-up for new accounts, random "human" delays, escalating cooldowns, and a 7-day halt on a block. `src/safety/social-action-policy.js` fails open if that module throws.
- Identity: onboarding writes `knowledge/founder.md`, `company.md`, `profiles.md` and `services.md` (approved and excluded services). The relationship lifecycle is OBSERVED, IDENTIFIED, QUALIFIED, ENGAGED, CONVERSATION, OPPORTUNITY, HANDOFF, WON or LOST (`config/social-lifecycle.json`); uncertain cross-platform matches are not merged.
- It stops for CAPTCHA, login, identity checks and security checkpoints (README, "Security model").
Take for Chausar:
- Business: none to copy.
- Engine: (1) the "excluded services" list as a draft check, so a reply that offers something the business does not sell is blocked. (2) A lesson in reverse: classify side effects in code from the action itself (a click on Send, a form submit), never from the model's label, and a policy check that throws must deny.
- Connector: none. Automating likes, follows, DMs, connection requests and bids from a logged-in browser is not something Chausar should ship.
- UI: the lifecycle stages could label Chausar's lead rows when the owner moves them by hand.
Traps: automated likes, follows, comments, DMs and connection requests from a logged-in session break LinkedIn's User Agreement and Meta's terms on automated access. `anti-ban.js` exists to make the bot "behave like a careful human" with random delays and sleep windows, which is detection evasion. Approval mode creates no approvals. Unlabelled actions bypass every gate. The safety check fails open. Auto-submitted marketplace bids are very likely against Freelancer.com's user agreement (check) and spam buyers. Linking people's profiles across platforms without their consent is profiling.
Already in Chausar?: the safe version is already the design: a fixed floor of always-ask actions and gates that fail closed (Ink spec 7.3; `platform/runtime/venture/journal/journal.ts`). Owner-session posting is one approval per post (`platform/runtime/venture/build/posting.ts`); nothing in Chausar likes, follows or DMs.

---

## jasonlee-breadcrumb/silent-ugc (MIT, 75 stars, last commit 2026-08-20)
What it is: A single Claude Code skill that clones a viral TikTok app-ad hook (a silent reaction shot with text, then the app demo) using an AI actor, through the paid Arcads MCP for image, face swap, video, text overlay and stitching.
Source: full but tiny: `skills/silent-ugc/SKILL.md` and a README, no code. Nothing works without a paid Arcads account.
How it works:
- An interview (app link, demo recording, actor image), then 10 to 20 hook texts grouped by angle, then "get an explicit yes" on videos, hooks, actor and cost before generating (Phase 4).
- Per video: `yt-dlp` downloads the source TikTok (retrying when TikTok's JS challenge fails), ffmpeg scene detection finds the cut between hook and demo, a model recreates the first frame "exactly" without its text, `gpt-image-2` swaps in the actor's face, Seedance transfers the original creator's motion onto the actor, then text overlay and a stitch onto the user's own demo.
- Account mode: 10 to 20 videos of the same AI face in new rooms "so a scroller reads the whole account as one person".
- Re-texting a finished clip costs nothing, so rotation comes from text.
- README and SKILL disagree: the README describes image-only animation (about 75 credits) and a frame-by-frame "Performance Profile"; the SKILL uses the source video as the motion reference (about 250 credits) and has no profile step.
Take for Chausar:
- Business: only a clean variant: hook variations from the client's own footage (the founder or staff on camera, the real demo), with text rotation as the cheap multiplier.
- Engine: keep the real, reused asset (the demo) apart from generated parts in the deliverable folder; quote the cost and get approval before any paid render (already Chausar's rule).
- Connector: Arcads would be `planned: handoff` at most.
- UI: nothing new.
Traps: downloading another creator's TikTok and recreating their frame and performance raises copyright and personality-rights problems and goes against TikTok's terms on downloading. The hooks are first-person testimonials ("my trainer charges $80...") spoken by a synthetic person with no disclosure, which is a deceptive endorsement under ASCI's influencer guidelines in India and the FTC's rules, and TikTok requires labels on realistic AI content. "One consistent AI creator" accounts are undisclosed synthetic creators. Retrying through TikTok's bot challenge is evasion.
Already in Chausar?: yes, and refused already. The UGC-Factory card (`cards/marketing-commerce.md`) gave "confirm the brief before spend" and mandatory disclosure; the social playbook's `ugc-ads` offer carries `disclosure: ['paid', 'ai']` and a `synthetic-testimonial` check (`platform/runtime/venture/playbooks/social/playbook.ts`, `checks.ts`).

---

## SupercmoHQ/superCMO-skills (Apache-2.0, 188 stars, last commit 2026-10-21)
What it is: 23 agent skills and a local standard-library MCP server that turn a product photo and a brief into UGC videos, ads, cartoon ads, product photos and ad copy by calling paid image, video and voice vendors, and that pull competitors' ads from the Meta Ad Library through a third-party scraping API.
Source: full for the skills, MCP server and scripts. The hosted product (publishing, calendar, workspaces) is separate and closed. Opt-out telemetry goes to the vendor's own endpoint (`TELEMETRY.md`).
How it works:
- Skills are markdown with references and small deterministic scripts. Generation tools in `scripts/supercmo_skills/mcp/tools/` support `dry_run`: the exact request with keys masked, no call.
- Approval before spend: `skills/generating-ugc-videos/SKILL.md`, line 140: "Nothing has been generated yet, and everything after this step costs money. Get the concept approved first." Storyboards are approved as stills before video renders.
- Product truth: `skills/generating-ad-videos/references/commercial-craft.md` says never redraw the label, never invent a feature, and with no real product photo the ad does not go ahead.
- Brand read, `skills/analyzing-brand/SKILL.md`: writes `brand.md` with the source URL and date; any section without evidence says "unconfirmed, needs user input"; proof points are quoted exactly.
- Competitor ads: `scripts/supercmo_skills/providers/scrapecreators.py` calls ScrapeCreators through an allow-listed path. `skills/researching-competitor-ads/references/pulling-competitor-ads.md` insists on resolving the page id first and proving it by the ads' landing domain. `skills/researching-competitor-ads/scripts/build_ledger.py` builds one ledger per competitor: live and stopped ads budgeted apart, "a missing field is left empty, never zero", and thin samples labelled with no percentages quoted.
- Telemetry is an allowlist of fields in code (`scripts/supercmo_skills/telemetry.py`), with a `log` mode that prints what would be sent.
Take for Chausar:
- Business: product-photo ad creatives for small sellers fit the existing `ugc-ads` offer (with disclosure); a "competitor ad scan" add-on works if the owner captures the ads.
- Engine: (1) "no real product photo, no ad" as a hard check. (2) The ad-ledger rules: empty not zero, thin sample means no percentages, live and stopped kept apart. (3) Storyboard stills approved before paid video. (4) A telemetry allowlist with a "show what would be sent" mode for Chausar's own usage counters.
- Connector: the official Meta Ad Library API covers ads delivered in the EU and UK and political ads; elsewhere the honest label is `handoff` (the owner browses the public library and saves what they see). ScrapeCreators is a scraper: no.
- UI: a cost preview from the dry run beside each Approve.
Traps: the UGC skills cast synthetic "customers" for reviews and unboxings with no disclosure step. `cloning-video-ads` rebuilds someone else's ad around your product; keep to structure, not expression. Third-party scraping of Meta's library. The managed-key route sends prompts through the vendor's proxy. Telemetry is on unless switched off.
Already in Chausar?: quote before paid generation and the spend floor (`platform/runtime/venture/playbooks/social/playbook.ts`, approval `spend-before-generation`; `platform/runtime/venture/money/spend.ts`); evidence labels observed, inferred and needs-your-data (Ink spec 7.6). New: the ad-ledger rules and the no-photo check.

---

## marcosmodly/marketing-skill (MIT, 50 stars, last commit 2026-10-23)
What it is: A Claude Code plugin of 14 marketing skills that share one brand-voice file, keep a content calendar and a cold-outreach log as plain markdown tables, render videos locally (Node, Playwright, ffmpeg) from templates or from a client's own clips, and ship two publish scripts.
Source: full. Most rules live in markdown the model is told to follow; the parts enforced in code are the publish scripts and the video tools.
How it works:
- Separation of duties in `state/content-calendar.md` and `state/outreach-log.md`: generating skills may only write Planned, Drafted or Ready for Approval; only `publish-pipeline` writes Approved, after showing the exact content in a live conversation and getting a real reply. Silence, a timeout or "just post these" never count. Ready items are listed by number and approval must name the numbers; rows older than 14 days are flagged Stale.
- Outreach statuses: Drafted, Ready for Approval, Approved, Sent, Replied, Bounced, Unsubscribed or Do-Not-Contact, Skipped-Duplicate. Identity precedence is email, then LinkedIn, then name plus company. Replied, Bounced and Unsubscribed are permanent; everything else is suppressed for 90 days by default; a dropped duplicate is logged and replaced, never padded. A Gmail sync moves Sent rows to Replied, Bounced or Unsubscribed (opt-out phrases are handled first); an ambiguous result stays Sent and is reported. The strategy file asks to be refreshed every 30 days.
- `scripts/publish_direct.py` and `scripts/publish_webhook.py` refuse to run without `--dry-run` or `--confirmed`; YouTube uploads default to private.
- `scripts/video/montage.js`: the client's clips and photos come in with metadata, including phone location, stripped (`-map_metadata -1`, line 200), turned upright from EXIF, cut to each clip's best moment and on the music's beats (`beats.js`), with captions synced to the voice (`captions.js`) and an end card with the client's logo and contact. `scripts/video/check.js` lints the safe zone, overflow and reading time, and checks loudness near -14 LUFS with true peak at or under -1 dBTP.
- `skills/community-post-generator/SKILL.md` reads each subreddit's or community's rules first and gives a Go or No-Go before drafting; `skills/seo-brief/SKILL.md` never states search volumes.
Take for Chausar:
- Business: (1) reels from the client's own phone clips and photos for property brokers, shops, salons and gyms (playbook C). (2) The content repurposer (`skills/content-repurposer/SKILL.md`): one source becomes a LinkedIn post, an X thread and a newsletter blurb.
- Engine: (1) the outreach statuses, suppression rules, opt-out detection and skipped-duplicate logging as Chausar lead states enforced in code (the build audit lists Replied, Lost, bounce read-back and follow-up dates as missing). (2) A metadata strip at intake for every client media file. (3) -14 LUFS and safe-zone checks for reels. (4) A stale flag on approval rows older than 14 days.
- Connector: a webhook to n8n or Make as `handoff` for owners who already run one.
- UI: batch approval that makes you pick items (no "approve all"); a Go or No-Go line before a community post, with the rule it rests on.
Traps: approval and suppression are enforced only by model instructions in markdown, so a model can skip them. `references/fyp-formats.md` and the templates ship a "comment bait" category ("comment your picks"), which Meta demotes as engagement bait (Chausar's own rule `meta-engagement-bait`). "Best time to post" windows are model claims. Nothing stops someone from hand-editing a row to Approved.
Already in Chausar?: unsubscribe line, blocklist, MX check, draft only, `recordSend` and `optOut` (`platform/runtime/venture/customers/leads.ts`); decide-once approvals (Ink). Not built: Replied, Bounced and Lost states with read-back, follow-up dates, a suppression window, montage reels, LUFS and safe-zone checks (`platform/runtime/venture/playbooks/youtube/finishing.ts` measures black, frozen and silent spans and sound levels for YouTube only).

---

## Three draft playbooks (the extra focus)

All prices are set by the owner and turned into receipts by code. Every connector carries its honest label.

### A. Search and AI-answer visibility for small businesses (SEO and GEO)
Who buys: clinics, coaching institutes, CA and law practices, D2C brands, B2B manufacturers with a website.
Offers:
1. Visibility check (one-off): site diagnosis on eight dimensions with null where nothing was observed and a confidence figure; AI-crawler access (robots split into search and training bots, CDN blocking, pages empty without JavaScript, llms.txt); a fixed panel of the client's 15 to 30 buyer questions × engines × 2 repeats, each answer saved as captured; a fix list with impact and effort. (GEOHub idea, seo-agent checks.)
2. Content retainer (monthly): articles or local service pages; claims marked and corroborated; sent to the client's WordPress as drafts; local pages must pass the doorway check. (loamwright.)
3. Fix and measure (monthly): title, description and JSON-LD proposals approved by the client on the share link, applied through site edits, judged at 14 and 28 days from the client's GSC export; a refresh plan each month. (seo-agent, loamwright.)
4. Quarterly re-measure: same panel, same engines; changes reported only where slots are filled.
Steps: gather (site, GSC export, competitors, buyer questions) → compute (diagnosis, crawler matrix) → question (missing facts) → approve (the query panel, frozen once approved) → gather (AI answers, captured by the owner in the consumer apps or pulled through an approved API, method recorded) → compute (panel metrics with numerator, denominator, missing) → write (articles by writers with no web access, claim markers) → verify (claim check, corroboration, AI-tell lint, doorway check, prompt leak) → approve (owner, then client) → operator (WordPress draft; the owner or client publishes) → verify (live URL checks) → gather (next month's export) → compute (impact verdicts, refresh plan) → write (report citing receipts) → approve (report and invoice).
What the owner approves: the panel, every article, every site change, any paid API spend, the report and invoice.
What to tell clients: no promised rankings or AI citations; API answers stand in for ChatGPT, Gemini and Perplexity apps and can differ; "not enough data" is a normal result; AI referral counts are a floor.
Connectors: GSC CSV `read` (now, through order files); GSC API `planned: read`; WordPress `planned: write` (drafts only); site edits `write` (built: local folder, GitHub); Cloudflare KV `planned: write`; AI engine APIs `planned: read` (proxy).

### B. Local-business lead finding within the rules
For: a self-employed SEO, social media or web person who sells to local shops.
Where scraping breaks terms: Google Maps (the kit itself says so); JustDial, IndiaMART and similar directories (their terms of use forbid automated copying; check each before any use); LinkedIn (bots banned by its User Agreement); Instagram and Facebook (automated collection without permission). Rotating proxies to avoid rate limits is evasion. None of these are sources.
Sources that fit:
- OpenStreetMap through Overpass (shop, amenity and office tags inside a city box): `read`, ODbL, attribution, share-alike for any database you publish. Small Indian shops are patchy in OSM, so expect gaps.
- Google Places API text search: sanctioned and paid; its terms limit storing results (place IDs may be kept, most other fields only briefly), so use it to look up and qualify now, not to build a list to resell. `planned: read`.
- The business's own website: contact and about pages on the same host, robots.txt respected, own-domain email first, found rate shown (the kit's enrichment logic).
- Owner-entered: walk-ins, referrals, a directory the owner browses by hand, a list they were given: `handoff`.
Pipeline: source with URL → dedupe (place or OSM id, then domain, then name plus address) → enrich from the business's own site → MX check → blocklist and suppression → the owner picks who to contact → draft (email with unsubscribe line and postal address; WhatsApp only to people who wrote first or opted in; no promotional calls or SMS to DND numbers) → the owner sends → reply and bounce read-back → statuses (marketing-skill's set).
The leads are not the product: they feed the owner's own SEO, social or web offers. Selling raw lead lists stays out.

### C. One input, many posts: the repurpose studio
Who buys: creators, coaches, local shops and small B2B firms that make one thing a week (a blog post, a talk, a voice note, a launch, twenty phone clips of a flat).
Offers:
1. Weekly repurpose pack: one source becomes channel-native drafts for the client's 3 to 5 channels, format picked by code rules and shown with the reason, threads split by code, plus a newsletter blurb. (yominpost router, marketing-skill repurposer.)
2. Reel from your clips: the client's own phone clips or photos become a 9:16 montage with beat cuts, captions and a contact end card; location metadata removed at intake. (marketing-skill montage.)
3. Hook variations: 3 to 5 openings on the same reel for testing, text-only changes.
Steps: gather (source, client channels, recent posts) → compute (format per channel) → write (drafts per channel, adding no fact that is not in the source) → verify (channel limits, claims against the source, prompt leak, near-duplicate against the client's last posts, cadence against the posting plan, engagement bait, AI disclosure when voice or visuals are generated) → approve (owner, then client through the share link) → operator (the owner posts, or an owner-session post one at a time with the risk line; API once reviewed) → gather (platform exports) → compute and write (report).
UI: yominpost's canvas (chat beside one card per channel, refine one card) drawn in Ink's style: no mascot, accent for state only.
Never: AI actors posing as customers without a label; comment-bait templates; automated likes, follows or DMs.

---

## Ideas worth taking, ranked by value

| Idea | From | Kind | Value for B2C owners | Effort |
|---|---|---|---|---|
| Search and AI-answer visibility playbook (check, content retainer, fix and measure, re-measure) | GEOHub (idea only), loamwright-SEO-Skill, seo-agent | playbook | high | L |
| Repurpose studio offer: one source to channel-native drafts, format picked by code with its reason | yominpost `stages/router.py`, marketing-skill `skills/content-repurposer` | playbook | high | M |
| Reel from the client's own clips and photos (beat cuts, captions, contact end card) | marketing-skill `scripts/video/montage.js` | playbook | high | M |
| Pre-post risk gate: daily cap, minimum gap, warm-up for new channels, near-duplicate against the last 5 posts, link streak, hashtag cap | yominpost `platform_risk.py` | engine | high | S |
| Prompt-leak lint on every outbound draft ("as an AI", "here is a post", scaffold markers) | yominpost `platform_risk.py`, loamwright `scripts/lint/render_lint.py` | engine | high | S |
| Platform-block circuit breaker: freeze the channel 72 hours, reads too, tell the owner not to reconnect | yominpost `platform_risk.py` `freeze_channel` | engine | high | S |
| Lead states Replied, Bounced, Unsubscribed, Skipped-Duplicate; opt-out phrases in replies; 90-day suppression; identity precedence | marketing-skill `state/outreach-log.md` | engine | high | M |
| Honest local lead sources (OSM Overpass, Places API look-up, own-site enrichment with found rate) plus a written list of sources that break terms | google-maps-scraper-kit `scripts/scrape.py` (enrichment only), playbook B | connector | high | M |
| Change-impact verdict at 14 and 28 days from GSC exports, with "insufficient data" as a normal result | seo-agent `src/impact.ts` | engine | high | S |
| AI-answer panel measurement: slots fixed in advance, missing slots in the denominator, collection method declared, fixtures flagged | GEOHub `intelligence/measurement.py` (rebuild; AGPL) | engine | high | M |
| One verdict enum per check, unknown fails closed, `generatedBy` provenance, report older than the draft is stale | loamwright `scripts/pipeline/fc_verdict.py`, `pre_publish_gate.py` | engine | high | S |
| Side effects classified by code from the action, and a gate that throws denies | meta-automation (as a trap) | engine | high | S |
| GSC CSV reader and refresh router (low CTR, page two, content gap, cannibalisation) | loamwright `scripts/monitor/refresh_decision_router.py` | engine | med | S |
| AI-access checks: search versus training bots, CDN blocking AI fetchers, empty pages without JavaScript, llms.txt soft 404 | seo-agent `src/aeo.ts`, GEOHub `_crawler_matrix` | engine | med | S |
| Site diagnosis with null-not-zero checks and confidence as observed over planned | GEOHub `site_diagnose.py` (rebuild) | engine | med | M |
| Local page doorway check (four required local elements) | loamwright `scripts/lint/local_uniqueness_check.py` | engine | med | S |
| WordPress connector, drafts only, live-URL checks after the owner publishes | loamwright `scripts/wordpress/` | connector | med | M |
| Per-channel card canvas with "refine only this one" and chat that routes by channel name | yominpost `web/static/app.js` | UI | med | M |
| Account health in each platform's own terms, with where the data came from (API, check in the app, our proxy) | yominpost `platform_health.py`, `account_intel.py` | UI | med | M |
| Findings as sensors: auto-resolve, dismiss means mute until restored, remediation chip | seo-agent `src/dashboard.ts`, `src/rules.ts` | UI | med | S |
| Chart contract: no chart without evidence, "View chart data", "6 of 8 have evidence" | GEOHub `site_report.py` | UI | med | S |
| Batch approval must pick items; stale flag after 14 days | marketing-skill `state/content-calendar.md` | UI | med | S |
| Strip location metadata from every client photo and clip at intake | marketing-skill `scripts/video/montage.js` | engine | med | S |
| Reel finishing checks: -14 LUFS, true peak, safe zone, reading time | marketing-skill `scripts/video/check.js` | engine | med | S |
| JSON-LD drafts from observed fields only, validated and escaped | seo-agent `src/propose.ts` | engine | med | S |
| Corroboration status per number (second independent domain) | loamwright `scripts/validate/cross_reference_check.py` | engine | med | M |
| "Excluded services" in the owner's profile as a draft check | meta-automation `knowledge/services.md` | engine | med | S |
| "No real product photo, no ad" check | superCMO-skills `commercial-craft.md` | engine | med | S |
| Strategy memory only after a publication receipt, the same panel and a full window; stop after two flat windows | GEOHub `intelligence/optimization.py` (rebuild) | engine | med | M |
| Per-deliverable spend cap beside the monthly cap | loamwright `scripts/_core/cost_ledger.py` | engine | med | S |
| Reference OAuth posting code for 11 channels (for when app reviews clear) | yominpost `connectors/oauth_conn.py`, `oauth_specs.py` | connector | med | L |
| Competitor ad ledger rules (empty not zero, thin sample means no percentages, live and stopped apart) over ads the owner captured | superCMO-skills `build_ledger.py` | engine | low | S |
| Cloudflare KV edge overrides as a site-edit target | seo-agent `src/overrides.ts`, `injector/` | connector | low | M |
| Show which engine wrote each draft, and warn when a fallback did | yominpost `services.py` `_Tracer` | UI | low | S |
| Telemetry allowlist with a "show what would be sent" mode | superCMO-skills `telemetry.py` | engine | low | S |
| Webhook handoff to n8n or Make | marketing-skill `scripts/publish_webhook.py` | connector | low | S |
| Community Go or No-Go from the community's own rules before drafting | marketing-skill `skills/community-post-generator` | engine | low | S |
