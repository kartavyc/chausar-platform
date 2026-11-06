// One-shot C6 task 3 (founder decision 2): a client's phone or WhatsApp number is only for opening WhatsApp. No view an
// AI task reads holds it, even for a client who allowed AI: one exported list of the client fields AI tasks may see.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { MCP_PROTOCOL_VERSION } from '../runtime/mcp.ts';
import { JobCapability } from '../runtime/venture/agent-runtime/scope.ts';
import { createJobMCP, type JobToolPorts, type JobSnapshot } from '../runtime/venture/agent-runtime/job-tools.ts';
import { CLIENT_AI_FIELDS } from '../runtime/venture/clients/phone.ts';
import { kitBusiness, installKitFixture, owner } from './fixtures/venture/kit-business.ts';
import { listRecords } from '../runtime/venture/records.ts';

test('the list of client fields an AI task may see holds no phone or WhatsApp number', () => {
  assert.deepEqual([...CLIENT_AI_FIELDS], ['id', 'name', 'email', 'taxId']);
});

test("the agent's read_client gives only those fields, even when the client record carries a phone", async t => {
  const undo = installKitFixture(); t.after(undo);
  const env = await kitBusiness();
  const venture = listRecords(env.store.read(), 'venture-record')[0]!;
  const scope = { jobId: 'job_c6', runId: 'run_c6', ventureId: venture.id, orderId: 'order_c6', clientId: env.client.id, agentId: 'agent_c6', memberId: 'owner', epoch: 1, consentId: 'consent_c6', consentRevision: 1, generation: 1 };
  const client = { id: env.client.id, ventureId: venture.id, name: 'Asha', email: 'asha@example.com', phone: '98765 43210', whatsapp: '919876543210' };
  const snapshot = { business: { id: venture.id, name: 'Test Studio', serviceType: 'consulting', dateOrder: 'day-month-year' }, client,
    order: { id: 'order_c6', ventureId: venture.id, clientId: env.client.id, request: 'A reply.', status: 'open' }, files: [], sections: ['Reply'], dates: [] } as unknown as JobSnapshot;
  const ports = { readSnapshot: () => snapshot, readFile: async () => ({ text: '', nextOffset: null }), calculations: [], calculate: async () => ({ result: null, receipts: [] }),
    readReceipt: async () => null, saveDraft: async () => { throw new Error('not here'); }, propose: async () => { throw new Error('not here'); } } as unknown as JobToolPorts;
  const mcp = createJobMCP(env.store, new JobCapability(scope, owner, () => {}), ports);
  await mcp.handle(owner, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'scripted-agent', version: '1' } } });
  await mcp.handle(owner, { jsonrpc: '2.0', method: 'notifications/initialized' });
  const answer: any = await mcp.handle(owner, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'read_client', arguments: {} } });
  const data = answer.result.structuredContent.data;
  assert.deepEqual(Object.keys(data).sort(), ['email', 'handoff', 'id', 'name']);
  const text = JSON.stringify(answer);
  assert.ok(!text.includes('98765') && !text.includes('919876543210'), 'no digit of the number reaches the agent');
});

test('no AI-facing source reads a client phone or WhatsApp number', async () => {
  const roots = ['agent-runtime', 'chief'];
  const offenders: string[] = [];
  for (const root of roots) {
    const folder = new URL(`../runtime/venture/${root}/`, import.meta.url);
    for (const name of await readdir(folder)) {
      if (!name.endsWith('.ts')) continue;
      const text = await readFile(new URL(name, folder), 'utf8');
      if (/\.(?:phone|whatsapp)\b/.test(text)) offenders.push(`${root}/${name}`);
    }
  }
  assert.deepEqual(offenders, []);
});
