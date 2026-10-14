// Extract the design's reference pictures from docs/specs/Chausar-App-Design.html.
// Each picture is a <figure class="shot"> with data-name="S01-Today" and two base64 PNGs
// (class "l" light, class "d" dark). A picture appears more than once (once in the walk-through,
// once beside its screen entry); each is written once, with every caption and section id it carries.
//
//   node frontend-validation/visual/extract.mjs [--source=<html>] [--out=<dir>]
//
// Writes <out>/<name>-light.png, <out>/<name>-dark.png and <out>/manifest.json
// (default out: frontend-validation/dist/visual/reference, which is not committed).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const referenceDir = resolve(workspaceRoot, 'frontend-validation/dist/visual/reference');
const args = new Map(process.argv.slice(2).map(arg => { const [key, ...value] = arg.replace(/^--/, '').split('='); return [key, value.join('=') || true]; }));

/** Every figure in the design file, in order: name, caption, enclosing section id, the light and dark PNG bytes. */
export function readFigures(html) {
  const figures = [];
  const figurePattern = /<figure class="shot( phone)?">([\s\S]*?)<\/figure>/g;
  for (const match of html.matchAll(figurePattern)) {
    const body = match[2];
    const name = /data-name="([^"]+)"/.exec(body)?.[1];
    const light = /<img class="l" src="data:image\/png;base64,([^"]+)"[^>]*?width="(\d+)" height="(\d+)"/.exec(body);
    const dark = /<img class="d" src="data:image\/png;base64,([^"]+)"/.exec(body);
    const caption = /<figcaption>([\s\S]*?)<\/figcaption>/.exec(body)?.[1].replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').trim();
    if (!name || !light || !dark) continue;
    // The nearest section (or heading) id before the figure: a screen code (TD-01) or a design topic.
    const before = html.slice(Math.max(0, match.index - 200000), match.index).replace(/data:image\/png;base64,[^"]+/g, '');
    const ids = [...before.matchAll(/<(?:section|h2|h3)[^>]*\bid="([^"]+)"/g)].map(item => item[1]);
    figures.push({ name, phone: Boolean(match[1]), width: Number(light[2]), height: Number(light[3]), caption: caption ?? '', section: ids.at(-1) ?? null, light: Buffer.from(light[1], 'base64'), dark: Buffer.from(dark[1], 'base64') });
  }
  return figures;
}

export function extract({ source = resolve(workspaceRoot, 'docs/specs/Chausar-App-Design.html'), out = referenceDir } = {}) {
  const figures = readFigures(readFileSync(source, 'utf8'));
  mkdirSync(out, { recursive: true });
  const byName = new Map();
  for (const figure of figures) {
    const entry = byName.get(figure.name);
    if (entry) {
      if (!entry.captions.includes(figure.caption)) entry.captions.push(figure.caption);
      if (figure.section && !entry.sections.includes(figure.section)) entry.sections.push(figure.section);
      continue;
    }
    writeFileSync(resolve(out, `${figure.name}-light.png`), figure.light);
    writeFileSync(resolve(out, `${figure.name}-dark.png`), figure.dark);
    byName.set(figure.name, { name: figure.name, phone: figure.phone, width: figure.width, height: figure.height, captions: [figure.caption], sections: figure.section ? [figure.section] : [], light: `${figure.name}-light.png`, dark: `${figure.name}-dark.png` });
  }
  const manifest = { source: 'docs/specs/Chausar-App-Design.html', extractedAt: new Date().toISOString(), pictures: [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)) };
  writeFileSync(resolve(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const manifest = extract({ ...(typeof args.get('source') === 'string' ? { source: resolve(args.get('source')) } : {}), ...(typeof args.get('out') === 'string' ? { out: resolve(args.get('out')) } : {}) });
  for (const picture of manifest.pictures) process.stdout.write(`${picture.name.padEnd(20)} ${picture.width}x${picture.height}  ${picture.sections.join(', ').padEnd(40)} ${picture.captions[0]}\n`);
  process.stdout.write(`${manifest.pictures.length} pictures (light and dark) in ${referenceDir}\n`);
}
