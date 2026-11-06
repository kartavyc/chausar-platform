# Creator and marketing tools: what Chausar's frontend should learn

Written 21 October 2026 for the frontend rework. Six products where an owner reviews work an agent or a model made: video editors, a YouTube workflow, a clip studio and two social schedulers. Each was read from source (no installs, nothing run) and from the screenshots in the repos.

Clones live in the session scratchpad under `clones/<owner>__<repo>`. File paths below are relative to each clone.

Chausar's bar, for judging: minimal and quiet, no boxes or colour blocks, motion only when it says something, follows the computer's light or dark setting, 35 to 45 words on a screen at rest, plain product words, nothing that reads as "AI".

## The short version

- **Best UI in the set: BridgeClip.** It has a written design system (`DESIGN.md`) with rules Chausar can almost copy: "only failure earns a hue", "say what happened", "nothing loops just to decorate", compact by default, one accent used sparingly. Its job page and its approval card are the closest thing here to Chausar's "agent did the work, owner approves" loop. It is dark only and leans on glass panels, so take the rules and leave the materials.
- **Best copy and states: CogSend.** Every post state gets one plain sentence ("Sending now. Editing is paused until it's done."), every failure is rewritten into something a person can act on, and the URL holds the tab and filter.
- **Best money discipline: Open Edit.** It has no screen at all, but its quote, yes, spend flow (a quote that binds the script, price and account for one hour, refuses if anything moved, never charges twice) is exactly how Chausar should treat any agent action that costs money.
- **Best evidence model: YouTube Pro.** Every claim is labelled observed, inferred or "needs your own data", and a rewrite can't cite evidence that isn't in the snapshot. The look is the opposite of the founder's taste (cards inside cards, coloured blocks).
- **Diffusion Studio** shows a calm agent transcript (tool rows, one pinned question card, a shimmer that turns off for reduced motion) and live price estimates before you generate. It's a dense pro editor otherwise.
- **Postmill** has the most features (calendar, approvals, client preview links with comments, render queue) and the least restraint. AGPL, so learn only.

---

## 1. veedstudio/open-edit (Apache-2.0)

### Stack

There is no frontend. Open Edit is a TypeScript command-line tool plus an agent skill (`.claude/skills/open-edit/SKILL.md`, `FABRIC.md`, `VEED.md`) that Claude Code, Codex or Gemini CLI follows. The "interface" is the chat with the coding agent. Rendering runs HTML compositions in headless Chrome via `playwright-core` (`cli/src/render/browser.ts`, `cli/src/render/session.ts`). The only HTML it ships is the login success page (`cli/src/veed/login-success.html`: slow orbiting blurred blobs with grain, a decorative loop).

### Information architecture

The README says it plainly: "There is no GUI and no timeline." The owner asks in words; the agent hands back an MP4 path. When the owner wants to change things by hand, `veed-project` hands the piece to VEED's own editor as an editable project, and `veed-pull` brings a project back (`VEED.md`). So the architecture is: words in, file out, and a hand-off to a real editor for direct manipulation.

### How the owner reviews agent work

- **Contact sheets instead of full renders.** `frames <video> --at <sec,...> --sheet` and `render --stills 0.5,2,4 --sheet` tile chosen moments into one image (`cli/src/sheet.ts`). The owner judges a draft from a few frames before anything long is rendered.
- **Re-render only what changed.** `render --from --to` reuses the rest. Feedback is given on the delivered render in plain words ("make the yellow darker").
- **Quote before spend, as a binding contract** (`FABRIC.md`, `cli/src/veed/charge-records.ts`, `cli/src/providers/queue-ledger.ts`). Generation is two commands. The first prints the script, presenter, framing, which workspace pays, its balance and an estimate, and records the approval. The second spends only what was approved. The yes binds script, figure and workspace together for one hour; if any of the three drifts, the run refuses rather than charging something the owner never saw. When the cost depends on something unmeasured, it quotes a range and the agent must "repeat the range, never flatten it to its low end". A charged job is never charged again; an interrupted paid job is collected with `--resume`, which spends nothing.
- **Whose money.** With several workspaces it never picks; a remembered choice still has to be confirmed before spending.
- **Proposes, never decides.** `sample-presenter` suggests one presenter and a few alternates, costs nothing, and the yes to the quote covers the pick.

### Long-running jobs

The renderer "fails loudly on a page error, a blank render or a Chrome that did not start" and prints the reason. Any asset that failed to load counts as a wrong render. The charge ledger names four states (`resolved`, `charging`, `paid`, `orphaned`) so a lost connection never becomes a second charge.

### Design system and tone

None for UI. The talking rules in `SKILL.md` are worth more than any token file: "One line when you start, then the deliverable's path and a sentence or two on the result. No step-by-step progress and no internals." Report what was spent and from which account when delivering.

### Take

1. **The binding quote.** An approval in Chausar that costs money should freeze the exact thing approved (draft hash, amount, account) and refuse if any part changes before it runs. This matches the "never fake" and "AI never does arithmetic" rules: the figure comes from code, the owner says yes to that figure.
2. **Ranges stay ranges.** If the back office can only estimate, show "₹380 to ₹520", never the low end.
3. **Frames, not the whole thing.** For any long deliverable, show a few representative stills or excerpts at rest and load the full thing on request.
4. **"One line when you start, the result when you finish."** A direct template for how an agent row reads on Today.

### Avoid

1. A screenless product. Chausar's owner isn't a developer in a terminal; the review has to happen on a page.
2. The decorative looping blob background on the login page. It's exactly the "AI-ish" motion the founder doesn't want.

---

## 2. diffusionstudio/editor (MPL-2.0, ideas only)

### Stack

SolidJS 1.9 with `@solidjs/router`, Tailwind 4 with CSS variables (`apps/web/src/index.css`), Kobalte headless components (`@kobalte/core`) wrapped in a local library (`apps/web/src/components/ui/`), `cva` for variants, `cmdk-solid` command palette, sonner toasts, tRPC and Supabase for the cloud API, `koota` ECS for editor state, WebGPU (`typegpu`) for the canvas. Electron desktop shell in `apps/desktop`. The agent chat is its own package: `packages/agent-chat/src/protocol.ts` defines JSON frames over a WebSocket, where "the host owns all state; the UI is a view over a snapshot plus the events that follow it".

### Information architecture

Desktop: a projects dashboard (`components/dashboard/`: home, projects, AI credits, billing, invoices, MCP setup, settings) and then the editor: assets on the left, canvas centre, inspector right, multi-track timeline below, agent chat in a side tab (`apps/web/src/agent-chat/`). Screenshot `assets/desktop-screenshot.png` shows a dense pro layout: 11px type, dozens of controls, coloured timeline clips.

### How the owner reviews agent work

- Every edit the agent makes is written to real code, and every edit the person makes in the editor is too, "so the agent always sees the latest version". The person refines the agent's output directly instead of asking again.
- **One pinned question at a time** (`agent-chat/question-card.tsx`): "The one thing an agent can wait on: a multiple-choice question, pinned between the transcript and the composer. Answer, skip, or press Stop." Chat status has exactly three values: `idle`, `running`, `waiting` (waiting means a question needs the person).
- **Price before generating** (`components/genai/use-estimate.ts`): the price is fetched as soon as settings are chosen, before a prompt is typed, cached per request shape, and shown next to the Generate button.
- **Generation records** (`components/genai/use-generation-records.ts`): each generated asset keeps the job it came from, what it was asked and what it was charged, with Rerun and Reuse.

### Long-running jobs

Exports show a progress panel with Cancel (`context/export.tsx`, `sidebar-right/inspector/export-progress`). Failures become toasts with the error message as the description. Agent tool rows have three states: `running`, `done`, `failed`. While a tool runs, its muted label carries a highlight sweep (`agent-chat/activity.css`) that turns into plain text under `prefers-reduced-motion`; "Thinking" uses a fixed-width stepping ellipsis so the label doesn't jitter.

### Design system

Inter and JetBrains Mono, 6px radius, a 10 to 32px type scale with 11px body (very dense). Full light and dark token sets, but the app starts in dark (`ColorModeProvider initialColorMode="dark"` in `app.tsx`) with a manual switch in Preferences; it doesn't follow the OS by default. A single blue primary. Copy is short and neutral.

### Take

1. **Three agent states, one pinned question.** Idle, working, waiting for you. Whatever the agent needs from the owner sits in one fixed place, never buried in the scroll.
2. **The price sits beside the button before anything is typed.** In Chausar the number comes from the back office calculator with a receipt, not the model.
3. **Each output remembers its run** (what was asked, what it cost, rerun). This is the "work receipt" on a draft.
4. **Reduced-motion fallbacks written next to every animation**, and a fixed-width ellipsis so text never jumps.

### Avoid

1. The 11px, panel-dense pro editor. It's right for editors and wrong for an owner with 40 words on screen.
2. Defaulting to dark and making theme a preference. Chausar follows the computer.

---

## 3. AgriciDaniel/youtubepro (Apache-2.0)

### Stack

React 18, Vite, `wouter` routing, TanStack Query, shadcn/ui on Radix (`client/src/components/ui/`, about 50 primitives), Tailwind 3 with HSL variables (`client/src/index.css`), `framer-motion`, `lucide-react`, Express server holding the API keys. Workflow state in a React context saved to IndexedDB (`client/src/lib/workflow-context.tsx`, `workflow-storage.ts`). No streaming; plain fetches with typed, retryable errors.

### Information architecture

A left sidebar with "New Workflow", three tools that are really steps (Research, Script Writer, Thumbnail Creator, each with a check when done), and the eight most recent workflows. Routes: `/`, `/script`, `/thumbnail`, `/settings` (`client/src/App.tsx`). "There is no standalone Ideas screen": ideas live inside Research. Each workflow reopens on the step it was left at.

### How the owner reviews agent work

- **Claims carry their evidence** (screenshot `docs/images/research-ai-insights.png`). Every insight is sorted into Observed (visible in the public sample), Inferred (useful hypotheses) or Requires Studio (needs the owner's own analytics), with an "Evidence ledger: 9 claims" that opens the source-level trail. A note under the audience questions says plainly, "This is not Google People Also Ask data."
- **Results bound to a snapshot.** Insights are requested for one snapshot id, and a reply for an older snapshot is dropped (`pages/research.tsx` around lines 436 to 540). Ideas regenerate only when the snapshot changes.
- **Rewrites can't invent sources.** Regenerating a script section or paragraph must cite claim ids from the allowed set, or it's rejected: "Regeneration cited unsupported evidence claim" (`pages/script.tsx` lines 119 to 134). Paragraph-level rewrite, edit and undo or redo.
- **Explicit move forward.** "Select one idea, then explicitly proceed to Script Writer."
- **Thumbnail review** (`docs/images/thumbnail-creator.png`): the form on the left, the preview on the right with Download, New version and Create a variation, and which model made it written under the image.
- "Filters are drafts until you select Search. Changing them does not spend YouTube API quota." A quiet line that tells the owner nothing has cost anything yet.

### Long-running jobs

Skeleton grids for ideas and video cards (`components/video-card-skeleton.tsx`), errors with a retryable flag and a retry. No queue or background jobs.

### Design system

shadcn defaults with a terracotta primary, Inter, `.5rem` radius, shadows set to zero. Theme provider supports light, dark and system but defaults to dark (`components/theme-provider.tsx`). Visually it's busy: stat tiles with coloured icon circles, tinted green, amber and blue blocks for evidence balance, cards inside cards, an orange full-width primary button. The empty state is the standard icon-in-a-circle, title, sentence, action.

### Take

1. **Observed, inferred, needs your data.** Chausar's "never fake a capability" rule wants the same three labels on anything an agent claims about the business. Shown as words beside the claim, not coloured blocks.
2. **Answers tied to the input they came from.** If the order or files change, a draft made from the old ones is marked out of date, never silently shown as current.
3. **"Nothing has been spent yet" lines.** One quiet sentence under any control that might cost money or quota.
4. **Explicit step forward** after picking one option, with the earlier choice kept and reopenable.

### Avoid

1. Evidence balance as three tinted panels with big numbers, and four KPI tiles across the top. That's the box-and-colour-block look the founder rejects.
2. A dark default with a theme toggle in the header.

---

## 4. bridge-mind/bridgeclip (MIT, desktop)

### Stack

Electron 44 with `electron-vite`, React 19, Tailwind 3 mapped to RGB-channel tokens (`src/renderer/globals.css`, `tailwind.config.ts`), a small hand-built component library (`src/renderer/components/ui/`: Button, Callout, Dialog, EmptyState, Field, ProgressBar, ProgressRing, Segmented, SettingRow, Skeleton and so on), Zustand stores (`src/renderer/store/`: jobs, posts, drafts, assistant, settings, sidebar). Transport is Electron IPC from a main-process job manager (`src/main/job-manager.ts`, `pipeline-runner.ts`) and a Python clipping engine (`engine/`). Publishing goes through Zernio (`src/main/zernio/`).

### Information architecture

Seven places with keyboard shortcuts (`DESIGN.md` layout diagram): Studio group (Create, Library, Jobs, Chat) and Workspace group (Accounts, Posts, Automations, Settings). Collapsible sidebar (200px or a 72px icon rail), a running-job card in the sidebar, a setup status and version in the footer. Pages have width presets: focus 720 for progress and failure, narrow 880 for settings and posts, wide for media grids. Create is a five-step wizard with the actions pinned to the bottom.

### How the owner reviews agent work

- **Run page** (`resources/social/bridgeclip-app-demo.png`): title, when it was made, a stats bar (clips, source length, processing time, API cost with a per-stage breakdown), then clips sorted "Best first" or "Timeline". Each clip card: the media (which is the play button), a score chip, a title, its time range and framing, and a few tags. Numbers count up once.
- **Approval card in chat** (`components/assistant/MessageView.tsx` `ApprovalCard`): an amber rim, the details as plain lines, one primary **Allow** beside a ghost **Don't allow**. A tool waiting for approval shows a shield icon and "Waiting for you"; the chat list shows an amber dot on that chat.
- **Publish review** (`components/AutomationTikTokReviewDialog.tsx`): the caption is editable, platform rules are checked inline, and the owner must tick that they watched the preview before Approve works (`previewConfirmed`).
- **Draft metadata preview** (`components/MetadataDraftPreview.tsx`): per platform title, caption, tags, then a collapsed "Context and research" with the sources and the prompt used. It opens itself when research was unavailable, and says "no description was assumed" instead of making one up.
- **Posts** (`docs/assets/posts-page.png`): Scheduled and Recent as two headed lists, one row per post, per-account chips with status ("@insta · Scheduled", "@channel · Published ↗"), Reschedule and Cancel as text actions, and one footer line: "Zernio publishes scheduled posts even when BridgeClip is closed."

### Long-running jobs

The most complete pattern in the set (`DESIGN.md` "Long work", `components/JobTimeline.tsx`, `StageBreakdown.tsx`, `JobProgress.tsx`, `JobDiagnostics.tsx`). Up to two jobs run, the rest queue in order. Jobs shows Active (a small progress ring or queue position, stage, elapsed time, Cancel) above Previous (one line each: status dot, title, clips, run time, cost, date). Opening a running job shows every stage with its own bar, the active stage's current work, and a time strip of where the time went. "Unmeasured work stays indeterminate"; older workers show an explicit "measurement unavailable". Failures show the engine's actual message and a next step, plus Run again.

### Design system

`DESIGN.md` is the best document in the set. Rules worth quoting in spirit: layers, not boxes; one solid accent used for the primary action, chosen option and live progress only; "Only failure earns a hue" (red broke, amber needs a look, green ready); "Say what happened" with the real message and a fix; Geist and Geist Mono with mono tabular figures for anything that changes or lines up (costs, times); 13px UI text; compact spacing with explicit bans on `p-6` and `mt-8`; motion 150 to 200ms, pages fade in with a 6px rise once, "Nothing loops just to decorate"; reduced motion and reduced transparency both honoured; Settings autosaves with a "Saved" pill and no Save button. But it's dark only (`--canvas: 7 8 12`), the materials are translucent "glass" panels with rims and shadows, and the comparison claims ("5× faster than OpusClip") are marketing inside the product.

### Take

1. **"Only failure earns a hue."** Ink and grey for everything; amber for "waiting for you", red for "broke", green for "done". It fits the founder's ink-and-grey spec almost word for word.
2. **The job pattern: Active above Previous, a stage list when opened, honest "indeterminate" when unmeasured.** Chausar's agent runs and back office jobs can use it as is, minus the rings.
3. **The approval shape: details as plain lines, one primary Allow, a quiet Don't allow, and "Waiting for you" mirrored wherever that work appears** (Today, the client, the agent).
4. **"I watched it" before approving a publish.** For anything that leaves the business, the Approve control unlocks only once the owner has opened the preview.
5. **Mono tabular figures for money and times, and a one-line footer that says what keeps running when the app is closed.**

### Avoid

1. Glass panels, rims, blur and the dark-only canvas. Take the rules, not the materials: Chausar draws hairlines and space, not surfaces.
2. In-product brag lines and score chips ("Top pick 9.4", "94% less than OpusClip"). Scores invented by a model and competitor claims are both off-tone, and a model-made score is a number the AI produced.

---

## 5. postmill-ai/postmill-app (AGPL-3.0, learn only)

### Stack

Next.js 16 with React 19 in a pnpm monorepo (`apps/frontend`, `apps/backend`, `libraries/`). Tailwind 4 plus SCSS variables (`apps/frontend/src/app/colors.scss`, with `.dark` and `.light` sets), Mantine 9 for dates and parts of the UI, SWR for data, Zustand for the composer store, Tiptap rich text, Uppy uploads, `dayjs` for time zones, CopilotKit for the agent chat, `socket.io-client` only for the AI designer (`components/media-tools/ai-designer/use-ai-designer-socket.ts`). The original Gitroom screenshots in `.github/assets/` are out of date (purple starfield marketing).

### Information architecture

A large app: dashboard, posts calendar (`components/launches/calendar/`: day, week, list views), campaigns with drafts, files, KPIs and a planning workspace (`components/campaigns/dashboard/`), comments and replies inboxes, analytics, agents (`app/(app)/(site)/agents/[id]`), a media area with a page per AI provider (about 30 routes under `media/`), a render queue (`media/queue`), billing, settings, and a public preview route (`app/(app)/(preview)/p/[id]`) where a client can view a post and leave comments without an account (`components/preview/comments.components.tsx`).

### How the owner reviews agent work

- **Drafts with an approval status** (`campaign-drafts-section.tsx`): pending, approved, rejected, shown as amber, green and red pills.
- **Outward actions never run from the agent.** In `components/agents/agent.chat.tsx` (around lines 470 and 750), comment replies and paid media generation only ever return `needsConfirmation` with a draft; the UI shows a confirm card with the exact message and where it will go, and the click is "the trust boundary". Drafts coming from sub-agents are pulled out of nested results so none slips past.
- **Client preview link** with threaded comments, per post.
- **Calendar** with per-channel previews that imitate each network (LinkedIn, Facebook, Instagram, TikTok colour tokens in `colors.scss`).

### Long-running jobs

A render queue page filtered by status in the URL (`?status=failed`), with counts for pending, processing and failed in the last seven days, and "Nothing with that status" as the empty line (`components/media-tools/media-queue.spec.tsx`). Toasts for success and failure, with the server's guardrail reason extracted rather than the HTTP status text.

### Design system

Mixed: SCSS variables, Tailwind utilities with pixel values in brackets (`rounded-[10px] p-[14px] text-[13px]`), Mantine. Dark and light exist with careful contrast notes in comments. Dense, many borders, many colours (promo purple, badge pink, priority reds and oranges).

### Take

1. **Agents draft, people send.** Every outward tool returns a draft that needs a click, enforced in the client and the server, including drafts produced by sub-agents.
2. **A shareable preview link for a client to look and comment**, without an account. Chausar's client portal could start here.
3. **Queue filtered by status in the address bar**, with counts and a one-line empty state.

### Avoid

1. A page per model provider and 46 media tools in the nav. Chausar's model choice belongs in one Connections place.
2. Coloured pills, borders and bracketed pixel values everywhere: the opposite of quiet.

---

## 6. cogsend/cogsend (MIT)

### Stack

SvelteKit 3 with Svelte 5 runes on Cloudflare Workers, Tailwind 4 (`src/routes/layout.css`), Lucide icons, Drizzle on D1. A handful of local components (`src/lib/components/`: Editor, ConfirmDialog, PostStatusBanner, MediaPreview, LinkPreview, Toast). Status is refreshed by polling (`src/lib/domain/poll.ts`, `publish-tracker.svelte.ts`): every few seconds while anything is sending, every half minute while a platform processes video.

### Information architecture

Six places: Compose, Posts, Insights, Accounts, then Settings and API in a menu (`src/routes/`). Posts has tabs All, Scheduled, Published, Failed, Drafts with counts; tab, account and search live in the URL, and coming back from editing returns you to the same view (`docs/posts.md`).

### How the owner reviews agent work

Agents reach it through MCP to draft, schedule and publish with the owner's key. In the app:

- **A thread is a list of cards**, each with its own counter that uses the strictest limit of the chosen accounts, plus a tab per platform for tailored versions (`docs/composer.md`).
- **One card per post, one result per account.** "A post that published on four and failed on one shows exactly that." Retrying retries only the failed accounts.
- **What went out can't be edited.** A fully published post opens read-only with "Duplicate to post again".
- **Actions follow state** (table in `docs/posts.md`): Scheduled offers Edit, Reschedule, Cancel; Failed offers Edit and re-draft, Post again, Retry; Published offers Post again; Draft offers Edit, Duplicate, Remove.
- **Save state in words**: "Saving…", "Saved", or "Not saved" with Retry, and failed saves retry on their own.

### Long-running jobs

`PostStatusBanner.svelte` writes status as sentences: "Sending now. Editing is paused until it's done." "X is processing the video, it publishes on its own." "Scheduled for 3:40 PM on Mastodon, Bluesky." "Published on A. Retrying on B. Failed on C." with a link to the right tab. Retryable failures back off up to five times before landing in Failed. A send that stops answering is given up after seven minutes and returned to a state with actions. `src/lib/domain/human-error.ts` rewrites known failures into instructions ("That connect attempt expired, a connect link is good for N minutes. Press Connect new and try again.") and never echoes raw server text for a server error, since it might leak internals.

### Design system

Light only, stone greys, system font, `#fafaf9` background, a black focus ring for keyboard users only, `prefers-reduced-motion` cuts all animation. Rounded pill buttons with a hairline border. Plenty of bordered cards, but restrained colour. Copy is the best in the set: short, specific, never cute.

### Take

1. **Status as one plain sentence per state**, naming who and when, with a link to where it can be acted on. This is how Chausar's Today rows should read.
2. **Per-account (per-client) results inside one item**, and retry only what failed.
3. **Sent things are frozen.** An approved and sent invoice or message opens read-only with "Make a copy". This matches the receipts engine.
4. **A failure dictionary**: known failures become instructions; unknown server errors become a plain failure without leaking internals.
5. **View state in the URL**, so reload and back return the owner exactly where they were.

### Avoid

1. Light only. Chausar follows the system.
2. The bordered stone card around every status banner and post. Same words, no box.

---

## Across the set: what Chausar should build

| Need | Best example | Chausar version |
| --- | --- | --- |
| Approve a draft | BridgeClip approval card; Postmill "agents draft, people send" | Plain lines of what will happen, one primary Approve, a quiet "Not this", and Approve unlocked only after the preview was opened |
| Money before action | Open Edit binding quote; Diffusion price beside the button | Back office computes the figure with a receipt; the yes freezes draft, figure and account; refuse on drift |
| Long work | BridgeClip Jobs | Working above Done, stages as lines with honest "not measured", real failure text and Run again |
| Status words | CogSend banner | One sentence per state, naming who and when, linked to where to act |
| Claims | YouTube Pro evidence labels | Seen, inferred, needs your data, as words beside the claim |
| Waiting for you | Diffusion pinned question; BridgeClip "Waiting for you" | One fixed place on Today, mirrored on the client and the agent |
| Design rules | BridgeClip `DESIGN.md` | "Only failure earns a hue", no decorative loops, mono figures, autosave with "Saved" |

## Licences

Open Edit (Apache-2.0), YouTube Pro (Apache-2.0), BridgeClip (MIT) and CogSend (MIT) can be borrowed from with attribution. Diffusion Studio is MPL-2.0: file-level copyleft, so take ideas, not files. Postmill is AGPL-3.0: learn only, copy nothing.
