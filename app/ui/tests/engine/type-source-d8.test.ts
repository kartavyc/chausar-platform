import { expect, it } from 'vitest';
import { typeDrift } from '../../../../scripts/type-drift.mjs';
import baseline from '../baselines/type-drift.json';
it('copied engine types can only leave the drift list', () => {
  const names = typeDrift().names;
  expect(names.filter(name => !baseline.includes(name))).toEqual([]);
});
