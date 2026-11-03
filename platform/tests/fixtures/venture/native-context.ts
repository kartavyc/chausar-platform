import assert from 'node:assert/strict';
import { MCP_PROTOCOL_VERSION } from '../../../runtime/mcp.ts';
import type { Context } from '../../../runtime/contracts.ts';
import type { VentureDeps } from '../../../runtime/venture/contracts.ts';
import { ventureAction } from '../../../runtime/venture/records.ts';
import { ensurePlaybook } from '../../../runtime/venture/delivery/playbook.ts';
import { createNativeJob } from '../../../runtime/venture/agent-runtime/native-job.ts';
import { consentForOrder } from './scripted-agent.ts';

/** Memory tests use the actual scoped MCP service, with explicit consent for one synthetic order. */
export async function nativeContext(deps: VentureDeps, owner: Context, orderId: string) {
  await deps.store.update(state => { state.policy.send = 'shape'; });
  await consentForOrder(deps, owner, orderId);
  const playbook = await ensurePlaybook(deps, owner);
  const run = await ventureAction(deps, owner, 'prepare', 'test.context', tx => tx.put({
    ...tx.base('venture-delivery-run'), orderId, playbookId: playbook.id, playbookHash: playbook.hash,
    status: 'waiting-for-you', servedBy: 'model', practice: false, callId: null, preview: null,
    deliverable: null, renderedText: null, checks: [], verdict: null, editedText: null,
  }));
  const job = await createNativeJob(deps, owner, run.id, { agentId: 'delivery', sections: ['Reply'], check: () => undefined });
  await job.service.handle(owner, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'memory-fixture', version: '1' } } });
  await job.service.handle(owner, { jsonrpc: '2.0', method: 'notifications/initialized' });
  return { run, job, async read() {
    const response: any = await job.service.handle(owner, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'read_business', arguments: {} } });
    assert.equal(response.error, undefined, JSON.stringify(response.error));
    return response.result.structuredContent.data;
  } };
}
