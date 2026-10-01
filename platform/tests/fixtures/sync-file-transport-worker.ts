import { pathToFileURL } from 'node:url';
import { FileSyncTransport } from '../../runtime/sync-file-transport.ts';
import type { FileSyncFaultPoint } from '../../runtime/sync-file-transport.ts';
import type { SyncLease, SyncSnapshot } from '../../runtime/sync.ts';
import { hash } from '../../runtime/contracts.ts';

/** Authored opaque ciphertext fixture, not a decryptable backup or a native/live peer. */
export function encryptedFixture(lease: SyncLease, options: {
  revision?: number; sequence?: number; previousHash?: string | null;
  workspaceId?: string; vaultId?: string; marker?: number; createdAt?: string;
} = {}): SyncSnapshot {
  const revision = options.revision ?? 1, vaultId = options.vaultId ?? 'vault';
  const cipher = (bytes: number) => ({ nonce: Buffer.alloc(12, 1).toString('base64url'), tag: Buffer.alloc(16, 2).toString('base64url'), data: Buffer.alloc(bytes, options.marker ?? 3).toString('base64url') });
  const wrapper = () => ({ salt: Buffer.alloc(16, 4).toString('base64url'), kdf: 'scrypt-32768-8-1', ciphertext: cipher(32) });
  const backup = { backupFormat: 'chausar.backup.v1', envelope: { format: 'chausar.vault.v1', id: vaultId, revision, passphrase: wrapper(), recovery: wrapper(), snapshot: cipher(48) } };
  const ciphertextBase64 = Buffer.from(JSON.stringify(backup)).toString('base64');
  return { format: 'chausar.sync.v1', workspaceId: options.workspaceId ?? 'workspace', vaultId, revision,
    sequence: options.sequence ?? 1, fence: lease.fence, deviceId: lease.deviceId, signerId: `signer-${lease.deviceId}`,
    memberId: lease.memberId, epoch: lease.epoch, createdAt: options.createdAt ?? '2026-10-01T12:00:00.000Z',
    previousHash: options.previousHash ?? null, ciphertextBase64, ciphertextDigest: hash(ciphertextBase64),
    signature: Buffer.alloc(64, 7).toString('base64url') };
}

// The process fixture uses only inherited local IPC and its explicitly supplied C
// temporary directory. It performs no network, engine/model, GUI or credential work.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const options = JSON.parse(process.argv[2]);
  let trustedTime = options.time as string, faultPoint: FileSyncFaultPoint | undefined, faultAction: 'pause' | 'crash' | undefined;
  let releaseFault: (() => void) | undefined;
  const send = (value: unknown) => new Promise<void>((resolve, reject) => process.send!(value, (error: Error | null) => error ? reject(error) : resolve()));
  const transport = new FileSyncTransport({ directory: options.directory, workspaceId: 'workspace', vaultId: 'vault', clock: () => new Date(trustedTime),
    fault: async point => {
      if (point !== faultPoint) return;
      await send({ type: 'fault', point });
      if (faultAction === 'crash') process.exit(86);
      await new Promise<void>(resolve => { releaseFault = resolve; });
    } });
  process.on('message', (message: any) => {
    if (message.type === 'release') { releaseFault?.(); return; }
    if (message.type !== 'operation') return;
    trustedTime = message.time ?? trustedTime;
    faultPoint = message.faultPoint; faultAction = message.faultAction;
    void (async () => {
      try {
        const result = message.op === 'lease' ? await transport.acquireLease(message.input)
          : message.op === 'put' ? await transport.put(message.input)
          : message.op === 'head' ? await transport.getHead()
          : message.op === 'get' ? await transport.get(message.input.recordHash)
          : (() => { throw new Error('Unknown fixture operation.'); })();
        await send({ type: 'result', id: message.id, ok: true, result });
      } catch (error: any) { await send({ type: 'result', id: message.id, ok: false, code: error.code, message: error.message }); }
    })();
  });
  await send({ type: 'ready' });
}
