import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { preloadBridge, type Dispatch } from './preload-bridge.ts';
export type { Dispatch } from './preload-bridge.ts';
const { METHODS, validateHostRequest, publicError } = createRequire(import.meta.url)('../../../app/desktop/ipc-contract.cjs');

/** Trusted main-to-engine fixture. Removed renderer methods are first refused by the actual preload with zero dispatch. */
export async function trustedHostBridge({ dispatch }: { dispatch: Dispatch }) {
  const calls: any[] = [], wires: any[] = [], rejected: any[] = [];
  let rendererDispatches = 0;
  const renderer = await preloadBridge({ dispatch: async () => {
    rendererDispatches++; throw new Error('A host-only fixture request reached renderer dispatch.');
  } });
  const request = async (method: string, payload: Record<string, unknown> = {}): Promise<any> => {
    if (!METHODS.includes(method)) {
      await assert.rejects(renderer.request(method, payload), { code: 'INVALID_REQUEST' });
      assert.equal(renderer.calls.length, 0, 'The real renderer contract must refuse host-only methods.');
      assert.equal(rendererDispatches, 0, 'Renderer refusal must happen before engine or HTTP dispatch.');
    }
    const wire = structuredClone({ method, payload }); wires.push(wire);
    try {
      const admitted = validateHostRequest(wire); calls.push(admitted);
      return structuredClone(await dispatch(admitted.method, admitted.payload));
    } catch (error) {
      const typed = publicError(error); rejected.push({ wire, error: typed });
      throw Object.assign(new Error(typed.message), { code: typed.code });
    }
  };
  return { request, calls, wires, rejected, renderer, rendererDispatches: () => rendererDispatches };
}
export type TrustedHostBridge = Awaited<ReturnType<typeof trustedHostBridge>>;
