/** Capture identity is bound in this closure by the trusted broker, never accepted from MCP arguments. */
import type { MCPService, JSONRPCRequest } from '../../mcp.ts';
import type { JobCapability } from '../agent-runtime/scope.ts';
import { currentRun, inRun } from './scope.ts';
import { recordDriverFrame } from './driver-hooks.ts';
import { ReplayDiverged } from './replay-run.ts';
export function bindCaptureBroker(service: MCPService, capability: JobCapability) {
  const run = currentRun(); if (!run) return null;
  const tools = run.tools ??= new Map(), broker = tools.size;
  const sessions = new Map<string, string>(), seen = new Set<string>(); let closed = false;
  const handle = async (request: unknown, session: string) => inRun(run, async () => {
    capability.assert(); seen.add(session);
    const response = await service.handle(capability.context, request as JSONRPCRequest, session);
    capability.assert(); return response ?? null;
  });
  tools.set(broker, handle);
  (run.checks ??= []).push(() => { if (!closed) throw new ReplayDiverged('The captured sample tool broker is still open.'); });
  return { replay: !!run.replay,
    handle: async (request: unknown, session: string) => {
      const response = await handle(request, session);
      if (!sessions.has(session)) sessions.set(session, `sample-session-${sessions.size}`);
      if (!run.driver) throw new ReplayDiverged('A tool call arrived outside its captured driver session.');
      recordDriverFrame(run, run.driver, 'tool', { broker, session: sessions.get(session), request, response: response ?? null });
      return response;
    },
    close: () => { if (closed) return; closed = true; for (const session of seen) service.close(capability.context, session); },
  };
}
