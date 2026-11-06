#!/usr/bin/env node
// C7 task 23: the guide, indexed at build. Splits docs/beta-guide.md by its ## and ### headings and writes
// platform/shared/venture/core/guide-data.json: each section's anchor (the same as the guide's own links), title, level,
// the ## part it sits in, and its words with images left out. In-app help (C7 tasks 24, 25) quotes these words and
// links to the anchor; nothing is written by a model. --check fails when the data is out of date with the guide.
// Usage: node scripts/guide-index.mjs [--check] [--guide <file.md>] [--out <file.json>]
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const GUIDE_FORMAT = 'chausar.guide.v1';

/** The anchor GitHub gives a heading: lower case, punctuation dropped, spaces to hyphens. */
export function slugOf(title) {
  return title.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');
}

/** A section's words without images, rules or runs of blank lines. */
function wordsOf(lines) {
  return lines
    .map(line => line.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/<img\b[^>]*>/gi, '').replace(/[ \t]{2,}/g, ' ').replace(/\s+$/, ''))
    .filter(line => !/^\s*-{3,}\s*$/.test(line))
    .join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** The guide's ## and ### sections in order: { anchor, title, level, part, text }. */
export function guideSections(markdown) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n'), sections = [], used = new Map();
  let current = null, part = null, fence = false;
  for (const line of lines) {
    if (/^```/.test(line)) fence = !fence;
    const heading = fence ? null : /^(#{1,6}) (.+?)\s*#*\s*$/.exec(line);
    if (heading && heading[1].length <= 3) {
      if (current) sections.push({ ...current, text: wordsOf(current.lines) });
      current = null;
      if (heading[1].length === 1) continue;
      const title = heading[2].trim(), base = slugOf(title), seen = used.get(base) ?? 0;
      used.set(base, seen + 1);
      const anchor = seen ? `${base}-${seen}` : base, level = heading[1].length;
      if (level === 2) part = anchor;
      current = { anchor, title, level, part: part ?? anchor, lines: [] };
      continue;
    }
    if (current) current.lines.push(line);
  }
  if (current) sections.push({ ...current, text: wordsOf(current.lines) });
  return sections.map(({ lines: _lines, ...section }) => section);
}

/** The data file's text for a guide. */
export function guideData(markdown) {
  return `${JSON.stringify({ format: GUIDE_FORMAT, source: 'docs/beta-guide.md', sections: guideSections(markdown) }, null, 2)}\n`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const usage = 'Usage: node scripts/guide-index.mjs [--check] [--guide <file.md>] [--out <file.json>]';
  const args = process.argv.slice(2), options = { check: false, guide: join(root, 'docs', 'beta-guide.md'), out: join(root, 'platform', 'shared', 'venture', 'core', 'guide-data.json') };
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === '--check') { options.check = true; continue; }
    const value = args[index + 1];
    if (!['--guide', '--out'].includes(flag) || !value || value.startsWith('--')) { process.stderr.write(`${usage}\n`); process.exit(2); }
    options[flag.slice(2)] = resolve(value); index++;
  }
  const expected = guideData(await readFile(options.guide, 'utf8'));
  if (options.check) {
    const kept = await readFile(options.out, 'utf8').catch(() => '');
    if (kept.replace(/\r\n/g, '\n') !== expected) {
      process.stderr.write('guide-data.json is out of date with the guide. Run: node scripts/guide-index.mjs\n');
      process.exitCode = 1;
    } else process.stdout.write('guide-data.json matches the guide.\n');
  } else {
    await writeFile(options.out, expected);
    process.stdout.write(`${options.out}\n`);
  }
}
