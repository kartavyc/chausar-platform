// A4 review (M2): the chief's claims of action, sentence by sentence. Its read tools never act; only a brief to an agent
// is carried out in its turn, by code, which says so in its own line. So the model's own words may not claim an action:
// first-person ("I", "I've", "I have") and subject-less leads ("Done,", "Sent it"), and passive claims about outward
// actions ("has been sent"). Business history ("we issued"), quoted words and reasoning ("I made an estimate") stay.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTION_OFFER, PROPOSED_OFFER, withoutActionClaims } from '../runtime/venture/chief/answer.ts';
import type { ChatPart } from '../runtime/venture/contracts.ts';

const text = (words: string): ChatPart => ({ kind: 'text', text: words });
const check = (parts: ChatPart[], proposals = 0) => withoutActionClaims(parts, { proposals });

test('A4 review: what is not a claim stays exactly as written', () => {
  for (const [words, proposals] of [
    ['Priya wrote: "We sent the files yesterday."', 0],
    ['We issued INV-0001 to Priya on 3 Nov.', 0],
    ['Last month we started offering product shoots.', 0],
    ["I've drafted a reminder for Priya below for you to approve.", 1],
    ['I have prepared a quote below for you to approve.', 1],
    ['I made a rough estimate of the hours.', 0],
    ['If I sent it now, it would reach her before the weekend.', 0],
    ['I can send it once you approve.', 0],
    ['I checked your books: nothing is due.', 0],
    ['Your books show the invoice was paid on 2 Nov.', 0],
  ] as const) {
    assert.deepEqual(check([text(words)], proposals), [text(words)], words);
  }
});

test('A4 review: first-person, subject-less and passive claims of an action are taken out', () => {
  for (const words of [
    "I've noted that.",
    'Done, the invoice is sent.',
    'Sent it to Priya.',
    'Booked it for Monday.',
    'The invoice has been sent to Priya.',
    'The payment has been filed.',
    'The reminder is sent.',
    "I've told Priya the shoot is on Monday.",
    "I've confirmed the booking with Priya.",
    "I've let Priya know.",
    "I've followed up with Priya.",
    'Your reminder is on its way to Priya.',
    "I've drafted a reminder for Priya.",
    'I emailed the client the plan.',
  ]) {
    assert.deepEqual(check([text(words)]), [text(ACTION_OFFER)], words);
  }
});

test('A4 review: with a proposal card the offer says it is proposed below; without one, the plain offer', () => {
  assert.deepEqual(check([text("I've emailed Priya the reminder.")], 1), [text(PROPOSED_OFFER)]);
  assert.equal(PROPOSED_OFFER, "It's proposed below for you to approve.");
  assert.deepEqual(check([text("I've emailed Priya the reminder.")], 0), [text(ACTION_OFFER)]);
});

test('A4 review: a sentence taken out takes its figure parts with it; the rest stays whole', () => {
  const figure: ChatPart = { kind: 'figure', receiptId: 'r1', key: 'total', display: 'INR 5,000.00' };
  assert.deepEqual(check([text("I've invoiced Priya for "), figure, text('.')]), [text(ACTION_OFFER)]);
  assert.deepEqual(check([text('Priya owes '), figure, text(". I've emailed her the invoice. It is due on 10 Nov.")]),
    [text('Priya owes '), figure, text('. It is due on 10 Nov.'), text(ACTION_OFFER)]);
});
