// One-shot B1 (A3 notes line 51): a kept plan's one line, made by code from the offers the owner kept, so Today never
// shows the template's line ("A creative studio where an agent drafts briefs and notes, and you do the craft.").
import test from 'node:test';
import assert from 'node:assert/strict';
import { shownLine } from '../runtime/venture/core/shown-line.ts';

test('the offers in one sentence, each name as written', () => {
  assert.equal(shownLine(['Birthday party photography', 'Shop product photos', 'Monthly photo support']), 'Birthday party photography, Shop product photos and Monthly photo support.');
  assert.equal(shownLine(['Monthly books', 'GST returns']), 'Monthly books and GST returns.');
  assert.equal(shownLine(['Tuition.']), 'Tuition.');
});

test('it stays within the one line limit of 160 characters, dropping later offers first', () => {
  const long = (letter: string) => `${letter.toUpperCase()}${letter.repeat(59)}`;
  const line = shownLine([long('a'), long('b'), long('c')]);
  assert.ok(line.length <= 160, String(line.length));
  assert.equal(line, `${long('a')} and ${long('b')}.`);
});

// B1 fix round 1 (quality 6): names stay as the owner kept them (a brand is never lowered), a too-long name is cut at a
// word, and no offers make no line.
test('names stay as written, a long name is cut at a word, and nothing makes no line', () => {
  assert.equal(shownLine(['Logo design', 'Shopify store setup']), 'Logo design and Shopify store setup.');
  assert.equal(shownLine(['Wedding photos', 'iPhone repair']), 'Wedding photos and iPhone repair.');
  const words = Array.from({ length: 40 }, (_, index) => `word${index}`).join(' ');
  const cut = shownLine([words]);
  assert.ok(cut.length <= 160, String(cut.length));
  assert.match(cut, /^word0 word1 .* word\d+\.$/, cut);
  assert.equal(words.startsWith(cut.slice(0, -1)), true, 'cut at a whole word');
  assert.equal(shownLine([]), '');
  assert.equal(shownLine(['  ', '']), '');
});
