// YouTube channel playbook: the deterministic checks. Code only, no model. Hook scores, title and thumbnail pairing,
// metadata limits, chapter rules, retention risks from a transcript (and the Studio retention export), disclosure of
// AI voice or presenter, the paid promotion setting, rights for clipping, the source credit, and the edit list built
// only from transcript segment ids. Golden values for the hook and title scorers come from running the original
// MIT scripts (Jakeschincariol/youtube-agent-skill) on the same lines.
import test from 'node:test';
import assert from 'node:assert/strict';
import { recordRights } from '../runtime/venture/delivery/rights.ts';
import {
  hookScore, rankHooks, titleThumbnail, parseChapters, draftChapters, retentionRisks, readRetentionExport, parseTranscript,
  buildEditList, runYoutubeChecks, youtubeChecksOutcome, parsePackageText, type YoutubeOrder, type YoutubePackage,
} from '../runtime/venture/playbooks/youtube/index.ts';

const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected, error?.message); return true; };
const meta = { by: 'owner', at: '2026-10-21T10:00:00.000Z' };
const TODAY = '2026-10-21';

test('hook score: five properties, 60% the mean and 40% the weakest, matching the original scorer', () => {
  const golden: [string, number[], number, string][] = [
    ['Hey guys, welcome back to the channel', [14, 26, 22, 24, 78], 25, 'weak'],
    ['Why do 9 out of 10 home bakers ruin their sourdough before the oven?', [78, 26, 62, 76, 100], 51, 'weak'],
    ['This is the best video ever', [13, 26, 22, 24, 67], 23, 'weak'],
    ['Stop wasting 3 hours a week on invoices you could send in 10 minutes', [78, 46, 88, 24, 100], 50, 'weak'],
    ['You are losing 40% of viewers in the first 30 seconds, and nobody tells you why', [78, 96, 36, 58, 100], 59, 'workable'],
  ];
  for (const [hook, props, verdict, band] of golden) {
    const score = hookScore(hook);
    assert.deepEqual([score.properties.specificity, score.properties.address, score.properties.stakes, score.properties.curiosity, score.properties.brevity], props, hook);
    assert.equal(score.verdict, verdict, hook);
    assert.equal(score.band, band, hook);
  }
  assert.equal(hookScore('This is the best video ever').weakest, 'specificity');
  const ranked = rankHooks(golden.map(row => row[0]));
  assert.equal(ranked[0].hook, golden[4][0]);
  assert.equal(rankHooks(golden.map(row => row[0]), 2).length, 2);
});

test('title and thumbnail: one pair; a repeat, shouting or a title over the hard limit blocks, the rest are notes', () => {
  const good = titleThumbnail('I Tested 7 Budget Mics for Podcasts', 'WORTH IT?');
  assert.equal(good.score, 100);
  assert.deepEqual(good.issues, []);
  assert.equal(good.blocked, false);
  const bad = titleThumbnail('The ULTIMATE AMAZING Guide To EVERYTHING You Need To Know About Editing Videos', 'Editing Guide');
  assert.equal(bad.score, 16);
  assert.deepEqual(bad.issues.map(issue => issue.kind), ['length', 'mobile', 'shouting', 'vague', 'no-number', 'duplicate']);
  assert.match(bad.issues.find(issue => issue.kind === 'duplicate')!.detail, /editing, guide/);
  assert.equal(bad.blocked, true);
  assert.deepEqual(bad.issues.filter(issue => issue.blocks).map(issue => issue.kind), ['shouting', 'duplicate']);
  const long = titleThumbnail('A'.repeat(101), null);
  assert.equal(long.blocked, true);
  assert.equal(titleThumbnail('Why <b>this</b> works in 3 steps', null).blocked, true, 'YouTube refuses < and > in a title');
});

test('chapters: parsed from the description; first at 0:00, at least three, ascending, each at least ten seconds', () => {
  const description = 'What we cover.\n\n0:00 Intro\n0:45 Picking a mic\n2:10 Room sound\n1:02:03 Questions';
  const chapters = parseChapters(description);
  assert.deepEqual(chapters.map(item => item.atMs), [0, 45000, 130000, 3723000]);
  assert.deepEqual(chapters.map(item => item.label), ['Intro', 'Picking a mic', 'Room sound', 'Questions']);
  const run = (text: string, durationMs: number | null = null) => runYoutubeChecks({ checks: ['chapters'], order: order(), pkg: pkg({ description: text, durationMs }), transcript: null, today: TODAY })[0];
  assert.equal(run(description, 3800000).outcome, 'pass');
  assert.match(run('0:05 Intro\n0:45 Mics\n2:10 Room').detail, /0:00/);
  assert.match(run('0:00 Intro\n0:45 Mics').detail, /three/);
  assert.match(run('0:00 Intro\n0:05 Mics\n2:10 Room').detail, /ten seconds/);
  assert.match(run('0:00 Intro\n2:10 Room\n0:45 Mics').detail, /order/);
  assert.match(run('0:00 Intro\n0:45 Mics\n2:10 Room', 135000).detail, /ten seconds/, 'the last chapter is measured against the video length');
  assert.match(run('A description with no chapters at all.').detail, /chapters/);
  // A Short does not need chapters.
  assert.equal(runYoutubeChecks({ checks: ['chapters'], order: order({ offer: 'shorts-from-own-video', format: 'short', rights: rights('own-footage') }), pkg: pkg({ description: 'No chapters.' }), transcript: null, today: TODAY })[0].outcome, 'pass');
});

const SRT = `1
00:00:00,000 --> 00:00:03,200
Hey guys, welcome back to the channel.

2
00:00:03,400 --> 00:00:07,000
Today you will learn why your mic sounds thin.

3
00:00:07,100 --> 00:00:08,000
um, so yeah

4
00:00:11,000 --> 00:00:14,500
The first reason is the room you record in.

5
00:00:14,600 --> 00:00:16,000
The first reason is the, uh, the room

6
00:00:16,100 --> 00:00:20,000
The first reason is the room itself, with bare walls.
`;

test('transcript: SRT, VTT and Whisper JSON parse to whole milliseconds with segment ids', () => {
  const cues = parseTranscript(SRT);
  assert.equal(cues.length, 6);
  assert.deepEqual(cues[1], { id: 'seg-2', startMs: 3400, endMs: 7000, text: 'Today you will learn why your mic sounds thin.' });
  const vtt = parseTranscript('WEBVTT\n\n00:01.500 --> 00:04.000\nHello there\n\n01:00:00.250 --> 01:00:02.000 align:start\nLate line');
  assert.deepEqual(vtt.map(cue => [cue.startMs, cue.endMs]), [[1500, 4000], [3600250, 3602000]]);
  const json = parseTranscript(JSON.stringify({ segments: [{ start: 0.5, end: 1.25, text: ' Hi ' }] }));
  assert.deepEqual(json[0], { id: 'seg-1', startMs: 500, endMs: 1250, text: 'Hi' });
  assert.deepEqual(parseTranscript('nothing here'), []);
});

test('retention risks: the greeting in the opening and a long silence are cliffs; filler and restarts are trims', () => {
  const findings = retentionRisks(parseTranscript(SRT));
  const kinds = findings.map(item => `${item.kind}:${item.severity}`);
  assert.ok(kinds.includes('intro-filler:cliff'), kinds.join());
  assert.ok(kinds.includes('dead-air:cliff'), kinds.join());
  assert.ok(kinds.includes('filler:trim'), kinds.join());
  assert.ok(kinds.includes('restart:trim'), kinds.join());
  const dead = findings.find(item => item.kind === 'dead-air')!;
  assert.deepEqual([dead.atMs, dead.endMs], [8000, 11000]);
  const result = runYoutubeChecks({ checks: ['retention-risk'], order: order(), pkg: pkg(), transcript: parseTranscript(SRT), today: TODAY })[0];
  assert.equal(result.outcome, 'fail');
  assert.ok(result.notes.length >= 2);
  const clean = parseTranscript('00:00:00,000 --> 00:00:04,000\nYour mic sounds thin for one reason.\n\n00:00:04,200 --> 00:00:08,000\nIt is the room, not the mic.');
  assert.equal(runYoutubeChecks({ checks: ['retention-risk'], order: order(), pkg: pkg(), transcript: clean, today: TODAY })[0].outcome, 'pass');
  assert.equal(runYoutubeChecks({ checks: ['retention-risk'], order: order(), pkg: pkg(), transcript: null, today: TODAY })[0].outcome, 'not-run');
  const late = parseTranscript('00:00:02,500 --> 00:00:05,000\nFinally, the point.');
  assert.ok(retentionRisks(late).some(item => item.kind === 'late-start' && item.severity === 'cliff'));
});

test('Studio retention export: hook leak, the steepest cliffs with what was said, and the slide', () => {
  const csv = ['Video position (%),Audience retention (%)', '0,100', '1,92', '2,80', '3,74', '5,73', '10,71', '20,69', '30,66', '40,58', '50,57', '60,56', '80,54', '100,50'].join('\n');
  const report = readRetentionExport(csv, { durationMs: 200000, cues: parseTranscript('00:00:58,000 --> 00:01:05,000\nNow a word from our sponsor') });
  assert.equal(report.points, 13);
  assert.equal(report.hookLeak, '29.00');
  assert.equal(report.verdict, 'leaking');
  assert.equal(report.cliffs[0].from, '1.00');
  assert.equal(report.cliffs[0].lost, '12.00');
  const sponsor = report.cliffs.find(cliff => cliff.from === '30.00')!;
  assert.equal(sponsor.atSeconds, 60);
  assert.equal(sponsor.lost, '8.00');
  assert.match(sponsor.said!, /sponsor/);
  assert.equal(report.cliffs[0].said, null, 'nothing was being said at the first cliff');
  assert.ok(report.cliffs.every(cliff => Number(cliff.lost) > 0.8));
  assert.throws(() => readRetentionExport('a,b\n1,2'), /eight/);
});

test('disclosure: an AI voice or presenter must be named in the description and the AI use setting ticked', () => {
  const ai = order({ aiVoice: true });
  const run = (p: Partial<YoutubePackage>, o: YoutubeOrder = ai) => runYoutubeChecks({ checks: ['ai-disclosure'], order: o, pkg: pkg(p), transcript: null, today: TODAY })[0];
  assert.equal(run({}, order()).outcome, 'pass');
  assert.equal(run({}).outcome, 'fail');
  assert.equal(run({ description: `${pkg().description}\n\nThis video uses an AI voice.` }).outcome, 'fail', 'the upload setting is needed too');
  assert.equal(run({ description: `${pkg().description}\n\nThis video uses an AI voice.`, uploadSettings: { aiUse: true, paidPromotion: false } }).outcome, 'pass');
  const both = order({ aiVoice: true, aiPresenter: true });
  assert.match(run({ description: 'Uses an AI voice.', uploadSettings: { aiUse: true, paidPromotion: false } }, both).detail, /AI presenter/);
  const paid = runYoutubeChecks({ checks: ['paid-promotion'], order: order({ paidPromotion: true }), pkg: pkg(), transcript: null, today: TODAY })[0];
  assert.equal(paid.outcome, 'fail');
});

test('rights: clipping needs rights recorded at intake that the offer accepts and that have not ended', () => {
  const run = (o: YoutubeOrder) => runYoutubeChecks({ checks: ['rights-recorded'], order: o, pkg: pkg(), transcript: null, today: TODAY })[0];
  assert.equal(run(order()).outcome, 'pass');
  assert.equal(run(order({ rights: null })).outcome, 'fail');
  assert.match(run(order({ offer: 'licensed-clips', rights: rights('own-footage') })).detail, /licence|clip programme/);
  assert.equal(run(order({ offer: 'licensed-clips', rights: rights('creator-clip-programme', 'https://creator.example/clip-programme') })).outcome, 'pass');
  const ended = recordRights({ basis: 'licence', holder: 'Stock House', reference: 'LIC-77', expiresOn: '2026-01-31' }, meta);
  assert.match(run(order({ rights: ended })).detail, /ended/);
});

test('source credit: licensed clips name the holder and the reference in every description', () => {
  const clips = order({ offer: 'licensed-clips', format: 'short', rights: rights('creator-clip-programme', 'https://creator.example/clip-programme') });
  const run = (description: string) => runYoutubeChecks({ checks: ['source-credit'], order: clips, pkg: pkg({ description }), transcript: null, today: TODAY })[0];
  assert.equal(run('A great moment.').outcome, 'fail');
  assert.equal(run('A great moment.\nClip from The Big Show, used under https://creator.example/clip-programme').outcome, 'pass');
  assert.equal(runYoutubeChecks({ checks: ['source-credit'], order: order(), pkg: pkg(), transcript: null, today: TODAY })[0].outcome, 'pass');
});

test('metadata limits: title characters, description bytes and tags, from the dated register', () => {
  const run = (p: Partial<YoutubePackage>) => runYoutubeChecks({ checks: ['metadata-limits'], order: order(), pkg: pkg(p), transcript: null, today: TODAY })[0];
  assert.equal(run({}).outcome, 'pass');
  assert.equal(run({ description: 'é'.repeat(2501) }).outcome, 'fail', '5002 bytes');
  assert.equal(run({ description: 'é'.repeat(2500) }).outcome, 'pass');
  assert.equal(run({ tags: ['a'.repeat(250), 'b'.repeat(251)] }).outcome, 'fail');
  assert.equal(run({ description: 'Use <script> here' }).outcome, 'fail');
});

test('edit list: built only from transcript segment ids, snapped up to frames, refused without rights', () => {
  const cues = parseTranscript(SRT);
  const intake = { rights: rights('own-footage') };
  const list = buildEditList(cues, [{ from: 'seg-2', to: 'seg-2' }, { from: 'seg-4', to: 'seg-6' }], { fps: 30, intake, today: TODAY });
  assert.deepEqual(list.ranges.map(r => [r.startFrame, r.endFrame]), [[102, 210], [330, 600]]);
  assert.equal(list.fps, 30);
  assert.equal(list.runtimeFrames, 378);
  assert.throws(() => buildEditList(cues, [{ from: 'seg-9', to: 'seg-9' }], { fps: 30, intake, today: TODAY }), /seg-9/);
  assert.throws(() => buildEditList(cues, [{ from: 'seg-4', to: 'seg-2' }], { fps: 30, intake, today: TODAY }), /before/);
  assert.throws(() => buildEditList(cues, [{ from: 'seg-2', to: 'seg-4' }, { from: 'seg-3', to: 'seg-5' }], { fps: 30, intake, today: TODAY }), /overlap/);
  assert.throws(() => buildEditList(cues, [{ from: 'seg-2', to: 'seg-2' }], { fps: 30, intake: { rights: null }, today: TODAY }), code('RIGHTS_REQUIRED'));
});

test('draft chapters from a transcript are valid by the platform rules, and a package parses from text', () => {
  const lines: string[] = [];
  const topics = ['microphone placement distance', 'room treatment blankets', 'gain staging levels', 'editing noise removal'];
  let at = 0;
  for (const [index, topic] of topics.entries()) {
    for (let n = 0; n < 6; n += 1) { lines.push(`${stamp(at)} --> ${stamp(at + 4000)}\n${topic} detail ${n}`); at += 4200; }
    if (index < topics.length - 1) at += 3000;
  }
  const drafted = draftChapters(parseTranscript(lines.join('\n\n')), 4);
  assert.equal(drafted.valid, true);
  assert.equal(drafted.chapters[0].atMs, 0);
  assert.ok(drafted.chapters.length >= 3);
  const parsed = parsePackageText('Title: I Tested 7 Budget Mics\nThumbnail: WORTH IT?\nPinned comment: Which mic do you use?\nDescription:\nWhat we cover.\n0:00 Intro\n0:45 Mics\n2:10 Room');
  assert.equal(parsed.title, 'I Tested 7 Budget Mics');
  assert.equal(parsed.thumbnailText, 'WORTH IT?');
  assert.equal(parsed.pinnedComment, 'Which mic do you use?');
  assert.equal(parseChapters(parsed.description).length, 3);
});

test('every check runs in the order asked, and the outcome counts a check that did not run as not passed', () => {
  const results = runYoutubeChecks({
    checks: ['hook-score', 'title-thumbnail', 'metadata-limits', 'chapters', 'ai-disclosure', 'paid-promotion', 'rights-recorded', 'source-credit', 'retention-risk'],
    order: order(), pkg: pkg(), transcript: null, today: TODAY,
  });
  assert.deepEqual(results.map(r => r.check), ['hook-score', 'title-thumbnail', 'metadata-limits', 'chapters', 'ai-disclosure', 'paid-promotion', 'rights-recorded', 'source-credit', 'retention-risk']);
  assert.deepEqual(results.filter(r => r.outcome !== 'pass').map(r => r.check), ['retention-risk']);
  assert.equal(youtubeChecksOutcome(results), 'incomplete');
  assert.equal(youtubeChecksOutcome(results.slice(0, 8)), 'pass');
  const weak = runYoutubeChecks({ checks: ['hook-score'], order: order(), pkg: pkg({ hooks: ['Hey guys, welcome back to the channel'] }), transcript: null, today: TODAY });
  assert.equal(weak[0].outcome, 'fail');
  assert.equal(youtubeChecksOutcome([...results.slice(0, 8), ...weak]), 'fail');
  assert.equal(runYoutubeChecks({ checks: ['finishing'], order: order(), pkg: pkg(), transcript: null, today: TODAY })[0].outcome, 'not-run');
});

function stamp(ms: number): string {
  const pad = (value: number, size = 2) => String(value).padStart(size, '0');
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
}

function rights(basis: 'own-footage' | 'licence' | 'creator-clip-programme', reference: string | null = null) {
  return recordRights({ basis, holder: basis === 'own-footage' ? 'Asha Rao' : 'The Big Show', reference: reference ?? (basis === 'own-footage' ? null : 'LIC-2026-14') }, meta);
}

function order(change: Partial<YoutubeOrder> = {}): YoutubeOrder {
  return { offer: 'episode-package', format: 'long', rights: rights('own-footage'), aiVoice: false, aiPresenter: false, paidPromotion: false, ...change };
}

function pkg(change: Partial<YoutubePackage> = {}): YoutubePackage {
  return {
    title: 'I Tested 7 Budget Mics for Podcasts',
    thumbnailText: 'WORTH IT?',
    description: 'Seven mics under one roof, tested in a bare room and a treated one.\n\n0:00 Intro\n0:45 Picking a mic\n2:10 Room sound',
    tags: ['podcast mic', 'budget microphone'],
    hooks: ['You are losing 40% of viewers in the first 30 seconds, and nobody tells you why'],
    pinnedComment: 'Which mic are you using right now?',
    durationMs: 600000,
    uploadSettings: { aiUse: false, paidPromotion: false },
    ...change,
  };
}
