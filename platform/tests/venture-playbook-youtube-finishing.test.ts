// YouTube channel playbook: the finishing check on a cut. It runs ffmpeg's own detectors (black, frozen, silent spans,
// sound levels) and reads the length and frame, only when ffmpeg is already on PATH. Chausar never installs it: when it
// is missing the check says "not run: ffmpeg not found" and never counts as a pass. Captions over a face are checked
// only when face boxes are given; there is no face detector here, and the check says so.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  captionBand, captionsOverFace, finishingCheck, finishingResult, findOnPath, parseFfmpegLog, type FfmpegPort,
} from '../runtime/venture/playbooks/youtube/index.ts';

const HEAD = `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'cut.mp4':
  Duration: 00:00:04.50, start: 0.000000, bitrate: 21 kb/s
  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(progressive), 1080x1920 [SAR 1:1 DAR 9:16], 15 kb/s, 30 fps, 30 tbr, 10240 tbn (default)
  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 16000 Hz, mono, fltp, 0 kb/s (default)
Stream mapping:
  Stream #0:0 -> #0:0 (h264 (native) -> wrapped_avframe (native))
Output #0, null, to 'pipe:':
  Stream #0:0(und): Video: wrapped_avframe, yuv420p(progressive), 1080x1920 [SAR 1:1 DAR 9:16], q=2-31, 200 kb/s, 30 fps, 30 tbn (default)
`;
const VIDEO_BLACK = `${HEAD}[Parsed_blackdetect_0 @ 00000205abfcbd40] black_start:0 black_end:1.5 black_duration:1.5\n`;
const VIDEO_FROZEN = `${HEAD}[Parsed_freezedetect_1 @ 000002a682f63740] lavfi.freezedetect.freeze_start: 1\n`;
const AUDIO_SILENT = `${HEAD}[Parsed_volumedetect_1 @ 0001] n_samples: 0
[Parsed_silencedetect_0 @ 0002] silence_start: 0
[Parsed_silencedetect_0 @ 0002] silence_end: 4.544 | silence_duration: 4.544
[Parsed_volumedetect_1 @ 0003] n_samples: 72704
[Parsed_volumedetect_1 @ 0003] mean_volume: -91.0 dB
[Parsed_volumedetect_1 @ 0003] max_volume: -91.0 dB
`;
const audio = (mean: string, max: string) => `${HEAD}[Parsed_volumedetect_1 @ 0003] mean_volume: ${mean} dB\n[Parsed_volumedetect_1 @ 0003] max_volume: ${max} dB\n`;

/** A port that finds ffmpeg and answers with recorded logs: the first run is the video pass, the second the audio pass. */
function recorded(video: string, sound: string): FfmpegPort & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    locate: () => 'ffmpeg',
    run: async (_binary, args) => { calls.push([...args]); return { code: 0, stderr: args.includes('-an') ? video : sound, timedOut: false, startError: null }; },
  };
}
const missing: FfmpegPort = { locate: () => null, run: async () => { throw new Error('never called'); } };
const exists = () => true;

test('ffmpeg not on PATH: the check does not run, says so, and is never a pass', async () => {
  const report = await finishingCheck('cut.mp4', { format: 'short', ffmpeg: missing, exists });
  assert.equal(report.verdict, 'not-run');
  assert.equal(report.ran, false);
  assert.equal(report.detail, 'not run: ffmpeg not found');
  const result = finishingResult(report);
  assert.deepEqual([result.check, result.outcome, result.detail], ['finishing', 'not-run', 'not run: ffmpeg not found']);
});

test('PATH lookup finds ffmpeg by name, with Windows extensions, and never anything else', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'chausar-yt-path-'));
  try {
    await writeFile(join(dir, 'ffmpeg.exe'), '');
    assert.equal(findOnPath('ffmpeg', { Path: `C:\\nowhere;${dir}`, PATHEXT: '.COM;.EXE' }, 'win32'), join(dir, 'ffmpeg.exe'));
    assert.equal(findOnPath('ffmpeg', { Path: dir, PATHEXT: '.COM' }, 'win32'), null, 'only the extensions PATHEXT names');
    assert.equal(findOnPath('ffprobe', { Path: dir }, 'win32'), null);
    assert.equal(findOnPath('ffmpeg', {}, 'linux'), null);
    // A Linux PATH separates folders with a colon, so this half runs only where folder names have no drive letter.
    if (process.platform !== 'win32') {
      assert.equal(findOnPath('ffmpeg', { PATH: dir }, 'linux'), null, 'on Linux the name must match exactly');
      await writeFile(join(dir, 'ffmpeg'), '');
      assert.equal(findOnPath('ffmpeg', { PATH: `/nowhere:${dir}` }, 'linux'), join(dir, 'ffmpeg'));
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('the log reader: length, frame, black and frozen spans, silences and levels in whole units', () => {
  const log = parseFfmpegLog(VIDEO_BLACK, AUDIO_SILENT);
  assert.equal(log.durationMs, 4500);
  assert.deepEqual([log.width, log.height], [1080, 1920]);
  assert.equal(log.hasAudio, true);
  assert.deepEqual(log.black, [{ startMs: 0, endMs: 1500 }]);
  assert.deepEqual(log.silence, [{ startMs: 0, endMs: 4544 }]);
  assert.deepEqual([log.meanTenthsDb, log.maxTenthsDb], [-910, -910]);
  assert.equal(parseFfmpegLog(VIDEO_FROZEN, null).freezeCount, 1);
});

test('verdicts: black frames or near silence flag the cut, a quiet mix is a fix, clipping is a note', async () => {
  const flagged = await finishingCheck('cut.mp4', { format: 'short', ffmpeg: recorded(VIDEO_BLACK, AUDIO_SILENT), exists });
  assert.equal(flagged.verdict, 'flag');
  assert.deepEqual(flagged.issues.map(issue => `${issue.kind}:${issue.severity}`), ['black frames:critical', 'dead air:warn', 'near silent:critical']);
  assert.equal(finishingResult(flagged).outcome, 'fail');

  const quiet = await finishingCheck('cut.mp4', { format: 'short', ffmpeg: recorded(HEAD, audio('-35.0', '-20.0')), exists });
  assert.equal(quiet.verdict, 'fix');
  assert.equal(quiet.issues[0].gainTenthsDb, 190);
  assert.match(quiet.issues[0].detail, /19\.0 dB/);

  const loud = await finishingCheck('cut.mp4', { format: 'short', ffmpeg: recorded(VIDEO_FROZEN, audio('-14.0', '-0.1')), exists });
  assert.equal(loud.verdict, 'pass-with-notes');
  assert.deepEqual(loud.issues.map(issue => issue.kind), ['frozen frames', 'audio clipping']);
  assert.equal(finishingResult(loud).outcome, 'pass');

  const clean = await finishingCheck('cut.mp4', { format: 'short', ffmpeg: recorded(HEAD, audio('-18.0', '-3.0')), exists });
  assert.equal(clean.verdict, 'pass');
  assert.equal(clean.parts.find(part => part.id === 'captions-over-face')!.detail, 'not run: no face detector on this computer');
});

test('a Short over three minutes or with a wide frame is flagged; a missing audio track is flagged', async () => {
  const long = HEAD.replace('00:00:04.50', '00:03:00.50');
  const tooLong = await finishingCheck('cut.mp4', { format: 'short', ffmpeg: recorded(long, audio('-18.0', '-3.0')), exists });
  assert.equal(tooLong.verdict, 'flag');
  assert.match(tooLong.issues[0].detail, /three minutes/);
  const wide = HEAD.replace(/1080x1920/g, '1920x1080');
  assert.equal((await finishingCheck('cut.mp4', { format: 'short', ffmpeg: recorded(wide, audio('-18.0', '-3.0')), exists })).verdict, 'flag');
  assert.equal((await finishingCheck('cut.mp4', { format: 'long', ffmpeg: recorded(wide, audio('-18.0', '-3.0')), exists })).verdict, 'pass');
  const noAudio = HEAD.replace(/\s+Stream #0:1.*\n/, '\n');
  const silentFile = await finishingCheck('cut.mp4', { format: 'long', ffmpeg: recorded(noAudio, 'Output file does not contain any stream'), exists });
  assert.equal(silentFile.verdict, 'flag');
  assert.match(silentFile.issues[0].kind, /no sound/);
  assert.equal((await finishingCheck('gone.mp4', { format: 'long', ffmpeg: recorded(HEAD, HEAD), exists: () => false })).verdict, 'flag');
});

test('captions over a face: from face boxes per sampled frame against the caption band, half the frames or more', () => {
  const band = captionBand(1920);
  assert.deepEqual(band, [1124, 1304], 'the same band the original works out for a 1920 pixel frame');
  const onFace = { faces: [{ x: 400, y: 1050, width: 300, height: 300 }] };
  const clear = { faces: [{ x: 400, y: 300, width: 300, height: 300 }] };
  const small = { faces: [{ x: 400, y: 1100, width: 60, height: 60 }] };
  assert.equal(captionsOverFace([onFace, onFace, clear, clear], band).over, true);
  assert.equal(captionsOverFace([onFace, clear, clear, clear], band).over, false);
  assert.equal(captionsOverFace([small, small], band).over, false, 'a face too small to read is not counted');
  assert.equal(captionsOverFace([], band).over, false);
});

test('captions over a face join the verdict as a note when face boxes are given', async () => {
  const onFace = { faces: [{ x: 400, y: 1050, width: 300, height: 300 }] };
  const report = await finishingCheck('cut.mp4', { format: 'short', ffmpeg: recorded(HEAD, audio('-18.0', '-3.0')), exists, faces: [onFace, onFace] });
  assert.equal(report.verdict, 'pass-with-notes');
  assert.equal(report.parts.find(part => part.id === 'captions-over-face')!.outcome, 'fail');
});

test('ffmpeg that cannot start, or runs too long, leaves the check not run', async () => {
  const broken: FfmpegPort = { locate: () => 'ffmpeg', run: async () => ({ code: null, stderr: '', timedOut: false, startError: 'EACCES' }) };
  assert.match((await finishingCheck('cut.mp4', { format: 'long', ffmpeg: broken, exists })).detail, /^not run: ffmpeg could not start/);
  const slow: FfmpegPort = { locate: () => 'ffmpeg', run: async () => ({ code: null, stderr: '', timedOut: true, startError: null }) };
  assert.equal((await finishingCheck('cut.mp4', { format: 'long', ffmpeg: slow, exists })).verdict, 'not-run');
});

// The run against the real ffmpeg is a qualification run: platform/tests/qualification/youtube-ffmpeg-real.test.ts.
