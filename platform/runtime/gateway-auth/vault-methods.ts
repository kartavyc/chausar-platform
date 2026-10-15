import { check, type Context } from '../contracts.ts';
import type { MethodSpec, ModuleHost } from '../modules/types.ts';
import type { Vault } from '../vault.ts';
import { secretCustody } from './secret-store.ts';
import { checkPinFolder, checkPinRule, enrolPin, openVaultFolder, pinStatus, removePinRecord } from './pin.ts';
import { networkOnline } from './network.ts';

/** Changing how this computer unlocks is the owner's own desktop act, never one driven by outside text. */
function ownerAtDesktop(ctx: Context) {
  check(ctx.channel === undefined || ctx.channel === 'desktop', 'OPEN_DESKTOP', 'Do this yourself in the desktop app.');
  check(ctx.sourceTainted !== true, 'TAINTED_PIN_REQUEST', 'Imported text cannot change how this computer unlocks.');
  check(ctx.role === 'owner', 'OWNER_REQUIRED', 'Only the owner can change quick unlock on this computer.');
}
const openVault = (host: ModuleHost) => host.store as unknown as Vault;
/** The open vault's id when it is this folder's; undefined when the folder's vault cannot be read without unlocking. */
async function currentVaultId(host: ModuleHost, folder: string): Promise<string | undefined> {
  let vault: Vault; try { vault = openVault(host); } catch { return undefined; }
  try { return await openVaultFolder(host.directory, vault) === folder ? vault.vaultId : undefined; } catch { return undefined; }
}

export const vaultMethods: Record<string, MethodSpec> = {
  'secrets.status': { permission: 'admin', handler: (_ctx, _payload, host) => secretCustody.status(host.directory) },
  'pin.set': { permission: 'admin', handler: async (ctx, payload, host) => {
    ownerAtDesktop(ctx); checkPinRule(payload.pin);
    check(typeof payload.passphrase === 'string' && payload.passphrase.length > 0, 'PASSPHRASE_REQUIRED', 'Enter your passphrase to set quick unlock.');
    const vault = openVault(host), folder = await openVaultFolder(host.directory, vault);
    check(await enrolPin({ directory: host.directory, folder, pin: payload.pin, passphrase: payload.passphrase, vault }), 'PASSPHRASE_INCORRECT', 'That passphrase is not right. Quick unlock was not set.');
    return pinStatus(host.directory, folder, vault.vaultId);
  } },
  'pin.clear': { permission: 'admin', handler: async (ctx, _payload, host) => {
    ownerAtDesktop(ctx);
    const vault = openVault(host), folder = await openVaultFolder(host.directory, vault);
    removePinRecord(host.directory, folder);
    return pinStatus(host.directory, folder, vault.vaultId);
  } },
  'pin.status': { permission: 'read', preVault: true, handler: async (_ctx, payload, host) => {
    const folder = checkPinFolder(payload.folder ?? 'main');
    return pinStatus(host.directory, folder, await currentVaultId(host, folder));
  } },
  'network.online': { permission: 'read', preVault: true, handler: (_ctx, _payload, host) => networkOnline(host.options.networkProbe) },
};
