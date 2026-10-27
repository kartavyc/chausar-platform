// The captions core (Ink v2 wave 5, package 5A4; catalogue Y4's core): cues grouped from word times with balanced
// lines, no single-word line, a reading-speed cap, a minimum and maximum duration and a two-frame gap per profile (web,
// broadcast, 9:16, values as dated house rules), breaks at sentence, clause or pause. Findings are codes with cue ids
// and a fix hint, never the text; checks that cannot run are listed; editing a word never moves timing; SRT and VTT
// escape <, & and arrow lines. YouTube, translation, social reels, narration and demo videos all read it.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CAPTION_PROFILES, CAPTION_RULES, editCueWord, groupCues, toSrt, toVtt, validateCues, type CaptionCue, type TimedWord,
} from '../runtime/venture/playbooks/kit/captions.ts';
import { parseTranscript } from '../runtime/venture/playbooks/youtube/transcript.ts';

/** Words spoken one after another, each `each` ms long with `gap` ms between, from `start`. */
function spoken(text: string, start = 0, each = 360, gap = 40): TimedWord[] {
  return text.split(' ').map((word, index) => ({ text: word, startMs: start + index * (each + gap), endMs: start + index * (each + gap) + each }));
}

test('captions: each profile reads its values from dated house rules, with a source line and a checked date', () => {
  for (const id of ['web', 'broadcast', 'vertical'] as const) {
    const profile = CAPTION_PROFILES[id];
    assert.ok(profile.maxLineChars > 0 && profile.maxLines >= 1 && profile.maxCps > 0, id);
    assert.ok(profile.minDurationMs < profile.maxDurationMs, id);
    assert.equal(profile.gapFrames, 2, 'a two-frame gap on every profile');
  }
  assert.ok(CAPTION_PROFILES.vertical.maxLineChars < CAPTION_PROFILES.web.maxLineChars, '9:16 lines are shorter');
  for (const rule of CAPTION_RULES) {
    assert.equal(rule.read, 'house');
    assert.match(rule.checkedOn, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(rule.value && rule.unit, rule.id);
    assert.ok(rule.usedBy.length > 0, rule.id);
  }
});

test('captions: cues break at a sentence end and at a pause, never run past the most characters, and keep a two-frame gap', () => {
  const words = [
    ...spoken('Budgets start small. Write down what you spend', 0),
    // a pause of 1.5 seconds before the next words
    ...spoken('then look at the list on Sunday evening with your family', 4200),
  ];
  const cues = groupCues(words, 'web');
  assert.ok(cues.length >= 3);
  assert.equal(cues[0].lines.join(' '), 'Budgets start small.', 'a sentence end closes the cue');
  const before = cues.findIndex(cue => cue.lines.join(' ').endsWith('spend'));
  assert.ok(before > 0, 'the pause closes a cue');
  assert.ok(cues[before + 1].lines.join(' ').startsWith('then'));
  const profile = CAPTION_PROFILES.web;
  const gapMs = Math.ceil(profile.gapFrames * 1000 / profile.fps);
  for (const [index, cue] of cues.entries()) {
    assert.equal(cue.id, `c${index + 1}`);
    assert.ok(cue.lines.length <= profile.maxLines);
    for (const line of cue.lines) assert.ok(line.length <= profile.maxLineChars, line);
    if (index > 0) assert.ok(cue.startMs - cues[index - 1].endMs >= gapMs, 'two frames between cues');
  }
  assert.deepEqual(validateCues(cues, 'web').findings, []);
});

test('captions: lines are balanced, a cue never ends with a one-word line, and one stray word joins its neighbour', () => {
  const words = spoken('An emergency fund grows from small steps that you repeat every single week of the year', 0, 200, 20);
  const cues = groupCues(words, 'web');
  for (const cue of cues) {
    if (cue.lines.length === 2) {
      assert.ok(Math.abs(cue.lines[0].length - cue.lines[1].length) <= 14, `balanced: ${cue.lines.join(' | ')}`);
      for (const line of cue.lines) assert.ok(line.includes(' '), 'no single-word line');
    }
  }
  // "Okay." alone is a sentence of one word: it joins the next cue rather than flash by on its own.
  const stray = groupCues([...spoken('Okay.', 0), ...spoken('Now we count the money we spent', 400)], 'web');
  assert.ok(stray.every(cue => cue.lines.join(' ').split(' ').length > 1), JSON.stringify(stray.map(cue => cue.lines)));
});

test('captions: the reading speed is capped by extending the cue into the silence after it, never into the next cue', () => {
  // Thirty-odd characters said in 600 ms is far too fast to read; the next words start 3 seconds later.
  const words = [...spoken('Spend less than you earn always', 0, 90, 10), ...spoken('Then save the rest of it', 3600)];
  const cues = groupCues(words, 'web');
  const first = cues[0];
  const chars = first.lines.join(' ').length;
  assert.ok(chars * 1000 / (first.endMs - first.startMs) <= CAPTION_PROFILES.web.maxCps, 'extended to a readable length');
  assert.ok(first.endMs <= cues[1].startMs - 80);
});

test('captions: the validator returns codes with cue ids and a fix hint, never the words, and lists checks that could not run', () => {
  const bad: CaptionCue[] = [
    { id: 'c1', startMs: 0, endMs: 300, lines: ['Our secret recipe for crispy samosas every time'], words: null },
    { id: 'c2', startMs: 310, endMs: 9000, lines: ['A', 'very long cue'], words: null },
    { id: 'c3', startMs: 8000, endMs: 9500, lines: ['Overlaps', 'the one before', 'and has three lines'], words: null },
  ];
  const { findings, notRun } = validateCues(bad, 'web');
  const codes = (cueId: string) => findings.filter(item => item.cueId === cueId).map(item => item.code).sort();
  assert.deepEqual(codes('c1'), ['line-too-long', 'too-fast', 'too-short']);
  assert.deepEqual(codes('c2'), ['gap-too-small', 'single-word-line', 'too-long']);
  assert.ok(codes('c3').includes('overlap') && codes('c3').includes('too-many-lines'));
  for (const finding of findings) {
    assert.ok(finding.fix.length > 0);
    for (const word of ['secret', 'samosas', 'Overlaps', 'very long']) assert.ok(!finding.fix.includes(word) && !JSON.stringify(finding).includes(word), 'never quotes the text');
  }
  assert.deepEqual(notRun.map(item => item.check), ['pause-breaks'], 'with no word times, breaks at pauses are not checked');
  assert.match(notRun[0].why, /word times/);
  assert.deepEqual(validateCues(groupCues(spoken('Save a little every week'), 'web'), 'web').notRun, []);
});

test('captions: editing a word changes the text only; every cue keeps its timing', () => {
  const cues = groupCues(spoken('Pay the smallest debt first. Then the next one after that'), 'web');
  const edited = editCueWord(cues, 'c1', 2, 'tiniest');
  assert.deepEqual(edited.map(cue => [cue.startMs, cue.endMs]), cues.map(cue => [cue.startMs, cue.endMs]));
  assert.ok(edited[0].lines.join(' ').includes('tiniest'));
  assert.equal(edited[0].words![2].text, 'tiniest');
  assert.equal(edited[0].words![2].startMs, cues[0].words![2].startMs);
  assert.ok(!cues[0].lines.join(' ').includes('tiniest'), 'the input is not changed');
  assert.throws(() => editCueWord(cues, 'c1', 99, 'x'), (error: any) => error.code === 'INVALID_VENTURE_REQUEST');
});

test('captions: SRT and VTT escape <, & and arrow lines, so a line of text is never read as a timing line or a tag', () => {
  const cues: CaptionCue[] = [
    { id: 'c1', startMs: 1000, endMs: 3500, lines: ['Tom & Jerry <b>live</b>', 'a --> b'], words: null },
    { id: 'c2', startMs: 3600, endMs: 3661001, lines: ['Last one'], words: null },
  ];
  const srt = toSrt(cues);
  assert.equal(srt, '1\n00:00:01,000 --> 00:00:03,500\nTom &amp; Jerry &lt;b>live&lt;/b>\na --&gt; b\n\n2\n00:00:03,600 --> 01:01:01,001\nLast one\n');
  const vtt = toVtt(cues);
  assert.ok(vtt.startsWith('WEBVTT\n\n'));
  assert.ok(vtt.includes('00:00:01.000 --> 00:00:03.500\nTom &amp; Jerry &lt;b>live&lt;/b>\na --&gt; b\n'));
  for (const text of [srt, vtt]) {
    const back = parseTranscript(text);
    assert.equal(back.length, 2, 'the arrow inside the text makes no extra cue');
    assert.equal(back[0].startMs, 1000);
    assert.equal(back[1].endMs, 3661001);
  }
  // A blank line inside a cue would end it early: it is dropped.
  assert.equal(toSrt([{ id: 'c1', startMs: 0, endMs: 1000, lines: ['One', '', 'Two'], words: null }]), '1\n00:00:00,000 --> 00:00:01,000\nOne\nTwo\n');
});

test('captions: a cue closes when its words cannot be split into lines that fit, so no cue is grouped past what it can show', () => {
  // 9:16: 26 characters a line, two lines. Fifty-two characters fit in all, but "24 + bb" and "bb + 24" are each too long.
  const long = (letter: string) => letter.repeat(24);
  const words = [
    { text: long('a'), startMs: 0, endMs: 900 }, { text: 'bb', startMs: 950, endMs: 1100 }, { text: long('c'), startMs: 1150, endMs: 2000 },
  ];
  const cues = groupCues(words, 'vertical');
  assert.ok(cues.length >= 2, JSON.stringify(cues.map(cue => cue.lines)));
  for (const cue of cues) for (const line of cue.lines) assert.ok(line.length <= CAPTION_PROFILES.vertical.maxLineChars, line);
  const codes = validateCues(cues, 'vertical').findings.map(item => item.code);
  assert.ok(!codes.includes('line-too-long') && !codes.includes('too-many-lines'), codes.join());
});
