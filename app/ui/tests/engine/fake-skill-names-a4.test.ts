import { describe, expect, it } from 'vitest';
import { shortName } from '../../src/engine/fake-agent-extras';
import { agentSkills } from '../../../../platform/runtime/venture/agents/skills';

// One-shot A4 (hands-on row 54): the fake names a skill as the engine does: a long clause stops at a whole word.
describe('fake skill names', () => {
  it('match the engine on a long and a short clause', () => {
    for (const title of ["Read the client's message and files and pull out what is needed for the reply", 'Write the reply']) {
      expect(shortName(title)).toBe(agentSkills({ steps: [{ kind: 'work', title }] })[0]!.name);
    }
    expect(shortName("Read the client's message and files and pull out what is needed for the reply")).toBe("Read the client's message and files and pull out");
  });
});
