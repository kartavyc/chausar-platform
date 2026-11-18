import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { CATALOGUES, format } from '../src/text';
import { deptKey } from '../src/text/dept';
import { DEPT_IDS } from '../src/parts/icons';
import { TEAM_DEPARTMENTS } from '../../../platform/runtime/venture/agents/team-proposal';
import hindi from '../src/text/hi/common.json';

/**
 * Seen on Windows (15 Nov 2026): the team card of step 2 showed "dept.operations", "dept.marketing" and
 * "dept.production". The engine names departments in full (sales, marketing, production, money, operations); the text
 * keys are the screens' short ids (dept.mkt, dept.prod, dept.ops). One mapping now turns either id into its key, and no
 * screen builds a department key any other way.
 */
const SRC = join(__dirname, '..', 'src');
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('department names', () => {
  it('every department id, the engine\'s and the screens\', reaches the screen as words in English and Hindi', () => {
    const pack = hindi as unknown as Record<string, string>;
    for (const id of [...TEAM_DEPARTMENTS, ...DEPT_IDS]) {
      const key = deptKey(id);
      const english = format(CATALOGUES.en, 'en', key);
      expect(english, id).not.toBe(key);
      expect(english, id).not.toMatch(/^dept\./);
      expect(typeof pack[key], `${id} in Hindi`).toBe('string');
      expect(pack[key], id).not.toMatch(/dept\./);
    }
    // The two ids of one department read the same.
    expect(deptKey('marketing')).toBe(deptKey('mkt'));
    expect(deptKey('production')).toBe(deptKey('prod'));
    expect(deptKey('operations')).toBe(deptKey('ops'));
    // An id nobody knows is never shown as a key either.
    expect(format(CATALOGUES.en, 'en', deptKey('shipping'))).toBe('Operations');
  });

  it('no screen builds a department key from an id by itself', () => {
    const built = files(SRC).filter((path) => !path.endsWith(join('text', 'dept.ts')) && /[`'"]dept\.\$\{|['"]dept\.['"]\s*\+/.test(readFileSync(path, 'utf8')));
    expect(built.map((path) => path.slice(SRC.length + 1))).toEqual([]);
  });
});
