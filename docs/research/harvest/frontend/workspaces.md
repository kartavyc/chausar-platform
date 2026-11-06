# Agent workspaces: what Chausar's new frontend can learn

Written 21 October 2026. Five open-source products where people and agents work side by side, studied from source and from the screenshots in each repo. Nothing was installed or run. Clones live in the session scratchpad under `clones/<owner>__<repo>`; paths below are relative to each repo root.

Chausar's bar, for judging: minimal and quiet, no boxes or colour blocks, motion only when it means something, follows the OS light/dark setting, 35-45 words on a screen at rest, plain product words, nothing that reads as "AI". Agents do the work, the owner approves, the back office keeps books with receipts.

**The short answer.** Cloudflare OS has the best UI in this set. Its review queue is the closest thing to what Chausar's owner needs: a plain list of requests, oldest first, with quiet text buttons, a strict neutral palette where colour only marks intent, and approvals that can wait until the owner is ready. OpenMuse has the best *data model* for us (tasks with plans and evidence, approvals bound to a hash and an expiry). qm has the best way of showing agent work after the fact ("Worked for 23s", folded). Nautilo and Odysseus are mostly lessons in what to avoid.

---

## 1. Cloudflare OS (cloudflare/cloudflare-os, Apache-2.0)

An "office suite" where every file is a small private app (a gadget) the agent builds, and every outside service sits behind a Gatekeeper that logs and gates side effects.

### Stack
- React 19, Vite, TanStack Router (file routes in `packages/workshop-frontend/src/routes/`), Tailwind 4.
- Component library: Cloudflare's own Kumo (`@cloudflare/kumo`), restyled with semantic tokens in `packages/workshop-frontend/src/styles.css`. Icons from Phosphor. `motion` is a dependency but barely used.
- State: no global store. Small external stores read through `useSyncExternalStore` (`useActions.ts`), plus React state.
- Transport: Cap'n Web RPC over one WebSocket (`newWebSocketRpcSession` in `src/main.tsx`). The server is Durable Objects. The UI passes a subscriber object to the server and the server calls it back (`AiChatSubscriber.changeApplied`, `ActionsSubscriber`).

### Shell and screens
- Left sidebar (`components/AppShell/Sidebar.tsx`): Home, Workspaces, Blueprints, Outputs, installed Gatekeeper apps, Explore. A command palette (`CommandPalette.tsx`).
- Home (`routes/index.tsx`): one composer on a soft mesh background, with four example tasks underneath (`HomeTaskSuggestions.tsx`). The comment there is worth keeping: formats are "advertised by example rather than by a row of 'Start with Docs' buttons, so the first move isn't 'pick a file type'". Picking one fills the composer and does not send.
- Workspace (`routes/workspace.$id.tsx`, screenshot `docs/images/q3-planning-workspace.png`): chat on the left, the thing being made on the right with tabs (Slides, Code, Connections). The header carries the running cost ($1.73), activity, share, delete.

### How agent work shows
- The chat streams. Tool calls are collapsible rows with a status glyph (`components/chat/ToolCallCard.tsx`). Thinking traces are hidden by default behind a stored toggle.
- Edits stream as a live preview before they land (`EditPreviewEvent` in `ChatInterface.tsx`), then become durable change rows. Each turn can be reverted from its footer.
- When the agent finishes, a quiet line says what happened ("Phillip accepted changes") and a link card opens the output.
- Errors: a short toast ("Failed to approve action") and inline copy such as "Could not check for requests. Reload the page to try again."

### Approvals
This is the standout. Gatekeepers *simulate* side effects so the agent keeps working, and the owner approves later in bulk or one by one (README, "Gatekeepers").
- `src/Activity.tsx` has three views: Review, History, Auto. Review shows "3 requests waiting · Oldest first". Each request is a row, not a card: title, the resource and a relative time on one muted line, two lines of description, and "N fields" that expand on click.
- Buttons are text only (`components/ResolveButton.tsx`): "Deny" in muted grey that turns red on hover, "Approve" in default ink. No filled colour unless asked for.
- "Always approve" appears only when the action kind is safe to automate, and goes through a confirm dialog (`AutoApproveConfirmDialog.tsx`). Rules live in the Auto view and can be revoked.
- Once a workspace has read restricted data, auto-approve is switched off, existing rules show as suspended, and every field is shown in full with a notice (`RestrictedApprovalNotice.tsx`).
- Approving a "create" action first asks which account to create it in (`useResolveAction.tsx` plus `CreationAccountModal.tsx`).
- Empty state: a check mark, "Nothing to review", "Requests that need your approval show up here and in the workspace header", and a "View history" button.
- History rows are a tight grid: time, event, status, chevron.

### Design system
- Tokens in `styles.css` `@theme`. Near-white surfaces with a faint warm cast (`#fcfcfb`, `#f8f8f7`, `#f3f3f1`), ink `#1c1a18`, hairline borders at 6% alpha. The comment says it best: brand orange is "reserved for intent only (active item, links, primary action, focus) so it actually pops."
- Dark mode: violet-tinted surfaces around hue 285, switched by `data-mode` on `<html>`. Theme defaults to "system" and reads `prefers-color-scheme` (`src/theme.ts`).
- Type: a grotesk sans with mono for metadata; 11 to 13.5px with negative tracking in dense lists.
- Radius 4 to 16px. Motion: named easing curves (`--ease-out-strong`, `--ease-drawer`) at 150ms, and four `prefers-reduced-motion` blocks.
- Copy tone: plain, calm, slightly dry ("Checking for requests…", "Nothing can run automatically").

### Contract
- Live subscription first, then page the current pending set, then fold pages with "live wins". A watermark lets a reconnecting client replay only what it missed (`useActions.ts` header comment). Records: `ActionLogEntry` with `type` (action, observation, bindHook), `state`, `description.title/description/actionKind/autoApprovable`, `resourceTitle`, `resolvedBy`, `autoApproved`.

### Take
1. **A review queue made of rows, oldest first, with text buttons.** Exactly the "ledger rows" the founder already chose. Count at the top, nothing else shouting.
2. **Approve later, not now.** Let agents keep drafting while approvals wait. For Chausar this is the existing draft-then-approve model; the UI lesson is that a waiting approval should never look like a blocked agent.
3. **"Always approve" only for kinds marked safe, behind one confirm, revocable in one place.** And switched off entirely for client data, which mirrors Chausar's consent rules.
4. **Colour for intent only.** Neutral greys for everything; one accent for the active item, links and focus.
5. **Examples instead of a menu on the empty home.**

### Avoid
1. The decorative mesh background and the glow behind empty states. Both are colour blocks with no job.
2. A 6,700-line `ChatInterface.tsx`. Keep the chat surface small and the review surface separate.

---

## 2. QM (yc-software/qm, MIT)

A multiplayer agent harness for a company, in Slack and on the web, with an Electron wrapper.

### Stack
- Web UI is a plugin (`plugins/web-ui/`): Lit 3 templates, plain TypeScript modules, one giant hand-written stylesheet (`src/shell.css`, about 12,000 lines). Vite build. `dockview-core` for split panes. Lucide icons. Codemirror for files.
- State: module-level state objects (`shell-state.ts`, `chatState` in `chat.ts`), redraw by calling `render()`.
- Transport: HTTP to the core API (`core-bridge.ts`), Server-Sent Events for run streams (`streamRunViaSse`, `/api/runs/:id`) and for delivery events (`EventSource('/api/deliveries/events')`).
- Desktop: Electron with separate HTML pages for setup, permissions and runtime (`desktop/*.html`). Admin is a separate plugin (`plugins/admin/`).

### Shell and screens
- Sidebar: Home, Search, Browse, "Create New Chat", then conversation groups (Personal and shared scopes). Footer: user name, admin and settings icons. Screenshot: `desktop/test/screenshots/settings.png`.
- Other views: Inbox (agent-triaged mail and Slack with drafts), Loops (standing jobs), Crons, Skills, Files, Deploys (internal web apps), Memory, Connectors.
- Settings is a single column of label, one-line explanation, control on the right, separated by hairlines. No cards except the connect prompts.

### How agent work shows
- Each turn has a "work block". When finished it folds into a single muted line, **"Worked for 23s"**, with a chevron (`work-duration.ts`, screenshot `docs/qa/tool-purpose/after.png`). Inside, tool calls are named by purpose, not by command: "Inspect Python version", "Calculate squared number sum" (`activity-presentation.ts` turns raw calls into categories read, search, execute).
- The timer pauses while waiting for an approval (`workPausedForApproval`).
- A goal strip shows a long-running objective, its elapsed time and its floor (minimum time, turns, tokens or dollars) (`goal-strip.ts`). A swarm strip shows sub-agents.
- Follow-ups typed while the agent works are queued as chips you can edit or remove.
- Density tiers (`density.ts`): full, compact, card, strip, picked from the pane size. The same view degrades cleanly when split.

### Approvals
- Command approvals sit **in the composer**, replacing the input (`composerApprovalPanel` in `composer.ts`). Buttons: Deny, Allow once, Allow for session (primary), Allow always. The placeholder reads "Approve or deny to continue". After the decision the transcript shows "Approved once", "Approved for this session" or "Approved always".
- Loops have per-action gates: each `shipActions` entry is `auto` or `hold` (`loops.ts`). Held actions land in the Inbox as review items with labels like "Send", "Open PR", and states "Awaiting confirmation", "Action in progress", "Changes requested", "Superseded" (`inbox.ts`).
- Inbox empty copy: "Nothing is waiting on you."

### Design system
- Tokens at the top of `shell.css`: system UI font, a serif for the brand, a named font scale from 12.5 to 26px, content width 820px, radius 8/10/16px, one deep blue CTA in oklch.
- Dark mode via `.dark` class; theme choice Light, Dark, System, where System follows `prefers-color-scheme` live (`settings.ts`). You can import an iTerm or VS Code theme.
- About ten `prefers-reduced-motion` blocks. A "working wave" and sheen label for live work.
- Copy tone: short and direct ("No conversations yet.", "Use company access or your own subscription.").

### Contract
- Runs are server objects; the browser asks for active runs and streams one by SSE. Inbox items are a ledger: `LedgerItem` with `state` (pending, processed, held, actioned, dismissed, failed), `proposal` (data, by agent or human), `thread`, `actionKind`, `actionResult`.

### Take
1. **"Worked for 23s" folding.** Finished agent work collapses to one quiet line; open it and every step reads as a purpose in plain words. This alone keeps a run screen under the word budget.
2. **Name tool steps by purpose.** "Reconciled March bank lines", never `bank.reconcile(...)`.
3. **Per-action gates, auto or hold, visible on the standing job.** Chausar's delivery steps already say who does them; the gate belongs next to that label.
4. **Settings as label, one line, control.** No cards.
5. **Density tiers** so the same review row works in a side sheet and full width.

### Avoid
1. Four approval buttons at once. "Allow for session / always" invites rubber-stamping; for an owner approving client work, it should be one decision per draft, with standing rules set somewhere deliberate.
2. A 12,000-line global stylesheet and Slack-shaped vocabulary (channels, DMs, emoji) leaking into a business tool.

---

## 3. OpenMuse (CopilotKit/OpenMuse, MIT)

A personal agent with a browser, terminal and files, built once in React Native and shipped to iOS, Android and web.

### Stack
- Expo 54, React Native 0.81, `react-native-web` for the browser build (`apps/mobile/`). CopilotKit React Native for the chat agent. Lucide icons. Zod schemas shared from `packages/domain/src/`.
- Styling: inline React Native style objects and one `colors` map (`apps/mobile/src/ui.tsx`).
- State: React context (`workspace.tsx`, `agent-workspace.tsx`).
- Transport: HTTP JSON. The agent workspace is **polled every 3 seconds** while the app is visible (`agent-workspace.tsx`). Chat replies stream through CopilotKit.

### Shell and screens
- One column, centred. Avatar and name at the top ("Here when you need me"), a "Computer · take control" chip, the conversation, a pill composer, and a five-icon pill tab bar at the bottom: chat, workspace, ideas, tasks, apps (screenshots `assets/demos/2026-09-16/web.png`, `2026-09-23/jev-live-web.png`).
- Workspace home (`screens.tsx`) shows three counters: unread emails, on the calendar, **waiting for you** ("Your review keeps things moving").
- Tasks screen: All / In progress / Finished, then task cards, then "Reviews & receipts".

### How agent work shows
- Short status sentences between results ("I'll check your inbox for the school trip.", "Found 1 email"), then real result cards (email, browser, PDF) with one action ("Open email").
- Delegated tasks are durable server work: a card with title, status, "3/5 steps", a thin progress bar, and the next step or the question (`TaskCard` in `agent-ui.tsx`). "Review requested" or "Your input is needed" in blue when blocked.
- Send arrow becomes a stop square in the same spot; stopping keeps the draft. Follow-ups queue visibly. A "Latest messages" control instead of forced scroll (`docs/EXPERIENCE.md`).
- Background updates surface only meaningful completions or requests, link to the saved task, and can be dismissed.

### Approvals
- Review is a sheet titled **"One last look"** (`ReviewDetail` in `details.tsx`), subtitle "Review this exact action before it changes your connected account." It shows every field that will be sent: account, To, Cc, Bcc, subject, body, attachments with version. Footer: "Your approval applies only to the details shown above." Buttons "Approve & send" / "Approve change", Deny, and Edit (which denies and reopens the draft for editing).
- The decision posts `{decision, hash}` to `/api/actions/:id/decide`. If the action changed since it was shown, the hash no longer matches and approval fails. Proposals expire (`expiresAt`).
- Empty: "When an email or calendar change needs your approval, it will appear here."

### Design system
- Canvas `#FCFCFC`, text `#11191C`, muted `#697176`, lines `#EEEEF0`, pastel tints (sky, green, lavender, orange) behind icons, a sky-blue user bubble.
- Light only in practice. Large touch targets, 14 to 22px radii, rounded pills everywhere.
- Copy tone: warm and personal, a capybara mascot.

### Contract
- `AgentTask` (`packages/domain/src/agent.ts`): status (queued, running, waiting_approval, waiting_input, scheduled, paused, succeeded, failed, cancelled), `plan: TaskStep[]`, `evidence: Evidence[]` (mail, file, web, user with excerpt and url), `question`, `result`, `error`, `artifactIds`, `attempts`, lease fields.
- `RunEvent` kinds: plan, step, observation, approval, result, error, status.
- `ActionProposal` (`packages/domain/src/index.ts`): status awaiting_review, executing, succeeded, failed, **outcome_unknown**, denied, cancelled, expired; plus `hash`, `expiresAt`, `account`.

### Take
1. **The data model, nearly as is.** Task with plan, steps, evidence, question; proposal with hash, expiry and an honest `outcome_unknown`. This matches "never fake a capability" and "say done only when a tool run proves it" better than anything else in the set.
2. **"One last look": show the exact payload, bind approval to its hash.** Chausar already shows the exact payload before client data leaves; the approval screen should follow the same rule for invoices and deliverables.
3. **Edit means deny and reopen.** No half-edited approved state.
4. **Evidence as a thin left rule and an excerpt**, not a card. It's the right shape for "every number has a receipt".
5. **Stop keeps the draft; queued follow-ups are visible.**

### Avoid
1. The mascot, pastel icon tiles, and "Here when you need me". Friendly, but exactly the "AI-ish" register the founder rejects.
2. Polling the whole workspace every 3 seconds. Fine for a demo; Chausar's desk already emits events.

---

## 4. Nautilo (agentsea/nautilo, MIT)

"AI goes multiplayer": rooms where people and their personal agents ("Genies") write, research and make office files together. Web workbench plus Electron and Expo apps.

### Stack
- React 19, React Router, Tailwind 4, `@assistant-ui/react` for the chat, Lexical and MDX editor for documents, TanStack Virtual, Lucide icons (`apps/workbench/package.json`). Office files run through an embedded office engine.
- Transport: one WebSocket client (`packages/realtime-client/src/ws-client.ts`) carrying typed events: `job.status`, `job.progress`, `tool.start`, `tool.end`, `approval.ask`, `approval.resolved` (`packages/types/src`).
- State lives in a single 8,900-line adapter, `src/adapters/nautilo-runtime.tsx`.

### Shell and screens
- Navigation rail plus room rail, a conversation column, a context panel and a browser column, all resizable (`layouts/workbench-shell.tsx`). Management pages: admin, connections, costs, memory, scheduled tasks, skills, settings.
- Office apps (writer, sheets, slides, board, design) render inside the workbench (`public/apps/office/*-preview.png`). The Writer screenshot shows a full Word-style ribbon with uppercase group labels.

### How agent work shows
- Tool start/end and job progress events stream into the transcript. Changes to documents arrive as tracked changes with a Review ribbon group (accept, reject, next, previous) (`apps/office-writer-review-group.tsx`).
- Events go to a bell with a durable feed. "Quiet events" (`docs/quiet-events.md`) snoozes the badge for an hour, until tomorrow 09:00, or until resumed, without hiding history and without touching approvals.

### Approvals
- An approval dock above the composer (`components/approval-ask-dock.tsx`), driven by a pure reducer (`approval/approval-lifecycle.ts`). Verbs: "Yes, once", "This room", "Always", "Deny", with keyboard shortcuts 1 to 4 and Esc. Hints explain that Room and Always "write a standing rule".
- The reducer's rules are worth copying in spirit: never clear an approval on a lost HTTP response, only on the server's `approval.resolved`; a late duplicate `approval.ask` can't reopen a finished one; unrelated tool events never clear another approval.
- Destructive tools need a "prove it" PIN (`ApprovalDialog`, `submitProveIt`).
- An auto-approve bar shows when a session has standing approvals (`auto-approve-bar.tsx`).

### Design system
- Light "Papyrus Manga Minimal": cream `#faf8f5`, ink `#1c1917`, terracotta accent `#c85040`; a dark palette under `.dark`. Tokens hand-mirrored from `packages/config/src/design-tokens.ts` with a parity test (`src/index.css`).
- Theme defaults to **dark** and ignores the OS setting (`hooks/use-theme.ts`).
- Copy: playful brand ("Meet your Genie"), technical inside.

### Take
1. **Approval state as a pure reducer that only trusts the server's "resolved" event.** Chausar's approve button must never show "approved" on a guess.
2. **Quiet hours for the event feed that never hide approvals.**
3. **Accept/reject on tracked changes** for deliverables the agent edits.

### Avoid
1. Five resizable columns and a full office ribbon. The opposite of 35-45 words at rest.
2. Ignoring the OS theme and defaulting to dark.

---

## 5. Odysseus (pewdiepie-archdaemon/odysseus, AGPL-3.0, learn only, no code copied)

A self-hosted AI workspace: chat, agents, research, documents, email, notes, calendar, local models. Python backend, plain JavaScript frontend.

### Stack
- No framework. About 110 hand-written native ES modules in `static/js/`, 21 CSS files in `static/css/` whose order is load-bearing (the header of `00-tokens.css` counts 1,151 redeclarations and 1,886 `!important`). A service worker for offline. A new feature-first layout is being introduced one module at a time (`docs/frontend-architecture/ADR-001-source-and-deployment.md`, `handbook.md`).
- Transport: SSE for chat, research and email reply streams (`routes/chat_routes.py`, `static/js/chatStream.js` with a stall watchdog); polling for background research jobs (`docs/BACKGROUND_TOOL_JOBS.md`).

### Shell and screens
- Screenshot `assets/branding/odysseus-browser.jpg`: dark, monospace everywhere, a long sidebar (New Chat, Search, Chats, Email, Tools, Brain, Calendar, Compare, Cookbook, Deep Research, Gallery, Library, Notes, Tasks, Theme). Home is a centred wordmark, "Yours for the voyage.", a tip, and a composer with an Agent/Chat toggle and model picker.

### How agent work shows
- Streamed messages with an "agent thread rail" of expandable rows. Background research reports back into the originating chat as a new message, marked as untrusted evidence, with a compact header (status, a spinning "whirlpool" while running).
- `docs/AGENT_TURN_CONTRACT.md` is a careful contract: what a turn may do is frozen before it runs (required, offered, executable), and an unavailable capability stops the turn with an honest message instead of substituting something else.

### Approvals
- Tool approvals reuse the "ask user" card: the agent's question with options rendered as buttons in the transcript (`chatRenderer.js`, `askUserKind = 'tool_approval'`). The choice is sent as a sealed approval id.

### Design system
- One Dark-style palette (`--bg #282c34`, `--fg #9cdef2`, `--red #e06c75`), many user themes. Monospace UI font. Dark only by default.

### Take
1. **Freeze what a run may do before it starts, and stop honestly when something is missing.** That is "never fake a capability" written as a turn contract; the UI should show the frozen scope in one line on the run.
2. **Approvals as a question in the flow, with the answers as plain choices.** Good for low-stakes choices ("which of these two drafts?").

### Avoid
1. A sidebar with fifteen tools. Chausar has seven places; keep it that way.
2. Monospace, terminal-dark styling and a stylesheet held together by load order.

---

## What Chausar should take, ranked

1. **Cloudflare OS's review queue** as the shape of "Approve": rows, oldest first, count at top, text-only Approve / Deny, details on expand, an empty state that says "Nothing to review" and points to history.
2. **OpenMuse's proposal model**: hash-bound approval, expiry, `outcome_unknown`, Edit means deny and reopen, and a "one last look" sheet that shows the exact thing that will be sent or issued.
3. **qm's folded work**: "Worked for 2m" as one muted line under each finished run, steps named by purpose, timer paused while waiting on the owner.
4. **qm's per-action gate** (auto or hold) shown beside each delivery step, and Cloudflare's rule that automation is offered only for kinds marked safe and never for client data.
5. **Nautilo's approval reducer discipline**: the UI changes an approval's state only on the server's resolved event, never on an optimistic click.

## What to avoid, across the set
- Decoration that isn't information: mesh backgrounds, glows, pastel icon tiles, mascots.
- More than one way to say yes. "Allow for session / room / always" belongs in a deliberate settings place, not on every approval.
- Ignoring the OS theme (Nautilo, Odysseus).
- Wide, many-panel shells (Nautilo, Odysseus). One list and one sheet beside it is enough.

## Best UI in this set

**Cloudflare OS.** It's the only one whose visual rules already match the founder's taste: near-neutral surfaces with colour reserved for intent, hairlines instead of boxes, 150ms purposeful easing with reduced-motion fallbacks, theme that follows the system, and copy that is plain and calm. More importantly, its approval flow solves Chausar's central screen: the owner comes back to a short list of exactly what needs a decision, the agents kept working while they were away, and nothing gets approved by habit.
