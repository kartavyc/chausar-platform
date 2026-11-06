# Creator group: YouTube channel and short-form playbook

Eight repos, read on 21 October 2026 from shallow clones. Nothing was installed or run. Judgements come from the code and docs, not the marketing. Paths are relative to each repo root.

## Jakeschincariol/youtube-agent-skill

- **What it is.** Eleven Claude Code skills (`/yt-script`, `/yt-package`, `/yt-retention` and so on) that help one creator run a YouTube channel. Six of them lean on small, dependency-free Python tools; nothing publishes.
- **How it works.**
  - Deterministic scorers sit beside the prose. `skills/yt-script/hookscore.py` scores a hook on five regex properties and weights the verdict 60% mean, 40% weakest property, so one dead property can't hide behind an average. `skills/yt-package/title.py` lints a title and thumbnail text as one pair: 60 characters for desktop, 40 for mobile, no repeated words between title and thumbnail, at most two all-caps words.
  - `skills/yt-retention/retention.py` reads a YouTube Studio retention CSV and reports three separate problems: hook leak (first 30 seconds), cliffs (sharp drops) and slide (steady bleed). Given an `.srt`, it prints what was being said at each cliff.
  - `skills/yt-viral/swipe.py` ranks competitor videos by views as a multiple of that channel's own median, and skips any channel with fewer than four videos. `skills/yt-chapters/chapters.py` checks YouTube's chapter rules (starts at 00:00, at least three entries, each at least 10 seconds).
  - Every skill reads one `voice.md` profile (`templates/voice.md`), refuses to invent a number, and ends with "ship it, or change it?".
- **What Chausar should take.**
  - The split itself: the model writes, small scripts score and lint. That's Chausar's no-LLM-arithmetic rule applied to creative work. Port `title.py`, `chapters.py` and the retention reader as **quality checks** (deterministic checks that run before the judge) and as **compute** steps in the playbook.
  - "Outlier multiple over own-channel median" is a good, honest **customer engine** and research metric, as long as code works it out and the model only names the pattern.
  - One `voice.md` per business, read by every delivery agent, maps onto Piece 3 (what your business knows).
  - Docs that say plainly what a scorer can't do (hookscore "separates bad from real, barely separates hits from misses") are the right tone for Chausar's capability labels.
- **Licence verdict.** MIT. Reuse with attribution.
- **Risks or gaps.** The heuristics are thin regexes and their calibration rests on 74 hooks. Fine as lint, wrong if anyone treats them as a forecast. There's no state, no run record and no versioning. The `yt-viral` input suggests `yt-dlp` against channel pages, which is a grey area under YouTube's Terms.
- **Label for Chausar today:** planned

## AgriciDaniel/youtubepro

- **What it is.** A local-first web app (React plus an Express server) that runs research, ideas, script and thumbnail for one video. It uses YouTube Data API v3 for public data and Gemini for analysis, and keeps keys on the server.
- **How it works.**
  - Each search becomes a **snapshot** with an id hashed from the filters, ordered video ids and retrieval time (`server/youtube.ts`, `createSnapshotId`).
  - Every AI claim is typed with a class: `observed`, `inferred` or `requires_studio` (`shared/evidence-contracts.ts`). An `observed` claim must cite at least one source video id. All ids must belong to the active snapshot (`validateEvidenceSourceIds`), or the response is rejected. Idea packages carry an `honestPromise`, a `studioMetric` to check after publishing and an `experimentRule`.
  - Charts and totals come from code (`client/src/lib/youtube-analytics.ts`: medians, ages, engagement sums), not from the model.
  - The thumbnail generator won't accept reference images until the user confirms they have rights to them (`server/thumbnail-contract.ts`, `referenceRightsConfirmed`). Quota errors are reported as quota errors (`server/provider-errors.ts`).
- **What Chausar should take.**
  - The three-way evidence class is ready to lift into the **quality judge** and into any research step. "Requires Studio" is a neat way of saying "we can't see this from public data", which is a never-fake rule.
  - Snapshot-bound claims: every claim a research agent makes points at a receipt id from the same snapshot, the way Chausar numbers point at calculator receipts. This fits **playbook steps** (gather, then write) and Piece 8's "numbers only as receipt references".
  - The rights checkbox before third-party references belongs at an **approval point** in any content playbook.
- **Licence verdict.** Apache-2.0. Reuse with attribution (keep the NOTICE if one is added).
- **Risks or gaps.** Single user, browser IndexedDB storage, no publishing and no owner analytics (it says so). Public search results are personalised and sampled, so they only stand for a slice. Gemini-only.
- **Label for Chausar today:** planned

## veedstudio/open-edit

- **What it is.** A CLI and agent skill that lets Claude Code, Codex or Gemini CLI edit video with no timeline. The agent writes an HTML composition that headless Chrome renders frame by frame, alongside VEED's hosted transcription, AI presenters and fal models.
- **How it works.**
  - **Quote, approve, spend.** `cli/src/commands/generate.ts`: the first pass quotes the cost and writes an approval holding the sha256 of the script. The second pass (`--yes`) bills only that recorded script and refuses if the hash changed, the cost went over the quote, or the approval is more than an hour old. A spent approval is deleted, so one yes buys one video.
  - **Never pay twice.** `cli/src/providers/queue-ledger.ts` keys each paid job by what was asked for, not by when. Its lifecycle is claim, then submit, then record, using exclusive attempt files and leases. `cli/src/veed/charge-records.ts` writes the charge record *before* the paid call, so a lost response leaves a "possibly bought" record that gets resolved by looking the job up, never by buying it again.
  - **Honest estimates.** `cli/src/veed/voice-rates.ts` measures each voice's speaking rate from earlier paid runs and quotes a range, with the single figure leaning slow so the bill doesn't come in over the quote.
  - The edit is a validated EDL (`cli/src/edl.ts`) snapped to frames, and the folder `runs/<key>/` is the whole project. Init asks before installing anything machine-wide (`APPROVAL REQUIRED`).
- **What Chausar should take.**
  - The quote, hashed approval and single-use spend is the right shape for every paid **connector** call and for the **autonomy ladder**: the owner approves an exact payload and an exact cost, and the cost comes from code. It fits Piece 4 (cost worked out by code) and Piece 11 (receipts).
  - The idempotent paid-job ledger belongs in the harness for any metered tool (video generation, TTS, transcription). Rehearsal mocks should copy the same record shape.
  - "Project folder is the edit" works as the **delivery agent** artefact for video orders: the order's files plus an EDL plus a render, all replayable.
- **Licence verdict.** Apache-2.0. Reuse with attribution (there's a NOTICE file to keep).
- **Risks or gaps.** The best paths are VEED-hosted and paid, and fal bills the user's own key. Rendering needs Chrome, ffmpeg and sometimes WhisperX, which Chausar's hosted tier can't run. The cost estimates are the authors' own, not vendor prices. AI presenters and lipsync create synthetic people, which brings disclosure duties on YouTube ("altered or synthetic" flag) and Meta (AI labels).
- **Label for Chausar today:** planned

## diffusionstudio/editor

- **What it is.** A desktop video editor (macOS and Windows) whose project is a folder of JSX, plus an MCP server and CLI (`diffusion`) so a coding agent can edit by writing code while a person refines it on the canvas.
- **How it works.**
  - "The source is the document": the app compiles the JSX, renders it, and writes canvas edits back to the element that authored them (`docs/reference/tools/README.md`). One tool catalogue in `packages/dapi` serves MCP, CLI and docs from the same schemas.
  - Cheap structural checks run before rendering: `check` finds spans where nothing visual is scheduled (likely black frames), hidden children and failed assets, at no cost (`docs/reference/tools/check.md`). `probe`, `waveform`, `filmstrip` and `grab` give cheap looks before the paid `listen` or `transcribe`.
  - `generate` returns credits and an ETA, can run with `estimate` only, and takes `maxCredits` to refuse jobs above a ceiling (`packages/dapi/src/tools/generate.ts`).
  - The written walkthroughs (`docs/guides/walkthroughs/podcast-clip.md`) say: write the brief first, run discovery on an audio-only pass, cut segments at silences, and treat self-containment as the hard requirement.
- **What Chausar should take.**
  - The order of work in the podcast walkthrough (brief, cheap audio pass, segment, find, then fetch video) as **playbook steps** for a clipping offer.
  - "Check structure before you render" as a deterministic **quality check** layer, ahead of any judge.
  - `estimate` plus `maxCredits` as a spend cap per tool call in the harness (Piece 8's spend limit).
  - One schema catalogue feeding MCP, CLI and docs is a good model for Chausar's connector descriptors.
- **Licence verdict.** MPL-2.0. File-level copyleft: Chausar can link to or call it, but any MPL file we copy and change must stay MPL and be published. Learn the patterns, don't copy files.
- **Risks or gaps.** Generative tools and `listen` run on Diffusion's paid API. The `report` tool files a public GitHub issue with app logs attached and no review step, which a careless agent could use to leak private details. The README's sample prompts clip other people's YouTube and X videos, which invites reused-content and copyright trouble. Desktop only, so Chausar could only treat it as a `handoff`.
- **Label for Chausar today:** planned

## krakonjac300-pixel/podcast-shorts-factory

- **What it is.** A Python pipeline of ten "agents" that downloads a podcast from YouTube, finds clip-worthy moments, edits vertical Shorts, quality-checks them and uploads to YouTube through the official API, on a daily schedule with no human involved.
- **How it works.**
  - Finder (`factory/agents/finder.py`) transcribes with faster-whisper and asks an LLM to return moments as JSON with a 0 to 100 "virality estimate". Editor (`factory/agents/editor.py`) cuts, reframes to 9:16 with face tracking and burns in captions.
  - **Finishing Editor** (`factory/agents/finishing_editor.py`) is a real deterministic gate built on ffmpeg filters: `blackdetect`, `freezedetect`, `silencedetect`, `volumedetect`, a face-on-frame-edge check and a captions-over-face check. Verdicts are PASS, PASS*, FIX (auto-fix, for example raising a quiet track) or FLAG (blocks upload).
  - **Manager** (`factory/agents/manager.py`) pulls real views and retention through the YouTube Analytics API and has an LLM write `learnings.md`, which then goes into every agent's prompt. It keeps the old file if the new output has no usable sections.
  - **Compiler** (`factory/agents/compiler.py`) builds weekly long-form episodes from clips with an AI narrator. It measures commentary share on the finished cut and won't upload below a floor (about 30%), with each source excerpt capped at 75 seconds.
  - Uploader (`factory/agents/uploader.py`) defaults to `private` and schedules with `publishAt`.
- **What Chausar should take.**
  - The ffmpeg quality gate, almost as written, as the **quality checks** for any video deliverable: black, frozen, silent, clipped audio, wrong duration, captions over a face. All of it is code, nothing is guessed.
  - The PASS / FIX / FLAG ladder fits the harness: FIX triggers a bounded auto-repair, FLAG goes to the owner.
  - The performance loop, but rebuilt to Chausar's rules: code works out hook hold, drop point and prediction error as receipts, and the model only writes directives that cite them. Each change goes through Piece 9's improvement loop (one typed playbook change, tested, adopted by the owner) rather than overwriting a shared prompt file.
  - Commentary share measured on the finished cut is a good deterministic **compliance check** for any "transformative use" claim.
- **Licence verdict.** MIT. Reuse with attribution.
- **Risks or gaps.** This is the riskiest repo in the group. The default `config.yaml` sources are other people's shows (`@joerogan`, `@TheDiaryOfACEO`), with only a comment saying to pick shows that allow clipping. Mass reposting other creators' clips unattended is the pattern YouTube's reused and inauthentic content rules (YPP) and copyright claims target. "Fake multicam" and an AI narrator built to clear monetization rules are attempts to game the policy, not to comply with it. The uploader never sets the synthetic-media disclosure. An LLM scores virality and reasons over raw numbers inside the prompt, which breaks Chausar's no-arithmetic rule. API projects that haven't passed Google's audit get their uploads locked private, which the docs don't stress.
- **Label for Chausar today:** planned

## Jakeschincariol/instagram-agent-skill

- **What it is.** Thirteen Claude Code skills for running an Instagram account (reels, captions, carousels, stories, DMs, replies), from the same author as the YouTube pack. Five Python tools; it never posts.
- **How it works.**
  - `skills/ig-reel/hookscore.py` and `skills/ig-reel/beats.py`: hook scoring with "dealbreaker" rules (a greeting, "stop scrolling"), and a beat sheet timed at 165 words per minute that flags a hook over 3 seconds, any beat over 4 seconds, and a missing loop back to the first line.
  - `skills/ig-caption/caption.py` shows the roughly 125 characters visible before "more" and caps hashtags at five.
  - **Humanizer.** `skills/ig-human/humanize.py` strips invisible characters, em dashes and 154 stock phrases listed in `slop.json`. `skills/ig-human/detect.py` scores a draft on five local heuristics (sentence-length spread, concreteness, stock words, typography, voice) and can compare before and after.
  - `skills/ig-profile/rubric.json`: a 12-item, 100-point profile rubric with weights stated up front. The README's fine print sets the policy line clearly: the Content Publishing API needs app review, and browser automation for posting, commenting or DMs breaks Instagram's Terms.
- **What Chausar should take.**
  - The humanizer lexicon and the invisible-character strip as a deterministic **quality check** on every outgoing draft. Chausar's own writing rules (no em dashes) already match it.
  - Timed beat sheets as a compute step: the model writes lines, code assigns timecodes and flags long beats.
  - Weighted rubrics stored as data (`rubric.json`) for the **quality judge**: the judge answers per item and code adds up the points.
  - The connector truth table in the fine print maps straight onto Chausar's labels: Instagram posting is `planned: write` (needs Meta app review), comments and DMs stay `handoff` (a draft the owner sends).
- **Licence verdict.** MIT. Reuse with attribution.
- **Risks or gaps.** `detect.py` is pitched partly as a way to dodge AI detectors. Chausar should use it for quality and voice and never sell it as detector evasion. The `ig-comment` templates ("Same for us: 40% of...") invite made-up figures unless the number comes from the owner. `ig-viral` asks the agent to drive the user's logged-in browser, which sits close to the automation line Meta enforces.
- **Label for Chausar today:** planned

## Agent-Field/reels-af

- **What it is.** An AgentField service that turns an article URL or a topic phrase into a 20 to 25 second vertical reel with word-by-word captions, using OpenRouter (Gemini TTS, Gemini image, optional Veo). The authors put the cost at about USD 0.10 a reel.
- **How it works.**
  - Topic mode runs a cascade (`src/reel_af/app.py`): four "hunter" agents each propose three angles (`agents/hunters.py`), a critic scores and keeps three (`agents/critic.py`), three narrators draft scripts (`agents/narrator.py`), and a judge picks a winner by comparing candidates instead of scoring each one alone (`agents/judge.py`).
  - Deterministic planning: `planning/beats.py` sets beat lengths from audio share into fixed 4, 6 or 8 second buckets. `planning/safe_zone.py` keeps text out of the bottom 480 px and right 140 px that the Reels and TikTok interface covers. `planning/font_metrics.py` measures text widths.
  - Independent steps run in parallel with `asyncio.gather`. A `result.json` sidecar records hook variant, beats, rankings, judge verdict and per-phase timing.
- **What Chausar should take.**
  - Comparing candidates against each other rather than scoring them one at a time, as the **quality judge** method for creative options. Chausar should keep only the winner index and the reasons, not the model's 1 to 10 "composite" number.
  - Safe-zone constants and font-metric fitting as deterministic **quality checks** for any vertical deliverable.
  - The sidecar as the run record for a creative delivery step (Piece 8's "every run records its hash").
- **Licence verdict.** Apache-2.0. Reuse with attribution.
- **Risks or gaps.** Topic mode asks for a "named source" but gets it from the model's memory: the sample output cites a 2009 study and a named researcher with nothing to check them against. For Chausar that's a fabricated-fact risk, so topic mode must require a fetched source document and quote its spans. The cost figure is the authors' own claim. It depends on the AgentField control plane, OpenRouter only. AI voice plus generated stills is synthetic media that needs disclosure on both platforms.
- **Label for Chausar today:** planned

## bridge-mind/bridgeclip

- **What it is.** An Electron desktop app (React UI, bundled Python engine, local FFmpeg) that turns long videos into captioned short clips, with a review editor and optional posting through Zernio. AI calls use the user's own OpenRouter key.
- **How it works.**
  - **Typed editorial gate ("Jev").** `docs/JEV_IMPLEMENTATION.md` and `engine/clip_engine/services/coherence_review.py`: each candidate clip has to pass every check on its own, each with its own probability floor (source faithfulness 65%, self-contained meaning and supported title 70%, opening context and complete ending 75%, not sponsored 80%, safe internal cut 95%). A high score on one check can't make up for a failed one. The questions, evidence and answers are all saved.
  - **Repairs can't invent.** A boundary repair has to cite an exact quote and its `segment_id`, return the first and last segment ids, and may only `omit`. It can't invent speech or timestamps. Two repair windows at most (60 seconds, then 180).
  - **Sponsor policy as data** (`engine/clip_engine/services/sponsor_policy.py`): never cut a disclosure to make an ad look like independent talk.
  - Separate budgets for acceptance checks and advisory checks (`docs/JEV_IMPLEMENTATION.md`). Every call records latency, tokens, reported cost, and an estimate labelled as an estimate. `engine/clip_engine/network_policy.py` resolves a host once, refuses private addresses and pins the IP, which blocks server-side request forgery. Platform limits for metadata are written down with the date they were checked (`docs/automation-metadata.md`). A queued clip isn't used up if transcription, generation or the pre-post check fails.
- **What Chausar should take.**
  - The best **quality judge** design in this group: typed yes/no questions, a floor per check, no averaging across checks, evidence saved per question. It matches Piece 9's "cheap judge answers four typed questions" and adds the per-check floors.
  - "Repairs select from given ids, never invent" as a harness rule for every write step that edits source material.
  - Separate budgets for checks that gate acceptance and checks that only advise, as a spend limit in Piece 8.
  - Dated platform limits as connector catalogue data (Piece 7), so a limit carries "checked on" and goes stale visibly.
  - The ideas behind `network_policy.py` for any Chausar connector that fetches a URL a user supplied.
- **Licence verdict.** MIT. Reuse with attribution (see `THIRD_PARTY_NOTICES.md` for bundled parts with their own licences).
- **Risks or gaps.** It accepts any public YouTube or Twitch link, so rights rest on one line in the docs ("use footage you have permission to use"). Daily automations post through a third-party scheduler (Zernio) with AI-written metadata. That's real write access, and the reused-content risk is the same as in the shorts factory. The probability floors are the authors' calibration, not a standard. Desktop and Electron only, with a heavy bundled runtime.
- **Label for Chausar today:** planned

---

## Draft: a "YouTube channel" playbook for Chausar

Built from the best of the eight. Every connector and step below is **planned** today. The labels show what each would be once built, and none is claimed as available.

### Who it's for

Someone starting a channel business: running their own channel, or offering channel services to creators (scripting, editing, clipping their own long videos, packaging, analytics reviews). Original or owned footage only. Clipping other people's content isn't an offer.

### Offers (two by default, like every Chausar blueprint)

1. **Video package per episode.** From the client's raw footage or idea: script with scored hooks, edit decision list and a first cut, title and thumbnail pair, description, chapters, a pinned comment. Price per video, set by the owner and turned into a receipt.
2. **Shorts from your own long video.** From one long video the client owns: 3 to 8 self-contained vertical clips with captions and per-platform titles. Price per batch, set by the owner.

Optional add-on (owner switches it on): a monthly **channel review**. The client's retention and analytics exports are read by code, with one main fix written up.

### Delivery steps (typed, as in Piece 8)

1. **gather.** Order intake: footage files or the long video, `voice.md` (built from three of the client's own videos if missing), the brief, and a rights statement (from youtubepro's rights checkbox).
2. **question.** Ask about anything missing: target length, audience, the one ask at the end, topics or speakers to avoid. Asking ends the turn.
3. **compute (probe).** Code probes the media, makes the transcript with word timings (local Whisper where it runs, otherwise planned), and finds silences. From diffusionstudio's order: cheap audio pass first.
4. **write (script or find).** Script mode: five hooks, then code scores them (hookscore weighting) and the agent keeps two. Clip mode: the agent proposes moments as transcript segment ids only (bridgeclip rule).
5. **compute (cut).** Code builds and validates the EDL and snaps it to frames (open-edit `edl.ts`), works out runtime at a set speaking rate, and plans beats into safe zones (reels-af).
6. **verify (deterministic).** Video checks: black, freeze, silence and loudness, captions over a face, safe zone, duration (shorts factory gate). Text checks: title length 60 and 40, title and thumbnail overlap, chapter rules, humanizer strip, no numbers that aren't receipts.
7. **verify (judge).** Typed yes/no questions, each with its own floor and no averaging: faithful to source, self-contained, opening has context, ending completes, title supported, not a sponsor read, ready for the client. Evidence saved per question. Comparing candidates against each other picks between hook or title options.
8. **approve.** The owner sees the exact draft, the check results and any paid tool quote.
9. **operator.** The owner (or the client) uploads. The YouTube description includes chapters, and the owner ticks the altered or synthetic content box when AI voice or presenters were used.
10. **compute (after publishing, add-on).** Code reads the retention export: hook leak, cliffs with what was said, slide, own-median outlier multiple. The agent writes one fix that cites those receipts. Each suggested playbook change goes through the improvement loop (Piece 9).

### Approval points

- **A1, accept the order and rights.** The owner confirms the footage belongs to the client or the client is licensed to use it. No rights, no order.
- **A2, any paid generation.** Quote first, approval hashed to the exact script or input, single use, expires after an hour (open-edit). Covers TTS, AI presenters, image or video generation, hosted transcription.
- **A3, draft delivery.** Every draft (script, cut, package, clip set) waits for the owner's approval of its exact text and files before it goes to the client.
- **A4, publishing.** Always the owner or client. Chausar never claims it posted.

### Quality checks (code first, then judge)

| Check | Kind | Source pattern |
|---|---|---|
| No black, frozen or silent spans; levels in range | ffmpeg, code | shorts factory `finishing_editor.py` |
| Captions off faces, text inside safe zone | code | shorts factory, reels-af `safe_zone.py` |
| Title 60/40 limits, no title/thumbnail repeat, two caps words at most | code | `title.py` |
| Chapters start 00:00, at least 3, each at least 10 seconds | code | `chapters.py` |
| Beat timing: hook under 3 seconds on Shorts, no beat over 4 seconds | code | `beats.py` |
| Invisible characters, em dashes, stock phrases removed | code | `humanize.py`, `slop.json` |
| Every number in copy is a receipt reference | code | Chausar rule, youtubepro evidence ids |
| Commentary share above the floor for any compilation | code | shorts factory compiler |
| Faithful, self-contained, supported title, not sponsored | typed judge, per-check floors | bridgeclip Jev |
| Research claims marked observed, inferred or needs Studio | schema | youtubepro |

A check that fails gets one bounded repair from given ids only, and the draft is flagged to the owner if it still fails.

### Connectors (labels as they would be when built; all planned today)

| Connector | Mode when built | Note |
|---|---|---|
| File intake (client footage, SRT, Studio CSV exports) | read | The safest path; covers retention and analytics through exports |
| Local transcription (Whisper) | compute | Desktop tier only; the hosted tier would need the user's own account |
| YouTube Data API (public search, the client's own channel list) | read | Needs the user's own Google key; quota errors shown as quota |
| YouTube Analytics API (the client's channel) | read | OAuth by the channel owner; read-only scopes |
| YouTube upload | planned: write | Unverified Google API projects get uploads locked private until audit; until then it's `handoff` (the owner uploads) |
| Instagram Content Publishing | planned: write | Professional account plus Meta app review; until then `handoff` |
| Comment replies and DMs | handoff | Drafts the owner sends; no browser automation |
| Diffusion Studio, VEED or CapCut editor | handoff | Hand the EDL or project to an editor the owner opens |
| Paid generation (TTS, presenters, video models) | planned: write | Only through quote, approve, spend, with a ledger so nothing is paid for twice |
| Scheduling (Zernio or similar) | planned: write | Owner opt-in per post, never daily unattended |

### Hard lines for this playbook

- No offers built on clipping or reposting other creators' content. Owned or licensed footage only, with the owner confirming at A1.
- No unattended posting. The autonomy ladder for this playbook stops at "approve each draft" until a write connector is real and tested.
- Synthetic voice or presenters are disclosed on upload, every time.
- The model never scores virality as a number and never does sums over analytics. Code computes, the model explains.
