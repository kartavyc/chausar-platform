// One-shot B1 (A3 notes line 51): a kept plan's one line, made by code from the offers the owner kept, so Today never
// shows the template's line ("A creative studio where an agent drafts briefs and notes, and you do the craft.").
import test from 'node:test';
import assert from 'node:assert/strict';
import { shownLine } from '../runtime/venture/core/shown-line.ts';

test('the offers in one sentence, later names lowered unless they start with an acronym', () => {
  assert.equal(shownLine(['Birthday party photography', 'Shop product photos', 'Monthly photo support']), 'Birthday party photography, shop product photos and monthly photo support.');
  assert.equal(shownLine(['Monthly books', 'GST returns']), 'Monthly books and GST returns.');
  assert.equal(shownLine(['Tuition.']), 'Tuition.');
});

test('it stays within the one line limit of 160 characters, dropping later offers first', () => {
  const long = (letter: string) => `${letter.toUpperCase()}${letter.repeat(59)}`;
  const line = shownLine([long('a'), long('b'), long('c')]);
  assert.ok(line.length <= 160, String(line.length));
  assert.equal(line, `${long('a')} and ${'b'.repeat(60)}.`);
});
