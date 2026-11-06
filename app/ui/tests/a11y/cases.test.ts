import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PLACES, SHEETS, OPENED, PHONE } from './cases';

describe('accessibility case coverage', () => {
  it('runs every case group exactly once across the four files', () => {
    const files = ['places', 'sheets', 'forms', 'phone'].map(name => readFileSync(join(import.meta.dirname, `${name}.test.tsx`), 'utf8'));
    for (const [group, cases] of Object.entries({ PLACES, SHEETS, OPENED, PHONE })) {
      expect(cases.length).toBeGreaterThan(0);
      expect(new Set(cases.map(one => one.name)).size).toBe(cases.length);
      const loops = files.flatMap(text => [...text.matchAll(new RegExp(`for \\(const \\w+ of ${group}\\)`, 'g'))]);
      expect(loops, group).toHaveLength(1);
    }
  });
});
