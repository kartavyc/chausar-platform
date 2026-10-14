// Build the side-by-side review page docs/lanes/frame-today-visual.html from the extracted
// reference pictures (extract.mjs), the preview captures (capture.mjs) and the written notes
// (notes.json). One self-contained static file: inline CSS, every picture a JPEG data URI
// (downscaled in Chromium, no other image tool), no external request.
//
//   node frontend-validation/visual/page.mjs [--width=1200] [--quality=72] [--out=docs/lanes/frame-today-visual.html]
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChromium } from '../policy/browser.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(here, '../..');
const referenceDir = resolve(workspaceRoot, 'frontend-validation/dist/visual/reference');
const captureDir = resolve(workspaceRoot, 'frontend-validation/dist/visual/capture');
const args = new Map(process.argv.slice(2).map(arg => { const [key, ...value] = arg.replace(/^--/, '').split('='); return [key, value.join('=') || true]; }));
const width = Number(args.get('width') ?? 1200);
const quality = Number(args.get('quality') ?? 72);
const out = resolve(workspaceRoot, typeof args.get('out') === 'string' ? args.get('out') : 'docs/lanes/frame-today-visual.html');

const escape = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const references = JSON.parse(readFileSync(resolve(referenceDir, 'manifest.json'), 'utf8'));
const captures = JSON.parse(readFileSync(resolve(captureDir, 'manifest.json'), 'utf8'));
const notes = JSON.parse(readFileSync(resolve(here, 'notes.json'), 'utf8'));
const captureOf = new Map(captures.pictures.map(entry => [entry.name, entry]));

const browser = await launchChromium();
/** A PNG file as a downscaled JPEG data URI, drawn and encoded by Chromium. */
async function jpeg(path, sourceWidth, sourceHeight) {
  const scale = Math.min(1, (sourceWidth > 600 ? width : Math.round(width * 0.42)) / sourceWidth);
  const w = Math.round(sourceWidth * scale), h = Math.round(sourceHeight * scale);
  const context = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.setContent(`<style>html,body{margin:0}img{display:block;width:${w}px;height:${h}px}</style><img src="data:image/png;base64,${readFileSync(path).toString('base64')}">`);
  await page.waitForFunction(() => document.images[0]?.complete);
  const bytes = await page.screenshot({ type: 'jpeg', quality });
  await context.close();
  return { src: `data:image/jpeg;base64,${bytes.toString('base64')}`, w, h };
}

const figure = (image, label) => image
  ? `<figure><img src="${image.src}" width="${image.w}" height="${image.h}" alt="${escape(label)}" loading="lazy"><figcaption>${escape(label)}</figcaption></figure>`
  : `<figure class="none"><div class="blank" role="img" aria-label="${escape(label)}"><span>${escape(label)}</span></div><figcaption>${escape(label)}</figcaption></figure>`;

const sections = [];
for (const picture of references.pictures) {
  const capture = captureOf.get(picture.name);
  const note = notes[picture.name] ?? {};
  const status = capture?.status ?? 'not captured';
  const themes = [];
  for (const theme of ['light', 'dark']) {
    const reference = await jpeg(resolve(referenceDir, picture[theme]), picture.width, picture.height);
    const captured = capture?.captures?.[theme] ? await jpeg(resolve(captureDir, capture.captures[theme]), 1366, 768) : null;
    themes.push(`<div class="theme"><h3>${theme === 'light' ? 'Light' : 'Dark'}</h3><div class="pair">${figure(reference, `Reference ${picture.name}, ${theme}`)}${figure(captured, captured ? `Preview, ${theme}` : `No capture: ${capture?.reason ?? status}`)}</div></div>`);
  }
  const address = capture?.address ? `<code>index.html?${escape(capture.query)}&amp;theme=…${escape(capture.address)}</code>${capture.drive ? ` then the scripted walk <code>${escape(capture.drive)}</code>` : ''}` : '<span class="mute">none</span>';
  const differences = (note.differences ?? []).map(item => `<li>${escape(item)}</li>`).join('');
  const fixed = (note.fixed ?? []).map(item => `<li>${escape(item)}</li>`).join('');
  sections.push(`<section id="${escape(picture.name)}">
<h2>${escape(picture.name)} <span class="status s-${escape(status.replace(/[^a-z]+/g, '-'))}">${escape(status)}</span></h2>
<p class="caption">${escape(picture.captions.join(' / '))}</p>
<dl><dt>Design entries</dt><dd>${picture.sections.map(id => `<code>${escape(id)}</code>`).join(' ')}</dd><dt>Owner</dt><dd>${escape(capture?.lane ?? '-')}</dd><dt>Address</dt><dd>${address}</dd></dl>
${differences ? `<h3 class="sub">Differences</h3><ul>${differences}</ul>` : capture?.reason ? `<p class="mute">${escape(capture.reason)}</p>` : ''}
${fixed ? `<h3 class="sub">Fixed in this round</h3><ul>${fixed}</ul>` : ''}
${themes.join('\n')}
</section>`);
}
await browser.close();

const toc = references.pictures.map(picture => `<li><a href="#${escape(picture.name)}">${escape(picture.name)}</a> <span class="mute">${escape(captureOf.get(picture.name)?.status ?? '')}</span></li>`).join('');
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Frame and Today against the reference pictures</title>
<style>
:root { --bg: #f6f7f6; --fg: #151617; --mute: #5d6166; --line: #dfe2e0; --card: #ffffff; --ok: #0b7a43; --other: #8a5300; color-scheme: light dark; }
@media (prefers-color-scheme: dark) { :root { --bg: #141516; --fg: #ecedee; --mute: #a3a8ad; --line: #2c2f31; --card: #1c1e20; --ok: #4cc38a; --other: #e0a050; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 1960px; margin: 0 auto; padding: 24px 16px 64px; }
h1 { font-size: 26px; font-weight: 500; margin: 0 0 8px; }
h2 { font-size: 20px; font-weight: 500; margin: 0; display: flex; gap: 12px; align-items: baseline; flex-wrap: wrap; }
h3 { font-size: 14px; font-weight: 500; margin: 12px 0 6px; color: var(--mute); }
p, ul { margin: 6px 0; max-width: 980px; }
code { font: 13px ui-monospace, "Cascadia Mono", Menlo, monospace; overflow-wrap: anywhere; }
.mute { color: var(--mute); }
.intro { color: var(--mute); }
nav ul { columns: 3 220px; padding-left: 18px; max-width: none; }
section { background: var(--card); border: 1px solid var(--line); border-radius: 6px; padding: 16px; margin: 24px 0; }
.caption { font-size: 16px; }
dl { display: grid; grid-template-columns: max-content 1fr; gap: 2px 12px; margin: 8px 0; font-size: 14px; }
dt { color: var(--mute); }
dd { margin: 0; }
.status { font-size: 13px; padding: 1px 8px; border-radius: 10px; border: 1px solid currentColor; color: var(--mute); }
.s-frame-today { color: var(--ok); }
.s-other-lane, .s-other-lane-not-built-yet { color: var(--other); }
.pair { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
@media (max-width: 900px) { .pair { grid-template-columns: minmax(0, 1fr); } }
figure { margin: 0; min-width: 0; }
figure img { display: block; width: 100%; height: auto; border: 1px solid var(--line); }
figcaption { font-size: 13px; color: var(--mute); margin-top: 4px; }
.blank { aspect-ratio: 1366 / 768; border: 1px dashed var(--line); display: grid; place-items: center; padding: 16px; text-align: center; color: var(--mute); }
.sub { color: var(--fg); }
</style>
</head>
<body>
<main>
<h1>Frame and Today against the reference pictures</h1>
<p class="intro">Each of the design's ${references.pictures.length} reference pictures (docs/specs/Chausar-App-Design.html) beside the fake-engine preview's drawing of the same screen at 1366 x 768, in the same theme, view and language. Generated by <code>frontend-validation/visual/page.mjs</code> on ${escape(captures.capturedAt.slice(0, 10))}; pictures are downscaled JPEG. The preview draws synthetic data from the fake engine, so names and amounts differ from the pictures by design; the notes list the layout differences. Status: <strong>frame-today</strong> is this lane's screen; <strong>other lane</strong> is drawn by another lane's place module; <strong>not built yet</strong> shows the design's not-built state; <strong>not drawable</strong> has no desktop-preview counterpart.</p>
<nav aria-label="Pictures"><ul>${toc}</ul></nav>
${sections.join('\n')}
</main>
</body>
</html>
`;
writeFileSync(out, html);
process.stdout.write(`${out}: ${(statSync(out).size / 1024 / 1024).toFixed(2)} MB, ${references.pictures.length} pictures\n`);
