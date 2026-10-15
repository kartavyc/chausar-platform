import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { laneSubPlaces } from '../src/places/subplaces/index.ts';
import { laneWords } from '../src/text/lanes/index.ts';

const read = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as Record<string, string>;
const shared = { en: read('../src/text/en.json'), hi: read('../src/text/hi.json') };

test('every lane owns exactly one sub-place file and one words file, all listed', () => {
  const files = (dir: string) => readdirSync(new URL(dir, import.meta.url)).filter(name => name.endsWith('.ts') && !['index.ts', 'types.ts'].includes(name)).map(name => name.slice(0, -3)).sort();
  assert.deepEqual(Object.keys(laneSubPlaces).sort(), files('../src/places/subplaces/'));
  assert.deepEqual(Object.keys(laneWords).sort(), files('../src/text/lanes/'));
  assert.deepEqual(Object.keys(laneSubPlaces).sort(), Object.keys(laneWords).sort());
});

test('lane words never repeat a shared key or another lane key, and Hindi has every English key', () => {
  const owner = new Map<string, string>();
  for (const [lane, words] of Object.entries(laneWords)) {
    assert.deepEqual(Object.keys(words.hi).sort(), Object.keys(words.en).sort(), `${lane}: English and Hindi keys must match`);
    for (const key of Object.keys(words.en)) {
      assert.equal(key in shared.en, false, `${lane}: ${key} is already in text/en.json`);
      assert.equal(owner.has(key), false, `${lane}: ${key} is also in ${owner.get(key)}`);
      owner.set(key, lane);
      assert.ok(words.en[key]!.trim() && words.hi[key]!.trim(), `${lane}: ${key} needs words in both languages`);
    }
  }
});

test('lane sub-places are new, unique and named by their own lane', () => {
  const seen = new Set<string>();
  for (const [lane, subs] of Object.entries(laneSubPlaces)) {
    for (const sub of subs) {
      assert.match(sub.id, /^[a-z][a-z0-9-]{0,31}$/, `${lane}: sub-place id`);
      const key = `SH-01.sub.${sub.place}.${sub.id}`;
      assert.equal(key in shared.en, false, `${lane}: ${sub.place}/${sub.id} is an authored sub-place`);
      for (const shell of sub.shells ?? ['desktop']) {
        assert.equal(seen.has(`${shell}:${key}`), false, `${lane}: ${sub.place}/${sub.id} is added twice`);
        seen.add(`${shell}:${key}`);
      }
      assert.ok(laneWords[lane]!.en[key] && laneWords[lane]!.hi[key], `${lane}: name ${key} belongs in text/lanes/${lane}.ts`);
    }
  }
});

