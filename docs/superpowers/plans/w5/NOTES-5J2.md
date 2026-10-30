# 5J2: dubbing and local live captions

Status: implementation in progress; not a package PASS. The root reviewer separately passed the desktop microphone permission seam only.

## Built and named

- `translation-studio/dub-core.ts`, `dub-align.ts`: one consented licensed stock voice per speaker, separate group per run, at most one hundred source-bound sentences, fit then tempo up to 1.25 then available silence then explicit overlong. No truncation. Similarity uses shared transcribe-back thresholds; one retry only for a failed low-score sentence. Uncertain provider outcomes cannot retry.
- `dub.ts`, `dub-runtime.ts`, `dub-records.ts`, `dub-synthesize.ts`, `dub-finish.ts`, `dub-media.ts`: exact source and order fingerprints, live consent/revocation, per-sentence quote, existing speech spend reservation, post-DNS pre-send guard, quota stop and explicit resume, current-audio playback, local whisper verification with no expected-text prompt, measured quiet segmentation capped at ten seconds, bounded per-segment stretch and no-trim full WAV export. Client handoff always includes AI voice disclosure and the YouTube altered-content checklist. No upload is claimed.
- Paid synthesis and export require the existing named external adaptation-rights review. Real production rule remains unconfirmed. Private audio has no qualified local synthesis provider and refuses cloud synthesis. Preparation and local captions remain available.
- Stock Google Standard voices use the existing provider. Voice cloning remains planned for qualified provider access, consent terms and named review. No claim that stock speech clones a person.
- `live-captions-core.ts`, `caption-audio.ts`, `live-captions.ts`: desktop, host-permitted microphone capture; canonical mono 16k PCM; local whisper only, no network fallback. Draft, final and refined lines have speaker identity. Transient sessions stay in memory, expire and are invalidated by source/permission changes. Saving starts off and records only future confirmed lines; turning it off does not erase earlier saved lines.
- `LiveCaptions.tsx`, `caption-microphone.ts`, public `caption-worklet.js`: microphone access follows native owner start, bounded PCM/VAD chunks, separate in-progress/confirmed views, explicit save switch, stop and refinement. Async start is invalidated by permission changes/unmount. Speaker names are owner labels, not automatic diarization.
- `DubbingDesk.tsx`: per-speaker consent/voice assignment, own session-only speech connection, code quote with Figure receipt, exact paid approval, actual saved audio, local verify/listen, and disclosed download. Mounted from current dubbing job; captions are selected from live-caption orders in Translation.
- `fake-translation-media.ts` mirrors source/consent/digest/quotes/permission/privacy. Rehearsal tones and captions identify themselves as synthetic; fake local verification does not pretend it recognized client words.
- `j2-definition.ts` adds dubbing and live-caption offers, host permission intake, disclosure judge, current official rules with needs fields, actual tools and plan picks. `dub.align` and `dub.verify` read actual current saved evidence, never manufacture it or approve effects.
- Two domain-backed baselines added to translation-studio JSON: consent refusal and overlong segment. Existing four translation cases remain.
- `translation-guides.ts` and own catalogue row expose local-live-captions honestly. Stock voice references the existing Google speech catalogue. Own EN/HI text and hi-review entries added.
- Forget follows pre-job translation order/client identity, source files and audio assets, clears request/intake, cancels reuse, clears linked report/delivery copies, and erases ephemeral captions. Names/handles found only in unsaved captions also participate without persisting them.

## Test-first evidence

- `j2-core-red.log` to `j2-core-green.log`: absent pure core then six timing/retry/caption tests pass.
- `j2-caption-desk-red.log` to `j2-caption-desk-green.log`: real desk route absent then three local-only permission/save/race tests pass.
- `j2-dub-desk-red.log`, `j2-dub-finish-red.log` to corresponding green: real source/consent, reserved provider call, post-DNS revocation and measured export.
- `j2-dub-owner-red.log` to green: quota resume and content-verified actual audio playback.
- `j2-dub-connect-red.log` to green: own exact owner account setup, no provider call.
- `j2-dub-segments-red.log` to green: renderer previously stretched a 23-second whole sentence, now actual measured pieces stay at most ten seconds and preserve every input sample.
- `j2-caption-forget-red.log` to green: pre-job Forget previously left order open; now clears order/copies/session. Nine nearby native tests passed, including prior J1 public desk.
- `j2-caption-person-red.log` to green: unsaved caption-only name remained; now erased. Six native caption tests passed.
- `j2-caption-stop-red.log` to green: stop previously refused CAPTION_BUSY; now immediately invalidates in-flight recognition and discards late text.
- `j2-fake-forget-red.log` to green: before-job fake capture survived Forget; now three fake tests pass.
- `j2-caption-ui-red.log`, `j2-dub-ui-red.log` to green: missing owner components then real-shaped controls and exact binding pass. Initial caption assertion used an unavailable matcher; fixed assertion and reran.
- `j2-caption-race-red.log` to green: permission change during pending start previously acquired microphone; generation guard now stops late session without capture.
- `j2-tools-baseline-red.log` to green: tools were NOT_BUILT_YET and two cases absent; actual cores and typed evidence now run. Tool missing-run fixture corrected from records to conversations after stub replacement exposed that fixture typo.
- `j2-guide-red.log` to green: absent catalogue capability then honest guide/capability pass.
- `j2-owner-text-current.log`: four files, 28 tests passed at that checkpoint, including text glossary. Newer connection strings await final focused rerun.

## Independent desktop boundary review

Root Stage 1 SPEC PASS and Stage 2 QUALITY PASS, bounded to microphone permission only. Root reran three tests in `results/j2-root-permission-final.log`. Root's reusable one-second permission-cache finding was reproduced RED and removed: media permission checks always deny, forcing each acquisition through the one-use request handler and live native validation. Camera, mixed audio/video, subframes, other origins/windows, expiry, ended session and revocation during native verification refuse.

Actual pinned Electron 44.4.5 hidden harness used `use-fake-device-for-media-stream`, never the real microphone. `results/j2-electron-permission-result.json`: before start NotAllowedError; first acquisition granted; immediate second NotAllowedError; revoked session NotAllowedError; four request callbacks and one native verification. Process exited zero and closed its window. The ordinary restricted process could not start Electron; approved hidden process ran successfully. The pinned runtime was missing and was installed without touching root package-lock.json.

## Source and licence record

Independent implementation; no third-party code or model weights copied. BaoCut is learn-only source available, not vendored. Index-Translate Apache-2.0 segment/timeline source was read; its truncation behavior conflicts with this plan, so Chausar refuses overlong output. hayamimi MIT source was read for draft/final/refined and local PCM workflow. Mimi/BaoCut raw source fetches were unavailable; only catalogue notes were used for those ideas. User-installed model weight licences remain separate.

- https://raw.githubusercontent.com/bilibili/Index-Translate/main/video-dub/index_dub/segment.py
- https://raw.githubusercontent.com/bilibili/Index-Translate/main/video-dub/index_dub/timeline.py
- https://raw.githubusercontent.com/oboroge0/hayamimi/main/scripts/realtime_transcribe.py
- https://github.com/ggml-org/whisper.cpp/blob/master/examples/stream/README.md?plain=1
- https://ffmpeg.org/ffmpeg-filters.html
- https://docs.cloud.google.com/text-to-speech/docs/chirp3-instant-custom-voice
- https://support.google.com/youtube/answer/14328491?hl=en
- https://www.electronjs.org/docs/latest/api/session

## Pending before review-ready

Final native/UI types and focused suite, actual public FakeEngine end-to-end coverage, exact fake refusal ordering, final tool live-evidence regression, screenshot inspection in both languages/themes, final review and any fixes. No full J2 PASS or whole-wave gate claimed. The root owns all Git actions and broad gates.

## Shared-path ownership for later isolation

Own J2 helpers and tests listed above plus narrow changes only: translation existing definition/metadata/HI/checks/baseline/desk/records/privacy/tools/catalogue; network Forget caption-deps option and own hook; contracts new error codes; desktop main permission wiring plus new caption-permission.cjs; TranslationStudioDesk mount and own CSS/text; fake translation kind/Forget bridge, fake-speech-account, narration fake account digest hooks and quote helper type narrowing; fake-w4/fake/fake-work own translation file/copy hooks; build connectors/guides own local-caption entries; fixtures-guides and translation plan-pick row only. Never include unrelated I/B3/F3/R1 work or root package-lock.json.

## Final author checkpoint and independent native review

Root bounded Stage 1 SPEC PASS then Stage 2 QUALITY PASS for native J2 after the audio freshness repair. Root independently ran the original native prefix (21 tests) and final desk/media checks (6/6, `w5-j2-root-audio-final.log`). Desktop microphone boundary had its own separate PASS/PASS above. Full package owner/fake review remains pending.

The stale-audio tool finding had a genuine behavioral RED in `j2-tools-audio-red.log`, then 8/8 nearby tests passed in `j2-tools-audio-green.log`. `dub-audio.ts` now shares the exact saved upload/order/hash check across owner playback, verification, export and the two read-only tools. An actually verified and listened group passes; replaced bytes refuse DERIVED_STALE, deleted bytes refuse DUB_AUDIO_REQUIRED. Ready also requires a real alignment with a nonnull end.

Final privacy audit added two genuine REDs: `j2-linked-call-red.log` showed an opaque run-linked model request surviving Forget, and `j2-saved-forget-red.log` showed the fake retaining a transcript-only person's saved text after session end. Native now follows explicit run/preview/harness call IDs before deleting copies, preserving cost metadata; fake now decodes saved caption transcripts for the same matching boundary. GREEN: native 6/6 and fake 4/4 in the corresponding green logs.

Public FakeEngine paths now exercise registered intake, actual voice-consent route, own speech-account setup, exact quote approval, synthetic verification labels, local-caption setup and explicit saving. Multi-invalid missing-group/stale-digest ordering was behavioral RED then GREEN in `j2-fake-order-{red,green}.log`. Derived asset counts no longer invalidate unchanged consent identity; real consent revocation still blocks.

Final author native: 33/33 in `j2-author-engine-final.log`; full native typecheck passed in `j2-final-native-types.log`. Owner/fake UI: 10/10 across four files; the combined text run was 31/32 with only two unrelated R1 Hindi deadline spellings (`j2-author-ui-final.log`). UI types reported only unrelated R1 fake-chief/fake-va-report errors (`j2-final-ui-types.log`), no J2 errors. No whole-wave gate claimed.

Actual screenshots: `results/j2-{en|hi}-{light|dark}-{dub|caption|quote}-390.png`, all browser width and scrollWidth 390, plus `j2-en-dark-dub-1280.png`. Author inspected Hindi dark caption and quote plus desktop dubbing, with readable controls and no clipping. Initial restricted-server attempts produced Chrome timeout pages and were discarded; final captures assert real owner controls before saving. The final desktop image is dark and named accordingly. Review harness HTML/TSX/CSS removed, owned Vite/Chrome closed. Screens use clearly synthetic client text, no actual microphone or provider call.

## Independent owner-review repairs

Root owner review found late caption saving/refinement replies restoring a forgotten session, and loaded/pending dubbing audio surviving a failed source reload. Corrected test labels and fresh fixture response identity first, then recorded five genuine failures in `j2-owner-review-red2.log`; repaired owner files passed 9/9. Caption controls now bind late replies to the live session/generation, Stop can invalidate pending work, and current speaker labels apply to new lines. A separate continuity RED showed changing the label mid-line incorrectly relabelled its final result; per-line label binding fixes this while refinement keeps the original label. Final owner/fake checkpoint passed 15/15 in `j2-owner-review-final.log`.

The subsequent real FakeEngine owner mount exposed fake mutation events on read-only audio/export invalidating successful responses. `j2-owner-event-red.log` contains that real Load saved audio failure plus two approved-source-copy retention failures. Native and fake audio/export now have matching no-mutation event behavior. Dubbing hides retained data while reload is pending or failed and drops replies after privacy/source invalidation. Native/fake export eligibility explicitly requires a nonnull alignment. `j2-owner-event-green.log` passed 5/5, including actual FakeEngine audio loaded through DubbingDesk and event-free export. The D3 catalogue count assertions changed separately and are not part of J2.

Final closure checks: both engine and UI typechecks PASS in `j2-closure-engine-types.log` and `j2-closure-ui-types.log`; source rules, full existing accessibility place matrix and Hindi/text checks PASS 207/207 across three files in `j2-closure-ui-rules.log`. The accessibility matrix took 166 seconds and completed normally. A final Stop flush continuity regression was genuine RED (`j2-stop-label-red.log`), then caption UI6/6 GREEN: preserve the current line's label until its final flush, then clear its retained audio and label map. No new outside effect was added.

## Final independent acceptance

Root independent reviewer issued **STAGE 1 SPEC PASS**, then **STAGE 2 QUALITY PASS** for the complete J2 package after the owner lifecycle and fake event repairs. Independent settled owner/fake checks: 15/15 in `w5-j2-root-owner-settled.log`. Independent final native: 12/12 in `w5-j2-root-closure-native.log`, in addition to the earlier 21-test native prefix, final six audio/media checks and actual pinned Electron permission evidence. Root read the final Forget call linkage, explicit alignment checks and current source. Root inspected Hindi dark caption controls at 390 px and dark desktop dubbing at 1280 px, with no clipping finding. No blocker or should-fix remains. Live rights and provider qualification limits remain honest planned/manual boundaries.

Final author native regression rerun after the explicit alignment change passed 11/11 (`j2-closure-native-regressions.log`). Source is frozen. The final wave walk should recapture an active caption session with the now-visible editable speaker field; the existing resting-screen screenshots remain accurate. Root owns all Git actions, isolated integration and whole-wave gates.


## Parent editor privacy closure

A final parent TranslationStudioDesk review was reopened after discovering retained useResource data could keep private source text visible after Forget. The corrected regression first proves an unrelated desk refresh preserves dirty SourceEdit text, then proves a privacy event clears the old job and unsaved text. Genuine behavioral RED: `j2-parent-privacy-red2.log`; author GREEN 16/16: `j2-parent-privacy-green.log`. The earlier first RED was an invalid post-create mount timing fixture and is not evidence of the behavior. Parent actions now use a lifecycle generation, privacy/workspace changes clear selection and buffers, failed detail reads hide retained data, and benign reloads retain edits.

Root independently re-read the exact parent fix and ran the parent plus R1 owner/fake checks, 19/19 in `w5-root-r1-j2-review.log`. Narrow Stage 1 SPEC PASS and Stage 2 QUALITY PASS reclose the complete J2 package with the prior independent evidence retained. No remaining blocker or should-fix. Final active-session speaker capture remains part of the whole-wave walk.


## Actual Forget event integration correction

Root reopened the prior owner privacy acceptance because the earlier focused fixtures emitted nonexistent network.changed / venture.changed / order.changed events. Those earlier fixtures proved generation logic only, not actual product integration. Workspace changes already remount the app frame. The real native and fake Forget paths now publish the shared content-free privacy.forgotten event after erasure; that foundation belongs to the preceding integration commit.

The corrected actual FakeEngine parent regression first creates an unrelated order/job to emit a real benign desk.changed, proving dirty source stays intact. It then calls public network.forget and proves saved and unsaved source buffers disappear. Genuine behavioral RED: j2-parent-real-privacy-red.log. Earlier fixture attempts tried a second job on the same order or omitted required intake; those failures are not privacy evidence. A separate public FakeEngine caption owner regression shows actual Forget did not stop the active mocked microphone (j2-public-caption-privacy-red.log). Parent, dubbing, captions and desktop permission invalidation now consume privacy.forgotten. Caption labels also reset, and late replies remain generation/session fenced.

Author GREEN: 18/18 across five owner/fake/event UI files in j2-real-privacy-green.log. The shared stream contract independently exposed supplied runId retention; native, IPC, actual preload, direct browser and polling regressions fail before the narrow stripping fix (privacy-all-readers-red.log and privacy-all-readers-ui-red.log). GREEN: native event and microphone permission 7/7 in privacy-all-readers-green.log; browser event suite 16/16 in privacy-all-readers-ui-green.log. Original root emission/allowlist seam received this agent's bounded independent spec then quality PASS. The authored stripping and corrected J2 guards await root's independent final re-review; do not treat the earlier synthetic-event acceptance as proof of the reopened integration gap.


## Final actual-event independent closure

Root reviewed the narrowed shared privacy readers independently: bounded SPEC PASS then QUALITY PASS, native 12/12 in w5-root-privacy-reader-review.log. Root then ran the actual J2 parent/media/event suite 19/19 (w5-root-j2-privacy-review.log). A final benign Dubbing refresh finding was genuine RED in j2-benign-dub-red.log: unrelated desk.changed erased unsaved consent/key buffers. Those buffers now survive ordinary refresh, while privacy.forgotten clears them; pending actions remain conservatively invalidated on a desk mutation, and Connect clears the submitted key explicitly. Author nearby 7/7 GREEN in j2-benign-dub-green.log; UI typecheck PASS in j2-real-privacy-ui-types.log.

Root independently inspected that final delta and ran 7/7 in w5-root-j2-final-dubbing-review.log, issuing STAGE 1 SPEC PASS and STAGE 2 QUALITY PASS. Complete J2 acceptance is reclosed using the actual product event, retaining the previous native/audio/Electron evidence. The separately reviewed global Shell privacy remount is shared foundation, not a J2-only change. No remaining J2 blocker or should-fix; isolated candidate still waits for the preceding I commit.


## Isolated candidate on e866f568

Candidate results/5j2-staging contains only J2-owned files and semantic shared hunks. Desktop main was reconstructed from the committed base to exclude concurrent R2 forms-browser imports, handlers and lifecycle changes. The actual shared privacy event and Shell reset are inherited from I. Native translation Forget's previously imported but uncalled erasure helper is connected in this package, including captions dependencies and linked identity handles.

Both isolated typechecks PASS (j2-isolated-engine-types.log, j2-isolated-ui-types.log). Syntax/JSON validation PASS for 2,580 files (j2-isolated-syntax.log). Initial native focused run: 95/97; initial UI/source/text run: 83/84. All J2 behavior passed. The three failures were inherited I fixture integration: job-search-desk was omitted from the expected kit ID set and appended out of canonical registry order in two fixtures. The repair adds only that expected ID and reorders existing rows, preserving all nonowned values and future primary VA rows. Targeted isolated native rerun 13/13 (j2-isolated-integration-green.log); UI rerun 9/9 (j2-isolated-integration-ui-green.log). The changed parity test separately passes node syntax checking; regenerated JSON is parsed and hashed by the staging tools.

An isolated in-memory mutation removed only the native translation Forget call: the actual transient-caption public Forget test failed with AssertionError (j2-isolated-forget-mutant-red.log). Exact original bytes were restored in finally and hash-checked. The restored public caption and translation Forget tests passed in the 13-test rerun. The root lockfile is excluded; no Git mutations or provider effects were performed. Root validates the final patch and owns its commit and whole-wave gates.
