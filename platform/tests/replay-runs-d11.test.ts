// D11e task 27 (the replay module and scripts/replay-run.mjs; the engine and driver hooks come after the rebase): a
// stand-in run is captured, then replayed from the capture. The same code makes the same records; a changed step
// shows as one line; a changed request names the call that diverged.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRunRecorder, writeRunCapture, type RunCapture } from '../runtime/venture/replay/capture.ts';
import { createRunReplay, diffRecords, normaliseRecords } from '../runtime/venture/replay/replay-run.ts';

type Deps = { model(purpose: string, request: string): string; fetch(url: string): { status: number; body: string }; now(): string };
type Variant = 'today' | 'changed-step' | 'new-prompt';

/** A stand-in run: a plan, a fetched page, a drafted offer. Ids are new each run, as the engine's are. */
function sampleRun(deps: Deps, variant: Variant = 'today') {
  const plan = deps.model('plan-suggest', 'Plan a tutoring business for Priya (priya@example.com)');
  const page = deps.fetch('https://example.com/pricing');
  const draft = deps.model('compose', `${variant === 'new-prompt' ? 'Write a shorter offer from' : 'Write an offer from'}: ${plan}`);
  return [
    { id: `venture_${randomUUID().slice(0, 8)}`, kind: 'plan', text: plan, createdAt: deps.now() },
    { id: `draft_${randomUUID().slice(0, 8)}`, kind: 'draft', text: variant === 'changed-step' ? draft.replace('Rs 500', 'Rs 600') : draft, status: 'draft', source: page.status, createdAt: deps.now() },
  ];
}

/** The run once against stand-in answers, recorded. */
function capturedRun(): RunCapture {
  const recorder = createRunRecorder({ startState: { schemaVersion: 1 }, capturedAt: '2026-11-06T10:00:00.000Z' });
  let clock = 0;
  const answers: Record<string, string> = { 'plan-suggest': 'Maths tutoring for class 10, Rs 500 an hour.', compose: 'Offer: maths tutoring, Rs 500 an hour.' };
  const live: Deps = {
    model: (purpose, request) => { recorder.model(purpose, request, answers[purpose]); return answers[purpose]; },
    fetch: url => { recorder.fetch(url, 200, '<p>Rs 500</p>'); return { status: 200, body: '<p>Rs 500</p>' }; },
    now: () => { const at = new Date(Date.UTC(2026, 10, 6, 10, 0, ++clock)).toISOString(); recorder.clock(at); return at; },
  };
  return recorder.finish(sampleRun(live));
}

const replayed = (capture: RunCapture, variant: Variant) => {
  const replay = createRunReplay(capture);
  const records = sampleRun({ model: (purpose, request) => replay.model(purpose, request), fetch: url => replay.fetch(url), now: () => replay.now() }, variant);
  replay.done();
  return records;
};

test('the same code replays to the same records (ids and times named by first appearance)', () => {
  const capture = capturedRun();
  const records = replayed(capture, 'today');
  assert.deepEqual(diffRecords(capture.records, records), []);
  assert.deepEqual((normaliseRecords(records) as any[]).map(record => record.id), ['<id-1>', '<id-2>']);
  assert.equal((normaliseRecords(records) as any[])[0].createdAt, '<time-1>');
});

test('a code change that alters one step shows one readable line', () => {
  const capture = capturedRun();
  assert.deepEqual(diffRecords(capture.records, replayed(capture, 'changed-step')), ['records[1].text: "Offer: maths tutoring, Rs 500 an hour." -> "Offer: maths tutoring, Rs 600 an hour."']);
});

test('a request that no longer matches names the call that diverged', () => {
  const capture = capturedRun();
  assert.throws(() => replayed(capture, 'new-prompt'), (error: any) => {
    assert.equal(error.code, 'REPLAY_DIVERGED');
    assert.match(error.message, /^Model call 2 \(compose\) diverged: the request changed\./);
    assert.match(error.message, /captured: Write an offer from/);
    assert.match(error.message, /now: +Write a shorter offer from/);
    return true;
  });
});

test('a run that stops early, or asks for more, diverges by name', () => {
  const capture = capturedRun();
  const early = createRunReplay(capture);
  early.model('plan-suggest', 'Plan a tutoring business for Priya (priya@example.com)');
  assert.throws(() => early.done(), /The run ended early: the capture still holds 1 model call, 1 fetch, 2 clock readings/);
  const more = createRunReplay(capture);
  more.model('plan-suggest', 'Plan a tutoring business for Priya (priya@example.com)');
  more.model('compose', 'Write an offer from: Maths tutoring for class 10, Rs 500 an hour.');
  assert.throws(() => more.model('judge', 'x'), /Model call 3 \(judge\) was not in the capture/);
});

async function written(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'chausar-replay-run-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return { dir, capture: await writeRunCapture(dir, capturedRun()) };
}
const SCRIPT = fileURLToPath(new URL('../../scripts/replay-run.mjs', import.meta.url));
const run = (...args: string[]) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', windowsHide: true, timeout: 60_000 });

test('replay-run.mjs --check summarises a capture; --records prints each difference and fails', async t => {
  const { dir, capture } = await written(t);
  const check = run(capture, '--check');
  assert.equal(check.status, 0, check.stderr);
  assert.match(check.stdout, /2 model calls \(plan-suggest, compose\), 0 driver lines, 1 fetches, 2 clock readings, 2 records/);
  const parsed = capturedRun();
  await writeFile(join(dir, 'same.json'), JSON.stringify(replayed(parsed, 'today')));
  await writeFile(join(dir, 'changed.json'), JSON.stringify(replayed(parsed, 'changed-step')));
  assert.equal(run(capture, '--records', join(dir, 'same.json')).status, 0);
  const changed = run(capture, '--records', join(dir, 'changed.json'));
  assert.equal(changed.status, 1);
  assert.match(changed.stdout, /^1 difference:\n {2}records\[1\]\.text: /);
  assert.equal(run(capture).status, 1, 'a recorder-only capture has no executable operation');
});

test('replay-run.mjs refuses a capture file that holds a secret, by kind', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'chausar-replay-run-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const key = ['ghp', 'Ab1Cd2Ef3Gh4Ij5Kl6Mn7Op8Qr9St0Uv1Wx2'].join('_');
  await writeFile(join(dir, 'bad.capture.json'), JSON.stringify({ ...capturedRun(), records: [{ note: key }] }));
  const result = run(join(dir, 'bad.capture.json'), '--check');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /holds a secret/);
  assert.equal(result.stderr.includes(key), false);
});

test('every retained sample capture replays through the current engine', async () => {
  const directory = new URL('./fixtures/replays/', import.meta.url);
  const files = (await readdir(directory)).filter(name => name.endsWith('.capture.json')).sort();
  assert.ok(files.length >= 7, 'retain the qualified injected sample flows');
  const { replayEngineRun } = await import('../runtime/venture/replay/engine-run.ts');
  for (const name of files) {
    const capture = JSON.parse(await readFile(new URL(name, directory), 'utf8'));
    assert.deepEqual((await replayEngineRun(capture)).differences, [], name);
  }
});
