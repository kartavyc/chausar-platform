// One-shot A4 (hands-on row 54, bug 5): a skill's short name was its first clause cut at 59 characters with a full stop
// added ("pull out what is ne."). A long name now stops at the last whole word that fits, never on a joining word, and
// the try-it starter asks about the whole clause.
import test from 'node:test';
import assert from 'node:assert/strict';
import { agentSkills } from '../runtime/venture/agents/skills.ts';

const TITLE = "Read the client's message and files and pull out what is needed for the reply";

test('a long skill name ends on a whole word, and the starter keeps the whole clause', () => {
  const [skill] = agentSkills({ steps: [{ kind: 'gather', title: TITLE }] });
  assert.ok(skill!.name.length <= 60, skill!.name);
  assert.ok(TITLE.startsWith(skill!.name), skill!.name);
  assert.doesNotMatch(skill!.name, /\.$/);
  assert.doesNotMatch(skill!.name, /\b(?:and|or|the|a|an|to|of|for|what|is|with|in)$/i);
  assert.equal(skill!.name, "Read the client's message and files and pull out");
  assert.equal(skill!.line, `${TITLE}.`);
  assert.equal(skill!.starter, "What do you need from me before you read the client's message and files and pull out what is needed for the reply?");
  // A short title is unchanged.
  const [short] = agentSkills({ steps: [{ kind: 'work', title: 'Write the reply, in your voice' }] });
  assert.deepEqual([short!.name, short!.starter], ['Write the reply', 'How would you write the reply for my next order?']);
});
