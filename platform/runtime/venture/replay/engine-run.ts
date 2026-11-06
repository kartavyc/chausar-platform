import { encodePublicRecords, decodePublicRecords } from './public-bytes.ts';
/** Developer-only engine capture and replay. Captures never activate through RPC or environment settings. */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Engine } from '../../engine.ts';
import type { State } from '../../contracts.ts';
import { check } from '../../portable.ts';
import { createRunRecorder, writeRunCapture, maskCaptureText } from './capture.ts';
import { createRunReplay, diffRecords, readRunCapture } from './replay-run.ts';
import { inRun, drainRun, type RunScope } from './scope.ts';
import { secretFindings } from '../core/secrets.ts';

export async function captureEngineRequest(engine: Engine, method: string, payload: Record<string, unknown>, dir: string) {
  check(method.startsWith('venture.'), 'CAPTURE_METHOD_REFUSED', 'Capture a sample business request after opening its workspace.');
  const startState = engine.vault!.read();
  const operation = { method, payload: structuredClone(payload) };
  check(!secretFindings(JSON.stringify(operation)).length, 'CAPTURE_REFUSED', 'The capture request holds a secret.');
  const recorder = createRunRecorder({ startState, capturedAt: new Date().toISOString() });
  const run: RunScope = { recorder, owner: engine };
  const result = await inRun(run, () => engine.request(method, payload));
  await drainRun(run);
  const capture = recorder.finish(engine.vault!.read().conversations);
  capture.operation = JSON.parse(maskCaptureText(JSON.stringify(operation)));
  return { result, path: await writeRunCapture(dir, capture) };
}

export async function replayEngineRun(value: unknown): Promise<{ records: unknown[]; differences: string[] }> {
  const capture = readRunCapture(value);
  check(!secretFindings(JSON.stringify(capture)).length, 'CAPTURE_REFUSED', 'The capture holds a secret.');
  check(capture.operation && capture.operation.method.startsWith('venture.'), 'CAPTURE_INVALID', 'The capture needs a sample business request.');
  const start = decodePublicRecords(capture.startState) as State;
  check(start?.workspace?.demo === true && Array.isArray(start.conversations), 'CAPTURE_SAMPLE_REQUIRED', 'Replay only a sample business.');
  const { Engine } = await import('../../engine.ts');
  const root = await mkdtemp(join(tmpdir(), 'chausar-replay-'));
  const offline = async () => { throw new Error('Replay cannot call a real model.'); };
  const engine = new Engine({ directory: root, demo: true, storage: 'experimental-file', capture: { dir: join(root, 'unused-captures') }, venture: { modelTransport: { replay: true, http: offline, process: offline } } });
  try {
    await engine.request('workspace.create', { name: 'Replay sample', passphrase: 'sample-replay-passphrase', demo: true });
    await engine.vault!.restoreCaptureState(start);
    const replay = createRunReplay(capture), run: RunScope = { replay };
    await inRun(run, () => engine.request(capture.operation!.method, capture.operation!.payload));
    await drainRun(run);
    replay.done();
    const records = JSON.parse(maskCaptureText(JSON.stringify(encodePublicRecords(engine.vault!.read().conversations))));
    return { records, differences: diffRecords(capture.records, records) };
  } finally { await engine.close(); await rm(root, { recursive: true, force: true }); }
}
