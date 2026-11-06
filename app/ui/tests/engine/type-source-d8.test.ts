import { expect, it } from 'vitest';
import { typeDrift } from '../../../../scripts/type-drift.mjs';
import baseline from '../baselines/type-drift.json';
it('copied engine types can only leave the drift list', () => {
  const result = typeDrift();
  expect(result.engine).toBeGreaterThan(800);
  const names = result.names;
  expect(names.filter(name => !new Set<string>(baseline).has(name))).toEqual([]);
});
