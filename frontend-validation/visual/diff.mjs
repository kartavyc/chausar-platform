// Compare each reference picture (extract.mjs) with the preview's capture of the same screen
// (capture.mjs) pixel by pixel, with png.mjs (node:zlib only, no image dependency).
//
//   node frontend-validation/visual/diff.mjs [--only=<regex on the picture name>]
//
// Writes frontend-validation/dist/visual/diff/<name>-<theme>.png (the reference washed out, every
// differing pixel red) and manifest.json with each picture's ratios. The allowed ratio for each
// picture, and the reason it is not zero, is in visual/thresholds.json. Exits 1 when a picture's
// pixel ratio is over its threshold in either theme, or a captured picture has no threshold.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { comparePng, decodePng, encodePng } from './png.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const workspaceRoot = resolve(here, '../..');
export const referenceDir = resolve(workspaceRoot, 'frontend-validation/dist/visual/reference');
export const captureDir = resolve(workspaceRoot, 'frontend-validation/dist/visual/capture');
export const diffDir = resolve(workspaceRoot, 'frontend-validation/dist/visual/diff');
export const thresholdsPath = resolve(here, 'thresholds.json');
/** Per pixel: a channel moved by more than this (of 255). Per 16 px block: mean luminance moved by more than this. */
export const TOLERANCE = { pixel: 32, block: 16, blockLuminance: 0.06 };

export function diffAll({ only = null } = {}) {
  const references = JSON.parse(readFileSync(resolve(referenceDir, 'manifest.json'), 'utf8'));
  const captures = JSON.parse(readFileSync(resolve(captureDir, 'manifest.json'), 'utf8'));
  const thresholds = JSON.parse(readFileSync(thresholdsPath, 'utf8')).pictures;
  const captureOf = new Map(captures.pictures.map(entry => [entry.name, entry]));
  mkdirSync(diffDir, { recursive: true });
  const pictures = [];
  for (const picture of references.pictures) {
    if (only && !only.test(picture.name)) continue;
    const capture = captureOf.get(picture.name);
    const threshold = thresholds[picture.name] ?? null;
    const entry = { name: picture.name, lane: capture?.lane ?? null, status: capture?.status ?? 'not captured', maxRatio: threshold?.maxRatio ?? null, reason: threshold?.reason ?? null, themes: {}, over: [] };
    for (const theme of ['light', 'dark']) {
      if (!capture?.captures?.[theme]) continue;
      const reference = decodePng(readFileSync(resolve(referenceDir, picture[theme])));
      const actual = decodePng(readFileSync(resolve(captureDir, capture.captures[theme])));
      const result = comparePng(reference, actual, { tolerance: TOLERANCE.pixel, block: TOLERANCE.block, blockTolerance: TOLERANCE.blockLuminance });
      const file = `${picture.name}-${theme}.png`;
      writeFileSync(resolve(diffDir, file), encodePng(result.diff));
      entry.themes[theme] = { ratio: Number(result.ratio.toFixed(4)), blockRatio: Number(result.blockRatio.toFixed(4)), differing: result.differing, diff: file };
      if (threshold === null || result.ratio > threshold.maxRatio) entry.over.push(theme);
    }
    pictures.push(entry);
  }
  const manifest = { comparedAt: new Date().toISOString(), tolerance: TOLERANCE, pictures };
  writeFileSync(resolve(diffDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = new Map(process.argv.slice(2).map(arg => { const [key, ...value] = arg.replace(/^--/, '').split('='); return [key, value.join('=') || true]; }));
  const manifest = diffAll({ only: typeof args.get('only') === 'string' ? new RegExp(args.get('only')) : null });
  const percent = value => (value === undefined ? '    -' : `${(value * 100).toFixed(1).padStart(5)}%`);
  for (const entry of manifest.pictures) {
    const { light, dark } = entry.themes;
    process.stdout.write(`${entry.name.padEnd(20)} light ${percent(light?.ratio)} (blocks ${percent(light?.blockRatio)})  dark ${percent(dark?.ratio)} (blocks ${percent(dark?.blockRatio)})  max ${entry.maxRatio === null ? '-' : percent(entry.maxRatio)}  ${entry.over.length ? `OVER (${entry.over.join(', ')})` : Object.keys(entry.themes).length ? 'ok' : entry.status}\n`);
  }
  process.stdout.write(`Diff images in ${diffDir}\n`);
  process.exit(manifest.pictures.some(entry => entry.over.length > 0) ? 1 : 0);
}
