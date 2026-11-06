import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { INITIAL_TEXT, PLACE_TEXT } from '../src/text/groups';

const root = resolve(import.meta.dirname, '../../..');
const en = resolve(import.meta.dirname, '../src/text/en');
const report = JSON.parse(execFileSync(process.execPath, [join(root, 'scripts/text-owners.mjs'), '--json'], { encoding: 'utf8' })) as {
  files: { file: string; group: string; owners: string[]; keys: string[] }[]; dynamicPrefixes: string[];
};
describe('D9 text groups', () => {
  it('puts every English and Hindi file in exactly one matching group', () => {
    const files = [...INITIAL_TEXT, ...Object.values(PLACE_TEXT).flat()];
    expect(new Set(files).size).toBe(files.length);
    expect([...files].sort()).toEqual(readdirSync(en).filter(file => file.endsWith('.json')).sort());
    expect([...files].sort()).toEqual(readdirSync(resolve(en, '../hi')).filter(file => file.endsWith('.json')).sort());
    expect(INITIAL_TEXT).toContain('common.json');
  });
  it('keeps shared literals, multiple-place components and every dynamic prefix initial', () => {
    for (const file of report.files) {
      const actual = INITIAL_TEXT.includes(file.file) ? 'initial' : Object.entries(PLACE_TEXT).find(([, files]) => files.includes(file.file))?.[0];
      expect(actual, `${file.file}: ${file.owners.join(', ')}`).toBe(file.group);
      if (file.keys.some(key => report.dynamicPrefixes.some(prefix => key.startsWith(prefix)))) expect(INITIAL_TEXT, file.file).toContain(file.file);
    }
  });
  it('the production eager glob excludes exactly the page groups', () => {
    const source = readFileSync(resolve(en, '../index.tsx'), 'utf8');
    const excluded = [...source.matchAll(/!\.\/en\/([^'"]+\.json)/g)].map(match => match[1]);
    expect(excluded.sort()).toEqual(Object.values(PLACE_TEXT).flat().sort());
  });
});
