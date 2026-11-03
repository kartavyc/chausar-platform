// One-shot A1 (row 5): every text key the UI builds exists, so a raw key like business.practice.inUse.owner never
// shows. Static keys, t('a.b'), must be in the English catalogue. A key built from a value, t(`a.b.${x}`), must have at
// least one key under its prefix, and the families built from an engine list have a key for every value in it.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { CATALOGUES } from '../src/text';
import { PLAYBOOK_ORIGINS } from '../src/engine/types';

const SRC = join(import.meta.dirname, '../src');
const keys = new Set(Object.keys(CATALOGUES.en));

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'engine' || name === 'text' ? [] : sources(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

const files = sources(SRC).map((path) => ({ path: relative(SRC, path), text: readFileSync(path, 'utf8') }));
const STATIC = /\bt\(\s*'([a-z0-9][\w.-]*)'/g;
const DYNAMIC = /\bt\(\s*`([a-z0-9][\w.-]*)\$\{/g;
/** t('pb-books.' + code) builds a key too: a static text ending in a dot is a prefix. */
const known = (key: string) => (key.endsWith('.') ? [...keys].some((item) => item.startsWith(key)) : keys.has(key));

describe('every text key the UI builds exists', () => {
  it('each static key is in the English catalogue', () => {
    const missing = files.flatMap(({ path, text }) => [...text.matchAll(STATIC)].map((m) => m[1]!).filter((key) => !known(key)).map((key) => `${path}: ${key}`));
    expect(missing).toEqual([]);
  });
  it('each key built from a value has keys under its prefix', () => {
    const missing = files.flatMap(({ path, text }) => [...text.matchAll(DYNAMIC)].map((m) => m[1]!).filter((prefix) => ![...keys].some((key) => key.startsWith(prefix))).map((prefix) => `${path}: ${prefix}`));
    expect(missing).toEqual([]);
  });
  it('the version in use has words for every origin the engine sends', () => {
    expect(PLAYBOOK_ORIGINS).toEqual(['plan', 'improvement', 'owner']);
    for (const origin of PLAYBOOK_ORIGINS) expect(keys.has(`business.practice.inUse.${origin}`), origin).toBe(true);
  });
});
