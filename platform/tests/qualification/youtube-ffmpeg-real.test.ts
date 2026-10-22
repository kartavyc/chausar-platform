// Qualification run (outside the open suite, which runs every test and allows no skips): the YouTube playbook's
// finishing check against the real ffmpeg on this computer. Run it where ffmpeg is on PATH:
//   node --test platform/tests/qualification/youtube-ffmpeg-real.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { finishingCheck, finishingResult, findOnPath } from '../../runtime/venture/playbooks/youtube/index.ts';


test('with the real ffmpeg on this computer: a black, silent cut is flagged and a clean one passes', async () => {
  assert.ok(findOnPath('ffmpeg'), 'This qualification run needs ffmpeg on PATH.');
  const dir = await mkdtemp(join(tmpdir(), 'chausar-yt-cut-'));
  const make = (name: string, args: string[]) => {
    const out = spawnSync(findOnPath('ffmpeg')!, ['-hide_banner', '-loglevel', 'error', '-y', ...args, join(dir, name)], { encoding: 'utf8', windowsHide: true });
    assert.equal(out.status, 0, out.stderr);
    return join(dir, name);
  };
  try {
    const bad = make('bad.mp4', [
      '-f', 'lavfi', '-i', 'color=c=black:s=180x320:r=10:d=1.5', '-f', 'lavfi', '-i', 'testsrc=s=180x320:r=10:d=3', '-f', 'lavfi', '-i', 'anullsrc=r=16000:cl=mono',
      '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]', '-map', '[v]', '-map', '2:a', '-t', '4.5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest',
    ]);
    const good = make('good.mp4', [
      '-f', 'lavfi', '-i', 'testsrc=s=180x320:r=10:d=4', '-f', 'lavfi', '-i', 'sine=f=440:r=16000:d=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest',
    ]);
    const flagged = await finishingCheck(bad, { format: 'short' });
    assert.equal(flagged.ran, true);
    assert.equal(flagged.verdict, 'flag');
    assert.ok(flagged.issues.some(issue => issue.kind === 'black frames'), JSON.stringify(flagged.issues));
    assert.ok(flagged.issues.some(issue => issue.kind === 'near silent'), JSON.stringify(flagged.issues));
    const passed = await finishingCheck(good, { format: 'short' });
    assert.equal(passed.verdict, 'pass', JSON.stringify(passed.issues));
    assert.equal(finishingResult(passed).outcome, 'pass');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
