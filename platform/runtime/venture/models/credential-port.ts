import { randomUUID } from 'node:crypto';
import { validate, failure } from './credential-contract.cjs';

/** Host-only capability. The workspace scope is supplied by the unlocked engine, never a renderer read method. */
export interface HostCredentialPort {
  get(workspaceId: string, name: string): Promise<string | null>;
  set(workspaceId: string, name: string, value: string): Promise<void>;
  delete(workspaceId: string, name: string): Promise<void>;
}
type Channel = { connected?: boolean; send?(message: unknown, callback: (error: Error | null) => void): boolean; on(event: string, listener: (...args: any[]) => void): unknown; off?(event: string, listener: (...args: any[]) => void): unknown };
/**
 * noStore (A2 second review): keep the host's CREDENTIAL_NO_STORE (this computer has no protected store at all) instead of
 * folding it into CREDENTIAL_UNAVAILABLE. Only the Codex seal asks for it; a timeout, a closed channel or a host that did
 * not answer is always CREDENTIAL_UNAVAILABLE.
 */
export function processCredentialPort(channel: Channel, { timeoutMs = 10000, noStore = false } = {}): HostCredentialPort {
  const waiting = new Map<string, { finish(error: Error | null, value?: string | null): void }>(); let closed = false;
  const onMessage = (message: any) => {
    if (!message || message.kind !== 'host-credential-result' || typeof message.callId !== 'string') return;
    const call = waiting.get(message.callId); if (!call) return;
    if (message.ok === true && (message.value === null || typeof message.value === 'string' && Buffer.byteLength(message.value) <= 16384)) call.finish(null, message.value);
    else call.finish(failure(message.code === 'CREDENTIAL_INVALID' ? 'CREDENTIAL_INVALID' : noStore && message.code === 'CREDENTIAL_NO_STORE' ? 'CREDENTIAL_NO_STORE' : 'CREDENTIAL_UNAVAILABLE'));
  };
  const disconnect = () => { closed = true; for (const call of waiting.values()) call.finish(failure('CREDENTIAL_UNAVAILABLE')); channel.off?.('message', onMessage); channel.off?.('disconnect', disconnect); };
  channel.on('message', onMessage); channel.on('disconnect', disconnect);
  function request(op: string, workspaceId: string, name: string, value?: string): Promise<string | null> {
    try { validate(workspaceId, name, value, op === 'set'); } catch (error) { return Promise.reject(error); }
    if (closed || !channel.connected || !channel.send || waiting.size >= 32) return Promise.reject(failure('CREDENTIAL_UNAVAILABLE'));
    return new Promise((resolve, reject) => {
      const callId = randomUUID(), timer = setTimeout(() => finish(failure('CREDENTIAL_UNAVAILABLE')), timeoutMs);
      function finish(error: Error | null, result?: string | null) { if (!waiting.delete(callId)) return; clearTimeout(timer); if (error) reject(error); else resolve(result ?? null); }
      waiting.set(callId, { finish });
      try { channel.send!({ kind: 'host-credential', callId, op, workspaceId, name, ...(op === 'set' ? { value } : {}) }, error => { if (error) finish(failure('CREDENTIAL_UNAVAILABLE')); }); }
      catch { finish(failure('CREDENTIAL_UNAVAILABLE')); }
    });
  }
  return Object.freeze({ get: (scope: string, name: string) => request('get', scope, name), set: async (scope: string, name: string, value: string) => { await request('set', scope, name, value); }, delete: async (scope: string, name: string) => { await request('delete', scope, name); } });
}
