# Approvals, operations and business-data UIs: what Chausar's new frontend should learn

Written 21 October 2026 for the full frontend rework. Five open source products, read from their code and screenshots. Nothing was installed or run. Clones live in the session scratchpad under `clones/<owner>__<repo>`; every path below is relative to that repo's root.

Chausar in one line (from `CHAUSAR-ARCHITECTURE-B2C.md` sections 1 to 3): one owner starts and runs a computer-only service business, agents do the work, the owner approves, and a deterministic back office keeps books with receipts. The AI never does arithmetic, and no capability is faked.

The founder's taste, used as the yardstick throughout: minimal and quiet, no boxes or colour blocks, motion only when it means something, follows the OS light or dark theme, 35 to 45 words on a screen at rest, plain product wording, nothing "AI-ish".

## The verdict first

| Product | What it is | Best idea for Chausar | Biggest clash with the taste |
|---|---|---|---|
| **opendesk** | Helpdesk with an AI agent ("Ollie") | The full propose, approve, apply contract, plus undo everywhere | Tinted cards, violet AI branding, mascot, looping animations |
| trycompai/crm | CRM run by agents | One quiet inline suggestion row with its evidence; dotted underline for agent-made values | Boxed stat strips, approvals scattered across objects |
| helix-foundry | Data workspace where AI proposes definitions | Approve by digest, server re-checks staleness, one diff count line | Raw JSON diffs, approvals hidden behind a dropdown |
| omnigent | Multi-agent coding workspace | One approval component everywhere, resolved cards collapse to a receipt line, attention logic | Seven buttons on one card, mascot, "Noodling..." labels |
| llm-space | Prompt and agent workbench | Preview then apply to a copy; one transport seam with a pure reducer | Developer density, JSON editors, rainbow buttons |

**Best UI in the set: opendesk.** It is the only one where the approval is a complete, honest object end to end: the agent can only propose, the approval token never reaches the model, the decision is claimed once, the write is idempotent and audited as "AI on behalf of the user", and the card says plainly what will happen ("Sends to the customer", "Nothing is sent until you send it"). Its live layer (contiguous event sequence numbers with gap replay) keeps a queue current with no polling and no spinners. Its looks are too loud for Chausar, but the skeleton underneath is exactly what Chausar's Today and approval surfaces need. Strip the colour and keep the contract.

---

## 1. opendesk (useopendesk/opendesk, Apache-2.0)

### Stack
- `web/` and `admin/`: React 19, Vite 8, TypeScript, Tailwind v4 (`@theme inline`), Radix, cva, lucide icons, `motion` (Framer), sonner toasts, cmdk palette, TipTap editor, i18next with 14 locales. Fonts Geist and Geist Mono (`web/package.json`).
- Routing with TanStack Router (`web/src/router.tsx`), server state with TanStack Query, small client state in zustand (`web/src/app/shellStore.ts`).
- Realtime: Phoenix Channels over a WebSocket, served by a stateless Elixir gateway in `realtime/` that fans out NATS events. AI runs stream over SSE through `streamEvents()` in `web/src/lib/api/client.ts`.
- `desktop/` is a thin Electron shell around the same web app. It adds OS notifications, a dock badge, deep links and auto-update. The web app sets `<html data-desktop>` and adapts with Tailwind variants (`desktop-glass`, `desktop-mac`, `desktop-win`) in `web/src/styles/app.css`. This is the same "one engine, web and desktop" shape Chausar wants.

### Shell and information architecture
- Three panes: grouped left sidebar (INBOX, TEAMS, VIEWS, WORKSPACE, 28px rows with counts), a list, then the detail view with a property inspector on the right.
- `/` redirects to `/inbox/unassigned`. **The queue is the home**; there is no dashboard.
- Routes: inbox, views, teams, mail, contacts, companies, kb, reports, settings. The AI agent lives under Settings (Overview, Behaviour, Knowledge, Tools, Playground, Tests).
- `admin/` is a separate operator console with `g x` keyboard shortcuts (`admin/src/app/nav.ts`).

### Approval UX
- **The contract** (`contracts/ai.md`, `web/src/components/assistant/api.ts`): "Reads run directly; writes only propose." A write becomes an `assistant_actions` row, `pending` for 15 minutes. The approval token goes only to the browser, never to the model, so a run cannot approve itself. A decision claims the row atomically; a second decision gets `409 approval_not_pending`. A new message expires the pending proposal. The approved write runs as the user with `actor_type="ai"`, is audit-logged as `assistant.action`, and uses idempotency key `assistant-<action id>`.
- **Step states:** `running | done | error | awaiting_approval | approved | denied | expired`. An SSE run ends with `done: {status: "complete" | "awaiting_approval"}`.
- **The `Preview` shape:** `{title, summary?, changes?: {field, from, to}[], body?, targets?, total?, external?, system?}`. This is a good general schema for any Chausar approval.
- **`ApprovalCard`** (`web/src/components/assistant/Steps.tsx:147`): title and summary; a field diff built from `ChangeRow` (`Steps.tsx:130`, an 88px label column, old value struck through, an arrow, new value in medium weight); the outgoing message body; target chips capped at six with "+N more"; an "external" chip reading "Sends to the customer" and a "system" chip for connector writes; a footer reading "Waiting for you" with Deny (ghost) and Approve (primary, with a Cmd+Enter hint). In the code the struck value sits on a red tint and the new value on a green tint, inside an amber-bordered card.
- **AI draft review** (`web/src/components/tickets/detail/SuggestedReply.tsx`): "Ollie suggested a reply", with the hint "Nothing is sent until you send it", a "Based on" sources row and Send / Edit / Discard. Discard is optimistic with rollback. If someone handled it elsewhere, the server's `suggestion_not_pending` simply clears it.
- **Property proposals** (`web/src/components/ai/ticket/OlliePanel.tsx`, `web/src/lib/decisions.ts`): below a confidence threshold the agent's picks become rows with Apply / Skip, plus Apply all and Skip all. Confidence sits only in a tooltip. When nothing needs changing: "Everything already matches what Ollie would pick."
- **Undo as the default:** "Every change is undoable: drafts by toast, rewrites and translations from a diff review." `web/src/components/ai/ui/DiffView.tsx` shows a word-level diff with a "+N -M words" summary and Undo / Keep; typing makes the diff stale and drops it.
- **Pending queue** (`web/src/components/agent/ReviewQueue.tsx`): "Needs review" rows with a reason, the question, the agent's one-line answer and a meta line "#1097 · name · 2m".
- **Audit:** `web/src/pages/settings/AuditLog.tsx` writes entries as verb phrases ("turned on two-factor authentication"). The admin console demands a typed reason before a suspension (`admin/src/components/ReasonDialog.tsx`) and a TOTP step-up before destructive acts (`StepUpDialog.tsx`).
- **Money** (`web/src/lib/format.ts`): `currency(minorUnits, code)` works in minor units and drops ".00" on whole amounts; metered costs read "about $0.0135" in tabular mono. `AnimatedNumber` rolls figures and flashes when they rise (too lively for Chausar).

### Agent work and history
- Tool steps read "Searching tickets..." and turn into a check. A working bar shows shimmer text, mono elapsed time, a streamed preview and Stop.
- The ticket timeline interleaves messages and activities by time; AI actors get their own avatar.
- The agent overview has a setup checklist ("6 of 6 done"), a KPI strip ending "Spent $28.22", the review queue and a by-day chart with a Table toggle. The right inspector hides empty fields behind "Show 4 empty fields".

### Design system (`web/src/styles/app.css`)
- Stated intent: "Monochrome... Status hues exist only for small semantic dots and badges."
- Light: canvas `#f5f5f5`, surface `#fff`, line `#e4e4e4`, fg `#0a0a0a`, fg-2 `#4a4a4a`, fg-3 `#737373`, fg-4 `#a3a3a3`. Dark: canvas `#141416`, surface `#1b1c1f`, line `#2e2f33`, fg `#f7f7f7`.
- 16 tone hues, each mixed with `color-mix(in oklab)` into solid, soft, line and ink. `AI_TONE = "violet"` (`web/src/lib/tones.ts:79`).
- Radius 2 / 4 / 5 / 7 / 8 / 12px. Type 11, 12, 13, 14px; mono with tabular figures for ids, counts and money.
- Motion (`web/src/lib/motion.ts`): 120 / 180 / 250ms, ease-out `[0.16, 1, 0.3, 1]`, four named springs. Rule worth stealing: lists "animate in and out, the first paint stays still". Reduced motion honoured. Louder effects also exist (urgent-wash 2.8s infinite, bell-ring, shimmer).
- Dark mode via `.dark` on `<html>`, but the default is light, not system.
- Copy: plain and second person. "Waiting for you", "Sends to the customer", "Nothing changes until you apply.", "Charged only when a call succeeds."

### Backend and frontend contract
- Every write emits an envelope `{id (uuidv7), seq (contiguous per workspace), type, visibility, topics, data, occurred_at}` (`contracts/events.md`).
- `SeqSync` (`web/src/lib/realtime/seq.ts`) spots gaps and replays from `GET /v1/events?since=`; if the gap is older than retention the server says `resync` and the client drops its caches. `applyEnvelope` patches TanStack Query caches directly. No polling.
- Auth token in `Sec-WebSocket-Protocol`, never the URL. Reconnect backoff 1, 2, 5, 10, 15s. A connection indicator shows socket state.

### Take
1. **The approval contract as written.** Pending row with expiry, approval token only in the owner's browser, atomic claim, idempotency key, audit entry "agent, approved by owner". Chausar's vault actions already fit this.
2. **The `Preview` shape and `ChangeRow`**, restyled: field, old value struck through in grey, new value in normal ink. No tints. Add `external: true` as the plain line "Sends to the client" when something leaves the business.
3. **Undo as the default safety net** for anything reversible (drafts, words, notes), with optimistic dismiss and rollback, and quiet handling of "already decided elsewhere".
4. **Contiguous sequence numbers with gap replay** to keep Today and approvals live on both desktop and web with no spinner.
5. **"The first paint stays still"** as a motion rule, and **"the queue is the home"** as an IA rule.

### Avoid
1. Tinted cards, the 16-tone chip system, violet AI branding with a mascot, looping animations, KPI boxes and their density (the hero screenshot has hundreds of words at rest).
2. Defaulting to light. Chausar should resolve to the OS theme with no flash.

---

## 2. trycompai/crm (MIT, branch `release`)

### Stack
- Next 16.3, React 19.2, App Router (`apps/app/package.json`). Page changes use React `<ViewTransition>` with directional types `nav-forward`, `nav-back`, `nav-lateral` (`apps/app/components/page-transition.tsx`).
- Tailwind v4, shadcn components re-housed in `packages/ui/src/components`, plus custom AI pieces (`suggestion.tsx`, `sourced-value.tsx`, `reasoning.tsx`, `save-bar.tsx`). Carbon icons. `@pierre/diffs` for file diffs.
- tRPC 11 and TanStack Query 5 with server prefetch and hydrate (`apps/app/lib/trpc/*`). UI state lives in the URL through `nuqs`: the open record-sheet stack, tab and filters are query params (`components/crm/record-sheet/record-stack.ts`). No client store.
- No websockets. CRM data polls with a conditional `refetchInterval`. Agent chat streams through the `eve` SDK via a same-origin proxy (`apps/app/app/eve/v1/[...path]/route.ts`) that mints a two-minute token naming the user and the record.

### Shell and information architecture
- Left icon rail with six items: Overview, Chat, Companies, Contacts, Deals, Settings (`components/app-icon-rail.tsx`), plus a quick switcher.
- Records open as **stacked sheets on the right over the list**, not as separate pages (`record-sheet-host.tsx`, `detail-sheet.tsx`). Tabs inside a record: Overview, Contacts, Deals, Activity, Agent.
- Home (`app/(app)/[slug]/page.tsx`, `dashboard-summary.tsx`): "Welcome back", then "What you have closed, what is still in play, and what needs you today.", a Me / Team toggle, and cards for deals in progress, overdue tasks (with inline "Mark as done") and recent activity.

### Approval UX
- **Field-level proposals, the strongest pattern.** `ContactFact` (`packages/db/prisma/schema.prisma:419`) has `band` (VERIFIED, PROBABLE, POSSIBLE), `status` (APPLIED, PROPOSED, DISMISSED, SUPERSEDED), `evidence`, `sourceUrl`, `decidedById`, `decidedAt`.
- `FactSuggestion` (`components/crm/facts.tsx`) renders `packages/ui/src/components/suggestion.tsx`: one small muted row with the proposed value, a rationale built from the evidence joined by " · ", and two ghost icon buttons, accept and dismiss. It sits **inline where the value will land**, not in a modal.
- Rules from `docs/agent.md` ("Evidence, not confidence"): apply automatically only at VERIFIED; never overwrite a human value; never re-offer a dismissed value; one suggestion per field at a time; accepting one settles its siblings. "No tool accepts a confidence, a score, or a `sourceUrl` offered as proof." Evidence is weighed by code (`lib/evidence.ts`). This mirrors Chausar's "nothing is active without evidence" rule for business terms.
- **Provenance:** applied agent values carry a dotted underline (`SOURCED_VALUE = "underline decoration-dotted underline-offset-4"`, `packages/ui/src/components/sourced-value.tsx:10`). Hover shows the claim, reasons, when it was observed and the source.
- **Deploy as the approval boundary:** saving an agent only produces a READY `AgentVersion`. The review screen (`components/agent-builder/team-agent-detail.tsx`) lists triggers, scope, actions, access and the exact files, then "Change details" and "Deploy agent". The deploy button cycles "Deploying" / "Deployed" / "Try again" and sends an idempotent `clientRequestId`. Scope rule: "Empty never means all."
- **Stopping a run** asks "Stop this run?" and explains that anything already done stays done. Buttons "Keep running" / "Stop run". Their doc: "Cancelling is not undoing."
- **Audit:** `AgentAction` is a ledger row written before execution (`summary`, `targetLabel`, `idempotencyKey`, PLANNED to SUCCEEDED, `externalId`). `AgentAuditEvent` keeps before and after. CRM changes become `Activity` rows; "the timeline *is* the history".
- **Money** (`docs/currency.md`): `amount` + `currency` are never converted in place; only a `baseAmount` at a rate frozen at write time is summed. A missing rate is disclosed, not zeroed: the deals table prints "· N not counted (no CHF rate)" (`deals-table.tsx:284`). `formatMoney` uses `Intl.NumberFormat` (`packages/ui/src/lib/format.ts:50`).

### Agent work and history
- `AgentRunsDrawer`: "History", subtitle "Every run and every change, newest first.", tabs Runs and Activity.
- Run rows (`agent-history.tsx`): "Run #003", a human status, a mono meta line (trigger · date · version), duration and "N external actions". Expanding shows one merged, time-sorted timeline of events and actions.
- Tool steps use paired present and past tense labels ("Writing instructions" / "Wrote instructions", `lib/agent-tool-display.ts`).
- The record's Agent tab separates offline, working and ended; ninety seconds of silence counts as over, not working.

### Design system
- `packages/ui/src/styles/globals.css`. Light: background `#ffffff`, foreground `#171717`, muted text `#6b6b6b`, border `#e2e2e2`. Dark: background `#0f0f0f`, card `#171717`, border `#2a2a2a`, muted text `#a0a0a0`. Greys deliberately untinted.
- Rule from `docs/design.md`: **"Only two things are filled: primary for the action you want, destructive for the one you cannot undo."** Primary `#006b4f`, destructive `#ae2e24`, same in both themes.
- Radius 4 / 5 / 8 / 12px. Geist and Geist Mono; mono for counts, times and ids. Layout tokens: page top 40px, inline 24px, containers 820 and 1120px, sheet 640px.
- Dark mode: `next-themes`, `defaultTheme="system"`, `disableTransitionOnChange`. Follows the OS.
- Motion: directional view transitions, small icon micro-motions at 240ms, reduced motion respected.
- Copy: plain, slightly dry. "Nothing overdue. Good.", "Nothing has happened yet.", "Tasks move here once you tick them off.", "That run had already finished."

### Backend and frontend contract
- tRPC over a Nest API. "Intelligence never lives in the API" (`docs/api.md`): the API writes an `AgentTask` row and the agent process leases it and does every judgement write.
- UI learns of agent work by polling plus cache invalidation. Models: Company, Contact, Deal, Activity (NOTE, CALL, EMAIL, MEETING, TASK, STAGE_CHANGE, ENRICHMENT), ContactFact, custom fields; AgentDefinition, AgentVersion, AgentTrigger, AgentRun, AgentAction, AgentAuditEvent.

### Take
1. **The inline `Suggestion` row** with its one-line evidence and two quiet icon actions, and its state rules (one offer per field, never re-offer, never overwrite the owner, auto-apply only on proof code can check).
2. **The dotted underline for anything an agent produced**, with provenance on hover. In Chausar it can also mark any number that opens a receipt.
3. **The two-fill rule.** Only the wanted action and the irreversible action are filled. Everything else is ink on background.
4. **Record detail as a sheet beside the list**, with its state in the URL, so a link restores exactly what the owner was looking at. This matches the founder's "sheet beside the list" decision of 1 October.
5. **Disclose, never zero.** "2 not counted (no rate)" is the right voice for money Chausar cannot yet compute.

### Avoid
1. Boxed stat strips, bento cards and red failure strips (`bg-destructive/10`), plus four mono metadata items per row at rest.
2. Approvals scattered by object (facts in sheets, deploy on the agent page, `WAITING_FOR_APPROVAL` inside a run filter) and a chat-first home. Chausar needs one place where everything waiting on the owner gathers.

---

## 3. HelixDB/helix-foundry (Apache-2.0)

Chausar already took its backend idea (code computes structure, the model writes descriptions, a proposal is accepted by digest). The frontend has more to give.

### Stack
- React 19, react-router-dom 7, Vite 7, pnpm workspace.
- Plain CSS custom properties in layers (`apps/web/src/workspace.css` for tokens, `kit/kit.css`, `shell/shell.css`, one sheet per area). Tailwind 4 is imported but barely used.
- A home-grown kit in `apps/web/src/kit/` (Button, Dialog, DataGrid, Tabs, Menu, StatusBadge, EmptyState, PageHeader). lucide icons. @xyflow/react and d3-force for the graph.
- TanStack Query with every key prefixed by the workspace id. No global store.
- Realtime: one SSE stream per workspace (`apps/web/src/shell/live.tsx`, served at `apps/api/src/routes/workspace.ts:445`). Everything else is REST plus polling.

### Shell and information architecture
- Nav (`shell/nav.ts`): Home, Ontology, Data, Analyst (recent chats as sub-items), Settings in the footer. 236px sidebar, collapses to 60px, becomes a drawer at 800px. Nav badges are fed by the live stream.
- Routes (`main.tsx:79`): `/`, `/data/*`, `/ontology/*`, `/records/:logicalId`, `/analyst/*`, `/proposals`, `/settings`. "Review changes" (`/proposals`) is not in the nav; you reach it from a chat.
- Home (`areas/workspace/home.tsx`): date and greeting, a line of counts, an ask box, key metric charts, a health line ("All connections are healthy"), "Needs attention" capped at five items with "Inspect", recent activity.
- The hero screenshot (`docs/assets/hero.png`) shows a warm paper background, a Georgia "Explorer" title with "Your records and how they connect.", and a force graph in a fine-bordered panel.

### Approval UX
- **Proposals** (`review.tsx` `ProposalReview`, "Review changes"):
  - Failed checks first: "These checks need attention before publishing".
  - The diff (`proposal-changes.tsx`) opens with an honest framing line: "Compared with the currently published definitions. This describes definition changes, not how many data records will change." Then one count line, "{n} added · {n} changed · {n} removed". Each change is a closed `<details>` ("Changed ontology · Account") listing changed fields, with current and proposed JSON inside.
  - Server diff by canonical JSON with sorted keys (`apps/api/src/proposal-comparison.ts`).
  - **Staleness in plain words:** if inputs or the published base moved, "Inputs or published definitions changed since this proposal was tested. Retest before publishing."
  - Actions: primary "Publish" (only when status is `ready`), secondary "Request changes", which sends it back to the AI with "Revise this proposal to " prefilled. Overflow: Retest, Edit definitions, Reject.
  - **Publish by hash:** the client posts `{hash}`; the server refuses with 409 "Proposal changed; review its current version" if the hash, inputs or base generation moved (`apps/api/src/assistant.ts:1688`). Publication builds a new generation and activates it atomically, so "Stop" is hidden once publishing starts.
- **Object actions** (`object-action-form.tsx`, `apps/api/src/object-actions.ts`): "Preview changes" returns `{action, evidence, hash}`; "Review the affected records" shows before and after; "Apply changes" posts the hash and `idempotencyKey: crypto.randomUUID()`. The server recomputes ("Action preview is stale", 409) and writes an `audit` resource. Toast: "Action recorded".
- **Suggested structure at onboarding** (`suggested-ontology.tsx`): code computes entities and merges, the AI fills summaries; skeletons show while the AI is still writing; inline rename and exclude; notes under "What we merged" and "Worth checking"; the footer asks "Does this look right?". This is very close to Chausar's plan screen.
- **Agent to approval hand-off:** a run that changes things ends `awaiting_review`, and the `PreparedChanges` card (`areas/analyst/reply.tsx:610`) says "Nothing changes until the proposal is reviewed and published." with one Review link.
- **Numbers:** tabular figures via `.hf-num`; `formatMetric` (`areas/workspace/metrics.tsx:51`); big integers kept exact beyond 2^53 (`kit/util.ts`); tooltips spell out "$12,400" where a bar says "$12.4K"; capped charts say "Top 10 of 1,000".

### Agent work and history
- Each reply opens with a `Trace` (`reply.tsx:286`) between two fine rules: a status line ("Analyzing your question", "Taking longer than usual", "Connection lost, reconnecting...", "Ready for your review"), time, "Show steps", "Stop". At most three one-line steps. Expanded: the query used and the model call and token counts, never raw events.
- A time estimate ("About 10 to 20s") appears **only after three or more measured comparable runs**.
- A lost connection looks different from a failed run, and a failed run keeps the steps that finished.
- Long jobs (`OperationProgress`, `setup-components.tsx`) show measured counts only ("12,345 records read"), no percentages or bars.
- One activity shape for everything (`ActivityItemSchema` in `packages/shared/src/workspace.ts`) with a typed `ref` the app turns into a route, and repeats folded together.

### Design system (`apps/web/src/workspace.css`, `docs/DESIGN.md`)
- Light: bg `#f8f7f3`, raised `#fdfcf9`, text `#292a26`, muted `#65675e`, faint `#9b9d93`, border `#e4e2da`, accent `#36b98a`, danger `#b5503b`. Dark: bg `#161713`, text `#ecebe4`, accent `#4fd0a0`.
- Inter for UI, Georgia for display titles. Scale 11 / 12 / 13 / 14 / 16 / 20 / 26 / 34px, base 13px. Spacing 4 to 64px. Radius 6 / 8 / 12 / 16px.
- Motion: one duration, 160ms, ease `cubic-bezier(0.2, 0.8, 0.2, 1)`. Reduced motion drops it to near zero.
- Dark mode via `prefers-color-scheme` plus `data-theme`, but defaults to light and labels Dark and System "beta".
- Copy: "No object types yet", "Progress has been saved. Retry when you're ready.", "Couldn't answer this".

### Backend and frontend contract
- One shape for all records: `Resource {id, kind, name, revision, createdAt, updatedAt, data}` (`packages/shared/src/index.ts:16`).
- SSE sends a slim `{runs, jobs, reviews}` summary only when it changed (checked every 2s, keep-alive every 16s). The client uses it as **a signal to invalidate queries, not as the data**.
- Zod schemas shared between server and client; a typed SDK in `packages/sdk`.

### Take
1. **Approve against a digest the server re-checks**, with staleness in one plain sentence ("Things changed since this was prepared. Check it again."). Chausar's blueprint and price receipts are already digest-based; the UI should show the refusal honestly.
2. **One count line, then folded detail.** "1 price changed · 2 steps added", then one closed row per change, plus a line that says what the comparison does not cover.
3. **"Nothing changes until you approve."** One quiet sentence and one action at the end of any agent run that prepared a change; "Request changes" returns it to the agent with the owner's words.
4. **Progress honesty:** measured counts only, estimates only from measured runs, Stop hidden once an atomic commit starts, offline shown differently from failure. This is "never fake a capability" applied to motion and progress.
5. **The live stream as an invalidation signal** with a small summary (counts of what needs the owner), and one typed activity shape whose `ref` opens the right sheet.

### Avoid
1. Raw JSON as the real diff, and a JSON textarea as the edit path. Owners need plain field sentences.
2. Sprawl: a greeting hero, stacked panels on Home, chart colours hard-coded for light, dark mode still beta, and approvals reachable only through a dropdown.

---

## 4. omnigent-ai/omnigent (Apache-2.0)

Note: in the clone, the `web/` folder is staged as deleted in the working tree; it was read from `HEAD` with `git show`, without restoring anything.

### Stack
- React 18, Vite 8, TypeScript, react-router-dom 7 (`web/package.json`). One bundle runs in the browser, in Electron (`web/electron`), inside iOS and Android shells, and in a VS Code panel (`editors/vscode`).
- Tailwind 4 with shadcn and Radix (`web/src/components/ui/*`), lucide icons. TanStack Query for server state; the live chat sits in a very large zustand store (`web/src/store/chatStore.ts`, about 8,900 lines).
- Recharts for usage, Monaco and `@pierre/diffs` for diffs, @xyflow/react for the canvas, xterm for terminals.
- Realtime: SSE per session (`GET /v1/sessions/{id}/stream`, parsed in `web/src/lib/sse.ts`), plus one WebSocket for the sidebar (`WS /v1/sessions/updates`, `web/src/lib/sessionUpdatesSocket.ts`).

### Shell and information architecture
- Routes (`web/src/App.tsx`): `/` and `/c/:id` (chat), `/inbox`, `/canvas`, `/tasks` (automations), `/usage`, settings, members, policies, extensions. `/approve/:sessionId/:elicitationId` sits **outside the shell as a standalone approval page**, so a phone notification can open just the decision.
- Sidebar (`web/src/shell/Sidebar.tsx`): New session, Automations, Inbox, Canvas; then Pinned; then Projects as folders of sessions with relative times ("6m", "now").
- Home: a centred composer under a mascot and "What should we do?", with host, project, agent and model pickers (`docs/images/omnigent-desktop.png`).
- Canvas (`web/src/canvas/CanvasWorkspace.tsx`): a dotted board of session cards, each with a status dot and a state word ("New messages", "Running", "Idle").

### Approval UX
- **One component for every surface:** `web/src/components/blocks/ApprovalCard.tsx`, shown inline in the transcript, in the Inbox and on the standalone page, with the submit function injected. Modes in order: plan review ("Yes, and use auto mode" / "Yes, manually approve edits" / "Reject with feedback"), a question form, a schema form, enum buttons, and plain Approve / Reject.
- Card body: an Alert titled "Approval required · {policy}", the agent's message, a monospace preview of the tool arguments, and "Requested by sub-agent X" when it comes from a child.
- Scoped grants as separate buttons: "Approve for this session", "Always allow", "Approve & don't ask again for {host}", and more.
- Submit (`chatStore.submitApproval`) flips the card optimistically, POSTs `/v1/sessions/{id}/elicitations/{eid}/resolve`, and rolls back on a network error.
- **The card then collapses to a one-line receipt:** "Approved", "Rejected", "Approved and remembered", "Approved · won't ask again", "Prompt expired", and "Resolved elsewhere" (`ApprovalCard.tsx:662`) with a tooltip explaining it was answered in another view.
- **Inbox** (`web/src/pages/InboxPage.tsx`, `web/src/lib/inbox.ts`): pending prompts from every session, de-duplicated, newest first under "Just now" style headers; filters "Unread" and "Awaiting response".
- **Attention logic** (`useIdleNotifications.ts`): an OS notification and dock badge ("2 sessions need your attention") only on two transitions, a new pending request and running-to-idle after a settle window, so a multi-step task notifies once. The session being viewed is suppressed. Notification permission is asked on the first user gesture, not on load.
- **Keyboard:** `useApproveHotkey.ts` binds Cmd/Ctrl+Enter to approve only plain yes/no prompts, and never while the composer holds a draft.
- Undo exists only for archive and unpin (a 3s toast, `shell/archiveUndoToast.tsx`). Policies are ALLOW / ASK / DENY (`docs/POLICIES.md`); denials appear as a block in the transcript. Money (`lib/formatCost.ts`: "$x.xx", "<$0.01") lives on the Usage page, never on approval cards.

### Agent work and history
- `ToolCard.tsx`: its own comment says the bordered card, badges and pills were "removed deliberately" so prose reads first. Each tool call is one muted line, `name(argsSummary)`, with a status icon; click to expand.
- Subagents as an indented tree and a graph; a turn rail and transcript scrollbar for long runs; queued follow-ups you can reorder or edit; raw execution logs only with `?debug=1`.
- The working indicator rotates "Cooking...", "Tinkering...", "Noodling..." (`chat/chatBubbleParts.tsx`).

### Design system (`web/src/index.css`, `web/src/themePalettes.generated.css`)
- Light: background `#ffffff`, foreground `#27272a`, primary `#11171c`, muted text `#71717a`, border `#e4e4e7`. Brand accent pink `#df3c85`; info blue `#3b8ff5`; destructive `#c8324c` (dark `#e65b77`).
- Rule in a comment: accent only "for focus rings, charts, unread state, and the active sidebar highlight; surfaces and primary buttons stay neutral grey."
- System font stack, Geist Mono for code, base 13px on desktop, `text-xs` retired, and a user font-size setting.
- Radius 4 / 6 / 8px. Motion 180ms with a slight overshoot ease `cubic-bezier(.34, 1.4, .64, 1)`; reduced motion blocks.
- Dark mode via next-themes, `defaultTheme="system"`.
- Empty states are one quiet line: "Nothing waiting on you", "You're all caught up", "When an agent needs your input, it will show up here."

### Backend and frontend contract
- SSE events: `response.created / in_progress / completed / failed / cancelled`, `output_text.delta`, `elicitation_request`, `elicitation_resolved`, `policy_denied`, `heartbeat`. `lib/blockStream.ts` reduces them into blocks; it mirrors the Python SDK reducer.
- The sidebar WebSocket replaced a 4s poll: the client sends the set of session ids it watches, the server sends a snapshot then diffs. Each row carries `pending_elicitations_count`.
- `GET /v1/sessions/{id}` replays pending requests, so a reload restores them.

### Take
1. **One approval component, three places:** inline in the agent's work, in the owner's queue, and as a standalone page a notification can open. Same component, injected submit, optimistic flip with rollback.
2. **Resolved approvals collapse to a one-line receipt** ("Approved by you, 10:42", "Answered on your phone"). This is Chausar's receipts idea applied to decisions.
3. **The attention rules:** notify only on "needs you" transitions, settle so a task notifies once, never notify about what is on screen, drive the badge from stored state.
4. **Tool work as one muted line that expands on click**, and the accent used only for state.
5. **A keyboard approve that refuses while a draft is open**, and scope as an explicit choice when scope matters.

### Avoid
1. Button sprawl (up to seven outline buttons on a card), harness-specific copy, and raw argument JSON. Chausar's card should show the plain consequence and two actions.
2. Whimsy: the mascot, "What should we do?", rotating "Noodling..." labels, pink washes and the overshoot ease. Also, money never shows on approvals and nothing can be undone; Chausar needs both.

---

## 5. deer-flow/llm-space (MIT)

A developer workbench for prompts and agents. Its human-in-the-loop means "the developer steps the agent loop by hand", which is not the same as an owner approving a business action, so read its lessons as mechanisms, not screens.

### Stack
- Desktop shell: **Electrobun** with a Bun main process (`apps/desktop/electrobun.config.ts`, `apps/desktop/src/bun/*`); the webview is `apps/desktop/src/mainview`. `apps/web` is only a landing page and a read-only shared-thread viewer.
- React, Vite 8, Tailwind v4, shadcn (Radix and @base-ui/react), lucide, shared in `packages/ui`. CodeMirror for every text surface, @tanstack/react-virtual for long lists, auto-animate, sonner, cmdk, resizable panels, Chrome-style tabs.
- State: a zustand vanilla store per thread tab (`packages/ui/src/components/thread-playground/stores/thread-store.ts`), TanStack Query for host data, `useSyncExternalStore` over localStorage for prefs (`stores/run-mode.ts`).
- **Streaming seam:** `packages/core/src/client/transport.ts` defines `AgentTransport`, an async iterable of agent events. Web uses SSE (`apps/server/src/stream.ts`, with `[START]` and `[DONE]` sentinels); desktop uses Electrobun RPC messages keyed by stream id (`apps/desktop/src/client/rpc-transport.ts`). A pure reducer (`packages/core/src/client/reducer.ts`) folds events into messages for both.

### Shell and information architecture
- Three panes (`docs/ui-layout.md`): a workspace file tree on the left (threads are JSON files under `~/.llm-space/workspace`), Chrome-style tabs on top, thread settings and the system prompt in the middle, messages on the right. Header: title, undo, redo, run history, and a primary "Run" split button.
- Home with no tab open (`apps/desktop/src/components/welcome.tsx`): "Start with a ready agent thread, create a blank one, or open an existing file from the left side panel." and three buttons.

### Approval UX
- No approve or deny cards, queue or audit log. The gate is structural: two persisted switches, "Auto run tools" and "Enable ReAct loop" (`stores/run-mode.ts`). With both off, the model stops after proposing tool calls.
- Each proposed call is a `ToolCallListItem` (`message/tool-call-list-item.tsx`) with run, preview, copy, an **editable response** and "Mark as error". The footer reads "1 tool call · Call tools · Continue". The human can write the outcome before the agent continues.
- `ask_user_question` swaps in an `AskUserQuestionEditor` with option checkboxes plus "Other": the nearest thing to a decision card.
- **Preview, then apply to a copy:** compaction (`docs/compaction.md`, `thread-compaction-dialog.tsx`) goes Intro, Configure, a live preview with "The thread has not changed at this point", then "Apply compaction", which writes a new file and never overwrites the original.
- Undo and redo by whole-thread snapshots (`stores/thread-history.ts`, `MAX_HISTORY = 100`, 64MB image cap).
- Destructive confirms spell out consequences: "This removes the saved run from this thread and removes any evaluations that reference it."
- Cost and tokens come only from provider-reported usage (`packages/core/src/thread/usage.ts` sums fields; nothing is estimated). A per-message chip reads "9.8K in / 78 out"; a stats panel adds coloured bars and timings.

### Agent work and history
- Every finished run is an immutable `ThreadRunSnapshot`. The thread keeps only a light reference with a preview (summary, model, message count), and the full snapshot sits in a sidecar file (`packages/core/src/types/threads/thread.ts`).
- The run list (`run-history-list-view.tsx`): summary, time ago, model, count, and hover actions Inspect, Restore, Compare, Delete. A new row pulses once (1.6s).
- The inspector (`run-trace-view.tsx`) reuses the **same message renderer in read-only mode** for history as for live work. Empty: "Select a saved run to inspect."
- Runs can be compared side by side with a verdict or a 2 to 6 criterion rubric, saved immutably.

### Design system (`packages/ui/src/styles/globals.css`)
- shadcn neutral oklch. Light background `oklch(1 0 0)`, foreground `oklch(0.145 0 0)`, muted text `oklch(0.556 0 0)`, border `oklch(0.922 0 0)`. Dark background `oklch(0.2046 0 0)`, border at 10% white. One periwinkle accent `oklch(0.629 0.1692 268.32)`, user-overridable.
- Radius 0.625rem. Geist Variable at weight 300; meta text down to 9 and 10px.
- Theme light, dark or system, **resolved with `matchMedia` before React mounts**, so there is no flash. A "lite" fidelity mode drops CodeMirror and effects (`theme-provider.tsx`).
- Actions hidden until hover. Rainbow and shine-border buttons exist.
- Copy: "Choose how you want to begin", "Everything can be changed after creation.", "Review the generated checkpoint before changing the conversation.", "Not now".

### Backend and frontend contract
- Push only: a stream of agent events (message start, update, end, tool execution end, agent end) folded by the pure reducer into messages with tool calls, outputs and usage. Abort via AbortSignal. No polling.
- Local JSON files written atomically, run sidecars, optional remote runtime over SSH behind the same transport seam.

### Take
1. **One transport seam and one pure reducer** so desktop and web share every line of UI logic. Chausar's "web and desktop from one engine" needs exactly this.
2. **Agents stop at a proposal by default**, auto-run is an explicit, saved opt-in, and the owner can edit the outcome before it continues. That is Chausar's launch ladder in UI form.
3. **Preview, then apply to a copy**, with the line "Nothing has changed yet". Never mutate the source.
4. **History as immutable snapshots rendered by the live renderer in read-only mode**: a light index row plus a detail sheet, which is a receipts ledger row and its receipt.
5. **Resolve the theme before first paint**, and show numbers only as reported by the ledger or provider, never estimated in the UI.

### Avoid
1. Developer density and raw internals: JSON arguments, code editors everywhere, token and timing bars, 10px meta text, multicolour charts.
2. Decorative AI flourishes: rainbow and shine buttons, sparkles on actions, the glowing onboarding ribbon.

---

## What Chausar's frontend should do, drawn from all five

These are the ideas that more than one product arrived at independently, filtered by the founder's taste.

1. **One place for everything waiting on the owner, and it is the home.** opendesk makes the queue the home; omnigent has an Inbox fed by every session; crm and helix-foundry scatter approvals and suffer for it. Chausar's Today should lead with this list.
2. **One approval object, one component, three places.** Inline where the agent worked, in Today, and as a standalone page a desktop notification opens (omnigent). The object follows opendesk's contract: proposal row with expiry, decision claimed once, idempotency key, audit entry "agent, approved by you", plus helix-foundry's digest check and plain staleness sentence.
3. **The card shows consequence, not machinery.** Title, one-line summary, a field list with the old value struck through in grey and the new value in ink (opendesk `ChangeRow` without tints), "Sends to the client" when something leaves the business, money only as a receipt reference with its label. Two actions: the filled one and a quiet one. No JSON.
4. **Resolved decisions shrink to one receipt line** (omnigent), and anything an agent produced keeps a dotted underline that opens its provenance or receipt (crm).
5. **Inline suggestions where the value lands** (crm `Suggestion`), one per field, never re-offered after a dismissal, never overwriting the owner.
6. **Undo where it is honest, plain words where it isn't.** Undo toasts for drafts and words (opendesk); "Cancelling is not undoing" style copy for sent or recorded actions (crm); no Stop once an atomic commit starts (helix-foundry).
7. **Progress that never fakes.** Measured counts, estimates only from measured runs, offline shown differently from failed, one muted line per tool step that expands on click (helix-foundry, omnigent).
8. **Live without spinners.** A sequenced event stream with gap replay (opendesk) or a small invalidation signal (helix-foundry), carried over one transport seam shared by desktop and web (llm-space).
9. **Quiet design rules worth copying verbatim:** only two things are ever filled (crm); accent only for state (omnigent); the first paint stays still (opendesk); theme resolved before first paint and defaulting to the OS (llm-space, crm).
10. **Attention discipline:** notify only when something needs the owner, once per task, never about what is already on screen (omnigent).

## What every one of them gets wrong for Chausar

- Each has an AI personality somewhere: a mascot (opendesk, omnigent), a violet or pink AI tint, whimsical working labels, rainbow buttons. Chausar's agents should be described by what they did, in the same ink as everything else.
- Each is far denser than 40 words at rest. Their density suits operators who live in the tool all day. Chausar's owner checks in; the at-rest screen should hold the few things that need them and fold the rest.
