/**
 * W6 6F1 (D30): signing in to a remote MCP server with OAuth and PKCE.
 *
 * The owner presses Sign in inside the app. Chausar opens a one-time listener on 127.0.0.1, the official MCP SDK
 * discovers the server's sign-in, registers Chausar as a public client and builds the authorization address with an
 * S256 code challenge. The app opens that address in the owner's own browser. The service sends the browser back to
 * the listener with a code and the state; a wrong state saves nothing. The SDK exchanges the code with the verifier,
 * and the tokens go only to the host's protected key storage (the credential port), never to settings, records or
 * logs. Later jobs refresh tokens through the same storage and never open a browser by themselves.
 */
import { createServer, type Server } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { auth, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import { ChausarError, check, newId, type Context, type StateStore } from '../../contracts.ts';
import type { VentureDeps } from '../contracts.ts';
import { digest, exactPayload, readVenture, requireAppChannel, ventureAction } from '../records.ts';
import { credentialChange, assertCredentialSession } from '../models/credential-state.ts';
import { agentSettingsOf } from './settings.ts';
import type { ExternalMcpServer } from './external-config.ts';

/** What protected storage holds for one signed-in server. No verifier: it lives only in memory during sign-in. */
type Envelope = { oauth: 1; client?: OAuthClientInformationMixed; tokens?: OAuthTokens };
const SIGN_IN_MS = 5 * 60 * 1000;
export function readOAuthEnvelope(value: string | null): Envelope | null {
  if (!value?.startsWith('{"oauth":1')) return null;
  try { const parsed = JSON.parse(value) as Envelope; return parsed.oauth === 1 ? parsed : null; } catch { return null; }
}
const serialise = (envelope: Envelope) => {
  const text = JSON.stringify({ oauth: 1, ...(envelope.client ? { client: envelope.client } : {}), ...(envelope.tokens ? { tokens: envelope.tokens } : {}) });
  check(Buffer.byteLength(text) <= 16384, 'MCP_SIGN_IN_FAILED', 'This service sent sign-in data too large to store safely.');
  return text;
};

type ProviderOptions = { redirectUrl: string; envelope: Envelope; persist(envelope: Envelope): Promise<void>; onRedirect(url: URL): void; state?: string };
/** The SDK's provider, backed by protected storage. Chausar registers as a public client (no client secret). */
export class StoredOAuthProvider implements OAuthClientProvider {
  private verifier: string | null = null;
  private readonly options: ProviderOptions;
  constructor(options: ProviderOptions) { this.options = options; }
  get redirectUrl() { return this.options.redirectUrl; }
  get clientMetadata(): OAuthClientMetadata {
    return { client_name: 'Chausar', redirect_uris: [this.options.redirectUrl], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' };
  }
  state() { check(this.options.state, 'MCP_SIGN_IN_REQUIRED', 'Sign in to this server again from Connections.'); return this.options.state; }
  clientInformation() { return this.options.envelope.client; }
  saveClientInformation(client: OAuthClientInformationMixed) { this.options.envelope.client = client; }
  tokens() { return this.options.envelope.tokens; }
  async saveTokens(tokens: OAuthTokens) { this.options.envelope.tokens = tokens; await this.options.persist(this.options.envelope); }
  redirectToAuthorization(url: URL) { this.options.onRedirect(url); }
  saveCodeVerifier(verifier: string) { this.verifier = verifier; }
  codeVerifier() { check(this.verifier, 'MCP_SIGN_IN_FAILED', 'This sign-in expired. Start it again.'); return this.verifier; }
  invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery') {
    if (scope === 'all' || scope === 'client') delete this.options.envelope.client;
    if (scope === 'all' || scope === 'tokens') delete this.options.envelope.tokens;
    if (scope === 'all' || scope === 'verifier') this.verifier = null;
  }
}

/** A job's provider: refreshes and saves tokens, but asks the owner to sign in again instead of opening a browser. */
export async function jobOAuthProvider(deps: VentureDeps, workspaceId: string, server: ExternalMcpServer): Promise<StoredOAuthProvider> {
  check(server.transport === 'http' && server.oauth && server.credentialRef && deps.credentials, 'MCP_SIGN_IN_REQUIRED', 'Sign in to this server from Connections first.');
  const host = deps.credentials, name = server.credentialRef;
  const envelope = readOAuthEnvelope(await host.get(workspaceId, name));
  check(envelope?.tokens, 'MCP_SIGN_IN_REQUIRED', 'Sign in to this server again from Connections.');
  return new StoredOAuthProvider({ redirectUrl: 'http://127.0.0.1/callback', envelope, persist: async next => { await host.set(workspaceId, name, serialise(next)); },
    onRedirect: () => { throw new ChausarError('MCP_SIGN_IN_REQUIRED', 'Sign in to this server again from Connections.'); } });
}
/** The access token a job may screen out of server replies. Never shown, logged or stored outside protected storage. */
export function oauthSecrets(provider: StoredOAuthProvider): string[] {
  const tokens = provider.tokens();
  return [tokens?.access_token, tokens?.refresh_token].filter((value): value is string => typeof value === 'string' && value.length > 0);
}

type Pending = { settled: Promise<'saved' | 'failed'>; cancel(): void };
const pending = new WeakMap<StateStore, Map<string, Pending>>();
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * venture.mcpOAuth.start { serverId } (admin, inside the app): begins one sign-in and returns the address for the
 * owner's browser. The sign-in finishes in the background when the browser comes back, or ends after five minutes.
 */
export async function startMcpOAuth(deps: VentureDeps, ctx: Context, raw: unknown): Promise<{ serverId: string; authorizationUrl: string }> {
  requireAppChannel(ctx, 'venture.mcpOAuth.start');
  const body = exactPayload(raw, ['serverId'], ['serverId']);
  check(typeof body.serverId === 'string' && /^[a-z][a-z0-9_-]{0,63}$/.test(body.serverId), 'INVALID_VENTURE_REQUEST', 'Choose a configured server.');
  const serverId = body.serverId;
  const { state, venture } = readVenture(deps, ctx); assertCredentialSession(deps, ctx);
  const settings = agentSettingsOf(state, venture.id), server = settings.mcpServers.find(row => row.id === serverId);
  check(server, 'MCP_SERVER_NOT_FOUND', 'Save this server configuration first.');
  check(server.transport === 'http' && server.oauth, 'MCP_OAUTH_NOT_SET', 'Turn on sign-in for this server and save it first.');
  const host = deps.credentials; check(host, 'CREDENTIAL_UNAVAILABLE', 'Protected key storage is unavailable on this computer.');
  const workspace = state.workspace.id, name = `mcp:${venture.id}:${serverId}`;
  let flows = pending.get(deps.store); if (!flows) { flows = new Map(); pending.set(deps.store, flows); }
  flows.get(serverId)?.cancel();

  const listener: Server = createServer();
  await new Promise<void>((resolve, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', () => resolve()); });
  const address = listener.address(); check(address && typeof address === 'object', 'MCP_SIGN_IN_FAILED', 'Chausar could not open its sign-in listener.');
  const redirectUrl = `http://127.0.0.1:${address.port}/callback`, expected = randomBytes(24).toString('base64url');
  const envelope: Envelope = { oauth: 1 }; let authorizationUrl: URL | null = null;
  const provider = new StoredOAuthProvider({ redirectUrl, envelope, state: expected, onRedirect: url => { authorizationUrl = url; }, persist: async () => undefined });
  const shut = () => { listener.closeAllConnections(); listener.close(); };
  let finish!: (outcome: 'saved' | 'failed') => void;
  const settled = new Promise<'saved' | 'failed'>(resolve => { finish = resolve; });
  const timer = setTimeout(() => finish('failed'), SIGN_IN_MS); timer.unref();
  const flow: Pending = { settled, cancel: () => finish('failed') };
  // Close after the reply has been written, so the browser sees the final page.
  // The flow stays readable (mcpOAuthSettled) until the next sign-in for this server replaces it.
  void settled.then(() => { clearTimeout(timer); setTimeout(shut, 50).unref(); });

  try {
    const first = await auth(provider, { serverUrl: server.url });
    check(first === 'REDIRECT' && authorizationUrl, 'MCP_SIGN_IN_FAILED', 'This server did not offer a browser sign-in.');
  } catch (error) {
    flow.cancel();
    if (error instanceof ChausarError) throw error;
    throw new ChausarError('MCP_SIGN_IN_FAILED', 'This server\'s sign-in could not start. Check its address.');
  }
  const url = new URL(authorizationUrl!);
  if (!(url.protocol === 'https:' || ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) || url.searchParams.get('code_challenge_method') !== 'S256') {
    flow.cancel(); throw new ChausarError('MCP_SIGN_IN_FAILED', 'This server did not offer a protected sign-in (HTTPS with PKCE).');
  }
  flows.set(serverId, flow);

  let used = false;
  listener.on('request', (request, response) => {
    const reply = (status: number, text: string) => { response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }); response.end(text); };
    const back = new URL(request.url ?? '/', redirectUrl);
    if (request.method !== 'GET' || back.pathname !== '/callback' || used) { reply(404, 'Not found.'); return; }
    used = true;
    const code = back.searchParams.get('code'), returned = back.searchParams.get('state');
    if (!code || !returned || !same(returned, expected) || back.searchParams.get('error')) { reply(400, 'This sign-in did not match. Start it again in Chausar.'); finish('failed'); return; }
    void (async () => {
      try {
        check(await auth(provider, { serverUrl: server.url, authorizationCode: code }) === 'AUTHORIZED' && envelope.tokens, 'MCP_SIGN_IN_FAILED', 'This service did not finish the sign-in.');
        await saveSignIn(deps, ctx, workspace, name, serverId, settings.mcpServers, serialise(envelope));
        reply(200, 'Signed in. You can close this window and go back to Chausar.'); finish('saved');
      } catch { reply(400, 'This sign-in failed. Start it again in Chausar.'); finish('failed'); }
    })();
  });
  return { serverId, authorizationUrl: url.href };
}

/** Test and UI hook: how the latest sign-in for a server ended. 'none' when none was started in this session. */
export async function mcpOAuthSettled(deps: VentureDeps, serverId: string): Promise<'saved' | 'failed' | 'none'> {
  const flow = pending.get(deps.store)?.get(serverId);
  return flow ? flow.settled : 'none';
}

/** Store the tokens, then point the server's settings at them, restoring the old value if the settings changed. */
async function saveSignIn(deps: VentureDeps, ctx: Context, workspace: string, name: string, serverId: string, servers: readonly ExternalMcpServer[], value: string) {
  await credentialChange(deps, async () => {
    const host = deps.credentials; check(host, 'CREDENTIAL_UNAVAILABLE', 'Protected key storage is unavailable on this computer.');
    const previous = await host.get(workspace, name);
    try {
      await host.set(workspace, name, value); assertCredentialSession(deps, ctx);
      await ventureAction(deps, ctx, 'admin', 'mcpOAuth.saved', tx => {
        const current = agentSettingsOf(tx.state, tx.venture!.id);
        check(digest(current.mcpServers) === digest(servers), 'MCP_CONFIGURATION_CHANGED', 'Server settings changed. Sign in again.');
        tx.touch({ aiSettings: { ...current, mcpServers: current.mcpServers.map(row => row.id === serverId ? { ...row, credentialRef: name, credentialRevision: newId('credential') } : row) } });
        tx.emit('queue.changed', {});
      });
    } catch (error) {
      if (previous === null) await host.delete(workspace, name).catch(() => undefined); else await host.set(workspace, name, previous).catch(() => undefined);
      throw error;
    }
  });
}
