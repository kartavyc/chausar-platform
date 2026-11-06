// D9: build bytes, from the entry HTML rather than a guessed hashed file name.
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({ options: {
  dist: { type: 'string', default: join(root, 'app/ui/dist') },
  baseline: { type: 'string', default: join(root, 'app/ui/tests/baselines/chunks.json') },
  json: { type: 'boolean' }, check: { type: 'boolean' },
} });
const dist = resolve(values.dist);
function attribute(tag, name) {
  return new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'i').exec(tag)?.[1];
}
async function asset(path) {
  const absolute = resolve(dist, path);
  const inside = relative(dist, absolute);
  if (inside.startsWith(`..${sep}`) || inside === '..') throw new Error(`Asset outside build: ${path}`);
  return { path: inside.split(sep).join('/'), bytes: (await stat(absolute)).size };
}
async function assetsAt(folder) {
  const files = [];
  for (const entry of await readdir(join(dist, folder), { withFileTypes: true })) {
    const path = `${folder}/${entry.name}`;
    if (entry.isDirectory()) files.push(...await assetsAt(path));
    else if (entry.isFile()) files.push(await asset(path));
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}
try {
  const html = await readFile(join(dist, 'index.html'), 'utf8');
  const tags = html.match(/<(?:script|link)\b[^>]*>/gi) ?? [];
  const script = tags.find(tag => /^<script\b/i.test(tag) && attribute(tag, 'type') === 'module');
  const style = tags.find(tag => /^<link\b/i.test(tag) && attribute(tag, 'rel') === 'stylesheet');
  const jsPath = script && attribute(script, 'src');
  const cssPath = style && attribute(style, 'href');
  if (!jsPath) throw new Error('Missing entry script in index.html');
  if (!cssPath) throw new Error('Missing entry stylesheet in index.html');
  const assets = await assetsAt('assets');
  const chunks = assets.filter(file => /\.m?js$/.test(file.path));
  const report = {
    entryJs: await asset(jsPath), entryCss: await asset(cssPath),
    largestChunk: chunks.reduce((largest, file) => file.bytes > largest.bytes ? file : largest),
    assets,
  };
  if (values.json) console.log(JSON.stringify(report, null, 2));
  else console.table(assets);
  if (values.check) {
    const budget = JSON.parse(await readFile(values.baseline, 'utf8'));
    for (const name of ['entryJs', 'entryCss', 'largestChunk']) {
      if (!Number.isSafeInteger(budget[name]) || budget[name] < 0) throw new Error(`Invalid ${name} budget`);
      if (report[name].bytes > budget[name]) {
        console.error(`${name} (${report[name].path}): ${report[name].bytes} exceeds ${budget[name]} bytes`);
        process.exitCode = 1;
      }
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
