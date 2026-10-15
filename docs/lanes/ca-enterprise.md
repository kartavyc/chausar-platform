# Lane ca-enterprise: the CA console and the enterprise frame (experimental)

> **Everything in this lane is experimental.** The full "Enterprise and CA console" design file
> is not in the repository. This lane builds from the design extract
> (`docs/specs/CHAUSAR-APP-DESIGN.md` §13, "the enterprise version and the CA console" parts 1–4
> and part 9, CA-01..CA-11) and the shell scaffolding already in `app/ui/src/app/places.ts`.

(The sections "What was built", "Tests", "Core edits" and "Gaps" are filled in at the end of the lane.)

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
