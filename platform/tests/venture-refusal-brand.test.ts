// A1 final check: every coded plain error a venture module throws is branded where it is thrown (refusal-brand.ts), so
// refusals.ts converts Chausar's own refusals and never a library's error of the same shape. New ones cannot slip in.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = new URL('../runtime/venture/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
/** Error classes whose code comes from outside Chausar (Codex's own replies), so they are never branded. */
const OUTSIDE = new Set(['agent-runtime/codex-rpc.ts']);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap(name => { const path = join(dir, name); return statSync(path).isDirectory() ? files(path) : name.endsWith('.ts') ? [path] : []; });
}

test('no unbranded coded plain error in the venture modules, playbooks and kit included', () => {
  const found: string[] = [];
  for (const path of files(ROOT)) {
    const name = relative(ROOT, path).split(sep).join('/');
    if (OUTSIDE.has(name)) continue;
    readFileSync(path, 'utf8').split('\n').forEach((line, index) => {
      const where = `${name}:${index + 1}`;
      if (/Object\.assign\(\s*new (?:Type|Range)?Error\(/.test(line)) found.push(`${where} Object.assign(new Error(...)) without refusalError`);
      if (/class \w+ extends Error/.test(line) && /\.code\s*=/.test(line) && !line.includes('markRefusal(')) found.push(`${where} a coded error class without markRefusal`);
      if (/\b(?:error|err|e|failure)\.code\s*=\s*['"A-Z]/.test(line)) found.push(`${where} a code set on a plain error`);
    });
  }
  assert.deepEqual(found, []);
});
