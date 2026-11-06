# Social and sales: second harvest cards (group social-sales)

Studied 23 October 2026. Seven products, each shallow-cloned into its own folder under the session scratchpad (`harvest-clones\<owner>__<repo>`) and read with file tools only. Nothing was installed, built or run. Paths below are relative to each repo's root. Licences and stars come from the GitHub API on 23 October.

Chausar rules applied throughout: owner-account browser posting is allowed only with approval per post and a ban-risk label; agents draft and the owner sends; no detection evasion (no proxies, no faked user agents, no "look human" delays); model numbers are allowed only when labelled "model estimate".

Licence summary: AutoSocial is MIT (reuse with attribution). MailCheap is AGPL-3.0 (learn only; its README says one earlier commit, `67d13b0`, stays MIT, which was not cloned or checked here). The other five have no licence file, and 10xConnect's README says "all rights reserved": learn only, copy no code.

---

## Katzca/AutoSocial (MIT, 1,430 stars, last commit 2026-06-10)

What it is: a local Express dashboard that drives Playwright browser sessions to upload short videos from per-account folders to TikTok, Instagram and YouTube on a cron or "instant" schedule, with an FFmpeg "uniquifier" and a yt-dlp watcher that pulls videos from any TikTok channel into the posting queues.

Source: full.

How it works:
- Queues are folders: `queue/<account>/<platform>/pending`, with a `.description` or `.txt` caption sidecar per video; success moves the file to `posted`, failure to `failed` (`src/queue.js`, `src/post-service.js`).
- One `DaemonController` per account and platform holds the schedule (cron, daily HH:MM times, or "instant post" that watches the folder), a 50-line log and an `isPosting` lock (`src/daemon-controller.js`).
- Uploaders open a persistent Chromium profile per account and platform (`.profiles/<account>/<platform>`), fill the form by localized text labels (`src/platform-ui-labels.js`, English and German alternatives per button) and confirm the post three ways: an error text on the page, a 2xx or 4xx from the platform's own publish request caught with `page.on("response")`, or success text or a URL change (`src/tiktok-uploader.js:956-1119`).
- First-Run Setup view: each check returns `{ id, label, status: ok|warn|fail, detail, action }`, plus "where to put videos" folder cards, login-session status per platform and "Suggested first run" steps ending in "Use Run Once for a safe first test" (`src/setup-health.js`, `web/index.html:147-215`).
- The local dashboard refuses cross-origin writes by checking Origin, Referer and Sec-Fetch-Site (`src/request-guard.js`).
- `autodownload/watcher.js` polls a channel given in `WATCH_CHANNEL`, filters by `MIN_VIEWS`, downloads with yt-dlp and copies each video into every platform's pending queue, so the scheduler posts it.
- `src/video-uniquifier.js` rewrites metadata with a random creation date, title and encoder, then nudges speed, colour, noise, pixel grid, pitch and EQ, "to change the audio fingerprint" (lines 60-190).

Take for Chausar:
- Business: a short-form cross-posting service for a creator or a local business, using only the client's own videos (rights recorded at intake). Steps: client drops videos, agent writes per-platform captions within channel limits, owner approves each post, then post by owner-browser-session or handoff. Monthly fee per channel, set by the owner. Chausar's browser path posts text only today (`platform/runtime/venture/build/browser.ts:27`), so video upload is `planned`.
- Engine: confirm a browser post by the platform's own HTTP response as well as the page (`tiktok-uploader.js:956-993`). Store the matched request pattern in the browser script data with its `checkedOn` date, and keep Chausar's rule that no confirmation means "outcome unknown", never "failed".
- Engine: button and confirm-text alternatives per UI language as data (`platform-ui-labels.js`). Useful when an owner runs LinkedIn or X in Hindi and a text-based confirm check would miss.
- Connector: TikTok, Instagram and YouTube by owner-browser-session for media is `planned`; today it is `handoff` (open Studio or the app).
- UI: the setup page shape: one summary line (Ready, Warnings, Blocking counts), each check with its fix in one sentence, and a "Run once" rehearsal before any schedule is turned on (`setup-health.js:67-314`).

Traps:
- Detection evasion: `--disable-blink-features=AutomationControlled` on every launch and a fixed "realistic" user agent on Instagram (`src/instagram-uploader.js:12-33`, `tiktok-uploader.js:23`, `youtube-uploader.js:23`).
- The uniquifier exists to slip re-uploads past duplicate and fingerprint checks, with fake creation dates (`video-uniquifier.js:60-87, 170-190`).
- Reposting other people's channels: the watcher downloads any channel by view count and auto-queues it on three platforms with no rights check (`autodownload/watcher.js:1-15`).
- No approval at all: instant-post fires when a file lands; the review queue is only on the roadmap (`ROADMAP.md:34`).
- Double posts: when no confirmation shows, it clicks Post again up to twice (`tiktok-uploader.js:1085-1097`), and a timeout files the video under `failed` although it may be live (lines 1110-1113).

Already in Chausar?: owner-browser-session posting with approval, a journal, "outcome unknown" and a plain launch with no hidden automation is built (`build/posting.ts:1-12`, `build/browser.ts:45-46, 131-158`). Rights at intake is in the YouTube playbook (design section 7.8). Not built: response-based confirmation, UI-language label alternatives, a setup health page, media upload.

---

## hodoshia/richworks-skills (no licence, 0 stars, last commit 2026-08-02)

What it is: 18 Markdown skills from a Slovak agency's social media practice (profile growth, reels, LinkedIn ghostwriting templates, content planning, hashtags, a "foundation layer" of brand files), mostly prompts with Slovak defaults. No code.

Source: full (it is only prompt text). Learn only: no licence.

How it works:
- Foundation layer: six files the AI reads before writing: audience delight profile (verbatim customer quotes), ICP, creator style (words used, words never used, sentence length, always and never habits, 5 to 10 best examples per platform), customer journey, positioning, and a README telling the AI how to use them (`skills/foundation-layer/SKILL.md:24-85`). Built from a 15 to 20 minute voice memo, reviewed quarterly.
- Content planning: idea bank, month planned as raw ideas first, selling posts capped at 10 to 20 percent of the month, first versions the next day, second versions after a day's rest, each post with exactly one goal and one audience action, client revision rounds agreed and extra rounds charged, a dated timeline (first versions by the 1st of the previous month, production in week 2) (`skills/content-planning/SKILL.md:59-119`).
- LinkedIn ghostwriting: five post structures (mistakes and lessons, framework, future, category view, myths) (`skills/linkedin-templates/SKILL.md:29-69`).
- Reel diagnosis: the owner screenshots all Instagram Insights sections plus the full script, asks a vision model why it failed, checks a six-point list (drop-off point, hook, wasted first 10 seconds, jargon, one-word CTA comments, length), then rewrites (`skills/reel-diagnosis/SKILL.md:24-87`).
- Profile growth: traffic problem versus conversion problem, with a conversion rate of followers gained over profile visits, target 10 to 20 percent (`skills/profile-growth/SKILL.md:23-62`).
- Hashtags: a banned-hashtag snapshot dated 02/2026 and a claim that Instagram cut the limit to 5 on 1 January 2026, with no source link (`skills/hashtag-strategy/SKILL.md:14, 48-69`).

Take for Chausar:
- Business: LinkedIn ghostwriting for founders and professionals (a CA, a doctor, a consultant). Offer: 8 or 12 posts a month in the five structures, two revision rounds, extra rounds priced by the owner. The client approves each post through a share link; the owner posts by owner-browser-session (approval per post, ban-risk line) or the client posts from a handoff.
- Engine: a voice file per business or per client with the six sections as typed intake fields. Code checks the "never use" words against every draft (the social checks already run `bannedWords`), and the model gets the rest as context. Fills the "voice.md per business" gap in the build audit.
- Engine: calendar slot kinds (`value` or `sell`) with a code check that selling stays at or under a share the owner sets (default 20 percent), and two typed fields per draft (goal, audience action), one value each.
- Engine: monthly due dates for client revision computed by code from the offer (first versions due on day X of the previous month), shown as Today rows when due.
- Playbook step: "post diagnosis" from the client's exported Insights (CSV or screenshots), with the deterministic checklist first (length against average watch time, where viewers left) and the model's diagnosis labelled "model estimate".

Traps:
- The skill tells the model to compute conversion rates, and its own labels contradict its worked example: A is "the less valuable metric" yet the example divides subscribers (the deeper metric) by clicks (`skills/profile-growth/SKILL.md:95-105`). Funnel rates belong in code with receipts.
- "Post via a German VPN" to reach a German audience (`skills/content-planning/SKILL.md:137-139`) is location spoofing; Chausar does not route posts through VPNs.
- Unsourced platform claims (the 5-hashtag rule, the banned list) and an anecdote presented as proof ("490 to 182,460 views in 24 hours", `reel-diagnosis/SKILL.md:78-83`). Store rules only with a source URL and checked-on date.
- No licence: describe, do not copy text.

Already in Chausar?: Instagram's 5-hashtag limit is already a dated rule (`playbooks/social/channels.ts:68`, `ig-hashtags-5`); client banned words, engagement bait and house style are checked (`playbooks/social/checks.ts:302-309`); calendar slots come from code (`playbooks/social/calendar.ts`). Not built: voice file per business, slot kinds with a selling cap, goal and action fields, revision due dates, post diagnosis.

---

## MichaelYangjson/kol-influencer-marketing-skills (no licence, 2 stars, last commit 2026-07-07)

What it is: two agent skills: one turns a product, ICP and competitors into short search keywords for finding creators per platform; the other estimates a fair sponsorship price from a creator's recent view counts with a fixed formula and writes a JSON "case log" for later calibration. Grok's row says "discovery, profile research and outreach"; the repo has no discovery, research or outreach.

Source: full (prompt text and reference tables). Learn only: no licence.

How it works:
- Keyword groups: product or category, pain, scenario, competitor (kept separate), creator identity, platform-native tags; 10 per group, 1 to 4 words, plus negative keywords and stated assumptions; platform tilt (YouTube: tutorial and review words; TikTok: scene and niche tags) (`skills/kol-keyword-generator/SKILL.md:76-106`).
- Price formula: estimated signups = effective views x offsite CTR x signup rate x vertical fit x competitor coefficient; price upper bound = signups x target cost per acquired user; recommended = min(upper bound, cap of 400 USD) (`skills/kol-pricing-estimator/SKILL.md:60-76`).
- Effective views = median of the last 10 comparable posts; fewer than 10 lowers confidence; unrelated viral posts excluded (`SKILL.md:81-88`).
- Every parameter states its value, source (user, preference file, platform default, agent judgment), reason and risk if wrong (`SKILL.md:94-100`).
- Case log with `modelVersion`, inputs, outputs and `actualSignups`, `actualCpa`, `actualRevenue` left null until the campaign runs (`references/case-log-template.md`).
- Default funnel rates per platform: YouTube CTR 0.02 and signup 0.06, TikTok CTR 0.002, Instagram 0.005 (`references/platform-benchmarks.md:9-15`), with no source.

Take for Chausar:
- Business: an influencer marketing desk for D2C brands and local businesses in India. Steps: keyword plan, creator shortlist with channel URLs (owner searches, or YouTube Data API reads), a fair-price check per creator, outreach email drafts to each creator's public business email (the existing leads engine), a brief and a disclosure clause (ASCI and the platform's paid-partnership label), post-campaign results entered into the case log. Earns a fixed fee per campaign or a monthly retainer set by the owner.
- Engine: the price check as code, not prose: median from the view list, each coefficient a typed input tagged `owner`, `default` or `agent judgment` (agent-judged values shown as "model estimate"), BigInt minor units in rupees, the owner's cap applied by code, and a receipt for the result. The case log becomes a record with actuals, so the owner sees "your last 6 campaigns: estimate versus actual".
- Engine: keyword groups as a typed output with competitor terms kept apart and a negative list.
- Connector: YouTube Data API for public channel statistics and recent video views is `planned: read`; Instagram and TikTok creator stats are `handoff` (owner pastes or uploads).

Traps:
- "Do the arithmetic directly in the response" (`kol-pricing-estimator/SKILL.md:104`): the model computes the price. Chausar computes it in code.
- Benchmark rates with no source, presented as defaults; a USD cap and USD CPA that mean nothing for an Indian brand.
- The repo does not do what its listing says (no outreach, no creator research).

Already in Chausar?: the outreach half is covered by the leads engine (source URL, MX check, blocklist, unsubscribe line and address, owner sends: `customers/leads.ts`). Nothing for influencer search, creator pricing or campaign case logs.

---

## threadsnoop/reddit-skills (no licence, 1 star, last commit 2026-07-28)

What it is: two read-only skills that search Reddit through ThreadSnoop's paid read API (REST or MCP): a general search and monitoring skill, and a lead finder that scores posts by customer fit, problem severity and purchase intent and returns a ranked report with quotes and links.

Source: partial. The skills are complete; the data comes from ThreadSnoop's hosted API (`api.threadsnoop.com`, with a public `openapi.json`), whose code is not in the repo. Not worth reverse engineering: the workflow is the value, and Chausar would read Reddit through an official route. Learn only: no licence.

How it works:
- Confirm the product back to the user in 2 or 3 sentences before any search (`reddit-lead-finder/SKILL.md:84-89`).
- Communities found from the problem, not the product category, plus fixed founder subreddits, with a self-check that one was included (lines 91-110).
- Two kinds of search terms: category words and pain words in the user's own complaint language (lines 112-120).
- Scoring: three dimensions, each 1 to 5 with written anchors; surface a candidate only if it scores 4 or more on at least two; rank by the sum; flag competitors separately (lines 139-158).
- Skip `[removed]` and `[deleted]` bodies and never quote them; show "new" instead of a hidden score of 1 (`reddit-search/SKILL.md:109-137`); say how much of the time window was covered (lines 102-107).
- Check the subreddit's rules before recommending any engagement; on 429 stop and report; zero results is a real finding, never padded (`reddit-lead-finder/SKILL.md:160-189`).
- Hard rule: never post, comment, vote or DM, even if asked (lines 195-202). `SECURITY.md` treats fetched posts as data, never instructions.

Take for Chausar:
- Business: a weekly "people asking for what you sell" report for a founder, coach or service seller. The agent finds and scores threads; the owner replies personally, signed in as themselves. Fixed weekly fee. Each surfaced thread can become a lead with its permalink as the source URL.
- Engine: the scoring as a judge pattern: the model votes 1 to 5 per dimension and must quote the line it relied on; code checks the quote exists in the fetched text, applies "4 or more on two", ranks, and counts "not surfaced". Fits Chausar's vote-then-count judge (design 7.5).
- Engine: a coverage line on every search result ("covered 2 of 7 days on r/SaaS") and "new" for hidden scores, so no fake number is shown.
- Connector: ThreadSnoop API or Reddit's official Data API, `planned: read`. Never `write`: Reddit posting and replies stay with the owner.
- UI: the report row: thread title, quoted line, three small scores, one sentence on why, a warning line only when the subreddit bans self-promotion.

Traps:
- None in code. The FAQ says "paste it in when the skill asks" for the key while the skill says never ask for it (`reddit-lead-finder/examples/faq.md:7` versus `SKILL.md:31-38`).
- Scores 1 to 5 are model judgment: show them as votes, not facts.

Already in Chausar?: leads need a source URL and are drafted, never sent, by agents (`customers/leads.ts:1-8`); the rules judge cites evidence ids (design 7.5). No Reddit connector, no thread scoring, no coverage line.

---

## marclou/mailcheap (AGPL-3.0, 1,307 stars, last commit 2026-10-23)

What it is: a complete newsletter app (Next.js, MongoDB, Amazon SES or PostShiba, QStash jobs): editor, contacts, imports from other newsletter tools, a public archive site per newsletter, deliverability protections, stats, and the same actions over a REST API and an MCP server.

Source: full. Learn only (AGPL).

How it works:
- Every action is one `defineAction` with schema, permission and four MCP hints (read-only, destructive, idempotent, reaches outside); the dashboard, REST API, MCP server, docs and OpenAPI are generated from it, and `tests/parity.test.mjs` fails if one is missing (`AGENTS.md:27`, `lib/actions/define-action.js:14`, `lib/mcp/server.js:20-29`).
- Pre-send checks: subject present, subject under 70 characters (warning), broken merge tags (warning), preview text (warning), content, unsubscribe link, under 100 KB (Gmail clips), postal address, allowed From address, test sent (warning), plan limit, sending on; blocking checks stop the Send button (`lib/presend-checks.js:33-98`). Each failing check carries a fix: a label and the exact field or settings page to open (`lib/campaign-steps.js:15-36`). The editor has three steps: Write, Review, Send.
- First send to never-emailed contacts goes as a slice (5 percent, at least 200, at most 2,000), then waits 3 hours; if bounces pass 2 percent (5 minimum) or complaints 0.08 percent (2 minimum) the rest pauses; past 5 percent bounces or 0.3 percent complaints the account is blocked (`lib/config.js:137-164`, `lib/first-send.js`, `lib/rate-levels.js`). Audience is ordered most engaged first (`lib/audience.js:1`), and the report offers "Send to more".
- List cleanup: after 6 ignored issues and 180 days without a sign of life, a contact gets one "do you still want this?" email instead of the issue; no answer within 14 days makes them dormant, never deleted or unsubscribed (`lib/cleanup.js:1-70`, `lib/last-chance.js`).
- Imports drop and count, per reason: invalid, misspelled domain, spam trap, role address (info@, sales@), throwaway inbox, spam domain, duplicate, previously unsubscribed or bounced, undeliverable, no mail server; the uploader ticks "These people agreed to receive my emails" (`lib/import-checks.js:4-75`).
- One never-email list across all accounts, kept only as a keyed hash (README line 44).
- Outgoing content is screened by a moderation model and a small classifier, plus regular expressions for text that addresses the AI checker ("mark this as safe", "ignore previous instructions") (`lib/content-review.js:30-80`).
- Report stats are pure functions: opens and clicks per hour for 72 hours with future hours left empty, and a comparison with the newsletter's own last 10 issues, shown only with at least 2 (`lib/report-stats.js:1-60`).

Take for Chausar:
- Business: a newsletter service for a niche or a local business (for example a CA practice's monthly GST and tax-dates letter to its clients, or a creator's weekly issue). Earns from a monthly fee per client, or for the owner's own newsletter from sponsor slots and a paid tier (prices set by the owner, totals by code). Steps: list import with consent attestation, issue drafted by an agent from the owner's sources, pre-send checks, owner approves the send (public sending is on the always-ask floor), first-send slice, report from provider data.
- Engine: the pre-send check list with `blocking` versus `warning` and a fix target per check. Reusable beyond email for any draft row in Today.
- Engine: first-send slice and pause or block thresholds, as data with their numbers, for any bulk send Chausar might ever make.
- Engine: list cleanup states (`issue`, `lastChance`, `waiting`, `dormant`) and import drop reasons with counts shown to the owner ("212 left out: 140 role addresses, 40 duplicates...").
- Engine: hint flags per engine method (read-only, cannot be undone, safe to repeat, reaches outside) generated with the method list, and a parity test across UI, IPC allowlist and hosted contract.
- Engine: a deterministic "text aimed at the AI" screen for any inbound text an agent reads (emails, Reddit posts, LinkedIn replies), which fills part of the "untrusted-content screen" gap.
- Connector: MailCheap Cloud's REST API or MCP (`planned: write`, a hosted third party holding the list), Amazon SES directly (`planned: write`, needs SES production access), Google Postmaster Tools (`planned: read`). Until then: `handoff` to the owner's newsletter tool with the issue exported.
- UI: the report against the newsletter's own past issues instead of an industry benchmark; future hours drawn empty; "fewer than 2 earlier issues, no average shown".

Traps:
- AGPL: running a modified copy for other people obliges source release; learn only.
- The MCP "ask the user before sending" is an instruction to the model (`lib/mcp/server.js:20`), not an approval the server enforces. Chausar enforces in the engine.
- The content check fails open: after 12 seconds the email goes out unchecked (`lib/content-review.js:19-20`). Chausar's gates fail closed.
- Open rates count image prefetches by some mail apps; MailCheap filters link scanners, but open numbers stay soft.

Already in Chausar?: one-to-one outreach drafts carry the unsubscribe line and postal address (`customers/leads.ts:7-8, 152-169`), and opt-outs go on a permanent blocklist (`leads.ts:183-186`). No list sending, newsletter, import cleaning, list cleanup, send slices or report baselines.

---

## uditya-kumar/Email-Sending-Tool (no licence file, 0 stars, last commit 2026-08-05)

What it is: a single-user cold email tool that sends from the owner's own Gmail through the Gmail API: a leads grid, per-lead sequences (opening email, waits, follow-ups in the same thread), a per-lead send time in IST, a daily cap per mailbox, reply detection that cancels follow-ups, and open and click tracking. `server/package.json` says ISC, but that is npm's default and there is no licence file: learn only.

Source: full (React frontend, Express server, Supabase schema in `supabase/schema.sql`).

How it works:
- `shared/` holds the rules both preview and sender use (merge tags, IST maths, sequence rules, budget), so the preview cannot disagree with the send (`CLAUDE.md:50-55`).
- Sequence: opening email, wait 3 days, follow-up, wait, follow-up; a template is copied onto each lead so editing it never changes a sequence in flight (`shared/sequence.ts:28-42`, `CLAUDE.md:110-112`).
- Follow-up N+1 is queued only after N actually went out, and the wait counts from the real send time; outreach and follow-ups have separate allowed weekdays; a missed slot moves to the next allowed slot at the lead's own time, never "now" (`shared/schedule.ts:112-167, 256-264`).
- The timeline per lead keeps facts and estimates apart: `sent`, `sending`, `scheduled` (a queued row), `projected` (no row yet, shown with "≈"), `stopped` (replied, cancelled, skipped), `blocked` (an earlier step failed or no valid time), and a reply marker drawn between the last delivered email and the cancelled ones (`shared/schedule.ts:306-573`, `frontend/src/components/compose/StepTimingBadge.tsx:69-129`).
- The tick checks tokens, then replies first, then the cap, then claims due rows with `FOR UPDATE SKIP LOCKED` (`server/src/scheduler/tick.ts:54-72`, `supabase/schema.sql:804-837`).
- Reply detection reads the Gmail thread's From headers with `format: metadata`; any message from another address (a reply, a bounce, an out-of-office) stops the sequence (`server/src/email/reply-watcher.ts:39-84`).
- One lead stays on one mailbox for the whole thread, enforced in four places including a database trigger, because a follow-up from another mailbox looks like a thread-hijack phish (`CLAUDE.md:163-172`).
- The daily cap is split between follow-ups and new leads as a ceiling, with each side borrowing the other's unused slots (`shared/send-budget.ts:1-67`).
- Engagement shows opens as counts of thread reads; one open is called ambiguous (mail apps prefetch), two or more a real read; clicks and replies are the trusted signals (`frontend/src/components/common/EngagementCell.tsx:22-157`).

Take for Chausar:
- Business: cold email for a self-employed service seller (a web designer, a CA practice looking for SME clients, a freelance editor). Offers: a 50-lead outreach month with a 3-step sequence; the owner sends from their own mailbox. Chausar already has the lead rules; this adds the follow-up rhythm.
- Engine: follow-up due dates computed by code from `recordSend`: the lead's sequence (wait days), the owner's allowed weekdays and send time, counted from the real send, stopped by a recorded reply. Each due follow-up becomes a Today row ("Follow-up 1 to Asha Rao is due today. Read, then send from Gmail."). Closes the build audit's "follow-up dates, Replied and Lost" gap.
- Engine: a sequence record per lead copied from a template, so editing the template never rewrites a sequence already running.
- Engine: one mailbox per lead thread, refused at draft time if the owner tries another.
- Connector: Gmail, two honest halves: read thread headers to detect replies (`planned: read`, metadata scope) and create the follow-up as a draft inside the same thread (`planned: write (drafts only)`); the owner presses Send in Gmail and the app records it. Both scopes need Google's app verification before customers can use them.
- UI: the per-lead timeline with certainty in the wording: "Sent 4 Aug", "Due tomorrow, 9:30 AM", "≈ 12 Aug, estimated", "Won't send: replied". Matches Chausar's receipt versus "model estimate" split.
- UI: engagement wording that admits doubt ("Opened once. A mail app may have loaded it without anyone reading.").

Traps:
- It sends automatically, and retries a failed send at 2, 10 and 60 minutes up to 5 attempts (`server/src/scheduler/send-queue.ts:24-34`); an error after Gmail accepted the message can send twice. Chausar's journal marks that "outcome unknown".
- No unsubscribe line, no opt-out list and no postal address anywhere in the code.
- Random jitter between sends "because fifteen emails at exactly 09:30:00 is a machine signature" (`tick.ts:67-68`): disguise, not a limit.
- A tracking pixel and click redirect on a domain the user runs: personal data under DPDP and GDPR, and hosted only.
- Deleting a lead cascades its whole send history (`CLAUDE.md:194-196`).

Already in Chausar?: leads, MX check, blocklist, unsubscribe and address footer, owner records sends (`customers/leads.ts`, `customers/lead-methods.ts`). Lead status already has `replied` and `lost` values (`leads.ts:42`) but no method sets them. Revenue-squad's day-3 and day-7 follow-up idea is in the 21 Oct card (`cards/marketing-commerce.md:153`) and not built. Not built: sequences, due rows, reply detection, Gmail connector.

---

## prashantforsure/10xconnect (no licence, proprietary by its README, 1 star, last commit 2026-07-09)

What it is: a large monorepo cloning Prosp.ai: LinkedIn and email outreach sequences sent through Unipile (a hosted LinkedIn API) using the user's LinkedIn session cookie, an "AI SDR" that drafts or auto-sends replies, a unified inbox with pipeline stages, and a safety layer of caps, warm-up and health checks. A mock adapter is the default.

Source: full, but proprietary ("all rights reserved", `README.md:409-411`). Learn only. Live sending depends on Unipile, a hosted service.

How it works:
- Caps per account and action per day (connection requests 15 by default, 25 ceiling; messages 30 and 80; InMail 5 and 30); a higher request is clamped down with a warning, never exceeded (`packages/core/src/safety/caps.ts:16-80`).
- Warm-up: a new account runs at 25 percent of its caps in week 1, then 40, 60, 80, and 100 percent after 28 days (`packages/core/src/orchestration/warmup.ts:9-52`).
- The rate governor counts today's actions across all campaigns for the account, applies warm-up and an acceptance-rate throttle, and returns `{ allowed, cap, usedToday, remaining, reason }` (`orchestration/rate-governor.ts:36-65`).
- Health: a restriction event pauses the account; captcha or checkpoint events lower the score and say "slow down"; acceptance under 15 percent over 10+ requests warns (`orchestration/health.ts:28-60`).
- Reply pre-gate, before any model call, in a fixed order: unsubscribe or "not interested" (stop and suppress), owner muted the AI, closed thread, auto-responder loop, out of office, AI turn cap (hand to a human), already answered, cooldown, one-word thanks (`packages/core/src/brain/pregate.ts:152-199`).
- Hot-lead detectors (buying language, meeting request, pricing, legal, competitor, owner-set topics) send the thread to a human with a briefing built by code: who, why now, last message, key facts, recent thread, suggested next step (`brain/hotlead.ts:36-103`, `brain/handoff.ts:38-82`).
- "Are you a bot?" gets one fixed answer, never model-written (`brain/canned.ts:31-41`); AI voice notes need consent and carry a fixed disclosure (`packages/core/src/voice/index.ts:12-38`).
- Advisory lints: salesy phrases, hard calls to action, a link in a first message, over 50 words, LinkedIn limits (connection note 300 characters, InMail subject 200 and body 1,900, message 8,000) (`composer/guardrails.ts:18-160`); timing lint warns on a message less than 7 days after a connection request or two messages under 2 days apart (`composer/sequence-lint.ts:33-114`).
- Inbox: filters All, Reply required, Important, Mine; stages New, In conversation, Qualified, Booked, Lost; an AI draft card with "Approve & send", Edit, Discard; a hot-lead card "over to you"; one plain sentence per escalation reason (`apps/web/components/inbox/inbox-client.tsx:36-199, 965-1026`). A banner says when simulation mode sends nothing real (`apps/web/components/simulation-banner.tsx`).

Take for Chausar:
- Business: a LinkedIn outreach and reply desk for a consultant, a recruiter or a ghostwriting agency. Offers: a monthly outreach programme (for example 100 connection notes and two follow-ups each) plus reply handling. The agent researches each lead from the profile URL the owner adds, drafts the note and follow-ups, and drafts replies; the owner sends each one. Default mode is `handoff` (Chausar opens the profile and copies the text); `owner-browser-session` per message is possible later, with approval per message and a risk line that says LinkedIn's terms ban automated messaging.
- Engine: a send governor for any owner-account action: caps per account and action per day, only tightening (an owner can lower, never raise past the ceiling), warm-up for a newly connected account, and an automatic pause when the browser lands on a checkpoint or restriction page, with a Today row telling the owner to open LinkedIn themselves. Counts even handoff sends the owner records, so the app warns before the owner over-sends by hand.
- Engine: reply triage in code before any model call, using the pre-gate order. Opt-out text moves the lead to blocked through the existing `optOut`; only "allow" replies get an agent draft; pricing, legal, meeting and buying replies skip the agent and become a Today row "Priya asked for pricing. Reply yourself." with the code-built briefing.
- Engine: the fixed honest answer to "are you a bot?" and mandatory disclosure on any AI voice, as data in the playbook.
- Engine: message and timing lints as advisory checks on outreach drafts, with LinkedIn's character limits added to the channel table (each with a source and checked-on date before use).
- UI: an inbox view in Clients: "Reply required" filter, five stages with a lead moving to a client on "Won", one sentence per escalation reason, a hot-lead row that says "over to you".

Traps:
- Session cookie capture: the browser extension reads the HttpOnly `li_at` cookie and sends it with the browser's user agent to the server, which hands it to Unipile (`apps/extension/background.js:1-20`, `apps/extension/README.md:4-15`).
- Detection evasion: region-matched residential proxies and matching user agents to dodge LinkedIn's checkpoints (`apps/extension/STAYING-CONNECTED.md:5-55`); "humanized auto-reply delay so replies never look like a bot" (`README.md:95`).
- Autopilot replies with no human, while the canned answer says "a real person (me) reading every reply" (`brain/canned.ts:32-35`), which is false in that mode.
- Lead import from Sales Navigator searches, posts and groups is scraping against LinkedIn's terms.
- "Hours saved" is AI replies times an assumed 3 minutes, shown as a stat with no label (`apps/api/src/modules/analytics.module.ts:274-275`).
- Proprietary: no code may be copied.

Already in Chausar?: the community-replies offer with approval of every reply on the floor exists in the social playbook (`playbooks/social/playbook.ts:157-160, 191`); a checkpoint URL already counts as signed out (`build/browser.ts:39`); shadow mode simulates outside actions (`docs/venture/ink.md`, journal row). Not built: caps and warm-up per account, restriction pause, reply triage, hot-lead rows, LinkedIn DM drafting, inbox stages.

---

## Five playbooks this group points to (outline, all `planned`)

| Playbook | Who runs it | What the owner approves | Connectors and labels | How it earns |
|---|---|---|---|---|
| Cold email with follow-ups | Web designer, CA practice, freelancer selling to small firms | Each first email and each follow-up before the owner sends it; the blocklist | Built-in leads (`write`), mail app (`handoff`), Gmail thread read and drafts (`planned`) | Monthly outreach fee, or the owner's own pipeline |
| LinkedIn outreach and reply desk | Consultant, recruiter, ghostwriting agency | Every connection note, message and reply; anything about price or legal comes to the owner as a row | LinkedIn `handoff`; `owner-browser-session` per message later, with the ban-risk line | Monthly programme fee set by the owner |
| Newsletter service | CA practice, creator, local business | Each issue send (always-ask floor), imports with consent attestation, sponsor copy | Newsletter tool `handoff`; SES or MailCheap Cloud `planned: write` | Monthly fee per client; sponsor slots and paid tier on the owner's own list |
| Influencer marketing desk | Small agency or brand marketer | Creator shortlist, each price offer, each outreach email, the disclosure clause | YouTube Data API `planned: read`; Instagram and TikTok stats `handoff`; leads engine for outreach | Fee per campaign; price checks priced per creator |
| Reddit and community lead report | Founder, coach, service seller | Nothing is posted; the owner replies personally | ThreadSnoop or Reddit Data API `planned: read` | Weekly report fee |

Common rules for all five: leads need a source URL; agents draft and the owner sends; opt-outs are permanent; caps only tighten; no proxies, faked user agents or "look human" delays; any rate or price is computed by code with a receipt, or shown as "model estimate".

---

## Ideas ranked by value

| Idea | From | Kind | Value for B2C owners | Effort |
|---|---|---|---|---|
| Follow-up due rows in Today, computed by code from recorded sends (wait from the real send, allowed weekdays, stop on reply) | Email-Sending-Tool | engine | high | M |
| Reply triage in code before any model call (opt-out to blocklist, out-of-office, loop, cooldown, turn cap) | 10xconnect | engine | high | M |
| Hot-lead rows: pricing, legal, meeting or buying replies skip the agent and reach the owner with a code-built briefing | 10xconnect | engine | high | S |
| Send governor for owner-account actions: daily caps that only tighten, warm-up, pause on checkpoint or restriction page | 10xconnect | engine | high | M |
| Gmail connector: read thread headers for replies, create follow-ups as drafts in the same thread, owner sends | Email-Sending-Tool | connector | high | L |
| Pre-send checks split into blocking and warning, each with a fix that opens the exact field | MailCheap | UI | high | S |
| Lead pipeline: Replied, Lost and Won (to client), "Reply required" filter, one sentence per escalation reason | 10xconnect, Email-Sending-Tool | UI | high | M |
| Cold email playbook with sequences copied from templates per lead | Email-Sending-Tool | playbook | high | M |
| LinkedIn outreach and reply playbook, handoff first, browser session per message later with the risk line | 10xconnect, richworks | playbook | high | M |
| Voice file per business with six typed sections; "never use" words checked by code | richworks | engine | high | S |
| Per-lead timeline that separates sent, scheduled and projected ("≈") and marks where the reply came | Email-Sending-Tool | UI | high | S |
| Newsletter playbook: consent at import, first-send slice, pause and block thresholds, list cleanup states | MailCheap | playbook | med | L |
| Import cleaning with drop reasons and counts (typo, role, throwaway, trap, duplicate, suppressed, no MX) | MailCheap | engine | med | M |
| Reddit lead report: votes per dimension with a quoted line, code applies "4+ on two" and ranks, rules warning, never post | threadsnoop | playbook | med | M |
| Influencer price check in code: median views, coefficients tagged owner, default or agent, owner's cap, case log with actuals | kol-influencer | engine | med | M |
| Fixed honest answer to "are you a bot?" and mandatory AI voice disclosure | 10xconnect | engine | med | S |
| Advisory message and timing lints (salesy words, hard call to action, link in first touch, LinkedIn length limits, gaps under 7 or 2 days) | 10xconnect | engine | med | S |
| Calendar slot kinds with a selling share cap, plus one goal and one audience action per draft | richworks | engine | med | S |
| Revision due dates per month computed from the offer, shown as Today rows | richworks | engine | med | S |
| Screen inbound text for lines aimed at the AI, failing closed | MailCheap | engine | med | S |
| Method hints (read-only, cannot be undone, safe to repeat, reaches outside) generated with the method list, with a parity test | MailCheap | engine | med | S |
| Browser post confirmed by the platform's own HTTP response as well as the page | AutoSocial | engine | med | S |
| Setup health page: ready, warnings, blocking, each with its fix, and "Run once" before any schedule | AutoSocial | UI | med | S |
| Engagement wording that admits doubt (one open ambiguous; clicks and replies trusted) | Email-Sending-Tool | UI | med | S |
| Reports against the business's own past results (last 10, at least 2), future periods left empty | MailCheap | UI | med | S |
| Post diagnosis from the client's exported Insights: checklist by code, model view labelled estimate | richworks | playbook | med | M |
| One lead, one mailbox for the whole thread, refused otherwise | Email-Sending-Tool | engine | low | S |
| Influencer keyword plan with competitor terms apart and a negative list | kol-influencer | playbook | low | S |
| Short-form cross-posting of the client's own videos (needs media upload) | AutoSocial | playbook | low | L |
| Daily cap split between follow-ups and new leads as a ceiling with borrowing | Email-Sending-Tool | engine | low | S |
| Keyed-hash never-contact list shared across the owner's businesses | MailCheap | engine | low | S |
| UI-language alternatives for browser button and confirm text | AutoSocial | engine | low | S |
