import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readdir, lstat, realpath, readFile, rm, writeFile, unlink, symlink, link, rename } from 'node:fs/promises';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Only filesystem protocol fixtures: these tests never launch a database,
// native server or activation. A disappearing entry forces a fresh, complete
// bounded census; it cannot authorize a partial scratch inventory.
const helperUrl = new URL('./fixtures/postgres-transfer-native-census.mjs', import.meta.url);
const { createOwnedScratchCensus } = await import(helperUrl.href);
type Phase = 'startup' | 'live' | 'final-stopped' | 'post-save-stopped';
type Diagnostic = Record<string, unknown>;
type CensusFailure = Error & { code?: string; censusDiagnostic?: Diagnostic };
type Io = {
  readdir?: (...args: any[]) => Promise<any>;
  lstat?: (...args: any[]) => Promise<any>;
  realpath?: (...args: any[]) => Promise<any>;
  now?: () => number;
};

async function fixture(t: TestContext) {
  const parent = await mkdtemp(join(tmpdir(), 'chausar-owned-census-'));
  const permittedRuns = join(parent, 'runs');
  const runRoot = join(permittedRuns, `independent-${randomUUID()}`);
  await mkdir(runRoot, { recursive: true });
  t.after(async () => {
    assert.equal(resolve(parent), parent);
    assert.ok(parent.startsWith(join(tmpdir(), 'chausar-owned-census-')));
    await rm(parent, { recursive: true, force: true });
  });
  const diagnostics: Diagnostic[] = [];
  const census = (io: Io = {}, options: { maxBytes?: number; onDiagnostic?: (event: Diagnostic) => unknown; runRoot?: string; permittedRuns?: string } = {}) => {
    const inspect = createOwnedScratchCensus({ runRoot, permittedRuns, maxBytes: 1024 * 1024,
      onDiagnostic: (event: Diagnostic) => diagnostics.push(event), ...options }, io);
    return { inspect, pin: inspect.pin };
  };
  return { parent, permittedRuns, runRoot, diagnostics, census };
}

function samePath(value: unknown, expected: string) { return resolve(String(value)) === resolve(expected); }
async function failure(promise: Promise<unknown>) {
  try { await promise; } catch (error) { return error as Error & { code?: string; censusDiagnostic?: Diagnostic }; }
  assert.fail('The complete census must refuse this fixture.');
}
function safeDiagnostics(events: Diagnostic[], root: string) {
  assert.ok(events.length > 0);
  for (const event of events) {
    const serialized = JSON.stringify(event);
    for (const value of Object.values(event)) if (typeof value === 'string') {
      assert.ok(!value.includes(root));
      assert.ok(!value.includes(root.replaceAll('\\', '/')));
    }
    assert.ok(!serialized.includes('fixture secret message'));
    assert.ok(!('stack' in event)); assert.ok(!('message' in event));
    assert.equal(event.format, 'chausar.native-scratch-census-diagnostic.v1');
    assert.ok(Object.isFrozen(event));
    assert.ok(['startup', 'live', 'final-stopped', 'post-save-stopped'].includes(String(event.phase)));
    assert.ok(Number.isSafeInteger(event.attempt));
    assert.ok(Number(event.attempt) >= 1 && Number(event.attempt) <= 3);
  }
}

function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}
const turn = () => new Promise<void>(resolve => setImmediate(resolve));
function settledInspection(promise: Promise<number>, onSettlement: () => void): Promise<{ value: number } | { error: CensusFailure }> {
  return promise.then(value => { onSettlement(); return { value }; }, error => { onSettlement(); return { error: error as CensusFailure }; });
}
async function boundedGate(promise: Promise<void>) {
  let timer!: ReturnType<typeof setTimeout>;
  try {
    await Promise.race([promise, new Promise<void>((_, reject) => {
      timer = setTimeout(() => reject(new Error('The expected metadata boundary did not arrive.')), 1000);
    })]);
  } finally { clearTimeout(timer); }
}

test('sibling metadata uses four readers and counts every actual wide-tree file', async t => {
  const f = await fixture(t), files = Array.from({ length: 9 }, (_, index) => join(f.runRoot, `file-${index}`));
  for (let index = 0; index < files.length; index++) await writeFile(files[index], Buffer.alloc(index + 1));
  let active = 0, peak = 0;
  const reads: string[] = [], finished: string[] = [];
  const census = f.census({ lstat: async (...args) => {
    if (!files.some(file => samePath(args[0], file))) return lstat(args[0], args[1]);
    active++; peak = Math.max(peak, active); reads.push(String(args[0]));
    try {
      const value = await lstat(args[0], args[1]);
      // All four dispatched reads stay outstanding through an event-loop turn.
      // Serial traversal therefore produces a peak of one, regardless of disk speed.
      await turn(); return value;
    } finally { active--; finished.push(String(args[0])); }
  } });
  assert.equal(await census.inspect('live'), 45);
  assert.equal(peak, 4); assert.equal(active, 0);
  assert.deepEqual([...reads].sort(), [...files].sort());
  assert.deepEqual([...finished].sort(), [...files].sort());
  assert.deepEqual(f.diagnostics, []);
});

test('a sibling metadata batch drains before serial directory descent and the next batch', async t => {
  const f = await fixture(t), directory = join(f.runRoot, 'a-directory');
  await mkdir(directory); await writeFile(join(directory, 'nested'), Buffer.alloc(7));
  const siblings = ['a-directory', 'b-file', 'c-file', 'd-file', 'e-file'];
  for (const name of siblings.slice(1)) await writeFile(join(f.runRoot, name), Buffer.alloc(3));
  const begun = gate(), earlyFinished = gate(), late = gate();
  let active = 0, starts = 0, finished = 0, nestedScans = 0, settled = false;
  const classified = new Set<string>(), events: string[] = [];
  const census = f.census({
    readdir: async (...args) => {
      const values = await readdir(args[0], args[1]);
      if (samePath(args[0], f.runRoot)) return [...values].sort();
      if (samePath(args[0], directory)) {
        nestedScans++; events.push(`descent:${active}:${finished}`);
      }
      return values;
    },
    lstat: async (...args) => {
      const name = siblings.find(value => samePath(args[0], join(f.runRoot, value)));
      if (!name || classified.has(name)) return lstat(args[0], args[1]);
      classified.add(name); active++; starts++; events.push(`start:${name}`);
      if (starts === 4) begun.release();
      try {
        const value = await lstat(args[0], args[1]);
        if (name === 'd-file') await late.promise;
        return value;
      } finally {
        active--; finished++; events.push(`finish:${name}`);
        if (finished === 3) earlyFinished.release();
      }
    }
  });
  const outcome = settledInspection(census.inspect('live'), () => { settled = true; });
  try {
    await boundedGate(begun.promise); await boundedGate(earlyFinished.promise);
    assert.equal(starts, 4); assert.equal(active, 1); assert.equal(nestedScans, 0); assert.equal(settled, false);
    late.release();
    const result = await outcome; assert.ok('value' in result); assert.equal(result.value, 19);
    assert.equal(active, 0); assert.equal(finished, 5); assert.equal(nestedScans, 1);
    assert.ok(events.includes('descent:0:4'));
    assert.ok(events.indexOf('start:e-file') > events.indexOf('descent:0:4'));
  } finally { begun.release(); late.release(); await outcome; }
});

test('nonretryable metadata refusal drains all started siblings before custody exit', async t => {
  const f = await fixture(t), files = ['a-fail', 'b-file', 'c-file', 'd-file', 'e-unstarted'];
  for (const name of files) await writeFile(join(f.runRoot, name), Buffer.alloc(2));
  const begun = gate(), failed = gate(), late = gate();
  let active = 0, finished = 0, settled = false;
  const starts: string[] = [];
  const census = f.census({
    readdir: async (...args) => [...await readdir(args[0], args[1])].sort(),
    lstat: async (...args) => {
      const name = files.find(value => samePath(args[0], join(f.runRoot, value)));
      if (!name) return lstat(args[0], args[1]);
      starts.push(name); active++; if (starts.length === 4) begun.release();
      try {
        const value = await lstat(args[0], args[1]);
        if (name === 'a-fail') {
          await begun.promise;
          throw Object.assign(new Error('fixture secret message'), { code: 'EACCES' });
        }
        await late.promise; return value;
      } finally { active--; finished++; if (name === 'a-fail') failed.release(); }
    }
  });
  const outcome = settledInspection(census.inspect('live'), () => { settled = true; });
  try {
    await boundedGate(begun.promise); await boundedGate(failed.promise);
    assert.equal(active, 3); assert.equal(settled, false); assert.equal(f.diagnostics.length, 0);
    assert.deepEqual(starts, files.slice(0, 4));
    late.release();
    const result = await outcome; assert.ok('error' in result); assert.equal(result.error.code, 'EACCES');
    assert.equal(active, 0); assert.equal(finished, 4);
    safeDiagnostics(f.diagnostics, f.runRoot);
    await turn(); assert.deepEqual(starts, files.slice(0, 4)); assert.equal(finished, 4);
  } finally { begun.release(); late.release(); await outcome; }
});

test('live ENOENT drains the failed sibling batch before a fresh complete retry', async t => {
  const f = await fixture(t), files = ['a-vanish', 'b-file', 'c-file', 'd-file', 'e-file'];
  for (let index = 0; index < files.length; index++) await writeFile(join(f.runRoot, files[index]), Buffer.alloc(index + 1));
  const begun = gate(), failed = gate(), late = gate();
  let scans = 0, active = 0, finished = 0, settled = false;
  const firstStarts: string[] = [], retryReads: string[] = [], retryStates: number[] = [];
  const census = f.census({
    readdir: async (...args) => {
      if (samePath(args[0], f.runRoot)) { scans++; if (scans > 1) retryStates.push(active); }
      return [...await readdir(args[0], args[1])].sort();
    },
    lstat: async (...args) => {
      const name = files.find(value => samePath(args[0], join(f.runRoot, value)));
      if (!name) return lstat(args[0], args[1]);
      if (scans > 1) { retryReads.push(name); return lstat(args[0], args[1]); }
      firstStarts.push(name); active++; if (firstStarts.length === 4) begun.release();
      try {
        if (name === 'a-vanish') { await begun.promise; await unlink(join(f.runRoot, name)); }
        else await late.promise;
        return await lstat(args[0], args[1]);
      } finally { active--; finished++; if (name === 'a-vanish') failed.release(); }
    }
  }, { maxBytes: 14 });
  const outcome = settledInspection(census.inspect('live'), () => { settled = true; });
  try {
    await boundedGate(begun.promise); await boundedGate(failed.promise);
    assert.equal(scans, 1); assert.equal(active, 3); assert.equal(settled, false); assert.equal(f.diagnostics.length, 0);
    assert.deepEqual(firstStarts, files.slice(0, 4));
    late.release();
    const result = await outcome; assert.ok('value' in result); assert.equal(result.value, 14);
    assert.equal(active, 0); assert.equal(finished, 4); assert.equal(scans, 2);
    assert.deepEqual(retryStates, [0]); assert.deepEqual(retryReads, files.slice(1));
    assert.equal(f.diagnostics.length, 1); assert.equal(f.diagnostics[0].code, 'ENOENT');
    assert.equal(f.diagnostics[0].attempt, 1); assert.equal(f.diagnostics[0].retryable, true);
    safeDiagnostics(f.diagnostics, f.runRoot);
  } finally { begun.release(); late.release(); await outcome; }
});

for (const [phase, milliseconds] of [['live', 5000], ['final-stopped', 10000]] as const) {
  test(`the exact ${phase} deadline drains in-flight metadata without dispatching another batch`, async t => {
    const f = await fixture(t), files = ['a-deadline', 'b-file', 'c-file', 'd-file', 'e-unstarted'];
    for (const name of files) await writeFile(join(f.runRoot, name), Buffer.alloc(2));
    const begun = gate(), expired = gate(), late = gate();
    let clock = 0, active = 0, finished = 0, settled = false, scans = 0;
    const starts: string[] = [];
    const census = f.census({
      now: () => clock,
      readdir: async (...args) => { if (samePath(args[0], f.runRoot)) scans++; return [...await readdir(args[0], args[1])].sort(); },
      lstat: async (...args) => {
        const name = files.find(value => samePath(args[0], join(f.runRoot, value)));
        if (!name) return lstat(args[0], args[1]);
        starts.push(name); active++; if (starts.length === 4) begun.release();
        try {
          const value = await lstat(args[0], args[1]);
          if (name === 'a-deadline') { await begun.promise; clock = milliseconds; }
          else await late.promise;
          return value;
        } finally { active--; finished++; if (name === 'a-deadline') expired.release(); }
      }
    });
    const outcome = settledInspection(census.inspect(phase), () => { settled = true; });
    try {
      await boundedGate(begun.promise); await boundedGate(expired.promise);
      assert.equal(clock, milliseconds); assert.equal(active, 3); assert.equal(settled, false);
      assert.equal(f.diagnostics.length, 0); assert.deepEqual(starts, files.slice(0, 4));
      late.release();
      const result = await outcome; assert.ok('error' in result);
      assert.equal(result.error.code, 'OWNED_NATIVE_SCRATCH_CENSUS_TIMEOUT');
      assert.equal(active, 0); assert.equal(finished, 4); assert.equal(scans, 1);
      assert.equal(result.error.censusDiagnostic!.operation, 'deadline');
      assert.equal(result.error.censusDiagnostic!.retryable, false);
      safeDiagnostics(f.diagnostics, f.runRoot);
      await turn(); assert.deepEqual(starts, files.slice(0, 4));
    } finally { begun.release(); late.release(); await outcome; }
  });
}

test('a concurrent complete retry retains the original shared five-second clock', async t => {
  const f = await fixture(t), vanish = join(f.runRoot, 'a-vanish'), stable = join(f.runRoot, 'b-stable');
  await writeFile(vanish, Buffer.alloc(3)); await writeFile(stable, Buffer.alloc(7));
  let clock = 0, scans = 0, stableReads = 0;
  const census = f.census({
    now: () => clock,
    readdir: async (...args) => { if (samePath(args[0], f.runRoot)) scans++; return [...await readdir(args[0], args[1])].sort(); },
    lstat: async (...args) => {
      if (samePath(args[0], vanish)) { await unlink(vanish); clock = 3000; }
      if (samePath(args[0], stable)) {
        stableReads++;
        if (scans === 2) clock = 5000;
      }
      return lstat(args[0], args[1]);
    }
  });
  const error = await failure(census.inspect('live'));
  assert.equal(error.code, 'OWNED_NATIVE_SCRATCH_CENSUS_TIMEOUT');
  assert.equal(scans, 2); assert.equal(stableReads, 2);
  assert.deepEqual(f.diagnostics.map(event => [event.code, event.attempt]), [['ENOENT', 1], ['OWNED_NATIVE_SCRATCH_CENSUS_TIMEOUT', 2]]);
  safeDiagnostics(f.diagnostics, f.runRoot);
});

for (const unsafe of ['junction', 'oversized-file'] as const) {
  test(`earlier ${unsafe} refusal takes precedence over a later sibling ENOENT`, async t => {
    const f = await fixture(t), first = join(f.runRoot, 'a-unsafe'), vanish = join(f.runRoot, 'b-vanish');
    if (unsafe === 'junction') {
      const outside = join(f.parent, 'outside-target'); await mkdir(outside); await symlink(outside, first, 'junction');
    } else await writeFile(first, Buffer.alloc(11));
    await writeFile(vanish, Buffer.alloc(2));
    let scans = 0;
    const checked: string[] = [];
    const census = f.census({
      readdir: async (...args) => { if (samePath(args[0], f.runRoot)) scans++; return [...await readdir(args[0], args[1])].sort(); },
      lstat: async (...args) => {
        if (samePath(args[0], first)) checked.push('unsafe');
        if (samePath(args[0], vanish)) { checked.push('vanish'); await unlink(vanish); }
        return lstat(args[0], args[1]);
      }
    }, { maxBytes: 10 });
    const error = await failure(census.inspect('live'));
    assert.equal(error.code, unsafe === 'junction' ? 'OWNED_NATIVE_SCRATCH_LINK_REFUSED' : 'OWNED_NATIVE_SCRATCH_LIMIT');
    assert.equal(scans, 1); assert.deepEqual(checked, ['unsafe', 'vanish']);
    assert.equal(f.diagnostics.length, 1); assert.equal(error.censusDiagnostic!.operation, 'validation');
    assert.equal(error.censusDiagnostic!.relativePath, 'a-unsafe'); assert.equal(error.censusDiagnostic!.retryable, false);
    safeDiagnostics(f.diagnostics, f.runRoot);
  });
}

test('directory descent refreshes later sibling metadata and accounts actual file growth', async t => {
  const f = await fixture(t), directory = join(f.runRoot, 'a-directory'), growing = join(f.runRoot, 'b-growing');
  await mkdir(directory); await writeFile(join(directory, 'nested'), Buffer.alloc(1));
  await writeFile(join(f.runRoot, 'c-file'), Buffer.alloc(3));
  await writeFile(join(f.runRoot, 'd-file'), Buffer.alloc(4));
  await writeFile(join(f.runRoot, 'e-file'), Buffer.alloc(5));
  for (const maxBytes of [26, 25]) {
    await writeFile(growing, Buffer.alloc(2));
    let grown = false;
    const sizes: bigint[] = [];
    const census = f.census({
      readdir: async (...args) => {
        if (samePath(args[0], directory)) { await writeFile(growing, Buffer.alloc(13)); grown = true; }
        return [...await readdir(args[0], args[1])].sort();
      },
      lstat: async (...args) => {
        const value = await lstat(args[0], args[1]);
        if (samePath(args[0], growing)) sizes.push(BigInt(value.size));
        return value;
      }
    }, { maxBytes });
    if (maxBytes === 26) assert.equal(await census.inspect('live'), 26);
    else {
      const error = await failure(census.inspect('live'));
      assert.equal(error.code, 'OWNED_NATIVE_SCRATCH_LIMIT'); assert.equal(error.censusDiagnostic!.retryable, false);
    }
    assert.equal(grown, true); assert.deepEqual(sizes, [2n, 13n]);
    assert.equal((await lstat(growing, { bigint: true })).size, 13n);
  }
  assert.equal(f.diagnostics.length, 1); safeDiagnostics(f.diagnostics, f.runRoot);
});

for (const code of ['ENOENT', 'EACCES'] as const) {
  test(`directory descent cannot replace a prefetched ${code} result with a recreated file`, async t => {
    const f = await fixture(t), directory = join(f.runRoot, 'a-directory'), later = join(f.runRoot, 'b-later');
    await mkdir(directory); await writeFile(join(directory, 'nested'), Buffer.alloc(1)); await writeFile(later, Buffer.alloc(2));
    let scans = 0, faulted = false, recreated = false;
    const readAttempts: number[] = [];
    const census = f.census({
      readdir: async (...args) => {
        if (samePath(args[0], f.runRoot)) scans++;
        if (samePath(args[0], directory)) { await writeFile(later, Buffer.alloc(11)); recreated = true; }
        return [...await readdir(args[0], args[1])].sort();
      },
      lstat: async (...args) => {
        if (samePath(args[0], later)) {
          readAttempts.push(scans);
          if (!faulted) {
            faulted = true;
            if (code === 'ENOENT') { await unlink(later); return lstat(args[0], args[1]); }
            throw Object.assign(new Error('fixture secret message'), { code });
          }
        }
        return lstat(args[0], args[1]);
      }
    });
    if (code === 'ENOENT') {
      assert.equal(await census.inspect('live'), 12); assert.equal(scans, 2);
      assert.deepEqual(readAttempts, [1, 2, 2]);
    } else {
      const error = await failure(census.inspect('live')); assert.equal(error.code, code); assert.equal(scans, 1);
      assert.deepEqual(readAttempts, [1]);
    }
    assert.equal(recreated, true); assert.equal(f.diagnostics.length, 1);
    assert.equal(f.diagnostics[0].code, code); assert.equal(f.diagnostics[0].relativePath, 'b-later');
    assert.equal(f.diagnostics[0].attempt, 1); assert.equal(f.diagnostics[0].retryable, code === 'ENOENT');
    assert.equal((await lstat(later, { bigint: true })).size, 11n);
    safeDiagnostics(f.diagnostics, f.runRoot);
  });
}

test('owned scratch census counts all stable files, including hidden and live-control names', async t => {
  const f = await fixture(t);
  await mkdir(join(f.runRoot, '.private', 'nested'), { recursive: true });
  await writeFile(join(f.runRoot, 'stable'), Buffer.alloc(13));
  await writeFile(join(f.runRoot, '.private', 'nested', 'writer.lock'), Buffer.alloc(17));
  await writeFile(join(f.runRoot, '.private', 'postmaster.pid'), Buffer.alloc(19));
  for (const phase of ['startup', 'live', 'final-stopped', 'post-save-stopped'] as Phase[]) {
    assert.equal(await f.census().inspect(phase), 49);
  }
});

test('descendant lstat disappearance retries the whole census and resets partial byte totals', async t => {
  const f = await fixture(t), stable = join(f.runRoot, 'stable'), vanish = join(f.runRoot, 'vanish');
  await writeFile(stable, Buffer.alloc(41)); await writeFile(vanish, Buffer.alloc(23));
  let scans = 0, reads = 0, removed = false;
  const census = f.census({
    readdir: async (...args) => {
      const result = await readdir(args[0], args[1]);
      if (samePath(args[0], f.runRoot)) { scans++; return ['stable', 'vanish'].filter(name => result.includes(name)).sort(); }
      return result;
    },
    lstat: async (...args) => {
      if (samePath(args[0], stable)) reads++;
      if (samePath(args[0], vanish) && !removed) { removed = true; await unlink(vanish); }
      return lstat(args[0], args[1]);
    }
  }, { maxBytes: 70 });
  assert.equal(await census.inspect('live'), 41);
  assert.equal(scans, 2); assert.equal(reads, 2);
  safeDiagnostics(f.diagnostics, f.runRoot);
});

test('descendant readdir disappearance retries without omitting stable files elsewhere', async t => {
  const f = await fixture(t), transient = join(f.runRoot, 'transient');
  await mkdir(transient); await writeFile(join(transient, 'vanish'), Buffer.alloc(5));
  await writeFile(join(f.runRoot, 'stable'), Buffer.alloc(37));
  let removed = false, scans = 0;
  const census = f.census({ readdir: async (...args) => {
    if (samePath(args[0], f.runRoot)) scans++;
    if (samePath(args[0], transient) && !removed) { removed = true; await rm(transient, { recursive: true }); }
    return readdir(args[0], args[1]);
  } });
  assert.equal(await census.inspect('startup'), 37);
  assert.equal(scans, 2); safeDiagnostics(f.diagnostics, f.runRoot);
});

test('persistent live disappearance exhausts three complete attempts and never returns partial bytes', async t => {
  const f = await fixture(t), vanish = join(f.runRoot, 'vanish');
  await writeFile(join(f.runRoot, 'stable'), Buffer.alloc(43));
  let scans = 0;
  const census = f.census({
    readdir: async (...args) => {
      const values = await readdir(args[0], args[1]);
      if (samePath(args[0], f.runRoot)) { scans++; await writeFile(vanish, Buffer.alloc(7)); return [...values.filter((value: string) => value !== 'vanish'), 'vanish']; }
      return values;
    },
    lstat: async (...args) => { if (samePath(args[0], vanish)) await unlink(vanish); return lstat(args[0], args[1]); }
  });
  const error = await failure(census.inspect('live'));
  assert.equal(error.code, 'ENOENT'); assert.equal(scans, 3); assert.ok(error.censusDiagnostic);
  safeDiagnostics(f.diagnostics, f.runRoot);
});

for (const phase of ['final-stopped', 'post-save-stopped'] as const) {
  test(`stopped census ${phase} refuses the first descendant disappearance`, async t => {
    const f = await fixture(t), vanish = join(f.runRoot, 'vanish');
    await writeFile(vanish, 'gone');
    let scans = 0;
    const census = f.census({
      readdir: async (...args) => { if (samePath(args[0], f.runRoot)) scans++; return readdir(args[0], args[1]); },
      lstat: async (...args) => { if (samePath(args[0], vanish)) await unlink(vanish); return lstat(args[0], args[1]); }
    });
    const error = await failure(census.inspect(phase)); assert.equal(error.code, 'ENOENT'); assert.equal(scans, 1);
    safeDiagnostics(f.diagnostics, f.runRoot);
  });
}

test('owned root disappearance refuses without treating it as a retryable descendant', async t => {
  const f = await fixture(t);
  await rm(f.runRoot, { recursive: true });
  let rootStats = 0;
  const census = f.census({ lstat: async (...args) => { if (samePath(args[0], f.runRoot)) rootStats++; return lstat(args[0], args[1]); } });
  const error = await failure(census.inspect('live')); assert.equal(error.code, 'ENOENT'); assert.equal(rootStats, 1);
  safeDiagnostics(f.diagnostics, f.runRoot);
});

test('non-ENOENT filesystem errors refuse once and expose no raw message or absolute path', async t => {
  const f = await fixture(t), stable = join(f.runRoot, 'stable');
  await writeFile(stable, 'unread');
  let reads = 0;
  const census = f.census({ lstat: async (...args) => {
    if (samePath(args[0], stable)) { reads++; throw Object.assign(new Error('fixture secret message ' + stable), { code: 'EACCES', path: stable }); }
    return lstat(args[0], args[1]);
  } });
  const error = await failure(census.inspect('live'));
  assert.equal(error.code, 'EACCES'); assert.equal(reads, 1); safeDiagnostics(f.diagnostics, f.runRoot);
  assert.ok(!String(error.message).includes(stable));
  assert.ok(!String(error.message).includes('fixture secret message'));
});

test('a restarted full census refuses newly oversized stable files', async t => {
  const f = await fixture(t), stable = join(f.runRoot, 'stable'), vanish = join(f.runRoot, 'vanish');
  await writeFile(stable, Buffer.alloc(11)); await writeFile(vanish, Buffer.alloc(2));
  let removed = false, scans = 0;
  const census = f.census({
    readdir: async (...args) => {
      const values = await readdir(args[0], args[1]);
      if (samePath(args[0], f.runRoot)) { scans++; return [...values].sort(); }
      return values;
    },
    lstat: async (...args) => {
      if (samePath(args[0], vanish) && !removed) { removed = true; await unlink(vanish); await writeFile(stable, Buffer.alloc(101)); }
      return lstat(args[0], args[1]);
    }
  }, { maxBytes: 100 });
  const error = await failure(census.inspect('startup'));
  assert.equal(error.code, 'OWNED_NATIVE_SCRATCH_LIMIT'); assert.equal(scans, 2);
});

test('a restarted full census refuses a new junction instead of reusing earlier metadata', async t => {
  const f = await fixture(t), stable = join(f.runRoot, 'stable'), vanish = join(f.runRoot, 'vanish');
  const outside = join(f.parent, 'junction-target'); await mkdir(outside);
  await writeFile(stable, Buffer.alloc(11)); await writeFile(vanish, Buffer.alloc(2));
  let removed = false, scans = 0;
  const census = f.census({
    readdir: async (...args) => {
      const values = await readdir(args[0], args[1]);
      if (samePath(args[0], f.runRoot)) { scans++; return [...values].sort(); }
      return values;
    },
    lstat: async (...args) => {
      if (samePath(args[0], vanish) && !removed) { removed = true; await unlink(vanish); await symlink(outside, join(f.runRoot, 'new-junction'), 'junction'); }
      return lstat(args[0], args[1]);
    }
  });
  const error = await failure(census.inspect('live'));
  assert.equal(error.code, 'OWNED_NATIVE_SCRATCH_LINK_REFUSED'); assert.equal(scans, 2);
});

test('hardlinked regular-file pathnames are both conservatively counted', async t => {
  const f = await fixture(t), stable = join(f.runRoot, 'stable');
  await writeFile(stable, Buffer.alloc(29)); await link(stable, join(f.runRoot, 'second-name'));
  assert.equal(await f.census().inspect('live'), 58);
  assert.equal((await failure(f.census({}, { maxBytes: 57 }).inspect('live'))).code, 'OWNED_NATIVE_SCRATCH_LIMIT');
});

test('unsupported descendant types refuse once instead of retrying them', async t => {
  const f = await fixture(t), entry = join(f.runRoot, 'not-regular'); await writeFile(entry, 'protocol fixture');
  let reads = 0;
  const census = f.census({ lstat: async (...args) => {
    if (samePath(args[0], entry)) { reads++; return { isSymbolicLink: () => false, isDirectory: () => false, isFile: () => false, size: 0n }; }
    return lstat(args[0], args[1]);
  } });
  const error = await failure(census.inspect('live'));
  assert.equal(error.code, 'OWNED_NATIVE_SCRATCH_TYPE_REFUSED'); assert.equal(reads, 1);
});

test('canonicalization ENOENT of a disappearing descendant restarts a full startup census', async t => {
  const f = await fixture(t), transient = join(f.runRoot, 'transient');
  await mkdir(transient); await writeFile(join(f.runRoot, 'stable'), Buffer.alloc(47));
  let removed = false, scans = 0;
  const census = f.census({
    readdir: async (...args) => { if (samePath(args[0], f.runRoot)) scans++; return readdir(args[0], args[1]); },
    realpath: async (...args) => {
      if (samePath(args[0], transient) && !removed) { removed = true; await rm(transient, { recursive: true }); }
      return realpath(args[0]);
    }
  });
  assert.equal(await census.inspect('startup'), 47); assert.equal(scans, 2);
  assert.equal(f.diagnostics[0].operation, 'realpath'); assert.equal(f.diagnostics[0].code, 'ENOENT');
});

test('outside and aliased owned roots refuse before scanning descendants', async t => {
  const f = await fixture(t), outside = join(f.parent, 'outside'), alias = join(f.permittedRuns, 'alias');
  await mkdir(outside); await symlink(f.runRoot, alias, 'junction');
  let scans = 0;
  const io = { readdir: async (...args: any[]) => { scans++; return readdir(args[0], args[1]); } };
  const outsideError = await failure(Promise.resolve().then(() => f.census(io, { runRoot: outside }).inspect('startup')));
  const aliasError = await failure(Promise.resolve().then(() => f.census(io, { runRoot: alias }).inspect('startup')));
  assert.equal(outsideError.code, 'OWNED_NATIVE_SCRATCH_SCOPE_REQUIRED');
  assert.equal(aliasError.code, 'OWNED_NATIVE_SCRATCH_LINK_REFUSED');
  assert.equal(scans, 0);
});

test('retry revalidates the actual canonical owned root before enumerating it', async t => {
  const f = await fixture(t), vanish = join(f.runRoot, 'vanish');
  await writeFile(vanish, 'gone');
  let removed = false, scans = 0;
  const census = f.census({
    readdir: async (...args) => { if (samePath(args[0], f.runRoot)) scans++; return readdir(args[0], args[1]); },
    lstat: async (...args) => {
      if (samePath(args[0], vanish) && !removed) { removed = true; await rm(f.runRoot, { recursive: true }); }
      return lstat(args[0], args[1]);
    }
  });
  const error = await failure(census.inspect('live'));
  assert.equal(error.code, 'ENOENT'); assert.equal(scans, 1);
});

test('a pinned owned root replacement refuses instead of admitting the replacement directory', async t => {
  const f = await fixture(t), census = f.census();
  await census.pin();
  await rename(f.runRoot, join(f.permittedRuns, 'retained-original'));
  await mkdir(f.runRoot); await writeFile(join(f.runRoot, 'replacement'), 'new directory');
  const error = await failure(census.inspect('live'));
  assert.equal(error.code, 'OWNED_NATIVE_SCRATCH_CUSTODY_CHANGED');
});

test('a pinned permitted-runs parent replacement also refuses before descendant census', async t => {
  const f = await fixture(t), census = f.census();
  await census.pin();
  await rename(f.permittedRuns, join(f.parent, 'retained-original'));
  await mkdir(f.runRoot, { recursive: true });
  const error = await failure(census.inspect('live'));
  assert.equal(error.code, 'OWNED_NATIVE_SCRATCH_CUSTODY_CHANGED');
});

test('the shared live deadline bounds retries even when attempts remain', async t => {
  const f = await fixture(t), vanish = join(f.runRoot, 'vanish');
  await writeFile(vanish, 'gone');
  let clock = 0, scans = 0;
  const census = f.census({
    now: () => clock,
    readdir: async (...args) => { if (samePath(args[0], f.runRoot)) scans++; return readdir(args[0], args[1]); },
    lstat: async (...args) => {
      if (samePath(args[0], vanish)) { await unlink(vanish); clock = 5001; }
      return lstat(args[0], args[1]);
    }
  });
  const error = await failure(census.inspect('live'));
  assert.equal(error.code, 'OWNED_NATIVE_SCRATCH_CENSUS_TIMEOUT'); assert.equal(scans, 1);
});

test('the fixed entry cap refuses synthetic oversized enumeration before opening absent children', async t => {
  const f = await fixture(t);
  let descendants = 0;
  const census = f.census({
    readdir: async (...args) => samePath(args[0], f.runRoot) ? Array.from({ length: 32769 }, (_, index) => `entry-${index}`) : readdir(args[0], args[1]),
    lstat: async (...args) => { if (!samePath(args[0], f.runRoot) && !samePath(args[0], f.permittedRuns)) descendants++; return lstat(args[0], args[1]); }
  });
  const error = await failure(census.inspect('live'));
  assert.equal(error.code, 'OWNED_NATIVE_SCRATCH_ENTRY_LIMIT'); assert.equal(descendants, 0);
});

test('missing-path diagnostics identify the exact normalized descendant with a bounded digest', async t => {
  const f = await fixture(t), nested = join(f.runRoot, 'pg-data', 'base'), vanish = join(nested, 'missing-file');
  await mkdir(nested, { recursive: true }); await writeFile(vanish, 'gone');
  const census = f.census({ lstat: async (...args) => { if (samePath(args[0], vanish)) await unlink(vanish); return lstat(args[0], args[1]); } });
  const error = await failure(census.inspect('final-stopped'));
  safeDiagnostics(f.diagnostics, f.runRoot);
  const event = error.censusDiagnostic!;
  assert.equal(event.phase, 'final-stopped'); assert.equal(event.attempt, 1);
  assert.equal(event.operation, 'lstat'); assert.equal(event.code, 'ENOENT');
  assert.equal(event.relativePath, 'pg-data/base/missing-file');
  assert.equal(event.pathDigest, createHash('sha256').update('pg-data/base/missing-file').digest('hex'));
});

test('diagnostic callback exceptions and rejected promises cannot change a successful bounded retry', async t => {
  for (const callback of [() => { throw new Error('fixture diagnostic callback failure'); }, () => Promise.reject(new Error('fixture diagnostic rejection'))]) {
    const f = await fixture(t), vanish = join(f.runRoot, 'vanish');
    await writeFile(join(f.runRoot, 'stable'), Buffer.alloc(31)); await writeFile(vanish, Buffer.alloc(3));
    let removed = false;
    const census = f.census({ lstat: async (...args) => {
      if (samePath(args[0], vanish) && !removed) { removed = true; await unlink(vanish); }
      return lstat(args[0], args[1]);
    } }, { onDiagnostic: callback });
    assert.equal(await census.inspect('live'), 31);
  }
});

async function noStartLifecycleFixture(t: TestContext) {
  const f = await fixture(t);
  const sourceRoot = join(f.parent, 'source-with-no-native-dependencies');
  const runRoot = join(f.parent, 'postgres-transfer-acceptance-prep', 'runs', `close-only-${randomUUID()}`);
  await mkdir(sourceRoot); await mkdir(runRoot, { recursive: true });
  const { createNativeEnvironment } = await import(new URL('./fixtures/postgres-transfer-native-lifecycle.mjs', import.meta.url).href);
  return { runRoot, create: () => createNativeEnvironment({ ownedRunRoot: runRoot,
    sourcePin: { sourceRoot, commit: 'a'.repeat(40), tree: 'b'.repeat(40) } }) };
}

test('NO-START lifecycle close persists complete before-save and after-save stopped censuses', async t => {
  const f = await noStartLifecycleFixture(t);
  const require = createRequire(import.meta.url), childProcess = require('node:child_process');
  const spawnMock = t.mock.method(childProcess, 'spawn', () => assert.fail('NO-START close must never spawn a native helper.'));
  syncBuiltinESMExports();
  try {
    await writeFile(join(f.runRoot, 'stable'), Buffer.alloc(23));
    const environment = f.create();
    await environment.close();
    assert.deepEqual(await environment.inspectStopped(), { stopped: true, serverStarted: false });
    const state = JSON.parse(await readFile(join(f.runRoot, 'native-lifecycle.json'), 'utf8'));
    assert.equal(state.serverStartAttempted, false); assert.equal(state.serverStarted, false);
    assert.equal(state.stopped, true);
    assert.equal(state.finalScratchBeforeSaveChecked, true);
    assert.equal(state.finalScratchAfterSaveChecked, true);
    assert.equal(state.finalScratchChecked, true);
    assert.deepEqual(state.errors, []); assert.deepEqual(state.censusDiagnostics, []);
    assert.equal(spawnMock.mock.callCount(), 0);
  } finally { spawnMock.mock.restore(); syncBuiltinESMExports(); }
});

test('NO-START lifecycle persists post-save strict census refusal separately from stopped state', async t => {
  const f = await noStartLifecycleFixture(t), vanish = join(f.runRoot, 'post-save-ephemeral');
  await writeFile(join(f.runRoot, 'stable'), Buffer.alloc(29)); await writeFile(vanish, Buffer.alloc(7));
  const require = createRequire(import.meta.url), filesystem = require('node:fs/promises'), childProcess = require('node:child_process');
  const actualReaddir = filesystem.readdir;
  let removed = false;
  const readdirMock = t.mock.method(filesystem, 'readdir', async (...args: any[]) => {
    const names = await actualReaddir(...args);
    if (samePath(args[0], f.runRoot) && names.includes('native-lifecycle.json') && !removed) {
      removed = true; await unlink(vanish);
    }
    return names;
  });
  const spawnMock = t.mock.method(childProcess, 'spawn', () => assert.fail('NO-START close must never spawn a native helper.'));
  syncBuiltinESMExports();
  try {
    // Construction occurs after the builtin binding update, so its default
    // census IO captures this scoped wrapper. start() is deliberately absent.
    const environment = f.create();
    const error = await failure(environment.close());
    assert.equal(removed, true); assert.equal(error.code, 'ENOENT');
    assert.deepEqual(await environment.inspectStopped(), { stopped: true, serverStarted: false });
    const state = JSON.parse(await readFile(join(f.runRoot, 'native-lifecycle.json'), 'utf8'));
    assert.equal(state.serverStartAttempted, false); assert.equal(state.serverStarted, false);
    assert.equal(state.stopped, true);
    assert.equal(state.finalScratchBeforeSaveChecked, true);
    assert.equal(state.finalScratchAfterSaveChecked, false);
    assert.equal(state.finalScratchChecked, false);
    assert.deepEqual(state.errors, ['ENOENT']);
    assert.equal(state.censusDiagnostics.length, 1);
    const diagnostic = state.censusDiagnostics[0];
    assert.deepEqual(diagnostic, error.censusDiagnostic);
    assert.ok(diagnostic);
    assert.equal(diagnostic.phase, 'post-save-stopped'); assert.equal(diagnostic.attempt, 1);
    assert.equal(diagnostic.operation, 'lstat'); assert.equal(diagnostic.code, 'ENOENT');
    assert.equal(diagnostic.relativePath, 'post-save-ephemeral'); assert.equal(diagnostic.retryable, false);
    safeDiagnostics([error.censusDiagnostic!], f.runRoot);
    assert.equal(spawnMock.mock.callCount(), 0);
  } finally { readdirMock.mock.restore(); spawnMock.mock.restore(); syncBuiltinESMExports(); }
});
