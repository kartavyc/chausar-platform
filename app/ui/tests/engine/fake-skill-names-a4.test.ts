import { describe, expect, it } from 'vitest';
import { shortName } from '../../src/engine/fake-agent-extras';

// One-shot A4 (hands-on row 54): the fake names a skill as the engine does (agents/skills.ts, held by
// platform/tests/venture-agent-skills-a4.test.ts with these same words): a long clause stops at a whole word.
describe('fake skill names', () => {
  it('stop at a whole word, never on a joining word, as the engine names them', () => {
    expect(shortName("Read the client's message and files and pull out what is needed for the reply")).toBe("Read the client's message and files and pull out");
    expect(shortName('Write the reply')).toBe('Write the reply');
  });
});
