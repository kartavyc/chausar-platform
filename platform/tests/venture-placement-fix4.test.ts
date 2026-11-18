// Fix round 4 (the real-app tour of 16 Nov 2026, problem 9, and the sample-data tour's item 4): how an idea is placed.
// The engine picks a playbook from the owner's own words: the longest registered phrase found in them. A home baker who
// wanted "regular orders from offices and event planners" was set up as a booking desk, because "event planner" is a
// booking desk phrase and her customers are event planners. A phrase that names a trade now picks only where it names
// the owner's own work. No playbook fits a maker of goods to order, so she gets the plain plan: no desk, the one
// delivery agent, the eight fixed steps. The pick and the classifier are one pure function the app's fake engine shares.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PLAYBOOK_REGISTRY, pickPlaybook } from '../runtime/venture/playbooks/registry.ts';
import { classifyIdea } from '../runtime/venture/core/service-types.ts';
import { classifiedBy, pickedBy } from '../runtime/venture/core/service-keywords.ts';
import { familyIdea, keywordFamily } from '../runtime/venture/core/family-plan.ts';
import { orderAgentsFor } from '../runtime/venture/agents/order-agents.ts';
import { OWN_ORDER_JOB } from '../runtime/venture/agents/order-agents-core.ts';
import { WAYS } from '../runtime/venture/playbooks/ways.ts';

const BAKER = 'I bake custom cakes and cupcakes from my home kitchen in Indore and want regular orders from offices and event planners.';
const RECRUITER = 'I run a recruitment agency for small businesses in Pune.';
const picked = (idea: string) => pickPlaybook(idea)?.id ?? null;

test('a trade named as the customer does not pick that trade\'s playbook', () => {
  assert.equal(picked(BAKER), null);
  const sold: [string, string | null][] = [
    ['I design websites for wedding planners', null],
    ['I make reels for busy chartered accountants', null],
    ['I supply fresh bread to home chefs and beauty salons', null],
    ['I print invitation cards. My customers are event planners, hotels and wedding planners.', null],
    ['I do bookkeeping for a beauty salon and a law practice', null],
    ['I sell packaging to cafes, cloud kitchens and home chefs', null],
    ['Photo shoots for social media managers and other local advocates', null],
    // Another phrase in the same words still picks.
    ['I build websites for recruitment agencies', 'website-studio'],
    ['Hindi subtitles for social media agencies', 'translation-studio'],
  ];
  for (const [idea, id] of sold) assert.equal(picked(idea), id, idea);
});

test('the owner\'s own trade still picks, however the sentence is built', () => {
  const own: [string, string][] = [
    ['I am a wedding planner in Pune', 'booking-desk'],
    ['I run a home salon and take bookings by WhatsApp', 'booking-desk'],
    ['Home chef: party orders for offices and event planners', 'booking-desk'],
    ['I want to start as an event planner for small companies', 'booking-desk'],
    ['Reminders and slots for my beauty salon', 'booking-desk'],
    ['I am a chartered accountant and I work for small traders', 'ca-firm'],
    ['A CA practice: books, GST and income tax working papers for small businesses.', 'ca-firm'],
    [RECRUITER, 'recruiting-desk'],
    ['We are a social media agency for cafes', 'social-agency'],
    ['Advocate in Indore, mostly property matters', 'signoff-desk'],
    // A phrase that names a thing, or the playbook's own client, picks wherever it stands.
    ['I write bid responses for a government tender', 'tender-desk'],
    ['Tax packs and a trade journal for stock traders', 'trading-journal'],
    ['I narrate stories for an audiobook', 'narration-studio'],
    ['Shorts for a YouTube channel', 'youtube'],
  ];
  for (const [idea, id] of own) assert.equal(picked(idea), id, idea);
});

test('every way\'s own starter and every registered phrase alone still pick their playbook', () => {
  for (const way of WAYS) assert.equal(picked(way.en.starter), way.playbook, way.en.starter);
  for (const entry of PLAYBOOK_REGISTRY) for (const phrase of entry.picks) assert.equal(pickedBy(phrase, [entry])?.id, entry.id, phrase);
});

test('a maker of goods to order gets the plain plan: no playbook, the one delivery agent, no other trade\'s words', () => {
  assert.equal(classifyIdea(BAKER), 'other');
  const order = orderAgentsFor(BAKER);
  assert.equal(order.flagship, false);
  assert.deepEqual(order.agents, [{ name: 'Delivery agent', does: OWN_ORDER_JOB }]);
  assert.ok(!/slot|book|visit|deposit/i.test(JSON.stringify(order)));
});

test('with no AI, the field guess reads a trade the same way: the baker\'s customers do not make her a local service', () => {
  assert.equal(keywordFamily(BAKER), null, 'no field: the owner\'s words are the idea, and the plain plan serves them');
  assert.equal(keywordFamily('I am an event planner in Pune'), 'local-services');
  assert.equal(keywordFamily('I run a tiffin service for offices and event planners'), 'local-services');
});

test('with no AI, a recruiter\'s own words place the business on the recruiting desk, not the job seekers\' desk', () => {
  const family = keywordFamily(RECRUITER);
  assert.equal(family, 'people');
  const idea = familyIdea(family!, RECRUITER);
  assert.equal(idea, RECRUITER, 'the owner\'s words plan as the field\'s own type, so no lead sentence is put before them');
  assert.equal(picked(idea), 'recruiting-desk');
  assert.equal(classifyIdea(RECRUITER), 'consulting');
});

test('the fake engine\'s copy of the registry carries what the shared pick and classifier read', () => {
  const fixture = JSON.parse(readFileSync(new URL('../../app/ui/src/engine/fixtures-playbook-picks.json', import.meta.url), 'utf8'));
  assert.deepEqual(fixture, PLAYBOOK_REGISTRY.map(({ id, serviceType, picks }) => ({ id, serviceType, picks })));
  for (const idea of [BAKER, RECRUITER, 'I am a wedding planner in Pune', 'A newsletter for founders', 'I fix laptops']) {
    assert.equal(pickedBy(idea, fixture)?.id ?? null, picked(idea), idea);
    assert.equal(classifiedBy(idea, fixture), classifyIdea(idea), idea);
  }
});
