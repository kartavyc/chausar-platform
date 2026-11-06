// D9: conservative text ownership. A shared component's keys count for every place that imports it.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const slash = value => value.split(sep).join('/');
const walk = path => readdirSync(path).flatMap(name => { const next = join(path, name); return statSync(next).isDirectory() ? walk(next) : [next]; });
export function textOwners(root = join(repo, 'app/ui/src')) {
  root = resolve(root);
  const catalogues = readdirSync(join(root, 'text/en')).filter(file => file.endsWith('.json')).sort().map(file => {
    const text = readFileSync(join(root, 'text/en', file), 'utf8');
    return { file, bytes: Buffer.byteLength(text), keys: Object.keys(JSON.parse(text)) };
  });
  const keyFile = new Map(catalogues.flatMap(file => file.keys.map(key => [key, file.file])));
  const knownKeys = [...keyFile.keys()];
  const sources = new Map(walk(root).filter(path => /\.tsx?$/.test(path)).map(path => [path, readFileSync(path, 'utf8')]));
  const imports = new Map();
  const owners = new Map();
  for (const [path, text] of sources) {
    const part = slash(relative(root, path)).split('/');
    owners.set(path, new Set(part[0] === 'places' ? [part[1]] : ['shared']));
    const targets = [];
    for (const match of text.matchAll(/(?:from\s*|import\s*(?:\(\s*)?)["'](\.[^"']+)["']/g)) {
      const base = resolve(dirname(path), match[1]);
      const target = [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')].find(candidate => sources.has(candidate));
      if (target) targets.push(target);
    }
    imports.set(path, targets);
  }
  // Propagate only place roots. The central loader necessarily mentions every page, but doesn't render their words.
  for (const path of sources.keys()) {
    const place = slash(relative(root, path)).match(/^places\/([^/]+)\//)?.[1];
    if (!place) continue;
    const seen = new Set();
    const visit = next => {
      if (seen.has(next)) return;
      seen.add(next);
      owners.get(next).add(place);
      for (const target of imports.get(next) ?? []) visit(target);
    };
    visit(path);
  }
  const consumers = new Map(catalogues.map(file => [file.file, new Set()]));
  const dynamicPrefixes = new Set();
  for (const [path, text] of sources) {
    for (const match of text.matchAll(/["']([a-z0-9][\w.-]*)["']/g)) {
      const key = match[1], file = keyFile.get(key);
      if (file) for (const owner of owners.get(path)) consumers.get(file).add(owner);
      if (key.endsWith('.') && knownKeys.some(item => item.startsWith(key))) dynamicPrefixes.add(key);
    }
    for (const match of text.matchAll(/`([a-z0-9][\w.-]*)\$\{/g)) {
      if (knownKeys.some(key => key.startsWith(match[1]))) dynamicPrefixes.add(match[1]);
    }
  }
  return {
    dynamicPrefixes: [...dynamicPrefixes].sort(),
    files: catalogues.map(file => {
      const used = [...consumers.get(file.file)].sort();
      const dynamic = file.keys.some(key => [...dynamicPrefixes].some(prefix => key.startsWith(prefix)));
      const group = file.file !== 'common.json' && !dynamic && used.length === 1 && used[0] !== 'shared' ? used[0] : 'initial';
      return { ...file, owners: used, group, reason: file.file === 'common.json' ? 'common' : dynamic ? 'dynamic prefix' : !used.length ? 'unattributed' : used.includes('shared') ? 'shared UI' : used.length > 1 ? 'multiple places' : 'one place' };
    }),
  };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { root: { type: 'string' }, json: { type: 'boolean' } } });
  const report = textOwners(values.root);
  if (values.json) console.log(JSON.stringify(report, null, 2));
  else console.table(report.files.map(({ keys, owners, ...file }) => ({ ...file, keys: keys.length, owners: owners.join(', ') })));
}
