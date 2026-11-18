// Round 7 (re-check 6, item 5): with Hindi on, Chausar's own words still showed in English: every Earlier line, the kind
// of place inside a search's title ("company offices"), Work's "Practice draft for ...", the run sheet's steps ("Do the
// hands-on work", "Draft the reply for review"), the run's model receipt ("Main model · ... tokens in, ... out · On your
// plan"), the evidence ("Price receipt", "Passed: ..."), and Team's "Idle" and "On your own AI plan". Each is now said
// from the pack (views/run-words.ts, plan-words.ts); a name, a model, a count and what the AI wrote stay as written.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CATALOGUES, say, type Catalogue, type Message } from '../src/text';
import { fixedWords, KIND_WORD_KEYS, ACTION_WORD_KEYS, PLAN_WORD_KEYS } from '../src/places/today/plan-words';
import { RECEIPT_WORDS, RUN_FIXED_WORDS, RUN_TEMPLATE_WORDS, SERVICE_STEPS } from '../../../platform/runtime/venture/views/run-words';
import { CARD_TEMPLATE_WORDS, fillWords } from '../../../platform/runtime/venture/views/card-words';
import { FIND_TITLE_WORDS, PLACE_KINDS, kindWords } from '../../../platform/runtime/venture/customers/find-brief';
import { ACTION_WORDS, DECISION_WORDS } from '../../../platform/runtime/venture/journal/decision-words';
import { DELIVERY_JOB } from '../../../platform/runtime/venture/agents/order-agents-core';

const TEXT = join(import.meta.dirname, '../src/text');
const HI: Catalogue = (() => {
  const out: Record<string, Message> = {};
  for (const file of readdirSync(join(TEXT, 'hi'))) Object.assign(out, JSON.parse(readFileSync(join(TEXT, 'hi', file), 'utf8')));
  return out;
})();
const hiT = (key: string, values?: Record<string, string | number>) => say(CATALOGUES.en, HI, 'hi', key, values as Record<string, string>);
const enT = (key: string, values?: Record<string, string | number>) => say(CATALOGUES.en, null, 'en', key, values as Record<string, string>);
const ENGLISH = /\b(?:You|chose|decided|Passed|Price|receipt|tokens|Main|model|plan|Idle|Draft|Practice|company|offices|hands-on)\b/;

describe('round 7: the rest of Chausar\'s own words in Hindi', () => {
  it('the English pack says every new word exactly as code writes it, and Hindi has each one with the same {names}', () => {
    for (const words of [...Object.values(RUN_FIXED_WORDS), RECEIPT_WORDS.job, RECEIPT_WORDS.plan, RECEIPT_WORDS.tier.main, ...SERVICE_STEPS]) expect(PLAN_WORD_KEYS.has(words), words).toBe(true);
    for (const [words, key] of [...KIND_WORD_KEYS, ...ACTION_WORD_KEYS]) {
      expect(CATALOGUES.en[key], key).toBe(words);
      expect(typeof HI[key], key).toBe('string');
    }
    expect(KIND_WORD_KEYS.size).toBe(PLACE_KINDS.length);
    expect(ACTION_WORD_KEYS.size).toBe(Object.keys(ACTION_WORDS).length);
    const names = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const [name, template] of Object.entries(RUN_TEMPLATE_WORDS)) {
      expect(CATALOGUES.en[`today.r7.t.${name}`], name).toBe(template);
      expect(names(HI[`today.r7.t.${name}`] as string), name).toEqual(names(template));
    }
    // The decision frames are the engine's own (journal/decision-words.ts), with "You".
    expect(DECISION_WORDS.owner('{reason}')).toBe(RUN_TEMPLATE_WORDS.decidedOwner);
    expect(DECISION_WORDS.plan('{action}', '{reason}')).toBe(RUN_TEMPLATE_WORDS.chosePlan);
    expect(DECISION_WORDS.today('{action}', '{reason}')).toBe(RUN_TEMPLATE_WORDS.choseToday);
  });

  it('each line seen in re-check 6 reads in Hindi; the client, the model, the counts and the place keep their names', () => {
    const words = fixedWords(hiT);
    const client = 'Asha Verma (made-up office)';
    const seen = [
      'You chose Approve: Plan accepted.',
      'You decided: You do not charge GST.',
      'You decided: Price of Custom cakes set to ₹1,200 a piece.',
      fillWords(FIND_TITLE_WORDS.map, { kind: kindWords('office=company'), place: 'Indore' }),
      fillWords(CARD_TEMPLATE_WORDS.practiceDraft, { client }),
      'Do the hands-on work', 'Draft the reply for review',
      RECEIPT_WORDS.job, fillWords(RUN_TEMPLATE_WORDS.usage, { input: '80,531', output: '787' }), RECEIPT_WORDS.plan,
      RUN_FIXED_WORDS.priceReceipt, 'Passed: Every price in the draft opens a receipt.',
      RUN_FIXED_WORDS.idle, RUN_FIXED_WORDS.ownPlan,
    ];
    const said = seen.map(words);
    said.forEach((line, index) => expect(line, seen[index]).not.toBe(seen[index]));
    expect(said[0]).toBe(hiT('today.r7.t.chosePlan', { action: hiT('today.earlier.action.approve'), reason: hiT('today.fixed.planAccepted') }));
    expect(said[3]).toBe(hiT('today.search.title.map', { kind: 'कंपनियों के ऑफ़िस', place: 'Indore' }));
    expect(said[4]).toContain(client);
    expect(said[8]).toBe('80,531 टोकन अंदर, 787 बाहर');
    for (const line of said.filter((_, i) => ![2, 4, 11].includes(i))) expect(line, line).not.toMatch(ENGLISH);
    // A value Chausar did not write stays as written: the item's name, and a check's own detail it has no line for.
    expect(said[2]).toContain('Custom cakes');
    expect(said[11]).toContain('Every price in the draft opens a receipt.');
  });

  it('a check whose detail has more than one sentence still reads its outcome word in Hindi (re-check 7)', () => {
    const words = fixedWords(hiT);
    for (const detail of [
      'Numbers in the words are model estimates with no receipt. Every price comes from a receipt.',
      'Nothing was sent anywhere. In this build every outside effect is only recorded, never carried out.',
    ]) {
      expect(words(`Passed: ${detail}`)).toBe(hiT('today.r7.t.checkPass', { detail }));
      expect(words(`Failed: ${detail}`)).toBe(hiT('today.r7.t.checkFail', { detail }));
    }
  });

  it('the Delivery agent\'s job line is Chausar\'s own words and reads in Hindi; a hired agent\'s role stays as written (re-check 7)', () => {
    expect(fixedWords(hiT)(DELIVERY_JOB)).toBe(hiT('today.r7.deliveryJob'));
    expect(fixedWords(hiT)(DELIVERY_JOB)).not.toMatch(/order|tools|reply/);
    expect(fixedWords(enT)(DELIVERY_JOB)).toBe(DELIVERY_JOB);
    expect(fixedWords(hiT)('Writes Instagram captions for the cake photos.')).toBe('Writes Instagram captions for the cake photos.');
  });

  it('in English every line reads exactly as the engine wrote it, and a line Chausar did not write stays as it is', () => {
    const words = fixedWords(enT);
    for (const line of ['You chose Approve: Plan accepted.', 'Find possible customers: company offices in Indore', 'Do the hands-on work', '80,531 tokens in, 787 out', 'Idle']) expect(words(line)).toBe(line);
    const hi = fixedWords(hiT);
    for (const line of ['Bake the cake for Asha', 'You decided to call back on Friday']) expect(hi(line)).toBe(line);
  });
});
