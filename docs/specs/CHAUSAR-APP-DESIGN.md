# Chausar app design (text extract)

Generated from `Chausar-App-Design.html` (pictures omitted). The HTML is the source of record.
Chausar App Design

- 

# Chausar app: the frontend design

Written on 1 October 2026 by Fable, for the founder's approval and then for the fleet to build from.

Status: a proposal. The founder chose the direction through structured questions and rendered options on 1 October; those choices are listed in part 2 and recorded in DECISION-LOG. Everything else here is Fable's design, and each open point is listed in part 15. Nothing in this document is built. The seven day 1 screens on the branch design/day1-journeys are not the starting point: the founder asked for a clean start.

This document covers the whole product: the desktop app through day 10, the phone, the enterprise version and the console for CA firms.

| 
File | 
What it holds | 

| 
This file | 
The design in plain English: the frame, the seven places, the look, the words, the three views, how the main journeys work, and what is still open | 

| 
Screens | 
Every screen of the desktop app and the phone, one entry each: what it is for, what it shows, its states, what it needs from the engine, and the day it lands | 

| 
Enterprise and CA console | 
The same app grown up: what is added for a company, where each of the 176 enterprise surfaces lives, and the console for CA firms | 

| 
For the builders | 
The technical part: code layout, parts, text, number formats, the named engine messages, tests, speed limits, and the build order day by day | 

| 
Pictures | 
The 19 key screens, each in light and dark | 

| 
Screen sources and stylesheet | 
The key screens as plain web pages, and the one stylesheet that draws them. Reference drawings, not app code | 

The same text, with each picture beside its words, is on one private page: the link is in STATE.

## 1. The design in one minute

Chausar opens on a page called Today. Today shows what is awaiting your review, how the month is going in three small charts, and what happened earlier today on one line. Seven places sit in a narrow list on the left. An ask line sits at the bottom of every screen, so a question or a task is always one keystroke away.

Today, the screen the app opens on

Things are shown as rows, like a ledger: a small square, what it is, a short note, and the figure at the right. Click a row and its detail opens in a sheet beside the list. The list stays where it was. Every figure opens its receipt.

Small squares say who did something and whose turn it is. Green is Chausar. Ink is you. Grey is another person. An open square is waiting. Amber means not sure.

A screen at rest holds very few words. Charts and small drawings carry the explanation: a bridge chart for why a number moved, a drawing of the locked box a plugin runs in, a drawing of what left this computer today.

There is one app, shown three ways. Simple is for a shop owner: big, in Hindi or English, voice first. Guided is the default. The Books view is for an accountant: dense tables and the keyboard. The enterprise version is the same app in a browser with company sign-in and roles. The CA console is the same app with a list of clients in front.

The frame: rail, page, sheet, ask line, status line

## 2. What was decided, and by whom

The founder decided these on 1 October 2026, each after seeing options.

| 
Question | 
The founder's choice | 

| 
What to deliver | 
A written spec, plus rendered pictures of the key screens | 

| 
How much to cover | 
The whole product, all in full detail | 

| 
The fleet's day 1 screens | 
Ignore them, start clean | 

| 
Who it is for | 
The founder, the accountant or CA, and the shop owner, equally. One app, three views | 

| 
Light or dark | 
Follow the computer's setting. Both are first class | 

| 
The enterprise version | 
The same app, grown up. Not a separate front | 

| 
The shape of the app | 
The desk: it opens on Today, seven places on the left, the ask line at the bottom of every screen, and a time line wherever the app shows what happened | 

| 
Rows | 
Ledger rows that open on click to show one line of detail and the Review button | 

| 
How many words | 
About 35 to 45 words of reading on a screen at rest. The first version, at about 110, was "too text heavy" | 

| 
Wording | 
Ordinary product words. "Awaiting your review", not "What waits for your yes" | 

| 
Where detail opens | 
In a sheet beside the list | 

| 
The weekly brief | 
It is called "The week ahead" | 

| 
Hindi on the Simple view | 
Good enough for now. A native reader must review it before release | 

| 
Charts and drawings | 
Required. "Nothing explained visually, all text" was rejected. The level in the pictures is right | 

| 
Chart colour | 
Ink and grey | 

| 
Motion | 
Short and once | 

The 35 to 45 words are reading words: the sentences and labels a person reads to understand the screen. The word test in the builders' file counts every word on the page, including figures, labels, the open sheet and the status line. That is why its limits are higher.

Fable decided the rest. The choices that matter most are in part 15, each with a reason, so the founder can reverse any of them.

## 3. Twelve rules the design follows

- It opens on what needs you. Today leads with the things awaiting your review. Everything else is below.

- A screen at rest holds about 40 words of reading. One line per item. Detail appears only on the row you open. The test for this is in the builders' file.

- A picture where a picture explains. Numbers get charts. Mechanisms get small drawings. A screen made only of rows and figures is not finished.

- Every number opens its receipt. A figure in a row, a bar in a chart and a cell in a report all open the same receipt. No number appears without one. When a number in a written explanation is not on the receipt, the number guard removes the written explanation and puts the template explanation in its place. The figures stay, because they come from the receipt, and the page says so.

- Squares say who and whose turn. Nine small marks, the same on every screen. A state is never shown by colour alone: a word always sits beside it.

- Detail opens beside the list. One sheet at a time, on the right. The list does not move. Esc closes the sheet and puts you back on the row.

- Ask from anywhere. The ask line is on every screen. It takes a question, a task, or the name of a thing to open.

- Unknown is never zero, and a guess never looks like a fact. A month that is not loaded says "not loaded yet". A guess carries the label Guess and an open amber square. A what-if and a projection each carry their own label.

- Nothing loops and nothing blinks. Motion is short and happens once. If something takes long, the screen says in words what it is doing.

- Plain words. Review, Approve, Not now. No clever phrases, no exclamation marks, no "I".

- Quiet look. Type on a plain background, hairlines, no cards, no pills, no colour blocks, no glow. Green appears only as Chausar's small square and as the mark of a switch that is on.

- The screen only shows, and never stores a secret. It never does arithmetic on business numbers, never reads a file, never holds a key and never talks to the network. A passphrase, a PIN, a recovery code, a PDF password or an API key passes straight to the engine once and is never shown again. The screen sends named requests to the engine and shows what comes back.

## 4. The frame

The frame is the same on every screen of the desktop app. It has five parts.

| 
Part | 
What it is | 
Size in the Guided view | 

| 
Rail | 
The seven places, the wordmark above them, and the workspace and your name below | 
216 wide | 

| 
Page | 
The content. It scrolls. Its column is centred | 
Column 720 wide. Wide pages (tables, the enterprise home) use 1010 | 

| 
Sheet | 
The detail of the row you opened. It appears on the right and scrolls on its own | 
480 wide. The list column narrows to 570 | 

| 
Ask line | 
Where you type or speak a question or a task | 
54 high, under the page, as wide as the column | 

| 
Status line | 
Three facts in small type: how fresh the sources are, which AI model is in use and how much it may be sent, and what left this computer today | 
34 high, under the ask line | 

All sizes are in ordinary screen pixels with no zoom. The pictures are drawn at 1366 by 768, which is a common size for an older laptop. This size is an assumption: no review names one.

The rail. The wordmark and the two-square mark sit at the top. The seven places follow: Today, Ask, Work, Books, Reports, Tools, Trust. The place you are in is ink; the others are grey. When a place is open, its sub-places appear under it, indented, with a hairline at the left. Only Today carries a count: the things this seat may act on now, across the whole app, one per item. A row that sums up 3 reminders counts 3. Something waiting for another person is not in your count. One count, in one place. At the foot of the rail are the workspace name and who you are ("Demo shop. You, the owner"). Clicking it opens a small menu: switch workspace, change the view, change the language, lock now, and about this build.

The page. A small grey line at the top says where you are ("Work · Approvals") or, on Today, the date. Under it is the title, set large, with a count beside it when the page is a list. Then the content.

The sheet. A sheet opens when you click a row. Its top line says what it is and where you are in the list ("Approval · 1 of 5") and how to close it ("Close · Esc"). Its actions are at the bottom. There is only ever one sheet. If a sheet needs to show something deeper, such as the receipt behind an approval, the sheet's content is replaced and a link at the top leads back. Sheets are for reading and deciding. Anything that means working through many rows, such as the 214 rows behind a number, opens as a full page with a way back.

The ask line. Its small ink square says it is yours to use. You can type, or hold the microphone to talk. Ctrl K puts the cursor in it from anywhere. What it does is described in part 9.

The status line. Each of its three facts is a link: the first opens Sources in the Books place; the second opens Trust, Models; the third opens Trust, Network. When something unusual is true, the third fact gives way to it, for example "This laptop holds the pen".

Banners. A banner is a thin strip above the page for a condition that changes what the whole app does. It runs across the full width, above the sheet too. They are rare, and they stack in this order when more than one is true. At most two are shown; the rest fold into a line, "and 2 more", that opens them. The lock screen shows no banners. First run shows only Update needed and Demo clock.

| 
Banner | 
When | 
What it says and offers | 

| 
Chausar is driving | 
The app is exporting from another program on your screen (day 4) | 
"Chausar is driving Tally. Press Ctrl Alt Pause to stop." A Stop button. The same words and button sit in a thin strip that stays on top of the driven window, and the tray menu has Stop too. On a Mac the key is Cmd Option Pause | 

| 
Demo clock | 
A demo workspace is using a pretend date (day 3) | 
"Demo clock: 30 September 2026." Shown on every screen, every receipt and every export | 

| 
Read only | 
Another machine holds the pen (day 6) | 
"Laptop 2 holds the pen. This computer is read only." Ask for the pen | 

| 
Sending is closed | 
After a restore, until every action in the gap is checked (day 7) | 
"Restored from the backup of 28 September. Sending is closed until 3 actions are checked." Check them | 

| 
Jobs are paused | 
Background mode is off and the window was closed (day 7) | 
On the next open: "Jobs were paused while Chausar was closed." It clears when dismissed | 

| 
Update needed | 
A preview build has passed its expiry date, or a release was withdrawn (day 1, day 10) | 
"This preview build expired on 12 October. Update to keep using sources and actions." Update now | 

| 
No connection | 
A step is waiting for the network (day 7) | 
"No connection. Answers from your books still work. Questions in plain words are waiting." | 

The lock screen. The app has its own lock. The lock screen shows the mark, the workspace name, one field for the passphrase or PIN, and a link to unlock with Windows Hello or Touch ID where the computer has it. Under the field: "Forgot it? Use your recovery kit." From day 6 a second link reads "Ask your recovery contact". The app locks itself after a time without use. The time is a setting; ten minutes is proposed as the default. Background jobs are the reason a person may want it longer, and the setting says so.

While the app is locked, work follows one rule. A job that needs a connector token or an AI model pauses and resumes when the app is unlocked. A step that runs on this computer with no key, such as checking a file already read, keeps running. A scheduled read always needs a key, so it waits. The lock screen says this in one line, and the tray icon shows "Paused while locked".

Other window sizes.

| 
Width of the window | 
What changes | 

| 
1316 and wider | 
As drawn | 

| 
1024 to 1315 | 
The rail narrows to 176 and the column to 640. A sheet covers the list instead of sitting beside it | 

| 
Under 1024 | 
The rail becomes a bar across the top: the wordmark, the name of the place you are in (a menu), and the count. The page uses the full width. A sheet fills the screen. This layout is designed down to 360 wide: lists become one column, charts stack, and a wide table scrolls sideways inside its own box | 

The same rules apply when a person zooms in. The app honours the text size set in the operating system and its own zoom from 80 to 200 percent. At 150 percent and above on a small screen it behaves as the narrow layout does.

First run has no rail. It has a top bar with the wordmark and the language choice, and a line of six steps across the page.

## 5. The seven places

The seven places and what lives in each

| 
Place | 
What you do there | 
Sub-places | 

| 
Today | 
See what needs you, how things stand, and what happened | 
Today, Activity | 

| 
Ask | 
Ask a question, look at saved answers, record decisions | 
New, Saved, Decisions, Checks, Not yet | 

| 
Work | 
Say yes or no to actions, and watch jobs | 
Approvals, Jobs, Actions, What it can do | 

| 
Books | 
Look after the data and what it means | 
Sources, Meanings, Accounts, Customers, History, Memory | 

| 
Reports | 
Make and send the papers other people ask for | 
Packs, The week ahead, Due dates, Exports | 

| 
Tools | 
Add what Chausar does not have | 
Small apps, Plugins, Other assistants, Phone | 

| 
Trust | 
Set what Chausar may see, send, keep and do, and check what it did | 
Rules, People, Models, Network, Record, Sharing, Vault | 

What lives in each sub-place:

| 
Sub-place | 
Holds | 

| 
Today · Today | 
Awaiting your review, worth a look, this month in three charts, earlier today on one line | 

| 
Today · Activity | 
Everything that happened, newest first, one sentence per step, each opening its proof | 

| 
Ask · New | 
The ask page: suggested questions from the menu of calculations, then the answer | 

| 
Ask · Saved | 
Saved answers, saved "why" investigations and saved what-ifs, each with its date and a stale mark when it may be out of date | 

| 
Ask · Decisions | 
The decision journal, and the inbox of drafts to confirm and decisions due for review | 

| 
Ask · Checks | 
Your own questions with known answers, run again whenever the model, a meaning, a recipe or the app changes | 

| 
Ask · Not yet | 
Questions no calculation covers yet, and actions not in the list yet | 

| 
Work · Approvals | 
Everything awaiting your review that is an action or a job | 

| 
Work · Jobs | 
Jobs that are running, paused, set aside or finished, and jobs Chausar proposes | 

| 
Work · Actions | 
The record of every action: prepared, approved, done, read back | 

| 
Work · What it can do | 
The written list of actions, one row per action per system, with its status | 

| 
Books · Sources | 
Each connected system and file, how fresh it is, what is loaded, what was refused | 

| 
Books · Meanings | 
Your business words and what each one means, with drafts and releases | 

| 
Books · Accounts | 
The chart of accounts, sorted into classes, with proposals to confirm | 

| 
Books · Customers | 
Customers, suppliers and items: one page per record, matches to confirm, sources that disagree | 

| 
Books · History | 
What you knew on any past date, every version of a record, and answers that have gone stale | 

| 
Books · Memory | 
What Chausar believes about you and the business, each line with its source, an edit and a delete | 

| 
Reports · Packs | 
The lender pack, the CA pack and the investor update | 

| 
Reports · The week ahead | 
The weekly brief, the Friday review, and their rhythm | 

| 
Reports · Due dates | 
The compliance calendar: each date with its official source and when it was last checked | 

| 
Reports · Exports | 
Export everything, and the list of what was exported | 

| 
Tools · Small apps | 
Apps made from one line, and the follow-up book | 

| 
Tools · Plugins | 
Add-ons from other people, language packs, and imported skills | 

| 
Tools · Other assistants | 
Letting another AI assistant ask Chausar for numbers with receipts | 

| 
Tools · Phone | 
WhatsApp and mail: what is switched on, what a message says, how many were sent | 

| 
Trust · Rules | 
See, Send, Keep, Do. The four switches that limit everything | 

| 
Trust · People | 
Seats, invites, machines, and who holds the pen | 

| 
Trust · Models | 
Each route to an AI model: its health, its terms, its cost, and the order you try them in | 

| 
Trust · Network | 
Every call that left this computer: where it went, why, and whether it was allowed | 

| 
Trust · Record | 
Who did what, when and why, in a record that shows tampering | 

| 
Trust · Sharing | 
What you share with Chausar, if you share: the exact file, and what was shared so far | 

| 
Trust · Vault | 
Backup, restore, recovery kit, lock, updates, delete, and what the paid plan can see | 

Where the plan says "in the trust panel". The day files often put a screen "in the trust panel". In this design the rule lives in Trust and the thing itself lives where the work is.

| 
The plan says | 
In this design | 

| 
The job appears in the trust panel with pause, edit and delete | 
Work · Jobs. Trust · Rules shows the limit (at most 10 active jobs) and links there | 

| 
The action catalogue screen in the trust panel | 
Work · What it can do. Trust · Rules, Do links to it | 

| 
My checks results appear in the trust panel | 
Ask · Checks. Trust · Models shows the last result after a change of model | 

| 
The What I shared page sits in the trust panel | 
Trust · Sharing | 

| 
The machines list and the seats list in the trust panel | 
Trust · People | 

| 
The network list in the trust panel | 
Trust · Network | 

| 
The autonomy screen | 
Trust · Rules, under Do | 

| 
The missed brief rule, shown in the trust panel | 
Reports · The week ahead (the rhythm), with the general missed-run rule on each job in Work · Jobs | 

| 
Route cards and route health in the trust panel | 
Trust · Models | 

| 
The switches for delivering briefs by mail and WhatsApp | 
Reports · The week ahead, rhythm and delivery (RP-05). Trust · Rules, Send shows that they exist and links there | 

| 
The switch that lets other assistants ask for numbers | 
Tools · Other assistants (TL-08). Trust · Network lists every call they make | 

| 
The phone opt-in | 
Tools · Phone (TL-09) | 

| 
Limits: reminder caps, the active jobs limit, the monthly AI cap | 
Trust · Rules, Do, in its Limits group (TR-05) | 

Nothing is removed. The four questions of the trust panel (see, send, keep, do) stay on one screen, Trust · Rules.

## 6. The look

The look comes from the website's approved brand, adapted for an app that is used all day in light or dark. The one stylesheet that draws all 19 pictures is system/app.css; every value below is in it.

### Colours

Each colour is a named token with a light and a dark value. The screen follows the computer's setting. Contrast is measured against the background.

| 
Token | 
Use | 
Light | 
Contrast | 
Dark | 
Contrast | 

| 
bg | 
The background | 
#F7F8F8 | 
| 
#070809 | 
| 

| 
fg | 
Main text, your square, primary buttons | 
#0B0D0E | 
18.3 | 
#E8EBEE | 
16.8 | 

| 
fg2 | 
Second-level text | 
#3B4247 | 
9.6 | 
#B7BCC1 | 
10.5 | 

| 
mute | 
Notes, labels, places you are not in. Also every mark a person must see to use the screen, since it meets 3 to 1: a field's underline, the off square, a month not loaded yet, a step not reached yet, and another person's filled square | 
#646B71 | 
5.1 | 
#8B9197 | 
6.3 | 

| 
line | 
Hairlines between rows | 
#E9ECEE | 
| 
#15191C | 
| 

| 
line2 | 
Stronger hairlines, quiet button outlines | 
#D5DADE | 
| 
#262D32 | 
| 

| 
cha | 
Chausar's square. Nothing else | 
#0B9A5C | 
3.4 | 
#46F09B | 
13.6 | 

| 
amber | 
The not-sure square | 
#B26A00 | 
4.0 | 
#E0A43C | 
9.1 | 

| 
amber-t | 
Amber text, used for a warning label | 
#8F5B00 | 
5.4 | 
#E0A43C | 
9.1 | 

| 
red | 
Text for something that failed or will destroy | 
#C0322B | 
5.3 | 
#E24B4A | 
5.1 | 

| 
dim | 
The grey in charts | 
#868D93 | 
3.2 | 
#5E666C | 
3.4 | 

Every text colour passes 4.5 to 1 in both themes. Green and amber fills pass 3 to 1, the level for marks that are not text, so in the light theme green is never used for text. Hairlines are decoration: no control depends on a hairline alone to be found. When the computer asks for more contrast, line takes the value of line2 and line2 takes the value of mute.

### Type

| 
Use | 
Face | 
Size and weight | 

| 
Reading text | 
Instrument Sans | 
15, line height 1.5 | 

| 
Row text | 
Instrument Sans | 
16 | 

| 
Page title | 
Instrument Sans, medium | 
30, tight | 

| 
Sheet title, section title | 
Instrument Sans, medium | 
22 | 

| 
Notes and the line that says where you are | 
Instrument Sans | 
13 to 14 | 

| 
Figures, dates, times | 
DM Mono, digits of equal width | 
15 in rows, 20 in a chart tile, 34 for the one big figure of an answer | 

| 
Small labels | 
DM Mono, capitals, slightly spaced | 
11.5 | 

| 
Hindi and other Devanagari text | 
Noto Sans Devanagari | 
Same sizes, taller lines, no tightening | 

| 
The wordmark | 
IBM Plex Mono, medium | 
14. Used for the word "chausar" and nothing else | 

The four font files ship inside the app. The app never fetches a font from the network. Each face has a fallback per script. DM Mono is used for digits and Latin letters only; Devanagari text in a place set in the number face falls to Noto Sans Devanagari. When a bundled face is missing, the reading face falls to Segoe UI or the system's sans, and the number face to Cascadia Mono or Consolas.

### The squares

The nine squares and what each one means

| 
Square | 
Means | 
Examples | 

| 
Filled green | 
Chausar did this. On a switch: on | 
"06:00 Tally read", a finished job step, a switch set to Yes | 

| 
Filled ink | 
You did this, or this is yours | 
"You said: skip the disputed invoice", the ask line | 

| 
Filled grey | 
Another person did this, or it is theirs | 
A cofounder on Trust, People; "Anil Demo prepared this" | 

| 
Open ink | 
Awaiting your review | 
An approval, a proposal, a result to accept | 

| 
Open green | 
Chausar's turn, not finished | 
Reading a source, waiting for the network | 

| 
Larger open square | 
The step you are on. Ink when it is your turn, green when it is Chausar's | 
Approve on an approval; Meanings in first run | 

| 
Filled amber | 
Not sure. Needs a look or an answer | 
A refused file, a question about an account, an action whose result is unknown | 

| 
Open amber | 
A guess, not measured | 
A possible cause on the why page | 

| 
Open grey | 
Off, not connected, did not happen, or not reached yet | 
A source not connected, a permission set to No, a step stopped by a rule, a later step | 

A square is 8 pixels, with slightly rounded corners. In the Simple view it is 10. The step you are on is 11, or 13 in the Simple view. The square is hidden from screen readers; the state is always also in words.

### Rows

A row is the basic unit. It has four slots: the square, what it is with a short grey note after it, the figure at the right in the number face, and a small arrow.

- A row is one line in the Guided and Books views. If the words do not fit they are cut with three dots, and the full text is in the sheet. In the Simple view and on the phone a row may take two lines before it is cut, because Hindi lines run longer.

- A row is 54 high in Guided, 68 in Simple. In the Books view, rows become table rows 32 high.

- Clicking a row, or pressing Enter on it, opens its sheet. The row turns medium weight while its sheet is open.

- On Today, a row can open in place instead: one more line of detail and the Review button appear under it. This is the founder's "rows that open". It is used where one line and one button are enough.

- Rows sit between hairlines. There are no boxes around rows and no alternating shading.

### The sheet, the receipt and the approval

The receipt is the proof behind a number, and it looks like a till receipt: figures in the number face, a rule above the total, and small print under a dashed line. From top to bottom it shows:

- How it was worked out, as four marks on a line: your question, the calculation chosen, the rows read ("217 rows read", which is the rows counted and the rows left out together), the total checked.

- The calculation, the period, and the date and time it was known ("As known on 30 Sep 2026, 09:14").

- Rows counted and rows left out, with the reason for each group left out.

- The total.

- Small print, in this order:

- the source, the way in (its own interface, an exported file, or Chausar driving the program on your screen) and how old it is;

- the recipe, its state and who accepted it, with the grade of that label ("Recipe tested · accepted by you");

- the meaning used, and who published, reviewed and co-signed it;

- for another currency, the rate used and its date;

- for a forecast, the method, the months it learned from and the months held back to test it;

- how many numbers in the written answer match the receipt;

- the decision that allowed it: the rule's id, which of the five checks decided, the person, the device and the time. The short line "Allowed by" is there from day 1; the full decision arrives on day 6;

- which model route and send level were used, what it cost, and the receipt's id.

- Two links: open the rows, and export.

An answer with its receipt beside it

The approval shows one exact change. From top to bottom:

- What it is, in plain words ("Send a payment reminder"), with its tier word beside it.

- The target: who or what it touches.

- The reason it waits: the rule that made it wait, in one line ("Waits because messages to outsiders always wait").

- The exact change. For a message, the text exactly as it will be sent, in the number face with a hairline at the left. For a change to a record, before and after side by side, with the old value struck through.

- The five steps on a line: Prepared, Approved, Done, Read back, Recorded. The step you are on has the larger open square: ink while it waits for your Approve, green once it is Chausar's turn. "Approve" is the word on the button; "Approved" is the step.

- One note: what it changes and what it does not ("Nothing changes in your books"), and when the approval expires or is cancelled ("Expires in 24 hours, or sooner if the invoice changes"). The proposed defaults are 24 hours for a message to an outsider and 7 days for a change inside the workspace; the founder settles them on day 7. An approval that expires becomes a worth-a-look row on Today.

- Two buttons: Approve and Not now. Two links beside them: Change and Drop.

An approval, open beside the list

### Time lines

Whenever the app shows what happened, it uses a time line.

- Across the page, for a day: up to six marks on a hairline, each with its time, two words and a small figure. Today uses this for "Earlier today". Older marks fold into the first one.

- Down the page, for a long history: one row per step with its square, its date, one sentence, and its cost in rupees at the right. A job, the activity list, the record and the versions of an invoice all use this.

### Charts

Charts are quiet: thin marks, one baseline, no grid, no frame, and a label only where it helps.

| 
Rule | 
Detail | 

| 
Colour | 
The thing the chart is about is ink. The rest is grey. Ages and stages use four steps from ink to light grey | 

| 
Hues | 
Used only when two or three named series must be told apart, in a fixed order: blue, magenta, violet. Never more than three. The three were checked for colour-blind readers on both backgrounds | 

| 
Status colours | 
Green, amber and red are never used for a series | 

| 
Marks | 
Bars at most 24 wide with the far end rounded by 4. Lines 2 thick. The last point of a line is a dot with a ring in the background colour | 

| 
Text in charts | 
In the text colours, never in a series colour | 

| 
Every value | 
Opens its receipt. The receipt is the chart's table. The click target is the whole stat tile, not a thin mark. Inside a chart, the arrow keys move from mark to mark, and on hover or focus a small label shows the exact value | 

| 
Comparisons | 
Always state their basis: "down 18% vs August, same days" | 

| 
The lightest marks | 
The lightest grey and the light-theme magenta are below 3 to 1 against the background, so a mark in either always carries a written label | 

| 
Never | 
Two scales on one chart, a pie, a 3D effect, a rainbow, a gauge, a single score that mixes unlike things | 

The chart forms in use:

| 
Form | 
Used for | 
Seen in | 

| 
Columns by month, the latest in ink | 
How a figure moved over time | 
Today, enterprise home | 

| 
Line with an end dot | 
A balance over days | 
Today (cash in bank) | 

| 
One bar in ordered greys | 
Ages or stages of one total | 
Today (overdue by age) | 

| 
Ranked bars inside rows | 
A breakdown, largest first | 
An answer by customer | 

| 
Bridge | 
Why a figure moved: start, each measured cause, end | 
Why did it change | 

| 
Line against a goal rule | 
A job's progress to its goal | 
A job | 

| 
Step line | 
What was believed over time | 
History | 

| 
Two thin bars, grey then ink | 
Before and after | 
A meaning tried on a copy | 

| 
Strip of twelve small squares | 
Which months are loaded, loading, not loaded, refused, or failed (an amber ring: the read failed, which is not the same as a file refused) | 
Sources, CA console | 

| 
A fine line in a row | 
A trend beside a figure | 
Enterprise home | 

| 
A bar with a marked line | 
A rule and an example against it | 
A meaning | 

### Drawn explanations

Where the thing to explain is a mechanism, the screen draws it with the same squares, hairlines and thin arrows: what left this computer today, who holds the pen, the locked box a plugin runs in, the three levels of what the AI model is sent (as three tiny tables), and how an answer was worked out. A drawing has at most six parts and each part has a label of one to four words.

### Motion

Five things move, each once, each under half a second. This is the one list; the builders' file and system/app.css use the same times.

| 
What | 
How | 
Time | 

| 
A chart, when its screen opens | 
Bars grow from the baseline; a line draws from left to right | 
360 ms | 

| 
A receipt, when it opens | 
Its rows appear from top to bottom | 
30 ms apart, 400 ms at most | 

| 
The step mark on the five steps | 
It moves along to the next step when the state changes | 
240 ms | 

| 
A sheet | 
It slides in from the right | 
200 ms | 

| 
A button | 
It darkens slightly when pressed | 
120 ms | 

Nothing else moves. Nothing loops: no spinner, no shimmer, no pulse. If the computer is set to reduce motion, every time is zero and everything appears at once.

### Buttons, links and forms

- One filled button at most on a page or a sheet: the main action, in ink. Other actions are quiet buttons with a hairline outline, or underlined links.

- A button's word is the action: Approve, Publish, Install, Connect. Never "OK" or "Submit".

- A destructive action is a quiet button with red text, and it asks once more in a small dialog that names the thing ("Delete Kiran Retail Demo and everything about it?").

- Text fields are a single underline in the mute colour with a label above. A yes-or-no choice is a pair of words, No and Yes, with the chosen one in ink. A choice among a few options is a row of words with the chosen one underlined.

- Keyboard focus is a 2 pixel ink outline. It is never removed.

- There are no icons except the microphone, the small arrow at the end of a row, and the squares.

- There are no pop-up messages that fade away. A result appears where the action was: the row changes its square and its note.

## 7. The words

How Chausar writes.

- Short, plain sentences. The reading level of a newspaper, not a manual.

- No "I". Chausar's lines are impersonal: "Statement refused: line 14 does not add up", not "I could not read your statement".

- No clever phrases, no exclamation marks, no emoji, no "Oops".

- Sentence case everywhere. No full stop on a label or a button.

- A message about a problem has three parts: what happened, what it means for you, what you can do. "Zoho Books sign-in ended. Answers still use what was read at 06:05. Sign in again."

- All text comes from one text file per language. No sentence is built by gluing pieces together.

The fixed words. One set of words is used on every screen.

| 
Where | 
Words | 

| 
The main list | 
Awaiting your review | 

| 
Buttons | 
Review, Approve, Not now, Change, Drop, Open, Save, Save as a check, Publish, Discard, Accept, Connect, Invite, Pause, Stop the job, Install, Remove, Export, Continue, Close, Cancel, Remind, Unlock, Update, Undo, Rebuild, Delete, Withdraw, Done, Send back, Check again, Verify, Ask a person, Send report, Don't send | 

| 
What happened (the activity list) | 
done, waiting for you, waiting for the network, not sure what happened, stopped by a rule. These five stay five; when the rule is the budget, the reason says "the budget" | 

| 
A step of an action or a job | 
not reached yet (open grey), in progress (the open green mark), done, failed, not sure what happened | 

| 
An action in the list of what it can do | 
live, experimental, prepare only, not yet | 

| 
An action in the record | 
can be undone, missed, failed | 

| 
A recipe | 
seed, tested, not yet tested, failed | 

| 
A meaning | 
proposed, draft, published. A pack that is not checked says "draft, not yet checked". A review by a second AI model says "AI opinion, not an independent review". With no second model it says "not reviewed" | 

| 
A month of a source | 
loaded, loading, not loaded yet, refused, failed | 

| 
A saved answer | 
current, stale, cannot be rebuilt | 

| 
A check | 
same, moved, cannot run | 

| 
A job | 
proposed, running, waiting for you, waiting for the network, paused, set aside, stopped by a rule (with its reason, such as the budget), stopped, ready for you to accept, accepted, sent back | 

| 
A model route | 
ready, signed out, not installed, version not tested, timed out, error, chat only, no calculations, answers only, not for actions | 

| 
A plugin | 
built in, checked by Chausar, community, blocked. An imported skill says "instructions only, no tools, untrusted" | 

| 
A language or a claim | 
supported, not yet tested, not yet reviewed | 

| 
A deleted thing, per store | 
deleted, pending, not possible, not built yet | 

| 
A machine | 
holds the pen, read only | 

| 
A build or a feature | 
preview build, partial, experimental, planned, not available yet | 

| 
A report or a calculation that does not fit | 
not applicable, with the reason ("composition scheme: no GSTR-2B") | 

| 
Labels on a statement | 
told by owner, assumption, measured, estimate, guess, "lead, not tested", tested, what if, projection, from outside, recorded later, late, practice, demo clock | 

| 
Who gave a label its grade | 
model, owner, accountant, CA, reconciled. A label proposed by a model says so until a named person accepts it | 

| 
What is missing | 
seven words, one for each missing state the engine sends: not loaded yet, not counted, not in the source (absent), left empty (null), not known (unknown), withheld, not applicable. "Cash sales not captured" is the not counted word for cash; "not agreed" is the not known word for sources that disagree | 

Numbers, money and dates.

| 
Thing | 
How it is shown | 
Example | 

| 
Money in a row, a table, a sheet or an approval | 
Rupee sign, Indian grouping, no paise unless there are some. Sheets and approvals are always exact, in every view | 
₹3,10,000 | 

| 
Money in a stat tile (Guided, Books) | 
Short form allowed: "L" for lakh and "Cr" for crore, at most two decimals, trailing zeros trimmed. The exact value is one click away | 
₹3.1 L, ₹6.08 Cr | 

| 
Money in the Simple view | 
Short form spelled out. "L" and "Cr" are never mixed with the spelled words on one screen | 
₹3.1 lakh, ₹6.08 crore, ₹3.1 लाख | 

| 
A negative amount | 
A minus sign in front. Brackets only inside a report that follows an accounting layout | 
−₹78,400 | 

| 
Debit and credit | 
In tables in the Books view and in accounting reports, a balance carries "Dr" or "Cr" after it instead of a sign. "Cr" here never means crore, because short forms are not used in those tables | 
₹48,500 Dr | 

| 
A comparison | 
Always with its basis | 
down 18% vs August, same days | 

| 
Another currency | 
As written in the source, with the rupee value beside it and the rate in the receipt | 
$1,200 · ₹1,00,500 | 

| 
A count | 
Indian grouping | 
1,24,500 rows | 

| 
A percentage | 
One decimal at most; the word "points" for a change in a percentage | 
31.4%, down 0.8 points | 

| 
A date | 
Day first, month as a word | 
30 Sep 2026; Wednesday, 30 September | 

| 
A time | 
24 hours | 
06:05 | 

| 
The financial year | 
April to March | 
FY 2026-27 | 

| 
How old data is | 
"as of" and the date, or the time it was read | 
as of 28 Sep; read 06:00 today | 

| 
Something unknown | 
Words, never a zero and never a blank | 
not loaded yet | 

Digits are Latin digits in every language. The number face keeps columns of figures lined up.

What the screen must never do. These come from the reviews of 29 September and the plan.

| 
Never | 
Why | 

| 
Show an unknown as zero | 
A missing month is not a month with no sales | 

| 
Show a number that is not on a receipt | 
The number guard removes the written explanation and puts the template explanation in its place. The figures stay, because they come from the receipt, and the page says so | 

| 
Let the AI model write a date or a due date | 
Dates come from the published list | 

| 
Show a remote image or raw HTML, or open a link without asking | 
A picture link in an answer can leak data when it is drawn | 

| 
Put a figure, a count, a name or a date of money in a WhatsApp or mail message | 
Messages carry a headline and a link: "Something is ready for your review." A test fails on any digit in a message body | 

| 
Show an Approve button outside the app for anything but one small change that can be undone | 
A group, money, an outside message, deleting and anything on the always-waits list (TR-05) say "Open the app" | 

| 
Offer a switch to let anything on the always-waits list (TR-05) run on its own, or one switch that makes everything run on its own | 
They always wait for a person. The Do presets are starting points that set the switch for each kind | 

| 
Say an answer "cannot be wrong" | 
Say "the AI does not do the maths" | 

| 
Say "Nothing goes to our servers" | 
Say "Your business data stays on your disk unless you choose to send it" | 

| 
Switch to another AI model on its own | 
The person sets the order and each step down is visible | 

| 
Show a paid service as available when it is planned | 
Say "planned, not available yet" | 

| 
Make a readiness page look like a loan offer | 
It says "this is not a loan offer or a promise of one" | 

| 
Ask for consent with one "help improve Chausar" tick box | 
Consent is separate boxes that start empty, shown after the first receipt | 

| 
Use a real-looking business name in a demo | 
Demo names end in "Demo" | 

| 
Lock local data when a paid plan ends | 
The plan ends, the data stays | 

## 8. One app, three views

One app, three views

A view changes how much is on the screen and how you move. It never changes what is true, what is allowed or what a receipt says. Each person picks a view on each device, and can change it at any time from the foot of the rail.

| 
| 
Simple | 
Guided | 
Books | 

| 
For | 
A shop owner who is not at ease with software | 
A founder or owner. The default | 
An accountant, a CA, a finance person | 

| 
Reading size | 
18 | 
15 | 
13.5 | 

| 
Places in the rail | 
Four: Today, Ask, Work, More | 
Seven | 
Seven | 

| 
Lists | 
Tall rows, one action each | 
Rows | 
Tables with many columns, including "as written in the source" | 

| 
Charts | 
One at a time, large | 
Three small ones on Today, one per page elsewhere | 
Only where asked for. Tables come first | 

| 
How you ask | 
Voice first: a "Hold to talk" button beside the ask line | 
Type, or hold the microphone | 
Type. Ctrl K. Arrow keys move, Enter opens | 

| 
Money | 
Short form spelled out in rows: ₹3.1 लाख. Sheets and approvals exact | 
Full figures in rows and sheets. A stat tile may use ₹3.1 L, with the exact value one click away | 
Full figures, paise where they exist, Dr and Cr in tables | 

| 
Extra on Today | 
Enter today's cash sales, the week's cash as bars | 
Three charts, earlier today | 
The month's close as a checklist: bank, GST, TDS, trial balance | 

| 
Status line | 
Two plain sentences | 
Three short facts | 
Three short facts and the keys that work here | 

Today in the Simple view, in Hindi

Today in the Books view, for an accountant

In Simple, the place called More holds Books, Reports, Tools and Trust as four rows. Nothing is hidden for good: every screen can be reached, in the same big type.

View and language are separate choices. Simple in English and Books in Hindi both work. A new seat starts in a likely view: Books for an accountant or a CA, Simple for staff who only add entries, Guided for the owner and a cofounder. The person can change it.

## 9. How the main journeys work on the screen

Each journey below says what the person sees, step by step, and names the part of the architecture behind it. The full list of screens and states is in the Screens file.

Setup, step five: agree what your words mean

### First run: from install to a first answer

Six steps on one line across the top: You, Vault, Model, Your books, Meanings, First answer. The step you are on has the larger open square, the same mark that moves along the five steps of an action. It is ink here, because each step is your turn. Finished steps are filled grey dots.

- You. Choose the language and the view. Say whether you have a business or an idea. If you have a business, fill the business identity card (PAN, GSTIN, Udyam number and the like, each optional, each checked for its format only) and the GST mode. These answers are held in memory until the vault exists and are written at step 2. Leaving before step 2 stores nothing.

- Vault. Name the workspace and choose a passphrase. The app checks that the disk is encrypted and says what it found. Then the recovery kit is shown once: a code to print, in Hindi and English. You tick that you have kept it.

- Model. One row per route to an AI model, with its health: your own Codex or Claude Code tool, an API key, a local model. An API key goes straight to the engine and is never shown again. You can skip this step: imports, the menu of calculations, receipts and backup work without a model. This step also shows the send level the app starts with: shape only.

- Your books. Pick a starter pack for your kind of business. Bring a file, or connect a system. If the file is in a layout Chausar does not know, a screen asks which column is the date, the customer and the amount. The result says how many rows were taken, flagged and refused, and why.

- Meanings. Chausar proposes what your words mean, how the file maps to them, and how your accounts are sorted. Each proposal is a row with its evidence. You accept or change each one. Nothing is accepted without your click. A line at the bottom lists what is blocked and what would unblock it.

- First answer. One suggested question. The answer appears with its receipt open.

After the first receipt, and never before, one screen asks whether you want to share anything with Chausar. Every box starts empty.

You can leave setup at any step. Today then carries a row, "Setup: step 5 of 6", that takes you back to where you were. A founder with an idea and no business gets a different middle: a conversation that ends in a saved draft of the business, with every line marked "told by owner" or "assumption", the unknowns listed, and a setup checklist from a dated rule table.

The architecture behind this: the vault (piece 2), the brain connection (piece 3), the dictionary and the setup guide (piece 5), the translators (piece 6).

### Ask a question, get a receipt

A question on the screen, from the ask line to the answer

- You type or say a question in the ask line.

- The page shows the question as its title, and under it one line that says what Chausar understood: the calculation, the period, and who or what is counted. "Invoiced by customer · August 2026." A Change link sits beside it. This line appears before anything is worked out.

- If the question could mean two things, Chausar asks one question back, with the choices as rows. It asks once.

- The answer appears: one big figure, a chart or ranked bars, and one line that says the numbers were checked against the receipt and how many rows were counted and left out.

- The receipt opens beside it when you click any figure.

- You can save the answer, or save it as a check.

When no calculation fits, the page says so and stops: "Not yet. No calculation covers this. It is on the wanted list." A button offers to pack the question for a person, such as your accountant. When a rule stops the answer, the page names the rule. When part of the data is missing, the answer gives the numbers it can and says "not loaded yet" for the rest.

When you speak, the words appear as text. Any amount or date that was heard is shown back for you to confirm before anything runs.

The architecture behind this: the brain connection chooses a calculation and fills a form; the calculator (piece 8) runs it; the number guard checks every number in the written explanation against the receipt. If one does not match, the written explanation is removed and the template explanation takes its place. The figures stay, because they come from the receipt, and the page says so.

Why collections fell: what is measured, and beside it what is a guess

### Why did it change

A why-question opens a page with two parts that are never mixed. On the left, what is measured, as a bridge chart: the figure before, each measured cause with its amount, the figure after. Every bar opens its receipt. On the right, possible causes, under the label Guess, each with an open amber square and the evidence for and against it. A guess has no figure.

From here you can record a decision in one sentence. A what-if looks the same as an answer but carries the label "What if" on the page and on its receipt, and shows the assumption that was changed. A forecast is drawn beside a simple baseline (last year's pattern); if the forecast was worse than the baseline on months held back, the page shows the baseline and says so.

### Approve an action

The five steps of an action, as the person sees them

- The action appears as a row under "Awaiting your review", on Today and in Work, Approvals. Tier 2 items come first, then tier 1, then prepare-only items last. The tier word is on the row and on the sheet.

- You open it. The sheet shows the exact change and the rule that made it wait (see part 6).

- You click Approve. For anything that moves or records money, the app asks for your passphrase, PIN or fingerprint first.

- The step mark moves along: Approved, Done, Read back, Recorded. It turns green once the turn is Chausar's. The row's square turns green at the end.

- If the app cannot tell whether it went through, the step turns amber and says "Not sure it went out. Checking before trying again." It never sends again without looking.

Small changes that stay inside your own workspace and can be undone are shown together: one sheet, up to ten items, each with its before and after and its own tick. Inside that sheet each item is its own approval, and the result comes back item by item. Everything on the always-waits list (TR-05) is never grouped and never runs on its own. Tax filings are never sent by Chausar: the sheet offers the prepared file and a checklist, and says that you or your CA files it.

If you change anything the approval was for, the approval is gone and the action goes back to Prepared. If you approve three in a row faster than they can be read, the next sheet says so.

The architecture behind this: the hands (piece 10) and the always-waits list (piece 4, shown in TR-05).

A job: its goal, its progress and what each step cost

### Give it a job

A job has a page of its own. At the top, four facts: the goal, how far it is, the budget in rupees, and when it stops. Under them a chart of the thing the job is meant to move, against its goal. Then the time line: one sentence per step, who did it, and what it cost. At the bottom, what comes next, and two buttons: Pause, and Stop the job.

A job that is stuck stops and asks. Its row on Today says why in plain words: it needs an action that is not on its card, its AI model route is down, an instruction could mean two things, or its budget is spent. A job is finished only when you accept its result.

The architecture behind this: jobs (piece 11).

Sources: what is loaded, month by month

### Connect a source, and see how fresh it is

Books, Sources is one table: each system or file, when it was last read, a strip of twelve small squares for the last twelve months, and anything to look at. A filled square is a loaded month, an open grey one is not loaded yet, a filled amber one was refused, and an amber ring means the read failed. Adding a source asks which system, which way in (its own interface, an exported file, or Chausar driving the program on your screen while you watch), and where it lives.

A file that does not add up is refused, and the screen says where: "Statement refused. The balance breaks at line 14." A file read from an export is labelled "file", never shown as a live connection.

A meaning, with a change tried on a copy (experimental, day 3)

### Change what a word means

A meaning has a page: the word, what it counts, in plain words, and the same as data for those who want it. A change is a draft. From day 2 the page shows the old rule struck through beside the new one, one worked example as a small drawing, the change in plain words, and the list of calculations and saved answers it affects. From day 3, as an experimental step, the change can be tried on a copy of your books: a table then shows your saved questions as they are now and as they would be with the change. Nothing real has changed yet. Publish switches it on everywhere at once. Discard throws the draft away.

Sales in March: as known on 10 April, and as known now

### Look back in time

Books, History puts two figures side by side: what you knew on a past date, and what you know now. Each has its receipt. Under them a step line shows when the belief changed and what changed it: a correction, or a credit note. You can choose another date, or open every version of one record.

Trust: the four rules, and what left this computer today

### Set the rules

Trust, Rules is four rows: See, Send, Keep, Do. Each says its setting in a few words and opens to show its choices. Send opens to three tiny tables that show, on your own data, what the AI model would receive at each level: nothing, the shape only, or small samples. Under the four rows, a drawing shows what left this computer today.

## 10. States every screen must handle

Every screen is designed for these states, with these words. A screen's own special states are in the Screens file.

| 
State | 
What the person sees | 

| 
First use, nothing here yet | 
One line that says what will be here, and one action. "Nothing awaits your review." "No sources yet. Add a source." | 

| 
Loading | 
The frame at once. What was known last time, with its time. The status line says what is being read. No spinner | 

| 
Ready | 
The screen as drawn | 

| 
Partly loaded | 
The numbers that exist, and "not loaded yet" in words for the rest. The coverage line says what is missing | 

| 
No change | 
"No change since Monday." This is different from not knowing | 

| 
Not enough to tell | 
"Not enough loaded to tell. 3 months are not loaded yet." With the action that would fix it | 

| 
Stale | 
The old result with its date and the label stale. A Rebuild link | 

| 
Not yet | 
"Not yet. No calculation covers this." What was asked is added to the wanted list | 

| 
Stopped by a rule | 
The name of the rule in plain words, and who can change it. When the rule is a budget, the reason says "the budget" | 

| 
Not applicable | 
"Not applicable" and the reason, for example "This business is in the composition scheme, so there is no GSTR-2B to match" | 

| 
Failed | 
What happened, what it means, what to do. A code in small type. Never the raw error text | 

| 
Waiting for the network | 
The step shows an open green square and "waiting for the network". Work that needs no network carries on | 

| 
Read only | 
A banner. Buttons that change things are not shown; the page says who holds the pen | 

| 
Hidden from this seat | 
"Some rows are hidden from your seat." If a total would let someone work out fewer than three hidden rows, the total is not shown, and the page says why | 

| 
Access removed | 
Opening a page checks access again. "Access removed by Meera Demo on 2 Oct." | 

| 
Seat ended | 
"This seat ended on 31 Oct." What was already copied or exported stays with that person | 

| 
Locked | 
The lock screen | 

| 
Feature not built yet | 
During the ten days, a screen whose engine part is missing says which part and which day brings it | 

## 11. Reaching everyone

Keyboard. Everything can be done without a mouse.

| 
Windows | 
Mac | 
What they do | 

| 
Ctrl K | 
Cmd K | 
Go to the ask line | 

| 
Ctrl 1 to Ctrl 7 | 
Cmd 1 to Cmd 7 | 
Go to a place | 

| 
Up and Down | 
Up and Down | 
Move between rows | 

| 
Enter | 
Enter | 
Open the row's sheet | 

| 
Esc | 
Esc | 
Close the sheet and return to the row | 

| 
Alt Down, Alt Up | 
Option Down, Option Up | 
Next and previous item while a sheet is open | 

| 
Ctrl Enter | 
Cmd Enter | 
The main action of the sheet. Never for money, which always asks again | 

| 
Hold Ctrl Space | 
Hold Option Space | 
Talk. On a Mac, Cmd Space and Ctrl Space belong to the system | 

| 
Ctrl Alt Pause | 
Cmd Option Pause | 
Stop Chausar driving another program. Works from any window | 

| 
F6 | 
F6 | 
Move between the rail, the page, the sheet and the ask line | 

| 
Ctrl / | 
Cmd / | 
Show this list | 

Screen readers. The rail is a navigation landmark, the page is the main landmark, the sheet is a labelled region, and the ask line is a search landmark. Opening a sheet moves the focus to its title; closing it returns the focus to the row. The status line and any result that arrives later are read out when the screen reader is free, without cutting in. A chart has a label that states what it shows in one sentence, and its receipt is its table. A figure is read as an amount in words. Text in Hindi is marked as Hindi so it is read in the right voice.

Seeing. Text contrast is at least 4.5 to 1 in both themes. A state is never shown by colour alone. The app follows the computer's settings for text size, for more contrast and for less motion. It works at 200 percent zoom. Things you click are at least 24 by 24.

The working target is WCAG 2.2 level AA. The final plan says a level must be chosen before any claim is made, so this is a proposal for the founder. On day 10 the first journey is run with the keyboard only and then with a screen reader, as the plan asks.

Languages. All screen text exists in English and Hindi from day 1. Hinglish comes as a language pack on day 9, and other languages after day 10 as packs with their own test sets. Hindi lines are longer and taller than English ones, so rows in the Simple view may wrap to a second line and no button has a fixed width. Five things have a language, and each is set on its own.

| 
What | 
Its language | 

| 
Screen text | 
The person's choice, per device | 

| 
Voice | 
What the person speaks; Hindi, English or a mix | 

| 
Meanings | 
Each word has a name in English and in Hindi; the meaning itself is the same | 

| 
Reports | 
Chosen per report, so a CA can get English while the owner reads Hindi | 

| 
The data as written | 
Never translated. Names and narration from the books are shown as written, in whatever script they are in | 

Old computers. The app must stay usable on a Windows 10 laptop with 4 GB of memory beside Tally. The design helps: plain screens with no images, no icon font, no animation loops, charts drawn as a few plain shapes, long lists drawn only for the rows on screen. The speed limits are in the builders' file.

Printing. Reports and the recovery kit have a print layout: black on white, the business name, page numbers, and in the footer of a report a short check code from the tamper-evident record, with its time.

## 12. The phone

What reaches the phone, and what never does

The desktop is the engine. In the ten days the phone gets three things.

- Messages by WhatsApp and mail, from fixed templates: the week ahead is ready; something is ready for your review; a document was received; a due date is near. A message is a headline and a link. It never carries an amount, a count, a name or a date of money. "4 bank matches are ready" is written "Something is ready for your review." A test fails on any digit in a message body.

- Simple approvals. A message about one small change that stays inside your workspace and can be undone has three buttons: Approve, Not now, Open the app. Everything else has one: Open the app. That includes a group of small changes, money, an outside message, deleting, and anything on the always-waits list (TR-05). Each button works once and expires after 30 minutes.

- The link page. The link opens a plain page that holds no data and hands over to the app on your computer. A changed or expired link opens nothing.

What a message says

Free text sent to the number gets one fixed reply with a link to the app, and the words "Reply HELP for a person, STOP to end messages". Tools, Phone shows what is switched on, the exact text of each message before the first one is sent, your opt-in, how many messages went this month against the budget of 30, and what each cost.

After day 10 the phone can get a page of its own, paired to the desktop: the list of what is awaiting your review, simple approvals, and the week ahead as headlines. Figures and receipts stay on the computer. This page is drawn so the design is ready; whether and when to build it is the founder's decision.

The paired phone page, proposed for after day 10

## 13. The enterprise version and the CA console

The enterprise version is the same app. It runs in a browser against a company's own server. People sign in with the company account. The seven places stay, and each person sees first what their role needs. Four things are added to the frame: a lens at the top of Today (whole group, or one function); a company switcher for the group's companies; "Whose", three words on every list (Mine, My team, Everyone); and an eighth place called Company for whoever looks after the installation. Trust also gains sub-places for access, markings, retention and channels; these are listed in the enterprise file.

The enterprise home

The CA console is the same app with a list of clients in front. A firm sees each client's status: when the books were last read, how far the month's close has got, how many things are awaiting the firm, and what is due next. It sees no figures there. Each client's books stay in that client's own vault, and opening a client means stepping into that client's workspace with the seat the client gave.

The CA console: eighty clients, status only

The full design, including where each of the 176 enterprise surfaces lives, is in the Enterprise and CA console file.

## 14. For the builders, in short

The technical part is in its own file so that this one stays plain. In short:

- A clean start on the same tools. Electron, React, TypeScript and Vite, as the fleet already uses. Plain CSS built on the tokens in system/app.css. No component kit with its own look.

- Four layers. Tokens, then parts (square, row, sheet, receipt, chart), then patterns (a list with a sheet, an answer, an approval), then screens. A screen is made only of patterns and parts.

- The screen only shows. All data comes through one typed list of named messages to the engine, and every reply is checked before it is shown. The list grows from the day 1 contract; the proposed messages are in the builders' file, grouped by name and by day.

- Numbers never pass through arithmetic on the screen. Money arrives as whole paise in a string and is only formatted.

- Tests that check the design. Pictures of every screen in both themes and all three views; a word count per screen; a check that every figure opens a receipt; a keyboard-only run of the first journey; a check for missing Hindi text.

- Build order. First the frame and the parts, then each day's screens in the order of the ten days.

How the screen and the engine talk

## 15. What is still open

Fable's choices that the founder may want to reverse.

| 
# | 
Choice | 
Reason | 
The other way | 

| 
1 | 
The pictures are drawn at 1366 by 768 and tested at 1366 by 768 and 1024 by 768. The narrow layout is designed down to 360 wide | 
No review names a size; this is a common old laptop | 
Pick a size after measuring the test laptop | 

| 
2 | 
Chausar's own lines never say "I" | 
It reads as a tool reporting, not a character talking, which fits "not AI-ish". The plan's sentence "I cannot calculate that yet" becomes "Not yet. No calculation covers this" | 
Keep "I" for answers only | 

| 
3 | 
The fonts are bundled inside the app | 
The app must not call the network for a font, and the day 1 screens used system fonts only | 
System fonts, and lose the brand's look | 

| 
4 | 
WCAG 2.2 AA as the working target | 
The final plan asks for a level to be chosen before any claim | 
Choose another level, or name none yet | 

| 
5 | 
Auto-lock after ten minutes without use, as the default | 
No review gives a time | 
Any other time | 

| 
6 | 
Things the plan puts "in the trust panel" live where the work is, with the rule in Trust (part 5) | 
A list of jobs is work, not a rule. The four trust questions stay on one screen | 
Put them all under Trust | 

| 
7 | 
Only Today carries a count | 
One count, in one place | 
A count on every place | 

| 
8 | 
No pop-up messages and no system notifications by default. The tray icon shows the count | 
Quiet, and a message that fades is missed by slow readers and screen readers | 
Offer system notifications for money and outside messages as a switch | 

| 
9 | 
Reports gets a fourth sub-place, Due dates | 
The compliance calendar needs a home that works with no data connected | 
Keep it inside The week ahead only | 

| 
10 | 
The enterprise version adds an eighth place, Company, and keeps roles, markings and audit under Trust | 
Trust is about the data; Company is about the installation | 
Put everything for administrators in one place | 

| 
11 | 
The CA console shows status only across clients, never figures | 
Each client's books stay in that client's vault. The final plan gives every customer a separate place and no document describes a view across them | 
A hosted view across clients, which needs a decision on keeping many businesses on one server | 

| 
12 | 
The phone page paired to the desktop is drawn but marked "after day 10" | 
The plan's own recommendation is a phone app after day 10 | 
Build it inside the ten days | 

| 
13 | 
In the Simple view the rail has four places and the rest sit under More | 
Four places are enough for a shop owner | 
Seven places in every view | 

| 
14 | 
A what-if is saved under Ask, Saved, with its own label. The full strategy workspace of the enterprise version is a sub-place of Ask called Plans | 
The seven places have no Strategy place, and a what-if starts as a question | 
A place of its own | 

| 
15 | 
The demo clock is offered only in demo workspaces, and only in preview builds until the founder decides | 
A pretend date in a release build could be mistaken for a real one | 
Keep it in release builds for demo workspaces too | 

| 
16 | 
The home box machine (TR-07) is shown as experimental, with no price | 
Whether it is free or paid is not settled | 
Mark it free, or mark it paid | 

| 
17 | 
The approval expiry defaults are 24 hours for messages to outsiders and 7 days for changes inside the workspace | 
No review gives a time; a message goes stale faster than a book change | 
Any other times, set on day 7 | 

Not yet known, and not for the design to settle.

- The Hindi text needs a native reader before release.

- The names of the three approval tiers and of the daily caps are set on days 7 and 8.

- The speed targets (installer size, import time, answer time) are chosen by the founder from the bench's numbers.

- How a phone pairs with the desktop, and who owns the WhatsApp number in each plan.

- Whether a new recovery kit can be issued, and whether recovery resets the passphrase.

- Small apps and plugin screens are drawn in the locked, sandboxed frame on a separate origin, as the day 9 prompt sets out. This is no longer an open choice.

- The pages of the website that belong to the release (download, pricing, the CA sign-up) are in the website's own repository and are not designed here.

What this design does not cover. Chausar's own operator console and research console are listed in the enterprise file with the parts they would use, but not drawn. Customer-facing channels of the enterprise version (a company's own customers talking to a service agent) are given rules and a place for the staff side, not screens.

## 16. Words used in this document

| 
Word | 
Meaning | 

| 
Place | 
One of the seven sections of the app, listed in the rail | 

| 
Rail | 
The narrow list of places at the left | 

| 
Page | 
The main area, which scrolls | 

| 
Sheet | 
The panel at the right that shows the detail of the row you opened | 

| 
Ask line | 
The line at the bottom where you type or speak | 

| 
Status line | 
The small line under the ask line with three facts | 

| 
Row | 
One line in a list: square, what, note, figure | 

| 
Square | 
A small mark that says who did something and whose turn it is | 

| 
Day line | 
A time line across the page, for one day | 

| 
View | 
One of three ways the same app is shown: Simple, Guided, Books | 

| 
Banner | 
A strip above the page for a condition that affects the whole app | 

| 
At rest | 
A screen as it looks when it opens, before you click anything | 

| 
Token | 
A named value, such as a colour, that every screen uses | 

| 
Part | 
A small building block of the screen, such as a row or a receipt | 

| 
Ink | 
The main text colour: near black in the light theme, near white in the dark. Your square is ink | 

| 
Background | 
The colour behind everything, the bg token | 

| 
Seat | 
One person's way into a workspace, with what that person may do | 

| 
The pen | 
The right to write. One computer holds it at a time; the others read | 

| 
Recipe | 
How one system's fields become your business words | 

| 
Marking | 
A label such as personal, financial or confidential, put on a source file, a record page, or a field in a table. It follows the data everywhere | 

| 
Number face | 
DM Mono, the face for figures, dates and times | 

| 
Coverage line | 
The line that says how many rows were counted and left out, and what is not loaded yet | 

| 
Hairline | 
A one pixel line between rows | 

| 
Route | 
One way of reaching an AI model: your own tool, an API key, or a local model | 

| 
Starter pack | 
Ready-made meanings for one kind of business | 

| 
The bench | 
The fleet's testing lane, and the test laptop it measures on | 

| 
The Books place, the Books view | 
Two different things. The Books place is one of the seven places. The Books view is the dense way of showing the whole app for an accountant. This document always says which | 

# Chausar app: every screen

Part of the frontend design of 1 October 2026. This file lists every screen of the desktop app and the phone, 124 entries. The enterprise version and the CA console are in enterprise.md.

Find a screen

## How to read an entry

Each entry has a short code (two letters for the place, then a number), a name, and the day of the ten-day plan on which it lands.

- For says what the person comes here to do.

- Shows lists what is on the screen at rest.

- You can lists the actions.

- States lists what this screen must handle beyond the states every screen handles (see part 10 of the main file).

- Engine lists the named messages the screen needs. The full list with what each returns is in build.md.

- Rules are the things that must hold.

A picture is shown where one was drawn. The pictures are the 19 key screens; every other screen is built from the same parts.

| 
Code | 
Area | 
Entries | 

| 
SH | 
The shell: things present on every screen | 
13 | 

| 
FR | 
First run | 
14 | 

| 
TD | 
Today | 
4 | 

| 
AS | 
Ask | 
19 | 

| 
WK | 
Work | 
16 | 

| 
BK | 
Books | 
20 | 

| 
RP | 
Reports | 
8 | 

| 
TL | 
Tools | 
10 | 

| 
TR | 
Trust | 
15 | 

| 
PH | 
Phone | 
5 | 

## The shell

### SH-01The frame

Day 1.

- For: holding every screen in one steady shape.

- Shows: the rail with the seven places, the page, the ask line, the status line. A sheet when a row is open.

- You can: go to a place, open a row, close a sheet, ask.

- States: wide, medium and narrow windows (main file, part 4). Read only. Locked. Already open on this computer: a second launch brings the open window forward and opens nothing new.

- Engine: capabilities, workspaces.current, trust.leftToday, sources.freshness, models.current, review.count (day 1), approvals.count (from day 7), events.subscribe.

- Rules: only Today carries a count: the things this seat may act on now, one per item. On day 1 the count comes from review.count, which covers proposals, questions and results; approvals join it on day 7. One sheet at a time. The ask line and the status line are on every screen except first run and the lock screen.

### SH-02Lock screen

Day 1; several people and the recovery contact on day 6.

- For: keeping the books closed on a shared computer.

- Shows: the mark, the workspace name, one field, "Unlock". A link for Windows Hello or Touch ID where present. "Forgot it? Use your recovery kit." From day 6, "Ask your recovery contact". One line saying what is paused while locked.

- You can: unlock, unlock with the computer's own check, open the recovery kit flow, start recovery through your recovery contact (day 6).

- States: wrong passphrase (the field says so; no count of tries is shown). Too many tries (a wait, with the time). Locked by idle time, or by "Lock now". From day 6, more than one person on this computer: each person picks their name, then types their own passphrase, and sees only their own seat.

- Engine: vault.status, vault.unlock, vault.unlockWithDevice, vault.lock, vault.lockSettings, vault.recoveryContact (day 6), seats.onThisComputer (day 6).

- Rules: nothing from the workspace is visible behind the lock, and no banner shows on it. Keys and connector tokens are usable only while unlocked. While locked, a job that needs a connector token or an AI model pauses and resumes at unlock; a step on this computer that needs no key keeps running; scheduled reads need a key, so they wait. The line on the lock screen says so. Day 7 adds a second ask before a money action (WK-02).

### SH-03Banners

Day 1, 3, 4, 6, 7, 10.

- For: telling the person that the whole app is in an unusual condition.

- Shows: a thin strip above the page and above any open sheet, across the full width: a few words and at most one button.

- You can: in a demo workspace, open the demo clock control from the Demo clock banner: set the start date once, then Move forward by a day or a week. The clock never goes back.

- States: Chausar is driving; Demo clock; Read only; Sending is closed; Jobs are paused; Update needed; No connection. They stack in that order. At most two show; the rest fold into "and 2 more". Jobs are paused: on the next open, "Jobs were paused while Chausar was closed", which clears when dismissed. A real workspace, in place of the demo clock control: "This workspace is real. The demo clock is not available."

- Engine: session.status, history.clock, history.setClock (day 3), history.advanceClock (day 3), devices.pen, actions.afterRestore, jobs.background, updates.status, network.online.

- Rules: the Demo clock banner is on every screen, receipt and export while the test clock is in use. A real workspace can never show it. Whether release builds offer the demo clock is the founder's decision (main file, part 15). No banner shows on the lock screen. First run shows only Update needed and Demo clock. "Chausar is driving" stays for the whole session; its stop key, Ctrl Alt Pause, ends the session within one second.

### SH-04The ask line

Day 1; the suggestions grow with the menu on day 2 and day 5.

- For: asking a question, giving a task, or jumping to a thing, from any screen.

- Shows: your square, the field ("Ask a question, or give a task"), the microphone, "Ctrl K".

- You can: type and press Enter; hold the microphone, or Ctrl Space (Option Space on a Mac), to talk; pick a suggestion; Stop a question that is running.

- States: empty. Typing: up to five suggestions, each with its kind in small type (calculation, customer, place, saved answer). About something: when you ask from a customer's page the line shows "About: Kiran Retail Demo" with a way to clear it. Listening. Reading back an amount or a date (SH-05). Choosing a calculation: the line says so in words, with a Stop link. A second question while one runs: it queues under the first, "Next". Telling, not asking: a statement such as "our year starts in April" becomes a memory line to confirm (BK-17). No model connected: "No AI model connected. Pick a calculation from the menu." and the menu opens. Monthly AI cap reached: "This month's AI limit is reached. The menu still works; questions in plain words wait." with Raise the limit. Waiting for the network. Read only: questions work, tasks say who holds the pen.

- Engine: ask.suggest, ask.question, ask.stop (day 1), ask.menu, memory.propose (day 1), models.spend, models.setCap, voice.start, voice.stop, records.search.

- Rules: a question goes to Ask. A task becomes a prepared action and opens its approval sheet; nothing runs from the ask line alone. What is typed is data: text pasted from a file or a message cannot give Chausar an order.

### SH-05Talking to it

Day 1; more speech providers compared on day 8.

- For: asking by voice, in Hindi, English or a mix.

- Shows: while you hold the key, the words as they are heard. Then the question as text. Any amount or date heard is shown back large: "₹2,00,000. Is that right?" with Yes and Change. When the answer comes, it can be spoken aloud; the numbers spoken are read from the receipt, never from the written explanation.

- You can: confirm, change the text, drop a recorded voice note onto the ask line, Stop speaking.

- States: voice is off (the microphone opens Trust, Rules, Send, where it can be switched on). Paid speech in use: the cost per minute, the minutes used this month and their cost. Local speech in use: "on this computer". Could not hear: "Not sure what was said." and the words that were caught. Speaking the answer.

- Engine: voice.status, voice.start, voice.stop, voice.confirm, voice.dropNote, voice.providers, voice.speak (day 1), voice.stopSpeaking (day 1), voice.usage (day 1).

- Rules: voice is off by default. The provider and its key are chosen in the voice row of TR-08. The intent is always confirmed as text before anything runs. "Do lakh" is shown as ₹2,00,000. A sentence that ends in "nahi" changes the meaning, and the text shown must reflect it. No raw audio is kept. When Send is set to nothing or shape only, speech is turned into text on this computer.

### SH-06Workspace, view and language

Day 1 (view, language), day 6 (several workspaces).

- For: switching between businesses, and choosing how the app looks and reads.

- Shows: a small menu at the foot of the rail: the workspaces you have a seat in, each marked demo or real; the three views; the languages; Lock now; About this build.

- States: one workspace only (no list). A demo workspace (the word "demo" after its name, always).

- Engine: workspaces.list, workspaces.switch, workspaces.create, shell.setView, shell.setLanguage, updates.status.

- Rules: each workspace has its own key; nothing is read across workspaces. A workspace is marked demo or real when it is made, and the mark never changes.

### SH-07The tray icon and background mode

Day 7.

- For: keeping jobs running when the window is closed.

- Shows: a small icon in the system tray with the count of things awaiting your review. Its menu: Open Chausar, Pause jobs, Stop (while Chausar is driving), Quit. The three settings live in Trust, Vault, under "This computer": start at login (off), background mode, and wake this computer for jobs (off, experimental).

- States: background mode off: closing the window stops the engine, and the next start shows "Jobs were paused while Chausar was closed". Locked: the icon says "Paused while locked" for jobs that need a key or a model; local steps that need no key keep running.

- Engine: jobs.background, jobs.setBackground, approvals.count, shell.startAtLogin (day 7), jobs.setWake (day 7).

- Rules: scheduled jobs on the free app run only while this computer is awake. The app says so where the setting is. Auto-lock stays at the proposed ten minutes; the setting names background jobs as the reason a person may raise it.

### SH-08Updates

Day 1 (updater, preview expiry), day 3 (an old install updates itself), day 10 (hardened).

- For: staying on a safe build without losing data.

- Shows: in Trust, Vault: the version, the channel, the date the preview expires, "Check now". When an update is ready: one row on Today, "Update ready. Your data is saved first." with Update.

- States: updating (the steps in words: saving a copy, updating, checking). Rolled back: "The update did not finish. Your data is as it was." An older build meets a newer vault: "This build is older than your vault. Update Chausar to open it." and nothing is written. Update refused, with the reason: "This update was not signed by Chausar" or "This update is older than the build you have." Release withdrawn, on an install that took it: the Update needed banner, and the app goes back to the last good build with your data as it was. Mac not yet signed: "This Mac build cannot update itself yet. Download the new one."

- Engine: updates.status, updates.check, updates.apply, updates.notes.

- Rules: a running job finishes or is paused and resumed across an update. The update check is the only call the app makes by itself, and Trust, Network lists it.

### SH-09Sign in again, and a route that is down

Day 1; "resumes at" for jobs on day 7.

- For: telling the person plainly that the AI model cannot be reached, and why.

- Shows: one row where the answer would be: "Your Codex tool is signed out. Sign in again." with a button that starts the tool's own sign-in.

- States: signed out; not installed; version not tested; timed out; error; chat only, no calculations; answers only, not for actions. A route skipped because its send setting is wider than yours: the row says why ("Skipped: this route would be sent samples, and Send is set to shape only"). A job waiting on the route shows "resumes at" and the time of the next try.

- Engine: models.routes, models.connect, models.probe.

- Rules: never a silent retry and never an automatic switch to another route. The person may try the next route in their own order, and that is a new visible attempt with its own receipt. The app never reads or stores a subscription token.

### SH-10Opening a link

Day 1.

- For: stopping a link in an answer or a file from opening on its own.

- Shows: a small dialog with the full address as text, "Open in your browser" and Cancel.

- Engine: shell.openExternal.

- Rules: answers and imported text are drawn as plain content: no remote images, no raw HTML. The app window never goes to another page.

### SH-11Reporting a fault

Day 1 (crash report on request), day 10 (fault report).

- For: telling Chausar's makers about a fault without sending any business data.

- Shows: the whole report as text before it goes anywhere: app version, operating system, kinds of events, route health, error codes. A line at the top: "No names, amounts, file names, cell values or questions are in this report."

- You can: save it as a file and send it yourself. After a crash: Send report, or Don't send.

- Engine: support.faultReport, support.saveFaultReport, support.crashReport.

- Rules: nothing is sent unless the person presses Send report. No telemetry by default.

### SH-12Help

Day 1 (keys, what works without internet), day 10 (word list).

- For: looking up a key, a word, or what works with no internet.

- Shows: three short lists in a sheet: the keys, the word list in plain words, and what works with no internet and what waits.

- Engine: support.offlineList.

### SH-13A part that is not built yet

Day 1 onward, until day 10.

- For: being honest while the app is built in public.

- Shows: where the screen would be: "Not built yet. This arrives on day 7." and which part is missing.

- Engine: capabilities.

- Rules: a feature that is shown working once but not yet tested on the bench carries the label experimental on its own screen.

## First run

### FR-01Welcome

Day 1.

- For: three choices before anything else.

- Shows: the language (English, हिंदी), the view as three small live drawings (Simple, Guided, Books), and "I have a business" or "I have an idea".

- States: a workspace already exists on this computer: "Open Demo shop" comes first. "Try the demo shop" opens a demo workspace.

- Engine: vault.status, workspaces.list, shell.setLanguage, shell.setView.

- Rules: nothing is stored until the vault exists. The language and view are held in memory and written at step 2. Leaving before step 2 stores nothing.

### FR-02Business identity card and GST mode

Day 1 (card), day 2 (GST mode).

- For: telling Chausar which business this is.

- Shows: six optional fields, each on its own line: PAN, GSTIN, Udyam number, CIN, food licence, import-export code. Then the GST mode as three rows: regular, composition, not registered.

- States: a field with the wrong format says which part is wrong ("A GSTIN has 15 characters"). Nothing is looked up online, and the screen says so.

- Engine: onboarding.saveIdentity, dictionary.gstMode.

- Rules: format checks only. The card is held in memory until the vault exists and is written at step 2; leaving before step 2 stores nothing. Every report later says which GST modes it applies to.

### FR-03Create the vault

Day 1.

- For: locking the books before anything is read.

- Shows: the workspace name, the passphrase twice, an optional PIN for quick unlock, and the result of the disk check: "This disk is encrypted" or "This disk is not encrypted. Chausar encrypts its own files. Turning on BitLocker protects the rest."

- States: passphrase too short. Linux with no safe keyring: "This computer has no safe place for a key. Chausar will ask for the passphrase each time."

- Engine: vault.create, vault.diskCheck.

- Rules: one honest line under the disk check: "A program running as you on this computer can read what you can read. The passphrase limits this; it does not remove it." The passphrase passes straight to the engine and is never shown again.

### FR-04Recovery kit

Day 1.

- For: a way back in when the passphrase is forgotten or the laptop is lost.

- Shows: the code, large, in groups of four. Three lines: where the key lives, how recovery works, how to open the vault on a new computer. Print. A tick box: "I have kept this code somewhere safe."

- States: shown once. Continue is not available until the box is ticked.

- Engine: vault.create (returns the kit), shell.print.

- Rules: printed in Hindi and English on one page. The screen keeps the code only until the box is ticked.

### FR-05Connect an AI model

Day 1.

- For: choosing how Chausar reaches an AI model, or choosing none for now.

- Shows: one row per route with its health and a short note: your own Codex tool, your own Claude Code tool, an API key, a local model on this computer. Under them: the send level the app starts with (shape only) and that voice is off.

- You can: connect a route, set the order you want them tried in, skip. For an API key: a field for the key, and for an OpenAI-compatible service the address of its endpoint. For a local model: a picker of the models installed on this computer.

- States: ready, signed out, not installed, version not tested, timed out, error. Key accepted: the field empties and says "Key saved in the vault". Skipped: "No model yet. Importing, the menu of calculations, receipts and backup work without one."

- Engine: models.routes, models.connect, models.setLadder, models.cards, models.saveKey (day 1), models.localList (day 1).

- Rules: the app starts your own installed tool and never handles its sign-in. An API key passes straight to the engine once and is never shown again; the screen never stores it. The managed allowance is shown as "planned, not available yet".

### FR-06Pick a starter pack

Day 2.

- For: starting from ready-made meanings for your kind of business.

- Shows: the kinds of business as rows. A pack that is not checked says "draft, not yet checked".

- You can: pick one, or "Start from a conversation".

- Engine: packs.list, packs.choose.

### FR-07Bring a file

Day 1 (sheets), day 3 (bank statement PDF), day 4 (Tally, Zoho Books, GST files).

- For: getting the first data in.

- Shows: after you pick a file: its name, the first rows as plain text, and the recipe Chausar would use, with its state. For a layout it does not know: "Pick your columns", one row per column with a choice of date, customer, amount, invoice, or ignore.

- You can: confirm the columns, give a PDF's password, bring another file.

- States: password needed ("Used once, on this computer. Not kept."). Result per kind of file: for a sheet, "214 rows taken, 3 flagged, 2 refused", each group opening its rows and reasons; for a bank statement, the lines read, the opening and closing balance, and whether the check passed. Refused whole, with the reason from the fixed list: cut short (the file is not complete); filtered (its totals do not match the system's own, and both totals are shown); does not add up (at line N); wrong password; a picture only. Where the refused file is kept. A picture only, on day 3: "This statement is a picture. Chausar cannot read it yet." From day 4 scanned statements are read and checked like any other. The PDF reader not installed yet: its size, then downloading, checking, done; or failed, or no internet, each with what to do. After import on day 1: a thin list, "Proposed meanings (draft)", of what the file seems to mean, to settle in FR-08.

- Engine: imports.pickFile, imports.preview, imports.providePassword, imports.commit, imports.result, imports.readerStatus (day 3), imports.installReader (day 3), dictionary.proposals.

- Rules: cell text is shown as data. Each column choice is logged as a decision. A file is labelled "file", never shown as a live connection. The PDF password passes straight to the engine once and is never shown again.

Setup, step five

### FR-08Agree what your words mean

Day 2. Picture: S09.

- For: accepting or changing what Chausar proposes, with the evidence in front of you.

- Shows: the six steps across the top. "Agree what your words mean", with how many are done. One row per proposal: the word, the proposed meaning, its state. The open row shows the evidence as a thin bar ("398 of 412 past invoices fit") with Accept and Change. At the bottom: what is blocked, and that nothing has left this computer.

- States: a proposal that needs an answer (filled amber, "needs your answer"). All accepted: Continue. Checks failed: the row says which check and what would fix it.

- Engine: recipes.proposals, dictionary.proposals, accounts.proposals, recipes.decide, dictionary.decide, accounts.decide, onboarding.blocked, trust.leftToday.

- Rules: the setup guide proposes and never accepts. Only your click accepts. It asks at most three questions to finish a source. The bottom line, "Nothing has left this computer", comes from trust.leftToday, never from fixed text. The FirstRunStep pattern carries the blocked line on every step, not only this one.

### FR-09The first answer

Day 1, and from the dictionary on day 2.

- For: ending setup with proof that it works.

- Shows: one suggested question as a button. Then the answer page (AS-04) with the receipt open.

- Engine: ask.menu, ask.question, ask.receipt.

- Rules: the time from the first screen to this receipt is measured.

### FR-10The sharing question

Day 4.

- For: asking, once and plainly, whether you want to share anything with Chausar.

- Shows: after the first receipt: two boxes that start empty, "Setup shapes" and "Your corrections", and one sentence: "Your books also hold other people's details. Those never leave this computer." A link opens the exact file that would be sent.

- You can: tick, or leave empty and continue.

- States: boxes ticked while intake on Chausar's side is not open yet: "Sharing is not open yet. Nothing is sent." Two more boxes exist behind a founder switch and are not shown until it is on. In a demo workspace, a test switch labelled "Demo test: sends to a test inbox only".

- Engine: sharing.consent, sharing.preview, sharing.intakeStatus (day 4).

- Rules: never shown at install. No feature depends on any box. Full screen: TR-11.

### FR-11An idea, not a business yet

Day 1.

- For: a founder who has an idea and no books.

- Shows: a conversation on the left and, on the right, the draft as it forms: the business in a few lines, the money for one sale, a first 90-day plan, and the unknowns. Every line carries a small label: told by owner, or assumption.

- States: a number nobody gave is left blank and listed under unknowns, or shown as a range with its source and date once a pack provides one.

- Engine: onboarding.describeIdea, onboarding.draft, onboarding.correctClaim.

- Rules: the AI model writes no number.

### FR-12Setup checklist

Day 1; more kinds of business on day 5.

- For: the steps to make the business legal and ready.

- Shows: rows: kind of entity, registration, bank account, the GST decision, Udyam, licences. Each row names its rule, the source and the date it was checked.

- Engine: onboarding.setupChecklist.

- Rules: the list comes from a dated rule table, never from the AI model. Filing is handed to a provider; the app does not file.

### FR-13Open a vault with the recovery kit

Day 1; the recovery contact on day 6.

- For: getting back in on this or a new computer.

- Shows: a field for the code, and "Choose your backup file" on a new computer. From day 6, a second way in: "Ask your recovery contact", for a person named in TR-12.

- States: wrong code. Backup older than the last use: "This backup is from 28 September. Anything after that is not in it." Waiting for the recovery contact to confirm.

- Engine: vault.unlockWithKit, vault.restore, vault.recoveryContact (day 6).

- Rules: after a restore, sending stays closed until every action in the gap is checked (WK-15).

### FR-14Join a workspace from another computer

Day 6.

- For: adding a second machine or a second person.

- Shows: on the new computer, a short code. On a computer already in, the same code to compare, with Approve.

- States: the invite expired (15 minutes) or was used.

- Engine: seats.inviteVerify, devices.join.

## Today

Today

### TD-01Today, Guided view

Day 1 (rows, earlier today), day 5 (charts, worth a look, the week ahead), day 7 (Review). Picture: S01.

- For: seeing in ten seconds what needs you and how things stand.

- Shows: the date. "Awaiting your review" with its count, and up to four rows. "This month": three small charts, each a label, a figure, what changed against what ("down 18% vs August"), and the picture. "Earlier today": up to six marks on one line. The status line under the ask line, as on every screen. The rail shows the sub-places Today and Activity.

- You can: open a row in place to see one more line and Review; open a chart's receipt by clicking its tile; open the full activity list.

- States: nothing awaits: "Nothing awaits your review." and the charts move up. More than four: "See all 7". Setup not finished: a first row, "Setup: step 5 of 6". An update is ready: a row. No data yet: the charts say "not loaded yet" and the due dates still show. Daily closing on: a closing row in every view ("Close today: cash, bank, entries"). A summary row (such as "3 payment reminders") opens one approval per item, one after another.

- Worth a look. Below the review rows, up to five rows of things that changed or are due: a figure that moved, a due date within seven days, a decision due for review, a refused file, a brief that was built late, what was missed while the computer slept, an approval that expired. An alert is one row per episode, never one per check. A finding carries "lead, not tested" or "tested". Review rows and worth-a-look rows together never show more than five at rest. Each opens its receipt or its page. From day 7 a row may offer Prepare.

- Engine: review.list (day 1: proposals, questions and results), review.count (day 1), approvals.list (joins on day 7), briefs.daily, briefs.tiles, activity.day, calendar.due, decisions.inbox, updates.status, events.subscribe.

- Rules: the count is the things this seat may act on now, one per item. The three charts are chosen by the starter pack and can be changed. A figure that moved and has no measured cause yet says so; it never offers a cause as fact.

Today in the Simple view

### TD-02Today, Simple view

Day 1 (rows), day 5 (cash entry). Picture: S14.

- For: a shop owner: what needs a yes, and today's cash.

- Shows: the same rows, taller and in larger type, each up to two lines. "Today's cash sales" with one field and Enter. The week's cash as seven bars. The status line as two plain sentences.

- You can: hold to talk; say or type the day's cash.

- States: today's cash not entered (the bar for today is open). Entered: the bar fills and the row says "told by owner".

- Engine: as TD-01, plus briefs.saveClosing.

- Rules: the cash figure is stored as something the owner said, not as a fact from the books. Receipts for a period with no cash entry say "cash sales not captured".

Today in the Books view

### TD-03Today, Books view

Day 1 (table), day 4 to 6 (the close). Picture: S15.

- For: an accountant: the queue, and how far the month's close has got.

- Shows: "Awaiting your review" as a table: what, party or account, as written in the source, amount, since, then (who decides). Under it, one quiet line for what waits on someone else ("Waiting for the owner: 3 reminders you prepared"). "September close": bank reconciliation, purchases against GSTR-2B (AS-19), TDS against Form 26AS, trial balance, each with its state and an action. The status line with the keys that work here.

- States: an item this seat may prepare and not approve says "the owner approves". Something this seat prepared and now waits for another person is not in this seat's count.

- Engine: review.list, approvals.list (from day 7), reports.closeStatus, events.subscribe.

- Rules: arrow keys move, Enter opens. The status line says so. Balances in the table carry Dr or Cr.

### TD-04Activity

Day 1 (with the route and cost of each model request); cost per job step, the record filter and the taint mark on day 8.

- For: reading everything that happened, in order.

- Shows: a time line down the page, newest first. One sentence per step, with its square, its time, who acted, and its cost in rupees where it had one. A line for a request to the AI model shows its route and its cost from day 1. A run that read outside text carries the taint mark, "read outside text".

- You can: filter by state, by person, by job, by day, and by record (a customer, an invoice). Open any line to its proof: a receipt, an action's record, a request to the AI model.

- States: the five activity states of part 7 of the main file.

- Engine: activity.list, activity.day, events.subscribe.

- Rules: each sentence is built by the screen from a typed event, in Hindi or English. The engine sends no prose.

## Ask

### AS-01The ask page

Day 1 (a small hand-written menu, labelled seed), day 2 (the menu from the dictionary), day 5 (the full set).

- For: starting a question when you do not know what to ask.

- Shows: "Ask", and the menu of calculations as rows grouped by topic: sales, collections, cash, stock, tax. Each row names the calculation and what it needs.

- States: the day 1 menu says "seed" on the page and on every receipt. No model connected: the menu is the way to ask, and the period is chosen from a plain calendar.

- Engine: ask.menu, ask.suggest.

### AS-02What Chausar understood

Day 5 (a simpler form on day 1).

- For: seeing which calculation was chosen before it runs.

- Shows: one line under the question: the calculation, the period, and who is counted. "Invoiced by customer · August 2026." A Change link.

- You can: change the calculation, the period or the group, each from a short list.

- Engine: ask.question (returns the proposal), ask.run, ask.change.

- Rules: your correction is logged as structure only. "Last month" follows the workspace's calendar and its April to March year.

### AS-03One question back

Day 5.

- For: settling a question that could mean two things.

- Shows: "Which did you mean?" and the choices as rows, each with one line saying how it differs: "Billed: invoices raised. Received: money in the bank. Earned: after returns."

- Rules: exactly one question. If the answer does not settle it, the result is Not yet.

An answer with its receipt

### AS-04An answer

Day 1. Picture: S02.

- For: the number, with what was counted and what was not.

- Shows: the question as the title. The line from AS-02. One big figure with a few words beside it ("14 customers"). Ranked bars or a chart. The check line, which is the "no invented numbers" badge: "Checked against the receipt. 214 rows, 3 left out." Save, and Save as a check.

- You can: open the check line to see the number guard's list: each number found in the written explanation and the receipt line it matched.

- States: part of the data missing: the figure for what is loaded, and "3 months not loaded yet" in words. A number in the written explanation is not on the receipt: the number guard removes the written explanation and puts the template explanation in its place. The figures stay, because they come from the receipt, and the page says so. Rows may not be sent to the model: the explanation is written from a template and says so. Two meanings give two numbers: both are shown as different measures, each with its own receipt, never as an error. Not applicable, with the reason: "This business is in the composition scheme, so there is no GSTR-2B to match." Stale: the date and Rebuild.

- Engine: ask.run, ask.answer, ask.receipt, ask.guardList (day 1), ask.save, checks.saveAsCheck.

- Rules: no number on this page is typed by the AI model. Every figure and every bar opens the receipt.

### AS-05The receipt

Day 1 (with a short "Allowed by" line); two dates on day 3; versions and the way in on day 4; forecast method on day 5; the full decision that allowed it, and who reviewed and co-signed, on day 6.

- For: checking a number.

- Shows: the six parts listed in part 6 of the main file. The chain on top reads "Your question, Calculation chosen, 217 rows read, Total checked". The small print carries: the way in (its own interface such as the XML interface, an exported file, or an export from the program on this computer); the recipe, its state and who accepted it, with its label grade ("Recipe tested · accepted by you"); who published, reviewed and co-signed the meaning; for another currency, the rate used and its date; for a forecast, the method and the months it learned from and was tested on; the decision that allowed it (rule id, which check decided, person, device, time). The short "Allowed by" line is there from day 1.

- You can: open the rows, export, open what was sent to the AI model, open the meaning, open the recipe.

- States: from a seed menu: "seed". Recipe not yet tested: "not yet tested". An amount with no exchange rate: "not counted", with the count. As known on a past date: both dates. Sent through your own Codex or Claude Code tool: "Only the text handed to the tool is visible." Demo clock: the label.

- Engine: ask.receipt, ask.sourceRows, ask.sent, reports.export.

- Rules: the receipt names the recipe, its state and who accepted it. It carries five version numbers in its small print.

### AS-06The rows behind a number

Day 1.

- For: seeing every row that was counted, and every row that was left out.

- Shows: a full-page table: file, row number, the cells as written, the amount. Two tabs of words: counted, left out.

- States: rows hidden from this seat: a line says how many and why.

- Engine: ask.sourceRows.

### AS-07What was sent to the AI model

Day 1.

- For: seeing the exact words that left the computer for one answer.

- Shows: the request as plain text, with stand-ins where names, phone numbers and GSTINs were ("CUSTOMER_1"). The route, the send level, the size, the cost.

- States: kept for the time you set, then only its digest: "The text was removed after 30 days. Its fingerprint is kept."

- Engine: ask.sent.

### AS-08Not yet

Day 1; Ask a person on day 10.

- For: an honest stop when no calculation fits.

- Shows: "Not yet. No calculation covers this." The reason in one line, for example "no peer data exists yet" or "needs data: the GST file for September". "It is on the wanted list." For a business word Chausar does not know: "Not sure what 'X' means. It is on the list."

- You can: pick a nearby calculation from a short list; from day 10, Ask a person, which packs the question for a person (RP-08).

- Engine: ask.question (kind no-match), ask.wanted, support.askAPerson.

- Rules: never a guess.

### AS-09Stopped by a rule

Day 1; seats and markings on day 6.

- For: saying which rule stopped an answer.

- Shows: the rule in plain words ("Anything marked confidential is hidden from the cofounder seat") and who can change it.

- Engine: ask.question (kind refused), trust.explain.

Why did it change

### AS-10Why did it change

Day 5. Picture: S03.

- For: understanding a movement without mistaking a guess for a fact.

- Shows: the title as a finding ("Collections fell 18% in September"). "Measured": a bridge chart from the earlier figure to the later one, each bar a measured cause with its amount. "Possible causes", labelled Guess: rows with an open amber square and the evidence for and against. Record a decision, and Save.

- States: long investigations show their plan as steps and can be resumed. An investigation reopened later checks your permissions again. A guess that cites something from outside names its source and when it was fetched.

- Engine: investigations.start, investigations.get, investigations.resume, decisions.capture.

- Rules: the two parts are never merged. Nothing from outside enters a measured number.

### AS-11What if

Day 5.

- For: trying a change in an assumption without touching the books.

- Shows: the label "What if" beside the title. The assumption changed, as before and after. Two figures side by side: your books, and with the change.

- Engine: scenarios.create, scenarios.compare.

- Rules: a what-if has no way to write to facts. Its receipt says "What if".

### AS-12Forecast

Day 5.

- For: a look ahead that says how much to trust it.

- Shows: a line for the past in ink, the forecast as a lighter line with a pale band for its range, and the simple baseline (last year's pattern) as a thin grey line. Under the chart: the error of each on the months held back.

- States: the forecast lost to the simple baseline: the baseline is shown as the answer and the page says so. Under 24 months of history: "Not enough history to test a forecast."

- Engine: forecasts.run.

- Rules: the receipt names the method, the months used and the months held back. The label "projection" follows the number into any report.

### AS-13The best plan under limits

Day 5, experimental.

- For: a plan that meets stated limits, or a plain statement that none can.

- Shows: the limits as rows, the recommended plan, and which limit is tight. When the limits cannot all be met: which ones clash.

- Engine: scenarios.optimise.

### AS-14Saved

Day 2; stale marks on day 3.

- For: finding an answer, an investigation or a what-if again.

- Shows: rows: the question, its kind, its figure, when it was worked out.

- States: stale: "worked out on 12 Sep, may be out of date" and Rebuild. Cannot be rebuilt: "Something it used was deleted on 2 Oct."

- Engine: ask.saved, history.stale, history.rebuild.

### AS-15Decisions

Day 5; forwarded text on day 9, experimental.

- For: writing down a decision in one sentence, and being asked later how it went.

- Shows: the inbox first: drafts to confirm, decisions due for review, and questions Chausar is waiting on. Then the journal as a time line down the page.

- You can: type, say or paste one sentence and confirm the draft with a review date. Open a decision: what was decided, what was known then (with receipts as known on that day), and what happened after.

- States: recorded later (the label). Replaced, or cancelled. From day 9, experimental: text forwarded from the phone lands in the inbox as a draft decision, to confirm like any other.

- Engine: decisions.capture, decisions.confirm, decisions.inbox, decisions.list, decisions.get, decisions.review.

### AS-16Checks

Day 5.

- For: your own questions with known answers, as a standing test of everything that changes.

- Shows: rows: the question, the expected value, the last result: same, moved, or cannot run.

- You can: run all now; open a moved check to see the old and new values, each with its receipt.

- Engine: checks.list, checks.run, checks.results.

- Rules: checks run again on every change of model route, meaning, recipe or app version. Their values stay in the vault and are never shared.

### AS-17The not-yet list

Day 1 (calculations), day 7 (actions).

- For: seeing what was asked for and could not be done.

- Shows: three lists: wanted calculations, wanted actions, and business words Chausar did not know, each with how often it was asked.

- Engine: ask.wanted, actions.wanted.

### AS-18Search results

Day 5.

- For: finding a saved investigation or a decision by a word.

- Shows: rows grouped by kind, the matching words in ink.

- Engine: investigations.search, records.search.

- Rules: the search runs on this computer.

### AS-19Purchases against GSTR-2B

Day 4.

- For: matching what you bought against what your suppliers filed, so input tax is not lost.

- Shows: four groups as rows, each with its count and amount: matched; amount differs (inside or outside the tolerance you set, shown beside it); in 2B only; in your books only. Each line opens its receipt. Under them, the IMS list: the invoices a person should accept, reject or keep pending in the GST portal, each with the reason.

- You can: open a group; open a line's receipt; change the tolerance; export the IMS list. The same page is the 2B row of the September close (TD-03) and a page of the CA pack (RP-01).

- States: the 2B file for the month not loaded yet. Not applicable, with the reason: a business in the composition scheme, or not registered, has no 2B to match.

- Engine: gst.match2b (day 4), gst.imsList (day 4), gst.setTolerance (day 4), ask.receipt.

- Rules: Chausar never acts in the GST portal. The IMS list is for a person to act on there.

## Work

Approvals

### WK-01Approvals

Day 7. Picture: S04.

- For: everything that needs your yes before it happens.

- Shows: "Awaiting your review" with its count, one row per item: what it is, who or what it touches, its tier word, the amount. Tier 2 items first, then tier 1, then prepare-only items last.

- States: an item about to expire shows the time left in its note. Prepared by a person ("prepared by Anil Demo"). Prepared by a job (the job's name). Expired: it leaves this list and becomes a worth-a-look row on Today.

- Engine: approvals.list, events.subscribe.

### WK-02The approval sheet

Day 7; the practice variant on day 6. Picture: S04.

- For: saying yes to one exact change, having read it.

- Shows: the parts in part 6 of the main file: what it is with its tier word, the target, the reason it waits (which rule made it wait), the exact change, the five steps (Prepared, Approved, Done, Read back, Recorded) with the step you are on in ink, one note with the expiry, Approve and Not now, and the links Change and Drop.

- Variants: a message to an outsider (the text as it will be sent). A change to a record (before and after). Money: Approve then asks for your passphrase, PIN or fingerprint. Prepare only (a tax filing): no Approve; "Download the file and the checklist. You or your CA files it." A voucher preview, prepare only for now: the voucher as Tally would show it, with "This is not entered in Tally. Prepare only today." A proposed job: the job's card (WK-09). Practice, from day 6: the same sheet with the label "practice"; Approve sends nothing and changes nothing.

- States: expired: "This expired on 1 Oct. Nothing was sent." The proposed defaults are 24 hours for a message to an outsider and 7 days for a change inside the workspace. The thing changed after it was prepared: "The invoice changed. Prepared again." This seat may not approve: "The owner approves this." Blocked at prepare: "No reminder: this customer has not agreed to reminders."

- Engine: approvals.get, approvals.approve, approvals.notNow, approvals.change, approvals.drop, approvals.practice (day 6).

- Rules: the sheet is built from the prepared request itself, never from words the AI model wrote about it. An approval is for that exact change and nothing else. The tier names are settled on days 7 and 8; until then the sheet says "tier 1" and "tier 2".

### WK-03A grouped approval

Day 7, experimental.

- For: approving small changes together without approving blind.

- Shows: a title ("4 bank matches"), the label "can be undone", and up to ten rows, each with a tick and its before and after.

- You can: untick any, then "Approve 4".

- States: approved three in a row faster than they can be read: one line at the top, "You approved the last 3 in under 2 seconds each. Take a look at this one." After Approve: one result per item, each with its own step.

- Engine: approvals.group, approvals.approveGroup, approvals.pace.

- Rules: one sheet, but one approval per item inside it, and results per item. The same holds for a payment run in the enterprise version. Never used for anything on the always-waits list (TR-05). On the phone a group always says "Open the app".

### WK-04After Approve

Day 7.

- For: watching one action through to its true result.

- Shows: the step mark moving along the five steps (Prepared, Approved, Done, Read back, Recorded), with the time each was reached.

- States: recorded (the row turns green). Not sure: "Not sure it went out. Checking before trying again." with Check again, "It was sent", "It was not sent". Sent and paid are different: a reminder is recorded as sent; the invoice is marked paid only when the payment is read from the books and matched to the bank.

- Engine: actions.get, actions.resolveUnknown, events.subscribe.

- Rules: never a second send without looking first.

### WK-05Actions

Day 7.

- For: the true record of everything Chausar did or was asked to do.

- Shows: a time line down the page: what, to whom, the amount, the five steps as five small dots, who approved, and through which channel.

- You can: open one to see the request, the read-back compared field by field, and the rule that allowed it. Reverse it where that is possible: a reversal is a new action with its own approval.

- States: from day 7 a column shows what the standing rule would have done beside what you decided ("would have done: waited").

- Engine: actions.ledger, actions.get, actions.reverse.

### WK-06What it can do

Day 7.

- For: the written list of actions, so nothing is a surprise.

- Shows: a table: system, action, what kind (inside the workspace and can be undone; seen outside; money; cannot be undone), whether it waits for you, and its status: live, experimental, prepare only, not yet. A row opens a sheet with all eleven fields of the catalogue, including "how it avoids doing it twice", "how it reads back", and when the entry expires.

- States: something outside the list was asked for: "Not in the list yet. It is on the wanted list."

- Engine: actions.catalogue, actions.catalogueEntry (day 7), actions.wanted.

- Rules: being allowed to read a system never means being allowed to write to it; write status is shown apart from read status.

### WK-07Jobs

Day 7 (scheduled jobs), day 8 (bigger jobs).

- For: seeing what runs on its own.

- Shows: rows: the job, its state, when it next runs, what it has cost. Proposed jobs first, as approvals.

- You can: pause, resume, Edit (the change goes through a new approval), Delete.

- States: paused; waiting, with "resumes at" and the time; set aside after three failed runs, with the reason; a missed run (the label "missed"); stopped by a rule, with its reason; stopped; at the limit of 10 active jobs.

- Engine: jobs.list, jobs.pause, jobs.resume, jobs.edit (day 7), jobs.delete (day 7), events.subscribe.

A job

### WK-08A job

Day 8. Picture: S05.

- For: following a job and steering it.

- Shows: four facts (goal, progress, budget, when it stops), a chart of the measure against its goal, the time line with the cost of each step, what comes next, Pause and Stop the job, Edit and Delete. Each step says "needs an AI model" or "runs without one". The budget as three meters: model use, with the route; clock time; and effect exposure (how much money the job's actions may touch). A cost from your own command-line tool is labelled "estimate". A local model is priced at zero, with its minutes shown.

- States: waiting for you (a question, as the top row of the time line). Waiting for the network, with "resumes at". Stopped by a rule, with the reason; when the rule is the budget, it says "the budget" and what was left undone. On a model route it was not tested on: paused, naming the route it needs. A child task's result is missing: the job stays open and names it. A run that read outside text: the taint mark, and any send waits for you (TR-09).

- Engine: jobs.get, jobs.timeline, jobs.pause, jobs.stop, jobs.answer, jobs.edit, jobs.delete, budget.get.

- Rules: a job has at most one level of child tasks. It cannot make another job without a new approval.

### WK-09A job's card, and proposing a job

Day 7 (proposal), day 8 (card).

- For: reading what a job may do before it starts.

- Shows: in a sheet: the goal and how you will know it is met; the owner; the budget; the stop rule; the actions it may use, by name; the model routes it was tested on; the review date; what happens to a missed run; which computer runs it.

- You can: start from a ready-made job or from one sentence. Approve to start.

- States: from day 8, a job made from an imported skill says "instructions only, no tools, untrusted" on its card.

- Engine: jobs.propose, jobs.templates, jobs.card, approvals.approve.

### WK-10A job's result

Day 8.

- For: accepting the work, or sending it back.

- Shows: one page: what was done, what is still open, what it recommends, every figure with its receipt. Accept, and Send back with a sentence.

- Engine: jobs.result, jobs.accept, jobs.reject.

- Rules: a job is finished when you accept it, not when it stops running.

### WK-11Schedules and missed runs

Day 7.

- For: jobs that repeat, and what happens when the computer was asleep.

- Shows: on the job's card: the rule for a missed run (skip, run once on wake, run all; the default is run once on wake), the last run, the next run.

- States: after a sleep, a row on Today: "3 runs were missed while this computer slept. Ran once."

- Engine: jobs.schedules, jobs.setMissedRule.

### WK-12Reminders to customers

Day 7.

- For: getting paid without annoying anyone.

- Shows: in the approval sheet: the reminder as it will be sent, with the invoice link. For you only, under the text: two notes on payment rules, each with its source, the date it was checked, and "not legal advice".

- States: the customer's agreement per channel (mail, WhatsApp): yes, no, or not asked, each with its source and date. No agreement on this channel: blocked at prepare with the reason, and a way to record the agreement when the customer gives it. The customer replied with the stop word: the stopped flag, "Stopped by the customer on 2 Oct." A cap reached: "20 reminders were prepared today. The rest wait until tomorrow."

- Engine: approvals.get, records.optIn, records.setOptIn (day 7), trust.caps.

- Rules: one reminder per customer per day and 20 a day in all, both changeable in Trust.

### WK-13A bill photo to a booked entry

Day 4 (reading the photo), day 7 (booking it). Experimental.

- For: turning a paper bill into an entry, with you checking every field.

- Shows: the photo on the left; on the right a form: supplier, bill number, date, lines, tax, total. Each field shows where on the photo it was read, and how sure the reading is (sure, check this, could not read).

- States: a field that could not be read is empty and amber. Lines plus tax do not equal the total: the bill is refused, or you are asked. Send is set to nothing and no local model can read pictures: "Not available with your send setting."

- Engine: imports.readBill, imports.confirmBill, approvals.get.

- Rules: nothing is stored before you confirm. Text printed on the bill is data.

### WK-14Chausar is driving

Day 4, experimental.

- For: exporting a report from a program that has no other way out, while you watch.

- Shows: first a choice of which window Chausar may use. Then the banner, a thin strip that stays on top of the driven window ("Chausar is driving. Ctrl Alt Pause to stop." and Stop), and a small list of the steps as they happen. The tray menu also has Stop.

- States: the program asks for a sign-in: "Sign in yourself. Chausar continues after." You moved the mouse or typed during the session: it pauses at once, "You moved the mouse. Paused." with Continue and Stop. Stopped by your key. A step failed.

- Engine: session.windows, session.start, session.status, session.stop, session.resume (day 4).

- Rules: one window only. Read and export only: no edits, no payment screens. The app never types a password, never answers a one-time code and never solves a captcha.

### WK-15After a restore

Day 7.

- For: making sure nothing is sent twice after going back to a backup.

- Shows: the actions that may have gone out after the backup was made, each with Check.

- States: deletions that could not be applied again: an honest note with the backup's date and what came back ("The backup is from 28 Sep. 2 customer records deleted after that came back with it. Delete them again.").

- Engine: actions.afterRestore, actions.resolveUnknown, deletion.reapply (day 7).

- Rules: sending stays closed until the list is empty. What was deleted before is deleted again; where that cannot be done, the note says so and never hides it.

### WK-16A step for a person

Day 8, a proposal beyond the day files.

- For: a step that only a person can do, such as filing a return or calling a customer.

- Shows: in a job's time line, a row with your square or a named person's: what to do, and Done.

- Rules: the job waits. It does not mark the step done by itself.

## Books

Sources

### BK-01Sources

Day 4. Picture: S06.

- For: knowing how fresh and how complete the data is.

- Shows: a table with one line per system and scope (a company, a branch, a tax registration): the source and how it is reached (this computer, signed in, files), when it was last read, twelve small squares for the last twelve months, and what there is to look at. Under it: "6 fields no recipe covers".

- States: per month: loaded, loading, not loaded yet, refused (a file that did not pass its checks, filled amber), failed (the read itself failed, an amber ring, with the word "failed"). Not connected. Experimental.

- Engine: sources.list, sources.coverage, events.subscribe.

- Rules: a month that is not loaded is an open square, and any answer over it says "not loaded yet". Never a zero.

### BK-02One source

Day 4.

- For: the detail of one connection.

- Shows: in a sheet: the way in, the sign-in path, the last successful read, how old the data is, what is loaded per kind of record, failures with their reasons, refused files and where they are kept, and the history of reads.

- You can: read now, pause, sign in again, remove.

- Engine: sources.get, sources.envelopes, sources.readNow, sources.signIn, sources.remove.

### BK-03Add a source

Day 4.

- For: connecting one more system.

- Shows: the systems as rows with what Chausar can do with each: full, read, or import of files; tested, not yet tested, experimental. Beside each, its evidence: how many cases it was tested on and of what kind (synthetic, made to order, real with consent), and its overall tier. For Tally, a small table per operation with each cell marked tested, untested or not possible. Then the way in. For Tally: where it lives (this computer, this network, another computer) and, for another computer, a small exporter and a one-page guide to forward. This network and another computer are labelled experimental.

- States: sign-in happens in your browser. A system that needs a paid partner: "planned, not available yet". Tally holds two companies: "Which company?" with both names, before anything is read.

- Engine: sources.options, sources.add, sources.signIn.

- Rules: a claim is per operation and per system, never per logo.

### BK-04Bring a file

Day 1. The same screen as FR-07, reached from Sources.

### BK-05A recipe

Day 2 (the language), day 4 (on real systems).

- For: checking how a system's fields become your words.

- Shows: the recipe's state (seed, tested, not yet tested, failed), its scope in five fields (system, company, branch, tax registration, period), and its bindings as rows: the field, the meaning, who accepted it and the grade of that label (model, owner, accountant, CA, reconciled). The check against the system's own totals: two figures side by side and whether they match.

- States: a question, with its reason from the fixed list of five (a value not in the list; a binding not settled; not known whether it applies; a check failed; too little evidence) and the choices. Totals do not match: the recipe is not accepted, and the two totals are shown. A newer version of the recipe: what would change, waiting for your yes.

- Engine: recipes.get, recipes.proposals, recipes.decide, recipes.questions, recipes.answer, recipes.reconcile, recipes.upgradeDiff.

- Rules: a binding proposed by a model says "proposed" until a named person accepts it.

### BK-06Fields no recipe covers

Day 4.

- For: seeing what was read and not understood, so nothing is lost silently.

- Shows: a table: the field, its type, how often it is filled. "Map this field" starts a proposal.

- Engine: sources.unmappedFields.

### BK-07Meanings

Day 2.

- For: the dictionary of your business words.

- Shows: rows: the word, its meaning in one line, where it came from (core pack, starter pack, you), its state.

- States: a clash between a pack and your own change is shown, never hidden.

- Engine: dictionary.words.

A meaning

### BK-08A meaning

Day 2. Picture: S07 (with the day 3 trial table of BK-09).

- For: reading and changing what one word means.

- Shows: the word; what counts, in plain words; the date used; one worked example as a small drawing. For a draft on day 2: the old rule struck through beside the new one, the change in plain words, the list of calculations and saved answers it affects, Publish and Discard. From day 3, "Try it on a copy" opens BK-09.

- States: draft. Reviewed by a second model: "AI opinion, not an independent review". No second model: "not reviewed". Co-signed by a cofounder or an accountant, by name. Checks failed: which.

- Engine: dictionary.get, dictionary.draft, dictionary.diff, dictionary.check, dictionary.review, dictionary.publish, dictionary.cosign, dictionary.history.

- Rules: a release switches on everywhere at once, or not at all. The receipt shows who published and who reviewed.

### BK-09Try a change on a copy

Day 3, experimental. Picture: S07, labelled experimental.

- For: seeing what a change would do before it is real.

- Shows: saved questions in a table with two columns of figures: now, and with the change. Every figure that differs is in ink; the rest are grey. Each cell opens its receipt. Reached from a meaning (BK-08), a recipe (BK-05) and sources that disagree (BK-14).

- You can: pick which saved questions to run on the copy.

- States: making the copy (the time and disk space it needs). Publish, or Discard.

- Engine: trial.start, trial.compare, trial.publish, trial.discard.

- Rules: the copy never runs an action and never sends anything out.

### BK-10Starter packs

Day 2.

- For: seeing which packs are in use and what state each is in.

- Shows: rows: the pack, its state, how many meanings came from it.

- Engine: packs.list.

### BK-11Accounts

Day 2.

- For: sorting the chart of accounts into classes, with you as the judge.

- Shows: rows: the account, the proposed class, the reason (its name, its parent group, whether it is a debit or a credit account, how it behaves). Yes, No, Change.

- States: not sure: Chausar asks and does not guess. Corrected by an accountant: the label.

- Engine: accounts.proposals, accounts.decide, accounts.classes.

- Rules: customer and supplier accounts are sorted by their group only; their names never leave this computer.

### BK-12Customers, suppliers and items

Day 3; reminders agreement on day 7; follow-ups on day 9.

- For: one page per record, with where each detail came from.

- Shows: the list, then a record's page: its details, each with its source; what it owes or is owed; its time line of invoices, payments, reminders and notes; its agreement to reminders per channel (yes, no, not asked) with the source and date, and the stopped flag if it sent the stop word.

- You can: ask about this record from the ask line; open "What we hold about this customer"; record the customer's agreement on a channel, with where it came from.

- Engine: records.search, records.get, records.timeline, records.optIn, records.setOptIn.

### BK-13Same customer or not

Day 3.

- For: joining two records of one customer, and being able to undo it.

- Shows: pairs as rows with the evidence: the same GSTIN (must be the same), the same PAN in two GSTINs (same owner, kept as two branches), two different PANs (cannot be the same), and hints (name, phone, mail, UPI id, bank account, address). Same, Not the same.

- States: joined, with Undo. After an undo the totals return to what they were, to the paisa, and any approval that depended on the join is cancelled. A GSTIN or PAN that is badly formed is not used as evidence, and the pair says why ("This GSTIN has 14 characters").

- Engine: identity.suggestions, identity.decide, identity.undo, identity.rules.

- Rules: a hint never joins two records on its own.

### BK-14Sources that disagree

Day 3.

- For: seeing both claims when two systems say different things.

- Shows: the two claims side by side, each with its source, and the rule that picked one. Where no rule fits: "not agreed", and no value is picked.

- You can: set which source wins for which kind of fact.

- Engine: conflicts.list, conflicts.get, conflicts.rules.

- Rules: fields that belong together, such as an amount with its currency and date, are taken from one source together.

History

### BK-15History

Day 3. Picture: S08.

- For: what you knew then, beside what you know now.

- Shows: two figures side by side with their receipts, and a step line of the belief over time with what changed it. "Choose another date." "Every version of INV-0231."

- States: a correction (a new version beside the old) and a credit note (a new event) look different and are counted differently. Demo clock.

- Engine: history.asKnownOn, history.versions.

### BK-16Stale answers

Day 3.

- For: knowing which saved answers a change has made out of date.

- Shows: after a correction, a join or an undo: the list of saved answers it touched, each marked stale with the date it was worked out, and when each was rebuilt. Each rebuilt answer is compared with a full rebuild from the start.

- States: the quick rebuild and the full rebuild match: rebuilt. They do not match: Failed, with both figures, and the answer stays stale.

- Engine: history.stale, history.rebuild.

### BK-17Memory

Day 1; source marks and the filter on day 8.

- For: reading, correcting and deleting what Chausar believes.

- Shows: rows: the belief in one line; its kind (preference, claim, conversation, working context); its status (told by owner, assumed, corrected); its source (told by owner, computed with a receipt, read from outside content); both dates, when it was learned and when it was last confirmed. Edit and Delete on the open row, and the earlier version of a line that was corrected.

- You can: filter to what came from outside content; Add a line yourself; confirm a line proposed from the ask line (SH-04).

- Engine: memory.list, memory.edit, memory.delete, memory.add (day 1), memory.propose.

- Rules: something read from a file or a message can be remembered and is never obeyed.

### BK-18A photo of a bill

Day 4, experimental. See WK-13.

### BK-19GST mode and exchange rates

Day 2.

- For: two settings that change how amounts are read.

- Shows: under Meanings: the GST mode, and the table of exchange rates by date.

- States: an amount with no rate for its date is "not counted", and the receipt says how many.

- Engine: dictionary.gstMode, dictionary.rates.

### BK-20What we hold about a customer

Day 6.

- For: answering a customer who asks what you keep about them.

- Shows: every store that holds something about one customer, with the count in each, and Delete.

- Engine: records.holdings, deletion.request.

## Reports

### RP-01Packs

Day 5.

- For: the papers a bank, an investor or a CA asks for.

- Shows: three packs as rows, each opening its pages. Each page has a state: ready and tested, ready and not tested, not started. Each pack says which GST modes it applies to. The CA pack includes the purchases against GSTR-2B page (AS-19).

- Engine: reports.packs, reports.pages.

### RP-02A report page

Day 5.

- For: a page that can be handed to someone.

- Shows: the page as it will print. Every number opens its receipt. A gap in the data is printed on the page beside the total it affects. A projection sits apart from facts under its own label. "Ready for a loan?" carries the line "This is not a loan offer or a promise of one." Ageing pages carry two notes, on section 43B(h) and on TReDS, each with its source, the date it was checked and "not legal advice".

- You can: choose the report's language; print, export to Excel, to PDF, or to a file Tally can import.

- States: from day 6 the footer carries a short check code from the tamper-evident record, with its time.

- Engine: reports.page, reports.export, shell.print.

- Rules: reports.export and vault.export write text cells as text, so a spreadsheet cannot run them as formulas. The screen does nothing to the cells. Balances follow the accounting layout, with Dr and Cr.

### RP-03The week ahead

Day 5.

- For: one page each week: what changed, what needs a decision, what is due.

- Shows: three short sections with a chart each where a number moved. The decision inbox. What was missed while the computer slept (from day 7).

- States: built late: the label "late" with both times. Built with no AI model: the same page; the written explanation is a separate, optional step.

- Engine: briefs.weekAhead.

- Rules: never two briefs for one period.

### RP-04The Friday review

Day 5; lessons on day 8.

- For: looking back: decisions due and what happened after them.

- Shows: decisions due for review, each with what was observed. From day 8: up to five proposed lessons, each with its evidence and what it would change, with Approve and Not now.

- Engine: briefs.friday, decisions.review, memory.lessons, memory.decideLesson.

- Rules: a lesson never changes a meaning, a recipe or a calculation.

### RP-05Rhythm and delivery

Day 5.

- For: choosing when briefs are made and where they go.

- Shows: which days and what time; daily closing on or off; the financial year. Delivery by mail and by WhatsApp, each off by default, each with the exact message shown before the first one is sent. The owner's own mail address and phone number, each with a Verify step. The missed-brief rule as a row: what happens when the computer was asleep at brief time.

- States: WhatsApp template not yet approved: "partial". Not verified yet: nothing is sent. Test mode: "Sends only to the demo inbox and phone."

- Engine: briefs.rhythm, briefs.delivery, phone.preview, phone.verify (day 5), jobs.setMissedRule.

### RP-06Due dates

Day 5.

- For: the dates the business must meet.

- Shows: rows: what is due, when, the official source as a link, and when it was last checked. Each row says which kind of business, which GST mode and which state it applies to. One line at the top: "Not yet checked by a CA."

- States: works with no data connected. A row last checked more than 30 days ago says so. A kind of business the table does not cover yet: "Due dates for this kind of business are not covered yet." with the list of what is.

- Engine: calendar.due, calendar.rows.

- Rules: every date is worked out by the engine from a published table. The AI model never writes, changes or rewords a date.

### RP-07Exports

Day 3.

- For: taking everything out, in open files.

- Shows: "Export everything", and after it the list of what was exported: each store, its row count and its check number.

- States: before export: "Exported files are not encrypted." with the choice of a locked archive.

- Engine: vault.export, vault.exports.

- Rules: vault.export writes text cells as text, so a spreadsheet cannot run them as formulas.

### RP-08Ask a person

Day 10.

- For: not being left stuck when Chausar says not yet.

- Shows: one file made from the question, its receipt and the reason, to send to your own accountant or CA yourself.

- Engine: support.askAPerson, support.openQuestionFile (day 10).

- Rules: the app sends nothing by itself. An accountant or CA seat can open such a file in the client's workspace with "Open a question file".

## Tools

### TL-01Small apps

Day 9.

- For: small screens made on request.

- Shows: the apps as rows, each with its state. "Make one": a field for one line. Then, before anything is made, the permission list: the calculations it would read and the actions it would propose, each by name.

- States: making; made; stale; blocked; refused (the line asked for something no app may do, with the reason).

- Engine: apps.list, apps.make, apps.create.

- Rules: your one line is data. An app never has more permission than the person using it.

A small app

### TL-02A small app

Day 9, experimental. Picture: S12.

- For: using what was made.

- Shows: the app, drawn inside the locked, sandboxed frame on a separate origin, from the app's typed description, with Chausar's tokens: tables, charts, forms, buttons, filters. A line under it: made from your one line on a date, what it uses (the permission list), that it runs with your permissions.

- States: stale: a meaning it depends on changed. The app is blocked until rebuilt and shows what changed. Text removed: the number guard took out text in the app that carried a number not on a receipt, and the app says "Some text was removed: a number in it was not on a receipt."

- Engine: apps.get, apps.view, apps.rebuild.

- Rules: every number comes from the engine with a receipt. Every action goes through an approval as usual. The frame follows the day 9 prompt; this is not an open choice.

### TL-03The follow-up book

Day 9, experimental.

- For: a small record of who was called and what was said.

- Shows: a table: customer, date, what was said, next date. Add an entry.

- Engine: apps.view, apps.act.

- Rules: entries are kept in the business memory with their dates and can be exported and deleted like anything else.

Plugins, with the install sheet open

### TL-04Plugins

Day 9. Picture: S13.

- For: add-ons from other people.

- Shows: rows: the plugin, who made it, its level (built in, checked by Chausar, community, blocked), what kind it is (data only, or with code).

- States: stopped by Chausar's blocked list, with the reason.

- Engine: plugins.list.

### TL-05Install a plugin

Day 9.

- For: deciding what a plugin may do before it does anything.

- Shows: who made it and its level; the version and licence; whether the signature is valid; a drawing of the locked box with its doors; then each thing it asks for as a row with No and Yes: which calculations it may read, which actions it may propose, which sites it may reach.

- States: a community plugin starts with every answer No. The publisher's key changed: a warning. Contains something that is not built for the locked box: refused. Flagged text: a description or a message in the plugin "reads like an instruction to the AI", shown as data with that label. No internet: the rule the founder set for checking the blocked list. A plugin that brings its own screen draws it in the locked frame on a separate origin, like a small app.

- Engine: plugins.inspect, plugins.install, plugins.remove.

- Rules: a plugin never holds a key. Removing it takes away its permissions and its stored state at once; what it produced stays, labelled with its name.

### TL-06A tool from outside

Day 9.

- For: using a tool made for other assistants, safely.

- Shows: the description Chausar wrote beside the description the tool sent.

- States: the tool's description changed: set aside until you approve again.

- Engine: plugins.wrapped, plugins.reapprove.

### TL-07A request from a connected tool

Day 9.

- For: a question a tool asks you, kept apart from everything else.

- Shows: a sheet that names the tool, shows its question as data, and says what it will receive.

- Rules: a secret is never typed into this sheet.

### TL-08Other assistants

Day 9.

- For: letting another AI assistant ask Chausar for numbers with receipts.

- Shows: off by default. The server card: its version, and "this computer only". One row per assistant you allow, with its last call. Pairing shows a token once. The call list: for each call, the client, the calculation, the receipt id, and what the disclosure check removed before it was returned.

- States: a call that asked to change something: refused, and shown.

- Engine: numbers.status, numbers.pair, numbers.revoke, numbers.calls.

- Rules: read only: list the calculations, run one, open a receipt, list what is covered. Every result passes the Send rule before it is returned.

### TL-09Phone

Day 5 (briefs), day 9 (approvals).

- For: what reaches your phone.

- Shows: WhatsApp and mail, each a row with its switch; two fields, your mail address and your phone number, each with Verify; the exact text of each message; your agreement with its date; messages this month against 30; the cost of each; which kinds of change may be approved from the phone (one small change that can be undone, and nothing else).

- States: "The relay is a paid, hosted part: planned, not available yet." Not verified: nothing is sent. Test mode: "Sends only to the demo inbox and phone." HELP and STOP explained: HELP gets a person, STOP ends messages and is recorded with its date.

- Engine: phone.channels, phone.preview, phone.optIn, phone.usage, phone.verify.

### TL-10Language packs

Day 9.

- For: more languages, starting with Hinglish.

- Shows: packs as rows, each with its test result as a count ("58 of 60 cases"). A pack is "supported" only when its tests pass. A language that no native reader has signed says so: "Hindi: not yet reviewed".

- Engine: plugins.list.

## Trust

Trust: the four rules

### TR-01Rules

Day 1. Picture: S10.

- For: the four questions on one screen.

- Shows: four rows, See, Send, Keep, Do, each with its setting in a few words. A row opens in place. Under them, "What left this computer today" as a small drawing. At the foot, one note on personal data: "You are responsible for your customers' data. This app helps you see it, delete it and get a report." It links to BK-20 and TR-13.

- Engine: trust.get, trust.set, trust.leftToday.

- Rules: software enforces each rule before anything happens. Only the owner may change Send and the sharing boxes.

### TR-02See

Day 1; markings on day 6.

- For: which sources Chausar may read, and which data is marked.

- Shows: each source with No and Yes. From day 6: the markings personal, financial and confidential, and what each seat may see. A marking can be put on a source file, on a record's page, or on a field in a table; this screen says where to do each.

- Engine: trust.get, trust.set, markings.list, markings.set.

- Rules: a marking follows the data into every summary, report, brief and export made from it. Bank data is marked financial from the start.

### TR-03Send

Day 1; the rule for financial data on day 6.

- For: what an AI model may be sent.

- Shows: three levels, each drawn as a tiny table of your own data with stand-ins for names (CUSTOMER_1, CUSTOMER_2): nothing, shape only (headings and types, no values), samples (a few rows). Under each level, two more lines: what memory lines may be sent, and whether the text of your question is sent. The level in use has an ink line above it. Under them: voice (off, and "audio leaves this computer when voice is on"), "Local only" as a named setting, and the routes approved for data marked financial.

- Engine: trust.sendLevels, trust.set.

- Rules: names, phone numbers and GSTINs are swapped for stand-ins before any call and put back after. Data marked financial goes only to a local model or a route you approved. A key typed here passes straight to the engine once and is never shown again.

### TR-04Keep

Day 1; keep-until per kind on day 6.

- For: what is kept, and for how long.

- Shows: rows per kind of data with how long it is kept. A link to the list of everything the app writes to disk.

- Engine: trust.keep, vault.inventory.

### TR-05Do

Day 1 (the presets, stored), day 7 (actions), day 8 (the full screen).

- For: what may run without asking.

- Shows: three presets: ask me everything (the start), routine work on its own, everything except what always waits. A preset is a starting point: it sets the switch for each kind, and there is no single switch that makes everything run on its own. Then each kind of action as a row with its switch and its daily limits on count and amount. Then "Always waits for you", the always-waits list, with no switches. It begins "Anything that cannot be undone, and in particular:" money, messages to outsiders, deleting, prices, stock, listings, sharing, invites to outsiders, webhooks, and tax filings (prepare only). Every other screen refers to this list. Then a Limits group: reminder caps (one per customer per day, 20 a day in all), the active jobs limit (10), and the monthly AI cap.

- States: from day 8, beside each kind: how often the rule would have agreed with what you approved.

- Engine: trust.autonomy, trust.setAutonomy, trust.alwaysWaits, trust.agreement, trust.caps, models.setCap.

People and machines

### TR-06People

Day 6. Picture: S11.

- For: who is in, and what each may do.

- Shows: rows: the person with a filled grey square (yours is ink), the seat, what the seat allows in a few words. Invite.

- You can: invite a cofounder, an accountant, a CA (reads and exports, until a date), staff (adds entries, sees their own). "Invite my accountant" also makes a one-page guide to forward. Remove a person.

- States: a CA seat past its end date: "This seat ended on 31 Oct." Removed: "Removed on 2 Oct. What was already copied or exported stays with that person."

- Rules: the accountant's seat has four limits, stated on the seat: reads everything not marked away from it; prepares actions; cannot approve money; cannot change Send, Sharing or seats. A cofounder has everything, except that changes to Send, Sharing and seats need both the owner and the cofounder.

- Engine: seats.list, seats.invite, seats.get, seats.remove, seats.templates.

### TR-07Machines and the pen

Day 6.

- For: which computers hold this workspace, and which one may write.

- Shows: a small drawing: the computer that holds the pen, the shared folder of locked files, the other computers that read, and the phone. "Hand over the pen." Under it, one row per machine with Remove: "Removing a machine changes the key. What it already copied stays on it." Sync set-up: a folder on this network or Google Drive, the narrow access it asks for in plain words, and how long Drive keeps old copies. A home box machine, labelled experimental; whether it is free or paid is open (main file, part 15).

- States: this computer is read only: a seat here may read and ask; "prepare" goes to the pen holder as a request. Sync behind: "Laptop 2 last read the folder at 18:40 yesterday." Taking the pen when the holder cannot be reached: experimental, and late changes from the old holder are shown for a person to settle.

- Engine: devices.list, devices.pen, devices.handOver, devices.remove, sync.status, sync.setup (day 6).

- Rules: one writer at a time. Only the computer that holds the pen runs scheduled jobs.

### TR-08Models

Day 1; the comparison on day 8.

- For: each route to an AI model, its terms and its cost.

- Shows: one row per route: its health; what the provider keeps, for how long, whether it trains on it, in which country, a link to its terms and the date they were read. The order you try routes in. The cost of the last answer, the spend this month, and the monthly limit you set. A voice row: the speech provider, its key, its cost per minute, and the minutes used this month.

- States: ready, signed out, not installed, version not tested, timed out, error. Chat only, no calculations. Answers only, not for actions. From day 8: the same test for every route, as a table.

- Engine: models.routes, models.cards, models.setLadder, models.spend, models.setCap, models.comparison, voice.providers, voice.usage.

### TR-09Network

Day 1; taint and the canary alert on day 8; plugins on day 9.

- For: every call that left this computer.

- Shows: a time line, newest first: where it went, why, how much, allowed or stopped.

- You can: filter by plugin.

- States: a send stopped because the run had read outside text: the exact content that would have gone, waiting for you. A canary alert: a planted test value was seen leaving, so every send stops and the row says which call carried it.

- Engine: network.ledger, network.canary (day 8).

### TR-10Record

Day 6.

- For: who did what, when and why, in a form that shows tampering.

- Shows: a time line: who, what, the rule in plain words, when, which computer. Filters by person and day. Verify.

- States: verified, or the line where the chain breaks. One sentence states the limit: "This record shows tampering. It cannot stop the owner of a computer from wiping that computer."

- Engine: record.list, record.verify, record.head.

### TR-11Sharing

Day 1 (off, with a preview), day 4 (live).

- For: what you share with Chausar, if you share.

- Shows: the boxes, each empty at the start. The exact file that would be sent. "What I shared": each batch with its date, size and count, Open and Delete from the server, and a running line: "412 events shared, 0 names, 0 amounts." Credits, under a public name or none. The learning log, one row per event with the decision taken and the grade of its label. From day 4, the local cleaner: pick a sample file, see the cleaned copy beside it, and each pattern scan hit by line. "Nothing is uploaded."

- States: a batch blocked on this computer because a GSTIN, PAN, phone, mail, IFSC or UPI id was found in it: the line is shown. Boxes ticked but intake not open: "Sharing is not open yet. Nothing is sent." Two more boxes behind a founder switch, not shown until it is on. A demo test switch, labelled as such. Sharing withdrawn.

- Engine: sharing.consent, sharing.preview, sharing.batches, sharing.deleteBatch, sharing.withdraw, sharing.log, sharing.intakeStatus, sharing.cleanSample (day 4).

- Rules: structure only. Never values, names or amounts.

### TR-12Vault

Day 1; the recovery contact on day 6; "This computer" on day 7.

- For: looking after the one copy of the books.

- Shows: the last backup and whether its test restore passed; Back up now; Restore; the lock (idle time, PIN, the computer's own check); the disk check, with the honest limit: "A program running as you on this computer can read what you can read. The passphrase limits this; it does not remove it." The recovery contact, from day 6: a person you trust who can confirm a recovery. "This computer" (SH-07): start at login, background mode, wake for jobs. The version (SH-08).

- Engine: vault.backups, vault.backupNow, vault.testRestore, vault.restore, vault.lockSettings, vault.diskCheck, vault.recoveryContact, shell.startAtLogin, jobs.setBackground, jobs.setWake.

### TR-13Delete, and the deletion report

Day 6.

- For: deleting something everywhere, with proof.

- Shows: after a deletion, a table: each place data lives, and for each: deleted, pending, not possible, or not built yet, with the reason. "Not possible" names outside copies honestly: the AI provider for its stated period, briefs already sent, old versions in your Drive.

- You can: export the report.

- Engine: deletion.request, deletion.report.

- Rules: nothing is reported deleted without a check that it is gone. A restore keeps deleted things deleted.

### TR-14What the paid plan can see

Day 6; the plan's state on day 10.

- For: two hosted promises, shown separately.

- Shows: "Hosted backup and sync are blind: the server holds only locked files and no key." "Hosted jobs are not blind: the server holds a key for that one job while it works." Each hosted job is listed with its switch. Every paid part says "planned, not available yet". The records the paid plan keeps about you: kept for one year, with no business content.

- States: the plan ended: "Your plan ended. Your data is here and nothing is locked."

- Engine: trust.hosted.

### TR-15The privacy notice and your agreements

Day 4 (record), day 10 (notice).

- For: reading what you agreed to, and taking it back.

- Shows: the notice in Hindi and English. Each agreement by person and purpose with its date. Withdraw.

- Engine: sharing.consentRecord.

## Phone

What a message says

### PH-01Messages

Day 5 (the week ahead), day 9 (approvals). Picture: S16.

- For: knowing something is ready without opening the laptop.

- Shows: four fixed messages, each a headline and a link: "The week ahead is ready."; "Something is ready for your review."; "A document was received."; "A due date is near."

- States: one small change that can be undone: Approve, Not now, Open the app. Anything else, including a group of small changes and everything on the always-waits list (TR-05): Open the app only.

- Rules: no amounts, no counts, no names, no dates of money. A test fails on any digit in a message body. Each button works once, for the owner's number only, and expires after 30 minutes. A forwarded copy does nothing. About 30 messages a month.

### PH-02The link page

Day 5.

- For: getting from a message to the app.

- Shows: the wordmark and one line: "Open Chausar on your computer to see this." If the app is on this device, it opens.

- States: the link is old or was changed: "This link no longer works."

- Rules: the page holds no data.

### PH-03Mail

Day 5, day 9.

- For: the same messages by mail, as the fallback.

- Shows: the same headline and one link. An approval by mail uses the same one-time link. Never "reply yes".

The paired phone page

### PH-04The phone page

After day 10, for the founder's decision. Picture: S17.

- For: a calmer way to see what awaits you, away from the desk.

- Shows: "Awaiting your review" with the same count as the desktop, as rows, with Approve only on one small change that can be undone; every other row says "In the app". "The week ahead" as three headlines; when the laptop was last seen.

- Rules: headlines only. Figures and receipts stay on the computer. A row may take two lines.

### PH-05Send a document from the phone

Day 9, experimental.

- For: forwarding a bill or a statement to Chausar.

- Shows: on the phone, the fixed reply "Document received". In the app, a row under "Awaiting your review": the document, to confirm.

- Rules: a forwarded document is data. It enters the same checks as a file brought on the computer, and nothing is stored before you confirm.

# Chausar app: the enterprise version and the CA console

Part of the frontend design of 1 October 2026.

The founder's choice: the enterprise version is "the same app, grown up". This file says what grows, where each enterprise screen lives, and how the console for CA firms works.

What this rests on. The enterprise screens are taken from the final plan, the expanded product architecture, the blueprint and the concept book. An inventory of those documents found 176 surfaces and 18 groups of rules. None of those documents describes a desktop app, an accountant or a CA firm, so every placement below is Fable's judgment, and the CA console is a design with no source document behind it. The final plan also says of itself that what it documents is not built or tested.

## 1. What stays, and what is added

The desktop app and the enterprise version, side by side

| 
| 
Desktop app | 
Enterprise version | 

| 
Where it runs | 
On your computer | 
In a browser, against the company's own server | 

| 
Who gets in | 
A passphrase, and seats you invite | 
The company account, with people added and removed from the company's directory | 

| 
Places | 
Seven | 
The same seven, and an eighth, Company, for whoever looks after the installation | 

| 
What a person sees first | 
Today | 
Today, shaped by role | 

| 
Views | 
Simple, Guided, Books | 
Guided and Books. Simple stays for staff who only approve or enter | 

| 
How many businesses | 
One per workspace, with a switcher | 
Group companies in one workspace, with a switcher and combined views | 

| 
Rules | 
One owner sets them | 
Roles, markings, approval chains, access reviews | 

| 
The look, the parts, the words | 
As in the main file | 
The same. Nothing is restyled | 

Four things are added to the frame.

- The lens. A row of words at the top of Today: Whole group, Finance, Sales, Operations. A lens is a saved way of looking at the same business. It changes which objectives and changes are shown, not what is true.

- The company switcher. In the menu at the foot of the rail: each company in the group, and "All companies". A combined figure always shows what was removed between group companies and what could not be matched, as its own rows.

- Whose. Lists carry three words at the top right: Mine, My team, Everyone. Rows say who prepared or owns the thing ("prepared by Accounts Payable").

- Company. The eighth place, shown only to people who administer the installation.

These are the same four the main file lists in part 13. Trust also gains sub-places (Access, Markings, Retention, Channels); they are listed in section 3, apart from the frame.

The enterprise home may show four stat tiles where the desktop shows three, because the wide column has room. A tile there may use the short form, such as ₹6.08 Cr, with the exact value one click away.

The enterprise home

The picture shows a head of finance who does not administer the installation, so the rail has seven places and no Company.

What changes in the browser. The same screens, with these differences in banners and states.

| 
Banner or state | 
Desktop | 
Browser | 

| 
Locked | 
The lock screen | 
"Signed out", and the company's sign-in | 

| 
No connection | 
Answers from your books still work; questions in plain words wait | 
Fails closed: nothing works until the connection is back. Approve pressed while reconnecting is refused, and the person presses it again once the page is current | 

| 
Live state | 
Not shown | 
The first fact on the status line: current, as of a time, catching up, or reconnecting | 

| 
Read only | 
Another computer holds the pen | 
Not used: the server is the one writer | 

| 
Jobs are paused | 
The window was closed with background mode off | 
Not used: jobs run on the server | 

| 
Update needed | 
A build expired or was withdrawn | 
The administrator updates the server; people see "Updated. Reload to continue." | 

| 
Demo clock, Sending is closed, Chausar is driving | 
As on the desktop | 
As on the desktop | 

## 2. Each role opens on what it needs

The final plan asks that "each role sees useful work first". The rail lists only the places and sub-places a person can use.

| 
Role | 
Opens on | 
In the view | 

| 
A leader: a CEO, a function head, a strategy team | 
Today as drawn above: what awaits review, the group this month, what changed since the last visit, and one line of what is running | 
Guided | 

| 
An operator: accounts payable, sales operations | 
Today as a queue: cases, tasks, approvals and deadlines in one table | 
Books | 

| 
A specialist who maintains meanings and mappings | 
Books | 
Books | 

| 
An administrator | 
Company | 
Guided | 

| 
An auditor | 
Trust, Record, read only | 
Books | 

| 
A developer | 
Company, Build | 
Books | 

The leader's Today follows three rules from the blueprint. It shows a small number of meaningful things, never every measure. Each change says its scope, its period and how much evidence stands behind it ("measured, cause not yet known"; "2 of 3 sources loaded"). And things that did not change stay quiet: one grey line says "9 other objectives: no material change". An empty Today says which of two things is true: nothing changed, or too little is loaded to tell.

## 3. Sub-places the enterprise version adds

| 
Place | 
Desktop sub-places | 
Added for a company | 

| 
Today | 
Today, Activity | 
The lens. A leader's and an operator's form of Today | 

| 
Ask | 
New, Saved, Decisions, Checks, Not yet | 
Plans: several options compared against one baseline, and the list of plans that compete for the same stock, budget or capacity | 

| 
Work | 
Approvals, Jobs, Actions, What it can do | 
Cases: one record per piece of business work, with owner, deadline and state. Agents: the AI workers, what each may do, and its released version | 

| 
Books | 
Sources, Meanings, Accounts, Customers, History, Memory | 
Customers becomes Records, for every kind of record. Issues: data that could not be published, with an owner. Companies: the group and how it combines | 

| 
Reports | 
Packs, The week ahead, Due dates, Exports | 
The week ahead becomes Briefs, one per role. Sent: what was shared outward, with whom, and what can still be taken back | 

| 
Tools | 
Small apps, Plugins, Other assistants, Phone | 
Planning: forecast and planning set-ups and whether each is still good to use. Phone moves to Trust as Channels | 

| 
Trust | 
Rules, People, Models, Network, Record, Sharing, Vault | 
Access: roles, grants, reviews. Markings. Retention: every copy and its clock, and legal holds. Channels: what may be sent, as whom | 

| 
Company | 
| 
Sign-in, Health, Recovery, Keys, Support access, Computers, Quality, Build, Licence | 

Trust is about the data and what Chausar may do with it. Company is about the installation.

## 4. New parts the enterprise version needs

Everything in the enterprise version is built from the parts of the desktop app. Twelve things are new.

| 
Part | 
What it is | 

| 
Lens | 
A row of words; the chosen one is underlined | 

| 
Approval chain | 
In an approval sheet, one small square per approver on a line, with the name under each: filled grey for another person who approved, filled ink when it was you, the larger open square for the one whose turn it is, open grey for those not reached. A person who declined gets a filled amber square and the word "declined"; a person removed from the chain gets an open grey square, the name struck through and the word "removed". The rules are stated in words: "Two of three must approve. You cannot approve your own request." | 

| 
Hidden content | 
When a role may know that something is hidden: "Some rows are hidden from your role", and a field shows the word "hidden" in grey. When even that would reveal something, nothing is shown, and counts, searches and totals behave as if the rows were not there. A total that would reveal fewer than a set number of hidden rows is refused | 

| 
Marking | 
A small label in capitals at the top right of a page or sheet ("CONFIDENTIAL · FINANCE"). It follows the content into every report, export and brief | 

| 
Live state | 
The first fact on the status line says how current the page is: current, as of a time, catching up, or reconnecting. A page never calls an old result current | 

| 
Situation | 
One row on Today for one business change. It opens a page: what changed, measured; what it is connected to; what is being done; and the responses allowed | 

| 
Notes and hand-over | 
In any sheet: notes by named people, and "Give this to" a person. The states are given, seen, done | 

| 
Editing together | 
"Meera Demo is editing this draft." Open a copy. When two people changed the same record, both values are shown and one is chosen | 

| 
Live session | 
A panel inside a job that shows the one window an agent is using, with Pause, Take over and Stop always visible. After a person takes over, the agent looks again before it acts | 

| 
Results per item | 
For one action applied to many things: a table with one row per item and its own result. The list it ran on is named and fixed | 

| 
Out of service | 
A label on any screen whose engine part is down: "Forecasts are paused. Answers from the books still work." Company, Health shows all of them in one table | 

| 
Approximate | 
The label on a figure that was made less exact on purpose to protect people, with how much of the allowance is left | 

## 5. Where every enterprise surface lives

The numbers are those of the inventory. "Both" means the desktop app has a smaller form of the same thing; its code from screens.md is given. "Enterprise" means the desktop app does not have it.

### Home, workspaces and attention

| 
# | 
Surface | 
Edition | 
Lives in | 
Built from | 

| 
A1.1 | 
The leader's opening screen | 
Both | 
Today | 
TD-01, with the lens and "changed since" | 

| 
A1.2 | 
The operator's daily screen | 
Both | 
Today, Books view | 
TD-03, as one queue | 

| 
A1.3 | 
One app whose menu fits the person | 
Both | 
The rail | 
Places a person cannot use are not listed | 

| 
A1.4 | 
Saved lenses | 
Both | 
Today, and "About" on the ask line | 
Lens | 

| 
A1.5 | 
A situation | 
Both | 
A row on Today that opens a page | 
Situation; AS-10 | 

| 
A1.6 | 
Briefs and focused updates | 
Both | 
Today; Reports, Briefs | 
RP-03. An update only for a material change | 

| 
A1.7 | 
A personal work area | 
Both | 
"Mine" on every list | 
Not a place | 

| 
A1.8 | 
Shared rooms and team spaces | 
Enterprise | 
A named lens with a list of people, over Work and Ask | 
Lens; notes and hand-over; editing together | 

| 
A1.9 | 
Notifications and hand-overs | 
Both | 
The count on Today; Work, Approvals; messages | 
PH-01. Delivered is not the same as seen | 

### Asking and answers

| 
# | 
Surface | 
Edition | 
Lives in | 
Built from | 

| 
A2.1 | 
An answer | 
Both | 
Ask | 
AS-04 | 

| 
A2.2 | 
Clarification and what was understood | 
Both | 
Ask | 
AS-02, AS-03 | 

| 
A2.3 | 
Receipt and the trail behind a number | 
Both | 
From every number | 
AS-05, with the trail as a chain you can walk | 

| 
A2.4 | 
What supports each sentence | 
Both | 
The receipt | 
The number check, grown: each sentence lists the figures it rests on | 

| 
A2.5 | 
The passages an answer relied on | 
Both | 
The receipt's small print | 
Each passage with its heading and units | 

| 
A2.6 | 
"Not found", and how hard it looked | 
Both | 
Ask | 
AS-08, with where it looked | 

| 
A2.7 | 
Browsing records | 
Both | 
Books, Records | 
BK-12, for any kind of record | 

| 
A2.8 | 
Why two records are linked | 
Both | 
Books, Records | 
A chain drawing: order, shipment, invoice | 

| 
A2.9 | 
Saved and shared results, checked again | 
Both | 
Ask, Saved; Reports, Sent | 
AS-14, AS-16 | 

| 
A2.10 | 
An investigation | 
Both | 
Ask, Saved; its runs in Work | 
AS-10 | 

| 
A2.11 | 
Why a number moved | 
Both | 
Ask | 
AS-10, the bridge chart | 

| 
A2.12 | 
Things said in mail, chat or calls | 
Both | 
Ask, as evidence; Books, Sources | 
A row with who said it and when; the label "said by", never a fact | 

| 
A2.13 | 
Correcting an answer already given | 
Both | 
A notice on the answer; who received it, in Work | 
The stale pattern of AS-14 | 

| 
A2.14 | 
The exact place a number came from | 
Both | 
The sheet | 
The page with the region outlined, as in WK-13 | 

| 
A2.15 | 
Charts of values over time | 
Both | 
Every chart | 
Observed in ink, estimated lighter and labelled, missing left as a gap | 

| 
A2.16 | 
Answers that depend on places | 
Both | 
Ask | 
Left for later, as the plan says of maps. Uncertainty in words | 

| 
A2.17 | 
Figures across group companies | 
Enterprise | 
Books, Companies; Reports | 
The company switcher; removed and unmatched amounts as rows | 

### Meanings

| 
# | 
Surface | 
Edition | 
Lives in | 
Built from | 

| 
A3.1 | 
The specialist's workspace | 
Both | 
Books, in the Books view | 
BK-07, BK-05 as tables | 

| 
A3.2 | 
Writing meanings, several people at once | 
Enterprise | 
Books, Meanings | 
BK-08; editing together | 

| 
A3.3 | 
Review, release and switching on | 
Both | 
Books, Meanings; the release in Work, Approvals | 
BK-08; approval chain | 

| 
A3.4 | 
Is a release ready everywhere; undoing it | 
Enterprise | 
Books, Meanings, a release | 
A table of where it is active, with Roll back | 

| 
A3.5 | 
A meaning's page | 
Both | 
Books, Meanings | 
BK-08 | 

| 
A3.6 | 
Packs and a company's own additions | 
Both | 
Books, Meanings | 
BK-10 | 

| 
A3.7 | 
India rules and their review | 
Both | 
Books, Meanings | 
BK-19, with the reviewer named on a statutory rule | 

| 
A3.8 | 
Managed code lists | 
Both | 
Books, Meanings | 
A table of codes; an unknown value asks, as in BK-05 | 

| 
A3.9 | 
Fiscal calendars; closing and reopening a period | 
Both | 
Books, History | 
One row per period: open, closed, reopened and by whom | 

| 
A3.10 | 
Saved lists of things | 
Both | 
Books, Records; Ask | 
A list with the label live, or frozen on a date | 

| 
A3.11 | 
Does a fix change a meaning | 
Enterprise | 
Books, Meanings | 
An approval that asks that one question | 

| 
A3.12 | 
Writing how an action works | 
Enterprise | 
Work, What it can do | 
A form sheet. Read-back and reversal are required fields | 

| 
A3.13 | 
The group and how it combines | 
Enterprise | 
Books, Companies | 
A table of companies, currency, calendar and removal rules | 

### Sources and mapping

| 
# | 
Surface | 
Edition | 
Lives in | 
Built from | 

| 
A4.1 | 
Connections and what each can do | 
Both | 
Books, Sources | 
BK-01, BK-03 | 

| 
A4.2 | 
What Chausar can read, per operation | 
Both | 
Books, Add a source. The inner matrix is in Chausar's own console | 
BK-03 | 

| 
A4.3 | 
Finding sources and getting set up | 
Both | 
Books, Sources; first run | 
FR-07, FR-08 | 

| 
A4.4 | 
Checking a mapping | 
Both | 
Books, Sources, a recipe | 
BK-05 | 

| 
A4.5 | 
Questions about an unclear field | 
Both | 
Awaiting your review; Books | 
BK-05, sent to the right person | 

| 
A4.6 | 
Data passes checks before it counts | 
Both | 
Books, Sources, a source | 
Checks as rows; what a change affects | 

| 
A4.7 | 
Is each source flowing | 
Both | 
Books, Sources | 
BK-01. The consequence in words on Today | 

| 
A4.8 | 
Pause, repoint, retire; rotate a password | 
Both | 
Books, Sources; the credential in Trust | 
BK-02 | 

| 
A4.9 | 
Data that could not be published | 
Enterprise | 
Books, Issues; given items in Work | 
A table: issue, source, owner, what would fix it | 

| 
A4.10 | 
Sources that disagree; entries typed by hand | 
Both | 
Books, Records | 
BK-14, with the label "entered by hand" | 

| 
A4.11 | 
What arrived and what did not | 
Both | 
Books, Sources; every receipt | 
BK-01, AS-05 | 

| 
A4.12 | 
Matching the system's own reports | 
Both | 
Books, Sources, a recipe | 
BK-05, slice by slice in a table | 

| 
A4.13 | 
How and when data came in | 
Both | 
Books, Sources, a source | 
BK-02, the history of reads | 

| 
A4.14 | 
Reports Chausar asks a system for | 
Both | 
Books, Sources; the live session in Work | 
WK-14 | 

| 
A4.15 | 
Checking figures read from documents | 
Both | 
Books, Sources | 
WK-13: the page beside the form | 

| 
A4.16 | 
How hard to lean on a system | 
Both | 
Books, Sources, a source's settings | 
Rows that open in place | 

| 
A4.17 | 
Mail, chat and meetings as sources | 
Both | 
Trust, Rules, See; Books, Sources | 
Off by default, one switch per mailbox or channel | 

| 
A4.18 | 
News from outside | 
Both | 
Books, Sources; a row on Today | 
The label "from outside", with source and time | 

### History and identity

| 
# | 
Surface | 
Edition | 
Lives in | 
Built from | 

| 
A5.1 | 
What was known then | 
Both | 
Books, History | 
BK-15 | 

| 
A5.2 | 
Corrections and withdrawals | 
Both | 
Books, History | 
BK-15. A reason is required | 

| 
A5.3 | 
An old result redone under a new meaning | 
Both | 
Books, History; Reports | 
Two figures side by side and a bridge chart of the difference | 

| 
A5.4 | 
Same record or not | 
Both | 
Books, Records | 
BK-13 | 

| 
A5.5 | 
History after something was erased | 
Both | 
Books, History | 
"Removed on 2 Oct", and what can no longer be answered | 

### Permissions, markings and privacy

| 
# | 
Surface | 
Edition | 
Lives in | 
Built from | 

| 
A6.1 | 
See, send, keep, do | 
Both | 
Trust, Rules | 
TR-01 to TR-05 | 

| 
A6.2 | 
Model routes and what was sent | 
Both | 
Trust, Models; receipts | 
TR-08, AS-07 | 

| 
A6.3 | 
Sharing with a wider audience | 
Enterprise | 
A Share action on any result | 
A sheet: the audience, what must be true first, what they will and will not see | 

| 
A6.4 | 
Roles, grants and access reviews | 
Enterprise | 
Trust, Access | 
A table of roles; a role as rows that open; a review queue; "Try a rule" | 

| 
A6.5 | 
What a restricted person sees | 
Both | 
Everywhere | 
Hidden content | 

| 
A6.6 | 
Access checked again on opening | 
Both | 
Everywhere | 
"Access removed by Meera Demo on 2 Oct." | 

| 
A6.7 | 
Markings, and lowering one | 
Enterprise | 
Trust, Markings | 
TR-02; marking | 

| 
A6.8 | 
Why access was allowed or refused | 
Enterprise | 
Trust, Record | 
A sheet: the rule, its version, and the same decision run again | 

| 
A6.9 | 
Figures made less exact to protect people | 
Enterprise | 
Reports; Trust | 
Approximate | 

| 
A6.10 | 
Deleting and how far it got | 
Both | 
Trust, Vault | 
TR-13 | 

| 
A6.11 | 
Every copy and how long it is kept | 
Enterprise | 
Trust, Retention | 
TR-04 as a table of copies and clocks | 

| 
A6.12 | 
Legal holds | 
Enterprise | 
Trust, Retention | 
Rows: the hold, who is covered, what it blocks | 

| 
A6.13 | 
Data allowed for one purpose only | 
Enterprise | 
Trust, Access | 
The purpose named on each piece of work; reuse asks | 

| 
A6.14 | 
Where data may go, and where it went | 
Both | 
Trust, Network | 
TR-09 | 

### Actions and approvals

| 
# | 
Surface | 
Edition | 
Lives in | 
Built from | 

| 
A7.1 | 
What will happen, before it happens | 
Both | 
Work, Approvals | 
WK-02 | 

| 
A7.2 | 
The request to approve one change | 
Both | 
Work, Approvals; Today | 
WK-02; approval chain | 

| 
A7.3 | 
What may run, and who must approve | 
Both | 
Trust, Rules, Do | 
TR-05 | 

| 
A7.4 | 
The true state of an action | 
Both | 
Work, Actions | 
WK-04, WK-05 | 

| 
A7.5 | 
Not sure it happened | 
Both | 
Work, Actions; Today | 
WK-04 | 

| 
A7.6 | 
Reviewing a whole plan of linked actions | 
Both | 
Work, Approvals | 
A sheet with the steps in order. Each step is still read back | 

| 
A7.7 | 
One action on many things | 
Both | 
Work, Actions | 
WK-03; results per item, one approval per item inside one sheet | 

| 
A7.8 | 
What a cancel stopped | 
Both | 
Work, Actions | 
Three groups: stopped, already happened, not sure | 

| 
A7.9 | 
A repair that follows an action | 
Both | 
Work, Actions | 
WK-05: a reversal is a new action | 

| 
A7.10 | 
A step only a person can do | 
Both | 
Work, Jobs | 
WK-16 | 

| 
A7.11 | 
Forms that change a record | 
Both | 
Books, Records; Tools | 
A form sheet; editing together | 

| 
A7.12 | 
Changes needed inside a source | 
Both | 
Books, Sources; Work, Approvals | 
WK-02 | 

| 
A7.13 | 
After a restore | 
Both | 
Work, Actions | 
WK-15 | 

### Jobs, agents and the inbox

| 
# | 
Surface | 
Edition | 
Lives in | 
Built from | 

| 
A8.1 | 
One record per piece of work | 
Both | 
Work, Cases; on the desktop, Work, Jobs | 
WK-07, WK-08. A page: what was asked, what is done, who owns what is left | 

| 
A8.2 | 
Progress, and honest "stuck" | 
Both | 
Work, Jobs | 
WK-08 | 

| 
A8.3 | 
Steering a running job | 
Both | 
Work, Jobs | 
The ask line, "About: this job"; each change as a row in the time line | 

| 
A8.4 | 
Work handed to helpers | 
Both | 
Work, Jobs | 
Child tasks as indented rows | 

| 
A8.5 | 
Standing jobs | 
Both | 
Work, Jobs | 
WK-08, WK-09. A job that loses its owner pauses and asks for a new one | 

| 
A8.6 | 
Everything waiting on a person | 
Both | 
Work, Approvals; Today | 
WK-01 | 

| 
A8.7 | 
Budgets and spend | 
Both | 
Work, Jobs; Trust, Rules | 
WK-08; a table by team | 

| 
A8.8 | 
The AI workers and their versions | 
Enterprise | 
Work, Agents | 
A table | 

| 
A8.9 | 
Ready-made procedures | 
Both | 
Work, Jobs | 
WK-09 | 

| 
A8.10 | 
The operations board | 
Enterprise | 
Work, Cases | 
A table: case, owner, deadline, state | 

| 
A8.11 | 
Working on the same thing with others | 
Both | 
Any sheet | 
Notes and hand-over | 

| 
A8.12 | 
Automations that kept triggering each other | 
Both | 
Work, Jobs | 
The state "set aside", with that reason | 

| 
A8.13 | 
Schedules | 
Both | 
Work, Jobs | 
WK-11, with the next runs listed | 

### Decisions, scenarios and strategy

| 
# | 
Surface | 
Edition | 
Lives in | 
Built from | 

| 
A9.1 | 
Comparing options against one baseline | 
Both | 
Ask, Plans; on the desktop, Ask, Saved | 
AS-11 with one column per option | 

| 
A9.2 | 
Changing an option; turning one into real work | 
Both | 
Ask, Plans, then Work | 
Accept makes prepared actions (WK-02) | 

| 
A9.3 | 
Forecasts | 
Both | 
Ask; Tools, Planning | 
AS-12 | 

| 
A9.4 | 
Setting up a planning problem | 
Enterprise | 
Tools, Planning | 
Rows that open: rules that must hold, preferences, goals | 

| 
A9.5 | 
The recommended plan, or why none fits | 
Both | 
Tools, Planning, then Work | 
AS-13 | 

| 
A9.6 | 
Is a scenario inside what the data supports | 
Enterprise | 
Ask, Plans | 
One line under a scenario | 

| 
A9.7 | 
Can an analysis be repeated exactly | 
Both | 
The receipt | 
A line in the small print | 

| 
A9.8 | 
What an intervention caused | 
Both | 
Ask | 
The label "estimated effect", apart from "measured" and "guess" | 

| 
A9.9 | 
Leads, apart from tested findings | 
Both | 
Today, worth a look; Ask | 
TD-01. The labels "lead, not tested" and "tested" | 

| 
A9.10 | 
Alerts | 
Both | 
Today; settings in Reports | 
TD-01. One row per episode, not one per check | 

| 
A9.11 | 
The decision journal | 
Both | 
Ask, Decisions | 
AS-15 | 

| 
A9.12 | 
Did a decision achieve its aim | 
Both | 
Ask, Decisions; objectives on Today | 
An outcome row on the decision | 

| 
A9.13 | 
Plans that compete for the same thing | 
Enterprise | 
Ask, Plans | 
A table of the plans and what each draws on | 

### Memory

| 
# | 
Surface | 
Edition | 
Lives in | 
Built from | 

| 
A10.1 | 
What the company knows | 
Both | 
Books, Memory | 
BK-17, with the kinds: evidence, claim, official fact | 

| 
A10.2 | 
Which lessons become shared guidance | 
Both | 
Work, Approvals; the Friday review | 
RP-04 | 

| 
A10.3 | 
What Chausar remembers about one person | 
Both | 
Books, Memory, "about me" | 
BK-17 | 

| 
A10.4 | 
What an agent was given for a task | 
Both | 
A step's sheet in Work, Jobs | 
WK-08. A list of items, each with why it was included | 

### Tools and computer sessions

| 
# | 
Surface | 
Edition | 
Lives in | 
Built from | 

| 
A11.1 | 
Making small apps | 
Both | 
Tools, Small apps | 
TL-01, TL-02 | 

| 
A11.2 | 
What an app may touch | 
Both | 
Tools, Small apps | 
TL-01 | 

| 
A11.3 | 
Sharing and publishing an app | 
Enterprise | 
Tools, Small apps | 
States: private, shared as a copy, shared as a template, published after review | 

| 
A11.4 | 
Skills and tools | 
Both | 
Tools, Plugins | 
TL-04 to TL-06 | 

| 
A11.5 | 
A request from a connected tool | 
Both | 
A sheet | 
TL-07 | 

| 
A11.6 | 
Watching an agent use a computer | 
Both | 
A panel in Work, Jobs; the banner | 
WK-14; live session | 

| 
A11.7 | 
Which computers agents may use | 
Both | 
Trust, Rules, Do; Company, Computers | 
A table of machines, their limits, cleaned or not | 

| 
A11.8 | 
What a session captured | 
Both | 
Work, Actions | 
A time line with its captures, kept as Trust, Keep says | 

| 
A11.9 | 
The developer's console | 
Enterprise | 
Company, Build | 
Tables: meanings, mappings, rules, actions, tests, releases | 

### Channels and customer service

| 
# | 
Surface | 
Edition | 
Lives in | 
Built from | 

| 
A12.1 | 
A company's own customers talking to a service agent | 
Enterprise | 
The customer window, outside the app | 
See section 7 | 

| 
A12.2 | 
Checking who a customer is | 
Enterprise | 
The customer window; Trust, Channels | 
A line: "Checked: phone ending 4471" | 

| 
A12.3 | 
One issue across channels | 
Enterprise | 
Work, Cases | 
A time line. Closed is not the same as solved | 

| 
A12.4 | 
Passing a live conversation to a person | 
Enterprise | 
Work, Cases; Today | 
The states offered, accepted by a named person | 

| 
A12.5 | 
Promises made to a customer | 
Enterprise | 
Work, Cases | 
A row: the promise, by when, kept or not | 

| 
A12.6 | 
Voice: reading back, and what was heard | 
Both | 
The ask line; Work | 
SH-05 | 

| 
A12.7 | 
Messages changed after sending | 
Enterprise | 
Work, Cases | 
"Edited after sending", with both versions | 

| 
A12.8 | 
What may be sent, and as whom | 
Both | 
Trust, Channels; on the desktop, Tools, Phone | 
TL-09 | 

### Reports and audit

| 
# | 
Surface | 
Edition | 
Lives in | 
Built from | 

| 
A13.1 | 
Reports and exports | 
Both | 
Reports | 
RP-01, RP-02 | 

| 
A13.2 | 
Sending a report outward | 
Enterprise | 
Reports, Sent | 
A sheet: a fixed audience, and what taking it back can and cannot undo | 

| 
A13.3 | 
The audit record and its export | 
Both | 
Trust, Record | 
TR-10, with an export that carries its own receipt | 

| 
A13.4 | 
Everything a customer takes when leaving | 
Both | 
Trust, Vault | 
RP-07, with what is left out and why | 

### Quality and models

| 
# | 
Surface | 
Edition | 
Lives in | 
Built from | 

| 
A14.1 | 
The approved list of AI models | 
Enterprise | 
Trust, Models | 
TR-08, with who approved each | 

| 
A14.2 | 
Evidence that models and mappings work | 
Enterprise | 
Company, Quality | 
Tables of right, wrong and refused per group. Never one pooled score | 

| 
A14.3 | 
Agreed answers used for testing | 
Enterprise | 
Company, Quality | 
A table; two columns for a disagreement | 

| 
A14.4 | 
How good matching is, and when to accept on its own | 
Enterprise | 
Books, Records | 
A bar with the chosen line marked, as in BK-08 | 

| 
A14.5 | 
How well search and each language work | 
Both | 
Company, Quality; the language list | 
TL-10. "Hindi: not yet reviewed. Tamil: not yet tested." | 

| 
A14.6 | 
Is a forecast still good enough to use | 
Enterprise | 
Tools, Planning | 
A label on the set-up | 

| 
A14.7 | 
Is Chausar useful | 
Both | 
Reports | 
Outcomes that were checked. No guessed "hours saved" | 

### Administration

| 
# | 
Surface | 
Edition | 
Lives in | 
Built from | 

| 
A15.1 | 
The administrator's area | 
Both | 
Trust and Company | 
TR-01 to TR-15 on the desktop | 

| 
A15.2 | 
Company sign-in and the directory | 
Enterprise | 
Company, Sign-in | 
Rows that open; a table of people and where each came from | 

| 
A15.3 | 
Who is escalated to, and who may promise what | 
Enterprise | 
Trust, Access | 
Rows that open | 

| 
A15.4 | 
Letting Chausar's support look inside | 
Enterprise | 
Company, Support access | 
An approval with an end time, and the record of what was looked at | 

| 
A15.5 | 
Keys | 
Enterprise | 
Company, Keys | 
Rows: who holds each key, when it was last changed | 

| 
A15.6 | 
Which addresses may be reached | 
Both | 
Trust, Network | 
TR-09; a visible line when one is blocked | 

| 
A15.7 | 
Backups that can really bring the business back | 
Both | 
Trust, Vault; in a company, Company, Recovery | 
TR-12, WK-15 | 

| 
A15.8 | 
Fixing stored data that has the wrong meaning | 
Enterprise | 
Company, Recovery; the items in Work | 
Results per item | 

| 
A15.9 | 
What still works when something fails | 
Both | 
A label on each screen; Company, Health | 
Out of service; on the desktop, SH-09 and SH-13 | 

| 
A15.10 | 
Does each journey work on this install | 
Both | 
Books, Sources; Company, Health | 
A checklist per journey, as on TD-03 | 

| 
A15.11 | 
The licence or plan and what it allows | 
Both | 
Trust, Vault; Company, Licence | 
TR-14 | 

| 
A15.12 | 
The pool of AI workers | 
Enterprise | 
Work, Agents; Company, Computers | 
A table | 

| 
A15.13 to A15.25 | 
Releasing to and watching every customer install | 
Chausar only | 
Chausar's own console | 
See section 8 | 

### Research

| 
# | 
Surface | 
Edition | 
Lives in | 
Built from | 

| 
A16.1 to A16.4 | 
Chausar's research on source systems | 
Chausar only | 
Chausar's own research console | 
See section 8 | 

## 6. The rules that hold on every enterprise screen

These come from the 18 groups of rules in the inventory. Most already hold on the desktop.

| 
Rule | 
How the design keeps it | 

| 
Work is not trapped in a chat | 
An answer, an investigation, a what-if and a decision are saved things with their own pages. The ask line starts them; it does not hold them | 

| 
What you were looking at survives moving around | 
The company, the lens, the period and the "as known on" date travel with you from page to page, and show on the line that says where you are. Every page has an address that can be shared inside the company | 

| 
Colour is never the only sign | 
Squares come with words. Known facts, assumptions and open questions differ by label and position | 

| 
Decoration must not suggest certainty | 
No scores, no gauges, no single readiness percentage. A chart of thin evidence says how thin | 

| 
Lists and tables come before graphs of relations | 
Records are browsed as rows. A drawing of links appears only for one path at a time | 

| 
Old screens say they are old | 
Live state on the status line. After a reconnect the page checks access again before showing anything | 

| 
The same rules on every channel | 
A phone or a message can never approve what the app would not let that person approve | 

| 
Empty, stale and partial are designed states | 
Each says what can still be done and what would bring the rest | 

| 
Approvals show the real change | 
The sheet is built from the prepared request. An agent's message never counts as a person's approval | 

| 
Routine work is not buried in confirmations | 
What the rules already allow runs without asking. There is no single "autonomous mode" switch; each kind of action has its own | 

| 
Only meaningful changes interrupt | 
A new row on Today needs a real change. The end of an agent's step is not one | 

| 
Hidden means hidden everywhere | 
Lists, counts, search, totals and drawings of links all agree | 

| 
Claims stay honest | 
Supported is said per system and per operation. A part that is not proven is called partial | 

| 
Assistive technology is tested on real work | 
Besides the first journey, the keyboard-only and screen reader runs cover a why page, a correction, and an approval | 

## 7. The customer window

In the enterprise version a company's own customers may talk to a service agent by chat, portal, mail, messaging or phone. That surface is not part of the app, and no document sets its look. This design gives it rules and leaves the drawing for later.

- The surface belongs to the company, not to Chausar, and carries the company's name. Its parts are the same plain ones: rows, a line to type in, small squares for whose turn it is.

- Who the customer is talking to is always clear: an AI service agent, or a named person.

- Whether the customer's identity was checked is shown, with how.

- Promises appear as rows, each with what was promised and by when.

- A hand-over to a person has two states that are never confused: offered, and accepted by a named person.

- Another customer's data, an internal note and a figure with no receipt never appear.

The staff side lives in Work, Cases, and the rules for what may be sent, and as whom, live in Trust, Channels.

## 8. Chausar's own consoles

Seventeen surfaces in the inventory are for Chausar's staff, not for customers: releasing to every customer install, watching health, running an incident, moving an install, and keeping the research on each source system. They belong in a separate internal app built from the same parts. They are listed here so that nothing is lost.

| 
Console | 
Holds | 
Built from | 

| 
Operator: installs | 
Every customer install, its version, its state | 
A table with a strip per install | 

| 
Operator: releases | 
A signed release, where it has gone, what the evidence says | 
A time line down the page; a meter for how far it has rolled out | 

| 
Operator: health | 
Whether real journeys succeed, with honest gaps when watching fails | 
Tables and out-of-service labels | 

| 
Operator: incidents | 
Declaring one, its time line, its close with causes | 
A time line down the page | 

| 
Operator: upkeep | 
Settings in force, emergency overrides, database upkeep, capacity, moves, tests of resilience, certificates, clean-up | 
Tables and rows that open | 

| 
Research: register | 
Every source system and how far research has got | 
The coverage board as a table | 

| 
Research: samples | 
What each sample may be used for; new material held apart | 
A table with a label per sample | 

| 
Research: claims and experiments | 
Claims, corrections, experiments that can be repeated | 
A time line; the receipt | 

None of these shows customer content. The final plan says the fleet console "must not become a general cross-customer content store".

## 9. The CA console

The CA console and the client's own vault

A CA firm with 80 small clients cannot open 80 apps. The console puts a list of clients in front of the same app.

The rule the design rests on. Each client's books stay in that client's own vault. The console holds status about each client: dates, counts and states. It holds no figure, no name of a client's customer, and no document. To see figures, the CA opens the client and works inside that client's workspace, with the seat the client gave. This keeps the promise that nothing is read across workspaces, and it means the console can exist without a decision about hosting many businesses together.

The CA console

The rail of the console has six places: Today, Clients, Work, Reports, Tools, Trust. As in the app, only Today carries a count. There is no Ask and no Books at the firm's level, because there are no books at that level. Both appear the moment a client is opened.

| 
Code | 
Screen | 
What it shows | 

| 
CA-01 | 
Clients | 
A table: the client, when its books were last read, the month's close as a strip of four squares (bank, GST, TDS, trial balance; each done, in progress, not done or file refused), how many things await the firm, and what is due next. Three words filter it: Needs you, Close not done, All. Arrow keys move, Enter opens | 

| 
CA-02 | 
The firm's Today | 
What awaits the firm across all clients, grouped by client, as counts. Due dates across all clients from the published calendar | 

| 
CA-03 | 
Inside a client | 
The client's own workspace in the Books view, with a banner: "Demo shop, a client of Demo and Co. Back to clients." What the CA can do is set by the seat: a CA seat reads and exports until a date; an accountant seat also prepares, and never approves money | 

| 
CA-04 | 
Month-end hand-over | 
Per client, the schedules of the CA pack as a checklist: trial balance, bank reconciliation, the GST match, the TDS match, ageing. Each opens the report page. Export to Excel and to a file Tally can import | 

| 
CA-05 | 
To co-sign | 
Proposals from clients' workspaces that an accountant may co-sign: meanings, recipes, account classes. Each is opened inside its client | 

| 
CA-06 | 
The same step for many clients | 
One request applied to a chosen list of clients, for example "send the guide for the September GST file". A table with one row per client and its own result | 

| 
CA-07 | 
The firm's library | 
Recipes, ready-made jobs and checks the firm reuses across clients. Structure only: no client's data is in it | 

| 
CA-08 | 
The firm's people | 
Who in the firm may open which client. A client's owner gives the seat; the firm cannot add itself to a client | 

| 
CA-09 | 
Invite a client | 
The one-page guide to forward. A client that has not joined shows "invited, not joined" | 

| 
CA-10 | 
Questions sent by clients | 
The "ask a person" files that clients sent when Chausar said not yet, each opened inside its client | 

| 
CA-11 | 
The firm's name on reports | 
A setting. The plan's price for firms is per client file, and it is marked "planned" | 

What changes in the parts. One thing: the strip of small squares, used on the desktop for twelve months of a source, is used here for the four steps of the month's close.

What is not decided. No document describes a CA firm. The plan places the console after day 10. Whether a firm's status view runs on the firm's own computer or on a hosted service, and what a client must agree to for its status to be shown there, are the founder's decisions. The design works either way because only status crosses.

## 10. Open choices that shape these screens

| 
Choice | 
Where it stands | 

| 
Which screen is home | 
The founder's Today matches the documents that lead with a business workspace. A role-shaped Today is how this design answers the documents that want a home per role | 

| 
Chat first or work first | 
Work first, with the ask line everywhere. No document settles it | 

| 
Where strategy lives | 
Under Ask as Plans. The documents treat it as an area of its own | 

| 
The specialist on a one-owner install | 
The owner, with the accountant or CA as co-signer. The documents assume a separate specialist | 

| 
A level for accessibility | 
WCAG 2.2 AA is proposed. The final plan asks for a level to be chosen | 

| 
Languages | 
English and Hindi, then packs. No document fixes a list | 

| 
Speed targets | 
None is set in any document. The builders' file proposes limits for the desktop only | 

| 
How people edit together | 
States are designed here. No editor technology is chosen | 

| 
The customer window | 
Rules only | 

# Chausar app: for the builders

Part of the frontend design of 1 October 2026. This is the technical part. It is written for the fleet's Design, Forge, Brain, Ledger and Bench lanes, and for Con, who reviews.

Nothing here is built. Where this file names a library, it is a recommendation; where it names a message to the engine, it is the screens' side of the contract and the engine's owners agree the final shape.

## 1. The starting point

The founder asked for a clean start on the screens. The tools stay.

| 
Keep | 
Replace | 

| 
Electron, React, TypeScript, Vite, Vitest | 
The seven day 1 screens and their styles | 

| 
The engine in its own process, reached only by named messages | 
Any screen that reads the bridge from inside a small part | 

| 
bridge/contract.ts as one typed list, owned by Design and Forge together, reviewed by Con | 
System fonts only: the design's four fonts are bundled | 

| 
Checking every reply from the engine before showing it | 
| 

| 
Money as whole paise in a string | 
| 

| 
An error as a short code, shown as a fixed sentence | 
| 

| 
All screen text in English and Hindi from one text file each | 
| 

Rebuild the day 1 screens on the new frame first (section 13, step 0). Remove an old screen only after its rebuilt version passes the same journey test.

## 2. The tools

| 
Need | 
Choice | 
Why | 

| 
Screens | 
React 19 and TypeScript, strict | 
Already in use | 

| 
Build | 
Vite | 
Already in use | 

| 
Styles | 
Plain CSS with custom properties, as CSS Modules. No Tailwind, no CSS written in JavaScript, no component kit that brings its own look | 
The whole look is one small stylesheet today. A kit would fight it | 

| 
Behaviour of menus, dialogs, lists that take keys | 
One unstyled accessibility library. React Aria Components is recommended; Radix Primitives is the alternative. Pick one and do not mix | 
Focus, keys and screen reader behaviour are hard to get right by hand | 

| 
Charts | 
Our own small SVG parts, one per chart form. d3-scale and d3-shape for the maths only | 
Eleven quiet forms. A chart library would bring its own look and weight | 

| 
Reading from the engine | 
TanStack Query over the typed bridge client | 
Caching, and one place to refresh when an event arrives | 

| 
Moving between screens | 
A small hash router. Every screen and every open sheet has an address | 
The final plan asks that things have addresses. The same addresses become paths in the browser version | 

| 
Text | 
FormatJS (react-intl) with one file per language | 
Plurals and order of words differ between Hindi and English | 

| 
Checking replies | 
The existing validate.ts, grown per message. zod or valibot if hand-written checks become too many | 
The fleet already checks replies this way | 

| 
Tests | 
Vitest, Testing Library, Playwright for Electron, axe-core | 
Vitest and Testing Library are already in use. Playwright for Electron and axe-core are new, for pictures, journeys and accessibility | 

The window's content rules stay strict: default-src 'none'; scripts, styles and fonts from the app itself only; images from the app itself or data: only; no connections from the screen at all.

## 3. Layers and folders

The four layers of the screen code

app/ui/src/
tokens/ tokens.css, type.css, motion.css
parts/ Square, Row, RowList, Sheet, Receipt, Steps, DayLine, TimeLine, Table,
Stat, Banner, Button, Field, Choice, Label, KeyValue, Drawing, charts/
patterns/ ListWithSheet, AnswerPage, TwoSides, ApprovalSheet, SettingsRows, ReportPage,
FirstRunStep, States
screens/ shell/, firstrun/, today/, ask/, work/, books/, reports/, tools/, trust/
views/ simple.css, books.css
text/ en.json, hi.json
format/ money.ts, counts.ts, dates.ts, sentences.ts
bridge/ contract.ts, validate.ts, client.ts, fake.ts, fixtures/
app/ App.tsx, Frame.tsx, routes.ts
tests/ pictures/, journeys/, budgets/

Five rules keep the layers honest. A lint rule checks each.

- A screen is made of patterns and parts. It holds no styles of its own beyond layout.

- A part never calls the bridge. Only screens do, through bridge/client.ts.

- Nothing outside format/ turns a number or a date into text.

- Nothing outside text/ holds a word the person reads.

- A colour, a size or a time appears in code only as a token.

## 4. Tokens

system/app.css in this folder is the working stylesheet behind the 19 pictures. Its token names and values are the source. In the app they move to tokens/tokens.css unchanged.

| 
Group | 
Tokens | 

| 
Background and text | 
--bg, --fg, --fg2, --mute | 

| 
Lines | 
--line, --line2 | 

| 
Marks | 
--cha, --you, --other, --amber, --amber-t, --red | 

| 
Charts | 
--dim; the ordered greys --r1 to --r4; the three hues --s1, --s2, --s3 | 

| 
Faces | 
--f (reading), --fm (figures), --fw (wordmark) | 

| 
Sizes | 
Rail 216, column 720, wide column 1010, sheet 480, row 54, ask line 54, status line 34. Widths: as drawn from 1316, sheet over the list from 1024 to 1315, top bar under 1024 down to 360 | 

| 
Times | 
--t-press 120 ms, --t-sheet 200 ms, --t-step 240 ms, --t-chart 360 ms, --t-row 30 ms between receipt rows with --t-rows-max 400 ms. One easing, --ease: fast start, slow end. This is the same list as part 6 of the main file | 

| 
Focus | 
--focus: a 2 pixel outline in ink, 2 pixels off the element. Never removed | 

Themes: the tokens take their light values by default and their dark values under prefers-color-scheme: dark. There is no theme switch in the app. data-theme exists only to fix a theme for pictures. Under prefers-contrast: more, --line takes the value of --line2 and --line2 takes the value of --mute. Under prefers-reduced-motion: reduce, every time is 0. All three rules, and the focus outline, are written in system/app.css.

Views: data-view="simple" and data-view="books" on the root change sizes only, through views/simple.css and views/books.css. No part reads the view in code except to choose a table over rows.

Fonts: Instrument Sans (400, 500, 600), DM Mono (400, 500), IBM Plex Mono (500), Noto Sans Devanagari (400, 500), as local woff2 files, cut down to Latin, Devanagari, the rupee sign and the few arrows in use. All four are under the Open Font License, which the licence check must accept. Each face lists a fallback per script: --f is Instrument Sans, then Noto Sans Devanagari, then the system sans; --fm is DM Mono for digits and Latin only, then Noto Sans Devanagari, so Devanagari text in a figure place never falls to a system face, then Cascadia Mono or Consolas.

## 5. The parts

| 
Part | 
Draws | 
Takes | 

| 
Square | 
One of the nine marks | 
state: cha, you, other, wait, busy, now-you, now-cha, unsure, guess, off. Always hidden from screen readers; the row carries the words | 

| 
Row | 
Square, what, note, figure, arrow | 
The four slots; open (in place) or selected (sheet open); an address to open. One line in Guided and Books, up to two in Simple and on the phone | 

| 
RowList | 
Rows between hairlines, with keys for moving | 
Rows; "See all" when cut | 

| 
Table | 
The Books view's rows | 
Columns with a kind (text, as written, money, count, date, state, action); sorting; only the rows on screen are drawn | 

| 
Sheet | 
The panel at the right | 
A title line, a body, actions; where focus returns on close | 

| 
Receipt | 
The six parts of a receipt | 
A Receipt from the engine, unchanged | 

| 
Steps | 
Dots on a line, with the step mark that moves along | 
The steps, the one reached, and whose turn it is (ink for the person, green for Chausar). Used with five (an action) and six (first run) | 

| 
DayLine | 
Up to six marks across the page | 
Events of one day | 

| 
TimeLine | 
Steps down the page with cost at the right | 
Events, newest first or oldest first | 

| 
Stat | 
A label, a figure, what changed, a small chart | 
A figure with its receipt id, and a chart | 

| 
charts/* | 
Columns, Line, OrderedBar, RankedBars, Bridge, GoalLine, StepLine, PairBars, Strip, Spark, RuleBar | 
Values as paise strings or counts, each with a receipt id; a sentence for screen readers | 

| 
Banner | 
A strip above the page | 
A kind, a sentence, at most one action | 

| 
Button | 
Filled, quiet, or a link | 
One word or two; danger for red text | 

| 
Field, Choice | 
An underlined field; No and Yes; a row of words | 
A label that is always visible | 

| 
Label | 
Small capitals in the number face | 
The fixed words of part 7 of the main file | 

| 
KeyValue | 
Two columns of name and value | 
Pairs | 

| 
Drawing | 
The drawn explanations | 
A small typed description: nodes, links, labels. Not free SVG from the engine | 

Charts take values, never pixels. A chart part works out its own scale, draws itself in from the baseline once, and gives each mark a label for the keyboard and an action that opens its receipt. In a Stat, the whole tile is the click target; inside the chart the arrow keys move from mark to mark.

## 6. The patterns

| 
Pattern | 
Made of | 
Used by | 

| 
ListWithSheet | 
RowList or Table, and a Sheet | 
Approvals, Jobs, Sources, Meanings, People, Plugins, most lists | 

| 
AnswerPage | 
The question, the line of what was understood, a big figure, a chart, the check line, a Receipt in the sheet | 
Answers, what-ifs, forecasts | 

| 
TwoSides | 
Two columns that are never merged | 
Why did it change; History; a meaning tried on a copy | 

| 
ApprovalSheet | 
KeyValue, the reason it waits, the exact change, Steps, one note, two buttons, Change and Drop | 
Every approval, in its variants, including practice (day 6) and the voucher preview | 

| 
SettingsRows | 
Rows that open in place to show choices | 
Trust, Rules; rhythm; a source's settings | 

| 
ReportPage | 
A page that prints, where every number opens a receipt | 
Packs, the week ahead | 

| 
FirstRunStep | 
The top bar, six Steps, one task, and the blocked line from onboarding.blocked on every step | 
First run | 

| 
States | 
The fixed states of part 10 of the main file, with their words | 
Every screen | 

## 7. Text

- One file per language: text/en.json and text/hi.json. Keys are named by screen code and role: WK-02.note.expires.

- Messages use the ICU form for counts and choices. No sentence is built by joining pieces.

- A key missing from hi.json fails the build.

- A test fails on any em dash, on the words in the banned list (text/banned.txt), on an exclamation mark, and on a button label longer than 22 characters.

- Sentences for the activity list and the job time line are built in format/sentences.ts from typed events, one function per event type, in both languages. The engine sends no prose.

- Text from the books (party names, narration, file headers) is shown as written and is never translated, cut for meaning or used as a key.

- Hinglish and later languages arrive as language packs. A pack adds a text file and a test set; it changes no code.

- The Hindi in the pictures was written by Fable and must be read by a native reader before release.

## 8. Numbers, money and dates

The screen never calculates a business number. It formats what the engine sends.

| 
Function | 
Takes | 
Gives | 
Example | 

| 
money(paise) | 
Whole paise as a string | 
Rupee sign, Indian grouping, paise only if there are some | 
"31000000" gives ₹3,10,000 | 

| 
moneyShort(paise, lang, form) | 
The same, and tile or spelled | 
Lakh or crore with at most two decimals, trailing zeros trimmed. tile (Guided and Books stat tiles) gives "L" and "Cr"; spelled (Simple) gives the words. The two forms never mix on one screen. The full figure is set as the title and read to screen readers | 
₹3.1 L; ₹6.08 Cr; ₹3.1 lakh; ₹3.1 लाख | 

| 
moneyDrCr(paise, side) | 
Whole paise and debit or credit | 
The amount with "Dr" or "Cr" after it, for tables in the Books view and accounting reports | 
₹48,500 Dr | 

| 
moneySpoken(paise, lang) | 
The same | 
Words for a screen reader | 
"3 lakh 10 thousand rupees" | 

| 
count(n) | 
A whole number as a string | 
Indian grouping | 
1,24,500 | 

| 
percent(hundredths) | 
Hundredths of a percent as a whole number | 
At most one decimal | 
3140 gives 31.4% | 

| 
points(hundredths) | 
The same, for a change | 
The word "points" | 
down 0.8 points | 

| 
date(iso, form) | 
A date | 
Day first, month as a word | 
30 Sep 2026; Wednesday, 30 September | 

| 
time(iso) | 
A time | 
24 hours, in the workspace's time zone | 
06:05 | 

| 
age(iso) | 
When data was read | 
"as of" or "read at" | 
as of 28 Sep | 

| 
year(iso) | 
A date | 
The April to March year | 
FY 2026-27 | 

Rules:

- Money is { currency: "INR", paise: string } as in the day 1 contract. It is handled with BigInt, never with a JavaScript number.

- The short form rounds half up, at the last step, for display only, and only in stat tiles and the Simple view. Sheets and approvals are always exact, in every view. A rounded figure always has its exact value one click away in the receipt.

- A comparison always carries its basis from the engine ("vs August, same days"). The screen never chooses the basis.

- Another currency is shown as written in the source. Its rupee value appears only if the engine sent one with the rate, the rate's source and its date.

- A missing value arrives as one of the seven Missing states: the five the dictionary defines (absent, null, unknown, withheld, not applicable) and two from coverage (not loaded yet, not counted). Each has its fixed words from part 7 of the main file. None is ever shown as 0 or as an empty cell.

- The India test set of at least 60 cases that the engine uses for reading numbers is reused, turned around, as the test for showing them.

## 9. The bridge

The screen and the engine

The rules of the day 1 contract stay, and five are added.

- The screen reaches the engine only through window.chausarEngine, whose shape is bridge/contract.ts. The file is shared by Design and Forge; a change needs both and Con's review.

- Messages are grouped by name. A read is a noun (sources.list). A change is a verb (approvals.approve).

- Every reply is checked against the contract before it is shown. A reply that fails the check shows the Failed state, never part of the data.

- A failed call carries a short code. The screen shows the fixed sentence for that code from the text file.

- capabilities() says for each group whether it is live, partial or missing, so a screen can say "not built yet".

- New: events. events.subscribe(topics, handler) gives typed events that carry ids and no content. On an event the screen reads again. It never builds its state from events alone.

- New: every figure carries its receipt. Any value a person can see as a number arrives with a receiptId.

- New: every list is cut by the engine. A list message takes a page and a size and returns the total count. The screen never loads ten thousand rows to show twenty.

- New: changes say what they changed. A change returns the new state of the thing, so the row can update in place.

- New: the engine says what the screen may offer. A thing that can be acted on arrives with the actions this person may take on it (can: ["approve", "notNow"]). The screen hides a button the engine did not offer; the engine still refuses if asked anyway.

The same contract serves the browser version: there the client sends each message over HTTPS and takes events from one stream. Screens do not change.

### Shapes that many screens share

type Mark = "cha" | "you" | "other" | "wait" | "busy" | "now-you" | "now-cha" | "unsure" | "guess" | "off";

type ActivityState = // the five states of the activity list
| "done" | "waiting-for-you" | "waiting-for-network"
| "unsure" | "stopped-by-rule"; // a stop by the budget is stopped-by-rule with reason "budget"

type StepState = // a step of an action or a job
| "not-reached" | "in-progress" | "done" | "failed" | "unsure";

interface Figure { money?: Money; count?: string; percent?: number; receiptId: string; label?: FigureLabel }
type FigureLabel = "seed" | "what-if" | "projection" | "estimate" | "from-outside" | "approximate" | "demo-clock" | "stale";
type LabelGrade = "model" | "owner" | "accountant" | "ca" | "reconciled";

type Missing = "absent" | "null" | "unknown" | "withheld" | "not-applicable" | "not-loaded-yet" | "not-counted";

interface Receipt { // grows from the day 1 Receipt
receiptId: string;
operation: { id: string; name: string; menu: "seed" | "dictionary" };
period: { from: string; to: string; label: string };
asKnownOn: string; // day 3: the second clock
coverage: { rowsUsed: string; leftOut: { reason: string; rows: string }[] };
values: { label: string; figure: Figure }[];
source: { name: string; kind: "file" | "live"; wayIn: "interface" | "exported-file" | "computer-export"; readAt: string }[];
recipe: { recipeId: string; state: "seed" | "tested" | "not-yet-tested" | "failed"; acceptedBy: string; grade: LabelGrade };
meaning?: { publishedBy: string; reviewedBy?: string; cosignedBy?: string }; // day 6 for review and co-sign
rate?: { value: string; date: string; source: string };
forecast?: { method: string; trainedOn: string; heldOut: string }; // day 5
versions: string[]; // day 4: five version numbers
numberGuard: { passed: boolean; hits: { text: string; matchedLabel: string | null }[] };
allowedBy: { ruleId: string; step: 1 | 2 | 3 | 4 | 5; text: string; person?: string; device?: string; at?: string }; // short line day 1, full decision day 6
route?: { kind: RouteKind; sendLevel: SendLevel; costPaise: string | null; bodyVisible: boolean };
labels: FigureLabel[];
chainHead?: string; // day 6
}

interface Approval {
approvalId: string;
kind: "message" | "record-change" | "money" | "prepare-only" | "voucher-preview" | "job" | "group";
practice: boolean; // day 6: sends nothing, changes nothing
what: string; // a text key, not prose
target: { label: string; ref?: RecordRef };
waitsBecause: { ruleId: string; text: string }; // the rule that made it wait
change:
| { asWritten: string } // the text exactly as it will go
| { fields: { name: string; before: string; after: string }[] };
steps: { name: "prepared" | "approved" | "done" | "read-back" | "recorded"; state: StepState; turn: "person" | "chausar"; at?: string }[];
tier: 1 | 2 | "prepare-only"; // shown in this order: 2, then 1, then prepare-only
cancels: string[]; // text keys: what would cancel this approval
expiresAt: string;
preparedBy: { kind: "chausar" | "job" | "person"; name: string };
needsSecondAsk: boolean;
can: ("approve" | "notNow" | "change" | "drop")[];
}

Money, RouteKind, SendLevel and Capability are as in the day 1 contract.

## 10. The messages

Each table lists the messages the screens need, what each gives or does, and the day it is first needed. The codes of the screens that use each message are in screens.md. Names that differ from the day 1 contract are noted under the tables.

### Shell, vault and updates

| 
Message | 
Gives or does | 
Day | 

| 
capabilities | 
For each group: live, partial with a reason, or missing with a reason | 
1 | 

| 
events.subscribe | 
Typed events for the topics asked for | 
1 | 

| 
shell.setLanguage, shell.setView | 
Store the choice for this person on this device | 
1 | 

| 
shell.openExternal | 
Opens an address in the system browser, after the screen's own confirm | 
1 | 

| 
shell.print | 
Prints a document the engine names: the recovery kit, a report page | 
1 | 

| 
shell.startAtLogin | 
Read or set whether Chausar starts when the person signs in to the computer | 
7 | 

| 
review.list, review.count | 
Today's review list on day 1: proposals, questions and results, each one item, with the count of things this seat may act on now. Approvals join the same list and count on day 7 | 
1 | 

| 
vault.status | 
None, locked, or unlocked with the workspace's name | 
1 | 

| 
vault.create | 
Makes the vault; returns the recovery kit once | 
1 | 

| 
vault.unlock, vault.unlockWithDevice, vault.unlockWithKit, vault.lock | 
Open and close the vault | 
1 | 

| 
vault.lockSettings | 
Read or set the idle time, the PIN, the computer's own check | 
1 | 

| 
vault.diskCheck | 
Whether the disk is encrypted, in one of three plain results | 
1 | 

| 
vault.backups, vault.backupNow, vault.testRestore, vault.restore | 
The backups, a new one, the check of one, and going back to one | 
1 | 

| 
vault.inventory | 
Everything the app writes to disk: what, how it is locked, how long it is kept | 
1 | 

| 
vault.recoveryContact | 
Name a recovery contact; start or confirm a recovery through them | 
6 | 

| 
vault.export, vault.exports | 
Export everything; the list of exports with stores, counts and check numbers | 
3 | 

| 
workspaces.list, workspaces.current, workspaces.switch, workspaces.create | 
The workspaces this person has a seat in; demo or real | 
1, 6 | 

| 
updates.status, updates.check, updates.apply, updates.notes | 
Version, channel, expiry; the update itself | 
1 | 

| 
support.offlineList | 
What works with no internet and what waits | 
1 | 

| 
support.crashReport | 
The crash report as text, to send or not | 
1 | 

| 
support.faultReport, support.saveFaultReport | 
The fault report as text, and saving it as a file | 
10 | 

| 
support.askAPerson | 
One file with a question, its receipt and the reason | 
10 | 

| 
support.openQuestionFile | 
Open an "ask a person" file inside the client's workspace, for an accountant or CA seat | 
10 | 

### Models and voice

| 
Message | 
Gives or does | 
Day | 

| 
models.routes | 
Each route with the result of its check at start | 
1 | 

| 
models.connect, models.probe | 
Start a route's own sign-in; check a route again | 
1 | 

| 
models.setLadder | 
The order the person wants routes tried in | 
1 | 

| 
models.saveKey | 
Take an API key, and for an OpenAI-compatible service its endpoint, once; returns only whether it was accepted | 
1 | 

| 
models.localList | 
The local models installed on this computer | 
1 | 

| 
models.cards | 
For each route: what the provider keeps, how long, whether it trains on it, the country, the link, the date read | 
1 | 

| 
models.current | 
The route and send level in use now, for the status line | 
1 | 

| 
models.spend, models.setCap | 
Cost of the last answer, spend this month, the monthly limit | 
1 | 

| 
models.comparison | 
The same test for every route: right, wrong, refused, needed a person, cost | 
8 | 

| 
voice.status, voice.providers | 
Whether voice is on, which provider, its cost per minute | 
1 | 

| 
voice.start, voice.stop | 
Begin and end listening; the words heard | 
1 | 

| 
voice.confirm | 
The amounts and dates heard, to show back before anything runs | 
1 | 

| 
voice.dropNote | 
Take a recorded voice note | 
1 | 

| 
voice.speak, voice.stopSpeaking | 
Speak an answer aloud, with its numbers read from the receipt; stop | 
1 | 

| 
voice.usage | 
Minutes of paid speech this month and their cost | 
1 | 

### Trust, people and sharing

| 
Message | 
Gives or does | 
Day | 

| 
trust.get, trust.set | 
The four settings | 
1 | 

| 
trust.sendLevels | 
For each of the three levels, a tiny sample of the person's own data as the model would receive it | 
1 | 

| 
trust.leftToday | 
How many requests left today, to whom, at what level and cost | 
1 | 

| 
trust.keep | 
How long each kind of data is kept; setting it | 
1, 6 | 

| 
trust.explain | 
Why one step was allowed or stopped: the rule and which of the five checks decided | 
1, 6 | 

| 
trust.autonomy, trust.setAutonomy | 
Each kind of action with its switch and daily limits | 
7, 8 | 

| 
trust.alwaysWaits | 
The list with no switches | 
7 | 

| 
trust.caps | 
The limits in force, such as reminders per day | 
7 | 

| 
trust.agreement | 
Per kind of action, how often the rule would have agreed with the person | 
8 | 

| 
trust.hosted | 
What each paid part can and cannot see; the plan's state | 
6, 10 | 

| 
markings.list, markings.set | 
Markings on documents, records and fields | 
6 | 

| 
network.ledger | 
Every call that left: where, why, size, allowed or stopped | 
1 | 

| 
network.online | 
Whether there is a connection | 
7 | 

| 
network.canary | 
Whether a planted test value was seen leaving, and which call carried it | 
8 | 

| 
seats.list, seats.get, seats.templates | 
People, what each seat allows, the seat kinds | 
6 | 

| 
seats.onThisComputer | 
The people with a seat on this computer, for the lock screen's name list | 
6 | 

| 
seats.invite, seats.inviteVerify, seats.remove | 
Invite with a code; compare the code; remove | 
6 | 

| 
devices.list, devices.join, devices.remove | 
The computers in this workspace | 
6 | 

| 
devices.pen, devices.handOver | 
Who holds the pen; handing it over | 
6 | 

| 
sync.status | 
When the shared folder was last written and read | 
6 | 

| 
sync.setup | 
Choose a shared folder or Google Drive; the access it asks for, in plain words; how long old copies are kept | 
6 | 

| 
record.list, record.verify, record.head | 
The record, its check, and its latest chain value | 
6 | 

| 
sharing.consent, sharing.consentRecord | 
The boxes; the agreements by person and purpose | 
1, 4 | 

| 
sharing.preview | 
The exact file that would be sent | 
1 | 

| 
sharing.batches, sharing.deleteBatch, sharing.withdraw | 
What was shared; deleting it from the server; stopping | 
4 | 

| 
sharing.log | 
The learning log on this computer: one row per event with its decision and label grade | 
1 | 

| 
sharing.intakeStatus | 
Whether Chausar's side is open to receive shared batches | 
4 | 

| 
sharing.cleanSample | 
Run the local cleaner on a sample file: the cleaned copy and each scan hit by line. Nothing is uploaded | 
4 | 

| 
deletion.request, deletion.report | 
Delete something; the report per store | 
6 | 

| 
deletion.reapply | 
After a restore, delete again what had been deleted after the backup; say what could not be | 
7 | 

### Getting data in

| 
Message | 
Gives or does | 
Day | 

| 
imports.pickFile, imports.preview, imports.commit | 
Pick a file in the shell; its first rows and the recipe proposed; take it in | 
1 | 

| 
imports.providePassword | 
A PDF's password, used once | 
3 | 

| 
imports.result | 
Rows taken, flagged and refused, with reasons; for a statement, lines read, opening and closing balance and the check result; where a refused file is kept | 
1 | 

| 
imports.readerStatus, imports.installReader | 
Whether the PDF reader is installed; fetch and check it, with its size and progress | 
3 | 

| 
imports.readBill, imports.confirmBill | 
A bill photo as a typed form with where each field was read; the confirmed form | 
4 | 

| 
sources.list, sources.get | 
Each source: the way in, the sign-in path, last read, what to look at | 
4 | 

| 
sources.coverage | 
Per source and month: loaded, loading, not loaded yet, refused | 
4 | 

| 
sources.envelopes | 
The history of reads of one source | 
4 | 

| 
sources.freshness | 
The time of the newest read, for the status line | 
1 | 

| 
sources.options, sources.add | 
The systems Chausar can read and how well; start connecting one | 
4 | 

| 
sources.signIn, sources.readNow, sources.remove | 
Sign in through the system browser; read now; remove | 
4 | 

| 
sources.unmappedFields | 
Fields no recipe covers, with type and how often filled | 
4 | 

| 
recipes.get, recipes.proposals | 
A recipe and its bindings; proposals with their evidence | 
2 | 

| 
recipes.decide | 
Accept, reject or correct one proposal | 
2 | 

| 
recipes.questions, recipes.answer | 
A question with its reason and choices; the answer | 
4 | 

| 
recipes.reconcile | 
Chausar's total beside the system's own, per slice | 
4 | 

| 
recipes.upgradeDiff | 
What a newer recipe would change | 
4 | 

| 
accounts.proposals, accounts.decide, accounts.classes | 
Account sorting: proposals, the decision, the list of classes | 
2 | 

| 
packs.list, packs.choose | 
Starter packs and their state | 
2 | 

| 
dictionary.words, dictionary.get, dictionary.history | 
The words; one meaning in plain words and as data; its versions | 
2 | 

| 
dictionary.proposals, dictionary.decide | 
Meanings proposed in setup; the decision | 
2 | 

| 
dictionary.draft, dictionary.diff, dictionary.check, dictionary.review | 
A draft; what changes in plain words and what it affects; the checks; the second model's opinion | 
2 | 

| 
dictionary.publish, dictionary.cosign | 
Release; co-sign | 
2, 6 | 

| 
dictionary.gstMode, dictionary.rates | 
The GST mode; the exchange rate table | 
2 | 

| 
onboarding.saveIdentity, onboarding.blocked | 
The identity card, written at step 2 once the vault exists; what is blocked and what would unblock it | 
1, 2 | 

| 
gst.match2b, gst.imsList, gst.setTolerance | 
Purchases against GSTR-2B in four groups; the IMS list for a person to act on in the portal; the tolerance | 
4 | 

| 
onboarding.describeIdea, onboarding.draft, onboarding.correctClaim, onboarding.setupChecklist | 
The idea journey | 
1 | 

### Records and history

| 
Message | 
Gives or does | 
Day | 

| 
records.search, records.get, records.timeline | 
Find a record; its details with the source of each; its time line | 
3 | 

| 
records.optIn | 
Whether a customer agreed to reminders, per channel: yes, no or not asked, with source and date, and the stopped flag | 
7 | 

| 
records.setOptIn | 
Record a customer's agreement on a channel, with where it came from | 
7 | 

| 
records.holdings | 
Every store that holds something about one customer | 
6 | 

| 
identity.suggestions, identity.decide, identity.undo, identity.rules | 
Possible matches with evidence; the decision; undo; which kinds join on their own | 
3 | 

| 
conflicts.list, conflicts.get, conflicts.rules | 
Where sources disagree; both claims; which source wins for which kind of fact | 
3 | 

| 
history.asKnownOn | 
One calculation as known on a chosen date | 
3 | 

| 
history.versions | 
Every version of one record | 
3 | 

| 
history.stale, history.rebuild | 
Saved answers a change made stale; rebuild one | 
3 | 

| 
history.clock | 
Whether the demo clock is in use, and its date | 
3 | 

| 
history.setClock, history.advanceClock | 
Set the demo clock's start date once; move it forward a day or a week, never back. Refused in a real workspace | 
3 | 

| 
trial.start, trial.compare, trial.publish, trial.discard | 
Try a change on a copy | 
3 | 

| 
memory.list, memory.edit, memory.delete | 
What Chausar believes, with its kind, status, source and both dates | 
1, 8 | 

| 
memory.add, memory.propose | 
Add a line by hand; turn a statement typed in the ask line into a line to confirm | 
1 | 

| 
memory.lessons, memory.decideLesson | 
Proposed lessons; the decision | 
8 | 

### Asking

| 
Message | 
Gives or does | 
Day | 

| 
ask.menu | 
The calculations this person may run | 
1 | 

| 
ask.suggest | 
Up to five suggestions for what is typed | 
1 | 

| 
ask.question | 
One of: what was understood, one question back, no match, refused, not applicable | 
1, 5 | 

| 
ask.stop | 
Stop a question that is running; a queued question then starts | 
1 | 

| 
ask.guardList | 
The number guard's list for one answer: each number found and the receipt line it matched | 
1 | 

| 
ask.change | 
Change the calculation, period or group of what was understood | 
5 | 

| 
ask.run, ask.answer | 
Run what was understood; the answer with its receipt | 
1 | 

| 
ask.receipt, ask.sourceRows | 
A receipt; the rows behind it, a page at a time | 
1 | 

| 
ask.sent | 
What was sent to the model for one receipt | 
1 | 

| 
ask.save, ask.saved | 
Save an answer; the saved ones | 
2 | 

| 
ask.wanted | 
Questions no calculation covers | 
1 | 

| 
investigations.start, investigations.get, investigations.resume, investigations.search | 
A why-question: its plan, the measured parts, the guesses with evidence | 
5 | 

| 
scenarios.create, scenarios.compare, scenarios.optimise | 
A what-if; your books beside it; a plan under limits | 
5 | 

| 
forecasts.run | 
A forecast, the simple guess, and the error of each on months held back | 
5 | 

| 
decisions.capture, decisions.confirm | 
One sentence to a draft; confirm with a review date | 
5 | 

| 
decisions.inbox, decisions.list, decisions.get, decisions.review | 
The inbox; the journal; one decision; what happened | 
5 | 

| 
checks.saveAsCheck, checks.list, checks.run, checks.results | 
Your own checks | 
5 | 

### Briefs, reports and the activity list

| 
Message | 
Gives or does | 
Day | 

| 
activity.list, activity.day | 
Typed events, newest first; the day's events for the day line | 
1 | 

| 
briefs.tiles | 
The three figures on Today with their series | 
5 | 

| 
briefs.daily | 
At most five things worth a look today | 
5 | 

| 
briefs.weekAhead, briefs.friday | 
The weekly brief and the review, as typed sections | 
5 | 

| 
briefs.rhythm, briefs.delivery | 
When briefs are made; where they are sent | 
5 | 

| 
briefs.saveClosing | 
The day's cash, as something the owner said | 
5 | 

| 
calendar.due, calendar.rows | 
Dates due in a range; every row with its source and date checked | 
5 | 

| 
reports.packs, reports.pages, reports.page | 
The packs; the state of each page; one page as a typed document | 
5 | 

| 
reports.export | 
A page, a pack or a receipt as a file | 
5 | 

| 
reports.closeStatus | 
The month's close: each step and its state | 
5 | 

### Acting

| 
Message | 
Gives or does | 
Day | 

| 
actions.catalogue, actions.wanted | 
The written list of actions; what was asked for outside it | 
7 | 

| 
actions.catalogueEntry | 
All eleven fields of one entry, including how it avoids doing it twice, how it reads back, and its expiry | 
7 | 

| 
actions.ledger, actions.get | 
The record of actions; one with its five steps and its read-back | 
7 | 

| 
actions.resolveUnknown | 
Settle an action whose result is not known | 
7 | 

| 
actions.reverse | 
Prepare the reversal of an action | 
7 | 

| 
actions.afterRestore | 
Actions that may have gone out after a backup was made | 
7 | 

| 
approvals.list, approvals.count, approvals.get | 
What awaits review; the count; one approval | 
7 | 

| 
approvals.approve, approvals.notNow, approvals.change, approvals.drop | 
The four answers | 
7 | 

| 
approvals.group, approvals.approveGroup | 
A grouped approval and its answer, item by item | 
7 | 

| 
approvals.pace | 
Whether recent approvals were faster than they could be read | 
7 | 

| 
approvals.practice | 
A practice approval: the same sheet, labelled practice; Approve sends nothing and changes nothing | 
6 | 

| 
jobs.list, jobs.get, jobs.timeline, jobs.card | 
Jobs; one job; its steps with cost; its card | 
7, 8 | 

| 
jobs.propose, jobs.templates | 
A job from a sentence or a ready-made one | 
7, 8 | 

| 
jobs.pause, jobs.resume, jobs.stop, jobs.answer | 
Steering | 
7, 8 | 

| 
jobs.edit, jobs.delete | 
Change a job (the change becomes a new approval); delete it | 
7 | 

| 
jobs.setWake | 
Read or set whether this computer may be woken for a job (off, experimental) | 
7 | 

| 
jobs.result, jobs.accept, jobs.reject | 
The result; accept it or send it back | 
8 | 

| 
jobs.schedules, jobs.setMissedRule | 
When a job runs; what happens to a missed run | 
7 | 

| 
jobs.background, jobs.setBackground | 
Whether jobs keep running with the window closed | 
7 | 

| 
budget.get | 
A job's budget, spent and left, in rupees | 
8 | 

| 
session.windows, session.start, session.status, session.stop | 
Chausar driving one window | 
4 | 

| 
session.resume | 
Continue a session that paused because the person moved the mouse or typed | 
4 | 

### Tools

| 
Message | 
Gives or does | 
Day | 

| 
plugins.list, plugins.inspect | 
Plugins; one before install: maker, level, signature, what it asks for | 
9 | 

| 
plugins.install, plugins.remove | 
Install with the chosen permissions; remove | 
9 | 

| 
plugins.wrapped, plugins.reapprove | 
A tool from outside with both descriptions; approve it again after a change | 
9 | 

| 
apps.list, apps.make, apps.create | 
Small apps; one line to a plan of what it would use; make it | 
9 | 

| 
apps.get, apps.view, apps.act, apps.rebuild | 
An app as a typed description the screen draws with its own parts; an action inside it; rebuild a stale one | 
9 | 

| 
numbers.status, numbers.pair, numbers.revoke, numbers.calls | 
The server for other assistants | 
9 | 

| 
phone.channels, phone.preview, phone.optIn, phone.usage | 
Channels; the exact message; the agreement; count and cost | 
5, 9 | 

| 
phone.verify | 
Verify the owner's own mail address or phone number with a code | 
5 | 

Names that move from the day 1 contract: trust.networkLedger becomes network.ledger; trust.learningEvents becomes sharing.log; trust.sharingPreview becomes sharing.preview. Everything else in the day 1 contract keeps its name.

### Events

An event is { topic, kind, ids, at }. It carries no content.

| 
Topic | 
Tells the screen to read again | 

| 
approvals | 
The count, the list, an open approval | 

| 
activity | 
The day line and the activity list | 

| 
jobs | 
A job's state or time line | 

| 
sources | 
A source's coverage or freshness | 

| 
actions | 
An action's step | 

| 
stale | 
Saved answers | 

| 
sync | 
Who holds the pen | 

| 
vault | 
Locked or unlocked | 

| 
models | 
A route's health | 

| 
updates | 
An update is ready | 

| 
session | 
Chausar started or stopped driving | 

| 
clock | 
The demo clock moved | 

### Small apps and plugin screens

A small app arrives as a typed description: screens made of tables, charts, forms, buttons and filters, each bound to a calculation or an action by name. It is drawn inside the locked, sandboxed frame on a separate origin, as the day 9 prompt sets out, from that description and with Chausar's tokens. No code from the app runs in the main window.

A plugin that brings its own screen is drawn the same way: in the locked frame on a separate origin, with a strict content policy, talking only through the message broker. The frame gets the tokens as plain values, so it matches the look without reaching the app.

## 11. Tests that check the design

| 
Test | 
What it checks | 
Fails when | 

| 
Format | 
The India number set, turned around; dates; the year; every missing state | 
Any case differs from its expected text | 

| 
Sentences | 
Every event type has a sentence in English and in Hindi | 
A type has no sentence | 

| 
Contract | 
Every fixture passes the reply check; a broken reply shows Failed | 
A reply is shown without its check | 

| 
Parts | 
Each part in both themes and three views; axe finds nothing | 
A part depends on a theme, or axe reports a fault | 

| 
Pictures | 
Every screen in both themes, in each of its views, at 1366 by 768 and 1024 by 768 | 
A picture differs from the stored one | 

| 
Words | 
Every word in the main area of each screen at rest, including figures, labels, the open sheet and the status line | 
Guided over 120, a wide page over 150, Simple over 90, Books over 170, a sheet over 110 | 

| 
Receipts | 
Every element marked as a figure has a receipt and opens it | 
A figure has none | 

| 
Never | 
No remote image; every link goes through shell.openExternal; a missing month shows its words; a message for the phone holds no digit at all and no name from the books | 
Any one fails | 

| 
Text | 
Every key exists in Hindi; no em dash; no banned word; button labels fit | 
Any one fails | 

| 
Motion | 
No animation that repeats; with reduced motion, no transition | 
Any one fails | 

| 
Keys | 
The first journey, install to first receipt, with the keyboard only | 
A step cannot be reached | 

| 
Screen reader | 
The same journey, read by a person with a screen reader, on day 10 | 
A step cannot be understood. It goes on the partial list | 

| 
Old computer | 
The limits in section 12, on the 4 GB test laptop | 
A limit is passed | 

The word limits come from the pictures the founder has seen, counted the same way. The aim behind the number is 35 to 45 reading words at rest: the sentences and labels a person reads to understand the screen (main file, part 2). The test counts every word on the page, including figures, labels, the open sheet, the status line and the words inside charts. That is why its limits are higher than 45.

The pictures in this folder are the reference for the 19 key screens. render.py draws them from the sources in screens/.

## 12. Limits on speed and size

No review sets a number. These are proposals for the founder to confirm or change after the bench measures the test laptop (Windows 10, 4 GB of memory, with Tally open).

| 
What | 
Limit | 

| 
The frame after unlock | 
Under 1 second | 

| 
Going to a place | 
What was known last time shows in under 100 ms | 

| 
Opening a sheet | 
Under 100 ms | 

| 
A list of 10,000 rows | 
Scrolls without a stall. Only the rows on screen are drawn | 

| 
The screen's own code and styles | 
Under 400 KB, compressed | 

| 
The four fonts | 
Under 600 KB together | 

| 
Memory used by the window with Today open | 
Under 150 MB | 

## 13. The build order

Step 0 comes first. After it, each day's screens follow the ten days of the plan. A screen whose engine part is not ready is built against the fake engine in bridge/fake.ts and shows "not built yet" in the real app until the part arrives.

| 
Step | 
Parts and patterns | 
Screens | 
Proof | 

| 
0. The frame and the parts | 
Tokens (with the motion times, reduced motion, more contrast and the focus outline), fonts, Frame, Square, Row, RowList, Sheet, ListWithSheet, Button, Field, Choice, Label, KeyValue, Banner, DayLine, TimeLine, Stat, three chart forms (Columns, Line, OrderedBar), text files, the format module, the bridge client, the fake engine, the picture test, the word test | 
SH-01, SH-13 | 
Today (TD-01) from the fake engine matches picture S01 in both themes | 

| 
Day 1 | 
Receipt, Steps (six), FirstRunStep, AnswerPage, States, RankedBars, Table, SettingsRows, Drawing | 
SH-01 (review.list and review.count), SH-02 to SH-06, SH-08 to SH-12; FR-01 to FR-05, FR-07, FR-09, FR-11 to FR-13; TD-01, TD-02, TD-03 (rows only), TD-04 (with route and cost); AS-01, AS-02 (simpler form), AS-04 to AS-09, AS-17; BK-04, BK-17; TR-01 to TR-05, TR-08, TR-09, TR-11 (off, with the preview), TR-12 | 
Install to a first receipt with the keyboard only. The same in Hindi | 

| 
Day 2 | 
RuleBar, PairBars | 
SH-04 (suggestions from the dictionary); FR-02 (GST mode), FR-06, FR-08, FR-09 (from the dictionary); AS-01 (the dictionary menu), AS-14; BK-05, BK-07, BK-08, BK-10, BK-11, BK-19 | 
An empty screen to a first answer through the setup guide, timed | 

| 
Day 3 | 
TwoSides, StepLine | 
SH-03 (the Demo clock banner and control), SH-08 (an old install updates itself); FR-07 (bank PDF, the PDF reader); AS-05 (two dates), AS-14 (stale marks); BK-09, BK-12 to BK-16; RP-07 | 
"As known on 10 April" beside "as known now", matching picture S08 | 

| 
Day 4 | 
Strip | 
SH-03 (the driving banner and the always-on-top strip); FR-07 (Tally, Zoho Books, GST files, scanned statements), FR-10; TD-03 (the close begins); AS-05 (versions, the way in), AS-19; BK-01, BK-02, BK-03, BK-05 (real systems), BK-06, BK-18; WK-13 (reading only), WK-14; TR-11 (live, the local cleaner), TR-15 (record) | 
A source half loaded shows "not loaded yet" and never a zero | 

| 
Day 5 | 
Bridge, GoalLine, Spark, ReportPage | 
SH-04 (the full menu); FR-12 (more kinds of business); TD-01 (charts and worth a look), TD-02 (cash), TD-03 (the close); AS-01 (the full set), AS-02, AS-03, AS-05 (forecast method), AS-10 to AS-13, AS-15, AS-16, AS-18; RP-01 to RP-06; TL-09 (briefs); PH-01 to PH-03 (the week ahead) | 
Why collections fell, matching picture S03, with every bar opening a receipt | 

| 
Day 6 | 
ApprovalSheet and Steps (five), for practice only | 
SH-02 (several people, the recovery contact), SH-03 (the Read only banner), SH-06 (workspaces); FR-13 (the recovery contact), FR-14; TD-03 (the close); AS-05 (the full allowed-by, review and co-sign), AS-09 (seats and markings); WK-02 (practice); BK-20; TR-02 (markings), TR-03 (financial data), TR-04 (keep per kind), TR-06, TR-07, TR-10, TR-12 (the recovery contact), TR-13, TR-14 | 
The accountant seat prepares a payment and sees no Approve button | 

| 
Day 7 | 
ApprovalSheet goes live | 
SH-03 (the Sending is closed and Jobs are paused banners), SH-07, SH-09 ("resumes at"); TD-01 (Review; approvals join the count); AS-17 (actions); WK-01 to WK-07, WK-09 (proposal), WK-11, WK-12, WK-13 (booking), WK-15; BK-12 (reminders agreement); TR-05 (actions, the Limits group), TR-12 ("This computer") | 
An approval matching picture S04; a result that is not sure shows amber and does not send again | 

| 
Day 8 | 
| 
SH-05 (speech providers compared); TD-04 (cost per job step, the record filter, the taint mark); WK-07 (bigger jobs), WK-08, WK-09 (card), WK-10, WK-16; BK-17 (sources and filter); RP-04 (lessons); TR-05 (full), TR-08 (comparison), TR-09 (stopped sends, the canary alert) | 
A job matching picture S05; a budget of 5 rupees stops it, says "stopped by a rule: the budget" and what was left undone | 

| 
Day 9 | 
The locked frame for small apps and plugin screens | 
AS-15 (forwarded text); BK-12 (follow-ups); TL-01 to TL-10; TR-09 (plugins); PH-01 (approvals), PH-03, PH-05 | 
A community plugin installs with every permission set to No | 

| 
Day 10 | 
| 
SH-03 (Update needed for a withdrawn release), SH-08 (hardened), SH-11 (fault report), SH-12 (word list); AS-08 (Ask a person); RP-08; TR-14 (plan state), TR-15 (notice) | 
The first journey with the keyboard only, then with a screen reader. Every picture test green | 

After day 10: PH-04 (the phone page), the CA console and the enterprise version, in that order unless the founder says otherwise.

## 14. When a screen is done

A screen is done when all of these are true.

- It is made only of patterns and parts.

- It handles every state in part 10 of the main file, and its own states in screens.md, each with the fixed words.

- Its pictures exist in both themes and in each view it supports, and pass.

- Its word count at rest is inside the limit.

- Every figure on it opens a receipt.

- Every action on it can be done with the keyboard, and focus returns to where it was.

- axe reports nothing.

- Every word on it is in both text files.

- It works against the fake engine and against the real one, and says "not built yet" where a part is missing.

- Con has tried to break it: a broken reply, a refused action, a hidden row, a file that carries an instruction.

## 15. The browser version

The same screen code is served by a company's server. Four things change, and none of them is in a screen.

| 
Thing | 
Desktop | 
Browser | 

| 
How messages travel | 
Electron's message channel to the engine process | 
HTTPS requests and one event stream, behind the same typed client | 

| 
Getting in | 
The vault's passphrase | 
The company's sign-in. The lock screen becomes "signed out" | 

| 
shell.* | 
The Electron shell | 
The browser: its print dialog, a new tab, a download | 

| 
Addresses | 
After a hash | 
Real paths, so a page can be shared inside the company | 

The layout already answers to narrow windows (main file, part 4), which is what the final plan means by views that fit a phone.

Close · Esc

