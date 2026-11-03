// A2 review: stopping a tool stops everything it started, so a closed Codex leaves no helper running (Windows included).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnTree } from '../runtime/process-tree.ts';

const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const wait = (ms: number) => new Promise(done => setTimeout(done, ms));

test('kill ends the child and the grandchild it started', async () => {
  // A parent that starts a long-running grandchild and prints its pid. On Windows the grandchild is started outside the
  // parent's own job, as a native helper may be, so only a tree kill ends it; elsewhere it stays in the tool's group.
  const script = "const { spawn } = require('node:child_process'); const g = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', detached: " + String(process.platform === 'win32') + " }); console.log(g.pid); setInterval(() => {}, 1000);";
  const parent = spawnTree(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'ignore'] });
  const grandchild = await new Promise<number>((resolve, reject) => {
    let text = '';
    parent.stdout!.on('data', chunk => { text += String(chunk); const pid = Number.parseInt(text, 10); if (Number.isSafeInteger(pid) && text.includes('\n')) resolve(pid); });
    setTimeout(() => reject(new Error('no grandchild')), 10_000);
  });
  assert.ok(alive(grandchild));
  parent.kill();
  for (let n = 0; n < 50 && (alive(grandchild) || alive(parent.pid!)); n++) await wait(100);
  assert.equal(alive(parent.pid!), false, 'the tool is gone');
  assert.equal(alive(grandchild), false, 'and nothing it started is left behind');
});
