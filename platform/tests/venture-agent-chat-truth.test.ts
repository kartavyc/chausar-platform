// What an agent may promise in chat (founder, 14 Nov 2026). In the first live run a hired agent said "I'll find and
// organize cafe and hotel prospects in Pune". An agent in chat reads the facts it is given and writes words; it cannot
// search. Finding customers is its own step, which the owner starts from Clients (or Chausar proposes on Today) and
// approves before it runs. The chat instructions now say what the agent can do itself and where the rest really starts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ANSWER_INSTRUCTIONS } from '../runtime/venture/agents/answer.ts';
import { CHIEF_KINDS } from '../runtime/venture/chief/gate.ts';

test('the chat instructions say an agent cannot search, and point at the real way to find customers', () => {
  for (const words of [
    /you work only from the facts given/, /cannot search the web/, /find customers/, /contact anyone/, /never say you will/,
    /the owner starts it from Clients, under Find customers/, /approves it before it runs/, /Chausar proposes it on Today/,
    /what you can do with the list once it is there/,
  ]) assert.match(ANSWER_INSTRUCTIONS, words);
  assert.doesNotMatch(ANSWER_INSTRUCTIONS, /—/);
});

// Found live on Windows, 15 Nov 2026 (D-3): an agent in chat said "I'll prepare subtitle drafts from your video files"
// on a computer with no transcription set up. In chat an agent is given file names only, never what a file holds.
test('the chat instructions say an agent sees file names only, and never promises work from what a file holds', () => {
  for (const words of [/only the names of files/, /cannot open, hear or watch one/, /never say you will make subtitles, a transcript or an edit from a file/, /starts as an order/]) assert.match(ANSWER_INSTRUCTIONS, words);
});

test('the path the instructions point at is real: Clients has that button, and the chief may propose that search', () => {
  const clients = JSON.parse(readFileSync(new URL('../../app/ui/src/text/en/clients.json', import.meta.url), 'utf8')) as Record<string, string>;
  assert.equal(clients['clients.find.open'], 'Find customers');
  assert.ok(CHIEF_KINDS.includes('find-customers' as never));
});
