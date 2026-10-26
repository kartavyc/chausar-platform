// Ink v2 wave 4, package 4J16 (catalogue Q20): writing checks as code, in English and Hindi. AI-tell and stock-phrase
// rates per 1,000 characters against a fixed baseline for each language; hard bans (the long dash, "not X but Y",
// summary phrases, invisible characters); a quoted-text share band; and a bait check (bait phrases, "tag N friends",
// stacked asks). Each is a draft check result with its rate, on YouTube and social drafts; a check never rewrites the
// draft. Invisible characters are taken out of the copy the checks read, so they cannot split a banned word.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import type { Deliverable } from '../runtime/venture/contracts.ts';
import {
  AI_TELLS, STOCK_PHRASES, WRITING_BASELINES, WRITING_CHECK_IDS, ratePer1000, stripInvisible, writingChecks, writingLanguage, type WritingResult,
} from '../runtime/venture/playbooks/writing-checks.ts';
import { runFlagshipChecks, type FlagshipCheckInput } from '../runtime/venture/playbooks/draft-checks.ts';

const result = (results: readonly WritingResult[], check: string) => {
  const found = results.find(item => item.check === check);
  assert.ok(found, `no ${check}: ${JSON.stringify(results)}`);
  return found;
};

const CLEAN = 'We cut the long pauses and levelled the sound. The new intro is shorter, and the ask at the end points to the next episode. Send us the next file when it is ready.';
const CLEAN_HI = 'हमने लंबे ठहराव हटाए और आवाज़ बराबर की। नया परिचय छोटा है, और आख़िर में अगले एपिसोड की बात है। अगली फ़ाइल तैयार हो तो भेज दीजिए।';

test('a plain English draft passes all four checks, each with its rate', () => {
  const results = writingChecks(CLEAN);
  assert.deepEqual(results.map(item => item.check), [...WRITING_CHECK_IDS]);
  for (const item of results) assert.equal(item.outcome, 'pass', `${item.check}: ${item.detail}`);
  const tells = result(results, 'writing-tells');
  assert.equal(tells.rate, 0);
  assert.match(tells.detail, /per 1,000 characters/);
  assert.match(tells.detail, /English baseline/);
  for (const item of results) assert.doesNotMatch(item.detail, /\u2014/);
});

test('hard bans: the long dash, "not X but Y" and summary phrases fail, each named', () => {
  const dash = result(writingChecks(`${CLEAN} The edit is done \u2014 enjoy.`), 'writing-bans');
  assert.equal(dash.outcome, 'fail');
  assert.match(dash.detail, /long dash/);
  for (const [text, words] of [
    ['This is not just an edit, but a new way to tell your story.', /not X but Y/],
    ["It's not a podcast, it's a movement.", /not X but Y/],
    ['In conclusion, the episode is ready.', /summary phrase/],
    ['To sum up, we cut the pauses.', /summary phrase/],
  ] as const) {
    const bans = result(writingChecks(text), 'writing-bans');
    assert.equal(bans.outcome, 'fail', text);
    assert.match(bans.detail, words, text);
  }
  // "not" and "but" far apart in ordinary words is not the pattern.
  assert.equal(result(writingChecks('We did not cut the intro. But the outro is shorter now.'), 'writing-bans').outcome, 'pass');
});

test('invisible characters are taken out of the copy the checks read, and named: they never split a banned word', () => {
  const zw = String.fromCharCode(0x200b);
  const stripped = stripInvisible(`del${zw}ve into the edit`);
  assert.equal(stripped.text, 'delve into the edit');
  assert.equal(stripped.removed, 1);
  const results = writingChecks(`We del${zw}ve into the tapestry of your story.`);
  const bans = result(results, 'writing-bans');
  assert.equal(bans.outcome, 'fail');
  assert.match(bans.detail, /1 invisible character/);
  assert.ok(result(results, 'writing-tells').matches.includes('delve'));
});

test('AI tells and stock phrases: a rate per 1,000 characters against the baseline; over it fails', () => {
  const text = "It's important to note that we delve into a rich tapestry of seamless edits.";
  const tells = result(writingChecks(text), 'writing-tells');
  assert.deepEqual([...tells.matches].sort(), ["it's important to note", 'delve', 'seamless', 'tapestry'].sort());
  assert.equal(tells.rate, ratePer1000(4, text.length));
  assert.ok(tells.rate! > WRITING_BASELINES.en.tellsPer1000);
  assert.equal(tells.outcome, 'fail');
  assert.match(tells.detail, /4 AI-tell or stock phrases/);
  // One tell in a long plain draft stays under the baseline and passes, with the rate shown.
  const long = `${CLEAN} ${CLEAN} ${CLEAN} ${CLEAN} The colours are vibrant.`;
  const one = result(writingChecks(long), 'writing-tells');
  assert.equal(one.outcome, 'pass', one.detail);
  assert.equal(one.rate, ratePer1000(1, long.length));
  assert.ok(AI_TELLS.en.length >= 20 && AI_TELLS.hi.length >= 10 && STOCK_PHRASES.en.length >= 8 && STOCK_PHRASES.hi.length >= 5);
});

test('Hindi: the language is read from the script; Hindi words and the Hindi baseline are used', () => {
  assert.equal(writingLanguage(CLEAN_HI), 'hi');
  assert.equal(writingLanguage(CLEAN), 'en');
  for (const item of writingChecks(CLEAN_HI)) assert.equal(item.outcome, 'pass', `${item.check}: ${item.detail}`);
  const tells = result(writingChecks('आज की तेज़-रफ़्तार दुनिया में यह एक अद्वितीय, अभूतपूर्व और क्रांतिकारी काम है।'), 'writing-tells');
  assert.equal(tells.outcome, 'fail');
  assert.match(tells.detail, /Hindi baseline/);
  assert.ok(tells.matches.length >= 3, JSON.stringify(tells.matches));
  const summary = result(writingChecks('निष्कर्ष में, एपिसोड तैयार है।'), 'writing-bans');
  assert.equal(summary.outcome, 'fail');
  const contrast = result(writingChecks('यह न केवल एक वीडियो है, बल्कि एक आंदोलन है।'), 'writing-bans');
  assert.equal(contrast.outcome, 'fail');
  assert.match(contrast.detail, /not X but Y/);
});

test('quoted text: a share of the draft inside quotation marks above the band fails', () => {
  const quoted = 'He said "we cut every pause, levelled every voice, and rebuilt the intro from the raw tape" and "the outro now points to the next episode".';
  const quotes = result(writingChecks(quoted), 'writing-quotes');
  assert.equal(quotes.outcome, 'fail');
  assert.match(quotes.detail, /quoted/);
  assert.ok(quotes.rate! > 350, String(quotes.rate));
  const light = result(writingChecks(`${CLEAN} The client called it "much better".`), 'writing-quotes');
  assert.equal(light.outcome, 'pass', light.detail);
});

test('bait: bait phrases, "tag N friends" and stacked asks fail; one plain ask passes; Hindi bait too', () => {
  for (const text of ['Tag 3 friends who need this edit!', 'Like, comment, share and subscribe for more.', 'दोस्तों को टैग करें और शेयर करें, लाइक करें!']) {
    const bait = result(writingChecks(text), 'writing-bait');
    assert.equal(bait.outcome, 'fail', text);
  }
  assert.match(result(writingChecks('Like, comment, share and subscribe for more.'), 'writing-bait').detail, /4 asks/);
  assert.equal(result(writingChecks('Subscribe for the next episode.'), 'writing-bait').outcome, 'pass');
  // A social draft's own word check already finds English bait phrases, so they can be left out here.
  assert.equal(result(writingChecks('Tag 3 friends who need this edit!', { englishBait: false }), 'writing-bait').outcome, 'pass');
  // Asks are counted per post when posts are given.
  const posts = ['Like this post.', 'Share it with your team.'];
  assert.equal(result(writingChecks(posts.join('\n'), { posts }), 'writing-bait').outcome, 'pass');
});

test('no false alarms: ordinary "not ..., but", common words, two tells in a short draft, a leading BOM and ordinary verbs pass', () => {
  for (const text of ["I'm not sure, but the cut looks right.", "It's not easy, but we cut the long pauses.", 'Not yet, but soon.']) {
    assert.equal(result(writingChecks(text), 'writing-bans').outcome, 'pass', text);
  }
  // The contrast ban needs "not a NOUN, but a ...".
  const contrast = result(writingChecks('This is not an edit, but a story.'), 'writing-bans');
  assert.equal(contrast.outcome, 'fail');
  assert.match(contrast.detail, /not X but Y/);
  // "कुल मिलाकर" is everyday Hindi, not a hard ban.
  assert.equal(result(writingChecks('कुल मिलाकर एपिसोड अच्छा बना है और आवाज़ साफ़ है।'), 'writing-bans').outcome, 'pass');
  // Words people use every day are off the lists.
  for (const word of ['landscape', 'foster', 'unlock']) assert.ok(!AI_TELLS.en.includes(word), word);
  for (const word of ['यात्रा', 'सहज']) assert.ok(!AI_TELLS.hi.includes(word), word);
  // Under 1,000 characters it takes three tells: two pass, three fail.
  assert.equal(result(writingChecks('We delve into a seamless edit.'), 'writing-tells').outcome, 'pass');
  assert.equal(result(writingChecks('We delve into a seamless, vibrant edit.'), 'writing-tells').outcome, 'fail');
  // A byte order mark at the very start is how some files begin: taken out, never counted as hidden.
  const bom = writingChecks(`${String.fromCharCode(0xfeff)}${CLEAN}`);
  assert.equal(result(bom, 'writing-bans').outcome, 'pass', result(bom, 'writing-bans').detail);
  // Verbs used in ordinary sentences are not asks; a real stack of asks still fails.
  assert.equal(result(writingChecks('Like many founders, Asha shares her story, follows her plan and saves the files.'), 'writing-bait').outcome, 'pass');
  assert.equal(result(writingChecks('Like this post, comment below, share it with a friend and subscribe.'), 'writing-bait').outcome, 'fail');
  assert.equal(result(writingChecks('Comment to the client about the date.'), 'writing-bait').outcome, 'pass');
});

// ---------------------------------------------------------------------------
// In the flagship checks
// ---------------------------------------------------------------------------

const draft = (lines: string[]): Deliverable => ({ title: 'Your episode', sections: [{ heading: 'Posts', parts: lines.map(text => ({ kind: 'text' as const, text })) }], questionsForClient: [] });
const input = (flagship: string, lines: string[], servedBy: 'model' | 'template' = 'model'): FlagshipCheckInput => ({
  flagship, offerKey: null, servedBy, deliverable: draft(lines), request: 'Posts for Lumen Studio in October.', intake: null,
  files: [], receipts: [], known: ['Lumen Studio'], mode: 'client', today: '2026-10-21', dateOrder: 'day-month-year', finishing: null,
});

test('YouTube and social drafts carry the writing checks; a CA draft and a template outline do not', async () => {
  for (const flagship of ['youtube', 'social-agency']) {
    const results = await runFlagshipChecks(input(flagship, ['X: In conclusion, Sunday thali at Lumen Studio.']));
    const bans = results.find(item => item.check === 'writing-bans');
    assert.equal(bans?.outcome, 'fail', `${flagship}: ${JSON.stringify(results)}`);
    assert.equal(bans?.playbook, flagship);
    const clean = await runFlagshipChecks(input(flagship, ['X: Sunday thali at Lumen Studio.']));
    for (const id of WRITING_CHECK_IDS) assert.equal(clean.find(item => item.check === id)?.outcome, 'pass', `${flagship} ${id}`);
  }
  const ca = await runFlagshipChecks(input('ca-firm', ['In conclusion, the papers follow.']));
  assert.ok(!ca.some(item => (WRITING_CHECK_IDS as readonly string[]).includes(item.check)));
  const outline = await runFlagshipChecks(input('youtube', ['In conclusion.'], 'template'));
  assert.ok(!outline.some(item => (WRITING_CHECK_IDS as readonly string[]).includes(item.check)));
});

test('static: the writing checks file keeps the house style', async () => {
  const source = await readFile(new URL('../runtime/venture/playbooks/writing-checks.ts', import.meta.url), 'utf8');
  assert.ok(!source.includes(String.fromCharCode(0x2014)));
  assert.ok(!/[\u200B-\u200F\u2060\uFEFF]/.test(source), 'no invisible characters in the source');
});

test('bait nits: "comment" is bait only with below, a quoted word or a word in capitals; Hinglish ask stacks count; a Hindi contrast counts once', () => {
  for (const text of ['Comment YES for the link.', 'Comment "yes" if you agree.', 'Comment below with your city.']) {
    assert.equal(result(writingChecks(text), 'writing-bait').outcome, 'fail', text);
  }
  for (const text of ['Please comment for the client on the cut.', 'Comment if you want a longer intro next time.']) {
    assert.equal(result(writingChecks(text), 'writing-bait').outcome, 'pass', text);
  }
  const hinglish = result(writingChecks('Video pasand aaya? Like karo, share karo, subscribe karo!'), 'writing-bait');
  assert.equal(hinglish.outcome, 'fail');
  assert.match(hinglish.detail, /3 asks/);
  const contrast = result(writingChecks('यह न केवल एक वीडियो है, बल्कि एक आंदोलन है।'), 'writing-bans');
  assert.equal(contrast.matches.filter(item => item.startsWith('"not X but Y"')).length, 1, JSON.stringify(contrast.matches));
});
