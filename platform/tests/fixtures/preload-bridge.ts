import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import vm from 'node:vm';

// The real desktop preload (app/desktop/preload.cjs) over a structured-clone IPC fixture and the strict request contract
// (app/desktop/ipc-contract.cjs), with no Electron and no window. The Ink app reaches the engine only through this
// window.chausar.request, so engine acceptance tests drive it directly: what passes here is what the desktop sends.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(import.meta.url);
const contract = require(join(root, 'app/desktop/ipc-contract.cjs'));
const preloadSource = await readFile(join(root, 'app/desktop/preload.cjs'), 'utf8');

export type Dispatch = (method: string, payload: Record<string, unknown>) => Promise<unknown>;
export type PreloadBridge = Awaited<ReturnType<typeof preloadBridge>>;

/**
 * calls: every request the contract admitted, as the main process would see it. wires: every envelope as it crossed
 * the clone boundary. rejected: every refusal, from the contract or the dispatcher, as the window receives it.
 */
export async function preloadBridge({ dispatch }: { dispatch: Dispatch }) {
  const calls: any[] = [], wires: any[] = [], rejected: any[] = [];
  let exposed: any;
  const ipcRenderer = {
    async invoke(channel: string, envelope: unknown) {
      assert.equal(channel, 'chausar:request');
      // Electron IPC serializes with structured clone, which keeps own undefined properties. A JSON round trip here
      // would hide the bug the strict contract exists to catch.
      const wire = structuredClone(envelope); wires.push(wire);
      try {
        const request = contract.validateRequest(wire); calls.push(request);
        return structuredClone({ ok: true, result: await dispatch(request.method, request.payload) });
      } catch (error: any) { const typed = contract.publicError(error); rejected.push({ wire, error: typed }); return { ok: false, error: typed }; }
    },
    on() {}, removeListener() {},
  };
  vm.runInNewContext(preloadSource, { require: (name: string) => {
    assert.equal(name, 'electron');
    return { ipcRenderer, contextBridge: { exposeInMainWorld(name: string, api: any) { assert.equal(name, 'chausar'); exposed = api; } } };
  } }, { filename: join(root, 'app/desktop/preload.cjs') });
  assert.ok(exposed, 'The preload must expose window.chausar.');
  const request = (method: string, payload: Record<string, unknown> = {}): Promise<any> => exposed.request(method, payload);
  return { exposed, request, calls, wires, rejected };
}
