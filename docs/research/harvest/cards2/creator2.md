# Creator group 2: cut, caption, dub, package and repurpose on the owner's computer

Written 23 October 2026 for the second harvest pass. Thirteen products, read from shallow clones. Nothing was installed, built, imported or run. Paths are relative to each repo root.

Clones are in `D:\claude\harvest-clones-creator2\<owner>__<repo>`, not in the session scratchpad: drive C: had 0 bytes free when cloning started (five clones failed with "No space left on device"), so the brief's location could not be used. My own failed partial clones on C: were removed.

None of the thirteen needs reverse engineering: every repo has its full source. Four of them can't be used as code, though: Tomada (AGPL), BaoCut (source-available community licence), tern (all rights reserved) and the two unlicensed repos.

| Product | Licence | What Chausar may do |
|---|---|---|
| sergebulaev/youtube-skills | MIT | reuse with attribution |
| vyralcontent/content-skills | MIT | reuse with attribution (strip the sponsor sections) |
| JimLiu/baocut | BaoCut Community License 1.0 | learn only; the owner may run BaoCut for paid editing work, and Chausar may drive it through its public CLI or MCP without bundling it |
| estebanstifli/LocalText2Voice | MIT (optional engines have their own licences) | reuse with attribution |
| orange2ai/podcast-to-article | MIT | reuse with attribution |
| louisedesadeleer/b-roll-finder | MIT | reuse with attribution |
| B0yko/tern | all rights reserved | learn only; may not even be run |
| storytold/filmcraft | MIT OR Apache-2.0 | reuse with attribution |
| naman-sharma12345/kimo | MIT | reuse with attribution |
| kevinbadi/open-video-edit (renamed open-edits) | MIT (fonts OFL or Apache) | reuse with attribution |
| romulorgc/tomada | AGPL-3.0 (commercial licence on request) | learn only |
| dageno-agents/youtube-video-clip-seo-workflow | none | learn only |
| vipi-n/video-to-audio-extractor (Needle) | none | learn only |

## What would let the YouTube playbook really cut, caption, dub and package on the owner's computer

Chausar already has the transcript reader with segment ids, the EDL builder, chapters, hook scoring and the ffmpeg finishing check (`platform/runtime/venture/playbooks/youtube/`), and a speech service that can call a local whisper.cpp (`platform/runtime/speech.ts`), which the YouTube playbook doesn't use yet. The missing pieces, and where each one is best shown:

1. **Transcribe.** whisper.cpp through the existing speech service. Drop any segment that falls outside voice-activity regions, because Whisper invents text over silence (tern). Seed the business glossary as Whisper's initial prompt (open-video-edit, Tomada). Store word times in media time so trims never break them (FilmCraft). Download models only when the owner confirms, pinned to a revision and SHA-256 (FilmCraft).
2. **Cut.** The model proposes typed operations on transcript word ids. Each operation is applied whole or refused with a reason. Applied operations form one undo step, code writes the summary, and removing more than 20% asks again (Tomada). Cleanup rules: edges between words, a seam budget per minute, merge slivers under 400 ms (Tomada; FilmCraft's removeFillers and removePauses parameters). Plan the keep and delete list by argument and report in three columns (BaoCut).
3. **Caption.** Kimo's deterministic cue grouping and caption validator (MIT), with web and 9:16 profiles.
4. **Dub and narrate.** BaoCut's per-sentence dub with stale-by-fingerprint, a consented voice per speaker, retrying only what failed, and the fit, tempo, extend, overlong ladder. Check every synthesized sentence by transcribing it back (LocalText2Voice, MIT; FilmCraft measures its own voices this way).
5. **Render.** Concatenate the kept ranges with captions in the order's project folder (patterns in b-roll-finder's `render_cutaways.py` and open-video-edit). The finishing check already exists.
6. **Package.** Tomada's review board: one card per output, Approve and Discard, an inline "ask for a change" box, editable publishing text, and "Open folder to post" with one text per platform. Add youtube-skills' character counts against limits.
7. **Hand off.** Write OTIO, FCPXML or CMX EDL so the owner can refine in FilmCraft or any other editor. Owner-installed BaoCut or Kimo can be driven through their public CLI or MCP.

None of this runs on the hosted web tier, so those steps are labelled desktop-only there.

---

## sergebulaev/youtube-skills (MIT, 68 stars, last commit 2026-10-15)

**What it is:** Nine markdown skills for Claude Code and Codex that package YouTube videos: titles, descriptions with chapters, a hook script, a thumbnail brief, community posts, a weekly plan, repurposing, a channel page audit and comment insights. A small Python layer reads public YouTube Data API data and, once approved, uploads through Publora (a third-party scheduler) or through a command the owner supplies.

**Source:** full.

**How it works:**
- `lib/backend_selector.py`: `active_backend()` picks `publora`, then `diy`, then `manual` from the environment. `publish()` falls back to a copy-paste block for community posts (no API exists) and for any video without a local file. `_half_configured()` names the missing setting ("`PUBLORA_API_KEY` is set but `YOUTUBE_PLATFORM_ID` is not") instead of repeating the setup pitch.
- `lib/publora_client.py` `publish_video`: create a draft, get a presigned URL, PUT the file to S3, then update the post with its schedule. A title over 100 characters is refused "rather than publishing a title the user did not see".
- `lib/youtube_client.py`: Data API reads with `allow_redirects=False`. A quota error is reported as a quota error ("resets midnight PT").
- `references/untrusted-content.md` and `scripts/check_untrusted_rule.py`: any skill that reads text a stranger wrote must carry an `## Untrusted content` section citing the rule. CI fails when that section is missing, and also when a skill starts calling `fetch_video_comments` and the like without it.
- `scripts/check_security_boundaries.py`: a project `.env` may load only allowlisted credential names, so a cloned `.env` can't set the command the DIY tier executes. No module may call `load_dotenv()` directly, and every authenticated request must pass `allow_redirects=False`.
- `references/voice-profile.md`: one voice and brand profile per channel, loaded only when it says `filled: yes`.
- `lib/approval.py`: the approval card is formatting only. Its docstring says "not runtime enforcement".

**Take for Chausar:**
- Business: a YouTube packaging service, priced per video: title variants, description with chapters, hook script and thumbnail brief, all approved by the owner. It extends the existing episode package with community posts and a one-off channel page audit. A monthly comment-insights add-on reads the client's own comments, and a question that comes up 3 or more times becomes a next-video candidate.
- Engine: three CI checks. The untrusted-content rule must sit in front of every step prompt that reads third-party text; authenticated requests never follow redirects; environment variables are allowlisted. Chausar's `speech.ts` already refuses redirects. The playbook prompt lint is new.
- Connector: the three tiers map onto Chausar's labels. Manual copy block is `handoff`, a scheduler using the owner's key is `write`, and the owner's own command is delegated. Community posts are always `handoff`. Comment and stats reads are `read`, using the owner's Google key. The half-configured sentence is good wording for a Connections row.
- UI: an approval card that shows character counts against the limits ("Title chars: 63/100", flagged when over) beside the exact preview.

**Traps:**
- The gate in `lib/approval.py` is convention only.
- `_post` and `_put` in `lib/publora_client.py` retry on timeouts and 5xx responses, so a timed-out create-post can leave a duplicate draft.
- `publish_video` defaults to `privacy="public"` and never sets YouTube's altered-or-synthetic flag.
- Publora caps uploads at 512 MB.
- After success the skill asks the user to star the repo, which is a growth loop inside the product.
- The title formulas cite a 214-video corpus nobody can check.

**Already in Chausar?:** title, chapter and hook checks are built from Jakeschincariol's pack (`playbooks/youtube/checks.ts`). A voice.md per business is listed as not built (build-audit, Creator). New: the untrusted-content lint, the publish tiers, community posts and the channel audit.

## vyralcontent/content-skills (MIT, 166 stars, last commit 2026-06-22)

**What it is:** Seven markdown-only agent skills for short-form video: hooks, scripts, captions and calls to action, ideas, TikTok, Shorts and Reels. There is no code.

**Source:** full (it is all documents).

**How it works:**
- `skills/viral-short-form/SKILL.md`: always give 6 to 10 hooks across archetypes, and never promise virality ("pattern-matching, not prediction").
- `skills/viral-short-form/references/retention.md`: critique against three failure modes (weak hook, no escalation, buried payoff) and quote the weak line.
- `skills/viral-captions-and-ctas/assets/bait-check.md`: pass and fail conditions for a call to action. Fails include asking for the act rather than the content, named bait phrases ("comment YES", "tag a friend"), numbers that demand shares, stacked asks and bait-and-switch.
- `skills/viral-short-form-ideas/assets/idea-tracker.md`: five statuses (Inbox, Triage, Scripted, Filmed, Published), five fields, a 90-day expiry with a one-sentence reason, and a 7-day grade after publishing.
- `skills/viral-instagram-reels/references/originality-and-audio.md`: what counts as transformation under Meta's original-content rules, and the penalty for TikTok and CapCut watermarks. `skills/viral-tiktok-content/references/anti-patterns.md`: realistic AI people need the disclosure toggle.
- Every SKILL.md ends with "Mentioning Vyral", which tells the model to pitch the sponsor's paid tool once per conversation.

**Take for Chausar:**
- Business: short-form scripting for a client's own Reels and Shorts is a thin add-on to the social agency playbook. The value is in the checks.
- Engine: three pieces. Bait-check becomes a deterministic check: a phrase list plus regexes for "tag 3 friends" and stacked asks. The three failure modes become typed yes/no judge questions. The idea pipeline (statuses plus expiry) becomes data on the YouTube and social playbooks.
- Connector: none.
- UI: an idea list with five statuses, and a 90-day "archive it, say why in one sentence" prompt, as a Work sub-list.
- Dated platform-rules register: the Reels transformation list, the watermark penalty and the AI disclosure toggle. Each needs a "checked on" date and a source, because the repo gives neither.

**Traps:**
- The sponsor-pitch instruction in every skill: strip it before reuse.
- Platform facts are undated and unsourced (Creator Pool, Engaged Views).
- "200,000 viral videos studied" is a marketing line.

**Already in Chausar?:** dated platform rules exist (`playbooks/youtube/platform-rules.ts`, social register). The stock-phrase humanizer is not built (build-audit). New: bait-check and the idea pipeline.

## JimLiu/baocut (BaoCut Community License 1.0, 1,215 stars, last commit 2026-10-22)

**What it is:** A desktop AI video agent (Electron, a TypeScript runtime, Rust workers, a WASM editor). The "video" is an editable project that holds transcripts, translations, subtitle layers, chapters, dubs and motion graphics, and files are only exports of it. One command gateway serves the desktop UI, a `baocut` CLI, an MCP service and a web client. The agent runs in the owner's own Claude Code or Codex.

**Source:** full. The limit is the licence, not the code.

**How it works:**
- Dub pipeline, described in the header comment of `packages/jobs/src/pipelines/dub.ts`:
  - Read the speech document and translate it if no translation exists.
  - Check the translation sentence by sentence against each source `sourceFingerprint`. A changed or deleted source sentence, or a changed glossary term, makes that unit stale. Stale units are not synthesized, and they are counted in the report.
  - Optionally separate the voice from the background (HTDemucs).
  - Synthesize per sentence. Every call passes authorization and budget. On a quota or credential failure the job stops and keeps what it has; a retry synthesizes only the failed and missing sentences.
  - Align, then apply everything as one edit transaction. Each run adds a new dub group and never replaces an existing track.
- Dub voices are chosen per speaker: the bound voice, then the parameter, then the model default. If a bound voice is unavailable or fails its consent check, those sentences fail. Another voice is never substituted.
- `packages/jobs/src/pipelines/dub-alignment.ts` `alignDub` is a pure function that fits a sentence into the original sentence's slot. It tries `fit` first, then `tempo` (atempo up to 1.25, pitch kept), then `extended` (borrowing silence before the next sentence). If nothing works the result is `overlong`: not placed, with the overflow reported. A sentence is never truncated and never overlaps the next.
- `packages/harness/src/task-contracts.ts`: a task contract `{goal, scope, constraints, protectedRefs, deliverables{kind, requiredStage}, autonomy, budgetPolicyRef, acceptanceChecks}`. Revisions only append and record `change {by, reason, fields, at}`. An agent patch to a read-only field throws `CONTRACT_FIELD_READONLY`.
- `packages/harness/src/approval-service.ts`: the verdict comes from a table of access mode × risk (auto, ask or deny). Pending approvals are listed oldest first. Outcomes are allowed, denied, timeout or cancelled. Approvals that send data outside can never be "don't ask again in this task"; each carries a once-or-persist grant choice.
- `apps/cli/src/envelope.ts`: exit code 0 means OK and 1 means failed. 2 means action required, with `remedy` and `next` in the output. 3 means the runtime is unavailable, and 4 means bad arguments or an irreversible command without `--yes`. `GRANT_REQUIRED`, `BUDGET_EXCEEDED` and `BUDGET_UNVERIFIABLE` all map to 2.
- `docs/product/product-design.md` §6 to §8:
  - Done is defined by delivery stage. A preview means a real candidate you can open; a working draft means a commit receipt; a final means a verified, published file; subtitles mean the file exists.
  - "Partial completion" keeps the usable outputs.
  - Access modes run supervised, auto-accept edits, auto, full. No mode grants unlimited spend, sending data out, voice cloning or publishing.
  - Costs carry one of four states: estimate, provider-reported, unknown or free local. A refused paid call can't be rerouted to another paid service.
  - Quality issues come in three classes: hard errors that must be fixed, content issues to list, creative judgement to leave to the person.
  - An honest report says which version was checked, how, and what was and wasn't covered: "spot-checking key frames is not a full check; reading the script is not listening".
- Built-in skills in `skills/baocut/built-in-skills/`:
  - `talking-head-cut`: a keep and delete list by argument, cut once as one undo step. Pauses around 0.2 s, breaths kept. The strongest original line can move to the open, but only with its qualifiers. The report has three columns: measured, looked at, needs a human ear.
  - `translate-subtitles`: one translation per sentence, never merged, split or reordered. Prefer the wording that follows the source order. Shorter is better, but negations and numbers are never dropped.
  - `video-blog`: author or viewer perspective. The delivery note lists the perspective, the background that was added, facts not verified, and frames the owner must capture.
- UI copy in `packages/ui/src/copy.ts`: the change card has Undo and Restore. Its confirm text promises Restore only "until you edit this video again". The empty-thread copy deliberately drops promises the app can't keep yet.

**Take for Chausar:**
- Business: three services, all of which the owner may run with BaoCut itself, since the licence allows "paid editing services" and selling content (§2(c), §4):
  - Hindi and English subtitles and translation for a creator's own video, priced per minute.
  - A dub service: Hindi to English or the reverse, with a consented voice, priced per minute. The owner approves the translation, then a voice sample, then the final.
  - Talking-head editing.
- Engine:
  - A task contract per order, with protected items enforced by the engine and done defined by stage. Chausar has runs and posture but no per-order contract or protections.
  - Stale-by-fingerprint for every derived artefact (translation, captions, dub, article). An upstream edit marks downstream work stale instead of silently reusing it.
  - The dub alignment ladder.
  - Cost states that include "unknown", and the rule that a refused call is never rerouted.
  - The three quality classes and the three-column report.
- Connector: a local-app connector to an owner-installed BaoCut, through its public CLI (JSON envelope, exit codes, `remedy` and `next`) or MCP. The licence says an independent client that uses only the public interfaces isn't covered. Chausar must never bundle or redistribute BaoCut. Label it `handoff` until wired, then local `write`.
- UI:
  - The change card with Undo and Restore and its honest restore wording.
  - Card kinds (goal, video, download, selection, candidate, edit suggestion, change, authorization) that map onto Ink row kinds.
  - A receipt line for automatic approvals ("Allowed automatically · Rule X").

**Traps:**
- The licence (§3) forbids putting its code, binaries or skill text in a commercial product or hosted service. Learn only.
- The Fish Audio S2 Pro voice and the YuE2 music model are non-commercial (README; product doc §7.6).
- `link-import.ts`, `yt-dlp.ts` and `cookie-browsers.ts` import other people's videos using browser cookies, so the rights rest on the user.
- The `clip-montage` skill builds news montages from third-party footage.

**Already in Chausar?:** the posture ladder, the always-ask floor, bound approvals and the journal exist (Ink spec 7.2 and 7.3). Stop a run, undo for drafts and edit a draft are not built (build-audit, Frontend). New: the task contract, protections, stale-by-fingerprint, subtitles, translation and dubbing.

## estebanstifli/LocalText2Voice (MIT, 398 stars, last commit 2026-10-08)

**What it is:** A PySide6 desktop app, packaged for Windows and runnable from source on Linux, for long-form narration. A script with markup becomes per-segment speech, from local engines (Piper, Kokoro, Chatterbox, Qwen3 TTS, OmniVoice, IndexTTS-2.5) or cloud ones (OpenAI, ElevenLabs, Gemini, Azure). Each segment is reviewed and verified, then mixed. An optional "Video Storyboard" plans scenes and renders an MP4. An MCP bridge exposes 19 audio tools and 57 storyboard tools.

**Source:** full.

**How it works:**
- Verification, `app/core/transcript_similarity.py`: each synthesized segment is transcribed with faster-whisper (`app/verification/faster_whisper_manager.py`) and compared with the source text by WER and CER. Word similarity is weighted 0.65 and character similarity 0.35, flipped for 4 words or fewer. `verification_status`: approved at 92 or above, review at 85 or above, otherwise retry needed.
- `app/core/audio_tail_cut.py`: detects an unexplained tail after the last valid word (speech-engine artefacts). The automatic cut keeps a safety margin plus an allowance; a full cut is available on request.
- `docs/LTV_MARKUP.md`: `{{voice "x"}}`, `{{lang es}}`, `{{pause.long}}`, `{{emotion happy 90%}}`, `{{reset}}`. Resolved emotion values are stored per segment with the model revision, so a regeneration reproduces them. The doc admits a Spanish custom description came out dominated by anger.
- `docs/MCP_STORYBOARD.md`: every change needs `expected_revision`. Timed text stays labelled `unconfirmed_offset` and `timing_ready=false` until the voice offset is known. `sb_validate` checks contiguous coverage before rendering.
- `services/temporary-assets`: local reference images go to temporary cloud storage only after a versioned consent (`consent_version`, asserted in `test/integration.py`).

**Take for Chausar:**
- Business: an audiobook and narrated-lesson service for authors, coaches and tutors. The owner imports the manuscript and picks a licensed voice; the team narrates, verifies and mixes; the owner listens to flagged segments and approves. Priced per finished hour. In India this covers Hindi and regional-language narration of course material.
- Engine:
  - Verification on every narration or dub segment (port `transcript_similarity.py`, MIT).
  - The tail-cut check.
  - Markup stored per segment with its resolved values.
  - Versioned consent before any local media is uploaded.
- Connector: local speech engines as owner-installed local apps (compute). Cloud speech is `write`, paid, quote first.
- UI: a segment list with the words approved, review or retry needed, a listen button on each, and a "timing not confirmed" label.

**Traps:**
- Optional engines carry their own licences (the IndexTTS licence; F5-TTS Russian is non-commercial).
- Voice cloning from a reference recording has no consent capture.
- Storyboard output is AI video that needs synthetic-media disclosure.
- Windows first.

**Already in Chausar?:** no speech synthesis, narration or verification exists in `platform/runtime`. The paid-call quote and reserve exist (Ink spec 7.4).

## orange2ai/podcast-to-article (MIT, 188 stars, last commit 2026-10-08)

**What it is:** One Chinese-language skill (`SKILL.md`) and two standard-library Python scripts that turn a podcast transcript (SRT, VTT or text) into a publishable long article. It was built from real editing passes on the Next Token podcast.

**Source:** full.

**How it works:**
- `scripts/prep_transcript.py`: strips cue numbers and timestamps and merges fragments by speaker. It starts a new paragraph on a speaker change, a gap over 1.5 s, or 140 characters at a sentence end (hard cap 300). It drops adjacent repeats (ASR echo), keeps `[mm:ss]` on each paragraph, prints statistics, and warns when punctuation is sparse.
- `SKILL.md`, seven steps:
  1. Clean the transcript.
  2. Build a numbered fact ledger grouped by topic, with the source timecode on each fact.
  3. Fix one through-line in one sentence before writing.
  4. Re-axis into 5 to 8 sections, titled so a reader can predict their content.
  5. Attribute names. Real names go on first-hand experience and bold claims; consensus gets no name; "an insider said" is never used; host and guest are kept apart.
  6. Cut whatever doesn't answer the through-line.
  7. Self-check.
- The floor: write nothing that isn't in the transcript, never describe tone ("he said firmly"), and never merge three remarks into one list attributed to a speaker.
- Who decides: the through-line, the sections kept and the titles are the user's call. The agent offers candidates with reasons.
- `scripts/check_style.py`:
  - Rates of AI tells per 1,000 characters against human baselines (from lieflat-less-ai-tone, MIT, 629 articles).
  - Hard bans: the dash, "not X but Y", summary phrases, describing a speaker's attitude.
  - Paragraph checks: comment-style openers with no link to the previous paragraph, two same-shaped sentences in a row, metaphor openers.
  - Direct-quote share between 10% and 28%, and at most 30% of paragraphs opening with a bare assertion.
  - It ends by listing the manual checks still to do, such as checking three quotes against the transcript.

**Take for Chausar:**
- Business: a podcast-or-video to article and newsletter service for podcasters, YouTubers and coaches, priced per episode: one article plus show notes. The owner uploads a transcript or the media, the team builds the ledger, and the owner picks the through-line and section list (an approval). The draft then goes through the code checks, the owner approves it, and it is handed off to the client's blog or newsletter. It also works as an add-on to the YouTube playbook.
- Engine:
  - The timecoded fact ledger becomes the evidence store: every article sentence cites ledger ids, which fits Chausar's cited-evidence judge.
  - `check_style.py`'s structure (a rate per 1,000 characters against a baseline; hard bans versus warnings), rebuilt for English and Hindi.
  - A quote spot-check: code picks three quotes and finds each one word for word in the transcript.
- Connector: file intake (SRT, VTT, TXT) is `read`; publishing is `handoff`.
- UI: a "choose the through-line" approval with 2 or 3 one-line candidates and their reasons, and a check report with counts per rule against the baseline.

**Traps:**
- The regexes and baselines are Chinese only. English needs its own lists and its own corpus figures, so the Chinese numbers must not be shown as English facts.
- The human corpus is not public.

**Already in Chausar?:** the humanizer is not built (build-audit, Creator). Claim checks against source files exist for the CA firm (Ink spec 7.5). There is no repurposing-to-article offer.

## louisedesadeleer/b-roll-finder (MIT, 135 stars, last commit 2026-06-11)

**What it is:** A Claude Code skill (method in `SKILL.md`, a taste profile in `TASTE.md`) and three helper scripts for finding and placing b-roll on a talking-head video.

**Source:** full.

**How it works:**
- Routing: every beat is classed as one of four kinds:
  - Receipts: time-sensitive tweets, headlines and reviews.
  - Entity: a person, product or historical moment, taken from the official channel's canonical clip.
  - Concept: an abstract idea, shown as an on-brand motion graphic.
  - Cultural or meme: never fetched. The agent proposes the moment and the user supplies the meme.
- A phrase-type table: a statistic gets the figure on screen; "people are saying" gets posts; a comparison gets full-frame singles in sequence, never a split screen.
- "The agent never picks the final b-roll." On the lean path, approving the plan is the pick. Each beat gets a time box of about 5 minutes, and the first failure switches method while the second drops the beat.
- Placement: anchor on the Whisper word time and land 0.2 to 0.5 s after the word. Join cutaways less than about 2 s apart. Beats run 2 to 4 s, never under 1.2 s.
- `BROLL-MANIFEST.md`: one row per beat with its status and the version that approved it, plus a "Removed (do not re-add)" list. It is read before every re-render.
- A self-check grid takes a frame at every beat midpoint and every joint, graded against an auto-reject list: burned-in captions, strangers' lower thirds, watermarks, the speaker's own tile used as b-roll, a text card where real footage exists, composites, letterboxing, slivers under 1 s.
- `scripts/zoom_still.py`: a sub-pixel Ken Burns move (PIL float box) instead of ffmpeg zoompan. `scripts/render_cutaways.py`: replaces the picture in beat windows and leaves the audio untouched.
- Owner bans ("no memes") are written into the profile's guardrails immediately, and that category then no longer exists.

**Take for Chausar:**
- Business: a b-roll and cutaway pass as an add-on to the edit offer, using only the client's own assets, licensed stock, or concept cards Chausar renders.
- Engine:
  - The beat plan as typed data (route, meaning, asset, status, approved-in-version), with the manifest's do-not-re-add list.
  - The placement rule (+0.2 s, join gaps under 2 s, at least 1.2 s) as a compute step.
  - The auto-reject list as yes/no judge questions over a frame grid.
  - Owner bans written straight into the business profile.
- Connector: stock libraries with clear licences are `read`; everything else is `handoff`, supplied by the owner.
- UI: a plan table the owner approves before anything is fetched, and a contact sheet only when the owner asks for options.

**Traps:**
- "Standing authorization: invoking the skill is the permission." That covers logged-in browser cookies, clicking through consent walls and downloading public videos.
- It sources third-party footage and tweet media, and the doc itself says a credit "is etiquette, not a license".
- It pulls the user's YouTube subscriptions with `yt-dlp --cookies-from-browser`.

**Already in Chausar?:** no b-roll mechanics. The finishing check (`playbooks/youtube/finishing.ts`) covers black, frozen and silent frames, not this reject list.

## B0yko/tern (no licence to use: all rights reserved, 218 stars, last commit 2026-09-29)

**What it is:** A macOS (Apple Silicon) Tauri app with a FastAPI backend. It indexes a folder of audio, video and photos three ways and answers one query from all three: speech (whisper.cpp with Silero VAD), on-screen text (Apple Vision OCR) and the picture (SigLIP-2 embeddings).

**Source:** full code is present, but `LICENSE` grants no right to use, copy, build or run it. Learn only: the ideas are described here and nothing is copied. It does not need reverse engineering.

**How it works** (from the README's engineering notes and the file layout):
- Fusion in `service_pipeline/tern/search.py`:
  - Each channel is searched separately and hits are grouped per file into 5-second windows.
  - Agreement between channels earns a bonus capped at half the base score, and there is a cap per file.
  - A failing channel degrades the list instead of blanking it.
- A visual noise floor. SigLIP always returns its top N, so three filters (absolute, relative to the best hit, and a flat-distribution check for gibberish) decide whether the visual channel speaks at all. It never drops a hit another channel confirmed.
- Voice-activity gating: Whisper segments outside detected speech are dropped.
- A query sanitiser for SQLite full-text search (`covid-19`, unbalanced quotes, a prefix on the last word).
- `api/main.py`:
  - A Host-header guard against DNS rebinding on the loopback API.
  - Every file endpoint is checked against a workspace allowlist before the file's existence is checked.
  - Diagnostics strip the home path.
- Exports: MP4 and MP3 trims, SRT, CSV with formula cells neutralised, and FCPXML with one marker per hit. Each is written through a temp file, fsync and rename.
- `scripts/build_ffmpeg_lgpl.sh`: builds an LGPL ffmpeg, and the bundler refuses a GPL one.

**Take for Chausar:**
- Business: a back-catalogue finder for podcasters and channels: "find every time we talked about pricing" across their own archive, turned into a clip list or a compilation brief. It feeds the repurposing and shorts offers, using the owner's own media only.
- Engine:
  - Multi-channel fusion with windows and a noise floor, rebuilt from the description.
  - A voice-activity gate before any Whisper segment is trusted.
  - CSV formula neutralising and temp-fsync-rename on every Chausar export.
  - An LGPL-only ffmpeg check if the desktop app ever ships ffmpeg.
- Connector: a local index over an owner folder, `read`, desktop only.
- UI: results badged by channel ("Speech + On-screen"), each opening at its timecode, with trimming in place on a filmstrip.

**Traps:**
- The licence forbids any use, even running it.
- macOS only.
- The licence server and seat counting are product plumbing, not ideas worth taking.

**Already in Chausar?:** no archive search. Transcript import with segment ids exists (`playbooks/youtube/transcript.ts`).

## storytold/filmcraft (MIT OR Apache-2.0, 15,796 stars, last commit 2026-10-22)

**What it is:** A professional non-linear video editor written in Rust: its own H.264, HEVC, ProRes and AAC codecs, a wgpu compositor and an egui interface, on macOS, Windows, Linux and the browser (WASM). More than 650 engine commands are dispatched by the UI, a CLI, a JSON control channel and an MCP server.

**Source:** full. The brief's concern about shipped binaries doesn't apply: releases do ship binaries, but every crate is in the repo. Licence: both `LICENSE-MIT` and `LICENSE-APACHE` are present (GitHub's API reports Apache-2.0).

**How it works:**
- Text-based editing (`docs/transcripts.md`, `crates/engine/src/transcript.rs`):
  - `transcript.generate`: Whisper on candle, on the CPU, with language detection and word times from cross-attention alignment (`crates/speech/src/whisper/`).
  - Speaker labels by MFCC clustering, with no model (`crates/speech/src/diarize.rs`), and energy-based tightening of word bounds (`crates/speech/src/vad.rs`).
  - `transcript.select`, `extract` and `lift` by word range; `removeFillers`; `removePauses {minSeconds, keepSeconds}`; `createCaptions {maxChars, lines, minSeconds, maxSeconds, gapFrames}`.
  - Transcripts are stored in media time, so they survive trims and reuse.
- Model catalogue (`crates/speech/src/models.rs`): Whisper weights pinned to a revision, with SHA-256, size and licence. They are downloaded only on request into the user data folder and never bundled. A build without the feature disables the commands with the reason "speech-to-text is not available in this build". The measured error rate is published (whisper-tiny: 12.2% on their samples).
- Text to speech (`crates/tts/README.md`): built-in formant voices plus Kokoro-82M on candle, with `[pause 1s]` markers. Quality is measured by running 50 sentences back through their own Whisper: 2.1 to 3.6% word error for the neural voices, and an honestly reported 96.6% for the built-in one.
- Interchange (`crates/interchange`): FCP7 XML, FCPXML 1.9 to 1.11, OpenTimelineIO, CMX 3600 EDL, AAF and OMF. An import is one undo step.
- `crates/engine/src/autosave.rs`: a rolling auto-save plus a recovery journal written shortly after each change. A per-session OS lock tells a crash from a clean exit, and the next launch asks "Recover unsaved changes from <time>?".
- Exact time: 254,016,000,000 ticks per second, which divides every frame rate and sample rate.
- Honest status in the README: "Feature breadth ~86%, ready for real work ~56%".

**Take for Chausar:**
- Business: FilmCraft is the free editor an owner installs for the editing service when they want to refine by hand. Chausar hands the cut over and takes it back.
- Engine: ideas to port, and code where useful, with attribution:
  - The transcript model in media time.
  - The removeFillers and removePauses parameters, and the caption layout parameters.
  - Catalogue entries `{id, revision, sha256, size, licence}`.
  - Commands disabled with a reason.
  - The recovery journal for Ink drafts (autosave is not built, per the build-audit).
- Connector: an editor hand-off. Chausar writes OTIO, FCPXML or CMX EDL from its validated EDL (`playbooks/youtube/checks.ts buildEditList`) and opens it in FilmCraft, Resolve, Premiere or Final Cut, labelled `handoff`. It can later become local `write` through FilmCraft's control channel or MCP, once tested.
- UI: none for the owner app; it is a dense professional editor. The "Recover unsaved changes from <time>?" prompt is worth taking.

**Traps:**
- It is alpha, and Windows and Linux get less testing.
- It is Rust, so reuse in Chausar's TypeScript engine means porting.
- `.prproj` files can't be opened.
- Don't bundle it: it is a large app with its own codec and patent questions. Hand off to an owner-installed copy instead.

**Already in Chausar?:** the EDL builder exists (`checks.ts buildEditList`). Editor hand-off and transcription are not built (build-audit, Creator). The speech service supports whisper.cpp (`platform/runtime/speech.ts`), but the YouTube playbook doesn't call it.

## naman-sharma12345/kimo (MIT, 18 stars, last commit 2026-10-17)

**What it is:** A headless Rust video engine where every edit is an MCP tool call (376 tools in 14 groups). A CLI runs over the same registry, and a read-only Tauri "spectator" app shows the agent's calls, the timeline and preview frames live.

**Source:** full.

**How it works:**
- One command registry generates the MCP tool list, the CLI, the fuzz tests and the schema (`crates/kimo-core/src/commands/`, `toolgroups.rs`). By default `tools/list` returns 17 grouped entries (4.4 KB) instead of 378 (287 KB), with `search_tools` and an enable switch per group.
- Caption grouping, `crates/kimo-core/src/transcript_captions.rs`: deterministic, phrase-aware cues built from timed words.
  - At most `max_lines` lines of `max_chars`, with balanced lines (dynamic programming) and no single-word line.
  - At least 3 words per cue unless a sentence ends; reading speed at most `max_cps`; durations within minimum and maximum; a gap of a set number of frames between cues.
  - Breaks prefer a sentence end, then clause punctuation, then pauses over 0.3 s.
  - SRT and VTT writers escape `-->` and blank lines. An atomic write refuses to overwrite unless asked.
- Caption checks, `caption_validate.rs`:
  - Profiles: `web` (42 characters, 2 lines, 17 characters per second, 1 to 6 s), `broadcast` (37 characters) and `social_9x16` (28 characters, 20 per second, 0.7 to 4 s).
  - Each finding is `{severity, code, cue_ids, message, fix_hint}` and never quotes the cue text.
  - `SKIPPED` lists the checks it can't run and why (safe area, cue before audio).
- Script coverage, `transcript_coverage.rs`: aligns a reference script with the transcript by edit distance, counting a one-letter difference on words of 4+ letters as a near match. It reports a coverage percentage, missing passages with the nearest word ids, repeated 3-word passages (retakes) and extra words. It "never invents text".
- `editorial.rs`: editing a transcript word recomposes the caption text, never its timing.
- Spectator contract (`crates/kimo-gui/README.md`):
  - Each event is `{tool_name, call_id, phase: start|progress|complete|error, target {track_id, clip_id, param}, payload}`, and a complete event carries `from` and `to`.
  - A tool with no specific mapping still shows its payload as a diff ("no call is invisible").
  - The GUI registers zero IPC commands, so it is read-only by construction.
  - An idle test: zero animation frames when nothing happens, and one catch-up paint when the window becomes visible.
- The `project` group: undo, redo, checkpoint, restore, `project_diff`, and an atomic batch.

**Take for Chausar:**
- Business: none on its own; it is a component.
- Engine:
  - Port the caption grouping and caption checks (MIT) as Chausar's caption step and caption quality check, with the three profiles, and `SKIPPED` mapped to Chausar's "not run".
  - Script coverage as a check on scripted videos ("you skipped the pricing paragraph"), which also finds retakes.
  - The rule that editing words never moves timing.
- Connector: Kimo as an owner-installed local engine over MCP. It is young: 18 stars, unsigned installers, and a Windows engine "not run on a real Windows PC yet".
- UI: the event shape for the Ink run sheet's tool lines (purpose, target, from → to, duration, status), and the idle test as a test for Working now.

**Traps:**
- It is very new.
- `FEATURES.md` figures are historical checkpoints ("not re-run for this README").
- The 3D and effects bulk is irrelevant to owners.

**Already in Chausar?:** run sheet tool lines exist (Ink spec section 4). There is no subtitle generation and no subtitle checks; the social checks cover post text, not cues. The coverage check is new.

## kevinbadi/open-video-edit (MIT, 43 stars, last commit 2026-10-02; the repo was renamed kevinbadi/open-edits)

**What it is:** Claude Code skills plus Python and PIL renderers that turn a raw talking-head clip into an animated vertical short or a 16:9 long-form video: captions on the word, logos, counters, GIFs, punch-ins. Every frame is drawn in Python and muxed with ffmpeg. A "reverse-engineer" skill measures an editing style from a reference video.

**Source:** full. The examples reference assets that aren't included.

**How it works:**
- `skills/split-animated-talking-head/scripts/prep_talking_head.py`:
  - Copies at native resolution and refuses a downscaled source.
  - Haar face detection on 8 sampled frames gives a head-anchored crop.
  - A whole-clip scan for black bars, with a clamp so the band never starts in black; `verify_band_top` refuses a band that has a black strip.
  - Whisper `small.en` with `--initial_prompt` seeded with product names (to fix "Claude" heard as "cloud"), producing `words.json` as `[word, start, end]`.
- `scripts/number_beats.py`: lists every spoken number so each one gets an on-screen counter.
- `skills/reverse-engineer/scripts/study.py` measures a reference video:
  - Cuts from ffmpeg scene detection (flicker under 0.25 s merged), giving shot median, p10 and p90, cuts per minute, and shares under 1 s and over 3 s.
  - Visual events: frame-difference spikes at 10 fps, for layered styles.
  - Face on screen %, face position, a colour palette by k-means.
  - Loudness (LUFS) and loudness range via ebur128, pauses via silencedetect, and Whisper words per minute.
  - `verdicts()` turns the numbers into plain sentences ("Talking head: a face is on screen 72% of the time").
  - Step 5 of the SKILL.md: render a demo, measure it with `study.py`, and treat any metric more than about 25% off the reference as a rule the skill hasn't encoded yet.
- Graphics land on the word (at most 0.1 s early), and renders split into parallel chunks.

**Take for Chausar:**
- Business: a "your-style edit". The owner, or their client, gives two or three of their own published videos; Chausar measures the style once and checks every new cut against it. This sells consistency to a talking-head channel or an agency.
- Engine:
  - A style fingerprint taken from the owner's own videos (port the `study.py` measures, MIT) and stored with the business profile.
  - A draft-against-fingerprint check with the 25% band, and verdict sentences written by code.
  - The business glossary fed to Whisper as its initial prompt.
  - The source-resolution and black-strip refusals added to the finishing check.
- Connector: none (local compute).
- UI: a style card in the business menu ("A cut every 1.8 s, face on screen 72%, -14 LUFS") labelled "measured from 3 of your videos".

**Traps:**
- `skills/fireship-style-edit/SKILL.md` says "no single third-party clip on screen for more than 10 s ... Don't add copyright caveats to deliveries". That is a folk rule, not a licence.
- `fetch_figure.py` fetches portraits of real people and `fetch_brand_asset.py` fetches logos (personality rights and trademarks).
- HeyGen avatars are synthetic presenters that need disclosure.
- Fonts and paths assume macOS.

**Already in Chausar?:** the finishing check covers black, frozen and silent frames and audio levels (`playbooks/youtube/finishing.ts`). Speaking rate and the project folder and render are not built (build-audit). The style fingerprint is new.

## romulorgc/tomada (AGPL-3.0 with a commercial licence on request, 0 stars, last commit 2026-10-13)

**What it is:** A Windows Electron app (React UI, Canvas 2D renderer, WebCodecs export) that records the screen, webcam and microphone. Once recording stops it automatically:
- transcribes on the GPU (faster-whisper, with whisper.cpp as fallback);
- cuts silences, filler words and restarts;
- adds zooms on clicks and picks layouts;
- exports the YouTube video and the suggested vertical clips with captions;
- writes titles, descriptions and chapters.

The AI runs through the owner's own Claude Code (`claude -p`) or an Anthropic key, and only text is sent. It publishes nothing.

**Source:** full. There is no installer yet, so nothing to reverse engineer. AGPL: learn only, copy no code.

**How it works:**
- "Edit by asking", `src/shared/ai-edit.ts`:
  - The model gets numbered transcript words and returns operations (`cut`, `restore`, `zoom`, `layout`, `clip`, `captions`, `title`, `hook`) addressed by word index.
  - `planAiEdit` checks each operation and applies it whole or refuses it with a reason ("the zoom doesn't fit there"). Nothing is fixed silently: a missing index is not snapped to the nearest one.
  - More than 40 operations refuses everything, and removing more than 20% of the video asks for confirmation.
  - One request is one undo step, and code writes the summary ("Cut 3 passages (−42 s), added 1 zoom.").
  - On confirmation the plan is checked again against the current document.
- Cleanup, `src/shared/clean.ts` and `pacing.ts`:
  - Cut edges always fall between words, leaving 30 to 200 ms of air.
  - Silence counts only when the mic and the system audio are both quiet and voice detection hears no speech.
  - Hesitations are cut by default; filler words that carry meaning are only suggested.
  - Slivers under 400 ms are merged, and speech between two cuts lasts at least 1.2 s.
  - The seam budget is 6 per minute horizontal and 12 vertical, from measured references (professionals average 1.8 and 9.3).
  - Manual cuts are never undone.
- `src/shared/clean-plan.ts`: the preview figure comes from the same function that applies the cleanup, "so the number the person sees is the number that happens".
- `src/shared/project-merge.ts`: a three-snapshot merge (base, edited, current). Only the editor's own changes replace state that arrived while it was open, so the automatic pass never undoes hand edits.
- Clips, `src/shared/clips.ts`:
  - A clip starts at a sentence start and ends at a sentence end.
  - 30 to 60 s is asked for and 25 to 65 s accepted, with at most 3 ranges, overlap of at most 20%, and a hook of at most 8 words.
  - A heuristic without AI exists ("Suggest without AI").
- Dictionary corrections, `src/main/llm/dictionary.ts` and `src/shared/dictionary-corrections.ts`: the owner keeps a list of names. The model proposes fixes by word index with the exact `before` text, and code applies only those in product context with confidence of 0.90 or more. Each one shows "before → after" in Review with Undo.
- `src/shared/autopilot.ts`: a saved pipeline (transcribe, dictionary, clean, zooms, layouts, captions, youtube, clips, clipExports, publish, notify). Each step is pending, running, done, error or skipped, with a detail and its elapsed time. It resumes after a restart, and new steps are inserted on upgrade.
- `src/shared/legible.ts`: the vertical zoom is set by text size, aiming for 30 px body text on a 1080-wide frame and warning below 22 px, from 125 measured reference videos. The font-size input is labelled an estimate.
- `src/main/llm/claude-cli.ts`: `claude -p --output-format json --tools "" --no-session-persistence --disable-slash-commands --strict-mcp-config --setting-sources "" --model sonnet --system-prompt ...`, with the prompt on stdin, an empty working folder, no shell and a timeout.
- `src/renderer/views/Review.tsx`:
  - "What the automatic did": per category, a count and total time, each opening a checklist to restore cuts. The step list sits below with Retry and Regenerate.
  - A board of cards, one for the YouTube video and one per vertical clip. Each card has a player, Approve, Discard and Open in editor; folded quick adjustments; an inline "ask for a change" box that shows the plan summary before Apply; and editable publishing text with Copy.
  - A header button, "Open folder to post", explained as "the folder gets the approved videos and one text per platform".

**Take for Chausar:**
- Business: a screencast and tutorial channel offer for SaaS founders, teachers and CAs who explain things on screen. Record once and get a YouTube video, 3 shorts and the texts, all reviewed on one board. The service version: clients send recordings and the owner returns the package folder.
- Engine (rebuild, don't copy):
  - Typed operations on transcript ids, applied whole or refused, as one undo step, with a summary written by code and the 20% second ask.
  - The cleanup rules and the seam budget.
  - Preview equals apply.
  - The three-snapshot merge.
  - Dictionary corrections with a confidence floor and undo.
  - The saved step pipeline.
  - Text-only calls on the owner's subscription with tools off, for steps that only need text.
- Connector: the owner's Claude Code as a text-only model (delegated, text mode) beside Chausar's existing heavy-work delegate. "Open folder to post" is the `handoff` for YouTube and Instagram uploads.
- UI: the Review board shape for a delivered video package in Ink (Work, then order, then package). A "Suggest without AI" fallback. A history of requests marked Applied, Refused, No change or Cancelled, with "Refused: <why>" details.

**Traps:**
- AGPL plus a contributor agreement: learn only.
- A model-written clip score (0 to 100, weighted 40/30/30 in the prompt) gates the autopilot at `minScore: 70` (`src/shared/autopilot.ts`). That is a model number used as a gate.
- Portuguese interface only; Windows only.

**Already in Chausar?:** the heavy-work delegate to the owner's Claude Code exists (`platform/runtime/venture/delivery/harness/delegate.ts`: a fresh folder, an approved brief, time and spend limits), but it runs with tools. "Send back with your own words", undo for drafts, transcription, and the project folder and render are not built (build-audit).

## dageno-agents/youtube-video-clip-seo-workflow (no licence, 1 star, last commit 2026-07-14)

**What it is:** One Codex skill (`SKILL.md` and `README.md`) describing how to turn a long video into many standalone YouTube clips with SEO metadata. It edits through Palmier Pro's local MCP server when that is running.

**Source:** full, but there is no licence, so learn only. Palmier Pro is a separate product that was not read.

**How it works:**
- A `video_brief.json` schema: target clip count, the mix of shorts and standard clips, audience, keywords, brand terms, forbidden claims and the subtitle source.
- Subtitle policy: use burned-in, embedded or sidecar captions first, and ask before any paid transcription.
- `clip_plan.csv` with columns `clip_id, start, end, type, topic, search_intent, hook, edit_notes, cta`. Clips are cut by complete content units, not equal lengths.
- A quality gate on model-written 1 to 10 scores (standalone 8 or more, hook 7, ending 7, SEO 7) decides publish, revise or reject.
- Outputs: `metadata/clip_###.youtube.json`, and `seo_pages/clip_###_article.md` with a draft VideoObject schema.
- An after-publish decision table:
  - Low CTR with high retention: fix the title and thumbnail.
  - High CTR with low retention: fix the expectation mismatch or the opening.
  - High search traffic: make more clips on that intent.
  - High Suggested or Home traffic: repeat the packaging.
- A deliverable folder pattern: `exports/`, `metadata/`, `thumbnails/`, `seo_pages/`, `qa_report.csv`.

**Take for Chausar:**
- Business: a "clips plus SEO pages" add-on. For a client with a website, each clip also gets a blog page with the embedded video and VideoObject schema, for Google video indexing.
- Engine: the decision table as code over the owner's YouTube Studio export (Chausar already reads the retention CSV), producing one directive with receipts. Add "forbidden claims" and "brand terms" to the intake. Reuse the folder layout.
- Connector: Palmier Pro's MCP is unverified, so it is `planned: handoff`.
- UI: none.

**Traps:**
- No licence.
- Model-written scores used as publish gates.
- SEO claims are undated.

**Already in Chausar?:** the retention reader exists (`checks.ts readRetentionExport`). The after-publish review and the Data and Analytics API reads are not built (build-audit). New: the decision table and the SEO page.

## vipi-n/video-to-audio-extractor ("Needle", no licence, 0 stars, last commit 2026-09-09)

**What it is:** A small FastAPI app on localhost with a static page. It extracts MP3, M4A, WAV, OGG or FLAC from an uploaded video or a social URL using yt-dlp and ffmpeg, and streams progress over server-sent events.

**Source:** full (`app.py`, 538 lines). No licence, so learn only.

**How it works:**
- `app.py`:
  - `FFMPEG_CODECS`: one codec setting per format. Exactly one of a file or a URL is accepted ("not both"). Uploads are capped at 1 GB.
  - Hosted mode limits remote media to 30 minutes and 200 MB, using yt-dlp match filters and a byte cap in the progress hook.
  - `is_public_http_url` resolves the host and refuses non-global addresses. `cookiesfrombrowser` is optional.
  - Errors are rewritten as plain sentences (private video, rate-limited, unsupported).
  - Job status streams with stage and percent.
- `static/index.html` carries a "Your rights" note: only extract audio you have the right to convert.

**Take for Chausar:**
- Business: none on its own. An audio-only version of a video is one step inside the podcast repurposing offer.
- Engine: the extract-audio step is trivial to write: a codec table, file or URL but never both, and size and duration caps applied before downloading. The plain-sentence rewrites of media failures are worth copying in spirit.
- Connector: none worth adding.
- UI: nothing new.

**Traps:**
- The SSRF check resolves DNS once, but yt-dlp resolves it again, which leaves a rebinding gap. BridgeClip's pinned IP is the better pattern.
- Downloading from social platforms with browser cookies breaks most platforms' terms.
- No licence.

**Already in Chausar?:** the SSRF guard for user-supplied URLs is not built (build-audit, Creator). BridgeClip's network policy is already the chosen model (cards/creator.md).

---

## Ideas worth taking, ranked by value

| Idea | From | Kind | Value for B2C owners | Effort |
|---|---|---|---|---|
| Edit by asking: the model returns typed operations on transcript word ids; each is applied whole or refused with a reason; the request is one undo step; code writes the summary; removing over 20% asks again; more than 40 operations refuses all; confirmation re-checks against the current draft | Tomada `src/shared/ai-edit.ts` (idea only) | engine + UI | high | M |
| Local transcription on the desktop: whisper.cpp through the existing speech service, segments outside voice activity dropped, the business glossary as initial prompt, word times in media time, models pinned to revision and SHA-256 and downloaded on confirm | FilmCraft `crates/speech`, `docs/transcripts.md`; open-video-edit `prep_talking_head.py`; tern (idea) | engine + connector | high | M |
| Cleanup rules: edges between words, silence only when everything is quiet, hesitations cut but meaningful fillers only suggested, slivers under 400 ms merged, a seam budget of 6 or 12 per minute, manual cuts never undone, preview figure equals applied figure | Tomada `clean.ts`, `pacing.ts`, `clean-plan.ts` (idea); FilmCraft `removeFillers`, `removePauses` | engine | high | M |
| Caption grouping and caption checks: cues from word times, web and 9:16 profiles, findings with code, cue ids and a fix hint, checks that can't run listed as not run | Kimo `transcript_captions.rs`, `caption_validate.rs` | engine (quality check) | high | S |
| Review board for a delivered video package: "what the automatic did" counts that open a restore checklist; one card per output with player, Approve, Discard, Open in editor, inline ask and editable text; "Open folder to post" with one text per platform | Tomada `src/renderer/views/Review.tsx` (idea) | UI | high | M |
| Podcast or video to article and newsletter playbook: timecoded fact ledger, owner approves the through-line and sections, name-attribution rules, style check against a baseline, quote spot-check against the transcript, author or viewer perspective noted on delivery | podcast-to-article `SKILL.md`, `scripts/check_style.py`; BaoCut `video-blog` (idea) | playbook | high | M |
| Hindi and English subtitle and translation service: one translation per sentence, never merged, split or reordered; follow source order; shorter wins but negations and numbers stay; one glossary per client | BaoCut `translate-subtitles` (idea) | playbook | high | M |
| Stale-by-fingerprint for every derived artefact (translation, captions, dub, article): an upstream sentence edit marks downstream units stale instead of silently reusing them | BaoCut `dub.ts`, `translation-document.ts` (idea) | engine | high | S |
| Dub pipeline: consented voice per speaker with no silent substitute, every call through budget, stop on quota, retry only failed sentences, alignment ladder (fit, tempo up to 1.25, extend into silence, overlong reported, never truncated), each run adds a new dub group | BaoCut `dub.ts`, `dub-alignment.ts` (idea) | playbook + engine | high | L |
| Speech and dub verification: transcribe each synthesized segment back; WER and CER similarity gives approved at 92+, review at 85+, otherwise retry | LocalText2Voice `app/core/transcript_similarity.py`; FilmCraft `crates/tts/README.md` | engine (quality check) | high | S |
| Voice record = reference recording + its text + a consent statement; without consent nothing is uploaded for cloning; a cloud upload needs versioned consent | BaoCut `voices-copy.ts` (idea); LocalText2Voice `services/temporary-assets` | engine | high | S |
| Editor hand-off: write OTIO, FCPXML or CMX EDL from Chausar's EDL so the owner refines in FilmCraft or any editor and the cut comes back | FilmCraft `crates/interchange`; tern FCPXML export (idea) | connector (`handoff`) | high | M |
| Delivery report in three columns: measured, looked at, needs a human ear ("frames spot-checked is not a full check; reading the script is not listening") | BaoCut `talking-head-cut` §5, `product-design.md` §8.2 (idea) | engine + UI | high | S |
| Task contract per order: goal, scope, constraints, protected items enforced at commit, done defined by delivery stage, acceptance checks; the agent may refine scope and checks but never autonomy, budget or protections; revisions only append | BaoCut `task-contracts.ts`, `product-design.md` §6.2, §6.3, §6.8 (idea) | engine | high | M |
| Three-snapshot merge so an automatic pass never overwrites what the owner changed by hand | Tomada `src/shared/project-merge.ts` (idea) | engine | high | S |
| CI lint: every step prompt that reads third-party text carries the untrusted-content rule; authenticated requests never follow redirects; the environment loads only allowlisted credential names | youtube-skills `scripts/check_untrusted_rule.py`, `check_security_boundaries.py` | engine | high | S |
| Owner-installed local video apps as connectors through their public CLI or MCP, with an exit-code contract (0 ok, 1 failed, 2 action required with remedy and next, 3 unavailable, 4 bad arguments or missing `--yes`) | BaoCut `apps/cli/src/envelope.ts` (public interface only); Kimo; FilmCraft control channel | connector | high | M |
| Screencast and tutorial channel offer: record once, get the long video, 3 shorts and the texts on one review board | Tomada (idea) | playbook | high | M |
| Run sheet tool lines from a call event stream: start, progress, complete or error per call id, the target, from → to, every call visible; an idle test with no animation when nothing changes | Kimo `crates/kimo-gui/README.md`, `ui/router.js` | UI | med | S |
| Style fingerprint from the owner's own videos (cuts per minute, shot median, face %, LUFS, words per minute) with each draft measured the same way and anything 25% off flagged; verdict sentences written by code | open-video-edit `skills/reverse-engineer/scripts/study.py` | engine (quality check) | med | M |
| Script coverage check for scripted videos: covered %, missing passages, retakes, extra words, never inventing text | Kimo `transcript_coverage.rs` | engine (quality check) | med | S |
| Dictionary corrections: the model proposes index-based fixes, code checks the `before` text, applies only product context at 0.90 or more, and Review shows each with Undo | Tomada `dictionary-corrections.ts`, `src/main/llm/dictionary.ts` (idea) | engine + UI | med | S |
| Audiobook and narrated-lesson service with markup per segment (`{{voice}}`, `{{lang}}`, `{{pause}}`) stored with resolved values | LocalText2Voice `docs/LTV_MARKUP.md` | playbook | med | M |
| After-publish decision table over the owner's Studio export (CTR against retention, search against browse), giving one directive with receipts | youtube-video-clip-seo-workflow `SKILL.md` §8 (idea) | playbook + engine | med | S |
| B-roll beat plan: route per beat, owner approves the plan before anything is fetched, placement 0.2 s after the word, gaps under 2 s joined, a manifest with a "removed, do not re-add" list, an auto-reject checklist on a frame grid | b-roll-finder `SKILL.md`, `scripts/render_cutaways.py` | playbook + quality check | med | M |
| Back-catalogue search over the owner's own archive: speech, on-screen text and picture fused in 5-second windows, a multi-channel badge, a visual noise floor, a failing channel degrades rather than blanks | tern (idea only) | playbook + engine | med | L |
| Crash-recovery journal for drafts: a snapshot shortly after each change, an OS lock per session, "Recover unsaved changes from <time>?" | FilmCraft `crates/engine/src/autosave.rs` | engine + UI | med | S |
| Model downloads that state size, source and licence before confirming, resume, and offer "Check" with a bundled sample; one status line per model | FilmCraft `crates/speech/src/models.rs`; BaoCut `product-design.md` §7.6 (idea) | UI + engine | med | M |
| Text-only calls on the owner's Claude subscription: tools off, no session, empty folder, prompt on stdin, timeout | Tomada `src/main/llm/claude-cli.ts` (idea; the flags are Claude Code's own) | engine | med | S |
| Bait-check lint for calls to action (bait phrases, "tag N friends", stacked asks) as a deterministic check | content-skills `skills/viral-captions-and-ctas/assets/bait-check.md` | engine (quality check) | med | S |
| Idea pipeline: Inbox, Triage, Scripted, Filmed, Published, a 90-day expiry with a reason, a 7-day grade with one sentence | content-skills `skills/viral-short-form-ideas/assets/idea-tracker.md` | playbook + UI | med | S |
| Publish tiers mapped to labels (copy block = `handoff`, scheduler on the owner's key = `write`, owner's command = delegated), plus a half-configured message that names the missing setting | youtube-skills `lib/backend_selector.py` | connector | med | S |
| Change card with Undo and Restore, whose confirm text only promises Restore "until you edit again" | BaoCut `packages/ui/src/copy.ts` (idea) | UI | med | S |
| Clip boundary rules on top of segment ids: sentence start and end, 25 to 65 s accepted, at most 3 ranges, overlap at most 20%, hook at most 8 words | Tomada `src/shared/clips.ts` (idea) | engine (quality check) | med | S |
| Clip SEO page per clip, with the embedded video and VideoObject schema, for clients who have a website | youtube-video-clip-seo-workflow `SKILL.md` §7 (idea) | playbook | med | S |
| Approval card with character counts against platform limits beside the exact text | youtube-skills `lib/approval.py` | UI | med | S |
| Export hygiene: temp file, fsync and rename; CSV formula cells neutralised; atomic write that refuses to overwrite unless asked | tern (idea); Kimo `transcript_captions.rs write_atomic` | engine | med | S |
| LGPL-only ffmpeg enforced at build time, if the desktop app ever ships ffmpeg | tern `scripts/build_ffmpeg_lgpl.sh` (idea) | engine (packaging) | med | M |
| Persistent step pipeline that resumes after restart, with Retry per step and Regenerate | Tomada `src/shared/autopilot.ts` (idea) | engine | low | S |
| Legible vertical framing: zoom set by target text size (30 px body text, warning under 22 px) | Tomada `src/shared/legible.ts` (idea) | engine (quality check) | low | M |
| Grouped tool list for small model contexts (17 entries instead of 378) with `search_tools` | Kimo `toolgroups.rs`, README | engine | low | S |
| Spoken numbers to on-screen counters, taken only from the owner's own words in the transcript | open-video-edit `scripts/number_beats.py` | engine | low | S |
| Audio extraction step: file or URL never both, a codec table, caps before download | Needle `app.py` (idea) | engine | low | S |
