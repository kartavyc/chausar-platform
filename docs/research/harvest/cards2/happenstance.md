# Happenstance, and what Chausar's Clients place should take from it (23 October 2026)

Happenstance (happenstance.ai, YC, X: @HappenstanceAI) is a hosted web and iPhone product with a public API. There is no source to read, so this card is built from their site, developer docs, OpenAPI spec and a few reviews, not from code. Where a claim comes only from the founder's reading of their X posts, it says so.

The founder's decision this card serves: the Clients place (clients, leads, pipeline) and the LinkedIn work follow Happenstance. The owner finds people in his own network, sees warm paths, keeps a pipeline, and gets drafted intro requests, connection notes and follow-ups. **He sends every one himself. Chausar never sends on LinkedIn.**

---

## 1. What Happenstance does (with sources)

### The core loop
1. Connect accounts. Happenstance maps your network, ranked by how well you know each person (https://happenstance.ai).
2. Ask in plain English ("Seed investors in my network who back AI"). It runs several searches ("Ran 3 searches") and returns ranked people (https://happenstance.ai/guides/ai-people-search).
3. Each result is a row with three columns: **Person** (name, title, company), **Thinking** (why they matched, often citing evidence such as a portfolio page or a LinkedIn post) and **Mutuals** (initials of the people who connect you, for example "DE+2", plus "via Alex T.") (https://happenstance.ai, https://happenstance.ai/guides/warm-introductions).
4. **Find more** returns a new page, mostly second-degree people, each with a warm path. In the API it starts a new search that leaves out everyone already shown (https://developer.happenstance.ai/openapi.json).
5. **Draft intro request** writes a message to your strongest mutual. You send it yourself (https://happenstance.ai/guides/warm-introductions).

### How relationship strength is scored (what they disclose)
- **Email:** headers only, meaning who wrote to whom and when. Never bodies or attachments. Up to ten years are indexed (https://happenstance.ai/for/gmail, https://happenstance.ai/privacy).
- **Calendar:** meetings where you both sat (https://happenstance.ai/guides/mutual-connections).
- **Contacts:** being saved in Google or Apple Contacts.
- **LinkedIn, X, Instagram:** a connection or a mutual follow.
- **Combining:** one person across many accounts becomes one profile with several pieces of evidence. More evidence across more accounts gives a higher score; one old connection scores low (https://happenstance.ai/guides/relationship-intelligence).
- **Ranking:** fit to the question first, then strength, "measured by how often and how recently you and the person have emailed and met, in both directions" (https://happenstance.ai/guides/ai-people-search).
- **Not disclosed:** the weights, the scale, and how scores decay with time. The API exposes only `mutuals[].affinity_score` ("higher values indicate stronger connections", no range given) and `weighted_traits_score` per person (https://developer.happenstance.ai/openapi.json).

### How warm paths are chosen
- Your first degree comes from your own accounts. **Friends** (people who agreed to share networks both ways) and **groups** (teams, cohorts, communities that pool their networks) add second-degree reach. Each result is labelled direct, through a friend, or through a group (https://happenstance.ai/guides/warm-introductions).
- A path is scored on both legs: you to the introducer, and the introducer to the target. "Paths are ranked by the strength of the relationship on both ends", and "only introducers who demonstrably know the target get proposed" (same page). Someone who knows you well but barely knows the target ranks low.
- When nobody in your network fits, an optional web search covers public professional profiles; those results are labelled and start cold (https://happenstance.ai/guides/ai-people-search).

### What the intro request contains
- Their founders page shows the draft as: addressed to the mutual with the closest tie; what you are working on; why this target, tied to their work; the ask (introduce me, or check whether they are open to it); a line on why a warm intro beats a cold one (https://happenstance.ai/for/founders).
- Their how-to adds the house rules: one person, one named intro; make declining easy; attach a **forwardable blurb** of four or five sentences in third person (who you are, proof of progress, what you want from the meeting, a link, "nothing is being sold"); reply the same day once introduced and move the connector to bcc; ask the strongest path first, wait about a week, then try the next; a no or silence is final (https://happenstance.ai/how-to/ask-for-a-warm-introduction).
- The introducer side is a **double opt-in**: the introducer checks with the target first and connects only after both say yes; silence after a week counts as a no (https://happenstance.ai/how-to/double-opt-in-intro).

### Groups and friends
- Groups are free and unlimited. The biggest make 380,000+ people searchable; a YC batch listing showed 785k searchable people from 333 members (https://happenstance.ai/guides/mutual-connections, https://happenstance.ai/for/communities).
- A company group is found when you sign up with a work email; every rep's search draws on the whole team (https://happenstance.ai/for/founders, https://happenstance.ai/for/sales).
- Your network is searchable only by you, friends you accept and groups you join. Your **public profile shows a "constellation" of named people you know, on by default**, which you can switch off (https://happenstance.ai/security).
- Reviewers were uneasy about the defaults: one would not use Friending broadly because it gives others access to your network (https://aloa.co/ai/resources/show-&-tell/happenstance-review); another flags default sharing and AI profiles that misread people with a thin footprint, with no way to correct them (https://tooldirectory.ai/tools/happenstance-ai-networking-collaboration).

### How LinkedIn data gets in
- **Today: upload of your own LinkedIn data export.** You may also include your message headers ("who and when, never the content") so they can tell real relationships from accepted invites (https://happenstance.ai/for/linkedin).
- Exports are **processed locally in your browser, and you can preview what will be uploaded** (https://happenstance.ai/security).
- Earlier, a **Chrome extension** was the other route (Aloa review, April 2025; a search summary of their LinkedIn company page). The current site does not mention it.
- They claim "full work histories for each connection". LinkedIn's export has only the current company and position, so this must come from their own enrichment. That is an inference, not something they state.
- No OAuth: LinkedIn offers no connections API to ordinary apps.

### Other surfaces
- **Connectors listed:** Gmail, Outlook, Google Calendar, Google Contacts, LinkedIn, X, Instagram, Apple Contacts (iPhone app); apps: ChatGPT, Claude, Claude Code, Granola, OpenClaw (https://happenstance.ai). The Granola page needs a login, so "let your meetings work your network" is from the founder's X reading, not verified here.
- **iPhone app:** search, save people to lists, draft intro requests, and updates "when it finds a new connection, a better route, or someone worth meeting" (https://happenstance.ai/ios).
- **Recruiting:** paste a job post URL and it becomes a search; searches can run on a schedule, for example weekly (https://happenstance.ai/for/recruiting).
- **Sales:** account mapping (every path your team has into one company, decision makers ranked), alerts when past customers change jobs, weekly lists of new hires in a role, "whom to meet" from an event attendee list, pre-call briefs (https://happenstance.ai/for/sales).
- **Job seekers:** "Who do I know at Meta from my school?" (alumni), alerts on job changes (https://happenstance.ai/for/job-seekers).
- **Email agent:** a third-party listing says Pro users forward an email to an address and get search results back (https://www.toolmage.com/pt/tool/happenstance/). Not confirmed on their own site.
- **Not a pipeline.** Their own guide calls Happenstance "the search half" that answers who you can reach, and sends people to Dex or Monica for pipelines and nudges (https://happenstance.ai/guides/personal-crm). **Chausar's pipeline is therefore the half they leave out.**

### API, MCP, CLI (all three wrap the same five actions)
- REST at `https://api.happenstance.ai`, bearer key. `POST /v1/search` {text, group_ids, include_my_connections, include_friends_connections, search_everyone}; `GET /v1/search/{id}` (up to 30 results a page, `has_more`, `next_page`); `POST /v1/search/{id}/find-more`; `POST /v1/research` {description}; `GET /v1/research/{id}`; plus users/me, groups, usage (https://developer.happenstance.ai/openapi.json).
- **Result person:** id, name, current_title, current_company, `summary` (the "Thinking" text), socials (Happenstance, LinkedIn, X, Instagram URLs), `mutuals` [{index, affinity_score}], `traits` [{index, score 0 / 0.5 / 1, evidence}], `weighted_traits_score`. The search also returns the trait list it built from your query ({index, header, description}). This is the most useful shape to copy: **the model turns the question into named traits, then scores each person 0, 0.5 or 1 per trait with a quoted piece of evidence.**
- **Research profile:** name, alternate names, profile URLs, locations, tagline, employment, education, projects, writings, hobbies, summary, each with URLs.
- **Costs:** search and find-more 2 credits, research 1 credit (only when it completes); 402 when out of credits; 429 at 10 running searches (same spec). Credits became fractional on 14 October 2026 ahead of a "Chat API" (https://developer.happenstance.ai/changelog.md).
- **MCP** at `https://happenstance.ai/mcp`, OAuth, tools search-network, get-search-results, find-more-results, research-person, get-research-results, get-user, get-groups, get-group, get-credits, create-credits-checkout-session (https://developer.happenstance.ai/mcp/connect).
- **CLI** `hpn search "..." [--my-connections] [--friends] [--groups NAME]`, `@Name` in a query limits to that person's connections, `hpn research`, JSON output (https://developer.happenstance.ai/cli/install.md).

### Pricing and scale
- Free: chat with usage limits, unlimited connected accounts, friends and groups. Pro: $24 a month billed yearly, unlimited chat, CSV export. Team: $24 a seat a month. API and MCP credits are separate (https://happenstance.ai/pricing). An April 2025 review quoted 15 free searches a month and Pro at $30 (Aloa).
- "Loved by 500,000+ users and teams"; SOC 2; data "never used to train AI models" (https://happenstance.ai).

---

## 2. What Chausar has today (read from code, main)

- **Clients place** (`app/ui/src/places/clients/`): a Clients list (last order in one sentence, what they owe with its receipt) and a Leads sub-page (`#/clients/leads`, `Leads.tsx`). A lead row shows company, name, email with its mail-server check, status and source URL. The lead sheet shows drafts with their footer, "I sent it" with a time, and Block (email or domain).
- **Lead engine** (`platform/runtime/venture/customers/leads.ts`, `lead-methods.ts`): `Lead = { name, company, email, emailDomain, sourceUrl, emailCheck, status: new | drafted | contacted | replied | lost | blocked, drafts, sends }`. Rules: no source URL, no lead; email verified only by an MX answer; blocklist checked before any draft; every draft gets the business name, postal address and unsubscribe line; agents only draft; the owner records each send (`channel: 'own-mailbox'` only). Methods: `venture.leads.add | list | draft | recordSend | block`.
- **Gaps the build audit already lists** (`build-audit-2026-10-23.md`, Marketing row): follow-up dates, Replied and Lost, lead scoring, DPDP/GDPR/CAN-SPAM fields, bounce read-back. Nothing sets `replied` or `lost` today; there is no pipeline view, no network, no paths, no LinkedIn drafts.
- **Evidence ledger exists** (`venture-evidence`: subject, field, value, strength, `scoreBp`, source, by) but "no agent tool records facts" (audit). It is the right home for relationship evidence.
- **Connector modes** are `handoff | read | write`, each `available | planned` (`contracts.ts:857`). The catalogue (`build/catalogue.ts`) has "Your own mail app" (Chausar drafts, you send), Gmail `write` behind a Google review, Google Calendar read "from a private address you paste" (planned), LinkedIn "posting to your own profile" (planned), HubSpot, Zoho and Attio read (planned).
- **Bug found while reading (fix first, size S):** `Leads.tsx` waits for error codes `SOURCE_REQUIRED` (line 103) and `POSTAL_ADDRESS_REQUIRED` (line 273), but the real engine throws `LEADS_SOURCE_REQUIRED` and `LEADS_ADDRESS_MISSING` (`leads.ts:60, 157`). Only the UI's fake engine (`engine/fake-extras.ts:264, 294`) uses the short codes, so the UI tests pass. Against the real engine the postal address field **never appears**, and the owner's first draft fails with no way to type the address.
- The earlier `cards2/social-sales.md` already proposes a LinkedIn outreach desk in handoff mode, a send governor, LinkedIn length lints and Replied / Lost / Won stages. This card does not repeat those; it adds the network, strength, paths, intro requests and the board.

---

## 3. Feature by feature: the Chausar design

Principles carried over from Chausar's rules: code computes every score and date; the model writes the "why" line and the drafts, labelled as written by the agent; every fact about a person carries its source; nothing is sent by Chausar; the design stays quiet (ink and grey, no coloured boxes, plain words).

### 3.1 People: one record per real person, from the owner's own files

**Data shapes** (new records `venture-person`, `venture-network-import`):

```ts
type SourceRef = {
  connector: 'linkedin-export' | 'google-contacts-csv' | 'vcard' | 'calendar-ics' | 'mail-headers'
           | 'x-archive' | 'instagram-export' | 'chausar-client' | 'owner' | 'web';
  importId: string | null;   // which import brought it
  row: number | null;        // row in that file
  url: string | null;        // a web page, for 'web' only
  at: IsoTime;
};
type Person = {
  id: string;                                   // person_...
  name: string;
  role: { title: string | null; company: string | null; asOf: IsoTime; source: SourceRef } | null;
  handles: { emails: string[]; phones: string[]; linkedinUrl: string | null; x: string | null; instagram: string | null };
  sources: SourceRef[];                         // every row that mentions them
  hidden: boolean;                              // the owner hid them from search
  clientId: string | null;                      // set when they became a client
};
type NetworkImport = { id: string; connector: SourceRef['connector']; fileName: string; digest: string;
  rows: number; people: number; dropped: string[]; at: IsoTime; by: string };
```

**Engine methods:** `venture.network.import { connector, rows }` (prepare), `venture.network.people.list | get`, `venture.network.merge { a, b }` and `split`, `venture.network.hide { personId }`, `venture.network.forget { personId }` (approve, app only).

**How files come in (all are the owner's own data, downloaded by him):**
- LinkedIn "Download your data": `Connections` (first name, last name, profile URL, email only where the member allowed it, company, position, connected on), `Invitations`, `Messages` (https://www.linkedin.com/help/linkedin/answer/a1339364).
- Google Contacts CSV, phone contacts as vCard (.vcf), a calendar's private ICS address (attendee lines give "met in the same meeting"), the X archive (following and followers), Instagram "Download your information" (followers and following).
- Mail headers: in the desktop app, read a Google Takeout or Outlook export locally and keep only who, when and direction. Gmail sign-in comes later (see section 5).

**Parse on the owner's computer, like Happenstance does in the browser.** The desktop app parses the file, shows a preview ("We keep: names, roles, companies, profile links, dates. We drop: message text, 2,140 lines"), and sends only the kept fields to the engine. Message bodies never reach the engine. `NetworkImport.dropped` records what was thrown away.

**Merging:** same email, same phone, or same LinkedIn URL merges automatically; same name plus same company becomes a "Same person?" suggestion the owner confirms. Never merge on name alone.

**Source rule change:** today a lead must have a web page (`LEADS_SOURCE_REQUIRED`). A person from an import has a `SourceRef` to the file row instead. Keep "no source, no lead"; widen what counts as a source.

**UI:** Connections place gets a "Your network" group of cards. Each shows the honest mode and a count, as Happenstance does ("LinkedIn, file you download: 1,240 people, imported 21 Oct"). Re-import is one button; the card says when the file is getting old ("Imported 3 months ago. Download a new copy to catch new connections").

### 3.2 Relationship strength: code-computed, with a receipt

**Signals and weights** (fixed weights in basis points, kept in one table with a source note, tuned later from the owner's own outcomes):

| Signal | Counts as | Example weight |
|---|---|---|
| Email both ways (sent and received) | strongest | 400 per month with mail in both directions, capped |
| Email one way only | weak | 50 per month, capped |
| Meeting together (10 attendees or fewer) | strong | 300 per meeting |
| A paying client in Chausar (orders, invoices) | strongest | 1500 once |
| Saved in phone or Google contacts | medium | 300 once |
| LinkedIn messages (from header counts) | medium | 150 per month with messages |
| LinkedIn connection only | weak | 100 once |
| Mutual follow on X or Instagram | weak | 50 each |
| The owner says "I know them well" | medium | 500 once, shown as "you said" |

- Every signal decays with a half-life of 180 days from its last date, so a friend from 2015 with no mail since drifts down. Happenstance does not publish its decay; this is our own choice and should say so.
- `scoreBp` is the decayed sum, capped at 10,000. Code maps it to five bands: **Close, Know well, Know, Met once, Cold**.

```ts
type TieSignal = { kind: 'email-both' | 'email-one-way' | 'meeting' | 'client' | 'saved-contact'
  | 'linkedin-messages' | 'linkedin-connection' | 'mutual-follow' | 'owner-says';
  count: number; last: IsoTime | null; weightBp: number; decayedBp: number; source: SourceRef };
type Tie = { personId: string; signals: TieSignal[]; scoreBp: number;
  band: 'close' | 'know-well' | 'know' | 'met-once' | 'cold'; computedAt: IsoTime; receiptId: string };
```

**Engine:** `venture.network.strength.recompute` runs after every import and nightly. It writes each signal into the existing evidence ledger (`venture-evidence`, subject `person:<id>`, field `tie`, `by: 'engine'`) and one receipt per tie. That also closes the audit gap "no tool records facts" for this area.

**UI: the strength badge.** Four small dots in ink, filled by band, plus the word ("●●●○ Know well"). No traffic-light colours. Tapping it opens the existing `Receipt` part listing each line: "14 emails both ways, last on 2 Oct (Gmail headers)", "2 meetings, last 18 Sep (calendar)", "LinkedIn since 2019 (export, row 812)".

### 3.3 Warm paths: honest about what Chausar can and cannot see

- **Direct (works on day one):** "You know Priya at Acme" with her band.
- **Inside the company:** "You know 3 people at Acme" (company field match), the strongest first. This is Happenstance's account mapping for one person.
- **Through a connector (unconfirmed):** Chausar cannot see a contact's own connections. Instead it proposes "Ask Priya, who knows people at Acme" when Priya shares the company or worked there per what the owner has. It is labelled **"possible path, not confirmed"** and drawn as a dotted line. Never invent the second leg.
- **Through a circle (later, section 3.9):** both legs known, so the path is confirmed.

```ts
type Path = { targetId: string; via: { personId: string; circleId: string | null } | null;
  legs: { you: Tie['band']; them: Tie['band'] | 'unknown' }; scoreBp: number;
  confirmed: boolean; why: string };   // why: one plain sentence written by code from the legs
```

**Path score:** the weaker leg decides (`min(leg1, leg2)`), ties broken by the stronger leg. It is simple to explain and matches "ranked by strength on both ends". An unknown second leg ranks below every confirmed path.

**UI: the path line, not a network graph.** One thin horizontal line per path: `You ── Priya S. ─ ─ Rahul M., Acme`. Line weight follows the band; dashed means unconfirmed. Up to three paths per person, strongest first. A full force-directed "constellation" looks good in a demo and helps no one choose whom to ask. Happenstance's public constellation is also exactly what reviewers disliked, so leave it out.

### 3.4 Plain-English search over the owner's network

Copy the API shape: the agent turns the question into **traits**, code gathers candidates, the agent scores each candidate per trait with a quoted piece of evidence, code ranks.

```ts
type SearchRun = { id: string; text: string; scope: { mine: true; circles: string[]; web: boolean };
  traits: { index: number; header: string; description: string }[];
  results: { personId: string;
    traitScores: { index: number; score: 0 | 0.5 | 1; evidence: string; source: SourceRef }[];
    fitBp: number;            // code: weighted sum of trait scores
    thinking: string;         // agent-written, shown as "Why: ..."
    paths: Path[] }[];
  pageId: string; hasMore: boolean; at: IsoTime };
```

- **Engine:** `venture.network.search { text, scope }`, `venture.network.searchMore { searchId }` (leaves out everyone already shown, like their find-more).
- **Ranking in code:** fit first, then path score, as Happenstance states.
- **Evidence check:** a trait score above 0 must quote a stored field of that person (role, company, a note, a meeting title). If the quote is not in the record, the score drops to 0 and the row says "not supported". This stops the model claiming facts the data does not hold.
- **Web results** only when the owner ticks "Also look outside my network". They are cold, carry their page URL, and go through the existing lead rules.
- **Starters for Indian self-employed owners** (example chips under the search box): "Who in my network owns a small business in Pune?", "Who do I know at companies that might need a GST filing service?", "Past clients I have not spoken to in 6 months", "Who can introduce me to someone at Zomato?", "Paste a client brief" (the job-description trick turned toward buyers: paste what you sell, get the people likely to buy or refer).

**UI (People page in Clients):** one search box at the top. Under it, a quiet line in code-written words: "Ran 3 searches. 11 people fit; 4 you know well." Results are rows: name, then "Title at Company" in grey; the "Why:" line; on the right the strength dots and a path chip ("via Priya S."). Row actions: Add to pipeline, Draft intro. "Find more" at the end. J/K and Enter work as on every Chausar list. Opening a row shows the person sheet beside the list: How you know them (the receipt), Paths, Pipeline card, Drafts, Sources, and Hide / Forget.

### 3.5 The pipeline: the half Happenstance does not do

Stages that fit a self-employed owner selling services: **Found, Asked, Talking, Proposal, Won, Lost, Not now.** "Asked" covers a sent intro request, connection note or first email. "Won" makes or links a Chausar client, so the card ends where orders, invoices and receipts begin.

```ts
type Opportunity = {
  id: string; personId: string;
  stage: 'found' | 'asked' | 'talking' | 'proposal' | 'won' | 'lost' | 'not-now';
  pathId: string | null;            // the path being used
  nextStep: { text: string; due: IsoDate } | null;
  drafts: string[]; sends: SendRecord[];
  clientId: string | null;
  history: { from: string; to: string; at: IsoTime; by: string; reason: string | null }[];
};
```

- **Engine:** `venture.pipeline.add { personId, searchId? }`, `venture.pipeline.move { id, stage, reason? }` (an agent may propose a move from evidence, such as a reply found in the next mail import; the owner confirms), `venture.pipeline.setNext { id, text, due }`, `venture.pipeline.list`.
- **Follow-up dates are code:** after a recorded send, the next step becomes "Follow up" due in 7 days for intro requests (their "wait about a week" rule) and 5 days for a first email. One follow-up only for an intro request; after that the card suggests the next path or Not now.
- **Today place** shows due and overdue follow-ups as rows ("Follow up with Priya about Acme, due today"), with the draft one tap away.
- Existing leads map straight in: `new` to Found, `drafted` and `contacted` to Asked, `replied` to Talking, `lost` to Lost. `blocked` stays a flag, not a stage.

**UI: the board.** Desktop: columns of plain rows under stage names with counts, no card boxes. Each row: name, company, strength dots, path chip, next step with due date ("Follow up Thu"). Move with drag or a key (`[` and `]`). Phone: one list grouped by stage. The column headers show counts only; money totals per stage come from the engine with a receipt, or not at all.

### 3.6 Drafts the owner sends himself

Three new draft kinds next to the existing cold `OutreachDraft`:

```ts
type IntroRequestDraft = { kind: 'intro-request'; to: string /* the connector */; target: string;
  channel: 'email' | 'linkedin-message' | 'whatsapp';
  ask: string;                 // short note to the connector, decline made easy
  blurb: string;               // forwardable, third person, 4 or 5 sentences, no pitch, one link
  by: 'agent' | 'owner'; at: IsoTime; digest: string };
type ConnectionNoteDraft = { kind: 'connection-note'; to: string; text: string; limit: 200 | 300 };
type FollowUpDraft = { kind: 'follow-up'; opportunityId: string; to: string; channel: string; text: string };
```

- **Intro request** follows the Happenstance structure: to the strongest confirmed connector; what the owner does; why this person; the ask; the forwardable blurb. A second button drafts the **double opt-in** version for when the owner is the introducer (check with the target first, then the two-sided intro).
- **Connection note:** hard limit 200 characters for a free LinkedIn account, 300 for Premium (https://happenstance.ai/how-to/ask-for-an-introduction-on-linkedin), with a live counter. The sheet warns that free accounts get only a few personalised notes a month (vendors report around five; LinkedIn's own number was not confirmed) and that past the cap the invite goes without a note.
- **Footer rule:** the unsubscribe line and postal address belong on cold outreach. A personal note to someone the owner already knows (a tie of Know or better) should not carry an unsubscribe footer; it reads like spam. The blocklist still applies to every kind. **This is a decision for the founder** (see the end).
- **Handoff, never send.** `venture.handoff.open { draftId }` returns one action the app performs:
  - email: open the owner's mail app with to, subject and body filled (mailto), or a Gmail draft once that connector exists;
  - LinkedIn: copy the text to the clipboard and open the person's profile URL in the owner's own browser; he clicks Connect or Message and pastes;
  - WhatsApp: open `wa.me/<number>?text=...` (click-to-chat) with the text filled; he presses send. For Indian owners this channel matters more than LinkedIn.
- Then "I sent it" records the send. `SendRecord.channel` widens from `'own-mailbox'` to `'own-mailbox' | 'linkedin' | 'whatsapp' | 'phone'`, and the card moves to Asked.
- **Accept detection without scraping:** when the owner re-imports his LinkedIn export, a new row in `Connections` with a recent "connected on" date moves the matching card's note to "accepted". That is the only way Chausar learns about LinkedIn activity.

### 3.7 After a meeting: let meetings work the network

Happenstance's Granola connector idea, in Chausar's terms. When a calendar event ends (from the ICS address) the Today place shows "Add notes from your call with Rahul?". The owner pastes notes or drops a transcript file. The agent pulls out: people mentioned, intros promised by either side ("I'll connect you with my CA friend"), and next steps with dates. Each becomes a draft or a pipeline next step for the owner to approve. Engine: `venture.meeting.digest { eventId?, notes }`. A Granola MCP read can come later.

### 3.8 Research one person, with sources

Their research endpoint returns employment, education, writings and more. Chausar's version runs on public web pages only, on demand, for one person the owner is about to contact. Every line carries its URL (same rule as leads). It never opens LinkedIn pages to read them, and it keeps professional facts only. Engine: `venture.network.research { personId }` returns lines `{ text, url }`; the agent writes, the engine refuses a line without a URL. Shown in the person sheet as "Before you write" (two or three lines plus links), which is their pre-call brief.

### 3.9 Circles (groups), later and private by design

Happenstance pools whole networks. For India under the DPDP Act, sharing contacts' details with other users is a disclosure the owner would need a basis for. A safer Chausar version:

- Opt-in only, never on by default. Nothing about any person is public.
- A circle shares a **thin index**: name, current title and company (what the person published on LinkedIn themselves), and which member knows them with a band. No emails, phones, evidence or meeting history.
- **Blind request:** the searcher sees "A member of Pune Founders knows someone at Acme well" and sends an in-app request; the member sees it, decides, and only then is the path revealed or the intro made (double opt-in at the circle level).
- Needs hosted Chausar and many users before it is worth anything. Effort L.

### 3.10 Privacy controls (build with the network, not after)

- Default: the network is private to the owner's workspace; nothing is shared, no public profile.
- Per source: switch off, or delete everything that came from it (Happenstance deletes or de-identifies on disconnect, https://happenstance.ai/privacy).
- Per person: **Hide** (out of search) and **Forget** (delete the person, their ties and evidence; keep a salted hash of their email, phone and LinkedIn URL so a re-import does not bring them back). Forget is the DPDP erasure request from that person, done in one step.
- "What Chausar keeps about this person" view: every field with its source row. This doubles as the DPDP notice record.
- An opt-out from any channel puts the handle on the existing blocklist for good, as today.

### 3.11 Things not worth copying now

- **A Chrome extension that reads LinkedIn** (their old import route): LinkedIn's terms name browser extensions that scrape or automate (section 4). Skip.
- **LinkedIn posts search:** needs scraping or a licensed index. Skip; the owner can paste a post URL as a lead source.
- **Voice search, the forward-an-email agent, our own public API and CLI:** low value for self-employed owners now. The phone companion can take voice later.
- **Happenstance itself as a connector** (owner's own API key, 2 credits a search): possible as `read` later for owners who already use it; low priority.

---

## 4. What is legal and safe for an Indian self-employed owner

Plain reading, not legal advice. The owner should see a short version of this in the app where it applies.

**LinkedIn**
- **Allowed:** downloading your own data with LinkedIn's "Download your data" (Connections within about 48 hours; emails only where the member allowed it) and using that file in your own tool (https://www.linkedin.com/help/linkedin/answer/a1339364). Happenstance, Icebreaker and Juicebox all accept this file (https://docs.icebreaker.xyz/docs/export-linkedin-data, https://docs.juicebox.ai/help/data-migration/linkedin-connections).
- **Not allowed** (User Agreement section 8.2, effective 3 November 2025, https://www.linkedin.com/legal/user-agreement): scraping or copying profiles and other data; bots or "unauthorized automated methods"; automation that adds or downloads contacts or sends or redirects messages; browser plugins and extensions that do any of this; reusing members' information without the content owner's consent.
- **This is enforced.** LinkedIn sued Proxycurl in January 2025 and it shut down in July 2025 (https://www.socialmediatoday.com/news/linkedin-wins-legal-case-data-scrapers-proxycurl/756101/, https://nubela.co/blog/goodbye-proxycurl/). Apollo's and Seamless's LinkedIn pages vanished in March 2025; LinkedIn gave no reason (https://martech.org/a-pair-of-lead-gen-providers-have-disappeared-from-linkedin/).
- **So Chausar:** imports only the owner's own export; never signs in to LinkedIn to read other people's profiles; never sends, connects or messages; opens the profile and copies the text, and the owner clicks. This matches the founder's decision.
- Even inside the owner's own export, contacts' details are still their personal data: keep them private, use them for the owner's own outreach, do not resell or pool them.

**DPDP Act 2023 and DPDP Rules 2025**
- The Rules were notified on 13 and 14 November 2025, with most duties of a data fiduciary (notice, consent, security, erasure) in force about 18 months later, around May 2027 (https://www.theweek.in/wire-updates/business/2025/11/14/del148-biz-dpdp-rules-ld-govt.html, https://www.ey.com/en_in/insights/cybersecurity/transforming-data-privacy-digital-personal-data-protection-rules-2025). Build for it now.
- The "personal or domestic purpose" exclusion (section 3(c)(i)) does not cover running a business, so the owner is a data fiduciary for his contacts' data (https://dpdpa.com/dpdpa2023/chapter-1/section3.html).
- The "publicly available" exclusion (section 3(c)(ii)) covers data the person made public themselves and is read narrowly; "it is on the internet" is not enough (https://www.india-briefing.com/news/india-dpdp-act-publicly-available-personal-data-46899.html/).
- Section 7(a) lets you use data a person gave you for a purpose they gave it for, unless they object (https://www.dpdpa.com/dpdpa2023/chapter-2/section7.html). Writing to people you already deal with fits more comfortably than cold-mailing strangers.
- Startups have no exemption yet: section 17(3) lets the government exempt them, but none has been notified (https://ksandk.com/data-protection-and-data-privacy/dpdp-compliance-for-startups-msmes/, https://iapp.org/resources/article/operational-impacts-of-indias-dpdpa-part1).
- **Design consequences:** keep data local or encrypted in the owner's workspace; collect the minimum (drop message text); honour Forget at once; keep an opt-out list for good; show sources for every fact; no sharing to circles without opt-in, and then only the thin index.

**Google and Microsoft mail**
- Reading Gmail headers needs the `gmail.metadata` scope, which Google treats as restricted. Restricted scopes need verification, and storing or sending that data to servers triggers a paid security assessment (https://developers.google.com/workspace/gmail/api/auth/scopes). A desktop app that keeps the data on the device may avoid the assessment, but that is a forum reading, not policy; get Google's answer in writing first (https://community.auth0.com/t/security-assessment-for-google-connection/25490). Until then, use the local Takeout import.

---

## 5. Connector labels for this work

| Connector | Mode | Status now | Notes |
|---|---|---|---|
| LinkedIn export file (Connections, Invitations, message headers) | read (file) | build now | Parsed on the owner's computer; message text dropped |
| LinkedIn connection notes, messages, intro requests | handoff | build now | Copy and open the profile; owner sends; "I sent it" |
| LinkedIn sending or reading on the owner's behalf | none | never | Against section 8.2 |
| LinkedIn posting to own profile | write | planned (already in catalogue) | Separate from this work |
| Google Contacts CSV, phone contacts (.vcf) | read (file) | build now | |
| Calendar via private ICS address | read | build now (catalogue says planned) | Attendees give meetings together |
| Mail headers from Takeout or Outlook export | read (file) | build now (desktop) | Headers only, parsed locally |
| Gmail headers by sign-in (`gmail.metadata`) | read | planned | Restricted scope, Google verification |
| Outlook headers by sign-in (Microsoft Graph) | read | planned | |
| Your own mail app (mailto) | handoff | available | Already in catalogue |
| Gmail drafts by sign-in | write (drafts only) | planned | Already listed "write" behind a Google review |
| WhatsApp click-to-chat (`wa.me` with text) | handoff | build now | Owner presses send |
| X archive, Instagram data download | read (file) | build later | Weak signals only |
| Meeting notes pasted or a transcript file | read (file) | build now | Granola MCP later |
| Granola MCP | read | planned | |
| Happenstance API with the owner's key | read | planned, low | 2 credits a search |
| Chausar circles | read and handoff | planned (hosted) | Opt-in, thin index, blind requests |

---

## 6. Ranked list of what to build

| # | Idea | From | Kind | Value for B2C owners | Effort |
|---|---|---|---|---|---|
| 0 | Fix the Leads error codes (`LEADS_SOURCE_REQUIRED`, `LEADS_ADDRESS_MISSING`) so the address field appears with the real engine | Chausar bug | UI | high | S |
| 1 | Network import from the owner's own files (LinkedIn export, contacts CSV, vCard, calendar ICS, mail headers) parsed locally, with preview and merge into Person records | Happenstance LinkedIn upload, local processing | connector + engine | high | M |
| 2 | Relationship strength in code: weighted signals with decay, five bands, evidence ledger rows and a receipt; dots badge | Happenstance strength signals | engine + UI | high | M |
| 3 | Pipeline board in Clients: Found, Asked, Talking, Proposal, Won (to client), Lost, Not now; next step with due date; due follow-ups on Today | Happenstance leaves it out; fills audit gaps (Replied, Lost, follow-ups) | engine + UI | high | M |
| 4 | Intro request, double opt-in, connection note (200 or 300 characters) and follow-up drafts, with handoff to mail, LinkedIn and WhatsApp, and "I sent it" per channel | Happenstance drafted intros and how-tos | engine + UI | high | M |
| 5 | Warm paths: direct and same-company now, "possible path" labelled unconfirmed, path line visual | Happenstance warm paths | engine + UI | high | S |
| 6 | Privacy set: private by default, per-source delete, Hide, Forget with re-import guard, "what we keep" view | Happenstance controls, DPDP | engine + UI | high | S |
| 7 | Plain-English network search: traits, 0 / 0.5 / 1 scores with quoted evidence checked by code, "Why" line, Find more, India starter chips | Happenstance search API shape | engine + UI | high | M |
| 8 | Meeting digest: after a call, notes become promised intros, follow-ups and pipeline steps | Happenstance Granola connector | engine + UI | med | M |
| 9 | Accept and job-change detection on re-import (new connection, changed company), plus saved searches that re-run after each import | Happenstance alerts, saved searches | engine | med | M |
| 10 | "Before you write" research from public pages, every line with a URL | Happenstance research endpoint | engine | med | M |
| 11 | Footer rule split: unsubscribe and address on cold email only, not on notes to people the owner knows | Chausar lead rules meeting warm intros | engine | med | S |
| 12 | Gmail and Outlook header sign-in | Happenstance connectors | connector | med | L |
| 13 | Circles with a thin index and blind, double opt-in requests | Happenstance groups | connector + UI | med | L |
| 14 | Happenstance API as a read connector with the owner's key | Happenstance API | connector | low | S |
| 15 | Voice search, forward-an-email agent, public API and CLI | Happenstance | UI | low | M |

**Decisions for the founder before building:**
1. Do warm notes to people the owner already knows drop the unsubscribe and postal address footer (item 11), or does every draft keep it?
2. Should Clients get three sub-pages (Clients, Pipeline, People), with today's Leads folded into the pipeline's Found and Asked stages?
3. Is WhatsApp click-to-chat in scope as a handoff channel from the start (it is likely the main channel for Indian owners)?

## Sources
- Happenstance: https://happenstance.ai, /pricing, /security, /privacy, /ios, /compare, /for/linkedin, /for/gmail, /for/founders, /for/sales, /for/recruiting, /for/job-seekers, /for/communities, /guides, /guides/warm-introductions, /guides/mutual-connections, /guides/relationship-intelligence, /guides/ai-people-search, /guides/personal-crm, /how-to, /how-to/ask-for-a-warm-introduction, /how-to/double-opt-in-intro, /how-to/ask-for-an-introduction-on-linkedin, /how-to/search-your-linkedin-connections (all under https://happenstance.ai)
- Developer docs: https://developer.happenstance.ai/openapi.json, https://developer.happenstance.ai/mcp/connect, https://developer.happenstance.ai/cli/install.md, https://developer.happenstance.ai/api-reference/introduction.md, https://developer.happenstance.ai/changelog.md, https://developer.happenstance.ai/llms.txt
- Reviews: https://aloa.co/ai/resources/show-&-tell/happenstance-review, https://tooldirectory.ai/tools/happenstance-ai-networking-collaboration, https://www.toolmage.com/pt/tool/happenstance/
- LinkedIn: https://www.linkedin.com/legal/user-agreement, https://www.linkedin.com/help/linkedin/answer/a1339364, https://help.dripify.com/en/articles/8490987-limited-personalized-connection-request-notes-for-free-linkedin-accounts, https://www.socialmediatoday.com/news/linkedin-wins-legal-case-data-scrapers-proxycurl/756101/, https://nubela.co/blog/goodbye-proxycurl/, https://martech.org/a-pair-of-lead-gen-providers-have-disappeared-from-linkedin/
- India DPDP: https://www.theweek.in/wire-updates/business/2025/11/14/del148-biz-dpdp-rules-ld-govt.html, https://www.ey.com/en_in/insights/cybersecurity/transforming-data-privacy-digital-personal-data-protection-rules-2025, https://dpdpa.com/dpdpa2023/chapter-1/section3.html, https://www.dpdpa.com/dpdpa2023/chapter-2/section7.html, https://www.india-briefing.com/news/india-dpdp-act-publicly-available-personal-data-46899.html/, https://ksandk.com/data-protection-and-data-privacy/dpdp-compliance-for-startups-msmes/, https://iapp.org/resources/article/operational-impacts-of-indias-dpdpa-part1
- Google scopes: https://developers.google.com/workspace/gmail/api/auth/scopes, https://community.auth0.com/t/security-assessment-for-google-connection/25490
- Chausar code: `D:\claude\chausar-platform\app\ui\src\places\clients\` (index.tsx, Leads.tsx, ClientSheet.tsx), `platform\runtime\venture\customers\leads.ts`, `lead-methods.ts`, `platform\runtime\venture\build\catalogue.ts`, `platform\runtime\venture\contracts.ts`, `app\ui\src\engine\fake-extras.ts`
