# Lane ca-enterprise: the CA console and the enterprise frame (experimental)

> **Everything in this lane is experimental.** The full "Enterprise and CA console" design file
> is not in the repository. This lane builds from the design extract
> (`docs/specs/CHAUSAR-APP-DESIGN.md` §13, "the enterprise version and the CA console" parts 1–4
> and part 9, CA-01..CA-11) and the shell scaffolding already in `app/ui/src/app/places.ts`.
> Every feature below is labelled **experimental** for that reason, even where it is tested end
> to end on synthetic data.

## What a person gets

- **A client** (any desktop workspace), in Trust → *Your CA firm* (`trust/cafirm`): link the firm
  with the code from the firm's guide, read the consent wording, agree or withdraw, make a status
  card and see every field that would cross (dates, counts, states; no figures), save it as
  `chausar-status-<month>.json`, unlink. The same page can turn a workspace into a firm's console.
- **A CA firm** (ca-firm shell: Today, Clients, Work, Reports, Tools, Trust):
  - CA-01 Clients: the FirmTable with the four-square close strip, filters round-tripping to the
    engine, paging, "invited, not joined", open a client, add a status card (file or paste), and
    "fetch from the relay" (refused: no relay).
  - CA-02 firm Today, CA-04 Hand-over, CA-05 To co-sign, CA-06 Same step for many (results per
    client, held because messages to outsiders wait and there is no relay), CA-07 Library
    (structure only), CA-08 *Who opens which client* (`trust/clientaccess`), CA-09 Invite (one-time
    code shown once, guide in a sandboxed frame), CA-10 Questions, CA-11 Firm's name ("planned" price).
  - CA-03 inside a client: a banner ("<workspace>, a client of <firm>, seat until date").
- **An enterprise install** (enterprise shell): the shell kind, administrators and grant list from
  `caent.shell`; the lens on Today; the company switcher in the workspace menu; Company and its nine
  sub-places as an "out of service" table; Trust → Channels, Reviews (personas, grants,
  administrators, access reviews), Teams, Holds; Books → Companies; Trust → Edition (turn the
  company version on or off; listed in the desktop and enterprise shells). `WhoseControl`
  (Mine / My team / Everyone, persisted per list) is offered to other lanes' lists; Reviews uses it.

## What was built, item by item (all experimental)

| Item (ROUND4 "ca-enterprise") | Engine | Screen |
|---|---|---|
| `clients.*` status-only list (last read, close progress, awaiting, due next) | `clients.list` over imported status cards | CA-01 `clients` (FirmTable) |
| Stepping into a client with the seat it gave | `clients.open` (seat, ended seat, assignment) | open flow; `workspaces.switch` when the frame has it |
| Firm Today | `firm.today` | CA-02 bare `today` (ca-firm) |
| Work: co-sign, many, questions | `firm.cosign`, `firm.many.*`, `firm.questions` | `work/cosign`, `work/many`, `work/questions` |
| Reports: hand-over | `firm.handover` | `reports/handover` |
| Tools: library, invite | `firm.library.*`, `clients.add`/`clients.guide` | `tools/library`, `tools/invite` |
| Trust: people, firm name | `firm.people.*`, `firm.status`/`firm.name.set` | `trust/clientaccess` (lane sub-place), `trust/firmname`; authored `trust/people` stays the firm's own seats |
| Status crossing, consent | `castatus.*`, `card.ts` (closed schema, HMAC) | `trust/cafirm` |
| Enterprise lens | `enterprise.lens.*` | Today lens via host wiring |
| Company switcher | `enterprise.companies`, `company.set`, `group.set` | workspace menu; `books/companies` |
| Whose | `enterprise.whose.*`, `enterprise.teams.*` | `WhoseControl`; `trust/teams` |
| Company place sub-places | `company.overview` | `company` and its nine sub-places |
| Trust access, markings, retention, channels | `enterprise.access.*`, `enterprise.holds.*`, `enterprise.channels.*` | `trust/reviews`, `trust/holds`, `trust/channels`; access/markings/retention stay reports-tools-trust's People/See/Keep screens |

### How the client card is derived (no figures)

From the client's own workspace only: `booksReadAt` from imports, connector captures and
`connectorsx.freshness`; the close strip from `connectorsx.envelopes` + `connectorsx.freshness`
for the close month (bank = bank statements; GST = GSTR-1 and GSTR-3B; TDS = 26AS/AIS; trial
balance always `not-done`, as the engine has no trial-balance source); co-sign counts from
`books.meanings` drafts, `books.recipes` proposals and `accounts.list` proposed classes; questions
from the reports lane's "ask a person" files; hand-over from the CA pack in `reportsx.packs`
(GST match = GSTR-2B page, ageing = ageing page; TB, bank reconciliation and TDS match always
`not-ready`); due next from `reportsx.due`; seats from trust-ext core seats (no names). Each count
is `null` ("not known") when its source does not answer. The finished card passes `parseCard`.

## Typed refusals at the founder boundary

| What needs the founder | Refusal |
|---|---|
| The client-consent wording | `CA_CONSENT_WORDING_PENDING` until the wording is supplied as a trusted host option (`consentWording` or `consentWordingFile`, env `CHAUSAR_CA_CONSENT_WORDING_FILE`); a demo workspace uses a draft marked `draft-unapproved` |
| Hosting: a relay that carries status cards and many-client requests | `CA_RELAY_NOT_DEPLOYED` (`clients.statusFetch`; `firm.many.send` holds every row) |
| Chausar support access to an install | `ENTERPRISE_SUPPORT_ACCESS_NEEDS_FOUNDER` (Company → Support) |
| The licence | `ENTERPRISE_LICENCE_NEEDS_FOUNDER` (Company → Licence) |
| The firm's price per client file | shown as "planned" (CA-11) |

Not founder items, but not this lane's to enforce: legal holds refuse `ENTERPRISE_HOLDS_NOT_ENFORCED`
(retention enforcement is core-data's); the server's sign-in settings are outside the engine
(`ENTERPRISE_SERVER_ONLY`); combined group figures with eliminations are `not-built`.

## Engine and screen files

- Engine: `platform/runtime/modules/lane-ca-enterprise.ts`, `platform/runtime/ca-enterprise/`
  (`state.ts`, `card.ts`, `client.ts`, `firm.ts`, `ca-methods.ts`, `enterprise.ts`, `company.ts`,
  `enterprise-methods.ts`), `app/desktop/module-methods/ca-enterprise.json` (52 methods).
- Screens: `app/ui/src/places/lane-ca-enterprise.tsx`, `app/ui/src/screens/ca-enterprise/`
  (`firm/`, `enterprise/`, `host-wiring.ts`), `app/ui/src/places/subplaces/ca-enterprise.ts`,
  `app/ui/src/text/lanes/ca-enterprise.ts` (firm 334 keys, enterprise 170 keys, English and Hindi;
  the Hindi has not been checked by a native reader).

## Core edits

1. `app/ui/src/places/registry.ts`: `placeModuleFor` looks up `caEnterpriseFirstPlaces` right after
   a lane's own sub-place and before lookup order. Authored addresses that exist only in the ca-firm and
   enterprise shells (`work/cosign`, `work/many`, `work/questions`, `trust/channels`, `books/companies`,
   bare `today` in ca-firm, `company/*`) were otherwise taken by place-wide modules. Tests prove
   no desktop address is claimed.
2. `app/ui/src/host/bootstrap.tsx`: the host reads `caent.shell` (after `todayx.shell` succeeds) and
   passes the shell kind, administrators, grants, the lens, the company switcher and the CA-03
   banner to `App`. When the lane methods are missing or refuse, the reply falls back to desktop defaults
   and the app is unchanged.
3. `app/desktop/preload.cjs`: the lane's refusal codes on its own `laneRefusals` line (synced to
   `app/ui/src/bridge/client.ts`).

## Tests

- Engine: `platform/tests/ca-enterprise-{card,client,firm,enterprise,company}.test.ts` (24 tests),
  including "never a figure": distinctive amounts, customer names, GSTINs, seat names and link
  codes seeded in the client never appear in the card or in any firm reply.
- UI contracts: `app/ui/tests/ca-enterprise-*.test.ts` (24 tests): validators, routing, rail gating.
- React: `frontend-validation/tests/ca-enterprise-*.test.tsx` (51 tests), including the real
  `mountHost` in the enterprise shell and with no lane methods.

## Gaps

- **CA-03 "Back to clients"**: the action needs a new `BannerKind` (frame-today's
  `presentation.ts`/`Banner.tsx`) and `workspaces.switch` (frame-today, SH-06). Today the banner
  reuses the `read-only` kind with its own sentence and no action, and gives way to a real
  read-only banner.
- **Stepping into a client** stops at telling the person which workspace to open until
  `workspaces.switch` exists.
- The **close strip can never be all done** because the engine has no trial-balance, bank
  reconciliation or TDS match schedule; those card fields stay `not-done`/`not-ready`.
- The Strip part has no "in progress" square; it draws as the open "loading" square.
- **Whose** is offered (`WhoseControl`, `enterprise.whose.members`) but other lanes' lists have not
  adopted it yet.
- Not built: the enterprise parts Approval chain, Hidden content, Marking and Live state; role-shaped
  Today forms (`home` is served but not navigated to); Ask Plans, Work Cases/Agents, Reports
  Sent/Briefs, Tools Planning (authored, drawn as other lanes' screens or not built).
- Access-review removals go through `trustx.removeSeat`, which today applies at once and returns
  no change id, so "waits for the second person" never shows.
- The persona grant lists are this lane's own choice; the design names homes only.
- `scripts/check-ui-source.mjs` reports `raw-html` for the guide's `srcDoc` frame (sandboxed, runs
  nothing); that script is not part of `check.mjs`.

## The rule this lane rests on

Each client's books stay in that client's own vault. The firm's console holds **status only**:
dates, counts and states. It never holds a figure, a name of a client's customer, or a
document. Status crosses from a client to its firm only as a **status card** that the client's
own workspace issues, after the client's owner linked the firm and agreed to share status.
The card has a closed schema (no free text at all), and the firm side refuses any card that
does not match it exactly, or that was not made with the link code the firm issued for that
client (HMAC-SHA-256).

To see figures, a person of the firm opens the client: that is the client's own workspace,
entered with the seat the client gave (`trustx.invite` seat `ca`, read and export until a date,
or `accountant`, prepares and never approves money). The firm cannot add itself to a client.

## Round 4 contracts

All methods live in the engine module `ca-enterprise`
(`platform/runtime/modules/lane-ca-enterprise.ts`). Dates are `YYYY-MM-DD`; times are ISO 8601
UTC strings. "n" is a non-negative safe integer; `null` means "not known" (drawn in words, never
as zero). Permission in brackets.

### Shared types

```ts
type ShellKind = 'desktop' | 'enterprise' | 'ca-firm';
type CloseStep = 'done' | 'in-progress' | 'not-done' | 'refused';          // the four squares
type CloseStrip = { bank: CloseStep; gst: CloseStep; tds: CloseStep; tb: CloseStep };
type Ready = 'ready' | 'not-ready' | 'refused';
type Handover = { tb: Ready; bankRec: Ready; gstMatch: Ready; tdsMatch: Ready; ageing: Ready };
type DueCode = string;   // an id from the published due-date calendar (reports-ext/due-dates), /^[a-z0-9][a-z0-9.-]{0,63}$/
type Seat = { seat: 'ca' | 'accountant'; endsOn: string | null };

/** The only thing that crosses from a client to its firm. Exact keys; nothing else accepted. */
type StatusCard = {
  v: 1; kind: 'chausar.ca-status';
  workspaceId: string;            // the client's workspace id (opaque, /^[A-Za-z0-9_-]{1,80}$/)
  link: string;                   // hex SHA-256 of the link code (64 hex)
  issuedAt: string;               // ISO time
  month: string;                  // YYYY-MM, the close month the strip describes
  booksReadAt: string | null;     // last time any source was read
  close: CloseStrip;
  cosign: { meanings: n | null; recipes: n | null; accountClasses: n | null };
  questions: { count: n | null; oldestAt: string | null };
  handover: Handover;
  dueNext: { code: DueCode; date: string } | null;
  seats: Seat[];                  // seats this client has given (≤ 20), no names
  consent: string;                // consent wording version the owner agreed to
  mac: string;                    // hex HMAC-SHA-256(link code, canonical JSON of every other field)
};
```

### Client side (any desktop workspace) — `castatus.*`

| Method | Request | Reply |
|---|---|---|
| `castatus.get` [read] | `{}` | `{ link: { firmName: string; linkedAt: string } \| null; consent: { version: string; at: string } \| null; wording: { version: string; approved: boolean; text: string \| null }; lastCardAt: string \| null }` |
| `castatus.link` [admin] | `{ firmName: string (1..120), code: string (/^[A-Z2-7]{16}$/) }` | `{ firmName, linkedAt }` |
| `castatus.unlink` [admin] | `{}` | `{ unlinked: true }` |
| `castatus.consent` [admin] | `{ agree: boolean, version: string }` | `{ consent: { version, at } \| null }` — refuses `CA_CONSENT_WORDING_PENDING` when the founder's wording is not supplied (host option `consentWordingFile`, or `consentWording: { version, text }`), except in a demo workspace; `CA_CONSENT_VERSION_MISMATCH` when `version` is not the current wording |
| `castatus.card` [read; owner, cofounder, or a `ca`/`accountant` seat] | `{}` | `StatusCard` — refuses `CA_NOT_LINKED`, `CA_NO_CONSENT` |
| `castatus.inside` [read] | `{}` | `{ inside: false } \| { inside: true; firmName: string \| null; workspaceName: string; seat: 'ca' \| 'accountant'; endsOn: string \| null; can: ('read' \| 'export' \| 'prepare')[] }` — `inside` is true for a member holding a `ca` or `accountant` seat (CA-03 banner) |

### Firm side (ca-firm shell) — `firm.*`, `clients.*`

| Method | Request | Reply |
|---|---|---|
| `firm.status` [read] | `{}` | `{ firm: { name: string; reportName: string \| null; pricing: 'planned' } \| null }` |
| `firm.setup` [admin] | `{ name: string (1..120) }` | `{ firm: {…as above} }` and the workspace shell becomes `ca-firm` |
| `firm.name.set` [admin] (CA-11) | `{ name?: string; reportName?: string \| null }` | `{ firm }` |
| `clients.list` [read] (CA-01) | `{ filter?: 'needs-you' \| 'close-not-done' \| 'all'; cursor?: string; limit?: 1..200 }` | `{ month: string; rows: ClientRow[]; counts: { needsYou: n; closeNotDone: n; all: n }; nextCursor: string \| null }` |
| `clients.add` [admin] (CA-09) | `{ name: string (1..120) }` | `{ clientId; code; guide: { html: string } }` — the code is shown once |
| `clients.guide` [admin] (CA-09 "send the guide again") | `{ clientId }` | `{ clientId; code; guide: { html } }` — a new code; the old one stops matching |
| `clients.remove` [admin] | `{ clientId }` | `{ clientId; removed: true }` |
| `clients.statusImport` [prepare] | `{ card: StatusCard }` | `{ clientId; cardAt: string }` — refuses `CA_CARD_INVALID`, `CA_CARD_UNKNOWN_CLIENT`, `CA_CARD_FORGED`, `CA_CARD_STALE` |
| `clients.statusFetch` [read] | `{}` | always refuses `CA_RELAY_NOT_DEPLOYED` (hosting is the founder's decision) |
| `clients.open` [read] (CA-03) | `{ clientId }` | `{ clientId; workspaceId: string; seat: Seat }` — refuses `CA_CLIENT_NOT_JOINED`, `CA_CLIENT_NOT_ASSIGNED`, `CA_SEAT_ENDED` |
| `firm.today` [read] (CA-02) | `{}` | `{ month; awaiting: { clientId; name; cosign: n \| null; questions: n \| null; total: n \| null }[]; due: { clientId; name; code: DueCode; date: string }[]; totals: { clients: n; awaiting: n } }` |
| `firm.cosign` [read] (CA-05) | `{}` | `{ rows: { clientId; name; meanings: n \| null; recipes: n \| null; accountClasses: n \| null }[] }` |
| `firm.questions` [read] (CA-10) | `{}` | `{ rows: { clientId; name; count: n \| null; oldestAt: string \| null }[] }` |
| `firm.handover` [read] (CA-04) | `{ clientId?: string }` | `{ month; rows: { clientId; name; handover: Handover \| null }[] }` |
| `firm.many.kinds` [read] (CA-06) | `{}` | `{ kinds: { id: 'gst-guide' \| 'month-end-reminder' \| 'documents-request'; needsMonth: boolean }[] }` |
| `firm.many.prepare` [prepare] | `{ kind; clientIds: string[] (1..500, unique); month?: 'YYYY-MM' }` | `Batch` |
| `firm.many.send` [approve] | `{ batchId }` | `Batch` — each ready row ends `held` with `code: 'CA_RELAY_NOT_DEPLOYED'` until a relay exists |
| `firm.many.list` [read] | `{}` | `{ batches: Batch[] }` (newest first, ≤ 50) |
| `firm.library.list` [read] (CA-07) | `{}` | `{ items: { id; kind: 'recipe' \| 'job' \| 'check'; title: string; addedAt: string }[] }` |
| `firm.library.add` [prepare] | `{ kind; title: string (1..120); body: object (structure only, ≤ 32 KB) }` | `{ item }` — refuses `CA_LIBRARY_NOT_STRUCTURE` when the body holds values (digits runs, e-mail, phone, GSTIN, PAN, money) |
| `firm.library.remove` [admin] | `{ id }` | `{ id; removed: true }` |
| `firm.library.export` [read] | `{ id }` | `{ file: { name: string; json: string } }` |
| `firm.people.list` [read] (CA-08) | `{}` | `{ people: { memberId; name; role; clients: '*' \| string[] }[] }` |
| `firm.people.assign` [admin] | `{ memberId; clients: '*' \| string[] }` | `{ memberId; clients }` — narrows only; never grants a seat |

```ts
type ClientRow = { clientId: string; name: string; state: 'invited' | 'joined'; booksReadAt: string | null;
  close: CloseStrip | null; awaiting: n | null; dueNext: { code: DueCode; date: string } | null;
  cardAt: string | null; stale: boolean; seat: Seat | null };
type Batch = { batchId: string; kind: string; month: string | null; at: string; state: 'prepared' | 'held' | 'sent';
  rows: { clientId: string; name: string; result: 'ready' | 'not-joined' | 'no-status' | 'not-assigned' | 'held' | 'sent'; code?: string }[] };
```

`name` in firm replies is the label the firm itself typed for the client in `clients.add`.
Filters: **Needs you** = awaiting > 0 or questions > 0; **Close not done** = any step other than
`done`; **All**. A card older than 3 days is `stale`. Rows are those the caller may open
(owners see all; others per `firm.people.assign`).

### Enterprise — `caent.shell`, `enterprise.*`, `company.*`

| Method | Request | Reply |
|---|---|---|
| `caent.shell` [read] | `{}` | `{ kind: ShellKind; administers: boolean; allowed: string[] \| null; views: ('simple' \| 'guided' \| 'books')[] \| null; home: { place: string; sub?: string } \| null }` — the host passes these to `App` |
| `enterprise.setup` [admin] | `{ on: boolean }` | `{ kind: ShellKind }` |
| `enterprise.lens.get` [read] | `{}` | `{ lens: 'whole-group' \| 'finance' \| 'sales' \| 'operations'; lenses: same[] }` |
| `enterprise.lens.set` [read] | `{ lens }` | same as get |
| `enterprise.companies` [read] | `{}` | `{ companies: { id: string; name: string }[]; chosen: string \| 'all'; combined: { eliminations: 'not-built' } }` — only companies within the member's branches |
| `enterprise.company.set` [read] | `{ id: string \| 'all' }` | same as `enterprise.companies` |
| `enterprise.group.set` [admin] | `{ companies: { id: string (a branch id); name: string }[] (≤ 50) }` | same as `enterprise.companies` |
| `enterprise.whose.get` [read] | `{ list: string }` | `{ list; whose: 'mine' \| 'team' \| 'everyone' }` |
| `enterprise.whose.set` [read] | `{ list: string; whose }` | same |
| `enterprise.whose.members` [read] | `{ whose }` | `{ whose; memberIds: string[] \| null }` (`null` = everyone, no filter) |
| `enterprise.teams.list` [read] | `{}` | `{ teams: { id; name; memberIds: string[] }[] }` |
| `enterprise.teams.set` [admin] | `{ teams: { id?; name; memberIds }[] }` | same as list |
| `enterprise.access.list` [admin] | `{}` | `{ people: { memberId; name; role; branches: string[]; persona: Persona \| null; grants: string[] \| null; administers: boolean; active: boolean }[]; personas: Persona[]; grantable: string[] }` |
| `enterprise.access.set` [admin] | `{ memberId; persona?: Persona \| null; grants?: string[] \| null; administers?: boolean }` | the person's row |
| `enterprise.access.review.start` [admin] | `{}` | `Review` |
| `enterprise.access.review.decide` [admin] | `{ reviewId; memberId; keep: boolean }` | `Review` — `keep: false` asks `trustx.removeSeat` (dual control applies) |
| `enterprise.access.reviews` [admin] | `{}` | `{ reviews: Review[] }` |
| `enterprise.channels.get` [read] | `{}` | `{ channels: { id: 'whatsapp' \| 'telegram' \| 'mail' \| 'phone'; may: ('brief' \| 'approval-link')[]; as: 'company' \| 'person' }[] }` |
| `enterprise.channels.set` [admin] | `{ id; may; as }` | same as get |
| `enterprise.holds.list` [admin] | `{}` | `{ holds: [] ; enforced: false }` |
| `enterprise.holds.place` [admin] | `{ … }` | always refuses `ENTERPRISE_HOLDS_NOT_ENFORCED` (retention enforcement is core-data's) |
| `company.overview` [admin] | `{}` | `{ subs: { id: CompanySub; state: 'ready' \| 'not-built' \| 'needs-founder' \| 'out-of-service'; code: string \| null; facts: { key: string; value: string \| number \| boolean \| null }[] }[] }` |

```ts
type Persona = 'leader' | 'operator' | 'specialist' | 'administrator' | 'auditor' | 'developer';
type CompanySub = 'signin' | 'health' | 'recovery' | 'keys' | 'support' | 'computers' | 'quality' | 'build' | 'licence';
type Review = { reviewId: string; startedAt: string; closedAt: string | null;
  rows: { memberId: string; name: string; role: string; decision: 'keep' | 'remove' | null; decidedBy: string | null; changeId?: string }[] };
```

Persona homes (enterprise part 2): leader → Today (Guided); operator → Today (Books);
specialist → Books (Books); administrator → Company (Guided); auditor → Trust, Record (Books);
developer → Company, Build (Books).
