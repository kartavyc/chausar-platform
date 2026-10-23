# Agents group: second harvest pass (23 October 2026)

Seven products: JobOS, ZCode, trueforge, eve, Qwen-CUA, phone-harness, pi-plans. Each repo was shallow-cloned and read with file tools; nothing was run, built or installed. Licences, stars and dates come from the GitHub API on 23 October. Clones lived in `D:\claude\harvest-clones\` (drive C was full) and were deleted after each card.

Research input, not a decision. Everything here is `planned` for Chausar unless the "Already in Chausar?" line says otherwise.

---

## cobibean/job-os (Apache-2.0, 13 stars, last commit 2026-10-19)

What it is: a macOS desktop workbench for a job hunt. One Electron window holds a saved-jobs list, a persistent built-in browser, a DOCX editor and an agent chat; a local FastAPI service owns the state, and a local MCP server lets Codex, Hermes or any MCP client work the same jobs, browser and documents the user sees.

Source: full for the app (Electron main and renderer, Python API, MCP server, DOCX engine, tests). Optional private services (JobHunter, Hermes, Tailscale) are adapters only, by design. macOS only: credentials sit in the Keychain through a native helper (`apps/desktop/native`).

How it works:
- **Persistent browser.** Each tab is a `WebContentsView` on the partition `persist:jobos-browser-v1`, sandboxed, context-isolated, no devtools (`apps/desktop/src/main/browser/browser.ts:36-60`). Every site permission request (camera, notifications and so on) is denied with a notice; external protocols are blocked with a "copy the link" offer; downloads go through a save dialog (`browser.ts:655-775`). Before any URL is saved, user-info, fragments, `;jsessionid` path parameters and secret query keys (`api_key`, `code_verifier`, `SAMLart`, `PHPSESSID` and more, in any spelling or encoding) are stripped (`apps/desktop/src/shared/browserPersistence.ts:133-160`), against one fixture file both TypeScript and Python test (`tests/fixtures/browser-url-policy.json`).
- **How the agent sees and touches a page.** `snapshot` returns page text in pages of at most 12,000 characters, a sha256 `pageRevision` of the whole text, and up to 100 visible controls as opaque target ids, each with a fingerprint (role, name, disabled, type). `click` and `type` look the control up again and refuse with "target changed" or "capture a new snapshot" if the fingerprint moved (`browser.ts:347-525`). Agents never pass JavaScript, selectors or raw IPC (`docs/public/product-contract.md`, "Jobs and browser independence").
- **Save a job from the browser.** A fixed-protocol prompt (`apps/desktop/src/renderer/jobs/save-from-browser/saveJobPrompt.ts`) makes the agent read every page segment until `has_more` is false with one unchanged `page_revision`, at most 30 snapshots, before it may create the job; otherwise it must end with an exact error code, and the UI maps each code to one plain sentence ("JobOS could not confirm the complete job listing. No job was saved."). Jobs carry `listing_completeness` of `unknown`, `partial` or `complete`, and `complete` needs coverage evidence and a matching `verified_text_sha256` (`docs/public/mcp-capability-map.md`, "ingest a sourced job").
- **Approval of a finished document.** Only `origin: "user"` can approve; an agent call gets 403 "Agents may endorse a document, but only the authenticated user can approve it" (`services/api/jobos_api/app.py:5141-5216`). Approval stores a manifest of every representation's digest (PDF and DOCX); tampered or deleted bytes refuse approval, and a refresh that brings new bytes clears it (`state_store.py:3714-3800`; tests `services/api/tests/test_jobs_contract.py:2203-2390`).
- **Agent edits to the user's facts.** Each connected agent has a trust mode, `review` or `direct`. Some edits always become proposals whatever the mode: removals, identity changes, dropping an evidence link, and loosening a claim's `qualifiers` or `forbidden_uses` (`services/api/jobos_api/career_profile_collaboration.py:1371-1394`). A proposal carries a sha256 of its own payload; deciding re-checks that hash and the profile revision, and a decided proposal can't be decided again (`career_profile_collaboration.py:743-800`). A claim is `{statement, qualifiers[], forbidden_uses[]}` (`career_profile_complete.py:252-262`).
- **Tool review from Codex.** Only an elicitation whose text exactly matches `Allow the jobos MCP server to run tool "<name>"?` is shown to the user; anything else is declined, one review may be pending at a time, and it declines itself after 300 seconds (`services/api/jobos_api/codex_adapter.py:26-29, 425-491`).
- **What agents can't reach.** The MCP surface leaves out accepting proposals, changing trust, erasing evidence, and export, reset or delete of the profile (`docs/public/mcp-capability-map.md:196`).
- **Continuity.** Tabs, layout, chat, documents and the selected job come back after restart; changing the selected job never closes tabs or ends a sign-in; switching profile is blocked while a document is unsaved, an agent turn is running or a download is in progress (`docs/public/product-contract.md`).

Take for Chausar:
- Business: **a job application desk** for a self-employed career coach or resume writer, a common side business in India. Offers: build a client's career profile from one interview; a tailoring pack per role (resume and cover letter, DOCX and PDF); a weekly shortlist from listings the client sends. Steps: intake interview, career facts with claim boundaries (what the client may say and must not say), client shares listing links or text, agent captures the full listing with a completeness label, agent drafts, a check confirms the draft uses no fact for a forbidden use, the owner reviews, the client approves through a share link, the client applies. The owner approves every draft before the client sees it and every new claim about the client. It earns per pack or as a monthly retainer, priced by the owner. Agents never sign in to the client's job-board account, never apply, and never add experience the client didn't state.
- Engine or harness mechanism:
  - *Claim boundaries, loosening asks.* A business fact gets `qualifiers` and `forbidden_uses`. An agent may tighten one directly; dropping a qualifier or a forbidden use always becomes a Today row (rule shape from `career_profile_collaboration.py:1385-1391`). Chausar should add what JobOS lacks: a code check that a draft doesn't use a fact for a listed forbidden use. This fits the CA firm (a firm that may not claim audit work) and the social agency (client banned claims).
  - *Approval bound to the delivered bytes.* Approve a manifest of `{file id: sha256}` for every format sent; refuse if the bytes on disk changed; clear the approval when a re-render produces new bytes (`state_store.py:3714-3800`).
  - *Endorse versus approve.* Agents can mark work "ready"; only the owner's principal can approve, checked against the caller's identity, not a field in the request.
  - *Snapshot targets with fingerprints.* For Chausar's owner-browser-session posting, act only on a target id from the latest snapshot, and refuse if role or name changed. Capture is "complete" only when every text page shares one page hash.
  - *URL secret stripping* before a URL is written to the vault, journal or evidence ledger (`browserPersistence.ts:133`, fixture-driven).
- Connector: an **embedded owner browser** as a desktop alternative to Chausar's Playwright profile folders: the page sits inside the Chausar window so the owner watches the agent, sign-ins persist in a partition, and the agent reads through the snapshot. Honest label: `read` for capture on desktop; posting stays the existing approval-gated `owner-browser-session` path. Hosted web can't have it.
- UI:
  - Proposal card (`apps/desktop/src/renderer/career-profile/collaboration/CollaborationArea.tsx:113-175`): kicker "Waiting for you", title "Review <agent>'s change", a "Based on revision N" tag, the agent's reason, why it needs you, the evidence ("No Evidence attached, that's okay"), "Current saved entry" beside "Proposed entry", then "Accept exact change" and "Reject change".
  - Stale proposal: the primary button becomes "Review replacement", then "Confirm replacement" with the line "This does not merge the entries"; the secondary becomes "Keep current, reject change".
  - Direct agent edit: a status line "<agent> updated your Career Profile" with the reason and an Undo button (`CollaborationArea.tsx:178-192`).
  - Trust setting as two radio rows with consequences in plain words: "Review every change: You see the complete change and decide before it is saved." and "Allow direct edits: Ordinary edits happen right away, with history and Undo. Identity, removals, Evidence, and loosened boundaries still ask." (`career-profile/settings/CareerProfileAgentSettings.tsx:26-33`).
  - Layout presets by task: Research (browser large), Review (document large), Agent Focus (chat large), each persistent and resettable without touching data (`docs/public/product-contract.md`, "Primary workbench").
  - Demo data labelled in the data itself: "Northstar Kites (Fictional Demo)", "(FAKE)" resume, `synthetic_demo: true`.

Traps:
- "JobOS never auto-submits an application" rests on prompt text ("never click an Apply control", `saveJobPrompt.ts`); `browser_click` will click any visible control, Apply and Submit included. A real stop needs code: hold any click on a submit control or inside a form that posts, and show it as a Today row.
- The approve route trusts the `origin` field in the request body (`app.py:5151-5157` never calls `require_trusted_mcp`); safety comes from the MCP client always sending `"mcp"`. Bind approval to who is calling.
- The tool review shows only the tool name ("Allow JobOS tool browser_click?"), not the target or text. That is not an informed approval.
- `forbidden_uses` is stored and shown to the model, and nothing checks a draft against it.
- An agent reading LinkedIn or Naukri inside a signed-in browser can break those sites' terms. For clients, work from listings they send or public pages, and label the risk.
- macOS and Keychain only; the founder's Windows machine can't run it.

Already in Chausar?: decide once, stale digests, read before Approve, an always-ask floor, tighten-only posture, share links and Playwright owner-browser-session posting are built (`docs/venture/ink.md`; `platform/runtime/venture/build/browser.ts`, `posting.ts`). Not built: claim boundaries with loosen-asks, approval bound to delivered file bytes, Undo for a direct agent edit (build audit, frontend: "undo for drafts"), URL secret stripping, an embedded browser view, capture completeness by page hash.

---

## zai-org/ZCode (Apache-2.0, 8,139 stars, last commit 2026-10-20)

What it is: Z.ai's coding-agent workspace: an agent CLI and runtime (`apps/zcode-cli`), a terminal UI, a web client and an Electron desktop sharing one React UI (`packages/ui`), plus a plugin store.

Source: partial. The agent, the permission engine, the UI, the plugins and the workflow compiler are all there. Computer Use ships as a placeholder that reports "unavailable" and fails closed (`packages/zcode-cua/README.md`; `NOTICE.md` says so too). The hosted product service (sign-in tokens, the CDN plugin catalogue) is not in the repo. Nothing here needs reverse engineering for Chausar's purposes; the real Computer Use helper would need the desktop release binary, and it isn't worth it.

How it works:
- **One permission function.** Every tool call gets `allow`, `ask` or `deny`, each with a `ruleId` and a reason (`apps/zcode-cli/packages/core/src/permission/service.ts:62-80, 97-262`). In order: plan-mode transitions; tools that need the user always ask; in "guarded" mode a dangerous command asks once ("user-once"); a tool that declares `alwaysAsk` goes to `checkAlwaysAsk`, which still applies every hard deny (disabled tools, project deny rules, the unbuilt mode) before it asks (`service.ts:318-420`); "yolo" and "guarded" allow the rest; the reserved "auto" mode denies everything with "Auto mode is reserved but not implemented yet"; then project deny, ask and allow rules with wildcard and `prefix:*` matching (`permission/rule-matching.ts`).
- **"Allow for session"** rules live only in the service instance's memory, apply only to `alwaysAsk` gates, and vanish on restart or a new chat (`service.ts:84-98`).
- **No spoofed grants.** The reserved rule key for official Computer Use matches only when the host has verified the tool's capability group, so a third-party MCP tool with the same name can't inherit the grant (`service.ts:287-297`).
- **No approver, no action.** With no permission client attached, `DenyPermissionBroker` denies (or errors in guarded mode). `ManualPermissionBroker` allows one pending request per id and rejects on timeout or abort (`permission/broker.ts`).
- **Workflows are checked before they run.** The agent writes a TypeScript script against a typed facade; a compiler type-checks it and derives graphs of its agents, questions and fan-out before anything runs (`apps/zcode-cli/packages/dynamic-workflow/README.md`). The approval card shows the script, the most subagents at once, their model, and whether it amends a running run ("still running, will be stopped").
- **The ask shows the real thing.** The permission dialog renders the actual tool call (diff, command, URL, script) with the same component the chat uses, offers Allow, an "Always allow" that names the exact scope it will add (first line, 160 characters), Deny, and a "Tell the model what to do instead..." box (up to 4,096 characters) that turns a deny into feedback (`packages/ui/src/PermissionDialog.tsx:85-140, 560-670`; `packages/shared/src/zcode-protocol-v4/snapshot.ts:232`). Internal reasons like "High risk tools require explicit approval" are hidden from the user.
- **A plain risk notice.** `NOTICE.md` is a table, one row per capability (files and terminal, hooks, plugins, the browser, computer use, schedules), saying what it can affect and where its boundary is, with links into the code. It says outright that stopping a session doesn't undo writes, publishes or uploads already done.
- **Android emulator plugin** (`apps/zcode-cli/packages/android-emulator-plugin/src/mcp/server.ts`): 23 MCP tools over the Android SDK for app developers: build, install, launch, screenshot, logs, describe the UI tree, tap, swipe, type, key events.

Take for Chausar:
- Business (playbook): none new. The TSV's "freelance app builder" is the B2C launcher's own handoff to Lovable or Replit.
- Engine or harness mechanism:
  - *Always-ask beats every allow and never beats a deny.* A gate on the always-ask floor can't be opened by posture, session grants or "auto"; a hard deny can't be turned into a click-through ask (`service.ts:318-345`).
  - *Session grants only below the floor.* "Allow for this session" may cover held steps that aren't on the floor (say, drafting a reply), lives in memory only, and never covers money out, client sends or portals.
  - *An unbuilt posture denies.* Already Chausar's rule for "auto with spot checks"; keep the same wording in the decision record.
  - *Grants bound to verified identity.* A connector's write grant matches only the host-verified connector, never a tool that reuses its name.
  - *Every decision records a rule id and a reason,* so the journal can say which rule let something through.
- Connector: the Android emulator tool set is a model for a `planned` "test an app on a phone" connector (see phone-harness below); emulator only, no real device, no personal accounts.
- UI:
  - **Send back with your own words**: a deny that carries a short instruction to the agent ("Tell the model what to do instead...").
  - **Scope line on any standing grant**: "Always allow" states exactly what it adds before you press it.
  - **The approval body is the artifact itself**, drawn by the component the run sheet uses, so the owner sees the same draft in both places.
  - **One look for every waiting state** (`DESIGN.md:152-160`: "Waiting badges use one green confirmation treatment so identical waiting copy does not appear as different states").
  - **Example prompts prefill and never send** (`CONTEXT.md`, "Example Prompt"): a fit for playbook cards in onboarding.
  - **"What Chausar can do on this computer"**: a NOTICE-style page, one row per connector and execution place, beside the honest labels.

Traps:
- The CLI's non-interactive mode defaults to "yolo" when no mode is given (`NOTICE.md`); never let a background run default to the loosest posture.
- Persistent "Always allow in this project" rules pile up and quietly widen access; Chausar's tighten-only posture shouldn't gain them.
- The docs describe Computer Use in detail (`zcode-cua-plugin/docs/computer-use.md`) while the open build ships a stub; quote capability from code, not docs.
- 328 MB repo, docs mostly in Chinese, a closed product service behind sign-in.

Already in Chausar?: allow, deny and ask with fail closed, tighten-only posture, the always-ask floor and a refused auto stage are built (`docs/superpowers/designs/2026-10-21-chausar-frontend-ink.md` 7.3; `docs/venture/ink.md`). Not built: send back with your own words (listed missing in the build audit's frontend section), a scope line on standing grants, a risk notice page, session-only grants.

---

## truefoundry/trueforge (MIT, 6,345 stars, last commit 2026-10-23)

What it is: a server that runs the agent loop for you (model calls, remote MCP tools, skills, a Daytona sandbox, approvals, questions, compaction, schedules) behind a chat UI, an HTTP API with TypeScript and Python SDKs, and an embeddable React UI kit. Local mode is one process on SQLite; hosted mode is Postgres plus Redis.

Source: full (server, core, SDKs, UI kit, Helm chart, benchmark harness). The sandbox is a third-party service (Daytona).

How it works:
- **Which tools pause.** Each MCP server on an agent has `require_approval_for_tools`, default `["@write", "@destructive"]`, matched against the server's own `readOnlyHint` and `destructiveHint` labels (`packages/trueforge-core/src/core/mcp/toolSelectors.ts:22-97`). An unlabelled tool matches neither tag, so it runs without asking unless it is named or covered by `@all`; the docs admit this (`docs/create-agent/overview.mdx:50, 367`).
- **The pause.** A gated call returns "approval required" instead of running; the turn emits `tool.approval_required` with the call ids, and the client resumes with `user.tool_approval {thread_id, tool_call_id, approval: allow | deny + reason}` (`core/mcp/executeToolCalls.ts:133-190`; `core/events/schema.ts:75-130, 405-416`). A sticky `allow_session` policy with an optional `expire_at` auto-allows one named tool on one server (`schema.ts:100-125`).
- **Ask the user.** `ask_user_question` takes a question and 0 to 5 mutually exclusive options; a free-text box always shows beside them; no "Other" option; a recommended option goes first with the exact suffix " (Recommended)" (`core/capabilities/builtins/AskUserQuestion.ts`).
- **Big tool results leave the context.** A single result over 6,000 tokens, or a parallel batch over 10,000 tokens (largest first), is written to a sandbox file and replaced by its first and last 100 characters plus the path (`core/capabilities/builtins/LargeToolResponse.ts:13-45`; `docs/key-features/large-tool-responses.mdx`). Tool definitions load on demand unless a server is set to preload (`docs/key-features/deferred-tool-loading.mdx`). Compaction starts at 50,000 tokens (`ContextCompaction.ts:13`).
- **Sandbox as a tool.** The loop and every model and MCP credential stay in the server; the sandbox only runs code, files and shell (`docs/sandbox.mdx:17-24`).
- **Schedules.** A saved agent runs on cron, unattended, one session per run, idempotent on retry (`packages/trueforge/src/controller/scheduleDispatch.ts:72-130`). A run's status is only `scheduled`, `triggered` or `failed` (`schemas/schedule.ts:138`); nothing tells anyone that a scheduled run is sitting on an approval.
- **UI kit.** `ToolApprovalBar` makes Deny require a reason by default (`packages/trueforge-ui/src/atoms/ToolApprovalBar.tsx:44-50`). `ApprovalNavBanner` pins "3 tools need your input (1/3)" above the composer with next and previous, and opens any sub-agent that holds a pending approval so its card is on screen (`atoms/ApprovalNavBanner.tsx`; `utils/findApprovalAncestors.ts`).

Take for Chausar:
- Business (playbook): the TSV's "AI automation agency" builds agents for other companies; that's not a retail owner's business. Low value; skip.
- Engine or harness mechanism:
  - *Offload big results* with two thresholds (6,000 tokens per call, 10,000 per batch, largest first, a preview of the first and last 100 characters plus a file reference). It keeps cheap bring-your-own models usable on long statements, transcripts and exports, and it cuts spend.
  - *Load tool definitions on demand,* per connector, with a preload switch.
  - *Credentials never enter the execution place.* The same line belongs in Chausar's execution-place labels.
  - *Questions with 0 to 5 distinct options plus free text,* the recommended option first and marked. A clear shape for "an agent's question" rows on Today.
- Connector: none new (remote MCP with header or OAuth sign-in in chat; Chausar already labels connectors).
- UI: "N things need you (1/N)" pinned above a long run, with jumps to each; a deny that asks for a reason (optional for the owner in Chausar); opening a nested sub-step to reveal its pending approval.

Traps:
- **Fail-open default.** Approval follows labels the remote server writes about itself, so an unlabelled tool that changes data runs without asking. Chausar's floor must come from Chausar's own connector catalogue, never from a server's hints.
- `allow_session` keys on the tool name only, not the arguments.
- Scheduled runs that hit an approval just wait in a session nobody is told about.
- The README's "same accuracy, lower cost" against Claude Managed Agents comes from their own benchmark scored by an LLM judge (`benchmark/judge.py`); don't repeat it as fact.
- Local mode has no login and is for localhost only (their own warning).

Already in Chausar?: approvals with digests, the always-ask floor and agent questions as Today rows exist (`docs/venture/ink.md`). Not built: result offloading, on-demand tool loading, the pending-count banner, a reason on deny ("send back with your own words" is open in the build audit).

---

## vercel/eve (Apache-2.0, 5,656 stars, last commit 2026-10-22)

What it is: a TypeScript framework for durable agents where each capability is a file in a known folder (`agent/instructions.md`, `tools/`, `skills/`, `channels/`, `schedules/`), with built-in channels (Slack, Teams, Discord, Telegram, Twilio, GitHub, Linear, web chat), sandboxes, evals and an optional computer-use extension.

Source: full. The default decision model for `auto()` approvals and judges, `typesafe-ai/jev`, is a hosted model reached through Vercel's AI Gateway, not code in the repo.

How it works:
- **An approval has two halves** (`packages/eve/src/approval/definition.ts`): a request policy that returns `not-applicable | approved | denied | user-approval`, and an optional response policy that decides whether this signed-in responder may approve or cancel. A refused responder leaves the request pending for someone else. The request records who asked, captured when it was raised.
- **Ready-made request policies** (`src/tools/approval/policies.ts`): `always()`, `never()`, `once()` (asks until the first explicit approval in this session; a denial records nothing) and `auto()`. `auto()` sends only the exact tool name and input, never the conversation, to a decision model that must answer `clear` or `caution`; `caution`, a provider error, a bad answer, a 30-second timeout, or input over 64 KB all mean "ask the person". The research note says plainly that `auto()` "is not authorization" (`research/automatic-tool-approval.md`).
- **Re-check before running.** Just before an approved call executes, the request policy runs again, and a `denied` result then cancels it (`src/harness/approval-recheck.ts`).
- **Honest model context.** While approvals are pending, the model is told "The following tool calls are awaiting approval and have not executed", in a block marked as trusted runtime state rather than user content (`src/harness/hitl/approval-prompt.ts`).
- **One waiting state.** Sign-ins, approvals and questions hold the same turn (`turn.waiting` with `on: "input"`); a message from the same person steers the turn and cancels the held request, messages from others queue, and a cancel withdraws every held request so each held call gets a "not run" result. There is no timeout (`research/held-sign-in-and-approval.md`, status proposed).
- **Spend windows.** One function decides when a session has used enough; reaching it asks the person to approve a continuation, which opens a new window. The note admits that parallel sub-agents can overshoot by up to N windows before the parent checks (`research/session-usage-limit-function.md`).
- **Private conversations aren't traced.** Each channel classifies its audience as `public`, `private` or `unknown`; anything malformed or ambiguous becomes `unknown`, and private conversations produce no content traces unless the author admits them (`research/channel-audience-content-policy.md`).
- **Computer use in a throwaway desktop.** `eve/computer-use` drives an X11 desktop inside the agent's sandbox, not the user's machine: Firefox and up to two terminals, screenshots with accessibility elements, sequences of up to 30 actions, a two-minute deadline, and MP4 recording that stops after five minutes (`packages/eve-computer-use/extension/tools/computer_use.ts:254-266`; its README). It uses `approval: never()` because the desktop is isolated. Its "natural" and "precision" pointer styles exist to make recordings look smooth.
- **Slack wording** (`src/public/channels/slack/approval-cards.ts`): "Waiting on approval from @name…", "Approved by …", and a withdrawn request reads "This approval is no longer needed."

Take for Chausar:
- Business (playbook): **software demo and tutorial videos.** Offer: a one to three minute walkthrough of a client's web app, or a series of how-to clips for their help centre or YouTube. Steps: intake (the app URL, a test account the client made for this, the script, the brand), the agent drafts a shot list, the owner approves it, the agent rehearses and then records in a throwaway sandbox desktop, the owner reviews the MP4 and edits captions and voice, the client approves through a share link. The owner approves the script, each final cut and anything posted. It earns per video or per monthly batch, priced by the owner, and it feeds the YouTube channel playbook (tutorial channels). Never record the owner's own desktop or a client's live customer data.
- Engine or harness mechanism:
  - *Request policy plus responder policy.* For client share links: the request says "client approval needed"; the responder policy accepts only the link holder for that draft and keeps the request open if anyone else answers.
  - *Re-check just before apply.* Run the gate again right before a send (budget left, client still active, draft digest unchanged); a "denied" at that point cancels and says why.
  - *A classifier may lower friction, never authorise.* For the future "auto with spot checks" rung: a decision model sees only the exact action, falls back to the owner on any doubt, and never touches the always-ask floor.
  - *"Awaiting approval and not executed"* injected into the agent's context, so it never tells the owner something was sent while it waits.
  - *Continue past a cap by approval.* When a run uses its spend window, Today gets "This run used its limit. Let it continue for one more window?" This also answers the build audit's gap that the cap is checked only after a turn.
  - *No content traces for client data* unless the owner turns them on, with "unknown" treated as private.
- Connector: `planned` Telegram and Twilio (SMS, WhatsApp) channels where the agent drafts and the owner's approval releases each send; a `planned` sandbox desktop for recordings, labelled "runs in a throwaway computer, not yours".
- UI: "Waiting on approval from <name>"; withdrawn requests stay visible as "No longer needed" instead of vanishing; a reply from the owner while something is held counts as "change it", cancels the hold and says so.

Traps:
- `auto()` sends tool input to a hosted decision model by default; client data must not go there without consent. It is also a model judging safety, so never use it for the floor.
- The held-turn design has no timeout on purpose; Chausar keeps its expiry (15 minutes for agent proposals).
- Smooth "natural" pointer motion is for recordings. Using humanlike motion to slip past a live site's bot checks is evasion.
- Many research notes are `proposed`, not built; check the status line before citing one.

Already in Chausar?: decide once, approval expiry, shadow simulation and the always-ask floor exist (`docs/superpowers/designs/2026-10-21-chausar-frontend-ink.md` 7.2-7.3). Not built: a responder policy on share-link answers (the share page records the client's answer under the owner's member, `docs/venture/ink.md` known limits), a re-check just before apply, approve-to-continue spend windows, audience-aware tracing, a recording desktop.

---

## xlang-ai/Qwen-CUA (Apache-2.0, 229 stars, last commit 2026-08-26)

What it is: the release repo for a screenshot-only computer-use model (the technical report in `paper/`, weights on Hugging Face) plus `demo/`, a small reference agent: a FastAPI runner that drives a fresh Playwright Chromium from the model's mouse and keyboard actions, a code-level safety gate, and a Next.js operator console.

Source: partial by design. The demo runner, safety gate, console, two test labs and their checks are all here. The model is not code: it is 397B-parameter weights on Hugging Face, reached through any OpenAI-compatible endpoint you host or rent. The larger "Qwen-CUA-Max" behind the headline benchmark figure is described, not released here. Nothing needs reverse engineering.

How it works:
- **Pixels in, actions out.** The model sees screenshots only (no DOM, no accessibility tree) and answers with one XML `computer_use` call; a bad call gets one repair instruction ("Return exactly one complete <tool_call> block…") (`demo/src/qwen_cua/protocol.py:181-196`). Up to 20 recent screenshots stay in context and older ones fold away (`config.py:92-93`; README).
- **Look under the pointer before acting.** Before every click or type, the runner asks the page which element sits at that point (`document.elementFromPoint`, or the focused element for typing), walks up to the nearest link, button or input, tags it with a one-off ref, and reads its kind, text, link target and form action (`demo/src/qwen_cua/computer.py:199-247`).
- **Five kinds of action stop for the operator** (`demo/src/qwen_cua/safety.py:50-104`): typing into a password field (the value is redacted in the card), clicking a file input (the person picks the file; the model never names a local path; size-capped), clicking a download link, clicking a submit button, and clicking a link or form that leaves the current site. Each card has a title and one sentence: "Form submission requires approval. The model is about to submit "Register"." Rejecting any of them ends the run ("Operator rejected a sensitive action.", `runner.py:476-500`).
- **Where it may go.** A custom URL must be http(s), with no user or password in it, and by default must not resolve to a private, loopback, link-local, reserved or multicast address (`safety.py:24-47`; `config.py:86`). Using a custom URL at all needs a ticked risk acknowledgement, enforced on the server (`models.py:70-77`).
- **A fresh browser every run.** New context, no saved sign-ins, downloads into the run's folder, one run at a time by default (`computer.py:78-90`; `config.py:85`).
- **"Done" is not success.** When the model says it finished, the outcome is `success` only if a code check of the lab's real state passes; a custom site with no check ends as `unverified`; a model that gives up is `failure` with verification `not_run` (`runner.py:585-640`; `models.py:19-40`; checks in `scenarios.py`).
- **Operator console** (`demo/apps/web/app/ui/OperatorConsole.tsx`): "What should Qwen do?" with "Describe the outcome you want…", a live browser pane ("Browser ready. Start a mission and Qwen's view will appear here."), an activity trace, an "Operator intervention" panel, and a "Screenshot timeline" filmstrip for review ("No captured frames yet.").

Take for Chausar:
- Business (playbook): **a data entry desk.** Offer: enter records from a client's spreadsheet or documents into a web system the client already uses (a CRM, a shop dashboard, a booking tool, a school or clinic portal the client owns), priced per batch by the owner. Steps: intake (the target system, a staff login the client creates for this work and can revoke, the source sheet, field mapping), rehearsal on 3 records in shadow, the owner approves the mapping, the agent fills each form and stops at every submit, the owner approves submits in batches with a screenshot of each filled form, the agent reads each saved record back and compares it with the source, unmatched records go to Today. Approvals: the field mapping, every submit (or a batch), any upload. It earns per record or per batch. Not for government portals (Chausar keeps those `planned: handoff`), and not for marketplace seller dashboards whose rules ban automation without a check of the dated platform rules register.
- Engine or harness mechanism:
  - *A code gate on the element, not a prompt.* Before any click or keystroke in an owner-browser-session or recording browser, classify the element: password, file input, download, submit, leaving the site. Each kind holds for the owner. This is the missing piece in JobOS's "never auto-submits". Add two cases the demo misses: Enter inside a form, and `role="button"` controls inside a form.
  - *The person picks every file.* An upload control asks the owner to choose the file; the model never supplies a path.
  - *SSRF guard* on any URL an agent may open, with the private-address check after DNS resolution (`safety.py:24-47`). The build audit lists "SSRF guard" as not built for creator work.
  - *Outcome words:* `success` only with a code check of the real result, `unverified` without one, `failure` when the agent gives up. Chausar's runs should say "Not checked" the same way its judge already does.
  - *One repair turn* for a malformed tool call, then stop.
- Connector: a `planned` "fill forms on a website" connector, desktop only, a fresh browser per run unless the owner chooses a saved sign-in, every submit held. The model itself is a heavy hosted dependency; label the cost line "needs a vision model that can act on screenshots".
- UI: the filmstrip of screenshots under a run, one frame per action, as the review view for any browser work; intervention cards with a title and one sentence naming the thing ("The model is about to submit "Register"."); a run-level outcome that reads Success, Not checked or Failed; a risk tick-box before pointing an agent at a new site.

Traps:
- The headline benchmark figures (87.6 on OSWorld-Verified) belong to the larger "Max" model; don't quote them for what Chausar would run.
- The submit check catches `<button>` and `<input type=submit>` only; Enter in a field and script-driven `div` buttons slip past it.
- Built-in lab scenarios skip the safety gate entirely (`trusted_scenario`, `runner.py:379`); fine for fixtures, never for a real site.
- The runner has no login and must stay on localhost (README caution).
- Screenshot-only control on sites with bot checks invites CAPTCHA solving; Chausar stops and hands those to the owner.

Already in Chausar?: the 21 October card on QwenLM/open-computer-use (`cards/quality-data-ops.md`) covers accessibility-tree control, per-turn state reads and a fixture app; this card adds the element gate, owner-picked files, URL guard and outcome words, none of which are built. Chausar's posting path already holds every post for approval and records `outcome_unknown` (`platform/runtime/venture/build/posting.ts`).

---

## ShawnPana/phone-harness (MIT, 3,904 stars, last commit 2026-10-17)

What it is: a Python CLI that lets a coding agent drive a real phone by piping it a short script with helpers pre-imported (`tap_text`, `screen`, `type_text`, `scroll_collect`…): an iPhone through the Mac's iPhone Mirroring window, an Android over adb from any OS, or a rented "Phone Harness Cloud" phone.

Source: partial. The CLI, the iPhone and Android backends, the Hermes plugin and tests are here. Phone Harness Cloud (rented phones, the cloud iPhone service) is a paid hosted service reached over HTTPS; only its client is in the repo (`src/phone_harness/cloud.py`). That service would need reverse engineering of the web app at phone-harness.com, and it isn't worth it for Chausar.

How it works:
- **Eyes and hands per phone.** iPhone: capture the Mirroring window, OCR it with Apple Vision for text with tap points, post HID events (`src/phone_harness/mirror.py`; `ocr.py`). A "background" backend taps without bringing the window forward by posting synthesised event records straight to the process through a private macOS call (`background.py:1-30`). Android: `screencap`, the accessibility tree and `input` over adb (`android.py`). Same helpers either way (`helpers.py`, 60-odd functions, including `shell()` for raw adb).
- **Code refuses a locked phone.** Taps and `screen()` answer "locked" and stop on a locked or asleep Android (`android.py:316-340`); unlocking is the user's job. `interruption(before, after)` reports whether another window covered what the user was looking at (`helpers.py:162-176`).
- **Consent lives in the skill text.** `SKILL.md:171-175`: "This is the user's real phone and real accounts. Stop and ask before anything outward-facing or hard to reverse: sending, posting, following, purchasing, deleting, changing settings. Never type a PIN, a password or a 2FA code." On a cloud phone the agent hands control to the person (`cloud open`) for passwords and 2FA (`SKILL.md:258-262`). None of this is enforced in code.
- **Hermes plugin gate** (`integrations/hermes/__init__.py`): every `phone_exec` call asks first, showing the script squeezed to 140 characters; the approval key is `phone_exec`, so a "session" or "always" answer covers every later phone script. An opt-in classifier parses the script and auto-runs it when it only imports the phone helpers and calls no `open`, `exec`, `eval`, `shell` or raw transport (`approval_reason`, lines 225-271); it guards this computer, not what happens on the phone, and says itself that it "can be bypassed". The child process gets an environment without `*_API_KEY`, `*_TOKEN` and `*_SECRET`, and one script drives the phone at a time.
- **Telemetry on by default.** `config.py:78` sets `"telemetry": True` with the comment "anonymous usage events", yet each run sends PostHog the full script (up to 20,000 characters), the last 20,000 characters of output (which is whatever the agent read off the screen), the helper trace and the detected agent and model (`telemetry.py:109-150`; `run.py:190-230`). Turning it off is one config line (`install.md:123`).
- **Cloud phones** are sold in the README as "Hosted iPhones and Androids with stealth, real numbers, 2FA, and unlimited devices".

Take for Chausar:
- Business (playbook): **mobile app testing for small app makers.** Offer: a test pass on a client's Android app before each release (install, sign up with a test account, walk the main flows, note crashes and broken screens), with a report of steps, screenshots and logs; or a monthly regression pass. Steps: intake (the APK or store link, test accounts the client provides, the flows to cover), the agent drafts test cases, the owner approves them, the agent runs them on an emulator or a test phone with no personal accounts, a code check flags crashes from `adb logcat`, the owner reviews every finding, the client gets the report through a share link. The owner approves the test plan and the report. It earns per release pass or monthly, priced by the owner. Never on the owner's personal phone, never with real payment methods.
- Engine or harness mechanism:
  - *Refuse when the device isn't ready* (locked, asleep, someone else's session): stop with the reason, never retry in a loop.
  - *The person types secrets.* PINs, passwords and 2FA codes are handed to the owner on screen; the agent never types them (matches Chausar's rule).
  - *One script per device at a time,* and an environment stripped of keys and tokens for any child process an agent starts.
  - *Script check before auto-run:* parse what an agent-written script imports and calls before running it without asking. Only safe for "does it reach this computer", never for "is it outward-facing".
- Connector: `planned` "test an Android app on an emulator" (adb against an emulator image or a dedicated test phone). Label: `write` to the test device only, no personal accounts, Android only on Windows (iPhone Mirroring needs a Mac).
- UI: the narration rule from `SKILL.md` ("one line before what you are about to do, one line after what you saw") fits Chausar's run sheet tool lines; "hand the controls over" as an explicit state ("Your turn: type the code on the phone, then press Done").

Traps:
- **Telemetry that ships screen text.** Default-on telemetry labelled "anonymous" sends the task script and up to 20,000 characters of what was read off the phone (messages, OTPs, balances) to a third party. Chausar must never pass client or owner screen content to telemetry, and any connector built on this must turn it off.
- **Consent by prompt only.** Sending, buying and deleting on a real phone are guarded only by skill text; the Hermes "allow for session" answer then covers every later script, purchases included.
- **Evasion.** "Stealth" cloud phones with "real numbers" for 2FA are tools for slipping past platform checks and making accounts; not for Chausar.
- **Private macOS calls** in the background backend can break with any OS update.
- The founder's Hermes fleet could install the plugin in one line; if it ever does, telemetry off and per-call approval only.

Already in Chausar?: nothing for phones. The "agents never type passwords" rule and approval per post exist; the telemetry question is new.

---

## MaxInGaussian/pi-plans (MIT, 239 stars, last commit 2026-10-11)

What it is: an extension for the Pi coding agent that forces plan, review, execute: the agent asks batched questions, writes a versioned Markdown plan with tasks and verification checks, read-only reviewer agents critique it, the person approves the handoff explicitly, and only then can files change; execution reports each task with evidence and a read-only reviewer verifies every check.

Source: full (`index.ts`, `src/`, `tools/`, skills, 86 test files, benchmark data).

How it works:
- **Nothing writable before approval.** While a run is `planning` or `accepted`, a `tool_call` hook blocks `edit` and `write` outside the planning folders, and other runs' plans are read-only to this session (`index.ts:233-262`; `src/guard.ts:27-70`). The README admits shell commands are not blocked ("bash stays discipline-bound", `README.md:425`).
- **Questions as one form.** `ask_choice` takes 2 to 8 questions as one tabbed form with a submit page; every option's description must read "✓ <advantage> / ✗ <drawback>"; exactly one may be recommended, shown first with ★; "Other" and "Auto-complete" are appended by the tool; Esc returns the partial answers and the agent carries on (`tools/ask-choice.ts:149-210, 584`; `src/ask-form.ts`). Scope confirmation and the execution handoff must be single questions with auto-complete off; a batch that contains one is rejected (`ask-choice.ts:584`).
- **Plans keep their ids.** Each plan version is a file (`PLAN_vN.md`) with `## Tasks` and `## Verification Checks`; ids like `Task-3` and `VC-012` are never reused across versions, so refinement rounds don't scramble the task tree (README, "How it works").
- **Progress needs evidence.** `plans_update_task` accepts only `complete` (with evidence: test output, file paths) or `skipped` (with a required reason); closed tasks can't be reopened by the worker, only by the reviewer's rollback (`src/task-tool.ts`).
- **A review budget the person picks.** Before the first review round the person chooses 1, 2, 3, 5 or unlimited rounds (default 3 without a UI); unlimited still stops after 3 rounds with an identical outcome or 50 rounds in all; when the budget runs out the run pauses, unless every check already passes, and only the person resumes it (`src/review-budget.ts`).
- **Auto-answer has a fence.** "Auto-complete" may answer planning questions only. The benchmark switch `PI_PLANS_AUTO_APPROVE=1` refuses, visibly, any question that mentions publish, deploy, merge, push, credentials, secrets, API keys, passwords, payment or billing (in English and Chinese), and prefixes every automatic answer with `[auto-approve]` for audit (`src/auto-approve.ts`).
- **Compaction without a model.** During a run, context compaction is a fixed five-section summary (`[Session Goal]`, `[Files And Changes]`, `[Commits]`, `[Outstanding Context]`, `[User Preferences]`) built from session events only, never by asking a model (`src/compaction.ts`; README "VCC compact").
- **Honest benchmark.** The README's 18/36 versus 3/36 result is labelled single-seed and exploratory, and it says the gap "dissolved" on two more seeds.

Take for Chausar:
- Business (playbook): none on its own. Its value is inside every playbook: a per-order plan the owner (and the client, as scope) signs before work starts.
- Engine or harness mechanism:
  - *Per-order plan as the contract.* Before a delivery run spends anything, the agent writes a plan with tasks and checks (stable ids), the owner approves it on Today, and later drafts are judged against those checks. Chausar has a business plan at onboarding and playbook steps, not a plan per order.
  - *Approvals never ride inside a questionnaire.* Scope sign-off and anything on the always-ask floor stay single, separate rows.
  - *Done needs evidence or a reason.* A step closes as done with evidence or skipped with a reason; the auditor alone reopens it.
  - *The owner picks the review budget,* with a no-progress stop (3 identical outcomes) so a stuck run pauses instead of burning money.
  - *Automatic answers are fenced by action kind* (Chausar's floor) and every one is marked as automatic in the journal.
  - *Model-free compaction* with fixed sections keeps long runs cheap and stops a summary from inventing facts.
- Connector: none.
- UI: one card of 2 to 8 related questions with tabs and a review page; each option shows what it gains and what it costs ("✓ … / ✗ …"); the recommended one first with a star; Esc keeps the answers given so far.

Traps:
- The write guard covers two tools; the shell can still write. Chausar's equivalent must hold at the execution layer, not per tool name.
- The external-state fence is a keyword list over question text; a false negative passes. Chausar should key on the action kind, which it already does for the floor.
- The benchmark table would read as a product claim if quoted without its own disclaimer.

Already in Chausar?: the manager, executor and read-only auditor roles with a round ledger exist (`docs/superpowers/designs/2026-10-21-chausar-frontend-ink.md` 7.7), and the onboarding plan is Today's first row (`docs/venture/ink.md`). Not built: a per-order plan with stable task and check ids, batched question cards with ✓/✗ options, an owner-picked review budget with a no-progress stop, model-free compaction.

---

## Ideas worth taking, ranked by value

| Idea | From | Kind | Value for B2C owners | Effort |
|---|---|---|---|---|
| Hold every click or key on a submit control, password field, file input, download or link to another site for the owner, decided by code from the element under the pointer (add Enter-in-a-form and `role="button"` cases) | Qwen-CUA (`safety.py`); JobOS shows the gap | engine | high | M |
| Send back with your own words: a deny carries a short instruction the agent must act on | ZCode (`PermissionDialog.tsx`), trueforge (`ToolApprovalBar.tsx`) | UI | high | S |
| Re-run the gate just before apply (budget left, client active, digest unchanged); "denied" then cancels with a reason | eve (`approval-recheck.ts`) | engine | high | S |
| Tell the agent "awaiting approval, not executed" so it never claims a send that hasn't happened | eve (`approval-prompt.ts`) | engine | high | S |
| Approval bound to the bytes of every delivered file (digest manifest), cleared when a re-render changes them | JobOS (`state_store.py:3714-3800`) | engine | high | S |
| Outcome words: Success only with a code check of the real result, otherwise Not checked or Failed | Qwen-CUA (`runner.py:585-640`) | engine | high | S |
| Telemetry and traces never carry screen text or client data; unknown audience counts as private | phone-harness (trap), eve (audience policy) | engine | high | S |
| The always-ask floor comes from Chausar's connector catalogue, never from a tool's own read-only or destructive labels | trueforge (trap, `toolSelectors.ts`) | engine | high | S |
| Claim boundaries on business facts (qualifiers, forbidden uses): tightening is direct, loosening asks, and a code check stops a draft using a fact for a forbidden use | JobOS (`career_profile_collaboration.py:1371-1394`) | engine | high | M |
| Approve to continue: a run that uses its spend window asks on Today for one more window instead of failing or overshooting | eve (`session-usage-limit-function.md`) | engine, UI | high | M |
| Responder policy on share links: only the client's link for that draft may answer; anyone else leaves it pending | eve (`approval/definition.ts`) | engine | high | M |
| Job application desk playbook (career profile with claim boundaries, tailoring packs, client applies) | JobOS | playbook | high | M |
| Per-order plan with stable task and check ids, signed by the owner before any spend; approvals never inside a questionnaire | pi-plans | engine | high | M |
| Question cards: 2 to 8 related questions, each option "✓ gains / ✗ costs", recommended first, free text always available | pi-plans (`ask-choice.ts`), trueforge (`AskUserQuestion.ts`) | UI | high | M |
| Data entry desk playbook (client's own system, staff login they can revoke, every submit held, read-back check) | Qwen-CUA | playbook | med | L |
| Owner picks every file an agent uploads; the model never names a local path | Qwen-CUA | engine | med | S |
| SSRF guard on any URL an agent opens, checked after DNS resolution | Qwen-CUA (`safety.py:24-47`) | engine | med | S |
| Strip secrets from URLs before they reach the vault, journal or evidence ledger | JobOS (`browserPersistence.ts:133`) | engine | med | S |
| Offload big tool results to a file (6,000 tokens per call, 10,000 per batch, largest first, short preview) and load tool definitions on demand | trueforge | engine | med | M |
| Screenshot filmstrip under every browser run, one frame per action | Qwen-CUA (`OperatorConsole.tsx`) | UI | med | M |
| "N things need you (1/N)" pinned above a long run with jumps to each | trueforge (`ApprovalNavBanner.tsx`) | UI | med | S |
| Undo on an agent's direct edit, and a two-option trust setting that states its consequences in plain words | JobOS (`CollaborationArea.tsx`, `CareerProfileAgentSettings.tsx`) | UI | med | M |
| Stale change: "Review replacement" then "Confirm replacement" with "This does not merge the entries", and "Keep current, reject change" | JobOS | UI | med | S |
| Always-ask beats every allow and never beats a deny; each decision records a rule id and reason | ZCode (`service.ts`) | engine | med | S |
| Session-only grants for held steps below the floor, in memory, gone on restart | ZCode, eve (`once()`) | engine | med | S |
| Owner-picked review budget with a stop after 3 identical outcomes | pi-plans (`review-budget.ts`) | engine | med | M |
| Done needs evidence, skipped needs a reason; only the auditor reopens | pi-plans (`task-tool.ts`) | engine | med | S |
| Automatic answers fenced by action kind and marked as automatic in the journal | pi-plans (`auto-approve.ts`) | engine | med | S |
| A decision-model classifier may lower friction on the future auto rung, sees only the exact action, falls back to the owner on any doubt | eve (`policies.ts`) | engine | med | M |
| Withdrawn approvals stay visible as "No longer needed"; "Waiting on approval from <name>" | eve (Slack cards) | UI | med | S |
| "What Chausar can do on this computer" page, one row per connector and execution place | ZCode (`NOTICE.md`) | UI | med | S |
| Software demo and tutorial video playbook, recorded in a throwaway sandbox desktop | eve (`eve-computer-use`) | playbook | med | L |
| Embedded owner browser inside the desktop window, agent acting only on snapshot targets with fingerprints | JobOS (`browser.ts`) | connector | med | L |
| Capture counts as complete only when every text page shares one page hash | JobOS (`saveJobPrompt.ts`) | engine | med | M |
| Telegram and Twilio (SMS, WhatsApp) channels where each send waits for the owner | eve | connector | med | L |
| Mobile app testing playbook on an emulator or test phone | phone-harness, ZCode android plugin | playbook | med | L |
| Model-free compaction with fixed sections | pi-plans (`compaction.ts`) | engine | low | M |
| Refuse when the device or session isn't ready, with the reason, no retry loop; the person types every secret | phone-harness | engine | low | S |
| Layout presets by task (browser large, document large, chat large) | JobOS | UI | low | M |
| Example prompts prefill a new chat and never send | ZCode (`CONTEXT.md`) | UI | low | S |
| One look for every waiting state | ZCode (`DESIGN.md:152-160`) | UI | low | S |
