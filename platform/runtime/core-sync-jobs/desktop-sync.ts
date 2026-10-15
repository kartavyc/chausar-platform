/**
 * The installed app's sync options (TR-07). `worker.ts` calls this at start: when this computer is enrolled
 * (`sync.setup` or `devices.join` wrote `enrolment.json`), the Engine gets this computer's device id and signing key,
 * the pen writer admission, the signers of every computer it knows, and, for a shared folder, the encrypted file store
 * there. Sync stays off until the owner turns it on (`syncOn`). Without an enrolment the Engine gets no sync options, so
 * the app behaves exactly as before. Demo launches never sync.
 */
import { mkdir } from 'node:fs/promises';
import type { SyncOptions } from '../sync.ts';
import type { SyncWriterAdmission } from '../sync-writer-admission.ts';
import { FileSyncTransport } from '../sync-file-transport.ts';
import { deviceIdentity, readEnrolment } from './device-files.ts';
import { PenWriterAdmission } from './pen.ts';
import { sharedPaths } from './devices.ts';

/** `clock` is for synthetic tests only; the installed app uses the system clock. */
export async function desktopSyncOptions(directory: string, demo: boolean, clock?: () => Date): Promise<(SyncOptions & { writerAdmission?: SyncWriterAdmission }) | undefined> {
  if (demo) return undefined;
  const enrolment = await readEnrolment(directory); if (!enrolment) return undefined;
  const device = await deviceIdentity(directory); if (!device || device.identity.deviceId !== enrolment.deviceId) return undefined;
  const { workspaceId, vaultId, deviceId } = enrolment;
  let transport: FileSyncTransport | undefined;
  if (enrolment.transport.kind === 'folder') {
    const store = sharedPaths(enrolment.transport.directory).store;
    // An unreachable folder leaves sync without a transport; the app still opens and says sync is not connected.
    try { await mkdir(store, { recursive: true, mode: 0o700 }); transport = new FileSyncTransport({ directory: store, workspaceId, vaultId, ...(clock ? { clock } : {}) }); } catch { transport = undefined; }
  }
  return { mode: 'single-writer', workspaceId, deviceId, signerId: deviceId, signingKey: device.signingKey, enabled: enrolment.syncOn, ...(transport ? { transport } : {}),
    trustedSigners: {}, leaseTtlMs: 60_000, ...(clock ? { clock } : {}), writerAdmission: new PenWriterAdmission({ directory, workspaceId, vaultId, deviceId }) };
}
