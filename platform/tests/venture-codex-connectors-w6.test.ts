// W6 6F5 (D34): email through the AI tool's own Gmail connection, Codex side. Codex apps run only for a ChatGPT-plan
// login and only when the owner turns the connection on; Gmail is the one app Chausar enables. Every tool that writes
// is set to always ask, the asking goes to the owner (never the automatic reviewer), and each ask becomes Chausar's
// exact approval card for the Codex item it belongs to. A scripted app-server stands in for Codex; nothing is sent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CodexDriver, codexConfig } from '../runtime/venture/agent-runtime/codex-driver.ts';
import type { CodexChild } from '../runtime/venture/agent-runtime/codex-rpc.ts';
import type { AgentApprovalRequest, AgentDriverEvent, AgentDriverInput } from '../runtime/venture/agent-runtime/driver-types.ts';
import { AGENT_MCP_TOOL_NAMES } from '../runtime/venture/agent-runtime/driver-types.ts';
import { CODEX_APPS_SERVER, GMAIL_CONNECTOR_ID, codexGmailTool } from '../runtime/venture/agent-runtime/connector-policy.ts';

const LINK = ['link', 'synthetic', '01'].join('_');
const gmailTool = (name: string, readOnly: boolean) => ({ name: `gmail.${name}`, annotations: { readOnlyHint: readOnly }, _meta: { connector_id: GMAIL_CONNECTOR_ID, connector_name: 'Gmail', link_id: LINK } });
const OWN = { name: 'chausar', runtimeStatus: 'connected', tools: Object.fromEntries(AGENT_MCP_TOOL_NAMES.map(name => [name, {}])) };
const APPS_ALL = { name: CODEX_APPS_SERVER, runtimeStatus: 'connected', tools: {
  'gmail.search_emails': gmailTool('search_emails', true), 'gmail.send_email': gmailTool('send_email', false), 'gmail.delete_emails': gmailTool('delete_emails', false),
  'apollo_io.apollo_emailer_messages_send_now': { name: 'apollo_io.apollo_emailer_messages_send_now', _meta: { connector_id: 'asdk_app_other', link_id: 'link_other' } },
} };

function input(connectors = true, events: AgentDriverEvent[] = []): AgentDriverInput {
  return { jobId: 'job-1', jobRoot: join(tmpdir(), 'chausar-synthetic-codex-job'), settings: { model: 'explicit-model', effort: 'high', autoReview: true, shell: false, network: false, webSearch: false, ...(connectors ? { connectors: true } : {}) }, mcp: { name: 'chausar', command: process.execPath, args: ['synthetic-mcp'], env: {} }, guard() {}, onEvent: event => events.push(event) };
}
function fixture(base: AgentDriverInput, change?: (method: string, params: any, result: any) => unknown) {
  const sent: any[] = []; let child: CodexChild; let turns = 0;
  const receive = (value: unknown) => child.stdout.emit('data', Buffer.from(JSON.stringify(value) + '\n'));
  const driver = new CodexDriver({ executable: process.execPath, platform: 'win32', qualify: async () => {}, spawn: () => {
    child = new EventEmitter() as CodexChild; child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => { child.emit('exit', 0); return true; };
    child.stdin = new Writable({ write(chunk, _encoding, done) {
      const message = JSON.parse(String(chunk)); sent.push(message); done();
      if (!('id' in message) || !message.method) return;
      let result: any = {};
      if (message.method === 'initialize') result = { userAgent: 'chausar/0.166.0 (Windows 10.0.26200; x86_64) unknown (chausar; 0.1.0)' };
      if (message.method === 'thread/start') result = { thread: { id: 'thread-1', ephemeral: true }, model: message.params.model, cwd: message.params.cwd, runtimeWorkspaceRoots: message.params.runtimeWorkspaceRoots, activePermissionProfile: { id: message.params.permissions }, approvalsReviewer: message.params.approvalsReviewer, approvalPolicy: message.params.approvalPolicy, instructionSources: [] };
      // Codex lists the whole account catalogue on the apps server, even at thread level; app/installed says what is callable.
      if (message.method === 'mcpServerStatus/list') result = { data: message.params.threadId ? [OWN, ...(base.settings.connectors ? [APPS_ALL] : [])] : [OWN, APPS_ALL, { name: 'owner_tool', runtimeStatus: 'connected', tools: { x: {} } }], nextCursor: null };
      if (message.method === 'experimentalFeature/list') result = { data: Object.entries(codexConfig(base, 'fixture', 'win32').features).map(([name, enabled]) => ({ name, enabled: typeof enabled === 'boolean' ? enabled : false })), nextCursor: null };
      if (message.method === 'turn/start') result = { turn: { id: `turn-${++turns}`, status: 'inProgress', items: [] } };
      if (message.method === 'app/installed') result = { apps: [{ id: GMAIL_CONNECTOR_ID, runtimeName: 'Gmail', enabled: true, callable: true }, { id: 'asdk_app_other', runtimeName: 'Other', enabled: false, callable: false }] };
      queueMicrotask(() => receive({ id: message.id, result: change ? change(message.method, message.params, result) : result }));
    } }); return child;
  } });
  return { driver, sent, receive };
}
const tick = () => new Promise(done => setImmediate(done));
async function started(base: AgentDriverInput, change?: Parameters<typeof fixture>[1]) {
  const f = fixture(base, change), session = await f.driver.open(base), run = session.run('Synthetic order'); await tick();
  return { ...f, session, run };
}
const elicit = (id: string, tool: string, params: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  id, method: 'mcpServer/elicitation/request', params: { threadId: 'thread-1', turnId: 'turn-1', serverName: CODEX_APPS_SERVER, mode: 'form', message: 'Allow Gmail to send?', requestedSchema: { type: 'object', properties: {} },
    _meta: { codex_approval_kind: 'mcp_tool_call', connector_id: GMAIL_CONNECTOR_ID, connector_name: 'Gmail', tool_name: tool, tool_params: params, approvals_reviewer: 'user', ...extra } },
});
const item = (id: string, tool: string, args: Record<string, unknown>, server = CODEX_APPS_SERVER) => ({ method: 'item/started', params: { threadId: 'thread-1', turnId: 'turn-1', item: { type: 'mcpToolCall', id, server, tool, status: 'inProgress', arguments: args, appContext: { connectorId: GMAIL_CONNECTOR_ID, linkId: LINK, resourceUri: null, appName: 'Gmail', actionName: tool } } } });
const MAIL = { to: ['client@example.org'], subject: 'Your September books', body: 'Hello, the books are attached.' };

test('6F5: only the Gmail draft and send tools are on, and each always asks; reading the mailbox stays off', () => {
  // Reading would put other people's mail in front of the AI without their recorded consent, so no read tool is on.
  for (const name of ['search_emails', 'gmail.read_email', 'read_email_thread', 'list_drafts', 'get_profile']) assert.equal(codexGmailTool(name), null, name);
  for (const name of ['send_email', 'gmail.send_draft', 'create_draft']) assert.equal(codexGmailTool(name), 'ask', name);
  for (const name of ['delete_emails', 'archive_emails', 'forward_emails', 'batch_modify_email', 'update_draft', 'apollo_send_now', '']) assert.equal(codexGmailTool(name), null, name);
});

test('6F5: off by default and with an API key: no apps; on with a ChatGPT login: only Gmail, every write asks the owner', () => {
  assert.equal(codexConfig(input(false), 'p', 'win32').features.apps, false);
  const keyed = input(); keyed.credentials = { apiKey: ['synthetic', 'credential'].join('-') };
  const off = codexConfig(keyed, 'p', 'win32');
  assert.equal(off.features.apps, false, 'connectors need the ChatGPT plan login');
  assert.equal(off.apps._default.enabled, false);
  const on = codexConfig(input(), 'p', 'win32');
  assert.equal(on.features.apps, true);
  assert.equal(on.features.tool_call_mcp_elicitation, true);
  assert.equal(on.approval_policy.granular.mcp_elicitations, true);
  assert.deepEqual(on.apps._default, { enabled: false, approvals_reviewer: 'user', destructive_enabled: false, open_world_enabled: false, default_tools_approval_mode: 'prompt' });
  const gmail = on.apps[GMAIL_CONNECTOR_ID];
  assert.equal(gmail.enabled, true); assert.equal(gmail.approvals_reviewer, 'user'); assert.equal(gmail.destructive_enabled, false);
  assert.equal(gmail.default_tools_enabled, false); assert.equal(gmail.default_tools_approval_mode, 'prompt');
  assert.deepEqual(gmail.tools.send_email, { enabled: true, approval_mode: 'prompt' });
  assert.deepEqual(gmail.tools['gmail.send_email'], { enabled: true, approval_mode: 'prompt' });
  assert.equal(gmail.tools.search_emails, undefined, 'reads stay off');
  assert.ok(Object.values(gmail.tools).every((tool: any) => tool.approval_mode === 'prompt'), 'every enabled tool always asks');
  assert.equal(gmail.tools.delete_emails, undefined, 'never enabled');
  assert.equal(Object.keys(on.apps).length, 2, 'no other app');
});

test('6F5: the thread binds every Gmail account link to the owner as reviewer and leaves the apps server running', async () => {
  const f = fixture(input()), session = await f.driver.open(input());
  const start = f.sent.find(message => message.method === 'thread/start');
  assert.deepEqual(start.params.approvalPolicy.granular.mcp_elicitations, true);
  assert.deepEqual(start.params.config.apps[GMAIL_CONNECTOR_ID].links, { [LINK]: { approvals_reviewer: 'user', default_tools_approval_mode: 'prompt' } });
  assert.equal(start.params.config.mcp_servers[CODEX_APPS_SERVER], undefined, 'the apps server is not switched off');
  assert.deepEqual(start.params.config.mcp_servers.owner_tool, { enabled: false });
  assert.match(start.params.developerInstructions, /Gmail/);
  await session.close();
  // Off: the apps server is switched off with the owner's other servers, and instructions do not mention Gmail.
  const g = fixture(input(false)), plain = await g.driver.open(input(false));
  const offStart = g.sent.find(message => message.method === 'thread/start');
  assert.deepEqual(offStart.params.config.mcp_servers[CODEX_APPS_SERVER], { enabled: false });
  assert.doesNotMatch(offStart.params.developerInstructions, /Gmail/);
  await plain.close();
});

test('6F5: a thread where any other connector is callable is refused before a prompt is shared', async () => {
  const f = fixture(input(), (method, _params, result) => method === 'app/installed' ? { apps: [...result.apps, { id: 'asdk_app_other', runtimeName: 'Other', enabled: true, callable: true }] } : result);
  await assert.rejects(f.driver.open(input()), { code: 'CODEX_POLICY_UNSUPPORTED' });
  assert.equal(f.sent.some(message => message.method === 'turn/start'), false);
  const ok = fixture(input()), session = await ok.driver.open(input());
  assert.ok(ok.sent.some(message => message.method === 'app/installed' && message.params.threadId === 'thread-1'), 'the callable apps are read for this thread');
  await session.close();
});

test('6F5: a Gmail send becomes the exact approval card for its Codex item; approve accepts once, decline refuses', async () => {
  const base = input(), asked: AgentApprovalRequest[] = []; let answer = true;
  base.requestApproval = async request => { asked.push(request); return answer; };
  const f = await started(base);
  f.receive(item('call-1', 'send_email', MAIL));
  f.receive(elicit('e1', 'send_email', MAIL));
  await tick(); await tick();
  assert.equal(asked.length, 1);
  assert.deepEqual(asked[0], { kind: 'connector-send', requestId: 'codex-elicitation:e1', threadId: 'thread-1', turnId: 'turn-1', itemId: 'call-1', name: 'Gmail: send_email', arguments: MAIL,
    description: 'Codex wants to send this through your own Gmail connection in ChatGPT. Approving sends exactly this, once.' });
  assert.deepEqual(f.sent.find(message => message.id === 'e1').result, { action: 'accept', content: {}, _meta: null });
  answer = false;
  f.receive(item('call-2', 'send_email', { ...MAIL, subject: 'Second' }));
  f.receive(elicit('e2', 'send_email', { ...MAIL, subject: 'Second' }));
  await tick(); await tick();
  assert.deepEqual(f.sent.find(message => message.id === 'e2').result, { action: 'decline', content: null, _meta: null });
  f.receive({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' } } });
  assert.equal((await f.run).status, 'completed');
  await f.session.close();
});

test('6F5: an ask that matches no started item, a foreign server or a tool that is off is declined without a card', async () => {
  const base = input(), asked: AgentApprovalRequest[] = []; base.requestApproval = async request => { asked.push(request); return true; };
  const f = await started(base);
  f.receive(elicit('n1', 'send_draft', { draftId: 'd1' }));
  f.receive(elicit('n2', 'delete_emails', { ids: ['1'] }));
  f.receive(item('call-3', 'send_email', MAIL));
  f.receive(elicit('n3', 'send_email', MAIL, { connector_id: 'asdk_app_other' }));
  f.receive({ id: 'n4', method: 'mcpServer/elicitation/request', params: { threadId: 'thread-1', turnId: 'turn-1', serverName: 'owner_tool', mode: 'url', message: 'Sign in', url: 'https://example.org', elicitationId: 'x', _meta: null } });
  await tick(); await tick();
  assert.equal(asked.length, 0);
  for (const id of ['n1', 'n2', 'n3', 'n4']) assert.equal(f.sent.find(message => message.id === id).result.action, 'decline', id);
  await f.session.close();
});

test('6F5: with connectors off, any ask is declined and any connector item stops the job', async () => {
  const base = input(false), asked: AgentApprovalRequest[] = []; base.requestApproval = async request => { asked.push(request); return true; };
  const f = await started(base);
  f.receive(elicit('o1', 'send_email', MAIL)); await tick(); await tick();
  assert.equal(f.sent.find(message => message.id === 'o1').result.action, 'decline');
  f.receive(item('call-4', 'search_emails', { query: 'synthetic' }));
  assert.equal((await f.run).status, 'failed');
  assert.equal(asked.length, 0);
});

test('6F5: a read, a tool that is off, or a write that completes without approval stops the job', async () => {
  const events: AgentDriverEvent[] = [];
  const base = input(true, events); base.requestApproval = async () => true;
  const r = await started(base);
  r.receive(item('read-1', 'search_emails', { query: 'synthetic' }));
  assert.equal((await r.run).status, 'failed', 'reading the mailbox is off');
  const f = await started(base);
  f.receive(item('draft-1', 'create_draft', MAIL));
  await tick();
  assert.ok(events.some(event => event.type === 'tool-started' && event.name === 'gmail.create_draft'));
  f.receive(item('off-1', 'delete_emails', { ids: ['1'] }));
  assert.equal((await f.run).status, 'failed');
  const g = await started(base);
  g.receive(item('call-5', 'send_email', MAIL));
  g.receive({ method: 'item/completed', params: { threadId: 'thread-1', turnId: 'turn-1', item: { type: 'mcpToolCall', id: 'call-5', server: CODEX_APPS_SERVER, tool: 'send_email', status: 'completed', arguments: MAIL } } });
  assert.equal((await g.run).status, 'failed', 'a send nobody approved here stops everything');
});

test('6F5: the automatic reviewer never decides a connector call: the job stops the moment it starts one', async () => {
  const base = input(); base.requestApproval = async () => true;
  const f = await started(base);
  f.receive(item('call-6', 'send_email', MAIL));
  f.receive({ method: 'item/autoApprovalReview/started', params: { threadId: 'thread-1', turnId: 'turn-1', startedAtMs: 1, reviewId: 'r1', targetItemId: 'call-6', review: {}, action: { type: 'mcpToolCall', server: CODEX_APPS_SERVER, toolName: 'send_email', connectorId: GMAIL_CONNECTOR_ID, connectorName: 'Gmail', toolTitle: null } } });
  assert.equal((await f.run).status, 'failed');
});
