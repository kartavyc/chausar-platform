import { expect, it } from 'vitest';
import { deskReady } from '../../src/places/work/PlaybookDesk';
it('the implemented social tools are reachable from the Work desk registry', () => {
  expect(deskReady('social-agency')).toBe(true);
});
