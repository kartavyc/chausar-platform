// YouTube channel playbook: the judge for a draft package, and its committed baseline. Code checks run first; if any
// fails the model is never asked. The judge answers yes or no per rule, cites trace ids, and code counts the votes
// against each rule's own floor. A check that did not run (the finishing check without ffmpeg) keeps the draft
// unverified, never passed. The baseline file of held-back cases fails the suite if quality drops.
import test from 'node:test';
import assert from 'node:assert/strict';
import { houseStyleFindings } from '../runtime/venture/records.ts';
import { validateRules, type Ballot, type JudgeTrace, type RulesAsk } from '../runtime/venture/delivery/judge/index.ts';
import {
  YOUTUBE_DRAFT_RULES, judgeYoutubeDraft, loadYoutubeBaseline, runYoutubeBaseline, packageTextFailures, type YoutubeCheckResult,
} from '../runtime/venture/playbooks/youtube/index.ts';

const trace: JudgeTrace = { events: [
  { id: 'ev-1', kind: 'file', summary: 'Read transcript.srt: 3 cues.' },
  { id: 'ev-2', kind: 'check', summary: 'Code checks on the package.' },
  { id: 'ev-3', kind: 'draft', summary: 'Packager wrote the title, description and chapters.' },
] };
const pass = (check: YoutubeCheckResult['check']): YoutubeCheckResult => ({ check, outcome: 'pass', detail: 'ok', notes: [] });
const passing = [pass('hook-score'), pass('title-thumbnail'), pass('chapters'), pass('ai-disclosure'), pass('rights-recorded')];
const yesBallot = (): Ballot => YOUTUBE_DRAFT_RULES.map(rule => ({ rule: rule.id, answer: 'yes', cites: ['ev-1', 'ev-3'], quote: '', reason: 'The trace shows it.' }));
const asking = (ballot: () => Ballot): RulesAsk & { calls: number } => {
  const ask = (async () => { ask.calls += 1; return { value: ballot(), callId: `call-${ask.calls}` }; }) as unknown as RulesAsk & { calls: number };
  ask.calls = 0;
  return ask;
};
const DRAFT = 'Title: I Tested 7 Budget Mics for Podcasts\nThumbnail: WORTH IT?\nDescription:\n0:00 Intro\n0:45 Room sound\n2:10 Questions';

test('judge rules: yes or no questions with their own floors; faithfulness, disclosure and unbacked claims need every vote', () => {
  const rules = validateRules(YOUTUBE_DRAFT_RULES);
  assert.ok(rules.length >= 6);
  const by = Object.fromEntries(rules.map(rule => [rule.id, rule]));
  for (const id of ['faithful-to-source', 'disclosure-kept', 'no-unbacked-claims', 'no-sponsor-read-as-talk']) assert.equal(by[id].floor.kind, 'required-yes', id);
  for (const id of ['self-contained', 'opening-has-context', 'ending-completes', 'title-supported', 'ready-for-client']) assert.equal(by[id].floor.kind, 'share', id);
  for (const rule of rules) assert.deepEqual(houseStyleFindings(`${rule.text} ${rule.question}`), [], rule.id);
});

test('a failed code check fails the draft and the model is never asked', async () => {
  const ask = asking(yesBallot);
  const verdict = await judgeYoutubeDraft(ask, { draft: DRAFT, trace, code: [...passing, { check: 'chapters', outcome: 'fail', detail: 'The first chapter must start at 0:00.', notes: [] }], containsClientData: true });
  assert.equal(verdict.outcome, 'fail');
  assert.equal(verdict.asked, false);
  assert.equal(ask.calls, 0);
  assert.match(verdict.detail, /0:00/);
});

test('code checks pass and every rule gets checked yes votes: the draft passes; a no that quotes its rule fails it', async () => {
  const ask = asking(yesBallot);
  const verdict = await judgeYoutubeDraft(ask, { draft: DRAFT, trace, code: passing, containsClientData: true, samples: 3 });
  assert.equal(verdict.outcome, 'pass');
  assert.equal(ask.calls, 3);
  assert.equal(verdict.rules!.outcome, 'pass');

  const faithful = YOUTUBE_DRAFT_RULES.find(rule => rule.id === 'faithful-to-source')!;
  const one = asking(() => yesBallot().map(vote => vote.rule === faithful.id ? { ...vote, answer: 'no' as const, quote: faithful.text, cites: ['ev-1'] } : vote));
  const failed = await judgeYoutubeDraft(one, { draft: DRAFT, trace, code: passing, containsClientData: true });
  assert.equal(failed.outcome, 'fail');
  assert.match(failed.detail, /faithful-to-source/);

  const uncited = asking(() => yesBallot().map(vote => ({ ...vote, cites: ['ev-404'] })));
  assert.equal((await judgeYoutubeDraft(uncited, { draft: DRAFT, trace, code: passing, containsClientData: true })).outcome, 'unverified');
});

test('a code check that did not run, or no AI judge, leaves the draft unverified, never passed', async () => {
  const notRun: YoutubeCheckResult = { check: 'finishing', outcome: 'not-run', detail: 'not run: ffmpeg not found', notes: [] };
  const verdict = await judgeYoutubeDraft(asking(yesBallot), { draft: DRAFT, trace, code: [...passing, notRun], containsClientData: true });
  assert.equal(verdict.outcome, 'unverified');
  assert.match(verdict.detail, /ffmpeg not found/);
  const noAi = await judgeYoutubeDraft(null, { draft: DRAFT, trace, code: passing, containsClientData: true });
  assert.equal(noAi.outcome, 'unverified');
  assert.equal(noAi.asked, false);
});

test('baseline: the committed file loads, every held-back case passes, and the rate meets the baseline', async () => {
  const file = await loadYoutubeBaseline();
  assert.equal(file.playbook, 'youtube');
  assert.ok(file.cases.length >= 6);
  assert.equal(file.baseline.passed, file.baseline.of);
  const suite = await runYoutubeBaseline(file);
  assert.equal(suite.ok, true, JSON.stringify(suite.cases.filter(item => !item.passed)));
  assert.equal(suite.passed, suite.of);
});

test('baseline: a worse playbook drops below the baseline and the suite fails', async () => {
  const file = await loadYoutubeBaseline();
  const worse = await runYoutubeBaseline(file, item => item.reference.replace(/\b0:00\b/, '0:05').replace(/We have not posted|Nothing has been posted/i, 'We uploaded it'));
  assert.equal(worse.ok, false);
  assert.match(worse.detail, /Quality dropped/);
  const broken = worse.cases.filter(item => !item.passed);
  assert.ok(broken.some(item => item.failures.some(line => /0:00/.test(line))), JSON.stringify(broken));
  // A title that invents a figure the transcript never said fails on the claim check alone.
  const invented = await runYoutubeBaseline(file, item => item.reference.replace('I Tested 7 Budget Mics', 'I Tested 12 Budget Mics'));
  const episode = invented.cases.find(item => item.id === 'episode-own-footage')!;
  assert.equal(episode.passed, false);
  assert.ok(episode.failures.some(line => /"12"/.test(line)), episode.failures.join(' | '));
});

test('package text failures: a thumbnail that repeats the title and chapters off 0:00 are caught from the text alone', () => {
  assert.deepEqual(packageTextFailures(DRAFT), []);
  assert.ok(packageTextFailures('Title: Editing Guide for Podcasts\nThumbnail: Editing Guide').some(line => /repeats the title/.test(line)));
  assert.ok(packageTextFailures('Title: Room Sound\nDescription:\n0:05 Intro\n0:45 Room\n2:10 Mics').some(line => /0:00/.test(line)));
  assert.deepEqual(packageTextFailures('We can only cut footage you own or have a licence for.'), [], 'a reply with no package lines has nothing to lint');
});
