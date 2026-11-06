import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { READS } from '../../src/engine/reads';
import { RENDERER_METHOD_NAMES } from '../../src/engine/methods.gen';
import { METHOD_LEVEL_OF } from '../../../../platform/runtime/venture/method-hints';

const renderer = new Set<string>(RENDERER_METHOD_NAMES);
describe('derived method lists', () => {
  it('every UI read is permitted and every venture read has engine read authority', () => {
    for (const name of READS) {
      expect(renderer.has(name), name).toBe(true);
      if (name.startsWith('venture.')) expect(METHOD_LEVEL_OF[name as keyof typeof METHOD_LEVEL_OF], name).toBe('read');
    }
  });
  it('every literal fake method list stays inside the renderer contract', () => {
    const directory = new URL('../../src/engine/', import.meta.url);
    let lists = 0;
    for (const file of readdirSync(directory).filter(name => /^fake.*\.ts$/.test(name))) {
      const text = readFileSync(new URL(file, directory), 'utf8');
      for (const list of text.matchAll(/export const \w*METHODS[^=]*=\s*(?:new Set\()?\[([\s\S]*?)\]/g)) {
        lists++;
        for (const item of list[1]!.matchAll(/['"]([^'"]+)['"]/g)) expect(renderer.has(item[1]!), `${file}: ${item[1]}`).toBe(true);
      }
    }
    expect(lists).toBeGreaterThan(20);
  });
});
