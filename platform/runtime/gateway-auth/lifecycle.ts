import type { KeychainHook, Vault } from '../vault.ts';
import { secretCustody } from './secret-store.ts';
import { pinVaultAttached, pinVaultClosed } from './pin.ts';

/** Engine hook after a vault attaches: open stored-secret custody for the app directory and tidy the PIN record.
 *  `live` turns false once the engine lets go of this vault, which locks custody even if no close follows. */
export async function gatewayAuthVaultAttached(input: { directory: string; keychain?: KeychainHook; demo: boolean; vault: Vault; live: () => boolean }): Promise<void> {
  await secretCustody.open({ directory: input.directory, keychain: input.keychain, demo: input.demo, live: input.live });
  await pinVaultAttached(input.directory, input.vault).catch(() => {});
}
/** Engine hook when the vault closes (lock, delete, shutdown): zero held keys; a deleted vault's PIN record goes too. Never throws. */
export function gatewayAuthVaultClosed(directory: string): void {
  try { secretCustody.close(directory); } catch {}
  try { pinVaultClosed(directory); } catch {}
}
