# Venture launcher: build and connectors (P4)

This package writes the build brief, checks it, opens it in Lovable or Replit (or copies it for Bolt and v0), follows the result on GitHub read only, and lists 66 connectors with labels that match what the code does today.

Code: `platform/runtime/venture/build/`. Tests: `platform/tests/venture-build.test.ts` and `platform/tests/venture-connectors.test.ts`. Fixtures: `platform/tests/fixtures/venture/build/` (both are synthetic recordings).

## Methods

| Method | Level | What it does |
| --- | --- | --- |
| `venture.build.brief { useTemplate? }` | prepare | Writes a new brief version from the accepted plan and stores it with its lint result. Emits `brief-ready`. |
| `venture.build.handoff { builder }` | prepare | Plans a Lovable or Replit link, or a copy for Bolt and v0. Stores the URL's digest, never the URL. Emits `handoff-prepared`. |
| `venture.build.handoffOpened { handoffId }` | prepare, app only | Marks the handoff opened the first time. The renderer sends it only after the browser opened the link or the copy worked. Emits `handoff-opened` once. |
| `venture.build.link { repo, token? }` | admin, app only | Follows one GitHub repo. A token must be fine-grained (`github_pat_`) and lives only on the secret shelf. Emits `repo-linked`. |
| `venture.build.sync {}` | prepare | Reads GitHub (at most nine GET calls), stores a read receipt and the status. Emits `repo-synced`. |
| `venture.build.status {}` | read | The follow record, the latest brief, handoffs newest first, and the token link. |
| `venture.connectors.list { category?, starterOnly? }` | read | The 66 connector cards, starter cards first, with posting modes on the social and video cards. |

## The brief

Code puts the brief together in a fixed order with eleven sections. The words in sections 1, 2, 4, 7 and 10 come from the model port, or from built-in template words for the service type when no AI serves the main tier or `useTemplate` is set. Model words go through `modelWords`: no digits, currency signs, percent or size words, except tokens such as B2B that the owner typed in the idea. The model gets only plan words (name, one line, customer, offer names and descriptions, step titles, country name). It never sees an amount or anything about a client.

Prices in section 3 are copied from the `total` figure of the newest current price receipt for each offer of the accepted plan (same plan digest, not stale). A priced offer without one refuses `PRICE_REQUIRED` before any model call, so a priced offer is never written as "price to be set". An offer with no price at all is written as "price to be set".

`lintBrief` checks the first line, the brief id, the eleven headings (present, once each, in order, and no other `## ` heading), the eight required lines (four in section 5, four in section 7), the length cap of 9,000 characters, long dashes, house-style words, email addresses and phone-like runs, and that every currency amount in section 3 is a receipt figure. The handoff button is refused with `BRIEF_LINT_FAILED` while the latest brief fails.

## Builder links

- Lovable: `https://lovable.dev/#prompt=` plus the encoded brief. Lovable keeps the brief in the browser until the owner presses send.
- Replit: `https://replit.com/?stack=Build&prompt=` plus the LZ-compressed brief and `&referrer=chausar`, with a decode self-check. Replit receives the brief as soon as the page opens, and the notes say so. When the compressed brief is longer than 8,000 characters, Replit falls back to copy.
- Bolt and v0: copy only. No official link exists and a pasted link may start building at once.
- No URL ever carries `autosubmit` or any other send-at-once parameter. The engine opens nothing; the renderer opens the URL from the owner's click.

`lz.ts` is a clean-room TypeScript port of lz-string's URI-safe functions. It matches Replit's documented examples.

## Following the build on GitHub

The reader asks GitHub, in order, for the repo, the newest commits on the main branch, the branches, `AGENTS.md` (or `replit.md`), the UI lint workflow, the runs for the newest commit, and the deployments with the newest deployment's status. Every path part and query value is encoded, and a commit sha or deployment id is checked before it is used. Each response is digested into a `venture-build-read` record.

The status says who made the last commit from the logins GitHub verifies (never the free-text git author name), whether the brief marker is found, older or missing, whether the UI lint workflow is found or needs a fix, what the run named "UI lint" reported, a deployment address only from a successful https deployment status, and a sync conflict branch. It always lists what Chausar cannot see, and adds a line when the answers come from a synthetic recording.

`defaultGitHubTransport()` sends only GET requests to `api.github.com` with no redirects, a 15 second timeout and a 1 MiB cap. Conditional requests with ETags are planned, not built.

## Connectors

`CONNECTOR_CATALOGUE` holds 66 entries in 12 categories, ported from research R6 and rewritten in plain words. YouTube and a read-only bank account joined on 21 October. The modes in this build:

- Handoff available: Lovable and Replit (fixture-tested), Bolt, v0 and your own mail app (built-in).
- Read available: GitHub and TallyPrime (fixture-tested), Chausar CRM and the Chausar back office (built-in).
- Write available: Chausar CRM and the Chausar back office only.
- Everything else is planned. Every other vendor shows a planned handoff and a plain "Visit site" link that is not counted as a mode. Zoho Books reading is planned because it needs a sign-in path this build lacks. GitHub writing is planned: staged edits reach a repo only with a write grant and a writer, and this build has neither. The bank account is planned: no provider is linked.

### Posting modes (LinkedIn, X, Instagram, YouTube)

Each posting card has `postingOptions` (api, owner-browser-session, handoff, each with `status`, `risk`, `requires` and a `reason` when planned) and a `posting` summary: the first available option, else the owner-browser-session one.

- `api` is planned until the platform's review of the app is recorded (`CHAUSAR_APP_REVIEWED`) and a posting client exists. None ships, so it stays planned.
- `owner-browser-session` drives the owner's own signed-in browser on this computer, only when Playwright with Chromium is already installed; Chausar installs and downloads nothing. It is available for text posts on X and LinkedIn when present, marked as not yet checked against the live site, and always carries "The platform may restrict this account." Instagram and YouTube need a picture or video upload, which is not built. On the hosted web server it is planned.
- `handoff` is planned: `postHandoff` builds the link or text, but no screen opens it yet.
- Each post is proposed (`proposePost`), waits on Today as its own `connector` row (`connectorQueueRows`), and is approved or denied once (`decidePost`, or `decideConnectorRow` for `venture.queue.decide`). The journal goes described, approved (a claim committed before the browser starts), then applied, rejected or outcome_unknown. A timeout or crash is outcome_unknown and is never resent; the owner checks the platform and records what they found (`resolveUnknownPost`).
- Not built, on purpose: proxy or VPN rotation, changed user agents or anything else that hides the automation, and posting to accounts that are not the owner's.

### Bank, website edits, leads and clip rights

- `build/bank.ts`: statement import into BigInt minor units, a stable id per transaction (the bank reference, or a hash with a counter for identical twins) so a re-import never counts twice, consent with a visible end date, four unattended reads a day, and alerts sent only to the address the owner set in the app. Tested on synthetic statements in `platform/tests/fixtures/venture/connectors/`.
- `build/site-edits.ts`: stage an edit to one existing file, apply only the exact plan digest the owner reviewed, refuse if the file changed since review, read it back after writing, log each step, roll back the same way. A write that cannot be confirmed is needs-inspection and never retried.
- `customers/leads.ts`: a lead needs its source URL; an email is verified only by a passing MX lookup; the blocklist comes before every other drafting rule; agents only draft and the owner records each real send; every draft carries an unsubscribe line and the postal address (`LEADS_ADDRESS_MISSING` without it).
- `delivery/rights.ts`: the intake `rights` field (own footage, a licence or a creator clip programme with its reference); clipping steps refuse with `RIGHTS_REQUIRED` without it.

## How it was checked

- `node --check` on every file in the package and both test files.
- The pinned compiler (`typescript@5.9.3`, scratch install outside the repo) on `build/**` and both test files: no errors.
- `node --test platform/tests/venture-build.test.ts platform/tests/venture-connectors.test.ts`: 28 of 28 pass.
- `node --test platform/tests/venture-contracts.test.ts platform/tests/desktop-harness.test.ts platform/tests/desktop-ipc-methods.test.ts`: 29 of 29 pass.
- `platform/tests/venture-docs.test.ts` (P6's check of the Connectors table against this catalogue): 3 of 3 pass.

## Hand-off note

Done: everything in section 7 of the build spec, with the tests in 7.6.

Choices made where the spec left room (the integrator can reverse any):

- In copy mode, Lovable and Replit replace their first note with "Your brief is too long for a {builder} link, so Chausar copies it for you to paste." and keep the GitHub sync note, because nothing reaches the builder until the owner pastes.
- `venture.build.handoff` refuses `APPROVAL_STALE` when a newer brief exists or the accepted plan changed after the brief was written, so an old price never reaches a builder. `venture.build.brief` refuses `APPROVAL_STALE` when the accepted plan changes while the model writes.
- `brief`, `handoff` and `sync` check the `prepare` level before any model call or GitHub read, not only inside the write, so a reader can never start a paid call or a read.
- A link without a token removes any token for that repo from the shelf, and linking another repo drops the old repo's token. `venture.build.status` reports the live token state (`none` after a restart or a lock), and `sync` refuses `GITHUB_UNAUTHORIZED` ("Enter your GitHub token again") when the record says a token was given but the shelf no longer has it.
- Only the repo read can fail a sync. A later read that fails leaves its part as `not-checked`, `not-readable` or no deployment. An empty repo gives no last commit, `not-checked` marker and workflow, and `not-readable` checks. A deployment status without a date uses the sync time.
- The words `waiting-for-repo` and `repo-not-readable` are never produced by `sync`. The renderer can show `waiting-for-repo` before a repo is linked.
- When an offer's receipt is for more than one unit, section 3 reads "for {quantity} {unit}s" instead of "per {unit}".
- `venture.connectors.list` answers without a venture, with no starter cards.
- The `what` lines for the Chausar CRM and back office modes, the catalogue notes and the auth lines are written here, in plain words, and claim nothing this build lacks.

For the integrator:

- `node --check` parses a `.ts` file as CommonJS, without removing types, when no `import` or `export` comes before its first type annotation. `lz.ts` starts with a real import for this reason. A package file that starts with a typed function and no import will fail `scripts/check.mjs`.
- No git identity is configured in this checkout. This package committed with `git -c user.name=kartavyc -c user.email=263844514+kartavyc@users.noreply.github.com`, matching the earlier commits.
- I did not run the e2e test (Phase B rule). Steps 12 to 15 match this package's behaviour as tested here.

Not finished: nothing in P4's scope.

Contract changes needed: none. Wiring changes needed: none.
