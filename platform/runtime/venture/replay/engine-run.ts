import { encodeOperation, decodeOperation } from './operation.ts';
import { encodePublicRecords, decodePublicRecords } from './public-bytes.ts';
/** Developer-only engine capture and replay. Captures never activate through RPC or environment settings. */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { refuseInsideRepo } from '../../run-root.mjs';
import type { Engine } from '../../engine.ts';
import type { State } from '../../contracts.ts';
import { check } from '../../portable.ts';
import { createRunRecorder, writeRunCapture, maskCaptureText } from './capture.ts';
import { createRunReplay, diffRecords, readRunCapture } from './replay-run.ts';
import { inRun, drainRun, type RunScope } from './scope.ts';
import { secretFindings } from '../core/secrets.ts';

const METHODS = new Set(['venture.client.add', 'venture.interview.next', 'venture.delivery.run', 'venture.about.read', 'venture.chief.thread.send', 'venture.simulation.run']);
function assertMethod(method: string): void { check(METHODS.has(method), 'CAPTURE_METHOD_REFUSED', 'This operation is not qualified for offline sample replay.'); }

export async function captureEngineRequest(engine: Engine, method: string, payload: Record<string, unknown>, dir: string) {
  dir = refuseInsideRepo(dir, { env: {}, variable: 'capture.dir' });
  assertMethod(method);
  const startState = engine.vault!.read();
  const operation = encodeOperation(method, payload);
  const draft = method === 'venture.about.read' ? await engine.captureDraftState() : undefined;
  check(!secretFindings(JSON.stringify(operation)).length, 'CAPTURE_REFUSED', 'The capture request holds a secret.');
  const recorder = createRunRecorder({ startState, capturedAt: new Date().toISOString() });
  const run: RunScope = { recorder, owner: engine };
  const result = await inRun(run, () => engine.request(method, payload));
  await drainRun(run);
  const capture = recorder.finish(draft ? (await engine.captureDraftState()).conversations : engine.vault!.read().conversations);
  capture.runtime = { modelReplay: engine.options.venture?.modelTransport?.replay === true || !!engine.options.venture?.modelReplayPath, ...(draft ? { draftState: encodePublicRecords(draft) } : {}) };
  capture.operation = JSON.parse(maskCaptureText(JSON.stringify(operation)));
  return { result, path: await writeRunCapture(dir, capture) };
}

export async function replayEngineRun(value: unknown): Promise<{ records: unknown[]; differences: string[] }> {
  const capture = readRunCapture(value);
  check(!secretFindings(JSON.stringify(capture)).length, 'CAPTURE_REFUSED', 'The capture holds a secret.');
  check(capture.operation, 'CAPTURE_INVALID', 'The capture needs a sample business request.');
  assertMethod(capture.operation.method);
  check(typeof capture.runtime?.modelReplay === 'boolean', 'CAPTURE_INVALID', 'The capture needs its original model transport mode.');
  const operation = decodeOperation(capture.operation);
  const start = decodePublicRecords(capture.startState) as State;
  check(start?.workspace?.demo === true && Array.isArray(start.conversations), 'CAPTURE_SAMPLE_REQUIRED', 'Replay only a sample business.');
  const { Engine } = await import('../../engine.ts');
  const root = await mkdtemp(join(tmpdir(), 'chausar-replay-'));
  const offline = async () => { throw new Error('Replay cannot call a real model.'); };
  const engine = new Engine({ directory: root, demo: true, storage: 'experimental-file', capture: { dir: join(root, 'unused-captures') }, venture: { host: 'test', credentials: { get: async (workspaceId, name) => workspaceId === start.workspace.id && name.startsWith('model:') ? 'sample-replay-credential' : null, set: offline, delete: offline }, statusPages: false, hostProcess: offline, githubTransport: { kind: 'fixture', read: offline }, net: { resolve: offline, send: offline, tls: () => { throw new Error('Replay cannot open a real network connection.'); } }, modelTransport: { replay: capture.runtime.modelReplay, http: offline, process: offline } } });
  try {
    await engine.request('workspace.create', { name: 'Replay sample', passphrase: 'sample-replay-passphrase', demo: true });
    await engine.vault!.restoreCaptureState(start);
    if (capture.runtime.draftState) await engine.captureDraftState(decodePublicRecords(capture.runtime.draftState) as State);
    const replay = createRunReplay(capture), run: RunScope = { replay };
    await inRun(run, () => engine.request(operation.method, operation.payload));
    await drainRun(run);
    replay.done();
    const records = JSON.parse(maskCaptureText(JSON.stringify(encodePublicRecords(capture.runtime.draftState ? (await engine.captureDraftState()).conversations : engine.vault!.read().conversations))));
    return { records, differences: diffRecords(capture.records, records) };
  } finally { await engine.close(); await rm(root, { recursive: true, force: true }); }
}
