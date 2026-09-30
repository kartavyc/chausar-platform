# Chausar architecture

This is the target architecture of Chausar after the gap review of 29 September 2026, written in plain English. It says what each piece is, why it exists, how it works, on which day it is built, and what changed. Diagrams show in the web page version.

Status: a proposal by Fable, built from the approved plan of 24 September, six gap reviews (412 findings) and eight adviser reports. It replaces nothing the founder decided without saying so: every change to a recorded decision is listed in section 9 for the founder to accept or reverse. Nothing here claims that any part exists today. What exists today is the server-side engine with its 33 connected checks, recorded in [[platform/INDEX]].

## 1. The idea in one minute

Chausar is a program on your own computer that reads your business's books and systems, answers your questions with proof, and does routine work for you under rules you set.

One rule shapes everything else: **the AI never does arithmetic.** You ask a question in plain words. The AI only chooses which calculation to run and fills in a form. Ordinary software checks the form, runs the calculation on a real database, and prints a receipt: which rows, which period, and what was left out. If no calculation fits the question, Chausar says "not yet" and writes the question down.

```dg
title: How a question becomes an answer
r: q=Your question, typed or spoken;ai=The AI picks a calculation from the menu and fills a form;chk=Software checks the form|none=Nothing fits. It says not yet and logs the question;calc=The calculator runs it on the database. No AI arithmetic;rcpt=Receipt. Rows, period, what was left out;guard=Number guard. Every number in the explanation must be on the receipt;ans=The answer, with its receipt
e: q>ai;ai>chk;chk>calc:valid;chk>~none:no match;calc>rcpt;rcpt>guard;guard>ans
```

Four things make this worth trusting:

1. **A receipt on every number.** You can open it and check.
2. **A written dictionary.** "Revenue" means one exact thing, and you can read and correct it.
3. **A memory with two clocks.** It keeps when something happened and when we learned it, so old reports can be explained.
4. **Actions that are checked.** When it does something, it looks at the result instead of assuming.

## 2. The whole product on one map

Sixteen pieces. The numbers match the sections below.

```dg
title: The whole product on one map
w: 1120
r: you=You and your cofounder|phone=Your phone;app=1 The app|trust=4 Trust panel|tools=12 Tools, plugins, phone;brain=3 Brain connection|engine=8 The calculator|thinking=9 Answers, what-ifs, decisions;meaning=5 Business dictionary|actions=10 The hands|jobs=11 Jobs on its own;mapping=6 The translators|memory=7 Business memory|learning=13 The learning loop;world=Your systems. Tally, Zoho, bank, shop|vault=2 Your vault on disk|lib=Chausar mapping library;safety=14 Test bench and safety net|release=15 Release, open source, fork|factory=16 The factory
e: you>app;phone>tools;app>brain;app>engine;trust>brain:rules;tools>thinking;brain>engine:fills a form;engine>thinking;brain>meaning:reads;engine>actions;thinking>jobs;meaning>mapping;actions>~mapping:writes back;jobs>~actions;mapping>memory;memory>vault;mapping>learning:decisions;world>mapping;learning>~lib:structure only, with consent;factory>~release;safety>~release
```

How to read it. You talk to the app. The app asks the AI (through the brain connection) to understand you, and asks the calculator to work things out. The dictionary tells both what your words mean. The translators bring data in from your systems and put it into the memory, which lives in your vault on your own disk. The hands act in your systems, and jobs use the hands on a schedule. The trust panel limits all of it. The learning loop is how Chausar gets better for everyone without taking anyone's data. The test bench checks every build. The factory is the team of AI agents that builds it all.

## 3. The pieces

### Piece 1. The app on your computer

**What it is.** A normal desktop program for Windows, Mac and Linux. Inside are two parts: the screen you use, and an engine that runs behind it as a separate background program.

**Why.** A small business owner should not need a server or an IT person. It must work with no internet.

**How it works.** The screen only shows things and sends named requests to the engine. The engine holds the keys, the database and the file readers. They are kept apart so that a bad file shown on screen cannot reach the keys. An updater is inside from the first build, so early users can be fixed. Update files are signed, and an update can be rolled back. A small Python helper is bundled for three jobs the main language does badly: reading PDFs, forecasting, and optimisation.

```dg
title: The app, in two parts
r: you=You;screen=The screen. What you click|engine=The engine. A separate background program;vault=Your vault on disk|py=Python helper. PDFs, forecasts|upd=Updater. Signed files, can roll back
e: you>screen;screen>engine:named requests;engine>vault;engine>py;upd>~engine;upd>~screen
```

**Built on** day 1 (app, updater), day 3 (Python helper, proof that an old install updates itself), day 10 (signed release).

**What changed.** The engine no longer runs inside the screen process. The updater moved from day 3 to day 1. The Python helper is new.

### Piece 2. Your vault

**What it is.** One encrypted place on your disk that holds everything Chausar knows about your business.

**Why.** These may be the only copy of a shop's books. Losing them or leaking them is the worst thing the product could do.

**How it works.** The data sits in a PostgreSQL database on your disk. It is locked with a key. The key is kept in your computer's keychain and is also protected by a passphrase you choose. At setup you get a recovery kit: a code you print and keep. If the laptop is lost, the recovery kit opens your backup on a new machine. You can back up, restore, export and delete. Only one copy of the app may open a vault at a time.

```dg
title: Your vault and its keys
r: key=Key in the computer keychain|pass=Your passphrase|kit=Recovery kit. A printed code;lock=The lock;db=Database on your disk|bk=Backups you own
e: key>lock;pass>lock;kit>~lock:laptop lost;lock>db:opens;db>bk
```

**Built on** day 1 (vault, keys, recovery kit, backup), day 6 (second machine, sync), day 10 (export and delete, tested by outsiders).

**What changed.** The plan said "encrypted workspace" with no design. The key, passphrase and recovery design is now a day 1 block. The database is chosen on day 1 from a test of two options: PGlite (very small, but labelled alpha and single-connection by its makers) and bundled PostgreSQL. Bundled PostgreSQL is recommended.

### Piece 3. The brain connection

**What it is.** The part that talks to an AI model, and the record of every word it sent.

**Why.** You should know what was told to the model. You should never be locked to one AI company.

**How it works.** You choose the route, and every route is supported. First: if you already have the Codex or Claude Code command-line tool installed, the app starts it for you in a locked profile with no tools of its own. Then an API key (a paid password for a model), and a local model that runs on your own machine. The design target is a mid-size model: Luna on Codex, Sonnet on Claude. The app never reads or stores a subscription password or token. Every request is sent once, with no hidden retries, written down, and checked against your privacy setting before it leaves. Speech is a separate pluggable part: paid live voice needs an API key and shows its cost per minute, and a free local option exists.

```dg
title: The brain connection
r: ask=A request from the app;gate=Privacy check. What may be sent|log=Written down word for word;key=API key|local=Local model|cli=Your own Codex or Claude tool|host=Chausar allowance. Paid plan
e: ask>gate;gate>log:allowed;log>key;log>local;log>cli;log>host
```

**Built on** day 1 (routes, receipts, voice), day 8 (the full comparison of routes on the test bench, budgets in rupees).

**What changed.** Nothing in the order: Codex login first, as first decided and confirmed by the founder on 29 September, with Claude Code next. The gap review had marked these two routes experimental over vendor terms; the founder confirmed that using the Codex and Claude Code command-line tools is allowed. One rule was added and stays: the app starts your own installed tool and never reads a subscription token. Vendor tools hide the real request, so the receipt shows the exact text handed to the tool.

### Piece 4. The trust panel

**What it is.** One screen with four questions: what may Chausar see, what may it send to the AI, what does it keep, what may it do without asking.

**Why.** An assistant that can read your books and send messages must be under your control in a way you can check.

**How it works.** Software enforces the rules before anything happens. It does not rely on asking the AI nicely. "Send" has three levels: nothing, the shape of the data only, or small samples. From day 6 there are several people with different permissions, including an accountant seat that can read and prepare but cannot approve money. From day 8 two more rules apply. First, some actions always wait for a person: money, messages to outsiders, deleting, and anything that cannot be undone, such as prices, stock, listings, sharing and tax filings. Second, anything that has read text from outside (a file, a web page, a message) cannot send data out of your machine without a person agreeing.

```dg
title: The trust panel
r: tp=Trust panel;see=See. Which sources|send=Send. Nothing, shape only, samples|keep=Keep. What and how long|do=Do. What runs without asking;enf=Software enforces every rule before anything happens
e: tp>see;tp>send;tp>keep;tp>do;see>enf;send>enf;keep>enf;do>enf
```

**Built on** day 1 (one owner), day 6 (cofounder, accountant, markings, deletion, the readable record), day 8 (the autonomy switch and the rules for data leaving the machine).

**What changed.** The accountant seat is new. The list of actions that always wait is longer. The rule about outside text is new.

### Piece 5. The business dictionary

**What it is.** The written meanings of your business words: customer, sale, revenue, paid invoice, finished job. The plan also calls this the ontology.

**Why.** If revenue can mean three things, every answer is a guess. With one written meaning, every answer can be checked.

**How it works.** The dictionary starts from a ready-made pack for your kind of business and you correct it. Each meaning is exact: which currency, which units, from when, and what to do when a value is missing. From the dictionary, software builds three things: the layout of the database, the checks, and the menu of calculations the AI is allowed to ask for. A change to the dictionary is released all at once or not at all. A separate answer key, worked out by hand, checks that the built parts are right. Two built parts agreeing with each other proves nothing, because they can share the same mistake.

```dg
title: From dictionary to menu
r: packs=Starter packs for your kind of business|you=Your corrections;dict=The dictionary. One exact meaning per word;menu=Menu of allowed calculations|db=Database layout|checks=Checks;key=Answer key worked out by hand
e: packs>dict;you>dict;dict>menu:builds;dict>db:builds;dict>checks:builds;key>~menu:tests
```

**Built on** day 2.

**What changed.** Day 2 was too heavy. Two starter packs are built on air (the viewers choose which), and four overnight. A setup guide is new: it walks a new user from install to first answer. What turns a meaning into a database query on the laptop was not stated; it is now one named builder, tested against the answer key.

### Piece 6. The translators

**What it is.** How each outside system is turned into your dictionary's words. A translator has two parts: a connector that fetches the data, and a recipe that says what each field means.

**Why.** This is the hardest part of the product, and the part that gets better with every business that uses it.

**How it works.** Recipes are written in Chausar's own mapping language. A recipe says things like: this column is the customer's tax number, dates are day first, amounts are in rupees with two decimals, this company and this tax registration only. The AI proposes a recipe and shows its evidence. If it is unsure, it asks you one question instead of guessing. Then software tests the recipe against the source system's own report totals. A recipe that does not match the system's own totals is not accepted. Until the locked box exists on day 9, connectors are data only: a recipe is a file, not a program, so no connector code runs.

```dg
title: How a translator works
r: sys=Your systems. Tally, Zoho, bank, shop|files=Files, PDFs, a photo of a bill;get=Fetch the data. Check it is complete;recipe=Recipe in the mapping language|ask=Not sure. Ask one question;test=Test against the system's own totals;facts=Facts in your dictionary's words
e: sys>get;files>get;get>recipe;recipe>test;recipe>~ask:unsure;ask>~recipe:answer;test>facts:match
```

The mapping language holds:

| Part | What it says |
|---|---|
| Typed bindings | Which source field means which dictionary word, and its type |
| Scope | Which company, branch and tax registration the recipe covers |
| Units, currency, periods | How amounts, dates and financial years are written |
| Custom fields | The fields this one business added |
| Versions | Which version and edition of the system it fits |
| Assertions | Totals that must match the system's own reports |
| Abstention | When to refuse, with a reason a person can read |
| Unmapped fields | A list of what was seen and not understood |
| Write-back | How to write into the system, tested apart from reading (day 7) |

Three ways in for a desktop system such as Tally, in this order: its own interface (Tally's XML interface), exported files, and last, the app driving the software on your own machine in a session you can watch and stop.

**Built on** day 2 (the language is designed, accounts are classified), day 3 (first bank statement), day 4 (Tally, Zoho Books, the factory for 50 systems, hidden tests, GST matching, photo of a bill), day 7 (write-back).

**What changed.** The language was planned for day 4 though earlier days depend on it; it is now designed on day 2. Classifying the chart of accounts is its own step. The source's own totals are the numeric test for every recipe. Live bank feeds through India's Account Aggregator need a regulated partner and come after day 10.

### Piece 7. The business memory

**What it is.** Everything Chausar knows, with history. Nothing is overwritten.

**Why.** Real books get corrected all the time. A tool that forgets the old version cannot explain why a report changed.

**How it works.** Every fact has two clocks: when it happened, and when we learned it. If a March invoice is corrected in April, both versions are kept. So Chausar can answer what March looks like now, and what we believed about March on any past date. What each source said is kept apart from the final answer: if Tally and Zoho disagree, both claims stay, and a rule you publish picks the winner, or the conflict stays visible. Two records of one customer can be joined, and the join can be undone in a way that repairs everything that depended on it. A saved answer that may be out of date is marked stale until it is rebuilt.

```dg
title: Memory with two clocks
r: src=What each source said|fix=Corrections;mem=Memory. When it happened, and when we learned it;now=The answer as we know it now|then=The answer as we knew it on a past date
e: src>mem;fix>mem:adds a version;mem>now;mem>then
```

**Built on** day 1 (it remembers what you tell it), day 3 (two clocks, source claims, identity, stale marks).

**What changed.** Demos that ask "what did we know on 10 April" need a past learned-on date, which real records can never be given. A labelled test clock is added for demos only.

### Piece 8. The calculator

**What it is.** Ordinary software that does all the maths and prints a receipt. Section 1 shows it.

**Why.** AI models make up numbers. Here a made-up number cannot reach you.

**How it works.** The menu of calculations comes from the dictionary. Day 1 has no dictionary yet, so it uses a small menu written by hand; day 2 replaces it. Every answer states its coverage: what it counted and what it could not count. A number guard compares every number in the AI's explanation with the receipt and rejects the answer if one is missing from the receipt.

**Built on** day 1, day 2 (menu from the dictionary), day 5 (the full set).

**What changed.** The number guard is new. The rule for questions with no matching calculation is new. One honest limit is now said out loud: the maths is exact, but every number still rests on a recipe that a model proposed and a test accepted. That is why recipes are tested against the source's own totals.

### Piece 9. Answers, what-ifs and decisions

**What it is.** The tools for thinking, on top of the calculator.

**Why.** Owners do not want dashboards. They want help deciding, and someone who remembers what was decided.

**How it works.** Ask why something changed: Chausar shows what is measured and, apart from it, what is only a guess. Try a what-if: it changes an assumption, never a fact. A forecast is shown only if it beats a simple baseline on past months. Write down a decision with a review date, and Chausar comes back on that date. A Monday brief and a Friday review keep the habit; the Monday brief also carries a compliance calendar whose dates come from a published list, never from the AI. Reports for a bank, an investor or a CA carry a receipt on every number and state any gap on the page.

```dg
title: Thinking tools
r: calc=The calculator;why=Why did it change|whatif=What if|fore=Forecast;journal=Decision journal with review dates|brief=Monday brief, Friday review|rep=Reports for bank, investor, CA
e: calc>why;calc>whatif;calc>fore;why>journal;whatif>journal;fore>journal;journal>brief;calc>rep
```

**Built on** day 5.

**What changed.** "Ready for a lender" now has a meaning: the layouts banks in India ask for. True margin per order for an online seller is the lead question for the first user. Comparison with similar businesses is removed until data exists. The Monday brief goes out by mail and WhatsApp as a headline and a link.

### Piece 10. The hands

**What it is.** Real actions in your systems, with a preview before and proof after.

**Why.** An assistant that assumes its action worked will one day send a reminder twice, or not at all.

**How it works.** Every action follows five steps. Prepare: show exactly what will happen. Approve: you say yes to that exact thing; if the thing changes, the approval is gone. Do: act once. Read back: look at the system to see what really happened. Settle: record the true result. If the connection drops halfway, the result is "unknown", which is a real state: Chausar checks before trying again. Actions come from a written catalogue, one list per system, and each entry says how Chausar avoids doing it twice and how it reads the result back. Being allowed to read a system never means being allowed to write to it.

```dg
title: Five steps for every action
r: prep=Prepare. Show the exact change|ok=Approve. You say yes;do=Do it once;back=Read back. What really happened|unk=Unknown result. Check before retrying;led=Actions ledger. The true record
e: prep>ok;ok>do;do>back;do>~unk:connection lost;unk>~back;back>led
```

**Built on** day 7.

**What changed.** The phrase "everything Codex can do" is removed because it cannot be tested. The catalogue with its two columns is new.

### Piece 11. Jobs it runs on its own

**What it is.** Ongoing work with a goal, a budget, a stop rule and an owner.

**Why.** The value of a helper is work that happens without you asking each time. The risk is work you did not want. The rules sit between the two.

**How it works.** From day 7 Chausar can propose its own repeating jobs; you can see, pause or delete each one. If the laptop was asleep when a job was due, a written catch-up rule decides whether to run it late or skip it, and a background mode keeps jobs running while the window is closed. From day 8 you can hand it a bigger job, such as chasing unpaid invoices. Budgets are counted in rupees across every model route, and the cost of each job is measured. A job is finished only when you accept what it delivered. When it lacks permission, the model is down, or it cannot tell what you meant, it stops and asks.

```dg
title: A job
r: goal=A job. Goal, budget, stop rule, owner;plan=It plans and splits the work;auto=Runs on its own. Safe and can be undone|wait=Waits for you. Money, outside messages, deleting, cannot be undone;done=You accept or reject the result
e: goal>plan;plan>auto;plan>wait;auto>done;wait>done:after your yes
```

**Built on** day 7 (schedules), day 8 (jobs, budgets, the autonomy switch).

**What changed.** Jobs that run while the laptop is closed are a paid service on Chausar's servers. They cannot use your own command-line login, and they cannot be encrypted end to end, because the server must read the data to work on it. The plan now says so.

### Piece 12. Tools, plugins and your phone

**What it is.** Small apps made on request, add-ons from other people, and briefs on your phone.

**Why.** No product covers every need. A safe way to extend it is how a community forms.

**How it works.** A generated app uses only your published data and approved actions, with the permissions of the person using it. Plugin code runs inside a locked box: it can reach only named sites, and it never holds a key; it asks Chausar to make the call. The plugin format fits two existing standards (Agent Skills and MCP), so add-ons made for other assistants can be wrapped. Chausar also offers itself as a read-only "verified numbers" server, so another assistant can ask Chausar for a number and get it with its receipt. On the phone, WhatsApp and mail carry briefs and simple approvals for the owner. Open chat stays in the app. Money approvals stay in the app.

```dg
title: Tools and plugins in a locked box
r: ask=You ask for a small app|plug=A plugin from someone else;box=Locked box. No keys, only named sites;data=Only published data and approved actions;phone=Phone. Briefs and simple approvals|other=Other assistants ask for verified numbers
e: ask>box;plug>box;box>data;data>phone;data>other
```

**Built on** day 5 (first read-only brief), day 9 (the rest).

**What changed.** The locked box technology is chosen on day 1 and built on day 9 (WebAssembly is recommended). WhatsApp's rules since January 2026 do not allow a general AI assistant on its business platform, so its use is narrowed. The verified-numbers server is new.

### Piece 13. The learning loop

**What it is.** How the product gets smarter with every business, without taking anyone's data.

**Why.** Models are the same for everyone. What Chausar learns about real systems is not. This is the planned advantage over competitors.

**How it works.** Every time a recipe is proposed, accepted, rejected or corrected, that decision is written to a log on your machine. The same happens for customer matches, for which calculation answered which kind of question, and for what an action really did. A sharing switch, off by default, lets you share structure only: field names, report shapes, the choice made and the reason. Never values, names or amounts. You see exactly what would be sent before you agree, and a page lists what you have shared. No feature is locked behind it. Together these logs become Chausar's mapping library, tested on businesses the builders never saw.

```dg
title: The learning loop
r: dec=Every mapping decision is logged on your machine;yes=You agree to share structure only|no=You do not agree. Nothing leaves;lib=Chausar's mapping library;test=Tested on businesses the builders never saw;better=Better recipes for everyone|model=Later. A small model trained on the library
e: dec>yes;dec>no;yes>lib;lib>test;test>better;lib>~model:later
```

The order in which the library is put to work (the training ladder):

| Step | What | When |
|---|---|---|
| 1 | Look up similar past recipes before proposing a new one | Day 8 |
| 2 | Force proposals to follow the mapping language's grammar | With step 1 |
| 3 | A small classifier for chart-of-accounts labels | After about 20,000 checked labels |
| 4 | A small language model tuned on the library | Only if it beats step 1 on hidden tests |

**Built on** day 1 (the log), day 2 (accounts labels), day 4 (consent screen, upload, credits), day 8 (step 1).

**What changed.** This piece is new. Three older texts forbid learning across customers; the founder's decision of 29 September replaces them for consented, structure-only sharing. An honest limit: the advisers expect only a small share of free users to opt in. Accountants who serve many clients, the paid service and enterprise pilots are where most of the data will come from.

### Piece 14. The test bench and safety net

**What it is.** Tests that run every day, so a claim is never just a claim.

**Why.** The builders are AI agents. They need an exam they cannot see in advance.

**How it works.** Three sets of tests. Open tests live with the code. Hidden tests are held by Con, the reviewer agent. A sealed set is held by Moheek, off the fleet's server. Attack files carry hidden instructions inside spreadsheets, documents, messages and plugins, to prove Chausar treats outside text as data. Every build gets a score: right, wrong, refused. A red test means the day is called partial in public.

```dg
title: The test bench
r: open=Open tests. Builders can see|hidden=Hidden tests. Held by Con|sealed=Sealed tests. Held by Moheek|attack=Attack files;run=Run on every build;pass=Green. The day can be called done|fail=Red. The day is partial
e: open>run;hidden>run;sealed>run;attack>run;run>pass;run>fail
```

**Built on** day 1, and every day after.

**What changed.** Testing started on day 8 in the old plan, with the builders holding the hidden cases. It now starts on day 1, and the builders hold nothing hidden.

### Piece 15. Release, open source and the enterprise version

**What it is.** How the app reaches people, what is free, and how the big-company version grows from it.

**How it works.** The app is free on your own machine. Paid plans cover what costs money to run. The enterprise version is the same code with company sign-in, roles, a server install and big-company connectors. Every feature shown in the ten days is labelled supported or experimental. Day 10 publishes both lists.

| Open | Private |
|---|---|
| The app | The qualified recipe library and its evidence |
| The mapping language, its builder, the SDK | Hidden and sealed test sets |
| The receipt format and the open tests | Contributed samples and the learning log store |
| A base set of recipes and starter packs | Trained models |
| | Hosted service code, signing keys |

**Built on** day 1 (installer, updater, public releases page if the founder agrees), day 3 (licence and policy texts drafted), day 10 (signed release, a clean public copy of the code, policies, offers).

**What changed.** What is open and what is private is now an open decision for the founder (section 9). The working repository is never made public, because it holds fleet records and server details; a clean copy is.

### Piece 16. The factory

**What it is.** The thirty-six AI agents that build the product. It is not part of the product.

**How it works.** Chief hands out the work and is the only one who merges code. Con reviews and tries to break every claim. Warden checks security. Every change is a proposal that must pass automatic checks and review. The fleet works through the night and reports each morning: changed, verified, partial, needs. No agent that can change code reads stream chat or messages from strangers. Customer data never touches the fleet's server.

```dg
title: The factory
r: you=You give the order;chief=Chief splits the work;teams=Six teams build on branches;con=Con reviews and attacks|tests=Automatic checks;main=Chief merges;inst=Installer for Windows, Mac, Linux
e: you>chief;chief>teams;teams>con;teams>tests;con>main;tests>main;main>inst
```

## 4. What runs where

| Where | What runs there | Who can read the data |
|---|---|---|
| Your computer | The app, the engine, the vault, the calculator, recipes, local jobs, the locked box | You |
| The AI provider you chose | Only what your privacy setting allows, one request at a time | That provider, under its own terms |
| Your own Drive (day 6) | An encrypted change log for sync between your machines | Nobody without your key |
| Chausar's servers, free users | The releases page, update files, and the mapping library's intake if you opted in | Chausar sees structure only |
| Chausar's servers, paid plans | The model allowance, backup, always-on jobs, the WhatsApp and mail relay | Backup is encrypted. Always-on jobs are not end to end encrypted, because the server does the work |
| A company's own server (enterprise) | The same engine for many users with roles | The company |

## 5. How data moves

```dg
title: From your systems to an answer
r: sys=Your systems and files;tr=Translators. Fetch, recipe, test against the system's totals;mem=Business memory in your vault;calc=The calculator|hands=The hands;ans=Answers, briefs, reports|back=Read back the result
e: sys>tr;tr>mem;mem>calc;calc>ans;calc>hands;hands>sys:acts;hands>back;back>mem
```

Three rules hold everywhere:

1. **Text from outside is data, never an instruction.** A spreadsheet cell that says "ignore your rules" is stored as text and changes nothing.
2. **Nothing leaves without a rule that allows it.** The trust panel decides what goes to a model. The sharing switch decides what goes to Chausar. Both show you the exact content first.
3. **What is deleted is gone from every store that exists,** and Chausar says what it can no longer answer because of it.

## 6. What is built on which day

| Day | Name | Pieces |
|---|---|---|
| 1 | The factory starts, and the companion exists | Factory, app, vault, brain connection, trust panel, calculator, memory, learning log, test bench, release |
| 2 | Teach it what your business means | Dictionary, mapping language, accounts labels, setup guide |
| 3 | A history you can trust | Memory, first bank statement, Python helper, test clock |
| 4 | Connect the systems a small business uses | Translators, factory for 50 systems, hidden tests, consent and sharing, GST matching |
| 5 | Answers, what-ifs and decisions | Calculator in full, thinking tools, reports, first brief by mail and WhatsApp |
| 6 | Permission, privacy and the cofounder | Trust panel for several people, accountant seat, sync, deletion |
| 7 | Let it act, then check what happened | The hands, action catalogue, write-back recipes, schedules |
| 8 | Give the companion a job | Jobs, budgets, autonomy switch, model comparison, recipe lookup |
| 9 | Tools, plugins and your phone | Locked box, plugins, verified-numbers server, approvals on the phone |
| 10 | Ship it, and write the fork | Signed release, supported and experimental lists, clean public code, policies, offers, guide to the enterprise version |

## 7. Threats, in plain words

| Who | How | What stops it |
|---|---|---|
| Someone who steals the laptop | Reads the disk | The vault is encrypted; the key needs your passphrase |
| A file or message with hidden instructions | Tries to make the AI obey it | Outside text is data; the number guard; attack files on the bench |
| A bad plugin | Tries to read keys or call home | The locked box; plugins never hold keys; you can remove a plugin |
| A fake update | Pretends to be a new version | Update files are signed; rollback |
| A viewer in stream chat | Types an order for the agents | No agent that can change code reads chat |
| Chausar itself, by mistake | Sends your data somewhere | Nothing leaves without a rule; you see the exact content first |
| A bigger company | Copies the open code | The library, the tests, the brand and the channel are not in the code |

What is not yet solved: a program running as you on your own machine can read what you can read. The vault's passphrase limits this; it does not remove it. This is said plainly in the app.

## 8. What the enterprise version swaps

| In the desktop app | In the enterprise version |
|---|---|
| Bundled PostgreSQL for one user | A server install for many users with branch-level roles |
| A job queue on the database | A workflow engine (Temporal) behind the same contract |
| DuckDB for analysis | A semantic layer server (Cube) behind the same contract |
| Accounts for founders and an accountant | Company sign-in, provisioning, the full set of markings |
| Recipes for 50 small-business systems | Recipes for SAP, Oracle and the like, signed off per customer |
| The sharing switch | A contract. Enterprise data is normally not pooled |

The advisers' view: the first enterprise customers need a server install with roles before they need anything else. It does not need the heavy parts above.

## 9. Decisions for the founder

Each of these is applied in the plan so the work can go on, and each can be reversed.

| Id | Decision | Recommended | Why |
|---|---|---|---|
| D2 | What is open, what is private, and the licence | Open: app, mapping language, builder, SDK, base recipes. Private: qualified library, tests, log store, models, hosted code. AGPL-3.0 for the app, Apache-2.0 for the language and SDK | A library cannot be both the advantage and fully open. A licence can be loosened later, not tightened |
| D3 | The database for the desktop | Bundled PostgreSQL, unless PGlite passes every hard test on day 1 | These may be the only copy of someone's books |
| D4 | Model routes | Kept: every route supported, Codex login first, then Claude Code; Luna class or Sonnet is enough; app never handles a token | Founder confirmed on 29 September |
| D5 | The list of systems | Add Khatabook, OkCredit, myBillBook, BharatPe, Petpooja, income tax files. Drop QuickBooks | India review |
| D6 | What actions are in scope | A written catalogue per system | It can be tested |
| D9 | Windows signing | A certificate from a certificate company, key on a hardware token | Microsoft's low-cost service does not accept Indian entities |
| New | How strangers get the build before day 10 | A public releases page with installers, checksums and the README | The code repository is private until day 10 |
| New | The locked box technology | WebAssembly with a small permission list | Chosen on day 1, built on day 9 |
| New | The first user | A founder of an online brand or young company on Zoho Books, Shopify and Razorpay. Second: the accountant or CA | The product in ten days can serve this user |
| New | The word "cofounder" | Test "Every number has a receipt" as the lead line | Two other products already use "cofounder" |
| New | A GST service provider partner, and a regulated partner for bank data | Decide after day 10 | Both need contracts |

## 10. Words

| Word | Meaning |
|---|---|
| Receipt | The proof behind a number: which rows, which period, what was left out |
| Dictionary (ontology) | The written meanings of your business words |
| Calculation (operation) | One item on the menu of things the calculator can work out |
| Translator | A connector that fetches data plus a recipe that says what it means |
| Recipe (mapping template) | The written rule that turns one system's fields into your dictionary's words |
| Mapping language | Chausar's own way of writing recipes |
| Hidden test (holdout) | A test on a business the builders never saw |
| Abstain | To say "I am not sure" and ask, instead of guessing |
| Reconcile | To compare two totals that should match and explain any gap |
| Two clocks (bitemporal) | Keeping both when something happened and when we learned it |
| Source claim (assertion) | What one system said, before a rule picks the final answer |
| Stale | A saved answer that may no longer be right |
| Coverage | What an answer counted and what it could not count |
| Read back | Looking at the outside system after an action to see what happened |
| Idempotency | A rule that makes doing the same thing twice have the effect of doing it once |
| Job (mandate) | Ongoing work with a goal, a budget, a stop rule and an owner |
| Locked box (sandbox) | A closed space where untrusted code runs without your keys |
| Prompt injection | Hidden instructions in a file or message that try to trick the AI |
| MCP | A standard plug that lets an AI assistant call an outside tool |
| Fork | A copy of the code that grows into a different product |
| Supported, experimental | Tested on the bench and a hidden case; or shown working once |

Navigation: [[INDEX]], [[CHAUSAR-LIVE-BUILD-PLAN]], [[STATE]], [[DECISION-LOG]].
