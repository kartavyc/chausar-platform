// The business voice (Ink v2 wave 4, package 4J17, catalogue A8): the owner writes it in plain words in six typed
// sections (who I talk to, how I talk, never-use words, words I use, what I will not claim, format), on or off, per
// language (English, Hindi) and per channel. Each set is the owner's approval inside the app and a new version, kept,
// so they can go back. venture.voice.learn takes three to ten of the owner's own texts: code counts the words and keeps
// verbatim lines, holds the last text out, and marks the voice validated only when that held-out text passes; what it
// learned waits unsaved until the owner sets it. The voice check (playbooks/draft-checks.ts) reads every draft by code:
// a never-use word or a claim the owner will not make fails it, and it never lets a draft pass that another check refuses.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Deliverable, PlaybookCheckResult } from '../runtime/venture/contracts.ts';
import { currentVenture, listRecords } from '../runtime/venture/records.ts';
import { handlers as agentHandlers } from '../runtime/venture/agents/index.ts';
import { learnVoice, voicePart, voiceRules } from '../runtime/venture/agents/voice.ts';
import { VOICE_CHECK, voiceDraftCheck, withVoiceCheck } from '../runtime/venture/playbooks/draft-checks.ts';
import { failedCheckReason } from '../runtime/venture/delivery/runs.ts';
import { runReportPlaybook } from '../runtime/venture/views/runs.ts';
import { business, code, owner, phone, PLAIN_IDEA, readyDraft } from './venture-judge-helpers.ts';
import { TEST_CARD } from './venture-agent-helpers.ts';

type Env = Awaited<ReturnType<typeof business>>;
const agents = (env: Env, method: string, payload: unknown = {}, ctx = owner): Promise<any> =>
  (agentHandlers as Record<string, (deps: Env['deps'], ctx: typeof owner, payload: unknown) => Promise<any>>)[method](env.deps, ctx, payload);

const SECTIONS = {
  audience: ['Owners of small online shops'],
  howITalk: ['Warm and direct', 'Short paragraphs'],
  neverUse: ['synergy', 'anything'],
  wordsIUse: ['plain', 'simple'],
  willNotClaim: ['guaranteed results', 'number one in India'],
  format: ['Short sentences'],
};
const voice = (extra: Record<string, unknown> = {}) => ({ language: 'en', channel: null, on: true, sections: SECTIONS, ...extra });

const SAMPLES = [
  'Hi friends,\nToday we look at small steps that make budgets simple. Write down what you spend this week.\nKeep it simple, Asha',
  'Hi friends,\nSaving starts with small steps. Pick one habit this week and keep it simple.\nKeep it simple, Asha',
  'Hi friends,\nAn emergency fund grows from small steps. Put a little aside every week. Simple wins.\nKeep it simple, Asha',
  'Hi friends,\nDebt feels heavy, but small steps help. Pay the smallest one first this week. Keep it simple.\nKeep it simple, Asha',
];

const words = (lines: string[]): Deliverable => ({
  title: 'Your plan', sections: [{ heading: 'Plan', parts: lines.map(text => ({ kind: 'text' as const, text })) }], questionsForClient: [], attachments: [],
} as unknown as Deliverable);

test('voice: the owner sets six typed sections per language and channel, inside the app only, each set a kept version with undo', async () => {
  const env = await business(PLAIN_IDEA);
  const empty = await agents(env, 'venture.voice.get');
  assert.deepEqual(empty.voices, []);
  assert.match(empty.line, /no voice/i);
  await assert.rejects(agents(env, 'venture.voice.set', { voice: voice() }, phone), code('APP_APPROVAL_REQUIRED'));
  const first = await agents(env, 'venture.voice.set', { voice: voice() });
  assert.equal(first.voices.length, 1);
  assert.deepEqual(first.voices[0].sections, SECTIONS);
  assert.equal(first.voices[0].version, 1);
  assert.equal(first.voices[0].validated, false, 'a voice written by hand is not validated by a held-out text');
  assert.equal(first.voices[0].undo, null);
  const hindi = await agents(env, 'venture.voice.set', { voice: voice({ language: 'hi', channel: 'whatsapp', sections: { ...SECTIONS, neverUse: ['ज़बरदस्त'] } }) });
  assert.equal(hindi.voices.length, 2, 'one voice per language and channel');
  const second = await agents(env, 'venture.voice.set', { voice: voice({ on: false }) });
  const english = second.voices.find((item: any) => item.language === 'en' && item.channel === null);
  assert.equal(english.version, 2);
  assert.equal(english.on, false);
  assert.deepEqual(english.undo, { language: 'en', channel: null, on: true, sections: SECTIONS }, 'undo is the version before, to set again');
  const back = await agents(env, 'venture.voice.set', { voice: english.undo });
  assert.equal(back.voices.find((item: any) => item.language === 'en' && item.channel === null).version, 3);
  assert.equal(listRecords(env.store.read(), 'venture-voice').filter(item => item.language === 'en').length, 3, 'every version is kept');
  assert.match(back.line, /version 3/);
});

test('voice: a section with a key or a card number, an unknown channel or too many lines is refused, and nothing is kept', async () => {
  const env = await business(PLAIN_IDEA);
  const key = 'sk-ant-' + 'api03-' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8s9T0';
  await assert.rejects(agents(env, 'venture.voice.set', { voice: voice({ sections: { ...SECTIONS, howITalk: [`Use ${key}`] } }) }), code('CHAT_KEY_REFUSED'));
  await assert.rejects(agents(env, 'venture.voice.set', { voice: voice({ sections: { ...SECTIONS, audience: [`Card ${TEST_CARD}`] } }) }), code('CHAT_KEY_REFUSED'));
  await assert.rejects(agents(env, 'venture.voice.set', { voice: voice({ channel: 'fax' }) }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(agents(env, 'venture.voice.set', { voice: voice({ sections: { ...SECTIONS, neverUse: Array.from({ length: 61 }, (_, i) => `word${'x'.repeat(i % 5)}`) } }) }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(agents(env, 'venture.voice.set', { voice: voice({ sections: { audience: [] } }) }), code('INVALID_VENTURE_REQUEST'));
  assert.equal(listRecords(env.store.read(), 'venture-voice').length, 0);
});

test('voice learn: three to ten of the owner\'s texts; code counts words and keeps verbatim lines; validated only after a held-out text passes', async () => {
  const pure = learnVoice(SAMPLES);
  assert.equal(pure.language, 'en');
  assert.deepEqual(pure.sections.wordsIUse.slice().sort(), ['simple', 'small', 'steps', 'week']);
  assert.ok(pure.counts.some(item => item.word === 'small' && item.count === 3), 'counted in the three texts it learned from');
  assert.ok(pure.lines.includes('Hi friends,') && pure.lines.includes('Keep it simple, Asha'), 'verbatim lines, kept as written');
  assert.ok(pure.sections.howITalk.some(line => line.includes('"Hi friends,"')));
  assert.equal(pure.heldOut.passed, true);
  assert.equal(pure.learnedFrom, 3, 'the last text is held out');

  const env = await business(PLAIN_IDEA);
  await assert.rejects(agents(env, 'venture.voice.learn', { samples: SAMPLES.slice(0, 2) }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(agents(env, 'venture.voice.learn', { samples: Array.from({ length: 11 }, () => SAMPLES[0]) }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(agents(env, 'venture.voice.learn', { samples: SAMPLES }, phone), code('APP_APPROVAL_REQUIRED'));
  const learned = await agents(env, 'venture.voice.learn', { samples: SAMPLES });
  assert.deepEqual(learned.voices, [], 'learning saves nothing in use');
  assert.equal(learned.draft.validated, true);
  assert.match(learned.draft.line, /did not learn from/);
  assert.equal(voiceRules(env.store.read(), currentVenture(env.store.read())!).length, 0, 'a draft is never checked or used');
  const saved = await agents(env, 'venture.voice.set', { voice: { language: 'en', channel: null, on: true, sections: learned.draft.sections } });
  assert.equal(saved.voices[0].validated, true, 'the owner set the voice the held-out text passed');
  assert.equal(listRecords(env.store.read(), 'venture-voice').find(item => !item.draft)!.learnedFrom, 3);
  const changed = await agents(env, 'venture.voice.set', { voice: { language: 'en', channel: null, on: true, sections: { ...learned.draft.sections, wordsIUse: ['other'] } } });
  assert.equal(changed.voices[0].validated, false, 'a changed voice is not the one the held-out text passed');
});

test('voice learn: a held-out text unlike the others fails, and the voice is not validated; the owner\'s ids are never kept', () => {
  const unlike = [...SAMPLES.slice(0, 3), 'Dear Sir or Madam, I am writing to formally request the quarterly reconciliation documents regarding the outstanding matter at your earliest convenience.'];
  const learned = learnVoice(unlike);
  assert.equal(learned.heldOut.passed, false);
  assert.match(learned.heldOut.line, /did not/);
  const withCard = learnVoice([`Hi friends, my card is ${TEST_CARD}\nSmall steps this week keep it simple.`, ...SAMPLES.slice(1)]);
  assert.ok(!JSON.stringify(withCard).includes(TEST_CARD.replace(/ /g, '').slice(0, 8)) && !JSON.stringify(withCard).includes(TEST_CARD), 'a card number never reaches the kept lines');
  const hindi = learnVoice(['नमस्ते दोस्तों,\nआज छोटे कदम की बात करते हैं।\nसरल रखिए', 'नमस्ते दोस्तों,\nबचत छोटे कदम से शुरू होती है।\nसरल रखिए', 'नमस्ते दोस्तों,\nहर हफ्ते छोटे कदम रखिए।\nसरल रखिए']);
  assert.equal(hindi.language, 'hi');
});

test('voice check: never-use words and claims the owner will not make fail a draft by code; a voice that is off or for another channel does not', () => {
  const rules = [{ language: 'en' as const, channel: null, neverUse: ['synergy', 'ज़बरदस्त'], willNotClaim: ['guaranteed results'] }];
  const clean = voiceDraftCheck(words(['Plain advice for your shop.']), rules, null)!;
  assert.equal(clean.check, VOICE_CHECK);
  assert.equal(clean.outcome, 'pass');
  const banned = voiceDraftCheck(words(['We bring Synergy to your prices.']), rules, null)!;
  assert.equal(banned.outcome, 'fail');
  assert.match(banned.detail, /"synergy"/);
  assert.equal(voiceDraftCheck(words(['यह जबरदस्त है।']), rules, null)!.outcome, 'fail', 'Hindi read without the nukta');
  assert.equal(voiceDraftCheck(words(['These results are guaranteed for every shop.']), rules, null)!.outcome, 'fail', 'a claim in other words is still that claim');
  assert.equal(voiceDraftCheck(words(['Guaranteed results in a week.']), rules, null)!.outcome, 'fail');
  assert.equal(voiceDraftCheck(words(['We synergise.']), rules, null)!.outcome, 'pass', 'a word, not part of another word');
  assert.equal(voiceDraftCheck(words(['Synergy.']), [], null), null, 'no voice: no check');
  const social = [{ language: 'en' as const, channel: 'linkedin', neverUse: ['synergy'], willNotClaim: [] }];
  assert.equal(voiceDraftCheck(words(['X: synergy in every post.']), social, 'social-agency'), null, 'a LinkedIn voice reads only LinkedIn posts');
});

test('voice check: it never lets a draft pass that the other checks refuse', () => {
  const failing: PlaybookCheckResult[] = [{ playbook: 'youtube', check: 'title-thumbnail', outcome: 'fail', detail: 'The title is too long.' }];
  const voicePass: PlaybookCheckResult = { playbook: 'voice', check: VOICE_CHECK, outcome: 'pass', detail: 'Fine.' };
  const merged = withVoiceCheck(failing, voicePass)!;
  assert.equal(merged.length, 2);
  assert.match(failedCheckReason([], merged)!, /title is too long/);
  const harnessFail = [{ check: 'receipts', passed: false, detail: 'A figure has no receipt.' }] as any;
  assert.match(failedCheckReason(harnessFail, withVoiceCheck(undefined, voicePass))!, /no receipt/);
  assert.equal(withVoiceCheck(undefined, null), undefined, 'no voice: nothing added');
  const voiceFail: PlaybookCheckResult = { ...voicePass, outcome: 'fail', detail: 'The draft uses "synergy".' };
  assert.match(failedCheckReason([], withVoiceCheck([], voiceFail))!, /synergy/);
});

test('voice check: a real order\'s draft is read against the voice in use, on the eight fixed steps too, and a failed voice check blocks Accept', async () => {
  const env = await business(PLAIN_IDEA);
  await agents(env, 'venture.voice.set', { voice: voice() });
  const run = await readyDraft(env);
  const result = (run.playbookChecks ?? []).find((item: PlaybookCheckResult) => item.check === VOICE_CHECK);
  assert.ok(result, JSON.stringify(run.playbookChecks));
  assert.equal(result.outcome, 'fail', 'the draft says "anything", a never-use word');
  await assert.rejects(env.call('venture.delivery.review', { runId: run.id, verdict: 'accepted' }), (error: any) => { assert.match(error.message, /"anything"/); return true; });
  await agents(env, 'venture.voice.set', { voice: voice({ on: false }) });
  const off = await readyDraft(env);
  assert.equal((off.playbookChecks ?? []).find((item: PlaybookCheckResult) => item.check === VOICE_CHECK), undefined, 'a voice that is off checks nothing');
});

test('voice check: practice drafts are read against the voice too, and one that breaks it fails its episode', async () => {
  const env = await business(PLAIN_IDEA, 'rehearsal');
  await agents(env, 'venture.voice.set', { voice: voice() });
  const run = await env.call('venture.simulation.run', { episodes: 1 });
  assert.ok(run.episodes.length >= 1);
  for (const episode of run.episodes) {
    const result = (episode.playbookChecks ?? []).find((item: PlaybookCheckResult) => item.check === VOICE_CHECK);
    assert.ok(result, JSON.stringify(episode.playbookChecks));
    assert.equal(result.outcome, 'fail', 'the practice draft says "anything"');
    assert.equal(episode.passed, false);
  }
});

test('voice in Hindi and Hinglish: romanized common words are not learned; Hindi endings and a Latin spelling still match; guarantee matches guaranteed', () => {
  const hinglish = learnVoice(['Namaste dosto,\nAaj hum bachat ki baat karte hai aur chhote kadam lete hai.\nSimple rakho', 'Namaste dosto,\nBachat chhote kadam se hoti hai aur hum roz bachat karte hai.\nSimple rakho', 'Namaste dosto,\nHar hafte chhote kadam aur bachat hai.\nSimple rakho', 'Namaste dosto,\nChhote kadam se bachat hoti hai.\nSimple rakho']);
  for (const common of ['hai', 'aur', 'hum']) assert.ok(!hinglish.sections.wordsIUse.includes(common), common);
  assert.ok(hinglish.sections.wordsIUse.includes('bachat'));
  const rules = [{ language: 'hi' as const, channel: null, neverUse: ['सस्ता'], willNotClaim: ['guarantee results'] }];
  assert.equal(voiceDraftCheck(words(['यह सस्ती सेवा है।']), rules, null)!.outcome, 'fail', 'a Hindi ending folds');
  assert.equal(voiceDraftCheck(words(['सस्तों के लिए।']), rules, null)!.outcome, 'fail');
  assert.equal(voiceDraftCheck(words(['Bilkul sasta plan.']), rules, null)!.outcome, 'fail', 'the Latin spelling of the same word');
  assert.equal(voiceDraftCheck(words(['These results are guaranteed.']), rules, null)!.outcome, 'fail', 'guarantee and guaranteed are one stem');
  assert.equal(voiceDraftCheck(words(['A plain plan for your shop.']), rules, null)!.outcome, 'pass');
});

test('voice: the result has its own playbook label, learn replaces the open draft, a line over its length says so, and the writer reads the channel voices the check reads', async () => {
  const flagged = voiceDraftCheck(words(['Synergy.']), [{ language: 'en', channel: null, neverUse: ['synergy'], willNotClaim: [] }], null)!;
  assert.notEqual(flagged.playbook, 'voice');
  assert.equal(flagged.playbook, 'owner-voice');
  const env = await business(PLAIN_IDEA);
  await agents(env, 'venture.voice.learn', { samples: SAMPLES });
  await agents(env, 'venture.voice.learn', { samples: SAMPLES });
  assert.equal(listRecords(env.store.read(), 'venture-voice').filter(item => item.draft).length, 1, 'one open draft');
  await assert.rejects(agents(env, 'venture.voice.set', { voice: voice({ sections: { ...SECTIONS, neverUse: ['x'.repeat(61)] } }) }), (error: any) => { assert.match(error.message, /too long/); return true; });
  await agents(env, 'venture.voice.set', { voice: voice({ channel: 'linkedin', sections: { ...SECTIONS, neverUse: ['hustle'] } }) });
  await agents(env, 'venture.voice.set', { voice: voice({ channel: 'youtube', sections: { ...SECTIONS, neverUse: ['smash'] } }) });
  const state = env.store.read();
  const venture = currentVenture(state)!;
  const social = voicePart(state, venture, 'social-agency') as any;
  assert.deepEqual(social.voice.voices.map((item: any) => item.channel), ['linkedin'], 'social: every-channel voices are none here, the post channels are read');
  const youtube = voicePart(state, venture, 'youtube') as any;
  assert.deepEqual(youtube.voice.voices.map((item: any) => item.channel), ['youtube']);
  assert.deepEqual(voicePart(state, venture, null), {}, 'a reply reads every-channel and mail voices: none set here');
});

test('voice check: a semicolon ends a sentence for a claim; the run report takes its playbook from the playbook, never the voice', async () => {
  const rules = [{ language: 'en' as const, channel: null, neverUse: [], willNotClaim: ['guaranteed results'] }];
  assert.equal(voiceDraftCheck(words(['Nothing is promised; results are guaranteed for you.']), rules, null)!.outcome, 'fail', 'both words in one part');
  assert.equal(voiceDraftCheck(words(['We share results each week; a refund is guaranteed by law.']), [{ ...rules[0], willNotClaim: ['guaranteed results'] }], null)!.outcome, 'pass', 'the two words sit in different sentences');
  const env = await business(PLAIN_IDEA);
  const plain = await readyDraft(env);
  await agents(env, 'venture.voice.set', { voice: voice() });
  const voiced = await readyDraft(env);
  const report = async (runId: string) => (await env.call('venture.runs.get', { runId })).report;
  const [before, after] = [await report(plain.id), await report(voiced.id)];
  assert.ok(after.measured.some((item: any) => item.id === 'owner-voice:voice'), JSON.stringify(after.measured.map((item: any) => item.id)));
  assert.deepEqual(after.needsHuman, before.needsHuman, 'the voice is not a playbook');
  assert.equal(runReportPlaybook({ playbookChecks: [{ playbook: 'owner-voice', check: 'voice', outcome: 'pass', detail: '' }] } as any), null);
  assert.equal(runReportPlaybook({ playbookChecks: [{ playbook: 'owner-voice', check: 'voice', outcome: 'pass', detail: '' }, { playbook: 'youtube', check: 'hook', outcome: 'pass', detail: '' }] } as any), 'youtube');
});
