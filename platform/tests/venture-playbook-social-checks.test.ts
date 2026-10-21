// Social media agency playbook: the deterministic checks a draft passes before the owner sees it. Channel limits as
// data (length counted the platform's way, hashtags, media specs, alt text), claims against the client's proof files,
// disclosure for paid and AI content, the client's banned words, and thread splitting by code. No model.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SOCIAL_CHECK_IDS, checkChannelLimits, checkDisclosure, checkDraftClaims, checkSocialDraft, checkWords, countCharacters, hashtagsOf, splitThread,
  type ClientRules, type PostDraft,
} from '../runtime/venture/playbooks/social/checks.ts';

const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected, error?.message); return true; };
const ids = (findings: { check: string }[]) => findings.map(finding => finding.check);
const portrait = { kind: 'image' as const, width: 1080, height: 1350, altText: 'A long table set for Sunday lunch.' };

const client: ClientRules = {
  businessName: 'Lumen Studio',
  known: ['Lumen Studio', 'Meera'],
  bannedWords: ['cheap', 'best'],
  protectedPhrases: ['Best Bites Bakery'],
  bannedTopics: ['politics'],
  competitors: ['Glow Kitchen'],
  proofFiles: [
    { id: 'proof-awards.txt', text: 'Lumen Studio was named Best New Cafe by Pune Food Guide in March 2026.' },
    { id: 'proof-menu.csv', text: 'Item,Price\nSunday thali,450\nFilter coffee,90' },
  ],
};

test('counting: graphemes as people see them; X weighs characters, emoji and links its own way', () => {
  assert.equal(countCharacters('café', 'instagram'), 4);
  assert.equal(countCharacters('café', 'instagram'), 4, 'decomposed text is normalised first');
  assert.equal(countCharacters('👍🏽 ok', 'instagram'), 4);
  assert.equal(countCharacters('hello', 'x'), 5);
  assert.equal(countCharacters('👍🏽', 'x'), 2);
  assert.equal(countCharacters('नमस्ते', 'x'), 6, 'Devanagari sits in the range X counts as one per code point');
  assert.equal(countCharacters('日本', 'x'), 4, 'other scripts weigh two');
  assert.equal(countCharacters('see https://lumen.example/menu/autumn-2026-long-path today', 'x'), 4 + 23 + 6);
});

test('hashtags: found after a space or at the start, never inside a word or a link', () => {
  assert.deepEqual(hashtagsOf('#Sunday lunch at #Lumen_Studio, see https://x.example/#menu and email#tag'), ['#Sunday', '#Lumen_Studio']);
});

test('channel limits: text length, hashtags, media count, kinds, aspect, video length and alt text', () => {
  const ok: PostDraft = { id: 'p1', channel: 'instagram', text: 'Sunday table. #Sunday #Lunch', media: [portrait] };
  assert.deepEqual(checkChannelLimits(ok), []);
  const long = checkChannelLimits({ ...ok, text: 'a'.repeat(2201) });
  assert.deepEqual(ids(long), ['channel-length']);
  assert.match(long[0].line, /2,201 of 2,200/);
  assert.equal(long[0].ruleId, 'ig-caption-2200');
  assert.deepEqual(ids(checkChannelLimits({ ...ok, text: '#a #b #c #d #e #f' })), ['channel-hashtags']);
  assert.deepEqual(ids(checkChannelLimits({ ...ok, media: [] })), ['channel-media']);
  assert.deepEqual(ids(checkChannelLimits({ ...ok, media: Array.from({ length: 21 }, () => portrait) })), ['channel-media']);
  assert.deepEqual(ids(checkChannelLimits({ ...ok, media: Array.from({ length: 12 }, () => portrait) }, { mode: 'api' })), ['channel-media'], 'the API takes ten');
  assert.deepEqual(ids(checkChannelLimits({ ...ok, media: [{ ...portrait, width: 1080, height: 1920 }] })), ['channel-media'], 'taller than 4:5');
  assert.deepEqual(ids(checkChannelLimits({ ...ok, media: [{ ...portrait, altText: '' }] })), ['alt-text']);
  const shorts: PostDraft = { id: 'p2', channel: 'youtube-shorts', text: 'Plating, slowly', media: [{ kind: 'video', width: 1080, height: 1920, seconds: 181 }] };
  assert.deepEqual(ids(checkChannelLimits(shorts)), ['channel-media']);
  assert.deepEqual(checkChannelLimits({ ...shorts, media: [{ kind: 'video', width: 1080, height: 1920, seconds: 180 }] }), []);
  assert.deepEqual(ids(checkChannelLimits({ ...shorts, media: [{ kind: 'video', width: 1920, height: 1080, seconds: 60 }] })), ['channel-media'], 'a Short is square or vertical');
  assert.deepEqual(ids(checkChannelLimits({ id: 'p3', channel: 'x', text: 'x'.repeat(281) })), ['channel-length']);
  assert.deepEqual(ids(checkChannelLimits({ id: 'p4', channel: 'linkedin', text: '#a #b #c #d #e #f #g' }, { maxHashtags: 3 })), ['channel-hashtags'], "the client's own cap");
  assert.deepEqual(checkChannelLimits({ id: 'p5', channel: 'x', text: 'short', thread: ['one', 'two'] }), []);
});

test('claims: specifics must be in the proof files; hashtags, handles and links are not claims', () => {
  const backed = checkDraftClaims({ id: 'p1', channel: 'instagram', text: 'Named Best New Cafe by Pune Food Guide in March 2026. Sunday thali for ₹450. #PuneFood @lumen.studio' }, client);
  assert.deepEqual(backed.findings, [], JSON.stringify(backed.claims.unmatched));
  const invented = checkDraftClaims({ id: 'p2', channel: 'instagram', text: 'Rated 4.9 by 2,000 diners and ISO 22000 certified.' }, client);
  assert.deepEqual(ids(invented.findings), ['claims']);
  assert.equal(invented.findings[0].severity, 'block');
  assert.match(invented.findings[0].line, /2,000/);
  assert.match(invented.findings[0].line, /ISO 22000/);
});

test('disclosure: paid content says so upfront and sets the platform label', () => {
  const paid: PostDraft = { id: 'p1', channel: 'instagram', text: 'Ad: our Sunday thali is back. #ad', media: [portrait], paid: true, platformLabels: { paidPartnership: true } };
  assert.deepEqual(checkDisclosure(paid), []);
  assert.deepEqual(ids(checkDisclosure({ ...paid, text: 'Our Sunday thali is back.' })), ['disclosure-paid']);
  const buried = checkDisclosure({ ...paid, text: `${'Our Sunday thali is back with the whole family menu. '.repeat(4)}#ad` });
  assert.deepEqual(ids(buried), ['disclosure-paid']);
  assert.match(buried[0].line, /first/i);
  assert.deepEqual(ids(checkDisclosure({ ...paid, platformLabels: {} })), ['disclosure-paid']);
  assert.deepEqual(checkDisclosure({ id: 'p2', channel: 'x', text: '#ad Sunday thali is back.', paid: true }), [], 'X has no partnership toggle');
});

test('disclosure: an AI person, voice or realistic scene is labelled as AI in the text and on the platform', () => {
  const ai: PostDraft = { id: 'p1', channel: 'tiktok', text: 'Made with AI: a chef shows the Sunday thali.', media: [{ kind: 'video', width: 1080, height: 1920, seconds: 30 }], ai: { person: true }, platformLabels: { aiGenerated: true } };
  assert.deepEqual(checkDisclosure(ai), []);
  assert.deepEqual(ids(checkDisclosure({ ...ai, text: 'A chef shows the Sunday thali.' })), ['disclosure-ai']);
  assert.deepEqual(ids(checkDisclosure({ ...ai, platformLabels: {} })), ['disclosure-ai']);
  assert.deepEqual(checkDisclosure({ ...ai, ai: { illustration: true }, text: 'A drawing of a thali.', platformLabels: {} }), [], 'a drawing that looks drawn needs no AI label');
});

test('disclosure: an AI creator never speaks as a real customer', () => {
  const ugc: PostDraft = {
    id: 'p1', channel: 'instagram', style: 'ugc-ad', paid: true, ai: { person: true, voice: true },
    platformLabels: { paidPartnership: true, aiGenerated: true }, media: [{ kind: 'video', width: 1080, height: 1920, seconds: 25 }],
    text: "Ad. Made with AI, not a real customer. I've been using Lumen's meal box for a month and my mornings changed.",
  };
  const findings = checkDisclosure(ugc);
  assert.deepEqual(ids(findings), ['synthetic-testimonial']);
  assert.match(findings[0].line, /I've been using/);
  assert.deepEqual(checkDisclosure({ ...ugc, text: 'Ad. Made with AI, not a real customer. Here is what comes in the Lumen meal box.' }), []);
});

test("words: the client's banned words and topics, competitors in ads, health and money claims, engagement bait", () => {
  const base: PostDraft = { id: 'p1', channel: 'instagram', text: 'Sunday table.', media: [portrait] };
  assert.deepEqual(checkWords(base, client), []);
  assert.deepEqual(ids(checkWords({ ...base, text: 'The cheapest lunch in town.' }, client)), [], 'whole words only: cheapest is not cheap');
  assert.deepEqual(ids(checkWords({ ...base, text: 'A cheap lunch, the best in town.' }, client)), ['banned-words', 'banned-words']);
  assert.deepEqual(checkWords({ ...base, text: 'Bread from Best Bites Bakery.' }, client), [], "the client's own protected words pass");
  assert.deepEqual(ids(checkWords({ ...base, text: 'Lunch and politics.' }, client)), ['banned-topics']);
  const rival = checkWords({ ...base, text: 'Better than Glow Kitchen.', paid: true }, client);
  assert.deepEqual(ids(rival), ['competitor-names']);
  assert.equal(rival[0].severity, 'block');
  assert.equal(checkWords({ ...base, text: 'Congrats to Glow Kitchen on opening.' }, client)[0].severity, 'ask-owner');
  const health = checkWords({ ...base, text: 'Our juice cures colds, guaranteed.' }, client);
  assert.deepEqual(ids(health), ['regulated-claims', 'regulated-claims']);
  assert.ok(health.every(finding => finding.severity === 'ask-owner'));
  assert.deepEqual(ids(checkWords({ ...base, text: 'Tag a friend who needs this! Comment YES below.' }, client)), ['engagement-bait', 'engagement-bait']);
  assert.deepEqual(ids(checkWords({ ...base, text: `Sunday ${String.fromCharCode(0x2014)} table.` }, client)), ['house-style']);
});

test('thread splitting: by code, at breaks, then paragraphs, sentences, words; every part fits', () => {
  assert.deepEqual(splitThread('Short and sweet.', 'x'), ['Short and sweet.']);
  assert.deepEqual(splitThread('First idea.\n---\nSecond idea.', 'x'), ['First idea.', 'Second idea.']);
  const paragraphs = [`${'Plan the month first. '.repeat(8).trim()}`, `${'Then write each post. '.repeat(8).trim()}`];
  const parts = splitThread(paragraphs.join('\n\n'), 'x');
  assert.deepEqual(parts, paragraphs);
  const sentences = Array.from({ length: 30 }, (_, index) => `Sentence number ${index} is here.`).join(' ');
  const split = splitThread(sentences, 'threads');
  assert.ok(split.length >= 2);
  for (const part of split) assert.ok(countCharacters(part, 'threads') <= 500);
  assert.equal(split.join(' '), sentences);
  const numbered = splitThread(sentences, 'x', { numbered: true });
  numbered.forEach((part, index) => {
    assert.ok(part.endsWith(` ${index + 1}/${numbered.length}`), part);
    assert.ok(countCharacters(part, 'x') <= 280);
  });
  const word = 'a'.repeat(600);
  const sliced = splitThread(word, 'x');
  assert.deepEqual(sliced.map(part => part.length), [280, 280, 40]);
  assert.throws(() => splitThread('x'.repeat(3000), 'instagram'), code('INVALID_VENTURE_REQUEST'));
});

test('all checks together: one list of findings; only block findings stop the draft', () => {
  assert.ok(SOCIAL_CHECK_IDS.includes('claims'));
  const ok = checkSocialDraft({ id: 'p1', channel: 'instagram', text: 'Sunday thali for ₹450 at Lumen Studio. #Sunday', media: [portrait] }, client);
  assert.equal(ok.passed, true, JSON.stringify(ok.findings));
  const flagged = checkSocialDraft({ id: 'p2', channel: 'instagram', text: 'Our juice cures colds.', media: [portrait] }, client);
  assert.equal(flagged.passed, true, 'a health claim goes to the owner, it does not block');
  assert.equal(flagged.findings[0].severity, 'ask-owner');
  const blocked = checkSocialDraft({ id: 'p3', channel: 'instagram', text: 'Rated 4.9 stars. Tag a friend!', media: [] }, client);
  assert.equal(blocked.passed, false);
  assert.deepEqual([...new Set(ids(blocked.findings))].sort(), ['channel-media', 'claims', 'engagement-bait']);
});
