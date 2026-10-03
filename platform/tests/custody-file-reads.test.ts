import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, open, realpath, rm, writeFile, type FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { mapCustodyFiles } from '../runtime/custody-file-reads.ts';

function gate<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const nextTurn = () => new Promise<void>(resolve => setImmediate(resolve));

test('custody file reads cap simultaneous work at four and return results in inventory order', { timeout: 5000 }, async () => {
  const items = Array.from({ length: 8 }, (_, index) => `file_${index}`);
  const gates = items.map(() => gate<string>()), started: string[] = [];
  let active = 0, peak = 0;
  const pending = mapCustodyFiles(items, async (item, index) => {
    started.push(item); active++; peak = Math.max(peak, active);
    try { return await gates[index].promise; } finally { active--; }
  });
  try {
    await nextTurn();
    assert.deepEqual(started, items.slice(0, 4)); assert.equal(active, 4);
    // Finish the first batch out of order; each completion admits one successor.
    for (const [finished, next] of [[3, 4], [1, 5], [0, 6], [2, 7]]) {
      gates[finished].resolve(`read_${finished}`); await nextTurn();
      assert.deepEqual(started, items.slice(0, next + 1)); assert.equal(active, 4);
    }
    for (const index of [7, 4, 6, 5]) gates[index].resolve(`read_${index}`);
    assert.deepEqual(await pending, items.map((_, index) => `read_${index}`));
    assert.equal(peak, 4); assert.equal(active, 0);
  } finally {
    gates.forEach((deferred, index) => deferred.resolve(`read_${index}`));
    await pending.catch(() => {});
  }
});

test('a failed custody read stops dispatch and drains every started handle before custody exits', { timeout: 10_000 }, async t => {
  const base = await realpath(tmpdir());
  if (process.platform === 'win32') assert.match(base, /^C:\\/i);
  const directory = await realpath(await mkdtemp(join(base, 'chausar-custody-file-reads-')));
  assert.equal(dirname(directory), base);
  t.after(async () => {
    const actual = await realpath(directory);
    assert.equal(dirname(actual), base);
    assert.match(actual.split(/[\\/]/).at(-1)!, /^chausar-custody-file-reads-/);
    await rm(actual, { recursive: true, force: true });
  });
  const path = join(directory, 'synthetic.txt'); await writeFile(path, 'synthetic custody bytes');
  const items = Array.from({ length: 12 }, (_, index) => index);
  const gates = items.map(() => gate<void>()), closedGates = items.map(() => gate<void>()), initialOpened = gate<void>();
  const started: number[] = [], closed: number[] = [], handles: FileHandle[] = [], finishedInsideCustody: boolean[] = [];
  const firstFailure = new Error('first actual read failure'), laterFailure = new Error('later started read failure');
  let opened = 0, settled = false, custodyHeld = true;
  const pending = mapCustodyFiles(items, async item => {
    assert.equal(custodyHeld, true); started.push(item);
    const handle = await open(path, 'r'); handles[item] = handle;
    if (++opened === 4) initialOpened.resolve(undefined);
    try {
      await gates[item].promise;
      const bytes = await handle.readFile();
      assert.equal(bytes.toString(), 'synthetic custody bytes');
      return bytes.length;
    } finally {
      await handle.close(); closed.push(item); finishedInsideCustody.push(custodyHeld);
      closedGates[item].resolve(undefined);
    }
  });
  // This models the caller releasing its held custody only when map settles.
  const outcome = pending.then(value => {
    settled = true; custodyHeld = false; return { value, error: undefined };
  }, error => {
    settled = true; custodyHeld = false; return { value: undefined, error };
  });
  try {
    await initialOpened.promise; assert.deepEqual(started, [0, 1, 2, 3]);
    gates[0].reject(firstFailure); await closedGates[0].promise; await nextTurn();
    assert.equal(settled, false, 'A rejected read must not release custody while other started handles remain open.');
    assert.deepEqual(started, [0, 1, 2, 3]); assert.equal(handles[0].fd, -1);
    gates[1].resolve(undefined); await closedGates[1].promise; await nextTurn();
    assert.equal(settled, false); assert.deepEqual(started, [0, 1, 2, 3]);
    gates[2].reject(laterFailure); await closedGates[2].promise; await nextTurn();
    assert.equal(settled, false); assert.deepEqual(started, [0, 1, 2, 3]);
    gates[3].resolve(undefined);
    const result = await outcome;
    assert.equal(result.error, firstFailure, 'Drain failures must preserve the first observed failure.');
    assert.equal(result.value, undefined); assert.equal(settled, true); assert.equal(custodyHeld, false);
    assert.deepEqual(closed.sort((a, b) => a - b), [0, 1, 2, 3]);
    assert.deepEqual(handles.map(handle => handle.fd), [-1, -1, -1, -1]);
    assert.deepEqual(finishedInsideCustody, [true, true, true, true], 'No started read may finish after custody exits.');
    await nextTurn(); assert.deepEqual(started, [0, 1, 2, 3], 'Items after the first failure must never be dispatched.');
  } finally {
    gates.forEach(deferred => deferred.resolve(undefined));
    await outcome;
    await Promise.all(handles.map(handle => handle.close()));
  }
});

test('an empty custody inventory returns no results and starts no work', async () => {
  let calls = 0;
  assert.deepEqual(await mapCustodyFiles([], async () => { calls++; return 'unexpected'; }), []);
  assert.equal(calls, 0);
});
