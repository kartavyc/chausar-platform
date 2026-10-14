import { readFileSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check } from '../contracts.ts';

/** Trusted options for the release engine module, read from the desktop host's environment and the
 * build's own package description. Nothing here comes from a renderer or a file the person imported. */
export type ReleaseModuleOptions = {
  releasePublicKey?: string; channel: 'stable' | 'preview'; previewExpiresAt: string | null; feedUrl?: string;
  installRoot?: string; resourcesPath?: string; appExecutable?: string;
};
const packagePath = fileURLToPath(new URL('../../../package.json', import.meta.url));
const absolute = (value: string | undefined, name: string) => {
  if (value === undefined || value === '') return undefined;
  check(isAbsolute(value) && !/[\x00-\x1f\x7f]/.test(value), 'RELEASE_OPTIONS_INVALID', `${name} must be an absolute path.`);
  return value;
};

export function releaseModuleOptions(environment: Readonly<Record<string, string | undefined>>, packageJson = packagePath): ReleaseModuleOptions {
  const metadata = JSON.parse(readFileSync(packageJson, 'utf8'));
  // The unsigned preview package names its channel `unsigned-preview`; for updates it is the preview channel.
  const named = metadata.chausarReleaseChannel;
  check(named === undefined || ['stable', 'preview', 'unsigned-preview'].includes(named), 'RELEASE_OPTIONS_INVALID', 'The build names an unknown release channel.');
  const previewExpiresAt = typeof metadata.chausarPreviewExpiresAt === 'string' ? metadata.chausarPreviewExpiresAt : null;
  const channel = named === undefined ? (previewExpiresAt ? 'preview' : 'stable') : named === 'stable' ? 'stable' : 'preview';
  const keychainManifest = absolute(environment.CHAUSAR_KEYCHAIN_MANIFEST, 'CHAUSAR_KEYCHAIN_MANIFEST');
  // <resources>/runtime-binaries/keychain/manifest.json → <resources>
  const resourcesPath = absolute(environment.CHAUSAR_RESOURCES_PATH, 'CHAUSAR_RESOURCES_PATH') ?? (keychainManifest ? dirname(dirname(dirname(keychainManifest))) : undefined);
  const options: ReleaseModuleOptions = { channel, previewExpiresAt };
  if (environment.CHAUSAR_UPDATE_PUBLIC_KEY) options.releasePublicKey = environment.CHAUSAR_UPDATE_PUBLIC_KEY;
  if (environment.CHAUSAR_UPDATE_FEED_URL) options.feedUrl = environment.CHAUSAR_UPDATE_FEED_URL;
  // In the installed app the engine worker runs on the app's own executable (ELECTRON_RUN_AS_NODE);
  // a development Electron from node_modules cannot start the app by itself, so it is not used.
  const packagedElectron = process.versions.electron && !/[\\/]node_modules[\\/]/.test(process.execPath) ? process.execPath : undefined;
  const installRoot = absolute(environment.CHAUSAR_INSTALL_ROOT, 'CHAUSAR_INSTALL_ROOT');
  const appExecutable = absolute(environment.CHAUSAR_APP_EXECUTABLE, 'CHAUSAR_APP_EXECUTABLE') ?? packagedElectron;
  if (installRoot) options.installRoot = installRoot;
  if (resourcesPath) options.resourcesPath = resourcesPath;
  if (appExecutable) options.appExecutable = appExecutable;
  return options;
}
