import type { Env } from '../shared/module.ts';
import { FileBlobStore, type BlobStore } from './store.ts';

/** BACKUP_DIRECTORY: where `FileBlobStore` keeps the encrypted bytes. Unset means backup refuses `BLOB_STORE_NOT_CONFIGURED`. */
export type BackupConfig = { directory: string | null };
export function backupConfig(env: Env): BackupConfig {
  const directory = env.BACKUP_DIRECTORY?.trim();
  return { directory: directory ? directory : null };
}
export const backupStore = (config: BackupConfig): BlobStore | null => config.directory ? new FileBlobStore(config.directory) : null;
