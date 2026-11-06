// Pages the Ink walk writes: the local review page (app/ui/.shots/index.html, every shot beside its board) and, with
// --publish, the founder's side-by-side page and WALK.md in docs/superpowers/designs/ink-v2-direction-d/, with the
// shots that match a board copied into walk/ (1280 light and 390 light only, to keep the repo small).

import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listedMd } from './accepted.mjs';
import { BOARDS, FIXED, LISTED, WAVE4_FIRST_WALK } from './boards.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DESIGNS = join(ROOT, 'docs/superpowers/designs/ink-v2-direction-d');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const shotName = (id, width, theme, hindi = false) => `${id}--${width}-${theme}${hindi ? '-hi' : ''}.png`;

/** Tokens and base styles shared by both pages: light and dark from the computer, as the app does. */
const STYLE = `
:root { --bg: #fbfbfa; --surface: #ffffff; --fg: #16181b; --mute: #5c6168; --line: #e3e5e8; --link: #2f5bd3; --ok: #0b7a45; --wait: #b45309; color-scheme: light dark; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg: #111214; --surface: #17191b; --fg: #eceef0; --mute: #a3a9af; --line: #2a2d31; --link: #8fb4ff; --ok: #2fb67c; --wait: #e5a54b; } }
:root[data-theme="dark"] { --bg: #111214; --surface: #17191b; --fg: #eceef0; --mute: #a3a9af; --line: #2a2d31; --link: #8fb4ff; --ok: #2fb67c; --wait: #e5a54b; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.5 'Instrument Sans', system-ui, 'Segoe UI', sans-serif; -webkit-font-smoothing: antialiased; }
main { max-width: 1400px; margin: 0 auto; padding: 32px 16px 64px; }
h1 { font-size: 28px; line-height: 34px; margin: 0 0 6px; }
h2 { font-size: 20px; margin: 0; }
p { margin: 0 0 8px; }
a { color: var(--link); }
.lead { color: var(--mute); max-width: 72ch; }
nav.toc { display: flex; flex-wrap: wrap; gap: 8px 16px; margin: 20px 0 8px; padding: 0; list-style: none; }
section.board { margin-top: 40px; padding-top: 24px; border-top: 1px solid var(--line); }
.head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 16px; margin-bottom: 12px; }
.head code { color: var(--mute); font-size: 13px; }
.notes { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px 24px; margin: 0 0 16px; }
.notes h3 { font-size: 13px; text-transform: uppercase; letter-spacing: .04em; color: var(--mute); margin: 0 0 4px; }
.notes ul { margin: 0; padding-left: 18px; }
.notes li { margin: 2px 0; }
.pair { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; align-items: start; }
.pair.phone { grid-template-columns: repeat(auto-fit, minmax(200px, 390px)); }
figure { margin: 0; min-width: 0; }
figcaption { font-size: 13px; color: var(--mute); margin-bottom: 6px; }
.frame { border: 1px solid var(--line); border-radius: 12px; overflow: auto; max-height: 1100px; background: var(--surface); }
.frame img { display: block; width: 100%; height: auto; }
.pair.phone .frame img { width: 100%; max-width: 390px; }
.none { padding: 24px; color: var(--mute); }
table { border-collapse: collapse; width: 100%; font-size: 13px; }
td, th { border-bottom: 1px solid var(--line); padding: 4px 8px; text-align: left; vertical-align: top; }
.ok { color: var(--ok); } .bad { color: var(--wait); }
@media (max-width: 760px) { .pair { grid-template-columns: 1fr; } main { padding: 20px 16px 48px; } }
`;

function page(title, body) {
  return `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${esc(title)}</title>\n<style>${STYLE}</style>\n</head>\n<body>\n<main>\n${body}\n</main>\n</body>\n</html>\n`;
}

function frame(src, alt, caption) {
  return `<figure><figcaption>${esc(caption)}</figcaption><div class="frame">${src ? `<img src="${esc(src)}" alt="${esc(alt)}" loading="lazy">` : `<p class="none">${esc(alt)}</p>`}</div></figure>`;
}

function list(items) {
  return `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`;
}

/** Markdown code ticks dropped, for the page. */
const plain = (text) => text.replace(/`/g, '');

/** app/ui/.shots/index.html: every board beside its shots, then every other case, light and dark. */
export function writeIndex(out, cases, results) {
  const boardsDir = relative(out, join(DESIGNS, 'shots')).replace(/\\/g, '/');
  const has = new Set(results.filter((r) => r.file).map((r) => r.file));
  const img = (name, alt, caption) => frame(has.has(name) ? name : '', has.has(name) ? alt : `${caption}: not shot`, caption);
  const parts = ['<h1>Ink walk</h1>', `<p class="lead">Each case at 1280 and 390, light and dark, beside its direction D board where there is one. The report is <a href="report.md">report.md</a>.</p>`];
  for (const c of cases) {
    parts.push(`<section class="board" id="${esc(c.id)}"><div class="head"><h2>${esc(c.id)}</h2><code>${esc(c.page ?? '')}${esc(c.path)}</code><span class="lead">${esc(c.note ?? '')}</span></div>`);
    const desk = [];
    if (c.board) desk.push(frame(`${boardsDir}/${c.board}.png`, `${c.board} board`, `${c.board} (board)`));
    desk.push(img(shotName(c.id, 1280, 'light'), `${c.id} at 1280, light`, '1280, light'));
    if (!c.board) desk.push(img(shotName(c.id, 1280, 'dark'), `${c.id} at 1280, dark`, '1280, dark'));
    if ((c.widths ?? [1280, 390]).includes(1280)) parts.push(`<div class="pair">${desk.join('')}</div>`);
    const phone = [];
    if (c.phone) phone.push(frame(`${boardsDir}/${c.phone}.png`, `${c.phone} board`, `${c.phone} (board)`));
    phone.push(img(shotName(c.id, 390, 'light'), `${c.id} at 390, light`, '390, light'));
    phone.push(img(shotName(c.id, 390, 'dark'), `${c.id} at 390, dark`, '390, dark'));
    if (has.has(shotName(c.id, 390, 'light', true))) phone.push(img(shotName(c.id, 390, 'light', true), `${c.id} in Hindi`, '390, Hindi'));
    if ((c.widths ?? [1280, 390]).includes(390)) parts.push(`<div class="pair phone">${phone.join('')}</div>`);
    parts.push('</section>');
  }
  writeFileSync(join(out, 'index.html'), page('Ink walk', parts.join('\n')));
}

/** Copies the board-matched shots into docs (walk/), then writes side-by-side.html and WALK.md beside the boards. */
export function publish(out, cases, report) {
  const walk = join(DESIGNS, 'walk');
  rmSync(walk, { recursive: true, force: true });
  mkdirSync(walk, { recursive: true });
  const copied = new Set();
  const copy = (name) => {
    if (!existsSync(join(out, name))) return false;
    copyFileSync(join(out, name), join(walk, name));
    copied.add(name);
    return true;
  };
  for (const board of BOARDS) {
    for (const id of board.cases) {
      copy(shotName(id, board.phone ? 390 : 1280, 'light'));
      if (!board.phone) copy(shotName(id, 390, 'light'));
    }
  }
  writeFileSync(join(DESIGNS, 'side-by-side.html'), sideBySide(copied));
  writeFileSync(join(DESIGNS, 'WALK.md'), walkMd(report));
  return [...copied];
}

function sideBySide(copied) {
  const body = [
    '<h1>Direction D beside the app</h1>',
    '<p class="lead">Each direction D board on the left, the app on the right, as wave 4 leaves it: the fake engine of <code>npm run dev:ui</code>, 1280 wide, light theme (the phone boards at 390), with the data the engine now sends. Boards are cut at 1100 px tall; the app shots hold the whole page, so scroll inside a frame to see the rest. Each section says what matches, what differs and why, and what is still to come.</p>',
    `<nav class="toc" aria-label="Boards">${BOARDS.map((b) => `<a href="#${esc(b.board)}">${esc(b.title)}</a>`).join('')}</nav>`,
  ];
  for (const b of BOARDS) {
    const width = b.phone ? 390 : 1280;
    const main = b.cases[0] ? shotName(b.cases[0], width, 'light') : '';
    const extra = b.cases.slice(1).map((id) => shotName(id, width, 'light')).filter((n) => copied.has(n));
    body.push(`<section class="board" id="${esc(b.board)}">`);
    body.push(`<div class="head"><h2>${esc(b.title)}</h2><code>${esc(b.address)}</code></div>`);
    body.push(`<div class="notes"><div><h3>Matches</h3>${list(b.matches)}</div><div><h3>Differs, and why</h3>${list(b.differs)}</div><div><h3>Still to come</h3>${list(b.waits.length ? b.waits : ['Nothing on this board.'])}</div></div>`);
    const shot = copied.has(main) ? frame(`walk/${main}`, `${b.title} in the app`, `The app, ${width}, light`) : frame('', 'No screen in the app for this board.', 'The app');
    body.push(`<div class="pair${b.phone ? ' phone' : ''}">${frame(`shots/${b.board}.png`, `${b.board} board`, `${b.board}, the board`)}${shot}</div>`);
    for (const name of extra) body.push(`<div class="pair${b.phone ? ' phone' : ''}"><div></div>${frame(`walk/${name}`, `${name}`, name.replace('.png', ''))}</div>`);
    const phoneShot = !b.phone && b.cases[0] ? shotName(b.cases[0], 390, 'light') : '';
    if (phoneShot && copied.has(phoneShot)) body.push(`<div class="pair phone">${frame(`walk/${phoneShot}`, `${b.title} at 390`, 'The app, 390, light')}</div>`);
    body.push('</section>');
  }
  body.push('<section class="board" id="findings"><div class="head"><h2>What the walk fixed, and what it lists</h2></div>');
  body.push(`<div class="notes"><div><h3>Fixed</h3>${list(FIXED.map(plain))}</div><div><h3>Listed for you or the integrator</h3>${list(LISTED.map(plain))}</div></div>`);
  body.push('<p class="lead">The full table, the checks and the word baselines are in WALK.md beside this page.</p></section>');
  return page('Direction D beside the app', body.join('\n'));
}

function walkMd(report) {
  const lines = [
    '# The walk, board by board (waves 3 and 4)',
    '',
    'Written by `node scripts/ui-shots/walk.mjs --publish` (packages 3I and 4Z) from `scripts/ui-shots/boards.mjs` and the walk\'s report. Each direction D board, the address it is compared with, what matches, what differs and why, and what is still to come. The pictures are in `side-by-side.html` beside this file (board left, app right) and in `walk/` (1280 light and 390 light). Every shot, in both themes and in Hindi, is in `app/ui/.shots/` after a walk (not committed). Addresses on `parts.html` are the dev server\'s parts page: the app or its parts on other fake starts or with sample props, never built into the app.',
    '',
    '| Board | Address | What matches | What differs, and why | Still to come |',
    '|---|---|---|---|---|',
  ];
  const cell = (items) => items.map((i) => i.replace(/\|/g, '\\|')).join('<br>');
  for (const b of BOARDS) lines.push(`| ${b.title} (\`${b.board}\`) | \`${b.address}\` | ${cell(b.matches)} | ${cell(b.differs)} | ${cell(b.waits)} |`);

  const shots = report.results.filter((r) => r.kind === 'shot');
  const focus = report.results.filter((r) => r.kind === 'focus');
  const axeCount = shots.reduce((n, r) => n + r.axe.length, 0);
  const listed = shots.reduce((n, r) => n + (r.listed?.length ?? 0), 0);
  const unsure = shots.reduce((n, r) => n + (r.contrastUnsure?.length ?? 0), 0);
  const hindi = shots.filter((r) => r.hindi).length;
  lines.push('', '## The real-browser checks', '');
  lines.push(`Last walk: ${report.at.slice(0, 16).replace('T', ' ')} UTC, headless Chrome on the fake engine of \`npm run dev:ui\`: ${shots.length} shots over ${report.cases} cases (every place, its main states, sheets and the forms and second asks inside them, at 1280 and 390, light and dark, and ${hindi} in Hindi at 390).`);
  const contrast = shots.reduce((n, r) => n + [...r.axe, ...(r.listed ?? [])].filter((v) => v.id === 'color-contrast').length, 0);
  lines.push('', `- axe-core (from node_modules) on the whole page with colour contrast on: ${axeCount} open violation${axeCount === 1 ? '' : 's'}; ${listed ? `${listed} listed below with their reason` : 'none listed as accepted'}; ${contrast} colour-contrast violation${contrast === 1 ? '' : 's'} in either theme.`);
  lines.push(`- Focus, pressed through with real keys and clicks: ${focus.filter((r) => !r.problems.length).length} of ${focus.length} pass (J and K move through Today's cards; Approve asks again and focus lands on "Not now", then back on Approve; a sheet takes focus on its title and Esc returns it to the button that opened it; the business menu takes focus and Esc returns it; on a phone, Tab never leaves a covering sheet).`);
  lines.push(`- No sideways scroll, no text key on screen, no em dash, no console error, and in Hindi every count in the body face: ${shots.filter((r) => !r.problems.length).length} of ${shots.length} shots clean.`);
  if (unsure) lines.push(`- axe could not decide the contrast of ${unsure} text nodes (white text on the video previews, text over gradients, boxes that overlap): they were looked at in the shots; the preview text is white on the theme-invariant preview ground, over 10:1 by the token table.`);

  lines.push('', '## Wave 4', '');
  lines.push(`Package 4Z walked every wave 4 address and opened state with the rest. The first walk: ${WAVE4_FIRST_WALK.checks} checks, ${WAVE4_FIRST_WALK.failed} failed, ${WAVE4_FIRST_WALK.axe} axe violations:`, '', ...WAVE4_FIRST_WALK.why.map((w) => `- ${w}`), '');
  lines.push(`The last walk: ${report.jobs} checks over ${report.cases} cases, ${report.failed} failed, ${listed} listed as accepted (${shots.length} shots, ${hindi} of them in Hindi at 390 chosen by the computer's languages, and ${focus.length} focus checks). Every wave 4 flow was also walked by hand in the running fake app; what that found is in "Fixed during the walk" and "Listed, not fixed" below, marked Wave 4.`);
  lines.push('', '## Fixed during the walk', '', ...FIXED.map((f) => `- ${f}`));
  lines.push('', '## Listed, not fixed', '', 'From the shots and an unprimed review of them (catalogue Q24: a fresh reviewer given only the shots and the boards).', '', ...LISTED.map((f) => `- ${f}`));
  const accepted = listedMd(report).filter((l) => l.startsWith('- '));
  if (accepted.length) lines.push('', 'axe findings the walk lists rather than fails on (`scripts/ui-shots/accepted.mjs`):', '', ...accepted);

  const failed = report.results.filter((r) => r.axe.length || r.problems.length);
  if (failed.length) {
    lines.push('', '## Open findings from the last walk', '');
    for (const r of failed) {
      for (const v of r.axe) lines.push(`- ${r.id}, ${r.width}, ${r.theme}${r.hindi ? ', Hindi' : ''}: axe ${v.id}: ${v.help} (\`${v.target}\`)`);
      for (const p of r.problems) lines.push(`- ${r.id}, ${r.width}, ${r.theme}${r.hindi ? ', Hindi' : ''}: ${p}`);
    }
  }

  const words = JSON.parse(readFileSync(join(ROOT, 'app/ui/tests/baselines/words.json'), 'utf8'));
  lines.push('', '## Word baselines, for the founder to confirm', '', 'Words a reader sees in each place at rest, measured on the fake engine and rounded up to the next 10 (`app/ui/tests/baselines/words.json`, held by `app/ui/tests/budgets.test.tsx`; they may only shrink). Ink v1 kept every place to 35 to 45 words; direction D carries far more. Every page\'s sub line is at most 20 words and every approval card\'s own copy at most 12. The numbers below are the file as it stands; the integrator settles the wave 4 places from the measures before the wave 4 PR.', '', '| Place | Words at rest |', '|---|---|');
  for (const [place, n] of Object.entries(words.budgets)) lines.push(`| ${place} | ${n} |`);
  return `${lines.join('\n')}\n`;
}
