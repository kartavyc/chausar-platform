// D7: rules that keep the engine bundleable. A bundler follows static imports and plain require() calls. The engine
// keeps a few lazy loads of its own files (createRequire(import.meta.url)('./x.ts')) because a static import would
// change the order its modules are set up in; the bundle rewrites each into require('./x.ts')
// (scripts/engine-lazy-require.mjs), so every such load must be in a form that rewrite understands. Packages loaded by
// name stay allowed. Engine files found by path go through engine-paths.ts (task 3), so the bundle can carry them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const RUNTIME = fileURLToPath(new URL('../runtime/', import.meta.url));
const lazyPath = '../../scripts/engine-lazy-require.mjs';
const { rewriteLazyLoads } = await import(lazyPath);

async function sources(folder = RUNTIME): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) found.push(...await sources(path));
    else if (/\.(?:ts|mts|cts|mjs|cjs|js)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) found.push(path);
  }
  return found;
}
const named = (path: string) => relative(RUNTIME, path).replace(/\\/g, '/');

/** Every call of a createRequire result with a relative path, by file and line. */
export function relativeRequires(text: string): { line: number; target: string }[] {
  const found: { line: number; target: string }[] = [];
  const loaders = new Set<string>();
  for (const match of text.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*createRequire\(/g)) loaders.add(match[1]);
  const calls = [
    ...[...loaders].flatMap(name => [...text.matchAll(new RegExp(String.raw`\b${name}\(\s*(['"\x60])(\.{1,2}/[^'"\x60]*)\1`, 'g'))]),
    ...text.matchAll(/createRequire\([^)]*\)\(\s*(['"`])(\.{1,2}\/[^'"`]*)\1/g),
  ];
  for (const match of calls) found.push({ line: text.slice(0, match.index).split('\n').length, target: match[2] });
  return found.sort((a, b) => a.line - b.line);
}

test('the scan finds a relative createRequire load in each form the engine used, and passes a package by name', () => {
  assert.deepEqual(relativeRequires("const load = createRequire(import.meta.url);\nfunction f() { return load('./x.ts').f(); }"), [{ line: 2, target: './x.ts' }]);
  assert.deepEqual(relativeRequires("const load=createRequire(import.meta.url);const g=()=>(load('../y.ts') as any).g;"), [{ line: 1, target: '../y.ts' }]);
  assert.deepEqual(relativeRequires("x ??= (createRequire(import.meta.url)('../definitions.ts') as any).D;"), [{ line: 1, target: '../definitions.ts' }]);
  assert.deepEqual(relativeRequires("const require = createRequire(import.meta.url);\nconst p = require('playwright');\nrequire.resolve('lintapple');"), []);
});

test('every lazy load of an engine file is one the bundle rewrites into require()', async () => {
  const left: string[] = [], rewritten: string[] = [];
  for (const file of await sources()) {
    const text = await readFile(file, 'utf8');
    if (!text.includes('createRequire')) continue;
    const before = relativeRequires(text);
    const { code, count } = rewriteLazyLoads(text);
    for (const hit of relativeRequires(code)) left.push(`${named(file)}:${hit.line} ${hit.target}`);
    if (before.length) rewritten.push(`${named(file)} ${count}`);
    assert.equal(count, before.length, named(file));
  }
  assert.deepEqual(left, []);
  // The eight files the plan found, eleven calls naming twelve targets; a new one shows up here by name.
  assert.deepEqual(rewritten.sort(), [
    'venture/delivery/harness/tools-bookkeeping-cfo.ts 4', 'venture/delivery/harness/tools-newsletter-studio.ts 1',
    'venture/delivery/harness/tools-podcast-to-article.ts 1', 'venture/delivery/harness/tools-recruiting-desk.ts 1',
    'venture/delivery/harness/tools-website-studio.ts 1', 'venture/playbooks/kit/define.ts 3', 'venture/playbooks/kit/installed.ts 1',
  ]);
});

test('the rewrite turns each lazy form into require() and leaves packages by name alone', () => {
  const { code, count } = rewriteLazyLoads([
    "const load = createRequire(import.meta.url);", "const a = () => load('./x.ts').f();", "const b = () => (load('../y.ts') as typeof import('../y.ts')).g;",
    "const c = createRequire(import.meta.url)('../z.ts');", "const req = createRequire(import.meta.url);", "const d = req('playwright');", "const e = upload('./not-a-load.ts');",
  ].join('\n'));
  assert.equal(count, 3);
  assert.match(code, /require\('\.\/x\.ts'\)\.f\(\)/);
  assert.match(code, /\(require\('\.\.\/y\.ts'\) as typeof import\('\.\.\/y\.ts'\)\)\.g/);
  assert.match(code, /const c = require\('\.\.\/z\.ts'\);/);
  assert.match(code, /req\('playwright'\)/);
  assert.match(code, /upload\('\.\/not-a-load\.ts'\)/);
});
