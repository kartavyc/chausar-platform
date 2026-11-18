// Round 6 (re-check 036): with Hindi on, Chausar's own words on a draft's card and its run stayed English: the practice
// notice, "For ... You send it yourself.", the checks lines, the model-estimate line, "Written by ... through Codex", the
// run step "You review the draft" and "Practice draft for ...". The name showed as "चौसर" on one card and "Chausar" on
// the others. Code's words now come from the pack (views/card-words.ts, plan-words.ts); a client's name, a model and a
// tool keep their names, and what the AI wrote stays as written. Chausar is one name, in Latin letters, everywhere.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CATALOGUES, say, type Catalogue, type Message } from '../src/text';
import { CARD_FIXED_WORDS, CARD_TEMPLATE_WORDS, fillWords } from '../../../platform/runtime/venture/views/card-words';
import { PRACTICE_REASON } from '../../../platform/runtime/venture/core/launch-stage';
import { RUN_TEMPLATE_WORDS } from '../../../platform/runtime/venture/views/run-words';
import { doneLine, SEARCH_DONE_WORDS } from '../../../platform/runtime/venture/customers/find-words';
import { briefWords, FIND_TITLE_WORDS } from '../../../platform/runtime/venture/customers/find-brief';
import { draftViewWords, fixedWords, PLAN_WORD_KEYS, TEMPLATE_WORD_KEYS } from '../src/places/today/plan-words';
import { wordedRow } from '../src/places/today/OutreachRows';
import type { QueueItemView, QueueRow } from '../src/engine/types';

const TEXT = join(import.meta.dirname, '../src/text');
const hiPack = (): Catalogue => {
  const out: Record<string, Message> = {};
  for (const file of readdirSync(join(TEXT, 'hi'))) Object.assign(out, JSON.parse(readFileSync(join(TEXT, 'hi', file), 'utf8')));
  return out;
};
const HI = hiPack();
const hiT = (key: string, values?: Record<string, string | number>) => say(CATALOGUES.en, HI, 'hi', key, values as Record<string, string>);
const enT = (key: string, values?: Record<string, string | number>) => say(CATALOGUES.en, null, 'en', key, values as Record<string, string>);
const names = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('round 6: a draft\'s card and its run in Hindi', () => {
  it('the English pack says each card word and template exactly as code writes it; Hindi keeps every {name}', () => {
    for (const words of [...Object.values(CARD_FIXED_WORDS), PRACTICE_REASON]) expect(PLAN_WORD_KEYS.has(words), words).toBe(true);
    for (const [words, key] of PLAN_WORD_KEYS) expect(CATALOGUES.en[key], key).toBe(words);
    expect(TEMPLATE_WORD_KEYS).toHaveLength(Object.keys(CARD_TEMPLATE_WORDS).length + Object.keys(SEARCH_DONE_WORDS).length + Object.keys(FIND_TITLE_WORDS).length + Object.keys(RUN_TEMPLATE_WORDS).length);
    for (const { template, key } of TEMPLATE_WORD_KEYS) {
      expect(CATALOGUES.en[key], key).toBe(template);
      expect(typeof HI[key], key).toBe('string');
      expect(names(HI[key] as string), key).toEqual(names(template));
    }
  });

  it('each line seen on screen 036 reads in Hindi; the client, the model and the tool keep their names', () => {
    const words = fixedWords(hiT);
    const client = 'Asha Verma (made-up office)';
    const seen = [
      PRACTICE_REASON,
      fillWords(CARD_TEMPLATE_WORDS.forClient, { client }),
      fillWords(CARD_TEMPLATE_WORDS.checksPassed, { passed: 10, count: 10 }),
      CARD_FIXED_WORDS.checks,
      CARD_FIXED_WORDS.estimates,
      fillWords(CARD_TEMPLATE_WORDS.writtenThrough, { model: 'gpt-6.1-terra', tool: 'Codex' }),
      CARD_FIXED_WORDS.stepApprove,
      fillWords(CARD_TEMPLATE_WORDS.practiceDraft, { client }),
      fillWords(CARD_TEMPLATE_WORDS.draftReply, { client }),
    ];
    const said = seen.map(words);
    said.forEach((line, index) => expect(line, seen[index]).not.toBe(seen[index]));
    expect(said.join(' ')).not.toMatch(/\b(?:You send|checks passed|Written by|through|review the draft|Practice draft|Draft reply|model estimates)\b/);
    expect(said[1]).toBe(hiT('today.card.t.forClient', { client }));
    expect(said[1]).toContain(client);
    expect(said[2]).toBe(hiT('today.card.t.checksPassed', { passed: '10', count: '10' }));
    expect(said[5]).toContain('gpt-6.1-terra');
    expect(said[5]).toContain('Codex');
    // "Written by {model} through {tool}" is tried before "Written by {model}".
    expect(said[5]).toBe(hiT('today.card.t.writtenThrough', { model: 'gpt-6.1-terra', tool: 'Codex' }));
    expect(words(fillWords(CARD_TEMPLATE_WORDS.writtenUnreported, { model: 'Codex on this computer' }))).toBe(hiT('today.card.t.writtenUnreported', { model: 'Codex on this computer' }));
  });

  it('in English every line reads exactly as the engine wrote it', () => {
    const words = fixedWords(enT);
    for (const line of [PRACTICE_REASON, fillWords(CARD_TEMPLATE_WORDS.forClient, { client: 'Asha' }), fillWords(CARD_TEMPLATE_WORDS.checksUnsettled, { passed: 2, count: 3 }), fillWords(CARD_TEMPLATE_WORDS.writtenBy, { model: 'Claude Sonnet 5.5' })]) {
      expect(words(line)).toBe(line);
    }
  });

  it('what the AI wrote stays as written: the draft\'s own sections and a title it gave; only Chausar\'s Checks and Files change', () => {
    const words = fixedWords(hiT);
    const view: QueueItemView = {
      kind: 'draft', id: 'r1', businessName: 'Indore Custom Cakes', title: 'Office party cake', line: fillWords(CARD_TEMPLATE_WORDS.forClient, { client: 'Asha' }),
      sections: [
        { heading: 'Summary', lines: ['One 2 kg chocolate cake for the office party.'] },
        { heading: 'Questions', lines: ['Please share the full office delivery address.'] },
        { heading: CARD_FIXED_WORDS.files, lines: ['brief.pdf', CARD_FIXED_WORDS.fileGone] },
        { heading: CARD_FIXED_WORDS.checks, lines: [fillWords(CARD_TEMPLATE_WORDS.checksPassed, { passed: 10, count: 10 }), CARD_FIXED_WORDS.estimates] },
      ],
    };
    const shown = draftViewWords(view, words);
    expect(shown.title).toBe('Office party cake');
    expect(shown.line).toBe(hiT('today.card.t.forClient', { client: 'Asha' }));
    expect(shown.sections.slice(0, 2)).toEqual(view.sections.slice(0, 2));
    expect(shown.sections[2]).toEqual({ heading: hiT('today.card.files'), lines: ['brief.pdf', hiT('today.card.fileGone')] });
    expect(shown.sections[3]).toEqual({ heading: hiT('today.card.checks'), lines: [hiT('today.card.t.checksPassed', { passed: '10', count: '10' }), hiT('today.card.estimates')] });
    expect(words('Summary')).toBe('Summary');
  });

  it('a draft card\'s title and practice line are said from the pack; another line stays as the engine wrote it', () => {
    const row: QueueRow = {
      id: 'q-draft', businessId: 'b', businessName: 'B', kind: 'draft', createdAt: '2026-11-17T16:21:00.000Z', digest: 'd',
      title: fillWords(CARD_TEMPLATE_WORDS.draftReply, { client: 'Asha Verma' }), line: PRACTICE_REASON, actions: [{ id: 'read', label: 'Read', primary: true }],
    };
    const worded = wordedRow(row, hiT);
    expect([worded.title, worded.line]).toEqual([hiT('today.card.t.draftReply', { client: 'Asha Verma' }), hiT('today.card.practice')]);
    expect(wordedRow({ ...row, line: 'The client asked for a smaller cake.' }, hiT).line).toBe('The client asked for a smaller cake.');
    expect(wordedRow(row, enT)).toBe(row);
  });

  it('a finished search\'s line reads in Hindi sentence by sentence; a line with any other sentence stays as written', () => {
    const brief = { who: 'company offices', place: 'Indore', category: 'office=company', count: 10, source: { kind: 'public-map' as const } };
    const line = doneLine(brief, { found: 10, withEmail: 1, skipped: { known: 2, blocked: 0 } }, null);
    expect(line).toBe('Found 10 possible customers in Indore. One has a contact email. 2 you already had were left out. They are in Clients, Pipeline, each with its source. Nothing was sent.');
    const said = fixedWords(hiT)(line);
    expect(said).toBe([
      hiT('today.search.t.foundMany', { count: '10', place: 'Indore' }), hiT('today.search.t.emailOne'), hiT('today.search.t.knownMany', { count: '2' }),
      hiT('today.search.t.inPipeline'), hiT('today.search.t.nothingSent'),
    ].join(' '));
    expect(said).toContain('Indore');
    expect(fixedWords(enT)(line)).toBe(line);
    // The card's title too: the place keeps its name.
    const title = briefWords(brief).title;
    expect(title).toBe('Find possible customers: company offices in Indore');
    // Round 7: the kind of place is from a fixed list, so it is said in Hindi too.
    expect(fixedWords(hiT)(title)).toBe(hiT('today.search.title.map', { kind: hiT('today.search.kind.office-company'), place: 'Indore' }));
    expect(CATALOGUES.en['today.search.title.map']).toBe(FIND_TITLE_WORDS.map);
    expect(CATALOGUES.en['today.search.title.tool']).toBe(FIND_TITLE_WORDS.tool);
    const mixed = `${line} The owner asked for more.`;
    expect(fixedWords(hiT)(mixed)).toBe(mixed);
    for (const [name, template] of Object.entries(SEARCH_DONE_WORDS)) {
      expect(CATALOGUES.en[`today.search.t.${name}`], name).toBe(template);
      expect(names(HI[`today.search.t.${name}`] as string), name).toEqual(names(template));
    }
  });

  it('Chausar is one name in Hindi too: the Latin "Chausar" on every card, never "चौसर"', () => {
    expect(HI['app.name']).toBe('Chausar');
    const devanagari = Object.entries(HI).filter(([, message]) => JSON.stringify(message).includes('चौसर')).map(([key]) => key);
    expect(devanagari).toEqual([]);
  });
});
