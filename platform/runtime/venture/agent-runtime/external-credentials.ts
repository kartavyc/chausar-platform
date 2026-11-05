/** Write-only renderer boundary. Tokens stay in the OS-protected shelf, never records or settings. */
import { ChausarError, check, newId, type Context } from '../../contracts.ts';
import type { VentureDeps } from '../contracts.ts';
import { digest, exactPayload, readVenture, requireAppChannel, ventureAction } from '../records.ts';
import { credentialChange, assertCredentialSession } from '../models/credential-state.ts';
import { agentSettingsOf } from './settings.ts';

export async function setMcpCredential(deps: VentureDeps, ctx: Context, raw: unknown): Promise<{ serverId: string; saved: boolean }> {
  requireAppChannel(ctx, 'venture.mcpCredential.set');
  const body = exactPayload(raw, ['serverId', 'token'], ['serverId', 'token']);
  check(typeof body.serverId === 'string' && /^[a-z][a-z0-9_-]{0,63}$/.test(body.serverId), 'INVALID_VENTURE_REQUEST', 'Choose a configured server.');
  check(body.token === null || typeof body.token === 'string' && body.token.length > 0 && Buffer.byteLength(body.token) <= 16384 && !/[\u0000-\u001f\u007f]/.test(body.token), 'INVALID_VENTURE_REQUEST', 'Enter a token without line breaks, or remove the saved token.');
  const serverId = body.serverId, token = body.token as string | null;
  return credentialChange(deps, async () => {
    const { state, venture } = readVenture(deps, ctx); assertCredentialSession(deps, ctx);
    const settings = agentSettingsOf(state, venture.id), server = settings.mcpServers.find(row => row.id === serverId);
    check(server, 'MCP_SERVER_NOT_FOUND', 'Save this server configuration first.');
    const host = deps.credentials; check(host, 'CREDENTIAL_UNAVAILABLE', 'Protected key storage is unavailable on this computer.');
    const workspace = state.workspace.id, name = `mcp:${venture.id}:${serverId}`;
    const previous = await host.get(workspace, name); assertCredentialSession(deps, ctx); let attempted = false;
    try {
      attempted = true;
      if (token === null) await host.delete(workspace, name); else await host.set(workspace, name, token);
      assertCredentialSession(deps, ctx);
      await ventureAction(deps, ctx, 'admin', 'mcpCredential.set', tx => {
        const current = agentSettingsOf(tx.state, tx.venture!.id);
        check(digest(current.mcpServers) === digest(settings.mcpServers), 'MCP_CONFIGURATION_CHANGED', 'Server settings changed. Save the token again.');
        const { credentialRef: _ref, credentialRevision: _revision, ...base } = server;
        const next = token === null ? base : { ...base, credentialRef: name, credentialRevision: newId('credential') };
        tx.touch({ aiSettings: { ...current, mcpServers: current.mcpServers.map(row => row.id === serverId ? next : row) } });
        tx.emit('queue.changed', {});
      });
    } catch (error) {
      if (attempted) try { if (previous === null) await host.delete(workspace, name); else await host.set(workspace, name, previous); }
      catch { throw new ChausarError('CREDENTIAL_UNAVAILABLE', 'The saved key for this server could not be put back. Save it again before using this server.'); }
      throw error;
    }
    return { serverId, saved: token !== null };
  });
}
