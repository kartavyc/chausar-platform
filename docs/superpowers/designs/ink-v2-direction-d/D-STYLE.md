# Direction D: style recipe

D is one visual language for every Chausar board: B's bento grid, tinted department panels and tick rows, with C's greeting, dark goal card, stories row, big preview cards and swipe. The reference boards are `D-Today.dc.html`, `D-Team.dc.html`, `D-TeamDept.dc.html` and `D-Phone-Today.dc.html`. Copy from them. If a piece is missing here, build it from these tokens; never add a new colour, radius, shadow or font size.

## 1. Start a board

1. Copy the `<head>` and the `<helmet>` of `D-Today.dc.html` up to and including `/* ===== end of D base ===== */`. That block (the **D base**) is byte-identical on every D board. Never change it in one board only.
2. Phone boards then paste the **D phone** block from `D-Phone-Today.dc.html` (from `/* ===== D phone` to `/* ===== end of D phone ===== */`), right after the D base.
3. Put your own CSS after `/* ---- D-YourBoard ---- */`. Check a class name is not already in the base before you use it. If you need to beat a `.phone .x` rule, write `.phone .yours`.
4. Desktop root (fluid PAGE), then rail + main:

```html
<div style="width:100%;min-height:NNNNpx;display:flex;flex-wrap:wrap;background:#fbfbfa;color:#16181b;font-family:'Instrument Sans','Noto Sans Devanagari',system-ui,sans-serif;font-size:14px;line-height:1.45;-webkit-font-smoothing:antialiased">
  <nav class="rail" aria-label="Places">…</nav>
  <main class="main"><div class="wrap">…</div></main>
</div>
```

   Phone root (fixed 390): `<div class="phone" style="width:390px;min-height:NNNNpx;display:flex;flex-direction:column;background:#fbfbfa;…same font, colour and line-height…">` holding `header.top`, `main.pmain`, `nav.tabs`.
5. The script block, exactly (only `$preview` changes; phone width 390):

```html
<script type="text/x-dc" data-dc-script data-props='{"accent":{"editor":"color","default":"#2FB67C","options":["#2FB67C","#22A06B","#4CAF86","#1F8F63"]},"$preview":{"width":1280,"height":NNNN}}'>
class Component extends DCLogic {
renderVals() {
const accent = this.props.accent ?? '#2FB67C';
const hex = String(accent).replace('#', '');
const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex.slice(0, 6);
const n = parseInt(full, 16);
const rgb = isNaN(n) ? [47, 182, 124] : [(n >> 16) & 255, (n >> 8) & 255, n & 255];
const accentSoft = 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',0.12)';
return { accent: accent, accentInk: '#0b0d0e', accentSoft: accentSoft };
}
}
</script>
```

6. Height: give rows and card grids fixed heights, then sum. `.main` pads 28 top, 48 bottom. Header 58 (80 with an eyebrow line) + 24 below. Toolbar 44 + 16. 16 between bento rows, 32 before a new section. Add at least 40 spare. Content width at 1280 is 984: 12 columns of 67.3 with 16 gaps, so `c3` 234, `c4` 317, `c5` 401, `c6` 484, `c7` 567, `c8` 651, `c12` 984. A tile's border counts inside its height.
7. Before you report, run `python ..\check_c.py <file>` and `python ..\check_nest.py <file>`: 0 errors, 0 em dashes.

## 2. The accent (live tweak)

Holes work in inline `style` and in attributes, never inside `<helmet><style>`. So every accent use is inline, and the base CSS has no green in it at all.

| Hole | Used for |
|---|---|
| `{{accent}}` | primary button fill, goal bar fill and the goal %, working rings, the logo's green square, progress rings and bars of working things, the phone's selected tab line, live dots |
| `{{accentInk}}` | text and icons on the accent (primary buttons, swipe underlay) |
| `{{accentSoft}}` | soft grounds: locked primary, "Working" chip, done ticks, "New" rail chip, "Next best step" chip, the next-step tile wash, the swipe tip icon |

Green text on a light ground is always literal `#0B7A45` ("Ahead", "92%", "3 of 5" under a working story). On the dark goal card the accent itself may be text. Nothing else is green, and `#46F09B` appears nowhere.

```html
<!-- primary button (one per card or row, always last) -->
<button type="button" class="btn lg pri" style="background:{{accent}};border-color:{{accent}};color:{{accentInk}}">Approve</button>
<!-- primary locked until the owner opens the draft: same button, soft ground, lock icon, plus a note line saying why -->
<button type="button" class="btn lg pri" disabled title="Unlocks after you watch it" style="background:{{accentSoft}};border-color:transparent;color:#5c6168"><svg class="i i16" …lock…></svg>Approve</button>
<!-- logo mark: dark square on light grounds, accent square -->
<svg width="22" height="22" viewBox="0 0 37 37" aria-hidden="true"><rect x="0" y="0" width="18" height="18" rx="4.5" fill="#16181b"></rect><rect x="19" y="19" width="18" height="18" rx="4.5" fill="{{accent}}"></rect></svg>
<!-- inside a dark square (Chausar avatar): light square #E8EBEE + accent square -->
```

## 3. Tokens

| Token | Value |
|---|---|
| Page ground | `#fbfbfa` |
| Surface | `#ffffff` |
| Ink / fg2 / mute / dim | `#16181b` / `#3d4146` / `#5c6168` / `#6e737a` |
| Line / soft line / hover | `#e3e5e8` / `#eceef0` / `#f3f4f5` |
| Button border | `#d5d8dc` |
| Link, receipt ids | `#2f5bd3` (receipt chip border `#dbe2f3`); on dark `#8fb4ff` |
| Waiting on you | text `#B45309`, ring and bar `#F2A93B`, ground `#FDF1E3` |
| Failed / stopped | text `#B42318`, ring and bar `#F04438`, ground `#FEECEA`, card border `#F4C7C1` |
| Idle | no ring, chip `#f1f2f3` / `#5c6168` |
| Dark goal card | ground `#111214`, track `#2a2d31`, text `#ffffff` / `#d6d9dc` / `#9aa0a6`, chips `rgba(255,255,255,.08)`, divider `rgba(255,255,255,.1)` |
| Selected (rail item, filter chip, toggle, gate) | fill `#16181b`, text `#ffffff` |

| Department | class suffix | ink | tint (avatar, chip, icon box) | panel border | solid (badges, dots) | icon |
|---|---|---|---|---|---|---|
| Sales and clients | `sales` | `#2F5BD3` | `#E8EEFC` | `#D5E0FA` | `#2F5BD3` | handshake |
| Marketing | `mkt` | `#7C3AED` | `#F1EAFE` | `#E4D6FC` | `#7C3AED` | megaphone |
| Production | `prod` | `#0F766E` | `#E3F4F2` | `#CBE8E4` | `#0F766E` | package |
| Money | `money` | `#0B7A45` | `#E6F6EC` | `#CDEBD8` | `#0B7A45` | indian-rupee |
| Operations | `ops` | `#475467` | `#EEF0F3` | `#DDE1E7` | `#475467` | wrench |

Classes: `d-x` tint ground + ink, `t-x` ink only, `s-x` solid ground, `p-x` panel. Agents: Producer PR (sales), Researcher RE and Publisher PU (mkt), Editor ED (prod), Bookkeeper BK and Billing BI (money), Keeper KE (ops). Soft preview grounds: sales `#F5F8FE` with a `#E8EEFC` border, marketing `#F8F5FE`, documents and invoices on the desk `#f3f4f2` (`.pv-desk`).

**Type.** Instrument Sans for words, DM Mono (`.mono`) for every figure, receipt id, count, time and duration. Page title `.h1` 28/34 600; phone greeting `.hello` 24/30; section head `.h2` 19/26 600; tile and card titles `.h3` / `.qc-title` 16/22 600; body 14/20; `.meta` 13/18 mute; small 12/16; nothing under 11.5 except paper previews. Figures in DM Mono 500: goal 40/48 (phone 30/36), stat 30/36, hero stat 24/30, tile figure 20/26, department stat 17/22.

**Shape and depth.** Tile radius 16, inner card 12, buttons 10 / 12 / 14 by size, chips 999. Only three shadows: tile `0 1px 2px rgba(16,24,40,.06)`; lifted card on a tint `0 1px 2px rgba(16,24,40,.07),0 0 0 1px rgba(16,24,40,.04)`; the goal card `0 1px 2px rgba(16,24,40,.10),0 12px 28px -12px rgba(16,24,40,.45)` (the swiped phone card adds `-12px 0 28px rgba(16,24,40,.18)`).

**Spacing.** Grid gap 16. Tile padding 20 (compact tiles 16, department panels 18, inner cards 14). 12 between inner cards. 32 between page sections. Gutters 32 desktop, 16 phone.

## 4. Pieces

**Rail** (identical on every desktop board; move `class="on"` and `aria-current="page"` to the current place; the Today count is amber when Today is not selected):

```html
<nav class="rail" aria-label="Places">
  <a class="brand" href="#/today">{logo svg}<span class="word">chausar</span></a>
  <button type="button" class="biz" aria-haspopup="menu" aria-expanded="false"><span class="biz-sq" aria-hidden="true">LS</span><span class="biz-txt"><span class="biz-name">Lumen Studio</span><span class="biz-kind">YouTube channel</span></span>{chevrons-up-down i16}<span class="sr-only">Switch business</span></button>
  <ul class="nav">
    <li><a class="on" href="#/today" aria-current="page">{sun}<span>Today</span><span class="ct mono" aria-hidden="true">12</span><span class="sr-only">, 12 need you</span></a></li>
    <li><a href="#/chats">{messages-square}<span>Chats</span><span class="new" style="background:{{accentSoft}}">New</span></a></li>
    <li><a href="#/team">{users}<span>Team</span></a></li>
    <li><a href="#/work">{briefcase}<span>Work</span></a></li>
    <li><a href="#/clients">{contact}<span>Clients</span></a></li>
    <li><a href="#/money">{wallet}<span>Money</span></a></li>
    <li><a href="#/connections">{plug}<span>Connections</span></a></li>
  </ul>
</nav>
```

**Page header.** `header.phead` holds a left block (`p.eyebrow` optional, `h1.h1`, `p.sub` with `<b>` for the key count) and `div.tools` on the right: `button.ask` ("Ask Chausar anything" + `span.kbd.mono` "Ctrl K"), `button.ib` bell with `span.dot`, `button.me` "K". Same on every desktop board. Page controls go in a `div.toolbar` row under it (toggle left, actions right).

**Grid and surfaces.** `div.bento` (12 columns) with children `c3`…`c12`. `.tile` for every bento tile. Inside a white tile use `.inner` (grey `#f6f7f8`, no border); inside a tinted panel use `.lift` (white, soft shadow). Tile head: `div.th` > `h2.h3` + `span.meta` + `a.more` (text + chevron-right i16, pushed right). Section head outside tiles: `div.shead` > `h2.h2` + `span.count.mono` (amber count).

**Avatars and rings.** Rounded square in the department tint: `span.av.av40.d-prod` (sizes `av24` `av28` `av32` default 36 `av40` `av52`; stories use `.st-av` 60). Ring by status; the first shadow is the ground under the avatar (`#ffffff` on tiles and lifted cards, `#f6f7f8` on `.inner`):

```html
<span class="av av40 d-prod" style="box-shadow:0 0 0 2px #ffffff,0 0 0 4px {{accent}}" aria-hidden="true">ED</span>  <!-- working -->
<span class="av av40 d-sales ring-wait" aria-hidden="true">PR</span>   <!-- waiting on you -->
<span class="av av40 d-prod ring-fail" aria-hidden="true">ED</span>    <!-- stopped -->
<span class="av av40 d-money" aria-hidden="true">BK</span>             <!-- idle: no ring -->
<!-- av52 working ring: 0 0 0 2.5px #ffffff,0 0 0 5px {{accent}} -->
```

**Stories row** (Today and phone): `ul.stories` of `li > button.story` > `span.st-av` (tint, ring, `span.st-badge.s-x` with the department icon) + `span.st-name` + `span.st-st` (`.w` amber "Needs you", `.g` green "Working" or mono "3 of 5", plain "Idle"). Working ring `box-shadow:0 0 0 3px #ffffff,0 0 0 5.5px {{accent}}`; waiting `st-ring-wait`. First item is Chausar (`st-av av-cz` with the mark), last is `st-av st-add` "Add agent". On phone wrap it in `.hscroll` so it bleeds off the right edge.

**Chips.**

```html
<span class="chip work" style="background:{{accentSoft}}"><span class="dot" style="background:{{accent}}"></span>Working</span>
<span class="chip wait"><span class="dot"></span>Waiting on you</span>   <span class="chip fail">…</span>   <span class="chip idle">Idle</span>   <span class="chip line">3 checks passed</span>
<span class="dchip d-prod">Production</span>                         <!-- department label beside a name -->
<span class="kchip">{icon i14}Draft to watch</span>                  <!-- card kind, right of the card head; .wait / .fail variants -->
<span class="pos">{shield-check i12}Asks each time</span>            <!-- posture: Asks each time, Shadowing {eye}, Rehearsing {history} -->
<a class="rc" href="#/receipt/R-0419">{receipt-text i12}R-0419</a>  <!-- receipt on light; on dark: <a class="rc-d" …>R-0421</a> -->
<span class="est">model estimate</span>                             <!-- next to any model-written number -->
<div class="fchips" role="group" aria-label="Show"><button type="button" class="fchip on" aria-pressed="true">All <span class="mono">12</span></button><button type="button" class="fchip" aria-pressed="false">To approve <span class="mono">7</span></button><span class="fsep" aria-hidden="true"></span><button type="button" class="fchip" aria-pressed="false"><span class="bsq" aria-hidden="true">LS</span>Lumen Studio <span class="mono">7</span></button></div>
```

**Buttons.** `.btn` 36 (tiles, toolbars), `.btn.sm` 30, `.btn.lg` 44 (desktop big cards), `.btn.xl` 48 (next best step, every phone card). Secondary first, the one primary last; in cards both get `flex:1` through `.qc-acts`. `.btn.ink` for a dark secondary, `.btn.wide` for full width. The quiet agent chat button is `button.chat` ({message-square i14} "Chat", `aria-label="Chat with Editor"`), never a primary.

**Progress.** Bar: `span.pbar` with a filled span (working `{{accent}}`, waiting `#F2A93B`, stopped `#F04438`):

```html
<span class="pbar"><span style="width:60%;background:{{accent}}"></span></span><span class="mono">3 of 5</span>
<!-- unknown length: <span style="left:30%;width:40%;background:linear-gradient(90deg,rgba(255,255,255,0),{{accent}} 40%,{{accent}} 60%,rgba(255,255,255,0))"></span> -->
```

Ring (40px, r 16, circumference 100.53, dash = 100.53 x done / total: 1/3 33.5, 2/5 40.2, 1/2 50.3, 3/5 60.3, 2/3 and 4/6 67.0, 3/4 75.4, 4/5 80.4):

```html
<div class="pring" role="img" aria-label="3 of 5 steps done"><svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="16" fill="none" stroke="#e3e5e8" stroke-width="4"></circle><circle cx="20" cy="20" r="16" fill="none" stroke="{{accent}}" stroke-width="4" stroke-linecap="round" stroke-dasharray="60.3 100.53" transform="rotate(-90 20 20)"></circle></svg><b>3/5</b></div>
```

Unknown length ring: dash `26 100.53`, `transform="rotate(30 20 20)"`, and three `r="1.5"` ink dots at x 15, 20, 25 instead of the label. Step lists with ticks (runs, chats): `span.tick` 20px circle on `{{accentSoft}}` with a `#0B7A45` check, the current step a 20px spinner arc in `{{accent}}`, pending a dashed `#b9bec4` circle (see `D-TeamDept.dc.html`, `.sr`).

**Goal card** (dark, banking style). Copy the `section.goal` from `D-Today.dc.html`. Its parts: `g-top` (target icon in `g-ic` coloured `{{accent}}`, `g-lbl`, `g-sub`, `g-pill` "8 days left", `g-edit`), `g-fig` (`g-amt` ₹1,18,400, `g-of` of ₹1,50,000, `g-pct` 79% in `{{accent}}`), the thick bar, `g-legend`, and `g-foot` (three mini stats with `rc-d` receipts). On phone, replace `g-foot` with `div.g-next` (`gn-k`, `gn-t`, a full-width `.btn.xl.pri`). The bar:

```html
<div class="g-bar" role="img" aria-label="79% of the goal invoiced. Issuing INV-0042 takes it to 92%. Today's pace is 74%.">
  <span class="g-fill" style="width:78.9%;background:{{accent}}"></span>
  <span class="g-ready" style="left:78.9%;width:12.6%;background:repeating-linear-gradient(-45deg,rgba(17,18,20,.55) 0 4px,rgba(17,18,20,0) 4px 8px),{{accent}}"></span>
  <span class="g-pace" style="left:74.2%"></span>
</div>
```

**Big preview card** (Needs you; every card has the same six parts, so heights line up in a grid of `grid-auto-rows:464px`):

```html
<article class="tile qcard" aria-labelledby="q1">
  <header class="qc-head">{avatar av40 with ring}<div class="qc-who"><p class="qc-name">Editor <span class="dchip d-prod">Production</span></p><p class="qc-meta">Lumen Studio · <span class="mono">08:40</span></p></div><span class="kchip">{icon}Draft to watch</span></header>
  <h3 id="q1" class="qc-title">Episode 14 is cut</h3>
  <p class="qc-line">11 min 42 s. Watch it before approving.</p>
  <div class="pv pv-video">{preview, 188 tall (phone 180)}</div>
  <p class="qc-note">{lock i14}Approve unlocks after you watch it<span class="chip line end">…</span></p>
  <div class="qc-acts"><button type="button" class="btn lg">Watch</button>{primary or locked primary}</div>
</article>
```

Previews to reuse: video frame (`.pv-video` with `v-tag`, `v-title`, `v-art`, `v-play`, `v-dur`, `v-scrub`), paper sheet for invoices and documents (`.paper` absolutely placed on `.pv-desk`, rows `pp-row`, total `pp-tot`), before and after pill (`span.chg` > `.old` struck, `.arr.d-x`, `.now`) with breakdown boxes (`.bx`, `.op`). On phone the card kind is the icon-only `span.kd` (32px circle, `role="img"`, `aria-label`) instead of `.kchip`, and the actions are `.btn.xl`.

**Department panel and agent card** (Team; copy from `D-Team.dc.html`):

```html
<article class="dp p-prod c5" aria-labelledby="dp-prod">
  <div class="dp-head"><span class="dp-ic t-prod">{package}</span><div class="dp-t"><h2 id="dp-prod" class="dp-name">Production</h2><p class="dp-line">1 working · <span class="f">1 run stopped</span></p></div><div class="dp-stats"><div class="dp-s"><b>6</b><span>jobs this week</span></div><div class="dp-s"><b>₹42.10</b><span>this month</span></div></div></div>
  <div class="agents">   <!-- add class "two" for two cards side by side -->
    <div class="lift acard">
      <div class="a-top">{avatar av40 + ring}<div class="a-id"><p class="a-name">Editor</p><p class="a-role">Cuts episodes and shorts</p></div></div>
      <p class="a-now">Cutting shorts from episode 13</p>   <!-- idle: <span class="chip idle">Idle</span> first -->
      <div class="a-prog"><span class="pbar">…</span><span class="mono">3 of 5</span><span class="muted">· 4m · rendering short 3</span></div>
      <div class="a-foot"><span class="pos">…</span><button type="button" class="chat" aria-label="Chat with Editor" aria-expanded="false">…Chat</button></div>
    </div>
  </div>
</article>
```

A single department shown large uses the same panel as a hero row (`dp p-prod hero`, see `D-TeamDept.dc.html`) with white `.lift.hs` stat boxes.

**Segmented toggle** (Team, and any one-of-many view switch). Department options carry a coloured dot:

```html
<div class="seg" role="group" aria-label="Show departments">
  <button type="button" class="on" aria-pressed="true">{layout-grid i16}All departments</button>
  <button type="button" aria-pressed="false"><span class="sdot s-sales" aria-hidden="true"></span>Sales and clients</button>
  …Marketing, Production, Money, Operations
</div>
```

On phone the same choice is a `.fchips` row that bleeds off the right edge. Step gates: `div.gate` (role group) with `Auto` and `Hold` buttons, the chosen one `.on`; a floor step that always asks shows `span.floor` ({lock i14} "Always asks you") instead of the gate.

**List rows** (Working now, Earlier, decisions): `li.lrow` (60 tall; `.ev` 52) > avatar `av32` or status circle `span.sic` (`ok` on `{{accentSoft}}`, `no`, `q`, `est`, `fail`) + `div.lr-b` (`lr-t`, `lr-s`) + `div.lr-p` (bar + label) or a receipt chip + `span.lr-e.mono` time.

**Charts.** Department data uses the department solid colours. A single series uses the department colour for the current bar and its panel border colour for the rest (Production `#0F766E` and `#CBE8E4`), or ink `#16181b` and `#d5d8dc` when no department applies. Never the accent for data. Values in DM Mono 10.5, labels Instrument Sans 10.5 `#6e737a`, baseline `#e3e5e8`, every chart has `role="img"` and an `aria-label` that reads the numbers.

**Phone frame.** `header.top` (`a.top-mark` with the logo, `button.bizb` "LS Lumen Studio" + chevron-down, `span.grow`, `button.tib` bell with `.dot`, `button.me.sm`), `main.pmain`, and `nav.tabs` with Today, Chats, Team, Work, More (icons sun, messages-square, users, briefcase, layout-grid). The selected tab: `a.tab.on` with `aria-current="page"`, first child `<span class="tab-line" style="background:{{accent}}"></span>`, Today carries `span.tab-badge.mono` 12. Horizontal rows use `.hscroll`. Swipe: wrap a card in `div.swipe` with `style="background:{{accent}}"`, put `div.under` (`style="color:{{accentInk}}"`, check icon in `.under-ic`, label, `small` "asks once more") first, and give the card `.shifted`.

## 5. Icons

Inline Lucide paths, `class="i"` (18) or `i12` `i14` `i16` `i20` `i22`, `viewBox="0 0 24 24"`, `aria-hidden="true"`, every child closed with an explicit end tag. Copy the exact paths from the reference boards: sun, messages-square, users, briefcase, contact, wallet, plug (rail); chevrons-up-down, chevron-down, chevron-right, arrow-right, bell, sparkles, target, calendar, pencil, trending-up, receipt-text, check, x, lock, eye, eye-off, history, rotate-ccw, triangle-alert, circle-help, clock, tag, stamp, send, file-text, file-pen, bot, play (filled with `class="i fill"`), plus, message-square, layout-grid, mic, arrow-left-right, scissors, youtube, and the department icons handshake, megaphone, package, indian-rupee, wrench.

## 6. Sample data to keep consistent

Friday, 23 October; "Good evening, Kartavy". Goal: ₹1,18,400 invoiced of ₹1,50,000, 79%, 8 days left, today's pace 74.2%, ready to issue ₹18,880 (INV-0042 to Mehta Traders, R-0419, takes the goal to 92%), ₹31,600 to go (R-0421), received ₹86,200.00 (R-0402). Needs you 12: 7 to approve, 3 questions, 2 setup; Lumen Studio 7, Ledgerline 4, Sitara Events 1. Team: 3 working (Editor 3 of 5, Researcher, Keeper 4 of 6), Producer waiting on you (2 of 3), 3 idle. Jobs this week 36 (Money 12, Operations 8, Marketing 7, Production 6, Sales and clients 3); AI spend ₹78.80 this month plus ₹18.00 held (Production ₹42.10, Money ₹33.50, Operations ₹3.20, Marketing ₹18.00 held, Sales and clients ₹0.00). Everything else comes from `fixtures.ts` (BRIEF.md).

## 7. Do not

No neon, no emoji, no gradient washes except the next-step tile's `{{accentSoft}}` fade and the preview art. No coloured blocks other than department tints, status grounds and the dark goal card. No `{{ }}` in helmet CSS. No `<div>` inside `<p>`, `<span>`, `<button>`, `<label>` or `<a>` text runs. Plain English, product words (Approve, Later, Deny, Run again, Answer), no em dashes.
