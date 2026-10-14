# Lane learning-ext: the learning loop and the self-improving dictionary

Branch `claude/lane-learning-ext`. Spec: architecture piece 13 (the learning loop and the training ladder) and piece 5 (the answer key), plan days 1, 2, 4 and 8, design screens FR-10 and TR-11, and EvoOntology (arXiv 2609.15779).

This lane adds engine methods only. It draws no screens. The Sharing screen (TR-11, owned by reports-tools-trust), the Accounts and Meanings screens (work-books) and the approvals queue (work-books) call the methods below.

## What a person can do

1. **See every decision the product learned from.** The decision log keeps each mapping, identity, accounts-label, action, procedure, calculation and dictionary-edit decision on this computer. Each decision is a structural event made only of registered words, such as kind, choice, reason, system family, report shape, field names and types, and account class. A name, a value, an amount or free text cannot enter an event, because the event builder refuses any word outside the vocabulary. No word in the vocabulary contains a digit.
2. **Open the exact file before anything is shared.** The preview builds the batch's exact bytes: canonical JSON, one event per line. It shows the byte count, the digest and the event count, with "0 names, 0 amounts". It scans every event line for a GSTIN, PAN, IFSC code, UPI id, mail address, phone number or any digit, and a hit blocks the batch and shows its line.
3. **Agree to exactly those bytes, inside the app.** Consent needs the sharing switch on (`learning.sharing`). It binds the digest and is refused on the phone, over MCP, or from a context that read outside text. Submitting rebuilds the bytes from the log; if anything changed, the consent is void.
4. **Send once, and settle an uncertain upload.** A batch is reserved, then sent once. A lost connection records `unknown` and is never re-sent on its own. `learningx.settle` re-sends the identical bytes under the same idempotency key, and the intake treats that as a replay, not a second batch. A decision already in a sent batch cannot be sent again.
5. **See what was shared, delete it, or withdraw.** "What I shared" lists each batch with its date, size, count and status, plus a running line of events shared, names (0) and amounts (0), and credits under a public name or none. Delete removes a batch from the server using a deletion token the desktop generated. Withdraw turns sharing off and voids unused consents.
6. **Know when sharing is closed.** Without a configured intake: "Sharing is not open yet. Nothing is sent." In a demo workspace the target is a local test inbox, labelled "Demo test: sends to a test inbox only". The boxes "account words" and "question shapes" exist but stay closed (`BOX_NOT_OPEN`) until the founder's switch and a lawyer's reading of the consent text. No feature depends on any box.
7. **Clean a sample file on this computer.** Name, GSTIN, PAN, phone, mail, IFSC and UPI columns are swapped for made-up values of the same shape. Free-text columns are scanned, and an identifier left there blocks the file and shows its line and column. The cleaned file stays in the local outbox. Uploading samples waits for a reviewed receiving service.
8. **Get a recipe from similar past setups (ladder step 1).** The lookup ranks the base recipes, the recipes of imports on this computer that reproduced their source totals, and recipes the owner saved. It scores shared column names plus the system family.
9. **Get only proposals that follow the mapping language (ladder step 2).** Every proposal, whether adapted from the library through Indian export synonyms (Voucher No, Party Name, Total, Narration and so on) or handed in by a model, passes a pure grammar check. The check follows the same rules as `sources.preview`. Forbidden keys reject the whole recipe. A binding to a column the file lacks, an unknown dictionary word, a type mismatch, an ambiguous date or an ambiguous amount is removed and named. Missing required bindings are listed as the question to ask. A test proves that whatever the grammar accepts, the import accepts.
10. **Sort the chart of accounts into classes, with evidence and confidence.** Tally groups weigh more than name words, and English and Hindi or Hinglish keywords are recognised. Model proposals are merged as evidence. Disagreement, a model as the only evidence, or weak evidence marks the account "needs a question". The owner or the accountant decides. Each decision is a structural event with the class, the proposed class, the confidence, the evidence kinds and the choice, never the account's name. A hand-labelled key gives right, wrong and not sure counts. On the 42-account fixture the pass bar holds: no account was sorted wrong and accepted without a question. Decided classes come out as a Tally recipe's `tallyLedgerClasses`.
11. **Export a labelled dataset (ladder step 3, preparation only).** JSONL rows of cleaned account words, group words, label and grade, with a manifest marking the 20,000-label readiness bar and `leavesMachine: false`. Nothing is trained.
12. **Let other assistants read the dictionary, read-only, in three layers.** The existing MCP server (`/mcp`) now also serves `dictionary_schema`, `dictionary_samples` and `dictionary_operations`; the same layers are available as `dictionary.mcp.*`.
    - The schema layer gives fields, definitions and checks.
    - The samples layer follows the send level. At "nothing" every field is withheld. At "shape" it gives masks only. At "samples" it gives up to five visible values, with identifiers masked.
    - Missing fields are reported in words ("absent", "not loaded yet").
    - Money fields show shapes only at every send level, because amounts leave only through `calculate` with a receipt.
    - The operations layer gives the calculation menu and a read-only statement.
13. **Get a first dictionary proposed from imported files (EvoOntology builder).** Columns are profiled and the starter pack is chosen by evidence. The draft must compile. It is adopted only after it passes the answer key, and only through `ontology.publish`.
14. **Get small typed dictionary edits that have passed the hand-worked answer key (EvoOntology self-evolution).** Edits are proposed from repeatedly unmapped columns, record kinds without a definition, mapping corrections, or a model.
    - Each edit runs before and after on the answer key in an in-memory sandbox. An edit is shown for review only if every case passes and none regresses. Failed edits are kept as `failed-answer-key` and are never offered.
    - The owner approves every edit, in the app, bound to its digest. Approval re-runs the key and refuses a stale base (`EDIT_STALE`).
    - The scheduled loop proposes, at most once a day, only while autonomy is on, and never publishes.
    - The default answer key is the demo fixture with hand-worked values, written as strings.
15. **A receiving service for shared structure** in `hosted/learning-intake/`, written and tested, not deployed. It re-validates every batch against its own copy of the vocabulary and scans for values. It stores batches with credits (memory and PostgreSQL stores, `schema.sql`). It is idempotent per key, deletes by a hashed deletion token, and lists credits under a public name or none.

## Engine methods

Every method is in `platform/runtime/modules/lane-learning-ext.ts`, listed in `app/desktop/module-methods/learning-ext.json`, with code in `platform/runtime/learning-ext/`.

| Method | Permission | Purpose |
|---|---|---|
| `learningx.record` | prepare | Log a structural decision. Other lanes (jobs-ext procedures and runs, writeback actions, work-books identity matches) call this. Payload `{ event, sourceIds?, refs? }`, where `event` uses only `vocabulary.ts` words. |
| `learningx.log`, `learningx.summary` | read | The log, paged and filtered by kind, merged with the engine's import decisions; counts by kind and choice. |
| `learningx.intakeStatus` | read | Mode (closed, test-inbox, intake), the switch, and the boxes with their reasons. |
| `learningx.preview` | admin | Exact bytes for the chosen boxes. |
| `learningx.consent` | admin, app only | Bind the previewed digest. |
| `learningx.submit`, `learningx.settle` | admin, app only | Send once; settle an `unknown` outcome. |
| `learningx.batches`, `learningx.batch` | admin | What I shared, the running line, credits. |
| `learningx.deleteBatch`, `learningx.withdraw`, `learningx.creditName` | admin, app only | Delete from the server, withdraw sharing, set or clear the public name. |
| `learningx.cleanSample`, `learningx.outbox`, `learningx.outboxDelete` | prepare / read / prepare | The local cleaner and outbox. |
| `learningx.recipeLookup`, `learningx.recipeCheck` | read | Ladder step 1; the grammar check alone. |
| `learningx.recipePropose`, `learningx.recipeSave`, `learningx.recipeForget` | prepare | Ladder step 2 proposals (logged); keep or forget a library recipe. |
| `learningx.accountsPropose`, `learningx.accountsDecide` | prepare | Accounts sorting; decisions by the owner or the accountant. |
| `learningx.accountsList`, `learningx.accountsScore`, `learningx.accountsClasses` | read | Sets, the score against a hand-labelled key, and the Tally class map. |
| `learningx.labelDataset` | admin | Ladder step 3 export. |
| `dictionary.mcp.info`, `.schema`, `.samples`, `.operations` | read | The three layers. |
| `learningx.dictionaryBuild`, `learningx.dictionaryProposals` | prepare / read | The builder agent. |
| `learningx.dictionaryAdopt` | admin, owner, app only | Adopt a first dictionary after the answer key. |
| `learningx.answerKey`, `learningx.answerKeySet` | read / admin, owner, app only | The hand-worked key; replace it or reset to the default. |
| `learningx.editsPropose`, `learningx.edits` | prepare / read | Typed edits gated by the answer key. |
| `learningx.editApprove`, `learningx.editReject` | admin, owner, app only | The owner decides each edit; publishing goes through `ontology.publish`. |

Refusal codes a screen can tell apart (on the lane's line of `laneRefusals` in `app/desktop/preload.cjs`): SHARING_DISABLED, BOX_NOT_OPEN, NOTHING_TO_SHARE, PREVIEW_CHANGED, SHARING_BLOCKED, CONSENT_REQUIRED, BATCH_ALREADY_ATTEMPTED, INTAKE_NOT_OPEN, DELETE_UNKNOWN, APP_CONSENT_REQUIRED, NO_LIBRARY_MATCH, RECIPE_GRAMMAR, ANSWER_KEY_FAILED, EDIT_STALE, APP_APPROVAL_REQUIRED, DICTIONARY_REQUIRED, PROPOSAL_STALE, ALREADY_DECIDED, EDITS_PENDING, OWNER_REQUIRED.

Trusted host options (`modules['learning-ext']`, or `hostOptions` from the environment; never an RPC payload): `intake: { url, transport?, timeoutMs? }` opens production sharing; the URL must be HTTPS, or loopback for local runs. `founderSwitch: true` shows the two closed boxes, which still refuse.

Purge: deleting or revoking a source removes the decisions, account sets, saved recipes, sharing previews, builder proposals and edits derived from it.

## Supported and experimental

| Feature | Label | Why |
|---|---|---|
| Decision log, `learningx.record`, log views | supported | Tested through the engine dispatch on synthetic data, including purge on source deletion. |
| Consent preview, consent, demo test inbox, What I shared, withdraw | supported | Tested end to end in the engine. |
| Sending to the intake, settle, delete on the server | experimental | Tested against the real intake service on loopback. No intake is deployed. |
| Sample cleaner and outbox | supported | Local only; upload deliberately not built. |
| Recipe lookup and grammar-constrained proposals | supported | Lookup ranks by column overlap. Retrieval quality is unproven while the library is small (the plan also labels it experimental). |
| Chart-of-accounts sorting | experimental | Rule and model evidence is tested against a 42-account fixture. The AI route itself is supplied by the caller. |
| Label dataset export | supported | Preparation only. |
| Dictionary over MCP in three layers | supported | Tested with a real MCP session through the engine. |
| Builder agent, answer key, self-evolution edits | experimental | Deterministic profiler and evidence rules. A model candidate is accepted only through the same gates. |
| Hosted intake service | experimental | Written and tested, not deployed. |
| Model routes for accounts sorting and dictionary edits | experimental | Tested through the gateway against a fake provider on this computer; no live provider. |
| Recipe library inside connector import previews | supported | Tested through connectors-ext previews, commits and discards. |
| Retention and log clearing | supported | Tested through the engine's retention cleanup. |

## Round 2 (coordinator review)

- **Retention.**
  - Lane purges honour the engine's retention `cutoff`. When workspace retention cleanup runs (`TrustService.cleanup`), account proposal sets, outbox samples, dictionary proposals and edits, previews and log decisions older than `retentionDays` are removed.
  - Import decisions merged into the log are filtered by retention too.
  - The owner can clear the local log (`learningx.logClear`, admin, owner only, inside the app).
- **Model routes** (`platform/runtime/learning-ext/models.ts`). Accounts sorting and dictionary edits can call a route the owner chose, through the core `ModelGateway`:
  - **Choosing the route.** `learningx.modelRouteSet` is owner only, inside the app. The choice is bound to the route's revision and endpoint, so a reconfigured or disabled route stops working until the owner chooses it again. `learningx.modelRoute` (read) shows the current choice.
  - **Building the request.** `learningx.accountsAsk` and `learningx.editsAsk` build the request under the send level:
    - At "nothing" there is no request.
    - At "shape", accounts go only as aliases with Tally group labels and keyword-table words, and dictionaries as field names, types and the structure of each definition.
    - At "samples", names and meanings are added, with identifiers masked.
    - Each call returns the gateway's exact payload preview.
  - **Approval.** The owner approves that exact payload with `models.approve`. A tainted context cannot approve.
  - **Running it.** `learningx.accountsAskRun` and `learningx.editsAskRun` make a single attempt. Every attempt leaves a gateway receipt.
  - **Checking the output.** The output is checked strictly before anything is applied:
    - Account proposals must have known aliases and classes from the vocabulary. They are then merged as model evidence, so disagreement means a question.
    - Edits must pass `assertEdit` and `applyEdit`, then the answer-key gate.
    - Every refusal is a typed "not yet", with nothing applied in part.
  - Tested against a fake provider on this computer.
- **Recipe library inside connectors:** see Core edits below.
- **Intake behind a proxy.** `trustedProxies` (`INTAKE_TRUSTED_PROXIES`) is a list of proxy addresses. The rate limit counts the right-most `X-Forwarded-For` address that is not a trusted proxy, and only when the request came through one of them.
- **Consent text.** `docs/lanes/learning-consent-draft.md`, for the founder's lawyer. The two extra boxes stay closed (`BOX_NOT_OPEN`).
- **Fixes from the smuggling review:**
  - Batches go out in canonical order, so the order of decisions carries nothing. The preview shows how many decisions each person recorded.
  - The public name is fixed when consent is given.
  - The intake accepts only the desktop's batch identifier as the idempotency key, and only an ASCII public name.
  - Sample masking normalises fullwidth and other look-alike characters first, and masks numbers written with spaces or dashes and spelled-out mail addresses.
  - The builder refuses column titles that contain a number or an identifier.
  - At send level "nothing", `dictionary_schema` withholds the names of fields the owner added.
  - A residual covert channel remains: the *count* of each distinct event in a batch. Anyone who can record decisions could encode a few bits per batch through counts. It is bounded by the per-person quota, the author counts shown in the preview, and owner consent.

## Core edits

- `platform/runtime/gateway.ts` (additive): `GatewayTask` and `previewTask(ctx, task)`, a structured task from in-process code only, always previewed and owner-approved. `execute` also gains an overload with a `{ validate }` argument: a task preview runs only with its validator, and the output must pass the validator before the receipt completes. The existing RPC `preview` is unchanged.
- `platform/runtime/mcp.ts` (additive): a new type `RegisteredReadTool`, an optional `readTools` constructor option, and `registerMcpReadTools(provider)`.
  - These tools are number-free and read-only, with closed schemas and unique names. They are listed with the existing read-only annotations, and each call re-authorizes after the read.
  - The lane module registers the dictionary layers when it loads, so `engine.ts` is unchanged.
- `platform/tests/acceptance.test.ts` and `platform/tests/mcp-receipt-public-acceptance.test.ts`: their exact MCP tool-name lists now include the three dictionary tools.
- `app/desktop/preload.cjs`: the lane's own `laneRefusals` line.
- `platform/runtime/connectors-ext/service.ts` (connectors-ext is closed; a few calls into `learning-ext/connectors-bridge.ts`):
  - `connectorsx.importPreview` consults the recipe library first (ladder step 1). It ranks the library's similar past setups and the registered connector recipes for the same input against the file's column names, and returns them as a new `library` field: `suggestions` (top three with score, origin and passed-tests flag), `chosen` (the picked recipe's rank and score) and `agrees`. A reconciled import made by a connector recipe is scored by that recipe's headings.
  - In the same transaction as the envelope, following the top suggestion logs mapping/proposed (`library-match`); picking another recipe logs mapping/corrected (`owner-override`).
  - `connectorsx.importCommit` logs mapping/accepted (`library-match` when the preview followed the library, otherwise `reconciliation`), and `connectorsx.discard` of a waiting import logs mapping/rejected, each in the transaction that changes the envelope.
  - Events carry the system family (connector group mapped to `SYSTEMS`, else `other`), the report shape and the canonical output fields only, with the source id and envelope (and import) id as references, so source deletion purges them. Logging is best effort and never changes a connectors-ext result or refusal.

## Installed app wiring

`learningExtModule.hostOptions` builds the trusted options from the engine's environment, so `main.cjs` needs no edit:

- `CHAUSAR_LEARNING_INTAKE_URL=https://…` opens production sharing to that intake. It is ignored in demo, and an address that is neither HTTPS nor this computer is refused (`INTAKE_MISCONFIGURED`).
- `CHAUSAR_LEARNING_FOUNDER_SWITCH=1` shows the two closed boxes, which still refuse.

Without the intake variable, the app shows "Sharing is not open yet. Nothing is sent."

## Still missing (founder boundaries and later work)

- **Deploying the intake:** a domain, a certificate, hosting and its PostgreSQL. The founder decides. Until then `INTAKE_NOT_OPEN`.
- **The consent text and the two further boxes** (account words, question shapes) need a lawyer's reading and the founder switch. Until then `BOX_NOT_OPEN`.
- **Uploading cleaned samples** waits for a reviewed receiving service. The outbox keeps them on this computer.
- **Ladder step 3 training** needs about 20,000 checked labels, and step 4 waits until it beats step 1 on hidden tests. Neither is built.
- **The recipe library holds only this computer's recipes and the base set.** A shared library across businesses needs the deployed intake and a reviewed qualification step.
