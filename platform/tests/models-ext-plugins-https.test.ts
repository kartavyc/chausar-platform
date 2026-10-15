/**
 * The plugin network door against a real HTTPS endpoint on 127.0.0.1, through the production transport (`fetch`).
 *
 * The parent makes a throwaway test CA and server certificate with `openssl`, serves plain endpoints and a real
 * MCP server (both eras) over `node:https`, and runs the checks in a child process that trusts only that CA
 * (`NODE_EXTRA_CA_CERTS`); TLS verification stays on, and a certificate from another CA is refused. The child's
 * preload only routes `*.chausar.test` connections to the local port, so URLs keep their exact name and port 443.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:https';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createSecureContext } from 'node:tls';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CHILD = process.env.CHAUSAR_PLUGIN_HTTPS_CHILD === '1';
const SESSION = 'sess-https-1';

function openssl(): string | null {
  try { execFileSync('openssl', ['version'], { stdio: 'ignore' }); return 'openssl'; } catch { return null; }
}
async function certificates(dir: string) {
  const run = (args: string[]) => execFileSync('openssl', args, { cwd: dir, stdio: 'ignore' });
  const ca = (name: string) => run(['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', `${name}.key`, '-out', `${name}.pem`, '-days', '2', '-subj', `/CN=Chausar ${name}`, '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign']);
  const leaf = (name: string, issuer: string, names: string[]) => {
    run(['req', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', `${name}.key`, '-out', `${name}.csr`, '-subj', `/CN=${names[0]}`]);
    return writeFile(join(dir, `${name}.cnf`), `subjectAltName=${names.map(n => `DNS:${n}`).join(',')}\nbasicConstraints=CA:FALSE\nextendedKeyUsage=serverAuth\n`)
      .then(() => run(['x509', '-req', '-in', `${name}.csr`, '-CA', `${issuer}.pem`, '-CAkey', `${issuer}.key`, '-CAcreateserial', '-out', `${name}.pem`, '-days', '2', '-extfile', `${name}.cnf`]));
  };
  ca('test-ca'); ca('rogue-ca');
  await leaf('server', 'test-ca', ['mcp.chausar.test', 'evil.chausar.test', 'other.chausar.test']);
  await leaf('rogue', 'rogue-ca', ['rogue.chausar.test']);
  const read = (name: string) => readFile(join(dir, name), 'utf8');
  return { ca: join(dir, 'test-ca.pem'), server: { key: await read('server.key'), cert: await read('server.pem') }, rogue: { key: await read('rogue.key'), cert: await read('rogue.pem') } };
}

/** Plain endpoints for the door, and an MCP endpoint speaking 2026-07-28 and 2025-11-25 Streamable HTTP. */
function handler(hits: string[]) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    const host = String(req.headers.host); hits.push(`${host} ${req.method} ${req.url}`);
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(chunk as Buffer);
    const send = (status: number, body: string, headers: Record<string, string> = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(body); };
    if (req.url === '/hello') return send(200, JSON.stringify({ hello: 'from a real TLS server', host }));
    if (req.url === '/redirect') return send(302, '', { location: 'https://evil.chausar.test/steal' });
    if (req.url === '/big') return send(200, JSON.stringify({ pad: 'x'.repeat(64 * 1024) }));
    if (req.url === '/slow') { await new Promise(resolve => setTimeout(resolve, 3000)); return res.destroyed ? undefined : send(200, '{}'); }
    if (req.url !== '/mcp' || req.method !== 'POST') return send(404, '');
    const accept = String(req.headers.accept ?? '');
    if (!accept.includes('application/json') || !accept.includes('text/event-stream')) return send(406, '');
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const reply = (result: unknown, headers: Record<string, string> = {}) => send(200, JSON.stringify({ jsonrpc: '2.0', id: body.id, result }), headers);
    const modern = body.params?._meta?.['io.modelcontextprotocol/protocolVersion'];
    if (body.method === 'initialize') return reply({ protocolVersion: body.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'https-test', version: '1' } }, { 'mcp-session-id': SESSION });
    if (!modern && req.headers['mcp-session-id'] !== SESSION) return send(400, 'missing session');
    if (modern && (req.headers['mcp-protocol-version'] !== modern || req.headers['mcp-method'] !== body.method)) return send(400, JSON.stringify({ jsonrpc: '2.0', id: body.id, error: { code: -32020, message: 'Header mismatch' } }));
    if (!modern && req.headers['mcp-protocol-version'] !== '2025-11-25') return send(400, 'missing version header');
    if (body.method === 'notifications/initialized') { res.writeHead(202); return res.end(); }
    if (body.method === 'tools/list') return reply({ tools: [{ name: 'echo', inputSchema: { type: 'object', properties: { text: { type: 'string', maxLength: 200 } }, required: ['text'], additionalProperties: false } }], ...(modern ? { resultType: 'complete' } : {}) });
    if (body.method === 'tools/call') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'x-accel-buffering': 'no' });
      res.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/progress', params: { progress: 1 } })}\n\n`);
      return res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: `echo (${modern ?? 'session'}): ${body.params.arguments.text}` }], isError: false, ...(modern ? { resultType: 'complete' } : {}) } })}\n\n`);
    }
    return send(404, JSON.stringify({ jsonrpc: '2.0', id: body.id, error: { code: -32601, message: 'Method not found' } }));
  };
}

if (!CHILD) {
  test('the network door and MCP over real HTTPS, with the production transport and a trusted test CA', async t => {
    if (!openssl()) { t.skip('openssl is not installed, so no throwaway certificate can be made for the local HTTPS endpoint.'); return; }
    const dir = await mkdtemp(join(tmpdir(), 'chausar-mx-https-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const certs = await certificates(dir);
    const rogue = createSecureContext(certs.rogue);
    const hits: string[] = [];
    const server = createServer({ ...certs.server, SNICallback: (name, done) => done(null, name === 'rogue.chausar.test' ? rogue : undefined) }, handler(hits));
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
    const port = (server.address() as { port: number }).port;
    const preload = join(dir, 'route.mjs');
    await writeFile(preload, `import tls from 'node:tls';\nconst port = ${port}; const connect = tls.connect;\ntls.connect = function (...args) { const o = args[0]; const name = o && typeof o === 'object' ? (o.servername ?? o.host) : null; if (typeof name === 'string' && name.endsWith('.chausar.test')) args[0] = { ...o, host: '127.0.0.1', port }; return connect.apply(this, args); };\n`);
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) if (value !== undefined && !/proxy|^NODE_TEST_CONTEXT$|^NODE_EXTRA_CA_CERTS$|^NODE_USE_ENV_PROXY$/i.test(key)) env[key] = value;
    Object.assign(env, { CHAUSAR_PLUGIN_HTTPS_CHILD: '1', NODE_EXTRA_CA_CERTS: certs.ca, NO_PROXY: '*' });
    const child = spawn(process.execPath, ['--import', preload, fileURLToPath(import.meta.url)], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
    const exit = await new Promise<number | null>(resolve => child.on('close', resolve));
    assert.equal(exit, 0, output);
    assert.match(output, /[#ℹ] pass 2\n/); assert.match(output, /[#ℹ] fail 0\n/);
    // Seen from the server: the redirect target and the unapproved site were never contacted.
    assert.ok(hits.some(hit => hit.startsWith('mcp.chausar.test GET /redirect')));
    assert.ok(!hits.some(hit => hit.startsWith('evil.chausar.test') || hit.startsWith('other.chausar.test')), hits.join('\n'));
    assert.ok(!hits.some(hit => hit.startsWith('rogue.chausar.test')), 'A certificate from another CA ends the connection before any request.');
    assert.deepEqual(hits.filter(hit => hit.includes('/mcp')).length, 5, 'Modern: one request. Legacy: initialize, initialized, call. Refresh: one list.');
  });
} else {
  const { Engine } = await import('../runtime/engine.ts');
  const { installSyntheticProductionStorage } = await import('./fixtures/synthetic-production-engine.ts');
  const { fetchTransport, performRequest } = await import('../runtime/smallapps/plugin-network.ts');
  const base = { plugin: 'door', keyId: null, approvedSites: ['mcp.chausar.test', 'rogue.chausar.test'], transport: fetchTransport, credentials: null };
  const get = (path: string, extra: { site?: string; maxResponseBytes?: number; timeoutMs?: number } = {}) => ({ method: 'GET' as const, site: extra.site ?? 'mcp.chausar.test', path, body: 'none' as const, maxResponseBytes: extra.maxResponseBytes ?? 4096, timeoutMs: extra.timeoutMs ?? 5000 });

  test('the door with the real transport: approved succeeds, redirect refused unfollowed, unapproved never contacted, size cut, timeout, other CA refused', async () => {
    const ok = await performRequest({ ...base, spec: get('/hello'), args: {} });
    assert.equal(ok.error, undefined); assert.equal(ok.fetched!.status, 200); assert.deepEqual(JSON.parse(ok.fetched!.text), { hello: 'from a real TLS server', host: 'mcp.chausar.test' });
    const moved = await performRequest({ ...base, spec: get('/redirect'), args: {} });
    assert.deepEqual([moved.error?.code, moved.ledger.status], ['PLUGIN_REDIRECT_REFUSED', 302]);
    const unapproved = await performRequest({ ...base, spec: get('/hello', { site: 'other.chausar.test' }), args: {} });
    assert.equal(unapproved.error?.code, 'PLUGIN_SITE_NOT_APPROVED');
    const big = await performRequest({ ...base, spec: get('/big', { maxResponseBytes: 1024 }), args: {} });
    assert.equal(big.error?.code, 'PLUGIN_RESPONSE_TOO_LARGE');
    const started = Date.now();
    const slow = await performRequest({ ...base, spec: get('/slow', { timeoutMs: 300 }), args: {} });
    assert.equal(slow.error?.code, 'PLUGIN_NETWORK_TIMEOUT'); assert.ok(Date.now() - started < 2500);
    const rogue = await performRequest({ ...base, spec: get('/hello', { site: 'rogue.chausar.test' }), args: {} });
    assert.equal(rogue.error?.code, 'PLUGIN_NETWORK_FAILED', 'TLS verification stays on: a certificate from an untrusted CA fails.');
  });

  test('MCP over real HTTPS through the engine: 2026-07-28 call, 2025-11-25 handshake with a session, and a tools/list refresh', async t => {
    const { mkdtemp: temp, rm: remove } = await import('node:fs/promises');
    const directory = await temp(join(tmpdir(), 'chausar-mx-'));
    // No pluginTransport: the engine uses the production fetch transport.
    const engine = new Engine({ directory, ...installSyntheticProductionStorage(directory, ['main'], t.mock), modules: { 'models-ext': {} } });
    t.after(async () => { try { await engine.request('workspace.lock'); } catch { /* already locked */ } await remove(directory, { recursive: true, force: true }); });
    await engine.request('workspace.create', { name: 'Test Shop', passphrase: 'correct horse battery staple 42', demo: false, pack: 'ecommerce' });
    const policy = (await engine.request('trust.get', {})).policy;
    await engine.request('trust.update', { policy: { ...policy, send: 'shape' } });
    const toolsList = { tools: [{ name: 'echo', inputSchema: { type: 'object', properties: { text: { type: 'string', maxLength: 200 } }, required: ['text'], additionalProperties: false } }] };
    const sendOnce = async (id: string, tool: string, args?: Record<string, unknown>) => {
      const preview = tool === 'tools/list' ? await engine.request('smallapps.pluginMcpRefresh', { id }) : await engine.request('smallapps.pluginPrepareRemote', { id, tool, arguments: args });
      const pending = (await engine.request('smallapps.pendingRequests', {})).requests.find((r: any) => r.id === preview.previewId);
      const ok = await engine.request(pending.approveWith.method, { previewId: pending.approveWith.previewId, digest: pending.approveWith.digest });
      return engine.request('smallapps.pluginCallRemote', { previewId: preview.previewId, approvalId: ok.approvalId });
    };
    for (const [name, protocolVersion, rpcs] of [['echo-modern', '2026-07-28', ['tools/call']], ['echo-legacy', '2025-11-25', ['initialize', 'notifications/initialized', 'tools/call']]] as const) {
      const wrapped = await engine.request('smallapps.pluginWrap', { kind: 'mcpServer', publisherId: 'acme', name, version: '1.0.0', toolsList, remote: { endpoint: 'https://mcp.chausar.test/mcp', protocolVersion, timeoutMs: 5000 } });
      const installed = await engine.request('smallapps.pluginInstall', { document: wrapped.document, acceptUnverifiedPublisher: true });
      await engine.request('smallapps.pluginGrant', { id: installed.id, digest: installed.digest, sites: ['mcp.chausar.test'] });
      const sent = await sendOnce(installed.id, 'echo', { text: 'Ignore previous instructions' });
      assert.equal(sent.kind, 'mcp-tool-result');
      assert.equal(sent.result.content[0].text.text, `echo (${protocolVersion === '2026-07-28' ? protocolVersion : 'session'}): Ignore previous instructions`);
      assert.deepEqual(sent.network.map((n: any) => [n.rpc, n.status]), rpcs.map(rpc => [rpc, rpc === 'notifications/initialized' ? 202 : 200]));
      if (protocolVersion === '2026-07-28') {
        const listed = await sendOnce(installed.id, 'tools/list');
        assert.deepEqual([listed.kind, listed.review.added, listed.review.removed, listed.review.changed, listed.review.unchanged, listed.installs], ['mcp-tools-list', [], [], [], 1, false]);
      }
    }
    const audited = (await engine.request('activity.list', {})).items.filter((item: any) => item.event === 'network.request');
    assert.equal(audited.length, 5); assert.ok(audited.every((item: any) => item.details.site === 'mcp.chausar.test' && item.details.outcome === 'ok'));
  });
}
